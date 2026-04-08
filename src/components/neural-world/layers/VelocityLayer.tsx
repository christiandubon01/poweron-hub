/**
 * VelocityLayer.tsx — NW7: Velocity / momentum vectors.
 *
 * Directional arrows above active projects showing workflow velocity.
 * Arrow length proportional to project activity (hours logged).
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { subscribeWorldData, seededPosition, type NWWorldData } from '../DataBridge'

interface VelocityLayerProps {
  visible: boolean
}

interface VelocityArrow {
  line: THREE.Line
  head: THREE.Mesh
}

export function VelocityLayer({ visible }: VelocityLayerProps) {
  const { scene } = useWorldContext()
  const groupRef  = useRef<THREE.Group | null>(null)
  const arrowsRef = useRef<VelocityArrow[]>([])

  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    const unsub = subscribeWorldData((data: NWWorldData) => {
      // Dispose old
      arrowsRef.current.forEach(a => {
        a.line.geometry.dispose()
        ;(a.line.material as THREE.Material).dispose()
        a.head.geometry.dispose()
        ;(a.head.material as THREE.Material).dispose()
        group.remove(a.line)
        group.remove(a.head)
      })
      arrowsRef.current = []

      const active = data.projects.filter(p =>
        p.status === 'in_progress' || p.status === 'approved'
      ).slice(0, 10)

      active.forEach(p => {
        const pos = seededPosition(p.id)
        const height = 2 + Math.min(p.contract_value / 30000, 4)

        // Arrow shaft (y=0 is ground level, start at y=1)
        const points = [
          new THREE.Vector3(pos.x, 1, pos.z),
          new THREE.Vector3(pos.x, 1 + height, pos.z),
        ]
        const geo = new THREE.BufferGeometry().setFromPoints(points)
        const mat = new THREE.LineBasicMaterial({ color: 0x00ff78, transparent: true, opacity: 0.7 })
        const line = new THREE.Line(geo, mat)
        group.add(line)

        // Arrow head (cone)
        const coneGeo = new THREE.ConeGeometry(0.18, 0.5, 8)
        const coneMat = new THREE.MeshBasicMaterial({ color: 0x00ff78, transparent: true, opacity: 0.8 })
        const cone = new THREE.Mesh(coneGeo, coneMat)
        cone.position.set(pos.x, 1 + height + 0.25, pos.z)
        group.add(cone)

        arrowsRef.current.push({ line, head: cone })
      })
    })

    return () => {
      unsub()
      arrowsRef.current.forEach(a => {
        a.line.geometry.dispose()
        ;(a.line.material as THREE.Material).dispose()
        a.head.geometry.dispose()
        ;(a.head.material as THREE.Material).dispose()
      })
      arrowsRef.current = []
      scene.remove(group)
    }
  }, [scene])

  // Sync visibility
  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  // Gentle float animation
  useEffect(() => {
    function onFrame() {
      if (!groupRef.current?.visible) return
      const t = performance.now() / 1000
      arrowsRef.current.forEach((a, idx) => {
        const bob = Math.sin(t * 1.2 + idx * 0.8) * 0.08
        a.head.position.y += bob * 0.02
        const mat = a.line.material as THREE.LineBasicMaterial
        mat.opacity = 0.55 + 0.15 * Math.sin(t * 0.7 + idx)
      })
    }
    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  return null
}
