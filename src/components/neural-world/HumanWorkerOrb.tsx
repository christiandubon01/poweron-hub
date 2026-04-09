/**
 * HumanWorkerOrb.tsx — NW28b: Individual human worker orb state machine.
 *
 * Mirrors AgentOrb state machine (IDLE, TASKED, RETURNING) with key differences:
 *   - Color: amber #FF9040 with warm PointLight glow
 *   - Movement: GROUND LEVEL y=1 (walking, not flying). Speed 4 u/s.
 *   - No cruising altitude. Walks along terrain surface.
 *   - Walking animation: gentle lateral sway + footstep amber particles on ground
 *   - Working time at node: 15–30 seconds (3–5× slower than AI agents)
 *   - Shift coverage: 8-hour active window; outside shift hours → 20% opacity + "OFF SHIFT"
 *   - Fatigue: after 6 completed tasks, speed drops 20%, subtle red tint
 *   - Cannot multitask: queue visible as small amber dots orbiting worker
 *   - Floating name label above (role title for simulation)
 *   - Manager behavior: larger orb + crown marker + observation visits (no data cubes)
 */

import * as THREE from 'three'
import { makeLabel, disposeLabel, type NWLabel } from './utils/makeLabel'

// ── Human worker orb state ────────────────────────────────────────────────────

export type HumanOrbState = 'IDLE' | 'TASKED' | 'RETURNING'

export interface HumanWorkerConfig {
  id: string
  name: string
  role: string
  color: number        // base amber, may tint with fatigue
  radius: number       // sphere radius (0.8 normal, 1.0 manager)
  homeX: number
  homeZ: number
  homeDomainId: string
  isManager: boolean   // managers patrol, no data cubes
  shiftStartHour: number  // 0–23 (simulated)
  shiftDurationHours: number  // default 8
}

interface FootstepParticle {
  mesh: THREE.Mesh
  birthTime: number
  lifetime: number
}

interface QueueDot {
  mesh: THREE.Mesh
  angle: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GROUND_Y          = 1          // walking altitude
const WALK_SPEED        = 4          // units per second
const FATIGUE_SPEED_MUL = 0.8        // 20% slower when fatigued
const IDLE_ORBIT_R      = 3          // orbit radius in IDLE state
const IDLE_ORBIT_SPD    = (2 * Math.PI) / 20  // full orbit in 20s
const SWAY_AMP          = 0.3        // lateral sway amplitude
const SWAY_FREQ         = 1.8        // Hz sway
const ARRIVE_DWELL_MIN  = 15         // seconds minimum work time
const ARRIVE_DWELL_RANGE = 15        // random extra dwell seconds
const FOOTSTEP_LIFE     = 1.5        // footstep particle lifetime (s)
const FATIGUE_TASK_COUNT = 6         // tasks before fatigue kicks in
const OFF_SHIFT_OPACITY = 0.2        // opacity when off shift
const AMBER             = 0xFF9040
const AMBER_FATIGUE     = 0xFF5020   // red-tinted amber when fatigued
const MANAGER_OBSERVE_TIME = 3       // seconds manager observes at each domain
const CUBE_SIZE         = 0.5
const QUEUE_DOT_RADIUS  = 0.15
const QUEUE_ORBIT_R     = 1.8

// ── Shared busy-node registry (human workers use separate one from AI) ────────

const humanBusyNodes = new Map<string, string>()
function nodeKey(pos: THREE.Vector3): string {
  return `${Math.round(pos.x)}_${Math.round(pos.z)}`
}
function claimNode(pos: THREE.Vector3, workerId: string): boolean {
  const key = nodeKey(pos)
  if (humanBusyNodes.has(key) && humanBusyNodes.get(key) !== workerId) return false
  humanBusyNodes.set(key, workerId)
  return true
}
function releaseNode(pos: THREE.Vector3, workerId: string): void {
  const key = nodeKey(pos)
  if (humanBusyNodes.get(key) === workerId) humanBusyNodes.delete(key)
}

export class HumanWorkerOrbInstance {
  private scene: THREE.Scene
  private cfg: HumanWorkerConfig

