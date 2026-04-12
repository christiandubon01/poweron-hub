/**
 * VolcanicEventsLayer.tsx — NW68: Revenue-spike volcanic eruption events.
 *
 * When a large payment arrives or a big contract is signed, the relevant
 * project mountain erupts like a volcano — celebrating the revenue event
 * dramatically using the VIDEO GAME UX LAW.
 *
 * TRIGGERS:
 *   - Invoice payment  > $5,000  → eruption (tiered by amount)
 *   - New contract signed > $10,000 → eruption (contract scale)
 *   - Payment $1K–$5K → mini-eruption (puff of gold, 1 second, no shake)
 *
 * ERUPTION PHASES (full):
 *   1. Pre-eruption  (2s): mountain rumbles, red glow at peak, smoke rises
 *   2. Eruption      (3s): 100+ gold lava particles burst upward, screen shake,
 *                          bright flash at peak
 *   3. Lava flow     (5s): gold-orange streams flow down mountain sides
 *   4. Settlement    (3s): particles settle, mountain slightly taller (value ++)
 *
 * ERUPTION SCALE:
 *   - $5K   → SMALL   (pop)
 *   - $10K  → MEDIUM
 *   - $25K+ → FULL (camera auto-zoom to mountain)
 *
 * HISTORY: Logged to localStorage key 'nw_eruption_history_v1'.
 *          Replay any past eruption via replayEruption().
 *
 * AUDIO: rumble → explosion → sizzle (WebAudio, only when profile != SILENT)
 *
 * HUD: "ERUPTION: [Project] — $[amount] received!" banner, 5-second display.
 *
 * DATA SOURCE: DataBridge invoices (paid) + project contract events.
 *
 * Export: named export VolcanicEventsLayer (React component, no Three.js scene
 * objects — all effects are driven via Three.js scene passed through WorldContext).
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWWorldData,
  type NWInvoice,
  type NWProject,
} from './DataBridge'
import { loadProfile, type SoundProfile } from './SoundProfileManager'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PAYMENT_THRESHOLD_MINI   =  1_000   // $1K  → mini puff
const PAYMENT_THRESHOLD_SMALL  =  5_000   // $5K  → small eruption trigger
const CONTRACT_THRESHOLD       = 10_000   // $10K → contract eruption trigger
const ERUPTION_SCALE_MEDIUM    = 10_000   // $10K → medium
const ERUPTION_SCALE_FULL      = 25_000   // $25K+ → full + camera zoom

const PHASE_PRE_MS    = 2_000
const PHASE_ERUPT_MS  = 3_000
const PHASE_FLOW_MS   = 5_000
const PHASE_SETTLE_MS = 3_000
const MINI_ERUPT_MS   = 1_000

const HUD_DISPLAY_MS = 5_000

const HISTORY_KEY       = 'nw_eruption_history_v1'
const MAX_HISTORY       = 50

const PARTICLE_COUNT_SMALL  =  40
const PARTICLE_COUNT_MEDIUM =  80
const PARTICLE_COUNT_FULL   = 140
const PARTICLE_COUNT_MINI   =  20

// Color palette
const COLOR_GOLD         = new THREE.Color(0xffd700)
const COLOR_ORANGE_LAVA  = new THREE.Color(0xff6600)
const COLOR_RED_GLOW     = new THREE.Color(0xff2200)
const COLOR_SMOKE        = new THREE.Color(0x888888)
const COLOR_FLASH        = new THREE.Color(0xffffff)

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type EruptionScale = 'mini' | 'small' | 'medium' | 'full'

type EruptionPhase =
  | 'idle'
  | 'pre'       // pre-eruption rumble
  | 'erupting'  // burst
  | 'flowing'   // lava flow
  | 'settling'  // cool-down

interface EruptionEvent {
  id: string
  projectId: string
  projectName: string
  amount: number
  kind: 'payment' | 'contract'
  triggeredAt: number   // unix ms
  scale: EruptionScale
  worldX: number
  worldZ: number
}

interface HUDNotification {
  id: string
  message: string
  expiresAt: number
}

interface ParticleMesh {
  mesh: THREE.Points
  velocities: Float32Array     // vx, vy, vz per particle
  ages: Float32Array           // seconds alive
  lifetimes: Float32Array      // max lifetime per particle
  phase: 'burst' | 'flow'
}

interface ActiveEruption {
  event: EruptionEvent
  phase: EruptionPhase
  phaseStartedAt: number       // performance.now()
  particles: ParticleMesh[]
  peakLight: THREE.PointLight | null
  smokeParticles: ParticleMesh | null
  shakeActive: boolean
  zoomActive: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Eruption history helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadEruptionHistory(): EruptionEvent[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    return JSON.parse(raw) as EruptionEvent[]
  } catch {
    return []
  }
}

function appendEruptionHistory(evt: EruptionEvent): void {
  try {
    const history = loadEruptionHistory()
    history.unshift(evt)
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch {
    // non-blocking
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scale helper
// ─────────────────────────────────────────────────────────────────────────────

function getEruptionScale(amount: number, kind: 'payment' | 'contract'): EruptionScale {
  const threshold = kind === 'contract' ? CONTRACT_THRESHOLD : PAYMENT_THRESHOLD_SMALL
  if (amount < PAYMENT_THRESHOLD_MINI) return 'mini'
  if (amount < threshold) return 'mini'
  if (amount < ERUPTION_SCALE_MEDIUM) return 'small'
  if (amount < ERUPTION_SCALE_FULL)   return 'medium'
  return 'full'
}

function particleCountForScale(scale: EruptionScale): number {
  switch (scale) {
    case 'mini':   return PARTICLE_COUNT_MINI
    case 'small':  return PARTICLE_COUNT_SMALL
    case 'medium': return PARTICLE_COUNT_MEDIUM
    case 'full':   return PARTICLE_COUNT_FULL
  }
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// WebAudio rumble / explosion / sizzle
// ─────────────────────────────────────────────────────────────────────────────

function _makeAudioCtx(): AudioContext | null {
  try {
    return new (window.AudioContext || (window as any).webkitAudioContext)()
  } catch {
    return null
  }
}

function playRumble(ctx: AudioContext, gain: number): void {
  try {
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(40, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(25, ctx.currentTime + 1.5)
    gainNode.gain.setValueAtTime(0, ctx.currentTime)
    gainNode.gain.linearRampToValueAtTime(gain * 0.4, ctx.currentTime + 0.2)
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.8)
    osc.connect(gainNode)
    gainNode.connect(ctx.destination)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 2)
  } catch { /* silent */ }
}

