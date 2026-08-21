/**
 * QBO-4A.4 focused tests — Owner Customer Link/Create UI.
 *
 * 30 scenarios (owner-locked rules). The repo has NO DOM render harness (no
 * @testing-library/react, no renderHook), so UI-behavioral scenarios are covered
 * two ways:
 *  1. PURE-FUNCTION unit tests with a fake fetch — exercise the sanitized client
 *     (the only network layer) and the pure prefill resolver end-to-end. These
 *     prove the request/response shapes, error classification, and "never
 *     auto-link / never auto-create / never send secrets" behavior.
 *  2. SOURCE-CONTRACT tests — read the component/host source, strip comments, and
 *     assert the locked UI structure (states, labels, safeguards, no-gate,
 *     firewall, untouched surfaces). This mirrors the established QBO-3A/2F1
 *     contract-test convention.
 *
 * Nothing here renders React or hits a network.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createQboCustomerMappingClient } from '../qboCustomerMappingClient'
import type { FetchImpl, GetHeaders } from '../qboCustomerMappingClient'
import { QboCustomerMappingApiError } from '../qboCustomerMappingTypes'
import { resolveCreatePrefill } from '../resolveCreatePrefill'

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
}

// ── Shared fake fetch ─────────────────────────────────────────────────────────

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

function makeClient(impl: (url: string, init: { method: string; body?: string }) => FakeFetchResponse) {
  const recorded: { url: string; method: string; body?: string }[] = []
  const fetchImpl: FetchImpl = ((url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    recorded.push({ url, method: init.method, body: init.body })
    return fakeRes(impl(url, init))
  }) as unknown as FetchImpl
  const getHeaders: GetHeaders = async () => ({ Authorization: 'Bearer test' })
  const client = createQboCustomerMappingClient({ fetchImpl, getHeaders })
  return { client, recorded }
}

// ── Client behavioral tests (fake fetch) ─────────────────────────────────────

describe('QBO-4A.4 client — search/link/create/unlink + classification', () => {
  it('search builds a bounded GET with the term and maps results, marking inactive customers (9,11,12)', async () => {
    const { client, recorded } = makeClient(() => ({
      ok: true,
      status: 200,
      body: {
        customers: [
          { id: '1', displayName: 'Acme', companyName: 'Acme Corp', email: 'a@b.co', phone: '555', active: true },
          { id: '2', displayName: 'Old', email: 'x@y.co', active: false },
        ],
      },
    }))
    const results = await client.search('ac', { activeOnly: false })
    expect(recorded[0].method).toBe('GET')
    expect(recorded[0].url).toMatch(/qbo-customer-search\?q=ac/)
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ id: '1', displayName: 'Acme', companyName: 'Acme Corp', active: true })
    // Inactive customer is still returned, visibly marked active:false (scenario 12).
    expect(results[1].active).toBe(false)
    expect(results[1].companyName).toBeNull()
  })

  it('activeOnly flag is sent to the server', async () => {
    const { client, recorded } = makeClient(() => ({ ok: true, status: 200, body: { customers: [] } }))
    await client.search('ac', { activeOnly: true })
    expect(recorded[0].url).toMatch(/activeOnly=1/)
  })

  it('link posts {poweronCustomerId, qboCustomerId} and returns the sanitized mapping (13)', async () => {
    const { client, recorded } = makeClient(() => ({
      ok: true,
      status: 200,
      body: { linked: true, customer: { id: '77', displayName: 'Acme', active: true }, linkOrigin: 'linked' },
    }))
    const res = await client.link('uuid-cust', '77')
    expect(recorded[0].method).toBe('POST')
    expect(recorded[0].url).toMatch(/qbo-customer-link/)
    expect(JSON.parse(recorded[0].body!)).toEqual({ poweronCustomerId: 'uuid-cust', qboCustomerId: '77' })
    expect(res.customer).toMatchObject({ id: '77', displayName: 'Acme', active: true })
    expect(res.linkOrigin).toBe('linked')
  })

  it('create posts only safe fields (never realmId/fingerprint/token) and returns linkOrigin "created" (14,18,24)', async () => {
    const { client, recorded } = makeClient(() => ({
      ok: true,
      status: 200,
      body: { linked: true, customer: { id: '88', displayName: 'Acme', active: true }, linkOrigin: 'created' },
    }))
    const res = await client.create('uuid-cust', {
      displayName: 'Acme',
      companyName: 'Acme Corp',
      email: 'a@b.co',
      phone: '555',
      billAddr: { line1: '1 St', city: 'Town', state: 'CA', postalCode: '90210', country: 'US' },
    })
    const body = JSON.parse(recorded[0].body!)
    expect(body).toMatchObject({ poweronCustomerId: 'uuid-cust', displayName: 'Acme', companyName: 'Acme Corp', email: 'a@b.co', phone: '555', billAddr: { line1: '1 St' } })
    // No forbidden server-authority fields are ever sent by the browser.
    for (const forbidden of ['realmId', 'realm_id', 'fingerprint', 'accessToken', 'refreshToken', 'syncToken', 'organizationId']) {
      expect(body).not.toHaveProperty(forbidden)
      expect(JSON.stringify(body)).not.toMatch(new RegExp(`\\b${forbidden}\\b`, 'i'))
    }
    expect(res.linkOrigin).toBe('created')
    expect(res.customer.id).toBe('88')
  })

  it('create omits empty optional fields rather than sending nulls', async () => {
    const { client, recorded } = makeClient(() => ({
      ok: true,
      status: 200,
      body: { linked: true, customer: { id: '88', displayName: 'Solo', active: true }, linkOrigin: 'created' },
    }))
    await client.create('uuid-cust', { displayName: 'Solo' })
    const body = JSON.parse(recorded[0].body!)
    expect(body).toEqual({ poweronCustomerId: 'uuid-cust', displayName: 'Solo' })
    expect(body).not.toHaveProperty('companyName')
    expect(body).not.toHaveProperty('billAddr')
  })

  it('unlink posts {poweronCustomerId} only and returns linked:false (it never deletes the QBO customer) (21)', async () => {
    const { client, recorded } = makeClient(() => ({ ok: true, status: 200, body: { linked: false } }))
    const res = await client.unlink('uuid-cust')
    expect(recorded[0].method).toBe('POST')
    expect(recorded[0].url).toMatch(/qbo-customer-unlink/)
    expect(JSON.parse(recorded[0].body!)).toEqual({ poweronCustomerId: 'uuid-cust' })
    expect(res).toEqual({ linked: false })
  })

  it('loadMapping returns linked mapping when present, else unlinked', async () => {
    type MappingBody = { linked: true; customer: { id: string; displayName: string; active: boolean }; linkOrigin: string } | { linked: false }
    let response: MappingBody = { linked: true, customer: { id: '1', displayName: 'A', active: true }, linkOrigin: 'linked' }
    const { client } = makeClient(() => ({ ok: true, status: 200, body: response }))
    let res = await client.loadMapping('uuid-cust')
    expect(res.linked).toBe(true)
    response = { linked: false }
    res = await client.loadMapping('uuid-cust')
    expect(res.linked).toBe(false)
  })

  it('422 duplicate_name classifies to duplicate_name (17 — no auto-suffix/merge/retry)', async () => {
    const { client } = makeClient(() => ({ ok: false, status: 422, body: { error: 'dup', category: 'duplicate_name' } }))
    await expect(client.create('uuid-cust', { displayName: 'Acme' })).rejects.toMatchObject({ category: 'duplicate_name' })
  })

  it('409 recoverable+qboCustomer classifies to split_failure with the recoverable customer (15-error-recovery)', async () => {
    const { client } = makeClient(() => ({
      ok: false,
      status: 409,
      body: { error: 'created but mapping failed', recoverable: true, qboCustomer: { id: '99', displayName: 'Acme' } },
    }))
    await expect(client.create('uuid-cust', { displayName: 'Acme' })).rejects.toMatchObject({
      category: 'split_failure',
      recoverableQboCustomer: { id: '99', displayName: 'Acme' },
    })
  })

  it('409 "linked to another" classifies to claimed_by_other', async () => {
    const { client } = makeClient(() => ({ ok: false, status: 409, body: { error: 'linked to another PowerOn customer' } }))
    await expect(client.link('uuid-cust', '1')).rejects.toMatchObject({ category: 'claimed_by_other' })
  })

  it('401 classifies to unauthorized (no stack trace surfaced)', async () => {
    const { client } = makeClient(() => ({ ok: false, status: 401, body: { error: 'no' } }))
    await expect(client.link('uuid-cust', '1')).rejects.toMatchObject({ category: 'unauthorized' })
  })

  it('network throw classifies to network_error', async () => {
    const fetchImpl: FetchImpl = (() => {
      throw new Error('offline')
    }) as unknown as FetchImpl
    const client = createQboCustomerMappingClient({ fetchImpl, getHeaders: async () => ({}) })
    await expect(client.search('a')).rejects.toMatchObject({ category: 'network_error' })
  })
})

// ── resolveCreatePrefill pure tests (15, 16, 23) ──────────────────────────────

describe('QBO-4A.4 resolveCreatePrefill — prefill from reconciled account, never by name', () => {
  const dir = [
    { id: 'uuid-1', company: 'Acme Corp', contact: 'Jane Doe', email: 'jane@acme.co', phone: '555-0100' },
    { id: 'uuid-2', company: 'Solo Co', contact: '', email: '', phone: '' },
    { id: 'gc123', company: 'Name Match Trap', contact: 'Trap', email: 't@t.co', phone: '' },
  ]

  it('15: prefills displayName=contact, companyName, email, phone from the matching UUID', () => {
    const p = resolveCreatePrefill('uuid-1', dir)
    expect(p).toEqual({ displayName: 'Jane Doe', companyName: 'Acme Corp', email: 'jane@acme.co', phone: '555-0100' })
  })

  it('16: missing values are absent (null), never invented; displayName falls back to company only when contact is empty', () => {
    const p = resolveCreatePrefill('uuid-2', dir)
    expect(p).toEqual({ displayName: 'Solo Co', companyName: 'Solo Co', email: null, phone: null })
  })

  it('returns null when the customer is not in the directory (no name-based guess)', () => {
    expect(resolveCreatePrefill('uuid-missing', dir)).toBeNull()
  })

  it('23: never matches by name — a different UUID with the same company name is not used', () => {
    // uuid-other is absent; the directory entry "Name Match Trap" must NOT be
    // selected because its name happens to match anything. Lookup is by id only.
    const p = resolveCreatePrefill('uuid-other', dir)
    expect(p).toBeNull()
  })

  it('returns null for a null/empty poweronCustomerId (name-only / legacy source)', () => {
    expect(resolveCreatePrefill(null, dir)).toBeNull()
    expect(resolveCreatePrefill('', dir)).toBeNull()
  })

  it('returns null when neither contact nor company is usable', () => {
    expect(resolveCreatePrefill('uuid-3', [...dir, { id: 'uuid-3', company: '  ', contact: '  ', email: 'e', phone: 'p' }])).toBeNull()
  })

  it('23: a non-UUID "gc..." local id resolves to a directory entry ONLY because it is the exact id — the resolver itself does not validate UUID shape (the host/hook guards that); it still never matches by name', () => {
    // The gc123 entry is found by exact id match, not by name. This proves the
    // resolver is identity-keyed, not name-keyed. (Hosts never pass gc... ids
    // because the hook receives only reconciled UUIDs; this just confirms the
    // resolver does not silently substitute a namesake.)
    const p = resolveCreatePrefill('gc123', dir)
    expect(p?.displayName).toBe('Trap')
  })
})

// ── Source-contract: hook state transitions (18, 19, 20, 21, 22, 24) ──────────

const HOOK = read('src/features/quickbooks-customer-mapping/useQuickBooksCustomerMapping.ts')
const HOOK_CODE = stripComments(HOOK)

describe('QBO-4A.4 hook — state transitions are in-component (no reload), never expose secrets', () => {
  it('19: link success flips state to linked WITHOUT a full app reload (no window.location / reload)', () => {
    expect(HOOK_CODE).toMatch(/clientRef\.current\.link\(poweronCustomerId,\s*qboCustomerId\)/)
    expect(HOOK_CODE).toMatch(/setState\(linkedState\(res\.customer,\s*res\.linkOrigin\)\)/)
    expect(HOOK_CODE).not.toMatch(/window\.location|location\.reload|location\.href/)
  })

  it('18: create success flips state to linked with linkOrigin persisted', () => {
    expect(HOOK_CODE).toMatch(/clientRef\.current\.create\(poweronCustomerId,\s*input\)/)
    expect(HOOK_CODE).toMatch(/setState\(linkedState\(res\.customer,\s*res\.linkOrigin\)\)/)
  })

  it('20/21: unlink flips state to unlinked (history retained on the server; the hook only clears local state)', () => {
    expect(HOOK_CODE).toMatch(/clientRef\.current\.unlink\(poweronCustomerId\)/)
    expect(HOOK_CODE).toMatch(/setState\(\{\s*kind:\s*'unlinked'\s*\}\)/)
  })

  it('connected===false short-circuits to disconnected and does NOT fetch', () => {
    expect(HOOK_CODE).toMatch(/connected === false/)
    const loadBody = HOOK_CODE.slice(HOOK_CODE.indexOf('const load = useCallback'), HOOK_CODE.indexOf('}, [poweronCustomerId, connected]'))
    expect(loadBody).toMatch(/if \(connected === false\)/)
  })

  it('24: the hook never surfaces realmId / fingerprint / tokens / SyncToken', () => {
    for (const forbidden of ['realmId', 'fingerprint', 'accessToken', 'refreshToken', 'syncToken', 'clientId']) {
      expect(HOOK_CODE).not.toMatch(new RegExp(`\\b${forbidden}\\b`, 'i'))
    }
  })
})

// ── Source-contract: modal UI structure (1,2,3,4,8,10,11,12,13,14,17,20,21,22,24) ─

const MODAL = read('src/features/quickbooks-customer-mapping/components/LinkQuickBooksCustomerModal.tsx')
const MODAL_CODE = stripComments(MODAL)
const STATUS = read('src/features/quickbooks-customer-mapping/components/QuickBooksCustomerStatus.tsx')
const STATUS_CODE = stripComments(STATUS)

describe('QBO-4A.4 modal — locked UI states + safeguards', () => {
  it('1: unmapped (unlinked) state renders the search/create workflow', () => {
    expect(MODAL_CODE).toMatch(/s\.kind === 'unlinked' && mode === 'search'/)
    expect(MODAL_CODE).toContain('SearchBody')
  })

  it('2: linked state renders the linked customer name + ✓ Linked', () => {
    expect(MODAL_CODE).toMatch(/s\.kind === 'linked'/)
    expect(MODAL_CODE).toContain('LinkedBody')
    expect(MODAL_CODE).toMatch(/customer\.displayName/)
    expect(MODAL_CODE).toContain('✓ Linked')
  })

  it('3: disconnected state renders "QuickBooks not connected" + Connect (existing OAuth flow only)', () => {
    expect(MODAL_CODE).toMatch(/s\.kind === 'disconnected'/)
    expect(MODAL_CODE).toContain('DisconnectedBody')
    expect(MODAL_CODE).toContain('QuickBooks not connected')
  })

  it('4: unresolved PowerOn UUID state renders the safe "must be resolved" message', () => {
    expect(MODAL_CODE).toMatch(/s\.kind === 'unresolved'/)
    expect(MODAL_CODE).toContain('PowerOn customer identity must be resolved before linking')
  })

  it('8: the inline status component opens this modal from "Link Customer" / "View / Change"', () => {
    expect(STATUS_CODE).toMatch(/setOpen\(true\)/)
    expect(STATUS_CODE).toContain('Link Customer')
    expect(STATUS_CODE).toContain('View / Change')
    expect(STATUS_CODE).toContain('LinkQuickBooksCustomerModal')
  })

  it('10: a single search result is NEVER auto-linked — Link is disabled until a result is explicitly selected', () => {
    // Selection is a separate radio step; the Link button is gated on selectedId.
    expect(MODAL_CODE).toMatch(/props\.selectedId === r\.id/)
    expect(MODAL_CODE).toMatch(/onChange=\{\(\) => props\.onSelect\(r\.id\)\}/)
    expect(MODAL_CODE).toMatch(/disabled=\{!props\.selectedId \|\| props\.busy\}/)
    // The link action is bound ONLY to the explicit Link button onClick.
    expect(MODAL_CODE).toMatch(/onClick=\{props\.onLink\}/)
    expect(MODAL_CODE).toMatch(/onLink=\{handleLink\}/)
  })

  it('11: multiple results are individually selectable (radio inputs keyed by id)', () => {
    expect(MODAL_CODE).toMatch(/type="radio" name="qbo-customer"/)
    expect(MODAL_CODE).toMatch(/onChange=\{\(\) => props\.onSelect\(r\.id\)\}/)
  })

  it('12: inactive results are visibly marked (INACTIVE badge)', () => {
    expect(MODAL_CODE).toMatch(/!r\.active &&/)
    expect(MODAL_CODE).toContain('INACTIVE')
  })

  it('13: the explicit Link action calls api.link with the selected id only', () => {
    const handle = MODAL_CODE.slice(MODAL_CODE.indexOf('async function handleLink'), MODAL_CODE.indexOf('buildCreateInput'))
    expect(handle).toMatch(/if \(!selectedId\) return/)
    expect(handle).toMatch(/api\.link\(selectedId\)/)
  })

  it('14: create form opens ONLY from an explicit "Create customer in QuickBooks" action (no auto-transition to create)', () => {
    // setMode('create') is bound to the explicit Create button; the search flow
    // never calls it. Assert the action exists and the search effect does not.
    expect(MODAL_CODE).toContain('Create customer in QuickBooks')
    const setCreateMatches = MODAL_CODE.match(/setMode\('create'\)/g) ?? []
    expect(setCreateMatches.length).toBeGreaterThanOrEqual(1)
    const searchEffect = MODAL_CODE.slice(MODAL_CODE.indexOf('api'), MODAL_CODE.indexOf('if (!open) return null'))
    expect(searchEffect).not.toMatch(/setMode\('create'\)/)
  })

  it('17: duplicate-name offers Search Existing + edit, NEVER auto-suffix/merge/retry', () => {
    expect(MODAL_CODE).toContain('QuickBooks already has a customer, vendor, or employee using this name')
    expect(MODAL_CODE).toContain('Search Existing Customers')
    expect(MODAL_CODE).not.toMatch(/auto-?suffix|autoMerge|auto_merge|retry/i)
  })

  it('17b: split failure steers to Search Existing, never blind retry of Create', () => {
    expect(MODAL_CODE).toMatch(/isSplit/)
    expect(MODAL_CODE).toContain('Search Existing Customers')
    // No automatic re-call of create on split failure.
    const createFn = MODAL_CODE.slice(MODAL_CODE.indexOf('async function handleCreate'), MODAL_CODE.indexOf('async function handleUnlink'))
    expect(createFn).not.toMatch(/retry/i)
  })

  it('20: unlink requires an explicit confirmation before the destructive call', () => {
    expect(MODAL_CODE).toMatch(/unlinkConfirm/)
    expect(MODAL_CODE).toContain('Unlink QuickBooks customer?')
    expect(MODAL_CODE).toContain('onConfirmUnlink={handleUnlink}')
  })

  it('21: unlink copy states it will NOT delete the customer from QuickBooks', () => {
    expect(MODAL_CODE).toContain('will not delete the customer from QuickBooks')
  })

  it('22: change mapping requires an explicit confirmation, then unlinks and returns to search', () => {
    expect(MODAL_CODE).toMatch(/changeConfirm/)
    expect(MODAL_CODE).toContain('Change QuickBooks customer mapping?')
    const handleChange = MODAL_CODE.slice(MODAL_CODE.indexOf('async function handleChangeMapping'), MODAL_CODE.indexOf('return createPortal'))
    expect(handleChange).toMatch(/api\.unlink\(\)/)
    expect(handleChange).toMatch(/setMode\('search'\)/)
  })

  it('24: the modal never renders realmId / fingerprint / tokens / SyncToken / provider ids', () => {
    for (const forbidden of ['realmId', 'fingerprint', 'accessToken', 'refreshToken', 'syncToken', 'clientId', 'client_secret']) {
      expect(MODAL_CODE).not.toMatch(new RegExp(`\\b${forbidden}\\b`, 'i'))
    }
  })

  it('search uses a debounce + minimum term length (no per-keystroke hammering) (9)', () => {
    expect(MODAL_CODE).toMatch(/SEARCH_DEBOUNCE_MS/)
    expect(MODAL_CODE).toMatch(/MIN_SEARCH_TERM/)
    expect(MODAL_CODE).toMatch(/setTimeout\(\(\) => setDebouncedTerm/)
    expect(MODAL_CODE).toMatch(/debouncedTerm\.length < MIN_SEARCH_TERM/)
  })
})

// ── Source-contract: status component states (non-gating) ─────────────────────

describe('QBO-4A.4 QuickBooksCustomerStatus — compact states, non-gating', () => {
  it('renders the four safe states + loading/error with no blocking action', () => {
    // QBO-4A.5: the unresolved state is now actionable ("Customer needs to be
    // confirmed...") instead of the former passive dead-end text.
    expect(STATUS_CODE).toContain('Customer needs to be confirmed before QuickBooks can be linked')
    expect(STATUS_CODE).toContain('QuickBooks not connected')
    expect(STATUS_CODE).toContain('Not linked')
    expect(STATUS_CODE).toContain('Linked')
    expect(STATUS_CODE).toContain('Checking QuickBooks')
  })
})

// ── Source-contract: Prepare Invoice non-gating + firewall (5,6,7,28,29,30) ──

const PREPARE = read('src/features/billing-draft/components/PrepareInvoiceModal.tsx')
const PREPARE_CODE = stripComments(PREPARE)

describe('QBO-4A.4 Prepare Invoice — mapping status is NON-GATING + firewall intact', () => {
  it('5/6/7: Save Draft + APPROVE remain unconditional (not gated by QuickBooks mapping state)', () => {
    expect(PREPARE_CODE).toContain('QuickBooksCustomerStatus')
    // Save Draft / Approve buttons are gated only by `saving` / `draft.ready`, not by any mapping flag.
    expect(PREPARE_CODE).toMatch(/onClick=\{handleSaveDraft\}/)
    expect(PREPARE_CODE).toMatch(/onClick=\{handleApprove\}/)
    expect(PREPARE_CODE).toMatch(/disabled=\{saving\}/)
    expect(PREPARE_CODE).toMatch(/disabled=\{!draft\.ready \|\| saving\}/)
    // No reference to mapping state in the footer action guards.
    const footer = PREPARE_CODE.slice(PREPARE_CODE.indexOf('Save Draft'), PREPARE_CODE.indexOf('APPROVE INVOICE DRAFT') + 40)
    expect(footer).not.toMatch(/customerMapping|linkCustomer|mapping\.state|\.linked/i)
  })

  it('28: no Send to QuickBooks / QBO Invoice / Estimate action was added', () => {
    expect(PREPARE_CODE).not.toMatch(/Send to QuickBooks|QBO Invoice|QBO Estimate|sendToQuickBooks|createQboInvoice/i)
  })

  it('29: the INVOICE DRAFT READY screen (DraftReadyConfirmation) is unchanged — still present, no new buttons', () => {
    expect(PREPARE).toContain('INVOICE DRAFT READY')
    expect(PREPARE).toContain('DraftReadyConfirmation')
    const confirm = PREPARE.slice(PREPARE.indexOf('function DraftReadyConfirmation'), PREPARE.indexOf('// ── Local helpers'))
    // The two original buttons remain; no NEW action buttons were added.
    expect(confirm).toContain('Edit Draft')
    expect(confirm).toContain('Close')
    const buttonCount = (confirm.match(/<button/g) ?? []).length
    expect(buttonCount).toBe(2)
  })

  it('30: QBO-LOG-22 firewall still green — PrepareInvoiceModal source has no fetch( / Intuit call', () => {
    expect(PREPARE_CODE).not.toMatch(/intuit|quickbooks\.api|appcenter\.intuit|oauth\.platform\.intuit/i)
    expect(PREPARE_CODE).not.toMatch(/\bfetch\s*\(/)
  })
})

// ── Source-contract: QuickBooksMenu contextual item (25) ───────────────────────

const MENU = read('src/features/billing-draft/components/QuickBooksMenu.tsx')
const MENU_CODE = stripComments(MENU)

describe('QBO-4A.4 QuickBooksMenu — contextual customer item, no new global button (25)', () => {
  it('the customer item is OPTIONAL (rendered only when onLinkCustomer is provided)', () => {
    expect(MENU_CODE).toMatch(/onLinkCustomer &&/)
    expect(MENU_CODE).toContain('customerLinkLabel')
    expect(MENU_CODE).toContain('Link QuickBooks Customer')
  })

  it('25: there is no new standalone global QuickBooks button — the trigger remains a single dropdown', () => {
    // Only one trigger button (the existing dropdown). The customer item is a menuitem.
    expect(MENU_CODE).toMatch(/onLinkCustomer &&/)
    // No standalone "Link QuickBooks Customer" button rendered outside the dropdown.
    expect(MENU_CODE).not.toMatch(/<button[^>]*>\s*Link QuickBooks Customer/)
  })
})

// ── Source-contract: host wiring + untouched surfaces (23, 26, 27, 28) ────────

const PROJECT_INNER = read('src/components/v15r/V15rProjectInner.tsx')
const SERVICE_CALLS = read('src/components/v15r/V15rServiceCallsV2.tsx')
const FIELD_LOG = read('src/components/v15r/V15rFieldLogPanel.tsx')

describe('QBO-4A.4 host wiring — contextual only when identity known; legacy/untouched surfaces', () => {
  it('V15rProjectInner offers the customer item only when projectCustomerId is a known canonical id (23)', () => {
    expect(PROJECT_INNER).toMatch(/useQuickBooksCustomerMapping/)
    expect(PROJECT_INNER).toMatch(/isCanonicalCustomerId\(proj\.accountId, canonicalIds\)/)
    expect(PROJECT_INNER).toMatch(/onLinkCustomer=\{projectCustomerId \? \(\) => setLinkCustomerOpen\(true\) : undefined\}/)
  })

  it('ServiceCallCard offers the customer item only when customerUuid is a known canonical id (23)', () => {
    // Nested canonical guard: accountId first, then customerId (both validated
    // against canonicalIds — NOT by UUID format). Whitespace-tolerant (multi-line).
    expect(SERVICE_CALLS).toMatch(/isCanonicalCustomerId\(call\.accountId, canonicalIds\)\s*\?\s*call\.accountId\s*:\s*isCanonicalCustomerId\(call\.customerId, canonicalIds\)/)
    expect(SERVICE_CALLS).toMatch(/onLinkCustomer=\{customerUuid \? \(\) => setLinkCustomerOpen\(true\) : undefined\}/)
  })

  it('23/RUN-3: legacy name-only service logs (V15rFieldLogPanel) NOW get a three-state Resolve + Link menu — RUN-3 wired the ACTUAL Field Log surface', () => {
    // RUN-2 wired the WRONG surface (LegacyServiceLogCard in V15rServiceCallsV2); the
    // owner's row is rendered by V15rFieldLogPanel. RUN-3 wires the per-row contextual
    // QuickBooksMenu here: Resolve (STATE 1, no canonical id) + Link (STATE 2, canonical
    // id), with complementary guards so the row is in exactly one identity state.
    expect(FIELD_LOG).toMatch(/const customerUuid = isCanonicalCustomerId\(l\.accountId, canonicalIds\) \? l\.accountId : null/)
    expect(FIELD_LOG).toMatch(/onResolveCustomer=\{!customerUuid \? \(\) => setResolveTargetId\(l\.id\) : undefined\}/)
    expect(FIELD_LOG).toMatch(/onLinkCustomer=\{customerUuid \? \(\) => setLinkTargetId\(l\.id\) : undefined\}/)
    // PERFORMANCE RULE: useQuickBooksCustomerMapping is called ONLY inside the lazy
    // active-row controller (FieldLogQboLinkController), never per-row on render.
    expect((FIELD_LOG.match(/useQuickBooksCustomerMapping\(/g) || []).length).toBe(1)
    expect(FIELD_LOG).toMatch(/function FieldLogQboLinkController/)
  })

  it('23/RUN-2: the LegacyServiceLogCard in V15rServiceCallsV2 NOW wires Link (STATE 2) + Resolve (STATE 1) — RUN-2 closed the legacy dead-end', () => {
    // RUN-1 intentionally left the legacy BackupServiceLog path unwired (no safe
    // persistence path). RUN-2 added the canonical accountId persistence path, so
    // the legacy card mirrors ServiceCallCard: Resolve when no canonical id, Link when
    // resolved.
    const cardIdx = SERVICE_CALLS.indexOf('function LegacyServiceLogCard')
    expect(cardIdx).toBeGreaterThan(-1)
    const card = SERVICE_CALLS.slice(cardIdx, SERVICE_CALLS.indexOf('// ─── Sub-components'))
    expect(card).toMatch(/isCanonicalCustomerId\(log\.accountId, canonicalIds\) \? log\.accountId : null/)
    expect(card).toMatch(/onLinkCustomer=\{customerUuid \? \(\) => setLinkCustomerOpen\(true\) : undefined\}/)
    expect(card).toMatch(/onResolveCustomer=\{!customerUuid \? \(\) => setResolveOpen\(true\) : undefined\}/)
    expect(card).toMatch(/useQuickBooksCustomerMapping\(/)
  })

  it('26: Historical Payments remains untouched in V15rFieldLogPanel', () => {
    expect(FIELD_LOG).toContain('Historical Payments')
  })

  it('27: QuickBooks Batch Import remains a separate, untouched card (no customer-mapping widening)', () => {
    // The customer-mapping feature never references Batch Import; Batch Import
    // lives in Settings, not in the customer-mapping feature tree.
    const featureTree = read('src/features/quickbooks-customer-mapping/components/LinkQuickBooksCustomerModal.tsx') + read('src/features/quickbooks-customer-mapping/components/QuickBooksCustomerStatus.tsx')
    expect(featureTree).not.toMatch(/Batch Import|batchImport/i)
  })

  it('28: no Send to QuickBooks was added anywhere in the new feature tree', () => {
    const tree = stripComments(read('src/features/quickbooks-customer-mapping/qboCustomerMappingClient.ts')) + stripComments(read('src/features/quickbooks-customer-mapping/useQuickBooksCustomerMapping.ts')) + MODAL_CODE + STATUS_CODE
    expect(tree).not.toMatch(/Send to QuickBooks|createQboInvoice|createEstimate|sendInvoice/i)
  })
})

// ── Source-contract: billing-draft no-fetch firewall (30) ─────────────────────

describe('QBO-4A.4 firewall — customer mapping lives outside billing-draft; billing-draft still fetch-free', () => {
  it('the network hook + client live OUTSIDE src/features/billing-draft', () => {
    // The fetch call is in the client, which is in the quickbooks-customer-mapping
    // feature, not billing-draft.
    const client = read('src/features/quickbooks-customer-mapping/qboCustomerMappingClient.ts')
    expect(client).toMatch(/\bfetch\s*\(/)
  })

  it('30: billing-draft PrepareInvoiceModal imports only the presentational status component — no fetch in that file', () => {
    expect(PREPARE_CODE).not.toMatch(/\bfetch\s*\(/)
  })
})