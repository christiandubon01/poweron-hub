// @ts-nocheck
/**
 * ReactionDiffusion — Gray-Scott reaction-diffusion system
 * B46 — AI Visual Suite | Visual 5
 *
 * Simulates two chemicals (U and V) reacting and diffusing. Produces
 * organic-looking patterns: spots, stripes, labyrinthine networks.
 * Bass tweaks feed rate, mid tweaks kill rate, high adds hue shift,
 * MTZ injects seeds into the reaction field.
 */

import { useRef } from 'react'
import { useVisualEngine } from './useVisualEngine'
import type { VisualEngineProps } from './useVisualEngine'

interface Props extends VisualEngineProps {
  className?: string
  style?: React.CSSProperties
}

const SIM_W = 128, SIM_H = 96

export default function ReactionDiffusion({ bass = 0, mid = 0, high = 0, mtz = 0, hue = 30, className = '', style }: Props) {
  const propsRef   = useRef({ bass, mid, high, mtz, hue })
  propsRef.current = { bass, mid, high, mtz, hue }

  // U and V chemical grids
  const U = useRef<Float32Array>(new Float32Array(SIM_W * SIM_H).fill(1))
  const V = useRef<Float32Array>(new Float32Array(SIM_W * SIM_H))
  const initialized = useRef(false)
  const lastTick    = useRef(0)

  function seedSpot(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const r = ((cy + dy + SIM_H) % SIM_H) * SIM_W + (cx + dx + SIM_W) % SIM_W
      U.current[r] = 0.5; V.current[r] = 0.25
    }
  }

  if (!initialized.current) {
    initialized.current = true
    for (let i = 0; i < 6; i++) seedSpot(
      Math.floor(Math.random() * SIM_W),
      Math.floor(Math.random() * SIM_H)
    )
  }

  function simStep(feed: number, kill: number) {
    const u = U.current, v = V.current
    const nu = new Float32Array(u.length)
    const nv = new Float32Array(v.length)
    const Du = 0.21, Dv = 0.105

    for (let y = 0; y < SIM_H; y++) {
      for (let x = 0; x < SIM_W; x++) {
        const i = y * SIM_W + x
        const l = y * SIM_W + (x - 1 + SIM_W) % SIM_W
        const r = y * SIM_W + (x + 1) % SIM_W
        const t = ((y - 1 + SIM_H) % SIM_H) * SIM_W + x
        const b = ((y + 1) % SIM_H) * SIM_W + x

        const lapu = u[l] + u[r] + u[t] + u[b] - 4 * u[i]
        const lapv = v[l] + v[r] + v[t] + v[b] - 4 * v[i]
        const uvv  = u[i] * v[i] * v[i]

        nu[i] = Math.max(0, Math.min(1, u[i] + Du * lapu - uvv + feed * (1 - u[i])))
        nv[i] = Math.max(0, Math.min(1, v[i] + Dv * lapv + uvv - (kill + feed) * v[i]))
      }
    }
    U.current = nu; V.current = nv
  }

  const { canvasRef } = useVisualEngine((ctx, w, h, t) => {
    const { bass: b, mid: m, high: hi, mtz: z, hue: h0 } = propsRef.current

    const feed = 0.055 + b * 0.012
    const kill = 0.062 + m * 0.014

    const steps = t - lastTick.current > 0.05 ? 3 : 1
    for (let s = 0; s < steps; s++) simStep(feed, kill)
    lastTick.current = t

    // MTZ: random seed injection
    if (z > 0.4 && Math.random() < 0.15) {
      seedSpot(Math.floor(Math.random() * SIM_W), Math.floor(Math.random() * SIM_H))
    }

    // Render V field to screen
    const v = V.current
    const imgData = ctx.createImageData(w, h)
    const data = imgData.data

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const sx = Math.floor(px / w * SIM_W)
        const sy = Math.floor(py / h * SIM_H)
        const val = v[sy * SIM_W + sx]
        const hShift = (h0 + val * 180 * hi) % 360
        const L = 20 + val * 70
        const [R, G, B] = hslToRgb(hShift / 360, 0.8, L / 100)
        const idx = (py * w + px) * 4
        data[idx] = R; data[idx + 1] = G; data[idx + 2] = B; data[idx + 3] = 255
      }
    }
    ctx.putImageData(imgData, 0, 0)

    // Bass: brightness flash
    if (b > 0.3) {
      ctx.fillStyle = `rgba(255,255,255,${b * 0.06})`
      ctx.fillRect(0, 0, w, h)
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

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r, g, b
  if (s === 0) { r = g = b = l } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3)
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}
function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1; if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}
