/**
 * MyceliumNetworkLayer.tsx — NW58: Underground Resource Connection Network
 *
 * Like fungal mycelium networks underground, this layer reveals the hidden
 * resource connections beneath the surface — material supply chains, vendor
 * relationships, crew knowledge transfer, and client relationships flowing
 * between project mountains.
 *
 * Toggle reveals a semi-transparent underground layer BELOW the ground plane:
 * - Ground becomes 60% transparent (underground network visible through it)
 * - Organic branching lines (CatmullRomCurve3 with random waypoints, not straight)
 * - White-blue thin root-like tubes spreading between project positions
 * - Glowing nodes at branch points
 *
 * Connection types:
 * - client     : same client_id — deepest, brightest connections
 * - material   : same project type — thick supply chain links
 * - knowledge  : same crew member across projects — thin, pulsing
 * - proximity  : nearby job sites — faint logistical advantage lines
 *
 * Nutrient flow particles:
 * - Teal  : knowledge flowing from completed → active projects
 * - Gold  : material cost savings from bulk ordering
 * - Amber : crew experience accumulated and shared
 *
 * Health states:
 * - healthy: bright tubes, active particles, thick connections
 * - weak   : dim, sparse particles, thin connections
 * - dead   : no connections — pulsing red disc marks isolated project
 *
 * Click any tube → ConnectionInfoPanel (resource shared + estimated value)
 * Click a dead disc → DeadZonePanel (suggestions to connect the project)
 *
 * Layer toggle ID: 'mycelium'
 * Default: OFF
 */

import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWProject,
  type NWFieldLog,
  type NWWorldData,
} from './DataBridge'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Depth levels for the underground network */
const SURFACE_Y   = -0.6   // entry/exit just below terrain
const SHALLOW_Y   = -2.0   // first descent
const MID_Y       = -4.0   // mid-depth meander
const DEEP_Y      = -6.0   // deepest organic dip

/** Ground transparency when layer is active */
const GROUND_OPACITY_ACTIVE = 0.38

/** Geometry detail */
const TUBE_SEGMENTS   = 52
const TUBE_RADIAL     = 5    // tube cross-section segments (organic, not perfectly round)
const PARTICLES_PER   = 70   // particles per connection
const SPHERE_SEGS     = 6    // branch node sphere segments

/** Geographic proximity threshold (world-space units) */
const PROX_THRESHOLD_SQ = 72   // ~8.5 units
const MAX_PROX_CONNS    = 14

// ── Color palette ─────────────────────────────────────────────────────────────

const C_CLIENT    = new THREE.Color(0xaadeff)  // bright white-blue:  client relationship
const C_MATERIAL  = new THREE.Color(0x66ccff)  // blue:               material supply chain
const C_KNOWLEDGE = new THREE.Color(0x44aaff)  // teal-blue:          knowledge transfer
const C_PROXIMITY = new THREE.Color(0x1a3366)  // dim navy:           geographic proximity

const C_PARTICLE_TEAL  = new THREE.Color(0x00e5cc)  // knowledge flow
const C_PARTICLE_GOLD  = new THREE.Color(0xffd700)  // material savings
const C_PARTICLE_AMBER = new THREE.Color(0xff9940)  // crew experience

// ── Types ─────────────────────────────────────────────────────────────────────

type ConnectionType = 'client' | 'material' | 'knowledge' | 'proximity'
type HealthState    = 'healthy' | 'weak' | 'dead'

interface MyceliumConnection {
  id:               string
  fromId:           string
  toId:             string
  fromName:         string
  toName:           string
  type:             ConnectionType
  strength:         number        // 0–1
  sharedLabel:      string        // e.g. "Shared solar material vendor"
  estimatedSavings: number        // dollar estimate of shared value
  flowFromFirst:    boolean       // true = flow from → to, false = reverse
}

interface ProjectHealthEntry {
  projectId:       string
  projectName:     string
  health:          HealthState
  connectionCount: number
  suggestions:     string[]
}

interface ClickedConnection {
  conn:    MyceliumConnection
  screenX: number
  screenY: number
}

interface ClickedDeadZone {
  entry:   ProjectHealthEntry
  screenX: number
  screenY: number
}

