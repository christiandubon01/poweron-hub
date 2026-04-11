// @ts-nocheck
/**
 * AdminToolsView.tsx — NAV1 | Admin Tools
 *
 * Location: COMMAND → Security & Access → Admin Tools
 * Access: Owner only — uses existing admin gate (b32Role === 'owner'), no new auth.
 *
 * Contains: Agent Intelligence Panel (from Change 4.4)
 *
 * Each agent card shows:
 * - Agent name + tier badge + role description
 * - Vision Completion % progress bar
 * - AI Efficiency Score % progress bar
 * - Last analysis date + "Run Analysis" button
 * - Expandable analysis result panel
 * - 24-hour auto-refresh timestamp
 *
 * NEGOTIATE shown as Absorbed with tooltip and date.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Brain, RefreshCw, ChevronDown, ChevronUp, Clock, Zap, ShieldAlert } from 'lucide-react'

// ─── Agent Seed Data ───────────────────────────────────────────────────────────

interface AgentRecord {
  id: string
  agent_name: string
  tier: number
  vision_completion: number
  ai_efficiency: number
  last_analysis_at: string | null
  analysis_notes: string | null
  is_absorbed: boolean
  absorbed_into: string | null
  absorbed_date: string | null
  role: string
}

const SEED_AGENTS: AgentRecord[] = [
  // Tier 1
  { id: 'nexus',     agent_name: 'NEXUS',     tier: 1, vision_completion: 90,  ai_efficiency: 78, last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Admin voice, morning brief, command center' },
  // Tier 2
  { id: 'spark',     agent_name: 'SPARK',     tier: 2, vision_completion: 90,  ai_efficiency: 75, last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Sales co-pilot, call transcription, AirPods alerts' },
  { id: 'hunter',   agent_name: 'HUNTER',   tier: 2, vision_completion: 100, ai_efficiency: 88, last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Lead generation, web scraping, scoring' },
  { id: 'vault',    agent_name: 'VAULT',    tier: 2, vision_completion: 70,  ai_efficiency: 60, last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Price book, floor price enforcement, cost tracking' },
  // Tier 3
  { id: 'pulse',     agent_name: 'PULSE',     tier: 3, vision_completion: 85,  ai_efficiency: 72, last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Cash flow, margin analysis, financial forecasting' },
  { id: 'blueprint', agent_name: 'BLUEPRINT', tier: 3, vision_completion: 80,  ai_efficiency: 65, last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Project architecture, phase management' },
  { id: 'ledger',   agent_name: 'LEDGER',   tier: 3, vision_completion: 80,  ai_efficiency: 68, last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Invoicing, AR, collections, payments' },
  { id: 'chrono',   agent_name: 'CHRONO',   tier: 3, vision_completion: 75,  ai_efficiency: 60, last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Time tracking, crew scheduling, clock-in/out' },
  { id: 'atlas',    agent_name: 'ATLAS',    tier: 3, vision_completion: 0,   ai_efficiency: 0,  last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Geo-intelligence, field/review mode, historical profitability' },
  // Tier 4
  { id: 'ohm',      agent_name: 'OHM',      tier: 4, vision_completion: 0,   ai_efficiency: 0,  last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Enhanced compliance' },
  { id: 'echo',     agent_name: 'ECHO',     tier: 4, vision_completion: 80,  ai_efficiency: 70, last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Memory retrieval, context injection, historical data' },
  { id: 'scout',    agent_name: 'SCOUT',    tier: 4, vision_completion: 75,  ai_efficiency: 62, last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Pattern analysis, competitor intelligence' },
  { id: 'guardian', agent_name: 'GUARDIAN', tier: 4, vision_completion: 100, ai_efficiency: 85, last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Compliance, documentation, audit trails' },
  // Tier 5
  { id: 'negotiate', agent_name: 'NEGOTIATE', tier: 5, vision_completion: 0, ai_efficiency: 0, last_analysis_at: null, analysis_notes: null, is_absorbed: true, absorbed_into: 'SPARK', absorbed_date: 'April 9, 2026', role: 'Absorbed into SPARK Live Call' },
  { id: 'sentinel',  agent_name: 'SENTINEL',  tier: 5, vision_completion: 0, ai_efficiency: 0, last_analysis_at: null, analysis_notes: null, is_absorbed: false, absorbed_into: null, absorbed_date: null, role: 'Internal security, breach monitoring' },
]

const TIER_COLORS: Record<number, string> = {
  1: '#a855f7',
  2: '#3b82f6',
  3: '#10b981',
  4: '#f59e0b',
  5: '#6b7280',
}

// ─── Analysis prompt template ──────────────────────────────────────────────────

function buildAnalysisPrompt(agent: AgentRecord): string {
  return `Analyze the PowerOn Hub agent named ${agent.agent_name}. Role: ${agent.role}.
Vision completion: ${agent.vision_completion}%. Based on this completion level and the agent's intended role
in an electrical contractor business management platform, assess:
1. What capabilities are likely already activated?
2. What gaps remain between current state and full potential?
3. One specific recommendation to increase effectiveness this week.
Keep response under 150 words. Be specific to electrical contracting context.`
}

// ─── Progress Bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color, fontFamily: 'monospace' }}>{value}%</span>
      </div>
      <div style={{
        height: 5, borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${Math.max(0, Math.min(100, value))}%`,
          backgroundColor: color,
          borderRadius: 3,
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  )
}

// ─── Agent Intelligence Card ───────────────────────────────────────────────────

function AgentCard({ agent }: { agent: AgentRecord }) {
  const [expanded, setExpanded] = useState(false)
  const [running, setRunning] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<string | null>(agent.analysis_notes)
  const [lastAnalysis, setLastAnalysis] = useState<string | null>(agent.last_analysis_at)
  const [showAbsorbedTooltip, setShowAbsorbedTooltip] = useState(false)

  const tierColor = TIER_COLORS[agent.tier] ?? '#6b7280'
  const isAbsorbed = agent.is_absorbed
  const isPending = agent.vision_completion === 0 && !isAbsorbed

  const handleRunAnalysis = useCallback(async () => {
    if (running) return
    setRunning(true)
    setExpanded(true)
    setAnalysisResult(null)

    const prompt = buildAnalysisPrompt(agent)

    try {
      // Call Claude via Netlify proxy
      const resp = await fetch('/.netlify/functions/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 250,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (resp.ok) {
        const data = await resp.json()
        const text = data?.content?.[0]?.text ?? data?.choices?.[0]?.message?.content ?? 'Analysis complete.'
        setAnalysisResult(text)
      } else {
        setAnalysisResult(`Analysis unavailable. (${resp.status}) — Connect Claude API to enable live analysis.`)
      }
    } catch {
      setAnalysisResult('Analysis unavailable — Claude API not connected. Check ANTHROPIC_API_KEY in Netlify environment.')
    }

    setLastAnalysis(new Date().toISOString())
    setRunning(false)
  }, [agent, running])

  function fmtTimestamp(iso: string | null) {
    if (!iso) return null
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch { return iso }
  }

  if (isAbsorbed) {
    return (
      <div
        style={{
          backgroundColor: 'rgba(107,114,128,0.05)',
          border: '1px solid rgba(107,114,128,0.2)',
          borderRadius: 10,
          padding: '14px 16px',
          opacity: 0.7,
          cursor: 'pointer',
          position: 'relative',
        }}
        onClick={() => setShowAbsorbedTooltip(!showAbsorbedTooltip)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em' }}>
            {agent.agent_name}
          </span>
          <span style={{
            fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 3,
            backgroundColor: 'rgba(107,114,128,0.3)', color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            T{agent.tier}
          </span>
          <span style={{
            fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 3,
            backgroundColor: 'rgba(107,114,128,0.25)', color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            Absorbed
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4 }}>
          Absorbed into {agent.absorbed_into} — {agent.absorbed_date}
        </div>
        <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>Tap for details</div>

        {showAbsorbedTooltip && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 50,
            marginTop: 6,
            padding: '12px 14px',
            borderRadius: 8,
            backgroundColor: '#1f2937',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            width: 280,
            fontSize: 11,
            color: '#9ca3af',
            lineHeight: 1.5,
          }}>
            Absorbed into {agent.absorbed_into} Live Call — {agent.absorbed_date}. All negotiation features live inside {agent.absorbed_into}. Kept for timeline and audit purposes only.
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{
      backgroundColor: `${tierColor}08`,
      border: `1px solid ${tierColor}25`,
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Card header */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: tierColor, letterSpacing: '0.08em' }}>
                {agent.agent_name}
              </span>
              <span style={{
                fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 3,
                backgroundColor: `${tierColor}25`, color: tierColor,
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>
                T{agent.tier}
              </span>
              {isPending && (
                <span style={{
                  fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                  backgroundColor: 'rgba(107,114,128,0.2)', color: '#6b7280',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  Pending Build
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4, maxWidth: 280 }}>
              {agent.role}
            </div>
          </div>

          {/* Run Analysis button */}
          {!isAbsorbed && (
            <button
              onClick={handleRunAnalysis}
              disabled={running}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 6,
                border: `1px solid ${tierColor}40`,
                background: `${tierColor}12`,
                color: tierColor,
                fontSize: 10, fontWeight: 700, cursor: running ? 'wait' : 'pointer',
                opacity: running ? 0.7 : 1,
                fontFamily: 'monospace', letterSpacing: '0.04em',
                textTransform: 'uppercase',
                flexShrink: 0,
                marginLeft: 12,
              }}
            >
              {running ? (
                <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Brain size={11} />
              )}
              {running ? 'Running...' : 'Run Analysis'}
            </button>
          )}
        </div>

        {/* Progress bars */}
        <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
          <ProgressBar value={agent.vision_completion} color={tierColor} label="Vision Completion" />
          <ProgressBar value={agent.ai_efficiency} color="#60a5fa" label="AI Efficiency" />
        </div>

        {/* Last analysis timestamp */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={10} style={{ color: '#4b5563' }} />
            <span style={{ fontSize: 10, color: '#4b5563', fontFamily: 'monospace' }}>
              {lastAnalysis ? `Last: ${fmtTimestamp(lastAnalysis)}` : 'Not yet analyzed'}
            </span>
          </div>
          {analysisResult && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 10,
              }}
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? 'Hide' : 'Show'} Analysis
            </button>
          )}
        </div>
      </div>

      {/* Analysis result expansion panel */}
      {expanded && analysisResult && (
        <div style={{
          borderTop: `1px solid ${tierColor}20`,
          padding: '12px 16px',
          backgroundColor: 'rgba(0,0,0,0.2)',
        }}>
          <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {analysisResult}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

const TIER_LABELS: Record<number, string> = {
  1: 'Tier 1 — Command',
  2: 'Tier 2 — Operations',
  3: 'Tier 3 — Intelligence',
  4: 'Tier 4 — Support',
  5: 'Tier 5 — Special',
}

export default function AdminToolsView() {
  const [lastRefresh] = useState<string>(new Date().toISOString())
  const tiers = [1, 2, 3, 4, 5]

  function fmtTimestamp(iso: string) {
    try {
      return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch { return iso }
  }

  return (
    <div style={{
      padding: '20px 24px',
      color: '#e5e7eb',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      maxWidth: 1200,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f9fafb', marginBottom: 6 }}>Admin Tools</h1>
          <p style={{ fontSize: 12, color: '#6b7280' }}>Owner-only access. Agent Intelligence Panel — track vision completion and AI efficiency per agent.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#4b5563' }}>
          <Clock size={12} />
          <span>Last refresh: {fmtTimestamp(lastRefresh)}</span>
        </div>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 20, marginBottom: 24,
        padding: '10px 16px', borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b7280' }}>
          <div style={{ width: 12, height: 4, borderRadius: 2, backgroundColor: '#a855f7' }} />
          Vision Completion (how built vs. full spec)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b7280' }}>
          <div style={{ width: 12, height: 4, borderRadius: 2, backgroundColor: '#60a5fa' }} />
          AI Efficiency (activation vs. potential)
        </div>
      </div>

      {/* Agent tiers */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {tiers.map(tier => {
          const tierAgents = SEED_AGENTS.filter(a => a.tier === tier)
          const tierColor = TIER_COLORS[tier]

          return (
            <div key={tier}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{
                  fontSize: 10, fontWeight: 800,
                  fontFamily: 'monospace', letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: tierColor,
                }}>
                  {TIER_LABELS[tier]}
                </span>
                <div style={{ flex: 1, height: 1, backgroundColor: `${tierColor}20` }} />
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: 12,
              }}>
                {tierAgents.map(agent => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
