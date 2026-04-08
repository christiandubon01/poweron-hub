/**
 * PulseLayer.tsx — NW7: Radial pulse rings emanating from project mountain peaks.
 *
 * Visual: concentric ring meshes that expand outward from each terrain node then fade.
 * Performance: max 8 rings total; only active rings animated.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { subscribeWorldData, seededPosition, type NWWorldData } from '../DataBridge'

interface PulseLayerProps {
  visible: boolean
}

const MAX_RINGS = 8
const RING_SPEED = 0.04
const RING_MAX_RADIUS = 12
const RING_INTERVAL = 2.2   // seconds between new ring emissions per node

interface PulseRing {
  mesh: THREE.Mesh
  radius: number
  nodeIndex: number
}

export function PulseLayer({ visible }: PulseLayerProps) {
  const { scene } = useWorldContext()
  const ringsRef   = useRef<PulseRing[]>([])
  const nodePositionsRef = useRef<THREE.Vector3[]>([])
  const groupRef   = useRef<THREE.Group | null>(null)
  const timerRef   = useRef<number>(0)

  // Build node positions from world data
  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      nodePositionsRef.current = data.projects.slice(0, 12).map(p => {
        const pos = seededPosition(p.id)
        return new THREE.Vector3(pos.x, 0.08, pos.z)
      })
    })
    return unsub
  }, [])

  // Setup group
  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group
    return () => {
      ringsRef.current.forEach(r => {
        r.mesh.geometry.dispose()
        ;(r.mesh.material as THREE.Material).dispose()
      })
      ringsRef.current = []
      scene.remove(group)
    }
  }, [scene])

  // Sync visibility
  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  // Animate rings
  useEffect(() => {
    let lastTime = 0

    function onFrame() {
      if (!groupRef.current?.visible) return
      const now = performance.now() / 1000
      const delta = now - lastTime
      lastTime = now
      timerRef.current += delta

      const group = groupRef.current!

      // Emit new ring periodically if under cap
      if (timerRef.current >= RING_INTERVAL && ringsRef.current.length < MAX_RINGS) {
        timerRef.current = 0
        const nodes = nodePositionsRef.current
        if (nodes.length > 0) {
          const node = nodes[Math.floor(Math.random() * nodes.length)]
          const geo = new THREE.RingGeometry(0.1, 0.3, 32)
          const mat = new THREE.MeshBasicMaterial({
            color: 0x00c8ff,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
          const ring = new THREE.Mesh(geo, mat)
          ring.position.set(node.x, 0.1, node.z)
          ring.rotation.x = -Math.PI / 2
          group.add(ring)
          ringsRef.current.push({ mesh: ring, radius: 0.2, nodeIndex: 0 })
        }
      }

      // Update existing rings
      ringsRef.current = ringsRef.current.filter(r => {
        r.radius += RING_SPEED
        const progress = r.radius / RING_MAX_RADIUS
        if (progress >= 1) {
          group.remove(r.mesh)
          r.mesh.geometry.dispose()
          ;(r.mesh.material as THREE.Material).dispose()
          return false
        }
        const inner = r.radius
        const outer = r.radius + 0.3
        r.mesh.geometry.dispose()
        r.mesh.geometry = new THREE.RingGeometry(inner, outer, 32)
        const mat = r.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = 0.7 * (1 - progress)
        return true
      })
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  return null
}
