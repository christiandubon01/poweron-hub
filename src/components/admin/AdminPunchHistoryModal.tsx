// @ts-nocheck
/**
 * AdminPunchHistoryModal — full admin punch management for one employee/day
 * (ADMIN-TIMESHEET-1).
 *
 * Features: daily summary + approval status, full punch audit trail (including
 * voided), inline edit with correction note, void with confirm, add missing
 * punch, approve/reject timecard. Every write uses the admin_record_punch /
 * admin_void_punch / admin_update_approval_status RPCs (source='admin_edit').
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  X,
  Clock,
  Pencil,
  Plus,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
} from 'lucide-react'
import type { TimePunchEvent, PunchType, TimeEntry } from '@/services/employeeTimeService'
import {
  getPunchesForDay,
  getTimeEntryForDay,
  adminRecordPunch,
  adminVoidPunch,
  adminUpdateApprovalStatus,
  getPunchEditRequestsForDay,
  adminReviewPunchEditRequest,
  getSessionsForDay,
  adminRecordSessionPunch,
  adminAttachSessionAssignment,
  getProjectAssignmentsForAdmin,
  type PunchEditRequest,
  type AdminWorkSession,
  type AdminProjectAssignment,
} from '@/services/adminTimecardService'

// ── Props ──────────────────────────────────────────────────────────────────────

interface AdminPunchHistoryModalProps {
  employeeName: string
  employeeProfileId: string
  workDate: string
  initialPunches: TimePunchEvent[]
  initialEntry: TimeEntry | null
  onClose: () => void
  onRefresh?: () => void
}

// ── Lookup tables ──────────────────────────────────────────────────────────────

const PUNCH_LABEL: Record<PunchType, string> = {
  clock_in:  'Clock In',
  lunch_out: 'Lunch Out',
  lunch_in:  'Lunch In',
  clock_out: 'Clock Out',
}

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  employee_portal: {
    label: 'Employee',
    cls:   'bg-gray-600/30 text-gray-400 border-gray-600',
  },
  admin_edit: {
    label: 'Admin Edit',
    cls:   'bg-amber-600/20 text-amber-300 border-amber-700/50',
  },
  system_auto: {
    label: 'System',
    cls:   'bg-blue-600/20 text-blue-300 border-blue-700/50',
  },
}

const APPROVAL_DISPLAY: Record<string, { label: string; cls: string }> = {
  none: {
    label: 'Not reviewed',
    cls:   'bg-gray-700/60 text-gray-400 border-gray-600',
  },
  pending: {
    label: 'Pending approval',
    cls:   'bg-amber-600/20 text-amber-300 border-amber-700/50',
  },
  approved: {
    label: 'Approved',
    cls:   'bg-green-600/20 text-green-300 border-green-700/50',
  },
  rejected: {
    label: 'Rejected',
    cls:   'bg-red-600/20 text-red-300 border-red-700/50',
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function splitDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-CA')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return { date, time: `${hh}:${mm}` }
}

function combineDateTime(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString()
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function AdminPunchHistoryModal({
  employeeName,
  employeeProfileId,
  workDate,
  initialPunches,
  initialEntry,
  onClose,
  onRefresh,
}: AdminPunchHistoryModalProps) {
  // Data state
  const [punches, setPunches]     = useState<TimePunchEvent[]>(initialPunches)
  const [entry, setEntry]         = useState<TimeEntry | null>(initialEntry)
  const [refreshing, setRefreshing] = useState(false)

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDate, setEditDate]   = useState('')
  const [editTime, setEditTime]   = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editError, setEditError] = useState('')
  const [saving, setSaving]       = useState(false)

  // Void confirm state
  const [voidConfirmId, setVoidConfirmId] = useState<string | null>(null)
  const [voiding, setVoiding]             = useState(false)

  // Add punch state
  const [showAddForm, setShowAddForm] = useState(false)
  const [addType, setAddType]         = useState<PunchType>('clock_in')
  const [addDate, setAddDate]         = useState(workDate)
  const [addTime, setAddTime]         = useState('08:00')
  const [addNotes, setAddNotes]       = useState('')
  const [addError, setAddError]       = useState('')
  const [adding, setAdding]           = useState(false)

  // Approval state
  const [approving, setApproving]   = useState(false)
  const [globalError, setGlobalError] = useState('')

  // Punch edit request state (migration 097)
  const [editRequests, setEditRequests]         = useState<PunchEditRequest[]>([])
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null)
  const [reviewError, setReviewError]           = useState('')

  // Session state (migration 099/100) — for routing pencil edits, labelling requests,
  // and displaying the project-only Attach Work Package UI
  const [sessions, setSessions] = useState<AdminWorkSession[]>([])

  // Attach Work Package state (migration 100)
  const [attachingSessionId, setAttachingSessionId]         = useState<string | null>(null)
  const [attachAssignments, setAttachAssignments]           = useState<AdminProjectAssignment[]>([])
  const [attachAssignmentsLoading, setAttachAssignmentsLoading] = useState(false)
  const [attachSelectedId, setAttachSelectedId]             = useState('')
  const [attachError, setAttachError]                       = useState('')
  const [attaching, setAttaching]                           = useState(false)

  // Voided audit disclosure — collapsed by default each time the modal opens
  const [voidedExpanded, setVoidedExpanded] = useState(false)

  // ── Refresh: fetches all punches (including voided) + entry ─────────────────

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setGlobalError('')
    const [punchRes, entryRes, reqRes, sessionRes] = await Promise.all([
      getPunchesForDay(employeeProfileId, workDate),
      getTimeEntryForDay(employeeProfileId, workDate),
      getPunchEditRequestsForDay(employeeProfileId, workDate),
      getSessionsForDay(employeeProfileId, workDate),
    ])
    if (punchRes.success && punchRes.data) setPunches(punchRes.data)
    if (entryRes.success) setEntry(entryRes.data ?? null)
    if (reqRes.success && reqRes.data) setEditRequests(reqRes.data)
    if (sessionRes.success && sessionRes.data) setSessions(sessionRes.data)
    setRefreshing(false)
  }, [employeeProfileId, workDate])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    setVoidedExpanded(false)
  }, [employeeProfileId, workDate])

  // ── Inline edit ─────────────────────────────────────────────────────────────

  function startEdit(punch: TimePunchEvent) {
    const { date, time } = splitDateTime(punch.punched_at)
    setEditingId(punch.id)
    setEditDate(date)
    setEditTime(time)
    setEditNotes(punch.notes ?? '')
    setEditError('')
    setVoidConfirmId(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError('')
  }

  async function saveEdit() {
    if (!editNotes.trim()) {
      setEditError('Reason is required')
      return
    }
    const punch = punches.find(p => p.id === editingId)
    if (!punch) return
    setSaving(true)
    setEditError('')

    const newTime = combineDateTime(editDate, editTime)
    const res = punch.session_id
      // Session-linked punch: update the session row directly (migration 099).
      // The RPC voids the original punch, writes an admin_edit event with session_id,
      // and triggers sync_time_entry_from_sessions to rebuild the daily aggregate.
      ? await adminRecordSessionPunch(
          punch.session_id,
          punch.punch_type,
          newTime,
          editNotes.trim(),
          editingId!,
        )
      // Legacy punch (no session): use the migration 090 admin_record_punch path.
      : await adminRecordPunch(
          employeeProfileId,
          punch.punch_type,
          newTime,
          editDate,
          editNotes.trim(),
          editingId!,
        )

    if (res.success) {
      setEditingId(null)
      await refresh()
      onRefresh?.()
    } else {
      setEditError(res.error ?? 'Failed to save')
    }
    setSaving(false)
  }

  // ── Void ────────────────────────────────────────────────────────────────────

  async function voidPunch(id: string) {
    setVoiding(true)
    setGlobalError('')
    const res = await adminVoidPunch(id)
    if (res.success) {
      setVoidConfirmId(null)
      await refresh()
      onRefresh?.()
    } else {
      setGlobalError(res.error ?? 'Failed to void punch')
    }
    setVoiding(false)
  }

  // ── Add punch ────────────────────────────────────────────────────────────────

  async function addPunch() {
    if (!addNotes.trim()) {
      setAddError('Reason is required')
      return
    }
    setAdding(true)
    setAddError('')
    const res = await adminRecordPunch(
      employeeProfileId,
      addType,
      combineDateTime(addDate, addTime),
      addDate,
      addNotes.trim(),
    )
    if (res.success) {
      setShowAddForm(false)
      setAddNotes('')
      setAddDate(workDate)
      setAddTime('08:00')
      await refresh()
      onRefresh?.()
    } else {
      setAddError(res.error ?? 'Failed to add punch')
    }
    setAdding(false)
  }

  // ── Approval ─────────────────────────────────────────────────────────────────

  async function updateApproval(status: 'approved' | 'rejected') {
    if (!entry) return
    setApproving(true)
    setGlobalError('')
    const res = await adminUpdateApprovalStatus(entry.id, status)
    if (res.success && res.data) {
      setEntry(res.data)
    } else {
      setGlobalError(res.error ?? 'Failed to update approval')
    }
    setApproving(false)
  }

  // ── Review punch edit request ────────────────────────────────────────────────

  async function reviewRequest(requestId: string, status: 'approved' | 'rejected') {
    setReviewingRequestId(requestId)
    setReviewError('')
    const res = await adminReviewPunchEditRequest(requestId, status)
    if (res.success && res.data) {
      setEditRequests(prev => prev.map(r => r.id === requestId ? res.data! : r))
      if (status === 'approved') {
        // Re-fetch punches/entry so the admin sees the updated data
        await refresh()
        onRefresh?.()
      }
    } else {
      setReviewError(res.error ?? 'Failed to update request')
    }
    setReviewingRequestId(null)
  }

  // ── Attach Work Package ──────────────────────────────────────────────────────

  async function startAttach(session: AdminWorkSession) {
    setAttachingSessionId(session.id)
    setAttachSelectedId('')
    setAttachError('')
    setAttachAssignments([])

    if (session.project_id) {
      setAttachAssignmentsLoading(true)
      const res = await getProjectAssignmentsForAdmin(session.project_id)
      setAttachAssignments(res.success ? (res.data ?? []) : [])
      setAttachAssignmentsLoading(false)
    }
  }

  function cancelAttach() {
    setAttachingSessionId(null)
    setAttachSelectedId('')
    setAttachError('')
  }

  async function saveAttach() {
    if (!attachingSessionId || !attachSelectedId) {
      setAttachError('Please select a Work Package')
      return
    }
    setAttaching(true)
    setAttachError('')
    const res = await adminAttachSessionAssignment(attachingSessionId, attachSelectedId)
    if (res.success) {
      setAttachingSessionId(null)
      setAttachSelectedId('')
      await refresh()
      onRefresh?.()
    } else {
      setAttachError(res.error ?? 'Failed to attach Work Package')
    }
    setAttaching(false)
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const approvalDisplay =
    APPROVAL_DISPLAY[entry?.approval_status ?? 'none'] ?? APPROVAL_DISPLAY.none

  // Active punches (editable) vs voided audit history — chronological by punched_at
  const byPunchedAt = (a: TimePunchEvent, b: TimePunchEvent) =>
    new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime()
  const activePunches = punches.filter(p => !p.is_void).sort(byPunchedAt)
  const voidedPunches = punches.filter(p => p.is_void).sort(byPunchedAt)

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-lg bg-[var(--bg-card,#1e2433)] border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-700/60 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Clock className="w-5 h-5 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-gray-100 truncate">{employeeName}</h2>
              <p className="text-xs text-gray-500">{workDate}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {refreshing && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Global error */}
          {globalError && (
            <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/50 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-300">{globalError}</p>
            </div>
          )}

          {/* ── Daily summary ── */}
          {entry ? (
            <div className="bg-[var(--bg-secondary,#11141c)] border border-gray-700/60 rounded-xl px-4 py-4 space-y-3">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Daily Summary</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Clock In</p>
                  <p className="text-xs font-bold text-gray-200 tabular-nums">{formatTime(entry.clock_in_at)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Lunch</p>
                  <p className="text-xs font-bold text-gray-200 tabular-nums">
                    {entry.lunch_out_at && entry.lunch_in_at
                      ? `${formatTime(entry.lunch_out_at)}–${formatTime(entry.lunch_in_at)}`
                      : entry.lunch_out_at
                        ? 'On lunch'
                        : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Clock Out</p>
                  <p className="text-xs font-bold text-gray-200 tabular-nums">{formatTime(entry.clock_out_at)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Paid</p>
                  <p className="text-xs font-bold text-emerald-400 tabular-nums">{formatMinutes(entry.paid_minutes)}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-gray-700/40">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${approvalDisplay.cls}`}>
                  {approvalDisplay.label}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateApproval('approved')}
                    disabled={approving || entry.approval_status === 'approved'}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600/20 hover:bg-green-600/40 text-green-300 text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed border border-green-700/50"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={() => updateApproval('rejected')}
                    disabled={approving || entry.approval_status === 'rejected'}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-300 text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed border border-red-700/50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--bg-secondary,#11141c)] border border-gray-700/60 rounded-xl px-4 py-3 text-center">
              <p className="text-sm text-gray-500">No time entry for this day yet.</p>
            </div>
          )}

          {/* ── Time Sessions (migration 099/100) — always shown; empty state when none ── */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">Time Sessions</p>
            {sessions.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No time sessions for this day</p>
            ) : (
              <ul className="space-y-2">
                {sessions.map(sess => {
                  const isProjectOnly = !sess.assignment_id
                  const isAttaching = attachingSessionId === sess.id

                  return (
                    <li
                      key={sess.id}
                      className="border border-gray-700/60 rounded-xl overflow-hidden bg-[var(--bg-secondary,#11141c)]"
                    >
                      <div className="px-4 py-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-gray-200 truncate">
                                {sess.project_name ?? '—'}
                              </p>
                              {isProjectOnly && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-blue-900/20 text-blue-300 border-blue-700/50">
                                  Project Only
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">
                              Work Package
                            </p>
                            <p className="text-xs text-gray-300 mt-0.5">
                              {sess.work_package_name ?? 'Not assigned yet'}
                            </p>
                            <p className="text-[11px] text-gray-600 mt-1">
                              {formatTime(sess.clock_in_at)} – {formatTime(sess.clock_out_at)}
                              {sess.paid_minutes != null && (
                                <span className="ml-2 font-semibold text-emerald-400">
                                  {formatMinutes(sess.paid_minutes)}
                                </span>
                              )}
                            </p>
                          </div>
                          {isProjectOnly && !isAttaching && (
                            <button
                              onClick={() => startAttach(sess)}
                              className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-700/50 transition"
                            >
                              Attach Work Package
                            </button>
                          )}
                        </div>

                        {/* Attach Work Package inline form */}
                        {isAttaching && (
                          <div className="border-t border-gray-700/60 pt-3 space-y-2">
                            <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wide">
                              Attach Work Package
                            </p>
                            {attachAssignmentsLoading ? (
                              <div className="flex items-center gap-2 text-xs text-gray-400">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Loading Work Packages…
                              </div>
                            ) : attachAssignments.length === 0 ? (
                              <p className="text-xs text-gray-500">
                                No active Work Packages found for this project.
                              </p>
                            ) : (
                              <select
                                value={attachSelectedId}
                                onChange={e => setAttachSelectedId(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                              >
                                <option value="">— Select Work Package —</option>
                                {attachAssignments.map(a => (
                                  <option key={a.id} value={a.id}>
                                    {a.work_package_name}
                                  </option>
                                ))}
                              </select>
                            )}
                            {attachError && <p className="text-xs text-red-400">{attachError}</p>}
                            <div className="flex gap-2">
                              <button
                                onClick={saveAttach}
                                disabled={attaching || !attachSelectedId}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition disabled:opacity-50"
                              >
                                {attaching && <Loader2 className="w-3 h-3 animate-spin" />}
                                Save
                              </button>
                              <button
                                onClick={cancelAttach}
                                disabled={attaching}
                                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-semibold transition"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* ── Active punches only (voided moved to audit disclosure) ── */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">Punches</p>

            {activePunches.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">
                No active punches for this day
              </p>
            ) : (
              <ul className="space-y-2">
                {activePunches.map(punch => {
                  const isEditing = editingId === punch.id
                  const isVoidConfirm = voidConfirmId === punch.id
                  const sourceBadge   = SOURCE_BADGE[punch.source] ?? SOURCE_BADGE.employee_portal
                  const summary       = (punch.end_of_day_summary ?? '').trim()

                  return (
                    <li
                      key={punch.id}
                      className="border rounded-xl overflow-hidden bg-[var(--bg-secondary,#11141c)] border-gray-700/60"
                    >
                      <div className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-gray-200">
                                {PUNCH_LABEL[punch.punch_type] ?? punch.punch_type}
                              </p>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${sourceBadge.cls}`}>
                                {sourceBadge.label}
                              </span>
                            </div>
                            {punch.notes && (
                              <p className="text-[11px] text-gray-500 mt-0.5 italic">{punch.notes}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-sm text-gray-100 font-medium tabular-nums">
                              {formatTime(punch.punched_at)}
                            </span>
                            {!isEditing && (
                              <>
                                <button
                                  onClick={() => startEdit(punch)}
                                  className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition"
                                  aria-label="Edit punch"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    setVoidConfirmId(prev => prev === punch.id ? null : punch.id)
                                    setEditingId(null)
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-red-900/30 text-gray-500 hover:text-red-400 transition"
                                  aria-label="Void punch"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {summary ? (
                          <p className="mt-2 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap border-t border-gray-700/50 pt-2">
                            {summary}
                          </p>
                        ) : null}
                      </div>

                      {isEditing && (
                        <div className="border-t border-gray-700/60 px-4 py-3 bg-[var(--bg-card,#1e2433)] space-y-3">
                          <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wide">Edit Punch</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[10px] text-gray-500 uppercase block mb-1">Date</label>
                              <input
                                type="date"
                                value={editDate}
                                onChange={e => setEditDate(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-500 uppercase block mb-1">Time</label>
                              <input
                                type="time"
                                value={editTime}
                                onChange={e => setEditTime(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase block mb-1">Reason (required)</label>
                            <input
                              type="text"
                              value={editNotes}
                              onChange={e => setEditNotes(e.target.value)}
                              placeholder="Explain the correction…"
                              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 placeholder-gray-600"
                            />
                          </div>
                          {editError && <p className="text-xs text-red-400">{editError}</p>}
                          <div className="flex gap-2">
                            <button
                              onClick={saveEdit}
                              disabled={saving}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition disabled:opacity-50"
                            >
                              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={saving}
                              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-semibold transition"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {isVoidConfirm && (
                        <div className="border-t border-gray-700/60 px-4 py-3 bg-red-900/10 space-y-3">
                          <p className="text-sm text-red-300 font-semibold">Void this punch?</p>
                          <p className="text-xs text-gray-400">
                            It will be removed from the daily total. This cannot be undone.
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => voidPunch(punch.id)}
                              disabled={voiding}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition disabled:opacity-50"
                            >
                              {voiding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              Void Punch
                            </button>
                            <button
                              onClick={() => setVoidConfirmId(null)}
                              disabled={voiding}
                              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-semibold transition"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* ── Add Punch (immediately after active punches) ── */}
          {!showAddForm ? (
            <button
              onClick={() => { setShowAddForm(true); setAddError('') }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-gray-600 hover:border-blue-500/50 text-gray-400 hover:text-blue-300 text-sm font-semibold transition"
            >
              <Plus className="w-4 h-4" />
              Add Punch
            </button>
          ) : (
            <div className="border border-gray-700/60 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-[var(--bg-secondary,#11141c)] border-b border-gray-700/60">
                <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wide">Add Punch</p>
              </div>
              <div className="px-4 py-4 space-y-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase block mb-1">Punch Type</label>
                  <select
                    value={addType}
                    onChange={e => setAddType(e.target.value as PunchType)}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="clock_in">Clock In</option>
                    <option value="lunch_out">Lunch Out</option>
                    <option value="lunch_in">Lunch In</option>
                    <option value="clock_out">Clock Out</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase block mb-1">Date</label>
                    <input
                      type="date"
                      value={addDate}
                      onChange={e => setAddDate(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase block mb-1">Time</label>
                    <input
                      type="time"
                      value={addTime}
                      onChange={e => setAddTime(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase block mb-1">Reason (required)</label>
                  <input
                    type="text"
                    value={addNotes}
                    onChange={e => setAddNotes(e.target.value)}
                    placeholder="Why is this punch being added…"
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 placeholder-gray-600"
                  />
                </div>
                {addError && <p className="text-xs text-red-400">{addError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={addPunch}
                    disabled={adding}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition disabled:opacity-50"
                  >
                    {adding
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Plus className="w-3.5 h-3.5" />}
                    Add Punch
                  </button>
                  <button
                    onClick={() => { setShowAddForm(false); setAddError('') }}
                    disabled={adding}
                    className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Voided Punches audit disclosure (collapsed by default) ── */}
          {voidedPunches.length > 0 && (
            <div>
              <button
                type="button"
                aria-expanded={voidedExpanded}
                aria-controls="voided-punches-list"
                id="voided-punches-toggle"
                onClick={() => setVoidedExpanded(prev => !prev)}
                className="w-full flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl border border-gray-700/50 bg-gray-800/20 text-gray-400 hover:text-gray-300 hover:border-gray-600 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-card,#1e2433)]"
              >
                <span>Voided Punches ({voidedPunches.length})</span>
                <ChevronDown
                  className={`w-4 h-4 flex-shrink-0 transition-transform ${voidedExpanded ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
              {voidedExpanded && (
                <ul
                  id="voided-punches-list"
                  role="region"
                  aria-labelledby="voided-punches-toggle"
                  className="space-y-2 mt-2"
                >
                  {voidedPunches.map(punch => {
                    const sourceBadge = SOURCE_BADGE[punch.source] ?? SOURCE_BADGE.employee_portal
                    return (
                      <li
                        key={punch.id}
                        className="border rounded-xl overflow-hidden opacity-50 bg-gray-800/30 border-gray-700/30"
                      >
                        <div className="px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-gray-300">
                                  {PUNCH_LABEL[punch.punch_type] ?? punch.punch_type}
                                </p>
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${sourceBadge.cls}`}>
                                  {sourceBadge.label}
                                </span>
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-red-900/30 text-red-400 border-red-800/60">
                                  Voided
                                </span>
                              </div>
                              {punch.notes && (
                                <p className="text-[11px] text-gray-500 mt-0.5 italic">{punch.notes}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-sm text-gray-400 font-medium tabular-nums line-through decoration-red-600/60">
                                {formatTime(punch.punched_at)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {/* ── Pending Punch Edit Requests (migration 097) ── */}
          {editRequests.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wide mb-2">
                Employee Punch Edit Requests
              </p>
              {reviewError && (
                <p className="text-xs text-red-400 mb-2">{reviewError}</p>
              )}
              <ul className="space-y-2">
                {editRequests.map(req => {
                  const isPending   = req.status === 'pending'
                  const isApproved  = req.status === 'approved'
                  const isRejected  = req.status === 'rejected'
                  const isBusy      = reviewingRequestId === req.id
                  const statusCls = isPending  ? 'bg-purple-600/20 text-purple-300 border-purple-700/50'
                                  : isApproved ? 'bg-green-600/20 text-green-300 border-green-700/50'
                                  : isRejected ? 'bg-red-600/20 text-red-300 border-red-700/50'
                                  : 'bg-gray-600/20 text-gray-400 border-gray-600'
                  const statusLabel = isPending ? 'Pending' : isApproved ? 'Approved' : isRejected ? 'Rejected' : req.status

                  const PUNCH_TYPE_LABEL: Record<string, string> = {
                    clock_in: 'Clock In', lunch_out: 'Lunch Out', lunch_in: 'Lunch In', clock_out: 'Clock Out',
                  }

                  const reqSession = req.session_id
                    ? sessions.find(s => s.id === req.session_id)
                    : undefined

                  return (
                    <li
                      key={req.id}
                      className="border border-purple-700/30 rounded-xl overflow-hidden bg-[var(--bg-secondary,#11141c)]"
                    >
                      <div className="px-4 py-3 space-y-2">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-200">
                              {PUNCH_TYPE_LABEL[req.punch_type] ?? req.punch_type}
                            </p>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${statusCls}`}>
                              {statusLabel}
                            </span>
                          </div>
                        </div>

                        {/* Job identity — shown when the request targets a session (mig 099) */}
                        {reqSession && (
                          <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg px-3 py-2">
                            <p className="text-[10px] text-blue-400 uppercase tracking-wide mb-0.5">Job</p>
                            <p className="text-xs font-semibold text-blue-200">
                              {reqSession.project_name ?? '—'} · {reqSession.work_package_name ?? '—'}
                            </p>
                          </div>
                        )}

                        {/* Current vs Requested */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-gray-800/60 rounded-lg px-3 py-2">
                            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Current</p>
                            <p className="text-sm font-bold text-gray-300 tabular-nums">
                              {req.original_time
                                ? new Date(req.original_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                                : 'Missing'}
                            </p>
                          </div>
                          <div className="bg-purple-900/20 rounded-lg px-3 py-2">
                            <p className="text-[10px] text-purple-400 uppercase tracking-wide mb-0.5">Requested</p>
                            <p className="text-sm font-bold text-purple-200 tabular-nums">
                              {new Date(req.requested_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>

                        {/* Employee reason */}
                        <div className="bg-gray-800/40 rounded-lg px-3 py-2">
                          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Reason</p>
                          <p className="text-xs text-gray-300 leading-relaxed">{req.employee_reason}</p>
                        </div>

                        <p className="text-[10px] text-gray-600">
                          Submitted {new Date(req.requested_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>

                        {/* Approve / Reject controls (pending only) */}
                        {isPending && (
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={() => reviewRequest(req.id, 'approved')}
                              disabled={isBusy}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600/20 hover:bg-green-600/40 text-green-300 text-xs font-bold border border-green-700/50 transition disabled:opacity-50"
                            >
                              {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                              Approve
                            </button>
                            <button
                              onClick={() => reviewRequest(req.id, 'rejected')}
                              disabled={isBusy}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-300 text-xs font-bold border border-red-700/50 transition disabled:opacity-50"
                            >
                              {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-gray-700/60 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
