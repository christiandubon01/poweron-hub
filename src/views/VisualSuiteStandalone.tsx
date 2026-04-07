// @ts-nocheck
/**
 * VisualSuiteStandalone.tsx — B52 | Fullscreen 43-mode ambient display
 * Auto-collapses sidebar, floats EXIT button top-left.
 */

import React, { useEffect } from 'react'
import { ChevronLeft } from 'lucide-react'
import VisualSuitePanel from '../components/v15r/AIVisualSuite/VisualSuitePanel'

interface VisualSuiteStandaloneProps {
  onExit?: () => void
}

export default function VisualSuiteStandalone({ onExit }: VisualSuiteStandaloneProps) {
  // Auto-collapse sidebar on enter, restore on exit
  useEffect(() => {
    const prev = localStorage.getItem('sidebar_collapsed')
    localStorage.setItem('sidebar_collapsed', 'true')
    window.dispatchEvent(new CustomEvent('poweron:sidebar-collapse', { detail: true }))
    return () => {
      if (prev !== null) {
        localStorage.setItem('sidebar_collapsed', prev)
      } else {
        localStorage.removeItem('sidebar_collapsed')
      }
      window.dispatchEvent(new CustomEvent('poweron:sidebar-collapse', { detail: false }))
    }
  }, [])

  function handleExit() {
    if (onExit) {
      onExit()
    } else {
      window.dispatchEvent(new CustomEvent('poweron:nav', { detail: 'home' }))
    }
  }

  return (
    <div style={{
      height:   '100vh',
      width:    '100vw',
      position: 'fixed',
      top:      0,
      left:     0,
      background: '#000',
      zIndex:   50,
    }}>
      {/* Floating EXIT button — top-left */}
      <button
        onClick={handleExit}
        style={{
          position:        'absolute',
          top:             12,
          left:            12,
          zIndex:          200,
          display:         'flex',
          alignItems:      'center',
          gap:             6,
          padding:         '6px 12px 6px 8px',
          borderRadius:    8,
          backgroundColor: 'rgba(4,6,18,0.85)',
          border:          '1px solid rgba(255,255,255,0.12)',
          color:           '#9ca3af',
          fontSize:        11,
          fontFamily:      'Courier New, monospace',
          letterSpacing:   '0.08em',
          cursor:          'pointer',
          backdropFilter:  'blur(8px)',
          transition:      'all 0.15s',
        }}
        onMouseEnter={e => {
          const b = e.currentTarget as HTMLButtonElement
          b.style.color = '#fff'
          b.style.borderColor = 'rgba(255,255,255,0.3)'
        }}
        onMouseLeave={e => {
          const b = e.currentTarget as HTMLButtonElement
          b.style.color = '#9ca3af'
          b.style.borderColor = 'rgba(255,255,255,0.12)'
        }}
      >
        <ChevronLeft size={14} />
        EXIT
      </button>

      <VisualSuitePanel />
    </div>
  )
}
