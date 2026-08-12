import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUDGET_PREVIOUS_COLOR,
  BUDGET_REMAINING_COLOR,
  BUDGET_THIS_LOG_COLOR,
  buildProjectLogFinancials,
  reconcilableRateText,
  SERVICE_ONLY_EXCLUSIONS,
} from '@/components/v15r/ProjectLogFinancialPanel'
import { type BackupData } from '@/services/backupDataService'
import { calculateProjectFinancials } from '@/utils/calculateProjectFinancials'
import { resolveProjectLaborSource } from '@/utils/costSourceHelper'

/**
 * PROJECT-LOG-FINAL / PROJECT-LOG-UI-2B — owner contract for the Project Log
 * cost-control modal.
 *
 * The New Project Log modal (V15rFieldLogPanel) and the Edit Project Log modal
 * (V15rProjectLogsTab) present ONE shared breakdown: actual project cost
 * consumed so far, what this unsaved log adds, and where that lands against the
 * PROJECT ESTIMATE COST BUDGET.
 *
 * Behavioural assertions run against the shared pure derivation
 * (`buildProjectLogFinancials`); structural assertions pin the two modal call
 * sites to the one shared component so the modes cannot drift.
 */

const ROOT = process.cwd()
function src(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

/**
 * Strip block and line comments so "this must never be rendered" checks test the
 * executable source rather than the prose documenting why it is absent.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const NEW_MODAL = 'src/components/v15r/V15rFieldLogPanel.tsx'
const EDIT_MODAL = 'src/components/v15r/V15rProjectLogsTab.tsx'
const PANEL = 'src/components/v15r/ProjectLogFinancialPanel.tsx'
const HEADER = 'src/components/v15r/V15rLayout.tsx'

/** The live canonical internal rate: $30 loaded + $58,842/2400h = $24.5175 OH. */
const OWNER_RATE = 54.5175
const HELPER_RATE = 34.93625 + 24.5175

/**
 * BEAUTY SALON runtime fixture.
 *
 * Reproduces the accumulated Project Logs page totals exactly:
 *   labor    $8,108.08   = 140h owner @ $54.5175 + 8h helper @ $59.45375
 *   material $5,472.63   = 2500 + 1972.63 + 1000
 *   mileage    $790.02   = 1197 mi × $0.66
 *   collected $17,346.00
 *
 * settings.billRate ($110) and settings.opCost ($45.59) are present precisely
 * so the tests can prove neither is used for project cost.
 *
 * Estimate authorities: 54 estimate labor hours (cost budget 54 × $54.5175 =
 * $2,943.945 — NOT 54 × $110 bill rate), mtoRows costing $3,632, and
 * mileRT 44 × miDays 15 × $0.66 = $435.60. The 54-hour figure is chosen because
 * its raw budget carries a sub-cent tail, which is what exposes the §4
 * one-cent display contradiction.
 */
function makeBeautySalon(overrides: Partial<any> = {}): BackupData {
  return {
    projects: [
      {
        id: 'p3',
        name: 'Beauty Salon',
        contract: 18000,
        status: 'active',
        finance: {},
        mileRT: 44,
        miDays: 15,
        laborRows: [
          { laborId: 'lab-1', hrs: 34, rate: 110, empId: 'me' },
          { laborId: 'lab-2', hrs: 20, rate: 110, empId: 'owner-1' },
        ],
        mtoRows: [
          { mtoId: 'm1', phase: 'Rough In', qty: 100, unitCost: 20 },
          { mtoId: 'm2', phase: 'Trim', qty: 50, unitCost: 30 },
          { mtoId: 'm3', phase: 'Rough In', qty: 10, matId: 'pb1' },
        ],
      },
    ],
    priceBook: [{ id: 'pb1', cost: 12, price: 40, waste: 0.1 }],
    logs: [
      { id: 'l1', projId: 'p3', date: '2026-06-01', empId: 'owner-1', emp: 'Owner / Me', hrs: 60, mat: 2500, miles: 500, collected: 8000 },
      { id: 'l2', projId: 'p3', date: '2026-06-15', empId: 'owner-1', emp: 'Owner / Me', hrs: 50, mat: 1972.63, miles: 400, collected: 6000 },
      { id: 'l3', projId: 'p3', date: '2026-07-01', empId: 'owner-1', emp: 'Owner / Me', hrs: 30, mat: 1000, miles: 250, collected: 3346 },
      { id: 'l4', projId: 'p3', date: '2026-07-10', empId: 'tech-1', emp: 'Helper', hrs: 8, mat: 0, miles: 47, collected: 0 },
    ],
    serviceLogs: [],
    employees: [
      { id: 'owner-1', name: 'Owner / Me', isOwner: true, hourly_rate: 30 },
      { id: 'tech-1', name: 'Helper', classification: '1099', hourly_rate: 34.93625 },
    ],
    settings: {
      opCost: 45.59,
      billRate: 110,
      mileRate: 0.66,
      billableHrsYear: 2400,
      overhead: { essential: [{ monthly: 4903.5 }], extra: [], loans: [], vehicle: [] },
    },
    ...overrides,
  } as unknown as BackupData
}

/** Settings whose overhead lands the internal rate on exactly $54.52/hr. */
const WHOLE_CENT_SETTINGS = {
  opCost: 45.59,
  billRate: 110,
  mileRate: 0.66,
  billableHrsYear: 2400,
  overhead: { essential: [{ monthly: 4904 }], extra: [], loans: [], vehicle: [] },
}

/** The unsaved Beauty Salon draft from the runtime fixture. */
const DRAFT = { hrs: '8', miles: '50', mat: '100', collected: '0' }

const LABOR_BUDGET = 54 * OWNER_RATE // 2943.945
const AFTER_LABOR = 8544.22
const AFTER_MATERIAL = 5572.63
const AFTER_MILEAGE = 823.02

/** Minimal project with no estimate authorities at all. */
function makeBareProject(overrides: Partial<any> = {}): BackupData {
  return makeBeautySalon({
    projects: [{ id: 'p3', name: 'Beauty Salon', contract: 18000, status: 'active', finance: {} }],
    ...overrides,
  })
}

function newLog(backup: BackupData, inputs = DRAFT) {
  return buildProjectLogFinancials(backup, 'p3', null, inputs, 'owner-1', 'Owner / Me')
}

describe('PROJECT-LOG-FINAL — actual vs estimate budget', () => {
  // ── ACTUAL 1..3 / MATH-1 — previous actuals equal the Project Logs page ───
  it('ACTUAL-1 / MATH-1: Beauty Salon New previous labor = $8,108.08', () => {
    expect(newLog(makeBeautySalon()).previousLaborCost).toBeCloseTo(8108.08, 2)
    expect(newLog(makeBeautySalon()).laborBudget.display.previousConsumed).toBe(8108.08)
  })

  it('ACTUAL-2 / MATH-1: Beauty Salon New previous material = $5,472.63', () => {
    expect(newLog(makeBeautySalon()).previousMaterialCost).toBeCloseTo(5472.63, 2)
    expect(newLog(makeBeautySalon()).materialBudget.display.previousConsumed).toBe(5472.63)
  })

  it('ACTUAL-3 / MATH-1: Beauty Salon New previous mileage = $790.02', () => {
    expect(newLog(makeBeautySalon()).previousMileageCost).toBeCloseTo(790.02, 2)
    expect(newLog(makeBeautySalon()).mileageBudget.display.previousConsumed).toBe(790.02)
  })

  // ── ACTUAL 4..6 / MATH 2..4 — the live draft ─────────────────────────────
  it('ACTUAL-4 / MATH-2: 8 hours reconciles with the displayed rate ($436.14)', () => {
    const f = newLog(makeBeautySalon())
    expect(f.laborRate).toBeCloseTo(OWNER_RATE, 4)
    expect(f.entryLaborCost).toBeCloseTo(436.14, 2)
    // The invariant: DISPLAYED RATE × HOURS === DISPLAYED LABOR COST at cents.
    expect(Math.round(Number(f.laborRateText) * f.hours * 100))
      .toBe(Math.round((f.entryLaborCost as number) * 100))
    // $54.52 would contradict $436.14, so the display widens instead.
    expect(f.laborRateText).not.toBe('54.52')
  })

  it('ACTUAL-4B: a whole-cent rate stays at two decimals (8h × $54.52 = $436.16)', () => {
    const f = newLog(makeBeautySalon({ settings: WHOLE_CENT_SETTINGS }))
    expect(f.laborRateText).toBe('54.52')
    expect(f.entryLaborCost).toBeCloseTo(436.16, 2)
    expect(Math.round(Number(f.laborRateText) * f.hours * 100))
      .toBe(Math.round((f.entryLaborCost as number) * 100))
  })

  it('ACTUAL-4C: reconcilableRateText never returns a rate that contradicts its own cost', () => {
    for (const [rate, hours] of [[54.52, 8], [54.5175, 8], [54.5175, 3.25], [61.333333, 7], [0, 8], [54.52, 0]]) {
      const text = reconcilableRateText(rate, hours)
      expect(Math.round(Number(text) * hours * 100)).toBe(Math.round(rate * hours * 100))
    }
  })

  it('ACTUAL-5 / MATH-3: 50 miles × $0.66 = $33.00', () => {
    const f = newLog(makeBeautySalon())
    expect(f.mileRate).toBe(0.66)
    expect(f.entryMileageCost).toBeCloseTo(33, 2)
    expect(f.mileageBudget.display.thisLogConsumed).toBe(33)
  })

  it('ACTUAL-6 / MATH-4: a $100 material draft is $100.00', () => {
    const f = newLog(makeBeautySalon())
    expect(f.entryMaterialCost).toBe(100)
    expect(f.materialBudget.display.thisLogConsumed).toBe(100)
  })

  it('MATH-5: total internal cost this log = $436.14 + $100.00 + $33.00 = $569.14', () => {
    const f = newLog(makeBeautySalon())
    expect(f.entryTotalInternalCostDisplay).toBe(569.14)
    // The tile is the sum of the three DISPLAYED costs, so it always adds up.
    const parts = [f.entryLaborCost as number, f.entryMaterialCost, f.entryMileageCost]
      .map((v) => Math.round(v * 100))
      .reduce((a, b) => a + b, 0)
    expect(Math.round((f.entryTotalInternalCostDisplay as number) * 100)).toBe(parts)
  })

  // ── ACTUAL 7..9 — previous + today = after today ──────────────────────────
  it('ACTUAL-7: previous + today = after today (labor, $8,544.22)', () => {
    const f = newLog(makeBeautySalon())
    expect(f.afterLaborCost).toBeCloseTo(AFTER_LABOR, 2)
    expect(f.afterLaborCost).toBeCloseTo(f.previousLaborCost + (f.entryLaborCost as number), 6)
    expect(f.laborBudget.display.totalConsumed).toBe(AFTER_LABOR)
  })

  it('ACTUAL-8: previous + today = after today (material, $5,572.63)', () => {
    const f = newLog(makeBeautySalon())
    expect(f.afterMaterialCost).toBeCloseTo(AFTER_MATERIAL, 2)
    expect(f.afterMaterialCost).toBeCloseTo(f.previousMaterialCost + f.entryMaterialCost, 6)
    expect(f.materialBudget.display.totalConsumed).toBe(AFTER_MATERIAL)
  })

  it('ACTUAL-9: previous + today = after today (mileage, $823.02)', () => {
    const f = newLog(makeBeautySalon())
    expect(f.afterMileageCost).toBeCloseTo(AFTER_MILEAGE, 2)
    expect(f.afterMileageCost).toBeCloseTo(f.previousMileageCost + f.entryMileageCost, 6)
    expect(f.mileageBudget.display.totalConsumed).toBe(AFTER_MILEAGE)
  })

  // ── MATH-6 — the displayed cents must agree with each other ───────────────
  it('MATH-6: displayed after − displayed budget === displayed over budget, to the cent', () => {
    const f = newLog(makeBeautySalon())
    const cents = (v: number) => Math.round(v * 100)

    for (const card of [f.laborBudget, f.materialBudget, f.mileageBudget]) {
      const d = card.display
      // previous + today = after
      expect(cents(d.previousConsumed) + cents(d.thisLogConsumed)).toBe(cents(d.totalConsumed))
      // after − budget = over budget
      expect(cents(d.totalConsumed) - cents(d.budget as number)).toBe(cents(d.overBudget as number))
      expect(d.remaining).toBe(0)
    }
  })

  it('MATH-6: the fixture reproduces the reported one-cent contradiction and fixes it', () => {
    const f = newLog(makeBeautySalon())
    const d = f.laborBudget.display
    // Raw budget carries a sub-cent tail: 54 × 54.5175 = 2943.945
    expect(f.laborBudget.budget).toBeCloseTo(LABOR_BUDGET, 4)
    expect(d.budget).toBe(2943.95)
    expect(d.totalConsumed).toBe(8544.22)
    // Subtracting the RAW budget from the RAW after gives 5600.28 — one cent
    // adrift from what the owner reads on screen. The display basis gives the
    // number that is actually derivable from the two figures shown.
    expect(Math.round((f.afterLaborCost - (f.laborBudget.budget as number)) * 100) / 100).toBe(5600.28)
    expect(d.overBudget).toBe(5600.27)
    expect(Math.round((d.totalConsumed - (d.budget as number)) * 100) / 100).toBe(d.overBudget)
  })

  it('MATH-6: the canonical authorities are untouched by the display reconciliation', () => {
    const f = newLog(makeBeautySalon())
    // Raw fields keep full precision; only `display` is cents-reconciled.
    expect(f.laborBudget.budget).not.toBe(f.laborBudget.display.budget)
    expect(f.laborBudget.budget).toBeCloseTo(2943.945, 4)
    expect(f.previousLaborCost).toBeCloseTo(8108.08, 6)
    expect(f.entryLaborCost).toBeCloseTo(8 * OWNER_RATE, 6)
  })

  // ── EDIT 1..4 — the stored row is excluded from "previous" ────────────────
  it('EDIT-1: edit excludes the stored current row from previous labor', () => {
    // l3 is 30h owner = 30 × $54.5175 = $1,635.525.
    const f = buildProjectLogFinancials(makeBeautySalon(), 'p3', 'l3', DRAFT, 'owner-1', 'Owner / Me')
    expect(f.previousLaborCost).toBeCloseTo(8108.08 - 30 * OWNER_RATE, 2)
    expect(f.afterLaborCost).toBeCloseTo(8108.08 - 30 * OWNER_RATE + 8 * OWNER_RATE, 2)
  })

  it('EDIT-2: edit excludes the stored current row from previous material', () => {
    const f = buildProjectLogFinancials(makeBeautySalon(), 'p3', 'l3', DRAFT, 'owner-1', 'Owner / Me')
    expect(f.previousMaterialCost).toBeCloseTo(5472.63 - 1000, 2)
    expect(f.afterMaterialCost).toBeCloseTo(4472.63 + 100, 2)
  })

  it('EDIT-3: edit excludes the stored current row from previous mileage', () => {
    const f = buildProjectLogFinancials(makeBeautySalon(), 'p3', 'l3', DRAFT, 'owner-1', 'Owner / Me')
    expect(f.previousMileageCost).toBeCloseTo(790.02 - 250 * 0.66, 2)
    expect(f.afterMileageCost).toBeCloseTo(625.02 + 33, 2)
  })

  it('EDIT-4: changing the edit draft never double-counts the stored values', () => {
    const backup = makeBeautySalon()
    const asStored = buildProjectLogFinancials(backup, 'p3', 'l3', {
      hrs: '30', miles: '250', mat: '1000', collected: '3346',
    }, 'owner-1', 'Owner / Me')
    // Re-entering the stored values reproduces the untouched project totals.
    expect(asStored.afterLaborCost).toBeCloseTo(8108.08, 2)
    expect(asStored.afterMaterialCost).toBeCloseTo(5472.63, 2)
    expect(asStored.afterMileageCost).toBeCloseTo(790.02, 2)
    expect(asStored.projectLifetimeCollected).toBeCloseTo(17346, 2)

    // Editing the draft moves only the draft; previous stays rebased.
    const edited = buildProjectLogFinancials(backup, 'p3', 'l3', {
      hrs: '40', miles: '300', mat: '1500', collected: '3346',
    }, 'owner-1', 'Owner / Me')
    expect(edited.previousLaborCost).toBeCloseTo(asStored.previousLaborCost, 6)
    expect(edited.previousMaterialCost).toBeCloseTo(asStored.previousMaterialCost, 6)
    expect(edited.previousMileageCost).toBeCloseTo(asStored.previousMileageCost, 6)
    expect(edited.afterLaborCost).toBeCloseTo(8108.08 - 30 * OWNER_RATE + 40 * OWNER_RATE, 2)
    expect(edited.afterMaterialCost).toBeCloseTo(4472.63 + 1500, 2)
    expect(edited.afterMileageCost).toBeCloseTo(625.02 + 300 * 0.66, 2)
  })

  it('NEW: previous accumulates every existing project log, none excluded', () => {
    const asNew = newLog(makeBeautySalon())
    const asNewUndefined = buildProjectLogFinancials(makeBeautySalon(), 'p3', undefined, DRAFT, 'owner-1', 'Owner / Me')
    expect(asNew).toEqual(asNewUndefined)
    expect(asNew.previousLaborCost).toBeCloseTo(8108.08, 2)
  })

  // ── BUDGET 1..6 / GUARD-3 — proven estimate COST denominators ─────────────
  it('BUDGET-1: the labor denominator is estimate hours at the project internal COST rate', () => {
    const f = newLog(makeBeautySalon())
    // 54 estimate hours × $54.5175/hr internal labor cost.
    expect(f.laborBudget.budgetAvailable).toBe(true)
    expect(f.laborBudget.budget).toBeCloseTo(LABOR_BUDGET, 4)
  })

  it('BUDGET-2: the material denominator is estimate unit COST × qty × waste', () => {
    const f = newLog(makeBeautySalon())
    // 100×20 + 50×30 + (10 × priceBook cost 12 × 1.1 waste) = 3632
    expect(f.materialBudget.budget).toBeCloseTo(3632, 2)
    // Never the price-book selling price (10 × 40 × 1.1 = 440 would give 3940).
    expect(f.materialBudget.budget).not.toBeCloseTo(3940, 2)
  })

  it('BUDGET-3: the mileage denominator is mileRT × miDays × mileRate = $435.60', () => {
    const f = newLog(makeBeautySalon())
    expect(f.mileageBudget.budget).toBeCloseTo(435.6, 2)
  })

  it('BUDGET-4 / GUARD-3: no customer billable value is ever used as a cost budget', () => {
    const f = newLog(makeBeautySalon())
    // The estimate rows carry rate 110 (settings.billRate). 54h × 110 = 5,940
    // of billable labor REVENUE — never the cost denominator.
    expect(f.laborBudget.budget).not.toBeCloseTo(5940, 2)

    // Moving the bill rate cannot move any denominator.
    const bumped = newLog(makeBeautySalon({
      settings: { ...WHOLE_CENT_SETTINGS, billRate: 500, overhead: { essential: [{ monthly: 4903.5 }], extra: [], loans: [], vehicle: [] } },
    }))
    expect(bumped.laborBudget.budget).toBeCloseTo(f.laborBudget.budget as number, 6)
    expect(bumped.materialBudget.budget).toBeCloseTo(f.materialBudget.budget as number, 6)
    expect(bumped.mileageBudget.budget).toBeCloseTo(f.mileageBudget.budget as number, 6)

    // Nor can settings.opCost, the Legacy Solo Service Cost.
    const legacyMoved = newLog(makeBeautySalon({
      settings: { ...WHOLE_CENT_SETTINGS, opCost: 999, overhead: { essential: [{ monthly: 4903.5 }], extra: [], loans: [], vehicle: [] } },
    }))
    expect(legacyMoved.laborBudget.budget).toBeCloseTo(f.laborBudget.budget as number, 6)

    // The panel never reads the bill-rate field at all.
    expect(stripComments(src(PANEL))).not.toContain('billRate')
  })

  it('BUDGET-5: no denominator is an allocation of the contract value', () => {
    const f = newLog(makeBeautySalon())
    const contract = f.contractValue
    for (const budget of [f.laborBudget.budget, f.materialBudget.budget, f.mileageBudget.budget]) {
      expect(budget).not.toBeCloseTo(contract, 2)
    }
    // Changing the contract cannot move a cost budget.
    const bigger = newLog(makeBeautySalon({
      projects: [{ ...(makeBeautySalon() as any).projects[0], contract: 90000 }],
    }))
    expect(bigger.laborBudget.budget).toBeCloseTo(f.laborBudget.budget as number, 6)
    expect(bigger.materialBudget.budget).toBeCloseTo(f.materialBudget.budget as number, 6)
    expect(bigger.mileageBudget.budget).toBeCloseTo(f.mileageBudget.budget as number, 6)
  })

  it('BUDGET-6: a missing authority renders unavailable and still shows the actuals', () => {
    const f = newLog(makeBareProject())
    for (const budget of [f.laborBudget, f.materialBudget, f.mileageBudget]) {
      expect(budget.budgetAvailable).toBe(false)
      expect(budget.budget).toBeNull()
      expect(budget.display.budget).toBeNull()
      expect(budget.display.remaining).toBeNull()
      expect(budget.display.overBudget).toBeNull()
      expect(budget.display.pctOfBudget).toBeNull()
      expect(budget.display.budgetMarkerPct).toBeNull()
      expect(budget.display.remainingPct).toBe(0)
    }
    // Previous / today / after survive without a denominator.
    expect(f.laborBudget.display.previousConsumed).toBe(8108.08)
    expect(f.laborBudget.display.thisLogConsumed).toBe(436.14)
    expect(f.laborBudget.display.totalConsumed).toBe(AFTER_LABOR)
    expect(f.materialBudget.display.totalConsumed).toBe(AFTER_MATERIAL)
    expect(f.mileageBudget.display.totalConsumed).toBe(AFTER_MILEAGE)

    expect(f.laborBudget.unavailableLabel).toBe('Labor estimate budget unavailable')
    expect(f.materialBudget.unavailableLabel).toBe('Material estimate budget unavailable')
    expect(f.mileageBudget.unavailableLabel).toBe('Mileage estimate budget unavailable')
    const panel = src(PANEL)
    expect(panel).toContain('{budget.unavailableLabel}')
    expect(panel).toContain('Actual cost only — no estimate denominator to measure against.')
  })

  // ── VISUAL 1..6 — locked colour semantics + over-budget rendering ─────────
  it('VISUAL-1/2/3: red is previous, orange is this log, green is remaining — in all three cards', () => {
    expect(BUDGET_PREVIOUS_COLOR).toBe('#ef4444')
    expect(BUDGET_THIS_LOG_COLOR).toBe('#f97316')
    expect(BUDGET_REMAINING_COLOR).toBe('#22c55e')

    const panel = src(PANEL)
    // ONE segment table drives every card, so the meanings cannot diverge.
    expect(panel).toContain("{ key: 'previous', title: 'Previous actual', value: d.previousConsumed, pct: d.previousPct, color: BUDGET_PREVIOUS_COLOR }")
    expect(panel).toContain("{ key: 'this-log', title: 'This log', value: d.thisLogConsumed, pct: d.thisLogPct, color: BUDGET_THIS_LOG_COLOR }")
    expect(panel).toContain("{ key: 'remaining', title: 'Remaining budget', value: d.remaining ?? 0, pct: d.remainingPct, color: BUDGET_REMAINING_COLOR }")
    // The three cards are the same component, not three hand-built variants.
    expect(panel.match(/<BudgetCard budget=\{f\./g)).toHaveLength(3)
  })

  it('VISUAL-4: over budget scales to max(budget, afterToday) and marks the budget target', () => {
    const d = newLog(makeBeautySalon()).laborBudget.display
    expect(d.isOverBudget).toBe(true)
    // Track = after-today because it exceeds the budget.
    expect(d.visualMax).toBe(AFTER_LABOR)
    // Marker sits at the estimate boundary, inside the track.
    expect(d.budgetMarkerPct).toBeCloseTo((2943.95 / AFTER_LABOR) * 100, 6)
    expect(d.budgetMarkerPct as number).toBeLessThan(100)
    // No fake green once the budget is gone.
    expect(d.remainingPct).toBe(0)
    expect(d.remaining).toBe(0)
    expect(src(PANEL)).toContain('budget-marker')
  })

  it('VISUAL-5: the over-budget amount and percentage are explicit', () => {
    const f = newLog(makeBeautySalon())
    expect(f.laborBudget.display.overBudget).toBe(5600.27)
    expect(f.laborBudget.display.pctOfBudget).toBeCloseTo((AFTER_LABOR / 2943.95) * 100, 6)
    expect(f.materialBudget.display.overBudget).toBe(1940.63)
    expect(f.mileageBudget.display.overBudget).toBe(387.42)
    const panel = src(PANEL)
    expect(panel).toContain('Over Budget')
    expect(panel).toContain('.toFixed(1)}% of {budget.budgetLabel.toLowerCase()}')
  })

  it('VISUAL-6: today keeps its true proportion — no fake minimum bar width', () => {
    const f = newLog(makeBeautySalon())
    // Mileage today is $33 of an $823.02 track: a genuinely small slice.
    expect(f.mileageBudget.display.thisLogPct).toBeCloseTo((33 / AFTER_MILEAGE) * 100, 6)
    const panel = src(PANEL)
    expect(panel).not.toMatch(/minWidth|min-w-\[/)
    expect(panel).not.toMatch(/Math\.max\(\s*\d+(\.\d+)?\s*,\s*[a-zA-Z.]*[Pp]ct/)
    // The numeric value is rendered at full size in its own labelled column.
    expect(panel).toContain('label="Today · This Log"')
    expect(panel).toContain('text-base font-bold leading-tight')
  })

  it('VISUAL: under budget keeps a truthful green remainder and no marker', () => {
    const d = buildProjectLogFinancials(
      makeBeautySalon({ logs: [] }),
      'p3', null, DRAFT, 'owner-1', 'Owner / Me',
    ).laborBudget.display
    expect(d.isOverBudget).toBe(false)
    expect(d.visualMax).toBe(2943.95)
    expect(d.remaining).toBe(Math.round((2943.95 - 436.14) * 100) / 100)
    expect(d.previousPct).toBe(0)
    expect(d.thisLogPct).toBeCloseTo((436.14 / 2943.95) * 100, 6)
    expect(d.remainingPct).toBeCloseTo(100 - (436.14 / 2943.95) * 100, 6)
  })

  // ── PREVIEW / LIVE 1..4 — live, and never persisted ──────────────────────
  it('LIVE-1 / PREVIEW-1: changing hours moves labor cost, after-today, over-budget and percentage', () => {
    const backup = makeBeautySalon()
    const a = newLog(backup, { ...DRAFT, hrs: '8' })
    const b = newLog(backup, { ...DRAFT, hrs: '12' })
    expect(b.entryLaborCost).toBeCloseTo(12 * OWNER_RATE, 2)
    expect(b.afterLaborCost).toBeCloseTo(a.afterLaborCost + 4 * OWNER_RATE, 2)
    expect(b.laborBudget.display.overBudget as number).toBeGreaterThan(a.laborBudget.display.overBudget as number)
    expect(b.laborBudget.display.pctOfBudget as number).toBeGreaterThan(a.laborBudget.display.pctOfBudget as number)
    expect(b.laborBudget.display.visualMax).toBeGreaterThan(a.laborBudget.display.visualMax)
    expect(b.entryTotalInternalCostDisplay as number).toBeGreaterThan(a.entryTotalInternalCostDisplay as number)
    // Only labor moved.
    expect(b.afterMaterialCost).toBeCloseTo(a.afterMaterialCost, 6)
    expect(b.afterMileageCost).toBeCloseTo(a.afterMileageCost, 6)
  })

  it('LIVE-2 / PREVIEW-2: changing materials moves material cost, after-today, over-budget and percentage', () => {
    const backup = makeBeautySalon()
    const a = newLog(backup, { ...DRAFT, mat: '100' })
    const b = newLog(backup, { ...DRAFT, mat: '325' })
    expect(b.entryMaterialCost).toBe(325)
    expect(b.afterMaterialCost).toBeCloseTo(a.afterMaterialCost + 225, 2)
    expect(b.materialBudget.display.overBudget as number).toBeCloseTo((a.materialBudget.display.overBudget as number) + 225, 2)
    expect(b.materialBudget.display.pctOfBudget as number).toBeGreaterThan(a.materialBudget.display.pctOfBudget as number)
    expect(b.entryTotalInternalCostDisplay as number).toBeCloseTo((a.entryTotalInternalCostDisplay as number) + 225, 2)
    expect(b.afterLaborCost).toBeCloseTo(a.afterLaborCost, 6)
  })

  it('LIVE-3 / PREVIEW-3: changing miles moves mileage cost, after-today, over-budget and percentage', () => {
    const backup = makeBeautySalon()
    const a = newLog(backup, { ...DRAFT, miles: '50' })
    const b = newLog(backup, { ...DRAFT, miles: '150' })
    expect(b.entryMileageCost).toBeCloseTo(99, 2)
    expect(b.afterMileageCost).toBeCloseTo(a.afterMileageCost + 66, 2)
    expect(b.mileageBudget.display.overBudget as number).toBeCloseTo((a.mileageBudget.display.overBudget as number) + 66, 2)
    expect(b.mileageBudget.display.pctOfBudget as number).toBeGreaterThan(a.mileageBudget.display.pctOfBudget as number)
    expect(b.entryTotalInternalCostDisplay as number).toBeCloseTo((a.entryTotalInternalCostDisplay as number) + 66, 2)
    expect(b.afterMaterialCost).toBeCloseTo(a.afterMaterialCost, 6)
  })

  it('LIVE-4 / PREVIEW-4: previewing never persists and never mutates the snapshot', () => {
    const panel = src(PANEL)
    for (const forbidden of [
      'saveBackupData',
      'saveBackupDataAndSync',
      'persist(',
      'localStorage',
      'supabase',
      'pushState(',
    ]) {
      expect(panel).not.toContain(forbidden)
    }
    const backup = makeBeautySalon()
    const before = JSON.stringify(backup)
    newLog(backup)
    buildProjectLogFinancials(backup, 'p3', 'l3', { hrs: '99', miles: '99', mat: '99', collected: '99' })
    expect(JSON.stringify(backup)).toBe(before)

    // Only the explicit footer action writes, and it lives in the shared shell.
    for (const rel of [NEW_MODAL, EDIT_MODAL]) {
      expect(src(rel)).toMatch(/onSave=\{saveProjEntry\}/)
    }
  })

  // ── AUTHORITY 1..3 / GUARD-3 ──────────────────────────────────────────────
  it('AUTHORITY-1: project labor never uses the legacy service opCost', () => {
    const base = newLog(makeBeautySalon())
    const moved = newLog(makeBeautySalon({
      settings: { ...WHOLE_CENT_SETTINGS, opCost: 999, overhead: { essential: [{ monthly: 4903.5 }], extra: [], loans: [], vehicle: [] } },
    }))
    expect(moved.laborRate).toBeCloseTo(base.laborRate, 6)
    expect(moved.entryLaborCost).toBeCloseTo(base.entryLaborCost as number, 6)
    expect(moved.previousLaborCost).toBeCloseTo(base.previousLaborCost, 6)
    expect(stripComments(src(PANEL))).not.toContain('opCost')
  })

  it('AUTHORITY-2: project labor never uses billRate', () => {
    const f = newLog(makeBeautySalon())
    expect(f.entryLaborCost).not.toBeCloseTo(8 * 110, 2) // $880 bill-rate trap
    expect(f.entryLaborCost).toBeCloseTo(436.14, 2)
    expect(f.laborRate).toBeCloseTo(f.loadedLaborRate + f.overheadRecoveryRate, 6)
  })

  it('AUTHORITY-3: Project Logs page totals and the modal previous totals reconcile', () => {
    const backup = makeBeautySalon()
    const project = (backup as any).projects[0]
    const logs = (backup as any).logs
    // The exact call the Project Logs page makes.
    const page = calculateProjectFinancials(
      project,
      logs,
      0.66,
      (log: any) => resolveProjectLaborSource((backup as any).settings, (backup as any).employees, log?.empId, log?.emp).internalLaborRate,
    )
    const f = newLog(backup)
    expect(f.previousLaborCost).toBeCloseTo(page.labor_cost, 6)
    expect(f.previousMaterialCost).toBeCloseTo(page.material_cost, 6)
    expect(f.previousMileageCost).toBeCloseTo(page.transportation_cost, 6)
    expect(page.labor_cost).toBeCloseTo(8108.08, 2)
    expect(page.material_cost).toBeCloseTo(5472.63, 2)
    expect(page.transportation_cost).toBeCloseTo(790.02, 2)
    // Same default mileage authority as the page (VAN_MILE_RATE), not 0.67.
    const noRate = newLog(makeBeautySalon({
      settings: {
        billRate: 110,
        billableHrsYear: 2400,
        overhead: { essential: [{ monthly: 4903.5 }], extra: [], loans: [], vehicle: [] },
      },
    }))
    expect(noRate.mileRate).toBe(0.66)
    expect(src(PANEL)).toContain('VAN_MILE_RATE')
  })

  // ── GUARDS ────────────────────────────────────────────────────────────────
  it('GUARD-1: this task changes nothing in the header layout', () => {
    const header = src(HEADER)
    expect(header).not.toContain('ProjectLogFinancialPanel')
    expect(header).not.toContain('ProjectLogModalLayout')
    expect(header).not.toContain('buildProjectLogFinancials')
  })

  it('GUARD-2: no Service Log concept leaks into the Project breakdown', () => {
    const panel = src(PANEL)
    for (const metric of SERVICE_ONLY_EXCLUSIONS) {
      const asJsxLabel = new RegExp(`label="${metric}"|>${metric}<`)
      expect(panel).not.toMatch(asJsxLabel)
    }
    const panelCode = stripComments(panel)
    expect(panelCode).not.toContain('frozen snapshot')
    expect(panelCode).not.toMatch(/salesTax|taxRate/)
    expect(panelCode).not.toMatch(/serviceLog|serviceQuote|buildServiceLogRollup/i)
    // Limitations are disclosed rather than silently omitted.
    expect(panel).toContain('loaded labor +')
    expect(panel).toContain("today's Team + Overhead basis")
  })

  it('the derivation exposes no quote / crew-snapshot fields', () => {
    const f = newLog(makeBeautySalon())
    for (const key of [
      'suggestedQuote', 'suggestedProfit', 'totalQuoted', 'quoteVariance',
      'actualEstimatedProfit', 'actualProfitMargin', 'directLaborCost',
      'overheadRecovery', 'billableLabor', 'salesTax', 'snapshot',
    ]) {
      expect(f).not.toHaveProperty(key)
    }
  })

  it('cash, cost, burn and margin stay distinct figures', () => {
    const f = newLog(makeBeautySalon())
    const cumulative = AFTER_LABOR + AFTER_MATERIAL + AFTER_MILEAGE
    expect(f.contractValue).toBe(18000)
    expect(f.projectLifetimeCollected).toBeCloseTo(17346, 2)
    expect(f.uncollectedContract).toBeCloseTo(654, 2)
    expect(f.cumulativeInternalCost).toBeCloseTo(cumulative, 2)
    expect(f.estimatedMarginAtCost).toBeCloseTo(18000 - cumulative, 2)
    expect(f.uncollectedContract).not.toBeCloseTo(f.estimatedMarginAtCost as number, 2)
    expect(f.costBurnPct).toBeCloseTo((cumulative / 18000) * 100, 4)
  })

  it('negative margin is reported, not clamped away', () => {
    const f = buildProjectLogFinancials(
      makeBeautySalon({
        projects: [{ id: 'p3', name: 'Beauty Salon', contract: 500, status: 'active', finance: {} }],
      }),
      'p3', null, DRAFT, 'owner-1', 'Owner / Me',
    )
    expect(f.estimatedMarginAtCost as number).toBeLessThan(0)
    expect(src(PANEL)).toContain('Over contract')
  })

  it('GUARD-4: every owner-facing Project Log field survives in both modals', () => {
    for (const rel of [NEW_MODAL, EDIT_MODAL]) {
      const s = src(rel)
      expect(s).toContain('Job Context')
      expect(s).toContain('Time + Cost Inputs')
      expect(s).toContain('Notes + Proof')
      expect(s).toContain('>Phase<')
      expect(s).toContain('>Date<')
      expect(s).toContain('>Employee<')
      expect(s).toContain('>Hours<')
      expect(s).toContain('>Miles RT<')
      expect(s).toContain('>Collected $<')
      expect(s).toContain('>Store<')
      expect(s).toContain('>Emergency Mat Info<')
      expect(s).toContain('>Detail Link<')
      expect(s).toContain('>Work Performed<')
      expect(s).toContain('>Project<')
    }
  })

  it('New shows an instructional empty state before project selection', () => {
    const panel = src(PANEL)
    expect(panel).toContain('if (!projectId)')
    expect(panel).toContain('project-log-financial-empty-state')
    expect(panel).toContain('Select a project to view the financial breakdown.')
    expect(src(NEW_MODAL)).toContain('projectId={flProj || null}')
    expect(src(NEW_MODAL)).not.toContain('{flProj && (')
  })

  it('the owner-facing tiles stay grouped, complete and de-emphasise margin', () => {
    const panel = src(PANEL)
    // THIS LOG
    expect(panel).toContain('title="This Log"')
    expect(panel).toContain('Internal Labor Cost')
    expect(panel).toContain('label="Material Cost"')
    expect(panel).toContain('label="Mileage Cost"')
    expect(panel).toContain('Total Internal Cost')
    // PROJECT CASH / TOTALS
    expect(panel).toContain('title="Project Cash / Totals"')
    expect(panel).toContain('Collected This Log')
    expect(panel).toContain('Project Lifetime Collected')
    expect(panel).toContain('Project Contract Value')
    expect(panel).toContain('Uncollected Contract')
    expect(panel).toContain('Cumulative Project Cost')
    // SECONDARY — margin is present but not the visual focus.
    expect(panel).toContain('title="Secondary"')
    expect(panel).toContain("Est. Margin at Today's Cost")
    const marginIdx = panel.indexOf("Est. Margin at Today's Cost")
    const budgetIdx = panel.indexOf('Project Budget vs Actual Cost')
    expect(budgetIdx).toBeGreaterThan(-1)
    expect(budgetIdx).toBeLessThan(marginIdx) // budget cards render first
  })
})
