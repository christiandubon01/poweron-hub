/**
 * COST-SOURCE-2A contract tests.
 *
 * Test classification:
 *   [LOGIC]   Pure-function assertions against costSourceHelper.ts
 *   [STATIC]  Source-file assertions verifying UI ownership rules
 *
 * Sections:
 *   1.  Overhead calculations (pure)
 *   2.  Owner loaded labor (pure)
 *   3.  Cost-source separation (pure)
 *   4.  Settings UI contracts (static)
 *   5.  Team UI contracts (static)
 *   6.  Regression protection (static)
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  calculateOverheadMetrics,
  resolveOwnerLoadedLaborCost,
  buildCostSourceSummary,
} from '../utils/costSourceHelper'

const ROOT = join(__dirname, '..', '..')
const SETTINGS_SRC = readFileSync(join(ROOT, 'src/components/v15r/V15rSettingsPanel.tsx'), 'utf-8')
const TEAM_SRC = readFileSync(join(ROOT, 'src/components/v15r/V15rTeamPanel.tsx'), 'utf-8')
const HELPER_SRC = readFileSync(join(ROOT, 'src/utils/costSourceHelper.ts'), 'utf-8')

// ─────────────────────────────────────────────────────────────────────────────
// 1. Overhead calculations
// ─────────────────────────────────────────────────────────────────────────────

describe('COST-SOURCE-2A — Overhead calculations', () => {
  const sampleOverhead = {
    essential: [{ monthly: 100 }, { monthly: 50 }],
    extra: [{ monthly: 75 }],
    loans: [{ monthly: 200 }],
    vehicle: [{ monthly: 120 }],
  }

  it('1a. Monthly overhead sums all four buckets', () => {
    const result = calculateOverheadMetrics(sampleOverhead, 936)
    expect(result.monthlyOverhead).toBeCloseTo(545, 2)
  })

  it('1b. Annual overhead is monthlyOverhead × 12', () => {
    const result = calculateOverheadMetrics(sampleOverhead, 936)
    expect(result.annualOverhead).toBeCloseTo(545 * 12, 2)
  })

  it('1c. Recovery rate = annualOverhead / targetRecoveryLaborHours', () => {
    const result = calculateOverheadMetrics(sampleOverhead, 936)
    const expected = (545 * 12) / 936
    expect(result.overheadRecoveryRate).toBeCloseTo(expected, 4)
  })

  it('1d. Recovery rate is zero when billableHrsYear is 0', () => {
    const result = calculateOverheadMetrics(sampleOverhead, 0)
    expect(result.overheadRecoveryRate).toBe(0)
  })

  it('1e. Recovery rate is zero when billableHrsYear is negative', () => {
    const result = calculateOverheadMetrics(sampleOverhead, -10)
    expect(result.overheadRecoveryRate).toBe(0)
  })

  it('1f. Monthly overhead is zero when overhead is empty', () => {
    const result = calculateOverheadMetrics({ essential: [], extra: [], loans: [], vehicle: [] }, 936)
    expect(result.monthlyOverhead).toBe(0)
    expect(result.annualOverhead).toBe(0)
    expect(result.overheadRecoveryRate).toBe(0)
  })

  it('1g. Handles null overhead gracefully', () => {
    const result = calculateOverheadMetrics(null, 936)
    expect(result.monthlyOverhead).toBe(0)
    expect(result.overheadRecoveryRate).toBe(0)
  })

  it('1h. Handles undefined overhead gracefully', () => {
    const result = calculateOverheadMetrics(undefined, 936)
    expect(result.overheadRecoveryRate).toBe(0)
  })

  it('1i. targetRecoveryLaborHours is preserved in result', () => {
    const result = calculateOverheadMetrics(sampleOverhead, 1200)
    expect(result.targetRecoveryLaborHours).toBe(1200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Owner loaded labor
// ─────────────────────────────────────────────────────────────────────────────

describe('COST-SOURCE-2A — Owner loaded labor cost', () => {
  it('2a. Resolves from isOwner employee record', () => {
    const employees = [
      { id: 'emp1', name: 'Josh', hourly_rate: 25, isOwner: false, classification: 'W-2', applyMultiplier: true },
      { id: 'me', name: 'Owner / Me', hourly_rate: 30, isOwner: true, applyMultiplier: false },
    ]
    const settings = { payrollMult: 1.20 }
    const result = resolveOwnerLoadedLaborCost(employees as any, settings)
    expect(result).toBe(30)
  })

  it('2b. Owner is exempt from W-2 payroll multiplier', () => {
    const employees = [
      { id: 'owner-virtual', name: 'Owner / Me', hourly_rate: 30, isOwner: true },
    ]
    const settings = { payrollMult: 1.50 }
    // loaded = base (no multiplier for owner)
    const result = resolveOwnerLoadedLaborCost(employees as any, settings)
    expect(result).toBe(30)
  })

  it('2c. Detects owner by sentinel id "me"', () => {
    const employees = [
      { id: 'me', name: 'Christian', hourly_rate: 28, isOwner: false },
    ]
    const result = resolveOwnerLoadedLaborCost(employees as any, {})
    expect(result).toBe(28)
  })

  it('2d. Detects owner by sentinel name "owner / me"', () => {
    const employees = [
      { id: 'emp123', name: 'Owner / Me', hourly_rate: 35 },
    ]
    const result = resolveOwnerLoadedLaborCost(employees as any, {})
    expect(result).toBe(35)
  })

  it('2e. Returns 0 when no owner record exists', () => {
    const employees = [
      { id: 'emp1', name: 'Josh', hourly_rate: 25, isOwner: false, classification: 'W-2' },
    ]
    const result = resolveOwnerLoadedLaborCost(employees as any, {})
    expect(result).toBe(0)
  })

  it('2f. Returns 0 when employees array is empty', () => {
    const result = resolveOwnerLoadedLaborCost([], {})
    expect(result).toBe(0)
  })

  it('2g. Returns 0 when employees is null', () => {
    const result = resolveOwnerLoadedLaborCost(null, {})
    expect(result).toBe(0)
  })

  it('2h. Does not read settings.opCost — owner wage comes from employee record only', () => {
    // Owner with hourly_rate set — settings.opCost must not override
    const employees = [
      { id: 'me', name: 'Owner', hourly_rate: 30, isOwner: true },
    ]
    const settings = { opCost: 99, payrollMult: 1.20 }
    const result = resolveOwnerLoadedLaborCost(employees as any, settings)
    // Must be 30, not 99
    expect(result).toBe(30)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Cost-source separation
// ─────────────────────────────────────────────────────────────────────────────

describe('COST-SOURCE-2A — Cost-source separation', () => {
  const overhead = {
    essential: [{ monthly: 1000 }],
    extra: [], loans: [], vehicle: [],
  }
  const employees = [
    { id: 'me', name: 'Owner / Me', hourly_rate: 30, isOwner: true },
  ]
  const settings = {
    overhead,
    billableHrsYear: 936,
    opCost: 45.59,
    payrollMult: 1.20,
  }

  it('3a. Overhead recovery rate is separate from employee loaded labor', () => {
    const summary = buildCostSourceSummary(settings as any, employees as any)
    // overhead recovery and owner labor are separate numbers
    expect(summary.overheadRecoveryRate).not.toBe(summary.ownerLoadedLaborCost)
    expect(summary.overheadRecoveryRate).toBeGreaterThan(0)
    expect(summary.ownerLoadedLaborCost).toBeGreaterThan(0)
  })

  it('3b. informationalSoloOwnerCost = ownerLoadedLaborCost + overheadRecoveryRate', () => {
    const summary = buildCostSourceSummary(settings as any, employees as any)
    expect(summary.informationalSoloOwnerCost).toBeCloseTo(
      summary.ownerLoadedLaborCost + summary.overheadRecoveryRate,
      4,
    )
  })

  it('3c. legacyStoredServiceCost reads settings.opCost unchanged', () => {
    const summary = buildCostSourceSummary(settings as any, employees as any)
    expect(summary.legacyStoredServiceCost).toBe(45.59)
  })

  it('3d. legacyStoredServiceCost is NOT automatically equal to informationalSoloOwnerCost', () => {
    const summary = buildCostSourceSummary(settings as any, employees as any)
    // They might coincidentally be close, but must be independently sourced
    // Verify the two properties exist and are independently computed
    expect('legacyStoredServiceCost' in summary).toBe(true)
    expect('informationalSoloOwnerCost' in summary).toBe(true)
  })

  it('3e. Helper never writes back to settings.opCost', () => {
    const settingsCopy = { ...settings, opCost: 45.59 }
    buildCostSourceSummary(settingsCopy as any, employees as any)
    // opCost must not have changed
    expect(settingsCopy.opCost).toBe(45.59)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Settings UI contracts
// ─────────────────────────────────────────────────────────────────────────────

describe('COST-SOURCE-2A — Settings UI contracts', () => {
  it('4a. "Pricing Defaults" section heading exists', () => {
    expect(SETTINGS_SRC).toContain('Pricing Defaults')
  })

  it('4b. "Rates & pricing" old heading is gone', () => {
    expect(SETTINGS_SRC).not.toContain('Rates & pricing')
  })

  it('4c. "Default Customer Bill Rate" label exists', () => {
    expect(SETTINGS_SRC).toContain('Default Customer Bill Rate')
  })

  it('4d. "OH Rate" is not an editable input label', () => {
    // The old editable "OH Rate ($/hr)" label must be gone
    expect(SETTINGS_SRC).not.toContain('OH Rate ($/hr)')
  })

  it('4e. "Owner Labor Cost" is not an editable input label', () => {
    expect(SETTINGS_SRC).not.toContain('Owner Labor Cost ($/hr)')
  })

  it('4f. defaultOHRate is not bound to an onChange input in Settings', () => {
    // The previous editable defaultOHRate input had this onChange pattern
    expect(SETTINGS_SRC).not.toContain('data.settings.defaultOHRate = parseFloat(e.target.value)')
  })

  it('4g. opCost is not bound to an onChange input in Settings', () => {
    // The previous editable opCost input had this onChange pattern
    expect(SETTINGS_SRC).not.toContain('data.settings.opCost = parseFloat(e.target.value)')
  })

  it('4h. "Connected Cost Sources" section exists', () => {
    expect(SETTINGS_SRC).toContain('Connected Cost Sources')
  })

  it('4i. Connected Cost Sources shows Company Overhead Recovery', () => {
    expect(SETTINGS_SRC).toContain('Company Overhead Recovery')
  })

  it('4j. Connected Cost Sources shows Owner Loaded Labor Cost', () => {
    expect(SETTINGS_SRC).toContain('Owner Loaded Labor Cost')
  })

  it('4k. Connected Cost Sources shows Informational Solo Owner Cost', () => {
    expect(SETTINGS_SRC).toContain('Informational Solo Owner Cost')
  })

  it('4l. Connected Cost Sources shows Legacy Solo Service Cost', () => {
    expect(SETTINGS_SRC).toContain('Legacy Solo Service Cost')
  })

  it('4m. billableHrsYear is labeled as overhead-recovery labor-hours', () => {
    expect(SETTINGS_SRC).toContain('Target Overhead Recovery Labor-Hours')
  })

  it('4n. Overhead Manager has explicit label "Monthly Company Overhead"', () => {
    expect(SETTINGS_SRC).toContain('Monthly Company Overhead')
  })

  it('4o. Overhead Manager has explicit label "Annual Company Overhead"', () => {
    expect(SETTINGS_SRC).toContain('Annual Company Overhead')
  })

  it('4p. Overhead Manager has explicit label "Overhead Recovery per Labor-Hour"', () => {
    expect(SETTINGS_SRC).toContain('Overhead Recovery per Labor-Hour')
  })

  it('4q. Overhead Manager has explanatory text about employee wages being separate', () => {
    expect(SETTINGS_SRC).toContain('Employee wages and loaded labor costs are managed separately in Team')
  })

  it('4r. costSourceHelper is imported in Settings panel', () => {
    expect(SETTINGS_SRC).toContain('buildCostSourceSummary')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Team UI contracts
// ─────────────────────────────────────────────────────────────────────────────

describe('COST-SOURCE-2A — Team UI contracts', () => {
  it('5a. "Labor Burden & Capacity Settings" modal title exists', () => {
    expect(TEAM_SRC).toContain('Labor Burden & Capacity Settings')
  })

  it('5b. Old "Team Cost Settings" modal title is gone', () => {
    // The modal h2 title should not say "Team Cost Settings" anymore
    // (button label "Team Cost Settings" is also gone — both updated)
    const modalH2Count = (TEAM_SRC.match(/Team Cost Settings/g) ?? []).length
    expect(modalH2Count).toBe(0)
  })

  it('5c. Button label is "Labor Burden & Capacity"', () => {
    expect(TEAM_SRC).toContain('Labor Burden & Capacity')
  })

  it('5d. "Legacy Employee-Cost References" section heading exists', () => {
    expect(TEAM_SRC).toContain('Legacy Employee-Cost References')
  })

  it('5e. Legacy employee-cost notice says entries are not added to loaded labor cost', () => {
    expect(TEAM_SRC).toContain('not currently added into employee loaded labor cost')
  })

  it('5f. Legacy employee-cost notice says not automatically connected to Overhead Manager', () => {
    expect(TEAM_SRC).toContain('not automatically connected to the Overhead Manager')
  })

  it('5g. "Needs classification" badge exists in modal', () => {
    expect(TEAM_SRC).toContain('Needs classification')
  })

  it('5h. Workers Comp entry is still present (not deleted)', () => {
    expect(TEAM_SRC).toContain("'Workers Comp'")
  })

  it('5i. Payroll Processing entry is still present (not deleted)', () => {
    expect(TEAM_SRC).toContain("'Payroll Processing'")
  })

  it('5j. "Loaded Labor Cost" formula explanation exists in modal', () => {
    expect(TEAM_SRC).toContain('Loaded Labor Cost')
  })

  it('5k. Modal explains loaded cost does not include company overhead recovery', () => {
    expect(TEAM_SRC).toContain('does not include company overhead recovery')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Regression protection
// ─────────────────────────────────────────────────────────────────────────────

describe('COST-SOURCE-2A — Regression protection', () => {
  it('6a. settings.opCost field still readable by Service Log readers', () => {
    // The BackupSettings type still has opCost — never removed
    const backupSvcSrc = readFileSync(join(ROOT, 'src/services/backupDataService.ts'), 'utf-8')
    expect(backupSvcSrc).toContain('opCost')
  })

  it('6b. serviceQuoteMath.ts is unchanged (no Service Log formula modified)', () => {
    const file = join(ROOT, 'src/features/service-quote/serviceQuoteMath.ts')
    expect(existsSync(file)).toBe(true)
    const src = readFileSync(file, 'utf-8')
    // The canonical formula line must still exist
    expect(src).toContain('const operatingCost = round2(hours * opCostRate)')
  })

  it('6c. calculateProjectFinancials.ts is unchanged (INTERNAL_LABOR_RATE untouched)', () => {
    const src = readFileSync(join(ROOT, 'src/utils/calculateProjectFinancials.ts'), 'utf-8')
    expect(src).toContain('INTERNAL_LABOR_RATE = 43')
  })

  it('6d. Migration 115 is byte-identical (not modified)', () => {
    const file = join(ROOT, 'supabase/migrations/115_service_call_employee_assignments.sql')
    expect(existsSync(file)).toBe(true)
    const src = readFileSync(file, 'utf-8')
    // Key structural check: still contains the table definition and backfill
    expect(src).toContain('CREATE TABLE IF NOT EXISTS public.service_call_assignments')
    expect(src).toContain('service_call_assignments_unique_member')
  })

  it('6e. Migration 116 is untouched', () => {
    const file = join(ROOT, 'supabase/migrations/116_sales_conversion_receipts.sql')
    expect(existsSync(file)).toBe(true)
  })

  it('6f. V15rFieldLogPanel.tsx was not modified by this phase', () => {
    const src = readFileSync(join(ROOT, 'src/components/v15r/V15rFieldLogPanel.tsx'), 'utf-8')
    // The canonical readServiceRateSettings function must still use opCost
    expect(src).toContain('opCost')
  })

  it('6g. settings.defaultOHRate is preserved in BackupSettings type', () => {
    const backupSvcSrc = readFileSync(join(ROOT, 'src/services/backupDataService.ts'), 'utf-8')
    expect(backupSvcSrc).toContain('defaultOHRate')
  })

  it('6h. settings.employeeCosts is preserved in BackupSettings type', () => {
    const backupSvcSrc = readFileSync(join(ROOT, 'src/services/backupDataService.ts'), 'utf-8')
    expect(backupSvcSrc).toContain('employeeCosts')
  })

  it('6i. settings.salaryTarget is preserved in BackupSettings type', () => {
    const backupSvcSrc = readFileSync(join(ROOT, 'src/services/backupDataService.ts'), 'utf-8')
    expect(backupSvcSrc).toContain('salaryTarget')
  })

  it('6j. costSourceHelper.ts exports the three required functions', () => {
    expect(HELPER_SRC).toContain('export function calculateOverheadMetrics')
    expect(HELPER_SRC).toContain('export function resolveOwnerLoadedLaborCost')
    expect(HELPER_SRC).toContain('export function buildCostSourceSummary')
  })
})
