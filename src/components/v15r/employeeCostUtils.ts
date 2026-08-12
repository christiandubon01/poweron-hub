/**
 * employeeCostUtils.ts — Single source of truth for worker cost rules.
 *
 * Business rules (enforced here, nowhere else):
 *   Owner  → loadedHourly = baseHourly  (no payroll burden)
 *   1099   → loadedHourly = baseHourly  (no payroll burden)
 *   W-2    → loadedHourly = baseHourly × payrollMult
 *
 * Storage contract (set at save time, read here):
 *   hourly_rate  = true base wage
 *   costRate     = loadedHourly  (already multiplied for W-2; equals base for owner/1099)
 *   applyMultiplier = true only for W-2
 *
 * Stale-record recovery (records without hourly_rate):
 *   W-2 stale  → derive base = costRate / payrollMult
 *   Other stale → base = costRate
 */

const SAFE_FALLBACK_HOURLY = 0

/**
 * Internal labor cost rate — what labor costs the business per hour, for
 * generic / owner / company-operating-cost contexts that do not resolve a
 * specific Team employee's loaded rate.
 *
 * Authority: settings.opCost (internal operating cost rate). This is the same
 * authority buildProjectLogRollup uses for entryLaborCost (hrs × opCost).
 *
 * Customer bill rate (settings.billRate) is a SEPARATE revenue/quote authority
 * and must NEVER be used as the internal labor cost. Substituting billRate for
 * opCost inflates internal cost (e.g. 8h × $110 = $880 instead of 8h × $54 =
 * $432), so billRate is deliberately not read here and not used as a fallback.
 *
 * Returns 0 when opCost is unset (honest "no rate configured" — mirrors
 * buildProjectLogRollup, which emits no silent default). Callers that want a
 * non-zero display default may fall back at the call site, but must never fall
 * back to billRate.
 *
 * For a specific employee's internal cost, use getLoadedHourlyRate(emp, settings).
 */
export function internalLaborRate(settings?: any): number {
  return Number(settings?.opCost) || 0
}

export type WorkerType = 'owner' | 'w2' | '1099'

/** Determine the canonical worker type from stored fields.
 *
 * Owner detection wins over classification, applyMultiplier, and employee_type.
 * Sentinel check covers stale records saved without isOwner flag.
 */
export function resolveWorkerType(emp: any): WorkerType {
  if (emp?.isOwner === true) return 'owner'
  // Sentinel detection: id or name identifies this as the owner record.
  // Covers records created before isOwner was persisted.
  const id = String(emp?.id ?? '').toLowerCase().trim()
  const name = String(emp?.name ?? '').toLowerCase().trim()
  if (
    id === 'me' || id === 'owner' || id === 'owner-virtual' ||
    name === 'owner / me'
  ) return 'owner'
  if (emp?.classification === '1099') return '1099'
  if (emp?.classification === 'W-2') return 'w2'
  // No explicit classification — fall back on applyMultiplier / employee_type
  if (emp?.applyMultiplier === false) return '1099'
  if (emp?.employee_type === 'per_project') return '1099'
  return 'w2' // safe default
}

export function shouldApplyPayrollMultiplier(emp: any): boolean {
  return resolveWorkerType(emp) === 'w2'
}

/**
 * Return the true base hourly rate for any worker.
 *
 * Priority:
 * 1. hourly_rate (set by Add/Edit modals on new records)
 * 2. costRate — decoded by worker type:
 *    - W-2: stored costRate is loaded (base × mult), so derive base = costRate / mult
 *    - Owner/1099: stored costRate equals base, use directly
 * 3. settings.opCost fallback
 */
export function getBaseHourlyRate(emp: any, settings?: any): number {
  const payrollMult = Math.max(1, Number(settings?.payrollMult) || 1.20)
  const type = resolveWorkerType(emp)

  // Prefer the explicitly-stored base wage
  const raw = Number(emp?.hourly_rate)
  if (raw > 0) return raw

  // Stale record — decode from costRate
  const cr = Number(emp?.costRate)
  if (cr > 0) {
    if (type === 'w2') {
      // costRate was stored as loaded (base × payrollMult); back-derive base
      return cr / payrollMult
    }
    return cr // owner / 1099: costRate equals base
  }

  // Final fallback — settings opportunity cost
  const opCost = Number(settings?.opCost)
  if (opCost > 0) return opCost

  return SAFE_FALLBACK_HOURLY
}

/**
 * Return the loaded hourly rate (what labor actually costs the business per hour).
 *
 * Owner/1099 → equals base (no multiplier)
 * W-2        → base × payrollMult
 */
