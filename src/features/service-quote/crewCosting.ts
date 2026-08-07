/**
 * crewCosting.ts — SERVICE-COST-3B crew-aware Service Call cost math.
 *
 * Pure module: no I/O, no React, no Supabase.
 *
 * Concepts deliberately separated:
 *   Assigned Team      — people responsible / portal-visible.
 *   Costed Field Crew  — assigned employees whose Team laborCategory is 'field'.
 *   Pricing Crew       — explicit quoting assumption when no field crew is assigned.
 *
 * All monetary outputs are rounded to cents (round2).
 */

import { round2, num } from './serviceQuoteMath'
import { normalizeEmployee, type LaborCategory } from '@/components/v15r/employeeTypes'
import { getLoadedHourlyRate } from '@/components/v15r/employeeCostUtils'
import { assignmentKey, OWNER_ASSIGNEE_ID, type AssignedEmployee } from './serviceAssignments'

export type CrewSource = 'assigned' | 'pricing'

export interface CrewMemberInput {
  costModelEmployeeId: string
  displayName: string
  laborCategory: 'field'
  loadedLaborRate: number
  billRate: number
  laborHours: number
}

export interface CrewCostSnapshot {
  version: 1
  calculatedAt: string
  crewSource: CrewSource
  siteHours: number
  crewLaborHours: number
  overheadRecoveryRate: number
  mileRate: number
  taxRatePct: number
  crew: CrewMemberInput[]
  directLaborCost: number
  billableLabor: number
  overheadRecovery: number
  mileageCost: number
  materialCost: number
  salesTax: number
  totalInternalCost: number
  suggestedQuote: number
  suggestedProfit: number
}

export interface ComputeCrewQuoteArgs {
  siteHours: number
  crew: CrewMemberInput[]
  materialCost: number
  miles: number
  mileRate: number
  taxRatePct: number
  overheadRecoveryRate: number
  totalQuoted: number
  crewSource?: CrewSource
}

export interface CrewQuoteBreakdown extends Omit<CrewCostSnapshot, 'version' | 'calculatedAt' | 'crewSource'> {
  crewSource: CrewSource
  /** Owner's current Total Quoted used to derive profit and variance. */
  totalQuoted: number
  actualEstimatedProfit: number
  quoteVariance: number
}

/**
 * Compute a crew-aware cost/quote breakdown.
 *
 * Each crew member provides their own laborHours so future per-employee
 * duration overrides are possible. For the common equal-duration case,
 * pass laborHours = siteHours for every costed field worker.
 */
export function computeCrewQuote(args: ComputeCrewQuoteArgs): CrewQuoteBreakdown {
  const siteHours = num(args.siteHours)
  const crew = Array.isArray(args.crew) ? args.crew : []
  const materialCost = round2(num(args.materialCost))
  const miles = num(args.miles)
  const mileRate = num(args.mileRate)
  const taxRatePct = num(args.taxRatePct)
  const overheadRecoveryRate = num(args.overheadRecoveryRate)
  const totalQuoted = round2(num(args.totalQuoted))
  const crewSource: CrewSource = args.crewSource ?? 'assigned'

  let directLaborCost = 0
  let billableLabor = 0
  let crewLaborHours = 0

  for (const member of crew) {
    const laborHours = num(member.laborHours)
    const loadedLaborRate = num(member.loadedLaborRate)
    const billRate = num(member.billRate)

    directLaborCost += laborHours * loadedLaborRate
    billableLabor += laborHours * billRate
    crewLaborHours += laborHours
  }

  directLaborCost = round2(directLaborCost)
  billableLabor = round2(billableLabor)

  const mileageCost = round2(miles * mileRate)
  const salesTax = round2((materialCost + mileageCost) * (taxRatePct / 100))
  const overheadRecovery = round2(crewLaborHours * overheadRecoveryRate)

  const totalInternalCost = round2(
    directLaborCost + overheadRecovery + materialCost + mileageCost + salesTax,
  )
  const suggestedQuote = round2(billableLabor + materialCost + mileageCost + salesTax)
  const suggestedProfit = round2(suggestedQuote - totalInternalCost)
  const actualEstimatedProfit = round2(totalQuoted - totalInternalCost)
  const quoteVariance = round2(totalQuoted - suggestedQuote)

  return {
    crewSource,
    siteHours,
    crewLaborHours,
    overheadRecoveryRate,
    mileRate,
    taxRatePct,
    crew,
    directLaborCost,
    billableLabor,
    overheadRecovery,
    mileageCost,
    materialCost,
    salesTax,
    totalInternalCost,
    suggestedQuote,
    suggestedProfit,
    actualEstimatedProfit,
    quoteVariance,
    totalQuoted,
  }
}

