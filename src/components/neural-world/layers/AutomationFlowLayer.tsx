/**
 * AutomationFlowLayer.tsx — NW36: n8n-style automation flow visualization.
 *
 * Ground-level glowing paths (y=0.5) showing trigger→condition→action→result
 * chains running beneath agent flights (y=25).
 *
 * NODE TYPES:
 *   TRIGGER    : OctahedronGeometry — source-colored (cyan/purple/gold/green/white)
 *   CONDITION  : Rotated BoxGeometry 45° — amber #FF9040
 *   ACTION     : BoxGeometry — domain-color-matched
 *   TRANSFORM  : SphereGeometry r=0.3 — teal #40D4FF
 *   WAIT       : TorusGeometry — dim white, rotates while data paused
 *   RESULT     : ConeGeometry pointing up — green #2EE89A (success) / red #FF5060 (fail)
 *
 * PATH SEGMENTS: TubeGeometry(r=0.15) with animated data particle sphere(r=0.2)
 *   traveling at ~3 u/s when flow active. Each flow at slightly different y.
 *
 * 5 PREDEFINED FLOWS:
 *   1. Lead Intake
 *   2. Invoice Follow-Up
 *   3. Daily Briefing
 *   4. Receipt Processing
 *   5. Review Monitoring
 *
 * FAILURE VISUALIZATION:
 *   Failed segment turns red + red radial pulse + floating error label (5s).
 *   Agent SCOUT event dispatched (nw:automation-failure).
 *
 * INTERACTION:
 *   nw:automation-fire  → triggers a flow (payload: { flowId })
 *   nw:automation-fail  → triggers failure viz (payload: { flowId, nodeIndex, message })
 *   nw:automation-flow-states → set which flows are enabled (payload: Record<string,boolean>)
 *
 * VERTICAL BEAMS: nw:automation-to-agent and nw:agent-to-automation events create
 *   brief vertical beam at given worldX,worldZ connecting ground path to y=25.
 */

import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { makeLabel, disposeLabel, type NWLabel } from '../utils/makeLabel'

// ── Constants ──────────────────────────────────────────────────────────────────

const GROUND_Y      = 0.5   // base y for automation nodes
const PATH_Y_OFFSETS = [0.3, 0.5, 0.7, 0.4, 0.6]  // per-flow y variation
const PARTICLE_SPEED = 3.0   // units per second along path
const TUBE_RADIUS_BASE = 0.15
const PARTICLE_RADIUS  = 0.2

// Colors
const C_TRIGGER_EMAIL   = 0x40D4FF
const C_TRIGGER_WEBHOOK = 0xAA6EFF
const C_TRIGGER_TIMER   = 0xFFD24A
const C_TRIGGER_FORM    = 0x2EE89A
const C_TRIGGER_MANUAL  = 0xFFFFFF
const C_CONDITION       = 0xFF9040
const C_TRANSFORM       = 0x40D4FF
const C_WAIT            = 0xCCCCCC
const C_RESULT_OK       = 0x2EE89A
const C_RESULT_FAIL     = 0xFF5060
const C_PATH_DEFAULT    = 0x40D4FF
const C_PATH_ACTIVE     = 0x40FFDD
const C_PATH_FAIL       = 0xFF3030
const C_PATH_WARN       = 0xFF9940  // amber warning glow

// Action colors by target
const ACTION_COLORS: Record<string, number> = {
  'create-lead':        0xFFE040,  // SPARK yellow
  'send-email':         0x40D4FF,  // cyan
  'update-project':     0x3A8EFF,  // BLUEPRINT blue
  'generate-invoice':   0x2EE89A,  // LEDGER green
  'schedule-task':      0xAA6EFF,  // CHRONO purple
  'compliance-check':   0xFF9040,  // OHM orange
  'log-data':           0x2040AA,  // ECHO dark blue
  'archive':            0x666688,
  'notify-nexus':       0x00E5CC,
  'escalate':           0xFF3030,
  'auto-reply':         0x40D4FF,
  'schedule-followup':  0xAA6EFF,
  'extract-data':       0x40D4FF,
  'match-project':      0x3A8EFF,
  'update-mto':         0xAA8820,
  'check-reviews':      0xFFE040,
  'alert-spark':        0xFFE040,
  'log-review':         0x2040AA,
  'pull-hub-data':      0x00E5CC,
  'compose-summary':    0x40D4FF,
  'send-text':          0x2EE89A,
  'draft-email':        0x2EE89A,
  'alert-nexus':        0x00E5CC,
  'default':            0x40D4FF,
}

// ── Types ──────────────────────────────────────────────────────────────────────

