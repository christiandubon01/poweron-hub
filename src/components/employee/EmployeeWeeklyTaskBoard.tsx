/**
 * EmployeeWeeklyTaskBoard — presentation for the employee seven-day task board
 * (EMPLOYEE-WEEKLY-TASK-VIEW-1B).
 *
 * Presentation only. It owns no data source, no service call and no task state:
 * EmployeeMyTasksPanel still loads through getMyEmployeeTasks and still writes
 * through updateMyEmployeeTask.
 *
 * Two renderers, deliberately separate:
 *   EmployeeTaskSummaryCard  — the compact, selectable card that appears inside a
 *                              day column. Identity and status only: no hours
 *                              input, no notes textarea, no Start/Complete.
 *   EmployeeFocusedTaskPanel — the single full-width detail area for the one
 *                              selected task. Every editable field and every
 *                              action lives here, exactly once on the page.
 *
 * Layout:
 *   < lg — seven-day selector strip + the selected day's compact cards
 *   ≥ lg — seven equal day columns on one row, so Monday through Sunday never
 *          wrap to a second row
 * The focused detail panel is always full width, below the week.
 */

import React from 'react'
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  Play,
} from 'lucide-react'
import type { EmployeeMyTask, TaskAssignmentStatus } from '@/services/employeeTaskAssignmentService'
import type { WeekRange } from '@/services/employeePortalService'
import {
  formatDayLabel,
  formatWeekRangeLabel,
  type WeeklyTaskDay,
} from './employeeWeeklyTasks'

const STATUS_PILL: Record<TaskAssignmentStatus, string> = {
  assigned:    'bg-gray-100 text-gray-600 border-gray-200',
  in_progress: 'bg-amber-100 text-amber-700 border-amber-200',
  completed:   'bg-green-100 text-green-700 border-green-200',
}

function formatUpdatedTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// ── Compact day-column card ───────────────────────────────────────────────────

export interface EmployeeTaskSummaryCardProps {
  task: EmployeeMyTask
  /** True for the one task whose details are open below. */
  selected: boolean
  /** Due-date hint, or null when the card already sits under that day. */
  dueLabel: string | null
  onSelect: (assignmentId: string) => void
}

/**
 * One task, compact enough for a narrow day column. Selecting it only changes
 * which task the focused panel shows — it never starts, completes or opens
 * anything.
 */
export function EmployeeTaskSummaryCard({
  task,
  selected,
  dueLabel,
  onSelect,
}: EmployeeTaskSummaryCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      aria-pressed={selected}
      className={`w-full min-w-0 text-left rounded-xl border p-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-1 ${
        selected
          ? 'border-green-500 bg-green-50 ring-2 ring-green-500/30 shadow-sm'
          : 'border-gray-200 bg-white hover:border-green-300 hover:bg-green-50/40'
      }`}
    >
      <p className="text-sm font-bold text-gray-900 break-words leading-snug">
        {task.work_package_name}
      </p>
      <p className="text-xs text-gray-600 break-words leading-snug mt-0.5">
        {task.project_name || 'Project'}
      </p>
      <span
        className={`inline-block mt-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full border capitalize ${STATUS_PILL[task.status]}`}
      >
        {task.status.replace('_', ' ')}
      </span>
      {dueLabel ? <p className="text-[11px] text-gray-500 mt-1 break-words">{dueLabel}</p> : null}
    </button>
  )
}

// ── The one focused task-detail area ─────────────────────────────────────────

export interface EmployeeFocusedTaskPanelProps {
  /** The selected active task, or null when nothing is selected. */
  task: EmployeeMyTask | null
  dayLabel: string | null
  /** "Task 2 of 3" when that day holds more than one task, else null. */
  positionLabel: string | null
  /** Shared Work Order action name, owned by EmployeeMyTasksPanel. */
  viewWorkOrderLabel: string
  hoursDraft: string
  notesDraft: string
  busy: boolean
  /** The single place a failed Start/Complete is reported. */
  errorMessage: string
  onHoursChange: (assignmentId: string, value: string) => void
  onNotesChange: (assignmentId: string, value: string) => void
  onViewWorkOrder: (task: EmployeeMyTask) => void
  onStartTask: (task: EmployeeMyTask) => void
  onMarkComplete: (task: EmployeeMyTask) => void
  onSaveNotes: (task: EmployeeMyTask) => void
}

