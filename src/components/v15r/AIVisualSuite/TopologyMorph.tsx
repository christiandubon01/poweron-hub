// @ts-nocheck
/**
 * TopologyMorph — Genus-morphing surface topology renderer
 * B46 — AI Visual Suite | Visual 9
 *
 * Renders a parametric surface that continuously morphs between different
 * topological forms (torus, sphere, Klein-inspired shape). Bass drives
 * the morph speed, mid controls surface complexity, high adds iridescent
 * shading, MTZ triggers genus-jump discontinuities.
 */

import { useRef } from 'react'
import { useVisualEngine } from './useVisualEngine'
import type { VisualEngineProps } from './useVisualEngine'

interface Props extends VisualEngineProps {
  className?: string
  style?: React.CSSProperties
}

export default function TopologyMorph({ bass = 0, mid = 0, high = 0, mtz = 0, hue = 310, className = '', style }: Props) {
  const propsRef   = useRef({ bass, mid, high, mtz, hue })
  propsRef.current = { bass, mid, high, mtz, hue }

  const morphRef  = useRef(0)
  const rotXRef   = useRef(0)
  const rotYRef   = useRef(0)

  const { canvasRef } = useVisualEngine((ctx, w, h, t) => {
    const { bass: b, mid: m, high: hi, mtz: z, hue: h0 } = propsRef.current
    ctx.fillStyle = 'rgba(6,2,14,0.2)'
    ctx.fillRect(0, 0, w, h)

    morphRef.current  += 0.006 + b * 0.015
    rotXRef.current   += 0.008 + m * 0.006
    rotYRef.current   += 0.012 + b * 0.01

    const morph = morphRef.current
    const cx = w * 0.5, cy = h * 0.5
    const scale = Math.min(w, h) * 0.28
    const res = 24 + Math.round(m * 16)

    // Morphing between torus and sphere by blending R2 parameter
    const R1 = 1.0, R2 = 0.5 + Math.sin(morph * 0.4 + z * 2) * 0.45
    const pointGrid: [number, number, number][][] = []

    for (let i = 0; i <= res; i++) {
      const u = (i / res) * Math.PI * 2
      const row: [number, number, number][] = []
      for (let j = 0; j <= res; j++) {
        const v = (j / res) * Math.PI * 2
        // Parametric torus-sphere blend
        const R = R1 + R2 * Math.cos(v + morph * 0.3)
        let x = R * Math.cos(u)
        let y = R * Math.sin(u)
        let z3 = R2 * Math.sin(v + morph * 0.3)

        // MTZ: Klein-bottle twist injection
        if (z > 0.4) {
          const twist = z * Math.sin(u * 2 + morph)
          x += twist * 0.2
          z3 += twist * 0.15
        }

        // 3D rotation
        const cosX = Math.cos(rotXRef.current), sinX = Math.sin(rotXRef.current)
        const cosY = Math.cos(rotYRef.current), sinY = Math.sin(rotYRef.current)
        const y2 = y * cosX - z3 * sinX
        const z2 = y * sinX + z3 * cosX
        const x2 = x * cosY + z2 * sinY
        const z4 = -x * sinY + z2 * cosY

        row.push([x2, y2, z4])
      }
      pointGrid.push(row)
    }

    // Project and draw grid quads
    for (let i = 0; i < res; i++) {
      for (let j = 0; j < res; j++) {
        const [x0, y0, z0] = pointGrid[i][j]
        const [x1, y1, z1] = pointGrid[i + 1][j]
        const [x2, y2, z2] = pointGrid[i + 1][j + 1]
        const [x3, y3, z3] = pointGrid[i][j + 1]

        const avgZ = (z0 + z1 + z2 + z3) / 4
        const depth = (avgZ + 2) / 4

        // Normal-based shading
        const dx1 = x1 - x0, dy1 = y1 - y0, dz1 = z1 - z0
        const dx2 = x3 - x0, dy2 = y3 - y0, dz2 = z3 - z0
        const nx = dy1 * dz2 - dz1 * dy2
        const ny = dz1 * dx2 - dx1 * dz2
        const nz = dx1 * dy2 - dy1 * dx2
        const nlen = Math.hypot(nx, ny, nz) || 1
        const dot = Math.abs((nx / nlen) * 0.577 + (ny / nlen) * 0.577 + (nz / nlen) * 0.577)

        const hShift = h0 + depth * 80 * (1 + hi) + i * (360 / res) * hi * 0.3
        const L = 15 + dot * 45 + hi * 25
        const alpha = 0.3 + depth * 0.4 + b * 0.15

        const proj = ([x, y, _z]: [number, number, number]) => [
          cx + x * scale * (1 + 0.3 * depth),
          cy + y * scale * (1 + 0.3 * depth),
        ]

        const [px0, py0] = proj(pointGrid[i][j])
        const [px1, py1] = proj(pointGrid[i + 1][j])
        const [px2, py2] = proj(pointGrid[i + 1][j + 1])
        const [px3, py3] = proj(pointGrid[i][j + 1])

        ctx.beginPath()
        ctx.moveTo(px0, py0); ctx.lineTo(px1, py1); ctx.lineTo(px2, py2); ctx.lineTo(px3, py3)
        ctx.closePath()
        ctx.strokeStyle = `hsla(${hShift % 360},80%,${L}%,${alpha * 0.6})`
        ctx.lineWidth = 0.4
        ctx.stroke()
      }
    }

    // Center glow
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.4)
    cg.addColorStop(0, `hsla(${h0},90%,80%,${0.12 + b * 0.1})`)
    cg.addColorStop(1, 'transparent')
    ctx.fillStyle = cg
    ctx.beginPath(); ctx.arc(cx, cy, scale * 0.4, 0, Math.PI * 2); ctx.fill()
  })

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block', ...style }}
    />
  )
}
