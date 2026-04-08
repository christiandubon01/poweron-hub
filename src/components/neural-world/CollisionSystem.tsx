/**
 * CollisionSystem.tsx — Basic ground + levitation collision.
 *
 * NW1 scope: ground plane collision only.
 * Player cannot go below y=0, always levitates at minimum y=2.
 * Mountain collision is a placeholder for NW2 terrain.
 */

import { useEffect } from 'react'
import * as THREE from 'three'
import { useWorldContext } from './WorldContext'

interface CollisionSystemProps {
  /** External position ref managed by CameraController */
  playerPosition: React.MutableRefObject<THREE.Vector3>
}

const MIN_PLAYER_Y = 2

export function CollisionSystem({ playerPosition }: CollisionSystemProps) {
  useWorldContext() // ensure scene context is available

  useEffect(() => {
    function onFrame() {
      // Ground collision: player cannot go below y=0, levitates at y=2 min
      if (playerPosition.current.y < MIN_PLAYER_Y) {
        playerPosition.current.y = MIN_PLAYER_Y
      }

      // Mountain collision placeholder — will be wired in NW2 when terrain generates.
      // checkMountainCollision(playerPosition.current)
    }

    window.addEventListener('nw:frame', onFrame)
    return () => window.removeEventListener('nw:frame', onFrame)
  }, [playerPosition])

  return null
}
