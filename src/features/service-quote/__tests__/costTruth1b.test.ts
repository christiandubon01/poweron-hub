import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCostSnapshot,
  computeCrewQuote,
  freezeCostSnapshot,
  isFrozenCostSnapshot,
  quoteFromCostSnapshot,
  resolveCostedCrew,
  validateCrewForCosting,
} from '../crewCosting'
import {
  nextTotalQuotedAfterInputChange,
  resolveEffectiveEstimateBillRate,
  resolveEstimateBillRateSource,
} from '../serviceQuoteMath'
import { calculateOverheadMetrics, resolveOwnerLoadedLaborCost } from '@/utils/costSourceHelper'
import { OWNER_ASSIGNEE_ID } from '../serviceAssignments'

const fieldLog = readFileSync(join(process.cwd(), 'src/components/v15r/V15rFieldLogPanel.tsx'), 'utf8')
const teamPanel = readFileSync(join(process.cwd(), 'src/components/v15r/V15rTeamPanel.tsx'), 'utf8')

const owner: any = {
  id: 'me', name: 'Owner / Me', role: 'Owner', isOwner: true,
  hourly_rate: 30, costRate: 30, billRate: 95, laborCategory: 'field',
}
const assignment = [{ employeeId: OWNER_ASSIGNEE_ID, profileId: null, name: 'Owner / Me' }]

function strictOwner(rate = 30, estimateBillRate = 120, payrollMult: unknown = undefined) {
  const team = [{ ...owner, hourly_rate: rate }]
  return resolveCostedCrew('assigned', 4, team, assignment, [], {
    strictFinancialInputs: true,
    payrollMult,
    estimateBillRate,
  })
}

function liveQuote(rate = 30, overheadRecoveryRate = 20, estimateBillRate = 120) {
  const resolved = strictOwner(rate, estimateBillRate)
  const validation = validateCrewForCosting(resolved.crew, overheadRecoveryRate, 4, resolved)
  expect(validation.valid).toBe(true)
  return computeCrewQuote({
    siteHours: 4,
    crew: resolved.crew,
    materialCost: 0,
    miles: 0,
    mileRate: 0,
    taxRatePct: 0,
    overheadRecoveryRate,
    totalQuoted: 480,
    estimateBillRate,
  })
}

describe('COST-TRUTH-1B owner rate truth', () => {
  it('renders the persisted owner hourly_rate in OwnerCard', () => {
    expect(teamPanel).toContain('configuredBaseRate = Number((persistedOwner as any)?.hourly_rate)')
    expect(teamPanel).toContain('aria-label="Owner Base Hourly Labor Rate"')
  })

  it('persists edits to hourly_rate on the existing owner row', () => {
    expect(teamPanel).toContain('onSave(owner.id, { hourly_rate: nextRate, costRate: nextRate, applyMultiplier: false }')
    expect(teamPanel).toContain('const emp = backup.employees?.find((e: any) => e.id === id)')
  })

  it('keeps costRate synchronized only as a compatibility mirror', () => {
    expect(teamPanel).toContain('costRate: nextRate')
    expect(teamPanel).toContain('hourly_rate: nextRate')
  })

  it('owner loaded labor equals owner hourly_rate', () => {
    expect(strictOwner().crew[0].loadedLaborRate).toBe(30)
    expect(resolveOwnerLoadedLaborCost([owner], { opCost: 999, payrollMult: 9 })).toBe(30)
  })

  it('never applies payroll multiplier to the owner', () => {
    expect(strictOwner(30, 120, 4).crew[0].loadedLaborRate).toBe(30)
  })

  it('does not derive owner rate from Personal Income Goal or Salary Target', () => {
    expect(resolveOwnerLoadedLaborCost([owner], { personalIncomeGoal: 500000, salaryTarget: 200000 })).toBe(30)
    expect(teamPanel).toContain('Business target')
  })

  it('does not fallback missing owner hourly_rate to settings.opCost or costRate', () => {
    const missing = { ...owner, hourly_rate: undefined, costRate: 888 }
    expect(resolveOwnerLoadedLaborCost([missing], { opCost: 999 })).toBe(0)
    const result = resolveCostedCrew('assigned', 4, [missing], assignment, [], {
      strictFinancialInputs: true, estimateBillRate: 120,
    })
    expect(result.crew).toEqual([])
    expect(result.financialInputErrors?.join(' ')).toContain('Owner Base Hourly Labor Rate required')
  })

  it('shows the missing-owner actionable state in Team and Service Estimate UI', () => {
    expect(teamPanel).toContain('Owner labor rate not configured')
    expect(fieldLog).toContain('Current live cost unavailable')
    expect(strictOwner(0).financialInputErrors?.join(' ')).toContain('Owner Base Hourly Labor Rate required')
  })
})

