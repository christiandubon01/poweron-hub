/**
 * QBO-4A.3 focused tests — Customer Search/Create + Mapping API.
 *
 * 29 scenarios (owner-locked rules):
 *   auth required; server derives org (body can't override); raw QBO query injection
 *   impossible; search input escaping; search result sanitization; inactive customer
 *   marked; no realmId/fingerprint/tokens in response; mapping lookup isolated by
 *   company/env; reconciled UUID required; gc... ID rejected; link verifies QBO
 *   customer before persistence; same-link idempotent; conflicting PowerOn mapping
 *   rejected; QBO customer claimed by another rejected; explicit create works;
 *   create never from lookup/search; already-mapped doesn't create another QBO
 *   customer; 6240 sanitized+no-auto-merge; QBO-success+mapping-failure recoverable
 *   +no-blind-retry; unlink retains history; unlink state fields consistent; sandbox
 *   not reused in production; company A not reused in company B; QBO financial
 *   firewall green; Save Draft works with no mapping; Approve works with no mapping;
 *   no Send to QuickBooks introduced.
 *
 * Handler-level scenarios mock ONLY the Supabase-touching auth bootstrap
 * (qboCustomerAuth) — the accounting client + mapping store run for real against
 * in-memory fakes (fake fetch + FakeMappingRepo), so the request logic is exercised
 * end-to-end without a network or database.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildCustomerSearchQuery,
  escapeQboStringLiteral,
  isDuplicateNameFault,
  parseQboFault,
  QboCustomerApiError,
  toCustomerSummary,
} from '../qboCustomerContract'
import { validateAndBuildCreateCustomerPayload } from '../qboCustomerCreateInput'
import {
  createCustomerWithBearer,
  queryCustomersWithBearer,
  readCustomerWithBearer,
  type QboAccountingBearer,
} from '../qboAccountingClient'
import { QboCustomerMappingConflictError } from '../../../../netlify/functions/quickbooks/qboCustomerMappingRepo'

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

// ── Shared fakes ─────────────────────────────────────────────────────────────

interface FakeFetchResponse {
  ok: boolean
  status: number
  body: unknown
}
function fakeRes(r: FakeFetchResponse) {
  return {
    ok: r.ok,
    status: r.status,
    json: async () => r.body,
    text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
  }
}
type FetchImpl = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => ReturnType<typeof fakeRes>
/** Wrap a fetch impl so each call is recorded (for "no QBO create" / "no retry" proofs). */
function recordingFetch(impl: (url: string, init: { method: string }) => unknown): { fetch: FetchImpl; calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = []
  const fetch = ((url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, method: init.method })
    return impl(url, init) as ReturnType<typeof fakeRes>
  }) as FetchImpl
  return { fetch, calls }
}

const BEARER: QboAccountingBearer = {
  accessToken: 'access-token-secret',
  realmId: 'realm-9301',
  environment: 'sandbox',
  baseUrl: 'https://sandbox-quickbooks.api.intuit.com',
}

// ── Pure: contract / parsing / query building ─────────────────────────────────

describe('QBO-4A.3 contract + search query (scenarios 3,4,18-parse)', () => {
  it('escapeQboStringLiteral doubles single quotes (scenario 4)', () => {
    expect(escapeQboStringLiteral("O'Brien")).toBe("O''Brien")
    expect(escapeQboStringLiteral("a'b'c")).toBe("a''b''c")
  })

  it('buildCustomerSearchQuery places the term inside a quoted LIKE operand — raw SQL injection impossible (scenario 3)', () => {
    const q = buildCustomerSearchQuery("x' OR 1=1 --")
    // The term is single-quote-escaped so it can never break out of the LIKE literal.
    expect(q).toContain("DisplayName LIKE '%x'' OR 1=1 --%'")
    // No unescaped OR can terminate the WHERE: the injected quote is doubled.
    expect(q).not.toMatch(/DisplayName LIKE '%[^']*' OR 1=1/i)
  })

  it('buildCustomerSearchQuery ANDs Active=true only when activeOnly (inactive included by default)', () => {
    expect(buildCustomerSearchQuery('acme')).not.toContain('Active = true')
    expect(buildCustomerSearchQuery('acme', { activeOnly: true })).toContain('AND Active = true')
  })

  it('parseQboFault extracts the first Intuit Fault error (always an array)', () => {
    const fault = parseQboFault({
      Fault: {
        Error: [{ Message: 'Duplicate Name Exists Error', Detail: 'The name supplied already exists. : null', code: '6240' }],
        type: 'ValidationFault',
      },
      time: '2022-03-12T23:52:39.915-08:00',
    })
    expect(fault).toEqual({ code: '6240', message: 'Duplicate Name Exists Error', detail: 'The name supplied already exists. : null', type: 'ValidationFault' })
    expect(isDuplicateNameFault(fault)).toBe(true)
  })

  it('parseQboFault returns null for a non-fault / success body', () => {
    expect(parseQboFault({ QueryResponse: { Customer: [] } })).toBeNull()
    expect(parseQboFault(null)).toBeNull()
    expect(parseQboFault({ Fault: { Error: [] } })).toBeNull()
  })

  it('toCustomerSummary strips to browser-safe fields (scenario 5) and marks inactive (scenario 6)', () => {
    const active = toCustomerSummary({ Id: '1', DisplayName: 'Acme', CompanyName: 'Acme Inc', PrimaryEmailAddr: { Address: 'a@b.co' }, PrimaryPhone: { FreeFormNumber: '555-1234' }, Active: true, SyncToken: '9', Balance: 1000 })
    expect(active).toEqual({ id: '1', displayName: 'Acme', companyName: 'Acme Inc', email: 'a@b.co', phone: '555-1234', active: true })
    expect(active && 'SyncToken' in active).toBe(false)
    // Inactive customer is marked active:false.
    const inactive = toCustomerSummary({ Id: '2', DisplayName: 'Old', Active: false })
    expect(inactive?.active).toBe(false)
    // Missing Active defaults to true (Intuit default).
    expect(toCustomerSummary({ Id: '3', DisplayName: 'NoActive' })?.active).toBe(true)
  })
})

