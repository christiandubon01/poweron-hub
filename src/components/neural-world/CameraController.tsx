/**
 * CameraController.tsx — NW7b: Full camera controls overhaul.
 *
 * FIRST_PERSON:
 *   W = ascend, S = descend, A = strafe left, D = strafe right
 *   Mouse drag (or pointer lock) = full 3D rotation — pitch & yaw UNCLAMPED for full spherical look
 *   Left Shift held OR toggled = x2 speed
 *   C held OR toggled = slow mode 0.3x
 *   Click inside canvas → request pointer lock; ESC releases
 *   Crosshair shown when pointer locked
 *   Mouse wheel = zoom only (0.1x–10x)
 *
 * THIRD_PERSON:
 *   WASD = lateral movement, Space = ascend, Z = descend
 *   Camera trails orb with smooth lerp
 *   Mouse drag rotates camera around orb on all axes
 *   Mouse wheel = zoom (distance to orb)
 *
 * CINEMATIC: Auto-pilot slow circle
 *
 * MOBILE DUAL JOYSTICK:
 *   Detect touch via navigator.maxTouchPoints > 0
 *   Left joystick bottom-left = movement
 *   Right joystick bottom-right = camera look
 *   Speed toggle button between joysticks
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'

// ── Enums ─────────────────────────────────────────────────────────────────────

export enum CameraMode {
  FIRST_PERSON = 'FIRST_PERSON',
  THIRD_PERSON = 'THIRD_PERSON',
  CINEMATIC = 'CINEMATIC',
}

export enum SpeedMode {
  SLOW = 'SLOW',       // 0.3x
  NORMAL = 'NORMAL',   // 1x
  FAST = 'FAST',       // 2x
}

interface CameraControllerProps {
  mode: CameraMode
  onModeChange: (mode: CameraMode) => void
  /** When true the built-in toggle UI is hidden (replaced by CommandHUD) */
  showUI?: boolean
}

// ── Constants ──────────────────────────────────────────────────────────────────

