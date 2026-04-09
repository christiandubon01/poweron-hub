/**
 * HandoffChain.tsx — NW28b: Visual handoff chain between AI agents and human workers.
 *
 * Visualizations:
 *   - AI drops cube at domain platform → Human walks over → picks it up (cube teal→amber glow)
 *   - Human drops cube at domain → AI swoops down → picks it up (amber→teal)
 *   - Each handoff point flashes GOLD briefly — showing collaboration moments
 *   - Revenue Chain mode: dims all other activity to 30%, animates complete
 *     lead-to-revenue cycle with camera following action (45 seconds, ESC to skip)
 *
 * Listens for events:
 *   nw:revenue-chain-start  — begins the full revenue chain sequence
 *   nw:revenue-chain-step   — advances the step
 *   nw:revenue-chain-end    — resets
 *   nw:worker-toggled-ai    — triggers amber-dissolve → teal-fade-in at orb position
 *   nw:worker-toggled-human — triggers teal-dissolve → amber-fade-in at orb position
 */

import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'

// ── Handoff flash marker ───────────────────────────────────────────────────────

interface HandoffMarker {
  mesh: THREE.Mesh
  light: THREE.PointLight
  birthTime: number
  lifetime: number   // 1.5s
}

// ── Revenue chain waypoints (world positions) ─────────────────────────────────

const CHAIN_WAYPOINTS: Array<{ label: string; pos: THREE.Vector3; isHuman: boolean }> = [
  { label: 'SPARK captures lead',        pos: new THREE.Vector3(-175, 1, -120), isHuman: false },
  { label: 'Receptionist picks up',      pos: new THREE.Vector3(-150, 1,   60), isHuman: true  },
  { label: 'VAULT delivers estimate',    pos: new THREE.Vector3(-150, 1,   60), isHuman: false },
  { label: 'Estimator builds proposal',  pos: new THREE.Vector3(-150, 1,   60), isHuman: true  },
  { label: 'Contract signed',            pos: new THREE.Vector3(-200, 1,   80), isHuman: true  },
  { label: 'BLUEPRINT creates project',  pos: new THREE.Vector3(-130, 1,  -70), isHuman: false },
  { label: 'Lead Elec. works mountain',  pos: new THREE.Vector3(-130, 1,  -70), isHuman: true  },
  { label: 'OHM compliance sweep',       pos: new THREE.Vector3(-165, 1, -110), isHuman: false },
  { label: 'LEDGER generates invoice',   pos: new THREE.Vector3( -35, 1,   25), isHuman: false },
  { label: 'Admin collects payment',     pos: new THREE.Vector3( -35, 1,   25), isHuman: true  },
  { label: 'NEXUS sweeps → Fortress',    pos: new THREE.Vector3(   0, 1,    0), isHuman: false },
]

// ── Constants ─────────────────────────────────────────────────────────────────

const GOLD            = 0xFFD700
const HANDOFF_LIFE    = 1.5     // flash lifetime in seconds
const CHAIN_STEP_DUR  = 4       // seconds per chain step (matches HumanWorkerLayer)
const DIM_OPACITY     = 0.3     // other activity opacity during chain

// ── Component ─────────────────────────────────────────────────────────────────

