// @ts-nocheck
/**
 * MorningBriefingCard — Rendered in NEXUS chat when the daily briefing
 * is detected in agent_messages (metadata.type === 'daily_briefing').
 *
 * Shows a formatted summary card with stats, schedule, and alerts.
 */

import { Sun, TrendingUp, Calendar, AlertTriangle, Clock } from 'lucide-react'

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
