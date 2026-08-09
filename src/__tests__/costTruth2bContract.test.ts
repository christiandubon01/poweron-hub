import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const settingsSrc = readFileSync(join(ROOT, 'src/components/v15r/V15rSettingsPanel.tsx'), 'utf8')
const teamSrc = readFileSync(join(ROOT, 'src/components/v15r/V15rTeamPanel.tsx'), 'utf8')
const layoutSrc = readFileSync(join(ROOT, 'src/components/v15r/V15rLayout.tsx'), 'utf8')
const dashboardSrc = readFileSync(join(ROOT, 'src/components/v15r/V15rDashboard.tsx'), 'utf8')
const chartsSrc = readFileSync(join(ROOT, 'src/components/v15r/charts/SVGCharts.tsx'), 'utf8')
const goalTruthSrc = readFileSync(join(ROOT, 'src/services/businessGoalTruth.ts'), 'utf8')
const costSourceHelperSrc = readFileSync(join(ROOT, 'src/utils/costSourceHelper.ts'), 'utf8')
const fieldLogSrc = readFileSync(join(ROOT, 'src/components/v15r/V15rFieldLogPanel.tsx'), 'utf8')

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function expectLooseLabel(source: string, label: string) {
  const pattern = new RegExp(escapeRegExp(label).replace(/\s+/g, '\\s+'))
  expect(source).toMatch(pattern)
}

