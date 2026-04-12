/**
 * AgentRosterPanel.tsx — NW35: Command Center Agent Selector.
 *
 * Opened by:
 *   - Clicking the "ROSTER" button in top-left HUD
 *   - Clicking the Fortress tactical table (dispatches 'nw:open-roster')
 *
 * Layout: Semi-transparent dark glass panel, grid layout, 4 columns.
 * Each agent as a card:
 *   - Active agents: solid colored icon + name + role + domain + "ACTIVE" badge
 *   - Planned agents: wireframe icon + name + role + version "V4/V5/V6" badge
 *     + "ACTIVATE IN SIMULATION" button
 *   - Katsuro: special large card, crimson-gold border, read line count + last handoff
 *
 * Simulation activation:
 *   - On ACTIVATE: dispatches 'nw:roster-agent-activate' event → KatsuroBridgeLayer listens
 *   - On DEACTIVATE: dispatches 'nw:roster-agent-deactivate'
 *   - Multiple planned agents can be active simultaneously
 *
 * Counter badge at top: "X of 20 agents active"
 *
 * VIDEO GAME UX LAW: semi-transparent dark glass, fade-in transition, min 14px text.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'

// ── Agent definitions ──────────────────────────────────────────────────────────

type AgentStatus = 'active' | 'planned'

interface AgentCard {
  id: string
  name: string
  role: string
  domain: string
  color: string
  status: AgentStatus
  version?: string
  versionLabel?: string
}

// Active agents (11)
const ACTIVE_AGENTS: AgentCard[] = [
  { id: 'NEXUS',    name: 'NEXUS',    role: 'Orchestration Brain',   domain: 'All Domains',         color: '#00E5CC', status: 'active' },
  { id: 'OHM',      name: 'OHM',      role: 'Compliance Monitor',    domain: 'Compliance',           color: '#FF9040', status: 'active' },
  { id: 'VAULT',    name: 'VAULT',    role: 'Materials Intelligence', domain: 'Material Takeoff',     color: '#FFD24A', status: 'active' },
  { id: 'LEDGER',   name: 'LEDGER',   role: 'Revenue Controller',    domain: 'Revenue',              color: '#2EE89A', status: 'active' },
  { id: 'SPARK',    name: 'SPARK',    role: 'Lead Acquisition',      domain: 'Lead Acquisition',     color: '#FFE040', status: 'active' },
  { id: 'BLUEPRINT',name: 'BLUEPRINT',role: 'Project Architect',     domain: 'Project Install',      color: '#3A8EFF', status: 'active' },
  { id: 'CHRONO',   name: 'CHRONO',   role: 'Schedule Manager',      domain: 'Progress Tracking',    color: '#AA6EFF', status: 'active' },
  { id: 'SCOUT',    name: 'SCOUT',    role: 'Pattern Analyst',       domain: 'Analysis',             color: '#40D4FF', status: 'active' },
  { id: 'ECHO',     name: 'ECHO',     role: 'Memory Keeper',         domain: 'Memory Cave',          color: '#4060CC', status: 'active' },
  { id: 'ATLAS',    name: 'ATLAS',    role: 'Geographic Intel',      domain: 'Geographic Station',   color: '#40FF80', status: 'active' },
  { id: 'GUARDIAN', name: 'GUARDIAN', role: 'Security Patrol',       domain: 'Perimeter',            color: '#FF5060', status: 'active' },
]

// Planned agents (7) — NEGOTIATE removed (absorbed into SPARK)
const PLANNED_AGENTS: AgentCard[] = [
  { id: 'HUNTER',       name: 'HUNTER',       role: 'Lead Hunter',         domain: 'Lead Acquisition',   color: '#FFE040', status: 'planned', version: 'V4', versionLabel: 'PLANNED V4' },
  { id: 'SENTINEL',     name: 'SENTINEL',     role: 'Risk Sentinel',       domain: 'Compliance',         color: '#FF5060', status: 'planned', version: 'V5', versionLabel: 'PLANNED V5' },
  { id: 'ATLAS-ENT',    name: 'ATLAS ENT',    role: 'Enterprise Mapper',   domain: 'Geographic',         color: '#40FF80', status: 'planned', version: 'V6', versionLabel: 'PLANNED V6' },
  { id: 'CORE',         name: 'CORE',         role: 'Personal OS Core',    domain: 'Katsuro Tower',      color: '#FFFFFF', status: 'planned', version: 'V5', versionLabel: 'PLANNED V5' },
  { id: 'MOMENTUM',     name: 'MOMENTUM',     role: 'Execution Driver',    domain: 'Katsuro Tower',      color: '#FF8C00', status: 'planned', version: 'V5', versionLabel: 'PLANNED V5' },
  { id: 'MIRROR',       name: 'MIRROR',       role: 'Reflection Engine',   domain: 'Katsuro Tower',      color: '#9AC8FF', status: 'planned', version: 'V5', versionLabel: 'PLANNED V5' },
  { id: 'ATLAS-PER',    name: 'ATLAS PERSONAL',role: 'Personal Navigator', domain: 'Katsuro Tower',      color: '#5FBD8A', status: 'planned', version: 'V6', versionLabel: 'PLANNED V6' },
]

// Absorbed agents — shown grayed out with ABSORBED badge
interface AbsorbedAgentCard {
  id: string
  name: string
  role: string
  absorbedInto: string
  absorbedDate: string
}
const ABSORBED_AGENTS: AbsorbedAgentCard[] = [
  { id: 'NEGOTIATE', name: 'NEGOTIATE', role: 'Deal Closer', absorbedInto: 'SPARK', absorbedDate: 'April 9, 2026' },
]

// Total roster: 11 active + 7 planned + 1 Katsuro + 1 absorbed = 20

// ── Katsuro special card ───────────────────────────────────────────────────────

interface KatsuroState {
  readLineCount: number
  lastHandoffType: string
  lastHandoffTime: string
}

// ── Component ──────────────────────────────────────────────────────────────────

interface AgentRosterPanelProps {
  open: boolean
  onClose: () => void
}

export function AgentRosterPanel({ open, onClose }: AgentRosterPanelProps) {
  const [simulatedAgents, setSimulatedAgents] = useState<Set<string>>(new Set())
  const [katsuro, setKatsuro] = useState<KatsuroState>({
    readLineCount: 10,
    lastHandoffType: 'initial-brief',
    lastHandoffTime: 'just now',
  })
  const [mountAnim, setMountAnim] = useState(false)

  // Subtitle from handoff
  useEffect(() => {
    function onHandoffSub(e: Event) {
      const ev = e as CustomEvent<{ text: string }>
      const text = ev.detail?.text || ''
      if (!text) return
      // Extract type from subtitle
      const match = text.match(/handoff received: (.+)$/)
      if (match) {
        const now = new Date()
        setKatsuro(prev => ({
          ...prev,
          lastHandoffType: match[1],
          lastHandoffTime: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }))
      }
    }
    window.addEventListener('nw:katsuro-subtitle', onHandoffSub)
    return () => window.removeEventListener('nw:katsuro-subtitle', onHandoffSub)
  }, [])

  // Fade in on open
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setMountAnim(true))
    } else {
      setMountAnim(false)
    }
  }, [open])

  const handleActivate = useCallback((agentId: string) => {
    setSimulatedAgents(prev => {
      const next = new Set(prev)
      next.add(agentId)
      return next
    })
    window.dispatchEvent(new CustomEvent('nw:roster-agent-activate', { detail: { agentId } }))
  }, [])

  const handleDeactivate = useCallback((agentId: string) => {
    setSimulatedAgents(prev => {
      const next = new Set(prev)
      next.delete(agentId)
      return next
    })
    window.dispatchEvent(new CustomEvent('nw:roster-agent-deactivate', { detail: { agentId } }))
  }, [])

  // Active count: 11 always + simulated planned + 1 Katsuro
  const activeCount = ACTIVE_AGENTS.length + simulatedAgents.size + 1  // +1 Katsuro
  const totalCount  = ACTIVE_AGENTS.length + PLANNED_AGENTS.length + ABSORBED_AGENTS.length + 1  // 20

  if (!open) return null

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
        opacity: mountAnim ? 1 : 0,
        transition: 'opacity 0.25s ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: 'min(900px, 95vw)',
          maxHeight: '88vh',
          background: 'rgba(5, 5, 18, 0.94)',
          border: '1px solid rgba(0,229,204,0.30)',
          borderRadius: 10,
          backdropFilter: 'blur(18px)',
          boxShadow: '0 0 60px rgba(0,229,204,0.12), 0 24px 80px rgba(0,0,0,0.7)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: mountAnim ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(10px)',
          transition: 'transform 0.25s ease',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: '14px 20px 12px',
          borderBottom: '1px solid rgba(0,229,204,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 16, fontFamily: 'monospace', fontWeight: 700, color: '#00E5CC', letterSpacing: 2 }}>
            ◈ AGENT ROSTER
          </div>
          <div style={{
            background: 'rgba(0,229,204,0.12)',
            border: '1px solid rgba(0,229,204,0.4)',
            borderRadius: 4,
            padding: '2px 10px',
            fontSize: 11,
            fontFamily: 'monospace',
            color: '#00E5CC',
            letterSpacing: 1.5,
          }}>
            {activeCount} of {totalCount} active
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 4,
              color: 'rgba(255,255,255,0.5)',
              fontSize: 13,
              cursor: 'pointer',
              padding: '2px 8px',
              fontFamily: 'monospace',
              transition: 'all 0.15s',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: 'auto', padding: '16px 20px 20px', flex: 1 }}>

          {/* ── Katsuro special card ── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 9,
              fontFamily: 'monospace',
              color: 'rgba(255,215,0,0.55)',
              letterSpacing: 2,
              marginBottom: 8,
              textTransform: 'uppercase',
            }}>
              Strategic Observer
            </div>
            <KatsuroCard katsuro={katsuro} />
          </div>

          {/* ── Active agents ── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 9,
              fontFamily: 'monospace',
              color: 'rgba(0,229,204,0.55)',
              letterSpacing: 2,
              marginBottom: 10,
              textTransform: 'uppercase',
            }}>
              Active Agents — {ACTIVE_AGENTS.length}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
            }}>
              {ACTIVE_AGENTS.map(agent => (
                <ActiveAgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          </div>

          {/* ── Planned agents ── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 9,
              fontFamily: 'monospace',
              color: 'rgba(255,160,60,0.55)',
              letterSpacing: 2,
              marginBottom: 10,
              textTransform: 'uppercase',
            }}>
              Planned Agents — {PLANNED_AGENTS.length}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
            }}>
              {PLANNED_AGENTS.map(agent => (
                <PlannedAgentCard
                  key={agent.id}
                  agent={agent}
                  simActive={simulatedAgents.has(agent.id)}
                  onActivate={handleActivate}
                  onDeactivate={handleDeactivate}
                />
              ))}
            </div>
          </div>

          {/* ── Absorbed agents ── */}
          {ABSORBED_AGENTS.length > 0 && (
            <div>
              <div style={{
                fontSize: 9,
                fontFamily: 'monospace',
                color: 'rgba(150,150,170,0.45)',
                letterSpacing: 2,
                marginBottom: 10,
                textTransform: 'uppercase',
              }}>
                Absorbed Agents — {ABSORBED_AGENTS.length}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 8,
              }}>
                {ABSORBED_AGENTS.map(agent => (
                  <AbsorbedAgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Katsuro card ───────────────────────────────────────────────────────────────

function KatsuroCard({ katsuro }: { katsuro: KatsuroState }) {
  return (
    <div style={{
      background: 'rgba(255,48,48,0.08)',
      border: '1px solid rgba(255,215,0,0.50)',
      borderRadius: 8,
      padding: '14px 18px',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      boxShadow: '0 0 20px rgba(255,48,48,0.12)',
    }}>
      {/* Icon */}
      <div style={{
        width: 52,
        height: 52,
        borderRadius: 8,
        background: 'rgba(255,48,48,0.15)',
        border: '2px solid rgba(255,215,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 24,
        flexShrink: 0,
      }}>
        ⚡
      </div>
      {/* Info */}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontFamily: 'monospace', fontWeight: 700, color: '#FF3030', letterSpacing: 1.5 }}>
            KATSURO RAIJIN
          </div>
          <div style={{
            fontSize: 9,
            fontFamily: 'monospace',
            background: 'rgba(255,215,0,0.15)',
            border: '1px solid rgba(255,215,0,0.5)',
            color: '#FFD700',
            borderRadius: 3,
            padding: '1px 7px',
            letterSpacing: 1,
          }}>
            OBSERVER
          </div>
        </div>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,215,0,0.7)', marginBottom: 6 }}>
          Strategic Intelligence · Bridge Tower · Read-Only
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)' }}>
            Read lines: <span style={{ color: '#FFD700' }}>{katsuro.readLineCount} domains</span>
          </div>
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)' }}>
            Last handoff: <span style={{ color: '#FFD700' }}>{katsuro.lastHandoffType}</span>{' '}
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>@ {katsuro.lastHandoffTime}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Active agent card ──────────────────────────────────────────────────────────

