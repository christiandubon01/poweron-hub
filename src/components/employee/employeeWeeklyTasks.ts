/**
 * employeeWeeklyTasks — pure grouping/labelling helpers for the employee
 * seven-day task board (EMPLOYEE-WEEKLY-TASK-VIEW-1).
 *
 * No data source of its own: every input is a row already returned by
 * get_my_employee_tasks via employeeTaskAssignmentService. Days come from the
 * existing employee-portal Monday–Sunday WeekRange convention
 * (getCurrentWeekRangeFromTenantDate / shiftWeekRange) — this file never
 * introduces a second calendar convention.
 *
 * Day assignment uses the real assignment field `due_date` (DATE, nullable).
 * There is no separate scheduled-date column, so a task with no usable
 * due_date is "unscheduled" rather than hidden.
 */

import { addDaysToWorkDate, type WeekRange } from '@/services/employeePortalService'
import type { EmployeeMyTask } from '@/services/employeeTaskAssignmentService'

/** A calendar week always renders this many day entries. */
export const WEEK_DAY_COUNT = 7

export interface WeeklyTaskDay {
  /** YYYY-MM-DD */
  date: string
  /** Tasks due that day, in the order the backend returned them. */
  tasks: EmployeeMyTask[]
}

export interface WeeklyTaskPartition {
  /** Not completed — eligible for the weekly board. */
  active: EmployeeMyTask[]
  /** Completed (or just-confirmed complete) — the Archived bucket. */
  archived: EmployeeMyTask[]
}

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** True only for a real calendar date in YYYY-MM-DD form. */
export function isUsableDayValue(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!YMD_PATTERN.test(text)) return false
  const [y, m, d] = text.split('-').map(Number)
  const probe = new Date(y, m - 1, d)
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d
}

/** The task's usable calendar day, or null when it cannot be placed on the board. */
export function resolveTaskDay(task: EmployeeMyTask): string | null {
  const raw = task?.due_date
  return isUsableDayValue(raw) ? raw.trim() : null
}

/**
 * Completed tasks live in the Archive. `confirmedCompletedIds` holds ids whose
 * completion the backend already confirmed during this session, so the move out
 * of Active happens immediately without waiting for the refetch.
 */
export function isTaskArchived(
  task: EmployeeMyTask,
  confirmedCompletedIds?: ReadonlySet<string>,
): boolean {
  if (task?.status === 'completed') return true
  return !!task?.id && !!confirmedCompletedIds?.has(task.id)
}

/**
 * Splits the single task list into mutually exclusive Active / Archived buckets
 * and drops repeated assignment ids so a task can never render twice.
 */
export function partitionMyTasks(
  tasks: readonly EmployeeMyTask[],
  confirmedCompletedIds?: ReadonlySet<string>,
): WeeklyTaskPartition {
  const seen = new Set<string>()
  const active: EmployeeMyTask[] = []
  const archived: EmployeeMyTask[] = []

  for (const task of tasks ?? []) {
    const id = task?.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    if (isTaskArchived(task, confirmedCompletedIds)) archived.push(task)
    else active.push(task)
  }

  return { active, archived }
}

/** The seven YYYY-MM-DD days of a week range, derived from its start date. */
export function buildWeekDates(range: WeekRange): string[] {
  const start = isUsableDayValue(range?.startDate) ? range.startDate.trim() : ''
  if (!start) return []
  return Array.from({ length: WEEK_DAY_COUNT }, (_, index) => addDaysToWorkDate(start, index))
}

/**
 * Exactly seven day buckets for the selected week. Tasks keep the backend's
 * order inside each day (get_my_employee_tasks orders by due_date, assigned_at),
 * so a status update never reshuffles a column. Tasks due outside the week and
 * tasks with no usable day are excluded here.
 */
export function buildWeekDays(
  range: WeekRange,
  activeTasks: readonly EmployeeMyTask[],
): WeeklyTaskDay[] {
  const dates = buildWeekDates(range)
  const days: WeeklyTaskDay[] = dates.map((date) => ({ date, tasks: [] }))
  const byDate = new Map(days.map((day) => [day.date, day]))

  for (const task of activeTasks ?? []) {
    const day = resolveTaskDay(task)
    if (!day) continue
    byDate.get(day)?.tasks.push(task)
  }

  return days
}

