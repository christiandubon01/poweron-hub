/**
 * CommandHUD.tsx — NW7b: Full command surface HUD for Neural World.
 *
 * Layout:
 *   top-left    : "PowerOn Neural World" title + LIVE DATA badge + fullscreen toggle
 *   top-right   : Atmosphere mode switcher (6 buttons) + FPS counter
 *   bottom-center: Camera mode (1P / 3P / CIN) buttons + speed indicator + speed mode
 *   left-side   : Layer toggle panel — 10 layers with icon + label + on/off state
 *
 * Also renders:
 *   - Crosshair overlay in first-person mode (when pointer locked)
 *   - Letterbox bars in cinematic mode
 *   - Data shadow floating panel near player (fades after 2 s)
 *   - Mobile dual joystick overlays (touch devices)
 *   - Speed mode indicator (x0.3 / x1 / x2)
 *   - Fullscreen toggle button
 *
 * Layer defaults: Pressure + Risk Surface ON, all others OFF.
 * Active layer state persisted to neural_world_settings on change.
 * FPS counter: top-right, dim, small. Graceful degradation hint at <30 fps.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import { supabase } from '@/lib/supabase'
import { subscribeWorldData, type NWWorldData, type NWProject } from './DataBridge'
import { SettingsPanel } from './SettingsPanel'
import { MinimapRenderer } from './MinimapRenderer'
import { SimulationHUD } from './SimulationHUD'
import { InstructionalOverlay } from './InstructionalOverlay'
import { StrategyPanel, StrategyBrainButton } from './StrategyPanel'
import { FogInterviewPanel, FogCalibrateButton } from './FogInterviewPanel'
import ActionableInsightPanel, { InsightTriggerButton, type CubeInsightPayload } from './ActionableInsightPanel'
import WhatIfSimulator, { WhatIfButton } from './WhatIfSimulator'
import ProjectionGuide, { ProjectionGuideButton } from './ProjectionGuide'

// ── Enum mirrors (must match AtmosphereManager / CameraController) ────────────

export enum AtmosphereMode {
  MOJAVE            = 'MOJAVE',
  OCEAN             = 'OCEAN',
  COASTAL_FOG       = 'COASTAL_FOG',
  SCIFI_V1          = 'SCIFI_V1',
  SCIFI_V2_SUBSTRATE = 'SCIFI_V2_SUBSTRATE',
  /** NW14: V5 Enterprise — night mirror world with enterprise metrics terrain */
  V5_ENTERPRISE     = 'V5_ENTERPRISE',
}

export enum CameraMode {
  ORBIT        = 'ORBIT',
  FIRST_PERSON = 'FIRST_PERSON',
  THIRD_PERSON = 'THIRD_PERSON',
  CINEMATIC    = 'CINEMATIC',
}

// ── Layer Definitions ─────────────────────────────────────────────────────────

interface LayerDef {
  id:    string
  label: string
  icon:  string
  r: number; g: number; b: number
}

const LAYERS: LayerDef[] = [
  { id: 'pulse',           label: 'Pulse',           icon: '◎',  r: 0,   g: 200, b: 255 },
  { id: 'pressure',        label: 'Pressure',        icon: '▣',  r: 255, g: 120, b: 0   },
  { id: 'critical-path',   label: 'Critical Path',   icon: '◈',  r: 64,  g: 192, b: 160 },
  { id: 'agents',          label: 'Agents',          icon: '◆',  r: 192, g: 160, b: 32  },
  { id: 'decision-gravity',label: 'Decision Gravity',icon: '◉',  r: 160, g: 120, b: 220 },
  { id: 'velocity',        label: 'Velocity',        icon: '▷',  r: 0,   g: 255, b: 120 },
  { id: 'risk-surface',    label: 'Risk Surface',    icon: '⬡',  r: 255, g: 60,  b: 60  },
  { id: 'signal',          label: 'Signal',          icon: '∿',  r: 80,  g: 200, b: 255 },
  { id: 'forecast',        label: 'Forecast',        icon: '◐',  r: 200, g: 160, b: 255 },
  { id: 'command',         label: 'Command',         icon: '⊕',  r: 255, g: 238, b: 0   },
  /** NW18: Data flow particle animations + connection tubes */
  { id: 'data-flow',       label: 'Data Flow',       icon: '⟳',  r: 0,   g: 220, b: 180 },
  /** NW19: Enterprise simulation — org pyramids, AI agent placement */
  { id: 'simulation',      label: 'Simulation',      icon: '⬡',  r: 255, g: 200, b: 40  },
  /** NW28: Agent flight system — domain zones, flying orbs, task cycles, data cubes */
  { id: 'agent-flight',    label: 'Agent Flight',    icon: '◉',  r: 0,   g: 229, b: 204 },
  /** NW28b: Human worker amber orbs — ground movement, shift coverage, handoff chain */
  { id: 'human-workers',   label: 'Human Workers',   icon: '◎',  r: 255, g: 144, b: 64  },
  /** NW31: Fog domain layers — revenue, security, bandwidth, improvement */
  { id: 'fog-revenue',     label: 'Revenue Fog',     icon: '💰', r: 255, g: 153, b: 0   },
  { id: 'fog-security',    label: 'Security Fog',    icon: '🔒', r: 255, g: 179, b: 71  },
  { id: 'fog-bandwidth',   label: 'Bandwidth Fog',   icon: '🧠', r: 170, g: 102, b: 238 },
  { id: 'fog-improvement', label: 'Improvement Fog', icon: '🌱', r: 0,   g: 204, b: 187 },
  /** NW35: Katsuro Bridge Tower — read lines, life blocks, handoff animations */
  { id: 'katsuro-bridge',  label: 'Katsuro Bridge',  icon: '⚡', r: 255, g: 48,  b: 48  },
]

const DEFAULT_LAYER_STATES: Record<string, boolean> = Object.fromEntries(
  LAYERS.map(l => [l.id, l.id === 'pressure' || l.id === 'risk-surface' || l.id === 'data-flow' || l.id === 'simulation'])
)

const ATMO_LABELS: Record<AtmosphereMode, string> = {
  [AtmosphereMode.MOJAVE]:             'MOJAVE',
  [AtmosphereMode.OCEAN]:              'OCEAN',
  [AtmosphereMode.COASTAL_FOG]:        'COASTAL FOG',
  [AtmosphereMode.SCIFI_V1]:           'SCI-FI V1',
  [AtmosphereMode.SCIFI_V2_SUBSTRATE]: 'SCI-FI V2',
  [AtmosphereMode.V5_ENTERPRISE]:     'V5 ENTERPRISE',
}

// ── Exported state type for parent to consume ─────────────────────────────────

export type LayerStates = Record<string, boolean>

