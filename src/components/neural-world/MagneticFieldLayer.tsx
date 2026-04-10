/**
 * MagneticFieldLayer.tsx — NW62: Magnetic field lines — influence direction visualization.
 *
 * Visualizes influence direction between business entities using magnetic field lines.
 * Lines curve in smooth arcs (CatmullRomCurve3) between source and destination.
 * Animated particles flow along lines showing direction.
 *
 * PULL entities (attract resources/attention):
 *   - High-value active projects: pull crew, materials, attention
 *   - Overdue invoices: pull collection effort
 *   - Hot leads (gcContacts): pull sales attention
 *   - Growing subscriptions: pull support resources
 *
 * PUSH entities (distribute resources outward):
 *   - Completed projects: push freed crew to new projects
 *   - Paid invoices: push cash to operations
 *   - NEXUS recommendations: push attention to recommended actions
 *
 * POLARITY:
 *   - POSITIVE pole (net contributor / pusher): green glow at base
 *   - NEGATIVE pole (net consumer / puller): amber glow at base
 *   - NEUTRAL: balanced, no glow
 *
 * FIELD STRENGTH:
 *   - Strong (≥ 0.7): 5 field lines, bright, fast particle flow
 *   - Medium (0.35–0.69): 3 field lines, moderate brightness
 *   - Weak (< 0.35): 1 field line, dim, slow particles
 *
 * Toggle: 'magnetic-fields' layer key, off by default.
 * Hover: only hovered entity lines highlight, others dim to 10%.
 * Click: dispatches 'nw:magnetic-field-click' with entity influence data.
 */

import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWWorldData,
  type NWProject,
  type NWInvoice,
} from './DataBridge'
import { registerParticles, unregisterParticles } from './ParticleManager'

// ── Constants ─────────────────────────────────────────────────────────────────

const LINE_SEGMENTS    = 32      // CatmullRom curve subdivisions
const PARTICLE_RADIUS  = 0.35
const GLOW_RADIUS      = 1.8     // polarity glow sphere radius
const LINE_OPACITY_ON  = 0.75    // highlighted line opacity
const LINE_OPACITY_DIM = 0.07    // dimmed line opacity when another entity hovered
const FIELD_LINE_GAP   = 1.8     // lateral offset between parallel field lines

// Colors
const TEAL_PARTICLE  = new THREE.Color(0x00e5cc)  // toward high-value nodes
const RED_PARTICLE   = new THREE.Color(0xff3344)  // toward problem nodes
const PUSH_LINE_COLOR = new THREE.Color(0x00e5cc) // outward flow lines (teal)
const PULL_LINE_COLOR = new THREE.Color(0xff7744) // inward pull lines (amber)
const POSITIVE_GLOW  = new THREE.Color(0x00ff88)  // net contributor
const NEGATIVE_GLOW  = new THREE.Color(0xffaa00)  // net consumer

// Known world positions (must match DataFlowLayer / NodeClickSystem conventions)
const HQ_POS    = new THREE.Vector3(  0,  2,   0)  // operations core
const SPARK_POS = new THREE.Vector3( 60, 10, -120) // sales / leads
const NEXUS_POS = new THREE.Vector3(110,  6,  -60) // NEXUS recommendations
const MRR_POS   = new THREE.Vector3(100,  8,   0)  // subscription MRR mountain

// ── Types ─────────────────────────────────────────────────────────────────────

type PolarityType = 'positive' | 'negative' | 'neutral'

interface FieldSource {
  id: string
  label: string
  position: THREE.Vector3
  polarity: PolarityType
  /** 0–1 normalized influence strength */
  strength: number
  /** destinations this entity influences */
  targets: FieldTarget[]
  /** pull or push */
  mode: 'pull' | 'push'
  isProblemNode: boolean
}

interface FieldTarget {
  position: THREE.Vector3
  label: string
}

