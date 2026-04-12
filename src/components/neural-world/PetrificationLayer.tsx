/**
 * PetrificationLayer.tsx — NW67: Stalled-Project Stone Transformation.
 *
 * Projects that stall begin turning to stone. The longer they sit idle,
 * the more petrified they become — a visceral warning system.
 *
 * STAGES (based on days since last field_log / invoice / crew activity):
 *   Stage 0  (<7 days)     — Active. No petrification.
 *   Stage 1  (7–14 days)   — Gray stone patches at mountain base (20% blend).
 *   Stage 2  (14–30 days)  — Stone creeps to mid-height, full desaturation, dust at base.
 *   Stage 3  (30–60 days)  — Fully petrified: entire mountain gray, crack lines, no glow.
 *   Stage 4  (60+ days)    — Crumbling: rock particles fall from edges every few seconds.
 *
 * REVIVAL:
 *   When activity resumes (idle_days drops below threshold), the stone
 *   shatters in a 2-second dramatic reveal: cracks burst outward, vibrant
 *   mountain color pulses through, and a particle burst erupts upward.
 *
 * DATA SOURCE:
 *   last_activity_date = max(field_logs.log_date, invoices.created_at,
 *                            invoices.paid_at, projects.created_at)
 *
 * INTERACTION:
 *   Click a petrified mountain overlay → floating panel shows:
 *     - Days idle, last activity date, last activity type
 *     - Suggested next action ("Log field hours", "Send invoice", etc.)
 *
 * ARCHITECTURE:
 *   - Adds overlay geometry at project mountain positions (west continent)
 *   - Does NOT modify WestContinentLayer meshes
 *   - Listens to nw:frame for per-frame animation
 *   - Click detection via renderer canvas raycaster
 *   - All THREE.js objects disposed on unmount
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWProject,
  type NWInvoice,
  type NWFieldLog,
  type NWWorldData,
} from './DataBridge'
import { getNodePosition } from './NodePositionStore'
import { registerParticles, unregisterParticles } from './ParticleManager'
import { makeLabel, type NWLabel } from './utils/makeLabel'

// ── Constants ──────────────────────────────────────────────────────────────────

const WEST_X_MIN = -185
const WEST_X_MAX = -35

const STAGE_1_DAYS = 7
const STAGE_2_DAYS = 14
const STAGE_3_DAYS = 30
const STAGE_4_DAYS = 60

/** Base color tones for each petrification stage */
const STONE_COLORS = {
  stage1Base: new THREE.Color(0x6a6a6a),   // gray patches
  stage2Mid:  new THREE.Color(0x555555),   // desaturated mid
  stage3Full: new THREE.Color(0x4a4848),   // full stone, slightly warm-gray
  stage4Crumble: new THREE.Color(0x3e3c3c), // darkened crumble
} as const

const REVIVAL_DURATION_MS = 2000

const DUST_PARTICLE_COUNT_REQUESTED = 60
const CRUMBLE_PARTICLE_COUNT_REQUESTED = 80
const REVIVAL_PARTICLE_COUNT_REQUESTED = 120

// Crack color
const CRACK_COLOR = 0x1a1510

// Warning exclamation color
const WARN_COLOR = '#ff3333'

// ── Types ──────────────────────────────────────────────────────────────────────

type PetriStage = 0 | 1 | 2 | 3 | 4

interface PetrificationState {
  projectId: string
  projectName: string
  idleDays: number
  stage: PetriStage
  lastActivityDate: string | null
  lastActivityType: 'field_log' | 'invoice' | 'created' | 'none'
  contractValue: number
}

interface ProjectOverlay {
  /** Base stone ring — stage 1 */
  baseRing: THREE.Mesh | null
  /** Mid stone cylinder — stage 2 */
  midStone: THREE.Mesh | null
  /** Full stone cone — stage 3 */
  fullStone: THREE.Mesh | null
  /** Crack line group — stage 3 */
  cracks: THREE.Line[]
  /** Dust particle system — stage 2+ */
  dustPoints: THREE.Points | null
  dustCount: number
  dustVelocities: Float32Array | null
  /** Crumble particle system — stage 4 */
  crumblePoints: THREE.Points | null
  crumbleCount: number
  crumbleVelocities: Float32Array | null
  crumbleTimer: number
  /** Revival burst particles */
  revivePoints: THREE.Points | null
  reviveCount: number
  reviveVelocities: Float32Array | null
  reviveStartTime: number
  reviving: boolean
  /** Warning "!" sprite */
  warnSprite: NWLabel | null
  /** Hit mesh for click detection */
  hitMesh: THREE.Mesh | null
  /** World center position */
  worldX: number
  worldZ: number
  mountainHeight: number
}