interface DataShadowEntry {
  project: NWProject
  x: number
  y: number
  expiresAt: number
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface CommandHUDProps {
  layerStates: LayerStates
  onLayerToggle: (id: string, value: boolean) => void
  cameraMode: CameraMode
  onCameraModeChange: (mode: CameraMode) => void
  atmosphereMode: AtmosphereMode
  onAtmosphereModeChange: (mode: AtmosphereMode) => void
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  /** NW35: Opens the 20-agent roster panel */
  onOpenRoster?: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CommandHUD({
  layerStates,
  onLayerToggle,
  cameraMode,
  onCameraModeChange,
  atmosphereMode,
  onAtmosphereModeChange,
  isFullscreen = false,
  onToggleFullscreen,
  onOpenRoster,
}: CommandHUDProps) {

  // FPS counter
  const [fps, setFps] = useState<number>(60)
  const fpsFrameCountRef = useRef<number>(0)
  const fpsLastTimeRef   = useRef<number>(performance.now())

  // Speed indicator
  const [speed, setSpeed] = useState<number>(0)

  // Speed mode
  const [speedMode, setSpeedMode] = useState<string>('NORMAL')

  // Pointer lock state
  const [isPointerLocked, setIsPointerLocked] = useState(false)

  // Data shadow
  const [dataShadow, setDataShadow] = useState<DataShadowEntry | null>(null)
  const shadowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const worldDataRef   = useRef<NWWorldData | null>(null)

  // NW12: Sun dominance meter state
  const [sunDominance, setSunDominance] = useState({
    solutionsHealth: 0.75,
    hubHealth: 0.75,
    sun1Intensity: 0,
    sun2Intensity: 0,
  })

  // NW12: Player position / founders valley state
  const [inValley, setInValley] = useState(false)
  const playerPosRef = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 2, z: 10 })
  const [valleyStillShadow, setValleyStillShadow] = useState(false)
  const lastMoveTimeRef = useRef<number>(Date.now())
  const lastPosSnapRef  = useRef<{ x: number; z: number }>({ x: 0, z: 10 })

  // NW12: V3 Complete badge
  const [showV3Badge, setShowV3Badge] = useState(false)
  const v3BadgeDismissedRef = useRef(false)

  // Mobile joystick display state
  const isTouchDevice = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
  const [leftJoy, setLeftJoy] = useState<{ active: boolean; cx: number; cy: number; tx: number; ty: number }>({ active: false, cx: 0, cy: 0, tx: 0, ty: 0 })
  const [rightJoy, setRightJoy] = useState<{ active: boolean; cx: number; cy: number; tx: number; ty: number }>({ active: false, cx: 0, cy: 0, tx: 0, ty: 0 })

  // NW17: Touch button states / NW20: also tracks keyboard sprint toggle
  const [sprintActive, setSprintActive] = useState(false)

  // NW20: Listen for keyboard sprint toggle from CameraController
  useEffect(() => {
    function onSprintState(e: Event) {
      const ev = e as CustomEvent<{ active: boolean }>
      if (ev.detail !== undefined) setSprintActive(ev.detail.active)
    }
    window.addEventListener('nw:sprint-state', onSprintState)
    return () => window.removeEventListener('nw:sprint-state', onSprintState)
  }, [])

  // NW24: Edit layout toggle state
  const [editLayoutActive, setEditLayoutActive] = useState(false)

  // NW25: Strategy panel open state
  const [strategyPanelOpen, setStrategyPanelOpen] = useState(false)

  // NW32: Fog interview panel open state + calibrated badge
  const [fogInterviewOpen, setFogInterviewOpen]   = useState(false)
  const [fogCalibrated, setFogCalibrated]         = useState(false)

  // NW32: listen for fog-calibrated event to show badge
  useEffect(() => {
    function onCalibrated() { setFogCalibrated(true) }
    window.addEventListener('nw:fog-calibrated', onCalibrated)
    return () => window.removeEventListener('nw:fog-calibrated', onCalibrated)
  }, [])

  // NW33: Actionable insight panel state
  const [insightOpen, setInsightOpen]           = useState(false)
  const [insightPayload, setInsightPayload]     = useState<CubeInsightPayload | null>(null)
  const [insightHasNew, setInsightHasNew]       = useState(false)

  // NW33: Listen for cube-clicked events from agent orbs
  useEffect(() => {
    function onCubeClicked(e: Event) {
      const ev = e as CustomEvent<CubeInsightPayload>
      if (!ev.detail) return
      setInsightPayload(ev.detail)
      setInsightOpen(true)
      setInsightHasNew(false)
    }
    function onAgentComplete(e: Event) {
      const ev = e as CustomEvent<CubeInsightPayload>
      if (!ev.detail) return
      setInsightPayload(ev.detail)
      setInsightHasNew(true)
    }
    window.addEventListener('nw:cube-clicked', onCubeClicked)
    window.addEventListener('nw:agent-complete', onAgentComplete)
    return () => {
      window.removeEventListener('nw:cube-clicked', onCubeClicked)
      window.removeEventListener('nw:agent-complete', onAgentComplete)
    }
  }, [])

  // NW33: What-if simulator state
  const [whatIfOpen, setWhatIfOpen]       = useState(false)
  const [whatIfActive, setWhatIfActive]   = useState(false)

  // NW34: Projection Guide state
  const [projectionGuideOpen, setProjectionGuideOpen]     = useState(false)
  const [projectionGuideActive, setProjectionGuideActive] = useState(false)

  // NW33: Listen for what-if apply/exit events
  useEffect(() => {
    function onWhatIfApply() { setWhatIfActive(true) }
    function onWhatIfExit()  { setWhatIfActive(false) }
    window.addEventListener('nw:what-if-apply', onWhatIfApply)
    window.addEventListener('nw:what-if-exit',  onWhatIfExit)
    return () => {
      window.removeEventListener('nw:what-if-apply', onWhatIfApply)
      window.removeEventListener('nw:what-if-exit',  onWhatIfExit)
    }
  }, [])

  // NW34: Listen for projection-calculate to track active state
  useEffect(() => {
    function onProjCalculate() { setProjectionGuideActive(true) }
    function onProjExit()      { setProjectionGuideActive(false) }
    window.addEventListener('nw:projection-calculate', onProjCalculate)
    window.addEventListener('nw:what-if-exit',         onProjExit)
    return () => {
      window.removeEventListener('nw:projection-calculate', onProjCalculate)
      window.removeEventListener('nw:what-if-exit',         onProjExit)
    }
  }, [])

  const handleEditLayoutToggle = useCallback(() => {
    const next = !editLayoutActive
    setEditLayoutActive(next)
    window.dispatchEvent(new CustomEvent('nw:edit-layout-active', { detail: { active: next } }))
  }, [editLayoutActive])

  // ── FPS counter via nw:frame events ────────────────────────────────────────
  useEffect(() => {
    function onFrame() {
      fpsFrameCountRef.current += 1
      const now = performance.now()
      const elapsed = now - fpsLastTimeRef.current
      if (elapsed >= 1000) {
        setFps(Math.round(fpsFrameCountRef.current * 1000 / elapsed))
        fpsFrameCountRef.current = 0
        fpsLastTimeRef.current = now
      }
    }
    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  // ── Speed from CameraController ────────────────────────────────────────────
  useEffect(() => {
    function onSpeed(e: Event) {
      const ev = e as CustomEvent<{ speed: number }>
      setSpeed(ev.detail?.speed ?? 0)
    }
    window.addEventListener('nw:player-speed', onSpeed)
    return () => window.removeEventListener('nw:player-speed', onSpeed)
  }, [])

  // ── Speed mode from CameraController ──────────────────────────────────────
  useEffect(() => {
    function onSpeedMode(e: Event) {
      const ev = e as CustomEvent<{ mode: string }>
      setSpeedMode(ev.detail?.mode ?? 'NORMAL')
    }
    window.addEventListener('nw:speed-mode', onSpeedMode)
    return () => window.removeEventListener('nw:speed-mode', onSpeedMode)
  }, [])

  // ── Pointer lock state tracking ──────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsPointerLocked(!!document.pointerLockElement)
    document.addEventListener('pointerlockchange', onChange)
    return () => document.removeEventListener('pointerlockchange', onChange)
  }, [])

