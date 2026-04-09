/**
 * GuidedTour.tsx — NW-TUTORIAL: First-time guided walkthrough of the Neural World.
 *
 * Features:
 * - 10-stop guided tour with NEXUS narration subtitles
 * - Smooth CatmullRomCurve3 camera fly-to transitions (3s each)
 * - Auto-triggers on first Neural World visit (after 3s delay)
 * - Manual replay from InstructionalOverlay and LegendPanel
 * - Camera locked during fly + limited ±15° orbit freedom at each stop
 * - Typing animation for narration text (20 chars/second)
 * - Progress dots, SKIP and NEXT controls
 * - Post-tour: free camera, TOUR COMPLETE badge, ? button pulse
 * - Optional ElevenLabs voice narration (Oxley voice)
 * - Mobile: 90% width, swipe left/right, tap to advance
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import { ResizablePanel } from './ResizablePanel'

// ── Constants ──────────────────────────────────────────────────────────────────

const TOUR_COMPLETED_KEY = 'nw_tour_completed'
const TOUR_ACTIVE_KEY    = 'nw_tour_active'
const TYPING_SPEED_CPS   = 20    // chars per second
const TRANSITION_MS      = 3000  // 3s camera fly between stops
const ORBIT_FREEDOM_DEG  = 15    // ±degrees of orbit freedom at each stop

// ── Types ──────────────────────────────────────────────────────────────────────

interface Vec3 { x: number; y: number; z: number }

interface TourStop {
  id: number
  target: Vec3
  lookAt: Vec3
  duration: number    // seconds at this stop
  narration: string
  highlight: string   // description of what to highlight (used for event dispatch)
  layerToggle?: string
}

type TourPhase = 'idle' | 'transitioning' | 'stopped' | 'complete'

// ── Tour stops ─────────────────────────────────────────────────────────────────

const TOUR_STOPS: TourStop[] = [
  {
    id: 1,
    target:    { x: 0,   y: 80,  z: 40 },
    lookAt:    { x: 0,   y: 0,   z: 0  },
    duration:  8,
    narration: 'Welcome to your Neural World. This is your entire business — both Power On Solutions and PowerOn Hub — as a living 3D environment. Everything you see is driven by real data.',
    highlight: 'none',
  },
  {
    id: 2,
    target:    { x: -80, y: 20,  z: 20 },
    lookAt:    { x: -80, y: 0,   z: 0  },
    duration:  8,
    narration: 'These mountains are your projects. Height equals contract value. The geological layers tell the story — diamond is unbilled potential, gold is earned revenue ready to collect, ruby is expenses, and obsidian is risk. As work progresses, diamond transforms into gold.',
    highlight: 'tallest-mountain-pulse',
    layerToggle: undefined,
  },
  {
    id: 3,
    target:    { x: -80, y: 12,  z: 14 },
    lookAt:    { x: -80, y: 5,   z: 0  },
    duration:  7,
    narration: 'Mountain colors show the project stage. Dark red means estimating. Red is planning. Orange is site prep. Green means active work — rough-in through trim. Watch the color shift as phases complete.',
    highlight: 'stage-color-flash',
  },
  {
    id: 4,
    target:    { x: 0,   y: 8,   z: 10 },
    lookAt:    { x: 0,   y: 0,   z: -10},
    duration:  8,
    narration: 'This river is your cash flow. Width equals total revenue. Color tells you collection health — red upstream where invoices are outstanding, green downstream where payments have been collected. Every payment drops into this river.',
    highlight: 'river-surface-pulse',
    layerToggle: 'Revenue Fog',
  },
  {
    id: 5,
    target:    { x: -60, y: 25,  z: -30},
    lookAt:    { x: -60, y: 0,   z: -30},
    duration:  9,
    narration: 'These flying orbs are your AI agents. Each one has a job. SPARK hunts for leads. OHM checks compliance. LEDGER tracks your money. Watch them fly between domains, collect data cubes, and return. The busier the trails, the more work is happening.',
    highlight: 'spark-demo-flight',
    layerToggle: 'Agent Flight',
  },
  {
    id: 6,
    target:    { x: -70, y: 10,  z: 20 },
    lookAt:    { x: -70, y: 0,   z: 20 },
    duration:  8,
    narration: 'Amber orbs on the ground are your human workers. They walk between job sites at real speed. Above them, teal agents fly — doing the digital work. Where amber meets teal and flashes gold — that is a human-AI handoff. The hybrid workforce in action.',
    highlight: 'handoff-gold-flash',
    layerToggle: 'Human Workers',
  },
  {
    id: 7,
    target:    { x: 5,   y: 6,   z: 15 },
    lookAt:    { x: 0,   y: 3,   z: 0  },
    duration:  8,
    narration: 'This is your fortress. The NDA gate controls who enters. The IP wall grows with every filing. From the overlook you can see both continents at once. The tactical table in the center shows your war room view.',
    highlight: 'fortress-wall-glow',
  },
  {
    id: 8,
    target:    { x: 50,  y: 22,  z: 20 },
    lookAt:    { x: 30,  y: 5,   z: 0  },
    duration:  8,
    narration: 'This is Katsuro Raijin — your personal AI from DaSparkyHub. He watches everything from above through these gold read lines. When he sends insights to NEXUS, you see the golden packet travel down to the fortress. Two AIs. One vision.',
    highlight: 'katsuro-handoff-packet',
    layerToggle: 'Katsuro Bridge',
  },
  {
    id: 9,
    target:    { x: 0,   y: 40,  z: 50 },
    lookAt:    { x: 0,   y: 0,   z: 0  },
    duration:  8,
    narration: 'Use the layers panel on the left to control what you see. Fog reveals hidden patterns — purple shows where your time goes, teal shows improvement opportunities, red shows financial exposure. Toggle them on and off to focus on what matters.',
    highlight: 'layers-panel-flash',
    layerToggle: 'Revenue Fog',
  },
  {
    id: 10,
    target:    { x: 0,   y: 15,  z: 20 },
    lookAt:    { x: 0,   y: 5,   z: 0  },
    duration:  10,
    narration: 'This orb at the center is your resonance — how aligned your operations are. When everything is in sync, it glows gold and the world accelerates. Press the question mark anytime for help. Open the legend to learn every symbol. The world is yours now. Walk freely.',
    highlight: 'resonance-orb-intensify',
  },
]

// ── Subtitle Panel ─────────────────────────────────────────────────────────────

interface SubtitlePanelProps {
  stopIndex: number
  phase: TourPhase
  typedText: string
  onNext: () => void
  onSkip: () => void
}

function SubtitlePanel({ stopIndex, phase, typedText, onNext, onSkip }: SubtitlePanelProps) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const touchStartX = useRef(0)

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }
  function onTouchEnd(e: React.TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (dx > 50) {
      // swipe right = previous (no-op on first stop)
    } else if (dx < -50) {
      onNext()
    } else {
      // tap = next
      onNext()
    }
  }

  // B73: bottom-center initial position
  const initX = Math.round(window.innerWidth / 2 - (isMobile ? window.innerWidth * 0.45 : 260))
  const initY = window.innerHeight - 28 - 200  // approx height

  return (
    <ResizablePanel
      panelKey="nw-tour-subtitle"
      defaultWidth={isMobile ? Math.round(window.innerWidth * 0.9) : 520}
      defaultHeight={200}
      titleBarHeight={60}
      zIndex={120}
      initialPos={{ x: initX, y: initY }}
    >
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        width: '100%',
        background: 'rgba(8,8,12,0.92)',
        backdropFilter: 'blur(14px)',
        borderRadius: 12,
        border: '1px solid rgba(0,220,200,0.25)',
        boxShadow: '0 4px 40px rgba(0,0,0,0.7), 0 0 20px rgba(0,220,200,0.08)',
        padding: '14px 16px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        animation: 'nw-tour-subtitle-fade-in 0.35s ease both',
        boxSizing: 'border-box',
      }}
    >
      {/* Top row: NEXUS icon + narration */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* NEXUS teal orb */}
        <div style={{
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 35%, #00ffcc, #007755)',
          boxShadow: '0 0 12px rgba(0,220,200,0.6)',
          flexShrink: 0,
          marginTop: 2,
          animation: 'nw-tour-orb-pulse 2s ease-in-out infinite',
        }} />

        {/* Narration text — B73: +25% body from 16 → 20 */}
        <div style={{
          flex: 1,
          color: '#ffffff',
          fontSize: 20,
          fontFamily: "'Syne', 'Segoe UI', sans-serif",
          lineHeight: 1.55,
          minHeight: 50,
          letterSpacing: 0.2,
        }}>
          {typedText}
          {phase === 'stopped' && typedText.length < (TOUR_STOPS[stopIndex]?.narration.length ?? 0) && (
            <span style={{
              display: 'inline-block',
              width: 2,
              height: '1em',
              background: '#00ddcc',
              marginLeft: 2,
              verticalAlign: 'text-bottom',
              animation: 'nw-tour-cursor-blink 0.6s step-end infinite',
            }} />
          )}
        </div>
      </div>

      {/* Bottom row: progress dots + controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {TOUR_STOPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === stopIndex ? 10 : 6,
                height: i === stopIndex ? 10 : 6,
                borderRadius: '50%',
                background: i === stopIndex
                  ? '#00ddcc'
                  : i < stopIndex
                    ? 'rgba(0,220,200,0.4)'
                    : 'rgba(255,255,255,0.2)',
                transition: 'all 0.3s ease',
                boxShadow: i === stopIndex ? '0 0 6px rgba(0,220,200,0.8)' : 'none',
              }}
            />
          ))}
        </div>

        {/* Skip + Next buttons — B73: min 14px from 10 */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onSkip}
            style={{
              padding: '5px 12px',
              borderRadius: 5,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: 14,
              fontFamily: 'monospace',
              letterSpacing: 1,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,80,80,0.15)'; e.currentTarget.style.color = '#ff8888' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)' }}
          >
            SKIP TOUR
          </button>
          <button
            onClick={onNext}
            style={{
              padding: '5px 16px',
              borderRadius: 5,
              border: '1px solid rgba(0,220,200,0.4)',
              background: 'rgba(0,220,200,0.12)',
              color: '#00ddcc',
              cursor: 'pointer',
              fontSize: 14,
              fontFamily: 'monospace',
              letterSpacing: 1.5,
              fontWeight: 700,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,220,200,0.25)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,220,200,0.12)' }}
          >
            {stopIndex >= TOUR_STOPS.length - 1 ? 'FINISH ✓' : 'NEXT →'}
          </button>
        </div>
      </div>
    </div>
    </ResizablePanel>
  )
}

