/**
 * LEAD-SRC-3B/3C/3C2 — recent call history list for Live Call workspace.
 *
 * Row actions: Edit/Classify (select), optional Open Dialer (tel: only),
 * optional Call Again (new outbound attempt — parent creates record).
 *
 * COACH-LINK-3B — embedded Live Call history shows ~10 normal rows, then
 * scrolls internally. This is a UI viewport limit only — callers still pass
 * the full fetched list (no truncation).
 */

import React from 'react'
import { Phone, PhoneCall, RotateCcw } from 'lucide-react'
import clsx from 'clsx'
import { dialerDigits, type CallLog } from '@/services/calls'

/** Visible rows before embedded Call History scrolls (UI only). */
export const CALL_HISTORY_VISIBLE_ROWS = 10

/**
 * Approx one normal call row (3 text lines + py-2 + border) and space-y-1.5 gaps.
 * Caps at 70vh so tablet / shorter viewports stay usable.
 */
export const CALL_HISTORY_EMBEDDED_MAX_H_CLASS =
  'max-h-[min(calc(10*4.25rem+9*0.375rem),70vh)]'

export interface RecentCallsPanelProps {
  calls: CallLog[]
  loading?: boolean
  onSelectCall?: (call: CallLog) => void
  /** Optional tel: only — must not create a duplicate historical row. */
  onOpenDialer?: (call: CallLog) => void
  /** Optional: start a NEW outbound attempt (parent creates record + opens modal). */
  onCallAgain?: (call: CallLog) => void
  leadNameById?: Record<string, string>
  /** When true, omit the outer "Recent Calls" chrome (parent supplies header). */
  embedded?: boolean
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

const CLASS_LABEL: Record<string, string> = {
  unclassified: 'Unclassified',
  new_lead: 'New Lead',
  existing_customer: 'Customer',
  spam: 'Spam',
  vendor: 'Vendor',
  other: 'Other',
}

export function RecentCallsPanel({
  calls,
  loading,
  onSelectCall,
  onOpenDialer,
  onCallAgain,
  leadNameById = {},
  embedded = false,
}: RecentCallsPanelProps) {
  const list = (
    <ul
      data-testid={embedded ? 'call-history-scroll-body' : undefined}
      data-visible-rows={embedded ? CALL_HISTORY_VISIBLE_ROWS : undefined}
      className={clsx(
        'space-y-1.5 overflow-y-auto overscroll-contain',
        embedded ? CALL_HISTORY_EMBEDDED_MAX_H_CLASS : 'max-h-40',
      )}
    >
      {calls.map((c) => {
        const isSpam = c.classification === 'spam'
        const matchedName = c.hunterLeadId
          ? leadNameById[c.hunterLeadId]
          : undefined
        const canDial = Boolean(dialerDigits(c.phoneRaw))
        return (
          <li key={c.id} data-testid="call-history-row">
            <div
              className={clsx(
                'flex items-stretch gap-1 rounded border text-xs transition-colors',
                isSpam
                  ? 'bg-red-950/40 border-red-800/60 text-red-100'
                  : 'bg-slate-900/80 border-white/10 text-gray-200',
              )}
            >
              <button
                type="button"
                onClick={() => onSelectCall?.(c)}
                className={clsx(
                  'flex-1 min-w-0 text-left px-2.5 py-2 rounded-l transition-colors',
                  isSpam ? 'hover:bg-red-950/60' : 'hover:bg-slate-800',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">
                    {c.direction === 'inbound' ? '↓ Inbound' : '↑ Outbound'}
                    {matchedName ? ` · ${matchedName}` : ''}
                  </span>
                  <span className="text-[10px] text-gray-500 shrink-0">
                    {formatWhen(c.occurredAt)}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-gray-400 truncate">
                  {c.phoneRaw}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-gray-500">
                  <span className={clsx(isSpam && 'text-red-300 font-semibold')}>
                    {CLASS_LABEL[c.classification] ?? c.classification}
                  </span>
                  <span>·</span>
                  <span>{c.outcome.replace(/_/g, ' ')}</span>
                  {c.hunterLeadId && (
                    <>
                      <span>·</span>
                      <span className="text-cyan-400/80">Lead linked</span>
                    </>
                  )}
                </div>
              </button>

              {(onOpenDialer || onCallAgain) && (
                <div className="flex flex-col justify-center gap-0.5 pr-1.5 py-1 shrink-0">
                  {onOpenDialer && canDial && (
                    <button
                      type="button"
                      onClick={() => onOpenDialer(c)}
                      data-testid="call-history-open-dialer"
                      aria-label="Open Dialer"
                      title="Open Dialer (optional)"
                      className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10"
                    >
                      <PhoneCall size={13} />
                    </button>
                  )}
                  {onCallAgain && canDial && (
                    <button
                      type="button"
                      onClick={() => onCallAgain(c)}
                      data-testid="call-history-call-again"
                      aria-label="Call Again"
                      title="Call Again — new outbound attempt"
                      className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10"
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )

  if (embedded) {
    return (
      <div>
        {loading && (
          <p className="text-[10px] text-gray-500 mb-2">Loading…</p>
        )}
        {list}
      </div>
    )
  }

  return (
    <div className="bg-gray-950/80 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <Phone size={14} className="text-blue-400" />
        <h3 className="text-xs font-semibold text-gray-200 uppercase tracking-wide">
          Recent Calls
        </h3>
        {loading && (
          <span className="text-[10px] text-gray-500">Loading…</span>
        )}
      </div>
      {list}
    </div>
  )
}

export default RecentCallsPanel
