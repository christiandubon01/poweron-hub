// @ts-nocheck
/**
 * EmployeeMyTasksPanel — employee-facing assigned work packages (Feature 1 WS2).
 *
 * Lead privacy: never shows lead_employee_id or any lead/collaborator badge.
 * can_complete (from RPC) gates the completion controls without revealing why.
 *
 * Completion flow (EMS-Phase-3):
 *   - Lead sees: hours worked + optional notes textarea + "Mark Complete"
 *   - "Start Task" marks in progress through the same update path
 *   - Once completed: the task moves to the read-only Archived bucket
 *   - Non-lead: read-only view of notes and status chip
 *
 * Weekly view (EMPLOYEE-WEEKLY-TASK-VIEW-1B):
 *   One workflow, one data source. getMyEmployeeTasks() is still the only read
 *   and updateMyEmployeeTask() is still the only write. This panel owns the
 *   task state, the week range, the selection, the drafts and the Work Order
 *   viewer; the seven-day presentation lives in EmployeeWeeklyTaskBoard and the
 *   completed bucket in EmployeeArchivedTaskList.
 *
 *   Day columns hold compact summary cards only. Exactly one task-detail area
 *   exists on the page, below the week, and it renders whichever task is
 *   selected — so hours, notes, Start Task and Mark Complete are never repeated
 *   per day column.
 *
 *   Two error states, each rendered in exactly one place: loadError in the panel
 *   banner, actionError inside the focused detail panel next to the buttons that
 *   produced it.
 *
 *   Days come from the existing employee-portal Monday–Sunday WeekRange
 *   convention (getCurrentWeekRangeFromTenantDate / shiftWeekRange) and are
 *   grouped by the real assignment due_date. Completed rows are still returned
 *   by get_my_employee_tasks, so the Archive needs no new table or migration.
 *
 *   Time clock: record_time_punch takes a punch type only — there is no
 *   assignment-linked time entry in the existing contract, so Start Task marks
 *   the assignment in progress and never writes payroll time.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, CalendarDays, ClipboardList, Loader2, AlertCircle } from 'lucide-react'
import {
  getMyEmployeeTasks,
  updateMyEmployeeTask,
  type EmployeeMyTask,
} from '@/services/employeeTaskAssignmentService'
import {
  getCurrentWeekRangeFromTenantDate,
  shiftWeekRange,
  type WeekRange,
} from '@/services/employeePortalService'
import { getTenantWorkDate } from '@/services/employeeTimeService'
import { EmployeeWorkOrderViewer } from './EmployeeWorkOrderViewer'
import { EmployeeWeeklyTaskBoard } from './EmployeeWeeklyTaskBoard'
import { EmployeeArchivedTaskList } from './EmployeeArchivedTaskList'
import {
  buildWeekDays,
  collectUnscheduledTasks,
  countTasksOutsideWeek,
  countWeekTasks,
  partitionMyTasks,
  resolveSelectedDay,
  resolveSelectedTaskId,
  sortArchivedTasks,
} from './employeeWeeklyTasks'

/** One action name for the active card and the archived summary. */
export const VIEW_WORK_ORDER_LABEL = 'View Work Order'

type TaskView = 'week' | 'archived'

