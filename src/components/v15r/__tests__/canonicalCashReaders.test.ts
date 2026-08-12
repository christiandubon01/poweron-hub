import { describe, expect, it } from 'vitest'
import { getCollectedRevenueForRange } from '@/services/collectedRevenueRange'
import { calculateWeeklyFinancialsForRange } from '@/services/weeklyFinancialPolicy'
import { getTimelineCollected } from '@/services/financialTimelineRange'
import { getDashboardCashFlowSummary } from '@/services/backupDataService'
import { getDemoBackupData } from '@/services/demoDataService'

/**
 * FORENSIC-KPI-CANONICAL-READERS-1 — CASH-1..CASH-15.
 *
 * These tests pin the canonical cash-reader behavior the owner-visible ranged
 * readers (CFOT Accumulated Income carry-in, Income Calc 3-month, Field Log
 * 7-day / this-week) now route through. They exercise the EXISTING canonical
 * authorities (`getCollectedRevenueForRange`, `calculateWeeklyFinancialsForRange`)
 * — no new formula is introduced. The CFOT chart's accum line is now exactly
 * `carry-in (getCollectedRevenueForRange before window) + Σ canonical weekly`,
 * so the composition tests below validate that line.
 *
 * All dates are UTC-midnight day keys (the canonical convention). Service cash is
 * dated by `payments[].receivedAt`; synthetic paid-backfill + manualPaidAdjustment
 * are unknown-date cash (lifetime only, never precise-range).
 */

const EPOCH = new Date(0)

function backup(extra: Record<string, any> = {}): any {
  return {
    projects: [],
    logs: [],
    serviceLogs: [],
    activeServiceCalls: [],
    weeklyData: [],
    settings: { opCost: 50, mileRate: 0.75, dayTarget: 1_000 },
    ...extra,
  }
}

function activeProject(extra: Record<string, any> = {}): any {
  return { id: 'p1', name: 'P', status: 'active', contract: 1_000, billed: 0, ...extra }
}

function svcPayment(opts: { id: string; amount: number; receivedAt: string | null; voidedAt?: string | null }): any {
  const { id, amount, receivedAt, voidedAt = null } = opts
  return {
    id,
    amount,
    receivedAt,
    recordedAt: (receivedAt || '2026-01-01') + 'T00:00:00.000Z',
    kind: 'payment',
    voidedAt,
  }
}

function svcLog(opts: { id?: string; date?: string; quoted?: number; collected?: number; payments?: any[] }): any {
  const { id = 's1', date = '2026-01-01', quoted = 0, collected = 0, payments = [] } = opts
  return { id, serviceLogId: id, date, quoted, collected, payments, adjustments: [] }
}

/** Genuine owner-entered Project payment log (known-dated cash). */
function genuineLog(opts: { id?: string; projId?: string; date: string; amount: number }): any {
  const { id = 'log1', projId = 'p1', date, amount } = opts
  return { id, projId, date, collected: amount, paymentsCollected: amount, phase: 'Payment' }
}

/** Synthetic paid-scalar backfill (CFOT-COLLECTION-PATH-PARITY migration row). */
function backfillLog(opts: { id?: string; projId?: string; date: string; amount: number }): any {
  const { id = 'log-paidbackfill-bf', projId = 'p1', date, amount } = opts
  return {
    id,
    projId,
    date,
    collected: amount,
    paymentsCollected: amount,
    phase: 'Payment',
    notes: 'Backfilled from p.paid scalar (CFOT-COLLECTION-PATH-PARITY migration)',
  }
}

const utc = (dayKey: string) => new Date(`${dayKey}T00:00:00.000Z`)

