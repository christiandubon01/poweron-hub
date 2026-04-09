/**
 * NexusCompanionAvatar.tsx — NW26: NEXUS 3D companion avatar.
 *
 * Humanoid form using:
 *   - CylinderGeometry (torso, legs)
 *   - SphereGeometry (head)
 *   - BoxGeometry (shoulders)
 *
 * Teal/cyan color matching NEXUS brand. Subtle glow. Wireframe overlay that
 * pulses when speaking. Floating "NEXUS" name tag above head.
 *
 * Height: ~2.0 units (human scale). Group origin at feet.
 * Position: 3 units right + 1 unit behind camera. Lerp 0.05.
 * Walk bob: y += sin(t*4) * 0.05 when camera is moving.
 * Head turns toward target node being discussed.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'

// ── Props ──────────────────────────────────────────────────────────────────────

interface NexusCompanionAvatarProps {
  /** Whether avatar should be rendered (mode === AVATAR_VOICE) */
  visible: boolean
  /** Whether NEXUS is currently speaking (drives wireframe pulse + glow) */
  speaking: boolean
  /** Optional world-space position of the node NEXUS is discussing (drives head turn) */
  targetNodeWorldPos?: THREE.Vector3 | null
}

// ── Component ──────────────────────────────────────────────────────────────────

