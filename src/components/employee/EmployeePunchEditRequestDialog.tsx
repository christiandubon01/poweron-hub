// @ts-nocheck
/**
 * EmployeePunchEditRequestDialog — employee punch correction request modal
 * (EMPLOYEE-MY-TIME-WEEK-1 + SESSIONS-1).
 *
 * Lets the employee select a specific punch point, compare the current value
 * to the requested value, add a reason, and submit via submitPunchEditRequest.
 *
 * When sessionId is supplied the dialog reads punch times from the matching
 * session row instead of the day's time_entry aggregate.
 *
 * Does NOT directly modify any punch or time_entry. The request must be
 * reviewed and applied by an admin.
 */

import React, { useState } from 'react'
import { X, Clock, AlertCircle, Loader2 } from 'lucide-react'
import type { EmployeeMyTimeDay, EmployeeWorkSession, PunchEditRequest } from '@/services/employeePortalService'
import { submitPunchEditRequest } from '@/services/employeePortalService'
import { PUNCH_DISPLAY_ORDER, type PunchType } from '@/services/employeeTimeService'
import { formatTimeSessionIdentityLine, resolveTimeSessionIdentity } from '@/services/timeSessionIdentity'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function splitToLocalDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return { date: `${y}-${m}-${dd}`, time: `${hh}:${mm}` }
}

function combineLocalDateTime(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString()
}

const SESSION_KEY_MAP: Record<PunchType, keyof EmployeeWorkSession> = {
  clock_in:  'clock_in_at',
  lunch_out: 'lunch_out_at',
  lunch_in:  'lunch_in_at',
  clock_out: 'clock_out_at',
}