// Three.js mesh tracking
interface ConnectionMeshData {
  tube:               THREE.Mesh
  particles:          THREE.Points
  particlePositions:  Float32Array
  particleTValues:    Float32Array
  curve:              THREE.CatmullRomCurve3
  particleSpeed:      number
  nodes:              THREE.Mesh[]
  conn:               MyceliumConnection
}

interface DeadZoneMeshData {
  disc:  THREE.Mesh
  entry: ProjectHealthEntry
}

interface SavedGroundState {
  mesh:         THREE.Mesh
  origOpacity:  number
  origTranspar: boolean
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return h
}

function seededRand(seed: number): number {
  const x = Math.sin(seed + 1.618) * 10000
  return x - Math.floor(x)
}

/** Build a deterministic organic underground curve between two surface points */
function buildUndergroundCurve(
  x1: number, z1: number,
  x2: number, z2: number,
  connId: string,
): THREE.CatmullRomCurve3 {
  const h = hashCode(connId)
  const r = (i: number, scale: number) => (seededRand(h + i * 17) * 2 - 1) * scale

  const midX = (x1 + x2) * 0.5
  const midZ = (z1 + z2) * 0.5

  const points = [
    new THREE.Vector3(x1, SURFACE_Y, z1),
    new THREE.Vector3(
      x1 + (midX - x1) * 0.28 + r(1, 1.8),
      SHALLOW_Y + r(2, 0.6),
      z1 + (midZ - z1) * 0.28 + r(3, 1.8),
    ),
    new THREE.Vector3(
      midX + r(4, 2.5),
      MID_Y + r(5, 1.2),
      midZ + r(6, 2.5),
    ),
    new THREE.Vector3(
      midX + (x2 - midX) * 0.35 + r(7, 2.0),
      DEEP_Y + r(8, 1.4),
      midZ + (z2 - midZ) * 0.35 + r(9, 2.0),
    ),
    new THREE.Vector3(
      x2 + r(10, 1.6),
      SHALLOW_Y + r(11, 0.5),
      z2 + r(12, 1.6),
    ),
    new THREE.Vector3(x2, SURFACE_Y, z2),
  ]

  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)
}

function tubeRadius(type: ConnectionType, strength: number): number {
  const base: Record<ConnectionType, number> = {
    client:    0.08,
    material:  0.055,
    knowledge: 0.028,
    proximity: 0.013,
  }
  return base[type] * (0.55 + strength * 0.45)
}

function connectionColor(type: ConnectionType): THREE.Color {
  const map: Record<ConnectionType, THREE.Color> = {
    client:    C_CLIENT,
    material:  C_MATERIAL,
    knowledge: C_KNOWLEDGE,
    proximity: C_PROXIMITY,
  }
  return map[type].clone()
}

function connectionOpacity(type: ConnectionType, strength: number): number {
  const base: Record<ConnectionType, number> = {
    client:    0.72,
    material:  0.55,
    knowledge: 0.45,
    proximity: 0.22,
  }
  return base[type] * (0.6 + strength * 0.4)
}

function particleColor(type: ConnectionType): THREE.Color {
  switch (type) {
    case 'knowledge': return C_PARTICLE_TEAL.clone()
    case 'material':  return C_PARTICLE_GOLD.clone()
    case 'client':    return C_PARTICLE_TEAL.clone()
    case 'proximity': return C_PARTICLE_AMBER.clone()
  }
}

function particleSize(type: ConnectionType, strength: number): number {
  const base: Record<ConnectionType, number> = {
    client:    0.18,
    material:  0.15,
    knowledge: 0.10,
    proximity: 0.07,
  }
  return base[type] * (0.7 + strength * 0.3)
}

/** Classify project health state based on connection count */
function classifyHealth(
  p: NWProject,
  connCount: number,
  maxConns: number,
): { health: HealthState; suggestions: string[] } {
  if (connCount === 0) {
    const typeStr = p.type ?? 'general'
    return {
      health: 'dead',
      suggestions: [
        `Assign a crew member experienced in ${typeStr} projects to transfer knowledge from established sites`,
        `Use the same material vendor as nearby ${typeStr} projects to unlock bulk ordering discounts`,
        `Schedule this site alongside geographically close projects to share travel costs`,
        `Link this project to an existing client account — client relationships create the deepest network bonds`,
        `Add project type metadata to improve material supply chain matching`,
      ],
    }
  }

  const ratio = maxConns > 0 ? connCount / maxConns : 0
  if (connCount >= 4 || ratio >= 0.5) {
    return { health: 'healthy', suggestions: [] }
  }

  return {
    health: 'weak',
    suggestions: [
      'Add crew members with cross-project experience to strengthen knowledge flow',
      'Bulk-order materials alongside more projects of the same type',
    ],
  }
}

