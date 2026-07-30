// @ts-nocheck
/**
 * EmployeeSchedulePanel — Employee monthly performance calendar for the Schedule
 * tab (EMPLOYEE-SCHEDULE-MONTH-VIEW-1, replacing the EMS Phase 4 day view).
 *
 * One workflow, existing data paths only. This panel owns the month anchor, the
 * selected day, the three range reads and the schedule status writes; the grid
 * presentation lives in EmployeeMonthCalendar and every derivation in the pure
 * employeeMonthMetrics helper.
 *
 * Reads (one request per data domain for the whole visible grid — never one per
 * day):
 *   getMyScheduleRange(visibleStart, visibleEnd) — employee_schedules, RLS-scoped
 *   getMyTimeSummary(visibleStart, visibleEnd)   — the same paid_minutes My Time
 *                                                  displays, per work_date
 *   getMyEmployeeTasks()                         — every assignment in one call
 *
 * Writes: only update_my_schedule_status, exactly as the day view did. The
 * Start/Done controls and their card are preserved and now sit under the
 * calendar as the selected day's detail.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarRange, CheckCircle2, Loader2, Play } from 'lucide-react'
import {
  getMyScheduleRange,
  updateMyScheduleStatus,
  type ScheduleItem,
  type ScheduleStatus,
} from '@/services/employeeScheduleService'
import { getMyTimeSummary } from '@/services/employeePortalService'
import { getMyEmployeeTasks, type EmployeeMyTask } from '@/services/employeeTaskAssignmentService'
import { getTenantWorkDate } from '@/services/employeeTimeService'
import { EmployeeMonthCalendar } from './EmployeeMonthCalendar'
import {
  aggregateMonthMetrics,
  buildMonthGrid,
  formatFullDayLabel,
  isSameMonth,
  resolveSelectedDate,
  shiftMonth,
  type MonthDayMetrics,
} from './employeeMonthMetrics'

// -- Helpers (unchanged formatting from the day view) -------------------------

function formatTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return ''
  const ampm = h >= 12 ? 'pm' : 'am'
  const hr = h % 12 || 12
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`
}

function minutesToHours(min: number | null): string {
  if (!min || min <= 0) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ts
  }
}

/** One safe banner message — never raw database or policy text. */
function safeScheduleError(message: string): string {
  const text = String(message || '')
  if (/not authenticated/i.test(text)) return 'Please sign in again to see your schedule.'
  if (/failed to fetch|networkerror|network request failed|timeout/i.test(text)) {
    return 'Network error. Check your connection and try again.'
  }
  return 'Could not load this month. Try again.'
}

// -- Status chip (unchanged) --------------------------------------------------

const STATUS_STYLES: Record<ScheduleStatus, string> = {
  scheduled:   'text-blue-700 bg-blue-50 border-blue-200',
  in_progress: 'text-amber-700 bg-amber-50 border-amber-200',
  done:        'text-green-700 bg-green-50 border-green-200',
  cancelled:   'text-gray-400 bg-gray-100 border-gray-200',
}

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  scheduled:   'Scheduled',
  in_progress: 'In Progress',
  done:        'Done',
  cancelled:   'Cancelled',
}

// -- Schedule item card (unchanged Start/Done behavior) ----------------------

function ScheduleCard({
  item,
  onStatusChange,
}: {
  item: ScheduleItem
  onStatusChange: (id: string, status: ScheduleStatus) => void
}) {
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const isCancelled = item.status === 'cancelled'
  const isDone = item.status === 'done'

  async function transition(to: ScheduleStatus) {
    setBusy(true)
    setLocalError(null)
    const result = await updateMyScheduleStatus(item.id, to)
    if (result.success) {
      onStatusChange(item.id, to)
    } else {
      setLocalError(result.error)
    }
    setBusy(false)
  }

  return (
    <div className={`bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-2 ${isCancelled ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold leading-snug ${isCancelled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
            {item.work_package_name || 'Scheduled Work'}
          </p>
          {item.project_name && (
            <p className="text-xs text-gray-500 mt-0.5">{item.project_name}</p>
          )}
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${STATUS_STYLES[item.status]}`}>
          {STATUS_LABELS[item.status]}
        </span>
      </div>

      {(item.start_time || item.estimated_minutes) && (
        <div className="flex flex-wrap gap-3 text-xs text-gray-600">
          {item.start_time && (
            <span>
              {formatTime(item.start_time)}
              {item.end_time ? ` - ${formatTime(item.end_time)}` : ''}
            </span>
          )}
          {item.estimated_minutes && (
            <span>{minutesToHours(item.estimated_minutes)} est.</span>
          )}
        </div>
      )}

      {item.notes && (
        <p className="text-xs text-gray-600 leading-relaxed bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          {item.notes}
        </p>
      )}

      {isDone && (
        <div className="flex items-center gap-1.5 text-xs text-green-600">
          <CheckCircle2 size={13} />
          Completed {formatTimestamp(item.updated_at)}
        </div>
      )}

      {!isCancelled && !isDone && (
        <div className="flex gap-2 pt-1">
          {item.status === 'scheduled' && (
            <button
              type="button"
              onClick={() => transition('in_progress')}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              Start
            </button>
          )}
          {item.status === 'in_progress' && (
            <button
              type="button"
              onClick={() => transition('done')}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
              Done
            </button>
          )}
        </div>
      )}

      {localError && <p className="text-[11px] text-red-500">{localError}</p>}
    </div>
  )
}

