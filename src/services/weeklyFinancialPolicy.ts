/**
 * Deterministic derived-view policy for BackupData.weeklyData.
 *
 * FORENSIC-KPI-2B2-2H: 52-week reporting is a PURE / AUTOMATIC DERIVED VIEW of
 * canonical dated cash. The owner never clicks "Recalculate from Data" to keep
 * the chart current — canonical financial records change and the 52-week view
 * reflects them on the next render.
 *
 * - EVERY non-manual weekly row is derived from canonical project/service inputs
 *   when read. Stored proj/svc/unbilled/pendingInv on a non-manual row are stale
 *   scaffolding; only `wk` + `start` (the week identity) are authoritative. Manual
 *   rows (manualOverride === true) are owner-owned and preserved exactly.
 * - accum is rebuilt deterministically in chronological (wk) order across the
 *   full derived+manual chain so there are no gaps or double-counts.
 * - Service cash FLOW is dated by payments[].receivedAt only (Part C). Legacy
 *   undated service cash is lifetime cash and lands in NO weekly bucket.
 * - Synthetic Project paid-scalar backfill (`log-paidbackfill-…`) and undated /
 *   manualPaidAdjustment Project cash carry no precise receipt date, so they land
 *   in NO weekly bucket (Part D). They remain legitimate lifetime cash elsewhere.
 * - No input object or array is mutated. Derivation is deterministic + idempotent.
 *
 * recalculateWeeklyData / deriveRow remain as the explicit-refresh policy used by
 * tests and the sync layer; the owner-facing manual refresh UI has been retired.
 *
 * Pure module: no React, storage, Supabase, clocks (unless supplied), or writes.
 */
import {
  isActiveProject,
  isCashHistoryProject,
  num,
  type BackupData,
  type BackupWeeklyData,
} from './backupDataService'
import { isDeadProjectLog, logProjectId } from './projectScopeMerge'
import { isDeletedOrArchivedServiceLog } from './serviceScopeMerge'
import { getServiceCashForRange } from '@/features/service-quote/serviceCashDate'
import { isSyntheticPaidBackfillLog } from './collectedRevenueRange'

export interface WeeklyFinancialValues {
  proj: number
  svc: number
  unbilled: number
  pendingInv: number
}

export interface CanonicalDayRange {
  dayKey: string
  start: Date
  endExclusive: Date
}

function validDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime())
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function localDayKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function utcDateAtMidnight(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`)
}

function projectStatus(project: any): string {
  return String(project?.status || project?.projectStatus || '').trim().toLowerCase()
}

/**
 * Project payment logs remain their own canonical records.
 *
 * FORENSIC-KPI-2A: this list feeds period COLLECTED CASH only (`proj` below).
 * Collected cash is a dated flow, not a lifecycle state — archiving or cancelling
 * a job in August does not remove a payment received in March. Parent eligibility
 * is therefore a deletion-only test (isCashHistoryProject), not the active-work
 * predicate. Per-log tombstones still win: isDeadProjectLog is checked first, so a
 * deleted/void payment stays financially dead. Legacy/unlinked logs remain readable
 * so this policy does not silently discard old imports.
 *
 * `unbilled` and `pendingInv` below keep their own active-lifecycle lists.
 */
function canonicalProjectLogs(backup: BackupData): any[] {
  const projects = Array.isArray(backup.projects) ? backup.projects : []
  const projectById = new Map<string, any>()
  for (const project of projects) {
    const id = String(project?.id || '').trim()
    if (id) projectById.set(id, project)
  }

  return (Array.isArray(backup.logs) ? backup.logs : []).filter(log => {
    if (isDeadProjectLog(log)) return false
    const projectId = logProjectId(log)
    if (!projectId) return true
    const project = projectById.get(projectId)
    return !project || isCashHistoryProject(project)
  })
}

function canonicalServiceLogs(backup: BackupData): any[] {
  return (Array.isArray(backup.serviceLogs) ? backup.serviceLogs : [])
    .filter(log => !isDeletedOrArchivedServiceLog(log))
}

/** Calculate one week from canonical inputs. End is exclusive. */
export function calculateWeeklyFinancialsForRange(
  backup: BackupData,
  start: Date,
  end: Date,
): WeeklyFinancialValues {
  const weekStart = validDate(start)
  const weekEnd = validDate(end)
  if (!weekStart || !weekEnd || weekEnd <= weekStart) {
    return { proj: 0, svc: 0, unbilled: 0, pendingInv: 0 }
  }

  const projectLogs = canonicalProjectLogs(backup)
  const serviceLogs = canonicalServiceLogs(backup)
  const activeProjects = (Array.isArray(backup.projects) ? backup.projects : [])
    .filter(project => isActiveProject(project))
    .filter(project => ['active', 'in_progress'].includes(projectStatus(project)))

  // FORENSIC-KPI-2B2-2H (Part D): Project cash provenance consistency.
  // The weekly proj bucket is PRECISE dated cash only. Synthetic paid-scalar
  // backfill (`log-paidbackfill-…`) carries a lastCollectedAt-derived date for an
  // aggregate historical gap — that date is NOT cash-receipt authority for the full
  // amount, so it is excluded from the weekly bucket (lifetime cash keeps it
  // elsewhere via collectedRevenueRange). Undated logs are also excluded (no date →
  // no precise week). Genuine owner-entered dated Payment logs fall in their week.
  // Reuses the SAME provenance predicate as collectedRevenueRange — no new heuristic.
  const proj = projectLogs.reduce((sum, log) => {
    if (isSyntheticPaidBackfillLog(log)) return sum
    const date = validDate(log?.date || log?.logDate)
    if (!date || date < weekStart || date >= weekEnd) return sum
    return sum + num(log?.paymentsCollected || log?.collected || 0)
  }, 0)

  // FORENSIC-KPI-2B2-1: Service cash FLOW is dated by payments[].receivedAt.
  // The service/work date is intentionally NOT used as a fake payment date.
  // Unknown-date legacy cash remains lifetime cash and is excluded from period sums.
  const { knownDatedCash: svc } = getServiceCashForRange(serviceLogs, weekStart, weekEnd)

  const unbilled = activeProjects.reduce(
    (sum, project) => sum + Math.max(0, num(project?.contract) - num(project?.billed)),
    0,
  )

  const pendingInv = serviceLogs
    .filter(log => num(log?.collected) === 0 && num(log?.quoted) > 0)
    .reduce((sum, log) => sum + num(log?.quoted), 0)

  return { proj, svc, unbilled, pendingInv }
}

export function resolveCanonicalLocalDayRange(day = new Date()): CanonicalDayRange {
  const localStart = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const localEnd = new Date(localStart)
  localEnd.setDate(localEnd.getDate() + 1)
  const dayKey = localDayKey(localStart)
  return {
    dayKey,
    start: utcDateAtMidnight(dayKey),
    endExclusive: utcDateAtMidnight(localDayKey(localEnd)),
  }
}

export function calculateDailyFinancialsForDate(
  backup: BackupData,
  day = new Date(),
): WeeklyFinancialValues & { dayKey: string } {
  const range = resolveCanonicalLocalDayRange(day)
  return {
    ...calculateWeeklyFinancialsForRange(backup, range.start, range.endExclusive),
    dayKey: range.dayKey,
  }
}

export function isCurrentWeeklyRow(row: Partial<BackupWeeklyData>, now: Date): boolean {
  const start = validDate(row?.start)
  const current = validDate(now)
  if (!start || !current) return false
  const end = new Date(start.getTime() + 7 * 86_400_000)
  return start <= current && current < end
}

function deriveRow(
  backup: BackupData,
  row: BackupWeeklyData,
  accum: number,
  timestamp?: string,
): BackupWeeklyData {
  const start = validDate(row?.start)
  if (!start) return { ...row }
  const end = new Date(start.getTime() + 7 * 86_400_000)
  const values = calculateWeeklyFinancialsForRange(backup, start, end)
  // Preserve the existing explicit-recalculation rule: future service weeks do
  // not recognize collections early. Current readers never reach this branch.
  const recalculatedAt = timestamp ? validDate(timestamp) : null
  if (recalculatedAt && start > recalculatedAt) values.svc = 0
  const next: BackupWeeklyData = {
    ...row,
    ...values,
    accum: accum + values.proj + values.svc,
  }
  if (timestamp) {
    next.derivedAt = timestamp
    next.weeklyUpdatedAt = timestamp
  }
  return next
}

/**
 * Reader policy (FORENSIC-KPI-2B2-2H): the 52-week view is an automatic derived view
 * of canonical dated cash. EVERY non-manual row is re-derived from current canonical
 * project/service truth on read — there is no "current row only" special case and no
 * stale historical snapshot. Manual override rows are owner-owned and preserved
 * verbatim (their proj/svc fold into the running accum so later weeks stay
 * cumulative-correct). accum is rebuilt deterministically in chronological (wk)
 * order across the full chain. No persistence, no save, no reload, no remote sync.
 *
 * Pure: maps over a fresh array, spreads into new row objects, never mutates backup.
 */
export function resolveWeeklyDataForRead(backup: BackupData, now = new Date()): BackupWeeklyData[] {
  const rows = Array.isArray(backup.weeklyData) ? backup.weeklyData : []
  const nowMs = validDate(now)?.getTime() ?? null
  let accum = 0
  return rows.map(row => {
    // Manual override: owner values authoritative for this week. Preserve the row
    // exactly, but advance the running accum by the manual contribution so the
    // chain stays cumulative-correct for subsequent derived weeks.
    if (row?.manualOverride === true) {
      accum += num(row?.proj) + num(row?.svc)
      return { ...row }
    }
    const start = validDate(row?.start)
    // No week identity → cannot derive; keep stored scaffolding, keep the chain
    // moving via the stored accum (defensive; well-formed weeklyData always has start).
    if (!start) {
      accum = num(row?.accum) || accum
      return { ...row }
    }
    const end = new Date(start.getTime() + 7 * 86_400_000)
    const values = calculateWeeklyFinancialsForRange(backup, start, end)
    // Preserve the established future-service exclusion: a week whose start is after
    // `now` does not pre-recognize service collections. Project cash is already gated
    // by the log date falling inside the week, so only svc needs this guard.
    if (nowMs !== null && start.getTime() > nowMs) values.svc = 0
    const next: BackupWeeklyData = {
      ...row,
      ...values,
      accum: accum + values.proj + values.svc,
    }
    accum = num(next.accum)
    return next
  })
}

/** Explicit user-requested refresh of every derived row; manual rows are durable. */
export function recalculateWeeklyData(backup: BackupData, timestamp: string): BackupWeeklyData[] {
  const rows = Array.isArray(backup.weeklyData) ? backup.weeklyData : []
  let accum = 0
  return rows.map(row => {
    if (row?.manualOverride === true) {
      accum += num(row?.proj) + num(row?.svc)
      return { ...row }
    }
    const next = deriveRow(backup, row, accum, timestamp)
    accum = num(next?.accum)
    return next
  })
}
