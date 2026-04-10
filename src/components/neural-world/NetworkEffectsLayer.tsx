/**
 * NetworkEffectsLayer.tsx — NW47: Second-order network effects visualization.
 *
 * INFLUENCE RADIATION:
 *   When a significant event happens at any node (invoice paid, phase complete,
 *   lead converted, crew reassigned):
 *   - A radial pulse wave emits from that node outward across the ground plane
 *   - Pulse color: gold=revenue, teal=project progress, amber=workforce, red=risk
 *   - Pulse travels at 5 units/second, fades over 30 units distance
 *   - Any node the pulse reaches gets a brief highlight if it's affected
 *
 * DOWNSTREAM CONNECTIONS:
 *   Thin glowing lines between nodes that have second-order relationships:
 *   - Project completes → frees crew → crew available for another project
 *   - Invoice paid → cash available → can purchase materials for another project
 *   - Lead converts → new project → needs crew from existing project (resource tension)
 *   Lines pulse in the direction of influence (animated dash offset flowing cause→effect).
 *   Line color: gradient from cause-color to effect-color.
 *   Line opacity: proportional to connection strength (0.3–0.8).
 *
 * NETWORK MAP MODE:
 *   Toggle via "Network Effects" layer in layers panel (off by default).
 *   When ON: all current second-order connections visible as a web overlay.
 *   Hover any connection line: tooltip shows the relationship description.
 *   Click any connection: panel shows full cause → effect chain with estimated
 *   dollar impact.
 *
 * DATA SOURCE:
 *   Reads project phases, invoices, crew assignments, leads via DataBridge.
 *   Computes relationships every 30 seconds from live data.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWWorldData,
  type NWProject,
  type NWInvoice,
  type NWFieldLog,
} from './DataBridge'

// ── Constants ─────────────────────────────────────────────────────────────────

const PULSE_SPEED        = 5      // units/second
const PULSE_MAX_RADIUS   = 30     // units — fades completely
const PULSE_EMIT_INTERVAL = 4000  // ms between auto-emits per node type
const REFRESH_INTERVAL   = 30000  // ms between connection recompute
const MAX_PULSES         = 16     // performance cap
const MAX_CONNECTIONS    = 24     // performance cap
const GROUND_Y           = 0.12   // hover height for lines + rings

// ── Event / connection types ──────────────────────────────────────────────────

type EventType = 'revenue' | 'progress' | 'workforce' | 'risk'

type ConnectionType =
  | 'project_crew_project'   // Project A → frees crew → Project B
  | 'invoice_cash_material'  // Invoice paid → cash → material for project
  | 'lead_resource_tension'  // Lead converts → needs crew from active project
  | 'phase_downstream'       // Phase completes → downstream project unblocked

// Colors per event type
const EVENT_COLORS: Record<EventType, THREE.Color> = {
  revenue:   new THREE.Color(0xFFD700),  // gold
  progress:  new THREE.Color(0x00e5cc),  // teal
  workforce: new THREE.Color(0xFF9900),  // amber
  risk:      new THREE.Color(0xff3333),  // red
}

// Human-readable event-type labels
const EVENT_LABELS: Record<EventType, string> = {
  revenue:   'REVENUE EVENT',
  progress:  'PHASE COMPLETE',
  workforce: 'CREW MOVEMENT',
  risk:      'RISK SIGNAL',
}

// ── Data types ────────────────────────────────────────────────────────────────

interface InfluencePulse {
  id: number
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  radius: number
  originX: number
  originZ: number
  eventType: EventType
  /** Affected node IDs that should briefly highlight when pulse reaches them */
  affectedNodeIds: string[]
  birthTime: number
}

interface NodeConnection {
  id: string
  /** Source node world position */
  fromPos: THREE.Vector3
  /** Target node world position */
  toPos: THREE.Vector3
  fromNodeId: string
  toNodeId: string
  fromLabel: string
  toLabel: string
  type: ConnectionType
  causeColor: THREE.Color
  effectColor: THREE.Color
  /** 0.3 = weak, 0.8 = strong */
  strength: number
  /** Human-readable relationship description */
  description: string
  /** Estimated dollar impact */
  estimatedImpact: number
  /** Phase offset for opacity wave animation (simulates directional flow) */
  phaseOffset: number
  /** Three.js objects */
  line: THREE.LineSegments
  lineMaterial: THREE.LineBasicMaterial
}

