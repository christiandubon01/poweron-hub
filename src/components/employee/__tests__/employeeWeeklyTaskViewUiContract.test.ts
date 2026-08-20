/**
 * Employee weekly task view UI contract (EMPLOYEE-WEEKLY-TASK-VIEW-1B).
 *
 * Source-level contract in the existing house style: the vitest environment is
 * node with no DOM renderer, so these assertions pin the rendered structure and
 * class contract rather than a mounted tree. Grouping, selection and archive
 * behavior are covered by real unit tests in employeeWeeklyTasks.test.ts, and the
 * RPC argument contract by employeeTaskAssignmentService.test.ts.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const employeeDir = join(process.cwd(), 'src/components/employee')
const panel = readFileSync(join(employeeDir, 'EmployeeMyTasksPanel.tsx'), 'utf8')
const board = readFileSync(join(employeeDir, 'EmployeeWeeklyTaskBoard.tsx'), 'utf8')
const archive = readFileSync(join(employeeDir, 'EmployeeArchivedTaskList.tsx'), 'utf8')
const logic = readFileSync(join(employeeDir, 'employeeWeeklyTasks.ts'), 'utf8')
const portal = readFileSync(join(employeeDir, 'EmployeePortal.tsx'), 'utf8')
const viewer = readFileSync(join(employeeDir, 'EmployeeWorkOrderViewer.tsx'), 'utf8')

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

/** The block that renders one compact day-column card. */
const summaryCard = board.slice(
  board.indexOf('export function EmployeeTaskSummaryCard'),
  board.indexOf('export interface EmployeeFocusedTaskPanelProps'),
)

/** The block that renders the single focused task-detail area. */
const focusedPanel = board.slice(
  board.indexOf('export function EmployeeFocusedTaskPanel'),
  board.indexOf('export interface EmployeeWeeklyTaskBoardProps'),
)

/** The desktop seven-column week row. */
const weekRow = board.slice(
  board.indexOf('{/* Desktop: seven equal day columns'),
  board.indexOf('{/* Unscheduled'),
)

/** Week navigation, including the range heading and the seven-day strip. */
const weekNav = board.slice(
  board.indexOf('{/* Week navigation'),
  board.indexOf('{/* Phone + tablet: the selected day'),
)

/** The focused panel's header, which spans both form columns. */
const focusedHeader = focusedPanel.slice(
  focusedPanel.indexOf('{/* Header'),
  focusedPanel.indexOf('{task.can_complete ?'),
)

describe('one employee task workflow', () => {
  it('keeps the existing panel, task RPC service and Work Order viewer as the only sources', () => {
    expect(panel).toContain('getMyEmployeeTasks')
    expect(panel).toContain('updateMyEmployeeTask')
    expect(panel).toContain('EmployeeWorkOrderViewer')
    expect(panel).toContain('View Work Order')
    expect(panel).toContain('setWorkOrderAssignmentId(task.id)')

    // The presentation components own no data source and no write path.
    for (const source of [board, archive, logic]) {
      expect(source).not.toContain('@/lib/supabase')
      expect(source).not.toContain('getMyEmployeeTasks(')
      expect(source).not.toContain('updateMyEmployeeTask(')
      expect(source).not.toContain('recordTimePunch(')
      expect(source).not.toContain('record_time_punch')
      expect(source).not.toContain('supabase.rpc')
      expect(source).not.toContain('supabase.from')
    }
  })

  it('adds no route, page, portal, task service, viewer or time-entry service', () => {
    const files = readdirSync(employeeDir)
    expect(files).toContain('EmployeeMyTasksPanel.tsx')
    expect(files).toContain('EmployeeWeeklyTaskBoard.tsx')
    expect(files).toContain('EmployeeArchivedTaskList.tsx')
    expect(files).toContain('EmployeeWorkOrderViewer.tsx')
    expect(files.filter((name) => /Page|Route|Portal2|WorkOrderViewer2|TaskService|TimeService/i.test(name))).toEqual([])
    expect(occurrences(portal, '<EmployeeMyTasksPanel />')).toBe(1)
    expect(panel).not.toContain('createBrowserRouter')
    expect(panel).not.toContain('<Route')
  })

  it('renders every day-column task through one shared compact card', () => {
    expect(occurrences(board, 'export function EmployeeTaskSummaryCard')).toBe(1)
    expect(occurrences(board, 'const renderSummary =')).toBe(1)
    // Selected-day list, desktop week row and Unscheduled all go through it.
    expect(occurrences(board, 'renderSummary(task')).toBe(3)
    expect(archive).not.toContain('EmployeeTaskSummaryCard')
    expect(archive).not.toContain('EmployeeFocusedTaskPanel')
  })

  it('uses one shared Work Order action name owned by the panel', () => {
    expect(panel).toContain("export const VIEW_WORK_ORDER_LABEL = 'View Work Order'")
    expect(board).toContain('{viewWorkOrderLabel}')
    expect(archive).toContain('{viewWorkOrderLabel}')
    expect(occurrences(board, "'View Work Order'")).toBe(0)
    expect(occurrences(archive, "'View Work Order'")).toBe(0)
  })
})

