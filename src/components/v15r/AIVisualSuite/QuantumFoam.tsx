// @ts-nocheck
/**
 * QuantumFoam — Planck scale wave function renderer
 * B46 — AI Visual Suite | Visual 0 (default NEXUS orb)
 *
 * Simulates quantum vacuum fluctuations: a churning probabilistic foam
 * of interference patterns and Planck-scale geometry. Bass drives bubble
 * intensity, mid drives the fractal depth, high drives chromatic fringing,
 * MTZ adds non-locality bursts across the field.
 */

import { useRef } from 'react'
import { useVisualEngine } from './useVisualEngine'
import type { VisualEngineProps } from './useVisualEngine'

interface Props extends VisualEngineProps {
  className?: string
  style?: React.CSSProperties
}

export default function QuantumFoam({ bass = 0, mid = 0, high = 0, mtz = 0, hue = 160, className = '', style }: Props) {
  const propsRef = useRef({ bass, mid, high, mtz, hue })
  propsRef.current = { bass, mid, high, mtz, hue }

  const { canvasRef } = useVisualEngine((ctx, w, h, t) => {
    const { bass: b, mid: m, high: hi, mtz: z, hue: h0 } = propsRef.current
    ctx.fillStyle = 'rgba(2,4,12,0.18)'
    ctx.fillRect(0, 0, w, h)

    const cx = w * 0.5, cy = h * 0.5
    const depth = 5 + Math.round(m * 4)
    const bubbleCount = 60 + Math.round(b * 60)
    const R = Math.min(w, h) * 0.42

    // Planck foam: overlapping probability bubbles
    for (let i = 0; i < bubbleCount; i++) {
      const seed = i * 1.618 + t * (0.08 + b * 0.18)
      const theta = seed * 2.399963 // golden angle
      const phi   = Math.acos(1 - 2 * ((i + 0.5) / bubbleCount))
      const r     = R * (0.4 + 0.6 * Math.abs(Math.sin(seed * 3.7 + t)))
      const x = cx + r * Math.sin(phi) * Math.cos(theta)
      const y = cy + r * Math.sin(phi) * Math.sin(theta) * 0.6
      const radius = (2 + b * 6 + m * 3) * (0.5 + Math.abs(Math.sin(seed * 7.1 + t * 1.3)))
      const alpha  = 0.08 + hi * 0.12 + Math.abs(Math.sin(seed * 2.3 + t * 0.7)) * 0.08
      const hShift = h0 + i * (360 / bubbleCount) * 0.15 + hi * 60

      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius * 2)
      grad.addColorStop(0, `hsla(${hShift % 360},90%,70%,${alpha})`)
      grad.addColorStop(1, 'transparent')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, radius * 2, 0, Math.PI * 2)
      ctx.fill()
    }

    // Wave function interference pattern (mid frequencies)
    if (m > 0.05) {
      for (let d = 0; d < depth; d++) {
        const phase = t * (0.6 + d * 0.18) + d
        const amp   = (R * 0.3) * m * (1 - d / depth)
        const segs  = 200
        ctx.beginPath()
        for (let j = 0; j <= segs; j++) {
          const a  = (j / segs) * Math.PI * 2
          const rr = R * 0.3 + amp * Math.sin(a * (3 + d) + phase) * Math.cos(a * (2 + d) - phase * 0.7)
          const px = cx + rr * Math.cos(a)
          const py = cy + rr * Math.sin(a) * 0.6
          j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.strokeStyle = `hsla(${(h0 + d * 25) % 360},80%,60%,${0.06 + m * 0.08})`
        ctx.lineWidth = 0.6
        ctx.stroke()
      }
    }

    // MTZ: non-locality flash bursts
    if (z > 0.15) {
      const bursts = Math.round(z * 8)
      for (let i = 0; i < bursts; i++) {
        const bx = Math.random() * w
        const by = Math.random() * h
        const br = 4 + Math.random() * 20 * z
        const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br)
        bg.addColorStop(0, `hsla(${h0 + 180},100%,90%,${z * 0.5})`)
        bg.addColorStop(1, 'transparent')
        ctx.fillStyle = bg
        ctx.beginPath()
        ctx.arc(bx, by, br, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Core orb glow
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.25)
    coreGrad.addColorStop(0, `hsla(${h0},90%,80%,${0.18 + b * 0.2})`)
    coreGrad.addColorStop(0.5, `hsla(${h0},70%,50%,${0.06 + b * 0.08})`)
    coreGrad.addColorStop(1, 'transparent')
    ctx.fillStyle = coreGrad
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.25, 0, Math.PI * 2)
    ctx.fill()
  })

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block', ...style }}
    />
  )
}
