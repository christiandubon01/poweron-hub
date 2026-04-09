/**
 * ResonanceOrb.tsx — NW40/NW41: Central resonance orb at Founders Valley.
 *
 * Position: x=0, y=12, z=0 (above OPERATOR monument).
 * Geometry: SphereGeometry radius 2.0 + IcosahedronGeometry wireframe overlay.
 *
 * THREE STATES:
 *   DISSONANT (0.00–0.35) — red/amber flicker, irregular pulse, falling sparks
 *   COHERENT  (0.35–0.70) — gold/teal, steady 1Hz sine, breathing wireframe
 *   GROWTH    (0.70–1.00) — white-gold core + teal corona, accelerating pulse, fountain sparks
 *
 * WORLD SPEED:
 *   Dispatches nw:world-speed-factor CustomEvent each frame.
 *   DISSONANT = 0.7x, COHERENT = 1.0x, GROWTH = 1.3x.
 *   If manual override is active (nw:world-speed-override event) the orb still
 *   shows its state but defers world-speed dispatch to the override value.
 *
 * CLICK: Opens breakdown panel showing each alignment factor score + explanation.
 *
 * HUD: Renders a fixed bottom-center indicator bar showing state name + score.
 *
 * NW40: Layers panel toggle key = 'resonance-orb'.
 * NW41: Added OPTIMIZE RESONANCE button, heat map toggle, show-effect animation,
 *       tuning fork markers, and effect animator layers.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  useResonanceScore,
  type ResonanceResult,
  type ResonanceState,
  RESONANCE_STATE_COLOR,
  RESONANCE_STATE_ICON,
} from './ResonanceEngine'
import {
  ResonancePredictor,
  ResonanceHeatMapToggle,
  ResonanceHeatMapLayer,
  ResonanceEffectAnimator,
  ResonanceTuningForkLayer,
} from './ResonancePredictor'

// ── Constants ─────────────────────────────────────────────────────────────────

const ORB_X   = 0
const ORB_Y   = 12
const ORB_Z   = 0

const ORB_RADIUS = 2.0

// World speed factors per state
const WORLD_SPEED: Record<ResonanceState, number> = {
  DISSONANT: 0.7,
  COHERENT:  1.0,
  GROWTH:    1.3,
}

// Particle counts per state
const PARTICLE_COUNT = 32

// ── Helper: seeded random ─────────────────────────────────────────────────────

function seededRand(seed: number): number {
  const x = Math.sin(seed) * 43758.5453123
  return x - Math.floor(x)
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ResonanceOrbProps {
  visible: boolean
}

export function ResonanceOrb({ visible }: ResonanceOrbProps) {
  const { scene, camera, renderer } = useWorldContext()
  const resonance = useResonanceScore()

  // Three.js objects
  const orbRef       = useRef<THREE.Mesh | null>(null)
  const wireRef      = useRef<THREE.Mesh | null>(null)
  const lightRef     = useRef<THREE.PointLight | null>(null)
  const particlesRef = useRef<THREE.Points | null>(null)
  const particlePosRef = useRef<Float32Array | null>(null)
  const particleVelRef = useRef<Float32Array | null>(null)

  // Animation state
  const tRef       = useRef(0)         // global animation time (seconds)
  const growthCycleRef = useRef(0)     // 0–10 second GROWTH cycle
  const resonanceRef = useRef<ResonanceResult>(resonance)
  const visibleRef   = useRef(visible)

  // Manual override
  const manualOverrideRef = useRef<number | null>(null)  // null = auto

  // Panel state
  const [panelOpen, setPanelOpen]     = useState(false)
  const [panelResult, setPanelResult] = useState<ResonanceResult | null>(null)

  // Keep resonance ref fresh
  useEffect(() => {
    resonanceRef.current = resonance
  }, [resonance])

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  // ── Listen for manual speed override ─────────────────────────────────────────

  useEffect(() => {
    function onOverride(e: Event) {
      const ev = e as CustomEvent<{ mode: string; factor: number | null }>
      if (!ev.detail) return
      manualOverrideRef.current = ev.detail.factor
    }
    window.addEventListener('nw:world-speed-override', onOverride)
    return () => window.removeEventListener('nw:world-speed-override', onOverride)
  }, [])

  // ── Build Three.js objects ────────────────────────────────────────────────────

  useEffect(() => {
    // Orb sphere
    const orbGeo = new THREE.SphereGeometry(ORB_RADIUS, 32, 24)
    const orbMat = new THREE.MeshStandardMaterial({
      color:       0xffd700,
      emissive:    0xffd700,
      emissiveIntensity: 0.6,
      roughness:   0.3,
      metalness:   0.4,
      transparent: true,
      opacity:     0.92,
    })
    const orb = new THREE.Mesh(orbGeo, orbMat)
    orb.position.set(ORB_X, ORB_Y, ORB_Z)
    orb.visible = visible
    orb.userData['nw-clickable'] = 'resonance-orb'
    scene.add(orb)
    orbRef.current = orb

    // Icosahedron wireframe overlay
    const wireGeo = new THREE.IcosahedronGeometry(ORB_RADIUS * 1.08, 2)
    const wireMat = new THREE.MeshBasicMaterial({
      color:       0x00e5cc,
      wireframe:   true,
      transparent: true,
      opacity:     0.35,
    })
    const wire = new THREE.Mesh(wireGeo, wireMat)
    wire.position.set(ORB_X, ORB_Y, ORB_Z)
    wire.visible = visible
    scene.add(wire)
    wireRef.current = wire

    // Point light
    const light = new THREE.PointLight(0xffd700, 2.5, 60)
    light.position.set(ORB_X, ORB_Y, ORB_Z)
    light.visible = visible
    scene.add(light)
    lightRef.current = light

    // Particle system
    const posArray = new Float32Array(PARTICLE_COUNT * 3)
    const velArray = new Float32Array(PARTICLE_COUNT * 3)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = seededRand(i * 7.3) * Math.PI * 2
      const radius = ORB_RADIUS * (1 + seededRand(i * 3.1) * 0.5)
      posArray[i * 3 + 0] = ORB_X + Math.cos(angle) * radius
      posArray[i * 3 + 1] = ORB_Y
      posArray[i * 3 + 2] = ORB_Z + Math.sin(angle) * radius
      velArray[i * 3 + 0] = (seededRand(i * 11) - 0.5) * 0.1
      velArray[i * 3 + 1] = 0
      velArray[i * 3 + 2] = (seededRand(i * 17) - 0.5) * 0.1
    }
    particlePosRef.current = posArray
    particleVelRef.current = velArray

    const ptGeo = new THREE.BufferGeometry()
    ptGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3))
    const ptMat = new THREE.PointsMaterial({
      color:       0xffd700,
      size:        0.35,
      transparent: true,
      opacity:     0.8,
      depthWrite:  false,
    })
    const pts = new THREE.Points(ptGeo, ptMat)
    pts.visible = visible
    scene.add(pts)
    particlesRef.current = pts

    return () => {
      scene.remove(orb)
      orbGeo.dispose()
      orbMat.dispose()
      scene.remove(wire)
      wireGeo.dispose()
      wireMat.dispose()
      scene.remove(light)
      scene.remove(pts)
      ptGeo.dispose()
      ptMat.dispose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Visibility toggle ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (orbRef.current)       orbRef.current.visible       = visible
    if (wireRef.current)      wireRef.current.visible      = visible
    if (lightRef.current)     lightRef.current.visible     = visible
    if (particlesRef.current) particlesRef.current.visible = visible
  }, [visible])

  // ── Animation loop ────────────────────────────────────────────────────────────

  useEffect(() => {
    const DT = 1 / 60

    function onFrame() {
      if (!visibleRef.current) return

      const { state, score } = resonanceRef.current
      tRef.current += DT

      const orb   = orbRef.current
      const wire  = wireRef.current
      const light = lightRef.current
      const pts   = particlesRef.current
      const posArr = particlePosRef.current
      const velArr = particleVelRef.current

      if (!orb || !wire || !light || !pts || !posArr || !velArr) return

      const orbMat  = orb.material  as THREE.MeshStandardMaterial
      const wireMat = wire.material as THREE.MeshBasicMaterial
      const ptMat   = pts.material  as THREE.PointsMaterial

      // ── State-specific animation ────────────────────────────────────────────

      if (state === 'DISSONANT') {
        // Irregular pulse: random interval 0.3–1.5s
        const noise = (Math.sin(tRef.current * 7.3) + Math.sin(tRef.current * 13.7) + Math.sin(tRef.current * 2.1)) / 3
        const pulse = 0.5 + noise * 0.5

        // Color: red ↔ amber, erratic
        const redness = 0.5 + Math.sin(tRef.current * 4.1) * 0.4
        orbMat.color.setRGB(1.0, redness * 0.5, 0)
        orbMat.emissive.setRGB(1.0, redness * 0.3, 0)
        orbMat.emissiveIntensity = 0.3 + pulse * 0.7

        // Wireframe jitter
        wireMat.color.setRGB(1.0, redness * 0.6, 0)
        const jitter = (seededRand(Math.floor(tRef.current * 30)) - 0.5) * 0.04
        wire.scale.setScalar(1.0 + jitter)

        // Light flicker
        light.color.setRGB(1.0, 0.3 + redness * 0.3, 0)
        light.intensity = 1.0 + pulse * 2.0

        // Particles: dark red sparks falling downward
        ptMat.color.setRGB(0.9, 0.1, 0.05)
        ptMat.opacity = 0.6 + pulse * 0.3

        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2
          posArr[ix] += velArr[ix]
          posArr[iy] -= 0.04 + seededRand(i + tRef.current * 0.1) * 0.05  // gravity pull
          posArr[iz] += velArr[iz]

          // Reset particle when it falls too far
          if (posArr[iy] < ORB_Y - 10) {
            const angle = seededRand(i * 7.3 + tRef.current) * Math.PI * 2
            const r = ORB_RADIUS * (0.8 + seededRand(i * 3.1) * 0.4)
            posArr[ix] = ORB_X + Math.cos(angle) * r
            posArr[iy] = ORB_Y + seededRand(i * 11 + tRef.current) * ORB_RADIUS
            posArr[iz] = ORB_Z + Math.sin(angle) * r
            velArr[ix] = (seededRand(i * 11 + tRef.current * 0.3) - 0.5) * 0.06
            velArr[iz] = (seededRand(i * 17 + tRef.current * 0.5) - 0.5) * 0.06
          }
        }

      } else if (state === 'COHERENT') {
        // Steady 1Hz sine wave
        const pulse = Math.sin(tRef.current * Math.PI * 2) * 0.5 + 0.5

        // Color: smooth gold with teal undertone
        orbMat.color.setRGB(1.0, 0.85, 0.1 + pulse * 0.15)
        orbMat.emissive.setRGB(0.8, 0.65, 0.05 + pulse * 0.1)
        orbMat.emissiveIntensity = 0.4 + pulse * 0.35

        // Wireframe: gentle breathing 0.98–1.02 over 2 seconds
        wireMat.color.setRGB(0.0, 0.85, 0.75)
        const breathe = 0.98 + Math.sin(tRef.current * Math.PI) * 0.02
        wire.scale.setScalar(breathe)

        // Light: warm gold stable
        light.color.setRGB(1.0, 0.85, 0.2)
        light.intensity = 2.0 + pulse * 0.8

        // Particles: gold motes drifting upward
        ptMat.color.setRGB(1.0, 0.85, 0.1)
        ptMat.opacity = 0.65

        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2
          posArr[ix] += velArr[ix] * 0.3
          posArr[iy] += 0.015 + seededRand(i * 5 + Math.floor(tRef.current * 0.5)) * 0.01
          posArr[iz] += velArr[iz] * 0.3

          if (posArr[iy] > ORB_Y + 8) {
            const angle = seededRand(i * 7.3 + tRef.current * 0.2) * Math.PI * 2
            const r = ORB_RADIUS * (0.9 + seededRand(i * 2) * 0.4)
            posArr[ix] = ORB_X + Math.cos(angle) * r
            posArr[iy] = ORB_Y
            posArr[iz] = ORB_Z + Math.sin(angle) * r
            velArr[ix] = (seededRand(i * 13 + tRef.current) - 0.5) * 0.04
            velArr[iz] = (seededRand(i * 19 + tRef.current) - 0.5) * 0.04
          }
        }

      } else {
        // GROWTH: accelerating pulse cycle 0–10s, then reset
        growthCycleRef.current += DT
        if (growthCycleRef.current >= 10) growthCycleRef.current = 0
        const cycleT = growthCycleRef.current / 10  // 0–1

        // Frequency: 1Hz → 3Hz over 10 seconds
        const freq = 1 + cycleT * 2  // 1–3 Hz
        const pulse = Math.sin(tRef.current * freq * Math.PI * 2) * 0.5 + 0.5

        // Wireframe: scale 1.0 → 1.15 over cycle, snap back at end
        const wireScale = 1.0 + cycleT * 0.15
        wire.scale.setScalar(wireScale)

        // Color: brilliant white-gold core with teal corona
        const coreBrightness = 0.8 + pulse * 0.2
        orbMat.color.setRGB(coreBrightness, coreBrightness * 0.95, coreBrightness * 0.6)
        orbMat.emissive.setRGB(0.9, 0.85, 0.3)
        orbMat.emissiveIntensity = 0.6 + pulse * 0.8 + cycleT * 0.4

        wireMat.color.setRGB(0.0, 0.9, 0.85)
        wireMat.opacity = 0.4 + pulse * 0.2

        // Light: bright, radiating
        light.color.setRGB(1.0, 0.95, 0.5)
        light.intensity = 3.0 + pulse * 3.0 + cycleT * 2.0

        // Particles: bright gold + white sparks rising rapidly, fountain spread
        ptMat.color.setRGB(1.0, 0.95, 0.4)
        ptMat.opacity = 0.85

        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2
          const speed = 1.3 + cycleT * 1.2  // accelerates with cycle
          posArr[ix] += velArr[ix] * speed * 0.5
          posArr[iy] += (0.06 + seededRand(i * 3) * 0.04) * speed
          posArr[iz] += velArr[iz] * speed * 0.5

          if (posArr[iy] > ORB_Y + 14 || Math.abs(posArr[ix] - ORB_X) > 12) {
            const angle = seededRand(i * 5.7 + tRef.current * 0.5) * Math.PI * 2
            const r = ORB_RADIUS * 0.6
            posArr[ix] = ORB_X + Math.cos(angle) * r
            posArr[iy] = ORB_Y
            posArr[iz] = ORB_Z + Math.sin(angle) * r
            const spreadAngle = seededRand(i * 17 + tRef.current) * Math.PI * 2
            const spread = 0.05 + seededRand(i * 23 + tRef.current) * 0.1
            velArr[ix] = Math.cos(spreadAngle) * spread
            velArr[iz] = Math.sin(spreadAngle) * spread
          }
        }
      }

      // Flush particle positions to GPU
      const ptGeo = pts.geometry as THREE.BufferGeometry
      const posAttr = ptGeo.getAttribute('position') as THREE.BufferAttribute
      posAttr.needsUpdate = true

      // ── Orb scale pulse ──────────────────────────────────────────────────────
      if (state === 'DISSONANT') {
        const sc = 1.0 + (seededRand(Math.floor(tRef.current * 10)) - 0.5) * 0.06
        orb.scale.setScalar(sc)
      } else if (state === 'COHERENT') {
        const sc = 1.0 + Math.sin(tRef.current * Math.PI * 2) * 0.03
        orb.scale.setScalar(sc)
      } else {
        const cycleT = growthCycleRef.current / 10
        const sc = 1.0 + cycleT * 0.12
        orb.scale.setScalar(sc)
      }

      // ── Dispatch world speed factor ──────────────────────────────────────────
      const factor = manualOverrideRef.current !== null
        ? manualOverrideRef.current
        : WORLD_SPEED[state]

      window.dispatchEvent(new CustomEvent('nw:world-speed-factor', { detail: { factor } }))
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Click handler ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!renderer) return
    const canvas = renderer.domElement

    function onClick(e: MouseEvent) {
      if (!visibleRef.current || !orbRef.current) return
      const rect = canvas.getBoundingClientRect()
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1

      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
      const hits = raycaster.intersectObject(orbRef.current, false)
      if (hits.length > 0) {
        setPanelResult(resonanceRef.current)
        setPanelOpen(true)
      }
    }

    canvas.addEventListener('click', onClick)
    return () => canvas.removeEventListener('click', onClick)
  }, [renderer, camera])

  // ── HUD state indicator ───────────────────────────────────────────────────────

  const { state, score } = resonance
  const stateColor = RESONANCE_STATE_COLOR[state]
  const stateIcon  = RESONANCE_STATE_ICON[state]

  if (!visible) return null

  return (
    <>
      {/* HUD State Indicator — bottom center, near speed display */}
      <HUDStateIndicator
        state={state}
        score={score}
        color={stateColor}
        icon={stateIcon}
      />

      {/* Breakdown Panel — click orb to open */}
      {panelOpen && panelResult && (
        <ResonanceBreakdownPanel
          result={panelResult}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {/* NW41: Heat map Three.js layer */}
      <ResonanceHeatMapLayer visible={visible} />

      {/* NW41: Effect animator (handles show-effect + state transform events) */}
      <ResonanceEffectAnimator />

      {/* NW41: Tuning fork markers for applied optimizations */}
      <ResonanceTuningForkLayer visible={visible} />
    </>
  )
}

