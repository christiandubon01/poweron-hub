// @ts-nocheck
/**
 * EmployeeMyTimePanel — read-only weekly time summary for the signed-in
 * employee (TIME-5).
 *
 * Visibility only: own time_entries + non-void time_punch_events for the
 * selected week. No editing, corrections, approval, export, or punch controls.
 * All data comes from employeePortalService (SELECT-only, scoped to auth.uid()).
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Clock, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  getMyTimeSummary,
  getCurrentWeekRangeFromTenantDate,
  shiftWeekRange,
  type EmployeeMyTimeSummary,
  type EmployeeMyTimeDay,
  type EmployeeMyTimePunch,
  type WeekRange,
} from '@/services/employeePortalService'

// ── Display status ─────────────────────────────────────────────────────────────

type DisplayStatus =
  | 'not_started'
  | 'clocked_in'
  | 'on_lunch'
  | 'complete'
  | 'incomplete'
  | 'open'

const STATUS_PILL: Record<DisplayStatus, { label: string; cls: string }> = {
  not_started: { label: 'Not started', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  clocked_in:  { label: 'Clocked in',  cls: 'bg-green-100 text-green-700 border-green-200' },
  on_lunch:    { label: 'On lunch',    cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  complete:    { label: 'Complete',    cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  incomplete:  { label: 'Incomplete',  cls: 'bg-red-100 text-red-700 border-red-200' },
  open:        { label: 'Open',        cls: 'bg-green-100 text-green-700 border-green-200' },
}

const PUNCH_LABEL: Record<EmployeeMyTimePunch['punch_type'], string> = {
  clock_in:  'Clock In',
  lunch_out: 'Lunch Out',
  lunch_in:  'Lunch In',
  clock_out: 'Clock Out',
}

/**
 * Derive a clear per-day status from the day's punches + entry.
 * Punch presence is the source of truth; entry.status is a fallback.
 */
function deriveDayStatus(day: EmployeeMyTimeDay): DisplayStatus {
  const has = (t: EmployeeMyTimePunch['punch_type']) =>
    day.punches.some(p => p.punch_type === t && !p.is_void)

  if (!has('clock_in')) return 'not_started'
  if (has('clock_out')) {
    // Clocked out but lunch was opened and never closed → incomplete.
    if (has('lunch_out') && !has('lunch_in')) return 'incomplete'
    return day.entry?.status === 'incomplete' ? 'incomplete' : 'complete'
  }
  if (has('lunch_out') && !has('lunch_in')) return 'on_lunch'
  return 'clocked_in'
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatMinutes(mins: number | null | undefined): string {
  if (mins == null || isNaN(mins)) return '—'
  const total = Math.max(0, Math.round(mins))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

function formatDayLabel(workDate: string): string {
  const [y, m, d] = workDate.split('-').map(Number)
  if (!y || !m || !d) return workDate
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function formatRangeLabel(range: WeekRange): string {
  const [ys, ms, ds] = range.startDate.split('-').map(Number)
  const [ye, me, de] = range.endDate.split('-').map(Number)
  if (!ys || !ye) return `${range.startDate} – ${range.endDate}`
  const start = new Date(ys, ms - 1, ds)
  const end = new Date(ye, me - 1, de)
  const startStr = start.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const endStr = end.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  return `${startStr} – ${endStr}`
}

function lunchText(day: EmployeeMyTimeDay): string {
  const e = day.entry
  if (e?.lunch_out_at && e?.lunch_in_at) {
    return `${formatTime(e.lunch_out_at)}–${formatTime(e.lunch_in_at)}`
  }
  if (e?.lunch_out_at && !e?.lunch_in_at) return 'On lunch'
  if (!e?.lunch_out_at && e?.clock_out_at) return 'Skipped'
  return '—'
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EmployeeMyTimePanel() {
  const [range, setRange] = useState<WeekRange>(() => getCurrentWeekRangeFromTenantDate())
  const [data, setData] = useState<EmployeeMyTimeSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const thisWeek = getCurrentWeekRangeFromTenantDate()
  const isThisWeek = range.startDate === thisWeek.startDate

  const load = useCallback(async (r: WeekRange) => {
    setLoading(true)
    setError('')
    const res = await getMyTimeSummary(r.startDate, r.endDate)
    if (res.success) {
      setData(res.data)
    } else {
      setData(null)
      setError(res.error || 'Could not load your time.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load(range)
  }, [range, load])

  const days = data?.days ?? []
  const hasAnyTime = days.some(d => d.entry || d.punches.length > 0)

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
      {/* Header + week controls */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-green-600" />
          <div>
            <h2 className="text-base font-bold text-gray-900 leading-tight">My Time</h2>
            <p className="text-xs text-gray-400">{isThisWeek ? 'This week' : 'Selected week'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRange(r => shiftWeekRange(r, -1))}
            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition"
            aria-label="Previous week"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setRange(r => shiftWeekRange(r, 1))}
            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition"
            aria-label="Next week"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Range label + This week reset */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-700">{formatRangeLabel(range)}</p>
        {!isThisWeek && (
          <button
            type="button"
            onClick={() => setRange(getCurrentWeekRangeFromTenantDate())}
            className="text-xs font-semibold text-green-700 hover:text-green-800 transition"
          >
            This week
          </button>
        )}
      </div>

      {/* Week totals */}
      {data && (
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-green-700/70 uppercase tracking-wide font-medium">Paid this week</p>
            <p className="text-lg font-bold text-green-700 tabular-nums">{formatMinutes(data.totalPaidMinutes)}</p>
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Lunch this week</p>
            <p className="text-lg font-bold text-gray-700 tabular-nums">{formatMinutes(data.totalLunchMinutes)}</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
          <Loader2 size={16} className="animate-spin text-green-600" />
          Loading your time…
        </div>
      )}

      {/* Empty */}
      {!loading && !error && !hasAnyTime && (
        <p className="text-sm text-gray-500 text-center py-6">No time recorded for this week yet.</p>
      )}

      {/* Day rows */}
      {!loading && hasAnyTime && (
        <div className="space-y-2.5">
          {days.map(day => {
            const status = deriveDayStatus(day)
            const pill = STATUS_PILL[status]
            const e = day.entry
            const isEmpty = !e && day.punches.length === 0
            if (isEmpty) return null
            return (
              <div key={day.workDate} className="border border-gray-200 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-gray-900">{formatDayLabel(day.workDate)}</p>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${pill.cls}`}>
                    {pill.label}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1.5 mt-2.5 text-center">
                  <div>
                    <p className="text-[9px] text-gray-400 uppercase tracking-wide">In</p>
                    <p className="text-xs font-bold text-gray-800 tabular-nums">{formatTime(e?.clock_in_at)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-400 uppercase tracking-wide">Lunch</p>
                    <p className="text-xs font-bold text-gray-800 tabular-nums">{lunchText(day)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-400 uppercase tracking-wide">Out</p>
                    <p className="text-xs font-bold text-gray-800 tabular-nums">{formatTime(e?.clock_out_at)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-400 uppercase tracking-wide">Paid</p>
                    <p className="text-xs font-bold text-green-700 tabular-nums">{formatMinutes(day.paidMinutes)}</p>
                  </div>
                </div>

                {/* Read-only punch detail */}
                {day.punches.length > 0 && (
                  <ul className="mt-2.5 border-t border-gray-100 pt-2 space-y-1">
                    {day.punches.map(p => (
                      <li key={p.id} className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">{PUNCH_LABEL[p.punch_type] ?? p.punch_type}</span>
                        <span className="text-gray-800 font-medium tabular-nums">{formatTime(p.punched_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default EmployeeMyTimePanel
