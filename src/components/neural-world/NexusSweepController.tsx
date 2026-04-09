/**
 * NexusSweepController.tsx — B76: NEXUS Master Briefing redesign.
 *
 * Premium glassmorphic panel — 600×500px centered overlay with:
 *  - Animated teal orb header + gold/amber title
 *  - Section 1: KEY METRICS stat cards with count-up animation
 *  - Section 2: ALERTS & ACTION ITEMS with severity dots
 *  - Section 3: INSIGHTS quote block
 *  - Section 4: QUICK ACTIONS bottom bar
 *  - Scale+fade-in appear / fade-out dismiss animations
 *  - Sound: playNexusMerge() on open if sound layer enabled (NW43)
 *  - Draggable + resizable via ResizablePanel (B73)
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import { ResizablePanel } from './ResizablePanel'
import { getAudioEngine } from './AudioEngine'

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

// ── Props ────────────────────────────────────────────────────────────────────

interface NexusSweepControllerProps {
  /** Whether the sound layer is currently enabled (NW43) */
  soundLayerEnabled?: boolean
}

// ── Count-up hook ─────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 500, active = false): number {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!active) {
      setValue(0)
      return
    }
    const start = performance.now()
    function step(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(eased * target))
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step)
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration, active])

  return value
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number
  prefix?: string
  suffix?: string
  trend: 'up' | 'down' | 'neutral'
  active: boolean
}

function StatCard({ label, value, prefix = '', suffix = '', trend, active }: StatCardProps) {
  const displayed = useCountUp(value, 500, active)

  const trendEl = trend === 'up'
    ? <span style={{ color: '#22c55e', fontSize: 14 }}>▲</span>
    : trend === 'down'
    ? <span style={{ color: '#ef4444', fontSize: 14 }}>▼</span>
    : <span style={{ color: '#6b7280', fontSize: 14 }}>—</span>

  return (
    <div style={{
      flex: '1 1 0',
      background:   'rgba(0, 10, 20, 0.55)',
      border:       '1px solid rgba(0, 255, 200, 0.10)',
      borderRadius: 10,
      padding:      '12px 10px',
      display:      'flex',
      flexDirection:'column',
      alignItems:   'center',
      gap:          4,
      minWidth:     0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: '#ffffff', fontVariantNumeric: 'tabular-nums', letterSpacing: -1 }}>
          {prefix}{displayed.toLocaleString()}{suffix}
        </span>
        {trendEl}
      </div>
      <span style={{ fontSize: 11, color: '#6b7280', textAlign: 'center', letterSpacing: 0.5 }}>
        {label}
      </span>
    </div>
  )
}

// ── Alert row ─────────────────────────────────────────────────────────────────

interface AlertItem {
  id: string
  severity: 'urgent' | 'attention' | 'positive'
  message: string
}

const DOT_COLORS: Record<AlertItem['severity'], string> = {
  urgent:    '#ef4444',
  attention: '#f59e0b',
  positive:  '#22c55e',
}

function AlertRow({ item }: { item: AlertItem }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0' }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: DOT_COLORS[item.severity],
        marginTop: 5,
        flexShrink: 0,
        boxShadow: `0 0 6px ${DOT_COLORS[item.severity]}`,
      }} />
      <span style={{ fontSize: 12, color: '#c0c8d0', lineHeight: 1.5 }}>{item.message}</span>
    </div>
  )
}

// ── Quick action button ────────────────────────────────────────────────────────

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: '1 1 0',
        background:   hovered ? 'rgba(0, 255, 200, 0.12)' : 'rgba(0, 10, 22, 0.7)',
        border:       `1px solid rgba(0, 255, 200, ${hovered ? 0.45 : 0.18})`,
        borderRadius: 8,
        color:        hovered ? '#00ffc8' : '#8ba8b8',
        fontSize:     11,
        fontFamily:   'monospace',
        letterSpacing:1,
        padding:      '8px 6px',
        cursor:       'pointer',
        transition:   'all 0.2s ease',
        boxShadow:    hovered ? '0 0 12px rgba(0, 255, 200, 0.18)' : 'none',
        whiteSpace:   'nowrap',
        minWidth:     0,
      }}
    >
      {label}
    </button>
  )
}

// ── Build alert items from sweep data ─────────────────────────────────────────

