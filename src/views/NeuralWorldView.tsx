/**
 * NeuralWorldView.tsx — Entry point for the Neural World 3D visualization.
 *
 * NW7b: Full screen mode (100vw × 100vh), no footer visible.
 *       Sidebar collapses to icon-only when Neural World opens.
 *       ESC exits fullscreen and restores sidebar.
 *       Fullscreen toggle button in HUD top-left.
 *       Scroll lock: all wheel events captured inside canvas.
 *
 * Route: neural-world
 * Role gate: owner + admin only.
 */

import React, { useState, useCallback, useEffect } from 'react'
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
import { ContinentLayer } from '@/components/neural-world/layers/ContinentLayer'
import { WestContinentLayer } from '@/components/neural-world/layers/WestContinentLayer'
import { ScenarioBuilder } from '@/components/neural-world/ScenarioBuilder'
import CommandHUD, {
  AtmosphereMode as HUDAtmosphereMode,
  CameraMode as HUDCameraMode,
  type LayerStates,
} from '@/components/neural-world/CommandHUD'

// ── Default layer state ───────────────────────────────────────────────────────

const DEFAULT_LAYER_STATES: LayerStates = {
  'pulse':            false,
  'pressure':         true,
  'critical-path':    false,
  'agents':           false,
  'decision-gravity': false,
  'velocity':         false,
  'risk-surface':     true,
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
      <ContinentLayer />
      <WestContinentLayer />
    </>
  )
}

// ── Main View ─────────────────────────────────────────────────────────────────

export default function NeuralWorldView() {
  // NW7: Unified layer state
  const [layerStates, setLayerStates] = useState<LayerStates>(DEFAULT_LAYER_STATES)

  // NW7: HUD atmosphere + camera mode
  const [atmosphereMode, setAtmosphereMode] = useState<HUDAtmosphereMode>(HUDAtmosphereMode.SCIFI_V1)
  const [cameraMode, setCameraMode] = useState<HUDCameraMode>(HUDCameraMode.FIRST_PERSON)

  // NW6: scenario + compare mode state
  const [scenarioActive, setScenarioActive] = useState(false)
  const [compareMode,    setCompareMode]    = useState(false)

  // NW7b: Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false)

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

  // NW7b: Toggle fullscreen — dispatch event for V15rLayout to respond
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => {
      const next = !prev
      window.dispatchEvent(new CustomEvent('nw:fullscreen', { detail: { fullscreen: next } }))
      return next
    })
  }, [])

  // NW7b: Auto-enter fullscreen on mount, restore on unmount
  useEffect(() => {
    // Auto-enter fullscreen
    setIsFullscreen(true)
    window.dispatchEvent(new CustomEvent('nw:fullscreen', { detail: { fullscreen: true } }))

    return () => {
      // Restore on unmount
      window.dispatchEvent(new CustomEvent('nw:fullscreen', { detail: { fullscreen: false } }))
    }
  }, [])

  // NW7b: ESC key exits fullscreen (but not pointer lock — that's handled by CameraController)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Escape' && isFullscreen && !document.pointerLockElement) {
        setIsFullscreen(false)
        window.dispatchEvent(new CustomEvent('nw:fullscreen', { detail: { fullscreen: false } }))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFullscreen])

  // NW7b: Scroll lock at document level
  useEffect(() => {
    function preventScroll(e: WheelEvent) {
      e.preventDefault()
    }
    document.addEventListener('wheel', preventScroll, { passive: false })
    return () => {
      document.removeEventListener('wheel', preventScroll)
    }
  }, [])

  return (
    <div
      style={{
        width: '100%',
        height: isFullscreen ? '100vh' : 'calc(100vh - 56px)',
        position: isFullscreen ? 'fixed' : 'relative',
        inset: isFullscreen ? 0 : undefined,
        zIndex: isFullscreen ? 100 : undefined,
        overflow: 'hidden',
        background: '#050508',
      }}
    >
      {/* ── Canvas area — normal or split compare ── */}
      {compareMode ? (
        <div style={{ display: 'flex', width: '100%', height: '100%' }}>
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
        <WorldEngine applyScenario={true} hideBuiltinHUD={true}>
          <WorldLayers layerStates={layerStates} />
        </WorldEngine>
      )}

      {/* ── NW6: Scenario Builder panel ── */}
      <ScenarioBuilder
        onScenarioModeChange={handleScenarioModeChange}
        onCompareModeChange={handleCompareModeChange}
      />

      {/* ── NW6: Mode badge ── */}
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

      {/* ── NW7b: CommandHUD — full command surface with fullscreen toggle ── */}
      <CommandHUD
        layerStates={layerStates}
        onLayerToggle={handleLayerToggle}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        atmosphereMode={atmosphereMode}
        onAtmosphereModeChange={setAtmosphereMode}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
    </div>
  )
}
