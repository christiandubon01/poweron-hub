// @ts-nocheck
/**
 * NexusAdminSelector — Admin-only panel shown when the admin user taps the NEXUS floating button.
 *
 * Layout: floating panel above the NEXUS orb button with two clearly color-coded mic options:
 *
 *   Option A — GREEN mic: NEXUS - ELECTRICAL
 *     Standard electrical business context (same as all non-admin users).
 *
 *   Option B — PURPLE mic: NEXUS ADMIN - FULL OVERSIGHT
 *     Expanded context across all 4 business sources.
 *     Includes a toggle: [Combined] [Electrical] [Software] [RMO]
 *
 * Props:
 *   onSelect(mode, contextMode)  — called when admin picks an option
 *   onClose()                   — called when admin dismisses the panel
 *   currentContextMode          — the active toggle selection (default: 'combined')
 *   onContextModeChange(mode)   — called when the toggle changes
 */

import React from 'react'
import { X, Mic } from 'lucide-react'
import type { AdminContextMode } from '@/services/nexusAdminContext'

export interface NexusAdminSelectorProps {
  onSelect:             (mode: 'electrical' | 'admin', contextMode: AdminContextMode) => void
  onClose:              () => void
  currentContextMode:   AdminContextMode
  onContextModeChange:  (mode: AdminContextMode) => void
}

const CONTEXT_TABS: { id: AdminContextMode; label: string }[] = [
  { id: 'combined',   label: 'Combined'   },
  { id: 'electrical', label: 'Electrical' },
  { id: 'software',   label: 'Software'   },
  { id: 'rmo',        label: 'RMO'        },
]

function MicOrb({ color, size = 52 }: { color: 'green' | 'purple'; size?: number }) {
  const isGreen = color === 'green'
  const gradient = isGreen
    ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
    : 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)'
  const glow = isGreen
    ? '0 0 20px rgba(34,197,94,0.6), 0 4px 16px rgba(34,197,94,0.35)'
    : '0 0 20px rgba(168,85,247,0.6), 0 4px 16px rgba(168,85,247,0.35)'
  const border = isGreen
    ? '1.5px solid rgba(34,197,94,0.6)'
    : '1.5px solid rgba(168,85,247,0.6)'

  return (
    <div
      style={{
        width:          size,
        height:         size,
        borderRadius:   '50%',
        background:     gradient,
        border,
        boxShadow:      glow,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        flexShrink:     0,
      }}
    >
      <Mic size={Math.round(size * 0.42)} color="#fff" />
    </div>
  )
}

