/**
 * CameraController.tsx — First person / third person / cinematic camera modes.
 *
 * FIRST_PERSON: WASD + QE movement, mouse drag to look, pitch clamped -80/+80°
 * THIRD_PERSON: Camera follows glowing orb 4 behind / 2 above
 * CINEMATIC:    Auto-pilot slow circle, altitude 20, 0.003 rad/frame
 */

import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'

// ── Enums ─────────────────────────────────────────────────────────────────────

export enum CameraMode {
  FIRST_PERSON = 'FIRST_PERSON',
  THIRD_PERSON = 'THIRD_PERSON',
  CINEMATIC = 'CINEMATIC',
}

interface CameraControllerProps {
  mode: CameraMode
  onModeChange: (mode: CameraMode) => void
  /** NW7: When true the built-in toggle UI is hidden (replaced by CommandHUD) */
  showUI?: boolean
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MOVE_SPEED = 0.15
const SPRINT_MULTIPLIER = 3
const MIN_Y = 2          // levitation floor
const PITCH_MIN = -80 * (Math.PI / 180)
const PITCH_MAX = 80 * (Math.PI / 180)
const CINEMATIC_RADIUS = 40
const CINEMATIC_ALTITUDE = 20
const CINEMATIC_SPEED = 0.003   // radians per frame

// ── Component ─────────────────────────────────────────────────────────────────

export function CameraController({ mode, onModeChange, showUI = true }: CameraControllerProps) {
  const { scene, camera, renderer } = useWorldContext()

  // Input state
  const keys = useRef<Record<string, boolean>>({})
  const isDragging = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  // Camera orientation
  const yaw = useRef(0)
  const pitch = useRef(0)

  // Position state (shared / accessible to CollisionSystem)
  const pos = useRef(new THREE.Vector3(0, MIN_Y, 10))

  // Cinematic angle
  const cinematicAngle = useRef(0)

  // Orb mesh for third person
  const orbRef = useRef<THREE.Mesh | null>(null)

  // ── Orb setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    const geo = new THREE.SphereGeometry(0.4, 16, 12)
    // NW7: Third-person orb glows company color #00ff88
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00cc66,
      emissiveIntensity: 1.8,
      roughness: 0.1,
      metalness: 0.3,
    })
    const orb = new THREE.Mesh(geo, mat)
    orb.castShadow = false
    orb.visible = false
    scene.add(orb)
    orbRef.current = orb
    return () => {
      scene.remove(orb)
      geo.dispose()
      mat.dispose()
    }
  }, [scene])

  // Toggle orb visibility based on mode
  useEffect(() => {
    if (orbRef.current) {
      orbRef.current.visible = mode === CameraMode.THIRD_PERSON
    }
  }, [mode])

  // ── Keyboard events ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { keys.current[e.code] = true }
    const onKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // ── Mouse drag events ─────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = renderer.domElement

    const onMouseDown = (e: MouseEvent) => {
      if (mode === CameraMode.CINEMATIC) return
      isDragging.current = true
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const dx = e.clientX - lastMouse.current.x
      const dy = e.clientY - lastMouse.current.y
      lastMouse.current = { x: e.clientX, y: e.clientY }

      yaw.current -= dx * 0.003
      pitch.current -= dy * 0.003
      pitch.current = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch.current))
    }

    const onMouseUp = () => { isDragging.current = false }

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    // Touch support
    const onTouchStart = (e: TouchEvent) => {
      if (mode === CameraMode.CINEMATIC) return
      if (e.touches.length === 1) {
        isDragging.current = true
        lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current || e.touches.length !== 1) return
      const dx = e.touches[0].clientX - lastMouse.current.x
      const dy = e.touches[0].clientY - lastMouse.current.y
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      yaw.current -= dx * 0.003
      pitch.current -= dy * 0.003
      pitch.current = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch.current))
    }
    const onTouchEnd = () => { isDragging.current = false }

    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd)

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [mode, renderer])

  // ── Per-frame update ──────────────────────────────────────────────────────
  useEffect(() => {
    // NW7: Track last position for speed dispatch
    const _lastPos = pos.current.clone()

    function onFrame() {
      if (mode === CameraMode.CINEMATIC) {
        updateCinematic()
      } else if (mode === CameraMode.FIRST_PERSON) {
        updateFirstPerson()
      } else if (mode === CameraMode.THIRD_PERSON) {
        updateThirdPerson()
      }
      // Dispatch player speed for CommandHUD
      const currentSpeed = pos.current.distanceTo(_lastPos)
      _lastPos.copy(pos.current)
      window.dispatchEvent(new CustomEvent('nw:player-speed', { detail: { speed: currentSpeed } }))
    }

    function updateFirstPerson() {
      const isSprint = keys.current['ShiftLeft'] || keys.current['ShiftRight']
      const speed = MOVE_SPEED * (isSprint ? SPRINT_MULTIPLIER : 1)

      // Build forward/right vectors from yaw only (for horizontal movement)
      const forward = new THREE.Vector3(
        -Math.sin(yaw.current),
        0,
        -Math.cos(yaw.current)
      )
      const right = new THREE.Vector3(
        Math.cos(yaw.current),
        0,
        -Math.sin(yaw.current)
      )

      if (keys.current['KeyW']) pos.current.addScaledVector(forward, speed)
      if (keys.current['KeyS']) pos.current.addScaledVector(forward, -speed)
      if (keys.current['KeyA']) pos.current.addScaledVector(right, -speed)
      if (keys.current['KeyD']) pos.current.addScaledVector(right, speed)
      if (keys.current['KeyQ']) pos.current.y += speed
      if (keys.current['KeyE']) pos.current.y -= speed

      // Collision: stay at min y=2
      if (pos.current.y < MIN_Y) pos.current.y = MIN_Y

      camera.position.copy(pos.current)
      applyYawPitch(camera)
    }

    function updateThirdPerson() {
      const isSprint = keys.current['ShiftLeft'] || keys.current['ShiftRight']
      const speed = MOVE_SPEED * (isSprint ? SPRINT_MULTIPLIER : 1)

      const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current))
      const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current))

      if (keys.current['KeyW']) pos.current.addScaledVector(forward, speed)
      if (keys.current['KeyS']) pos.current.addScaledVector(forward, -speed)
      if (keys.current['KeyA']) pos.current.addScaledVector(right, -speed)
      if (keys.current['KeyD']) pos.current.addScaledVector(right, speed)
      if (keys.current['KeyQ']) pos.current.y += speed
      if (keys.current['KeyE']) pos.current.y -= speed
      if (pos.current.y < MIN_Y) pos.current.y = MIN_Y

      // Orb follows player
      if (orbRef.current) {
        orbRef.current.position.copy(pos.current)
        // Subtle bob
        orbRef.current.position.y = pos.current.y + Math.sin(Date.now() * 0.002) * 0.15
      }

      // Camera trails 4 units behind, 2 above
      const behind = forward.clone().multiplyScalar(-4)
      const targetCamPos = pos.current.clone().add(behind)
      targetCamPos.y = pos.current.y + 2

      // Smooth follow
      camera.position.lerp(targetCamPos, 0.12)
      camera.lookAt(pos.current)
    }

    function updateCinematic() {
      cinematicAngle.current += CINEMATIC_SPEED
      const x = Math.sin(cinematicAngle.current) * CINEMATIC_RADIUS
      const z = Math.cos(cinematicAngle.current) * CINEMATIC_RADIUS
      camera.position.set(x, CINEMATIC_ALTITUDE, z)
      camera.lookAt(0, 0, 0)
    }

    function applyYawPitch(cam: THREE.PerspectiveCamera) {
      const euler = new THREE.Euler(pitch.current, yaw.current, 0, 'YXZ')
      cam.quaternion.setFromEuler(euler)
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [mode, camera])

  // ── Toggle UI ─────────────────────────────────────────────────────────────
  const modes = [
    { key: CameraMode.FIRST_PERSON, label: '1P' },
    { key: CameraMode.THIRD_PERSON, label: '3P' },
    { key: CameraMode.CINEMATIC, label: 'CIN' },
  ]

  // NW7: CommandHUD replaces built-in UI when showUI=false
  if (!showUI) return null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex',
        gap: 4,
        background: 'rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 20,
        padding: '5px 8px',
        backdropFilter: 'blur(6px)',
      }}
    >
      {modes.map(({ key, label }) => {
        const isActive = key === mode
        return (
          <button
            key={key}
            onClick={() => onModeChange(key)}
            style={{
              padding: '4px 14px',
              fontSize: 11,
              fontWeight: isActive ? 700 : 400,
              letterSpacing: 0.8,
              borderRadius: 14,
              border: 'none',
              background: isActive ? 'rgba(0,229,204,0.25)' : 'transparent',
              color: isActive ? '#00e5cc' : 'rgba(255,255,255,0.45)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