describe('COST-TRUTH-2B surface contract', () => {
  it('owner financial controls cannot disappear silently', () => {
    for (const label of [
      'Default Customer Bill Rate ($/hr)',
      'Mile Rate ($/mi)',
      'Markup %',
      'Tax %',
      'Waste %',
      'Default Pricing Crew',
      'Connected Cost Sources',
      'Company Overhead Recovery',
      'Owner Loaded Labor Cost',
      'Informational Solo Owner Cost',
      'Legacy Solo Service Cost',
      'Targets',
      'Daily Target ($)',
      'Annual Revenue Target ($)',
      'Target Overhead Recovery Labor-Hours / Year',
      'AM Block (min)',
      'PM Block (min)',
      'Progress',
      'Personal Income Goal',
      'Annual Personal Income Goal ($)',
      'Overhead %',
      'Required Revenue Target',
    ]) {
      expectLooseLabel(settingsSrc, label)
    }

    expectLooseLabel(teamSrc, 'Target billable hrs/yr')

    for (const label of [
      'Pipeline',
      'Coming Up',
      'Paid',
      'Exposure',
      'Svc Unbilled',
      'Open Projects',
      'Open RFIs',
      'Service Net',
      'Daily Target:',
      '+Log',
      'Save',
    ]) {
      expectLooseLabel(layoutSrc, label)
    }
  })

  it('keeps Personal Income Goal canonical and clearly separate from hourly labor cost', () => {
    expect(settingsSrc).toContain('Owner compensation target. Does not set your hourly labor cost.')
    expect(teamSrc).toContain('Business target - does not set hourly labor cost.')
    expect(goalTruthSrc).toContain('personalIncomeGoal')
    expect(goalTruthSrc).toContain('requiredAnnualRevenue')
  })

  it('restores annualTarget to the active owner-facing targets workflow', () => {
    expect(settingsSrc).toContain('Annual Revenue Target ($)')
    expect(settingsSrc).toContain("data.settings.annualTarget = parseSettingInput(e.target.value) ?? 0")
    expect(settingsSrc).toContain("persist(data, ['annualTarget'])")
    expect(settingsSrc).toContain('Independent from Personal Income Goal and Required Revenue.')
    expect(settingsSrc).not.toContain('Yearly Revenue Target ($)')
  })

  it('restores dayTarget to the owner-facing Daily Target workflow', () => {
    expect(settingsSrc).toContain('Daily Target ($)')
    expect(settingsSrc).toContain("Today's Collected")
    expect(settingsSrc).toContain('Projects + Service')
    expect(settingsSrc).not.toContain('Service Profit Target ($)')
    expect(settingsSrc).not.toContain('Used by Service / Field Log profit-threshold decisions.')
  })

  it('keeps billable hours on settings.billableHrsYear across both owner-facing editors', () => {
    expect(settingsSrc).toContain("data.settings.billableHrsYear = parseFloat(e.target.value) || 936")
    expect(settingsSrc).toContain("persist(data, ['billableHrsYear'])")
    expect(teamSrc).toContain('Target billable hrs/yr')
    expect(teamSrc).toContain('(backup.settings as any).billableHrsYear = num(e.target.value)')
    expect(teamSrc).toContain("stampSettingsFields(backup.settings, ['billableHrsYear'])")
    expect(costSourceHelperSrc).toContain("The company's target billable labor-hours per year (settings.billableHrsYear).")
    expect(settingsSrc).not.toContain('data.settings.targetRecoveryLaborHours =')
  })

  it('restores the Layout top bar to yearly target progress while keeping header KPIs intact', () => {
    expect(layoutSrc).not.toContain('Required revenue target unavailable')
    expect(layoutSrc).not.toContain('Service Profit Target:')
    expect(layoutSrc).toContain('Daily Target:')
    expect(layoutSrc).toContain('settings?.annualTarget')
    expect(layoutSrc).toContain('yearly revenue target')
    expect(layoutSrc).toContain('const paidKpiValue = num(safeKpis.paid)')
    expect(layoutSrc).toContain('const yearlyTargetActual = paidKpiValue')
    expect(layoutSrc).toContain('calculateYearlyRevenueTargetProgress(yearlyTargetActual, annualTargetValue)')
    expect(layoutSrc.match(/fmtHeader\(paidKpiValue\)/g)).toHaveLength(2)
    expect(layoutSrc).not.toContain('calculateCurrentYearFinancialsToDate')
    expect(layoutSrc).not.toContain('currentYearCollected')
    expect(layoutSrc).not.toContain('required annual revenue')
  })

  it('removes the dashboard dayTarget × 20 revenue fiction and replaces it with daily comparison copy', () => {
    expect(dashboardSrc).toContain('Daily Target')
    expect(dashboardSrc).toContain("Today's canonical collected revenue from Projects + Service Calls.")
    expect(dashboardSrc).not.toContain('getDailyTarget')
    expect(dashboardSrc).not.toContain('dayTarget × 20')
    expect(chartsSrc).not.toContain('Target (')
    expect(chartsSrc).not.toContain('Monthly target dashed line')
  })

  it('keeps team goal UI compact and truthful', () => {
    expect(teamSrc).toContain('Current Company Overhead')
    expect(teamSrc).toContain('Trailing 90-Day Collected Revenue')
    expect(teamSrc).toContain('Required Revenue Target')
    expect(teamSrc).not.toContain('Required Revenue Status')
    expect(teamSrc).not.toContain('✗ Below goal')
    expect(teamSrc).not.toContain('Break-even (30% OH)')
  })

  it('removes dayTarget as a service profit threshold authority', () => {
    expect(fieldLogSrc).not.toContain('profit >= dayTarget')
    expect(fieldLogSrc).not.toContain('Above daily target')
    expect(fieldLogSrc).not.toContain('Below daily target')
    expect(fieldLogSrc).toContain('Retired condition')
    expect(fieldLogSrc).not.toContain('settings.dayTarget')
  })

  it('does not hide restored owner controls behind Historical Settings', () => {
    expect(settingsSrc).not.toContain('Historical Settings')
    expect(settingsSrc).not.toContain('Compatibility Overhead %')
    expect(settingsSrc).not.toContain('Historical Solo Service Cost')
  })

  it('keeps the Personal Income Goal field on the stabilized settings-input path', () => {
    expect(settingsSrc).toContain('value={personalIncomeGoalInputValue}')
    expect(settingsSrc).toContain("data.settings.personalIncomeGoal = parseSettingInput(e.target.value) ?? 0")
    expect(settingsSrc).toContain("persist(data, ['personalIncomeGoal'])")
    expect(settingsSrc).toContain('Annual Personal Income Goal ($)')
    expect(settingsSrc).toContain('Overhead %')
    expect(settingsSrc).not.toContain('personalIncomeGoal / (1 - overheadPct / 100) / 12')
  })
})
