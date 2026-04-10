/**
 * NeuralWorldView.tsx — Entry point for the Neural World 3D visualization.
 *
 * NW7b: Full screen mode (100vw × 100vh), no footer visible.
 *       Sidebar collapses to icon-only when Neural World opens.
 *       ESC exits fullscreen and restores sidebar.
 *       Fullscreen toggle button in HUD top-left.
 *       Scroll lock: all wheel events captured inside canvas.
 *
 * NW15 additions:
 *   - Loading screen with 4-stage progress bar (25/50/75/100%)
 *   - Mobile graceful degradation: viewport < 768px shows "requires desktop" message
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
import { NodeClickSystem } from '@/components/neural-world/NodeClickSystem'
import { DataFlowLayer } from '@/components/neural-world/DataFlowLayer'
import { SimulationLayer } from '@/components/neural-world/layers/SimulationLayer'
import { SimDotTravelerController } from '@/components/neural-world/SimulationDotTraveler'
import { RiverSystemLayer } from '@/components/neural-world/layers/RiverSystemLayer'
import { DragDropSystem } from '@/components/neural-world/DragDropSystem'
import { NexusCompanion } from '@/components/neural-world/NexusCompanion'
import { AgentFlightLayer } from '@/components/neural-world/layers/AgentFlightLayer'
import { HumanWorkerLayer } from '@/components/neural-world/layers/HumanWorkerLayer'
import { HandoffChain } from '@/components/neural-world/HandoffChain'
import { FortressLayer } from '@/components/neural-world/layers/FortressLayer'
import { FogDomainLayer } from '@/components/neural-world/layers/FogDomainLayer'
import { KatsuroBridgeLayer } from '@/components/neural-world/layers/KatsuroBridgeLayer'
import { AutomationFlowLayer } from '@/components/neural-world/layers/AutomationFlowLayer'
import { AutomationFlowBuilder, FlowsButton } from '@/components/neural-world/AutomationFlowBuilder'
import { NexusSweepController } from '@/components/neural-world/NexusSweepController'
import { FlightAnalyticsPanel } from '@/components/neural-world/FlightAnalyticsPanel'
import { AgentRosterPanel, KatsuroSubtitleOverlay } from '@/components/neural-world/AgentRosterPanel'
import CommandHUD, {
  AtmosphereMode as HUDAtmosphereMode,
  CameraMode as HUDCameraMode,
  type LayerStates,
} from '@/components/neural-world/CommandHUD'
import { TemporalProvider } from '@/components/neural-world/TemporalDataEngine'
import TemporalNavigator from '@/components/neural-world/TemporalNavigator'
import { subscribeWorldData, type NWWorldData } from '@/components/neural-world/DataBridge'
import { ResonanceOrb } from '@/components/neural-world/ResonanceOrb'
import { ProximityInfoCard } from '@/components/neural-world/ProximityInfoCard'
import { GuidedTour } from '@/components/neural-world/GuidedTour'
import { IncomeTutorial } from '@/components/neural-world/IncomeTutorial'
import { FossilRecordLayer } from '@/components/neural-world/FossilRecordLayer'

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
  'data-flow':        true,   // NW18: data flow on by default
  'simulation':       false,  // NW19: enterprise simulation
  'agent-flight':     false,  // NW28: agent flight system — domains, orbs, task cycles
  'human-workers':    false,  // NW28b: human worker amber orbs
  // NW31: fog domain layers — all off by default (opt-in visualization)
  'fog-revenue':      false,
  'fog-security':     false,
  'fog-bandwidth':    false,
  'fog-improvement':  false,
  // NW35: Katsuro Bridge Tower
  'katsuro-bridge':   false,
  // NW36: Automation flow layer — ground-level n8n-style paths
  'automation-flows': false,
  // NW39: Time navigation slider — scrub past/future world states
  'time-navigation':  false,
  // NW40: Resonance orb — operational harmony indicator + world speed
  'resonance-orb':    true,
  // NW-PROX: Proximity info cards — domain awareness HUD, on by default
  'proximity-info':   true,
  // NW60: Fossil Record — archaeological layer for completed projects, off by default
  'fossil-record':    false,
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
      {/* NW18: Clickable nodes with info panels */}
      <NodeClickSystem />
      {/* NW18: Data flow connection tubes + animated particles */}
      <DataFlowLayer visible={!!layerStates['data-flow']} />
      {/* NW19: Enterprise simulation — org pyramids, AI agent placement */}
      <SimulationLayer visible={!!layerStates['simulation']} />
      {/* NW19: Business cycle dot traveler (renders Three.js + React summary panel) */}
      <SimDotTravelerController />
      {/* NW28: Agent flight system — domain zones, flying orbs, task cycles, data cubes */}
      <AgentFlightLayer visible={!!layerStates['agent-flight']} />
      {/* NW28b: Human worker amber orbs — ground movement, shift coverage, handoff chain */}
      <HumanWorkerLayer visible={!!layerStates['human-workers']} />
      {/* NW28b: Handoff chain visualization — gold flashes at AI↔Human handoff points */}
      <HandoffChain />
      {/* NW23: River system — cash flow visualization, tributaries, MTZ correction */}
      <RiverSystemLayer />
      {/* NW24: Drag-and-drop node repositioning */}
      <DragDropSystem />
      {/* NW26: NEXUS walk-along companion — avatar + voice + vision system */}
      <NexusCompanion />
      {/* NW30: Fortress Command Center — walkable compound at east boundary */}
      <FortressLayer />
      {/* NW31: Fog domain layers — revenue, security, bandwidth, improvement */}
      <FogDomainLayer
        revenueFogVisible={!!layerStates['fog-revenue']}
        securityFogVisible={!!layerStates['fog-security']}
        bandwidthFogVisible={!!layerStates['fog-bandwidth']}
        improvementFogVisible={!!layerStates['fog-improvement']}
      />
      {/* NW35: Katsuro Bridge Tower + planned agent wireframes + life blocks */}
      <KatsuroBridgeLayer visible={!!layerStates['katsuro-bridge']} />
      {/* NW36: Automation flow layer — ground-level trigger→condition→action→result paths */}
      <AutomationFlowLayer visible={!!layerStates['automation-flows']} />
      {/* NW40: Resonance orb — central harmony indicator at Founders Valley y=12 */}
      <ResonanceOrb visible={!!layerStates['resonance-orb']} />
      {/* NW-PROX: Proximity info cards — domain awareness HUD */}
      <ProximityInfoCard visible={!!layerStates['proximity-info']} />
      {/* NW-TUTORIAL: Guided Tour — must be inside WorldEngine for useWorldContext access */}
      <GuidedTour />
      {/* NW44: Income Tutorial — 8-step income target walkthrough, NEXUS narrated */}
      <IncomeTutorial />
      {/* NW60: Fossil Record — archaeological layer for completed/archived projects */}
      <FossilRecordLayer visible={!!layerStates['fossil-record']} />
    </>
  )
}