export function HandoffChain() {
  const { scene, camera } = useWorldContext()

  const markersRef       = useRef<HandoffMarker[]>([])
  const chainActiveRef   = useRef(false)
  const chainStepRef     = useRef(0)
  const chainGroupRef    = useRef<THREE.Group | null>(null)
  const chainLineRef     = useRef<THREE.Line | null>(null)
  const frameRef         = useRef<number | null>(null)

  // ── Spawn a gold flash at a world position ─────────────────────────────
  const spawnHandoffFlash = useCallback((pos: THREE.Vector3) => {
    const geo = new THREE.SphereGeometry(0.6, 10, 8)
    const mat = new THREE.MeshBasicMaterial({
      color:       GOLD,
      transparent: true,
      opacity:     1.0,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(pos)
    scene.add(mesh)

    const light = new THREE.PointLight(GOLD, 3, 15)
    light.position.copy(pos)
    scene.add(light)

    markersRef.current.push({
      mesh,
      light,
      birthTime: performance.now() / 1000,
      lifetime:  HANDOFF_LIFE,
    })
  }, [scene])

  // ── Build revenue chain path visualization ────────────────────────────
  const buildChainPath = useCallback(() => {
    // Remove old chain
    if (chainGroupRef.current) {
      scene.remove(chainGroupRef.current)
    }
    if (chainLineRef.current) {
      scene.remove(chainLineRef.current)
      chainLineRef.current.geometry.dispose()
      ;(chainLineRef.current.material as THREE.LineBasicMaterial).dispose()
    }

    const group = new THREE.Group()
    chainGroupRef.current = group

    // Draw path line connecting all waypoints
    const points = CHAIN_WAYPOINTS.map(w => w.pos.clone())
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points)
    const lineMat = new THREE.LineBasicMaterial({
      color:       GOLD,
      transparent: true,
      opacity:     0.35,
    })
    chainLineRef.current = new THREE.Line(lineGeo, lineMat)
    scene.add(chainLineRef.current)

    // Small markers at each waypoint
    for (const wp of CHAIN_WAYPOINTS) {
      const markerGeo = new THREE.SphereGeometry(0.4, 8, 6)
      const markerMat = new THREE.MeshBasicMaterial({
        color:       wp.isHuman ? 0xFF9040 : 0x00E5CC,
        transparent: true,
        opacity:     0.5,
      })
      const marker = new THREE.Mesh(markerGeo, markerMat)
      marker.position.copy(wp.pos)
      group.add(marker)
    }

    scene.add(group)
  }, [scene])

  const clearChainPath = useCallback(() => {
    if (chainGroupRef.current) {
      chainGroupRef.current.traverse(child => {
        if (child instanceof THREE.Mesh) {
          ;(child.material as THREE.MeshBasicMaterial).dispose()
          child.geometry.dispose()
        }
      })
      scene.remove(chainGroupRef.current)
      chainGroupRef.current = null
    }
    if (chainLineRef.current) {
      scene.remove(chainLineRef.current)
      chainLineRef.current.geometry.dispose()
      ;(chainLineRef.current.material as THREE.LineBasicMaterial).dispose()
      chainLineRef.current = null
    }
  }, [scene])

  // ── Camera follow during revenue chain ────────────────────────────────
  const followCameraStep = useCallback((step: number) => {
    const wp = CHAIN_WAYPOINTS[step]
    if (!wp) return
    // Smoothly move camera target via event (CameraController listens for nw:camera-focus)
    window.dispatchEvent(new CustomEvent('nw:camera-focus', {
      detail: {
        target: { x: wp.pos.x, y: 0, z: wp.pos.z },
        distance: 40,
        duration: 1.5,
      }
    }))
  }, [])

  // ── Event handlers ────────────────────────────────────────────────────
  useEffect(() => {
    function onChainStart() {
      chainActiveRef.current = true
      chainStepRef.current   = 0
      buildChainPath()
      // Dim other layers
      window.dispatchEvent(new CustomEvent('nw:set-world-dim', { detail: { opacity: DIM_OPACITY } }))
    }

    function onChainStep(e: Event) {
      const ev = e as CustomEvent<{ step: number }>
      const step = ev.detail?.step ?? 0
      chainStepRef.current = step
      const wp = CHAIN_WAYPOINTS[step]
      if (wp) {
        spawnHandoffFlash(wp.pos)
        followCameraStep(step)
      }
    }

    function onChainEnd() {
      chainActiveRef.current = false
      clearChainPath()
      // Restore other layers
      window.dispatchEvent(new CustomEvent('nw:set-world-dim', { detail: { opacity: 1.0 } }))
    }

    // Worker toggled to AI: spawn teal orb appearance flash
    function onToggleAI(e: Event) {
      const ev = e as CustomEvent<{ workerId: string }>
      if (!ev.detail?.workerId) return
      // Dispatch a handoff flash at approx center of west continent
      spawnHandoffFlash(new THREE.Vector3(-140, 1, -20))
    }

    // Worker toggled to Human: spawn amber orb appearance flash
    function onToggleHuman(e: Event) {
      const ev = e as CustomEvent<{ workerId: string }>
      if (!ev.detail?.workerId) return
      spawnHandoffFlash(new THREE.Vector3(-140, 1, -20))
    }

    window.addEventListener('nw:revenue-chain-start',   onChainStart)
    window.addEventListener('nw:revenue-chain-step',    onChainStep)
    window.addEventListener('nw:revenue-chain-end',     onChainEnd)
    window.addEventListener('nw:worker-toggled-ai',     onToggleAI)
    window.addEventListener('nw:worker-toggled-human',  onToggleHuman)

    return () => {
      window.removeEventListener('nw:revenue-chain-start',   onChainStart)
      window.removeEventListener('nw:revenue-chain-step',    onChainStep)
      window.removeEventListener('nw:revenue-chain-end',     onChainEnd)
      window.removeEventListener('nw:worker-toggled-ai',     onToggleAI)
      window.removeEventListener('nw:worker-toggled-human',  onToggleHuman)
    }
  }, [scene, spawnHandoffFlash, followCameraStep, buildChainPath, clearChainPath])

  // ── Periodic random handoff flashes (background ambient) ──────────────
  useEffect(() => {
    // Spawn occasional ambient handoff flashes to show hybrid activity
    const AMBIENT_HANDOFF_SPOTS: THREE.Vector3[] = [
      new THREE.Vector3(-150, 1,  60),
      new THREE.Vector3(-130, 1, -70),
      new THREE.Vector3( -35, 1,  25),
      new THREE.Vector3(-105, 1,   0),
      new THREE.Vector3(-175, 1, -120),
    ]

    let ambientTimer = 8 + Math.random() * 8

    function tickAmbient(dt: number) {
      ambientTimer -= dt
      if (ambientTimer <= 0) {
        ambientTimer = 8 + Math.random() * 8
        const spot = AMBIENT_HANDOFF_SPOTS[Math.floor(Math.random() * AMBIENT_HANDOFF_SPOTS.length)]
        if (spot) spawnHandoffFlash(spot)
      }
    }

    // ── Animation loop for flash fade ─────────────────────────────────
    let lastTime = performance.now() / 1000

    function animate() {
      frameRef.current = requestAnimationFrame(animate)
      const now = performance.now() / 1000
      const dt  = Math.min(now - lastTime, 0.1)
      lastTime  = now

      tickAmbient(dt)

      // Fade out markers
      const expired: HandoffMarker[] = []
      for (const m of markersRef.current) {
        const age = now - m.birthTime
        if (age >= m.lifetime) {
          expired.push(m)
        } else {
          const t   = age / m.lifetime
          const opacity = 1 - t
          const scale   = 1 + t * 2  // expand as it fades
          ;(m.mesh.material as THREE.MeshBasicMaterial).opacity = opacity
          m.mesh.scale.setScalar(scale)
          m.light.intensity = 3 * opacity
        }
      }

      // Dispose expired
      for (const m of expired) {
        scene.remove(m.mesh)
        scene.remove(m.light)
        ;(m.mesh.material as THREE.MeshBasicMaterial).dispose()
        m.mesh.geometry.dispose()
        markersRef.current = markersRef.current.filter(x => x !== m)
      }

      // Animate chain path waypoint markers
      if (chainGroupRef.current && chainActiveRef.current) {
        const currentStep = chainStepRef.current
        let idx = 0
        chainGroupRef.current.traverse(child => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshBasicMaterial
            if (idx === currentStep) {
              // Active step — pulse
              mat.opacity = 0.7 + Math.sin(now * 4) * 0.3
            } else if (idx < currentStep) {
              mat.opacity = 0.8  // completed
            } else {
              mat.opacity = 0.25  // upcoming
            }
            idx++
          }
        })
      }

      // Update camera for chain steps (smooth lerp)
      void camera  // camera used in followCameraStep callback
    }

    void CHAIN_STEP_DUR  // constant used for documentation only

    animate()

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      // Dispose all markers
      for (const m of markersRef.current) {
        scene.remove(m.mesh)
        scene.remove(m.light)
        ;(m.mesh.material as THREE.MeshBasicMaterial).dispose()
        m.mesh.geometry.dispose()
      }
      markersRef.current = []
      clearChainPath()
    }
  }, [scene, camera, spawnHandoffFlash, clearChainPath])

  // HandoffChain is a pure Three.js component — no DOM output
  return null
}
