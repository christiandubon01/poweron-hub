/**
 * SonicLandscape.tsx — NW43: React component that drives the Neural World audio layer.
 *
 * Connects world events → AudioEngine:
 *   - nw:resonance-state-transform  → set ambient drone + world pulse
 *   - nw:world-speed-factor         → infer resonance state (0.7 = DISSONANT, 1.0 = COHERENT, 1.3 = GROWTH)
 *   - nw:player-position            → node proximity, spatial positioning
 *   - nw:nexus-sweep-complete       → NEXUS sweep whoosh + merge chime
 *   - nw:automation-failure         → automation failure buzz
 *   - nw:sound-invoice-paid         → invoice paid ascending tone
 *   - nw:sound-lead-captured        → lead captured ping
 *   - nw:sound-phase-transition     → phase transition shimmer
 *   - nw:sound-data-cube-pickup     → data cube crystalline chime
 *   - nw:sound-data-cube-drop       → data cube drop chime
 *   - nw:sound-fog-entered          → fog entered ambient pad
 *   - nw:sound-agent-flyby          → agent flyby whoosh
 *   - nw:sound-katsuro-bridge       → Katsuro bridge chord
 *
 * Layer toggle: 'sound' — off by default.
 * First enable shows tooltip "Neural World audio enabled. Headphones recommended."
 *
 * The component renders no visible DOM in normal operation;
 * the mute button and settings are rendered by CommandHUD/SettingsPanel.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  getAudioEngine,
  resetAudioEngine,
  type ResonanceState,
} from './AudioEngine'

// ── Event detail types ────────────────────────────────────────────────────────

interface PlayerPositionDetail {
  x: number
  y: number
  z: number
}

interface ResonanceStateTransformDetail {
  state: ResonanceState
  score: number
}

interface WorldSpeedFactorDetail {
  factor: number
}

interface AutomationFailureDetail {
  flowId?: string
}

interface AgentFlybyDetail {
  speed?: number       // 0–1 relative speed
  distance?: number    // units from camera
}

interface FogEnteredDetail {
  type: 'revenue' | 'security' | 'bandwidth' | 'improvement'
}

interface KatsuroBridgeDetail {
  distance: number     // units from camera (0–20)
}

interface DataCubeDetail {
  value?: number
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface SonicLandscapeProps {
  /** Whether the 'sound' layer is enabled (from CommandHUD layer toggle) */
  enabled: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SonicLandscape({ enabled }: SonicLandscapeProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const hasEnabledOnceRef = useRef(false)
  const enabledRef = useRef(enabled)

  // Track resonance state
  const resonanceStateRef = useRef<ResonanceState>('COHERENT')
  const resonanceScoreRef = useRef(0.5)

  // Track player position for proximity calculations
  const playerPosRef = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 })

  // Cooldowns to avoid sound spam
  const katsuroCooldownRef    = useRef(0)
  const riverCooldownRef      = useRef(0)
  const fortressCooldownRef   = useRef(0)

  // Update enabled ref
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  // ── Init / dispose on enabled toggle ─────────────────────────────────────

  const initAudio = useCallback(() => {
    const engine = getAudioEngine()
    if (!engine.isInitialized) {
      engine.init()
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    // First-enable tooltip
    if (!hasEnabledOnceRef.current) {
      hasEnabledOnceRef.current = true
      setShowTooltip(true)
      setTimeout(() => setShowTooltip(false), 5000)
    }

    // Audio context must be created on user gesture.
    // We hook into any user interaction to init.
    const handleUserGesture = () => {
      initAudio()
      window.removeEventListener('click',      handleUserGesture)
      window.removeEventListener('keydown',    handleUserGesture)
      window.removeEventListener('touchstart', handleUserGesture)
    }
    window.addEventListener('click',      handleUserGesture)
    window.addEventListener('keydown',    handleUserGesture)
    window.addEventListener('touchstart', handleUserGesture)

    return () => {
      window.removeEventListener('click',      handleUserGesture)
      window.removeEventListener('keydown',    handleUserGesture)
      window.removeEventListener('touchstart', handleUserGesture)
    }
  }, [enabled, initAudio])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      resetAudioEngine()
    }
  }, [])

  // ── Resonance state events ────────────────────────────────────────────────

  useEffect(() => {
    function onResonanceTransform(e: Event) {
      if (!enabledRef.current) return
      const ev = e as CustomEvent<ResonanceStateTransformDetail>
      if (!ev.detail) return
      const { state, score } = ev.detail
      resonanceStateRef.current = state
      resonanceScoreRef.current = score
      const engine = getAudioEngine()
      if (engine.isInitialized) {
        engine.setResonanceState(state, score)
      }
    }

    function onWorldSpeedFactor(e: Event) {
      if (!enabledRef.current) return
      const ev = e as CustomEvent<WorldSpeedFactorDetail>
      if (!ev.detail) return
      // Infer state from speed factor
      const f = ev.detail.factor
      const state: ResonanceState =
        f <= 0.8  ? 'DISSONANT' :
        f <= 1.1  ? 'COHERENT'  :
        'GROWTH'
      // Only update if state changed (score approximated from factor)
      const score = (f - 0.7) / 0.6  // map 0.7–1.3 → 0–1
      if (state !== resonanceStateRef.current) {
        resonanceStateRef.current = state
        resonanceScoreRef.current = Math.max(0, Math.min(1, score))
        const engine = getAudioEngine()
        if (engine.isInitialized) {
          engine.setResonanceState(state, resonanceScoreRef.current)
        }
      }
    }

    window.addEventListener('nw:resonance-state-transform', onResonanceTransform)
    window.addEventListener('nw:world-speed-factor',        onWorldSpeedFactor)
    return () => {
      window.removeEventListener('nw:resonance-state-transform', onResonanceTransform)
      window.removeEventListener('nw:world-speed-factor',        onWorldSpeedFactor)
    }
  }, [])

  // ── Player position / proximity sounds ───────────────────────────────────

  useEffect(() => {
    function onPlayerPosition(e: Event) {
      if (!enabledRef.current) return
      const ev = e as CustomEvent<PlayerPositionDetail>
      if (!ev.detail) return
      playerPosRef.current = { x: ev.detail.x, y: ev.detail.y, z: ev.detail.z }

      const engine = getAudioEngine()
      if (!engine.isInitialized) return
      const now = Date.now()

      // Katsuro Bridge Tower at approximately x=80, z=-40 (east continent)
      const katsuroDist = Math.sqrt(
        Math.pow(ev.detail.x - 80, 2) +
        Math.pow(ev.detail.z - (-40), 2)
      )
      if (katsuroDist < 20 && now - katsuroCooldownRef.current > 8000) {
        katsuroCooldownRef.current = now
        engine.playKatsuroBridgeChord(katsuroDist)
      }

      // Revenue river: x = -20..20 (central channel)
      const inRiver = Math.abs(ev.detail.x) < 20
      if (inRiver && now - riverCooldownRef.current > 4000) {
        riverCooldownRef.current = now
        const widthFactor = 1.0 - Math.abs(ev.detail.x) / 20
        engine.playRiverSound(widthFactor, resonanceStateRef.current === 'COHERENT')
      }

      // Fortress: center of west continent at approximately x=-100, z=0
      const fortressDist = Math.sqrt(
        Math.pow(ev.detail.x - (-100), 2) +
        Math.pow(ev.detail.z, 2)
      )
      if (fortressDist < 25 && now - fortressCooldownRef.current > 10000) {
        fortressCooldownRef.current = now
        engine.playFortressHum()
      }
    }

    window.addEventListener('nw:player-position', onPlayerPosition)
    return () => window.removeEventListener('nw:player-position', onPlayerPosition)
  }, [])

  // ── Agent sounds ──────────────────────────────────────────────────────────

  useEffect(() => {
    function onNexusSweepComplete() {
      if (!enabledRef.current) return
      const engine = getAudioEngine()
      if (engine.isInitialized) {
        engine.playNexusSweep()
        // Slight delay for merge chime at OPERATOR
        setTimeout(() => {
          if (enabledRef.current && engine.isInitialized) {
            engine.playNexusMerge()
          }
        }, 1200)
      }
    }

    function onAgentFlyby(e: Event) {
      if (!enabledRef.current) return
      const ev = e as CustomEvent<AgentFlybyDetail>
      const engine = getAudioEngine()
      if (!engine.isInitialized) return
      const speed    = ev.detail?.speed    ?? 0.5
      const distance = ev.detail?.distance ?? 5
      if (distance < 10) {
        engine.playAgentFlyby(speed)
      }
    }

    function onDataCubePickup(e: Event) {
      if (!enabledRef.current) return
      void e
      const engine = getAudioEngine()
      if (engine.isInitialized) engine.playDataCubePickup()
    }

    function onDataCubeDrop(e: Event) {
      if (!enabledRef.current) return
      void e
      const engine = getAudioEngine()
      if (engine.isInitialized) engine.playDataCubeDrop()
    }

    window.addEventListener('nw:nexus-sweep-complete',    onNexusSweepComplete)
    window.addEventListener('nw:sound-agent-flyby',       onAgentFlyby)
    window.addEventListener('nw:sound-data-cube-pickup',  onDataCubePickup)
    window.addEventListener('nw:sound-data-cube-drop',    onDataCubeDrop)
    return () => {
      window.removeEventListener('nw:nexus-sweep-complete',    onNexusSweepComplete)
      window.removeEventListener('nw:sound-agent-flyby',       onAgentFlyby)
      window.removeEventListener('nw:sound-data-cube-pickup',  onDataCubePickup)
      window.removeEventListener('nw:sound-data-cube-drop',    onDataCubeDrop)
    }
  }, [])

  // ── Event sounds ──────────────────────────────────────────────────────────

  useEffect(() => {
    function onInvoicePaid() {
      if (!enabledRef.current) return
      const engine = getAudioEngine()
      if (engine.isInitialized) engine.playInvoicePaid()
    }

    function onLeadCaptured() {
      if (!enabledRef.current) return
      const engine = getAudioEngine()
      if (engine.isInitialized) engine.playLeadCaptured()
    }

    function onAutomationFailure(e: Event) {
      if (!enabledRef.current) return
      void (e as CustomEvent<AutomationFailureDetail>)
      const engine = getAudioEngine()
      if (engine.isInitialized) engine.playAutomationFailure()
    }

    function onPhaseTransition() {
      if (!enabledRef.current) return
      const engine = getAudioEngine()
      if (engine.isInitialized) engine.playPhaseTransition()
    }

    function onFogEntered(e: Event) {
      if (!enabledRef.current) return
      const ev = e as CustomEvent<FogEnteredDetail>
      if (!ev.detail?.type) return
      const engine = getAudioEngine()
      if (engine.isInitialized) engine.playFogEntered(ev.detail.type)
    }

    function onKatsuroBridge(e: Event) {
      if (!enabledRef.current) return
      const ev = e as CustomEvent<KatsuroBridgeDetail>
      if (!ev.detail) return
      const engine = getAudioEngine()
      if (engine.isInitialized) engine.playKatsuroBridgeChord(ev.detail.distance)
    }

    // Also connect automation-failure from AutomationFlowLayer
    window.addEventListener('nw:sound-invoice-paid',       onInvoicePaid)
    window.addEventListener('nw:sound-lead-captured',      onLeadCaptured)
    window.addEventListener('nw:automation-failure',       onAutomationFailure)
    window.addEventListener('nw:sound-phase-transition',   onPhaseTransition)
    window.addEventListener('nw:sound-fog-entered',        onFogEntered)
    window.addEventListener('nw:sound-katsuro-bridge',     onKatsuroBridge)
    return () => {
      window.removeEventListener('nw:sound-invoice-paid',      onInvoicePaid)
      window.removeEventListener('nw:sound-lead-captured',     onLeadCaptured)
      window.removeEventListener('nw:automation-failure',      onAutomationFailure)
      window.removeEventListener('nw:sound-phase-transition',  onPhaseTransition)
      window.removeEventListener('nw:sound-fog-entered',       onFogEntered)
      window.removeEventListener('nw:sound-katsuro-bridge',    onKatsuroBridge)
    }
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  if (!showTooltip) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 90,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 60,
      background: 'rgba(5,5,15,0.90)',
      border: '1px solid rgba(0,229,204,0.35)',
      borderRadius: 8,
      padding: '10px 18px',
      color: '#00e5cc',
      fontFamily: 'monospace',
      fontSize: 11,
      letterSpacing: 1,
      pointerEvents: 'none',
      backdropFilter: 'blur(8px)',
      animation: 'nw-fade-in 0.3s ease',
      textAlign: 'center',
      lineHeight: 1.5,
    }}>
      ♪ Neural World audio enabled. Headphones recommended.
    </div>
  )
}

