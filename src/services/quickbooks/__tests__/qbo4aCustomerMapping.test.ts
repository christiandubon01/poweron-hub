/**
 * QBO-4A.2 — Customer mapping persistence + security foundation.
 *
 * Pure unit tests for the server-only store (quickbooksCustomerMappingStore),
 * the company fingerprint helper (quickbooksCompanyFingerprint), and the shared
 * UUID utility (lib/uuid, still used for organization_id). No Supabase, no network —
 * persistence is an in-memory fake implementing QboCustomerMappingRepo.
 *
 * Covered guarantees (QBO-4A.2 tasks 5–7, corrected by QBO-4A.6):
 *  - poweron_customer_id is the canonical PowerOn customer identity =
 *    relationship_accounts.id (TEXT). The STORE enforces only the SHAPE
 *    (non-empty, ≤128, no control chars); the org-scoped EXISTENCE authority is the
 *    SERVER boundary (assertCanonicalPowerOnCustomerId), exercised in
 *    qbo4aCustomerApi.test.ts. A valid TEXT id ('gc…' / 'import_gc…') is ACCEPTED by
 *    the store; a name is a valid shape and is only rejected by the server lookup.
 *  - organization_id is STILL a real UUID (organizations.id) — isUuid remains its guard.
 *  - one ACTIVE mapping per (org, poweron customer, company fingerprint, env).
 *  - a QBO customer cannot be claimed by two PowerOn customers in the same scope.
 *  - sandbox vs production scopes are distinct (no reuse across environments).
 *  - the company fingerprint is deterministic, differs per realmId, and never
 *    exposes the raw realmId.
 *  - unlink is retained-history (is_active flips to false; the row survives).
 *  - sanitizeCustomerMapping leaks no realmId / fingerprint / tokens / envelopes.
 *  - link_origin is 'linked' | 'created' only (CHECK enforced at the DB; the
 *    store rejects anything else before persistence).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { isUuid } from '@/lib/uuid'
import {
  assertPowerOnCustomerIdShape,
  POWERON_CUSTOMER_ID_MAX_LENGTH,
  createCustomerMapping,
  loadCurrentCustomerMapping,
  QboCustomerMappingIdentityError,
  sanitizeCustomerMapping,
  unlinkCustomerMapping,
  type QboCustomerMappingInput,
  type QboCustomerMappingRepo,
  type QboCustomerMappingRow,
  type QboCustomerMappingScope,
} from '../quickbooksCustomerMappingStore'
import { computeQboCompanyFingerprint } from '../quickbooksCompanyFingerprint'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CUST_A = '11111111-1111-4111-8111-111111111111'
const CUST_B = '22222222-2222-4222-8222-222222222222'
// Canonical PowerOn customer ids are TEXT (relationship_accounts.id). Real legacy
// ids look like these — they are the legitimate canonical identity, NOT temporary.
const CUST_GC = 'gc2'
const CUST_IMPORT_GC = 'import_gc_7'
const NOW = new Date('2026-08-19T12:00:00Z')
const FP_SBX = computeQboCompanyFingerprint('realm-sandbox-123')
const FP_PROD = computeQboCompanyFingerprint('realm-prod-456')

function makeInput(overrides: Partial<QboCustomerMappingInput> = {}): QboCustomerMappingInput {
  return {
    organizationId: ORG,
    poweronCustomerId: CUST_A,
    qboCustomerId: 'qbo-55',
    qboCompanyFingerprint: FP_SBX,
    qboEnvironment: 'sandbox',
    linkOrigin: 'linked',
    qboDisplayName: 'Acme Corp',
    poweronCustomerSnapshot: { name: 'Acme' },
    linkedByUserId: null,
    ...overrides,
  }
}

function makeRow(overrides: Partial<QboCustomerMappingRow> = {}): QboCustomerMappingRow {
  return {
    id: 'row-1',
    organizationId: ORG,
    poweronCustomerId: CUST_A,
    qboCustomerId: 'qbo-55',
    qboCompanyFingerprint: FP_SBX,
    qboEnvironment: 'sandbox',
    linkOrigin: 'linked',
    qboDisplayName: 'Acme Corp',
    poweronCustomerSnapshot: { name: 'Acme' },
    isActive: true,
    unlinkedAt: null,
    unlinkedByUserId: null,
    linkedByUserId: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  }
}

/**
 * In-memory fake repo. Mirrors the partial UNIQUE indexes of migration 133:
 * at most one ACTIVE row per (org, poweron customer, fp, env) AND per
 * (org, qbo customer, fp, env). insertMapping performs the same two preflight
 * checks as the Supabase adapter and throws QboCustomerMappingConflictError on
 * a collision.
 */
