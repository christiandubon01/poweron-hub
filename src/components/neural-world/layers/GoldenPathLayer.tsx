/**
 * GoldenPathLayer.tsx — NW45: Golden path waypoint system for Goal Mode.
 *
 * When Goal Mode is active:
 *  - Renders a glowing amber trail on the ground plane connecting mission waypoints
 *  - Each waypoint: hovering rotating diamond (3D), color-coded by priority
 *    red (priority 1-2), amber (priority 3), green (priority 4-5)
 *  - Waypoint label: mission description + estimated dollar value
 *  - Ambient gold particles drift along the path
 *  - On nw:goal-waypoint-complete: marker explodes gold particles + fades out
 *  - On nw:goal-mode-deactivate: all objects removed
 *
 * Priority colors: red (1-2 critical/urgent), amber (3 priority), green (4-5 bonus/optional)
 * Path: ground-level amber glow lines between markers in priority order
 * Markers: OctahedronGeometry hovering at y=2, slowly rotating, glow emissive
 */

import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { makeLabel, type NWLabel } from '../utils/makeLabel'
import type { GoalState, GoalMission } from '../GoalModePanel'

// ── Constants ─────────────────────────────────────────────────────────────────

const HOVER_Y        = 2.5       // waypoint marker height above ground
const MARKER_SIZE    = 1.4       // octahedron radius
const ROTATE_SPEED   = 0.7       // radians/second
const PATH_Y         = 0.25      // ground-level path height
const PATH_TUBE_R    = 0.15      // path tube radius
const PARTICLE_COUNT = 60        // ambient path particles
const PARTICLE_SPEED = 8         // units/second along path

// ── Priority → color ──────────────────────────────────────────────────────────

function priorityThreeColor(p: number): THREE.Color {
  if (p <= 2) return new THREE.Color(0xef4444)   // red
  if (p === 3) return new THREE.Color(0xf59e0b)  // amber
  return new THREE.Color(0x22c55e)               // green
}

// ── Waypoint positions — spread across world plane ───────────────────────────
// Positions are deterministic per mission index so they don't jump on re-render

function waypointPosition(index: number, total: number): THREE.Vector3 {
  // Spread missions in an arc from west to east, above ground
  const angle = (index / Math.max(total - 1, 1)) * Math.PI - Math.PI * 0.5
  const radius = 70 + index * 12
  const x = Math.cos(angle) * radius * 0.8 - 30
  const z = Math.sin(angle) * radius * 0.5 + index * 8 - 20
  return new THREE.Vector3(x, PATH_Y, z)
}

// ── Dollar format ─────────────────────────────────────────────────────────────

function fmt$(n: number): string {
  if (n >= 1000) return '$' + Math.round(n / 1000) + 'k'
  return '$' + Math.round(n)
}

// ── Explosion particles helper ────────────────────────────────────────────────

function createExplosion(scene: THREE.Scene, pos: THREE.Vector3): void {
  const N = 24
  const geo = new THREE.SphereGeometry(0.12, 4, 4)
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd700 })

  const particles: Array<{ mesh: THREE.Mesh; vel: THREE.Vector3; life: number }> = []
  for (let i = 0; i < N; i++) {
    const mesh = new THREE.Mesh(geo, mat.clone())
    mesh.position.copy(pos)
    mesh.position.y = HOVER_Y
    scene.add(mesh)
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 8,
      Math.random() * 6 + 2,
      (Math.random() - 0.5) * 8,
    )
    particles.push({ mesh, vel, life: 0 })
  }

  const duration = 0.8 // seconds
  const startTime = performance.now()

  function animate() {
    const elapsed = (performance.now() - startTime) / 1000
    if (elapsed > duration) {
      particles.forEach(p => {
        scene.remove(p.mesh)
        p.mesh.geometry.dispose()
        ;(p.mesh.material as THREE.MeshBasicMaterial).dispose()
      })
      geo.dispose()
      mat.dispose()
      return
    }
    const t = elapsed / duration
    particles.forEach(p => {
      p.mesh.position.x += p.vel.x * 0.016
      p.mesh.position.y += (p.vel.y - 9.8 * elapsed) * 0.016
      p.mesh.position.z += p.vel.z * 0.016
      ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t
      ;(p.mesh.material as THREE.MeshBasicMaterial).transparent = true
    })
    requestAnimationFrame(animate)
  }
  requestAnimationFrame(animate)
}

// ── Path particle system ──────────────────────────────────────────────────────