// ── Pure: create-input validation ─────────────────────────────────────────────

const VALID_UUID = '11111111-1111-4111-8111-111111111111'

describe('QBO-4A.6 create-input validation — canonical TEXT shape (scenarios 9,10,15,16)', () => {
  it('rejects an empty / missing poweronCustomerId (shape, scenario 9)', () => {
    expect(validateAndBuildCreateCustomerPayload({ poweronCustomerId: '', displayName: 'X' }).ok).toBe(false)
    expect(validateAndBuildCreateCustomerPayload({ displayName: 'X' } as any).ok).toBe(false)
  })
  it('ACCEPTS a canonical TEXT id (gc…/import_gc…) at the SHAPE layer — existence is the SERVER job (scenario 10 corrected)', () => {
    // QBO-4A.6 contract change: the shape validator no longer rejects 'gc…' by
    // format. A gc/import_gc id is a valid canonical PowerOn customer identity
    // (relationship_accounts.id). The org-scoped EXISTENCE check (handler-level
    // assertCanonicalPowerOnCustomerId, scenario 10 below) is what rejects an id
    // that is not a real relationship_accounts row — not this pure shape validator.
    expect(validateAndBuildCreateCustomerPayload({ poweronCustomerId: 'gc2', displayName: 'X' }).ok).toBe(true)
    expect(validateAndBuildCreateCustomerPayload({ poweronCustomerId: 'import_gc_7', displayName: 'X' }).ok).toBe(true)
    expect(validateAndBuildCreateCustomerPayload({ poweronCustomerId: 'not-a-uuid', displayName: 'X' }).ok).toBe(true)
  })
  it('rejects an over-length / control-char poweronCustomerId (shape)', () => {
    expect(validateAndBuildCreateCustomerPayload({ poweronCustomerId: 'x'.repeat(200), displayName: 'X' }).ok).toBe(false)
    expect(validateAndBuildCreateCustomerPayload({ poweronCustomerId: 'gc2\n', displayName: 'X' }).ok).toBe(false)
  })
  it('requires displayName (1-100)', () => {
    expect(validateAndBuildCreateCustomerPayload({ poweronCustomerId: VALID_UUID, displayName: '' }).ok).toBe(false)
    expect(validateAndBuildCreateCustomerPayload({ poweronCustomerId: VALID_UUID, displayName: 'x'.repeat(101) }).ok).toBe(false)
  })
  it('builds an allow-listed payload with no passthrough of unknown fields (scenario 16 — explicit, bounded)', () => {
    const v = validateAndBuildCreateCustomerPayload({
      poweronCustomerId: VALID_UUID,
      displayName: 'Test Customer',
      companyName: 'TC LLC',
      email: 'tc@example.com',
      phone: '555-1234',
      billAddr: { line1: '1 Main St', city: 'Town', state: 'CA', postalCode: '90210', country: 'US' },
      // unknown fields must NOT pass through:
      SecretToken: 'leak',
      SyncToken: '9',
      Balance: 999,
    })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.payload).toMatchObject({ DisplayName: 'Test Customer', Active: true, CompanyName: 'TC LLC' })
      expect(v.payload).not.toHaveProperty('SecretToken')
      expect(v.payload).not.toHaveProperty('SyncToken')
      expect(v.payload).not.toHaveProperty('Balance')
      expect((v.payload as any).PrimaryEmailAddr).toEqual({ Address: 'tc@example.com' })
    }
  })
  it('rejects malformed email', () => {
    expect(validateAndBuildCreateCustomerPayload({ poweronCustomerId: VALID_UUID, displayName: 'X', email: 'no-at-sign' }).ok).toBe(false)
  })
})

// ── Pure: accounting client with fake fetch (scenarios 5,6,18,19) ──────────────

describe('QBO-4A.3 accounting client (sanitization, 6240, split-failure)', () => {
  it('queryCustomersWithBearer returns raw customers (sanitized by caller)', async () => {
    const { fetch } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { QueryResponse: { Customer: [{ Id: '1', DisplayName: 'A', Active: true }] } } }))
    const raw = await queryCustomersWithBearer(BEARER, fetch as any, buildCustomerSearchQuery('A'))
    expect(raw).toHaveLength(1)
    expect((raw[0] as any).Id).toBe('1')
  })

  it('createCustomerWithBearer surfaces 6240 as duplicate_name (sanitized, no auto-merge)', async () => {
    const { fetch, calls } = recordingFetch(() => fakeRes({ ok: false, status: 400, body: { Fault: { Error: [{ Message: 'Duplicate Name Exists Error', Detail: 'x', code: '6240' }], type: 'ValidationFault' } } }))
    await expect(createCustomerWithBearer(BEARER, fetch as any, { DisplayName: 'Dup' })).rejects.toMatchObject({ category: 'duplicate_name' })
    // Exactly one provider call — no auto-suffix/merge/retry.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('readCustomerWithBearer throws not_found for a 404', async () => {
    const { fetch } = recordingFetch(() => fakeRes({ ok: false, status: 404, body: {} }))
    await expect(readCustomerWithBearer(BEARER, fetch as any, '999')).rejects.toMatchObject({ category: 'not_found' })
  })

  it('split-failure: provider success but mapping persistence fails is recoverable with safe provider identity (scenario 19, no blind retry)', async () => {
    // The accounting client returns the created customer; the handler (tested below)
    // is responsible for the recoverable error. Here we prove the create call returns
    // a usable id even when the caller's subsequent persist throws.
    const { fetch, calls } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { Customer: { Id: '77', DisplayName: 'Created', Active: true } } }))
    const raw = await createCustomerWithBearer(BEARER, fetch as any, { DisplayName: 'Created' })
    expect((raw as any).Id).toBe('77')
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })
})

// ── FakeMappingRepo (in-memory, simulates partial UNIQUE indexes) ──────────────

