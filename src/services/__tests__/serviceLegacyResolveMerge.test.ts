import { describe, expect, it } from 'vitest'
import { mergeServiceLogsById } from '../serviceScopeMerge'
import {
  resolveServiceLegacyPayments,
  legacyBaselineEventIdFor,
  type ServicePaymentRowLike,
} from '@/features/service-quote/servicePaymentLedger'
import { getServiceCashForRange } from '@/features/service-quote/serviceCashDate'
import { getCurrentYearCollectedRevenue } from '../collectedRevenueRange'
import type { BackupData } from '../backupDataService'

/**
 * FORENSIC-KPI-2B2-2E BLOCKER 2: prove the legacy-baseline resolution survives the
 * PRODUCTION serviceLogs merge. The merge unions payments[] by stable event id, so a
 * resolved baseline must be VOIDED (same stable id on both devices) — not dropped —
 * or the remote's live baseline resurrects and collected doubles to 1902.78.
 */

const NOW = '2026-08-11T12:00:00.000Z'
let idSeq = 0
function stableMakeId() {
  idSeq += 1
  return `pay_resolve_${idSeq}`
}

function svcRow(payments: any[], extra: Record<string, any> = {}): any {
  const baselineId = legacyBaselineEventIdFor({ id: 'svc-1', serviceLogId: 'svc-1' })
  const collected = payments
    .filter(p => !p.voidedAt)
    .reduce((s, p) => s + (typeof p.amount === 'number' ? p.amount : 0), 0)
  return {
    id: 'svc-1',
    serviceLogId: 'svc-1',
    quoted: 1000,
    collected,
    updatedAt: '2026-08-11T12:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    payments,
    ...extra,
  }
}

function baselineEvent(amount: number) {
  return {
    id: legacyBaselineEventIdFor({ id: 'svc-1', serviceLogId: 'svc-1' }),
    kind: 'legacy_baseline',
    amount,
    receivedAt: null,
    recordedAt: '2025-01-01T00:00:00.000Z',
    voidedAt: null,
    note: 'Legacy collected amount carried forward. Received date was never recorded.',
  }
}

function datedEvent(id: string, amount: number, receivedAt: string, kind = 'payment') {
  return { id, kind, amount, receivedAt, recordedAt: NOW, voidedAt: null }
}

function backupWith(svc: any): BackupData {
  return {
    projects: [], logs: [], weeklyData: [], activeServiceCalls: [],
    serviceLogs: [svc], settings: { dayTarget: 1 },
  } as unknown as BackupData
}

function unknownCash(svc: any) {
  return getServiceCashForRange([svc], new Date('1970-01-01T00:00:00.000Z'), new Date('2100-01-01T00:00:00.000Z')).unknownDateCash
}
function lifetimeCash(svc: any) {
  return getServiceCashForRange([svc], new Date('1970-01-01T00:00:00.000Z'), new Date('2100-01-01T00:00:00.000Z')).lifetimeCash
}

