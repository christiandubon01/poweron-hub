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

// ─── Main Component ───────────────────────────────────────────────────────────
export default function VisualSuitePanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [activeMode, setActiveModeState] = useState<number>(() => lsGet(LS_MODE, 0))
  const [mtz,  setMtzState]   = useState<number>(() => lsGet(LS_MTZ,   0))
  const [hue,  setHueState]   = useState<number>(() => lsGet(LS_HUE,   155))
  const [speed, setSpeedState] = useState<number>(() => lsGet(LS_SPEED, 45))
  const [intensity, setIntState] = useState<number>(() => lsGet(LS_INT, 75))

  const [autoOn,    setAutoOn]    = useState(false)
  const [showReel,  setShowReel]  = useState(false)
  const [showInfo,  setShowInfo]  = useState(false)

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
  const setMtz = (v: number) => { setMtzState(v);   lsSet(LS_MTZ,   v) }
  const setHue = (v: number) => { setHueState(v);   lsSet(LS_HUE,   v) }
  const setSpeed = (v: number) => { setSpeedState(v); lsSet(LS_SPEED, v) }
  const setInt = (v: number) => { setIntState(v);   lsSet(LS_INT,   v) }

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

    // Simulated frequency values
    const spd  = (speedRef.current / 100) * 1.8 + 0.2   // 0.2 – 2.0
    const t    = ((ts - startTsRef.current) / 1000) * spd
    const int  = intensityRef.current / 100               // 0 – 1
    const B    = Math.min(1, (0.3 + 0.6 * Math.abs(Math.sin(t * 1.1)) * Math.abs(Math.sin(t * 0.37))) * int + 0.15)
    const M    = Math.min(1, (0.2 + 0.5 * Math.abs(Math.sin(t * 0.7 + 1.2)) * Math.abs(Math.sin(t * 0.53))) * int + 0.1)
    const Hi   = hueRef.current
    const bh   = Math.abs(Math.sin(t * 0.9)) * int
    const mtzV = mtzRef.current / 100

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
      drawFn(ctx, W, H, t, B, M, Hi, bh, mtzV)
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
      const w    = rect.width  || 640
      const h    = rect.height || 360
      if (canvas.width  !== Math.round(w * dpr) ||
          canvas.height !== Math.round(h * dpr)) {
        canvas.width  = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
    }

    resize()
    runningRef.current   = true
    startTsRef.current   = 0
    autoTimerRef.current = performance.now()
    rafRef.current       = requestAnimationFrame(loop)

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    return () => {
      runningRef.current = false
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width:           '100%',
      backgroundColor: '#000',
      borderRadius:    10,
      overflow:        'hidden',
      fontFamily:      'Courier New, monospace',
      display:         'flex',
      flexDirection:   'column',
      userSelect:      'none',
    }}>

      {/* ── Mode button rows ── */}
      <div style={{ padding: '8px 8px 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[b1Modes, b2Modes, b3Modes].map((group, gi) => {
          const bKey = (['B1', 'B2', 'B3'] as const)[gi]
          const bc   = bucketColor(bKey)
          return (
            <div key={bKey} style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
              <span style={{ fontSize: 8, color: bc, fontWeight: 700, letterSpacing: '0.1em', minWidth: 20, textAlign: 'right', marginRight: 2 }}>
                {bKey}
              </span>
              {group.map(md => {
                const isActive = md.id === activeMode
                return (
                  <button
                    key={md.id}
                    onClick={() => setMode(md.id)}
                    title={md.name}
                    style={{
                      fontSize:        8,
                      fontFamily:      'Courier New, monospace',
                      letterSpacing:   '0.05em',
                      padding:         '3px 6px',
                      border:          `1px solid ${isActive ? bc : '#2a2a2a'}`,
                      borderRadius:    4,
                      backgroundColor: isActive ? bc + '22' : 'transparent',
                      color:           isActive ? bc : '#555',
                      cursor:          'pointer',
                      whiteSpace:      'nowrap',
                      transition:      'all 0.12s',
                    }}
                  >
                    {md.name}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* ── Canvas ── */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
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

      {/* ── Bottom controls ── */}
      <div style={{ padding: '6px 10px 8px', display: 'flex', flexDirection: 'column', gap: 6, backgroundColor: '#060810' }}>

        {/* Mode label + action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Mode badge */}
          <div style={{
            display:         'flex',
            alignItems:      'center',
            gap:             6,
            flex:            1,
            minWidth:        0,
          }}>
            <span style={{
              fontSize:        9,
              fontWeight:      800,
              color:           bucketColor(activeDesc.bucket),
              backgroundColor: bucketColor(activeDesc.bucket) + '18',
              border:          `1px solid ${bucketColor(activeDesc.bucket)}44`,
              padding:         '2px 7px',
              borderRadius:    4,
              letterSpacing:   '0.1em',
              flexShrink:      0,
            }}>
              {activeDesc.bucket}
            </span>
            <span style={{
              fontSize:     11,
              fontWeight:   700,
              color:        activeDesc.color,
              letterSpacing:'0.06em',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              whiteSpace:   'nowrap',
            }}>
              {activeDesc.name}
            </span>
            <span style={{ fontSize: 9, color: '#333', marginLeft: 2, flexShrink: 0 }}>
              #{activeDesc.id.toString().padStart(2, '0')}
            </span>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {/* AUTO */}
            <button
              onClick={() => {
                setAutoOn(p => !p)
                autoTimerRef.current = performance.now()
              }}
              style={{
                fontSize:        9,
                fontFamily:      'Courier New, monospace',
                letterSpacing:   '0.08em',
                padding:         '4px 9px',
                border:          `1px solid ${autoOn ? '#00ff88' : '#333'}`,
                borderRadius:    4,
                backgroundColor: autoOn ? '#00ff8822' : 'transparent',
                color:           autoOn ? '#00ff88' : '#555',
                cursor:          'pointer',
              }}
            >
              {autoOn ? '⏸ AUTO' : '▶ AUTO'}
            </button>

            {/* CAR REEL */}
            <button
              onClick={() => setShowReel(p => !p)}
              style={{
                fontSize:        9,
                fontFamily:      'Courier New, monospace',
                letterSpacing:   '0.08em',
                padding:         '4px 9px',
                border:          `1px solid ${showReel ? '#ffaa44' : '#333'}`,
                borderRadius:    4,
                backgroundColor: showReel ? '#ffaa4422' : 'transparent',
                color:           showReel ? '#ffaa44' : '#555',
                cursor:          'pointer',
              }}
            >
              🚗 REEL
            </button>

            {/* INFO */}
            <button
              onClick={() => setShowInfo(p => !p)}
              style={{
                fontSize:        9,
                fontFamily:      'Courier New, monospace',
                letterSpacing:   '0.08em',
                padding:         '4px 9px',
                border:          `1px solid ${showInfo ? activeDesc.color : '#333'}`,
                borderRadius:    4,
                backgroundColor: showInfo ? activeDesc.color + '22' : 'transparent',
                color:           showInfo ? activeDesc.color : '#555',
                cursor:          'pointer',
              }}
            >
              ? INFO
            </button>
          </div>
        </div>

        {/* Sliders */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <Slider label="MTZ"  value={mtz}       onChange={setMtz}   color="#ff44ff" />
          <Slider label="INT"  value={intensity}  onChange={setInt}   color="#00ff88" />
          <Slider label="SPD"  value={speed}      onChange={setSpeed} color="#44aaff" />
          <Slider label="HUE"  value={hue}        onChange={setHue}   color={`hsl(${hue}, 80%, 65%)`} />
        </div>
      </div>
    </div>
  )
}
