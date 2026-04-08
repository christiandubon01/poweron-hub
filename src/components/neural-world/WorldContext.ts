/**
 * WorldContext.ts — Shared Three.js objects across NeuralWorld components.
 */

import { createContext, useContext, MutableRefObject } from 'react'
import * as THREE from 'three'

export interface WorldContextValue {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  playerPosition: MutableRefObject<THREE.Vector3>
  playerYaw: MutableRefObject<number>
}

export const WorldContext = createContext<WorldContextValue | null>(null)

export function useWorldContext(): WorldContextValue {
  const ctx = useContext(WorldContext)
  if (!ctx) throw new Error('useWorldContext must be used inside WorldEngine')
  return ctx
}
