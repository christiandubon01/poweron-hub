// @ts-nocheck
/**
 * ProposalQueue — Mobile-first card queue for MiroFish proposals.
 *
 * Shows pending + deferred proposals with one-tap approve/reject/defer.
 * Inline confirmation (no modals). Collapsible history section.
 * Accessible from NEXUS panel and Settings.
 */

import { useState, useEffect, useCallback } from 'react'
import { Check, X, Clock, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react'
import {
  getPendingProposals,
  getProposalHistory,
  confirmProposal,
  rejectByUser,
  deferProposal,
  type MiroFishProposal,
} from '@/services/miroFish'
import { useAuth } from '@/hooks/useAuth'

// ── Impact badge colors ─────────────────────────────────────────────────────

const IMPACT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  high:     { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', border: 'rgba(239,68,68,0.3)' },
  critical: { bg: 'rgba(239,68,68,0.18)', text: '#ef4444', border: 'rgba(239,68,68,0.4)' },
  medium:   { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
  low:      { bg: 'rgba(20,184,166,0.12)', text: '#14b8a6', border: 'rgba(20,184,166,0.3)' },
}

// ── Step Indicator ──────────────────────────────────────────────────────────

function StepDots({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map(step => (
        <div
          key={step}
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: step <= current ? '#8b5cf6' : 'rgba(255,255,255,0.15)',
            transition: 'background 0.2s',
          }}
        />
      ))}
      <span style={{ fontSize: '8px', color: '#9ca3af', marginLeft: '4px', fontFamily: 'monospace' }}>
        {current}/5
      </span>
    </div>
  )
}

// ── Proposal Card ───────────────────────────────────────────────────────────

interface ProposalCardProps {
  proposal: MiroFishProposal
  onApprove: (id: string) => Promise<void>
  onReject: (id: string, reason: string) => Promise<void>
  onDefer: (id: string) => Promise<void>
}