interface FakeRow {
  id: string
  organizationId: string
  poweronCustomerId: string
  qboCustomerId: string
  qboCompanyFingerprint: string
  qboEnvironment: 'sandbox' | 'production'
  linkOrigin: 'linked' | 'created'
  qboDisplayName: string | null
  isActive: boolean
  unlinkedAt: string | null
  unlinkedByUserId: string | null
  linkedByUserId: string | null
  createdAt: string
  updatedAt: string
}

class FakeMappingRepo {
  rows: FakeRow[] = []
  insertShouldThrow: Error | null = null
  insertedScopes: any[] = []
  deactivatedScopes: any[] = []
  seq = 0
  async loadActiveMapping(scope: any) {
    return (
      this.rows.find(
        (r) =>
          r.isActive &&
          r.organizationId === scope.organizationId &&
          r.poweronCustomerId === scope.poweronCustomerId &&
          r.qboCompanyFingerprint === scope.qboCompanyFingerprint &&
          r.qboEnvironment === scope.qboEnvironment,
      ) ?? null
    )
  }
  async insertMapping(input: any, now: string) {
    // preflight already_linked
    const existsActive = this.rows.find(
      (r) =>
        r.isActive &&
        r.organizationId === input.organizationId &&
        r.poweronCustomerId === input.poweronCustomerId &&
        r.qboCompanyFingerprint === input.qboCompanyFingerprint &&
        r.qboEnvironment === input.qboEnvironment,
    )
    if (existsActive) throw new QboCustomerMappingConflictError('already_linked')
    // preflight qbo_customer_claimed
    const claimed = this.rows.find(
      (r) =>
        r.isActive &&
        r.organizationId === input.organizationId &&
        r.qboCustomerId === input.qboCustomerId &&
        r.qboCompanyFingerprint === input.qboCompanyFingerprint &&
        r.qboEnvironment === input.qboEnvironment &&
        r.poweronCustomerId !== input.poweronCustomerId,
    )
    if (claimed) throw new QboCustomerMappingConflictError('qbo_customer_claimed')
    if (this.insertShouldThrow) throw this.insertShouldThrow
    this.seq += 1
    const row: FakeRow = {
      id: `row-${this.seq}`,
      organizationId: input.organizationId,
      poweronCustomerId: input.poweronCustomerId,
      qboCustomerId: input.qboCustomerId,
      qboCompanyFingerprint: input.qboCompanyFingerprint,
      qboEnvironment: input.qboEnvironment,
      linkOrigin: input.linkOrigin,
      qboDisplayName: input.qboDisplayName,
      isActive: true,
      unlinkedAt: null,
      unlinkedByUserId: null,
      linkedByUserId: input.linkedByUserId,
      createdAt: now,
      updatedAt: now,
    }
    this.rows.push(row)
    this.insertedScopes.push({ ...input })
    return row
  }
  async deactivateMapping(scope: any, unlinkedByUserId: string | null, now: string) {
    this.deactivatedScopes.push({ ...scope, unlinkedByUserId, now })
    const row = this.rows.find(
      (r) =>
        r.isActive &&
        r.organizationId === scope.organizationId &&
        r.poweronCustomerId === scope.poweronCustomerId &&
        r.qboCompanyFingerprint === scope.qboCompanyFingerprint &&
        r.qboEnvironment === scope.qboEnvironment,
    )
    if (row) {
      row.isActive = false
      row.unlinkedAt = now
      row.unlinkedByUserId = unlinkedByUserId
    }
  }
}

// ── FakeIdentityRepo (in-memory canonical PowerOn customer identity) ──────────

/**
 * QBO-4A.6: the canonical identity authority is relationship_accounts.id scoped by
 * org_id. This fake mirrors the Supabase adapter (qboCustomerIdentityRepo): a row
 * for (id, orgId) is canonical; anything else returns null (rejected as not
 * canonical). It is NOT format-based — 'gc…' / 'import_gc…' / UUIDs are all valid
 * canonical ids when they exist in the right org.
 */
class FakeIdentityRepo {
  rows: { id: string; orgId: string; company: string | null; contact: string | null }[] = []
  add(id: string, orgId: string, company: string | null = null, contact: string | null = null) {
    this.rows.push({ id, orgId, company, contact })
  }
  async loadIdentity(organizationId: string, customerId: string) {
    const r = this.rows.find((x) => x.id === customerId && x.orgId === organizationId)
    if (!r) return null
    return { id: r.id, company: r.company, contact: r.contact }
  }
}

// ── Handler-level tests via vi.mock of the auth bootstrap ────────────────────

const { authState } = vi.hoisted(() => ({
  authState: {
    ctxResult: null as any,
    scopeResult: null as any,
  },
}))

vi.mock('../../../../netlify/functions/quickbooks/qboCustomerAuth', () => {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  }
  return {
    CORS_HEADERS,
    corsPreflight: () => ({ statusCode: 200, headers: CORS_HEADERS, body: '' }),
    jsonResponse: (statusCode: number, payload: unknown) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) }),
    resolveCustomerApiContext: async () => authState.ctxResult,
    resolveQboCompanyScope: async () => authState.scopeResult,
    mappingScope: (ctx: any, scope: any, poweronCustomerId: string) => ({
      organizationId: ctx.orgId,
      poweronCustomerId,
      qboCompanyFingerprint: scope.fingerprint,
      qboEnvironment: scope.environment,
    }),
  }
})

// Import handlers AFTER mock is registered.
const { handler: searchHandler } = await import('../../../../netlify/functions/quickbooks/qbo-customer-search')
const { handler: mappingHandler } = await import('../../../../netlify/functions/quickbooks/qbo-customer-mapping')
const { handler: linkHandler } = await import('../../../../netlify/functions/quickbooks/qbo-customer-link')
const { handler: createHandler } = await import('../../../../netlify/functions/quickbooks/qbo-customer-create')
const { handler: unlinkHandler } = await import('../../../../netlify/functions/quickbooks/qbo-customer-unlink')

const ORG = '22222222-2222-4222-8222-222222222222'
const FINGERPRINT_A = 'fp-company-A'
const FINGERPRINT_B = 'fp-company-B'