class FakeMappingRepo implements QboCustomerMappingRepo {
  rows: QboCustomerMappingRow[] = []
  nextId = 1

  private activeForPoweron(scope: QboCustomerMappingScope): QboCustomerMappingRow | undefined {
    return this.rows.find(
      (r) =>
        r.isActive &&
        r.organizationId === scope.organizationId &&
        r.poweronCustomerId === scope.poweronCustomerId &&
        r.qboCompanyFingerprint === scope.qboCompanyFingerprint &&
        r.qboEnvironment === scope.qboEnvironment,
    )
  }

  private activeForQbo(input: QboCustomerMappingInput): QboCustomerMappingRow | undefined {
    return this.rows.find(
      (r) =>
        r.isActive &&
        r.organizationId === input.organizationId &&
        r.qboCustomerId === input.qboCustomerId &&
        r.qboCompanyFingerprint === input.qboCompanyFingerprint &&
        r.qboEnvironment === input.qboEnvironment,
    )
  }

  async loadActiveMapping(scope: QboCustomerMappingScope): Promise<QboCustomerMappingRow | null> {
    return this.activeForPoweron(scope) ?? null
  }

  async insertMapping(input: QboCustomerMappingInput, now: string): Promise<QboCustomerMappingRow> {
    const scope: QboCustomerMappingScope = {
      organizationId: input.organizationId,
      poweronCustomerId: input.poweronCustomerId,
      qboCompanyFingerprint: input.qboCompanyFingerprint,
      qboEnvironment: input.qboEnvironment,
    }
    if (this.activeForPoweron(scope)) {
      throw new Error('ALREADY_LINKED')
    }
    const claimed = this.activeForQbo(input)
    if (claimed && claimed.poweronCustomerId !== input.poweronCustomerId) {
      throw new Error('QBO_CUSTOMER_CLAIMED')
    }
    const row: QboCustomerMappingRow = {
      id: `row-${this.nextId++}`,
      organizationId: input.organizationId,
      poweronCustomerId: input.poweronCustomerId,
      qboCustomerId: input.qboCustomerId,
      qboCompanyFingerprint: input.qboCompanyFingerprint,
      qboEnvironment: input.qboEnvironment,
      linkOrigin: input.linkOrigin,
      qboDisplayName: input.qboDisplayName,
      poweronCustomerSnapshot: input.poweronCustomerSnapshot,
      isActive: true,
      unlinkedAt: null,
      unlinkedByUserId: null,
      linkedByUserId: input.linkedByUserId,
      createdAt: now,
      updatedAt: now,
    }
    this.rows.push(row)
    return row
  }

  async deactivateMapping(scope: QboCustomerMappingScope, unlinkedByUserId: string | null, now: string): Promise<void> {
    const r = this.activeForPoweron(scope)
    if (!r) return
    r.isActive = false
    r.unlinkedAt = now
    r.unlinkedByUserId = unlinkedByUserId
    r.updatedAt = now
  }
}

// ── isUuid utility (still the organization_id guard) ──────────────────────────

describe('QBO-4A isUuid utility — still guards organization_id (a real UUID)', () => {
  it('isUuid accepts a real RFC-4122 UUID', () => {
    expect(isUuid(CUST_A)).toBe(true)
  })

  it('isUuid rejects a temporary gc+Date.now() local id', () => {
    expect(isUuid('gc1724068800000')).toBe(false)
    expect(isUuid('gc' + '1724068800000')).toBe(false)
  })

  it('isUuid rejects a customer/project name and a customer_reference string', () => {
    expect(isUuid('Acme Corp')).toBe(false)
    expect(isUuid('Underground Project')).toBe(false)
    expect(isUuid('cust:acme-001')).toBe(false)
  })

  it('isUuid rejects malformed UUIDs', () => {
    // The validator checks RFC-4128 FORMAT only (8-4-4-4-12 hex), not the
    // version nibble — a well-formed string like the all-ones UUID passes.
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true)
    // A genuinely malformed UUID (too short / wrong groups) is rejected.
    expect(isUuid('11111111-1111-4111-8111')).toBe(false)
    expect(isUuid('11111111111141118111111111111111')).toBe(false) // no dashes
    expect(isUuid('zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz')).toBe(false) // non-hex
    expect(isUuid('')).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(isUuid(undefined)).toBe(false)
    expect(isUuid(12345)).toBe(false)
  })
})