export function NexusCompanionAvatar({
  visible,
  speaking,
  targetNodeWorldPos,
}: NexusCompanionAvatarProps) {
  const { scene, camera } = useWorldContext()

  // Three.js object refs
  const groupRef       = useRef<THREE.Group | null>(null)
  const headRef        = useRef<THREE.Mesh | null>(null)
  const wireGroupRef   = useRef<THREE.Group | null>(null)
  const glowRef        = useRef<THREE.PointLight | null>(null)

  // Animation state
  const timeRef        = useRef(0)
  const currentPosRef  = useRef(new THREE.Vector3(9999, 0, 9999))
  const prevCamPosRef  = useRef(new THREE.Vector3())

  // Sync props to refs (avoids stale-closure issues in frame loop)
  const visibleRef     = useRef(visible)
  const speakingRef    = useRef(speaking)
  const targetNodeRef  = useRef<THREE.Vector3 | null>(targetNodeWorldPos ?? null)

  useEffect(() => { visibleRef.current = visible },           [visible])
  useEffect(() => { speakingRef.current = speaking },         [speaking])
  useEffect(() => { targetNodeRef.current = targetNodeWorldPos ?? null }, [targetNodeWorldPos])

  // ── Build avatar geometry ─────────────────────────────────────────────────

  useEffect(() => {
    const TEAL = 0x00e5cc

    const mat = new THREE.MeshLambertMaterial({
      color:             TEAL,
      emissive:          new THREE.Color(0x003838),
      emissiveIntensity: 0.35,
    })

    const group = new THREE.Group()
    groupRef.current = group

    // ── Body geometry ───────────────────────────────────────────────────────

    // Legs (lower body) — CylinderGeometry: bottom at y=0, top at y=0.7
    const legGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8)
    const legs   = new THREE.Mesh(legGeo, mat)
    legs.position.y = 0.35  // center at 0.35
    group.add(legs)

    // Torso — CylinderGeometry: y 0.7 → 1.45
    const bodyGeo = new THREE.CylinderGeometry(0.2, 0.22, 0.75, 8)
    const body    = new THREE.Mesh(bodyGeo, mat)
    body.position.y = 1.075  // center at 1.075
    group.add(body)

    // Shoulders — BoxGeometry spanning y 1.38 → 1.53
    const shoulderGeo = new THREE.BoxGeometry(0.88, 0.15, 0.3)
    const shoulders   = new THREE.Mesh(shoulderGeo, mat)
    shoulders.position.y = 1.45
    group.add(shoulders)

    // Left arm
    const armGeo  = new THREE.CylinderGeometry(0.07, 0.09, 0.58, 6)
    const leftArm = new THREE.Mesh(armGeo, mat)
    leftArm.position.set(-0.50, 1.12, 0)
    leftArm.rotation.z = 0.18
    group.add(leftArm)

    // Right arm
    const rightArm = new THREE.Mesh(armGeo.clone(), mat)
    rightArm.position.set(0.50, 1.12, 0)
    rightArm.rotation.z = -0.18
    group.add(rightArm)

    // Head — SphereGeometry at y=1.75
    const headGeo  = new THREE.SphereGeometry(0.22, 10, 8)
    const headMesh = new THREE.Mesh(headGeo, mat)
    headMesh.position.y = 1.75
    headRef.current = headMesh
    group.add(headMesh)

    // ── Wireframe overlay group ─────────────────────────────────────────────

    const wireGroup = new THREE.Group()
    wireGroupRef.current = wireGroup

    function makewire(geo: THREE.BufferGeometry, yPos: number, scale: number): THREE.Mesh {
      const wireMat = new THREE.MeshBasicMaterial({
        color:       TEAL,
        wireframe:   true,
        transparent: true,
        opacity:     0.25,
        depthWrite:  false,
      })
      const m = new THREE.Mesh(geo.clone(), wireMat)
      m.position.y = yPos
      m.scale.setScalar(scale)
      return m
    }

    wireGroup.add(makewire(bodyGeo.clone(),    1.075, 1.06))
    wireGroup.add(makewire(headGeo.clone(),    1.75,  1.09))
    wireGroup.add(makewire(shoulderGeo.clone(), 1.45, 1.07))
    group.add(wireGroup)

    // ── Glow point light ────────────────────────────────────────────────────

    const glow = new THREE.PointLight(TEAL, 0.5, 9)
    glow.position.set(0, 1.0, 0)
    glowRef.current = glow
    group.add(glow)

    // ── "NEXUS" floating name tag sprite ────────────────────────────────────

    const canvas  = document.createElement('canvas')
    canvas.width  = 160
    canvas.height = 36
    const ctx     = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(0,15,25,0.82)'
    ctx.fillRect(0, 0, 160, 36)
    ctx.strokeStyle = '#00e5cc'
    ctx.lineWidth   = 1
    ctx.strokeRect(1, 1, 158, 34)
    ctx.font          = 'bold 16px monospace'
    ctx.fillStyle     = '#00e5cc'
    ctx.textAlign     = 'center'
    ctx.textBaseline  = 'middle'
    ctx.fillText('◈ NEXUS', 80, 18)

    const tex       = new THREE.CanvasTexture(canvas)
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
    const nameTag   = new THREE.Sprite(spriteMat)
    nameTag.scale.set(2.2, 0.55, 1)
    nameTag.position.y = 2.32
    group.add(nameTag)

    // ── Initial offscreen placement ─────────────────────────────────────────

    group.position.set(9999, 0, 9999)
    group.visible = false
    scene.add(group)

    return () => {
      scene.remove(group)
      // Dispose materials / geometries
      legGeo.dispose()
      bodyGeo.dispose()
      shoulderGeo.dispose()
      armGeo.dispose()
      headGeo.dispose()
      mat.dispose()
      spriteMat.dispose()
      tex.dispose()
    }
  }, [scene]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Frame update ──────────────────────────────────────────────────────────

  useEffect(() => {
    // Initialise prevCamPos to current camera pos so first-frame delta is 0
    prevCamPosRef.current.copy(camera.position)

    function onFrame() {
      const group = groupRef.current
      if (!group) return

      // Hide when mode is not AVATAR_VOICE
      if (!visibleRef.current) {
        group.visible = false
        return
      }
      group.visible = true

      // ── Compute target position ───────────────────────────────────────────

      const dir = new THREE.Vector3()
      camera.getWorldDirection(dir)

      // World-space right vector (always horizontal)
      const right = new THREE.Vector3()
      right.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()

      // Target: 3 units right + 1 unit behind camera, feet at y=0
      const target = new THREE.Vector3(
        camera.position.x + right.x * 3 - dir.x,
        0,  // feet on flat ground
        camera.position.z + right.z * 3 - dir.z,
      )

      // ── Detect camera movement (for bob) ─────────────────────────────────

      const camMoved = camera.position.distanceTo(prevCamPosRef.current) > 0.005
      prevCamPosRef.current.copy(camera.position)

      // ── Lerp avatar toward target (0.05 = slight delay) ──────────────────

      currentPosRef.current.lerp(target, 0.05)
      group.position.set(currentPosRef.current.x, 0, currentPosRef.current.z)

      // ── Walk bob animation ────────────────────────────────────────────────

      timeRef.current += 0.016
      if (camMoved) {
        group.position.y = Math.sin(timeRef.current * 4) * 0.05
      }

      // ── Facing direction (yaw matches camera) ─────────────────────────────

      const yaw = Math.atan2(dir.x, dir.z)
      group.rotation.y = yaw

      // ── Head turn toward target node ──────────────────────────────────────

      const head = headRef.current
      if (head) {
        const tgt = targetNodeRef.current
        if (tgt) {
          const toNode = tgt.clone().sub(group.position)
          const nodeYaw = Math.atan2(toNode.x, toNode.z)
          const relYaw  = nodeYaw - yaw
          head.rotation.y = THREE.MathUtils.clamp(relYaw, -Math.PI * 0.4, Math.PI * 0.4)
        } else {
          // Drift back to center
          head.rotation.y *= 0.92
        }
      }

      // ── Wireframe pulse ───────────────────────────────────────────────────

      const wg = wireGroupRef.current
      if (wg) {
        const isSpeaking = speakingRef.current
        const pulseOp    = isSpeaking
          ? Math.max(0, 0.35 + Math.sin(timeRef.current * 8) * 0.35)
          : Math.max(0, 0.18 + Math.sin(timeRef.current * 1.2) * 0.06)

        for (const child of wg.children) {
          const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
          mat.opacity = pulseOp
        }
      }

      // ── Glow intensity ────────────────────────────────────────────────────

      const glow = glowRef.current
      if (glow) {
        glow.intensity = speakingRef.current
          ? 1.4 + Math.sin(timeRef.current * 6) * 0.55
          : 0.4
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [camera]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