describe('desktop seven-day week row', () => {
  it('lays the week out as exactly seven equal columns on one row', () => {
    expect(weekRow).toContain('lg:grid-cols-7')
    expect(weekRow).toContain('days.map((day)')
    // No 2/3/4-column week grid: that is what pushed Fri–Sun onto a second row.
    expect(board).not.toContain('sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4')
    for (const wrapping of ['lg:grid-cols-3', 'lg:grid-cols-4', 'lg:grid-cols-5', 'lg:grid-cols-6']) {
      expect(weekRow).not.toContain(wrapping)
    }
  })

  it('always builds seven day entries and renders a count for each', () => {
    expect(logic).toContain('WEEK_DAY_COUNT = 7')
    expect(weekRow).toContain('{day.tasks.length}')
    expect(weekRow).toContain('label.weekday')
    expect(weekRow).toContain('label.monthDay')
    expect(panel).toContain('buildWeekDays(range, active)')
  })

  it('gives the week range a primary heading and keeps "This week" secondary', () => {
    expect(weekNav).toMatch(/<h3 className="text-lg sm:text-xl font-bold text-gray-900 truncate">/)
    expect(weekNav).toContain('{formatWeekRangeLabel(range)}')
    // Secondary, but no longer text-xs light gray.
    expect(weekNav).toContain('text-sm font-medium text-gray-500')
    expect(weekNav).toContain("{isThisWeek ? 'This week' : 'Selected week'}")
    expect(weekNav).not.toContain('text-xs text-gray-400')
  })

  it('renders all seven weekday titles and dates in the larger readable treatment', () => {
    // Weekday name: bolder and larger than the old text-sm.
    expect(weekRow).toContain('text-base font-bold truncate')
    expect(weekRow).toContain('{label.weekday}')
    // Date under the weekday: readable, not tiny light gray.
    expect(weekRow).toContain('text-sm font-semibold truncate')
    expect(weekRow).toContain('{label.monthDay}')
    expect(weekRow).not.toContain('text-[10px]')
    expect(weekRow).not.toContain('text-gray-400')
    // Today keeps contrast inside the green highlight.
    expect(weekRow).toContain("isToday ? 'text-green-800' : 'text-gray-900'")
    expect(weekRow).toContain("isToday ? 'text-green-700' : 'text-gray-600'")
    // The count badge stays compact but its number is readable.
    expect(weekRow).toContain('flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-full border')
  })

  it('enlarges the seven-day selector strip without dropping a day', () => {
    expect(weekNav).toContain('grid grid-cols-7 gap-1 lg:hidden')
    expect(weekNav).toContain('{label.weekdayInitial}')
    expect(weekNav).toContain('{label.dayNumber}')
    expect(weekNav).toContain('text-xs font-bold uppercase leading-none')
    expect(weekNav).toContain('text-base font-bold leading-none')
    expect(weekNav).not.toContain('text-[10px]')
    // Touch target grew with the type, still one row of seven.
    expect(weekNav).toContain('minHeight: 58')
  })

  it('keeps the seven-day selector and the week row free of horizontal overflow', () => {
    expect(board).toContain('grid grid-cols-7 gap-1 lg:hidden')
    expect(weekRow).toContain('min-w-0')
    expect(board).toContain('break-words')
    expect(board).not.toContain('overflow-x-scroll')
    expect(board).not.toContain('overflow-x-auto')
    expect(board).not.toContain('min-w-max')
    expect(board).not.toContain('whitespace-nowrap')
    expect(archive).not.toContain('overflow-x-scroll')
  })

  it('gives all four tabs the full desktop content width', () => {
    // EMPLOYEE-CLOCK-WORKSPACE-1: Clock joined My Tasks, Schedule, and My Time.
    // Main is always-wide; profile card and nav retain their own max-w-lg constraint.
    expect(portal).toContain("activeSection === 'assignments'")
    expect(portal).toContain('max-w-lg lg:max-w-[1680px]')
    // Profile card and nav remain narrow on all screen sizes.
    expect(portal).toContain('mx-auto w-full max-w-lg')
  })

  it('shows all seven days plus Unscheduled without duplicating a task', () => {
    expect(board).toContain('Unscheduled')
    expect(board).toContain('No due date set for these tasks.')
    expect(panel).toContain('collectUnscheduledTasks(active)')
    expect(panel).toContain('countTasksOutsideWeek(range, active)')
    expect(logic).toContain('const seen = new Set<string>()')
    expect(logic).toContain('if (!id || seen.has(id)) continue')
  })

  it('drives days from the existing employee-portal Monday week convention', () => {
    expect(panel).toContain('getCurrentWeekRangeFromTenantDate')
    expect(panel).toContain('shiftWeekRange')
    expect(panel).toContain('getTenantWorkDate')
    expect(logic).toContain('addDaysToWorkDate')
    expect(logic).not.toContain('weekStartsOn')
    expect(logic).not.toContain('getMondayOf')
    expect(board).not.toContain('new Date().getDay()')
  })

  it('exposes previous week, Today, next week and a readable range label', () => {
    expect(board).toContain('aria-label="Previous week"')
    expect(board).toContain('aria-label="Next week"')
    expect(board).toContain('onClick={onToday}')
    expect(board).toContain('formatWeekRangeLabel(range)')
    expect(panel).toContain('onPreviousWeek={() => goToWeek(shiftWeekRange(range, -1))}')
    expect(panel).toContain('onNextWeek={() => goToWeek(shiftWeekRange(range, 1))}')
    expect(panel).toContain('onToday={() => goToWeek(getCurrentWeekRangeFromTenantDate())}')
  })

  it('keeps the existing portal visual language', () => {
    expect(board).toContain('rounded-2xl')
    expect(board).toContain('rounded-xl')
    expect(board).toContain('border-gray-200')
    expect(board).toContain('bg-green-600')
    expect(board).toContain('bg-amber-100 text-amber-700 border-amber-200')
    expect(board).toContain('bg-green-100 text-green-700 border-green-200')
    expect(board).toContain('shadow-sm')
  })
})

