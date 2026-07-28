// @ts-nocheck
/**
 * AdminPunchHistoryModal — read-only punch history for one employee/day (TIME-4).
 *
 * Visibility only. No edit / void / delete / add-punch / correction controls.
 */

import React from 'react'
import { X, Clock } from 'lucide-react'
import type { TimePunchEvent, PunchType } from '@/services/employeeTimeService'

interface AdminPunchHistoryModalProps {
  employeeName: string
  workDate: string
  punches: TimePunchEvent[]
  onClose: () => void
}

const PUNCH_LABEL: Record<PunchType, string> = {
  clock_in:  'Clock In',
  lunch_out: 'Lunch Out',
  lunch_in:  'Lunch In',
  clock_out: 'Clock Out',
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

export default function AdminPunchHistoryModal({
  employeeName,
  workDate,
  punches,
  onClose,
}: AdminPunchHistoryModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-md bg-[var(--bg-card,#1e2433)] border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-700/60">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Clock className="w-5 h-5 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-gray-100 truncate">{employeeName}</h2>
              <p className="text-xs text-gray-500">{workDate}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — read-only punch list */}
        <div className="px-6 py-5">
          {punches.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">No punches recorded for this day.</p>
          ) : (
            <ul className="space-y-2">
              {punches.map(p => {
                const summary = (p.end_of_day_summary || '').trim()
                return (
                  <li
                    key={p.id}
                    className="bg-[var(--bg-secondary,#11141c)] border border-gray-700/60 rounded-xl px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-200">
                          {PUNCH_LABEL[p.punch_type] ?? p.punch_type}
                        </p>
                        {p.source && (
                          <p className="text-[11px] text-gray-500 mt-0.5">{p.source}</p>
                        )}
                      </div>
                      <span className="text-sm text-gray-100 font-medium tabular-nums flex-shrink-0">
                        {formatTime(p.punched_at)}
                      </span>
                    </div>
                    {summary ? (
                      <p className="mt-2 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap border-t border-gray-700/50 pt-2">
                        {summary}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer — close only */}
        <div className="px-6 py-4 border-t border-gray-700/60">
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
