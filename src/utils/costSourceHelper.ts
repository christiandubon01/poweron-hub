/**
 * costSourceHelper.ts — COST-SOURCE-2A canonical cost-source helper.
 *
 * Three separated concepts that must never be conflated:
 *
 *   overheadRecoveryRate   — company overhead ÷ target billable labor-hours.
 *                            Source: Settings → Overhead Manager.
 *                            (annualOverhead / targetRecoveryLaborHours)
 *
 *   ownerLoadedLaborCost   — the owner's true labor cost per hour.
 *                            Source: Team → Owner / Me employee record.
 *                            Owner is exempt from W-2 payroll multiplier.
 *
 *   legacyStoredServiceCost — settings.opCost stored value.
 *                            Used temporarily by existing Service Log records.
 *                            Must not be automatically rewritten.
 *
 *   informationalSoloOwnerCost — ownerLoadedLaborCost + overheadRecoveryRate.
 *                            Informational only. Describes what a solo-owner
 *                            hour truly costs the business when overhead is
 *                            recovered per labor-hour. Not written anywhere.
 *
 * Pure module — no I/O, no React, no Supabase.
 */

import { resolveWorkerType } from '@/components/v15r/employeeCostUtils'

// ── Overhead Metrics ─────────────────────────────────────────────────────────

export interface OverheadMetrics {
  /** Sum of all monthly overhead entries across all four buckets. */
  monthlyOverhead: number
  /** monthlyOverhead × 12 */
  annualOverhead: number
  /** The company's target billable labor-hours per year (settings.billableHrsYear). */
  targetRecoveryLaborHours: number
  /** annualOverhead / targetRecoveryLaborHours. Zero when hours input is invalid. */
  overheadRecoveryRate: number
}

/**
 * Derive overhead totals and the per-labor-hour recovery rate.
 *
 * @param overhead  settings.overhead — { essential[], extra[], loans[], vehicle[] }
 * @param billableHrsYear  settings.billableHrsYear (must be > 0 for a valid rate)
 */
export function calculateOverheadMetrics(
  overhead: Record<string, Array<{ monthly?: number }>> | null | undefined,
  billableHrsYear: number,
): OverheadMetrics {
  let monthlyOverhead = 0
  if (overhead && typeof overhead === 'object') {
    for (const section of Object.values(overhead)) {
      if (Array.isArray(section)) {
        for (const item of section) {
          const v = Number(item?.monthly)
          if (Number.isFinite(v) && v > 0) monthlyOverhead += v
        }
      }
    }
  }

  const annualOverhead = monthlyOverhead * 12
  const targetRecoveryLaborHours = Number.isFinite(billableHrsYear) && billableHrsYear > 0
    ? billableHrsYear
    : 0
  const overheadRecoveryRate = targetRecoveryLaborHours > 0
    ? annualOverhead / targetRecoveryLaborHours
    : 0

  return { monthlyOverhead, annualOverhead, targetRecoveryLaborHours, overheadRecoveryRate }
}

// ── Owner Loaded Labor Cost ──────────────────────────────────────────────────

/**
 * Resolve the owner's loaded labor cost from the Team employee roster.
 *
 * Searches employees[] for the canonical Owner / Me record using the same
 * sentinel logic as resolveWorkerType. Returns 0 when no owner record is found.
 * Never reads settings.opCost.
 */
export function resolveOwnerLoadedLaborCost(
  employees: Array<Record<string, unknown>> | null | undefined,
  settings: Record<string, unknown> | null | undefined,
): number {
  if (!Array.isArray(employees)) return 0

  let ownerRecord: Record<string, unknown> | null = null
  for (const emp of employees) {
    const type = resolveWorkerType(emp)
    if (type === 'owner') {
      ownerRecord = emp
      break
    }
  }

  if (!ownerRecord) return 0
  const baseRate = Number(ownerRecord.hourly_rate)
  return Number.isFinite(baseRate) && baseRate > 0 ? baseRate : 0
}

// ── Full Cost-Source Summary ─────────────────────────────────────────────────

export interface CostSourceSummary {
  monthlyOverhead: number
  annualOverhead: number
  targetRecoveryLaborHours: number
  /** Company overhead recovery per labor-hour (Overhead Manager). */
  overheadRecoveryRate: number
  /** Owner's loaded labor cost from Team (does not include overhead). */
  ownerLoadedLaborCost: number
  /** settings.opCost — temporary legacy value used by Service Log formula. */
  legacyStoredServiceCost: number
  /**
   * ownerLoadedLaborCost + overheadRecoveryRate.
   * Informational only — shows what a solo-owner hour fully costs the business.
   * Must never be written back to settings.opCost automatically.
   */
  informationalSoloOwnerCost: number
}

