// @ts-nocheck
/**
 * ProposalQueuePanel — Floating panel for MiroFish proposal approvals.
 *
 * Shows pending proposals from all agents that have passed automated review
 * (steps 2+3) and are awaiting human confirmation (step 4).
 *
 * Features:
 * - Floating panel toggled from topbar badge
 * - Badge shows pending count
 * - Approve / Reject buttons per proposal
 * - 24h expiry countdown
 * - Grouped by agent with impact level indicators
 */

import { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck, X, Check, XCircle, Clock, ChevronDown, ChevronUp,
  Zap, AlertTriangle, FileText, RefreshCw
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import {
  getPendingProposals,
  confirmProposal,
  rejectByUser,
  runAutomatedReview,
  expireStaleProposals,
  getPendingCount,
  type MiroFishProposal,
  type ImpactLevel,
} from '@/services/miroFish'

// ── Badge Component (for topbar) ────────────────────────────────────────────

export function ProposalBadge({
  count,
  onClick,
}: {
  count: number
  onClick: () => void
}) {
  if (count === 0) return null

  return (
    <button
      onClick={onClick}
      className="relative flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors text-xs font-medium"
      title={`${count} pending proposal${count !== 1 ? 's' : ''}`}
    >
      <ShieldCheck className="w-3.5 h-3.5" />
      <span>{count}</span>
      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
    </button>
  )
}

// ── Main Panel Component ────────────────────────────────────────────────────

export function ProposalQueuePanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const { profile } = useAuth()
  const [proposals, setProposals]   = useState<MiroFishProposal[]>([])
  const [loading, setLoading]       = useState(false)
  const [actionInFlight, setFlight] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const orgId = profile?.org_id
  const userId = profile?.id

  // ── Fetch pending proposals ─────────────────────────────────────────────
  const fetchProposals = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      // Expire stale proposals first
      await expireStaleProposals(orgId)
      const pending = await getPendingProposals(orgId)
      setProposals(pending)
    } catch (err) {
      console.error('[ProposalQueue] Fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    if (isOpen) fetchProposals()
  }, [isOpen, fetchProposals])

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleApprove = async (proposalId: string) => {
    if (!userId || actionInFlight) return
    setFlight(proposalId)
    try {
      const result = await confirmProposal(proposalId, userId)
      if (result.success) {
        setProposals(prev => prev.filter(p => p.id !== proposalId))
      }
    } catch (err) {
      console.error('[ProposalQueue] Approve error:', err)
    } finally {
      setFlight(null)
    }
  }

  const handleReject = async (proposalId: string) => {
    if (!userId || actionInFlight) return
    setFlight(proposalId)
    try {
      const result = await rejectByUser(proposalId, userId, 'Rejected from proposal queue')
      if (result.success) {
        setProposals(prev => prev.filter(p => p.id !== proposalId))
      }
    } catch (err) {
      console.error('[ProposalQueue] Reject error:', err)
    } finally {
      setFlight(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 pointer-events-auto"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md h-[calc(100vh-4rem)] mt-14 mr-2 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden pointer-events-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 bg-zinc-800/50">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-100">MiroFish Proposals</h2>
            <span className="text-xs text-zinc-500">({proposals.length} pending)</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={fetchProposals}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && proposals.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-zinc-500 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              Loading proposals...
            </div>
          ) : proposals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <ShieldCheck className="w-8 h-8 mb-2 text-zinc-600" />
              <p className="text-sm font-medium">All clear</p>
              <p className="text-xs mt-1">No pending proposals</p>
            </div>
          ) : (
            proposals.map(proposal => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                isExpanded={expandedId === proposal.id}
                onToggle={() => setExpandedId(expandedId === proposal.id ? null : proposal.id!)}
                onApprove={() => handleApprove(proposal.id!)}
                onReject={() => handleReject(proposal.id!)}
                isLoading={actionInFlight === proposal.id}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Proposal Card ───────────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  isExpanded,
  onToggle,
  onApprove,
  onReject,
  isLoading,
}: {
  proposal: MiroFishProposal
  isExpanded: boolean
  onToggle: () => void
  onApprove: () => void
  onReject: () => void
  isLoading: boolean
}) {
  const timeLeft = getTimeLeft(proposal.expiresAt)
  const impactColor = getImpactColor(proposal.impactLevel)
  const agentIcon = getAgentIcon(proposal.proposingAgent)

  return (
    <div className={clsx(
      'rounded-lg border transition-colors',
      impactColor.border,
      impactColor.bg,
    )}>
      {/* Summary row */}
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left"
      >
        <div className={clsx('mt-0.5 p-1 rounded', impactColor.iconBg)}>
          {agentIcon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={clsx('text-[10px] font-bold uppercase tracking-wider', impactColor.label)}>
              {proposal.impactLevel}
            </span>
            <span className="text-[10px] text-zinc-500">
              {proposal.proposingAgent}
            </span>
          </div>
          <p className="text-sm font-medium text-zinc-200 mt-0.5 truncate">
            {proposal.title}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Clock className="w-3 h-3 text-zinc-500" />
            <span className={clsx(
              'text-[10px]',
              timeLeft.urgent ? 'text-red-400' : 'text-zinc-500'
            )}>
              {timeLeft.label}
            </span>
          </div>
        </div>

        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-zinc-500 mt-1 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-500 mt-1 shrink-0" />
        )}
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 border-t border-zinc-700/50">
          <p className="text-xs text-zinc-400 mt-2 mb-3 leading-relaxed">
            {proposal.description}
          </p>

          {/* Step log */}
          {proposal.mirofishLog.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Verification Steps
              </p>
              <div className="space-y-1">
                {proposal.mirofishLog.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={clsx(
                      'w-1.5 h-1.5 rounded-full shrink-0',
                      step.result === 'pass' ? 'bg-emerald-400' :
                      step.result === 'fail' ? 'bg-red-400' : 'bg-zinc-500'
                    )} />
                    <span className="text-zinc-400 truncate">{step.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={onApprove}
              disabled={isLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              Approve
            </button>
            <button
              onClick={onReject}
              disabled={isLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getTimeLeft(expiresAt: string): { label: string; urgent: boolean } {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return { label: 'Expired', urgent: true }

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 0) {
    return { label: `${hours}h ${minutes}m left`, urgent: hours < 2 }
  }
  return { label: `${minutes}m left`, urgent: true }
}

function getImpactColor(level: ImpactLevel) {
  switch (level) {
    case 'critical':
      return {
        border: 'border-red-500/30',
        bg: 'bg-red-500/5',
        iconBg: 'bg-red-500/20',
        label: 'text-red-400',
      }
    case 'high':
      return {
        border: 'border-amber-500/30',
        bg: 'bg-amber-500/5',
        iconBg: 'bg-amber-500/20',
        label: 'text-amber-400',
      }
    case 'medium':
      return {
        border: 'border-blue-500/30',
        bg: 'bg-blue-500/5',
        iconBg: 'bg-blue-500/20',
        label: 'text-blue-400',
      }
    default:
      return {
        border: 'border-zinc-700',
        bg: 'bg-zinc-800/50',
        iconBg: 'bg-zinc-700',
        label: 'text-zinc-400',
      }
  }
}

function getAgentIcon(agent: string) {
  const cls = 'w-3.5 h-3.5 text-zinc-300'
  switch (agent) {
    case 'vault':     return <FileText className={cls} />
    case 'ledger':    return <Zap className={cls} />
    case 'blueprint': return <AlertTriangle className={cls} />
    default:          return <ShieldCheck className={cls} />
  }
}

// ── Hook for topbar badge count ─────────────────────────────────────────────

export function useProposalCount() {
  const { profile } = useAuth()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!profile?.org_id) return

    const fetchCount = async () => {
      const n = await getPendingCount(profile.org_id)
      setCount(n)
    }

    fetchCount()

    // Poll every 60 seconds
    const interval = setInterval(fetchCount, 60_000)
    return () => clearInterval(interval)
  }, [profile?.org_id])

  return count
}
