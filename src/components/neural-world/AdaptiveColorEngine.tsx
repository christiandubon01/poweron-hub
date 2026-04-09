/**
 * AdaptiveColorEngine.tsx — NW42: Adaptive color temperature based on cognitive state.
 *
 * Tracks user interaction patterns over a rolling 60-second window and maps
 * them to one of five cognitive states. Each state drives a color temperature
 * event (nw:color-temperature) that all layers listen to for material shifts.
 *
 * Cognitive States:
 *   ANALYTICAL  — high click rate, frequent panel opens, moderate movement
 *   STRATEGIC   — low click rate, long stationary periods, wide zoom
 *   DECISIVE    — moderate clicks, fast targeted movement, specific node interaction
 *   DELEGATING  — AI toggles, agent panel reviews, low personal navigation
 *   RESTING     — minimal interaction for 30+ seconds, slow drift movement
 *
 * The nw:color-temperature event payload:
 *   { state, warm_factor (0–1), cool_factor (0–1), saturation_factor (0.8–1.2),
 *     brightness_factor (0.8–1.2) }
 *
 * Manual override (dispatched via 'nw:color-mode-override' CustomEvent):
 *   { mode: 'auto' | 'warm' | 'cool' | 'neutral' | 'agent' }
 *   Persisted to localStorage key 'nw_color_mode'.
 *
 * HUD indicator: CognitiveStateHUD component (bottom-right, subtle fade).
 */

