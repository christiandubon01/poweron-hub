/**
 * PressureLayer.tsx — NW7: Financial pressure heat map over terrain nodes.
 *
 * Default: ON. Shows glowing halos around project mountains.
 * High-value / overdue projects glow orange-red; healthy projects glow cool teal.
 * Uses contract_value and health_score from DataBridge.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { subscribeWorldData, seededPosition, type NWWorldData, type NWProject } from '../DataBridge'

interface PressureLayerProps {
  visible: boolean
}

interface PressureNode {
  mesh: THREE.Mesh
  pulseOffset: number
}

export function PressureLayer({ visible }: PressureLayerProps) {
  const { scene } = useWorldContext()
  const groupRef  = useRef<THREE.Group | null>(null)
  const nodesRef  = useRef<PressureNode[]>([])

  // Build / rebuild halo meshes when data arrives
  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    const unsub = subscribeWorldData((data: NWWorldData) => {
      // Dispose old
      nodesRef.current.forEach(n => {
        n.mesh.geometry.dispose()
        ;(n.mesh.material as THREE.Material).dispose()
        group.remove(n.mesh)
      })
      nodesRef.current = []

      // Create halos for each project
      data.projects.slice(0, 16).forEach((p: NWProject, i: number) => {
        const pos = seededPosition(p.id)

        // Color: low health = red/orange, high health = teal
        const health = p.health_score ?? 80
        const r = Math.floor(255 * (1 - health / 100))
        const g = Math.floor(80 + (health / 100) * 120)
        const b = Math.floor(health / 100 * 200)
        const color = new THREE.Color(r / 255, g / 255, b / 255)

        // Scale with contract value
        const radius = 1.2 + Math.min(p.contract_value / 80000, 3.5)

        const geo = new THREE.CircleGeometry(radius, 32)
        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(pos.x, 0.05, pos.z)
        mesh.rotation.x = -Math.PI / 2
        group.add(mesh)
        nodesRef.current.push({ mesh, pulseOffset: Math.random() * Math.PI * 2 })
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

  // Breathing pulse animation
  useEffect(() => {
    function onFrame() {
      if (!groupRef.current?.visible) return
      const t = performance.now() / 1000
      nodesRef.current.forEach(n => {
        const mat = n.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = 0.12 + 0.06 * Math.sin(t * 0.8 + n.pulseOffset)
      })
    }
    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  return null
}