// ── Canonical TEXT identity shape guard (QBO-4A.6) ───────────────────────────

describe('QBO-4A.6 assertPowerOnCustomerIdShape — canonical TEXT identity SHAPE (not format)', () => {
  it('ACCEPTS a real legacy TEXT id (gc…/import_gc…) — these are the canonical identity', () => {
    expect(() => assertPowerOnCustomerIdShape(CUST_GC)).not.toThrow()
    expect(() => assertPowerOnCustomerIdShape(CUST_IMPORT_GC)).not.toThrow()
  })

  it('ACCEPTS an acct_… id (the relationship_accounts default shape)', () => {
    expect(() => assertPowerOnCustomerIdShape('acct_1f2e3d4c5b6a7e8f9d0c1b2a3e4f5a6b')).not.toThrow()
  })

  it('ACCEPTS a UUID — a UUID is also a valid TEXT shape (format is not the authority)', () => {
    expect(() => assertPowerOnCustomerIdShape(CUST_A)).not.toThrow()
  })

  it('does NOT reject a customer NAME on shape — names are valid shapes; the SERVER existence check rejects them', () => {
    // This is the key contract change from QBO-4A.1→4A.6: the store no longer rejects
    // names by format. 'Acme Corp' is a bounded non-empty string with no control chars,
    // so it passes the shape guard. The org-scoped relationship_accounts lookup
    // (assertCanonicalPowerOnCustomerId, exercised in qbo4aCustomerApi.test.ts) is what
    // rejects a name that is not a real relationship_accounts.id.
    expect(() => assertPowerOnCustomerIdShape('Acme Corp')).not.toThrow()
    expect(() => assertPowerOnCustomerIdShape('Hernandez Construction')).not.toThrow()
  })

  it('rejects a non-string', () => {
    expect(() => assertPowerOnCustomerIdShape(12345)).toThrow(QboCustomerMappingIdentityError)
    expect(() => assertPowerOnCustomerIdShape(null as unknown as string)).toThrow(QboCustomerMappingIdentityError)
    expect(() => assertPowerOnCustomerIdShape(undefined as unknown as string)).toThrow(QboCustomerMappingIdentityError)
  })

  it('rejects an empty / whitespace-only id', () => {
    expect(() => assertPowerOnCustomerIdShape('')).toThrow(QboCustomerMappingIdentityError)
    expect(() => assertPowerOnCustomerIdShape('   ')).toThrow(QboCustomerMappingIdentityError)
  })

  it('rejects an id exceeding the max length bound', () => {
    const tooLong = 'x'.repeat(POWERON_CUSTOMER_ID_MAX_LENGTH + 1)
    expect(() => assertPowerOnCustomerIdShape(tooLong)).toThrow(QboCustomerMappingIdentityError)
    // Exactly at the bound is allowed.
    expect(() => assertPowerOnCustomerIdShape('x'.repeat(POWERON_CUSTOMER_ID_MAX_LENGTH))).not.toThrow()
  })

  it('rejects control characters', () => {
    expect(() => assertPowerOnCustomerIdShape('gc2\n')).toThrow(QboCustomerMappingIdentityError)
    expect(() => assertPowerOnCustomerIdShape('gc\t2')).toThrow(QboCustomerMappingIdentityError)
    expect(() => assertPowerOnCustomerIdShape('gc\x002')).toThrow(QboCustomerMappingIdentityError)
  })

  it('the shape error carries the poweron_customer_id_invalid code (not the old _not_uuid code)', () => {
    try {
      assertPowerOnCustomerIdShape('')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(QboCustomerMappingIdentityError)
      expect((e as QboCustomerMappingIdentityError).code).toBe('poweron_customer_id_invalid')
    }
  })
})

// ── Company fingerprint (Task 5) ───────────────────────────────────────────────