export function EmployeeFocusedTaskPanel({
  task,
  dayLabel,
  positionLabel,
  viewWorkOrderLabel,
  hoursDraft,
  notesDraft,
  busy,
  errorMessage,
  onHoursChange,
  onNotesChange,
  onViewWorkOrder,
  onStartTask,
  onMarkComplete,
  onSaveNotes,
}: EmployeeFocusedTaskPanelProps) {
  if (!task) {
    return (
      <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-6 shadow-sm text-center">
        <CalendarDays className="w-6 h-6 text-gray-400 mx-auto" />
        <p className="text-base font-bold text-gray-900 mt-2">No task selected</p>
        <p className="text-sm text-gray-600 mt-1">
          Choose a task above to see its details and update it here.
        </p>
      </div>
    )
  }

  const inProgress = task.status === 'in_progress'
  const updatedTime = formatUpdatedTime(task.updated_at)
  const notesDirty = (notesDraft ?? '') !== (task.completion_notes || '')

  return (
    <section
      className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 shadow-sm"
      aria-label="Selected task details"
    >
      {/* Inner readable width: the outer card stays full width with the calendar,
          while the form itself stops stretching on very wide desktops. */}
      <div className="mx-auto w-full max-w-5xl space-y-5">
        {/* Header — spans both columns */}
        <header className="min-w-0 border-b border-gray-100 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                Selected task
              </p>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 break-words leading-tight">
                {task.work_package_name}
              </h3>
              <p className="text-sm sm:text-base text-gray-600 break-words">
                {task.project_name || 'Project'}
              </p>
            </div>

            {/* Status + date: right-aligned on desktop, stacked on phone */}
            <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:gap-1.5 sm:flex-shrink-0">
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded-full border capitalize ${STATUS_PILL[task.status]}`}
              >
                {task.status.replace('_', ' ')}
              </span>
              <span className="text-sm font-semibold text-gray-700 break-words sm:text-right">
                {dayLabel || 'No due date'}
              </span>
              {positionLabel ? (
                <span className="text-xs text-gray-500">{positionLabel}</span>
              ) : null}
            </div>
          </div>
        </header>

        {task.can_complete ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 md:gap-5 items-start">
              {/* Task Actions */}
              <section
                aria-labelledby={`task-actions-${task.id}`}
                className="min-w-0 rounded-xl border border-gray-200 bg-gray-50/60 p-4 space-y-3"
              >
                <h4
                  id={`task-actions-${task.id}`}
                  className="text-sm font-bold text-gray-900"
                >
                  Task Actions
                </h4>

                <button
                  type="button"
                  onClick={() => onViewWorkOrder(task)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 text-sm font-bold text-green-700 hover:bg-green-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
                  style={{ minHeight: 44 }}
                >
                  <FileText size={16} />
                  {viewWorkOrderLabel}
                </button>

                {inProgress ? (
                  <div
                    className="flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm font-bold text-amber-700"
                    style={{ minHeight: 44 }}
                    role="status"
                  >
                    <Clock3 size={16} />
                    In Progress
                    {updatedTime ? (
                      <span className="font-semibold text-amber-600">· updated {updatedTime}</span>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onStartTask(task)}
                    disabled={busy}
                    aria-busy={busy}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-white font-bold text-sm shadow-md shadow-amber-500/25 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2"
                    style={{ minHeight: 44 }}
                  >
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                    {busy ? 'Starting…' : 'Start Task'}
                  </button>
                )}

                <p className="text-xs text-gray-500 leading-relaxed">
                  {inProgress
                    ? 'Open the Work Order any time for the drawing, scope and materials.'
                    : 'Open the Work Order first, then mark the task started so your team can see the progress.'}
                </p>
              </section>

              {/* Completion Details */}
              <section
                aria-labelledby={`completion-details-${task.id}`}
                className="min-w-0 rounded-xl border border-gray-200 bg-gray-50/60 p-4 space-y-3"
              >
                <h4
                  id={`completion-details-${task.id}`}
                  className="text-sm font-bold text-gray-900"
                >
                  Completion Details
                </h4>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1" htmlFor={`hours-${task.id}`}>
                    Hours worked <span className="text-red-500">*</span>
                  </label>
                  <input
                    id={`hours-${task.id}`}
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={hoursDraft ?? ''}
                    onChange={(e) => onHoursChange(task.id, e.target.value)}
                    disabled={busy}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60"
                    style={{ fontSize: 16, minHeight: 44 }}
                    placeholder="e.g. 2.5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1" htmlFor={`notes-${task.id}`}>
                    Notes / reason <span className="text-gray-500 font-normal">(optional)</span>
                  </label>
                  <textarea
                    id={`notes-${task.id}`}
                    value={notesDraft ?? ''}
                    onChange={(e) => onNotesChange(task.id, e.target.value)}
                    rows={3}
                    disabled={busy}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60"
                    style={{ minHeight: 80, fontSize: 16 }}
                    placeholder="What was completed? Any delays or issues?"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => onMarkComplete(task)}
                  disabled={busy}
                  aria-busy={busy}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold text-sm disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
                  style={{ minHeight: 44 }}
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {busy ? 'Saving…' : 'Mark Complete'}
                </button>

                {notesDirty && !busy && (
                  <button
                    type="button"
                    onClick={() => onSaveNotes(task)}
                    className="w-full text-xs text-gray-600 font-semibold hover:text-gray-800"
                  >
                    Save notes only
                  </button>
                )}
              </section>
            </div>

            {/* One shared footer error area for both sections */}
            {errorMessage ? (
              <div
                className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5"
                role="alert"
              >
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700 break-words">{errorMessage}</p>
              </div>
            ) : null}
          </>
        ) : (
          /* Non-lead: same section treatment, no editable completion form. */
          <section
            aria-labelledby={`task-actions-${task.id}`}
            className="min-w-0 rounded-xl border border-gray-200 bg-gray-50/60 p-4 space-y-3"
          >
            <h4 id={`task-actions-${task.id}`} className="text-sm font-bold text-gray-900">
              Task Actions
            </h4>
            <button
              type="button"
              onClick={() => onViewWorkOrder(task)}
              className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 text-sm font-bold text-green-700 hover:bg-green-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
              style={{ minHeight: 44 }}
            >
              <FileText size={16} />
              {viewWorkOrderLabel}
            </button>
            <div className="border-t border-gray-200 pt-3">
              {task.completion_notes ? (
                <>
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Notes</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{task.completion_notes}</p>
                </>
              ) : (
                <p className="text-sm text-gray-600">Read-only — your team lead updates this task.</p>
              )}
            </div>
          </section>
        )}
      </div>
    </section>
  )
}

// ── The board ────────────────────────────────────────────────────────────────

export interface EmployeeWeeklyTaskBoardProps {
  range: WeekRange
  isThisWeek: boolean
  days: WeeklyTaskDay[]
  unscheduled: EmployeeMyTask[]
  outsideWeekCount: number
  today: string
  selectedDay: string
  /** Assignment id of the one task whose details are open, or null. */
  selectedTaskId: string | null
  focusedTask: EmployeeMyTask | null
  viewWorkOrderLabel: string
  onSelectDay: (day: string) => void
  onSelectTask: (assignmentId: string) => void
  onPreviousWeek: () => void
  onNextWeek: () => void
  onToday: () => void
  hoursDrafts: Record<string, string>
  notesDrafts: Record<string, string>
  savingId: string | null
  actionError: string
  onHoursChange: (assignmentId: string, value: string) => void
  onNotesChange: (assignmentId: string, value: string) => void
  onViewWorkOrder: (task: EmployeeMyTask) => void
  onStartTask: (task: EmployeeMyTask) => void
  onMarkComplete: (task: EmployeeMyTask) => void
  onSaveNotes: (task: EmployeeMyTask) => void
}

export function EmployeeWeeklyTaskBoard(props: EmployeeWeeklyTaskBoardProps) {
  const {
    range,
    isThisWeek,
    days,
    unscheduled,
    outsideWeekCount,
    today,
    selectedDay,
    selectedTaskId,
    focusedTask,
    onSelectDay,
    onSelectTask,
    onPreviousWeek,
    onNextWeek,
    onToday,
  } = props

  /** The one compact-card renderer, shared by the day list, week row and Unscheduled. */
  const renderSummary = (task: EmployeeMyTask, dueLabel: string | null) => (
    <EmployeeTaskSummaryCard
      key={task.id}
      task={task}
      selected={task.id === selectedTaskId}
      dueLabel={dueLabel}
      onSelect={onSelectTask}
    />
  )

  const selected = days.find((day) => day.date === selectedDay) ?? null
  const focusedDayLabel = focusedTask?.due_date ? formatDayLabel(focusedTask.due_date).full : null

  // Position inside its own day, from the day buckets already built for the week.
  const focusedDay = focusedTask
    ? days.find((day) => day.tasks.some((entry) => entry.id === focusedTask.id)) ?? null
    : null
  const focusedIndex = focusedDay && focusedTask
    ? focusedDay.tasks.findIndex((entry) => entry.id === focusedTask.id)
    : -1
  const focusedPositionLabel =
    focusedDay && focusedIndex >= 0 && focusedDay.tasks.length > 1
      ? `Task ${focusedIndex + 1} of ${focusedDay.tasks.length}`
      : null

  return (
    <div className="space-y-4">
      {/* Week navigation — spans the same content width as the week row */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onPreviousWeek}
            aria-label="Previous week"
            className="flex-shrink-0 flex items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            style={{ minHeight: 44, minWidth: 44 }}
          >
            <ChevronLeft size={18} />
          </button>

          <div className="min-w-0 flex-1 text-center">
            <h3 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
              {formatWeekRangeLabel(range)}
            </h3>
            <p className="text-sm font-medium text-gray-500">
              {isThisWeek ? 'This week' : 'Selected week'}
            </p>
          </div>

          <button
            type="button"
            onClick={onToday}
            disabled={isThisWeek}
            className="flex-shrink-0 rounded-xl border border-green-200 bg-green-50 px-4 text-sm font-bold text-green-700 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ minHeight: 44 }}
          >
            Today
          </button>

          <button
            type="button"
            onClick={onNextWeek}
            aria-label="Next week"
            className="flex-shrink-0 flex items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            style={{ minHeight: 44, minWidth: 44 }}
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Phone + tablet: seven-day selector strip, always one row */}
        <div className="grid grid-cols-7 gap-1 lg:hidden">
          {days.map((day) => {
            const label = formatDayLabel(day.date)
            const active = day.date === selectedDay
            const isToday = day.date === today
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => onSelectDay(day.date)}
                aria-pressed={active}
                aria-label={`${label.full}, ${day.tasks.length} tasks`}
                className={`min-w-0 flex flex-col items-center justify-center gap-1 rounded-xl border px-0.5 py-2 ${
                  active
                    ? 'bg-green-600 border-green-600 text-white'
                    : isToday
                      ? 'bg-white border-green-300 text-green-800'
                      : 'bg-white border-gray-200 text-gray-600'
                }`}
                style={{ minHeight: 58 }}
              >
                <span className="text-xs font-bold uppercase leading-none">{label.weekdayInitial}</span>
                <span className="text-base font-bold leading-none">{label.dayNumber}</span>
                <span
                  className={`text-xs font-bold leading-none ${
                    active ? 'text-white' : day.tasks.length > 0 ? 'text-green-700' : 'text-gray-400'
                  }`}
                >
                  {day.tasks.length}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Phone + tablet: the selected day's compact cards */}
      <div className="lg:hidden">
        {selected && (
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-base font-bold text-gray-900">{formatDayLabel(selected.date).full}</p>
              <span className="text-sm font-bold text-gray-600">
                {selected.tasks.length} {selected.tasks.length === 1 ? 'task' : 'tasks'}
              </span>
            </div>
            {selected.tasks.length === 0 ? (
              <p className="text-sm text-gray-600">No tasks scheduled for this day.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {selected.tasks.map((task) => renderSummary(task, null))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop: seven equal day columns on one row, Monday through Sunday */}
      <div className="hidden lg:grid lg:grid-cols-7 gap-2 xl:gap-3 items-start">
        {days.map((day) => {
          const label = formatDayLabel(day.date)
          const isToday = day.date === today
          return (
            <section
              key={day.date}
              className={`min-w-0 rounded-2xl border bg-white p-2 xl:p-2.5 shadow-sm space-y-2 ${
                isToday ? 'border-green-300 ring-1 ring-green-200' : 'border-gray-200'
              }`}
            >
              <div className="border-b border-gray-100 pb-2">
                <div className="flex items-center justify-between gap-1">
                  <p className={`text-base font-bold truncate ${isToday ? 'text-green-800' : 'text-gray-900'}`}>
                    {label.weekday}
                  </p>
                  <span
                    className={`flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-full border ${
                      day.tasks.length > 0
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-gray-50 text-gray-500 border-gray-200'
                    }`}
                  >
                    {day.tasks.length}
                  </span>
                </div>
                <p className={`text-sm font-semibold truncate ${isToday ? 'text-green-700' : 'text-gray-600'}`}>
                  {label.monthDay}
                </p>
              </div>
              {day.tasks.length === 0 ? (
                <p className="text-xs text-gray-500">No tasks</p>
              ) : (
                <div className="space-y-2">
                  {day.tasks.map((task) => renderSummary(task, null))}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {/* Unscheduled — tasks with no usable due date, never dropped */}
      {unscheduled.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <p className="text-base font-bold text-gray-900">Unscheduled</p>
            </div>
            <span className="text-sm font-bold text-gray-600">
              {unscheduled.length} {unscheduled.length === 1 ? 'task' : 'tasks'}
            </span>
          </div>
          <p className="text-sm text-gray-600">No due date set for these tasks.</p>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
            {unscheduled.map((task) => renderSummary(task, 'No due date'))}
          </div>
        </div>
      )}

      {/* The one focused task-detail area, full width below the week */}
      <EmployeeFocusedTaskPanel
        task={focusedTask}
        dayLabel={focusedDayLabel}
        positionLabel={focusedPositionLabel}
        viewWorkOrderLabel={props.viewWorkOrderLabel}
        hoursDraft={focusedTask ? props.hoursDrafts[focusedTask.id] ?? '' : ''}
        notesDraft={focusedTask ? props.notesDrafts[focusedTask.id] ?? '' : ''}
        busy={!!focusedTask && props.savingId === focusedTask.id}
        errorMessage={props.actionError}
        onHoursChange={props.onHoursChange}
        onNotesChange={props.onNotesChange}
        onViewWorkOrder={props.onViewWorkOrder}
        onStartTask={props.onStartTask}
        onMarkComplete={props.onMarkComplete}
        onSaveNotes={props.onSaveNotes}
      />

      {outsideWeekCount > 0 && (
        <p className="text-xs text-gray-400 text-center">
          {outsideWeekCount} other active {outsideWeekCount === 1 ? 'task is' : 'tasks are'} scheduled outside this week.
        </p>
      )}
    </div>
  )
}

export default EmployeeWeeklyTaskBoard
