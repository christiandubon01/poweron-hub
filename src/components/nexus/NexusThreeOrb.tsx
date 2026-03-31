// @ts-nocheck
/**
 * NexusThreeOrb — Canvas 2D particle sphere matching Three.js visual spec.
 *
 * NOTE: This component is architected to match the Three.js particle sphere spec
 * exactly. The three package is listed in package.json and this component should
 * be migrated to use THREE.WebGLRenderer once `npm install three` succeeds in the
 * deployment environment (currently blocked by network policy in the build sandbox).
 *
 * Visual spec implemented:
 *   - ~200 nodes distributed on sphere surface via golden-angle algorithm
 *   - Thin connection lines between nearby nodes (chord distance threshold 0.3)
 *   - Slow idle Y-axis rotation: 0.003 rad/frame
 *   - Pulse/burst animation when speaking (responding state):
 *     nodes expand outward, lines brighten, then contract back
 *   - idle:     green  #10b981 (brand accent)
 *   - listening: blue  #3b82f6
 *   - speaking:  white burst (#ffffff) with green core (#10b981)
 *   - Fills container responsively via ResizeObserver
 *   - Initialize on mount, cleanup on unmount (cancelAnimationFrame + ResizeObserver)
 */

import { useEffect, useRef } from 'react'
import type { OrbState } from './NexusPresenceOrb'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NexusThreeOrbProps {
  state?: OrbState
  className?: string
}

interface Node3D {
  x: number  // unit sphere coords
  y: number
  z: number
}

interface ConnectionPair {
  i: number
  j: number
}

// ── State config ──────────────────────────────────────────────────────────────

interface StateConfig {
  nodeColor: string
  lineColor: string
  coreColor: string
  glowColor: string
  pulse: boolean
  rotSpeed: number
}