/**
 * Build the full cost-source summary from settings and the employee roster.
 *
 * Used by Settings → Connected Cost Sources and Team → Labor Burden info.
 */
export function buildCostSourceSummary(
  settings: Record<string, unknown> | null | undefined,
  employees: Array<Record<string, unknown>> | null | undefined,
): CostSourceSummary {
  const s = settings ?? {}
  const overhead = (s.overhead ?? {}) as Record<string, Array<{ monthly?: number }>>
  const billableHrsYear = Number(s.billableHrsYear) > 0 ? Number(s.billableHrsYear) : 0

  const { monthlyOverhead, annualOverhead, targetRecoveryLaborHours, overheadRecoveryRate } =
    calculateOverheadMetrics(overhead, billableHrsYear)

  const ownerLoadedLaborCost = resolveOwnerLoadedLaborCost(employees, s)
  const legacyStoredServiceCost = Number.isFinite(Number(s.opCost)) ? Number(s.opCost) : 0
  const informationalSoloOwnerCost = ownerLoadedLaborCost + overheadRecoveryRate

  return {
    monthlyOverhead,
    annualOverhead,
    targetRecoveryLaborHours,
    overheadRecoveryRate,
    ownerLoadedLaborCost,
    legacyStoredServiceCost,
    informationalSoloOwnerCost,
  }
}

export interface ProjectLaborSource {
  loadedLaborRate: number
  overheadRecoveryRate: number
  internalLaborRate: number
  employee: Record<string, unknown> | null
}

function resolveExplicitLoadedLaborRate(
  employee: Record<string, unknown> | null,
  settings: Record<string, unknown> | null | undefined,
): number {
  if (!employee) return 0
  const type = resolveWorkerType(employee)
  const hourlyRate = Number(employee.hourly_rate)
  const payrollMult = Math.max(1, Number(settings?.payrollMult) || 1.20)
  if (Number.isFinite(hourlyRate) && hourlyRate > 0) {
    return type === 'w2' ? hourlyRate * payrollMult : hourlyRate
  }

  const storedCostRate = Number(employee.costRate)
  if (Number.isFinite(storedCostRate) && storedCostRate > 0) {
    if (type === 'w2') return storedCostRate
    return storedCostRate
  }

  return 0
}

function resolveOwnerRecord(
  employees: Array<Record<string, unknown>> | null | undefined,
): Record<string, unknown> | null {
  if (!Array.isArray(employees)) return null
  for (const emp of employees) {
    if (resolveWorkerType(emp) === 'owner') return emp
  }
  return null
}

function findEmployeeByName(
  employees: Array<Record<string, unknown>>,
  name: string,
): Record<string, unknown> | null {
  const target = name.trim().toLowerCase()
  if (!target) return null
  for (const emp of employees) {
    if (String(emp?.name ?? '').trim().toLowerCase() === target) return emp
  }
  return null
}

export function resolveProjectLaborEmployee(
  employeeId: string | null | undefined,
  employeeName: string | null | undefined,
  employees: Array<Record<string, unknown>> | null | undefined,
): Record<string, unknown> | null {
  if (!Array.isArray(employees) || employees.length === 0) return null

  const targetId = String(employeeId ?? '').trim()
  if (targetId) {
    const byId = employees.find((emp) => String(emp?.id ?? '').trim() === targetId)
    if (byId) return byId
  }

  const targetName = String(employeeName ?? '').trim()
  if (!targetId && (!targetName || /^me$/i.test(targetName) || /^owner\s*\/\s*me$/i.test(targetName))) {
    return resolveOwnerRecord(employees)
  }

  return findEmployeeByName(employees, targetName) ?? null
}

export function resolveProjectLaborSource(
  settings: Record<string, unknown> | null | undefined,
  employees: Array<Record<string, unknown>> | null | undefined,
  employeeId?: string | null,
  employeeName?: string | null,
): ProjectLaborSource {
  const employee = resolveProjectLaborEmployee(employeeId, employeeName, employees)
  const { overheadRecoveryRate } = buildCostSourceSummary(settings, employees)
  const loadedLaborRate = resolveExplicitLoadedLaborRate(employee, settings)
  const internalLaborRate =
    loadedLaborRate > 0 && overheadRecoveryRate > 0
      ? loadedLaborRate + overheadRecoveryRate
      : 0

  return {
    loadedLaborRate,
    overheadRecoveryRate,
    internalLaborRate,
    employee,
  }
}