const BASE_MOVE_SPEED = 0.15
const SPEED_MULTIPLIERS: Record<SpeedMode, number> = {
  [SpeedMode.SLOW]: 0.3,
  [SpeedMode.NORMAL]: 1,
  [SpeedMode.FAST]: 2,
}
const MIN_Y = 2          // levitation floor
const CINEMATIC_RADIUS = 40
const CINEMATIC_ALTITUDE = 20
const CINEMATIC_SPEED = 0.003   // radians per frame
const MOUSE_SENSITIVITY = 0.003
const ZOOM_MIN = 0.1
const ZOOM_MAX = 10
const TP_TRAIL_DISTANCE = 4
const TP_TRAIL_HEIGHT = 2
const TP_LERP = 0.12

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

  // Position state
  const pos = useRef(new THREE.Vector3(0, MIN_Y, 10))

  // Cinematic angle
  const cinematicAngle = useRef(0)

  // Orb mesh for third person
  const orbRef = useRef<THREE.Mesh | null>(null)

  // Zoom / FOV state
  const zoomLevel = useRef(1.0)  // 1.0 = default
  const baseFOV = useRef(70)

  // Speed mode
  const speedModeRef = useRef<SpeedMode>(SpeedMode.NORMAL)
  const [speedModeState, setSpeedModeState] = useState<SpeedMode>(SpeedMode.NORMAL)
  const shiftToggled = useRef(false)
  const cToggled = useRef(false)

  // Pointer lock
  const pointerLocked = useRef(false)
  const [isPointerLocked, setIsPointerLocked] = useState(false)

  // Mobile detection
  const isTouchDevice = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

  // Joystick state refs
  const leftJoystick = useRef({ active: false, id: -1, startX: 0, startY: 0, dx: 0, dy: 0 })
  const rightJoystick = useRef({ active: false, id: -1, startX: 0, startY: 0, dx: 0, dy: 0 })

  // ── Orb setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    const geo = new THREE.SphereGeometry(0.4, 16, 12)
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

  // ── Resolve speed multiplier ──────────────────────────────────────────────
  const getSpeedMultiplier = useCallback(() => {
    // Held keys override toggles
    if (keys.current['ShiftLeft'] || keys.current['ShiftRight']) return SPEED_MULTIPLIERS[SpeedMode.FAST]
    if (keys.current['KeyC']) return SPEED_MULTIPLIERS[SpeedMode.SLOW]
    return SPEED_MULTIPLIERS[speedModeRef.current]
  }, [])

  // ── Keyboard events ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true

      // Toggle shift (speed x2)
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        // Just holding — toggle handled on key up if it was a tap
      }
      // Toggle C (slow mode)
      if (e.code === 'KeyC' && !e.repeat) {
        // Will be handled in speed dispatch
      }
      // ESC releases pointer lock
      if (e.code === 'Escape') {
        if (document.pointerLockElement) {
          document.exitPointerLock()
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false

      // Toggle speed modes on release (tap behavior)
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (speedModeRef.current === SpeedMode.FAST) {
          speedModeRef.current = SpeedMode.NORMAL
          setSpeedModeState(SpeedMode.NORMAL)
        } else {
          speedModeRef.current = SpeedMode.FAST
          setSpeedModeState(SpeedMode.FAST)
        }
        window.dispatchEvent(new CustomEvent('nw:speed-mode', { detail: { mode: speedModeRef.current } }))
      }
      if (e.code === 'KeyC') {
        if (speedModeRef.current === SpeedMode.SLOW) {
          speedModeRef.current = SpeedMode.NORMAL
          setSpeedModeState(SpeedMode.NORMAL)
        } else {
          speedModeRef.current = SpeedMode.SLOW
          setSpeedModeState(SpeedMode.SLOW)
        }
        window.dispatchEvent(new CustomEvent('nw:speed-mode', { detail: { mode: speedModeRef.current } }))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // ── Pointer lock change handler ──────────────────────────────────────────
  useEffect(() => {
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === renderer.domElement
      pointerLocked.current = locked
      setIsPointerLocked(locked)
    }
    document.addEventListener('pointerlockchange', onPointerLockChange)
    return () => document.removeEventListener('pointerlockchange', onPointerLockChange)
  }, [renderer])

  // ── Scroll lock: capture ALL wheel events on canvas, convert to zoom ──────
  useEffect(() => {
    const canvas = renderer.domElement

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? 1.08 : 0.92
      zoomLevel.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel.current * delta))
      camera.fov = baseFOV.current / zoomLevel.current
      camera.updateProjectionMatrix()
    }

    // Also capture at document level when Neural World is mounted
    const onDocWheel = (e: WheelEvent) => {
      // Check if the event target is inside our canvas container
      const container = canvas.parentElement
      if (container && (container.contains(e.target as Node) || e.target === canvas)) {
        e.preventDefault()
      }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('wheel', onDocWheel, { passive: false })

    return () => {
      canvas.removeEventListener('wheel', onWheel)
      document.removeEventListener('wheel', onDocWheel)
    }
  }, [renderer, camera])

  // ── Mouse drag events + pointer lock ─────────────────────────────────────
  useEffect(() => {
    const canvas = renderer.domElement

    const onMouseDown = (e: MouseEvent) => {
      if (mode === CameraMode.CINEMATIC) return
      // First person: request pointer lock on click
      if (mode === CameraMode.FIRST_PERSON && !pointerLocked.current) {
        canvas.requestPointerLock()
        return
      }
      isDragging.current = true
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }

    const onMouseMove = (e: MouseEvent) => {
      // Pointer lock mode: use movementX/Y
      if (pointerLocked.current) {
        yaw.current -= e.movementX * MOUSE_SENSITIVITY
        pitch.current -= e.movementY * MOUSE_SENSITIVITY
        // Full spherical — no clamp
        return
      }
      // Drag mode (third person)
      if (!isDragging.current) return
      const dx = e.clientX - lastMouse.current.x
      const dy = e.clientY - lastMouse.current.y
      lastMouse.current = { x: e.clientX, y: e.clientY }
      yaw.current -= dx * MOUSE_SENSITIVITY
      pitch.current -= dy * MOUSE_SENSITIVITY
      // Full spherical — no clamp for third person either
    }

    const onMouseUp = () => { isDragging.current = false }

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [mode, renderer])

  // ── Mobile joystick pointer events ────────────────────────────────────────
  useEffect(() => {
    if (!isTouchDevice) return

    const JOYSTICK_RADIUS = 36

    const onPointerDown = (e: PointerEvent) => {
      const x = e.clientX
      const y = e.clientY
      const w = window.innerWidth
      const h = window.innerHeight

      // Left half bottom → left joystick
      if (x < w / 2 && y > h * 0.5) {
        if (!leftJoystick.current.active) {
          leftJoystick.current = { active: true, id: e.pointerId, startX: x, startY: y, dx: 0, dy: 0 }
          window.dispatchEvent(new CustomEvent('nw:joystick-start', { detail: { side: 'left', x, y } }))
        }
      }
      // Right half bottom → right joystick
      else if (x >= w / 2 && y > h * 0.5) {
        if (!rightJoystick.current.active) {
          rightJoystick.current = { active: true, id: e.pointerId, startX: x, startY: y, dx: 0, dy: 0 }
          window.dispatchEvent(new CustomEvent('nw:joystick-start', { detail: { side: 'right', x, y } }))
        }
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (leftJoystick.current.active && e.pointerId === leftJoystick.current.id) {
        let dx = e.clientX - leftJoystick.current.startX
        let dy = e.clientY - leftJoystick.current.startY
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > JOYSTICK_RADIUS) {
          dx = (dx / dist) * JOYSTICK_RADIUS
          dy = (dy / dist) * JOYSTICK_RADIUS
        }
        leftJoystick.current.dx = dx / JOYSTICK_RADIUS
        leftJoystick.current.dy = dy / JOYSTICK_RADIUS
        window.dispatchEvent(new CustomEvent('nw:joystick-move', {
          detail: { side: 'left', dx: leftJoystick.current.dx, dy: leftJoystick.current.dy,
                    thumbX: leftJoystick.current.startX + dx, thumbY: leftJoystick.current.startY + dy }
        }))
      }
      if (rightJoystick.current.active && e.pointerId === rightJoystick.current.id) {
        let dx = e.clientX - rightJoystick.current.startX
        let dy = e.clientY - rightJoystick.current.startY
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > JOYSTICK_RADIUS) {
          dx = (dx / dist) * JOYSTICK_RADIUS
          dy = (dy / dist) * JOYSTICK_RADIUS
        }
        rightJoystick.current.dx = dx / JOYSTICK_RADIUS
        rightJoystick.current.dy = dy / JOYSTICK_RADIUS
        window.dispatchEvent(new CustomEvent('nw:joystick-move', {
          detail: { side: 'right', dx: rightJoystick.current.dx, dy: rightJoystick.current.dy,
                    thumbX: rightJoystick.current.startX + dx, thumbY: rightJoystick.current.startY + dy }
        }))
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (leftJoystick.current.active && e.pointerId === leftJoystick.current.id) {
        leftJoystick.current = { active: false, id: -1, startX: 0, startY: 0, dx: 0, dy: 0 }
        window.dispatchEvent(new CustomEvent('nw:joystick-end', { detail: { side: 'left' } }))
      }
      if (rightJoystick.current.active && e.pointerId === rightJoystick.current.id) {
        rightJoystick.current = { active: false, id: -1, startX: 0, startY: 0, dx: 0, dy: 0 }
        window.dispatchEvent(new CustomEvent('nw:joystick-end', { detail: { side: 'right' } }))
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)

    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [isTouchDevice, mode])

  // ── Per-frame update ──────────────────────────────────────────────────────
  useEffect(() => {
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
      const speedMult = getSpeedMultiplier()
      const speed = BASE_MOVE_SPEED * speedMult

      // Build strafe vectors from yaw
      const right = new THREE.Vector3(
        Math.cos(yaw.current),
        0,
        -Math.sin(yaw.current)
      )

      // NW7b: W = ascend, S = descend, A = strafe left, D = strafe right
      if (keys.current['KeyA']) pos.current.addScaledVector(right, -speed)
      if (keys.current['KeyD']) pos.current.addScaledVector(right, speed)
      if (keys.current['KeyW']) pos.current.y += speed
      if (keys.current['KeyS']) pos.current.y -= speed

      // Mobile joystick input
      if (leftJoystick.current.active) {
        const jx = leftJoystick.current.dx  // strafe
        const jy = leftJoystick.current.dy  // ascend/descend
        pos.current.addScaledVector(right, jx * speed)
        pos.current.y -= jy * speed  // invert: push up = ascend
      }
      if (rightJoystick.current.active) {
        yaw.current -= rightJoystick.current.dx * 0.04
        pitch.current -= rightJoystick.current.dy * 0.04
      }

      // Floor constraint
      if (pos.current.y < MIN_Y) pos.current.y = MIN_Y

      camera.position.copy(pos.current)
      applyYawPitch(camera)
    }

    function updateThirdPerson() {
      const speedMult = getSpeedMultiplier()
      const speed = BASE_MOVE_SPEED * speedMult

      const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current))
      const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current))

      // NW7b: WASD lateral, Space ascend, Z descend
      if (keys.current['KeyW']) pos.current.addScaledVector(forward, speed)
      if (keys.current['KeyS']) pos.current.addScaledVector(forward, -speed)
      if (keys.current['KeyA']) pos.current.addScaledVector(right, -speed)
      if (keys.current['KeyD']) pos.current.addScaledVector(right, speed)
      if (keys.current['Space']) pos.current.y += speed
      if (keys.current['KeyZ']) pos.current.y -= speed

      // Mobile joystick: left = forward/back + strafe
      if (leftJoystick.current.active) {
        pos.current.addScaledVector(right, leftJoystick.current.dx * speed)
        pos.current.addScaledVector(forward, -leftJoystick.current.dy * speed)
      }
      if (rightJoystick.current.active) {
        yaw.current -= rightJoystick.current.dx * 0.04
        pitch.current -= rightJoystick.current.dy * 0.04
      }

      if (pos.current.y < MIN_Y) pos.current.y = MIN_Y

      // Orb follows player
      if (orbRef.current) {
        orbRef.current.position.copy(pos.current)
        orbRef.current.position.y = pos.current.y + Math.sin(Date.now() * 0.002) * 0.15
      }

      // Camera orbits around orb based on yaw/pitch
      const dist = TP_TRAIL_DISTANCE / zoomLevel.current
      const camOffset = new THREE.Vector3(
        Math.sin(yaw.current) * Math.cos(pitch.current) * dist,
        Math.sin(pitch.current) * dist + TP_TRAIL_HEIGHT,
        Math.cos(yaw.current) * Math.cos(pitch.current) * dist,
      )
      const targetCamPos = pos.current.clone().add(camOffset)

      // Smooth follow
      camera.position.lerp(targetCamPos, TP_LERP)
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
  }, [mode, camera, getSpeedMultiplier])

  // ── Dispatch speed mode on mount ─────────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('nw:speed-mode', { detail: { mode: speedModeRef.current } }))
  }, [])

  // ── Release pointer lock on mode change ──────────────────────────────────
  useEffect(() => {
    if (mode !== CameraMode.FIRST_PERSON && document.pointerLockElement) {
      document.exitPointerLock()
    }
  }, [mode])

  // ── Toggle UI ─────────────────────────────────────────────────────────────
  if (!showUI) return null

  const modes = [
    { key: CameraMode.FIRST_PERSON, label: '1P' },
    { key: CameraMode.THIRD_PERSON, label: '3P' },
    { key: CameraMode.CINEMATIC, label: 'CIN' },
  ]

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
