/**
 * AuroraEventsLayer.tsx — NW59: Aurora Borealis milestone celebration sky effects.
 *
 * When significant business milestones are achieved, the sky lights up with
 * aurora borealis effects. Bigger achievements → more dramatic aurora.
 *
 * MILESTONE TRIGGERS:
 *   - Revenue milestone ($10K/$25K/$50K/$100K month)  → aurora intensity 1–4
 *   - Project completion (final phase done)            → localized aurora (level 2)
 *   - Large invoice paid (> $5 000)                   → brief flash (level 1)
 *   - New subscription activated                       → subtle ripple (level 1)
 *   - Perfect week (all paid, no overdue, pos. cash)  → full sky 30 s (level 4)
 *
 * AURORA INTENSITY LEVELS:
 *   Level 1 – faint green shimmer, 5 s, 20% sky
 *   Level 2 – green-teal curtain, 10 s, 40% sky
 *   Level 3 – full green-teal-purple, 20 s, 80% sky
 *   Level 4 – dramatic full-spectrum + particle snow, 30 s, full sky
 *
 * CELEBRATION BADGE: slides down from top, stays, slides back up.
 * HISTORY: all triggers logged to localStorage; replay from Settings panel.
 * SOUND: gentle ascending harmonic chord when aurora triggers.
 * LAYERS PANEL: 'aurora' toggle, on by default.
 *
 * Architecture:
 *   - Three.js ShaderMaterial on a curved plane positioned high in the scene
 *   - React DOM overlay for the badge + snow particles at level 4
 *   - Emits / listens to CustomEvents for easy triggering from anywhere in the app
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import { getAudioEngine } from './AudioEngine'

// ── Public event names ──────────────────────────────────────────────────────

/** Dispatch this CustomEvent to trigger an aurora from anywhere in the app.
 *  detail: { level: 1|2|3|4, label: string }
 */
export const NW_AURORA_TRIGGER_EVENT = 'nw:aurora-trigger'

/** Dispatch to replay a stored aurora (visual-only) */
export const NW_AURORA_REPLAY_EVENT = 'nw:aurora-replay'

// ── Types ────────────────────────────────────────────────────────────────────

export type AuroraLevel = 1 | 2 | 3 | 4

export interface AuroraHistoryEntry {
  id: string
  level: AuroraLevel
  label: string
  triggeredAt: string   // ISO timestamp
}

// ── Constants ────────────────────────────────────────────────────────────────

const HISTORY_KEY = 'nw_aurora_history'
const MAX_HISTORY = 100

/** Duration (ms) per level */
const LEVEL_DURATION: Record<AuroraLevel, number> = {
  1: 5_000,
  2: 10_000,
  3: 20_000,
  4: 30_000,
}

/** Peak opacity per level */
const LEVEL_OPACITY: Record<AuroraLevel, number> = {
  1: 0.35,
  2: 0.55,
  3: 0.70,
  4: 0.85,
}

/** Sky coverage (width fraction of the dome plane) per level */
const LEVEL_COVERAGE: Record<AuroraLevel, number> = {
  1: 0.20,
  2: 0.40,
  3: 0.80,
  4: 1.00,
}

// ── localStorage helpers ────────────────────────────────────────────────────

function loadHistory(): AuroraHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    return JSON.parse(raw) as AuroraHistoryEntry[]
  } catch {
    return []
  }
}

function saveHistory(entries: AuroraHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)))
  } catch { /* ignore */ }
}

function addHistoryEntry(entry: AuroraHistoryEntry): void {
  const prev = loadHistory()
  saveHistory([entry, ...prev])
}

// ── Vertex shader ─────────────────────────────────────────────────────────

