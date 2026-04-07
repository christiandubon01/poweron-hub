// @ts-nocheck
/**
 * HyperbolicSpace — Poincaré disk / hyperbolic geometry tiles
 * B46 — AI Visual Suite | Visual 2
 *
 * Renders the infinite hyperbolic plane projected into a unit disk.
 * Bass drives the geodesic density, mid controls tessellation depth,
 * high adds iridescent edge coloring, MTZ triggers Möbius transformations.
 */

import { useRef } from 'react'
import { useVisualEngine } from './useVisualEngine'
import type { VisualEngineProps } from './useVisualEngine'

interface Props extends VisualEngineProps {
  className?: string
  style?: React.CSSProperties
}

function drawGeodesic(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, R: number,
  a: number, b: number, t: number, hue: number, alpha: number
) {
  // Geodesic arc in Poincaré disk
  const x1 = Math.cos(a), y1 = Math.sin(a)
  const x2 = Math.cos(b), y2 = Math.sin(b)

  // Center of the geodesic circle (Euclidean)
  const d  = x1 * y2 - x2 * y1
  if (Math.abs(d) < 0.001) {
    // Diameter
    ctx.beginPath()
    ctx.moveTo(cx + x1 * R, cy + y1 * R)
    ctx.lineTo(cx + x2 * R, cy + y2 * R)
    ctx.strokeStyle = `hsla(${hue % 360},80%,60%,${alpha})`
    ctx.lineWidth = 0.8
    ctx.stroke()
    return
  }
  const ox = (y2 - y1) / (2 * d)
  const oy = (x1 - x2) / (2 * d)
  const r  = Math.hypot(x1 - ox, y1 - oy)

  const startAngle = Math.atan2(y1 - oy, x1 - ox)
  const endAngle   = Math.atan2(y2 - oy, x2 - ox)

  ctx.beginPath()
  ctx.arc(cx + ox * R, cy + oy * R, r * R, startAngle, endAngle, d < 0)
  ctx.strokeStyle = `hsla(${hue % 360},80%,60%,${alpha})`
  ctx.lineWidth = 0.7
  ctx.stroke()
}

export default function HyperbolicSpace({ bass = 0, mid = 0, high = 0, mtz = 0, hue = 280, className = '', style }: Props) {
  const propsRef = useRef({ bass, mid, high, mtz, hue })
  propsRef.current = { bass, mid, high, mtz, hue }
  const offsetRef = useRef(0)

  const { canvasRef } = useVisualEngine((ctx, w, h, t) => {
    const { bass: b, mid: m, high: hi, mtz: z, hue: h0 } = propsRef.current
    ctx.fillStyle = 'rgba(4,2,14,0.15)'
    ctx.fillRect(0, 0, w, h)

    offsetRef.current += 0.004 + b * 0.008 + mtz * 0.02
    const offset = offsetRef.current

    const cx = w * 0.5, cy = h * 0.5
    const R  = Math.min(w, h) * 0.44

    // Disk boundary
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.strokeStyle = `hsla(${h0},60%,40%,0.3)`
    ctx.lineWidth = 1
    ctx.stroke()

    const lines = 6 + Math.round(b * 6)
    const depth = 2 + Math.round(m * 3)

    // Geodesic tessellation
    for (let d = 0; d < depth; d++) {
      for (let i = 0; i < lines; i++) {
        const a = offset + (i / lines) * Math.PI * 2
        const b2 = offset + ((i + 1) / lines) * Math.PI * 2
        const hShift = h0 + d * 40 + i * (360 / lines) * hi
        const alpha  = (0.2 - d * 0.04) * (1 + b * 0.4)
        drawGeodesic(ctx, cx, cy, R, a + d * 0.3, b2 - d * 0.15, t, hShift, alpha)
        if (d > 0) {
          drawGeodesic(ctx, cx, cy, R, a + d * 0.15, b2 + d * 0.3, t, hShift + 30, alpha * 0.6)
        }
      }
    }

    // Möbius pulse when MTZ fires
    if (z > 0.3) {
      for (let r = 1; r <= 3; r++) {
        const rr = R * r * 0.28 * z
        ctx.beginPath()
        ctx.arc(cx, cy, rr, 0, Math.PI * 2)
        ctx.strokeStyle = `hsla(${h0 + 120},90%,70%,${z * 0.3})`
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }

    // Center glow
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.15)
    cg.addColorStop(0, `hsla(${h0},90%,80%,${0.2 + b * 0.2})`)
    cg.addColorStop(1, 'transparent')
    ctx.fillStyle = cg
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.15, 0, Math.PI * 2); ctx.fill()
  })

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block', ...style }}
    />
  )
}
