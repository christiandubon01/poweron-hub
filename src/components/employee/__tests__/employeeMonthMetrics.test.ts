/**
 * Monthly calendar grid + metric aggregation logic
 * (EMPLOYEE-SCHEDULE-MONTH-VIEW-1).
 *
 * Pure behavior only - no service calls, no DOM. Week start is Monday, matching
 * the existing employee-portal convention.
 */

import { describe, expect, it, vi } from 'vitest'

// The tenant date helper lives next to the portal's Supabase reads; only its
// pure timezone math is used here.
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: vi.fn() }, from: vi.fn(), rpc: vi.fn() },
}))

const { getTenantWorkDate } = await import('@/services/employeeTimeService')

type ScheduleItem = import('@/services/employeeScheduleService').ScheduleItem
type EmployeeMyTimeDay = import('@/services/employeePortalService').EmployeeMyTimeDay
type EmployeeMyTask = import('@/services/employeeTaskAssignmentService').EmployeeMyTask

const {
  TENANT_TIMEZONE,
  WEEK_DAY_COUNT,
  addDaysToDay,
  aggregateMonthMetrics,
  buildMonthGrid,
  buildWeekdayLabels,
  findDayMetrics,
  formatMetricCount,
  formatMetricHours,
  formatMonthTitle,
  isSameMonth,
  isUsableDayValue,
  parseLocalDay,
  resolveSelectedDate,
  scheduleItemHours,
  shiftMonth,
  tenantDateKeyFromTimestamp,
} = await import('../employeeMonthMetrics')

