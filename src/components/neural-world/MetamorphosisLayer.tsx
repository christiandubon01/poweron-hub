/**
 * MetamorphosisLayer.tsx — NW73: Phase transition cinematics.
 *
 * Detects when a project transitions between phases and plays a 4-second
 * cinematic transformation animation on its mountain in the Neural World.
 *
 * Phase order: bidding → rough-in → trim → final → complete
 *
 * Animations:
 *   bidding → rough-in : mountain cracks open, diamond core revealed, dust cloud, reforms taller
 *   rough-in → trim    : surface ripples like water, gold texture fades in, sparkle cascade
 *   trim → final       : mountain glows from within, pulsing brighter, crown of light at peak
 *   final → complete   : dramatic gold explosion, settles with permanent golden peak
 *
 * Camera:  auto-dollies to 20 units from transforming mountain, returns after.
 * Sound:   unique audio cue per transition (crack / ripple / glow / triumph).
 * Queue:   sequential playback with 1-second gap between transitions.
 * Replay:  click a completed mountain to replay its full metamorphosis history.
 * Skip:    click anywhere during animation to skip to end state.
 * Storage: phase state persisted to localStorage; project_phases table queried
 *          via Supabase (non-fatal if absent — falls back to DataBridge status).
 *
 * Export: named export `MetamorphosisLayer`
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWProject,
  type NWWorldData,
} from './DataBridge'
import { getAudioEngine } from './AudioEngine'
import { supabase } from '@/lib/supabase'

// ── Phase types ───────────────────────────────────────────────────────────────

/** Canonical phase enum for project lifecycle */
export type ProjectPhase = 'bidding' | 'rough-in' | 'trim' | 'final' | 'complete'

/** Ordered phase progression */
export const PHASE_ORDER: ProjectPhase[] = [
  'bidding', 'rough-in', 'trim', 'final', 'complete',
]

/** A single recorded phase transition for a project */
export interface PhaseTransition {
  projectId:  string
  from:       ProjectPhase
  to:         ProjectPhase
  detectedAt: number     // Date.now()
}

// ── Internal animation task ───────────────────────────────────────────────────

interface AnimationTask {
  projectId:      string
  projectName:    string
  from:           ProjectPhase
  to:             ProjectPhase
  worldX:         number
  worldZ:         number
  mountainHeight: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ANIM_DURATION_MS  = 4000
const QUEUE_GAP_MS      = 1000
const DOLLY_RADIUS      = 20
const PHASES_STORE_KEY  = 'nw_meta_phases_v1'
const HISTORY_STORE_KEY = 'nw_meta_history_v1'

// ── Phase helpers ─────────────────────────────────────────────────────────────

/** Map a project's DB status + phase_completion to a canonical ProjectPhase */
function inferPhase(project: NWProject): ProjectPhase {
  const { status, phase_completion } = project
  if (status === 'completed' || status === 'cancelled') return 'complete'
  if (status === 'lead'      || status === 'estimate')  return 'bidding'
  if (status === 'pending'   || status === 'approved')  return 'rough-in'
  if (status === 'in_progress') {
    if (phase_completion >= 75) return 'final'
    if (phase_completion >= 40) return 'trim'
    return 'rough-in'
  }
  return 'bidding'
}

/** Returns true if `next` is strictly later than `prev` in PHASE_ORDER */
function isAdvance(prev: ProjectPhase, next: ProjectPhase): boolean {
  return PHASE_ORDER.indexOf(next) > PHASE_ORDER.indexOf(prev)
}

// ── Persistence helpers ───────────────────────────────────────────────────────

function loadPhaseMap(): Record<string, ProjectPhase> {
  try {
    const raw = localStorage.getItem(PHASES_STORE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, ProjectPhase>) : {}
  } catch { return {} }
}

function savePhaseMap(map: Record<string, ProjectPhase>): void {
  try { localStorage.setItem(PHASES_STORE_KEY, JSON.stringify(map)) } catch { /* non-fatal */ }
}

function loadHistory(): Record<string, PhaseTransition[]> {
  try {
    const raw = localStorage.getItem(HISTORY_STORE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, PhaseTransition[]>) : {}
  } catch { return {} }
}

function saveHistory(hist: Record<string, PhaseTransition[]>): void {
  try { localStorage.setItem(HISTORY_STORE_KEY, JSON.stringify(hist)) } catch { /* non-fatal */ }
}

// ── Audio cues (via AudioEngine event channels) ───────────────────────────────

function playCrackSound(): void {
  const eng = getAudioEngine()
  if (!eng.isInitialized) return
  eng.playAutomationFailure()
  setTimeout(() => eng.playPhaseTransition(), 120)
}

function playRippleSound(): void {
  const eng = getAudioEngine()
  if (!eng.isInitialized) return
  eng.playPhaseTransition()
  setTimeout(() => eng.playCrystalChime(), 380)
}

function playGlowSound(): void {
  const eng = getAudioEngine()
  if (!eng.isInitialized) return
  eng.playInvoicePaid()
  setTimeout(() => eng.playCrystalChime(), 220)
  setTimeout(() => eng.playCrystalChime(), 620)
}

function playTriumphSound(): void {
  const eng = getAudioEngine()
  if (!eng.isInitialized) return
  eng.playNexusMerge()
  setTimeout(() => eng.playInvoicePaid(),   300)
  setTimeout(() => eng.playCrystalChime(),  600)
  setTimeout(() => eng.playCrystalChime(), 1050)
}

// ── Three.js helpers ──────────────────────────────────────────────────────────

/** Build a particle burst Points object at an origin with spread velocities */
function buildParticleBurst(
  count:  number,
  origin: THREE.Vector3,
  color:  number,
  spread: number,
  upBias: number,
): {
  points:     THREE.Points
  velocities: Float32Array
  disposeVfx: () => void
} {
  const positions  = new Float32Array(count * 3)
  const colorsArr  = new Float32Array(count * 3)
  const velocities = new Float32Array(count * 3)
  const c = new THREE.Color(color)

  for (let i = 0; i < count; i++) {
    positions[i * 3]     = origin.x
    positions[i * 3 + 1] = origin.y
    positions[i * 3 + 2] = origin.z
    colorsArr[i * 3]     = c.r
    colorsArr[i * 3 + 1] = c.g
    colorsArr[i * 3 + 2] = c.b
    const theta = Math.random() * Math.PI * 2
    const phi   = Math.acos(2 * Math.random() - 1)
    const r     = 0.4 + Math.random() * spread
    velocities[i * 3]     = Math.sin(phi) * Math.cos(theta) * r
    velocities[i * 3 + 1] = Math.abs(Math.cos(phi)) * r * upBias + Math.random() * upBias * 0.5
    velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colorsArr,  3))

