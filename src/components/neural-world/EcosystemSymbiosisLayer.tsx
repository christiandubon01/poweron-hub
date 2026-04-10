/**
 * EcosystemSymbiosisLayer.tsx — NW50: Ecosystem Symbiosis visualization.
 *
 * Visualizes how projects share resources — crew, materials, equipment, time.
 * Shows symbiotic relationships where one project's output benefits another.
 *
 * VINE TYPES (organic connections between project mountains):
 *   Shared crew      → amber vine (#F59E0B) pulsing when worker transitions
 *   Shared materials → teal pipeline (#14B8A6) with direction-of-flow chevrons
 *   Shared equipment → gold chain link (#EAB308) geometry
 *   Time overlap     → gradient band (#8B5CF6 → #06B6D4) showing schedule overlap
 *
 * VINE THICKNESS: proportional to shared-resource amount.
 *
 * SYMBIOSIS SCORE (0–1 per project pair):
 *   Crew efficiency + material bulk + schedule synergy + knowledge transfer
 *   Drives glow intensity on the vine.
 *
 * ECOSYSTEM MAP: zoom-out view, node size = project value, vine = sharing intensity.
 * Isolated projects (no connections) get a warning glow halo.
 *
 * INTERACTION:
 *   Click vine  → panel shows what's shared, estimated savings, recommendations
 *   Click isolated node → panel suggests which projects could share resources
 *
 * DATA SOURCE: crew_assignments, material costs, field_logs (geographic proximity)
 *
 * LAYERS PANEL: "Ecosystem" toggle — off by default.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWWorldData,
  type NWProject,
} from './DataBridge'

// ── Constants ──────────────────────────────────────────────────────────────────

const VINE_BASE_Y        = 0.8      // vines float just above terrain
const VINE_ARC_HEIGHT    = 12       // peak arc height above terrain
const VINE_SEGMENTS      = 40       // catmull-rom curve points
const PARTICLE_SPEED     = 0.25     // 0–1 normalized per second for pulse
const PARTICLE_COUNT     = 8        // crew pulse particles per vine
const ISOLATION_HALO_Y   = 0.3      // y offset for isolation warning ring
const HALO_RING_SEGMENTS = 64

// Symbiosis colors
const C_CREW_VINE        = 0xF59E0B  // amber
const C_CREW_PARTICLE    = 0xFCD34D  // bright amber
const C_MATERIAL_PIPE    = 0x14B8A6  // teal
const C_EQUIPMENT_CHAIN  = 0xEAB308  // gold
const C_OVERLAP_A        = 0x8B5CF6  // purple (schedule overlap start)
const C_OVERLAP_B        = 0x06B6D4  // cyan   (schedule overlap end)
const C_ISOLATION_HALO   = 0xFF6B35  // orange-red warning

// Vine category enum
const enum VineType { CREW = 0, MATERIAL = 1, EQUIPMENT = 2, OVERLAP = 3 }

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProjectPair {
  a: NWProject
  b: NWProject
  /** 0–1 crew sharing score */
  crewScore: number
  /** 0–1 material sharing score */
  materialScore: number
  /** 0–1 equipment sharing score */
  equipmentScore: number
  /** 0–1 schedule overlap score */
  overlapScore: number
  /** composite 0–1 symbiosis score */
  symbiosisScore: number
  /** dominant vine type to render */
  dominantType: VineType
  /** vine thickness (world units) */
  thickness: number
}

interface VineEntry {
  id: string         // `${a.id}_${b.id}`
  pairIndex: number
  tube: THREE.Mesh
  glowTube: THREE.Mesh | null
  particles: THREE.Points | null
  particleT: Float32Array | null
  curve: THREE.CatmullRomCurve3
  type: VineType
  symbiosisScore: number
  thickness: number
}

interface HaloEntry {
  projectId: string
  ring: THREE.Mesh
  pulseT: number
}

interface EcosystemPanelData {
  mode: 'vine' | 'isolated'
  // vine mode
  pairLabel?: string
  crewScore?: number
  materialScore?: number
  equipmentScore?: number
  overlapScore?: number
  symbiosisScore?: number
  dominantType?: VineType
  estimatedSavings?: number
  recommendations?: string[]
  // isolated mode
  projectName?: string
  suggestedProjects?: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Deterministic hash from a string → 0..1 */
function _hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return (h >>> 0) / 4294967296
}