function playExplosion(ctx: AudioContext, gain: number): void {
  try {
    const bufferSize = ctx.sampleRate * 0.6
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2.5)
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gainNode = ctx.createGain()
    gainNode.gain.setValueAtTime(gain * 1.2, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 600
    source.connect(lowpass)
    lowpass.connect(gainNode)
    gainNode.connect(ctx.destination)
    source.start(ctx.currentTime)
  } catch { /* silent */ }
}

function playSizzle(ctx: AudioContext, gain: number): void {
  try {
    const duration = 2.5
    const bufferSize = Math.floor(ctx.sampleRate * duration)
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gainNode = ctx.createGain()
    gainNode.gain.setValueAtTime(gain * 0.3, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 3000
    source.connect(highpass)
    highpass.connect(gainNode)
    gainNode.connect(ctx.destination)
    source.start(ctx.currentTime)
  } catch { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Particle builder helpers (Three.js)
// ─────────────────────────────────────────────────────────────────────────────

function buildBurstParticles(
  count: number,
  worldX: number,
  worldZ: number,
  peakY: number,
  scale: EruptionScale,
): ParticleMesh {
  const positions = new Float32Array(count * 3)
  const velocities = new Float32Array(count * 3)
  const ages = new Float32Array(count)
  const lifetimes = new Float32Array(count)
  const colors = new Float32Array(count * 3)

  const spreadFactor = scale === 'full' ? 1.8 : scale === 'medium' ? 1.3 : 1.0

  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    // Start at mountain peak
    positions[i3]     = worldX + (Math.random() - 0.5) * 0.5
    positions[i3 + 1] = peakY
    positions[i3 + 2] = worldZ + (Math.random() - 0.5) * 0.5

    // Burst velocity: mostly upward with radial spread
    const angle  = Math.random() * Math.PI * 2
    const radial = Math.random() * 3 * spreadFactor
    velocities[i3]     = Math.cos(angle) * radial
    velocities[i3 + 1] = 4 + Math.random() * 6 * spreadFactor   // strong upward
    velocities[i3 + 2] = Math.sin(angle) * radial

    ages[i]      = 0
    lifetimes[i] = 1.0 + Math.random() * 1.5   // 1–2.5 seconds

    // Gold → orange gradient (random per particle)
    const t = Math.random()
    colors[i3]     = 1.0
    colors[i3 + 1] = 0.5 + t * 0.37   // 0.5–0.87
    colors[i3 + 2] = 0.0
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: scale === 'full' ? 0.35 : 0.25,
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    sizeAttenuation: true,
  })

  const mesh = new THREE.Points(geometry, material)

  return { mesh, velocities, ages, lifetimes, phase: 'burst' }
}

function buildFlowParticles(
  count: number,
  worldX: number,
  worldZ: number,
  peakY: number,
): ParticleMesh {
  const positions = new Float32Array(count * 3)
  const velocities = new Float32Array(count * 3)
  const ages = new Float32Array(count)
  const lifetimes = new Float32Array(count)
  const colors = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    // Start near peak
    positions[i3]     = worldX + (Math.random() - 0.5) * 1.0
    positions[i3 + 1] = peakY - Math.random() * 0.5
    positions[i3 + 2] = worldZ + (Math.random() - 0.5) * 1.0

    // Flow velocity: outward and downward along mountain sides
    const angle   = Math.random() * Math.PI * 2
    const outward = 1.0 + Math.random() * 2.0
    velocities[i3]     = Math.cos(angle) * outward
    velocities[i3 + 1] = -(0.5 + Math.random() * 1.5)   // flows downward
    velocities[i3 + 2] = Math.sin(angle) * outward

    // Stagger start times so flow trickles over 5 seconds
    ages[i]      = -(Math.random() * 4.0)   // negative = delayed start
    lifetimes[i] = 2.0 + Math.random() * 2.0

    // Orange-gold lava colors
    const t = Math.random()
    colors[i3]     = 1.0
    colors[i3 + 1] = 0.3 + t * 0.3
    colors[i3 + 2] = 0.0
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: 0.22,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    sizeAttenuation: true,
  })

  const mesh = new THREE.Points(geometry, material)

  return { mesh, velocities, ages, lifetimes, phase: 'flow' }
}