describe('QBO-4A company fingerprint — deterministic, realm-stable, no raw realmId', () => {
  it('same realmId produces the same fingerprint (deterministic)', () => {
    expect(computeQboCompanyFingerprint('realm-123')).toBe(computeQboCompanyFingerprint('realm-123'))
  })

  it('different realmId produces a different fingerprint', () => {
    expect(computeQboCompanyFingerprint('realm-A')).not.toBe(computeQboCompanyFingerprint('realm-B'))
  })

  it('the fingerprint is the domain-separated SHA-256 (not plain sha256(realmId))', () => {
    const realm = 'realm-123'
    const plain = createHash('sha256').update(realm).digest('hex')
    expect(computeQboCompanyFingerprint(realm)).not.toBe(plain)
    // It IS the domain-prefixed hash.
    const prefixed = createHash('sha256').update('poweron-qbo-company-fingerprint-v1:' + realm).digest('hex')
    expect(computeQboCompanyFingerprint(realm)).toBe(prefixed)
  })

  it('the fingerprint output never contains the raw realmId', () => {
    const realm = 'realm-SUPER-SECRET-12345'
    const fp = computeQboCompanyFingerprint(realm)
    expect(fp).not.toContain(realm)
    expect(fp).not.toContain('SECRET')
    // 64 hex chars (sha256 hex digest).
    expect(fp).toMatch(/^[0-9a-f]{64}$/)
  })

  it('an empty realmId fails closed (no scoping key from nothing)', () => {
    expect(() => computeQboCompanyFingerprint('')).toThrow()
    expect(() => computeQboCompanyFingerprint('   ')).toThrow()
  })

  it('sandbox and production realms produce distinct fingerprints (scope separation)', () => {
    expect(FP_SBX).not.toBe(FP_PROD)
  })
})

// ── create/link validation ────────────────────────────────────────────────────

describe('QBO-4A createCustomerMapping — boundary validation', () => {
  it('ACCEPTS a canonical TEXT poweron_customer_id (gc…) — existence is the server job', async () => {
    const repo = new FakeMappingRepo()
    const row = await createCustomerMapping(repo, makeInput({ poweronCustomerId: CUST_GC }), NOW)
    expect(row.poweronCustomerId).toBe(CUST_GC)
    expect(repo.rows).toHaveLength(1)
  })

  it('ACCEPTS an import_gc… canonical TEXT poweron_customer_id', async () => {
    const repo = new FakeMappingRepo()
    const row = await createCustomerMapping(repo, makeInput({ poweronCustomerId: CUST_IMPORT_GC }), NOW)
    expect(row.poweronCustomerId).toBe(CUST_IMPORT_GC)
  })

  it('rejects a malformed poweron_customer_id (empty) before persistence', async () => {
    const repo = new FakeMappingRepo()
    await expect(createCustomerMapping(repo, makeInput({ poweronCustomerId: '' }), NOW))
      .rejects.toBeInstanceOf(QboCustomerMappingIdentityError)
    expect(repo.rows).toHaveLength(0)
  })

  it('rejects an over-length poweron_customer_id before persistence', async () => {
    const repo = new FakeMappingRepo()
    await expect(
      createCustomerMapping(repo, makeInput({ poweronCustomerId: 'x'.repeat(POWERON_CUSTOMER_ID_MAX_LENGTH + 1) }), NOW),
    ).rejects.toBeInstanceOf(QboCustomerMappingIdentityError)
    expect(repo.rows).toHaveLength(0)
  })

  it('rejects a non-UUID organization_id (organizations.id is a real UUID)', async () => {
    const repo = new FakeMappingRepo()
    await expect(createCustomerMapping(repo, makeInput({ organizationId: 'not-an-org' }), NOW))
      .rejects.toThrow(/organization_id must be a UUID/)
  })

  it('rejects an invalid qbo_environment', async () => {
    const repo = new FakeMappingRepo()
    await expect(createCustomerMapping(repo, makeInput({ qboEnvironment: 'staging' as never }), NOW))
      .rejects.toThrow(/qbo_environment must be sandbox or production/)
  })

  it('rejects an empty qbo_customer_id', async () => {
    const repo = new FakeMappingRepo()
    await expect(createCustomerMapping(repo, makeInput({ qboCustomerId: '  ' }), NOW))
      .rejects.toThrow(/qbo_customer_id is required/)
  })

  it('rejects an empty company fingerprint', async () => {
    const repo = new FakeMappingRepo()
    await expect(createCustomerMapping(repo, makeInput({ qboCompanyFingerprint: '' }), NOW))
      .rejects.toThrow(/qbo_company_fingerprint is required/)
  })

  it('persists a valid linked mapping with link_origin=linked', async () => {
    const repo = new FakeMappingRepo()
    const row = await createCustomerMapping(repo, makeInput(), NOW)
    expect(row.isActive).toBe(true)
    expect(row.linkOrigin).toBe('linked')
    expect(row.poweronCustomerId).toBe(CUST_A)
    expect(row.qboCustomerId).toBe('qbo-55')
    expect(row.createdAt).toBe(NOW.toISOString())
    expect(repo.rows).toHaveLength(1)
  })

  it('persists a created mapping with link_origin=created', async () => {
    const repo = new FakeMappingRepo()
    const row = await createCustomerMapping(repo, makeInput({ linkOrigin: 'created' }), NOW)
    expect(row.linkOrigin).toBe('created')
  })
})