// ── Audio Settings Panel Section ──────────────────────────────────────────────

/**
 * AudioSettingsSection: rendered inside SettingsPanel under a ◈ AUDIO header.
 * Provides master volume slider + per-channel toggles.
 */
export function AudioSettingsSection() {
  const engine = getAudioEngine()
  const [settings, setSettings] = useState(() => engine.loadSettings())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const update = useCallback((patch: Parameters<typeof engine.updateSettings>[0]) => {
    engine.updateSettings(patch)
    setSettings(engine.getSettings())
    // Debounced save (engine already saves, this just refreshes local state)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      setSettings(engine.getSettings())
    }, 100)
  }, [engine])

  const s = settings

  return (
    <>
      {/* ◈ AUDIO header */}
      <div style={{
        color: '#00e5cc',
        fontSize: 9,
        letterSpacing: 2,
        marginBottom: 4,
        fontWeight: 700,
        marginTop: 4,
      }}>
        ◈ AUDIO
      </div>

      {/* Master volume */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, letterSpacing: 1 }}>MASTER VOLUME</span>
          <span style={{ color: '#00e5cc', fontSize: 9, letterSpacing: 1 }}>{Math.round(s.masterVolume * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={s.masterVolume}
          onChange={e => update({ masterVolume: parseFloat(e.target.value) })}
          style={{ width: '100%', accentColor: '#00e5cc', cursor: 'pointer' }}
        />
      </div>

      {/* Channel toggles */}
      {([
        ['ambientEnabled',  'AMBIENT DRONE'],
        ['nodesEnabled',    'NODE TONES'],
        ['agentsEnabled',   'AGENT SOUNDS'],
        ['eventsEnabled',   'EVENT CHIMES'],
        ['pulseEnabled',    'WORLD PULSE'],
      ] as const).map(([key, label]) => (
        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, letterSpacing: 1 }}>{label}</span>
          <button
            onClick={() => update({ [key]: !s[key] })}
            style={{
              width: 38,
              height: 18,
              borderRadius: 9,
              border: 'none',
              background: s[key] ? '#00e5cc' : 'rgba(255,255,255,0.15)',
              position: 'relative',
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
          >
            <div style={{
              position: 'absolute',
              top: 2,
              left: s[key] ? 20 : 2,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: s[key] ? '#050508' : 'rgba(255,255,255,0.5)',
              transition: 'left 0.2s',
            }} />
          </button>
        </div>
      ))}
    </>
  )
}

