// @ts-nocheck
/**
 * AgentSystemMapView.tsx — NAV1 | Agent System Map
 *
 * Displays the confirmed agent pyramid hierarchy:
 *   T1: NEXUS
 *   T2: SPARK, HUNTER, VAULT
 *   T3: PULSE, BLUEPRINT, LEDGER, CHRONO, ATLAS
 *   T4: OHM, ECHO, SCOUT, GUARDIAN
 *   T5: NEGOTIATE (Absorbed), SENTINEL
 *
 * NEGOTIATE shown as Absorbed — greyed node, "Absorbed" label.
 * HUNTER shown as connected to SPARK and VAULT.
 * Completion percentages match agent_intelligence seed data.
 *
 * Admin only — same existing gate, no new auth.
 */

import React, { useState } from 'react'

// ─── Agent Data ────────────────────────────────────────────────────────────────

interface AgentNode {
  id: string
  name: string
  tier: number
  role: string
  vision: number
  efficiency: number
  color: string
  absorbed?: boolean
  absorbedInto?: string
  absorbedDate?: string
  connectedTo?: string[]
}

const AGENTS: AgentNode[] = [
  // Tier 1
  { id: 'NEXUS',     name: 'NEXUS',     tier: 1, role: 'Admin voice, morning brief, command center',       vision: 90,  efficiency: 78, color: '#a855f7' },
  // Tier 2
  { id: 'SPARK',     name: 'SPARK',     tier: 2, role: 'Sales co-pilot, call transcription, AirPods alerts',vision: 90,  efficiency: 75, color: '#f59e0b', connectedTo: ['HUNTER'] },
  { id: 'HUNTER',   name: 'HUNTER',   tier: 2, role: 'Lead generation, web scraping, scoring',            vision: 100, efficiency: 88, color: '#3b82f6', connectedTo: ['SPARK', 'VAULT'] },
  { id: 'VAULT',    name: 'VAULT',    tier: 2, role: 'Price book, floor price enforcement, cost tracking', vision: 70,  efficiency: 60, color: '#10b981', connectedTo: ['HUNTER'] },
  // Tier 3
  { id: 'PULSE',     name: 'PULSE',     tier: 3, role: 'Cash flow, margin analysis, financial forecasting', vision: 85,  efficiency: 72, color: '#06b6d4' },
  { id: 'BLUEPRINT', name: 'BLUEPRINT', tier: 3, role: 'Project architecture, phase management',            vision: 80,  efficiency: 65, color: '#8b5cf6' },
  { id: 'LEDGER',   name: 'LEDGER',   tier: 3, role: 'Invoicing, AR, collections, payments',              vision: 80,  efficiency: 68, color: '#ec4899' },
  { id: 'CHRONO',   name: 'CHRONO',   tier: 3, role: 'Time tracking, crew scheduling, clock-in/out',      vision: 75,  efficiency: 60, color: '#f97316' },
  { id: 'ATLAS',    name: 'ATLAS',    tier: 3, role: 'Geo-intelligence, field/review mode, historical profitability', vision: 0, efficiency: 0, color: '#84cc16' },
  // Tier 4
  { id: 'OHM',      name: 'OHM',      tier: 4, role: 'Enhanced compliance',                               vision: 0,   efficiency: 0,  color: '#ff6b35' },
  { id: 'ECHO',     name: 'ECHO',     tier: 4, role: 'Memory retrieval, context injection, historical data',vision: 80,  efficiency: 70, color: '#22d3ee' },
  { id: 'SCOUT',    name: 'SCOUT',    tier: 4, role: 'Pattern analysis, competitor intelligence',          vision: 75,  efficiency: 62, color: '#a3e635' },
  { id: 'GUARDIAN', name: 'GUARDIAN', tier: 4, role: 'Compliance, documentation, audit trails',           vision: 100, efficiency: 85, color: '#34d399' },
  // Tier 5
  { id: 'NEGOTIATE', name: 'NEGOTIATE', tier: 5, role: 'Absorbed into SPARK', vision: 0, efficiency: 0, color: '#6b7280', absorbed: true, absorbedInto: 'SPARK', absorbedDate: 'April 9, 2026' },
  { id: 'SENTINEL',  name: 'SENTINEL',  tier: 5, role: 'Internal security, breach monitoring',            vision: 0,   efficiency: 0,  color: '#ef4444' },
]

const TIER_LABELS: Record<number, string> = {
  1: 'T1 — COMMAND',
  2: 'T2 — OPERATIONS',
  3: 'T3 — INTELLIGENCE',
  4: 'T4 — SUPPORT',
  5: 'T5 — SPECIAL',
}