/** Convenience: return a new CrewCostSnapshot from a breakdown. */
function snapshotFromBreakdown(
  breakdown: CrewQuoteBreakdown,
  calculatedAt = new Date().toISOString(),
): CrewCostSnapshot {
  const { totalQuoted: _ignored, actualEstimatedProfit: _ignored2, quoteVariance: _ignored3, ...snapshot } = breakdown
  return {
    ...snapshot,
    version: 1,
    calculatedAt,
  }
}

/**
 * Build the owner-only costSnapshot from a computed breakdown.
 *
 * totalQuoted is intentionally excluded: it remains the canonical Service Call
 * quoted/totalQuoted field and is not duplicated inside the snapshot.
 */
export function buildCostSnapshot(
  breakdown: CrewQuoteBreakdown,
  calculatedAt = new Date().toISOString(),
): CrewCostSnapshot {
  return snapshotFromBreakdown(breakdown, calculatedAt)
}

/**
 * SERVICE-COST-3B: reconstruct the ServiceQuoteBreakdown shape from a frozen
 * costSnapshot without resolving current Team rates.
 *
 * All cost buckets come from the snapshot. currentTotalQuoted is read from the
 * canonical Service Call quoted/totalQuoted field and only affects derived
 * display values (profit, variance, margin).
 */
export function quoteFromCostSnapshot(
  snapshot: CrewCostSnapshot,
  currentTotalQuoted: number,
): import('@/features/service-quote/serviceQuoteMath').ServiceQuoteBreakdown {
  const totalQuoted = round2(num(currentTotalQuoted))
  const quoteVariance = round2(totalQuoted - snapshot.suggestedQuote)
  const actualEstimatedProfit = round2(totalQuoted - snapshot.totalInternalCost)
  const actualProfitMargin = totalQuoted > 0 ? actualEstimatedProfit / totalQuoted : 0

  return {
    laborBillable: snapshot.billableLabor,
    materialCost: snapshot.materialCost,
    mileage: snapshot.mileageCost,
    tax: snapshot.salesTax,
    operatingCost: round2(snapshot.directLaborCost + snapshot.overheadRecovery),
    internalCost: snapshot.totalInternalCost,
    suggestedQuote: snapshot.suggestedQuote,
    suggestedProfit: snapshot.suggestedProfit,
    totalQuoted,
    quoteVariance,
    actualEstimatedProfit,
    actualProfitMargin,
  }
}

/**
 * Resolve whether an employee can be treated as a costed field worker.
 *
 * Returns null if the employee is unclassified, office-only, or missing
 * valid rates. Never silently returns a $0 rate.
 */
export function resolveCostedFieldWorker(
  employeeId: string,
  displayName: string,
  laborCategory: string | null | undefined,
  loadedLaborRate: unknown,
  billRate: unknown,
  siteHours: number,
): CrewMemberInput | null {
  if (laborCategory !== 'field') return null
  const lr = num(loadedLaborRate)
  const br = num(billRate)
  if (lr <= 0 || br <= 0 || !Number.isFinite(siteHours) || siteHours <= 0) return null

  return {
    costModelEmployeeId: employeeId,
    displayName: displayName || 'Unnamed',
    laborCategory: 'field',
    loadedLaborRate: lr,
    billRate: br,
    laborHours: siteHours,
  }
}

export interface CostModelEmployee {
  id: string
  name?: string
  role?: string
  billRate?: number
  costRate?: number
  hourly_rate?: number
  laborCategory?: LaborCategory | null
  isOwner?: boolean
  status?: string
  [key: string]: unknown
}

export interface CostedCrewResolution {
  crew: CrewMemberInput[]
  errors: string[]
  missingClassificationIds: string[]
  missingRateIds: string[]
  officeOnlyIds: string[]
}

/**
 * Resolve the Costed Field Crew from either an Assigned Team or Pricing Crew IDs.
 *
 * Deduplicates by Cost Model employee id. Owner is included only when manually
 * selected and laborCategory is 'field'. Office employees are excluded.
 */
