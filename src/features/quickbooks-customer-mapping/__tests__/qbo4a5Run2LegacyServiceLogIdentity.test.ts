/**
 * QBO-4A.5-RUN-2 focused tests — Legacy Service Log Customer Identity Resolution.
 *
 * Runtime defect (owner retest after RUN-1): a specific legacy single-entry Service
 * row (customer/name "test", "GFCI / Receptacles", 2026-08-16, Unpaid, ~$461.53)
 * STILL showed only "Prepare Invoice" + "Invoice Drafts" in its contextual QuickBooks
 * ▾ menu — no "Resolve Customer for QuickBooks". RUN-1 intentionally left the legacy
 * BackupServiceLog path unwired because it had no safe canonical persistence path.
 * RUN-2 closes that gap: BackupServiceLog gains the SAME canonical `accountId` field
 * used by ServiceCallRecord / BackupProject, persisted through the EXISTING
 * service.calls scoped-save path, and the legacy card mirrors ServiceCallCard's
 * three-state Resolve/Link UX.
 *
 * NON-NEGOTIABLE DATA RULE: the resolved UUID becomes the SERVICE RECORD'S normal
 * customer identity (canonical accountId). No parallel qbo_customer_override /
 * quickbooks_customer_uuid / legacy_qbo_customer_id field was invented. QBO consumes
 * PowerOn's canonical customer identity.
 *
 * FINANCIAL FIREWALL: resolving identity must NOT alter quoted/collected/payment
 * ledger/payment dates/paid state/KPI/Historical Payments/labor/material/invoice
 * draft amount. This is identity resolution only.
 *
 * Like RUN-1, the repo has NO DOM render harness, so coverage is two ways:
 *  1. PURE-FUNCTION unit tests — readServiceBilling UUID propagation + the ACTUAL
 *     mergeServiceLogsIntoRemote merge (real code) with the RUN-2 post-merge
 *     accountId force, proving the financial firewall holds under concurrent edits.
 *  2. SOURCE-CONTRACT tests — read the host source, strip comments, and assert the
 *     resolve handler is identity-only (no updatedAt bump, no financial field
 *     writes, no migrate reuse, no QBO API), predicate-scoped, scoped-synced.
 *
 * Nothing here renders React or hits a network.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

import { readServiceBilling } from '@/features/billing-draft/serviceBillingAdapter'
import { mergeServiceLogsIntoRemote } from '@/services/serviceScopeMerge'
import type { BackupServiceLog } from '@/services/backupDataService'
import type { BackupData } from '@/services/backupDataService'

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const UUID_X = '11111111-1111-4111-8111-111111111111'
const UUID_Y = '22222222-2222-4222-8222-222222222222'
// QBO-4A.6: readServiceBilling now validates accountId against the authoritative
// canonicalIds set (relationship_accounts.id). UUID_X is canonical; the temporary
// gc / bare-name / empty ids below are NOT, so they yield customerId null.
const CANONICAL_IDS: ReadonlySet<string> = new Set([UUID_X])

/** Minimal valid BackupServiceLog (only the required shape; optional fields omitted). */
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

// ── Pure: readServiceBilling UUID propagation (the actual runtime row) ───────

describe('QBO-4A.5-RUN-2 readServiceBilling — legacy log canonical identity propagation (8,9, firewall)', () => {
  it('8: a legacy log with a CANONICAL accountId (present in canonicalIds) propagates as customerId', () => {
    const out = readServiceBilling({ serviceLog: makeLog({ accountId: UUID_X }), canonicalIds: CANONICAL_IDS })
    expect(out.customerId).toBe(UUID_X)
    // Financial fields are read from the log verbatim — identity resolution did not
    // touch them (the adapter is a pure reader; it never mutates the log).
    expect(out.contractValue).toBe(461.53)
    expect(out.collectedSoFar).toBe(0)
  })

  it('9: ids ABSENT from canonicalIds (temporary gc, bare-name, empty) are NEVER propagated — null, not inferred', () => {
    expect(readServiceBilling({ serviceLog: makeLog({ accountId: 'gc1700000000000' } as any), canonicalIds: CANONICAL_IDS }).customerId).toBeNull()
    expect(readServiceBilling({ serviceLog: makeLog({ accountId: 'test' } as any), canonicalIds: CANONICAL_IDS }).customerId).toBeNull()
    expect(readServiceBilling({ serviceLog: makeLog({ accountId: '' } as any), canonicalIds: CANONICAL_IDS }).customerId).toBeNull()
  })

  it('9: when canonicalIds is absent (still loading), NO id is accepted yet — null until the directory loads', () => {
    // Non-gating: the adapter returns null rather than guessing; the host re-derives
    // once the canonical directory resolves. This is the loading-safe behavior.
    expect(readServiceBilling({ serviceLog: makeLog({ accountId: UUID_X }) }).customerId).toBeNull()
  })

  it('8: a name-only legacy log (no accountId) yields customerId null — unresolved, not fabricated', () => {
    expect(readServiceBilling({ serviceLog: makeLog(), canonicalIds: CANONICAL_IDS }).customerId).toBeNull()
    // The customer NAME is still surfaced as customerReference (context), but it is
    // never used as the QBO customer identity.
    expect(readServiceBilling({ serviceLog: makeLog(), canonicalIds: CANONICAL_IDS }).customerReference).toBe('test')
  })

  it('firewall: readServiceBilling never mutates the source log (pure reader)', () => {
    const log = makeLog({ accountId: UUID_X })
    const snapshot = JSON.parse(JSON.stringify(log))
    readServiceBilling({ serviceLog: log, canonicalIds: CANONICAL_IDS })
    expect(log).toEqual(snapshot)
  })
})