const AURORA_VERT = /* glsl */`
  varying vec2 vUv;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uCoverage;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Curtain displacement: layered sine waves for organic movement
    float wave1 = sin(pos.x * 0.08 + uTime * 0.42) * 1.8;
    float wave2 = sin(pos.x * 0.14 + uTime * 0.61 + 1.2) * 1.1;
    float wave3 = sin(pos.x * 0.22 + uTime * 0.29 + 2.5) * 0.7;
    pos.y += (wave1 + wave2 + wave3) * uIntensity;

    // Gentle horizontal drift
    pos.x += sin(uTime * 0.18 + pos.y * 0.04) * 2.0 * uIntensity;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

// ── Fragment shader ─────────────────────────────────────────────────────────

const AURORA_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uCoverage;
  uniform float uLevel;   // 1.0–4.0

  // Smooth noise function
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), f.x),
      mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x),
      f.y
    );
  }

  void main() {
    // Curtain fade: bright at top, fade at bottom
    float curtainFade = pow(1.0 - vUv.y, 0.5);
    // Edge softening
    float edgeFade = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    // Coverage masking (centered)
    float covCenter = 0.5;
    float halfCov   = uCoverage * 0.5;
    float covMask   = smoothstep(covCenter - halfCov, covCenter - halfCov * 0.7, vUv.x)
                    * smoothstep(covCenter + halfCov, covCenter + halfCov * 0.7, vUv.x);

    // Animated noise bands for shimmer
    float n = noise(vec2(vUv.x * 3.0 + uTime * 0.15, vUv.y * 8.0 + uTime * 0.22));
    n += noise(vec2(vUv.x * 6.0 - uTime * 0.09, vUv.y * 4.0 + uTime * 0.31)) * 0.5;
    n /= 1.5;

    float alpha = curtainFade * edgeFade * covMask * (0.6 + n * 0.4) * uOpacity;

    // Color gradient based on level and vertical position
    // Level 1: pure green
    // Level 2: green → teal
    // Level 3: green → teal → purple
    // Level 4: green → teal → purple → pink
    float t = vUv.y; // 0 = bottom of curtain, 1 = top

    vec3 colGreen  = vec3(0.1,  0.95, 0.45);
    vec3 colTeal   = vec3(0.0,  0.85, 0.75);
    vec3 colPurple = vec3(0.50, 0.15, 0.85);
    vec3 colPink   = vec3(0.95, 0.30, 0.65);

    vec3 col;
    if (uLevel < 1.5) {
      // Level 1: green shimmer only
      col = mix(colGreen * 0.8, colGreen, t);
    } else if (uLevel < 2.5) {
      // Level 2: green → teal
      col = mix(colGreen, colTeal, t);
    } else if (uLevel < 3.5) {
      // Level 3: green → teal → purple
      col = t < 0.5
        ? mix(colGreen, colTeal, t * 2.0)
        : mix(colTeal, colPurple, (t - 0.5) * 2.0);
    } else {
      // Level 4: full spectrum
      if (t < 0.33)       col = mix(colGreen, colTeal,   t / 0.33);
      else if (t < 0.66)  col = mix(colTeal,  colPurple, (t - 0.33) / 0.33);
      else                col = mix(colPurple, colPink,   (t - 0.66) / 0.34);
    }

    // Add shimmer highlights
    col += vec3(n * 0.15);

    gl_FragColor = vec4(col, alpha);
  }
`

// ── AuroraThreeLayer — Three.js plane inside WorldEngine ───────────────────

interface AuroraThreeLayerProps {
  visible: boolean
}

