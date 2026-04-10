/**
 * SonicLandscape.tsx — NW43 + NW46: React component that drives the Neural World audio layer.
 *
 * NW46 additions:
 *   - SoundProfileButton: replaces MuteButton. Vertical popup with 5 mode names + icons.
 *   - AudioSettingsSection: per-layer volume sliders, inactive sliders grayed out.
 *   - Crystal chime scheduler driven by profile changes.
 *   - 0.5s crossfade between profiles.
 *
 * Event wiring (unchanged from NW43):
 *   nw:resonance-state-transform  → set ambient drone + world pulse
 *   nw:world-speed-factor         → infer resonance state
 *   nw:player-position            → node proximity, spatial positioning
 *   nw:nexus-sweep-complete       → NEXUS sweep whoosh + merge chime
 *   nw:automation-failure         → automation failure buzz
 *   nw:sound-invoice-paid         → invoice paid ascending tone
 *   nw:sound-lead-captured        → lead captured ping
 *   nw:sound-phase-transition     → phase transition shimmer
 *   nw:sound-data-cube-pickup     → data cube crystalline chime
 *   nw:sound-data-cube-drop       → data cube drop chime
 *   nw:sound-fog-entered          → fog entered ambient pad
 *   nw:sound-agent-flyby          → agent flyby whoosh
 *   nw:sound-katsuro-bridge       → Katsuro bridge chord
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  getAudioEngine,
  resetAudioEngine,
  type ResonanceState,
} from './AudioEngine'
import {
  type SoundProfile,
  type LayerVolumes,
  PROFILE_LABELS,
  PROFILE_ICONS,
  PROFILE_DESCRIPTIONS,
  loadProfile,
  loadLayerVolumes,
  getActiveSliders,
  clamp01,
} from './SoundProfileManager'

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
  speed?: number
  distance?: number
}

interface FogEnteredDetail {
  type: 'revenue' | 'security' | 'bandwidth' | 'improvement'
}

interface KatsuroBridgeDetail {
  distance: number
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

  const resonanceStateRef = useRef<ResonanceState>('COHERENT')
  const resonanceScoreRef = useRef(0.5)
  const playerPosRef = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 })

  const katsuroCooldownRef  = useRef(0)
  const riverCooldownRef    = useRef(0)
  const fortressCooldownRef = useRef(0)

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

    if (!hasEnabledOnceRef.current) {
      hasEnabledOnceRef.current = true
      setShowTooltip(true)
      setTimeout(() => setShowTooltip(false), 5000)
    }

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

  useEffect(() => {
    return () => { resetAudioEngine() }
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
      if (engine.isInitialized) engine.setResonanceState(state, score)
    }

    function onWorldSpeedFactor(e: Event) {
      if (!enabledRef.current) return
      const ev = e as CustomEvent<WorldSpeedFactorDetail>
      if (!ev.detail) return
      const f = ev.detail.factor
      const state: ResonanceState =
        f <= 0.8 ? 'DISSONANT' :
        f <= 1.1 ? 'COHERENT'  : 'GROWTH'
      const score = (f - 0.7) / 0.6
      if (state !== resonanceStateRef.current) {
        resonanceStateRef.current = state
        resonanceScoreRef.current = Math.max(0, Math.min(1, score))
        const engine = getAudioEngine()
        if (engine.isInitialized) engine.setResonanceState(state, resonanceScoreRef.current)
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

      const katsuroDist = Math.sqrt(
        Math.pow(ev.detail.x - 80, 2) +
        Math.pow(ev.detail.z - (-40), 2)
      )
      if (katsuroDist < 20 && now - katsuroCooldownRef.current > 8000) {
        katsuroCooldownRef.current = now
        engine.playKatsuroBridgeChord(katsuroDist)
      }

      const inRiver = Math.abs(ev.detail.x) < 20
      if (inRiver && now - riverCooldownRef.current > 4000) {
        riverCooldownRef.current = now
        const widthFactor = 1.0 - Math.abs(ev.detail.x) / 20
        engine.playRiverSound(widthFactor, resonanceStateRef.current === 'COHERENT')
      }

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
      if (distance < 10) engine.playAgentFlyby(speed)
    }

    function onDataCubePickup() {
      if (!enabledRef.current) return
      const engine = getAudioEngine()
      if (engine.isInitialized) engine.playDataCubePickup()
    }

    function onDataCubeDrop() {
      if (!enabledRef.current) return
      const engine = getAudioEngine()
      if (engine.isInitialized) engine.playDataCubeDrop()
    }

    window.addEventListener('nw:nexus-sweep-complete',   onNexusSweepComplete)
    window.addEventListener('nw:sound-agent-flyby',      onAgentFlyby)
    window.addEventListener('nw:sound-data-cube-pickup', onDataCubePickup)
    window.addEventListener('nw:sound-data-cube-drop',   onDataCubeDrop)
    return () => {
      window.removeEventListener('nw:nexus-sweep-complete',   onNexusSweepComplete)
      window.removeEventListener('nw:sound-agent-flyby',      onAgentFlyby)
      window.removeEventListener('nw:sound-data-cube-pickup', onDataCubePickup)
      window.removeEventListener('nw:sound-data-cube-drop',   onDataCubeDrop)
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

    window.addEventListener('nw:sound-invoice-paid',      onInvoicePaid)
    window.addEventListener('nw:sound-lead-captured',     onLeadCaptured)
    window.addEventListener('nw:automation-failure',      onAutomationFailure)
    window.addEventListener('nw:sound-phase-transition',  onPhaseTransition)
    window.addEventListener('nw:sound-fog-entered',       onFogEntered)
    window.addEventListener('nw:sound-katsuro-bridge',    onKatsuroBridge)
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
      textAlign: 'center',
      lineHeight: 1.5,
    }}>
      ♪ Neural World audio enabled. Click the speaker icon to choose a sound profile.
    </div>
  )
}

// ── SoundProfileButton — NW46 HUD selector ───────────────────────────────────

const PROFILES: SoundProfile[] = ['SILENT', 'MINIMAL', 'AMBIENT', 'FOCUS', 'IMMERSIVE']

interface SoundProfileButtonProps {
  soundLayerEnabled: boolean
}

export function SoundProfileButton({ soundLayerEnabled }: SoundProfileButtonProps) {
  const engine = getAudioEngine()
  const [profile, setProfile] = useState<SoundProfile>(() => loadProfile())
  const [popupOpen, setPopupOpen] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)

  // Close popup on outside click
  useEffect(() => {
    if (!popupOpen) return
    function handleOutside(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopupOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [popupOpen])

  const handleSelect = useCallback((p: SoundProfile) => {
    if (!engine.isInitialized) engine.init()
    engine.setProfile(p)
    setProfile(p)
    setPopupOpen(false)
  }, [engine])

  const handleToggle = useCallback(() => {
    if (!engine.isInitialized) engine.init()
    setPopupOpen(prev => !prev)
  }, [engine])

  if (!soundLayerEnabled) return null

  const isMuted = profile === 'SILENT'
  const isImmersive = profile === 'IMMERSIVE'
  const icon = PROFILE_ICONS[profile]

  return (
    <div ref={popupRef} style={{ position: 'relative' }}>
      {/* ── Popup (vertical list, above the button) ── */}
      {popupOpen && (
        <div style={{
          position: 'absolute',
          bottom: '110%',
          right: 0,
          zIndex: 60,
          background: 'rgba(5,5,15,0.96)',
          border: '1px solid rgba(0,229,204,0.30)',
          borderRadius: 8,
          padding: '8px 0',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.7)',
          minWidth: 230,
          animation: 'nw-profile-popup-in 0.15s ease',
        }}>
          {/* Header */}
          <div style={{
            padding: '4px 14px 8px',
            color: 'rgba(0,229,204,0.6)',
            fontSize: 9,
            fontFamily: 'monospace',
            letterSpacing: 2,
            fontWeight: 700,
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            marginBottom: 4,
          }}>
            SOUND PROFILE
          </div>

          {PROFILES.map(p => {
            const isActive = p === profile
            const isImm    = p === 'IMMERSIVE'
            return (
              <button
                key={p}
                onClick={() => handleSelect(p)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '8px 14px',
                  background: isActive ? 'rgba(0,229,204,0.12)' : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? '2px solid #00e5cc' : '2px solid transparent',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  textAlign: 'left',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
              >
                {/* Icon */}
                <span style={{
                  fontSize: 16,
                  lineHeight: 1,
                  filter: isImm && isActive ? 'drop-shadow(0 0 4px rgba(0,229,204,0.8))' : 'none',
                }}>
                  {PROFILE_ICONS[p]}
                </span>

                {/* Label + description */}
                <div>
                  <div style={{
                    fontSize: 11,
                    fontWeight: isActive ? 700 : 400,
                    color: isActive ? '#00e5cc' : 'rgba(255,255,255,0.75)',
                    letterSpacing: 0.5,
                    marginBottom: 2,
                  }}>
                    {PROFILE_LABELS[p]}
                    {p === 'MINIMAL' && (
                      <span style={{
                        marginLeft: 6,
                        fontSize: 8,
                        color: 'rgba(0,229,204,0.55)',
                        letterSpacing: 1,
                      }}>DEFAULT</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 9,
                    color: 'rgba(255,255,255,0.35)',
                    letterSpacing: 0.2,
                    lineHeight: 1.4,
                  }}>
                    {PROFILE_DESCRIPTIONS[p]}
                  </div>
                </div>

                {/* Active dot */}
                {isActive && (
                  <div style={{
                    marginLeft: 'auto',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#00e5cc',
                    boxShadow: '0 0 6px #00e5cc',
                    flexShrink: 0,
                  }} />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Speaker / profile button ── */}
      <button
        onClick={handleToggle}
        title={`Sound profile: ${PROFILE_LABELS[profile]} — click to change`}
        style={{
          width:        34,
          height:       34,
          minWidth:     44,
          minHeight:    44,
          borderRadius: 8,
          border: `1px solid ${
            isMuted  ? 'rgba(255,255,255,0.15)' :
            isImmersive ? 'rgba(0,229,204,0.7)' :
            'rgba(0,229,204,0.4)'
          }`,
          background: isMuted
            ? 'rgba(0,0,0,0.6)'
            : isImmersive
            ? 'rgba(0,229,204,0.15)'
            : 'rgba(0,229,204,0.10)',
          color: isMuted ? 'rgba(255,255,255,0.4)' : '#00e5cc',
          fontSize:    16,
          cursor:      'pointer',
          display:     'flex',
          alignItems:  'center',
          justifyContent: 'center',
          backdropFilter: 'blur(6px)',
          transition: 'all 0.15s',
          lineHeight:  1,
          touchAction: 'none',
          userSelect:  'none',
          boxShadow: isImmersive && !isMuted
            ? '0 0 10px rgba(0,229,204,0.3)'
            : 'none',
        }}
      >
        {icon}
      </button>

      <style>{`
        @keyframes nw-profile-popup-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

// ── AudioSettingsSection — NW46 per-layer volume sliders ─────────────────────

export function AudioSettingsSection() {
  const engine = getAudioEngine()
  const [profile, setProfile]       = useState<SoundProfile>(() => loadProfile())
  const [volumes, setVolumes]       = useState<LayerVolumes>(() => loadLayerVolumes())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleProfileChange = useCallback((p: SoundProfile) => {
    if (!engine.isInitialized) engine.init()
    engine.setProfile(p)
    setProfile(p)
  }, [engine])

  const handleVolumeChange = useCallback((key: keyof LayerVolumes, rawVal: number) => {
    const v = clamp01(rawVal)
    engine.setLayerVolume(key, v)
    setVolumes(prev => ({ ...prev, [key]: v }))
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      setVolumes(engine.getLayerVolumes())
    }, 100)
  }, [engine])

  const active = getActiveSliders(profile)

  // Layer slider rows config
  const layerSliders: Array<{
    key:   keyof LayerVolumes
    label: string
    activeKey: keyof ReturnType<typeof getActiveSliders>
    inactiveName: string
  }> = [
    { key: 'events',    label: 'EVENT SOUNDS',   activeKey: 'events',    inactiveName: 'SILENT' },
    { key: 'ambient',   label: 'AMBIENT / WIND',  activeKey: 'ambient',   inactiveName: 'MINIMAL' },
    { key: 'proximity', label: 'PROXIMITY TONES', activeKey: 'proximity', inactiveName: 'AMBIENT' },
    { key: 'pulse',     label: 'WORLD PULSE',     activeKey: 'pulse',     inactiveName: 'AMBIENT' },
    { key: 'drone',     label: 'DRONE',           activeKey: 'drone',     inactiveName: 'FOCUS' },
  ]

  return (
    <>
      {/* ◈ AUDIO header */}
      <div style={{
        color: '#00e5cc',
        fontSize: 9,
        letterSpacing: 2,
        marginBottom: 6,
        fontWeight: 700,
        marginTop: 4,
      }}>
        ◈ AUDIO — SOUND PROFILE
      </div>

      {/* Profile selector buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
        {PROFILES.map(p => {
          const isActive = p === profile
          return (
            <button
              key={p}
              onClick={() => handleProfileChange(p)}
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          8,
                padding:      '5px 8px',
                borderRadius: 4,
                border: `1px solid ${isActive ? 'rgba(0,229,204,0.6)' : 'rgba(255,255,255,0.12)'}`,
                background: isActive ? 'rgba(0,229,204,0.12)' : 'transparent',
                color: isActive ? '#00e5cc' : 'rgba(255,255,255,0.45)',
                cursor:       'pointer',
                fontFamily:   'monospace',
                fontSize:     9,
                textAlign:    'left',
                transition:   'all 0.12s',
              }}
            >
              <span style={{ fontSize: 12 }}>{PROFILE_ICONS[p]}</span>
              <span style={{ fontWeight: isActive ? 700 : 400 }}>{PROFILE_LABELS[p]}</span>
              {p === 'MINIMAL' && (
                <span style={{ fontSize: 8, color: 'rgba(0,229,204,0.5)', letterSpacing: 1 }}>DEF</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Master Volume */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, letterSpacing: 1 }}>MASTER VOLUME</span>
          <span style={{ color: '#00e5cc', fontSize: 9, letterSpacing: 1 }}>{Math.round(volumes.master * 100)}%</span>
        </div>
        <input
          type="range"
          min={0} max={1} step={0.01}
          value={volumes.master}
          onChange={e => handleVolumeChange('master', parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: '#00e5cc', cursor: 'pointer' }}
        />
      </div>

      {/* Per-layer volume sliders */}
      <div style={{
        color: 'rgba(255,255,255,0.3)',
        fontSize: 8,
        letterSpacing: 1.5,
        marginBottom: 4,
      }}>
        LAYER VOLUMES
      </div>

      {layerSliders.map(({ key, label, activeKey, inactiveName }) => {
        const isActive = active[activeKey]
        return (
          <div key={key} style={{ marginBottom: 5, opacity: isActive ? 1 : 0.4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{
                color: isActive ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)',
                fontSize: 9,
                letterSpacing: 1,
              }}>
                {label}
              </span>
              <span style={{
                color: isActive ? '#00e5cc' : 'rgba(255,255,255,0.2)',
                fontSize: 9,
                letterSpacing: 1,
              }}>
                {isActive
                  ? `${Math.round(volumes[key] * 100)}%`
                  : `Not active in ${inactiveName}`
                }
              </span>
            </div>
            <input
              type="range"
              min={0} max={1} step={0.01}
              value={volumes[key]}
              disabled={!isActive}
              onChange={e => handleVolumeChange(key, parseFloat(e.target.value))}
              style={{
                width: '100%',
                accentColor: '#00e5cc',
                cursor: isActive ? 'pointer' : 'not-allowed',
                opacity: isActive ? 1 : 0.4,
              }}
            />
          </div>
        )
      })}
    </>
  )
}

// ── MuteButton — kept for backward compat (delegates to SoundProfileButton) ──

interface MuteButtonProps {
  soundLayerEnabled: boolean
}

/** @deprecated Use SoundProfileButton instead (NW46). This wrapper delegates to it. */
export function MuteButton({ soundLayerEnabled }: MuteButtonProps) {
  return <SoundProfileButton soundLayerEnabled={soundLayerEnabled} />
}
