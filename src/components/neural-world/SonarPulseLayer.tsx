/**
 * SonarPulseLayer.tsx — NW64: Periodic sonar scan sweep for data refresh.
 *
 * Every 60 seconds (configurable) a ring of teal-white light expands from
 * world centre (0, 0, 0) outward at 20 world-units/second, scanning all
 * nodes and triggering a DataBridge refresh as it travels.
 *
 * Features:
 *   - Ring: teal-white, 0.5u wide, semi-transparent, fades at 100u radius
 *   - Inner glow ring: brighter white-teal core line
 *   - Wavefront particle trail: 48 tiny dots jitter around the leading edge
 *   - Origin flare: brief radiant sphere at world centre on pulse start
 *   - Node scanning: when ring crosses a node within 100u it emits
 *       nw:sonar-node-scanned  — { id: string }  (dim flash — confirms scan)
 *   - Change detection: after data returns, emits
 *       nw:sonar-node-changed  — { id: string; changed: boolean }
 *       changed=true  → gold flash  |  changed=false → dim flash
 *   - Manual trigger: window.dispatchEvent(new CustomEvent('nw:sonar-pulse'))
 *   - Sound: soft crystal ping at origin; sweep tones as ring expands
 *   - HUD: fixed bottom-right — "SCAN 47 | 0:42 until next"
 *   - DataBridge refresh triggered on every pulse
 *
 * Events consumed:
 *   nw:frame         — Three.js animation frame (from WorldEngine)
 *   nw:sonar-pulse   — manual trigger
 *
 * Events emitted:
 *   nw:sonar-node-scanned  — { id: string }
 *   nw:sonar-node-changed  — { id: string; changed: boolean }
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  getWorldData,
  triggerDataBridgeRefresh,
  type NWWorldData,
} from './DataBridge'
import { getAudioEngine } from './AudioEngine'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Ring expansion speed — world units per second */
const PULSE_SPEED = 20

/** Radius at which ring fully fades — the "world boundary" */
const PULSE_FADE_RADIUS = 100

/** Thickness of the outer ring in world units */
const RING_WIDTH = 0.5

/** Number of particle dots at the wavefront */
const PARTICLE_COUNT = 48

/** Default auto-pulse interval in milliseconds */
const DEFAULT_INTERVAL_MS = 60_000

/** Y-height of the ring plane above ground */
const RING_Y = 0.15

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SonarPulseLayerProps {
  visible: boolean
  /**
   * Milliseconds between automatic pulses.
   * @default 60000
   */
  intervalMs?: number
}

interface NodeRecord {
  id:          string
  x:           number
  z:           number
  /** Euclidean distance from world centre (0, 0) */
  dist:        number
  healthScore: number
  status:      string
}

// ── HUD sub-component ─────────────────────────────────────────────────────────

interface SonarIconProps {
  pulsing: boolean
}

