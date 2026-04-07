// @ts-nocheck
/**
 * VisualCarReel.tsx — Car evolution overlay for AI Visual Suite
 * B48 — NEXUS Visual Suite Full Deploy
 *
 * Canvas overlay showing 6 truck/car frames auto-advancing every 1.8s
 * with cross-fade transitions. Each frame: black bg + gradient + truck
 * silhouette + year + label.
 * Watermark: "POWER ON SOLUTIONS LLC · C-10 #1151468"
 */

import React, { useRef, useEffect, useCallback } from 'react'

// ─── Car data ─────────────────────────────────────────────────────────────────
interface CarFrame {
  year:    string
  vehicle: string
  line2:   string
  line3:   string
  accent1: string
  accent2: string
}

const CAR_FRAMES: CarFrame[] = [
  { year: '2020', vehicle: 'Ford Ranger',                       line2: 'Desert Hot Springs',    line3: 'The Grind Era',             accent1: '#ff8800', accent2: '#cc4400' },
  { year: '2021', vehicle: 'Work Truck',                        line2: 'Job Sites',              line3: 'Building the Foundation',   accent1: '#0088ff', accent2: '#334455' },
  { year: '2022', vehicle: 'RAM 1500',                          line2: 'Power On Solutions LLC', line3: 'First LLC Truck',           accent1: '#ff6600', accent2: '#1a1a2e' },
  { year: '2023', vehicle: 'RAM 1500 Laramie',                  line2: 'The Upgrade',            line3: 'C-10 Earned',               accent1: '#ff2244', accent2: '#0a0a1a' },
  { year: '2024', vehicle: 'RAM 1500 Laramie Longhorn Southfork', line2: 'The Flagship',         line3: 'The Flagship',              accent1: '#ffaa44', accent2: '#1a0808' },
  { year: '2026', vehicle: 'Vision',                            line2: 'The Next Chapter',       line3: 'From Nothing to Platform',  accent1: '#00ffaa', accent2: '#001122' },
]

const WATERMARK      = 'POWER ON SOLUTIONS LLC  ·  C-10 #1151468'
const FRAME_MS       = 1800   // hold time per frame
const FADE_MS        = 380    // cross-fade duration

// ─── Truck silhouette ─────────────────────────────────────────────────────────
function drawTruck(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  sc: number,
  accent: string,
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(sc, sc)

  // Bed
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.75
  ctx.beginPath()
  ctx.rect(-130, -24, 150, 54)
  ctx.fill()

  // Cab
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.moveTo(20, -24)
  ctx.lineTo(50, -54)
  ctx.lineTo(108, -54)
  ctx.lineTo(128, -24)
  ctx.lineTo(128, 30)
  ctx.lineTo(20, 30)
  ctx.closePath()
  ctx.fill()

  // Windshield
  ctx.fillStyle = 'rgba(30,60,100,0.55)'
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.moveTo(28, -22)
  ctx.lineTo(54, -50)
  ctx.lineTo(104, -50)
  ctx.lineTo(122, -22)
  ctx.closePath()
  ctx.fill()

  // Wheels
  ;[-82, 90].forEach((wx) => {
    ctx.fillStyle = '#111'
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.arc(wx, 36, 20, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = accent
    ctx.lineWidth = 3
    ctx.globalAlpha = 0.8
    ctx.beginPath()
    ctx.arc(wx, 36, 11, 0, Math.PI * 2)
    ctx.stroke()
    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(wx, 36)
      ctx.lineTo(wx + Math.cos(a) * 11, 36 + Math.sin(a) * 11)
      ctx.stroke()
    }
  })

  ctx.globalAlpha = 1
  ctx.restore()
}

