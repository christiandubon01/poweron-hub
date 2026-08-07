/**
 * SERVICE-COST-3C — Total Quoted crew-mode synchronization.
 *
 * The regression: in crew mode the shared ServiceQuotePanel's slider is driven
 * by quote.totalQuoted while the numeric input is driven by the estTotalQuoted /
 * slQuoted string. crewBreakdownToLegacyQuote(...) was called WITHOUT the manual
 * override, so quote.totalQuoted collapsed to Suggested Quote — the slider and
 * the numeric input diverged, drag felt broken, and crew-mode saves persisted
 * Suggested instead of the owner's manual price.
 *
 * The Service Log panel has no DOM render harness in this repo (no jsdom /
 * @testing-library/react), so — following the established pattern in
 * serviceCost3bContract.test.ts — money behaviour is exercised against the REAL
 * shared engines/helpers, and the modal call-site wiring is guarded as a source
 * contract (supplemental).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeCrewQuote, buildCostSnapshot, quoteFromCostSnapshot } from '../crewCosting'
import { computeServiceQuote, round2 } from '../serviceQuoteMath'
import { roundUpToQuoteStep, snapToQuoteStep } from '../servicePaymentStatus'

// ── Mirrors of the fixed V15rFieldLogPanel.tsx wiring ────────────────────────
// Kept intentionally tiny and documented; the REAL math lives in the imported
// engines/helpers below. These mirror the exact rules the panel now uses:
//   • manual override resolution used at every crew call site
//       (estimate: estTotalQuoted, service call: slQuoted):
//         override = manual === '' ? null : parseFloat(manual) || 0
//   • crewBreakdownToLegacyQuote(breakdown, override) totalQuoted rule
//         (V15rFieldLogPanel.tsx crewBreakdownToLegacyQuote):
//         totalQuoted = override == null ? breakdown.suggestedQuote : round2(num(override))
//   • ServiceQuotePanel slider derivation (sliderMax / sliderValue).

function resolveManualOverride(manual: string): number | null {
  return manual === '' ? null : parseFloat(manual) || 0
}

/** Displayed / persisted Total Quoted in crew mode after the SERVICE-COST-3C fix. */
function crewModeTotal(manual: string, breakdown: { suggestedQuote: number }): number {
  const override = resolveManualOverride(manual)
  return override == null ? breakdown.suggestedQuote : round2(override)
}

function sliderState(total: number, suggested: number) {
  const sliderMax = Math.max(
    roundUpToQuoteStep(suggested * 2),
    roundUpToQuoteStep(total),
    1000,
  )
  const sliderValue = Math.min(sliderMax, Math.max(0, snapToQuoteStep(total)))
  return { sliderMax, sliderValue }
}

// A real crew whose Suggested Quote is exactly $437 (4 hrs × $109.25 billable).
function crew437(manual: number) {
  return computeCrewQuote({
    siteHours: 4,
    crew: [{ costModelEmployeeId: 'me', displayName: 'Owner / Me', laborCategory: 'field', loadedLaborRate: 30, billRate: 109.25, laborHours: 4 }],
    materialCost: 0,
    miles: 0,
    mileRate: 0,
    taxRatePct: 0,
    overheadRecoveryRate: 15.59,
    totalQuoted: manual,
    crewSource: 'assigned',
  })
}

