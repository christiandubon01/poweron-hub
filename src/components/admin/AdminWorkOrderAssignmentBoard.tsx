import React, { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Pencil,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { getTenantWorkDate } from '@/services/employeeTimeService'
import type { AdminEmployeeProfile } from '@/services/adminTimecardService'
import type { EmployeeTaskAssignment } from '@/services/employeeTaskAssignmentService'
import {
  formatWorkOrderHours,
  isArchivedAssignment,
  presentAssignedActualVariance,
} from '@/features/work-orders'
import {
  adminAssignmentWeekdayLabels,
  buildAdminAssignmentMonth,
  filterAdminAssignments,
  formatAdminAssignmentMonthTitle,
  formatAdminAssignmentWeekRange,
  getAdminAssignmentWeek,
  groupAdminAssignmentsByDueDate,
  isAssignmentDayInMonth,
  parseAssignmentDay,
  shiftAdminAssignmentMonth,
  shiftAdminAssignmentWeek,
  type AdminAssignmentCalendarFilter,
  type AdminAssignmentCalendarView,
} from './adminAssignmentCalendar'

type BoardActionResult = { success: boolean; error?: string }

const STATUS_PILL: Record<string, string> = {
  assigned: 'border-gray-600 bg-gray-700/60 text-gray-300',
  in_progress: 'border-amber-700/50 bg-amber-600/20 text-amber-300',
  completed: 'border-green-700/50 bg-green-600/20 text-green-300',
}

const TENANT_TIMEZONE = 'America/Los_Angeles'
const MONTH_VISIBLE_LIMIT = 3

interface AssignmentBoardProps {
  assignments: EmployeeTaskAssignment[]
  employees: AdminEmployeeProfile[]
  filter: AdminAssignmentCalendarFilter
  onFilterChange: (filter: AdminAssignmentCalendarFilter) => void
  onAssign: () => void
  onEdit: (assignment: EmployeeTaskAssignment) => void
  onArchive: (assignment: EmployeeTaskAssignment) => Promise<BoardActionResult>
  onRestore: (assignment: EmployeeTaskAssignment) => Promise<BoardActionResult>
  onDelete: (assignment: EmployeeTaskAssignment) => Promise<BoardActionResult>
  actionBusy?: boolean
  renderRating?: (assignment: EmployeeTaskAssignment) => React.ReactNode
}

export function AdminWorkOrderAssignmentBoard({
  assignments,
  employees,
  filter,
  onFilterChange,
  onAssign,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  actionBusy = false,
  renderRating,
}: AssignmentBoardProps) {
  const today = getTenantWorkDate()
  const [view, setView] = useState<AdminAssignmentCalendarView>('week')
  const [week, setWeek] = useState(() => getAdminAssignmentWeek(today))
  const [monthAnchor, setMonthAnchor] = useState(today)
  const [selectedDay, setSelectedDay] = useState(today)
  const [details, setDetails] = useState<EmployeeTaskAssignment | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState<EmployeeTaskAssignment | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<EmployeeTaskAssignment | null>(null)
  const [actionError, setActionError] = useState('')

  const employeesById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  )
  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => !isArchivedAssignment(assignment)),
    [assignments],
  )
  const archivedAssignments = useMemo(
    () => assignments.filter((assignment) => isArchivedAssignment(assignment)),
    [assignments],
  )
  const visibleAssignments = useMemo(
    () => filterAdminAssignments(activeAssignments, filter),
    [activeAssignments, filter],
  )
  const grouped = useMemo(
    () => groupAdminAssignmentsByDueDate(visibleAssignments),
    [visibleAssignments],
  )
  const month = useMemo(() => buildAdminAssignmentMonth(monthAnchor), [monthAnchor])
  const filterCounts = useMemo(() => ({
    all: filterAdminAssignments(activeAssignments, 'all').length,
    pending: filterAdminAssignments(activeAssignments, 'pending').length,
    completed: filterAdminAssignments(activeAssignments, 'completed').length,
  }), [activeAssignments])

  useEffect(() => {
    if (!details) return
    const next = assignments.find((row) => row.id === details.id) ?? null
    setDetails(next)
  }, [assignments, details?.id])

  const goToday = () => {
    setSelectedDay(today)
    if (view === 'week') setWeek(getAdminAssignmentWeek(today))
    else setMonthAnchor(today)
  }

  const movePrevious = () => {
    if (view === 'week') {
      const next = shiftAdminAssignmentWeek(week, -1)
      setWeek(next)
      setSelectedDay(next.startDate)
    } else {
      const next = shiftAdminAssignmentMonth(monthAnchor, -1)
      setMonthAnchor(next)
      setSelectedDay(next)
    }
  }

  const moveNext = () => {
    if (view === 'week') {
      const next = shiftAdminAssignmentWeek(week, 1)
      setWeek(next)
      setSelectedDay(next.startDate)
    } else {
      const next = shiftAdminAssignmentMonth(monthAnchor, 1)
      setMonthAnchor(next)
      setSelectedDay(next)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-5 w-5 shrink-0 text-teal-400" />
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-100">Task Assignments</h2>
            <p className="truncate text-sm text-gray-400">
              {view === 'week' ? formatAdminAssignmentWeekRange(week) : formatAdminAssignmentMonthTitle(monthAnchor)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setArchivedOpen(true)}
            className="min-h-11 rounded-xl border border-gray-600 bg-[var(--bg-secondary)] px-3 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-teal-700/70 hover:text-teal-200"
            aria-label={`Archived Work Orders (${archivedAssignments.length})`}
          >
            Archived Work Orders ({archivedAssignments.length})
          </button>
          <button
            type="button"
            onClick={onAssign}
            className="min-h-11 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500"
            aria-label="Assign Work Order"
          >
            Assign Work Order
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-700/60 bg-[var(--bg-secondary)] p-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={movePrevious} className="calendar-control" aria-label={`Previous ${view}`}>
            <ChevronLeft size={16} /> <span className="hidden sm:inline">Previous</span>
          </button>
          <button type="button" onClick={goToday} className="calendar-control">Today</button>
          <button type="button" onClick={moveNext} className="calendar-control" aria-label={`Next ${view}`}>
            <span className="hidden sm:inline">Next</span> <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex rounded-lg border border-gray-600 bg-black/10 p-1" aria-label="Calendar view">
          {(['week', 'month'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setView(option)
                setSelectedDay(today)
                if (option === 'week') setWeek(getAdminAssignmentWeek(today))
                else setMonthAnchor(today)
              }}
              className={`min-h-9 rounded-md px-3 text-sm font-semibold capitalize ${
                view === option ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-gray-100'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-gray-700/60">
        {(['all', 'pending', 'completed'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onFilterChange(option)}
            className={`min-h-10 rounded-t-lg px-4 text-sm font-semibold capitalize ${
              filter === option
                ? 'border border-b-0 border-gray-700/60 bg-[var(--bg-secondary)] text-teal-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {option === 'pending' ? 'Pending / Active' : option} ({filterCounts[option]})
          </button>
        ))}
      </div>

      {view === 'week' ? (
        <WeekBoard
          weekDates={week.dates}
          selectedDay={selectedDay}
          onSelectedDay={setSelectedDay}
          grouped={grouped.byDate}
          employeesById={employeesById}
          today={today}
          onOpen={setDetails}
          renderRating={renderRating}
        />
      ) : (
        <MonthBoard
          dates={month.dates}
          anchor={monthAnchor}
          selectedDay={selectedDay}
          onSelectedDay={setSelectedDay}
          grouped={grouped.byDate}
          employeesById={employeesById}
          today={today}
          onOpen={setDetails}
          renderRating={renderRating}
        />
      )}

      {grouped.unscheduled.length > 0 ? (
        <section className="rounded-xl border border-dashed border-gray-600 bg-[var(--bg-secondary)] p-3">
          <h3 className="mb-2 text-sm font-bold text-gray-200">Unscheduled</h3>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {grouped.unscheduled.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                employeesById={employeesById}
                onOpen={setDetails}
                rating={assignment.status === 'completed' ? renderRating?.(assignment) : null}
              />
            ))}
          </div>
        </section>
      ) : null}

      {visibleAssignments.length === 0 ? (
        <p className="rounded-xl border border-gray-700/60 py-8 text-center text-sm text-gray-500">
          No {filter === 'all' ? '' : `${filter} `}assignments in this board.
        </p>
      ) : null}

      {details ? (
        <AdminWorkOrderAssignmentDetails
          assignment={details}
          employeesById={employeesById}
          onClose={() => {
            setDetails(null)
            setActionError('')
          }}
          onEdit={isArchivedAssignment(details) ? undefined : () => {
            setDetails(null)
            onEdit(details)
          }}
          onArchive={isArchivedAssignment(details) ? undefined : () => {
            setActionError('')
            setConfirmArchive(details)
          }}
          onRestore={isArchivedAssignment(details) ? () => {
            setActionError('')
            void (async () => {
              const result = await onRestore(details)
              if (!result.success) setActionError(result.error || 'Could not restore Work Order.')
              else setDetails(null)
            })()
          } : undefined}
          onDelete={() => {
            setActionError('')
            setConfirmDelete(details)
          }}
          actionBusy={actionBusy}
          actionError={actionError}
          rating={details.status === 'completed' && !isArchivedAssignment(details) ? renderRating?.(details) : null}
        />
      ) : null}

      {archivedOpen ? (
        <ArchivedWorkOrdersBucket
          assignments={archivedAssignments}
          employeesById={employeesById}
          onClose={() => setArchivedOpen(false)}
          onOpen={(assignment) => {
            setArchivedOpen(false)
            setDetails(assignment)
          }}
        />
      ) : null}

      {confirmArchive ? (
        <ConfirmArchiveDialog
          assignment={confirmArchive}
          busy={actionBusy}
          onCancel={() => setConfirmArchive(null)}
          onConfirm={() => {
            void (async () => {
              const target = confirmArchive
              const result = await onArchive(target)
              if (!result.success) {
                setActionError(result.error || 'Could not archive Work Order.')
                setConfirmArchive(null)
                return
              }
              setConfirmArchive(null)
              setDetails(null)
            })()
          }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmPermanentDeleteDialog
          assignment={confirmDelete}
          busy={actionBusy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            void (async () => {
              const target = confirmDelete
              const result = await onDelete(target)
              if (!result.success) {
                setActionError(result.error || 'Could not permanently delete Work Order.')
                setConfirmDelete(null)
                return
              }
              setConfirmDelete(null)
              setDetails(null)
              setArchivedOpen(false)
            })()
          }}
        />
      ) : null}

      <style>{`
        .calendar-control {
          display: inline-flex;
          min-height: 40px;
          align-items: center;
          gap: 0.25rem;
          border-radius: 0.5rem;
          padding: 0 0.65rem;
          color: rgb(209 213 219);
          font-size: 0.875rem;
          font-weight: 600;
        }
        .calendar-control:hover { background: rgb(55 65 81 / 0.65); color: white; }
      `}</style>
    </div>
  )
}

