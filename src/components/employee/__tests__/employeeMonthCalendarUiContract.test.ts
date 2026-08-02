/**
 * Employee monthly schedule calendar UI contract
 * (EMPLOYEE-SCHEDULE-MONTH-VIEW-1).
 *
 * Source-level contract in the existing house style: the vitest environment is
 * node with no DOM renderer, so these assertions pin the rendered structure,
 * data-loading shape and class contract. Grid and metric behavior are covered by
 * real unit tests in employeeMonthMetrics.test.ts.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const employeeDir = join(process.cwd(), 'src/components/employee')
const read = (name: string) => readFileSync(join(employeeDir, name), 'utf8')

const panel = read('EmployeeSchedulePanel.tsx')
const calendar = read('EmployeeMonthCalendar.tsx')
const logic = read('employeeMonthMetrics.ts')
const portal = read('EmployeePortal.tsx')
const scheduleService = readFileSync(
  join(process.cwd(), 'src/services/employeeScheduleService.ts'),
  'utf8',
)

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

const METRIC_LABELS = ['Hours Scheduled', 'Hours Worked', 'Tasks Assigned', 'Tasks Completed']

describe('reuse of existing data paths', () => {
  it('coordinates the existing schedule, My Time and task services only', () => {
    expect(panel).toContain("from '@/services/employeeScheduleService'")
    expect(panel).toContain("from '@/services/employeePortalService'")
    expect(panel).toContain("from '@/services/employeeTaskAssignmentService'")
    expect(panel).toContain("from '@/services/employeeTimeService'")
    expect(panel).toContain('getMyScheduleRange(')
    expect(panel).toContain('getMyTimeSummary(')
    expect(panel).toContain('getMyEmployeeTasks()')
    // Worked hours are never recomputed from punches here.
    expect(panel).not.toContain('time_punch_events')
    expect(panel).not.toContain('record_time_punch')
    expect(panel).not.toContain('recordTimePunch')
    expect(logic).not.toContain('punches.reduce')
  })

  it('adds no portal route, calendar system, timeclock or parallel data source', () => {
    const files = readdirSync(employeeDir)
    expect(files).toContain('EmployeeSchedulePanel.tsx')
    expect(files).toContain('EmployeeMonthCalendar.tsx')
    // The pure helper is deliberately NOT named employeeMonthCalendar.ts: a name
    // differing from the .tsx only in casing breaks module resolution on
    // case-insensitive filesystems.
    expect(files).toContain('employeeMonthMetrics.ts')
    expect(files).not.toContain('employeeMonthCalendar.ts')
    expect(files.filter((name) => /SchedulePage|SchedulePortal|Portal2|Calendar2|MonthDashboard|TimeClock2/i.test(name))).toEqual([])
    expect(occurrences(portal, '<EmployeeSchedulePanel />')).toBe(1)
    expect(panel).not.toContain('createBrowserRouter')
    expect(panel).not.toContain('<Route')
    // No new table reads from the presentation layers.
    for (const source of [calendar, logic]) {
      expect(source).not.toContain('@/lib/supabase')
      expect(source).not.toContain('supabase.from')
      expect(source).not.toContain('supabase.rpc')
    }
  })

  it('keeps the presentation and aggregation layers free of service calls', () => {
    for (const source of [calendar, logic]) {
      expect(source).not.toContain('getMyScheduleRange(')
      expect(source).not.toContain('getMyTimeSummary(')
      expect(source).not.toContain('getMyEmployeeTasks(')
      expect(source).not.toContain('updateMyScheduleStatus(')
      expect(source).not.toContain('useEffect')
      expect(source).not.toContain('fetch(')
    }
  })

  it('reads the whole visible grid once per data domain, never per day', () => {
    expect(panel).toContain('getMyScheduleRange(visibleStart, visibleEnd)')
    expect(panel).toContain('getMyTimeSummary(visibleStart, visibleEnd)')
    expect(panel).toContain('await Promise.all([')
    // Exactly one call site each — no per-date loop.
    expect(occurrences(panel, 'getMyScheduleRange(')).toBe(2)
    expect(occurrences(panel, 'getMyTimeSummary(')).toBe(2)
    expect(occurrences(panel, 'getMyEmployeeTasks()')).toBe(2)
    expect(panel).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*getMy(ScheduleRange|TimeSummary)/)
    expect(panel).not.toMatch(/\.map\([^)]*=>\s*getMy(ScheduleRange|TimeSummary)/)
    expect(panel).not.toContain('getMySchedule(')
  })

  it('adds the schedule range read as a read-only RLS-scoped extension', () => {
    expect(scheduleService).toContain('export async function getMyScheduleRange(')
    expect(scheduleService).toContain('es_employee_select_own')
    const range = scheduleService.slice(
      scheduleService.indexOf('export async function getMyScheduleRange('),
      scheduleService.indexOf('export async function updateMyScheduleStatus('),
    )
    // SELECT only: no insert/update/delete, and no owner-org widening.
    expect(range).toContain(".select('*')")
    expect(range).not.toContain('.insert(')
    expect(range).not.toContain('.update(')
    expect(range).not.toContain('.delete(')
    expect(range).not.toContain('getOwnerOrgId')
    expect(range).toContain("gte('work_date'")
    expect(range).toContain("lte('work_date'")
  })
})

describe('calendar header and legend', () => {
  it('offers previous month, Today and next month', () => {
    expect(calendar).toContain('aria-label="Previous month"')
    expect(calendar).toContain('aria-label="Next month"')
    expect(calendar).toContain('onClick={onToday}')
    expect(calendar).toContain('{formatMonthTitle(monthAnchor)}')
    expect(panel).toContain('onPreviousMonth={() => goToMonth(shiftMonth(monthAnchor, -1))}')
    expect(panel).toContain('onNextMonth={() => goToMonth(shiftMonth(monthAnchor, 1))}')
    expect(panel).toContain('onToday={() => goToMonth(getTenantWorkDate())}')
  })

  it('renders the month and year as a large centered heading', () => {
    expect(calendar).toMatch(/<h3 className="text-lg sm:text-xl font-bold text-gray-900 truncate">/)
    expect(calendar).toContain('text-sm font-medium text-gray-500')
    expect(calendar).toContain("{isCurrentMonth ? 'This month' : 'Selected month'}")
  })

  it('shows a four-item legend as a compact matrix with complete names', () => {
    expect(calendar).toContain('export function EmployeeMonthLegend')
    expect(calendar).toContain('aria-label="Calendar metric legend"')
    // 2x2 matrix on desktop.
    expect(calendar).toContain('grid grid-cols-2 gap-x-4 gap-y-1.5')
    for (const label of METRIC_LABELS) {
      expect(calendar).toContain(label)
    }
    // Driven by the single ordered metric table, so the legend cannot drift.
    expect(calendar).toContain('{MONTH_METRICS.map((metric) => (')
    expect(calendar).toContain('{metric.label}')
  })

  it('places the legend in the upper-right on desktop and below the heading otherwise', () => {
    expect(calendar).toContain('lg:flex-row lg:items-center lg:justify-between')
    expect(calendar).toContain('lg:flex-shrink-0 border-t border-gray-100 pt-3 lg:border-t-0 lg:pt-0')
    expect(calendar.indexOf('<EmployeeMonthLegend />')).toBeGreaterThan(calendar.indexOf('{formatMonthTitle(monthAnchor)}'))
  })
})

describe('four color-coded metrics', () => {
  it('defines exactly the four required metrics in a fixed order', () => {
    expect(calendar).toContain('export const MONTH_METRICS')
    const table = calendar.slice(
      calendar.indexOf('export const MONTH_METRICS'),
      calendar.indexOf('] as const'),
    )
    expect(table).toContain("key: 'scheduledHours'")
    expect(table).toContain("key: 'workedHours'")
    expect(table).toContain("key: 'assignedTaskCount'")
    expect(table).toContain("key: 'completedTaskCount'")
    for (const label of METRIC_LABELS) {
      expect(occurrences(table, label)).toBe(1)
    }
    // Order: Scheduled, Worked, Assigned, Completed.
    expect(table.indexOf('Hours Scheduled')).toBeLessThan(table.indexOf('Hours Worked'))
    expect(table.indexOf('Hours Worked')).toBeLessThan(table.indexOf('Tasks Assigned'))
    expect(table.indexOf('Tasks Assigned')).toBeLessThan(table.indexOf('Tasks Completed'))
  })

  it('gives each metric a distinct semantic color token', () => {
    const table = calendar.slice(
      calendar.indexOf('export const MONTH_METRICS'),
      calendar.indexOf('] as const'),
    )
    expect(table).toContain('bg-blue-500')
    expect(table).toContain('bg-teal-500')
    expect(table).toContain('bg-amber-500')
    expect(table).toContain('bg-purple-500')
    expect(table).toContain('text-blue-700')
    expect(table).toContain('text-teal-700')
    expect(table).toContain('text-amber-700')
    expect(table).toContain('text-purple-700')
    // Four distinct marker colors, one per metric.
    const markers = ['bg-blue-500', 'bg-teal-500', 'bg-amber-500', 'bg-purple-500']
    expect(new Set(markers).size).toBe(4)
    for (const marker of markers) expect(occurrences(table, marker)).toBe(1)
  })

  it('never relies on color alone', () => {
    // Every marker is decorative; the text label carries the meaning.
    expect(occurrences(calendar, 'aria-hidden="true"')).toBeGreaterThanOrEqual(3)
    expect(calendar).toContain('{metric.shortLabel}')
    expect(calendar).toContain('{metric.label}')
    // Compact cells hide the label visually but keep it for assistive tech.
    expect(calendar).toContain("compact ? 'sr-only' : ''")
    // Each day button announces all four metrics by name.
    expect(calendar).toContain('`${metric.label} ${formatMetric(metric.key, day)}`')
  })

  it('renders all four rows in every day, including zeros', () => {
    expect(calendar).toContain('function MetricRows')
    expect(calendar).toContain('{MONTH_METRICS.map((metric) => {')
    // No conditional that would drop a zero metric and change the cell shape.
    expect(calendar).not.toMatch(/\{[^}]*!==\s*0\s*&&\s*<dt/)
    expect(calendar).not.toContain('.filter((metric)')
    // Zeros are quieter, not absent.
    expect(calendar).toContain('const zero = isZero(metric.key, day)')
    expect(calendar).toContain("zero ? metric.zero : metric.value")
  })

  it('formats hours and counts through the shared safe formatters', () => {
    expect(calendar).toContain('formatMetricHours(day[key])')
    expect(calendar).toContain('formatMetricCount(day[key])')
    expect(logic).toContain('export function formatMetricHours')
    expect(logic).toContain('export function formatMetricCount')
    // No ad-hoc division or toFixed in the view.
    expect(calendar).not.toContain('/ 60')
    expect(calendar).not.toContain('toFixed(')
  })
})

describe('full-width month grid', () => {
  it('uses seven equal columns at full portal width on desktop', () => {
    expect(calendar).toContain('hidden lg:grid lg:grid-cols-7')
    expect(calendar).toContain('grid grid-cols-7 gap-1 lg:hidden')
    // EMPLOYEE-CLOCK-WORKSPACE-1: all four tabs are always-wide — no conditional.
    expect(portal).toContain("activeSection === 'schedule'")
    expect(portal).toContain('max-w-lg lg:max-w-[1680px]')
  })

  it('renders a Monday-first weekday header row', () => {
    expect(calendar).toContain('buildWeekdayLabels()')
    expect(calendar).toContain('weekdayLabels.map((label)')
    expect(logic).toContain('Monday-first weekday headers')
    expect(logic).not.toContain('weekStartsOn')
  })

  it('uses larger, readable weekday and date typography', () => {
    expect(calendar).toContain('text-sm lg:text-base font-bold text-gray-700')
    expect(calendar).toContain('text-sm font-bold tabular-nums')
    expect(calendar).not.toContain('text-[9px]')
    expect(calendar).not.toContain('text-gray-300')
  })

  it('distinguishes today and adjacent-month days beyond color', () => {
    expect(calendar).toContain("aria-current={day.isToday ? 'date' : undefined}")
    expect(calendar).toContain('Today')
    expect(calendar).toContain('day.isCurrentMonth')
    // Adjacent-month cells are muted but still show a real date.
    expect(calendar).toContain('bg-gray-50/70')
    expect(calendar).toContain("day.isCurrentMonth ? '' : 'opacity-60'")
    expect(calendar).toContain('{formatDayNumber(day.dateKey)}')
  })

  it('has no horizontal overflow contract', () => {
    expect(calendar).toContain('min-w-0')
    expect(calendar).not.toContain('overflow-x-scroll')
    expect(calendar).not.toContain('overflow-x-auto')
    expect(calendar).not.toContain('min-w-max')
    expect(calendar).not.toContain('w-[')
  })
})

describe('month navigation and state safety', () => {
  it('derives the visible grid from the month anchor and reloads on change', () => {
    expect(panel).toContain('const grid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor])')
    expect(panel).toContain('void load(grid.visibleStart, grid.visibleEnd)')
    expect(panel).toContain('}, [grid.visibleStart, grid.visibleEnd, load])')
  })

  it('ignores a superseded month response', () => {
    expect(panel).toContain('const loadSeq = useRef(0)')
    expect(panel).toContain('if (loadSeq.current !== seq) return')
    const load = panel.slice(panel.indexOf('const load = useCallback'), panel.indexOf('useEffect(()'))
    // The guard runs before any state write.
    expect(load.indexOf('if (loadSeq.current !== seq) return')).toBeLessThan(load.indexOf('setScheduleItems('))
  })

  it('uses the tenant work date for today and the initial month', () => {
    expect(panel).toContain('getTenantWorkDate()')
    expect(panel).toContain('const isCurrentMonth = isSameMonth(today, monthAnchor)')
    expect(panel).not.toContain('new Date().toISOString().slice(0, 10)')
    expect(panel).not.toContain('todayIso')
  })

  it('keeps a valid selected day when the month changes', () => {
    expect(panel).toContain('resolveSelectedDate(buildMonthGrid(nextAnchor), today, current)')
    expect(logic).toContain('export function resolveSelectedDate')
  })
})

describe('loading, empty and error states', () => {
  it('keeps the calendar frame mounted while a month loads', () => {
    expect(calendar).toContain('{loading ? (')
    expect(calendar).toContain('Loading month')
    expect(calendar).toContain('role="status"')
    // Overlay, not a replacement: the grid still renders underneath.
    expect(calendar).toContain('absolute inset-0')
    expect(calendar.indexOf('lg:grid-cols-7')).toBeGreaterThan(calendar.indexOf('Loading month'))
  })

  it('shows one safe error banner without raw database detail', () => {
    expect(calendar).toContain('role="alert"')
    expect(occurrences(calendar, 'role="alert"')).toBe(1)
    expect(panel).toContain('function safeScheduleError')
    expect(panel).toContain("return 'Could not load this month. Try again.'")
    expect(panel).toContain('errorMessage={error}')
    // Month navigation stays available: the header renders before the banner.
    expect(calendar.indexOf('aria-label="Previous month"')).toBeLessThan(calendar.indexOf('role="alert"'))
  })

  it('drops stale values instead of showing them under a failed month', () => {
    const load = panel.slice(panel.indexOf('const load = useCallback'), panel.indexOf('useEffect(()'))
    // The failure branch clears all three domains before reporting, and returns
    // before any success assignment can paint the previous month's values.
    const failure = load.slice(
      load.indexOf('if (!scheduleRes.success'),
      load.indexOf('setScheduleItems(scheduleRes.data)'),
    )
    expect(failure).toContain('setScheduleItems([])')
    expect(failure).toContain('setTimeDays([])')
    expect(failure).toContain('setTasks([])')
    expect(failure.indexOf('setScheduleItems([])')).toBeLessThan(failure.indexOf('setError(safeScheduleError'))
    expect(failure).toContain('return')
  })

  it('keeps the full calendar on an empty month rather than replacing it', () => {
    // The zero-state message belongs to the selected day's detail only.
    expect(panel).toContain('No work scheduled')
    expect(calendar).not.toContain('No schedule')
    expect(calendar).not.toMatch(/days\.length === 0 \?/)
  })
})

describe('phone and tablet', () => {
  it('pairs a compact month grid with the selected day\'s full metric labels', () => {
    expect(calendar).toContain('grid grid-cols-7 gap-1 lg:hidden')
    const mobilePanel = calendar.slice(calendar.indexOf('{/* Phone + tablet: the selected day'))
    // The panel walks the same ordered metric table and renders metric.label,
    // so all four complete names appear — they cannot drift from the legend.
    expect(mobilePanel).toContain('MONTH_METRICS.map((metric)')
    expect(mobilePanel).toContain('{metric.label}')
    expect(mobilePanel).not.toContain('{metric.shortLabel}')
    expect(mobilePanel).toContain('{formatMetric(metric.key, selectedMetrics)}')
    expect(mobilePanel).toContain('{formatFullDayLabel(selectedDate)}')
    expect(mobilePanel).toContain('grid grid-cols-2 gap-3')
    // The compact grid above shows values without visible labels; the panel is
    // where the full names live on small screens.
    expect(mobilePanel).toContain('text-xs font-semibold text-gray-600 truncate')
  })

  it('keeps navigation and day selection touch-friendly', () => {
    expect(occurrences(calendar, 'minHeight: 44')).toBe(3)
    expect(calendar).toContain('onSelectDate(day.dateKey)')
    expect(calendar).toContain('aria-pressed={selected}')
  })

  it('does not fork into separate mobile calendar components', () => {
    expect(occurrences(calendar, 'export function EmployeeMonthCalendar')).toBe(1)
    expect(occurrences(calendar, 'renderDayButton')).toBe(3)
    expect(readdirSync(employeeDir).filter((n) => /MobileCalendar|PhoneCalendar|TabletCalendar/i.test(n))).toEqual([])
  })
})

describe('existing day detail preserved', () => {
  it('keeps the schedule cards and their Start/Done controls', () => {
    expect(panel).toContain('function ScheduleCard')
    expect(panel).toContain('updateMyScheduleStatus(item.id, to)')
    expect(panel).toContain("transition('in_progress')")
    expect(panel).toContain("transition('done')")
    expect(panel).toContain('Start')
    expect(panel).toContain('Done')
    expect(panel).toContain('STATUS_LABELS')
    expect(panel).toContain('handleStatusChange')
  })

  it('adds no editing controls beyond the existing status transitions', () => {
    expect(panel).not.toContain('createScheduleItem')
    expect(panel).not.toContain('updateScheduleItem')
    expect(panel).not.toContain('deleteScheduleItem')
    expect(panel).not.toContain('<input')
    expect(panel).not.toContain('<textarea')
    expect(panel).not.toContain('updateMyEmployeeTask')
  })

  it('feeds the day detail from the month range already loaded', () => {
    expect(panel).toContain('scheduleItems.filter((item)')
    expect(panel).toContain('=== selectedDate')
  })
})

describe('regression guards', () => {
  it('leaves the My Tasks weekly view, selected-task form and Archived untouched', () => {
    const board = read('EmployeeWeeklyTaskBoard.tsx')
    const tasksPanel = read('EmployeeMyTasksPanel.tsx')
    const archive = read('EmployeeArchivedTaskList.tsx')
    // Still the seven-day week, one focused form, approved buttons.
    expect(board).toContain('lg:grid-cols-7')
    expect(occurrences(board, 'export function EmployeeFocusedTaskPanel')).toBe(1)
    expect(occurrences(board, 'Start Task')).toBe(1)
    expect(occurrences(board, 'Mark Complete')).toBe(1)
    expect(board).toContain('bg-amber-500 hover:bg-amber-400 active:bg-amber-600')
    expect(board).toContain('bg-green-600 hover:bg-green-500')
    expect(tasksPanel).toContain('updateMyEmployeeTask')
    expect(archive).toContain('Archived tasks are read-only.')
    // The month calendar is not wired into the task surfaces.
    for (const source of [board, tasksPanel, archive]) {
      expect(source).not.toContain('EmployeeMonthCalendar')
      expect(source).not.toContain('employeeMonthMetrics')
    }
  })

  it('leaves Clock, My Time and the Work Order viewer untouched', () => {
    const clock = read('EmployeeTimeClock.tsx')
    const myTime = read('EmployeeMyTimePanel.tsx')
    const viewer = read('EmployeeWorkOrderViewer.tsx')
    for (const source of [clock, myTime, viewer]) {
      expect(source).not.toContain('EmployeeMonthCalendar')
      expect(source).not.toContain('employeeMonthMetrics')
      expect(source).not.toContain('getMyScheduleRange')
    }
    // My Time still owns the authoritative paid-minutes display (weekly totals in the
    // navigation header; per-day totals delegate to EmployeeTimeWeekBoard).
    expect(myTime).toContain('formatMinutes(data.totalPaidMinutes)')
    expect(clock).toContain('recordSessionPunch')
  })

  it('adds no migration and no snapshot or Work Order change', () => {
    const migrations = readdirSync(join(process.cwd(), 'supabase/migrations'))
    expect(existsSync(join(process.cwd(), 'supabase/migrations/096_work_order_snapshot_delivery.sql'))).toBe(true)
    // 097 is punch-edit-requests (EMPLOYEE-MY-TIME-WEEK-1); 098/099 are job-linked sessions
    // (EMPLOYEE-JOB-CLOCK-SESSIONS-1); 100 is project-only sessions (EMPLOYEE-CLOCK-WORKSPACE-1);
    // 101 is project identity compat fix (PROJECT-IDENTITY-COMPAT-101);
    // 102–105 are employee clock RPC repairs; 106 is session-aware admin void.
    // Guard against anything beyond 106.
    const beyond100 = migrations.filter((name) => /^1\d\d_/.test(name))
      .filter((name) =>
        !name.startsWith('100_') &&
        !name.startsWith('101_') &&
        !name.startsWith('102_') &&
        !name.startsWith('103_') &&
        !name.startsWith('104_') &&
        !name.startsWith('105_') &&
        !name.startsWith('106_') &&
        !name.startsWith('107_') &&
        !name.startsWith('108_') &&
        !name.startsWith('109_') &&
        !name.startsWith('110_') &&
        !name.startsWith('111_') &&
        !name.startsWith('112_')
      )
    expect(beyond100).toEqual([])
    expect(migrations).toContain('086_employee_schedules.sql')
    for (const source of [panel, calendar, logic, scheduleService]) {
      expect(source).not.toContain('ALTER TABLE')
      expect(source).not.toContain('CREATE TABLE')
      expect(source).not.toContain('CREATE POLICY')
      expect(source).not.toContain('blueprint_snapshots')
      expect(source).not.toContain('assignment_work_orders')
    }
  })

  it('does not expose owner-only or other employees\' data', () => {
    for (const source of [panel, calendar, logic]) {
      expect(source).not.toContain('getOwnerOrgId')
      expect(source).not.toContain('getScheduleForMonth')
      expect(source).not.toContain('getScheduleForWeek')
      expect(source).not.toContain('employee_name')
      expect(source).not.toContain('lead_employee_id')
      expect(source).not.toContain('assigned_employee_ids')
    }
  })
})
