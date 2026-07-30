/**
 * employeeWeeklyTime.ts — Pure date/label helpers for the weekly time board.
 *
 * No service calls, no DOM. All functions are deterministic given their inputs.
 * Mirrors the Monday-Sunday convention already used by employeePortalService
 * (getCurrentWeekRangeFromTenantDate, shiftWeekRange).
 */

import type { WeekRange } from '@/services/employeePortalService'

export const WEEK_TIME_DAY_COUNT = 7

// ── Internal date primitives ──────────────────────────────────────────────────

/** Parse YYYY-MM-DD as local midnight (no UTC shift). */
function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Format a local Date as YYYY-MM-DD. */
function toYMD(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Seven consecutive YYYY-MM-DD strings (Mon–Sun) for the given week range.
 * Range must be Monday–Sunday; the result always has exactly 7 entries.
 */
export function buildWeekTimeDates(range: WeekRange): string[] {
  const dates: string[] = []
  const start = parseLocalDate(range.startDate)
  for (let i = 0; i < WEEK_TIME_DAY_COUNT; i++) {
    const cur = new Date(start)
    cur.setDate(start.getDate() + i)
    dates.push(toYMD(cur))
  }
  return dates
}

export interface WeekTimeDayLabel {
  iso: string           // '2026-07-27'
  weekday: string       // 'Mon'
  weekdayFull: string   // 'Monday'
  weekdayInitial: string // 'M'
  dayNumber: string     // '27'
  monthDay: string      // 'Jul 27'
  full: string          // 'Mon, Jul 27'
}

/** Human-readable label parts for one day column in the weekly board. */
export function formatWeekTimeDayLabel(workDate: string): WeekTimeDayLabel {
  const d = parseLocalDate(workDate)
  const weekday = d.toLocaleDateString([], { weekday: 'short' })
  const weekdayFull = d.toLocaleDateString([], { weekday: 'long' })
  const dayNumber = String(d.getDate())
  const monthDay = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return {
    iso: workDate,
    weekday,
    weekdayFull,
    weekdayInitial: weekday.charAt(0),
    dayNumber,
    monthDay,
    full: `${weekday}, ${monthDay}`,
  }
}

/**
 * Week range label for the board header.
 * Example: "Jul 27 – Aug 2, 2026"
 */
export function formatWeekTimeBoardLabel(range: WeekRange): string {
  const [ys, ms, ds] = range.startDate.split('-').map(Number)
  const [ye, me, de] = range.endDate.split('-').map(Number)
  if (!ys || !ye) return `${range.startDate} – ${range.endDate}`
  const s = new Date(ys, ms - 1, ds)
  const e = new Date(ye, me - 1, de)
  const startStr = s.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const endStr = e.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  return `${startStr} – ${endStr}`
}

/**
 * True when workDate is the given tenant work date string.
 * Pass tenantWorkDate from getTenantWorkDate() so this stays pure.
 */
export function isTenantToday(workDate: string, tenantWorkDate: string): boolean {
  return workDate === tenantWorkDate
}

/**
 * Default selected date for the phone strip:
 * tenantWorkDate if it falls in the given range, else the range start.
 */
export function resolveDefaultSelectedDate(range: WeekRange, tenantWorkDate: string): string {
  if (tenantWorkDate >= range.startDate && tenantWorkDate <= range.endDate) {
    return tenantWorkDate
  }
  return range.startDate
}
