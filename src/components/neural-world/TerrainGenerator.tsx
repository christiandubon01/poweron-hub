/**
 * TerrainGenerator.tsx — Terrain mountains from Supabase project data.
 *
 * NW2 scope:
 * - Fetches projects via DataBridge
 * - Creates ConeGeometry mountain per project
 * - Height = contract_value via scale formula
 * - Color by status: active green, pending amber, overdue red, completed dark green
 * - Risk ring at base if overdue or health_score < 60
 * - Pulse animation: slow pulse; risk score > 70 increases amplitude
 * - Registers each mountain with CollisionSystem via 'nw:register-mountain' event
 * - Cleans up Three.js geometry/material on unmount or data refresh
 *
 * NW6 scope:
 * - Listens to 'nw:scenario-override' events (when ctx.applyScenario is true)
 * - Applies per-project heightMultiplier to mountains in real time via Y-axis scale
 * - Listens to 'nw:scenario-activate' to clear overrides when scenario deactivates
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

// ── Status colours ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, number> = {
  in_progress:  0x4a9a6a,   // active green
  approved:     0x4a9a6a,   // treat approved same as active
  pending:      0xbf9a20,   // amber
  estimate:     0xbf9a20,
  lead:         0xbf9a20,
  on_hold:      0xbf9a20,
  overdue:      0xbf5020,   // red (not a DB status — computed)
  completed:    0x3a7a5a,   // dark green
  cancelled:    0x555555,
}

function statusColor(project: NWProject, isOverdue: boolean): number {
  if (isOverdue) return STATUS_COLOR['overdue']
  return STATUS_COLOR[project.status] ?? STATUS_COLOR['pending']
}

function isProjectOverdue(project: NWProject): boolean {
  return project.status === 'on_hold' && project.health_score < 60
    || project.status === 'in_progress' && project.health_score < 60
}

// ── Mountain data structure ────────────────────────────────────────────────────

interface Mountain {
  mesh: THREE.Mesh
  ring: THREE.Mesh | null
  baseY: number
  height: number
  pulseAmplitude: number  // 0.01–0.08
  pulseSpeed: number      // radians / second
  pulseOffset: number     // randomised start phase
  projectId: string
  /** NW6: scenario height multiplier (1.0 = no change) */
  scenarioMultiplier: number
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TerrainGenerator() {
  const { scene, applyScenario } = useWorldContext()
  const mountainsRef = useRef<Mountain[]>([])
  const frameHandlerRef = useRef<(() => void) | null>(null)
  const clockRef = useRef(new THREE.Clock())
  const elapsedRef = useRef(0)

  // NW6: scenario override map — projectId → heightMultiplier
  const scenarioOverridesRef = useRef<Record<string, number>>({})
  const applyScenarioRef = useRef(applyScenario)
  applyScenarioRef.current = applyScenario

  // ── Build mountains from project list ──────────────────────────────────────

  function buildMountains(projects: NWProject[]) {
    // Dispose previous
    disposeMountains()

    const mountains: Mountain[] = []

    projects.forEach((project) => {
      const overdue = isProjectOverdue(project)
      const height = Math.max(0.3, contractValueToHeight(project.contract_value))
      const radius = height * 0.3

      // Mountain cone
      const geo = new THREE.ConeGeometry(radius, height, 8)
      const mat = new THREE.MeshLambertMaterial({
        color: statusColor(project, overdue),
        emissive: new THREE.Color(statusColor(project, overdue)).multiplyScalar(0.15),
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = true
      mesh.receiveShadow = false

      const { x, z } = seededPosition(project.id)
      const baseY = height / 2   // cone origin is at centroid
      mesh.position.set(x, baseY, z)
      mesh.userData.projectId = project.id
      mesh.userData.projectName = project.name
      mesh.userData.mountainRadius = radius

      scene.add(mesh)

      // Risk ring at base
      let ring: THREE.Mesh | null = null
      const showRing = overdue || project.health_score < 60
      if (showRing) {
        const ringGeo = new THREE.TorusGeometry(radius * 1.4, 0.12, 6, 32)
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xff3300,
          transparent: true,
          opacity: 0.7,
        })
        ring = new THREE.Mesh(ringGeo, ringMat)
        ring.rotation.x = Math.PI / 2
        ring.position.set(x, 0.1, z)
        scene.add(ring)
      }

      // Pulse parameters
      const riskAmplitude = project.health_score > 70
        ? 0.06 + (project.health_score - 70) / 30 * 0.06   // 0.06–0.12
        : 0.02
      const pulseSpeed = 1.5 + Math.random() * 0.5          // ~1.5–2 rad/s
      const pulseOffset = Math.random() * Math.PI * 2

      const mountain: Mountain = {
        mesh,
        ring,
        baseY,
        height,
        pulseAmplitude: riskAmplitude,
        pulseSpeed,
        pulseOffset,
        projectId: project.id,
        scenarioMultiplier: scenarioOverridesRef.current[project.id] ?? 1.0,
      }

      mountains.push(mountain)

      // Register with CollisionSystem
      window.dispatchEvent(new CustomEvent('nw:register-mountain', {
        detail: {
          x,
          z,
          radius,
          projectId: project.id,
        },
      }))
    })

    mountainsRef.current = mountains
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  function disposeMountains() {
    for (const m of mountainsRef.current) {
      scene.remove(m.mesh)
      m.mesh.geometry.dispose()
      if (Array.isArray(m.mesh.material)) {
        m.mesh.material.forEach(mat => mat.dispose())
      } else {
        m.mesh.material.dispose()
      }
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

    // Clear all registered mountains
    window.dispatchEvent(new CustomEvent('nw:clear-mountains'))
  }

  // ── Pulse animation ────────────────────────────────────────────────────────

  function setupFrameHandler() {
    if (frameHandlerRef.current) {
      window.removeEventListener('nw:frame', frameHandlerRef.current)
    }

    clockRef.current.start()
    elapsedRef.current = 0

    const handler = () => {
      const delta = clockRef.current.getDelta()
      elapsedRef.current += delta

      for (const m of mountainsRef.current) {
        const t = elapsedRef.current * m.pulseSpeed + m.pulseOffset
        const pulseFactor = 1 + Math.sin(t) * m.pulseAmplitude
        // NW6: apply scenario height multiplier (Y only so width is preserved)
        const sm = m.scenarioMultiplier
        m.mesh.scale.set(pulseFactor, sm * pulseFactor, pulseFactor)
        // Keep base planted on ground: adjust y since scale affects centroid
        m.mesh.position.y = m.baseY * sm * pulseFactor

        // Pulse ring opacity if present
        if (m.ring) {
          const ringMat = m.ring.material as THREE.MeshBasicMaterial
          ringMat.opacity = 0.4 + Math.abs(Math.sin(t * 2)) * 0.4
        }
      }
    }

    window.addEventListener('nw:frame', handler)
    frameHandlerRef.current = handler
  }

  // ── Effect: init DataBridge + subscribe ────────────────────────────────────

  useEffect(() => {
    initDataBridge()

    const unsub = subscribeWorldData((data: NWWorldData) => {
      buildMountains(data.projects)
      setupFrameHandler()
    })

    // NW6: scenario override event handlers (only act when applyScenario is true)
    function onScenarioOverride(e: Event) {
      if (!applyScenarioRef.current) return
      const detail = (e as CustomEvent<{ overrides: Record<string, number> }>).detail
      scenarioOverridesRef.current = detail.overrides
      // Apply to existing mountains immediately (no rebuild needed)
      for (const m of mountainsRef.current) {
        m.scenarioMultiplier = detail.overrides[m.projectId] ?? 1.0
      }
    }

    function onScenarioActivate(e: Event) {
      if (!applyScenarioRef.current) return
      const detail = (e as CustomEvent<{ active: boolean }>).detail
      if (!detail.active) {
        // Reset all multipliers to 1.0
        scenarioOverridesRef.current = {}
        for (const m of mountainsRef.current) {
          m.scenarioMultiplier = 1.0
        }
      }
    }

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
      window.removeEventListener('nw:scenario-override', onScenarioOverride)
      window.removeEventListener('nw:scenario-activate', onScenarioActivate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  return null
}