function ctxWith(repo: FakeMappingRepo, fetch: FetchImpl, orgId = ORG, identityRepo?: FakeIdentityRepo) {
  // Default: VALID_UUID is a canonical PowerOn customer for orgId (mirrors the live
  // relationship_accounts row). Scenarios that need a different/cross-org/absent
  // identity pass an explicit identityRepo.
  const idRepo = identityRepo ?? new FakeIdentityRepo()
  if (!identityRepo) idRepo.add(VALID_UUID, orgId, 'Acme Corp', null)
  return {
    ok: true,
    ctx: {
      user: { id: 'user-1' },
      orgId,
      role: 'owner',
      svc: {},
      config: {},
      encKey: Buffer.alloc(32),
      connectionRepo: {},
      mappingRepo: repo,
      identityRepo: idRepo,
      fetchImpl: fetch,
      now: new Date('2026-08-19T12:00:00Z'),
    },
  }
}
function scopeWith(fingerprint = FINGERPRINT_A, environment: 'sandbox' | 'production' = 'sandbox') {
  return { ok: true, scope: { bearer: BEARER, fingerprint, environment } }
}

function eventGet(qs: Record<string, string> = {}) {
  return { httpMethod: 'GET', headers: { authorization: 'Bearer t' }, queryStringParameters: qs }
}
function eventPost(body: unknown) {
  return { httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body) }
}
function bodyOf(r: any): any {
  return typeof r.body === 'string' ? JSON.parse(r.body) : r.body
}

beforeEach(() => {
  authState.ctxResult = null
  authState.scopeResult = null
})