// ── Connection builder ────────────────────────────────────────────────────────

function buildConnections(
  projects: NWProject[],
  fieldLogs: NWFieldLog[],
): MyceliumConnection[] {
  const conns: MyceliumConnection[] = []
  const connSet = new Set<string>()
  const ACTIVE_STATUSES = new Set(['in_progress', 'approved', 'on_hold', 'pending', 'completed'])

  const activeProjects = projects.filter(p => ACTIVE_STATUSES.has(p.status))

  function addConn(
    fromP: NWProject,
    toP: NWProject,
    type: ConnectionType,
    strength: number,
    sharedLabel: string,
    estimatedSavings: number,
  ) {
    const key = [fromP.id, toP.id].sort().join('::')
    if (connSet.has(key)) return
    connSet.add(key)

    const fromTime = fromP.created_at ? new Date(fromP.created_at).getTime() : 0
    const toTime   = toP.created_at   ? new Date(toP.created_at).getTime()   : 0
    const fromCompleted = fromP.status === 'completed'
    const toCompleted   = toP.status === 'completed'

    // Flow direction: from established/completed toward newer/active
    const fromIsFirst =
      fromCompleted && !toCompleted ? true :
      !fromCompleted && toCompleted ? false :
      fromTime <= toTime

    conns.push({
      id: key,
      fromId:   fromP.id,
      toId:     toP.id,
      fromName: fromP.name,
      toName:   toP.name,
      type,
      strength,
      sharedLabel,
      estimatedSavings,
      flowFromFirst: fromIsFirst,
    })
  }

  // ── 1. Client relationships ───────────────────────────────────────────────
  const byClient = new Map<string, NWProject[]>()
  for (const p of activeProjects) {
    if (!p.client_id) continue
    const arr = byClient.get(p.client_id) ?? []
    arr.push(p)
    byClient.set(p.client_id, arr)
  }
  for (const [, group] of byClient) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j]
        const combinedVal = (a.contract_value + b.contract_value) * 0.012
        addConn(a, b, 'client', 0.9, 'Shared client relationship', combinedVal)
      }
    }
  }

  // ── 2. Material supply chain (same project type) ───────────────────────────
  const byType = new Map<string, NWProject[]>()
  for (const p of activeProjects) {
    const t = p.type ?? 'general'
    const arr = byType.get(t) ?? []
    arr.push(p)
    byType.set(t, arr)
  }
  for (const [typeName, group] of byType) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j]
        const minMat  = Math.min(a.material_cost, b.material_cost)
        const savings = minMat * 0.09  // ~9% bulk discount estimate
        addConn(a, b, 'material', 0.72, `Shared ${typeName} material supply chain`, savings)
      }
    }
  }

  // ── 3. Knowledge transfer (shared crew via field logs) ────────────────────
  const crewToProjects = new Map<string, Set<string>>()
  for (const log of fieldLogs) {
    if (!log.crew_id || !log.project_id) continue
    const s = crewToProjects.get(log.crew_id) ?? new Set<string>()
    s.add(log.project_id)
    crewToProjects.set(log.crew_id, s)
  }
  const activeIdSet = new Set(activeProjects.map(p => p.id))
  const projectById = new Map(activeProjects.map(p => [p.id, p]))

  for (const [, projectIds] of crewToProjects) {
    const relevantIds = [...projectIds].filter(id => activeIdSet.has(id))
    if (relevantIds.length < 2) continue
    for (let i = 0; i < relevantIds.length; i++) {
      for (let j = i + 1; j < relevantIds.length; j++) {
        const fromP = projectById.get(relevantIds[i])
        const toP   = projectById.get(relevantIds[j])
        if (!fromP || !toP) continue
        addConn(fromP, toP, 'knowledge', 0.55, 'Shared crew — learned techniques transfer', 0)
      }
    }
  }

  // ── 4. Geographic proximity ───────────────────────────────────────────────
  let proxCount = 0
  outer:
  for (let i = 0; i < activeProjects.length; i++) {
    for (let j = i + 1; j < activeProjects.length; j++) {
      if (proxCount >= MAX_PROX_CONNS) break outer
      const a = activeProjects[i], b = activeProjects[j]
      const pa = seededPosition(a.id), pb = seededPosition(b.id)
      const dx = pa.x - pb.x, dz = pa.z - pb.z
      if (dx * dx + dz * dz < PROX_THRESHOLD_SQ) {
        addConn(a, b, 'proximity', 0.32, 'Geographic proximity — shared logistics window', 0)
        proxCount++
      }
    }
  }

  return conns
}