const ENTRY_KEY_MAP: Record<PunchType, 'clock_in_at' | 'lunch_out_at' | 'lunch_in_at' | 'clock_out_at'> = {
  clock_in:  'clock_in_at',
  lunch_out: 'lunch_out_at',
  lunch_in:  'lunch_in_at',
  clock_out: 'clock_out_at',
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface EmployeePunchEditRequestDialogProps {
  /** The time_entry row id — required by the RPC even when a session is targeted. */
  timeEntryId: string
  /** Work date string (YYYY-MM-DD) for display and date pre-fill. */
  workDate: string
  /** Full day data so the dialog can read current punch times. */
  day: EmployeeMyTimeDay
  /**
   * When set, targets a specific session. The dialog reads punch times from
   * that session and passes p_session_id to the RPC (migration 099).
   */
  sessionId?: string | null
  /** Punch types that already have a pending request (blocks re-submission). */
  pendingPunchTypes: Set<PunchType>
  onClose: () => void
  onSubmitted: (request: PunchEditRequest) => void
}

export function EmployeePunchEditRequestDialog({
  timeEntryId,
  workDate,
  day,
  sessionId,
  pendingPunchTypes,
  onClose,
  onSubmitted,
}: EmployeePunchEditRequestDialogProps) {
  const [selectedType, setSelectedType] = useState<PunchType | null>(null)
  const [reqDate, setReqDate]           = useState(workDate)
  const [reqTime, setReqTime]           = useState('')
  const [reason, setReason]             = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [error, setError]               = useState('')

  // Resolve the active session when sessionId is provided
  const session: EmployeeWorkSession | undefined = sessionId
    ? day.sessions.find(s => s.id === sessionId)
    : undefined

  // Read the current time for a punch type from session (preferred) or entry
  function getSourceTime(type: PunchType): string | null {
    if (session) {
      return (session[SESSION_KEY_MAP[type]] as string | null) ?? null
    }
    const e = day.entry
    if (!e) return null
    return (e[ENTRY_KEY_MAP[type]] as string | null) ?? null
  }

  function handleSelectType(type: PunchType) {
    setSelectedType(type)
    setError('')
    const current = getSourceTime(type)
    if (current) {
      const { date, time } = splitToLocalDateTime(current)
      setReqDate(date)
      setReqTime(time)
    } else {
      setReqDate(workDate)
      setReqTime('')
    }
  }

  const currentTime    = selectedType ? getSourceTime(selectedType) : null
  const currentDisplay = currentTime ? formatTime(currentTime) : 'Missing'

  const hasPendingAlready = selectedType ? pendingPunchTypes.has(selectedType) : false
  const requestedIso      = reqDate && reqTime ? combineLocalDateTime(reqDate, reqTime) : null
  const isUnchanged       = !!(currentTime && requestedIso && currentTime === requestedIso)
  const canSubmit =
    !submitting &&
    selectedType !== null &&
    reqDate.length > 0 &&
    reqTime.length > 0 &&
    reason.trim().length > 0 &&
    !hasPendingAlready &&
    !isUnchanged

  async function handleSubmit() {
    if (!canSubmit || !selectedType || !requestedIso) return

    setSubmitting(true)
    setError('')

    const res = await submitPunchEditRequest(
      timeEntryId,
      selectedType,
      requestedIso,
      reason.trim(),
      sessionId ?? null,
    )

    if (res.success && res.data) {
      onSubmitted(res.data)
    } else {
      setError(res.error ?? 'Could not submit request. Please try again.')
    }

    setSubmitting(false)
  }

  // Session identity subtitle when editing a specific session
  const sessionSubtitle = session
    ? (() => {
        const identity = resolveTimeSessionIdentity({
          assignmentId: session.assignment_id,
          workPackageName: session.work_package_name,
          projectName: session.project_name,
        })
        if (identity.kind === 'project-only') {
          return identity.projectName ? `Project: ${identity.projectName}` : null
        }
        return formatTimeSessionIdentityLine(identity)
      })()
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
              <Clock className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">Request Punch Edit</h2>
              <p className="text-xs text-gray-500">
                {sessionSubtitle ?? workDate}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Step 1 — Select punch point (shared PUNCH_DISPLAY_ORDER) */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
              Select Punch Point
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PUNCH_DISPLAY_ORDER.map(({ type, label }) => {
                const isPending  = pendingPunchTypes.has(type)
                const isSelected = selectedType === type
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={isPending}
                    onClick={() => handleSelectType(type)}
                    className={`rounded-xl border py-2.5 px-3 text-sm font-semibold transition text-left ${
                      isSelected
                        ? 'bg-green-600 border-green-600 text-white'
                        : isPending
                          ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-white border-gray-300 text-gray-700 hover:border-green-400 hover:bg-green-50'
                    }`}
                  >
                    {label}
                    {isPending && (
                      <span className="block text-[10px] font-normal mt-0.5 text-purple-500">
                        Pending
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Step 2 — Compare times */}
          {selectedType && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-3">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                    Current Time
                  </p>
                  <p className={`text-lg font-bold tabular-nums leading-tight ${
                    currentTime ? 'text-gray-900' : 'text-gray-400 italic'
                  }`}>
                    {currentDisplay}
                  </p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-3">
                  <p className="text-[11px] font-bold text-green-700 uppercase tracking-wide mb-1">
                    Requested Time
                  </p>
                  <p className="text-lg font-bold text-green-700 tabular-nums leading-tight">
                    {reqDate && reqTime ? formatTime(combineLocalDateTime(reqDate, reqTime)) : '—'}
                  </p>
                </div>
              </div>

              {/* Date + time inputs */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1 uppercase tracking-wide">
                    Date
                  </label>
                  <input
                    type="date"
                    value={reqDate}
                    onChange={e => { setReqDate(e.target.value); setError('') }}
                    disabled={submitting}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1 uppercase tracking-wide">
                    Time
                  </label>
                  <input
                    type="time"
                    value={reqTime}
                    onChange={e => { setReqTime(e.target.value); setError('') }}
                    disabled={submitting}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 disabled:opacity-60"
                  />
                </div>
              </div>

              {isUnchanged && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  The requested time matches the current time. Please enter a different time.
                </p>
              )}
            </div>
          )}

          {/* Step 3 — Reason */}
          {selectedType && (
            <div>
              <label
                htmlFor="punch-edit-reason"
                className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5"
              >
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                id="punch-edit-reason"
                value={reason}
                onChange={e => { setReason(e.target.value); setError('') }}
                placeholder="Briefly explain why this punch needs to be corrected…"
                rows={3}
                disabled={submitting}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 disabled:opacity-60"
                style={{ minHeight: 80, fontSize: 15 }}
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Your reason is reviewed by your manager before any change is applied.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-4 border-t border-gray-100 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-3 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 transition disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-busy={submitting}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-green-600 hover:bg-green-500 active:bg-green-700 text-white text-sm font-bold transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Submit Request
          </button>
        </div>
      </div>
    </div>
  )
}

export default EmployeePunchEditRequestDialog
