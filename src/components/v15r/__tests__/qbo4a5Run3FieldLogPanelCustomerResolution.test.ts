/**
 * QBO-4A.5-RUN-3 focused tests — Wire Customer Resolution Into the ACTUAL Field
 * Log surface (V15rFieldLogPanel.tsx).
 *
 * RUNTIME ROOT CAUSE (proven by the RUNTIME-TRUTH audit): the owner's actual legacy
 * Service row ("test" / GFCI / Receptacles / 2026-08-16 / Unpaid / ~$461.53) is
 * rendered by src/components/v15r/V15rFieldLogPanel.tsx, NOT V15rServiceCallsV2.
 * RUN-2 wired the WRONG surface (LegacyServiceLogCard), so the runtime menu still
 * showed only "Prepare Invoice" + "Invoice Drafts". RUN-3 wires the already-built
 * three-state PowerOn → QuickBooks customer workflow into the ACTUAL Field Log
 * service-log row.
 *
 * EXPECTED UI STATES:
 *  STATE 1 (no reconciled UUID)  → "Resolve Customer for QuickBooks" (ResolvePowerOnCustomerModal)
 *  STATE 2 (UUID, QBO not linked) → "Link QuickBooks Customer"        (LinkQuickBooksCustomerModal)
 *  STATE 3 (linked)              → existing mapping workflow inside the Link modal
 *
 * PERFORMANCE RULE: useQuickBooksCustomerMapping is NOT added per row (that would
 * be N HTTP requests on render). A SINGLE active-row controller (FieldLogQboLinkController)
 * mounts the hook lazily, for the one active row only.
 *
 * FINANCIAL FIREWALL: identity-only. Resolving a customer writes ONLY accountId —
 * NO updatedAt bump, NO financial field write (quoted/collected/payStatus/
 * balanceDue/payments/mat/hrs/opCost), NO KPI/Historical-Payments touch. Bumping
 * updatedAt would make a stale-local row win LWW over a newer remote financial
 * edit; instead identity is layered onto the LWW winner post-merge.
 *
 * V15rFieldLogPanel.tsx is `// @ts-nocheck`, so these source-contract scans are the
 * only thing pinning the wiring (mirrors QBO-3A1's approach). The repo has no DOM
 * render harness, so coverage is source-contract + pure-function tests. Nothing
 * here renders React or hits a network.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

import { applyResolvedAccountIdToServiceLogs } from '@/services/serviceScopeMerge'
import { mergeServiceLogsIntoRemote } from '@/services/serviceScopeMerge'
import type { BackupServiceLog } from '@/services/backupDataService'
import type { BackupData } from '@/services/backupDataService'

const ROOT = process.cwd()
const PANEL_PATH = 'src/components/v15r/V15rFieldLogPanel.tsx'
const PANEL = readFileSync(join(ROOT, PANEL_PATH), 'utf8')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
}
const CODE = stripComments(PANEL)

// The main V15rFieldLogPanel function body vs the module-scope controller after it.
// The controller (FieldLogQboLinkController) is defined AFTER the default export
// closes. Splitting here lets us prove the mapping hook is called ONLY in the
// controller, never per-row in the main render body.
const CONTROLLER_DEF = PANEL.indexOf('function FieldLogQboLinkController')
const MAIN_BODY = PANEL.slice(0, CONTROLLER_DEF)
const CONTROLLER = PANEL.slice(CONTROLLER_DEF)
const MAIN_CODE = stripComments(MAIN_BODY)
const CONTROLLER_CODE = stripComments(CONTROLLER)

// The per-row contextual QuickBooksMenu (the service-log row). There is more than one
// <QuickBooksMenu> in the file; the target is the one that carries onResolveCustomer.
// Slice from that <QuickBooksMenu> to its closing self-tag.
const MENU_BLOCK = (() => {
  const start = CODE.indexOf('<QuickBooksMenu', Math.max(0, CODE.indexOf('onResolveCustomer=') - 400))
  const end = CODE.indexOf('/>', start) + 2
  return CODE.slice(start, end)
})()

// The resolveFieldLogCustomer handler block (useCallback ... dependency array).
// The closing is `},\n  [backup, forceUpdate],\n)` — the dependency array sits on
// its own line, so find `[backup, forceUpdate],` then the next `)` after it.
const HANDLER_START = MAIN_CODE.indexOf('resolveFieldLogCustomer = useCallback')
const DEPS_IDX = MAIN_CODE.indexOf('[backup, forceUpdate],', HANDLER_START)
const HANDLER_END = MAIN_CODE.indexOf(')', DEPS_IDX) + 1
const HANDLER = MAIN_CODE.slice(HANDLER_START, HANDLER_END)

// ── Fixtures ──────────────────────────────────────────────────────────────────

const UUID_X = '11111111-1111-4111-8111-111111111111'
const UUID_Y = '22222222-2222-4221-8222-222222222222'

function makeLog(over: Partial<BackupServiceLog> = {}): BackupServiceLog {
  return {
    id: 'svc-A',
    hrs: 0,
    mat: 0,
    date: '2026-08-16',
    jtype: 'GFCI / Receptacles',
    miles: 0,
    notes: '',
    store: '',
    opCost: 0,
    profit: 0,
    quoted: 461.53,
    customer: 'test',
    collected: 0,
    payStatus: 'N',
    balanceDue: 461.53,
    ...over,
  } as BackupServiceLog
}

// ── 1-4: imports, state, stale-cleanup ───────────────────────────────────────

describe('QBO-4A.5-RUN-3 FieldLogPanel — imports + active-row state (1-4)', () => {
  it('1: reuses the SHARED applyResolvedAccountIdToServiceLogs helper from serviceScopeMerge (not duplicated inline)', () => {
    // The helper is imported from the single source of truth.
    expect(PANEL).toMatch(/applyResolvedAccountIdToServiceLogs/)
    expect(PANEL).toMatch(/from ['"]@\/services\/serviceScopeMerge['"]/)
    // The pure helper is actually exported from serviceScopeMerge (sanity).
    expect(typeof applyResolvedAccountIdToServiceLogs).toBe('function')
  })

  it('2: imports the mapping hook + both modals + canonical directory hook + isCanonicalCustomerId (the three-state building blocks)', () => {
    expect(PANEL).toMatch(/from ['"]@\/features\/quickbooks-customer-mapping\/useQuickBooksCustomerMapping['"]/)
    expect(PANEL).toMatch(/from ['"]@\/features\/quickbooks-customer-mapping\/components\/ResolvePowerOnCustomerModal['"]/)
    expect(PANEL).toMatch(/from ['"]@\/features\/quickbooks-customer-mapping\/components\/LinkQuickBooksCustomerModal['"]/)
    // QBO-4A.6: identity authority is the canonical relationship_accounts directory
    // (useCanonicalCustomerDirectory) + the isCanonicalCustomerId predicate — NOT
    // @/lib/uuid isUuid. UUID format is no longer the customer-identity authority.
    expect(PANEL).toMatch(/from ['"]@\/features\/quickbooks-customer-mapping\/useCanonicalCustomerDirectory['"]/)
    expect(PANEL).toMatch(/from ['"]@\/features\/quickbooks-customer-mapping\/resolvePowerOnCustomerDirectory['"]/)
    expect(PANEL).not.toMatch(/from ['"]@\/lib\/uuid['"]/)
  })

  it('3: declares the two active-row target id states (resolve + link), never a per-row hook array', () => {
    expect(MAIN_CODE).toMatch(/const \[resolveTargetId, setResolveTargetId\] = useState<string \| null>\(null\)/)
    expect(MAIN_CODE).toMatch(/const \[linkTargetId, setLinkTargetId\] = useState<string \| null>\(null\)/)
  })

  it('4: stale-cleanup useEffect clears a dangling target if its log was deleted/archived', () => {
    // Locate the stale-cleanup effect by CONTENT (it references both target ids),
    // not by position — RUN-3A moved it BELOW the `backup`/`serviceLogs` declarations
    // to fix a temporal-dead-zone crash, so it is no longer the first useEffect.
    const fx = MAIN_CODE.indexOf('setResolveTargetId(null)')
    expect(fx).toBeGreaterThan(-1)
    // Slice a window around the effect body and assert the full contract.
    const eff = MAIN_CODE.slice(Math.max(0, fx - 400), fx + 200)
    expect(eff).toMatch(/resolveTargetId/)
    expect(eff).toMatch(/linkTargetId/)
    expect(eff).toMatch(/setResolveTargetId\(null\)/)
    expect(eff).toMatch(/setLinkTargetId\(null\)/)
    // Uses the already-initialized serviceLogs const (NOT backup.serviceLogs in a
    // render-evaluated dependency array before `backup` is declared — that was the TDZ bug).
    expect(eff).toMatch(/serviceLogs\.some/)
    expect(eff).toMatch(/\[serviceLogs, resolveTargetId, linkTargetId\]/)
  })
})

// ── 5-9: per-row three-state menu ─────────────────────────────────────────────

describe('QBO-4A.5-RUN-3 FieldLogPanel — per-row three-state QuickBooksMenu (5-9)', () => {
  it('5: per-row customerUuid is derived via isCanonicalCustomerId(l.accountId, canonicalIds) — non-canonical ids/names stay STATE 1', () => {
    // The row computation (inside the service-log row render). Identity is a CANONICAL
    // relationship_accounts.id (TEXT PK) validated against canonicalIds — NOT UUID format.
    expect(MAIN_CODE).toMatch(/const customerUuid = isCanonicalCustomerId\(l\.accountId, canonicalIds\) \? l\.accountId : null/)
  })

  it('6: STATE 1 — onResolveCustomer is wired when the row has NO UUID', () => {
    expect(MENU_BLOCK).toMatch(/onResolveCustomer=\{!customerUuid \? \(\) => setResolveTargetId\(l\.id\) : undefined\}/)
  })

  it('7: STATE 2 — onLinkCustomer is wired when the row HAS a UUID', () => {
    expect(MENU_BLOCK).toMatch(/onLinkCustomer=\{customerUuid \? \(\) => setLinkTargetId\(l\.id\) : undefined\}/)
  })

  it('8: never both at once — the two conditions are complementary over the SAME customerUuid', () => {
    // Exactly one of {function, undefined} is chosen by the same boolean, so the row
    // is in exactly one identity state. Both props are present in source, but their
    // guards are logical complements (!customerUuid vs customerUuid).
    expect(MENU_BLOCK).toMatch(/!customerUuid \?/)
    expect(MENU_BLOCK).toMatch(/customerUuid \? \(\) => setLinkTargetId/)
  })

  it('9: Prepare Invoice + Invoice Drafts are preserved untouched on the contextual menu', () => {
    expect(MENU_BLOCK).toMatch(/onPrepareInvoice=\{\(\) => openPrepareInvoice\(l\)\}/)
    expect(MENU_BLOCK).toMatch(/onOpenDrafts=\{qb\.openDrafts\}/)
  })
})

// ── 10: contextual vs global menu ─────────────────────────────────────────────

describe('QBO-4A.5-RUN-3 FieldLogPanel — contextual menu is NOT the global menu (10)', () => {
  it('10: the contextual menu carries NO global-only props (Import QB PDF / Connect / connection-status / showPrepareInvoice)', () => {
    expect(MENU_BLOCK).not.toMatch(/onImportQbPdf|onConnect|connectionStatus|showPrepareInvoice/i)
  })
})

// ── 11-16: resolve handler financial firewall ───────────────────────────────

describe('QBO-4A.5-RUN-3 resolveFieldLogCustomer — identity-only firewall (11-16)', () => {
  it('11: the handler signature is (logId, accountUuid) via useCallback', () => {
    expect(HANDLER_START).toBeGreaterThan(-1)
    expect(HANDLER).toMatch(/resolveFieldLogCustomer = useCallback\(/)
    expect(HANDLER).toMatch(/async \(logId: string, accountUuid: string\): Promise<void>/)
  })

  it('12: the local mutation + post-merge force BOTH use the shared applyResolvedAccountIdToServiceLogs helper (single source)', () => {
    // Optimistic local mutation.
    expect(HANDLER).toMatch(/backup\.serviceLogs = applyResolvedAccountIdToServiceLogs\(/)
    // Post-merge force passed into saveServiceLogsScoped.
    expect(HANDLER).toMatch(/saveServiceLogsScoped\(backup, \(logs\) =>[\s\S]*?applyResolvedAccountIdToServiceLogs\(logs, logId, accountUuid\)/)
  })

  it('13 firewall: the handler does NOT bump updatedAt — a stale-local row can never win LWW', () => {
    expect(HANDLER).not.toMatch(/new Date\(\)\.toISOString\(\)/)
    expect(HANDLER).not.toMatch(/updatedAt:\s*now/)
    expect(HANDLER).not.toMatch(/accountId: accountUuid, updatedAt/)
    expect(HANDLER).not.toMatch(/, updatedAt:/)
  })

  it('14 firewall: the handler writes NO financial field — quoted/collected/mat/payStatus/balanceDue/payments/hrs/opCost untouched', () => {
    expect(HANDLER).not.toMatch(/\bquoted\b/)
    expect(HANDLER).not.toMatch(/\bcollected\b/)
    expect(HANDLER).not.toMatch(/\bpayStatus\b/)
    expect(HANDLER).not.toMatch(/\bbalanceDue\b/)
    expect(HANDLER).not.toMatch(/\bmat\b/)
    expect(HANDLER).not.toMatch(/\bpayments\b/)
    expect(HANDLER).not.toMatch(/\bhrs\b/)
    expect(HANDLER).not.toMatch(/\bopCost\b/)
  })

  it('15: the handler does NOT reuse the Migrate path (migrateServiceLog)', () => {
    expect(HANDLER).not.toMatch(/migrateServiceLog/)
  })

  it('16: the handler does NO QBO API write / no direct fetch — only the backup scoped sync', () => {
    expect(HANDLER).not.toMatch(/intuit|quickbooks\.api|createQbo|sendToQuickBooks|syncCustomer/i)
    expect(HANDLER).not.toMatch(/\bfetch\s*\(/)
    // It routes through the existing scoped save (which itself uses the service.calls scope).
    expect(HANDLER).toMatch(/saveServiceLogsScoped/)
  })
})

// ── 17-19: lazy active-row controller ─────────────────────────────────────────

describe('QBO-4A.5-RUN-3 FieldLogPanel — lazy active-row controller (17-19)', () => {
  it('17 PERFORMANCE RULE: useQuickBooksCustomerMapping is called ONLY in FieldLogQboLinkController, never per-row in the main render body', () => {
    // The main body has the import + comments, but NO hook CALL (no `useQuickBooksCustomerMapping(`).
    expect(MAIN_CODE).not.toMatch(/useQuickBooksCustomerMapping\(/)
    // The controller is the one and only call site.
    const calls = (PANEL.match(/useQuickBooksCustomerMapping\(/g) || []).length
    expect(calls).toBe(1)
    expect(CONTROLLER_CODE).toMatch(/useQuickBooksCustomerMapping\(\{ poweronCustomerId, connected \}\)/)
  })

  it('18: the Resolve modal is presentational + mounted lazily only when resolveTargetId is set (no hook, no network)', () => {
    // ResolvePowerOnCustomerModal is rendered, gated by resolveTargetId.
    expect(MAIN_CODE).toMatch(/resolveTargetId && \(\(\) => \{/)
    expect(MAIN_CODE).toMatch(/<ResolvePowerOnCustomerModal/)
    // QBO-4A.6: the modal receives the canonical directory (falls back to gcContacts
    // customerDirectory while loading) + canonicalIds + loading — NOT a UUID filter.
    expect(MAIN_CODE).toMatch(/directory=\{dir\}/)
    expect(MAIN_CODE).toMatch(/canonicalIds=\{canonicalIds\}/)
    expect(MAIN_CODE).toMatch(/loading=\{canonicalDirectory\.loading\}/)
    expect(MAIN_CODE).toMatch(/onConfirm=\{\(uuid\) => \{ if \(log\) resolveFieldLogCustomer\(log\.id, uuid\) \}\}/)
  })

  it('19: the Link controller is mounted lazily only when linkTargetId is set and forwards all host-owned props', () => {
    expect(MAIN_CODE).toMatch(/linkTargetId && \(\(\) => \{/)
    expect(MAIN_CODE).toMatch(/<FieldLogQboLinkController/)
    expect(MAIN_CODE).toMatch(/poweronCustomerId=\{customerUuid\}/)
    expect(MAIN_CODE).toMatch(/customerName=\{log \? canonicalCustomerName\(log\) : null\}/)
    expect(MAIN_CODE).toMatch(/customerDirectory=\{customerDirectory\}/)
    expect(MAIN_CODE).toMatch(/connected=\{!!conn\.status\?\.connected\}/)
    expect(MAIN_CODE).toMatch(/onConnect=\{conn\.connect\}/)
  })
})

// ── 20-21: immediate transition + no migration ───────────────────────────────

describe('QBO-4A.5-RUN-3 FieldLogPanel — immediate transition + migration ceiling (20-21)', () => {
  it('20: immediate visible STATE 1 → STATE 2 transition without a full reload — resolve sets linkTargetId(logId)', () => {
    // After persisting identity, the handler closes Resolve and primes Link for the
    // same row so the menu re-renders Link and the owner can link straight away.
    expect(HANDLER).toMatch(/setResolveTargetId\(null\)/)
    expect(HANDLER).toMatch(/setLinkTargetId\(logId\)/)
    expect(HANDLER).toMatch(/forceUpdate\(\)/)
  })

  it('21 MIGRATION RULE: no migration was created FOR the field-log accountId — identity stays an additive JSON-blob (migration 134 is the separate QBO mapping text-identity migration)', () => {
    // The Field Log customer identity is an additive optional accountId JSON-blob on
    // BackupServiceLog — NO schema migration was created for it. (QBO-4A.6 migration
    // 134_quickbooks_customer_mapping_text_identity.sql alters the QBO CUSTOMER MAPPING
    // table's poweron_customer_id column UUID→TEXT — a different concern, not a field-
    // log schema change.) The field-log-specific filenames do not exist.
    expect(existsSync(join(ROOT, 'supabase/migrations/134_qbo_field_log_customer_account_id.sql'))).toBe(false)
    expect(existsSync(join(ROOT, 'supabase/migrations/134.sql'))).toBe(false)
  })
})

// ── Pure: the shared helper is identity-only + financial-neutral under the real merge ─

describe('QBO-4A.5-RUN-3 applyResolvedAccountIdToServiceLogs — pure identity-only helper (firewall proof)', () => {
  it('only the matching log receives accountId; every other row is returned unchanged (same reference)', () => {
    const a = makeLog({ id: 'svc-A' })
    const b = makeLog({ id: 'svc-B', quoted: 999, accountId: UUID_Y })
    const c = makeLog({ id: 'svc-C' })
    const out = applyResolvedAccountIdToServiceLogs([a, b, c], 'svc-A', UUID_X)
    expect(out[0].accountId).toBe(UUID_X)
    // svc-B is the SAME reference (no spread, no mutation).
    expect(out[1]).toBe(b)
    expect(out[1].accountId).toBe(UUID_Y)
    expect(out[1].quoted).toBe(999)
    expect(out[2]).toBe(c)
    expect(out[2].accountId).toBeUndefined()
  })

  it('does NOT bump updatedAt and writes NO financial field — identity-only', () => {
    const a = makeLog({ id: 'svc-A', updatedAt: '2026-08-16T08:00:00.000Z', quoted: 461.53, collected: 0 })
    const out = applyResolvedAccountIdToServiceLogs([a], 'svc-A', UUID_X)
    expect(out[0].accountId).toBe(UUID_X)
    expect(out[0].updatedAt).toBe('2026-08-16T08:00:00.000Z') // unchanged
    expect(out[0].quoted).toBe(461.53) // unchanged
    expect(out[0].collected).toBe(0) // unchanged
  })

  it('is pure — never mutates the input array or its rows', () => {
    const a = makeLog({ id: 'svc-A' })
    const snap = JSON.parse(JSON.stringify([a]))
    applyResolvedAccountIdToServiceLogs([a], 'svc-A', UUID_X)
    expect([a]).toEqual(snap)
  })

  it('firewall: local identity (no updatedAt bump) + post-merge force over the REAL merge — remote financials win, identity persists', () => {
    // REMOTE: a newer financial edit (payment recorded elsewhere). No accountId.
    const remoteLog = makeLog({
      quoted: 500, collected: 200, payStatus: 'Y', balanceDue: 300, mat: 50,
      payments: [{ id: 'pay-remote-1', amount: 200, receivedAt: '2026-08-19', kind: 'payment' }] as any,
      updatedAt: '2026-08-19T10:00:00.000Z',
    })
    // LOCAL: owner just resolved identity. accountId set, updatedAt OLDER (not bumped).
    const localLog = makeLog({
      accountId: UUID_X, quoted: 461.53, collected: 0, payStatus: 'N', balanceDue: 461.53, mat: 0,
      payments: [] as any, updatedAt: '2026-08-16T08:00:00.000Z',
    })
    const merged = mergeServiceLogsIntoRemote(
      { serviceLogs: [remoteLog] } as unknown as BackupData,
      { serviceLogs: [localLog] } as unknown as BackupData,
    )
    // RUN-3 post-merge force via the SAME helper the handler uses.
    merged.serviceLogs = applyResolvedAccountIdToServiceLogs(merged.serviceLogs, 'svc-A', UUID_X)
    const row = merged.serviceLogs.find((l) => l.id === 'svc-A')!
    // Identity persisted via the force.
    expect(row.accountId).toBe(UUID_X)
    // FINANCIAL FIREWALL: remote's newer financials won LWW; local stale values did NOT clobber.
    expect(row.quoted).toBe(500)
    expect(row.collected).toBe(200)
    expect(row.mat).toBe(50)
    expect(row.payStatus).not.toBe('N')
    expect((row.payments as any[]).some((p) => p.id === 'pay-remote-1')).toBe(true)
    expect(row.updatedAt).toBe('2026-08-19T10:00:00.000Z') // remote's, not bumped
  })
})