  // ── Three.js objects ──────────────────────────────────────────────────────
  readonly group: THREE.Group
  private orb: THREE.Mesh
  private orbMat: THREE.MeshStandardMaterial
  readonly light: THREE.PointLight
  private label: NWLabel
  private crownMarker: THREE.Mesh | null = null  // managers only
  private footstepParticles: FootstepParticle[] = []
  private footstepGeo: THREE.SphereGeometry
  private footstepMat: THREE.MeshBasicMaterial
  private cube: THREE.Mesh | null = null
  private queueDots: QueueDot[] = []
  private queueDotGeo: THREE.SphereGeometry
  private queueDotMat: THREE.MeshBasicMaterial

  // ── State machine ─────────────────────────────────────────────────────────
  state: HumanOrbState = 'IDLE'
  private idleAngle = Math.random() * Math.PI * 2
  private dwellTime = 0
  private walkT = 0
  private walkDur = 0
  private walkElapsed = 0
  private walkFrom = new THREE.Vector3()
  private walkTo   = new THREE.Vector3()
  private waitingForNode = false

  // ── Target node ───────────────────────────────────────────────────────────
  private targetPos: THREE.Vector3 | null = null
  private homePos: THREE.Vector3
  private pendingDwell = ARRIVE_DWELL_MIN + Math.random() * ARRIVE_DWELL_RANGE

  // ── Task queue (tasks waiting after current one) ──────────────────────────
  private taskQueue: THREE.Vector3[] = []

  // ── Fatigue tracking ──────────────────────────────────────────────────────
  private tasksCompletedThisShift = 0
  get isFatigued(): boolean { return this.tasksCompletedThisShift >= FATIGUE_TASK_COUNT }

  // ── Shift tracking ────────────────────────────────────────────────────────
  private _onShift = true
  get onShift(): boolean { return this._onShift }

  // ── Timestamps ────────────────────────────────────────────────────────────
  private lastFootstep = 0
  private swayPhase = Math.random() * Math.PI * 2

  visible = true

  constructor(scene: THREE.Scene, cfg: HumanWorkerConfig) {
    this.scene = scene
    this.cfg   = cfg

    const color = new THREE.Color(cfg.color)
    this.homePos = new THREE.Vector3(cfg.homeX, GROUND_Y, cfg.homeZ)

    // ── Group ─────────────────────────────────────────────────────────────
    this.group = new THREE.Group()
    this.group.position.copy(this.homePos)

    // ── Orb sphere ────────────────────────────────────────────────────────
    const orbGeo = new THREE.SphereGeometry(cfg.radius, 16, 12)
    this.orbMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.9,
    })
    this.orb = new THREE.Mesh(orbGeo, this.orbMat)
    this.group.add(this.orb)

    // ── Point light (warm amber glow) ──────────────────────────────────────
    this.light = new THREE.PointLight(AMBER, 1.2, 10)
    this.group.add(this.light)

    // ── Manager crown marker (slightly larger gold star shape) ────────────
    if (cfg.isManager) {
      const crownGeo = new THREE.OctahedronGeometry(cfg.radius * 0.5, 0)
      const crownMat = new THREE.MeshBasicMaterial({ color: 0xFFD700, wireframe: true })
      this.crownMarker = new THREE.Mesh(crownGeo, crownMat)
      this.crownMarker.position.set(0, cfg.radius + 0.3, 0)
      this.group.add(this.crownMarker)
    }

    // ── Footstep particles ────────────────────────────────────────────────
    this.footstepGeo = new THREE.SphereGeometry(0.1, 5, 4)
    this.footstepMat = new THREE.MeshBasicMaterial({
      color: AMBER,
      transparent: true,
      opacity: 0.7,
    })

    // ── Queue dots geometry ───────────────────────────────────────────────
    this.queueDotGeo = new THREE.SphereGeometry(QUEUE_DOT_RADIUS, 6, 4)
    this.queueDotMat = new THREE.MeshBasicMaterial({
      color: AMBER,
      transparent: true,
      opacity: 0.6,
    })

    // ── Name label ────────────────────────────────────────────────────────
    // B72: agent labels — 0.8em (1.28 world units), name only
    this.label = makeLabel(cfg.name || cfg.role, '#FF9040', { fontSize: 14, labelType: 'agent' })
    this.label.position.set(0, cfg.radius + 1.2, 0)
    this.group.add(this.label)