// ── HUD State Indicator ───────────────────────────────────────────────────────

function HUDStateIndicator({
  state,
  score,
  color,
  icon,
}: {
  state: ResonanceState
  score: number
  color: string
  icon: string
}) {
  const isPulsing = state === 'GROWTH'
  const [pulseUp, setPulseUp] = useState(true)
  useEffect(() => {
    if (!isPulsing) return
    const id = setInterval(() => setPulseUp(v => !v), 600)
    return () => clearInterval(id)
  }, [isPulsing])

  const opacity = isPulsing ? (pulseUp ? 1.0 : 0.55) : 1.0

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 54,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 25,
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        background: 'rgba(0,0,0,0.7)',
        border: `1px solid ${color}55`,
        borderRadius: 6,
        padding: '4px 12px 4px 8px',
        backdropFilter: 'blur(6px)',
        fontFamily: 'monospace',
        transition: 'opacity 0.3s',
        opacity,
        pointerEvents: 'none',
      }}
    >
      <span style={{ color, fontSize: 12 }}>{icon}</span>
      <span style={{ color, fontSize: 9, letterSpacing: 2, fontWeight: 700 }}>
        {state}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9, letterSpacing: 1 }}>
        {(score * 100).toFixed(0)}%
      </span>
    </div>
  )
}