function buildAlerts(data: SweepBriefingData): AlertItem[] {
  const items: AlertItem[] = []

  if (data.warnings > 0) {
    items.push({
      id: 'warn',
      severity: 'urgent',
      message: `${data.warnings} warning${data.warnings !== 1 ? 's' : ''} detected across active domains`,
    })
  }
  if (data.compliance > 0) {
    items.push({
      id: 'comp',
      severity: 'attention',
      message: `${data.compliance} compliance item${data.compliance !== 1 ? 's' : ''} require review`,
    })
  }
  if (data.pricing > 0) {
    items.push({
      id: 'price',
      severity: 'attention',
      message: `${data.pricing} pricing record${data.pricing !== 1 ? 's' : ''} indexed by NEXUS`,
    })
  }
  if (data.payments > 0) {
    items.push({
      id: 'pay',
      severity: 'positive',
      message: `${data.payments} payment${data.payments !== 1 ? 's' : ''} processed this cycle`,
    })
  }
  if (data.leads > 0) {
    items.push({
      id: 'leads',
      severity: 'positive',
      message: `${data.leads} lead${data.leads !== 1 ? 's' : ''} tracked in pipeline`,
    })
  }
  return items
}

// ── Build insight text from sweep data ────────────────────────────────────────

function buildInsight(data: SweepBriefingData): string {
  const total = data.compliance + data.pricing + data.payments + data.leads + data.progress + data.insights
  if (total === 0) {
    return 'All systems nominal. No significant activity patterns detected this cycle.'
  }
  const parts: string[] = []
  if (data.progress > 0) {
    parts.push(`${data.progress} project${data.progress !== 1 ? 's' : ''} showed momentum`)
  }
  if (data.insights > 0) {
    parts.push(`${data.insights} strategic insight${data.insights !== 1 ? 's' : ''} surfaced`)
  }
  if (data.warnings > 0) {
    parts.push(`${data.warnings} item${data.warnings !== 1 ? 's' : ''} flagged for attention`)
  }
  const summary = parts.length > 0
    ? `This sweep cycle: ${parts.join(', ')}.`
    : `${total} intelligence items collected across all monitored domains.`
  return `${summary} Review your action items and run "Pull Hub Data" to sync the latest state.`
}

// ── Animated teal orb ─────────────────────────────────────────────────────────