    scene.add(this.group)
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Queue a task destination. Worker finishes current task first. */
  queueTask(target: THREE.Vector3): void {
    if (this.state === 'IDLE' && !this.waitingForNode) {
      this._beginWalkTo(target)
    } else {
      this.taskQueue.push(target.clone())
      this._refreshQueueDots()
    }
  }

  /** Called each animation frame with elapsed time in seconds and sim time 0–1. */
  tick(dt: number, now: number, camera: THREE.PerspectiveCamera): void {
    if (!this.visible) {
      this.group.visible = false
      return
    }
    this.group.visible = true

    // Update shift state
    this._updateShift(now)

    // Update label visibility
    const wp = new THREE.Vector3()
    this.label.getWorldPosition(wp)
    this.label.updateVisibility(camera, wp)

    // Off-shift: drift to domain edge, dim
    if (!this._onShift) {
      this._applyOffShiftState()
      return
    }

    switch (this.state) {
      case 'IDLE':      this._tickIdle(dt, now); break
      case 'TASKED':    this._tickTasked(dt, now); break
      case 'RETURNING': this._tickReturning(dt, now); break
    }

    // Manager crown rotation
    if (this.crownMarker) {
      this.crownMarker.rotation.y += dt * 1.5
      this.crownMarker.rotation.x += dt * 0.5
    }

    // Update fatigue visuals
    this._updateFatigueVisuals()

    // Tick queue dots
    this._tickQueueDots(dt, now)

    // Tick footstep particles
    this._tickFootsteps(dt, now)
  }

