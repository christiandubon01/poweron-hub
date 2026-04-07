// @ts-nocheck
/**
 * FourierEpicycles — Rotating circle Fourier series visualizer
 * B46 — AI Visual Suite | Visual 7
 *
 * Decomposes a target shape into epicycles (rotating circles), drawing
 * the trace of the tip. Bass drives rotation speed, mid adds more
 * epicycle terms (frequency resolution), high adds chromatic trace,
 * MTZ morphs the target path.
 */

import { useRef } from 'react'
import { useVisualEngine } from './useVisualEngine'
import type { VisualEngineProps } from './useVisualEngine'

interface Props extends VisualEngineProps {
  className?: string
  style?: React.CSSProperties
}

interface Epicycle { freq: number; amp: number; phase: number }

function buildEpicycles(n: number, mtz: number): Epicycle[] {
  // Approximate an interesting closed curve (Lissajous + morphed heart)
  return Array.from({ length: n }, (_, k) => ({
    freq:  k + 1,
    amp:   (1 / (k + 1)) * (0.5 + Math.sin(k * 1.3 + mtz * Math.PI) * 0.5),
    phase: k * 0.8,
  }))
}

export default function FourierEpicycles({ bass = 0, mid = 0, high = 0, mtz = 0, hue = 240, className = '', style }: Props) {
  const propsRef   = useRef({ bass, mid, high, mtz, hue })
  propsRef.current = { bass, mid, high, mtz, hue }

  const trailRef   = useRef<[number, number][]>([])
  const phaseRef   = useRef(0)

  const { canvasRef } = useVisualEngine((ctx, w, h, t) => {
    const { bass: b, mid: m, high: hi, mtz: z, hue: h0 } = propsRef.current
    ctx.fillStyle = 'rgba(4,4,16,0.15)'
    ctx.fillRect(0, 0, w, h)

    const cx = w * 0.5, cy = h * 0.5
    const R  = Math.min(w, h) * 0.35
    const terms = 3 + Math.round(m * 9)
    const speed = 0.4 + b * 1.2

    phaseRef.current += speed * 0.016

    const cycles = buildEpicycles(terms, z)

    let px = cx, py = cy
    ctx.strokeStyle = `hsla(${h0},40%,40%,0.2)`
    ctx.lineWidth   = 0.5

    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i]
      const angle = c.freq * phaseRef.current + c.phase
      const r = c.amp * R

      // Draw the circle
      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.strokeStyle = `hsla(${(h0 + i * 20) % 360},50%,${40 + hi * 20}%,${0.15 + m * 0.15})`
      ctx.stroke()

      // Arrow to next point
      const nx = px + r * Math.cos(angle)
      const ny = py + r * Math.sin(angle)
      ctx.beginPath()
      ctx.moveTo(px, py); ctx.lineTo(nx, ny)
      ctx.strokeStyle = `hsla(${(h0 + i * 20) % 360},80%,60%,${0.4 + b * 0.3})`
      ctx.lineWidth = 1 + b * 0.5
      ctx.stroke()

      px = nx; py = ny
    }

    // Record tip
    trailRef.current.push([px, py])
    const maxTrail = 400 + Math.round(m * 400)
    if (trailRef.current.length > maxTrail) trailRef.current.splice(0, trailRef.current.length - maxTrail)

    // Draw trace
    if (trailRef.current.length > 1) {
      ctx.lineWidth = 1.5 + b * 1.5
      ctx.lineCap   = 'round'
      for (let i = 1; i < trailRef.current.length; i++) {
        const progress = i / trailRef.current.length
        const hShift   = h0 + hi * 80 * progress
        ctx.strokeStyle = `hsla(${hShift % 360},90%,${55 + hi * 25}%,${progress * 0.8})`
        ctx.beginPath()
        ctx.moveTo(trailRef.current[i - 1][0], trailRef.current[i - 1][1])
        ctx.lineTo(trailRef.current[i][0], trailRef.current[i][1])
        ctx.stroke()
      }
    }

    // Tip glow
    const tg = ctx.createRadialGradient(px, py, 0, px, py, 8 + b * 10)
    tg.addColorStop(0, `hsla(${h0},100%,90%,0.9)`)
    tg.addColorStop(1, 'transparent')
    ctx.fillStyle = tg
    ctx.beginPath(); ctx.arc(px, py, 8 + b * 10, 0, Math.PI * 2); ctx.fill()
  })

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block', ...style }}
    />
  )
}