// ── Resonance Breakdown Panel ─────────────────────────────────────────────────

function ResonanceBreakdownPanel({
  result,
  onClose,
}: {
  result: ResonanceResult
  onClose: () => void
}) {
  const { state, score, factors } = result
  const stateColor = RESONANCE_STATE_COLOR[state]
  const stateIcon  = RESONANCE_STATE_ICON[state]

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 60,
        width: 400,
        background: 'rgba(4,4,14,0.97)',
        border: `1px solid ${stateColor}55`,
        borderRadius: 10,
        padding: '18px 20px',
        fontFamily: 'monospace',
        backdropFilter: 'blur(16px)',
        boxShadow: `0 0 40px ${stateColor}22`,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ color: stateColor, fontSize: 16 }}>{stateIcon}</span>
            <span style={{ color: stateColor, fontSize: 11, letterSpacing: 2, fontWeight: 700 }}>
              {state}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>
              RESONANCE {(score * 100).toFixed(0)}%
            </span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 8, letterSpacing: 1.5 }}>
            FOUNDERS VALLEY · ALIGNMENT BREAKDOWN
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.45)',
            borderRadius: 4,
            padding: '3px 8px',
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'monospace',
          }}
        >
          ✕
        </button>
      </div>

      {/* Master score bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{
          height: 4,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.1)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${score * 100}%`,
            background: `linear-gradient(90deg, ${stateColor}88, ${stateColor})`,
            borderRadius: 2,
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>

      {/* Factor list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {factors.map(f => {
          const barColor = f.score >= 0.7 ? '#00cc66' : f.score >= 0.4 ? '#ffd700' : '#ff4444'
          return (
            <div key={f.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 9, letterSpacing: 1.2 }}>
                  {f.label.toUpperCase()}
                </span>
                <span style={{ color: barColor, fontSize: 9, letterSpacing: 1, fontWeight: 700 }}>
                  {(f.score * 100).toFixed(0)}
                </span>
              </div>
              {/* Score bar */}
              <div style={{
                height: 3,
                borderRadius: 2,
                background: 'rgba(255,255,255,0.07)',
                overflow: 'hidden',
                marginBottom: 4,
              }}>
                <div style={{
                  height: '100%',
                  width: `${f.score * 100}%`,
                  background: barColor,
                  borderRadius: 2,
                }} />
              </div>
              {/* Explanation */}
              <div style={{
                color: 'rgba(255,255,255,0.38)',
                fontSize: 8,
                letterSpacing: 0.5,
                lineHeight: 1.5,
              }}>
                {f.explanation}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer row: world speed + heat map toggle */}
      <div style={{
        marginTop: 14,
        paddingTop: 10,
        borderTop: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}>
        <div style={{
          color: 'rgba(255,255,255,0.2)',
          fontSize: 7.5,
          letterSpacing: 0.8,
          fontFamily: 'monospace',
        }}>
          WORLD SPEED · {state === 'DISSONANT' ? '0.7×' : state === 'COHERENT' ? '1.0×' : '1.3×'}
          &nbsp;·&nbsp;
          CLICK ORB TO REFRESH
        </div>

        {/* NW41: Heat map toggle */}
        <ResonanceHeatMapToggle result={result} stateColor={stateColor} />
      </div>

      {/* NW41: AI optimization predictor */}
      <ResonancePredictor result={result} stateColor={stateColor} />
    </div>
  )
}
