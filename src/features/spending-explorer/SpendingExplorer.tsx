import { useEffect, useRef, useState } from 'react'
import { clearDraft, loadDraft, saveDraft } from './reviewDraft'
import SmartReview from './SmartReview'
import { TransactionDetail } from './detail/TransactionDetail'
import { shortDate, usd0, usd2, withMask } from './format'
import { BucketPicker } from './BucketPicker'
import { ApprovalConfirm, SelectionBar } from './SelectionBar'
import { SpendingSnapshot } from './snapshot/SpendingSnapshot'
import { entryType, toneColor } from './entryType'
import { AccountColorDot, CategoryDot, CategoryPill, ColorsPanel, StripeBar, tintStyle, useDisplayColors } from '@/features/display-colors/DisplayColors'
import { categoryStripe } from '@/features/display-colors/stripes'
import { useSpendingExplorer, type Analytics, type BatchResult, type HistoryEntry, type ExplorerRow, type Options } from './useSpendingExplorer'

import { btn, btnPrimary, eyebrow, selectedCard } from './ui'
import { Checkbox, Chip, SegmentedControl, StatusBadge } from './controls'
import { FilterBar, VIEW_CAPTION, ViewTabs } from './ExplorerControls'
const SKIP_TEXT: Record<string, string> = {
  pending: 'still pending', money_in: 'money coming in', no_suggestion: 'nothing recognised', not_high_confidence: 'not a confident match', needs_individual_review: 'needs your individual decision', mixed_purpose: 'needs you to pick the category',
  relationship_suggested: 'also suggests a bill, payroll, transfer or project', already_decided: 'already decided', not_found: 'not found', failed: 'could not be saved',
}
export const batchSummary = (r: BatchResult): string => {
  const reasons = new Map<string, number>()
  for (const x of r.results) if (x.result === 'skipped' && x.reason) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1)
  const left = [...reasons].map(([k, n]) => `${n} ${SKIP_TEXT[k] ?? k}`).join(', ')
  return `Approved ${r.confirmed}${r.unchanged ? ` (${r.unchanged} already approved)` : ''}.${r.skipped ? ` ${r.skipped} left for individual review: ${left}.` : ''}`
}


/** Mirrors the SERVER's batch rule only so the checkboxes appear on the right rows. The server re-decides everything when the owner confirms. */
const isBatchApprovable = (r: ExplorerRow, batchBuckets: string[]) => r.direction === 'money_out' && !r.pending && r.review !== 'ignored' && r.bucket.state === 'suggested' && r.bucket.confidence === 'high' && !r.bucket.mixed
  && !!r.bucket.key && batchBuckets.includes(r.bucket.key) && r.relationship.state !== 'suggested'



const signed = (r: ExplorerRow) => `${r.direction === 'money_out' ? '−' : '+'}${usd2(r.amountMinor)}`

/**
 * The selection, made reviewable. EVERY transaction of the draft stays listed here; tapping a line only checks or unchecks it (a second tap restores it),
 * so an accidental tap costs nothing. Only CHECKED lines are approved. Each line has its own category control so a wrong suggestion can be corrected
 * before approval (the server validates every choice). Nothing here approves or saves anything.
 */
