// @ts-nocheck
/**
 * OwnerPerformancePanel — EMS Phase 6
 *
 * 4 sections per employee:
 *   1. Generate Snapshot  — period picker + RPC trigger
 *   2. Snapshot Display   — stat cards from latest/generated snapshot
 *   3. Quality Ratings    — list + add-rating form (star selector)
 *   4. Compensation History — timeline + add-event form
 *
 * Owner/admin only. Employees have no access to this panel.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  BarChart2,
  Star,
  DollarSign,
  Loader2,
  ChevronDown,
  Calendar,
  CheckCircle,
  Clock,
  TrendingUp,
  Award,
  AlertCircle,
} from 'lucide-react'
import {
  generateSnapshot,
  getSnapshots,
  getQualityRatings,
  getCompensationHistory,
  addQualityRating,
  addCompensationEvent,
  type PerformanceSnapshot,
  type QualityRating,
  type CompensationEvent,
  type CompensationEventType,
} from '@/services/employeePerformanceService'
import {
  getActiveEmployeeProfiles,
  type AdminEmployeeProfile,
} from '@/services/adminTimecardService'
import { listOrgTaskAssignments } from '@/services/employeeTaskAssignmentService'

// ── Date helpers ──────────────────────────────────────────────────────────────

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function thisWeekRange(): [string, string] {
  const now = new Date()
  const day = now.getDay()
  const mon = new Date(now)
  mon.setDate(now.getDate() - ((day + 6) % 7))
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return [toISODate(mon), toISODate(sun)]
}

function thisMonthRange(): [string, string] {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return [toISODate(start), toISODate(end)]
}

function lastMonthRange(): [string, string] {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 0)
  return [toISODate(start), toISODate(end)]
}

function fmtDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ── Rate color ────────────────────────────────────────────────────────────────

function rateColor(rate: number | null): string {
  if (rate === null) return 'text-gray-500'
  if (rate >= 80) return 'text-green-400'
  if (rate >= 60) return 'text-amber-400'
  return 'text-red-400'
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color = 'text-gray-200',
}: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div
      className="rounded-lg px-4 py-3 border flex flex-col gap-1"
      style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
    >
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600">{sub}</p>}
    </div>
  )
}

// ── StarSelector ──────────────────────────────────────────────────────────────

function StarSelector({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="transition-colors"
        >
          <Star
            size={20}
            className={n <= value ? 'text-amber-400 fill-amber-400' : 'text-gray-600'}
          />
        </button>
      ))}
    </div>
  )
}

// ── Section 1+2: Snapshot Generator + Display ─────────────────────────────────

function SnapshotSection({ profileId }: { profileId: string }) {
  type Preset = 'week' | 'month' | 'last_month' | 'custom'
  const [preset, setPreset] = useState<Preset>('month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [generating, setGenerating] = useState(false)
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null)
  const [snapshots, setSnapshots] = useState<PerformanceSnapshot[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const res = await getSnapshots(profileId)
    if (res.success) setSnapshots(res.data)
    setLoadingHistory(false)
  }, [profileId])

  useEffect(() => { void loadHistory() }, [loadHistory])

  function getRange(): [string, string] | null {
    if (preset === 'week') return thisWeekRange()
    if (preset === 'month') return thisMonthRange()
    if (preset === 'last_month') return lastMonthRange()
    if (customStart && customEnd) return [customStart, customEnd]
    return null
  }

  async function handleGenerate() {
    const range = getRange()
    if (!range) { setErr('Select a date range'); return }
    setErr(null)
    setGenerating(true)
    const res = await generateSnapshot(profileId, range[0], range[1])
    setGenerating(false)
    if (!res.success) { setErr(res.error); return }
    setSnapshot(res.data)
    void loadHistory()
  }

  const displaySnap = snapshot ?? snapshots[0] ?? null

  return (
    <div className="space-y-4">
      {/* Period picker */}
      <div
        className="rounded-lg p-4 border space-y-3"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Calendar size={13} className="text-blue-400" />
          <p className="text-sm font-semibold text-gray-300">Generate Performance Report</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['week', 'month', 'last_month', 'custom'] as Preset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                preset === p
                  ? 'border-blue-600 text-blue-400 bg-blue-900/20'
                  : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'
              }`}
            >
              {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : p === 'last_month' ? 'Last Month' : 'Custom'}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex gap-3 items-center">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">From</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2 py-1.5 rounded border text-xs text-gray-300 bg-transparent"
                style={{ borderColor: '#2a2d36' }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">To</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2 py-1.5 rounded border text-xs text-gray-300 bg-transparent"
                style={{ borderColor: '#2a2d36' }}
              />
            </div>
          </div>
        )}

        {err && (
          <p className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle size={12} /> {err}
          </p>
        )}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border text-xs font-medium transition-all disabled:opacity-50"
          style={{ borderColor: '#1e40af88', color: '#60a5fa', backgroundColor: '#1e2a4a' }}
        >
          {generating ? <Loader2 size={12} className="animate-spin" /> : <BarChart2 size={12} />}
          {generating ? 'Generating…' : 'Generate Report'}
        </button>
      </div>

      {/* Snapshot display */}
      {displaySnap && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle size={13} className="text-green-400" />
            <p className="text-xs font-semibold text-gray-400">
              Report: {fmtDate(displaySnap.period_start)} – {fmtDate(displaySnap.period_end)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              label="Hours Worked"
              value={`${(displaySnap.paid_minutes / 60).toFixed(1)}h`}
              sub={`${displaySnap.days_worked} days worked`}
              color="text-blue-400"
            />
            <StatCard
              label="Days Worked / Scheduled"
              value={`${displaySnap.days_worked} / ${displaySnap.scheduled_days}`}
              color="text-teal-400"
            />
            <StatCard
              label="Avg Daily Hours"
              value={displaySnap.avg_daily_hours != null ? `${displaySnap.avg_daily_hours}h` : '—'}
              color="text-cyan-400"
            />
            <StatCard
              label="Tasks Assigned / Done"
              value={`${displaySnap.tasks_assigned} / ${displaySnap.tasks_completed}`}
              sub={`${displaySnap.tasks_late} late`}
              color="text-purple-400"
            />
            <StatCard
              label="On-Time Rate"
              value={displaySnap.on_time_rate != null ? `${displaySnap.on_time_rate}%` : '—'}
              color={rateColor(displaySnap.on_time_rate)}
            />
            <StatCard
              label="Completion Rate"
              value={displaySnap.completion_rate != null ? `${displaySnap.completion_rate}%` : '—'}
              color={rateColor(displaySnap.completion_rate)}
            />
          </div>
        </div>
      )}

      {/* Prior snapshots */}
      {snapshots.length > 1 && (
        <details className="group">
          <summary className="text-xs text-gray-500 cursor-pointer flex items-center gap-1 hover:text-gray-300">
            <ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
            {snapshots.length - 1} prior report{snapshots.length > 2 ? 's' : ''}
          </summary>
          <div className="mt-2 space-y-1">
            {snapshots.slice(1).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSnapshot(s)}
                className="w-full text-left px-3 py-2 rounded border text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800/30 transition-colors"
                style={{ borderColor: '#1e2128' }}
              >
                {fmtDate(s.period_start)} – {fmtDate(s.period_end)} ·{' '}
                {fmtMinutes(s.paid_minutes)} · CR {s.completion_rate ?? '—'}%
              </button>
            ))}
          </div>
        </details>
      )}

      {!displaySnap && !loadingHistory && (
        <p className="text-xs text-gray-600">No reports yet. Generate one above.</p>
      )}
      {loadingHistory && (
        <p className="text-xs text-gray-600 flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" /> Loading history…
        </p>
      )}
    </div>
  )
}

// ── Section 3: Quality Ratings ────────────────────────────────────────────────

function QualityRatingsSection({ profileId }: { profileId: string }) {
  const [ratings, setRatings] = useState<QualityRating[]>([])
  const [loading, setLoading] = useState(true)
  const [assignments, setAssignments] = useState<{ id: string; label: string }[]>([])

  // Form state
  const [assignmentId, setAssignmentId] = useState('')
  const [score, setScore] = useState(5)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [formOk, setFormOk] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [rRes, aRes] = await Promise.all([
      getQualityRatings(profileId),
      listOrgTaskAssignments(),
    ])
    if (rRes.success) setRatings(rRes.data)
    if (aRes.success) {
      setAssignments(
        aRes.data
          .filter((a) => a.status === 'completed' && a.assigned_employee_ids?.includes(profileId))
          .map((a) => ({
            id: a.id,
            label: `${a.work_package_name}${a.project_name ? ` — ${a.project_name}` : ''}`,
          })),
      )
    }
    setLoading(false)
  }, [profileId])

  useEffect(() => { void load() }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormErr(null)
    setFormOk(false)
    setSubmitting(true)
    const res = await addQualityRating(
      profileId,
      assignmentId || null,
      score,
      notes.trim() || null,
    )
    setSubmitting(false)
    if (!res.success) { setFormErr(res.error); return }
    setScore(5)
    setNotes('')
    setAssignmentId('')
    setFormOk(true)
    void load()
    setTimeout(() => setFormOk(false), 3000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Star size={13} className="text-amber-400" />
        <p className="text-sm font-semibold text-gray-300">Quality Ratings</p>
      </div>

      {/* Past ratings */}
      {loading && <p className="text-xs text-gray-600">Loading ratings…</p>}
      {!loading && ratings.length === 0 && (
        <p className="text-xs text-gray-600">No ratings yet.</p>
      )}
      {ratings.length > 0 && (
        <div className="space-y-2">
          {ratings.map((r) => {
            const task = assignments.find((a) => a.id === r.assignment_id)
            return (
              <div
                key={r.id}
                className="rounded-lg px-4 py-3 border space-y-1"
                style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
              >
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        size={13}
                        className={n <= r.score ? 'text-amber-400 fill-amber-400' : 'text-gray-700'}
                      />
                    ))}
                  </div>
                  <span className="text-xs font-semibold text-gray-300">{r.score} / 5</span>
                  <span className="text-xs text-gray-600 ml-auto">{fmtDate(r.rated_at.slice(0, 10))}</span>
                </div>
                {task && (
                  <p className="text-xs text-gray-500">Task: {task.label}</p>
                )}
                {r.notes && (
                  <p className="text-xs text-gray-400 italic">"{r.notes}"</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add rating form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-lg p-4 border space-y-3"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <p className="text-xs font-semibold text-gray-400">Add Rating</p>

        {assignments.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Link to Task (optional)</label>
            <select
              value={assignmentId}
              onChange={(e) => setAssignmentId(e.target.value)}
              className="px-2 py-1.5 rounded border text-xs text-gray-300 bg-transparent w-full"
              style={{ borderColor: '#2a2d36', backgroundColor: '#0a0b0f' }}
            >
              <option value="">— No specific task —</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Score</label>
          <StarSelector value={score} onChange={setScore} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Quality observations…"
            className="px-2 py-1.5 rounded border text-xs text-gray-300 bg-transparent resize-none w-full"
            style={{ borderColor: '#2a2d36', backgroundColor: '#0a0b0f' }}
          />
        </div>

        {formErr && <p className="text-xs text-red-400">{formErr}</p>}
        {formOk && <p className="text-xs text-green-400">Rating saved.</p>}

        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all disabled:opacity-50"
          style={{ borderColor: '#92400e88', color: '#fbbf24', backgroundColor: '#1c1408' }}
        >
          {submitting ? <Loader2 size={11} className="animate-spin" /> : <Award size={11} />}
          {submitting ? 'Saving…' : 'Submit Rating'}
        </button>
      </form>
    </div>
  )
}

// ── Section 4: Compensation History ───────────────────────────────────────────

const EVENT_TYPE_STYLES: Record<CompensationEventType, { label: string; color: string; bg: string }> = {
  raise:      { label: 'Raise',      color: 'text-green-400',  bg: 'bg-green-900/20 border-green-700/40' },
  bonus:      { label: 'Bonus',      color: 'text-blue-400',   bg: 'bg-blue-900/20 border-blue-700/40' },
  adjustment: { label: 'Adjustment', color: 'text-amber-400',  bg: 'bg-amber-900/20 border-amber-700/40' },
  note:       { label: 'Note',       color: 'text-gray-400',   bg: 'bg-gray-800/30 border-gray-700/40' },
}

function CompensationSection({
  profileId,
  snapshots,
}: {
  profileId: string
  snapshots: PerformanceSnapshot[]
}) {
  const [events, setEvents] = useState<CompensationEvent[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [eventType, setEventType] = useState<CompensationEventType>('note')
  const [amount, setAmount] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(toISODate(new Date()))
  const [reason, setReason] = useState('')
  const [snapshotId, setSnapshotId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [formOk, setFormOk] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getCompensationHistory(profileId)
    if (res.success) setEvents(res.data)
    setLoading(false)
  }, [profileId])

  useEffect(() => { void load() }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormErr(null)
    setFormOk(false)
    const parsedAmount = amount.trim() ? parseFloat(amount) : null
    if (parsedAmount !== null && isNaN(parsedAmount)) {
      setFormErr('Invalid amount')
      return
    }
    setSubmitting(true)
    const res = await addCompensationEvent(
      profileId,
      eventType,
      parsedAmount,
      effectiveDate,
      reason.trim() || null,
      snapshotId || null,
    )
    setSubmitting(false)
    if (!res.success) { setFormErr(res.error); return }
    setAmount('')
    setReason('')
    setSnapshotId('')
    setEventType('note')
    setFormOk(true)
    void load()
    setTimeout(() => setFormOk(false), 3000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <DollarSign size={13} className="text-green-400" />
        <p className="text-sm font-semibold text-gray-300">Compensation History</p>
      </div>

      {/* Timeline */}
      {loading && <p className="text-xs text-gray-600">Loading history…</p>}
      {!loading && events.length === 0 && (
        <p className="text-xs text-gray-600">No compensation events recorded.</p>
      )}
      {events.length > 0 && (
        <div className="relative space-y-3 pl-5 border-l" style={{ borderColor: '#1e2128' }}>
          {events.map((ev) => {
            const style = EVENT_TYPE_STYLES[ev.event_type as CompensationEventType]
            const linkedSnap = snapshots.find((s) => s.id === ev.based_on_snapshot_id)
            return (
              <div key={ev.id} className="relative">
                <span
                  className="absolute -left-[22px] top-2 w-2.5 h-2.5 rounded-full border-2"
                  style={{ backgroundColor: '#0d1117', borderColor: '#2a2d36' }}
                />
                <div
                  className="rounded-lg px-4 py-3 border space-y-1"
                  style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full border ${style.color} ${style.bg}`}
                    >
                      {style.label}
                    </span>
                    {ev.amount != null && (
                      <span className={`text-xs font-semibold ${style.color}`}>
                        ${Number(ev.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    )}
                    <span className="text-xs text-gray-600 ml-auto">
                      Effective {fmtDate(ev.effective_date)}
                    </span>
                  </div>
                  {ev.reason && <p className="text-xs text-gray-400">{ev.reason}</p>}
                  {linkedSnap && (
                    <p className="text-xs text-gray-600">
                      Based on: {fmtDate(linkedSnap.period_start)} – {fmtDate(linkedSnap.period_end)} report
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add event form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-lg p-4 border space-y-3"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <p className="text-xs font-semibold text-gray-400">Add Event</p>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Type</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as CompensationEventType)}
              className="px-2 py-1.5 rounded border text-xs text-gray-300 bg-transparent"
              style={{ borderColor: '#2a2d36', backgroundColor: '#0a0b0f' }}
            >
              <option value="raise">Raise</option>
              <option value="bonus">Bonus</option>
              <option value="adjustment">Adjustment</option>
              <option value="note">Note</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              Amount {eventType === 'note' ? '(optional)' : ''}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="px-2 py-1.5 rounded border text-xs text-gray-300 bg-transparent w-full"
              style={{ borderColor: '#2a2d36', backgroundColor: '#0a0b0f' }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Effective Date</label>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            required
            className="px-2 py-1.5 rounded border text-xs text-gray-300 bg-transparent"
            style={{ borderColor: '#2a2d36', backgroundColor: '#0a0b0f' }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Reason or notes…"
            className="px-2 py-1.5 rounded border text-xs text-gray-300 bg-transparent resize-none w-full"
            style={{ borderColor: '#2a2d36', backgroundColor: '#0a0b0f' }}
          />
        </div>

        {snapshots.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Link to Report (optional)</label>
            <select
              value={snapshotId}
              onChange={(e) => setSnapshotId(e.target.value)}
              className="px-2 py-1.5 rounded border text-xs text-gray-300 bg-transparent w-full"
              style={{ borderColor: '#2a2d36', backgroundColor: '#0a0b0f' }}
            >
              <option value="">— None —</option>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {fmtDate(s.period_start)} – {fmtDate(s.period_end)}
                </option>
              ))}
            </select>
          </div>
        )}

        {formErr && <p className="text-xs text-red-400">{formErr}</p>}
        {formOk && <p className="text-xs text-green-400">Event recorded.</p>}

        <button
          type="submit"
          disabled={submitting || !effectiveDate}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all disabled:opacity-50"
          style={{ borderColor: '#14532d88', color: '#4ade80', backgroundColor: '#0a1f0f' }}
        >
          {submitting ? <Loader2 size={11} className="animate-spin" /> : <TrendingUp size={11} />}
          {submitting ? 'Saving…' : 'Add Event'}
        </button>
      </form>
    </div>
  )
}