function NexusOrb() {
  const [scale, setScale] = useState(1)
  const rafRef = useRef<number>(0)
  const tRef = useRef(0)

  useEffect(() => {
    function animate() {
      tRef.current += 0.05
      setScale(0.85 + Math.sin(tRef.current) * 0.15)
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <div style={{
      width:        16,
      height:       16,
      borderRadius: '50%',
      background:   'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.9), rgba(0,229,204,0.7) 60%, rgba(0,80,100,0.3))',
      boxShadow:    `0 0 ${6 + scale * 6}px rgba(0,229,204,0.9), 0 0 ${12 + scale * 8}px rgba(0,229,204,0.4)`,
      transform:    `scale(${scale})`,
      flexShrink:   0,
    }} />
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface BriefingState {
  data:       SweepBriefingData
  visible:    boolean
  animating:  boolean   // true = entering
  dismissing: boolean   // true = exiting
  pinned:     boolean
  showAllAlerts: boolean
}

export function NexusSweepController({ soundLayerEnabled = false }: NexusSweepControllerProps) {
  const [briefing, setBriefing] = useState<BriefingState | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef   = useRef(true)

  // ── Dismiss handler ──────────────────────────────────────────────────────
  const dismiss = useCallback(() => {
    if (!mountedRef.current) return
    setBriefing(prev => prev ? { ...prev, dismissing: true, pinned: false } : null)
    setTimeout(() => {
      if (!mountedRef.current) return
      setBriefing(null)
    }, 220)
  }, [])

  const startAutoFade = useCallback(() => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    fadeTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return
      // Only auto-fade if not pinned
      setBriefing(prev => {
        if (!prev || prev.pinned) return prev
        return { ...prev, dismissing: true }
      })
      fadeTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return
        setBriefing(prev => (prev && !prev.pinned) ? null : prev)
      }, 220)
    }, 15000)
  }, [])

  useEffect(() => {
    mountedRef.current = true

    function onSweepComplete(e: Event) {
      const ev = e as CustomEvent<SweepBriefingData>
      setBriefing({
        data:          ev.detail,
        visible:       true,
        animating:     true,
        dismissing:    false,
        pinned:        false,
        showAllAlerts: false,
      })
      // Play chime if sound layer is ON (NW43 AudioEngine)
      if (soundLayerEnabled) {
        try { getAudioEngine().playNexusMerge() } catch { /* safe fallback */ }
      }
      // Transition to idle after enter animation
      setTimeout(() => {
        if (!mountedRef.current) return
        setBriefing(prev => prev ? { ...prev, animating: false } : null)
      }, 320)
      startAutoFade()
    }

    window.addEventListener('nw:nexus-sweep-complete', onSweepComplete)
    return () => {
      mountedRef.current = false
      window.removeEventListener('nw:nexus-sweep-complete', onSweepComplete)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [soundLayerEnabled, startAutoFade])

  if (!briefing) return null

  const { data, animating, dismissing, pinned, showAllAlerts } = briefing

  // ── Animation state ──────────────────────────────────────────────────────
  const opacity   = dismissing ? 0 : animating ? 0 : 1
  const scaleVal  = dismissing ? 0.95 : animating ? 0.95 : 1.0
  const transition = dismissing
    ? 'opacity 0.2s ease, transform 0.2s ease'
    : animating
    ? 'none'
    : 'opacity 0.3s ease, transform 0.3s ease'

  // ── Derived data ─────────────────────────────────────────────────────────
  const alerts    = buildAlerts(data)
  const insight   = buildInsight(data)
  const shownAlerts = showAllAlerts ? alerts : alerts.slice(0, 5)
  const hiddenCount = Math.max(0, alerts.length - 5)

  const now = new Date()
  const dateTimeStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    + ' · ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  // ── Initial panel position: center, slightly above middle ─────────────
  const initX = Math.round((window.innerWidth  - 600) / 2)
  const initY = Math.round((window.innerHeight - 500) / 2 - 40)

  return (
    <ResizablePanel
      panelKey="nexus-master-briefing"
      defaultWidth={600}
      defaultHeight={500}
      titleBarHeight={52}
      zIndex={9000}
      initialPos={{ x: Math.max(0, initX), y: Math.max(0, initY) }}
    >
      <div
        style={{
          width:            600,
          minHeight:        500,
          background:       'rgba(10, 15, 25, 0.88)',
          backdropFilter:   'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border:           '1px solid rgba(0, 255, 200, 0.15)',
          borderRadius:     16,
          boxShadow:        '0 0 40px rgba(0, 255, 200, 0.08), 0 8px 32px rgba(0,0,0,0.6)',
          display:          'flex',
          flexDirection:    'column',
          overflow:         'hidden',
          opacity,
          transform:        `scale(${scaleVal})`,
          transformOrigin:  'center center',
          transition,
          boxSizing:        'border-box',
        }}
      >

        {/* ── HEADER ──────────────────────────────────────────────────── */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          gap:            10,
          padding:        '14px 18px 12px',
          borderBottom:   '1px solid rgba(0, 255, 200, 0.08)',
          flexShrink:     0,
        }}>
          <NexusOrb />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize:    18,
              fontWeight:  700,
              color:       '#f5a623',
              fontFamily:  'monospace',
              letterSpacing: 1.5,
              lineHeight:  1.2,
            }}>
              NEXUS MASTER BRIEFING #{data.sweepIndex}
            </div>
            <div style={{ fontSize: 11, color: '#4b5563', letterSpacing: 0.5, marginTop: 2 }}>
              {dateTimeStr}
            </div>
          </div>

          {/* Pin button */}
          <button
            title={pinned ? 'Unpin briefing' : 'Pin briefing (keep visible)'}
            onClick={() => setBriefing(prev => prev ? { ...prev, pinned: !prev.pinned } : null)}
            style={{
              background:   pinned ? 'rgba(0, 255, 200, 0.15)' : 'transparent',
              border:       `1px solid rgba(0, 255, 200, ${pinned ? 0.4 : 0.15})`,
              borderRadius: 6,
              color:        pinned ? '#00ffc8' : '#4b5563',
              fontSize:     14,
              width:        28,
              height:       28,
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              justifyContent:'center',
              transition:   'all 0.2s ease',
              flexShrink:   0,
            }}
          >
            📌
          </button>

          {/* Close button */}
          <button
            title="Close briefing"
            onClick={dismiss}
            style={{
              background:   'transparent',
              border:       '1px solid rgba(255, 80, 80, 0.2)',
              borderRadius: 6,
              color:        '#6b7280',
              fontSize:     16,
              width:        28,
              height:       28,
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              justifyContent:'center',
              transition:   'all 0.2s ease',
              flexShrink:   0,
            }}
            onMouseEnter={e => {
              const b = e.currentTarget
              b.style.color = '#ef4444'
              b.style.borderColor = 'rgba(255,80,80,0.5)'
              b.style.background = 'rgba(255,80,80,0.08)'
            }}
            onMouseLeave={e => {
              const b = e.currentTarget
              b.style.color = '#6b7280'
              b.style.borderColor = 'rgba(255,80,80,0.2)'
              b.style.background = 'transparent'
            }}
          >
            ✕
          </button>
        </div>

        {/* ── BODY ────────────────────────────────────────────────────── */}
        <div style={{
          flex:       1,
          padding:    '14px 18px',
          overflowY:  'auto',
          display:    'flex',
          flexDirection: 'column',
          gap:        14,
        }}>

          {/* ── SECTION 1: KEY METRICS ─────────────────────────────── */}
          <div>
            <div style={{
              fontSize:     10,
              color:        '#00ffc8',
              letterSpacing:2,
              fontFamily:   'monospace',
              fontWeight:   700,
              marginBottom: 8,
              textTransform:'uppercase',
            }}>
              KEY METRICS
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatCard
                label="Payments Processed"
                value={data.payments}
                trend={data.payments > 2 ? 'up' : data.payments > 0 ? 'neutral' : 'down'}
                active={!animating && !dismissing}
              />
              <StatCard
                label="Active Projects"
                value={data.progress}
                trend={data.progress > 3 ? 'up' : 'neutral'}
                active={!animating && !dismissing}
              />
              <StatCard
                label="Outstanding AR"
                value={data.compliance}
                trend={data.compliance > 0 ? 'down' : 'neutral'}
                active={!animating && !dismissing}
              />
              <StatCard
                label="Leads in Pipeline"
                value={data.leads}
                trend={data.leads > 2 ? 'up' : data.leads > 0 ? 'neutral' : 'neutral'}
                active={!animating && !dismissing}
              />
            </div>
          </div>

          {/* ── SECTION 2: ALERTS & ACTION ITEMS ───────────────────── */}
          <div style={{
            background:   'rgba(0, 8, 18, 0.5)',
            border:       '1px solid rgba(0, 255, 200, 0.07)',
            borderRadius: 10,
            padding:      '10px 14px',
          }}>
            <div style={{
              fontSize:     10,
              color:        '#00ffc8',
              letterSpacing:2,
              fontFamily:   'monospace',
              fontWeight:   700,
              marginBottom: 8,
              textTransform:'uppercase',
            }}>
              ALERTS &amp; ACTION ITEMS
            </div>
            {alerts.length === 0 ? (
              <div style={{ fontSize: 12, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>✓</span> All clear — no alerts this cycle
              </div>
            ) : (
              <>
                {shownAlerts.map(item => <AlertRow key={item.id} item={item} />)}
                {!showAllAlerts && hiddenCount > 0 && (
                  <button
                    onClick={() => setBriefing(prev => prev ? { ...prev, showAllAlerts: true } : null)}
                    style={{
                      background:   'transparent',
                      border:       'none',
                      color:        '#00ffc8',
                      fontSize:     11,
                      cursor:       'pointer',
                      padding:      '4px 0 0 16px',
                      letterSpacing:0.5,
                      opacity:      0.7,
                    }}
                  >
                    Show all {alerts.length} items ▾
                  </button>
                )}
              </>
            )}
          </div>

          {/* ── SECTION 3: INSIGHTS ────────────────────────────────── */}
          <div style={{
            borderLeft:   '3px solid rgba(0, 255, 200, 0.4)',
            paddingLeft:  14,
            paddingTop:   4,
            paddingBottom:4,
          }}>
            <div style={{
              fontSize:     10,
              color:        '#00ffc8',
              letterSpacing:2,
              fontFamily:   'monospace',
              fontWeight:   700,
              marginBottom: 6,
              textTransform:'uppercase',
            }}>
              NEXUS INSIGHTS
            </div>
            <p style={{
              fontSize:   13,
              color:      '#9ca3af',
              lineHeight: 1.6,
              margin:     0,
              fontStyle:  'italic',
            }}>
              {insight}
            </p>
          </div>

        </div>

        {/* ── SECTION 4: QUICK ACTIONS ────────────────────────────────── */}
        <div style={{
          display:        'flex',
          gap:            8,
          padding:        '10px 18px 14px',
          borderTop:      '1px solid rgba(0, 255, 200, 0.08)',
          background:     'rgba(0, 6, 16, 0.4)',
          flexShrink:     0,
        }}>
          <ActionBtn label="PULL HUB DATA" onClick={() => {
            window.dispatchEvent(new CustomEvent('nexus:pull-hub-data'))
          }} />
          <ActionBtn label="OPEN LEDGER" onClick={() => {
            window.dispatchEvent(new CustomEvent('nexus:open-panel', { detail: { panel: 'ledger' } }))
          }} />
          <ActionBtn label="CALL NEXUS" onClick={() => {
            window.dispatchEvent(new CustomEvent('nexus:open-panel', { detail: { panel: 'nexus-chat' } }))
          }} />
          <ActionBtn label="DISMISS" onClick={dismiss} />
        </div>

      </div>
    </ResizablePanel>
  )
}
