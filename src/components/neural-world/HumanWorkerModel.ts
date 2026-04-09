/**
 * HumanWorkerModel.ts — B75: Katsuro-based humanoid model for human workers.
 *
 * Visually distinct from AI agents (teal, flying, particle trails) — human
 * workers are AMBER/GOLD, ground-level, walking with a gentle bob animation.
 *
 * Model based on Katsuro Raijin figure (KatsuroBridgeLayer.tsx) but:
 *   - AMBER/GOLD color scheme (#FF9040 base, #FFD700 accents)
 *   - 0.6× scale of Katsuro figure
 *   - Walks along ground (y ≈ 1), no flight
 *   - Walking animation: gentle bob 0.1 unit amplitude, 0.5s cycle
 *   - Idle: slight breathing scale pulse
 *   - Name label: 12px amber text, fades at distance > 30 units
 *   - Role badge: wrench | monitor | hardhat | briefcase icons below name
 *   - Warm amber PointLight glow
 *
 * CLOCK-IN ANIMATION:
 *   Worker walks in from world edge toward assigned domain (3–4 seconds).
 *   "CLOCKED IN" popup text, domain amber pulse on arrival.
 *
 * CLOCK-OUT ANIMATION:
 *   Worker turns toward nearest world edge and walks out.
 *   "CLOCKED OUT" popup, model fades and removes itself.
 *
 * REMOTE HOLOGRAPHIC PRESENCE:
 *   Semi-transparent amber figure at domain position.
 *   Horizontal scan-line plane at 0.3 opacity, subtle flicker every 5s.
 *   Label "[Name] — REMOTE".
 *   Active: high opacity. Idle: dims to 30%.
 *
 * HYPOTHETICAL WORKERS:
 *   Ghost outline (white, 20% opacity, wireframe).
 *
 * DATA INTEGRATION:
 *   crew_assignments and field_logs via DataBridge.
 *   employee_type: 'w2' | '1099' | 'hypothetical'.
 */

import * as THREE from 'three'
import { makeLabel, disposeLabel, type NWLabel } from './utils/makeLabel'

// ── Constants ─────────────────────────────────────────────────────────────────

export const AMBER           = 0xFF9040
export const AMBER_GOLD      = 0xFFD700
export const AMBER_DARK      = 0xCC5500
export const GROUND_Y        = 1
const SCALE                  = 0.6      // 0.6× Katsuro figure scale
const BOB_AMP                = 0.1      // walk bob amplitude
const BOB_CYCLE              = 0.5      // bob cycle in seconds
const BREATH_AMP             = 0.015    // idle breathing scale delta
const BREATH_CYCLE           = 3.0      // breathing period in seconds
const WALK_SPEED             = 12       // units/second (3-4s to cross ~40 units)
const LABEL_FADE_DIST        = 30       // units — beyond this labels fade
const CLOCK_TEXT_DURATION    = 1.5      // seconds "CLOCKED IN/OUT" text visible
const DOMAIN_PULSE_DURATION  = 2.0      // seconds amber ground pulse
const FLICKER_INTERVAL       = 5.0      // seconds between holographic flickers
const WORLD_EDGE             = 220      // world boundary radius for clock-in entry

// Role badge characters (emoji-like single chars rendered on canvas)
const ROLE_BADGES: Record<string, string> = {
  'field crew':        '🔧',
  'electrician':       '🔧',
  'apprentice':        '🔧',
  'lead electrician':  '🔧',
  'office':            '🖥',
  'admin':             '🖥',
  'estimator':         '🖥',
  'scheduler':         '🖥',
  'foreman':           '⛑',
  'supervisor':        '⛑',
  'ops manager':       '⛑',
  'field manager':     '⛑',
  'project director':  '💼',
  'director':          '💼',
  'executive':         '💼',
  'c-suite':           '💼',
  'ceo':               '💼',
  'coo':               '💼',
  'cfo':               '💼',
  'owner':             '💼',
  'developer':         '🖥',
}

function getRoleBadge(role: string): string {
  const key = role.toLowerCase()
  for (const [k, v] of Object.entries(ROLE_BADGES)) {
    if (key.includes(k)) return v
  }
  return '👤'
}

// ── Worker state machine ──────────────────────────────────────────────────────

export type HumanModelState =
  | 'ENTERING'      // walking in from world edge (clock-in)
  | 'AT_DOMAIN'     // standing/idling at assigned domain
  | 'WALKING'       // walking between project mountains
  | 'EXITING'       // walking out to world edge (clock-out)
  | 'REMOVED'       // past edge — marked for disposal