type TriggerSource = 'email' | 'webhook' | 'timer' | 'form' | 'manual'
type NodeType = 'trigger' | 'condition' | 'action' | 'transform' | 'wait' | 'result'
type ResultStatus = 'success' | 'fail' | 'filtered'

interface FlowNode {
  type:        NodeType
  label:       string
  worldX:      number
  worldZ:      number
  triggerSrc?: TriggerSource
  actionKey?:  string
  resultOk?:   boolean
  // runtime — set on build
  mesh?:       THREE.Mesh
  sprite?:     NWLabel
}

interface FlowBranch {
  fromIndex: number     // index of condition node
  toIndex:   number[]   // index(es) of next nodes (2-3)
  taken?:    number     // which branch was taken last
}

interface AutomationFlow {
  id:       string
  name:     string
  nodes:    FlowNode[]
  branches: FlowBranch[]   // condition split points
  yOffset:  number         // per-flow path height
  color:    number         // path tube color
  // state
  enabled:      boolean
  firedToday:   number
  successCount: number
  failureCount: number
  lastFired:    number | null   // timestamp ms
  lastFiredOffset: number       // hours ago (used for dim check)
  // runtime Three.js objects
  tubeMeshes?:  THREE.Mesh[]
  particles?:   FlowParticle[]
  warnGlow?:    THREE.Mesh[]     // amber warning meshes on path
}

interface FlowParticle {
  mesh:       THREE.Mesh
  flowId:     string
  pathPoints: THREE.Vector3[]
  segIndex:   number   // current segment index (0..points.length-2)
  t:          number   // 0-1 progress along current segment
  active:     boolean
}

interface FailureEffect {
  flowId:      string
  nodeIndex:   number
  message:     string
  expiresAt:   number
  pulseRings:  THREE.Mesh[]
  label?:      NWLabel
}

interface VerticalBeam {
  mesh:      THREE.Mesh
  expiresAt: number
}

// ── Predefined Flow Definitions ────────────────────────────────────────────────

/**
 * Build the 5 predefined automation flows.
 * Coordinates are in Neural World space (matching AgentFlightLayer domain positions).
 */