function AuroraThreeLayer({ visible }: AuroraThreeLayerProps) {
  const { scene } = useWorldContext()

  // Active aurora state
  const activeRef = useRef<{
    level: AuroraLevel
    label: string
    startMs: number
    durationMs: number
    peakOpacity: number
    coverage: number
  } | null>(null)

  const meshRef     = useRef<THREE.Mesh | null>(null)
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  const groupRef    = useRef<THREE.Group | null>(null)

  // ── Build Three.js objects ──────────────────────────────────────────────
  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    // Large curved plane high in the sky
    // PlaneGeometry: width=200, height=60, many segments for vertex displacement
    const geo = new THREE.PlaneGeometry(200, 60, 80, 30)

    const mat = new THREE.ShaderMaterial({
      vertexShader:   AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.DoubleSide,
      blending:       THREE.AdditiveBlending,
      uniforms: {
        uTime:      { value: 0 },
        uIntensity: { value: 0 },
        uOpacity:   { value: 0 },
        uCoverage:  { value: 1.0 },
        uLevel:     { value: 1.0 },
      },
    })

    const mesh = new THREE.Mesh(geo, mat)
    // Position: high above the scene, tilted slightly toward camera
    mesh.position.set(0, 45, -60)
    mesh.rotation.x = -Math.PI * 0.08  // slight tilt toward viewer
    group.add(mesh)

    meshRef.current     = mesh
    materialRef.current = mat

    return () => {
      geo.dispose()
      mat.dispose()
      scene.remove(group)
      meshRef.current     = null
      materialRef.current = null
      groupRef.current    = null
    }
  }, [scene])

  // ── Sync visibility ─────────────────────────────────────────────────────
  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  // ── Listen for trigger events ───────────────────────────────────────────
  useEffect(() => {
    function onTrigger(e: Event) {
      const ev = e as CustomEvent<{ level: AuroraLevel; label: string }>
      const { level, label } = ev.detail
      activeRef.current = {
        level,
        label,
        startMs:     performance.now(),
        durationMs:  LEVEL_DURATION[level],
        peakOpacity: LEVEL_OPACITY[level],
        coverage:    LEVEL_COVERAGE[level],
      }
      if (materialRef.current) {
        materialRef.current.uniforms.uLevel.value    = level
        materialRef.current.uniforms.uCoverage.value = LEVEL_COVERAGE[level]
      }
    }
    window.addEventListener(NW_AURORA_TRIGGER_EVENT, onTrigger)
    return () => window.removeEventListener(NW_AURORA_TRIGGER_EVENT, onTrigger)
  }, [])

  // ── Animation frame ─────────────────────────────────────────────────────
  useEffect(() => {
    function onFrame() {
      if (!materialRef.current || !groupRef.current?.visible) return
      const mat  = materialRef.current
      const now  = performance.now()
      const t    = now / 1000
      mat.uniforms.uTime.value = t

      const active = activeRef.current
      if (!active) {
        // Fade out if no active aurora
        mat.uniforms.uOpacity.value    = Math.max(0, mat.uniforms.uOpacity.value - 0.01)
        mat.uniforms.uIntensity.value  = Math.max(0, mat.uniforms.uIntensity.value - 0.01)
        return
      }

      const elapsed  = now - active.startMs
      const progress = Math.min(elapsed / active.durationMs, 1.0)

      // Envelope: 10% fade-in, 80% sustain, 10% fade-out
      let envelope: number
      if (progress < 0.10) {
        envelope = progress / 0.10
      } else if (progress < 0.90) {
        envelope = 1.0
      } else {
        envelope = 1.0 - (progress - 0.90) / 0.10
      }

      mat.uniforms.uOpacity.value    = active.peakOpacity * envelope
      mat.uniforms.uIntensity.value  = envelope

      if (progress >= 1.0) {
        activeRef.current = null
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  return null
}

// ── Snow particles for Level 4 (DOM overlay) ──────────────────────────────

function SnowLayer({ active }: { active: boolean }) {
  const FLAKES = 40
  const flakes = useRef(
    Array.from({ length: FLAKES }, (_, i) => ({
      id:      i,
      left:    `${Math.random() * 100}%`,
      delay:   `${Math.random() * 4}s`,
      size:    2 + Math.random() * 3,
      speed:   3 + Math.random() * 5,
      opacity: 0.4 + Math.random() * 0.5,
    }))
  ).current

  if (!active) return null

  return (
    <div style={{
      position:       'absolute',
      inset:          0,
      pointerEvents:  'none',
      overflow:       'hidden',
      zIndex:         18,
    }}>
      <style>{`
        @keyframes nw-snow-fall {
          from { transform: translateY(-10px) rotate(0deg); opacity: 1; }
          to   { transform: translateY(110vh) rotate(360deg); opacity: 0; }
        }
      `}</style>
      {flakes.map(f => (
        <div
          key={f.id}
          style={{
            position:        'absolute',
            top:             0,
            left:            f.left,
            width:           f.size,
            height:          f.size,
            borderRadius:    '50%',
            background:      'rgba(200,240,255,0.85)',
            animation:       `nw-snow-fall ${f.speed}s ${f.delay} infinite linear`,
            opacity:         f.opacity,
            boxShadow:       '0 0 4px rgba(150,220,255,0.6)',
          }}
        />
      ))}
    </div>
  )
}

// ── Celebration badge ─────────────────────────────────────────────────────

interface BadgeState {
  label: string
  level: AuroraLevel
  phase: 'in' | 'hold' | 'out' | 'hidden'
}

function CelebrationBadge({ badge }: { badge: BadgeState }) {
  const translateY = badge.phase === 'in' || badge.phase === 'hold'
    ? '0px'
    : '-90px'

  const levelColors: Record<AuroraLevel, string> = {
    1: '#22c55e',
    2: '#06b6d4',
    3: '#a855f7',
    4: '#ec4899',
  }
  const borderColor = levelColors[badge.level]

  return (
    <div
      aria-live="polite"
      style={{
        position:        'absolute',
        top:             12,
        left:            '50%',
        transform:       `translateX(-50%) translateY(${translateY})`,
        transition:      'transform 0.45s cubic-bezier(0.34,1.56,0.64,1)',
        zIndex:          55,
        background:      'rgba(5,5,18,0.92)',
        border:          `1.5px solid ${borderColor}`,
        borderRadius:    10,
        padding:         '10px 22px',
        fontFamily:      'monospace',
        whiteSpace:      'nowrap',
        backdropFilter:  'blur(12px)',
        boxShadow:       `0 0 24px ${borderColor}55, 0 4px 20px rgba(0,0,0,0.6)`,
        display:         'flex',
        alignItems:      'center',
        gap:             10,
      }}
    >
      <span style={{ fontSize: 18 }}>🌌</span>
      <span style={{ color: '#fbbf24', fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>
        MILESTONE:
      </span>
      <span style={{ color: '#fff', fontSize: 13, letterSpacing: 1.2 }}>
        {badge.label}
      </span>
    </div>
  )
}

// ── Aurora History panel (exported for use in SettingsPanel) ───────────────

interface AuroraHistoryPanelProps {
  onClose?: () => void
}

export function AuroraHistoryPanel({ onClose }: AuroraHistoryPanelProps) {
  const [history, setHistory] = useState<AuroraHistoryEntry[]>(() => loadHistory())

  useEffect(() => {
    function onTrigger() { setHistory(loadHistory()) }
    window.addEventListener(NW_AURORA_TRIGGER_EVENT, onTrigger)
    return () => window.removeEventListener(NW_AURORA_TRIGGER_EVENT, onTrigger)
  }, [])

  const levelLabel: Record<AuroraLevel, string> = {
    1: 'L1 Minor',
    2: 'L2 Medium',
    3: 'L3 Major',
    4: 'L4 EPIC',
  }
  const levelColor: Record<AuroraLevel, string> = {
    1: '#22c55e',
    2: '#06b6d4',
    3: '#a855f7',
    4: '#ec4899',
  }

  function replay(entry: AuroraHistoryEntry) {
    window.dispatchEvent(new CustomEvent(NW_AURORA_REPLAY_EVENT, {
      detail: { level: entry.level, label: `↺ ${entry.label}` },
    }))
    onClose?.()
  }

  return (
    <div style={{
      background:    'rgba(5,5,18,0.96)',
      border:        '1px solid rgba(0,229,204,0.2)',
      borderRadius:  8,
      padding:       '14px 16px',
      fontFamily:    'monospace',
      minWidth:      260,
      maxHeight:     380,
      overflowY:     'auto',
      display:       'flex',
      flexDirection: 'column',
      gap:           8,
    }}>
      <div style={{ color: '#a855f7', fontSize: 11, letterSpacing: 2, fontWeight: 700, marginBottom: 4 }}>
        ◈ AURORA HISTORY
      </div>

      {history.length === 0 && (
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: 1 }}>
          No milestones achieved yet.
        </div>
      )}

      {history.map(entry => (
        <div
          key={entry.id}
          style={{
            display:        'flex',
            alignItems:     'center',
            gap:            8,
            padding:        '6px 8px',
            borderRadius:   5,
            background:     'rgba(255,255,255,0.04)',
            border:         `1px solid ${levelColor[entry.level]}33`,
          }}
        >
          <span style={{
            fontSize:   9,
            color:      levelColor[entry.level],
            fontWeight: 700,
            minWidth:   52,
            letterSpacing: 0.5,
          }}>
            {levelLabel[entry.level]}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#fff', fontSize: 10, letterSpacing: 0.5, marginBottom: 2 }}>
              {entry.label}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 8, letterSpacing: 0.5 }}>
              {new Date(entry.triggeredAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour:  '2-digit', minute: '2-digit',
              })}
            </div>
          </div>
          <button
            onClick={() => replay(entry)}
            title="Replay aurora effect"
            style={{
              fontSize:   10,
              color:      levelColor[entry.level],
              border:     `1px solid ${levelColor[entry.level]}55`,
              background: 'transparent',
              borderRadius: 4,
              padding:    '3px 7px',
              cursor:     'pointer',
              fontFamily: 'monospace',
              letterSpacing: 0.5,
              transition: 'all 0.12s',
            }}
          >
            ↺
          </button>
        </div>
      ))}

      {history.length > 0 && (
        <button
          onClick={() => { saveHistory([]); setHistory([]) }}
          style={{
            marginTop:  4,
            padding:    '5px 10px',
            fontSize:   9,
            color:      'rgba(255,100,100,0.7)',
            border:     '1px solid rgba(255,100,100,0.2)',
            background: 'transparent',
            borderRadius: 4,
            cursor:     'pointer',
            fontFamily: 'monospace',
            letterSpacing: 1,
            alignSelf:  'flex-end',
          }}
        >
          CLEAR HISTORY
        </button>
      )}
    </div>
  )
}