// ── Duplicate prevention + scope separation ───────────────────────────────────

describe('QBO-4A duplicate prevention — one active mapping per scope', () => {
  it('refuses a second active mapping for the same PowerOn customer in the same scope', async () => {
    const repo = new FakeMappingRepo()
    await createCustomerMapping(repo, makeInput(), NOW)
    // Same poweron customer, same company/env → already linked.
    await expect(createCustomerMapping(repo, makeInput({ qboCustomerId: 'qbo-99' }), NOW))
      .rejects.toThrow(/ALREADY_LINKED/)
    expect(repo.rows).toHaveLength(1)
  })

  it('refuses to claim the same QBO customer for a different PowerOn customer in the same scope', async () => {
    const repo = new FakeMappingRepo()
    await createCustomerMapping(repo, makeInput({ poweronCustomerId: CUST_A, qboCustomerId: 'qbo-55' }), NOW)
    // Different PowerOn customer trying to claim the SAME qbo customer id.
    await expect(
      createCustomerMapping(repo, makeInput({ poweronCustomerId: CUST_B, qboCustomerId: 'qbo-55' }), NOW),
    ).rejects.toThrow(/QBO_CUSTOMER_CLAIMED/)
    expect(repo.rows).toHaveLength(1)
  })

  it('allows the same PowerOn customer to be linked in sandbox AND production (scope separation)', async () => {
    const repo = new FakeMappingRepo()
    await createCustomerMapping(repo, makeInput({ qboEnvironment: 'sandbox' }), NOW)
    await expect(
      createCustomerMapping(repo, makeInput({ qboEnvironment: 'production', qboCompanyFingerprint: FP_PROD }), NOW),
    ).resolves.toBeTruthy()
    expect(repo.rows).toHaveLength(2)
    expect(repo.rows.filter((r) => r.qboEnvironment === 'sandbox')).toHaveLength(1)
    expect(repo.rows.filter((r) => r.qboEnvironment === 'production')).toHaveLength(1)
  })

  it('allows the same PowerOn customer across two different QBO companies (fingerprint separation)', async () => {
    const repo = new FakeMappingRepo()
    const fpA = computeQboCompanyFingerprint('company-A')
    const fpB = computeQboCompanyFingerprint('company-B')
    await createCustomerMapping(repo, makeInput({ qboCompanyFingerprint: fpA }), NOW)
    await expect(
      createCustomerMapping(repo, makeInput({ qboCompanyFingerprint: fpB, qboCustomerId: 'qbo-66' }), NOW),
    ).resolves.toBeTruthy()
    expect(repo.rows).toHaveLength(2)
  })

  it('allows two different PowerOn customers to link to two different QBO customers in the same scope', async () => {
    const repo = new FakeMappingRepo()
    await createCustomerMapping(repo, makeInput({ poweronCustomerId: CUST_A, qboCustomerId: 'qbo-1' }), NOW)
    await expect(
      createCustomerMapping(repo, makeInput({ poweronCustomerId: CUST_B, qboCustomerId: 'qbo-2' }), NOW),
    ).resolves.toBeTruthy()
    expect(repo.rows).toHaveLength(2)
  })
})

// ── Retained-history unlink ───────────────────────────────────────────────────