describe('compact task cards inside a day column', () => {
  it('shows package, project, status and a selected state — and nothing editable', () => {
    expect(summaryCard).toContain('task.work_package_name')
    expect(summaryCard).toContain("task.project_name || 'Project'")
    expect(summaryCard).toContain('STATUS_PILL[task.status]')
    expect(summaryCard).toContain('aria-pressed={selected}')
    expect(summaryCard).toContain('dueLabel')

    // The rejected layout put a whole task form in every day column.
    expect(summaryCard).not.toContain('<input')
    expect(summaryCard).not.toContain('<textarea')
    expect(summaryCard).not.toContain('Hours worked')
    expect(summaryCard).not.toContain('Notes / reason')
    expect(summaryCard).not.toContain('Start Task')
    expect(summaryCard).not.toContain('Mark Complete')
    expect(summaryCard).not.toContain('onStartTask')
    expect(summaryCard).not.toContain('onMarkComplete')
    expect(summaryCard).not.toContain('onViewWorkOrder')
  })

  it('exists exactly once per assignment id with consistent separation', () => {
    expect(summaryCard).toContain('onSelect(task.id)')
    expect(board).toContain('key={task.id}')
    expect(board).toContain('key={day.date}')
    // Multiple same-day tasks are separated cards, not one stacked column.
    expect(weekRow).toContain('<div className="space-y-2">')
    expect(summaryCard).toContain('rounded-xl border')
  })

  it('reads more easily while staying compact', () => {
    // Bumped one step each; still small enough to scan seven days at once.
    expect(summaryCard).toContain('text-sm font-bold text-gray-900 break-words leading-snug')
    expect(summaryCard).toContain('text-xs text-gray-600 break-words leading-snug')
    expect(summaryCard).toContain('text-[11px] font-semibold px-1.5 py-0.5 rounded-full border capitalize')
    // No tiny 10px type and no washed-out gray left on the card.
    expect(summaryCard).not.toContain('text-[10px]')
    expect(summaryCard).not.toContain('text-gray-400')
    // Compact means compact: no large padding, no min-height, no oversized type.
    expect(summaryCard).toContain('rounded-xl border p-2 ')
    expect(summaryCard).not.toContain('p-4')
    expect(summaryCard).not.toContain('minHeight')
    expect(summaryCard).not.toContain('text-base')
    expect(summaryCard).not.toContain('text-lg')
  })

  it('renders exactly one full task form on the page, never one per day', () => {
    // Every editable control and both actions exist once, inside the focused panel.
    for (const control of [
      'Hours worked',
      'Notes / reason',
      'Start Task',
      'Mark Complete',
      '<textarea',
      "type=\"number\"",
    ]) {
      expect(occurrences(board, control)).toBe(1)
      expect(occurrences(focusedPanel, control)).toBe(1)
    }
    expect(occurrences(board, 'export function EmployeeFocusedTaskPanel')).toBe(1)
    expect(occurrences(board, '<EmployeeFocusedTaskPanel')).toBe(1)
  })

  it('selects with the stable assignment id without acting on the task', () => {
    expect(panel).toContain('const handleSelectTask = (assignmentId: string) => {')
    expect(panel).toContain('setSelectedTaskId(assignmentId)')
    expect(panel).toContain('onSelectTask={handleSelectTask}')
    const select = panel.slice(
      panel.indexOf('const handleSelectTask'),
      panel.indexOf('return (', panel.indexOf('const handleSelectTask')),
    )
    expect(select).not.toContain('markInProgress')
    expect(select).not.toContain('markComplete')
    expect(select).not.toContain('setWorkOrderAssignmentId')
    expect(select).not.toContain('setDraftHours')
    expect(select).not.toContain('setDraftNotes')
  })
})

