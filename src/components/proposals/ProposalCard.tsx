/**
 * ProposalCard — displays a single SCOUT proposal with impact/risk scores,
 * source agent badge, and action buttons.
 */

import { clsx } from 'clsx'
import { TrendingUp, AlertTriangle, Eye, Check, SkipForward } from 'lucide-react'
import { AgentBadge } from '@/components/nexus/MessageBubble'
import type { ProposalCategory } from '@/agents/scout'

// ── Types ───────────────────────────────────────────────────────────────────

export interface Proposal {
  id:              string
  title:           string
  description:     string
  category:        ProposalCategory | string
  impact_score:    number  // 0-1 from DB (displayed as 1-10)
  risk_score:      number  // 0-1 from DB (displayed as 1-10)
  proposing_agent: string
  source_data:     Record<string, unknown> | null
  mirofish_step:   number
  status:          string
  created_at:      string
}

export interface ProposalCardProps {
  proposal:      Proposal
  onConfirm:     (id: string) => void
  onSkip:        (id: string) => void
  onViewDetails: (id: string) => void
}

// ── Category labels & colors ────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, { label: string; color: string }> = {
  operations:   { label: 'Operations',   color: 'text-blue' },
  financial:    { label: 'Financial',    color: 'text-gold' },
  scheduling:   { label: 'Scheduling',   color: 'text-chrono' },
  compliance:   { label: 'Compliance',   color: 'text-lime' },
  relationship: { label: 'Relationship', color: 'text-spark' },
  pricing:      { label: 'Pricing',      color: 'text-vault' },
  staffing:     { label: 'Staffing',     color: 'text-purple' },
}

// ── Score bar helper ────────────────────────────────────────────────────────

function ScoreBar({ label, value, max = 10, color }: {
  label: string; value: number; max?: number; color: string
}) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-text-3 w-12 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-bg-4 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-mono font-bold text-text-2 w-6 text-right">
        {value.toFixed(0)}
      </span>
    </div>
  )
}


// ── Component ───────────────────────────────────────────────────────────────

export function ProposalCard({ proposal, onConfirm, onSkip, onViewDetails }: ProposalCardProps) {
  // DB stores 0-1, display as 1-10
  const impact = Math.round(proposal.impact_score * 10)
  const risk   = Math.round(proposal.risk_score * 10)

  const categoryStyle = CATEGORY_STYLES[proposal.category] ?? { label: proposal.category, color: 'text-text-3' }
  const isHighImpact  = impact >= 8
  const isHighRisk    = risk >= 8
  const timeAgo       = getTimeAgo(proposal.created_at)

  return (
    <div className={clsx(
      'rounded-xl border p-4 transition-all duration-200 hover:shadow-card animate-fade-in',
      isHighRisk
        ? 'bg-red-subtle border-[rgba(255,80,96,0.20)]'
        : isHighImpact
          ? 'bg-[rgba(58,142,255,0.06)] border-[rgba(58,142,255,0.20)]'
          : 'bg-bg-2 border-bg-4'
    )}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={clsx('text-[10px] font-mono font-bold uppercase tracking-wider', categoryStyle.color)}>
              {categoryStyle.label}
            </span>
            <AgentBadge agentId={proposal.proposing_agent} />
            <span className="text-[10px] font-mono text-text-4">{timeAgo}</span>
          </div>
          <h4 className="text-sm font-bold text-text-1 leading-snug">
            {proposal.title}
          </h4>
        </div>

        {/* Impact/Risk quick glance */}
        <div className="flex items-center gap-1 shrink-0">
          <div className={clsx(
            'flex items-center gap-1 px-2 py-1 rounded-lg',
            isHighImpact ? 'bg-blue-subtle' : 'bg-bg-3'
          )}>
            <TrendingUp size={12} className={isHighImpact ? 'text-blue' : 'text-text-3'} />
            <span className={clsx('text-[10px] font-mono font-bold', isHighImpact ? 'text-blue' : 'text-text-3')}>
              {impact}
            </span>
          </div>
          <div className={clsx(
            'flex items-center gap-1 px-2 py-1 rounded-lg',
            isHighRisk ? 'bg-red-subtle' : 'bg-bg-3'
          )}>
            <AlertTriangle size={12} className={isHighRisk ? 'text-red' : 'text-text-3'} />
            <span className={clsx('text-[10px] font-mono font-bold', isHighRisk ? 'text-red' : 'text-text-3')}>
              {risk}
            </span>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-text-2 leading-relaxed mb-3">
        {proposal.description}
      </p>

      {/* Score bars */}
      <div className="space-y-1.5 mb-4">
        <ScoreBar label="Impact" value={impact} color={impact >= 8 ? 'bg-blue' : impact >= 5 ? 'bg-blue/60' : 'bg-bg-5'} />
        <ScoreBar label="Risk" value={risk} color={risk >= 8 ? 'bg-red' : risk >= 5 ? 'bg-orange/60' : 'bg-bg-5'} />
      </div>

      {/* MiroFish badge */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[9px] font-mono text-text-4 bg-bg-3 rounded px-1.5 py-0.5">
          MiroFish {proposal.mirofish_step}/5 ✓
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onConfirm(proposal.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green text-bg font-bold text-xs hover:brightness-110 transition-all"
        >
          <Check size={12} />
          Confirm
        </button>
        <button
          onClick={() => onSkip(proposal.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-3 border border-bg-5 text-text-3 font-bold text-xs hover:bg-bg-4 hover:text-text-2 transition-colors"
        >
          <SkipForward size={12} />
          Skip
        </button>
        <button
          onClick={() => onViewDetails(proposal.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-3 border border-bg-5 text-text-3 font-bold text-xs hover:bg-bg-4 hover:text-text-2 transition-colors ml-auto"
        >
          <Eye size={12} />
          Details
        </button>
      </div>
    </div>
  )
}


// ── Time helper ─────────────────────────────────────────────────────────────

function getTimeAgo(isoDate: string): string {
  const mins = Math.floor((Date.now() - new Date(isoDate).getTime()) / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