describe('QBO-4A unlink — retained history (is_active flips, row survives)', () => {
  it('deactivate flips is_active to false and stamps unlinked_at/by, keeping the row', async () => {
    const repo = new FakeMappingRepo()
    await createCustomerMapping(repo, makeInput(), NOW)
    const later = new Date('2026-09-01T09:00:00Z')
    const by = 'owner-user-id-1'
    await unlinkCustomerMapping(
      repo,
      { organizationId: ORG, poweronCustomerId: CUST_A, qboCompanyFingerprint: FP_SBX, qboEnvironment: 'sandbox' },
      by,
      later,
    )
    expect(repo.rows).toHaveLength(1) // retained, not deleted
    const r = repo.rows[0]
    expect(r.isActive).toBe(false)
    expect(r.unlinkedAt).toBe(later.toISOString())
    expect(r.unlinkedByUserId).toBe(by)
  })

  it('after unlink, a new link for the same PowerOn customer in the same scope is allowed (relink)', async () => {
    const repo = new FakeMappingRepo()
    await createCustomerMapping(repo, makeInput({ qboCustomerId: 'qbo-55' }), NOW)
    await unlinkCustomerMapping(
      repo,
      { organizationId: ORG, poweronCustomerId: CUST_A, qboCompanyFingerprint: FP_SBX, qboEnvironment: 'sandbox' },
      null,
      NOW,
    )
    // Relink to a different QBO customer — the old inactive row is retained.
    await expect(
      createCustomerMapping(repo, makeInput({ qboCustomerId: 'qbo-77' }), new Date('2026-09-02T00:00:00Z')),
    ).resolves.toBeTruthy()
    expect(repo.rows).toHaveLength(2)
    expect(repo.rows.filter((r) => r.isActive).length).toBe(1)
    expect(repo.rows.find((r) => r.isActive)?.qboCustomerId).toBe('qbo-77')
  })

  it('loadCurrentCustomerMapping returns null when no active mapping exists', async () => {
    const repo = new FakeMappingRepo()
    const scope: QboCustomerMappingScope = {
      organizationId: ORG,
      poweronCustomerId: CUST_A,
      qboCompanyFingerprint: FP_SBX,
      qboEnvironment: 'sandbox',
    }
    expect(await loadCurrentCustomerMapping(repo, scope)).toBeNull()
    await createCustomerMapping(repo, makeInput(), NOW)
    expect(await loadCurrentCustomerMapping(repo, scope)).toBeTruthy()
    await unlinkCustomerMapping(repo, scope, null, NOW)
    expect(await loadCurrentCustomerMapping(repo, scope)).toBeNull()
  })
})

// ── Browser sanitization boundary ──────────────────────────────────────────────

describe('QBO-4A sanitizeCustomerMapping — no secrets cross the browser boundary', () => {
  it('a null/inactive row yields linked:false with no customer', () => {
    expect(sanitizeCustomerMapping(null)).toEqual({ linked: false, customer: null, linkOrigin: null })
    expect(sanitizeCustomerMapping(makeRow({ isActive: false }))).toEqual({
      linked: false,
      customer: null,
      linkOrigin: null,
    })
  })

  it('an active row yields the browser-safe shape with display fields only', () => {
    const s = sanitizeCustomerMapping(makeRow())
    expect(s).toEqual({
      linked: true,
      customer: { id: 'qbo-55', displayName: 'Acme Corp', active: true },
      linkOrigin: 'linked',
    })
  })

  it('the sanitized shape carries NO realmId, fingerprint, snapshot, tokens, or envelopes', () => {
    const s = sanitizeCustomerMapping(makeRow({ poweronCustomerSnapshot: { name: 'Acme', secret: 'no' } }))
    const json = JSON.stringify(s)
    expect(json).not.toContain('fingerprint')
    expect(json).not.toContain('realmId')
    expect(json).not.toContain('realm')
    expect(json).not.toContain('snapshot')
    expect(json).not.toContain('token')
    expect(json).not.toContain('envelope')
    expect(json).not.toContain('secret')
    // The PowerOn customer UUID is also not surfaced (browser gets qbo id only).
    expect(json).not.toContain(CUST_A)
  })
})

// ── Migration 133 contract (source-scan; the DB apply is a separate live step) ─

