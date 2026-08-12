/**
 * serviceLegacyReconciliationQueue.ts — FORENSIC-KPI-2B2-2G: the owner-facing
 * discovery layer over the existing legacy-date resolver.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 2B2-2D resolver (resolveServiceLegacyPayments) lets the owner assign real
 * received dates to undated historical Service cash — money-invariant. But the
 * owner had no way to FIND which historical Service Calls still need dates without
 * opening each one manually. This module derives that work queue from the SAME
 * authority the resolver uses (getServiceLegacyUnknownCash), so queue membership
 * and the resolver can never disagree about what "undated" means.
 *
 * This is a READ-ONLY aggregation. It changes no money and writes nothing. The
 * panel renders its output; the existing resolver + scoped persistence do every
 * write. No financial reader is imported here — this phase fixes historical INPUT
 * completeness; the readers already consume the dates once supplied.
 *
 * Pure module: no I/O, no React, no clock.
 */
import {
  getServiceLegacyUnknownCash,
  resolveServiceCollected,
  MONEY_EPSILON,
  type ServicePaymentRowLike,
} from './servicePaymentLedger'
import { round2 } from './serviceQuoteMath'

export interface ServiceLegacyReconciliationEntry {
  /** Stable id of the service log row (log.serviceLogId || log.id). */
  id: string
  /** The original row, read-only. The panel renders customer / job type / date from it. */
  log: ServicePaymentRowLike
  /** Undated collected cash on this row, from getServiceLegacyUnknownCash. */
  unknownAmount: number
  /** True when a non-baseline live event has no received date (STOP / warning condition). */
  hasUnexpectedNullDateEvent: boolean
  /** Service / work date string for IDENTIFICATION + sort only — never payment authority. */
  serviceDate: string
}

export interface ServiceLegacyReconciliationQueue {
  /** Resolvable rows: unknown cash > epsilon and no unexpected null-date event. */
  unresolved: ServiceLegacyReconciliationEntry[]
  /** Blocked rows: a non-baseline live event has no date — must be edited directly. */
  warnings: ServiceLegacyReconciliationEntry[]
  unresolvedCount: number
  /** Sum of unknownAmount across the unresolved rows. */
  undatedTotal: number
  /** Active calls with collected cash and a dated ledger, no unknown cash. */
  resolvedCount: number
  /** Total dated live cash across the active set (collected − unknown per row). */
  datedCollected: number
}

function rowId(log: any): string {
  const id = log && typeof log === 'object' ? String(log.serviceLogId || log.id || '') : ''
  return id.trim()
}

/**
 * Derive the historical-payment reconciliation queue from a serviceLogs array.
 *
 * `isActive` defaults to "include everything"; the panel passes isActiveServiceCall
 * so deleted / archived / tombstoned rows are excluded exactly as every other
 * service reader excludes them.
 *
 * Sort: oldest service / work date first (this is a historical cleanup workflow).
 * Rows with a missing or unparseable service date sort to the end.
 */
export function buildServiceLegacyReconciliationQueue(
  serviceLogs: any[] | null | undefined,
  options?: { isActive?: (log: any) => boolean },
): ServiceLegacyReconciliationQueue {
  const isActive = options?.isActive
  const unresolved: ServiceLegacyReconciliationEntry[] = []
  const warnings: ServiceLegacyReconciliationEntry[] = []
  let undatedTotal = 0
  let datedCollected = 0
  let resolvedCount = 0

  const list = Array.isArray(serviceLogs) ? serviceLogs : []
  for (const log of list) {
    if (!log || typeof log !== 'object') continue
    if (isActive && !isActive(log)) continue

    const unknown = getServiceLegacyUnknownCash(log)
    const collected = resolveServiceCollected(log)
    const serviceDate = String((log as any).date || '')
    const entry: ServiceLegacyReconciliationEntry = {
      id: rowId(log),
      log,
      unknownAmount: unknown.amount,
      hasUnexpectedNullDateEvent: unknown.hasUnexpectedNullDateEvent,
      serviceDate,
    }

    // A non-baseline live event with no received date is a STOP / warning condition
    // the existing resolver refuses. Surface it as a warning (never in the normal
    // resolvable queue) and exclude it from the dated / undated totals — its cash
    // is ambiguous until the owner fixes that event's date directly.
    if (unknown.hasUnexpectedNullDateEvent) {
      warnings.push(entry)
      continue
    }

    // For every non-warning row, every live non-baseline event has a date, so the
    // only undated cash is the legacy baseline (in unknown.amount). Therefore
    // collected − unknown.amount is the EXACT dated live cash on the row.
    const dated = round2(collected - unknown.amount)
    datedCollected = round2(datedCollected + dated)

    if (unknown.amount > MONEY_EPSILON) {
      unresolved.push(entry)
      undatedTotal = round2(undatedTotal + unknown.amount)
    } else if (collected > MONEY_EPSILON && dated > MONEY_EPSILON) {
      // Active call with cash, nothing undated, and a dated ledger → already dated.
      resolvedCount++
    }
  }

  const sortByServiceDate = (
    a: ServiceLegacyReconciliationEntry,
    b: ServiceLegacyReconciliationEntry,
  ) => {
    const ad = a.serviceDate ? Date.parse(a.serviceDate) : NaN
    const bd = b.serviceDate ? Date.parse(b.serviceDate) : NaN
    const aOk = Number.isFinite(ad)
    const bOk = Number.isFinite(bd)
    if (aOk && bOk) return ad - bd
    if (aOk) return -1
    if (bOk) return 1
    return 0
  }
  unresolved.sort(sortByServiceDate)
  warnings.sort(sortByServiceDate)

  return {
    unresolved,
    warnings,
    unresolvedCount: unresolved.length,
    undatedTotal,
    resolvedCount,
    datedCollected,
  }
}