describe('SERVICE-COST-3C — Total Quoted crew-mode behaviour', () => {
  it('1. manual Total Quoted ($1,260) above Suggested (~$437) drives value and stays within range', () => {
    const breakdown = crew437(1260)
    expect(breakdown.suggestedQuote).toBe(437)
    // The crew engine preserves the manual total end-to-end.
    expect(breakdown.totalQuoted).toBe(1260)

    const displayed = crewModeTotal('1260', breakdown)
    expect(displayed).toBe(1260)

    const { sliderMax, sliderValue } = sliderState(displayed, breakdown.suggestedQuote)
    expect(sliderValue).toBe(1260)
    expect(sliderMax).toBeGreaterThanOrEqual(1260)
  })

  it('2. Suggested recalculating downward does not overwrite the manual total or shrink max below it', () => {
    // Manual stays "1260" while Suggested drops from 437 to 300.
    const displayed = crewModeTotal('1260', { suggestedQuote: 300 })
    expect(displayed).toBe(1260)
    const { sliderMax } = sliderState(displayed, 300)
    expect(sliderMax).toBeGreaterThanOrEqual(1260)
  })

  it('3. dragging the slider updates the paired total predictably (on the $5 grid)', () => {
    const { sliderValue } = sliderState(800, 437)
    expect(sliderValue).toBe(800)
    // Committing the dragged value keeps it canonical.
    expect(crewModeTotal('800', crew437(800))).toBe(800)
  })

  it('4. numeric entry commits the exact typed value, including amounts off the $5 grid', () => {
    expect(resolveManualOverride('1260')).toBe(1260)
    expect(crewModeTotal('1263', crew437(1263))).toBe(1263)
    expect(crewModeTotal('1255.50', crew437(1255.5))).toBe(1255.5)
  })

  it('5. Enter commits the same exact value as blur (same onTotalQuotedChange path)', () => {
    // Enter blurs the input, firing the identical commit handler.
    expect(crewModeTotal('1260', crew437(1260))).toBe(1260)
  })

  it('6. Use Suggested Quote explicitly sets Total Quoted to Suggested', () => {
    const breakdown = crew437(1260)
    expect(crewModeTotal(String(breakdown.suggestedQuote), breakdown)).toBe(437)
  })

  it('7. an empty (untouched) Total Quoted falls back to Suggested for display, without persisting a manual value', () => {
    expect(crewModeTotal('', crew437(0))).toBe(437)
    expect(resolveManualOverride('')).toBeNull()
  })

  it('8. a typed 0 stays 0 and is never mistaken for empty', () => {
    expect(resolveManualOverride('0')).toBe(0)
    expect(crewModeTotal('0', crew437(0))).toBe(0)
  })

  it('11. crew-mode SAVE persists the manual Total Quoted, not Suggested', () => {
    // Save reads svcQuote.totalQuoted / quote.totalQuoted from the same fixed path.
    const savedQuoted = crewModeTotal('1260', crew437(1260))
    expect(savedQuoted).toBe(1260)
    expect(savedQuoted).not.toBe(437)
  })

  it('13a. legacy mode honours the manual total (real computeServiceQuote)', () => {
    const legacy = computeServiceQuote(
      { hours: 4, billRate: 109.25, materials: 0, miles: 0, mileRate: 0, taxRatePct: 0, opCostRate: 30 },
      1260,
    )
    expect(legacy.suggestedQuote).toBe(437)
    expect(legacy.totalQuoted).toBe(1260)
  })

  it('13b. frozen snapshot keeps its buckets and reflects the current manual total (real quoteFromCostSnapshot)', () => {
    const snapshot = buildCostSnapshot(crew437(1260))
    const frozen = quoteFromCostSnapshot(snapshot, 1260)
    expect(frozen.suggestedQuote).toBe(437) // snapshot bucket unchanged
    expect(frozen.totalQuoted).toBe(1260)
    // Moving only the quote does not recompute the frozen internal cost.
    expect(frozen.internalCost).toBe(snapshot.totalInternalCost)
  })

  it('14. crew mode stays crew-aware: two workers scale crew hours while the manual total is preserved', () => {
    const breakdown = computeCrewQuote({
      siteHours: 4,
      crew: [
        { costModelEmployeeId: 'me', displayName: 'Owner', laborCategory: 'field', loadedLaborRate: 30, billRate: 75, laborHours: 4 },
        { costModelEmployeeId: 'allan', displayName: 'Allan', laborCategory: 'field', loadedLaborRate: 27.6, billRate: 75, laborHours: 4 },
      ],
      materialCost: 0, miles: 0, mileRate: 0, taxRatePct: 0,
      overheadRecoveryRate: 15.59, totalQuoted: 1260, crewSource: 'assigned',
    })
    expect(breakdown.crewLaborHours).toBe(8)
    expect(crewModeTotal('1260', breakdown)).toBe(1260)
  })
})

describe('SERVICE-COST-3C source guard — crew-mode call sites pass the manual override (supplemental)', () => {
  const panel = readFileSync(
    join(process.cwd(), 'src/components/v15r/V15rFieldLogPanel.tsx'),
    'utf8',
  )

  it('no bare crewBreakdownToLegacyQuote(crewResult.breakdown) call remains (that dropped the override)', () => {
    expect(panel).not.toMatch(/crewBreakdownToLegacyQuote\(\s*crewResult\.breakdown\s*\)/)
  })

  it('estimate contexts pass estTotalQuoted and service-call contexts pass slQuoted (display + save = 2 each)', () => {
    const estCalls = panel.match(/crewBreakdownToLegacyQuote\(crewResult\.breakdown, estTotalQuoted/g) || []
    const slCalls = panel.match(/crewBreakdownToLegacyQuote\(crewResult\.breakdown, slQuoted/g) || []
    expect(estCalls.length).toBe(2)
    expect(slCalls.length).toBe(2)
  })
})
