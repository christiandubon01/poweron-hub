// @ts-nocheck
/**
 * NexusThreeOrb — Dense wireframe grid sphere with twisted waist distortion.
 *
 * Visual spec:
 *   - Latitude + longitude grid lines on sphere surface
 *   - Deep purple (#7c3aed) to electric blue (#2563eb) color gradient
 *   - Twisted waist: equatorial lines pinch inward creating hourglass distortion
 *   - Depth-based line opacity (front = bright, back = dim)
 *   - Slow idle Y-axis rotation
 *   - Pulse animation when responding (lines brighten, twist intensifies)
 *   - Fills container via ResizeObserver with setTransform (no scale stacking)
 *   - State-driven color shift: idle=purple, listening=blue, responding=white burst
 */

import { useEffect, useRef } from 'react'
import type { OrbState } from './NexusPresenceOrb'

export interface NexusThreeOrbProps {
  state?: OrbState
  className?: string
}

interface StateConfig {
  colorA: string   // inner/equator color
  colorB: string   // pole color
  glowColor: string
  rotSpeed: number
  pulse: boolean
  twistAmt: number // equatorial twist intensity 0..1
}

const STATE_CONFIG: Record<OrbState, StateConfig> = {
  inactive:     { colorA: '#7c3aed', colorB: '#2563eb', glowColor: 'rgba(124,58,237,0.18)',  rotSpeed: 0.004, pulse: false, twistAmt: 0.18 },
  listening:    { colorA: '#2563eb', colorB: '#06b6d4', glowColor: 'rgba(37,99,235,0.22)',   rotSpeed: 0.007, pulse: false, twistAmt: 0.22 },
  recording:    { colorA: '#2563eb', colorB: '#06b6d4', glowColor: 'rgba(6,182,212,0.28)',   rotSpeed: 0.010, pulse: true,  twistAmt: 0.28 },
  transcribing: { colorA: '#7c3aed', colorB: '#a855f7', glowColor: 'rgba(168,85,247,0.22)',  rotSpeed: 0.007, pulse: false, twistAmt: 0.20 },
  processing:   { colorA: '#4f46e5', colorB: '#7c3aed', glowColor: 'rgba(79,70,229,0.30)',   rotSpeed: 0.013, pulse: true,  twistAmt: 0.35 },
  responding:   { colorA: '#ffffff', colorB: '#a5f3fc', glowColor: 'rgba(165,243,252,0.40)', rotSpeed: 0.008, pulse: true,  twistAmt: 0.30 },
  complete:     { colorA: '#7c3aed', colorB: '#2563eb', glowColor: 'rgba(124,58,237,0.15)',  rotSpeed: 0.004, pulse: false, twistAmt: 0.18 },
  error:        { colorA: '#dc2626', colorB: '#f97316', glowColor: 'rgba(220,38,38,0.25)',   rotSpeed: 0.008, pulse: false, twistAmt: 0.15 },
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const bv = Math.round(b1 + (b2 - b1) * t)
  return `rgb(${r},${g},${bv})`
}

