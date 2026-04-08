/**
 * MinimapRenderer.tsx — NW16: 150×150px orthographic top-down minimap.
 *
 * Renders to a 2D canvas overlay (not Three.js renderer) to avoid
 * disrupting the main rendering pipeline / LOD.
 *
 * Contents:
 *   - Top-down terrain outline (static grid approximation at low detail)
 *   - Green dot  = player position
 *   - Red dots   = active project mountains (from nw:register-mountain events)
 *   - Blue dots  = east continent structures (x > 20)
 *   - Updates every 500ms
 *
 * World coordinate mapping:
 *   World is 400×400 centred at 0,0 (x: -200..200, z: -200..200)
 *   Minimap x = (worldX + 200) / 400 * SIZE
 *   Minimap y = (worldZ + 200) / 400 * SIZE  (top = -z, bottom = +z)
 */

import React, { useEffect, useRef } from 'react'

const SIZE = 150
const WORLD_RANGE = 400   // -200..200

// World extents for east / west continent boundaries
const EAST_X_MIN = 20
const WEST_X_MAX = -20

interface MountainDot {
  x: number
  z: number
  radius: number
  projectId: string
}

interface EastDot {
  x: number
  z: number
  label: string
}

export function MinimapRenderer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playerPos = useRef<{ x: number; z: number }>({ x: 0, z: 10 })
  const mountains = useRef<MountainDot[]>([])
  const eastDots  = useRef<EastDot[]>([])

  // Subscribe to player position
  useEffect(() => {
    function onPos(e: Event) {
      const ev = e as CustomEvent<{ x: number; y: number; z: number }>
      if (ev.detail) {
        playerPos.current = { x: ev.detail.x, z: ev.detail.z }
      }
    }
    window.addEventListener('nw:player-position', onPos)
    return () => window.removeEventListener('nw:player-position', onPos)
  }, [])

  // Subscribe to mountain registrations
  useEffect(() => {
    function onRegister(e: Event) {
      const ev = e as CustomEvent<MountainDot>
      if (!ev.detail) return
      const idx = mountains.current.findIndex(m => m.projectId === ev.detail.projectId)
      if (idx >= 0) {
        mountains.current[idx] = ev.detail
      } else {
        mountains.current.push(ev.detail)
      }
    }
    function onClear() {
      mountains.current = []
    }
    window.addEventListener('nw:register-mountain', onRegister)
    window.addEventListener('nw:clear-mountains', onClear)
    return () => {
      window.removeEventListener('nw:register-mountain', onRegister)
      window.removeEventListener('nw:clear-mountains', onClear)
    }
  }, [])

  // Subscribe to east structure registrations
  useEffect(() => {
    function onEast(e: Event) {
      const ev = e as CustomEvent<EastDot>
      if (!ev.detail) return
      const exists = eastDots.current.find(d => d.label === ev.detail.label && d.x === ev.detail.x)
      if (!exists) eastDots.current.push(ev.detail)
    }
    window.addEventListener('nw:register-east-structure', onEast)
    return () => window.removeEventListener('nw:register-east-structure', onEast)
  }, [])

  // Draw loop at 500ms intervals
  useEffect(() => {
    function draw() {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.clearRect(0, 0, SIZE, SIZE)

      // ── Background ─────────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(5,5,20,0.88)'
      ctx.fillRect(0, 0, SIZE, SIZE)

      // ── Continent zones ────────────────────────────────────────────────
      // West continent (x=-200..-20)
      const westX1 = toMapX(-200)
      const westX2 = toMapX(WEST_X_MAX)
      ctx.fillStyle = 'rgba(42,26,10,0.55)'
      ctx.fillRect(westX1, 0, westX2 - westX1, SIZE)

      // Central channel (x=-20..20)
      const chanX1 = toMapX(WEST_X_MAX)
      const chanX2 = toMapX(EAST_X_MIN)
      ctx.fillStyle = 'rgba(5,10,20,0.55)'
      ctx.fillRect(chanX1, 0, chanX2 - chanX1, SIZE)

      // East continent (x=20..200)
      const eastX1 = toMapX(EAST_X_MIN)
      const eastX2 = toMapX(200)
      ctx.fillStyle = 'rgba(10,10,26,0.55)'
      ctx.fillRect(eastX1, 0, eastX2 - eastX1, SIZE)

      // ── Grid lines ─────────────────────────────────────────────────────
      ctx.strokeStyle = 'rgba(0,229,204,0.08)'
      ctx.lineWidth = 0.5
      for (let i = 0; i <= 4; i++) {
        const p = (i / 4) * SIZE
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, SIZE); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(SIZE, p); ctx.stroke()
      }

      // ── East structures (blue dots) ─────────────────────────────────────
      eastDots.current.forEach(d => {
        const mx = toMapX(d.x)
        const mz = toMapZ(d.z)
        ctx.beginPath()
        ctx.arc(mx, mz, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = '#4488ff'
        ctx.fill()
      })

      // ── Mountain / project dots (red) ──────────────────────────────────
      mountains.current.forEach(m => {
        const mx = toMapX(m.x)
        const mz = toMapZ(m.z)
        ctx.beginPath()
        ctx.arc(mx, mz, 3, 0, Math.PI * 2)
        ctx.fillStyle = '#ff4444'
        ctx.fill()
        // Inner glow
        ctx.beginPath()
        ctx.arc(mx, mz, 1.5, 0, Math.PI * 2)
        ctx.fillStyle = '#ff8888'
        ctx.fill()
      })

      // ── Player dot (green) ─────────────────────────────────────────────
      const px = toMapX(playerPos.current.x)
      const pz = toMapZ(playerPos.current.z)

      // Outer ring
      ctx.beginPath()
      ctx.arc(px, pz, 5, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0,255,136,0.5)'
      ctx.lineWidth = 1
      ctx.stroke()

      // Fill
      ctx.beginPath()
      ctx.arc(px, pz, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = '#00ff88'
      ctx.fill()

      // ── Border ─────────────────────────────────────────────────────────
      ctx.strokeStyle = 'rgba(0,229,204,0.4)'
      ctx.lineWidth = 1
      ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1)

      // ── Label ──────────────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(0,229,204,0.5)'
      ctx.font = '7px monospace'
      ctx.fillText('MINIMAP', 4, SIZE - 4)
    }

    draw()
    const interval = setInterval(draw, 500)
    return () => clearInterval(interval)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
        width: SIZE,
        height: SIZE,
        zIndex: 26,
        borderRadius: 4,
        pointerEvents: 'none',
        imageRendering: 'pixelated',
      }}
    />
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMapX(worldX: number): number {
  return ((worldX + WORLD_RANGE / 2) / WORLD_RANGE) * SIZE
}

function toMapZ(worldZ: number): number {
  // Flip Z so north (negative Z) is top of minimap
  return ((WORLD_RANGE / 2 - worldZ) / WORLD_RANGE) * SIZE
}
