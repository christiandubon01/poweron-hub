/**
 * NexusSweepController.tsx — NW29: DOM overlay for NEXUS sweep briefing sphere.
 *
 * Listens for `nw:nexus-sweep-complete` custom event dispatched by AgentFlightLayer
 * when NEXUS returns to the OPERATOR monument with all collected cubes.
 *
 * On sweep completion:
 *   - Renders a glowing briefing sphere indicator at screen center-bottom
 *   - Displays a floating text summary (X compliance items, Y payments, Z leads, etc.)
 *   - Auto-fades after 10 seconds
 *   - Cycle resets automatically (Three.js side handled in AgentFlightLayer)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ResizablePanel } from './ResizablePanel'

// ── Briefing data emitted by AgentFlightLayer ────────────────────────────────

export interface SweepBriefingData {
  compliance: number
  pricing:    number
  payments:   number
  leads:      number
  progress:   number
  insights:   number
  warnings:   number
  sweepIndex: number
}

// ── Component ────────────────────────────────────────────────────────────────

interface BriefingState {
  data:    SweepBriefingData
  visible: boolean
  opacity: number
}

export function NexusSweepController() {
  const [briefing, setBriefing] = useState<BriefingState | null>(null)
  const fadeTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pulseRef      = useRef(0)
  const rafRef        = useRef<number>(0)
  const mountedRef    = useRef(true)

  const startFade = useCallback(() => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    // Show for 8s, then fade over 2s
    fadeTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return
      setBriefing(prev => prev ? { ...prev, opacity: 0 } : null)
      fadeTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return
        setBriefing(null)
      }, 2000)
    }, 8000)
  }, [])

  useEffect(() => {
    mountedRef.current = true

    function onSweepComplete(e: Event) {
      const ev = e as CustomEvent<SweepBriefingData>
      setBriefing({
        data:    ev.detail,
        visible: true,
        opacity: 1,
      })
      startFade()
    }

    window.addEventListener('nw:nexus-sweep-complete', onSweepComplete)

    // Pulse animation loop
    function animatePulse() {
      pulseRef.current += 0.05
      rafRef.current = requestAnimationFrame(animatePulse)
    }
    rafRef.current = requestAnimationFrame(animatePulse)

    return () => {
      mountedRef.current = false
      window.removeEventListener('nw:nexus-sweep-complete', onSweepComplete)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
      cancelAnimationFrame(rafRef.current)
    }
  }, [startFade])

  if (!briefing) return null

  const { data, opacity } = briefing
  const pulse = 0.7 + Math.sin(pulseRef.current) * 0.3

  // B73: NEXUS Master Briefing — resizable + proportional zoom
  // Initial position: bottom-center
  const initX = Math.round(window.innerWidth / 2 - 150)
  const initY = window.innerHeight - 90 - 260  // approx height

  return (
    <ResizablePanel
      panelKey="nexus-master-briefing"
      defaultWidth={300}
      defaultHeight={260}
      titleBarHeight={46}
      zIndex={40}
      initialPos={{ x: initX, y: initY }}
    >
    <div
      style={{
        width:         '100%',
        opacity,
        transition:    opacity === 0 ? 'opacity 2s ease' : undefined,
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        gap:           8,
        boxSizing:     'border-box',
        paddingTop:    6,
        paddingBottom: 6,
      }}
    >
      {/* Briefing sphere glyph */}
      <div style={{
        width:        56,
        height:       56,
        borderRadius: '50%',
        background:   `radial-gradient(circle at 40% 35%, rgba(255,255,255,${0.9 * pulse}), rgba(0,229,204,${0.6 * pulse}) 60%, rgba(0,100,120,0.3))`,
        boxShadow:    `0 0 ${20 + pulse * 16}px rgba(0,229,204,${0.8 * pulse}), 0 0 ${40 + pulse * 20}px rgba(255,255,255,${0.3 * pulse})`,
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        fontSize:     20,
        color:        'rgba(255,255,255,0.9)',
        fontFamily:   'monospace',
      }}>
        ◈
      </div>

      {/* Briefing text panel — B73: min 14px body */}
      <div style={{
        background:    'rgba(0, 5, 15, 0.88)',
        border:        `1px solid rgba(0,229,204,${0.6 * pulse})`,
        borderRadius:  6,
        padding:       '10px 18px',
        backdropFilter:'blur(10px)',
        boxShadow:     `0 0 20px rgba(0,229,204,${0.25 * pulse})`,
        fontFamily:    'monospace',
        fontSize:      14,
        color:         '#00e5cc',
        letterSpacing: 1.2,
        lineHeight:    1.8,
        textAlign:     'center',
        minWidth:      200,
        width:         '100%',
        boxSizing:     'border-box',
      }}>
        {/* B73: title heading min 14px from 10 */}
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 2, marginBottom: 5, color: 'rgba(255,255,255,0.9)' }}>
          ◈ NEXUS MASTER BRIEFING #{data.sweepIndex}
        </div>
        {/* B73: data values +30% from 9 → 14 (min) */}
        <div style={{ color: 'rgba(255,140,60,0.9)', fontSize: 14 }}>
          {data.compliance} compliance item{data.compliance !== 1 ? 's' : ''}
        </div>
        <div style={{ color: 'rgba(255,210,74,0.9)', fontSize: 14 }}>
          {data.pricing} pricing record{data.pricing !== 1 ? 's' : ''}
        </div>
        <div style={{ color: 'rgba(46,232,154,0.9)', fontSize: 14 }}>
          {data.payments} payment{data.payments !== 1 ? 's' : ''}
          {data.warnings > 0 && (
            <span style={{ color: 'rgba(255,80,80,0.9)', marginLeft: 6 }}>
              ⚠ {data.warnings} warning{data.warnings !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ color: 'rgba(255,224,64,0.9)', fontSize: 14 }}>
          {data.leads} lead{data.leads !== 1 ? 's' : ''}
        </div>
        <div style={{ color: 'rgba(58,142,255,0.9)', fontSize: 14 }}>
          {data.progress} progress item{data.progress !== 1 ? 's' : ''}
        </div>
        <div style={{ color: 'rgba(64,212,255,0.9)', fontSize: 14 }}>
          {data.insights} insight{data.insights !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
    </ResizablePanel>
  )
}
