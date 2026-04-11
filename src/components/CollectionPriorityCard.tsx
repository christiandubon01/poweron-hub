// @ts-nocheck
/**
 * CollectionPriorityCard — visual priority card for service collection queue.
 *
 * Priority levels (based on amount outstanding):
 *   > $1,000 : red highlight, larger card, "PRIORITY" badge
 *   $500–$1,000 : amber highlight, "ATTENTION" badge
 *   < $500  : standard display
 *   $0      : green "PAID" badge, dimmed
 *
 * Days outstanding: 30+ days shows red clock icon.
 *
 * Sort order is handled by the parent (V15rHome) — already DESC by balanceDue.
 */

import { Clock } from 'lucide-react'

interface CollectionPriorityCardProps {
  log: any
  onMarkCollected: (id: string) => void
}

function fmtBal(n: number): string {
  if (!n && n !== 0) return '$0'
  return '$' + Math.round(n).toLocaleString('en-US')
}

function daysSinceDate(dateStr: string): number {
  if (!dateStr) return 0
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}

type PriorityLevel = 'critical' | 'high' | 'standard' | 'paid'

function getPriorityLevel(balance: number): PriorityLevel {
  if (balance <= 0.009) return 'paid'
  if (balance > 1000)   return 'critical'
  if (balance >= 500)   return 'high'
  return 'standard'
}

export default function CollectionPriorityCard({ log, onMarkCollected }: CollectionPriorityCardProps) {
  const balance = Number(log.balanceDue) || 0
  const level   = getPriorityLevel(balance)
  const days    = daysSinceDate(log.date || '')
  const isOld   = days >= 30

  // ── Container style per priority ────────────────────────────────────────────
  const containerStyle: React.CSSProperties = {
    display:        'flex',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            12,
    borderRadius:   10,
    transition:     'box-shadow 0.15s',
    ...(level === 'critical' && {
      padding:    '14px 16px',
      border:     '1px solid rgba(239,68,68,0.55)',
      background: 'rgba(239,68,68,0.07)',
    }),
    ...(level === 'high' && {
      padding:    '12px 14px',
      border:     '1px solid rgba(245,158,11,0.45)',
      background: 'rgba(245,158,11,0.06)',
    }),
    ...(level === 'standard' && {
      padding:    '10px 12px',
      border:     '1px solid rgba(55,65,81,0.8)',
      background: 'var(--bg-card, #1e2235)',
    }),
    ...(level === 'paid' && {
      padding:    '10px 12px',
      border:     '1px solid rgba(16,185,129,0.3)',
      background: 'rgba(16,185,129,0.04)',
      opacity:    0.65,
    }),
  }

  // ── Balance text color ───────────────────────────────────────────────────────
  const balColor =
    level === 'critical' ? '#f87171' :
    level === 'high'     ? '#fbbf24' :
    level === 'paid'     ? '#34d399' :
    '#e5e7eb'

  // ── Badge ────────────────────────────────────────────────────────────────────
  const badge = level === 'critical' ? (
    <span style={{ backgroundColor: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.08em' }}>
      PRIORITY
    </span>
  ) : level === 'high' ? (
    <span style={{ backgroundColor: '#f59e0b', color: '#1f2937', fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.06em' }}>
      ATTENTION
    </span>
  ) : level === 'paid' ? (
    <span style={{ backgroundColor: '#10b981', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4 }}>
      PAID
    </span>
  ) : null

  return (
    <div style={containerStyle}>
      {/* ── Left: info ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Customer name + badge row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          {badge}
          <span style={{ fontSize: level === 'critical' ? 15 : 13, fontWeight: 700, color: '#f0f0f0' }}>
            {log.customer}
          </span>
        </div>

        {/* Job type · balance · days outstanding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {log.jtype && (
            <span style={{ fontSize: 11, color: '#9ca3af' }}>{log.jtype}</span>
          )}
          {balance > 0.009 && (
            <span style={{ fontSize: level === 'critical' ? 14 : 12, fontWeight: 700, color: balColor }}>
              {fmtBal(balance)} due
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: isOld ? '#ef4444' : '#6b7280' }}>
            {isOld && <Clock size={11} color="#ef4444" />}
            {days}d ago
          </span>
        </div>
      </div>

      {/* ── Right: action button ─────────────────────────────────────────────── */}
      {balance > 0.009 && (
        <button
          onClick={() => onMarkCollected(log.id)}
          style={{
            flexShrink:      0,
            fontSize:        10,
            padding:         level === 'critical' ? '8px 14px' : '6px 12px',
            borderRadius:    6,
            backgroundColor: 'rgba(16,185,129,0.15)',
            color:           '#34d399',
            border:          '1px solid rgba(16,185,129,0.3)',
            cursor:          'pointer',
            fontWeight:      700,
            whiteSpace:      'nowrap',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(16,185,129,0.28)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(16,185,129,0.15)' }}
        >
          Mark Collected
        </button>
      )}
    </div>
  )
}
