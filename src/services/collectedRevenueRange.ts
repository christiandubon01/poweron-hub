import { getServiceCashForRange, getServiceCashSummary } from '@/features/service-quote/serviceCashDate'
import { num, type BackupData, isCashHistoryProject } from './backupDataService'
import { isDeadProjectLog, logProjectId } from './projectScopeMerge'

export interface CollectedRevenueProvenance {
  /** Service collected cash whose payments have a known receivedAt in the range. */
  serviceKnownDatedCash: number
  /** Project collected cash whose logs have a known date in the range. */
  projectKnownDatedCash: number
  /** Service collected cash with no usable receivedAt (legacy baseline or missing payments). */
  serviceUnknownDateCash: number
  /** Project collected cash with no usable log date (e.g. manual adjustment, undated logs). */
  projectUnknownDateCash: number
  /** Total known-dated collected cash in the range (Service + Project). */
  knownTotal: number
  /** Total collected cash excluded from precise period buckets. */
  unknownDateTotal: number
  /** Full lifetime collected cash (Service + Project), matching Header Paid semantics. */
  lifetimeTotal: number
}

function parseLogDate(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * FORENSIC-KPI-2B2-2C: identify synthetic Project paid-scalar backfill logs.
 *
 * backupDataService one-time migration (see backupDataService.ts ~L844) creates a
 * `phase: 'Payment'` log to reconcile a legacy scalar `p.paid` that exceeded the sum
 * of genuine logged payments. Its `date` is `lastCollectedAt || saveTimestamp` and
 * its `collected` is the aggregate historical gap — which may represent multiple
 * collections across unknown dates. A genuine lastCollectedAt timestamp does NOT
 * prove the ENTIRE gap was received on that day, so it is NOT precise cash-date
 * authority for Annual YTD / exact range reporting.
 *
 * Discriminator (reliable, not a heuristic): the backfill writer is the ONLY writer
 * that emits both the `id` prefix `'log-paidbackfill-'` and the exact notes string
 * `'Backfilled from p.paid scalar (CFOT-COLLECTION-PATH-PARITY migration)'`. Genuine
 * owner-entered Payment logs (handleMarkFullPayment/handleLogPartialPayment) and
 * ordinary dated field logs use `id: 'log' + Date.now()` with different notes, so
 * they never match. The row itself is never modified — only its provenance class.
 */
const PAID_BACKFILL_NOTES = 'Backfilled from p.paid scalar (CFOT-COLLECTION-PATH-PARITY migration)'

/**
 * FORENSIC-KPI-2B2-2H (Part D): shared Project cash provenance predicate.
 *
 * Identifies the backupDataService one-time migration `phase: 'Payment'` log that
 * reconciles a legacy scalar `p.paid` exceeding the sum of genuine logged payments.
 * Its `date` is `lastCollectedAt || saveTimestamp` and its `collected` is the aggregate
 * historical gap — which may span multiple unknown collection dates, so it is NOT
 * precise cash-receipt authority for a single week / exact range bucket.
 *
 * Discriminator (reliable, not a heuristic): the backfill writer is the ONLY writer
 * that emits both the `id` prefix `'log-paidbackfill-'` and the exact notes string
 * above. Genuine owner-entered Payment logs use `id: 'log' + Date.now()` with
 * different notes, so they never match. The row itself is never modified — only its
 * provenance class.
 *
 * Exported so the 52-week derivation (weeklyFinancialPolicy) reuses the SAME
 * provenance semantics instead of a conflicting heuristic. Lifetime cash still
 * includes these rows (see projectLifetimeCash below); only precise period bucket
 * assignment excludes them.
 */
export function isSyntheticPaidBackfillLog(log: any): boolean {
  if (!log || typeof log !== 'object') return false
  const id = String(log.id || log.logId || '')
  if (id.startsWith('log-paidbackfill-')) return true
  return String(log.notes || '') === PAID_BACKFILL_NOTES
}

function projectLifetimeCash(backup: BackupData): number {
  const projects = Array.isArray(backup?.projects) ? backup.projects : []
  const projectById = new Map<string, any>()
  for (const project of projects) {
    const id = String(project?.id || '').trim()
    if (id) projectById.set(id, project)
  }

  let total = 0
  for (const project of projects) {
    if (!isCashHistoryProject(project)) continue
    const fin = project?.finance || {}
    total += num(fin.manualPaidAdjustment || 0)
  }

  const logs = Array.isArray(backup?.logs) ? (backup.logs as any[]) : []
  for (const log of logs) {
    if (isDeadProjectLog(log)) continue
    const projectId = logProjectId(log)
    if (projectId) {
      const project = projectById.get(projectId)
      if (project && !isCashHistoryProject(project)) continue
    }
    total += num(log?.paymentsCollected || log?.collected || 0)
  }

  return total
}

export function getCollectedRevenueForRange(
  backup: BackupData,
  startInclusive: Date,
  endExclusive: Date,
): CollectedRevenueProvenance {
  const serviceLogs = Array.isArray(backup?.serviceLogs) ? backup.serviceLogs : []
  const serviceResult = getServiceCashForRange(serviceLogs, startInclusive, endExclusive)

  const projects = Array.isArray(backup?.projects) ? backup.projects : []
  const projectById = new Map<string, any>()
  for (const project of projects) {
    const id = String(project?.id || '').trim()
    if (id) projectById.set(id, project)
  }

  let projectKnownDatedCash = 0
  let projectUnknownDateCash = 0

  for (const project of projects) {
    if (!isCashHistoryProject(project)) continue
    const fin = project?.finance || {}
    projectUnknownDateCash += num(fin.manualPaidAdjustment || 0)
  }

  const logs = Array.isArray(backup?.logs) ? (backup.logs as any[]) : []
  for (const log of logs) {
    if (isDeadProjectLog(log)) continue
    const projectId = logProjectId(log)
    if (projectId) {
      const project = projectById.get(projectId)
      if (project && !isCashHistoryProject(project)) continue
    }

    const amount = num(log?.paymentsCollected || log?.collected || 0)

    // Synthetic paid-scalar backfill carries a lastCollectedAt-derived date for an
    // aggregate historical gap. That date is NOT precise cash-receipt authority for
    // the full amount, so it is reported as unknown-date cash — not current-year
    // known cash — even when the row has a parseable date. Genuine owner-entered
    // Payment logs and ordinary dated field logs remain known-dated cash below.
    if (isSyntheticPaidBackfillLog(log)) {
      projectUnknownDateCash += amount
      continue
    }

    const logDate = parseLogDate(log?.date || log?.logDate)
    if (logDate && logDate >= startInclusive && logDate < endExclusive) {
      projectKnownDatedCash += amount
    } else if (!logDate) {
      projectUnknownDateCash += amount
    }
  }

  const knownTotal = serviceResult.knownDatedCash + projectKnownDatedCash
  const unknownDateTotal = serviceResult.unknownDateCash + projectUnknownDateCash
  const serviceLifetime = getServiceCashSummary(serviceLogs).lifetimeCash
  const lifetimeTotal = serviceLifetime + projectLifetimeCash(backup)

  return {
    serviceKnownDatedCash: serviceResult.knownDatedCash,
    projectKnownDatedCash,
    serviceUnknownDateCash: serviceResult.unknownDateCash,
    projectUnknownDateCash,
    knownTotal,
    unknownDateTotal,
    lifetimeTotal,
  }
}

/**
 * FORENSIC-MONEY-LIFETIME-1: canonical LIFETIME collected cash.
 *
 * Lifetime cash is range-independent — it is every legitimate dollar the business
 * has taken, whatever the record's current lifecycle state. A project or service
 * call that is later archived, marked lost, or cancelled leaves the ACTIVE lists
 * (so Pipeline / Exposure fall) but keeps the money it collected, so it stays in
 * this total. Only a genuine tombstone (deletedAt / status deleted) drops out.
 *
 * Delegates to the SAME single authority every ranged reader uses — this is a
 * naming wrapper, not a second formula. Callers that want lifetime semantics
 * should use this rather than reading `.lifetimeTotal` off a ranged result,
 * which reads as though the range mattered.
 */
export function getLifetimeCollectedRevenue(backup: BackupData): number {
  const start = new Date('1970-01-01T00:00:00.000Z')
  const end = new Date('2100-01-01T00:00:00.000Z')
  return getCollectedRevenueForRange(backup, start, end).lifetimeTotal
}

export function getCurrentYearCollectedRevenue(
  backup: BackupData,
  year = new Date().getFullYear(),
): CollectedRevenueProvenance {
  const start = new Date(`${year}-01-01T00:00:00.000Z`)
  const end = new Date(`${year + 1}-01-01T00:00:00.000Z`)
  return getCollectedRevenueForRange(backup, start, end)
}
