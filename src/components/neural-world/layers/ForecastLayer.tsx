/**
 * ForecastLayer.tsx — NW7: Predictive projection particles.
 *
 * Floating translucent spheres above projects showing projected contract values.
 * Size = projected value relative to current. Ghost-purple color palette.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { subscribeWorldData, seededPosition, type NWWorldData } from '../DataBridge'

interface ForecastLayerProps {
  visible: boolean
}

interface ForecastNode {
  mesh: THREE.Mesh
  baseY: number
  floatOffset: number
}

export function ForecastLayer({ visible }: ForecastLayerProps) {
  const { scene } = useWorldContext()
  const groupRef  = useRef<THREE.Group | null>(null)
  const nodesRef  = useRef<ForecastNode[]>([])

  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    const unsub = subscribeWorldData((data: NWWorldData) => {
      nodesRef.current.forEach(n => {
        n.mesh.geometry.dispose()
        ;(n.mesh.material as THREE.Material).dispose()
        group.remove(n.mesh)
      })
      nodesRef.current = []

      data.projects.filter(p =>
        p.status === 'estimate' || p.status === 'lead' || p.status === 'pending'
      ).slice(0, 10).forEach(p => {
        const pos = seededPosition(p.id)
        const radius = 0.3 + Math.min(p.contract_value / 100000, 1.5)
        const baseY = 3 + radius

        const geo = new THREE.SphereGeometry(radius, 12, 8)
        const mat = new THREE.MeshStandardMaterial({
          color: 0xc89fff,
          emissive: 0x8040cc,
          emissiveIntensity: 0.4,
          transparent: true,
          opacity: 0.22,
          roughness: 0.2,
          metalness: 0.1,
          depthWrite: false,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(pos.x, baseY, pos.z)
        group.add(mesh)
        nodesRef.current.push({ mesh, baseY, floatOffset: Math.random() * Math.PI * 2 })
      })
    })

    return () => {
      unsub()
      nodesRef.current.forEach(n => {
        n.mesh.geometry.dispose()
        ;(n.mesh.material as THREE.Material).dispose()
      })
      nodesRef.current = []
      scene.remove(group)
    }
  }, [scene])

  // Sync visibility
  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  // Float animation
  useEffect(() => {
    function onFrame() {
      if (!groupRef.current?.visible) return
      const t = performance.now() / 1000
      nodesRef.current.forEach(n => {
        n.mesh.position.y = n.baseY + Math.sin(t * 0.5 + n.floatOffset) * 0.4
        n.mesh.rotation.y += 0.005
        const mat = n.mesh.material as THREE.MeshStandardMaterial
        mat.opacity = 0.16 + 0.07 * Math.sin(t * 0.9 + n.floatOffset)
      })
    }
    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  return null
}