// ── React sub-panels ──────────────────────────────────────────────────────────

const PANEL_BASE: React.CSSProperties = {
  position: 'fixed',
  background: 'rgba(6,12,24,0.94)',
  border: '1px solid rgba(0,229,204,0.35)',
  borderRadius: 10,
  padding: '16px 18px',
  fontFamily: 'monospace',
  color: '#c8eeff',
  fontSize: 13,
  zIndex: 999,
  boxShadow: '0 4px 32px rgba(0,0,0,0.7), 0 0 20px rgba(0,229,204,0.08)',
  maxWidth: 320,
  lineHeight: 1.55,
  pointerEvents: 'all',
  userSelect: 'none',
}

function clampedPanelPos(screenX: number, screenY: number) {
  const W = window.innerWidth
  const H = window.innerHeight
  const panelW = 320
  const panelH = 220
  const margin = 12
  const x = Math.min(Math.max(screenX + 18, margin), W - panelW - margin)
  const y = Math.min(Math.max(screenY - 40, margin), H - panelH - margin)
  return { left: x, top: y }
}

const TYPE_LABELS: Record<ConnectionType, { label: string; color: string; icon: string }> = {
  client:    { label: 'Client Relationship',    color: '#aadeff', icon: '◈' },
  material:  { label: 'Material Supply Chain',  color: '#66ccff', icon: '◆' },
  knowledge: { label: 'Knowledge Transfer',     color: '#00e5cc', icon: '∿' },
  proximity: { label: 'Geographic Proximity',   color: '#4488bb', icon: '◎' },
}

interface ConnectionPanelProps {
  data:    ClickedConnection
  onClose: () => void
}