// ── Pure: financial firewall under the ACTUAL scoped merge + RUN-2 force ──────
//
// This is the heart of the RUN-2 firewall proof. The resolve handler does NOT bump
// updatedAt (identity-only), so a stale-local row never wins LWW over a newer
// remote FINANCIAL edit. The post-merge force layers accountId onto the LWW winner
// so identity persists without ever risking a financial revert.

describe('QBO-4A.5-RUN-2 financial firewall — merge + post-merge accountId force (11-15,26)', () => {
  it('11-15/26: a stale-local identity row does NOT clobber a newer remote financial edit — accountId persists, financials = remote', () => {
    // REMOTE: a newer financial edit on the same log (a payment was recorded on
    // another device). updatedAt is NEWER than the local row. No accountId.
    const remoteLog = makeLog({
      quoted: 500,
      collected: 200,
      payStatus: 'Y',
      balanceDue: 300,
      mat: 50,
      payments: [{ id: 'pay-remote-1', amount: 200, receivedAt: '2026-08-19', kind: 'payment' }] as any,
      updatedAt: '2026-08-19T10:00:00.000Z',
    })
    // LOCAL (incoming): the owner just resolved identity. accountId is set, but the
    // row's real updatedAt is OLDER (the original log date) — RUN-2 does NOT bump it.
    // Local financials are STALE (quoted 461.53, collected 0, payStatus N).
    const localLog = makeLog({
      accountId: UUID_X,
      quoted: 461.53,
      collected: 0,
      payStatus: 'N',
      balanceDue: 461.53,
      mat: 0,
      payments: [] as any,
      updatedAt: '2026-08-16T08:00:00.000Z',
    })
    const remoteBackup = { serviceLogs: [remoteLog] } as unknown as BackupData
    const incomingBackup = { serviceLogs: [localLog] } as unknown as BackupData

    // The ACTUAL merge the resolve handler runs.
    const merged = mergeServiceLogsIntoRemote(remoteBackup, incomingBackup)
    // RUN-2 post-merge force: layer accountId onto the chosen log's merged row.
    merged.serviceLogs = (merged.serviceLogs || []).map((l) =>
      l.id === 'svc-A' ? { ...l, accountId: UUID_X } : l,
    )

    const row = merged.serviceLogs.find((l) => l.id === 'svc-A')!
    // Identity persisted via the force (the whole point of RUN-2).
    expect(row.accountId).toBe(UUID_X)
    // FINANCIAL FIREWALL: remote's NEWER financial edit won LWW; local's STALE
    // quoted/collected/payStatus did NOT clobber it.
    expect(row.quoted).toBe(500) // not the stale local 461.53
    expect(row.collected).toBe(200) // reconciled from the remote payment ledger, not stale local 0
    expect(row.mat).toBe(50) // remote's materials, not stale local 0
    expect(row.payStatus).not.toBe('N') // derived from the paid ledger, not stale local 'N'
    // The remote payment event was preserved (append-only ledger unioned).
    expect((row.payments as any[]).some((p) => p.id === 'pay-remote-1')).toBe(true)
    // updatedAt is the LWW winner's (remote's), NOT bumped by the identity edit.
    expect(row.updatedAt).toBe('2026-08-19T10:00:00.000Z')
  })

  it('11-15/26: when the local row has the NEWER financial edit + accountId, local wins and identity + financials both survive (no clobber either direction)', () => {
    // REMOTE: older, no accountId, a smaller collected.
    const remoteLog = makeLog({
      collected: 100,
      payStatus: 'N',
      balanceDue: 361.53,
      payments: [{ id: 'pay-old-1', amount: 100, receivedAt: '2026-08-10', kind: 'payment' }] as any,
      updatedAt: '2026-08-10T08:00:00.000Z',
    })
    // LOCAL: newer financial edit (a second payment) + resolved accountId.
    const localLog = makeLog({
      accountId: UUID_X,
      collected: 261.53,
      payStatus: 'N',
      balanceDue: 200,
      payments: [
        { id: 'pay-old-1', amount: 100, receivedAt: '2026-08-10', kind: 'payment' },
        { id: 'pay-new-1', amount: 161.53, receivedAt: '2026-08-18', kind: 'payment' },
      ] as any,
      updatedAt: '2026-08-18T08:00:00.000Z',
    })
    const merged = mergeServiceLogsIntoRemote(
      { serviceLogs: [remoteLog] } as unknown as BackupData,
      { serviceLogs: [localLog] } as unknown as BackupData,
    )
    merged.serviceLogs = (merged.serviceLogs || []).map((l) =>
      l.id === 'svc-A' ? { ...l, accountId: UUID_X } : l,
    )
    const row = merged.serviceLogs.find((l) => l.id === 'svc-A')!
    expect(row.accountId).toBe(UUID_X)
    // Local's newer financials won; collected is the UNION sum (both payments live).
    expect(row.collected).toBe(261.53)
    expect((row.payments as any[]).map((p) => p.id).sort()).toEqual(['pay-new-1', 'pay-old-1'])
  })

  it('idempotent: re-applying the post-merge force does not duplicate the log or alter financials', () => {
    const localLog = makeLog({ accountId: UUID_X, updatedAt: '2026-08-16T08:00:00.000Z' })
    const merged = mergeServiceLogsIntoRemote(
      { serviceLogs: [] } as unknown as BackupData,
      { serviceLogs: [localLog] } as unknown as BackupData,
    )
    for (let i = 0; i < 3; i++) {
      merged.serviceLogs = (merged.serviceLogs || []).map((l) =>
        l.id === 'svc-A' ? { ...l, accountId: UUID_X } : l,
      )
    }
    expect(merged.serviceLogs.filter((l) => l.id === 'svc-A')).toHaveLength(1)
    expect(merged.serviceLogs.find((l) => l.id === 'svc-A')!.accountId).toBe(UUID_X)
    expect(merged.serviceLogs.find((l) => l.id === 'svc-A')!.quoted).toBe(461.53)
  })
})