describe('one focused task-detail area', () => {
  it('sits below the week row, not inside a day column', () => {
    expect(board.indexOf('<EmployeeFocusedTaskPanel')).toBeGreaterThan(board.indexOf('lg:grid-cols-7'))
    expect(weekRow).not.toContain('EmployeeFocusedTaskPanel')
    expect(focusedPanel).toContain('aria-label="Selected task details"')
    expect(focusedPanel).not.toContain('fixed inset-0')
  })

  it('carries the full identity, actions and inputs for the selected task', () => {
    expect(focusedPanel).toContain('task.work_package_name')
    expect(focusedPanel).toContain("task.project_name || 'Project'")
    expect(focusedPanel).toContain('STATUS_PILL[task.status]')
    expect(focusedPanel).toContain("dayLabel || 'No due date'")
    expect(focusedPanel).toContain('{viewWorkOrderLabel}')
    expect(focusedPanel).toContain('Hours worked <span className="text-red-500">*</span>')
    expect(focusedPanel).toContain('Notes / reason <span className="text-gray-500 font-normal">(optional)</span>')
  })

  it('opens with a strong header that spans both form columns', () => {
    // The header is a sibling of the two-column grid, not inside a column.
    expect(focusedPanel).toContain('<header className="min-w-0 border-b border-gray-100 pb-4">')
    expect(focusedHeader).toBeTruthy()
    expect(focusedPanel.indexOf('<header')).toBeLessThan(focusedPanel.indexOf('md:grid-cols-2'))

    // Small eyebrow, then a visibly larger primary title.
    expect(focusedHeader).toContain('uppercase tracking-wider')
    expect(focusedHeader).toContain('Selected task')
    expect(focusedHeader).toContain('text-xl sm:text-2xl font-bold text-gray-900 break-words')
    // Metadata readable, not tiny.
    expect(focusedHeader).toContain('text-sm sm:text-base text-gray-600 break-words')
    expect(focusedHeader).toContain('text-sm font-semibold text-gray-700 break-words')
    expect(focusedHeader).not.toContain('text-[11px] text-gray-400')

    // Uppercase is confined to the eyebrow.
    expect(occurrences(focusedHeader, 'uppercase')).toBe(1)
  })

  it('balances identity on the left against status and date on the right', () => {
    expect(focusedHeader).toContain('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between')
    expect(focusedHeader).toContain('sm:flex-col sm:items-end')
    // Phone stacks; nothing is clipped or truncated away.
    expect(focusedHeader).not.toContain('truncate')
    expect(focusedHeader).not.toContain('overflow-hidden')
  })

  it('shows the task position within its day when that day holds more than one', () => {
    expect(focusedHeader).toContain('{positionLabel}')
    expect(board).toContain('`Task ${focusedIndex + 1} of ${focusedDay.tasks.length}`')
    expect(board).toContain('focusedDay.tasks.length > 1')
    expect(board).toContain('positionLabel={focusedPositionLabel}')
  })

  it('splits the form into Task Actions and Completion Details sections', () => {
    expect(focusedPanel).toContain('Task Actions')
    expect(focusedPanel).toContain('Completion Details')
    expect(focusedPanel).toContain('aria-labelledby={`task-actions-${task.id}`}')
    expect(focusedPanel).toContain('aria-labelledby={`completion-details-${task.id}`}')
    expect(focusedPanel).toContain('id={`task-actions-${task.id}`}')
    expect(focusedPanel).toContain('id={`completion-details-${task.id}`}')

    // View Work Order and Start Task live in Task Actions; hours/notes/complete
    // live in Completion Details.
    const actions = focusedPanel.slice(
      focusedPanel.indexOf('{/* Task Actions */}'),
      focusedPanel.indexOf('{/* Completion Details */}'),
    )
    const completion = focusedPanel.slice(
      focusedPanel.indexOf('{/* Completion Details */}'),
      focusedPanel.indexOf('{/* One shared footer error area'),
    )
    expect(actions).toContain('{viewWorkOrderLabel}')
    expect(actions).toContain('Start Task')
    expect(actions).not.toContain('Hours worked')
    expect(actions).not.toContain('<textarea')
    expect(completion).toContain('Hours worked')
    expect(completion).toContain('Notes / reason')
    expect(completion).toContain('Mark Complete')
    expect(completion).not.toContain('Start Task')
  })

  it('gives both sections matching padding, radius, border and top alignment', () => {
    const sectionShell = 'min-w-0 rounded-xl border border-gray-200 bg-gray-50/60 p-4 space-y-3'
    // Lead layout uses two; the non-lead branch reuses the same shell.
    expect(occurrences(focusedPanel, sectionShell)).toBe(3)
    expect(focusedPanel).toContain('items-start')
  })

  it('matches control widths and heights inside Task Actions', () => {
    const actions = focusedPanel.slice(
      focusedPanel.indexOf('{/* Task Actions */}'),
      focusedPanel.indexOf('{/* Completion Details */}'),
    )
    // View Work Order, Start Task and the In Progress state all full width at 44px.
    expect(occurrences(actions, 'w-full flex items-center justify-center gap-2 rounded-xl')).toBe(2)
    expect(occurrences(actions, 'minHeight: 44')).toBe(3)
    // No leftover inline min-h utility competing with the shared height.
    expect(actions).not.toContain('min-h-11')
    // Helper text fills the column instead of leaving it mostly empty.
    expect(actions).toContain('text-xs text-gray-500 leading-relaxed')
  })

  it('keeps the In Progress state in place of Start Task, never both', () => {
    expect(focusedPanel).toContain('{inProgress ? (')
    expect(focusedPanel).toContain('In Progress')
    expect(focusedPanel).toContain('role="status"')
    expect(occurrences(focusedPanel, 'Start Task')).toBe(1)
  })

  it('aligns the completion inputs to one section width', () => {
    const completion = focusedPanel.slice(
      focusedPanel.indexOf('{/* Completion Details */}'),
      focusedPanel.indexOf('{/* One shared footer error area'),
    )
    // Input, textarea and Mark Complete are all w-full within the section.
    expect(occurrences(completion, 'w-full rounded-xl border border-gray-300 bg-white px-3 py-2')).toBe(2)
    expect(completion).toContain('w-full flex items-center justify-center gap-2 rounded-xl bg-green-600')
    // Consistent label treatment.
    expect(occurrences(completion, 'block text-sm font-semibold text-gray-800 mb-1')).toBe(2)
    // Practical, not oversized.
    expect(completion).toContain('minHeight: 80')
    expect(completion).toContain('rows={3}')
  })

  it('centers a readable form width inside the full-width outer card', () => {
    expect(focusedPanel).toContain('mx-auto w-full max-w-5xl')
    // The outer card itself is not narrowed, so it still spans the calendar width.
    expect(focusedPanel).toContain('bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 shadow-sm')
    expect(focusedPanel).not.toContain('max-w-md')
    expect(focusedPanel).not.toContain('max-w-lg')
  })

  it('uses one shared footer error area rather than per-section errors', () => {
    expect(focusedPanel).toContain('{/* One shared footer error area for both sections */}')
    expect(occurrences(focusedPanel, 'role="alert"')).toBe(1)
    expect(occurrences(focusedPanel, '{errorMessage}')).toBe(1)
    // The error sits after the grid, not inside a column.
    expect(focusedPanel.indexOf('role="alert"')).toBeGreaterThan(focusedPanel.indexOf('{/* Completion Details */}'))
  })

  it('switches task instead of stacking another form, and prompts when nothing is selected', () => {
    expect(board).toContain('task={focusedTask}')
    expect(panel).toContain('resolveSelectedTaskId(active, selectedTaskId)')
    expect(panel).toContain('active.find((task) => task.id === focusedTaskId) ?? null')
    expect(focusedPanel).toContain('if (!task) {')
    expect(focusedPanel).toContain('No task selected')
  })

  it('shows a safe loading and error state exactly once', () => {
    expect(focusedPanel).toContain('busy')
    expect(focusedPanel).toContain('aria-busy={busy}')
    expect(focusedPanel).toContain('Loader2')
    expect(focusedPanel).toContain('role="alert"')
    // Write failures render only here; the panel banner is load-only.
    expect(occurrences(board, 'errorMessage')).toBeGreaterThan(0)
    expect(occurrences(focusedPanel, '{errorMessage}')).toBe(1)
    expect(panel).toContain('actionError={actionError}')
    expect(panel).toContain('{loadError}')
    expect(occurrences(panel, '{loadError}')).toBe(1)
    expect(panel).not.toContain('{actionError}<')
  })

  it('uses two balanced columns on desktop and stacks safely below that', () => {
    // Equal-width columns from md up; a single stacked column on phone.
    expect(focusedPanel).toContain('grid gap-4 md:grid-cols-2 md:gap-5 items-start')
    expect(focusedPanel).not.toContain('md:grid-cols-3')
    expect(focusedPanel).not.toContain('lg:grid-cols-2')
    // Uneven splits would reintroduce the empty left column.
    for (const uneven of ['md:col-span-2', 'basis-1/3', 'w-1/3', 'md:grid-cols-[']) {
      expect(focusedPanel).not.toContain(uneven)
    }
  })

  it('keeps every focused-panel control touch-friendly and free of overflow', () => {
    // View Work Order, In Progress, Start Task, hours input, Mark Complete, and
    // the non-lead Work Order button.
    expect(occurrences(focusedPanel, 'minHeight: 44')).toBe(6)
    expect(focusedPanel).toContain('fontSize: 16')
    expect(focusedPanel).toContain('min-w-0')
    expect(focusedPanel).toContain('break-words')
    expect(focusedPanel).not.toContain('whitespace-nowrap')
    expect(focusedPanel).not.toContain('overflow-x')
  })

  it('keeps labels associated, names accessible and focus visible', () => {
    // Labels point at the real input ids.
    expect(focusedPanel).toContain('htmlFor={`hours-${task.id}`}')
    expect(focusedPanel).toContain('id={`hours-${task.id}`}')
    expect(focusedPanel).toContain('htmlFor={`notes-${task.id}`}')
    expect(focusedPanel).toContain('id={`notes-${task.id}`}')
    // Larger type is paired with structure, not color alone.
    expect(focusedPanel).toContain('<h4')
    expect(focusedPanel).toContain('<h3')
    // Visible focus on the interactive controls.
    expect(occurrences(focusedPanel, 'focus-visible:ring-2')).toBe(4)
    expect(summaryCard).toContain('focus-visible:ring-2 focus-visible:ring-green-600')
  })
})

