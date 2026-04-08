/**
 * CollisionSystem.tsx — Ground + mountain collision for Neural World.
 *
 * NW1: ground plane collision only.
 * NW2: mountain collision via registered cylinder footprints.
 *
 * Mountains register themselves via the 'nw:register-mountain' CustomEvent.
 * Player is pushed laterally away from any mountain footprint they enter.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MountainFootprint {
  x: number
  z: number
  radius: number
  projectId: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_PLAYER_Y = 2

// ── Props ─────────────────────────────────────────────────────────────────────

interface CollisionSystemProps {
  /** External position ref managed by CameraController */
  playerPosition: React.MutableRefObject<THREE.Vector3>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CollisionSystem({ playerPosition }: CollisionSystemProps) {
  useWorldContext() // ensure scene context is available

  const mountainsRef = useRef<MountainFootprint[]>([])

  useEffect(() => {
    // ── Mountain registration listeners ──────────────────────────────────────

    function onRegisterMountain(e: Event) {
      const evt = e as CustomEvent<MountainFootprint>
      const { x, z, radius, projectId } = evt.detail
      // Replace if same project already registered
      const idx = mountainsRef.current.findIndex(m => m.projectId === projectId)
      if (idx >= 0) {
        mountainsRef.current[idx] = { x, z, radius, projectId }
      } else {
        mountainsRef.current.push({ x, z, radius, projectId })
      }
    }

    function onClearMountains() {
      mountainsRef.current = []
    }

    window.addEventListener('nw:register-mountain', onRegisterMountain)
    window.addEventListener('nw:clear-mountains', onClearMountains)

    // ── Per-frame collision checks ────────────────────────────────────────────

    function onFrame() {
      // Ground collision: player cannot go below MIN_PLAYER_Y
      if (playerPosition.current.y < MIN_PLAYER_Y) {
        playerPosition.current.y = MIN_PLAYER_Y
      }

      // Mountain collision: push player out of any mountain footprint
      const px = playerPosition.current.x
      const pz = playerPosition.current.z

      for (const m of mountainsRef.current) {
        const dx = px - m.x
        const dz = pz - m.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        const minDist = m.radius + 0.8  // 0.8 = player collision capsule radius

        if (dist < minDist && dist > 0.001) {
          // Push player to the edge of the mountain base
          const pushFactor = (minDist - dist) / dist
          playerPosition.current.x += dx * pushFactor
          playerPosition.current.z += dz * pushFactor
        } else if (dist <= 0.001) {
          // Exactly at center — push north
          playerPosition.current.z -= minDist
        }
      }
    }

    window.addEventListener('nw:frame', onFrame)

    return () => {
      window.removeEventListener('nw:frame', onFrame)
      window.removeEventListener('nw:register-mountain', onRegisterMountain)
      window.removeEventListener('nw:clear-mountains', onClearMountains)
    }
  }, [playerPosition])

  return null
}