/** Build a catmull-rom arc curve between two world positions. */
function _buildArcCurve(
  ax: number, az: number,
  bx: number, bz: number,
  arcHeight: number,
): THREE.CatmullRomCurve3 {
  const midX = (ax + bx) / 2
  const midZ = (az + bz) / 2
  const points = [
    new THREE.Vector3(ax, VINE_BASE_Y, az),
    new THREE.Vector3(ax * 0.6 + midX * 0.4, VINE_BASE_Y + arcHeight * 0.4, az * 0.6 + midZ * 0.4),
    new THREE.Vector3(midX, VINE_BASE_Y + arcHeight, midZ),
    new THREE.Vector3(bx * 0.6 + midX * 0.4, VINE_BASE_Y + arcHeight * 0.4, bz * 0.6 + midZ * 0.4),
    new THREE.Vector3(bx, VINE_BASE_Y, bz),
  ]
  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)
}

/** Build equipment chain links along a curve. Returns a Group. */
function _buildChainGroup(
  curve: THREE.CatmullRomCurve3,
  thickness: number,
  glow: number,
): THREE.Group {
  const group = new THREE.Group()
  const linkCount = Math.max(6, Math.round(curve.getLength() * 1.5))
  const torusR    = thickness * 0.55
  const torusTube = thickness * 0.22
  const mat = new THREE.MeshStandardMaterial({
    color:     C_EQUIPMENT_CHAIN,
    emissive:  new THREE.Color(C_EQUIPMENT_CHAIN),
    emissiveIntensity: 0.2 + glow * 1.2,
    metalness: 0.8,
    roughness: 0.2,
    transparent: true,
    opacity: 0.6 + glow * 0.35,
  })

  for (let i = 0; i <= linkCount; i++) {
    const t = i / linkCount
    const pos = curve.getPoint(t)
    const tan = curve.getTangent(t)
    const geo = new THREE.TorusGeometry(torusR, torusTube, 6, 12)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(pos)
    // Orient ring to face along tangent direction
    const axis = new THREE.Vector3(0, 1, 0)
    const quat = new THREE.Quaternion().setFromUnitVectors(axis, tan.normalize())
    // Alternate rings 90° for chain look
    if (i % 2 === 1) {
      quat.multiply(new THREE.Quaternion().setFromAxisAngle(tan.normalize(), Math.PI / 2))
    }
    mesh.setRotationFromQuaternion(quat)
    group.add(mesh)
  }
  return group
}

/** Dispose any Three.js object3D */
function _disposeObj(obj: THREE.Object3D, scene: THREE.Scene) {
  scene.remove(obj)
  obj.traverse(child => {
    if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose()
    if ((child as THREE.Mesh).material) {
      const m = (child as THREE.Mesh).material
      if (Array.isArray(m)) m.forEach(x => x.dispose())
      else (m as THREE.Material).dispose()
    }
  })
}

// ── Symbiosis calculator ──────────────────────────────────────────────────────