  // ── Mobile joystick events (NW17: fixed positions, 120px) ────────────────
  useEffect(() => {
    if (!isTouchDevice) return

    function onJoyStart(e: Event) {
      const ev = e as CustomEvent<{ side: string; x: number; y: number }>
      // cx/cy are the fixed center coords dispatched by CameraController
      if (ev.detail.side === 'left') {
        setLeftJoy({ active: true, cx: ev.detail.x, cy: ev.detail.y, tx: ev.detail.x, ty: ev.detail.y })
      } else {
        setRightJoy({ active: true, cx: ev.detail.x, cy: ev.detail.y, tx: ev.detail.x, ty: ev.detail.y })
      }
    }
    function onJoyMove(e: Event) {
      const ev = e as CustomEvent<{ side: string; dx: number; dy: number; thumbX: number; thumbY: number }>
      if (ev.detail.side === 'left') {
        setLeftJoy(prev => ({ ...prev, tx: ev.detail.thumbX, ty: ev.detail.thumbY }))
      } else {
        setRightJoy(prev => ({ ...prev, tx: ev.detail.thumbX, ty: ev.detail.thumbY }))
      }
    }
    function onJoyEnd(e: Event) {
      const ev = e as CustomEvent<{ side: string }>
      if (ev.detail.side === 'left') {
        setLeftJoy({ active: false, cx: 0, cy: 0, tx: 0, ty: 0 })
      } else {
        setRightJoy({ active: false, cx: 0, cy: 0, tx: 0, ty: 0 })
      }
    }

    window.addEventListener('nw:joystick-start', onJoyStart)
    window.addEventListener('nw:joystick-move', onJoyMove)
    window.addEventListener('nw:joystick-end', onJoyEnd)
    return () => {
      window.removeEventListener('nw:joystick-start', onJoyStart)
      window.removeEventListener('nw:joystick-move', onJoyMove)
      window.removeEventListener('nw:joystick-end', onJoyEnd)
    }
  }, [isTouchDevice])

  // ── Sync atmosphere/camera modes from WorldEngine init load ───────────────
  useEffect(() => {
    function onModeInit(e: Event) {
      const ev = e as CustomEvent<{ atmosphereMode: string; cameraMode: string }>
      if (ev.detail?.atmosphereMode &&
          Object.values(AtmosphereMode).includes(ev.detail.atmosphereMode as AtmosphereMode)) {
        onAtmosphereModeChange(ev.detail.atmosphereMode as AtmosphereMode)
      }
      if (ev.detail?.cameraMode &&
          Object.values(CameraMode).includes(ev.detail.cameraMode as CameraMode)) {
        onCameraModeChange(ev.detail.cameraMode as CameraMode)
      }
    }
    window.addEventListener('nw:mode-init', onModeInit)
    return () => window.removeEventListener('nw:mode-init', onModeInit)
  }, [onAtmosphereModeChange, onCameraModeChange])

