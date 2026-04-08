/**
 * SignalLayer.tsx — NW5: Anomaly detection visualization + Aurora metric bands.
 *
 * LIGHTNING: When a data anomaly exists (invoice overdue beyond normal pattern,
 * AR aging spike) a lightning bolt fires from the sky to that project's terrain
 * zone every 8–15 seconds per anomaly source.
 *
 * AURORA BANDS: 5 named ribbon planes across the sky, each 200 units wide.
 *   1. AR Aging Band        — overdue invoice ratio
 *   2. Labor Cost Ratio     — field log hours vs total contract value
 *   3. Pipeline Velocity    — in_progress projects / total active
 *   4. Collection Rate      — paid invoices / total invoices
 *   5. Hub MRR              — monthly recurring value from in_progress projects
 * Each band color encodes metric health: green (good) → red (bad).
 * Bands pulse with data rhythm (sinusoidal opacity + slight Y drift).
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWWorldData,
} from '../DataBridge'

// ── Aurora band layout ────────────────────────────────────────────────────────

interface AuroraBandCfg {
  name: string
  baseY: number
  zOffset: number
  rotX: number
  phaseOffset: number
}

const AURORA_BAND_CFGS: AuroraBandCfg[] = [
  { name: 'AR_AGING',          baseY: 66,  zOffset: -35,  rotX:  0.12, phaseOffset: 0.0 },
  { name: 'LABOR_COST_RATIO',  baseY: 72,  zOffset: -12,  rotX:  0.07, phaseOffset: 1.2 },
  { name: 'PIPELINE_VELOCITY', baseY: 78,  zOffset:  10,  rotX: -0.06, phaseOffset: 2.4 },
  { name: 'COLLECTION_RATE',   baseY: 84,  zOffset:  28,  rotX: -0.10, phaseOffset: 3.6 },
  { name: 'HUB_MRR',           baseY: 90,  zOffset:  45,  rotX:  0.08, phaseOffset: 4.8 },
]

// ── Lightning config ──────────────────────────────────────────────────────────

const LIGHTNING_SKY_Y    = 60
const LIGHTNING_MIN_SEC  = 8
const LIGHTNING_MAX_SEC  = 15
const LIGHTNING_DURATION = 0.45  // seconds a flash lives

// ── Types ─────────────────────────────────────────────────────────────────────

interface FlashRecord {
  line:     THREE.Line
  light:    THREE.PointLight
  timer:    number    // seconds remaining
  duration: number
}

interface AnomalySource {
  projectId: string
  x: number
  z: number
  nextFireMs: number  // performance.now() target
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Health 0–1 (0 = bad) → THREE.Color from red (#c83030) to green (#30c860). */
function healthColor(health: number): THREE.Color {
  const h = Math.max(0, Math.min(1, health))
  return new THREE.Color().setHSL(h * 0.33, 0.88, 0.52)
}

/** Random interval in milliseconds between LIGHTNING_MIN_SEC and LIGHTNING_MAX_SEC. */
function randLightningMs(): number {
  return (LIGHTNING_MIN_SEC + Math.random() * (LIGHTNING_MAX_SEC - LIGHTNING_MIN_SEC)) * 1000
}