// ── Main AuroraEventsLayer component ─────────────────────────────────────────

interface AuroraEventsLayerProps {
  /** Whether the 'aurora' layer toggle is ON */
  visible: boolean
  /** Whether global sound is enabled */
  soundEnabled?: boolean
}

export function AuroraEventsLayer({ visible, soundEnabled = false }: AuroraEventsLayerProps) {
  // Badge state
  const [badge, setBadge] = useState<BadgeState>({ label: '', level: 1, phase: 'hidden' })
  const badgeTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Level 4 snow
  const [snowActive, setSnowActive] = useState(false)

  // ── Play aurora harmonic chord (major key, ascending) ──────────────────
  const playAuroraChord = useCallback((level: AuroraLevel) => {
    if (!soundEnabled) return
    try {
      const engine = getAudioEngine()
      if (!(engine as unknown as { ctx: AudioContext | null }).ctx) return

      const ctx    = (engine as unknown as { ctx: AudioContext }).ctx
      const master = (engine as unknown as { masterGain: GainNode | null }).masterGain
      if (!master) return

      // Major chord freqs based on level: C major, ascending
      const baseFreqs: Record<AuroraLevel, number[]> = {
        1: [261.6, 329.6, 392.0],                  // C4-E4-G4
        2: [261.6, 329.6, 392.0, 523.2],            // add octave
        3: [261.6, 329.6, 392.0, 523.2, 659.3],     // add E5
        4: [261.6, 329.6, 392.0, 523.2, 659.3, 783.9], // full spread
      }
      const freqs    = baseFreqs[level]
      const t        = ctx.currentTime
      const duration = LEVEL_DURATION[level] / 1000

      freqs.forEach((freq, i) => {
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type            = 'sine'
        osc.frequency.value = freq
        osc.connect(gain)
        gain.connect(master)
        const delay = i * 0.12  // ascending stagger
        gain.gain.setValueAtTime(0, t + delay)
        gain.gain.linearRampToValueAtTime(0.06, t + delay + 0.4)
        gain.gain.linearRampToValueAtTime(0.04, t + duration - 0.5)
        gain.gain.linearRampToValueAtTime(0, t + duration)
        osc.start(t + delay)
        osc.stop(t + duration + 0.1)
      })
    } catch {
      // Audio not ready or permission denied — silent fallback
    }
  }, [soundEnabled])

  // ── Show badge with slide-in → hold → slide-out ──────────────────────
  const showBadge = useCallback((label: string, level: AuroraLevel) => {
    if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current)

    setBadge({ label, level, phase: 'in' })

    // Hold for 5 seconds then slide out
    badgeTimerRef.current = setTimeout(() => {
      setBadge(prev => ({ ...prev, phase: 'out' }))
      badgeTimerRef.current = setTimeout(() => {
        setBadge(prev => ({ ...prev, phase: 'hidden' }))
      }, 500)
    }, 5_000)
  }, [])

  // ── Handle aurora trigger ─────────────────────────────────────────────
  const handleTrigger = useCallback((level: AuroraLevel, label: string, isReplay = false) => {
    if (!visible) return

    // Fire Three.js aurora
    window.dispatchEvent(new CustomEvent(NW_AURORA_TRIGGER_EVENT, {
      detail: { level, label },
    }))

    // Badge
    showBadge(label, level)

    // Level 4: snow
    if (level === 4) {
      setSnowActive(true)
      setTimeout(() => setSnowActive(false), LEVEL_DURATION[4])
    }

    // Sound
    playAuroraChord(level)

    // History (skip replays)
    if (!isReplay) {
      const entry: AuroraHistoryEntry = {
        id:           `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        level,
        label,
        triggeredAt:  new Date().toISOString(),
      }
      addHistoryEntry(entry)
    }
  }, [visible, showBadge, playAuroraChord])

  // ── Listen for external replay events ────────────────────────────────
  useEffect(() => {
    function onReplay(e: Event) {
      const ev = e as CustomEvent<{ level: AuroraLevel; label: string }>
      handleTrigger(ev.detail.level, ev.detail.label, true)
    }
    window.addEventListener(NW_AURORA_REPLAY_EVENT, onReplay)
    return () => window.removeEventListener(NW_AURORA_REPLAY_EVENT, onReplay)
  }, [handleTrigger])

  // ── Listen for business milestone events ─────────────────────────────
  useEffect(() => {
    // ── Revenue milestones ──────────────────────────────────────────────
    function onRevenueMilestone(e: Event) {
      const ev = e as CustomEvent<{ amount: number }>
      const amt = ev.detail?.amount ?? 0
      if      (amt >= 100_000) handleTrigger(4, `First $100K Month 🎉`)
      else if (amt >=  50_000) handleTrigger(3, `First $50K Month 🎉`)
      else if (amt >=  25_000) handleTrigger(2, `First $25K Month 🎉`)
      else if (amt >=  10_000) handleTrigger(1, `First $10K Month 🎉`)
    }

    // ── Project final phase completion ──────────────────────────────────
    function onProjectComplete(e: Event) {
      const ev = e as CustomEvent<{ projectName?: string }>
      const name = ev.detail?.projectName ?? 'Project'
      handleTrigger(2, `${name} — Final Phase Complete ✅`)
    }

    // ── Large invoice paid ──────────────────────────────────────────────
    function onInvoicePaid(e: Event) {
      const ev = e as CustomEvent<{ amount: number; invoiceId?: string }>
      const amt = ev.detail?.amount ?? 0
      if (amt >= 5_000) {
        handleTrigger(1, `$${amt.toLocaleString()} Invoice Paid 💰`)
      }
    }

    // ── New subscription ────────────────────────────────────────────────
    function onNewSubscriber(e: Event) {
      const ev = e as CustomEvent<{ planName?: string }>
      const plan = ev.detail?.planName ?? 'Subscription'
      handleTrigger(1, `New Subscriber: ${plan} 🚀`)
    }

    // ── Perfect week ────────────────────────────────────────────────────
    function onPerfectWeek() {
      handleTrigger(4, 'Perfect Week — All Green 🌟')
    }

    window.addEventListener('nw:milestone-revenue',    onRevenueMilestone)
    window.addEventListener('nw:milestone-project',    onProjectComplete)
    window.addEventListener('nw:milestone-invoice',    onInvoicePaid)
    window.addEventListener('nw:milestone-subscriber', onNewSubscriber)
    window.addEventListener('nw:milestone-perfect-week', onPerfectWeek)

    return () => {
      window.removeEventListener('nw:milestone-revenue',      onRevenueMilestone)
      window.removeEventListener('nw:milestone-project',      onProjectComplete)
      window.removeEventListener('nw:milestone-invoice',      onInvoicePaid)
      window.removeEventListener('nw:milestone-subscriber',   onNewSubscriber)
      window.removeEventListener('nw:milestone-perfect-week', onPerfectWeek)
    }
  }, [handleTrigger])

  // Cleanup badge timer on unmount
  useEffect(() => {
    return () => {
      if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current)
    }
  }, [])

  return (
    <>
      {/* Three.js aurora plane (rendered inside WorldEngine via useWorldContext) */}
      <AuroraThreeLayer visible={visible} />

      {/* Snow particles for level 4 */}
      <SnowLayer active={snowActive && visible} />

      {/* Celebration badge */}
      {badge.phase !== 'hidden' && (
        <CelebrationBadge badge={badge} />
      )}
    </>
  )
}

// ── Convenience trigger function (call from anywhere) ───────────────────────

/**
 * Trigger an aurora milestone from outside the component.
 * @param level   1 (minor) – 4 (epic)
 * @param label   Display label shown in the badge and history
 */
export function triggerAurora(level: AuroraLevel, label: string): void {
  window.dispatchEvent(new CustomEvent(NW_AURORA_TRIGGER_EVENT, {
    detail: { level, label },
  }))
}