function buildPredefinedFlows(): AutomationFlow[] {
  return [
    // ── 1. Lead Intake ────────────────────────────────────────────────────
    {
      id: 'lead-intake',
      name: 'Lead Intake',
      yOffset: PATH_Y_OFFSETS[0],
      color: C_TRIGGER_EMAIL,
      enabled: true,
      firedToday: 0, successCount: 0, failureCount: 0,
      lastFired: null, lastFiredOffset: 0,
      branches: [
        { fromIndex: 1, toIndex: [2, 6] },   // condition → YES chain or NO chain
      ],
      nodes: [
        // Trigger at west map edge
        { type: 'trigger', label: 'Email / Form Received',  worldX: -220, worldZ: -80, triggerSrc: 'email' },
        // Condition
        { type: 'condition', label: 'Quote Request?',        worldX: -200, worldZ: -80 },
        // YES path (index 2-5)
        { type: 'action', label: 'Create Lead (SPARK)',      worldX: -185, worldZ: -100, actionKey: 'create-lead' },
        { type: 'action', label: 'Send Auto-Reply',          worldX: -175, worldZ: -115, actionKey: 'send-email' },
        { type: 'action', label: 'Schedule Follow-Up',       worldX: -185, worldZ: -125, actionKey: 'schedule-followup' },
        { type: 'action', label: 'Notify NEXUS',             worldX: -175, worldZ: -135, actionKey: 'notify-nexus' },
        // NO path (index 6-7)
        { type: 'action', label: 'Archive',                  worldX: -195, worldZ: -60,  actionKey: 'archive' },
        // Results
        { type: 'result', label: 'Lead Created',             worldX: -170, worldZ: -145, resultOk: true },
        { type: 'result', label: 'Filtered',                 worldX: -190, worldZ: -50,  resultOk: true },
      ],
    },

    // ── 2. Invoice Follow-Up ──────────────────────────────────────────────
    {
      id: 'invoice-followup',
      name: 'Invoice Follow-Up',
      yOffset: PATH_Y_OFFSETS[1],
      color: C_TRIGGER_TIMER,
      enabled: true,
      firedToday: 0, successCount: 0, failureCount: 0,
      lastFired: null, lastFiredOffset: 0,
      branches: [
        { fromIndex: 1, toIndex: [2, 6] },
        { fromIndex: 3, toIndex: [4, 5] },
      ],
      nodes: [
        { type: 'trigger',   label: 'Daily 9am',              worldX: -40,  worldZ: 10,  triggerSrc: 'timer' },
        { type: 'condition', label: 'Invoice >14 Days?',       worldX: -45,  worldZ: 25  },
        // YES path
        { type: 'action',    label: 'Draft Follow-Up Email',   worldX: -50,  worldZ: 35,  actionKey: 'draft-email' },
        { type: 'condition', label: 'Invoice >30 Days?',       worldX: -55,  worldZ: 48  },
        { type: 'action',    label: 'Escalate to NEXUS',       worldX: -60,  worldZ: 58,  actionKey: 'escalate' },
        { type: 'result',    label: 'Follow-Up Sent',          worldX: -65,  worldZ: 68,  resultOk: true },
        // NO path
        { type: 'result',    label: 'No Action',               worldX: -38,  worldZ: 38,  resultOk: true },
      ],
    },

    // ── 3. Daily Briefing ─────────────────────────────────────────────────
    {
      id: 'daily-briefing',
      name: 'Daily Briefing',
      yOffset: PATH_Y_OFFSETS[2],
      color: C_TRIGGER_TIMER,
      enabled: true,
      firedToday: 0, successCount: 0, failureCount: 0,
      lastFired: null, lastFiredOffset: 0,
      branches: [],
      nodes: [
        // Starts at Fortress (east boundary ~x=25, z=0)
        { type: 'trigger', label: 'Daily 7am',              worldX: 25,   worldZ: 0,   triggerSrc: 'timer' },
        { type: 'action',  label: 'Pull Hub Data (PULSE)',  worldX: 10,   worldZ: -20, actionKey: 'pull-hub-data' },
        { type: 'action',  label: 'Pull Field Logs',        worldX: -20,  worldZ: -20, actionKey: 'log-data' },
        { type: 'action',  label: 'Pull AR Status',         worldX: -40,  worldZ: -10, actionKey: 'pull-hub-data' },
        { type: 'action',  label: 'Compose Summary',        worldX: -30,  worldZ: 10,  actionKey: 'compose-summary' },
        { type: 'action',  label: 'Send Text Message',      worldX: -10,  worldZ: 20,  actionKey: 'send-text' },
        { type: 'result',  label: 'Briefing Sent',          worldX: 5,    worldZ: 20,  resultOk: true },
      ],
    },

    // ── 4. Receipt Processing ─────────────────────────────────────────────
    {
      id: 'receipt-processing',
      name: 'Receipt Processing',
      yOffset: PATH_Y_OFFSETS[3],
      color: C_TRIGGER_EMAIL,
      enabled: true,
      firedToday: 0, successCount: 0, failureCount: 0,
      lastFired: null, lastFiredOffset: 0,
      branches: [
        { fromIndex: 4, toIndex: [5, 6] },
      ],
      nodes: [
        { type: 'trigger',   label: 'Receipt Email',            worldX: -220, worldZ: 50, triggerSrc: 'email' },
        { type: 'action',    label: 'Extract Vendor/Amount',    worldX: -200, worldZ: 55, actionKey: 'extract-data' },
        { type: 'action',    label: 'Match Project (VAULT)',    worldX: -180, worldZ: 65, actionKey: 'match-project' },
        { type: 'action',    label: 'Update MTO Cost',          worldX: -165, worldZ: 75, actionKey: 'update-mto' },
        { type: 'condition', label: 'Over Budget?',             worldX: -150, worldZ: 80  },
        // YES → alert
        { type: 'action',    label: 'Alert NEXUS',              worldX: -140, worldZ: 90, actionKey: 'alert-nexus' },
        { type: 'result',    label: 'Receipt Processed',        worldX: -125, worldZ: 95, resultOk: true },
        // NO
        { type: 'result',    label: 'Receipt Processed',        worldX: -148, worldZ: 68, resultOk: true },
      ],
    },

    // ── 5. Review Monitoring ──────────────────────────────────────────────
    {
      id: 'review-monitoring',
      name: 'Review Monitoring',
      yOffset: PATH_Y_OFFSETS[4],
      color: C_TRIGGER_TIMER,
      enabled: true,
      firedToday: 0, successCount: 0, failureCount: 0,
      lastFired: null, lastFiredOffset: 0,
      branches: [
        { fromIndex: 1, toIndex: [2, 7] },
        { fromIndex: 2, toIndex: [3, 6] },
      ],
      nodes: [
        // East continent edge
        { type: 'trigger',   label: 'Every 6 Hours',        worldX: 220,  worldZ: -50, triggerSrc: 'timer' },
        { type: 'action',    label: 'Check Google Reviews', worldX: 190,  worldZ: -40, actionKey: 'check-reviews' },
        { type: 'condition', label: 'New Review?',           worldX: 165,  worldZ: -30 },
        // YES new review → check negative
        { type: 'condition', label: 'Negative Review?',      worldX: 145,  worldZ: -20 },
        // YES negative
        { type: 'action',    label: 'Alert SPARK + NEXUS',  worldX: 125,  worldZ: -10, actionKey: 'alert-spark' },
        { type: 'result',    label: 'Alert Sent',            worldX: 110,  worldZ: -5,  resultOk: true },
        // NO → positive
        { type: 'action',    label: 'Log Positive Review',  worldX: 140,  worldZ: -45, actionKey: 'log-review' },
        // NO new review
        { type: 'result',    label: 'No New Reviews',        worldX: 160,  worldZ: -55, resultOk: true },
        { type: 'result',    label: 'Positive Logged',       worldX: 130,  worldZ: -55, resultOk: true },
      ],
    },
  ]
}

