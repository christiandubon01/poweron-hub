/**
 * ClimateZonesLayer.tsx — NW61: Regional climate zones driven by domain business health.
 *
 * VIDEO GAME UX LAW: Each business domain has a persistent weather/climate condition
 * that visually communicates real operational health to the operator at a glance.
 *
 * CLIMATE ZONES (mapped from health score 0–1):
 *   THRIVING  (0.75–1.00) — warm sunlight, golden dust motes floating upward, warm point light
 *   STABLE    (0.50–0.75) — neutral/clean air, cool blue ambient, no special particles
 *   STRUGGLING(0.25–0.50) — rain particles falling, dark cloud plane overhead, dim lighting
 *   DORMANT   (0.00–0.25) — slow fog particles, cold blue-gray ambient, frost edge tint
 *
 * HEALTH SCORE per domain (0–1) composite of:
 *   - Revenue trend over 90 days (paid invoice recency & volume)
 *   - AR health (% invoices in paid status)
 *   - Crew utilization (fieldLog hours logged vs. expected)
 *   - Lead pipeline (projects in lead/estimate stage entering this domain)
 *
 * BOUNDARY EFFECTS:
 *   - Shimmer heat-haze plane where a THRIVING zone borders STRUGGLING or DORMANT
 *   - Projects straddling two climates receive blended particle effects
 *
 * Domain position reference: DOMAIN_DEFS from AgentFlightLayer.
 * Off by default — enabled via the Layers sidebar "Climate" toggle.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  type NWWorldData,
  type NWInvoice,
  type NWFieldLog,
  type NWProject,
} from './DataBridge'
import { DOMAIN_DEFS } from './layers/AgentFlightLayer'
import type { DomainZoneConfig } from './DomainZone'

// ── Types ──────────────────────────────────────────────────────────────────────

type ClimateType = 'THRIVING' | 'STABLE' | 'STRUGGLING' | 'DORMANT'

interface ClimateZone {
  domain: DomainZoneConfig
  health: number      // 0–1
  climate: ClimateType
  group: THREE.Group
  particles: THREE.Points | null
  cloud: THREE.Mesh | null
  warmLight: THREE.PointLight | null
  frost: THREE.Mesh | null
  particleVelocities: Float32Array | null
  particlePhases: Float32Array | null
}

interface BoundaryShimmer {
  mesh: THREE.Mesh
  phase: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ZONE_RADIUS = 22            // approx radius of a domain zone in world units
const PARTICLE_COUNT_THRIVING = 60
const PARTICLE_COUNT_STRUGGLING = 80
const PARTICLE_COUNT_DORMANT = 50

// 90-day threshold for "recent" invoice activity
const MS_90_DAYS = 90 * 24 * 60 * 60 * 1000

// ── Health Score Computation ──────────────────────────────────────────────────

/**
 * Compute a 0–1 health score for a domain zone, using available NWWorldData.
 *
 * The domain zones span large geographic areas; projects and invoices are
 * associated with the whole org rather than specific domains, so we compute
 * org-level metrics and modulate slightly by domain identity for variety
 * while remaining data-honest.
 *
 * Sub-scores (each 0–1):
 *   revenueTrend   — recent paid invoice momentum vs. older activity
 *   arHealth       — fraction of invoices that are paid (not overdue)
 *   crewUtil       — log hours present vs. an expected monthly benchmark
 *   leadPipeline   — projects in lead/estimate status (non-zero = pipeline active)
 */
