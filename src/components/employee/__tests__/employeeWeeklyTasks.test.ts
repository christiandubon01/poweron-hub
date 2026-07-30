/**
 * Weekly task grouping / navigation logic (EMPLOYEE-WEEKLY-TASK-VIEW-1).
 *
 * Pure behavior only — no service calls, no DOM. Days come from the existing
 * employee-portal Monday–Sunday WeekRange convention.
 */

import { describe, expect, it, vi } from 'vitest'

// The week utilities live next to the portal's Supabase reads; only their pure
// date math is under test here.
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: vi.fn() }, from: vi.fn(), rpc: vi.fn() },
}))

const { getCurrentWeekRangeFromTenantDate, shiftWeekRange } = await import(
  '@/services/employeePortalService'
)
type EmployeeMyTask = import('@/services/employeeTaskAssignmentService').EmployeeMyTask

const {
  WEEK_DAY_COUNT,
  buildWeekDates,
  buildWeekDays,
  collectUnscheduledTasks,
  countTasksOutsideWeek,
  countWeekTasks,
  formatDayLabel,
  formatWeekRangeLabel,
  isTaskArchived,
  isUsableDayValue,
  partitionMyTasks,
  resolveSelectedDay,
  resolveSelectedTaskId,
  resolveTaskDay,
  sortArchivedTasks,
  weekContainsDay,
} = await import('../employeeWeeklyTasks')

// Monday 2026-07-27 → Sunday 2026-08-02
const WEEK = { startDate: '2026-07-27', endDate: '2026-08-02' }

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
    assigned_at: '2026-07-20T10:00:00.000Z',
    updated_at: '2026-07-20T10:00:00.000Z',
    can_complete: true,
    ...overrides,
  } as EmployeeMyTask
}

describe('week structure', () => {
  it('builds exactly seven consecutive days for the selected week', () => {
    const dates = buildWeekDates(WEEK)
    expect(dates).toHaveLength(WEEK_DAY_COUNT)
    expect(dates).toEqual([
      '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
      '2026-07-31', '2026-08-01', '2026-08-02',
    ])
  })

  it('always produces seven day entries even when the week has no tasks', () => {
    const days = buildWeekDays(WEEK, [])
    expect(days).toHaveLength(WEEK_DAY_COUNT)
    expect(days.every((day) => day.tasks.length === 0)).toBe(true)
    expect(countWeekTasks(days)).toBe(0)
  })

  it('starts the week on Monday, matching the existing portal convention', () => {
    const dates = buildWeekDates(getCurrentWeekRangeFromTenantDate())
    expect(dates).toHaveLength(WEEK_DAY_COUNT)
    const [y, m, d] = dates[0].split('-').map(Number)
    expect(new Date(y, m - 1, d).getDay()).toBe(1)
  })

  it('navigates to the previous and next week without changing the day count', () => {
    const previous = shiftWeekRange(WEEK, -1)
    const next = shiftWeekRange(WEEK, 1)
    expect(buildWeekDates(previous)[0]).toBe('2026-07-20')
    expect(buildWeekDates(next)[0]).toBe('2026-08-03')
    expect(buildWeekDates(previous)).toHaveLength(WEEK_DAY_COUNT)
    expect(buildWeekDates(next)).toHaveLength(WEEK_DAY_COUNT)
  })

  it('returns to the current week from any offset', () => {
    const current = getCurrentWeekRangeFromTenantDate()
    const wandered = shiftWeekRange(shiftWeekRange(current, -3), 1)
    expect(wandered.startDate).not.toBe(current.startDate)
    expect(getCurrentWeekRangeFromTenantDate().startDate).toBe(current.startDate)
  })

  it('reports week membership for a day', () => {
    expect(weekContainsDay(WEEK, '2026-07-30')).toBe(true)
    expect(weekContainsDay(WEEK, '2026-08-03')).toBe(false)
    expect(weekContainsDay(WEEK, 'not-a-date')).toBe(false)
  })

  it('renders a readable selected-week range label', () => {
    expect(formatWeekRangeLabel(WEEK)).toBe('Jul 27 – Aug 2, 2026')
  })

  it('labels each day with a weekday and date', () => {
    const label = formatDayLabel('2026-07-27')
    expect(label.weekday).toBe('Mon')
    expect(label.weekdayInitial).toBe('M')
    expect(label.dayNumber).toBe('27')
    expect(label.monthDay).toBe('Jul 27')
    expect(label.short).toBe('Mon, Jul 27')
  })
})

