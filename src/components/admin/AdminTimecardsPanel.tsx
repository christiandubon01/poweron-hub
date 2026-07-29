// @ts-nocheck
/**
 * AdminTimecardsPanel — read-only owner/admin timecards overview (TIME-4).
 *
 * Visibility only: employee list, per-day status, entries, and punch history.
 * All data comes from adminTimecardService (SELECT-only). No editing, no
 * corrections, no approval, no export, no punch creation.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Clock, Loader2, AlertCircle, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import {
  getAdminTimecardsForDate,
  getTenantWorkDate,
  type AdminTimecardsForDate,
  type AdminTimecardRow,
  type ClockPhase,
} from '@/services/adminTimecardService'
import AdminPunchHistoryModal from '@/components/admin/AdminPunchHistoryModal'
import {
  TRADE_ROLE_LABELS,
  TRADE_ROLE_BADGE_CLASS,
  toTradeRole,
} from '@/services/roleService'

// ── Presentation ───────────────────────────────────────────────────────────────

const PHASE_PILL: Record<ClockPhase, { label: string; cls: string }> = {
  off_clock:       { label: 'Not clocked in',  cls: 'bg-gray-700/60 text-gray-300 border-gray-600' },
  working:         { label: 'Clocked in',      cls: 'bg-green-600/20 text-green-300 border-green-700/50' },
  on_lunch:        { label: 'On lunch',        cls: 'bg-amber-600/20 text-amber-300 border-amber-700/50' },
  back_from_lunch: { label: 'Back from lunch', cls: 'bg-green-600/20 text-green-300 border-green-700/50' },
  done:            { label: 'Day complete',    cls: 'bg-blue-600/20 text-blue-300 border-blue-700/50' },
}

const PENDING_PILL = { label: 'Pending invite', cls: 'bg-purple-600/20 text-purple-300 border-purple-700/50' }

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
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatDateLabel(workDate: string): string {
  const [y, m, d] = workDate.split('-').map(Number)
  if (!y || !m || !d) return workDate
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

// Shift a YYYY-MM-DD string by n days without timezone drift.
function shiftDate(workDate: string, days: number): string {
  const [y, m, d] = workDate.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  base.setDate(base.getDate() + days)
  const yy = base.getFullYear()
  const mm = String(base.getMonth() + 1).padStart(2, '0')
  const dd = String(base.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

// Lunch column text per the spec's display rules.
function lunchText(row: AdminTimecardRow): string {
  const e = row.entry
  if (e?.lunch_out_at && e?.lunch_in_at) {
    return `${formatTime(e.lunch_out_at)}–${formatTime(e.lunch_in_at)}`
  }
  if (e?.lunch_out_at && !e?.lunch_in_at) return 'On lunch'
  if (!e?.lunch_out_at && e?.clock_out_at) return 'Skipped'
  return '—'
}

function endOfDaySummaryFromRow(row: AdminTimecardRow): string | null {
  const punch = [...row.punches]
    .reverse()
    .find(p => p.punch_type === 'clock_out' && !p.is_void && (p.end_of_day_summary || '').trim())
  const text = (punch?.end_of_day_summary || '').trim()
  return text || null
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function AdminTimecardsPanel() {
  const [selectedDate, setSelectedDate] = useState<string>(() => getTenantWorkDate())
  const [data, setData]       = useState<AdminTimecardsForDate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [modalRow, setModalRow] = useState<AdminTimecardRow | null>(null)

  const today = getTenantWorkDate()

  const load = useCallback(async (workDate: string) => {
    setLoading(true)
    setError('')
    const res = await getAdminTimecardsForDate(workDate)
    if (res.success && res.data) {
      setData(res.data)
    } else {
      setData(null)
      setError(res.error || 'Could not load timecards.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load(selectedDate)
  }, [selectedDate, load])

  const summary = data?.summary
  const rows = data?.rows ?? []

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 space-y-5">
      {/* Header + date controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-bold text-gray-100">Timecards Overview</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedDate(d => shiftDate(d, -1))}
            className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition"
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-gray-200 min-w-[9rem] text-center">
            {formatDateLabel(selectedDate)}
          </span>
          <button
            onClick={() => setSelectedDate(d => shiftDate(d, 1))}
            className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition"
            aria-label="Next day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {selectedDate !== today && (
            <button
              onClick={() => setSelectedDate(today)}
              className="px-3 py-2 rounded-lg bg-blue-600/30 text-blue-300 text-sm font-semibold hover:bg-blue-600/50 transition"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* Summary strip */}
      {summary && (
        <div className="flex gap-2 flex-wrap text-xs">
          <span className="px-3 py-1.5 rounded-lg bg-green-600/20 text-green-300 border border-green-700/40">
            Clocked in: <b>{summary.clockedInCount}</b>
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-amber-600/20 text-amber-300 border border-amber-700/40">
            On lunch: <b>{summary.onLunchCount}</b>
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-700/40">
            Completed: <b>{summary.completedCount}</b>
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-gray-700/60 text-gray-300 border border-gray-600">
            Not clocked in: <b>{summary.notClockedInCount}</b>
          </span>
          {summary.pendingInviteCount > 0 && (
            <span className="px-3 py-1.5 rounded-lg bg-purple-600/20 text-purple-300 border border-purple-700/40">
              Pending invite: <b>{summary.pendingInviteCount}</b>
            </span>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/50 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
          <Loader2 size={16} className="animate-spin text-blue-400" />
          Loading timecards…
        </div>
      )}

      {/* Empty: no employees at all */}
      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-gray-500 py-6 text-center">
          No portal employees yet. Use Invite Employee to send an invite.
        </p>
      )}

      {/* Rows */}
      {!loading && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map(row => {
            const pill = row.isPendingInvite ? PENDING_PILL : PHASE_PILL[row.phase]
            const e = row.entry
            const eodSummary = endOfDaySummaryFromRow(row)
            return (
              <div
                key={row.profile.id}
                className="bg-[var(--bg-secondary)] border border-gray-700/60 rounded-xl p-4"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  {/* Identity */}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-100 truncate">{row.profile.display_name}</p>
                    {row.profile.email && (
                      <p className="text-xs text-gray-500 truncate">{row.profile.email}</p>
                    )}
                    <p className="text-[11px] text-gray-600 mt-0.5 capitalize">
                      {(() => {
                        const trade = toTradeRole(row.profile.employee_role)
                        if (trade) {
                          return (
                            <span className={`inline-flex items-center gap-1.5`}>
                              <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium normal-case ${TRADE_ROLE_BADGE_CLASS[trade]}`}>
                                {TRADE_ROLE_LABELS[trade]}
                              </span>
                              <span>· {String(row.profile.employment_type || '').replace('_', ' ')}</span>
                            </span>
                          )
                        }
                        return (
                          <>
                            {row.profile.role} · {String(row.profile.employment_type || '').replace('_', ' ')}
                          </>
                        )
                      })()}
                    </p>
                  </div>
                  {/* Status */}
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${pill.cls}`}>
                      {pill.label}
                    </span>
                    {!row.isPendingInvite && e?.status && (
                      <span className="text-[10px] text-gray-500 capitalize">{e.status}</span>
                    )}
                  </div>
                </div>

                {/* Detail grid — only for accepted employees */}
                {!row.isPendingInvite && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-center">
                      <div className="bg-[var(--bg-card)] rounded-lg px-2 py-1.5">
                        <p className="text-[10px] text-gray-500 uppercase">Clock in</p>
                        <p className="text-xs font-bold text-gray-200 tabular-nums">{formatTime(e?.clock_in_at)}</p>
                      </div>
                      <div className="bg-[var(--bg-card)] rounded-lg px-2 py-1.5">
                        <p className="text-[10px] text-gray-500 uppercase">Lunch</p>
                        <p className="text-xs font-bold text-gray-200 tabular-nums">{lunchText(row)}</p>
                      </div>
                      <div className="bg-[var(--bg-card)] rounded-lg px-2 py-1.5">
                        <p className="text-[10px] text-gray-500 uppercase">Clock out</p>
                        <p className="text-xs font-bold text-gray-200 tabular-nums">{formatTime(e?.clock_out_at)}</p>
                      </div>
                      <div className="bg-[var(--bg-card)] rounded-lg px-2 py-1.5">
                        <p className="text-[10px] text-gray-500 uppercase">Paid</p>
                        <p className="text-xs font-bold text-emerald-400 tabular-nums">{formatMinutes(e?.paid_minutes)}</p>
                      </div>
                    </div>

                    {eodSummary ? (
                      <p className="mt-3 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap bg-[var(--bg-card)] border border-gray-700/40 rounded-lg px-3 py-2">
                        {eodSummary}
                      </p>
                    ) : null}

                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => setModalRow(row)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-semibold transition"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Manage Punches
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Punch history modal */}
      {modalRow && (
        <AdminPunchHistoryModal
          employeeName={modalRow.profile.display_name}
          employeeProfileId={modalRow.profile.id}
          workDate={selectedDate}
          initialPunches={modalRow.punches}
          initialEntry={modalRow.entry}
          onClose={() => setModalRow(null)}
          onRefresh={() => load(selectedDate)}
        />
      )}
    </div>
  )
}
