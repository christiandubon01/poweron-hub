import { describe, expect, it } from 'vitest'
import {
  getServiceLegacyUnknownCash,
  resolveServiceLegacyPayments,
  legacyBaselineEventIdFor,
  type ServicePaymentRowLike,
} from '../servicePaymentLedger'
import { buildServiceLegacyReconciliationQueue } from '../serviceLegacyReconciliationQueue'
import { getCurrentYearCollectedRevenue } from '@/services/collectedRevenueRange'
import type { BackupData } from '@/services/backupDataService'

/**
 * FORENSIC-KPI-2B2-2G: the historical Service payment reconciliation work queue.
 *
 * The queue is a READ-ONLY aggregation over getServiceLegacyUnknownCash. These
 * tests pin its membership, totals, and sort against the SAME authority the
 * resolver uses — and confirm resolution actually drains the queue and moves the
 * dated cash into the correct YTD calendar period via the UNMODIFIED reader.
 */

const NOW = '2026-08-11T12:00:00.000Z'
let idSeq = 0
function stableMakeId() {
  idSeq += 1
  return `pay_test_${idSeq}`
}

function scalarRow(id: string, collected: number, extra: Record<string, any> = {}): ServicePaymentRowLike {
  return { id, serviceLogId: id, quoted: 1000, collected, ...extra } as ServicePaymentRowLike
}

function baselineRow(id: string, baselineAmount: number, realEvents: any[] = [], extra: Record<string, any> = {}): ServicePaymentRowLike {
  const baseline = {
    id: legacyBaselineEventIdFor({ id, serviceLogId: id }),
    amount: baselineAmount,
    receivedAt: null,
    recordedAt: '2025-01-01T00:00:00.000Z',
    kind: 'legacy_baseline',
    note: 'Legacy collected amount carried forward. Received date was never recorded.',
    voidedAt: null,
  }
  const collected = baselineAmount + realEvents.reduce((s, e) => s + (e.voidedAt ? 0 : e.amount), 0)
  return {
    id, serviceLogId: id, quoted: 1000, collected,
    payments: [...realEvents, baseline],
    ...extra,
  } as ServicePaymentRowLike
}

function datedEvent(amount: number, receivedAt: string, id: string) {
  return { id, amount, receivedAt, recordedAt: NOW, kind: 'payment', voidedAt: null }
}

function nullDateEvent(id: string, amount: number) {
  return { id, amount, receivedAt: null, recordedAt: NOW, kind: 'payment', voidedAt: null }
}

function backupWith(svc: any): BackupData {
  return {
    projects: [], logs: [], weeklyData: [], activeServiceCalls: [],
    serviceLogs: svc, settings: { dayTarget: 1 },
  } as unknown as BackupData
}

