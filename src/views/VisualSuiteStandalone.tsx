// @ts-nocheck
/**
 * VisualSuiteStandalone.tsx — B50 | Fullscreen 43-mode ambient display
 * Pure visual experience — no admin controls, fullscreen canvas.
 */

import React from 'react'
import VisualSuitePanel from '../components/v15r/AIVisualSuite/VisualSuitePanel'

export default function VisualSuiteStandalone() {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#000',
      overflow: 'hidden',
    }}>
      <VisualSuitePanel />
    </div>
  )
}