function SelectedReview({ items, off, overrides, categoryChoices, categories, busy, onToggle, onCategory, onUncheckCategory }: {
  items: ExplorerRow[]; off: Set<string>; overrides: Map<string, string>; categoryChoices: Array<{ key: string; label: string; hint?: string }>
  categories: Array<{ key: string; label: string; count: number }>; busy: boolean
  onToggle: (row: ExplorerRow) => void; onCategory: (row: ExplorerRow, key: string) => void; onUncheckCategory: (key: string) => void
}) {
  const labelOf = (key: string | null) => categoryChoices.find(c => c.key === key)?.label ?? 'Uncategorized'
  const { categoryColor } = useDisplayColors()
  const [picking, setPicking] = useState<ExplorerRow | null>(null)
  return <div className="mt-2" data-testid="spending-selected-review">
    <p className="text-xs text-[var(--text-secondary)]">Tap a transaction to check or uncheck it. Only checked transactions are approved. Use the category box to correct a suggestion first. Nothing is saved until you confirm.</p>
    {categories.length > 0 && <div className="mt-2 flex flex-wrap gap-2" data-testid="spending-selected-categories" aria-label="Uncheck a whole category">
      {categories.map(c => <button key={c.key} type="button" className={btn} disabled={busy} onClick={() => onUncheckCategory(c.key)} aria-label={`Uncheck all ${c.label} (${c.count})`} data-testid="spending-uncheck-category">Uncheck all {c.label} ({c.count})</button>)}
    </div>}
    <ul className="mt-2 space-y-2" data-testid="spending-selected-list" aria-label="Transactions in this review">{items.map(r => {
      // not yet approved, so even the owner's chosen category shows as a faded stripe
      const on = !off.has(r.id)
      const chosenKey = overrides.get(r.id) ?? r.bucket.key
      const changed = overrides.has(r.id) && overrides.get(r.id) !== r.bucket.key
      return <li key={r.id} data-testid="spending-selected-item" data-checked={on ? 'true' : 'false'} className="relative rounded-lg border border-[var(--surface-line)] p-2 pl-4"
        style={on ? selectedCard : { opacity: 0.7 }}>
        <StripeBar stripe={categoryStripe({ key: chosenKey, state: chosenKey ? 'suggested' : 'none' }, categoryColor)} shape="card-sm" />
        <label className={`flex min-h-[56px] w-full items-start gap-2 ${busy ? 'opacity-60' : 'cursor-pointer'}`}>
          <Checkbox size="lg" checked={on} disabled={busy} onChange={() => onToggle(r)} label={`${on ? 'Uncheck' : 'Check'} ${r.merchant}`} testId="spending-selected-toggle" />
          <span className="flex min-w-0 flex-1 items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{r.merchant}</span>
              <span className="block text-xs text-[var(--text-secondary)]">{shortDate(r.date)} · {r.account.mappedTo ?? r.account.label}{r.account.mask ? ` ••••${r.account.mask}` : ''}</span>
              <span className="mt-1 block"><Chip tone={on ? 'sel' : 'muted'}>{on ? '✓ Selected' : 'Not selected'}</Chip></span>
            </span>
            <span className="shrink-0 text-sm font-semibold">{signed(r)}</span>
          </span>
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2 pl-[52px]">
          <span className="text-xs text-[var(--text-secondary)]">Category</span>
          <button type="button" className={`${btn} min-w-0 flex-1 text-left`} disabled={busy} onClick={() => setPicking(r)} data-testid="spending-selected-category" data-value={chosenKey ?? ''}
            aria-label={`Category for ${r.merchant}: ${labelOf(chosenKey)}. Change`}>
            <span className="flex min-w-0 items-center gap-2"><CategoryDot categoryKey={chosenKey} /><span className="truncate">{labelOf(chosenKey)}{chosenKey === r.bucket.key ? ' (suggested)' : ''}</span><span aria-hidden="true" className="ml-auto text-[var(--text-secondary)]">⌄</span></span>
          </button>
          {changed && <span className="w-full text-xs" data-testid="spending-category-changed" style={{ color: 'var(--fin-warning)' }}>Changed from the suggestion ({labelOf(r.bucket.key)}). Your category will be saved when you confirm.</span>}
        </div>
      </li>
    })}</ul>
    {picking && <BucketPicker open busy={busy} options={categoryChoices} currentKey={overrides.get(picking.id) ?? picking.bucket.key} suggestedKey={picking.bucket.key}
      title="Category for approval" eyebrow="Review selected" context={`${picking.merchant} · ${signed(picking)} · ${shortDate(picking.date)}`} applyLabel="Use"
      idleNote="Only categories that can be approved together are listed. Nothing is saved until you confirm approval."
      changeNote={(to, from) => <>Use <span className="font-semibold text-[var(--text-primary)]">{to}</span>{from ? <> instead of {from}</> : null}. Nothing is saved until you confirm approval.</>}
      onClose={() => setPicking(null)} onApply={key => { onCategory(picking, key); setPicking(null) }} />}
  </div>
}

