// @ts-nocheck
/**
 * revenueTimelineQueries.ts — Revenue Timeline Data Access Layer
 *
 * Reads from backupDataService (local-first localStorage state).
 * Wraps the pure calculation functions in revenueTimelineService.ts
 * with data fetching so components only need to call one function.
 *
 * DO NOT put React hooks here. These are plain data-fetch functions.
 */

import { getBackupData, saveBackupData, getPhaseWeights } from '@/services/backupDataService'
import {
  getPhasePaymentSchedule,
  get8WeekCashFlow,
  getMonthlyRevenueComparison,
  getOverlapWindows,
  getQuoteVsActual,
  getProjectGanttData,
  type PhaseTimelineEntry,
  type PaymentEvent,
  type WeekBucket,
  type MonthBucket,
  type OverlapWindow,
  type PhaseVariance,
  type GanttProjectRow,
} from '@/services/revenueTimelineService'

export type {
  PhaseTimelineEntry,
  PaymentEvent,
  WeekBucket,
  MonthBucket,
  OverlapWindow,
  PhaseVariance,
  GanttProjectRow,
}

// ── Data normalizers ─────────────────────────────────────────────────────────

/**
 * Normalize a project's phase_timeline field against the current phase weights.
 * Creates entries for any phases that don't yet have a timeline entry.
 * Returns the normalized array without mutating the project object.
 */
export function normalizePhaseTimeline(
  project: any,
  backup: any
): PhaseTimelineEntry[] {
  const weights = getPhaseWeights(backup)
  const phaseNames = Object.keys(weights)
  const existing: PhaseTimelineEntry[] = project.phase_timeline || []
  const existingByName: Record<string, PhaseTimelineEntry> = {}
  for (const e of existing) {
    existingByName[e.phase_name] = e
  }

  const totalPhasePct = phaseNames.length > 0 ? 100 : 0
  const perPhase = phaseNames.length > 0 ? Math.floor(totalPhasePct / phaseNames.length) : 0

  return phaseNames.map(name => {
    return existingByName[name] || {
      phase_name: name,
      confirmed_start_date: null,
      estimated_duration_days: null,
      actual_start_date: null,
      actual_end_date: null,
      quoted_labor_hours: null,
      quoted_material_cost: null,
      payment_trigger_pct: perPhase,
    }
  })
}

// ── Read queries ─────────────────────────────────────────────────────────────

/** Get all projects from local state */
export function getAllProjects(): any[] {
  const backup = getBackupData()
  return backup?.projects || []
}

/** Get all field logs from local state */
export function getAllLogs(): any[] {
  const backup = getBackupData()
  return backup?.logs || []
}

/** Get the full backup object */
export function getBackup(): any {
  return getBackupData()
}

/** Get 8-week cash flow buckets from current local state */
export function query8WeekCashFlow(): WeekBucket[] {
  const backup = getBackupData()
  if (!backup) return []
  return get8WeekCashFlow(backup.projects || [], backup.logs || [])
}

/** Get monthly revenue comparison from current local state */
export function queryMonthlyRevenue(months: number = 6, startMonthOffset: number = 0): MonthBucket[] {
  const backup = getBackupData()
  if (!backup) return []
  return getMonthlyRevenueComparison(backup.projects || [], backup.logs || [], months, startMonthOffset)
}

/** Get overlap windows from current local state */
export function queryOverlapWindows(): OverlapWindow[] {
  const backup = getBackupData()
  if (!backup) return []
  return getOverlapWindows(backup.projects || [])
}

/** Get Gantt data for all active/coming projects */
export function queryGanttData(): GanttProjectRow[] {
  const backup = getBackupData()
  if (!backup) return []
  const overlaps = getOverlapWindows(backup.projects || [])
  return getProjectGanttData(backup.projects || [], overlaps)
}

/** Get quote vs actual variance for a specific project */
export function queryQuoteVsActual(projectId: string): PhaseVariance[] {
  const backup = getBackupData()
  if (!backup) return []
  const project = (backup.projects || []).find((p: any) => p.id === projectId)
  if (!project) return []
  return getQuoteVsActual(project, backup.logs || [])
}

/** Get payment schedule for a specific project */
export function queryPaymentSchedule(projectId: string): PaymentEvent[] {
  const backup = getBackupData()
  if (!backup) return []
  const project = (backup.projects || []).find((p: any) => p.id === projectId)
  if (!project) return []
  return getPhasePaymentSchedule(project, backup.projects || [])
}

/** Get quote vs actual for ALL projects that have relevant data */
export function queryAllQuoteVsActual(): Array<{ projectId: string; projectName: string; variances: PhaseVariance[] }> {
  const backup = getBackupData()
  if (!backup) return []
  const projects = backup.projects || []
  const logs = backup.logs || []

  return projects
    .map((p: any) => ({
      projectId: p.id,
      projectName: p.name || 'Unknown',
      variances: getQuoteVsActual(p, logs),
    }))
    .filter((r: any) => r.variances.length > 0)
}

// ── Write / mutations ────────────────────────────────────────────────────────

/**
 * Save updated phase_timeline entries for a project.
 * Also optionally saves deposit_pct and phase_deposit_pct.
 */
export function savePhaseTimeline(
  projectId: string,
  phaseTimeline: PhaseTimelineEntry[],
  opts?: { deposit_pct?: number; phase_deposit_pct?: number }
): boolean {
  const backup = getBackupData()
  if (!backup) return false

  const projects = backup.projects || []
  const idx = projects.findIndex((p: any) => p.id === projectId)
  if (idx === -1) return false

  const updated = { ...projects[idx], phase_timeline: phaseTimeline }
  if (opts?.deposit_pct !== undefined) updated.deposit_pct = opts.deposit_pct
  if (opts?.phase_deposit_pct !== undefined) updated.phase_deposit_pct = opts.phase_deposit_pct

  const updatedProjects = [...projects]
  updatedProjects[idx] = updated

  saveBackupData({ ...backup, projects: updatedProjects, _lastSavedAt: Date.now() })
  return true
}

/**
 * Save a single phase timeline entry (creates or updates by phase_name).
 */
export function savePhaseTimelineEntry(
  projectId: string,
  entry: PhaseTimelineEntry
): boolean {
  const backup = getBackupData()
  if (!backup) return false

  const projects = backup.projects || []
  const idx = projects.findIndex((p: any) => p.id === projectId)
  if (idx === -1) return false

  const project = projects[idx]
  const timeline: PhaseTimelineEntry[] = project.phase_timeline ? [...project.phase_timeline] : []
  const entryIdx = timeline.findIndex(e => e.phase_name === entry.phase_name)

  if (entryIdx === -1) {
    timeline.push(entry)
  } else {
    timeline[entryIdx] = entry
  }

  const updated = { ...project, phase_timeline: timeline }
  const updatedProjects = [...projects]
  updatedProjects[idx] = updated

  saveBackupData({ ...backup, projects: updatedProjects, _lastSavedAt: Date.now() })
  return true
}

/** Get the daily target from settings (for monthly target line in charts) */
export function getDailyTarget(): number {
  const backup = getBackupData()
  return backup?.settings?.dayTarget || 0
}
