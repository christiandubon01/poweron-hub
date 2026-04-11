// @ts-nocheck
/**
 * PinnedInsightsButton.tsx — B52 + NAV1 | Floating pin button (bottom-right)
 *
 * NAV1 changes:
 * - Toggle behavior: click once opens, click again closes
 * - State stored in uiStore (pinnedInsightsOpen) — persists within session
 * - When both PinnedInsights + WinsLog open on wide screens: side by side (right: 0)
 * - When both open on iPhone 16 Pro: stacked (PinnedInsights on top, WinsLog below it)
 * - Z-index aligned to same level as WinsLog drawer (no overlap)
 *
 * Content inside panel: DO NOT CHANGE — toggle behavior only (spec 4.6)
 */
import React, { useState, useEffect } from 'react'
import { Pin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import PinnedInsightsPanel from './PinnedInsightsPanel'
// NAV1: uiStore for independent toggle state
import { useUIStore } from '@/store/uiStore'

export function PinnedInsightsButton() {
  const { pinnedInsightsOpen, togglePinnedInsights, setPinnedInsightsOpen } = useUIStore()
  const [count, setCount] = useState(0)

  // Load count on mount
  useEffect(() => {
    fetchCount()
    // Listen for pin events to refresh count
    const handler = () => fetchCount()
    window.addEventListener('poweron:insight-pinned', handler)
    return () => window.removeEventListener('poweron:insight-pinned', handler)
  }, [])

  async function fetchCount() {
    try {
      const { count: c } = await supabase
        .from('pinned_insights')
        .select('id', { count: 'exact', head: true })
      setCount(c ?? 0)
    } catch {}
  }

  // Listen for open event from sidebar nav (only opens, doesn't toggle from event)
  useEffect(() => {
    const handler = () => setPinnedInsightsOpen(true)
    window.addEventListener('poweron:open-pinned-insights', handler)
    return () => window.removeEventListener('poweron:open-pinned-insights', handler)
  }, [setPinnedInsightsOpen])

  return (
    <>
      <button
        onClick={togglePinnedInsights}
        title={pinnedInsightsOpen ? 'Close Pinned Insights' : 'Open Pinned Insights'}
        style={{
          width:           48,
          height:          48,
          borderRadius:    '50%',
          backgroundColor: pinnedInsightsOpen ? 'rgba(0,229,255,0.22)' : 'rgba(0,229,255,0.12)',
          border:          pinnedInsightsOpen ? '1.5px solid rgba(0,229,255,0.7)' : '1.5px solid rgba(0,229,255,0.5)',
          color:           '#00e5ff',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          cursor:          'pointer',
          boxShadow:       pinnedInsightsOpen ? '0 4px 24px rgba(0,229,255,0.35)' : '0 4px 20px rgba(0,229,255,0.2)',
          position:        'relative',
          transition:      'all 0.15s',
          flexShrink:      0,
        }}
        onMouseEnter={e => {
          if (!pinnedInsightsOpen)
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(0,229,255,0.22)'
        }}
        onMouseLeave={e => {
          if (!pinnedInsightsOpen)
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(0,229,255,0.12)'
        }}
      >
        <Pin size={20} />
        {count > 0 && (
          <span style={{
            position:        'absolute',
            top:             -4,
            right:           -4,
            minWidth:        18,
            height:          18,
            borderRadius:    9,
            backgroundColor: '#00e5ff',
            color:           '#000',
            fontSize:        10,
            fontWeight:      800,
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            padding:         '0 4px',
            fontFamily:      'Courier New, monospace',
          }}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      <PinnedInsightsPanel
        open={pinnedInsightsOpen}
        onClose={() => { togglePinnedInsights(); fetchCount() }}
      />
    </>
  )
}