export type EmployeeType = 'w2' | '1099' | 'hypothetical'

export type WorkerPresence = 'onsite' | 'remote'

export interface HumanWorkerModelConfig {
  id: string
  name: string
  role: string
  employeeType: EmployeeType
  presence: WorkerPresence
  /** World-space domain position */
  domainX: number
  domainZ: number
  /** Multiple domain targets for walking between projects */
  projectPositions?: Array<{ x: number; z: number }>
  /** True if this worker is a foreman — patrols wider area */
  isForeman: boolean
  /** Shift start time as fractional day 0–1, or null = always clocked in */
  shiftStart?: number
  /** Shift end as fractional day 0–1 */
  shiftEnd?: number
}

// ── Dispose helper ─────────────────────────────────────────────────────────────

function disposeMesh(scene: THREE.Scene, mesh: THREE.Mesh | null) {
  if (!mesh) return
  scene.remove(mesh)
  mesh.geometry?.dispose()
  const m = mesh.material
  if (Array.isArray(m)) m.forEach(x => x.dispose())
  else if (m) (m as THREE.Material).dispose()
}

// ── Build humanoid figure geometry ─────────────────────────────────────────────

function buildHumanoidGroup(cfg: HumanWorkerModelConfig): THREE.Group {
  const g = new THREE.Group()
  const s = SCALE

  const isHypo = cfg.employeeType === 'hypothetical'
  const isRemote = cfg.presence === 'remote'

  // Material factories
  const ambMat = (opacity = 1.0, wireframe = false) => new THREE.MeshLambertMaterial({
    color: AMBER,
    emissive: new THREE.Color(AMBER).multiplyScalar(0.3),
    transparent: opacity < 1 || isHypo,
    opacity: isHypo ? 0.20 : isRemote ? opacity * 0.65 : opacity,
    wireframe: isHypo || wireframe,
  })
  const goldMat = (opacity = 1.0) => new THREE.MeshLambertMaterial({
    color: AMBER_GOLD,
    emissive: new THREE.Color(AMBER_GOLD).multiplyScalar(0.5),
    transparent: opacity < 1 || isHypo,
    opacity: isHypo ? 0.20 : isRemote ? opacity * 0.65 : opacity,
    wireframe: isHypo,
  })

  // Ghost outline base color override for hypothetical
  const bodyMat  = isHypo ? new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.20, wireframe: true }) : ambMat()
  const accentMat = isHypo ? new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.20, wireframe: true }) : goldMat()

  const base = 0  // figure local origin — feet at y=0

  // Legs
  for (let side = -1; side <= 1; side += 2) {
    const legGeo = new THREE.CylinderGeometry(0.18 * s, 0.15 * s, 0.8 * s, 6)
    const leg = new THREE.Mesh(legGeo, bodyMat)
    leg.position.set(side * 0.22 * s, base + 0.4 * s, 0)
    g.add(leg)
  }

  // Torso
  const torsoGeo = new THREE.CylinderGeometry(0.3 * s, 0.25 * s, 1.0 * s, 7)
  const torso = new THREE.Mesh(torsoGeo, bodyMat)
  torso.position.set(0, base + 1.3 * s, 0)
  g.add(torso)

  // Chest accent
  const chestGeo = new THREE.BoxGeometry(0.55 * s, 0.55 * s, 0.12 * s)
  const chest = new THREE.Mesh(chestGeo, accentMat)
  chest.position.set(0, (base + 1.4) * s, 0.3 * s)
  g.add(chest)

  // Shoulders
  for (let side = -1; side <= 1; side += 2) {
    const shoulderGeo = new THREE.BoxGeometry(0.4 * s, 0.28 * s, 0.45 * s)
    const shoulder = new THREE.Mesh(shoulderGeo, accentMat)
    shoulder.position.set(side * 0.62 * s, (base + 1.7) * s, 0)
    shoulder.rotation.z = side * 0.18
    g.add(shoulder)

    const armGeo = new THREE.CylinderGeometry(0.12 * s, 0.10 * s, 0.75 * s, 5)
    const arm = new THREE.Mesh(armGeo, bodyMat)
    arm.position.set(side * 0.62 * s, (base + 1.28) * s, 0)
    arm.rotation.z = side * 0.25
    g.add(arm)
  }

  // Head
  const headGeo = new THREE.SphereGeometry(0.32 * s, 8, 6)
  const head = new THREE.Mesh(headGeo, bodyMat)
  head.position.set(0, (base + 2.15) * s, 0)
  g.add(head)

  // Hard hat / helmet ridge (amber-gold accent)
  const hatGeo = new THREE.CylinderGeometry(0.36 * s, 0.40 * s, 0.18 * s, 10)
  const hat = new THREE.Mesh(hatGeo, accentMat)
  hat.position.set(0, (base + 2.38) * s, 0)
  g.add(hat)

  // Role badge tool — small box at right hand
  if (!isHypo) {
    const toolGeo = new THREE.BoxGeometry(0.12 * s, 0.25 * s, 0.08 * s)
    const toolMat = new THREE.MeshLambertMaterial({ color: AMBER_GOLD, emissive: new THREE.Color(AMBER_GOLD).multiplyScalar(0.5) })
    const tool = new THREE.Mesh(toolGeo, toolMat)
    tool.position.set(0.75 * s, (base + 1.1) * s, 0)
    g.add(tool)
  }

  return g
}

