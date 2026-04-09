/**
 * AgentFlightLayer.tsx — NW29: NEXUS orchestration sweep, GUARDIAN perimeter patrol,
 *   flight analytics log.
 *
 * NW28 base: Domain zones + flying agent orbs + task cycles + data cubes.
 * NW29 additions:
 *   - NEXUS sweep state machine (every 45 seconds):
 *       OPERATOR → OHM → VAULT → LEDGER → SPARK → BLUEPRINT → SCOUT → OPERATOR
 *       Collects a ring of domain cubes; on landing merges into briefing sphere
 *   - Brighter + wider NEXUS trail during sweep
 *   - Golden tether line: NEXUS ↔ OPERATOR monument at all times
 *   - Cube ring on NEXUS rotates; red warning cubes orbit faster + flash
 *   - GUARDIAN perimeter patrol (full rectangle around both continents, y=15)
 *       On nw:security-event: sprint to NDA gate, flash red 5s, resume patrol
 *   - In-memory flight log (appendFlightLog) for analytics
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
import { appendFlightLog } from '../flightLog'
import type { SweepBriefingData } from '../NexusSweepController'
import { queryFogDensityAt } from './FogDomainLayer'

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

export const DOMAIN_DEFS: DomainZoneConfig[] = [
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

// ── OPERATOR monument position (NEXUS home) ───────────────────────────────────

const OPERATOR_POS = new THREE.Vector3(0, 0, 0)

// ── NEXUS sweep domain sequence ───────────────────────────────────────────────

interface SweepStop {
  domainId:  string
  cubeColor: number   // color for collected cube
  isWarning: boolean  // red warning cube (payment overdue / compliance alert)
  label:     string
}

const SWEEP_SEQUENCE: SweepStop[] = [
  { domainId: 'compliance',       cubeColor: 0xFF9040, isWarning: false, label: 'OHM' },
  { domainId: 'material-takeoff', cubeColor: 0xFFD24A, isWarning: false, label: 'VAULT' },
  { domainId: 'revenue',          cubeColor: 0x2EE89A, isWarning: true,  label: 'LEDGER' },  // payment warning
  { domainId: 'lead-acquisition', cubeColor: 0xFFE040, isWarning: false, label: 'SPARK' },
  { domainId: 'project-installation', cubeColor: 0x3A8EFF, isWarning: false, label: 'BLUEPRINT' },
  { domainId: 'analysis',         cubeColor: 0x40D4FF, isWarning: false, label: 'SCOUT' },
]

const NEXUS_SWEEP_INTERVAL = 45    // seconds between sweeps
const NEXUS_SWEEP_CRUISE_Y = 30    // altitude during sweep
const NEXUS_HOVER_DWELL    = 2     // seconds hover at each domain
const RING_ORBIT_RADIUS    = 3.5   // radius of cube ring around NEXUS
const RING_ORBIT_SPEED     = 1.2   // rad/s — normal cubes
const RING_ORBIT_FAST      = 3.5   // rad/s — warning cubes (faster)
const NEXUS_SWEEP_SPEED    = 12    // u/s during sweep (faster than normal 8)
const MAX_DOMAIN_CUBES     = 10

// ── GUARDIAN rectangle perimeter waypoints ────────────────────────────────────
// Rectangle enclosing both continents with rounded corner approach

const GUARDIAN_Y          = 15     // patrol altitude
const GUARDIAN_SPEED      = 3      // u/s normal patrol
const GUARDIAN_SPRINT_SPD = 15     // u/s during security event

// Perimeter waypoints (rounded rectangle approximation via extra corner points)
const GUARDIAN_PATH: THREE.Vector3[] = (() => {
  // Rectangle: X[-210, 210] Z[-195, 165]
  const x0 = -210, x1 = 210
  const z0 = -195, z1 = 165
  const cr = 25   // corner rounding offset
  const y  = GUARDIAN_Y
  return [
    new THREE.Vector3(x0 + cr, y, z0),
    new THREE.Vector3(x1 - cr, y, z0),
    new THREE.Vector3(x1,      y, z0 + cr),
    new THREE.Vector3(x1,      y, z1 - cr),
    new THREE.Vector3(x1 - cr, y, z1),
    new THREE.Vector3(x0 + cr, y, z1),
    new THREE.Vector3(x0,      y, z1 - cr),
    new THREE.Vector3(x0,      y, z0 + cr),
  ]
})()

// ── Props ─────────────────────────────────────────────────────────────────────

interface AgentFlightLayerProps {
  visible: boolean
}

// ── Internal sweep state ──────────────────────────────────────────────────────

type NexusSweepPhase =
  | 'IDLE'
  | 'LIFTING'
  | 'FLYING_TO_STOP'
  | 'HOVERING'
  | 'RETURNING_HOME'
  | 'MERGING'
  | 'BRIEFING'

interface NexusSweepState {
  phase:        NexusSweepPhase
  timer:        number           // countdown to next sweep (IDLE) or phase dwell (HOVERING)
  stopIndex:    number           // current index in SWEEP_SEQUENCE
  ringCubes:    THREE.Mesh[]     // cubes orbiting NEXUS
  ringAngles:   number[]         // current angle per cube in the ring
  flightCurve:  THREE.CatmullRomCurve3 | null
  flightDur:    number
  flightElapsed:number
  briefSphere:  THREE.Mesh | null
  briefTimer:   number
  sweepCount:   number           // increments on each completed sweep
  liftTimer:    number
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
  // NW40: World speed factor from ResonanceOrb
  const worldSpeedRef = useRef<number>(1.0)
  // NW42: adaptive color temperature — brightness + warm/cool factors
  const colorTempBrightRef = useRef<number>(1.0)
  const colorTempWarmRef   = useRef<number>(0.5)
  const colorTempCoolRef   = useRef<number>(0.5)
  useEffect(() => {
    function onSpeedFactor(e: Event) {
      const ev = e as CustomEvent<{ factor: number }>
      if (ev.detail?.factor !== undefined) worldSpeedRef.current = ev.detail.factor
    }
    window.addEventListener('nw:world-speed-factor', onSpeedFactor)
    return () => window.removeEventListener('nw:world-speed-factor', onSpeedFactor)
  }, [])
  // NW42: listen for color temperature events
  useEffect(() => {
    function onColorTemp(e: Event) {
      const ev = e as CustomEvent<{ brightness_factor?: number; warm_factor?: number; cool_factor?: number }>
      if (typeof ev.detail?.brightness_factor === 'number') colorTempBrightRef.current = ev.detail.brightness_factor
      if (typeof ev.detail?.warm_factor  === 'number') colorTempWarmRef.current  = ev.detail.warm_factor
      if (typeof ev.detail?.cool_factor  === 'number') colorTempCoolRef.current  = ev.detail.cool_factor
    }
    window.addEventListener('nw:color-temperature', onColorTemp)
    return () => window.removeEventListener('nw:color-temperature', onColorTemp)
  }, [])
  const agentTimersRef = useRef<Map<string, number>>(new Map())
  // NW31: track per-orb fog opacity for smooth fade
  const orbFogOpacityRef = useRef<Map<string, number>>(new Map())

  // NEXUS sweep state
  const nexusSweepRef = useRef<NexusSweepState>({
    phase:         'IDLE',
    timer:         NEXUS_SWEEP_INTERVAL * 0.5,  // first sweep half-interval in
    stopIndex:     0,
    ringCubes:     [],
    ringAngles:    [],
    flightCurve:   null,
    flightDur:     0,
    flightElapsed: 0,
    briefSphere:   null,
    briefTimer:    0,
    sweepCount:    0,
    liftTimer:     0,
  })

  // Tether line: NEXUS ↔ OPERATOR
  const tetherLineRef = useRef<THREE.Line | null>(null)

  // GUARDIAN perimeter patrol
  const guardianPatrolRef = useRef({
    waypointIdx: 0,
    flashing:    false,
    flashTimer:  0,
    sprinting:   false,
    sprintTarget: NDA_GATE.clone(),
  })

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

    // ── 3. Create NEXUS tether line ─────────────────────────────────────────
    const tetherGeo = new THREE.BufferGeometry()
    // Two points: NEXUS pos + OPERATOR pos (updated each frame)
    const tetherPositions = new Float32Array(6)
    tetherGeo.setAttribute('position', new THREE.BufferAttribute(tetherPositions, 3))
    const tetherMat = new THREE.LineBasicMaterial({
      color:       0xFFD24A,
      transparent: true,
      opacity:     0.35,
      linewidth:   1,  // note: linewidth >1 only works with LineMaterial (WebGL limitation)
    })
    const tetherLine = new THREE.Line(tetherGeo, tetherMat)
    scene.add(tetherLine)
    tetherLineRef.current = tetherLine

    // ── 4. Event listeners ──────────────────────────────────────────────────
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
      if (!visibleRef.current) return
      const patrol = guardianPatrolRef.current
      patrol.sprinting  = true
      patrol.flashing   = true
      patrol.flashTimer = 5
    }
    window.addEventListener('nw:security-event', guardianSecHandler)
    handlers.push({ event: 'nw:security-event', fn: guardianSecHandler })

    // Particle budget reduction
    const reduceHandler: EventListener = () => {
      // Already managed by ParticleManager limits — no extra action needed
    }
    window.addEventListener('nw:reduce-particles', reduceHandler)
    handlers.push({ event: 'nw:reduce-particles', fn: reduceHandler })

    // ── 5. Animation frame ──────────────────────────────────────────────────
    let lastFrameTime = performance.now() / 1000

    function onFrame() {
      const now   = performance.now() / 1000
      const dt    = Math.min(0.05, now - lastFrameTime) * worldSpeedRef.current
      lastFrameTime = now
      clockRef.current += dt

      const vis = visibleRef.current

      // Toggle all domain zones
      for (const zone of domainsRef.current.values()) {
        zone.group.visible = vis
      }

      if (!vis) {
        for (const orb of orbsRef.current.values()) {
          orb.visible = false
        }
        if (tetherLineRef.current) tetherLineRef.current.visible = false
        return
      }

      if (tetherLineRef.current) tetherLineRef.current.visible = true

      // ── GUARDIAN continuous perimeter patrol ────────────────────────────
      tickGuardianPatrol(dt, now)

      // ── NEXUS sweep state machine ────────────────────────────────────────
      tickNexusSweep(dt, now)

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

      // ── Tick all orbs (except GUARDIAN — patrolled separately) ───────────
      for (const [agentId, orb] of orbsRef.current.entries()) {
        if (agentId === 'GUARDIAN') continue
        if (agentId === 'NEXUS') continue  // NEXUS managed by sweep machine
        orb.visible = vis
        const prevState = orb.state
        orb.tick(dt, now)

        // Record state transitions to flight log
        if (prevState !== orb.state) {
          appendFlightLog({
            agent:     agentId,
            state:     orb.state,
            target:    orb.state === 'TASKED'
              ? AGENT_DEFS.find(d => d.id === agentId)?.primaryDomainId ?? null
              : null,
            timestamp: now,
          })
        }

        // When orb transitions RETURNING→IDLE, collect the dropped cube
        if (prevState === 'RETURNING' && orb.state === 'IDLE') {
          collectDroppedCubes(agentId)
        }

        // NW31: Fog interaction — fade orb when passing through dense fog
        if (orb.state === 'TASKED' || orb.state === 'RETURNING') {
          const pos = orb.group.position
          const fogDensity = queryFogDensityAt(pos.x, pos.z)
          const prevFogOp = orbFogOpacityRef.current.get(agentId) ?? 1.0
          // Target opacity: 1.0 at no fog, 0.3 at full fog
          const targetOp = 1.0 - fogDensity * 0.7
          // Smooth transition: approach target at ~0.5 per second
          const newOp = prevFogOp + (targetOp - prevFogOp) * Math.min(1, dt * 0.5)
          orbFogOpacityRef.current.set(agentId, newOp)

          // Apply opacity to orb group children
          orb.group.traverse(child => {
            const mesh = child as THREE.Mesh
            if (mesh.material) {
              const mat = mesh.material as THREE.MeshBasicMaterial | THREE.MeshLambertMaterial
              if ('opacity' in mat) {
                mat.transparent = true
                const baseOp = (mat as unknown as Record<string, number | undefined>)._baseOp
                mat.opacity = Math.max(0.08, newOp * (baseOp !== undefined ? baseOp : 1.0))
              }
            }
          })

          // Dispatch fog passthrough event for ripple effect (only when entering dense fog)
          if (fogDensity > 0.3 && prevFogOp > 0.6) {
            window.dispatchEvent(new CustomEvent('nw:fog-agent-passthrough', {
              detail: { agentId, x: pos.x, z: pos.z },
            }))
          }
        } else {
          // IDLE: restore full opacity
          const prevOp = orbFogOpacityRef.current.get(agentId) ?? 1.0
          if (prevOp < 0.99) {
            const restoredOp = prevOp + (1.0 - prevOp) * Math.min(1, dt * 0.5)
            orbFogOpacityRef.current.set(agentId, restoredOp)
            orb.group.traverse(child => {
              const mesh = child as THREE.Mesh
              if (mesh.material) {
                const mat = mesh.material as THREE.MeshBasicMaterial | THREE.MeshLambertMaterial
                if ('opacity' in mat && mat.transparent) {
                  mat.opacity = Math.min(1, restoredOp)
                }
              }
            })
          }
        }
      }

      // ── Animate domain cube stacks ───────────────────────────────────────
      for (const [domainId, cubes] of domainCubesRef.current.entries()) {
        const zone = domainsRef.current.get(domainId)
        if (!zone) continue
        cubes.forEach((cube, idx) => {
          cube.position.y = 0.5 + idx * 0.6
          cube.rotation.y += dt * 0.4
          cube.rotation.x += dt * 0.2
        })
      }
    }

    window.addEventListener('nw:frame', onFrame)
    handlers.push({ event: 'nw:frame', fn: onFrame as EventListener })

    // ── GUARDIAN perimeter patrol ─────────────────────────────────────────
    function tickGuardianPatrol(dt: number, _now: number) {
      const guardian = orbsRef.current.get('GUARDIAN')
      if (!guardian) return
      guardian.visible = visibleRef.current

      const patrol = guardianPatrolRef.current

      // Flash logic (security event)
      if (patrol.flashing && patrol.flashTimer > 0) {
        patrol.flashTimer -= dt
        // Alternate red intensity
        const flash = Math.sin(_now * 20) > 0
        guardian.light.color.setHex(flash ? 0xFF2020 : 0xFF8080)
        guardian.light.intensity = flash ? 4.0 : 1.5

        if (patrol.flashTimer <= 0) {
          patrol.flashing    = false
          patrol.sprinting   = false
          guardian.light.color.setHex(0xFF5060)
        }
      } else {
        // Normal intensity pulse
        guardian.light.intensity = 1.2 + Math.sin(_now * 1.5) * 0.3
        guardian.light.color.setHex(0xFF5060)
      }

      // Sprint to NDA gate during security event
      if (patrol.sprinting) {
        const pos   = guardian.group.position
        const target = patrol.sprintTarget
        const dir   = target.clone().sub(pos)
        const dist  = dir.length()
        if (dist < 1) {
          // Arrived at NDA gate — stay and flash
        } else {
          dir.normalize()
          const step = GUARDIAN_SPRINT_SPD * dt
          guardian.group.position.addScaledVector(dir, Math.min(step, dist))
        }
        return
      }

      // Normal rectangle perimeter walk
      const currentWP = GUARDIAN_PATH[patrol.waypointIdx]
      const pos       = guardian.group.position
      const dir       = currentWP.clone().sub(pos)
      const dist      = dir.length()

      // Illuminate perimeter as GUARDIAN passes (PointLight already on group)
      // The PointLight radius is 20, so nearby scene objects get lit automatically.

      if (dist < 2) {
        // Advance to next waypoint
        patrol.waypointIdx = (patrol.waypointIdx + 1) % GUARDIAN_PATH.length
      } else {
        dir.normalize()
        const step = GUARDIAN_SPEED * dt
        guardian.group.position.addScaledVector(dir, step)
      }

      // Ensure y stays at patrol altitude
      guardian.group.position.y = GUARDIAN_Y
    }

    // ── NEXUS sweep state machine ─────────────────────────────────────────
    function tickNexusSweep(dt: number, now: number) {
      const nexus = orbsRef.current.get('NEXUS')
      if (!nexus) return
      nexus.visible = visibleRef.current

      const sw = nexusSweepRef.current

      // Update tether line: NEXUS ↔ OPERATOR
      if (tetherLineRef.current) {
        const positions = (tetherLineRef.current.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
        positions[0] = nexus.group.position.x
        positions[1] = nexus.group.position.y
        positions[2] = nexus.group.position.z
        positions[3] = OPERATOR_POS.x
        positions[4] = OPERATOR_POS.y + 2
        positions[5] = OPERATOR_POS.z
        tetherLineRef.current.geometry.attributes.position.needsUpdate = true

        // Pulse tether opacity
        const tetherMat = tetherLineRef.current.material as THREE.LineBasicMaterial
        tetherMat.opacity = 0.2 + Math.sin(now * 2) * 0.15
      }

      // Tick ring cubes (orbit around NEXUS)
      tickRingCubes(dt, now, nexus)

      // Tick briefing sphere
      if (sw.briefSphere) {
        sw.briefTimer -= dt
        const scale = 1 + Math.sin(now * 3) * 0.08
        sw.briefSphere.scale.setScalar(scale)
        // NW42: apply brightness factor from color temperature
        ;(sw.briefSphere.material as THREE.MeshStandardMaterial).emissiveIntensity =
          (0.8 + Math.sin(now * 4) * 0.4) * colorTempBrightRef.current
        sw.briefSphere.position.copy(nexus.group.position)
        sw.briefSphere.position.y += 2
        if (sw.briefTimer <= 0) {
          scene.remove(sw.briefSphere)
          ;(sw.briefSphere.material as THREE.MeshStandardMaterial).dispose()
          sw.briefSphere.geometry.dispose()
          sw.briefSphere = null
          sw.phase = 'IDLE'
          // Record NEXUS returning to IDLE
          appendFlightLog({ agent: 'NEXUS', state: 'IDLE', target: null, timestamp: now })
        }
        return
      }

      switch (sw.phase) {
        case 'IDLE': {
          // Normal NEXUS idle tick
          nexus.tick(dt, now)
          // Dim trail (same as other agents in IDLE)

          sw.timer -= dt
          if (sw.timer <= 0) {
            // Begin sweep: lift from OPERATOR monument to NEXUS_SWEEP_CRUISE_Y
            sw.phase       = 'LIFTING'
            sw.liftTimer   = 0
            sw.stopIndex   = 0
            appendFlightLog({ agent: 'NEXUS', state: 'TASKED', target: 'sweep', timestamp: now })
          }
          break
        }

        case 'LIFTING': {
          // NEXUS lifts from current position to y=30
          sw.liftTimer += dt
          const targetY = NEXUS_SWEEP_CRUISE_Y
          const liftDur = 1.5
          const t       = Math.min(1, sw.liftTimer / liftDur)
          const startY  = nexus.group.position.y
          nexus.group.position.y = startY + (targetY - startY) * t * 0.15  // eased
          nexus.light.intensity  = 2.0 + Math.sin(now * 5) * 0.5

          if (nexus.group.position.y >= targetY - 1 || sw.liftTimer > liftDur) {
            nexus.group.position.y = targetY
            // Start flying to first stop
            beginNexusFlight(nexus, sw, 0)
            sw.phase = 'FLYING_TO_STOP'
          }
          break
        }

        case 'FLYING_TO_STOP': {
          if (!sw.flightCurve) break
          sw.flightElapsed += dt
          const t = Math.min(1, sw.flightElapsed / sw.flightDur)
          nexus.group.position.copy(sw.flightCurve.getPoint(t))

          // Bright, wide trail during sweep
          nexus.light.intensity = 3.5 + Math.sin(now * 6) * 0.8
          // Emit extra trail particles via light pulse (visual effect via brighter glow)

          if (t >= 1) {
            sw.phase     = 'HOVERING'
            sw.timer     = NEXUS_HOVER_DWELL
            // Collect cube from this domain
            collectSweepCube(nexus, sw)
          }
          break
        }

        case 'HOVERING': {
          // Hover at domain position, bob gently
          const stop    = SWEEP_SEQUENCE[sw.stopIndex]
          const domDef  = DOMAIN_DEFS.find(d => d.id === stop.domainId)
          if (domDef) {
            nexus.group.position.x = domDef.worldX
            nexus.group.position.z = domDef.worldZ
            nexus.group.position.y = NEXUS_SWEEP_CRUISE_Y + Math.sin(now * 2) * 0.5
          }
          nexus.light.intensity = 2.5

          sw.timer -= dt
          if (sw.timer <= 0) {
            sw.stopIndex++
            if (sw.stopIndex >= SWEEP_SEQUENCE.length) {
              // All stops collected — return home
              beginNexusReturn(nexus, sw)
              sw.phase = 'RETURNING_HOME'
            } else {
              beginNexusFlight(nexus, sw, sw.stopIndex)
              sw.phase = 'FLYING_TO_STOP'
            }
          }
          break
        }

        case 'RETURNING_HOME': {
          if (!sw.flightCurve) break
          sw.flightElapsed += dt
          const t = Math.min(1, sw.flightElapsed / sw.flightDur)
          nexus.group.position.copy(sw.flightCurve.getPoint(t))
          nexus.light.intensity = 3.0

          if (t >= 1) {
            sw.phase = 'MERGING'
            sw.timer = 1.2  // brief merge animation
            sw.sweepCount++
            // Log sweep return
            appendFlightLog({ agent: 'NEXUS', state: 'RETURNING', target: 'OPERATOR', timestamp: now })
          }
          break
        }

        case 'MERGING': {
          sw.timer -= dt
          // Scale ring cubes inward toward NEXUS center
          const mergeProgress = 1 - Math.max(0, sw.timer / 1.2)
          for (let i = 0; i < sw.ringCubes.length; i++) {
            const angle  = sw.ringAngles[i]
            const radius = RING_ORBIT_RADIUS * (1 - mergeProgress)
            sw.ringCubes[i].position.set(
              Math.cos(angle) * radius,
              0,
              Math.sin(angle) * radius,
            )
            // Fade cubes out as they merge
            const mat = sw.ringCubes[i].material as THREE.MeshStandardMaterial
            mat.opacity = 1 - mergeProgress * 0.8
          }

          nexus.light.intensity = 4.0 + Math.sin(now * 15) * 1.5

          if (sw.timer <= 0) {
            // Destroy ring cubes
            clearRingCubes(nexus, sw)
            // Create briefing sphere
            createBriefingSphere(nexus, sw, now)
            sw.phase     = 'BRIEFING'
            sw.briefTimer = 10
          }
          break
        }

        case 'BRIEFING': {
          // Briefing sphere is ticked above (breaks early)
          // This case handled by briefSphere check at top
          break
        }
      }
    }

    // ── Helper: begin flight segment to a sweep stop ──────────────────────
    function beginNexusFlight(nexus: AgentOrbInstance, sw: NexusSweepState, stopIdx: number) {
      const stop   = SWEEP_SEQUENCE[stopIdx]
      const domDef = DOMAIN_DEFS.find(d => d.id === stop.domainId)
      if (!domDef) return

      const from  = nexus.group.position.clone()
      const to    = new THREE.Vector3(domDef.worldX, NEXUS_SWEEP_CRUISE_Y, domDef.worldZ)
      const midPt = new THREE.Vector3(
        (from.x + to.x) / 2,
        NEXUS_SWEEP_CRUISE_Y + 8,
        (from.z + to.z) / 2,
      )
      sw.flightCurve   = new THREE.CatmullRomCurve3([from, midPt, to])
      sw.flightDur     = Math.max(1.5, from.distanceTo(to) / NEXUS_SWEEP_SPEED)
      sw.flightElapsed = 0
    }

    // ── Helper: begin return flight to OPERATOR ───────────────────────────
    function beginNexusReturn(nexus: AgentOrbInstance, sw: NexusSweepState) {
      const from  = nexus.group.position.clone()
      const to    = new THREE.Vector3(OPERATOR_POS.x, NEXUS_SWEEP_CRUISE_Y * 0.5, OPERATOR_POS.z)
      const midPt = new THREE.Vector3(
        (from.x + to.x) / 2,
        NEXUS_SWEEP_CRUISE_Y + 8,
        (from.z + to.z) / 2,
      )
      sw.flightCurve   = new THREE.CatmullRomCurve3([from, midPt, to])
      sw.flightDur     = Math.max(2.0, from.distanceTo(to) / NEXUS_SWEEP_SPEED)
      sw.flightElapsed = 0
    }

    // ── Helper: add a cube to NEXUS ring when hovering a domain ──────────
    function collectSweepCube(nexus: AgentOrbInstance, sw: NexusSweepState) {
      const stop = SWEEP_SEQUENCE[sw.stopIndex]
      const cubeGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6)
      const cubeMat = new THREE.MeshStandardMaterial({
        color:             new THREE.Color(stop.cubeColor),
        emissive:          new THREE.Color(stop.cubeColor),
        emissiveIntensity: stop.isWarning ? 2.0 : 1.0,
        transparent:       true,
        opacity:           0.85,
      })
      const cube = new THREE.Mesh(cubeGeo, cubeMat)

      // Assign angle slot in ring
      const angle = (sw.ringCubes.length / Math.max(1, SWEEP_SEQUENCE.length)) * Math.PI * 2
      sw.ringAngles.push(angle)
      sw.ringCubes.push(cube)
      nexus.group.add(cube)
      cube.position.set(
        Math.cos(angle) * RING_ORBIT_RADIUS,
        0,
        Math.sin(angle) * RING_ORBIT_RADIUS,
      )
    }

    // ── Helper: tick ring cubes orbiting NEXUS ────────────────────────────
    function tickRingCubes(dt: number, now: number, nexus: AgentOrbInstance) {
      const sw = nexusSweepRef.current
      for (let i = 0; i < sw.ringCubes.length; i++) {
        const stop    = SWEEP_SEQUENCE[i] ?? SWEEP_SEQUENCE[0]
        const speed   = stop.isWarning ? RING_ORBIT_FAST : RING_ORBIT_SPEED
        sw.ringAngles[i] += speed * dt
        const angle = sw.ringAngles[i]

        // Warning cubes: elevate slightly, flash emissive
        const yOffset = stop.isWarning
          ? Math.sin(now * 8) * 0.4
          : Math.sin(now * 2 + i) * 0.15

        const cube = sw.ringCubes[i]
        cube.position.set(
          Math.cos(angle) * RING_ORBIT_RADIUS,
          yOffset,
          Math.sin(angle) * RING_ORBIT_RADIUS,
        )
        cube.rotation.y += dt * (stop.isWarning ? 3 : 0.8)
        cube.rotation.x += dt * 0.3

        if (stop.isWarning) {
          const mat = cube.material as THREE.MeshStandardMaterial
          mat.emissiveIntensity = 1.5 + Math.sin(now * 10) * 1.0
        }

        void nexus  // keep nexus in scope; ring cubes are children of nexus.group
      }
    }

    // ── Helper: clear all ring cubes from NEXUS ───────────────────────────
    function clearRingCubes(nexus: AgentOrbInstance, sw: NexusSweepState) {
      for (const cube of sw.ringCubes) {
        nexus.group.remove(cube)
        ;(cube.material as THREE.MeshStandardMaterial).dispose()
        cube.geometry.dispose()
      }
      sw.ringCubes  = []
      sw.ringAngles = []
    }

    // ── Helper: create briefing sphere at OPERATOR ────────────────────────
    function createBriefingSphere(nexus: AgentOrbInstance, sw: NexusSweepState, _now: number) {
      const geo = new THREE.SphereGeometry(2.2, 24, 18)
      const mat = new THREE.MeshStandardMaterial({
        color:             0xFFFFFF,
        emissive:          new THREE.Color(0x00E5CC),
        emissiveIntensity: 1.2,
        transparent:       true,
        opacity:           0.80,
      })
      const sphere = new THREE.Mesh(geo, mat)
      sphere.position.copy(nexus.group.position)
      sphere.position.y += 2
      scene.add(sphere)
      sw.briefSphere = sphere

      // Dispatch event to NexusSweepController DOM overlay
      const data: SweepBriefingData = {
        compliance: 3 + Math.floor(Math.random() * 5),
        pricing:    2 + Math.floor(Math.random() * 4),
        payments:   4 + Math.floor(Math.random() * 6),
        leads:      5 + Math.floor(Math.random() * 8),
        progress:   2 + Math.floor(Math.random() * 5),
        insights:   3 + Math.floor(Math.random() * 4),
        warnings:   1 + Math.floor(Math.random() * 3),
        sweepIndex: sw.sweepCount,
      }
      window.dispatchEvent(new CustomEvent('nw:nexus-sweep-complete', { detail: data }))

      // Reset sweep timer
      sw.timer = NEXUS_SWEEP_INTERVAL
    }

    // ── Helper: pick a target for an agent ───────────────────────────────
    function pickTarget(agentId: string): THREE.Vector3 | null {
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
      const def = AGENT_DEFS.find(d => d.id === agentId)
      if (!def || !def.primaryDomainId) return
      const zone = domainsRef.current.get(def.primaryDomainId)
      if (!zone) return
      const cubes = domainCubesRef.current.get(def.primaryDomainId) ?? []

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
          scene.remove(mesh)
          zone.cubeDropGroup.add(mesh)
          mesh.position.set(0, 0, 0)
          cubes.push(mesh)
        })

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
      // Clean up tether line
      if (tetherLineRef.current) {
        scene.remove(tetherLineRef.current)
        tetherLineRef.current.geometry.dispose()
        ;(tetherLineRef.current.material as THREE.LineBasicMaterial).dispose()
        tetherLineRef.current = null
      }
      // Clean up briefing sphere
      const sw = nexusSweepRef.current
      if (sw.briefSphere) {
        scene.remove(sw.briefSphere)
        ;(sw.briefSphere.material as THREE.MeshStandardMaterial).dispose()
        sw.briefSphere.geometry.dispose()
        sw.briefSphere = null
      }
      // Clean up ring cubes
      const nexus = orbsRef.current.get('NEXUS')
      if (nexus) {
        for (const cube of sw.ringCubes) {
          nexus.group.remove(cube)
          ;(cube.material as THREE.MeshStandardMaterial).dispose()
          cube.geometry.dispose()
        }
        sw.ringCubes  = []
        sw.ringAngles = []
      }
      domainsRef.current.clear()
      orbsRef.current.clear()
      domainCubesRef.current.clear()
      unregisterParticles('agent-flight-trails')
    }
  }, [scene])  // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
