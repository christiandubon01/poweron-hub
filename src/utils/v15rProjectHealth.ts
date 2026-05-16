/**
 * Shared field-log movement scanner.
 * Same logic as V15rProgressTab "Days Since Last Movement" / Project Health card.
 * Used by V15rProjectsPanel project cards for accurate stale-day calculation.
 */

const MOVEMENT_TIMESTAMP_FIELDS = ['createdAt', 'updatedAt', 'date', 'logDate', 'timestamp']
const MOVEMENT_TIMESTAMP_ALIASES = ['created_at', 'updated_at', 'log_date']

function normalizeMatchValue(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseDateLocal(dateStr?: string): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

function isArchivedOrDeletedLog(log: any): boolean {
  if (!log) return true
  if (log.archived === true || log.isArchived === true || log.deleted === true || log.isDeleted === true) return true
  if (log.archivedAt || log.deletedAt) return true
  const status = normalizeMatchValue(log.status || log.logStatus)
  return ['archived', 'deleted', 'void'].includes(status)
}

function projectLogMatchesProject(log: any, project: any): boolean {
  if (!log || !project) return false
  const projectId = normalizeMatchValue(project.id)
  const directIds = [
    log.projId,
    log.projectId,
    log.project_id,
    log.activeProject,
  ].map(normalizeMatchValue).filter(Boolean)
  if (projectId && directIds.includes(projectId)) return true

  const projectName = normalizeMatchValue(project.name || project.jobName)
  if (!projectName) return false
  const nameFields = [
    log.projName,
    log.projectName,
    log.project_name,
    log.jobName,
    log.job_name,
    log.activeProject,
  ].map(normalizeMatchValue).filter(Boolean)
  return nameFields.includes(projectName)
}

function movementLogDate(log: any): Date | null {
  const fields = [...MOVEMENT_TIMESTAMP_FIELDS, ...MOVEMENT_TIMESTAMP_ALIASES]
  for (const field of fields) {
    const raw = log?.[field]
    if (!raw) continue
    const d =
      field === 'date' || field === 'logDate' || field === 'log_date'
        ? parseDateLocal(String(raw).slice(0, 10))
        : new Date(raw)
    if (d && !isNaN(d.getTime())) return d
  }
  return null
}

function movementLogsForProject(backup: any, project: any): any[] {
  const sources = [
    ...(Array.isArray(backup?.logs) ? backup.logs : []),
    ...(Array.isArray(backup?.fieldLogs) ? backup.fieldLogs : []),
    ...(Array.isArray(backup?.field_logs) ? backup.field_logs : []),
    ...(Array.isArray(backup?.fieldObservationCards) ? backup.fieldObservationCards : []),
  ]
  return sources.filter(
    (log) => !isArchivedOrDeletedLog(log) && projectLogMatchesProject(log, project),
  )
}

/**
 * Returns days since the most recent field log entry for this project,
 * or null if no matching logs exist.
 *
 * Sources scanned: backup.logs, backup.fieldLogs, backup.field_logs,
 * backup.fieldObservationCards — same as V15rProgressTab Project Health.
 */
export function getProjectDaysSinceLastMovement(project: any, backup: any): number | null {
  const logs = movementLogsForProject(backup, project)
  const dates = logs
    .map(movementLogDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())
  const latest = dates[0]
  if (!latest) return null
  return Math.floor((Date.now() - latest.getTime()) / 86400000)
}