// ── Build scan-line plane for remote holographic effect ────────────────────────

function buildScanlinePlane(height: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1.2, height)
  const mat = new THREE.MeshBasicMaterial({
    color: AMBER,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const plane = new THREE.Mesh(geo, mat)
  plane.rotation.x = -Math.PI / 2
  return plane
}

// ── Build floating label with role badge ──────────────────────────────────────

function buildLabelCanvas(name: string, role: string, isRemote: boolean): HTMLCanvasElement {
  const badge = getRoleBadge(role)
  const displayName = isRemote ? `${name} — REMOTE` : name
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 48
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 256, 48)
  ctx.font = '12px monospace'
  ctx.fillStyle = '#FF9040'
  ctx.textAlign = 'center'
  ctx.fillText(badge + ' ' + displayName, 128, 18)
  ctx.font = '10px monospace'
  ctx.fillStyle = 'rgba(255,144,64,0.65)'
  ctx.fillText(role, 128, 34)
  return canvas
}

// ── Build domain ground pulse ring ────────────────────────────────────────────

function buildPulseRing(): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.5, 4, 32)
  const mat = new THREE.MeshBasicMaterial({
    color: AMBER,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const ring = new THREE.Mesh(geo, mat)
  ring.rotation.x = -Math.PI / 2
  return ring
}

// ── Build clock-in/out popup text sprite ──────────────────────────────────────

function buildClockSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 200
  canvas.height = 36
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 200, 36)
  ctx.font = 'bold 14px monospace'
  ctx.fillStyle = '#FFD700'
  ctx.textAlign = 'center'
  ctx.fillText(text, 100, 22)
  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 1.0, depthWrite: false })
  return new THREE.Sprite(mat)
}

// ── Main class ────────────────────────────────────────────────────────────────

export class HumanWorkerModelInstance {
  private scene: THREE.Scene
  readonly cfg: HumanWorkerModelConfig

  // Three.js objects
  readonly group: THREE.Group          // root at world position
  private figureGroup: THREE.Group     // humanoid figure sub-group
  private light: THREE.PointLight
  private label: NWLabel
  private scanlinePlane: THREE.Mesh | null = null
  private pulseRing: THREE.Mesh | null = null
  private clockSprite: THREE.Sprite | null = null

  // State machine
  state: HumanModelState
  private elapsed = 0
  private walkFrom = new THREE.Vector3()
  private walkTo   = new THREE.Vector3()
  private walkDur  = 0
  private walkT    = 0
  private stayTimer = 0
  private stayDur   = 30 + Math.random() * 10
  private projectIdx = 0

  // Clock-in/out
  private clockTextTimer = 0
  private clockTextActive = false
  private pulseTimer = 0
  private pulseActive = false

  // Remote holographic
  private flickerTimer = 0
  private isActivelyWorking = false

  // Walking bob phase
  private bobPhase = Math.random() * Math.PI * 2
  private breathPhase = Math.random() * Math.PI * 2

  // Visibility
  visible = true