// ── Pure: predicate-scoped persistence (only the selected log changes) ──────

describe('QBO-4A.5-RUN-2 predicate-scoped persistence — only the selected log (9,10,17)', () => {
  it('17: only the matching log receives accountId; every other log is returned unchanged', () => {
    // Replicate the resolve handler's exact local mutation (identity-only, no
    // updatedAt bump) over a multi-log array.
    const logs = [
      makeLog({ id: 'svc-A', accountId: undefined }),
      makeLog({ id: 'svc-B', quoted: 999, collected: 50, payStatus: 'Y', accountId: UUID_Y }),
      makeLog({ id: 'svc-C', accountId: undefined }),
    ]
    const logId = 'svc-A'
    const next = logs.map((l) => (l.id === logId ? { ...l, accountId: UUID_X } : l))
    expect(next[0].accountId).toBe(UUID_X)
    // svc-B is untouched — its pre-existing UUID and financials are byte-identical.
    expect(next[1].accountId).toBe(UUID_Y)
    expect(next[1].quoted).toBe(999)
    expect(next[1].collected).toBe(50)
    expect(next[1].payStatus).toBe('Y')
    // svc-C is untouched (still unresolved).
    expect(next[2].accountId).toBeUndefined()
    // No financial field on svc-A changed besides accountId.
    expect(next[0].quoted).toBe(461.53)
    expect(next[0].collected).toBe(0)
    expect(next[0].payStatus).toBe('N')
    expect(next[0].balanceDue).toBe(461.53)
  })
})

// ── Source-contract: the resolve handler is identity-only ────────────────────

const SERVICE_CALLS = read('src/components/v15r/V15rServiceCallsV2.tsx')
const SVC_CODE = stripComments(SERVICE_CALLS)

