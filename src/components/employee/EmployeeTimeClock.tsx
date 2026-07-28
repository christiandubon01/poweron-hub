// @ts-nocheck
/**
 * EmployeeTimeClock — Employee-side time clock card (TIME-3 + TIME-6 polish).
 *
 * Loads today's status on mount and after every successful punch. All writes
 * go through recordTimePunch (record_time_punch RPC). No optimistic inserts,
 * no localStorage, no direct table writes.
 *
 * TIME-6 UX polish (UI-only — no RPC / DB / calculation changes):
 *   - Per-phase button colors + animation (green clock-in, amber lunch, done glow).
 *   - Live client-side timers derived from existing punch/entry timestamps.
 *   - Instant "Clocking in…/Starting lunch…" pending feedback so punches feel
 *     responsive; buttons disable while a punch is in flight (dup-click guard).
 *   - Animated "Done for the Day" success state at end of day.
 * Timers are visual only — they never write to the DB and the end-of-day summary
 * still uses the server entry's paid_minutes / lunch_minutes.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Clock, Loader2, AlertCircle, CheckCircle2, Play, Coffee, Square } from 'lucide-react'
import {
  getTodayTimeStatus,
  recordTimePunch,
  type TodayTimeStatus,
  type PunchType,
  type ClockPhase,
} from '@/services/employeeTimeService'

// ── Presentation maps ─────────────────────────────────────────────────────────

const PHASE_PILL: Record<ClockPhase, { label: string; cls: string }> = {
  off_clock:       { label: 'Not clocked in', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  working:         { label: 'Clocked in',     cls: 'bg-green-100 text-green-700 border-green-200' },
  on_lunch:        { label: 'On lunch',        cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  back_from_lunch: { label: 'Working',         cls: 'bg-green-100 text-green-700 border-green-200' },
  done:            { label: 'Complete',        cls: 'bg-blue-100 text-blue-700 border-blue-200' },
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

// Instant pending copy while a punch is in flight (TIME-6 lag feedback).
const PENDING_LABEL: Record<PunchType, string> = {
  clock_in:  'Clocking in…',
  lunch_out: 'Starting lunch…',
  lunch_in:  'Ending lunch…',
  clock_out: 'Clocking out…',
}

const ACTION_ICON: Record<PunchType, React.ComponentType<{ className?: string; size?: number }>> = {
  clock_in:  Play,
  lunch_out: Coffee,
  lunch_in:  Play,
  clock_out: Square,
}

// Solid style for the *primary* action, keyed by phase so the accent matches
// the state (green start, amber lunch, blue clock-out after lunch).
const PRIMARY_BTN: Record<ClockPhase, string> = {
  off_clock:       'bg-green-600 hover:bg-green-500 active:bg-green-700 text-white shadow-md shadow-green-600/25',
  working:         'bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-white shadow-md shadow-amber-500/25',
  on_lunch:        'bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white shadow-md shadow-orange-500/25',
  back_from_lunch: 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-md shadow-blue-600/25',
  done:            'bg-green-600 text-white',
}

const SECONDARY_BTN = 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'

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

// Duration from milliseconds → "Xh Ym" (visual only).
function formatHM(ms: number): string {
  return formatMinutes(Math.max(0, ms) / 60000)
}

// Duration from milliseconds → "H:MM:SS" for the ticking live timer.
function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return isNaN(t) ? null : t
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

// Prefer the entry's timestamps; fall back to raw punches so the live timer still
// runs during the brief window before the summary trigger updates time_entries.
function resolveTimestamps(status: TodayTimeStatus | null) {
  const e = status?.entry ?? null
  const punchAt = (t: PunchType): string | null =>
    status?.punches.find(p => p.punch_type === t && !p.is_void)?.punched_at ?? null
  return {
    clockIn:  toMs(e?.clock_in_at) ?? toMs(punchAt('clock_in')),
    lunchOut: toMs(e?.lunch_out_at) ?? toMs(punchAt('lunch_out')),
    lunchIn:  toMs(e?.lunch_in_at) ?? toMs(punchAt('lunch_in')),
    clockOut: toMs(e?.clock_out_at) ?? toMs(punchAt('clock_out')),
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EmployeeTimeClock() {
  const [status, setStatus]       = useState<TodayTimeStatus | null>(null)
  const [loading, setLoading]     = useState(true)              // initial / refetch load
  const [pending, setPending]     = useState<PunchType | null>(null) // punch in flight
  const [error, setError]         = useState('')
  const [nowTs, setNowTs]         = useState(() => Date.now())
  const [showClockOutSummary, setShowClockOutSummary] = useState(false)
  const [clockOutSummary, setClockOutSummary] = useState('')

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

  const phase     = status?.phase ?? 'off_clock'
  const isRunning = phase === 'working' || phase === 'on_lunch' || phase === 'back_from_lunch'

  // Live timer tick — only while a timer is actually running. Cleared on unmount
  // and whenever the phase changes. Visual only; never refetches, never writes.
  useEffect(() => {
    if (!isRunning) return
    setNowTs(Date.now())
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isRunning, phase])

  const handlePunch = async (punchType: PunchType, endOfDaySummary?: string | null) => {
    // Dup-click guard: ignore while a punch or a load is already in flight.
    if (pending || loading) return

    // Clock-out: collect optional end-of-day summary before submitting the punch.
    if (punchType === 'clock_out' && endOfDaySummary === undefined && !showClockOutSummary) {
      setShowClockOutSummary(true)
      setClockOutSummary('')
      setError('')
      return
    }

    setPending(punchType)          // instant feedback before the network round-trip
    setError('')

    const res = await recordTimePunch(
      punchType,
      punchType === 'clock_out' ? { endOfDaySummary: endOfDaySummary ?? clockOutSummary } : undefined,
    )

    if (res.success) {
      setShowClockOutSummary(false)
      setClockOutSummary('')
      // Re-sync from the server (trigger updates the summary entry).
      await loadStatus()
    } else {
      setError(res.error || 'Could not record punch.')
      // Re-fetch once so the UI reflects any server-side state after a rejection.
      await loadStatus()
    }
    setPending(null)
  }

  const cancelClockOutSummary = () => {
    if (pending) return
    setShowClockOutSummary(false)
    setClockOutSummary('')
  }

  const busy = loading || pending != null

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

  const pill    = PHASE_PILL[phase]
  const actions = status?.nextActions ?? []
  const entry   = status?.entry ?? null
  const ts      = resolveTimestamps(status)

  // ── Live durations (visual only) ──
  let workedMs = 0
  let lunchMs  = 0
  if (phase === 'working') {
    workedMs = ts.clockIn != null ? nowTs - ts.clockIn : 0
  } else if (phase === 'on_lunch') {
    workedMs = (ts.clockIn != null && ts.lunchOut != null) ? ts.lunchOut - ts.clockIn : 0
    lunchMs  = ts.lunchOut != null ? nowTs - ts.lunchOut : 0
  } else if (phase === 'back_from_lunch') {
    const lunchDur = (ts.lunchOut != null && ts.lunchIn != null) ? ts.lunchIn - ts.lunchOut : 0
    workedMs = ts.clockIn != null ? (nowTs - ts.clockIn) - lunchDur : 0
    lunchMs  = lunchDur
  } else if (phase === 'done') {
    workedMs = (entry?.paid_minutes ?? 0) * 60000
    lunchMs  = (entry?.lunch_minutes ?? 0) * 60000
  }
  workedMs = Math.max(0, workedMs)
  lunchMs  = Math.max(0, lunchMs)

  const onLunch = phase === 'on_lunch'
  const liveMs  = onLunch ? lunchMs : workedMs
  const timerAccent = onLunch
    ? { box: 'bg-amber-50 border-amber-200', label: 'text-amber-700', value: 'text-amber-800', dot: 'bg-amber-500' }
    : { box: 'bg-green-50 border-green-200', label: 'text-green-700', value: 'text-green-800', dot: 'bg-green-500' }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
      {/* Scoped animations (respect reduced-motion). */}
      <style>{`
        @keyframes eclockPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(22,163,74,0.35), 0 6px 18px rgba(22,163,74,0.22); }
          50%      { box-shadow: 0 0 0 7px rgba(22,163,74,0), 0 6px 18px rgba(22,163,74,0.34); }
        }
        @keyframes eclockDot { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.82); } }
        @keyframes eclockGlow {
          0%, 100% { box-shadow: 0 8px 22px rgba(16,185,129,0.28), 0 0 0 0 rgba(16,185,129,0.22); }
          50%      { box-shadow: 0 12px 30px rgba(16,185,129,0.42), 0 0 0 5px rgba(16,185,129,0.12); }
        }
        @keyframes eclockShimmer {
          0%      { transform: translateX(-140%) skewX(-18deg); }
          60%,100% { transform: translateX(240%) skewX(-18deg); }
        }
        .eclock-pulse    { animation: eclockPulse 2s ease-in-out infinite; }
        .eclock-live-dot { animation: eclockDot 1.4s ease-in-out infinite; }
        .eclock-done     { animation: eclockGlow 2.4s ease-in-out infinite; }
        .eclock-shimmer  { animation: eclockShimmer 2.9s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .eclock-pulse, .eclock-live-dot, .eclock-done, .eclock-shimmer { animation: none !important; }
        }
      `}</style>

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

      {/* Live timer panel — only while a timer is running */}
      {isRunning && (
        <div className={`rounded-xl border px-4 py-3 ${timerAccent.box}`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold uppercase tracking-wide ${timerAccent.label}`}>
              {onLunch ? 'Lunch time' : 'Working time'}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
              <span className={`eclock-live-dot w-1.5 h-1.5 rounded-full ${timerAccent.dot}`} />
              Live
            </span>
          </div>
          <p className={`mt-1 text-3xl font-bold tabular-nums leading-none ${timerAccent.value}`}>
            {formatClock(liveMs)}
          </p>
          <div className="mt-2.5 flex items-center gap-4 text-xs text-gray-500">
            <span>Worked today <b className="text-gray-800 tabular-nums">{formatHM(workedMs)}</b></span>
            <span>Lunch <b className="text-gray-800 tabular-nums">{formatHM(lunchMs)}</b></span>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Actions / Done state / Clock-out summary */}
      {phase === 'done' ? (
        <div
          className="eclock-done relative overflow-hidden w-full py-4 rounded-xl bg-gradient-to-r from-green-600 to-emerald-500 text-white font-bold text-base flex items-center justify-center gap-2 select-none"
          role="status"
        >
          <CheckCircle2 className="w-5 h-5" />
          Done for the Day
          <span
            className="eclock-shimmer pointer-events-none absolute inset-y-0 -left-1/3 w-1/3"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)' }}
          />
        </div>
      ) : showClockOutSummary ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="eod-summary" className="block text-sm font-semibold text-gray-800 mb-1.5">
              What did you get done today?
            </label>
            <textarea
              id="eod-summary"
              value={clockOutSummary}
              onChange={(e) => setClockOutSummary(e.target.value)}
              placeholder="Optional — brief end-of-day summary"
              rows={4}
              disabled={busy}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60"
              style={{ minHeight: 96, fontSize: 16 }}
            />
            <p className="text-[11px] text-gray-400 mt-1">Optional — you can clock out without a summary.</p>
          </div>
          <button
            type="button"
            onClick={() => handlePunch('clock_out', clockOutSummary)}
            disabled={busy}
            aria-busy={pending === 'clock_out'}
            className="w-full flex items-center justify-center gap-2 rounded-xl font-bold text-base transition disabled:opacity-60 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-md shadow-blue-600/25"
            style={{ minHeight: 44 }}
          >
            {pending === 'clock_out'
              ? <Loader2 size={16} className="animate-spin" />
              : <Square size={16} />}
            {pending === 'clock_out' ? PENDING_LABEL.clock_out : 'Submit Clock Out'}
          </button>
          <button
            type="button"
            onClick={cancelClockOutSummary}
            disabled={busy}
            className="w-full py-3 rounded-xl font-semibold text-sm text-gray-600 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-60"
            style={{ minHeight: 44 }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {actions.map((action, idx) => {
            const isPrimary  = idx === 0
            const isPending  = pending === action
            const Icon       = ACTION_ICON[action]
            const base       = 'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-base transition disabled:opacity-60 disabled:cursor-not-allowed'
            const style      = isPrimary ? PRIMARY_BTN[phase] : SECONDARY_BTN
            // Subtle idle pulse only on the standalone Clock In call-to-action.
            const pulse      = phase === 'off_clock' && isPrimary && !busy ? 'eclock-pulse' : ''
            return (
              <button
                key={action}
                type="button"
                onClick={() => handlePunch(action)}
                disabled={busy}
                aria-busy={isPending}
                className={`${base} ${style} ${pulse}`}
                style={{ minHeight: 44 }}
              >
                {isPending
                  ? <Loader2 size={16} className="animate-spin" />
                  : <Icon size={16} />}
                {isPending ? PENDING_LABEL[action] : ACTION_LABEL[action]}
              </button>
            )
          })}
        </div>
      )}

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

      {/* Summary (server values — authoritative end-of-day totals) */}
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