import React, { useEffect, useRef, useCallback, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CognitiveState =
  | 'ANALYTICAL'
  | 'STRATEGIC'
  | 'DECISIVE'
  | 'DELEGATING'
  | 'RESTING'

export type ColorMode = 'auto' | 'warm' | 'cool' | 'neutral' | 'agent'

export interface ColorTemperaturePayload {
  state: CognitiveState
  warm_factor: number        // 0–1
  cool_factor: number        // 0–1
  saturation_factor: number  // 0.8–1.2
  brightness_factor: number  // 0.8–1.2
}

// ── Preset color temperatures per state ──────────────────────────────────────

const STATE_TARGETS: Record<CognitiveState, Omit<ColorTemperaturePayload, 'state'>> = {
  ANALYTICAL: {
    warm_factor:       0.10,
    cool_factor:       0.85,
    saturation_factor: 0.80,
    brightness_factor: 1.05,
  },
  STRATEGIC: {
    warm_factor:       0.50,
    cool_factor:       0.50,
    saturation_factor: 1.00,
    brightness_factor: 1.00,
  },
  DECISIVE: {
    warm_factor:       0.85,
    cool_factor:       0.15,
    saturation_factor: 1.10,
    brightness_factor: 1.10,
  },
  DELEGATING: {
    warm_factor:       0.20,
    cool_factor:       0.80,
    saturation_factor: 1.20,
    brightness_factor: 1.15,
  },
  RESTING: {
    warm_factor:       0.65,
    cool_factor:       0.35,
    saturation_factor: 0.85,
    brightness_factor: 0.85,
  },
}

const MANUAL_PRESETS: Record<Exclude<ColorMode, 'auto'>, Omit<ColorTemperaturePayload, 'state'>> = {
  warm: {
    warm_factor:       0.85,
    cool_factor:       0.15,
    saturation_factor: 1.05,
    brightness_factor: 1.05,
  },
  cool: {
    warm_factor:       0.15,
    cool_factor:       0.85,
    saturation_factor: 0.90,
    brightness_factor: 1.00,
  },
  neutral: {
    warm_factor:       0.50,
    cool_factor:       0.50,
    saturation_factor: 1.00,
    brightness_factor: 1.00,
  },
  agent: {
    warm_factor:       0.20,
    cool_factor:       0.80,
    saturation_factor: 1.20,
    brightness_factor: 1.15,
  },
}

// ── Rolling window constants ──────────────────────────────────────────────────

const WINDOW_MS          = 60_000  // 60-second rolling window
const RESTING_THRESHOLD  = 30_000  // 30s inactivity → RESTING
const LERP_DURATION_MS   = 3_000   // 3-second smooth transition
const DISPATCH_INTERVAL  = 200     // ms between dispatched events

// ── Interaction record ────────────────────────────────────────────────────────

interface InteractionRecord {
  ts:   number          // timestamp
  type: 'click' | 'move' | 'panel' | 'zoom' | 'agent-toggle'
  dx?:  number          // camera delta x
  dz?:  number          // camera delta z
}

// ── State detection ───────────────────────────────────────────────────────────

function detectState(
  records: InteractionRecord[],
  lastInteraction: number,
): CognitiveState {
  const now = Date.now()

  // RESTING: no interaction for 30+ seconds
  if (now - lastInteraction >= RESTING_THRESHOLD) return 'RESTING'

  const recent = records.filter(r => now - r.ts <= WINDOW_MS)
  if (recent.length === 0) return 'RESTING'

  const clicks       = recent.filter(r => r.type === 'click').length
  const panelEvents  = recent.filter(r => r.type === 'panel').length
  const agentToggles = recent.filter(r => r.type === 'agent-toggle').length
  const moves        = recent.filter(r => r.type === 'move')
  const zoomChanges  = recent.filter(r => r.type === 'zoom').length

  // Clicks per minute
  const cpm = (clicks / WINDOW_MS) * 60_000

  // Average camera movement speed (units/second proxy)
  let totalDist = 0
  for (const m of moves) {
    if (m.dx !== undefined && m.dz !== undefined) {
      totalDist += Math.sqrt(m.dx * m.dx + m.dz * m.dz)
    }
  }
  const avgSpeed = moves.length > 0 ? totalDist / moves.length : 0

  // DELEGATING: significant agent toggle activity
  if (agentToggles >= 3) return 'DELEGATING'

  // ANALYTICAL: high click rate + frequent panel opens
  if (cpm >= 12 && panelEvents >= 3) return 'ANALYTICAL'

  // STRATEGIC: low click rate + low movement + high zoom changes or stationary
  if (cpm <= 4 && avgSpeed < 0.5 && (zoomChanges >= 2 || moves.length <= 5)) return 'STRATEGIC'

  // DECISIVE: moderate clicks + fast movement + node interaction
  if (cpm >= 6 && avgSpeed >= 1.2 && clicks >= 5) return 'DECISIVE'

  // ANALYTICAL fallback: moderate-high click + some panel usage
  if (cpm >= 8 && panelEvents >= 1) return 'ANALYTICAL'

  // Default to STRATEGIC (observing)
  return 'STRATEGIC'
}

// ── Main component ─────────────────────────────────────────────────────────────

/**
 * AdaptiveColorEngine — mount inside WorldEngine tree.
 * Emits nw:color-temperature events. Renders no visible DOM (engine only).
 */
export function AdaptiveColorEngine() {
  const recordsRef        = useRef<InteractionRecord[]>([])
  const lastInteractionRef = useRef<number>(Date.now())
  const currentStateRef   = useRef<CognitiveState>('STRATEGIC')
  const colorModeRef      = useRef<ColorMode>(
    (() => {
      try {
        return (localStorage.getItem('nw_color_mode') as ColorMode) ?? 'auto'
      } catch { return 'auto' }
    })()
  )

  // Current lerped values (refs, mutated each frame)
  const currentPayloadRef = useRef<Omit<ColorTemperaturePayload, 'state'>>({
    ...STATE_TARGETS.STRATEGIC,
  })
  const targetPayloadRef  = useRef<Omit<ColorTemperaturePayload, 'state'>>({
    ...STATE_TARGETS.STRATEGIC,
  })
  const transitionStartRef   = useRef<number>(0)
  const transitionFromRef    = useRef<Omit<ColorTemperaturePayload, 'state'>>({
    ...STATE_TARGETS.STRATEGIC,
  })
  const lastDispatchRef      = useRef<number>(0)
  const rafRef               = useRef<number>(0)

  // ── Record interaction ──────────────────────────────────────────────────────

  const recordInteraction = useCallback((rec: Omit<InteractionRecord, 'ts'>) => {
    const now = Date.now()
    lastInteractionRef.current = now
    recordsRef.current.push({ ...rec, ts: now })
    // Trim to window
    const cutoff = now - WINDOW_MS
    recordsRef.current = recordsRef.current.filter(r => r.ts > cutoff)
  }, [])

  // ── Event listeners ─────────────────────────────────────────────────────────

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      // Ignore if on a UI element outside canvas (rough heuristic: target is canvas or body)
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT') return
      recordInteraction({ type: 'click' })
    }

    function onPointerMove(e: PointerEvent) {
      if (e.movementX === 0 && e.movementY === 0) return
      recordInteraction({ type: 'move', dx: e.movementX * 0.1, dz: e.movementY * 0.1 })
    }

    function onNWPanel() {
      recordInteraction({ type: 'panel' })
    }

    function onWheel() {
      recordInteraction({ type: 'zoom' })
    }

    function onAgentToggle() {
      recordInteraction({ type: 'agent-toggle' })
    }

    // Listen to NW camera movement events for better velocity data
    function onPlayerPos(e: Event) {
      const ev = e as CustomEvent<{ x?: number; z?: number; dx?: number; dz?: number }>
      if (ev.detail?.dx !== undefined || ev.detail?.dz !== undefined) {
        const dx = ev.detail.dx ?? 0
        const dz = ev.detail.dz ?? 0
        if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) {
          recordInteraction({ type: 'move', dx, dz })
        }
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('nw:panel-open', onNWPanel)
    window.addEventListener('nw:panel-close', onNWPanel)
    window.addEventListener('nw:layer-toggle', onNWPanel)
    window.addEventListener('nw:agent-toggle', onAgentToggle)
    window.addEventListener('nw:player-position', onPlayerPos)

    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('nw:panel-open', onNWPanel)
      window.removeEventListener('nw:panel-close', onNWPanel)
      window.removeEventListener('nw:layer-toggle', onNWPanel)
      window.removeEventListener('nw:agent-toggle', onAgentToggle)
      window.removeEventListener('nw:player-position', onPlayerPos)
    }
  }, [recordInteraction])

  // ── Manual override listener ────────────────────────────────────────────────

  useEffect(() => {
    function onOverride(e: Event) {
      const ev = e as CustomEvent<{ mode: ColorMode }>
      if (!ev.detail?.mode) return
      colorModeRef.current = ev.detail.mode
      try { localStorage.setItem('nw_color_mode', ev.detail.mode) } catch { /* ignore */ }
    }
    window.addEventListener('nw:color-mode-override', onOverride)
    return () => window.removeEventListener('nw:color-mode-override', onOverride)
  }, [])

  // ── Animation loop ──────────────────────────────────────────────────────────

  useEffect(() => {
    function lerp(a: number, b: number, t: number) {
      return a + (b - a) * t
    }

    function tick() {
      const now = Date.now()

      // Determine target payload
      let newTarget: Omit<ColorTemperaturePayload, 'state'>
      let stateLabel: CognitiveState

      const mode = colorModeRef.current
      if (mode !== 'auto') {
        newTarget  = MANUAL_PRESETS[mode]
        stateLabel = mode === 'agent' ? 'DELEGATING'
                   : mode === 'warm'  ? 'DECISIVE'
                   : mode === 'cool'  ? 'ANALYTICAL'
                   : 'STRATEGIC'
      } else {
        stateLabel = detectState(recordsRef.current, lastInteractionRef.current)
        newTarget  = STATE_TARGETS[stateLabel]
      }

      // Start a new transition if state changed
      if (stateLabel !== currentStateRef.current) {
        currentStateRef.current    = stateLabel
        transitionStartRef.current = now
        transitionFromRef.current  = { ...currentPayloadRef.current }
        targetPayloadRef.current   = newTarget
      }

      // Update target if mode-driven (manual always tracks)
      if (mode !== 'auto') {
        targetPayloadRef.current = newTarget
      }

      // Lerp current → target
      const elapsed = now - transitionStartRef.current
      const t = Math.min(1, elapsed / LERP_DURATION_MS)
      const from    = transitionFromRef.current
      const target  = targetPayloadRef.current

      currentPayloadRef.current = {
        warm_factor:       lerp(from.warm_factor,       target.warm_factor,       t),
        cool_factor:       lerp(from.cool_factor,       target.cool_factor,       t),
        saturation_factor: lerp(from.saturation_factor, target.saturation_factor, t),
        brightness_factor: lerp(from.brightness_factor, target.brightness_factor, t),
      }

      // Dispatch event at throttled rate
      if (now - lastDispatchRef.current >= DISPATCH_INTERVAL) {
        lastDispatchRef.current = now
        const payload: ColorTemperaturePayload = {
          state: stateLabel,
          ...currentPayloadRef.current,
        }
        window.dispatchEvent(new CustomEvent('nw:color-temperature', { detail: payload }))
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return null
}

// ── HUD: Cognitive State Indicator ───────────────────────────────────────────

const STATE_CONFIG: Record<CognitiveState, { icon: string; label: string; color: string }> = {
  ANALYTICAL:  { icon: '🔬', label: 'ANALYTICAL',  color: '#00c8ff' },
  STRATEGIC:   { icon: '🌐', label: 'STRATEGIC',   color: '#80c880' },
  DECISIVE:    { icon: '⚡', label: 'DECISIVE',    color: '#ffb040' },
  DELEGATING:  { icon: '🤖', label: 'DELEGATING',  color: '#00e5cc' },
  RESTING:     { icon: '🌙', label: 'RESTING',     color: '#c0a0e8' },
}

/**
 * CognitiveStateHUD — small bottom-right indicator showing current cognitive state.
 * Fades in/out subtly. Not intrusive.
 */
export function CognitiveStateHUD() {
  const [state, setState]     = useState<CognitiveState>('STRATEGIC')
  const [visible, setVisible] = useState(false)
  const fadeTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onColorTemp(e: Event) {
      const ev = e as CustomEvent<ColorTemperaturePayload>
      if (!ev.detail?.state) return
      const newState = ev.detail.state
      if (newState !== state) {
        setState(newState)
        // Briefly show the indicator on state change
        setVisible(true)
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
        fadeTimerRef.current = setTimeout(() => setVisible(false), 4000)
      }
    }

    // Always show on mount briefly
    setVisible(true)
    fadeTimerRef.current = setTimeout(() => setVisible(false), 3000)

    window.addEventListener('nw:color-temperature', onColorTemp)
    return () => {
      window.removeEventListener('nw:color-temperature', onColorTemp)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Listen separately to keep `state` updated even while visible=false
  useEffect(() => {
    function onColorTemp(e: Event) {
      const ev = e as CustomEvent<ColorTemperaturePayload>
      if (ev.detail?.state) setState(ev.detail.state)
    }
    window.addEventListener('nw:color-temperature', onColorTemp)
    return () => window.removeEventListener('nw:color-temperature', onColorTemp)
  }, [])

  const cfg = STATE_CONFIG[state]

  return (
    <div
      style={{
        position:        'absolute',
        bottom:          110,
        right:           14,
        zIndex:          27,
        display:         'flex',
        alignItems:      'center',
        gap:             6,
        background:      'rgba(5,5,15,0.70)',
        border:          `1px solid ${cfg.color}40`,
        borderRadius:    20,
        padding:         '4px 10px 4px 8px',
        backdropFilter:  'blur(6px)',
        fontFamily:      'monospace',
        pointerEvents:   'none',
        opacity:         visible ? 1 : 0,
        transition:      'opacity 1.2s ease',
        userSelect:      'none',
      }}
      title={`Cognitive Mode: ${cfg.label}`}
    >
      <span style={{ fontSize: 13, lineHeight: 1 }}>{cfg.icon}</span>
      <span style={{ color: cfg.color, fontSize: 8, letterSpacing: 1.5, fontWeight: 700 }}>
        {cfg.label}
      </span>
    </div>
  )
}

// ── Color Mode Selector (used inside SettingsPanel) ────────────────────────────

const COLOR_MODE_OPTIONS: { value: ColorMode; label: string; icon: string }[] = [
  { value: 'auto',    label: 'Auto (Cognitive)',  icon: '🧠' },
  { value: 'warm',    label: 'Warm (Decisive)',   icon: '🔆' },
  { value: 'cool',    label: 'Cool (Analytical)', icon: '❄️' },
  { value: 'neutral', label: 'Neutral',           icon: '◐'  },
  { value: 'agent',   label: 'Agent Focus',       icon: '🤖' },
]

interface ColorModeSelectorProps {
  /** Current color mode value */
  value: ColorMode
  /** Called when user picks a new mode */
  onChange: (mode: ColorMode) => void
}

export function ColorModeSelector({ value, onChange }: ColorModeSelectorProps) {
  return (
    <div>
      <div style={{
        color:         'rgba(255,255,255,0.45)',
        fontSize:      9,
        letterSpacing: 1,
        marginBottom:  5,
      }}>
        COLOR MODE
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {COLOR_MODE_OPTIONS.map(opt => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              style={{
                width:        '100%',
                padding:      '4px 8px',
                fontSize:     9,
                letterSpacing: 1,
                borderRadius: 4,
                border:       `1px solid ${active ? 'rgba(0,229,204,0.6)' : 'rgba(255,255,255,0.12)'}`,
                background:   active ? 'rgba(0,229,204,0.12)' : 'transparent',
                color:        active ? '#00e5cc' : 'rgba(255,255,255,0.4)',
                cursor:       'pointer',
                textAlign:    'left',
                transition:   'all 0.12s',
                fontFamily:   'monospace',
                display:      'flex',
                alignItems:   'center',
                gap:          6,
              }}
            >
              <span style={{ fontSize: 10 }}>{opt.icon}</span>
              {opt.label}
            </button>
          )
        })}
      </div>
      <div style={{
        color:         'rgba(255,255,255,0.2)',
        fontSize:      7.5,
        letterSpacing: 0.8,
        marginTop:     4,
        lineHeight:    1.5,
      }}>
        Auto detects your focus mode · Agent brightens AI teal
      </div>
    </div>
  )
}
