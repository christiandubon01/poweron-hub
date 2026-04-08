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

import React, { useState, useCallback, useEffect, useRef } from 'react'
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
import { EastContinentLayer } from '@/components/neural-world/layers/EastContinentLayer'
import { AccountingLayer } from '@/components/neural-world/layers/AccountingLayer'
import { CustomerTerritoryLayer } from '@/components/neural-world/layers/CustomerTerritoryLayer'
import { EnterpriseMetricsLayer } from '@/components/neural-world/layers/EnterpriseMetricsLayer'
import { DiveModePanel } from '@/components/neural-world/DiveModePanel'
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

function WorldLayers({
  layerStates,
  atmosphereMode,
}: {
  layerStates: LayerStates
  atmosphereMode: HUDAtmosphereMode
}) {
  const isV5 = atmosphereMode === HUDAtmosphereMode.V5_ENTERPRISE
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
      <EastContinentLayer />
      <AccountingLayer />
      <CustomerTerritoryLayer />
      {/* NW14: V5 Enterprise Metrics — night mirror world */}
      <EnterpriseMetricsLayer visible={isV5} />
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

  // NW14: V5 Enterprise badge — shows on first V5 entry
  const [showV5Badge, setShowV5Badge] = useState(false)
  const v5BadgeDismissedRef = useRef(false)
  const v5EnteredRef = useRef(false)

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

  // NW14: V5 badge on first entry into V5_ENTERPRISE mode
  useEffect(() => {
    if (atmosphereMode === HUDAtmosphereMode.V5_ENTERPRISE && !v5EnteredRef.current) {
      v5EnteredRef.current = true
      if (!v5BadgeDismissedRef.current) {
        setShowV5Badge(true)
        setTimeout(() => {
          setShowV5Badge(false)
          v5BadgeDismissedRef.current = true
        }, 5000)
      }
    }
  }, [atmosphereMode])

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
              <WorldLayers layerStates={layerStates} atmosphereMode={atmosphereMode} />
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
              <WorldLayers layerStates={layerStates} atmosphereMode={atmosphereMode} />
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
          <WorldLayers layerStates={layerStates} atmosphereMode={atmosphereMode} />
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

      {/* ── NW14: V5 Enterprise complete badge — shows on first V5 entry ── */}
      {showV5Badge && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 50,
            pointerEvents: 'none',
            animation: 'fadeInOut 5s ease-in-out forwards',
          }}
        >
          <div style={{
            background: 'rgba(15, 5, 35, 0.92)',
            border: '1px solid rgba(160, 80, 255, 0.8)',
            borderRadius: 12,
            padding: '24px 40px',
            textAlign: 'center',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 0 60px rgba(120, 40, 220, 0.5)',
          }}>
            <div style={{
              fontSize: 11,
              letterSpacing: 4,
              color: 'rgba(160, 100, 255, 0.7)',
              marginBottom: 8,
              fontFamily: 'monospace',
            }}>
              NEURAL WORLD
            </div>
            <div style={{
              fontSize: 22,
              fontWeight: 700,
              color: '#c080ff',
              letterSpacing: 2,
              fontFamily: 'monospace',
              marginBottom: 6,
            }}>
              ◈ V5 ENTERPRISE
            </div>
            <div style={{
              fontSize: 11,
              color: 'rgba(200, 170, 255, 0.75)',
              letterSpacing: 1,
              fontFamily: 'monospace',
            }}>
              NIGHT MIRROR WORLD · ENTERPRISE METRICS LANDSCAPE
            </div>
          </div>
        </div>
      )}

      {/* ── NW13: DiveModePanel — client territory intelligence overlay ── */}
      <DiveModePanel />

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