describe('QBO-4A migration 133 — DDL matches the persistence model', () => {
  const MIG = readFileSync(join(process.cwd(), 'supabase/migrations/133_quickbooks_customer_mappings.sql'), 'utf8')

  it('creates exactly the quickbooks_customer_mappings table', () => {
    expect(MIG).toContain('CREATE TABLE IF NOT EXISTS public.quickbooks_customer_mappings')
  })

  it('poweron_customer_id is UUID NOT NULL with NO hard FK to relationship_accounts', () => {
    expect(MIG).toMatch(/poweron_customer_id\s+UUID\s+NOT\s+NULL/)
    // The column declaration line itself must carry no REFERENCES clause. (The
    // header COMMENTS mention relationship_accounts to explain WHY there is no
    // FK, so a broad /poweron_customer_id[\s\S]*?relationship_accounts/ would
    // false-positive on the prose.)
    const colLine = MIG.split('\n').find((l) => /poweron_customer_id\s+UUID/.test(l)) ?? ''
    expect(colLine).not.toMatch(/REFERENCES/i)
    // The "NOT a hard FK" decision is documented in the header.
    expect(MIG).toContain('NOT a hard FK')
  })

  it('organization_id FKs to organizations with ON DELETE CASCADE', () => {
    expect(MIG).toMatch(/organization_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.organizations\(id\)\s+ON\s+DELETE\s+CASCADE/i)
  })

  it('qbo_environment has a sandbox/production CHECK', () => {
    expect(MIG).toMatch(/qbo_environment\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*qbo_environment\s+IN\s*\('sandbox',\s*'production'\)/i)
  })

  it('link_origin has a linked/created CHECK and defaults to linked', () => {
    expect(MIG).toMatch(/link_origin\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'linked'\s+CHECK\s*\(\s*link_origin\s+IN\s*\('linked',\s*'created'\)/i)
  })

  it('is_active defaults to true (retained-history model)', () => {
    expect(MIG).toMatch(/is_active\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+true/i)
  })

  it('has BOTH partial UNIQUE indexes (one per poweron, one per qbo) WHERE is_active = true', () => {
    expect(MIG).toContain('uq_qbo_customer_mappings_one_active_per_poweron')
    expect(MIG).toContain('uq_qbo_customer_mappings_one_active_per_qbo')
    // Both are partial (WHERE is_active = true).
    const poweronIdx = MIG.indexOf('uq_qbo_customer_mappings_one_active_per_poweron')
    const qboIdx = MIG.indexOf('uq_qbo_customer_mappings_one_active_per_qbo')
    expect(MIG.slice(poweronIdx, poweronIdx + 400)).toMatch(/WHERE\s+is_active\s*=\s*true/i)
    expect(MIG.slice(qboIdx, qboIdx + 400)).toMatch(/WHERE\s+is_active\s*=\s*true/i)
    // Both are UNIQUE.
    expect(MIG.slice(poweronIdx - 200, poweronIdx)).toMatch(/CREATE\s+UNIQUE\s+INDEX/i)
    expect(MIG.slice(qboIdx - 200, qboIdx)).toMatch(/CREATE\s+UNIQUE\s+INDEX/i)
  })

  it('RLS is enabled and ALL access is revoked from PUBLIC/anon/authenticated', () => {
    expect(MIG).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(MIG).toMatch(/REVOKE ALL ON TABLE public\.quickbooks_customer_mappings FROM PUBLIC/i)
    expect(MIG).toMatch(/REVOKE ALL ON TABLE public\.quickbooks_customer_mappings FROM anon/i)
    expect(MIG).toMatch(/REVOKE ALL ON TABLE public\.quickbooks_customer_mappings FROM authenticated/i)
  })

  it('defines NO authenticated RLS policy (server-only; service role bypasses RLS)', () => {
    // No CREATE POLICY ... TO authenticated for this table.
    expect(MIG).not.toMatch(/CREATE\s+POLICY[\s\S]{0,400}?quickbooks_customer_mappings/i)
    expect(MIG).toContain('Deliberately NO CREATE POLICY')
  })

  it('has an updated_at BEFORE UPDATE trigger', () => {
    expect(MIG).toContain('trg_quickbooks_customer_mappings_set_updated_at')
    expect(MIG).toMatch(/BEFORE UPDATE ON public\.quickbooks_customer_mappings/i)
  })

  it('has a postconditions DO block that asserts table/RLS/no-anon/no-policies/uniques', () => {
    expect(MIG).toContain('POSTCONDITION FAILED: quickbooks_customer_mappings missing')
    expect(MIG).toContain('POSTCONDITION FAILED: RLS not enabled')
    expect(MIG).toContain('POSTCONDITION FAILED: anon/authenticated must not access')
    expect(MIG).toContain('POSTCONDITION FAILED: quickbooks_customer_mappings must have no RLS policies')
    expect(MIG).toContain('POSTCONDITION FAILED: one-active-per-poweron unique index missing')
    expect(MIG).toContain('POSTCONDITION FAILED: one-active-per-qbo unique index missing')
    expect(MIG).toContain('POSTCONDITION FAILED: is_active default must be true')
    expect(MIG).toContain('POSTCONDITION FAILED: updated_at trigger missing')
  })

  it('does NOT store the raw realmId as a column (fingerprint only)', () => {
    expect(MIG).not.toMatch(/realm_id\s+(UUID|TEXT|BIGINT)/i)
    // The fingerprint column is the only company-scoping column.
    expect(MIG).toMatch(/qbo_company_fingerprint\s+TEXT\s+NOT\s+NULL/i)
  })

  it('does NOT edit migration 131 or 132 (frozen) — no other table is created/altered', () => {
    // Only one CREATE TABLE in this migration.
    const creates = MIG.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g) ?? []
    expect(creates).toEqual(['CREATE TABLE IF NOT EXISTS public.quickbooks_customer_mappings'])
    // No reference to the 131/132 tables (would indicate editing their DDL).
    expect(MIG).not.toContain('CREATE TABLE IF NOT EXISTS public.invoice_drafts')
    expect(MIG).not.toContain('CREATE TABLE IF NOT EXISTS public.quickbooks_connections')
    expect(MIG).not.toContain('CREATE TABLE IF NOT EXISTS public.quickbooks_oauth_states')
  })
})