function Signals({ a }: { a: Analytics }) {
  const [open, setOpen] = useState(false)
  const n = a.observations.length + a.suggestions.length
  if (!n) return null
  return <div className="mt-3">
    <button type="button" className="min-h-[44px] text-sm font-semibold underline-offset-2 [@media(hover:hover)]:hover:underline" aria-expanded={open} onClick={() => setOpen(o => !o)} data-testid="spending-signals-toggle">{open ? 'Hide' : 'Show'} money-bleed signals ({n})</button>
    {open && <div className="mt-1 space-y-3" data-testid="spending-signals">
      {a.unclassified.count > 0 && <p className="text-xs text-[var(--text-secondary)]" data-testid="spending-unclassified-note">{usd0(a.unclassified.totalMinor)} across {a.unclassified.count} transaction{a.unclassified.count === 1 ? '' : 's'} is not classified yet. It stays in review and is not counted as wasteful spending.</p>}
      {a.suggestions.length > 0 && <div><p className={eyebrow}>Possible issues <span className="font-normal normal-case">(a heuristic: check before acting)</span></p>
        <ul className="mt-1 space-y-1">{a.suggestions.map(s => <li key={s.id} className="rounded-lg border border-[var(--surface-line)] p-2 text-sm"><p className="font-semibold">{s.title}</p><p className="text-xs text-[var(--text-secondary)]">{s.detail}</p></li>)}</ul></div>}
      {a.observations.length > 0 && <div><p className={eyebrow}>Measured <span className="font-normal normal-case">(straight from your bank evidence)</span></p>
        <ul className="mt-1 space-y-1">{a.observations.map(o => <li key={o.id} className="text-sm">{o.text}</li>)}</ul></div>}
    </div>}
  </div>
}

function Row({ row, options, busy, onDecide, environment, loadHistory, selectable, selected, onToggle, overrideLabel, reviewedView, checkboxColumn }: { row: ExplorerRow; overrideLabel?: string | null; reviewedView?: boolean; /** keep merchants aligned when some rows in the list have a checkbox */ checkboxColumn?: boolean; environment?: string; loadHistory: (id: string) => Promise<HistoryEntry[]>; selectable: boolean; selected: boolean; onToggle: (row: ExplorerRow) => void; options: Options; busy: boolean; onDecide: ReturnType<typeof useSpendingExplorer>['decide'] }) {
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
    {selectable ? <span className="-ml-2 -mt-1"><Checkbox checked={selected} onChange={() => onToggle(row)} label={`Select ${row.merchant} for batch approval`} testId="spending-select" /></span>
      : checkboxColumn && <span aria-hidden="true" className="-ml-2 min-w-[44px]" />}
    <button type="button" className="grid min-h-[44px] w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span className="min-w-0 truncate text-[15px] font-semibold leading-6 tracking-[-0.01em]">{row.merchant}</span>
      <span className={`text-right text-[15px] font-semibold leading-6 tabular-nums ${row.pending ? 'opacity-70' : ''}`} style={{ color: toneColor(type.tone) }} data-testid="entry-amount">{out ? '−' : '+'}{usd2(row.amountMinor)}</span>
      <span className="min-w-0 truncate text-xs text-[var(--text-secondary)]">{shortDate(row.date)} · <AccountColorDot accountId={row.account.financialAccountId} />{withMask(row.account.mappedTo ?? row.account.label, row.account.mask)}</span>
      <span className="flex items-center justify-end gap-1 text-right text-xs font-semibold" style={{ color: toneColor(type.tone) ?? 'var(--text-secondary)' }} data-testid="entry-type" data-kind={type.kind}>
        <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[11px] leading-none ring-1 ring-current">{type.glyph}</span>{type.label}</span>
      <span className="col-span-2 mt-1.5 flex flex-wrap items-center gap-1">
          {selected && <Chip tone="sel">✓ Selected</Chip>}
          {overrideLabel && <Chip tone="sel">Your category: {overrideLabel}</Chip>}
          {row.pending && <Chip tone="warn">Pending</Chip>}
          {row.account.environment === 'sandbox' && environment === 'production' && <Chip>Sandbox</Chip>}
          {row.review === 'ignored' ? <Chip tone="muted">Ignored</Chip> : <>
            {row.bucket.label && <CategoryPill categoryKey={row.bucket.key} label={row.bucket.label} state={row.bucket.state} />}
            <Chip tone={row.relationship.state === 'confirmed' ? 'done' : 'neutral'}>{row.relationship.state === 'none' ? (out ? 'Unassigned' : row.relationship.label) : `${row.relationship.state === 'confirmed' ? '✓ ' : ''}${row.relationship.label}${row.relationship.target?.label ? ` · ${row.relationship.target.label}` : ''}${row.relationship.state === 'suggested' ? ' · suggested' : ''}`}</Chip>
            {reviewedView && row.relationship.state === 'confirmed' && row.bucket.state !== 'confirmed' && <span data-testid="spending-category-needs-review"><Chip tone="warn">Relationship reviewed · Category needs review</Chip></span>}
            {reviewedView && <Chip tone={row.scope.value === 'unclear' ? 'muted' : 'neutral'}>{row.scope.value === 'business' ? 'Business' : row.scope.value === 'personal' ? 'Personal' : 'Business or personal: unclear'}</Chip>}
            {row.pattern && out && (row.pattern.kind === 'obligation_like' ? <Chip tone="warn">Looks like a recurring bill</Chip> : <Chip>Repeats {row.pattern.cadence}</Chip>)}
          </>}
          <span className="ml-auto pl-2"><StatusBadge state={row.review} /></span>
      </span>
    </button>
    </div>
    {open && <TransactionDetail row={row} options={options} busy={busy} onDecide={onDecide} loadHistory={loadHistory} />}
  </li>
}

