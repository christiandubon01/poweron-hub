/**
 * BioluminescentLayer.tsx — NW54: Organic data-driven bioluminescence.
 *
 * The entire Neural World glows with bioluminescent patterns that reflect
 * real-time business activity. Active areas glow bright; dormant areas go dark.
 *
 * GROUND GLOW:
 *   - Active today (field log today):     bright teal-green, full glow
 *   - Recent (within 7 days):             moderate glow, slow pulse
 *   - Stale (7–14 days):                  dim glow
 *   - Dormant (14+ days / never active):  dark, no glow
 *
 * NODE GLOW RINGS:
 *   PointLight beneath each project mountain, intensity = activity recency.
 *
 * ACTIVITY PULSES:
 *   Radial ring meshes emanating from event sources.
 *   Teal = positive · Amber = neutral · Red = negative
 *   Radius 10 u · 1.5 s duration · overlapping creates interference patterns.
 *
 * TIME-OF-DAY BRIGHTNESS:
 *   Business 7am–6pm = 100% · Evening 6pm–10pm = 60%
 *   Night 10pm–7am = 30% · Weekend = 40% base
 *
 * PERFORMANCE:
 *   Max 50 glow sources. Beyond 50, cull by distance from camera.
 *   Pulse pool of 20 rings max.
 *
 * Toggle: 'bioluminescence' layer (on by default).
 */

import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWWorldData,
} from './DataBridge'

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_GLOW_SOURCES = 50
const MAX_PULSE_RINGS  = 20
const GLOW_Y           = 0.06    // slightly above ground to avoid z-fight
const RING_Y           = 0.08

const PULSE_SPEED      = 10 / 1.5  // 10 units over 1.5 seconds
const PULSE_DURATION   = 1.5       // seconds
const PULSE_MAX_RADIUS = 10        // units

// Activity thresholds (ms)
const MS_DAY  =  1 * 24 * 60 * 60 * 1000
const MS_7D   =  7 * 24 * 60 * 60 * 1000
const MS_14D  = 14 * 24 * 60 * 60 * 1000

// Bioluminescent color palette
const COLOR_ACTIVE   = new THREE.Color(0x00ff99)  // bright teal-green
const COLOR_RECENT   = new THREE.Color(0x00cc77)  // moderate teal
const COLOR_STALE    = new THREE.Color(0x004433)  // very dim
const COLOR_INACTIVE = new THREE.Color(0x000000)  // off

const COLOR_PULSE_POSITIVE = new THREE.Color(0x00e5cc)  // teal
const COLOR_PULSE_NEUTRAL  = new THREE.Color(0xf59e0b)  // amber
const COLOR_PULSE_NEGATIVE = new THREE.Color(0xff4444)  // red

// ── Types ──────────────────────────────────────────────────────────────────────

type ActivityLevel = 'active' | 'recent' | 'stale' | 'dormant'

interface GlowSource {
  id:       string            // project id
  x:        number
  z:        number
  level:    ActivityLevel
  lastLog:  number            // timestamp of most recent field log, 0 if none
}

interface GlowMesh {
  id:     string
  disk:   THREE.Mesh
  light:  THREE.PointLight
  pulse:  number             // 0–1 oscillation phase offset
}

interface PulseRing {
  mesh:     THREE.Mesh
  radius:   number
  elapsed:  number
  color:    THREE.Color
  active:   boolean
}

// ── Gaussian softlight canvas texture ─────────────────────────────────────────

let _glowTexture: THREE.CanvasTexture | null = null

