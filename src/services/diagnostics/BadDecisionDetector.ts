// @ts-nocheck
/**
 * BadDecisionDetector — Financial Risk Gate for PowerOn Hub
 *
 * Evaluates every financial action against a rule set designed to protect
 * Christian's cash flow and business health.  When a rule fires, the system
 * surfaces a clear, math-backed warning BEFORE the decision is committed.
 *
 * The detector is intentionally opinionated:
 *   RED  → approved = false.  Must acknowledge the risk before proceeding.
 *   AMBER → approved = true, but warnings are surfaced and logged.
 *
 * All flags are written to the audit trail so there is a permanent record
 * of which warnings were seen and whether the user proceeded anyway.
 *
 * Rule categories
 *   PRICING   – floor rate, free work, margin, discounting
 *   CASH FLOW – AR exposure, equipment spend, hiring
 *   CAPACITY  – schedule conflicts, distance, unfamiliar scope
 *
 * Usage
 *   import { assessDecision, getFinancialHealth } from '@/services/diagnostics/BadDecisionDetector'
 *
 *   const result = assessDecision('quote_job', {
 *     hourlyRate: 75,
 *     jobHours: 8,
 *     jobRevenue: 600,
 *     jobCost: 504,
 *   })
 *   // result.approved === false — floor rate violated
 *   // result.flags[0].severity === 'RED'
 */

import { getBackupData, num, daysSince } from '@/services/backupDataService'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Minimum acceptable hourly billing rate ($/hr). */
export const FLOOR_RATE = 85

/** Estimated all-in cost per billable hour ($/hr). */
export const COST_RATE = 63

/** Minimum gross margin (%) a job must achieve. */
export const MIN_MARGIN_PCT = 15

/** Maximum discount percentage from initial quote before a flag fires. */
export const MAX_DISCOUNT_PCT = 10

/** AR exposure ceiling ($) — above this amount triggers a RED flag. */
export const AR_EXPOSURE_LIMIT = 50_000

/** Days-outstanding threshold for overdue AR. */
export const AR_OVERDUE_DAYS = 60

/** Cash reserves must cover at least this many weeks of operating costs. */
export const CASH_RESERVE_WEEKS = 2

/** Revenue safety multiple for new hires (revenue must be N× monthly hire cost). */
export const REVENUE_SAFETY_MULT = 3

/** Miles threshold beyond which a distant-job flag is raised. */
export const DISTANT_JOB_MILES = 50

// ─── Types ──────────────────────────────────────────────────────────────────

/** The category of action being evaluated. */
export type DecisionActionType =
  | 'quote_job'
  | 'offer_free_work'
  | 'accept_job'
  | 'apply_discount'
  | 'spend_on_equipment'
  | 'hire_crew'
  | 'book_job'
  | 'take_distant_job'
  | 'accept_unfamiliar_scope'
  | 'generic'

/** Severity of a decision flag. */
export type FlagSeverity = 'RED' | 'AMBER'

/** Rule category — used for display grouping and filtering. */
export type RuleCategory = 'PRICING' | 'CASH_FLOW' | 'CAPACITY'

/**
 * Context object passed into assessDecision().
 * All fields are optional — the detector only evaluates rules for which
 * sufficient context has been provided.
 */
export interface DecisionContext {
  // Pricing context
  hourlyRate?: number           // Proposed billing rate ($/hr)
  freeHours?: number            // Hours of free / no-charge work
  jobRevenue?: number           // Total projected revenue for the job ($)
  jobCost?: number              // Total projected cost for the job ($)
  initialQuote?: number         // Quote amount before discount ($)
  finalQuote?: number           // Quote amount after discount ($)

  // Cash flow context
  cashOnHand?: number           // Current cash balance ($)
  monthlyBurnRate?: number      // Operating expenses per month ($)
  equipmentCost?: number        // Proposed equipment purchase ($)
  newHireMonthlyCost?: number   // Estimated monthly cost of new hire ($)
  monthlyRevenue?: number       // Current / projected monthly revenue ($)

