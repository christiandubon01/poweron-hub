import { ParentBucketTag } from './ParentBucketTag'
import { useState, type ReactNode } from 'react'
import { TransactionDetail } from './detail/TransactionDetail'
import { shortDate, usd2, withMask } from './format'
import { entryType, toneColor } from './entryType'
import { AccountColorDot, CategoryPill, StripeBar, tintStyle, useDisplayColors } from '@/features/display-colors/DisplayColors'
import { categoryStripe } from '@/features/display-colors/stripes'
import { useSpendingExplorer, type HistoryEntry, type ExplorerRow, type Options } from './useSpendingExplorer'
import { selectedCard, btn } from './ui'
import { Checkbox, Chip, StatusBadge } from './controls'

export function TransactionRow({ row, options, busy, onDecide, environment, loadHistory, selectable, selected, onToggle, overrideLabel, reviewedView, checkboxColumn, onRelated, relatedContent, selectionLabel }: { selectionLabel?:string;onRelated?:()=>void;relatedContent?:ReactNode; row: ExplorerRow; overrideLabel?: string | null; reviewedView?: boolean; /** keep merchants aligned when some rows in the list have a checkbox */ checkboxColumn?: boolean; environment?: string; loadHistory: (id: string) => Promise<HistoryEntry[]>; selectable: boolean; selected: boolean; onToggle: (row: ExplorerRow) => void; options: Options; busy: boolean; onDecide: ReturnType<typeof useSpendingExplorer>['decide'] }) {
  const [open, setOpen] = useState(false)
  const out = row.direction === 'money_out'
  const { categoryColor, tint } = useDisplayColors()
  // BANK-6D: the category owns the stripe (solid only when CONFIRMED); a selection is shown by a ring + the "✓ Selected" chip, never by the stripe.
  const stripe = categoryStripe({ key: row.bucket.key, state: row.bucket.state, ignored: row.review === 'ignored' }, categoryColor, tint.rows)
  const tinted = tintStyle(stripe)
  const type = entryType(row) // display only: from the interpretation, never from the amount sign alone
  // BANK-6E entry card: rail (category), merchant + amount on one line, date · account (with its color dot), then explicit text pills.
  return <li data-testid="spending-row" data-review={row.review} data-pending={row.pending ? 'true' : 'false'} data-selected={selected ? 'true' : 'false'} data-tint={tinted ? 'on' : 'off'}
    className={`relative rounded-xl border border-[var(--surface-line)] py-2 pl-5 pr-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.18)] motion-safe:transition-colors ${tinted || selected ? '' : 'bg-[var(--surface-1)] [@media(hover:hover)]:hover:bg-[var(--surface-2)]'} ${row.review === 'ignored' ? 'opacity-70' : ''}`}
    style={selected ? selectedCard : tinted}>
    <StripeBar stripe={stripe} shape="card" />
    <div className="flex items-start gap-1.5">
    {selectable ? <span className="-ml-2 -mt-1"><Checkbox checked={selected} onChange={() => onToggle(row)} label={selectionLabel??`Select ${row.merchant} for batch approval`} testId="spending-select" /></span>
      : checkboxColumn && <span aria-hidden="true" className="-ml-2 min-w-[44px]" />}
    <button type="button" className="grid min-h-[44px] w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]" data-testid="transaction-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span className="min-w-0 truncate text-[15px] font-semibold leading-6 tracking-[-0.01em]">{row.merchant}</span>
      <span className={`text-right text-[15px] font-semibold leading-6 tabular-nums ${row.pending ? 'opacity-70' : ''}`} style={{ color: toneColor(type.tone) }} data-testid="entry-amount">{out ? '−' : '+'}{usd2(row.amountMinor)}</span>
      <span className="min-w-0 truncate text-xs text-[var(--text-secondary)]">{shortDate(row.date)} · <AccountColorDot accountId={row.account.financialAccountId} />{withMask(row.account.mappedTo ?? row.account.label, row.account.mask)} · {row.account.ownership==='business'?'Business account':row.account.ownership==='personal'?'Personal account':'Account ownership unclear'}</span>
      <span className="flex items-center justify-end gap-1 text-right text-xs font-semibold" style={{ color: toneColor(type.tone) ?? 'var(--text-secondary)' }} data-testid="entry-type" data-kind={type.kind}>
        <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[11px] leading-none ring-1 ring-current">{type.glyph}</span>{type.label}</span>
      <span className="col-span-2 mt-1.5 flex flex-wrap items-center gap-1">
          {selected && <Chip tone="sel">✓ Selected</Chip>}
          {overrideLabel && <Chip tone="sel">Your category: {overrideLabel}</Chip>}
          {row.pending && <Chip tone="warn">Pending</Chip>}
          {(row as ExplorerRow & { removed?: boolean }).removed && <Chip tone="muted">Removed · historical evidence</Chip>}
          {row.account.environment === 'sandbox' && environment === 'production' && <Chip>Sandbox</Chip>}
          {row.review === 'ignored' ? <Chip tone="muted">Ignored</Chip> : <>
            {row.bucket.label && <ParentBucketTag categoryKey={row.bucket.key} />}
            {row.bucket.label && <span className="text-[11px] text-[var(--text-secondary)]">Category</span>}
            {row.bucket.label && <CategoryPill categoryKey={row.bucket.key} label={row.bucket.label} state={row.bucket.state} />}
            <Chip tone={row.relationship.state === 'confirmed' ? 'done' : 'neutral'}>{row.relationship.state === 'none' ? 'Financial link unresolved' : `Financial link: ${row.relationship.state === 'confirmed' ? '✓ ' : ''}${row.relationship.label}${row.relationship.target?.label ? ` · ${row.relationship.target.label}` : ''}${row.relationship.state === 'suggested' ? ' · suggested' : ''}`}</Chip>
            {reviewedView && row.relationship.state === 'confirmed' && row.bucket.state !== 'confirmed' && <span data-testid="spending-category-needs-review"><Chip tone="warn">Relationship reviewed · Category needs review</Chip></span>}
            {(row.scope.value==='unclear'||row.scope.value!==row.account.ownership||row.scope.source==='owner') && <Chip tone={row.scope.value==='unclear'?'muted':'neutral'}>Use: {row.scope.value==='unclear'?'Business or personal unclear':row.scope.value} · {row.scope.source==='owner'?'owner decision':'context'}</Chip>}
            {row.pattern && out && (row.pattern.kind === 'obligation_like' ? <Chip tone="warn">Looks like a recurring bill</Chip> : <Chip>Repeats {row.pattern.cadence}</Chip>)}
          </>}
          <span className="ml-auto pl-2"><StatusBadge state={row.review} /></span>
      </span>
    </button>
    </div>
    {onRelated&&<button type="button" className={`${btn} mt-2`} onClick={onRelated} aria-expanded={!!relatedContent} data-testid="view-related-transactions">View related transactions</button>}
    {relatedContent}
    {row.review==='ignored' && <p className="pl-1 text-xs text-[var(--text-secondary)]">Ignored · cash movement only, no expense allocation</p>}
    {open && <TransactionDetail row={row} options={options} busy={busy} onDecide={onDecide} loadHistory={loadHistory} />}
  </li>
}