function createPathParticles(scene: THREE.Scene, positions: THREE.Vector3[]): THREE.Points | null {
  if (positions.length < 2) return null

  const posArray = new Float32Array(PARTICLE_COUNT * 3)
  const alphas   = new Float32Array(PARTICLE_COUNT)

  // Initialize particles along path
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const t   = i / PARTICLE_COUNT
    const seg = Math.floor(t * (positions.length - 1))
    const tl  = t * (positions.length - 1) - seg
    const a   = positions[Math.min(seg, positions.length - 1)]
    const b   = positions[Math.min(seg + 1, positions.length - 1)]
    posArray[i * 3]     = a.x + (b.x - a.x) * tl
    posArray[i * 3 + 1] = PATH_Y + 0.3
    posArray[i * 3 + 2] = a.z + (b.z - a.z) * tl
    alphas[i] = Math.random()
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3))
  const mat = new THREE.PointsMaterial({
    color:        0xffd700,
    size:         0.25,
    transparent:  true,
    opacity:      0.8,
    sizeAttenuation: true,
  })
  const pts = new THREE.Points(geo, mat)
  scene.add(pts)
  return pts
}

// ── GoldenPathLayer ───────────────────────────────────────────────────────────

const GoldenPathLayer: React.FC = () => {
  const { scene }     = useWorldContext()
  const objectsRef    = useRef<THREE.Object3D[]>([])
  const labelsRef     = useRef<NWLabel[]>([])
  const particlesRef  = useRef<THREE.Points | null>(null)
  const rafRef        = useRef<number>(0)
  const goalStateRef  = useRef<GoalState | null>(null)
  const markersRef    = useRef<Map<string, THREE.Mesh>>(new Map())
  const positionsRef  = useRef<THREE.Vector3[]>([])

  function clearAll() {
    cancelAnimationFrame(rafRef.current)
    objectsRef.current.forEach(obj => {
      scene.remove(obj)
      if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose()
      if ((obj as THREE.Mesh).material) {
        const mat = (obj as THREE.Mesh).material
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else (mat as THREE.Material).dispose()
      }
    })
    objectsRef.current = []
    labelsRef.current.forEach(l => scene.remove(l))
    labelsRef.current = []
    if (particlesRef.current) {
      scene.remove(particlesRef.current)
      particlesRef.current.geometry.dispose()
      ;(particlesRef.current.material as THREE.Material).dispose()
      particlesRef.current = null
    }
    markersRef.current.clear()
    positionsRef.current = []
  }

  function buildPath(state: GoalState) {
    clearAll()
    goalStateRef.current = state

    // Sort missions by priority (ascending = most important first)
    const missions = [...state.missions]
      .filter(m => !m.completed)
      .sort((a, b) => a.priority - b.priority)

    if (missions.length === 0) return

    const positions = missions.map((_, i) => waypointPosition(i, missions.length))
    positionsRef.current = positions

    // ── Ground path lines (tube between waypoints) ──────────────────────────
    for (let i = 0; i < positions.length - 1; i++) {
      const a = positions[i]
      const b = positions[i + 1]
      const dir    = b.clone().sub(a)
      const length = dir.length()
      const mid    = a.clone().add(b).multiplyScalar(0.5)

      const geo = new THREE.CylinderGeometry(PATH_TUBE_R, PATH_TUBE_R, length, 8)
      const mat = new THREE.MeshBasicMaterial({
        color:       0xf59e0b,
        transparent: true,
        opacity:     0.55,
      })
      const tube = new THREE.Mesh(geo, mat)
      tube.position.copy(mid)
      tube.position.y = PATH_Y
      tube.lookAt(b.x, PATH_Y, b.z)
      tube.rotateX(Math.PI / 2)
      scene.add(tube)
      objectsRef.current.push(tube)

      // Glow halo (slightly wider, more transparent)
      const glowGeo = new THREE.CylinderGeometry(PATH_TUBE_R * 2.5, PATH_TUBE_R * 2.5, length, 8)
      const glowMat = new THREE.MeshBasicMaterial({
        color:       0xffd700,
        transparent: true,
        opacity:     0.12,
      })
      const glow = new THREE.Mesh(glowGeo, glowMat)
      glow.position.copy(mid)
      glow.position.y = PATH_Y
      glow.lookAt(b.x, PATH_Y, b.z)
      glow.rotateX(Math.PI / 2)
      scene.add(glow)
      objectsRef.current.push(glow)
    }

    // ── Waypoint diamond markers ─────────────────────────────────────────────
    missions.forEach((mission, i) => {
      const pos   = positions[i]
      const color = priorityThreeColor(mission.priority)

      // Diamond (octahedron)
      const geo = new THREE.OctahedronGeometry(MARKER_SIZE, 0)
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive:          color,
        emissiveIntensity: 0.7,
        metalness:         0.8,
        roughness:         0.15,
        transparent:       true,
        opacity:           0.92,
      })
      const marker = new THREE.Mesh(geo, mat)
      marker.position.set(pos.x, HOVER_Y, pos.z)
      marker.userData.missionId = mission.id
      scene.add(marker)
      objectsRef.current.push(marker)
      markersRef.current.set(mission.id, marker)

      // Point light at marker
      const light = new THREE.PointLight(color, 1.2, 12)
      light.position.set(pos.x, HOVER_Y, pos.z)
      scene.add(light)
      objectsRef.current.push(light)

      // Ground circle glow
      const circleGeo = new THREE.CircleGeometry(2.5, 24)
      const circleMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity:     0.18,
        side:        THREE.DoubleSide,
      })
      const circle = new THREE.Mesh(circleGeo, circleMat)
      circle.rotation.x = -Math.PI / 2
      circle.position.set(pos.x, 0.05, pos.z)
      scene.add(circle)
      objectsRef.current.push(circle)

      // Label: description + value
      const labelText = `${mission.description} · ${fmt$(mission.estimated_value)}`
      const label = makeLabel(labelText, '#' + color.getHexString(), { labelType: 'agent' })
      label.position.set(pos.x, HOVER_Y + 2.5, pos.z)
      scene.add(label)
      labelsRef.current.push(label)
    })

    // ── Ambient path particles ───────────────────────────────────────────────
    particlesRef.current = createPathParticles(scene, positions)

    // ── Animation loop ───────────────────────────────────────────────────────
    let lastTime = performance.now()
    let particleOffsets = Array.from({ length: PARTICLE_COUNT }, (_, i) => i / PARTICLE_COUNT)

    function animate() {
      rafRef.current = requestAnimationFrame(animate)
      const now     = performance.now()
      const dt      = Math.min((now - lastTime) / 1000, 0.1)
      lastTime = now

      // Rotate all markers
      markersRef.current.forEach(marker => {
        marker.rotation.y += ROTATE_SPEED * dt
        marker.rotation.z += ROTATE_SPEED * 0.3 * dt
        // Bob up/down
        const t = now / 1000
        marker.position.y = HOVER_Y + Math.sin(t * 1.2 + marker.position.x * 0.1) * 0.35
      })

      // Animate path particles
      if (particlesRef.current && positionsRef.current.length >= 2) {
        const posAttr = particlesRef.current.geometry.getAttribute('position') as THREE.BufferAttribute
        const pts     = positionsRef.current
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          particleOffsets[i] = (particleOffsets[i] + dt * PARTICLE_SPEED / (pts.length * 10)) % 1
          const t   = particleOffsets[i]
          const seg = Math.floor(t * (pts.length - 1))
          const tl  = t * (pts.length - 1) - seg
          const a   = pts[Math.min(seg, pts.length - 1)]
          const b   = pts[Math.min(seg + 1, pts.length - 1)]
          posAttr.setXYZ(
            i,
            a.x + (b.x - a.x) * tl,
            PATH_Y + 0.3 + Math.sin(t * Math.PI * 4) * 0.15,
            a.z + (b.z - a.z) * tl,
          )
        }
        posAttr.needsUpdate = true
      }
    }
    animate()
  }

  useEffect(() => {
    function onActivate(e: Event) {
      const state = (e as CustomEvent<GoalState>).detail
      buildPath(state)
    }

    function onDeactivate() {
      clearAll()
      goalStateRef.current = null
    }

    function onWaypointComplete(e: Event) {
      const { missionId } = (e as CustomEvent<{ missionId: string }>).detail
      const marker = markersRef.current.get(missionId)
      if (marker && scene) {
        createExplosion(scene, marker.position)
        // Fade out marker
        const mat = marker.material as THREE.MeshStandardMaterial
        let opacity = mat.opacity
        const fadeOut = setInterval(() => {
          opacity -= 0.04
          if (opacity <= 0) {
            clearInterval(fadeOut)
            scene.remove(marker)
            marker.geometry.dispose()
            mat.dispose()
            markersRef.current.delete(missionId)
          } else {
            mat.opacity = opacity
          }
        }, 16)
      }
      // Rebuild path with updated state from goal state
      if (goalStateRef.current) {
        const updated: GoalState = {
          ...goalStateRef.current,
          missions: goalStateRef.current.missions.map(m =>
            m.id === missionId ? { ...m, completed: true } : m
          ),
        }
        goalStateRef.current = updated
        // Rebuild path after short delay (let explosion finish)
        setTimeout(() => {
          if (goalStateRef.current?.active) buildPath(goalStateRef.current)
        }, 900)
      }
    }

    window.addEventListener('nw:goal-mode-activate', onActivate)
    window.addEventListener('nw:goal-mode-deactivate', onDeactivate)
    window.addEventListener('nw:goal-waypoint-complete', onWaypointComplete)
    return () => {
      window.removeEventListener('nw:goal-mode-activate', onActivate)
      window.removeEventListener('nw:goal-mode-deactivate', onDeactivate)
      window.removeEventListener('nw:goal-waypoint-complete', onWaypointComplete)
      clearAll()
    }
  }, [scene])

  return null
}

export { GoldenPathLayer }
export default GoldenPathLayer
