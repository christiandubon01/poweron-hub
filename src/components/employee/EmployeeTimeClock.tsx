// @ts-nocheck
/**
 * EmployeeTimeClock — Wide two-column employee time clock (EMPLOYEE-CLOCK-WORKSPACE-1).
 *
 * LEFT COLUMN:  live Current Time, elapsed session timer, active-job context,
 *               punch controls, status and errors.
 * RIGHT COLUMN: project + Work Package/Work Order selection.
 *
 * State update contract:
 *   Every successful punch IMMEDIATELY applies the authoritative server-returned
 *   session JSONB to local state — no reload, no remount, no setTimeout.
 *   A background silent revalidation follows with a stale-guard generation ref
 *   so an older in-flight response never overwrites the just-applied punch state.
 *
 * Timers:
 *   nowTs ticks every second unconditionally (powers both Current Time display
 *   and the session elapsed timer). No backend polling.
 *   calcElapsedMs() is a pure function imported from sessionElapsed.ts.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Clock,
  Loader2,
  AlertCircle,
  Play,
  Coffee,
  Square,
  Briefcase,
  Building2,
} from 'lucide-react'
import {
  getTodaySessions,
  getMyEligibleAssignments,
  getEmployeeActiveProjects,
  deriveSessionPhase,
  getNextSessionActions,
  recordSessionPunch,
  sessionStateToWorkSession,
  resolveActiveSessionAfterLoad,
  sessionPunchPhaseRank,
  PUNCH_DISPLAY_ORDER,
  type WorkSession,
  type EligibleAssignment,
  type EmployeeActiveProject,
  type PunchType,
  type ClockPhase,
  type LastAppliedPunchState,
} from '@/services/employeeTimeService'
import { calcElapsedMs, formatElapsed, formatElapsedHM, formatTenantTime } from '@/lib/sessionElapsed'
import { EmployeeJobPicker, type JobSelection } from './EmployeeJobPicker'

// ── Presentation maps ──────────────────────────────────────────────────────────

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
  const [activeSession, setActiveSession]     = useState<WorkSession | null>(null)
  const [todaySessions, setTodaySessions]     = useState<WorkSession[]>([])
  const [assignments, setAssignments]         = useState<EligibleAssignment[]>([])
  const [activeProjects, setActiveProjects]   = useState<EmployeeActiveProject[]>([])
  const [selection, setSelection]             = useState<JobSelection>(null)
  const [loading, setLoading]                 = useState(true)
  const [jobsLoading, setJobsLoading]         = useState(false)
  const [pending, setPending]                 = useState<PunchType | null>(null)
  const [error, setError]                     = useState('')
  const [nowTs, setNowTs]                     = useState(() => Date.now())
  const [workDate, setWorkDate]               = useState('')
  // End-of-day closeout (restored from TIME-3 / ed84439) — opens before Clock Out.
  const [showClockOutSummary, setShowClockOutSummary] = useState(false)
  const [clockOutSummary, setClockOutSummary] = useState('')

  // Generation ref: incremented before every getTodaySessions() call and on
  // successful punch apply. Stale completions see gen !== loadGenRef.current
  // and are discarded. lastAppliedRef fingerprints lunch + clock-out so a
  // lagging same-session server row cannot roll back Start/End Lunch.
  const loadGenRef = useRef(0)
  const lastAppliedRef = useRef<LastAppliedPunchState | null>(null)

  // ── Initial load ──

  const loadSessions = useCallback(async (initial = false) => {
    const gen = ++loadGenRef.current
    if (initial) setLoading(true)

    const res = await getTodaySessions()
    if (gen !== loadGenRef.current) return   // superseded

    if (res.success && res.sessions) {
      const all = res.sessions
      setActiveSession(prev =>
        resolveActiveSessionAfterLoad(all, prev, lastAppliedRef.current),
      )
      // Keep a just-applied local active session when the server omits it or
      // still echoes an older lunch phase for the same session id.
      setTodaySessions(prevSessions => {
        const applied = lastAppliedRef.current
        const localActive =
          applied && !applied.clockOutAt
            ? prevSessions.find(s => s.id === applied.id && s.clock_in_at && !s.clock_out_at)
            : undefined
        if (!localActive) return all

        const serverRow = all.find(s => s.id === localActive.id)
        if (!serverRow) {
          return [...all.filter(s => s.id !== localActive.id), localActive]
        }
        if (sessionPunchPhaseRank(localActive) > sessionPunchPhaseRank(serverRow)) {
          return all.map(s => (s.id === localActive.id ? localActive : s))
        }
        return all
      })
      if (all.length > 0) setWorkDate(all[0].work_date)
      if (initial) setError('')
    } else {
      if (initial) setError(res.error || 'Could not load your time status.')
    }

    if (initial) setLoading(false)
  }, [])

  const loadJobs = useCallback(async () => {
    setJobsLoading(true)
    const [assignRes, projRes] = await Promise.all([
      getMyEligibleAssignments(),
      getEmployeeActiveProjects(),
    ])
    setAssignments(assignRes.success ? (assignRes.assignments ?? []) : [])
    setActiveProjects(projRes.success ? (projRes.projects ?? []) : [])
    setJobsLoading(false)
  }, [])

  useEffect(() => {
    loadSessions(true)
  }, [loadSessions])

  const phase = deriveSessionPhase(activeSession)

  // Load job/project list when we need the picker
  useEffect(() => {
    if (phase === 'off_clock') {
      loadJobs()
    }
  }, [phase, loadJobs])

  // ── Live tick — always running (powers both Current Time and session timer) ──

  useEffect(() => {
    setNowTs(Date.now())
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // ── Punch handler ──

  const handlePunch = async (punchType: PunchType, endOfDaySummary?: string | null) => {
    if (pending || loading) return

    if (punchType === 'clock_in' && !selection) {
      setError('Please select a Project or Work Package before clocking in.')
      return
    }

    // Clock Out: open closeout form before any punch is recorded.
    if (punchType === 'clock_out' && endOfDaySummary === undefined && !showClockOutSummary) {
      setShowClockOutSummary(true)
      setClockOutSummary('')
      setError('')
      return
    }

    setPending(punchType)
    setError('')

    try {
      const assignmentId =
        punchType === 'clock_in' && selection?.type === 'assignment'
          ? selection.assignmentId
          : undefined

      const projectId =
        punchType === 'clock_in' && selection?.type === 'project_only'
          ? selection.projectId
          : undefined

      const summaryForRpc =
        punchType === 'clock_out'
          ? (endOfDaySummary !== undefined ? endOfDaySummary : clockOutSummary)
          : null

      const res = await recordSessionPunch(punchType, assignmentId, projectId, summaryForRpc)

      if (res.success && res.sessionState) {
        // ── IMMEDIATE authoritative state update from RPC response ──
        const updated = sessionStateToWorkSession(res.sessionState, activeSession)
        if (!updated || (punchType === 'clock_in' && !updated.clock_in_at)) {
          setError('Punch was recorded but session state could not be applied. Refresh and try again.')
          loadSessions(false)
          return
        }

        // Invalidate any in-flight load started before this punch so it cannot
        // overwrite the authoritative local success with a pre-punch snapshot.
        loadGenRef.current += 1
        lastAppliedRef.current = {
          id: updated.id,
          clockOutAt: updated.clock_out_at,
          lunchOutAt: updated.lunch_out_at,
          lunchInAt:  updated.lunch_in_at,
        }

        if (punchType === 'clock_out') {
          setShowClockOutSummary(false)
          setClockOutSummary('')
          setActiveSession(null)
          setTodaySessions(prev => {
            const filtered = prev.filter(s => s.id !== updated.id)
            return [...filtered, updated]
          })
          setSelection(null)
          setError('')
        } else if (punchType === 'clock_in') {
          setActiveSession(updated)
          setTodaySessions(prev => {
            const existing = prev.some(s => s.id === updated.id)
            return existing ? prev.map(s => s.id === updated.id ? updated : s) : [...prev, updated]
          })
          if (updated.work_date) setWorkDate(updated.work_date)
          setSelection(null)
          setError('')
        } else {
          // lunch_out / lunch_in: update in place
          setActiveSession(updated)
          setTodaySessions(prev => {
            const existing = prev.some(s => s.id === updated.id)
            return existing ? prev.map(s => s.id === updated.id ? updated : s) : [...prev, updated]
          })
          setError('')
        }

        // Shared My Time refresh version (parent), then one stale-guarded revalidation.
        onPunchSuccess?.()
        loadSessions(false)
      } else {
        // Keep closeout form open with entered text on failure.
        setError(res.error || 'Could not record punch.')
        if (!showClockOutSummary) {
          loadSessions(false)
        }
      }
    } finally {
      setPending(null)
    }
  }

  const cancelClockOutSummary = () => {
    if (pending) return
    setShowClockOutSummary(false)
    setClockOutSummary('')
    setError('')
  }

  const busy = loading || pending != null

  // ── Elapsed timer (pure calculation from session timestamps) ──

  const elapsed = calcElapsedMs(
    activeSession?.clock_in_at,
    activeSession?.lunch_out_at,
    activeSession?.lunch_in_at,
    activeSession?.clock_out_at,
    nowTs,
  )

  const isRunning = phase === 'working' || phase === 'on_lunch' || phase === 'back_from_lunch'

  const timerAccent = elapsed.isOnLunch
    ? { box: 'bg-amber-50 border-amber-200', label: 'text-amber-700', value: 'text-amber-800', dot: 'bg-amber-500' }
    : { box: 'bg-green-50 border-green-200', label: 'text-green-700', value: 'text-green-800', dot: 'bg-green-500' }

  // ── Initial loading screen ──

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

  const clockInDisabled = busy || (phase === 'off_clock' && !selection)

  return (
    <>
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
        .eclock-pulse    { animation: eclockPulse 2s ease-in-out infinite; }
        .eclock-live-dot { animation: eclockDot 1.4s ease-in-out infinite; }
        .eclock-done     { animation: eclockGlow 2.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .eclock-pulse, .eclock-live-dot, .eclock-done { animation: none !important; }
        }
      `}</style>

      {/* ── Wide two-column desktop layout ── */}
      <div className="grid gap-5 lg:grid-cols-[2fr_3fr] items-start">

        {/* ═══ LEFT COLUMN: Clock controls ═══ */}
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

          {/* Date */}
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">
            {formatWorkDate(workDate || (new Date()).toLocaleDateString('en-CA'))}
          </p>

          {/* CURRENT TIME — live wall clock, always visible */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">
              Current Time
            </p>
            <p className="text-2xl font-bold tabular-nums text-gray-900 leading-none">
              {formatTenantTime(nowTs)}
            </p>
          </div>

          {/* ACTIVE SESSION TIMER — only while a session is running */}
          {isRunning && (
            <div className={`rounded-xl border px-4 py-3 ${timerAccent.box}`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold uppercase tracking-wide ${timerAccent.label}`}>
                  {elapsed.isOnLunch ? 'Lunch time' : 'Current Time Session'}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
                  <span className={`eclock-live-dot w-1.5 h-1.5 rounded-full ${timerAccent.dot}`} />
                  Live
                </span>
              </div>
              <p className={`mt-1 text-3xl font-bold tabular-nums leading-none ${timerAccent.value}`}>
                {elapsed.isOnLunch
                  ? formatElapsed(elapsed.lunchMs)
                  : formatElapsed(elapsed.workedMs)}
              </p>
              <div className="mt-2.5 flex items-center gap-4 text-xs text-gray-500">
                <span>Worked <b className="text-gray-800 tabular-nums">{formatElapsedHM(elapsed.workedMs)}</b></span>
                <span>Lunch <b className="text-gray-800 tabular-nums">{formatElapsedHM(elapsed.lunchMs)}</b></span>
              </div>
              {elapsed.isOnLunch && (
                <p className="mt-1.5 text-[11px] text-amber-700 font-medium">Paused for lunch</p>
              )}
            </div>
          )}

          {/* Active job context */}
          {activeSession && phase !== 'off_clock' && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 flex items-start gap-2">
              {activeSession.assignment_id
                ? <Briefcase className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                : <Building2 className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />}
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Active Time Session</p>
                {activeSession.project_name && (
                  <p className="text-xs text-gray-500 truncate">{activeSession.project_name}</p>
                )}
                {activeSession.work_package_name ? (
                  <>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">Work Package</p>
                    <p className="text-sm font-bold text-gray-900 truncate">
                      {activeSession.work_package_name}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-blue-600">Project Only</p>
                    <p className="text-[11px] text-gray-500">Work Package: Not assigned yet</p>
                  </>
                )}
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

          {/* Confirmation summary before Clock In */}
          {phase === 'off_clock' && selection && (
            <div className={`border rounded-xl px-3 py-3 space-y-0.5 ${
              selection.type === 'assignment'
                ? 'bg-green-50 border-green-200'
                : 'bg-blue-50 border-blue-200'
            }`}>
              <p className={`text-[10px] font-bold uppercase tracking-wide ${
                selection.type === 'assignment' ? 'text-green-700' : 'text-blue-700'
              }`}>
                Ready to clock in
              </p>
              <p className={`text-xs truncate ${selection.type === 'assignment' ? 'text-green-800' : 'text-blue-800'}`}>
                {selection.projectName}
              </p>
              {selection.type === 'assignment' ? (
                <p className="text-sm font-bold text-green-900 truncate">
                  {selection.workPackageName}
                </p>
              ) : (
                <p className="text-sm font-semibold text-blue-700">
                  Project Only — Work Package optional
                </p>
              )}
            </div>
          )}

          {/* Punch actions OR end-of-day closeout (same form for assignment + Project-only) */}
          {showClockOutSummary ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-3 space-y-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Clocking out</p>
                <p className="text-[11px] text-gray-500">
                  Project
                </p>
                <p className="text-sm font-bold text-gray-900 truncate">
                  {activeSession?.project_name ?? '—'}
                </p>
                <p className="text-[11px] text-gray-500 mt-1.5">
                  Work Package
                </p>
                <p className={`text-sm font-semibold truncate ${
                  activeSession?.work_package_name ? 'text-gray-900' : 'text-blue-600'
                }`}>
                  {activeSession?.work_package_name ?? 'Not assigned yet'}
                </p>
              </div>
              <div>
                <label htmlFor="eod-summary" className="block text-sm font-semibold text-gray-800 mb-1.5">
                  What did you get done today?
                </label>
                <textarea
                  id="eod-summary"
                  value={clockOutSummary}
                  onChange={(e) => setClockOutSummary(e.target.value)}
                  placeholder="Work completed, delays or blockers, and any notes…"
                  rows={4}
                  maxLength={4000}
                  disabled={busy}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60"
                  style={{ minHeight: 96, fontSize: 16 }}
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Optional — you can clock out without a summary.
                </p>
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
                const isPrimary = idx === 0
                const isPending = pending === action
                const Icon      = ACTION_ICON[action]
                const disabled  = action === 'clock_in' ? clockInDisabled : busy
                const base      = 'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-base transition disabled:opacity-60 disabled:cursor-not-allowed'
                const style     = isPrimary ? PRIMARY_BTN[phase] : SECONDARY_BTN
                const pulse     = phase === 'off_clock' && isPrimary && !busy && selection ? 'eclock-pulse' : ''
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
          )}

          {/* Today's punch summary (active session) */}
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
        </div>

        {/* ═══ RIGHT COLUMN: Assigned Work ═══ */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-gray-500" />
            <h2 className="text-base font-bold text-gray-900">Assigned Work</h2>
          </div>

          {/* Job picker — only available when not clocked in */}
          {phase === 'off_clock' ? (
            jobsLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                <Loader2 size={14} className="animate-spin" />
                Loading available jobs…
              </div>
            ) : (
              <EmployeeJobPicker
                assignments={assignments}
                activeProjects={activeProjects}
                selection={selection}
                onSelect={sel => {
                  setSelection(sel)
                  setError('')
                }}
              />
            )
          ) : (
            /* Locked display when session is active */
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Work context is locked while a Time Session is active.
              </p>
              {activeSession && (
                <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 space-y-1">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Active Project</p>
                  <p className="text-sm font-bold text-gray-900">{activeSession.project_name ?? '—'}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide mt-1">Work Package</p>
                  <p className="text-[11px] text-gray-500">
                    {activeSession.work_package_name ?? 'Not assigned yet'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Completed Time Sessions for today */}
          {todaySessions.filter(s => s.clock_out_at).length > 0 && (
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Completed Today ({todaySessions.filter(s => s.clock_out_at).length})
              </p>
              {todaySessions.filter(s => s.clock_out_at).map(s => (
                <div key={s.id} className="flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-700 truncate">
                      {s.project_name ?? 'Time Session'}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      Work Package: {s.work_package_name ?? 'Not assigned yet'}
                    </p>
                    <p className="text-gray-400">
                      {formatTime(s.clock_in_at)} – {formatTime(s.clock_out_at)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className="font-bold text-green-700">{formatMinutes(s.paid_minutes)}</p>
                    {!s.work_package_name && (
                      <p className="text-[10px] text-blue-500">Project Only</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default EmployeeTimeClock
