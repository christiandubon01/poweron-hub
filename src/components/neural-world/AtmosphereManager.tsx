/**
 * AtmosphereManager.tsx — Biome / atmosphere system for Neural World.
 *
 * 6 atmosphere modes, only one active at a time.
 * Manages: sky color, fog, ambient + directional lights, ground plane, particles.
 * Toggle UI: floating panel top-right of canvas.
 */

import React, { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'

// ── Enums + Config ────────────────────────────────────────────────────────────

export enum AtmosphereMode {
  MOJAVE = 'MOJAVE',
  OCEAN = 'OCEAN',
  COASTAL_FOG = 'COASTAL_FOG',
  SCIFI_V1 = 'SCIFI_V1',
  SCIFI_V2_SUBSTRATE = 'SCIFI_V2_SUBSTRATE',
  RESERVED = 'RESERVED',
}

interface AtmosphereConfig {
  skyColor: number
  fogColor: number
  fogDensity: number
  ambientColor: number
  ambientIntensity: number
  dirLightColor: number
  dirLightIntensity: number
  groundColor: number
  particleType: 'dust' | 'foam' | 'fog_particles' | 'crystal' | 'nebula' | 'none'
}

const CONFIGS: Record<AtmosphereMode, AtmosphereConfig> = {
  [AtmosphereMode.MOJAVE]: {
    skyColor: 0x1a0800,
    fogColor: 0x3d1f0a,
    fogDensity: 0.012,
    ambientColor: 0xffa050,
    ambientIntensity: 0.6,
    dirLightColor: 0xffb060,
    dirLightIntensity: 1.2,
    groundColor: 0x3d1f0a,
    particleType: 'dust',
  },
  [AtmosphereMode.OCEAN]: {
    skyColor: 0x0a0f1a,
    fogColor: 0x050a1a,
    fogDensity: 0.018,
    ambientColor: 0x001030,
    ambientIntensity: 0.4,
    dirLightColor: 0x2040a0,
    dirLightIntensity: 0.5,
    groundColor: 0x050a1a,
    particleType: 'foam',
  },
  [AtmosphereMode.COASTAL_FOG]: {
    skyColor: 0xb0b8b0,
    fogColor: 0xb0b8b0,
    fogDensity: 0.06,
    ambientColor: 0x90a090,
    ambientIntensity: 0.8,
    dirLightColor: 0xc0d0c0,
    dirLightIntensity: 0.4,
    groundColor: 0x1a2b1a,
    particleType: 'fog_particles',
  },
  [AtmosphereMode.SCIFI_V1]: {
    skyColor: 0x1a0a2e,
    fogColor: 0x0a0a14,
    fogDensity: 0.008,
    ambientColor: 0x00e5cc,
    ambientIntensity: 0.5,
    dirLightColor: 0xffffff,
    dirLightIntensity: 2.0,
    groundColor: 0x0a0a14,
    particleType: 'crystal',
  },
  [AtmosphereMode.SCIFI_V2_SUBSTRATE]: {
    skyColor: 0x0d0514,
    fogColor: 0x050a08,
    fogDensity: 0.005,
    ambientColor: 0x004444,
    ambientIntensity: 0.4,
    dirLightColor: 0x6600aa,
    dirLightIntensity: 0.8,
    groundColor: 0x050a08,
    particleType: 'nebula',
  },
  [AtmosphereMode.RESERVED]: {
    skyColor: 0x0a0a0a,
    fogColor: 0x0a0a0a,
    fogDensity: 0.01,
    ambientColor: 0x404040,
    ambientIntensity: 0.5,
    dirLightColor: 0xffffff,
    dirLightIntensity: 1.0,
    groundColor: 0x1a1a1a,
    particleType: 'none',
  },
}

const MODE_LABELS: Record<AtmosphereMode, string> = {
  [AtmosphereMode.MOJAVE]: 'MOJAVE',
  [AtmosphereMode.OCEAN]: 'OCEAN',
  [AtmosphereMode.COASTAL_FOG]: 'COASTAL FOG',
  [AtmosphereMode.SCIFI_V1]: 'SCI-FI V1',
  [AtmosphereMode.SCIFI_V2_SUBSTRATE]: 'SUBSTRATE',
  [AtmosphereMode.RESERVED]: 'RESERVED',
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface AtmosphereManagerProps {
  activeMode: AtmosphereMode
  onModeChange: (mode: AtmosphereMode) => void
  ambientLightRef: React.MutableRefObject<THREE.AmbientLight | null>
  dirLightRef: React.MutableRefObject<THREE.DirectionalLight | null>
  groundMeshRef: React.MutableRefObject<THREE.Mesh | null>
  /** Secondary ambient for SCIFI_V2_SUBSTRATE dual ambient */
  ambientLight2Ref: React.MutableRefObject<THREE.AmbientLight | null>
  /** NW7: When true the built-in toggle UI is hidden (replaced by CommandHUD) */
  showUI?: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AtmosphereManager({
  activeMode,
  onModeChange,
  ambientLightRef,
  dirLightRef,
  groundMeshRef,
  ambientLight2Ref,
  showUI = true,
}: AtmosphereManagerProps) {
  const { scene } = useWorldContext()
  const particlesRef = useRef<THREE.Points | null>(null)
  const lightningTimerRef = useRef<number>(0)
  const lightningFlashRef = useRef<THREE.PointLight | null>(null)
  const lightningActiveRef = useRef<boolean>(false)
  const nebulaShiftRef = useRef<number>(0)

  // ── Apply atmosphere config to scene lights/fog ───────────────────────────
  const applyAtmosphere = useCallback((mode: AtmosphereMode) => {
    const cfg = CONFIGS[mode]

    // Fog
    scene.fog = new THREE.FogExp2(cfg.fogColor, cfg.fogDensity)

    // Background
    scene.background = new THREE.Color(cfg.skyColor)

    // Ambient
    if (ambientLightRef.current) {
      ambientLightRef.current.color.set(cfg.ambientColor)
      ambientLightRef.current.intensity = cfg.ambientIntensity
    }

    // Directional
    if (dirLightRef.current) {
      dirLightRef.current.color.set(cfg.dirLightColor)
      dirLightRef.current.intensity = cfg.dirLightIntensity
    }

    // Second ambient (substrate only)
    if (ambientLight2Ref.current) {
      if (mode === AtmosphereMode.SCIFI_V2_SUBSTRATE) {
        ambientLight2Ref.current.color.set(0x440066)
        ambientLight2Ref.current.intensity = 0.35
      } else {
        ambientLight2Ref.current.intensity = 0
      }
    }

    // Ground color
    if (groundMeshRef.current) {
      const mat = groundMeshRef.current.material as THREE.MeshLambertMaterial
      mat.color.set(cfg.groundColor)
      // SCIFI_V2_SUBSTRATE: semi-transparent ground
      if (mode === AtmosphereMode.SCIFI_V2_SUBSTRATE) {
        mat.transparent = true
        mat.opacity = 0.7
      } else {
        mat.transparent = false
        mat.opacity = 1.0
      }
      mat.needsUpdate = true
    }

    // Rebuild particles
    rebuildParticles(mode, cfg)
  }, [scene, ambientLightRef, dirLightRef, groundMeshRef, ambientLight2Ref])

  // ── Particle system ───────────────────────────────────────────────────────
  function rebuildParticles(mode: AtmosphereMode, cfg: AtmosphereConfig) {
    // Remove old particles
    if (particlesRef.current) {
      scene.remove(particlesRef.current)
      particlesRef.current.geometry.dispose()
      ;(particlesRef.current.material as THREE.Material).dispose()
      particlesRef.current = null
    }

    if (cfg.particleType === 'none') return

    let count = 800
    let positions: Float32Array
    let colors: Float32Array | null = null
    let size = 0.25

    switch (cfg.particleType) {
      case 'dust': {
        // MOJAVE: dust haze suspended in air
        count = 1200
        positions = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 200
          positions[i * 3 + 1] = Math.random() * 20
          positions[i * 3 + 2] = (Math.random() - 0.5) * 200
        }
        size = 0.15
        break
      }
      case 'foam': {
        // OCEAN: bioluminescent foam at ground level
        count = 600
        positions = new Float32Array(count * 3)
        colors = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 200
          positions[i * 3 + 1] = Math.random() * 1.5
          positions[i * 3 + 2] = (Math.random() - 0.5) * 200
          // Bioluminescent teal-cyan
          colors[i * 3] = 0.0
          colors[i * 3 + 1] = 0.6 + Math.random() * 0.4
          colors[i * 3 + 2] = 0.8 + Math.random() * 0.2
        }
        size = 0.2
        break
      }
      case 'fog_particles': {
        // COASTAL_FOG: ground fog particles
        count = 2000
        positions = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 200
          positions[i * 3 + 1] = Math.random() * 4
          positions[i * 3 + 2] = (Math.random() - 0.5) * 200
        }
        size = 0.5
        break
      }
      case 'crystal': {
        // SCIFI_V1: teal/cyan crystal floating particles
        count = 400
        positions = new Float32Array(count * 3)
        colors = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 150
          positions[i * 3 + 1] = Math.random() * 30
          positions[i * 3 + 2] = (Math.random() - 0.5) * 150
          colors[i * 3] = 0.0
          colors[i * 3 + 1] = 0.85 + Math.random() * 0.15
          colors[i * 3 + 2] = 0.85 + Math.random() * 0.15
        }
        size = 0.3
        break
      }
      case 'nebula': {
        // SCIFI_V2: nebula/substrate floating particles
        count = 500
        positions = new Float32Array(count * 3)
        colors = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 160
          positions[i * 3 + 1] = Math.random() * 25
          positions[i * 3 + 2] = (Math.random() - 0.5) * 160
          // teal + deep purple mix
          const isTeal = Math.random() > 0.5
          colors[i * 3] = isTeal ? 0 : 0.4
          colors[i * 3 + 1] = isTeal ? 0.7 : 0
          colors[i * 3 + 2] = isTeal ? 0.7 : 0.8
        }
        size = 0.25
        break
      }
      default:
        return
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    if (colors) {
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    }

    const mat = new THREE.PointsMaterial({
      size,
      transparent: true,
      opacity: cfg.particleType === 'fog_particles' ? 0.25 : 0.7,
      depthWrite: false,
      vertexColors: colors !== null,
      color: colors ? 0xffffff : cfg.particleType === 'dust' ? 0xc8905a : 0xaaaaaa,
    })

    particlesRef.current = new THREE.Points(geo, mat)
    scene.add(particlesRef.current)
  }

  // ── React to mode changes ─────────────────────────────────────────────────
  useEffect(() => {
    applyAtmosphere(activeMode)
  }, [activeMode, applyAtmosphere])

  // ── Per-frame update (called via window event from WorldEngine) ───────────
  useEffect(() => {
    let prevTime = performance.now()

    function onFrame() {
      const now = performance.now()
      const delta = (now - prevTime) / 1000
      prevTime = now

      // Animate particles
      if (particlesRef.current) {
        const positions = particlesRef.current.geometry.attributes.position
        const arr = positions.array as Float32Array
        const count = arr.length / 3
        const mode = activeMode

        if (mode === AtmosphereMode.MOJAVE) {
          // Drift dust slowly
          for (let i = 0; i < count; i++) {
            arr[i * 3] += 0.01 * delta * 60
            arr[i * 3 + 2] += 0.005 * delta * 60
            if (arr[i * 3] > 100) arr[i * 3] = -100
            if (arr[i * 3 + 2] > 100) arr[i * 3 + 2] = -100
          }
          positions.needsUpdate = true
        } else if (mode === AtmosphereMode.OCEAN) {
          // Undulate foam
          for (let i = 0; i < count; i++) {
            arr[i * 3 + 1] = 0.3 + Math.abs(Math.sin(now * 0.001 + i * 0.5)) * 1.2
          }
          positions.needsUpdate = true
        } else if (mode === AtmosphereMode.COASTAL_FOG) {
          // Roll fog
          for (let i = 0; i < count; i++) {
            arr[i * 3] += 0.008 * delta * 60
            if (arr[i * 3] > 100) arr[i * 3] = -100
          }
          positions.needsUpdate = true
        } else if (mode === AtmosphereMode.SCIFI_V2_SUBSTRATE) {
          // Slow nebula shift
          nebulaShiftRef.current += delta * 0.3
          for (let i = 0; i < count; i++) {
            arr[i * 3 + 1] += Math.sin(now * 0.0005 + i) * 0.01
            if (arr[i * 3 + 1] > 25) arr[i * 3 + 1] = 0
          }
          positions.needsUpdate = true

          // Shift sky color slowly
          const shift = (Math.sin(now * 0.0002) + 1) * 0.5
          const skyR = Math.floor(0x0d + shift * 0x08)
          const skyG = 0x05
          const skyB = Math.floor(0x14 + shift * 0x10)
          scene.background = new THREE.Color(
            skyR / 255,
            skyG / 255,
            skyB / 255
          )
        }
      }

      // OCEAN lightning flash
      if (activeMode === AtmosphereMode.OCEAN) {
        lightningTimerRef.current -= delta
        if (lightningTimerRef.current <= 0) {
          lightningTimerRef.current = 30 + Math.random() * 30
          triggerLightningFlash()
        }
        if (lightningActiveRef.current && lightningFlashRef.current) {
          lightningFlashRef.current.intensity *= 0.85
          if (lightningFlashRef.current.intensity < 0.05) {
            scene.remove(lightningFlashRef.current)
            lightningFlashRef.current.dispose()
            lightningFlashRef.current = null
            lightningActiveRef.current = false
          }
        }
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [activeMode, scene])

  function triggerLightningFlash() {
    if (lightningActiveRef.current) return
    const flash = new THREE.PointLight(0x8888ff, 15, 300)
    flash.position.set(
      (Math.random() - 0.5) * 100,
      50 + Math.random() * 30,
      (Math.random() - 0.5) * 100
    )
    scene.add(flash)
    lightningFlashRef.current = flash
    lightningActiveRef.current = true
  }

  // ── Toggle UI ─────────────────────────────────────────────────────────────
  if (!showUI) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        background: 'rgba(0,0,0,0.65)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        padding: '8px',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, letterSpacing: 1, marginBottom: 2 }}>
        ATMOSPHERE
      </div>
      {Object.values(AtmosphereMode).map((mode) => {
        const isActive = mode === activeMode
        return (
          <button
            key={mode}
            onClick={() => onModeChange(mode)}
            style={{
              padding: '4px 10px',
              fontSize: 10,
              fontWeight: isActive ? 700 : 400,
              letterSpacing: 0.5,
              borderRadius: 4,
              border: isActive
                ? '1px solid rgba(0,229,204,0.8)'
                : '1px solid rgba(255,255,255,0.1)',
              background: isActive
                ? 'rgba(0,229,204,0.15)'
                : 'rgba(255,255,255,0.04)',
              color: isActive ? '#00e5cc' : 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.1s',
            }}
          >
            {MODE_LABELS[mode]}
          </button>
        )
      })}
    </div>
  )
}