interface FieldLine {
  /** The entity this line belongs to */
  sourceId: string
  /** THREE.Line objects for this field line (one per line count) */
  lines: THREE.Line[]
  /** curve for particle animation */
  curve: THREE.CatmullRomCurve3
  /** particles flowing along this line */
  particles: FieldParticle[]
  /** is this a pull (true) or push (false) */
  isPull: boolean
  isProblemNode: boolean
  /** current opacity factor */
  opacity: number
}

interface FieldParticle {
  mesh: THREE.Mesh
  t: number
  speed: number
  active: boolean
  restartCountdown: number
}

interface PolarityGlow {
  mesh: THREE.Mesh
  sourceId: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a CatmullRomCurve3 that arcs between two points like a magnetic field line */
function buildFieldCurve(
  from: THREE.Vector3,
  to: THREE.Vector3,
  arcHeight: number,
  lateralOffset: number,
): THREE.CatmullRomCurve3 {
  const mid = from.clone().lerp(to, 0.5)
  mid.y += arcHeight

  // Perpendicular offset in xz plane to spread parallel lines
  const dir = new THREE.Vector3().subVectors(to, from).normalize()
  const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(lateralOffset)
  mid.add(perp)

  const q1 = from.clone().lerp(mid, 0.33)
  const q2 = mid.clone().lerp(to, 0.33).add(perp.clone().multiplyScalar(0.5))

  return new THREE.CatmullRomCurve3([from, q1, mid, q2, to])
}

/** Make a TubeGeometry-based line mesh */
function makeFieldLineMesh(curve: THREE.CatmullRomCurve3, color: THREE.Color, opacity: number): THREE.Line {
  const points = curve.getPoints(LINE_SEGMENTS)
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    linewidth: 1,
  })
  return new THREE.Line(geo, mat)
}

/** Make a particle mesh */
function makeParticleMesh(color: THREE.Color): THREE.Mesh {
  const geo = new THREE.SphereGeometry(PARTICLE_RADIUS, 6, 5)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.92,
  })
  return new THREE.Mesh(geo, mat)
}

/** Make polarity glow sphere */
function makePolarityGlow(color: THREE.Color): THREE.Mesh {
  const geo = new THREE.SphereGeometry(GLOW_RADIUS, 8, 6)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  })
  return new THREE.Mesh(geo, mat)
}

/** Number of field lines based on strength */
function lineCount(strength: number): number {
  if (strength >= 0.7) return 5
  if (strength >= 0.35) return 3
  return 1
}

/** Particle speed based on strength */
function particleSpeed(strength: number): number {
  if (strength >= 0.7) return 0.006
  if (strength >= 0.35) return 0.004
  return 0.0022
}

/** Arc height based on distance + strength */
function arcHeightFor(from: THREE.Vector3, to: THREE.Vector3, strength: number): number {
  const dist = from.distanceTo(to)
  return dist * 0.18 * (0.5 + strength * 0.8)
}

// ── Derive field sources from world data ──────────────────────────────────────