// ── Geometry/Material helpers ──────────────────────────────────────────────────

function buildNodeMesh(node: FlowNode, yOffset: number): THREE.Mesh {
  let geo: THREE.BufferGeometry
  let color: number

  switch (node.type) {
    case 'trigger': {
      geo = new THREE.OctahedronGeometry(0.5, 0)
      const src = node.triggerSrc ?? 'manual'
      color = src === 'email'   ? C_TRIGGER_EMAIL
            : src === 'webhook' ? C_TRIGGER_WEBHOOK
            : src === 'timer'   ? C_TRIGGER_TIMER
            : src === 'form'    ? C_TRIGGER_FORM
            : C_TRIGGER_MANUAL
      break
    }
    case 'condition': {
      geo = new THREE.BoxGeometry(0.7, 0.7, 0.7)
      color = C_CONDITION
      break
    }
    case 'action': {
      geo = new THREE.BoxGeometry(0.6, 0.6, 0.6)
      color = ACTION_COLORS[node.actionKey ?? 'default'] ?? ACTION_COLORS['default']
      break
    }
    case 'transform': {
      geo = new THREE.SphereGeometry(0.3, 8, 6)
      color = C_TRANSFORM
      break
    }
    case 'wait': {
      geo = new THREE.TorusGeometry(0.4, 0.12, 8, 16)
      color = C_WAIT
      break
    }
    case 'result':
    default: {
      geo = new THREE.ConeGeometry(0.4, 0.8, 8)
      color = node.resultOk !== false ? C_RESULT_OK : C_RESULT_FAIL
      break
    }
  }

  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.55,
    metalness: 0.3,
    roughness: 0.5,
    transparent: true,
    opacity: 0.9,
  })

  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(node.worldX, yOffset, node.worldZ)

  // Condition nodes rotated 45 degrees (diamond shape)
  if (node.type === 'condition') {
    mesh.rotation.z = Math.PI / 4
    mesh.rotation.y = Math.PI / 4
  }

  return mesh
}

/** Build TubeGeometry path between two world points at the given y. */
function buildTubeMesh(
  from: THREE.Vector3,
  to: THREE.Vector3,
  color: number,
  opacity: number,
  tubeRadius = TUBE_RADIUS_BASE
): THREE.Mesh {
  const mid = new THREE.Vector3(
    (from.x + to.x) / 2,
    (from.y + to.y) / 2 + 0.05,
    (from.z + to.z) / 2
  )
  const curve = new THREE.CatmullRomCurve3([from.clone(), mid, to.clone()])
  const geo = new THREE.TubeGeometry(curve, 12, tubeRadius, 6, false)
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity,
  })
  return new THREE.Mesh(geo, mat)
}

/** Straight-line path from ground to agent altitude (y=25). */
function buildVerticalBeamMesh(x: number, z: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.12, 0.12, 25, 6)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x00E5CC,
    emissive: 0x00E5CC,
    emissiveIntensity: 1.5,
    transparent: true,
    opacity: 0.7,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, 12.5, z)   // center of 0→25 span
  return mesh
}

/** Build a data particle sphere for a flow. */
function buildParticleMesh(color: number, size: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(size, 8, 6)
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 2.0,
    transparent: true,
    opacity: 0.95,
  })
  return new THREE.Mesh(geo, mat)
}