/** Build a jagged 8-segment lightning path from (x, skyY, z) down to y ≈ 0. */
function buildLightningPts(x: number, z: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  const steps = 8
  for (let i = 0; i <= steps; i++) {
    const t  = i / steps
    const y  = LIGHTNING_SKY_Y * (1 - t)
    const jx = (i > 0 && i < steps) ? x + (Math.random() - 0.5) * 4 : x
    const jz = (i > 0 && i < steps) ? z + (Math.random() - 0.5) * 4 : z
    pts.push(new THREE.Vector3(jx, y, jz))
  }
  return pts
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SignalLayer({ visible = true }: { visible?: boolean }) {
  const { scene } = useWorldContext()
  const bandMeshesRef    = useRef<THREE.Mesh[]>([])
  const flashesRef       = useRef<FlashRecord[]>([])
  const anomalySourcesRef = useRef<AnomalySource[]>([])
  const visibleRef       = useRef(visible)
  const metricsRef       = useRef<number[]>([0.5, 0.5, 0.5, 0.5, 0.5])

  useEffect(() => {
    visibleRef.current = visible
    for (const m of bandMeshesRef.current) m.visible = visible
  }, [visible])

  // ── Compute metric health values (0–1, 1 = best) ─────────────────────────
  function computeMetrics(data: NWWorldData): number[] {
    const { projects, invoices, fieldLogs } = data
    const nowMs = Date.now()
    const OVERDUE_THRESHOLD = 30 * 24 * 3600 * 1000  // 30 days

    // 1. AR Aging: fraction of non-overdue invoices
    let overdueCount = 0
    for (const inv of invoices) {
      if (inv.status !== 'paid' && inv.due_date) {
        const dueMs = new Date(inv.due_date).getTime()
        if (nowMs - dueMs > OVERDUE_THRESHOLD) overdueCount++
      }
    }
    const arAgingHealth = invoices.length > 0
      ? 1 - Math.min(overdueCount / invoices.length, 1)
      : 0.8

    // 2. Labor Cost Ratio: lower labor/contract ratio = healthier
    const totalHours    = fieldLogs.reduce((s, l) => s + l.hours, 0)
    const totalContract = projects.reduce((s, p) => s + p.contract_value, 0)
    const laborRatio    = totalContract > 0 ? (totalHours * 85) / totalContract : 0.5
    const laborHealth   = 1 - Math.min(laborRatio, 1)

    // 3. Pipeline Velocity: in_progress / all active
    const ACTIVE = new Set(['approved', 'in_progress', 'pending'])
    const activeCount     = projects.filter(p => ACTIVE.has(p.status)).length
    const inProgressCount = projects.filter(p => p.status === 'in_progress').length
    const pipelineHealth  = activeCount > 0 ? Math.min(inProgressCount / activeCount, 1) : 0.5

    // 4. Collection Rate: paid / total invoices
    const paidCount       = invoices.filter(i => i.status === 'paid').length
    const collectionHealth = invoices.length > 0 ? paidCount / invoices.length : 0.6

    // 5. Hub MRR: normalized MRR from in_progress contracts (target = $50k)
    const mrrValue  = projects
      .filter(p => p.status === 'in_progress')
      .reduce((s, p) => s + p.contract_value, 0)
    const mrrHealth = Math.min(mrrValue / 50000, 1)

    return [arAgingHealth, laborHealth, pipelineHealth, collectionHealth, mrrHealth]
  }

  // ── Detect projects with anomalies ────────────────────────────────────────
  function detectAnomalies(data: NWWorldData): AnomalySource[] {
    const sources: AnomalySource[] = []
    const OVERDUE_MS = 15 * 24 * 3600 * 1000  // 15 days
    const nowMs      = Date.now()
    const nowPerf    = performance.now()

    const overdueProjects = new Set<string>()
    for (const inv of data.invoices) {
      if (!inv.project_id) continue
      if (inv.status !== 'paid' && inv.due_date) {
        if (nowMs - new Date(inv.due_date).getTime() > OVERDUE_MS) {
          overdueProjects.add(inv.project_id)
        }
      }
    }

    for (const projectId of overdueProjects) {
      const { x, z } = seededPosition(projectId)
      sources.push({ projectId, x, z, nextFireMs: nowPerf + randLightningMs() })
    }

    // Fallback: pick first 2 projects if no anomalies
    if (sources.length === 0 && data.projects.length > 0) {
      for (const proj of data.projects.slice(0, 2)) {
        const { x, z } = seededPosition(proj.id)
        sources.push({ projectId: proj.id, x, z, nextFireMs: nowPerf + randLightningMs() })
      }
    }

    // Guaranteed minimum for visual demo
    if (sources.length === 0) {
      sources.push({ projectId: 'synthetic_0', x: 0,   z: 0,   nextFireMs: nowPerf + randLightningMs() })
      sources.push({ projectId: 'synthetic_1', x: 30,  z: -20, nextFireMs: nowPerf + randLightningMs() * 0.6 })
    }

    return sources
  }

  // ── Build aurora band meshes ──────────────────────────────────────────────
  function buildBands(metrics: number[]) {
    for (const m of bandMeshesRef.current) {
      scene.remove(m)
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
    bandMeshesRef.current = []

    for (let i = 0; i < AURORA_BAND_CFGS.length; i++) {
      const cfg    = AURORA_BAND_CFGS[i]
      const health = metrics[i] ?? 0.5

      const geo = new THREE.PlaneGeometry(200, 8)
      const col = healthColor(health)
      const mat = new THREE.MeshBasicMaterial({
        color:       col,
        transparent: true,
        opacity:     0.14 + health * 0.12,
        side:        THREE.DoubleSide,
        depthWrite:  false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(0, cfg.baseY, cfg.zOffset)
      mesh.rotation.x = cfg.rotX
      mesh.visible = visible
      scene.add(mesh)
      bandMeshesRef.current.push(mesh)
    }
  }

  // ── Subscribe to world data ───────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeWorldData((data) => {
      const metrics = computeMetrics(data)
      metricsRef.current = metrics
      buildBands(metrics)
      anomalySourcesRef.current = detectAnomalies(data)
    })
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Per-frame update ──────────────────────────────────────────────────────
  useEffect(() => {
    let prevMs = performance.now()

    function onFrame() {
      const nowMs  = performance.now()
      const delta  = (nowMs - prevMs) / 1000
      prevMs = nowMs
      const nowSec = nowMs * 0.001

      // Animate aurora bands
      if (visibleRef.current) {
        for (let i = 0; i < bandMeshesRef.current.length; i++) {
          const mesh   = bandMeshesRef.current[i]
          const cfg    = AURORA_BAND_CFGS[i]
          const health = metricsRef.current[i] ?? 0.5
          const mat    = mesh.material as THREE.MeshBasicMaterial

          // Pulse opacity with data rhythm
          const pulse  = 0.12 + health * 0.12 + Math.sin(nowSec * 0.75 + cfg.phaseOffset) * 0.06
          mat.opacity  = Math.max(0.04, pulse)

          // Slight Y drift
          mesh.position.y = cfg.baseY + Math.sin(nowSec * 0.28 + cfg.phaseOffset) * 0.7

          // Hue pulse (subtle)
          const hueShift = Math.sin(nowSec * 0.4 + cfg.phaseOffset) * 0.015
          mat.color.setHSL(health * 0.33 + hueShift, 0.88, 0.52)
        }

        // Check and fire lightning from anomaly sources
        for (const src of anomalySourcesRef.current) {
          if (nowMs >= src.nextFireMs) {
            fireLightning(src.x, src.z)
            src.nextFireMs = nowMs + randLightningMs()
          }
        }
      }

      // Animate active lightning flashes (always, even if toggled off, to clean up)
      for (let i = flashesRef.current.length - 1; i >= 0; i--) {
        const flash = flashesRef.current[i]
        flash.timer -= delta
        if (flash.timer <= 0) {
          scene.remove(flash.line)
          scene.remove(flash.light)
          flash.line.geometry.dispose()
          ;(flash.line.material as THREE.Material).dispose()
          flash.light.dispose()
          flashesRef.current.splice(i, 1)
        } else {
          const t = flash.timer / flash.duration
          ;(flash.line.material as THREE.LineBasicMaterial).opacity = t * 0.88
          flash.light.intensity = t * 22
        }
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Fire one lightning bolt ───────────────────────────────────────────────
  function fireLightning(x: number, z: number) {
    const pts = buildLightningPts(x, z)
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color:       0xaaaaff,
      transparent: true,
      opacity:     0.88,
      depthWrite:  false,
    })
    const line = new THREE.Line(geo, mat)
    scene.add(line)

    // Impact flash light
    const light = new THREE.PointLight(0x8888ff, 22, 90)
    light.position.set(x, 2, z)
    scene.add(light)

    flashesRef.current.push({
      line,
      light,
      timer:    LIGHTNING_DURATION,
      duration: LIGHTNING_DURATION,
    })
  }

  return null
}
