/**
 * RiskSurfaceLayer.tsx — NW7: Risk surface danger zone indicators.
 *
 * Default: ON. Projects with low health or past-due invoices show red angular
 * warning shapes (wireframe hexagons / rhombuses) hovering near terrain.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { subscribeWorldData, seededPosition, type NWWorldData } from '../DataBridge'

interface RiskSurfaceLayerProps {
  visible: boolean
}

interface RiskMarker {
  mesh: THREE.Mesh
  basePosY: number
  rotSpeed: number
}

export function RiskSurfaceLayer({ visible }: RiskSurfaceLayerProps) {
  const { scene } = useWorldContext()
  const groupRef   = useRef<THREE.Group | null>(null)
  const markersRef = useRef<RiskMarker[]>([])

  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    const unsub = subscribeWorldData((data: NWWorldData) => {
      // Clear old
      markersRef.current.forEach(m => {
        m.mesh.geometry.dispose()
        ;(m.mesh.material as THREE.Material).dispose()
        group.remove(m.mesh)
      })
      markersRef.current = []

      // Show risk markers for unhealthy / at-risk projects
      const atRisk = data.projects.filter(p =>
        (p.health_score ?? 80) < 65 ||
        p.status === 'on_hold' ||
        p.status === 'cancelled'
      )

      atRisk.slice(0, 8).forEach(p => {
        const pos = seededPosition(p.id)
        const health = p.health_score ?? 50
        // Severity: 0 (good) to 1 (bad)
        const severity = Math.max(0, 1 - health / 65)

        // Red to orange based on severity
        const r = 1.0
        const g = 0.2 + (1 - severity) * 0.3
        const b = 0.0
        const color = new THREE.Color(r, g, b)

        // Wireframe octahedron for warning shape
        const geo = new THREE.OctahedronGeometry(0.6 + severity * 0.4, 0)
        const mat = new THREE.MeshBasicMaterial({
          color,
          wireframe: true,
          transparent: true,
          opacity: 0.55 + severity * 0.25,
        })
        const mesh = new THREE.Mesh(geo, mat)
        const baseY = 1.5 + severity * 1.5
        mesh.position.set(pos.x, baseY, pos.z)
        group.add(mesh)
        markersRef.current.push({
          mesh,
          basePosY: baseY,
          rotSpeed: 0.4 + severity * 0.8,
        })
      })
    })

    return () => {
      unsub()
      markersRef.current.forEach(m => {
        m.mesh.geometry.dispose()
        ;(m.mesh.material as THREE.Material).dispose()
      })
      markersRef.current = []
      scene.remove(group)
    }
  }, [scene])

  // Sync visibility
  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  // Rotation + hover animation
  useEffect(() => {
    function onFrame() {
      if (!groupRef.current?.visible) return
      const t = performance.now() / 1000
      markersRef.current.forEach((m, idx) => {
        m.mesh.rotation.y += m.rotSpeed * 0.01
        m.mesh.rotation.x += m.rotSpeed * 0.007
        m.mesh.position.y = m.basePosY + Math.sin(t * 1.1 + idx * 1.3) * 0.25
      })
    }
    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  return null
}
