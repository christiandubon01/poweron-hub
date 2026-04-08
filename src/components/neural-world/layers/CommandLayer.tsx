/**
 * CommandLayer.tsx — NW7: Command surface — control signal meshes.
 *
 * Floating wireframe icosahedra above completed/active projects.
 * Gold/yellow color representing command authority nodes.
 * Connected by thin line segments to adjacent nodes (within range).
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from '../WorldContext'
import { subscribeWorldData, seededPosition, type NWWorldData } from '../DataBridge'

interface CommandLayerProps {
  visible: boolean
}

interface CommandNode {
  mesh: THREE.Mesh
  pos: THREE.Vector3
  rotSpeedY: number
  rotSpeedX: number
}

export function CommandLayer({ visible }: CommandLayerProps) {
  const { scene } = useWorldContext()
  const groupRef  = useRef<THREE.Group | null>(null)
  const nodesRef  = useRef<CommandNode[]>([])
  const linesRef  = useRef<THREE.Line[]>([])

  useEffect(() => {
    const group = new THREE.Group()
    group.visible = visible
    scene.add(group)
    groupRef.current = group

    const unsub = subscribeWorldData((data: NWWorldData) => {
      // Clear
      nodesRef.current.forEach(n => {
        n.mesh.geometry.dispose()
        ;(n.mesh.material as THREE.Material).dispose()
        group.remove(n.mesh)
      })
      linesRef.current.forEach(l => {
        l.geometry.dispose()
        ;(l.material as THREE.Material).dispose()
        group.remove(l)
      })
      nodesRef.current = []
      linesRef.current = []

      const commandProjects = data.projects.filter(p =>
        p.status === 'completed' || p.status === 'in_progress'
      ).slice(0, 8)

      commandProjects.forEach(p => {
        const raw = seededPosition(p.id)
        const pos = new THREE.Vector3(raw.x, 4, raw.z)

        const geo = new THREE.IcosahedronGeometry(0.45, 0)
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffee00,
          wireframe: true,
          transparent: true,
          opacity: 0.6,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.copy(pos)
        group.add(mesh)
        nodesRef.current.push({
          mesh,
          pos: pos.clone(),
          rotSpeedY: 0.3 + Math.random() * 0.4,
          rotSpeedX: 0.2 + Math.random() * 0.3,
        })
      })

      // Draw connection lines between adjacent command nodes (dist < 20)
      for (let a = 0; a < nodesRef.current.length; a++) {
        for (let b = a + 1; b < nodesRef.current.length; b++) {
          const pa = nodesRef.current[a].pos
          const pb = nodesRef.current[b].pos
          if (pa.distanceTo(pb) < 22) {
            const pts = [pa.clone(), pb.clone()]
            const geo = new THREE.BufferGeometry().setFromPoints(pts)
            const mat = new THREE.LineBasicMaterial({
              color: 0xffee00,
              transparent: true,
              opacity: 0.18,
            })
            const line = new THREE.Line(geo, mat)
            group.add(line)
            linesRef.current.push(line)
          }
        }
      }
    })

    return () => {
      unsub()
      nodesRef.current.forEach(n => {
        n.mesh.geometry.dispose()
        ;(n.mesh.material as THREE.Material).dispose()
      })
      linesRef.current.forEach(l => {
        l.geometry.dispose()
        ;(l.material as THREE.Material).dispose()
      })
      nodesRef.current = []
      linesRef.current = []
      scene.remove(group)
    }
  }, [scene])

  // Sync visibility
  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible
  }, [visible])

  // Rotation animation
  useEffect(() => {
    function onFrame() {
      if (!groupRef.current?.visible) return
      nodesRef.current.forEach(n => {
        n.mesh.rotation.y += n.rotSpeedY * 0.012
        n.mesh.rotation.x += n.rotSpeedX * 0.009
      })
    }
    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [])

  return null
}
