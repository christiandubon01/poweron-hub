import { describe, expect, it } from 'vitest'
import {
  getServiceLegacyUnknownCash,
  resolveServiceLegacyPayments,
  legacyBaselineEventIdFor,
  resolveServiceCollected,
  resolveServiceTotalBillable,
  resolveServiceBalanceDue,
  deriveServicePayStatus,
  type ServicePaymentRowLike,
} from '../servicePaymentLedger'
import { getServiceCashForRange } from '../serviceCashDate'
import { getCurrentYearCollectedRevenue } from '@/services/collectedRevenueRange'
import type { BackupData } from '@/services/backupDataService'

/**
 * FORENSIC-KPI-2B2-2D: the legacy-date resolution helper.
 *
 * Owner flow: an old Service Call has collected cash but no recorded payment date.
 * The owner assigns one or more real received dates that together sum to the unknown
 * amount. Collected / balanceDue / payStatus must NOT change — only the cash DATE
 * moves, taking the money out of "unknown-date" and into the correct calendar period.
 */

const NOW = '2026-08-11T12:00:00.000Z'
let idSeq = 0
function stableMakeId() {
  idSeq += 1
  return `pay_test_${idSeq}`
}

function scalarRow(collected: number, extra: Record<string, any> = {}): ServicePaymentRowLike {
  return { id: 'svc-1', serviceLogId: 'svc-1', quoted: 1000, collected, ...extra } as ServicePaymentRowLike
}

function baselineRow(baselineAmount: number, realEvents: any[] = [], extra: Record<string, any> = {}): ServicePaymentRowLike {
  const baseline = {
    id: legacyBaselineEventIdFor({ id: 'svc-1', serviceLogId: 'svc-1' }),
    amount: baselineAmount,
    receivedAt: null,
    recordedAt: '2025-01-01T00:00:00.000Z',
    kind: 'legacy_baseline',
    note: 'Legacy collected amount carried forward. Received date was never recorded.',
    voidedAt: null,
  }
  const collected = baselineAmount + realEvents.reduce((s, e) => s + (e.voidedAt ? 0 : e.amount), 0)
  return {
    id: 'svc-1', serviceLogId: 'svc-1', quoted: 1000, collected,
    payments: [...realEvents, baseline],
    ...extra,
  } as ServicePaymentRowLike
}

function datedEvent(amount: number, receivedAt: string, id: string) {
  return { id, amount, receivedAt, recordedAt: NOW, kind: 'payment', voidedAt: null }
}

describe('FORENSIC-KPI-2B2-2D getServiceLegacyUnknownCash', () => {
  it('TEST 1 — scalar-only row reports the scalar as unknown legacy cash', () => {
    const u = getServiceLegacyUnknownCash(scalarRow(951.39))
    expect(u.amount).toBeCloseTo(951.39, 2)
    expect(u.source).toBe('scalar')
    expect(u.hasUnexpectedNullDateEvent).toBe(false)
  })

  it('TEST 2 — baseline row reports the baseline sum as unknown legacy cash', () => {
    const u = getServiceLegacyUnknownCash(baselineRow(951.39))
    expect(u.amount).toBeCloseTo(951.39, 2)
    expect(u.source).toBe('baseline')
    expect(u.hasUnexpectedNullDateEvent).toBe(false)
  })

  it('TEST 3 — fully-dated row has no unknown cash', () => {
    const row = {
      id: 'svc-1', serviceLogId: 'svc-1', quoted: 1000, collected: 500,
      payments: [datedEvent(500, '2026-06-01', 'p1')],
    } as ServicePaymentRowLike
    const u = getServiceLegacyUnknownCash(row)
    expect(u.amount).toBe(0)
    expect(u.source).toBe('none')
    expect(u.hasUnexpectedNullDateEvent).toBe(false)
  })

  it('TEST 4 — non-baseline null-date event is flagged, not silently resolved', () => {
    const row = {
      id: 'svc-1', serviceLogId: 'svc-1', quoted: 1000, collected: 300,
      payments: [{ id: 'weird', amount: 300, receivedAt: null, recordedAt: NOW, kind: 'payment', voidedAt: null }],
    } as ServicePaymentRowLike
    const u = getServiceLegacyUnknownCash(row)
    expect(u.hasUnexpectedNullDateEvent).toBe(true)
    // The unexpected event is NOT folded into the resolvable baseline amount.
    expect(u.source).toBe('none')
  })
})

