// @ts-nocheck
/**
 * PinnedInsightsButton.tsx — B52 | Floating pin button (bottom-right)
 * Opens PinnedInsightsPanel via custom event.
 * Positioned above WinsLog button.
 */
import React, { useState, useEffect } from 'react'
import { Pin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import PinnedInsightsPanel from './PinnedInsightsPanel'

export function PinnedInsightsButton() {
  const [open, setOpen] = useState(false)
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

  // Listen for open event from sidebar nav
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('poweron:open-pinned-insights', handler)
    return () => window.removeEventListener('poweron:open-pinned-insights', handler)
  }, [])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Pinned Insights"
        style={{
          width:           48,
          height:          48,
          borderRadius:    '50%',
          backgroundColor: 'rgba(0,229,255,0.12)',
          border:          '1.5px solid rgba(0,229,255,0.5)',
          color:           '#00e5ff',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          cursor:          'pointer',
          boxShadow:       '0 4px 20px rgba(0,229,255,0.2)',
          position:        'relative',
          transition:      'all 0.15s',
          flexShrink:      0,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(0,229,255,0.22)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(0,229,255,0.12)' }}
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
        open={open}
        onClose={() => { setOpen(false); fetchCount() }}
      />
    </>
  )
}