describe('COST-TRUTH-1B current live OPEN cost', () => {
  it('uses live Team owner labor', () => {
    expect(liveQuote(30).directLaborCost).toBe(120)
    expect(liveQuote(42).directLaborCost).toBe(168)
  })

  it('uses live Overhead Manager recovery', () => {
    expect(liveQuote(30, 20).overheadRecovery).toBe(80)
    expect(liveQuote(30, 35).overheadRecovery).toBe(140)
  })

  it('derives overhead only from configured annual billable hours', () => {
    expect(calculateOverheadMetrics({ essential: [{ monthly: 1000 }] }, 1200).overheadRecoveryRate).toBe(10)
    expect(calculateOverheadMetrics({ essential: [{ monthly: 1000 }] }, 0).overheadRecoveryRate).toBe(0)
  })

  it('does not silently use 936 or 1800 billable hours', () => {
    expect(calculateOverheadMetrics({ essential: [{ monthly: 1000 }] }, Number.NaN).targetRecoveryLaborHours).toBe(0)
    expect(fieldLog).toContain('calculateOverheadMetrics(settings.overhead, num(settings.billableHrsYear))')
  })

  it('does not read settings.opCost in strict crew resolution', () => {
    const a = resolveCostedCrew('assigned', 4, [owner], assignment, [], { strictFinancialInputs: true, estimateBillRate: 120 })
    const b = resolveCostedCrew('assigned', 4, [{ ...owner, opCost: 999 }], assignment, [], { strictFinancialInputs: true, estimateBillRate: 120 })
    expect(a.crew[0].loadedLaborRate).toBe(b.crew[0].loadedLaborRate)
  })

  it('blocks W-2 loaded labor when payroll multiplier is missing', () => {
    const worker: any = { id: 'w2', name: 'W2', classification: 'W-2', hourly_rate: 25, billRate: 90, laborCategory: 'field' }
    const result = resolveCostedCrew('assigned', 4, [worker], [{ employeeId: 'w2', profileId: null, name: 'W2' }], [], {
      strictFinancialInputs: true, estimateBillRate: 120,
    })
    expect(result.crew).toEqual([])
    expect(result.financialInputErrors?.join(' ')).toContain('Payroll burden multiplier required')
  })

  it('uses a configured W-2 payroll multiplier without inventing 1.20', () => {
    const worker: any = { id: 'w2', name: 'W2', classification: 'W-2', hourly_rate: 25, billRate: 90, laborCategory: 'field' }
    const result = resolveCostedCrew('assigned', 4, [worker], [{ employeeId: 'w2', profileId: null, name: 'W2' }], [], {
      strictFinancialInputs: true, payrollMult: 1.35, estimateBillRate: 120,
    })
    expect(result.crew[0].loadedLaborRate).toBe(33.75)
  })

  it('blocks instead of falling back when live crew inputs are invalid', () => {
    expect(fieldLog).toContain("const estCrewErrors = estEffectiveMode === 'crew' ? estimateCrewQuote().errors : []")
    expect(fieldLog).toContain('disabled={estMissingRates.length > 0 || estCrewErrors.length > 0}')
  })
})

