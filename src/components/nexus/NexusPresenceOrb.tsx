// @ts-nocheck
/**
 * NexusPresenceOrb — Canvas-based particle network sphere (Jarvis-style)
 *
 * Pure visual component — zero business logic, no transcript state.
 * Renders a 3D rotating particle network sphere on <canvas>.
 * Particles are connected by proximity lines, colors shift per voice state.
 *
 * Visual states:
 *   inactive    — slow rotation, dim green/teal nodes
 *   listening   — medium rotation, brighter cyan
 *   recording   — faster, red-tinted, intense glow
 *   transcribing — scanning yellow, medium speed
 *   processing  — purple orbit, fast rotation
 *   responding  — bright green/teal waveform pulsing
 *   complete    — settling back to dim green
 *   error       — orange flicker
 */

import { useEffect, useRef } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export type OrbState =
  | 'inactive'
  | 'listening'
  | 'recording'
  | 'transcribing'
  | 'processing'
  | 'responding'
  | 'complete'
  | 'error'

export interface NexusPresenceOrbProps {
  state?: OrbState
  size?: number
  className?: string
}

// ── Particle type ──────────────────────────────────────────────────────────

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  size: number
}

// ── State-driven color palette ─────────────────────────────────────────────

const STATE_COLORS: Record<OrbState, { primary: string; secondary: string; glow: string }> = {
  inactive:     { primary: '#2EE89A', secondary: '#1a8f60', glow: 'rgba(46,232,154,0.15)' },
  listening:    { primary: '#40D4FF', secondary: '#1a8fa0', glow: 'rgba(64,212,255,0.25)' },
  recording:    { primary: '#FF5060', secondary: '#a01a20', glow: 'rgba(255,80,96,0.35)' },
  transcribing: { primary: '#FFD24A', secondary: '#a08010', glow: 'rgba(255,210,74,0.25)' },
  processing:   { primary: '#AA6EFF', secondary: '#6030c0', glow: 'rgba(170,110,255,0.35)' },
  responding:   { primary: '#2EE89A', secondary: '#1a8f60', glow: 'rgba(46,232,154,0.5)' },
  complete:     { primary: '#2EE89A', secondary: '#1a8f60', glow: 'rgba(46,232,154,0.2)' },
  error:        { primary: '#FF9040', secondary: '#a04010', glow: 'rgba(255,144,64,0.3)' },
}

// ── Speed per state ────────────────────────────────────────────────────────

const SPEED_MAP: Record<OrbState, number> = {
  inactive:     0.003,
  listening:    0.006,
  recording:    0.012,
  transcribing: 0.008,
  processing:   0.015,
  responding:   0.01,
  complete:     0.003,
  error:        0.008,
}

// ── Component ──────────────────────────────────────────────────────────────

export function NexusPresenceOrb({
  state = 'inactive',
  size: sizeProp,
  className = '',
}: NexusPresenceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const particlesRef = useRef<Particle[]>([])
  const rotationRef = useRef(0)
  const stateRef = useRef<OrbState>(state)

  // Keep stateRef in sync so the animation loop sees the latest value
  useEffect(() => {
    stateRef.current = state
  }, [state])

  console.log('[Orb] Rendering with state:', state)

  useEffect(() => {
    console.log('[Orb] Mounted with state:', state)
  }, [])

  useEffect(() => {
    console.log('[Orb] State changed:', state)
  }, [state])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Use 2x resolution for Retina
    const dpr = window.devicePixelRatio || 1
    const canvasSize = sizeProp || 200
    canvas.width = canvasSize * dpr
    canvas.height = canvasSize * dpr
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    ctx.scale(dpr, dpr)

    const sz = canvasSize
    const cx = sz / 2
    const cy = sz / 2
    const radius = sz * 0.35
    const numParticles = 80

    // Generate particles on sphere surface (once)
    if (particlesRef.current.length === 0) {
      for (let i = 0; i < numParticles; i++) {
        const theta = Math.acos(2 * Math.random() - 1)
        const phi = Math.random() * Math.PI * 2
        particlesRef.current.push({
          x: Math.sin(theta) * Math.cos(phi),
          y: Math.sin(theta) * Math.sin(phi),
          z: Math.cos(theta),
          vx: (Math.random() - 0.5) * 0.002,
          vy: (Math.random() - 0.5) * 0.002,
          vz: (Math.random() - 0.5) * 0.002,
          size: Math.random() * 2 + 1,
        })
      }
    }

    const draw = () => {
      const currentState = stateRef.current
      const colors = STATE_COLORS[currentState]
      const speed = SPEED_MAP[currentState]
      rotationRef.current += speed

      ctx.clearRect(0, 0, sz, sz)

      // Background radial glow
      const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.4)
      glowGrad.addColorStop(0, colors.glow)
      glowGrad.addColorStop(1, 'transparent')
      ctx.fillStyle = glowGrad
      ctx.fillRect(0, 0, sz, sz)

      // Core inner glow
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.3)
      coreGrad.addColorStop(0, colors.primary + '40')
      coreGrad.addColorStop(1, 'transparent')
      ctx.fillStyle = coreGrad
      ctx.beginPath()
      ctx.arc(cx, cy, radius * 0.3, 0, Math.PI * 2)
      ctx.fill()

      // Project 3D particles to 2D with Y-axis rotation
      const cosR = Math.cos(rotationRef.current)
      const sinR = Math.sin(rotationRef.current)

      const projected = particlesRef.current.map(p => {
        // Rotate around Y axis
        const rx = p.x * cosR - p.z * sinR
        const rz = p.x * sinR + p.z * cosR
        const scale = (rz + 2) / 3 // depth factor [0.33 .. 1.0]
        return {
          sx: cx + rx * radius,
          sy: cy + p.y * radius,
          scale,
          size: p.size,
          visible: rz > -0.5,
        }
      })

      // Draw connection lines between nearby visible particles
      ctx.lineWidth = 0.4
      const connDist = radius * 0.55
      for (let i = 0; i < projected.length; i++) {
        if (!projected[i].visible) continue
        for (let j = i + 1; j < projected.length; j++) {
          if (!projected[j].visible) continue
          const dx = projected[i].sx - projected[j].sx
          const dy = projected[i].sy - projected[j].sy
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < connDist) {
            const opacity = (1 - dist / connDist) * 0.4 * projected[i].scale * projected[j].scale
            const alpha = Math.min(255, Math.floor(opacity * 255))
            ctx.strokeStyle = colors.primary + alpha.toString(16).padStart(2, '0')
            ctx.beginPath()
            ctx.moveTo(projected[i].sx, projected[i].sy)
            ctx.lineTo(projected[j].sx, projected[j].sy)
            ctx.stroke()
          }
        }
      }

      // Draw particle nodes with glow
      projected.forEach(p => {
        if (!p.visible) return
        const nodeSize = p.size * p.scale

        // Node glow halo
        const nodeGlow = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, nodeSize * 3)
        nodeGlow.addColorStop(0, colors.primary)
        nodeGlow.addColorStop(0.4, colors.primary + '80')
        nodeGlow.addColorStop(1, 'transparent')
        ctx.fillStyle = nodeGlow
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, nodeSize * 3, 0, Math.PI * 2)
        ctx.fill()

        // Solid node center
        ctx.fillStyle = colors.primary
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, nodeSize, 0, Math.PI * 2)
        ctx.fill()
      })

      animRef.current = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animRef.current)
  }, [sizeProp])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden="true"
    />
  )
}

export default NexusPresenceOrb
