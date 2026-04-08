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
 */

import React, { useState } from 'react'
import { WorldEngine } from '@/components/neural-world/WorldEngine'
import { CriticalPathLayer } from '@/components/neural-world/layers/CriticalPathLayer'

export default function NeuralWorldView() {
  const [riversVisible, setRiversVisible] = useState(true)

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
      </WorldEngine>

      {/* HUD layer controls — NW3 rivers toggle */}
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
          style={{
            background: riversVisible
              ? 'rgba(64, 192, 160, 0.18)'
              : 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${riversVisible ? '#40c0a0' : 'rgba(255,255,255,0.12)'}`,
            color: riversVisible ? '#40c0a0' : 'rgba(255,255,255,0.35)',
            padding: '5px 11px',
            borderRadius: 3,
            fontSize: 10,
            letterSpacing: 1.2,
            cursor: 'pointer',
            fontFamily: 'monospace',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
          }}
        >
          ◈ RIVERS {riversVisible ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  )
}
