// @ts-nocheck
/**
 * CrewPortal — Simplified mobile-optimized portal for crew members.
 *
 * Crew members see this instead of the main V15rLayout.
 * Layout: header + three sections (Today's Jobs, Log Work, My Recent Logs).
 *
 * Completely separate from the main app — no sidebar, no AI panels.
 * Designed for quick field use on iPhone.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Zap, LogOut, ChevronDown, ChevronUp, Plus, Trash2, Clock, Wrench, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AssignedJob {
  id: string
  job_reference: string
  name: string
  address?: string
  notes?: string
}

interface MaterialRow {
  id: string   // local key only
  name: string
  quantity: string
  unit: string
}

interface CrewFieldLog {
  id: string
  job_reference: string
  description: string
  hours_worked: number
  materials: { name: string; quantity: string; unit: string }[]
  flagged: boolean
  flag_note?: string
  submitted_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface JobCardProps {
  job: AssignedJob
  onLogWork: (job: AssignedJob) => void
}

function JobCard({ job, onLogWork }: JobCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{job.name}</p>
          {job.address && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{job.address}</p>
          )}
        </div>
        <div className="ml-3 flex items-center gap-2 flex-shrink-0">
          <span className="text-xs bg-green-100 text-green-700 font-medium px-2 py-0.5 rounded-full">
            Active
          </span>
          {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          {job.notes ? (
            <p className="text-sm text-gray-600 mt-3 mb-4 leading-relaxed">{job.notes}</p>
          ) : (
            <p className="text-xs text-gray-400 mt-3 mb-4 italic">No notes from owner</p>
          )}
          <button
            onClick={() => onLogWork(job)}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl active:opacity-80"
          >
            <Wrench size={14} />
            Log Work on This Job
          </button>
        </div>
      )}
    </div>
  )
}


interface LogWorkFormProps {
  prefilledJob?: AssignedJob | null
  ownerId: string
  onSubmit: () => void
  onCancel: () => void
}

function LogWorkForm({ prefilledJob, ownerId, onSubmit, onCancel }: LogWorkFormProps) {
  const { user } = useAuth()
  const [jobRef, setJobRef] = useState(prefilledJob?.job_reference ?? '')
  const [description, setDescription] = useState('')
  const [hours, setHours] = useState('')
  const [materials, setMaterials] = useState<MaterialRow[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Update job ref when prefilledJob changes
  useEffect(() => {
    if (prefilledJob?.job_reference) {
      setJobRef(prefilledJob.job_reference)
    }
  }, [prefilledJob])

  function addMaterial() {
    setMaterials(m => [...m, { id: generateId(), name: '', quantity: '', unit: '' }])
  }

  function removeMaterial(id: string) {
    setMaterials(m => m.filter(r => r.id !== id))
  }

  function updateMaterial(id: string, field: keyof Omit<MaterialRow, 'id'>, value: string) {
    setMaterials(m => m.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) {
      setError('Work description is required.')
      return
    }
    if (!jobRef.trim()) {
      setError('Job reference is required.')
      return
    }
    if (!user?.id || !ownerId) {
      setError('Authentication error. Please sign out and try again.')
      return
    }

    setSaving(true)
    setError(null)

    const cleanMaterials = materials
      .filter(m => m.name.trim())
      .map(({ name, quantity, unit }) => ({ name: name.trim(), quantity: quantity.trim(), unit: unit.trim() }))

    const { error: dbError } = await supabase
      .from('crew_field_logs')
      .insert({
        user_id:       user.id,
        owner_id:      ownerId,
        job_reference: jobRef.trim(),
        description:   description.trim(),
        hours_worked:  hours ? parseFloat(hours) : 0,
        materials:     cleanMaterials,
        submitted_at:  new Date().toISOString(),
      })

    setSaving(false)

    if (dbError) {
      setError(`Save failed: ${dbError.message}`)
      return
    }

    setSuccess(true)
    setTimeout(() => {
      setSuccess(false)
      setDescription('')
      setHours('')
      setMaterials([])
      onSubmit()
    }, 1500)
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle className="w-7 h-7 text-green-600" />
        </div>
        <p className="text-sm font-semibold text-gray-800">Log submitted!</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Job Reference */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
          Job Reference <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={jobRef}
          onChange={e => setJobRef(e.target.value)}
          placeholder="e.g. Anderson Residence, SC-0045"
          required
          className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
        />
      </div>

      {/* Work Description */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
          Work Performed <span className="text-red-500">*</span>
        </label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe what was done today..."
          rows={4}
          required
          className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 resize-none"
        />
      </div>

      {/* Hours */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
          Hours Worked
        </label>
        <input
          type="number"
          value={hours}
          onChange={e => setHours(e.target.value)}
          placeholder="0.0"
          step="0.25"
          min="0"
          max="24"
          className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
        />
      </div>

      {/* Materials */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Materials Used
          </label>
          <button
            type="button"
            onClick={addMaterial}
            className="flex items-center gap-1 text-xs text-green-600 font-semibold active:opacity-70"
          >
            <Plus size={12} />
            Add Row
          </button>
        </div>
        {materials.length === 0 && (
          <p className="text-xs text-gray-400 italic">No materials added.</p>
        )}
        {materials.map(mat => (
          <div key={mat.id} className="flex gap-2 mb-2 items-center">
            <input
              type="text"
              value={mat.name}
              onChange={e => updateMaterial(mat.id, 'name', e.target.value)}
              placeholder="Material name"
              className="flex-1 px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-green-500"
            />
            <input
              type="text"
              value={mat.quantity}
              onChange={e => updateMaterial(mat.id, 'quantity', e.target.value)}
              placeholder="Qty"
              className="w-16 px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm text-center focus:outline-none focus:border-green-500"
            />
            <input
              type="text"
              value={mat.unit}
              onChange={e => updateMaterial(mat.id, 'unit', e.target.value)}
              placeholder="ea"
              className="w-14 px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm text-center focus:outline-none focus:border-green-500"
            />
            <button
              type="button"
              onClick={() => removeMaterial(mat.id)}
              className="text-red-400 active:opacity-70 flex-shrink-0"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle size={15} className="text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 active:opacity-70"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-green-600 text-white text-sm font-semibold active:opacity-80 disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Saving...
            </>
          ) : (
            'Submit Log'
          )}
        </button>
      </div>
    </form>
  )
}


interface RecentLogsProps {
  userId: string
  refreshTrigger: number
}

function RecentLogs({ userId, refreshTrigger }: RecentLogsProps) {
  const [logs, setLogs] = useState<CrewFieldLog[]>([])
  const [loading, setLoading] = useState(true)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('crew_field_logs')
      .select('id,job_reference,description,hours_worked,materials,flagged,flag_note,submitted_at')
      .eq('user_id', userId)
      .order('submitted_at', { ascending: false })
      .limit(5)

    if (!error && data) {
      setLogs(data as CrewFieldLog[])
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    if (userId) fetchLogs()
  }, [userId, refreshTrigger, fetchLogs])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-6 italic">
        No logs submitted yet. Tap "Log Work" on a job above.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {logs.map(log => (
        <div
          key={log.id}
          className={`rounded-2xl border p-4 ${
            log.flagged
              ? 'bg-amber-50 border-amber-200'
              : 'bg-white border-gray-200'
          }`}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide truncate">
                {log.job_reference}
              </p>
              <p className="text-sm text-gray-900 mt-1 leading-relaxed">{log.description}</p>
            </div>
            {log.flagged && (
              <div className="flex-shrink-0">
                <AlertCircle size={16} className="text-amber-500" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 mt-2">
            {log.hours_worked > 0 && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Clock size={11} />
                <span>{log.hours_worked}h</span>
              </div>
            )}
            {log.materials?.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Wrench size={11} />
                <span>{log.materials.length} material{log.materials.length !== 1 ? 's' : ''}</span>
              </div>
            )}
            <span className="text-xs text-gray-400 ml-auto">{formatDate(log.submitted_at)}</span>
          </div>

          {log.flagged && log.flag_note && (
            <div className="mt-2 p-2 bg-amber-100 rounded-lg">
              <p className="text-xs text-amber-800">
                <strong>Owner note:</strong> {log.flag_note}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}


// ── Section Header ─────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  )
}


// ── CrewPortal (main export) ──────────────────────────────────────────────────

export function CrewPortal() {
  const { user, ownerId, signOut } = useAuth()
  const [crewMember, setCrewMember] = useState<{ name: string; role?: string } | null>(null)
  const [jobs, setJobs] = useState<AssignedJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [logTarget, setLogTarget] = useState<AssignedJob | null>(null)
  const [showLogForm, setShowLogForm] = useState(false)
  const [logRefreshTick, setLogRefreshTick] = useState(0)

  // Load crew member info
  useEffect(() => {
    if (!user?.id) return
    supabase
      .from('crew_members')
      .select('name,role')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setCrewMember(data)
      })
  }, [user?.id])

  // Load today's assigned jobs
  // For now: load recent crew_field_logs unique job_references as "known jobs",
  // plus any future assigned_jobs rows (when that table is built).
  // In Session 5 we build the basic log structure — real job assignment
  // will be wired in a future session via a dedicated assigned_jobs table.
  useEffect(() => {
    if (!user?.id || !ownerId) {
      setJobsLoading(false)
      return
    }

    setJobsLoading(true)

    // Query for any crew_member row details / future assigned_jobs rows.
    // For now, pull the crew_member name + produce a "general log" card.
    supabase
      .from('crew_members')
      .select('id,name,org_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data: cm }) => {
        if (cm) {
          // Create a general "Open Field Log" job card so crew can always submit
          const generalJob: AssignedJob = {
            id:            'general',
            job_reference: 'General',
            name:          'General Field Work',
            address:       '',
            notes:         'Use this card to log any work not tied to a specific job, or tap Log Work and fill in the job reference manually.',
          }
          setJobs([generalJob])
        }
        setJobsLoading(false)
      })
      .catch(() => setJobsLoading(false))
  }, [user?.id, ownerId])

  function handleLogWork(job: AssignedJob) {
    setLogTarget(job)
    setShowLogForm(true)
    // Smooth scroll to form
    setTimeout(() => {
      document.getElementById('log-work-section')?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }

  function handleLogSubmitted() {
    setShowLogForm(false)
    setLogTarget(null)
    setLogRefreshTick(t => t + 1)
  }

  const displayName = crewMember?.name ?? user?.email ?? 'Crew Member'

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shadow-sm">
        <div className="w-8 h-8 rounded-lg bg-green-100 border border-green-200 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-green-600" fill="currentColor" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 leading-none">Power On Solutions</p>
          <p className="text-sm font-bold text-gray-900 truncate">{displayName}</p>
        </div>
        <button
          onClick={() => signOut()}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors active:opacity-70 flex-shrink-0"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </header>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <main className="max-w-lg mx-auto px-4 py-6 space-y-8 pb-20">

        {/* ── Section 1: Today's Jobs ──────────────────────────────────── */}
        <section>
          <SectionHeader
            title="Today's Jobs"
            subtitle="Tap a job to expand and log work"
          />

          {jobsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-400 italic">No jobs assigned for today.</p>
              <p className="text-xs text-gray-400 mt-1">Contact your owner to get assigned to a job.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map(job => (
                <JobCard
                  key={job.id}
                  job={job}
                  onLogWork={handleLogWork}
                />
              ))}
            </div>
          )}

          {/* Quick log button even without a job card */}
          {!showLogForm && (
            <button
              onClick={() => { setLogTarget(null); setShowLogForm(true); setTimeout(() => document.getElementById('log-work-section')?.scrollIntoView({ behavior: 'smooth' }), 100) }}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-300 rounded-2xl text-sm text-gray-500 font-medium active:opacity-70"
            >
              <Plus size={15} />
              Log work manually
            </button>
          )}
        </section>


        {/* ── Section 2: Log Work Form ─────────────────────────────────── */}
        <section id="log-work-section">
          <SectionHeader
            title="Log Work"
            subtitle={logTarget ? `Logging for: ${logTarget.name}` : 'Fill in job details below'}
          />

          {showLogForm ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <LogWorkForm
                prefilledJob={logTarget}
                ownerId={ownerId ?? ''}
                onSubmit={handleLogSubmitted}
                onCancel={() => { setShowLogForm(false); setLogTarget(null) }}
              />
            </div>
          ) : (
            <div className="text-center py-6 text-sm text-gray-400">
              <p>Tap "Log Work" on a job above to open the form.</p>
            </div>
          )}
        </section>


        {/* ── Section 3: Recent Logs ───────────────────────────────────── */}
        <section>
          <SectionHeader
            title="My Recent Logs"
            subtitle="Last 5 submitted field logs"
          />
          {user?.id ? (
            <RecentLogs userId={user.id} refreshTrigger={logRefreshTick} />
          ) : null}
        </section>

      </main>
    </div>
  )
}

export default CrewPortal
