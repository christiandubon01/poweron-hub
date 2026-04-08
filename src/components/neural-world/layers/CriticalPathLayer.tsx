/**
 * CriticalPathLayer.tsx — NW3: Flowing particle rivers for the Critical Path layer.
 *
 * Rivers = payment pipelines.
 * - One river per active project that has at least one invoice.
 * - Particles (200/river) flow along a CatmullRomCurve3 from the project's
 *   mountain base toward the world's central collection point (0, 0.5, 0).
 * - River width  : contract_value / 10000 → clamped 0.2–2.0 units (drives particle size)
 * - Flow speed   : paid invoices / total invoices ratio → 0.05 (all pending) to 0.25 (all paid)
 * - Color:
 *     fully paid    → cold white-blue  #a0d0ff
 *     partially paid→ cyan             #40c0a0
 *     pending       → amber            #c09020
 *     overdue       → pulsing red      #c04020
 * - Celebration pulse: when a project transitions to fully paid, speed × 3 for 3 s,
 *   color brightens to a fast white-blue pulse.
 * - Responds to `visible` prop for HUD layer toggle.
 *
 * NW6: Responds to 'nw:scenario-override' events — flow speed scales with height multiplier
 *      (taller mountain = more active project = faster river throughput).
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWProject,
  type NWInvoice,
  type NWWorldData,
} from '../DataBridge'

// ── Constants ─────────────────────────────────────────────────────────────────

const PARTICLE_COUNT = 200
const CENTER = new THREE.Vector3(0, 0.5, 0)

// Color palette
const COLOR_FULLY_PAID   = new THREE.Color(0xa0d0ff)
const COLOR_PARTIAL_PAID = new THREE.Color(0x40c0a0)
const COLOR_PENDING      = new THREE.Color(0xc09020)
const COLOR_OVERDUE      = new THREE.Color(0xc04020)

// Active statuses that produce rivers (exclude lead/estimate/cancelled)
const ACTIVE_STATUSES = new Set([
  'in_progress',
  'approved',
  'pending',
  'on_hold',
  'completed',
])

// ── Types ─────────────────────────────────────────────────────────────────────

interface RiverData {
  projectId: string
  points: THREE.Points
  positions: Float32Array
  tValues: Float32Array
  curve: THREE.CatmullRomCurve3
  speed: number
  baseSpeed: number
  color: THREE.Color
  isOverdue: boolean
  fullyPaid: boolean
  celebrationTimer: number // seconds remaining in celebration pulse
}

interface PaymentInfo {
  paidRatio: number
  isOverdue: boolean
  fullyPaid: boolean
  color: THREE.Color
}

// ── Payment helpers ───────────────────────────────────────────────────────────

function calcPaymentInfo(projectId: string, invoices: NWInvoice[]): PaymentInfo {
  const projectInvoices = invoices.filter(inv => inv.project_id === projectId)

  if (projectInvoices.length === 0) {
    return { paidRatio: 0, isOverdue: false, fullyPaid: false, color: COLOR_PENDING.clone() }
  }

  const now = Date.now()
  let paidCount = 0
  let overdueCount = 0

  for (const inv of projectInvoices) {
    if (inv.status === 'paid') {
      paidCount++
    }
    const pastDue =
      inv.status !== 'paid' &&
      inv.due_date !== null &&
      new Date(inv.due_date).getTime() < now
    if (inv.status === 'overdue' || pastDue) {
      overdueCount++
    }
  }

  const paidRatio = paidCount / projectInvoices.length
  const isOverdue = overdueCount > 0
  const fullyPaid = paidRatio >= 1.0

  let color: THREE.Color
  if (isOverdue) {
    color = COLOR_OVERDUE.clone()
  } else if (fullyPaid) {
    color = COLOR_FULLY_PAID.clone()
  } else if (paidRatio > 0) {
    color = COLOR_PARTIAL_PAID.clone()
  } else {
    color = COLOR_PENDING.clone()
  }

  return { paidRatio, isOverdue, fullyPaid, color }
}

function calcRiverWidth(contractValue: number): number {
  // contract_value / 10000 → clamped 0.2–2.0
  const raw = contractValue / 10000
  return Math.max(0.2, Math.min(2.0, raw))
}

// ── Deterministic midpoint for curve ─────────────────────────────────────────

function buildRiverCurve(x: number, z: number, projectId: string): THREE.CatmullRomCurve3 {
  // Derive a deterministic mid-point offset from the project ID so the curves
  // are stable across data refreshes.
  const mid = seededPosition(projectId + '_nw3_mid')
  const midX = x * 0.5 + mid.x * 0.06  // ±4.8 units offset
  const midZ = z * 0.5 + mid.z * 0.06

  const start = new THREE.Vector3(x, 0.3, z)
  const ctrl  = new THREE.Vector3(midX, 1.2, midZ)
  const end   = CENTER.clone()

  return new THREE.CatmullRomCurve3([start, ctrl, end])
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CriticalPathLayerProps {
  visible: boolean
}

export function CriticalPathLayer({ visible }: CriticalPathLayerProps) {
  const { scene, applyScenario } = useWorldContext()

  const riversRef        = useRef<RiverData[]>([])
  const frameHandlerRef  = useRef<(() => void) | null>(null)
  const clockRef         = useRef(new THREE.Clock())
  const elapsedRef       = useRef(0)
  const visibleRef       = useRef(visible)

  // NW6: scenario override speeds — projectId → heightMultiplier
  const scenarioOverridesRef = useRef<Record<string, number>>({})
  const applyScenarioRef = useRef(applyScenario)
  applyScenarioRef.current = applyScenario

  // Keep visibility in sync without rebuilding rivers
  useEffect(() => {
    visibleRef.current = visible
    for (const r of riversRef.current) {
      r.points.visible = visible
    }
  }, [visible])

  // ── Build rivers ───────────────────────────────────────────────────────────

  function buildRivers(projects: NWProject[], invoices: NWInvoice[]) {
    disposeRivers()
    const rivers: RiverData[] = []

    for (const project of projects) {
      if (!ACTIVE_STATUSES.has(project.status)) continue

      const projectInvoices = invoices.filter(inv => inv.project_id === project.id)
      if (projectInvoices.length === 0) continue

      const { x, z } = seededPosition(project.id)
      const payInfo = calcPaymentInfo(project.id, invoices)
      const riverWidth = calcRiverWidth(project.contract_value)

      // Flow speed: low paid ratio = slow, high = fast
      const baseSpeed = 0.05 + payInfo.paidRatio * 0.20

      const curve = buildRiverCurve(x, z, project.id)

      // Initialise particle t values spread randomly along the path
      const positions = new Float32Array(PARTICLE_COUNT * 3)
      const tValues   = new Float32Array(PARTICLE_COUNT)

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        tValues[i] = i / PARTICLE_COUNT  // evenly spaced initial distribution
        const pt = curve.getPoint(tValues[i])
        positions[i * 3]     = pt.x
        positions[i * 3 + 1] = pt.y
        positions[i * 3 + 2] = pt.z
      }

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

      const mat = new THREE.PointsMaterial({
        color: payInfo.color,
        size: Math.max(0.08, riverWidth * 0.12),
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        sizeAttenuation: true,
      })

      const pts = new THREE.Points(geo, mat)
      pts.visible = visibleRef.current
      pts.userData.projectId = project.id
      scene.add(pts)

      rivers.push({
        projectId: project.id,
        points: pts,
        positions,
        tValues,
        curve,
        speed: baseSpeed,
        baseSpeed,
        color: payInfo.color.clone(),
        isOverdue: payInfo.isOverdue,
        fullyPaid: payInfo.fullyPaid,
        celebrationTimer: 0,
      })
    }

    riversRef.current = rivers
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  function disposeRivers() {
    for (const r of riversRef.current) {
      scene.remove(r.points)
      r.points.geometry.dispose()
      ;(r.points.material as THREE.PointsMaterial).dispose()
    }
    riversRef.current = []
  }

  // ── Frame handler ──────────────────────────────────────────────────────────

  function setupFrameHandler() {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
    }

    clockRef.current.start()
    elapsedRef.current = 0

    const handler = () => {
      const delta = clockRef.current.getDelta()
      elapsedRef.current += delta

      if (!visibleRef.current) return

      for (const river of riversRef.current) {
        const mat = river.points.material as THREE.PointsMaterial

        // ── Overdue: pulsing red ─────────────────────────────────────────
        if (river.isOverdue) {
          const pulse = 0.5 + 0.5 * Math.sin(elapsedRef.current * 4.0)
          mat.color.setHex(0xc04020)
          mat.opacity = 0.45 + pulse * 0.45
        }

        // ── Celebration pulse ────────────────────────────────────────────
        if (river.celebrationTimer > 0) {
          river.celebrationTimer = Math.max(0, river.celebrationTimer - delta)
          if (river.celebrationTimer > 0) {
            river.speed = river.baseSpeed * 3.0
            const celebPulse = 0.75 + 0.25 * Math.sin(elapsedRef.current * 8.0)
            mat.color.setRGB(
              COLOR_FULLY_PAID.r * celebPulse,
              COLOR_FULLY_PAID.g * celebPulse,
              COLOR_FULLY_PAID.b * celebPulse,
            )
            mat.opacity = 0.9
          } else {
            // Return to normal after celebration
            river.speed = river.baseSpeed
            mat.color.copy(river.color)
            mat.opacity = 0.85
          }
        }

        // ── Advance particles along curve ────────────────────────────────
        // NW6: scale speed by scenario height multiplier if applicable
        const scenarioMult = scenarioOverridesRef.current[river.projectId] ?? 1.0
        const curSpeed = river.speed * scenarioMult
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          river.tValues[i] += curSpeed * delta
          if (river.tValues[i] > 1.0) river.tValues[i] -= 1.0
          const pt = river.curve.getPoint(river.tValues[i])
          river.positions[i * 3]     = pt.x
          river.positions[i * 3 + 1] = pt.y
          river.positions[i * 3 + 2] = pt.z
        }

        // Flag position buffer as dirty
        const attr = river.points.geometry.getAttribute('position') as THREE.BufferAttribute
        attr.needsUpdate = true
      }
    }

    window.addEventListener('nw:frame', handler)
    frameHandlerRef.current = handler
  }

  // ── Effect: subscribe to data updates ─────────────────────────────────────

  useEffect(() => {
    // Capture previously fully-paid project IDs so we can detect transitions
    const prevFullyPaidIds = new Set(
      riversRef.current.filter(r => r.fullyPaid).map(r => r.projectId)
    )
    const hadPreviousData = riversRef.current.length > 0

    const unsub = subscribeWorldData((data: NWWorldData) => {
      buildRivers(data.projects, data.invoices)
      setupFrameHandler()

      // Trigger celebration for projects that just became fully paid
      if (hadPreviousData) {
        for (const river of riversRef.current) {
          if (river.fullyPaid && !prevFullyPaidIds.has(river.projectId)) {
            river.celebrationTimer = 3.0
          }
        }
      }
    })

    // NW6: scenario override listener — instantly updates river speeds
    function onScenarioOverride(e: Event) {
      if (!applyScenarioRef.current) return
      const detail = (e as CustomEvent<{ overrides: Record<string, number> }>).detail
      scenarioOverridesRef.current = detail.overrides
    }

    function onScenarioActivate(e: Event) {
      if (!applyScenarioRef.current) return
      const detail = (e as CustomEvent<{ active: boolean }>).detail
      if (!detail.active) {
        scenarioOverridesRef.current = {}
      }
    }

    window.addEventListener('nw:scenario-override', onScenarioOverride)
    window.addEventListener('nw:scenario-activate', onScenarioActivate)

    return () => {
      unsub()
      disposeRivers()
      if (frameHandlerRef.current) {
        window.removeEventListener('nw:frame', frameHandlerRef.current)
        frameHandlerRef.current = null
      }
      window.removeEventListener('nw:scenario-override', onScenarioOverride)
      window.removeEventListener('nw:scenario-activate', onScenarioActivate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  return null
}
