/**
 * employeeMonthCalendar — pure month-grid and metric aggregation for the
 * Employee Portal Schedule tab (EMPLOYEE-SCHEDULE-MONTH-VIEW-1).
 *
 * No data source of its own. Every input is already returned by an existing
 * service:
 *   scheduled hours — employee_schedules rows (employeeScheduleService)
 *   worked hours    — EmployeeMyTimeDay.paidMinutes (employeePortalService,
 *                     the same value My Time displays)
 *   tasks           — get_my_employee_tasks rows (employeeTaskAssignmentService)
 *
 * Week start is Monday, matching getCurrentWeekRangeFromTenantDate() and the
 * weekly task board. This file never introduces a second calendar convention.
 *
 * Dates are tenant-local (America/Los_Angeles). YYYY-MM-DD values are parsed
 * field-by-field into a local Date — never through `new Date('2026-07-01')`,
 * which would be read as UTC midnight and land on the previous day in Pacific
 * time.
 */

import type { ScheduleItem } from '@/services/employeeScheduleService'
import type { EmployeeMyTimeDay } from '@/services/employeePortalService'
import type { EmployeeMyTask } from '@/services/employeeTaskAssignmentService'

/**
 * Tenant timezone. Mirrors TENANT_TIMEZONE in employeeTimeService (the Clock's
 * authoritative source) and migration 081 tenant_work_date(). Duplicated rather
 * than imported to keep the Clock service untouched; a unit test pins the two to
 * the same value so drift fails loudly.
 */
export const TENANT_TIMEZONE = 'America/Los_Angeles'

/** A calendar week always renders this many day columns. */
export const WEEK_DAY_COUNT = 7

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface MonthGrid {
  /** YYYY-MM-DD, first of the titled month. */
  monthStart: string
  /** YYYY-MM-DD, last day of the titled month. */
  monthEnd: string
  /** YYYY-MM-DD, Monday that opens the first visible week. */
  visibleStart: string
  /** YYYY-MM-DD, Sunday that closes the last visible week. */
  visibleEnd: string
  /** Every visible date in order, including adjacent-month padding. */
  dates: string[]
  /** 4, 5 or 6 — whole weeks only. */
  weekCount: number
}

export interface MonthDayMetrics {
  dateKey: string
  isCurrentMonth: boolean
  isToday: boolean
  /** Decimal hours, rounded to 2dp. */
  scheduledHours: number
  /** Decimal hours from the authoritative paid_minutes, rounded to 2dp. */
  workedHours: number
  assignedTaskCount: number
  completedTaskCount: number
}

// ── Local date primitives (no UTC shifting) ──────────────────────────────────

/** True only for a real calendar date in YYYY-MM-DD form. */
export function isUsableDayValue(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!YMD_PATTERN.test(text)) return false
  const [y, m, d] = text.split('-').map(Number)
  const probe = new Date(y, m - 1, d)
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d
}

/** Local-midnight Date for a YYYY-MM-DD day, or null. */
export function parseLocalDay(day: string): Date | null {
  if (!isUsableDayValue(day)) return null
  const [y, m, d] = day.trim().split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** YYYY-MM-DD for a local Date. */
export function formatLocalDay(date: Date): string {
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** Shift a YYYY-MM-DD value by whole days. */
export function addDaysToDay(day: string, days: number): string {
  const base = parseLocalDay(day)
  if (!base) return day
  base.setDate(base.getDate() + days)
  return formatLocalDay(base)
}

/**
 * The tenant-local calendar date for an absolute timestamp.
 *
 * Used for completed_at: a task completed at 2026-07-01T02:00:00Z belongs to
 * 2026-06-30 in Pacific time, and must be counted on that day.
 */
export function tenantDateKeyFromTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null
  const instant = new Date(iso)
  if (isNaN(instant.getTime())) return null
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TENANT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant)
  } catch {
    return null
  }
}

// ── Month grid ───────────────────────────────────────────────────────────────

/**
 * The complete visible grid for the month containing `anchor`, padded to whole
 * Monday–Sunday weeks. Adjacent-month dates are real dates, not blanks, so the
 * grid never changes shape mid-week.
 */
