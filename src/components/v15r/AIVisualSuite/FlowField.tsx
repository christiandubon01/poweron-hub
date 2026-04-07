// @ts-nocheck
/**
 * FlowField — Perlin noise vector field particle system
 * B46 — AI Visual Suite | Visual 6
 *
 * Thousands of particles follow a time-evolving noise vector field.
 * Bass increases particle speed and count, mid increases the noise
 * frequency (finer detail), high shifts chromatic temperature, MTZ
 * resets and reseeds the particle cloud.
 */

import { useRef } from 'react'
import { useVisualEngine } from './useVisualEngine'
import type { VisualEngineProps } from './useVisualEngine'

interface Props extends VisualEngineProps {
  className?: string
  style?: React.CSSProperties
}

// Simple value noise (fast, no external dependency)
function noise2(x: number, y: number): number {
  const X = Math.floor(x), Y = Math.floor(y)
  const xf = x - X, yf = y - Y
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const h = (n: number) => {
    let h = n * 127773 + 1
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff
  }
  const a = h(X + Y * 57), b = h(X + 1 + Y * 57), c = h(X + (Y + 1) * 57), d = h(X + 1 + (Y + 1) * 57)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

const MAX_PARTICLES = 800

interface Particle { x: number; y: number; age: number; hue: number }

export default function FlowField({ bass = 0, mid = 0, high = 0, mtz = 0, hue = 210, className = '', style }: Props) {
  const propsRef   = useRef({ bass, mid, high, mtz, hue })
  propsRef.current = { bass, mid, high, mtz, hue }

  const particles = useRef<Particle[]>([])

  function spawnParticle(w: number, h: number, baseHue: number): Particle {
    return { x: Math.random() * w, y: Math.random() * h, age: 0, hue: baseHue + (Math.random() - 0.5) * 40 }
  }

  const { canvasRef } = useVisualEngine((ctx, w, h, t) => {
    const { bass: b, mid: m, high: hi, mtz: z, hue: h0 } = propsRef.current

    ctx.fillStyle = `rgba(2,4,12,${0.12 + m * 0.05})`
    ctx.fillRect(0, 0, w, h)

    const targetCount = Math.round(200 + b * 400 + m * 200)
    const count       = Math.min(MAX_PARTICLES, targetCount)

    // MTZ: reseed
    if (z > 0.6 && Math.random() < 0.05) particles.current = []

    while (particles.current.length < count) particles.current.push(spawnParticle(w, h, h0))
    if (particles.current.length > count) particles.current.splice(count)

    const freq  = 0.003 + m * 0.004
    const speed = 1.2 + b * 3.5

    for (const p of particles.current) {
      const nx = noise2(p.x * freq + t * 0.2, p.y * freq)
      const ny = noise2(p.x * freq, p.y * freq + t * 0.2 + 100)
      const angle = nx * Math.PI * 4 + ny * Math.PI * 2

      const ox = p.x, oy = p.y
      p.x += Math.cos(angle) * speed
      p.y += Math.sin(angle) * speed
      p.age++

      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h || p.age > 200) {
        const np = spawnParticle(w, h, h0)
        p.x = np.x; p.y = np.y; p.age = 0; p.hue = np.hue
        continue
      }

      const alpha = Math.min(0.6, p.age / 30) * (0.4 + b * 0.4)
      const L     = 50 + hi * 30
      ctx.strokeStyle = `hsla(${(p.hue + hi * 60) % 360},80%,${L}%,${alpha})`
      ctx.lineWidth   = 0.8 + b * 0.8
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(p.x, p.y); ctx.stroke()
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
