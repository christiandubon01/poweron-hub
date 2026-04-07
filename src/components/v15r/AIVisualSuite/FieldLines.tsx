// @ts-nocheck
/**
 * FieldLines — Electromagnetic / gravitational field line renderer
 * B46 — AI Visual Suite | Visual 4
 *
 * Traces field lines from audio-reactive charge sources. Bass drives
 * charge magnitude (line curvature), mid adds charge count, high adds
 * chromatic aberration along field gradients, MTZ flips polarity.
 */

import { useRef } from 'react'
import { useVisualEngine } from './useVisualEngine'
import type { VisualEngineProps } from './useVisualEngine'

interface Props extends VisualEngineProps {
  className?: string
  style?: React.CSSProperties
}

interface Charge { x: number; y: number; q: number; hue: number }

export default function FieldLines({ bass = 0, mid = 0, high = 0, mtz = 0, hue = 60, className = '', style }: Props) {
  const propsRef   = useRef({ bass, mid, high, mtz, hue })
  propsRef.current = { bass, mid, high, mtz, hue }
  const timeRef2   = useRef(0)

  const { canvasRef } = useVisualEngine((ctx, w, h, t) => {
    const { bass: b, mid: m, high: hi, mtz: z, hue: h0 } = propsRef.current
    ctx.fillStyle = 'rgba(4,4,2,0.18)'
    ctx.fillRect(0, 0, w, h)

    timeRef2.current = t

    const chargeCount = 2 + Math.round(m * 4)
    const charges: Charge[] = []
    for (let i = 0; i < chargeCount; i++) {
      const angle = t * (0.12 + i * 0.07) + (i / chargeCount) * Math.PI * 2
      const orbit = Math.min(w, h) * (0.18 + i * 0.06)
      charges.push({
        x: w * 0.5 + Math.cos(angle) * orbit,
        y: h * 0.5 + Math.sin(angle) * orbit * 0.7,
        q: (i % 2 === 0 ? 1 : -1) * (1 + b * 2) * (z > 0.5 ? -1 : 1),
        hue: h0 + i * (360 / chargeCount),
      })
    }

    // Field line tracer
    const linesPerCharge = 8 + Math.round(b * 6)
    for (const charge of charges) {
      if (charge.q <= 0) continue
      for (let l = 0; l < linesPerCharge; l++) {
        const angle = (l / linesPerCharge) * Math.PI * 2
        let px = charge.x + Math.cos(angle) * 6
        let py = charge.y + Math.sin(angle) * 6

        ctx.beginPath()
        ctx.moveTo(px, py)

        for (let step = 0; step < 200; step++) {
          let fx = 0, fy = 0
          for (const c of charges) {
            const dx = px - c.x, dy = py - c.y
            const dist2 = Math.max(4, dx * dx + dy * dy)
            const dist  = Math.sqrt(dist2)
            const force = c.q * 500 / dist2
            fx += force * dx / dist
            fy += force * dy / dist
          }
          const fmag = Math.hypot(fx, fy) || 1
          px += (fx / fmag) * 2.5
          py += (fy / fmag) * 2.5
          ctx.lineTo(px, py)

          if (px < 0 || px > w || py < 0 || py > h) break
          const onSink = charges.some(c => c.q < 0 && Math.hypot(px - c.x, py - c.y) < 10)
          if (onSink) break
        }

        const progress = l / linesPerCharge
        const lineHue  = charge.hue + hi * 40 * progress
        ctx.strokeStyle = `hsla(${lineHue % 360},85%,${55 + hi * 25}%,${0.3 + b * 0.3})`
        ctx.lineWidth = 0.8 + b * 0.8
        ctx.stroke()
      }
    }

    // Charge glows
    for (const charge of charges) {
      const gR  = 12 + b * 16
      const g   = ctx.createRadialGradient(charge.x, charge.y, 0, charge.x, charge.y, gR)
      const col = charge.q > 0 ? `${charge.hue % 360},90%,70%` : `${(charge.hue + 180) % 360},90%,70%`
      g.addColorStop(0, `hsla(${col},${0.7 + b * 0.3})`)
      g.addColorStop(1, 'transparent')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(charge.x, charge.y, gR, 0, Math.PI * 2); ctx.fill()
    }
  })

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block', ...style }}
    />
  )
}