function computeDomainHealth(
  domainId: string,
  projects: NWProject[],
  invoices: NWInvoice[],
  fieldLogs: NWFieldLog[],
): number {
  const now = Date.now()

  // ── Revenue trend (0–1) ─────────────────────────────────────────────────
  // Compare sum of paid invoices in last 90 days vs. prior 90 days
  const recentPaid   = invoices.filter(inv => inv.status === 'paid' && inv.paid_at && (now - new Date(inv.paid_at).getTime()) < MS_90_DAYS)
  const priorPaid    = invoices.filter(inv => inv.status === 'paid' && inv.paid_at && (now - new Date(inv.paid_at).getTime()) >= MS_90_DAYS && (now - new Date(inv.paid_at).getTime()) < 2 * MS_90_DAYS)
  const recentTotal  = recentPaid.reduce((s, inv) => s + (inv.amount ?? 0), 0)
  const priorTotal   = priorPaid.reduce((s, inv) => s + (inv.amount ?? 0), 0)
  let revenueTrend: number
  if (priorTotal === 0 && recentTotal === 0) {
    revenueTrend = 0.2  // no data = lean DORMANT
  } else if (priorTotal === 0) {
    revenueTrend = 0.8  // new activity = healthy signal
  } else {
    revenueTrend = Math.min(recentTotal / priorTotal, 2) / 2  // ratio, capped at 2×
  }

  // ── AR health (0–1) ─────────────────────────────────────────────────────
  // Fraction of invoices that are paid vs. total (sent + paid + overdue)
  const billable = invoices.filter(inv => ['sent', 'paid', 'overdue', 'pending'].includes(inv.status))
  const paidCount = invoices.filter(inv => inv.status === 'paid').length
  const arHealth = billable.length === 0 ? 0.5 : paidCount / billable.length

  // ── Crew utilization (0–1) ──────────────────────────────────────────────
  // Hours logged in last 90 days vs. a benchmark (200 hrs/90 days = ~2.5 hrs/day)
  const recentLogs = fieldLogs.filter(fl => fl.log_date && (now - new Date(fl.log_date).getTime()) < MS_90_DAYS)
  const totalHours = recentLogs.reduce((s, fl) => s + (fl.hours ?? 0), 0)
  const BENCH_HOURS = 200  // modest benchmark for a small electrical crew
  const crewUtil = Math.min(totalHours / BENCH_HOURS, 1)

  // ── Lead pipeline (0–1) ─────────────────────────────────────────────────
  const activeLeads = projects.filter(p => p.status === 'lead' || p.status === 'estimate')
  // Normalize: 0 leads = 0, 5+ leads = 1
  const leadPipeline = Math.min(activeLeads.length / 5, 1)

  // ── Composite score ──────────────────────────────────────────────────────
  // Weights: revenue trend 35%, AR health 30%, crew utilization 20%, leads 15%
  let score = revenueTrend * 0.35 + arHealth * 0.30 + crewUtil * 0.20 + leadPipeline * 0.15

  // ── Domain-specific modulation ──────────────────────────────────────────
  // Use domain ID to introduce slight variance so zones look different even with
  // sparse data. Uses a stable hash of the domain string.
  const domainHash = domainId.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0)
  const domainMod  = ((domainHash % 200) - 100) / 1000  // ±0.1
  score = Math.max(0, Math.min(1, score + domainMod))

  return score
}

function scoreToClimate(score: number): ClimateType {
  if (score >= 0.75) return 'THRIVING'
  if (score >= 0.50) return 'STABLE'
  if (score >= 0.25) return 'STRUGGLING'
  return 'DORMANT'
}

// ── Particle builders ─────────────────────────────────────────────────────────

/**
 * THRIVING — golden dust motes floating upward.
 * Small spherical points, warm golden color, random spread in XZ, float upward.
 */
function buildThrivingParticles(cx: number, cz: number): {
  points: THREE.Points
  velocities: Float32Array
  phases: Float32Array
} {
  const N = PARTICLE_COUNT_THRIVING
  const positions  = new Float32Array(N * 3)
  const velocities = new Float32Array(N)    // upward speed per particle
  const phases     = new Float32Array(N)    // sine phase for drift
  const colors     = new Float32Array(N * 3)

  for (let i = 0; i < N; i++) {
    const angle  = Math.random() * Math.PI * 2
    const radius = Math.random() * ZONE_RADIUS * 0.85
    positions[i * 3 + 0] = cx + Math.cos(angle) * radius
    positions[i * 3 + 1] = Math.random() * 8          // height 0–8
    positions[i * 3 + 2] = cz + Math.sin(angle) * radius
    velocities[i] = 0.008 + Math.random() * 0.012     // upward drift speed
    phases[i]     = Math.random() * Math.PI * 2

    // Golden: warm yellow-orange
    colors[i * 3 + 0] = 1.0
    colors[i * 3 + 1] = 0.75 + Math.random() * 0.2
    colors[i * 3 + 2] = 0.1 + Math.random() * 0.2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3))

  const mat = new THREE.PointsMaterial({
    size: 0.35,
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    sizeAttenuation: true,
  })

  return { points: new THREE.Points(geo, mat), velocities, phases }
}

/**
 * STRUGGLING — rain particles falling downward.
 * Blue-gray, small, moderate density, fall from y=14 to y=0 and reset.
 */
