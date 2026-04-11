// @ts-nocheck
/**
 * PinnedInsightsPanel.tsx — B52 | Slide-in drawer from right
 * Shows pinned NEXUS/Katsuro insights with filter, delete, expand.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { X, Trash2, Pin, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ─── Types ─────────────────────────────────────────────────────────────────
interface PinnedInsight {
  id: string
  source: string
  content: string
  context?: string
  category?: string
  pinned_at: string
}

type FilterTab = 'all' | 'nexus' | 'katsuro'

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmt(ts: string) {
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  } catch { return ts }
}

// ─── Item Component ──────────────────────────────────────────────────────────
function InsightItem({ item, onDelete }: { item: PinnedInsight; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const isNexus = item.source === 'nexus'
  const badgeColor = isNexus ? '#00ff88' : '#a855f7'
  const badgeLabel = isNexus ? 'NEXUS' : 'KATSURO'

  return (
    <div style={{
      padding:         '12px 14px',
      borderBottom:    '1px solid rgba(255,255,255,0.06)',
      position:        'relative',
    }}>
      {/* Source badge + category */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          fontSize:        9, fontWeight: 800, letterSpacing: '0.1em',
          padding:         '2px 7px', borderRadius: 4,
          backgroundColor: badgeColor + '22', color: badgeColor,
          border:          `1px solid ${badgeColor}44`,
          fontFamily:      'Courier New, monospace',
          textTransform:   'uppercase',
          flexShrink:      0,
        }}>
          {badgeLabel}
        </span>
        {item.category && (
          <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'Courier New, monospace' }}>
            {item.category}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {/* Delete */}
        <button
          onClick={onDelete}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', padding: 2 }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#4b5563' }}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Content */}
      <p
        onClick={() => setExpanded(p => !p)}
        style={{
          fontSize:      12,
          color:         '#d1d5db',
          lineHeight:    1.6,
          margin:        0,
          cursor:        'pointer',
          overflow:      expanded ? 'visible' : 'hidden',
          display:       expanded ? 'block' : '-webkit-box',
          WebkitLineClamp: expanded ? 'unset' : 3,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {item.content}
      </p>

      {/* Expand toggle */}
      {item.content.length > 120 && (
        <button
          onClick={() => setExpanded(p => !p)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#00e5ff', fontSize: 10, padding: '4px 0 0', display: 'flex', alignItems: 'center', gap: 2, fontFamily: 'Courier New, monospace' }}
        >
          {expanded ? <><ChevronUp size={11} /> less</> : <><ChevronDown size={11} /> more</>}
        </button>
      )}

      {/* Context + date */}
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        {item.context && (
          <span style={{ fontSize: 10, color: '#4b5563', fontStyle: 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.context}
          </span>
        )}
        <span style={{ fontSize: 9, color: '#374151', fontFamily: 'Courier New, monospace', flexShrink: 0, marginLeft: 'auto' }}>
          {fmt(item.pinned_at)}
        </span>
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
interface PinnedInsightsPanelProps {
  open: boolean
  onClose: () => void
}

export default function PinnedInsightsPanel({ open, onClose }: PinnedInsightsPanelProps) {
  const [insights, setInsights] = useState<PinnedInsight[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<FilterTab>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('pinned_insights')
        .select('*')
        .order('pinned_at', { ascending: false })
      setInsights(data ?? [])
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  async function handleDelete(id: string) {
    await supabase.from('pinned_insights').delete().eq('id', id)
    setInsights(prev => prev.filter(i => i.id !== id))
    window.dispatchEvent(new CustomEvent('poweron:insight-pinned'))
  }

  const filtered = filter === 'all'
    ? insights
    : insights.filter(i => i.source === filter)

  const FILTER_TABS: { key: FilterTab; label: string }[] = [
    { key: 'all',     label: 'All' },
    { key: 'nexus',   label: 'NEXUS' },
    { key: 'katsuro', label: 'Katsuro' },
  ]

  return (
    <>
      {/* NAV1: Backdrop — only shown when solo (winsLog closed) to avoid double-darken */}
      {open && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 9000, backgroundColor: 'rgba(0,0,0,0.4)' }}
        />
      )}

      {/* Panel — NAV1: z-index aligned to 9001 (same as WinsLog, no overlap) */}
      <div style={{
        position:        'fixed',
        top:             0,
        right:           0,
        bottom:          0,
        width:           380,
        zIndex:          9001,  /* NAV1: matches WinsLog z-index — side by side, no overlap */
        backgroundColor: 'rgba(4,6,18,0.98)',
        borderLeft:      '1px solid rgba(0,229,255,0.15)',
        boxShadow:       '-8px 0 32px rgba(0,0,0,0.6)',
        display:         'flex',
        flexDirection:   'column',
        transform:       open ? 'translateX(0)' : 'translateX(100%)',
        transition:      'transform 300ms ease',
        fontFamily:      'Courier New, monospace',
      }}>
        {/* Header */}
        <div style={{
          padding:      '16px 16px 12px',
          borderBottom: '1px solid rgba(0,229,255,0.12)',
          display:      'flex',
          alignItems:   'center',
          gap:          10,
          flexShrink:   0,
        }}>
          <Pin size={16} style={{ color: '#00e5ff', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: '#00e5ff', textTransform: 'uppercase', flex: 1 }}>
            Pinned Insights
          </span>
          <span style={{ fontSize: 10, color: '#4b5563', marginRight: 4 }}>
            {filtered.length}
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 2 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Filter row */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          {FILTER_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                flex:            1,
                padding:         '8px 0',
                border:          'none',
                cursor:          'pointer',
                fontSize:        10,
                fontWeight:      700,
                letterSpacing:   '0.06em',
                textTransform:   'uppercase',
                backgroundColor: 'transparent',
                color:           filter === key ? '#00e5ff' : '#4b5563',
                borderBottom:    filter === key ? '2px solid #00e5ff' : '2px solid transparent',
                fontFamily:      'Courier New, monospace',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: '#4b5563', fontSize: 11 }}>
              Loading…
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <Pin size={32} style={{ color: '#1f2937', margin: '0 auto 12px', display: 'block' }} />
              <p style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.6, margin: 0 }}>
                No pinned insights yet.<br />
                Pin NEXUS responses during conversations.
              </p>
            </div>
          )}

          {!loading && filtered.map(item => (
            <InsightItem
              key={item.id}
              item={item}
              onDelete={() => handleDelete(item.id)}
            />
          ))}
        </div>
      </div>
    </>
  )
}
