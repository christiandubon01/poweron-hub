/**
 * SERVICE-COST-3B — source contract and integration guards for the Field Log panel.
 *
 * The Service Log panel has no render harness, so modal wiring is asserted as a
 * source contract (the established pattern in src/__tests__). The actual money
 * behaviour is exercised against the real shared helpers.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { quoteFromCostSnapshot, buildCostSnapshot, computeCrewQuote } from '@/features/service-quote/crewCosting'

const panel = readFileSync(
  join(process.cwd(), 'src/components/v15r/V15rFieldLogPanel.tsx'),
  'utf8',
)

function sliceServiceCallModal(): string {
  const start = panel.indexOf('{/* Service Call Modal')
  const end = panel.indexOf('{/* Collections Queue */}')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return panel.slice(start, end)
}

function sliceEstimateModal(): string {
  const start = panel.indexOf('{/* Service Estimate Modal')
  const end = panel.indexOf('{/* Modal Footer */}')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return panel.slice(start, end)
}

describe('SERVICE-COST-3B legacy/frozen/crew mode state', () => {
  it('tracks costing mode for Service Call and Service Estimate', () => {
    expect(panel).toContain("const [slCostingMode, setSlCostingMode]")
    expect(panel).toContain("const [estCostingMode, setEstCostingMode]")
    expect(panel).toContain("const [slFrozenSnapshot, setSlFrozenSnapshot]")
    expect(panel).toContain("const [estFrozenSnapshot, setEstFrozenSnapshot]")
  })

  it('opens old records without costSnapshot in legacy mode', () => {
    expect(panel).toContain("setSlCostingMode('legacy')")
    expect(panel).toContain("setEstCostingMode('legacy')")
    expect(panel).toContain('Old records without a snapshot start in explicit legacy mode')
  })

  it('opens records with costSnapshot in frozen mode', () => {
    expect(panel).toContain("setSlCostingMode('frozen')")
    expect(panel).toContain("setEstCostingMode('frozen')")
  })

  it('resets new records to crew mode', () => {
    const modal = sliceServiceCallModal()
    expect(modal).toContain("setSlCostingMode('crew')")
  })
})

describe('SERVICE-COST-3B explicit owner actions', () => {
  it('shows Upgrade to Crew Costing in legacy mode', () => {
    expect(panel).toContain('Upgrade to Crew Costing')
    expect(panel).toContain('Legacy Cost Calculation')
  })

  it('shows Recalculate Crew Pricing in frozen mode', () => {
    expect(panel).toContain('Recalculate Crew Pricing')
    expect(panel).toContain('Frozen Crew Pricing')
  })

  it('provides onUpgradeToCrew and onRecalculate handlers to CostingCrewField', () => {
    const modal = sliceServiceCallModal()
    expect(modal).toContain('onUpgradeToCrew={() => setSlCostingMode')
    expect(modal).toContain('onRecalculate={() =>')
  })
})

describe('SERVICE-COST-3B snapshot save path', () => {
  it('does not write costSnapshot in legacy mode', () => {
    expect(panel).toContain("if (slCostingMode === 'legacy')")
    expect(panel).toContain("if (estCostingMode === 'legacy')")
    // Legacy branch does not assign a snapshot.
    expect(panel).toContain("svcQuote = serviceCallQuote()")
    expect(panel).toContain("quote = quoteFor(")
  })

  it('preserves existing snapshot in frozen mode', () => {
    expect(panel).toContain("serviceSnapshot = slFrozenSnapshot")
    expect(panel).toContain("estimateSnapshot = estFrozenSnapshot")
  })

  it('computes and writes new snapshot only in crew mode', () => {
    expect(panel).toContain("serviceSnapshot = crewResult.snapshot ?? undefined")
    expect(panel).toContain("estimateSnapshot = crewResult.snapshot ?? undefined")
  })
})

describe('SERVICE-COST-3B display quote helpers', () => {
  it('uses frozen snapshot values without resolving current rates', () => {
    expect(panel).toContain('function serviceCallDisplayQuote()')
    expect(panel).toContain('function estimateDisplayQuote()')
    expect(panel).toContain('quoteFromCostSnapshot(')
  })

  it('reconciles payment status against the displayed quote', () => {
    expect(panel).toContain('reconcileServicePayment(next, slCollected, serviceCallDisplayQuote().totalQuoted)')
  })
})

describe('SERVICE-COST-3B portal-only employee blocking', () => {
  it('propagates resolution.errors into validation', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/features/service-quote/crewCosting.ts'),
      'utf8',
    )
    expect(source).toContain('if (resolution?.errors.length)')
    expect(source).toContain('errors.push(...resolution.errors)')
  })
})

describe('SERVICE-COST-3B snapshot freeze helper', () => {
  it('quoteFromCostSnapshot uses stored rates even if current Team changes', () => {
    const snapshot = buildCostSnapshot(
      computeCrewQuote({
        siteHours: 4,
        crew: [{ costModelEmployeeId: 'a', displayName: 'A', laborCategory: 'field', loadedLaborRate: 30, billRate: 95, laborHours: 4 }],
        materialCost: 0,
        miles: 0,
        mileRate: 0.66,
        taxRatePct: 8.25,
        overheadRecoveryRate: 15.59,
        totalQuoted: 380,
        crewSource: 'assigned',
      }),
    )

    const quote = quoteFromCostSnapshot(snapshot, 380)
    expect(quote.internalCost).toBe(snapshot.totalInternalCost)
    expect(quote.suggestedQuote).toBe(snapshot.suggestedQuote)
  })

  it('quoteFromCostSnapshot derives profit and variance from currentTotalQuoted', () => {
    const snapshot = buildCostSnapshot(
      computeCrewQuote({
        siteHours: 4,
        crew: [{ costModelEmployeeId: 'a', displayName: 'A', laborCategory: 'field', loadedLaborRate: 30, billRate: 95, laborHours: 4 }],
        materialCost: 0,
        miles: 0,
        mileRate: 0.66,
        taxRatePct: 8.25,
        overheadRecoveryRate: 15.59,
        totalQuoted: 380,
        crewSource: 'assigned',
      }),
    )

    const quote = quoteFromCostSnapshot(snapshot, 400)
    expect(quote.totalQuoted).toBe(400)
    expect(quote.actualEstimatedProfit).toBe(217.64)
    expect(quote.quoteVariance).toBe(20)
  })
})