describe('Start Task', () => {
  it('keeps the approved amber, play-icon, touch-friendly button', () => {
    expect(focusedPanel).toContain('Start Task')
    expect(focusedPanel).toContain('onClick={() => onStartTask(task)}')
    expect(focusedPanel).toContain('<Play size={16} />')
    expect(focusedPanel).toContain('bg-amber-500 hover:bg-amber-400 active:bg-amber-600')
    expect(focusedPanel).toContain('minHeight: 44')
    expect(focusedPanel).toContain('font-bold')
    expect(board).not.toContain('Start (mark in progress)')
    expect(board).not.toContain('<Circle')
    expect(board).not.toContain('type="radio"')
    expect(board).not.toContain('type="checkbox"')
  })

  it('uses the existing status-update path and shows In Progress only after success', () => {
    expect(panel).toContain('onStartTask={markInProgress}')
    expect(panel).toContain("status: 'in_progress',")
    expect(focusedPanel).toContain("const inProgress = task.status === 'in_progress'")
    expect(focusedPanel).toContain('In Progress')
    expect(focusedPanel).toContain('role="status"')

    // A failed start returns before any reload, so the status never changes.
    const start = panel.indexOf('const markInProgress =')
    const body = panel.slice(start, panel.indexOf('const markComplete ='))
    expect(body).toContain('if (!res.success)')
    expect(body.indexOf('if (!res.success)')).toBeLessThan(body.indexOf('await load()'))
    expect(body).not.toContain('setTasks(')
  })

  it('shows a pending state and blocks duplicate submissions synchronously', () => {
    expect(focusedPanel).toContain("busy ? 'Starting…' : 'Start Task'")
    expect(panel).toContain('const inFlightIds = useRef<Set<string>>(new Set())')
    expect(panel).toContain('if (savingId || inFlightIds.current.has(task.id)) return false')
    expect(panel).toContain('if (!beginUpdate(task)) return')
    expect(focusedPanel).toContain('disabled={busy}')
  })

  it('does not fabricate payroll time when the clock has no assignment link', () => {
    for (const source of [panel, board, archive, logic]) {
      expect(source).not.toContain('recordTimePunch')
      expect(source).not.toContain('time_punch_events')
      expect(source).not.toContain('time_entries')
      expect(source).not.toContain('paid_minutes')
      expect(source).not.toContain('localStorage')
      expect(source).not.toContain('sessionStorage')
    }
    expect(panel).toContain('never writes payroll time')
  })
})