  // Capacity context
  jobStartDate?: string         // ISO date — when the new job begins
  jobEndDate?: string           // ISO date — when the new job ends
  conflictingProject?: string   // Name of project already in schedule
  jobMiles?: number             // Distance to job site (one-way miles)
  nearbyLocalLead?: string      // Description of a comparable local lead
  localLeadValue?: number       // Value of the local lead ($)
  unfamiliarScope?: string[]    // Scope items outside normal expertise

  // Free-form label for display
  jobLabel?: string             // Human-readable job name / description
}

/** A single flag returned by the rule engine. */
export interface DecisionFlag {
  /** Unique rule identifier. */
  ruleId: string
  /** Flag type — mirrors the rule category. */
  category: RuleCategory
  /** RED = hard block, AMBER = soft warning. */
  severity: FlagSeverity
  /** Short, human-readable headline. */
  title: string
  /** Full explanation with dollar amounts filled in. */
  message: string
  /** What to do instead. */
  suggestion: string
  /** The exact math behind the flag (shown in the overlay). */
  math?: string
}

/** Result returned by assessDecision(). */
export interface DecisionResult {
  /**
   * True when no RED flags exist.
   * false → the user must explicitly acknowledge before proceeding.
   */
  approved: boolean
  flags: DecisionFlag[]
  /** Snapshot of the financial state at the time of assessment. */
  financialSnapshot: FinancialHealth
  /** ISO timestamp of this assessment. */
  assessedAt: string
}

/** Aging bucket for AR. */
export interface ARAgingBucket {
  label: string       // '0-30 days' | '31-60 days' | '61-90 days' | '90+ days'
  amount: number
  count: number
}