describe('QBO-4A.3 handler scenarios', () => {
  it('scenario 1: auth required — no auth context => 401', async () => {
    authState.ctxResult = { ok: false, response: { statusCode: 401, headers: {}, body: '{"error":"Authentication required."}' } }
    const r = await searchHandler(eventGet({ q: 'x' }))
    expect(r.statusCode).toBe(401)
  })

  it('scenario 2: server derives org — body organizationId never overrides the RLS-resolved org', async () => {
    const repo = new FakeMappingRepo()
    const { fetch } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { Customer: { Id: '1', DisplayName: 'A', Active: true } } }))
    authState.ctxResult = ctxWith(repo, fetch as any, ORG)
    authState.scopeResult = scopeWith(FINGERPRINT_A)
    // Attacker tries to inject organizationId + realmId + fingerprint in the body.
    await linkHandler(eventPost({ poweronCustomerId: VALID_UUID, qboCustomerId: '1', organizationId: 'attacker-org', realmId: 'evil', qboCompanyFingerprint: 'evil' }))
    // The persisted mapping uses the SERVER-resolved org + fingerprint, never the body.
    expect(repo.insertedScopes).toHaveLength(1)
    expect(repo.insertedScopes[0].organizationId).toBe(ORG)
    expect(repo.insertedScopes[0].qboCompanyFingerprint).toBe(FINGERPRINT_A)
  })

  it('scenario 5: search result sanitization — no SyncToken/balance/realmId/fingerprint/tokens (also 7)', async () => {
    const { fetch } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { QueryResponse: { Customer: [{ Id: '1', DisplayName: 'A', Active: true, SyncToken: '9', Balance: 1000, realmId: 'secret' }] } } }))
    authState.ctxResult = ctxWith(new FakeMappingRepo(), fetch as any)
    authState.scopeResult = scopeWith()
    const r = await searchHandler(eventGet({ q: 'A' }))
    expect(r.statusCode).toBe(200)
    const body = bodyOf(r)
    expect(body.customers).toHaveLength(1)
    const keys = Object.keys(body.customers[0]).sort()
    expect(keys).toEqual(['active', 'companyName', 'displayName', 'email', 'id', 'phone'])
    expect(JSON.stringify(body)).not.toMatch(/SyncToken|Balance|realmId|fingerprint|accessToken/i)
  })

  it('scenario 6: inactive customer marked active:false', async () => {
    const { fetch } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { QueryResponse: { Customer: [{ Id: '2', DisplayName: 'Old', Active: false }] } } }))
    authState.ctxResult = ctxWith(new FakeMappingRepo(), fetch as any)
    authState.scopeResult = scopeWith()
    const r = await searchHandler(eventGet({ q: 'Old' }))
    expect(bodyOf(r).customers[0].active).toBe(false)
  })

  it('scenario 7: mapping/link/create responses never expose realmId/fingerprint/tokens', async () => {
    const repo = new FakeMappingRepo()
    const { fetch } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { Customer: { Id: '5', DisplayName: 'C', Active: true } } }))
    authState.ctxResult = ctxWith(repo, fetch as any)
    authState.scopeResult = scopeWith()
    const r = await linkHandler(eventPost({ poweronCustomerId: VALID_UUID, qboCustomerId: '5' }))
    const body = bodyOf(r)
    expect(r.statusCode).toBe(200)
    expect(JSON.stringify(body)).not.toMatch(/realmId|fingerprint|accessToken|refreshToken|SyncToken/i)
    expect(body.linked).toBe(true)
    expect(body.customer.id).toBe('5')
    expect(body.linkOrigin).toBe('linked')
  })

  it('scenario 9: canonical identity required — link rejects a poweronCustomerId that is not a relationship_accounts row for this org (400)', async () => {
    // 'not-a-uuid' is a valid SHAPE (non-empty, bounded, no control chars) but is NOT a
    // canonical PowerOn customer for ORG (the default identity repo only contains
    // VALID_UUID). assertCanonicalPowerOnCustomerId rejects it with 400 — NOT by format.
    authState.ctxResult = ctxWith(new FakeMappingRepo(), (() => fakeRes({ ok: true, status: 200, body: {} })) as any)
    authState.scopeResult = scopeWith()
    const r = await linkHandler(eventPost({ poweronCustomerId: 'not-a-uuid', qboCustomerId: '5' }))
    expect(r.statusCode).toBe(400)
  })

  it('scenario 10: a gc… id that is not a canonical relationship_accounts row is rejected (400) — format is never the authority', async () => {
    // 'gc123456' is a valid canonical-id SHAPE, but it is not in the org's
    // relationship_accounts (the default identity repo only contains VALID_UUID), so
    // the org-scoped existence check rejects it. A REAL 'gc…' id (in the repo) is
    // accepted — see scenario 10b. This proves the authority is existence, not format.
    authState.ctxResult = ctxWith(new FakeMappingRepo(), (() => fakeRes({ ok: true, status: 200, body: {} })) as any)
    authState.scopeResult = scopeWith()
    const r = await createHandler(eventPost({ poweronCustomerId: 'gc123456', displayName: 'X' }))
    expect(r.statusCode).toBe(400)
  })

  it('scenario 10b: a REAL canonical TEXT id (gc…) that exists in relationship_accounts for this org is ACCEPTED — link works', async () => {
    const repo = new FakeMappingRepo()
    const idRepo = new FakeIdentityRepo()
    idRepo.add('gc2', ORG, 'Hernandez Construction', null)
    const { fetch } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { Customer: { Id: '5', DisplayName: 'C', Active: true } } }))
    authState.ctxResult = ctxWith(repo, fetch as any, ORG, idRepo)
    authState.scopeResult = scopeWith()
    const r = await linkHandler(eventPost({ poweronCustomerId: 'gc2', qboCustomerId: '5' }))
    expect(r.statusCode).toBe(200)
    expect(repo.insertedScopes[0].poweronCustomerId).toBe('gc2')
  })

  it('scenario 10c: a customer NAME (valid shape, not a relationship_accounts row) is rejected (400)', async () => {
    // 'Hernandez Construction' is a valid shape but is not a canonical id (the owner
    // must Resolve Customer to a real relationship_accounts.id first). The server
    // existence check rejects it — never the format check.
    authState.ctxResult = ctxWith(new FakeMappingRepo(), (() => fakeRes({ ok: true, status: 200, body: {} })) as any)
    authState.scopeResult = scopeWith()
    const r = await linkHandler(eventPost({ poweronCustomerId: 'Hernandez Construction', qboCustomerId: '5' }))
    expect(r.statusCode).toBe(400)
  })

  it('scenario 10d: cross-org rejected — a real canonical id belonging to a DIFFERENT org is rejected (400)', async () => {
    // 'gc99' is a real relationship_accounts row, but in ORG_OTHER — not the
    // authenticated org. The org-scoped existence check returns null => 400. This is
    // the tenant-isolation boundary; the browser cannot override the org.
    const ORG_OTHER = '44444444-4444-4444-8444-444444444444'
    const idRepo = new FakeIdentityRepo()
    idRepo.add('gc99', ORG_OTHER, 'Other Org Customer', null)
    authState.ctxResult = ctxWith(new FakeMappingRepo(), (() => fakeRes({ ok: true, status: 200, body: {} })) as any, ORG, idRepo)
    authState.scopeResult = scopeWith()
    const r = await linkHandler(eventPost({ poweronCustomerId: 'gc99', qboCustomerId: '5' }))
    expect(r.statusCode).toBe(400)
  })

  it('scenario 11: link verifies the QBO customer BEFORE persisting the mapping', async () => {
    const repo = new FakeMappingRepo()
    let readHappened = false
    let insertBeforeRead = false
    const { fetch } = recordingFetch((url) => {
      if (/\/customer\/5(\?|$)/.test(url)) readHappened = true
      if (!readHappened && repo.insertedScopes.length > 0) insertBeforeRead = true
      return fakeRes({ ok: true, status: 200, body: { Customer: { Id: '5', DisplayName: 'C', Active: true } } })
    })
    authState.ctxResult = ctxWith(repo, fetch as any)
    authState.scopeResult = scopeWith()
    await linkHandler(eventPost({ poweronCustomerId: VALID_UUID, qboCustomerId: '5' }))
    expect(readHappened).toBe(true)
    expect(insertBeforeRead).toBe(false)
    expect(repo.insertedScopes).toHaveLength(1)
  })

  it('scenario 12: same-link is idempotent — returns 200 with no re-persist, no QBO read', async () => {
    const repo = new FakeMappingRepo()
    // Pre-existing active mapping to qboCustomerId '5'.
    repo.rows.push({
      id: 'row-0', organizationId: ORG, poweronCustomerId: VALID_UUID, qboCustomerId: '5',
      qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox', linkOrigin: 'linked',
      qboDisplayName: 'C', isActive: true, unlinkedAt: null, unlinkedByUserId: null, linkedByUserId: 'user-1',
      createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
    })
    const { fetch, calls } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { Customer: { Id: '5', DisplayName: 'C', Active: true } } }))
    authState.ctxResult = ctxWith(repo, fetch as any)
    authState.scopeResult = scopeWith()
    const r = await linkHandler(eventPost({ poweronCustomerId: VALID_UUID, qboCustomerId: '5' }))
    expect(r.statusCode).toBe(200)
    expect(bodyOf(r).customer.id).toBe('5')
    // No QBO read, no new mapping insert.
    expect(calls).toHaveLength(0)
    expect(repo.insertedScopes).toHaveLength(0)
  })

  it('scenario 13: conflicting PowerOn mapping (already linked to a different QBO customer) => 409, no QBO read', async () => {
    const repo = new FakeMappingRepo()
    repo.rows.push({
      id: 'row-0', organizationId: ORG, poweronCustomerId: VALID_UUID, qboCustomerId: '5',
      qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox', linkOrigin: 'linked',
      qboDisplayName: 'C', isActive: true, unlinkedAt: null, unlinkedByUserId: null, linkedByUserId: 'user-1',
      createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
    })
    const { fetch, calls } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { Customer: { Id: '9', DisplayName: 'C', Active: true } } }))
    authState.ctxResult = ctxWith(repo, fetch as any)
    authState.scopeResult = scopeWith()
    const r = await linkHandler(eventPost({ poweronCustomerId: VALID_UUID, qboCustomerId: '9' }))
    expect(r.statusCode).toBe(409)
    // No QBO read happened (we rejected before verifying the customer).
    expect(calls).toHaveLength(0)
  })

  it('scenario 14: QBO customer claimed by another PowerOn customer => 409', async () => {
    const repo = new FakeMappingRepo()
    // Another PowerOn customer already claims qboCustomerId '5' in the same company/env.
    repo.rows.push({
      id: 'row-0', organizationId: ORG, poweronCustomerId: '33333333-3333-4333-8333-333333333333', qboCustomerId: '5',
      qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox', linkOrigin: 'linked',
      qboDisplayName: 'C', isActive: true, unlinkedAt: null, unlinkedByUserId: null, linkedByUserId: 'user-1',
      createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
    })
    const { fetch } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { Customer: { Id: '5', DisplayName: 'C', Active: true } } }))
    authState.ctxResult = ctxWith(repo, fetch as any)
    authState.scopeResult = scopeWith()
    const r = await linkHandler(eventPost({ poweronCustomerId: VALID_UUID, qboCustomerId: '5' }))
    expect(r.statusCode).toBe(409)
  })

  it('scenario 15: explicit create works — 200 linked created', async () => {
    const repo = new FakeMappingRepo()
    const { fetch } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { Customer: { Id: '77', DisplayName: 'New Co', Active: true } } }))
    authState.ctxResult = ctxWith(repo, fetch as any)
    authState.scopeResult = scopeWith()
    const r = await createHandler(eventPost({ poweronCustomerId: VALID_UUID, displayName: 'New Co', companyName: 'New Co LLC' }))
    expect(r.statusCode).toBe(200)
    const body = bodyOf(r)
    expect(body).toMatchObject({ linked: true, linkOrigin: 'created' })
    expect(body.customer.id).toBe('77')
    expect(repo.insertedScopes[0].linkOrigin).toBe('created')
    // Provenance snapshot stored.
    expect(repo.insertedScopes[0].poweronCustomerSnapshot).toMatchObject({ source: 'create', displayName: 'New Co' })
  })

  it('scenario 17: already-mapped does NOT create another QBO customer — 409 with no QBO POST', async () => {
    const repo = new FakeMappingRepo()
    repo.rows.push({
      id: 'row-0', organizationId: ORG, poweronCustomerId: VALID_UUID, qboCustomerId: '5',
      qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox', linkOrigin: 'linked',
      qboDisplayName: 'C', isActive: true, unlinkedAt: null, unlinkedByUserId: null, linkedByUserId: 'user-1',
      createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
    })
    const { fetch, calls } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { Customer: { Id: '99', DisplayName: 'X', Active: true } } }))
    authState.ctxResult = ctxWith(repo, fetch as any)
    authState.scopeResult = scopeWith()
    const r = await createHandler(eventPost({ poweronCustomerId: VALID_UUID, displayName: 'X' }))
    expect(r.statusCode).toBe(409)
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('scenario 18: 6240 duplicate-name is sanitized (422) with no auto-suffix/merge/retry', async () => {
    const repo = new FakeMappingRepo()
    const { fetch, calls } = recordingFetch(() => fakeRes({ ok: false, status: 400, body: { Fault: { Error: [{ Message: 'Duplicate Name Exists Error', Detail: 'x', code: '6240' }], type: 'ValidationFault' } } }))
    authState.ctxResult = ctxWith(repo, fetch as any)
    authState.scopeResult = scopeWith()
    const r = await createHandler(eventPost({ poweronCustomerId: VALID_UUID, displayName: 'Dup' }))
    expect(r.statusCode).toBe(422)
    expect(bodyOf(r).category).toBe('duplicate_name')
    // Exactly one POST — no retry, no second create with a suffixed name.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    expect(repo.insertedScopes).toHaveLength(0)
  })

  it('scenario 19: QBO success + mapping failure is recoverable + no blind retry (500 with safe provider identity)', async () => {
    const repo = new FakeMappingRepo()
    repo.insertShouldThrow = new Error('DB connection lost') // mapping persist fails AFTER create
    const { fetch, calls } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { Customer: { Id: '77', DisplayName: 'Created', Active: true } } }))
    authState.ctxResult = ctxWith(repo, fetch as any)
    authState.scopeResult = scopeWith()
    const r = await createHandler(eventPost({ poweronCustomerId: VALID_UUID, displayName: 'Created' }))
    expect(r.statusCode).toBe(500)
    const body = bodyOf(r)
    expect(body.recoverable).toBe(true)
    expect(body.qboCustomer).toEqual({ id: '77', displayName: 'Created' })
    // The provider create happened exactly once — no blind retry.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('scenario 19b: QBO success + mapping race (already_linked) is recoverable + no blind retry (409)', async () => {
    const repo = new FakeMappingRepo()
    repo.insertShouldThrow = new QboCustomerMappingConflictError('already_linked')
    const { fetch, calls } = recordingFetch(() => fakeRes({ ok: true, status: 200, body: { Customer: { Id: '77', DisplayName: 'Created', Active: true } } }))
    authState.ctxResult = ctxWith(repo, fetch as any)
    authState.scopeResult = scopeWith()
    const r = await createHandler(eventPost({ poweronCustomerId: VALID_UUID, displayName: 'Created' }))
    expect(r.statusCode).toBe(409)
    expect(bodyOf(r).qboCustomer.id).toBe('77')
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('scenario 20+21: unlink retains history + stamps consistent state fields', async () => {
    const repo = new FakeMappingRepo()
    repo.rows.push({
      id: 'row-0', organizationId: ORG, poweronCustomerId: VALID_UUID, qboCustomerId: '5',
      qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox', linkOrigin: 'linked',
      qboDisplayName: 'C', isActive: true, unlinkedAt: null, unlinkedByUserId: null, linkedByUserId: 'user-1',
      createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
    })
    authState.ctxResult = ctxWith(repo, (() => fakeRes({ ok: true, status: 200, body: {} })) as any)
    authState.scopeResult = scopeWith()
    const r = await unlinkHandler(eventPost({ poweronCustomerId: VALID_UUID }))
    expect(r.statusCode).toBe(200)
    expect(bodyOf(r).linked).toBe(false)
    // The row is RETAINED (not deleted) with is_active=false + unlinked_at + unlinked_by.
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0].isActive).toBe(false)
    expect(repo.rows[0].unlinkedAt).toBe('2026-08-19T12:00:00.000Z')
    expect(repo.rows[0].unlinkedByUserId).toBe('user-1')
    // Subsequent lookup finds no active mapping.
    const found = await repo.loadActiveMapping({ organizationId: ORG, poweronCustomerId: VALID_UUID, qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox' })
    expect(found).toBeNull()
  })

  it('scenario 20b: unlinking when not linked => 409 (no row touched)', async () => {
    const repo = new FakeMappingRepo()
    authState.ctxResult = ctxWith(repo, (() => fakeRes({ ok: true, status: 200, body: {} })) as any)
    authState.scopeResult = scopeWith()
    const r = await unlinkHandler(eventPost({ poweronCustomerId: VALID_UUID }))
    expect(r.statusCode).toBe(409)
    expect(repo.deactivatedScopes).toHaveLength(0)
  })

  it('scenario 4b: current-mapping endpoint returns {linked:false} when not connected', async () => {
    authState.ctxResult = ctxWith(new FakeMappingRepo(), (() => fakeRes({ ok: true, status: 200, body: {} })) as any)
    authState.scopeResult = { ok: false, response: { statusCode: 422, headers: {}, body: '{"error":"not connected"}' } }
    const r = await mappingHandler(eventGet({ poweronCustomerId: VALID_UUID }))
    expect(r.statusCode).toBe(200)
    expect(bodyOf(r).linked).toBe(false)
  })

  it('scenario 4c: current-mapping endpoint returns the active mapping when linked', async () => {
    const repo = new FakeMappingRepo()
    repo.rows.push({
      id: 'row-0', organizationId: ORG, poweronCustomerId: VALID_UUID, qboCustomerId: '5',
      qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox', linkOrigin: 'linked',
      qboDisplayName: 'C', isActive: true, unlinkedAt: null, unlinkedByUserId: null, linkedByUserId: 'user-1',
      createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
    })
    authState.ctxResult = ctxWith(repo, (() => fakeRes({ ok: true, status: 200, body: {} })) as any)
    authState.scopeResult = scopeWith()
    const r = await mappingHandler(eventGet({ poweronCustomerId: VALID_UUID }))
    expect(r.statusCode).toBe(200)
    expect(bodyOf(r)).toMatchObject({ linked: true, linkOrigin: 'linked' })
    expect(bodyOf(r).customer.id).toBe('5')
  })
})