interface ClickPanelData {
  projectName: string
  idleDays: number
  lastActivityDate: string | null
  lastActivityType: string
  stage: PetriStage
  suggestedAction: string
  screenX: number
  screenY: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function projectPos(id: string): { x: number; z: number } {
  const seed = seededPosition(id)
  return getNodePosition(`P_${id}`, seed.x, seed.z)
}

/** ISO date string → Date, null-safe */
function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

/** Days between two dates (positive = date1 is older) */
function daysBetween(date1: Date, date2: Date): number {
  return (date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24)
}

/** Classify idle days into petrification stage */
function toStage(idleDays: number): PetriStage {
  if (idleDays < STAGE_1_DAYS)  return 0
  if (idleDays < STAGE_2_DAYS)  return 1
  if (idleDays < STAGE_3_DAYS)  return 2
  if (idleDays < STAGE_4_DAYS)  return 3
  return 4
}

/** Pick the most informative suggested next action for a stalled project */
function suggestedAction(state: PetrificationState): string {
  switch (state.stage) {
    case 1: return 'Log field hours to keep this project alive.'
    case 2: return 'Record a field log or send an invoice to revive momentum.'
    case 3: return 'URGENT: Schedule crew or send invoice immediately.'
    case 4: return 'CRITICAL: Project is crumbling — log activity NOW or close it out.'
    default: return 'Project is active.'
  }
}

/** Format last activity type to human-readable string */
function formatActivityType(t: PetrificationState['lastActivityType']): string {
  switch (t) {
    case 'field_log': return 'Field Log'
    case 'invoice':   return 'Invoice'
    case 'created':   return 'Project Created'
    default:          return 'Unknown'
  }
}

/** Build a procedural stone vein texture on a canvas */
function buildStoneTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width  = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Base gray fill
  ctx.fillStyle = '#5c5a5a'
  ctx.fillRect(0, 0, size, size)

  // Subtle lighter patches
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 8 + Math.random() * 18
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, 'rgba(100,98,96,0.4)')
    grad.addColorStop(1, 'rgba(100,98,96,0)')
    ctx.fillStyle = grad
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // Dark vein lines
  ctx.strokeStyle = 'rgba(30,28,26,0.5)'
  ctx.lineWidth = 1
  for (let i = 0; i < 8; i++) {
    ctx.beginPath()
    const sx = Math.random() * size
    const sy = Math.random() * size
    ctx.moveTo(sx, sy)
    // Jagged vein segments
    let cx = sx
    let cy = sy
    for (let s = 0; s < 5; s++) {
      cx += (Math.random() - 0.5) * 30
      cy += (Math.random() - 0.5) * 30
      ctx.lineTo(cx, cy)
    }
    ctx.stroke()
  }

  return new THREE.CanvasTexture(canvas)
}

/** Create stage-appropriate stone MeshStandardMaterial (matte, no specular) */
function stoneMat(stage: PetriStage, opacity = 1): THREE.MeshStandardMaterial {
  const colorMap: Record<number, THREE.Color> = {
    1: STONE_COLORS.stage1Base,
    2: STONE_COLORS.stage2Mid,
    3: STONE_COLORS.stage3Full,
    4: STONE_COLORS.stage4Crumble,
  }
  return new THREE.MeshStandardMaterial({
    color: colorMap[stage] ?? STONE_COLORS.stage3Full,
    roughness: 1.0,
    metalness: 0.0,
    emissive: new THREE.Color(0x000000),
    transparent: opacity < 1,
    opacity,
  })
}

/** Dispose a Three.js Mesh (geometry + material(s)) */
function disposeMesh(scene: THREE.Scene, mesh: THREE.Mesh | null): void {
  if (!mesh) return
  scene.remove(mesh)
  mesh.geometry.dispose()
  const m = mesh.material
  if (Array.isArray(m)) m.forEach(x => x.dispose())
  else (m as THREE.Material).dispose()
}

/** Dispose a Points object */
function disposePoints(scene: THREE.Scene, pts: THREE.Points | null): void {
  if (!pts) return
  scene.remove(pts)
  pts.geometry.dispose()
  ;(pts.material as THREE.Material).dispose()
}

/** Dispose a Line object */
function disposeLine(scene: THREE.Scene, line: THREE.Line | null): void {
  if (!line) return
  scene.remove(line)
  line.geometry.dispose()
  ;(line.material as THREE.Material).dispose()
}

/** Dispose a Sprite */
function disposeSprite(scene: THREE.Scene, sprite: THREE.Sprite | null): void {
  if (!sprite) return
  scene.remove(sprite)
  const mat = sprite.material as THREE.SpriteMaterial
  mat.map?.dispose()
  mat.dispose()
}

// ── Component ──────────────────────────────────────────────────────────────────