function ActiveAgentCard({ agent }: { agent: AgentCard }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${agent.color}33`,
      borderRadius: 6,
      padding: '10px 12px',
      position: 'relative',
      transition: 'border-color 0.2s',
    }}>
      {/* Top: icon circle + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: agent.color + '22',
          border: `1.5px solid ${agent.color}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: agent.color }} />
        </div>
        <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: agent.color, letterSpacing: 1 }}>
          {agent.name}
        </div>
      </div>
      {/* Role */}
      <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)', marginBottom: 4, lineHeight: 1.4 }}>
        {agent.role}
      </div>
      {/* Domain */}
      <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>
        {agent.domain}
      </div>
      {/* ACTIVE badge */}
      <div style={{
        display: 'inline-block',
        fontSize: 8,
        fontFamily: 'monospace',
        background: agent.color + '20',
        border: `1px solid ${agent.color}60`,
        color: agent.color,
        borderRadius: 3,
        padding: '2px 7px',
        letterSpacing: 1.5,
      }}>
        ACTIVE
      </div>
    </div>
  )
}

// ── Planned agent card ─────────────────────────────────────────────────────────

interface PlannedAgentCardProps {
  agent: AgentCard
  simActive: boolean
  onActivate: (id: string) => void
  onDeactivate: (id: string) => void
}