function ConnectionInfoPanel({ data, onClose }: ConnectionPanelProps) {
  const { conn, screenX, screenY } = data
  const pos = clampedPanelPos(screenX, screenY)
  const typeMeta = TYPE_LABELS[conn.type]

  return (
    <div style={{ ...PANEL_BASE, left: pos.left, top: pos.top }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ color: typeMeta.color, fontSize: 11, letterSpacing: 1.5, fontWeight: 700 }}>
          {typeMeta.icon} MYCELIUM CONNECTION
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
        >
          ×
        </button>
      </div>

      {/* Type badge */}
      <div style={{
        display: 'inline-block',
        background: `${typeMeta.color}18`,
        border: `1px solid ${typeMeta.color}44`,
        color: typeMeta.color,
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 10,
        letterSpacing: 1.2,
        fontWeight: 700,
        marginBottom: 10,
      }}>
        {typeMeta.label.toUpperCase()}
      </div>

      {/* Connected projects */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, marginBottom: 4 }}>CONNECTED PROJECTS</div>
        <div style={{ color: '#eef8ff', fontWeight: 600 }}>{conn.fromName}</div>
        <div style={{ color: 'rgba(0,229,204,0.6)', fontSize: 11, textAlign: 'center', margin: '2px 0' }}>⟷</div>
        <div style={{ color: '#eef8ff', fontWeight: 600 }}>{conn.toName}</div>
      </div>

      {/* Shared resource */}
      <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(0,229,204,0.06)', borderRadius: 6, borderLeft: `2px solid ${typeMeta.color}55` }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, marginBottom: 2 }}>SHARED RESOURCE</div>
        <div style={{ color: '#c8eeff' }}>{conn.sharedLabel}</div>
      </div>

      {/* Estimated value */}
      {conn.estimatedSavings > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, padding: '4px 10px', background: 'rgba(255,215,0,0.06)', borderRadius: 5 }}>
          <span style={{ fontSize: 10, color: 'rgba(255,215,0,0.7)', letterSpacing: 1 }}>EST. SHARED VALUE</span>
          <span style={{ color: '#ffd700', fontWeight: 700, fontSize: 14 }}>
            ${conn.estimatedSavings.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
        </div>
      )}

      {/* Flow direction */}
      <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(0,229,204,0.55)', letterSpacing: 0.8 }}>
        Nutrient flow: {conn.flowFromFirst ? conn.fromName : conn.toName} → {conn.flowFromFirst ? conn.toName : conn.fromName}
      </div>

      {/* Network strength */}
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: 1 }}>BOND STRENGTH</span>
        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${conn.strength * 100}%`, height: '100%', background: typeMeta.color, borderRadius: 2 }} />
        </div>
        <span style={{ fontSize: 10, color: typeMeta.color }}>{Math.round(conn.strength * 100)}%</span>
      </div>
    </div>
  )
}

interface DeadZonePanelProps {
  data:    ClickedDeadZone
  onClose: () => void
}

function DeadZonePanel({ data, onClose }: DeadZonePanelProps) {
  const { entry, screenX, screenY } = data
  const pos = clampedPanelPos(screenX, screenY)

  return (
    <div style={{ ...PANEL_BASE, left: pos.left, top: pos.top, border: '1px solid rgba(255,40,60,0.35)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ color: '#ff4466', fontSize: 11, letterSpacing: 1.5, fontWeight: 700 }}>
          ◉ ISOLATED PROJECT
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
        >
          ×
        </button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ color: '#eef8ff', fontWeight: 600, fontSize: 14 }}>{entry.projectName}</div>
        <div style={{ fontSize: 10, color: 'rgba(255,60,80,0.7)', letterSpacing: 1, marginTop: 2 }}>
          NO MYCELIUM CONNECTIONS DETECTED — FULLY ISOLATED
        </div>
      </div>

      <div style={{ padding: '6px 10px', background: 'rgba(255,40,60,0.05)', borderRadius: 6, borderLeft: '2px solid rgba(255,40,60,0.35)', marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, marginBottom: 4 }}>
          THIS PROJECT ISN'T BENEFITING FROM YOUR ECOSYSTEM
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
          Isolated projects miss bulk material savings, crew knowledge transfer, and logistics synergies.
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, color: 'rgba(0,229,204,0.6)', letterSpacing: 1, marginBottom: 6 }}>
          SUGGESTIONS TO CONNECT
        </div>
        {entry.suggestions.slice(0, 3).map((s, i) => (
          <div key={i} style={{
            display: 'flex', gap: 8, marginBottom: 5, fontSize: 11, color: 'rgba(200,238,255,0.75)',
          }}>
            <span style={{ color: 'rgba(0,229,204,0.5)', flexShrink: 0, marginTop: 1 }}>▸</span>
            <span>{s}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

interface MyceliumNetworkLayerProps {
  visible: boolean
}

export function MyceliumNetworkLayer({ visible }: MyceliumNetworkLayerProps) {
  const { scene, camera, renderer } = useWorldContext()

  // Three.js group (all mycelium objects live in this group)
  const groupRef = useRef<THREE.Group>(new THREE.Group())

  // Tracking refs
  const connectionsRef       = useRef<ConnectionMeshData[]>([])
  const deadZonesRef         = useRef<DeadZoneMeshData[]>([])
  const frameHandlerRef      = useRef<(() => void) | null>(null)
  const clockRef             = useRef(new THREE.Clock())
  const elapsedRef           = useRef(0)
  const visibleRef           = useRef(visible)
  const savedGroundsRef      = useRef<SavedGroundState[]>([])
  const groundSearchedRef    = useRef(false)

  // Interaction state
  const [clickedConn, setClickedConn] = useState<ClickedConnection | null>(null)
  const [clickedDead, setClickedDead] = useState<ClickedDeadZone | null>(null)

  // ── Ground transparency ─────────────────────────────────────────────────────

  function findGroundMeshes() {
    if (groundSearchedRef.current) return
    groundSearchedRef.current = true
    const saved: SavedGroundState[] = []
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      if (!(obj.geometry instanceof THREE.PlaneGeometry)) return
      // Must be near-horizontal (x rotation ≈ -90°)
      if (Math.abs(obj.rotation.x + Math.PI / 2) > 0.25) return
      const params = (obj.geometry as THREE.PlaneGeometry).parameters
      if (!params || (params.width < 15 && params.height < 15)) return
      const mat = obj.material
      if (!mat || Array.isArray(mat)) return
      const m = mat as THREE.MeshLambertMaterial | THREE.MeshStandardMaterial
      saved.push({
        mesh:        obj,
        origOpacity: m.opacity  ?? 1.0,
        origTranspar: m.transparent ?? false,
      })
    })
    savedGroundsRef.current = saved
  }

  function applyGroundTransparency(active: boolean) {
    findGroundMeshes()
    for (const entry of savedGroundsRef.current) {
      const m = entry.mesh.material as THREE.MeshLambertMaterial | THREE.MeshStandardMaterial
      if (Array.isArray(m)) continue
      if (active) {
        m.transparent = true
        m.opacity = GROUND_OPACITY_ACTIVE
      } else {
        m.transparent = entry.origTranspar
        m.opacity     = entry.origOpacity
      }
      m.needsUpdate = true
    }
  }

  // ── Visibility sync ─────────────────────────────────────────────────────────

  useEffect(() => {
    visibleRef.current = visible
    groupRef.current.visible = visible
    applyGroundTransparency(visible)
    // Close panels when layer hidden
    if (!visible) {
      setClickedConn(null)
      setClickedDead(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // ── Main effect ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const group = groupRef.current
    scene.add(group)

    // ── Data subscription ────────────────────────────────────────────────────
    const unsub = subscribeWorldData((data: NWWorldData) => {
      buildNetwork(data)
      setupFrameHandler()
    })

    // ── Click detection ──────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster()
    const mouse     = new THREE.Vector2()
    const canvas    = renderer.domElement

    function onClick(e: MouseEvent) {
      if (!visibleRef.current) return
      const rect = canvas.getBoundingClientRect()
      mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)

      // Check connection tubes
      const tubes = connectionsRef.current.map(c => c.tube)
      const connHits = raycaster.intersectObjects(tubes, false)
      if (connHits.length > 0) {
        const hit = connectionsRef.current.find(c => c.tube === connHits[0].object)
        if (hit) {
          setClickedDead(null)
          setClickedConn({ conn: hit.conn, screenX: e.clientX, screenY: e.clientY })
          return
        }
      }

      // Check dead-zone discs
      const discs = deadZonesRef.current.map(d => d.disc)
      const deadHits = raycaster.intersectObjects(discs, false)
      if (deadHits.length > 0) {
        const hit = deadZonesRef.current.find(d => d.disc === deadHits[0].object)
        if (hit) {
          setClickedConn(null)
          setClickedDead({ entry: hit.entry, screenX: e.clientX, screenY: e.clientY })
          return
        }
      }

      // Click on empty space — close panels
      setClickedConn(null)
      setClickedDead(null)
    }

    canvas.addEventListener('click', onClick)

    return () => {
      unsub()
      canvas.removeEventListener('click', onClick)
      disposeAll()
      scene.remove(group)
      // Restore ground transparency
      applyGroundTransparency(false)
      if (frameHandlerRef.current) {
        window.removeEventListener('nw:frame', frameHandlerRef.current)
        frameHandlerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, camera, renderer])

  // ── Network builder ─────────────────────────────────────────────────────────

  function buildNetwork(data: NWWorldData) {
    disposeAll()

    const { projects, fieldLogs } = data
    const ACTIVE_STATUSES = new Set(['in_progress', 'approved', 'on_hold', 'pending', 'completed'])
    const activeProjects  = projects.filter(p => ACTIVE_STATUSES.has(p.status))

    const connections = buildConnections(projects, fieldLogs)

    // Count connections per project
    const connCountMap = new Map<string, number>()
    for (const c of connections) {
      connCountMap.set(c.fromId, (connCountMap.get(c.fromId) ?? 0) + 1)
      connCountMap.set(c.toId,   (connCountMap.get(c.toId)   ?? 0) + 1)
    }
    const maxConns = Math.max(...[...connCountMap.values()], 1)

    // Build connection geometries
    const newConns: ConnectionMeshData[] = []
    for (const conn of connections) {
      const from = seededPosition(conn.fromId)
      const to   = seededPosition(conn.toId)
      const cd   = makeConnectionMesh(conn, from.x, from.z, to.x, to.z)
      if (cd) {
        groupRef.current.add(cd.tube)
        for (const n of cd.nodes) groupRef.current.add(n)
        groupRef.current.add(cd.particles)
        newConns.push(cd)
      }
    }
    connectionsRef.current = newConns

    // Build dead-zone discs for isolated projects
    const connectedIds = new Set(connections.flatMap(c => [c.fromId, c.toId]))
    const newDead: DeadZoneMeshData[] = []
    for (const p of activeProjects) {
      if (connectedIds.has(p.id)) continue
      const { health, suggestions } = classifyHealth(p, 0, maxConns)
      const entry: ProjectHealthEntry = {
        projectId:       p.id,
        projectName:     p.name,
        health,
        connectionCount: 0,
        suggestions,
      }
      const dz = makeDeadZone(entry, seededPosition(p.id))
      if (dz) {
        groupRef.current.add(dz.disc)
        newDead.push(dz)
      }
    }
    deadZonesRef.current = newDead
  }

  // ── Geometry factories ──────────────────────────────────────────────────────

  function makeConnectionMesh(
    conn: MyceliumConnection,
    x1: number, z1: number,
    x2: number, z2: number,
  ): ConnectionMeshData | null {
    try {
      const curve   = buildUndergroundCurve(x1, z1, x2, z2, conn.id)
      const radius  = tubeRadius(conn.type, conn.strength)
      const color   = connectionColor(conn.type)
      const opacity = connectionOpacity(conn.type, conn.strength)

      // Tube
      const tubeGeo = new THREE.TubeGeometry(curve, TUBE_SEGMENTS, radius, TUBE_RADIAL, false)
      const tubeMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
      })
      const tube = new THREE.Mesh(tubeGeo, tubeMat)
      tube.visible             = visibleRef.current
      tube.userData.myceliumId = conn.id

      // Branch nodes at 1/4, 1/2, 3/4 along the curve
      const nodeColor = color.clone().multiplyScalar(1.5)
      const nodes: THREE.Mesh[] = []
      for (const t of [0.25, 0.5, 0.75]) {
        const pt      = curve.getPoint(t)
        const nodeGeo = new THREE.SphereGeometry(radius * 3.2, SPHERE_SEGS, SPHERE_SEGS)
        const nodeMat = new THREE.MeshBasicMaterial({
          color:       nodeColor,
          transparent: true,
          opacity:     opacity * 0.85,
          depthWrite:  false,
        })
        const node = new THREE.Mesh(nodeGeo, nodeMat)
        node.position.copy(pt)
        node.visible = visibleRef.current
        nodes.push(node)
      }

      // Particles (flowing nutrients)
      const positions    = new Float32Array(PARTICLES_PER * 3)
      const tVals        = new Float32Array(PARTICLES_PER)
      const flowDir      = conn.flowFromFirst ? 1 : -1
      const pSpeed       = 0.04 + conn.strength * 0.10
      const pColor       = particleColor(conn.type)
      const pSize        = particleSize(conn.type, conn.strength)

      for (let i = 0; i < PARTICLES_PER; i++) {
        // Stagger start positions based on flow direction
        tVals[i] = conn.flowFromFirst
          ? i / PARTICLES_PER
          : 1 - i / PARTICLES_PER
        const pt = curve.getPoint(Math.max(0, Math.min(1, tVals[i])))
        positions[i * 3]     = pt.x
        positions[i * 3 + 1] = pt.y
        positions[i * 3 + 2] = pt.z
      }

      const particleGeo = new THREE.BufferGeometry()
      particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

      const particleMat = new THREE.PointsMaterial({
        color:         pColor,
        size:          pSize,
        transparent:   true,
        opacity:       0.82,
        depthWrite:    false,
        sizeAttenuation: true,
      })
      const particles    = new THREE.Points(particleGeo, particleMat)
      particles.visible  = visibleRef.current

      return {
        tube, particles, particlePositions: positions, particleTValues: tVals,
        curve, particleSpeed: pSpeed * flowDir, nodes, conn,
      }
    } catch {
      return null
    }
  }

  function makeDeadZone(
    entry: ProjectHealthEntry,
    pos:   { x: number; z: number },
  ): DeadZoneMeshData | null {
    try {
      // Flat cylinder at just below surface to mark dead zone
      const discGeo = new THREE.CylinderGeometry(1.8, 1.8, 0.04, 18)
      const discMat = new THREE.MeshBasicMaterial({
        color:       0x440011,
        transparent: true,
        opacity:     0.35,
        depthWrite:  false,
      })
      const disc          = new THREE.Mesh(discGeo, discMat)
      disc.position.set(pos.x, -0.4, pos.z)
      disc.visible        = visibleRef.current
      disc.userData.dzId  = entry.projectId
      return { disc, entry }
    } catch {
      return null
    }
  }

  // ── Animation frame handler ─────────────────────────────────────────────────

  function setupFrameHandler() {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
    }
    clockRef.current.start()
    elapsedRef.current = 0

    const handler = () => {
      const delta = clockRef.current.getDelta()
      elapsedRef.current += delta
      const t = elapsedRef.current

      if (!visibleRef.current) return

      // ── Animate particles ────────────────────────────────────────────────
      for (const cd of connectionsRef.current) {
        const dir = Math.sign(cd.particleSpeed)
        for (let i = 0; i < PARTICLES_PER; i++) {
          cd.particleTValues[i] += Math.abs(cd.particleSpeed) * delta * dir
          // Wrap 0–1
          if (cd.particleTValues[i] > 1) cd.particleTValues[i] -= 1
          if (cd.particleTValues[i] < 0) cd.particleTValues[i] += 1
          const pt = cd.curve.getPoint(cd.particleTValues[i])
          cd.particlePositions[i * 3]     = pt.x
          cd.particlePositions[i * 3 + 1] = pt.y
          cd.particlePositions[i * 3 + 2] = pt.z
        }
        const posAttr = cd.particles.geometry.getAttribute('position') as THREE.BufferAttribute
        posAttr.needsUpdate = true

        // ── Pulse knowledge + client connections ─────────────────────────
        if (cd.conn.type === 'knowledge' || cd.conn.type === 'client') {
          const tubeMat  = cd.tube.material as THREE.MeshBasicMaterial
          const baseOp   = connectionOpacity(cd.conn.type, cd.conn.strength)
          const pulse    = 0.5 + 0.5 * Math.sin(t * 1.8 + hashCode(cd.conn.id) * 0.1)
          tubeMat.opacity = baseOp * (0.55 + pulse * 0.45)
        }

        // ── Animate branch nodes ──────────────────────────────────────────
        for (let n = 0; n < cd.nodes.length; n++) {
          const nodeMat   = cd.nodes[n].material as THREE.MeshBasicMaterial
          const baseOp    = connectionOpacity(cd.conn.type, cd.conn.strength) * 0.85
          const nodePulse = 0.6 + 0.4 * Math.sin(t * 2.6 + n * 1.3 + hashCode(cd.conn.id) * 0.07)
          nodeMat.opacity = baseOp * nodePulse
        }
      }

      // ── Pulse dead-zone discs ────────────────────────────────────────────
      for (const dz of deadZonesRef.current) {
        const mat  = dz.disc.material as THREE.MeshBasicMaterial
        const seed = hashCode(dz.entry.projectId) * 0.05
        mat.opacity = 0.18 + 0.22 * Math.sin(t * 2.2 + seed)
      }
    }

    window.addEventListener('nw:frame', handler)
    frameHandlerRef.current = handler
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  function disposeAll() {
    for (const cd of connectionsRef.current) {
      groupRef.current.remove(cd.tube)
      cd.tube.geometry.dispose()
      ;(cd.tube.material as THREE.Material).dispose()
      groupRef.current.remove(cd.particles)
      cd.particles.geometry.dispose()
      ;(cd.particles.material as THREE.Material).dispose()
      for (const node of cd.nodes) {
        groupRef.current.remove(node)
        node.geometry.dispose()
        ;(node.material as THREE.Material).dispose()
      }
    }
    connectionsRef.current = []

    for (const dz of deadZonesRef.current) {
      groupRef.current.remove(dz.disc)
      dz.disc.geometry.dispose()
      ;(dz.disc.material as THREE.Material).dispose()
    }
    deadZonesRef.current = []
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {clickedConn && (
        <ConnectionInfoPanel
          data={clickedConn}
          onClose={() => setClickedConn(null)}
        />
      )}
      {clickedDead && (
        <DeadZonePanel
          data={clickedDead}
          onClose={() => setClickedDead(null)}
        />
      )}
    </>
  )
}