const STATE_CONFIG: Record<OrbState, StateConfig> = {
  inactive:     { nodeColor: '#10b981', lineColor: '#10b981', coreColor: '#10b981', glowColor: 'rgba(16,185,129,0.12)', pulse: false, rotSpeed: 0.003 },
  listening:    { nodeColor: '#3b82f6', lineColor: '#3b82f6', coreColor: '#3b82f6', glowColor: 'rgba(59,130,246,0.18)', pulse: false, rotSpeed: 0.005 },
  recording:    { nodeColor: '#3b82f6', lineColor: '#3b82f6', coreColor: '#3b82f6', glowColor: 'rgba(59,130,246,0.25)', pulse: true,  rotSpeed: 0.007 },
  transcribing: { nodeColor: '#fbbf24', lineColor: '#fbbf24', coreColor: '#fbbf24', glowColor: 'rgba(251,191,36,0.18)',  pulse: false, rotSpeed: 0.006 },
  processing:   { nodeColor: '#a855f7', lineColor: '#a855f7', coreColor: '#a855f7', glowColor: 'rgba(168,85,247,0.22)',  pulse: false, rotSpeed: 0.010 },
  responding:   { nodeColor: '#ffffff', lineColor: '#ffffff', coreColor: '#10b981', glowColor: 'rgba(16,185,129,0.40)',  pulse: true,  rotSpeed: 0.006 },
  complete:     { nodeColor: '#10b981', lineColor: '#10b981', coreColor: '#10b981', glowColor: 'rgba(16,185,129,0.15)', pulse: false, rotSpeed: 0.003 },
  error:        { nodeColor: '#f97316', lineColor: '#f97316', coreColor: '#f97316', glowColor: 'rgba(249,115,22,0.22)',  pulse: false, rotSpeed: 0.007 },
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NexusThreeOrb({ state = 'inactive', className = '' }: NexusThreeOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef   = useRef<number>(0)
  const stateRef  = useRef<OrbState>(state)

  // Keep stateRef current so animation loop reads latest state
  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // ── Geometry — 200 nodes on unit sphere via golden-angle distribution ──
    const NUM_NODES  = 200
    const CONN_DIST  = 0.3    // chord distance threshold on unit sphere (3D space)
    const SPHERE_R   = 0.38   // fraction of canvas half-size

    const nodes: Node3D[] = []
    for (let i = 0; i < NUM_NODES; i++) {
      const theta = Math.acos(1 - (2 * (i + 0.5)) / NUM_NODES)
      const phi   = Math.PI * (1 + Math.sqrt(5)) * i
      nodes.push({
        x: Math.sin(theta) * Math.cos(phi),
        y: Math.sin(theta) * Math.sin(phi),
        z: Math.cos(theta),
      })
    }

    // Pre-compute which node pairs are within CONN_DIST (based on unit-sphere coords)
    const connections: ConnectionPair[] = []
    for (let i = 0; i < NUM_NODES; i++) {
      for (let j = i + 1; j < NUM_NODES; j++) {
        const dx = nodes[i].x - nodes[j].x
        const dy = nodes[i].y - nodes[j].y
        const dz = nodes[i].z - nodes[j].z
        if (Math.sqrt(dx*dx + dy*dy + dz*dz) < CONN_DIST) {
          connections.push({ i, j })
        }
      }
    }

    // ── Canvas sizing ──────────────────────────────────────────────────────
    const dpr = window.devicePixelRatio || 1
    let canvasW = canvas.clientWidth  || 300
    let canvasH = canvas.clientHeight || 300

    function resizeCanvas() {
      canvasW = canvas.clientWidth  || 300
      canvasH = canvas.clientHeight || 300
      canvas.width  = canvasW * dpr
      canvas.height = canvasH * dpr
      ctx.scale(dpr, dpr)
    }
    resizeCanvas()

    const ro = new ResizeObserver(() => {
      resizeCanvas()
    })
    ro.observe(canvas)

    // ── Animation state ────────────────────────────────────────────────────
    let rotation   = 0
    let pulsePhase = 0

    // ── Draw loop ──────────────────────────────────────────────────────────
    function draw() {
      animRef.current = requestAnimationFrame(draw)

      const cfg   = STATE_CONFIG[stateRef.current]
      const cx    = canvasW / 2
      const cy    = canvasH / 2
      const rPx   = Math.min(canvasW, canvasH) * SPHERE_R  // sphere radius in px

      // Advance rotation and pulse
      rotation += cfg.rotSpeed
      if (cfg.pulse) pulsePhase += 0.07
      const pulseFactor = cfg.pulse ? 1 + Math.sin(pulsePhase) * 0.15 : 1.0
      const lineAlpha   = cfg.pulse ? 0.30 + Math.abs(Math.sin(pulsePhase)) * 0.35 : 0.28

      // Clear
      ctx.clearRect(0, 0, canvasW, canvasH)

      // Background glow
      const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rPx * 1.6)
      glowGrad.addColorStop(0, cfg.glowColor)
      glowGrad.addColorStop(1, 'transparent')
      ctx.fillStyle = glowGrad
      ctx.fillRect(0, 0, canvasW, canvasH)

      // Core inner glow
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rPx * 0.28)
      coreGrad.addColorStop(0, cfg.coreColor + '55')
      coreGrad.addColorStop(1, 'transparent')
      ctx.fillStyle = coreGrad
      ctx.beginPath()
      ctx.arc(cx, cy, rPx * 0.28, 0, Math.PI * 2)
      ctx.fill()

      // Y-axis rotation matrix components
      const cosR = Math.cos(rotation)
      const sinR = Math.sin(rotation)

      // Project all nodes to 2D (Y-axis rotation + perspective depth)
      const projected = nodes.map(n => {
        // Rotate around Y axis
        const rx = n.x * cosR + n.z * sinR
        const rz = -n.x * sinR + n.z * cosR
        // Depth scale: z in [-1..1] → scale in [0.5..1.0]
        const depth  = (rz + 2) / 3          // [0.33 .. 1.0]
        const scaled = pulseFactor            // pulse expands sphere
        return {
          sx:    cx + rx * rPx * scaled,
          sy:    cy + n.y * rPx * scaled,
          depth,
          visible: rz > -0.6,
        }
      })

      // Draw connections
      ctx.lineWidth = 0.5
      for (const { i, j } of connections) {
        if (!projected[i].visible || !projected[j].visible) continue
        const avgDepth  = (projected[i].depth + projected[j].depth) / 2
        const alpha     = lineAlpha * avgDepth
        const alphaHex  = Math.round(Math.min(alpha, 1) * 255).toString(16).padStart(2, '0')
        ctx.strokeStyle = cfg.lineColor + alphaHex
        ctx.beginPath()
        ctx.moveTo(projected[i].sx, projected[i].sy)
        ctx.lineTo(projected[j].sx, projected[j].sy)
        ctx.stroke()
      }

      // Draw nodes
      for (let i = 0; i < NUM_NODES; i++) {
        const p = projected[i]
        if (!p.visible) continue

        const nodeR = (1.5 + p.depth * 1.5) * (cfg.pulse ? 1 + Math.sin(pulsePhase) * 0.2 : 1)

        // Soft glow halo
        const halo = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, nodeR * 4)
        halo.addColorStop(0, cfg.nodeColor + Math.round(p.depth * 100).toString(16).padStart(2, '0'))
        halo.addColorStop(1, 'transparent')
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, nodeR * 4, 0, Math.PI * 2)
        ctx.fill()

        // Solid core
        ctx.fillStyle = cfg.nodeColor
        ctx.globalAlpha = 0.6 + p.depth * 0.4
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, nodeR, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }
    }

    draw()

    return () => {
      cancelAnimationFrame(animRef.current)
      ro.disconnect()
    }
  }, []) // run once on mount

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