function scheduleItem(overrides: Partial<ScheduleItem> & { id: string }): ScheduleItem {
  return {
    org_id: 'org-1',
    employee_profile_id: 'emp-1',
    work_date: '2026-07-15',
    start_time: null,
    end_time: null,
    estimated_minutes: null,
    assignment_id: null,
    work_package_id: null,
    work_package_name: 'Rough-in',
    project_id: null,
    project_name: 'Main Street',
    notes: null,
    status: 'scheduled',
    created_by: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as ScheduleItem
}

function timeDay(workDate: string, paidMinutes: number | null): EmployeeMyTimeDay {
  return {
    workDate,
    entry: null,
    punches: [],
    paidMinutes,
    lunchMinutes: null,
    status: paidMinutes == null ? 'none' : 'closed',
  } as EmployeeMyTimeDay
}

function task(overrides: Partial<EmployeeMyTask> & { id: string }): EmployeeMyTask {
  return {
    org_id: 'org-1',
    work_package_id: `wp-${overrides.id}`,
    work_package_name: `Package ${overrides.id}`,
    project_id: 'proj-1',
    project_name: 'Main Street',
    due_date: null,
    status: 'assigned',
    completion_notes: null,
    hours_spent: null,
    completed_at: null,
    assigned_at: '2026-07-01T10:00:00.000Z',
    updated_at: '2026-07-01T10:00:00.000Z',
    can_complete: true,
    ...overrides,
  } as EmployeeMyTask
}

function aggregate(overrides: Partial<Parameters<typeof aggregateMonthMetrics>[0]> = {}) {
  const grid = buildMonthGrid('2026-07-15')
  return aggregateMonthMetrics({
    visibleDates: grid.dates,
    monthAnchor: '2026-07-15',
    todayKey: '2026-07-15',
    scheduleItems: [],
    timeDays: [],
    tasks: [],
    ...overrides,
  })
}

describe('month grid', () => {
  it('titles the month and pads to whole Monday-to-Sunday weeks', () => {
    const grid = buildMonthGrid('2026-07-15')
    expect(formatMonthTitle('2026-07-15')).toBe('July 2026')
    expect(grid.monthStart).toBe('2026-07-01')
    expect(grid.monthEnd).toBe('2026-07-31')
    // Jul 1 2026 is a Wednesday, Jul 31 a Friday.
    expect(grid.visibleStart).toBe('2026-06-29')
    expect(grid.visibleEnd).toBe('2026-08-02')
    expect(grid.dates).toHaveLength(35)
    expect(grid.weekCount).toBe(5)
  })

  it('always produces whole weeks of seven days', () => {
    for (const anchor of [
      '2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15',
      '2026-05-15', '2026-06-15', '2026-08-15', '2026-11-15',
      '2027-02-15', '2024-02-15',
    ]) {
      const grid = buildMonthGrid(anchor)
      expect(grid.dates.length % WEEK_DAY_COUNT).toBe(0)
      expect(grid.weekCount).toBeGreaterThanOrEqual(4)
      expect(grid.weekCount).toBeLessThanOrEqual(6)
      // First visible day is a Monday, last is a Sunday.
      expect(parseLocalDay(grid.visibleStart)!.getDay()).toBe(1)
      expect(parseLocalDay(grid.visibleEnd)!.getDay()).toBe(0)
    }
  })

  it('produces a six-week grid when the month needs one', () => {
    // Aug 2026 starts on a Saturday and ends on a Monday.
    const grid = buildMonthGrid('2026-08-10')
    expect(grid.visibleStart).toBe('2026-07-27')
    expect(grid.visibleEnd).toBe('2026-09-06')
    expect(grid.dates).toHaveLength(42)
    expect(grid.weekCount).toBe(6)
  })

  it('includes leading and trailing adjacent-month dates as real dates', () => {
    const grid = buildMonthGrid('2026-07-15')
    expect(grid.dates[0]).toBe('2026-06-29')
    expect(grid.dates[grid.dates.length - 1]).toBe('2026-08-02')
    // No gaps: every consecutive pair is one day apart.
    for (let i = 1; i < grid.dates.length; i += 1) {
      expect(grid.dates[i]).toBe(addDaysToDay(grid.dates[i - 1], 1))
    }
  })

  it('identifies current-month versus adjacent-month dates', () => {
    const days = aggregate()
    expect(findDayMetrics(days, '2026-06-29')!.isCurrentMonth).toBe(false)
    expect(findDayMetrics(days, '2026-07-01')!.isCurrentMonth).toBe(true)
    expect(findDayMetrics(days, '2026-07-31')!.isCurrentMonth).toBe(true)
    expect(findDayMetrics(days, '2026-08-02')!.isCurrentMonth).toBe(false)
    expect(days.filter((d) => d.isCurrentMonth)).toHaveLength(31)
  })

  it('marks exactly one today when it is visible', () => {
    const days = aggregate()
    expect(days.filter((d) => d.isToday).map((d) => d.dateKey)).toEqual(['2026-07-15'])
  })

  it('orders weekday headers Monday first', () => {
    expect(buildWeekdayLabels()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  })

  it('navigates months without day-of-month overflow', () => {
    expect(shiftMonth('2026-07-15', -1)).toBe('2026-06-01')
    expect(shiftMonth('2026-07-15', 1)).toBe('2026-08-01')
    // Jan 31 â†’ February must not skip to March.
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-01')
    expect(formatMonthTitle(shiftMonth('2026-01-31', 1))).toBe('February 2026')
    // Year boundaries.
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-01')
    expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-01')
  })

  it('returns to the current tenant month from any offset', () => {
    const todayKey = getTenantWorkDate()
    const wandered = shiftMonth(shiftMonth(todayKey, -3), 1)
    expect(isSameMonth(todayKey, wandered)).toBe(false)
    expect(isSameMonth(todayKey, todayKey)).toBe(true)
    expect(buildMonthGrid(todayKey).dates).toContain(todayKey)
  })

  it('keeps a valid selected day across month changes', () => {
    const july = buildMonthGrid('2026-07-15')
    expect(resolveSelectedDate(july, '2026-07-15', '2026-07-20')).toBe('2026-07-20')
    expect(resolveSelectedDate(july, '2026-07-15', null)).toBe('2026-07-15')
    // Selection outside the new grid falls back to the month start.
    expect(resolveSelectedDate(buildMonthGrid('2026-10-01'), '2026-07-15', '2026-07-20')).toBe('2026-10-01')
  })
})

describe('local date handling', () => {
  it('never shifts a YYYY-MM-DD value into the previous day', () => {
    const parsed = parseLocalDay('2026-07-01')!
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(6)
    expect(parsed.getDate()).toBe(1)
    expect(buildMonthGrid('2026-07-01').monthStart).toBe('2026-07-01')
  })

  it('validates day values strictly', () => {
    expect(isUsableDayValue('2026-07-27')).toBe(true)
    expect(isUsableDayValue('2026-02-30')).toBe(false)
    expect(isUsableDayValue('7/27/2026')).toBe(false)
    expect(isUsableDayValue(null)).toBe(false)
    expect(parseLocalDay('nope')).toBeNull()
  })

  it('uses the same tenant timezone as the clock service', () => {
    expect(TENANT_TIMEZONE).toBe('America/Los_Angeles')
    // Drift guard: our timestampâ†’date conversion must agree with the Clock's
    // authoritative work date for the current instant.
    expect(tenantDateKeyFromTimestamp(new Date().toISOString())).toBe(getTenantWorkDate())
  })

  it('maps an absolute timestamp to its tenant-local calendar date', () => {
    // 02:00Z on Jul 1 is still Jun 30 in Pacific time.
    expect(tenantDateKeyFromTimestamp('2026-07-01T02:00:00.000Z')).toBe('2026-06-30')
    // 18:00Z on Jul 1 is Jul 1 in Pacific time.
    expect(tenantDateKeyFromTimestamp('2026-07-01T18:00:00.000Z')).toBe('2026-07-01')
    expect(tenantDateKeyFromTimestamp(null)).toBeNull()
    expect(tenantDateKeyFromTimestamp('not-a-timestamp')).toBeNull()
  })
})

describe('scheduled hours', () => {
  it('uses start and end time when present', () => {
    expect(scheduleItemHours(scheduleItem({ id: 's1', start_time: '08:00', end_time: '16:00' }))).toBe(8)
    expect(scheduleItemHours(scheduleItem({ id: 's2', start_time: '08:00:00', end_time: '15:30:00' }))).toBe(7.5)
    expect(scheduleItemHours(scheduleItem({ id: 's3', start_time: '08:00', end_time: '08:15' }))).toBe(0.25)
  })

  it('treats an end before the start as an overnight shift', () => {
    // 22:00 â†’ 06:00 is eight hours across midnight, not negative.
    expect(scheduleItemHours(scheduleItem({ id: 's1', start_time: '22:00', end_time: '06:00' }))).toBe(8)
  })

  it('falls back to estimated_minutes when times are missing', () => {
    expect(scheduleItemHours(scheduleItem({ id: 's1', estimated_minutes: 240 }))).toBe(4)
    expect(scheduleItemHours(scheduleItem({ id: 's2', estimated_minutes: 90 }))).toBe(1.5)
    // Times win over the estimate.
    expect(scheduleItemHours(scheduleItem({
      id: 's3', start_time: '08:00', end_time: '10:00', estimated_minutes: 600,
    }))).toBe(2)
  })

  it('contributes nothing for cancelled, empty or malformed rows', () => {
    expect(scheduleItemHours(scheduleItem({ id: 's1', status: 'cancelled', start_time: '08:00', end_time: '16:00' }))).toBe(0)
    expect(scheduleItemHours(scheduleItem({ id: 's2' }))).toBe(0)
    expect(scheduleItemHours(scheduleItem({ id: 's3', estimated_minutes: -60 }))).toBe(0)
    expect(scheduleItemHours(scheduleItem({ id: 's4', start_time: '99:99', end_time: '10:00' }))).toBe(0)
    expect(scheduleItemHours(null)).toBe(0)
  })

  it('sums multiple shifts on the same local date and keeps other days at zero', () => {
    const days = aggregate({
      scheduleItems: [
        scheduleItem({ id: 's1', work_date: '2026-07-15', start_time: '08:00', end_time: '12:00' }),
        scheduleItem({ id: 's2', work_date: '2026-07-15', start_time: '13:00', end_time: '16:30' }),
        scheduleItem({ id: 's3', work_date: '2026-07-16', estimated_minutes: 120 }),
      ],
    })
    expect(findDayMetrics(days, '2026-07-15')!.scheduledHours).toBe(7.5)
    expect(findDayMetrics(days, '2026-07-16')!.scheduledHours).toBe(2)
    expect(findDayMetrics(days, '2026-07-17')!.scheduledHours).toBe(0)
  })

  it('never counts the same schedule row twice', () => {
    const row = scheduleItem({ id: 'dup', work_date: '2026-07-15', start_time: '08:00', end_time: '16:00' })
    const days = aggregate({ scheduleItems: [row, { ...row }] })
    expect(findDayMetrics(days, '2026-07-15')!.scheduledHours).toBe(8)
  })
})

describe('worked hours', () => {
  it('uses the authoritative paid minutes My Time displays', () => {
    const days = aggregate({
      timeDays: [
        timeDay('2026-07-15', 450),
        timeDay('2026-07-16', 480),
        timeDay('2026-07-17', null),
      ],
    })
    expect(findDayMetrics(days, '2026-07-15')!.workedHours).toBe(7.5)
    expect(findDayMetrics(days, '2026-07-16')!.workedHours).toBe(8)
    expect(findDayMetrics(days, '2026-07-17')!.workedHours).toBe(0)
  })

  it('never double-counts a repeated work date', () => {
    const days = aggregate({ timeDays: [timeDay('2026-07-15', 480), timeDay('2026-07-15', 480)] })
    expect(findDayMetrics(days, '2026-07-15')!.workedHours).toBe(8)
  })

  it('keeps fractional precision without floating-point noise', () => {
    const days = aggregate({ timeDays: [timeDay('2026-07-15', 455)] })
    // 455 minutes is 7.5833... hours, rounded to two decimals.
    expect(findDayMetrics(days, '2026-07-15')!.workedHours).toBe(7.58)
  })
})

describe('task counts', () => {
  it('counts open assignments on their due date', () => {
    const days = aggregate({
      tasks: [
        task({ id: 't1', due_date: '2026-07-15', status: 'assigned' }),
        task({ id: 't2', due_date: '2026-07-15', status: 'in_progress' }),
        task({ id: 't3', due_date: '2026-07-16', status: 'assigned' }),
      ],
    })
    expect(findDayMetrics(days, '2026-07-15')!.assignedTaskCount).toBe(2)
    expect(findDayMetrics(days, '2026-07-16')!.assignedTaskCount).toBe(1)
    expect(findDayMetrics(days, '2026-07-17')!.assignedTaskCount).toBe(0)
  })

  it('counts completions on the real completed_at date, not the due date', () => {
    const days = aggregate({
      tasks: [
        task({
          id: 'late',
          due_date: '2026-07-10',
          status: 'completed',
          completed_at: '2026-07-20T18:00:00.000Z',
        }),
      ],
    })
    // Completed late: counted on the 20th, and no longer assigned on the 10th.
    expect(findDayMetrics(days, '2026-07-20')!.completedTaskCount).toBe(1)
    expect(findDayMetrics(days, '2026-07-10')!.completedTaskCount).toBe(0)
    expect(findDayMetrics(days, '2026-07-10')!.assignedTaskCount).toBe(0)
    expect(findDayMetrics(days, '2026-07-20')!.assignedTaskCount).toBe(0)
  })

  it('places a completion on the tenant-local day across the UTC boundary', () => {
    const days = aggregate({
      tasks: [
        task({ id: 'evening', status: 'completed', completed_at: '2026-07-16T04:30:00.000Z' }),
      ],
    })
    // 04:30Z on the 16th is 21:30 on the 15th in Pacific time.
    expect(findDayMetrics(days, '2026-07-15')!.completedTaskCount).toBe(1)
    expect(findDayMetrics(days, '2026-07-16')!.completedTaskCount).toBe(0)
  })

  it('never counts one task twice, even from a duplicated payload', () => {
    const open = task({ id: 'dup', due_date: '2026-07-15', status: 'assigned' })
    const done = task({ id: 'done', status: 'completed', completed_at: '2026-07-15T18:00:00.000Z' })
    const days = aggregate({ tasks: [open, { ...open }, done, { ...done }] })
    expect(findDayMetrics(days, '2026-07-15')!.assignedTaskCount).toBe(1)
    expect(findDayMetrics(days, '2026-07-15')!.completedTaskCount).toBe(1)
  })

  it('ignores a completion with no confirmed timestamp', () => {
    const days = aggregate({
      tasks: [task({ id: 'optimistic', due_date: '2026-07-15', status: 'completed', completed_at: null })],
    })
    const total = days.reduce((sum, d) => sum + d.completedTaskCount, 0)
    expect(total).toBe(0)
    expect(findDayMetrics(days, '2026-07-15')!.assignedTaskCount).toBe(0)
  })

  it('does not let a null or malformed due date land on a wrong day', () => {
    const days = aggregate({
      tasks: [
        task({ id: 'none', due_date: null, status: 'assigned' }),
        task({ id: 'blank', due_date: '   ', status: 'assigned' }),
        task({ id: 'bad', due_date: '2026-13-45', status: 'assigned' }),
      ],
    })
    expect(days.reduce((sum, d) => sum + d.assignedTaskCount, 0)).toBe(0)
    expect(findDayMetrics(days, '2026-07-15')!.assignedTaskCount).toBe(0)
  })
})

describe('aggregation safety', () => {
  it('returns exactly one record per visible date, in grid order', () => {
    const grid = buildMonthGrid('2026-07-15')
    const days = aggregate()
    expect(days).toHaveLength(grid.dates.length)
    expect(days.map((d) => d.dateKey)).toEqual([...grid.dates])
    expect(new Set(days.map((d) => d.dateKey)).size).toBe(days.length)
  })

  it('handles empty inputs with all-zero metrics', () => {
    const days = aggregate()
    expect(days.every((d) =>
      d.scheduledHours === 0 &&
      d.workedHours === 0 &&
      d.assignedTaskCount === 0 &&
      d.completedTaskCount === 0,
    )).toBe(true)
  })

  it('never emits NaN, undefined, negative or non-finite metrics', () => {
    const days = aggregate({
      scheduleItems: [scheduleItem({ id: 's1', estimated_minutes: Number.NaN as never })],
      timeDays: [timeDay('2026-07-15', Number.NaN as never), timeDay('2026-07-16', -30)],
      tasks: [task({ id: 't1', due_date: '2026-07-15' })],
    })
    for (const day of days) {
      for (const value of [day.scheduledHours, day.workedHours, day.assignedTaskCount, day.completedTaskCount]) {
        expect(Number.isFinite(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(Object.is(value, -0)).toBe(false)
        expect(String(value)).not.toMatch(/NaN|Infinity|undefined|null/)
      }
    }
  })

  it('tolerates malformed collections without throwing', () => {
    expect(() => aggregate({ scheduleItems: [null as never], tasks: [null as never], timeDays: [null as never] })).not.toThrow()
    expect(() => aggregateMonthMetrics({
      visibleDates: ['not-a-date', '2026-07-15'],
      monthAnchor: '2026-07-15',
      todayKey: '2026-07-15',
      scheduleItems: [],
      timeDays: [],
      tasks: [],
    })).not.toThrow()
    // Unusable dates are dropped rather than rendered.
    expect(aggregateMonthMetrics({
      visibleDates: ['not-a-date', '2026-07-15'],
      monthAnchor: '2026-07-15',
      todayKey: '2026-07-15',
      scheduleItems: [],
      timeDays: [],
      tasks: [],
    }).map((d) => d.dateKey)).toEqual(['2026-07-15'])
  })
})

describe('metric formatting', () => {
  it('formats whole and fractional hours compactly', () => {
    expect(formatMetricHours(8)).toBe('8h')
    expect(formatMetricHours(7.5)).toBe('7.5h')
    expect(formatMetricHours(0.25)).toBe('0.25h')
    expect(formatMetricHours(10)).toBe('10h')
    expect(formatMetricHours(7.58)).toBe('7.58h')
    // No 8.00 padding.
    expect(formatMetricHours(8)).not.toContain('.')
  })

  it('formats zero and invalid hours as a readable zero', () => {
    for (const input of [0, -0, -5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, 'abc']) {
      expect(formatMetricHours(input)).toBe('0h')
    }
  })

  it('formats task counts as integers', () => {
    expect(formatMetricCount(3)).toBe('3')
    expect(formatMetricCount(0)).toBe('0')
    for (const input of [-2, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(formatMetricCount(input)).toBe('0')
    }
  })
})
