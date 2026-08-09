/**
 * Deterministic current/historical policy for BackupData.weeklyData.
 *
 * - Historical rows are saved snapshots and are returned unchanged by readers.
 * - A current non-manual row is resolved from canonical project/service inputs.
 * - manualOverride rows are user-owned snapshots and are never recalculated.
 * - Explicit recalculation may refresh every non-manual row and stamps freshness.
 *
 * Pure module: no React, storage, Supabase, clocks (unless supplied), or writes.
 */
import {
  isActiveProject,
  num,
  type BackupData,
  type BackupWeeklyData,
} from './backupDataService'
import { isDeadProjectLog, logProjectId } from './projectScopeMerge'
import { isDeletedOrArchivedServiceLog } from './serviceScopeMerge'

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
 * Project payment logs remain their own canonical records. When a log names a
 * known project, the existing project lifecycle predicate decides whether that
 * activity belongs in current active financials. Legacy/unlinked logs remain
 * readable so this policy does not silently discard old imports.
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
    return !project || isActiveProject(project)
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

  const proj = projectLogs.reduce((sum, log) => {
    const date = validDate(log?.date || log?.logDate)
    if (!date || date < weekStart || date >= weekEnd) return sum
    return sum + num(log?.paymentsCollected || log?.collected || 0)
  }, 0)

  const svc = serviceLogs.reduce((sum, log) => {
    const date = validDate(log?.date)
    if (!date || date < weekStart || date >= weekEnd) return sum
    return sum + num(log?.collected)
  }, 0)

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
 * Reader policy: historical rows stay persisted; only the current non-manual row
 * is overlaid with live canonical values. No input object or array is mutated.
 */
export function resolveWeeklyDataForRead(backup: BackupData, now = new Date()): BackupWeeklyData[] {
  const rows = Array.isArray(backup.weeklyData) ? backup.weeklyData : []
  return rows.map((row, index) => {
    if (row?.manualOverride === true || !isCurrentWeeklyRow(row, now)) return { ...row }
    const previousAccum = index > 0 ? num(rows[index - 1]?.accum) : 0
    return deriveRow(backup, row, previousAccum)
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