function WeekBoard({
  weekDates,
  selectedDay,
  onSelectedDay,
  grouped,
  employeesById,
  today,
  onOpen,
  renderRating,
}: {
  weekDates: string[]
  selectedDay: string
  onSelectedDay: (day: string) => void
  grouped: Map<string, EmployeeTaskAssignment[]>
  employeesById: Map<string, AdminEmployeeProfile>
  today: string
  onOpen: (assignment: EmployeeTaskAssignment) => void
  renderRating?: (assignment: EmployeeTaskAssignment) => React.ReactNode
}) {
  const weekdays = adminAssignmentWeekdayLabels()
  const selected = weekDates.includes(selectedDay) ? selectedDay : weekDates[0]
  return (
    <>
      <div className="grid grid-cols-7 gap-1 lg:hidden" aria-label="Week day selector">
        {weekDates.map((day, index) => (
          <button
            key={day}
            type="button"
            onClick={() => onSelectedDay(day)}
            className={`min-h-14 rounded-lg border px-1 text-center ${
              selected === day
                ? 'border-teal-500 bg-teal-600/20 text-teal-200'
                : day === today
                  ? 'border-teal-800 bg-teal-950/20 text-gray-200'
                  : 'border-gray-700 bg-[var(--bg-secondary)] text-gray-400'
            }`}
          >
            <span className="block text-[10px] font-semibold uppercase">{weekdays[index]}</span>
            <span className="block text-sm font-bold">{parseAssignmentDay(day)?.getDate()}</span>
            <span className="block text-[10px]">{grouped.get(day)?.length ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="space-y-2 lg:hidden">
        {(grouped.get(selected) ?? []).map((assignment) => (
          <AssignmentCard
            key={assignment.id}
            assignment={assignment}
            employeesById={employeesById}
            onOpen={onOpen}
            rating={assignment.status === 'completed' ? renderRating?.(assignment) : null}
          />
        ))}
        {(grouped.get(selected) ?? []).length === 0 ? (
          <EmptyDay />
        ) : null}
      </div>
      <div className="hidden grid-cols-7 gap-2 lg:grid">
        {weekDates.map((day, index) => (
          <section
            key={day}
            className={`min-w-0 rounded-xl border p-2 ${
              day === today ? 'border-teal-700/70 bg-teal-950/10' : 'border-gray-700/60 bg-[var(--bg-secondary)]'
            }`}
          >
            <div className="mb-2 border-b border-gray-700/50 pb-2 text-center">
              <p className="text-[11px] font-semibold uppercase text-gray-500">{weekdays[index]}</p>
              <p className="text-sm font-bold text-gray-200">{parseAssignmentDay(day)?.getDate()}</p>
            </div>
            <div className="space-y-2">
              {(grouped.get(day) ?? []).map((assignment) => (
                <AssignmentCard
                  key={assignment.id}
                  assignment={assignment}
                  employeesById={employeesById}
                  onOpen={onOpen}
                  compact
                  rating={assignment.status === 'completed' ? renderRating?.(assignment) : null}
                />
              ))}
              {(grouped.get(day) ?? []).length === 0 ? <EmptyDay /> : null}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}

function MonthBoard({
  dates,
  anchor,
  selectedDay,
  onSelectedDay,
  grouped,
  employeesById,
  today,
  onOpen,
  renderRating,
}: {
  dates: string[]
  anchor: string
  selectedDay: string
  onSelectedDay: (day: string) => void
  grouped: Map<string, EmployeeTaskAssignment[]>
  employeesById: Map<string, AdminEmployeeProfile>
  today: string
  onOpen: (assignment: EmployeeTaskAssignment) => void
  renderRating?: (assignment: EmployeeTaskAssignment) => React.ReactNode
}) {
  const weekdays = adminAssignmentWeekdayLabels()
  const selected = dates.includes(selectedDay) ? selectedDay : dates.find((day) => isAssignmentDayInMonth(day, anchor)) ?? dates[0]
  return (
    <>
      <div className="lg:hidden">
        <div className="mb-1 grid grid-cols-7 gap-1">
          {weekdays.map((day) => <p key={day} className="text-center text-[10px] font-semibold uppercase text-gray-600">{day}</p>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {dates.map((day) => {
            const count = grouped.get(day)?.length ?? 0
            return (
              <button
                key={day}
                type="button"
                onClick={() => onSelectedDay(day)}
                className={`min-h-11 rounded-md border text-xs ${
                  selected === day
                    ? 'border-teal-500 bg-teal-600/20 text-teal-200'
                    : day === today
                      ? 'border-teal-800 text-gray-200'
                      : isAssignmentDayInMonth(day, anchor)
                        ? 'border-gray-700 bg-[var(--bg-secondary)] text-gray-300'
                        : 'border-gray-800 text-gray-600'
                }`}
                aria-label={`${formatAdminAssignmentDay(day)}, ${count} assignments`}
              >
                <span className="block font-bold">{parseAssignmentDay(day)?.getDate()}</span>
                <span className={`mx-auto mt-0.5 block h-1.5 w-1.5 rounded-full ${count ? 'bg-teal-400' : 'bg-transparent'}`} />
              </button>
            )
          })}
        </div>
        <div className="mt-3 space-y-2">
          {(grouped.get(selected) ?? []).map((assignment) => (
            <AssignmentCard
              key={assignment.id}
              assignment={assignment}
              employeesById={employeesById}
              onOpen={onOpen}
              rating={assignment.status === 'completed' ? renderRating?.(assignment) : null}
            />
          ))}
          {(grouped.get(selected) ?? []).length === 0 ? <EmptyDay /> : null}
        </div>
      </div>
      <div className="hidden lg:block">
        <div className="grid grid-cols-7 gap-1">
          {weekdays.map((day) => <p key={day} className="pb-1 text-center text-xs font-semibold uppercase text-gray-500">{day}</p>)}
          {dates.map((day) => {
            const rows = grouped.get(day) ?? []
            const hidden = Math.max(0, rows.length - MONTH_VISIBLE_LIMIT)
            return (
              <section
                key={day}
                className={`min-h-32 min-w-0 rounded-lg border p-1.5 ${
                  day === today
                    ? 'border-teal-700/70 bg-teal-950/10'
                    : isAssignmentDayInMonth(day, anchor)
                      ? 'border-gray-700/60 bg-[var(--bg-secondary)]'
                      : 'border-gray-800/60 bg-black/10'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectedDay(day)}
                  className={`mb-1 h-7 w-7 rounded-full text-xs font-bold ${
                    day === today ? 'bg-teal-600 text-white' : isAssignmentDayInMonth(day, anchor) ? 'text-gray-300' : 'text-gray-600'
                  }`}
                  aria-label={`Open ${formatAdminAssignmentDay(day)}`}
                >
                  {parseAssignmentDay(day)?.getDate()}
                </button>
                <div className="space-y-1">
                  {rows.slice(0, MONTH_VISIBLE_LIMIT).map((assignment) => (
                    <MonthAssignmentChip
                      key={assignment.id}
                      assignment={assignment}
                      employeesById={employeesById}
                      onOpen={onOpen}
                    />
                  ))}
                  {hidden > 0 ? (
                    <button
                      type="button"
                      onClick={() => onSelectedDay(day)}
                      className="w-full rounded bg-gray-800/70 px-1.5 py-1 text-left text-[11px] font-semibold text-teal-300 hover:bg-gray-700"
                    >
                      +{hidden} more
                    </button>
                  ) : null}
                </div>
              </section>
            )
          })}
        </div>
        {(grouped.get(selected) ?? []).length > MONTH_VISIBLE_LIMIT ? (
          <section className="mt-3 rounded-xl border border-gray-700/60 bg-[var(--bg-secondary)] p-3">
            <h3 className="mb-2 text-sm font-bold text-gray-200">{formatAdminAssignmentDay(selected)}</h3>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {(grouped.get(selected) ?? []).map((assignment) => (
                <AssignmentCard
                  key={assignment.id}
                  assignment={assignment}
                  employeesById={employeesById}
                  onOpen={onOpen}
                  rating={assignment.status === 'completed' ? renderRating?.(assignment) : null}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  )
}

function AssignmentCard({
  assignment,
  employeesById,
  onOpen,
  compact = false,
  rating,
}: {
  assignment: EmployeeTaskAssignment
  employeesById: Map<string, AdminEmployeeProfile>
  onOpen: (assignment: EmployeeTaskAssignment) => void
  compact?: boolean
  rating?: React.ReactNode
}) {
  const employeeLabel = assignmentEmployeeLabel(assignment, employeesById)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(assignment)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(assignment)
        }
      }}
      className="w-full rounded-lg border border-gray-700 bg-[#151b27] p-2 text-left transition hover:border-teal-700/70 hover:bg-[#192230]"
      aria-label={`Open ${assignment.work_package_name} assignment`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <p className="line-clamp-2 min-w-0 text-xs font-bold leading-snug text-gray-100">{assignment.work_package_name}</p>
        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${STATUS_PILL[assignment.status] ?? STATUS_PILL.assigned}`}>
          {assignment.status.replace('_', ' ')}
        </span>
      </div>
      <p className="mt-1 truncate text-[11px] text-gray-400">{assignment.project_name || 'Project'}</p>
      <p className="mt-1 truncate text-[11px] text-gray-300"><Users size={10} className="mr-1 inline" />{employeeLabel}</p>
      <div className={`mt-1.5 ${compact ? 'space-y-0.5' : 'flex flex-wrap gap-x-3 gap-y-1'} text-[11px] text-gray-400`}>
        <p><strong className="text-gray-300">Assigned Hours:</strong> {formatHours(assignment.assigned_hours)}</p>
        <p><strong className="text-gray-300">Assigned:</strong> {formatDateTime(assignment.assigned_at)}</p>
        <p><strong className="text-gray-300">Scheduled by:</strong> {assignment.scheduled_by_name || 'Owner / Admin'}</p>
      </div>
      {assignment.status === 'completed' ? (
        <p className="mt-1.5 line-clamp-2 text-[11px] text-green-300/90">
          Completed by {assignment.completed_by_name || 'Employee'}
          {assignment.completed_at ? ` · ${formatDateTime(assignment.completed_at)}` : ''}
          {assignment.hours_spent != null ? ` · ${formatHours(assignment.hours_spent)}` : ''}
        </p>
      ) : null}
      {assignment.status === 'completed' && assignment.completion_notes ? (
        <p className="mt-1.5 line-clamp-2 text-[11px] italic text-gray-400">{assignment.completion_notes}</p>
      ) : null}
      {rating ? <div className="mt-2 border-t border-gray-700/60 pt-2" onClick={(event) => event.stopPropagation()}>{rating}</div> : null}
    </div>
  )
}

function MonthAssignmentChip({
  assignment,
  employeesById,
  onOpen,
}: {
  assignment: EmployeeTaskAssignment
  employeesById: Map<string, AdminEmployeeProfile>
  onOpen: (assignment: EmployeeTaskAssignment) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(assignment)}
      className={`block w-full rounded border px-1.5 py-1 text-left ${
        assignment.status === 'completed'
          ? 'border-green-800/60 bg-green-950/25'
          : assignment.status === 'in_progress'
            ? 'border-amber-800/60 bg-amber-950/20'
            : 'border-gray-700 bg-[#151b27]'
      }`}
      title={`${assignment.work_package_name} · ${assignment.project_name || 'Project'} · ${assignmentEmployeeLabel(assignment, employeesById)} · ${formatHours(assignment.assigned_hours)}`}
    >
      <p className="truncate text-[10px] font-bold text-gray-200">{assignment.work_package_name}</p>
      <p className="truncate text-[9px] text-gray-500">{assignment.project_name || 'Project'} · {formatHours(assignment.assigned_hours)}</p>
      <p className="truncate text-[9px] text-gray-500">
        {assignmentEmployeeLabel(assignment, employeesById)} · {assignment.status.replace('_', ' ')}
      </p>
    </button>
  )
}

export function AdminWorkOrderAssignmentDetails({
  assignment,
  employeesById,
  onClose,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  actionBusy = false,
  actionError = '',
  rating,
}: {
  assignment: EmployeeTaskAssignment
  employeesById: Map<string, AdminEmployeeProfile>
  onClose: () => void
  onEdit?: () => void
  onArchive?: () => void
  onRestore?: () => void
  onDelete?: () => void
  actionBusy?: boolean
  actionError?: string
  rating?: React.ReactNode
}) {
  const employeeNames = (assignment.assigned_employee_ids ?? [])
    .map((id) => employeesById.get(id)?.display_name || 'Employee')
  const archived = isArchivedAssignment(assignment)
  const comparison = presentAssignedActualVariance({
    assignedHours: assignment.assigned_hours,
    actualHours: assignment.hours_spent,
    completed: assignment.status === 'completed',
  })
  const varianceToneClass =
    comparison.varianceTone === 'over'
      ? 'text-amber-300'
      : comparison.varianceTone === 'under'
        ? 'text-sky-300'
        : comparison.varianceTone === 'on_target'
          ? 'text-green-300'
          : 'text-gray-400'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 px-3 sm:items-center" onClick={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-[var(--bg-card,#1e2433)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-700/60 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-400">
              {archived ? 'Archived Work Order' : 'Work Order Assignment'}
            </p>
            <h3 className="mt-1 text-lg font-bold text-gray-100">{assignment.work_package_name}</h3>
            <p className="text-sm text-gray-400">{assignment.project_name || 'Project'}</p>
          </div>
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-lg p-2 text-gray-500 hover:bg-gray-700/50 hover:text-gray-200" aria-label="Close assignment details">
            <X className="mx-auto h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {actionError ? (
            <p className="rounded-xl border border-red-700/50 bg-red-900/20 px-3 py-2 text-sm text-red-300">{actionError}</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Detail
              label="Source"
              value={
                assignment.work_package_id
                  ? 'Work Package Work Order'
                  : assignment.blueprint_set_id
                    ? 'Blueprint Work Order'
                    : 'Project Work Order'
              }
            />
            <Detail label="Project" value={assignment.project_name || 'Project'} />
            {assignment.blueprint_set_id ? (
              <Detail
                label="Blueprint / Document"
                value={assignment.blueprint_title || assignment.blueprint_set_id}
                icon={<FileText size={14} />}
              />
            ) : null}
            {assignment.work_package_id ? (
              <Detail label="Work Package" value={assignment.work_package_name} />
            ) : null}
            <Detail label="Scheduled for" value={formatAdminAssignmentDay(assignment.due_date)} icon={<CalendarDays size={14} />} />
            <Detail label="Assigned Hours" value={formatHours(assignment.assigned_hours)} icon={<Clock3 size={14} />} />
            <Detail label="Status" value={assignment.status.replace('_', ' ')} />
            <Detail label="Assigned" value={formatDateTime(assignment.assigned_at)} />
            <Detail label="Scheduled by" value={assignment.scheduled_by_name || 'Owner / Admin'} />
          </div>

          <section className="rounded-xl border border-gray-700/60 bg-[var(--bg-secondary)] p-3" aria-label="Assigned versus actual hours">
            <h4 className="text-xs font-semibold uppercase text-gray-500">Hours comparison</h4>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[11px] font-semibold uppercase text-gray-500">Assigned</p>
                <p className="mt-1 text-base font-bold text-gray-100">{comparison.assignedLabel}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-gray-500">Actual</p>
                <p className="mt-1 text-base font-bold text-gray-100">{comparison.actualLabel}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase text-gray-500">Variance</p>
                <p className={`mt-1 text-base font-bold ${varianceToneClass}`}>{comparison.varianceLabel}</p>
              </div>
            </div>
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase text-gray-500">Assigned employees</h4>
            <p className="mt-1 text-sm text-gray-200">{employeeNames.join(', ') || 'No employees'}</p>
          </section>

          <section className="rounded-xl border border-gray-700/60 bg-[var(--bg-secondary)] p-3">
            <h4 className="text-xs font-semibold uppercase text-gray-500">Work Order Instructions</h4>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-200">
              {assignment.work_order_instructions || 'No assignment-specific instructions.'}
            </p>
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase text-gray-500">Snapshots</h4>
            <p className="mt-1 text-sm text-gray-200">
              {assignment.current_snapshot_ids?.length ?? 0} ordered attachment{assignment.current_snapshot_ids?.length === 1 ? '' : 's'}
            </p>
            {(assignment.current_snapshot_ids?.length ?? 0) > 0 ? (
              <ol className="mt-2 flex flex-wrap gap-1.5" aria-label="Snapshot attachment order">
                {assignment.current_snapshot_ids?.map((snapshotId, index) => (
                  <li key={snapshotId} className="rounded-full border border-gray-700 bg-[var(--bg-secondary)] px-2 py-1 text-xs text-gray-400">
                    Attachment {index + 1}
                  </li>
                ))}
              </ol>
            ) : null}
          </section>

          {assignment.status === 'completed' ? (
            <section className="rounded-xl border border-green-800/50 bg-green-950/15 p-3">
              <h4 className="text-xs font-semibold uppercase text-green-400">Completion</h4>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <CompletionFact label="Completed by" value={assignment.completed_by_name || 'Employee'} />
                <CompletionFact label="Completed on" value={formatDateTime(assignment.completed_at)} />
                <CompletionFact label="Recorded hours" value={assignment.hours_spent != null ? formatHours(assignment.hours_spent) : 'Not recorded'} />
              </dl>
              {assignment.completion_notes ? (
                <div className="mt-3 border-t border-green-900/50 pt-3">
                  <p className="text-xs font-semibold uppercase text-green-500/80">Completion notes</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-200">{assignment.completion_notes}</p>
                </div>
              ) : null}
              {rating ? <div className="mt-3 border-t border-green-900/50 pt-2">{rating}</div> : null}
            </section>
          ) : null}

          {archived ? (
            <section className="rounded-xl border border-gray-600/60 bg-gray-900/30 p-3">
              <h4 className="text-xs font-semibold uppercase text-gray-400">Archive</h4>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <CompletionFact label="Archived on" value={formatDateTime(assignment.archived_at)} />
                <CompletionFact label="Archived by" value={assignment.archived_by_name || 'Owner / Admin'} />
              </dl>
            </section>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-gray-700/60 px-5 py-4">
          <button type="button" onClick={onClose} disabled={actionBusy} className="min-h-11 flex-1 rounded-xl bg-gray-700 px-4 text-sm font-semibold text-gray-200 hover:bg-gray-600 disabled:opacity-50">
            Close
          </button>
          {onEdit ? (
            <button type="button" onClick={onEdit} disabled={actionBusy} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50">
              <Pencil size={15} /> Edit Assignment
            </button>
          ) : null}
          {onArchive ? (
            <button type="button" onClick={onArchive} disabled={actionBusy} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-gray-600 px-4 text-sm font-semibold text-gray-200 hover:bg-gray-700/60 disabled:opacity-50">
              <Archive size={15} /> Archive
            </button>
          ) : null}
          {onRestore ? (
            <button type="button" onClick={onRestore} disabled={actionBusy} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50">
              <ArchiveRestore size={15} /> Restore
            </button>
          ) : null}
          {onDelete ? (
            <button type="button" onClick={onDelete} disabled={actionBusy} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-red-800/70 bg-red-950/30 px-4 text-sm font-semibold text-red-300 hover:bg-red-900/40 disabled:opacity-50">
              <Trash2 size={15} /> Delete
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Detail({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-700/50 bg-[var(--bg-secondary)] px-3 py-2">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase text-gray-500">{icon}{label}</p>
      <p className="mt-1 text-sm font-medium capitalize text-gray-200">{value}</p>
    </div>
  )
}

function CompletionFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-gray-200">{value}</dd>
    </div>
  )
}

function EmptyDay() {
  return <p className="rounded-lg border border-dashed border-gray-700 px-2 py-4 text-center text-xs text-gray-600">No assignments</p>
}

function assignmentEmployeeLabel(
  assignment: EmployeeTaskAssignment,
  employeesById: Map<string, AdminEmployeeProfile>,
): string {
  const ids = assignment.assigned_employee_ids ?? []
  if (ids.length === 0) return 'No employees'
  if (ids.length === 1) return employeesById.get(ids[0])?.display_name || 'Employee'
  const first = employeesById.get(ids[0])?.display_name || 'Employee'
  return `${first} +${ids.length - 1}`
}

function formatHours(value: number | null | undefined): string {
  return formatWorkOrderHours(value)
}

function ArchivedWorkOrdersBucket({
  assignments,
  employeesById,
  onClose,
  onOpen,
}: {
  assignments: EmployeeTaskAssignment[]
  employeesById: Map<string, AdminEmployeeProfile>
  onClose: () => void
  onOpen: (assignment: EmployeeTaskAssignment) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 px-3 sm:items-center" onClick={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-[var(--bg-card,#1e2433)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-700/60 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-400">Task Assignments</p>
            <h3 className="text-lg font-bold text-gray-100">Archived Work Orders ({assignments.length})</h3>
            <p className="text-sm text-gray-400">Hidden from active boards and employee queues. Details remain fully readable.</p>
          </div>
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-lg p-2 text-gray-500 hover:bg-gray-700/50 hover:text-gray-200" aria-label="Close archived Work Orders">
            <X className="mx-auto h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2 overflow-y-auto px-5 py-4">
          {assignments.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-700 px-3 py-8 text-center text-sm text-gray-500">
              No archived Work Orders.
            </p>
          ) : (
            assignments.map((assignment) => {
              const comparison = presentAssignedActualVariance({
                assignedHours: assignment.assigned_hours,
                actualHours: assignment.hours_spent,
              })
              return (
                <button
                  key={assignment.id}
                  type="button"
                  onClick={() => onOpen(assignment)}
                  className="w-full rounded-xl border border-gray-700 bg-[#151b27] p-3 text-left transition hover:border-teal-700/70"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-gray-100">{assignment.work_package_name}</p>
                    <span className="shrink-0 rounded-full border border-gray-600 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-400">
                      {assignment.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">{assignment.project_name || 'Project'}</p>
                  <p className="mt-1 text-xs text-gray-300">{assignmentEmployeeLabel(assignment, employeesById)}</p>
                  <p className="mt-1.5 text-xs text-gray-400">
                    Assigned {comparison.assignedLabel}
                    {' · '}
                    Actual {comparison.actualLabel}
                    {' · '}
                    Archived {formatDateTime(assignment.archived_at)}
                    {' · '}
                    by {assignment.archived_by_name || 'Owner / Admin'}
                  </p>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function ConfirmArchiveDialog({
  assignment,
  busy,
  onCancel,
  onConfirm,
}: {
  assignment: EmployeeTaskAssignment
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-3" onClick={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }}>
      <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-[var(--bg-card,#1e2433)] p-5 shadow-2xl">
        <h3 className="text-lg font-bold text-gray-100">Archive Work Order?</h3>
        <p className="mt-2 text-sm text-gray-300">
          “{assignment.work_package_name}” will leave active Work Order views. All details stay preserved, and you can restore it from Archived Work Orders.
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 flex-1 rounded-xl bg-gray-700 text-sm font-semibold text-gray-200 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 text-sm font-semibold text-white disabled:opacity-50">
            <Archive size={15} /> {busy ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmPermanentDeleteDialog({
  assignment,
  busy,
  onCancel,
  onConfirm,
}: {
  assignment: EmployeeTaskAssignment
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')
  const expected = assignment.work_package_name.trim()
  const matches = typed.trim() === expected
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-3" onClick={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }}>
      <div className="w-full max-w-md rounded-2xl border border-red-900/60 bg-[var(--bg-card,#1e2433)] p-5 shadow-2xl">
        <h3 className="text-lg font-bold text-red-300">Delete permanently?</h3>
        <p className="mt-2 text-sm text-gray-300">
          This permanently removes the Work Order assignment “{assignment.work_package_name}”. This cannot be undone.
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Projects, Work Packages, Blueprints, source snapshots, and employee time/payroll history are preserved. Linked Time Sessions keep their project context and detach only the Work Order reference.
        </p>
        <label className="mt-4 block text-xs font-semibold uppercase text-gray-400" htmlFor="delete-work-order-confirm">
          Type the Work Order title to confirm
        </label>
        <input
          id="delete-work-order-confirm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          disabled={busy}
          className="mt-1.5 min-h-11 w-full rounded-xl border border-red-900/50 bg-[var(--bg-secondary)] px-3 text-base text-gray-100"
          placeholder={expected}
          autoComplete="off"
        />
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 flex-1 rounded-xl bg-gray-700 text-sm font-semibold text-gray-200 disabled:opacity-50">Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !matches}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-red-700 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
          >
            <Trash2 size={15} /> {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not recorded'
  return date.toLocaleString([], {
    timeZone: TENANT_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatAdminAssignmentDay(value: string | null | undefined): string {
  if (!value) return 'Unscheduled'
  const date = parseAssignmentDay(value)
  return date?.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) ?? 'Unscheduled'
}