describe('Mark Complete', () => {
  it('keeps the approved green, completion-icon, touch-friendly button', () => {
    expect(focusedPanel).toContain('Mark Complete')
    expect(focusedPanel).toContain('onClick={() => onMarkComplete(task)}')
    expect(focusedPanel).toContain('<CheckCircle2 size={16} />')
    expect(focusedPanel).toContain('bg-green-600 hover:bg-green-500')
    expect(focusedPanel).toContain('minHeight: 44')
  })

  it('keeps hours required, notes optional, and the existing update path', () => {
    expect(panel).toContain("setActionError('Enter the hours worked before marking complete.')")
    expect(panel).toContain('if (!rawHours || isNaN(hrs) || hrs <= 0)')
    expect(panel).toContain("status: 'completed',")
    expect(panel).toContain("completionNotes: draftNotes[task.id] ?? '',")
    expect(panel).toContain('hoursSpent: hrs,')
  })

  it('archives only after the backend confirms and blocks duplicate completion', () => {
    const start = panel.indexOf('const markComplete =')
    const body = panel.slice(start, panel.indexOf('const saveNotes ='))
    expect(body).toContain('if (!beginUpdate(task)) return')
    expect(body).toContain('if (!res.success)')
    expect(body).toContain('setConfirmedCompleted((prev) => new Set(prev).add(task.id))')
    // The failure branch returns before anything enters the Archive or clears a draft.
    expect(body.indexOf('if (!res.success)')).toBeLessThan(body.indexOf('setConfirmedCompleted'))
    expect(body.indexOf('if (!res.success)')).toBeLessThan(body.indexOf('clearDrafts(task.id)'))
    // Validation runs before the in-flight reservation so a rejected submit stays clickable.
    expect(body.indexOf('if (!rawHours')).toBeLessThan(body.indexOf('if (!beginUpdate(task)) return'))
  })

  it('moves a confirmed completion out of Active and into Archived from one exclusive partition', () => {
    expect(panel).toContain('partitionMyTasks(tasks, confirmedCompleted)')
    expect(panel).toContain('const { active, archived } =')
    expect(panel).toContain('buildWeekDays(range, active)')
    expect(panel).toContain('sortArchivedTasks(archived)')
    expect(logic).toContain('if (isTaskArchived(task, confirmedCompletedIds)) archived.push(task)')
    expect(logic).toContain('else active.push(task)')
    // A completed task cannot keep the editable detail panel open.
    expect(logic).toContain('export function resolveSelectedTaskId(')
  })

  it('does not delete the assignment, its Work Order, or its snapshots', () => {
    for (const source of [panel, board, archive]) {
      // No table/query delete — the only `.delete(` allowed is on local Sets/records.
      expect(source).not.toMatch(/from\([^)]*\)[\s.]*\.?delete\(/)
      expect(source).not.toContain('supabase')
      expect(source).not.toContain('revokeTaskAssignment')
      expect(source).not.toContain('assignment_snapshots')
      expect(source).not.toContain('blueprint_snapshots')
    }
  })
})

