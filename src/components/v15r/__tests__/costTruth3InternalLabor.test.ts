import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildProjectLogFinancials } from '@/components/v15r/ProjectLogFinancialPanel'
import { buildProjectLogRollup, type BackupData } from '@/services/backupDataService'
import { resolveProjectLaborSource, buildCostSourceSummary } from '@/utils/costSourceHelper'

const ROOT = process.cwd()
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

function baseBackup(): BackupData {
  return {
    settings: {
      opCost: 45.59,
      billRate: 999,
      mileRate: 0.66,
      billableHrsYear: 2400,
      overhead: {
        essential: [{ monthly: 4904 }],
        extra: [],
        loans: [],
        vehicle: [],
      },
    },
    projects: [{ id: 'p1', name: 'Main Project', contract: 5000, status: 'active' }],
    serviceLogs: [{ id: 'svc-1', quoted: 0, hrs: 8, opCost: 364.72, mileCost: 13.2, collected: 0 }],
    logs: [{ id: 'l1', projId: 'p1', date: '2026-08-11', empId: 'owner-1', emp: 'Owner / Me', hrs: 8, mat: 0, miles: 20, collected: 0 }],
    employees: [
      { id: 'owner-1', name: 'Owner / Me', hourly_rate: 30, workerType: 'owner' },
      { id: 'tech-1', name: 'Alex', hourly_rate: 22, burdenPct: 25, workerType: 'employee' },
    ],
  } as unknown as BackupData
}