export function getLoadedHourlyRate(emp: any, settings?: any): number {
  const type = resolveWorkerType(emp)
  const base = getBaseHourlyRate(emp, settings)
  if (type !== 'w2') return base
  const payrollMult = Math.max(1, Number(settings?.payrollMult) || 1.20)
  return base * payrollMult
}

export interface WorkerCostProfile {
  workerType: WorkerType
  baseHourly: number
  loadedHourly: number
  payrollBurdenHourly: number
  applyMultiplier: boolean
  payrollMult: number
}

/**
 * Compute the full cost profile for an employee.
 * Used by EmployeeCard, calcMonthlyBreakdown, projectedMonthlyCost,
 * EmployeeEditModal, AddTeamMemberModal preview, getEmployeeCostRate.
 */
export function getWorkerCostProfile(emp: any, settings?: any): WorkerCostProfile {
  const payrollMult = Math.max(1, Number(settings?.payrollMult) || 1.20)
  const workerType = resolveWorkerType(emp)
  const baseHourly = getBaseHourlyRate(emp, settings)
  const loadedHourly = workerType === 'w2' ? baseHourly * payrollMult : baseHourly
  const payrollBurdenHourly = loadedHourly - baseHourly

  return {
    workerType,
    baseHourly,
    loadedHourly,
    payrollBurdenHourly,
    applyMultiplier: workerType === 'w2',
    payrollMult,
  }
}

/**
 * Monthly cost breakdown for an employee card.
 *
 * @param emp     - raw or normalized employee record
 * @param settings - backup.settings (for payrollMult, opCost)
 * @param hrsPerWeek - default 40
 * @param weeksPerMonth - default 4.33
 */
export interface MonthlyBreakdown {
  baseMonthly: number
  payrollBurdenMonthly: number
  loadedMonthly: number
  sixMonthCost: number
  targetRevenue: number   // revenue needed at settings.markup% to cover loaded cost
  baseHourly: number
  loadedHourly: number
  workerType: WorkerType
}

export function calcMonthlyBreakdown(
  emp: any,
  settings?: any,
  hrsPerWeek = 40,
  weeksPerMonth = 4.33,
): MonthlyBreakdown {
  const profile = getWorkerCostProfile(emp, settings)
  const hoursPerMonth = hrsPerWeek * weeksPerMonth
  const baseMonthly = profile.baseHourly * hoursPerMonth
  const payrollBurdenMonthly = profile.payrollBurdenHourly * hoursPerMonth
  const loadedMonthly = profile.loadedHourly * hoursPerMonth
  const sixMonthCost = loadedMonthly * 6
  const markupFraction = Math.max(0, Number(settings?.markup) || 35) / 100
  const targetRevenue = markupFraction > 0 ? loadedMonthly / markupFraction : 0

  return {
    baseMonthly,
    payrollBurdenMonthly,
    loadedMonthly,
    sixMonthCost,
    targetRevenue,
    baseHourly: profile.baseHourly,
    loadedHourly: profile.loadedHourly,
    workerType: profile.workerType,
  }
}

/** Helper text for the loaded-cost footnote on employee cards. */
export function workerTypeLabel(workerType: WorkerType, payrollMult: number): string {
  if (workerType === 'owner') return 'Owner cost — no W-2 payroll burden'
  if (workerType === '1099') return 'Contractor cost — no W-2 payroll burden'
  return `Loaded = base × ${payrollMult.toFixed(2)}x payroll multiplier`
}

/**
 * Build a corrected save payload for AddTeamMemberModal and EmployeeEditModal.
 *
 * Guarantees:
 * - hourly_rate = base (number)
 * - costRate = loaded (number, equals base for owner/1099)
 * - applyMultiplier = true only for W-2
 */
export function buildSavePayload(
  baseWage: number,
  billRate: number,
  workerType: WorkerType,
  settings?: any,
): { hourly_rate: number; costRate: number; billRate: number; applyMultiplier: boolean } {
  const payrollMult = Math.max(1, Number(settings?.payrollMult) || 1.20)
  const base = Math.max(0, baseWage)
  const loaded = workerType === 'w2' ? parseFloat((base * payrollMult).toFixed(2)) : parseFloat(base.toFixed(2))
  const bill = billRate > 0 ? billRate : loaded * 2
  return {
    hourly_rate: parseFloat(base.toFixed(2)),
    costRate: loaded,
    billRate: parseFloat(bill.toFixed(2)),
    applyMultiplier: workerType === 'w2',
  }
}