function PlannedAgentCard({ agent, simActive, onActivate, onDeactivate }: PlannedAgentCardProps) {
  const [hover, setHover] = useState(false)

  return (
    <div style={{
      background: simActive ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${simActive ? agent.color + '55' : 'rgba(255,255,255,0.10)'}`,
      borderRadius: 6,
      padding: '10px 12px',
      transition: 'all 0.2s',
    }}>
      {/* Top: wireframe icon + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {/* Wireframe-style icon (hexagonal outline) */}
        <div style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'transparent',
          border: `1.5px dashed ${agent.color}${simActive ? 'aa' : '55'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'border-color 0.2s',
        }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            border: `1px solid ${agent.color}${simActive ? 'cc' : '44'}`,
            transition: 'border-color 0.2s',
          }} />
        </div>
        <div style={{
          fontSize: 11,
          fontFamily: 'monospace',
          fontWeight: 700,
          color: simActive ? agent.color : agent.color + '88',
          letterSpacing: 1,
          transition: 'color 0.2s',
        }}>
          {agent.name}
        </div>
      </div>
      {/* Role */}
      <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', marginBottom: 4, lineHeight: 1.4 }}>
        {agent.role}
      </div>
      {/* Domain */}
      <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)', marginBottom: 8 }}>
        {agent.domain}
      </div>
      {/* Version badge */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{
          fontSize: 8,
          fontFamily: 'monospace',
          background: 'rgba(255,160,60,0.10)',
          border: '1px solid rgba(255,160,60,0.35)',
          color: 'rgba(255,160,60,0.8)',
          borderRadius: 3,
          padding: '2px 7px',
          letterSpacing: 1,
        }}>
          {agent.versionLabel}
        </div>

        {/* Activate / Deactivate button */}
        {simActive ? (
          <button
            onClick={() => onDeactivate(agent.id)}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
              fontSize: 8,
              fontFamily: 'monospace',
              background: 'rgba(255,80,80,0.12)',
              border: '1px solid rgba(255,80,80,0.45)',
              color: '#FF5050',
              borderRadius: 3,
              padding: '3px 8px',
              cursor: 'pointer',
              letterSpacing: 1,
              transition: 'all 0.15s',
            }}
          >
            DEACTIVATE
          </button>
        ) : (
          <button
            onClick={() => onActivate(agent.id)}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
              fontSize: 8,
              fontFamily: 'monospace',
              background: hover ? agent.color + '22' : 'transparent',
              border: `1px solid ${agent.color}${hover ? 'aa' : '44'}`,
              color: agent.color + (hover ? 'dd' : '88'),
              borderRadius: 3,
              padding: '3px 8px',
              cursor: 'pointer',
              letterSpacing: 0.8,
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            ACTIVATE SIM
          </button>
        )}
      </div>
    </div>
  )
}