export function NexusThreeOrb({ state = 'inactive', className = '' }: NexusThreeOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef   = useRef<number>(0)
  const stateRef  = useRef<OrbState>(state)

  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    let W = canvas.clientWidth  || 300
    let H = canvas.clientHeight || 300

    function resizeCanvas() {
      W = canvas.clientWidth  || 300
      H = canvas.clientHeight || 300
      canvas.width  = W * dpr
      canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resizeCanvas()

    const ro = new ResizeObserver(() => resizeCanvas())
    ro.observe(canvas)

    // Grid resolution
    const LAT_LINES  = 18   // horizontal rings
    const LON_LINES  = 24   // vertical meridians
    const SEG        = 60   // segments per line for smooth curves

    let rotation   = 0
    let pulsePhase = 0

    function draw() {
      animRef.current = requestAnimationFrame(draw)
      const cfg = STATE_CONFIG[stateRef.current]
      const cx  = W / 2
      const cy  = H / 2
      const R   = Math.min(W, H) * 0.40

      rotation   += cfg.rotSpeed
      if (cfg.pulse) pulsePhase += 0.06
      const pulse = cfg.pulse ? Math.sin(pulsePhase) : 0
      const twist = cfg.twistAmt + (cfg.pulse ? Math.abs(pulse) * 0.12 : 0)

      ctx.clearRect(0, 0, W, H)

      // Outer glow
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.5)
      glow.addColorStop(0, cfg.glowColor)
      glow.addColorStop(0.5, cfg.glowColor.replace(/[\d.]+\)$/, '0.06)'))
      glow.addColorStop(1, 'transparent')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)

      // Inner core glow
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.25)
      core.addColorStop(0, cfg.colorA + '30')
      core.addColorStop(1, 'transparent')
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(cx, cy, R * 0.25, 0, Math.PI * 2)
      ctx.fill()

      const cosR = Math.cos(rotation)
      const sinR = Math.sin(rotation)

      // Project 3D point to 2D with Y-rotation + twist distortion
      function project(lat: number, lon: number): { x: number; y: number; depth: number } {
        // Apply twist: equatorial points are displaced in lon based on latitude
        // twist is strongest at equator (lat=PI/2), zero at poles
        const twistOffset = twist * Math.sin(lat) * Math.PI
        const tLon = lon + twistOffset + rotation

        const sinLat = Math.sin(lat)
        const cosLat = Math.cos(lat)
        const sinLon = Math.sin(tLon)
        const cosLon = Math.cos(tLon)

        // Sphere point
        const px = sinLat * cosLon
        const py = Math.cos(lat)
        const pz = sinLat * sinLon

        // Y-axis rotation
        const rx = px * cosR + pz * sinR
        const rz = -px * sinR + pz * cosR

        const depth = (rz + 1.8) / 2.8  // [0.0 .. 1.0]
        return {
          x: cx + rx * R,
          y: cy + py * R,
          depth,
        }
      }

      ctx.lineWidth = 0.6

      // Draw latitude lines (horizontal rings)
      for (let i = 0; i <= LAT_LINES; i++) {
        const lat = (i / LAT_LINES) * Math.PI  // 0 (north pole) to PI (south pole)
        // Color: poles = colorB, equator = colorA
        const t = Math.abs(Math.sin(lat))      // 0 at poles, 1 at equator
        const lineColor = lerpColor(cfg.colorB, cfg.colorA, t)

        ctx.beginPath()
        let started = false
        for (let s = 0; s <= SEG; s++) {
          const lon = (s / SEG) * Math.PI * 2
          const p = project(lat, lon)
          if (p.depth < 0.05) { started = false; continue }
          const alpha = Math.max(0.05, p.depth * 0.85 + (cfg.pulse ? Math.abs(pulse) * 0.15 : 0))
          ctx.strokeStyle = lineColor
          ctx.globalAlpha = alpha
          if (!started) { ctx.moveTo(p.x, p.y); started = true }
          else ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
      }

      // Draw longitude lines (vertical meridians)
      for (let i = 0; i < LON_LINES; i++) {
        const lon = (i / LON_LINES) * Math.PI * 2

        ctx.beginPath()
        let started = false
        for (let s = 0; s <= SEG; s++) {
          const lat = (s / SEG) * Math.PI
          const t = Math.abs(Math.sin(lat))
          const lineColor = lerpColor(cfg.colorB, cfg.colorA, t)
          const p = project(lat, lon)
          if (p.depth < 0.05) { started = false; continue }
          const alpha = Math.max(0.05, p.depth * 0.75 + (cfg.pulse ? Math.abs(pulse) * 0.15 : 0))
          ctx.strokeStyle = lineColor
          ctx.globalAlpha = alpha
          if (!started) { ctx.moveTo(p.x, p.y); started = true }
          else ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
      }

      ctx.globalAlpha = 1
    }

    draw()

    return () => {
      cancelAnimationFrame(animRef.current)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden="true"
    />
  )
}

export default NexusThreeOrb