// ── Main View ─────────────────────────────────────────────────────────────────

// ── Loading stage definition ──────────────────────────────────────────────────

interface LoadStage {
  label: string
  pct: number
}

const LOAD_STAGES: LoadStage[] = [
  { label: 'Connecting to data',    pct: 25  },
  { label: 'Generating terrain',    pct: 50  },
  { label: 'Initializing atmosphere', pct: 75 },
  { label: 'Ready',                 pct: 100 },
]

// ── Mobile guard ──────────────────────────────────────────────────────────────

function MobileGuard() {
  return (
    <div style={{
      width: '100%',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#050508',
      color: '#00e5cc',
      fontFamily: 'monospace',
      padding: '24px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 32, marginBottom: 16 }}>◈</div>
      <div style={{ fontSize: 14, letterSpacing: 2, marginBottom: 8 }}>
        NEURAL WORLD
      </div>
      <div style={{
        fontSize: 11,
        color: 'rgba(0,229,204,0.6)',
        letterSpacing: 1,
        lineHeight: 1.7,
        maxWidth: 280,
      }}>
        Neural World requires a desktop browser for the full 3D experience.
      </div>
      <div style={{ marginTop: 20 }}>
        <a
          href="/"
          style={{
            fontSize: 10,
            color: 'rgba(0,229,204,0.5)',
            letterSpacing: 1.5,
            textDecoration: 'none',
            border: '1px solid rgba(0,229,204,0.3)',
            padding: '6px 14px',
            borderRadius: 3,
          }}
        >
          ← RETURN TO DASHBOARD
        </a>
      </div>
    </div>
  )
}

// ── Loading screen ────────────────────────────────────────────────────────────

function LoadingScreen({ stage }: { stage: LoadStage }) {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 200,
      background: '#050508',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'monospace',
    }}>
      {/* Title */}
      <div style={{ fontSize: 10, letterSpacing: 4, color: 'rgba(0,229,204,0.5)', marginBottom: 12 }}>
        POWERON
      </div>
      <div style={{ fontSize: 20, letterSpacing: 3, color: '#00e5cc', marginBottom: 32 }}>
        ◈ NEURAL WORLD
      </div>

      {/* Stage label */}
      <div style={{
        fontSize: 11,
        color: 'rgba(0,229,204,0.8)',
        letterSpacing: 1.5,
        marginBottom: 16,
      }}>
        {stage.label}
      </div>

      {/* Progress bar */}
      <div style={{
        width: 260,
        height: 2,
        background: 'rgba(0,229,204,0.1)',
        borderRadius: 1,
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: '100%',
          width: `${stage.pct}%`,
          background: '#00e5cc',
          transition: 'width 0.4s ease',
          boxShadow: '0 0 8px #00e5cc',
        }} />
      </div>

      {/* Percentage */}
      <div style={{
        fontSize: 10,
        color: 'rgba(0,229,204,0.45)',
        letterSpacing: 1,
        marginTop: 10,
      }}>
        {stage.pct}%
      </div>
    </div>
  )
}

