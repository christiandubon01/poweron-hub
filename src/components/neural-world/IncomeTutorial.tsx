/**
 * IncomeTutorial.tsx — NW44: 8-step repeatable income target walkthrough.
 *
 * DIFFERENT from GuidedTour (NW-TUTORIAL):
 *   GuidedTour teaches what each element IS.
 *   IncomeTutorial teaches what to CHECK and in what ORDER to evaluate income progress.
 *
 * Features:
 * - 8-step walkthrough with camera fly-to at each stop
 * - NEXUS voice narration via ElevenLabs TTS (Oxley voice)
 * - HUD overlay: step number, amber title, 1-2 sentence instruction
 * - Typing animation (20 cps), auto-advance (8-12s per step)
 * - Activation: Settings "Income Tutorial" button, NEXUS Briefing quick action,
 *   or first-launch auto-prompt (dismissable, remembers choice)
 * - Repeatable anytime. Saves completion to localStorage.
 * - Settings icon badge after first completion.
 * - Color scheme: amber/gold (#f59e0b) to differentiate from GuidedTour (teal).
 * - Layer toggles: Revenue Fog (step 5), Forecast (step 7), Briefing trigger (step 8)
 * - VIDEO GAME UX: HUD-style, animated transitions, min 14px text, zero overlapping UI.
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
import { synthesizeWithElevenLabs, DEFAULT_VOICE_ID } from '@/api/voice/elevenLabs'

// ── Constants ──────────────────────────────────────────────────────────────────

export const INCOME_TUTORIAL_COMPLETED_KEY = 'nw_income_tutorial_completed'
export const INCOME_TUTORIAL_PROMPTED_KEY  = 'nw_income_tutorial_prompted'
const TYPING_SPEED_CPS = 20    // chars per second
const TRANSITION_MS    = 2800  // camera fly duration ms
const ACCENT           = '#f59e0b'   // amber
const ACCENT_GLOW      = 'rgba(245,158,11,0.6)'
const ACCENT_DIM       = 'rgba(245,158,11,0.12)'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Vec3 { x: number; y: number; z: number }

interface IncomeStep {
  id:           number
  title:        string
  target:       Vec3
  lookAt:       Vec3
  duration:     number   // seconds at stop before auto-advance
  narration:    string
  layerToggle?: string   // layer to enable on arrive
  triggerEvent?: string  // custom event to fire on arrive
}

type TutPhase = 'idle' | 'transitioning' | 'stopped' | 'complete'

// ── Tutorial steps ─────────────────────────────────────────────────────────────

const INCOME_STEPS: IncomeStep[] = [
  {
    id:        1,
    title:     'REVENUE RIVER',
    target:    { x: 0,   y: 10,  z: 30  },
    lookAt:    { x: 0,   y: 0,   z: 0   },
    duration:  10,
    narration: 'The river width shows total collected revenue. Wider means more money in. Green is healthy, amber is slowing. Narrow river means you need more invoices paid.',
  },
  {
    id:        2,
    title:     'PROJECT MOUNTAINS',
    target:    { x: -90, y: 28,  z: 30  },
    lookAt:    { x: -90, y: 0,   z: 10  },
    duration:  10,
    narration: 'Mountains are projects. Taller equals higher contract value. More gold at the top means mostly billed. Diamond and obsidian are early stage. You need mountains converting diamond to gold.',
  },
  {
    id:        3,
    title:     'AR STALACTITES',
    target:    { x: -50, y: 14,  z: 20  },
    lookAt:    { x: -50, y: 5,   z: 0   },
    duration:  10,
    narration: 'Hanging formations are unpaid invoices. Longer means more urgent. Many stalactites means cash is trapped. Collect these to widen the river.',
  },
  {
    id:        4,
    title:     'RESONANCE ORB',
    target:    { x: 0,   y: 16,  z: 0   },
    lookAt:    { x: 0,   y: 8,   z: -20 },
    duration:  10,
    narration: 'This orb reflects your operational rhythm. COHERENT or GROWTH means timing is aligned. DISSONANT means you are out of sync. Click the orb for specific factors to fix.',
  },
  {
    id:        5,
    title:     'FOG LAYERS — INCOME CONCENTRATION',
    target:    { x: -60, y: 35,  z: 40  },
    lookAt:    { x: -60, y: 0,   z: 0   },
    duration:  11,
    narration: 'Revenue fog shows income concentration. Thick fog means most revenue comes from here. Concentrated on one mountain means client dependency. Spread the fog by diversifying.',
    layerToggle: 'Revenue Fog',
  },
  {
    id:        6,
    title:     'SUBSCRIPTION TOWERS',
    target:    { x: 60,  y: 22,  z: -30 },
    lookAt:    { x: 60,  y: 0,   z: -30 },
    duration:  10,
    narration: 'Towers are recurring revenue. These are the most valuable structures — income every month without new sales. More towers means more predictable income.',
  },
  {
    id:        7,
    title:     'FORECAST LAYER',
    target:    { x: -20, y: 50,  z: 60  },
    lookAt:    { x: -60, y: 0,   z: 0   },
    duration:  10,
    narration: 'The forecast layer projects where you are heading. Growing projected mountains mean you are on track. Shrinking means act now — more leads, faster billing, new services.',
    layerToggle: 'Forecast',
  },
  {
    id:        8,
    title:     'NEXUS BRIEFING',
    target:    { x: -10, y: 80,  z: 100 },
    lookAt:    { x: -40, y: 0,   z: 0   },
    duration:  12,
    narration: 'End every check-in by reading your NEXUS briefing. It summarizes everything into action items. If you only have 30 seconds, read the briefing.',
    triggerEvent: 'nexus:trigger-briefing',
  },
]

// ── Subtitle / HUD panel ───────────────────────────────────────────────────────

interface HUDProps {
  stepIndex: number
  phase:     TutPhase
  typedText: string
  speaking:  boolean
  onNext:    () => void
  onSkip:    () => void
}

function IncomeTutorialHUD({ stepIndex, phase, typedText, speaking, onNext, onSkip }: HUDProps) {
  const step  = INCOME_STEPS[stepIndex]
  const total = INCOME_STEPS.length

  const initX = Math.round(window.innerWidth / 2 - 270)
  const initY = window.innerHeight - 240

  return (
    <ResizablePanel
      panelKey="nw-income-tutorial-hud"
      defaultWidth={540}
      defaultHeight={210}
      titleBarHeight={56}
      zIndex={122}
      initialPos={{ x: initX, y: initY }}
    >
      <div style={{
        width:          '100%',
        background:     'rgba(8,6,2,0.93)',
        backdropFilter: 'blur(14px)',
        borderRadius:   12,
        border:         `1px solid ${ACCENT_GLOW}`,
        boxShadow:      `0 4px 40px rgba(0,0,0,0.7), 0 0 24px ${ACCENT_DIM}`,
        padding:        '14px 18px 12px',
        display:        'flex',
        flexDirection:  'column',
        gap:            10,
        boxSizing:      'border-box',
        animation:      'it-hud-in 0.35s ease both',
      }}>

        {/* Row 1: NEXUS orb + step title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Amber NEXUS orb */}
          <div style={{
            width:        28,
            height:       28,
            borderRadius: '50%',
            background:   `radial-gradient(circle at 35% 35%, #fde68a, #b45309)`,
            boxShadow:    `0 0 14px ${ACCENT_GLOW}`,
            flexShrink:   0,
            animation:    speaking ? 'it-orb-pulse-speak 0.5s ease-in-out infinite' : 'it-orb-pulse 2.5s ease-in-out infinite',
          }} />

          {/* Step label + title */}
          <div style={{ flex: 1 }}>
            <div style={{
              color:         ACCENT,
              fontSize:      10,
              fontFamily:    'monospace',
              letterSpacing: 2.5,
              marginBottom:  2,
            }}>
              INCOME WALKTHROUGH — STEP {stepIndex + 1} / {total}
            </div>
            <div style={{
              color:         '#ffffff',
              fontSize:      15,
              fontFamily:    "'Syne', 'Segoe UI', sans-serif",
              fontWeight:    700,
              letterSpacing: 0.8,
            }}>
              {step?.title ?? ''}
            </div>
          </div>

          {/* Speaking indicator */}
          {speaking && (
            <div style={{
              fontSize:      10,
              color:         ACCENT,
              fontFamily:    'monospace',
              letterSpacing: 1,
              animation:     'it-speaking-blink 0.7s step-end infinite',
            }}>
              ▶ NEXUS
            </div>
          )}
        </div>

        {/* Row 2: Narration text */}
        <div style={{
          color:      'rgba(255,255,255,0.92)',
          fontSize:   18,
          fontFamily: "'Syne', 'Segoe UI', sans-serif",
          lineHeight: 1.5,
          minHeight:  50,
        }}>
          {typedText}
          {phase === 'stopped' && typedText.length < (step?.narration.length ?? 0) && (
            <span style={{
              display:       'inline-block',
              width:         2,
              height:        '1em',
              background:    ACCENT,
              marginLeft:    2,
              verticalAlign: 'text-bottom',
              animation:     'it-cursor-blink 0.6s step-end infinite',
            }} />
          )}
        </div>

        {/* Row 3: progress dots + controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            {INCOME_STEPS.map((_, i) => (
              <div key={i} style={{
                width:      i === stepIndex ? 9 : 5,
                height:     i === stepIndex ? 9 : 5,
                borderRadius: '50%',
                background:  i === stepIndex
                  ? ACCENT
                  : i < stepIndex
                    ? 'rgba(245,158,11,0.38)'
                    : 'rgba(255,255,255,0.18)',
                transition:  'all 0.3s ease',
                boxShadow:   i === stepIndex ? `0 0 6px ${ACCENT_GLOW}` : 'none',
              }} />
            ))}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onSkip}
              style={{
                padding:    '5px 12px',
                borderRadius: 5,
                border:     '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.05)',
                color:      'rgba(255,255,255,0.45)',
                cursor:     'pointer',
                fontSize:   14,
                fontFamily: 'monospace',
                letterSpacing: 1,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,80,80,0.12)'; e.currentTarget.style.color = '#ff8888' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.45)' }}
            >
              EXIT
            </button>
            <button
              onClick={onNext}
              style={{
                padding:    '5px 16px',
                borderRadius: 5,
                border:     `1px solid ${ACCENT_GLOW}`,
                background: ACCENT_DIM,
                color:      ACCENT,
                cursor:     'pointer',
                fontSize:   14,
                fontFamily: 'monospace',
                letterSpacing: 1.5,
                fontWeight: 700,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.25)' }}
              onMouseLeave={e => { e.currentTarget.style.background = ACCENT_DIM }}
            >
              {stepIndex >= INCOME_STEPS.length - 1 ? 'FINISH ✓' : 'NEXT →'}
            </button>
          </div>
        </div>
      </div>
    </ResizablePanel>
  )
}

// ── Complete badge ─────────────────────────────────────────────────────────────

function CompleteBadge({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div style={{
      position:       'absolute',
      top:            '50%',
      left:           '50%',
      transform:      'translate(-50%,-50%)',
      zIndex:         135,
      padding:        '20px 44px',
      borderRadius:   14,
      background:     'rgba(8,6,2,0.93)',
      border:         `1px solid ${ACCENT_GLOW}`,
      boxShadow:      `0 0 48px rgba(245,158,11,0.28)`,
      backdropFilter: 'blur(18px)',
      textAlign:      'center',
      animation:      'it-badge-in 0.4s ease both',
      pointerEvents:  'none',
    }}>
      <div style={{ fontSize: 28, marginBottom: 8, animation: 'it-orb-pulse 1.5s ease-in-out infinite' }}>◈</div>
      <div style={{
        color:         ACCENT,
        fontSize:      13,
        fontFamily:    'monospace',
        fontWeight:    700,
        letterSpacing: 3.5,
        textShadow:    `0 0 14px ${ACCENT_GLOW}`,
      }}>
        WALKTHROUGH COMPLETE
      </div>
      <div style={{
        color:         'rgba(255,255,255,0.35)',
        fontSize:      10,
        fontFamily:    'monospace',
        letterSpacing: 1.5,
        marginTop:     8,
      }}>
        RUN AGAIN FROM SETTINGS
      </div>
    </div>
  )
}

// ── Auto-prompt modal ──────────────────────────────────────────────────────────

interface PromptProps {
  onAccept:  () => void
  onDecline: () => void
}

function AutoPromptModal({ onAccept, onDecline }: PromptProps) {
  return (
    <div style={{
      position:       'absolute',
      top:            '50%',
      left:           '50%',
      transform:      'translate(-50%,-50%)',
      zIndex:         133,
      padding:        '24px 32px',
      borderRadius:   14,
      background:     'rgba(8,6,2,0.95)',
      border:         `1px solid ${ACCENT_GLOW}`,
      boxShadow:      `0 0 48px rgba(245,158,11,0.2)`,
      backdropFilter: 'blur(18px)',
      textAlign:      'center',
      maxWidth:       380,
      animation:      'it-badge-in 0.4s ease both',
    }}>
      {/* Orb */}
      <div style={{
        width:        36,
        height:       36,
        borderRadius: '50%',
        background:   `radial-gradient(circle at 35% 35%, #fde68a, #b45309)`,
        boxShadow:    `0 0 18px ${ACCENT_GLOW}`,
        margin:       '0 auto 14px',
        animation:    'it-orb-pulse 2.5s ease-in-out infinite',
      }} />

      <div style={{
        color:         ACCENT,
        fontSize:      10,
        fontFamily:    'monospace',
        letterSpacing: 2.5,
        marginBottom:  8,
      }}>
        NEXUS INCOME SYSTEM
      </div>

      <div style={{
        color:         '#ffffff',
        fontSize:      16,
        fontFamily:    "'Syne', 'Segoe UI', sans-serif",
        fontWeight:    700,
        marginBottom:  10,
        letterSpacing: 0.4,
      }}>
        Want a quick walkthrough on tracking your income target?
      </div>

      <div style={{
        color:      'rgba(255,255,255,0.5)',
        fontSize:   14,
        fontFamily: "'Syne', 'Segoe UI', sans-serif",
        lineHeight: 1.5,
        marginBottom: 20,
      }}>
        8 steps · ~90 seconds · NEXUS narrated · run again anytime from Settings
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button
          onClick={onDecline}
          style={{
            padding:    '7px 18px',
            borderRadius: 6,
            border:     '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.05)',
            color:      'rgba(255,255,255,0.45)',
            cursor:     'pointer',
            fontSize:   14,
            fontFamily: 'monospace',
            letterSpacing: 1,
          }}
        >
          NOT NOW
        </button>
        <button
          onClick={onAccept}
          style={{
            padding:    '7px 22px',
            borderRadius: 6,
            border:     `1px solid ${ACCENT_GLOW}`,
            background: ACCENT_DIM,
            color:      ACCENT,
            cursor:     'pointer',
            fontSize:   14,
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: 1.5,
          }}
        >
          YES, LET'S GO ▶
        </button>
      </div>
    </div>
  )
}