/**
 * Spending Explorer: bank evidence turned into reviewable interpretations. It renders nothing when the caller cannot review spending or
 * no bank evidence exists. Everything here is a SUGGESTION until the owner confirms it, and confirming changes no balance, ledger or report.
 */
export default function SpendingExplorer() {
  const { load, data, rows, filters, update, reset, busy, message, decide, decideBatch, loadHistory, loadMore, refresh } = useSpendingExplorer()
  const [showFilters, setShowFilters] = useState(false)
  const [mode, setMode] = useState<'explorer' | 'smart'>('explorer')
  const [showColors, setShowColors] = useState(false)
  const colorsEnabled = useDisplayColors().enabled
  // The review DRAFT. `selection` holds a snapshot of each row (display only), `off` the ones unchecked, `overrides` the owner's category corrections.
  // Nothing here is a decision: the server re-validates every id and category when the owner confirms.
  const [selection, setSelection] = useState<Map<string, ExplorerRow>>(new Map())
  const [off, setOff] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map())
  const [pendingRestore, setPendingRestore] = useState<Set<string>>(new Set())
  const [reviewing, setReviewing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [batchNote, setBatchNote] = useState<string | null>(null)
  const restored = useRef(false)
  const scope = data?.draftScope ?? null
  const batchBuckets = data?.options.batchBuckets ?? []
  const maxBatch = data?.options.maxBatch ?? 100

  // Reload safety: restore the saved draft ONCE per page load, re-selecting only rows that are still eligible bank evidence. Ids not on the loaded page wait
  // (they are shown as a note) and are dropped once the whole unfiltered queue is loaded without them. A restored draft never carries an approval.
  useEffect(() => {
    if (load !== 'ready' || !data || !scope) return
    const byId = new Map(rows.map(r => [r.id, r]))
    const fullQueueLoaded = filters.view === 'review_queue' && rows.length >= data.total && !filters.bucket && !filters.account && !filters.scope && !filters.review && !filters.confidence && !filters.project && !filters.search && !filters.min && !filters.max
    let sel = selection, pend = pendingRestore, nextOff = off, nextOverrides = overrides, changed = false
    if (!restored.current) {
      restored.current = true
      const wanted = loadDraft(scope)
      if (wanted) {
        sel = new Map(); pend = new Set(); changed = true
        for (const id of wanted.ids) { const r = byId.get(id); if (r && isBatchApprovable(r, batchBuckets) && sel.size < maxBatch) sel.set(id, r); else if (!r) pend.add(id) }
        nextOff = new Set(wanted.off); nextOverrides = new Map(Object.entries(wanted.overrides))
      }
    }
    if (pend.size > 0) {
      sel = new Map(sel); pend = new Set(pend)
      for (const id of [...pend]) {
        const r = byId.get(id)
        if (r) { pend.delete(id); changed = true; if (isBatchApprovable(r, batchBuckets) && sel.size < maxBatch) sel.set(id, r) }
        else if (fullQueueLoaded) { pend.delete(id); changed = true }
      }
    }
    if (changed) {
      setSelection(sel); setPendingRestore(pend)
      setOff(new Set([...nextOff].filter(id => sel.has(id) || pend.has(id)))); setOverrides(new Map([...nextOverrides].filter(([id]) => sel.has(id) || pend.has(id))))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, data, rows])

  // Keep the draft saved as it changes (ids, unchecked ids, category choices only). An empty draft removes it.
  useEffect(() => {
    if (!scope || !restored.current) return
    saveDraft(scope, { ids: [...selection.keys(), ...pendingRestore], off: [...off], overrides: Object.fromEntries(overrides) })
  }, [scope, selection, off, overrides, pendingRestore])

  if (load !== 'ready' || !data || data.viewCounts.all === 0) return null
  const a = data.analytics
  const approvable = (r: ExplorerRow) => isBatchApprovable(r, batchBuckets)
  const categoryChoices = (data.options.buckets ?? []).filter(b => batchBuckets.includes(b.key)).map(b => ({ key: b.key, label: b.label, hint: b.hint }))
  const labelFor = (key: string | null) => categoryChoices.find(c => c.key === key)?.label ?? data.options.buckets.find(b => b.key === key)?.label ?? 'Uncategorized'
  const eligible = rows.filter(approvable)
  const freshById = new Map(rows.map(r => [r.id, r]))
  // A draft row that has since been decided or changed (and is on the current page) drops out; one not on the current page keeps its snapshot.
  const items = [...selection.values()].map(snap => freshById.get(snap.id) ?? snap).filter(r => !freshById.has(r.id) || approvable(r)).sort((x, y) => y.date.localeCompare(x.date) || x.id.localeCompare(y.id))
  const effectiveKey = (r: ExplorerRow) => overrides.get(r.id) ?? r.bucket.key ?? 'uncategorized'
  const chosen = items.filter(r => !off.has(r.id)) // the ones that WILL be sent for approval, if the owner confirms
  const chosenIds = new Set(chosen.map(r => r.id))
  const categories = [...chosen.reduce((m, r) => { const key = effectiveKey(r); const e = m.get(key) ?? { key, label: labelFor(key), count: 0 }; e.count += 1; return m.set(key, e) }, new Map<string, { key: string; label: string; count: number }>()).values()].sort((x, y) => y.count - x.count || x.label.localeCompare(y.label))
  const totalOutMinor = chosen.reduce((n, r) => n + Math.abs(r.amountMinor), 0)
  const breakdown = [...chosen.reduce((m, r) => { const k = effectiveKey(r); const e = m.get(k) ?? { key: k, label: labelFor(k), count: 0, totalMinor: 0 }; e.count += 1; e.totalMinor += Math.abs(r.amountMinor); return m.set(k, e) }, new Map<string, { key: string; label: string; count: number; totalMinor: number }>()).values()].sort((x, y) => y.totalMinor - x.totalMinor || x.label.localeCompare(y.label))
  const touch = () => { setConfirming(false); setBatchNote(null) } // any change to the draft voids a confirmation that was already showing
  /** Tap = check or uncheck. A row that was never selected is added (checked); a selected row only flips, and stays listed. */
  const toggle = (row: ExplorerRow) => {
    touch()
    if (!selection.has(row.id)) {
      if (selection.size >= maxBatch) { setBatchNote(`You can select up to ${maxBatch} at a time.`); return }
      setSelection(new Map(selection).set(row.id, row)); return
    }
    setOff(prev => { const n = new Set(prev); if (n.has(row.id)) n.delete(row.id); else n.add(row.id); return n })
  }
  const setCategory = (row: ExplorerRow, key: string) => {
    touch()
    setOverrides(prev => { const n = new Map(prev); if (!key || key === row.bucket.key) n.delete(row.id); else n.set(row.id, key); return n })
  }
  /** Explicit, one tap: uncheck every CHECKED transaction in ONE category (they stay listed and can be checked again). Nothing is approved or saved. */
  const uncheckCategory = (key: string) => {
    touch()
    const ids = chosen.filter(r => effectiveKey(r) === key).map(r => r.id)
    setOff(prev => new Set([...prev, ...ids]))
  }
  const selectConfident = () => {
    touch()
    const n = new Map(selection)
    for (const r of eligible) { if (n.size >= maxBatch) break; if (!n.has(r.id)) n.set(r.id, r) }
    setSelection(n)
    setOff(prev => new Set([...prev].filter(id => !eligible.some(r => r.id === id && !selection.has(id))))) // newly added rows start checked
  }
  const clearSelection = () => { setSelection(new Map()); setOff(new Set()); setOverrides(new Map()); setPendingRestore(new Set()); setReviewing(false); setConfirming(false); if (scope) clearDraft(scope) }
  const approveSelected = async () => {
    const ids = chosen.map(r => r.id).slice(0, maxBatch)
    if (!ids.length) return
    const sent: Record<string, string> = {}
    for (const id of ids) { const k = overrides.get(id); const r = chosen.find(x => x.id === id); if (k && r && k !== r.bucket.key) sent[id] = k }
    const out = await decideBatch(ids, sent)
    if (!out) { setConfirming(false); return } // the request failed: the draft is kept so nothing has to be rebuilt
    clearSelection()
    setBatchNote(batchSummary(out))
  }
  const showingSelected = reviewing && items.length > 0
  return <section data-testid="spending-explorer" aria-label="Spending explorer" className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 sm:p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Spending explorer · bank evidence</h3>
      <span className="text-xs text-[var(--text-secondary)]">Suggestions only. Nothing here changes your balances, ledger or reports.</span>
    </div>
    <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="spending-scope-caption">Summary: last {a.windowDays} days · {data.accounts === 'all' ? 'all connected accounts' : 'mapped accounts'}</p>
    <div className="mt-3"><SpendingSnapshot a={a} selected={filters.bucket} onPick={bucket => update({ bucket, view: bucket ? 'unassigned' : filters.view })} /><Signals a={a} /></div>

    <SegmentedControl className="mt-4" label="Review mode" value={mode} onChange={setMode} options={[
      { value: 'explorer', label: 'Explorer', testId: 'spending-mode-explorer' }, { value: 'smart', label: 'Smart Review', testId: 'spending-mode-smart' }]} />
    {mode === 'smart' ? <SmartReview onChanged={() => void refresh()} /> : <>
    <p className="mt-4 text-xs text-[var(--text-secondary)]" data-testid="spending-list-caption">Transactions: last {filters.days} days · {data.accounts === 'all' ? 'all connected accounts' : 'mapped accounts'}</p>
    <div className="mt-2"><ViewTabs view={filters.view} data={data} onView={view => update({ view })} /></div>
    <p className="mt-1.5 text-xs text-[var(--text-secondary)]" data-testid={filters.view === 'reviewed' ? 'spending-reviewed-caption' : 'spending-view-caption'}>{VIEW_CAPTION[filters.view]}</p>
    <div className="mt-3"><FilterBar filters={filters} data={data} update={update} reset={reset} showFilters={showFilters} setShowFilters={setShowFilters} showColors={showColors} setShowColors={setShowColors} colorsEnabled={colorsEnabled} /></div>
    {showColors && <ColorsPanel categories={data.options.buckets.filter(b => b.key !== 'other_needs_review').map(b => ({ key: b.key, label: b.label, hint: b.hint }))} />}
    {data.accounts === 'mapped' && data.meta.hiddenUnmapped > 0 && <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="spending-unmapped-note">{data.meta.hiddenUnmapped} transaction{data.meta.hiddenUnmapped === 1 ? '' : 's'} from accounts not mapped to Cash OS{data.environment === 'production' ? ' (or from Sandbox test accounts)' : ''} {data.meta.hiddenUnmapped === 1 ? 'is' : 'are'} not included. <button type="button" className="underline" onClick={() => update({ accounts: 'all' })}>Show all connected accounts</button></p>}
    {data.accounts === 'all' && <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="spending-all-note">Including accounts not mapped to Cash OS{data.environment === 'production' ? ' and Sandbox test accounts' : ''}. <button type="button" className="underline" onClick={() => update({ accounts: 'mapped' })}>Mapped accounts only</button></p>}
    {data.meta.olderThanPeriod > 0 && <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="spending-older-note">{data.meta.olderThanPeriod} older transaction{data.meta.olderThanPeriod === 1 ? ' is' : 's are'} outside the last {filters.days} days{filters.days < 90 ? '. Choose a longer period to see more' : ''}.</p>}
    {data.reviewCounts && <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="spending-review-counts">Reviewed {data.reviewCounts.reviewed} · Unreviewed {data.reviewCounts.unreviewed} · Excluded {data.reviewCounts.excluded}</p>}
    {eligible.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="spending-batch-bar">
      <button type="button" className={btn} disabled={busy} onClick={selectConfident} data-testid="spending-select-all">Select {Math.min(eligible.length, maxBatch)} confident matches</button>
      <p className="w-full text-xs text-[var(--text-secondary)]">Only confident everyday expense categories can be approved together. Payroll, transfers, owner draws, personal items, deposits and refunds always need your individual decision. Approving labels bank evidence only.</p>
    </div>}
    {batchNote && <p className="mt-1 text-xs" data-testid="spending-batch-note" role="status">{batchNote}</p>}
    {message && <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--fin-negative)' }}>{message}</p>}
    {showingSelected
      ? <SelectedReview items={items} off={off} overrides={overrides} categoryChoices={categoryChoices} categories={categories} busy={busy} onToggle={toggle} onCategory={setCategory} onUncheckCategory={uncheckCategory} />
      : rows.length === 0 ? <p className="mt-3 text-sm text-[var(--text-secondary)]" data-testid="spending-empty">No transactions match this view.</p>
      : <ul className="mt-2 space-y-1.5" data-testid="spending-list">{rows.map(r => <Row key={r.id} checkboxColumn={rows.some(approvable)} row={r} options={data.options} busy={busy} onDecide={decide} environment={data.environment} loadHistory={loadHistory} selectable={approvable(r)} selected={chosenIds.has(r.id)} onToggle={toggle} overrideLabel={overrides.has(r.id) ? labelFor(overrides.get(r.id) ?? null) : null} reviewedView={filters.view === 'reviewed'} />)}</ul>}
    {rows.length < data.total && <button type="button" className={`${btn} mt-2`} onClick={() => void loadMore()} disabled={busy} data-testid="spending-more">Show more ({data.total - rows.length} left)</button>}
    {pendingRestore.size > 0 && <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="spending-pending-restore">{pendingRestore.size} saved selection{pendingRestore.size === 1 ? ' is' : 's are'} on transactions not loaded yet. {pendingRestore.size === 1 ? 'It returns' : 'They return'} if {pendingRestore.size === 1 ? 'it loads' : 'they load'}; use Show more.</p>}
    {items.length > 0 && <SelectionBar prefix="spending" count={chosen.length} totalMinor={totalOutMinor} confirming={confirming}
      confirm={<ApprovalConfirm prefix="spending" label="Confirm batch approval" count={chosen.length} breakdown={breakdown} totalMinor={totalOutMinor} busy={busy} onConfirm={() => void approveSelected()} onCancel={() => setConfirming(false)} />}>
      <button type="button" className={btn} disabled={busy} aria-pressed={showingSelected} onClick={() => setReviewing(r => !r)} data-testid="spending-review-selected">{showingSelected ? 'Back to review queue' : 'Review selected'}</button>
      <button type="button" className={btn} disabled={busy} onClick={clearSelection} data-testid="spending-clear-selection">Clear selection</button>
      <button type="button" className={btnPrimary} disabled={busy || chosen.length === 0} onClick={() => setConfirming(true)} data-testid="spending-approve-selected">Approve selected…</button>
    </SelectionBar>}
    </>}
  </section>
}
