/**
 * DecisionGravityLayer.tsx — NW5: Decision gravity clouds.
 *
 * Rotating geometric polyhedra hovering 50 units above terrain.
 * One polyhedron per project zone that has decisions (invoices + field logs).
 * Size = decision count in that zone.
 * Faces: emissive wireframe overlay ("mirror future projections").
 * Rotation: 0.001 radians per frame on X and Y axes.
 * Multiple polyhedra drift toward each other when decision cluster is high (< 20 units apart).
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import {
  subscribeWorldData,
  seededPosition,
  type NWWorldData,
} from '../DataBridge'

// ── Constants ─────────────────────────────────────────────────────────────────

const HOVER_Y      = 50
const ROT_SPEED    = 0.001
const CLUSTER_DIST = 20
const CLUSTER_PULL = 0.0004

// ── Types ─────────────────────────────────────────────────────────────────────

interface PolyEntry {
  projectId: string
  mesh: THREE.Mesh
  wire: THREE.LineSegments
  baseX: number
  baseZ: number
  decisionCount: number
  uid: number
}

let _uidCounter = 0

// ── Component ─────────────────────────────────────────────────────────────────

export function DecisionGravityLayer({ visible = true }: { visible?: boolean }) {
  const { scene } = useWorldContext()
  const entriesRef  = useRef<PolyEntry[]>([])
  const visibleRef  = useRef(visible)

  // Keep visibleRef in sync and update mesh visibility
  useEffect(() => {
    visibleRef.current = visible
    for (const e of entriesRef.current) {
      e.mesh.visible = visible
      e.wire.visible = visible
    }
  }, [visible])

  // ── Build / rebuild polyhedra from world data ─────────────────────────────
  function rebuild(data: NWWorldData) {
    // Dispose old entries
    for (const e of entriesRef.current) {
      scene.remove(e.mesh)
      scene.remove(e.wire)
      e.mesh.geometry.dispose()
      ;(e.mesh.material as THREE.Material).dispose()
      e.wire.geometry.dispose()
      ;(e.wire.material as THREE.Material).dispose()
    }
    entriesRef.current = []

    // Count decisions per project (invoices + field logs)
    const invMap  = new Map<string, number>()
    const logMap  = new Map<string, number>()
    for (const inv of data.invoices) {
      if (inv.project_id) invMap.set(inv.project_id, (invMap.get(inv.project_id) ?? 0) + 1)
    }
    for (const log of data.fieldLogs) {
      if (log.project_id) logMap.set(log.project_id, (logMap.get(log.project_id) ?? 0) + 1)
    }

    // Build zone list
    const zones: { id: string; x: number; z: number; count: number }[] = []
    for (const proj of data.projects) {
      const count = (invMap.get(proj.id) ?? 0) + (logMap.get(proj.id) ?? 0)
      if (count === 0) continue
      const { x, z } = seededPosition(proj.id)
      zones.push({ id: proj.id, x, z, count })
    }

    // Fallback synthetic zones when no real data
    if (zones.length === 0) {
      zones.push({ id: 'fb0', x: 0,   z: 0,   count: 4  })
      zones.push({ id: 'fb1', x: 28,  z: -18, count: 9  })
      zones.push({ id: 'fb2', x: -22, z: 20,  count: 14 })
    }

    // Create one polyhedron per zone
    for (const z of zones) {
      const uid   = ++_uidCounter
      const count = z.count
      const size  = 1.5 + Math.min(count * 0.5, 7.0)

      // Geometry: escalates from simple → complex with decision count
      let geo: THREE.BufferGeometry
      if (count <= 3)       geo = new THREE.TetrahedronGeometry(size)
      else if (count <= 6)  geo = new THREE.OctahedronGeometry(size)
      else if (count <= 11) geo = new THREE.IcosahedronGeometry(size, 0)
      else                  geo = new THREE.DodecahedronGeometry(size)

      // Hue: blue (few decisions, calm) → red-orange (many decisions, critical)
      const ratio = Math.min(count / 12, 1)
      const hue   = 0.65 - ratio * 0.55
      const col   = new THREE.Color().setHSL(hue, 0.92, 0.55)

      const mat = new THREE.MeshPhongMaterial({
        color:            col,
        emissive:         col,
        emissiveIntensity: 0.22,
        transparent:      true,
        opacity:          0.28,
        side:             THREE.DoubleSide,
        depthWrite:       false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(z.x, HOVER_Y, z.z)
      mesh.visible = visible
      scene.add(mesh)

      // Wireframe overlay — "faces mirror future projections"
      const wGeo = new THREE.WireframeGeometry(geo)
      const wMat = new THREE.LineBasicMaterial({
        color:       0xaaffff,
        transparent: true,
        opacity:     0.55,
        depthWrite:  false,
      })
      const wire = new THREE.LineSegments(wGeo, wMat)
      wire.position.set(z.x, HOVER_Y, z.z)
      wire.visible = visible
      scene.add(wire)

      entriesRef.current.push({ projectId: z.id, mesh, wire, baseX: z.x, baseZ: z.z, decisionCount: count, uid })
    }
  }

  // Subscribe to world data
  useEffect(() => {
    const unsub = subscribeWorldData(rebuild)
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Per-frame animation ───────────────────────────────────────────────────
  useEffect(() => {
    function onFrame() {
      if (!visibleRef.current) return
      const nowSec = performance.now() * 0.001

      for (const e of entriesRef.current) {
        // Rotate 0.001 rad per frame
        e.mesh.rotation.x += ROT_SPEED
        e.mesh.rotation.y += ROT_SPEED * 1.5
        e.wire.rotation.copy(e.mesh.rotation)

        // Slow drift via sine waves keyed to uid
        e.mesh.position.x = e.baseX + Math.sin(nowSec * 0.18 + e.uid * 1.1) * 1.8
        e.mesh.position.z = e.baseZ + Math.cos(nowSec * 0.14 + e.uid * 0.9) * 1.8
        e.mesh.position.y = HOVER_Y  + Math.sin(nowSec * 0.25 + e.uid * 0.7) * 1.2
        e.wire.position.copy(e.mesh.position)

        // Pulsing emissive
        const mat = e.mesh.material as THREE.MeshPhongMaterial
        mat.emissiveIntensity = 0.14 + Math.abs(Math.sin(nowSec * 0.7 + e.uid * 0.5)) * 0.32
      }

      // Cluster gravity: polyhedra near each other drift together
      for (let i = 0; i < entriesRef.current.length; i++) {
        for (let j = i + 1; j < entriesRef.current.length; j++) {
          const a  = entriesRef.current[i]
          const b  = entriesRef.current[j]
          const dx = b.mesh.position.x - a.mesh.position.x
          const dz = b.mesh.position.z - a.mesh.position.z
          const dist = Math.sqrt(dx * dx + dz * dz)
          if (dist < CLUSTER_DIST && dist > 0.1) {
            const pull = CLUSTER_PULL * (1 - dist / CLUSTER_DIST)
            a.mesh.position.x += dx * pull
            a.mesh.position.z += dz * pull
            b.mesh.position.x -= dx * pull
            b.mesh.position.z -= dz * pull
            a.wire.position.copy(a.mesh.position)
            b.wire.position.copy(b.mesh.position)
          }
        }
      }
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  return null
}
