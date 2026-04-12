// @ts-nocheck
/**
 * ActivityPanel — Scrollable activity log panel.
 *
 * Shows a live feed of all agent actions grouped by day.
 * Part of Settings (Activity tab) and reachable via poweron:show-activity event.
 *
 * Agent badge colors:
 *   VAULT=#185FA5  LEDGER=#3B6D11  BLUEPRINT=#0F6E56  CHRONO=#854F0B
 *   SPARK=#534AB7  SCOUT=#A32D2D   MIROFISH=#5F5E5A   NEXUS=#0C447C
 */

import React, { useEffect, useState, useCallback } from 'react'
import { getRecentActivity, type ActivityEntry } from '@/services/activityLog'
import { RefreshCw } from 'lucide-react'
import { useDemoMode } from '@/store/demoStore'

// ── Agent badge colours ──────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  VAULT:     '#185FA5',
  LEDGER:    '#3B6D11',
  BLUEPRINT: '#0F6E56',
  CHRONO:    '#854F0B',
  SPARK:     '#534AB7',
  SCOUT:     '#A32D2D',
  MIROFISH:  '#5F5E5A',
  NEXUS:     '#0C447C',
}

function agentColor(name: string): string {
  return AGENT_COLORS[name?.toUpperCase()] ?? '#6B7280'
}

// ── Relative timestamp ───────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const date = new Date(isoString)
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1)   return 'just now'
  if (diffMins < 60)  return `${diffMins} min ago`
  if (diffHours < 24) return `${diffHours} hr ago`
  if (diffDays === 1) return 'yesterday'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Day label ────────────────────────────────────────────────────────────────

function dayLabel(isoString: string): string {
  const date = new Date(isoString)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
}

// ── Group entries by day ─────────────────────────────────────────────────────

interface DayGroup {
  label: string
  entries: ActivityEntry[]
}

function groupByDay(entries: ActivityEntry[]): DayGroup[] {
  const groups: DayGroup[] = []
  let currentLabel = ''

  for (const entry of entries) {
    const label = dayLabel(entry.created_at)
    if (label !== currentLabel) {
      groups.push({ label, entries: [] })
      currentLabel = label
    }
    groups[groups.length - 1].entries.push(entry)
  }

  return groups
}

// ── Component ────────────────────────────────────────────────────────────────

// ── Pagination constants ──────────────────────────────────────────────────────

const PAGE_SIZE = 10
const FETCH_LIMIT = 100   // fetch enough to page through client-side

export function ActivityPanel() {
  const { isDemoMode } = useDemoMode()
  const [entries, setEntries]         = useState<ActivityEntry[]>([])
  const [loading, setLoading]         = useState(true)
  const [refreshing, setRefreshing]   = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const data = await getRecentActivity(FETCH_LIMIT)
      setEntries(data)
      // Reset to first page on every refresh
      setVisibleCount(PAGE_SIZE)
    } catch {
      // Non-critical — panel just shows empty state
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Newest-first slice for the current page
  const visibleEntries = entries.slice(0, visibleCount)
  const hasMore        = entries.length > visibleCount
  const remaining      = entries.length - visibleCount
  const nextBatch      = Math.min(PAGE_SIZE, remaining)

  const groups = groupByDay(visibleEntries)

  return (
    <div
      style={{
        display:       'flex',
        flexDirection: 'column',
        height:        '100%',
        minHeight:     0,
      }}
    >
      {/* Header */}
      <div
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '12px 16px',
          borderBottom:   '1px solid var(--color-border, #2a2a2a)',
          flexShrink:     0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary, #f0f0f0)' }}>
          Activity log{isDemoMode ? ' — Demo Mode' : ''}
        </span>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          style={{
            display:      'flex',
            alignItems:   'center',
            gap:          4,
            background:   'none',
            border:       'none',
            cursor:       'pointer',
            color:        'var(--color-text-muted, #888)',
            fontSize:     12,
            padding:      '4px 8px',
            borderRadius: 4,
            opacity:      refreshing ? 0.5 : 1,
          }}
        >
          <RefreshCw size={12} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* Body — scrollable */}
      <div
        style={{
          flex:       1,
          overflowY:  'auto',
          padding:    '8px 0',
        }}
      >
        {loading ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--color-text-muted, #888)', fontSize: 13 }}>
            Loading…
          </div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-muted, #888)', fontSize: 13 }}>
            No activity yet. Start using the app and your activity will appear here.
          </div>
        ) : (
          groups.map(group => (
            <div key={group.label}>
              {/* Sticky day header */}
              <div
                style={{
                  position:    'sticky',
                  top:          0,
                  zIndex:       1,
                  background:  'var(--color-surface, #1a1a1a)',
                  padding:     '6px 16px 4px',
                  fontSize:    11,
                  fontWeight:  600,
                  color:       'var(--color-text-muted, #888)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  borderBottom: '1px solid var(--color-border, #2a2a2a)',
                }}
              >
                {group.label}
              </div>

              {/* Rows */}
              {group.entries.map(entry => (
                <div
                  key={entry.id}
                  style={{
                    display:    'flex',
                    alignItems: 'flex-start',
                    gap:        10,
                    padding:    '8px 16px',
                    borderBottom: '1px solid var(--color-border-subtle, #222)',
                  }}
                >
                  {/* Agent badge */}
                  <span
                    style={{
                      display:      'inline-block',
                      borderRadius: 5,
                      padding:      '2px 6px',
                      fontSize:     10,
                      fontWeight:   700,
                      color:        '#fff',
                      background:   agentColor(entry.agent_name),
                      whiteSpace:   'nowrap',
                      flexShrink:   0,
                      marginTop:    2,
                      letterSpacing: '0.03em',
                    }}
                  >
                    {entry.agent_name}
                  </span>

                  {/* Summary + timestamp */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize:   13,
                        color:      'var(--color-text-primary, #f0f0f0)',
                        lineHeight: 1.4,
                        wordBreak:  'break-word',
                      }}
                    >
                      {entry.summary}
                    </div>
                    <div
                      style={{
                        fontSize:  11,
                        color:     'var(--color-text-muted, #888)',
                        marginTop: 2,
                      }}
                    >
                      {relativeTime(entry.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}

        {/* ── View More button ──────────────────────────────────────────────── */}
        {!loading && hasMore && (
          <div style={{ padding: '12px 16px', textAlign: 'center', borderTop: '1px solid var(--color-border, #2a2a2a)' }}>
            <button
              onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              style={{
                background:   'rgba(59,130,246,0.12)',
                border:       '1px solid rgba(59,130,246,0.3)',
                borderRadius: 6,
                color:        '#60a5fa',
                fontSize:     12,
                fontWeight:   600,
                padding:      '7px 20px',
                cursor:       'pointer',
                transition:   'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(59,130,246,0.22)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(59,130,246,0.12)' }}
            >
              View More ({nextBatch} of {remaining} remaining)
            </button>
          </div>
        )}

        {/* ── End of log indicator ─────────────────────────────────────────── */}
        {!loading && !hasMore && entries.length > 0 && (
          <div style={{ padding: '10px 16px', textAlign: 'center', color: 'var(--color-text-muted, #888)', fontSize: 11 }}>
            All {entries.length} entries shown
          </div>
        )}
      </div>

      {/* Spin animation */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export default ActivityPanel
