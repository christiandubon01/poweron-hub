// @ts-nocheck
/**
 * VisualSuitePanel.tsx — Main 43-mode AI Visual Suite panel
 * B48 — NEXUS Visual Suite Full Deploy
 *
 * • 43 draw modes across 3 buckets (B1/B2/B3)
 * • rAF loop with simulated frequency data
 * • 3 rows of mode buttons, 4 sliders, AUTO cycle, CAR REEL, INFO popup
 * • localStorage persistence
 */

import React, { useRef, useEffect, useCallback, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { useNEXUSAudio } from './useNEXUSAudio'

import { B1_DRAWS }            from './modes/bucket1'
import { B2_DRAWS }            from './modes/bucket2'
import { B3_DRAWS }            from './modes/bucket3'
import { MODE_DESCRIPTIONS }   from './modeDescriptions'
import type { ModeDesc }       from './modeDescriptions'
import VisualCarReel            from './VisualCarReel'

// ─── Types ────────────────────────────────────────────────────────────────────
type DrawFn = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  B: number,
  M: number,
  Hi: number,
  bh: number,
  mtz: number,
) => void

// ─── Constants ────────────────────────────────────────────────────────────────
const ALL_DRAWS: DrawFn[] = [...B1_DRAWS, ...B2_DRAWS, ...B3_DRAWS]
const TOTAL_MODES = ALL_DRAWS.length   // 43

const LS_MODE  = 'nexus_viz_mode'
const LS_MTZ   = 'nexus_mtz'
const LS_HUE   = 'nexus_viz_hue'
const LS_SPEED = 'nexus_viz_speed'
const LS_INT   = 'nexus_viz_int'

function lsGet(key: string, def: number): number {
  try { const v = localStorage.getItem(key); return v !== null ? parseFloat(v) : def } catch { return def }
}
function lsSet(key: string, val: number): void {
  try { localStorage.setItem(key, String(val)) } catch {}
}

// ─── Info Popup ───────────────────────────────────────────────────────────────
interface InfoPopupProps {
  desc: ModeDesc
  onClose: () => void
}