export function buildMonthGrid(anchor: string): MonthGrid {
  const anchorDate = parseLocalDay(anchor) ?? new Date()
  const year = anchorDate.getFullYear()
  const monthIndex = anchorDate.getMonth()

  const first = new Date(year, monthIndex, 1)
  const last = new Date(year, monthIndex + 1, 0)

  // getDay(): 0=Sun..6=Sat. Monday opens the week.
  const firstDow = first.getDay()
  const backToMonday = firstDow === 0 ? -6 : 1 - firstDow
  const lastDow = last.getDay()
  const forwardToSunday = lastDow === 0 ? 0 : 7 - lastDow

  const visibleStartDate = new Date(year, monthIndex, 1 + backToMonday)
  const visibleEndDate = new Date(year, monthIndex, last.getDate() + forwardToSunday)

  const visibleStart = formatLocalDay(visibleStartDate)
  const visibleEnd = formatLocalDay(visibleEndDate)

  const dates: string[] = []
  let cursor = visibleStart
  // Whole weeks only; the cap guards against a malformed anchor.
  for (let i = 0; i < 45 && cursor <= visibleEnd; i += 1) {
    dates.push(cursor)
    cursor = addDaysToDay(cursor, 1)
  }

  return {
    monthStart: formatLocalDay(first),
    monthEnd: formatLocalDay(last),
    visibleStart,
    visibleEnd,
    dates,
    weekCount: Math.round(dates.length / WEEK_DAY_COUNT),
  }
}

/** Move the anchor by whole months, clamped to a real day-of-month. */
export function shiftMonth(anchor: string, months: number): string {
  const base = parseLocalDay(anchor) ?? new Date()
  // Day 1 avoids Jan 31 → Mar 3 overflow when stepping months.
  const moved = new Date(base.getFullYear(), base.getMonth() + months, 1)
  return formatLocalDay(moved)
}

/** True when both days fall in the same calendar month and year. */
export function isSameMonth(day: string, anchor: string): boolean {
  const a = parseLocalDay(day)
  const b = parseLocalDay(anchor)
  if (!a || !b) return false
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

/** "July 2026" */
export function formatMonthTitle(anchor: string): string {
  const date = parseLocalDay(anchor)
  if (!date) return ''
  return date.toLocaleDateString([], { month: 'long', year: 'numeric' })
}

/** Monday-first weekday headers, e.g. ["Mon", …, "Sun"]. */
export function buildWeekdayLabels(): string[] {
  // 2024-01-01 was a Monday; any known Monday works as the seed.
  const seed = new Date(2024, 0, 1)
  return Array.from({ length: WEEK_DAY_COUNT }, (_, index) => {
    const day = new Date(seed.getFullYear(), seed.getMonth(), seed.getDate() + index)
    return day.toLocaleDateString([], { weekday: 'short' })
  })
}

// ── Metric derivation ────────────────────────────────────────────────────────

/** Minutes since midnight for a HH:MM or HH:MM:SS TIME value. */
function timeToMinutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const parts = value.trim().split(':')
  if (parts.length < 2) return null
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

/**
 * Scheduled hours for one employee_schedules row.
 *
 * start_time/end_time is authoritative; estimated_minutes is the fallback when
 * the owner scheduled work without explicit times. end_time earlier than
 * start_time is an overnight shift and wraps past midnight, credited in full to
 * the shift's work_date.
 *
 * employee_schedules has no break/unpaid column (migration 086), so there is no
 * break rule to honor here — scheduled hours are gross scheduled duration.
 * Cancelled rows contribute nothing, matching how the day view sets them aside.
 */
export function scheduleItemHours(item: ScheduleItem | null | undefined): number {
  if (!item || item.status === 'cancelled') return 0

  const start = timeToMinutes(item.start_time)
  const end = timeToMinutes(item.end_time)
  if (start != null && end != null) {
    let minutes = end - start
    if (minutes < 0) minutes += 24 * 60
    return round2(minutes / 60)
  }

  const estimated = Number(item.estimated_minutes)
  if (Number.isFinite(estimated) && estimated > 0) return round2(estimated / 60)

  return 0
}

/** Two-decimal rounding that never emits -0, NaN or Infinity. */
function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  const rounded = Math.round(value * 100) / 100
  return rounded === 0 ? 0 : rounded
}

export interface AggregateMonthMetricsInput {
  /** Every visible date, from buildMonthGrid. */
  visibleDates: readonly string[]
  /** Anchor day inside the titled month, for isCurrentMonth. */
  monthAnchor: string
  /** Tenant-local today, from getTenantWorkDate(). */
  todayKey: string
  scheduleItems: readonly ScheduleItem[]
  /** One entry per date from getMyTimeSummary. */
  timeDays: readonly EmployeeMyTimeDay[]
  tasks: readonly EmployeeMyTask[]
}

/**
 * Exactly one record per visible date, in grid order.
 *
 * Assigned counts open work (assigned + in_progress) on its due_date, matching
 * the weekly board's active bucket, so a task is never both assigned and
 * completed. Completed counts server-confirmed completions on the tenant-local
 * date of completed_at — a late completion lands on the day it actually
 * finished, not its due date. Both are deduplicated by assignment id.
 */