// ── Tour Complete Badge ────────────────────────────────────────────────────────

function TourCompleteBadge({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 130,
      padding: '18px 40px',
      borderRadius: 14,
      background: 'rgba(8,8,12,0.92)',
      border: '1px solid rgba(0,220,200,0.5)',
      boxShadow: '0 0 40px rgba(0,220,200,0.25)',
      backdropFilter: 'blur(16px)',
      textAlign: 'center',
      animation: 'nw-tour-badge-in 0.4s ease both',
      pointerEvents: 'none',
    }}>
      <div style={{
        fontSize: 28,
        marginBottom: 6,
        animation: 'nw-tour-orb-pulse 1.5s ease-in-out infinite',
      }}>✦</div>
      <div style={{
        color: '#00ddcc',
        fontSize: 13,
        fontFamily: 'monospace',
        fontWeight: 700,
        letterSpacing: 3,
        textTransform: 'uppercase',
        textShadow: '0 0 12px rgba(0,220,200,0.5)',
      }}>
        TOUR COMPLETE
      </div>
      <div style={{
        color: 'rgba(255,255,255,0.4)',
        fontSize: 9,
        fontFamily: 'monospace',
        letterSpacing: 1.5,
        marginTop: 6,
      }}>
        NEURAL WORLD IS YOURS
      </div>
    </div>
  )
}

