/**
 * SimulationHUD.tsx — NW19: Enterprise simulation HUD overlay.
 *
 * Renders:
 *   - 5 preset selector buttons (SOLO → TEAM_100)
 *   - Live stats bar: human count, AI count, monthly cost, coverage %
 *   - Scrollable role toggle list (HU ↔ AI per role)
 *   - Enterprise cost comparison panel (TEAM_100 only)
 *   - ▶ PLAY BUSINESS CYCLE button + ESC/stop state
 *
 * Communicates via:
 *   - nw:sim-stats → receive stats updates
 *   - nw:sim-role-toggled → receive toggle confirmations
 *   - nw:sim-play-cycle / nw:sim-stop-cycle → dispatch to DotTraveler
 *   - nw:sim-preset → dispatch preset change to SimulationLayer
 */

import React, { useState, useEffect, useCallback } from 'react'
import type { SimPreset, SimStats } from './layers/SimulationLayer'
import { getSimulationManager } from './layers/SimulationLayer'

// ── Preset config ─────────────────────────────────────────────────────────────

interface PresetDef {
  id: SimPreset
  label: string
  icon: string
  size: number
}

const PRESETS: PresetDef[] = [
  { id: 'SOLO',     label: 'SOLO',    icon: '◉', size: 1  },
  { id: 'TEAM_5',   label: 'TEAM 5',  icon: '◈', size: 5  },
  { id: 'TEAM_20',  label: 'TEAM 20', icon: '▣', size: 20 },
  { id: 'TEAM_50',  label: 'TEAM 50', icon: '◆', size: 50 },
  { id: 'TEAM_100', label: 'CORP 100',icon: '⬡', size: 100},
]

// ── Component ─────────────────────────────────────────────────────────────────

interface SimulationHUDProps {
  /** Whether the simulation layer is visible */
  visible: boolean
}