describe('FORENSIC-KPI-2B2-2G buildServiceLegacyReconciliationQueue — membership (Q1-Q5)', () => {
  it('Q1 — scalar-only undated row appears in the queue with its full collected amount', () => {
    const q = buildServiceLegacyReconciliationQueue([scalarRow('svc-A', 951.39)])
    expect(q.unresolvedCount).toBe(1)
    expect(q.unresolved[0].id).toBe('svc-A')
    expect(q.unresolved[0].unknownAmount).toBeCloseTo(951.39, 2)
    expect(q.unresolved[0].hasUnexpectedNullDateEvent).toBe(false)
  })

  it('Q2 — fully-dated ledger row is NOT in the queue and counts as already resolved', () => {
    const row = {
      id: 'svc-B', serviceLogId: 'svc-B', quoted: 1000, collected: 500,
      payments: [datedEvent(500, '2026-06-01', 'p1')],
    } as ServicePaymentRowLike
    const q = buildServiceLegacyReconciliationQueue([row])
    expect(q.unresolvedCount).toBe(0)
    expect(q.resolvedCount).toBe(1)
    expect(q.undatedTotal).toBe(0)
  })

  it('Q3 — mixed row (legacy baseline + real dated event) reports only the baseline as undated; dated cash is separated out', () => {
    const real = datedEvent(300, '2026-02-15', 'real-1')
    const row = baselineRow('svc-C', 200, [real])
    const u = getServiceLegacyUnknownCash(row)
    expect(u.amount).toBeCloseTo(200, 2)
    const q = buildServiceLegacyReconciliationQueue([row])
    expect(q.unresolvedCount).toBe(1)
    expect(q.unresolved[0].unknownAmount).toBeCloseTo(200, 2)
    // The 300 of already-dated live cash is counted as dated, not undated.
    expect(q.undatedTotal).toBeCloseTo(200, 2)
    expect(q.datedCollected).toBeCloseTo(300, 2)
  })

  it('Q4 — a non-baseline live event with no date is a warning, never a normal resolvable row, and does not pollute the totals', () => {
    const row = {
      id: 'svc-D', serviceLogId: 'svc-D', quoted: 1000, collected: 400,
      payments: [nullDateEvent('weird', 400)],
    } as ServicePaymentRowLike
    const q = buildServiceLegacyReconciliationQueue([row])
    expect(q.unresolvedCount).toBe(0)
    expect(q.warnings).toHaveLength(1)
    expect(q.warnings[0].id).toBe('svc-D')
    expect(q.warnings[0].hasUnexpectedNullDateEvent).toBe(true)
    // Ambiguous cash is excluded from both totals.
    expect(q.undatedTotal).toBe(0)
    expect(q.datedCollected).toBe(0)
    expect(q.resolvedCount).toBe(0)
  })

  it('Q5 — multiple undated rows aggregate into one total (951.39 + 760 + 1400 = 3111.39)', () => {
    const rows = [
      scalarRow('svc-1', 951.39, { date: '2025-04-01' }),
      scalarRow('svc-2', 760, { date: '2025-05-02' }),
      scalarRow('svc-3', 1400, { date: '2025-06-10' }),
    ]
    const q = buildServiceLegacyReconciliationQueue(rows)
    expect(q.unresolvedCount).toBe(3)
    expect(q.undatedTotal).toBeCloseTo(3111.39, 2)
  })
})

describe('FORENSIC-KPI-2B2-2G buildServiceLegacyReconciliationQueue — sort & filtering', () => {
  it('Q8 — unresolved rows sort oldest service date first; missing dates sort last', () => {
    const rows = [
      scalarRow('newest', 100, { date: '2026-07-01' }),
      scalarRow('no-date', 100, { date: '' }),
      scalarRow('oldest', 100, { date: '2024-01-05' }),
      scalarRow('mid', 100, { date: '2025-09-15' }),
    ]
    const q = buildServiceLegacyReconciliationQueue(rows)
    expect(q.unresolved.map((e) => e.id)).toEqual(['oldest', 'mid', 'newest', 'no-date'])
  })

  it('isActive filter excludes rows the predicate rejects (deleted / archived)', () => {
    const rows = [
      scalarRow('alive', 500, { date: '2025-01-01' }),
      scalarRow('dead', 500, { date: '2025-01-01', deletedAt: '2026-01-01' }),
    ]
    const q = buildServiceLegacyReconciliationQueue(rows, {
      isActive: (log) => !log.deletedAt,
    })
    expect(q.unresolvedCount).toBe(1)
    expect(q.unresolved[0].id).toBe('alive')
  })
})