// ── Main View ─────────────────────────────────────────────────────────────────

export default function NeuralWorldView() {
  // NW15: Mobile guard — show message if viewport < 768px
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 768) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // NW27: Ref to outer container div — used to find canvas for wheel capture
  const outerContainerRef = useRef<HTMLDivElement>(null)
  // NW27: Track panel open state to gate ESC handler (panel ESC wins over fullscreen ESC)
  const isPanelOpenRef = useRef(false)

  // NW15: Loading screen state
  const [loadStageIdx, setLoadStageIdx] = useState(0)
  const [loadDone, setLoadDone] = useState(false)

  // Advance through loading stages on mount
  useEffect(() => {
    if (isMobile) return
    // Stage 0 → stage 1 after 400ms (data connection)
    const t1 = setTimeout(() => setLoadStageIdx(1), 400)
    // Stage 1 → stage 2 after another 600ms (terrain gen)
    const t2 = setTimeout(() => setLoadStageIdx(2), 1000)
    // Stage 2 → stage 3 after another 500ms (atmosphere)
    const t3 = setTimeout(() => setLoadStageIdx(3), 1500)
    // Stage 3 → hide loading screen after another 400ms (ready)
    const t4 = setTimeout(() => setLoadDone(true), 1900)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [isMobile])

  // NW7: Unified layer state
  const [layerStates, setLayerStates] = useState<LayerStates>(DEFAULT_LAYER_STATES)

  // NW7: HUD atmosphere + camera mode — NW16: ORBIT is new default
  const [atmosphereMode, setAtmosphereMode] = useState<HUDAtmosphereMode>(HUDAtmosphereMode.SCIFI_V1)
  const [cameraMode, setCameraMode] = useState<HUDCameraMode>(HUDCameraMode.ORBIT)

  // NW6: scenario + compare mode state
  const [scenarioActive,  setScenarioActive]  = useState(false)
  const [compareMode,     setCompareMode]     = useState(false)
  // NW22: scenario selection label for badge
  const [scenarioLabel,   setScenarioLabel]   = useState('BALANCED × TEAM_20')

  // NW7b: Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false)

  // NW35: Agent Roster panel
  const [rosterOpen, setRosterOpen] = useState(false)

  // NW36: Automation Flow Builder panel
  const [flowBuilderOpen, setFlowBuilderOpen] = useState(false)

  // NW39: World data subscription for TemporalDataEngine
  const [nwWorldData, setNwWorldData] = useState<NWWorldData | null>(null)
  useEffect(() => {
    const unsub = subscribeWorldData(data => setNwWorldData(data))
    return unsub
  }, [])

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
  // NW27: If a node info panel is open, ESC is handled by NodeClickSystem first — don't exit fullscreen
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Escape' && isFullscreen && !document.pointerLockElement && !isPanelOpenRef.current) {
        setIsFullscreen(false)
        window.dispatchEvent(new CustomEvent('nw:fullscreen', { detail: { fullscreen: false } }))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFullscreen])

  // NW27: Attach wheel preventDefault to the actual canvas element (not a parent div).
  // CameraController also attaches its own wheel handler on canvas; this one ensures
  // the canvas never propagates scroll to the browser regardless of camera mode.
  // Uses MutationObserver to find the canvas after WorldEngine appends it.
  useEffect(() => {
    const preventOnCanvas = (e: WheelEvent) => e.preventDefault()
    let attachedCanvas: HTMLCanvasElement | null = null

    function tryAttach() {
      const canvas = outerContainerRef.current?.querySelector('canvas') as HTMLCanvasElement | null
      if (canvas && canvas !== attachedCanvas) {
        if (attachedCanvas) {
          attachedCanvas.removeEventListener('wheel', preventOnCanvas)
        }
        canvas.addEventListener('wheel', preventOnCanvas, { passive: false })
        attachedCanvas = canvas
      }
    }

    // Try immediately (WorldEngine effects run before parent effects in React)
    tryAttach()

    // Observer fallback in case canvas is added after this effect runs
    const observer = new MutationObserver(tryAttach)
    if (outerContainerRef.current) {
      observer.observe(outerContainerRef.current, { childList: true, subtree: true })
    }

    return () => {
      observer.disconnect()
      if (attachedCanvas) {
        attachedCanvas.removeEventListener('wheel', preventOnCanvas)
      }
    }
  }, [])

  // NW27: Track info panel open state from NodeClickSystem
  // Ensures ESC closes panel before exiting fullscreen
  useEffect(() => {
    function onPanelState(e: Event) {
      const ev = e as CustomEvent<{ open: boolean }>
      isPanelOpenRef.current = !!ev.detail?.open
    }
    window.addEventListener('nw:panel-state', onPanelState)
    return () => window.removeEventListener('nw:panel-state', onPanelState)
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

  // NW35: Listen for nw:open-roster from FortressLayer tactical table
  useEffect(() => {
    function onOpenRoster() { setRosterOpen(true) }
    window.addEventListener('nw:open-roster', onOpenRoster)
    return () => window.removeEventListener('nw:open-roster', onOpenRoster)
  }, [])

  // NW18: Business Cycle tour state
  const [isCyclePlaying, setIsCyclePlaying]   = useState(false)
  const [cycleStepLabel, setCycleStepLabel]   = useState('')
  const cycleTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const startBusinessCycle = useCallback(() => {
    if (isCyclePlaying) return
    setIsCyclePlaying(true)

    // Clear any existing timers
    cycleTimersRef.current.forEach(t => clearTimeout(t))
    cycleTimersRef.current = []

    // Helper to schedule a step
    function step(ms: number, label: string, fn?: () => void) {
      cycleTimersRef.current.push(setTimeout(() => {
        setCycleStepLabel(label)
        fn?.()
      }, ms))
    }

    // STEP 1 (0s): Fly to SPARK tower — lead broadcast
    step(0, 'LEAD BROADCAST — SPARK Tower', () => {
      window.dispatchEvent(new CustomEvent('nw:cycle-fly', {
        detail: { x: 60, y: 25, z: -120, lookX: 60, lookY: 10, lookZ: -120, duration: 2000 },
      }))
      // Trigger data flow layer to highlight lead flow
      window.dispatchEvent(new CustomEvent('nw:cycle-highlight', { detail: { flow: 'leads' } }))
    })

    // STEP 2 (4s): Fly to a project mountain — lead converted
    step(4000, 'LEAD CONVERTED — Project Mountain', () => {
      window.dispatchEvent(new CustomEvent('nw:cycle-fly', {
        detail: { x: -110, y: 18, z: 20, lookX: -110, lookY: 0, lookZ: 20, duration: 2500 },
      }))
      window.dispatchEvent(new CustomEvent('nw:cycle-highlight', { detail: { flow: 'materials' } }))
    })

    // STEP 3 (8s): Crew dispatch animation
    step(8000, 'CREW DISPATCHED — Labor Ridges', () => {
      window.dispatchEvent(new CustomEvent('nw:cycle-fly', {
        detail: { x: -90, y: 22, z: 0, lookX: -130, lookY: 5, lookZ: -30, duration: 2000 },
      }))
      window.dispatchEvent(new CustomEvent('nw:cycle-highlight', { detail: { flow: 'crew' } }))
    })

    // STEP 4 (12s): Fly to completed project — payment flow
    step(12000, 'PAYMENT RECEIVED — Project Complete', () => {
      window.dispatchEvent(new CustomEvent('nw:cycle-fly', {
        detail: { x: -60, y: 20, z: -60, lookX: -60, lookY: 0, lookZ: -60, duration: 2000 },
      }))
      window.dispatchEvent(new CustomEvent('nw:cycle-highlight', { detail: { flow: 'payments' } }))
    })

    // STEP 5 (15.5s): River — invoice aging check
    step(15500, 'INVOICE AGING — AR Stalactites', () => {
      window.dispatchEvent(new CustomEvent('nw:cycle-fly', {
        detail: { x: -50, y: 18, z: 40, lookX: -50, lookY: 10, lookZ: 40, duration: 2000 },
      }))
      window.dispatchEvent(new CustomEvent('nw:cycle-highlight', { detail: { flow: 'aging' } }))
    })

    // STEP 6 (18s): Fly back to overview
    step(18000, 'BUSINESS CYCLE COMPLETE', () => {
      window.dispatchEvent(new CustomEvent('nw:cycle-fly', {
        detail: { x: -20, y: 80, z: 120, lookX: -80, lookY: 0, lookZ: 0, duration: 2500 },
      }))
      window.dispatchEvent(new CustomEvent('nw:cycle-highlight', { detail: { flow: null } }))
    })

    // STEP END (21s): finish
    step(21000, '', () => {
      setIsCyclePlaying(false)
      setCycleStepLabel('')
    })
  }, [isCyclePlaying])

  const stopBusinessCycle = useCallback(() => {
    cycleTimersRef.current.forEach(t => clearTimeout(t))
    cycleTimersRef.current = []
    setIsCyclePlaying(false)
    setCycleStepLabel('')
    window.dispatchEvent(new CustomEvent('nw:cycle-highlight', { detail: { flow: null } }))
  }, [])

  // ESC skips business cycle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === 'Escape' && isCyclePlaying) {
        stopBusinessCycle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isCyclePlaying, stopBusinessCycle])

  // NW18: Camera fly-to controller (drives camera in ORBIT mode via event)
  useEffect(() => {
    function onCycleFly(e: Event) {
      const ev = e as CustomEvent<{
        x: number; y: number; z: number
        lookX: number; lookY: number; lookZ: number
        duration: number
      }>
      window.dispatchEvent(new CustomEvent('nw:fly-to', { detail: ev.detail }))
    }
    window.addEventListener('nw:cycle-fly', onCycleFly)
    return () => window.removeEventListener('nw:cycle-fly', onCycleFly)
  }, [])

  // Cleanup cycle timers on unmount
  useEffect(() => {
    return () => {
      cycleTimersRef.current.forEach(t => clearTimeout(t))
    }
  }, [])

  // NW15: Mobile guard — render early before world mounts
  if (isMobile) {
    return <MobileGuard />
  }

  return (
    <TemporalProvider worldData={nwWorldData}>
    <div
      ref={outerContainerRef}
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
      {/* NW15: Loading screen — shown until world initializes */}
      {!loadDone && <LoadingScreen stage={LOAD_STAGES[loadStageIdx]} />}

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
        onSelectionChange={setScenarioLabel}
      />

      {/* ── NW6/NW22: Mode badge ── */}
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
            whiteSpace: 'nowrap',
          }}>
            ◈ SCENARIO: {scenarioLabel}
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

      {/* ── NW18: Business Cycle button ── */}
      <div style={{
        position: 'absolute',
        bottom: 72,
        right: 14,
        zIndex: 30,
      }}>
        {!isCyclePlaying ? (
          <button
            onClick={startBusinessCycle}
            style={{
              background: 'rgba(0, 20, 15, 0.88)',
              border: '1px solid rgba(0,229,204,0.5)',
              borderRadius: 6,
              color: '#00e5cc',
              fontSize: 9,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: 1.5,
              padding: '7px 12px',
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            title="Show Business Cycle (20s tour)"
          >
            <span style={{ fontSize: 12 }}>▶</span>
            BUSINESS CYCLE
          </button>
        ) : (
          <button
            onClick={stopBusinessCycle}
            style={{
              background: 'rgba(20, 5, 5, 0.88)',
              border: '1px solid rgba(255,80,80,0.5)',
              borderRadius: 6,
              color: '#ff5050',
              fontSize: 9,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: 1.5,
              padding: '7px 12px',
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            title="Stop tour (ESC)"
          >
            <span style={{ fontSize: 12 }}>■</span>
            STOP TOUR
          </button>
        )}
      </div>

      {/* ── NW18: Business Cycle step label ── */}
      {isCyclePlaying && cycleStepLabel && (
        <div style={{
          position: 'absolute',
          bottom: 108,
          right: 14,
          zIndex: 30,
          pointerEvents: 'none',
        }}>
          <div style={{
            background: 'rgba(0, 0, 0, 0.75)',
            border: '1px solid rgba(0,229,204,0.3)',
            borderRadius: 5,
            color: '#00e5cc',
            fontSize: 9,
            fontFamily: 'monospace',
            letterSpacing: 1.2,
            padding: '5px 10px',
            backdropFilter: 'blur(6px)',
            maxWidth: 220,
            textAlign: 'right',
          }}>
            {cycleStepLabel}
          </div>
        </div>
      )}

      {/* ── NW29/B76: NEXUS Master Briefing premium panel ── */}
      <NexusSweepController soundLayerEnabled={!!layerStates['sound']} />

      {/* ── NW29: Flight analytics panel + chart icon toggle ── */}
      <FlightAnalyticsPanel />

      {/* ── NW35: Katsuro handoff subtitle overlay ── */}
      <KatsuroSubtitleOverlay />

      {/* ── NW35: Agent Roster panel (20-agent command center) ── */}
      <AgentRosterPanel open={rosterOpen} onClose={() => setRosterOpen(false)} />

      {/* ── NW36: Automation Flow Builder panel ── */}
      <AutomationFlowBuilder
        open={flowBuilderOpen}
        onClose={() => setFlowBuilderOpen(false)}
      />

      {/* ── NW36: Flows trigger button — near Agent Flight toggle in left panel ── */}
      {layerStates['automation-flows'] && !flowBuilderOpen && (
        <div style={{
          position:  'absolute',
          left:      14,
          bottom:    160,
          zIndex:    35,
          width:     130,
        }}>
          <FlowsButton onClick={() => setFlowBuilderOpen(true)} />
        </div>
      )}

      {/* ── NW39: Temporal Navigator — time scrub slider (visible when time-navigation layer ON) ── */}
      <TemporalNavigator visible={!!layerStates['time-navigation']} />

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
        onOpenRoster={() => setRosterOpen(true)}
      />
    </div>
    </TemporalProvider>
  )
}
