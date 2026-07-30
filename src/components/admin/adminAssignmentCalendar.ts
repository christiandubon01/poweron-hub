export type AdminAssignmentCalendarFilter = 'all' | 'pending' | 'completed'
export type AdminAssignmentCalendarView = 'week' | 'month'

export interface CalendarAssignmentLike {
  id: string
  due_date: string | null
  status: string
  assigned_at?: string
}

export interface AdminAssignmentWeek {
  startDate: string
  endDate: string
  dates: string[]
}

export interface AdminAssignmentMonth {
  monthStart: string
  monthEnd: string
  visibleStart: string
  visibleEnd: string
  dates: string[]
  weekCount: number
}

export function isUsableAssignmentDay(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false
  const [year, month, day] = value.trim().split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  )
}

export function parseAssignmentDay(value: string): Date | null {
  if (!isUsableAssignmentDay(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatAssignmentDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addAssignmentDays(value: string, days: number): string {
  const date = parseAssignmentDay(value)
  if (!date) return value
  date.setDate(date.getDate() + days)
  return formatAssignmentDay(date)
}

export function getAdminAssignmentWeek(anchor: string): AdminAssignmentWeek {
  const anchorDate = parseAssignmentDay(anchor) ?? new Date()
  const dayOfWeek = anchorDate.getDay()
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const startDate = addAssignmentDays(formatAssignmentDay(anchorDate), offsetToMonday)
  const dates = Array.from({ length: 7 }, (_, index) => addAssignmentDays(startDate, index))
  return { startDate, endDate: dates[6], dates }
}

export function shiftAdminAssignmentWeek(week: AdminAssignmentWeek, weeks: number): AdminAssignmentWeek {
  return getAdminAssignmentWeek(addAssignmentDays(week.startDate, weeks * 7))
}

export function buildAdminAssignmentMonth(anchor: string): AdminAssignmentMonth {
  const anchorDate = parseAssignmentDay(anchor) ?? new Date()
  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth()
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const backToMonday = first.getDay() === 0 ? -6 : 1 - first.getDay()
  const forwardToSunday = last.getDay() === 0 ? 0 : 7 - last.getDay()
  const visibleStartDate = new Date(year, month, 1 + backToMonday)
  let visibleEndDate = new Date(year, month, last.getDate() + forwardToSunday)

  // Month boards remain a readable five- or six-week calendar, including the
  // rare February that would otherwise collapse to four rows.
  const initialDays = Math.round((visibleEndDate.getTime() - visibleStartDate.getTime()) / 86_400_000) + 1
  if (initialDays < 35) {
    visibleEndDate = new Date(
      visibleEndDate.getFullYear(),
      visibleEndDate.getMonth(),
      visibleEndDate.getDate() + (35 - initialDays),
    )
  }

  const visibleStart = formatAssignmentDay(visibleStartDate)
  const visibleEnd = formatAssignmentDay(visibleEndDate)
  const dates: string[] = []
  for (let cursor = visibleStart; cursor <= visibleEnd && dates.length < 42; cursor = addAssignmentDays(cursor, 1)) {
    dates.push(cursor)
  }

  return {
    monthStart: formatAssignmentDay(first),
    monthEnd: formatAssignmentDay(last),
    visibleStart,
    visibleEnd,
    dates,
    weekCount: dates.length / 7,
  }
}

export function shiftAdminAssignmentMonth(anchor: string, months: number): string {
  const date = parseAssignmentDay(anchor) ?? new Date()
  return formatAssignmentDay(new Date(date.getFullYear(), date.getMonth() + months, 1))
}

export function formatAdminAssignmentWeekRange(week: AdminAssignmentWeek): string {
  const start = parseAssignmentDay(week.startDate)
  const end = parseAssignmentDay(week.endDate)
  if (!start || !end) return ''
  const sameYear = start.getFullYear() === end.getFullYear()
  const startText = start.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  const endText = end.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  return `${startText} – ${endText}`
}

export function formatAdminAssignmentMonthTitle(anchor: string): string {
  const date = parseAssignmentDay(anchor)
  return date?.toLocaleDateString([], { month: 'long', year: 'numeric' }) ?? ''
}

export function filterAdminAssignments<T extends CalendarAssignmentLike>(
  rows: readonly T[],
  filter: AdminAssignmentCalendarFilter,
): T[] {
  const unique = new Map<string, T>()
  for (const row of rows) {
    if (!row?.id || unique.has(row.id)) continue
    if (filter === 'pending' && row.status === 'completed') continue
    if (filter === 'completed' && row.status !== 'completed') continue
    unique.set(row.id, row)
  }
  return [...unique.values()]
}

export function groupAdminAssignmentsByDueDate<T extends CalendarAssignmentLike>(
  rows: readonly T[],
): { byDate: Map<string, T[]>; unscheduled: T[] } {
  const byDate = new Map<string, T[]>()
  const unscheduled: T[] = []
  const unique = new Set<string>()

  for (const row of rows) {
    if (!row?.id || unique.has(row.id)) continue
    unique.add(row.id)
    if (!isUsableAssignmentDay(row.due_date)) {
      unscheduled.push(row)
      continue
    }
    const key = row.due_date.trim()
    const list = byDate.get(key) ?? []
    list.push(row)
    byDate.set(key, list)
  }

  const sortRows = (a: T, b: T) =>
    String(a.assigned_at ?? '').localeCompare(String(b.assigned_at ?? '')) || a.id.localeCompare(b.id)
  for (const list of byDate.values()) list.sort(sortRows)
  unscheduled.sort(sortRows)
  return { byDate, unscheduled }
}

export function isAssignmentDayInMonth(day: string, anchor: string): boolean {
  const date = parseAssignmentDay(day)
  const month = parseAssignmentDay(anchor)
  return !!date && !!month && date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth()
}

export function adminAssignmentWeekdayLabels(): string[] {
  return Array.from({ length: 7 }, (_, index) =>
    new Date(2024, 0, 1 + index).toLocaleDateString([], { weekday: 'short' }),
  )
}