interface NodeHighlight {
  nodeId: string
  mesh: THREE.Mesh
  expiresAt: number
}

// ── Screen-space tooltip/panel state ─────────────────────────────────────────

interface TooltipState {
  visible: boolean
  screenX: number
  screenY: number
  connectionId: string
}

interface PanelState {
  visible: boolean
  connection: NodeConnection | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _pulseIdCounter = 0

function worldToScreen(
  worldPos: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
): { x: number; y: number; behind: boolean } {
  const ndc = worldPos.clone().project(camera)
  const behind = ndc.z > 1
  const canvas = renderer.domElement
  const rect = canvas.getBoundingClientRect()
  return {
    x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
    y: rect.top  + (1 - (ndc.y * 0.5 + 0.5)) * rect.height,
    behind,
  }
}

/**
 * Screen-space distance from mouse point to a 2D line segment (A → B).
 */
function distPointToSegment2D(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq < 0.0001) {
    return Math.hypot(px - ax, py - ay)
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Create a ring mesh for an influence pulse at ground level.
 */
function makeRingMesh(color: THREE.Color): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
  const geo = new THREE.RingGeometry(0.1, 0.5, 48)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  return { mesh, mat }
}

/**
 * Create a glowing line between two ground-plane points.
 * Uses multiple overlapping line segments at slightly different heights to
 * simulate a glowing tube effect without post-processing.
 */
function makeConnectionLine(
  from: THREE.Vector3,
  to: THREE.Vector3,
  color: THREE.Color,
  opacity: number,
): { line: THREE.LineSegments; mat: THREE.LineBasicMaterial } {
  // Lift slightly above ground
  const a = new THREE.Vector3(from.x, GROUND_Y + 0.05, from.z)
  const b = new THREE.Vector3(to.x,   GROUND_Y + 0.05, to.z)

  const geo = new THREE.BufferGeometry().setFromPoints([a, b])
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    linewidth: 1,
  })
  const line = new THREE.LineSegments(geo, mat)
  return { line, mat }
}

/**
 * Create a node highlight ring (briefly flashes when a pulse hits).
 */