function SonarIcon({ pulsing }: SonarIconProps) {
  return (
    <div style={{ position: 'relative', width: 22, height: 22, flexShrink: 0 }}>
      {/* Outer ring */}
      <div style={{
        position:     'absolute',
        inset:        0,
        border:       `1px solid rgba(0, 217, 200, ${pulsing ? 0.85 : 0.25})`,
        borderRadius: '50%',
        transition:   'border-color 0.35s ease',
        boxShadow:    pulsing ? '0 0 6px rgba(0,217,200,0.4)' : 'none',
      }} />
      {/* Mid ring */}
      <div style={{
        position:     'absolute',
        inset:        4,
        border:       `1px solid rgba(0, 217, 200, ${pulsing ? 0.55 : 0.14})`,
        borderRadius: '50%',
        transition:   'border-color 0.35s ease',
      }} />
      {/* Centre dot */}
      <div style={{
        position:     'absolute',
        inset:        9,
        background:   pulsing ? '#00d9c8' : 'rgba(0,217,200,0.28)',
        borderRadius: '50%',
        transition:   'background 0.35s ease, box-shadow 0.35s ease',
        boxShadow:    pulsing ? '0 0 5px #00d9c8' : 'none',
      }} />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function SonarPulseLayer({
  visible,
  intervalMs = DEFAULT_INTERVAL_MS,
}: SonarPulseLayerProps) {
  const { scene } = useWorldContext()

  // ── Pulse runtime refs (mutation-only, no re-render required) ────────────
  const pulseActiveRef   = useRef(false)
  const pulseRadiusRef   = useRef(0)
  const scanCountRef     = useRef(0)
  /** Snapshot of world data captured immediately before a pulse fires */
  const preScanDataRef   = useRef<NWWorldData | null>(null)
  /** Node IDs already scanned this pulse cycle */
  const scannedIdsRef    = useRef<Set<string>>(new Set())
  /** Tracks the last 25-unit milestone that triggered a sweep sound */
  const lastSwpMileRef   = useRef(0)
  /** Live list of world nodes with distances from origin */
  const nodeListRef      = useRef<NodeRecord[]>([])

  // ── React state (drives HUD re-renders) ─────────────────────────────────
  const [scanCount,        setScanCount]        = useState(0)
  const [secondsUntilNext, setSecondsUntilNext] = useState(Math.floor(intervalMs / 1000))
  const [isPulsing,        setIsPulsing]        = useState(false)

  // ── Three.js object refs ─────────────────────────────────────────────────
  const groupRef       = useRef<THREE.Group | null>(null)
  const outerRingRef   = useRef<THREE.Mesh | null>(null)
  const innerGlowRef   = useRef<THREE.Mesh | null>(null)
  const originFlareRef = useRef<THREE.Mesh | null>(null)
  const particlePtsRef = useRef<THREE.Points | null>(null)
  const particleGeoRef = useRef<THREE.BufferGeometry | null>(null)

  // ── Subscribe to node positions from world data ──────────────────────────
  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      nodeListRef.current = data.projects.map(p => {
        const pos  = seededPosition(p.id)
        const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z)
        return {
          id:          p.id,
          x:           pos.x,
          z:           pos.z,
          dist,
          healthScore: p.health_score,
          status:      p.status,
        }
      })
    })
    return unsub
  }, [])

  // ── Three.js scene setup ─────────────────────────────────────────────────
  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    // ── Outer ring — teal-white (wider, lower opacity) ──
    const outerGeo = new THREE.RingGeometry(0.1, 0.6, 64)
    const outerMat = new THREE.MeshBasicMaterial({
      color:       0x80f8f8,
      transparent: true,
      opacity:     0,
      side:        THREE.DoubleSide,
      depthWrite:  false,
    })
    const outerRing = new THREE.Mesh(outerGeo, outerMat)
    outerRing.rotation.x = -Math.PI / 2
    outerRing.position.y = RING_Y
    group.add(outerRing)
    outerRingRef.current = outerRing

    // ── Inner glow — white-teal (narrower, higher opacity) ──
    const innerGeo = new THREE.RingGeometry(0.1, 0.35, 64)
    const innerMat = new THREE.MeshBasicMaterial({
      color:       0xd8ffff,
      transparent: true,
      opacity:     0,
      side:        THREE.DoubleSide,
      depthWrite:  false,
    })
    const innerGlow = new THREE.Mesh(innerGeo, innerMat)
    innerGlow.rotation.x = -Math.PI / 2
    innerGlow.position.y = RING_Y + 0.04
    group.add(innerGlow)
    innerGlowRef.current = innerGlow

    // ── Origin flare — radiant sphere at centre, shown briefly on pulse ──
    const flareGeo = new THREE.SphereGeometry(1.2, 12, 12)
    const flareMat = new THREE.MeshBasicMaterial({
      color:       0x00f0d8,
      transparent: true,
      opacity:     0,
    })
    const flare = new THREE.Mesh(flareGeo, flareMat)
    flare.position.set(0, 0.35, 0)
    group.add(flare)
    originFlareRef.current = flare

    // ── Wavefront particle cloud (THREE.Points for performance) ──
    const posArr = new Float32Array(PARTICLE_COUNT * 3)
    const pGeo   = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
    const pMat = new THREE.PointsMaterial({
      color:           0x60f8e8,
      size:            0.22,
      transparent:     true,
      opacity:         0,
      sizeAttenuation: true,
      depthWrite:      false,
    })
    const pts = new THREE.Points(pGeo, pMat)
    // pts lives at Y=0; individual particle Y offsets are set per-frame
    group.add(pts)
    particleGeoRef.current = pGeo
    particlePtsRef.current = pts

    return () => {
      outerRing.geometry.dispose()
      ;(outerRing.material as THREE.Material).dispose()
      innerGlow.geometry.dispose()
      ;(innerGlow.material as THREE.Material).dispose()
      flare.geometry.dispose()
      ;(flare.material as THREE.Material).dispose()
      pGeo.dispose()
      ;(pts.material as THREE.Material).dispose()
      scene.remove(group)
      groupRef.current       = null
      outerRingRef.current   = null
      innerGlowRef.current   = null
      originFlareRef.current = null
      particleGeoRef.current = null
      particlePtsRef.current = null
    }
  }, [scene]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync group visibility with prop
  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  // ── Fire a sonar pulse ───────────────────────────────────────────────────
  const firePulse = useCallback(() => {
    // Only one active pulse at a time
    if (pulseActiveRef.current) return

    // Snapshot current data for post-pulse change detection
    preScanDataRef.current   = getWorldData()
    scannedIdsRef.current    = new Set()
    lastSwpMileRef.current   = 0

    // Request a fresh DataBridge fetch (results arrive while ring travels)
    triggerDataBridgeRefresh()

    // Activate pulse
    pulseActiveRef.current = true
    pulseRadiusRef.current = 0

    // Increment scan counter and update HUD
    scanCountRef.current += 1
    setScanCount(scanCountRef.current)
    setIsPulsing(true)

    // Audio: soft crystal ping at pulse origin
    try { getAudioEngine().playCrystalChime() } catch { /* non-blocking */ }

    // Animate origin flare: fade in then decay over ~1.5 s
    const flare = originFlareRef.current
    if (flare) {
      const mat         = flare.material as THREE.MeshBasicMaterial
      mat.opacity       = 0.9
      let elapsed       = 0
      const FLARE_DUR   = 1.5
      const tickFlare   = () => {
        elapsed  += 0.016
        mat.opacity = Math.max(0, 0.9 * (1 - elapsed / FLARE_DUR))
        if (elapsed < FLARE_DUR) requestAnimationFrame(tickFlare)
      }
      requestAnimationFrame(tickFlare)
    }
  }, [])

  // ── Frame animation (driven by nw:frame from WorldEngine) ────────────────
  useEffect(() => {
    let prevTime = performance.now() / 1000

    /** Check which nodes changed data since the pre-scan snapshot. */
    function detectNodeChanges() {
      const pre  = preScanDataRef.current
      const post = getWorldData()
      // Only compare if new data actually arrived after the pulse fired
      if (!pre || post.lastFetched <= pre.lastFetched) return

      const preMap = new Map<string, { health: number; status: string }>()
      for (const p of pre.projects) {
        preMap.set(p.id, { health: p.health_score, status: p.status })
      }

      for (const p of post.projects) {
        const prev    = preMap.get(p.id)
        const changed = !prev
          || Math.abs(prev.health - p.health_score) > 0.5
          || prev.status !== p.status
        window.dispatchEvent(
          new CustomEvent<{ id: string; changed: boolean }>('nw:sonar-node-changed', {
            detail: { id: p.id, changed },
          })
        )
      }
    }

    function onFrame() {
      const now   = performance.now() / 1000
      const delta = Math.min(now - prevTime, 0.1)
      prevTime    = now

      if (!pulseActiveRef.current) return

      // Advance ring radius
      pulseRadiusRef.current += PULSE_SPEED * delta
      const r        = pulseRadiusRef.current
      const progress = r / PULSE_FADE_RADIUS

      // ── Pulse complete ──────────────────────────────────────────────────
      if (progress >= 1) {
        pulseActiveRef.current = false
        setIsPulsing(false)

        // Hide all ring elements
        if (outerRingRef.current) {
          ;(outerRingRef.current.material as THREE.MeshBasicMaterial).opacity = 0
        }
        if (innerGlowRef.current) {
          ;(innerGlowRef.current.material as THREE.MeshBasicMaterial).opacity = 0
        }
        if (particlePtsRef.current) {
          ;(particlePtsRef.current.material as THREE.PointsMaterial).opacity = 0
        }

        // Soft completion chime (slightly delayed so it doesn't overlap start sound)
        try {
          setTimeout(() => {
            try { getAudioEngine().playCrystalChime() } catch { /* ok */ }
          }, 300)
        } catch { /* ok */ }

        // Detect changed nodes now that data may have refreshed
        detectNodeChanges()
        return
      }

      // ── Opacity envelope ────────────────────────────────────────────────
      // Fast fade-in (first 4%), plateau, then fade out over final 22%
      let baseOpacity: number
      if (progress < 0.04) {
        baseOpacity = progress / 0.04
      } else if (progress < 0.78) {
        baseOpacity = 0.88
      } else {
        baseOpacity = 0.88 * (1 - (progress - 0.78) / 0.22)
      }

      // ── Outer ring geometry (recreated each frame — follows PulseLayer pattern) ──
      const outerRing = outerRingRef.current
      if (outerRing) {
        outerRing.geometry.dispose()
        outerRing.geometry = new THREE.RingGeometry(
          Math.max(0.05, r - RING_WIDTH * 0.5),
          r + RING_WIDTH * 0.5,
          64
        )
        ;(outerRing.material as THREE.MeshBasicMaterial).opacity = baseOpacity * 0.70
      }

      // ── Inner glow ring geometry ────────────────────────────────────────
      const innerGlow = innerGlowRef.current
      if (innerGlow) {
        innerGlow.geometry.dispose()
        innerGlow.geometry = new THREE.RingGeometry(
          Math.max(0.05, r - RING_WIDTH * 0.22),
          r + RING_WIDTH * 0.22,
          64
        )
        ;(innerGlow.material as THREE.MeshBasicMaterial).opacity = baseOpacity * 0.95
      }

      // ── Audio sweep milestones (every 25 world units) ───────────────────
      const milestone = Math.floor(r / 25)
      if (milestone > lastSwpMileRef.current && r < PULSE_FADE_RADIUS * 0.92) {
        lastSwpMileRef.current = milestone
        try { getAudioEngine().playNexusSweep() } catch { /* ok */ }
      }

      // ── Wavefront particle positions ────────────────────────────────────
      const pGeo = particleGeoRef.current
      const pPts = particlePtsRef.current
      if (pGeo && pPts) {
        const pos = pGeo.attributes.position.array as Float32Array
        const t   = now * 3.4
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const theta   = (i / PARTICLE_COUNT) * Math.PI * 2
          // Jitter decays as ring expands toward the fade boundary
          const jitter  = Math.sin(t + i * 1.618) * 0.30 * (1 - progress * 0.6)
          const pr      = r + jitter
          const yOff    = Math.sin(t * 0.85 + i * 2.07) * 0.12
          pos[i * 3 + 0] = Math.cos(theta) * pr
          pos[i * 3 + 1] = RING_Y + yOff
          pos[i * 3 + 2] = Math.sin(theta) * pr
        }
        pGeo.attributes.position.needsUpdate = true
        ;(pPts.material as THREE.PointsMaterial).opacity = baseOpacity * 0.55
      }

      // ── Node scan detection ─────────────────────────────────────────────
      // Emit nw:sonar-node-scanned when the ring leading edge crosses a node
      const prevR   = r - PULSE_SPEED * delta
      const nodes   = nodeListRef.current
      const scanned = scannedIdsRef.current

      for (const node of nodes) {
        if (scanned.has(node.id))          continue // already scanned this pulse
        if (node.dist > PULSE_FADE_RADIUS) continue // beyond visual boundary

        // Node is within this frame's swept band [prevR, r)
        if (node.dist >= prevR && node.dist < r) {
          scanned.add(node.id)
          window.dispatchEvent(
            new CustomEvent<{ id: string }>('nw:sonar-node-scanned', {
              detail: { id: node.id },
            })
          )
        }
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, []) // Stable: all mutable state lives in refs; setters are stable React functions

  // ── Auto-pulse interval ──────────────────────────────────────────────────
  useEffect(() => {
    let remainingMs = intervalMs
    setSecondsUntilNext(Math.round(remainingMs / 1000))

    const ticker = setInterval(() => {
      remainingMs -= 1000
      const secs = Math.max(0, Math.round(remainingMs / 1000))
      setSecondsUntilNext(secs)

      if (remainingMs <= 0) {
        remainingMs = intervalMs
        firePulse()
      }
    }, 1000)

    return () => clearInterval(ticker)
  }, [intervalMs, firePulse])

  // ── Manual trigger listener ──────────────────────────────────────────────
  useEffect(() => {
    const handler = () => firePulse()
    window.addEventListener('nw:sonar-pulse', handler)
    return () => window.removeEventListener('nw:sonar-pulse', handler)
  }, [firePulse])

  // ── HUD render ───────────────────────────────────────────────────────────
  if (!visible) return null

  const mins      = Math.floor(secondsUntilNext / 60)
  const secs      = secondsUntilNext % 60
  const countdown = `${mins}:${String(secs).padStart(2, '0')}`

  return (
    <div
      style={{
        position:      'fixed',
        bottom:        20,
        right:         20,
        zIndex:        50,
        pointerEvents: 'none',
        userSelect:    'none',
      }}
    >
      {/* ── Pulse counter card ── */}
      <div
        style={{
          background:        'rgba(4, 10, 22, 0.86)',
          border:            `1px solid rgba(0, 217, 200, ${isPulsing ? 0.65 : 0.22})`,
          borderRadius:      8,
          padding:           '7px 14px 7px 10px',
          backdropFilter:    'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          display:           'flex',
          alignItems:        'center',
          gap:               10,
          fontFamily:        'monospace',
          boxShadow:         isPulsing
            ? '0 0 16px rgba(0, 217, 200, 0.22), 0 2px 8px rgba(0,0,0,0.5)'
            : '0 2px 8px rgba(0,0,0,0.4)',
          transition:        'border-color 0.4s ease, box-shadow 0.4s ease',
        }}
      >
        <SonarIcon pulsing={isPulsing} />

        <div style={{ lineHeight: 1 }}>
          {/* Scan counter */}
          <div style={{
            color:         isPulsing ? '#00f5e0' : '#00c0b2',
            fontSize:      9,
            letterSpacing: 2.5,
            fontWeight:    700,
            transition:    'color 0.3s ease',
          }}>
            SCAN {String(scanCount).padStart(2, '0')}
          </div>

          {/* Countdown / status */}
          <div style={{
            color:         'rgba(160, 215, 215, 0.35)',
            fontSize:      8,
            letterSpacing: 1.2,
            marginTop:     3,
          }}>
            {isPulsing ? 'SCANNING...' : `${countdown} until next`}
          </div>
        </div>

        {/* Active sweep progress bar */}
        {isPulsing && (
          <div style={{
            width:        38,
            height:       3,
            background:   'rgba(0, 217, 200, 0.12)',
            borderRadius: 2,
            overflow:     'hidden',
            alignSelf:    'flex-end',
            marginBottom: 1,
            flexShrink:   0,
          }}>
            <div
              key={`sweep-bar-${scanCount}`}
              style={{
                height:     '100%',
                background: 'linear-gradient(90deg, #00c8b8, #80ffe8)',
                borderRadius: 2,
                animation:  `nw64-sweep-bar ${intervalMs <= DEFAULT_INTERVAL_MS ? 5 : 5}s linear forwards`,
              }}
            />
          </div>
        )}
      </div>

      {/* ── CSS keyframe for the sweep progress bar ── */}
      <style>{`
        @keyframes nw64-sweep-bar {
          from { width: 0%; }
          to   { width: 100%; }
        }
      `}</style>
    </div>
  )
}
