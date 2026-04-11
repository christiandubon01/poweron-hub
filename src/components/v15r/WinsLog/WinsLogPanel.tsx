// @ts-nocheck
/**
 * WinsLogPanel.tsx — B51 | Wins Log
 *
 * Floating +WIN button above NEXUS orb button, gold trophy icon.
 * Opens slide-in drawer with wins list and add modal.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Trophy, Plus, X, Filter, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
// NAV1: uiStore for independent toggle state
import { useUIStore } from '@/store/uiStore'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Win {
  id: string
  title: string
  description?: string
  category: string
  impact?: string
  created_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'business',  label: 'Business',  color: '#00ff9f' },
  { id: 'platform',  label: 'Platform',  color: '#ff00ff' },
  { id: 'personal',  label: 'Personal',  color: '#ffaa00' },
  { id: 'financial', label: 'Financial', color: '#ffd700' },
  { id: 'milestone', label: 'Milestone', color: '#ff4444' },
]

const IMPACTS = ['Small', 'Medium', 'Large', 'Breakthrough']

function getCatColor(cat: string): string {
  return CATEGORIES.find(c => c.id === cat)?.color ?? '#9ca3af'
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

// ─── Impact Badge ─────────────────────────────────────────────────────────────
function ImpactBadge({ impact }: { impact?: string }) {
  if (!impact) return null
  const colors: Record<string, { bg: string; text: string }> = {
    Small:        { bg: '#1a2a1a', text: '#86efac' },
    Medium:       { bg: '#1a1a2a', text: '#93c5fd' },
    Large:        { bg: '#2a1a00', text: '#ffd700' },
    Breakthrough: { bg: '#2a0a0a', text: '#ff6b6b' },
  }
  const c = colors[impact] ?? { bg: '#1a1a1a', text: '#9ca3af' }
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
      backgroundColor: c.bg, color: c.text, textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      {impact}
    </span>
  )
}

// ─── Add Win Modal ────────────────────────────────────────────────────────────
function AddWinModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('business')
  const [impact, setImpact] = useState('Medium')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError(null)
    try {
      const { error: dbErr } = await supabase.from('wins_log').insert({
        title: title.trim(),
        description: description.trim() || null,
        category,
        impact,
      })
      if (dbErr) throw dbErr
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save win')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 7,
    backgroundColor: '#0d1321', border: '1px solid rgba(255,255,255,0.1)',
    color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5, display: 'block',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 420, backgroundColor: '#0a0b0f', border: '1px solid rgba(255,215,0,0.3)',
        borderRadius: 14, padding: 24, boxShadow: '0 0 40px rgba(255,215,0,0.1)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trophy size={18} style={{ color: '#ffd700' }} />
            <span style={{ fontSize: 14, fontWeight: 800, color: '#ffd700' }}>LOG A WIN</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        {/* Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Title *</label>
            <input
              style={inputStyle}
              placeholder="What did you accomplish?"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }}
              placeholder="Optional details..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label style={labelStyle}>Category</label>
            <select
              style={inputStyle}
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {CATEGORIES.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Impact</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {IMPACTS.map(imp => (
                <button
                  key={imp}
                  onClick={() => setImpact(imp)}
                  style={{
                    flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    border: impact === imp ? '1px solid #ffd700' : '1px solid rgba(255,255,255,0.1)',
                    backgroundColor: impact === imp ? 'rgba(255,215,0,0.15)' : '#0d1321',
                    color: impact === imp ? '#ffd700' : '#6b7280',
                  }}
                >
                  {imp}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 11, color: '#ff6b6b', padding: '6px 10px', borderRadius: 6, backgroundColor: 'rgba(255,0,0,0.1)' }}>
              {error}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '10px 0', borderRadius: 8, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
              backgroundColor: '#ffd700', color: '#0a0b0f', fontSize: 13, fontWeight: 800,
              opacity: saving ? 0.6 : 1, marginTop: 4,
            }}
          >
            {saving ? 'Saving…' : '🏆 Log This Win'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Wins Drawer ──────────────────────────────────────────────────────────────
function WinsDrawer({ open, onClose, rightOffset = 0 }: { open: boolean; onClose: () => void; rightOffset?: number }) {
  const [wins, setWins] = useState<Win[]>([])
  const [loading, setLoading] = useState(false)
  const [filterCat, setFilterCat] = useState<string>('all')
  const [showModal, setShowModal] = useState(false)

  const loadWins = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('wins_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (data) setWins(data)
    } catch {
      // non-fatal
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) loadWins()
  }, [open, loadWins])

  const filtered = filterCat === 'all' ? wins : wins.filter(w => w.category === filterCat)

  return (
    <>
      {/* Overlay */}
      {/* NAV1: backdrop only when no other panel is alongside (rightOffset === 0 means solo) */}
      {open && rightOffset === 0 && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 9000, backgroundColor: 'rgba(0,0,0,0.4)' }}
        />
      )}

      {/* Drawer — NAV1: rightOffset allows side-by-side with PinnedInsights */}
      <div style={{
        position: 'fixed', top: 0, right: rightOffset, bottom: 0, width: 380,
        zIndex: 9001,  /* NAV1: same z-index as PinnedInsights — no overlap */
        backgroundColor: '#0a0b0f', border: '1px solid rgba(255,215,0,0.2)',
        borderRight: rightOffset === 0 ? 'none' : '1px solid rgba(255,215,0,0.2)',
        transform: open ? 'translateX(0)' : `translateX(calc(100% + ${rightOffset}px))`,
        transition: 'transform 0.25s ease', display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
      }}>
        {/* Drawer Header */}
        <div style={{
          padding: '16px 18px', borderBottom: '1px solid rgba(255,215,0,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trophy size={18} style={{ color: '#ffd700' }} />
            <span style={{ fontSize: 14, fontWeight: 800, color: '#ffd700' }}>WINS LOG</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
              backgroundColor: 'rgba(255,215,0,0.15)', color: '#ffd700',
            }}>
              {wins.length}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(255,215,0,0.4)',
                backgroundColor: 'rgba(255,215,0,0.1)', color: '#ffd700',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >
              <Plus size={12} /> Add Win
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Filter Row */}
        <div style={{
          padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0,
        }}>
          <button
            onClick={() => setFilterCat('all')}
            style={{
              fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
              border: filterCat === 'all' ? '1px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.1)',
              backgroundColor: filterCat === 'all' ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: filterCat === 'all' ? '#e2e8f0' : '#6b7280',
            }}
          >
            All
          </button>
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setFilterCat(c.id)}
              style={{
                fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                border: filterCat === c.id ? `1px solid ${c.color}` : '1px solid rgba(255,255,255,0.1)',
                backgroundColor: filterCat === c.id ? `${c.color}22` : 'transparent',
                color: filterCat === c.id ? c.color : '#6b7280',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Win List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px' }}>
          {loading && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center', paddingTop: 24 }}>
              Loading…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center', paddingTop: 24 }}>
              No wins yet — log one!
            </div>
          )}
          {!loading && filtered.map(win => {
            const catColor = getCatColor(win.category)
            return (
              <div
                key={win.id}
                style={{
                  backgroundColor: '#0d1321', border: `1px solid ${catColor}22`,
                  borderLeft: `3px solid ${catColor}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: catColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', flex: 1, minWidth: 0 }}>{win.title}</span>
                  </div>
                  <ImpactBadge impact={win.impact} />
                </div>
                {win.description && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginLeft: 13, marginBottom: 4 }}>
                    {win.description}
                  </div>
                )}
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginLeft: 13 }}>
                  {fmtDate(win.created_at)} · {relTime(win.created_at)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {showModal && (
        <AddWinModal
          onClose={() => setShowModal(false)}
          onSaved={loadWins}
        />
      )}
    </>
  )
}

// ─── WinsLogPanel (Floating Button + Drawer) ──────────────────────────────────
// NAV1: toggle behavior — click once opens, click again closes. State in uiStore.
// When both WinsLog + PinnedInsights are open: side by side (WinsLog at right: 380).
// On mobile: stacked (rightOffset = 0 regardless).
export function WinsLogPanel() {
  const { winsLogOpen, toggleWinsLog, setWinsLogOpen, pinnedInsightsOpen } = useUIStore()

  // Listen for sidebar nav dispatch (still opens, doesn't close)
  useEffect(() => {
    const handler = () => setWinsLogOpen(true)
    window.addEventListener('poweron:open-wins-log', handler)
    return () => window.removeEventListener('poweron:open-wins-log', handler)
  }, [setWinsLogOpen])

  // When both panels open on wide screens, offset WinsLog to the left of PinnedInsights
  // Mobile: rightOffset = 0 (stacked, full width each)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const rightOffset = (!isMobile && pinnedInsightsOpen && winsLogOpen) ? 380 : 0

  return (
    <>
      {/* Floating Trophy Button — click to toggle */}
      <button
        onClick={toggleWinsLog}
        title={winsLogOpen ? 'Close Wins Log' : 'Open Wins Log'}
        style={{
          width: 42, height: 42, borderRadius: '50%',
          backgroundColor: winsLogOpen ? 'rgba(255,215,0,0.25)' : 'rgba(255,215,0,0.15)',
          border: winsLogOpen ? '1.5px solid rgba(255,215,0,0.6)' : '1px solid rgba(255,215,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0,
          boxShadow: winsLogOpen ? '0 0 20px rgba(255,215,0,0.35)' : '0 0 12px rgba(255,215,0,0.2)',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={e => {
          if (!winsLogOpen) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,215,0,0.25)'
            ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 20px rgba(255,215,0,0.35)'
          }
        }}
        onMouseLeave={e => {
          if (!winsLogOpen) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,215,0,0.15)'
            ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 12px rgba(255,215,0,0.2)'
          }
        }}
      >
        <Trophy size={18} style={{ color: '#ffd700' }} />
      </button>

      <WinsDrawer open={winsLogOpen} onClose={toggleWinsLog} rightOffset={rightOffset} />
    </>
  )
}

export default WinsLogPanel