// ── Tenant isolation: sandbox/prod + company A/B (scenarios 8,22,23) ───────────

describe('QBO-4A.3 tenant isolation (scenarios 8,22,23)', () => {
  it('scenario 8 + 22: a sandbox mapping is NOT found under production (same fingerprint, different env)', async () => {
    const repo = new FakeMappingRepo()
    await repo.insertMapping(
      { organizationId: ORG, poweronCustomerId: VALID_UUID, qboCustomerId: '5', qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox', linkOrigin: 'linked', qboDisplayName: 'C', poweronCustomerSnapshot: null, linkedByUserId: 'u' },
      '2026-08-19T00:00:00Z',
    )
    const foundProd = await repo.loadActiveMapping({ organizationId: ORG, poweronCustomerId: VALID_UUID, qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'production' })
    expect(foundProd).toBeNull()
    const foundSandbox = await repo.loadActiveMapping({ organizationId: ORG, poweronCustomerId: VALID_UUID, qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox' })
    expect(foundSandbox?.qboCustomerId).toBe('5')
  })

  it('scenario 23: a Company-A mapping is NOT found under Company B (different fingerprint)', async () => {
    const repo = new FakeMappingRepo()
    await repo.insertMapping(
      { organizationId: ORG, poweronCustomerId: VALID_UUID, qboCustomerId: '5', qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox', linkOrigin: 'linked', qboDisplayName: 'C', poweronCustomerSnapshot: null, linkedByUserId: 'u' },
      '2026-08-19T00:00:00Z',
    )
    const foundB = await repo.loadActiveMapping({ organizationId: ORG, poweronCustomerId: VALID_UUID, qboCompanyFingerprint: FINGERPRINT_B, qboEnvironment: 'sandbox' })
    expect(foundB).toBeNull()
  })

  it('scenario 22b: relink after unlink establishes a NEW active row (retained history)', async () => {
    const repo = new FakeMappingRepo()
    await repo.insertMapping(
      { organizationId: ORG, poweronCustomerId: VALID_UUID, qboCustomerId: '5', qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox', linkOrigin: 'linked', qboDisplayName: 'C', poweronCustomerSnapshot: null, linkedByUserId: 'u' },
      '2026-08-19T00:00:00Z',
    )
    await repo.deactivateMapping({ organizationId: ORG, poweronCustomerId: VALID_UUID, qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox' }, 'u', '2026-08-19T01:00:00Z')
    // Relink to a different QBO customer — a NEW active row, old one retained inactive.
    await repo.insertMapping(
      { organizationId: ORG, poweronCustomerId: VALID_UUID, qboCustomerId: '6', qboCompanyFingerprint: FINGERPRINT_A, qboEnvironment: 'sandbox', linkOrigin: 'linked', qboDisplayName: 'D', poweronCustomerSnapshot: null, linkedByUserId: 'u' },
      '2026-08-19T02:00:00Z',
    )
    expect(repo.rows).toHaveLength(2)
    expect(repo.rows.filter((r) => r.isActive)).toHaveLength(1)
    expect(repo.rows.find((r) => r.isActive)?.qboCustomerId).toBe('6')
  })
})

// ── Source-scan firewall / boundary scenarios (16,24,25,26,27) ───────────────

describe('QBO-4A.3 source-scan boundary (scenarios 16,24,25,26,27)', () => {
  const ENDPOINTS = [
    'netlify/functions/quickbooks/qbo-customer-search.ts',
    'netlify/functions/quickbooks/qbo-customer-mapping.ts',
    'netlify/functions/quickbooks/qbo-customer-link.ts',
    'netlify/functions/quickbooks/qbo-customer-create.ts',
    'netlify/functions/quickbooks/qbo-customer-unlink.ts',
    'netlify/functions/quickbooks/qboCustomerAuth.ts',
  ]

  it('scenario 16: search never auto-creates — search handler does not import/ call createCustomer', () => {
    const search = read('netlify/functions/quickbooks/qbo-customer-search.ts')
    expect(search).not.toMatch(/createCustomer|createCustomerMapping/)
  })

  it('scenario 24: no customer endpoint imports a financial-authority / billing-draft module', () => {
    const FORBIDDEN = /billing-draft|canonicalCash|collectedRevenue|serviceBalance|unpaidServiceEligibility|financialTimeline|cashFlowAnalyzer|invoiceDraft|kpiTimeline|servicePaymentLedger|businessGoalTruth|quickbooksImportService/i
    for (const f of ENDPOINTS) {
      const src = read(f)
      const importLines = src.match(/^import[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []
      for (const line of importLines) {
        expect(line, `${f} must not import financial authority`).not.toMatch(FORBIDDEN)
      }
    }
  })

  it('scenario 25+26: Save Draft / Approve work with NO mapping — billing/invoice-draft code imports only the PRESENTATIONAL mapping UI (no server store/repo, no network call)', () => {
    function walk(dir: string, out: string[] = []): string[] {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name === '__tests__') continue
        const p = join(dir, ent.name)
        if (ent.isDirectory()) walk(p, out)
        else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\./.test(ent.name)) out.push(p)
      }
      return out
    }
    const dirs = ['src/features/billing-draft', 'src/features/invoice-drafts']
    // QBO-4A.4 / QBO-4A.6 SANCTIONED UPDATE: billing-draft MAY import the
    // presentational, non-gating QuickBooksCustomerStatus + sanitized types +
    // the browser canonical-directory projection (useCanonicalCustomerDirectory /
    // isCanonicalCustomerId) from quickbooks-customer-mapping (informational /
    // identity-state only — never blocks Save Draft / Approve). It MUST NOT
    // import the SERVER mapping store/repo (server-only) and MUST NOT make a
    // direct fetch( network call (QBO-LOG-22 firewall).
    const bannedServer = /quickbooksCustomerMappingStore|qboCustomerMappingRepo|qboCustomerAuth|qboAccountingClient|qboCustomerMappingStore/
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      for (const f of walk(dir)) {
        const src = readFileSync(f, 'utf8')
        expect(src, `${f} must not import the server-side mapping store/repo/auth`).not.toMatch(bannedServer)
        // Permitted quickbooks-customer-mapping imports: presentational components,
        // sanitized types, and the RLS-scoped canonical directory projection.
        const qbImports = src.match(/from\s+['"]@?\/?features\/quickbooks-customer-mapping[^'"]*['"]/g) ?? []
        for (const imp of qbImports) {
          expect(imp, `${f} permitted mapping import only`).toMatch(
            /components\/(QuickBooksCustomerStatus|LinkQuickBooksCustomerModal|ResolvePowerOnCustomerModal)|qboCustomerMappingTypes|useCanonicalCustomerDirectory|resolvePowerOnCustomerDirectory/,
          )
        }
        // No direct network call in billing-draft source (codeOnly-style strip of
        // block comments; line comments are left but assert on the whole file).
        const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
        expect(code, `${f} must not call fetch directly`).not.toMatch(/\bfetch\s*\(/)
      }
    }
  })

  it('scenario 27: no Send to QuickBooks / Estimate / Invoice / Payment API introduced', () => {
    // No new netlify function for estimate/invoice/payment/send.
    const fnDir = join(ROOT, 'netlify/functions')
    const quickbooksFns = readdirSync(join(fnDir, 'quickbooks')).filter((f) => f.endsWith('.ts'))
    const topLevelFns = readdirSync(fnDir).filter((f) => f.startsWith('qbo-') && f.endsWith('.ts'))
    const all = [...quickbooksFns, ...topLevelFns]
    for (const f of all) {
      expect(f).not.toMatch(/estimate|invoice|payment|send/i)
    }
    // The customer endpoints never reference Send to QuickBooks / Estimate / Invoice / Payment writes.
    for (const f of ENDPOINTS) {
      const code = read(f).replace(/\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
      expect(code, `${f}`).not.toMatch(/Send to QuickBooks|sendToQuickBooks|estimate.*api|invoice.*api|payment.*api/i)
    }
  })

  it('scenario 27b: browser-facing customer UI is confined to the quickbooks-customer-mapping feature and references no Send/Estimate/Invoice/Payment writes', () => {
    // QBO-4A.4 SANCTIONED UPDATE: the browser UI now exists (the owner customer
    // link/create experience). Any src file that references the customer
    // endpoints MUST live under src/features/quickbooks-customer-mapping/ (the
    // single sanctioned network boundary) and MUST NOT introduce Send to
    // QuickBooks / Estimate / Invoice / Payment creation.
    function walk(dir: string, out: string[] = []): string[] {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name === '__tests__') continue
        const p = join(dir, ent.name)
        if (ent.isDirectory()) walk(p, out)
        else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\./.test(ent.name)) out.push(p)
      }
      return out
    }
    const endpointRe = /qbo-customer-search|qbo-customer-link|qbo-customer-create|qbo-customer-mapping|qbo-customer-unlink/
    const featureRoot = join(ROOT, 'src', 'features', 'quickbooks-customer-mapping')
    for (const f of walk(join(ROOT, 'src'))) {
      const src = readFileSync(f, 'utf8')
      if (!endpointRe.test(src)) continue
      // The ONLY src tree permitted to reference the customer endpoints is the
      // sanctioned quickbooks-customer-mapping feature.
      expect(f, `${f} must live under quickbooks-customer-mapping`).toContain(join('src', 'features', 'quickbooks-customer-mapping'))
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
      expect(code, `${f} must not introduce Send/Estimate/Invoice/Payment writes`).not.toMatch(/Send to QuickBooks|sendToQuickBooks|createQboInvoice|createEstimate|sendInvoice|payment.*api/i)
    }
    // The sanctioned feature root exists.
    expect(existsSync(featureRoot)).toBe(true)
  })
})