describe('PROJECT-COST current labor authority', () => {
  it('PROJECT-COST-1: owner wage 30 + overhead 24.52 = 54.52/hr', () => {
    const backup = baseBackup()
    const source = resolveProjectLaborSource(backup.settings as any, backup.employees as any, 'owner-1', 'Owner / Me')
    expect(source.loadedLaborRate).toBe(30)
    expect(source.overheadRecoveryRate).toBeCloseTo(24.52, 2)
    expect(source.internalLaborRate).toBeCloseTo(54.52, 2)
  })

  it('PROJECT-COST-2/3: 8 hours = 436.16 labor and 20 miles = 449.36 total', () => {
    const backup = baseBackup()
    const fin = buildProjectLogFinancials(backup, 'p1', null, { hrs: 8, miles: 20, mat: 0, collected: 0 }, 'owner-1', 'Owner / Me')
    expect(fin.laborRate).toBeCloseTo(54.52, 2)
    expect(fin.entryLaborCost).toBeCloseTo(436.16, 2)
    expect(fin.entryMileageCost).toBeCloseTo(13.2, 2)
    expect(fin.entryTotalInternalCost).toBeCloseTo(449.36, 2)
  })

  it('PROJECT-COST-4: changing legacy settings.opCost does not affect Project cost', () => {
    const backup = baseBackup()
    const a = buildProjectLogFinancials(backup, 'p1', null, { hrs: 8, miles: 20, mat: 0, collected: 0 }, 'owner-1', 'Owner / Me')
    ;(backup.settings as any).opCost = 12.34
    const b = buildProjectLogFinancials(backup, 'p1', null, { hrs: 8, miles: 20, mat: 0, collected: 0 }, 'owner-1', 'Owner / Me')
    expect(a.entryLaborCost).toBeCloseTo(b.entryLaborCost!, 2)
    expect(a.entryTotalInternalCost).toBeCloseTo(b.entryTotalInternalCost!, 2)
  })

  it('PROJECT-COST-5: changing billRate does not affect Project cost', () => {
    const backup = baseBackup()
    const a = buildProjectLogFinancials(backup, 'p1', null, { hrs: 8, miles: 20, mat: 0, collected: 0 }, 'owner-1', 'Owner / Me')
    ;(backup.settings as any).billRate = 12345
    const b = buildProjectLogFinancials(backup, 'p1', null, { hrs: 8, miles: 20, mat: 0, collected: 0 }, 'owner-1', 'Owner / Me')
    expect(a.entryLaborCost).toBeCloseTo(b.entryLaborCost!, 2)
  })

  it('PROJECT-COST-6: changing Team loaded labor changes Project cost', () => {
    const backup = baseBackup()
    const a = buildProjectLogFinancials(backup, 'p1', null, { hrs: 8, miles: 0, mat: 0, collected: 0 }, 'owner-1', 'Owner / Me')
    ;(backup.employees as any[])[0].hourly_rate = 35
    const b = buildProjectLogFinancials(backup, 'p1', null, { hrs: 8, miles: 0, mat: 0, collected: 0 }, 'owner-1', 'Owner / Me')
    expect(b.entryLaborCost).toBeGreaterThan(a.entryLaborCost!)
  })

  it('PROJECT-COST-7: changing overhead recovery changes Project cost', () => {
    const backup = baseBackup()
    const a = buildProjectLogFinancials(backup, 'p1', null, { hrs: 8, miles: 0, mat: 0, collected: 0 }, 'owner-1', 'Owner / Me')
    ;(backup.settings as any).overhead.essential[0].monthly = 6000
    const b = buildProjectLogFinancials(backup, 'p1', null, { hrs: 8, miles: 0, mat: 0, collected: 0 }, 'owner-1', 'Owner / Me')
    expect(b.entryLaborCost).toBeGreaterThan(a.entryLaborCost!)
  })

  it('PROJECT-COST-8: another employee uses that employee loaded labor + same overhead', () => {
    const backup = baseBackup()
    const source = resolveProjectLaborSource(backup.settings as any, backup.employees as any, 'tech-1', 'Alex')
    const overhead = buildCostSourceSummary(backup.settings as any, backup.employees as any).overheadRecoveryRate
    expect(source.loadedLaborRate).toBeGreaterThan(0)
    expect(source.internalLaborRate).toBeCloseTo(source.loadedLaborRate + overhead, 2)
  })

  it('PROJECT-COST-9: no numeric fallback if Team labor or overhead is unavailable', () => {
    const backup = baseBackup()
    ;(backup.employees as any[])[0].hourly_rate = 0
    const noLabor = buildProjectLogFinancials(backup, 'p1', null, { hrs: 8, miles: 0, mat: 0, collected: 0 }, 'owner-1', 'Owner / Me')
    expect(noLabor.laborRate).toBe(0)
    expect(noLabor.entryLaborCost).toBeNull()

    const backup2 = baseBackup()
    ;(backup2.settings as any).billableHrsYear = 0
    const noOverhead = buildProjectLogFinancials(backup2, 'p1', null, { hrs: 8, miles: 0, mat: 0, collected: 0 }, 'owner-1', 'Owner / Me')
    expect(noOverhead.laborRate).toBe(0)
    expect(noOverhead.entryLaborCost).toBeNull()
  })

  it('PROJECT-COST-10: Service legacy cost behavior is not modified', () => {
    const backup = baseBackup()
    const roll = buildProjectLogRollup(backup, 'p1')
    expect(roll.byId.l1.entryLaborCost).toBeCloseTo(436.16, 2)
    expect((backup.serviceLogs as any[])[0].opCost).toBeCloseTo(364.72, 2)
  })
})

describe('project labor source contract surfaces', () => {
  it('ProjectLogFinancialPanel uses current loaded labor + overhead language', () => {
    const panel = src('src/components/v15r/ProjectLogFinancialPanel.tsx')
    expect(panel).toContain('resolveProjectLaborSource')
    expect(panel).toContain('current internal labor')
    expect(panel).toContain('loaded labor +')
    expect(panel).not.toContain('Settings → operating cost')
  })

  it('active project-log consumers resolve project labor through the shared authority', () => {
    const projectLogs = src('src/components/v15r/V15rProjectLogsTab.tsx')
    const fieldLogs = src('src/components/v15r/V15rFieldLogPanel.tsx')
    const summary = src('src/components/v15r/ProjectSummaryBoxes.tsx')
    const dashboard = src('src/components/v15r/V15rDashboard.tsx')
    expect(projectLogs).toContain('projectLaborRateForLog')
    expect(fieldLogs).toContain('projectLaborRateForLog')
    expect(summary).toContain('resolveProjectLaborSource')
    expect(dashboard).toContain('resolveProjectLaborSource')
  })
})
