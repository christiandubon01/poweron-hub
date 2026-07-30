// @ts-nocheck
/**
 * EmployeeTimeClock — Employee-side time clock card (TIME-3 + SESSIONS-1).
 *
 * Multi-session, job-linked clock:
 *   • When no active session: job picker + disabled Clock In button.
 *   • When session active: active project/work order display + punch actions.
 *   • After Clock Out: job picker reappears (selection cleared).
 *
 * All writes go through recordSessionPunch (record_session_punch RPC, mig 099).
 * No optimistic inserts, no localStorage, no direct table writes.
 * Live timers are visual only and never write to the DB.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Clock, Loader2, AlertCircle, CheckCircle2, Play, Coffee, Square, Briefcase } from 'lucide-react'
import {
  getTodaySessions,
  getMyEligibleAssignments,
  deriveSessionPhase,
  getNextSessionActions,
  recordSessionPunch,
  PUNCH_DISPLAY_ORDER,
  type WorkSession,
  type EligibleAssignment,
  type PunchType,
  type ClockPhase,
} from '@/services/employeeTimeService'
import { EmployeeJobPicker } from './EmployeeJobPicker'

// ── Presentation maps ─────────────────────────────────────────────────────────

const PHASE_PILL: Record<ClockPhase, { label: string; cls: string }> = {
  off_clock:       { label: 'Not clocked in', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  working:         { label: 'Clocked in',     cls: 'bg-green-100 text-green-700 border-green-200' },
  on_lunch:        { label: 'On lunch',        cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  back_from_lunch: { label: 'Working',         cls: 'bg-green-100 text-green-700 border-green-200' },
  done:            { label: 'Complete',        cls: 'bg-blue-100 text-blue-700 border-blue-200' },
}

const ACTION_LABEL: Record<PunchType, string> = {
  clock_in:  'Clock In',
  lunch_out: 'Start Lunch',
  lunch_in:  'End Lunch',
  clock_out: 'Clock Out',
}

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

function formatHM(ms: number): string {
  return formatMinutes(Math.max(0, ms) / 60000)
}

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

const SESSION_PUNCH_KEY: Record<PunchType, keyof WorkSession> = {
  clock_in:  'clock_in_at',
  lunch_out: 'lunch_out_at',
  lunch_in:  'lunch_in_at',
  clock_out: 'clock_out_at',
}

// ── Component ──────────────────────────────────────────────────────────────────

export interface EmployeeTimeClockProps {
  onPunchSuccess?: () => void
}

export function EmployeeTimeClock({ onPunchSuccess }: EmployeeTimeClockProps = {}) {
  const [activeSession, setActiveSession]         = useState<WorkSession | null>(null)
  const [todaySessions, setTodaySessions]         = useState<WorkSession[]>([])
  const [assignments, setAssignments]             = useState<EligibleAssignment[]>([])
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null)
  const [loading, setLoading]                     = useState(true)
  const [assignmentsLoading, setAssignmentsLoading] = useState(false)
  const [pending, setPending]                     = useState<PunchType | null>(null)
  const [error, setError]                         = useState('')
  const [nowTs, setNowTs]                         = useState(() => Date.now())
  const [workDate, setWorkDate]                   = useState('')

  const loadSessions = useCallback(async () => {
    setLoading(true)
    const res = await getTodaySessions()
    if (res.success && res.sessions) {
      const all = res.sessions
      setTodaySessions(all)
      const active = all.find(s => s.clock_in_at && !s.clock_out_at) ?? null
      setActiveSession(active)
      if (all.length > 0) setWorkDate(all[0].work_date)
      setError('')
    } else {
      setError(res.error || 'Could not load your time status.')
    }
    setLoading(false)
  }, [])

  const loadAssignments = useCallback(async () => {
    setAssignmentsLoading(true)
    const res = await getMyEligibleAssignments()
    setAssignments(res.success ? (res.assignments ?? []) : [])
    setAssignmentsLoading(false)
  }, [])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const phase = deriveSessionPhase(activeSession)

  // Load assignments whenever we need the job picker (no active session)
  useEffect(() => {
    if (phase === 'off_clock') {
      loadAssignments()
    }
  }, [phase, loadAssignments])

  const isRunning = phase === 'working' || phase === 'on_lunch' || phase === 'back_from_lunch'

  // Live timer tick — only while a session is running
  useEffect(() => {
    if (!isRunning) return
    setNowTs(Date.now())
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isRunning, phase])

  const handlePunch = async (punchType: PunchType) => {
    if (pending || loading) return

    const assignmentId = punchType === 'clock_in' ? selectedAssignmentId : null

    // Require assignment selection for Clock In
    if (punchType === 'clock_in' && !assignmentId) {
      setError('Please select a Work Job before clocking in.')
      return
    }

    setPending(punchType)
    setError('')

    const res = await recordSessionPunch(punchType, assignmentId ?? undefined)

    if (res.success) {
      // Clear selection after successful Clock In (locked to session now)
      if (punchType === 'clock_in') {
        setSelectedAssignmentId(null)
      }
      // Clear selection after Clock Out (ready for next job)
      if (punchType === 'clock_out') {
        setSelectedAssignmentId(null)
      }
      await loadSessions()
      onPunchSuccess?.()
    } else {
      setError(res.error || 'Could not record punch.')
      await loadSessions()
    }
    setPending(null)
  }

  const busy = loading || pending != null

  // ── Loading (first load) ──
  if (loading && todaySessions.length === 0 && !activeSession) {
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
  const actions = getNextSessionActions(phase)

  // ── Live durations (visual only, from active session) ──
  const ts = {
    clockIn:  toMs(activeSession?.clock_in_at),
    lunchOut: toMs(activeSession?.lunch_out_at),
    lunchIn:  toMs(activeSession?.lunch_in_at),
    clockOut: toMs(activeSession?.clock_out_at),
  }

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
  }
  workedMs = Math.max(0, workedMs)
  lunchMs  = Math.max(0, lunchMs)

  const onLunch = phase === 'on_lunch'
  const liveMs  = onLunch ? lunchMs : workedMs
  const timerAccent = onLunch
    ? { box: 'bg-amber-50 border-amber-200', label: 'text-amber-700', value: 'text-amber-800', dot: 'bg-amber-500' }
    : { box: 'bg-green-50 border-green-200', label: 'text-green-700', value: 'text-green-800', dot: 'bg-green-500' }

  // Selected assignment for confirmation summary
  const selectedAssignment = assignments.find(a => a.id === selectedAssignmentId)

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
      {/* Scoped animations */}
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

      {/* Date */}
      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">
        {formatWorkDate(workDate || (new Date()).toLocaleDateString('en-CA'))}
      </p>

      {/* Active session info */}
      {activeSession && phase !== 'off_clock' && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 flex items-start gap-2">
          <Briefcase className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Active Job</p>
            {activeSession.project_name && (
              <p className="text-xs text-gray-500 truncate">{activeSession.project_name}</p>
            )}
            <p className="text-sm font-bold text-gray-900 truncate">
              {activeSession.work_package_name ?? 'Unknown Work Order'}
            </p>
          </div>
        </div>
      )}

      {/* Live timer panel */}
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
            <span>Worked <b className="text-gray-800 tabular-nums">{formatHM(workedMs)}</b></span>
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

      {/* Job picker — visible when no active session */}
      {phase === 'off_clock' && (
        <div className="space-y-3">
          {assignmentsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
              <Loader2 size={14} className="animate-spin" />
              Loading available jobs…
            </div>
          ) : (
            <EmployeeJobPicker
              assignments={assignments}
              selectedId={selectedAssignmentId}
              onSelect={id => {
                setSelectedAssignmentId(id)
                setError('')
              }}
            />
          )}

          {/* Confirmation summary before Clock In */}
          {selectedAssignment && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-3 space-y-0.5">
              <p className="text-[10px] font-bold text-green-700 uppercase tracking-wide">
                Ready to clock in
              </p>
              {selectedAssignment.project_name && (
                <p className="text-xs text-green-800 truncate">{selectedAssignment.project_name}</p>
              )}
              <p className="text-sm font-bold text-green-900 truncate">
                {selectedAssignment.work_package_name}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Punch action buttons */}
      <div className="space-y-2">
        {actions.map((action, idx) => {
          const isPrimary = idx === 0
          const isPending = pending === action
          const Icon      = ACTION_ICON[action]
          const isClockIn = action === 'clock_in'
          const disabled  = busy || (isClockIn && !selectedAssignmentId)
          const base      = 'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-base transition disabled:opacity-60 disabled:cursor-not-allowed'
          const style     = isPrimary ? PRIMARY_BTN[phase] : SECONDARY_BTN
          const pulse     = phase === 'off_clock' && isPrimary && !busy && selectedAssignmentId
            ? 'eclock-pulse' : ''
          return (
            <button
              key={action}
              type="button"
              onClick={() => handlePunch(action)}
              disabled={disabled}
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

      {/* Today's punch summary (active session, fixed visual order) */}
      {activeSession && (
        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Today's punches
          </p>
          <ul className="space-y-1.5">
            {PUNCH_DISPLAY_ORDER.map(({ type, label }) => {
              const timeIso = activeSession[SESSION_PUNCH_KEY[type]] as string | null
              const time = formatTime(timeIso)
              return (
                <li key={type} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{label}</span>
                  <span className={`font-medium tabular-nums ${time === '—' ? 'text-gray-300' : 'text-gray-900'}`}>
                    {time}
                  </span>
                </li>
              )
            })}
          </ul>
          {(activeSession.paid_minutes != null || activeSession.lunch_minutes != null) && (
            <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Paid</p>
                <p className="text-sm font-bold text-gray-900">{formatMinutes(activeSession.paid_minutes)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Lunch</p>
                <p className="text-sm font-bold text-gray-900">{formatMinutes(activeSession.lunch_minutes)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Status</p>
                <p className="text-sm font-bold text-gray-900 capitalize">{activeSession.status}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Completed sessions for today */}
      {todaySessions.filter(s => s.clock_out_at).length > 0 && (
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Completed today ({todaySessions.filter(s => s.clock_out_at).length})
          </p>
          {todaySessions.filter(s => s.clock_out_at).map(s => (
            <div key={s.id} className="flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-700 truncate">
                  {s.work_package_name ?? 'Session'}
                </p>
                <p className="text-gray-400">
                  {formatTime(s.clock_in_at)} – {formatTime(s.clock_out_at)}
                </p>
              </div>
              <div className="text-right flex-shrink-0 ml-2">
                <p className="font-bold text-green-700">{formatMinutes(s.paid_minutes)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default EmployeeTimeClock
