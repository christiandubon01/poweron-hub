// @ts-nocheck
/**
 * GuardianPanel — Crew activity monitoring, audit trail, and anomaly flagging.
 *
 * Tabs:
 *   Pending Review — flagged unreviewed logs
 *   All Logs       — full list with filters
 *   Crew Members   — manage crew, add members, generate invite links
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
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  reviewPendingLogs,
  markLogReviewed,
  markAllLogsReviewed,
  type CrewFieldLog,
  type Flag,
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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
      {/* Header */}
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

      {/* Work Description */}
      <p className="text-gray-400 text-xs leading-relaxed line-clamp-3">
        {log.work_description}
      </p>

      {/* Flags */}
      {hasFlagsToShow && (
        <div className="flex flex-wrap gap-1.5">
          {log.flags.map((flag, i) => (
            <FlagBadge key={i} flag={flag} />
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
      setFlaggedLogs(result.flagged)
      setCleanLogs(result.clean)
      setSummary(result.summary)
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
      {/* Summary bar */}
      <div className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 ${flaggedLogs.length > 0 ? 'bg-amber-900/20 border border-amber-700/30' : 'bg-emerald-900/20 border border-emerald-700/30'}`}>
        <div className="flex items-center gap-2">
          {flaggedLogs.length > 0 ? (
            <ShieldAlert size={16} className="text-amber-400 flex-shrink-0" />
          ) : (
            <ShieldCheck size={16} className="text-emerald-400 flex-shrink-0" />
          )}
          <span className={`text-sm ${flaggedLogs.length > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
            {summary}
          </span>
        </div>

        {flaggedLogs.length > 0 && (
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

      {/* Flagged logs */}
      {flaggedLogs.length > 0 ? (
        <div className="space-y-3">
          {flaggedLogs.map(log => (
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
      {/* Filters */}
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

      {/* Log count */}
      <p className="text-gray-600 text-xs">{filtered.length} log{filtered.length !== 1 ? 's' : ''}</p>

      {/* Logs */}
      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map(log => (
            <div key={log.id} className="relative">
              {/* Reviewed / flagged indicator */}
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

      // Generate a proper UUID invite token
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
    // Use /invite/:token path (matches InviteAccept route in App.tsx)
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
      {/* Add crew button */}
      <button
        onClick={() => setShowAddForm(v => !v)}
        className="flex items-center gap-2 text-sm bg-emerald-700/20 hover:bg-emerald-700/40 text-emerald-400 border border-emerald-700/30 px-4 py-2 rounded-lg transition-colors w-full justify-center"
      >
        <UserPlus size={15} />
        Add Crew Member
      </button>

      {/* Add form */}
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

      {/* Member list */}
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
                    {member.phone && (
                      <p className="text-gray-500 text-xs">{member.phone}</p>
                    )}
                    {member.email && (
                      <p className="text-gray-500 text-xs">{member.email}</p>
                    )}
                    {!member.user_id && (
                      <p className="text-yellow-600 text-xs">Account not linked yet</p>
                    )}
                  </div>
                </div>

                {/* Invite link */}
                {member.invite_token && (
                  <button
                    onClick={() => handleCopyInviteLink(member.invite_token!)}
                    className="flex-shrink-0 flex items-center gap-1.5 text-xs bg-gray-700/30 hover:bg-gray-700/60 text-gray-400 border border-gray-700/40 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {copiedToken === member.invite_token ? (
                      <>
                        <CheckCircle size={12} className="text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <UserPlus size={12} />
                        Invite Link
                      </>
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

// ── Guardian Panel ────────────────────────────────────────────────────────────

type TabId = 'pending' | 'all-logs' | 'crew-members'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'pending', label: 'Pending Review', icon: <ShieldAlert size={14} /> },
  { id: 'all-logs', label: 'All Logs', icon: <ClipboardList size={14} /> },
  { id: 'crew-members', label: 'Crew Members', icon: <Users size={14} /> },
]

export function GuardianPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('pending')

  // Listen for poweron:show-guardian event from NEXUS
  useEffect(() => {
    function handleShow() {
      // Panel is already rendered when this fires; just ensure we're on pending tab
      setActiveTab('pending')
    }
    window.addEventListener('poweron:show-guardian', handleShow)
    return () => window.removeEventListener('poweron:show-guardian', handleShow)
  }, [])

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
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-800 px-4">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 text-xs font-medium px-4 py-3 border-b-2 transition-colors ${
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
        {activeTab === 'pending' && <PendingReviewTab />}
        {activeTab === 'all-logs' && <AllLogsTab />}
        {activeTab === 'crew-members' && <CrewMembersTab />}
      </div>
    </div>
  )
}