export default function EmployeeMyTasksPanel() {
  const [tasks, setTasks] = useState<EmployeeMyTask[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({})
  const [draftHours, setDraftHours] = useState<Record<string, string>>({})
  const [workOrderAssignmentId, setWorkOrderAssignmentId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const today = useMemo(() => getTenantWorkDate(), [])
  const [range, setRange] = useState<WeekRange>(() => getCurrentWeekRangeFromTenantDate())
  const [view, setView] = useState<TaskView>('week')
  const [selectedDay, setSelectedDay] = useState<string>(() =>
    resolveSelectedDay(getCurrentWeekRangeFromTenantDate(), getTenantWorkDate(), null),
  )
  const [archivedExpandedId, setArchivedExpandedId] = useState<string | null>(null)

  /** Assignment ids whose completion the backend already confirmed this session. */
  const [confirmedCompleted, setConfirmedCompleted] = useState<Set<string>>(() => new Set())

  // Drafts the employee actually typed — a refetch must not overwrite them.
  const editedHours = useRef<Set<string>>(new Set())
  const editedNotes = useRef<Set<string>>(new Set())
  // Only the newest load may apply its response.
  const loadSeq = useRef(0)
  // Synchronous duplicate-submit guard (survives same-tick double clicks).
  const inFlightIds = useRef<Set<string>>(new Set())

  const seedDrafts = useCallback((rows: EmployeeMyTask[]) => {
    setDraftNotes((prev) => {
      const next = { ...prev }
      for (const t of rows) {
        if (!editedNotes.current.has(t.id)) next[t.id] = t.completion_notes || ''
      }
      return next
    })
    setDraftHours((prev) => {
      const next = { ...prev }
      for (const t of rows) {
        if (!editedHours.current.has(t.id)) next[t.id] = t.hours_spent != null ? String(t.hours_spent) : ''
      }
      return next
    })
  }, [])

  /** Drops the typed draft for one assignment so it is not retained after completion. */
  const clearDrafts = useCallback((assignmentId: string) => {
    editedHours.current.delete(assignmentId)
    editedNotes.current.delete(assignmentId)
    setDraftHours((prev) => {
      const next = { ...prev }
      delete next[assignmentId]
      return next
    })
    setDraftNotes((prev) => {
      const next = { ...prev }
      delete next[assignmentId]
      return next
    })
  }, [])

  const load = useCallback(async () => {
    const seq = loadSeq.current + 1
    loadSeq.current = seq
    setLoading(true)
    setLoadError('')
    const res = await getMyEmployeeTasks()
    if (loadSeq.current !== seq) return
    if (res.success) {
      setTasks(res.data)
      seedDrafts(res.data)
    } else {
      setTasks([])
      setLoadError(res.error || 'Could not load your tasks.')
    }
    setLoading(false)
  }, [seedDrafts])

  useEffect(() => {
    load()
  }, [load])

  // ── Write paths (unchanged RPC contract) ────────────────────────────────────

  /** Reserves the task for a single in-flight update; false when already busy. */
  const beginUpdate = (task: EmployeeMyTask): boolean => {
    if (!task?.id || !task.can_complete) return false
    if (savingId || inFlightIds.current.has(task.id)) return false
    inFlightIds.current.add(task.id)
    setSavingId(task.id)
    setActionError('')
    return true
  }

  const endUpdate = (task: EmployeeMyTask) => {
    inFlightIds.current.delete(task.id)
    setSavingId(null)
  }

  const markInProgress = async (task: EmployeeMyTask) => {
    if (!beginUpdate(task)) return
    const res = await updateMyEmployeeTask({
      assignmentId: task.id,
      status: 'in_progress',
    })
    endUpdate(task)
    if (!res.success) {
      // Failed start must not change the displayed status.
      setActionError(res.error || 'Could not update task.')
      return
    }
    await load()
  }

  const markComplete = async (task: EmployeeMyTask) => {
    const rawHours = draftHours[task.id]?.trim() ?? ''
    const hrs = parseFloat(rawHours)
    if (!rawHours || isNaN(hrs) || hrs <= 0) {
      setActionError('Enter the hours worked before marking complete.')
      return
    }
    if (!beginUpdate(task)) return
    const res = await updateMyEmployeeTask({
      assignmentId: task.id,
      status: 'completed',
      completionNotes: draftNotes[task.id] ?? '',
      hoursSpent: hrs,
    })
    endUpdate(task)
    if (!res.success) {
      // Stays active with its typed hours and notes intact — nothing enters the
      // Archive, and no draft is cleared, until the backend confirms.
      setActionError(res.error || 'Could not complete task.')
      return
    }
    // Confirmed: leave the active week list and enter Archived immediately.
    setConfirmedCompleted((prev) => new Set(prev).add(task.id))
    clearDrafts(task.id)
    await load()
  }

  const saveNotes = async (task: EmployeeMyTask) => {
    if (!beginUpdate(task)) return
    const res = await updateMyEmployeeTask({
      assignmentId: task.id,
      completionNotes: draftNotes[task.id] ?? '',
    })
    endUpdate(task)
    if (!res.success) {
      setActionError(res.error || 'Could not save notes.')
      return
    }
    editedNotes.current.delete(task.id)
    await load()
  }

  // ── Derived weekly / archived views ────────────────────────────────────────

  const { active, archived } = useMemo(
    () => partitionMyTasks(tasks, confirmedCompleted),
    [tasks, confirmedCompleted],
  )
  const days = useMemo(() => buildWeekDays(range, active), [range, active])
  const unscheduled = useMemo(() => collectUnscheduledTasks(active), [active])
  const outsideWeekCount = useMemo(() => countTasksOutsideWeek(range, active), [range, active])
  const archivedTasks = useMemo(() => sortArchivedTasks(archived), [archived])
  const weekTaskCount = countWeekTasks(days)

  // Derived, not synced: a task that completes or leaves the payload closes the
  // focused panel on the same render instead of one pass later.
  const focusedTaskId = useMemo(
    () => resolveSelectedTaskId(active, selectedTaskId),
    [active, selectedTaskId],
  )
  const focusedTask = useMemo(
    () => active.find((task) => task.id === focusedTaskId) ?? null,
    [active, focusedTaskId],
  )

  const thisWeek = getCurrentWeekRangeFromTenantDate()
  const isThisWeek = range.startDate === thisWeek.startDate

  const goToWeek = (next: WeekRange) => {
    setRange(next)
    setSelectedDay((current) => resolveSelectedDay(next, today, current))
  }

  const handleHoursChange = (assignmentId: string, value: string) => {
    editedHours.current.add(assignmentId)
    setDraftHours((d) => ({ ...d, [assignmentId]: value }))
  }

  const handleNotesChange = (assignmentId: string, value: string) => {
    editedNotes.current.add(assignmentId)
    setDraftNotes((d) => ({ ...d, [assignmentId]: value }))
  }

  /**
   * Selection only moves the focused detail panel: it never starts or completes a
   * task, never opens the Work Order, and never touches another task's drafts —
   * those stay keyed by assignment id in this panel.
   */
  const handleSelectTask = (assignmentId: string) => {
    setSelectedTaskId(assignmentId)
    setActionError('')
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ClipboardList className="w-5 h-5 text-green-600" />
            <h2 className="text-base font-bold text-gray-900">My Tasks</h2>
          </div>
          <p className="text-sm text-gray-500">
            Work packages assigned to you. Package details are read-only.
          </p>
        </div>

        {/* Active Week / Archived */}
        <div className="grid grid-cols-2 gap-2 sm:max-w-md" role="tablist" aria-label="Task view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'week'}
            onClick={() => setView('week')}
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-bold transition ${
              view === 'week'
                ? 'bg-green-600 border-green-600 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
            style={{ minHeight: 44 }}
          >
            <CalendarDays size={15} />
            Active Week
            <span className="text-xs font-bold opacity-80">({weekTaskCount})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'archived'}
            onClick={() => setView('archived')}
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-bold transition ${
              view === 'archived'
                ? 'bg-green-600 border-green-600 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
            style={{ minHeight: 44 }}
          >
            <Archive size={15} />
            Archived
            <span className="text-xs font-bold opacity-80">({archivedTasks.length})</span>
          </button>
        </div>
      </div>

      {/* Load failures only — task write failures render inside the focused panel. */}
      {loadError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{loadError}</p>
        </div>
      )}

      {loading && tasks.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin text-green-600" />
          Loading your tasks…
        </div>
      )}

      {!loading && tasks.length === 0 && view === 'week' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm text-center">
          <p className="text-base font-bold text-gray-900">No tasks yet</p>
          <p className="text-sm text-gray-500 mt-2">
            When your team assigns work packages, they will show up here.
          </p>
        </div>
      )}

      {view === 'week' ? (
        <EmployeeWeeklyTaskBoard
          range={range}
          isThisWeek={isThisWeek}
          days={days}
          unscheduled={unscheduled}
          outsideWeekCount={outsideWeekCount}
          today={today}
          selectedDay={selectedDay}
          selectedTaskId={focusedTaskId}
          focusedTask={focusedTask}
          viewWorkOrderLabel={VIEW_WORK_ORDER_LABEL}
          hoursDrafts={draftHours}
          notesDrafts={draftNotes}
          savingId={savingId}
          actionError={actionError}
          onSelectDay={setSelectedDay}
          onSelectTask={handleSelectTask}
          onPreviousWeek={() => goToWeek(shiftWeekRange(range, -1))}
          onNextWeek={() => goToWeek(shiftWeekRange(range, 1))}
          onToday={() => goToWeek(getCurrentWeekRangeFromTenantDate())}
          onHoursChange={handleHoursChange}
          onNotesChange={handleNotesChange}
          onViewWorkOrder={(task) => setWorkOrderAssignmentId(task.id)}
          onStartTask={markInProgress}
          onMarkComplete={markComplete}
          onSaveNotes={saveNotes}
        />
      ) : (
        <EmployeeArchivedTaskList
          tasks={archivedTasks}
          expandedId={archivedExpandedId}
          viewWorkOrderLabel={VIEW_WORK_ORDER_LABEL}
          onToggleExpanded={(assignmentId) =>
            setArchivedExpandedId((current) => (current === assignmentId ? null : assignmentId))
          }
          onViewWorkOrder={(task) => setWorkOrderAssignmentId(task.id)}
        />
      )}

      {workOrderAssignmentId && (
        <EmployeeWorkOrderViewer
          assignmentId={workOrderAssignmentId}
          onClose={() => setWorkOrderAssignmentId(null)}
        />
      )}
    </div>
  )
}
