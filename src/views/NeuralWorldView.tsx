/**
 * NeuralWorldView.tsx — Entry point for the Neural World 3D visualization.
 *
 * Full-viewport canvas. Height: calc(100vh - 56px).
 * Route: neural-world
 * Role gate: owner + admin only (enforced via sidebar placement in adminBucket3).
 *
 * NW1 scope: World engine foundation only — no data connection.
 */

import React from 'react'
import { WorldEngine } from '@/components/neural-world/WorldEngine'

export default function NeuralWorldView() {
  return (
    <div
      style={{
        width: '100%',
        height: 'calc(100vh - 56px)',
        position: 'relative',
        overflow: 'hidden',
        background: '#050a08',
      }}
    >
      <WorldEngine />
    </div>
  )
}
