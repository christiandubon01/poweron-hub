// @ts-nocheck
/**
 * NexusAdminView.tsx — NAV1 | Merged ORB Lab + NEXUS Admin
 *
 * The ORB is the visual interface for NEXUS Admin — no longer separate views.
 *
 * ENTRY MODE SELECTOR: On open, shows NEXUS Electrical vs NEXUS Admin Full Oversight.
 * Sub-tabs: Combined / Electrical / Software / RMO (persists in nexusStore).
 *
 * THREE INDEPENDENT PANELS:
 *   Panel 1 — ORB PANEL: Animated orb, collapses independently
 *   Panel 2 — TRANSCRIPT PANEL: Live voice transcript, collapses independently
 *   Panel 3 — CONTROLS PANEL: Voice session controls (always visible)
 *
 * Route: nexus-admin (previously viz-lab + nexus-voice merged)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Mic, MicOff, Square, ChevronDown, ChevronRight, X, Zap, ShieldAlert } from 'lucide-react'
import { useNexusStore } from '@/store/nexusStore'
import { useUIStore } from '@/store/uiStore'
import type { NexusMode, NexusContextMode } from '@/store/nexusStore'
import NexusPresenceOrb from '@/components/nexus/NexusPresenceOrb'

// ─── Constants ────────────────────────────────────────────────────────────────

// NAV1-FIX-VS: ORB LAB header context picker — two top-level context buttons
type OrbContext = 'electrical' | 'ecosystem'
const ORB_CONTEXT_BUTTONS: { id: OrbContext; label: string; color: string; hoverBg: string; activeBg: string; border: string }[] = [
  { id: 'electrical', label: 'Electrical', color: '#22c55e', hoverBg: 'rgba(34,197,94,0.15)', activeBg: 'rgba(34,197,94,0.22)', border: 'rgba(34,197,94,0.55)' },
  { id: 'ecosystem',  label: 'Ecosystem',  color: '#38bdf8', hoverBg: 'rgba(56,189,248,0.15)', activeBg: 'rgba(56,189,248,0.22)', border: 'rgba(56,189,248,0.55)' },
]

const CONTEXT_TABS: { id: NexusContextMode; label: string }[] = [
  { id: 'combined',   label: 'Combined'   },
  { id: 'electrical', label: 'Electrical' },
  { id: 'software',   label: 'Software'   },
  { id: 'rmo',        label: 'RMO'        },
]

// ─── Orb Animator ─────────────────────────────────────────────────────────────

function NexusOrbVisual({ mode, active, muted }: { mode: NexusMode; active: boolean; muted: boolean }) {
  const isElectrical = mode === 'electrical'
  const primaryColor = isElectrical ? '#22c55e' : '#a855f7'
  const glowColor = isElectrical ? 'rgba(34,197,94,0.4)' : 'rgba(168,85,247,0.4)'
  const gradientStart = isElectrical ? '#22c55e' : '#c084fc'
  const gradientEnd = isElectrical ? '#16a34a' : '#7c3aed'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px' }}>
      {/* Main ORB */}
      <NexusPresenceOrb />

      {/* Mode label */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: 'monospace',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: primaryColor,
          marginBottom: 4,
        }}>
          {isElectrical ? 'NEXUS — ELECTRICAL' : 'NEXUS ADMIN — FULL OVERSIGHT'}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          {active ? (muted ? 'Muted' : 'Listening...') : 'Ready'}
        </div>
      </div>

      <style>{`
        @keyframes orbPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
      `}</style>
    </div>
  )
}

// ─── Mode Selector ─────────────────────────────────────────────────────────────