/** Build a red pulse ring for failure visualization. */
function buildPulseRing(x: number, z: number, y: number, radius: number, opacity: number): THREE.Mesh {
  const geo = new THREE.TorusGeometry(radius, 0.1, 6, 24)
  const mat = new THREE.MeshBasicMaterial({
    color: 0xFF3030,
    transparent: true,
    opacity,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = Math.PI / 2
  mesh.position.set(x, y + 0.15, z)
  return mesh
}

// ── Component ──────────────────────────────────────────────────────────────────

interface AutomationFlowLayerProps {
  visible: boolean
}

export function AutomationFlowLayer({ visible }: AutomationFlowLayerProps) {
  const { scene, camera } = useWorldContext()

  const flowsRef     = useRef<AutomationFlow[]>(buildPredefinedFlows())
  const particlesRef = useRef<FlowParticle[]>([])
  const failuresRef  = useRef<FailureEffect[]>([])
  const beamsRef     = useRef<VerticalBeam[]>([])
  const rafRef       = useRef<number>(0)
  const lastTimeRef  = useRef<number>(performance.now())

  // ── Build Three.js objects for all flows ────────────────────────────────

  const buildFlowObjects = useCallback(() => {
    const flows = flowsRef.current

    for (const flow of flows) {
      if (flow.tubeMeshes) continue  // already built

      const y = GROUND_Y + flow.yOffset
      flow.tubeMeshes = []
      flow.warnGlow = []

      // ── Node meshes ────────────────────────────────────────────────────
      for (const node of flow.nodes) {
        const mesh = buildNodeMesh(node, y)
        mesh.userData = { flowId: flow.id, nodeLabel: node.label, nodeType: node.type }
        scene.add(mesh)
        node.mesh = mesh

        // Label
        const sprite = makeLabel(node.label, '#40D4FF', { fontSize: 12, yOffset: 0.9 })
        sprite.position.set(node.worldX, y + 0.9, node.worldZ)
        scene.add(sprite)
        node.sprite = sprite
      }

      // ── Path tubes between sequential nodes ───────────────────────────
      // Build connections: default is sequential (i → i+1), branches handled separately
      const connected = new Set<string>()

      const addTube = (fromIdx: number, toIdx: number) => {
        const key = `${fromIdx}-${toIdx}`
        if (connected.has(key)) return
        connected.add(key)
        const fn = flow.nodes[fromIdx]
        const tn = flow.nodes[toIdx]
        if (!fn || !tn) return
        const from = new THREE.Vector3(fn.worldX, y, fn.worldZ)
        const to   = new THREE.Vector3(tn.worldX, y, tn.worldZ)
        const tube = buildTubeMesh(from, to, flow.color, 0.35)
        tube.userData = { flowId: flow.id, segFrom: fromIdx, segTo: toIdx }
        scene.add(tube)
        flow.tubeMeshes!.push(tube)
      }

      // Gather branch indices so we know which nodes are branch targets
      const branchTargets = new Map<number, number[]>() // fromIdx → [toIdx...]
      for (const br of flow.branches) {
        branchTargets.set(br.fromIndex, br.toIndex)
      }
      const allBranchToIndices = new Set(flow.branches.flatMap(b => b.toIndex))

      // Sequential connections
      for (let i = 0; i < flow.nodes.length - 1; i++) {
        const bt = branchTargets.get(i)
        if (bt) {
          // Condition node: connect to all branch targets
          for (const ti of bt) addTube(i, ti)
        } else if (!allBranchToIndices.has(i + 1) || allBranchToIndices.has(i)) {
          // Normal sequential connection unless i+1 is a branch-start (would dangle)
          addTube(i, i + 1)
        }
      }
      // Also connect branch sub-chains sequentially
      for (const toIdx of allBranchToIndices) {
        for (let i = toIdx; i < flow.nodes.length - 1; i++) {
          const bt2 = branchTargets.get(i)
          if (bt2) {
            for (const ti of bt2) addTube(i, ti)
            break
          }
          addTube(i, i + 1)
          // Stop if next node is also a branch target from a different condition
          if (allBranchToIndices.has(i + 1) && !branchTargets.has(i)) break
        }
      }
    }
  }, [scene])

  // ── Remove Three.js objects for all flows ───────────────────────────────

  const disposeFlowObjects = useCallback(() => {
    for (const flow of flowsRef.current) {
      for (const node of flow.nodes) {
        if (node.mesh) {
          scene.remove(node.mesh)
          node.mesh.geometry.dispose()
          ;(node.mesh.material as THREE.Material).dispose()
          node.mesh = undefined
        }
        if (node.sprite) {
          scene.remove(node.sprite)
          disposeLabel(node.sprite)
          node.sprite = undefined
        }
      }
      if (flow.tubeMeshes) {
        for (const t of flow.tubeMeshes) {
          scene.remove(t)
          t.geometry.dispose()
          ;(t.material as THREE.Material).dispose()
        }
        flow.tubeMeshes = undefined
      }
      if (flow.warnGlow) {
        for (const w of flow.warnGlow) {
          scene.remove(w)
          w.geometry.dispose()
          ;(w.material as THREE.Material).dispose()
        }
        flow.warnGlow = undefined
      }
    }
    // particles
    for (const p of particlesRef.current) {
      scene.remove(p.mesh)
      p.mesh.geometry.dispose()
      ;(p.mesh.material as THREE.Material).dispose()
    }
    particlesRef.current = []
    // failures
    for (const f of failuresRef.current) {
      for (const r of f.pulseRings) {
        scene.remove(r)
        r.geometry.dispose()
        ;(r.material as THREE.Material).dispose()
      }
      if (f.label) { scene.remove(f.label); disposeLabel(f.label) }
    }
    failuresRef.current = []
    // beams
    for (const b of beamsRef.current) {
      scene.remove(b.mesh)
      b.mesh.geometry.dispose()
      ;(b.mesh.material as THREE.Material).dispose()
    }
    beamsRef.current = []
  }, [scene])

  // ── Trigger a flow firing ────────────────────────────────────────────────

  const fireFlow = useCallback((flowId: string) => {
    const flow = flowsRef.current.find(f => f.id === flowId)
    if (!flow || !flow.enabled) return

    flow.firedToday++
    flow.lastFired = Date.now()

    const firstNode = flow.nodes[0]
    if (!firstNode) return

    // Pulse trigger node (scale 1.0→1.5→1.0 over 0.6s)
    const triggerMesh = firstNode.mesh
    if (triggerMesh) {
      triggerMesh.scale.setScalar(1.5)
      setTimeout(() => { triggerMesh.scale.setScalar(1.0) }, 300)
    }

    // Build path points for particle
    const y = GROUND_Y + flow.yOffset
    const pathPoints: THREE.Vector3[] = flow.nodes.map(
      n => new THREE.Vector3(n.worldX, y, n.worldZ)
    )

    if (pathPoints.length < 2) return

    const particleSizes = [0.15, 0.2, 0.25]
    const sizeIdx = flowsRef.current.indexOf(flow) % particleSizes.length
    const particleMesh = buildParticleMesh(flow.color, particleSizes[sizeIdx])
    particleMesh.position.copy(pathPoints[0])
    scene.add(particleMesh)

    const particle: FlowParticle = {
      mesh: particleMesh,
      flowId,
      pathPoints,
      segIndex: 0,
      t: 0,
      active: true,
    }
    particlesRef.current.push(particle)

    // Brighten tubes temporarily
    if (flow.tubeMeshes) {
      for (const t of flow.tubeMeshes) {
        ;(t.material as THREE.MeshStandardMaterial).opacity = 0.85
        ;(t.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2
      }
      setTimeout(() => {
        if (flow.tubeMeshes) {
          for (const t of flow.tubeMeshes) {
            ;(t.material as THREE.MeshStandardMaterial).opacity = 0.35
            ;(t.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5
          }
        }
      }, 4000)
    }
  }, [scene])

  // ── Trigger a failure ────────────────────────────────────────────────────

  const triggerFailure = useCallback((flowId: string, nodeIndex: number, message: string) => {
    const flow = flowsRef.current.find(f => f.id === flowId)
    if (!flow) return

    flow.failureCount++
    const node = flow.nodes[nodeIndex]
    if (!node) return

    const y = GROUND_Y + flow.yOffset
    const x = node.worldX
    const z = node.worldZ

    // Turn affected tube segment red
    if (flow.tubeMeshes) {
      const relevantTube = flow.tubeMeshes.find(
        t => t.userData.segTo === nodeIndex || t.userData.segFrom === nodeIndex
      )
      if (relevantTube) {
        ;(relevantTube.material as THREE.MeshStandardMaterial).color.setHex(C_PATH_FAIL)
        ;(relevantTube.material as THREE.MeshStandardMaterial).emissive.setHex(C_PATH_FAIL)
        ;(relevantTube.material as THREE.MeshStandardMaterial).opacity = 0.9
        setTimeout(() => {
          if (relevantTube) {
            ;(relevantTube.material as THREE.MeshStandardMaterial).color.setHex(flow.color)
            ;(relevantTube.material as THREE.MeshStandardMaterial).emissive.setHex(flow.color)
            ;(relevantTube.material as THREE.MeshStandardMaterial).opacity = 0.35
          }
        }, 6000)
      }
    }

    // Build 3 expanding pulse rings
    const rings: THREE.Mesh[] = []
    for (let i = 0; i < 3; i++) {
      const ring = buildPulseRing(x, z, y, 1.0 + i * 1.5, 0.7 - i * 0.2)
      scene.add(ring)
      rings.push(ring)
    }

    // Error label
    const label = makeLabel(
      `⚠ ${flow.name.toUpperCase()} FAILED: ${message}`,
      '#FF5060',
      { fontSize: 13, yOffset: 2.0 }
    )
    label.position.set(x, y + 2.5, z)
    scene.add(label)

    failuresRef.current.push({
      flowId,
      nodeIndex,
      message,
      expiresAt: Date.now() + 5000,
      pulseRings: rings,
      label,
    })

    // Notify SCOUT agent
    window.dispatchEvent(new CustomEvent('nw:automation-failure', {
      detail: { flowId, nodeIndex, message, worldX: x, worldZ: z }
    }))

    // Persistent amber warning glow on path if failureRate > 10%
    const total = flow.successCount + flow.failureCount
    if (total > 0 && flow.failureCount / total > 0.1) {
      // Add amber glow overlay on tube meshes
      if (flow.warnGlow && flow.tubeMeshes) {
        // clear old warn glow
        for (const w of flow.warnGlow) {
          scene.remove(w)
          w.geometry.dispose()
          ;(w.material as THREE.Material).dispose()
        }
        flow.warnGlow = []
        for (const tube of flow.tubeMeshes) {
          const warnMat = new THREE.MeshBasicMaterial({
            color: C_PATH_WARN,
            transparent: true,
            opacity: 0.25,
          })
          const warnMesh = new THREE.Mesh(tube.geometry.clone(), warnMat)
          warnMesh.position.copy(tube.position)
          warnMesh.rotation.copy(tube.rotation)
          scene.add(warnMesh)
          flow.warnGlow!.push(warnMesh)
        }
      }
    }
  }, [scene])

  // ── Vertical beam between automation and agent altitude ─────────────────

  const spawnVerticalBeam = useCallback((x: number, z: number) => {
    const beam = buildVerticalBeamMesh(x, z)
    scene.add(beam)
    beamsRef.current.push({ mesh: beam, expiresAt: Date.now() + 1200 })
  }, [scene])

  // ── Animation loop ───────────────────────────────────────────────────────

  const animate = useCallback(() => {
    rafRef.current = requestAnimationFrame(animate)
    const now = performance.now()
    const dt  = Math.min((now - lastTimeRef.current) / 1000, 0.1)
    lastTimeRef.current = now

    const wp = new THREE.Vector3()

    // ── Particle travel ──────────────────────────────────────────────────
    const aliveParts: FlowParticle[] = []
    for (const p of particlesRef.current) {
      if (!p.active) { scene.remove(p.mesh); continue }

      const from = p.pathPoints[p.segIndex]
      const to   = p.pathPoints[p.segIndex + 1]
      if (!from || !to) { scene.remove(p.mesh); continue }

      const segLen = from.distanceTo(to)
      const dT = segLen > 0 ? (PARTICLE_SPEED * dt) / segLen : 1
      p.t += dT

      if (p.t >= 1) {
        p.t = 0
        p.segIndex++
        if (p.segIndex >= p.pathPoints.length - 1) {
          // Reached result node — success burst and remove
          const endPt = p.pathPoints[p.pathPoints.length - 1]
          p.mesh.position.copy(endPt)
          const flow = flowsRef.current.find(f => f.id === p.flowId)
          if (flow) flow.successCount++
          scene.remove(p.mesh)
          p.mesh.geometry.dispose()
          ;(p.mesh.material as THREE.Material).dispose()
          continue
        }
      }

      p.mesh.position.lerpVectors(from, to, Math.min(p.t, 1))
      p.mesh.rotation.y += dt * 2
      aliveParts.push(p)
    }
    particlesRef.current = aliveParts

    // ── Node animations ──────────────────────────────────────────────────
    const t = now * 0.001
    for (const flow of flowsRef.current) {
      if (!flow.tubeMeshes) continue

      const dimmed = flow.lastFired !== null
        ? (Date.now() - flow.lastFired) > 24 * 3600 * 1000
        : false

      for (const node of flow.nodes) {
        if (!node.mesh) continue
        const mat = node.mesh.material as THREE.MeshStandardMaterial

        if (!flow.enabled || dimmed) {
          mat.opacity = 0.1
          mat.emissiveIntensity = 0.1
          continue
        }

        // Gentle bob for all nodes
        node.mesh.position.y = (GROUND_Y + flow.yOffset) + Math.sin(t * 1.5 + node.worldX * 0.05) * 0.08

        // Wait node slow spin
        if (node.type === 'wait') {
          node.mesh.rotation.z = t * 0.8
        }

        // Condition node slow rotation
        if (node.type === 'condition') {
          node.mesh.rotation.y = t * 0.5
        }

        // Update label visibility
        if (node.sprite) {
          node.sprite.getWorldPosition(wp)
          node.sprite.updateVisibility(camera, wp)
        }

        mat.opacity = 0.9
        mat.emissiveIntensity = 0.55 + Math.sin(t * 2 + node.worldX * 0.1) * 0.15
      }

      // Tube opacity fade for dimmed/disabled flows
      if (!flow.enabled || dimmed) {
        for (const tube of flow.tubeMeshes) {
          ;(tube.material as THREE.MeshStandardMaterial).opacity = 0.08
        }
      }
    }

    // ── Failure pulse rings expand ───────────────────────────────────────
    const aliveFailures: FailureEffect[] = []
    for (const failure of failuresRef.current) {
      if (Date.now() > failure.expiresAt) {
        for (const r of failure.pulseRings) {
          scene.remove(r)
          r.geometry.dispose()
          ;(r.material as THREE.Material).dispose()
        }
        if (failure.label) { scene.remove(failure.label); disposeLabel(failure.label) }
        continue
      }
      const progress = 1 - (failure.expiresAt - Date.now()) / 5000
      for (let i = 0; i < failure.pulseRings.length; i++) {
        const ring = failure.pulseRings[i]
        const scale = 1 + progress * (2 + i * 1.5)
        ring.scale.setScalar(scale)
        ;(ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.7 - progress * 0.9 - i * 0.15)
      }
      aliveFailures.push(failure)
    }
    failuresRef.current = aliveFailures

    // ── Vertical beams fade ──────────────────────────────────────────────
    const aliveBeams: VerticalBeam[] = []
    for (const b of beamsRef.current) {
      if (Date.now() > b.expiresAt) {
        scene.remove(b.mesh)
        b.mesh.geometry.dispose()
        ;(b.mesh.material as THREE.Material).dispose()
        continue
      }
      const progress = (b.expiresAt - Date.now()) / 1200
      ;(b.mesh.material as THREE.MeshStandardMaterial).opacity = progress * 0.7
      aliveBeams.push(b)
    }
    beamsRef.current = aliveBeams
  }, [scene, camera])

  // ── Event listeners ──────────────────────────────────────────────────────

  useEffect(() => {
    const onFire = (e: Event) => {
      const { flowId } = (e as CustomEvent).detail ?? {}
      if (flowId) fireFlow(flowId)
    }
    const onFail = (e: Event) => {
      const { flowId, nodeIndex, message } = (e as CustomEvent).detail ?? {}
      if (flowId != null && nodeIndex != null) triggerFailure(flowId, nodeIndex, message ?? 'Unknown error')
    }
    const onStates = (e: Event) => {
      const states = (e as CustomEvent).detail as Record<string, boolean>
      for (const flow of flowsRef.current) {
        if (flow.id in states) flow.enabled = states[flow.id]
      }
    }
    const onToAgent = (e: Event) => {
      const { worldX, worldZ } = (e as CustomEvent).detail ?? {}
      if (worldX != null) spawnVerticalBeam(worldX, worldZ ?? 0)
    }
    const onFromAgent = (e: Event) => {
      const { worldX, worldZ } = (e as CustomEvent).detail ?? {}
      if (worldX != null) spawnVerticalBeam(worldX, worldZ ?? 0)
    }

    window.addEventListener('nw:automation-fire', onFire)
    window.addEventListener('nw:automation-fail', onFail)
    window.addEventListener('nw:automation-flow-states', onStates)
    window.addEventListener('nw:automation-to-agent', onToAgent)
    window.addEventListener('nw:agent-to-automation', onFromAgent)

    return () => {
      window.removeEventListener('nw:automation-fire', onFire)
      window.removeEventListener('nw:automation-fail', onFail)
      window.removeEventListener('nw:automation-flow-states', onStates)
      window.removeEventListener('nw:automation-to-agent', onToAgent)
      window.removeEventListener('nw:agent-to-automation', onFromAgent)
    }
  }, [fireFlow, triggerFailure, spawnVerticalBeam])

  // ── Mount / Unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!visible) return

    buildFlowObjects()
    rafRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(rafRef.current)
      disposeFlowObjects()
    }
  }, [visible, buildFlowObjects, disposeFlowObjects, animate])

  // ── Expose flow data for builder panel ──────────────────────────────────

  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__nwFlows = flowsRef
  }, [])

  return null
}

// ── Exports for AutomationFlowBuilder ─────────────────────────────────────────

export type { AutomationFlow, FlowNode }
