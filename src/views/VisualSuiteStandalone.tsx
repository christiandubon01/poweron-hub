// @ts-nocheck
/**
 * VisualSuiteStandalone.tsx — B52 | Fullscreen 43-mode ambient display
 * Auto-collapses sidebar, floats EXIT button top-left.
 */

import React, { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import VisualSuitePanel from '../components/v15r/AIVisualSuite/VisualSuitePanel'
import AdminVisualizationLab from '../views/AdminVisualizationLab'

interface VisualSuiteStandaloneProps {
  onExit?: () => void
}

export default function VisualSuiteStandalone({ onExit }: VisualSuiteStandaloneProps) {
  const [activeTab, setActiveTab] = useState<'visual-suite' | 'neural-map' | 'combined' | 'orb-lab'>('visual-suite')

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

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'visual-suite', label: 'VISUAL SUITE' },
    { id: 'neural-map',   label: 'NEURAL MAP'   },
    { id: 'combined',     label: 'COMBINED MAP' },
    { id: 'orb-lab',      label: 'ORB LAB'      },
  ]

  const inactiveTabStyle: React.CSSProperties = {
    fontSize: 10,
    fontFamily: 'Courier New, monospace',
    fontWeight: 700,
    letterSpacing: '0.08em',
    padding: '4px 14px',
    borderRadius: 5,
    border: '1px solid rgba(255,255,255,0.12)',
    backgroundColor: 'transparent',
    color: '#6b7280',
    cursor: 'pointer',
  }

  const activeTabStyle: React.CSSProperties = {
    ...inactiveTabStyle,
    border: '1px solid #00ff88',
    backgroundColor: 'rgba(0,255,136,0.12)',
    color: '#00ff88',
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

      {/* Tab bar */}
      <div style={{
        position:        'absolute',
        top:             0,
        left:            0,
        right:           0,
        height:          40,
        zIndex:          100,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             8,
        backgroundColor: 'rgba(4,6,18,0.92)',
        borderBottom:    '1px solid rgba(255,255,255,0.08)',
        backdropFilter:  'blur(8px)',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={activeTab === tab.id ? activeTabStyle : inactiveTabStyle}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div style={{ position: 'absolute', top: 40, left: 0, right: 0, bottom: 0 }}>
        {activeTab === 'visual-suite' && <VisualSuitePanel />}
        {activeTab === 'neural-map'   && <AdminVisualizationLab defaultTab='NEURAL_MAP' />}
        {activeTab === 'combined'     && <AdminVisualizationLab defaultTab='COMBINED' />}
        {activeTab === 'orb-lab'      && <AdminVisualizationLab defaultTab='ORB_LAB' />}
      </div>
    </div>
  )
}
