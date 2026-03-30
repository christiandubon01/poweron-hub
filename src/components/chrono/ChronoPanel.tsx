// @ts-nocheck
/**
 * ChronoPanel — Week-view scheduling panel for CHRONO Phase D Part 1.
 *
 * Features:
 *   - Mon–Sun week grid (mobile-first)
 *   - Job cards with title, crew initials, hours
 *   - Red dot on card if conflict_flag = true
 *   - Gray dashed outline on idle days (no jobs)
 *   - Prev / Next week navigation + Today button
 *   - Tap card → inline detail expand
 *   - "Schedule Job" inline form: title, crew multi-select, date, hours
 */

import { useState, useEffect, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, CalendarDays, AlertCircle, Plus, X, Loader2, Clock,
} from 'lucide-react'
import clsx from 'clsx'
import { getUpcomingSchedule, scheduleJob, getIdleSlots } from '@/services/chronoService'
import type { JobScheduleRow } from '@/services/chronoService'
import { getBackupData } from '@/services/backupDataService'

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function addDays(d: Date, n: number): Date {
  const nd = new Date(d)
  nd.setDate(nd.getDate() + n)
  return nd
}

function getMondayOf(d: Date): Date {
  const nd = new Date(d)
  const dow = nd.getDay()          // 0=Sun … 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow  // shift to Monday
  nd.setDate(nd.getDate() + diff)
  nd.setHours(0, 0, 0, 0)
  return nd
}

function formatWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6)
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(monday)} – ${fmt(sunday)}`
}

function crewInitials(names: string[]): string {
  return names
    .slice(0, 3)
    .map(n => n.split(' ').map(w => w[0]).join('').toUpperCase())
    .join(' ')
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ── ScheduleForm ──────────────────────────────────────────────────────────────

interface ScheduleFormProps {
  employees: string[]
  onSubmit: (data: {
    job_title: string
    crew_assigned: string[]
    scheduled_date: string
    estimated_hours: number
  }) => Promise<void>
  onCancel: () => void
  initialDate?: string
}

function ScheduleForm({ employees, onSubmit, onCancel, initialDate }: ScheduleFormProps) {
  const [title, setTitle]   = useState('')
  const [date, setDate]     = useState(initialDate ?? toDateStr(new Date()))
  const [hours, setHours]   = useState('8')
  const [crew, setCrew]     = useState<string[]>([])
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  function toggleCrew(name: string) {
    setCrew(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setErr('Job title is required'); return }
    if (!date)          { setErr('Date is required'); return }
    setBusy(true)
    setErr(null)
    try {
      await onSubmit({
        job_title:       title.trim(),
        crew_assigned:   crew,
        scheduled_date:  date,
        estimated_hours: parseFloat(hours) || 8,
      })
    } catch (e: any) {
      setErr(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 p-3 bg-gray-800 rounded-lg border border-gray-700 space-y-3"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">
          Schedule Job
        </span>
        <button type="button" onClick={onCancel} className="text-gray-500 hover:text-gray-300">
          <X size={14} />
        </button>
      </div>

      {err && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">{err}</div>
      )}

      {/* Title */}
      <div>
        <label className="block text-[11px] text-gray-400 mb-0.5">Job Title</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Panel upgrade – Smith residence"
          className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
        />
      </div>

      {/* Date + Hours row */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-[11px] text-gray-400 mb-0.5">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500"
          />
        </div>
        <div className="w-24">
          <label className="block text-[11px] text-gray-400 mb-0.5">Est. Hours</label>
          <input
            type="number"
            min="0.5"
            max="24"
            step="0.5"
            value={hours}
            onChange={e => setHours(e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500"
          />
        </div>
      </div>

      {/* Crew multi-select */}
      {employees.length > 0 && (
        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Crew (select all that apply)</label>
          <div className="flex flex-wrap gap-1.5">
            {employees.map(name => (
              <button
                type="button"
                key={name}
                onClick={() => toggleCrew(name)}
                className={clsx(
                  'px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors',
                  crew.includes(name)
                    ? 'bg-orange-500/20 border-orange-500/60 text-orange-300'
                    : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-400'
                )}
              >
                {name}
              </button>
            ))}
          </div>
          {crew.length > 0 && (
            <p className="text-[10px] text-gray-500 mt-1">Selected: {crew.join(', ')}</p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
      >
        {busy && <Loader2 size={13} className="animate-spin" />}
        {busy ? 'Scheduling…' : 'Schedule Job'}
      </button>
    </form>
  )
}

// ── JobCard ───────────────────────────────────────────────────────────────────

interface JobCardProps {
  job: JobScheduleRow
  selected: boolean
  onToggle: () => void
}

function JobCard({ job, selected, onToggle }: JobCardProps) {
  return (
    <div
      onClick={onToggle}
      className={clsx(
        'relative cursor-pointer rounded-md px-2 py-1.5 text-left transition-all',
        'bg-gray-700/80 hover:bg-gray-700',
        selected && 'ring-1 ring-orange-500/60'
      )}
    >
      {/* Conflict red dot */}
      {job.conflict_flag && (
        <span
          className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500"
          title={job.conflict_reason ?? 'Scheduling conflict'}
        />
      )}

      <p className="text-[11px] font-semibold text-white leading-tight line-clamp-2">
        {job.job_title}
      </p>

      <div className="flex items-center gap-1.5 mt-0.5">
        {job.crew_assigned?.length > 0 && (
          <span className="text-[10px] text-gray-400">{crewInitials(job.crew_assigned)}</span>
        )}
        {job.estimated_hours && (
          <span className="text-[10px] text-gray-500">{job.estimated_hours}h</span>
        )}
      </div>

      {/* Inline detail expand */}
      {selected && (
        <div className="mt-2 pt-2 border-t border-gray-600 space-y-1">
          <p className="text-[11px] text-gray-300">
            <span className="text-gray-500">Title: </span>{job.job_title}
          </p>
          {job.crew_assigned?.length > 0 && (
            <p className="text-[11px] text-gray-300">
              <span className="text-gray-500">Crew: </span>{job.crew_assigned.join(', ')}
            </p>
          )}
          <p className="text-[11px] text-gray-300">
            <span className="text-gray-500">Start: </span>{job.start_time}
            <span className="text-gray-500 ml-2">Hours: </span>{job.estimated_hours}
          </p>
          <p className="text-[11px] text-gray-300">
            <span className="text-gray-500">Status: </span>
            <span className={clsx(
              job.status === 'complete'    && 'text-emerald-400',
              job.status === 'cancelled'   && 'text-gray-500',
              job.status === 'in_progress' && 'text-yellow-400',
              job.status === 'scheduled'   && 'text-blue-400',
            )}>
              {job.status}
            </span>
          </p>
          {job.conflict_flag && (
            <div className="flex items-start gap-1 bg-red-500/10 rounded px-1.5 py-1">
              <AlertCircle size={10} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-[10px] text-red-400">{job.conflict_reason}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── ChronoPanel ───────────────────────────────────────────────────────────────

export function ChronoPanel() {
  const [weekStart, setWeekStart]     = useState(() => getMondayOf(new Date()))
  const [jobs, setJobs]               = useState<JobScheduleRow[]>([])
  const [idleDates, setIdleDates]     = useState<Set<string>>(new Set())
  const [loading, setLoading]         = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [showForm, setShowForm]       = useState(false)
  const [formDate, setFormDate]       = useState<string | undefined>(undefined)
  const [justScheduled, setJustScheduled] = useState<string | null>(null)

  // Employee names from backup for crew selector
  const backup    = getBackupData()
  const employees: string[] = (backup?.employees ?? []).map((e: any) => e.name ?? e.id).filter(Boolean)

  // ── Load jobs + idle slots for displayed 7-day window ─────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch 30 days but filter to our week in render
      const [allJobs, idle] = await Promise.all([
        getUpcomingSchedule(30),
        getIdleSlots(30),
      ])
      setJobs(allJobs)
      setIdleDates(new Set(idle))
    } catch (err) {
      console.error('[ChronoPanel] loadData error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── Week days array ────────────────────────────────────────────────────────
  const weekDays: Date[] = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  // ── Navigation ────────────────────────────────────────────────────────────
  function prevWeek() { setWeekStart(w => addDays(w, -7)) }
  function nextWeek() { setWeekStart(w => addDays(w, 7)) }
  function goToday()  { setWeekStart(getMondayOf(new Date())) }

  // ── Submit new job ────────────────────────────────────────────────────────
  async function handleScheduleSubmit(formData: {
    job_title: string
    crew_assigned: string[]
    scheduled_date: string
    estimated_hours: number
  }) {
    const newJob = await scheduleJob(formData)
    setJobs(prev => [...prev, newJob])

    // Refresh idle slots
    const idle = await getIdleSlots(30)
    setIdleDates(new Set(idle))

    setShowForm(false)
    setJustScheduled(newJob.conflict_flag
      ? `⚠️ Scheduled (conflict: ${newJob.conflict_reason})`
      : `✅ "${newJob.job_title}" scheduled for ${newJob.scheduled_date}`
    )
    setTimeout(() => setJustScheduled(null), 5000)
  }

  const todayStr = toDateStr(new Date())

  return (
    <div className="space-y-3">
      {/* Header: nav controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays size={15} className="text-orange-400" />
          <span className="text-sm font-semibold text-white">
            {formatWeekRange(weekStart)}
          </span>
          {loading && <Loader2 size={12} className="text-gray-500 animate-spin" />}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={goToday}
            className="px-2 py-1 text-[11px] text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            Today
          </button>
          <button
            onClick={prevWeek}
            className="p-1.5 text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            onClick={nextWeek}
            className="p-1.5 text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            <ChevronRight size={13} />
          </button>
          <button
            onClick={() => { setFormDate(undefined); setShowForm(s => !s) }}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-orange-300 bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/30 rounded transition-colors"
          >
            <Plus size={11} />
            Schedule Job
          </button>
        </div>
      </div>

      {/* Feedback toast */}
      {justScheduled && (
        <div className={clsx(
          'text-xs rounded-lg px-3 py-2 border',
          justScheduled.startsWith('⚠️')
            ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        )}>
          {justScheduled}
        </div>
      )}

      {/* Schedule Job form (global) */}
      {showForm && (
        <ScheduleForm
          employees={employees}
          onSubmit={handleScheduleSubmit}
          onCancel={() => setShowForm(false)}
          initialDate={formDate}
        />
      )}

      {/* Week grid — horizontal scroll on mobile */}
      <div className="overflow-x-auto -mx-1">
        <div className="grid grid-cols-7 gap-1 min-w-[560px] px-1">
          {weekDays.map((day, idx) => {
            const ds        = toDateStr(day)
            const isToday   = ds === todayStr
            const dayJobs   = jobs.filter(j => j.scheduled_date === ds && j.status !== 'cancelled')
            const hasJobs   = dayJobs.length > 0
            const isIdle    = !hasJobs && idleDates.has(ds)
            const hasConflict = dayJobs.some(j => j.conflict_flag)

            return (
              <div key={ds} className="flex flex-col min-h-[120px]">
                {/* Day label */}
                <div className={clsx(
                  'text-center text-[10px] font-semibold mb-1 pb-1 border-b',
                  isToday
                    ? 'text-orange-400 border-orange-500/40'
                    : 'text-gray-400 border-gray-700'
                )}>
                  <div>{DAY_LABELS[idx]}</div>
                  <div className={clsx(
                    'text-[9px]',
                    isToday ? 'text-orange-300' : 'text-gray-500'
                  )}>
                    {day.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                  </div>
                  {hasConflict && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mx-auto mt-0.5" />
                  )}
                </div>

                {/* Day body */}
                <div
                  className={clsx(
                    'flex-1 rounded-lg p-1 space-y-1 transition-colors',
                    isIdle
                      ? 'border border-dashed border-gray-600 bg-gray-800/20'
                      : hasJobs
                        ? 'bg-gray-800/40'
                        : 'bg-transparent'
                  )}
                >
                  {/* Idle placeholder */}
                  {isIdle && (
                    <div className="flex flex-col items-center justify-center h-full py-2 text-center">
                      <Clock size={10} className="text-gray-600 mb-1" />
                      <span className="text-[9px] text-gray-600">idle</span>
                    </div>
                  )}

                  {/* Job cards */}
                  {dayJobs.map(job => (
                    <JobCard
                      key={job.id}
                      job={job}
                      selected={selectedJobId === job.id}
                      onToggle={() =>
                        setSelectedJobId(prev => prev === job.id ? null : job.id)
                      }
                    />
                  ))}

                  {/* Quick-add shortcut per day */}
                  {!isIdle && (
                    <button
                      onClick={() => { setFormDate(ds); setShowForm(true) }}
                      className="w-full text-center text-[9px] text-gray-600 hover:text-orange-400 py-0.5 transition-colors"
                    >
                      + add
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 pt-1">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
          <span className="text-[10px] text-gray-500">Conflict</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded border border-dashed border-gray-600 inline-block" />
          <span className="text-[10px] text-gray-500">Idle day</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />
          <span className="text-[10px] text-gray-500">Today</span>
        </div>
      </div>
    </div>
  )
}