  // ── Subscribe to world data for data shadow ────────────────────────────────
  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      worldDataRef.current = data
    })
    return unsub
  }, [])

  // ── NW12: Subscribe to nw:revenue-health for sun dominance meter ───────────
  useEffect(() => {
    function onRevHealth(e: Event) {
      const ev = e as CustomEvent<{ solutionsHealth?: number; hubHealth?: number }>
      setSunDominance(prev => ({
        ...prev,
        solutionsHealth: ev.detail?.solutionsHealth ?? prev.solutionsHealth,
        hubHealth:       ev.detail?.hubHealth       ?? prev.hubHealth,
      }))
    }
    window.addEventListener('nw:revenue-health', onRevHealth)
    return () => window.removeEventListener('nw:revenue-health', onRevHealth)
  }, [])

  // ── NW12: Subscribe to nw:cycle-state for live sun intensities ─────────────
  useEffect(() => {
    function onCycleState(e: Event) {
      const ev = e as CustomEvent<{
        cycleT: number
        sun1Intensity: number
        sun2Intensity: number
        sun1Health: number
        sun2Health: number
      }>
      if (!ev.detail) return
      setSunDominance(prev => ({
        ...prev,
        sun1Intensity: ev.detail.sun1Intensity,
        sun2Intensity: ev.detail.sun2Intensity,
        solutionsHealth: ev.detail.sun1Health,
        hubHealth:       ev.detail.sun2Health,
      }))
    }
    window.addEventListener('nw:cycle-state', onCycleState)
    return () => window.removeEventListener('nw:cycle-state', onCycleState)
  }, [])

  // ── NW12: Subscribe to nw:player-position — valley detection ───────────────
  useEffect(() => {
    function onPlayerPos(e: Event) {
      const ev = e as CustomEvent<{ x: number; y: number; z: number; inValley: boolean }>
      if (!ev.detail) return

      const newInValley = ev.detail.inValley
      setInValley(newInValley)
      playerPosRef.current = { x: ev.detail.x, y: ev.detail.y, z: ev.detail.z }

      // Detect if player is standing still in valley (position delta < 0.5 for 2s)
      const dx = Math.abs(ev.detail.x - lastPosSnapRef.current.x)
      const dz = Math.abs(ev.detail.z - lastPosSnapRef.current.z)
      if (dx > 0.5 || dz > 0.5) {
        lastMoveTimeRef.current = Date.now()
        lastPosSnapRef.current  = { x: ev.detail.x, z: ev.detail.z }
        setValleyStillShadow(false)
      } else if (newInValley && Date.now() - lastMoveTimeRef.current > 2000) {
        setValleyStillShadow(true)
      } else if (!newInValley) {
        setValleyStillShadow(false)
      }

      // NW12: V3 Complete badge — fire once when player first enters valley
      if (newInValley && !v3BadgeDismissedRef.current) {
        v3BadgeDismissedRef.current = true
        setShowV3Badge(true)
        setTimeout(() => setShowV3Badge(false), 5500)
      }
    }
    window.addEventListener('nw:player-position', onPlayerPos)
    return () => window.removeEventListener('nw:player-position', onPlayerPos)
  }, [])

  // ── Data shadow: mouse move over canvas ────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const data = worldDataRef.current
    if (!data || data.projects.length === 0) return

    const now = Date.now()
    if (dataShadow && dataShadow.expiresAt > now + 1800) return

    const project = data.projects[Math.floor(Math.random() * Math.min(data.projects.length, 8))]
    if (shadowTimerRef.current) clearTimeout(shadowTimerRef.current)

    setDataShadow({ project, x: e.clientX, y: e.clientY, expiresAt: now + 2000 })
    shadowTimerRef.current = setTimeout(() => setDataShadow(null), 2000)
  }, [dataShadow])

  // ── Persist layer state to Supabase ───────────────────────────────────────
  const saveLayerStateRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveLayerStateRef.current) clearTimeout(saveLayerStateRef.current)
    saveLayerStateRef.current = setTimeout(async () => {
      try {
        const { data: { user } } = await (supabase as any).auth.getUser()
        if (!user) return
        const { data: profile } = await (supabase as any)
          .from('profiles')
          .select('org_id')
          .eq('id', user.id)
          .maybeSingle()
        const orgId: string | null = profile?.org_id ?? null
        if (!orgId) return
        await (supabase as any)
          .from('neural_world_settings')
          .upsert(
            { org_id: orgId, active_layers: layerStates },
            { onConflict: 'org_id' }
          )
      } catch {
        // Non-blocking
      }
    }, 1200)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(layerStates)])

  // ── Speed mode label + color ──────────────────────────────────────────────
  const speedModeLabel = speedMode === 'FAST' ? 'x2' : speedMode === 'SLOW' ? 'x0.3' : 'x1'
  const speedModeColor = speedMode === 'FAST' ? '#ff6644' : speedMode === 'SLOW' ? '#44aaff' : '#00ff88'

  // ── Helpers ────────────────────────────────────────────────────────────────

  const fpsColor = fps < 30
    ? '#ff4444'
    : fps < 50
    ? '#ffaa00'
    : 'rgba(255,255,255,0.25)'

  const activeLayerCount = Object.values(layerStates).filter(Boolean).length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── CINEMATIC LETTERBOX BARS ────────────────────────────────────── */}
      {cameraMode === CameraMode.CINEMATIC && (
        <>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: 60,
            background: 'rgba(0,0,0,0.88)',
            zIndex: 30,
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 60,
            background: 'rgba(0,0,0,0.88)',
            zIndex: 30,
            pointerEvents: 'none',
          }} />
        </>
      )}

      {/* ── CROSSHAIR (first-person + pointer locked) ──────────────────── */}
      {cameraMode === CameraMode.FIRST_PERSON && isPointerLocked && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          <div style={{
            position: 'absolute',
            width: 14,
            height: 1.5,
            background: 'rgba(255,255,255,0.55)',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }} />
          <div style={{
            position: 'absolute',
            width: 1.5,
            height: 14,
            background: 'rgba(255,255,255,0.55)',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }} />
          <div style={{
            position: 'absolute',
            width: 3,
            height: 3,
            background: '#00ff88',
            borderRadius: '50%',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }} />
        </div>
      )}

      {/* ── NW25: AI STRATEGY PANEL ─────────────────────────────────────── */}
      <StrategyPanel open={strategyPanelOpen} onClose={() => setStrategyPanelOpen(false)} />

      {/* ── NW32: FOG INTERVIEW PANEL ───────────────────────────────────── */}
      <FogInterviewPanel open={fogInterviewOpen} onClose={() => setFogInterviewOpen(false)} />

      {/* ── NW33: ACTIONABLE INSIGHT PANEL ─────────────────────────────── */}
      <ActionableInsightPanel
        open={insightOpen}
        payload={insightPayload}
        onClose={() => { setInsightOpen(false); setInsightHasNew(false) }}
      />

      {/* ── NW33: WHAT-IF SIMULATOR ─────────────────────────────────────── */}
      <WhatIfSimulator
        open={whatIfOpen}
        onClose={() => setWhatIfOpen(false)}
      />

      {/* ── NW34: PROJECTION GUIDE ──────────────────────────────────────── */}
      <ProjectionGuide
        open={projectionGuideOpen}
        onClose={() => setProjectionGuideOpen(false)}
      />

      {/* ── NW21: INSTRUCTIONAL OVERLAY + ? BUTTON ─────────────────────── */}
      <InstructionalOverlay />

      {/* ── TOP-LEFT: TITLE + LIVE BADGE + FULLSCREEN TOGGLE ──────────── */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 50,
          zIndex: 25,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ pointerEvents: 'none' }}>
          <div style={{
            color: '#00ff88',
            fontSize: 13,
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: 2.5,
            textTransform: 'uppercase',
            textShadow: '0 0 8px rgba(0,255,136,0.4)',
          }}>
            PowerOn Neural World
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#00ff88',
              boxShadow: '0 0 6px #00ff88',
              animation: 'nw-blink 1.8s ease infinite',
            }} />
            <span style={{
              color: '#00ff88',
              fontSize: 9,
              fontFamily: 'monospace',
              letterSpacing: 2,
              opacity: 0.75,
            }}>
              LIVE DATA
            </span>
            {activeLayerCount > 0 && (
              <span style={{
                color: 'rgba(255,255,255,0.35)',
                fontSize: 9,
                fontFamily: 'monospace',
                letterSpacing: 1,
              }}>
                · {activeLayerCount} LAYER{activeLayerCount !== 1 ? 'S' : ''} ACTIVE
              </span>
            )}
          </div>
        </div>

        {/* NW25: Brain button — AI Strategy Panel */}
        <StrategyBrainButton
          open={strategyPanelOpen}
          onClick={() => setStrategyPanelOpen(prev => !prev)}
        />

        {/* NW32: Calibrate Fog button — fog data interview */}
        <FogCalibrateButton
          open={fogInterviewOpen}
          onClick={() => setFogInterviewOpen(prev => !prev)}
          calibrated={fogCalibrated}
        />

        {/* NW33: Agent insight trigger button */}
        <InsightTriggerButton
          active={insightOpen}
          hasNew={insightHasNew}
          onClick={() => { setInsightOpen(prev => !prev); setInsightHasNew(false) }}
        />

        {/* NW33: What-if simulator button */}
        <WhatIfButton
          open={whatIfOpen}
          active={whatIfActive}
          onClick={() => setWhatIfOpen(prev => !prev)}
        />

        {/* NW34: Projection Guide button */}
        <ProjectionGuideButton
          open={projectionGuideOpen}
          active={projectionGuideActive}
          onClick={() => setProjectionGuideOpen(prev => !prev)}
        />

        {/* NW35: ROSTER button — opens 20-agent command center selector */}
        {onOpenRoster && (
          <button
            onClick={onOpenRoster}
            title="Open Agent Roster (20 agents)"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 5,
              border: '1px solid rgba(255,48,48,0.50)',
              background: 'rgba(5,0,0,0.75)',
              color: '#FF8080',
              cursor: 'pointer',
              fontSize: 9,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: 1.5,
              backdropFilter: 'blur(8px)',
              transition: 'all 0.15s',
              width: 'fit-content',
            }}
          >
            <span style={{ fontSize: 11 }}>◈</span>
            ROSTER
          </button>
        )}

        {/* Fullscreen toggle button */}
        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 4,
              border: '1px solid rgba(0,255,136,0.4)',
              background: isFullscreen ? 'rgba(0,255,136,0.15)' : 'rgba(0,0,0,0.5)',
              color: '#00ff88',
              cursor: 'pointer',
              fontSize: 9,
              fontFamily: 'monospace',
              letterSpacing: 1,
              backdropFilter: 'blur(6px)',
              transition: 'all 0.15s',
              width: 'fit-content',
            }}
          >
            <span style={{ fontSize: 12 }}>{isFullscreen ? '⊡' : '⊞'}</span>
            {isFullscreen ? 'EXIT FULLSCREEN · ESC' : 'FULLSCREEN'}
          </button>
        )}
      </div>

      {/* ── TOP-RIGHT: MINIMAP (NW16) ───────────────────────────────────────── */}
      <MinimapRenderer />

      {/* ── TOP-RIGHT: ATMOSPHERE SWITCHER + FPS (below minimap) ─────────── */}
      <div
        style={{
          position: 'absolute',
          top: 174,
          right: 12,
          zIndex: 25,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          alignItems: 'flex-end',
        }}
      >
        {/* FPS counter */}
        <div style={{
          color: fpsColor,
          fontSize: 9,
          fontFamily: 'monospace',
          letterSpacing: 1,
          marginBottom: 2,
          transition: 'color 0.4s',
        }}>
          {fps} FPS
          {fps < 30 && (
            <span style={{ marginLeft: 6, opacity: 0.7 }}>⚠ DEGRADED</span>
          )}
        </div>

        {/* Atmosphere panel */}
        <div style={{
          background: 'rgba(0,0,0,0.65)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          padding: '7px 8px',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          minWidth: 120,
        }}>
          <div style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: 8,
            letterSpacing: 1.5,
            fontFamily: 'monospace',
            marginBottom: 2,
          }}>
            ATMOSPHERE
          </div>
          {(Object.values(AtmosphereMode) as AtmosphereMode[]).map(mode => {
            const isActive = mode === atmosphereMode
            const isV5 = mode === AtmosphereMode.V5_ENTERPRISE
            return (
              <button
                key={mode}
                onClick={() => {
                  onAtmosphereModeChange(mode)
                  window.dispatchEvent(new CustomEvent('nw:request-atmosphere-mode', { detail: { mode } }))
                }}
                style={{
                  padding: isV5 ? '4px 9px' : '3px 9px',
                  fontSize: 9,
                  fontWeight: isActive ? 700 : 400,
                  letterSpacing: isV5 ? 1.5 : 0.5,
                  borderRadius: 3,
                  border: isActive
                    ? isV5 ? '1px solid rgba(160,80,255,0.9)' : '1px solid rgba(0,255,136,0.8)'
                    : isV5 ? '1px solid rgba(120,50,200,0.4)' : '1px solid rgba(255,255,255,0.08)',
                  background: isActive
                    ? isV5 ? 'rgba(120,40,220,0.25)' : 'rgba(0,255,136,0.12)'
                    : isV5 ? 'rgba(80,20,140,0.15)' : 'rgba(255,255,255,0.03)',
                  color: isActive
                    ? isV5 ? '#c080ff' : '#00ff88'
                    : isV5 ? 'rgba(160,100,220,0.7)' : 'rgba(255,255,255,0.45)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.12s',
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}
              >
                {ATMO_LABELS[mode]}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── LEFT-SIDE: LAYER TOGGLE PANEL ─────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: 12,
          transform: 'translateY(-50%)',
          zIndex: 25,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          background: 'rgba(0,0,0,0.6)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
          padding: '10px 8px',
          backdropFilter: 'blur(8px)',
          minWidth: 148,
        }}
      >
        <div style={{
          color: 'rgba(255,255,255,0.35)',
          fontSize: 8,
          letterSpacing: 1.5,
          fontFamily: 'monospace',
          marginBottom: 4,
          textAlign: 'center',
        }}>
          LAYERS
        </div>

        {LAYERS.map(layer => {
          const isOn = !!layerStates[layer.id]
          const { r, g, b } = layer
          return (
            <button
              key={layer.id}
              onClick={() => onLayerToggle(layer.id, !isOn)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '5px 8px',
                borderRadius: 4,
                border: `1px solid ${isOn ? `rgba(${r},${g},${b},0.7)` : 'rgba(255,255,255,0.07)'}`,
                background: isOn
                  ? `rgba(${r},${g},${b},0.12)`
                  : 'rgba(255,255,255,0.02)',
                color: isOn ? `rgb(${r},${g},${b})` : 'rgba(255,255,255,0.28)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                fontFamily: 'monospace',
                fontSize: 10,
                textAlign: 'left',
                width: '100%',
                letterSpacing: 0.3,
              }}
            >
              <span style={{ fontSize: 12, lineHeight: 1, minWidth: 14 }}>{layer.icon}</span>
              <span style={{ flex: 1 }}>{layer.label}</span>
              <span style={{
                fontSize: 8,
                letterSpacing: 0.5,
                opacity: 0.7,
                color: isOn ? `rgb(${r},${g},${b})` : 'rgba(255,255,255,0.2)',
              }}>
                {isOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── BOTTOM-CENTER: CAMERA MODE + SPEED + SPEED MODE ──────────────── */}
      {/* NW27b: Raised from bottom:14 to bottom:150 to clear the Business   */}
      {/* Dominance meter (bottom:90) and speed display with no overlap at   */}
      {/* 1920x1080 and 1366x768.                                            */}
      <div
        style={{
          position: 'absolute',
          bottom: 150,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 25,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 5,
        }}
      >
        {/* Speed mode indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'monospace',
          fontSize: 10,
          letterSpacing: 1,
        }}>
          <span style={{
            color: speedModeColor,
            fontWeight: 700,
            textShadow: `0 0 6px ${speedModeColor}40`,
          }}>
            {speedModeLabel}
          </span>
          {/* NW20: Sprint toggle indicator (keyboard + touch) */}
          {sprintActive && (
            <span style={{
              color: '#ff6644',
              fontWeight: 700,
              fontSize: 9,
              letterSpacing: 1.5,
              textShadow: '0 0 6px rgba(255,102,68,0.6)',
              background: 'rgba(255,102,68,0.15)',
              border: '1px solid rgba(255,102,68,0.4)',
              borderRadius: 4,
              padding: '1px 5px',
            }}>
              SPRINT ×2.5
            </span>
          )}
          {speed > 0.01 && (
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, letterSpacing: 1.5 }}>
              {/* NW27b: multiply frame-distance by 60 to get actual u/s (camera calc divides by 60) */}
              {speed > 0.05 ? 'MOVING' : 'IDLE'} · {(speed * 60).toFixed(1)} U/S
            </span>
          )}
        </div>

        {/* Camera mode buttons */}
        <div style={{
          display: 'flex',
          gap: 3,
          background: 'rgba(0,0,0,0.6)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 20,
          padding: '5px 8px',
          backdropFilter: 'blur(6px)',
        }}>
          {([
            [CameraMode.ORBIT,        'ORBIT'],
            [CameraMode.FIRST_PERSON, '1P'],
            [CameraMode.THIRD_PERSON, '3P'],
            [CameraMode.CINEMATIC,    'CIN'],
          ] as [CameraMode, string][]).map(([mode, label]) => {
            const isActive = cameraMode === mode
            return (
              <button
                key={mode}
                onClick={() => {
                  onCameraModeChange(mode)
                  window.dispatchEvent(new CustomEvent('nw:request-camera-mode', { detail: { mode } }))
                }}
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 400,
                  letterSpacing: 0.8,
                  borderRadius: 14,
                  border: 'none',
                  background: isActive ? 'rgba(0,255,136,0.2)' : 'transparent',
                  color: isActive ? '#00ff88' : 'rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  fontFamily: 'monospace',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Controls hint */}
        <div style={{
          color: 'rgba(255,255,255,0.18)',
          fontSize: 9,
          fontFamily: 'monospace',
          letterSpacing: 0.5,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          {cameraMode === CameraMode.ORBIT
            ? 'Drag to orbit · scroll zoom · right-drag pan'
            : cameraMode === CameraMode.FIRST_PERSON
            ? 'WASD move · Space/Q up/down · click lock · Shift = toggle sprint · scroll speed'
            : cameraMode === CameraMode.THIRD_PERSON
            ? 'WASD move · Space/Q up/down · Shift = toggle sprint · 1/2/3 distance · scroll speed'
            : 'Auto-pilot cinematic'}
        </div>

        {/* NW24: EDIT LAYOUT toggle */}
        <button
          onClick={handleEditLayoutToggle}
          style={{
            padding: '4px 14px',
            fontSize: 9,
            fontWeight: editLayoutActive ? 700 : 400,
            letterSpacing: 1.5,
            borderRadius: 14,
            border: editLayoutActive
              ? '1px solid rgba(255,165,0,0.8)'
              : '1px solid rgba(255,255,255,0.15)',
            background: editLayoutActive
              ? 'rgba(255,165,0,0.2)'
              : 'rgba(0,0,0,0.5)',
            color: editLayoutActive ? '#ffaa33' : 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            transition: 'all 0.15s',
            fontFamily: 'monospace',
            backdropFilter: 'blur(6px)',
            boxShadow: editLayoutActive ? '0 0 12px rgba(255,165,0,0.25)' : 'none',
          }}
        >
          {editLayoutActive ? '✕ EXIT EDIT' : '✎ EDIT LAYOUT'}
        </button>
      </div>

      {/* ── NW16: SETTINGS PANEL (gear icon, bottom-right) ────────────────── */}
      <SettingsPanel
        cameraMode={cameraMode}
        onCameraModeChange={mode => {
          onCameraModeChange(mode)
          window.dispatchEvent(new CustomEvent('nw:request-camera-mode', { detail: { mode } }))
        }}
      />

      {/* ── NW19: SIMULATION HUD (top-right, when simulation layer is on) ── */}
      <SimulationHUD visible={!!layerStates['simulation']} />

      {/* ── NW17: MOBILE DUAL JOYSTICKS + TOUCH BUTTONS ─────────────────── */}
      {isTouchDevice && (
        <>
          {/* ── Left joystick: ghost ring always visible + active thumb ── */}
          {/* Ghost ring (always shown on touch device) */}
          <div style={{
            position: 'fixed',
            left: 90 - 60,
            bottom: 90 - 60,
            // Use bottom positioning to match fixed center at (90, h-90)
            width: 120,
            height: 120,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.18)',
            border: `2px solid rgba(0,255,136,${leftJoy.active ? '0.45' : '0.15'})`,
            zIndex: 50,
            pointerEvents: 'none',
            transition: 'border-color 0.15s',
          }} />
          {/* Active thumb — only when joystick active */}
          {leftJoy.active && (
            <div style={{
              position: 'fixed',
              left: leftJoy.tx - 25,
              top:  leftJoy.ty - 25,
              width: 50,
              height: 50,
              borderRadius: '50%',
              background: 'rgba(0,255,136,0.35)',
              border: '2px solid rgba(0,255,136,0.75)',
              zIndex: 51,
              pointerEvents: 'none',
              boxShadow: '0 0 12px rgba(0,255,136,0.3)',
            }} />
          )}

          {/* ── Right joystick: ghost ring + active thumb ── */}
          <div style={{
            position: 'fixed',
            right: 90 - 60,
            bottom: 90 - 60,
            width: 120,
            height: 120,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.18)',
            border: `2px solid rgba(0,229,204,${rightJoy.active ? '0.45' : '0.15'})`,
            zIndex: 50,
            pointerEvents: 'none',
            transition: 'border-color 0.15s',
          }} />
          {rightJoy.active && (
            <div style={{
              position: 'fixed',
              left: rightJoy.tx - 25,
              top:  rightJoy.ty - 25,
              width: 50,
              height: 50,
              borderRadius: '50%',
              background: 'rgba(0,229,204,0.35)',
              border: '2px solid rgba(0,229,204,0.75)',
              zIndex: 51,
              pointerEvents: 'none',
              boxShadow: '0 0 12px rgba(0,229,204,0.3)',
            }} />
          )}

          {/* ── ASCEND button — right side, above right joystick ── */}
          <button
            onPointerDown={() => window.dispatchEvent(new CustomEvent('nw:touch-ascend', { detail: { active: true } }))}
            onPointerUp={() => window.dispatchEvent(new CustomEvent('nw:touch-ascend', { detail: { active: false } }))}
            onPointerLeave={() => window.dispatchEvent(new CustomEvent('nw:touch-ascend', { detail: { active: false } }))}
            style={{
              position: 'fixed',
              right: 30,
              bottom: 210,
              width: 52,
              height: 52,
              minWidth: 44,
              minHeight: 44,
              borderRadius: 10,
              border: '2px solid rgba(0,229,204,0.4)',
              background: 'rgba(0,0,0,0.6)',
              color: '#00e5cc',
              fontSize: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 52,
              cursor: 'pointer',
              backdropFilter: 'blur(6px)',
              touchAction: 'none',
              userSelect: 'none',
            }}
            title="Ascend (Space)"
          >
            ↑
          </button>

          {/* ── DESCEND button — right side, between ascend and right joystick ── */}
          <button
            onPointerDown={() => window.dispatchEvent(new CustomEvent('nw:touch-descend', { detail: { active: true } }))}
            onPointerUp={() => window.dispatchEvent(new CustomEvent('nw:touch-descend', { detail: { active: false } }))}
            onPointerLeave={() => window.dispatchEvent(new CustomEvent('nw:touch-descend', { detail: { active: false } }))}
            style={{
              position: 'fixed',
              right: 30,
              bottom: 148,
              width: 52,
              height: 52,
              minWidth: 44,
              minHeight: 44,
              borderRadius: 10,
              border: '2px solid rgba(0,229,204,0.4)',
              background: 'rgba(0,0,0,0.6)',
              color: '#00e5cc',
              fontSize: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 52,
              cursor: 'pointer',
              backdropFilter: 'blur(6px)',
              touchAction: 'none',
              userSelect: 'none',
            }}
            title="Descend (Q)"
          >
            ↓
          </button>

          {/* ── SPRINT TOGGLE — left side, above left joystick ── */}
          <button
            onClick={() => {
              const next = !sprintActive
              setSprintActive(next)
              window.dispatchEvent(new CustomEvent('nw:touch-sprint', { detail: { active: next } }))
            }}
            style={{
              position: 'fixed',
              left: 30,
              bottom: 210,
              width: 52,
              height: 52,
              minWidth: 44,
              minHeight: 44,
              borderRadius: 10,
              border: `2px solid ${sprintActive ? 'rgba(255,102,68,0.9)' : 'rgba(255,255,255,0.25)'}`,
              background: sprintActive ? 'rgba(255,102,68,0.25)' : 'rgba(0,0,0,0.6)',
              color: sprintActive ? '#ff6644' : 'rgba(255,255,255,0.65)',
              fontSize: 11,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: 0.8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 52,
              cursor: 'pointer',
              backdropFilter: 'blur(6px)',
              touchAction: 'none',
              userSelect: 'none',
              transition: 'all 0.15s',
            }}
            title="Sprint Toggle (Shift)"
          >
            {sprintActive ? 'SPRINT' : 'RUN'}
          </button>

          {/* ── CAMERA MODE CYCLE — top-center HUD ── */}
          <button
            onClick={() => {
              const modes = [CameraMode.ORBIT, CameraMode.FIRST_PERSON, CameraMode.THIRD_PERSON] as const
              const cur = modes.indexOf(cameraMode as typeof modes[number])
              const next = modes[(cur + 1) % modes.length]
              onCameraModeChange(next)
            }}
            style={{
              position: 'fixed',
              top: 14,
              left: '50%',
              transform: 'translateX(-50%)',
              minWidth: 80,
              minHeight: 44,
              height: 44,
              paddingLeft: 14,
              paddingRight: 14,
              borderRadius: 8,
              border: '2px solid rgba(0,255,136,0.35)',
              background: 'rgba(0,0,0,0.6)',
              color: '#00ff88',
              fontSize: 11,
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 52,
              cursor: 'pointer',
              backdropFilter: 'blur(6px)',
              touchAction: 'none',
              userSelect: 'none',
            }}
            title="Cycle camera mode"
          >
            {cameraMode === CameraMode.ORBIT ? 'ORBIT' : cameraMode === CameraMode.FIRST_PERSON ? '1P' : '3P'}
          </button>

          {/* ── SPEED TOGGLE — bottom-center between joysticks ── */}
          <button
            onClick={() => {
              const modes = ['NORMAL', 'FAST', 'SLOW'] as const
              const idx = modes.indexOf(speedMode as typeof modes[number])
              const next = modes[(idx + 1) % modes.length]
              setSpeedMode(next)
              window.dispatchEvent(new CustomEvent('nw:request-speed-mode', { detail: { mode: next } }))
            }}
            style={{
              position: 'fixed',
              bottom: 40,
              left: '50%',
              transform: 'translateX(-50%)',
              minWidth: 60,
              minHeight: 44,
              paddingLeft: 16,
              paddingRight: 16,
              borderRadius: 20,
              border: `2px solid ${speedModeColor}`,
              background: 'rgba(0,0,0,0.6)',
              color: speedModeColor,
              fontSize: 14,
              fontWeight: 700,
              fontFamily: 'monospace',
              cursor: 'pointer',
              backdropFilter: 'blur(6px)',
              zIndex: 52,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              touchAction: 'none',
              userSelect: 'none',
            }}
            title="Cycle speed mode"
          >
            {speedModeLabel}
          </button>
        </>
      )}

      {/* ── DATA SHADOW PANEL ─────────────────────────────────────────────── */}
      {dataShadow && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(dataShadow.x + 18, window.innerWidth - 200),
            top: Math.min(dataShadow.y - 10, window.innerHeight - 140),
            zIndex: 40,
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.82)',
            border: '1px solid rgba(0,255,136,0.35)',
            borderRadius: 6,
            padding: '8px 12px',
            backdropFilter: 'blur(8px)',
            minWidth: 170,
            animation: 'nw-shadow-in 0.15s ease',
          }}
        >
          <div style={{
            color: '#00ff88',
            fontSize: 9,
            fontFamily: 'monospace',
            letterSpacing: 1.5,
            marginBottom: 5,
            fontWeight: 700,
          }}>
            ◈ NODE METRICS
          </div>
          <DataShadowRow label="Name"   value={dataShadow.project.name} />
          <DataShadowRow label="Status" value={dataShadow.project.status.toUpperCase()} />
          <DataShadowRow
            label="Value"
            value={`$${dataShadow.project.contract_value.toLocaleString()}`}
          />
          <DataShadowRow
            label="Health"
            value={`${dataShadow.project.health_score ?? 'N/A'}%`}
            highlight={(dataShadow.project.health_score ?? 80) < 60}
          />
        </div>
      )}

      {/* ── NW12: SUN DOMINANCE METER ─────────────────────────────────────── */}
      {(() => {
        const total = sunDominance.sun1Intensity + sunDominance.sun2Intensity
        const solPct = total > 0.01
          ? sunDominance.sun1Intensity / total
          : sunDominance.solutionsHealth / (sunDominance.solutionsHealth + sunDominance.hubHealth)
        const hubPct = 1 - solPct
        const balanced = Math.abs(solPct - 0.5) < 0.08
        const barColor = balanced
          ? '#ffd700'
          : solPct > 0.5 ? '#ff8040' : '#80c0ff'
        return (
          <div
            style={{
              position: 'absolute',
              bottom: 90,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 25,
              pointerEvents: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <div style={{
              fontSize: 8,
              fontFamily: 'monospace',
              letterSpacing: 2,
              color: 'rgba(255,255,255,0.35)',
              textTransform: 'uppercase',
            }}>
              Business Dominance
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              {/* Solutions label */}
              <span style={{
                fontSize: 8,
                fontFamily: 'monospace',
                letterSpacing: 1,
                color: '#ff8040',
                opacity: solPct >= hubPct ? 1 : 0.45,
              }}>
                SOL
              </span>
              {/* Dominance bar track */}
              <div style={{
                width: 120,
                height: 6,
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 3,
                border: `1px solid rgba(255,255,255,0.12)`,
                position: 'relative',
                overflow: 'hidden',
              }}>
                {/* Solutions fill (left side) */}
                <div style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${solPct * 100}%`,
                  background: 'linear-gradient(to right, #ff8040, #ffaa60)',
                  transition: 'width 0.4s ease',
                  borderRadius: 3,
                }} />
                {/* Hub fill (right side) */}
                <div style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: `${hubPct * 100}%`,
                  background: 'linear-gradient(to left, #80c0ff, #60a0ee)',
                  transition: 'width 0.4s ease',
                  borderRadius: 3,
                }} />
                {/* Center glow when balanced */}
                {balanced && (
                  <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: 0,
                    bottom: 0,
                    width: 4,
                    transform: 'translateX(-50%)',
                    background: '#ffd700',
                    boxShadow: '0 0 8px #ffd700, 0 0 16px #ffd70088',
                    borderRadius: 2,
                    animation: 'nw-gold-pulse 1.2s ease infinite',
                  }} />
                )}
              </div>
              {/* Hub label */}
              <span style={{
                fontSize: 8,
                fontFamily: 'monospace',
                letterSpacing: 1,
                color: '#80c0ff',
                opacity: hubPct >= solPct ? 1 : 0.45,
              }}>
                HUB
              </span>
            </div>
            {balanced && (
              <div style={{
                fontSize: 7,
                fontFamily: 'monospace',
                letterSpacing: 2,
                color: '#ffd700',
                textShadow: '0 0 6px #ffd70088',
                animation: 'nw-blink 1.4s ease infinite',
              }}>
                ✦ BALANCED ✦
              </div>
            )}
          </div>
        )
      })()}

      {/* ── NW12: VALLEY COMBINED DATA SHADOW (standing still in valley) ─── */}
      {valleyStillShadow && worldDataRef.current && (() => {
        const data = worldDataRef.current!
        const solProjects = data.projects.filter((_p, i) => i % 2 === 0).slice(0, 3)
        const hubProjects = data.projects.filter((_p, i) => i % 2 !== 0).slice(0, 3)
        const totalValue = data.projects.reduce((s, p) => s + p.contract_value, 0)
        const avgHealth  = data.projects.length > 0
          ? Math.round(data.projects.reduce((s, p) => s + (p.health_score ?? 80), 0) / data.projects.length)
          : 80
        return (
          <div style={{
            position: 'fixed',
            bottom: 140,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 40,
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.88)',
            border: '1px solid rgba(200,160,40,0.5)',
            borderRadius: 8,
            padding: '10px 16px',
            backdropFilter: 'blur(10px)',
            minWidth: 300,
            boxShadow: '0 0 20px rgba(200,160,40,0.15)',
            animation: 'nw-shadow-in 0.2s ease',
          }}>
            <div style={{
              fontSize: 9,
              fontFamily: 'monospace',
              letterSpacing: 2,
              color: '#c8a028',
              fontWeight: 700,
              marginBottom: 8,
              textAlign: 'center',
            }}>
              ◈ FOUNDERS VALLEY — COMBINED METRICS
            </div>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 8 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#ff8040', fontWeight: 700 }}>
                  ${(totalValue / 2).toLocaleString()}
                </div>
                <div style={{ fontSize: 8, color: 'rgba(255,128,64,0.6)', fontFamily: 'monospace', letterSpacing: 1 }}>SOLUTIONS</div>
              </div>
              <div style={{ width: 1, background: 'rgba(200,160,40,0.3)' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#80c0ff', fontWeight: 700 }}>
                  ${(totalValue / 2).toLocaleString()}
                </div>
                <div style={{ fontSize: 8, color: 'rgba(128,192,255,0.6)', fontFamily: 'monospace', letterSpacing: 1 }}>HUB</div>
              </div>
              <div style={{ width: 1, background: 'rgba(200,160,40,0.3)' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#ffd700', fontWeight: 700 }}>
                  {avgHealth}%
                </div>
                <div style={{ fontSize: 8, color: 'rgba(255,215,0,0.6)', fontFamily: 'monospace', letterSpacing: 1 }}>HEALTH</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 20, fontSize: 8, fontFamily: 'monospace' }}>
              <div>
                <div style={{ color: 'rgba(255,128,64,0.5)', letterSpacing: 1, marginBottom: 3 }}>SOLUTIONS</div>
                {solProjects.map(p => (
                  <div key={p.id} style={{ color: 'rgba(255,128,64,0.9)', marginBottom: 2 }}>
                    · {p.name.slice(0, 18)}
                  </div>
                ))}
              </div>
              <div>
                <div style={{ color: 'rgba(128,192,255,0.5)', letterSpacing: 1, marginBottom: 3 }}>HUB</div>
                {hubProjects.map(p => (
                  <div key={p.id} style={{ color: 'rgba(128,192,255,0.9)', marginBottom: 2 }}>
                    · {p.name.slice(0, 18)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── NW12: V3 COMPLETE BADGE ────────────────────────────────────────── */}
      {showV3Badge && (() => {
        const data = worldDataRef.current
        const totalValue = data ? data.projects.reduce((s, p) => s + p.contract_value, 0) : 0
        const projectCount = data ? data.projects.length : 0
        return (
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 60,
            pointerEvents: 'none',
            textAlign: 'center',
            animation: 'nw-v3-badge-in 0.5s ease forwards',
          }}>
            <div style={{
              background: 'rgba(0,0,0,0.92)',
              border: '2px solid rgba(200,160,40,0.8)',
              borderRadius: 12,
              padding: '28px 48px',
              backdropFilter: 'blur(16px)',
              boxShadow: '0 0 60px rgba(200,160,40,0.3), 0 0 120px rgba(200,160,40,0.1)',
            }}>
              <div style={{
                fontSize: 9,
                fontFamily: 'monospace',
                letterSpacing: 4,
                color: 'rgba(200,160,40,0.6)',
                marginBottom: 10,
              }}>
                FOUNDERS VALLEY
              </div>
              <div style={{
                fontSize: 28,
                fontFamily: 'monospace',
                fontWeight: 900,
                letterSpacing: 6,
                color: '#ffd700',
                textShadow: '0 0 20px #ffd700, 0 0 40px #ffd70066',
                marginBottom: 8,
              }}>
                V3 COMPLETE
              </div>
              <div style={{
                width: 180,
                height: 1,
                background: 'linear-gradient(to right, transparent, #c8a028, transparent)',
                margin: '0 auto 14px',
              }} />
              {totalValue > 0 && (
                <div style={{ display: 'flex', gap: 24, justifyContent: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontFamily: 'monospace', color: '#ff8040', fontWeight: 700 }}>
                      ${totalValue.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', letterSpacing: 1 }}>
                      COMBINED VALUE
                    </div>
                  </div>
                  <div style={{ width: 1, background: 'rgba(200,160,40,0.3)' }} />
                  <div>
                    <div style={{ fontSize: 14, fontFamily: 'monospace', color: '#80c0ff', fontWeight: 700 }}>
                      {projectCount}
                    </div>
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', letterSpacing: 1 }}>
                      ACTIVE PROJECTS
                    </div>
                  </div>
                </div>
              )}
              <div style={{
                marginTop: 12,
                fontSize: 8,
                fontFamily: 'monospace',
                letterSpacing: 2,
                color: 'rgba(200,160,40,0.5)',
              }}>
                POWER ON SOLUTIONS LLC + POWERON HUB
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Canvas hover capture for data shadow ──────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 5,
          pointerEvents: 'none',
        }}
        onMouseMove={handleMouseMove}
      />

      {/* ── CSS keyframes injected once ───────────────────────────────────── */}
      <style>{`
        @keyframes nw-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes nw-shadow-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes nw-gold-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px #ffd700, 0 0 16px #ffd70088; }
          50%       { opacity: 0.6; box-shadow: 0 0 4px #ffd700, 0 0 8px #ffd70044; }
        }
        @keyframes nw-v3-badge-in {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
          15%  { opacity: 1; transform: translate(-50%, -50%) scale(1.04); }
          25%  { transform: translate(-50%, -50%) scale(1.0); }
          80%  { opacity: 1; transform: translate(-50%, -50%) scale(1.0); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
        }
      `}</style>
    </>
  )
}

// ── Small helper ──────────────────────────────────────────────────────────────

function DataShadowRow({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 3,
    }}>
      <span style={{
        color: 'rgba(255,255,255,0.35)',
        fontSize: 9,
        fontFamily: 'monospace',
        letterSpacing: 0.5,
      }}>
        {label}
      </span>
      <span style={{
        color: highlight ? '#ff4444' : 'rgba(255,255,255,0.7)',
        fontSize: 9,
        fontFamily: 'monospace',
        letterSpacing: 0.3,
        maxWidth: 100,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  )
}
