/**
 * src/views/AgentModeSelector.tsx — Agent Mode Selector view.
 *
 * Displays five mode cards in a horizontal row.  The active card shows a
 * green border.  Below the switcher, an "Active Agents" panel lists all 12
 * agents with green (active) or grey (inactive) indicator dots.
 */

import React from 'react'
import {
  Shield,
  HardHat,
  Monitor,
  Calculator,
  BarChart2,
  type LucideIcon,
} from 'lucide-react'
import { useMode } from '@/store/modeContext'
import type { AgentMode } from '@/types/index'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModeCard {
  id: AgentMode
  label: string
  description: string
  Icon: LucideIcon
}

type AgentName =
  | 'NEXUS'
  | 'VAULT'
  | 'PULSE'
  | 'LEDGER'
  | 'BLUEPRINT'
  | 'OHM'
  | 'SCOUT'
  | 'SPARK'
  | 'CHRONO'
  | 'ECHO'
  | 'ATLAS'
  | 'GUARDIAN'

// ── Static data ───────────────────────────────────────────────────────────────

const MODE_CARDS: ModeCard[] = [
  {
    id: 'standard',
    label: 'Standard',
    description: 'All agents active, full dashboard',
    Icon: Shield,
  },
  {
    id: 'field',
    label: 'Field',
    description: 'Voice-first, NEXUS + CHRONO + BLUEPRINT',
    Icon: HardHat,
  },
  {
    id: 'office',
    label: 'Office',
    description: 'Desk layout, LEDGER + SPARK + PULSE',
    Icon: Monitor,
  },
  {
    id: 'estimating',
    label: 'Estimating',
    description: 'VAULT + OHM + SCOUT focused',
    Icon: Calculator,
  },
  {
    id: 'executive',
    label: 'Executive',
    description: 'High-level numbers, PULSE + LEDGER only',
    Icon: BarChart2,
  },
]

const ALL_AGENTS: AgentName[] = [
  'NEXUS', 'VAULT', 'PULSE', 'LEDGER',
  'BLUEPRINT', 'OHM', 'SCOUT', 'SPARK',
  'CHRONO', 'ECHO', 'ATLAS', 'GUARDIAN',
]

const MODE_AGENTS: Record<AgentMode, Set<AgentName>> = {
  standard: new Set(ALL_AGENTS),
  field: new Set(['NEXUS', 'CHRONO', 'BLUEPRINT', 'ECHO', 'ATLAS']),
  office: new Set(['LEDGER', 'SPARK', 'PULSE', 'ECHO']),
  estimating: new Set(['VAULT', 'OHM', 'SCOUT', 'NEXUS', 'ECHO']),
  executive: new Set(['PULSE', 'LEDGER']),
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentModeSelector() {
  const { selectedMode, setSelectedMode } = useMode()

  const activeAgents = MODE_AGENTS[selectedMode]
  const activeLabel = MODE_CARDS.find(c => c.id === selectedMode)?.label ?? ''

  return (
    <div
      style={{
        padding: '24px',
        maxWidth: '960px',
        margin: '0 auto',
        color: 'var(--text-primary, #f9fafb)',
      }}
    >
      {/* ── Page title ──────────────────────────────────────────────────────── */}
      <h1
        style={{
          fontSize: '20px',
          fontWeight: 700,
          marginBottom: '4px',
          color: 'var(--text-primary, #f9fafb)',
        }}
      >
        Agent Mode
      </h1>
      <p
        style={{
          fontSize: '13px',
          color: 'var(--text-muted, #9ca3af)',
          marginBottom: '24px',
        }}
      >
        Select a mode to control which AI agents are active and which panels are
        visible.
      </p>

      {/* ── Mode switcher — 5 cards ──────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '12px',
          marginBottom: '32px',
        }}
      >
        {MODE_CARDS.map(({ id, label, description, Icon }) => {
          const isActive = selectedMode === id
          return (
            <button
              key={id}
              onClick={() => setSelectedMode(id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '16px',
                borderRadius: '10px',
                border: isActive ? '2px solid #22c55e' : '2px solid var(--border-primary, #374151)',
                backgroundColor: isActive
                  ? 'rgba(34, 197, 94, 0.10)'
                  : 'var(--bg-card, #1f2937)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 0.15s, background-color 0.15s',
                outline: 'none',
              }}
            >
              <Icon
                size={22}
                color={isActive ? '#22c55e' : 'var(--text-muted, #9ca3af)'}
              />
              <div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: isActive ? '#22c55e' : 'var(--text-primary, #f9fafb)',
                    marginBottom: '4px',
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted, #9ca3af)',
                    lineHeight: 1.4,
                  }}
                >
                  {description}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* ── Active Agents panel ──────────────────────────────────────────────── */}
      <div
        style={{
          backgroundColor: 'var(--bg-card, #1f2937)',
          border: '1px solid var(--border-primary, #374151)',
          borderRadius: '10px',
          padding: '20px',
        }}
      >
        <h2
          style={{
            fontSize: '14px',
            fontWeight: 700,
            color: 'var(--text-primary, #f9fafb)',
            marginBottom: '16px',
          }}
        >
          Active Agents — {activeLabel} Mode
        </h2>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          {ALL_AGENTS.map(agent => {
            const isAgentActive = activeAgents.has(agent)
            return (
              <div
                key={agent}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  backgroundColor: isAgentActive
                    ? 'rgba(34, 197, 94, 0.08)'
                    : 'rgba(255, 255, 255, 0.03)',
                  border: isAgentActive
                    ? '1px solid rgba(34, 197, 94, 0.25)'
                    : '1px solid var(--border-primary, #374151)',
                }}
              >
                {/* status dot */}
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    backgroundColor: isAgentActive ? '#22c55e' : '#6b7280',
                    flexShrink: 0,
                    display: 'inline-block',
                  }}
                />
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    color: isAgentActive
                      ? 'var(--text-primary, #f9fafb)'
                      : 'var(--text-muted, #6b7280)',
                  }}
                >
                  {agent}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default AgentModeSelector