describe('FORENSIC-KPI-CANONICAL-READERS-1 — CASH-1..15', () => {
  // ── Part A: CFOT carry-in ────────────────────────────────────────────────────

  it('CASH-1 — service carry-in uses receivedAt, never the work date', () => {
    // Work date 2025-01-10, payment receivedAt 2026-02-15, graph starts 2026-03-01.
    const b = backup({
      projects: [activeProject()],
      serviceLogs: [
        svcLog({
          id: 's1',
          date: '2025-01-10',
          collected: 100,
          payments: [svcPayment({ id: 'pay1', amount: 100, receivedAt: '2026-02-15' })],
        }),
      ],
    })
    const carryIn = getCollectedRevenueForRange(b, EPOCH, utc('2026-03-01')).knownTotal
    // 2026-02-15 < 2026-03-01 → included. 2025-01-10 (work date) is never used.
    expect(carryIn).toBe(100)
  })

  it('CASH-2 — service payment after window start is not in carry-in; appears in-window', () => {
    const b = backup({
      projects: [activeProject()],
      serviceLogs: [
        svcLog({
          id: 's1',
          date: '2025-01-10',
          collected: 100,
          payments: [svcPayment({ id: 'pay1', amount: 100, receivedAt: '6-03-15'.replace('6-', '2026-') })],
        }),
      ],
    })
    const carryIn = getCollectedRevenueForRange(b, EPOCH, utc('2026-03-01')).knownTotal
    expect(carryIn).toBe(0) // receivedAt 2026-03-15 is not before 2026-03-01
    const inWindow = getCollectedRevenueForRange(b, utc('2026-03-01'), utc('2026-03-22')).knownTotal
    expect(inWindow).toBe(100) // appears in the correct in-window range
  })

  it('CASH-3 — synthetic Project backfill contributes 0 to precise carry-in', () => {
    const b = backup({
      projects: [activeProject()],
      logs: [backfillLog({ id: 'log-paidbackfill-big', date: '2026-01-10', amount: 10_000 })],
    })
    const r = getCollectedRevenueForRange(b, EPOCH, utc('2026-03-01'))
    expect(r.knownTotal).toBe(0) // backfill is unknown-date, not precise carry-in
    expect(r.unknownDateTotal).toBe(10_000) // routed to lifetime unknown-date
  })

  it('CASH-4 — genuine dated Project payment before window is +carry-in', () => {
    const b = backup({
      projects: [activeProject()],
      logs: [genuineLog({ id: 'pre', date: '2026-01-15', amount: 3_000 })],
    })
    const carryIn = getCollectedRevenueForRange(b, EPOCH, utc('2026-03-01')).knownTotal
    expect(carryIn).toBe(3_000)
  })

  it('CASH-5 — manualPaidAdjustment contributes 0 to precise graph carry-in', () => {
    const b = backup({
      projects: [activeProject({ finance: { manualPaidAdjustment: 5_000 } })],
    })
    const r = getCollectedRevenueForRange(b, EPOCH, utc('2026-03-01'))
    expect(r.knownTotal).toBe(0) // manualPaidAdjustment is unknown-date, excluded from precise
    expect(r.unknownDateTotal).toBe(5_000) // lifetime only
  })

  it('CASH-6 — signed refund before window nets into carry-in (800)', () => {
    const b = backup({
      projects: [activeProject()],
      serviceLogs: [
        svcLog({
          id: 's1',
          date: '2025-01-10',
          collected: 800,
          payments: [
            svcPayment({ id: 'pay1', amount: 1_000, receivedAt: '2026-01-05' }),
            svcPayment({ id: 'pay2', amount: -200, receivedAt: '2026-01-20' }),
          ],
        }),
      ],
    })
    const carryIn = getCollectedRevenueForRange(b, EPOCH, utc('2026-03-01')).knownTotal
    expect(carryIn).toBe(800) // +1000 + (-200); scalar ignored because payments[] exists
  })

  it('CASH-7 — voided service event is excluded', () => {
    const b = backup({
      projects: [activeProject()],
      serviceLogs: [
        svcLog({
          id: 's1',
          date: '2026-01-10',
          collected: 500,
          payments: [svcPayment({ id: 'pay1', amount: 500, receivedAt: '2026-01-15', voidedAt: '2026-02-01' })],
        }),
      ],
    })
    const carryIn = getCollectedRevenueForRange(b, EPOCH, utc('2026-03-01')).knownTotal
    expect(carryIn).toBe(0) // voided event contributes nothing
  })

  it('CASH-8 — graph accum = carry-in + canonical weekly (5000 → 6000 → 6250)', () => {
    // windowStart = 2026-03-01. Pre-window genuine payment 5000, week1 +1000, week2 +250.
    const b = backup({
      projects: [activeProject()],
      logs: [
        genuineLog({ id: 'pre', date: '2026-01-15', amount: 5_000 }),
        genuineLog({ id: 'w1', date: '2026-03-03', amount: 1_000 }),
        genuineLog({ id: 'w2', date: '2026-03-10', amount: 250 }),
      ],
    })
    const wStart = utc('2026-03-01')
    const w1End = utc('2026-03-08')
    const w2End = utc('2026-03-15')
    const carryIn = getCollectedRevenueForRange(b, EPOCH, wStart).knownTotal
    const wk1 = calculateWeeklyFinancialsForRange(b, wStart, w1End)
    const wk2 = calculateWeeklyFinancialsForRange(b, w1End, w2End)
    const accum0 = carryIn
    const accum1 = accum0 + wk1.proj + wk1.svc
    const accum2 = accum1 + wk2.proj + wk2.svc
    expect(accum0).toBe(5_000)
    expect(accum1).toBe(6_000)
    expect(accum2).toBe(6_250)
  })

  it('CASH-9 — graph accumulated summary equals the canonical cumulative value', () => {
    // The chart line's right-edge accum (Part A carry-in + Σ canonical weekly) must
    // equal getCollectedRevenueForRange(...).knownTotal over [epoch, chartEnd].
    const b = backup({
      projects: [activeProject()],
      logs: [
        genuineLog({ id: 'pre', date: '2026-01-15', amount: 5_000 }),
        genuineLog({ id: 'w1', date: '2026-03-03', amount: 1_000 }),
        genuineLog({ id: 'w2', date: '2026-03-10', amount: 250 }),
      ],
    })
    const chartEnd = utc('2026-03-15')
    const carryIn = getCollectedRevenueForRange(b, EPOCH, utc('2026-03-01')).knownTotal
    const wk1 = calculateWeeklyFinancialsForRange(b, utc('2026-03-01'), utc('2026-03-08'))
    const wk2 = calculateWeeklyFinancialsForRange(b, utc('2026-03-08'), chartEnd)
    const chartLineAccum = carryIn + wk1.proj + wk1.svc + wk2.proj + wk2.svc
    const canonicalCumulative = getCollectedRevenueForRange(b, EPOCH, chartEnd).knownTotal
    expect(chartLineAccum).toBe(canonicalCumulative) // 6250 === 6250

    // Part B: when unknown-date cash exists, the lifetime accumTotal tile
    // (getDashboardCashFlowSummary) intentionally exceeds the chart line, and the
    // RENDERED "Accum" tile follows the chart line (the override in V15rDashboard).
    const b2 = backup({
      projects: [activeProject({ finance: { manualPaidAdjustment: 5_000 } })],
      logs: [genuineLog({ id: 'pre', date: '2026-01-15', amount: 5_000 })],
    })
    const chartLine2 = getCollectedRevenueForRange(b2, EPOCH, chartEnd).knownTotal // 5000 (manualAdj excluded)
    const lifetimeTile2 = getDashboardCashFlowSummary(b2).accumTotal // 10000 (lifetime)
    expect(chartLine2).toBe(5_000)
    expect(lifetimeTile2).toBe(10_000) // lifetime tile differs for a legitimate reason
    // The rendered "Accum" tile is cfotChartFinalAccum (= chartLine2), NOT lifetimeTile2.
    expect(chartLine2).not.toBe(lifetimeTile2)
  })

  // ── Regression: Header & 52-week are untouched by the Graph fix ──────────────

  it('CASH-10 — Header Previous Year is unchanged by the Graph fix (canonical 2025 flow)', () => {
    const b = backup({
      projects: [activeProject()],
      logs: [
        genuineLog({ id: 'py', date: '2025-06-15', amount: 6_200 }),
        backfillLog({ id: 'log-paidbackfill-py', date: '2025-07-01', amount: 9_999 }),
      ],
    })
    const headerPY = getTimelineCollected(b, 'PREVIOUS_YEAR', { todayKey: '2026-08-11' })
    expect(headerPY.range.label).toBe('Previous Year')
    expect(headerPY.displayValue).toBe(6_200) // 2025 known-dated only; backfill excluded
    // The Graph carry-in fix did not touch getTimelineCollected / getCollectedRevenueForRange:
    expect(headerPY.displayValue).toBe(
      getCollectedRevenueForRange(b, utc('2025-01-01'), utc('2026-01-01')).knownTotal,
    )
  })

  it('CASH-11 — 52-week Shane-style receivedAt weekly behavior is unchanged', () => {
    const b = backup({
      projects: [activeProject()],
      serviceLogs: [
        svcLog({
          id: 's1',
          date: '2026-08-01',
          collected: 100,
          payments: [svcPayment({ id: 'pay1', amount: 100, receivedAt: '2026-08-08' })],
        }),
      ],
    })
    const wk = calculateWeeklyFinancialsForRange(b, utc('2026-08-02'), utc('2026-08-09'))
    expect(wk.svc).toBe(100) // receivedAt 2026-08-08 lands in the 08/02 week
  })

  // ── Part D: Income Calc 3-month ─────────────────────────────────────────────

  it('CASH-12 — Income Calc 3-month counts only genuine known-dated cash', () => {
    // 3-month window [2026-05-01, 2026-08-12).
    const startUtc = utc('2026-05-01')
    const endUtc = utc('2026-08-12')
    const b = backup({
      projects: [activeProject({ finance: { manualPaidAdjustment: 5_000 } })],
      logs: [
        genuineLog({ id: 'g', date: '2026-06-15', amount: 1_500 }), // genuine, in range
        backfillLog({ id: 'log-paidbackfill-ic', date: '2026-07-01', amount: 9_999 }), // fake date in range
      ],
      serviceLogs: [
        svcLog({
          id: 's1',
          date: '2026-05-01',
          collected: 300,
          payments: [svcPayment({ id: 'pay1', amount: 300, receivedAt: '2026-07-10' })],
        }),
      ],
    })
    const r = getCollectedRevenueForRange(b, startUtc, endUtc)
    expect(r.projectKnownDatedCash).toBe(1_500) // genuine project payment only
    expect(r.serviceKnownDatedCash).toBe(300) // service receivedAt in range
    expect(r.knownTotal).toBe(1_800) // 1500 + 300; backfill & manualAdj excluded
  })

  // ── Part E: Field Log short-range ────────────────────────────────────────────

  it('CASH-13 — Field Log 7-day excludes synthetic paid-backfill dated inside the window', () => {
    // 7-day window [2026-08-04, 2026-08-12) (today 2026-08-11).
    const startUtc = utc('2026-08-04')
    const endUtc = utc('2026-08-12')
    const b = backup({
      projects: [activeProject()],
      logs: [backfillLog({ id: 'log-paidbackfill-7d', date: '2026-08-06', amount: 9_999 })],
    })
    const r = getCollectedRevenueForRange(b, startUtc, endUtc)
    expect(r.knownTotal).toBe(0) // backfill not counted as precise 7-day cash
    expect(r.unknownDateTotal).toBe(9_999) // lifetime only
  })

  it('CASH-14 — Field Log 7-day counts a genuine dated payment inside the window', () => {
    const startUtc = utc('2026-08-04')
    const endUtc = utc('2026-08-12')
    const b = backup({
      projects: [activeProject()],
      logs: [genuineLog({ id: 'g7', date: '2026-08-06', amount: 750 })],
    })
    const r = getCollectedRevenueForRange(b, startUtc, endUtc)
    expect(r.knownTotal).toBe(750)
  })

  it('CASH-15 — demo-safe BackupData flows through every changed reader without crashing', () => {
    const demo = getDemoBackupData()
    // CFOT carry-in / chart line scope (lifetime-wide, service canonical-scoped):
    const lifetime = getCollectedRevenueForRange(demo, EPOCH, utc('2100-01-01'))
    expect(Number.isFinite(lifetime.knownTotal)).toBe(true)
    expect(Number.isFinite(lifetime.lifetimeTotal)).toBe(true)
    expect(lifetime.knownTotal).toBeGreaterThanOrEqual(0)
    // Income Calc 3-month window:
    const threeMo = getCollectedRevenueForRange(demo, utc('2026-05-01'), utc('2026-08-12'))
    expect(Number.isFinite(threeMo.knownTotal)).toBe(true)
    expect(Number.isFinite(threeMo.projectKnownDatedCash)).toBe(true)
    // Field Log 7-day window:
    const sevenDay = getCollectedRevenueForRange(demo, utc('2026-08-04'), utc('2026-08-12'))
    expect(Number.isFinite(sevenDay.knownTotal)).toBe(true)
    // Header timeline (Demo Mode path uses getDemoBackupData):
    const header = getTimelineCollected(demo, 'CURRENT_YEAR', { todayKey: '2026-08-11' })
    expect(Number.isFinite(header.displayValue ?? 0)).toBe(true)
    // 52-week derivation on demo data:
    const wk = calculateWeeklyFinancialsForRange(demo, utc('2026-08-04'), utc('2026-08-11'))
    expect(Number.isFinite(wk.proj + wk.svc)).toBe(true)
    // Demo safety: the readers consume the demo-safe BackupData universe; no real cash.
  })
})