function deriveFieldSources(data: NWWorldData): FieldSource[] {
  const sources: FieldSource[] = []

  // ── 1. High-value active projects → PULL crew, materials, attention ─────────
  const activeProjects = data.projects.filter(
    p => p.status === 'in_progress' || p.status === 'approved'
  )
  const maxValue = Math.max(...activeProjects.map(p => p.contract_value), 1)

  for (const p of activeProjects) {
    const pos2d = seededPosition(p.id)
    const h = contractValueToHeight(p.contract_value)
    const pos = new THREE.Vector3(pos2d.x, h + 2, pos2d.z)
    const strength = Math.min(p.contract_value / maxValue, 1)

    // Pulls crew from HQ, materials from west, attention from NEXUS
    const targets: FieldTarget[] = [
      { position: HQ_POS,    label: 'Crew / Operations' },
      { position: new THREE.Vector3(-185, 2, pos2d.z * 0.5), label: 'Materials Supply' },
    ]
    if (strength >= 0.5) {
      targets.push({ position: NEXUS_POS, label: 'NEXUS Attention' })
    }

    const pullCount = targets.length
    const pushCount = 0
    const polarity: PolarityType = pullCount > pushCount ? 'negative' : 'neutral'

    sources.push({
      id: `proj-pull-${p.id}`,
      label: p.name,
      position: pos,
      polarity,
      strength,
      targets,
      mode: 'pull',
      isProblemNode: p.health_score < 50,
    })
  }

  // ── 2. Overdue invoices → PULL collection effort ──────────────────────────
  const now = Date.now()
  const overdueInvoices = data.invoices.filter(inv => {
    if (inv.status === 'paid') return false
    if (!inv.due_date) return false
    return new Date(inv.due_date).getTime() < now
  })

  for (const inv of overdueInvoices) {
    const proj = data.projects.find(p => p.id === inv.project_id)
    const pos2d = proj ? seededPosition(proj.id) : { x: -30 + Math.sin(inv.id.charCodeAt(0)) * 20, z: 25 }
    const h = proj ? contractValueToHeight(proj.contract_value) : 4
    const invPos = new THREE.Vector3(pos2d.x, h + 6, pos2d.z)

    const daysPast = (now - new Date(inv.due_date!).getTime()) / 86_400_000
    const strength = Math.min(daysPast / 90, 1)

    sources.push({
      id: `inv-overdue-${inv.id}`,
      label: `Overdue Invoice $${inv.amount.toLocaleString()}`,
      position: invPos,
      polarity: 'negative',
      strength,
      targets: [{ position: HQ_POS, label: 'Collection Effort' }],
      mode: 'pull',
      isProblemNode: true,
    })
  }

  // ── 3. Hot leads → PULL sales attention toward SPARK ────────────────────
  // We approximate hot leads from hubEvents with event_type subscriber_joined
  const hotLeadCount = data.hubEvents.filter(e => e.event_type === 'subscriber_joined').length
  if (hotLeadCount > 0) {
    const strength = Math.min(hotLeadCount / 10, 1)
    sources.push({
      id: 'hot-leads',
      label: 'Hot Leads',
      position: new THREE.Vector3(30, 3, -80),
      polarity: 'negative',
      strength,
      targets: [{ position: SPARK_POS, label: 'SPARK Sales Attention' }],
      mode: 'pull',
      isProblemNode: false,
    })
  }

  // ── 4. Growing subscriptions → PULL support resources ────────────────────
  const subCount = data.accountingSignals.hubSubscriberCount
  if (subCount > 0) {
    const strength = Math.min(subCount / 20, 1)
    sources.push({
      id: 'subscriptions',
      label: `Subscriptions (${subCount})`,
      position: MRR_POS.clone(),
      polarity: subCount > 10 ? 'negative' : 'neutral',
      strength,
      targets: [{ position: HQ_POS, label: 'Support Resources' }],
      mode: 'pull',
      isProblemNode: false,
    })
  }

  // ── 5. Completed projects → PUSH freed crew to new projects ──────────────
  const completedProjects = data.projects.filter(p => p.status === 'completed')
  const inProgressIds = new Set(activeProjects.map(p => p.id))
  for (const cp of completedProjects.slice(0, 4)) {
    const cPos2d = seededPosition(cp.id)
    const cPos = new THREE.Vector3(cPos2d.x, 2, cPos2d.z)
    const strength = Math.min(cp.contract_value / maxValue, 1) * 0.7

    // Push crew toward active projects
    const nearbyActive = activeProjects.slice(0, 2)
    if (nearbyActive.length === 0) continue
    const targets: FieldTarget[] = nearbyActive.map(ap => {
      const ap2d = seededPosition(ap.id)
      return {
        position: new THREE.Vector3(ap2d.x, contractValueToHeight(ap.contract_value) + 2, ap2d.z),
        label: ap.name,
      }
    })

    sources.push({
      id: `proj-push-${cp.id}`,
      label: `Done: ${cp.name}`,
      position: cPos,
      polarity: 'positive',
      strength,
      targets,
      mode: 'push',
      isProblemNode: false,
    })
  }

  // ── 6. Paid invoices → PUSH cash to operations ────────────────────────────
  const recentPaid = data.invoices.filter(inv => inv.status === 'paid' && inv.paid_at)
  if (recentPaid.length > 0) {
    const totalPaid = recentPaid.reduce((s, i) => s + i.amount, 0)
    const strength = Math.min(totalPaid / 50000, 1)
    const avgPos = recentPaid.slice(0, 3).reduce(
      (acc, inv) => {
        const proj = data.projects.find(p => p.id === inv.project_id)
        if (proj) {
          const p2d = seededPosition(proj.id)
          acc.x += p2d.x
          acc.z += p2d.z
        }
        return acc
      },
      { x: -20, z: 20 },
    )
    avgPos.x /= Math.max(recentPaid.slice(0, 3).length, 1)
    avgPos.z /= Math.max(recentPaid.slice(0, 3).length, 1)

    sources.push({
      id: 'paid-invoices',
      label: `Paid Invoices $${totalPaid.toLocaleString()}`,
      position: new THREE.Vector3(avgPos.x, 3, avgPos.z),
      polarity: 'positive',
      strength,
      targets: [{ position: HQ_POS, label: 'Operations Cash' }],
      mode: 'push',
      isProblemNode: false,
    })
  }

  // ── 7. NEXUS recommendations → PUSH attention to recommended actions ──────
  if (data.accountingSignals.recentFeatureLaunches > 0) {
    const strength = Math.min(data.accountingSignals.recentFeatureLaunches / 5, 1)
    sources.push({
      id: 'nexus-recs',
      label: 'NEXUS Recommendations',
      position: NEXUS_POS.clone(),
      polarity: 'positive',
      strength,
      targets: [
        { position: HQ_POS, label: 'Ops Actions' },
        { position: SPARK_POS, label: 'Sales Actions' },
      ],
      mode: 'push',
      isProblemNode: false,
    })
  }

  return sources
}