  const mat = new THREE.PointsMaterial({
    size:            0.22,
    vertexColors:    true,
    transparent:     true,
    opacity:         1.0,
    depthWrite:      false,
    sizeAttenuation: true,
  })

  const points = new THREE.Points(geo, mat)
  const disposeVfx = () => { geo.dispose(); mat.dispose() }

  return { points, velocities, disposeVfx }
}

/** Walk the scene tree to find a LOD whose userData.projectId matches */
function findProjectLOD(scene: THREE.Scene, projectId: string): THREE.LOD | null {
  let found: THREE.LOD | null = null
  scene.traverse(obj => {
    if (!found && obj.userData.projectId === projectId && obj instanceof THREE.LOD) {
      found = obj
    }
  })
  return found
}

// ── Component props ───────────────────────────────────────────────────────────

export interface MetamorphosisLayerProps {
  /** When true, audio cues play through the AudioEngine event channel */
  audioEnabled?: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MetamorphosisLayer({ audioEnabled = true }: MetamorphosisLayerProps) {
  const { scene, camera, renderer } = useWorldContext()

  // ── UI state ───────────────────────────────────────────────────────────────

  const [animActive,   setAnimActive]   = useState(false)
  const [animLabel,    setAnimLabel]    = useState('')
  const [skipVisible,  setSkipVisible]  = useState(false)

  // ── Persistent data refs ───────────────────────────────────────────────────

  const phaseMapRef = useRef<Record<string, ProjectPhase>>(loadPhaseMap())
  const historyRef  = useRef<Record<string, PhaseTransition[]>>(loadHistory())

  // ── Animation queue refs ───────────────────────────────────────────────────

  const queueRef      = useRef<AnimationTask[]>([])
  const processingRef = useRef(false)
  const skipRef       = useRef(false)

  /**
   * cleanupRef holds callbacks to remove all temporary scene objects and
   * frame-event listeners created by the current animation.
   */
  const cleanupRef = useRef<Array<() => void>>([])

  // ── Orbit camera state tracking ────────────────────────────────────────────

  const orbitRadiusRef = useRef(80)
  const orbitTargetRef = useRef(new THREE.Vector3(0, 0, 0))
  const savedCamRef    = useRef<{ radius: number; target: THREE.Vector3 } | null>(null)

  useEffect(() => {
    const onRadius = (e: Event) => {
      const ev = e as CustomEvent<{ radius: number }>
      if (ev.detail?.radius !== undefined) orbitRadiusRef.current = ev.detail.radius
    }
    window.addEventListener('nw:orbit-radius', onRadius)
    return () => window.removeEventListener('nw:orbit-radius', onRadius)
  }, [])

  // ── Helpers: scene object registration ────────────────────────────────────

  /** Add a Three.js object to the scene, and register its cleanup */
  const sceneAdd = useCallback((obj: THREE.Object3D, disposeVfx: () => void) => {
    scene.add(obj)
    cleanupRef.current.push(() => {
      scene.remove(obj)
      disposeVfx()
    })
  }, [scene])

  /** Register a raw cleanup callback (e.g. removeEventListener) */
  const addCleanup = useCallback((fn: () => void) => {
    cleanupRef.current.push(fn)
  }, [])

  /** Run and clear all registered cleanup callbacks */
  const clearAll = useCallback(() => {
    for (const fn of cleanupRef.current) {
      try { fn() } catch { /* ignore */ }
    }
    cleanupRef.current = []
  }, [])

  // ── Camera dolly ──────────────────────────────────────────────────────────

  const dollyToMountain = useCallback((x: number, z: number, height: number) => {
    savedCamRef.current = {
      radius: orbitRadiusRef.current,
      target: orbitTargetRef.current.clone(),
    }
    window.dispatchEvent(new CustomEvent('nw:set-orbit-radius', {
      detail: { radius: DOLLY_RADIUS, target: { x, y: height * 0.5, z } },
    }))
  }, [])

  const dollyReturn = useCallback(() => {
    const saved = savedCamRef.current
    if (!saved) return
    window.dispatchEvent(new CustomEvent('nw:set-orbit-radius', {
      detail: {
        radius: saved.radius,
        target: { x: saved.target.x, y: saved.target.y, z: saved.target.z },
      },
    }))
    savedCamRef.current = null
  }, [])

  // ── Skip ──────────────────────────────────────────────────────────────────

  const triggerSkip = useCallback(() => {
    skipRef.current = true
  }, [])

  // Canvas click: skip during animation, or detect mountain-replay click
  useEffect(() => {
    const canvas = renderer.domElement
    const raycaster = new THREE.Raycaster()

    const onClick = (e: MouseEvent) => {
      // During animation — any click skips
      if (animActive) {
        triggerSkip()
        return
      }

      // Idle — raycast to check if user clicked a completed mountain for replay
      const rect = canvas.getBoundingClientRect()
      const nx =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
      const ny = -((e.clientY - rect.top)  / rect.height) * 2 + 1
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera)

      const targets: THREE.Object3D[] = []
      scene.traverse(obj => {
        if (obj.userData.projectId && obj instanceof THREE.LOD) targets.push(obj)
      })
      const hits = raycaster.intersectObjects(targets, true)
      if (hits.length === 0) return

      // Walk hierarchy to find the LOD node
      let hitObj: THREE.Object3D = hits[0].object
      while (hitObj.parent && !hitObj.userData.projectId) hitObj = hitObj.parent
      const projectId = hitObj.userData.projectId as string | undefined
      if (!projectId) return

      const history = historyRef.current[projectId]
      if (!history || history.length === 0) return

      // Build replay tasks from stored history
      const lod        = findProjectLOD(scene, projectId)
      const mtnHeight  = (lod?.userData.totalHeight as number  | undefined) ?? 3
      const projName   = (lod?.userData.projectName as string  | undefined) ?? projectId
      const worldPos   = seededPosition(projectId)

      const replayTasks: AnimationTask[] = history.map(tr => ({
        projectId,
        projectName:    projName,
        from:           tr.from,
        to:             tr.to,
        worldX:         worldPos.x,
        worldZ:         worldPos.z,
        mountainHeight: mtnHeight,
      }))

      queueRef.current = [...replayTasks, ...queueRef.current]
      processQueue()
    }

    canvas.addEventListener('click', onClick)
    return () => canvas.removeEventListener('click', onClick)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animActive, camera, scene, renderer, triggerSkip])