export function resolveCostedCrew(
  source: 'assigned' | 'pricing',
  siteHours: number,
  costModelEmployees: CostModelEmployee[],
  assignedEmployees?: AssignedEmployee[],
  pricingCrewIds?: string[],
): CostedCrewResolution {
  const result: CostedCrewResolution = {
    crew: [],
    errors: [],
    missingClassificationIds: [],
    missingRateIds: [],
    officeOnlyIds: [],
  }

  const normalizedEmployees = (costModelEmployees || []).map(normalizeEmployee)
  const byId = new Map(normalizedEmployees.map((e) => [e.id, e]))

  const seenKeys = new Set<string>()
  const candidateIds: string[] = []

  if (source === 'assigned' && Array.isArray(assignedEmployees)) {
    for (const a of assignedEmployees) {
      const key = assignmentKey(a)
      if (!key || seenKeys.has(key)) continue
      seenKeys.add(key)
      const id = a.employeeId || a.profileId
      if (!id) continue
      candidateIds.push(id)
    }
  } else if (source === 'pricing' && Array.isArray(pricingCrewIds)) {
    for (const id of pricingCrewIds) {
      if (!id || seenKeys.has(id)) continue
      seenKeys.add(id)
      candidateIds.push(id)
    }
  }

  // Map profile ids to linked cost model ids where possible.
  const profileToCostModel = new Map<string, string>()
  for (const e of normalizedEmployees) {
    // Note: backup_employee_id is not stored on normalized employee; callers that
    // need profile-to-cost-model mapping should pass costModelEmployees with the
    // linkage already resolved. This helper prefers direct costModel id matches.
  }

  const seenResolvedIds = new Set<string>()

  for (const candidateId of candidateIds) {
    // The Owner / Me picker option carries the __owner__ sentinel, not a Cost
    // Model roster id. Resolve it to the one canonical owner Team record so the
    // owner is costed from Team rates. The sentinel is never treated as a paid
    // worker on its own and never becomes a Cost Model employee.
    let emp = candidateId === OWNER_ASSIGNEE_ID
      ? normalizedEmployees.find((e) => e.isOwner)
      : byId.get(candidateId)
    if (!emp) {
      // Try to find by profile id linkage if the caller provided raw records with backup_employee_id.
      const linked = costModelEmployees.find(
        (raw) => raw.backup_employee_id === candidateId || raw.id === candidateId,
      )
      if (linked) {
        emp = normalizeEmployee(linked)
      }
    }

    if (!emp) {
      result.errors.push(`Employee ${candidateId} not found in Team roster.`)
      continue
    }

    // One real person = one costed worker. Guards against double-counting when
    // the same canonical Cost Model employee (e.g. the Owner) is reached through
    // both the __owner__ sentinel and a linked employee / profile identity.
    if (seenResolvedIds.has(emp.id)) continue
    seenResolvedIds.add(emp.id)

    if (emp.laborCategory === 'office') {
      result.officeOnlyIds.push(emp.id)
      continue
    }

    if (emp.laborCategory !== 'field') {
      result.missingClassificationIds.push(emp.id)
      continue
    }

    const loadedRate = getLoadedHourlyRate(emp, {})
    const billRate = num(emp.billRate)
    if (loadedRate <= 0 || billRate <= 0) {
      result.missingRateIds.push(emp.id)
      continue
    }

    result.crew.push({
      costModelEmployeeId: emp.id,
      displayName: emp.name || emp.role || 'Unnamed',
      laborCategory: 'field',
      loadedLaborRate: loadedRate,
      billRate,
      laborHours: siteHours,
    })
  }

  return result
}

/**
 * Validation result for a candidate crew.
 */
export interface CrewValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validate that a resolved crew is safe to cost.
 *
 * Blocks on:
 *   - empty crew
 *   - missing labor category
 *   - missing loaded labor rate
 *   - missing bill rate
 *   - zero/invalid overhead recovery rate
 *   - zero/invalid site hours
 */
export function validateCrewForCosting(
  crew: CrewMemberInput[],
  overheadRecoveryRate: number,
  siteHours: number,
  resolution?: CostedCrewResolution,
): CrewValidationResult {
  const errors: string[] = []

  // Propagate every unresolved-employee error first so portal-only or missing
  // identities are never silently omitted from a mixed crew.
  if (resolution?.errors.length) {
    errors.push(...resolution.errors)
  }

  if (!Number.isFinite(siteHours) || siteHours <= 0) {
    errors.push('Site Hours must be greater than 0.')
  }

  if (!Number.isFinite(overheadRecoveryRate) || overheadRecoveryRate <= 0) {
    errors.push(
      'Overhead recovery rate is not configured. Add overhead items and target recovery hours in Settings.',
    )
  }

  if (resolution?.missingClassificationIds.length) {
    errors.push(
      `${resolution.missingClassificationIds.length} selected employee(s) need a Labor Category set to Field in Team.`,
    )
  }

  if (resolution?.missingRateIds.length) {
    errors.push(
      `${resolution.missingRateIds.length} selected employee(s) are missing valid loaded or bill rates.`,
    )
  }

  if (crew.length === 0) {
    errors.push('Select a Costed Field Crew or a Pricing Crew before calculating.')
  }

  return { valid: errors.length === 0, errors }
}
