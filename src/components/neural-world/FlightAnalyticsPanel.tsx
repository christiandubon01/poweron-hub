/**
 * FlightAnalyticsPanel.tsx — NW29: In-memory agent flight analytics overlay.
 *
 * Triggered by clicking the chart icon near the Agent Flight layer toggle.
 * Panel shows:
 *   - Agent activity heatmap: domain visit counts in last 5 minutes
 *   - Busiest node: which project mountain has the most agent traffic
 *   - Agent utilization: IDLE / TASKED / RETURNING % per agent as bar
 *   - Warning indicators: agents IDLE > 2 minutes (possible data gap)
 *   - Bottleneck alert: 3+ agents waiting for the same node simultaneously
 *
 * All analytics from flightLog (shared rolling 500-entry buffer).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { flightLog, type FlightLogEntry } from './flightLog'

// ── Agent color map (matches AgentFlightLayer defs) ──────────────────────────

const AGENT_COLORS: Record<string, string> = {
  OHM:      'rgba(255,144,64,0.9)',
  VAULT:    'rgba(255,210,74,0.9)',
  LEDGER:   'rgba(46,232,154,0.9)',
  SPARK:    'rgba(255,224,64,0.9)',
  BLUEPRINT:'rgba(58,142,255,0.9)',
  CHRONO:   'rgba(170,110,255,0.9)',
  SCOUT:    'rgba(64,212,255,0.9)',
  ECHO:     'rgba(80,100,200,0.9)',
  ATLAS:    'rgba(64,255,128,0.9)',
  NEXUS:    'rgba(0,229,204,0.9)',
  GUARDIAN: 'rgba(255,80,96,0.9)',
}

const ALL_AGENTS = Object.keys(AGENT_COLORS)

// ── Analytics computation ─────────────────────────────────────────────────────

interface AgentUtilization {
  agent:      string
  idlePct:    number
  taskedPct:  number
  returningPct: number
  idleSince:  number | null   // timestamp of last IDLE transition, null = has been active
  isIdle2min: boolean
}

interface AnalyticsSnapshot {
  domainHeatmap:   Record<string, number>   // domainId → visit count
  busiestNode:     string | null
  utilization:     AgentUtilization[]
  idleWarnings:    string[]
  bottleneckNodes: string[]                 // nodes where 3+ agents visited in last 30s
  lastUpdated:     number
}

function computeAnalytics(now: number): AnalyticsSnapshot {
  const WINDOW_5MIN  = 5 * 60    // seconds
  const WINDOW_30S   = 30        // seconds
  const IDLE_WARN    = 2 * 60    // 2 minutes

  const recent5m = flightLog.filter(e => now - e.timestamp < WINDOW_5MIN)
  const recent30s = flightLog.filter(e => now - e.timestamp < WINDOW_30S)

  // Domain heatmap — count TASKED entries with non-null target in last 5 min
  const domainHeatmap: Record<string, number> = {}
  for (const entry of recent5m) {
    if (entry.state === 'TASKED' && entry.target) {
      domainHeatmap[entry.target] = (domainHeatmap[entry.target] ?? 0) + 1
    }
  }

  // Busiest node
  let busiestNode: string | null = null
  let busiestCount = 0
  for (const [node, count] of Object.entries(domainHeatmap)) {
    if (count > busiestCount) {
      busiestCount = count
      busiestNode  = node
    }
  }

  // Per-agent utilization
  const utilization: AgentUtilization[] = ALL_AGENTS.map(agent => {
    const agentEntries = recent5m.filter(e => e.agent === agent)
    const total = agentEntries.length
    if (total === 0) {
      // No data — assume IDLE
      const lastEntry = [...flightLog].reverse().find(e => e.agent === agent)
      return {
        agent,
        idlePct:       100,
        taskedPct:     0,
        returningPct:  0,
        idleSince:     lastEntry?.state === 'IDLE' ? lastEntry.timestamp : null,
        isIdle2min:    false,
      }
    }
    const idleCount     = agentEntries.filter(e => e.state === 'IDLE').length
    const taskedCount   = agentEntries.filter(e => e.state === 'TASKED').length
    const returnCount   = agentEntries.filter(e => e.state === 'RETURNING').length

    const idlePct      = (idleCount / total) * 100
    const taskedPct    = (taskedCount / total) * 100
    const returningPct = (returnCount / total) * 100

    // Check if agent has been IDLE since last IDLE entry
    const lastEntry = [...flightLog].reverse().find(e => e.agent === agent)
    const idleSince = lastEntry?.state === 'IDLE' ? lastEntry.timestamp : null
    const isIdle2min = idleSince !== null && (now - idleSince) >= IDLE_WARN

    return { agent, idlePct, taskedPct, returningPct, idleSince, isIdle2min }
  })

  // Idle warnings
  const idleWarnings = utilization.filter(u => u.isIdle2min).map(u => u.agent)

  // Bottleneck nodes — nodes with 3+ distinct agents in last 30s
  const nodeAgentMap: Record<string, Set<string>> = {}
  for (const entry of recent30s) {
    if (entry.state === 'TASKED' && entry.target) {
      if (!nodeAgentMap[entry.target]) nodeAgentMap[entry.target] = new Set()
      nodeAgentMap[entry.target].add(entry.agent)
    }
  }
  const bottleneckNodes = Object.entries(nodeAgentMap)
    .filter(([, agents]) => agents.size >= 3)
    .map(([node]) => node)

  return {
    domainHeatmap,
    busiestNode,
    utilization,
    idleWarnings,
    bottleneckNodes,
    lastUpdated: now,
  }
}

// ── Helper: heat color ────────────────────────────────────────────────────────

function heatColor(count: number, max: number): string {
  if (max === 0) return 'rgba(0,229,204,0.15)'
  const ratio = Math.min(1, count / max)
  const r = Math.round(255 * ratio)
  const g = Math.round(229 * (1 - ratio * 0.7))
  const b = Math.round(204 * (1 - ratio))
  return `rgba(${r},${g},${b},0.85)`
}

// ── Component ────────────────────────────────────────────────────────────────

export function FlightAnalyticsPanel() {
  const [open, setOpen]           = useState(false)
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null)
  const intervalRef               = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(() => {
    const now = performance.now() / 1000
    setAnalytics(computeAnalytics(now))
  }, [])

  // Refresh every 2s when open
  useEffect(() => {
    if (open) {
      refresh()
      intervalRef.current = setInterval(refresh, 2000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [open, refresh])

  const maxHeat = analytics
    ? Math.max(1, ...Object.values(analytics.domainHeatmap))
    : 1

  return (
    <>
      {/* ── Chart icon toggle button ── */}
      <button
        onClick={() => setOpen(prev => !prev)}
        title="Flight Analytics"
        style={{
          position:        'fixed',
          bottom:           148,
          right:            14,
          zIndex:           45,
          width:            28,
          height:           28,
          borderRadius:     4,
          background:       open
            ? 'rgba(0,229,204,0.2)'
            : 'rgba(0,0,0,0.65)',
          border:           open
            ? '1px solid rgba(0,229,204,0.8)'
            : '1px solid rgba(0,229,204,0.25)',
          color:            open ? '#00e5cc' : 'rgba(0,229,204,0.5)',
          fontSize:         13,
          cursor:           'pointer',
          display:          'flex',
          alignItems:       'center',
          justifyContent:   'center',
          backdropFilter:   'blur(8px)',
          transition:       'all 0.15s',
          fontFamily:       'monospace',
        }}
      >
        ◫
      </button>

      {/* ── Analytics panel ── */}
      {open && analytics && (
        <div
          style={{
            position:       'fixed',
            bottom:          180,
            right:           14,
            zIndex:          44,
            width:           300,
            background:     'rgba(0, 5, 15, 0.92)',
            border:         '1px solid rgba(0,229,204,0.3)',
            borderRadius:    8,
            padding:         '12px 14px',
            backdropFilter: 'blur(14px)',
            boxShadow:      '0 4px 32px rgba(0,0,0,0.6)',
            fontFamily:     'monospace',
            color:          '#00e5cc',
          }}
        >
          {/* Header */}
          <div style={{
            fontSize:      9,
            fontWeight:    700,
            letterSpacing: 2,
            color:         'rgba(0,229,204,0.7)',
            marginBottom:  10,
            borderBottom:  '1px solid rgba(0,229,204,0.12)',
            paddingBottom:  6,
            display:       'flex',
            justifyContent:'space-between',
            alignItems:    'center',
          }}>
            <span>◫ FLIGHT ANALYTICS</span>
            <span style={{ opacity: 0.45, fontSize: 8 }}>
              {new Date(analytics.lastUpdated * 1000).toLocaleTimeString()}
            </span>
          </div>

          {/* ── Domain heatmap ── */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 8, letterSpacing: 1.5, color: 'rgba(0,229,204,0.5)', marginBottom: 5 }}>
              DOMAIN ACTIVITY · LAST 5 MIN
            </div>
            {Object.keys(analytics.domainHeatmap).length === 0 ? (
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>
                No flight data yet — enable Agent Flight layer
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {Object.entries(analytics.domainHeatmap)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([domain, count]) => (
                    <div key={domain} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{
                        flex:         1,
                        height:       8,
                        background:   'rgba(255,255,255,0.05)',
                        borderRadius: 2,
                        overflow:     'hidden',
                      }}>
                        <div style={{
                          width:        `${(count / maxHeat) * 100}%`,
                          height:       '100%',
                          background:   heatColor(count, maxHeat),
                          borderRadius: 2,
                          transition:   'width 0.4s ease',
                        }} />
                      </div>
                      <div style={{
                        fontSize:     8,
                        color:        'rgba(255,255,255,0.55)',
                        width:        90,
                        overflow:     'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace:   'nowrap',
                        letterSpacing:0.5,
                      }}>
                        {domain}
                      </div>
                      <div style={{
                        fontSize:     8,
                        color:        heatColor(count, maxHeat),
                        width:        14,
                        textAlign:    'right',
                      }}>
                        {count}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* ── Busiest node ── */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 8, letterSpacing: 1.5, color: 'rgba(0,229,204,0.5)', marginBottom: 3 }}>
              BUSIEST NODE
            </div>
            <div style={{ fontSize: 9, color: analytics.busiestNode ? '#00e5cc' : 'rgba(255,255,255,0.2)' }}>
              {analytics.busiestNode
                ? `${analytics.busiestNode} (${analytics.domainHeatmap[analytics.busiestNode]} visits)`
                : '—'}
            </div>
          </div>

          {/* ── Agent utilization bars ── */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 8, letterSpacing: 1.5, color: 'rgba(0,229,204,0.5)', marginBottom: 5 }}>
              AGENT UTILIZATION · LAST 5 MIN
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {analytics.utilization.map(u => (
                <div key={u.agent} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    fontSize:     8,
                    width:        52,
                    color:        u.isIdle2min
                      ? 'rgba(255,80,80,0.9)'
                      : (AGENT_COLORS[u.agent] ?? 'rgba(255,255,255,0.5)'),
                    letterSpacing:0.3,
                    textAlign:    'right',
                  }}>
                    {u.agent}{u.isIdle2min ? ' ⚠' : ''}
                  </div>
                  {/* Stacked bar */}
                  <div style={{
                    flex:         1,
                    height:       7,
                    background:   'rgba(255,255,255,0.05)',
                    borderRadius: 2,
                    overflow:     'hidden',
                    display:      'flex',
                  }}>
                    <div style={{
                      width:      `${u.idlePct}%`,
                      height:     '100%',
                      background: 'rgba(80,80,100,0.6)',
                    }} />
                    <div style={{
                      width:      `${u.taskedPct}%`,
                      height:     '100%',
                      background: AGENT_COLORS[u.agent] ?? 'rgba(0,229,204,0.7)',
                    }} />
                    <div style={{
                      width:      `${u.returningPct}%`,
                      height:     '100%',
                      background: 'rgba(255,200,100,0.6)',
                    }} />
                  </div>
                  <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', width: 18, textAlign: 'right' }}>
                    {Math.round(u.taskedPct)}%
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 7, color: 'rgba(255,255,255,0.3)' }}>
              <span>■ Idle</span>
              <span style={{ color: 'rgba(0,229,204,0.5)' }}>■ Tasked</span>
              <span style={{ color: 'rgba(255,200,100,0.5)' }}>■ Returning</span>
            </div>
          </div>

          {/* ── Warnings ── */}
          {analytics.idleWarnings.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 8, letterSpacing: 1.5, color: 'rgba(255,80,80,0.7)', marginBottom: 3 }}>
                ⚠ IDLE WARNING — possible data gap
              </div>
              <div style={{ fontSize: 8, color: 'rgba(255,100,100,0.8)' }}>
                {analytics.idleWarnings.join(', ')} idle &gt;2 min
              </div>
            </div>
          )}

          {/* ── Bottleneck alert ── */}
          {analytics.bottleneckNodes.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 8, letterSpacing: 1.5, color: 'rgba(255,160,40,0.8)', marginBottom: 3 }}>
                ⚡ BOTTLENECK
              </div>
              <div style={{ fontSize: 8, color: 'rgba(255,200,100,0.8)' }}>
                {analytics.bottleneckNodes.map(n => `${n} (3+ agents)`).join(', ')}
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{
            fontSize:     7,
            color:        'rgba(0,229,204,0.2)',
            letterSpacing:0.8,
            marginTop:    6,
            borderTop:    '1px solid rgba(0,229,204,0.08)',
            paddingTop:   5,
          }}>
            Rolling 500-entry buffer · refreshes every 2s
          </div>
        </div>
      )}
    </>
  )
}
