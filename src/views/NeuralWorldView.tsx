/**
 * NeuralWorldView.tsx — Entry point for the Neural World 3D visualization.
 *
 * Full-viewport canvas. Height: calc(100vh - 56px).
 * Route: neural-world
 * Role gate: owner + admin only (enforced via sidebar placement in adminBucket3).
 *
 * NW1 scope: World engine foundation only — no data connection.
 * NW2 scope: TerrainGenerator (mountains from Supabase project data).
 * NW3 scope: CriticalPathLayer (flowing particle rivers — payment pipelines).
 * NW4 scope: AgentLayer (11 agents as distinct 3D entities with behavior).
 */

import React, { useState } from 'react'
import { WorldEngine } from '@/components/neural-world/WorldEngine'
import { CriticalPathLayer } from '@/components/neural-world/layers/CriticalPathLayer'
import { AgentLayer } from '@/components/neural-world/layers/AgentLayer'

function hudButtonStyle(active: boolean, r: number, g: number, b: number): React.CSSProperties {
  return {
    background: active ? `rgba(${r},${g},${b},0.18)` : 'rgba(255,255,255,0.04)',
    border: `1px solid ${active ? `rgb(${r},${g},${b})` : 'rgba(255,255,255,0.12)'}`,
    color: active ? `rgb(${r},${g},${b})` : 'rgba(255,255,255,0.35)',
    padding: '5px 11px',
    borderRadius: 3,
    fontSize: 10,
    letterSpacing: 1.2,
    cursor: 'pointer',
    fontFamily: 'monospace',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap' as const,
  }
}

export default function NeuralWorldView() {
  const [riversVisible, setRiversVisible] = useState(true)
  const [agentsVisible, setAgentsVisible] = useState(true)

  return (
    <div
      style={{
        width: '100%',
        height: 'calc(100vh - 56px)',
        position: 'relative',
        overflow: 'hidden',
        background: '#050a08',
      }}
    >
      <WorldEngine>
        <CriticalPathLayer visible={riversVisible} />
        <AgentLayer visible={agentsVisible} />
      </WorldEngine>

      {/* HUD layer controls */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          pointerEvents: 'auto',
        }}
      >
        <button
          onClick={() => setRiversVisible(v => !v)}
          style={hudButtonStyle(riversVisible, 64, 192, 160)}
        >
          ◈ RIVERS {riversVisible ? 'ON' : 'OFF'}
        </button>
        <button
          onClick={() => setAgentsVisible(v => !v)}
          style={hudButtonStyle(agentsVisible, 192, 160, 32)}
        >
          ◈ AGENTS {agentsVisible ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  )
}