// ── Main IncomeTutorial Component ──────────────────────────────────────────────

export function IncomeTutorial() {
  const { camera } = useWorldContext()

  // ── State ──────────────────────────────────────────────────────────────────
  const [active,       setActive]       = useState(false)
  const [stepIndex,    setStepIndex]    = useState(0)
  const [phase,        setPhase]        = useState<TutPhase>('idle')
  const [typedText,    setTypedText]    = useState('')
  const [speaking,     setSpeaking]     = useState(false)
  const [showBadge,    setShowBadge]    = useState(false)
  const [showPrompt,   setShowPrompt]   = useState(false)

  // ── Refs ───────────────────────────────────────────────────────────────────
  const flyAnimRef   = useRef<{
    curve:     THREE.CatmullRomCurve3
    lookCurve: THREE.CatmullRomCurve3
    elapsed:   number
    duration:  number
    active:    boolean
    onDone:    () => void
  } | null>(null)

  const stopTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typeTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeLayerRef = useRef<string | null>(null)
  const baseTarget    = useRef(new THREE.Vector3())
  const basePos       = useRef(new THREE.Vector3())
  const ttsAbort      = useRef<AbortController | null>(null)

  // ── Cleanup helpers ────────────────────────────────────────────────────────
  const clearTimers = useCallback(() => {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null }
    if (typeTimerRef.current) { clearInterval(typeTimerRef.current); typeTimerRef.current = null }
  }, [])

  const cancelTTS = useCallback(() => {
    if (ttsAbort.current) { ttsAbort.current.abort(); ttsAbort.current = null }
    setSpeaking(false)
  }, [])

  const disableActiveLayer = useCallback(() => {
    if (activeLayerRef.current) {
      window.dispatchEvent(new CustomEvent('nw:tour-layer-off', { detail: { layer: activeLayerRef.current } }))
      activeLayerRef.current = null
    }
  }, [])

  // ── TTS narration ──────────────────────────────────────────────────────────
  const speakNarration = useCallback(async (text: string) => {
    cancelTTS()
    const ctrl = new AbortController()
    ttsAbort.current = ctrl
    setSpeaking(true)
    try {
      await synthesizeWithElevenLabs({ text, voice_id: DEFAULT_VOICE_ID })
    } catch {
      // TTS failure is silent — text is already shown
    } finally {
      if (!ctrl.signal.aborted) {
        setSpeaking(false)
        ttsAbort.current = null
      }
    }
  }, [cancelTTS])

  // ── Typing animation ───────────────────────────────────────────────────────
  const startTyping = useCallback((text: string, onComplete?: () => void) => {
    if (typeTimerRef.current) clearInterval(typeTimerRef.current)
    setTypedText('')
    let idx = 0
    const ms = 1000 / TYPING_SPEED_CPS
    typeTimerRef.current = setInterval(() => {
      idx++
      setTypedText(text.slice(0, idx))
      if (idx >= text.length) {
        if (typeTimerRef.current) clearInterval(typeTimerRef.current)
        typeTimerRef.current = null
        onComplete?.()
      }
    }, ms)
  }, [])

  // ── Camera fly ─────────────────────────────────────────────────────────────
  const flyToStep = useCallback((step: IncomeStep, onDone: () => void) => {
    if (!camera) { onDone(); return }

    const startPos = camera.position.clone()
    const endPos   = new THREE.Vector3(step.target.x, step.target.y, step.target.z)
    const lookEnd  = new THREE.Vector3(step.lookAt.x, step.lookAt.y, step.lookAt.z)

    const mid = startPos.clone().lerp(endPos, 0.5)
    mid.y = Math.max(startPos.y, endPos.y) + 18

    const curve = new THREE.CatmullRomCurve3([startPos, mid, endPos])

    const currentLook = new THREE.Vector3()
    camera.getWorldDirection(currentLook)
    currentLook.multiplyScalar(50).add(startPos)

    const lookCurve = new THREE.CatmullRomCurve3([
      currentLook,
      currentLook.clone().lerp(lookEnd, 0.5),
      lookEnd,
    ])

    flyAnimRef.current = {
      curve, lookCurve,
      elapsed:  0,
      duration: TRANSITION_MS,
      active:   true,
      onDone,
    }

    basePos.current.copy(endPos)
    baseTarget.current.copy(lookEnd)
  }, [camera])

  // ── Go to step ─────────────────────────────────────────────────────────────
  const goToStep = useCallback((idx: number) => {
    clearTimers()
    cancelTTS()
    disableActiveLayer()

    if (idx >= INCOME_STEPS.length) {
      setPhase('complete')
      return
    }

    const step = INCOME_STEPS[idx]
    setStepIndex(idx)
    setPhase('transitioning')
    setTypedText('')

    flyToStep(step, () => {
      setPhase('stopped')

      // Enable layer toggle if specified
      if (step.layerToggle) {
        window.dispatchEvent(new CustomEvent('nw:tour-layer-on', { detail: { layer: step.layerToggle } }))
        activeLayerRef.current = step.layerToggle
      }

      // Fire trigger event if specified (e.g. briefing on step 8)
      if (step.triggerEvent) {
        window.dispatchEvent(new CustomEvent(step.triggerEvent))
      }

      // Typing + TTS in parallel
      startTyping(step.narration)
      speakNarration(step.narration)

      // Auto-advance after duration
      stopTimerRef.current = setTimeout(() => {
        goToStep(idx + 1)
      }, step.duration * 1000)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimers, cancelTTS, disableActiveLayer, flyToStep, startTyping, speakNarration])

  // ── Start tutorial ─────────────────────────────────────────────────────────
  const startTutorial = useCallback(() => {
    clearTimers()
    cancelTTS()
    disableActiveLayer()
    setActive(true)
    setShowBadge(false)
    setShowPrompt(false)
    setStepIndex(0)
    setPhase('transitioning')
    setTypedText('')
    window.dispatchEvent(new CustomEvent('nw:tour-lock-camera'))
    goToStep(0)
  }, [clearTimers, cancelTTS, disableActiveLayer, goToStep])

  // ── End tutorial ───────────────────────────────────────────────────────────
  const endTutorial = useCallback((completed: boolean) => {
    clearTimers()
    cancelTTS()
    disableActiveLayer()
    flyAnimRef.current = null
    window.dispatchEvent(new CustomEvent('nw:tour-unlock-camera'))
    setActive(false)
    setPhase('idle')
    setTypedText('')

    if (completed) {
      try { localStorage.setItem(INCOME_TUTORIAL_COMPLETED_KEY, '1') } catch { /* ignore */ }
      setShowBadge(true)
      window.dispatchEvent(new CustomEvent('nw:income-tutorial-complete'))
      window.dispatchEvent(new CustomEvent('nw:tour-restore-layers'))
    }
  }, [clearTimers, cancelTTS, disableActiveLayer])

  // ── Skip / Next ────────────────────────────────────────────────────────────
  const handleSkip = useCallback(() => endTutorial(false), [endTutorial])

  const handleNext = useCallback(() => {
    clearTimers()
    cancelTTS()
    if (stepIndex >= INCOME_STEPS.length - 1) {
      endTutorial(true)
    } else {
      goToStep(stepIndex + 1)
    }
  }, [clearTimers, cancelTTS, stepIndex, endTutorial, goToStep])

  // ── Phase complete handler ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'complete') endTutorial(true)
  }, [phase, endTutorial])

  // ── Keyboard controls ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleSkip()
      if (e.key === ' ' && phase === 'stopped') { e.preventDefault(); handleNext() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, phase, handleSkip, handleNext])

  // ── External event listeners ───────────────────────────────────────────────
  useEffect(() => {
    function onStart() { startTutorial() }
    window.addEventListener('nw:income-tutorial-start', onStart)
    return () => window.removeEventListener('nw:income-tutorial-start', onStart)
  }, [startTutorial])

  // ── Auto-prompt on first launch (after ship) ───────────────────────────────
  useEffect(() => {
    try {
      const completed = localStorage.getItem(INCOME_TUTORIAL_COMPLETED_KEY)
      const prompted  = localStorage.getItem(INCOME_TUTORIAL_PROMPTED_KEY)
      if (!completed && !prompted) {
        const t = setTimeout(() => setShowPrompt(true), 4500)
        return () => clearTimeout(t)
      }
    } catch { /* ignore */ }
  }, [])

  const handlePromptAccept = useCallback(() => {
    try { localStorage.setItem(INCOME_TUTORIAL_PROMPTED_KEY, '1') } catch { /* ignore */ }
    startTutorial()
  }, [startTutorial])

  const handlePromptDecline = useCallback(() => {
    try { localStorage.setItem(INCOME_TUTORIAL_PROMPTED_KEY, '1') } catch { /* ignore */ }
    setShowPrompt(false)
  }, [])

  // ── nw:frame — camera fly animation ───────────────────────────────────────
  useEffect(() => {
    let lastTime = performance.now()

    function onFrame() {
      if (!camera) return
      const now     = performance.now()
      const deltaMs = now - lastTime
      lastTime = now

      const fly = flyAnimRef.current
      if (fly?.active) {
        fly.elapsed = Math.min(fly.elapsed + deltaMs, fly.duration)
        const t    = fly.elapsed / fly.duration
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
        const pt   = fly.curve.getPoint(ease)
        const lk   = fly.lookCurve.getPoint(ease)
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
        camera.position.copy(basePos.current)
        camera.lookAt(baseTarget.current)
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [camera, active, phase])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* CSS keyframes */}
      <style>{`
        @keyframes it-hud-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes it-orb-pulse {
          0%, 100% { box-shadow: 0 0 12px rgba(245,158,11,0.6); }
          50%       { box-shadow: 0 0 22px rgba(245,158,11,0.9), 0 0 32px rgba(245,158,11,0.3); }
        }
        @keyframes it-orb-pulse-speak {
          0%, 100% { box-shadow: 0 0 18px rgba(245,158,11,0.9); transform: scale(1); }
          50%       { box-shadow: 0 0 30px rgba(245,158,11,1.0);  transform: scale(1.1); }
        }
        @keyframes it-cursor-blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0; }
        }
        @keyframes it-speaking-blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
        @keyframes it-badge-in {
          from { opacity: 0; transform: translate(-50%,-50%) scale(0.85); }
          to   { opacity: 1; transform: translate(-50%,-50%) scale(1); }
        }
        @keyframes it-vignette-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* Auto-prompt modal */}
      {showPrompt && !active && (
        <>
          <div style={{
            position:   'absolute',
            inset:      0,
            background: 'rgba(0,0,0,0.45)',
            zIndex:     132,
            animation:  'it-vignette-in 0.4s ease',
          }} onClick={handlePromptDecline} />
          <AutoPromptModal onAccept={handlePromptAccept} onDecline={handlePromptDecline} />
        </>
      )}

      {/* Active tutorial UI */}
      {active && (
        <>
          {/* Vignette overlay */}
          <div style={{
            position:       'absolute',
            inset:          0,
            background:     'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.38) 100%)',
            zIndex:         100,
            pointerEvents:  'none',
            animation:      'it-vignette-in 0.5s ease',
          }} />

          {/* Top-center status bar */}
          <div style={{
            position:       'absolute',
            top:            14,
            left:           '50%',
            transform:      'translateX(-50%)',
            zIndex:         115,
            background:     'rgba(8,6,2,0.88)',
            border:         `1px solid ${ACCENT_GLOW}`,
            borderRadius:   6,
            padding:        '4px 16px',
            color:          ACCENT,
            fontSize:       10,
            fontFamily:     'monospace',
            letterSpacing:  2.5,
            pointerEvents:  'none',
            backdropFilter: 'blur(8px)',
          }}>
            {phase === 'transitioning'
              ? '◈ INCOME WALKTHROUGH — TRAVELING...'
              : `◈ INCOME WALKTHROUGH — STEP ${stepIndex + 1} OF ${INCOME_STEPS.length}`
            }
          </div>

          {/* HUD panel */}
          <IncomeTutorialHUD
            stepIndex={stepIndex}
            phase={phase}
            typedText={typedText}
            speaking={speaking}
            onNext={handleNext}
            onSkip={handleSkip}
          />
        </>
      )}

      {/* Completion badge */}
      {showBadge && <CompleteBadge onDone={() => setShowBadge(false)} />}
    </>
  )
}

// ── Exported trigger helper (for Settings + NEXUS Briefing) ───────────────────

export function triggerIncomeTutorial() {
  window.dispatchEvent(new CustomEvent('nw:income-tutorial-start'))
}