describe('archived bucket', () => {
  it('lives inside the same My Tasks workflow as a segmented control', () => {
    expect(panel).toContain("const [view, setView] = useState<TaskView>('week')")
    expect(panel).toContain('Active Week')
    expect(panel).toContain('Archived')
    expect(panel).toContain('role="tablist"')
    expect(panel).toContain("aria-selected={view === 'week'}")
    expect(panel).toContain("aria-selected={view === 'archived'}")
  })

  it('shows a compact summary and full details on open', () => {
    expect(archive).toContain('task.work_package_name')
    expect(archive).toContain("task.project_name || 'Project'")
    expect(archive).toContain('formatCompletedAt(task.completed_at)')
    expect(archive).toContain('formatHours(task.hours_spent)')
    expect(archive).toContain('task.completion_notes')
    expect(archive).toContain('View details')
    expect(archive).toContain('Hide details')
    expect(archive).toContain('aria-expanded={expanded}')
    expect(archive).toContain('Hours worked')
    expect(archive).toContain('Notes / reason')
    expect(archive).toContain('Completed')
  })

  it('renders missing completion values safely instead of crashing', () => {
    expect(archive).toContain("if (!iso) return 'Completion date not recorded'")
    expect(archive).toContain('if (isNaN(date.getTime()))')
    expect(archive).toContain("if (hours == null) return 'No hours recorded'")
    expect(archive).toContain("task.completion_notes || 'No notes recorded'")
    expect(archive).toContain('whitespace-pre-wrap break-words')
  })

  it('keeps Work Order available and everything else read-only', () => {
    expect(archive).toContain('onViewWorkOrder(task)')
    expect(archive).toContain('Archived tasks are read-only.')
    expect(archive).not.toContain('<input')
    expect(archive).not.toContain('<textarea')
    expect(archive).not.toContain('Mark Complete')
    expect(archive).not.toContain('Start Task')
    expect(archive).not.toContain('Restart')
    expect(archive).not.toContain('Reopen')
    expect(archive).not.toMatch(/onStartTask|onMarkComplete|onSaveNotes|onHoursChange|onNotesChange/)
    expect(archive).not.toContain('Delete')
    expect(archive).not.toContain('Edit')
    expect(archive).not.toContain("status: '")
  })

  it('keeps the approved archived layout untouched by this phase', () => {
    // The owner approved Archived: its grid, cards and props stay as they were.
    expect(archive).toContain('<div className="grid gap-3 lg:grid-cols-2">')
    expect(archive).toContain('bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-2.5')
    expect(archive).toContain('export interface EmployeeArchivedTaskListProps')
    expect(archive).not.toContain('selectedTaskId')
    expect(archive).not.toContain('actionError')
    expect(panel).toContain('tasks={archivedTasks}')
    expect(panel).toContain('expandedId={archivedExpandedId}')
  })

  it('reads archived rows from the same RPC payload with no local archive store', () => {
    expect(panel).toContain('EmployeeArchivedTaskList')
    expect(archive).not.toContain('useEffect')
    expect(archive).not.toContain('fetch(')
    expect(logic).not.toContain('fetch(')
  })
})

