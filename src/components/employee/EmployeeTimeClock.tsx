// @ts-nocheck
/**
 * EmployeeTimeClock — Employee-side time clock card (TIME-3).
 *
 * Loads today's status on mount and after every successful punch. All writes
 * go through recordTimePunch (record_time_punch RPC). No optimistic inserts,
 * no localStorage, no direct table writes.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Clock, Loader2, AlertCircle } from 'lucide-react'
import {
  getTodayTimeStatus,
  recordTimePunch,
  type TodayTimeStatus,
  type PunchType,
  type ClockPhase,
} from '@/services/employeeTimeService'

// ── Presentation maps ─────────────────────────────────────────────────────────

const PHASE_PILL: Record<ClockPhase, { label: string; cls: string }> = {
  off_clock:       { label: 'Not clocked in',   cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  working:         { label: 'Clocked in',       cls: 'bg-green-100 text-green-700 border-green-200' },
  on_lunch:        { label: 'On lunch break',   cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  back_from_lunch: { label: 'Back from lunch',  cls: 'bg-green-100 text-green-700 border-green-200' },
  done:            { label: 'Day complete',     cls: 'bg-blue-100 text-blue-700 border-blue-200' },
}

const PUNCH_LABEL: Record<PunchType, string> = {
  clock_in:  'Clock In',
  lunch_out: 'Lunch Out',
  lunch_in:  'Lunch In',
  clock_out: 'Clock Out',
}

// Primary action button copy per punch type.
const ACTION_LABEL: Record<PunchType, string> = {
  clock_in:  'Clock In',
  lunch_out: 'Start Lunch',
  lunch_in:  'End Lunch',
  clock_out: 'Clock Out',
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatWorkDate(workDate: string | undefined): string {
  if (!workDate) return ''
  // Parse YYYY-MM-DD as a local date (avoid UTC shift from the Date string ctor).
  const [y, m, d] = workDate.split('-').map(Number)
  if (!y || !m || !d) return workDate
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

function formatMinutes(mins: number | null | undefined): string {
  if (mins == null || isNaN(mins)) return '—'
  const total = Math.max(0, Math.round(mins))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// Main status text derived from phase + entry timestamps.
function mainStatusText(status: TodayTimeStatus): string {
  const e = status.entry
  switch (status.phase) {
    case 'off_clock':       return 'Not clocked in yet'
    case 'working':         return `Clocked in at ${formatTime(e?.clock_in_at)}`
    case 'on_lunch':        return `Lunch started at ${formatTime(e?.lunch_out_at)}`
    case 'back_from_lunch': return `Back from lunch at ${formatTime(e?.lunch_in_at)}`
    case 'done':            return `Clocked out at ${formatTime(e?.clock_out_at)}`
    default:                return ''
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EmployeeTimeClock() {
  const [status, setStatus]     = useState<TodayTimeStatus | null>(null)
  const [loading, setLoading]   = useState(true)   // initial / refetch load
  const [punching, setPunching] = useState(false)  // punch in flight
  const [error, setError]       = useState('')

  const loadStatus = useCallback(async () => {
    setLoading(true)
    const res = await getTodayTimeStatus()
    if (res.success && res.status) {
      setStatus(res.status)
      setError('')
    } else {
      setError(res.error || 'Could not load your time status.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const handlePunch = async (punchType: PunchType) => {
    if (punching || loading) return
    setPunching(true)
    setError('')

    const res = await recordTimePunch(punchType)

    if (res.success) {
      // Re-sync from the server (trigger updates the summary entry).
      await loadStatus()
    } else {
      setError(res.error || 'Could not record punch.')
      // Re-fetch once so the UI reflects any server-side state after a rejection.
      await loadStatus()
    }
    setPunching(false)
  }

  const busy = loading || punching

  // ── Loading (first load, no data yet) ──
  if (loading && !status) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin text-green-600" />
          Loading your time clock…
        </div>
      </div>
    )
  }

  const phase   = status?.phase ?? 'off_clock'
  const pill    = PHASE_PILL[phase]
  const actions = status?.nextActions ?? []
  const entry   = status?.entry ?? null

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-green-600" />
          <h2 className="text-base font-bold text-gray-900">Time Clock</h2>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${pill.cls}`}>
          {pill.label}
        </span>
      </div>

      {/* Date + main status */}
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">
          {formatWorkDate(status?.workDate)}
        </p>
        <p className="text-lg font-bold text-gray-900 mt-0.5">
          {status ? mainStatusText(status) : 'Not clocked in yet'}
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="space-y-2">
        {phase === 'done' && (
          <button
            type="button"
            disabled
            className="w-full py-3 rounded-xl bg-gray-100 text-gray-400 font-bold text-base cursor-not-allowed"
          >
            Day complete
          </button>
        )}

        {actions.map((action, idx) => {
          const isPrimary = idx === 0
          const base = 'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-base transition disabled:opacity-60 disabled:cursor-not-allowed'
          const style = isPrimary
            ? 'bg-green-600 hover:bg-green-500 active:bg-green-700 text-white'
            : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
          return (
            <button
              key={action}
              type="button"
              onClick={() => handlePunch(action)}
              disabled={busy}
              className={`${base} ${style}`}
            >
              {punching && isPrimary && <Loader2 size={16} className="animate-spin" />}
              {ACTION_LABEL[action]}
            </button>
          )
        })}
      </div>

      {/* Today's punches */}
      {status && status.punches.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Today's punches</p>
          <ul className="space-y-1.5">
            {status.punches.map(p => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{PUNCH_LABEL[p.punch_type] ?? p.punch_type}</span>
                <span className="text-gray-900 font-medium tabular-nums">{formatTime(p.punched_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary */}
      {entry && (entry.paid_minutes != null || entry.lunch_minutes != null || entry.status) && (
        <div className="border-t border-gray-100 pt-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Paid</p>
            <p className="text-sm font-bold text-gray-900">{formatMinutes(entry.paid_minutes)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Lunch</p>
            <p className="text-sm font-bold text-gray-900">{formatMinutes(entry.lunch_minutes)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Status</p>
            <p className="text-sm font-bold text-gray-900 capitalize">{entry.status ?? '—'}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default EmployeeTimeClock
