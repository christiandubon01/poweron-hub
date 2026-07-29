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
} from 'lucide-react'
import type { TimePunchEvent, PunchType, TimeEntry } from '@/services/employeeTimeService'
import {
  getPunchesForDay,
  getTimeEntryForDay,
  adminRecordPunch,
  adminVoidPunch,
  adminUpdateApprovalStatus,
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

  // ── Refresh: fetches all punches (including voided) + entry ─────────────────

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setGlobalError('')
    const [punchRes, entryRes] = await Promise.all([
      getPunchesForDay(employeeProfileId, workDate),
      getTimeEntryForDay(employeeProfileId, workDate),
    ])
    if (punchRes.success && punchRes.data) setPunches(punchRes.data)
    if (entryRes.success) setEntry(entryRes.data ?? null)
    setRefreshing(false)
  }, [employeeProfileId, workDate])

  useEffect(() => { refresh() }, [refresh])

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
    const res = await adminRecordPunch(
      employeeProfileId,
      punch.punch_type,
      combineDateTime(editDate, editTime),
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

  // ── Derived ──────────────────────────────────────────────────────────────────

  const approvalDisplay =
    APPROVAL_DISPLAY[entry?.approval_status ?? 'none'] ?? APPROVAL_DISPLAY.none

  // Build correction pairs: admin_edit punch → its voided original
  type PairItem =
    | { kind: 'single'; punch: TimePunchEvent; sortTime: number }
    | { kind: 'pair'; correction: TimePunchEvent; voided: TimePunchEvent; sortTime: number }

  const renderItems = (() => {
    // Map voidedId → correction punch
    const correctionMap = new Map<string, TimePunchEvent>()
    for (const p of punches) {
      if (p.source === 'admin_edit' && p.supersedes_id && !p.is_void) {
        correctionMap.set(p.supersedes_id, p)
      }
    }
    const pairedVoidedIds   = new Set(correctionMap.keys())
    const pairedCorrectionIds = new Set(Array.from(correctionMap.values()).map(p => p.id))

    const items: PairItem[] = []

    // Single punches (not part of any pair)
    for (const p of punches) {
      if (pairedVoidedIds.has(p.id) || pairedCorrectionIds.has(p.id)) continue
      items.push({ kind: 'single', punch: p, sortTime: new Date(p.punched_at).getTime() })
    }

    // Paired items: correction + voided
    for (const [voidedId, correction] of correctionMap) {
      const voided = punches.find(p => p.id === voidedId)
      if (voided) {
        items.push({ kind: 'pair', correction, voided, sortTime: new Date(correction.punched_at).getTime() })
      } else {
        items.push({ kind: 'single', punch: correction, sortTime: new Date(correction.punched_at).getTime() })
      }
    }

    return items.sort((a, b) => a.sortTime - b.sortTime)
  })()

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

          {/* ── Punch list ── */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">Punches</p>

            {renderItems.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">
                No punches recorded for this day.
              </p>
            ) : (
              <ul className="space-y-2">
                {renderItems.map(item => {
                  if (item.kind === 'pair') {
                    const { correction, voided } = item
                    const correctionBadge = SOURCE_BADGE.admin_edit
                    const isEditing     = editingId === correction.id
                    const isVoidConfirm = voidConfirmId === correction.id
                    const corrSummary   = (correction.end_of_day_summary ?? '').trim()

                    return (
                      <li key={correction.id} className="space-y-0">
                        {/* Correction punch */}
                        <div className="border rounded-t-xl overflow-hidden bg-[var(--bg-secondary,#11141c)] border-gray-700/60 border-b-0">
                          <div className="px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold text-gray-200">
                                    {PUNCH_LABEL[correction.punch_type] ?? correction.punch_type}
                                  </p>
                                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${correctionBadge.cls}`}>
                                    {correctionBadge.label}
                                  </span>
                                </div>
                                {correction.notes && (
                                  <p className="text-[11px] text-gray-500 mt-0.5 italic">{correction.notes}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-sm text-gray-100 font-medium tabular-nums">
                                  {formatTime(correction.punched_at)}
                                </span>
                                {!isEditing && (
                                  <>
                                    <button
                                      onClick={() => startEdit(correction)}
                                      className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition"
                                      aria-label="Edit punch"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => {
                                        setVoidConfirmId(prev => prev === correction.id ? null : correction.id)
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
                            {corrSummary ? (
                              <p className="mt-2 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap border-t border-gray-700/50 pt-2">
                                {corrSummary}
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
                                  onClick={() => voidPunch(correction.id)}
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
                        </div>

                        {/* Pair connector */}
                        <div className="px-4 py-1 bg-gray-800/20 border-x border-gray-700/40 flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-600 select-none">↳</span>
                          <span className="text-[10px] text-gray-600 italic">replaces original</span>
                        </div>

                        {/* Voided original */}
                        <div className="border rounded-b-xl overflow-hidden opacity-40 bg-gray-800/30 border-gray-700/30">
                          <div className="px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold text-gray-200">
                                    {PUNCH_LABEL[voided.punch_type] ?? voided.punch_type}
                                  </p>
                                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${(SOURCE_BADGE[voided.source] ?? SOURCE_BADGE.employee_portal).cls}`}>
                                    {(SOURCE_BADGE[voided.source] ?? SOURCE_BADGE.employee_portal).label}
                                  </span>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-red-900/30 text-red-400 border-red-800/60">
                                    Voided
                                  </span>
                                  <span className="text-[10px] text-gray-500 px-1.5 py-0.5 rounded border border-gray-700/40">
                                    Original
                                  </span>
                                </div>
                                {voided.notes && (
                                  <p className="text-[11px] text-gray-500 mt-0.5 italic">{voided.notes}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-sm text-gray-400 font-medium tabular-nums line-through decoration-red-600/60">
                                  {formatTime(voided.punched_at)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </li>
                    )
                  }

                  // Single punch (unpaired)
                  const punch = item.punch
                  const isVoid    = punch.is_void
                  const isEditing = editingId === punch.id
                  const isVoidConfirm = voidConfirmId === punch.id
                  const sourceBadge   = SOURCE_BADGE[punch.source] ?? SOURCE_BADGE.employee_portal
                  const summary       = (punch.end_of_day_summary ?? '').trim()

                  return (
                    <li
                      key={punch.id}
                      className={`border rounded-xl overflow-hidden transition-opacity ${
                        isVoid
                          ? 'opacity-40 bg-gray-800/30 border-gray-700/30'
                          : 'bg-[var(--bg-secondary,#11141c)] border-gray-700/60'
                      }`}
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
                              {isVoid && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-red-900/30 text-red-400 border-red-800/60">
                                  Voided
                                </span>
                              )}
                            </div>
                            {punch.notes && (
                              <p className="text-[11px] text-gray-500 mt-0.5 italic">{punch.notes}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-sm text-gray-100 font-medium tabular-nums">
                              {formatTime(punch.punched_at)}
                            </span>
                            {!isVoid && !isEditing && (
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

          {/* ── Add Punch ── */}
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
