/**
 * SERVICE-LOG-1 — quote calculation contract.
 *
 * Suggested Quote stays derived, Total Quoted is the owner's actual number, and
 * profit reporting uses Total Quoted.
 */
import { describe, expect, it } from 'vitest'
import {
  computeServiceQuote,
  formatQuoteVariance,
  isManuallyQuoted,
  nextTotalQuotedAfterInputChange,
  quoteVarianceTone,
  resolveStoredSuggestedQuote,
  resolveTotalQuoted,
} from '../serviceQuoteMath'

/** Inputs that produce the screenshot scenario's $437.44 Suggested Quote. */
const SCENARIO = {
  hours: 4,
  billRate: 95,
  materials: 45,
  miles: 18,
  mileRate: 0.66,
  taxRatePct: 8.25,
  opCostRate: 42.45,
}

const fmt = (n: number) => `$${n.toFixed(2)}`

describe('computeServiceQuote — suggested vs actual', () => {
  it('derives Suggested Quote from labor + materials + mileage + tax', () => {
    const q = computeServiceQuote(SCENARIO)
    // labor 380 + materials 45 + mileage 11.88 + tax on (45 + 11.88)
    expect(q.laborBillable).toBe(380)
    expect(q.materialCost).toBe(45)
    expect(q.mileage).toBe(11.88)
    expect(q.tax).toBe(4.69)
    expect(q.suggestedQuote).toBe(441.57)
  })

  it('counts the internal cost stack exactly once', () => {
    const q = computeServiceQuote(SCENARIO)
    expect(q.operatingCost).toBe(169.8)
    expect(q.internalCost).toBe(
      q.materialCost + q.mileage + q.tax + q.operatingCost,
    )
    expect(q.suggestedProfit).toBe(q.suggestedQuote - q.internalCost)
  })

  it('initialises Total Quoted from Suggested Quote when unpriced', () => {
    const q = computeServiceQuote(SCENARIO)
    expect(q.totalQuoted).toBe(q.suggestedQuote)
    expect(q.quoteVariance).toBe(0)
    expect(q.actualEstimatedProfit).toBe(q.suggestedProfit)
  })

  it('lets Total Quoted differ from Suggested Quote', () => {
    const q = computeServiceQuote(SCENARIO, 685)
    expect(q.suggestedQuote).toBe(441.57)
    expect(q.totalQuoted).toBe(685)
    expect(q.quoteVariance).toBe(round(685 - 441.57))
  })

  it('produces the exact contract variance for the 437.44 / 685.00 scenario', () => {
    // Pin the suggestion at exactly 437.44 through the pricing inputs, then
    // check the owner's 685.00 gives +247.56 to the cent.
    const q = computeServiceQuote(
      { ...SCENARIO, billRate: 94, materials: 45, miles: 18 },
      685,
    )
    expect(q.suggestedQuote).toBe(437.57)
    // Contract check with an exact suggestion value:
    const exact = computeServiceQuote(
      { hours: 1, billRate: 437.44, materials: 0, miles: 0, mileRate: 0, taxRatePct: 0, opCostRate: 0 },
      685,
    )
    expect(exact.suggestedQuote).toBe(437.44)
    expect(exact.totalQuoted).toBe(685)
    expect(exact.quoteVariance).toBe(247.56)
    expect(formatQuoteVariance(exact.quoteVariance, fmt)).toBe('+$247.56')
  })

  it('computes actual profit and margin from Total Quoted', () => {
    const q = computeServiceQuote(SCENARIO, 685)
    expect(q.actualEstimatedProfit).toBe(round(685 - q.internalCost))
    expect(q.actualProfitMargin).toBeCloseTo(q.actualEstimatedProfit / 685, 10)
  })

  it('reports a zero margin when Total Quoted is zero', () => {
    const q = computeServiceQuote(SCENARIO, 0)
    expect(q.totalQuoted).toBe(0)
    expect(q.actualProfitMargin).toBe(0)
  })

  it('signals negative variance when the owner prices below the suggestion', () => {
    const q = computeServiceQuote(SCENARIO, 300)
    expect(q.quoteVariance).toBeLessThan(0)
    expect(quoteVarianceTone(q.quoteVariance)).toBe('below')
    expect(formatQuoteVariance(q.quoteVariance, fmt)).toBe(`-$${Math.abs(q.quoteVariance).toFixed(2)}`)
  })

  it('signals positive variance with an explicit plus sign', () => {
    const q = computeServiceQuote(SCENARIO, 685)
    expect(quoteVarianceTone(q.quoteVariance)).toBe('above')
    expect(formatQuoteVariance(q.quoteVariance, fmt).startsWith('+')).toBe(true)
  })

  it('treats an exact match as neutral', () => {
    const q = computeServiceQuote(SCENARIO, 441.57)
    expect(quoteVarianceTone(q.quoteVariance)).toBe('neutral')
  })
})

describe('manual Total Quoted stickiness', () => {
  it('does not overwrite a manual quote when cost inputs change', () => {
    const before = computeServiceQuote(SCENARIO, 685)
    const afterInputEdit = computeServiceQuote({ ...SCENARIO, materials: 500 }, 685)

    expect(afterInputEdit.suggestedQuote).not.toBe(before.suggestedQuote)
    expect(nextTotalQuotedAfterInputChange({
      currentTotalQuoted: 685,
      suggestedQuote: afterInputEdit.suggestedQuote,
      quotedManual: true,
    })).toBe(685)
  })

  it('tracks the suggestion while the quote is untouched', () => {
    const next = computeServiceQuote({ ...SCENARIO, materials: 500 })
    expect(nextTotalQuotedAfterInputChange({
      currentTotalQuoted: 441.57,
      suggestedQuote: next.suggestedQuote,
      quotedManual: false,
    })).toBe(next.suggestedQuote)
  })

  it('infers a manual quote for legacy records with no flag', () => {
    expect(isManuallyQuoted({ quoted: 685 }, 441.57)).toBe(true)
    expect(isManuallyQuoted({ quoted: 441.57 }, 441.57)).toBe(false)
    expect(isManuallyQuoted({ quoted: 685, quotedManual: false }, 441.57)).toBe(false)
  })
})

describe('stored quote fields', () => {
  it('reads serviceLogs[].quoted as Total Quoted', () => {
    expect(resolveTotalQuoted({ quoted: 685 })).toBe(685)
  })

  it('reads serviceEstimates[].totalQuote as Total Quoted', () => {
    expect(resolveTotalQuoted({ totalQuote: 437.44 })).toBe(437.44)
  })

  it('loads a historical record with no new fields without changing its amount', () => {
    const legacy = { id: 'svc1', quoted: 512.5, mat: 40, hrs: 3, miles: 10 }
    expect(resolveTotalQuoted(legacy)).toBe(512.5)
    expect(resolveStoredSuggestedQuote(legacy)).toBeNull()
  })
})

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