describe('FORENSIC-KPI-2B2-2D resolveServiceLegacyPayments — money invariant', () => {
  function snapshotMoney(row: ServicePaymentRowLike) {
    const collected = resolveServiceCollected(row)
    const totalBillable = resolveServiceTotalBillable(row)
    return {
      collected,
      totalBillable,
      balanceDue: resolveServiceBalanceDue(collected, totalBillable),
      payStatus: deriveServicePayStatus(collected, totalBillable),
    }
  }

  it('TEST 5 — CASE 1 scalar: single dated entry keeps collected identical', () => {
    const row = scalarRow(951.39)
    const before = snapshotMoney(row)
    const r = resolveServiceLegacyPayments(row, [{ amount: 951.39, receivedAt: '2025-03-15' }], { now: NOW, makeId: stableMakeId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.collected).toBeCloseTo(before.collected, 2)
    expect(r.balanceDue).toBeCloseTo(before.balanceDue, 2)
    expect(r.payStatus).toBe(before.payStatus)
    expect(r.resolvedAmount).toBeCloseTo(951.39, 2)
    // The new ledger has exactly one dated payment event.
    expect((r.row as any).payments).toHaveLength(1)
    expect((r.row as any).payments[0].receivedAt).toBe('2025-03-15')
    expect((r.row as any).payments[0].kind).toBe('payment')
  })

  it('TEST 6 — CASE 1 scalar: split into multiple dated entries keeps collected identical', () => {
    const row = scalarRow(951.39)
    const before = snapshotMoney(row)
    const r = resolveServiceLegacyPayments(row, [
      { amount: 500, receivedAt: '2025-03-15' },
      { amount: 451.39, receivedAt: '2025-06-20' },
    ], { now: NOW, makeId: stableMakeId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.collected).toBeCloseTo(before.collected, 2)
    expect(r.balanceDue).toBeCloseTo(before.balanceDue, 2)
    expect(r.payStatus).toBe(before.payStatus)
    expect((r.row as any).payments).toHaveLength(2)
    expect(r.events).toHaveLength(2)
  })

  it('TEST 7 — CASE 2 baseline+real: real dated event preserved (same id), baseline dropped, collected identical', () => {
    const real = datedEvent(200, '2026-07-01', 'real-1')
    const row = baselineRow(951.39, [real])
    const before = snapshotMoney(row)
    const r = resolveServiceLegacyPayments(row, [{ amount: 951.39, receivedAt: '2025-03-15' }], { now: NOW, makeId: stableMakeId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.collected).toBeCloseTo(before.collected, 2)
    expect(r.balanceDue).toBeCloseTo(before.balanceDue, 2)
    expect(r.payStatus).toBe(before.payStatus)
    const payments = (r.row as any).payments
    // Real event kept with its original id; baseline VOIDED (present, not live) so the
    // production merge's void-wins semantics retire it instead of resurrecting it; one
    // new dated event.
    expect(payments.find((p: any) => p.id === 'real-1')).toBeTruthy()
    const baseline = payments.find((p: any) => p.kind === 'legacy_baseline')
    expect(baseline).toBeTruthy()
    expect(baseline.voidedAt).toBeTruthy()
    expect(payments.filter((p: any) => p.kind === 'payment' && p.receivedAt === '2025-03-15')).toHaveLength(1)
  })

  it('TEST 8 — amount mismatch is rejected with a difference', () => {
    const row = scalarRow(951.39)
    const r = resolveServiceLegacyPayments(row, [{ amount: 900, receivedAt: '2025-03-15' }], { now: NOW, makeId: stableMakeId })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('amount-mismatch')
    expect(r.difference).toBeCloseTo(900 - 951.39, 2)
  })

  it('TEST 9 — invalid entries (empty / non-positive / missing date) are rejected', () => {
    const row = scalarRow(951.39)
    expect(resolveServiceLegacyPayments(row, [], { now: NOW, makeId: stableMakeId }).ok).toBe(false)
    expect(resolveServiceLegacyPayments(row, [{ amount: 0, receivedAt: '2025-03-15' }], { now: NOW, makeId: stableMakeId }).ok).toBe(false)
    expect(resolveServiceLegacyPayments(row, [{ amount: 100, receivedAt: '' }], { now: NOW, makeId: stableMakeId }).ok).toBe(false)
  })

  it('TEST 10 — no unknown cash (fully dated) is rejected', () => {
    const row = {
      id: 'svc-1', serviceLogId: 'svc-1', quoted: 1000, collected: 500,
      payments: [datedEvent(500, '2026-06-01', 'p1')],
    } as ServicePaymentRowLike
    const r = resolveServiceLegacyPayments(row, [{ amount: 500, receivedAt: '2025-03-15' }], { now: NOW, makeId: stableMakeId })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('no-unknown-cash')
  })

  it('TEST 11 — unexpected null-date non-baseline event is rejected (no invented semantics)', () => {
    const row = {
      id: 'svc-1', serviceLogId: 'svc-1', quoted: 1000, collected: 300,
      payments: [{ id: 'weird', amount: 300, receivedAt: null, recordedAt: NOW, kind: 'payment', voidedAt: null }],
    } as ServicePaymentRowLike
    const r = resolveServiceLegacyPayments(row, [{ amount: 300, receivedAt: '2025-03-15' }], { now: NOW, makeId: stableMakeId })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('unexpected-null-date')
  })
})

describe('FORENSIC-KPI-2B2-2D end-to-end cash-date placement after resolve', () => {
  function backupWith(svc: any): BackupData {
    return {
      projects: [], logs: [], weeklyData: [], activeServiceCalls: [],
      serviceLogs: [svc], settings: { dayTarget: 1 },
    } as unknown as BackupData
  }

  it('TEST 12 — resolved 2025 cash is placed in 2025 by getServiceCashForRange, not 2026; unknown drops to 0; lifetime unchanged', () => {
    const row = scalarRow(951.39)
    const lifetimeBefore = getServiceCashForRange([row], new Date('1970-01-01T00:00:00.000Z'), new Date('2100-01-01T00:00:00.000Z')).lifetimeCash

    const r = resolveServiceLegacyPayments(row, [{ amount: 951.39, receivedAt: '2025-03-15' }], { now: NOW, makeId: stableMakeId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const resolved = r.row as any

    const y2025 = getServiceCashForRange([resolved], new Date('2025-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'))
    const y2026 = getServiceCashForRange([resolved], new Date('2026-01-01T00:00:00.000Z'), new Date('2027-01-01T00:00:00.000Z'))
    const lifetime = getServiceCashForRange([resolved], new Date('1970-01-01T00:00:00.000Z'), new Date('2100-01-01T00:00:00.000Z'))

    expect(y2025.knownDatedCash).toBeCloseTo(951.39, 2)
    expect(y2026.knownDatedCash).toBe(0)
    expect(y2025.unknownDateCash).toBe(0)
    expect(lifetime.lifetimeCash).toBeCloseTo(lifetimeBefore, 2)
  })

  it('TEST 13 — getCurrentYearCollectedRevenue: 2025-dated legacy cash excluded from 2026 knownTotal; lifetime unchanged', () => {
    const row = scalarRow(951.39)
    const before = getCurrentYearCollectedRevenue(backupWith(row), 2026)

    const r = resolveServiceLegacyPayments(row, [{ amount: 951.39, receivedAt: '2025-03-15' }], { now: NOW, makeId: stableMakeId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const after = getCurrentYearCollectedRevenue(backupWith(r.row), 2026)

    // Before resolve: 951.39 is unknown-date, so knownTotal excludes it.
    expect(before.knownTotal).toBe(0)
    expect(before.serviceUnknownDateCash).toBeCloseTo(951.39, 2)
    // After resolve: dated 2025 → still excluded from 2026 knownTotal, and no longer unknown.
    expect(after.knownTotal).toBe(0)
    expect(after.serviceUnknownDateCash).toBe(0)
    // Lifetime preserved in both states.
    expect(before.lifetimeTotal).toBeCloseTo(951.39, 2)
    expect(after.lifetimeTotal).toBeCloseTo(951.39, 2)
  })

  it('TEST 14 — a 2026-dated resolve DOES enter 2026 knownTotal (positive control)', () => {
    const row = scalarRow(500)
    const r = resolveServiceLegacyPayments(row, [{ amount: 500, receivedAt: '2026-06-01' }], { now: NOW, makeId: stableMakeId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const after = getCurrentYearCollectedRevenue(backupWith(r.row), 2026)
    expect(after.knownTotal).toBeCloseTo(500, 2)
    expect(after.serviceUnknownDateCash).toBe(0)
  })
})