export function SimulationHUD({ visible }: SimulationHUDProps) {
  const [preset, setPreset] = useState<SimPreset>('SOLO')
  const [stats, setStats] = useState<SimStats>({
    humanCount: 3,
    aiCount: 0,
    totalCostPerMonth: 21000,
    coveragePercent: 22,
    preset: 'SOLO',
  })
  const [cyclePlaying, setCyclePlaying] = useState(false)
  const [cycleEnded, setCycleEnded] = useState(false)

  // Subscribe to stats updates from SimulationLayer
  useEffect(() => {
    function onStats(e: Event) {
      const ev = e as CustomEvent<SimStats>
      if (ev.detail) setStats(ev.detail)
    }
    window.addEventListener('nw:sim-stats', onStats)
    return () => window.removeEventListener('nw:sim-stats', onStats)
  }, [])

  // Subscribe to cycle end
  useEffect(() => {
    function onCycleEnd() {
      setCyclePlaying(false)
      setCycleEnded(true)
      setTimeout(() => setCycleEnded(false), 4000)
    }
    window.addEventListener('nw:sim-cycle-end', onCycleEnd)
    return () => window.removeEventListener('nw:sim-cycle-end', onCycleEnd)
  }, [])

  const selectPreset = useCallback((p: SimPreset) => {
    setPreset(p)
    window.dispatchEvent(new CustomEvent('nw:sim-preset', { detail: { preset: p } }))
    const mgr = getSimulationManager()
    mgr?.loadPreset(p)
    setCyclePlaying(false)
  }, [])

  const toggleRole = useCallback((roleId: string) => {
    const mgr = getSimulationManager()
    mgr?.toggleRole(roleId)
  }, [])

  const playBusinessCycle = useCallback(() => {
    if (cyclePlaying) {
      // Stop
      window.dispatchEvent(new CustomEvent('nw:sim-stop-cycle'))
      setCyclePlaying(false)
    } else {
      window.dispatchEvent(new CustomEvent('nw:sim-play-cycle', { detail: { preset } }))
      setCyclePlaying(true)
      setCycleEnded(false)
    }
  }, [cyclePlaying, preset])

  const roles = getSimulationManager()?.getRoles() ?? []

  if (!visible) return null

  return (
    <div style={{
      position: 'absolute',
      top: 60,
      right: 14,
      zIndex: 30,
      width: 220,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      fontFamily: 'monospace',
      pointerEvents: 'all',
    }}>
      {/* ── Header ── */}
      <div style={{
        background: 'rgba(5,5,20,0.92)',
        border: '1px solid rgba(0,229,204,0.3)',
        borderRadius: 8,
        padding: '8px 10px',
        backdropFilter: 'blur(8px)',
      }}>
        <div style={{ color: '#00e5cc', fontSize: 9, letterSpacing: 2, fontWeight: 700, marginBottom: 6 }}>
          ⬡ ENTERPRISE SIM
        </div>

        {/* Preset selector */}
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>
          {PRESETS.map(p => {
            const active = p.id === preset
            return (
              <button key={p.id} onClick={() => selectPreset(p.id)} style={{
                flex: '1 1 30%',
                padding: '4px 2px',
                fontSize: 8,
                letterSpacing: 0.5,
                borderRadius: 4,
                border: `1px solid ${active ? 'rgba(0,229,204,0.7)' : 'rgba(255,255,255,0.12)'}`,
                background: active ? 'rgba(0,229,204,0.2)' : 'rgba(0,0,0,0.4)',
                color: active ? '#00e5cc' : 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                transition: 'all 0.12s',
                textAlign: 'center',
              }}>
                {p.icon} {p.label}
              </button>
            )
          })}
        </div>

        {/* Stats bar */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 4,
          marginBottom: 6,
        }}>
          <StatChip label="HUMANS" value={String(stats.humanCount)} color="#ffa040" />
          <StatChip label="AI" value={String(stats.aiCount)} color="#00e5cc" />
          <StatChip label="COST/MO" value={`$${(stats.totalCostPerMonth / 1000).toFixed(1)}k`} color="#ffe060" />
          <StatChip label="COVERAGE" value={`${stats.coveragePercent}%`} color={stats.coveragePercent > 60 ? '#60ff90' : '#ff6040'} />
        </div>

        {/* Coverage gradient bar */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${stats.coveragePercent}%`,
              borderRadius: 3,
              background: `linear-gradient(90deg, #ffa040, #00e5cc)`,
              transition: 'width 0.4s',
            }} />
          </div>
        </div>

        {/* Play business cycle button */}
        <button onClick={playBusinessCycle} style={{
          width: '100%',
          padding: '6px 8px',
          fontSize: 9,
          letterSpacing: 1,
          fontFamily: 'monospace',
          fontWeight: 700,
          borderRadius: 5,
          border: `1px solid ${cyclePlaying ? 'rgba(255,80,60,0.7)' : 'rgba(0,229,204,0.6)'}`,
          background: cyclePlaying ? 'rgba(255,80,60,0.2)' : 'rgba(0,229,204,0.15)',
          color: cyclePlaying ? '#ff6040' : '#00e5cc',
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}>
          {cyclePlaying ? '⏹ STOP CYCLE' : cycleEnded ? '↺ REPLAY CYCLE' : '▶ PLAY BUSINESS CYCLE'}
        </button>
      </div>

      {/* ── Role Toggles ── */}
      {roles.length > 0 && (
        <div style={{
          background: 'rgba(5,5,20,0.90)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
          padding: '8px 10px',
          backdropFilter: 'blur(8px)',
          maxHeight: 200,
          overflowY: 'auto',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 8, letterSpacing: 1.5, marginBottom: 5 }}>
            ROLE TOGGLE
          </div>
          {roles.map(role => (
            <RoleToggleRow
              key={role.id}
              label={role.label}
              count={role.count}
              isAI={role.isAI}
              humanCost={role.humanCostPerMonth}
              aiCost={role.aiCostPerMonth}
              onToggle={() => toggleRole(role.id)}
            />
          ))}
        </div>
      )}

      {/* ── TEAM_100: Enterprise Cost Comparison ── */}
      {preset === 'TEAM_100' && (
        <div style={{
          background: 'rgba(5,5,20,0.90)',
          border: '1px solid rgba(255,224,60,0.2)',
          borderRadius: 8,
          padding: '8px 10px',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ color: '#ffe060', fontSize: 8, letterSpacing: 1.5, marginBottom: 5 }}>
            COST COMPARISON
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 8 }}>All human</span>
            <span style={{ color: '#ffa040', fontSize: 9 }}>~$650k/mo</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 8 }}>Current mix</span>
            <span style={{ color: '#ffe060', fontSize: 9 }}>${(stats.totalCostPerMonth / 1000).toFixed(1)}k/mo</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 8 }}>AI-optimized</span>
            <span style={{ color: '#00e5cc', fontSize: 9 }}>
              {stats.aiCount > 0
                ? `~${(stats.totalCostPerMonth * 0.35 / 1000).toFixed(0)}k/mo est.`
                : 'Toggle roles →'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      borderRadius: 4,
      padding: '3px 5px',
    }}>
      <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 7, letterSpacing: 0.8 }}>{label}</div>
      <div style={{ color, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>{value}</div>
    </div>
  )
}

function RoleToggleRow({
  label, count, isAI, humanCost, aiCost, onToggle,
}: {
  label: string
  count: number
  isAI: boolean
  humanCost: number
  aiCost: number
  onToggle: () => void
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '3px 0',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <div>
        <div style={{ color: isAI ? '#00e5cc' : '#ffa040', fontSize: 8, letterSpacing: 0.5 }}>
          {label} ×{count}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 7 }}>
          ${isAI ? aiCost : humanCost}/mo ea
        </div>
      </div>
      <button onClick={onToggle} style={{
        padding: '2px 7px',
        fontSize: 7,
        letterSpacing: 0.8,
        fontFamily: 'monospace',
        borderRadius: 3,
        border: `1px solid ${isAI ? 'rgba(0,229,204,0.5)' : 'rgba(255,160,64,0.5)'}`,
        background: isAI ? 'rgba(0,229,204,0.15)' : 'rgba(255,160,64,0.1)',
        color: isAI ? '#00e5cc' : '#ffa040',
        cursor: 'pointer',
        transition: 'all 0.12s',
      }}>
        {isAI ? 'AI' : 'HU'}
      </button>
    </div>
  )
}