  /** Spawn a carried cube (teal→amber handoff). */
  spawnCube(initialColor?: number): void {
    if (this.cube || this.cfg.isManager) return
    const color = initialColor ?? AMBER
    const cubeGeo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE)
    const cubeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color),
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.8,
    })
    this.cube = new THREE.Mesh(cubeGeo, cubeMat)
    this.cube.position.set(0, -(this.cfg.radius + CUBE_SIZE * 0.7), 0)
    this.group.add(this.cube)
  }

  /** Drop cube at current world position. Returns mesh for handoff. */
  dropCube(): THREE.Mesh | null {
    if (!this.cube) return null
    this.group.remove(this.cube)
    const dropped = this.cube
    this.cube = null
    dropped.position.copy(this.group.position)
    this.scene.add(dropped)
    return dropped
  }

  /** Force orb to show off-shift state immediately. */
  setOffShift(off: boolean): void {
    this._onShift = !off
  }

  dispose(): void {
    if (this.targetPos) releaseNode(this.targetPos, this.cfg.id)
    disposeLabel(this.label)
    for (const p of this.footstepParticles) {
      this.scene.remove(p.mesh)
    }
    this.footstepParticles = []
    this.footstepGeo.dispose()
    this.footstepMat.dispose()
    for (const d of this.queueDots) {
      this.scene.remove(d.mesh)
    }
    this.queueDots = []
    this.queueDotGeo.dispose()
    this.queueDotMat.dispose()
    if (this.cube) {
      this.group.remove(this.cube)
    }
    if (this.crownMarker) {
      ;(this.crownMarker.material as THREE.MeshBasicMaterial).dispose()
      this.crownMarker.geometry.dispose()
    }
    this.orbMat.dispose()
    this.orb.geometry.dispose()
    this.scene.remove(this.group)
  }

  // ── Private state handlers ────────────────────────────────────────────────

  private _tickIdle(dt: number, now: number): void {
    // Slow orbit around home domain center (ground level)
    this.idleAngle += IDLE_ORBIT_SPD * dt
    const x   = this.cfg.homeX + Math.cos(this.idleAngle) * IDLE_ORBIT_R
    const z   = this.cfg.homeZ + Math.sin(this.idleAngle) * IDLE_ORBIT_R
    const sway = Math.sin(now * SWAY_FREQ * Math.PI * 2 + this.swayPhase) * SWAY_AMP * 0.3
    this.group.position.set(x + sway, GROUND_Y, z)
    this.light.intensity = 0.7 + Math.sin(now * 1.5) * 0.15

    // Auto-dispatch next queued task
    if (this.waitingForNode && this.targetPos) {
      if (claimNode(this.targetPos, this.cfg.id)) {
        this.waitingForNode = false
        this._startWalk(this.group.position.clone(), this.targetPos)
        this.state = 'TASKED'
      }
    }
  }

  private _tickTasked(dt: number, now: number): void {
    if (this.waitingForNode && this.targetPos) {
      if (claimNode(this.targetPos, this.cfg.id)) {
        this.waitingForNode = false
        this._startWalk(this.group.position.clone(), this.targetPos)
      }
      return
    }

    // Walk to target
    if (this.walkT < 1) {
      const speed = this.isFatigued ? WALK_SPEED * FATIGUE_SPEED_MUL : WALK_SPEED
      this.walkElapsed += dt * speed / Math.max(0.1, this.walkFrom.distanceTo(this.walkTo))
      this.walkT = Math.min(1, this.walkElapsed)

      // Lateral sway during walk
      const sway = Math.sin(now * SWAY_FREQ * Math.PI * 2 + this.swayPhase) * SWAY_AMP
      const x = this.walkFrom.x + (this.walkTo.x - this.walkFrom.x) * this.walkT + sway
      const z = this.walkFrom.z + (this.walkTo.z - this.walkFrom.z) * this.walkT
      this.group.position.set(x, GROUND_Y, z)

      // Emit footstep particles
      this._spawnFootstep(now)
      this.light.intensity = 2.0

      if (this.walkT >= 1) {
        // Arrived at target — begin dwell
        this.dwellTime = 0
        this.pendingDwell = ARRIVE_DWELL_MIN + Math.random() * ARRIVE_DWELL_RANGE
        if (!this.cfg.isManager) {
          this.spawnCube()
        }
      }
    } else {
      // Dwell at target — gentle sway in place
      this.dwellTime += dt
      const tp = this.targetPos!
      const sway = Math.sin(now * SWAY_FREQ * 0.5 * Math.PI * 2 + this.swayPhase) * SWAY_AMP * 0.5
      this.group.position.set(tp.x + sway, GROUND_Y, tp.z)
      this.light.intensity = 1.5 + Math.sin(now * 3) * 0.3

      // Manager just observes
      const dwellTarget = this.cfg.isManager ? MANAGER_OBSERVE_TIME : this.pendingDwell
      if (this.dwellTime >= dwellTarget) {
        if (this.targetPos) releaseNode(this.targetPos, this.cfg.id)
        this.tasksCompletedThisShift++
        this._startReturn()
      }
    }
  }

  private _tickReturning(dt: number, now: number): void {
    if (this.walkT < 1) {
      const speed = this.isFatigued ? WALK_SPEED * FATIGUE_SPEED_MUL : WALK_SPEED
      this.walkElapsed += dt * speed / Math.max(0.1, this.walkFrom.distanceTo(this.walkTo))
      this.walkT = Math.min(1, this.walkElapsed)

      const sway = Math.sin(now * SWAY_FREQ * Math.PI * 2 + this.swayPhase) * SWAY_AMP
      const x = this.walkFrom.x + (this.walkTo.x - this.walkFrom.x) * this.walkT + sway
      const z = this.walkFrom.z + (this.walkTo.z - this.walkFrom.z) * this.walkT
      this.group.position.set(x, GROUND_Y, z)

      this._spawnFootstep(now)
      this.light.intensity = 1.5

      if (this.walkT >= 1) {
        // Arrived home
        this.dropCube()
        this.targetPos = null
        this.state = 'IDLE'
        this.light.intensity = 0.7

        // Pop next task from queue
        if (this.taskQueue.length > 0) {
          const next = this.taskQueue.shift()!
          this._refreshQueueDots()
          this._beginWalkTo(next)
        }
      }
    }
  }

  private _beginWalkTo(target: THREE.Vector3): void {
    if (!claimNode(target, this.cfg.id)) {
      this.waitingForNode = true
      this.targetPos = target.clone()
      this.state = 'TASKED'
      return
    }
    this.waitingForNode = false
    this.targetPos = target.clone()
    this._startWalk(this.group.position.clone(), target)
    this.state = 'TASKED'
  }

  private _startWalk(from: THREE.Vector3, to: THREE.Vector3): void {
    this.walkFrom.copy(from)
    this.walkTo.copy(to)
    this.walkElapsed = 0
    this.walkT = 0
    const dist = from.distanceTo(to)
    this.walkDur = Math.max(1, dist / WALK_SPEED)
  }

  private _startReturn(): void {
    const home = new THREE.Vector3(this.cfg.homeX, GROUND_Y, this.cfg.homeZ)
    this._startWalk(this.group.position.clone(), home)
    this.state = 'RETURNING'
  }

  private _spawnFootstep(now: number): void {
    if (now - this.lastFootstep < 0.25) return  // footstep every 250ms
    this.lastFootstep = now

    const p = new THREE.Mesh(this.footstepGeo, this.footstepMat.clone())
    p.position.copy(this.group.position)
    p.position.y = 0.05  // on ground
    this.scene.add(p)
    this.footstepParticles.push({ mesh: p, birthTime: now, lifetime: FOOTSTEP_LIFE })

    // Enforce pool limit
    if (this.footstepParticles.length > 30) {
      const oldest = this.footstepParticles.shift()!
      this.scene.remove(oldest.mesh)
      ;(oldest.mesh.material as THREE.MeshBasicMaterial).dispose()
    }
  }

  private _tickFootsteps(_dt: number, now: number): void {
    const expired: FootstepParticle[] = []
    for (const p of this.footstepParticles) {
      const age = now - p.birthTime
      if (age >= p.lifetime) {
        expired.push(p)
      } else {
        const mat = p.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = 0.7 * (1 - age / p.lifetime)
      }
    }
    for (const p of expired) {
      this.scene.remove(p.mesh)
      ;(p.mesh.material as THREE.MeshBasicMaterial).dispose()
      this.footstepParticles = this.footstepParticles.filter(x => x !== p)
    }
  }

  private _refreshQueueDots(): void {
    // Remove existing queue dots
    for (const d of this.queueDots) {
      this.group.remove(d.mesh)
    }
    this.queueDots = []

    // Create one dot per queued task (up to 5)
    const count = Math.min(this.taskQueue.length, 5)
    for (let i = 0; i < count; i++) {
      const dot = new THREE.Mesh(this.queueDotGeo, this.queueDotMat.clone())
      this.group.add(dot)
      this.queueDots.push({ mesh: dot, angle: (i / count) * Math.PI * 2 })
    }
  }

  private _tickQueueDots(dt: number, _now: number): void {
    for (const d of this.queueDots) {
      d.angle += dt * 2  // orbit speed
      const x = Math.cos(d.angle) * QUEUE_ORBIT_R
      const z = Math.sin(d.angle) * QUEUE_ORBIT_R
      d.mesh.position.set(x, this.cfg.radius + 0.3, z)
    }
  }

  private _updateFatigueVisuals(): void {
    if (this.isFatigued) {
      this.orbMat.color.setHex(AMBER_FATIGUE)
      this.orbMat.emissive.setHex(AMBER_FATIGUE)
    } else {
      this.orbMat.color.setHex(this.cfg.color)
      this.orbMat.emissive.setHex(this.cfg.color)
    }
  }

  private _updateShift(now: number): void {
    // Simulate shift state based on fractional time-of-day (now = absolute seconds)
    // Use a 480-second "shift window" within each 1440-second "simulated day"
    const simDay  = 1440  // simulated day in seconds
    const dayPos  = now % simDay
    const shiftStart = (this.cfg.shiftStartHour / 24) * simDay
    const shiftEnd   = shiftStart + (this.cfg.shiftDurationHours / 24) * simDay
    this._onShift = dayPos >= shiftStart && dayPos < shiftEnd
  }

  private _applyOffShiftState(): void {
    // Dim opacity, drift to domain edge
    this.orbMat.opacity = OFF_SHIFT_OPACITY
    this.light.intensity = 0.1
    // Gently drift to edge of home domain
    const edgeX = this.cfg.homeX + Math.cos(this.idleAngle) * (IDLE_ORBIT_R + 2)
    const edgeZ  = this.cfg.homeZ + Math.sin(this.idleAngle) * (IDLE_ORBIT_R + 2)
    this.group.position.lerp(new THREE.Vector3(edgeX, GROUND_Y, edgeZ), 0.005)
    this.idleAngle += 0.005
  }
}