// ─── Status helpers ────────────────────────────────────────────────────────────

function getStatusDot(agent: AgentNode) {
  if (agent.absorbed) return '#6b7280'
  if (agent.vision === 0) return '#6b7280'
  if (agent.vision < 100) return '#f59e0b'
  return '#22c55e'
}

function getStatusLabel(agent: AgentNode) {
  if (agent.absorbed) return 'Absorbed'
  if (agent.vision === 0) return 'Pending Build'
  if (agent.vision < 100) return `${agent.vision}% Built`
  return 'Complete'
}

// ─── Agent Card ────────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: AgentNode }) {
  const [tooltip, setTooltip] = useState(false)
  const dot = getStatusDot(agent)
  const statusLabel = getStatusLabel(agent)
  const isAbsorbed = agent.absorbed === true
  const isPending = agent.vision === 0 && !isAbsorbed

  return (
    <div
      style={{
        position: 'relative',
        padding: '10px 14px',
        borderRadius: 10,
        border: `1px solid ${isAbsorbed ? 'rgba(107,114,128,0.25)' : `${agent.color}30`}`,
        backgroundColor: isAbsorbed ? 'rgba(107,114,128,0.05)' : `${agent.color}08`,
        opacity: isAbsorbed ? 0.65 : isPending ? 0.8 : 1,
        transition: 'opacity 0.15s',
        cursor: isAbsorbed ? 'pointer' : 'default',
        minWidth: 0,
      }}
      onClick={() => isAbsorbed && setTooltip(!tooltip)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: dot, flexShrink: 0 }} />
        <span style={{
          fontFamily: 'monospace',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: isAbsorbed ? '#6b7280' : agent.color,
          textTransform: 'uppercase',
        }}>
          {agent.name}
        </span>
        {isAbsorbed && (
          <span style={{
            fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 3,
            backgroundColor: 'rgba(107,114,128,0.25)', color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            Absorbed
          </span>
        )}
        {isPending && (
          <span style={{
            fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 3,
            backgroundColor: 'rgba(107,114,128,0.2)', color: '#6b7280',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            Pending
          </span>
        )}
      </div>

      {!isAbsorbed && (
        <>
          <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.4, marginBottom: 6, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {agent.role}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Vision bar */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 8, color: '#6b7280', marginBottom: 2, fontFamily: 'monospace' }}>Vision {agent.vision}%</div>
              <div style={{ height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${agent.vision}%`, backgroundColor: agent.color, borderRadius: 2 }} />
              </div>
            </div>
            {/* Efficiency bar */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 8, color: '#6b7280', marginBottom: 2, fontFamily: 'monospace' }}>Eff. {agent.efficiency}%</div>
              <div style={{ height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${agent.efficiency}%`, backgroundColor: '#60a5fa', borderRadius: 2 }} />
              </div>
            </div>
          </div>
        </>
      )}

      {isAbsorbed && (
        <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.4 }}>
          → {agent.absorbedInto} · {agent.absorbedDate}
        </div>
      )}

      {/* Absorbed tooltip */}
      {tooltip && isAbsorbed && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          zIndex: 50,
          marginBottom: 6,
          padding: '10px 12px',
          borderRadius: 8,
          backgroundColor: '#1f2937',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          width: 260,
          fontSize: 11,
          color: '#9ca3af',
          lineHeight: 1.5,
        }}>
          Absorbed into {agent.absorbedInto} Live Call — {agent.absorbedDate}. All negotiation features live inside {agent.absorbedInto}.
        </div>
      )}
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function AgentSystemMapView() {
  const tiers = [1, 2, 3, 4, 5]

  return (
    <div style={{
      padding: '20px',
      color: '#e5e7eb',
      backgroundColor: 'transparent',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f9fafb', marginBottom: 4 }}>Agent System Map</h2>
        <p style={{ fontSize: 12, color: '#6b7280' }}>PowerOn Hub agent pyramid — completion percentages reflect current build state.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {tiers.map(tier => {
          const tierAgents = AGENTS.filter(a => a.tier === tier)
          const tierLabel = TIER_LABELS[tier]

          return (
            <div key={tier}>
              {/* Tier header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 10,
              }}>
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#4b5563',
                }}>
                  {tierLabel}
                </span>
                <div style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                <span style={{ fontSize: 9, color: '#374151', fontFamily: 'monospace' }}>{tierAgents.length} agents</span>
              </div>

              {/* Agent cards grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 10,
              }}>
                {tierAgents.map(agent => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