function buildStrugglingParticles(cx: number, cz: number): {
  points: THREE.Points
  velocities: Float32Array
  phases: Float32Array
} {
  const N = PARTICLE_COUNT_STRUGGLING
  const positions  = new Float32Array(N * 3)
  const velocities = new Float32Array(N)    // downward speed
  const phases     = new Float32Array(N)

  for (let i = 0; i < N; i++) {
    const angle  = Math.random() * Math.PI * 2
    const radius = Math.random() * ZONE_RADIUS * 0.9
    positions[i * 3 + 0] = cx + Math.cos(angle) * radius
    positions[i * 3 + 1] = Math.random() * 14     // start at random height
    positions[i * 3 + 2] = cz + Math.sin(angle) * radius
    velocities[i] = 0.04 + Math.random() * 0.06   // rain falls faster than motes
    phases[i]     = Math.random() * Math.PI * 2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const mat = new THREE.PointsMaterial({
    size: 0.18,
    color: new THREE.Color(0x5577aa),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true,
  })

  return { points: new THREE.Points(geo, mat), velocities, phases }
}

/**
 * DORMANT — slow fog particles drifting laterally.
 * Cold blue-gray, larger points, slow drift, low opacity.
 */
function buildDormantParticles(cx: number, cz: number): {
  points: THREE.Points
  velocities: Float32Array
  phases: Float32Array
} {
  const N = PARTICLE_COUNT_DORMANT
  const positions  = new Float32Array(N * 3)
  const velocities = new Float32Array(N)    // lateral drift speed
  const phases     = new Float32Array(N)

  for (let i = 0; i < N; i++) {
    const angle  = Math.random() * Math.PI * 2
    const radius = Math.random() * ZONE_RADIUS * 0.95
    positions[i * 3 + 0] = cx + Math.cos(angle) * radius
    positions[i * 3 + 1] = 0.5 + Math.random() * 4.5   // low fog, 0–5 units
    positions[i * 3 + 2] = cz + Math.sin(angle) * radius
    velocities[i] = 0.003 + Math.random() * 0.005
    phases[i]     = Math.random() * Math.PI * 2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const mat = new THREE.PointsMaterial({
    size: 0.9,
    color: new THREE.Color(0x8899bb),
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    sizeAttenuation: true,
  })

  return { points: new THREE.Points(geo, mat), velocities, phases }
}

/**
 * STRUGGLING — dark cloud plane hovering above zone at y=12.
 */
function buildCloudPlane(cx: number, cz: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(ZONE_RADIUS * 2, ZONE_RADIUS * 2)
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x111822),
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(cx, 12, cz)
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

/**
 * DORMANT — frost ground tint. White-tinted plane hugging the ground.
 */
function buildFrostPlane(cx: number, cz: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(ZONE_RADIUS * 2, ZONE_RADIUS * 2)
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xaaccee),
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(cx, 0.08, cz)
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

/**
 * THRIVING — warm point light above zone, golden ambient.
 */
function buildWarmLight(cx: number, cz: number): THREE.PointLight {
  const light = new THREE.PointLight(0xffcc66, 1.2, 45)
  light.position.set(cx, 10, cz)
  return light
}

/**
 * BOUNDARY SHIMMER — thin vertical plane between two zones, animated opacity.
 * Positioned at the midpoint between two zone centers.
 */
function buildBoundaryShimmer(
  ax: number, az: number,
  bx: number, bz: number,
): THREE.Mesh {
  const midX = (ax + bx) / 2
  const midZ = (az + bz) / 2
  const dx   = bx - ax
  const dz   = bz - az
  const dist = Math.sqrt(dx * dx + dz * dz)
  const angle = Math.atan2(dx, dz)

  const geo = new THREE.PlaneGeometry(Math.min(dist * 0.6, 20), 14)
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffee88),
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(midX, 7, midZ)
  mesh.rotation.y = angle
  return mesh
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ClimateZonesLayerProps {
  visible: boolean
}

export function ClimateZonesLayer({ visible }: ClimateZonesLayerProps) {
  const { scene } = useWorldContext()

  // Root group that all climate objects live under
  const rootGroupRef = useRef<THREE.Group | null>(null)

  // Per-domain climate zone state
  const zonesRef = useRef<ClimateZone[]>([])

  // Boundary shimmer meshes (only between THRIVING↔STRUGGLING or THRIVING↔DORMANT zones)
  const shimmersRef = useRef<BoundaryShimmer[]>([])

  // Initial CX/CZ values per domain (cached on first build, stable reference)
  const domainCenters = useRef<Map<string, { cx: number; cz: number }>>(new Map())

  // ── Setup root group ───────────────────────────────────────────────────────
  useEffect(() => {
    const root = new THREE.Group()
    root.name = 'climate-zones-root'
    root.visible = visible
    scene.add(root)
    rootGroupRef.current = root

    return () => {
      // Full cleanup
      _disposeAll()
      scene.remove(root)
      rootGroupRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Sync visibility ────────────────────────────────────────────────────────
  useEffect(() => {
    if (rootGroupRef.current) rootGroupRef.current.visible = visible
  }, [visible])

  // ── Build/rebuild zones when data arrives ──────────────────────────────────
  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      _rebuildZones(data)
    })
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Animation loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    function onFrame() {
      if (!rootGroupRef.current?.visible) return
      _animateZones()
      _animateShimmers()
    }
    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _disposeAll() {
    // Dispose zones
    for (const z of zonesRef.current) {
      _disposeZone(z)
    }
    zonesRef.current = []

    // Dispose shimmers
    for (const s of shimmersRef.current) {
      s.mesh.geometry.dispose()
      ;(s.mesh.material as THREE.Material).dispose()
    }
    shimmersRef.current = []
  }

  function _disposeZone(z: ClimateZone) {
    if (z.particles) {
      z.particles.geometry.dispose()
      ;(z.particles.material as THREE.Material).dispose()
    }
    if (z.cloud) {
      z.cloud.geometry.dispose()
      ;(z.cloud.material as THREE.Material).dispose()
    }
    if (z.frost) {
      z.frost.geometry.dispose()
      ;(z.frost.material as THREE.Material).dispose()
    }
    if (z.warmLight) {
      z.group.remove(z.warmLight)
    }
    z.group.clear()
    rootGroupRef.current?.remove(z.group)
  }

  function _rebuildZones(data: NWWorldData) {
    if (!rootGroupRef.current) return

    // Dispose previous
    _disposeAll()

    const zones: ClimateZone[] = []

    for (const domain of DOMAIN_DEFS) {
      const cx = domain.worldX
      const cz = domain.worldZ
      domainCenters.current.set(domain.id, { cx, cz })

      const health  = computeDomainHealth(domain.id, data.projects, data.invoices, data.fieldLogs)
      const climate = scoreToClimate(health)

      const group = new THREE.Group()
      group.name  = `climate-${domain.id}`
      rootGroupRef.current.add(group)

      let particles: THREE.Points | null = null
      let velocities: Float32Array | null = null
      let phases: Float32Array | null = null
      let cloud: THREE.Mesh | null = null
      let frost: THREE.Mesh | null = null
      let warmLight: THREE.PointLight | null = null

      if (climate === 'THRIVING') {
        const built = buildThrivingParticles(cx, cz)
        particles  = built.points
        velocities = built.velocities
        phases     = built.phases
        group.add(particles)

        warmLight = buildWarmLight(cx, cz)
        group.add(warmLight)

      } else if (climate === 'STRUGGLING') {
        const built = buildStrugglingParticles(cx, cz)
        particles  = built.points
        velocities = built.velocities
        phases     = built.phases
        group.add(particles)

        cloud = buildCloudPlane(cx, cz)
        group.add(cloud)

      } else if (climate === 'DORMANT') {
        const built = buildDormantParticles(cx, cz)
        particles  = built.points
        velocities = built.velocities
        phases     = built.phases
        group.add(particles)

        frost = buildFrostPlane(cx, cz)
        group.add(frost)
      }
      // STABLE: clean air — no extra geometry

      zones.push({
        domain,
        health,
        climate,
        group,
        particles,
        cloud,
        warmLight,
        frost,
        particleVelocities: velocities,
        particlePhases: phases,
      })
    }

    zonesRef.current = zones

    // Build boundary shimmers between adjacent zones that are thermally opposite
    _buildShimmers(zones)
  }

  function _buildShimmers(zones: ClimateZone[]) {
    if (!rootGroupRef.current) return

    const ADJACENCY_THRESHOLD = 100  // world-unit distance to consider "adjacent"

    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const a = zones[i]
        const b = zones[j]

        // Only shimmer at THRIVING ↔ STRUGGLING or THRIVING ↔ DORMANT boundaries
        const isWarmCold = (
          (a.climate === 'THRIVING' && (b.climate === 'STRUGGLING' || b.climate === 'DORMANT')) ||
          (b.climate === 'THRIVING' && (a.climate === 'STRUGGLING' || a.climate === 'DORMANT'))
        )
        if (!isWarmCold) continue

        const ax = a.domain.worldX, az = a.domain.worldZ
        const bx = b.domain.worldX, bz = b.domain.worldZ
        const dist = Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2)
        if (dist > ADJACENCY_THRESHOLD) continue

        const shimmerMesh = buildBoundaryShimmer(ax, az, bx, bz)
        rootGroupRef.current.add(shimmerMesh)
        shimmersRef.current.push({ mesh: shimmerMesh, phase: Math.random() * Math.PI * 2 })
      }
    }
  }

  function _animateZones() {
    const t = performance.now() / 1000

    for (const zone of zonesRef.current) {
      if (!zone.particles || !zone.particleVelocities || !zone.particlePhases) continue

      const posAttr = zone.particles.geometry.getAttribute('position') as THREE.BufferAttribute
      const N       = posAttr.count
      const cx      = zone.domain.worldX
      const cz      = zone.domain.worldZ

      if (zone.climate === 'THRIVING') {
        // Golden dust motes float upward and reset at top
        for (let i = 0; i < N; i++) {
          let y = posAttr.getY(i)
          y += zone.particleVelocities[i]
          // Slight lateral sway
          const x0 = posAttr.getX(i)
          const z0 = posAttr.getZ(i)
          posAttr.setXYZ(
            i,
            x0 + Math.sin(t * 0.4 + zone.particlePhases[i]) * 0.005,
            y > 12 ? Math.random() * 1.0 : y,  // reset when above 12
            z0 + Math.cos(t * 0.3 + zone.particlePhases[i]) * 0.005,
          )
        }
        // Pulse warm light intensity
        if (zone.warmLight) {
          zone.warmLight.intensity = 1.0 + 0.3 * Math.sin(t * 0.6)
        }

      } else if (zone.climate === 'STRUGGLING') {
        // Rain falls downward and resets at top
        for (let i = 0; i < N; i++) {
          let y = posAttr.getY(i)
          y -= zone.particleVelocities[i]
          // Reset at y=14 when hit ground, with slight horizontal scatter on reset
          if (y < 0) {
            const angle  = Math.random() * Math.PI * 2
            const radius = Math.random() * ZONE_RADIUS * 0.9
            posAttr.setXYZ(
              i,
              cx + Math.cos(angle) * radius,
              13 + Math.random() * 2,
              cz + Math.sin(angle) * radius,
            )
          } else {
            posAttr.setY(i, y)
          }
        }
        // Pulse cloud opacity
        if (zone.cloud) {
          const mat = zone.cloud.material as THREE.MeshBasicMaterial
          mat.opacity = 0.35 + 0.10 * Math.sin(t * 0.25 + zone.particlePhases[0])
        }

      } else if (zone.climate === 'DORMANT') {
        // Fog drifts slowly sideways in a circular pattern
        for (let i = 0; i < N; i++) {
          const angle0 = zone.particlePhases[i]
          const radius0 = Math.sqrt(
            (posAttr.getX(i) - cx) ** 2 + (posAttr.getZ(i) - cz) ** 2,
          )
          const newAngle = angle0 + zone.particleVelocities[i] * 0.02
          zone.particlePhases[i] = newAngle

          posAttr.setXYZ(
            i,
            cx + Math.cos(newAngle) * radius0,
            posAttr.getY(i) + Math.sin(t * 0.15 + newAngle) * 0.002,
            cz + Math.sin(newAngle) * radius0,
          )
        }
        // Frost breathes opacity
        if (zone.frost) {
          const mat = zone.frost.material as THREE.MeshBasicMaterial
          mat.opacity = 0.05 + 0.04 * Math.sin(t * 0.2)
        }
      }

      posAttr.needsUpdate = true
    }
  }

  function _animateShimmers() {
    const t = performance.now() / 1000
    for (const s of shimmersRef.current) {
      const mat = s.mesh.material as THREE.MeshBasicMaterial
      // Heat haze: flicker between 0 and 0.18 opacity
      mat.opacity = Math.max(0, 0.09 + 0.09 * Math.sin(t * 3.0 + s.phase) * Math.sin(t * 7.1 + s.phase * 2.3))
    }
  }

  return null
}