// ── Component ──────────────────────────────────────────────────────────────────

export interface MagneticFieldLayerProps {
  visible?: boolean
}

export function MagneticFieldLayer({ visible = false }: MagneticFieldLayerProps) {
  const { scene } = useWorldContext()

  const fieldLinesRef  = useRef<FieldLine[]>([])
  const glowsRef       = useRef<PolarityGlow[]>([])
  const visibleRef     = useRef(visible)
  const hoveredIdRef   = useRef<string | null>(null)
  const sourcesRef     = useRef<FieldSource[]>([])
  const frameIdRef     = useRef<number>(0)
  const worldSpeedRef  = useRef<number>(1.0)

  // ── World speed subscription ───────────────────────────────────────────────
  useEffect(() => {
    function onSpeed(e: Event) {
      const ev = e as CustomEvent<{ factor: number }>
      if (ev.detail?.factor !== undefined) worldSpeedRef.current = ev.detail.factor
    }
    window.addEventListener('nw:world-speed-factor', onSpeed)
    return () => window.removeEventListener('nw:world-speed-factor', onSpeed)
  }, [])

  // ── Sync visible ref ───────────────────────────────────────────────────────
  useEffect(() => {
    visibleRef.current = visible
    // Show/hide all objects
    for (const fl of fieldLinesRef.current) {
      fl.lines.forEach(l => { l.visible = visible })
      fl.particles.forEach(p => { p.mesh.visible = visible })
    }
    for (const g of glowsRef.current) {
      g.mesh.visible = visible
    }
  }, [visible])

  // ── Dispose helper ─────────────────────────────────────────────────────────
  const disposeAll = useCallback(() => {
    for (const fl of fieldLinesRef.current) {
      fl.lines.forEach(l => {
        scene.remove(l)
        l.geometry.dispose()
        ;(l.material as THREE.Material).dispose()
      })
      fl.particles.forEach(p => {
        scene.remove(p.mesh)
        p.mesh.geometry.dispose()
        ;(p.mesh.material as THREE.Material).dispose()
      })
    }
    for (const g of glowsRef.current) {
      scene.remove(g.mesh)
      g.mesh.geometry.dispose()
      ;(g.mesh.material as THREE.Material).dispose()
    }
    fieldLinesRef.current = []
    glowsRef.current = []
  }, [scene])

  // ── Apply hover dimming ────────────────────────────────────────────────────
  const applyHoverDim = useCallback((hoveredId: string | null) => {
    for (const fl of fieldLinesRef.current) {
      const isHighlighted = hoveredId === null || fl.sourceId === hoveredId
      const targetOpacity = isHighlighted ? LINE_OPACITY_ON : LINE_OPACITY_DIM
      fl.lines.forEach(l => {
        const mat = l.material as THREE.LineBasicMaterial
        mat.opacity = targetOpacity
      })
      fl.particles.forEach(p => {
        const mat = p.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = isHighlighted ? 0.92 : 0.08
      })
    }
    for (const g of glowsRef.current) {
      const isHighlighted = hoveredId === null || g.sourceId === hoveredId
      const mat = g.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = isHighlighted ? 0.35 : 0.05
    }
  }, [])

  // ── Listen for hover events ────────────────────────────────────────────────
  useEffect(() => {
    function onHover(e: Event) {
      const ev = e as CustomEvent<{ entityId: string | null }>
      hoveredIdRef.current = ev.detail?.entityId ?? null
      applyHoverDim(hoveredIdRef.current)
    }
    window.addEventListener('nw:magnetic-hover', onHover)
    return () => window.removeEventListener('nw:magnetic-hover', onHover)
  }, [applyHoverDim])

  // ── Rebuild from world data ────────────────────────────────────────────────
  const rebuild = useCallback((data: NWWorldData) => {
    disposeAll()
    const sources = deriveFieldSources(data)
    sourcesRef.current = sources

    const newFieldLines: FieldLine[] = []
    const newGlows: PolarityGlow[] = []

    for (const src of sources) {
      // ── Polarity glow sphere at source base ─────────────────────────────
      if (src.polarity !== 'neutral') {
        const glowColor = src.polarity === 'positive' ? POSITIVE_GLOW : NEGATIVE_GLOW
        const glowMesh  = makePolarityGlow(glowColor)
        glowMesh.position.copy(src.position)
        glowMesh.position.y -= 1.5
        glowMesh.visible = visibleRef.current
        scene.add(glowMesh)
        newGlows.push({ mesh: glowMesh, sourceId: src.id })
      }

      // ── Field lines to each target ───────────────────────────────────────
      const count = lineCount(src.strength)
      const lineColor = src.mode === 'push' ? PUSH_LINE_COLOR : PULL_LINE_COLOR
      const speed     = particleSpeed(src.strength)
      const particleColor = src.isProblemNode ? RED_PARTICLE : TEAL_PARTICLE

      for (const target of src.targets) {
        // Source → target for pull; target → source for push (flip direction)
        const fromPos = src.mode === 'pull' ? target.position : src.position
        const toPos   = src.mode === 'pull' ? src.position    : target.position

        const arcH = arcHeightFor(fromPos, toPos, src.strength)

        const lines: THREE.Line[] = []
        let primaryCurve: THREE.CatmullRomCurve3 | null = null

        for (let i = 0; i < count; i++) {
          const lateralOff = (i - (count - 1) / 2) * FIELD_LINE_GAP
          const curve = buildFieldCurve(fromPos, toPos, arcH + i * 1.5, lateralOff)

          if (i === 0) primaryCurve = curve

          const lineMesh = makeFieldLineMesh(curve, lineColor, LINE_OPACITY_ON)
          lineMesh.visible = visibleRef.current
          scene.add(lineMesh)
          lines.push(lineMesh)
        }

        if (!primaryCurve) continue

        // ── Particles along the primary curve ───────────────────────────
        const numParticles = count + 1  // 2–6 particles
        const particles: FieldParticle[] = []
        for (let pi = 0; pi < numParticles; pi++) {
          const mesh = makeParticleMesh(particleColor)
          mesh.visible = visibleRef.current
          // Stagger starting positions
          const t0 = pi / numParticles
          const startPos = primaryCurve.getPoint(t0)
          mesh.position.copy(startPos)
          scene.add(mesh)
          particles.push({
            mesh,
            t: t0,
            speed,
            active: true,
            restartCountdown: 0,
          })
        }

        newFieldLines.push({
          sourceId: src.id,
          lines,
          curve: primaryCurve,
          particles,
          isPull: src.mode === 'pull',
          isProblemNode: src.isProblemNode,
          opacity: LINE_OPACITY_ON,
        })
      }
    }

    fieldLinesRef.current = newFieldLines
    glowsRef.current = newGlows

    // Register particles for budget tracking
    const totalParticleCount = newFieldLines.reduce((s, fl) => s + fl.particles.length, 0)
    registerParticles('magnetic-fields', 'Magnetic Fields', totalParticleCount)

    // Apply current hover state
    applyHoverDim(hoveredIdRef.current)
  }, [scene, disposeAll, applyHoverDim])

  // ── Subscribe to world data ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeWorldData(rebuild)
    return () => {
      unsub()
      unregisterParticles('magnetic-fields')
      disposeAll()
    }
  }, [rebuild, disposeAll])

  // ── Animation loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true

    function animate() {
      if (!active) return
      frameIdRef.current = requestAnimationFrame(animate)

      if (!visibleRef.current) return

      const speedMult = worldSpeedRef.current
      const t = Date.now() * 0.001

      for (const fl of fieldLinesRef.current) {
        // Animate polarity glows — gentle pulse
        // (we update per-source, not per-field-line, but the glow pulsing
        //  is applied globally via the glow mesh scale below)

        for (const p of fl.particles) {
          if (!p.active) {
            p.restartCountdown--
            if (p.restartCountdown <= 0) {
              p.active = true
              p.t = 0
            }
            continue
          }
          p.t += p.speed * speedMult
          if (p.t > 1) {
            p.t = 0
            // Brief pause before looping
            p.active = false
            p.restartCountdown = 10 + Math.floor(Math.random() * 20)
          }
          const pos = fl.curve.getPoint(Math.min(p.t, 1))
          p.mesh.position.copy(pos)
        }
      }

      // Pulse polarity glows gently
      const glowPulse = 0.3 + Math.sin(t * 1.8) * 0.12
      for (const g of glowsRef.current) {
        const mat = g.mesh.material as THREE.MeshBasicMaterial
        // Only pulse if not dimmed by hover
        if (mat.opacity > 0.1) {
          mat.opacity = 0.25 + glowPulse * 0.15
        }
        g.mesh.scale.setScalar(0.9 + Math.sin(t * 1.4 + g.mesh.position.x * 0.1) * 0.08)
      }
    }

    animate()
    return () => {
      active = false
      cancelAnimationFrame(frameIdRef.current)
    }
  }, [])

  // ── Click handler: dispatch influence data ─────────────────────────────────
  useEffect(() => {
    function onClick(e: Event) {
      const ev = e as CustomEvent<{ entityId: string }>
      const entityId = ev.detail?.entityId
      if (!entityId) return
      const src = sourcesRef.current.find(s => s.id === entityId)
      if (!src) return
      window.dispatchEvent(new CustomEvent('nw:magnetic-field-click', {
        detail: {
          id: src.id,
          label: src.label,
          mode: src.mode,
          polarity: src.polarity,
          strength: src.strength,
          pulling: src.mode === 'pull' ? src.targets.map(t => t.label) : [],
          pushing: src.mode === 'push' ? src.targets.map(t => t.label) : [],
          isProblemNode: src.isProblemNode,
        },
      }))
    }
    window.addEventListener('nw:magnetic-select', onClick)
    return () => window.removeEventListener('nw:magnetic-select', onClick)
  }, [])

  return null
}