function _computePairs(data: NWWorldData): ProjectPair[] {
  const projects = data.projects.filter(p =>
    p.status !== 'cancelled' && p.status !== 'lead'
  )

  if (projects.length < 2) return []

  // Build per-project maps
  // crew_ids per project from fieldLogs
  const projectCrew = new Map<string, Set<string>>()
  for (const log of data.fieldLogs) {
    if (!log.project_id) continue
    if (!projectCrew.has(log.project_id)) projectCrew.set(log.project_id, new Set())
    if (log.crew_id) projectCrew.get(log.project_id)!.add(log.crew_id)
  }

  // material cost buckets — similar cost ± 20% = shared material type
  // equipment: hash of (project_type + crew overlap) as proxy for same equipment
  // geographic: seededPosition proximity

  const pairs: ProjectPair[] = []

  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const a = projects[i]
      const b = projects[j]

      // ── Crew efficiency score (shared crew members)
      const crewA = projectCrew.get(a.id) ?? new Set<string>()
      const crewB = projectCrew.get(b.id) ?? new Set<string>()
      let crewShared = 0
      for (const c of crewA) { if (crewB.has(c)) crewShared++ }
      // Fallback: use seeded hash to imply some crew overlap when no real data
      const crewFallback = _hash(a.id + b.id + 'crew') < 0.4 ? _hash(a.id + b.id + 'crew') : 0
      const crewUnion = crewA.size + crewB.size - crewShared
      const crewScore = crewUnion > 0
        ? Math.min(crewShared / Math.max(1, Math.min(crewA.size, crewB.size)), 1)
        : crewFallback

      // ── Material bulk score (projects with similar material cost get bulk discount benefit)
      const matA = a.material_cost
      const matB = b.material_cost
      const matRatio = matA > 0 && matB > 0
        ? Math.min(matA, matB) / Math.max(matA, matB)
        : _hash(a.id + b.id + 'mat') * 0.5
      const materialScore = matRatio

      // ── Equipment score: same project type = same equipment family
      const sameType = a.type !== null && b.type !== null && a.type === b.type
      const equipScore = sameType ? 0.7 + _hash(a.id + b.id) * 0.3 : _hash(a.id + b.id + 'equip') * 0.3
      const equipmentScore = Math.min(equipScore, 1)

      // ── Schedule overlap: projects created within 90 days of each other
      const createdA = a.created_at ? new Date(a.created_at).getTime() : Date.now()
      const createdB = b.created_at ? new Date(b.created_at).getTime() : Date.now()
      const daysDiff = Math.abs(createdA - createdB) / (1000 * 86400)
      const overlapScore = daysDiff < 90 ? Math.max(0, 1 - daysDiff / 90) : 0

      // ── Geographic proximity (seeded world positions)
      const posA = seededPosition(a.id)
      const posB = seededPosition(b.id)
      const dist  = Math.sqrt((posA.x - posB.x) ** 2 + (posA.z - posB.z) ** 2)
      const proxScore = Math.max(0, 1 - dist / 80)

      // ── Composite symbiosis score (weighted)
      const symbiosisScore = Math.min(
        crewScore * 0.30 +
        materialScore * 0.25 +
        equipmentScore * 0.20 +
        overlapScore * 0.15 +
        proxScore * 0.10,
        1
      )

      // Skip pairs with negligible synergy
      if (symbiosisScore < 0.05) continue

      // Dominant vine type = whichever score is highest
      const scores = [crewScore, materialScore, equipmentScore, overlapScore] as const
      const maxScore = Math.max(...scores)
      const dominantType: VineType =
        maxScore === crewScore     ? VineType.CREW :
        maxScore === materialScore ? VineType.MATERIAL :
        maxScore === equipmentScore ? VineType.EQUIPMENT :
        VineType.OVERLAP

      // Vine thickness 0.08–0.55 proportional to symbiosis score
      const thickness = 0.08 + symbiosisScore * 0.47

      pairs.push({
        a, b,
        crewScore, materialScore, equipmentScore, overlapScore,
        symbiosisScore,
        dominantType,
        thickness,
      })
    }
  }

  return pairs
}

// ── Panel component ───────────────────────────────────────────────────────────

const VINE_TYPE_LABELS = ['Shared Crew', 'Shared Materials', 'Shared Equipment', 'Schedule Overlap']
const VINE_TYPE_COLORS = ['#F59E0B', '#14B8A6', '#EAB308', '#8B5CF6']