function buildSmokeParticles(
  count: number,
  worldX: number,
  worldZ: number,
  peakY: number,
): ParticleMesh {
  const positions = new Float32Array(count * 3)
  const velocities = new Float32Array(count * 3)
  const ages = new Float32Array(count)
  const lifetimes = new Float32Array(count)
  const colors = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    positions[i3]     = worldX + (Math.random() - 0.5) * 0.8
    positions[i3 + 1] = peakY
    positions[i3 + 2] = worldZ + (Math.random() - 0.5) * 0.8

    const angle = Math.random() * Math.PI * 2
    velocities[i3]     = Math.cos(angle) * 0.3
    velocities[i3 + 1] = 0.8 + Math.random() * 1.2   // slow drift up
    velocities[i3 + 2] = Math.sin(angle) * 0.3

    ages[i]      = -(Math.random() * 1.5)
    lifetimes[i] = 1.5 + Math.random() * 1.0

    const gray = 0.5 + Math.random() * 0.3
    colors[i3]     = gray
    colors[i3 + 1] = gray
    colors[i3 + 2] = gray
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: 0.4,
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    sizeAttenuation: true,
  })

  const mesh = new THREE.Points(geometry, material)

  return { mesh, velocities, ages, lifetimes, phase: 'burst' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public ref API (for replay)
// ─────────────────────────────────────────────────────────────────────────────

export interface VolcanicEventsLayerRef {
  /** Replay a past eruption from history by its id. */
  replayEruption: (id: string) => void
  /** Get eruption history (latest first). */
  getEruptionHistory: () => EruptionEvent[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export const VolcanicEventsLayer = forwardRef<VolcanicEventsLayerRef>(
  function VolcanicEventsLayer(_props, ref) {
    const { scene, camera } = useWorldContext()

    // HUD notifications
    const [notifications, setNotifications] = useState<HUDNotification[]>([])

    // Screen shake CSS class toggle
    const [shaking, setShaking] = useState(false)

    // Camera zoom in progress
    const cameraZoomTarget = useRef<THREE.Vector3 | null>(null)
    const cameraOrigPos    = useRef<THREE.Vector3 | null>(null)
    const zoomPhase        = useRef<'none' | 'zooming-in' | 'holding' | 'zooming-out'>('none')
    const zoomTimer        = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Eruption queue and active state
    const activeEruptionRef = useRef<ActiveEruption | null>(null)
    const eruptionQueueRef  = useRef<EruptionEvent[]>([])
    const animFrameRef      = useRef<number | null>(null)
    const lastFrameTime     = useRef<number>(performance.now())

    // Seen invoice IDs to avoid re-triggering
    const seenInvoiceIds  = useRef<Set<string>>(new Set())
    const seenContractIds = useRef<Set<string>>(new Set())

    // Audio context (lazy)
    const audioCtxRef = useRef<AudioContext | null>(null)

    // ── Audio helper ──────────────────────────────────────────────────────────

    const getAudioCtx = useCallback((): AudioContext | null => {
      const profile: SoundProfile = loadProfile()
      if (profile === 'SILENT') return null
      if (!audioCtxRef.current) {
        audioCtxRef.current = _makeAudioCtx()
      }
      return audioCtxRef.current
    }, [])

    // ── HUD helpers ───────────────────────────────────────────────────────────

    const pushHUD = useCallback((message: string): void => {
      const id = `hud_${Date.now()}_${Math.random()}`
      setNotifications(prev => [
        ...prev.filter(n => n.expiresAt > Date.now()),
        { id, message, expiresAt: Date.now() + HUD_DISPLAY_MS },
      ])
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id))
      }, HUD_DISPLAY_MS + 200)
    }, [])

    // ── Screen shake ──────────────────────────────────────────────────────────

    const triggerShake = useCallback((): void => {
      setShaking(true)
      setTimeout(() => setShaking(false), 500)
    }, [])

    // ── Cleanup particle mesh from scene ─────────────────────────────────────

    const removeParticleMesh = useCallback((pm: ParticleMesh): void => {
      scene.remove(pm.mesh)
      pm.mesh.geometry.dispose()
      ;(pm.mesh.material as THREE.Material).dispose()
    }, [scene])

    const clearEruption = useCallback((eruption: ActiveEruption): void => {
      for (const pm of eruption.particles) removeParticleMesh(pm)
      if (eruption.smokeParticles) removeParticleMesh(eruption.smokeParticles)
      if (eruption.peakLight) {
        scene.remove(eruption.peakLight)
        eruption.peakLight.dispose()
      }
    }, [scene, removeParticleMesh])

    // ── Camera zoom for FULL eruption ─────────────────────────────────────────

    const startCameraZoom = useCallback((worldX: number, worldZ: number, peakY: number): void => {
      if (zoomPhase.current !== 'none') return
      cameraOrigPos.current = camera.position.clone()
      cameraZoomTarget.current = new THREE.Vector3(worldX + 3, peakY + 5, worldZ + 8)
      zoomPhase.current = 'zooming-in'

      // Hold for 4 seconds then zoom back out
      if (zoomTimer.current) clearTimeout(zoomTimer.current)
      zoomTimer.current = setTimeout(() => {
        zoomPhase.current = 'zooming-out'
        zoomTimer.current = setTimeout(() => {
          zoomPhase.current = 'none'
          cameraZoomTarget.current = null
        }, 2000)
      }, 6000)
    }, [camera])

    // ── Start a new eruption ──────────────────────────────────────────────────

    const startEruption = useCallback((event: EruptionEvent): void => {
      if (activeEruptionRef.current) {
        // Queue it
        eruptionQueueRef.current.push(event)
        return
      }

      const { worldX, worldZ, scale, projectName, amount, kind } = event
      const baseHeight = 1.5  // approximate mountain peak Y
      const peakY = baseHeight + contractValueToHeight(amount) * 0.5

      // Build eruption object
      const eruption: ActiveEruption = {
        event,
        phase: scale === 'mini' ? 'erupting' : 'pre',
        phaseStartedAt: performance.now(),
        particles: [],
        peakLight: null,
        smokeParticles: null,
        shakeActive: false,
        zoomActive: false,
      }

      // Peak light for red glow (pre-eruption) and flash (eruption)
      const peakLight = new THREE.PointLight(COLOR_RED_GLOW, 2, 12)
      peakLight.position.set(worldX, peakY, worldZ)
      scene.add(peakLight)
      eruption.peakLight = peakLight

      // Smoke in pre-eruption
      if (scale !== 'mini') {
        const smoke = buildSmokeParticles(15, worldX, worldZ, peakY)
        scene.add(smoke.mesh)
        eruption.smokeParticles = smoke
      }

      activeEruptionRef.current = eruption

      // HUD notification
      const kindLabel = kind === 'payment' ? 'received' : 'contract signed'
      pushHUD(`🌋 ERUPTION: ${projectName} — ${formatMoney(amount)} ${kindLabel}!`)

      // Audio — rumble now, explosion when erupting
      const ctx = getAudioCtx()
      if (ctx && scale !== 'mini') {
        playRumble(ctx, 0.6)
        setTimeout(() => {
          const ctx2 = getAudioCtx()
          if (ctx2) playExplosion(ctx2, scale === 'full' ? 1.0 : 0.6)
        }, PHASE_PRE_MS)
        setTimeout(() => {
          const ctx3 = getAudioCtx()
          if (ctx3) playSizzle(ctx3, 0.4)
        }, PHASE_PRE_MS + 500)
      } else if (ctx && scale === 'mini') {
        playExplosion(ctx, 0.3)
      }
    }, [scene, pushHUD, getAudioCtx])

    // ── Process next queued eruption ──────────────────────────────────────────

    const processNextEruption = useCallback((): void => {
      if (eruptionQueueRef.current.length > 0) {
        const next = eruptionQueueRef.current.shift()!
        setTimeout(() => startEruption(next), 500)
      }
    }, [startEruption])

    // ── Animation loop ────────────────────────────────────────────────────────

    const animate = useCallback((): void => {
      animFrameRef.current = requestAnimationFrame(animate)

      const now    = performance.now()
      const dtMs   = now - lastFrameTime.current
      const dt     = Math.min(dtMs / 1000, 0.1)   // seconds, capped at 100ms
      lastFrameTime.current = now

      // ── Camera zoom lerp ────────────────────────────────────────────────────
      if (zoomPhase.current === 'zooming-in' && cameraZoomTarget.current) {
        camera.position.lerp(cameraZoomTarget.current, 0.04)
        camera.lookAt(cameraZoomTarget.current.clone().sub(new THREE.Vector3(3, 5, 8)))
      } else if (zoomPhase.current === 'zooming-out' && cameraOrigPos.current) {
        camera.position.lerp(cameraOrigPos.current, 0.05)
      }

      // ── Active eruption ────────────────────────────────────────────────────
      const eruption = activeEruptionRef.current
      if (!eruption) return

      const { event } = eruption
      const { worldX, worldZ, scale } = event
      const baseHeight = 1.5
      const peakY = baseHeight + contractValueToHeight(event.amount) * 0.5
      const elapsed = now - eruption.phaseStartedAt

      // Update smoke particles (pre phase)
      if (eruption.smokeParticles) {
        _updateParticles(eruption.smokeParticles, dt, worldX, worldZ, 0)
      }

      // Update burst / flow particles
      for (const pm of eruption.particles) {
        _updateParticles(pm, dt, worldX, worldZ, 0)
      }

      // ── Phase transitions ─────────────────────────────────────────────────

      if (scale === 'mini') {
        // ── MINI: just a quick pop ──────────────────────────────────────────

        if (eruption.phase === 'erupting') {
          // Spawn particles once
          if (eruption.particles.length === 0) {
            const pm = buildBurstParticles(PARTICLE_COUNT_MINI, worldX, worldZ, peakY, 'mini')
            scene.add(pm.mesh)
            eruption.particles.push(pm)
            if (eruption.peakLight) {
              eruption.peakLight.color.copy(COLOR_GOLD)
              eruption.peakLight.intensity = 3
            }
          }
          if (elapsed > MINI_ERUPT_MS) {
            eruption.phase = 'settling'
            eruption.phaseStartedAt = now
          }
        }

        if (eruption.phase === 'settling') {
          if (eruption.peakLight) {
            eruption.peakLight.intensity = Math.max(0, eruption.peakLight.intensity - dt * 4)
          }
          if (elapsed > 500) {
            clearEruption(eruption)
            activeEruptionRef.current = null
            processNextEruption()
          }
        }

      } else {
        // ── FULL ERUPTION SEQUENCE ────────────────────────────────────────

        if (eruption.phase === 'pre') {
          // Rumble: oscillate peak light
          if (eruption.peakLight) {
            eruption.peakLight.intensity = 1.5 + Math.sin(now * 0.015) * 0.8
          }
          // Subtle camera shake
          if (!eruption.shakeActive && elapsed > 1000) {
            const wobble = 0.15
            camera.position.x += (Math.random() - 0.5) * wobble
            camera.position.y += (Math.random() - 0.5) * wobble
          }

          if (elapsed > PHASE_PRE_MS) {
            eruption.phase = 'erupting'
            eruption.phaseStartedAt = now
          }
        }

        if (eruption.phase === 'erupting') {
          // Spawn burst particles once
          if (eruption.particles.length === 0) {
            const count = particleCountForScale(scale)
            const pm = buildBurstParticles(count, worldX, worldZ, peakY, scale)
            scene.add(pm.mesh)
            eruption.particles.push(pm)

            // Flash
            if (eruption.peakLight) {
              eruption.peakLight.color.copy(COLOR_FLASH)
              eruption.peakLight.intensity = 15
            }

            // Screen shake
            if (scale === 'medium' || scale === 'full') {
              triggerShake()
              eruption.shakeActive = true
            }

            // Camera zoom for FULL
            if (scale === 'full' && !eruption.zoomActive) {
              startCameraZoom(worldX, worldZ, peakY)
              eruption.zoomActive = true
            }
          }

          // Fade flash back to gold glow
          if (eruption.peakLight) {
            eruption.peakLight.intensity = Math.max(
              2,
              eruption.peakLight.intensity - dt * 20
            )
            eruption.peakLight.color.lerp(COLOR_GOLD, 0.06)
          }

          if (elapsed > PHASE_ERUPT_MS) {
            eruption.phase = 'flowing'
            eruption.phaseStartedAt = now

            // Spawn flow particles
            const flowCount = Math.floor(particleCountForScale(scale) * 0.7)
            const flowPm = buildFlowParticles(flowCount, worldX, worldZ, peakY)
            scene.add(flowPm.mesh)
            eruption.particles.push(flowPm)

            // Remove smoke
            if (eruption.smokeParticles) {
              removeParticleMesh(eruption.smokeParticles)
              eruption.smokeParticles = null
            }
          }
        }

        if (eruption.phase === 'flowing') {
          // Fade peak light
          if (eruption.peakLight) {
            eruption.peakLight.intensity = Math.max(0, eruption.peakLight.intensity - dt * 1.5)
            eruption.peakLight.color.lerp(COLOR_ORANGE_LAVA, 0.03)
          }

          if (elapsed > PHASE_FLOW_MS) {
            eruption.phase = 'settling'
            eruption.phaseStartedAt = now
          }
        }

        if (eruption.phase === 'settling') {
          // Fade out all particles' material opacity
          for (const pm of eruption.particles) {
            const mat = pm.mesh.material as THREE.PointsMaterial
            mat.opacity = Math.max(0, mat.opacity - dt * 0.4)
          }
          if (eruption.peakLight) {
            eruption.peakLight.intensity = Math.max(0, eruption.peakLight.intensity - dt * 2)
          }

          if (elapsed > PHASE_SETTLE_MS) {
            clearEruption(eruption)
            activeEruptionRef.current = null
            processNextEruption()
          }
        }
      }
    }, [
      camera,
      scene,
      clearEruption,
      removeParticleMesh,
      processNextEruption,
      triggerShake,
      startCameraZoom,
    ])

    // ── Data subscription ─────────────────────────────────────────────────────

    useEffect(() => {
      const unsubscribe = subscribeWorldData((data: NWWorldData) => {
        const now = Date.now()
        const MS_RECENT = 24 * 60 * 60 * 1000   // only process events from last 24h

        // ── Invoice payments ────────────────────────────────────────────────

        for (const inv of data.invoices) {
          if (seenInvoiceIds.current.has(inv.id)) continue
          if (inv.status !== 'paid') continue
          if (!inv.paid_at) continue
          const paidTime = new Date(inv.paid_at).getTime()
          if ((now - paidTime) > MS_RECENT) {
            // Mark as seen but don't trigger (too old)
            seenInvoiceIds.current.add(inv.id)
            continue
          }
          if (inv.amount < PAYMENT_THRESHOLD_MINI) {
            seenInvoiceIds.current.add(inv.id)
            continue
          }

          seenInvoiceIds.current.add(inv.id)

          const scale = getEruptionScale(inv.amount, 'payment')

          // Find matching project
          const project = data.projects.find(p => p.id === inv.project_id)
          const projectName = project?.name ?? 'Unknown Project'
          const { x: worldX, z: worldZ } = seededPosition(inv.project_id ?? inv.id)

          const evt: EruptionEvent = {
            id: `eruption_inv_${inv.id}`,
            projectId: inv.project_id ?? inv.id,
            projectName,
            amount: inv.amount,
            kind: 'payment',
            triggeredAt: paidTime,
            scale,
            worldX,
            worldZ,
          }

          appendEruptionHistory(evt)
          startEruption(evt)
        }

        // ── New contracts signed ────────────────────────────────────────────

        for (const proj of data.projects) {
          if (seenContractIds.current.has(proj.id)) continue
          if (proj.contract_value < CONTRACT_THRESHOLD) {
            seenContractIds.current.add(proj.id)
            continue
          }
          // Only trigger for recently created projects
          if (!proj.created_at) {
            seenContractIds.current.add(proj.id)
            continue
          }
          const createdTime = new Date(proj.created_at).getTime()
          if ((now - createdTime) > MS_RECENT) {
            seenContractIds.current.add(proj.id)
            continue
          }
          // Only trigger for newly approved/in_progress contracts
          if (
            proj.status !== 'approved' &&
            proj.status !== 'in_progress' &&
            proj.status !== 'pending'
          ) {
            seenContractIds.current.add(proj.id)
            continue
          }

          seenContractIds.current.add(proj.id)

          const scale = getEruptionScale(proj.contract_value, 'contract')
          const { x: worldX, z: worldZ } = seededPosition(proj.id)

          const evt: EruptionEvent = {
            id: `eruption_contract_${proj.id}`,
            projectId: proj.id,
            projectName: proj.name,
            amount: proj.contract_value,
            kind: 'contract',
            triggeredAt: createdTime,
            scale,
            worldX,
            worldZ,
          }

          appendEruptionHistory(evt)
          startEruption(evt)
        }
      })

      return unsubscribe
    }, [startEruption])

    // ── Start / stop animation loop ───────────────────────────────────────────

    useEffect(() => {
      lastFrameTime.current = performance.now()
      animFrameRef.current = requestAnimationFrame(animate)

      return () => {
        if (animFrameRef.current !== null) {
          cancelAnimationFrame(animFrameRef.current)
          animFrameRef.current = null
        }
        if (zoomTimer.current) clearTimeout(zoomTimer.current)
        // Cleanup active eruption
        if (activeEruptionRef.current) {
          clearEruption(activeEruptionRef.current)
          activeEruptionRef.current = null
        }
      }
    }, [animate, clearEruption])

    // ── Ref API ───────────────────────────────────────────────────────────────

    useImperativeHandle(ref, () => ({
      replayEruption: (id: string) => {
        const history = loadEruptionHistory()
        const evt = history.find(e => e.id === id)
        if (!evt) {
          console.warn(`[VolcanicEventsLayer] No eruption history entry found for id: ${id}`)
          return
        }
        // Replay with fresh timestamp
        const replayEvt: EruptionEvent = {
          ...evt,
          id: `${evt.id}_replay_${Date.now()}`,
          triggeredAt: Date.now(),
        }
        startEruption(replayEvt)
      },
      getEruptionHistory: () => loadEruptionHistory(),
    }), [startEruption])

    // ── Render HUD overlay ────────────────────────────────────────────────────

    return (
      <>
        {/* Screen shake wrapper — positioned absolutely over canvas */}
        {shaking && (
          <style>{`
            @keyframes nw-volcano-shake {
              0%   { transform: translate(0,      0) }
              15%  { transform: translate(-0.3px, 0.3px) }
              30%  { transform: translate(0.3px, -0.3px) }
              45%  { transform: translate(-0.3px, 0.2px) }
              60%  { transform: translate(0.2px, -0.3px) }
              75%  { transform: translate(-0.2px, 0.1px) }
              90%  { transform: translate(0.1px, -0.1px) }
              100% { transform: translate(0, 0) }
            }
            .nw-volcano-shake-target {
              animation: nw-volcano-shake 0.5s ease-out;
            }
          `}</style>
        )}

        {/* HUD Notifications */}
        {notifications.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 80,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 9999,
              pointerEvents: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {notifications.map(n => (
              <VolcanoHUDNotification key={n.id} message={n.message} />
            ))}
          </div>
        )}
      </>
    )
  }
)