// ── Absorbed agent card ────────────────────────────────────────────────────────

function AbsorbedAgentCard({ agent }: { agent: AbsorbedAgentCard }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.015)',
      border: '1px solid rgba(150,150,170,0.18)',
      borderRadius: 6,
      padding: '10px 12px',
      opacity: 0.65,
      position: 'relative',
    }}>
      {/* Top: grayed-out icon + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'transparent',
          border: '1.5px dashed rgba(150,150,170,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            border: '1px solid rgba(150,150,170,0.30)',
          }} />
        </div>
        <div style={{
          fontSize: 11,
          fontFamily: 'monospace',
          fontWeight: 700,
          color: 'rgba(150,150,170,0.55)',
          letterSpacing: 1,
          textDecoration: 'line-through',
        }}>
          {agent.name}
        </div>
      </div>
      {/* Role */}
      <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)', marginBottom: 4, lineHeight: 1.4 }}>
        {agent.role}
      </div>
      {/* Absorbed label */}
      <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(150,150,170,0.40)', marginBottom: 8 }}>
        — {agent.absorbedInto} · {agent.absorbedDate}
      </div>
      {/* ABSORBED badge */}
      <div style={{
        display: 'inline-block',
        fontSize: 8,
        fontFamily: 'monospace',
        background: 'rgba(150,150,170,0.08)',
        border: '1px solid rgba(150,150,170,0.30)',
        color: 'rgba(150,150,170,0.65)',
        borderRadius: 3,
        padding: '2px 7px',
        letterSpacing: 1.5,
      }}>
        ABSORBED
      </div>
    </div>
  )
}