describe('focused task selection', () => {
  const active = [
    task({ id: 'a', due_date: '2026-07-27' }),
    task({ id: 'b', due_date: '2026-07-30' }),
    task({ id: 'c', due_date: '2026-07-30' }),
  ]

  it('keeps the selected task while it is still active', () => {
    expect(resolveSelectedTaskId(active, 'b')).toBe('b')
  })

  it('selects a different task on the same day without touching the others', () => {
    expect(resolveSelectedTaskId(active, 'c')).toBe('c')
    expect(resolveSelectedTaskId(active, 'b')).toBe('b')
  })

  it('starts with no selection and never invents one', () => {
    expect(resolveSelectedTaskId(active, null)).toBeNull()
    expect(resolveSelectedTaskId(active, undefined)).toBeNull()
    expect(resolveSelectedTaskId(active, '  ')).toBeNull()
    expect(resolveSelectedTaskId([], 'a')).toBeNull()
  })

  it('closes the detail panel once the selected task completes', () => {
    const rows = [task({ id: 'a', due_date: '2026-07-27' }), task({ id: 'b', due_date: '2026-07-28' })]
    const { active: stillActive } = partitionMyTasks(rows, new Set(['a']))
    expect(resolveSelectedTaskId(stillActive, 'a')).toBeNull()
    expect(resolveSelectedTaskId(stillActive, 'b')).toBe('b')
  })

  it('drops a selection that disappears from the payload', () => {
    expect(resolveSelectedTaskId(active, 'revoked')).toBeNull()
    const reduced = active.filter((t) => t.id !== 'b')
    expect(resolveSelectedTaskId(reduced, 'b')).toBeNull()
  })
})

describe('day assignment from the real due_date field', () => {
  it('places each task only under its own due date', () => {
    const days = buildWeekDays(WEEK, [
      task({ id: 'a', due_date: '2026-07-27' }),
      task({ id: 'b', due_date: '2026-07-30' }),
      task({ id: 'c', due_date: '2026-07-30' }),
    ])
    const byDate = Object.fromEntries(days.map((d) => [d.date, d.tasks.map((t) => t.id)]))
    expect(byDate['2026-07-27']).toEqual(['a'])
    expect(byDate['2026-07-30']).toEqual(['b', 'c'])
    expect(byDate['2026-07-28']).toEqual([])
    expect(countWeekTasks(days)).toBe(3)
  })

  it('never renders the same task under two days', () => {
    const days = buildWeekDays(WEEK, [task({ id: 'a', due_date: '2026-07-29' })])
    const appearances = days.flatMap((day) => day.tasks.map((t) => t.id))
    expect(appearances).toEqual(['a'])
    expect(new Set(appearances).size).toBe(appearances.length)
  })

  it('drops repeated assignment ids from the same payload', () => {
    const { active } = partitionMyTasks([
      task({ id: 'a', due_date: '2026-07-29' }),
      task({ id: 'a', due_date: '2026-07-29' }),
    ])
    expect(active.map((t) => t.id)).toEqual(['a'])
    expect(countWeekTasks(buildWeekDays(WEEK, active))).toBe(1)
  })

  it('excludes tasks scheduled outside the displayed week', () => {
    const active = [
      task({ id: 'inside', due_date: '2026-07-28' }),
      task({ id: 'before', due_date: '2026-07-26' }),
      task({ id: 'after', due_date: '2026-08-03' }),
    ]
    const days = buildWeekDays(WEEK, active)
    expect(days.flatMap((d) => d.tasks.map((t) => t.id))).toEqual(['inside'])
    expect(countTasksOutsideWeek(WEEK, active)).toBe(2)
    expect(collectUnscheduledTasks(active)).toEqual([])
  })

  it('keeps tasks with no usable day in the Unscheduled section instead of dropping them', () => {
    const active = [
      task({ id: 'none', due_date: null }),
      task({ id: 'blank', due_date: '   ' }),
      task({ id: 'bad', due_date: '2026-13-45' }),
      task({ id: 'dated', due_date: '2026-07-31' }),
    ]
    expect(collectUnscheduledTasks(active).map((t) => t.id)).toEqual(['none', 'blank', 'bad'])
    expect(buildWeekDays(WEEK, active).flatMap((d) => d.tasks.map((t) => t.id))).toEqual(['dated'])
  })

  it('validates day values strictly', () => {
    expect(isUsableDayValue('2026-07-27')).toBe(true)
    expect(isUsableDayValue('2026-02-30')).toBe(false)
    expect(isUsableDayValue('7/27/2026')).toBe(false)
    expect(isUsableDayValue(null)).toBe(false)
    expect(resolveTaskDay(task({ id: 'x', due_date: '2026-07-27' }))).toBe('2026-07-27')
    expect(resolveTaskDay(task({ id: 'x', due_date: null }))).toBeNull()
  })
})

