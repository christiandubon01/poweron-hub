import { describe, expect, it } from 'vitest'
import {
  adminAssignmentWeekdayLabels,
  buildAdminAssignmentMonth,
  filterAdminAssignments,
  getAdminAssignmentWeek,
  groupAdminAssignmentsByDueDate,
  shiftAdminAssignmentMonth,
  shiftAdminAssignmentWeek,
} from '../adminAssignmentCalendar'

const assignment = (
  id: string,
  due_date: string | null,
  status: 'assigned' | 'in_progress' | 'completed' = 'assigned',
) => ({
  id,
  due_date,
  status,
  assigned_at: `2026-07-${id.padStart(2, '0')}T10:00:00.000Z`,
})

describe('admin assignment Week calendar', () => {
  it('defaults to the Monday-Sunday week and navigates by whole weeks', () => {
    const week = getAdminAssignmentWeek('2026-07-30')
    expect(week).toEqual({
      startDate: '2026-07-27',
      endDate: '2026-08-02',
      dates: [
        '2026-07-27',
        '2026-07-28',
        '2026-07-29',
        '2026-07-30',
        '2026-07-31',
        '2026-08-01',
        '2026-08-02',
      ],
    })
    expect(adminAssignmentWeekdayLabels()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(shiftAdminAssignmentWeek(week, -1).startDate).toBe('2026-07-20')
    expect(shiftAdminAssignmentWeek(week, 1).startDate).toBe('2026-08-03')
  })

  it('groups by real due_date, keeps unscheduled rows, and deduplicates stable IDs', () => {
    const duplicate = assignment('1', '2026-07-29')
    const grouped = groupAdminAssignmentsByDueDate([
      duplicate,
      duplicate,
      assignment('2', null),
      assignment('3', ''),
      assignment('4', '2026-13-40'),
      assignment('5', '2026-07-29', 'completed'),
    ])
    expect(grouped.byDate.get('2026-07-29')?.map((row) => row.id)).toEqual(['1', '5'])
    expect(grouped.unscheduled.map((row) => row.id)).toEqual(['2', '3', '4'])
  })

  it('moves a card immediately when the immutable row is replaced with a new due date', () => {
    const before = groupAdminAssignmentsByDueDate([assignment('1', '2026-07-29')])
    const after = groupAdminAssignmentsByDueDate([assignment('1', '2026-07-31')])
    expect(before.byDate.get('2026-07-29')).toHaveLength(1)
    expect(after.byDate.get('2026-07-29')).toBeUndefined()
    expect(after.byDate.get('2026-07-31')?.[0].id).toBe('1')
  })

  it('defines Pending / Active as every non-completed status', () => {
    const rows = [
      assignment('1', '2026-07-27', 'assigned'),
      assignment('2', '2026-07-28', 'in_progress'),
      assignment('3', '2026-07-29', 'completed'),
    ]
    expect(filterAdminAssignments(rows, 'all')).toHaveLength(3)
    expect(filterAdminAssignments(rows, 'pending').map((row) => row.id)).toEqual(['1', '2'])
    expect(filterAdminAssignments(rows, 'completed').map((row) => row.id)).toEqual(['3'])
  })
})

describe('admin assignment Month calendar', () => {
  it('builds a complete five/six-week Monday-first grid with adjacent-month dates', () => {
    const july = buildAdminAssignmentMonth('2026-07-15')
    expect(july.visibleStart).toBe('2026-06-29')
    expect(july.visibleEnd).toBe('2026-08-02')
    expect(july.dates).toHaveLength(35)
    expect(july.weekCount).toBe(5)

    const august = buildAdminAssignmentMonth('2026-08-15')
    expect(august.dates).toHaveLength(42)
    expect(august.visibleStart).toBe('2026-07-27')
    expect(august.visibleEnd).toBe('2026-09-06')
  })

  it('does not collapse a four-row February and navigates without day overflow', () => {
    const february = buildAdminAssignmentMonth('2021-02-14')
    expect(february.dates).toHaveLength(35)
    expect(february.visibleStart).toBe('2021-02-01')
    expect(february.visibleEnd).toBe('2021-03-07')
    expect(shiftAdminAssignmentMonth('2026-01-31', 1)).toBe('2026-02-01')
  })
})