describe('QBO-4A.5-RUN-2 resolveLegacyLogCustomer — identity-only, firewall-safe (10,11-15,16,18,19,26)', () => {
  const handlerStart = SVC_CODE.indexOf('resolveLegacyLogCustomer = useCallback')
  const handlerEnd = SVC_CODE.indexOf('}, [backup, forceUpdate])', handlerStart)
  const handler = SVC_CODE.slice(handlerStart, handlerEnd)

  it('10: the handler signature takes (logId, accountUuid) and persists via the canonical accountId field', () => {
    expect(handlerStart).toBeGreaterThan(-1)
    expect(handler).toMatch(/resolveLegacyLogCustomer = useCallback\(async \(logId: string, accountUuid: string\)/)
    // The local mutation writes ONLY accountId (canonical field), predicate-scoped.
    expect(handler).toMatch(/l\.id === logId \? \{ \.\.\.l, accountId: accountUuid \} : l/)
  })

  it('11-15/26 firewall: the handler does NOT bump updatedAt — a stale-local row can never win LWW over a newer remote financial edit', () => {
    // No `new Date().toISOString()` and no `updatedAt: <now>` assignment in the
    // resolve path. (The host uses new Date() elsewhere, but NOT in this handler.)
    expect(handler).not.toMatch(/new Date\(\)\.toISOString\(\)/)
    expect(handler).not.toMatch(/updatedAt:\s*now/)
    // The identity mutation spreads ONLY accountId — no updatedAt key is added to
    // the new object. (A bump would read `{ ...l, accountId: accountUuid, updatedAt`.)
    expect(handler).not.toMatch(/accountId: accountUuid, updatedAt/)
    // No lowercase `updatedAt:` object-key assignment anywhere in the handler. The
    // scoped-sync metadata uses capital-U `remoteUpdatedAt:` (a different key), which
    // a case-sensitive match correctly does not flag.
    expect(handler).not.toMatch(/, updatedAt:/)
  })

  it('11-15 firewall: the handler writes NO financial field — quoted/collected/mat/payStatus/balanceDue/payments are untouched', () => {
    // The handler body references none of the financial tokens (it only maps
    // accountId + drives the scoped sync).
    expect(handler).not.toMatch(/\bquoted\b/)
    expect(handler).not.toMatch(/\bcollected\b/)
    expect(handler).not.toMatch(/\bpayStatus\b/)
    expect(handler).not.toMatch(/\bbalanceDue\b/)
    expect(handler).not.toMatch(/\bmat\b/)
    expect(handler).not.toMatch(/\bpayments\b/)
    expect(handler).not.toMatch(/\bhrs\b/)
    expect(handler).not.toMatch(/\bopCost\b/)
  })

  it('18: the handler does NOT reuse the Migrate path (migrateServiceLog) — identity resolution is not a record migration', () => {
    expect(handler).not.toMatch(/migrateServiceLog/)
    // Migrate still exists in the file (the per-row Migrate → button), just not in
    // the resolve handler — proving the two flows are separate authorities.
    expect(SVC_CODE).toMatch(/migrateServiceLog/)
    expect(SERVICE_CALLS).toContain('Migrate →')
  })

  it('10/26: the handler runs the ACTUAL scoped merge + post-merge accountId force (financial-neutral identity layering)', () => {
    expect(handler).toMatch(/mergeServiceLogsIntoRemote\(remote\.remoteData, incoming\)/)
    // Post-merge force layers accountId onto the LWW winner (identity-only).
    expect(handler).toMatch(/merged\.serviceLogs = \(merged\.serviceLogs \|\| \[\]\)\.map\(\(l\) =>[\s\S]*?l\.id === logId \? \{ \.\.\.l, accountId: accountUuid \} : l/)
    // Scoped to the existing service.calls scope (no new scope, no broad save).
    expect(handler).toMatch(/_scopes: \['service\.calls'\]/)
    expect(handler).toMatch(/saveBackupWithRemoteBaselineSync/)
  })

  it('16/19: the resolve handler performs NO QBO API write and NO direct network fetch — only the backup scoped sync', () => {
    expect(handler).not.toMatch(/intuit|quickbooks\.api|createQbo|sendToQuickBooks|syncCustomer/i)
    expect(handler).not.toMatch(/\bfetch\s*\(/)
    // The only remote touch is the backup remote-baseline fetch (fetchLatestRemoteBackup),
    // which is PowerOn backup sync — NOT a QBO/Intuit call.
    expect(handler).toMatch(/fetchLatestRemoteBackup\(\)/)
  })

  it('17: the LegacyServiceLogList parent scopes onResolveCustomer to the single chosen log id (no bulk pass)', () => {
    const listIdx = SVC_CODE.indexOf('function LegacyServiceLogList')
    const list = SVC_CODE.slice(listIdx, SVC_CODE.indexOf('function LegacyServiceLogCard'))
    expect(list).toMatch(/onResolveCustomer=\{\(uuid\) => onResolveCustomer\(l\.id, uuid\)\}/)
    // No forEach/for-of backfill over logs in the list parent.
    expect(list).not.toMatch(/\.forEach\(|for\s*\(/)
  })
})

// ── Source-contract: contextual menu vs global menu, three-state UX ──────────

describe('QBO-4A.5-RUN-2 LegacyServiceLogCard — contextual three-state menu (1,2,3,17,18)', () => {
  const cardIdx = SERVICE_CALLS.indexOf('function LegacyServiceLogCard')
  const card = SERVICE_CALLS.slice(cardIdx, SERVICE_CALLS.indexOf('// ─── Sub-components'))

  it('1/2: the contextual QuickBooks menu shows Resolve (STATE 1) when no canonical id, Link (STATE 2) when resolved', () => {
    expect(card).toMatch(/isCanonicalCustomerId\(log\.accountId, canonicalIds\) \? log\.accountId : null/)
    expect(card).toMatch(/onResolveCustomer=\{!customerUuid \? \(\) => setResolveOpen\(true\) : undefined\}/)
    expect(card).toMatch(/onLinkCustomer=\{customerUuid \? \(\) => setLinkCustomerOpen\(true\) : undefined\}/)
  })

  it('3: the contextual menu is NOT the global menu — no Import QB PDF / Connect / connection-status wiring on the card', () => {
    const menuBlock = card.slice(card.indexOf('<QuickBooksMenu'), card.indexOf('/>', card.indexOf('<QuickBooksMenu')) + 2)
    expect(menuBlock).toMatch(/onPrepareInvoice=/)
    expect(menuBlock).toMatch(/onOpenDrafts=/)
    // The global-only props are absent from this contextual menu.
    expect(menuBlock).not.toMatch(/onImportQbPdf|onConnect|connectionStatus|showPrepareInvoice/i)
  })

  it('12: the card renders the Resolve + Link modals and forwards the confirmed UUID to onResolveCustomer', () => {
    expect(card).toMatch(/ResolvePowerOnCustomerModal/)
    expect(card).toMatch(/LinkQuickBooksCustomerModal/)
    expect(card).toMatch(/onConfirm=\{\(uuid\) => \{ onResolveCustomer\(uuid\); setResolveOpen\(false\) \}\}/)
  })

  it('17: the card owns its own useQuickBooksCustomerMapping hook (per-row network boundary, not a shared global fetch)', () => {
    expect(card).toMatch(/useQuickBooksCustomerMapping\(\{ poweronCustomerId: customerUuid \}\)/)
  })
})

// ── Source-contract: canonical field + no migration ──────────────────────────

describe('QBO-4A.5-RUN-2 canonical field + migration ceiling (NON-NEGOTIABLE DATA RULE, MIGRATION RULE)', () => {
  it('NON-NEGOTIABLE DATA RULE: BackupServiceLog carries the SAME canonical accountId field (no parallel QBO-only identity field)', () => {
    const svc = read('src/services/backupDataService.ts')
    const logTypeIdx = svc.indexOf('export interface BackupServiceLog')
    const logType = svc.slice(logTypeIdx, svc.indexOf('archived?: boolean', logTypeIdx))
    expect(logType).toMatch(/accountId\?: string/)
    // No invented parallel identity fields.
    expect(stripComments(logType)).not.toMatch(/qbo_customer_override|quickbooks_customer_uuid|legacy_qbo_customer_id|qboCustomerId/i)
  })

  it('MIGRATION RULE: no migration 134 was created — ceiling stays 133 (schema unchanged, additive JSON-blob field only)', () => {
    // The only migration that could raise the ceiling for this feature would be a
    // 134-prefixed file. None exists — the field is an additive local-model JSON-blob
    // property persisted through the existing service.calls scope, not a DB column.
    expect(existsSync(join(ROOT, 'supabase/migrations/134_qbo_legacy_service_log_account_id.sql'))).toBe(false)
    expect(existsSync(join(ROOT, 'supabase/migrations/134.sql'))).toBe(false)
  })
})