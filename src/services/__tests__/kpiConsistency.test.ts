import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fmtK,
  getCanonicalKpiInputs,
  getKPIs,
  getDashboardCashFlowSummary,
  getProjectFinancials,
} from '../backupDataService'
import {
  calculateWeeklyFinancialsForRange,
  resolveWeeklyDataForRead,
} from '../weeklyFinancialPolicy'
import { get8WeekCashFlow } from '../revenueTimelineService'
import { calculateProjectFinancials } from '../../utils/calculateProjectFinancials'

const NOW = new Date('2026-08-05T12:00:00.000Z')

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
  return {
    id: 'project-1',
    name: 'Canonical project',
    status: 'active',
    contract: 1_000,
    billed: 600,
    ...extra,
  }
}

function serviceLog(extra: Record<string, any> = {}): any {
  return {
    id: 'service-1',
    serviceLogId: 'service-1',
    date: '2026-08-04',
    quoted: 500,
    collected: 100,
    adjustments: [{ id: 'adj-1', type: 'income', amount: 50 }],
    ...extra,
  }
}

describe('SYNC-04 canonical KPI consistency', () => {
  it('excludes an archived project from active pipeline and collected KPIs', () => {
    const source = backup({
      projects: [
        activeProject(),
        activeProject({ id: 'archived', contract: 9_000, archived: true }),
      ],
      logs: [
        { id: 'live-payment', projId: 'project-1', date: '2026-08-04', collected: 200 },
        { id: 'archived-payment', projId: 'archived', date: '2026-08-04', collected: 900 },
      ],
      serviceLogs: [serviceLog()],
    })

    expect(getKPIs(source)).toMatchObject({ pipeline: 1_450, paid: 300 })
  })

  it('includes a restored project again using the same canonical predicate', () => {
    const restored = activeProject({ id: 'restored', contract: 2_000 })
    const source = backup({
      projects: [activeProject(), restored],
      logs: [
        { id: 'payment-1', projId: 'project-1', date: '2026-08-04', collected: 200 },
        { id: 'payment-2', projId: 'restored', date: '2026-08-04', collected: 300 },
      ],
      serviceLogs: [serviceLog()],
    })

    expect(getKPIs(source)).toMatchObject({ pipeline: 3_450, paid: 600 })
  })

  it('keeps Header and Money on the same canonical pipeline when soft-deleted service logs remain as tombstones', () => {
    const source = backup({
      projects: [
        activeProject({ id: 'p3', name: 'Beauty Salon', contract: 18_000 }),
        activeProject({ id: 'proj-rock', name: "Rock'n Avenue", contract: 22_000 }),
        activeProject({ id: 'proj-willow', name: 'Desert Willow Remodel', contract: 5_400 }),
        activeProject({ id: 'proj-mobile', name: 'Mobile Home Electrical Remodel + Service', contract: 11_000 }),
      ],
      serviceLogs: [
        serviceLog({ id: 'import_svc_006', serviceLogId: 'import_svc_006', quoted: 1_471, collected: 0, adjustments: [] }),
        serviceLog({ id: 'svc1783277371308', serviceLogId: 'svc1783277371308', quoted: 350, collected: 0, adjustments: [], deletedAt: '2026-07-05T18:50:23.004Z' }),
        serviceLog({ id: 'svc1785548428672', serviceLogId: 'svc1785548428672', quoted: 683.00625, collected: 657.68375, adjustments: [], deletedAt: '2026-08-05T01:53:10.312Z' }),
        serviceLog({ id: 'svc1785911950791', serviceLogId: 'svc1785911950791', quoted: 600, collected: 0, adjustments: [], deletedAt: '2026-08-05T06:42:15.924Z' }),
      ],
    })

    const moneyPipeline = getCanonicalKpiInputs(source).pipeline
    const headerPipeline = getKPIs(source).pipeline

    expect(headerPipeline).toBe(57_871)
    expect(moneyPipeline).toBe(57_871)
    expect(headerPipeline).not.toBe(58_846.3225)
    expect(headerPipeline).toBe(moneyPipeline)
    expect(fmtK(headerPipeline)).toBe('$57.9k')
    expect(fmtK(headerPipeline)).toBe(fmtK(moneyPipeline))
  })

  it('counts a live service balance while soft-deleted service logs contribute zero', () => {
    const source = backup({
      projects: [activeProject()],
      logs: [{ id: 'project-payment', projId: 'project-1', date: '2026-08-04', collected: 200 }],
      serviceLogs: [
        serviceLog(),
        serviceLog({ id: 'deleted-service', serviceLogId: 'deleted-service', quoted: 975.3225, collected: 0, adjustments: [], deletedAt: '2026-08-05T06:42:15.924Z' }),
      ],
    })

    expect(getCanonicalKpiInputs(source)).toMatchObject({
      serviceOutstanding: 450,
      pipeline: 1_450,
      collected: 300,
    })
    expect(getKPIs(source)).toMatchObject({ pipeline: 1_450, paid: 300 })
  })

  it('keeps V15rLayout on canonical raw KPIs and the Money compact Pipeline formatter', () => {
    const layoutSource = readFileSync(
      join(process.cwd(), 'src/components/v15r/V15rLayout.tsx'),
      'utf8',
    )

    expect(layoutSource).not.toContain("from '@/utils/pipelineCalc'")
    expect(layoutSource).not.toContain('calcActivePipeline(')
    expect(layoutSource).not.toContain('_correctedPipeline')
    expect(layoutSource).not.toContain('_correctedRawKpis')
    expect(layoutSource).toContain("? getDemoKPIs() : _rawKpis")
    expect(layoutSource.match(/fmtK\(safeKpis\.pipeline\)/g)).toHaveLength(2)
  })

  it('keeps coming work out of the canonical active-project pipeline', () => {
    const source = backup({
      projects: [activeProject(), activeProject({ id: 'coming', status: 'coming', contract: 4_000 })],
    })

    expect(getKPIs(source).pipeline).toBe(1_000)
  })

  it('uses the same settings rate deterministically for equivalent project-cost readers', () => {
    const source = backup({
      projects: [activeProject()],
      logs: [{ projId: 'project-1', hrs: 2, mat: 25, miles: 4, collected: 200 }],
      settings: { opCost: 60, mileRate: 0.8 },
    })

    const first = calculateProjectFinancials(
      source.projects[0], source.logs, source.settings.mileRate, source.settings.opCost,
    )
    const second = calculateProjectFinancials(
      source.projects[0], source.logs, source.settings.mileRate, source.settings.opCost,
    )

    expect(first).toEqual(second)
    expect(first.total_costs).toBe(148.2)
  })

  it('makes the current-week Dashboard/Money inputs agree with the canonical weekly reader', () => {
    const source = backup({
      projects: [activeProject()],
      logs: [{ projId: 'project-1', date: '2026-08-04', collected: 200 }],
      serviceLogs: [serviceLog()],
      weeklyData: [{ wk: 32, start: '2026-08-03', proj: 999, svc: 999, accum: 1_998 }],
    })

    const direct = calculateWeeklyFinancialsForRange(
      source,
      new Date('2026-08-03T00:00:00.000Z'),
      new Date('2026-08-10T00:00:00.000Z'),
    )
    const row = resolveWeeklyDataForRead(source, NOW)[0]

    expect(row).toMatchObject({ proj: direct.proj, svc: direct.svc })
    expect({ proj: row.proj, svc: row.svc }).toEqual({ proj: 200, svc: 100 })
  })

  it('does not let a historical manual weekly row replace current canonical inputs', () => {
    const source = backup({
      projects: [activeProject()],
      logs: [{ projId: 'project-1', date: '2026-08-04', collected: 200 }],
      weeklyData: [
        { wk: 31, start: '2026-07-27', proj: 7_000, svc: 3_000, accum: 10_000, manualOverride: true },
        { wk: 32, start: '2026-08-03', proj: 999, svc: 999, accum: 1_998 },
      ],
    })

    const rows = resolveWeeklyDataForRead(source, NOW)
    expect(rows[0]).toMatchObject({ proj: 7_000, svc: 3_000, manualOverride: true })
    expect(rows[1]).toMatchObject({ proj: 200, svc: 0 })
  })

  it('counts one project payment once even when compatibility fields coexist', () => {
    const source = backup({
      projects: [activeProject()],
      logs: [{ projId: 'project-1', date: '2026-08-04', collected: 200, paymentsCollected: 200 }],
    })

    expect(getProjectFinancials(source.projects[0], source).paid).toBe(200)
    expect(calculateWeeklyFinancialsForRange(
      source,
      new Date('2026-08-03T00:00:00.000Z'),
      new Date('2026-08-10T00:00:00.000Z'),
    ).proj).toBe(200)
  })

  it('uses the canonical compatibility field for a legacy project payment', () => {
    const source = backup({
      projects: [activeProject()],
      logs: [{ projId: 'project-1', date: '2026-08-04', paymentsCollected: 225 }],
    })

    expect(getKPIs(source).paid).toBe(225)
    expect(calculateWeeklyFinancialsForRange(
      source,
      new Date('2026-08-03T00:00:00.000Z'),
      new Date('2026-08-10T00:00:00.000Z'),
    ).proj).toBe(225)
  })

  it('counts one service payment once', () => {
    const source = backup({ serviceLogs: [serviceLog({ collected: 125 })] })
    expect(getKPIs(source).paid).toBe(125)
    expect(calculateWeeklyFinancialsForRange(
      source,
      new Date('2026-08-03T00:00:00.000Z'),
      new Date('2026-08-10T00:00:00.000Z'),
    ).svc).toBe(125)
  })

  it('does not double count a service record mirrored in service collections', () => {
    const mirrored = serviceLog({ fromEstimateId: 'estimate-1' })
    const buckets = get8WeekCashFlow(
      [],
      [],
      [mirrored, { ...mirrored, id: 'estimate-1', serviceLogId: undefined }],
      NOW,
    )

    expect(buckets.reduce((sum, row) => sum + row.actual, 0)).toBe(100)
    expect(buckets.reduce((sum, row) => sum + row.projected, 0)).toBe(450)
  })

  it('returns equivalent summary values for Dashboard, Money, and Business Overview semantics', () => {
    const source = backup({
      projects: [activeProject()],
      logs: [{ projId: 'project-1', date: '2026-08-04', collected: 200 }],
      serviceLogs: [serviceLog()],
    })

    const dashboard = getKPIs(source)
    const money = getKPIs(source)
    const businessOverview = getKPIs(source)

    expect(dashboard).toEqual(money)
    expect(money).toEqual(businessOverview)
    expect(money).toMatchObject({ pipeline: 1_450, paid: 300 })
    expect(getDashboardCashFlowSummary(source)).toMatchObject({
      serviceExposure: 450,
      svcTotal: 100,
      projTotal: 200,
      accumTotal: 300,
    })
  })

  it('ignores stale project.paid and tombstoned payment logs in Dashboard cards', () => {
    const source = backup({
      projects: [activeProject({ paid: 9_999 })],
      logs: [
        { projId: 'project-1', date: '2026-08-04', collected: 200 },
        { projId: 'project-1', date: '2026-08-04', collected: 700, deletedAt: '2026-08-05T00:00:00.000Z' },
      ],
      serviceLogs: [serviceLog()],
    })

    expect(getDashboardCashFlowSummary(source)).toMatchObject({
      activeExposure: 800,
      projTotal: 200,
      svcTotal: 100,
      accumTotal: 300,
    })
  })

  it('uses deterministic inclusive-day and exclusive-week-end boundaries', () => {
    const source = backup({
      projects: [activeProject()],
      logs: [
        { projId: 'project-1', date: '2026-08-02', collected: 10 },
        { projId: 'project-1', date: '2026-08-03', collected: 20 },
        { projId: 'project-1', date: '2026-08-09', collected: 30 },
        { projId: 'project-1', date: '2026-08-10', collected: 40 },
      ],
    })

    expect(calculateWeeklyFinancialsForRange(
      source,
      new Date('2026-08-03T00:00:00.000Z'),
      new Date('2026-08-10T00:00:00.000Z'),
    ).proj).toBe(50)
  })

  it('returns identical results on repeated calculation of one BackupData snapshot', () => {
    const source = backup({
      projects: [activeProject()],
      logs: [{ projId: 'project-1', date: '2026-08-04', collected: 200 }],
      serviceLogs: [serviceLog()],
    })

    expect(getKPIs(source)).toEqual(getKPIs(source))
  })

  it('derives KPIs without consulting browser-global poweron_v2', () => {
    let reads = 0
    const prior = (globalThis as any).localStorage
    ;(globalThis as any).localStorage = {
      getItem(key: string) {
        if (key === 'poweron_v2') reads += 1
        return JSON.stringify({ projects: [{ id: 'poison', status: 'active', contract: 99_999 }] })
      },
    }
    try {
      expect(getKPIs(backup({ projects: [activeProject()] })).pipeline).toBe(1_000)
      expect(reads).toBe(0)
    } finally {
      ;(globalThis as any).localStorage = prior
    }
  })
})