// ── Migration 134 contract (source-scan; live apply is a separate step) ───────

describe('QBO-4A.6 migration 134 — poweron_customer_id UUID → TEXT', () => {
  const MIG134 = readFileSync(
    join(process.cwd(), 'supabase/migrations/134_quickbooks_customer_mapping_text_identity.sql'),
    'utf8',
  )

  it('alters poweron_customer_id to TEXT (USING ::text) and keeps NOT NULL', () => {
    expect(MIG134).toMatch(/ALTER COLUMN poweron_customer_id TYPE text/i)
    expect(MIG134).toMatch(/USING poweron_customer_id::text/i)
    expect(MIG134).toMatch(/ALTER COLUMN poweron_customer_id SET NOT NULL/i)
  })

  it('does NOT rekey relationship_accounts and does NOT add a hard FK', () => {
    expect(MIG134).toMatch(/DO NOT rekey relationship_accounts/i)
    // No DDL against relationship_accounts itself (prose may mention the table).
    expect(MIG134).not.toMatch(/ALTER TABLE\s+(IF EXISTS\s+)?public\.relationship_accounts/i)
    expect(MIG134).not.toMatch(/ADD CONSTRAINT[\s\S]{0,200}?REFERENCES\s+public\.relationship_accounts/i)
  })

  it('postconditions assert TEXT NOT NULL + RLS + no policies + partial uniques + env/link_origin CHECKs', () => {
    expect(MIG134).toContain("poweron_customer_id must be text")
    expect(MIG134).toContain('poweron_customer_id must stay NOT NULL')
    expect(MIG134).toContain('RLS not enabled on quickbooks_customer_mappings')
    expect(MIG134).toContain('anon/authenticated must not access quickbooks_customer_mappings')
    expect(MIG134).toContain('must have no RLS policies')
    expect(MIG134).toContain('one-active-per-poweron unique index missing')
    expect(MIG134).toContain('one-active-per-qbo unique index missing')
    expect(MIG134).toContain('quickbooks_customer_mappings_qbo_environment_check')
    expect(MIG134).toContain('quickbooks_customer_mappings_link_origin_check')
    expect(MIG134).toContain('qbo_environment sandbox/production CHECK missing')
    expect(MIG134).toContain('link_origin linked/created CHECK missing')
  })

  it('does NOT edit migration 133 (frozen) and does NOT recreate the mapping table', () => {
    expect(MIG134).not.toContain('CREATE TABLE IF NOT EXISTS public.quickbooks_customer_mappings')
    expect(MIG134).toMatch(/Migration 133 is FROZEN/i)
  })

  it('leaves organization_id as UUID and does not introduce a raw realmId column', () => {
    expect(MIG134).toMatch(/organization_id stays UUID/i)
    expect(MIG134).not.toMatch(/realm_id\s+(UUID|TEXT|BIGINT)/i)
  })
})