/**
 * TerrainGenerator.tsx — NW38: Geological cross-section mountains.
 *
 * NW2  scope: project mountains driven by contract_value
 * NW6  scope: scenario height multiplier via nw:scenario-override events
 * NW15 scope: LOD (8/5/3 segments) + frustum culling
 * NW38 scope: Replace single ConeGeometry with 5 stacked CylinderGeometry rings:
 *   1. OBSIDIAN  (base) — risk / open RFIs
 *   2. RUBY             — expenses (materials + labor)
 *   3. EMERALD          — management effort (hours logged)
 *   4. GOLD             — billable completed work (billed to date)
 *   5. DIAMOND   (top)  — unbilled potential
 *
 * Performance budget per NW38:
 *   - LOD: 8 segs (close), 5 (medium, 50+), 3 (far, 120+)
 *   - Gold sparkle PointLights: max 3 per mountain, only on closest 5 mountains
 *   - Transformation ripple: plays once per phase change, not per frame
 *   - Material animTick: emissive pulse on high-LOD group only
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'
import {
  initDataBridge,
  disposeDataBridge,
  subscribeWorldData,
  seededPosition,
  contractValueToHeight,
  type NWProject,
  type NWWorldData,
} from './DataBridge'
import {
  buildGeologicalMountainLOD,
  computeRingFractions,
  type GeoMtnHandle,
} from './utils/GeologicalMountain'

// ── Mountain runtime record ────────────────────────────────────────────────────

interface Mountain {
  handle:            GeoMtnHandle
  ring:              THREE.Mesh | null
  pulseAmplitude:    number   // 0.02–0.12
  pulseSpeed:        number   // radians / second
  pulseOffset:       number   // randomised start phase
  projectId:         string
  x:                 number
  z:                 number
  scenarioMultiplier: number
  /** cleanup callback for any active transformation ripple */
  rippleCleanup:     (() => void) | null
  /** whether this mountain currently has gold sparkle lights active */
  sparkleActive:     boolean
}

