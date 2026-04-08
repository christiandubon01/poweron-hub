/**
 * AgentLayer.tsx — NW4: All 11 PowerOn Hub agents as distinct 3D entities.
 *
 * Each agent has unique geometry, color, and behavioral signature.
 * Agents move between active project mountain nodes at speeds proportional to load.
 * Idle agents drift slowly. Active agents move with purpose.
 * When two agents pass near each other a brief colored beam connects them.
 * Agent load pulled from agentEventBus event counts; falls back to realistic randoms.
 * Toggle visibility via HUD prop.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWProject,
  type NWWorldData,
} from '../DataBridge'
import { getRecentEvents } from '@/services/agentEventBus'

// ── Constants ─────────────────────────────────────────────────────────────────

const AGENT_Y         = 3.0      // hover height above ground
const BEAM_DIST       = 5.5      // units — agents within this range get a beam
const BEAM_DURATION   = 1.4      // seconds a beam lives
const TRAIL_LENGTH    = 40       // position history for wake trails
const PULSE_INTERVAL  = 1.8      // seconds between SPARK pulse ring emissions
const ORBIT_RADIUS    = 0.7      // CHRONO / ECHO orbital ring radius
const IDLE_DRIFT_SPEED = 0.08
const MIN_NODES       = 3        // minimum mountain nodes to create if no projects

// ── Seeded RNG (deterministic from string) ────────────────────────────────────

function seededRand(seed: string, index: number): number {
  let h = 0xdeadbeef ^ index
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 2654435761)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  return (h >>> 0) / 0xffffffff
}

// ── Default mountain nodes (fallback when no projects loaded) ─────────────────

const DEFAULT_NODES: THREE.Vector3[] = [
  new THREE.Vector3(0, AGENT_Y, 0),
  new THREE.Vector3(20, AGENT_Y, 15),
  new THREE.Vector3(-25, AGENT_Y, 10),
  new THREE.Vector3(15, AGENT_Y, -20),
  new THREE.Vector3(-10, AGENT_Y, -18),
  new THREE.Vector3(30, AGENT_Y, -5),
  new THREE.Vector3(-30, AGENT_Y, -8),
]

// ── Agent definitions ─────────────────────────────────────────────────────────

interface AgentDef {
  id: string
  name: string
  hex: number
  baseSpeed: number
  geometryType:
    | 'torus'
    | 'sphere_vault'
    | 'octahedron_flat'
    | 'box'
    | 'icosahedron'
    | 'torusknot'
    | 'tetrahedron'
    | 'star'
    | 'cylinder_ring'
    | 'sphere_echo'
    | 'mappin'
  erratic: boolean
}

const AGENT_DEFS: AgentDef[] = [
  { id: 'nexus',     name: 'NEXUS',     hex: 0xc0a020, baseSpeed: 0.30, geometryType: 'torus',          erratic: false },
  { id: 'vault',     name: 'VAULT',     hex: 0x8a6010, baseSpeed: 0.25, geometryType: 'sphere_vault',    erratic: false },
  { id: 'pulse',     name: 'PULSE',     hex: 0x20a0c0, baseSpeed: 0.35, geometryType: 'octahedron_flat', erratic: false },
  { id: 'ledger',    name: 'LEDGER',    hex: 0x20c060, baseSpeed: 0.28, geometryType: 'box',             erratic: false },
  { id: 'blueprint', name: 'BLUEPRINT', hex: 0x2060c0, baseSpeed: 0.32, geometryType: 'icosahedron',     erratic: false },
  { id: 'ohm',       name: 'OHM',       hex: 0xe0e0e0, baseSpeed: 0.22, geometryType: 'torusknot',       erratic: false },
  { id: 'scout',     name: 'SCOUT',     hex: 0xc08020, baseSpeed: 0.65, geometryType: 'tetrahedron',     erratic: true  },
  { id: 'spark',     name: 'SPARK',     hex: 0xc020a0, baseSpeed: 0.50, geometryType: 'star',            erratic: false },
  { id: 'chrono',    name: 'CHRONO',    hex: 0x20c0a0, baseSpeed: 0.30, geometryType: 'cylinder_ring',   erratic: false },
  { id: 'echo',      name: 'ECHO',      hex: 0x8020c0, baseSpeed: 0.28, geometryType: 'sphere_echo',     erratic: false },
  { id: 'atlas',     name: 'ATLAS',     hex: 0xc06020, baseSpeed: 0.35, geometryType: 'mappin',          erratic: false },
]

// ── Beam colors by data type ──────────────────────────────────────────────────

const BEAM_COLORS = [
  0x40c0a0,   // teal
  0xc0a020,   // gold
  0xc020a0,   // magenta
  0x2060c0,   // blue
  0x20c060,   // green
]

// ── Geometry builders ─────────────────────────────────────────────────────────

function buildStarGeometry(outerR = 0.38, innerR = 0.17, points = 5): THREE.BufferGeometry {
  const count = points * 2
  const verts: number[] = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    verts.push(Math.cos(angle) * r, Math.sin(angle) * r, 0)
  }
  verts.push(0, 0, 0) // center
  const idx: number[] = []
  for (let i = 0; i < count; i++) {
    idx.push(count, i, (i + 1) % count)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

// ── Agent runtime state ───────────────────────────────────────────────────────

interface Beam {
  line: THREE.Line
  timeLeft: number
}

interface PulseRing {
  mesh: THREE.Mesh
  scale: number
  timeLeft: number
}

interface AgentEntity {
  def: AgentDef
  group: THREE.Group
  mesh: THREE.Mesh
  // Effects
  trailPoints?: THREE.Points       // NEXUS / LEDGER / BLUEPRINT wake trails
  trailPositions?: Float32Array
  trailHistory: THREE.Vector3[]
  filamentLines?: THREE.LineSegments  // VAULT
  filamentOffsets?: Float32Array
  orbitRing?: THREE.Mesh           // CHRONO ring
  orbitNodes?: THREE.Mesh[]        // ECHO memory nodes
  pulseRings: PulseRing[]          // SPARK outward rings
  pulseTimer: number
  // Navigation
  currentPos: THREE.Vector3
  targetPos: THREE.Vector3
  speed: number
  load: number                     // 0–1 activity load
  // Idle drift
  idleOffset: THREE.Vector3
  idlePhase: number
  // Elapsed tracking
  orbitAngle: number
  selfRotAngle: number
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AgentLayerProps {
  visible: boolean
}

export function AgentLayer({ visible }: AgentLayerProps) {
  const { scene } = useWorldContext()

  const agentsRef        = useRef<AgentEntity[]>([])
  const beamsRef         = useRef<Beam[]>([])
  const nodesRef         = useRef<THREE.Vector3[]>(DEFAULT_NODES.slice())
  const frameHandlerRef  = useRef<(() => void) | null>(null)
  const clockRef         = useRef(new THREE.Clock())
  const elapsedRef       = useRef(0)
  const visibleRef       = useRef(visible)

  // Keep visibility in sync
  useEffect(() => {
    visibleRef.current = visible
    for (const ag of agentsRef.current) {
      ag.group.visible = visible
    }
    for (const bm of beamsRef.current) {
      bm.line.visible = visible
    }
  }, [visible])

  // ── Load data ─────────────────────────────────────────────────────────────

  function getAgentLoad(agentId: string): number {
    try {
      const recent = getRecentEvents({ source: agentId, limit: 20 })
      if (recent.length > 0) {
        // Normalize: 1 event = 0.05 load, 20 events = 1.0 load
        return Math.min(1.0, recent.length / 20)
      }
    } catch {
      // Ignore
    }
    // Fallback: deterministic realistic random per agent
    const base = seededRand(agentId + '_load', Math.floor(Date.now() / 30000))
    return 0.15 + base * 0.55
  }

  // ── Build geometry ────────────────────────────────────────────────────────

  function buildMesh(def: AgentDef): THREE.Mesh {
    const col = new THREE.Color(def.hex)
    const mat = new THREE.MeshLambertMaterial({
      color: col,
      emissive: col.clone().multiplyScalar(0.35),
      transparent: true,
      opacity: 0.92,
    })

    let geo: THREE.BufferGeometry

    switch (def.geometryType) {
      case 'torus':
        geo = new THREE.TorusGeometry(0.38, 0.11, 8, 24)
        break
      case 'sphere_vault':
        geo = new THREE.SphereGeometry(0.32, 10, 10)
        break
      case 'octahedron_flat': {
        geo = new THREE.OctahedronGeometry(0.4, 0)
        const positions = geo.attributes.position as THREE.BufferAttribute
        for (let i = 0; i < positions.count; i++) {
          const y = positions.getY(i)
          positions.setY(i, y * 0.35)
        }
        positions.needsUpdate = true
        geo.computeVertexNormals()
        break
      }
      case 'box':
        geo = new THREE.BoxGeometry(0.42, 0.42, 0.42)
        break
      case 'icosahedron':
        geo = new THREE.IcosahedronGeometry(0.38, 0)
        break
      case 'torusknot':
        geo = new THREE.TorusKnotGeometry(0.24, 0.09, 48, 6)
        break
      case 'tetrahedron':
        geo = new THREE.TetrahedronGeometry(0.42, 0)
        break
      case 'star':
        geo = buildStarGeometry()
        break
      case 'cylinder_ring':
        geo = new THREE.CylinderGeometry(0.18, 0.24, 0.55, 10)
        break
      case 'sphere_echo':
        geo = new THREE.SphereGeometry(0.3, 10, 10)
        break
      case 'mappin': {
        // map-pin: icosahedron head + cone body, merged via group
        // We'll use an icosahedron but add cone in the group (handled below)
        geo = new THREE.SphereGeometry(0.22, 8, 8)
        break
      }
      default:
        geo = new THREE.SphereGeometry(0.3, 8, 8)
    }

    return new THREE.Mesh(geo, mat)
  }

  function buildVaultFilaments(group: THREE.Group, color: number): THREE.LineSegments {
    const NUM_FILAMENTS = 14
    const positions = new Float32Array(NUM_FILAMENTS * 2 * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.7,
    })
    const lines = new THREE.LineSegments(geo, mat)
    group.add(lines)
    return lines
  }

  function buildTrailPoints(group: THREE.Group, color: number): { pts: THREE.Points; pos: Float32Array } {
    const positions = new Float32Array(TRAIL_LENGTH * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({
      color: color,
      size: 0.09,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      sizeAttenuation: true,
    })
    const pts = new THREE.Points(geo, mat)
    scene.add(pts) // add to scene (not group) so trail stays behind
    return { pts, pos: positions }
  }

  function buildChronoRing(group: THREE.Group, color: number): THREE.Mesh {
    const geo = new THREE.TorusGeometry(ORBIT_RADIUS, 0.04, 6, 32)
    const mat = new THREE.MeshLambertMaterial({
      color: color,
      emissive: new THREE.Color(color).multiplyScalar(0.4),
      transparent: true,
      opacity: 0.8,
    })
    const ring = new THREE.Mesh(geo, mat)
    ring.rotation.x = Math.PI / 2
    scene.add(ring) // add to scene so it orbits in world space
    return ring
  }

  function buildEchoNodes(group: THREE.Group, color: number): THREE.Mesh[] {
    const nodes: THREE.Mesh[] = []
    const nodeGeo = new THREE.OctahedronGeometry(0.1, 0)
    const nodeMat = new THREE.MeshLambertMaterial({
      color: color,
      emissive: new THREE.Color(color).multiplyScalar(0.5),
      transparent: true,
      opacity: 0.85,
    })
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(nodeGeo, nodeMat.clone())
      scene.add(m)
      nodes.push(m)
    }
    return nodes
  }

  function buildMapPinCone(group: THREE.Group, color: number) {
    const geo = new THREE.ConeGeometry(0.16, 0.45, 8)
    const mat = new THREE.MeshLambertMaterial({
      color: color,
      emissive: new THREE.Color(color).multiplyScalar(0.3),
      transparent: true,
      opacity: 0.92,
    })
    const cone = new THREE.Mesh(geo, mat)
    cone.position.y = -0.35
    cone.rotation.z = Math.PI // point downward
    group.add(cone)
  }

  // ── Build agents ──────────────────────────────────────────────────────────

  function buildAgents() {
    disposeAgents()
    const entities: AgentEntity[] = []

    for (let i = 0; i < AGENT_DEFS.length; i++) {
      const def = AGENT_DEFS[i]
      const group = new THREE.Group()
      const mesh = buildMesh(def)
      group.add(mesh)

      // Effect objects
      let trailPoints: THREE.Points | undefined
      let trailPositions: Float32Array | undefined
      let filamentLines: THREE.LineSegments | undefined
      let filamentOffsets: Float32Array | undefined
      let orbitRing: THREE.Mesh | undefined
      let orbitNodes: THREE.Mesh[] | undefined

      if (def.geometryType === 'torus' || def.geometryType === 'box' || def.geometryType === 'icosahedron') {
        // NEXUS wake, LEDGER ribbon, BLUEPRINT grid wake
        const { pts, pos } = buildTrailPoints(group, def.hex)
        trailPoints = pts
        trailPositions = pos
      }

      if (def.geometryType === 'sphere_vault') {
        // VAULT filaments
        filamentLines = buildVaultFilaments(group, def.hex)
        const NUM_FILAMENTS = 14
        filamentOffsets = new Float32Array(NUM_FILAMENTS * 3)
        // Seed base filament directions
        for (let f = 0; f < NUM_FILAMENTS; f++) {
          const theta = seededRand(def.id + '_ft', f) * Math.PI * 2
          const phi   = seededRand(def.id + '_fp', f) * Math.PI
          filamentOffsets[f * 3]     = Math.sin(phi) * Math.cos(theta)
          filamentOffsets[f * 3 + 1] = Math.cos(phi)
          filamentOffsets[f * 3 + 2] = Math.sin(phi) * Math.sin(theta)
        }
      }

      if (def.geometryType === 'cylinder_ring') {
        orbitRing = buildChronoRing(group, def.hex)
      }

      if (def.geometryType === 'sphere_echo') {
        orbitNodes = buildEchoNodes(group, def.hex)
      }

      if (def.geometryType === 'mappin') {
        buildMapPinCone(group, def.hex)
      }

      // Starting position: spread agents around available nodes
      const nodeCount = nodesRef.current.length
      const node = nodesRef.current[i % nodeCount].clone()
      const startPos = node.clone()

      // Pick next node as initial target
      const nextIdx = (i + 1) % nodeCount
      const targetPos = nodesRef.current[nextIdx].clone()

      const load = getAgentLoad(def.id)

      group.position.copy(startPos)
      group.visible = visibleRef.current
      scene.add(group)

      entities.push({
        def,
        group,
        mesh,
        trailPoints,
        trailPositions,
        trailHistory: [],
        filamentLines,
        filamentOffsets,
        orbitRing,
        orbitNodes,
        pulseRings: [],
        pulseTimer: seededRand(def.id + '_pt', 0) * PULSE_INTERVAL,
        currentPos: startPos,
        targetPos,
        speed: def.baseSpeed * (0.5 + load * 1.0),
        load,
        idleOffset: new THREE.Vector3(
          (seededRand(def.id + '_io', 0) - 0.5) * 0.3,
          (seededRand(def.id + '_io', 1) - 0.5) * 0.2,
          (seededRand(def.id + '_io', 2) - 0.5) * 0.3
        ),
        idlePhase: seededRand(def.id + '_ip', 0) * Math.PI * 2,
        orbitAngle: seededRand(def.id + '_oa', 0) * Math.PI * 2,
        selfRotAngle: 0,
      })
    }

    agentsRef.current = entities
  }

  // ── Dispose ───────────────────────────────────────────────────────────────

  function disposeAgents() {
    for (const ag of agentsRef.current) {
      scene.remove(ag.group)
      ag.mesh.geometry.dispose()
      ;(ag.mesh.material as THREE.Material).dispose()

      if (ag.trailPoints) {
        scene.remove(ag.trailPoints)
        ag.trailPoints.geometry.dispose()
        ;(ag.trailPoints.material as THREE.Material).dispose()
      }
      if (ag.filamentLines) {
        ag.filamentLines.geometry.dispose()
        ;(ag.filamentLines.material as THREE.Material).dispose()
      }
      if (ag.orbitRing) {
        scene.remove(ag.orbitRing)
        ag.orbitRing.geometry.dispose()
        ;(ag.orbitRing.material as THREE.Material).dispose()
      }
      if (ag.orbitNodes) {
        for (const n of ag.orbitNodes) {
          scene.remove(n)
          n.geometry.dispose()
          ;(n.material as THREE.Material).dispose()
        }
      }
      for (const pr of ag.pulseRings) {
        scene.remove(pr.mesh)
        pr.mesh.geometry.dispose()
        ;(pr.mesh.material as THREE.Material).dispose()
      }
    }
    agentsRef.current = []

    disposeBeams()
  }

  function disposeBeams() {
    for (const bm of beamsRef.current) {
      scene.remove(bm.line)
      bm.line.geometry.dispose()
      ;(bm.line.material as THREE.Material).dispose()
    }
    beamsRef.current = []
  }

  // ── Spawn a beam between two agents ──────────────────────────────────────

  function spawnBeam(posA: THREE.Vector3, posB: THREE.Vector3, colorHex: number) {
    const pts = [posA.clone(), posB.clone()]
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      linewidth: 1,
    })
    const line = new THREE.Line(geo, mat)
    line.visible = visibleRef.current
    scene.add(line)
    beamsRef.current.push({ line, timeLeft: BEAM_DURATION })
  }

  // ── Spawn a SPARK pulse ring ──────────────────────────────────────────────

  function spawnPulseRing(pos: THREE.Vector3): PulseRing {
    const geo = new THREE.TorusGeometry(0.3, 0.035, 6, 28)
    const mat = new THREE.MeshLambertMaterial({
      color: 0xc020a0,
      emissive: new THREE.Color(0xc020a0).multiplyScalar(0.5),
      transparent: true,
      opacity: 0.9,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(pos)
    mesh.rotation.x = Math.PI / 2
    mesh.visible = visibleRef.current
    scene.add(mesh)
    return { mesh, scale: 0.3, timeLeft: 1.6 }
  }

  // ── Pick next navigation target ───────────────────────────────────────────

  function pickNextTarget(ag: AgentEntity, currentTargetIdx: number): THREE.Vector3 {
    const nodes = nodesRef.current
    if (nodes.length === 0) return ag.currentPos.clone()

    if (ag.def.erratic) {
      // SCOUT: pick a random node
      const idx = Math.floor(Math.random() * nodes.length)
      return nodes[idx].clone()
    }

    // Sequential cycling, skip current
    const next = (currentTargetIdx + 1) % nodes.length
    return nodes[next].clone()
  }

  // ── Frame handler ─────────────────────────────────────────────────────────

  function setupFrameHandler() {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
    }
    clockRef.current.start()
    elapsedRef.current = 0

    let beamCooldown = 0  // global cooldown to avoid beam spam

    const handler = () => {
      const delta = clockRef.current.getDelta()
      elapsedRef.current += delta
      const elapsed = elapsedRef.current
      beamCooldown = Math.max(0, beamCooldown - delta)

      if (!visibleRef.current) return

      const agents = agentsRef.current

      // ── Update each agent ────────────────────────────────────────────────
      for (let i = 0; i < agents.length; i++) {
        const ag = agents[i]

        // ── Movement ────────────────────────────────────────────────────
        const toTarget = ag.targetPos.clone().sub(ag.currentPos)
        const dist = toTarget.length()

        if (dist > 0.25) {
          // Move toward target
          const step = ag.speed * delta
          const move = toTarget.normalize().multiplyScalar(Math.min(step, dist))

          // SCOUT: add erratic jitter
          if (ag.def.erratic) {
            move.x += (Math.random() - 0.5) * 0.08
            move.z += (Math.random() - 0.5) * 0.08
          }

          ag.currentPos.add(move)
        } else {
          // Reached target: pick next
          ag.currentPos.copy(ag.targetPos)
          const nodes = nodesRef.current
          if (nodes.length > 0) {
            const nextIdx = Math.floor(Math.random() * nodes.length)
            ag.targetPos = nodes[nextIdx].clone()
          }
        }

        // Idle vertical drift
        const driftY = AGENT_Y + Math.sin(elapsed * 0.7 + ag.idlePhase) * 0.22
        ag.group.position.set(ag.currentPos.x, driftY, ag.currentPos.z)

        // ── Geometry-specific updates ────────────────────────────────
        switch (ag.def.geometryType) {
          case 'torus':
            // NEXUS: slow deliberate rotation
            ag.mesh.rotation.y += delta * 0.6
            ag.mesh.rotation.z = Math.sin(elapsed * 0.4) * 0.3
            break

          case 'sphere_vault': {
            // VAULT: extend/retract filaments
            if (ag.filamentLines && ag.filamentOffsets) {
              const NUM_FILAMENTS = 14
              const pos = ag.filamentLines.geometry.attributes.position as THREE.BufferAttribute
              const posArr = pos.array as Float32Array
              for (let f = 0; f < NUM_FILAMENTS; f++) {
                const extLen = 0.28 + 0.28 * Math.sin(elapsed * 1.8 + f * 0.9)
                const nx = ag.filamentOffsets[f * 3]
                const ny = ag.filamentOffsets[f * 3 + 1]
                const nz = ag.filamentOffsets[f * 3 + 2]
                // start at surface
                posArr[f * 6]     = nx * 0.32
                posArr[f * 6 + 1] = ny * 0.32
                posArr[f * 6 + 2] = nz * 0.32
                // end extended
                posArr[f * 6 + 3] = nx * (0.32 + extLen)
                posArr[f * 6 + 4] = ny * (0.32 + extLen)
                posArr[f * 6 + 5] = nz * (0.32 + extLen)
              }
              pos.needsUpdate = true
            }
            ag.mesh.rotation.y += delta * 0.3
            break
          }

          case 'octahedron_flat': {
            // PULSE: pulsing scale and emissive
            const pulseFactor = 0.88 + 0.22 * Math.sin(elapsed * 3.1)
            ag.mesh.scale.setScalar(pulseFactor)
            const mat = ag.mesh.material as THREE.MeshLambertMaterial
            mat.emissiveIntensity = 0.3 + 0.5 * Math.abs(Math.sin(elapsed * 3.1))
            break
          }

          case 'box':
            // LEDGER: slow rotation
            ag.mesh.rotation.y += delta * 0.5
            ag.mesh.rotation.x += delta * 0.2
            break

          case 'icosahedron':
            // BLUEPRINT: wireframe-like slow rotation
            ag.mesh.rotation.y += delta * 0.45
            ag.mesh.rotation.z += delta * 0.15
            break

          case 'torusknot':
            // OHM: slow rotation
            ag.mesh.rotation.y += delta * 0.35
            ag.mesh.rotation.x += delta * 0.12
            break

          case 'tetrahedron':
            // SCOUT: fast rotation
            ag.mesh.rotation.y += delta * 2.8
            ag.mesh.rotation.x += delta * 1.4
            break

          case 'star': {
            // SPARK: rotate and emit pulses
            ag.mesh.rotation.z += delta * 1.2
            ag.pulseTimer -= delta
            if (ag.pulseTimer <= 0) {
              ag.pulseTimer = PULSE_INTERVAL * (0.7 + Math.random() * 0.6)
              const ring = spawnPulseRing(ag.group.position)
              ag.pulseRings.push(ring)
            }
            // Update existing pulse rings
            for (let r = ag.pulseRings.length - 1; r >= 0; r--) {
              const pr = ag.pulseRings[r]
              pr.timeLeft -= delta
              pr.scale += delta * 2.8
              pr.mesh.scale.setScalar(pr.scale)
              pr.mesh.position.copy(ag.group.position)
              const mat = pr.mesh.material as THREE.MeshLambertMaterial
              mat.opacity = Math.max(0, (pr.timeLeft / 1.6) * 0.85)
              if (pr.timeLeft <= 0) {
                scene.remove(pr.mesh)
                pr.mesh.geometry.dispose()
                ;(pr.mesh.material as THREE.Material).dispose()
                ag.pulseRings.splice(r, 1)
              }
            }
            break
          }

          case 'cylinder_ring': {
            // CHRONO: cylinder rotates + ring orbits
            ag.mesh.rotation.y += delta * 0.8
            ag.orbitAngle += delta * 1.4
            if (ag.orbitRing) {
              const rx = ag.group.position.x + Math.cos(ag.orbitAngle) * ORBIT_RADIUS
              const rz = ag.group.position.z + Math.sin(ag.orbitAngle) * ORBIT_RADIUS
              ag.orbitRing.position.set(rx, ag.group.position.y, rz)
              ag.orbitRing.rotation.x = Math.PI / 2 + Math.sin(ag.orbitAngle * 0.5) * 0.4
              ag.orbitRing.visible = visibleRef.current
            }
            break
          }

          case 'sphere_echo': {
            // ECHO: sphere + 3 orbiting memory nodes
            ag.mesh.rotation.y += delta * 0.4
            ag.orbitAngle += delta * 1.1
            if (ag.orbitNodes) {
              for (let n = 0; n < ag.orbitNodes.length; n++) {
                const phaseOffset = (n / ag.orbitNodes.length) * Math.PI * 2
                const angle = ag.orbitAngle + phaseOffset
                const orbR = ORBIT_RADIUS * 0.8
                const nx2 = ag.group.position.x + Math.cos(angle) * orbR
                const ny2 = ag.group.position.y + Math.sin(angle * 0.7) * 0.3
                const nz2 = ag.group.position.z + Math.sin(angle) * orbR
                ag.orbitNodes[n].position.set(nx2, ny2, nz2)
                ag.orbitNodes[n].visible = visibleRef.current
                // Crystallize: scale in/out
                const crystal = 0.7 + 0.5 * Math.sin(elapsed * 1.3 + n * 1.0)
                ag.orbitNodes[n].scale.setScalar(crystal)
              }
            }
            break
          }

          case 'mappin':
            // ATLAS: gentle sway
            ag.mesh.rotation.z = Math.sin(elapsed * 0.9 + ag.idlePhase) * 0.12
            break
        }

        // ── Wake trail (NEXUS, LEDGER, BLUEPRINT) ──────────────────────
        if (ag.trailPoints && ag.trailPositions) {
          ag.trailHistory.unshift(ag.group.position.clone())
          if (ag.trailHistory.length > TRAIL_LENGTH) ag.trailHistory.pop()

          for (let t = 0; t < TRAIL_LENGTH; t++) {
            const histPos = ag.trailHistory[t] ?? ag.group.position
            ag.trailPositions[t * 3]     = histPos.x
            ag.trailPositions[t * 3 + 1] = histPos.y
            ag.trailPositions[t * 3 + 2] = histPos.z
          }

          const trailAttr = ag.trailPoints.geometry.getAttribute('position') as THREE.BufferAttribute
          ;(trailAttr.array as Float32Array).set(ag.trailPositions)
          trailAttr.needsUpdate = true

          const trailMat = ag.trailPoints.material as THREE.PointsMaterial
          trailMat.opacity = visibleRef.current ? 0.45 : 0
          ag.trailPoints.visible = visibleRef.current && ag.trailHistory.length > 2
        }
      }

      // ── Beam connections ─────────────────────────────────────────────────
      if (beamCooldown <= 0) {
        for (let i = 0; i < agents.length; i++) {
          for (let j = i + 1; j < agents.length; j++) {
            const a = agents[i]
            const b = agents[j]
            const d = a.group.position.distanceTo(b.group.position)
            if (d < BEAM_DIST) {
              // Avoid duplicate beams for same pair quickly
              const pairKey = `${a.def.id}-${b.def.id}`
              const existing = beamsRef.current.some(
                bm => (bm.line.userData.pairKey === pairKey)
              )
              if (!existing) {
                const colorHex = BEAM_COLORS[Math.floor(Math.random() * BEAM_COLORS.length)]
                const beam = spawnBeam(a.group.position, b.group.position, colorHex)
                // We returned void — find the last added beam and tag it
                const lastBeam = beamsRef.current[beamsRef.current.length - 1]
                if (lastBeam) lastBeam.line.userData.pairKey = pairKey
                beamCooldown = 0.25
              }
            }
          }
        }
      }

      // ── Update beams ─────────────────────────────────────────────────────
      for (let b = beamsRef.current.length - 1; b >= 0; b--) {
        const bm = beamsRef.current[b]
        bm.timeLeft -= delta
        const mat = bm.line.material as THREE.LineBasicMaterial
        mat.opacity = Math.max(0, bm.timeLeft / BEAM_DURATION)
        if (bm.timeLeft <= 0) {
          scene.remove(bm.line)
          bm.line.geometry.dispose()
          ;(bm.line.material as THREE.Material).dispose()
          beamsRef.current.splice(b, 1)
        }
      }
    }

    window.addEventListener('nw:frame', handler)
    frameHandlerRef.current = handler
  }

  // ── Update nodes from world data ──────────────────────────────────────────

  function updateNodes(projects: NWProject[]) {
    const activeProjects = projects.filter(p =>
      ['in_progress', 'approved', 'pending', 'on_hold', 'completed'].includes(p.status)
    )

    if (activeProjects.length >= MIN_NODES) {
      nodesRef.current = activeProjects.map(p => {
        const { x, z } = seededPosition(p.id)
        return new THREE.Vector3(x, AGENT_Y, z)
      })
    } else {
      // Pad with defaults
      const extra = DEFAULT_NODES.slice(0, Math.max(0, MIN_NODES - activeProjects.length))
      const fromProjects = activeProjects.map(p => {
        const { x, z } = seededPosition(p.id)
        return new THREE.Vector3(x, AGENT_Y, z)
      })
      nodesRef.current = [...fromProjects, ...extra]
    }

    // Reassign agent targets to new node list
    const nodes = nodesRef.current
    for (let i = 0; i < agentsRef.current.length; i++) {
      const ag = agentsRef.current[i]
      const targetIdx = i % nodes.length
      ag.targetPos = nodes[targetIdx].clone()
    }
  }

  // ── Effect: subscribe to world data ──────────────────────────────────────

  useEffect(() => {
    // Initial build with defaults
    buildAgents()
    setupFrameHandler()

    const unsub = subscribeWorldData((data: NWWorldData) => {
      updateNodes(data.projects)
    })

    return () => {
      unsub()
      disposeAgents()
      if (frameHandlerRef.current) {
        window.removeEventListener('nw:frame', frameHandlerRef.current)
        frameHandlerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  return null
}
