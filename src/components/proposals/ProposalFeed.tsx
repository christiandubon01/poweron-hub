// @ts-nocheck
/**
 * ProposalFeed — list of active SCOUT proposals.
 *
 * Pulls from agent_proposals where status='proposed', sorted by
 * impact_score descending. Supports confirm, skip, and view details actions.
 */

import { useState, useEffect, useCallback } from 'react'
import { Activity, RefreshCw, Loader2, Inbox, Flag, Clipboard, X, CheckCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'
import { useAuth } from '@/hooks/useAuth'
import { runScoutAnalysis, type ScoutRunResult } from '@/agents/scout'
import { ProposalCard, type Proposal } from './ProposalCard'
import {
  getScoutQueue,
  updateQueueEntryStatus,
  removeFromScoutQueue,
  formatAsCoworkPrompt,
  type ScoutQueueEntry,
} from '@/services/scoutQueue'

// ── Tab type ─────────────────────────────────────────────────────────────────
type FeedTab = 'proposals' | 'queue'

// ── Component ───────────────────────────────────────────────────────────────

export function ProposalFeed() {
  const { profile }                       = useAuth()
  const [proposals, setProposals]         = useState<Proposal[]>([])
  const [loading, setLoading]             = useState(true)
  const [running, setRunning]             = useState(false)
  const [lastRun, setLastRun]             = useState<ScoutRunResult | null>(null)
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)
  // FIX 3 — Queue viewer state
  const [activeTab, setActiveTab]         = useState<FeedTab>('proposals')
  const [queueItems, setQueueItems]       = useState<ScoutQueueEntry[]>([])
  const [copiedId, setCopiedId]           = useState<string | null>(null)

  const orgId = profile?.org_id

  // ── Load queue from localStorage ───────────────────────────────────────
  const refreshQueue = useCallback(() => {
    setQueueItems(getScoutQueue())
  }, [])

  useEffect(() => {
    refreshQueue()
    // Refresh whenever the tab becomes active
  }, [activeTab, refreshQueue])

  // ── Fetch proposals ───────────────────────────────────────────────────
  const fetchProposals = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const { data, error: fetchError } = await supabase
        .from('agent_proposals')
        .select('id, title, description, category, impact_score, risk_score, proposing_agent, source_data, mirofish_step, status, created_at')
        .eq('org_id', orgId)
        .eq('status', 'proposed')
        .order('impact_score', { ascending: false })
        .limit(20)

      if (fetchError) throw fetchError
      setProposals((data as Proposal[]) ?? [])
    } catch (err) {
      console.error('[ProposalFeed] Fetch error:', err)
      setError('Failed to load proposals')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchProposals()
  }, [fetchProposals])

  // ── Trigger SCOUT run ─────────────────────────────────────────────────
  const triggerScoutRun = async () => {
    if (!orgId || running) return
    setRunning(true)
    setError(null)

    try {
      const result = await runScoutAnalysis(orgId)
      setLastRun(result)
      // Refresh the list
      await fetchProposals()
    } catch (err) {
      console.error('[ProposalFeed] SCOUT run failed:', err)
      setError(err instanceof Error ? err.message : 'SCOUT analysis failed')
    } finally {
      setRunning(false)
    }
  }

  // ── Confirm proposal ──────────────────────────────────────────────────
  const confirmProposal = async (proposalId: string) => {
    if (!profile) return
    try {
      await supabase
        .from('agent_proposals')
        .update({
          status:       'confirmed',
          confirmed_by: profile.id,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', proposalId)

      await logAudit({
        action:      'approve',
        entity_type: 'agent_proposals',
        entity_id:   proposalId,
        description: `Proposal confirmed by ${profile.full_name}`,
      })

      setProposals(prev => prev.filter(p => p.id !== proposalId))
    } catch (err) {
      console.error('[ProposalFeed] Confirm failed:', err)
    }
  }

  // ── Skip proposal ────────────────────────────────────────────────────
  const skipProposal = async (proposalId: string) => {
    try {
      await supabase
        .from('agent_proposals')
        .update({ status: 'skipped' })
        .eq('id', proposalId)

      await logAudit({
        action:      'reject',
        entity_type: 'agent_proposals',
        entity_id:   proposalId,
        description: `Proposal skipped by ${profile?.full_name}`,
      })

      setProposals(prev => prev.filter(p => p.id !== proposalId))
    } catch (err) {
      console.error('[ProposalFeed] Skip failed:', err)
    }
  }

  // ── View details ──────────────────────────────────────────────────────
  const viewDetails = (proposalId: string) => {
    setSelectedId(selectedId === proposalId ? null : proposalId)
  }

  // ── Queue actions (FIX 3) ─────────────────────────────────────────────

  /** Dismiss a queue entry (mark as dismissed + remove after a brief delay). */
  const handleDismiss = (id: string) => {
    updateQueueEntryStatus(id, 'dismissed')
    // Remove from view immediately
    setTimeout(() => {
      removeFromScoutQueue(id)
      refreshQueue()
    }, 300)
    setQueueItems(prev => prev.filter(e => e.id !== id))
  }

  /** Mark reviewed + copy the Cowork prompt to clipboard. */
  const handleConvertToSession = async (entry: ScoutQueueEntry) => {
    const prompt = formatAsCoworkPrompt(entry)
    try {
      await navigator.clipboard.writeText(prompt)
      updateQueueEntryStatus(entry.id, 'reviewed')
      setQueueItems(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'reviewed' } : e))
      setCopiedId(entry.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // Clipboard may fail in some environments — still mark reviewed
      updateQueueEntryStatus(entry.id, 'reviewed')
      setQueueItems(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'reviewed' } : e))
    }
  }

  // ── Selected proposal detail panel ────────────────────────────────────
  const selectedProposal = proposals.find(p => p.id === selectedId)

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-bg-4 bg-bg-1/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-subtle border border-[rgba(255,80,96,0.25)] flex items-center justify-center">
            <Activity className="w-4 h-4 text-scout" />
          </div>
          <div>
            <div className="text-sm font-bold text-text-1">SCOUT Proposals</div>
            <div className="text-[10px] text-text-3 font-mono">
              {proposals.length} active · MiroFish verified
            </div>
          </div>
        </div>

        <button
          onClick={triggerScoutRun}
          disabled={running}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
            running
              ? 'bg-bg-3 text-text-4 cursor-not-allowed'
              : 'bg-scout/10 border border-[rgba(255,80,96,0.25)] text-scout hover:bg-scout/20'
          )}
        >
          {running
            ? <><Loader2 size={12} className="animate-spin" /> Running...</>
            : <><RefreshCw size={12} /> Run SCOUT</>
          }
        </button>
      </div>

      {/* FIX 3 — Tab switcher: Proposals vs Flagged Improvements */}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-bg-4 bg-bg-1/60">
        <button
          onClick={() => setActiveTab('proposals')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all',
            activeTab === 'proposals'
              ? 'bg-scout/10 border border-[rgba(255,80,96,0.25)] text-scout'
              : 'text-text-3 hover:text-text-1'
          )}
        >
          <Activity size={11} />
          Proposals
          {proposals.length > 0 && (
            <span className="ml-1 px-1 py-0.5 rounded bg-scout/20 text-scout text-[9px] font-mono">
              {proposals.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setActiveTab('queue'); refreshQueue() }}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all',
            activeTab === 'queue'
              ? 'bg-scout/10 border border-[rgba(255,80,96,0.25)] text-scout'
              : 'text-text-3 hover:text-text-1'
          )}
        >
          <Flag size={11} />
          Flagged Improvements
          {queueItems.filter(e => e.status === 'pending').length > 0 && (
            <span className="ml-1 px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-mono">
              {queueItems.filter(e => e.status === 'pending').length}
            </span>
          )}
        </button>
      </div>

      {/* Last run summary */}
      {lastRun && (
        <div className="mx-5 mt-3 px-4 py-2.5 rounded-lg bg-bg-2 border border-bg-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-text-3">
              Last run: {lastRun.rawProposals.length} analyzed · {lastRun.verifiedCount} proposed · {lastRun.rejectedCount} rejected · {lastRun.durationMs}ms
            </span>
            <button onClick={() => setLastRun(null)} className="text-text-4 hover:text-text-3 text-xs">✕</button>
          </div>
          {lastRun.rejections.length > 0 && (
            <div className="mt-2 space-y-1">
              {lastRun.rejections.slice(0, 3).map((r, i) => (
                <div key={i} className="text-[10px] text-text-4 font-mono truncate">
                  ✕ {r.title.slice(0, 60)} — {r.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-5 mt-3 px-4 py-2 rounded-lg bg-red-subtle border border-[rgba(255,80,96,0.25)] text-xs text-red flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hover:text-text-1 text-xs">✕</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── FIX 3: Flagged Improvements Queue tab ──────────────────────── */}
        {activeTab === 'queue' && (
          <div className="px-5 py-4 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-text-1 uppercase tracking-wider">
                Flagged Improvements
              </div>
              <button
                onClick={refreshQueue}
                className="text-[10px] text-text-4 hover:text-text-2 flex items-center gap-1"
              >
                <RefreshCw size={10} /> Refresh
              </button>
            </div>

            {queueItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-12 h-12 rounded-xl bg-bg-2 border border-bg-4 flex items-center justify-center mb-3">
                  <Flag className="w-6 h-6 text-text-4" />
                </div>
                <p className="text-xs text-text-3 max-w-xs">
                  No flagged improvements yet. When SCOUT detects improvement ideas during your conversations,
                  they'll appear here silently for your review.
                </p>
              </div>
            ) : (
              queueItems.map(entry => (
                <div
                  key={entry.id}
                  className={clsx(
                    'rounded-xl border p-4 transition-all',
                    entry.status === 'pending'
                      ? 'bg-bg-2 border-bg-4'
                      : entry.status === 'reviewed'
                        ? 'bg-bg-1 border-bg-3 opacity-60'
                        : 'bg-bg-1 border-bg-3 opacity-40'
                  )}
                >
                  {/* Timestamp + status badge */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono text-text-4">
                      {new Date(entry.timestamp).toLocaleString('en-US', {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    <span
                      className={clsx(
                        'px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider',
                        entry.status === 'pending'
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : entry.status === 'reviewed'
                            ? 'bg-green-subtle text-green border border-green-border'
                            : 'bg-bg-3 text-text-4 border border-bg-4'
                      )}
                    >
                      {entry.status}
                    </span>
                  </div>

                  {/* Suggestion text */}
                  <p className="text-xs text-text-1 leading-relaxed mb-2">
                    {entry.suggestion}
                  </p>

                  {/* Original context */}
                  <p className="text-[10px] text-text-4 font-mono mb-3 truncate">
                    Context: "{entry.context.slice(0, 80)}{entry.context.length > 80 ? '…' : ''}"
                  </p>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleConvertToSession(entry)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-bg-3 border border-bg-5 text-text-2 text-[10px] font-bold hover:bg-bg-4 transition-colors min-h-[36px]"
                      title="Copy as Cowork prompt"
                    >
                      {copiedId === entry.id
                        ? <><CheckCircle size={11} className="text-green" /> Copied!</>
                        : <><Clipboard size={11} /> Convert to Session</>
                      }
                    </button>
                    <button
                      onClick={() => handleDismiss(entry.id)}
                      className="flex items-center gap-1 px-3 py-1 rounded-lg text-text-4 text-[10px] hover:text-text-2 hover:bg-bg-3 transition-colors min-h-[36px]"
                      title="Dismiss"
                    >
                      <X size={11} /> Dismiss
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Proposals tab (existing) ─────────────────────────────────── */}
        {activeTab === 'proposals' && (
        <div className="flex gap-4 h-full">
          {/* Proposal list */}
          <div className={clsx('flex-1 px-5 py-4 space-y-3 overflow-y-auto', selectedId && 'max-w-[60%]')}>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={20} className="animate-spin text-text-3" />
              </div>
            ) : proposals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-bg-2 border border-bg-4 flex items-center justify-center mb-4">
                  <Inbox className="w-8 h-8 text-text-4" />
                </div>
                <h3 className="text-sm font-bold text-text-2 mb-2">No active proposals</h3>
                <p className="text-xs text-text-3 max-w-sm mb-4">
                  Run SCOUT to analyze your platform data and generate improvement proposals.
                </p>
                <button
                  onClick={triggerScoutRun}
                  disabled={running}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-scout text-bg font-bold text-xs hover:brightness-110 transition-all"
                >
                  <Activity size={14} />
                  Run Analysis
                </button>
              </div>
            ) : (
              proposals.map(p => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  onConfirm={confirmProposal}
                  onSkip={skipProposal}
                  onViewDetails={viewDetails}
                />
              ))
            )}
          </div>

          {/* Detail panel */}
          {selectedId && selectedProposal && (
            <div className="w-[40%] border-l border-bg-4 bg-bg-1 px-5 py-4 overflow-y-auto animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-text-1">Proposal Details</h3>
                <button onClick={() => setSelectedId(null)} className="text-text-4 hover:text-text-2 text-xs">✕</button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1">Title</div>
                  <div className="text-sm text-text-1 font-semibold">{selectedProposal.title}</div>
                </div>

                <div>
                  <div className="text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1">Description</div>
                  <div className="text-xs text-text-2 leading-relaxed">{selectedProposal.description}</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1">Impact</div>
                    <div className="text-lg font-bold text-blue">{Math.round(selectedProposal.impact_score * 10)}/10</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1">Risk</div>
                    <div className="text-lg font-bold text-red">{Math.round(selectedProposal.risk_score * 10)}/10</div>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1">Category</div>
                  <div className="text-xs text-text-2">{selectedProposal.category}</div>
                </div>

                <div>
                  <div className="text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1">MiroFish Verification</div>
                  <div className="text-xs text-green font-mono">
                    Passed {selectedProposal.mirofish_step}/5 steps ✓
                  </div>
                </div>

                {selectedProposal.source_data && Object.keys(selectedProposal.source_data).length > 0 && (
                  <div>
                    <div className="text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1">Source Data</div>
                    <pre className="text-[10px] text-text-3 font-mono bg-bg-3 rounded-lg p-3 overflow-x-auto max-h-48">
                      {JSON.stringify(selectedProposal.source_data, null, 2)}
                    </pre>
                  </div>
                )}

                <div>
                  <div className="text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1">Created</div>
                  <div className="text-xs text-text-3 font-mono">
                    {new Date(selectedProposal.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        )} {/* end activeTab === 'proposals' */}

      </div>
    </div>
  )
}
