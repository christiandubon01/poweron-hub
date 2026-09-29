import type { RecurrenceRule } from './obligationsTypes'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export interface CalendarDateParts {
  year: number
  month: number
  day: number
}

export function parseCalendarDate(value: string): CalendarDateParts {
  const match = DATE_RE.exec(value)
  if (!match) throw new Error(`Invalid calendar date: ${value}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const max = daysInMonth(year, month)
  if (month < 1 || month > 12 || day < 1 || day > max) {
    throw new Error(`Invalid calendar date: ${value}`)
  }
  return { year, month, day }
}

export function formatCalendarDate(parts: CalendarDateParts): string {
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-')
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) throw new Error(`Invalid month: ${month}`)
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function toEpochDay(value: string): number {
  const { year, month, day } = parseCalendarDate(value)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function fromEpochDay(epochDay: number): string {
  const d = new Date(epochDay * 86_400_000)
  return formatCalendarDate({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  })
}

export function addCalendarDays(value: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error('days must be an integer')
  return fromEpochDay(toEpochDay(value) + days)
}

export function addCalendarMonthsClamped(anchorDate: string, months: number): string {
  if (!Number.isInteger(months)) throw new Error('months must be an integer')
  const anchor = parseCalendarDate(anchorDate)
  const zeroBased = (anchor.month - 1) + months
  const year = anchor.year + Math.floor(zeroBased / 12)
  const monthIndex = ((zeroBased % 12) + 12) % 12
  const month = monthIndex + 1
  return formatCalendarDate({
    year,
    month,
    day: Math.min(anchor.day, daysInMonth(year, month)),
  })
}

export function addCalendarYearsClamped(anchorDate: string, years: number): string {
  if (!Number.isInteger(years)) throw new Error('years must be an integer')
  const anchor = parseCalendarDate(anchorDate)
  const year = anchor.year + years
  return formatCalendarDate({
    year,
    month: anchor.month,
    day: Math.min(anchor.day, daysInMonth(year, anchor.month)),
  })
}

export function generateRecurrenceDates(
  rule: RecurrenceRule,
  rangeStart: string,
  rangeEnd: string,
): string[] {
  parseCalendarDate(rule.anchorDate)
  parseCalendarDate(rule.startDate)
  parseCalendarDate(rangeStart)
  parseCalendarDate(rangeEnd)
  if (rangeStart > rangeEnd) throw new Error('rangeStart must be on or before rangeEnd')
  if (rule.endDate) parseCalendarDate(rule.endDate)
  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    throw new Error('Recurrence interval must be a positive integer')
  }

  const lower = rule.startDate > rangeStart ? rule.startDate : rangeStart
  const upper = rule.endDate && rule.endDate < rangeEnd ? rule.endDate : rangeEnd
  if (lower > upper) return []

  const dates: string[] = []
  const maxIterations = 20_000

  if (rule.kind === 'weekly' || rule.kind === 'every_n_weeks') {
    const stepDays = 7 * (rule.kind === 'weekly' ? 1 : rule.interval)
    let cursor = rule.anchorDate
    if (cursor < lower) {
      const gap = toEpochDay(lower) - toEpochDay(cursor)
      const jumps = Math.max(0, Math.floor(gap / stepDays))
      cursor = addCalendarDays(cursor, jumps * stepDays)
      while (cursor < lower) cursor = addCalendarDays(cursor, stepDays)
    }
    for (let i = 0; i < maxIterations && cursor <= upper; i += 1) {
      if (cursor >= rule.startDate) dates.push(cursor)
      cursor = addCalendarDays(cursor, stepDays)
    }
    return dates
  }

  if (rule.kind === 'monthly') {
    for (let index = 0; index < maxIterations; index += 1) {
      const cursor = addCalendarMonthsClamped(rule.anchorDate, index * rule.interval)
      if (cursor > upper) break
      if (cursor >= lower && cursor >= rule.startDate) dates.push(cursor)
    }
    return dates
  }

  if (rule.kind === 'yearly') {
    for (let index = 0; index < maxIterations; index += 1) {
      const cursor = addCalendarYearsClamped(rule.anchorDate, index * rule.interval)
      if (cursor > upper) break
      if (cursor >= lower && cursor >= rule.startDate) dates.push(cursor)
    }
    return dates
  }

  return dates
}