function isProjectOverdue(p: NWProject): boolean {
  return (p.status === 'on_hold' || p.status === 'in_progress') && p.health_score < 60
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TerrainGenerator() {
  const { scene, applyScenario } = useWorldContext()

  const mountainsRef      = useRef<Mountain[]>([])
  const frameHandlerRef   = useRef<(() => void) | null>(null)
  const clockRef          = useRef(new THREE.Clock())
  const elapsedRef        = useRef(0)

  // NW6: scenario override map — projectId → heightMultiplier
  const scenarioOverridesRef = useRef<Record<string, number>>({})
  const applyScenarioRef     = useRef(applyScenario)
  applyScenarioRef.current   = applyScenario

  // ── Build geological mountains from world data ─────────────────────────────

  function buildMountains(data: NWWorldData) {
    disposeMountains()

    const { projects, rfis, fieldLogs, invoices } = data
    const mountains: Mountain[] = []

    for (const project of projects) {
      const { x, z } = seededPosition(project.id)
      const overdue   = isProjectOverdue(project)
      const height    = Math.max(0.5, contractValueToHeight(project.contract_value))
      const radius    = height * 0.3

      // ── NW38: geological LOD mountain ──────────────────────────────────────
      const handle = buildGeologicalMountainLOD(project, rfis, fieldLogs, invoices)

      // Position: geological mountains root at y=0 (origin at ground level)
      handle.lod.position.set(x, 0, z)
      handle.lod.userData.projectId     = project.id
      handle.lod.userData.projectName   = project.name
      handle.lod.userData.mountainRadius = radius

      scene.add(handle.lod)

      // ── Risk ring at base for overdue / unhealthy projects ─────────────────
      let ring: THREE.Mesh | null = null
      if (overdue || project.health_score < 60) {
        const ringGeo = new THREE.TorusGeometry(radius * 1.4, 0.12, 6, 32)
        const ringMat = new THREE.MeshBasicMaterial({
          color:       0xff3300,
          transparent: true,
          opacity:     0.7,
        })
        ring = new THREE.Mesh(ringGeo, ringMat)
        ring.frustumCulled = true
        ring.rotation.x    = Math.PI / 2
        ring.position.set(x, 0.1, z)
        scene.add(ring)
      }

      // ── Pulse parameters ───────────────────────────────────────────────────
      // Low health = more visible pulse; healthy = subtle
      const riskAmplitude = project.health_score < 60
        ? 0.06 + (60 - project.health_score) / 60 * 0.06
        : 0.02
      const pulseSpeed  = 1.5 + Math.random() * 0.5
      const pulseOffset = Math.random() * Math.PI * 2

      const mountain: Mountain = {
        handle,
        ring,
        pulseAmplitude: riskAmplitude,
        pulseSpeed,
        pulseOffset,
        projectId: project.id,
        x,
        z,
        scenarioMultiplier: scenarioOverridesRef.current[project.id] ?? 1.0,
        rippleCleanup: null,
        sparkleActive: false,
      }

      mountains.push(mountain)

      // Register with CollisionSystem
      window.dispatchEvent(new CustomEvent('nw:register-mountain', {
        detail: { x, z, radius, projectId: project.id },
      }))
    }

    mountainsRef.current = mountains
  }

  // ── Gold sparkle light management ─────────────────────────────────────────
  // Only the 5 closest mountains to camera get sparkle lights.
  // Called inside the frame handler when camera moves significantly.

  const cameraRef = useRef<THREE.Camera | null>(null)
  const sparkleRankRef = useRef<Set<string>>(new Set())

  function updateSparkleAssignments() {
    const cam = cameraRef.current
    if (!cam) return
    const camPos = cam.position

    // Sort mountains by distance to camera
    const sorted = [...mountainsRef.current].sort((a, b) => {
      const dA = camPos.distanceToSquared(new THREE.Vector3(a.x, 0, a.z))
      const dB = camPos.distanceToSquared(new THREE.Vector3(b.x, 0, b.z))
      return dA - dB
    })

    const newRank = new Set(sorted.slice(0, 5).map(m => m.projectId))

    // Enable sparkle for newly-ranked mountains
    for (const m of sorted) {
      const shouldHave = newRank.has(m.projectId)
      if (shouldHave && !m.sparkleActive) {
        const goldLayerY =
          (m.handle.fracs.obsidian + m.handle.fracs.ruby + m.handle.fracs.emerald) *
          m.handle.totalHeight +
          m.handle.fracs.gold * m.handle.totalHeight * 0.5
        m.handle.setGoldSparkle(scene, m.x, goldLayerY, m.z)
        m.sparkleActive = true
      } else if (!shouldHave && m.sparkleActive) {
        m.handle.setGoldSparkle(null, m.x, 0, m.z)
        m.sparkleActive = false
      }
    }

    sparkleRankRef.current = newRank
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  function disposeMountains() {
    for (const m of mountainsRef.current) {
      // Cancel any active ripple
      if (m.rippleCleanup) { m.rippleCleanup(); m.rippleCleanup = null }

      // Remove sparkle lights
      if (m.sparkleActive) {
        m.handle.setGoldSparkle(null, m.x, 0, m.z)
        m.sparkleActive = false
      }

      scene.remove(m.handle.lod)
      m.handle.dispose()

      if (m.ring) {
        scene.remove(m.ring)
        m.ring.geometry.dispose()
        if (Array.isArray(m.ring.material)) {
          m.ring.material.forEach(mat => mat.dispose())
        } else {
          m.ring.material.dispose()
        }
      }
    }
    mountainsRef.current = []
    window.dispatchEvent(new CustomEvent('nw:clear-mountains'))
  }

  // ── Frame handler: pulse + material animation ──────────────────────────────

  function setupFrameHandler() {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
    }

    clockRef.current.start()
    elapsedRef.current = 0
    let sparkleTickCounter = 0

    const handler = () => {
      const delta = clockRef.current.getDelta()
      elapsedRef.current += delta
      const t = elapsedRef.current

      // Update sparkle assignments every ~60 frames (~1s at 60fps)
      sparkleTickCounter++
      if (sparkleTickCounter >= 60) {
        sparkleTickCounter = 0
        updateSparkleAssignments()
      }

      for (const m of mountainsRef.current) {
        const phase     = t * m.pulseSpeed + m.pulseOffset
        const pulse     = 1 + Math.sin(phase) * m.pulseAmplitude
        const sm        = m.scenarioMultiplier

        // Scale the LOD group; geological mountains root at y=0 so no Y correction needed
        m.handle.lod.scale.set(pulse, sm * pulse, pulse)

        // Animate material emissive / sparkle lights
        m.handle.animTick(t)

        // Pulse ring opacity if present
        if (m.ring) {
          const ringMat = m.ring.material as THREE.MeshBasicMaterial
          ringMat.opacity = 0.4 + Math.abs(Math.sin(phase * 2)) * 0.4
        }
      }
    }

    window.addEventListener('nw:frame', handler)
    frameHandlerRef.current = handler
  }

  // ── Phase transition detection ─────────────────────────────────────────────
  // When gold fraction grows between data refreshes, spawn a transformation ripple.

  function detectPhaseTransitions(newData: NWWorldData) {
    for (const m of mountainsRef.current) {
      const project = newData.projects.find(p => p.id === m.projectId)
      if (!project) continue

      // Recompute fracs with new data
      const newFracs = computeRingFractions(
        project, newData.rfis, newData.fieldLogs, newData.invoices
      )

      const goldGrew = newFracs.gold - m.handle.prevGoldFrac > 0.05
      if (goldGrew) {
        // Cancel previous ripple if any
        if (m.rippleCleanup) { m.rippleCleanup(); m.rippleCleanup = null }
        m.rippleCleanup = m.handle.spawnTransformRipple(scene, m.x, m.z)
        m.handle.prevGoldFrac = newFracs.gold
      }
    }
  }

  // ── Effect: init DataBridge + subscribe ────────────────────────────────────

  useEffect(() => {
    initDataBridge()

    let firstBuild = true

    const unsub = subscribeWorldData((data: NWWorldData) => {
      if (!firstBuild) {
        detectPhaseTransitions(data)
      }
      firstBuild = false
      buildMountains(data)
      setupFrameHandler()
    })

    // NW6: scenario override events
    function onScenarioOverride(e: Event) {
      if (!applyScenarioRef.current) return
      const detail = (e as CustomEvent<{ overrides: Record<string, number> }>).detail
      scenarioOverridesRef.current = detail.overrides
      for (const m of mountainsRef.current) {
        m.scenarioMultiplier = detail.overrides[m.projectId] ?? 1.0
      }
    }

    function onScenarioActivate(e: Event) {
      if (!applyScenarioRef.current) return
      const detail = (e as CustomEvent<{ active: boolean }>).detail
      if (!detail.active) {
        scenarioOverridesRef.current = {}
        for (const m of mountainsRef.current) {
          m.scenarioMultiplier = 1.0
        }
      }
    }

    // NW15: LOD update — call lod.update(camera) so THREE.LOD picks the right level
    function onLODUpdate(e: Event) {
      const detail = (e as CustomEvent<{ camera?: THREE.Camera }>).detail
      const cam    = detail?.camera
      if (!cam) return
      cameraRef.current = cam
      for (const m of mountainsRef.current) {
        m.handle.lod.update(cam as THREE.Camera)
      }
    }

    window.addEventListener('nw:lod-update',       onLODUpdate as EventListener)
    window.addEventListener('nw:scenario-override', onScenarioOverride)
    window.addEventListener('nw:scenario-activate', onScenarioActivate)

    return () => {
      unsub()
      disposeDataBridge()
      disposeMountains()
      if (frameHandlerRef.current) {
        window.removeEventListener('nw:frame', frameHandlerRef.current)
        frameHandlerRef.current = null
      }
      window.removeEventListener('nw:lod-update',       onLODUpdate as EventListener)
      window.removeEventListener('nw:scenario-override', onScenarioOverride)
      window.removeEventListener('nw:scenario-activate', onScenarioActivate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  return null
}
