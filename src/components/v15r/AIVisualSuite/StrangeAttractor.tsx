// @ts-nocheck
/**
 * StrangeAttractor — Lorenz / Rössler attractor visualization
 * B46 — AI Visual Suite | Visual 1
 *
 * Traces chaotic trajectories through phase space. Bass perturbs the
 * attractor parameters (sigma, rho, beta), mid controls trail length,
 * high adds chromatic velocity coloring, MTZ injects bifurcation jumps.
 */

import { useRef } from 'react'
import { useVisualEngine } from './useVisualEngine'
import type { VisualEngineProps } from './useVisualEngine'

interface Props extends VisualEngineProps {
  className?: string
  style?: React.CSSProperties
}

export default function StrangeAttractor({ bass = 0, mid = 0, high = 0, mtz = 0, hue = 200, className = '', style }: Props) {
  const propsRef = useRef({ bass, mid, high, mtz, hue })
  propsRef.current = { bass, mid, high, mtz, hue }

  // Lorenz state
  const stateRef = useRef({ x: 0.1, y: 0, z: 0, trail: [] as [number, number, number][] })

  const { canvasRef } = useVisualEngine((ctx, w, h, t) => {
    const { bass: b, mid: m, high: hi, mtz: z, hue: h0 } = propsRef.current
    ctx.fillStyle = 'rgba(2,4,14,0.12)'
    ctx.fillRect(0, 0, w, h)

    const { x: lx, y: ly, z: lz, trail } = stateRef.current

    // Lorenz parameters modulated by audio
    const sigma = 10 + b * 4
    const rho   = 28 + mtz * 12
    const beta  = 8 / 3 + m * 0.8

    const dt = 0.006
    const steps = 4 + Math.round(m * 6)
    let cx = lx, cy = ly, cz = lz

    for (let s = 0; s < steps; s++) {
      const dx = sigma * (cy - cx)
      const dy = cx * (rho - cz) - cy
      const dz = cx * cy - beta * cz
      cx += dx * dt; cy += dy * dt; cz += dz * dt
    }

    stateRef.current.x = cx; stateRef.current.y = cy; stateRef.current.z = cz

    const TRAIL = 400 + Math.round(m * 600)
    trail.push([cx, cy, cz])
    if (trail.length > TRAIL) trail.splice(0, trail.length - TRAIL)

    // MTZ bifurcation jump
    if (z > 0.5 && Math.random() < z * 0.08) {
      stateRef.current.x += (Math.random() - 0.5) * 10
      stateRef.current.y += (Math.random() - 0.5) * 10
    }

    const scale = Math.min(w, h) * 0.012
    const ocx = w * 0.5, ocy = h * 0.55

    ctx.lineCap = 'round'
    for (let i = 1; i < trail.length; i++) {
      const [ax, ay] = trail[i - 1]
      const [bx, by] = trail[i]
      const progress = i / trail.length
      const vel = Math.hypot(bx - ax, by - ay) * 5
      const hShift = h0 + hi * 80 * vel
      const alpha = progress * (0.5 + b * 0.4)
      ctx.strokeStyle = `hsla(${hShift % 360},85%,${55 + hi * 30}%,${alpha})`
      ctx.lineWidth = 0.8 + b * 1.2 * progress
      ctx.beginPath()
      ctx.moveTo(ocx + ax * scale, ocy + ay * scale * 0.6)
      ctx.lineTo(ocx + bx * scale, ocy + by * scale * 0.6)
      ctx.stroke()
    }

    // Current position glow
    const gx = ocx + cx * scale, gy = ocy + cy * scale * 0.6
    const gRad = ctx.createRadialGradient(gx, gy, 0, gx, gy, 12 + b * 10)
    gRad.addColorStop(0, `hsla(${h0},100%,90%,${0.8 + b * 0.2})`)
    gRad.addColorStop(1, 'transparent')
    ctx.fillStyle = gRad
    ctx.beginPath(); ctx.arc(gx, gy, 12 + b * 10, 0, Math.PI * 2); ctx.fill()
  })

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block', ...style }}
    />
  )
}
