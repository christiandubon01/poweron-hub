/**
 * QBO-4A.5-RUN-1 focused tests — Resolve PowerOn Customer UX Dead-End.
 *
 * Runtime defect (owner): a billing source whose customer is a legacy NAME
 * snapshot with NO canonical PowerOn customer identity (no relationship_accounts.id)
 * showed "Customer identity needs to be resolved" with NO actionable control
 * (dead-end). This fix adds an explicit, owner-driven "Resolve Customer" flow that
 * binds the source to an EXISTING PowerOn relationship account so the normal QBO
 * mapping workflow becomes reachable — without guessing identity by name, without
 * a QBO write, and without a billing gate.
 *
 * QBO-4A.6: canonical PowerOn customer ids are TEXT (relationship_accounts.id —
 * 'gc...', 'import_gc_...'), NOT UUIDs. Identity is validated against the
 * authoritative canonicalIds set (sourced from relationship_accounts), NEVER by
 * UUID format, name match, or browser payload.
 *
 * 20 scenarios. Like QBO-4A.4, the repo has NO DOM render harness, so UI-behavioral
 * scenarios are covered two ways:
 *  1. PURE-FUNCTION unit tests over resolvePowerOnCustomerDirectory.ts (the only
 *     logic) — prove the selectable set is CANONICAL (present in canonicalIds;
 *     accepts TEXT ids, rejects ids absent from relationship_accounts + names),
 *     search is local/case-insensitive, and nothing auto-selects.
 *  2. SOURCE-CONTRACT tests — read component/host source, strip BOTH block and
 *     line comments, and assert the locked three-state UX, the explicit-confirm
 *     flow, persistence onto the CURRENT source's canonical accountId via the
 *     EXISTING path (predicate-scoped → no unrelated records, no bulk backfill),
 *     non-gating Prepare Invoice, and the billing-draft firewall.
 *
 * Nothing here renders React or hits a network.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  filterResolveEntries,
  formatResolveEntryLabel,
  selectableResolveEntries,
} from '../resolvePowerOnCustomerDirectory'
import type { CustomerDirectoryEntry } from '../qboCustomerMappingTypes'

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'
// QBO-4A.6: canonical PowerOn customer ids are TEXT (relationship_accounts.id, a
// TEXT PRIMARY KEY). Real ids include legacy 'gc...' / 'import_gc...' values — NOT
// UUIDs. Identity is NEVER validated by format here; an id is selectable IFF it is
// present in the authoritative canonicalIds set (sourced from relationship_accounts).
const GC_CANONICAL = 'gc2'                // a real TEXT relationship_accounts.id (canonical)
const IMPORT_GC_CANONICAL = 'import_gc_7' // another real TEXT canonical id

const DIRECTORY: CustomerDirectoryEntry[] = [
  { id: UUID_A, company: 'Acme Corp', contact: 'Joe Smith', email: 'acme@example.com', phone: '555-0001' },
  { id: UUID_B, company: 'Beta LLC', contact: 'Jane Doe', email: 'beta@example.com', phone: '555-0002' },
  { id: UUID_C, company: null, contact: 'Gamma Contact', email: null, phone: null },
  // Canonical TEXT ids — REAL relationship_accounts.id values, SELECTABLE.
  { id: GC_CANONICAL, company: 'Hernandez Construction', contact: 'R. Hernandez', email: 'h@g.co', phone: null },
  { id: IMPORT_GC_CANONICAL, company: 'Martin Pools', contact: 'Martin', email: null, phone: null },
  // Rejected: a TEXT id that is NOT in relationship_accounts (local-only / unpersisted).
  { id: 'gc1700000000000', company: 'Temp Local', contact: 'Temp', email: 't@e.co', phone: null },
  // Rejected: a bare name string used as an id (never a relationship_accounts.id).
  { id: 'test', company: 'Name Only', contact: 'Namey', email: null, phone: null },
  // Rejected: empty/missing id.
  { id: '', company: 'Empty Id', contact: 'Nobody', email: null, phone: null },
]

// The authoritative canonical id set (relationship_accounts.id for the org).
const CANONICAL_IDS: ReadonlySet<string> = new Set([UUID_A, UUID_B, UUID_C, GC_CANONICAL, IMPORT_GC_CANONICAL])

// ── Pure helper tests ─────────────────────────────────────────────────────────

describe('QBO-4A.6 resolve directory — selectable set is CANONICAL (relationship_accounts.id), not UUID (5,9)', () => {
  it('5: selectableResolveEntries keeps only entries whose id is in canonicalIds', () => {
    const sel = selectableResolveEntries(DIRECTORY, CANONICAL_IDS)
    expect(sel.map((c) => c.id).sort()).toEqual([UUID_A, UUID_B, UUID_C, GC_CANONICAL, IMPORT_GC_CANONICAL].sort())
  })

  it('9: TEXT canonical ids (gc/import_gc) ARE selectable — identity is NEVER validated by UUID format', () => {
    const sel = selectableResolveEntries(DIRECTORY, CANONICAL_IDS)
    const ids = sel.map((c) => c.id)
    expect(ids).toContain(GC_CANONICAL)
    expect(ids).toContain(IMPORT_GC_CANONICAL)
    // A UUID-format id is also canonical when present — format is irrelevant.
    expect(ids).toContain(UUID_A)
  })

  it('9: ids ABSENT from canonicalIds (local-only gc, bare names, empty) can NEVER be selected/persisted', () => {
    const sel = selectableResolveEntries(DIRECTORY, CANONICAL_IDS)
    const ids = sel.map((c) => c.id)
    expect(ids).not.toContain('gc1700000000000')
    expect(ids).not.toContain('test')
    expect(ids).not.toContain('')
    // selectableResolveEntries is the single source of the selectable set — a
    // caller cannot sneak a non-canonical id through by passing it directly.
    expect(sel.every((c) => CANONICAL_IDS.has(c.id))).toBe(true)
  })

  it('5: an empty canonicalIds set yields an empty selectable set (nothing is canonical yet)', () => {
    expect(selectableResolveEntries(DIRECTORY, new Set<string>())).toEqual([])
  })

  it('5: an empty directory yields an empty selectable set (no fabricated entries)', () => {
    expect(selectableResolveEntries([], CANONICAL_IDS)).toEqual([])
    expect(selectableResolveEntries(undefined as unknown as CustomerDirectoryEntry[], CANONICAL_IDS)).toEqual([])
  })
})

describe('QBO-4A.5 resolve directory — local search, never auto-select (6,7,8)', () => {
  it('6/7: an empty search term returns every selectable entry but selects NONE (no name-match auto-select)', () => {
    const sel = selectableResolveEntries(DIRECTORY, CANONICAL_IDS)
    const results = filterResolveEntries(sel, '')
    expect(results).toHaveLength(5)
    // filterResolveEntries is a pure filter — it returns entries, never a chosen id.
    // There is no "selected" concept here; selection lives only in the modal state.
    expect(Array.isArray(results)).toBe(true)
  })

  it('7: a term that exactly matches a snapshot name does NOT reduce to a forced single match — matching is plain substring, selection is separate', () => {
    const sel = selectableResolveEntries(DIRECTORY, CANONICAL_IDS)
    // 'Acme Corp' matches only by its own company field; the helper does not know
    // about the source's current-record name snapshot and never auto-selects it.
    const results = filterResolveEntries(sel, 'acme corp')
    expect(results.map((c) => c.id)).toEqual([UUID_A])
    // A term matching multiple is returned as-is (no auto-pick of "the closest").
    const multi = filterResolveEntries(sel, 'example.com')
    expect(multi.map((c) => c.id).sort()).toEqual([UUID_A, UUID_B])
  })

  it('search is case-insensitive and spans company/contact/email/phone', () => {
    const sel = selectableResolveEntries(DIRECTORY, CANONICAL_IDS)
    expect(filterResolveEntries(sel, 'JANE').map((c) => c.id)).toEqual([UUID_B])
    expect(filterResolveEntries(sel, '555-0001').map((c) => c.id)).toEqual([UUID_A])
    expect(filterResolveEntries(sel, 'GAMMA').map((c) => c.id)).toEqual([UUID_C])
    // A canonical TEXT-id customer is searchable like any other.
    expect(filterResolveEntries(sel, 'hernandez').map((c) => c.id)).toEqual([GC_CANONICAL])
  })

  it('a term matching no selectable entry returns an empty list (the modal shows "No existing PowerOn customer found.")', () => {
    const sel = selectableResolveEntries(DIRECTORY, CANONICAL_IDS)
    expect(filterResolveEntries(sel, 'zzz-nope')).toEqual([])
  })

  it('8: formatResolveEntryLabel prefers company then contact, never falls back to an id', () => {
    expect(formatResolveEntryLabel(DIRECTORY[0])).toBe('Acme Corp')
    expect(formatResolveEntryLabel(DIRECTORY[2])).toBe('Gamma Contact') // company null → contact
    expect(formatResolveEntryLabel({ id: UUID_A, company: null, contact: null })).toBe('(unnamed account)')
  })
})

// ── Source-contract: ResolvePowerOnCustomerModal (1,6,7,8,10,12,16) ───────────

const RESOLVE_MODAL = read('src/features/quickbooks-customer-mapping/components/ResolvePowerOnCustomerModal.tsx')
const RESOLVE_MODAL_CODE = stripComments(RESOLVE_MODAL)

describe('QBO-4A.5 ResolvePowerOnCustomerModal — explicit confirm, context-only name (1,6,7,8,10,12,16)', () => {
  it('1: renders an actionable Resolve Customer flow for an unresolved source', () => {
    expect(RESOLVE_MODAL_CODE).toContain('RESOLVE CUSTOMER')
    expect(RESOLVE_MODAL_CODE).toMatch(/aria-label="Resolve PowerOn Customer"/)
  })

  it('6: the current record name snapshot is CONTEXT ONLY — displayed, never used to match or auto-select', () => {
    expect(RESOLVE_MODAL_CODE).toContain('Current record customer')
    expect(RESOLVE_MODAL_CODE).toContain('Shown for context only')
    expect(RESOLVE_MODAL_CODE).toMatch(/never auto-selected by matching this name/)
    // There is no code path that seeds selectedId from currentName.
    expect(RESOLVE_MODAL_CODE).not.toMatch(/selectedId.*currentName|currentName.*selectedId/)
  })

  it('7: even an exact name match does NOT auto-select — selectedId starts null and is set only by an explicit radio onChange', () => {
    // selectedId initializes to null (no preselection).
    expect(RESOLVE_MODAL_CODE).toMatch(/useState<string \| null>\(null\)/)
    // Selection happens only via the radio onChange handler.
    expect(RESOLVE_MODAL_CODE).toMatch(/onChange=\{\(\) => setSelectedId\(r\.id\)\}/)
    // Searching again clears any selection (no sticky auto-pick).
    expect(RESOLVE_MODAL_CODE).toMatch(/setTerm\(e\.target\.value\); setSelectedId\(null\)/)
  })

  it('8: "Confirm Customer" is disabled until a row is explicitly selected (owner must choose)', () => {
    expect(RESOLVE_MODAL_CODE).toMatch(/disabled=\{!selectedId \|\| busy\}/)
    expect(RESOLVE_MODAL_CODE).toMatch(/onConfirm\(selectedId\)/)
    // handleConfirm returns early without a selection.
    expect(RESOLVE_MODAL_CODE).toMatch(/if \(!selectedId \|\| busy\) return/)
  })

  it('10/12: confirm forwards only the explicitly selected canonical id to the host (host owns persistence)', () => {
    expect(RESOLVE_MODAL_CODE).toMatch(/onConfirm:\s*\(accountId: string\) => void/)
    expect(RESOLVE_MODAL_CODE).toMatch(/onConfirm\(selectedId\)/)
    // The modal holds NO persistence authority — no save/backup/db call.
    expect(RESOLVE_MODAL_CODE).not.toMatch(/saveBackupData|pushState|\.update\(|\.upsert\(|supabase/i)
  })

  it('9: no matching PowerOn customer renders "No existing PowerOn customer found." — customer creation is NOT added', () => {
    expect(RESOLVE_MODAL_CODE).toContain('No existing PowerOn customer found.')
    // No inline customer-creation form was bolted on (locked: do not widen).
    expect(RESOLVE_MODAL_CODE).not.toMatch(/Create PowerOn Customer|createCustomer|new PowerOn customer/i)
  })

  it('16: the Resolve modal performs NO QBO write and NO network fetch', () => {
    expect(RESOLVE_MODAL_CODE).not.toMatch(/\bfetch\s*\(/)
    expect(RESOLVE_MODAL_CODE).not.toMatch(/intuit|quickbooks\.api|createQbo|sendToQuickBooks|syncCustomer/i)
    // It imports only the pure directory helpers + types — no client/hook.
    expect(RESOLVE_MODAL_CODE).toMatch(/from '\.\.\/resolvePowerOnCustomerDirectory'/)
    expect(RESOLVE_MODAL_CODE).not.toMatch(/qboCustomerMappingClient|useQuickBooksCustomerMapping/)
  })

  it('the selectable list is built from selectableResolveEntries(directory, canonicalIds) + filterResolveEntries (local search)', () => {
    expect(RESOLVE_MODAL_CODE).toMatch(/selectableResolveEntries\(directory, canonicalIds\)/)
    expect(RESOLVE_MODAL_CODE).toMatch(/filterResolveEntries\(selectable, term\)/)
  })
})

// ── Source-contract: QuickBooksCustomerStatus STATE 1 actionable (1) ──────────

const STATUS = read('src/features/quickbooks-customer-mapping/components/QuickBooksCustomerStatus.tsx')
const STATUS_CODE = stripComments(STATUS)

describe('QBO-4A.5 QuickBooksCustomerStatus — STATE 1 actionable, safe passive fallback (1)', () => {
  it('1: when onResolveCustomer is provided, the unresolved state shows the [Resolve Customer] action (not a dead-end)', () => {
    expect(STATUS_CODE).toMatch(/onResolveCustomer \?/)
    expect(STATUS_CODE).toContain('Resolve Customer')
    expect(STATUS_CODE).toMatch(/setResolveOpen\(true\)/)
    expect(STATUS_CODE).toContain('Customer needs to be confirmed before QuickBooks can be linked')
  })

  it('1: when onResolveCustomer is omitted, the unresolved state stays a SAFE passive message (no invented persistence)', () => {
    // The passive branch renders the same message WITHOUT the action button.
    const unresolvedIdx = STATUS_CODE.indexOf("s.kind === 'unresolved'")
    expect(unresolvedIdx).toBeGreaterThan(-1)
    const block = STATUS_CODE.slice(unresolvedIdx, STATUS_CODE.indexOf("s.kind === 'disconnected'"))
    expect(block).toContain('Customer needs to be confirmed before QuickBooks can be linked')
    // The Resolve modal is rendered ONLY when onResolveCustomer is provided.
    expect(STATUS_CODE).toMatch(/\{onResolveCustomer &&/)
  })

  it('confirming resolves via the host callback then closes the modal', () => {
    expect(STATUS_CODE).toMatch(/onResolveCustomer\(uuid\)/)
    expect(STATUS_CODE).toMatch(/setResolveOpen\(false\)/)
  })
})

// ── Source-contract: QuickBooksMenu Resolve item (2) ───────────────────────────

const MENU = read('src/features/billing-draft/components/QuickBooksMenu.tsx')
const MENU_CODE = stripComments(MENU)

describe('QBO-4A.5 QuickBooksMenu — Resolve Customer item (2)', () => {
  it('2: the menu renders a "Resolve Customer for QuickBooks" item only when onResolveCustomer is provided', () => {
    expect(MENU_CODE).toMatch(/onResolveCustomer &&/)
    expect(MENU_CODE).toContain('Resolve Customer for QuickBooks')
    // It uses the UserCheck icon (amber) to distinguish from the Link item.
    expect(MENU_CODE).toMatch(/UserCheck/)
  })

  it('2: the Resolve item is distinct from the Link item — host passes one or the other by state', () => {
    // Both items exist as separate guarded blocks; neither is a renamed alias.
    expect(MENU_CODE).toMatch(/onResolveCustomer &&/)
    expect(MENU_CODE).toMatch(/onLinkCustomer &&/)
    // No standalone Resolve button outside the dropdown.
    expect(MENU_CODE).not.toMatch(/<button[^>]*>\s*Resolve Customer for QuickBooks/)
  })
})

// ── Source-contract: Service Call host wiring (10,11,12,17,18) ────────────────

const SERVICE_CALLS = read('src/components/v15r/V15rServiceCallsV2.tsx')

describe('QBO-4A.5 Service Call host — resolve persists accountId on the CURRENT call only (10,11,12,17,18)', () => {
  it('10: resolveCallCustomer writes the reconciled UUID to the call accountId via the EXISTING persist path', () => {
    expect(SERVICE_CALLS).toMatch(/resolveCallCustomer = useCallback\(\(callId: string, accountUuid: string\)/)
    // Predicate-scoped map: only the matching call is changed.
    expect(SERVICE_CALLS).toMatch(/r\.service_call_id === callId \? \{ \.\.\.r, accountId: accountUuid \} : r/)
    // Persisted via the existing saveServiceCallRecords-backed persist().
    expect(SERVICE_CALLS).toMatch(/persist\(updated\)/)
  })

  it('17: ONLY the matching call is modified — the map predicate leaves every other record untouched', () => {
    // The map returns `r` unchanged for non-matching rows (no spread, no mutation).
    expect(SERVICE_CALLS).toMatch(/r\.service_call_id === callId \? \{ \.\.\.r, accountId: accountUuid \} : r/)
    // No broad backfill pass writes accountId across all records.
    expect(SERVICE_CALLS).not.toMatch(/records\.forEach\([^)]*accountId/s)
    expect(SERVICE_CALLS).not.toMatch(/for\s*\([^)]*of records[^)]*accountId/s)
  })

  it('18: there is no bulk legacy backfill of customer identity anywhere in the service-call host', () => {
    // No NEW bulk function was added (comment-stripped so documenting comments
    // like "no bulk backfill" don't false-positive). The legacy tab keeps its
    // existing per-row Migrate → button (not an auto bulk pass).
    const SVC_CODE = stripComments(SERVICE_CALLS)
    expect(SVC_CODE).not.toMatch(/migrateAll|bulkMigrate|backfillAll|backfillAccounts/i)
    expect(SERVICE_CALLS).toContain('Migrate →')
  })

  it('2/11: ServiceCallCard opens Resolve only when the call has NO customerUuid (STATE 1) and offers Link when it does', () => {
    expect(SERVICE_CALLS).toMatch(/onResolveCustomer=\{!customerUuid \? \(\) => setResolveOpen\(true\) : undefined\}/)
    expect(SERVICE_CALLS).toMatch(/onLinkCustomer=\{customerUuid \? \(\) => setLinkCustomerOpen\(true\) : undefined\}/)
  })

  it('12: the ServiceCallCard renders the Resolve modal and forwards the confirmed UUID to onResolveCustomer', () => {
    const cardIdx = SERVICE_CALLS.indexOf('function ServiceCallCard')
    expect(cardIdx).toBeGreaterThan(-1)
    const card = SERVICE_CALLS.slice(cardIdx, SERVICE_CALLS.indexOf('function LegacyServiceLogList'))
    expect(card).toMatch(/ResolvePowerOnCustomerModal/)
    expect(card).toMatch(/onConfirm=\{\(uuid\) => \{ onResolveCustomer\(uuid\); setResolveOpen\(false\) \}\}/)
  })

  it('23/legacy: the legacy service-log path NOW wires Resolve (STATE 1) + Link (STATE 2) — RUN-2 closed the dead-end', () => {
    // RUN-1 intentionally left the legacy BackupServiceLog path unwired (no safe
    // persistence path). RUN-2 added the canonical accountId persistence path, so
    // the legacy card now mirrors ServiceCallCard: Resolve when no UUID, Link when
    // resolved. The legacy card is a separate component owning its own mapping hook.
    const cardIdx = SERVICE_CALLS.indexOf('function LegacyServiceLogCard')
    expect(cardIdx).toBeGreaterThan(-1)
    const card = SERVICE_CALLS.slice(cardIdx, SERVICE_CALLS.indexOf('// ─── Sub-components'))
    // Identity derived from the log's canonical accountId (a CANONICAL relationship_accounts.id,
    // validated against canonicalIds — NOT by UUID format).
    expect(card).toMatch(/isCanonicalCustomerId\(log\.accountId, canonicalIds\) \? log\.accountId : null/)
    // STATE 1 → Resolve item when no UUID; STATE 2 → Link item when resolved.
    expect(card).toMatch(/onResolveCustomer=\{!customerUuid \? \(\) => setResolveOpen\(true\) : undefined\}/)
    expect(card).toMatch(/onLinkCustomer=\{customerUuid \? \(\) => setLinkCustomerOpen\(true\) : undefined\}/)
    // Both modals are rendered (host owns persistence via onConfirm → onResolveCustomer).
    expect(card).toMatch(/ResolvePowerOnCustomerModal/)
    expect(card).toMatch(/LinkQuickBooksCustomerModal/)
    expect(card).toMatch(/onConfirm=\{\(uuid\) => \{ onResolveCustomer\(uuid\); setResolveOpen\(false\) \}\}/)
  })

  it('Prepare Invoice in the service-call host resolves for BOTH serviceCall AND legacy service sources (RUN-2)', () => {
    expect(SERVICE_CALLS).toMatch(/prepareOnResolveCustomer = useCallback\(\(accountUuid: string\)/)
    // Both source kinds are handled by the in-modal resolve handler.
    expect(SERVICE_CALLS).toMatch(/prepareSource\?\.kind === 'serviceCall'/)
    expect(SERVICE_CALLS).toMatch(/prepareSource\?\.kind === 'service'/)
    // The modal receives onResolveCustomer for either serviceCall or service source.
    expect(SERVICE_CALLS).toMatch(/onResolveCustomer=\{\(prepareSource\?\.kind === 'serviceCall' \|\| prepareSource\?\.kind === 'service'\) \? prepareOnResolveCustomer : undefined\}/)
  })
})

// ── Source-contract: Project host wiring (10,11,17,18) ────────────────────────

const PROJECT_INNER = read('src/components/v15r/V15rProjectInner.tsx')

describe('QBO-4A.5 Project host — resolve persists project.accountId on the CURRENT project only (10,11,17,18)', () => {
  it('10: resolveProjectCustomer writes the reconciled UUID to project accountId via the EXISTING canonical path', () => {
    expect(PROJECT_INNER).toMatch(/resolveProjectCustomer = useCallback\(\(accountUuid: string\)/)
    // Predicate-scoped map over backup.projects — only the matching project changes.
    expect(PROJECT_INNER).toMatch(/r\.id === projectId \? \{ \.\.\.r, accountId: accountUuid \} : r/)
    // Persisted via the existing pushState + saveBackupData + forceUpdate path.
    expect(PROJECT_INNER).toMatch(/pushState\(\)/)
    expect(PROJECT_INNER).toMatch(/saveBackupData\(b\)/)
    expect(PROJECT_INNER).toMatch(/forceUpdate\(\)/)
  })

  it('17: ONLY the matching project is modified — every other project row is returned unchanged', () => {
    expect(PROJECT_INNER).toMatch(/r\.id === projectId \? \{ \.\.\.r, accountId: accountUuid \} : r/)
    expect(PROJECT_INNER).not.toMatch(/projects\.forEach\([^)]*accountId/s)
    // The resolve handler itself has no loop — it is a single predicate-scoped map.
    const handler = stripComments(PROJECT_INNER.slice(
      PROJECT_INNER.indexOf('resolveProjectCustomer = useCallback'),
      PROJECT_INNER.indexOf('resolveProjectCustomer = useCallback') + 500,
    ))
    expect(handler).not.toMatch(/\.forEach\(|for\s*\(/)
  })

  it('18: no bulk legacy backfill of customer identity in the project host', () => {
    expect(stripComments(PROJECT_INNER)).not.toMatch(/migrateAll|bulkMigrate|backfillAll|backfillAccounts/i)
  })

  it('2/11: the project menu offers Resolve ONLY when projectCustomerId is absent (STATE 1), Link when present', () => {
    expect(PROJECT_INNER).toMatch(/onResolveCustomer=\{!projectCustomerId \? \(\) => setResolveOpen\(true\) : undefined\}/)
    expect(PROJECT_INNER).toMatch(/onLinkCustomer=\{projectCustomerId \? \(\) => setLinkCustomerOpen\(true\) : undefined\}/)
  })

  it('12: the project host renders the Resolve modal and persists the confirmed UUID via resolveProjectCustomer', () => {
    expect(PROJECT_INNER).toMatch(/ResolvePowerOnCustomerModal/)
    expect(PROJECT_INNER).toMatch(/resolveProjectCustomer\(uuid\)/)
    expect(PROJECT_INNER).toMatch(/setResolveOpen\(false\)/)
  })

  it('identity is derived from isCanonicalCustomerId(proj.accountId, canonicalIds) — never from the project name', () => {
    expect(PROJECT_INNER).toMatch(/isCanonicalCustomerId\(proj\.accountId, canonicalIds\) \? proj\.accountId : null/)
  })
})

// ── Source-contract: Prepare Invoice non-gating + in-modal resolve (3,11,13,14,15,19,20) ──

const PREPARE = read('src/features/billing-draft/components/PrepareInvoiceModal.tsx')
const PREPARE_CODE = stripComments(PREPARE)

describe('QBO-4A.5 Prepare Invoice — in-modal resolve, NON-GATING, firewall intact (3,11,13,14,15,19,20)', () => {
  it('3/11: the header status uses resolvedCustomerId ?? read.customerId and exposes onResolveCustomer in-modal', () => {
    expect(PREPARE_CODE).toMatch(/poweronCustomerId=\{resolvedCustomerId \?\? read\.customerId \?\? null\}/)
    expect(PREPARE_CODE).toMatch(/onResolveCustomer=\{onResolveCustomer \?/)
    // Local state is applied immediately (no full-page reload) AND forwarded to host.
    expect(PREPARE_CODE).toMatch(/setResolvedCustomerId\(uuid\)/)
    expect(PREPARE_CODE).toMatch(/onResolveCustomer\(uuid\)/)
  })

  it('11: resolvedCustomerId resets on source change so a stale resolution never leaks across sources', () => {
    expect(PREPARE_CODE).toMatch(/setResolvedCustomerId\(null\)/)
  })

  it('11/19: the resolved UUID threads into the saved draft via customerIdOverride (preserve-first, then resolved)', () => {
    expect(PREPARE_CODE).toMatch(/resolvedOverride = resolvedCustomerId \?\? undefined/)
    expect(PREPARE_CODE).toMatch(/customerIdOverride: preserveCustomerId \?\? resolvedOverride/)
  })

  it('13: Save Draft remains usable while unresolved — gated only by `saving`, never by customer state', () => {
    expect(PREPARE_CODE).toMatch(/onClick=\{handleSaveDraft\}/)
    expect(PREPARE_CODE).toMatch(/disabled=\{saving\}/)
    // The footer action guards reference no resolve/mapping condition.
    const footer = PREPARE_CODE.slice(PREPARE_CODE.indexOf('Save Draft'), PREPARE_CODE.indexOf('APPROVE INVOICE DRAFT') + 40)
    expect(footer).not.toMatch(/resolvedCustomerId|onResolveCustomer|\.linked|mapping\.state/i)
  })

  it('14: Save Draft is not blocked — no resolve condition gates the draft action', () => {
    // No `disabled` expression references the resolve/mapping state anywhere near Save Draft.
    const saveBtn = PREPARE_CODE.slice(PREPARE_CODE.indexOf('onClick={handleSaveDraft}'), PREPARE_CODE.indexOf('onClick={handleSaveDraft}') + 400)
    expect(saveBtn).toMatch(/disabled=\{saving\}/)
    expect(saveBtn).not.toMatch(/resolvedCustomerId|onResolveCustomer|!.*resolved/i)
  })

  it('15: Approve remains usable while unresolved — gated only by !draft.ready || saving', () => {
    expect(PREPARE_CODE).toMatch(/onClick=\{handleApprove\}/)
    expect(PREPARE_CODE).toMatch(/disabled=\{!draft\.ready \|\| saving\}/)
  })

  it('20: the INVOICE DRAFT READY screen (DraftReadyConfirmation) is unchanged — still exactly two buttons', () => {
    expect(PREPARE).toContain('INVOICE DRAFT READY')
    expect(PREPARE).toContain('DraftReadyConfirmation')
    const confirm = PREPARE.slice(PREPARE.indexOf('function DraftReadyConfirmation'), PREPARE.indexOf('// ── Local helpers'))
    expect(confirm).toContain('Edit Draft')
    expect(confirm).toContain('Close')
    const buttonCount = (confirm.match(/<button/g) ?? []).length
    expect(buttonCount).toBe(2)
  })

  it('19: QBO-LOG-22 firewall still green — no fetch( / Intuit / QBO-API call added to PrepareInvoiceModal', () => {
    expect(PREPARE_CODE).not.toMatch(/intuit|quickbooks\.api|appcenter\.intuit|oauth\.platform\.intuit/i)
    expect(PREPARE_CODE).not.toMatch(/\bfetch\s*\(/)
  })

  it('16: no QBO write originates from the Resolve flow — no Send/Create-QBO verbs in the resolve feature tree', () => {
    const tree =
      stripComments(read('src/features/quickbooks-customer-mapping/components/ResolvePowerOnCustomerModal.tsx')) +
      stripComments(read('src/features/quickbooks-customer-mapping/resolvePowerOnCustomerDirectory.ts'))
    expect(tree).not.toMatch(/Send to QuickBooks|createQboInvoice|createQboCustomer|sendInvoice|syncCustomer/i)
  })
})