// ── Root: OwnerPerformancePanel ───────────────────────────────────────────────

export default function OwnerPerformancePanel({ initialEmployeeId }: { initialEmployeeId?: string } = {}) {
  const [employees, setEmployees] = useState<AdminEmployeeProfile[]>([])
  const [loadingEmps, setLoadingEmps] = useState(true)
  const [selectedId, setSelectedId] = useState(initialEmployeeId ?? '')
  const [snapshots, setSnapshots] = useState<PerformanceSnapshot[]>([])

  useEffect(() => {
    ;(async () => {
      setLoadingEmps(true)
      const res = await getActiveEmployeeProfiles()
      if (res.success) setEmployees(res.data.filter((e) => e.active))
      setLoadingEmps(false)
    })()
  }, [])

  // Keep snapshots in sync when employee changes (for compensation form)
  useEffect(() => {
    if (!selectedId) { setSnapshots([]); return }
    getSnapshots(selectedId).then((res) => {
      if (res.success) setSnapshots(res.data)
    })
  }, [selectedId])

  const selected = employees.find((e) => e.id === selectedId)

  return (
    <div className="space-y-6">
      {/* Employee selector */}
      <div
        className="rounded-lg p-4 border flex flex-col gap-2"
        style={{ backgroundColor: '#0d1117', borderColor: '#1e2128' }}
      >
        <label className="text-xs font-semibold text-gray-400">Select Employee</label>
        {loadingEmps ? (
          <p className="text-xs text-gray-600 flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" /> Loading employees…
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border text-sm text-gray-300 bg-transparent"
              style={{ borderColor: '#2a2d36', backgroundColor: '#0a0b0f' }}
            >
              <option value="">— Select an employee —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.display_name}{e.employee_role ? ` · ${e.employee_role}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="text-gray-600 -ml-8 pointer-events-none" />
          </div>
        )}
        {employees.length === 0 && !loadingEmps && (
          <p className="text-xs text-gray-600">No active portal employees found.</p>
        )}
      </div>

      {/* Employee performance view */}
      {selected && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
              style={{ backgroundColor: '#1e3a5f' }}
            >
              {selected.display_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-200">{selected.display_name}</p>
              <p className="text-xs text-gray-500">{selected.email ?? 'No email'}</p>
            </div>
          </div>

          {/* Section 1 + 2: Snapshot */}
          <div
            className="rounded-xl border p-4"
            style={{ backgroundColor: '#090a0e', borderColor: '#1e2128' }}
          >
            <SnapshotSection profileId={selected.id} />
          </div>

          {/* Section 3: Quality Ratings */}
          <div
            className="rounded-xl border p-4"
            style={{ backgroundColor: '#090a0e', borderColor: '#1e2128' }}
          >
            <QualityRatingsSection profileId={selected.id} />
          </div>

          {/* Section 4: Compensation History */}
          <div
            className="rounded-xl border p-4"
            style={{ backgroundColor: '#090a0e', borderColor: '#1e2128' }}
          >
            <CompensationSection profileId={selected.id} snapshots={snapshots} />
          </div>
        </div>
      )}

      {!selected && !loadingEmps && employees.length > 0 && (
        <p className="text-xs text-gray-600">Select an employee above to view their performance data.</p>
      )}
    </div>
  )
}
