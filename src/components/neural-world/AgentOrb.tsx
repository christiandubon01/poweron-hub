/**
 * AgentOrb.tsx — NW28: Individual agent orb state machine.
 *
 * Manages one agent orb's full lifecycle:
 *   IDLE     → hovers above home domain, slow orbit (radius 3, 20s/orbit), gentle y bob
 *   TASKED   → lifts to y=25, parabolic arc (CatmullRomCurve3) to target node,
 *               arrives, orbits tightly (radius 2) for 3–5s, data cube materializes
 *   RETURNING → arc flight back to home domain, cube detaches on arrival → IDLE
 *
 * Provides:
 *   - SphereGeometry (radius configurable) with PointLight glow
 *   - Particle trail: 50 particles × 3s fade, in agent color
 *   - Data cube: BoxGeometry 0.5, agent color, glowing on pickup
 *   - Collision avoidance: yield y+5 if another orb occupies target
 */

import * as THREE from 'three'

// ── Agent orb state ────────────────────────────────────────────────────────────

export type OrbState = 'IDLE' | 'TASKED' | 'RETURNING'

export interface AgentOrbConfig {
  id: string
  color: number      // 0xRRGGBB
  radius: number     // sphere radius (0.8 normal, 1.2 NEXUS)
  homeX: number
  homeZ: number
  homeDomainId: string | null
}

interface TrailParticle {
  mesh: THREE.Mesh
  birthTime: number
  lifetime: number   // 3s
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CRUISE_Y       = 25        // cruising altitude
const FLIGHT_SPEED   = 8        // units per second
const IDLE_ORBIT_R   = 3        // orbit radius in IDLE state
const IDLE_ORBIT_SPD = (2 * Math.PI) / 20  // radians/s — full orbit in 20s
const ARRIVE_ORBIT_R = 2        // orbit radius at target
const ARRIVE_DWELL   = 4        // seconds to orbit at target
const BOB_AMP        = 0.4      // idle y bobbing amplitude
const BOB_FREQ       = 0.5      // Hz
const TRAIL_COUNT    = 50       // particle pool size
const TRAIL_LIFE     = 3.0      // seconds per particle
const CUBE_SIZE      = 0.5

// ── Busy-node registry (shared across all orb instances) ─────────────────────

const busyNodes = new Map<string, string>() // nodeKey → agentId
function nodeKey(pos: THREE.Vector3): string {
  return `${Math.round(pos.x)}_${Math.round(pos.z)}`
}
function claimNode(pos: THREE.Vector3, agentId: string): boolean {
  const key = nodeKey(pos)
  if (busyNodes.has(key) && busyNodes.get(key) !== agentId) return false
  busyNodes.set(key, agentId)
  return true
}
function releaseNode(pos: THREE.Vector3, agentId: string): void {
  const key = nodeKey(pos)
  if (busyNodes.get(key) === agentId) busyNodes.delete(key)
}

export class AgentOrbInstance {
  private scene: THREE.Scene
  private cfg: AgentOrbConfig

  // ── Three.js objects ──────────────────────────────────────────────────────
  readonly group: THREE.Group
  private orb: THREE.Mesh
  readonly light: THREE.PointLight
  private trailParticles: TrailParticle[] = []
  private trailGeo: THREE.SphereGeometry
  private trailMat: THREE.MeshBasicMaterial
  private cube: THREE.Mesh | null = null
  private cubeGeo: THREE.BoxGeometry
  private cubeMat: THREE.MeshStandardMaterial

  // ── State machine ─────────────────────────────────────────────────────────
  state: OrbState = 'IDLE'
  private idleAngle = Math.random() * Math.PI * 2  // current orbit angle
  private dwellTime = 0     // seconds spent at target
  private flightCurve: THREE.CatmullRomCurve3 | null = null
  private flightT    = 0    // 0–1 along curve
  private flightDur  = 0    // total seconds for flight
  private flightElapsed = 0
  private waitingAtY5 = false  // collision avoidance hold

  // ── Target node ───────────────────────────────────────────────────────────
  private targetPos: THREE.Vector3 | null = null
  private homePos: THREE.Vector3

  // ── Timestamps ────────────────────────────────────────────────────────────
  private lastTrailSpawn = 0

  visible = true

