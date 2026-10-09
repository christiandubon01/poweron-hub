/**
 * src/features/spending-explorer/SelectionBar.tsx
 *
 * BANK-6F: ONE selection bar and ONE approval confirmation for the Explorer and Smart Review (they each built their own). Presentation only: the
 * caller owns the selection, the totals it shows and the approve call. Asking to approve never writes; only "Confirm approval" calls `onConfirm`.
 * The bar is sticky above the iPad / iPhone home indicator (safe-area inset). A selection is a draft, so it is blue (D1); the one primary action
 * keeps the action color.
 */
import type { ReactNode } from 'react'
import { CategoryDot } from '@/features/display-colors/DisplayColors'
import { usd2 } from './format'
import { btn, btnPrimary } from './ui'

export interface BreakdownLine { key: string; label: string; count: number; totalMinor: number }

export function SelectionBar({ prefix, count, totalMinor, note, confirming, confirm, children }: {
  /** test-id prefix: `spending` (Explorer) or `smart` (Smart Review) */
  prefix: string
  count: number
  totalMinor: number
  /** text after the total, e.g. "not approved yet" */
  note?: string
  confirming: boolean
  confirm: ReactNode
  /** the actions shown while not confirming */
  children: ReactNode
}) {
  return <div className="sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-10 mt-3 space-y-2 rounded-2xl border bg-[var(--bg-card)] p-3 shadow-[0_10px_28px_rgba(0,0,0,0.28)]"
    style={{ borderColor: 'var(--fin-protected-border)' }} data-testid={`${prefix}-selection-bar`} role="region" aria-label="Selected transactions">
    <p className="text-sm font-semibold" aria-live="polite"><span data-testid={`${prefix}-selected-count`}>{count} selected</span> <span className="font-normal text-[var(--text-secondary)]">· {usd2(totalMinor)} going out{note ? ` · ${note}` : ''}</span></p>
    {confirming ? confirm : <div className="flex flex-wrap gap-2">{children}</div>}
  </div>
}

export function ApprovalConfirm({ prefix, label, count, breakdown, totalMinor, extra, busy, onConfirm, onCancel }: {
  prefix: string
  label: string
  count: number
  breakdown: BreakdownLine[]
  totalMinor: number
  /** e.g. the "Also remember" line in Smart Review */
  extra?: ReactNode
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return <section role="alertdialog" aria-label={label} data-testid={`${prefix}-confirm`} className="space-y-2 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-1)] p-3">
    <p className="text-sm font-semibold" data-testid={`${prefix}-confirm-title`}>Approve {count} transaction{count === 1 ? '' : 's'}?</p>
    <ul className="space-y-0.5 text-sm" data-testid={`${prefix}-confirm-breakdown`}>{breakdown.map(b => <li key={b.key} className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2"><CategoryDot categoryKey={b.key} /><span className="truncate">{b.label} · {b.count}</span></span><span className="tabular-nums">{usd2(b.totalMinor)}</span></li>)}</ul>
    <p className="flex justify-between gap-3 border-t border-[var(--surface-line)] pt-2 text-sm font-semibold" data-testid={`${prefix}-confirm-total`}><span>Total going out</span><span className="tabular-nums">{usd2(totalMinor)}</span></p>
    {extra}
    <p className="text-xs text-[var(--text-secondary)]">This labels these bank records with the categories shown. It does not change your balances, ledger, bills, payroll or reports, and each one can be undone.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btnPrimary} disabled={busy} onClick={onConfirm} data-testid={`${prefix}-confirm-approve`}>Confirm approval</button>
      <button type="button" className={btn} disabled={busy} onClick={onCancel} data-testid={`${prefix}-confirm-cancel`}>Cancel</button>
    </div>
  </section>
}