VolcanicEventsLayer.displayName = 'VolcanicEventsLayer'

// ─────────────────────────────────────────────────────────────────────────────
// Particle update helper (mutates geometry in-place for performance)
// ─────────────────────────────────────────────────────────────────────────────

function _updateParticles(
  pm: ParticleMesh,
  dt: number,
  _originX: number,
  _originZ: number,
  _groundY: number,
): void {
  const posAttr = pm.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  const positions = posAttr.array as Float32Array
  const { velocities, ages, lifetimes } = pm

  const count = lifetimes.length
  const GRAVITY = -4.0   // world units per second squared

  for (let i = 0; i < count; i++) {
    ages[i] += dt

    // Delayed particles (negative age) are not yet alive
    if (ages[i] < 0) continue

    const t = ages[i] / lifetimes[i]
    if (t >= 1.0) {
      // Dead — park below ground
      const i3 = i * 3
      positions[i3 + 1] = -999
      continue
    }

    const i3 = i * 3

    // Apply gravity to vertical velocity
    velocities[i3 + 1] += GRAVITY * dt

    // Integrate position
    positions[i3]     += velocities[i3]     * dt
    positions[i3 + 1] += velocities[i3 + 1] * dt
    positions[i3 + 2] += velocities[i3 + 2] * dt

    // Clamp to ground
    if (positions[i3 + 1] < 0.05) {
      positions[i3 + 1] = 0.05
      velocities[i3 + 1] *= -0.15   // tiny bounce dampen
    }
  }

  posAttr.needsUpdate = true
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD Notification sub-component
// ─────────────────────────────────────────────────────────────────────────────

interface VolcanoHUDNotificationProps {
  message: string
}

function VolcanoHUDNotification({ message }: VolcanoHUDNotificationProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), HUD_DISPLAY_MS - 300)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(20,10,0,0.92) 0%, rgba(40,15,0,0.92) 100%)',
        border: '1px solid rgba(255,180,0,0.7)',
        borderRadius: 10,
        padding: '10px 20px',
        color: '#ffd700',
        fontSize: 15,
        fontWeight: 700,
        fontFamily: 'monospace',
        letterSpacing: '0.04em',
        textShadow: '0 0 12px rgba(255,200,0,0.9)',
        boxShadow: '0 0 24px rgba(255,120,0,0.5), 0 2px 8px rgba(0,0,0,0.8)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.4s ease-out',
        maxWidth: 480,
        textAlign: 'center',
        whiteSpace: 'nowrap',
      }}
    >
      {message}
    </div>
  )
}