  constructor(scene: THREE.Scene, cfg: AgentOrbConfig) {
    this.scene = scene
    this.cfg   = cfg

    const color = new THREE.Color(cfg.color)
    this.homePos = new THREE.Vector3(cfg.homeX, 3, cfg.homeZ)

    // ── Group ─────────────────────────────────────────────────────────────
    this.group = new THREE.Group()
    this.group.position.copy(this.homePos)

    // ── Orb sphere ────────────────────────────────────────────────────────
    const orbGeo = new THREE.SphereGeometry(cfg.radius, 16, 12)
    const orbMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.92,
    })
    this.orb = new THREE.Mesh(orbGeo, orbMat)
    this.group.add(this.orb)

    // ── Point light glow ──────────────────────────────────────────────────
    this.light = new THREE.PointLight(cfg.color, 1.5, 12)
    this.group.add(this.light)

    // ── Trail material (shared for all particles of this agent) ───────────
    this.trailGeo = new THREE.SphereGeometry(0.15, 6, 5)
    this.trailMat = new THREE.MeshBasicMaterial({
      color: cfg.color,
      transparent: true,
      opacity: 0.8,
    })

    // ── Data cube ─────────────────────────────────────────────────────────
    this.cubeGeo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE)
    this.cubeMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.75,
    })

    scene.add(this.group)
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Dispatch this agent to a target world position. No-op if already tasked. */
  dispatchTo(target: THREE.Vector3): void {
    if (this.state !== 'IDLE') return

    // Collision avoidance — check if node is busy
    if (!claimNode(target, this.cfg.id)) {
      // Wait at y+5 above home until node is free — try again next frame
      this.waitingAtY5 = true
      this.targetPos   = target
      return
    }

    this.waitingAtY5 = false
    this.targetPos   = target.clone()
    this._startFlight(this.group.position.clone(), target)
    this.state = 'TASKED'
  }

  /** Called each animation frame with elapsed time in seconds. */
  tick(dt: number, now: number): void {
    if (!this.visible) {
      this.group.visible = false
      return
    }
    this.group.visible = true

    switch (this.state) {
      case 'IDLE':    this._tickIdle(dt, now); break
      case 'TASKED':  this._tickTasked(dt, now); break
      case 'RETURNING': this._tickReturning(dt, now); break
    }

    // Tick trail particles
    this._tickTrail(dt, now)
  }

  /** Spawn a data cube attached to the orb. */
  spawnCube(): void {
    if (this.cube) return
    this.cube = new THREE.Mesh(this.cubeGeo, this.cubeMat)
    this.cube.position.set(0, -(this.cfg.radius + CUBE_SIZE * 0.7), 0)
    this.group.add(this.cube)
    // Pulse emissive briefly
    this.cubeMat.emissiveIntensity = 2.5
    setTimeout(() => { if (this.cubeMat) this.cubeMat.emissiveIntensity = 1.2 }, 400)
  }

  /** Drop cube into domain platform, returns the cube mesh for domain to manage. */
  dropCube(): THREE.Mesh | null {
    if (!this.cube) return null
    this.group.remove(this.cube)
    const dropped  = this.cube
    this.cube      = null
    // Position the cube at world coordinates of the orb
    dropped.position.copy(this.group.position)
    this.scene.add(dropped)
    return dropped
  }

  dispose(): void {
    // Release any held node
    if (this.targetPos) releaseNode(this.targetPos, this.cfg.id)
    // Remove trail particles
    for (const p of this.trailParticles) {
      this.scene.remove(p.mesh)
    }
    this.trailParticles = []
    this.trailGeo.dispose()
    this.trailMat.dispose()
    this.cubeGeo.dispose()
    this.cubeMat.dispose()
    if (this.cube) this.group.remove(this.cube)
    // Remove orb meshes
    const orbMesh = this.orb
    ;(orbMesh.material as THREE.MeshStandardMaterial).dispose()
    orbMesh.geometry.dispose()
    this.scene.remove(this.group)
  }

  // ── Private state handlers ────────────────────────────────────────────────

  private _tickIdle(dt: number, now: number): void {
    // Slow orbit around home domain center
    this.idleAngle += IDLE_ORBIT_SPD * dt
    const x = this.cfg.homeX + Math.cos(this.idleAngle) * IDLE_ORBIT_R
    const z = this.cfg.homeZ + Math.sin(this.idleAngle) * IDLE_ORBIT_R
    const y = 3 + Math.sin(now * BOB_FREQ * Math.PI * 2) * BOB_AMP
    this.group.position.set(x, y, z)

    // Dim glow in IDLE
    this.light.intensity = 0.8 + Math.sin(now * 2) * 0.2
  }

  private _tickTasked(dt: number, now: number): void {
    // Handle collision avoidance wait
    if (this.waitingAtY5 && this.targetPos) {
      if (claimNode(this.targetPos, this.cfg.id)) {
        this.waitingAtY5 = false
        this._startFlight(this.group.position.clone(), this.targetPos)
      } else {
        // Hold at current position + 5
        const hp = this.group.position
        this.group.position.set(hp.x, this.homePos.y + 5, hp.z)
        return
      }
    }

    if (!this.flightCurve) return

    this.flightElapsed += dt
    const t = Math.min(1, this.flightElapsed / this.flightDur)
    this.flightT = t

    const pos = this.flightCurve.getPoint(t)
    this.group.position.copy(pos)

    // Emit trail
    this._spawnTrailParticle(now)

    // Bright glow while flying
    this.light.intensity = 2.5

    if (t >= 1) {
      // Arrived — begin dwell orbit
      this.dwellTime = 0
      this.flightCurve = null
      this.spawnCube()
    } else if (this.dwellTime === 0 && t >= 1) {
      // never reached here — handled above
    }

    // Dwell orbit at target
    if (!this.flightCurve && this.targetPos) {
      this.dwellTime += dt
      this.idleAngle += (2 * Math.PI / 3) * dt  // fast orbit
      const tp = this.targetPos
      const x  = tp.x + Math.cos(this.idleAngle) * ARRIVE_ORBIT_R
      const z  = tp.z + Math.sin(this.idleAngle) * ARRIVE_ORBIT_R
      this.group.position.set(x, tp.y + 2, z)
      this._spawnTrailParticle(now)

      if (this.dwellTime >= ARRIVE_DWELL) {
        // Begin return
        if (this.targetPos) releaseNode(this.targetPos, this.cfg.id)
        this._startReturn()
      }
    }
  }

  private _tickReturning(dt: number, _now: number): void {
    if (!this.flightCurve) return

    this.flightElapsed += dt
    const t = Math.min(1, this.flightElapsed / this.flightDur)
    const pos = this.flightCurve.getPoint(t)
    this.group.position.copy(pos)
    this._spawnTrailParticle(_now)

    this.light.intensity = 2.0

    if (t >= 1) {
      // Arrived home — drop cube
      this.dropCube()
      this.flightCurve = null
      this.targetPos   = null
      this.state       = 'IDLE'
      this.light.intensity = 0.8
    }
  }

  private _startFlight(from: THREE.Vector3, to: THREE.Vector3): void {
    const dist   = from.distanceTo(to)
    const midPt  = new THREE.Vector3(
      (from.x + to.x) / 2,
      CRUISE_Y + 5,
      (from.z + to.z) / 2
    )
    this.flightCurve   = new THREE.CatmullRomCurve3([
      new THREE.Vector3(from.x, CRUISE_Y, from.z),
      midPt,
      new THREE.Vector3(to.x, CRUISE_Y, to.z),
    ])
    this.flightDur     = Math.max(1.5, dist / FLIGHT_SPEED)
    this.flightElapsed = 0
    this.flightT       = 0
  }

  private _startReturn(): void {
    const from = this.group.position.clone()
    const to   = new THREE.Vector3(this.cfg.homeX, 3, this.cfg.homeZ)
    this._startFlight(from, to)
    this.state = 'RETURNING'
  }

  private _spawnTrailParticle(now: number): void {
    // Throttle: max 1 particle per 60ms
    if (now - this.lastTrailSpawn < 0.06) return
    this.lastTrailSpawn = now

    // Enforce pool limit
    if (this.trailParticles.length >= TRAIL_COUNT) {
      const oldest = this.trailParticles.shift()!
      this.scene.remove(oldest.mesh)
    }

    const p = new THREE.Mesh(this.trailGeo, this.trailMat.clone())
    p.position.copy(this.group.position)
    this.scene.add(p)
    this.trailParticles.push({ mesh: p, birthTime: now, lifetime: TRAIL_LIFE })
  }

  private _tickTrail(dt: number, now: number): void {
    void dt
    const expired: TrailParticle[] = []
    for (const p of this.trailParticles) {
      const age = now - p.birthTime
      if (age >= p.lifetime) {
        expired.push(p)
      } else {
        // Fade out over lifetime
        const mat = p.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = 0.8 * (1 - age / p.lifetime)
      }
    }
    for (const p of expired) {
      this.scene.remove(p.mesh)
      ;(p.mesh.material as THREE.MeshBasicMaterial).dispose()
      this.trailParticles = this.trailParticles.filter(x => x !== p)
    }
  }
}