// ── Roster button (standalone trigger button for HUD) ─────────────────────────

interface RosterButtonProps {
  onClick: () => void
  hasActive?: boolean
}

export function RosterButton({ onClick, hasActive = false }: RosterButtonProps) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Open Agent Roster (20 agents)"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        background: hover ? 'rgba(0,229,204,0.15)' : 'rgba(0,10,8,0.80)',
        border: `1px solid rgba(0,229,204,${hover ? '0.6' : '0.35'})`,
        borderRadius: 5,
        color: hover ? '#00E5CC' : 'rgba(0,229,204,0.75)',
        fontSize: 9,
        fontFamily: 'monospace',
        fontWeight: 700,
        letterSpacing: 1.5,
        padding: '6px 10px',
        cursor: 'pointer',
        transition: 'all 0.15s',
        backdropFilter: 'blur(8px)',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: 11 }}>◈</span>
      ROSTER
      {hasActive && (
        <span style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: '#FF8C00',
          flexShrink: 0,
        }} />
      )}
    </button>
  )
}

// ── Katsuro handoff subtitle overlay ─────────────────────────────────────────

export function KatsuroSubtitleOverlay() {
  const [text, setText] = useState('')
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onSubtitle(e: Event) {
      const ev = e as CustomEvent<{ text: string }>
      const t = ev.detail?.text ?? ''
      if (t) {
        setText(t)
        setVisible(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setVisible(false), 3800)
      } else {
        setVisible(false)
      }
    }
    window.addEventListener('nw:katsuro-subtitle', onSubtitle)
    return () => {
      window.removeEventListener('nw:katsuro-subtitle', onSubtitle)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (!visible || !text) return null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 130,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 35,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.4s ease',
      }}
    >
      <div style={{
        background: 'rgba(5, 5, 18, 0.90)',
        border: '1px solid rgba(255,215,0,0.50)',
        borderRadius: 5,
        padding: '6px 18px',
        fontSize: 11,
        fontFamily: 'monospace',
        color: '#FFD700',
        letterSpacing: 1.2,
        backdropFilter: 'blur(8px)',
        boxShadow: '0 0 20px rgba(255,215,0,0.20)',
        whiteSpace: 'nowrap',
      }}>
        ⚡ {text}
      </div>
    </div>
  )
}
