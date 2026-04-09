/**
 * WestContinentLayer.tsx — NW9 West Continent full terrain mechanics.
 *
 * Features (west continent only — x=-200 to -20):
 * 1. Job site markers       — glowing PointLight + text sprite above each active project
 *                              showing crew count, hours logged, phase completion
 * 2. Material cost canyons  — inverted cylinder at mountain base, depth = material/contract ratio
 * 3. Labor ridge lines      — thin elevated path between mountains where same crew worked
 * 4. AR stalactites         — inverted cone above project for each unpaid invoice > 14 days
 *                              cone length = invoice age; dissolves with particles when paid
 * 5. RFI fault lines        — amber crack line near project mountain; widens if unresolved
 * 6. MTZ solar plateau      — elevated flat platform at southwest, size = solar_income
 * 7. Admin structures       — VAULT, LEDGER, OHM, CHRONO, BLUEPRINT (BoxGeometry / CylinderGeometry)
 *                              each labeled with a floating text sprite
 *
 * All Three.js objects are disposed on unmount.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWProject,
  type NWInvoice,
  type NWFieldLog,
  type NWRFI,
  type NWWorldData,
} from '../DataBridge'
import { getNodePosition } from '../NodePositionStore'

// ── Constants ──────────────────────────────────────────────────────────────────

const WEST_X_MIN = -185
const WEST_X_MAX = -35
const MARKER_HEIGHT_OFFSET = 4      // units above mountain tip
const STALACTITE_BASE_Y   = 18     // y where stalactites hang from
const STALE_INVOICE_DAYS  = 14     // invoice age threshold
const RIDGE_Y             = 1.8    // ridge line elevation
const FAULT_Z_OFFSET      = 2      // crack line offset from mountain center
const PLATEAU_Y           = 3.5    // MTZ solar plateau elevation
const PLATEAU_BASE_SIDE   = 20     // minimum plateau side length
const PLATEAU_SCALE       = 0.002  // units per dollar of solar income

// Admin structure positions (west continent)
const ADMIN_STRUCTURES = [
  { id: 'VAULT',     x: -172, z:  80,  label: 'VAULT',     color: 0x3a1a00 },
  { id: 'LEDGER',    x: -30,  z:  25,  label: 'LEDGER',    color: 0x001a2a },
  { id: 'OHM',       x: -165, z: -110, label: 'OHM',       color: 0x001a10 },
  { id: 'CHRONO',    x: -105, z:   0,  label: 'CHRONO',    color: 0x1a0a2a },
  { id: 'BLUEPRINT', x: -130, z: -70,  label: 'BLUEPRINT', color: 0x001a1a },
]

// ── Text sprite helper ─────────────────────────────────────────────────────────

function makeTextSprite(text: string, options?: {
  fontSize?: number
  color?: string
  bgColor?: string
  padding?: number
}): THREE.Sprite {
  const fontSize  = options?.fontSize  ?? 22
  const color     = options?.color     ?? '#00e5cc'
  const bgColor   = options?.bgColor   ?? 'rgba(0,0,0,0.55)'
  const padding   = options?.padding   ?? 8

  const canvas  = document.createElement('canvas')
  const ctx     = canvas.getContext('2d')!
  ctx.font      = `bold ${fontSize}px monospace`
  const metrics = ctx.measureText(text)
  const tw      = Math.ceil(metrics.width) + padding * 2
  const th      = fontSize + padding * 2

  canvas.width  = tw
  canvas.height = th

  // Repaint after resize
  ctx.font      = `bold ${fontSize}px monospace`
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, tw, th)
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, padding, th / 2)

  const texture = new THREE.CanvasTexture(canvas)
  const mat     = new THREE.SpriteMaterial({
    map: texture,
    depthWrite: false,
    transparent: true,
    opacity: 0.92,
  })
  const sprite  = new THREE.Sprite(mat)
  // Scale sprite so it looks proportional in world space
  const aspect  = tw / th
  sprite.scale.set(aspect * 2.2, 2.2, 1)
  return sprite
}

// ── Dispose helpers ────────────────────────────────────────────────────────────

function disposeObj(scene: THREE.Scene, obj: THREE.Object3D | null): void {
  if (!obj) return
  scene.remove(obj)
  if ((obj as THREE.Mesh).geometry) {
    (obj as THREE.Mesh).geometry.dispose()
  }
  const mat = (obj as THREE.Mesh).material
  if (mat) {
    if (Array.isArray(mat)) mat.forEach(m => m.dispose())
    else mat.dispose()
  }
  if ((obj as THREE.Sprite).material) {
    const smat = (obj as THREE.Sprite).material as THREE.SpriteMaterial
    smat.map?.dispose()
    smat.dispose()
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function WestContinentLayer() {
  const { scene } = useWorldContext()

  // Job site marker objects: map projectId → { light, sprite }
  const jobMarkersRef = useRef<Map<string, { light: THREE.PointLight; sprite: THREE.Sprite }>>(new Map())

  // Canyon meshes: map projectId → mesh
  const canyonsRef = useRef<Map<string, THREE.Mesh>>(new Map())

  // Ridge lines: array of Line objects
  const ridgeLinesRef = useRef<THREE.Line[]>([])

  // Stalactites: map invoiceId → { cone, particles, age, paid }
  interface StalactiteEntry {
    cone: THREE.Mesh
    age: number           // days old
    dissolving: boolean
    particles: THREE.Points | null
    dissolveTime: number
  }
  const stalactitesRef = useRef<Map<string, StalactiteEntry>>(new Map())

  // RFI fault lines: map rfiId → { line, age, resolved }
  interface FaultEntry {
    line: THREE.Line
    crackWidth: number    // widens over time
    resolved: boolean
    rippleTime: number    // countdown for resolve ripple
    rippleMesh: THREE.Mesh | null
  }
  const faultLinesRef = useRef<Map<string, FaultEntry>>(new Map())

  // MTZ plateau
  const plateauRef    = useRef<THREE.Mesh | null>(null)
  const plateauLightRef = useRef<THREE.PointLight | null>(null)

  // Admin structures (built once)
  const adminBuiltRef = useRef(false)
  const adminMeshesRef = useRef<THREE.Object3D[]>([])
  // NW24: Admin structure groups keyed by struct ID for repositioning
  const adminGroupsRef = useRef<Map<string, THREE.Group>>(new Map())
  // NW24: Last received world data (for rebuild on node move)
  const lastWorldDataRef = useRef<NWWorldData | null>(null)

  const frameHandlerRef = useRef<(() => void) | null>(null)
  const elapsedRef      = useRef(0)

  // Track last known invoice states for paid/unpaid transitions
  const invoiceStatusRef = useRef<Map<string, string>>(new Map())

  // NW24: Wrapper to get project position (seeded default + NodePositionStore override)
  function projectPos(id: string): { x: number; z: number } {
    const seed = seededPosition(id)
    return getNodePosition(`P_${id}`, seed.x, seed.z)
  }

  // ── Build job site markers ─────────────────────────────────────────────────

  function buildJobMarkers(projects: NWProject[], fieldLogs: NWFieldLog[]) {
    // Dispose old markers
    for (const [, m] of jobMarkersRef.current) {
      scene.remove(m.light)
      scene.remove(m.sprite)
      const smat = m.sprite.material as THREE.SpriteMaterial
      smat.map?.dispose()
      smat.dispose()
    }
    jobMarkersRef.current.clear()

    const activeProjects = projects.filter(p =>
      p.status === 'in_progress' || p.status === 'approved'
    )

    for (const project of activeProjects) {
      const { x, z } = projectPos(project.id)
      // Only west continent
      if (x < WEST_X_MIN || x > WEST_X_MAX) continue

      const height = contractValueToHeight(project.contract_value)
      const mountainTip = height + MARKER_HEIGHT_OFFSET

      // Crew count = distinct crew_ids in logs for this project
      const projectLogs = fieldLogs.filter(fl => fl.project_id === project.id)
      const crewSet     = new Set(projectLogs.map(fl => fl.crew_id ?? 'unknown'))
      const crewCount   = crewSet.size
      const totalHours  = projectLogs.reduce((s, fl) => s + fl.hours, 0)
      const phase       = Math.round(project.phase_completion)

      // Glowing point light
      const light = new THREE.PointLight(0x00ffcc, 1.2, 14)
      light.position.set(x, mountainTip, z)
      scene.add(light)

      // Floating label: "CREW:2 HRS:48 ▓78%"
      const label = `${project.name.slice(0, 10)} | C:${crewCount} H:${Math.round(totalHours)} ${phase}%`
      const sprite = makeTextSprite(label, { fontSize: 18, color: '#00ffcc' })
      sprite.position.set(x, mountainTip + 1.4, z)
      scene.add(sprite)

      jobMarkersRef.current.set(project.id, { light, sprite })
    }
  }

  // ── Build material cost canyons ────────────────────────────────────────────

  function buildCanyons(projects: NWProject[]) {
    for (const [, mesh] of canyonsRef.current) {
      disposeObj(scene, mesh)
    }
    canyonsRef.current.clear()

    for (const project of projects) {
      if (project.contract_value <= 0 || project.material_cost <= 0) continue

      const { x, z } = projectPos(project.id)
      if (x < WEST_X_MIN || x > WEST_X_MAX) continue

      const ratio     = Math.min(1, project.material_cost / project.contract_value)
      const canyonDepth = ratio * 3.5 + 0.5   // 0.5–4.0 units deep
      const radius    = contractValueToHeight(project.contract_value) * 0.25 + 0.8

      // Inverted cylinder carved into mountain base — darker than ground
      const geo = new THREE.CylinderGeometry(radius * 0.8, radius * 1.2, canyonDepth, 10)
      const mat = new THREE.MeshLambertMaterial({
        color: 0x180800,
        emissive: new THREE.Color(0x220800).multiplyScalar(ratio * 0.3),
        transparent: true,
        opacity: 0.85,
      })
      const mesh = new THREE.Mesh(geo, mat)
      // Positioned half-submerged below ground
      mesh.position.set(x, -(canyonDepth * 0.5) + 0.1, z)
      scene.add(mesh)

      canyonsRef.current.set(project.id, mesh)
    }
  }

  // ── Build labor ridge lines ────────────────────────────────────────────────

  function buildRidgeLines(projects: NWProject[], fieldLogs: NWFieldLog[]) {
    for (const line of ridgeLinesRef.current) {
      disposeObj(scene, line)
    }
    ridgeLinesRef.current = []

    // Group logs by crew_id
    const crewMap = new Map<string, string[]>()   // crewId → projectIds
    for (const fl of fieldLogs) {
      if (!fl.crew_id || !fl.project_id) continue
      const list = crewMap.get(fl.crew_id) ?? []
      if (!list.includes(fl.project_id)) list.push(fl.project_id)
      crewMap.set(fl.crew_id, list)
    }

    // Project position lookup
    const projPos = new Map<string, { x: number; z: number; y: number }>()
    for (const p of projects) {
      const { x, z } = projectPos(p.id)
      if (x < WEST_X_MIN || x > WEST_X_MAX) continue
      const h = contractValueToHeight(p.contract_value)
      projPos.set(p.id, { x, z, y: h + 0.5 })
    }

    for (const [crewId, projectIds] of crewMap) {
      if (projectIds.length < 2) continue
      const positions: THREE.Vector3[] = []
      for (const pid of projectIds) {
        const pos = projPos.get(pid)
        if (pos) positions.push(new THREE.Vector3(pos.x, RIDGE_Y, pos.z))
      }
      if (positions.length < 2) continue

      // Create thin ridge path (elevated line between peaks)
      const points: THREE.Vector3[] = []
      for (let i = 0; i < positions.length - 1; i++) {
        const a   = positions[i]
        const b   = positions[i + 1]
        const mid = a.clone().lerp(b, 0.5)
        mid.y     = RIDGE_Y + 1.2   // slight arc upward
        points.push(a, mid, b)
      }

      const curve    = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5)
      const pts      = curve.getPoints(30)
      const geo      = new THREE.BufferGeometry().setFromPoints(pts)

      // Color ridge by crew hash
      let h = 0xdeadbeef
      for (let i = 0; i < crewId.length; i++) h = Math.imul(h ^ crewId.charCodeAt(i), 2654435761)
      const hue    = (h >>> 0) % 360
      const ridgeColor = new THREE.Color().setHSL(hue / 360, 0.8, 0.65)

      const mat  = new THREE.LineBasicMaterial({
        color:       ridgeColor,
        transparent: true,
        opacity:     0.7,
        linewidth:   1,
      })
      const line = new THREE.Line(geo, mat)
      scene.add(line)
      ridgeLinesRef.current.push(line)
    }
  }

  // ── Build AR stalactites for overdue invoices ──────────────────────────────

  function buildStalactites(invoices: NWInvoice[], projects: NWProject[]) {
    const now = Date.now()

    // Project position lookup
    const projPos = new Map<string, { x: number; z: number }>()
    for (const p of projects) {
      const pos = projectPos(p.id)
      projPos.set(p.id, pos)
    }

    // Determine which invoices are newly paid (for dissolve)
    for (const inv of invoices) {
      const prevStatus = invoiceStatusRef.current.get(inv.id)
      if (prevStatus && prevStatus !== 'paid' && inv.status === 'paid') {
        // Trigger dissolve on existing stalactite
        const entry = stalactitesRef.current.get(inv.id)
        if (entry && !entry.dissolving) {
          entry.dissolving   = true
          entry.dissolveTime = 1.5  // seconds
          spawnDissolveParticles(entry.cone, scene)
        }
      }
      invoiceStatusRef.current.set(inv.id, inv.status)
    }

    // Build stalactites for unpaid overdue invoices
    for (const inv of invoices) {
      if (inv.status === 'paid' || inv.status === 'cancelled') continue
      if (!inv.project_id)                                   continue
      if (stalactitesRef.current.has(inv.id))               continue  // already built

      const createdAt = inv.created_at ? new Date(inv.created_at).getTime() : now
      const ageMs     = now - createdAt
      const ageDays   = ageMs / (1000 * 60 * 60 * 24)
      if (ageDays < STALE_INVOICE_DAYS)                     continue

      const pos = projPos.get(inv.project_id)
      if (!pos) continue
      if (pos.x < WEST_X_MIN || pos.x > WEST_X_MAX) continue

      const coneLength = Math.min(12, 2 + ageDays * 0.15)   // grows with age, cap 12
      const coneRadius = 0.4 + (inv.amount / 20000) * 0.6   // wider for larger invoices

      const geo = new THREE.ConeGeometry(coneRadius, coneLength, 8)
      const mat = new THREE.MeshLambertMaterial({
        color:     0xff4422,
        emissive:  new THREE.Color(0xff2200).multiplyScalar(0.2),
        transparent: true,
        opacity:   0.85,
      })
      const cone = new THREE.Mesh(geo, mat)
      // Hang inverted above the mountain zone
      cone.rotation.z    = Math.PI   // flip upside-down
      cone.position.set(pos.x + (Math.random() - 0.5) * 3,
                        STALACTITE_BASE_Y + coneLength * 0.5,
                        pos.z + (Math.random() - 0.5) * 3)
      scene.add(cone)

      stalactitesRef.current.set(inv.id, {
        cone,
        age: ageDays,
        dissolving: false,
        particles: null,
        dissolveTime: 0,
      })
    }
  }

  // Particle burst when invoice paid (stalactite dissolves)
  function spawnDissolveParticles(cone: THREE.Mesh, sc: THREE.Scene): THREE.Points {
    const count = 40
    const geo   = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = cone.position.x + (Math.random() - 0.5) * 2
      positions[i * 3 + 1] = cone.position.y + (Math.random() - 0.5) * 2
      positions[i * 3 + 2] = cone.position.z + (Math.random() - 0.5) * 2
      velocities[i * 3]     = (Math.random() - 0.5) * 5
      velocities[i * 3 + 1] = Math.random() * 8
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 5
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.userData.velocities = velocities
    const mat = new THREE.PointsMaterial({
      color: 0x44ff88,
      size: 0.25,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
    })
    const pts = new THREE.Points(geo, mat)
    sc.add(pts)
    return pts
  }

  // ── Build RFI fault lines ──────────────────────────────────────────────────

  function buildFaultLines(rfis: NWRFI[], projects: NWProject[]) {
    const projPos = new Map<string, { x: number; z: number }>()
    for (const p of projects) {
      const pos = projectPos(p.id)
      projPos.set(p.id, pos)
    }

    for (const rfi of rfis) {
      if (faultLinesRef.current.has(rfi.id)) {
        // Check if just resolved
        const entry = faultLinesRef.current.get(rfi.id)!
        if (!entry.resolved && rfi.status === 'closed') {
          entry.resolved   = true
          entry.rippleTime = 1.2
          buildRipple(entry, scene)
        }
        continue
      }

      if (!rfi.project_id) continue
      const pos = projPos.get(rfi.project_id)
      if (!pos) continue
      if (pos.x < WEST_X_MIN || pos.x > WEST_X_MAX) continue

      // Age in days
      const now    = Date.now()
      const createdAt = rfi.created_at ? new Date(rfi.created_at).getTime() : now
      const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24)

      // Crack line length grows with age; offset from mountain center
      const crackLen = Math.min(18, 3 + ageDays * 0.4)
      const angle    = Math.random() * Math.PI * 2
      const startX   = pos.x + Math.cos(angle) * FAULT_Z_OFFSET
      const startZ   = pos.z + Math.sin(angle) * FAULT_Z_OFFSET
      const endX     = startX + Math.cos(angle) * crackLen
      const endZ     = startZ + Math.sin(angle) * crackLen

      // Jagged crack using multiple segments
      const pts: THREE.Vector3[] = []
      const SEGS = 8
      for (let i = 0; i <= SEGS; i++) {
        const t    = i / SEGS
        const jx   = i > 0 && i < SEGS ? (Math.random() - 0.5) * 1.2 : 0
        const jz   = i > 0 && i < SEGS ? (Math.random() - 0.5) * 1.2 : 0
        pts.push(new THREE.Vector3(
          startX + (endX - startX) * t + jx,
          0.08,
          startZ + (endZ - startZ) * t + jz
        ))
      }

      const geo  = new THREE.BufferGeometry().setFromPoints(pts)
      const mat  = new THREE.LineBasicMaterial({
        color: rfi.status === 'closed' ? 0x00ff88 : 0xffaa00,
        transparent: true,
        opacity:     0.9,
        linewidth:   1,
      })
      const line = new THREE.Line(geo, mat)
      scene.add(line)

      faultLinesRef.current.set(rfi.id, {
        line,
        crackWidth: 1.0,
        resolved: rfi.status === 'closed',
        rippleTime: 0,
        rippleMesh: null,
      })
    }
  }

  function buildRipple(entry: { line: THREE.Line; rippleMesh: THREE.Mesh | null }, sc: THREE.Scene) {
    if (entry.rippleMesh) {
      disposeObj(sc, entry.rippleMesh)
      entry.rippleMesh = null
    }
    const pos  = entry.line.position
    const geo  = new THREE.RingGeometry(0.5, 0.8, 24)
    const mat  = new THREE.MeshBasicMaterial({
      color:       0x00ff88,
      transparent: true,
      opacity:     0.8,
      side:        THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(pos.x, 0.12, pos.z)
    sc.add(mesh)
    entry.rippleMesh = mesh
  }

  // ── Build MTZ solar plateau ────────────────────────────────────────────────

  function buildMTZPlateau(solarIncome: number) {
    if (plateauRef.current) {
      disposeObj(scene, plateauRef.current)
      plateauRef.current = null
    }
    if (plateauLightRef.current) {
      scene.remove(plateauLightRef.current)
      plateauLightRef.current = null
    }

    const side = PLATEAU_BASE_SIDE + solarIncome * PLATEAU_SCALE
    const cappedSide = Math.min(side, 80)   // cap at 80 units

    // Southwest edge of west continent — NW24: NodePositionStore override
    const mtzOverride = getNodePosition('MTZ_PLATEAU', -160, -130)
    const px = mtzOverride.x
    const pz = mtzOverride.z

    const geo = new THREE.BoxGeometry(cappedSide, 1.5, cappedSide)
    const mat = new THREE.MeshLambertMaterial({
      color:    0x1a1000,
      emissive: new THREE.Color(0xffaa00).multiplyScalar(0.06),
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(px, PLATEAU_Y, pz)
    mesh.castShadow = false
    mesh.receiveShadow = true
    scene.add(mesh)
    plateauRef.current = mesh

    // Solar panel grid on top
    const panelRows = Math.max(2, Math.floor(cappedSide / 10))
    const panelCols = panelRows
    const spacing   = cappedSide / panelRows
    for (let r = 0; r < panelRows; r++) {
      for (let c = 0; c < panelCols; c++) {
        const pgeo = new THREE.BoxGeometry(spacing * 0.7, 0.12, spacing * 0.45)
        const pmat = new THREE.MeshLambertMaterial({
          color:    0x0a1830,
          emissive: new THREE.Color(0x0088ff).multiplyScalar(0.1),
        })
        const pmesh = new THREE.Mesh(pgeo, pmat)
        pmesh.rotation.x = -0.12
        pmesh.position.set(
          px - cappedSide / 2 + spacing * (r + 0.5),
          PLATEAU_Y + 0.9,
          pz - cappedSide / 2 + spacing * (c + 0.5),
        )
        scene.add(pmesh)
        adminMeshesRef.current.push(pmesh)
      }
    }

    // Ambient glow
    const light = new THREE.PointLight(0xffaa00, 0.8, cappedSide * 1.5)
    light.position.set(px, PLATEAU_Y + 4, pz)
    scene.add(light)
    plateauLightRef.current = light

    // Floating label
    const label = makeTextSprite(
      `MTZ SOLAR  $${Math.round(solarIncome / 1000)}k`,
      { fontSize: 20, color: '#ffcc44' }
    )
    label.position.set(px, PLATEAU_Y + 4.5, pz)
    scene.add(label)
    adminMeshesRef.current.push(label)
  }

  // ── Build admin structures ─────────────────────────────────────────────────

  function buildAdminStructures() {
    if (adminBuiltRef.current) return
    adminBuiltRef.current = true

    for (const struct of ADMIN_STRUCTURES) {
      // NW24: Use NodePositionStore overrides for initial position
      const pos = getNodePosition(struct.id, struct.x, struct.z)
      const group = new THREE.Group()
      group.position.set(pos.x, 0, pos.z)
      scene.add(group)
      adminGroupsRef.current.set(struct.id, group)

      // Objects built at group-local origin (0, 0)
      const objects = createAdminStructure(struct.id, 0, 0, struct.color)
      for (const obj of objects) {
        group.add(obj)
        adminMeshesRef.current.push(obj)
      }

      // Floating text sprite label
      const labelY = getStructureLabelY(struct.id)
      const sprite = makeTextSprite(struct.label, { fontSize: 20, color: '#aaffdd' })
      sprite.position.set(0, labelY, 0)
      group.add(sprite)
      adminMeshesRef.current.push(sprite)
    }
  }

  // NW24: Reposition a single admin structure group
  function repositionAdminStruct(id: string, x: number, z: number) {
    const group = adminGroupsRef.current.get(id)
    if (!group) return
    group.position.x = x
    group.position.z = z
  }

  function getStructureLabelY(id: string): number {
    switch (id) {
      case 'OHM':    return 14
      case 'CHRONO': return 10
      default:       return  7
    }
  }

  /**
   * Creates a distinctive structure for each admin tool using
   * BoxGeometry / CylinderGeometry compositions.
   * NW24: All objects built at x=0,z=0 (relative to their parent Group).
   *       Returns THREE.Object3D[] so lights are included.
   */
  function createAdminStructure(
    id: string,
    _x: number,
    _z: number,
    baseColor: number,
  ): THREE.Object3D[] {
    const objects: THREE.Object3D[] = []
    const x = 0  // NW24: build at group-local origin
    const z = 0

    const addMesh = (geo: THREE.BufferGeometry, color: number, y: number) => {
      const mat  = new THREE.MeshLambertMaterial({
        color,
        emissive: new THREE.Color(color).multiplyScalar(0.12),
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      objects.push(mesh)
    }

    switch (id) {
      case 'VAULT': {
        // Wide low building (estimate vault — ghost mountains nearby)
        addMesh(new THREE.BoxGeometry(12, 5, 10), baseColor, 2.5)
        // Roof ridge
        addMesh(new THREE.CylinderGeometry(0.5, 0.5, 12, 6), 0x5a2a00, 6)
        // Side pillars
        for (const ox of [-5, 5]) {
          const pgeo = new THREE.CylinderGeometry(0.6, 0.7, 6, 6)
          const pmat = new THREE.MeshLambertMaterial({ color: 0x4a2000 })
          const pm   = new THREE.Mesh(pgeo, pmat)
          pm.position.set(x + ox, 3, z)
          objects.push(pm)
        }
        // Ghost estimates: small translucent cones
        for (let i = 0; i < 4; i++) {
          const gGeo = new THREE.ConeGeometry(1.2, 3, 6)
          const gMat = new THREE.MeshLambertMaterial({
            color:       0x604030,
            transparent: true,
            opacity:     0.4,
          })
          const gm = new THREE.Mesh(gGeo, gMat)
          gm.position.set(x + (i - 1.5) * 4, 1.5, z + 8)
          objects.push(gm)
        }
        break
      }

      case 'LEDGER': {
        // Tall narrow building on river bank
        addMesh(new THREE.BoxGeometry(8, 8, 6), baseColor, 4)
        // Top level cap
        addMesh(new THREE.BoxGeometry(7, 2, 5), 0x002a3a, 9)
        // Ledger lines (thin horizontal slabs)
        for (let i = 0; i < 5; i++) {
          const lGeo = new THREE.BoxGeometry(9, 0.15, 0.5)
          const lMat = new THREE.MeshLambertMaterial({ color: 0x00aacc })
          const lm   = new THREE.Mesh(lGeo, lMat)
          lm.position.set(x, 1 + i * 1.5, z + 3)
          objects.push(lm)
        }
        break
      }

      case 'OHM': {
        // Tall OHM tower (northwest)
        addMesh(new THREE.CylinderGeometry(3, 4, 4, 8), baseColor, 2)
        addMesh(new THREE.CylinderGeometry(1.5, 2.5, 10, 8), 0x002a18, 9)
        addMesh(new THREE.CylinderGeometry(2, 2, 2, 12), 0x00ff88, 15)
        // Glow ring
        const ringGeo = new THREE.TorusGeometry(2.8, 0.22, 6, 32)
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.7 })
        const ring    = new THREE.Mesh(ringGeo, ringMat)
        ring.position.set(x, 15, z)
        ring.rotation.x = Math.PI / 2
        objects.push(ring)
        // OHM point light — NW24: add to group (not scene directly)
        const ohl = new THREE.PointLight(0x00ff88, 1.4, 40)
        ohl.position.set(x, 16, z)
        objects.push(ohl)
        break
      }

      case 'CHRONO': {
        addMesh(new THREE.BoxGeometry(6, 3, 6), baseColor, 1.5)
        addMesh(new THREE.BoxGeometry(4, 10, 4), 0x1a0030, 8)
        addMesh(new THREE.CylinderGeometry(2, 2, 0.3, 32), 0x220044, 13.5)
        addMesh(new THREE.ConeGeometry(0.6, 3, 6), 0x4400aa, 16)
        break
      }

      case 'BLUEPRINT': {
        addMesh(new THREE.BoxGeometry(18, 1, 14), baseColor, 2.0)
        for (const [ox, oz, w, d] of [
          [-9, 0, 1, 14] as [number, number, number, number],
          [ 9, 0, 1, 14] as [number, number, number, number],
          [ 0, -7, 18, 1] as [number, number, number, number],
          [ 0,  7, 18, 1] as [number, number, number, number],
        ]) {
          const wGeo = new THREE.BoxGeometry(w, 0.8, d)
          const wMat = new THREE.MeshLambertMaterial({ color: 0x002020 })
          const wm   = new THREE.Mesh(wGeo, wMat)
          wm.position.set(x + ox, 3.0, z + oz)
          objects.push(wm)
        }
        for (let i = -3; i <= 3; i++) {
          const lgeo = new THREE.BoxGeometry(18, 0.05, 0.1)
          const lmat = new THREE.MeshBasicMaterial({ color: 0x004488, transparent: true, opacity: 0.6 })
          const lm   = new THREE.Mesh(lgeo, lmat)
          lm.position.set(x, 2.55, z + i * 2)
          objects.push(lm)
        }
        for (let i = -4; i <= 4; i++) {
          const lgeo = new THREE.BoxGeometry(0.1, 0.05, 14)
          const lmat = new THREE.MeshBasicMaterial({ color: 0x004488, transparent: true, opacity: 0.6 })
          const lm   = new THREE.Mesh(lgeo, lmat)
          lm.position.set(x + i * 2, 2.55, z)
          objects.push(lm)
        }
        break
      }

      default:
        addMesh(new THREE.BoxGeometry(8, 6, 8), baseColor, 3)
        break
    }

    return objects
  }

  // ── Frame handler ─────────────────────────────────────────────────────────

  function setupFrameHandler() {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
    }

    const handler = () => {
      const dt = 0.016
      elapsedRef.current += dt

      const t = elapsedRef.current

      // Pulse job marker lights
      for (const [, m] of jobMarkersRef.current) {
        m.light.intensity = 0.8 + Math.sin(t * 2.5) * 0.4
      }

      // Animate fault line opacity (flickering amber)
      for (const [, entry] of faultLinesRef.current) {
        if (!entry.resolved) {
          const mat  = entry.line.material as THREE.LineBasicMaterial
          mat.opacity = 0.6 + Math.sin(t * 3.0) * 0.3
        }
        // Ripple expansion on resolve
        if (entry.rippleMesh) {
          entry.rippleTime = Math.max(0, entry.rippleTime - dt)
          const prog       = 1 - entry.rippleTime / 1.2
          const rm         = entry.rippleMesh
          rm.scale.set(1 + prog * 6, 1, 1 + prog * 6)
          ;(rm.material as THREE.MeshBasicMaterial).opacity = (1 - prog) * 0.8
          if (entry.rippleTime <= 0) {
            disposeObj(scene, entry.rippleMesh)
            entry.rippleMesh = null
          }
        }
      }

      // Dissolve stalactites (paid invoices)
      for (const [id, entry] of stalactitesRef.current) {
        if (entry.dissolving) {
          entry.dissolveTime = Math.max(0, entry.dissolveTime - dt)
          const prog         = 1 - entry.dissolveTime / 1.5
          ;(entry.cone.material as THREE.MeshLambertMaterial).opacity = Math.max(0, 1 - prog * 1.5)
          entry.cone.position.y -= dt * 3   // drop

          // Animate particle burst
          if (entry.particles) {
            const pos  = entry.particles.geometry.attributes.position as THREE.BufferAttribute
            const vels = entry.particles.geometry.userData.velocities as Float32Array
            const cnt  = pos.count
            for (let i = 0; i < cnt; i++) {
              pos.array[i * 3]     += vels[i * 3]     * dt
              pos.array[i * 3 + 1] += (vels[i * 3 + 1] - 9.8 * prog) * dt
              pos.array[i * 3 + 2] += vels[i * 3 + 2] * dt
            }
            pos.needsUpdate = true
            ;(entry.particles.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - prog)
          }

          if (entry.dissolveTime <= 0) {
            disposeObj(scene, entry.cone)
            if (entry.particles) disposeObj(scene, entry.particles)
            stalactitesRef.current.delete(id)
          }
        } else {
          // Gentle sway
          entry.cone.rotation.y = Math.sin(t * 0.8 + entry.age * 0.3) * 0.05
        }
      }

      // Pulse MTZ plateau light
      if (plateauLightRef.current) {
        plateauLightRef.current.intensity = 0.6 + Math.sin(t * 1.2) * 0.2
      }
    }

    window.addEventListener('nw:frame', handler)
    frameHandlerRef.current = handler
  }

  // ── Mount / unmount ────────────────────────────────────────────────────────

  useEffect(() => {
    buildAdminStructures()
    setupFrameHandler()

    const unsub = subscribeWorldData((data: NWWorldData) => {
      lastWorldDataRef.current = data
      buildJobMarkers(data.projects, data.fieldLogs)
      buildCanyons(data.projects)
      buildRidgeLines(data.projects, data.fieldLogs)
      buildStalactites(data.invoices, data.projects)
      buildFaultLines(data.rfis, data.projects)
      buildMTZPlateau(data.solarIncome)
    })

    // NW24: Reposition admin structures on node move, rebuild project visuals
    function onNodeMoved(e: Event) {
      const ev = e as CustomEvent<{ id: string; x: number; z: number }>
      if (!ev.detail) return
      const { id, x, z } = ev.detail

      if (adminGroupsRef.current.has(id)) {
        repositionAdminStruct(id, x, z)
        return
      }

      if (id === 'MTZ_PLATEAU') {
        const data = lastWorldDataRef.current
        if (data) buildMTZPlateau(data.solarIncome)
        return
      }

      if (id.startsWith('P_')) {
        const data = lastWorldDataRef.current
        if (!data) return
        buildJobMarkers(data.projects, data.fieldLogs)
        buildCanyons(data.projects)
        buildRidgeLines(data.projects, data.fieldLogs)
        buildStalactites(data.invoices, data.projects)
        buildFaultLines(data.rfis, data.projects)
      }
    }
    function onPositionsReset() {
      for (const struct of ADMIN_STRUCTURES) {
        repositionAdminStruct(struct.id, struct.x, struct.z)
      }
      const data = lastWorldDataRef.current
      if (data) {
        buildJobMarkers(data.projects, data.fieldLogs)
        buildCanyons(data.projects)
        buildRidgeLines(data.projects, data.fieldLogs)
        buildStalactites(data.invoices, data.projects)
        buildFaultLines(data.rfis, data.projects)
        buildMTZPlateau(data.solarIncome)
      }
    }
    window.addEventListener('nw:node-moved', onNodeMoved)
    window.addEventListener('nw:positions-reset', onPositionsReset)

    return () => {
      unsub()
      window.removeEventListener('nw:node-moved', onNodeMoved)
      window.removeEventListener('nw:positions-reset', onPositionsReset)

      // Job markers
      for (const [, m] of jobMarkersRef.current) {
        scene.remove(m.light)
        disposeObj(scene, m.sprite)
      }
      jobMarkersRef.current.clear()

      // Canyons
      for (const [, mesh] of canyonsRef.current) {
        disposeObj(scene, mesh)
      }
      canyonsRef.current.clear()

      // Ridges
      for (const line of ridgeLinesRef.current) {
        disposeObj(scene, line)
      }
      ridgeLinesRef.current = []

      // Stalactites
      for (const [, entry] of stalactitesRef.current) {
        disposeObj(scene, entry.cone)
        if (entry.particles) disposeObj(scene, entry.particles)
      }
      stalactitesRef.current.clear()

      // Fault lines
      for (const [, entry] of faultLinesRef.current) {
        disposeObj(scene, entry.line)
        if (entry.rippleMesh) disposeObj(scene, entry.rippleMesh)
      }
      faultLinesRef.current.clear()

      // Plateau
      disposeObj(scene, plateauRef.current)
      plateauRef.current = null
      if (plateauLightRef.current) {
        scene.remove(plateauLightRef.current)
        plateauLightRef.current = null
      }

      // Admin structures — NW24: groups contain all objects now
      for (const [, group] of adminGroupsRef.current) {
        scene.remove(group)
        group.traverse(child => {
          if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose()
          const mat = (child as THREE.Mesh).material
          if (mat) {
            if (Array.isArray(mat)) mat.forEach(m => m.dispose())
            else mat.dispose()
          }
        })
      }
      adminGroupsRef.current.clear()
      adminMeshesRef.current = []
      adminBuiltRef.current  = false

      // Frame handler
      if (frameHandlerRef.current) {
        window.removeEventListener('nw:frame', frameHandlerRef.current)
        frameHandlerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  return null
}