function getGlowTexture(): THREE.CanvasTexture {
  if (_glowTexture) return _glowTexture
  const SIZE = 256
  const canvas = document.createElement('canvas')
  canvas.width  = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  const cx  = SIZE / 2
  const gradient = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
  gradient.addColorStop(0.00, 'rgba(255,255,255,1.0)')
  gradient.addColorStop(0.20, 'rgba(255,255,255,0.85)')
  gradient.addColorStop(0.50, 'rgba(255,255,255,0.45)')
  gradient.addColorStop(0.80, 'rgba(255,255,255,0.10)')
  gradient.addColorStop(1.00, 'rgba(255,255,255,0.00)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, SIZE, SIZE)
  _glowTexture = new THREE.CanvasTexture(canvas)
  return _glowTexture
}

// ── Pulse ring mesh factory ────────────────────────────────────────────────────

function makePulseRing(color: THREE.Color): THREE.Mesh {
  // Thin torus lying flat on ground
  const geo = new THREE.TorusGeometry(1, 0.06, 6, 48)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = Math.PI / 2   // lay flat
  mesh.position.y = RING_Y
  mesh.visible = false
  return mesh
}

// ── Time-of-day brightness ─────────────────────────────────────────────────────

function getTimeOfDayBrightness(): number {
  const now  = new Date()
  const day  = now.getDay()          // 0 = Sun, 6 = Sat
  const hour = now.getHours() + now.getMinutes() / 60

  const isWeekend = day === 0 || day === 6

  // Night: 10pm – 7am
  if (hour >= 22 || hour < 7)  return isWeekend ? 0.20 : 0.30
  // Evening: 6pm – 10pm
  if (hour >= 18)               return isWeekend ? 0.30 : 0.60
  // Business hours: 7am – 6pm
  return isWeekend ? 0.40 : 1.00
}

// ── Activity classification ────────────────────────────────────────────────────

function classifyActivity(lastLog: number, now: number): ActivityLevel {
  if (lastLog === 0)                   return 'dormant'
  const age = now - lastLog
  if (age < MS_DAY)                    return 'active'
  if (age < MS_7D)                     return 'recent'
  if (age < MS_14D)                    return 'stale'
  return 'dormant'
}

function activityColor(level: ActivityLevel): THREE.Color {
  switch (level) {
    case 'active':  return COLOR_ACTIVE
    case 'recent':  return COLOR_RECENT
    case 'stale':   return COLOR_STALE
    default:        return COLOR_INACTIVE
  }
}

function activityLightIntensity(level: ActivityLevel, brightness: number): number {
  switch (level) {
    case 'active':  return 1.2 * brightness
    case 'recent':  return 0.55 * brightness
    case 'stale':   return 0.18 * brightness
    default:        return 0
  }
}

function activityDiskOpacity(level: ActivityLevel, brightness: number): number {
  switch (level) {
    case 'active':  return 0.78 * brightness
    case 'recent':  return 0.42 * brightness
    case 'stale':   return 0.14 * brightness
    default:        return 0
  }
}

function activityDiskRadius(level: ActivityLevel): number {
  switch (level) {
    case 'active':  return 8
    case 'recent':  return 6
    case 'stale':   return 3.5
    default:        return 0
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface BioluminescentLayerProps {
  visible: boolean
}

export function BioluminescentLayer({ visible }: BioluminescentLayerProps) {
  const { scene, camera } = useWorldContext()

  // Three.js object references
  const groupRef       = useRef<THREE.Group | null>(null)
  const glowMeshesRef  = useRef<GlowMesh[]>([])
  const pulseRingsRef  = useRef<PulseRing[]>([])
  const pulseGroupRef  = useRef<THREE.Group | null>(null)
  const animFrameRef   = useRef<number>(0)
  const timeRef        = useRef<number>(0)

  // Live data
  const sourcesRef     = useRef<GlowSource[]>([])
  const visibleRef     = useRef(visible)
  visibleRef.current   = visible

  // ── Camera helper to read position ──────────────────────────────────────────
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  // ── Build / rebuild glow sources from world data ───────────────────────────
  const rebuildSources = useCallback((data: NWWorldData) => {
    const now = Date.now()

    // Map most-recent field-log date per project
    const latestLogByProject = new Map<string, number>()
    for (const fl of data.fieldLogs) {
      if (!fl.project_id || !fl.log_date) continue
      const t = new Date(fl.log_date).getTime()
      if (isNaN(t)) continue
      const prev = latestLogByProject.get(fl.project_id) ?? 0
      if (t > prev) latestLogByProject.set(fl.project_id, t)
    }

    // Build sources — one per project
    const raw: GlowSource[] = data.projects.map(p => {
      const pos     = seededPosition(p.id)
      const lastLog = latestLogByProject.get(p.id) ?? 0
      const level   = classifyActivity(lastLog, now)
      return { id: p.id, x: pos.x, z: pos.z, level, lastLog }
    })

    // Cull to MAX_GLOW_SOURCES by distance from camera
    const cam = cameraRef.current as THREE.Camera & { position?: THREE.Vector3 }
    const camPos = (cam as THREE.PerspectiveCamera).position ?? new THREE.Vector3()
    const sorted = raw.sort((a, b) => {
      const dA = (a.x - camPos.x) ** 2 + (a.z - camPos.z) ** 2
      const dB = (b.x - camPos.x) ** 2 + (b.z - camPos.z) ** 2
      return dA - dB
    })

    sourcesRef.current = sorted.slice(0, MAX_GLOW_SOURCES)
  }, [])

  // ── Setup Three.js groups ──────────────────────────────────────────────────
  useEffect(() => {
    const group = new THREE.Group()
    group.name = 'BioluminescentLayer'
    scene.add(group)
    groupRef.current = group

    const pulseGroup = new THREE.Group()
    pulseGroup.name = 'BioLumPulses'
    scene.add(pulseGroup)
    pulseGroupRef.current = pulseGroup

    // Pre-allocate pulse ring pool
    const rings: PulseRing[] = []
    for (let i = 0; i < MAX_PULSE_RINGS; i++) {
      const mesh = makePulseRing(COLOR_PULSE_POSITIVE.clone())
      pulseGroup.add(mesh)
      rings.push({ mesh, radius: 0, elapsed: 0, color: COLOR_PULSE_POSITIVE.clone(), active: false })
    }
    pulseRingsRef.current = rings

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      // Dispose glow meshes
      glowMeshesRef.current.forEach(gm => {
        gm.disk.geometry.dispose()
        ;(gm.disk.material as THREE.Material).dispose()
        group.remove(gm.disk)
        group.remove(gm.light)
      })
      glowMeshesRef.current = []
      // Dispose pulse rings
      rings.forEach(pr => {
        pr.mesh.geometry.dispose()
        ;(pr.mesh.material as THREE.Material).dispose()
      })
      pulseRingsRef.current = []
      scene.remove(group)
      scene.remove(pulseGroup)
    }
  }, [scene])

  // ── Subscribe to DataBridge ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      rebuildSources(data)
      syncGlowMeshes()
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildSources])

  // ── Listen for real-time activity pulse events ─────────────────────────────
  useEffect(() => {
    function onActivityPulse(e: Event) {
      const ev = e as CustomEvent<{
        x?: number; z?: number
        type?: 'positive' | 'neutral' | 'negative'
      }>
      const x    = ev.detail?.x ?? 0
      const z    = ev.detail?.z ?? 0
      const type = ev.detail?.type ?? 'positive'
      emitPulse(x, z, type)
    }
    window.addEventListener('nw:activity-pulse', onActivityPulse)
    return () => window.removeEventListener('nw:activity-pulse', onActivityPulse)
  }, [])

  // ── Sync glow meshes to current sources ────────────────────────────────────
  function syncGlowMeshes() {
    const group   = groupRef.current
    if (!group) return

    const sources = sourcesRef.current
    const existing = glowMeshesRef.current

    // Remove meshes for sources no longer present
    const sourceIds = new Set(sources.map(s => s.id))
    const removed: GlowMesh[] = []
    const kept: GlowMesh[]    = []
    for (const gm of existing) {
      if (sourceIds.has(gm.id)) {
        kept.push(gm)
      } else {
        gm.disk.geometry.dispose()
        ;(gm.disk.material as THREE.Material).dispose()
        group.remove(gm.disk)
        group.remove(gm.light)
        removed.push(gm)
      }
    }

    // Build lookup of kept meshes
    const keptMap = new Map(kept.map(gm => [gm.id, gm]))

    // Add new meshes for sources without one
    const glowTex = getGlowTexture()
    const next: GlowMesh[] = []

    for (const src of sources) {
      let gm = keptMap.get(src.id)
      if (!gm) {
        // Create new glow disk
        const radius = activityDiskRadius(src.level) || 1
        const geo = new THREE.PlaneGeometry(radius * 2, radius * 2)
        geo.rotateX(-Math.PI / 2)   // lay flat on ground
        const mat = new THREE.MeshBasicMaterial({
          map:         glowTex,
          color:       activityColor(src.level),
          transparent: true,
          opacity:     0,
          depthWrite:  false,
          blending:    THREE.AdditiveBlending,
          side:        THREE.DoubleSide,
        })
        const disk = new THREE.Mesh(geo, mat)
        disk.position.set(src.x, GLOW_Y, src.z)
        group.add(disk)

        // Point light at ground level
        const light = new THREE.PointLight(
          activityColor(src.level),
          0,
          activityDiskRadius(src.level) * 2.5,
        )
        light.position.set(src.x, 0.5, src.z)
        group.add(light)

        gm = { id: src.id, disk, light, pulse: Math.random() * Math.PI * 2 }
      } else {
        // Update existing mesh geometry/color if level changed
        const mat = gm.disk.material as THREE.MeshBasicMaterial
        mat.color.copy(activityColor(src.level))
        gm.light.color.copy(activityColor(src.level))
        // Resize disk if needed
        const newRadius = activityDiskRadius(src.level) || 1
        const oldScale  = gm.disk.scale.x
        if (Math.abs(newRadius - oldScale) > 0.5) {
          gm.disk.scale.setScalar(newRadius / 1) // geo is radius=1 × scale
        }
      }
      next.push(gm)
    }

    glowMeshesRef.current = next
  }

  // ── Emit a bioluminescent activity pulse ───────────────────────────────────
  function emitPulse(
    x: number,
    z: number,
    type: 'positive' | 'neutral' | 'negative' = 'positive',
  ) {
    const pool = pulseRingsRef.current
    // Find an inactive ring from the pool
    const ring = pool.find(r => !r.active)
    if (!ring) return

    const color = type === 'positive'
      ? COLOR_PULSE_POSITIVE
      : type === 'neutral'
        ? COLOR_PULSE_NEUTRAL
        : COLOR_PULSE_NEGATIVE

    ring.color.copy(color)
    ring.radius  = 0
    ring.elapsed = 0
    ring.active  = true
    ring.mesh.position.set(x, RING_Y, z)
    ring.mesh.scale.setScalar(0.01)
    ;(ring.mesh.material as THREE.MeshBasicMaterial).color.copy(color)
    ;(ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9
    ring.mesh.visible = true
  }

  // ── Animation loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    let last = performance.now()

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate)
      const now    = performance.now()
      const delta  = Math.min((now - last) / 1000, 0.1)
      last         = now
      timeRef.current += delta

      const t          = timeRef.current
      const brightness = getTimeOfDayBrightness()
      const isVis      = visibleRef.current
      const group      = groupRef.current
      if (group) group.visible = isVis

      const pGroup = pulseGroupRef.current
      if (pGroup) pGroup.visible = isVis

      if (!isVis) return

      // ── Animate glow disks ──────────────────────────────────────────────
      const sources  = sourcesRef.current
      const srcMap   = new Map(sources.map(s => [s.id, s]))

      for (const gm of glowMeshesRef.current) {
        const src = srcMap.get(gm.id)
        if (!src) continue

        const mat   = gm.disk.material as THREE.MeshBasicMaterial
        let   pulse = 1.0

        // Slow sine pulse for recently-active nodes
        if (src.level === 'recent') {
          pulse = 0.7 + 0.3 * Math.sin(t * 1.2 + gm.pulse)
        } else if (src.level === 'active') {
          pulse = 0.92 + 0.08 * Math.sin(t * 2.4 + gm.pulse)
        }

        const opacity    = activityDiskOpacity(src.level, brightness) * pulse
        mat.opacity      = opacity
        mat.color.copy(activityColor(src.level))
        mat.visible      = opacity > 0.01

        const lightIntensity = activityLightIntensity(src.level, brightness) * pulse
        gm.light.intensity = lightIntensity
        gm.light.color.copy(activityColor(src.level))
      }

      // ── Animate pulse rings ─────────────────────────────────────────────
      for (const ring of pulseRingsRef.current) {
        if (!ring.active) continue

        ring.elapsed += delta
        const progress = ring.elapsed / PULSE_DURATION
        if (progress >= 1.0) {
          ring.active       = false
          ring.mesh.visible = false
          continue
        }

        // Expand ring outward
        ring.radius = PULSE_MAX_RADIUS * progress
        ring.mesh.scale.setScalar(ring.radius)

        // Fade out — starts strong, fades to 0
        // Interference: slightly boost opacity when multiple rings overlap (approximated by sine beat)
        const fade    = 1.0 - progress
        const beat    = 1.0 + 0.25 * Math.sin(progress * Math.PI * 3)
        const opacity = fade * beat * 0.85 * brightness
        ;(ring.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(opacity, 0.9)
      }

      // ── Periodic pulse emission (simulated from active sources) ─────────
      // Every ~8 seconds, emit a random teal pulse from an active source
      // to create the ambient living glow feel (VIDEO GAME UX: world feels alive)
      if (Math.floor(t * 0.125) !== Math.floor((t - delta) * 0.125)) {
        const activeSrc = sources.filter(s => s.level === 'active' || s.level === 'recent')
        if (activeSrc.length > 0) {
          const pick = activeSrc[Math.floor(Math.random() * activeSrc.length)]
          emitPulse(pick.x, pick.z, pick.level === 'active' ? 'positive' : 'neutral')
        }
      }
    }

    animate()
    return () => cancelAnimationFrame(animFrameRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Sync visibility changes ────────────────────────────────────────────────
  useEffect(() => {
    if (groupRef.current)      groupRef.current.visible      = visible
    if (pulseGroupRef.current) pulseGroupRef.current.visible = visible
  }, [visible])

  return null
}
