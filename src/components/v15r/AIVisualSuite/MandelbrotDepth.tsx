// @ts-nocheck
/**
 * MandelbrotDepth — Animated Mandelbrot set depth explorer
 * B46 — AI Visual Suite | Visual 8
 *
 * Renders the Mandelbrot set with audio-reactive zoom, iteration depth,
 * and hue cycling. Bass drives zoom speed toward a fixed interest point,
 * mid increases max iterations (more detail), high adds escape-time
 * palette rotation, MTZ jumps to a new deep coordinate.
 */

import { useRef } from 'react'
import { useVisualEngine } from './useVisualEngine'
import type { VisualEngineProps } from './useVisualEngine'

interface Props extends VisualEngineProps {
  className?: string
  style?: React.CSSProperties
}

// Deep coordinates (known interesting points)
const DEEP_POINTS = [
  { re: -0.7269, im: 0.1889 },
  { re: -0.2756, im: 0.6578 },
  { re: -0.5251, im: 0.5255 },
  { re: -1.7683, im: 0.0 },
  { re: -0.1011, im: 0.9563 },
]

export default function MandelbrotDepth({ bass = 0, mid = 0, high = 0, mtz = 0, hue = 260, className = '', style }: Props) {
  const propsRef   = useRef({ bass, mid, high, mtz, hue })
  propsRef.current = { bass, mid, high, mtz, hue }

  const zoomRef  = useRef(1.0)
  const centerRef = useRef({ re: DEEP_POINTS[0].re, im: DEEP_POINTS[0].im })
  const pointIdx  = useRef(0)
  const lastMTZ   = useRef(0)
  const lastTick  = useRef(0)

  // Render at reduced resolution for performance
  const SIM_W = 160, SIM_H = 120

  const { canvasRef } = useVisualEngine((ctx, w, h, t) => {
    const { bass: b, mid: m, high: hi, mtz: z, hue: h0 } = propsRef.current

    // MTZ: jump to new deep coordinate
    if (z > 0.5 && t - lastMTZ.current > 1.5) {
      lastMTZ.current = t
      pointIdx.current = (pointIdx.current + 1) % DEEP_POINTS.length
      centerRef.current = { ...DEEP_POINTS[pointIdx.current] }
      zoomRef.current = 1.0
    }

    // Zoom in over time
    zoomRef.current *= (1 + (0.008 + b * 0.02))
    const scale = 3.0 / zoomRef.current

    if (t - lastTick.current < 0.05) return // throttle heavy render
    lastTick.current = t

    const maxIter = 60 + Math.round(m * 80)
    const imgData = ctx.createImageData(w, h)
    const data    = imgData.data
    const center  = centerRef.current

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        // Map pixel to complex plane
        const c_re = center.re + (px / w - 0.5) * scale * (w / h)
        const c_im = center.im + (py / h - 0.5) * scale

        let zr = 0, zi = 0, iter = 0
        while (zr * zr + zi * zi <= 4 && iter < maxIter) {
          const tmp = zr * zr - zi * zi + c_re
          zi = 2 * zr * zi + c_im
          zr = tmp
          iter++
        }

        const i = (py * w + px) * 4
        if (iter === maxIter) {
          data[i] = 5; data[i + 1] = 2; data[i + 2] = 20; data[i + 3] = 255
        } else {
          const smooth  = iter - Math.log2(Math.log2(zr * zr + zi * zi))
          const t2      = smooth / maxIter
          const hShift  = (h0 + t2 * 360 + hi * 120) % 360
          const [R, G, B] = hslToRgb(hShift / 360, 0.9, 0.1 + t2 * 0.7)
          data[i] = R; data[i + 1] = G; data[i + 2] = B; data[i + 3] = 255
        }
      }
    }

    ctx.putImageData(imgData, 0, 0)

    // Bass: edge bloom
    if (b > 0.2) {
      ctx.fillStyle = `rgba(255,255,255,${b * 0.04})`
      ctx.fillRect(0, 0, w, h)
    }

    // Zoom level HUD
    ctx.fillStyle = `rgba(${255}, ${255}, ${255}, 0.3)`
    ctx.font = '10px monospace'
    ctx.fillText(`×${zoomRef.current.toFixed(0)}`, 8, h - 8)
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