  constructor(scene: THREE.Scene, cfg: HumanWorkerModelConfig) {
    this.scene = scene
    this.cfg   = cfg

    // Build groups
    this.figureGroup = buildHumanoidGroup(cfg)

    this.group = new THREE.Group()
    this.group.add(this.figureGroup)

    // Warm amber point light
    this.light = new THREE.PointLight(AMBER, cfg.presence === 'remote' ? 0.6 : 1.0, 12)
    this.group.add(this.light)

    // Name label
    this.label = makeLabel(
      cfg.presence === 'remote' ? `${cfg.name} — REMOTE` : cfg.name,
      '#FF9040',
      { fontSize: 12, labelType: 'agent' },
    )
    const figTop = 2.6 * SCALE
    this.label.position.set(0, figTop + 0.8, 0)
    this.group.add(this.label)

    // Remote holographic extras
    if (cfg.presence === 'remote') {
      this.scanlinePlane = buildScanlinePlane(2.6 * SCALE)
      this.scanlinePlane.position.y = (2.6 * SCALE) / 2
      this.group.add(this.scanlinePlane)
    }

    // Determine initial state and position
    if (cfg.presence === 'remote') {
      // Place at domain immediately — no walk-in
      this.group.position.set(cfg.domainX, GROUND_Y, cfg.domainZ)
      this.state = 'AT_DOMAIN'
    } else {
      // Clock-in: start at world edge, walk toward domain
      const entryPt = this._worldEdgeEntry(cfg.domainX, cfg.domainZ)
      this.group.position.set(entryPt.x, GROUND_Y, entryPt.z)
      this.state = 'ENTERING'
      this._startWalk(entryPt, new THREE.Vector3(cfg.domainX, GROUND_Y, cfg.domainZ))
      // Show "CLOCKED IN" text
      this._showClockText('▶ CLOCKED IN')
    }

    scene.add(this.group)
  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  tick(dt: number, camera: THREE.PerspectiveCamera): void {
    if (!this.visible || this.state === 'REMOVED') {
      this.group.visible = false
      return
    }
    this.group.visible = true
    this.elapsed += dt

    // Update label visibility based on camera distance
    const worldPos = new THREE.Vector3()
    this.group.getWorldPosition(worldPos)
    const camDist = camera.position.distanceTo(worldPos)
    if (this.label) {
      const labelMat = this.label.material as THREE.SpriteMaterial
      labelMat.opacity = camDist > LABEL_FADE_DIST
        ? Math.max(0, 1 - (camDist - LABEL_FADE_DIST) / 15)
        : 1.0
    }

    // Update label face camera
    this.label.updateVisibility(camera, worldPos)

    switch (this.state) {
      case 'ENTERING':   this._tickEntering(dt); break
      case 'AT_DOMAIN':  this._tickAtDomain(dt); break
      case 'WALKING':    this._tickWalking(dt); break
      case 'EXITING':    this._tickExiting(dt); break
    }

    // Clock text sprite update
    if (this.clockTextActive && this.clockSprite) {
      this.clockTextTimer -= dt
      if (this.clockTextTimer <= 0) {
        this._removeClockSprite()
      } else {
        const fadeFraction = this.clockTextTimer / CLOCK_TEXT_DURATION
        ;(this.clockSprite.material as THREE.SpriteMaterial).opacity = fadeFraction
        // Float upward slightly
        this.clockSprite.position.y += dt * 0.4
      }
    }

    // Domain pulse ring update
    if (this.pulseActive && this.pulseRing) {
      this.pulseTimer -= dt
      const frac = 1 - this.pulseTimer / DOMAIN_PULSE_DURATION
      const scale = 1 + frac * 3
      this.pulseRing.scale.set(scale, scale, scale)
      ;(this.pulseRing.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - frac)
      if (this.pulseTimer <= 0) {
        this._removePulseRing()
      }
    }

    // Remote flicker effect
    if (this.cfg.presence === 'remote') {
      this._tickRemoteHolographic(dt)
    }
  }

  /** Trigger clock-out sequence — worker walks to nearest world edge and fades out. */
  clockOut(): void {
    if (this.state === 'EXITING' || this.state === 'REMOVED') return
    this._showClockText('◀ CLOCKED OUT')
    const edgePt = this._worldEdgeExit()
    this._startWalk(this.group.position.clone(), edgePt)
    this.state = 'EXITING'
  }

  /** Mark worker as actively working (field_log active) — brightens remote figure. */
  setActivelyWorking(active: boolean): void {
    this.isActivelyWorking = active
    if (this.cfg.presence === 'remote') {
      this._updateRemoteOpacity()
    }
  }

  dispose(): void {
    this._removeClockSprite()
    this._removePulseRing()
    disposeLabel(this.label)
    if (this.scanlinePlane) {
      this.group.remove(this.scanlinePlane)
      this.scanlinePlane.geometry.dispose()
      ;(this.scanlinePlane.material as THREE.Material).dispose()
      this.scanlinePlane = null
    }
    this.figureGroup.traverse(child => {
      const m = child as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material
      if (Array.isArray(mat)) mat.forEach(x => (x as THREE.Material).dispose())
      else if (mat) (mat as THREE.Material).dispose()
    })
    this.scene.remove(this.group)
  }

  // ── State tickers ─────────────────────────────────────────────────────────

  private _tickEntering(dt: number): void {
    this._animateWalk(dt)
    if (this.walkT >= 1) {
      // Arrived at domain
      this.state = 'AT_DOMAIN'
      this._spawnDomainPulse()
      this._scheduleNextMove()
    }
  }

  private _tickAtDomain(dt: number): void {
    // Breathing idle animation
    this._applyBreathing(dt)
    // Count down to next project walk
    this.stayTimer -= dt
    if (this.stayTimer <= 0 && this.cfg.projectPositions && this.cfg.projectPositions.length > 0) {
      this._walkToNextProject()
    }
  }

  private _tickWalking(dt: number): void {
    this._animateWalk(dt)
    this._applyWalkBob(dt)
    if (this.walkT >= 1) {
      this.state = 'AT_DOMAIN'
      this._scheduleNextMove()
    }
  }

  private _tickExiting(dt: number): void {
    this._animateWalk(dt)
    this._applyWalkBob(dt)
    // Fade out as approaching edge
    const distToTarget = this.group.position.distanceTo(this.walkTo)
    const totalDist = this.walkFrom.distanceTo(this.walkTo)
    const frac = totalDist > 0 ? distToTarget / totalDist : 0
    this.figureGroup.traverse(child => {
      const m = child as THREE.Mesh
      const mat = m.material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial
      if (mat && 'opacity' in mat) mat.opacity = Math.max(0, frac * 0.9)
    })
    if (this.label) {
      ;(this.label.material as THREE.SpriteMaterial).opacity = Math.max(0, frac)
    }
    if (this.walkT >= 1) {
      this.state = 'REMOVED'
    }
  }

  // ── Animation helpers ─────────────────────────────────────────────────────

  private _animateWalk(dt: number): void {
    const dist = this.walkFrom.distanceTo(this.walkTo)
    if (dist < 0.01) { this.walkT = 1; return }
    this.walkT = Math.min(1, this.walkT + dt * WALK_SPEED / dist)
    const x = this.walkFrom.x + (this.walkTo.x - this.walkFrom.x) * this.walkT
    const z = this.walkFrom.z + (this.walkTo.z - this.walkFrom.z) * this.walkT
    this.group.position.set(x, GROUND_Y, z)
    // Orient toward destination
    const dx = this.walkTo.x - this.walkFrom.x
    const dz = this.walkTo.z - this.walkFrom.z
    if (Math.abs(dx) + Math.abs(dz) > 0.01) {
      this.group.rotation.y = Math.atan2(dx, dz)
    }
  }

  private _applyWalkBob(dt: number): void {
    this.bobPhase += dt * (Math.PI * 2) / BOB_CYCLE
    const bob = Math.sin(this.bobPhase) * BOB_AMP
    this.figureGroup.position.y = bob
  }

  private _applyBreathing(dt: number): void {
    this.breathPhase += dt * (Math.PI * 2) / BREATH_CYCLE
    const breathScale = 1 + Math.sin(this.breathPhase) * BREATH_AMP
    this.figureGroup.scale.setScalar(breathScale)
    this.light.intensity = 0.8 + Math.sin(this.breathPhase * 0.5) * 0.2
  }

  // ── Movement helpers ──────────────────────────────────────────────────────

  private _startWalk(from: THREE.Vector3, to: THREE.Vector3): void {
    this.walkFrom.copy(from)
    this.walkTo.copy(to)
    const dist = from.distanceTo(to)
    this.walkDur = Math.max(0.5, dist / WALK_SPEED)
    this.walkT = 0
  }

  private _scheduleNextMove(): void {
    this.stayTimer = this.stayDur + Math.random() * 10
  }

  private _walkToNextProject(): void {
    const positions = this.cfg.projectPositions!
    if (positions.length === 0) return
    // Foremen patrol through multiple positions; others pick random
    if (this.cfg.isForeman) {
      this.projectIdx = (this.projectIdx + 1) % positions.length
    } else {
      this.projectIdx = Math.floor(Math.random() * positions.length)
    }
    const target = positions[this.projectIdx]
    const targetVec = new THREE.Vector3(
      target.x + (Math.random() - 0.5) * 4,
      GROUND_Y,
      target.z + (Math.random() - 0.5) * 4,
    )
    this._startWalk(this.group.position.clone(), targetVec)
    this.state = 'WALKING'
  }

  // ── World edge helpers ────────────────────────────────────────────────────

  private _worldEdgeEntry(targetX: number, targetZ: number): THREE.Vector3 {
    // Find the nearest world boundary in the direction away from target
    const angle = Math.atan2(targetZ, targetX)
    return new THREE.Vector3(
      Math.cos(angle) * WORLD_EDGE,
      GROUND_Y,
      Math.sin(angle) * WORLD_EDGE,
    )
  }

  private _worldEdgeExit(): THREE.Vector3 {
    // Walk toward nearest edge from current position
    const pos = this.group.position
    const angle = Math.atan2(pos.z, pos.x)
    return new THREE.Vector3(
      Math.cos(angle) * (WORLD_EDGE + 10),
      GROUND_Y,
      Math.sin(angle) * (WORLD_EDGE + 10),
    )
  }

  // ── Clock text sprite ─────────────────────────────────────────────────────

  private _showClockText(text: string): void {
    this._removeClockSprite()
    const sprite = buildClockSprite(text)
    sprite.scale.set(6, 1.2, 1)
    const figTop = 2.6 * SCALE
    sprite.position.set(
      this.group.position.x,
      GROUND_Y + figTop + 1.5,
      this.group.position.z,
    )
    this.scene.add(sprite)
    this.clockSprite = sprite
    this.clockTextTimer = CLOCK_TEXT_DURATION
    this.clockTextActive = true
  }

  private _removeClockSprite(): void {
    if (!this.clockSprite) return
    this.scene.remove(this.clockSprite)
    ;(this.clockSprite.material as THREE.SpriteMaterial).map?.dispose()
    ;(this.clockSprite.material as THREE.SpriteMaterial).dispose()
    this.clockSprite = null
    this.clockTextActive = false
  }

  // ── Domain pulse ring ─────────────────────────────────────────────────────

  private _spawnDomainPulse(): void {
    this._removePulseRing()
    const ring = buildPulseRing()
    ring.position.set(this.group.position.x, 0.05, this.group.position.z)
    this.scene.add(ring)
    this.pulseRing = ring
    this.pulseTimer = DOMAIN_PULSE_DURATION
    this.pulseActive = true
  }

  private _removePulseRing(): void {
    if (!this.pulseRing) return
    this.scene.remove(this.pulseRing)
    this.pulseRing.geometry.dispose()
    ;(this.pulseRing.material as THREE.Material).dispose()
    this.pulseRing = null
    this.pulseActive = false
  }

  // ── Remote holographic ────────────────────────────────────────────────────

  private _tickRemoteHolographic(dt: number): void {
    this.flickerTimer -= dt
    if (this.flickerTimer <= 0) {
      this.flickerTimer = FLICKER_INTERVAL + Math.random() * 2
      // Brief flicker: drop then restore opacity
      this._flickerOnce()
    }
  }

  private _flickerOnce(): void {
    // Quick opacity drop then restore
    const origOpacity = this.isActivelyWorking ? 0.65 : 0.22
    this.figureGroup.traverse(child => {
      const m = child as THREE.Mesh
      const mat = m.material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial | undefined
      if (mat && 'opacity' in mat) {
        const savedOp = mat.opacity
        mat.opacity = 0.05
        setTimeout(() => {
          if (mat && 'opacity' in mat) mat.opacity = savedOp
        }, 80)
      }
    })
    if (this.scanlinePlane) {
      const smat = this.scanlinePlane.material as THREE.MeshBasicMaterial
      const savedOp = smat.opacity
      smat.opacity = 0.35
      setTimeout(() => { smat.opacity = savedOp }, 80)
    }
    void origOpacity
  }

  private _updateRemoteOpacity(): void {
    const targetOpacity = this.isActivelyWorking ? 0.65 : 0.22
    this.figureGroup.traverse(child => {
      const m = child as THREE.Mesh
      const mat = m.material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial | undefined
      if (mat && 'opacity' in mat) mat.opacity = targetOpacity
    })
    this.light.intensity = this.isActivelyWorking ? 0.8 : 0.2
    if (this.scanlinePlane) {
      ;(this.scanlinePlane.material as THREE.MeshBasicMaterial).opacity = this.isActivelyWorking ? 0.18 : 0.06
    }
  }
}