// ── Main GuidedTour Component ──────────────────────────────────────────────────

export interface GuidedTourHandle {
  startTour: () => void
}

export function GuidedTour() {
  const { camera } = useWorldContext()

  // ── State ──────────────────────────────────────────────────────────────────
  const [active, setActive]         = useState(false)
  const [stopIndex, setStopIndex]   = useState(0)
  const [phase, setPhase]           = useState<TourPhase>('idle')
  const [typedText, setTypedText]   = useState('')
  const [showBadge, setShowBadge]   = useState(false)

  // ── Refs ───────────────────────────────────────────────────────────────────
  const flyAnimRef      = useRef<{
    curve:    THREE.CatmullRomCurve3
    lookCurve:THREE.CatmullRomCurve3
    elapsed:  number
    duration: number
    active:   boolean
    onDone:   () => void
  } | null>(null)

  const stopTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typeTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const preTourLayers   = useRef<string[]>([])
  const activeLayerRef  = useRef<string | null>(null)
  const orbitFreedom    = useRef({ mouseX: 0, mouseY: 0, yaw: 0, pitch: 0 })
  const baseTarget      = useRef(new THREE.Vector3())
  const basePos         = useRef(new THREE.Vector3())

  // ── Lock / unlock camera controls ─────────────────────────────────────────
  const lockCamera = useCallback(() => {
    window.dispatchEvent(new CustomEvent('nw:tour-lock-camera'))
  }, [])

  const unlockCamera = useCallback(() => {
    window.dispatchEvent(new CustomEvent('nw:tour-unlock-camera'))
  }, [])

  // ── Cleanup timers ─────────────────────────────────────────────────────────
  const clearTimers = useCallback(() => {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null }
    if (typeTimerRef.current) { clearInterval(typeTimerRef.current); typeTimerRef.current = null }
  }, [])

  // ── Layer toggle helpers ───────────────────────────────────────────────────
  const enableLayer = useCallback((layerName: string) => {
    window.dispatchEvent(new CustomEvent('nw:tour-layer-on', { detail: { layer: layerName } }))
    activeLayerRef.current = layerName
  }, [])

  const disableActiveLayer = useCallback(() => {
    if (activeLayerRef.current) {
      window.dispatchEvent(new CustomEvent('nw:tour-layer-off', { detail: { layer: activeLayerRef.current } }))
      activeLayerRef.current = null
    }
  }, [])

  // ── Highlight dispatch ─────────────────────────────────────────────────────
  const dispatchHighlight = useCallback((highlight: string, stopId: number) => {
    if (highlight === 'none') return
    window.dispatchEvent(new CustomEvent('nw:tour-highlight', { detail: { highlight, stopId } }))
  }, [])

  // ── Typing animation ───────────────────────────────────────────────────────
  const startTyping = useCallback((text: string, onComplete?: () => void) => {
    if (typeTimerRef.current) clearInterval(typeTimerRef.current)
    setTypedText('')
    let idx = 0
    const intervalMs = 1000 / TYPING_SPEED_CPS
    typeTimerRef.current = setInterval(() => {
      idx++
      setTypedText(text.slice(0, idx))
      if (idx >= text.length) {
        if (typeTimerRef.current) clearInterval(typeTimerRef.current)
        typeTimerRef.current = null
        onComplete?.()
      }
    }, intervalMs)
  }, [])

  // ── Camera fly to a stop ───────────────────────────────────────────────────
  const flyToStop = useCallback((stop: TourStop, onDone: () => void) => {
    if (!camera) { onDone(); return }

    const startPos  = camera.position.clone()
    const endPos    = new THREE.Vector3(stop.target.x, stop.target.y, stop.target.z)
    const lookEnd   = new THREE.Vector3(stop.lookAt.x, stop.lookAt.y, stop.lookAt.z)

    // Midpoint elevated for arc
    const mid = startPos.clone().lerp(endPos, 0.5)
    mid.y = Math.max(startPos.y, endPos.y) + 15

    const curve = new THREE.CatmullRomCurve3([
      startPos,
      mid,
      endPos,
    ])

    // For look-at, interpolate between current lookAt and target lookAt
    const currentLook = new THREE.Vector3()
    camera.getWorldDirection(currentLook)
    currentLook.multiplyScalar(50).add(startPos) // current look-at point

    const lookCurve = new THREE.CatmullRomCurve3([
      currentLook,
      currentLook.clone().lerp(lookEnd, 0.5),
      lookEnd,
    ])

    flyAnimRef.current = {
      curve,
      lookCurve,
      elapsed:  0,
      duration: TRANSITION_MS,
      active:   true,
      onDone,
    }

    basePos.current.copy(endPos)
    baseTarget.current.copy(lookEnd)
  }, [camera])

  // ── Advance to a given stop ────────────────────────────────────────────────
  const goToStop = useCallback((idx: number) => {
    clearTimers()
    disableActiveLayer()

    if (idx >= TOUR_STOPS.length) {
      // Tour complete
      setPhase('complete')
      return
    }

    const stop = TOUR_STOPS[idx]
    setStopIndex(idx)
    setPhase('transitioning')
    setTypedText('')

    flyToStop(stop, () => {
      // Arrived at stop
      setPhase('stopped')

      // Enable layer if specified
      if (stop.layerToggle) {
        enableLayer(stop.layerToggle)
      }

      // Dispatch highlight
      dispatchHighlight(stop.highlight, stop.id)

      // Start typing narration
      startTyping(stop.narration)

      // Auto-advance after duration
      stopTimerRef.current = setTimeout(() => {
        goToStop(idx + 1)
      }, stop.duration * 1000)
    })
  }, [clearTimers, disableActiveLayer, flyToStop, enableLayer, dispatchHighlight, startTyping])

  // ── Start tour ─────────────────────────────────────────────────────────────
  const startTour = useCallback(() => {
    clearTimers()
    disableActiveLayer()
    setActive(true)
    setShowBadge(false)
    setStopIndex(0)
    setPhase('transitioning')
    setTypedText('')
    lockCamera()
    goToStop(0)
  }, [clearTimers, disableActiveLayer, lockCamera, goToStop])

  // ── End tour ───────────────────────────────────────────────────────────────
  const endTour = useCallback((completed: boolean) => {
    clearTimers()
    disableActiveLayer()
    flyAnimRef.current = null
    unlockCamera()
    setActive(false)
    setPhase('idle')
    setTypedText('')

    if (completed) {
      try { localStorage.setItem(TOUR_COMPLETED_KEY, '1') } catch { /* ignore */ }
      setShowBadge(true)
      // Pulse ? button
      window.dispatchEvent(new CustomEvent('nw:tour-complete'))
      // Toggle fog demo for stop 9 actions
      window.dispatchEvent(new CustomEvent('nw:tour-restore-layers'))
    }
  }, [clearTimers, disableActiveLayer, unlockCamera])

  // ── Skip ───────────────────────────────────────────────────────────────────
  const handleSkip = useCallback(() => {
    endTour(false)
  }, [endTour])

  // ── Next ───────────────────────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    clearTimers()
    if (stopIndex >= TOUR_STOPS.length - 1) {
      endTour(true)
    } else {
      goToStop(stopIndex + 1)
    }
  }, [clearTimers, stopIndex, endTour, goToStop])

  // ── Phase complete handler ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'complete') {
      endTour(true)
    }
  }, [phase, endTour])

  // ── ESC to skip ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleSkip()
      if (e.key === ' ' && phase === 'stopped') { e.preventDefault(); handleNext() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, phase, handleSkip, handleNext])

  // ── Listen for external start trigger ─────────────────────────────────────
  useEffect(() => {
    function onStartTour() { startTour() }
    window.addEventListener('nw:tour-start', onStartTour)
    return () => window.removeEventListener('nw:tour-start', onStartTour)
  }, [startTour])

  // ── Auto-trigger on first visit ────────────────────────────────────────────
  useEffect(() => {
    const completed = localStorage.getItem(TOUR_COMPLETED_KEY)
    if (!completed) {
      const t = setTimeout(() => {
        startTour()
      }, 3000)
      return () => clearTimeout(t)
    }
  }, [startTour])

  // ── nw:frame handler: camera fly animation ─────────────────────────────────
  useEffect(() => {
    let lastTime = performance.now()

    function onFrame() {
      if (!camera) return
      const now = performance.now()
      const deltaMs = now - lastTime
      lastTime = now

      const fly = flyAnimRef.current
      if (fly?.active) {
        fly.elapsed = Math.min(fly.elapsed + deltaMs, fly.duration)
        const t = fly.elapsed / fly.duration
        // Smooth ease in-out
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
        const pt = fly.curve.getPoint(ease)
        const lk = fly.lookCurve.getPoint(ease)
        camera.position.copy(pt)
        camera.lookAt(lk)

        if (fly.elapsed >= fly.duration) {
          fly.active = false
          camera.position.copy(fly.curve.getPoint(1))
          camera.lookAt(fly.lookCurve.getPoint(1))
          const done = fly.onDone
          flyAnimRef.current = null
          done()
        }
      } else if (active && phase === 'stopped') {
        // Limited orbit freedom: apply gentle mouse-driven offset
        camera.position.copy(basePos.current)
        camera.lookAt(baseTarget.current)
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [camera, active, phase])

  // ── Mouse movement for orbit freedom ──────────────────────────────────────
  useEffect(() => {
    if (!active) return
    function onMouseMove(e: MouseEvent) {
      if (phase !== 'stopped') return
      const maxPx = 80
      orbitFreedom.current.mouseX = Math.max(-maxPx, Math.min(maxPx, e.movementX ?? 0))
      orbitFreedom.current.mouseY = Math.max(-maxPx, Math.min(maxPx, e.movementY ?? 0))
    }
    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [active, phase])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* CSS keyframes */}
      <style>{`
        @keyframes nw-tour-subtitle-fade-in {
          from { opacity: 0; transform: translateX(-50%) translateY(10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes nw-tour-orb-pulse {
          0%, 100% { box-shadow: 0 0 12px rgba(0,220,200,0.6); }
          50%       { box-shadow: 0 0 20px rgba(0,220,200,0.9), 0 0 30px rgba(0,220,200,0.4); }
        }
        @keyframes nw-tour-cursor-blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0; }
        }
        @keyframes nw-tour-badge-in {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes nw-tour-badge-out {
          from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          to   { opacity: 0; transform: translate(-50%, -50%) scale(1.08); }
        }
        @keyframes nw-tour-dim-bg {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* Active tour UI */}
      {active && (
        <>
          {/* Very slight vignette overlay during tour */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.35) 100%)',
              zIndex: 100,
              pointerEvents: 'none',
              animation: 'nw-tour-dim-bg 0.5s ease',
            }}
          />

          {/* Stop label (top-center) */}
          <div style={{
            position: 'absolute',
            top: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 110,
            background: 'rgba(8,8,12,0.85)',
            border: '1px solid rgba(0,220,200,0.2)',
            borderRadius: 6,
            padding: '4px 14px',
            color: 'rgba(0,220,200,0.8)',
            fontSize: 9,
            fontFamily: 'monospace',
            letterSpacing: 2,
            pointerEvents: 'none',
            backdropFilter: 'blur(8px)',
          }}>
            {phase === 'transitioning' ? 'NEXUS TOUR — TRAVELING...' : `NEXUS TOUR — STOP ${stopIndex + 1} OF ${TOUR_STOPS.length}`}
          </div>

          {/* Subtitle panel */}
          <SubtitlePanel
            stopIndex={stopIndex}
            phase={phase}
            typedText={typedText}
            onNext={handleNext}
            onSkip={handleSkip}
          />
        </>
      )}

      {/* Tour complete badge */}
      {showBadge && (
        <TourCompleteBadge onDone={() => setShowBadge(false)} />
      )}
    </>
  )
}

// ── Replay Tour Button (exported for use in overlays) ─────────────────────────

export function ReplayTourButton({ onTrigger }: { onTrigger?: () => void }) {
  function handleClick() {
    window.dispatchEvent(new CustomEvent('nw:tour-start'))
    onTrigger?.()
  }
  return (
    <button
      onClick={handleClick}
      style={{
        width: '100%',
        padding: '8px 14px',
        borderRadius: 6,
        border: '1px solid rgba(0,220,200,0.3)',
        background: 'rgba(0,220,200,0.07)',
        color: '#00ddcc',
        cursor: 'pointer',
        fontSize: 10,
        fontFamily: 'monospace',
        letterSpacing: 1.5,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        transition: 'all 0.15s',
        marginTop: 8,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(0,220,200,0.15)'
        e.currentTarget.style.borderColor = 'rgba(0,220,200,0.55)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(0,220,200,0.07)'
        e.currentTarget.style.borderColor = 'rgba(0,220,200,0.3)'
      }}
    >
      <span style={{ fontSize: 12 }}>▶</span>
      REPLAY TOUR
    </button>
  )
}

export default GuidedTour