describe('FORENSIC-KPI-2B2-2G resolution drains the queue (Q6-Q7)', () => {
  it('Q6 — resolving one row removes it from the queue and drops the undated total by that amount', () => {
    const rows = [
      scalarRow('svc-1', 951.39, { date: '2025-04-01' }),
      scalarRow('svc-2', 760, { date: '2025-05-02' }),
      scalarRow('svc-3', 1400, { date: '2025-06-10' }),
    ]
    const before = buildServiceLegacyReconciliationQueue(rows)
    expect(before.undatedTotal).toBeCloseTo(3111.39, 2)

    const r = resolveServiceLegacyPayments(rows[0], [{ amount: 951.39, receivedAt: '2025-04-01' }], { now: NOW, makeId: stableMakeId })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const after = buildServiceLegacyReconciliationQueue([r.row, rows[1], rows[2]])
    expect(after.unresolvedCount).toBe(2)
    expect(after.unresolved.map((e) => e.id)).toEqual(['svc-2', 'svc-3'])
    expect(after.undatedTotal).toBeCloseTo(2160, 2)
  })

  it('Q7 — resolving every undated row empties the queue and raises the resolved count', () => {
    const rows = [
      scalarRow('svc-1', 951.39, { date: '2025-04-01' }),
      scalarRow('svc-2', 760, { date: '2025-05-02' }),
    ]
    const resolved = rows.map((row) => {
      const r = resolveServiceLegacyPayments(row, [{ amount: Number(row.collected), receivedAt: String(row.date) }], { now: NOW, makeId: stableMakeId })
      if (!r.ok) throw new Error('resolve failed')
      return r.row
    })
    const q = buildServiceLegacyReconciliationQueue(resolved)
    expect(q.unresolvedCount).toBe(0)
    expect(q.undatedTotal).toBe(0)
    expect(q.resolvedCount).toBe(2)
    expect(q.datedCollected).toBeCloseTo(1711.39, 2)
  })
})

describe('FORENSIC-KPI-2B2-2G resolution is money-invariant through the queue (Q9)', () => {
  it('Q9 — a resolved row carries the same collected as the original scalar', () => {
    const row = scalarRow('svc-1', 951.39)
    const r = resolveServiceLegacyPayments(row, [{ amount: 951.39, receivedAt: '2025-04-01' }], { now: NOW, makeId: stableMakeId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.collected).toBeCloseTo(951.39, 2)
    // The queue reads the same collected after resolution.
    const q = buildServiceLegacyReconciliationQueue([r.row])
    expect(q.datedCollected).toBeCloseTo(951.39, 2)
    expect(q.unresolvedCount).toBe(0)
  })
})

describe('FORENSIC-KPI-2B2-2G YTD movement through the unmodified reader (Q10)', () => {
  it('Q10 — scalar 951.39 is unknown-date before resolve; resolving to 2025 keeps it OUT of 2026 knownTotal; resolving to 2026 brings it IN; lifetime preserved throughout', () => {
    const row = scalarRow('svc-1', 951.39)

    // Before resolve: unknown-date → excluded from 2026 knownTotal, counted as unknown.
    const before = getCurrentYearCollectedRevenue(backupWith([row]), 2026)
    expect(before.knownTotal).toBe(0)
    expect(before.serviceUnknownDateCash).toBeCloseTo(951.39, 2)
    expect(before.lifetimeTotal).toBeCloseTo(951.39, 2)
    // The queue agrees: undated.
    expect(buildServiceLegacyReconciliationQueue([row]).unresolvedCount).toBe(1)

    // Resolve into 2025 → dated, but still excluded from 2026 knownTotal; no longer unknown.
    const r2025 = resolveServiceLegacyPayments(row, [{ amount: 951.39, receivedAt: '2025-03-15' }], { now: NOW, makeId: stableMakeId })
    expect(r2025.ok).toBe(true)
    if (!r2025.ok) return
    const after2025 = getCurrentYearCollectedRevenue(backupWith([r2025.row]), 2026)
    expect(after2025.knownTotal).toBe(0)
    expect(after2025.serviceUnknownDateCash).toBe(0)
    expect(after2025.lifetimeTotal).toBeCloseTo(951.39, 2)
    // Queue now empty for this row.
    expect(buildServiceLegacyReconciliationQueue([r2025.row]).unresolvedCount).toBe(0)

    // Resolve into 2026 → NOW enters 2026 knownTotal.
    const r2026 = resolveServiceLegacyPayments(row, [{ amount: 951.39, receivedAt: '2026-06-01' }], { now: NOW, makeId: stableMakeId })
    expect(r2026.ok).toBe(true)
    if (!r2026.ok) return
    const after2026 = getCurrentYearCollectedRevenue(backupWith([r2026.row]), 2026)
    expect(after2026.knownTotal).toBeCloseTo(951.39, 2)
    expect(after2026.serviceUnknownDateCash).toBe(0)
    expect(after2026.lifetimeTotal).toBeCloseTo(951.39, 2)
  })
})