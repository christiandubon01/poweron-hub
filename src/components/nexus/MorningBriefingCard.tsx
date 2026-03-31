// @ts-nocheck
/**
 * MorningBriefingCard — Rendered in NEXUS chat when the daily briefing
 * is detected in agent_messages (metadata.type === 'daily_briefing').
 *
 * Shows a formatted summary card with stats, schedule, and alerts.
 * Includes GUARDIAN section for crew log review status.
 */

import { useEffect, useState } from 'react'
import { Sun, TrendingUp, Calendar, AlertTriangle, Clock, ShieldAlert, ShieldCheck, BookOpen } from 'lucide-react'
import { reviewPendingLogs, type CrewFieldLog } from '@/agents/guardian'
import { getJournalSummary } from '@/services/voiceJournalService'

interface BriefingStats {
  field_logs: number
  total_hours: number
  total_materials: number
  active_projects: number
  overdue_invoices: number
}

interface MorningBriefingCardProps {
  content: string
  metadata: {
    date: string
    stats: BriefingStats
  }
}

// ── GUARDIAN Section ──────────────────────────────────────────────────────────

interface GuardianBriefingState {
  loading: boolean
  flaggedLogs: CrewFieldLog[]
  allClear: boolean
  error: boolean
}

function GuardianBriefingSection() {
  const [state, setState] = useState<GuardianBriefingState>({
    loading: true,
    flaggedLogs: [],
    allClear: false,
    error: false,
  })

  useEffect(() => {
    let cancelled = false

    reviewPendingLogs()
      .then(result => {
        if (cancelled) return
        setState({
          loading: false,
          flaggedLogs: result.flagged,
          allClear: result.flagged.length === 0,
          error: false,
        })
      })
      .catch(err => {
        console.warn('[MorningBriefingCard] GUARDIAN section failed:', err)
        if (!cancelled) {
          setState({ loading: false, flaggedLogs: [], allClear: true, error: true })
        }
      })

    return () => { cancelled = true }
  }, [])

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-xs py-1">
        <div className="w-3 h-3 rounded-full bg-gray-600 animate-pulse" />
        Checking crew logs…
      </div>
    )
  }

  if (state.error) {
    return null
  }

  if (state.allClear) {
    return (
      <div className="flex items-center gap-2 text-emerald-400 text-xs">
        <ShieldCheck size={14} />
        <span>Crew logs — all clear</span>
      </div>
    )
  }

  // Build flag lines — max 3 shown
  const displayed = state.flaggedLogs.slice(0, 3)
  return (
    <div className="rounded-lg border border-amber-700/30 bg-amber-900/10 p-3 space-y-1.5">
      <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold">
        <ShieldAlert size={14} />
        Crew review needed ({state.flaggedLogs.length})
      </div>
      {displayed.map(log => {
        const topFlag = [...log.flags].sort((a, b) => {
          const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
          return (order[a.severity] ?? 3) - (order[b.severity] ?? 3)
        })[0]
        const job = log.job_reference || 'no job reference'
        const flagLabel = topFlag
          ? topFlag.type.toLowerCase().replace(/_/g, ' ')
          : 'flagged'
        return (
          <div key={log.id} className="text-gray-400 text-xs pl-2 border-l border-amber-700/40">
            • <span className="text-gray-300">{log.crew_name}</span> — {flagLabel} on {job}
          </div>
        )
      })}
      {state.flaggedLogs.length > 3 && (
        <div className="text-gray-500 text-xs pl-2">
          +{state.flaggedLogs.length - 3} more — open Guardian to review
        </div>
      )}
    </div>
  )
}

// ── Journal Section ───────────────────────────────────────────────────────────

function JournalBriefingSection() {
  const [lines, setLines] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    getJournalSummary(24)
      .then(summary => {
        if (cancelled) return
        // Extract only action item lines (after the header line)
        const allLines = summary.split('\n').filter(Boolean)
        // First line is the header ("In the last 24 hours…"); skip it
        const actionLines = allLines.slice(1).filter(l => l.trim().length > 0)
        if (actionLines.length > 0) {
          setLines(actionLines)
        }
        setLoaded(true)
      })
      .catch(err => {
        console.warn('[MorningBriefingCard] Journal section failed:', err)
        if (!cancelled) setLoaded(true)
      })

    return () => { cancelled = true }
  }, [])

  if (!loaded || lines.length === 0) return null

  return (
    <div className="rounded-lg border border-emerald-700/30 bg-emerald-900/10 p-3 space-y-1.5">
      <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
        <BookOpen size={13} />
        Yesterday&apos;s notes ({lines.length})
      </div>
      {lines.slice(0, 5).map((line, i) => (
        <div key={i} className="text-gray-400 text-xs pl-2 border-l border-emerald-700/40">
          • {line}
        </div>
      ))}
    </div>
  )
}

// ── Main Card ─────────────────────────────────────────────────────────────────

export function MorningBriefingCard({ content, metadata }: MorningBriefingCardProps) {
  const { stats } = metadata
  const dateLabel = new Date(metadata.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="rounded-xl bg-gradient-to-br from-emerald-900/30 to-gray-800/50 border border-emerald-700/30 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
          <Sun className="text-emerald-400" size={22} />
        </div>
        <div>
          <h3 className="text-white font-bold text-sm">Morning Briefing</h3>
          <p className="text-emerald-400/70 text-xs">{dateLabel}</p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatChip
          icon={<Clock size={14} />}
          label="Hours Logged"
          value={stats.total_hours.toFixed(1)}
          color="text-cyan-400"
        />
        <StatChip
          icon={<TrendingUp size={14} />}
          label="Active Projects"
          value={String(stats.active_projects)}
          color="text-emerald-400"
        />
        <StatChip
          icon={<Calendar size={14} />}
          label="Field Logs"
          value={String(stats.field_logs)}
          color="text-purple-400"
        />
        {stats.overdue_invoices > 0 && (
          <StatChip
            icon={<AlertTriangle size={14} />}
            label="Overdue"
            value={String(stats.overdue_invoices)}
            color="text-red-400"
          />
        )}
      </div>

      {/* GUARDIAN Crew Section */}
      <GuardianBriefingSection />

      {/* Voice Journal — yesterday's notes */}
      <JournalBriefingSection />

      {/* Briefing Text */}
      <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
        {content.replace(/\*\*/g, '').replace(/^Good morning!.*\n\n/, '')}
      </div>
    </div>
  )
}

function StatChip({ icon, label, value, color }: {
  icon: React.ReactNode
  label: string
  value: string
  color: string
}) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-2.5 border border-gray-700/30">
      <div className={`flex items-center gap-1.5 ${color}`}>
        {icon}
        <span className="text-lg font-bold">{value}</span>
      </div>
      <p className="text-gray-500 text-[10px] mt-0.5">{label}</p>
    </div>
  )
}