  // ── Core animation runner ─────────────────────────────────────────────────

  const runAnimation = useCallback((task: AnimationTask): Promise<void> => {
    return new Promise<void>(resolve => {
      skipRef.current = false
      setAnimActive(true)
      setSkipVisible(true)
      setAnimLabel(`${task.projectName}: ${task.from.toUpperCase()} → ${task.to.toUpperCase()}`)

      dollyToMountain(task.worldX, task.worldZ, task.mountainHeight)

      // Play audio cue
      if (audioEnabled) {
        const key = `${task.from}→${task.to}`
        if (key === 'bidding→rough-in')   playCrackSound()
        else if (key === 'rough-in→trim') playRippleSound()
        else if (key === 'trim→final')    playGlowSound()
        else if (key === 'final→complete')playTriumphSound()
      }

      // Derived world positions
      const base   = new THREE.Vector3(task.worldX, 0,                    task.worldZ)
      const origin = new THREE.Vector3(task.worldX, task.mountainHeight * 0.5, task.worldZ)
      const peak   = new THREE.Vector3(task.worldX, task.mountainHeight,   task.worldZ)
      const lod    = findProjectLOD(scene, task.projectId)

      // Safety: always resolve within 5 s
      const safeTimer = setTimeout(resolve, ANIM_DURATION_MS + 500)
      addCleanup(() => clearTimeout(safeTimer))

      // Dispatch to correct animation builder
      const key = `${task.from}→${task.to}`

      // ── 1. BIDDING → ROUGH-IN ─────────────────────────────────────────────
      if (key === 'bidding→rough-in') {
        // Crack ring at base
        const crackGeo = new THREE.TorusGeometry(task.mountainHeight * 0.28, 0.06, 8, 32)
        const crackMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
        const crackMesh = new THREE.Mesh(crackGeo, crackMat)
        crackMesh.position.copy(base)
        crackMesh.rotation.x = Math.PI / 2
        sceneAdd(crackMesh, () => { crackGeo.dispose(); crackMat.dispose() })

        // Diamond core light
        const coreLight = new THREE.PointLight(0xB9F2FF, 0, task.mountainHeight * 3.5)
        coreLight.position.copy(origin)
        sceneAdd(coreLight, () => coreLight.dispose())

        // Dust particles at base
        const { points: dust, velocities: dustVel, disposeVfx: dustDispose } =
          buildParticleBurst(120, base, 0xbbbbbb, 0.28, 1.6)
        sceneAdd(dust, dustDispose)

        // Diamond debris particles from core
        const { points: debris, velocities: debrisVel, disposeVfx: debrisDispose } =
          buildParticleBurst(60, origin, 0xB9F2FF, 0.45, 0.9)
        sceneAdd(debris, debrisDispose)

        // Temporarily boost emissive on mountain
        let restoreEm: (() => void) | null = null
        if (lod) {
          const highGrp = lod.levels[0]?.object as THREE.Group | undefined
          if (highGrp) {
            const saved: Array<{ mat: THREE.MeshStandardMaterial; ei: number }> = []
            highGrp.traverse(obj => {
              if (obj instanceof THREE.Mesh) {
                const mat = obj.material as THREE.MeshStandardMaterial
                if (mat?.emissiveIntensity !== undefined) {
                  saved.push({ mat, ei: mat.emissiveIntensity })
                  mat.emissiveIntensity = 3.5
                }
              }
            })
            restoreEm = () => saved.forEach(({ mat, ei }) => { mat.emissiveIntensity = ei })
          }
        }

        const startTime = performance.now()
        let done = false

        const onFrame = () => {
          if (done) return
          const elapsed = Math.min(performance.now() - startTime, ANIM_DURATION_MS)
          const t = elapsed / ANIM_DURATION_MS

          // Crack ring scales out and fades
          crackMesh.scale.setScalar(1 + t * 3.5)
          crackMat.opacity = Math.max(0, 0.9 * (1 - t * 1.2))

          // Diamond core light: spike then decay
          coreLight.intensity = t < 0.35
            ? (t / 0.35) * 9
            : Math.max(0, 9 * (1 - (t - 0.35) / 0.65))

          // Gravity-affected particles
          const gravity = 0.014 * t
          const dustPos  = dust.geometry.attributes.position   as THREE.BufferAttribute
          const debPos   = debris.geometry.attributes.position as THREE.BufferAttribute

          for (let i = 0; i < 120; i++) {
            dustPos.array[i * 3]     += dustVel[i * 3]     * 0.016
            dustPos.array[i * 3 + 1] += dustVel[i * 3 + 1] * 0.016 - gravity
            dustPos.array[i * 3 + 2] += dustVel[i * 3 + 2] * 0.016
          }
          dustPos.needsUpdate = true

          for (let i = 0; i < 60; i++) {
            debPos.array[i * 3]     += debrisVel[i * 3]     * 0.016
            debPos.array[i * 3 + 1] += debrisVel[i * 3 + 1] * 0.016 - gravity * 0.5
            debPos.array[i * 3 + 2] += debrisVel[i * 3 + 2] * 0.016
          }
          debPos.needsUpdate = true

          ;(dust.material   as THREE.PointsMaterial).opacity = Math.max(0, 1 - t * 1.3)
          ;(debris.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - t * 1.1)

          // Mountain reforms taller in the last 37.5% of the animation
          if (t > 0.625 && lod) {
            const reform = (t - 0.625) / 0.375
            lod.scale.setScalar(1 + reform * 0.15)
          }

          if (skipRef.current || elapsed >= ANIM_DURATION_MS) {
            done = true
            crackMat.opacity = 0
            coreLight.intensity = 0
            ;(dust.material   as THREE.PointsMaterial).opacity = 0
            ;(debris.material as THREE.PointsMaterial).opacity = 0
            if (lod) lod.scale.setScalar(1.15)
            restoreEm?.()
            clearTimeout(safeTimer)
            resolve()
          }
        }

        window.addEventListener('nw:frame', onFrame)
        addCleanup(() => window.removeEventListener('nw:frame', onFrame))
        return
      }

      // ── 2. ROUGH-IN → TRIM ───────────────────────────────────────────────
      if (key === 'rough-in→trim') {
        // Concentric ripple rings rising up the mountain
        const RING_COUNT = 5
        type RingEntry = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t0: number }
        const rings: RingEntry[] = []

        for (let i = 0; i < RING_COUNT; i++) {
          const baseR = task.mountainHeight * 0.27
          const geo   = new THREE.TorusGeometry(baseR, 0.07, 6, 24)
          const mat   = new THREE.MeshBasicMaterial({
            color: 0xFFD700, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
          })
          const mesh = new THREE.Mesh(geo, mat)
          mesh.position.copy(base)
          mesh.rotation.x = -Math.PI / 2
          sceneAdd(mesh, () => { geo.dispose(); mat.dispose() })
          rings.push({ mesh, mat, t0: i * 0.14 })
        }

        // Orbiting sparkle lights
        const SPARK_COUNT = 6
        const sparks: THREE.PointLight[] = []
        for (let i = 0; i < SPARK_COUNT; i++) {
          const light = new THREE.PointLight(0xFFD700, 0, 9)
          light.position.copy(origin)
          sceneAdd(light, () => light.dispose())
          sparks.push(light)
        }

        // Capture gold mesh state for restore
        type GoldSaved = { mat: THREE.MeshStandardMaterial; ei: number; emissive: THREE.Color }
        const goldSaved: GoldSaved[] = []
        if (lod) {
          const hg = lod.levels[0]?.object as THREE.Group | undefined
          hg?.traverse(obj => {
            if (obj instanceof THREE.Mesh && obj.name === 'gold') {
              const mat = obj.material as THREE.MeshStandardMaterial
              if (mat) goldSaved.push({ mat, ei: mat.emissiveIntensity, emissive: mat.emissive.clone() })
            }
          })
        }

        const startTime = performance.now()
        let done = false

        const onFrame = () => {
          if (done) return
          const elapsed = Math.min(performance.now() - startTime, ANIM_DURATION_MS)
          const t = elapsed / ANIM_DURATION_MS

          // Ripple rings ascend and shrink
          for (const { mesh, mat: rmat, t0 } of rings) {
            const lt = Math.max(0, Math.min(1, (t - t0) / (1 - t0 + 0.01)))
            const rY = lt * task.mountainHeight
            mesh.position.y = rY
            const sc = Math.max(0.04, 1 - (rY / task.mountainHeight) * 0.88)
            mesh.scale.setScalar(sc)
            rmat.opacity = Math.max(0, 0.85 * (1 - lt))
          }

          // Sparks orbit mountain and pulse
          for (let i = 0; i < sparks.length; i++) {
            const angle = t * Math.PI * 4 + (i / sparks.length) * Math.PI * 2
            const r     = task.mountainHeight * 0.24 * (1 - t * 0.45)
            sparks[i].position.set(
              task.worldX + Math.cos(angle) * r,
              origin.y + Math.sin(t * Math.PI * 3 + i * 1.1) * task.mountainHeight * 0.28,
              task.worldZ + Math.sin(angle) * r,
            )
            sparks[i].intensity = Math.max(0, Math.sin(t * Math.PI * 7 + i * 1.6)) * 3.5
          }

          // Gold layer emissive pulse
          if (lod) {
            const hg = lod.levels[0]?.object as THREE.Group | undefined
            hg?.traverse(obj => {
              if (obj instanceof THREE.Mesh && obj.name === 'gold') {
                const mat = obj.material as THREE.MeshStandardMaterial
                if (mat) mat.emissiveIntensity = 1.2 + Math.sin(t * Math.PI * 9) * 2.2
              }
            })
          }

          if (skipRef.current || elapsed >= ANIM_DURATION_MS) {
            done = true
            for (const { mat: rmat } of rings) rmat.opacity = 0
            for (const l of sparks) l.intensity = 0
            for (const { mat, ei } of goldSaved) mat.emissiveIntensity = ei
            clearTimeout(safeTimer)
            resolve()
          }
        }

        window.addEventListener('nw:frame', onFrame)
        addCleanup(() => window.removeEventListener('nw:frame', onFrame))
        return
      }

      // ── 3. TRIM → FINAL ──────────────────────────────────────────────────
      if (key === 'trim→final') {
        // Inner glow sphere
        const sphereGeo = new THREE.SphereGeometry(task.mountainHeight * 0.34, 12, 8)
        const sphereMat = new THREE.MeshBasicMaterial({
          color: 0xFFD700, transparent: true, opacity: 0,
        })
        const sphere = new THREE.Mesh(sphereGeo, sphereMat)
        sphere.position.copy(origin)
        sceneAdd(sphere, () => { sphereGeo.dispose(); sphereMat.dispose() })

        // Crown particle ring at peak
        const CROWN = 80
        const crownPos = new Float32Array(CROWN * 3)
        const crownVel = new Float32Array(CROWN * 3)
        for (let i = 0; i < CROWN; i++) {
          const angle = (i / CROWN) * Math.PI * 2
          const r = 0.25 + Math.random() * task.mountainHeight * 0.12
          crownPos[i * 3]     = task.worldX + Math.cos(angle) * r
          crownPos[i * 3 + 1] = task.mountainHeight
          crownPos[i * 3 + 2] = task.worldZ + Math.sin(angle) * r
          crownVel[i * 3]     = Math.cos(angle) * 0.018
          crownVel[i * 3 + 1] = 0.028 + Math.random() * 0.035
          crownVel[i * 3 + 2] = Math.sin(angle) * 0.018
        }
        const crownGeo = new THREE.BufferGeometry()
        crownGeo.setAttribute('position', new THREE.BufferAttribute(crownPos, 3))
        const crownMat = new THREE.PointsMaterial({
          color: 0xFFD700, size: 0.17, transparent: true, opacity: 1,
          depthWrite: false, sizeAttenuation: true,
        })
        const crownPts = new THREE.Points(crownGeo, crownMat)
        sceneAdd(crownPts, () => { crownGeo.dispose(); crownMat.dispose() })

        // Peak point light
        const peakLight = new THREE.PointLight(0xFFD700, 0, task.mountainHeight * 4.5)
        peakLight.position.copy(peak)
        sceneAdd(peakLight, () => peakLight.dispose())

        // Save mountain emissive state
        type EmSaved = { mat: THREE.MeshStandardMaterial; ei: number }
        const emSaved: EmSaved[] = []
        if (lod) {
          lod.traverse(obj => {
            if (obj instanceof THREE.Mesh) {
              const mat = obj.material as THREE.MeshStandardMaterial
              if (mat?.emissiveIntensity !== undefined) emSaved.push({ mat, ei: mat.emissiveIntensity })
            }
          })
        }

        const startTime = performance.now()
        let done = false

        const onFrame = () => {
          if (done) return
          const elapsed = Math.min(performance.now() - startTime, ANIM_DURATION_MS)
          const t = elapsed / ANIM_DURATION_MS

          // Inner sphere: fade in, pulse, fade out
          if (t < 0.2) {
            sphereMat.opacity = (t / 0.2) * 0.28
          } else if (t < 0.78) {
            sphereMat.opacity = 0.28 + Math.sin(((t - 0.2) / 0.58) * Math.PI * 6) * 0.09
          } else {
            sphereMat.opacity = Math.max(0, 0.28 * (1 - (t - 0.78) / 0.22))
          }
          sphere.scale.setScalar(1 + Math.sin(t * Math.PI * 4) * 0.07)

          // Crown particles drift upward
          const cPos = crownPts.geometry.attributes.position as THREE.BufferAttribute
          for (let i = 0; i < CROWN; i++) {
            cPos.array[i * 3]     += crownVel[i * 3]
            cPos.array[i * 3 + 1] += crownVel[i * 3 + 1]
            cPos.array[i * 3 + 2] += crownVel[i * 3 + 2]
          }
          cPos.needsUpdate = true
          crownMat.opacity = Math.max(0, 1 - t * 0.85)

          // Peak light pulsing brighter
          peakLight.intensity = 3.5 + Math.sin(t * Math.PI * 9) * 3.5

          // Mountain-wide emissive pulse
          if (lod) {
            lod.traverse(obj => {
              if (obj instanceof THREE.Mesh) {
                const mat = obj.material as THREE.MeshStandardMaterial
                if (mat?.emissiveIntensity !== undefined) {
                  mat.emissiveIntensity = 0.5 + Math.sin(t * Math.PI * 9) * 2.8
                }
              }
            })
          }

          if (skipRef.current || elapsed >= ANIM_DURATION_MS) {
            done = true
            sphereMat.opacity = 0
            crownMat.opacity  = 0
            peakLight.intensity = 0
            for (const { mat, ei } of emSaved) mat.emissiveIntensity = ei
            clearTimeout(safeTimer)
            resolve()
          }
        }

        window.addEventListener('nw:frame', onFrame)
        addCleanup(() => window.removeEventListener('nw:frame', onFrame))
        return
      }

      // ── 4. FINAL → COMPLETE ──────────────────────────────────────────────
      if (key === 'final→complete') {
        // Gold explosion burst
        const { points: goldBurst, velocities: goldVel, disposeVfx: goldDispose } =
          buildParticleBurst(200, origin, 0xFFD700, 1.3, 2.2)
        sceneAdd(goldBurst, goldDispose)

        // Secondary white flash particles
        const { points: flashBurst, velocities: flashVel, disposeVfx: flashDispose } =
          buildParticleBurst(80, peak, 0xffffff, 0.8, 1.5)
        sceneAdd(flashBurst, flashDispose)

        // Large flash point light
        const flashLight = new THREE.PointLight(0xFFD700, 0, task.mountainHeight * 7)
        flashLight.position.copy(origin)
        sceneAdd(flashLight, () => flashLight.dispose())

        // Permanent golden crown cone — stays in scene after animation
        const crownH   = task.mountainHeight * 0.20
        const crownGeo = new THREE.ConeGeometry(task.mountainHeight * 0.11, crownH, 8)
        const crownMat = new THREE.MeshStandardMaterial({
          color:             0xFFD700,
          emissive:          new THREE.Color(0xFFAA00),
          emissiveIntensity: 2.2,
          metalness:         1.0,
          roughness:         0.08,
        })
        const crownMesh = new THREE.Mesh(crownGeo, crownMat)
        crownMesh.position.set(task.worldX, task.mountainHeight + crownH * 0.5, task.worldZ)
        crownMesh.scale.setScalar(0)
        // Permanent — intentionally not in cleanupRef
        scene.add(crownMesh)

        const startTime = performance.now()
        let done = false

        const onFrame = () => {
          if (done) return
          const elapsed = Math.min(performance.now() - startTime, ANIM_DURATION_MS)
          const t = elapsed / ANIM_DURATION_MS

          // Explosion particles with gravity
          const grav = 0.015 * t
          const gPos = goldBurst.geometry.attributes.position  as THREE.BufferAttribute
          const fPos = flashBurst.geometry.attributes.position as THREE.BufferAttribute

          for (let i = 0; i < 200; i++) {
            gPos.array[i * 3]     += goldVel[i * 3]     * 0.016
            gPos.array[i * 3 + 1] += goldVel[i * 3 + 1] * 0.016 - grav
            gPos.array[i * 3 + 2] += goldVel[i * 3 + 2] * 0.016
          }
          gPos.needsUpdate = true

          for (let i = 0; i < 80; i++) {
            fPos.array[i * 3]     += flashVel[i * 3]     * 0.016
            fPos.array[i * 3 + 1] += flashVel[i * 3 + 1] * 0.016 - grav * 0.7
            fPos.array[i * 3 + 2] += flashVel[i * 3 + 2] * 0.016
          }
          fPos.needsUpdate = true

          ;(goldBurst.material  as THREE.PointsMaterial).opacity = Math.max(0, 1 - t * 1.15)
          ;(flashBurst.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - t * 1.4)

          // Flash light: spike then exponential decay
          if (t < 0.08) {
            flashLight.intensity = (t / 0.08) * 18
          } else {
            flashLight.intensity = Math.max(0, 18 * Math.exp(-(t - 0.08) * 4.5))
          }

          // Crown grows into place after explosion settles (t > 0.38)
          if (t > 0.38) {
            const grow = Math.min(1, (t - 0.38) / 0.42)
            // Ease out cubic
            const eased = 1 - Math.pow(1 - grow, 3)
            crownMesh.scale.setScalar(eased)
          }

          // Mountain gold layer ramps to permanent golden emissive (t > 0.5)
          if (t > 0.5 && lod) {
            const ramp = (t - 0.5) / 0.5
            lod.traverse(obj => {
              if (obj instanceof THREE.Mesh && obj.name === 'gold') {
                const mat = obj.material as THREE.MeshStandardMaterial
                if (mat) {
                  mat.emissive.setHex(0xFFAA00)
                  mat.emissiveIntensity = 0.5 + ramp * 2.8
                }
              }
            })
          }

          if (skipRef.current || elapsed >= ANIM_DURATION_MS) {
            done = true
            ;(goldBurst.material  as THREE.PointsMaterial).opacity = 0
            ;(flashBurst.material as THREE.PointsMaterial).opacity = 0
            flashLight.intensity = 0
            crownMesh.scale.setScalar(1)   // permanent crown at full size
            clearTimeout(safeTimer)
            resolve()
          }
        }

        window.addEventListener('nw:frame', onFrame)
        addCleanup(() => window.removeEventListener('nw:frame', onFrame))
        return
      }

      // Unknown transition — resolve immediately
      clearTimeout(safeTimer)
      resolve()
    })
  }, [scene, sceneAdd, addCleanup, dollyToMountain, audioEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Queue processor ───────────────────────────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const processQueue = useCallback(async () => {
    if (processingRef.current) return
    if (queueRef.current.length === 0) return
    processingRef.current = true

    while (queueRef.current.length > 0) {
      const task = queueRef.current.shift()!
      await runAnimation(task)

      // Tear down all temporary scene objects and frame listeners
      clearAll()
      dollyReturn()
      setAnimActive(false)
      setSkipVisible(false)

      if (queueRef.current.length > 0) {
        await new Promise<void>(r => setTimeout(r, QUEUE_GAP_MS))
      }
    }

    processingRef.current = false
  }, [runAnimation, clearAll, dollyReturn])

  // ── Phase transition detector ─────────────────────────────────────────────

  const detectTransitions = useCallback((projects: NWProject[]) => {
    const phaseMap = phaseMapRef.current
    const history  = historyRef.current
    const tasks: AnimationTask[] = []
    let dirty = false

    for (const project of projects) {
      const now   = inferPhase(project)
      const prev  = phaseMap[project.id]

      if (!prev) {
        // First sight: record baseline, no animation
        phaseMap[project.id] = now
        dirty = true
        continue
      }

      if (prev === now) continue

      if (isAdvance(prev, now)) {
        const fromIdx = PHASE_ORDER.indexOf(prev)
        const toIdx   = PHASE_ORDER.indexOf(now)
        const wPos    = seededPosition(project.id)
        const mtnH    = Math.max(0.5, contractValueToHeight(project.contract_value))

        for (let i = fromIdx; i < toIdx; i++) {
          const from = PHASE_ORDER[i]
          const to   = PHASE_ORDER[i + 1]
          const tr: PhaseTransition = { projectId: project.id, from, to, detectedAt: Date.now() }
          if (!history[project.id]) history[project.id] = []
          history[project.id].push(tr)
          tasks.push({
            projectId:      project.id,
            projectName:    project.name,
            from, to,
            worldX:         wPos.x,
            worldZ:         wPos.z,
            mountainHeight: mtnH,
          })
        }

        phaseMap[project.id] = now
        dirty = true
      }
    }

    if (dirty) {
      savePhaseMap(phaseMap)
      saveHistory(history)
    }

    if (tasks.length > 0) {
      queueRef.current.push(...tasks)
      processQueue()
    }
  }, [processQueue])

  // ── Subscribe to DataBridge world data ────────────────────────────────────

  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      detectTransitions(data.projects)
    })
    return unsub
  }, [detectTransitions])

  // ── Supplementary: query project_phases table (non-fatal) ────────────────

  useEffect(() => {
    let mounted = true

    const PHASE_NAME_MAP: Record<string, ProjectPhase> = {
      bidding:   'bidding',
      bid:       'bidding',
      estimate:  'bidding',
      rough_in:  'rough-in',
      'rough-in':'rough-in',
      roughin:   'rough-in',
      trim:      'trim',
      final:     'final',
      complete:  'complete',
      completed: 'complete',
    }

    const fetchProjectPhases = async () => {
      try {
        const result = await (supabase as any)
          .from('project_phases')
          .select('project_id, phase_name, entered_at')
          .order('entered_at', { ascending: false })

        if (!mounted || result.error || !Array.isArray(result.data)) return

        // Latest phase per project (data is ordered desc, so first entry is latest)
        const latestMap = new Map<string, string>()
        for (const row of result.data as Array<{ project_id: string; phase_name: string }>) {
          if (!latestMap.has(row.project_id)) latestMap.set(row.project_id, row.phase_name)
        }

        const phaseMap = phaseMapRef.current
        const history  = historyRef.current
        const tasks: AnimationTask[] = []
        let dirty = false

        for (const [projectId, phaseName] of latestMap) {
          const canon = PHASE_NAME_MAP[phaseName.toLowerCase()]
          if (!canon) continue

          const prev = phaseMap[projectId]
          if (!prev) { phaseMap[projectId] = canon; dirty = true; continue }
          if (!isAdvance(prev, canon)) continue

          const fromIdx = PHASE_ORDER.indexOf(prev)
          const toIdx   = PHASE_ORDER.indexOf(canon)
          const wPos    = seededPosition(projectId)

          for (let i = fromIdx; i < toIdx; i++) {
            const from = PHASE_ORDER[i]
            const to   = PHASE_ORDER[i + 1]
            const tr: PhaseTransition = { projectId, from, to, detectedAt: Date.now() }
            if (!history[projectId]) history[projectId] = []
            history[projectId].push(tr)
            tasks.push({
              projectId,
              projectName:    projectId,
              from, to,
              worldX:         wPos.x,
              worldZ:         wPos.z,
              mountainHeight: 3,  // safe default when project data not available
            })
          }

          phaseMap[projectId] = canon
          dirty = true
        }

        if (dirty) { savePhaseMap(phaseMap); saveHistory(history) }
        if (tasks.length > 0) {
          queueRef.current.push(...tasks)
          processQueue()
        }
      } catch {
        // Non-fatal — project_phases table may not exist yet
      }
    }

    fetchProjectPhases()
    return () => { mounted = false }
  }, [processQueue])

  // ── Unmount cleanup ───────────────────────────────────────────────────────

  useEffect(() => () => { clearAll() }, [clearAll])

  // ── UI overlay — only rendered during active animations ───────────────────

  if (!animActive) return null

  return (
    <div
      style={{
        position:       'absolute',
        inset:          0,
        pointerEvents:  'none',
        zIndex:         50,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'flex-end',
        paddingBottom:  68,
      }}
    >
      {/* Transition banner */}
      <div
        style={{
          marginBottom:   14,
          padding:        '8px 26px',
          background:     'rgba(0,0,0,0.72)',
          border:         '1px solid rgba(255,215,0,0.38)',
          borderRadius:   22,
          backdropFilter: 'blur(10px)',
          textAlign:      'center',
          pointerEvents:  'none',
        }}
      >
        <div
          style={{
            fontSize:      10,
            letterSpacing: 2.5,
            color:         'rgba(255,215,0,0.65)',
            fontFamily:    'monospace',
            textTransform: 'uppercase',
            marginBottom:  3,
          }}
        >
          ◆ METAMORPHOSIS ◆
        </div>
        <div
          style={{
            fontSize:   13,
            fontWeight: 700,
            color:      '#fff',
            fontFamily: 'monospace',
            letterSpacing: 0.5,
          }}
        >
          {animLabel}
        </div>
      </div>

      {/* Skip button */}
      {skipVisible && (
        <button
          onClick={e => { e.stopPropagation(); triggerSkip() }}
          style={{
            pointerEvents:  'auto',
            padding:        '5px 22px',
            fontSize:       10,
            letterSpacing:  2,
            fontFamily:     'monospace',
            fontWeight:     700,
            textTransform:  'uppercase',
            border:         '1px solid rgba(255,255,255,0.22)',
            borderRadius:   14,
            background:     'rgba(0,0,0,0.58)',
            color:          'rgba(255,255,255,0.52)',
            cursor:         'pointer',
            backdropFilter: 'blur(6px)',
            transition:     'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            ;(e.target as HTMLButtonElement).style.color = 'rgba(255,255,255,0.85)'
            ;(e.target as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.45)'
          }}
          onMouseLeave={e => {
            ;(e.target as HTMLButtonElement).style.color = 'rgba(255,255,255,0.52)'
            ;(e.target as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.22)'
          }}
        >
          SKIP  [ CLICK ANYWHERE ]
        </button>
      )}
    </div>
  )
}