/** Snapshot of current financial health — shown in RED-flag overlays. */
export interface FinancialHealth {
  cashOnHand: number
  arTotal: number
  arAging: ARAgingBucket[]
  monthlyBurnRate: number
  runwayWeeks: number
  /** Name of the single largest debtor. */
  biggestDebtor: string | null
  biggestDebtorAmount: number
  generatedAt: string
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function pct(part: number, whole: number): number {
  if (!whole) return 0
  return Math.round((part / whole) * 100)
}

function fmt(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%'
}

/** Compute a rough monthly burn rate from backup settings. */
function computeMonthlyBurn(): number {
  try {
    const data = getBackupData()
    if (!data?.settings?.overhead) return 0
    const oh = data.settings.overhead
    const essential = (oh.essential || []).reduce((s: number, r: any) => s + num(r.monthly), 0)
    const extra     = (oh.extra     || []).reduce((s: number, r: any) => s + num(r.monthly), 0)
    const loans     = (oh.loans     || []).reduce((s: number, r: any) => s + num(r.monthly), 0)
    const vehicle   = (oh.vehicle   || []).reduce((s: number, r: any) => s + num(r.monthly), 0)
    // Include salary target as monthly cost
    const salaryMo  = num(data.settings.salaryTarget) / 12
    return essential + extra + loans + vehicle + salaryMo
  } catch {
    return 0
  }
}

/** Build AR line items from service logs and projects. */
function buildARItems(): { total: number; biggest: string | null; biggestAmt: number; aging: ARAgingBucket[] } {
  try {
    const data = getBackupData()
    if (!data) return { total: 0, biggest: null, biggestAmt: 0, aging: [] }

    const aging: ARAgingBucket[] = [
      { label: '0-30 days',  amount: 0, count: 0 },
      { label: '31-60 days', amount: 0, count: 0 },
      { label: '61-90 days', amount: 0, count: 0 },
      { label: '90+ days',   amount: 0, count: 0 },
    ]

    let total = 0
    let biggest: string | null = null
    let biggestAmt = 0

    // Service logs AR
    for (const log of data.serviceLogs || []) {
      const quoted    = num(log.quoted)
      const collected = num(log.collected)
      const balance   = Math.max(0, quoted - collected)
      if (balance < 0.01) continue

      total += balance
      if (balance > biggestAmt) {
        biggestAmt = balance
        biggest = log.customer || 'Unknown'
      }

      const days = daysSince(log.date)
      if      (days <= 30) { aging[0].amount += balance; aging[0].count++ }
      else if (days <= 60) { aging[1].amount += balance; aging[1].count++ }
      else if (days <= 90) { aging[2].amount += balance; aging[2].count++ }
      else                  { aging[3].amount += balance; aging[3].count++ }
    }

    // Project AR (billed but not yet paid)
    for (const proj of data.projects || []) {
      const billed  = num(proj.billed)
      const paid    = num(proj.paid)
      const balance = Math.max(0, billed - paid)
      if (balance < 0.01) continue

      total += balance
      if (balance > biggestAmt) {
        biggestAmt = balance
        biggest = proj.name || 'Unknown Project'
      }

      // Use project's lastMove date for aging
      const days = daysSince(proj.lastMove)
      if      (days <= 30) { aging[0].amount += balance; aging[0].count++ }
      else if (days <= 60) { aging[1].amount += balance; aging[1].count++ }
      else if (days <= 90) { aging[2].amount += balance; aging[2].count++ }
      else                  { aging[3].amount += balance; aging[3].count++ }
    }

    return { total, biggest, biggestAmt, aging }
  } catch {
    return { total: 0, biggest: null, biggestAmt: 0, aging: [] }
  }
}

/** Check if there is any AR older than N days outstanding. */
function hasOverdueAR(days: number): { has: boolean; overdueTotal: number } {
  try {
    const data = getBackupData()
    if (!data) return { has: false, overdueTotal: 0 }
    let overdueTotal = 0
    for (const log of data.serviceLogs || []) {
      const balance = Math.max(0, num(log.quoted) - num(log.collected))
      if (balance < 0.01) continue
      if (daysSince(log.date) > days) overdueTotal += balance
    }
    for (const proj of data.projects || []) {
      const balance = Math.max(0, num(proj.billed) - num(proj.paid))
      if (balance < 0.01) continue
      if (daysSince(proj.lastMove) > days) overdueTotal += balance
    }
    return { has: overdueTotal > 0, overdueTotal }
  } catch {
    return { has: false, overdueTotal: 0 }
  }
}

// ─── Rule evaluators ─────────────────────────────────────────────────────────
// Each evaluator receives the context and returns a flag or null.

function ruleBelowFloorRate(ctx: DecisionContext): DecisionFlag | null {
  if (ctx.hourlyRate === undefined) return null
  if (ctx.hourlyRate >= FLOOR_RATE) return null

  const margin = ctx.hourlyRate - COST_RATE
  const marginPct = pct(margin, ctx.hourlyRate)

  return {
    ruleId: 'PRICE_001',
    category: 'PRICING',
    severity: 'RED',
    title: 'Below floor rate',
    message: `You're quoting ${fmt(ctx.hourlyRate)}/hr — below your ${fmt(FLOOR_RATE)}/hr floor. ` +
             `Your all-in cost is ${fmt(COST_RATE)}/hr. ` +
             `At this rate you're netting ${fmt(margin)}/hr — a margin of ${fmtPct(marginPct)}.`,
    suggestion: `Raise the rate to at least ${fmt(FLOOR_RATE)}/hr. ` +
                `If the client pushes back, present your cost breakdown — not your markup.`,
    math: `${fmt(ctx.hourlyRate)}/hr quoted − ${fmt(COST_RATE)}/hr cost = ${fmt(margin)}/hr net (${fmtPct(marginPct)} margin)`,
  }
}

function ruleFreeWork(ctx: DecisionContext): DecisionFlag | null {
  if (!ctx.freeHours || ctx.freeHours <= 0) return null

  const pocketCost = ctx.freeHours * COST_RATE
  const jobLabel   = ctx.jobLabel || 'this work'

  return {
    ruleId: 'PRICE_002',
    category: 'PRICING',
    severity: 'RED',
    title: 'Free work = out-of-pocket cost',
    message: `Offering ${ctx.freeHours} free hours on ${jobLabel} costs you ${fmt(pocketCost)} out of pocket. ` +
             `"Free" work is never free — it comes directly off your paycheck.`,
    suggestion: `Counter with a discounted inspection/assessment rate (e.g. ${fmt(FLOOR_RATE * ctx.freeHours)} at floor rate). ` +
                `Or apply the hours as a warranty/goodwill visit and document it formally.`,
    math: `${ctx.freeHours} hrs × ${fmt(COST_RATE)}/hr cost = ${fmt(pocketCost)} out of pocket`,
  }
}

function ruleLowMarginJob(ctx: DecisionContext): DecisionFlag | null {
  if (ctx.jobRevenue === undefined || ctx.jobCost === undefined) return null
  if (ctx.jobRevenue <= 0) return null

  const profit    = ctx.jobRevenue - ctx.jobCost
  const marginPct = pct(profit, ctx.jobRevenue)
  if (marginPct >= MIN_MARGIN_PCT) return null

  return {
    ruleId: 'PRICE_003',
    category: 'PRICING',
    severity: 'AMBER',
    title: 'Job margin below 15%',
    message: `This job nets ${fmt(profit)} after costs — a ${fmtPct(marginPct)} margin. ` +
             `Your threshold is ${fmtPct(MIN_MARGIN_PCT)}. Is the volume worth the thin margin?`,
    suggestion: `Review material and labor costs for compression opportunities. ` +
                `If scope is fixed, negotiate a higher contract price or walk away.`,
    math: `${fmt(ctx.jobRevenue)} revenue − ${fmt(ctx.jobCost)} cost = ${fmt(profit)} profit (${fmtPct(marginPct)})`,
  }
}

function ruleExcessiveDiscount(ctx: DecisionContext): DecisionFlag | null {
  if (ctx.initialQuote === undefined || ctx.finalQuote === undefined) return null
  if (ctx.initialQuote <= 0) return null

  const dropped    = ctx.initialQuote - ctx.finalQuote
  const droppedPct = pct(dropped, ctx.initialQuote)
  if (droppedPct <= MAX_DISCOUNT_PCT) return null

  return {
    ruleId: 'PRICE_004',
    category: 'PRICING',
    severity: 'AMBER',
    title: `You dropped ${fmt(dropped)} off your quote`,
    message: `You discounted ${fmtPct(droppedPct)} (${fmt(dropped)}) from your initial quote of ${fmt(ctx.initialQuote)}. ` +
             `Was that negotiated — or a reflex response to pushback?`,
    suggestion: `Hold your number. If you must move, discount no more than ${fmtPct(MAX_DISCOUNT_PCT)} total. ` +
                `Offer to reduce scope instead of reducing price.`,
    math: `${fmt(ctx.initialQuote)} initial − ${fmt(ctx.finalQuote)} final = ${fmt(dropped)} given away (${fmtPct(droppedPct)})`,
  }
}

function ruleARExposure(ctx: DecisionContext): DecisionFlag | null {
  const ar = buildARItems()
  if (ar.total < AR_EXPOSURE_LIMIT) return null

  const shortfall = ar.biggestAmt * 0.3  // estimate 30% risk on biggest debtor
  const label     = ar.biggest || 'your largest debtor'

  return {
    ruleId: 'CASH_001',
    category: 'CASH_FLOW',
    severity: 'RED',
    title: 'AR exposure critical',
    message: `Accounts receivable is at ${fmt(ar.total)} — above the ${fmt(AR_EXPOSURE_LIMIT)} danger threshold. ` +
             `If ${label} pays late, you could be ${fmt(shortfall)} short on operating costs.`,
    suggestion: `Send a collections follow-up today. Do not add more credit exposure until AR drops below ${fmt(AR_EXPOSURE_LIMIT)}.`,
    math: `Total AR: ${fmt(ar.total)} | Biggest debtor: ${label} at ${fmt(ar.biggestAmt)}`,
  }
}

function ruleAddingJobWithOverdueAR(ctx: DecisionContext): DecisionFlag | null {
  const { has, overdueTotal } = hasOverdueAR(AR_OVERDUE_DAYS)
  if (!has) return null

  return {
    ruleId: 'CASH_002',
    category: 'CASH_FLOW',
    severity: 'AMBER',
    title: `Outstanding AR > ${AR_OVERDUE_DAYS} days`,
    message: `You have ${fmt(overdueTotal)} that has been outstanding more than ${AR_OVERDUE_DAYS} days. ` +
             `Adding a new job increases your exposure before the old money is collected.`,
    suggestion: `Make at least one collection call before booking this job. ` +
                `Collecting even half the overdue AR changes your cash position significantly.`,
    math: `Overdue (>${AR_OVERDUE_DAYS} days): ${fmt(overdueTotal)}`,
  }
}

function ruleEquipmentSpendLowCash(ctx: DecisionContext): DecisionFlag | null {
  if (ctx.equipmentCost === undefined || ctx.equipmentCost <= 0) return null
  if (ctx.cashOnHand === undefined && ctx.monthlyBurnRate === undefined) {
    // Try to derive from backup data
    const burn = computeMonthlyBurn()
    if (burn <= 0) return null
    // Can't determine cash on hand — flag as AMBER to prompt review
    const weeklyCost = burn / 4.33
    const twoWeekCost = weeklyCost * CASH_RESERVE_WEEKS
    return {
      ruleId: 'CASH_003',
      category: 'CASH_FLOW',
      severity: 'AMBER',
      title: 'Equipment spend — verify cash reserves first',
      message: `This purchase costs ${fmt(ctx.equipmentCost)}. Your estimated 2-week operating cost is ${fmt(twoWeekCost)}. ` +
               `Verify you have at least ${fmt(twoWeekCost + ctx.equipmentCost)} before proceeding.`,
      suggestion: `Check your bank balance. If reserves are under ${CASH_RESERVE_WEEKS} weeks of burn, delay this purchase.`,
      math: `Monthly burn ≈ ${fmt(burn)} → 2-week reserve needed: ${fmt(twoWeekCost)} + purchase ${fmt(ctx.equipmentCost)} = ${fmt(twoWeekCost + ctx.equipmentCost)}`,
    }
  }

  const cash  = ctx.cashOnHand || 0
  const burn  = ctx.monthlyBurnRate || computeMonthlyBurn()
  const weeklyCost = burn / 4.33
  const reserveNeeded = weeklyCost * CASH_RESERVE_WEEKS
  const cashAfterPurchase = cash - ctx.equipmentCost
  const weeksAfterPurchase = cashAfterPurchase / weeklyCost

  if (weeksAfterPurchase >= CASH_RESERVE_WEEKS) return null

  return {
    ruleId: 'CASH_003',
    category: 'CASH_FLOW',
    severity: 'RED',
    title: 'Cash reserves too thin for this purchase',
    message: `After spending ${fmt(ctx.equipmentCost)}, you'd have ${fmt(cashAfterPurchase)} in cash — ` +
             `only ${weeksAfterPurchase.toFixed(1)} weeks of operating costs. ` +
             `You need at least ${CASH_RESERVE_WEEKS} weeks reserved at all times.`,
    suggestion: `Delay this purchase until cash reserves exceed ${fmt(reserveNeeded + ctx.equipmentCost)}. ` +
                `Or explore financing / rental to preserve cash.`,
    math: `${fmt(cash)} cash − ${fmt(ctx.equipmentCost)} purchase = ${fmt(cashAfterPurchase)} (${weeksAfterPurchase.toFixed(1)} weeks)`,
  }
}

function ruleHiringWithoutRevenue(ctx: DecisionContext): DecisionFlag | null {
  if (!ctx.newHireMonthlyCost || ctx.newHireMonthlyCost <= 0) return null

  const revenue       = ctx.monthlyRevenue || 0
  const requiredRev   = ctx.newHireMonthlyCost * REVENUE_SAFETY_MULT
  const isSafe        = revenue >= requiredRev

  if (isSafe) return null

  return {
    ruleId: 'CASH_004',
    category: 'CASH_FLOW',
    severity: 'RED',
    title: 'Revenue insufficient to support this hire',
    message: `This hire costs ${fmt(ctx.newHireMonthlyCost)}/month. ` +
             `You need ${fmt(requiredRev)}/month in revenue to absorb them safely (${REVENUE_SAFETY_MULT}× rule). ` +
             `Current monthly revenue: ${fmt(revenue)}.`,
    suggestion: `Build the pipeline first. ` +
                `Get to ${fmt(requiredRev)}/month consistently before adding fixed labor costs.`,
    math: `${fmt(ctx.newHireMonthlyCost)}/mo × ${REVENUE_SAFETY_MULT} = ${fmt(requiredRev)} required | current: ${fmt(revenue)}/mo`,
  }
}

function ruleScheduleConflict(ctx: DecisionContext): DecisionFlag | null {
  if (!ctx.conflictingProject) return null

  return {
    ruleId: 'CAP_001',
    category: 'CAPACITY',
    severity: 'RED',
    title: 'Schedule conflict detected',
    message: `This job overlaps with "${ctx.conflictingProject}" which is already committed. ` +
             `Running both simultaneously means one will slip — and that slip will cost you professionally.`,
    suggestion: `Either push the new job start date out, or have an honest conversation about the conflict ` +
                `before signing. Don't paper over a schedule problem.`,
    math: `Conflict: ${ctx.jobLabel || 'new job'} overlaps "${ctx.conflictingProject}"`,
  }
}

function ruleDistantJob(ctx: DecisionContext): DecisionFlag | null {
  if (ctx.jobMiles === undefined || ctx.jobMiles <= DISTANT_JOB_MILES) return null

  // Estimate drive time cost: 2× miles (round trip) at $0.67/mi + 2h of labor each way
  const driveCostMile = 0.67
  const rtMiles       = ctx.jobMiles * 2
  const driveCost     = rtMiles * driveCostMile + (2 * COST_RATE)

  const localLabel  = ctx.nearbyLocalLead || 'a local lead'
  const localValue  = ctx.localLeadValue  ? `(${fmt(ctx.localLeadValue)} value)` : ''

  return {
    ruleId: 'CAP_002',
    category: 'CAPACITY',
    severity: 'AMBER',
    title: 'Distant job — drive time eats margin',
    message: `This job is ${ctx.jobMiles} miles away. Drive time alone costs approximately ${fmt(driveCost)} per visit ` +
             `(${rtMiles} miles RT + 2h labor). You have ${localLabel} ${localValue} that is comparable value without the drive.`,
    suggestion: `Prioritize the local pipeline first. If you take the distant job, ` +
                `build the drive cost into your quote explicitly — don't absorb it.`,
    math: `${rtMiles} miles RT × $${driveCostMile}/mi + 2h × ${fmt(COST_RATE)}/hr = ${fmt(driveCost)} drive overhead/visit`,
  }
}

function ruleUnfamiliarScope(ctx: DecisionContext): DecisionFlag | null {
  if (!ctx.unfamiliarScope || ctx.unfamiliarScope.length === 0) return null

  const items = ctx.unfamiliarScope.join(', ')

  return {
    ruleId: 'CAP_003',
    category: 'CAPACITY',
    severity: 'AMBER',
    title: 'Scope outside your established expertise',
    message: `This job includes: ${items}. ` +
             `These are areas where you don't have a solid execution track record. ` +
             `Unfamiliar scope always runs over budget.`,
    suggestion: `Budget a 20% contingency on the affected scope items. ` +
                `Or bring in a consultant/sub for those portions and mark up their cost.`,
    math: `Unfamiliar items: ${items} → add 20% contingency to those line items`,
  }
}

// ─── Rule registry ────────────────────────────────────────────────────────────

type RuleEvaluator = (ctx: DecisionContext) => DecisionFlag | null

const PRICING_RULES: RuleEvaluator[] = [
  ruleBelowFloorRate,
  ruleFreeWork,
  ruleLowMarginJob,
  ruleExcessiveDiscount,
]

const CASH_FLOW_RULES: RuleEvaluator[] = [
  ruleARExposure,
  ruleAddingJobWithOverdueAR,
  ruleEquipmentSpendLowCash,
  ruleHiringWithoutRevenue,
]

const CAPACITY_RULES: RuleEvaluator[] = [
  ruleScheduleConflict,
  ruleDistantJob,
  ruleUnfamiliarScope,
]

const ALL_RULES: RuleEvaluator[] = [
  ...PRICING_RULES,
  ...CASH_FLOW_RULES,
  ...CAPACITY_RULES,
]

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate a pending financial action against all decision rules.
 *
 * @param action  - The type of action being assessed (for internal routing).
 * @param context - Numeric and descriptive context for the action.
 * @returns DecisionResult — flags, approved status, and financial snapshot.
 *
 * Rules to note:
 * - If any RED flag fires → approved = false.
 * - If only AMBER flags fire → approved = true (warnings shown, not blocked).
 * - All RED-flag blocks require explicit user acknowledgement before proceeding.
 */
export function assessDecision(
  action: DecisionActionType,
  context: DecisionContext,
): DecisionResult {
  const flags: DecisionFlag[] = []

  for (const rule of ALL_RULES) {
    try {
      const flag = rule(context)
      if (flag) flags.push(flag)
    } catch (err) {
      console.warn('[BadDecisionDetector] Rule evaluation error:', err)
    }
  }

  const hasRed = flags.some(f => f.severity === 'RED')

  return {
    approved: !hasRed,
    flags,
    financialSnapshot: getFinancialHealth(),
    assessedAt: new Date().toISOString(),
  }
}

/**
 * Return a real-time snapshot of current financial health.
 *
 * Sources:
 * - Cash on hand → not tracked in backup data (requires manual context)
 * - AR → derived from service logs and project billed/paid gaps
 * - Monthly burn → overhead settings + salary target
 * - Runway → cash / (burn / 4.33 weeks) — requires cashOnHand to be meaningful
 *
 * The snapshot is embedded in every DecisionResult for display in overlays.
 */
export function getFinancialHealth(): FinancialHealth {
  const burn = computeMonthlyBurn()
  const ar   = buildARItems()

  // Cash on hand is not persisted in backup state — surface as 0 with a note
  // that the user must wire it from their bank feed or manual entry.
  const cashOnHand = 0
  const weeklyBurn = burn / 4.33
  const runwayWeeks = weeklyBurn > 0 ? cashOnHand / weeklyBurn : 0

  return {
    cashOnHand,
    arTotal: ar.total,
    arAging: ar.aging,
    monthlyBurnRate: burn,
    runwayWeeks,
    biggestDebtor: ar.biggest,
    biggestDebtorAmount: ar.biggestAmt,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Write a decision flag event to localStorage for audit retrieval.
 * Called by DecisionFlagOverlay after the user acts on a flag.
 *
 * Stored as JSON array under 'poweron_decision_audit'.
 */
export interface DecisionAuditEntry {
  id: string
  timestamp: string
  action: DecisionActionType
  jobLabel?: string
  flags: Array<{ ruleId: string; severity: FlagSeverity; title: string }>
  proceeded: boolean
  acknowledgedReds: boolean
}

export function logDecisionAudit(entry: DecisionAuditEntry): void {
  try {
    const KEY = 'poweron_decision_audit'
    const existing: DecisionAuditEntry[] = JSON.parse(localStorage.getItem(KEY) || '[]')
    existing.unshift(entry)
    // Keep last 500 entries
    if (existing.length > 500) existing.length = 500
    localStorage.setItem(KEY, JSON.stringify(existing))
  } catch (err) {
    console.warn('[BadDecisionDetector] Audit log write failed:', err)
  }
}

export function getDecisionAuditLog(): DecisionAuditEntry[] {
  try {
    return JSON.parse(localStorage.getItem('poweron_decision_audit') || '[]')
  } catch {
    return []
  }
}
