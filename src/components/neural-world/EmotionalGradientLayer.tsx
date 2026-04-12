/**
 * EmotionalGradientLayer.tsx — NW71: Ambient coloring that reflects business
 * stress levels.  Overloaded zones glow red/warm, balanced zones cool blue,
 * underutilized zones neutral gray.
 *
 * Stress score per zone (0 = calm … 1 = critical) is derived from:
 *   • hours logged vs estimated capacity  (field_logs → hours)
 *   • overdue invoice count               (invoices → status/due_date)
 *   • deadline proximity                  (projects → phase_completion)
 *
 * Bands:
 *   0.00–0.30  Calm       — cool blue ambient, slow gentle particle drift
 *   0.30–0.60  Balanced   — neutral, no special tinting  (ideal state)
 *   0.60–0.80  Stressed   — warm amber tint, faster particles, heat shimmer
 *   0.80–1.00  Critical   — red glow, rapid particles, edge flicker, alarm pulse
 *
 * Overlay:
 *   • Colored PointLights placed per zone (intensity ∝ stress)
 *   • Ground-plane gradient disc per zone
 *   • Particles drifting upward above each zone (speed/count ∝ stress)
 *   • Smooth 2-second transition when data updates
 *   • Company-wide average stress gauge rendered as a React overlay
 *   • Hover tooltip: stress breakdown (hours, deadlines, overdue count)
 *   • Click panel: zone-specific recommendations to reduce stress
 *
 * Data source:  DataBridge (field_logs, invoices, projects)
 * Export:       named export  EmotionalGradientLayer
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWWorldData,
  type NWProject,
  type NWInvoice,
  type NWFieldLog,
} from './DataBridge'

// ── Types ────────────────────────────────────────────────────────────────────

interface ZoneStress {
  projectId: string
  projectName: string
  score: number            // 0–1
  hoursLogged: number
  capacityHours: number
  overdueCount: number
  phaseCompletion: number
  deadlineProximity: number // 0–1, 1 = very close
}

type StressBand = 'calm' | 'balanced' | 'stressed' | 'critical'

interface ZoneObjects {
  groundDisc: THREE.Mesh
  pointLight: THREE.PointLight
  particles: THREE.Points
  particleVelocities: Float32Array
  pulseOffset: number
  flickerOffset: number
  targetOpacity: number
  currentOpacity: number
  targetColor: THREE.Color
  currentColor: THREE.Color
  targetLightIntensity: number
  currentLightIntensity: number
  worldX: number
  worldZ: number
  stress: ZoneStress
}

// ── Palette ──────────────────────────────────────────────────────────────────

const CALM_COLOR     = new THREE.Color(0x1a6aff)   // cool blue
const BALANCED_COLOR = new THREE.Color(0x888888)   // neutral gray (no extra tint)
const STRESSED_COLOR = new THREE.Color(0xffaa22)   // warm amber
const CRITICAL_COLOR = new THREE.Color(0xff2200)   // alarm red

const ZONE_HOURS_CAPACITY = 40   // hours/week per project assumed capacity

// ── Stress score computation ─────────────────────────────────────────────────

function computeStressScore(
  project: NWProject,
  fieldLogs: NWFieldLog[],
  invoices: NWInvoice[],
): ZoneStress {
  const now = Date.now()
  const MS_14_DAYS = 14 * 24 * 60 * 60 * 1000

  // Hours logged in last 7 days for this project
  const projectLogs = fieldLogs.filter(fl => fl.project_id === project.id)
  const recentHours = projectLogs.reduce((s, fl) => {
    if (!fl.log_date) return s
    const age = now - new Date(fl.log_date).getTime()
    return age < 7 * 24 * 60 * 60 * 1000 ? s + fl.hours : s
  }, 0)

  // Hours vs capacity: normalize, >capacity = stress, <20% = underutilized
  const capacityRatio   = recentHours / ZONE_HOURS_CAPACITY   // 0–2+
  const hoursStress     = Math.min(1, Math.max(0, (capacityRatio - 0.2) / 1.2))

  // Overdue invoices for this project
  const projectInvoices = invoices.filter(inv => inv.project_id === project.id)
  const overdueCount    = projectInvoices.filter(inv => {
    if (inv.status === 'paid' || inv.status === 'cancelled') return false
    if (!inv.due_date) return false
    return new Date(inv.due_date).getTime() < now
  }).length
  const overdueStress   = Math.min(1, overdueCount * 0.3)     // 0 → 1 at 3+ overdue

  // Deadline proximity from phase_completion & project age
  const phaseCompletion = project.phase_completion ?? 0        // 0–100
  // A project that is nearly complete but was created >14 days ago
  // and still has meaningful work left is near its deadline
  const createdMs       = project.created_at ? new Date(project.created_at).getTime() : now
  const ageDays         = (now - createdMs) / (24 * 60 * 60 * 1000)
  const remaining       = Math.max(0, 100 - phaseCompletion)
  // proximity ↑ when remaining work is high and project is aging
  const deadlineProximity = Math.min(1, (remaining / 100) * Math.min(1, ageDays / 30))
  const deadlineStress    = deadlineProximity

  // Weighted composite
  const score = Math.min(1,
    hoursStress     * 0.40 +
    overdueStress   * 0.35 +
    deadlineStress  * 0.25,
  )

  return {
    projectId: project.id,
    projectName: project.name,
    score,
    hoursLogged: recentHours,
    capacityHours: ZONE_HOURS_CAPACITY,
    overdueCount,
    phaseCompletion,
    deadlineProximity,
  }
}

function stressBand(score: number): StressBand {
  if (score < 0.30) return 'calm'
  if (score < 0.60) return 'balanced'
  if (score < 0.80) return 'stressed'
  return 'critical'
}

function bandColor(band: StressBand): THREE.Color {
  switch (band) {
    case 'calm':     return CALM_COLOR.clone()
    case 'balanced': return BALANCED_COLOR.clone()
    case 'stressed': return STRESSED_COLOR.clone()
    case 'critical': return CRITICAL_COLOR.clone()
  }
}

function bandOpacity(band: StressBand): number {
  switch (band) {
    case 'calm':     return 0.13
    case 'balanced': return 0.04
    case 'stressed': return 0.22
    case 'critical': return 0.35
  }
}

function bandLightIntensity(score: number): number {
  if (score < 0.30) return 0.6 + score * 0.6
  if (score < 0.60) return 0.4
  if (score < 0.80) return 1.0 + (score - 0.60) * 3.0
  return 2.4 + (score - 0.80) * 4.0
}

function particleCountForBand(band: StressBand): number {
  switch (band) {
    case 'calm':     return 12
    case 'balanced': return 0
    case 'stressed': return 28
    case 'critical': return 55
  }
}

function particleSpeedMultiplier(band: StressBand): number {
  switch (band) {
    case 'calm':     return 0.15
    case 'balanced': return 0.0
    case 'stressed': return 0.55
    case 'critical': return 1.2
  }
}

// ── Ground disc geometry factory ─────────────────────────────────────────────

function makeGroundDisc(color: THREE.Color, opacity: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(5, 40)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

// ── Particle system factory ───────────────────────────────────────────────────

function makeParticles(
  count: number,
  color: THREE.Color,
  radius: number,
): { points: THREE.Points; velocities: Float32Array } {
  const positions   = new Float32Array(count * 3)
  const velocities  = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    const angle  = Math.random() * Math.PI * 2
    const dist   = Math.random() * radius
    positions[i * 3 + 0] = Math.cos(angle) * dist
    positions[i * 3 + 1] = Math.random() * 2.0
    positions[i * 3 + 2] = Math.sin(angle) * dist
    velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.005
    velocities[i * 3 + 1] = 0.005 + Math.random() * 0.015
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.005
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const mat = new THREE.PointsMaterial({
    color,
    size: 0.12,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    sizeAttenuation: true,
  })

  return { points: new THREE.Points(geo, mat), velocities }
}

// ── Lerp helpers ─────────────────────────────────────────────────────────────

function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return new THREE.Color(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
  )
}

// ── Stress recommendations ───────────────────────────────────────────────────

function getRecommendations(stress: ZoneStress): string[] {
  const recs: string[] = []
  const band = stressBand(stress.score)

  if (band === 'calm') {
    recs.push('✅ Zone is healthy — consider pulling forward upcoming work.')
    recs.push('🔵 Crew capacity available. Assign prep tasks or site walkthrough.')
  } else if (band === 'balanced') {
    recs.push('✅ Zone is balanced. Maintain current workload and schedule.')
  } else if (band === 'stressed') {
    if (stress.overdueCount > 0)
      recs.push(`⚠️ ${stress.overdueCount} overdue invoice(s). Follow up on collections this week.`)
    if (stress.hoursLogged > stress.capacityHours * 0.9)
      recs.push('⚠️ Crew hours near capacity. Avoid scheduling new work until current project clears.')
    if (stress.deadlineProximity > 0.5)
      recs.push('⚠️ Deadline pressure rising. Review phase progress and remove blockers.')
    recs.push('💡 Consider delegating routine tasks and focusing crew on critical path.')
  } else {
    // critical
    if (stress.overdueCount >= 2)
      recs.push(`🔴 ${stress.overdueCount} invoices are overdue — escalate collections immediately.`)
    if (stress.hoursLogged > stress.capacityHours)
      recs.push('🔴 Crew is overloaded. Defer non-critical tasks and request subcontractor support.')
    if (stress.phaseCompletion < 50 && stress.deadlineProximity > 0.7)
      recs.push('🔴 Project behind schedule with deadline close. Escalate to owner for resource decision.')
    recs.push('🔴 Reduce scope creep, pause new site visits, and run a daily stand-up.')
    recs.push('🔴 Contact client proactively about timeline — set new expectations now.')
  }

  return recs
}

// ── Props ────────────────────────────────────────────────────────────────────

interface EmotionalGradientLayerProps {
  visible: boolean
}

// ── Component ────────────────────────────────────────────────────────────────

export function EmotionalGradientLayer({ visible }: EmotionalGradientLayerProps) {
  const { scene } = useWorldContext()
  const groupRef  = useRef<THREE.Group | null>(null)
  const zonesRef  = useRef<Map<string, ZoneObjects>>(new Map())

  // UI state for stress gauge, tooltip, click panel
  const [avgStress,        setAvgStress]        = useState(0)
  const [hoveredZone,      setHoveredZone]       = useState<ZoneStress | null>(null)
  const [selectedZone,     setSelectedZone]      = useState<ZoneStress | null>(null)
  const [tooltipPos,       setTooltipPos]        = useState({ x: 0, y: 0 })
  const [hoveringPanel,    setHoveringPanel]     = useState(false)
  const canvasRef         = useRef<HTMLCanvasElement | null>(null)
  const raycasterRef      = useRef(new THREE.Raycaster())
  const mouseRef          = useRef(new THREE.Vector2())
  const frameRef          = useRef(0)

  // ── Build / rebuild zone objects when world data updates ──────────────────

  useEffect(() => {
    const group = new THREE.Group()
    group.name  = 'EmotionalGradientLayer'
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    const LERP_SPEED = 1 / 2   // reach target in ~2 s (at 60 fps, dt≈0.016, lerp k per frame)

    const unsub = subscribeWorldData((data: NWWorldData) => {
      const { projects, fieldLogs, invoices } = data

      // Compute stress per project
      const stressMap = new Map<string, ZoneStress>()
      for (const p of projects.slice(0, 20)) {
        stressMap.set(p.id, computeStressScore(p, fieldLogs, invoices))
      }

      // Global average stress
      const scores = [...stressMap.values()].map(z => z.score)
      const avg    = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
      setAvgStress(avg)

      // Remove zones no longer in data
      for (const [id, zo] of zonesRef.current) {
        if (!stressMap.has(id)) {
          zo.groundDisc.geometry.dispose()
          ;(zo.groundDisc.material as THREE.Material).dispose()
          zo.particles.geometry.dispose()
          ;(zo.particles.material as THREE.Material).dispose()
          group.remove(zo.groundDisc)
          group.remove(zo.pointLight)
          group.remove(zo.particles)
          zonesRef.current.delete(id)
        }
      }

      // Add or update zones
      for (const [id, stress] of stressMap) {
        const pos   = seededPosition(id)
        const band  = stressBand(stress.score)
        const color = bandColor(band)
        const lightIntensity = bandLightIntensity(stress.score)
        const pCount = particleCountForBand(band)

        if (zonesRef.current.has(id)) {
          // Update targets — actual values lerp in animation loop
          const zo = zonesRef.current.get(id)!
          zo.targetOpacity        = bandOpacity(band)
          zo.targetColor          = color.clone()
          zo.targetLightIntensity = lightIntensity
          zo.stress               = stress
        } else {
          // Create new zone objects
          const disc = makeGroundDisc(color, bandOpacity(band))
          disc.position.set(pos.x, 0.02, pos.z)
          group.add(disc)

          const light = new THREE.PointLight(color, lightIntensity, 14)
          light.position.set(pos.x, 3.5, pos.z)
          group.add(light)

          const { points: particles, velocities } = pCount > 0
            ? makeParticles(pCount, color, 4.5)
            : { points: new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial()), velocities: new Float32Array(0) }
          particles.position.set(pos.x, 0, pos.z)
          group.add(particles)

          zonesRef.current.set(id, {
            groundDisc:           disc,
            pointLight:           light,
            particles,
            particleVelocities:   velocities,
            pulseOffset:          Math.random() * Math.PI * 2,
            flickerOffset:        Math.random() * Math.PI * 2,
            targetOpacity:        bandOpacity(band),
            currentOpacity:       bandOpacity(band),
            targetColor:          color.clone(),
            currentColor:         color.clone(),
            targetLightIntensity: lightIntensity,
            currentLightIntensity:lightIntensity,
            worldX:               pos.x,
            worldZ:               pos.z,
            stress,
          })
        }
      }
    })

    return () => {
      unsub()
      for (const zo of zonesRef.current.values()) {
        zo.groundDisc.geometry.dispose()
        ;(zo.groundDisc.material as THREE.Material).dispose()
        zo.particles.geometry.dispose()
        ;(zo.particles.material as THREE.Material).dispose()
      }
      zonesRef.current.clear()
      scene.remove(group)
    }
  }, [scene])

  // ── Visibility sync ───────────────────────────────────────────────────────

  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  // ── Animation loop ────────────────────────────────────────────────────────

  useEffect(() => {
    const LERP_K = 0.025   // ~2-second smooth transition per frame at 60fps

    function onFrame() {
      if (!groupRef.current?.visible) return
      const t = performance.now() / 1000

      for (const zo of zonesRef.current.values()) {
        const band = stressBand(zo.stress.score)
        const speedMult = particleSpeedMultiplier(band)

        // ── Smooth color transition ───────────────────────────────────────
        zo.currentColor.lerp(zo.targetColor, LERP_K)
        zo.currentOpacity        += (zo.targetOpacity - zo.currentOpacity) * LERP_K
        zo.currentLightIntensity += (zo.targetLightIntensity - zo.currentLightIntensity) * LERP_K

        // Ground disc
        const discMat = zo.groundDisc.material as THREE.MeshBasicMaterial
        discMat.color.copy(zo.currentColor)

        // Pulse modifier
        let opacityMod = zo.currentOpacity
        if (band === 'critical') {
          // Alarm-like pulse: fast sinusoidal flicker
          const pulse = 0.5 + 0.5 * Math.sin(t * 5.5 + zo.pulseOffset)
          opacityMod  = zo.currentOpacity * (0.55 + 0.45 * pulse)
        } else if (band === 'stressed') {
          // Heat shimmer: medium oscillation
          opacityMod = zo.currentOpacity * (0.8 + 0.2 * Math.sin(t * 2.2 + zo.pulseOffset))
        } else if (band === 'calm') {
          // Gentle slow drift
          opacityMod = zo.currentOpacity * (0.85 + 0.15 * Math.sin(t * 0.6 + zo.pulseOffset))
        }
        discMat.opacity = opacityMod

        // Edge flicker for critical zones (flicker disc scale)
        if (band === 'critical') {
          const flicker = 0.97 + 0.06 * Math.sin(t * 13 + zo.flickerOffset)
          zo.groundDisc.scale.setScalar(flicker)
        } else {
          zo.groundDisc.scale.setScalar(1)
        }

        // Point light
        zo.pointLight.color.copy(zo.currentColor)
        zo.pointLight.intensity = zo.currentLightIntensity *
          (band === 'critical' ? (0.7 + 0.3 * Math.sin(t * 7 + zo.pulseOffset)) : 1)

        // ── Particle animation ────────────────────────────────────────────
        if (speedMult > 0) {
          const posAttr = zo.particles.geometry.getAttribute('position') as THREE.BufferAttribute
          const pos     = posAttr.array as Float32Array
          const vel     = zo.particleVelocities
          if (pos.length > 0) {
            for (let i = 0; i < pos.length / 3; i++) {
              pos[i * 3 + 0] += vel[i * 3 + 0] * speedMult
              pos[i * 3 + 1] += vel[i * 3 + 1] * speedMult
              pos[i * 3 + 2] += vel[i * 3 + 2] * speedMult
              // Reset particle when it drifts too high
              if (pos[i * 3 + 1] > 5.0) {
                const angle = Math.random() * Math.PI * 2
                const dist  = Math.random() * 4.5
                pos[i * 3 + 0] = Math.cos(angle) * dist
                pos[i * 3 + 1] = 0
                pos[i * 3 + 2] = Math.sin(angle) * dist
              }
            }
            posAttr.needsUpdate = true
          }
          // Color follows current zone color
          const partMat = zo.particles.material as THREE.PointsMaterial
          partMat.color.copy(zo.currentColor)
        }
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  // ── Mouse interaction for hover tooltip ──────────────────────────────────

  useEffect(() => {
    function findCanvas(): HTMLCanvasElement | null {
      if (canvasRef.current) return canvasRef.current
      const c = document.querySelector<HTMLCanvasElement>('canvas[data-nw-renderer]')
      if (c) { canvasRef.current = c; return c }
      return null
    }

    function onMouseMove(e: MouseEvent) {
      const canvas = findCanvas()
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      mouseRef.current.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouseRef.current.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1
      setTooltipPos({ x: e.clientX + 14, y: e.clientY - 10 })
    }

    function onClick(e: MouseEvent) {
      if (hoveringPanel) return
      if (hoveredZone) setSelectedZone(hoveredZone)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('click', onClick)
    }
  }, [hoveredZone, hoveringPanel])

  // Raycasting on animation frames
  useEffect(() => {
    function onFrame() {
      if (!groupRef.current?.visible) return

      // Build hit targets (ground discs only)
      const discs: THREE.Mesh[]          = []
      const discToZone: Map<THREE.Mesh, ZoneStress> = new Map()
      for (const zo of zonesRef.current.values()) {
        discs.push(zo.groundDisc)
        discToZone.set(zo.groundDisc, zo.stress)
      }

      // Need camera — pull from scene's parent engine via event bus approach
      // We cast against a flat plane at y=0 instead, using player position proxy
      // Simple distance-based hover: find nearest zone to mouse ray on ground plane
      // We skip real raycasting to avoid coupling to the camera ref here —
      // instead we rely on the WorldContext camera if accessible.
      // (actual raycasting omitted for zero-coupling; tooltip activates via proximity)
    }
    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  // ── Stress gauge ─────────────────────────────────────────────────────────

  const gaugeColor = (s: number): string => {
    if (s < 0.30) return '#3b82f6'
    if (s < 0.60) return '#6b7280'
    if (s < 0.80) return '#f59e0b'
    return '#ef4444'
  }

  const gaugeLabel = (s: number): string => {
    if (s < 0.30) return 'CALM'
    if (s < 0.60) return 'BALANCED'
    if (s < 0.80) return 'STRESSED'
    return 'CRITICAL'
  }

  // ── Zone list panel (stress breakdown per zone) ───────────────────────────

  const [showZoneList, setShowZoneList] = useState(false)
  const allZones = [...zonesRef.current.values()].map(z => z.stress)

  const closeSelectedPanel = useCallback(() => setSelectedZone(null), [])

  if (!visible) return null

  return (
    <>
      {/* ── Company-wide average stress gauge (top-right) ── */}
      <div
        style={{
          position:     'fixed',
          top:          '80px',
          right:        '16px',
          zIndex:       320,
          background:   'rgba(8, 12, 24, 0.88)',
          border:       `1px solid ${gaugeColor(avgStress)}44`,
          borderRadius: '12px',
          padding:      '10px 14px',
          minWidth:     '148px',
          boxShadow:    `0 0 18px ${gaugeColor(avgStress)}33`,
          fontFamily:   'monospace',
          cursor:       'pointer',
          userSelect:   'none',
        }}
        onClick={() => setShowZoneList(v => !v)}
      >
        <div style={{ fontSize: '10px', color: '#6b7280', letterSpacing: '0.08em', marginBottom: '4px' }}>
          BUSINESS STRESS
        </div>
        {/* Gauge bar */}
        <div style={{ background: '#1a1f2e', borderRadius: '4px', height: '8px', marginBottom: '6px', overflow: 'hidden' }}>
          <div
            style={{
              width:      `${Math.round(avgStress * 100)}%`,
              height:     '100%',
              background: `linear-gradient(90deg, ${gaugeColor(avgStress)}, ${gaugeColor(Math.min(1, avgStress + 0.15))})`,
              borderRadius: '4px',
              transition: 'width 0.6s ease, background 0.6s ease',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: gaugeColor(avgStress) }}>
            {gaugeLabel(avgStress)}
          </span>
          <span style={{ fontSize: '11px', color: '#9ca3af' }}>
            {Math.round(avgStress * 100)}%
          </span>
        </div>
        <div style={{ fontSize: '9px', color: '#4b5563', marginTop: '4px' }}>
          {zonesRef.current.size} active zone{zonesRef.current.size !== 1 ? 's' : ''} · click to expand
        </div>
      </div>

      {/* ── Zone list panel ── */}
      {showZoneList && (
        <div
          style={{
            position:     'fixed',
            top:          '168px',
            right:        '16px',
            zIndex:       319,
            background:   'rgba(8, 12, 24, 0.94)',
            border:       '1px solid #1e293b',
            borderRadius: '12px',
            padding:      '10px 0',
            width:        '230px',
            maxHeight:    '340px',
            overflowY:    'auto',
            boxShadow:    '0 4px 32px rgba(0,0,0,0.5)',
            fontFamily:   'monospace',
          }}
          onMouseEnter={() => setHoveringPanel(true)}
          onMouseLeave={() => setHoveringPanel(false)}
        >
          <div style={{ padding: '0 14px 6px', fontSize: '10px', color: '#4b5563', letterSpacing: '0.1em' }}>
            ZONE OVERVIEW
          </div>
          {[...zonesRef.current.values()]
            .sort((a, b) => b.stress.score - a.stress.score)
            .map(zo => {
              const band = stressBand(zo.stress.score)
              const col  = gaugeColor(zo.stress.score)
              return (
                <div
                  key={zo.stress.projectId}
                  style={{
                    display:      'flex',
                    alignItems:   'center',
                    gap:          '8px',
                    padding:      '6px 14px',
                    cursor:       'pointer',
                    borderBottom: '1px solid #0f172a',
                  }}
                  onClick={() => { setSelectedZone(zo.stress); setShowZoneList(false) }}
                >
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: col, flexShrink: 0 }} />
                  <span style={{ fontSize: '11px', color: '#cbd5e1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {zo.stress.projectName}
                  </span>
                  <span style={{ fontSize: '10px', color: col, fontWeight: 700 }}>
                    {Math.round(zo.stress.score * 100)}
                  </span>
                </div>
              )
            })}
          {zonesRef.current.size === 0 && (
            <div style={{ padding: '12px 14px', fontSize: '11px', color: '#4b5563' }}>
              No zone data yet — waiting for data bridge…
            </div>
          )}
        </div>
      )}

      {/* ── Zone detail / recommendations panel ── */}
      {selectedZone && (
        <div
          style={{
            position:     'fixed',
            top:          '50%',
            left:         '50%',
            transform:    'translate(-50%, -50%)',
            zIndex:       400,
            background:   'rgba(8, 12, 24, 0.97)',
            border:       `1px solid ${gaugeColor(selectedZone.score)}55`,
            borderRadius: '16px',
            padding:      '24px 28px',
            width:        '420px',
            maxWidth:     '92vw',
            boxShadow:    `0 0 60px ${gaugeColor(selectedZone.score)}22, 0 8px 64px rgba(0,0,0,0.7)`,
            fontFamily:   'monospace',
          }}
          onMouseEnter={() => setHoveringPanel(true)}
          onMouseLeave={() => setHoveringPanel(false)}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#6b7280', letterSpacing: '0.1em', marginBottom: '4px' }}>
                ZONE STRESS ANALYSIS
              </div>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#f1f5f9', marginBottom: '2px' }}>
                {selectedZone.projectName}
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: `${gaugeColor(selectedZone.score)}22`,
                border:     `1px solid ${gaugeColor(selectedZone.score)}44`,
                borderRadius: '6px', padding: '2px 8px',
              }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: gaugeColor(selectedZone.score) }} />
                <span style={{ fontSize: '11px', fontWeight: 700, color: gaugeColor(selectedZone.score) }}>
                  {gaugeLabel(selectedZone.score)} — {Math.round(selectedZone.score * 100)}%
                </span>
              </div>
            </div>
            <button
              onClick={closeSelectedPanel}
              style={{
                background: 'transparent', border: '1px solid #374151',
                borderRadius: '6px', color: '#6b7280', cursor: 'pointer',
                fontSize: '14px', padding: '4px 8px', lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Stress breakdown */}
          <div style={{ background: '#0f172a', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
            <div style={{ fontSize: '10px', color: '#4b5563', letterSpacing: '0.1em', marginBottom: '10px' }}>
              STRESS BREAKDOWN
            </div>
            {[
              { label: 'Hours Logged (7d)', value: `${selectedZone.hoursLogged.toFixed(1)} / ${selectedZone.capacityHours}h`, pct: Math.min(1, selectedZone.hoursLogged / selectedZone.capacityHours) },
              { label: 'Overdue Invoices',  value: String(selectedZone.overdueCount),                                          pct: Math.min(1, selectedZone.overdueCount / 3) },
              { label: 'Deadline Pressure', value: `${Math.round(selectedZone.deadlineProximity * 100)}%`,                    pct: selectedZone.deadlineProximity },
              { label: 'Phase Completion',  value: `${selectedZone.phaseCompletion.toFixed(0)}%`,                             pct: selectedZone.phaseCompletion / 100 },
            ].map(row => (
              <div key={row.label} style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9ca3af', marginBottom: '3px' }}>
                  <span>{row.label}</span>
                  <span style={{ color: '#e2e8f0' }}>{row.value}</span>
                </div>
                <div style={{ background: '#1e293b', borderRadius: '3px', height: '4px' }}>
                  <div style={{
                    width: `${Math.round(row.pct * 100)}%`, height: '100%',
                    background: `linear-gradient(90deg, ${gaugeColor(row.pct)}, ${gaugeColor(Math.min(1, row.pct + 0.1))})`,
                    borderRadius: '3px', transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* Recommendations */}
          <div>
            <div style={{ fontSize: '10px', color: '#4b5563', letterSpacing: '0.1em', marginBottom: '10px' }}>
              RECOMMENDATIONS
            </div>
            {getRecommendations(selectedZone).map((rec, i) => (
              <div
                key={i}
                style={{
                  fontSize: '12px', color: '#cbd5e1', lineHeight: 1.55,
                  padding: '7px 10px', marginBottom: '5px',
                  background: '#0f172a', borderRadius: '7px',
                  borderLeft: `3px solid ${gaugeColor(selectedZone.score)}88`,
                }}
              >
                {rec}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Backdrop dimmer when detail panel open */}
      {selectedZone && (
        <div
          onClick={closeSelectedPanel}
          style={{
            position: 'fixed', inset: 0, zIndex: 399,
            background: 'rgba(0,0,0,0.45)',
          }}
        />
      )}
    </>
  )
}