function ModeSelectorScreen({
  currentMode,
  contextMode,
  onSelectMode,
  onChangeContextMode,
}: {
  currentMode: NexusMode
  contextMode: NexusContextMode
  onSelectMode: (mode: NexusMode) => void
  onChangeContextMode: (mode: NexusContextMode) => void
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: '32px 24px',
      gap: '20px',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>
          NEXUS — Select Mode
        </div>
        <div style={{ fontSize: 13, color: '#4b5563' }}>Choose your operating context</div>
      </div>

      {/* ELECTRICAL option */}
      <button
        onClick={() => onSelectMode('electrical')}
        style={{
          width: '100%',
          maxWidth: 480,
          background: currentMode === 'electrical' ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.06)',
          border: `1.5px solid ${currentMode === 'electrical' ? 'rgba(34,197,94,0.6)' : 'rgba(34,197,94,0.25)'}`,
          borderRadius: 12,
          padding: '16px 20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          textAlign: 'left',
          transition: 'all 0.15s',
        }}
      >
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'linear-gradient(135deg, #22c55e, #16a34a)',
          border: '1.5px solid rgba(34,197,94,0.6)',
          boxShadow: '0 0 20px rgba(34,197,94,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Mic size={22} color="#fff" />
        </div>
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#22c55e', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            NEXUS — ELECTRICAL
          </div>
          <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.4 }}>
            Electrical business context. Projects, pipeline, RFIs, AR, field logs.
          </div>
        </div>
        {currentMode === 'electrical' && (
          <div style={{ marginLeft: 'auto', color: '#22c55e', flexShrink: 0 }}>
            <Zap size={16} />
          </div>
        )}
      </button>

      {/* ADMIN FULL OVERSIGHT option */}
      <div style={{
        width: '100%',
        maxWidth: 480,
        background: currentMode === 'admin' ? 'rgba(168,85,247,0.15)' : 'rgba(168,85,247,0.06)',
        border: `1.5px solid ${currentMode === 'admin' ? 'rgba(168,85,247,0.6)' : 'rgba(168,85,247,0.25)'}`,
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <button
          onClick={() => onSelectMode('admin')}
          style={{
            width: '100%', background: 'transparent', border: 'none',
            padding: '16px 20px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left',
          }}
        >
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
            border: '1.5px solid rgba(168,85,247,0.6)',
            boxShadow: '0 0 20px rgba(168,85,247,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <ShieldAlert size={22} color="#fff" />
          </div>
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#a855f7', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
              NEXUS ADMIN — FULL OVERSIGHT
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.4 }}>
              All sources: electrical pipeline, software metrics, RMO, personal tools.
            </div>
          </div>
          {currentMode === 'admin' && (
            <div style={{ marginLeft: 'auto', color: '#a855f7', flexShrink: 0 }}>
              <ShieldAlert size={16} />
            </div>
          )}
        </button>

        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '0 20px 16px', flexWrap: 'wrap' }}>
          {CONTEXT_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={(e) => { e.stopPropagation(); onChangeContextMode(tab.id) }}
              style={{
                flex: '1 1 auto',
                minWidth: 70,
                padding: '5px 8px',
                borderRadius: 8,
                border: contextMode === tab.id
                  ? '1.5px solid rgba(168,85,247,0.7)'
                  : '1.5px solid rgba(255,255,255,0.10)',
                background: contextMode === tab.id ? 'rgba(168,85,247,0.20)' : 'rgba(255,255,255,0.04)',
                color: contextMode === tab.id ? '#c084fc' : '#6b7280',
                fontFamily: 'monospace',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                textTransform: 'uppercase',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// NAV1-FIX-VS: ORB LAB header context picker button (hover state requires own component)
function OrbContextButton({ id, label, color, hoverBg, activeBg, border, active, onClick }: {
  id: OrbContext; label: string; color: string; hoverBg: string; activeBg: string; border: string; active: boolean; onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`Context: ${label}`}
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        border: `1px solid ${active ? border : 'rgba(255,255,255,0.10)'}`,
        background: active ? activeBg : hovered ? hoverBg : 'transparent',
        color: active ? color : hovered ? color : '#6b7280',
        fontFamily: 'monospace',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function NexusAdminView() {
  const {
    nexusMode,
    nexusContextMode,
    voiceSessionActive,
    voiceSessionMuted,
    orbPanelCollapsed,
    transcriptPanelCollapsed,
    transcriptLines,
    setNexusMode,
    setNexusContextMode,
    setVoiceSessionActive,
    setVoiceSessionMuted,
    setOrbPanelCollapsed,
    setTranscriptPanelCollapsed,
    appendTranscriptLine,
    clearTranscript,
  } = useNexusStore()

  const setOrbLabActive = useUIStore((s) => s.setOrbLabActive)

  const [showModeSelector, setShowModeSelector] = useState(false)
  // NAV1-FIX-VS: ORB LAB header context picker state
  const [orbContext, setOrbContext] = useState<OrbContext>('electrical')
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // Signal ORB LAB active to suppress floating NEXUS mic
  useEffect(() => {
    setOrbLabActive(true)
    return () => setOrbLabActive(false)
  }, [])

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcriptLines])

  const handleStartSession = useCallback(() => {
    clearTranscript()
    setVoiceSessionActive(true)
    setVoiceSessionMuted(false)
    appendTranscriptLine(`[${new Date().toLocaleTimeString()}] Session started — ${nexusMode === 'electrical' ? 'Electrical context' : 'Admin Full Oversight'}`)
  }, [nexusMode, clearTranscript, setVoiceSessionActive, setVoiceSessionMuted, appendTranscriptLine])

  const handleStopSession = useCallback(() => {
    setVoiceSessionActive(false)
    appendTranscriptLine(`[${new Date().toLocaleTimeString()}] Session ended.`)
  }, [setVoiceSessionActive, appendTranscriptLine])

  const handleToggleMute = useCallback(() => {
    setVoiceSessionMuted(!voiceSessionMuted)
  }, [voiceSessionMuted, setVoiceSessionMuted])

  const isElectrical = nexusMode === 'electrical'
  const modeColor = isElectrical ? '#22c55e' : '#a855f7'
  const modeLabelShort = isElectrical ? 'ELECTRICAL' : 'ADMIN FULL OVERSIGHT'

  // Layout logic: both open = side by side, one collapsed = other fills
  const bothOpen = !orbPanelCollapsed && !transcriptPanelCollapsed
  const orbFlex = bothOpen ? '0 0 45%' : orbPanelCollapsed ? '0 0 0%' : '1 1 100%'
  const transcriptFlex = bothOpen ? '0 0 55%' : transcriptPanelCollapsed ? '0 0 0%' : '1 1 100%'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      backgroundColor: '#0a0e1a',
      color: '#e5e7eb',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
    }}>
      {/* ── Header ────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            fontFamily: 'monospace',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: modeColor,
            textTransform: 'uppercase',
          }}>
            NEXUS ADMIN
          </div>
          <span style={{
            fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
            backgroundColor: isElectrical ? 'rgba(34,197,94,0.2)' : 'rgba(168,85,247,0.2)',
            color: modeColor, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {modeLabelShort}
          </span>
          {nexusMode === 'admin' && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
              backgroundColor: 'rgba(168,85,247,0.15)', color: '#c084fc',
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              {nexusContextMode.toUpperCase()}
            </span>
          )}
        </div>

        {/* NAV1-FIX-VS: ORB LAB context picker — Electrical / Ecosystem */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <OrbContextButton id="electrical" label="Electrical" color="#22c55e" hoverBg="rgba(34,197,94,0.15)" activeBg="rgba(34,197,94,0.22)" border="rgba(34,197,94,0.55)" active={orbContext === 'electrical'} onClick={() => setOrbContext('electrical')} />
          <OrbContextButton id="ecosystem"  label="Ecosystem"  color="#38bdf8" hoverBg="rgba(56,189,248,0.15)" activeBg="rgba(56,189,248,0.22)" border="rgba(56,189,248,0.55)" active={orbContext === 'ecosystem'}  onClick={() => setOrbContext('ecosystem')} />
        </div>

        {/* Mode selector trigger button */}
        <button
          onClick={() => setShowModeSelector(!showModeSelector)}
          title="Change NEXUS mode"
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: `1px solid ${modeColor}40`,
            background: `${modeColor}10`,
            color: modeColor,
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'monospace',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <Zap size={12} />
          Mode
          <ChevronDown size={12} style={{ transform: showModeSelector ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
        </button>
      </div>

      {/* ── Mode Selector Dropdown ─────────────────────────── */}
      {showModeSelector && (
        <div style={{
          position: 'absolute',
          top: 53,
          right: 16,
          zIndex: 100,
          width: 360,
          maxWidth: 'calc(100vw - 32px)',
          backgroundColor: '#111827',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 16,
          boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}>
          <ModeSelectorScreen
            currentMode={nexusMode}
            contextMode={nexusContextMode}
            onSelectMode={(mode) => { setNexusMode(mode); setShowModeSelector(false) }}
            onChangeContextMode={setNexusContextMode}
          />
        </div>
      )}

      {/* Backdrop for mode selector */}
      {showModeSelector && (
        <div
          onClick={() => setShowModeSelector(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 99 }}
        />
      )}

      {/* ── Main Panel Area ────────────────────────────────── */}
      <div style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        gap: 0,
      }}>
        {/* ── Panel 1: ORB ──────────────────────────────────── */}
        {!orbPanelCollapsed && (
          <div
            style={{
              flex: orbFlex,
              borderRight: bothOpen ? '1px solid rgba(255,255,255,0.08)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden',
              transition: 'flex 0.2s ease',
            }}
          >
            {/* Panel header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                ORB INTERFACE
              </span>
              <button
                onClick={() => setOrbPanelCollapsed(true)}
                title="Collapse ORB panel"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4, display: 'flex' }}
              >
                <ChevronRight size={14} />
              </button>
            </div>

            {/* ORB content */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <NexusOrbVisual
                mode={nexusMode}
                active={voiceSessionActive}
                muted={voiceSessionMuted}
              />
            </div>
          </div>
        )}

        {/* Collapsed ORB restore button */}
        {orbPanelCollapsed && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRight: '1px solid rgba(255,255,255,0.08)',
            padding: '8px 0',
            flexShrink: 0,
          }}>
            <button
              onClick={() => setOrbPanelCollapsed(false)}
              title="Expand ORB panel"
              style={{
                background: 'none', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6, cursor: 'pointer', color: '#6b7280',
                padding: '12px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}
            >
              <ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} />
              <span style={{ writingMode: 'vertical-rl', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase' }}>ORB</span>
            </button>
          </div>
        )}

        {/* ── Panel 2: TRANSCRIPT ──────────────────────────── */}
        {!transcriptPanelCollapsed && (
          <div style={{
            flex: transcriptFlex,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            transition: 'flex 0.2s ease',
          }}>
            {/* Panel header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                LIVE TRANSCRIPT
              </span>
              <button
                onClick={() => setTranscriptPanelCollapsed(true)}
                title="Collapse transcript panel"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4, display: 'flex' }}
              >
                <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
              </button>
            </div>

            {/* Transcript content */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
              {transcriptLines.length === 0 ? (
                <div style={{ color: '#4b5563', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
                  Start a voice session to see the live transcript here.
                </div>
              ) : (
                transcriptLines.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 13,
                      color: '#d1d5db',
                      lineHeight: 1.5,
                      padding: '6px 10px',
                      borderRadius: 6,
                      backgroundColor: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                      borderLeft: '2px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    {line}
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        )}

        {/* Collapsed Transcript restore button */}
        {transcriptPanelCollapsed && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <button
              onClick={() => setTranscriptPanelCollapsed(false)}
              title="Expand transcript panel"
              style={{
                background: 'none', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6, cursor: 'pointer', color: '#6b7280',
                padding: '12px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}
            >
              <ChevronRight size={12} />
              <span style={{ writingMode: 'vertical-rl', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase' }}>TRANSCRIPT</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Panel 3: CONTROLS (always visible, never collapsible) ── */}
      <div style={{
        flexShrink: 0,
        borderTop: '1px solid rgba(255,255,255,0.08)',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        backgroundColor: '#0d1120',
      }}>
        {/* Mode indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: voiceSessionActive ? (voiceSessionMuted ? '#f59e0b' : modeColor) : '#4b5563',
            boxShadow: voiceSessionActive ? `0 0 6px ${modeColor}` : 'none',
          }} />
          <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {voiceSessionActive ? (voiceSessionMuted ? 'Muted' : 'Live') : 'Standby'}
          </span>
          <span style={{ fontSize: 10, color: '#374151', fontFamily: 'monospace' }}>
            {modeLabelShort}
          </span>
        </div>

        {/* Voice controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!voiceSessionActive ? (
            <button
              onClick={handleStartSession}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 20px', borderRadius: 24,
                background: `linear-gradient(135deg, ${isElectrical ? '#22c55e' : '#a855f7'}, ${isElectrical ? '#16a34a' : '#7c3aed'})`,
                border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                boxShadow: `0 4px 16px ${isElectrical ? 'rgba(34,197,94,0.35)' : 'rgba(168,85,247,0.35)'}`,
              }}
            >
              <Mic size={16} />
              Start Session
            </button>
          ) : (
            <>
              <button
                onClick={handleToggleMute}
                title={voiceSessionMuted ? 'Unmute' : 'Mute'}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 40, height: 40, borderRadius: '50%',
                  background: voiceSessionMuted ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.08)',
                  border: voiceSessionMuted ? '1.5px solid rgba(245,158,11,0.5)' : '1.5px solid rgba(255,255,255,0.15)',
                  color: voiceSessionMuted ? '#f59e0b' : '#9ca3af',
                  cursor: 'pointer',
                }}
              >
                {voiceSessionMuted ? <MicOff size={16} /> : <Mic size={16} />}
              </button>

              <button
                onClick={handleStopSession}
                title="Stop session"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 20px', borderRadius: 24,
                  background: 'rgba(239,68,68,0.15)',
                  border: '1.5px solid rgba(239,68,68,0.4)',
                  color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <Square size={14} />
                Stop
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