export function NexusAdminSelector({
  onSelect,
  onClose,
  currentContextMode,
  onContextModeChange,
}: NexusAdminSelectorProps) {
  return (
    <>
      {/* Backdrop — click to close */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset:    0,
          zIndex:   62,
          background: 'rgba(0,0,0,0.35)',
        }}
      />

      {/* Selector panel — positioned above the NEXUS button (bottom-right) */}
      <div
        style={{
          position:     'fixed',
          bottom:       '164px',   // sits above the 96px NEXUS button + some gap
          right:        '16px',
          zIndex:       63,
          background:   '#111827',
          border:       '1px solid rgba(255,255,255,0.10)',
          borderRadius: '16px',
          boxShadow:    '0 16px 48px rgba(0,0,0,0.6)',
          padding:      '16px',
          width:        '320px',
          maxWidth:     'calc(100vw - 32px)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{
            fontFamily:     'monospace',
            fontSize:       '11px',
            fontWeight:     700,
            color:          '#9ca3af',
            letterSpacing:  '0.08em',
            textTransform:  'uppercase',
          }}>
            NEXUS — Select Mode
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border:     'none',
              cursor:     'pointer',
              color:      '#6b7280',
              display:    'flex',
              padding:    '2px',
            }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Option A — GREEN: NEXUS ELECTRICAL */}
        <button
          onClick={() => onSelect('electrical', currentContextMode)}
          style={{
            width:          '100%',
            background:     'rgba(34,197,94,0.08)',
            border:         '1.5px solid rgba(34,197,94,0.35)',
            borderRadius:   '12px',
            padding:        '14px',
            cursor:         'pointer',
            display:        'flex',
            alignItems:     'center',
            gap:            '14px',
            marginBottom:   '10px',
            transition:     'background 0.15s, border-color 0.15s',
            textAlign:      'left',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background    = 'rgba(34,197,94,0.15)'
            e.currentTarget.style.borderColor   = 'rgba(34,197,94,0.55)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background    = 'rgba(34,197,94,0.08)'
            e.currentTarget.style.borderColor   = 'rgba(34,197,94,0.35)'
          }}
          aria-label="NEXUS - ELECTRICAL mode"
        >
          <MicOrb color="green" size={48} />
          <div>
            <div style={{
              fontFamily:    'monospace',
              fontSize:      '11px',
              fontWeight:    700,
              color:         '#22c55e',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom:  '3px',
            }}>
              NEXUS — ELECTRICAL
            </div>
            <div style={{
              fontSize:  '12px',
              color:     '#9ca3af',
              lineHeight: 1.4,
            }}>
              Electrical business context. Projects, pipeline, RFIs, AR, field logs.
            </div>
          </div>
        </button>

        {/* Option B — PURPLE: NEXUS ADMIN FULL OVERSIGHT */}
        <div
          style={{
            background:   'rgba(168,85,247,0.08)',
            border:       '1.5px solid rgba(168,85,247,0.35)',
            borderRadius: '12px',
            overflow:     'hidden',
          }}
        >
          <button
            onClick={() => onSelect('admin', currentContextMode)}
            style={{
              width:        '100%',
              background:   'transparent',
              border:       'none',
              padding:      '14px',
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              gap:          '14px',
              transition:   'background 0.15s',
              textAlign:    'left',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(168,85,247,0.10)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            aria-label="NEXUS ADMIN - FULL OVERSIGHT mode"
          >
            <MicOrb color="purple" size={48} />
            <div>
              <div style={{
                fontFamily:    'monospace',
                fontSize:      '11px',
                fontWeight:    700,
                color:         '#a855f7',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom:  '3px',
              }}>
                NEXUS ADMIN — FULL OVERSIGHT
              </div>
              <div style={{
                fontSize:   '12px',
                color:      '#9ca3af',
                lineHeight: 1.4,
              }}>
                All sources: electrical pipeline, software metrics, RMO, personal tools.
              </div>
            </div>
          </button>

          {/* Context scope toggle — [Combined] [Electrical] [Software] [RMO] */}
          <div
            style={{
              display:      'flex',
              gap:          '6px',
              padding:      '0 14px 14px',
              flexWrap:     'wrap',
            }}
          >
            {CONTEXT_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={e => {
                  e.stopPropagation()
                  onContextModeChange(tab.id)
                }}
                style={{
                  flex:          '1 1 auto',
                  minWidth:      '70px',
                  padding:       '5px 8px',
                  borderRadius:  '8px',
                  border:        currentContextMode === tab.id
                    ? '1.5px solid rgba(168,85,247,0.7)'
                    : '1.5px solid rgba(255,255,255,0.10)',
                  background:    currentContextMode === tab.id
                    ? 'rgba(168,85,247,0.20)'
                    : 'rgba(255,255,255,0.04)',
                  color:         currentContextMode === tab.id ? '#c084fc' : '#6b7280',
                  fontFamily:    'monospace',
                  fontSize:      '10px',
                  fontWeight:    700,
                  letterSpacing: '0.04em',
                  cursor:        'pointer',
                  transition:    'all 0.15s',
                  textTransform: 'uppercase',
                }}
                aria-pressed={currentContextMode === tab.id}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

export default NexusAdminSelector