describe('state safety across week, day, task, view and Work Order changes', () => {
  it('keeps per-assignment hours and notes drafts when the focused task changes', () => {
    expect(panel).toContain('const editedHours = useRef<Set<string>>(new Set())')
    expect(panel).toContain('const editedNotes = useRef<Set<string>>(new Set())')
    expect(panel).toContain('if (!editedNotes.current.has(t.id))')
    expect(panel).toContain('if (!editedHours.current.has(t.id))')
    // Drafts are keyed by assignment id and live in the panel, so switching task,
    // week, day or view never unmounts them and a refetch never clears them.
    expect(panel).toContain('setDraftHours((d) => ({ ...d, [assignmentId]: value }))')
    expect(panel).toContain('setDraftNotes((d) => ({ ...d, [assignmentId]: value }))')
    expect(panel).not.toContain('setDraftNotes({})')
    expect(panel).not.toContain('setDraftHours({})')
    expect(board).toContain('props.hoursDrafts[focusedTask.id]')
    expect(board).toContain('props.notesDrafts[focusedTask.id]')
  })

  it('does not retain a draft forever after a confirmed completion', () => {
    expect(panel).toContain('const clearDrafts = useCallback((assignmentId: string) => {')
    expect(panel).toContain('delete next[assignmentId]')
    expect(panel).toContain('clearDrafts(task.id)')
  })

  it('uses assignment ids as the stable identity and ignores stale loads', () => {
    expect(panel).toContain('const loadSeq = useRef(0)')
    expect(panel).toContain('if (loadSeq.current !== seq) return')
    expect(board).toContain('key={task.id}')
    expect(archive).toContain('key={task.id}')
  })

  it('keeps a valid selected day and a valid selected task when data changes', () => {
    expect(panel).toContain('setSelectedDay((current) => resolveSelectedDay(next, today, current))')
    expect(logic).toContain('if (current && dates.includes(current)) return current')
    expect(logic).toContain('return (activeTasks ?? []).some((task) => task?.id === id) ? id : null')
  })

  it('avoids modal-on-modal task editing — only the Work Order opens a viewer', () => {
    expect(occurrences(panel, '<EmployeeWorkOrderViewer')).toBe(1)
    expect(board).not.toContain('fixed inset-0')
    expect(archive).not.toContain('fixed inset-0')
  })
})

describe('regression guards', () => {
  it('leaves the immutable Work Order viewer contract unchanged', () => {
    expect(panel).toContain('assignmentId={workOrderAssignmentId}')
    expect(panel).toContain('onClose={() => setWorkOrderAssignmentId(null)}')
    expect(viewer).toContain('getMyEmployeeWorkOrder(assignmentId)')
    expect(viewer).toContain('BlueprintSnapshotPreviewViewport')
    expect(viewer).toContain('/functions/v1/getAssignmentSnapshotUrls')
    expect(viewer).not.toContain('EmployeeWeeklyTaskBoard')
    expect(viewer).not.toContain('EmployeeArchivedTaskList')
    expect(viewer).not.toContain('EmployeeFocusedTaskPanel')
  })

  it('allows approved migrations through 119 in this phase', () => {
    const migrations = readdirSync(join(process.cwd(), 'supabase/migrations'))
    expect(existsSync(join(process.cwd(), 'supabase/migrations/096_work_order_snapshot_delivery.sql'))).toBe(true)
    // 097 is punch-edit-requests (EMPLOYEE-MY-TIME-WEEK-1); 098/099 are job-linked sessions
    // (EMPLOYEE-JOB-CLOCK-SESSIONS-1); 100 is project-only sessions (EMPLOYEE-CLOCK-WORKSPACE-1);
    // 101 is project identity compat fix (PROJECT-IDENTITY-COMPAT-101);
    // 102–105 are employee clock RPC repairs; 106 is session-aware admin void.
    // 117/118 are approved COMM pilot telemetry migrations; 119 is portal request attribution.
    // Guard against anything beyond 119.
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
        !name.startsWith('112_') &&
        !name.startsWith('113_') &&
        !name.startsWith('114_') &&
        !name.startsWith('115_') &&
        !name.startsWith('116_') &&
        !name.startsWith('117_') &&
        !name.startsWith('118_') &&
        !name.startsWith('119_') &&
        !name.startsWith('120_') &&
        !name.startsWith('121_') &&
        !name.startsWith('122_')
      )
    expect(beyond100).toEqual([])
    expect(migrations).toContain('117_pilot_telemetry.sql')
    expect(migrations).toContain('118_pilot_telemetry_hardening.sql')
    expect(migrations).toContain('120_portal_request_attribution.sql')
    expect(migrations).toContain('092_task_hours_spent.sql')
    for (const source of [panel, board, archive, logic]) {
      expect(source).not.toContain('ALTER TABLE')
      expect(source).not.toContain('CREATE TABLE')
    }
  })

  it('does not expose owner-only or lead-identifying assignment fields', () => {
    for (const source of [panel, board, archive, logic]) {
      expect(source).not.toMatch(/\.lead_employee_id|\{lead_employee_id|task\.assigned_employee_ids|\.assigned_by/)
    }
    for (const source of [board, archive, logic]) {
      expect(source).not.toContain('lead_employee_id')
      expect(source).not.toContain('assigned_employee_ids')
      expect(source).not.toContain('assigned_by')
    }
  })
})