function makeHighlightRing(pos: THREE.Vector3, color: THREE.Color): THREE.Mesh {
  const geo = new THREE.RingGeometry(1.8, 2.4, 32)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(pos.x, GROUND_Y + 0.1, pos.z)
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

// ── Relationship computation ──────────────────────────────────────────────────

interface ComputedRelationship {
  fromNodeId:     string
  toNodeId:       string
  fromLabel:      string
  toLabel:        string
  fromPos:        { x: number; z: number }
  toPos:          { x: number; z: number }
  type:           ConnectionType
  causeEventType: EventType
  effectEventType:EventType
  strength:       number
  description:    string
  estimatedImpact:number
}

function computeRelationships(data: NWWorldData): ComputedRelationship[] {
  const { projects, invoices, fieldLogs } = data
  const results: ComputedRelationship[] = []

  if (projects.length < 2) return results

  // ── 1. Crew sharing: projects with same crew_id in field logs ────────────

  // Build map: crewId → projectIds
  const crewToProjects = new Map<string, Set<string>>()
  for (const fl of fieldLogs) {
    if (!fl.crew_id || !fl.project_id) continue
    if (!crewToProjects.has(fl.crew_id)) {
      crewToProjects.set(fl.crew_id, new Set())
    }
    crewToProjects.get(fl.crew_id)!.add(fl.project_id)
  }

  // For each crew that has 2+ projects, draw connection
  for (const [_crewId, projectSet] of crewToProjects) {
    const pIds = [...projectSet]
    if (pIds.length < 2) continue
    for (let i = 0; i < Math.min(pIds.length - 1, 3); i++) {
      const pA = projects.find(p => p.id === pIds[i])
      const pB = projects.find(p => p.id === pIds[i + 1])
      if (!pA || !pB) continue
      const posA = seededPosition(pA.id)
      const posB = seededPosition(pB.id)
      const avgContract = (pA.contract_value + pB.contract_value) / 2
      const strength = avgContract > 50000 ? 0.8 : avgContract > 20000 ? 0.6 : 0.4
      results.push({
        fromNodeId:      pA.id,
        toNodeId:        pB.id,
        fromLabel:       pA.name,
        toLabel:         pB.name,
        fromPos:         posA,
        toPos:           posB,
        type:            'project_crew_project',
        causeEventType:  'progress',
        effectEventType: 'workforce',
        strength,
        description:     `Shared crew between "${pA.name}" and "${pB.name}". Phase completion on one project frees crew for the other.`,
        estimatedImpact: Math.round(avgContract * 0.15),
      })
    }
  }

  // ── 2. Invoice paid → cash available → material for another project ──────

  const paidInvoices = invoices.filter(
    inv => inv.status === 'paid' && inv.project_id
  )
  // For each paid invoice, find a project that is in_progress with high material cost
  const materialProjects = projects
    .filter(p => p.status === 'in_progress' && p.material_cost > 1000)
    .slice(0, 4)

  for (const inv of paidInvoices.slice(0, 4)) {
    const sourceProject = projects.find(p => p.id === inv.project_id)
    if (!sourceProject) continue
    for (const matProj of materialProjects) {
      if (matProj.id === sourceProject.id) continue
      const posA = seededPosition(sourceProject.id)
      const posB = seededPosition(matProj.id)
      const strength = inv.amount > 10000 ? 0.75 : inv.amount > 5000 ? 0.55 : 0.35
      results.push({
        fromNodeId:      `inv_${inv.id}`,
        toNodeId:        matProj.id,
        fromLabel:       `Invoice paid (${sourceProject.name})`,
        toLabel:         matProj.name,
        fromPos:         posA,
        toPos:           posB,
        type:            'invoice_cash_material',
        causeEventType:  'revenue',
        effectEventType: 'progress',
        strength,
        description:     `Invoice of $${inv.amount.toLocaleString()} paid on "${sourceProject.name}" frees cash for materials on "${matProj.name}".`,
        estimatedImpact: Math.round(inv.amount * 0.3),
      })
      // Limit to 1 material link per paid invoice
      break
    }
  }

  // ── 3. Phase completion → downstream project unblocked ──────────────────

  const advancedProjects = projects.filter(p => p.phase_completion > 60 && p.status === 'in_progress')
  const waitingProjects  = projects.filter(p => p.phase_completion < 30 && p.status === 'approved')

  for (let i = 0; i < Math.min(advancedProjects.length, 3); i++) {
    const adv   = advancedProjects[i]
    const wait  = waitingProjects[i % Math.max(waitingProjects.length, 1)]
    if (!wait || wait.id === adv.id) continue
    const posA = seededPosition(adv.id)
    const posB = seededPosition(wait.id)
    const strength = adv.phase_completion > 80 ? 0.75 : 0.5
    results.push({
      fromNodeId:      adv.id,
      toNodeId:        wait.id,
      fromLabel:       adv.name,
      toLabel:         wait.name,
      fromPos:         posA,
      toPos:           posB,
      type:            'phase_downstream',
      causeEventType:  'progress',
      effectEventType: 'workforce',
      strength,
      description:     `"${adv.name}" completing phase ${Math.round(adv.phase_completion)}% unblocks crew for "${wait.name}" (approved, awaiting resources).`,
      estimatedImpact: Math.round(wait.contract_value * 0.1),
    })
  }

  // ── 4. Lead / high-risk project resource tension ─────────────────────────

  const atRiskProjects = projects.filter(p => p.health_score < 50 && p.status === 'in_progress')
  const leadProjects   = projects.filter(p => p.status === 'lead' || p.status === 'estimate')

  for (let i = 0; i < Math.min(atRiskProjects.length, 2); i++) {
    const risk = atRiskProjects[i]
    const lead = leadProjects[i % Math.max(leadProjects.length, 1)]
    if (!lead || lead.id === risk.id) continue
    const posA = seededPosition(risk.id)
    const posB = seededPosition(lead.id)
    results.push({
      fromNodeId:      lead.id,
      toNodeId:        risk.id,
      fromLabel:       lead.name,
      toLabel:         risk.name,
      fromPos:         posB,
      toPos:           posA,
      type:            'lead_resource_tension',
      causeEventType:  'workforce',
      effectEventType: 'risk',
      strength:        0.65,
      description:     `Converting lead "${lead.name}" creates resource tension with at-risk project "${risk.name}" (health: ${risk.health_score}). Crew demand conflict.`,
      estimatedImpact: Math.round(lead.contract_value * 0.12),
    })
  }

  // Deduplicate and cap at MAX_CONNECTIONS
  const seen = new Set<string>()
  return results
    .filter(r => {
      const key = [r.fromNodeId, r.toNodeId].sort().join('|')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_CONNECTIONS)
}

// ── Effect-chain panel component ──────────────────────────────────────────────

interface ChainPanelProps {
  connection: NodeConnection
  onClose: () => void
}

function ChainPanel({ connection, onClose }: ChainPanelProps) {
  const causeHex  = '#' + connection.causeColor.getHexString()
  const effectHex = '#' + connection.effectColor.getHexString()

  const typeLabels: Record<ConnectionType, string> = {
    project_crew_project:  'CREW FLOW',
    invoice_cash_material: 'CASH → MATERIALS',
    lead_resource_tension: 'RESOURCE TENSION',
    phase_downstream:      'PHASE UNBLOCK',
  }

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 80,
        right: 20,
        width: 320,
        background: 'rgba(4,8,14,0.97)',
        border: `1px solid ${causeHex}55`,
        borderRadius: 10,
        backdropFilter: 'blur(14px)',
        boxShadow: `0 0 28px ${causeHex}22, 0 8px 32px rgba(0,0,0,0.8)`,
        fontFamily: 'monospace',
        zIndex: 62,
        overflow: 'hidden',
        animation: 'nw-chain-panel-in 0.18s ease',
      }}
    >
      <style>{`
        @keyframes nw-chain-panel-in {
          from { opacity: 0; transform: translateX(18px) scale(0.97); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
      `}</style>

      {/* Header */}
      <div style={{
        padding: '12px 14px 10px',
        borderBottom: `1px solid ${causeHex}30`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            color: causeHex,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.8,
            textShadow: `0 0 8px ${causeHex}60`,
          }}>
            ◈ EFFECT CHAIN — {typeLabels[connection.type]}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, marginTop: 2, letterSpacing: 0.8 }}>
            SECOND-ORDER NETWORK EFFECT
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.18)',
            color: 'rgba(255,255,255,0.55)',
            fontSize: 13,
            cursor: 'pointer',
            borderRadius: 4,
            padding: '3px 9px',
            lineHeight: 1.4,
            transition: 'all 0.12s',
          }}
        >✕</button>
      </div>

      {/* Chain visualization */}
      <div style={{ padding: '14px 14px 10px' }}>

        {/* CAUSE node */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderRadius: 6,
          background: `${causeHex}14`,
          border: `1px solid ${causeHex}35`,
          marginBottom: 4,
        }}>
          <div style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: causeHex,
            boxShadow: `0 0 8px ${causeHex}`,
            flexShrink: 0,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: causeHex, fontSize: 9, letterSpacing: 1.2, fontWeight: 700 }}>CAUSE</div>
            <div style={{
              color: 'rgba(255,255,255,0.85)',
              fontSize: 11,
              letterSpacing: 0.3,
              marginTop: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {connection.fromLabel}
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '3px 0 3px 20px',
          gap: 6,
        }}>
          <div style={{
            width: 1,
            height: 20,
            background: `linear-gradient(to bottom, ${causeHex}80, ${effectHex}80)`,
          }} />
          <div style={{ color: 'rgba(255,255,255,0.28)', fontSize: 8, letterSpacing: 1 }}>INFLUENCES</div>
        </div>

        {/* EFFECT node */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderRadius: 6,
          background: `${effectHex}14`,
          border: `1px solid ${effectHex}35`,
          marginTop: 4,
        }}>
          <div style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: effectHex,
            boxShadow: `0 0 8px ${effectHex}`,
            flexShrink: 0,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: effectHex, fontSize: 9, letterSpacing: 1.2, fontWeight: 700 }}>EFFECT</div>
            <div style={{
              color: 'rgba(255,255,255,0.85)',
              fontSize: 11,
              letterSpacing: 0.3,
              marginTop: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {connection.toLabel}
            </div>
          </div>
        </div>

        {/* Description */}
        <div style={{
          marginTop: 12,
          padding: '9px 10px',
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 5,
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, lineHeight: 1.55, letterSpacing: 0.2 }}>
            {connection.description}
          </div>
        </div>

        {/* Dollar impact + strength row */}
        <div style={{
          display: 'flex',
          gap: 8,
          marginTop: 10,
        }}>
          {/* Dollar impact */}
          <div style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: 5,
            background: 'rgba(255,215,0,0.07)',
            border: '1px solid rgba(255,215,0,0.2)',
            textAlign: 'center',
          }}>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 8, letterSpacing: 1 }}>ESTIMATED IMPACT</div>
            <div style={{ color: '#FFD700', fontSize: 14, fontWeight: 700, marginTop: 3 }}>
              ${connection.estimatedImpact.toLocaleString()}
            </div>
          </div>

          {/* Connection strength */}
          <div style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: 5,
            background: `${causeHex}0a`,
            border: `1px solid ${causeHex}22`,
            textAlign: 'center',
          }}>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 8, letterSpacing: 1 }}>STRENGTH</div>
            <div style={{ color: causeHex, fontSize: 14, fontWeight: 700, marginTop: 3 }}>
              {connection.strength >= 0.7 ? 'STRONG' : connection.strength >= 0.5 ? 'MODERATE' : 'WEAK'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface NetworkEffectsLayerProps {
  visible: boolean
}

export function NetworkEffectsLayer({ visible }: NetworkEffectsLayerProps) {
  const { scene, camera, renderer } = useWorldContext()

  // ── Three.js refs ───────────────────────────────────────────────────────

  const groupRef       = useRef<THREE.Group | null>(null)
  const pulsesRef      = useRef<InfluencePulse[]>([])
  const connectionsRef = useRef<NodeConnection[]>([])
  const highlightsRef  = useRef<NodeHighlight[]>([])
  const lastFrameRef   = useRef<number>(0)
  const lastRefreshRef = useRef<number>(0)
  const lastPulseEmitRef = useRef<number>(0)
  const worldDataRef   = useRef<NWWorldData | null>(null)

  // Collect node positions for highlight checks (project mountains)
  const nodePositionsRef = useRef<Map<string, THREE.Vector3>>(new Map())

  // ── React overlay state ─────────────────────────────────────────────────

  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false, screenX: 0, screenY: 0, connectionId: '',
  })
  const [panel, setPanel] = useState<PanelState>({ visible: false, connection: null })
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // ── Build / rebuild connection meshes ────────────────────────────────────

  const rebuildConnections = useCallback((data: NWWorldData) => {
    const group = groupRef.current
    if (!group) return

    // Dispose old connection lines
    for (const conn of connectionsRef.current) {
      conn.line.geometry.dispose()
      conn.lineMaterial.dispose()
      group.remove(conn.line)
    }
    connectionsRef.current = []

    // Recompute node positions
    const posMap = new Map<string, THREE.Vector3>()
    for (const p of data.projects) {
      const pos = seededPosition(p.id)
      const h   = contractValueToHeight(p.contract_value)
      posMap.set(p.id, new THREE.Vector3(pos.x, h + 0.5, pos.z))
    }
    nodePositionsRef.current = posMap

    if (!visible) return

    // Compute relationships
    const relationships = computeRelationships(data)

    // Build meshes
    for (const rel of relationships) {
      const fromWorldPos = posMap.get(rel.fromNodeId)
        ?? new THREE.Vector3(rel.fromPos.x, GROUND_Y, rel.fromPos.z)
      const toWorldPos   = posMap.get(rel.toNodeId)
        ?? new THREE.Vector3(rel.toPos.x,   GROUND_Y, rel.toPos.z)

      const fromPosGround = new THREE.Vector3(fromWorldPos.x, GROUND_Y, fromWorldPos.z)
      const toPosGround   = new THREE.Vector3(toWorldPos.x,   GROUND_Y, toWorldPos.z)

      const causeColor  = EVENT_COLORS[rel.causeEventType].clone()
      const effectColor = EVENT_COLORS[rel.effectEventType].clone()

      // Use mid-point blended color for the line
      const lineColor = causeColor.clone().lerp(effectColor, 0.5)

      const { line, mat } = makeConnectionLine(
        fromPosGround,
        toPosGround,
        lineColor,
        rel.strength,
      )
      group.add(line)

      const conn: NodeConnection = {
        id:              `${rel.fromNodeId}|${rel.toNodeId}`,
        fromPos:         fromPosGround.clone(),
        toPos:           toPosGround.clone(),
        fromNodeId:      rel.fromNodeId,
        toNodeId:        rel.toNodeId,
        fromLabel:       rel.fromLabel,
        toLabel:         rel.toLabel,
        type:            rel.type,
        causeColor,
        effectColor,
        strength:        rel.strength,
        description:     rel.description,
        estimatedImpact: rel.estimatedImpact,
        phaseOffset:     Math.random() * Math.PI * 2,
        line,
        lineMaterial:    mat,
      }
      connectionsRef.current.push(conn)
    }
  }, [visible])

  // ── Emit an influence pulse ──────────────────────────────────────────────

  const emitPulse = useCallback((
    originX: number,
    originZ: number,
    eventType: EventType,
    affectedNodeIds: string[],
  ) => {
    const group = groupRef.current
    if (!group) return
    if (pulsesRef.current.length >= MAX_PULSES) return

    const color = EVENT_COLORS[eventType].clone()
    const { mesh, mat } = makeRingMesh(color)
    mesh.position.set(originX, GROUND_Y, originZ)
    group.add(mesh)

    pulsesRef.current.push({
      id:              ++_pulseIdCounter,
      mesh,
      material:        mat,
      radius:          0.2,
      originX,
      originZ,
      eventType,
      affectedNodeIds,
      birthTime:       performance.now(),
    })
  }, [])

  // ── Auto-emit pulses from data ───────────────────────────────────────────

  const autoEmitPulses = useCallback(() => {
    const data = worldDataRef.current
    if (!data) return

    const { projects, invoices } = data
    if (projects.length === 0) return

    // Pick a random project and determine event type from its state
    const idx  = Math.floor(Math.random() * Math.min(projects.length, 8))
    const proj = projects[idx]
    const pos  = seededPosition(proj.id)

    let eventType: EventType
    if (proj.health_score < 40) {
      eventType = 'risk'
    } else if (proj.phase_completion > 70) {
      eventType = 'progress'
    } else if (invoices.some(inv => inv.project_id === proj.id && inv.status === 'paid')) {
      eventType = 'revenue'
    } else {
      eventType = 'workforce'
    }

    // Determine which other nodes this pulse might affect
    const affectedIds = projects
      .filter(p => p.id !== proj.id)
      .slice(0, 3)
      .map(p => p.id)

    emitPulse(pos.x, pos.z, eventType, affectedIds)
  }, [emitPulse])

  // ── Setup Three.js group ─────────────────────────────────────────────────

  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    const unsub = subscribeWorldData((data: NWWorldData) => {
      worldDataRef.current = data
      rebuildConnections(data)
    })

    return () => {
      unsub()
      // Dispose pulses
      for (const p of pulsesRef.current) {
        p.mesh.geometry.dispose()
        p.material.dispose()
      }
      pulsesRef.current = []
      // Dispose connections
      for (const c of connectionsRef.current) {
        c.line.geometry.dispose()
        c.lineMaterial.dispose()
      }
      connectionsRef.current = []
      // Dispose highlights
      for (const h of highlightsRef.current) {
        h.mesh.geometry.dispose()
        ;(h.mesh.material as THREE.Material).dispose()
        group.remove(h.mesh)
      }
      highlightsRef.current = []
      scene.remove(group)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Sync visibility ──────────────────────────────────────────────────────

  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
    if (!visible) {
      setTooltip(t => ({ ...t, visible: false }))
      setPanel({ visible: false, connection: null })
    } else if (worldDataRef.current) {
      rebuildConnections(worldDataRef.current)
    }
  }, [visible, rebuildConnections])

  // ── 30-second data refresh ───────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => {
      if (worldDataRef.current) {
        rebuildConnections(worldDataRef.current)
      }
    }, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [rebuildConnections])

  // ── Animation frame loop ─────────────────────────────────────────────────

  useEffect(() => {
    function onFrame() {
      if (!groupRef.current?.visible) return

      const now       = performance.now()
      const delta     = lastFrameRef.current > 0 ? (now - lastFrameRef.current) / 1000 : 0.016
      lastFrameRef.current = now

      const group = groupRef.current!

      // ── Auto-emit pulses ──────────────────────────────────────────────

      if (now - lastPulseEmitRef.current > PULSE_EMIT_INTERVAL) {
        lastPulseEmitRef.current = now
        autoEmitPulses()
      }

      // ── Animate influence pulses ──────────────────────────────────────

      const posMap = nodePositionsRef.current
      const newHighlights: NodeHighlight[] = []

      pulsesRef.current = pulsesRef.current.filter(pulse => {
        pulse.radius += PULSE_SPEED * delta
        const progress = pulse.radius / PULSE_MAX_RADIUS
        if (progress >= 1) {
          group.remove(pulse.mesh)
          pulse.mesh.geometry.dispose()
          pulse.material.dispose()
          return false
        }

        // Update ring geometry
        const inner = pulse.radius
        const outer = pulse.radius + 0.5 + pulse.radius * 0.04
        pulse.mesh.geometry.dispose()
        pulse.mesh.geometry = new THREE.RingGeometry(inner, outer, 48)
        pulse.material.opacity = 0.85 * Math.pow(1 - progress, 1.4)

        // Check if pulse reaches any affected node
        for (const nid of pulse.affectedNodeIds) {
          const npos = posMap.get(nid)
          if (!npos) continue
          const dx   = npos.x - pulse.originX
          const dz   = npos.z - pulse.originZ
          const dist = Math.sqrt(dx * dx + dz * dz)
          // Pulse ring just passed through this node
          if (Math.abs(dist - pulse.radius) < PULSE_SPEED * delta * 2) {
            const hMesh = makeHighlightRing(npos, EVENT_COLORS[pulse.eventType].clone())
            group.add(hMesh)
            newHighlights.push({
              nodeId: nid,
              mesh:   hMesh,
              expiresAt: now + 1200,
            })
          }
        }

        return true
      })

      // Add new highlights
      highlightsRef.current.push(...newHighlights)

      // ── Animate node highlights ──────────────────────────────────────

      highlightsRef.current = highlightsRef.current.filter(h => {
        if (now > h.expiresAt) {
          group.remove(h.mesh)
          h.mesh.geometry.dispose()
          ;(h.mesh.material as THREE.Material).dispose()
          return false
        }
        const age    = now - (h.expiresAt - 1200)
        const fadeIn = Math.min(1, age / 200)
        const remain = h.expiresAt - now
        const fadeOut = Math.min(1, remain / 300)
        const mat = h.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = 0.85 * fadeIn * fadeOut
        return true
      })

      // ── Animate connection line opacity (directional wave pulse) ─────

      for (const conn of connectionsRef.current) {
        // Advance the phase to simulate flow from cause → effect
        conn.phaseOffset += delta * 1.8 * conn.strength
        // Sine-wave opacity animation gives a breathing / pulsing flow feel
        const base = conn.strength
        const wave = Math.sin(now * 0.001 + conn.phaseOffset) * 0.15
        conn.lineMaterial.opacity = Math.max(0.12, Math.min(0.9, base + wave))
      }

      // ── Tooltip hover check ──────────────────────────────────────────

      if (visible && connectionsRef.current.length > 0) {
        const mx = mousePosRef.current.x
        const my = mousePosRef.current.y
        let found = false

        for (const conn of connectionsRef.current) {
          const a = worldToScreen(conn.fromPos, camera, renderer)
          const b = worldToScreen(conn.toPos,   camera, renderer)
          if (a.behind || b.behind) continue

          const dist = distPointToSegment2D(mx, my, a.x, a.y, b.x, b.y)
          if (dist < 14) {
            const midX = (a.x + b.x) / 2
            const midY = (a.y + b.y) / 2
            setTooltip({ visible: true, screenX: midX, screenY: midY, connectionId: conn.id })
            found = true
            break
          }
        }

        if (!found) {
          setTooltip(t => (t.visible ? { ...t, visible: false } : t))
        }
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [visible, camera, renderer, autoEmitPulses])

  // ── Mouse tracking ───────────────────────────────────────────────────────

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      mousePosRef.current = { x: e.clientX, y: e.clientY }
    }
    function onMouseClick(e: MouseEvent) {
      if (!visible) return
      const mx = e.clientX
      const my = e.clientY
      for (const conn of connectionsRef.current) {
        const a = worldToScreen(conn.fromPos, camera, renderer)
        const b = worldToScreen(conn.toPos,   camera, renderer)
        if (a.behind || b.behind) continue
        const dist = distPointToSegment2D(mx, my, a.x, a.y, b.x, b.y)
        if (dist < 14) {
          setPanel({ visible: true, connection: conn })
          e.stopPropagation()
          return
        }
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('click',     onMouseClick)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('click',     onMouseClick)
    }
  }, [visible, camera, renderer])

  // ── Public imperative emitter (CustomEvent hook) ─────────────────────────

  useEffect(() => {
    function onNetworkEvent(e: Event) {
      const ev = e as CustomEvent<{
        x: number; z: number
        eventType: EventType
        affectedNodeIds?: string[]
      }>
      if (!ev.detail) return
      emitPulse(
        ev.detail.x,
        ev.detail.z,
        ev.detail.eventType,
        ev.detail.affectedNodeIds ?? [],
      )
    }
    window.addEventListener('nw:network-event', onNetworkEvent)
    return () => window.removeEventListener('nw:network-event', onNetworkEvent)
  }, [emitPulse])

  // ── Tooltip lookup ───────────────────────────────────────────────────────

  const hoveredConnection = connectionsRef.current.find(c => c.id === tooltip.connectionId)
  const typeLabels: Record<ConnectionType, string> = {
    project_crew_project:  'CREW FLOW',
    invoice_cash_material: 'CASH → MATERIALS',
    lead_resource_tension: 'RESOURCE TENSION',
    phase_downstream:      'PHASE UNBLOCK',
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Hover tooltip ─────────────────────────────────────────────── */}
      {visible && tooltip.visible && hoveredConnection && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.screenX + 12,
            top:  tooltip.screenY - 28,
            pointerEvents: 'none',
            zIndex: 58,
            maxWidth: 220,
            padding: '7px 11px',
            background: 'rgba(4,8,14,0.93)',
            border: `1px solid ${'#' + hoveredConnection.causeColor.getHexString()}55`,
            borderRadius: 6,
            backdropFilter: 'blur(10px)',
            boxShadow: '0 4px 18px rgba(0,0,0,0.7)',
            fontFamily: 'monospace',
          }}
        >
          <div style={{
            color: '#' + hoveredConnection.causeColor.getHexString(),
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 1.5,
            marginBottom: 3,
          }}>
            {typeLabels[hoveredConnection.type]}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10, lineHeight: 1.5 }}>
            <span style={{ color: '#' + hoveredConnection.causeColor.getHexString() }}>
              {hoveredConnection.fromLabel}
            </span>
            {' → '}
            <span style={{ color: '#' + hoveredConnection.effectColor.getHexString() }}>
              {hoveredConnection.toLabel}
            </span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, marginTop: 3 }}>
            Click for full effect chain
          </div>
        </div>
      )}

      {/* ── Effect chain panel ────────────────────────────────────────── */}
      {visible && panel.visible && panel.connection && (
        <ChainPanel
          connection={panel.connection}
          onClose={() => setPanel({ visible: false, connection: null })}
        />
      )}

      {/* ── HUD status badge (when active) ────────────────────────────── */}
      {visible && (
        <div
          style={{
            position: 'absolute',
            bottom: 110,
            left: 14,
            pointerEvents: 'none',
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 9px',
            borderRadius: 4,
            background: 'rgba(0,229,204,0.08)',
            border: '1px solid rgba(0,229,204,0.25)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#00e5cc',
            boxShadow: '0 0 6px #00e5cc',
            animation: 'nw-ne-pulse 2s ease-in-out infinite',
          }} />
          <style>{`
            @keyframes nw-ne-pulse {
              0%, 100% { opacity: 1; }
              50%       { opacity: 0.4; }
            }
          `}</style>
          <span style={{
            color: '#00e5cc',
            fontSize: 9,
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: 1.4,
          }}>
            NETWORK EFFECTS
          </span>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, fontFamily: 'monospace' }}>
            {connectionsRef.current.length} connections · {pulsesRef.current.length} pulses
          </span>
        </div>
      )}
    </>
  )
}