/** Active tasks with no usable due date — shown in the small Unscheduled section. */
export function collectUnscheduledTasks(
  activeTasks: readonly EmployeeMyTask[],
): EmployeeMyTask[] {
  return (activeTasks ?? []).filter((task) => resolveTaskDay(task) === null)
}

/** Active tasks scheduled outside the selected week (never rendered on the board). */
export function countTasksOutsideWeek(
  range: WeekRange,
  activeTasks: readonly EmployeeMyTask[],
): number {
  const dates = new Set(buildWeekDates(range))
  let count = 0
  for (const task of activeTasks ?? []) {
    const day = resolveTaskDay(task)
    if (day && !dates.has(day)) count += 1
  }
  return count
}

/** Total task count across the seven day buckets. */
export function countWeekTasks(days: readonly WeeklyTaskDay[]): number {
  return (days ?? []).reduce((total, day) => total + day.tasks.length, 0)
}

/** Most recently completed first; rows without a timestamp keep their relative order last. */
export function sortArchivedTasks(archived: readonly EmployeeMyTask[]): EmployeeMyTask[] {
  return (archived ?? [])
    .map((task, index) => ({ task, index, at: toTimestamp(task?.completed_at) }))
    .sort((a, b) => {
      if (a.at !== b.at) return b.at - a.at
      return a.index - b.index
    })
    .map((entry) => entry.task)
}

function toTimestamp(iso: string | null | undefined): number {
  if (!iso) return -1
  const value = new Date(iso).getTime()
  return Number.isFinite(value) ? value : -1
}

/** True when the week range contains the given day. */
export function weekContainsDay(range: WeekRange, day: string): boolean {
  if (!isUsableDayValue(day)) return false
  return buildWeekDates(range).includes(day)
}

/**
 * Keeps a valid selected day for the phone/tablet day list: the current
 * selection when it is still inside the week, otherwise today, otherwise the
 * first day of the week.
 */
export function resolveSelectedDay(
  range: WeekRange,
  today: string,
  current?: string | null,
): string {
  const dates = buildWeekDates(range)
  if (dates.length === 0) return ''
  if (current && dates.includes(current)) return current
  if (isUsableDayValue(today) && dates.includes(today)) return today
  return dates[0]
}

/**
 * Keeps the focused detail panel pointed at a task that is still active.
 *
 * Returns null once the selection completes, is revoked or leaves the payload, so
 * a finished task can never keep an editable form open. Selection is by stable
 * assignment id and is deliberately not auto-advanced to another task.
 */
export function resolveSelectedTaskId(
  activeTasks: readonly EmployeeMyTask[],
  current?: string | null,
): string | null {
  const id = String(current || '').trim()
  if (!id) return null
  return (activeTasks ?? []).some((task) => task?.id === id) ? id : null
}

// ── Labels (existing portal locale style: toLocaleDateString([], …)) ──────────

/** Readable selected-week range, e.g. "Jul 27 – Aug 2, 2026". */
export function formatWeekRangeLabel(range: WeekRange): string {
  const dates = buildWeekDates(range)
  if (dates.length === 0) return ''
  const start = parseLocalDay(dates[0])
  const end = parseLocalDay(dates[dates.length - 1])
  if (!start || !end) return ''
  const startLabel = start.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const endLabel = end.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  return `${startLabel} – ${endLabel}`
}

export interface DayLabel {
  /** "Mon" */
  weekday: string
  /** "M" — phone strip */
  weekdayInitial: string
  /** "27" */
  dayNumber: string
  /** "Jul 27" — narrow desktop day column, where `weekday` is already shown */
  monthDay: string
  /** "Mon, Jul 27" */
  short: string
  /** "Mon, Jul 27, 2026" */
  full: string
}

export function formatDayLabel(day: string): DayLabel {
  const date = parseLocalDay(day)
  if (!date) {
    return {
      weekday: '',
      weekdayInitial: '',
      dayNumber: '',
      monthDay: day || '',
      short: day || '',
      full: day || '',
    }
  }
  const weekday = date.toLocaleDateString([], { weekday: 'short' })
  return {
    weekday,
    weekdayInitial: weekday.slice(0, 1),
    dayNumber: String(date.getDate()),
    monthDay: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
    short: date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
    full: date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
  }
}

/** Local-midnight Date for a YYYY-MM-DD day (no UTC shift). */
export function parseLocalDay(day: string): Date | null {
  if (!isUsableDayValue(day)) return null
  const [y, m, d] = day.trim().split('-').map(Number)
  return new Date(y, m - 1, d)
}