describe('COST-TRUTH-1B versioning and freeze boundary', () => {
  it('ordinary Save creates a comparison snapshot, not a freeze', () => {
    const snapshot = buildCostSnapshot(liveQuote())
    expect(snapshot.snapshotKind).toBe('comparison')
    expect(isFrozenCostSnapshot(snapshot)).toBe(false)
  })

  it('Confirm Job adds reliable freeze metadata', () => {
    const frozen = freezeCostSnapshot(buildCostSnapshot(liveQuote()), '2026-08-09T12:00:00.000Z')
    expect(frozen).toMatchObject({
      snapshotKind: 'frozen', frozenAt: '2026-08-09T12:00:00.000Z',
      pricingModel: 'crew', freezeReason: 'confirm-job',
    })
    expect(isFrozenCostSnapshot(frozen)).toBe(true)
  })

  it('frozen cost remains stable when current owner/overhead rates change', () => {
    const frozen = freezeCostSnapshot(buildCostSnapshot(liveQuote(30, 20)))
    const original = quoteFromCostSnapshot(frozen, 480)
    liveQuote(60, 50)
    expect(quoteFromCostSnapshot(frozen, 480).internalCost).toBe(original.internalCost)
  })

  it('OPEN estimate snapshots are restored as previous reference, not frozen authority', () => {
    expect(fieldLog).toContain('setEstPreviousSnapshot(savedSnapshot)')
    expect(fieldLog).toContain("setEstCostingMode('crew')")
    expect(fieldLog).toContain('Reference only')
  })

  it('legacy OPEN version preserves original quote and unavailable provenance honestly', () => {
    expect(fieldLog).toContain("pricingModel: 'solo-legacy'")
    expect(fieldLog).toContain('originalQuote: resolveTotalQuoted(est)')
    expect(fieldLog).toContain('exact historical operating-rate metadata unavailable')
  })

  it('Confirm Job freezes a freshly recomputed live snapshot', () => {
    expect(fieldLog).toContain('const liveResult = estimateCrewQuoteForRecord(est)')
    expect(fieldLog).toContain('const frozenSnapshot = freezeCostSnapshot(liveResult.snapshot, now)')
  })

  it('completion copies the accepted snapshot and never uses current settings.opCost', () => {
    expect(fieldLog).toContain('costSnapshot: acceptedSnapshot')
    expect(fieldLog).toContain('Historical rows never read today')
    expect(fieldLog).not.toContain('const labCost = actHrs * opCost')
  })
})

describe('COST-TRUTH-1B selling-price overrides', () => {
  it('new/inherited Bill Rate resolves from Settings', () => {
    expect(resolveEstimateBillRateSource({ billRate: 120, billRateSource: 'default' }, 140)).toBe('default')
    expect(resolveEffectiveEstimateBillRate({ billRate: 120, billRateSource: 'default' }, 140)).toBe(140)
  })

  it('manual Bill Rate remains record-specific when Settings changes', () => {
    const record = { billRate: 155, billRateSource: 'manual' }
    expect(resolveEffectiveEstimateBillRate(record, 200)).toBe(155)
  })

  it('legacy ambiguous record-specific Bill Rate is preserved as manual', () => {
    expect(resolveEstimateBillRateSource({ billRate: 155 }, 120)).toBe('manual')
    expect(resolveEffectiveEstimateBillRate({ billRate: 155 }, 120)).toBe(155)
  })

  it('crew Suggested Quote uses estimate Bill Rate over Team member Bill Rate', () => {
    const result = computeCrewQuote({
      siteHours: 4,
      crew: [{ costModelEmployeeId: 'me', displayName: 'Owner', laborCategory: 'field', loadedLaborRate: 30, billRate: 70, laborHours: 4 }],
      materialCost: 0, miles: 0, mileRate: 0, taxRatePct: 0,
      overheadRecoveryRate: 20, totalQuoted: 0, estimateBillRate: 150,
    })
    expect(result.billableLabor).toBe(600)
    expect(result.suggestedQuote).toBe(600)
    expect(result.crew[0].billRate).toBe(150)
  })

  it('manual Total Quoted survives cost-input changes', () => {
    expect(nextTotalQuotedAfterInputChange({ currentTotalQuoted: 725, suggestedQuote: 600, quotedManual: true })).toBe(725)
  })

  it('untouched Total Quoted follows Suggested Quote and Use Suggested clears manual state in UI', () => {
    expect(nextTotalQuotedAfterInputChange({ currentTotalQuoted: 725, suggestedQuote: 600, quotedManual: false })).toBe(600)
    expect(fieldLog).toContain('setEstQuotedManual(false)')
  })

  it('exposes clear Bill Rate provenance labels', () => {
    // Field title carries the field name only; provenance is a separate badge.
    expect(fieldLog).toContain('>Bill Rate $</label>')
    expect(fieldLog).toContain("estBillRateSource === 'manual' ? 'Manual Override' : 'From Settings'")
    expect(fieldLog).toContain('billRateSource: estBillRateSource')
  })
})