function ProposalCard({ proposal, onApprove, onReject, onDefer }: ProposalCardProps) {
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [loading, setLoading] = useState(false)

  const impact = IMPACT_COLORS[proposal.impactLevel] || IMPACT_COLORS.medium

  const handleApproveConfirm = async () => {
    setLoading(true)
    await onApprove(proposal.id!)
    setLoading(false)
    setConfirming(null)
  }

  const handleRejectConfirm = async () => {
    if (!rejectReason.trim()) return
    setLoading(true)
    await onReject(proposal.id!, rejectReason.trim())
    setLoading(false)
    setConfirming(null)
    setRejectReason('')
  }

  const buttonBase = {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    borderRadius: '8px',
    padding: '5px 9px',
    fontSize: '10px',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  } as const

  return (
    <div style={{
      background: 'rgba(15,23,42,0.78)',
      border: '1px solid rgba(34,211,238,0.10)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.025)',
      borderRadius: '10px',
      padding: '9px 10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px', flexWrap: 'wrap' }}>
        <span style={{
          background: impact.bg,
          color: impact.text,
          border: `1px solid ${impact.border}`,
          fontSize: '8px',
          fontWeight: 800,
          padding: '2px 8px',
          borderRadius: '999px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          {proposal.impactLevel}
        </span>

        <span style={{
          background: 'rgba(34,211,238,0.10)',
          color: '#67e8f9',
          border: '1px solid rgba(34,211,238,0.18)',
          fontSize: '8px',
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: '999px',
        }}>
          {proposal.proposingAgent?.toUpperCase?.() || 'AI'}
        </span>

        <StepDots current={proposal.mirofishStep} />

        {proposal.status === 'deferred' && (
          <span style={{
            background: 'rgba(148,163,184,0.12)',
            color: '#94a3b8',
            border: '1px solid rgba(148,163,184,0.16)',
            fontSize: '8px',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: '999px',
          }}>
            deferred
          </span>
        )}
      </div>

      <h4 style={{
        margin: '0 0 6px',
        fontSize: '12px',
        fontWeight: 700,
        color: '#f8fafc',
        lineHeight: '1.18',
      }}>
        {proposal.title}
      </h4>

      <p style={{
        margin: '0 0 8px',
        fontSize: '10px',
        color: '#8794aa',
        lineHeight: '1.3',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {proposal.description}
      </p>

      {confirming === 'approve' ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderTop: '1px solid rgba(34,211,238,0.10)',
          paddingTop: '10px',
        }}>
          <span style={{ fontSize: '11px', color: '#cbd5e1', fontWeight: 700 }}>Mark active?</span>
          <button
            onClick={handleApproveConfirm}
            disabled={loading}
            style={{
              ...buttonBase,
              background: 'rgba(34,197,94,0.95)',
              color: '#052e16',
              border: '1px solid rgba(34,197,94,0.8)',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? '...' : 'Yes'}
          </button>
          <button
            onClick={() => setConfirming(null)}
            style={{
              ...buttonBase,
              background: 'rgba(148,163,184,0.10)',
              color: '#cbd5e1',
              border: '1px solid rgba(148,163,184,0.16)',
            }}
          >
            Cancel
          </button>
        </div>
      ) : confirming === 'reject' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(239,68,68,0.12)', paddingTop: '10px' }}>
          <input
            type="text"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="Reason for rejection..."
            autoFocus
            style={{
              background: 'rgba(15,23,42,0.85)',
              border: '1px solid rgba(239,68,68,0.26)',
              borderRadius: '8px',
              padding: '8px 10px',
              fontSize: '11px',
              color: '#f8fafc',
              outline: 'none',
            }}
            onKeyDown={e => e.key === 'Enter' && handleRejectConfirm()}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleRejectConfirm}
              disabled={loading || !rejectReason.trim()}
              style={{
                ...buttonBase,
                background: 'rgba(239,68,68,0.95)',
                color: 'white',
                border: '1px solid rgba(239,68,68,0.8)',
                opacity: (loading || !rejectReason.trim()) ? 0.5 : 1,
                cursor: (loading || !rejectReason.trim()) ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '...' : 'Confirm Reject'}
            </button>
            <button
              onClick={() => { setConfirming(null); setRejectReason('') }}
              style={{
                ...buttonBase,
                background: 'rgba(148,163,184,0.10)',
                color: '#cbd5e1',
                border: '1px solid rgba(148,163,184,0.16)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setConfirming('approve')}
            style={{
              ...buttonBase,
              background: 'rgba(34,197,94,0.92)',
              color: '#052e16',
              border: '1px solid rgba(34,197,94,0.7)',
            }}
          >
            <Check size={11} /> Active
          </button>
          <button
            onClick={() => setConfirming('reject')}
            style={{
              ...buttonBase,
              background: 'rgba(239,68,68,0.90)',
              color: 'white',
              border: '1px solid rgba(239,68,68,0.7)',
            }}
          >
            <X size={11} /> Reject
          </button>
          <button
            onClick={() => onDefer(proposal.id!)}
            style={{
              ...buttonBase,
              background: 'rgba(148,163,184,0.10)',
              color: '#cbd5e1',
              border: '1px solid rgba(148,163,184,0.16)',
            }}
          >
            <Clock size={11} /> Defer
          </button>
        </div>
      )}
    </div>
  )
}
function HistoryItem({ proposal }: { proposal: MiroFishProposal }) {
  const isApproved = proposal.status === 'confirmed' || proposal.status === 'completed'
  const date = new Date(proposal.createdAt).toLocaleDateString()

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 0',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: isApproved ? '#22c55e' : '#ef4444',
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: 0,
          fontSize: '12px',
          color: '#d1d5db',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {proposal.title}
        </p>
      </div>
      <span style={{
        fontSize: '10px',
        color: isApproved ? '#22c55e' : '#ef4444',
        fontWeight: 600,
        flexShrink: 0,
      }}>
        {isApproved ? 'Approved' : 'Rejected'}
      </span>
      <span style={{ fontSize: '10px', color: '#6b7280', flexShrink: 0 }}>
        {date}
      </span>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export interface ProposalQueueProps {
  /** Override orgId (falls back to auth profile) */
  orgId?: string
  /** Max height of the queue container */
  maxHeight?: string
}

export function ProposalQueue({ orgId: overrideOrgId, maxHeight = '500px' }: ProposalQueueProps) {
  const { user, profile } = useAuth()
  const orgId = overrideOrgId || profile?.org_id || ''
  const userId = user?.id || ''

  const [pending, setPending] = useState<MiroFishProposal[]>([])
  const [history, setHistory] = useState<MiroFishProposal[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [p, h] = await Promise.all([
        getPendingProposals(orgId),
        getProposalHistory(orgId, 10),
      ])
      setPending(p)
      setHistory(h)
    } catch (err) {
      console.error('[ProposalQueue] Load failed:', err)
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleApprove = async (proposalId: string) => {
    await confirmProposal(proposalId, userId)
    await loadData()
  }

  const handleReject = async (proposalId: string, reason: string) => {
    await rejectByUser(proposalId, userId, reason)
    await loadData()
  }

  const handleDefer = async (proposalId: string) => {
    await deferProposal(proposalId, userId)
    await loadData()
  }

  return (
    <div style={{
      maxHeight,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    }}>
      {/* Queue header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 2px',
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '13px',
          fontWeight: 700,
          color: 'white',
        }}>
          Proposal Queue
        </h3>
        {pending.length > 0 && (
          <span style={{
            background: '#8b5cf6',
            color: 'white',
            fontSize: '10px',
            fontWeight: 700,
            borderRadius: '999px',
            padding: '2px 8px',
          }}>
            {pending.length}
          </span>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280', fontSize: '12px' }}>
          Loading proposals...
        </div>
      )}

      {/* Empty state */}
      {!loading && pending.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '24px 16px',
          color: '#6b7280',
        }}>
          <AlertCircle size={24} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>
            No pending proposals.
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#4b5563' }}>
            SCOUT is watching.
          </p>
          <span style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#22c55e',
            marginTop: '8px',
            animation: 'pulse 2s infinite',
          }} />
        </div>
      )}

      {/* Pending proposals */}
      {!loading && pending.map(p => (
        <ProposalCard
          key={p.id}
          proposal={p}
          onApprove={handleApprove}
          onReject={handleReject}
          onDefer={handleDefer}
        />
      ))}

      {/* History section */}
      {history.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <button
            onClick={() => setHistoryOpen(prev => !prev)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '4px 0',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {historyOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Recent History ({history.length})
          </button>
          {historyOpen && (
            <div style={{ paddingLeft: '4px' }}>
              {history.map(p => (
                <HistoryItem key={p.id} proposal={p} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}