// ─── Single frame draw ────────────────────────────────────────────────────────
function renderCarFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  frame: CarFrame,
  frameIndex: number,
  alpha: number,
) {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha

  // Black base
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  // Bottom-up accent gradient
  const grd = ctx.createLinearGradient(0, H, 0, H * 0.2)
  grd.addColorStop(0,   frame.accent2 + 'dd')
  grd.addColorStop(0.5, frame.accent1 + '33')
  grd.addColorStop(1,   'transparent')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, W, H)

  // Ghost year (background watermark)
  ctx.font        = `bold ${Math.round(H * 0.22)}px 'Courier New', monospace`
  ctx.textAlign   = 'center'
  ctx.fillStyle   = frame.accent1 + '18'
  ctx.fillText(frame.year, W * 0.5, H * 0.55)

  // Truck silhouette (right of center)
  const sc = (H * 0.30) / 80
  drawTruck(ctx, W * 0.62, H * 0.56, sc, frame.accent1)

  // Horizontal rule
  ctx.strokeStyle = frame.accent1 + '88'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(W * 0.06, H * 0.74)
  ctx.lineTo(W * 0.94, H * 0.74)
  ctx.stroke()

  // Year label
  ctx.font        = `bold ${Math.round(H * 0.072)}px 'Courier New', monospace`
  ctx.textAlign   = 'left'
  ctx.fillStyle   = frame.accent1
  ctx.shadowColor = frame.accent1
  ctx.shadowBlur  = 14
  ctx.fillText(frame.year, W * 0.07, H * 0.22)
  ctx.shadowBlur  = 0

  // Vehicle name
  ctx.font      = `${Math.round(H * 0.042)}px 'Courier New', monospace`
  ctx.fillStyle = '#ffffff'
  ctx.fillText(frame.vehicle, W * 0.07, H * 0.32)

  // Location / era
  ctx.font      = `${Math.round(H * 0.028)}px 'Courier New', monospace`
  ctx.fillStyle = '#aaaaaa'
  ctx.fillText(frame.line2, W * 0.07, H * 0.40)

  ctx.font      = `italic ${Math.round(H * 0.024)}px 'Courier New', monospace`
  ctx.fillStyle = '#777777'
  ctx.fillText(frame.line3, W * 0.07, H * 0.46)

  // Progress dots
  const dotSpan = CAR_FRAMES.length * 18
  const dotX0   = (W - dotSpan) * 0.5
  CAR_FRAMES.forEach((_, i) => {
    ctx.beginPath()
    ctx.arc(dotX0 + i * 18, H * 0.88, 4, 0, Math.PI * 2)
    ctx.fillStyle = i === frameIndex ? frame.accent1 : '#444'
    ctx.fill()
  })

  // Watermark
  ctx.font      = `${Math.round(H * 0.02)}px 'Courier New', monospace`
  ctx.textAlign = 'center'
  ctx.fillStyle = '#444444'
  ctx.fillText(WATERMARK, W * 0.5, H * 0.95)

  ctx.restore()
}

// ─── Component ────────────────────────────────────────────────────────────────
interface VisualCarReelProps {
  className?: string
  style?: React.CSSProperties
  onClose?: () => void
}

export default function VisualCarReel({ className = '', style, onClose }: VisualCarReelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef  = useRef({
    cur:        0,
    next:       1,
    fading:     false,
    lastSwitch: 0,
    running:    false,
    rafId:      0,
  })

  const loop = useCallback((ts: number) => {
    const s      = stateRef.current
    const canvas = canvasRef.current
    if (!canvas || !s.running) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const W   = canvas.width  / dpr
    const H   = canvas.height / dpr

    const elapsed = ts - s.lastSwitch

    // Trigger fade after hold time
    if (!s.fading && elapsed >= FRAME_MS) {
      s.fading     = true
      s.next       = (s.cur + 1) % CAR_FRAMES.length
      s.lastSwitch = ts
    }

    ctx.clearRect(0, 0, W, H)

    if (s.fading) {
      const p = Math.min((ts - s.lastSwitch) / FADE_MS, 1)
      renderCarFrame(ctx, W, H, CAR_FRAMES[s.cur],  s.cur,  1 - p)
      renderCarFrame(ctx, W, H, CAR_FRAMES[s.next], s.next, p)
      if (p >= 1) {
        s.cur        = s.next
        s.fading     = false
        s.lastSwitch = ts
      }
    } else {
      renderCarFrame(ctx, W, H, CAR_FRAMES[s.cur], s.cur, 1)
    }

    s.rafId = requestAnimationFrame(loop)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const s = stateRef.current

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
    s.running    = true
    s.lastSwitch = performance.now()
    s.rafId      = requestAnimationFrame(loop)

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    return () => {
      s.running = false
      cancelAnimationFrame(s.rafId)
      ro.disconnect()
    }
  }, [loop])

  return (
    <div
      className={className}
      style={{
        position:   'absolute',
        inset:      0,
        background: '#000',
        zIndex:     20,
        ...style,
      }}
    >
      {/* Close */}
      <button
        onClick={onClose}
        style={{
          position:    'absolute',
          top:         10,
          right:       14,
          zIndex:      30,
          background:  'rgba(0,0,0,0.65)',
          border:      '1px solid #555',
          color:       '#ccc',
          fontSize:    12,
          padding:     '3px 11px',
          cursor:      'pointer',
          fontFamily:  'Courier New, monospace',
          letterSpacing: '0.06em',
        }}
      >
        ✕ CLOSE
      </button>

      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  )
}