function InfoPopup({ desc, onClose }: InfoPopupProps) {
  const [tab, setTab] = useState<'sim' | 'sci' | 'prompt'>('sim')
  const tabs: { key: 'sim' | 'sci' | 'prompt'; label: string }[] = [
    { key: 'sim', label: 'Plain English' },
    { key: 'sci', label: 'Science' },
    { key: 'prompt', label: 'Prompt' },
  ]
  const bucketColor = desc.bucket === 'B1' ? '#00ff88' : desc.bucket === 'B2' ? '#ff44ff' : '#44ffff'
  const content = desc[tab]

  return (
    <div style={{
      position:        'absolute',
      bottom:          72,
      right:           12,
      zIndex:          200,
      width:           300,
      borderRadius:    10,
      backgroundColor: 'rgba(4,6,18,0.96)',
      border:          `1px solid ${bucketColor}33`,
      backdropFilter:  'blur(14px)',
      boxShadow:       `0 8px 40px rgba(0,0,0,0.7), 0 0 20px ${bucketColor}18`,
      fontFamily:      'Courier New, monospace',
    }}>
      {/* Header */}
      <div style={{
        padding:      '10px 12px 8px',
        borderBottom: `1px solid ${bucketColor}22`,
        display:      'flex',
        alignItems:   'center',
        gap:          8,
      }}>
        <span style={{
          width:           28, height: 28, borderRadius: 6,
          backgroundColor: desc.color + '33',
          border:          `1.5px solid ${desc.color}`,
          display:         'flex', alignItems: 'center', justifyContent: 'center',
          fontSize:        9, fontWeight: 800, color: desc.color,
          flexShrink:      0,
        }}>
          {desc.bucket}
        </span>
        <span style={{ fontSize: 11, fontWeight: 800, color: bucketColor, letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
          {desc.name}
        </span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '0 4px',
        }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${bucketColor}18` }}>
        {tabs.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex:            1,
            padding:         '6px 0',
            border:          'none',
            cursor:          'pointer',
            fontSize:        9,
            fontWeight:      700,
            letterSpacing:   '0.07em',
            textTransform:   'uppercase',
            backgroundColor: 'transparent',
            color:           tab === key ? bucketColor : '#444',
            borderBottom:    tab === key ? `2px solid ${bucketColor}` : '2px solid transparent',
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '10px 12px 14px', minHeight: 90 }}>
        <p style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.65, margin: 0 }}>
          {content}
        </p>
      </div>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface VisualSuitePanelProps {
  micStream?: MediaStream | null
  ttsElement?: HTMLAudioElement | null
  nexusState?: 'idle' | 'listening' | 'thinking' | 'speaking' | 'multiAgent'
  // B62: ORB LAB inline controls — NEXUS voice pipeline mic
  onMicToggle?: () => void | Promise<void>
  micActive?: boolean
  nexusStatusText?: string | null
}

// ─── NEXUS state → visual config ─────────────────────────────────────────────
const NEXUS_STATE_CONFIG = {
  idle:       { mtzBoost: 0.0,  intensityMult: 0.8 },
  listening:  { mtzBoost: 0.1,  intensityMult: 1.2 },
  thinking:   { mtzBoost: 0.15, intensityMult: 1.0 },
  speaking:   { mtzBoost: 0.3,  intensityMult: 1.4 },
  multiAgent: { mtzBoost: 0.5,  intensityMult: 1.6 },
} as const

// ─── Main Component ───────────────────────────────────────────────────────────
export default function VisualSuitePanel({
  micStream,
  ttsElement,
  nexusState,
  onMicToggle,
  micActive,
  nexusStatusText,
}: VisualSuitePanelProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [activeMode, setActiveModeState] = useState<number>(() => lsGet(LS_MODE, 0))
  const [mtz,  setMtzState]   = useState<number>(() => lsGet(LS_MTZ,   0))
  const [hue,  setHueState]   = useState<number>(() => lsGet(LS_HUE,   155))
  const [speed, setSpeedState] = useState<number>(() => lsGet(LS_SPEED, 45))
  const [intensity, setIntState] = useState<number>(() => lsGet(LS_INT, 75))

  const [autoOn,    setAutoOn]    = useState(false)
  const [showReel,  setShowReel]  = useState(false)
  const [showInfo,  setShowInfo]  = useState(false)
  // B50: Bucket dropdown state
  const [openDropdown, setOpenDropdown] = useState<'B1' | 'B2' | 'B3' | null>(null)
  // B52: Local mic stream (for standalone use when no micStream prop passed)
  const [localMicStream, setLocalMicStream] = useState<MediaStream | null>(null)
  const [micError, setMicError] = useState<string | null>(null)

  const effectiveMicStream = micStream ?? localMicStream

  // ── Live audio bands from useNEXUSAudio ──────────────────────────────────
  const { bass, mid, high, isLive } = useNEXUSAudio(
    effectiveMicStream ?? null,
    ttsElement ?? null,
  )

  // Refs so rAF loop always reads latest values without stale closure issues
  const bassRef       = useRef(bass)
  const midRef2       = useRef(mid)
  const highRef       = useRef(high)
  const nexusStateRef = useRef(nexusState ?? 'idle')
  bassRef.current       = bass
  midRef2.current       = mid
  highRef.current       = high
  nexusStateRef.current = nexusState ?? 'idle'

  // Mutable refs for rAF loop (avoid stale closures)
  const modeRef      = useRef(activeMode)
  const mtzRef       = useRef(mtz)
  const hueRef       = useRef(hue)
  const speedRef     = useRef(speed)
  const intensityRef = useRef(intensity)
  const autoRef      = useRef(false)
  const autoTimerRef = useRef(0)
  const startTsRef   = useRef(0)
  const rafRef       = useRef(0)
  const runningRef   = useRef(false)

  // Sync refs to state
  modeRef.current      = activeMode
  mtzRef.current       = mtz
  hueRef.current       = hue
  speedRef.current     = speed
  intensityRef.current = intensity
  autoRef.current      = autoOn

  // ── Setters with localStorage ────────────────────────────────────────────
  const setMode = (m: number) => {
    setActiveModeState(m)
    lsSet(LS_MODE, m)
    autoTimerRef.current = performance.now()
  }
  const setMtz = (v: number) => { mtzRef.current = v; setMtzState(v);   lsSet(LS_MTZ,   v) }
  const setHue = (v: number) => { hueRef.current = v; setHueState(v);   lsSet(LS_HUE,   v) }
  const setSpeed = (v: number) => { speedRef.current = v; setSpeedState(v); lsSet(LS_SPEED, v) }
  const setInt = (v: number) => { intensityRef.current = v; setIntState(v);   lsSet(LS_INT,   v) }

  // B52: Toggle local mic
  const toggleMic = async () => {
    if (localMicStream) {
      localMicStream.getTracks().forEach(t => t.stop())
      setLocalMicStream(null)
      setMicError(null)
    } else {
      try {
        setMicError(null)
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        setLocalMicStream(stream)
      } catch (e: any) {
        setMicError('Mic blocked')
      }
    }
  }

  // ── rAF loop ─────────────────────────────────────────────────────────────
  const loop = useCallback((ts: number) => {
    if (!runningRef.current) return

    const canvas = canvasRef.current
    if (!canvas) { rafRef.current = requestAnimationFrame(loop); return }

    const ctx = canvas.getContext('2d')
    if (!ctx) { rafRef.current = requestAnimationFrame(loop); return }

    if (!startTsRef.current) startTsRef.current = ts

    const dpr  = window.devicePixelRatio || 1
    const W    = canvas.width  / dpr
    const H    = canvas.height / dpr

    // Audio-reactive frequency values (live or simulated via useNEXUSAudio)
    const spd  = (speedRef.current / 100) * 1.8 + 0.2   // 0.2 – 2.0
    const t    = ((ts - startTsRef.current) / 1000) * spd
    const int  = intensityRef.current / 100               // 0 – 1
    const stateConfig = NEXUS_STATE_CONFIG[nexusStateRef.current] ?? NEXUS_STATE_CONFIG['idle']
    const effectiveMtz = Math.min(1.0, (mtzRef.current / 100) + stateConfig.mtzBoost)
    const B  = Math.min(1, bassRef.current * stateConfig.intensityMult * int + 0.05)
    const M  = Math.min(1, midRef2.current * stateConfig.intensityMult * int + 0.05)
    const Hi = Math.min(1, highRef.current * stateConfig.intensityMult * int + 0.05)
    const bh   = Math.abs(Math.sin(t * 0.9)) * int

    // AUTO advance
    if (autoRef.current) {
      const elapsed = ts - autoTimerRef.current
      if (elapsed >= 2800) {
        const next = (modeRef.current + 1) % TOTAL_MODES
        setActiveModeState(next)
        modeRef.current = next
        lsSet(LS_MODE, next)
        autoTimerRef.current = ts
      }
    }

    // Draw active mode
    const drawFn = ALL_DRAWS[modeRef.current] ?? ALL_DRAWS[0]
    try {
      drawFn(ctx, W, H, t, B, M, Hi, bh, effectiveMtz)
    } catch (_e) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
    }

    rafRef.current = requestAnimationFrame(loop)
  }, [])

  // ── Canvas sizing ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function resize() {
      const dpr  = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const w    = rect.width  || window.innerWidth
      const h    = rect.height || window.innerHeight - 80
      if (canvas.width  !== Math.round(w * dpr) ||
          canvas.height !== Math.round(h * dpr)) {
        canvas.width  = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
    }

    let roRef: ResizeObserver | null = null

    function startWhenReady() {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const w = rect.width || window.innerWidth
      const h = rect.height || window.innerHeight - 80
      if (w === 0 || h === 0) {
        requestAnimationFrame(startWhenReady)
        return
      }
      resize()
      runningRef.current   = true
      startTsRef.current   = 0
      autoTimerRef.current = performance.now()
      rafRef.current       = requestAnimationFrame(loop)
      roRef = new ResizeObserver(resize)
      roRef.observe(canvas)
    }

    requestAnimationFrame(startWhenReady)

    return () => {
      runningRef.current = false
      cancelAnimationFrame(rafRef.current)
      if (roRef) roRef.disconnect()
    }
  }, [loop])

  // ── Bucket button data ────────────────────────────────────────────────────
  const b1Modes = MODE_DESCRIPTIONS.filter(m => m.bucket === 'B1')
  const b2Modes = MODE_DESCRIPTIONS.filter(m => m.bucket === 'B2')
  const b3Modes = MODE_DESCRIPTIONS.filter(m => m.bucket === 'B3')

  const bucketColor = (b: 'B1' | 'B2' | 'B3') =>
    b === 'B1' ? '#00ff88' : b === 'B2' ? '#ff44ff' : '#44ffff'

  const activeDesc: ModeDesc = MODE_DESCRIPTIONS[activeMode] ?? MODE_DESCRIPTIONS[0]

  // ── Slider row helper ─────────────────────────────────────────────────────
  const Slider = ({
    label, value, onChange, color = '#00ff88',
  }: { label: string; value: number; onChange: (v: number) => void; color?: string }) => (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 2, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#666', fontFamily: 'Courier New, monospace', letterSpacing: '0.08em' }}>
        <span>{label}</span>
        <span style={{ color }}>{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        style={{
          WebkitAppearance: 'none',
          height:           3,
          borderRadius:     2,
          background:       `linear-gradient(to right, ${color} ${value}%, #222 ${value}%)`,
          outline:          'none',
          cursor:           'pointer',
        }}
      />
    </div>
  )

  // B62: Determine effective mic state — prefer NEXUS pipeline (onMicToggle) over local mic
  const isNexusMic = !!onMicToggle
  const effectiveMicActive = isNexusMic ? (micActive ?? false) : isLive
  const effectiveMicToggle = isNexusMic ? onMicToggle : toggleMic

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    // B69: explicit height breaks flex-1 collapse chain — canvas was blank because
    // getBoundingClientRect returned 0 when all ancestors used flex:1 with no
    // defined height. calc(100vh - 106px) matches NeuralMap safe pattern.
    <div style={{
      display:         'flex',
      flexDirection:   'column',
      width:           '100%',
      height:          'calc(100vh - 106px)',
      backgroundColor: '#000',
      overflow:        'hidden',
      fontFamily:      'Courier New, monospace',
      userSelect:      'none',
    }}>

      {/* ── Canvas — fills all space above 72px bottom bar ── */}
      {/* B69: flex:1 + minHeight:0 safe because parent now has explicit calc height */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />

        {/* Car Reel overlay */}
        {showReel && (
          <VisualCarReel onClose={() => setShowReel(false)} />
        )}

        {/* Info popup */}
        {showInfo && (
          <InfoPopup desc={activeDesc} onClose={() => setShowInfo(false)} />
        )}
      </div>

      {/* ── B62: Single-row bottom bar — 72px, zero scrolling ── */}
      {/* B71: overflow changed to visible so bucket dropdowns (position:absolute, bottom:100%) are not clipped */}
      <div style={{
        height:          72,
        flexShrink:      0,
        display:         'flex',
        alignItems:      'center',
        gap:             8,
        padding:         '0 10px',
        backgroundColor: '#060810',
        borderTop:       '1px solid rgba(255,255,255,0.07)',
        overflow:        'visible',
      }}>

        {/* Mode bucket dropdowns — B50 style, opens upward */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
          {([['B1', b1Modes], ['B2', b2Modes], ['B3', b3Modes]] as const).map(([bKey, group]) => {
            const bc = bucketColor(bKey)
            const activeModeInBucket = group.find(md => md.id === activeMode)
            const isOpen = openDropdown === bKey
            return (
              <div key={bKey} style={{ position: 'relative' }}>
                <button
                  onClick={() => setOpenDropdown(isOpen ? null : bKey)}
                  style={{
                    display:         'flex', alignItems: 'center', gap: 4,
                    padding:         '4px 8px',
                    border:          `1px solid ${activeModeInBucket ? bc : '#333'}`,
                    borderRadius:    5,
                    backgroundColor: activeModeInBucket ? bc + '18' : 'rgba(255,255,255,0.04)',
                    color:           activeModeInBucket ? bc : '#666',
                    fontSize:        9, fontFamily: 'Courier New, monospace',
                    fontWeight:      700, letterSpacing: '0.08em',
                    cursor:          'pointer', whiteSpace: 'nowrap',
                    transition:      'all 0.12s',
                  }}
                >
                  <span style={{ color: bc }}>{bKey}</span>
                  {activeModeInBucket && <span style={{ color: '#aaa', fontWeight: 400, maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeModeInBucket.name}</span>}
                  {!activeModeInBucket && <span style={{ color: '#444' }}>—</span>}
                  <span style={{ fontSize: 7, color: '#555' }}>▲</span>
                </button>
                {isOpen && (
                  <div
                    style={{
                      position: 'absolute', bottom: '100%', left: 0, zIndex: 300,
                      marginBottom: 4, minWidth: 180, maxHeight: 280, overflowY: 'auto',
                      backgroundColor: 'rgba(4,6,18,0.98)',
                      border: `1px solid ${bc}44`, borderRadius: 7,
                      boxShadow: `0 -8px 32px rgba(0,0,0,0.8), 0 0 12px ${bc}18`,
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    {group.map(md => {
                      const isActive = md.id === activeMode
                      return (
                        <button
                          key={md.id}
                          onClick={() => { setMode(md.id); setOpenDropdown(null) }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            width: '100%', padding: '6px 12px',
                            border: 'none', cursor: 'pointer',
                            backgroundColor: isActive ? bc + '22' : 'transparent',
                            color: isActive ? bc : '#9ca3af',
                            fontSize: 10, fontFamily: 'Courier New, monospace',
                            letterSpacing: '0.04em', textAlign: 'left',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.06)' }}
                          onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: isActive ? bc : '#333', flexShrink: 0, display: 'inline-block' }} />
                          <span style={{ fontSize: 8, color: '#555', minWidth: 20 }}>#{md.id.toString().padStart(2,'0')}</span>
                          <span style={{ flex: 1 }}>{md.name}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          {/* Close dropdowns on outside click */}
          {openDropdown && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setOpenDropdown(null)} />
          )}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

        {/* MIC button — 56px green orb, same style as floating NEXUS mic */}
        <button
          onClick={effectiveMicToggle}
          title={effectiveMicActive ? 'Stop NEXUS mic' : (isNexusMic ? 'Activate NEXUS voice' : (micError ?? 'Activate mic'))}
          style={{
            width:           56,
            height:          56,
            borderRadius:    '50%',
            background:      effectiveMicActive
              ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
              : 'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(22,163,74,0.15) 100%)',
            border:          `1.5px solid ${effectiveMicActive ? 'rgba(34,197,94,0.8)' : micError ? '#ff4444' : 'rgba(34,197,94,0.35)'}`,
            boxShadow:       effectiveMicActive ? '0 4px 20px rgba(34,197,94,0.5)' : '0 2px 8px rgba(34,197,94,0.15)',
            display:         'flex',
            flexDirection:   'column',
            alignItems:      'center',
            justifyContent:  'center',
            gap:             2,
            cursor:          'pointer',
            flexShrink:      0,
            position:        'relative',
            overflow:        'hidden',
            transition:      'all 0.2s',
            animation:       effectiveMicActive ? 'orbMicPulse 1.5s ease-in-out infinite' : 'none',
          }}
        >
          {effectiveMicActive ? <Mic size={16} color="#ffffff" /> : <MicOff size={16} color="rgba(34,197,94,0.8)" />}
          <span style={{
            fontSize: 7, fontFamily: 'Courier New, monospace', letterSpacing: '0.08em',
            fontWeight: 800, color: effectiveMicActive ? '#ffffff' : 'rgba(34,197,94,0.8)',
          }}>
            {effectiveMicActive ? 'LIVE' : 'NEXUS'}
          </span>
          {effectiveMicActive && (
            <span style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: '1.5px solid rgba(34,197,94,0.6)',
              animation: 'ping 1.4s cubic-bezier(0,0,0.2,1) infinite',
              opacity: 0.5,
            }} />
          )}
        </button>

        {/* NEXUS status text (when responding/thinking) */}
        {nexusStatusText && (
          <span style={{
            fontSize: 8, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: nexusStatusText.includes('SPEAKING') ? '#7c3aed' : '#3A8EFF',
            padding: '2px 6px', borderRadius: 4, flexShrink: 0,
            backgroundColor: nexusStatusText.includes('SPEAKING') ? 'rgba(124,58,237,0.12)' : 'rgba(58,142,255,0.12)',
            border: `1px solid ${nexusStatusText.includes('SPEAKING') ? 'rgba(124,58,237,0.3)' : 'rgba(58,142,255,0.3)'}`,
            animation: 'orbMicPulse 1.2s ease-in-out infinite',
          }}>{nexusStatusText}</span>
        )}

        {/* Divider */}
        <div style={{ width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

        {/* Inline sliders — RTT INT SPD NTE, label above each */}
        <div style={{ display: 'flex', gap: 8, flex: 1, alignItems: 'center', minWidth: 0 }}>
          <Slider label="RTT"  value={mtz}       onChange={setMtz}   color="#ff44ff" />
          <Slider label="INT"  value={intensity}  onChange={setInt}   color="#00ff88" />
          <Slider label="SPD"  value={speed}      onChange={setSpeed} color="#44aaff" />
          <Slider label="NTE"  value={hue}        onChange={setHue}   color={`hsl(${hue}, 80%, 65%)`} />
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

        {/* CAR REEL */}
        <button
          onClick={() => setShowReel(p => !p)}
          style={{
            fontSize: 9, fontFamily: 'Courier New, monospace', letterSpacing: '0.08em',
            padding: '5px 10px', border: `1px solid ${showReel ? '#ffaa44' : '#333'}`,
            borderRadius: 5, backgroundColor: showReel ? '#ffaa4422' : 'transparent',
            color: showReel ? '#ffaa44' : '#555', cursor: 'pointer', flexShrink: 0,
          }}
        >
          🚗 REEL
        </button>

        {/* INFO */}
        <button
          onClick={() => setShowInfo(p => !p)}
          style={{
            fontSize: 9, fontFamily: 'Courier New, monospace', letterSpacing: '0.08em',
            padding: '5px 10px', border: `1px solid ${showInfo ? activeDesc.color : '#333'}`,
            borderRadius: 5, backgroundColor: showInfo ? activeDesc.color + '22' : 'transparent',
            color: showInfo ? activeDesc.color : '#555', cursor: 'pointer', flexShrink: 0,
          }}
        >
          ? INFO
        </button>

        <style>{`
          @keyframes orbMicPulse { 0%,100%{box-shadow:0 0 10px rgba(34,197,94,0.35)} 50%{box-shadow:0 0 24px rgba(34,197,94,0.7)} }
          @keyframes ping { 75%,100%{transform:scale(1.4);opacity:0} }
        `}</style>
      </div>
    </div>
  )
}
