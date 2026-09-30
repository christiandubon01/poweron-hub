import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getCollectedRevenueForRange,
  getCurrentYearCollectedRevenue,
  getLifetimeCollectedRevenue,
  isSyntheticPaidBackfillLog,
} from '@/services/collectedRevenueRange'
import { getTimelineCollected } from '@/services/financialTimelineRange'
import { getProjectFinancials, type BackupData } from '@/services/backupDataService'
import { internalLaborRate } from '@/components/v15r/employeeCostUtils'
import { getDemoBackupData } from '@/services/demoDataService'

/**
 * CASH-1..16 — FINAL FINANCIAL CLOSEOUT contract.
 *
 * Locks the canonical-cash guarantees that the closeout must not regress, and
 * pins the newly migrated readers (Nexus / Pulse / Pricing / Absolute / LEDGER /
 * revenueTimeline / relationship events) to the existing authorities.
 *
 * No new financial formula is introduced here or in the code under test — every
 * assertion routes through getProjectFinancials, getCanonicalKpiInputs,
 * getCollectedRevenueForRange or calculateWeeklyFinancialsForRange.
 */

const ROOT = process.cwd()
function src(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const UTC = (day: string) => new Date(`${day}T00:00:00.000Z`)

/**
 * A snapshot exercising every provenance class at once:
 *   p-active   — live project, one genuine dated payment log
 *   p-archived — ARCHIVED project that was already paid (the CASH-6 case)
 *   p-backfill — synthetic log-paidbackfill row (lifetime-only, never precise)
 *   svc-dated  — Service call with a receivedAt payment on a different day than
 *                the work date (the CASH-13 case), plus a void and a refund
 */
function makeSnapshot(): BackupData {
  return {
    projects: [
      { id: 'p-active', name: 'Active', contract: 10000, status: 'active', finance: {} },
      {
        id: 'p-archived',
        name: 'Archived Paid',
        contract: 5000,
        status: 'archived',
        archived: true,
        finance: { manualPaidAdjustment: 250 },
      },
      { id: 'p-backfill', name: 'Backfilled', contract: 8000, status: 'active', finance: {} },
    ],
    logs: [
      { id: 'l-active', projId: 'p-active', date: '2026-08-05', hrs: 8, mat: 0, miles: 0, collected: 1000 },
      { id: 'l-archived', projId: 'p-archived', date: '2026-08-06', hrs: 0, mat: 0, miles: 0, collected: 3000 },
      {
        id: 'log-paidbackfill-p-backfill-1700000000000',
        projId: 'p-backfill',
        date: '2026-08-07',
        hrs: 0, mat: 0, miles: 0,
        collected: 4000,
        notes: 'Backfilled from p.paid scalar (CFOT-COLLECTION-PATH-PARITY migration)',
      },
    ],
    serviceLogs: [
      {
        id: 'svc-dated',
        customer: 'Acme',
        date: '2026-06-05',            // WORK date — must never be used as cash date
        quoted: 2000,
        collected: 900,
        payments: [
          { id: 'pay-1', amount: 1000, receivedAt: '2026-08-12' },
          { id: 'pay-2', amount: -100, receivedAt: '2026-08-13' },        // refund, signed
          { id: 'pay-3', amount: 500, receivedAt: '2026-08-14', voidedAt: '2026-08-15T10:00:00.000Z' }, // void, excluded
        ],
      },
    ],
    settings: { opCost: 54, billRate: 110, mileRate: 0.66 },
  } as unknown as BackupData
}

const AUG_2026 = { start: UTC('2026-08-01'), end: UTC('2026-09-01') }

describe('CASH — canonical cash guarantees preserved', () => {
  // ── CASH-1 ─────────────────────────────────────────────────────────────────
  it('CASH-1: header collected still routes through the ONE canonical timeline authority', () => {
    const layout = src('src/components/v15r/V15rLayout.tsx')
    expect(layout).toContain('getTimelineCollected(collectedTimelineBackup,')
    expect(layout).toContain('getCurrentYearCollectedRevenue(')
    expect(layout).not.toContain('calculateCurrentYearFinancialsToDate')

    // Precise presets show known-dated cash; All Time shows lifetime. Unchanged.
    const demo = getDemoBackupData()
    const cy = getTimelineCollected(demo, 'CURRENT_YEAR', { todayKey: '2026-08-11' })
    expect(cy.displayValue).toBe(cy.provenance.knownTotal)
    const all = getTimelineCollected(demo, 'ALL_TIME', { todayKey: '2026-08-11' })
    expect(all.displayValue).toBe(all.provenance.lifetimeTotal)
  })

  it('CASH-1 (polish): the selector keeps every preset, the cue, custom dates and interactivity', () => {
    const layout = src('src/components/v15r/V15rLayout.tsx')
    expect(layout).toContain('aria-label="Collected cash range"')
    expect(layout).toContain('TIMELINE_PRESETS.map((p) =>')
    expect(layout).toContain('{p.label}')
    expect(layout).toContain('>Collected<')
    expect(layout).toContain('collectedUndatedCue')
    expect(layout).toContain('aria-label="Custom range start"')
    expect(layout).toContain('aria-label="Custom range end"')
    expect(layout).toContain('Select dates')
    // The control is still a real, enabled select — presentation changed only.
    const selectBlock = layout.match(/<select\s+value=\{collectedPreset\}[\s\S]*?<\/select>/)
    expect(selectBlock).not.toBeNull()
    expect(selectBlock![0]).toContain('cursor-pointer')
    expect(selectBlock![0]).not.toContain('disabled')
    expect(selectBlock![0]).not.toContain('pointer-events-none')
  })

  // ── CASH-2 ─────────────────────────────────────────────────────────────────
  it('CASH-2: the 52-week view stays automatic (derived on read, no recalc button)', () => {
    const policy = src('src/services/weeklyFinancialPolicy.ts')
    expect(policy).toContain('resolveWeeklyDataForRead')
    const money = src('src/components/v15r/V15rMoneyPanel.tsx')
    expect(money).toContain('resolveWeeklyDataForRead(backup)')
    expect(money).not.toMatch(/>\s*Recalculate\s*</)
  })

  // ── CASH-3 / CASH-4 / CASH-5 ───────────────────────────────────────────────
  it('CASH-3: CFOT carry-in remains on the canonical ranged authority', () => {
    const dashboard = src('src/components/v15r/V15rDashboard.tsx')
    expect(dashboard).toContain('getCollectedRevenueForRange')
  })

  it('CASH-4: Income Calc ranged cash remains canonical', () => {
    const income = src('src/components/v15r/V15rIncomeCalc.tsx')
    expect(income).toContain('getCollectedRevenueForRange')
  })

  it('CASH-5: Field Log short-range cash remains canonical', () => {
    const fieldLog = src('src/components/v15r/V15rFieldLogPanel.tsx')
    expect(fieldLog).toContain('getCollectedRevenueForRange')
    expect(fieldLog).toContain('totalCollected7d = getCollectedRevenueForRange(')
  })

  // ── CASH-6 ─────────────────────────────────────────────────────────────────
  it('CASH-6: lifetime Total Collected KEEPS cash from an archived paid project', () => {
    const snapshot = makeSnapshot()
    const withArchived = getLifetimeCollectedRevenue(snapshot)

    // Remove the archived project's cash entirely and the total must drop by
    // exactly its contribution (3000 logged + 250 manual adjustment).
    const withoutArchived = getLifetimeCollectedRevenue({
      ...snapshot,
      projects: (snapshot as any).projects.filter((p: any) => p.id !== 'p-archived'),
      logs: (snapshot as any).logs.filter((l: any) => l.projId !== 'p-archived'),
    } as BackupData)

    expect(withArchived - withoutArchived).toBeCloseTo(3250, 2)
    expect(withArchived).toBeGreaterThan(withoutArchived)
  })

  it('CASH-6: archiving a paid project does NOT change lifetime Total Collected', () => {
    const active = makeSnapshot()
    // Same data, but the previously-archived project is active — lifetime cash
    // must be identical either way. Lifecycle state changes Pipeline, not cash.
    const asActive = {
      ...active,
      projects: (active as any).projects.map((p: any) =>
        p.id === 'p-archived' ? { ...p, status: 'active', archived: false } : p),
    } as BackupData

    expect(getLifetimeCollectedRevenue(asActive)).toBeCloseTo(getLifetimeCollectedRevenue(active), 2)

    // The same holds for 'lost' and 'cancelled'.
    for (const status of ['lost', 'cancelled']) {
      const mutated = {
        ...active,
        projects: (active as any).projects.map((p: any) =>
          p.id === 'p-archived' ? { ...p, status, archived: false } : p),
      } as BackupData
      expect(getLifetimeCollectedRevenue(mutated)).toBeCloseTo(getLifetimeCollectedRevenue(active), 2)
    }
  })

  it('CASH-6: Money binds Total Collected AND Cash Received to that lifetime authority', () => {
    const money = src('src/components/v15r/V15rMoneyPanel.tsx')
    expect(money).toContain('const totalCollectedLifetime = getLifetimeCollectedRevenue(backup)')
    expect(money).toContain('const totalCollected = totalCollectedLifetime')
    expect(money).toContain('const cashReceived = totalCollectedLifetime')
    // Pipeline is NOT turned into a lifetime figure — it stays active-scoped.
    expect(money).toContain('const totalPipeline = canonicalKpis.pipeline')
  })

  it('CASH-6: a genuine tombstone still drops out of lifetime cash', () => {
    const snapshot = makeSnapshot()
    const base = getLifetimeCollectedRevenue(snapshot)
    const deleted = getLifetimeCollectedRevenue({
      ...snapshot,
      projects: (snapshot as any).projects.map((p: any) =>
        p.id === 'p-archived' ? { ...p, status: 'deleted' } : p),
    } as BackupData)
    expect(deleted).toBeLessThan(base)
  })

  // ── CASH-7 ─────────────────────────────────────────────────────────────────
  it('CASH-7: Nexus reads canonical project money and never bills internal labor at billRate', () => {
    const nexus = stripComments(src('src/agents/nexus/nexusContextBuilder.ts'))
    // Canonical paid, not the deprecated scalar.
    expect(nexus).toContain('getProjectFinancials(p, data)')
    expect(nexus).not.toMatch(/paid\s*=\s*num\(p\.paid\)/)
    // Internal cost of logged hours uses the opCost authority.
    expect(nexus).toContain('internalLaborRate(data.settings)')
    expect(nexus).not.toMatch(/laborCostLogged\s*=\s*loggedHrs\s*\*\s*billRate/)
    // The quoted labor BUDGET legitimately keeps billRate (customer-facing).
    expect(nexus).toMatch(/num\(r\.rate \|\| billRate\)/)

    // The router was already canonical and stays that way.
    const router = stripComments(src('src/agents/nexus/router.ts'))
    expect(router).toContain('getProjectFinancials(p, backup)')
    expect(router).not.toMatch(/num\(p\.paid\)/)
  })

  it('CASH-7: Pulse reads the canonical lifetime authority', () => {
    const pulse = stripComments(src('src/components/pulse/DashboardPanel.tsx'))
    expect(pulse).toContain('getLifetimeCollectedRevenue(backup)')
    expect(pulse).not.toMatch(/num\(p\.paid \|\| 0\)/)
  })

  it('CASH-7: Pricing Intelligence archives canonical collected and costs at opCost', () => {
    const pricing = stripComments(src('src/components/v15r/V15rPricingIntelligencePanel.tsx'))
    expect(pricing).toContain('getProjectFinancials(c.project, backup).paid')
    expect(pricing).toContain('getProjectFinancials(project, backup).paid')
    expect(pricing).not.toMatch(/num\(c\.project\.paid\)/)
    expect(pricing).not.toMatch(/num\(project\.paid\)/)
    expect(pricing).toContain('internalLaborRate(backup.settings)')
    expect(pricing).not.toMatch(/opCost \|\| 42\.45/)
  })

  it('CASH-7: Absolute Dashboard reads canonical per-project paid', () => {
    const absolute = stripComments(src('src/views/AbsoluteDashboardView.tsx'))
    expect(absolute).toContain('getProjectFinancials(p, backupData).paid')
    expect(absolute).not.toMatch(/Number\(p\.paid\)/)
  })

  it('CASH-7: the risk gate reads canonical paid for AR', () => {
    const gate = stripComments(src('src/services/diagnostics/BadDecisionDetector.ts'))
    expect(gate).toContain('getProjectFinancials(proj, data).paid')
    expect(gate).not.toMatch(/num\(proj\.paid\)/)
  })

  // ── CASH-8 ─────────────────────────────────────────────────────────────────
  it('CASH-8: LEDGER uses canonical provenance for AR and lifetime collected', () => {
    const ledger = stripComments(src('src/services/ledgerDataBridge.ts'))
    expect(ledger).toContain('getProjectFinancials(proj, backup).paid')
    expect(ledger).not.toMatch(/const paid = num\(proj\.paid\)/)
    expect(ledger).toContain('getLifetimeCollectedRevenue(backup)')
    // The raw backup.logs walk is gone.
    expect(ledger).not.toMatch(/fieldLogs\.reduce\(\(sum, l\) => sum \+ num\(\(l as any\)\.collected\)/)
    // Monthly collections still bucket Service cash by receivedAt.
    expect(ledger).toContain('getServiceCashForRange')
  })

  it('CASH-8: revenueTimeline precise buckets exclude dead and synthetic-backfill logs', () => {
    const timeline = stripComments(src('src/services/revenueTimelineService.ts'))
    expect(timeline).toContain('isPreciseProjectCashLog')
    expect(timeline).toContain('isDeadProjectLog')
    expect(timeline).toContain('isSyntheticPaidBackfillLog')
    // Both the 8-week and the 6-month project loops are guarded.
    const guards = timeline.match(/if \(!isPreciseProjectCashLog\(log\)\) continue/g) || []
    expect(guards.length).toBe(2)
    // Service cash is still bucketed by receivedAt.
    expect(timeline).toContain('entry.receivedAt')
  })

  it('CASH-8: the Team 12-week revenue chart buckets cash canonically, not by work date', () => {
    const team = stripComments(src('src/components/v15r/V15rTeamPanel.tsx'))
    expect(team).toContain('getCollectedRevenueForRange(backup, weekBoundaryUtc(weekStart), weekBoundaryUtc(weekEnd)).knownTotal')
    // The old work-date Service bucket and the raw project-log sum are gone.
    expect(team).not.toMatch(/serviceLogs\.filter\(l => \{ const d = new Date\(l\.date/)
    expect(team).not.toMatch(/const projRev = wLogs\.reduce/)
  })

  // ── CASH-9 ─────────────────────────────────────────────────────────────────
  it('CASH-9: relationship events no longer persist stale p.paid truth', () => {
    const projects = stripComments(src('src/components/v15r/V15rProjectsPanel.tsx'))
    expect(projects).toContain('const newProjCollected = getProjectFinancials(newProj, backup).paid')
    expect(projects).toContain('const editProjCollected = getProjectFinancials(p, backup).paid')
    expect(projects).toContain('collectedAmount: newProjCollected')
    expect(projects).toContain('collectedAmount: editProjCollected')
    // The scalar reads are gone from the event payloads.
    expect(projects).not.toMatch(/collectedAmount: num\(newProj\.paid \|\| 0\)/)
    expect(projects).not.toMatch(/collectedAmount: num\(\(p as any\)\.paid \|\| 0\)/)
  })

  // ── CASH-10 / CASH-11 ──────────────────────────────────────────────────────
  it('CASH-10: no active internal-cost path falls back to billRate', () => {
    const SURFACES = [
      'src/components/v15r/ProjectLogFinancialPanel.tsx',
      'src/components/v15r/V15rProjectLogsTab.tsx',
      'src/components/v15r/V15rFieldLogPanel.tsx',
      'src/components/v15r/V15rHome.tsx',
      'src/components/v15r/V15rMoneyPanel.tsx',
      'src/components/v15r/V15rPricingIntelligencePanel.tsx',
      'src/components/v15r/ProjectSummaryBoxes.tsx',
      'src/components/v15r/charts/RCAChart.tsx',
      'src/components/v15r/charts/SixMonthForecastChart.tsx',
      'src/components/v15r/charts/LaborTrendChart.tsx',
      'src/agents/nexus/nexusContextBuilder.ts',
    ]
    for (const rel of SURFACES) {
      const s = stripComments(src(rel))
      expect(s).not.toMatch(/opCost\s*\|\|\s*\S*billRate/)
      expect(s).not.toMatch(/internalLaborRate\([^)]*\)\s*\|\|\s*[^;\n]*billRate/)
    }
  })

  it('CASH-11: no invented internal-cost fallback constant remains on those surfaces', () => {
    const SURFACES = [
      'src/components/v15r/ProjectLogFinancialPanel.tsx',
      'src/components/v15r/V15rProjectLogsTab.tsx',
      'src/components/v15r/V15rFieldLogPanel.tsx',
      'src/components/v15r/V15rHome.tsx',
      'src/components/v15r/V15rMoneyPanel.tsx',
      'src/components/v15r/V15rPricingIntelligencePanel.tsx',
      'src/components/v15r/V15rEstimateTab.tsx',
      'src/components/v15r/ProjectSummaryBoxes.tsx',
      'src/components/v15r/V15rDashboard.tsx',
      'src/components/v15r/charts/RCAChart.tsx',
      'src/components/v15r/charts/SixMonthForecastChart.tsx',
    ]
    for (const rel of SURFACES) {
      const s = stripComments(src(rel))
      // The three historical invented rates must not reappear on an opCost path.
      expect(s).not.toMatch(/opCost[^\n]*\|\|\s*42\.45/)
      expect(s).not.toMatch(/opCost[^\n]*\|\|\s*55\b/)
      expect(s).not.toMatch(/opCost[^\n]*\|\|\s*43\b/)
      expect(s).not.toMatch(/internalLaborRate\([^)]*\)\s*\|\|\s*\d/)
      expect(s).not.toMatch(/internalLaborRate\([^)]*\)\s*\?\?\s*\d/)
    }
  })

  it('CASH-11: the authority itself returns an honest 0 when opCost is unset', () => {
    expect(internalLaborRate({ billRate: 110 })).toBe(0)
    expect(internalLaborRate({ opCost: 0, billRate: 110 })).toBe(0)
    expect(internalLaborRate({ opCost: 54, billRate: 110 })).toBe(54)
  })

  // ── CASH-12 ────────────────────────────────────────────────────────────────
  it('CASH-12: synthetic backfill never enters precise cash, but stays lifetime cash', () => {
    const snapshot = makeSnapshot()
    const aug = getCollectedRevenueForRange(snapshot, AUG_2026.start, AUG_2026.end)

    // The backfill row carries an August date but is NOT precise-period cash.
    expect(isSyntheticPaidBackfillLog((snapshot as any).logs[2])).toBe(true)
    expect(aug.projectKnownDatedCash).toBe(4000 - 4000 + 1000 + 3000) // l-active + l-archived only
    expect(aug.projectUnknownDateCash).toBeCloseTo(4000 + 250, 2)      // backfill + manual adj

    // It IS counted in lifetime.
    expect(aug.lifetimeTotal).toBeGreaterThan(aug.knownTotal)
    expect(getLifetimeCollectedRevenue(snapshot)).toBeCloseTo(aug.lifetimeTotal, 2)
  })

  it('CASH-12: the id prefix and the notes marker both classify as synthetic', () => {
    expect(isSyntheticPaidBackfillLog({ id: 'log-paidbackfill-x-1' })).toBe(true)
    expect(isSyntheticPaidBackfillLog({
      id: 'log1700000000000',
      notes: 'Backfilled from p.paid scalar (CFOT-COLLECTION-PATH-PARITY migration)',
    })).toBe(true)
    // A genuine owner-entered payment log is NOT synthetic.
    expect(isSyntheticPaidBackfillLog({ id: 'log1700000000000', notes: 'Deposit received' })).toBe(false)
  })

  // ── CASH-13 ────────────────────────────────────────────────────────────────
  it('CASH-13: Service work date never substitutes for receivedAt', () => {
    const snapshot = makeSnapshot()
    // The work date is 2026-06-05; the cash arrived in August.
    const june = getCollectedRevenueForRange(snapshot, UTC('2026-06-01'), UTC('2026-07-01'))
    expect(june.serviceKnownDatedCash).toBe(0)

    const aug = getCollectedRevenueForRange(snapshot, AUG_2026.start, AUG_2026.end)
    // 1000 received − 100 refunded; the 500 void contributes nothing.
    expect(aug.serviceKnownDatedCash).toBeCloseTo(900, 2)
  })

  // ── CASH-14 ────────────────────────────────────────────────────────────────
  it('CASH-14: refunds are signed and voids are excluded', () => {
    const snapshot = makeSnapshot()
    const withRefund = getCollectedRevenueForRange(snapshot, AUG_2026.start, AUG_2026.end)

    const withoutRefund = getCollectedRevenueForRange({
      ...snapshot,
      serviceLogs: [{
        ...(snapshot as any).serviceLogs[0],
        payments: [
          { id: 'pay-1', amount: 1000, receivedAt: '2026-08-12' },
          { id: 'pay-3', amount: 500, receivedAt: '2026-08-14', voidedAt: '2026-08-15T10:00:00.000Z' },
        ],
      }],
    } as BackupData, AUG_2026.start, AUG_2026.end)

    // Dropping the −100 refund raises the total by exactly 100 (signed, not ignored).
    expect(withoutRefund.serviceKnownDatedCash - withRefund.serviceKnownDatedCash).toBeCloseTo(100, 2)
    // The voided 500 is absent from both.
    expect(withoutRefund.serviceKnownDatedCash).toBeCloseTo(1000, 2)
  })

  // ── CASH-15 ────────────────────────────────────────────────────────────────
  it('CASH-15: Demo safety preserved — demo mode reads the demo snapshot', () => {
    const layout = src('src/components/v15r/V15rLayout.tsx')
    expect(layout).toContain('getDemoBackupData()')
    expect(layout).toContain('isDemoMode')
    const money = src('src/components/v15r/V15rMoneyPanel.tsx')
    expect(money).toContain('(hasHydrated && isDemoMode) ? getDemoBackupData() : getBackupData()')
    // The demo snapshot resolves through the same canonical authority.
    expect(() => getLifetimeCollectedRevenue(getDemoBackupData())).not.toThrow()
  })

  // ── CASH-16 ────────────────────────────────────────────────────────────────
  it('CASH-16: Annual Target stays current-year and is isolated from the selected preset', () => {
    const layout = src('src/components/v15r/V15rLayout.tsx')
    expect(layout).toContain('const yearlyTargetActual = paidYtdValue')
    expect(layout).not.toContain('const yearlyTargetActual = collectedDisplayValue')

    // Behavioural: the current-year numerator does not move with the preset.
    const demo = getDemoBackupData()
    const numerator = getCurrentYearCollectedRevenue(demo, 2026).knownTotal
    for (const preset of ['CURRENT_YEAR', 'PREVIOUS_YEAR', 'ALL_TIME', 'THIS_MONTH'] as const) {
      getTimelineCollected(demo, preset, { todayKey: '2026-08-11' })
      expect(getCurrentYearCollectedRevenue(demo, 2026).knownTotal).toBe(numerator)
    }
  })

  it('CASH-16: current-year cash excludes a prior-year payment', () => {
    const snapshot = makeSnapshot()
    const y2026 = getCurrentYearCollectedRevenue(snapshot, 2026)
    const y2025 = getCurrentYearCollectedRevenue(snapshot, 2025)
    expect(y2026.knownTotal).toBeGreaterThan(0)
    expect(y2025.knownTotal).toBe(0)
    // Lifetime is year-independent.
    expect(y2025.lifetimeTotal).toBeCloseTo(y2026.lifetimeTotal, 2)
  })
})

describe('CASH — canonical project paid authority', () => {
  it('getProjectFinancials derives paid from live logs + manualPaidAdjustment, not p.paid', () => {
    const snapshot = makeSnapshot()
    const archived = (snapshot as any).projects.find((p: any) => p.id === 'p-archived')
    const fin = getProjectFinancials(archived, snapshot)
    // 3000 logged + 250 manual adjustment. A stale scalar is never consulted.
    expect(fin.paid).toBeCloseTo(3250, 2)
    expect(fin.loggedPaid).toBeCloseTo(3000, 2)
    expect(fin.manualPaidAdjustment).toBeCloseTo(250, 2)
  })

  it('a stale p.paid scalar cannot inflate the canonical figure', () => {
    const snapshot = makeSnapshot()
    const inflated = {
      ...snapshot,
      projects: (snapshot as any).projects.map((p: any) =>
        p.id === 'p-active' ? { ...p, paid: 999999 } : p),
    } as BackupData
    const project = (inflated as any).projects.find((p: any) => p.id === 'p-active')
    expect(getProjectFinancials(project, inflated).paid).toBeCloseTo(1000, 2)
  })
})