describe('FORENSIC-KPI-2B2-2E legacy baseline merge resolution (M1-M5)', () => {
  it('M1 — baseline resolution: remote baseline + local resolved → only resolved survives merge', () => {
    const remote = svcRow([baselineEvent(951.39)])
    const local = resolveServiceLegacyPayments(
      svcRow([baselineEvent(951.39)]) as ServicePaymentRowLike,
      [{ amount: 951.39, receivedAt: '2025-07-12' }],
      { now: NOW, makeId: stableMakeId },
    )
    expect(local.ok).toBe(true)

    // RUN THE PRODUCTION MERGE.
    const merged = mergeServiceLogsById([remote], [(local as any).row])
    expect(merged).toHaveLength(1)
    const result = merged[0]
    const payments = result.payments as any[]

    // The baseline must be voided (inactive), not live. The resolved event is live.
    const baseline = payments.find(p => p.kind === 'legacy_baseline')
    expect(baseline).toBeTruthy()
    expect(baseline.voidedAt).toBeTruthy() // voided, not resurrected
    const resolved = payments.filter(p => p.kind === 'payment' && !p.voidedAt)
    expect(resolved).toHaveLength(1)
    expect(resolved[0].receivedAt).toBe('2025-07-12')

    expect(result.collected).toBeCloseTo(951.39, 2) // NOT 1902.78
    expect(unknownCash(result)).toBe(0)
    expect(lifetimeCash(result)).toBeCloseTo(951.39, 2)
  })

  it('M2 — baseline + genuine newer payment: both survive, baseline voided, collected = 500', () => {
    const remotePayments = [baselineEvent(200), datedEvent('real-1', 300, '2026-08-12')]
    const remote = svcRow(remotePayments)
    const local = resolveServiceLegacyPayments(
      svcRow([baselineEvent(200), datedEvent('real-1', 300, '2026-08-12')]) as ServicePaymentRowLike,
      [{ amount: 200, receivedAt: '2025-12-10' }],
      { now: NOW, makeId: stableMakeId },
    )
    expect(local.ok).toBe(true)

    const merged = mergeServiceLogsById([remote], [(local as any).row])
    const result = merged[0]
    const payments = result.payments as any[]

    const baseline = payments.find(p => p.kind === 'legacy_baseline')
    expect(baseline.voidedAt).toBeTruthy()
    const livePayments = payments.filter(p => !p.voidedAt)
    expect(livePayments.find(p => p.id === 'real-1')).toBeTruthy()
    expect(livePayments.find(p => p.id === 'real-1').amount).toBe(300)
    expect(livePayments.filter(p => p.kind === 'payment' && p.receivedAt === '2025-12-10')).toHaveLength(1)

    expect(result.collected).toBeCloseTo(500, 2) // 200 resolved + 300 real, NOT 700
    expect(unknownCash(result)).toBe(0)
  })

  it('M3 — concurrent real event on remote is NOT deleted by local resolution', () => {
    // Remote has an extra legitimate dated payment the local device never saw.
    const remotePayments = [baselineEvent(200), datedEvent('real-1', 300, '2026-08-12'), datedEvent('conc-1', 100, '2026-08-13')]
    const remote = svcRow(remotePayments)
    // Local only knew about baseline + real-1 when it resolved.
    const local = resolveServiceLegacyPayments(
      svcRow([baselineEvent(200), datedEvent('real-1', 300, '2026-08-12')]) as ServicePaymentRowLike,
      [{ amount: 200, receivedAt: '2025-12-10' }],
      { now: NOW, makeId: stableMakeId },
    )
    expect(local.ok).toBe(true)

    const merged = mergeServiceLogsById([remote], [(local as any).row])
    const result = merged[0]
    const payments = result.payments as any[]
    const live = payments.filter(p => !p.voidedAt)

    // The concurrent payment MUST survive.
    expect(live.find(p => p.id === 'conc-1')).toBeTruthy()
    expect(live.find(p => p.id === 'conc-1').amount).toBe(100)
    // collected = 200 (resolved) + 300 (real-1) + 100 (conc-1) = 600
    expect(result.collected).toBeCloseTo(600, 2)
    expect(unknownCash(result)).toBe(0)
  })

  it('M4 — reload/idempotency: after merge, no unknown cash, resolve not re-offered', () => {
    const remote = svcRow([baselineEvent(951.39)])
    const local = resolveServiceLegacyPayments(
      svcRow([baselineEvent(951.39)]) as ServicePaymentRowLike,
      [{ amount: 951.39, receivedAt: '2025-07-12' }],
      { now: NOW, makeId: stableMakeId },
    )
    const merged = mergeServiceLogsById([remote], [(local as any).row])
    const result = merged[0]

    // Re-merging the already-merged result with itself is idempotent.
    const remerged = mergeServiceLogsById([result], [result])
    expect(remerged).toHaveLength(1)
    expect(remerged[0].collected).toBeCloseTo(951.39, 2)
    expect(unknownCash(remerged[0])).toBe(0)

    // Re-applying resolve on the merged row finds no unknown cash (baseline voided).
    const rerun = resolveServiceLegacyPayments(result as ServicePaymentRowLike, [{ amount: 951.39, receivedAt: '2025-01-01' }], { now: NOW, makeId: stableMakeId })
    expect(rerun.ok).toBe(false)
    if (rerun.ok) return
    expect(rerun.reason).toBe('no-unknown-cash')
  })

  it('M5 — range authority: resolved 2025 baseline → 2025 includes, 2026 YTD excludes, lifetime includes', () => {
    const remote = svcRow([baselineEvent(951.39)])
    const local = resolveServiceLegacyPayments(
      svcRow([baselineEvent(951.39)]) as ServicePaymentRowLike,
      [{ amount: 951.39, receivedAt: '2025-07-12' }],
      { now: NOW, makeId: stableMakeId },
    )
    const merged = mergeServiceLogsById([remote], [(local as any).row])
    const result = merged[0]

    const cy2025 = getCurrentYearCollectedRevenue(backupWith(result), 2025)
    const cy2026 = getCurrentYearCollectedRevenue(backupWith(result), 2026)
    expect(cy2025.knownTotal).toBeCloseTo(951.39, 2)
    expect(cy2026.knownTotal).toBe(0)
    expect(cy2025.serviceUnknownDateCash).toBe(0)
    expect(cy2026.lifetimeTotal).toBeCloseTo(951.39, 2)
  })

  it('M-scalar — scalar-only resolution (no remote baseline event) merges cleanly', () => {
    // Remote has NO payments[] ledger — only scalar collected. There is no baseline
    // event to void. Local resolution simply starts the ledger with a dated payment.
    const remote = { id: 'svc-1', serviceLogId: 'svc-1', quoted: 1000, collected: 951.39, updatedAt: NOW, createdAt: '2025-01-01T00:00:00.000Z' }
    const local = resolveServiceLegacyPayments(
      { id: 'svc-1', serviceLogId: 'svc-1', quoted: 1000, collected: 951.39 } as ServicePaymentRowLike,
      [{ amount: 951.39, receivedAt: '2025-07-12' }],
      { now: NOW, makeId: stableMakeId },
    )
    expect(local.ok).toBe(true)
    const merged = mergeServiceLogsById([remote], [(local as any).row])
    const result = merged[0]
    expect(result.collected).toBeCloseTo(951.39, 2)
    expect(unknownCash(result)).toBe(0)
    // No baseline event should have been minted by resolution.
    expect((result.payments as any[]).find(p => p.kind === 'legacy_baseline')).toBeUndefined()
  })
})