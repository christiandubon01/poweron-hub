/**
 * DataFlowLayer.tsx — NW18: Connection lines and animated data flow particles.
 *
 * CONNECTION LINES (TubeGeometry, semi-transparent):
 *   - Projects → crew (labor ridges enhanced)
 *   - Projects → invoices (AR stalactites connect to project mountains)
 *   - Agents → their monitored nodes
 *   - Subscriptions → MRR mountain
 *
 * PARTICLE FLOWS (sphere meshes animated along paths):
 *   1. PAYMENT FLOW  — Green spheres: project mountain → river (x=0) → HQ (0,2,0)
 *   2. MATERIAL FLOW — Orange spheres: west edge (-185) → project mountain
 *   3. LEAD FLOW     — Yellow spheres: SPARK (60,-120) → outward to map edges
 *   4. INVOICE AGING — Red pulses: expand from AR stalactite positions every 5s
 *   5. SUBSCRIBER FLOW — Blue spheres: NDA gate (25,0) → subscription towers
 *   6. CREW DISPATCH   — Teal spheres: along labor ridge paths between mountains
 *
 * All flows use ParticleManager (shared budget).
 * Toggle: visible prop connected to 'data-flow' layer toggle.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWWorldData,
  type NWProject,
} from './DataBridge'
import { registerParticles, unregisterParticles } from './ParticleManager'

// ── Constants ──────────────────────────────────────────────────────────────────

const FLOW_TUBE_SEGMENTS = 20
const TUBE_RADIUS         = 0.18
const TUBE_OPACITY        = 0.22

const PAYMENT_COLOR    = new THREE.Color(0x00ff66)
const MATERIAL_COLOR   = new THREE.Color(0xff8822)
const LEAD_COLOR       = new THREE.Color(0xffee00)
const INVOICE_COLOR    = new THREE.Color(0xff2244)
const SUBSCRIBER_COLOR = new THREE.Color(0x2288ff)
const CREW_COLOR       = new THREE.Color(0x00ccaa)
const CONN_COLOR       = new THREE.Color(0x004444)

const SPARK_POS  = new THREE.Vector3(60, 10, -120)
const NDA_POS    = new THREE.Vector3(25,  4,   0)
const HQ_POS     = new THREE.Vector3( 0,  2,   0)
const MRR_POS    = new THREE.Vector3(100, 8,   0)

// Subscription tower positions (must match NodeClickSystem)
const SUB_TOWER_POSITIONS: THREE.Vector3[] = [
  new THREE.Vector3( 40,  8, -80),
  new THREE.Vector3( 70, 10, -40),
  new THREE.Vector3(100, 12,   0),
  new THREE.Vector3(130, 14,  40),
  new THREE.Vector3(160, 16,  80),
]

// Agent node positions
const AGENT_POSITIONS: Record<string, THREE.Vector3> = {
  VAULT:     new THREE.Vector3(-172, 6,  80),
  LEDGER:    new THREE.Vector3(-30,  6,  25),
  OHM:       new THREE.Vector3(-165, 6, -110),
  CHRONO:    new THREE.Vector3(-105, 6,   0),
  BLUEPRINT: new THREE.Vector3(-130, 6, -70),
  SPARK:     SPARK_POS.clone(),
  NEXUS:     new THREE.Vector3( 110, 6, -60),
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTube(points: THREE.Vector3[], color: THREE.Color): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points)
  const geo = new THREE.TubeGeometry(curve, FLOW_TUBE_SEGMENTS, TUBE_RADIUS, 6, false)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: TUBE_OPACITY,
    depthWrite: false,
  })
  return new THREE.Mesh(geo, mat)
}

function makeParticleMesh(color: THREE.Color, radius = 0.45): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 6, 5)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
  })
  return new THREE.Mesh(geo, mat)
}

// ── Animated particle along a curve ───────────────────────────────────────────

interface FlowParticle {
  mesh: THREE.Mesh
  curve: THREE.CatmullRomCurve3
  t: number          // 0–1 progress along curve
  speed: number      // per-frame increment
  active: boolean
  restartDelay: number  // frames to wait before restarting
  restartCountdown: number
}

// ── Component ──────────────────────────────────────────────────────────────────

interface DataFlowLayerProps {
  visible: boolean
}

export function DataFlowLayer({ visible }: DataFlowLayerProps) {
  const { scene } = useWorldContext()

  // NW40: World speed factor from ResonanceOrb
  const worldSpeedRef = useRef<number>(1.0)
  useEffect(() => {
    function onSpeedFactor(e: Event) {
      const ev = e as CustomEvent<{ factor: number }>
      if (ev.detail?.factor !== undefined) worldSpeedRef.current = ev.detail.factor
    }
    window.addEventListener('nw:world-speed-factor', onSpeedFactor)
    return () => window.removeEventListener('nw:world-speed-factor', onSpeedFactor)
  }, [])

  // Connection tube meshes
  const tubesRef = useRef<THREE.Mesh[]>([])

  // Flow particles
  const particlesRef = useRef<FlowParticle[]>([])

  // Invoice aging pulse spheres: { mesh, basePos, age }
  interface AgingPulse {
    mesh: THREE.Mesh
    basePos: THREE.Vector3
    scaleT: number
    opacity: number
    active: boolean
  }
  const agingPulsesRef = useRef<AgingPulse[]>([])
  const agingTimerRef = useRef<number>(0)

  // Visible ref (avoid stale closure)
  const visibleRef = useRef(visible)
  useEffect(() => { visibleRef.current = visible }, [visible])

  // Last world data for re-build
  const lastDataRef = useRef<NWWorldData | null>(null)

  // ── Dispose all objects ──────────────────────────────────────────────────────

  function disposeAll() {
    tubesRef.current.forEach(m => {
      scene.remove(m)
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    })
    tubesRef.current = []

    particlesRef.current.forEach(p => {
      scene.remove(p.mesh)
      p.mesh.geometry.dispose()
      ;(p.mesh.material as THREE.Material).dispose()
    })
    particlesRef.current = []

    agingPulsesRef.current.forEach(p => {
      scene.remove(p.mesh)
      p.mesh.geometry.dispose()
      ;(p.mesh.material as THREE.Material).dispose()
    })
    agingPulsesRef.current = []

    unregisterParticles('data-flow-payments')
    unregisterParticles('data-flow-materials')
    unregisterParticles('data-flow-leads')
    unregisterParticles('data-flow-aging')
    unregisterParticles('data-flow-subs')
    unregisterParticles('data-flow-crew')
  }

  // ── Build flows from world data ──────────────────────────────────────────────

  function buildFlows(data: NWWorldData) {
    disposeAll()

    const projects = data.projects.filter(
      p => p.status === 'in_progress' || p.status === 'approved' || p.status === 'completed'
    ).slice(0, 12)  // cap to keep performance

    // ─── CONNECTION TUBES ────────────────────────────────────────────────────

    // Agent → monitored nodes tubes
    const agentConnections: Array<[THREE.Vector3, THREE.Vector3, THREE.Color]> = [
      [AGENT_POSITIONS.VAULT,     AGENT_POSITIONS.LEDGER,    new THREE.Color(0x442200)],
      [AGENT_POSITIONS.VAULT,     AGENT_POSITIONS.CHRONO,    new THREE.Color(0x442200)],
      [AGENT_POSITIONS.LEDGER,    AGENT_POSITIONS.OHM,       new THREE.Color(0x002244)],
      [AGENT_POSITIONS.BLUEPRINT, AGENT_POSITIONS.OHM,       new THREE.Color(0x002222)],
      [AGENT_POSITIONS.SPARK,     AGENT_POSITIONS.NEXUS,     new THREE.Color(0x442200)],
    ]

    agentConnections.forEach(([a, b, col]) => {
      const mid = a.clone().lerp(b, 0.5)
      mid.y += 8  // arc upward
      const tube = makeTube([a, mid, b], col)
      scene.add(tube)
      tubesRef.current.push(tube)
    })

    // Projects → VAULT tube (sample: first 4 projects)
    projects.slice(0, 4).forEach(p => {
      const pos2d = seededPosition(p.id)
      const h = contractValueToHeight(p.contract_value)
      const projPos = new THREE.Vector3(pos2d.x, h + 2, pos2d.z)
      const mid = projPos.clone().lerp(AGENT_POSITIONS.VAULT, 0.5)
      mid.y += 6
      const tube = makeTube([projPos, mid, AGENT_POSITIONS.VAULT], CONN_COLOR.clone())
      scene.add(tube)
      tubesRef.current.push(tube)
    })

    // Subscriptions → MRR mountain
    SUB_TOWER_POSITIONS.forEach((towerPos, i) => {
      if (i % 2 !== 0) return  // every other to reduce clutter
      const mid = towerPos.clone().lerp(MRR_POS, 0.5)
      mid.y += 10
      const tube = makeTube([towerPos, mid, MRR_POS], new THREE.Color(0x001144))
      scene.add(tube)
      tubesRef.current.push(tube)
    })

    // ─── PAYMENT FLOW PARTICLES ──────────────────────────────────────────────
    // Green spheres: project mountain → river (lerp to x=0) → HQ

    const paymentAllowed = registerParticles('data-flow-payments', 'Payment Flow', Math.min(projects.length, 8))

    for (let i = 0; i < paymentAllowed; i++) {
      const p = projects[i % projects.length]
      const pos2d = seededPosition(p.id)
      const h = contractValueToHeight(p.contract_value)
      const projPos = new THREE.Vector3(pos2d.x, h + 1, pos2d.z)
      const riverEntry = new THREE.Vector3(0, 1.5, pos2d.z)
      const size = Math.max(0.3, Math.min(1.2, p.contract_value / 50000))
      const mesh = makeParticleMesh(PAYMENT_COLOR, size * 0.5)
      scene.add(mesh)
      const curve = new THREE.CatmullRomCurve3([projPos, riverEntry, HQ_POS])
      particlesRef.current.push({
        mesh, curve,
        t: Math.random(),
        speed: 1 / (180),  // ~3s at 60fps
        active: true,
        restartDelay: 90 + Math.floor(Math.random() * 120),
        restartCountdown: 0,
      })
    }

    // ─── MATERIAL FLOW PARTICLES ─────────────────────────────────────────────
    // Orange spheres: west map edge → project mountain

    const materialAllowed = registerParticles('data-flow-materials', 'Material Flow', Math.min(projects.length, 6))

    for (let i = 0; i < materialAllowed; i++) {
      const p = projects[i % projects.length]
      if (p.material_cost <= 0) continue
      const pos2d = seededPosition(p.id)
      const h = contractValueToHeight(p.contract_value)
      const projPos = new THREE.Vector3(pos2d.x, h + 0.5, pos2d.z)
      const edgeStart = new THREE.Vector3(-185, 2, pos2d.z)
      const mesh = makeParticleMesh(MATERIAL_COLOR, 0.4)
      scene.add(mesh)
      const curve = new THREE.CatmullRomCurve3([edgeStart, projPos])
      particlesRef.current.push({
        mesh, curve,
        t: Math.random(),
        speed: 1 / 240,  // slower
        active: true,
        restartDelay: 120 + Math.floor(Math.random() * 180),
        restartCountdown: 0,
      })
    }

    // ─── LEAD FLOW PARTICLES ──────────────────────────────────────────────────
    // Yellow spheres: SPARK tower → outward

    const activeLeads = data.projects.filter(p => p.status === 'lead').length
    const leadCount = Math.min(Math.max(1, activeLeads), 6)
    const leadAllowed = registerParticles('data-flow-leads', 'Lead Flow', leadCount)

    for (let i = 0; i < leadAllowed; i++) {
      const angle = (i / leadAllowed) * Math.PI * 2
      const outX = SPARK_POS.x + Math.cos(angle) * 100
      const outZ = SPARK_POS.z + Math.sin(angle) * 100
      const outPos = new THREE.Vector3(outX, 3, outZ)
      const mesh = makeParticleMesh(LEAD_COLOR, 0.5)
      scene.add(mesh)
      const curve = new THREE.CatmullRomCurve3([SPARK_POS.clone(), outPos])
      particlesRef.current.push({
        mesh, curve,
        t: (i / leadAllowed),
        speed: 1 / 200,
        active: true,
        restartDelay: 60,
        restartCountdown: 0,
      })
    }

    // ─── INVOICE AGING PULSES ─────────────────────────────────────────────────
    // Red pulses from AR stalactite positions (above project mountains)

    const unpaidInvoices = data.invoices.filter(inv => inv.status !== 'paid').slice(0, 6)
    const agingAllowed = registerParticles('data-flow-aging', 'Invoice Aging', unpaidInvoices.length)

    for (let i = 0; i < Math.min(unpaidInvoices.length, agingAllowed); i++) {
      const inv = unpaidInvoices[i]
      const proj = data.projects.find(p => p.id === inv.project_id)
      if (!proj) continue
      const pos2d = seededPosition(proj.id)
      const h = contractValueToHeight(proj.contract_value)
      const pulsePos = new THREE.Vector3(pos2d.x, h + 6, pos2d.z)

      const geo = new THREE.SphereGeometry(1, 8, 6)
      const mat = new THREE.MeshBasicMaterial({
        color: INVOICE_COLOR,
        transparent: true,
        opacity: 0.8,
        wireframe: true,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(pulsePos)
      scene.add(mesh)

      agingPulsesRef.current.push({
        mesh,
        basePos: pulsePos.clone(),
        scaleT: Math.random() * Math.PI * 2,
        opacity: 0.8,
        active: true,
      })
    }

    // ─── SUBSCRIBER FLOW ─────────────────────────────────────────────────────
    // Blue spheres: NDA gate → subscription towers

    const subCount = Math.min(5, Math.max(1, data.accountingSignals.hubSubscriberCount))
    const subAllowed = registerParticles('data-flow-subs', 'Subscriber Flow', subCount)

    for (let i = 0; i < subAllowed; i++) {
      const towerPos = SUB_TOWER_POSITIONS[i % SUB_TOWER_POSITIONS.length]
      const mid = NDA_POS.clone().lerp(towerPos, 0.5)
      mid.y += 12
      const mesh = makeParticleMesh(SUBSCRIBER_COLOR, 0.45)
      scene.add(mesh)
      const curve = new THREE.CatmullRomCurve3([NDA_POS.clone(), mid, towerPos.clone()])
      particlesRef.current.push({
        mesh, curve,
        t: i / subAllowed,
        speed: 1 / 220,
        active: true,
        restartDelay: 80,
        restartCountdown: 0,
      })
    }

    // ─── CREW DISPATCH ───────────────────────────────────────────────────────
    // Teal spheres along labor ridge lines between project mountains

    const crewPairs: Array<[NWProject, NWProject]> = []
    const logsByProject = new Map<string, Set<string>>()
    data.fieldLogs.forEach(fl => {
      if (!fl.project_id || !fl.crew_id) return
      if (!logsByProject.has(fl.crew_id)) logsByProject.set(fl.crew_id, new Set())
      logsByProject.get(fl.crew_id)!.add(fl.project_id)
    })
    logsByProject.forEach(projectIds => {
      const arr = Array.from(projectIds)
      if (arr.length >= 2) {
        const p1 = data.projects.find(p => p.id === arr[0])
        const p2 = data.projects.find(p => p.id === arr[1])
        if (p1 && p2) crewPairs.push([p1, p2])
      }
    })

    const crewAllowed = registerParticles('data-flow-crew', 'Crew Dispatch', Math.min(crewPairs.length, 4))

    for (let i = 0; i < Math.min(crewPairs.length, crewAllowed); i++) {
      const [p1, p2] = crewPairs[i]
      const pos1 = seededPosition(p1.id)
      const pos2 = seededPosition(p2.id)
      const h1 = contractValueToHeight(p1.contract_value)
      const h2 = contractValueToHeight(p2.contract_value)
      const from = new THREE.Vector3(pos1.x, h1 + 1.5, pos1.z)
      const to   = new THREE.Vector3(pos2.x, h2 + 1.5, pos2.z)
      const mesh = makeParticleMesh(CREW_COLOR, 0.4)
      scene.add(mesh)
      const curve = new THREE.CatmullRomCurve3([from, to])
      particlesRef.current.push({
        mesh, curve,
        t: Math.random(),
        speed: 1 / 180,
        active: true,
        restartDelay: 60,
        restartCountdown: 0,
      })
    }
  }

  // ── Subscribe to world data ──────────────────────────────────────────────────

  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      lastDataRef.current = data
      if (visibleRef.current) buildFlows(data)
    })
    return () => {
      unsub()
      disposeAll()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Handle visible toggle ────────────────────────────────────────────────────

  useEffect(() => {
    if (visible) {
      if (lastDataRef.current && tubesRef.current.length === 0) {
        buildFlows(lastDataRef.current)
      }
      // Show all
      tubesRef.current.forEach(m => { m.visible = true })
      particlesRef.current.forEach(p => { p.mesh.visible = true })
      agingPulsesRef.current.forEach(p => { p.mesh.visible = true })
    } else {
      // Hide all
      tubesRef.current.forEach(m => { m.visible = false })
      particlesRef.current.forEach(p => { p.mesh.visible = false })
      agingPulsesRef.current.forEach(p => { p.mesh.visible = false })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // ── Animation loop ───────────────────────────────────────────────────────────

  useEffect(() => {
    function onFrame() {
      if (!visibleRef.current) return

      // Advance flow particles
      particlesRef.current.forEach(fp => {
        if (!fp.active) return
        fp.t += fp.speed * worldSpeedRef.current
        if (fp.t >= 1) {
          fp.t = 0
          fp.mesh.visible = false
          fp.active = false
          fp.restartCountdown = fp.restartDelay
          return
        }
        const pos = fp.curve.getPoint(fp.t)
        fp.mesh.position.copy(pos)
        fp.mesh.visible = true
      })

      // Restart particles with delay
      particlesRef.current.forEach(fp => {
        if (!fp.active && fp.restartCountdown > 0) {
          fp.restartCountdown--
          if (fp.restartCountdown === 0) {
            fp.active = true
            fp.t = 0
          }
        }
      })

      // Animate invoice aging pulses
      agingTimerRef.current++
      agingPulsesRef.current.forEach(ap => {
        if (!ap.active) return
        ap.scaleT += 0.04
        const scale = 1 + Math.sin(ap.scaleT * 0.5) * 0.8
        ap.mesh.scale.setScalar(scale)
        const mat = ap.mesh.material as THREE.MeshBasicMaterial
        // Pulse every 5 seconds (300 frames at 60fps)
        const phasedT = (agingTimerRef.current % 300) / 300
        mat.opacity = Math.max(0, Math.sin(phasedT * Math.PI) * 0.85)
      })
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  return null
}
