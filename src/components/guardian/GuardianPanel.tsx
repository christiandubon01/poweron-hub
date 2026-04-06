// @ts-nocheck
/**
 * GuardianPanel — Crew activity monitoring, audit trail, and anomaly flagging.
 *
 * Tabs:
 *   Activity Feed  — real-time activity_log feed (Part 2)
 *   Pending Review — flagged unreviewed crew_field_logs
 *   All Logs       — full crew log list with filters
 *   Crew Members   — manage crew, add members, generate invite links
 *
 * Role gate (Part 4): only owner / admin roles see this panel.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  ShieldAlert,
  ShieldCheck,
  Users,
  ClipboardList,
  CheckCircle,
  AlertTriangle,
  Clock,
  Briefcase,
  UserPlus,
  RefreshCw,
  Filter,
  ChevronDown,
  Activity,
  Play,
  Lock,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useDemoMode } from '@/store/demoStore'
import {
  reviewPendingLogs,
  markLogReviewed,
  markAllLogsReviewed,
  getActivityFeed,
  runActivityAnalysis,
  routeGuardianAlerts,
  type CrewFieldLog,
  type Flag,
  type ActivityEntry,
  type ActivityAnomalyType,
} from '@/agents/guardian'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrewMember {
  id: string
  owner_id: string
  user_id: string | null
  name: string
  role: 'crew' | 'lead'
  phone: string | null
  email: string | null
  invite_token: string | null
  active: boolean
  created_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function severityColor(severity: string): string {
  switch (severity) {
    case 'high': return 'text-red-400 border-red-700/40 bg-red-900/10'
    case 'medium': return 'text-amber-400 border-amber-700/40 bg-amber-900/10'
    default: return 'text-yellow-400 border-yellow-700/40 bg-yellow-900/10'
  }
}

function flagLabel(flag: Flag): string {
  switch (flag.type) {
    case 'MISSING_HOURS': return 'Missing Hours'
    case 'MISSING_MATERIALS': return 'Missing Materials'
    case 'LONG_SHIFT': return 'Long Shift'
    case 'SHORT_LOG': return 'Short Log'
    case 'NO_JOB_REFERENCE': return 'No Job Reference'
    default: return flag.type
  }
}

function anomalyLabel(type: ActivityAnomalyType): string {
  switch (type) {
    case 'DUPLICATE_SAME_DAY': return 'Duplicate Entry'
    case 'EXCESS_HOURS': return 'Excess Hours'
    case 'MATERIAL_COST_SPIKE': return 'Cost Spike'
    case 'OUT_OF_HOURS': return 'After Hours'
    default: return type
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ── Flag Badge ────────────────────────────────────────────────────────────────

function FlagBadge({ flag }: { flag: Flag }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${severityColor(flag.severity)}`}>
      <AlertTriangle size={9} />
      {flagLabel(flag)}
    </span>
  )
}

function ActivityFlagBadge({ type, severity }: { type: ActivityAnomalyType; severity: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${severityColor(severity)}`}>
      <AlertTriangle size={9} />
      {anomalyLabel(type)}
    </span>
  )
}

// ── Log Card ──────────────────────────────────────────────────────────────────

function LogCard({
  log,
  showReviewButton = false,
  onReviewed,
}: {
  log: CrewFieldLog
  showReviewButton?: boolean
  onReviewed?: (id: string) => void
}) {
  const [marking, setMarking] = useState(false)

  const handleMarkReviewed = async () => {
    setMarking(true)
    await markLogReviewed(log.id)
    onReviewed?.(log.id)
    setMarking(false)
  }

  const hasFlagsToShow = log.flags && log.flags.length > 0

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${hasFlagsToShow ? 'border-amber-700/30 bg-amber-900/5' : 'border-gray-700/30 bg-gray-800/20'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold text-sm">{log.crew_name}</span>
            {log.reviewed_by_owner && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-900/20 border border-emerald-700/30 px-2 py-0.5 rounded-full">
                <CheckCircle size={9} />
                Reviewed
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            {log.job_reference && (
              <span className="flex items-center gap-1">
                <Briefcase size={11} />
                {log.job_reference}
              </span>
            )}
            {log.hours_logged !== null && log.hours_logged !== undefined && (
              <span className="flex items-center gap-1">
                <Clock size={11} />
                {log.hours_logged}h
              </span>
            )}
            <span>{formatDate(log.created_at)}</span>
          </div>
        </div>

        {showReviewButton && !log.reviewed_by_owner && (
          <button
            onClick={handleMarkReviewed}
            disabled={marking}
            className="flex-shrink-0 flex items-center gap-1.5 text-xs bg-emerald-700/20 hover:bg-emerald-700/40 text-emerald-400 border border-emerald-700/30 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <CheckCircle size={13} />
            {marking ? 'Saving…' : 'Mark Reviewed'}
          </button>
        )}
      </div>

      <p className="text-gray-400 text-xs leading-relaxed line-clamp-3">
        {log.work_description}
      </p>

      {hasFlagsToShow && (
        <div className="flex flex-wrap gap-1.5">
          {(log.flags ?? []).map((flag, i) => (
            <FlagBadge key={i} flag={flag} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Activity Feed Tab (Part 2) ─────────────────────────────────────────────────

function ActivityFeedTab() {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [analysisRunning, setAnalysisRunning] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const feed = await getActivityFeed(60)
      setEntries(feed)
    } catch (err) {
      console.error('[GuardianPanel] ActivityFeedTab error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleRunAnalysis = async () => {
    setAnalysisRunning(true)
    setAnalysisResult(null)
    try {
      const result = await runActivityAnalysis(30)
      // Route any new flags to Home panel alerts
      if (result.flags.length > 0) {
        routeGuardianAlerts(result.flags)
      }
      setAnalysisResult(result.summary)
      // Reload feed to pick up fresh flag data
      await load()
    } catch (err) {
      console.error('[GuardianPanel] runAnalysis error:', err)
      setAnalysisResult('Analysis failed — check console for details.')
    } finally {
      setAnalysisRunning(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 gap-2 text-sm">
        <RefreshCw size={16} className="animate-spin" />
        Loading activity feed…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Analysis button + result */}
      <div className="flex flex-col gap-2">
        <button
          onClick={handleRunAnalysis}
          disabled={analysisRunning}
          className="flex items-center justify-center gap-2 text-sm bg-emerald-700/20 hover:bg-emerald-700/40 text-emerald-400 border border-emerald-700/30 px-4 py-2 rounded-lg transition-colors disabled:opacity-60 w-full"
        >
          {analysisRunning ? (
            <><RefreshCw size={14} className="animate-spin" /> Analyzing last 30 days…</>
          ) : (
            <><Play size={14} /> Run Analysis (Last 30 Days)</>
          )}
        </button>

        {analysisResult && (
          <div className="rounded-xl px-4 py-3 bg-blue-900/15 border border-blue-700/30 text-blue-300 text-xs leading-relaxed">
            {analysisResult}
          </div>
        )}
      </div>

      {/* Feed */}
      <p className="text-gray-600 text-xs">{entries.length} recent entr{entries.length !== 1 ? 'ies' : 'y'}</p>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
          <Activity size={36} className="text-gray-600/40" />
          <p className="text-gray-500 text-sm">No activity log entries yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(entry => (
            <div
              key={entry.id}
              className={`rounded-xl border p-3 space-y-2 ${
                entry.isFlagged
                  ? 'border-red-700/30 bg-red-900/8'
                  : 'border-emerald-700/20 bg-emerald-900/5'
              }`}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Status dot */}
                  <span
                    className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                      entry.isFlagged ? 'bg-red-500' : 'bg-emerald-500'
                    }`}
                  />
                  <span className="text-white text-xs font-medium">
                    {entry.entity_label || entry.entity_id || entry.action_type}
                  </span>
                  <span className="text-gray-600 text-[10px]">{entry.agent_name}</span>
                </div>
                <div className="flex-shrink-0 text-[10px] text-gray-600 whitespace-nowrap">
                  {formatDate(entry.created_at)} {formatTime(entry.created_at)}
                </div>
              </div>

              {/* Summary */}
              <p className="text-gray-400 text-xs leading-relaxed">{entry.summary}</p>

              {/* Anomaly flags */}
              {entry.isFlagged && entry.flags && entry.flags.length > 0 && (
                <div className="space-y-1">
                  {entry.flags.map((f, i) => (
                    <div key={i} className="flex flex-wrap gap-1.5 items-center">
                      <ActivityFlagBadge type={f.anomalyType} severity={f.severity} />
                      <span className="text-[10px] text-gray-500">{f.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Pending Review Tab ────────────────────────────────────────────────────────

function PendingReviewTab() {
  const [loading, setLoading] = useState(true)
  const [flaggedLogs, setFlaggedLogs] = useState<CrewFieldLog[]>([])
  const [cleanLogs, setCleanLogs] = useState<CrewFieldLog[]>([])
  const [markingAll, setMarkingAll] = useState(false)
  const [summary, setSummary] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await reviewPendingLogs()
      setFlaggedLogs(result?.flagged ?? [])
      setCleanLogs(result?.clean ?? [])
      setSummary(result?.summary ?? '')
    } catch (err) {
      console.error('[GuardianPanel] PendingReviewTab error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleReviewed = (logId: string) => {
    setFlaggedLogs(prev => prev.filter(l => l.id !== logId))
  }

  const handleMarkAll = async () => {
    setMarkingAll(true)
    await markAllLogsReviewed()
    setFlaggedLogs([])
    setSummary('All logs marked as reviewed.')
    setMarkingAll(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 gap-2 text-sm">
        <RefreshCw size={16} className="animate-spin" />
        Analyzing crew logs…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 ${(flaggedLogs ?? []).length > 0 ? 'bg-amber-900/20 border border-amber-700/30' : 'bg-emerald-900/20 border border-emerald-700/30'}`}>
        <div className="flex items-center gap-2">
          {(flaggedLogs ?? []).length > 0 ? (
            <ShieldAlert size={16} className="text-amber-400 flex-shrink-0" />
          ) : (
            <ShieldCheck size={16} className="text-emerald-400 flex-shrink-0" />
          )}
          <span className={`text-sm ${(flaggedLogs ?? []).length > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
            {summary}
          </span>
        </div>

        {(flaggedLogs ?? []).length > 0 && (
          <button
            onClick={handleMarkAll}
            disabled={markingAll}
            className="flex-shrink-0 flex items-center gap-1.5 text-xs bg-emerald-700/20 hover:bg-emerald-700/40 text-emerald-400 border border-emerald-700/30 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <CheckCircle size={13} />
            {markingAll ? 'Saving…' : 'Mark All Reviewed'}
          </button>
        )}
      </div>

      {(flaggedLogs ?? []).length > 0 ? (
        <div className="space-y-3">
          {(flaggedLogs ?? []).map(log => (
            <LogCard
              key={log.id}
              log={log}
              showReviewButton
              onReviewed={handleReviewed}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
          <ShieldCheck size={36} className="text-emerald-500/40" />
          <p className="text-gray-500 text-sm">No pending reviews. All crew logs are clear.</p>
        </div>
      )}
    </div>
  )
}

// ── All Logs Tab ──────────────────────────────────────────────────────────────

function AllLogsTab() {
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<CrewFieldLog[]>([])
  const [crewFilter, setCrewFilter] = useState('')
  const [jobFilter, setJobFilter] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setLoading(false); return }

        const { data, error } = await supabase
          .from('crew_field_logs')
          .select('*')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false })
          .limit(100)

        if (!error && data) {
          setLogs(data as CrewFieldLog[])
        }
      } catch (err) {
        console.error('[GuardianPanel] AllLogsTab error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const crewNames = [...new Set(logs.map(l => l.crew_name))].sort()
  const jobRefs = [...new Set(logs.map(l => l.job_reference).filter(Boolean))].sort()

  const filtered = logs.filter(log => {
    if (crewFilter && log.crew_name !== crewFilter) return false
    if (jobFilter && log.job_reference !== jobFilter) return false
    return true
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 gap-2 text-sm">
        <RefreshCw size={16} className="animate-spin" />
        Loading crew logs…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <select
            value={crewFilter}
            onChange={e => setCrewFilter(e.target.value)}
            className="appearance-none bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-emerald-600"
          >
            <option value="">All Crew</option>
            {crewNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        </div>
        <div className="relative">
          <select
            value={jobFilter}
            onChange={e => setJobFilter(e.target.value)}
            className="appearance-none bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-emerald-600"
          >
            <option value="">All Jobs</option>
            {jobRefs.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        </div>
        {(crewFilter || jobFilter) && (
          <button
            onClick={() => { setCrewFilter(''); setJobFilter('') }}
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 px-2"
          >
            <Filter size={11} />
            Clear
          </button>
        )}
      </div>

      <p className="text-gray-600 text-xs">{filtered.length} log{filtered.length !== 1 ? 's' : ''}</p>

      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map(log => (
            <div key={log.id} className="relative">
              <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-full" style={{
                background: log.reviewed_by_owner
                  ? '#10b981'
                  : (log.flags && log.flags.length > 0) ? '#f59e0b' : '#374151',
              }} />
              <div className="pl-3">
                <LogCard log={log} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
          <ClipboardList size={36} className="text-gray-600/40" />
          <p className="text-gray-500 text-sm">No logs found. Adjust filters or wait for crew to submit.</p>
        </div>
      )}
    </div>
  )
}

// ── Crew Members Tab ──────────────────────────────────────────────────────────

function CrewMembersTab() {
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<CrewMember[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [addName, setAddName] = useState('')
  const [addPhone, setAddPhone] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState<'crew' | 'lead'>('crew')
  const [saving, setSaving] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  const loadMembers = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data, error } = await supabase
        .from('crew_members')
        .select('*')
        .eq('owner_id', user.id)
        .eq('active', true)
        .order('created_at', { ascending: false })

      if (!error && data) {
        setMembers(data as CrewMember[])
      }
    } catch (err) {
      console.error('[GuardianPanel] CrewMembersTab load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadMembers() }, [loadMembers])

  const handleAddMember = async () => {
    if (!addName.trim()) return

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const token: string = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`

      const { data, error } = await supabase
        .from('crew_members')
        .insert({
          owner_id:     user.id,
          name:         addName.trim(),
          role:         addRole,
          phone:        addPhone.trim() || null,
          email:        addEmail.trim() || null,
          invite_token: token,
          active:       true,
        })
        .select()
        .single()

      if (!error && data) {
        setMembers(prev => [data as CrewMember, ...prev])
        setAddName('')
        setAddPhone('')
        setAddEmail('')
        setAddRole('crew')
        setShowAddForm(false)
      }
    } catch (err) {
      console.error('[GuardianPanel] addMember error:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleCopyInviteLink = (token: string) => {
    const link = `${window.location.origin}/invite/${token}`
    navigator.clipboard.writeText(link).then(() => {
      setCopiedToken(token)
      setTimeout(() => setCopiedToken(null), 2000)
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 gap-2 text-sm">
        <RefreshCw size={16} className="animate-spin" />
        Loading crew members…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowAddForm(v => !v)}
        className="flex items-center gap-2 text-sm bg-emerald-700/20 hover:bg-emerald-700/40 text-emerald-400 border border-emerald-700/30 px-4 py-2 rounded-lg transition-colors w-full justify-center"
      >
        <UserPlus size={15} />
        Add Crew Member
      </button>

      {showAddForm && (
        <div className="rounded-xl border border-gray-700/40 bg-gray-800/30 p-4 space-y-3">
          <h4 className="text-white text-sm font-semibold">New Crew Member</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Full name *"
              value={addName}
              onChange={e => setAddName(e.target.value)}
              className="bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-600 placeholder-gray-600"
            />
            <select
              value={addRole}
              onChange={e => setAddRole(e.target.value as 'crew' | 'lead')}
              className="bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-600"
            >
              <option value="crew">Crew</option>
              <option value="lead">Lead</option>
            </select>
            <input
              type="tel"
              placeholder="Phone (optional)"
              value={addPhone}
              onChange={e => setAddPhone(e.target.value)}
              className="bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-600 placeholder-gray-600"
            />
            <input
              type="email"
              placeholder="Email (optional)"
              value={addEmail}
              onChange={e => setAddEmail(e.target.value)}
              className="bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-600 placeholder-gray-600"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleAddMember}
              disabled={saving || !addName.trim()}
              className="flex items-center gap-2 text-sm bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add Member'}
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="text-sm text-gray-500 hover:text-gray-300 px-3 py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {members.length > 0 ? (
        <div className="space-y-3">
          {members.map(member => (
            <div key={member.id} className="rounded-xl border border-gray-700/30 bg-gray-800/20 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-sm">{member.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${member.role === 'lead' ? 'text-purple-400 border-purple-700/40 bg-purple-900/10' : 'text-cyan-400 border-cyan-700/40 bg-cyan-900/10'}`}>
                      {member.role}
                    </span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {member.phone && <p className="text-gray-500 text-xs">{member.phone}</p>}
                    {member.email && <p className="text-gray-500 text-xs">{member.email}</p>}
                    {!member.user_id && (
                      <p className="text-yellow-600 text-xs">Account not linked yet</p>
                    )}
                  </div>
                </div>

                {member.invite_token && (
                  <button
                    onClick={() => handleCopyInviteLink(member.invite_token!)}
                    className="flex-shrink-0 flex items-center gap-1.5 text-xs bg-gray-700/30 hover:bg-gray-700/60 text-gray-400 border border-gray-700/40 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {copiedToken === member.invite_token ? (
                      <><CheckCircle size={12} className="text-emerald-400" /><span className="text-emerald-400">Copied!</span></>
                    ) : (
                      <><UserPlus size={12} />Invite Link</>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
          <Users size={36} className="text-gray-600/40" />
          <p className="text-gray-500 text-sm">No crew members yet. Add one above to generate an invite link.</p>
        </div>
      )}
    </div>
  )
}

// ── Role Gate ─────────────────────────────────────────────────────────────────

function AccessRestricted() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-24 px-6">
      <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center">
        <Lock size={28} className="text-gray-500" />
      </div>
      <div>
        <h3 className="text-white font-semibold text-base mb-1">Access restricted</h3>
        <p className="text-gray-500 text-sm max-w-xs mx-auto">
          The GUARDIAN panel is only available to owners and admins. Contact the account owner if you need access.
        </p>
      </div>
    </div>
  )
}

// ── Guardian Panel ────────────────────────────────────────────────────────────

type TabId = 'activity' | 'pending' | 'all-logs' | 'crew-members'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'activity', label: 'Activity Feed', icon: <Activity size={14} /> },
  { id: 'pending', label: 'Pending Review', icon: <ShieldAlert size={14} /> },
  { id: 'all-logs', label: 'All Logs', icon: <ClipboardList size={14} /> },
  { id: 'crew-members', label: 'Crew Members', icon: <Users size={14} /> },
]

export function GuardianPanel() {
  const { isDemoMode } = useDemoMode()
  const [activeTab, setActiveTab] = useState<TabId>('activity')
  const { isAdmin, isOwner, isOwnerRole } = useAuth()

  // Listen for poweron:show-guardian event from NEXUS
  useEffect(() => {
    function handleShow() {
      setActiveTab('activity')
    }
    window.addEventListener('poweron:show-guardian', handleShow)
    return () => window.removeEventListener('poweron:show-guardian', handleShow)
  }, [])

  // Part 4: Role-based access gate
  const canAccess = isOwner || isAdmin || isOwnerRole
  if (!canAccess) {
    return (
      <div className="flex flex-col h-full bg-gray-900 text-white">
        <div className="px-6 pt-6 pb-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <ShieldAlert className="text-emerald-400" size={20} />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">GUARDIAN</h2>
              <p className="text-gray-500 text-xs">Crew monitoring · Audit trail · Anomaly detection</p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <AccessRestricted />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/15 flex items-center justify-center">
            <ShieldAlert className="text-emerald-400" size={20} />
          </div>
          <div>
            <h2 className="text-white font-bold text-lg">GUARDIAN</h2>
            <p className="text-gray-500 text-xs">Crew monitoring · Audit trail · Anomaly detection</p>
          </div>
        </div>
        {isDemoMode && (
          <div className="mt-3 px-3 py-2 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-medium">
            ⚠ Demo Mode active — system logs shown are real session data (Guardian uses live auth, not business data)
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-800 px-4 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 text-xs font-medium px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {activeTab === 'activity'     && <ActivityFeedTab />}
        {activeTab === 'pending'      && <PendingReviewTab />}
        {activeTab === 'all-logs'     && <AllLogsTab />}
        {activeTab === 'crew-members' && <CrewMembersTab />}
      </div>
    </div>
  )
}
