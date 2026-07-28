// @ts-nocheck
/**
 * EmployeeSchedulePanel — Employee day view for the Schedule tab.
 * EMS Phase 4 (Workstream 4).
 *
 * Shows today's schedule items by default. Employee can:
 *  - Navigate ← Yesterday / Tomorrow →
 *  - Start (scheduled→in_progress) / Done (in_progress→done) each item
 * Uses get_my_schedule and update_my_schedule_status RPCs.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  CalendarRange,
  CheckCircle2,
  Play,
} from 'lucide-react'
import {
  getMySchedule,
  updateMyScheduleStatus,
  type ScheduleItem,
  type ScheduleStatus,
} from '@/services/employeeScheduleService'

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function formatDate(isoDate: string): string {
  const today = todayIso()
  const yesterday = addDays(today, -1)
  const tomorrow = addDays(today, 1)
  if (isoDate === today) return 'Today'
  if (isoDate === yesterday) return 'Yesterday'
  if (isoDate === tomorrow) return 'Tomorrow'
  const [y, m, day] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const hr = h % 12 || 12
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`
}

function minutesToHours(min: number | null): string {
  if (!min || min <= 0) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ts
  }
}

// ── Status chip ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<ScheduleStatus, string> = {
  scheduled:   'text-blue-700 bg-blue-50 border-blue-200',
  in_progress: 'text-amber-700 bg-amber-50 border-amber-200',
  done:        'text-green-700 bg-green-50 border-green-200',
  cancelled:   'text-gray-400 bg-gray-100 border-gray-200',
}

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  scheduled:   'Scheduled',
  in_progress: 'In Progress',
  done:        'Done',
  cancelled:   'Cancelled',
}

// ── Schedule item card ────────────────────────────────────────────────────────

function ScheduleCard({ item, onStatusChange }: { item: ScheduleItem; onStatusChange: (id: string, status: ScheduleStatus) => void }) {
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const isCancelled = item.status === 'cancelled'
  const isDone = item.status === 'done'

  async function transition(to: ScheduleStatus) {
    setBusy(true)
    setLocalError(null)
    const result = await updateMyScheduleStatus(item.id, to)
    if (result.success) {
      onStatusChange(item.id, to)
    } else {
      setLocalError(result.error)
    }
    setBusy(false)
  }

  return (
    <div className={`bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-2 ${isCancelled ? 'opacity-50' : ''}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold leading-snug ${isCancelled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
            {item.work_package_name || 'Scheduled Work'}
          </p>
          {item.project_name && (
            <p className="text-xs text-gray-500 mt-0.5">{item.project_name}</p>
          )}
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${STATUS_STYLES[item.status]}`}>
          {STATUS_LABELS[item.status]}
        </span>
      </div>

      {/* Time / estimate row */}
      {(item.start_time || item.estimated_minutes) && (
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          {item.start_time && (
            <span>
              {formatTime(item.start_time)}
              {item.end_time ? ` – ${formatTime(item.end_time)}` : ''}
            </span>
          )}
          {item.estimated_minutes && (
            <span>{minutesToHours(item.estimated_minutes)} est.</span>
          )}
        </div>
      )}

      {/* Notes */}
      {item.notes && (
        <p className="text-xs text-gray-500 leading-relaxed bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          {item.notes}
        </p>
      )}

      {/* Done stamp */}
      {isDone && (
        <div className="flex items-center gap-1.5 text-xs text-green-600">
          <CheckCircle2 size={13} />
          Completed {formatTimestamp(item.updated_at)}
        </div>
      )}

      {/* Action controls */}
      {!isCancelled && !isDone && (
        <div className="flex gap-2 pt-1">
          {item.status === 'scheduled' && (
            <button
              type="button"
              onClick={() => transition('in_progress')}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              Start
            </button>
          )}
          {item.status === 'in_progress' && (
            <button
              type="button"
              onClick={() => transition('done')}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
              Done
            </button>
          )}
        </div>
      )}

      {localError && (
        <p className="text-[11px] text-red-500">{localError}</p>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EmployeeSchedulePanel() {
  const [date, setDate] = useState<string>(todayIso)
  const [items, setItems] = useState<ScheduleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setError(null)
    const result = await getMySchedule(d)
    if (result.success) {
      setItems(result.data)
    } else {
      setError(result.error)
      setItems([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load(date) }, [date, load])

  function handleStatusChange(id: string, status: ScheduleStatus) {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, status, updated_at: new Date().toISOString() } : it))
  }

  const nonCancelled = items.filter((it) => it.status !== 'cancelled')
  const cancelled = items.filter((it) => it.status === 'cancelled')

  return (
    <div className="space-y-4">
      {/* Date navigation */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDate((d) => addDays(d, -1))}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Previous day"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1 text-center">
          <p className="text-sm font-bold text-gray-900">{formatDate(date)}</p>
          <p className="text-[10px] text-gray-400">{date}</p>
        </div>
        <button
          type="button"
          onClick={() => setDate((d) => addDays(d, 1))}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Next day"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
          <Loader2 size={15} className="animate-spin text-green-600" />
          Loading schedule…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm text-center">
          <CalendarRange size={28} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-700">No work scheduled</p>
          <p className="text-xs text-gray-400 mt-1">Nothing scheduled for {formatDate(date)}.</p>
        </div>
      )}

      {/* Items */}
      {!loading && !error && nonCancelled.map((item) => (
        <ScheduleCard key={item.id} item={item} onStatusChange={handleStatusChange} />
      ))}

      {/* Cancelled (dimmed, at bottom) */}
      {!loading && !error && cancelled.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-1">Cancelled</p>
          {cancelled.map((item) => (
            <ScheduleCard key={item.id} item={item} onStatusChange={handleStatusChange} />
          ))}
        </div>
      )}
    </div>
  )
}
