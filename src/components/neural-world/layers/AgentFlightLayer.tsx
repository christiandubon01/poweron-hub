/**
 * AgentFlightLayer.tsx — NW28: Domain zones + flying agent orbs + task cycles + data cubes.
 *
 * Replaces static admin buildings with:
 *   - Flat domain platform zones (PlaneGeometry 20×20, border glow, floating name)
 *   - Agent orbs (SphereGeometry, PointLight glow, unique color per agent)
 *   - Three-state flight machine: IDLE → TASKED → RETURNING
 *   - CatmullRomCurve3 parabolic arc flight at 8 u/s, cruising altitude y=25
 *   - Particle trails (50 particles, 3s fade) per agent
 *   - Data cubes (BoxGeometry 0.5) materialized at target, dropped into domain on return
 *   - Collision avoidance: second agent holds at y+5 if node busy
 *   - Event triggers via window DataBridge events
 *   - Demo simulation: agents fire every 15–20s if no real events
 *   - OPP stage mountain colors (dispatches nw:opp-color-change event)
 *   - LAYERS toggle: "agent-flight" — when OFF, all objects hidden
 *
 * West Continent domains: Lead Acquisition, Closing, Project Installation,
 *   Compliance, Material Takeoff, Progress Tracking, Revenue
 * East Continent domains: Analysis, Memory, Geographic
 * Founders Valley: NEXUS + GUARDIAN patrol
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { registerParticles, unregisterParticles } from '../ParticleManager'
import { createDomainZone, type DomainZoneInstance, type DomainZoneConfig } from '../DomainZone'
import { AgentOrbInstance, type AgentOrbConfig } from '../AgentOrb'

// ── OPP Stage Mountain Colors ─────────────────────────────────────────────────

export const OPP_STAGE_COLORS: Record<string, number> = {
  Estimating:  0x990000,  // dark red
  Planning:    0xFF0000,  // red
  'Site Prep': 0xFF9900,  // orange
  'Rough-in':  0x93C47D,  // light green
  Finish:      0x38761D,  // forest green
  Trim:        0x274E13,  // dark green / fluorescent
}

// ── Domain Definitions ────────────────────────────────────────────────────────

const DOMAIN_DEFS: DomainZoneConfig[] = [
  // ── West Continent ──────────────────────────────────────────────────────
  {
    id: 'lead-acquisition',
    name: 'Lead Acquisition',
    agentId: 'SPARK',
    worldX: -175,
    worldZ: -120,
    borderColor: 0xFFE040,   // yellow
  },
  {
    id: 'closing',
    name: 'Closing',
    agentId: 'NEXUS+VAULT',
    worldX: -150,
    worldZ:  60,
    borderColor: 0xFFD24A,   // gold
  },
  {
    id: 'project-installation',
    name: 'Project Install',
    agentId: 'BLUEPRINT',
    worldX: -130,
    worldZ: -70,
    borderColor: 0x3A8EFF,   // blue
  },
  {
    id: 'compliance',
    name: 'Compliance',
    agentId: 'OHM',
    worldX: -165,
    worldZ: -110,
    borderColor: 0xFF9040,   // orange
  },
  {
    id: 'material-takeoff',
    name: 'Material Takeoff',
    agentId: 'VAULT',
    worldX: -172,
    worldZ:  90,
    borderColor: 0xAA8820,   // gold-dim
  },
  {
    id: 'progress-tracking',
    name: 'Progress Tracking',
    agentId: 'ECHO',
    worldX: -105,
    worldZ:   0,
    borderColor: 0x2040AA,   // dark blue
  },
  {
    id: 'revenue',
    name: 'Revenue',
    agentId: 'LEDGER',
    worldX: -35,
    worldZ:  25,
    borderColor: 0x2EE89A,   // green
  },
  // ── East Continent ──────────────────────────────────────────────────────
  {
    id: 'analysis',
    name: 'Analysis',
    agentId: 'SCOUT',
    worldX:  160,
    worldZ:    0,
    borderColor: 0x40D4FF,   // teal
  },
  {
    id: 'memory',
    name: 'Memory',
    agentId: 'ECHO',
    worldX:  110,
    worldZ:  130,
    borderColor: 0x2040AA,   // dark blue
  },
  {
    id: 'geographic',
    name: 'Geographic',
    agentId: 'ATLAS',
    worldX:   75,
    worldZ:   80,
    borderColor: 0x40FF80,   // bright green
  },
]

// ── Agent Definitions ─────────────────────────────────────────────────────────

interface AgentDef extends AgentOrbConfig {
  events: string[]
  // Timer-based: seconds between fires (0 = event-only)
  timerInterval: number
  primaryDomainId: string | null
}

const AGENT_DEFS: AgentDef[] = [
  {
    id:             'OHM',
    color:          0xFF9040,
    radius:         0.8,
    homeX:          -165,
    homeZ:          -110,
    homeDomainId:   'compliance',
    events:         ['nw:project-created', 'nw:rfi-opened'],
    timerInterval:  0,
    primaryDomainId:'compliance',
  },
  {
    id:             'VAULT',
    color:          0xFFD24A,
    radius:         0.8,
    homeX:          -172,
    homeZ:           90,
    homeDomainId:   'material-takeoff',
    events:         ['nw:estimate-requested', 'nw:material-cost-change'],
    timerInterval:  0,
    primaryDomainId:'material-takeoff',
  },
  {
    id:             'LEDGER',
    color:          0x2EE89A,
    radius:         0.8,
    homeX:          -35,
    homeZ:           25,
    homeDomainId:   'revenue',
    events:         ['nw:invoice-generated', 'nw:payment-overdue'],
    timerInterval:  0,
    primaryDomainId:'revenue',
  },
  {
    id:             'SPARK',
    color:          0xFFE040,
    radius:         0.8,
    homeX:          -175,
    homeZ:          -120,
    homeDomainId:   'lead-acquisition',
    events:         [],
    timerInterval:  30,    // every 30s — launches outward
    primaryDomainId:'lead-acquisition',
  },
  {
    id:             'BLUEPRINT',
    color:          0x3A8EFF,
    radius:         0.8,
    homeX:          -130,
    homeZ:          -70,
    homeDomainId:   'project-installation',
    events:         ['nw:phase-change', 'nw:crew-reassigned'],
    timerInterval:  0,
    primaryDomainId:'project-installation',
  },
  {
    id:             'CHRONO',
    color:          0xAA6EFF,
    radius:         0.8,
    homeX:          -105,
    homeZ:            0,
    homeDomainId:   'progress-tracking',
    events:         ['nw:calendar-event', 'nw:schedule-conflict'],
    timerInterval:  0,
    primaryDomainId:'progress-tracking',
  },
  {
    id:             'SCOUT',
    color:          0x40D4FF,
    radius:         0.8,
    homeX:           160,
    homeZ:             0,
    homeDomainId:   'analysis',
    events:         ['nw:anomaly-detected'],
    timerInterval:  45,    // anomaly check every 45s
    primaryDomainId:'analysis',
  },
  {
    id:             'ECHO',
    color:          0x2040AA,
    radius:         0.8,
    homeX:           110,
    homeZ:           130,
    homeDomainId:   'memory',
    events:         ['nw:session-idle'],
    timerInterval:  0,
    primaryDomainId:'memory',
  },
  {
    id:             'ATLAS',
    color:          0x40FF80,
    radius:         0.8,
    homeX:            75,
    homeZ:            80,
    homeDomainId:   'geographic',
    events:         ['nw:territory-change', 'nw:service-area-update'],
    timerInterval:  0,
    primaryDomainId:'geographic',
  },
  {
    id:             'NEXUS',
    color:          0x00E5CC,
    radius:         1.2,
    homeX:            0,
    homeZ:            0,
    homeDomainId:   'closing',
    events:         [],
    timerInterval:  0,
    primaryDomainId:'closing',
  },
  {
    id:             'GUARDIAN',
    color:          0xFF5060,
    radius:         0.8,
    homeX:            5,
    homeZ:          -15,
    homeDomainId:   null,
    events:         ['nw:security-event'],
    timerInterval:  0,
    primaryDomainId: null,
  },
]

// ── Demo simulation target nodes ──────────────────────────────────────────────

const DEMO_NODES: THREE.Vector3[] = [
  new THREE.Vector3(-110,  3,   20),
  new THREE.Vector3(-140,  3,  -30),
  new THREE.Vector3( -90,  3,  -50),
  new THREE.Vector3( -60,  3,   40),
  new THREE.Vector3(-120,  3,   60),
  new THREE.Vector3(  30,  3,  -40),
  new THREE.Vector3(  50,  3,   20),
  new THREE.Vector3(  80,  3, -100),
  new THREE.Vector3( 140,  3,   60),
  new THREE.Vector3(  10,  3,  -10),
]

// ── NDA gate position (GUARDIAN sprint target) ────────────────────────────────

const NDA_GATE = new THREE.Vector3(30, 3, -170)

// ── Max cubes per domain ──────────────────────────────────────────────────────

const MAX_DOMAIN_CUBES = 10

// ── Props ─────────────────────────────────────────────────────────────────────

interface AgentFlightLayerProps {
  visible: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentFlightLayer({ visible }: AgentFlightLayerProps) {
  const { scene } = useWorldContext()

  const visibleRef    = useRef(visible)
  const domainsRef    = useRef<Map<string, DomainZoneInstance>>(new Map())
  const orbsRef       = useRef<Map<string, AgentOrbInstance>>(new Map())
  const domainCubesRef = useRef<Map<string, THREE.Mesh[]>>(new Map())
  const clockRef      = useRef(0)
  const demoTimerRef  = useRef(0)
  const guardianAngleRef = useRef(0)
  const agentTimersRef = useRef<Map<string, number>>(new Map())

  // Sync visible ref
  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  useEffect(() => {
    // ── 1. Create domain zones ──────────────────────────────────────────────
    for (const def of DOMAIN_DEFS) {
      const zone = createDomainZone(scene, def)
      domainsRef.current.set(def.id, zone)
      domainCubesRef.current.set(def.id, [])
    }

    // ── 2. Create agent orbs ────────────────────────────────────────────────
    for (const def of AGENT_DEFS) {
      const orb = new AgentOrbInstance(scene, def)
      orbsRef.current.set(def.id, orb)
      agentTimersRef.current.set(def.id, Math.random() * (def.timerInterval || 20))
    }

    // Register trail particle budget
    const TRAIL_BUDGET = AGENT_DEFS.length * 50
    const allowed = registerParticles('agent-flight-trails', 'Agent Flight Trails', TRAIL_BUDGET)
    if (allowed < TRAIL_BUDGET) {
      console.info(`[AgentFlightLayer] Trail budget capped at ${allowed}/${TRAIL_BUDGET}`)
    }

    // ── 3. Event listeners ──────────────────────────────────────────────────
    const handlers: Array<{ event: string; fn: EventListener }> = []

    function addHandler(event: string, agentId: string) {
      const fn: EventListener = () => {
        const orb = orbsRef.current.get(agentId)
        if (!orb || orb.state !== 'IDLE' || !visibleRef.current) return
        const target = pickTarget(agentId)
        if (target) orb.dispatchTo(target)
      }
      window.addEventListener(event, fn)
      handlers.push({ event, fn })
    }

    for (const def of AGENT_DEFS) {
      for (const ev of def.events) {
        addHandler(ev, def.id)
      }
    }

    // BLUEPRINT: OPP phase change → dispatch mountain color event
    const blueprintPhaseHandler: EventListener = (e: Event) => {
      const ev = e as CustomEvent<{ stage?: string }>
      const stage = ev.detail?.stage
      if (stage && OPP_STAGE_COLORS[stage] !== undefined) {
        window.dispatchEvent(new CustomEvent('nw:opp-color-change', {
          detail: { stage, color: OPP_STAGE_COLORS[stage] },
        }))
      }
    }
    window.addEventListener('nw:phase-change', blueprintPhaseHandler)
    handlers.push({ event: 'nw:phase-change', fn: blueprintPhaseHandler })

    // GUARDIAN: security event → sprint to NDA gate
    const guardianSecHandler: EventListener = () => {
      const guardian = orbsRef.current.get('GUARDIAN')
      if (!guardian || !visibleRef.current) return
      if (guardian.state === 'IDLE') guardian.dispatchTo(NDA_GATE.clone())
    }
    window.addEventListener('nw:security-event', guardianSecHandler)
    handlers.push({ event: 'nw:security-event', fn: guardianSecHandler })

    // Particle budget reduction
    const reduceHandler: EventListener = () => {
      // Already managed by ParticleManager limits — no extra action needed
    }
    window.addEventListener('nw:reduce-particles', reduceHandler)
    handlers.push({ event: 'nw:reduce-particles', fn: reduceHandler })

    // ── 4. Animation frame ──────────────────────────────────────────────────
    let lastFrameTime = performance.now() / 1000

    function onFrame() {
      const now   = performance.now() / 1000
      const dt    = Math.min(0.05, now - lastFrameTime)
      lastFrameTime = now
      clockRef.current += dt

      const vis = visibleRef.current

      // Toggle all domain zones
      for (const zone of domainsRef.current.values()) {
        zone.group.visible = vis
      }

      if (!vis) {
        // Hide orbs but don't tick
        for (const orb of orbsRef.current.values()) {
          orb.visible = false
        }
        return
      }

      // ── GUARDIAN continuous patrol ──────────────────────────────────────
      guardianPatrol(dt, now)

      // ── Demo simulation ─────────────────────────────────────────────────
      demoTimerRef.current += dt
      const demoInterval = 15 + Math.sin(clockRef.current * 0.1) * 5  // 15–20s
      if (demoTimerRef.current >= demoInterval) {
        demoTimerRef.current = 0
        fireDemoEvent()
      }

      // ── Timer-based agents (SPARK every 30s, SCOUT every 45s) ───────────
      for (const def of AGENT_DEFS) {
        if (def.timerInterval <= 0) continue
        const elapsed = (agentTimersRef.current.get(def.id) ?? 0) + dt
        agentTimersRef.current.set(def.id, elapsed)
        if (elapsed >= def.timerInterval) {
          agentTimersRef.current.set(def.id, 0)
          const orb = orbsRef.current.get(def.id)
          if (orb && orb.state === 'IDLE') {
            const target = pickTarget(def.id)
            if (target) orb.dispatchTo(target)
          }
        }
      }

      // ── Tick all orbs ────────────────────────────────────────────────────
      for (const [agentId, orb] of orbsRef.current.entries()) {
        if (agentId === 'GUARDIAN') continue  // GUARDIAN patrolled separately
        orb.visible = vis
        const prevState = orb.state
        orb.tick(dt, now)
        // When orb transitions RETURNING→IDLE, collect the dropped cube
        if (prevState === 'RETURNING' && orb.state === 'IDLE') {
          collectDroppedCubes(agentId)
        }
      }

      // ── Animate domain cube stacks ───────────────────────────────────────
      for (const [domainId, cubes] of domainCubesRef.current.entries()) {
        const zone = domainsRef.current.get(domainId)
        if (!zone) continue
        cubes.forEach((cube, idx) => {
          cube.position.y = 0.5 + idx * 0.6
          // Gentle rotation
          cube.rotation.y += dt * 0.4
          cube.rotation.x += dt * 0.2
        })
      }
    }

    window.addEventListener('nw:frame', onFrame)
    handlers.push({ event: 'nw:frame', fn: onFrame as EventListener })

    // ── GUARDIAN patrol helper ──────────────────────────────────────────────
    function guardianPatrol(dt: number, _now: number) {
      const guardian = orbsRef.current.get('GUARDIAN')
      if (!guardian) return
      guardian.visible = visibleRef.current

      if (guardian.state === 'IDLE') {
        // Orbit founders valley perimeter
        guardianAngleRef.current += (2 * Math.PI / 40) * dt  // 40s patrol
        const radius = 18
        const x = Math.cos(guardianAngleRef.current) * radius
        const z = Math.sin(guardianAngleRef.current) * radius
        guardian.group.position.set(x, 3.5, z)
        guardian.light.intensity = 1.2
      } else {
        guardian.tick(dt, _now)
      }
    }

    // ── Pick a target for an agent ──────────────────────────────────────────
    function pickTarget(agentId: string): THREE.Vector3 | null {
      // Pick a random demo node weighted by distance from home
      const def = AGENT_DEFS.find(d => d.id === agentId)
      if (!def) return null

      const shuffled = [...DEMO_NODES].sort(() => Math.random() - 0.5)
      for (const node of shuffled) {
        return node.clone()
      }
      return DEMO_NODES[0].clone()
    }

    // ── Demo simulation: fire a random agent ─────────────────────────────
    function fireDemoEvent() {
      const eligibleAgents = AGENT_DEFS
        .filter(d => d.id !== 'GUARDIAN' && d.id !== 'NEXUS')
      const def = eligibleAgents[Math.floor(Math.random() * eligibleAgents.length)]
      if (!def) return

      const orb = orbsRef.current.get(def.id)
      if (!orb || orb.state !== 'IDLE') return
      const target = pickTarget(def.id)
      if (target) orb.dispatchTo(target)
    }

    // ── Collect cubes dropped by returning orbs ───────────────────────────
    function collectDroppedCubes(agentId: string) {
      // Look for any loose cubes near home position (scene children)
      const def = AGENT_DEFS.find(d => d.id === agentId)
      if (!def || !def.primaryDomainId) return
      const zone = domainsRef.current.get(def.primaryDomainId)
      if (!zone) return
      const cubes = domainCubesRef.current.get(def.primaryDomainId) ?? []

      // The orb dropped its cube into the scene at world position — find scene objects
      // that are BoxGeometry meshes near the domain and adopt them
      scene.children
        .filter(obj => {
          if (!(obj instanceof THREE.Mesh)) return false
          const mesh = obj as THREE.Mesh
          if (!(mesh.geometry instanceof THREE.BoxGeometry)) return false
          const dx = Math.abs(obj.position.x - def.homeX)
          const dz = Math.abs(obj.position.z - def.homeZ)
          return dx < 20 && dz < 20
        })
        .forEach(obj => {
          const mesh = obj as THREE.Mesh
          // Reparent to domain zone cubeDropGroup
          scene.remove(mesh)
          zone.cubeDropGroup.add(mesh)
          mesh.position.set(0, 0, 0)  // reset local pos — will be sorted in tick
          cubes.push(mesh)
        })

      // Trim to MAX_DOMAIN_CUBES
      while (cubes.length > MAX_DOMAIN_CUBES) {
        const oldest = cubes.shift()!
        if (oldest.parent) oldest.parent.remove(oldest)
      }

      domainCubesRef.current.set(def.primaryDomainId, cubes)
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────
    return () => {
      for (const { event, fn } of handlers) {
        window.removeEventListener(event, fn)
      }
      for (const zone of domainsRef.current.values()) {
        zone.dispose()
      }
      for (const orb of orbsRef.current.values()) {
        orb.dispose()
      }
      domainsRef.current.clear()
      orbsRef.current.clear()
      domainCubesRef.current.clear()
      unregisterParticles('agent-flight-trails')
    }
  }, [scene])  // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
