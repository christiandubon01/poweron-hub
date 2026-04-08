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
 * NW5 scope: DecisionGravityLayer (polyhedra clouds), SignalLayer (aurora + lightning), day cycle polish.
 * NW6 scope: ScenarioBuilder panel — terrain reshape sliders, snapshot save/load, compare mode.
 */

import React, { useState, useCallback } from 'react'
import { WorldEngine } from '@/components/neural-world/WorldEngine'
import { CriticalPathLayer } from '@/components/neural-world/layers/CriticalPathLayer'
import { AgentLayer } from '@/components/neural-world/layers/AgentLayer'
import { DecisionGravityLayer } from '@/components/neural-world/layers/DecisionGravityLayer'
import { SignalLayer } from '@/components/neural-world/layers/SignalLayer'
import { ScenarioBuilder } from '@/components/neural-world/ScenarioBuilder'

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

/** Layers component used inside each WorldEngine instance */
function WorldLayers({
  riversVisible,
  agentsVisible,
  gravityVisible,
  signalVisible,
}: {
  riversVisible: boolean
  agentsVisible: boolean
  gravityVisible: boolean
  signalVisible: boolean
}) {
  return (
    <>
      <CriticalPathLayer visible={riversVisible} />
      <AgentLayer visible={agentsVisible} />
      <DecisionGravityLayer visible={gravityVisible} />
      <SignalLayer visible={signalVisible} />
    </>
  )
}

export default function NeuralWorldView() {
  const [riversVisible,   setRiversVisible]   = useState(true)
  const [agentsVisible,   setAgentsVisible]   = useState(true)
  const [gravityVisible,  setGravityVisible]  = useState(true)
  const [signalVisible,   setSignalVisible]   = useState(true)

  // NW6: scenario + compare mode state
  const [scenarioActive, setScenarioActive] = useState(false)
  const [compareMode,    setCompareMode]    = useState(false)

  const handleScenarioModeChange = useCallback((active: boolean) => {
    setScenarioActive(active)
    if (!active) setCompareMode(false)
  }, [])

  const handleCompareModeChange = useCallback((active: boolean) => {
    setCompareMode(active)
  }, [])

  return (
    <div
      style={{
        width: '100%',
        height: 'calc(100vh - 56px)',
        position: 'relative',
        overflow: 'hidden',
        background: '#050508',
      }}
    >
      {/* ── Canvas area — normal or split compare ── */}
      {compareMode ? (
        /* Compare mode: live data left | scenario right */
        <div style={{ display: 'flex', width: '100%', height: '100%' }}>
          {/* Left — LIVE DATA (no scenario overrides) */}
          <div
            key="compare-live"
            style={{
              width: '50%',
              height: '100%',
              overflow: 'hidden',
              position: 'relative',
              borderRight: '2px solid rgba(245,158,11,0.4)',
            }}
          >
            <WorldEngine applyScenario={false}>
              <WorldLayers
                riversVisible={riversVisible}
                agentsVisible={agentsVisible}
                gravityVisible={gravityVisible}
                signalVisible={signalVisible}
              />
            </WorldEngine>
            {/* Left label */}
            <div style={{
              position: 'absolute',
              bottom: 8,
              left: 0,
              right: 0,
              textAlign: 'center',
              fontSize: 9,
              color: '#00e5cc',
              fontFamily: 'monospace',
              letterSpacing: 1.5,
              pointerEvents: 'none',
            }}>
              ◈ LIVE DATA
            </div>
          </div>

          {/* Right — SCENARIO (overrides applied) */}
          <div
            key="compare-scenario"
            style={{
              width: '50%',
              height: '100%',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <WorldEngine applyScenario={true}>
              <WorldLayers
                riversVisible={riversVisible}
                agentsVisible={agentsVisible}
                gravityVisible={gravityVisible}
                signalVisible={signalVisible}
              />
            </WorldEngine>
            {/* Right label */}
            <div style={{
              position: 'absolute',
              bottom: 8,
              left: 0,
              right: 0,
              textAlign: 'center',
              fontSize: 9,
              color: '#f59e0b',
              fontFamily: 'monospace',
              letterSpacing: 1.5,
              pointerEvents: 'none',
            }}>
              ◈ SCENARIO PROJECTION
            </div>
          </div>
        </div>
      ) : (
        /* Normal mode: single WorldEngine, applies scenario overrides when active */
        <WorldEngine applyScenario={true}>
          <WorldLayers
            riversVisible={riversVisible}
            agentsVisible={agentsVisible}
            gravityVisible={gravityVisible}
            signalVisible={signalVisible}
          />
        </WorldEngine>
      )}

      {/* ── NW6: Scenario Builder panel ── */}
      <ScenarioBuilder
        onScenarioModeChange={handleScenarioModeChange}
        onCompareModeChange={handleCompareModeChange}
      />

      {/* ── NW6: Mode badge — top center of canvas ── */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 25,
          pointerEvents: 'none',
        }}
      >
        {scenarioActive ? (
          <div style={{
            background: 'rgba(245,158,11,0.15)',
            border: '1px solid rgba(245,158,11,0.6)',
            color: '#f59e0b',
            padding: '4px 14px',
            borderRadius: 3,
            fontSize: 10,
            letterSpacing: 2,
            fontFamily: 'monospace',
            fontWeight: 600,
          }}>
            ⬛ SCENARIO MODE
          </div>
        ) : (
          <div style={{
            background: 'rgba(0,229,130,0.08)',
            border: '1px solid rgba(0,229,130,0.3)',
            color: '#00e582',
            padding: '4px 14px',
            borderRadius: 3,
            fontSize: 10,
            letterSpacing: 2,
            fontFamily: 'monospace',
          }}>
            ◈ LIVE DATA
          </div>
        )}
      </div>

      {/* ── HUD layer controls ── */}
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
        <button
          onClick={() => setGravityVisible(v => !v)}
          style={hudButtonStyle(gravityVisible, 160, 120, 220)}
        >
          ◈ GRAVITY {gravityVisible ? 'ON' : 'OFF'}
        </button>
        <button
          onClick={() => setSignalVisible(v => !v)}
          style={hudButtonStyle(signalVisible, 80, 200, 255)}
        >
          ◈ SIGNAL {signalVisible ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  )
}