// -- Main component ----------------------------------------------------------

export default function EmployeeSchedulePanel() {
  const today = useMemo(() => getTenantWorkDate(), [])
  const [monthAnchor, setMonthAnchor] = useState<string>(() => getTenantWorkDate())
  const [selectedDate, setSelectedDate] = useState<string>(() => getTenantWorkDate())

  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([])
  const [timeDays, setTimeDays] = useState<EmployeeMyTimeDay[]>([])
  const [tasks, setTasks] = useState<EmployeeMyTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Only the newest month load may apply its response.
  const loadSeq = useRef(0)

  const grid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor])

  const load = useCallback(async (visibleStart: string, visibleEnd: string) => {
    const seq = loadSeq.current + 1
    loadSeq.current = seq
    setLoading(true)
    setError('')

    // One request per data domain for the whole visible grid.
    const [scheduleRes, timeRes, taskRes] = await Promise.all([
      getMyScheduleRange(visibleStart, visibleEnd),
      getMyTimeSummary(visibleStart, visibleEnd),
      getMyEmployeeTasks(),
    ])

    // A superseded month must never paint under the newer heading.
    if (loadSeq.current !== seq) return

    if (!scheduleRes.success || !timeRes.success || !taskRes.success) {
      const firstError =
        (!scheduleRes.success && scheduleRes.error) ||
        (!timeRes.success && timeRes.error) ||
        (!taskRes.success && taskRes.error) ||
        ''
      // Drop everything so no stale month's values read as this month's.
      setScheduleItems([])
      setTimeDays([])
      setTasks([])
      setError(safeScheduleError(String(firstError)))
      setLoading(false)
      return
    }

    setScheduleItems(scheduleRes.data)
    setTimeDays(timeRes.data.days)
    setTasks(taskRes.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load(grid.visibleStart, grid.visibleEnd)
  }, [grid.visibleStart, grid.visibleEnd, load])

  const days: MonthDayMetrics[] = useMemo(
    () =>
      aggregateMonthMetrics({
        visibleDates: grid.dates,
        monthAnchor,
        todayKey: today,
        scheduleItems,
        timeDays,
        tasks,
      }),
    [grid.dates, monthAnchor, today, scheduleItems, timeDays, tasks],
  )

  const goToMonth = (nextAnchor: string) => {
    setMonthAnchor(nextAnchor)
    setSelectedDate((current) =>
      resolveSelectedDate(buildMonthGrid(nextAnchor), today, current),
    )
  }

  const handleStatusChange = (id: string, status: ScheduleStatus) => {
    setScheduleItems((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, status, updated_at: new Date().toISOString() } : it,
      ),
    )
  }

  const isCurrentMonth = isSameMonth(today, monthAnchor)

  // The selected day's schedule items come from the month range already loaded.
  const selectedItems = useMemo(
    () => scheduleItems.filter((item) => String(item.work_date || '').slice(0, 10) === selectedDate),
    [scheduleItems, selectedDate],
  )
  const selectedActive = selectedItems.filter((it) => it.status !== 'cancelled')
  const selectedCancelled = selectedItems.filter((it) => it.status === 'cancelled')

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <CalendarRange className="w-5 h-5 text-green-600" />
          <h2 className="text-base font-bold text-gray-900">Schedule</h2>
        </div>
        <p className="text-sm text-gray-500">
          Your scheduled hours, worked hours and task activity for the month.
        </p>
      </div>

      <EmployeeMonthCalendar
        grid={grid}
        days={days}
        monthAnchor={monthAnchor}
        todayKey={today}
        selectedDate={selectedDate}
        isCurrentMonth={isCurrentMonth}
        loading={loading}
        errorMessage={error}
        onPreviousMonth={() => goToMonth(shiftMonth(monthAnchor, -1))}
        onNextMonth={() => goToMonth(shiftMonth(monthAnchor, 1))}
        onToday={() => goToMonth(getTenantWorkDate())}
        onSelectDate={setSelectedDate}
      >
        {/* Existing day detail: the same schedule cards and Start/Done controls */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-base font-bold text-gray-900">
              {formatFullDayLabel(selectedDate)}
            </p>
            <span className="text-sm font-bold text-gray-600">
              {selectedItems.length} {selectedItems.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          {!loading && !error && selectedItems.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm text-center">
              <CalendarRange size={28} className="text-gray-400 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-700">No work scheduled</p>
              <p className="text-xs text-gray-500 mt-1">
                Nothing scheduled for {formatFullDayLabel(selectedDate)}.
              </p>
            </div>
          )}

          {selectedActive.map((item) => (
            <ScheduleCard key={item.id} item={item} onStatusChange={handleStatusChange} />
          ))}

          {selectedCancelled.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-1">
                Cancelled
              </p>
              {selectedCancelled.map((item) => (
                <ScheduleCard key={item.id} item={item} onStatusChange={handleStatusChange} />
              ))}
            </div>
          )}
        </div>
      </EmployeeMonthCalendar>
    </div>
  )
}
