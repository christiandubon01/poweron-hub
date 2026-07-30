/**
 * Weekly time board date/label helpers (EMPLOYEE-MY-TIME-WEEK-1).
 *
 * Pure behavior only — no service calls, no DOM.
 * Uses the existing Monday-Sunday WeekRange convention.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: vi.fn() }, from: vi.fn(), rpc: vi.fn() },
}))

const {
  WEEK_TIME_DAY_COUNT,
  buildWeekTimeDates,
  formatWeekTimeDayLabel,
  formatWeekTimeBoardLabel,
  isTenantToday,
  resolveDefaultSelectedDate,
} = await import('../employeeWeeklyTime')

// Monday 2026-07-27 → Sunday 2026-08-02
const WEEK = { startDate: '2026-07-27', endDate: '2026-08-02' }

// ── Week structure ────────────────────────────────────────────────────────────

describe('week structure', () => {
  it('builds exactly seven consecutive dates for a week range', () => {
    const dates = buildWeekTimeDates(WEEK)
    expect(dates).toHaveLength(WEEK_TIME_DAY_COUNT)
    expect(dates).toEqual([
      '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
      '2026-07-31', '2026-08-01', '2026-08-02',
    ])
  })

  it('starts the week on Monday', () => {
    const dates = buildWeekTimeDates(WEEK)
    expect(dates).toHaveLength(WEEK_TIME_DAY_COUNT)
    const [y, m, d] = dates[0].split('-').map(Number)
    expect(new Date(y, m - 1, d).getDay()).toBe(1)
  })

  it('ends the week on Sunday', () => {
    const dates = buildWeekTimeDates(WEEK)
    const last = dates[dates.length - 1]
    const [y, m, d] = last.split('-').map(Number)
    expect(new Date(y, m - 1, d).getDay()).toBe(0)
  })

  it('crosses month boundaries correctly', () => {
    const crossMonth = { startDate: '2026-07-27', endDate: '2026-08-02' }
    const dates = buildWeekTimeDates(crossMonth)
    expect(dates[5]).toBe('2026-08-01')
    expect(dates[6]).toBe('2026-08-02')
    expect(dates).toHaveLength(WEEK_TIME_DAY_COUNT)
  })

  it('crosses year boundaries correctly', () => {
    const newYear = { startDate: '2025-12-29', endDate: '2026-01-04' }
    const dates = buildWeekTimeDates(newYear)
    expect(dates[0]).toBe('2025-12-29')
    expect(dates[3]).toBe('2026-01-01')
    expect(dates).toHaveLength(WEEK_TIME_DAY_COUNT)
  })
})

// ── Day labels ────────────────────────────────────────────────────────────────

describe('day labels', () => {
  it('labels Monday with the correct weekday fields', () => {
    const label = formatWeekTimeDayLabel('2026-07-27')
    expect(label.weekday).toBe('Mon')
    expect(label.weekdayFull).toBe('Monday')
    expect(label.weekdayInitial).toBe('M')
    expect(label.dayNumber).toBe('27')
    expect(label.iso).toBe('2026-07-27')
  })

  it('includes the numeric day and month-day label', () => {
    const label = formatWeekTimeDayLabel('2026-08-02')
    expect(label.dayNumber).toBe('2')
    expect(label.monthDay).toMatch(/Aug\s*2/)
  })

  it('provides a full combined label', () => {
    const label = formatWeekTimeDayLabel('2026-07-27')
    expect(label.full).toContain('Mon')
    expect(label.full).toContain('Jul')
    expect(label.full).toContain('27')
  })
})

// ── Board label ───────────────────────────────────────────────────────────────

describe('board label', () => {
  it('formats the week range as "Jul 27 – Aug 2, 2026"', () => {
    expect(formatWeekTimeBoardLabel(WEEK)).toBe('Jul 27 – Aug 2, 2026')
  })

  it('handles a same-month week', () => {
    const label = formatWeekTimeBoardLabel({ startDate: '2026-07-06', endDate: '2026-07-12' })
    expect(label).toContain('Jul')
    expect(label).toContain('2026')
  })

  it('handles year-crossing week', () => {
    const label = formatWeekTimeBoardLabel({ startDate: '2025-12-29', endDate: '2026-01-04' })
    expect(label).toContain('Dec')
    expect(label).toContain('Jan')
    expect(label).toContain('2026')
  })
})

// ── Today detection ───────────────────────────────────────────────────────────

describe('today detection', () => {
  it('matches when workDate equals tenantWorkDate', () => {
    expect(isTenantToday('2026-07-30', '2026-07-30')).toBe(true)
  })

  it('does not match when dates differ', () => {
    expect(isTenantToday('2026-07-29', '2026-07-30')).toBe(false)
    expect(isTenantToday('2026-07-31', '2026-07-30')).toBe(false)
  })
})

// ── Default selected date ─────────────────────────────────────────────────────

describe('resolveDefaultSelectedDate', () => {
  it('returns tenantWorkDate when it falls in the week', () => {
    expect(resolveDefaultSelectedDate(WEEK, '2026-07-30')).toBe('2026-07-30')
  })

  it('returns start date when tenantWorkDate is outside the week', () => {
    expect(resolveDefaultSelectedDate(WEEK, '2026-08-10')).toBe('2026-07-27')
    expect(resolveDefaultSelectedDate(WEEK, '2026-07-20')).toBe('2026-07-27')
  })

  it('includes the boundaries', () => {
    expect(resolveDefaultSelectedDate(WEEK, '2026-07-27')).toBe('2026-07-27')
    expect(resolveDefaultSelectedDate(WEEK, '2026-08-02')).toBe('2026-08-02')
  })
})