export function PetrificationLayer() {
  const { scene, camera, renderer } = useWorldContext()

  // Per-project overlay data
  const overlaysRef = useRef<Map<string, ProjectOverlay>>(new Map())

  // Petrification states computed from DataBridge
  const statesRef = useRef<Map<string, PetrificationState>>(new Map())

  // Prev stage per project — to detect revival (stage drops)
  const prevStagesRef = useRef<Map<string, PetriStage>>(new Map())

  // Stone texture (shared)
  const stoneTexRef = useRef<THREE.CanvasTexture | null>(null)

  const frameHandlerRef = useRef<((e: Event) => void) | null>(null)
  const elapsedRef = useRef(0)

  // Raycaster for click detection
  const raycasterRef = useRef(new THREE.Raycaster())

  // React panel state
  const [panel, setPanel] = useState<ClickPanelData | null>(null)

  // ── Stone texture (lazy init) ──────────────────────────────────────────────

  function getStoneTexture(): THREE.CanvasTexture {
    if (!stoneTexRef.current) {
      stoneTexRef.current = buildStoneTexture()
    }
    return stoneTexRef.current
  }

  // ── Compute petrification states from world data ───────────────────────────

  function computeStates(data: NWWorldData): Map<string, PetrificationState> {
    const now = new Date()
    const result = new Map<string, PetrificationState>()

    // Build latest-activity maps from field logs and invoices
    const latestFieldLog  = new Map<string, Date>()
    const latestInvoice   = new Map<string, Date>()

    for (const fl of data.fieldLogs) {
      if (!fl.project_id) continue
      const d = parseDate(fl.log_date)
      if (!d) continue
      const prev = latestFieldLog.get(fl.project_id)
      if (!prev || d > prev) latestFieldLog.set(fl.project_id, d)
    }

    for (const inv of data.invoices) {
      if (!inv.project_id) continue
      const d1 = parseDate(inv.created_at)
      const d2 = parseDate(inv.paid_at)
      const best = d1 && d2 ? (d1 > d2 ? d1 : d2) : (d1 ?? d2)
      if (!best) continue
      const prev = latestInvoice.get(inv.project_id)
      if (!prev || best > prev) latestInvoice.set(inv.project_id, best)
    }

    for (const proj of data.projects) {
      // Only consider active/in_progress projects (completed ones shouldn't petrify)
      if (proj.status === 'completed' || proj.status === 'cancelled') continue

      const { x, z } = projectPos(proj.id)
      // Only west-continent project mountains
      if (x < WEST_X_MIN || x > WEST_X_MAX) continue

      const flDate  = latestFieldLog.get(proj.id) ?? null
      const invDate = latestInvoice.get(proj.id)  ?? null
      const creDate = parseDate(proj.created_at)

      // Find best last-activity date and its type
      let bestDate: Date | null = null
      let bestType: PetrificationState['lastActivityType'] = 'none'

      if (flDate && (bestDate === null || flDate.getTime() > (bestDate as Date).getTime())) {
        bestDate = flDate
        bestType = 'field_log'
      }
      if (invDate && (bestDate === null || invDate.getTime() > (bestDate as Date).getTime())) {
        bestDate = invDate
        bestType = 'invoice'
      }
      if (!bestDate && creDate) {
        bestDate = creDate
        bestType = 'created'
      }

      const idleDays = bestDate ? daysBetween(bestDate, now) : 999
      const stage    = toStage(idleDays)

      result.set(proj.id, {
        projectId:        proj.id,
        projectName:      proj.name,
        idleDays:         Math.round(idleDays),
        stage,
        lastActivityDate: bestDate ? bestDate.toISOString().split('T')[0] : null,
        lastActivityType: bestType,
        contractValue:    proj.contract_value,
      })
    }

    return result
  }

  // ── Build / update overlay for a project ──────────────────────────────────

  function buildOverlay(state: PetrificationState): void {
    const { projectId, stage, contractValue } = state
    const { x, z } = projectPos(projectId)
    const mHeight   = contractValueToHeight(contractValue)
    const baseRadius = mHeight * 0.55 + 0.8

    // Ensure overlay entry
    let ov = overlaysRef.current.get(projectId)
    if (!ov) {
      ov = {
        baseRing: null, midStone: null, fullStone: null, cracks: [],
        dustPoints: null, dustCount: 0, dustVelocities: null,
        crumblePoints: null, crumbleCount: 0, crumbleVelocities: null,
        crumbleTimer: 0,
        revivePoints: null, reviveCount: 0, reviveVelocities: null,
        reviveStartTime: 0, reviving: false,
        warnSprite: null,
        hitMesh: null,
        worldX: x, worldZ: z, mountainHeight: mHeight,
      }
      overlaysRef.current.set(projectId, ov)
    }

    // Always update stored position/height
    ov.worldX = x
    ov.worldZ = z
    ov.mountainHeight = mHeight

    // ── Clear previous stone meshes if stage changed or dropped to 0 ──────

    if (stage === 0) {
      clearOverlay(projectId, false)
      return
    }

    // ── Stage 1: base ring ──────────────────────────────────────────────────
    if (stage >= 1) {
      if (!ov.baseRing) {
        const ringH   = mHeight * 0.25
        const ringGeo = new THREE.CylinderGeometry(
          baseRadius + 0.1, baseRadius + 0.4, ringH, 14, 1, true
        )
        const tex = getStoneTexture()
        const mat = new THREE.MeshStandardMaterial({
          map: tex,
          color: STONE_COLORS.stage1Base,
          roughness: 1.0,
          metalness: 0.0,
          transparent: true,
          opacity: 0.50,
          side: THREE.FrontSide,
        })
        const mesh = new THREE.Mesh(ringGeo, mat)
        mesh.position.set(x, ringH * 0.5, z)
        scene.add(mesh)
        ov.baseRing = mesh
      }
    } else if (ov.baseRing) {
      disposeMesh(scene, ov.baseRing)
      ov.baseRing = null
    }

    // ── Stage 2: mid stone + dust ───────────────────────────────────────────
    if (stage >= 2) {
      if (!ov.midStone) {
        const midH   = mHeight * 0.55
        const topRad = baseRadius * 0.45
        const geo    = new THREE.CylinderGeometry(topRad, baseRadius + 0.2, midH, 14, 1, true)
        const tex    = getStoneTexture()
        const mat    = new THREE.MeshStandardMaterial({
          map: tex,
          color: STONE_COLORS.stage2Mid,
          roughness: 1.0,
          metalness: 0.0,
          transparent: true,
          opacity: 0.65,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(x, midH * 0.5, z)
        scene.add(mesh)
        ov.midStone = mesh
      }

      // Dust particles at base
      if (!ov.dustPoints) {
        const allowed = registerParticles(
          `petri-dust-${projectId}`, `Petrification dust [${state.projectName}]`,
          DUST_PARTICLE_COUNT_REQUESTED
        )
        ov.dustCount = allowed

        if (allowed > 0) {
          const positions  = new Float32Array(allowed * 3)
          const velocities = new Float32Array(allowed * 3)
          for (let i = 0; i < allowed; i++) {
            const angle = Math.random() * Math.PI * 2
            const r     = baseRadius * (0.8 + Math.random() * 0.5)
            positions[i * 3]     = x + Math.cos(angle) * r
            positions[i * 3 + 1] = Math.random() * 0.6
            positions[i * 3 + 2] = z + Math.sin(angle) * r
            velocities[i * 3]     = (Math.random() - 0.5) * 0.01
            velocities[i * 3 + 1] = 0.01 + Math.random() * 0.02
            velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.01
          }
          const geo = new THREE.BufferGeometry()
          geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
          const mat = new THREE.PointsMaterial({
            color: 0x999490,
            size: 0.08,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
          })
          const pts = new THREE.Points(geo, mat)
          scene.add(pts)
          ov.dustPoints    = pts
          ov.dustVelocities = velocities
        }
      }
    } else {
      if (ov.midStone)  { disposeMesh(scene, ov.midStone);   ov.midStone = null }
      if (ov.dustPoints) { disposePoints(scene, ov.dustPoints); ov.dustPoints = null; ov.dustVelocities = null; unregisterParticles(`petri-dust-${projectId}`) }
    }

    // ── Stage 3: full stone cone + cracks ──────────────────────────────────
    if (stage >= 3) {
      if (!ov.fullStone) {
        const tex = getStoneTexture()
        const mat = new THREE.MeshStandardMaterial({
          map: tex,
          color: STONE_COLORS.stage3Full,
          roughness: 1.0,
          metalness: 0.0,
          transparent: true,
          opacity: 0.80,
        })
        const geo  = new THREE.ConeGeometry(baseRadius + 0.3, mHeight + 0.5, 14, 1)
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(x, (mHeight + 0.5) * 0.5, z)
        scene.add(mesh)
        ov.fullStone = mesh
      }

      // Crack lines (built once)
      if (ov.cracks.length === 0) {
        const crackCount = 4
        for (let c = 0; c < crackCount; c++) {
          const angle  = (c / crackCount) * Math.PI * 2 + Math.random() * 0.5
          const pts: THREE.Vector3[] = []
          let cy = 0
          let cr = baseRadius * 0.9
          const steps = 5 + Math.floor(Math.random() * 4)
          for (let s = 0; s <= steps; s++) {
            const jitter = (Math.random() - 0.5) * 0.3
            pts.push(new THREE.Vector3(
              x + Math.cos(angle + jitter) * cr,
              cy,
              z + Math.sin(angle + jitter) * cr
            ))
            cy += mHeight / steps
            cr *= 0.75
          }
          const geo  = new THREE.BufferGeometry().setFromPoints(pts)
          const mat  = new THREE.LineBasicMaterial({ color: CRACK_COLOR, transparent: true, opacity: 0.7 })
          const line = new THREE.Line(geo, mat)
          scene.add(line)
          ov.cracks.push(line)
        }
      }
    } else {
      if (ov.fullStone) { disposeMesh(scene, ov.fullStone);   ov.fullStone = null }
      ov.cracks.forEach(l => disposeLine(scene, l))
      ov.cracks = []
    }

    // ── Stage 4: crumble particles ─────────────────────────────────────────
    if (stage >= 4) {
      if (!ov.crumblePoints) {
        const allowed = registerParticles(
          `petri-crumble-${projectId}`, `Petrification crumble [${state.projectName}]`,
          CRUMBLE_PARTICLE_COUNT_REQUESTED
        )
        ov.crumbleCount = allowed

        if (allowed > 0) {
          const positions  = new Float32Array(allowed * 3)
          const velocities = new Float32Array(allowed * 3)
          for (let i = 0; i < allowed; i++) {
            const angle = Math.random() * Math.PI * 2
            const r     = baseRadius * (0.7 + Math.random() * 0.4)
            const height = Math.random() * mHeight
            positions[i * 3]     = x + Math.cos(angle) * r
            positions[i * 3 + 1] = height
            positions[i * 3 + 2] = z + Math.sin(angle) * r
            // Fall downward with slight horizontal drift
            velocities[i * 3]     = (Math.random() - 0.5) * 0.04
            velocities[i * 3 + 1] = -(0.03 + Math.random() * 0.05)
            velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.04
          }
          const geo = new THREE.BufferGeometry()
          geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
          const mat = new THREE.PointsMaterial({
            color: 0x706860,
            size: 0.14,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
          })
          const pts = new THREE.Points(geo, mat)
          scene.add(pts)
          ov.crumblePoints    = pts
          ov.crumbleVelocities = velocities
          ov.crumbleTimer      = 0
        }
      }
    } else {
      if (ov.crumblePoints) {
        disposePoints(scene, ov.crumblePoints)
        ov.crumblePoints = null
        ov.crumbleVelocities = null
        unregisterParticles(`petri-crumble-${projectId}`)
      }
    }

    // ── Warning "!" sprite (stage 2+) ──────────────────────────────────────
    if (stage >= 2) {
      if (!ov.warnSprite) {
        const sprite = makeLabel('⚠', WARN_COLOR, { labelType: 'domain', yOffset: 0 })
        sprite.position.set(x, mHeight + 2.2, z)
        scene.add(sprite)
        ov.warnSprite = sprite
      }
    } else {
      if (ov.warnSprite) {
        disposeSprite(scene, ov.warnSprite)
        ov.warnSprite = null
      }
    }

    // ── Hit mesh for click detection (stage 1+, covers mountain) ──────────
    if (!ov.hitMesh) {
      const hitGeo = new THREE.CylinderGeometry(baseRadius + 0.5, baseRadius + 0.5, mHeight + 1, 8)
      const hitMat = new THREE.MeshBasicMaterial({ visible: false })
      const hit    = new THREE.Mesh(hitGeo, hitMat)
      hit.position.set(x, (mHeight + 1) * 0.5, z)
      hit.userData = { petrifiedProjectId: projectId }
      scene.add(hit)
      ov.hitMesh = hit
    }
  }

  // ── Clear overlay (full or partial) ───────────────────────────────────────

  function clearOverlay(projectId: string, keepHit = false): void {
    const ov = overlaysRef.current.get(projectId)
    if (!ov) return

    disposeMesh(scene, ov.baseRing);    ov.baseRing = null
    disposeMesh(scene, ov.midStone);    ov.midStone = null
    disposeMesh(scene, ov.fullStone);   ov.fullStone = null

    ov.cracks.forEach(l => disposeLine(scene, l))
    ov.cracks = []

    if (ov.dustPoints) {
      disposePoints(scene, ov.dustPoints)
      ov.dustPoints = null
      ov.dustVelocities = null
      unregisterParticles(`petri-dust-${projectId}`)
    }
    if (ov.crumblePoints) {
      disposePoints(scene, ov.crumblePoints)
      ov.crumblePoints = null
      ov.crumbleVelocities = null
      unregisterParticles(`petri-crumble-${projectId}`)
    }
    if (ov.revivePoints) {
      disposePoints(scene, ov.revivePoints)
      ov.revivePoints = null
      ov.reviveVelocities = null
      unregisterParticles(`petri-revive-${projectId}`)
    }

    disposeSprite(scene, ov.warnSprite)
    ov.warnSprite = null

    if (!keepHit && ov.hitMesh) {
      disposeMesh(scene, ov.hitMesh)
      ov.hitMesh = null
    }
  }

  // ── Trigger revival animation ──────────────────────────────────────────────

  function triggerRevival(projectId: string): void {
    const ov = overlaysRef.current.get(projectId)
    if (!ov || ov.reviving) return

    const { worldX: x, worldZ: z, mountainHeight: mHeight } = ov

    // Build revival burst particles
    const allowed = registerParticles(
      `petri-revive-${projectId}`, `Revival burst [${projectId}]`,
      REVIVAL_PARTICLE_COUNT_REQUESTED
    )
    ov.reviveCount = allowed

    if (allowed > 0) {
      const positions  = new Float32Array(allowed * 3)
      const velocities = new Float32Array(allowed * 3)
      const baseRadius = mHeight * 0.55 + 0.8

      for (let i = 0; i < allowed; i++) {
        const angle  = Math.random() * Math.PI * 2
        const r      = baseRadius * (0.3 + Math.random() * 0.6)
        const height = Math.random() * mHeight
        positions[i * 3]     = x + Math.cos(angle) * r
        positions[i * 3 + 1] = height
        positions[i * 3 + 2] = z + Math.sin(angle) * r

        // Burst outward + upward
        const speed = 0.08 + Math.random() * 0.12
        velocities[i * 3]     = Math.cos(angle) * speed * 0.8
        velocities[i * 3 + 1] = 0.06 + Math.random() * 0.1
        velocities[i * 3 + 2] = Math.sin(angle) * speed * 0.8
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const mat = new THREE.PointsMaterial({
        color: 0xffcc44,
        size: 0.18,
        transparent: true,
        opacity: 1.0,
        depthWrite: false,
      })
      const pts = new THREE.Points(geo, mat)
      scene.add(pts)
      ov.revivePoints    = pts
      ov.reviveVelocities = velocities
    }

    ov.reviving       = true
    ov.reviveStartTime = performance.now()

    // Clear stone visuals immediately (dramatic crack-away effect simulated
    // by fading out stone + particle burst)
    clearOverlay(projectId, true)  // keep hit mesh
  }

  // ── Per-frame animation handler ────────────────────────────────────────────

  function onFrame(e: Event): void {
    const dt: number = (e as CustomEvent<{ dt: number }>).detail?.dt ?? 0.016
    elapsedRef.current += dt

    const now = performance.now()
    const wp  = new THREE.Vector3()

    for (const [projectId, ov] of overlaysRef.current) {
      const state = statesRef.current.get(projectId)
      if (!state) continue

      // ── Revival animation ─────────────────────────────────────────────
      if (ov.reviving && ov.revivePoints && ov.reviveVelocities) {
        const t = (now - ov.reviveStartTime) / REVIVAL_DURATION_MS
        if (t >= 1.0) {
          // Revival complete — remove burst particles
          disposePoints(scene, ov.revivePoints)
          ov.revivePoints = null
          ov.reviveVelocities = null
          unregisterParticles(`petri-revive-${projectId}`)
          ov.reviving = false
          // Remove hit mesh (project is no longer petrified)
          disposeMesh(scene, ov.hitMesh)
          ov.hitMesh = null
        } else {
          const posAttr = ov.revivePoints.geometry.attributes['position'] as THREE.BufferAttribute
          const positions = posAttr.array as Float32Array
          const opacity = 1.0 - t
          ;(ov.revivePoints.material as THREE.PointsMaterial).opacity = Math.max(0, opacity)
          for (let i = 0; i < ov.reviveCount; i++) {
            positions[i * 3]     += ov.reviveVelocities[i * 3]     * dt * 60
            positions[i * 3 + 1] += ov.reviveVelocities[i * 3 + 1] * dt * 60
            positions[i * 3 + 2] += ov.reviveVelocities[i * 3 + 2] * dt * 60
            // gravity
            ov.reviveVelocities[i * 3 + 1] -= 0.002 * dt * 60
          }
          posAttr.needsUpdate = true
        }
      }

      if (ov.reviving) continue  // skip regular animation during revival

      // ── Dust particles (stage 2) ──────────────────────────────────────
      if (ov.dustPoints && ov.dustVelocities) {
        const posAttr = ov.dustPoints.geometry.attributes['position'] as THREE.BufferAttribute
        const positions = posAttr.array as Float32Array
        const { worldX: x, worldZ: z, mountainHeight: mHeight } = ov
        const maxY = mHeight * 0.4

        for (let i = 0; i < ov.dustCount; i++) {
          positions[i * 3]     += ov.dustVelocities[i * 3]     * dt * 60
          positions[i * 3 + 1] += ov.dustVelocities[i * 3 + 1] * dt * 60
          positions[i * 3 + 2] += ov.dustVelocities[i * 3 + 2] * dt * 60

          // Wrap: reset particles that drift too far up
          if (positions[i * 3 + 1] > maxY) {
            const angle = Math.random() * Math.PI * 2
            const baseRadius = mHeight * 0.55 + 0.8
            const r = baseRadius * (0.8 + Math.random() * 0.5)
            positions[i * 3]     = x + Math.cos(angle) * r
            positions[i * 3 + 1] = 0
            positions[i * 3 + 2] = z + Math.sin(angle) * r
          }
        }
        posAttr.needsUpdate = true
      }

      // ── Crumble particles (stage 4) ───────────────────────────────────
      if (ov.crumblePoints && ov.crumbleVelocities) {
        ov.crumbleTimer += dt
        const posAttr = ov.crumblePoints.geometry.attributes['position'] as THREE.BufferAttribute
        const positions = posAttr.array as Float32Array
        const { worldX: x, worldZ: z, mountainHeight: mHeight } = ov

        for (let i = 0; i < ov.crumbleCount; i++) {
          positions[i * 3]     += ov.crumbleVelocities[i * 3]     * dt * 60
          positions[i * 3 + 1] += ov.crumbleVelocities[i * 3 + 1] * dt * 60
          positions[i * 3 + 2] += ov.crumbleVelocities[i * 3 + 2] * dt * 60

          // Apply gravity
          ov.crumbleVelocities[i * 3 + 1] -= 0.0008 * dt * 60

          // Reset particles that hit the floor
          if (positions[i * 3 + 1] < -0.5) {
            // Every few seconds, respawn edge of mountain at random height
            const angle  = Math.random() * Math.PI * 2
            const baseRadius = mHeight * 0.55 + 0.8
            const r      = baseRadius * (0.85 + Math.random() * 0.2)
            const height = mHeight * (0.2 + Math.random() * 0.8)
            positions[i * 3]     = x + Math.cos(angle) * r
            positions[i * 3 + 1] = height
            positions[i * 3 + 2] = z + Math.sin(angle) * r

            ov.crumbleVelocities[i * 3]     = (Math.random() - 0.5) * 0.04
            ov.crumbleVelocities[i * 3 + 1] = -(0.02 + Math.random() * 0.04)
            ov.crumbleVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.04
          }
        }
        posAttr.needsUpdate = true
      }

      // ── Stone pulse (stage 3 crack glow ripple) ───────────────────────
      if (ov.cracks.length > 0 && state.stage === 3) {
        const pulse = (Math.sin(elapsedRef.current * 1.8) * 0.5 + 0.5) * 0.35 + 0.35
        for (const crack of ov.cracks) {
          ;(crack.material as THREE.LineBasicMaterial).opacity = pulse
        }
      }

      // ── Warn sprite billboard ─────────────────────────────────────────
      if (ov.warnSprite) {
        ov.warnSprite.getWorldPosition(wp)
        ;(ov.warnSprite as NWLabel).updateVisibility(camera, wp)
        // Hover float
        ov.warnSprite.position.y = ov.mountainHeight + 2.2 + Math.sin(elapsedRef.current * 2.5) * 0.15
      }
    }
  }

  // ── Click detection ────────────────────────────────────────────────────────

  const onClick = useCallback((e: MouseEvent) => {
    const canvas = renderer.domElement
    const rect   = canvas.getBoundingClientRect()
    const mouse  = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )

    raycasterRef.current.setFromCamera(mouse, camera)

    const hitMeshes: THREE.Mesh[] = []
    for (const ov of overlaysRef.current.values()) {
      if (ov.hitMesh) hitMeshes.push(ov.hitMesh)
    }

    const hits = raycasterRef.current.intersectObjects(hitMeshes, false)
    if (hits.length === 0) {
      setPanel(null)
      return
    }

    const projectId = hits[0].object.userData['petrifiedProjectId'] as string | undefined
    if (!projectId) return

    const state = statesRef.current.get(projectId)
    if (!state || state.stage === 0) return

    // Project 3D hit point to screen coordinates
    const hitPoint = hits[0].point.clone()
    hitPoint.project(camera)
    const canvas2  = renderer.domElement
    const rect2    = canvas2.getBoundingClientRect()
    const sx = (hitPoint.x  *  0.5 + 0.5) * rect2.width  + rect2.left
    const sy = (hitPoint.y * -0.5 + 0.5) * rect2.height + rect2.top

    setPanel({
      projectName:      state.projectName,
      idleDays:         state.idleDays,
      lastActivityDate: state.lastActivityDate,
      lastActivityType: formatActivityType(state.lastActivityType),
      stage:            state.stage,
      suggestedAction:  suggestedAction(state),
      screenX: Math.min(sx, window.innerWidth  - 300),
      screenY: Math.min(sy, window.innerHeight - 220),
    })
  }, [camera, renderer])

  // ── DataBridge subscription ────────────────────────────────────────────────

  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      const newStates = computeStates(data)

      // Detect stage changes (for revival + new builds)
      for (const [projectId, state] of newStates) {
        const prevStage = prevStagesRef.current.get(projectId)
        const curStage  = state.stage

        if (prevStage !== undefined && prevStage > 0 && curStage === 0) {
          // Revival: was petrified, now active
          triggerRevival(projectId)
        } else if (prevStage !== curStage || !overlaysRef.current.has(projectId)) {
          // Stage changed or new entry — rebuild overlay
          buildOverlay(state)
        }

        prevStagesRef.current.set(projectId, curStage)
      }

      // Remove overlays for projects no longer in data (completed/cancelled)
      for (const [projectId] of overlaysRef.current) {
        if (!newStates.has(projectId)) {
          clearOverlay(projectId, false)
          overlaysRef.current.delete(projectId)
          prevStagesRef.current.delete(projectId)
          statesRef.current.delete(projectId)
        }
      }

      statesRef.current = newStates
    })

    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Register frame handler ─────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: Event) => onFrame(e)
    frameHandlerRef.current = handler
    window.addEventListener('nw:frame', handler)
    return () => window.removeEventListener('nw:frame', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Register click handler ─────────────────────────────────────────────────

  useEffect(() => {
    const canvas = renderer.domElement
    canvas.addEventListener('click', onClick)
    return () => canvas.removeEventListener('click', onClick)
  }, [renderer, onClick])

  // ── Full cleanup on unmount ────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      for (const [projectId] of overlaysRef.current) {
        clearOverlay(projectId, false)
      }
      overlaysRef.current.clear()
      statesRef.current.clear()
      prevStagesRef.current.clear()
      stoneTexRef.current?.dispose()
      stoneTexRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Render click panel ─────────────────────────────────────────────────────

  const stageLabels: Record<PetriStage, string> = {
    0: 'Active',
    1: 'Stage 1 — Stone Patches',
    2: 'Stage 2 — Half Petrified',
    3: 'Stage 3 — Fully Petrified',
    4: 'Stage 4 — Crumbling',
  }

  const stageBorderColors: Record<PetriStage, string> = {
    0: '#00ff88',
    1: '#aaaaaa',
    2: '#888880',
    3: '#ff8800',
    4: '#ff3333',
  }

  return (
    <>
      {panel && (
        <div
          style={{
            position: 'fixed',
            left: panel.screenX,
            top:  panel.screenY,
            zIndex: 9500,
            width: 280,
            background: 'rgba(10, 9, 8, 0.92)',
            border: `1.5px solid ${stageBorderColors[panel.stage]}`,
            borderRadius: 10,
            padding: '14px 16px',
            boxShadow: `0 0 18px ${stageBorderColors[panel.stage]}55`,
            fontFamily: 'monospace',
            color: '#ddd',
            backdropFilter: 'blur(8px)',
            pointerEvents: 'all',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: stageBorderColors[panel.stage], letterSpacing: 1 }}>
              ⬡ PETRIFICATION ALERT
            </span>
            <button
              onClick={() => setPanel(null)}
              style={{
                background: 'none', border: 'none', color: '#888',
                cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0,
              }}
            >
              ✕
            </button>
          </div>

          {/* Project name */}
          <div style={{ fontSize: 14, fontWeight: 700, color: '#eee', marginBottom: 6 }}>
            {panel.projectName}
          </div>

          {/* Stage badge */}
          <div style={{
            display: 'inline-block',
            background: `${stageBorderColors[panel.stage]}22`,
            border: `1px solid ${stageBorderColors[panel.stage]}`,
            borderRadius: 5,
            fontSize: 11,
            padding: '2px 7px',
            color: stageBorderColors[panel.stage],
            marginBottom: 10,
          }}>
            {stageLabels[panel.stage]}
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', fontSize: 11, marginBottom: 10 }}>
            <span style={{ color: '#888' }}>Days Idle</span>
            <span style={{ color: panel.idleDays >= 30 ? '#ff6644' : '#ccaa44' }}>
              {panel.idleDays} days
            </span>

            <span style={{ color: '#888' }}>Last Activity</span>
            <span style={{ color: '#bbb' }}>
              {panel.lastActivityDate ?? 'Unknown'}
            </span>

            <span style={{ color: '#888' }}>Activity Type</span>
            <span style={{ color: '#bbb' }}>
              {panel.lastActivityType}
            </span>
          </div>

          {/* Suggested action */}
          <div style={{
            background: 'rgba(255,100,50,0.10)',
            border: '1px solid rgba(255,100,50,0.3)',
            borderRadius: 6,
            padding: '7px 10px',
            fontSize: 11,
            color: '#ffbb88',
            lineHeight: 1.4,
          }}>
            <span style={{ fontWeight: 700 }}>▶ </span>
            {panel.suggestedAction}
          </div>
        </div>
      )}
    </>
  )
}