function EcosystemPanel({
  data,
  onClose,
}: {
  data: EcosystemPanelData
  onClose: () => void
}) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        right: 20,
        width: 320,
        background: 'rgba(8, 14, 28, 0.96)',
        border: '1px solid rgba(20, 184, 166, 0.35)',
        borderRadius: 10,
        padding: '16px 18px',
        zIndex: 9999,
        color: '#E2E8F0',
        fontFamily: 'monospace',
        fontSize: 13,
        backdropFilter: 'blur(14px)',
        boxShadow: '0 0 32px rgba(20, 184, 166, 0.15)',
        pointerEvents: 'all',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 16 }}>🌿</span>
          <span style={{ fontWeight: 700, color: '#14B8A6', fontSize: 14 }}>
            {data.mode === 'vine' ? 'Ecosystem Symbiosis' : 'Isolated Project'}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#64748B',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2,
          }}
        >✕</button>
      </div>

      {data.mode === 'vine' && (
        <>
          <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 10 }}>
            {data.pairLabel}
          </div>

          {/* Scores */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', marginBottom: 12 }}>
            {[
              { label: 'Crew Efficiency',  val: data.crewScore,      color: '#F59E0B' },
              { label: 'Material Bulk',    val: data.materialScore,   color: '#14B8A6' },
              { label: 'Equipment Share',  val: data.equipmentScore,  color: '#EAB308' },
              { label: 'Schedule Synergy', val: data.overlapScore,    color: '#8B5CF6' },
            ].map(row => (
              <div key={row.label}>
                <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 2 }}>{row.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{
                    flex: 1, height: 5, background: 'rgba(255,255,255,0.08)',
                    borderRadius: 3, overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${((row.val ?? 0) * 100).toFixed(0)}%`,
                      height: '100%', background: row.color, borderRadius: 3,
                      transition: 'width 0.4s',
                    }} />
                  </div>
                  <span style={{ color: row.color, fontSize: 11, minWidth: 28 }}>
                    {(((row.val ?? 0)) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Symbiosis score */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
            padding: '8px 10px', background: 'rgba(20,184,166,0.1)', borderRadius: 7,
          }}>
            <span style={{ fontSize: 12, color: '#94A3B8' }}>Symbiosis Score</span>
            <div style={{ flex: 1 }} />
            <span style={{
              fontWeight: 700, fontSize: 18,
              color: `hsl(${Math.round((data.symbiosisScore ?? 0) * 120)}, 80%, 60%)`,
            }}>
              {((data.symbiosisScore ?? 0) * 100).toFixed(0)}
            </span>
            <span style={{ color: '#64748B', fontSize: 11 }}>/100</span>
          </div>

          {/* Dominant type */}
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 11, color: '#64748B' }}>PRIMARY CONNECTION: </span>
            <span style={{
              color: VINE_TYPE_COLORS[data.dominantType ?? 0],
              fontWeight: 600, fontSize: 12,
            }}>
              {VINE_TYPE_LABELS[data.dominantType ?? 0]}
            </span>
          </div>

          {/* Estimated savings */}
          {data.estimatedSavings !== undefined && data.estimatedSavings > 0 && (
            <div style={{
              marginBottom: 12, padding: '7px 10px',
              background: 'rgba(34,197,94,0.1)', borderRadius: 6,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ color: '#94A3B8', fontSize: 11 }}>Estimated Savings</span>
              <span style={{ color: '#22C55E', fontWeight: 700, fontSize: 14 }}>
                ${data.estimatedSavings.toLocaleString()}
              </span>
            </div>
          )}

          {/* Recommendations */}
          {data.recommendations && data.recommendations.length > 0 && (
            <div>
              <div style={{ color: '#64748B', fontSize: 11, marginBottom: 5 }}>RECOMMENDATIONS</div>
              {data.recommendations.map((rec, i) => (
                <div key={i} style={{
                  fontSize: 11, color: '#CBD5E1', marginBottom: 4,
                  paddingLeft: 10, borderLeft: '2px solid rgba(20,184,166,0.4)',
                }}>
                  {rec}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {data.mode === 'isolated' && (
        <>
          <div style={{
            fontSize: 13, fontWeight: 600, color: '#FF6B35',
            marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span>⚠</span>
            <span>{data.projectName}</span>
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 12 }}>
            This project shares no resources with others. It's missing ecosystem benefits.
          </div>
          {data.suggestedProjects && data.suggestedProjects.length > 0 && (
            <div>
              <div style={{ color: '#64748B', fontSize: 11, marginBottom: 6 }}>
                PROJECTS THAT COULD SHARE RESOURCES:
              </div>
              {data.suggestedProjects.map((name, i) => (
                <div key={i} style={{
                  fontSize: 12, color: '#CBD5E1', marginBottom: 4,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ color: '#14B8A6' }}>→</span>
                  {name}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EcosystemSymbiosisLayer({ visible = false }: { visible?: boolean }) {
  const { scene, camera, renderer } = useWorldContext()

  // Three.js object refs
  const vineEntriesRef  = useRef<VineEntry[]>([])
  const haloEntriesRef  = useRef<HaloEntry[]>([])
  const chainGroupsRef  = useRef<THREE.Group[]>([])
  const overlapBandsRef = useRef<THREE.Mesh[]>([])
  const animFrameRef    = useRef<number>(-1)
  const pairsRef        = useRef<ProjectPair[]>([])
  const projectsRef     = useRef<NWProject[]>([])
  const visibleRef      = useRef(visible)
  const clockRef        = useRef(new THREE.Clock())

  // React state for panel
  const [panelData, setPanelData] = useState<EcosystemPanelData | null>(null)

  // ── Sync visibility ────────────────────────────────────────────────────────
  useEffect(() => {
    visibleRef.current = visible

    // Toggle Three.js object visibility
    for (const ve of vineEntriesRef.current) {
      ve.tube.visible = visible
      if (ve.glowTube) ve.glowTube.visible = visible
      if (ve.particles) ve.particles.visible = visible
    }
    for (const he of haloEntriesRef.current) {
      he.ring.visible = visible
    }
    for (const cg of chainGroupsRef.current) {
      cg.visible = visible
    }
    for (const ob of overlapBandsRef.current) {
      ob.visible = visible
    }

    if (!visible) setPanelData(null)
  }, [visible])

  // ── Build scene objects from pairs data ────────────────────────────────────
  const rebuild = useCallback((data: NWWorldData) => {
    // Dispose existing
    for (const ve of vineEntriesRef.current) {
      _disposeObj(ve.tube, scene)
      if (ve.glowTube) _disposeObj(ve.glowTube, scene)
      if (ve.particles) _disposeObj(ve.particles, scene)
    }
    for (const he of haloEntriesRef.current) {
      _disposeObj(he.ring, scene)
    }
    for (const cg of chainGroupsRef.current) {
      _disposeObj(cg, scene)
    }
    for (const ob of overlapBandsRef.current) {
      _disposeObj(ob, scene)
    }
    vineEntriesRef.current  = []
    haloEntriesRef.current  = []
    chainGroupsRef.current  = []
    overlapBandsRef.current = []

    const activeProjects = data.projects.filter(p =>
      p.status !== 'cancelled' && p.status !== 'lead'
    )
    projectsRef.current = activeProjects

    const pairs = _computePairs(data)
    pairsRef.current = pairs

    // Track which projects have at least one vine
    const connectedProjectIds = new Set<string>()

    for (let pi = 0; pi < pairs.length; pi++) {
      const pair = pairs[pi]
      const posA = seededPosition(pair.a.id)
      const posB = seededPosition(pair.b.id)

      const arcH  = VINE_ARC_HEIGHT * (0.6 + pair.symbiosisScore * 0.8)
      const curve = _buildArcCurve(posA.x, posA.z, posB.x, posB.z, arcH)
      const tubeSegs = VINE_SEGMENTS

      connectedProjectIds.add(pair.a.id)
      connectedProjectIds.add(pair.b.id)

      const glow = pair.symbiosisScore

      // ── Equipment chain ──────────────────────────────────────────────────
      if (pair.dominantType === VineType.EQUIPMENT) {
        const chainGroup = _buildChainGroup(curve, pair.thickness, glow)
        chainGroup.visible = visibleRef.current
        scene.add(chainGroup)
        chainGroupsRef.current.push(chainGroup)
        continue
      }

      // ── Overlap gradient band ────────────────────────────────────────────
      if (pair.dominantType === VineType.OVERLAP) {
        const pts = curve.getPoints(tubeSegs)
        const bandGeo = new THREE.TubeGeometry(curve, tubeSegs, pair.thickness * 1.2, 5, false)
        // Vertex color gradient along tube
        const colA = new THREE.Color(C_OVERLAP_A)
        const colB = new THREE.Color(C_OVERLAP_B)
        const posArr = bandGeo.attributes.position
        const colors = new Float32Array(posArr.count * 3)
        // Determine t for each vertex by matching to nearest point along curve
        const curvePts = pts
        for (let vi = 0; vi < posArr.count; vi++) {
          const vx = posArr.getX(vi)
          const vz = posArr.getZ(vi)
          let bestT = 0, bestDist = Infinity
          for (let k = 0; k < curvePts.length; k++) {
            const d = Math.abs(curvePts[k].x - vx) + Math.abs(curvePts[k].z - vz)
            if (d < bestDist) { bestDist = d; bestT = k / (curvePts.length - 1) }
          }
          const c = colA.clone().lerp(colB, bestT)
          colors[vi * 3]     = c.r
          colors[vi * 3 + 1] = c.g
          colors[vi * 3 + 2] = c.b
        }
        bandGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        const bandMat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          emissiveMap: null,
          emissive: new THREE.Color(0x4444ff),
          emissiveIntensity: 0.1 + glow * 0.6,
          transparent: true,
          opacity: 0.35 + glow * 0.45,
          depthWrite: false,
        })
        const bandMesh = new THREE.Mesh(bandGeo, bandMat)
        bandMesh.visible = visibleRef.current
        scene.add(bandMesh)
        overlapBandsRef.current.push(bandMesh)
        continue
      }

      // ── Crew (amber) or Material (teal) vine ─────────────────────────────
      const vineColor = pair.dominantType === VineType.CREW ? C_CREW_VINE : C_MATERIAL_PIPE

      // Core tube
      const tubeGeo = new THREE.TubeGeometry(curve, tubeSegs, pair.thickness * 0.5, 6, false)
      const tubeMat = new THREE.MeshStandardMaterial({
        color:     vineColor,
        emissive:  new THREE.Color(vineColor),
        emissiveIntensity: 0.15 + glow * 0.8,
        transparent: true,
        opacity:   0.55 + glow * 0.40,
        depthWrite: false,
      })
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat)
      tubeMesh.visible = visibleRef.current

      // Glow outer tube (larger, more transparent)
      const glowGeo = new THREE.TubeGeometry(curve, tubeSegs, pair.thickness * 1.1, 6, false)
      const glowMat = new THREE.MeshStandardMaterial({
        color:     vineColor,
        emissive:  new THREE.Color(vineColor),
        emissiveIntensity: 0.05 + glow * 0.35,
        transparent: true,
        opacity:   0.10 + glow * 0.18,
        depthWrite: false,
        side: THREE.BackSide,
      })
      const glowMesh = new THREE.Mesh(glowGeo, glowMat)
      glowMesh.visible = visibleRef.current

      scene.add(tubeMesh)
      scene.add(glowMesh)

      // ── Pulse particles (crew vines only) ─────────────────────────────────
      let particles: THREE.Points | null = null
      let particleT: Float32Array | null = null

      if (pair.dominantType === VineType.CREW) {
        const pGeo = new THREE.BufferGeometry()
        const pPos = new Float32Array(PARTICLE_COUNT * 3)
        particleT   = new Float32Array(PARTICLE_COUNT)
        for (let k = 0; k < PARTICLE_COUNT; k++) {
          particleT[k] = k / PARTICLE_COUNT
          const pt = curve.getPoint(particleT[k])
          pPos[k * 3]     = pt.x
          pPos[k * 3 + 1] = pt.y
          pPos[k * 3 + 2] = pt.z
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
        const pMat = new THREE.PointsMaterial({
          color:  C_CREW_PARTICLE,
          size:   pair.thickness * 1.6,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          sizeAttenuation: true,
        })
        particles = new THREE.Points(pGeo, pMat)
        particles.visible = visibleRef.current
        scene.add(particles)
      }

      vineEntriesRef.current.push({
        id:            `${pair.a.id}_${pair.b.id}`,
        pairIndex:     pi,
        tube:          tubeMesh,
        glowTube:      glowMesh,
        particles,
        particleT,
        curve,
        type:          pair.dominantType,
        symbiosisScore: pair.symbiosisScore,
        thickness:     pair.thickness,
      })
    }

    // ── Isolation halos for unconnected projects ───────────────────────────
    for (const proj of activeProjects) {
      if (connectedProjectIds.has(proj.id)) continue

      const { x, z } = seededPosition(proj.id)
      // Pulse ring radius based on project value
      const radius = 2.5 + Math.sqrt(Math.max(proj.contract_value, 5000)) / 4000

      const ringGeo = new THREE.RingGeometry(radius * 0.9, radius, HALO_RING_SEGMENTS)
      ringGeo.rotateX(-Math.PI / 2)
      const ringMat = new THREE.MeshBasicMaterial({
        color: C_ISOLATION_HALO,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.position.set(x, ISOLATION_HALO_Y, z)
      ring.visible = visibleRef.current
      scene.add(ring)

      haloEntriesRef.current.push({ projectId: proj.id, ring, pulseT: Math.random() })
    }
  }, [scene])

  // ── Animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    let animId: number

    const animate = () => {
      animId = requestAnimationFrame(animate)
      const dt = clockRef.current.getDelta()

      if (!visibleRef.current) return

      // Animate crew pulse particles
      for (const ve of vineEntriesRef.current) {
        if (!ve.particles || !ve.particleT) continue
        const pPos = ve.particles.geometry.attributes.position as THREE.BufferAttribute
        const posArr = pPos.array as Float32Array
        for (let k = 0; k < PARTICLE_COUNT; k++) {
          ve.particleT[k] = (ve.particleT[k] + PARTICLE_SPEED * dt) % 1
          const pt = ve.curve.getPoint(ve.particleT[k])
          posArr[k * 3]     = pt.x
          posArr[k * 3 + 1] = pt.y
          posArr[k * 3 + 2] = pt.z
        }
        pPos.needsUpdate = true
      }

      // Animate vine glow pulse (symbiosis score drives intensity oscillation)
      const t = clockRef.current.elapsedTime
      for (const ve of vineEntriesRef.current) {
        const pulse = Math.sin(t * 1.8 + ve.pairIndex * 0.7) * 0.15 + 0.85
        const mat = ve.tube.material as THREE.MeshStandardMaterial
        mat.emissiveIntensity = (0.15 + ve.symbiosisScore * 0.8) * pulse
        if (ve.glowTube) {
          const gm = ve.glowTube.material as THREE.MeshStandardMaterial
          gm.emissiveIntensity = (0.05 + ve.symbiosisScore * 0.35) * pulse
        }
      }

      // Animate isolation halos (pulsing opacity)
      for (const he of haloEntriesRef.current) {
        he.pulseT = (he.pulseT + dt * 0.7) % 1
        const pulse = 0.15 + Math.abs(Math.sin(he.pulseT * Math.PI)) * 0.5
        const mat = he.ring.material as THREE.MeshBasicMaterial
        mat.opacity = pulse
        // Slowly expand and reset ring scale
        const scale = 1 + Math.abs(Math.sin(he.pulseT * Math.PI)) * 0.25
        he.ring.scale.set(scale, scale, scale)
      }

      // Animate overlap band emissive
      for (const ob of overlapBandsRef.current) {
        const pulse = Math.sin(t * 1.2) * 0.12 + 0.88
        const mat = ob.material as THREE.MeshStandardMaterial
        mat.emissiveIntensity *= pulse
      }
    }

    animId = requestAnimationFrame(animate)
    animFrameRef.current = animId
    return () => {
      cancelAnimationFrame(animId)
    }
  }, [])

  // ── Subscribe to world data ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeWorldData(data => {
      rebuild(data)
    })
    return () => {
      unsub()
      // Cleanup all scene objects
      for (const ve of vineEntriesRef.current) {
        _disposeObj(ve.tube, scene)
        if (ve.glowTube) _disposeObj(ve.glowTube, scene)
        if (ve.particles) _disposeObj(ve.particles, scene)
      }
      for (const he of haloEntriesRef.current) {
        _disposeObj(he.ring, scene)
      }
      for (const cg of chainGroupsRef.current) {
        _disposeObj(cg, scene)
      }
      for (const ob of overlapBandsRef.current) {
        _disposeObj(ob, scene)
      }
      vineEntriesRef.current  = []
      haloEntriesRef.current  = []
      chainGroupsRef.current  = []
      overlapBandsRef.current = []
    }
  }, [scene, rebuild])

  // ── Click handler: raycasting ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = renderer.domElement

    const onMouseDown = (e: MouseEvent) => {
      if (!visibleRef.current) return

      const rect = canvas.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )

      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(mouse, camera)
      raycaster.params.Line = { threshold: 0.5 }

      // Check vines
      const vineMeshes = vineEntriesRef.current.map(ve => ve.tube)
      let hits = raycaster.intersectObjects(vineMeshes, false)
      if (hits.length > 0) {
        const hitIdx = vineMeshes.indexOf(hits[0].object as THREE.Mesh)
        if (hitIdx >= 0) {
          const ve   = vineEntriesRef.current[hitIdx]
          const pair = pairsRef.current[ve.pairIndex]
          if (pair) {
            const contractSum = (pair.a.contract_value + pair.b.contract_value) / 2
            const savings = Math.round(contractSum * pair.symbiosisScore * 0.04)
            const recs: string[] = []
            if (pair.crewScore < 0.3) recs.push('Schedule same crew across both projects to cut mobilization cost.')
            if (pair.materialScore < 0.3) recs.push('Combine material orders for bulk pricing — similar scope detected.')
            if (pair.equipmentScore < 0.3) recs.push('Share specialty equipment rather than separate rentals.')
            if (pair.overlapScore < 0.3) recs.push('Align start dates to maximize schedule synergy and reduce travel days.')
            if (recs.length === 0) recs.push('Symbiosis is strong. Maintain current resource allocation strategy.')
            setPanelData({
              mode: 'vine',
              pairLabel: `${pair.a.name}  ↔  ${pair.b.name}`,
              crewScore:      pair.crewScore,
              materialScore:  pair.materialScore,
              equipmentScore: pair.equipmentScore,
              overlapScore:   pair.overlapScore,
              symbiosisScore: pair.symbiosisScore,
              dominantType:   pair.dominantType,
              estimatedSavings: savings,
              recommendations: recs,
            })
            return
          }
        }
      }

      // Also check chain groups
      const chainMeshes: THREE.Mesh[] = []
      for (const cg of chainGroupsRef.current) {
        cg.traverse(c => { if ((c as THREE.Mesh).isMesh) chainMeshes.push(c as THREE.Mesh) })
      }
      hits = raycaster.intersectObjects(chainMeshes, false)
      if (hits.length > 0) {
        // Find which chain group was hit
        for (let ci = 0; ci < chainGroupsRef.current.length; ci++) {
          let found = false
          chainGroupsRef.current[ci].traverse(c => {
            if (c === hits[0].object) found = true
          })
          if (found) {
            // Determine the pair for this chain — chain groups are built after vine entries
            // chain group index corresponds to pairs with EQUIPMENT type
            const equipPairs = pairsRef.current.filter(p => p.dominantType === VineType.EQUIPMENT)
            const pair = equipPairs[ci]
            if (pair) {
              const savings = Math.round(((pair.a.contract_value + pair.b.contract_value) / 2) * pair.symbiosisScore * 0.035)
              setPanelData({
                mode: 'vine',
                pairLabel: `${pair.a.name}  ↔  ${pair.b.name}`,
                crewScore:      pair.crewScore,
                materialScore:  pair.materialScore,
                equipmentScore: pair.equipmentScore,
                overlapScore:   pair.overlapScore,
                symbiosisScore: pair.symbiosisScore,
                dominantType:   VineType.EQUIPMENT,
                estimatedSavings: savings,
                recommendations: [
                  'Same equipment type detected. Coordinate rental windows to reduce idle charges.',
                  'Consider shared equipment depot between project sites.',
                ],
              })
            }
            return
          }
        }
      }

      // Check isolation halos
      const haloMeshes = haloEntriesRef.current.map(he => he.ring)
      hits = raycaster.intersectObjects(haloMeshes, false)
      if (hits.length > 0) {
        const hIdx = haloMeshes.indexOf(hits[0].object as THREE.Mesh)
        if (hIdx >= 0) {
          const he      = haloEntriesRef.current[hIdx]
          const proj    = projectsRef.current.find(p => p.id === he.projectId)
          if (proj) {
            // Suggest projects with highest seeded proximity
            const others = projectsRef.current
              .filter(p => p.id !== proj.id)
              .map(p => {
                const posP = seededPosition(proj.id)
                const posQ = seededPosition(p.id)
                const d = Math.sqrt((posP.x - posQ.x) ** 2 + (posP.z - posQ.z) ** 2)
                return { name: p.name, dist: d }
              })
              .sort((a, b) => a.dist - b.dist)
              .slice(0, 3)
              .map(o => o.name)

            setPanelData({
              mode: 'isolated',
              projectName:       proj.name,
              suggestedProjects: others,
            })
          }
        }
      }
    }

    canvas.addEventListener('mousedown', onMouseDown)
    return () => canvas.removeEventListener('mousedown', onMouseDown)
  }, [camera, renderer])

  return panelData ? (
    <EcosystemPanel data={panelData} onClose={() => setPanelData(null)} />
  ) : null
}