// ── Mute Toggle Button (rendered in HUD bottom-right) ────────────────────────

interface MuteButtonProps {
  /** Whether the sound layer is enabled */
  soundLayerEnabled: boolean
}

export function MuteButton({ soundLayerEnabled }: MuteButtonProps) {
  const engine = getAudioEngine()
  const [muted, setMuted] = useState(() => engine.loadSettings().muted)

  const handleToggle = useCallback(() => {
    if (!engine.isInitialized) {
      // Try init on interaction
      engine.init()
    }
    const nextMuted = engine.toggleMute()
    setMuted(nextMuted)
  }, [engine])

  if (!soundLayerEnabled) return null

  const icon = muted ? '🔇' : '🔊'

  return (
    <button
      onClick={handleToggle}
      title={muted ? 'Unmute Neural World audio' : 'Mute Neural World audio'}
      style={{
        width:  34,
        height: 34,
        minWidth:  44,
        minHeight: 44,
        borderRadius: 8,
        border: `1px solid ${muted ? 'rgba(255,255,255,0.15)' : 'rgba(0,229,204,0.4)'}`,
        background: muted ? 'rgba(0,0,0,0.6)' : 'rgba(0,229,204,0.10)',
        color: muted ? 'rgba(255,255,255,0.4)' : '#00e5cc',
        fontSize: 16,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(6px)',
        transition: 'all 0.15s',
        lineHeight: 1,
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {icon}
    </button>
  )
}