describe('ordering stability', () => {
  it('preserves the backend order inside a day', () => {
    const active = ['t3', 't1', 't2'].map((id) => task({ id, due_date: '2026-07-28' }))
    const days = buildWeekDays(WEEK, active)
    expect(days.find((d) => d.date === '2026-07-28')!.tasks.map((t) => t.id)).toEqual(['t3', 't1', 't2'])
  })

  it('does not reorder a day after a status update changes a task to in progress', () => {
    const before = ['t3', 't1', 't2'].map((id) => task({ id, due_date: '2026-07-28' }))
    const after = before.map((t) => (t.id === 't1' ? { ...t, status: 'in_progress' as const } : t))
    const order = (rows: EmployeeMyTask[]) =>
      buildWeekDays(WEEK, rows).find((d) => d.date === '2026-07-28')!.tasks.map((t) => t.id)
    expect(order(after)).toEqual(order(before))
  })

  it('keeps the selected day when it is still inside the week and falls back predictably', () => {
    expect(resolveSelectedDay(WEEK, '2026-07-30', '2026-07-28')).toBe('2026-07-28')
    expect(resolveSelectedDay(WEEK, '2026-07-30', null)).toBe('2026-07-30')
    expect(resolveSelectedDay(WEEK, '2026-09-01', '2026-06-01')).toBe('2026-07-27')
    expect(resolveSelectedDay(shiftWeekRange(WEEK, 1), '2026-07-30', '2026-07-28')).toBe('2026-08-03')
  })
})

describe('active / archived partition', () => {
  it('routes completed tasks to Archived and everything else to Active', () => {
    const { active, archived } = partitionMyTasks([
      task({ id: 'a', status: 'assigned', due_date: '2026-07-27' }),
      task({ id: 'b', status: 'in_progress', due_date: '2026-07-28' }),
      task({ id: 'c', status: 'completed', due_date: '2026-07-29', completed_at: '2026-07-29T18:00:00.000Z' }),
    ])
    expect(active.map((t) => t.id)).toEqual(['a', 'b'])
    expect(archived.map((t) => t.id)).toEqual(['c'])
  })

  it('keeps completed tasks out of the weekly day columns', () => {
    const rows = [
      task({ id: 'open', due_date: '2026-07-27' }),
      task({ id: 'done', due_date: '2026-07-27', status: 'completed' }),
    ]
    const { active, archived } = partitionMyTasks(rows)
    const days = buildWeekDays(WEEK, active)
    expect(days.flatMap((d) => d.tasks.map((t) => t.id))).toEqual(['open'])
    expect(archived.map((t) => t.id)).toEqual(['done'])
  })

  it('moves a just-confirmed completion into Archived immediately and only once', () => {
    const rows = [task({ id: 'a', due_date: '2026-07-27' }), task({ id: 'b', due_date: '2026-07-28' })]
    const { active, archived } = partitionMyTasks(rows, new Set(['a']))
    expect(active.map((t) => t.id)).toEqual(['b'])
    expect(archived.map((t) => t.id)).toEqual(['a'])
    expect(buildWeekDays(WEEK, active).flatMap((d) => d.tasks.map((t) => t.id))).toEqual(['b'])
  })

  it('does not archive a task before its completion is confirmed', () => {
    const rows = [task({ id: 'a', due_date: '2026-07-27' })]
    const { active, archived } = partitionMyTasks(rows, new Set())
    expect(active.map((t) => t.id)).toEqual(['a'])
    expect(archived).toEqual([])
    expect(isTaskArchived(rows[0])).toBe(false)
  })

  it('sorts archived tasks most recently completed first', () => {
    const sorted = sortArchivedTasks([
      task({ id: 'older', status: 'completed', completed_at: '2026-07-20T12:00:00.000Z' }),
      task({ id: 'newest', status: 'completed', completed_at: '2026-07-29T12:00:00.000Z' }),
      task({ id: 'undated', status: 'completed', completed_at: null }),
      task({ id: 'middle', status: 'completed', completed_at: '2026-07-25T12:00:00.000Z' }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['newest', 'middle', 'older', 'undated'])
  })
})
