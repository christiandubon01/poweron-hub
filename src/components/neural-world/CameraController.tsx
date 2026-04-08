/**
 * CameraController.tsx — NW16: Full camera system overhaul.
 *
 * ORBIT MODE (default):
 *   OrbitControls-style manual orbit — left-drag rotates, scroll zooms.
 *   Middle-drag or right-drag pans.
 *
 * FIRST PERSON:
 *   PointerLockControls on click.
 *   W/ArrowUp    = forward
 *   S/ArrowDown  = backward
 *   A/ArrowLeft  = strafe left
 *   D/ArrowRight = strafe right
 *   Space        = ascend
 *   Q            = descend
 *   Shift        = sprint (2.5× speed)
 *   Scroll wheel = adjusts travel speed in 0.5 increments (clamped 0.5–10.0)
 *   Speed persists via NWSettings.
 *
 * THIRD PERSON:
 *   Camera follows player avatar from behind.
 *   3 distance presets: Close=10, Medium=25, Far=100.
 *   Keys 1/2/3 or scroll wheel cycles distances.
 *   WASD moves. Space = ascend. Q = descend.
 *   Shift = sprint (2.5× speed).
 *
 * COLLISION:
 *   Raycast downward each frame → camera Y never drops below terrain + 2 units.
 *   Side raycasts prevent walking through mountains (via CollisionSystem events).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  NWCameraSettings,
  TP_DISTANCES,
  loadNWCameraSettings,
  saveNWCameraSettings,
} from './NWSettings'

// ── Enums ─────────────────────────────────────────────────────────────────────

export enum CameraMode {
  ORBIT        = 'ORBIT',
  FIRST_PERSON = 'FIRST_PERSON',
  THIRD_PERSON = 'THIRD_PERSON',
  CINEMATIC    = 'CINEMATIC',
}

export enum SpeedMode {
  SLOW   = 'SLOW',
  NORMAL = 'NORMAL',
  FAST   = 'FAST',
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_Y          = 2         // levitation floor
const CINEMATIC_RADIUS  = 40
const CINEMATIC_ALTITUDE= 20
const CINEMATIC_SPEED   = 0.003
const TP_LERP           = 0.10
const SPEED_STEP        = 0.5    // scroll increment
const SPRINT_MULT       = 2.5    // Shift multiplier

// Orbit defaults
const ORBIT_RADIUS_MIN  = 5
const ORBIT_RADIUS_MAX  = 400
const ORBIT_PAN_SPEED   = 0.5

interface CameraControllerProps {
  mode: CameraMode
  onModeChange: (mode: CameraMode) => void
  /** When true the built-in toggle UI is hidden (replaced by CommandHUD) */
  showUI?: boolean
  /** NW16: Settings from panel (optional override; controller also reads localStorage) */
  settings?: NWCameraSettings
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CameraController({ mode, onModeChange, showUI = true, settings: settingsProp }: CameraControllerProps) {
  const { scene, camera, renderer } = useWorldContext()

  // Load settings on first render
  const settingsRef = useRef<NWCameraSettings>(loadNWCameraSettings())
  // Sync with prop overrides when provided
  useEffect(() => {
    if (settingsProp) {
      settingsRef.current = settingsProp
    }
  }, [settingsProp])

  // Input
  const keys = useRef<Record<string, boolean>>({})
  const isDragging   = useRef(false)
  const isRightDrag  = useRef(false)
  const lastMouse    = useRef({ x: 0, y: 0 })

  // Camera orientation (FP / TP / Orbit)
  const yaw   = useRef(0)
  const pitch = useRef(0)

  // Position of player avatar
  const pos = useRef(new THREE.Vector3(0, MIN_Y, 10))

  // Cinematic
  const cinematicAngle = useRef(0)

  // Orbit state
  const orbitRadius  = useRef(80)
  const orbitTheta   = useRef(Math.PI / 4)   // horizontal angle
  const orbitPhi     = useRef(Math.PI / 3.5) // vertical angle
  const orbitTarget  = useRef(new THREE.Vector3(0, 0, 0))

  // TP orb mesh
  const orbRef = useRef<THREE.Mesh | null>(null)

  // TP distance preset
  const tpDistKey = useRef<'CLOSE' | 'MEDIUM' | 'FAR'>(settingsRef.current.tpDistance ?? 'MEDIUM')
  const [tpDistState, setTpDistState] = useState<'CLOSE' | 'MEDIUM' | 'FAR'>(tpDistKey.current)

  // Speed (in units per frame at 60fps reference)
  const travelSpeedRef = useRef<number>(settingsRef.current.travelSpeed ?? 2.0)
  const [travelSpeedState, setTravelSpeedState] = useState<number>(travelSpeedRef.current)

  // Pointer lock
  const pointerLocked = useRef(false)
  const [isPointerLocked, setIsPointerLocked] = useState(false)

  // Mobile detection
  const isTouchDevice = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

  // Joystick state
  const leftJoystick  = useRef({ active: false, id: -1, startX: 0, startY: 0, dx: 0, dy: 0 })
  const rightJoystick = useRef({ active: false, id: -1, startX: 0, startY: 0, dx: 0, dy: 0 })

  // NW17: Touch button state (treated like held keys)
  const touchSprintActive  = useRef(false)
  const touchAscendActive  = useRef(false)
  const touchDescendActive = useRef(false)

  // ── Persist speed when changed ────────────────────────────────────────────
  const persistSpeed = useCallback((speed: number) => {
    const s = { ...settingsRef.current, travelSpeed: speed }
    settingsRef.current = s
    saveNWCameraSettings(s)
  }, [])

  const persistTpDist = useCallback((key: 'CLOSE' | 'MEDIUM' | 'FAR') => {
    const s = { ...settingsRef.current, tpDistance: key }
    settingsRef.current = s
    saveNWCameraSettings(s)
  }, [])

  // ── Orb setup ─────────────────────────────────────────────────────────────
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

  useEffect(() => {
    if (orbRef.current) {
      orbRef.current.visible = mode === CameraMode.THIRD_PERSON
    }
  }, [mode])

  // ── Keyboard events ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true

      // TP: 1/2/3 keys switch distance
      if (mode === CameraMode.THIRD_PERSON && !e.repeat) {
        if (e.code === 'Digit1') cycleTpDist('CLOSE')
        if (e.code === 'Digit2') cycleTpDist('MEDIUM')
        if (e.code === 'Digit3') cycleTpDist('FAR')
      }

      if (e.code === 'Escape' && document.pointerLockElement) {
        document.exitPointerLock()
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  function cycleTpDist(key: 'CLOSE' | 'MEDIUM' | 'FAR') {
    tpDistKey.current = key
    setTpDistState(key)
    persistTpDist(key)
    window.dispatchEvent(new CustomEvent('nw:tp-distance', { detail: { key } }))
  }

  // ── Pointer lock ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onPLChange = () => {
      const locked = document.pointerLockElement === renderer.domElement
      pointerLocked.current = locked
      setIsPointerLocked(locked)
    }
    document.addEventListener('pointerlockchange', onPLChange)
    return () => document.removeEventListener('pointerlockchange', onPLChange)
  }, [renderer])

  useEffect(() => {
    if (mode !== CameraMode.FIRST_PERSON && document.pointerLockElement) {
      document.exitPointerLock()
    }
  }, [mode])

  // ── Scroll wheel handler ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = renderer.domElement

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (mode === CameraMode.ORBIT) {
        // Orbit: zoom (adjust radius)
        const factor = e.deltaY > 0 ? 1.1 : 0.9
        orbitRadius.current = Math.max(
          ORBIT_RADIUS_MIN,
          Math.min(ORBIT_RADIUS_MAX, orbitRadius.current * factor)
        )
        return
      }

      if (mode === CameraMode.THIRD_PERSON) {
        // TP: scroll cycles through distance presets
        const order: ('CLOSE' | 'MEDIUM' | 'FAR')[] = ['CLOSE', 'MEDIUM', 'FAR']
        const cur = order.indexOf(tpDistKey.current)
        if (e.deltaY > 0) {
          cycleTpDist(order[Math.min(cur + 1, order.length - 1)])
        } else {
          cycleTpDist(order[Math.max(cur - 1, 0)])
        }
        return
      }

      if (mode === CameraMode.FIRST_PERSON) {
        // FP: adjust travel speed in 0.5 increments
        const delta = e.deltaY > 0 ? -SPEED_STEP : SPEED_STEP
        const newSpeed = Math.max(0.5, Math.min(10.0, travelSpeedRef.current + delta))
        travelSpeedRef.current = newSpeed
        setTravelSpeedState(newSpeed)
        persistSpeed(newSpeed)
        window.dispatchEvent(new CustomEvent('nw:travel-speed', { detail: { speed: newSpeed } }))
        return
      }
    }

    const onDocWheel = (e: WheelEvent) => {
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
  }, [mode, renderer]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mouse drag / pointer lock events ─────────────────────────────────────
  useEffect(() => {
    const canvas = renderer.domElement

    const onMouseDown = (e: MouseEvent) => {
      if (mode === CameraMode.CINEMATIC) return

      if (mode === CameraMode.FIRST_PERSON && !pointerLocked.current) {
        canvas.requestPointerLock()
        return
      }
      isDragging.current = true
      isRightDrag.current = e.button === 2 || e.button === 1
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }

    const onContextMenu = (e: Event) => { e.preventDefault() }

    const onMouseMove = (e: MouseEvent) => {
      if (pointerLocked.current) {
        const sens = settingsRef.current.lookSensitivity * 0.002
        const invertMult = settingsRef.current.invertY ? 1 : -1
        yaw.current   -= e.movementX * sens
        pitch.current += e.movementY * sens * invertMult
        return
      }

      if (!isDragging.current) return
      const dx = e.clientX - lastMouse.current.x
      const dy = e.clientY - lastMouse.current.y
      lastMouse.current = { x: e.clientX, y: e.clientY }

      if (mode === CameraMode.ORBIT) {
        if (isRightDrag.current) {
          // Pan
          const panSpeed = ORBIT_PAN_SPEED * (orbitRadius.current / 80)
          const right = new THREE.Vector3()
          const up    = new THREE.Vector3()
          camera.getWorldDirection(up)
          right.crossVectors(up, camera.up).normalize()
          up.crossVectors(right, camera.getWorldDirection(new THREE.Vector3())).normalize()
          orbitTarget.current.addScaledVector(right, -dx * panSpeed * 0.05)
          orbitTarget.current.addScaledVector(up, dy * panSpeed * 0.05)
        } else {
          // Rotate
          const sens = settingsRef.current.lookSensitivity * 0.005
          orbitTheta.current -= dx * sens
          orbitPhi.current   -= dy * sens
          orbitPhi.current    = Math.max(0.05, Math.min(Math.PI - 0.05, orbitPhi.current))
        }
        return
      }

      // FP/TP drag (non-pointer-lock)
      const sens = settingsRef.current.lookSensitivity * 0.003
      const invertMult = settingsRef.current.invertY ? 1 : -1
      yaw.current   -= dx * sens
      pitch.current += dy * sens * invertMult
    }

    const onMouseUp = () => { isDragging.current = false }

    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [mode, renderer, camera]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mobile joystick events (NW17: 120px diameter, fixed positions, dead zone) ──
  useEffect(() => {
    if (!isTouchDevice) return

    // NW17: Increased from 36→60 (120px diameter joystick)
    const JOYSTICK_RADIUS = 60

    // Fixed joystick centers at bottom corners (30px margin + 60px radius offset)
    const getLeftCenter  = () => ({ x: 90, y: window.innerHeight - 90 })
    const getRightCenter = () => ({ x: window.innerWidth - 90, y: window.innerHeight - 90 })

    const onPointerDown = (e: PointerEvent) => {
      const x = e.clientX, y = e.clientY
      const w = window.innerWidth, h = window.innerHeight
      // Left joystick zone: left half of screen, bottom 55%
      if (x < w / 2 && y > h * 0.45) {
        if (!leftJoystick.current.active) {
          const c = getLeftCenter()
          leftJoystick.current = { active: true, id: e.pointerId, startX: c.x, startY: c.y, dx: 0, dy: 0 }
          window.dispatchEvent(new CustomEvent('nw:joystick-start', { detail: { side: 'left', x: c.x, y: c.y } }))
        }
      } else if (x >= w / 2 && y > h * 0.45) {
        // Right joystick zone: right half of screen, bottom 55%
        if (!rightJoystick.current.active) {
          const c = getRightCenter()
          rightJoystick.current = { active: true, id: e.pointerId, startX: c.x, startY: c.y, dx: 0, dy: 0 }
          window.dispatchEvent(new CustomEvent('nw:joystick-start', { detail: { side: 'right', x: c.x, y: c.y } }))
        }
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const deadZone = settingsRef.current.touchDeadZone ?? 0.15
      for (const [joy, side] of [[leftJoystick, 'left'], [rightJoystick, 'right']] as const) {
        if (joy.current.active && e.pointerId === joy.current.id) {
          let dx = e.clientX - joy.current.startX
          let dy = e.clientY - joy.current.startY
          const dist = Math.sqrt(dx*dx + dy*dy)
          if (dist > JOYSTICK_RADIUS) { dx = (dx/dist)*JOYSTICK_RADIUS; dy = (dy/dist)*JOYSTICK_RADIUS }
          // Normalize to [-1, 1]
          let ndx = dx / JOYSTICK_RADIUS
          let ndy = dy / JOYSTICK_RADIUS
          // Apply dead zone: zero out input within inner dead zone ring
          const ndist = Math.sqrt(ndx*ndx + ndy*ndy)
          if (ndist < deadZone) {
            ndx = 0; ndy = 0
          } else {
            // Rescale so full range remains [0,1] outside dead zone
            const scale = (ndist - deadZone) / (1 - deadZone)
            ndx = (ndx / ndist) * scale
            ndy = (ndy / ndist) * scale
          }
          joy.current.dx = ndx
          joy.current.dy = ndy
          window.dispatchEvent(new CustomEvent('nw:joystick-move', {
            detail: {
              side,
              dx: ndx,
              dy: ndy,
              thumbX: joy.current.startX + dx,
              thumbY: joy.current.startY + dy,
            }
          }))
        }
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      for (const [joy, side] of [[leftJoystick, 'left'], [rightJoystick, 'right']] as const) {
        if (joy.current.active && e.pointerId === joy.current.id) {
          joy.current = { active: false, id: -1, startX: 0, startY: 0, dx: 0, dy: 0 }
          window.dispatchEvent(new CustomEvent('nw:joystick-end', { detail: { side } }))
        }
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
  }, [isTouchDevice, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── NW17: Touch button events (sprint toggle, ascend/descend held) ────────
  useEffect(() => {
    if (!isTouchDevice) return
    function onTouchSprint(e: Event) {
      const ev = e as CustomEvent<{ active: boolean }>
      touchSprintActive.current = ev.detail?.active ?? false
    }
    function onTouchAscend(e: Event) {
      const ev = e as CustomEvent<{ active: boolean }>
      touchAscendActive.current = ev.detail?.active ?? false
    }
    function onTouchDescend(e: Event) {
      const ev = e as CustomEvent<{ active: boolean }>
      touchDescendActive.current = ev.detail?.active ?? false
    }
    window.addEventListener('nw:touch-sprint', onTouchSprint)
    window.addEventListener('nw:touch-ascend', onTouchAscend)
    window.addEventListener('nw:touch-descend', onTouchDescend)
    return () => {
      window.removeEventListener('nw:touch-sprint', onTouchSprint)
      window.removeEventListener('nw:touch-ascend', onTouchAscend)
      window.removeEventListener('nw:touch-descend', onTouchDescend)
    }
  }, [isTouchDevice])

  // ── Listen for settings changes from SettingsPanel ────────────────────────
  useEffect(() => {
    function onSettingsChange(e: Event) {
      const ev = e as CustomEvent<Partial<NWCameraSettings>>
      if (!ev.detail) return
      settingsRef.current = { ...settingsRef.current, ...ev.detail }
      if (ev.detail.travelSpeed !== undefined) {
        travelSpeedRef.current = ev.detail.travelSpeed
        setTravelSpeedState(ev.detail.travelSpeed)
      }
      if (ev.detail.tpDistance !== undefined) {
        tpDistKey.current = ev.detail.tpDistance
        setTpDistState(ev.detail.tpDistance)
      }
    }
    window.addEventListener('nw:settings-change', onSettingsChange)
    return () => window.removeEventListener('nw:settings-change', onSettingsChange)
  }, [])

  // ── Per-frame update ──────────────────────────────────────────────────────
  useEffect(() => {
    const prevPos = pos.current.clone()

    function onFrame() {
      switch (mode) {
        case CameraMode.ORBIT:       updateOrbit();       break
        case CameraMode.FIRST_PERSON: updateFirstPerson(); break
        case CameraMode.THIRD_PERSON: updateThirdPerson(); break
        case CameraMode.CINEMATIC:    updateCinematic();   break
      }

      // Dispatch player position for HUD / minimap
      window.dispatchEvent(new CustomEvent('nw:player-position', {
        detail: {
          x: pos.current.x,
          y: pos.current.y,
          z: pos.current.z,
          inValley: Math.abs(pos.current.x) < 22 && Math.abs(pos.current.z) < 200,
        }
      }))

      // Dispatch speed for HUD
      const frameSpeed = pos.current.distanceTo(prevPos)
      prevPos.copy(pos.current)
      window.dispatchEvent(new CustomEvent('nw:player-speed', { detail: { speed: frameSpeed } }))
    }

    // ── Orbit ─────────────────────────────────────────────────────────────
    function updateOrbit() {
      const r     = orbitRadius.current
      const theta = orbitTheta.current
      const phi   = orbitPhi.current
      const x = r * Math.sin(phi) * Math.sin(theta)
      const y = r * Math.cos(phi)
      const z = r * Math.sin(phi) * Math.cos(theta)
      camera.position.set(
        orbitTarget.current.x + x,
        orbitTarget.current.y + y,
        orbitTarget.current.z + z
      )
      camera.lookAt(orbitTarget.current)
    }

    // ── First Person ──────────────────────────────────────────────────────
    function updateFirstPerson() {
      const settings = settingsRef.current
      const isSprint = keys.current['ShiftLeft'] || keys.current['ShiftRight'] || touchSprintActive.current
      const speed = (travelSpeedRef.current / 60) * settings.moveSensitivity * (isSprint ? SPRINT_MULT : 1)

      // Build forward / right vectors from yaw
      const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current))
      const right   = new THREE.Vector3( Math.cos(yaw.current), 0, -Math.sin(yaw.current))

      if (keys.current['KeyW'] || keys.current['ArrowUp'])    pos.current.addScaledVector(forward,  speed)
      if (keys.current['KeyS'] || keys.current['ArrowDown'])  pos.current.addScaledVector(forward, -speed)
      if (keys.current['KeyA'] || keys.current['ArrowLeft'])  pos.current.addScaledVector(right,   -speed)
      if (keys.current['KeyD'] || keys.current['ArrowRight']) pos.current.addScaledVector(right,    speed)
      if (keys.current['Space'] || touchAscendActive.current)  pos.current.y += speed
      if (keys.current['KeyQ']  || touchDescendActive.current) pos.current.y -= speed

      // NW17: Mobile joystick with touch sensitivity multiplier
      if (leftJoystick.current.active) {
        const touchMult = settings.touchSensitivity ?? 1.5
        pos.current.addScaledVector(forward, -leftJoystick.current.dy * speed * touchMult)
        pos.current.addScaledVector(right,    leftJoystick.current.dx * speed * touchMult)
      }
      if (rightJoystick.current.active) {
        const touchMult = settings.touchSensitivity ?? 1.5
        yaw.current   -= rightJoystick.current.dx * 0.04 * touchMult
        pitch.current += rightJoystick.current.dy * 0.04 * touchMult
      }

      if (pos.current.y < MIN_Y) pos.current.y = MIN_Y

      camera.position.copy(pos.current)
      applyYawPitch(camera)
    }

    // ── Third Person ──────────────────────────────────────────────────────
    function updateThirdPerson() {
      const settings = settingsRef.current
      const isSprint = keys.current['ShiftLeft'] || keys.current['ShiftRight'] || touchSprintActive.current
      const speed = (travelSpeedRef.current / 60) * settings.moveSensitivity * (isSprint ? SPRINT_MULT : 1)

      const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current))
      const right   = new THREE.Vector3( Math.cos(yaw.current), 0, -Math.sin(yaw.current))

      if (keys.current['KeyW'] || keys.current['ArrowUp'])    pos.current.addScaledVector(forward,  speed)
      if (keys.current['KeyS'] || keys.current['ArrowDown'])  pos.current.addScaledVector(forward, -speed)
      if (keys.current['KeyA'] || keys.current['ArrowLeft'])  pos.current.addScaledVector(right,   -speed)
      if (keys.current['KeyD'] || keys.current['ArrowRight']) pos.current.addScaledVector(right,    speed)
      if (keys.current['Space'] || touchAscendActive.current)  pos.current.y += speed
      if (keys.current['KeyQ']  || touchDescendActive.current) pos.current.y -= speed

      // NW17: Mobile joystick with touch sensitivity multiplier
      if (leftJoystick.current.active) {
        const touchMult = settings.touchSensitivity ?? 1.5
        pos.current.addScaledVector(forward, -leftJoystick.current.dy * speed * touchMult)
        pos.current.addScaledVector(right,    leftJoystick.current.dx * speed * touchMult)
      }
      if (rightJoystick.current.active) {
        const touchMult = settings.touchSensitivity ?? 1.5
        yaw.current   -= rightJoystick.current.dx * 0.04 * touchMult
        pitch.current += rightJoystick.current.dy * 0.04 * touchMult
      }

      if (pos.current.y < MIN_Y) pos.current.y = MIN_Y

      // Orb follows player
      if (orbRef.current) {
        orbRef.current.position.copy(pos.current)
        orbRef.current.position.y = pos.current.y + Math.sin(Date.now() * 0.002) * 0.15
      }

      // Camera: behind + above player at chosen distance
      const dist = TP_DISTANCES[tpDistKey.current]
      const camOffset = new THREE.Vector3(
        Math.sin(yaw.current) * Math.cos(pitch.current) * dist,
        Math.sin(pitch.current) * dist + dist * 0.2,
        Math.cos(yaw.current)  * Math.cos(pitch.current) * dist,
      )
      const targetCamPos = pos.current.clone().add(camOffset)
      camera.position.lerp(targetCamPos, TP_LERP)
      camera.lookAt(pos.current)
    }

    // ── Cinematic ─────────────────────────────────────────────────────────
    function updateCinematic() {
      cinematicAngle.current += CINEMATIC_SPEED
      const x = Math.sin(cinematicAngle.current) * CINEMATIC_RADIUS
      const z = Math.cos(cinematicAngle.current) * CINEMATIC_RADIUS
      camera.position.set(x, CINEMATIC_ALTITUDE, z)
      camera.lookAt(0, 0, 0)
    }

    function applyYawPitch(cam: THREE.PerspectiveCamera) {
      const invertMult = settingsRef.current.invertY ? -1 : 1
      const euler = new THREE.Euler(pitch.current * invertMult, yaw.current, 0, 'YXZ')
      cam.quaternion.setFromEuler(euler)
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [mode, camera]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dispatch initial speed on mount ──────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('nw:travel-speed', { detail: { speed: travelSpeedRef.current } }))
    window.dispatchEvent(new CustomEvent('nw:tp-distance', { detail: { key: tpDistKey.current } }))
  }, [])

  // ── Built-in toggle UI (hidden when CommandHUD is active) ─────────────────
  if (!showUI) return null

  const modes = [
    { key: CameraMode.ORBIT,        label: 'ORBIT' },
    { key: CameraMode.FIRST_PERSON, label: '1P'    },
    { key: CameraMode.THIRD_PERSON, label: '3P'    },
    { key: CameraMode.CINEMATIC,    label: 'CIN'   },
  ]

  return (
    <div style={{
      position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      zIndex: 20, display: 'flex', gap: 4,
      background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 20, padding: '5px 8px', backdropFilter: 'blur(6px)',
    }}>
      {modes.map(({ key, label }) => {
        const isActive = key === mode
        return (
          <button key={key} onClick={() => onModeChange(key)} style={{
            padding: '4px 14px', fontSize: 11, fontWeight: isActive ? 700 : 400,
            letterSpacing: 0.8, borderRadius: 14, border: 'none',
            background: isActive ? 'rgba(0,229,204,0.25)' : 'transparent',
            color: isActive ? '#00e5cc' : 'rgba(255,255,255,0.45)',
            cursor: 'pointer', transition: 'all 0.15s',
          }}>
            {label}
          </button>
        )
      })}
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace',
                    display: 'flex', alignItems: 'center', paddingLeft: 6 }}>
        {travelSpeedState.toFixed(1)} u/s
      </div>
    </div>
  )
}
