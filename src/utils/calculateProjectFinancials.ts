/**
 * calculateProjectFinancials.ts
 *
 * SINGLE SOURCE OF TRUTH for project balance and cost calculations.
 *
 * BUG 3 FIX (locked by owner):
 *   Remaining Balance = Quote - Total Costs  (NOT Quote - Collections)
 *   Collections are tracked SEPARATELY as total_collected.
 *
 * Formula:
 *   total_costs           = labor_cost + material_cost + transportation_cost
 *   labor_cost            = hours × $43/hr  (internal rate, locked by owner)
 *   material_cost         = sum of mat entries in field logs
 *   transportation_cost   = miles × rate ($0.66 van default, $1.04 truck)
 *   remaining_balance     = quote_value − total_costs
 *   total_collected       = sum of collected entries in field logs (separate bucket)
 *
 * USAGE: Every component that displays project financial data MUST call this
 * function. No inline recalculations permitted.
 */

// ── Internal rates (locked by owner — do not change without explicit instruction) ─
export const INTERNAL_LABOR_RATE = 43     // $43/hr internal rate
export const VAN_MILE_RATE = 0.66         // $0.66/mile for van
export const TRUCK_MILE_RATE = 1.04       // $1.04/mile for truck

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal log shape required — intentionally loose to avoid import cycles. */
export interface CalcLog {
  id?: string
  projId?: string
  hrs?: number | string | null
  mat?: number | string | null
  miles?: number | string | null
  collected?: number | string | null
}

/** Minimal project shape required. */
export interface CalcProject {
  id?: string
  contract?: number | string | null
  /** Optional vehicle type override per-project. Defaults to 'van'. */
  vehicleType?: 'van' | 'truck'
}

/** Return shape — everything every component needs side-by-side. */
export interface ProjectFinancials {
  /** Contract / quote value */
  quote: number
  /** Labor cost = total hours × $43/hr */
  labor_cost: number
  /** Material cost = sum of mat from field logs */
  material_cost: number
  /** Transportation cost = sum of miles × rate */
  transportation_cost: number
  /** Total costs = labor + material + transportation */
  total_costs: number
  /** Remaining balance = quote − total_costs (LOCKED formula, never quote − collected) */
  remaining_balance: number
  /** Total collected — tracked SEPARATELY from balance calculation */
  total_collected: number
  /** Total hours logged */
  total_hours: number
  /** Total miles logged */
  total_miles: number
  /** Mile rate used for this calculation */
  mile_rate: number
}

// ── Safe number helper ────────────────────────────────────────────────────────

function n(v: unknown): number {
  const x = Number(v)
  return isNaN(x) ? 0 : x
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * calculateProjectFinancials — canonical project cost and balance function.
 *
 * @param project   Project record (needs id and contract)
 * @param allLogs   ALL field logs from backup — function filters to this project
 * @param mileRate  Optional override rate (e.g. from settings.mileRate).
 *                  Defaults to VAN_MILE_RATE ($0.66).
 *
 * @returns ProjectFinancials — ALL financial fields, side by side.
 *
 * Example:
 *   const fin = calculateProjectFinancials(project, backup.logs, settings.mileRate)
 *   // display fin.remaining_balance and fin.total_collected side-by-side
 */
export function calculateProjectFinancials(
  project: CalcProject,
  allLogs: CalcLog[],
  mileRate?: number,
  laborRate?: number
): ProjectFinancials {
  const quote = n(project?.contract)

  // Determine mile rate: explicit arg → project vehicleType → default van rate
  const rate =
    mileRate != null && !isNaN(mileRate) && mileRate > 0
      ? mileRate
      : project?.vehicleType === 'truck'
        ? TRUCK_MILE_RATE
        : VAN_MILE_RATE

  // Filter to this project's logs
  const logs = (allLogs || []).filter(l => l.projId === project?.id)

  let total_hours = 0
  let total_miles = 0
  let labor_cost = 0
  let material_cost = 0
  let transportation_cost = 0
  let total_collected = 0

  for (const l of logs) {
    const hrs = n(l.hrs)
    const mat = n(l.mat)
    const miles = n(l.miles)
    const coll = n(l.collected)

    total_hours += hrs
    total_miles += miles
    labor_cost += hrs * (laborRate != null && !isNaN(laborRate) && laborRate > 0 ? laborRate : 0)
    material_cost += mat
    transportation_cost += miles * rate
    total_collected += coll
  }

  const total_costs = labor_cost + material_cost + transportation_cost

  // LOCKED formula: remaining = quote - total_costs  (NOT quote - collected)
  const remaining_balance = Math.max(0, quote - total_costs)

  return {
    quote,
    labor_cost,
    material_cost,
    transportation_cost,
    total_costs,
    remaining_balance,
    total_collected,
    total_hours,
    total_miles,
    mile_rate: rate,
  }
}

// ── Portfolio helper ──────────────────────────────────────────────────────────

/**
 * calculatePortfolioFinancials — sums calculateProjectFinancials across
 * a list of projects. Used by Money panel and Dashboard for aggregate views.
 */
export function calculatePortfolioFinancials(
  projects: CalcProject[],
  allLogs: CalcLog[],
  mileRate?: number,
  laborRate?: number
): ProjectFinancials {
  const zero: ProjectFinancials = {
    quote: 0,
    labor_cost: 0,
    material_cost: 0,
    transportation_cost: 0,
    total_costs: 0,
    remaining_balance: 0,
    total_collected: 0,
    total_hours: 0,
    total_miles: 0,
    mile_rate: mileRate ?? VAN_MILE_RATE,
  }

  return projects.reduce((acc, p) => {
    const fin = calculateProjectFinancials(p, allLogs, mileRate, laborRate)
    return {
      quote: acc.quote + fin.quote,
      labor_cost: acc.labor_cost + fin.labor_cost,
      material_cost: acc.material_cost + fin.material_cost,
      transportation_cost: acc.transportation_cost + fin.transportation_cost,
      total_costs: acc.total_costs + fin.total_costs,
      remaining_balance: acc.remaining_balance + fin.remaining_balance,
      total_collected: acc.total_collected + fin.total_collected,
      total_hours: acc.total_hours + fin.total_hours,
      total_miles: acc.total_miles + fin.total_miles,
      mile_rate: fin.mile_rate,
    }
  }, zero)
}