export function aggregateMonthMetrics(input: AggregateMonthMetricsInput): MonthDayMetrics[] {
  const {
    visibleDates,
    monthAnchor,
    todayKey,
    scheduleItems,
    timeDays,
    tasks,
  } = input

  const dates = (visibleDates ?? []).filter(isUsableDayValue)

  const scheduledByDate = new Map<string, number>()
  const seenScheduleIds = new Set<string>()
  for (const item of scheduleItems ?? []) {
    const id = String(item?.id || '').trim()
    if (!id || seenScheduleIds.has(id)) continue
    seenScheduleIds.add(id)
    const dateKey = normalizeDayValue(item?.work_date)
    if (!dateKey) continue
    const hours = scheduleItemHours(item)
    if (hours <= 0) {
      if (!scheduledByDate.has(dateKey)) scheduledByDate.set(dateKey, 0)
      continue
    }
    scheduledByDate.set(dateKey, round2((scheduledByDate.get(dateKey) ?? 0) + hours))
  }

  // Worked hours come only from the time_entries-backed paidMinutes, never from
  // punches, so raw punches and derived entries can never be double-counted.
  const workedByDate = new Map<string, number>()
  const seenTimeDates = new Set<string>()
  for (const day of timeDays ?? []) {
    const dateKey = normalizeDayValue(day?.workDate)
    if (!dateKey || seenTimeDates.has(dateKey)) continue
    seenTimeDates.add(dateKey)
    const minutes = Number(day?.paidMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0) {
      workedByDate.set(dateKey, 0)
      continue
    }
    workedByDate.set(dateKey, round2(minutes / 60))
  }

  const assignedByDate = new Map<string, number>()
  const completedByDate = new Map<string, number>()
  const seenTaskIds = new Set<string>()
  for (const task of tasks ?? []) {
    const id = String(task?.id || '').trim()
    if (!id || seenTaskIds.has(id)) continue
    seenTaskIds.add(id)

    if (task?.status === 'completed') {
      // Server-confirmed completions only; a missing completed_at is not a day.
      const completedKey = tenantDateKeyFromTimestamp(task.completed_at)
      if (completedKey) {
        completedByDate.set(completedKey, (completedByDate.get(completedKey) ?? 0) + 1)
      }
      continue
    }

    if (task?.status === 'assigned' || task?.status === 'in_progress') {
      const dueKey = normalizeDayValue(task.due_date)
      // A null or unusable due date has no calendar day; it stays uncounted
      // rather than collapsing onto today or the epoch.
      if (dueKey) {
        assignedByDate.set(dueKey, (assignedByDate.get(dueKey) ?? 0) + 1)
      }
    }
  }

  return dates.map((dateKey) => ({
    dateKey,
    isCurrentMonth: isSameMonth(dateKey, monthAnchor),
    isToday: dateKey === todayKey,
    scheduledHours: round2(scheduledByDate.get(dateKey) ?? 0),
    workedHours: round2(workedByDate.get(dateKey) ?? 0),
    assignedTaskCount: assignedByDate.get(dateKey) ?? 0,
    completedTaskCount: completedByDate.get(dateKey) ?? 0,
  }))
}

/** A usable YYYY-MM-DD day key, trimmed, or null. */
function normalizeDayValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().slice(0, 10)
  return isUsableDayValue(text) ? text : null
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Compact hours: "8h", "7.5h", "0h". Never NaN, -0, Infinity, null or 8.00.
 * Two decimals are preserved when present (e.g. a 15-minute increment "0.25h").
 */
export function formatMetricHours(hours: unknown): string {
  const value = Number(hours)
  if (!Number.isFinite(value) || value <= 0) return '0h'
  const text = (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, '')
  return `${text || '0'}h`
}

/** Integer task count, never NaN or negative. */
export function formatMetricCount(count: unknown): string {
  const value = Number(count)
  if (!Number.isFinite(value) || value <= 0) return '0'
  return String(Math.floor(value))
}

/** Day-of-month number for a date key, e.g. "15". */
export function formatDayNumber(dateKey: string): string {
  const date = parseLocalDay(dateKey)
  return date ? String(date.getDate()) : ''
}

/** "Wed, Jul 15, 2026" — phone selected-day heading. */
export function formatFullDayLabel(dateKey: string): string {
  const date = parseLocalDay(dateKey)
  if (!date) return dateKey || ''
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** "Jul 15" — compact phone strip label. */
export function formatShortDayLabel(dateKey: string): string {
  const date = parseLocalDay(dateKey)
  if (!date) return dateKey || ''
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** The metrics record for one date, or a safe zeroed record. */
export function findDayMetrics(
  days: readonly MonthDayMetrics[],
  dateKey: string,
): MonthDayMetrics | null {
  return (days ?? []).find((day) => day.dateKey === dateKey) ?? null
}

/**
 * Keeps a valid selected day for the phone view: the current selection while it
 * is still visible, otherwise today, otherwise the first day of the month.
 */
export function resolveSelectedDate(
  grid: MonthGrid,
  todayKey: string,
  current?: string | null,
): string {
  const dates = grid?.dates ?? []
  if (dates.length === 0) return ''
  if (current && dates.includes(current)) return current
  if (dates.includes(todayKey)) return todayKey
  return grid.monthStart
}
