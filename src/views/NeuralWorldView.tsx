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
 * NW7 scope: CommandHUD (full command surface), all 10 layer toggles, FPS counter,
 *            data shadow, cinematic letterbox, crosshair, third-person orb glow (#00ff88),
 *            graceful perf degradation, Supabase layer-state persistence.
 */

import React, { useState, useCallback } from 'react'
import { WorldEngine } from '@/components/neural-world/WorldEngine'
import { CriticalPathLayer } from '@/components/neural-world/layers/CriticalPathLayer'
import { AgentLayer } from '@/components/neural-world/layers/AgentLayer'
import { DecisionGravityLayer } from '@/components/neural-world/layers/DecisionGravityLayer'
import { SignalLayer } from '@/components/neural-world/layers/SignalLayer'
import { PulseLayer } from '@/components/neural-world/layers/PulseLayer'
import { PressureLayer } from '@/components/neural-world/layers/PressureLayer'
import { VelocityLayer } from '@/components/neural-world/layers/VelocityLayer'
import { RiskSurfaceLayer } from '@/components/neural-world/layers/RiskSurfaceLayer'
import { ForecastLayer } from '@/components/neural-world/layers/ForecastLayer'
import { CommandLayer } from '@/components/neural-world/layers/CommandLayer'
import { ScenarioBuilder } from '@/components/neural-world/ScenarioBuilder'
import CommandHUD, {
  AtmosphereMode as HUDAtmosphereMode,
  CameraMode as HUDCameraMode,
  type LayerStates,
} from '@/components/neural-world/CommandHUD'

// ── Default layer state ───────────────────────────────────────────────────────

const DEFAULT_LAYER_STATES: LayerStates = {
  'pulse':            false,
  'pressure':         true,   // ON by default
  'critical-path':    false,
  'agents':           false,
  'decision-gravity': false,
  'velocity':         false,
  'risk-surface':     true,   // ON by default
  'signal':           false,
  'forecast':         false,
  'command':          false,
}

// ── WorldLayers — renders all layer components inside a single WorldEngine ────

function WorldLayers({ layerStates }: { layerStates: LayerStates }) {
  return (
    <>
      <PulseLayer           visible={!!layerStates['pulse']} />
      <PressureLayer        visible={!!layerStates['pressure']} />
      <CriticalPathLayer    visible={!!layerStates['critical-path']} />
      <AgentLayer           visible={!!layerStates['agents']} />
      <DecisionGravityLayer visible={!!layerStates['decision-gravity']} />
      <VelocityLayer        visible={!!layerStates['velocity']} />
      <RiskSurfaceLayer     visible={!!layerStates['risk-surface']} />
      <SignalLayer          visible={!!layerStates['signal']} />
      <ForecastLayer        visible={!!layerStates['forecast']} />
      <CommandLayer         visible={!!layerStates['command']} />
    </>
  )
}

// ── Main View ─────────────────────────────────────────────────────────────────

export default function NeuralWorldView() {
  // NW7: Unified layer state
  const [layerStates, setLayerStates] = useState<LayerStates>(DEFAULT_LAYER_STATES)

  // NW7: HUD atmosphere + camera mode (synced to WorldEngine via events)
  const [atmosphereMode, setAtmosphereMode] = useState<HUDAtmosphereMode>(HUDAtmosphereMode.SCIFI_V1)
  const [cameraMode, setCameraMode] = useState<HUDCameraMode>(HUDCameraMode.FIRST_PERSON)

  // NW6: scenario + compare mode state
  const [scenarioActive, setScenarioActive] = useState(false)
  const [compareMode,    setCompareMode]    = useState(false)

  const handleLayerToggle = useCallback((id: string, value: boolean) => {
    setLayerStates(prev => ({ ...prev, [id]: value }))
  }, [])

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
            <WorldEngine applyScenario={false} hideBuiltinHUD={true}>
              <WorldLayers layerStates={layerStates} />
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
            <WorldEngine applyScenario={true} hideBuiltinHUD={true}>
              <WorldLayers layerStates={layerStates} />
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
        <WorldEngine applyScenario={true} hideBuiltinHUD={true}>
          <WorldLayers layerStates={layerStates} />
        </WorldEngine>
      )}

      {/* ── NW6: Scenario Builder panel ── */}
      <ScenarioBuilder
        onScenarioModeChange={handleScenarioModeChange}
        onCompareModeChange={handleCompareModeChange}
      />

      {/* ── NW6: Mode badge — top center of canvas ── */}
      {scenarioActive && (
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
        </div>
      )}

      {/* ── NW7: CommandHUD — full command surface ── */}
      <CommandHUD
        layerStates={layerStates}
        onLayerToggle={handleLayerToggle}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        atmosphereMode={atmosphereMode}
        onAtmosphereModeChange={setAtmosphereMode}
      />
    </div>
  )
}
