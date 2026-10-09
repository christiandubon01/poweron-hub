import { useEffect, useRef, useState } from 'react'
import { clearDraft, loadDraft, saveDraft } from './reviewDraft'
import SmartReview from './SmartReview'
import { BucketPicker } from './BucketPicker'
import { entryType, toneColor } from './entryType'
import { AccountColorDot, CategoryDot, CategoryPill, ColorsPanel, StripeBar, tintStyle, useDisplayColors } from '@/features/display-colors/DisplayColors'
import { categoryStripe } from '@/features/display-colors/stripes'
import { DEFAULT_FILTERS, useSpendingExplorer, type Analytics, type BatchResult, type HistoryEntry, type ExplorerRow, type ExplorerView, type Options } from './useSpendingExplorer'

import { btn, btnOn, btnPrimary, eyebrow, field, panel } from './ui'
const usd0 = (minor: number) => `$${Math.round(Math.abs(minor) / 100).toLocaleString('en-US')}`
const usd2 = (minor: number) => `$${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
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
const CONF: Record<string, string> = { high: 'High', possible: 'Possible', low: 'Low' }

const VIEWS: Array<{ key: ExplorerView; label: string }> = [
  { key: 'review_queue', label: 'To Review' }, { key: 'reviewed', label: 'Reviewed' }, { key: 'all', label: 'All' }, { key: 'known_bills', label: 'Known Bills' }, { key: 'unassigned', label: 'Unassigned Spending' },
  { key: 'repeated_spending', label: 'Repeated Spending' }, { key: 'needs_review', label: 'Needs Review' },
]
const REL_KINDS: Array<{ key: string; label: string }> = [
  { key: 'obligation', label: 'Known bill' }, { key: 'project', label: 'Project' }, { key: 'debt', label: 'Debt payment' }, { key: 'payroll', label: 'Payroll' },
  { key: 'transfer', label: 'Transfer' }, { key: 'overhead', label: 'General overhead (business)' }, { key: 'personal', label: 'Personal' },
]

/** Mirrors the SERVER's batch rule only so the checkboxes appear on the right rows. The server re-decides everything when the owner confirms. */
const isBatchApprovable = (r: ExplorerRow, batchBuckets: string[]) => r.direction === 'money_out' && !r.pending && r.review !== 'ignored' && r.bucket.state === 'suggested' && r.bucket.confidence === 'high' && !r.bucket.mixed
  && !!r.bucket.key && batchBuckets.includes(r.bucket.key) && r.relationship.state !== 'suggested'

/** Native checkboxes are flattened by the app-wide `appearance: none` reset (styles/responsive.css); restore the platform checkbox here. */
const CHECKBOX: React.CSSProperties = { accentColor: 'var(--fin-cash)', appearance: 'auto', WebkitAppearance: 'checkbox' as never }

/** The categories that fit the direction of the money (unchanged rule: money in gets money-in categories, transfers, personal and "unknown"). */
const bucketChoicesFor = (row: ExplorerRow, options: Options) => options.buckets.filter(b => (row.direction === 'money_in' ? (b.flow === 'in' || ['transfers', 'personal_owner', 'other_needs_review'].includes(b.key)) : b.flow !== 'in'))

const signed = (r: ExplorerRow) => `${r.direction === 'money_out' ? '−' : '+'}${usd2(r.amountMinor)}`

/**
 * The selection, made reviewable. EVERY transaction of the draft stays listed here; tapping a line only checks or unchecks it (a second tap restores it),
 * so an accidental tap costs nothing. Only CHECKED lines are approved. Each line has its own category control so a wrong suggestion can be corrected
 * before approval (the server validates every choice). Nothing here approves or saves anything.
 */
function SelectedReview({ items, off, overrides, categoryChoices, categories, busy, onToggle, onCategory, onUncheckCategory }: {
  items: ExplorerRow[]; off: Set<string>; overrides: Map<string, string>; categoryChoices: Array<{ key: string; label: string }>
  categories: Array<{ key: string; label: string; count: number }>; busy: boolean
  onToggle: (row: ExplorerRow) => void; onCategory: (row: ExplorerRow, key: string) => void; onUncheckCategory: (key: string) => void
}) {
  const labelOf = (key: string | null) => categoryChoices.find(c => c.key === key)?.label ?? 'Uncategorized'
  const { categoryColor } = useDisplayColors()
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
      return <li key={r.id} data-testid="spending-selected-item" data-checked={on ? 'true' : 'false'} className="relative rounded-lg border border-[var(--border-primary)] p-2 pl-4"
        style={on ? { background: 'color-mix(in srgb, var(--fin-cash) 10%, transparent)', boxShadow: '0 0 0 2px var(--fin-cash-border)' } : { opacity: 0.7 }}>
        <StripeBar stripe={categoryStripe({ key: chosenKey, state: chosenKey ? 'suggested' : 'none' }, categoryColor)} shape="card-sm" />
        <label className={`flex min-h-[56px] w-full items-start gap-2 ${busy ? 'opacity-60' : 'cursor-pointer'}`}>
          <span className="flex min-h-[44px] min-w-[44px] items-center justify-center"><input type="checkbox" className="h-6 w-6" style={CHECKBOX} checked={on} disabled={busy} onChange={() => onToggle(r)} aria-label={`${on ? 'Uncheck' : 'Check'} ${r.merchant}`} data-testid="spending-selected-toggle" /></span>
          <span className="flex min-w-0 flex-1 items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{r.merchant}</span>
              <span className="block text-xs text-[var(--text-secondary)]">{shortDate(r.date)} · {r.account.mappedTo ?? r.account.label}{r.account.mask ? ` ••••${r.account.mask}` : ''}</span>
              <span className="mt-1 block"><Chip tone={on ? 'ok' : 'muted'}>{on ? '✓ Selected' : 'Not selected'}</Chip></span>
            </span>
            <span className="shrink-0 text-sm font-semibold">{signed(r)}</span>
          </span>
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2 pl-[52px]">
          <label className="text-xs text-[var(--text-secondary)]" htmlFor={`cat-${r.id}`}>Category</label>
          <select id={`cat-${r.id}`} className={`${field} min-w-0 flex-1`} value={chosenKey ?? ''} disabled={busy} onChange={e => onCategory(r, e.target.value)} data-testid="spending-selected-category">
            {categoryChoices.map(c => <option key={c.key} value={c.key}>{c.label}{c.key === r.bucket.key ? ' (suggested)' : ''}</option>)}
          </select>
          {changed && <span className="w-full text-xs" data-testid="spending-category-changed" style={{ color: 'var(--fin-warning)' }}>Changed from the suggestion ({labelOf(r.bucket.key)}). Your category will be saved when you confirm.</span>}
        </div>
      </li>
    })}</ul>
  </div>
}

/** Glance state: where the unassigned money went, as tappable bars. Selecting a bucket drills into its transactions. */
function Snapshot({ a, selected, onPick }: { a: Analytics; selected: string; onPick: (bucket: string) => void }) {
  const top = a.unassigned.byBucket.filter(b => b.totalMinor > 0)
  const max = Math.max(1, ...top.map(b => b.totalMinor))
  const d = a.unassigned.deltaMinor
  return <div data-testid="spending-snapshot">
    <p className={eyebrow}>Unassigned spending · last {a.windowDays} days</p>
    <p className="mt-1 text-2xl font-semibold" data-testid="spending-total">{usd0(a.unassigned.totalMinor)} <span className="text-sm font-normal text-[var(--text-secondary)]">· {a.unassigned.count} transaction{a.unassigned.count === 1 ? '' : 's'}</span></p>
    {(a.unassigned.previousMinor > 0 || d !== 0) && <p className="text-xs text-[var(--text-secondary)]" data-testid="spending-delta">{d >= 0 ? '▲' : '▼'} {usd0(d)} vs the previous {a.windowDays} days</p>}
    {top.length === 0 ? <p className="mt-2 text-sm text-[var(--text-secondary)]">Nothing unassigned in this period.</p> : <ul className="mt-2 space-y-1">{top.slice(0, 6).map(b => <li key={b.key}>
      <button type="button" onClick={() => onPick(selected === b.key ? '' : b.key)} aria-pressed={selected === b.key} data-testid="spending-bucket" data-bucket={b.key}
        className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-white/5 ${selected === b.key ? 'ring-1 ring-[var(--fin-cash)]' : ''}`}>
        <span className="flex w-40 shrink-0 items-center gap-2 truncate text-sm"><CategoryDot categoryKey={b.key} /><span className="truncate">{b.label}</span></span>
        <span className="h-2 flex-1 rounded-full bg-white/[0.08]" aria-hidden="true"><span className="block h-2 rounded-full" style={{ width: `${Math.max(4, Math.round((b.totalMinor / max) * 100))}%`, background: 'var(--fin-cash)' }} /></span>
        <span className="w-16 shrink-0 text-right text-sm font-semibold">{usd0(b.totalMinor)}</span>
      </button>
    </li>)}</ul>}
    <p className="mt-2 text-xs text-[var(--text-secondary)]">
      {a.knownBills.count > 0 ? `${a.knownBills.count} known bill${a.knownBills.count === 1 ? '' : 's'} (${usd0(a.knownBills.totalMinor)}) matched, not counted above. ` : ''}
      {a.pending.count > 0 ? `${a.pending.count} pending (${usd0(a.pending.totalMinor)}) not counted until posted.` : ''}
    </p>
  </div>
}

function Signals({ a }: { a: Analytics }) {
  const [open, setOpen] = useState(false)
  const n = a.observations.length + a.suggestions.length
  if (!n) return null
  return <div className="mt-3">
    <button type="button" className="min-h-[44px] text-sm font-semibold underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen(o => !o)} data-testid="spending-signals-toggle">{open ? 'Hide' : 'Show'} money-bleed signals ({n})</button>
    {open && <div className="mt-1 space-y-3" data-testid="spending-signals">
      {a.unclassified.count > 0 && <p className="text-xs text-[var(--text-secondary)]" data-testid="spending-unclassified-note">{usd0(a.unclassified.totalMinor)} across {a.unclassified.count} transaction{a.unclassified.count === 1 ? '' : 's'} is not classified yet. It stays in review and is not counted as wasteful spending.</p>}
      {a.suggestions.length > 0 && <div><p className={eyebrow}>Possible issues <span className="font-normal normal-case">(a heuristic: check before acting)</span></p>
        <ul className="mt-1 space-y-1">{a.suggestions.map(s => <li key={s.id} className="rounded-lg border border-[var(--border-primary)] p-2 text-sm"><p className="font-semibold">{s.title}</p><p className="text-xs text-[var(--text-secondary)]">{s.detail}</p></li>)}</ul></div>}
      {a.observations.length > 0 && <div><p className={eyebrow}>Measured <span className="font-normal normal-case">(straight from your bank evidence)</span></p>
        <ul className="mt-1 space-y-1">{a.observations.map(o => <li key={o.id} className="text-sm">{o.text}</li>)}</ul></div>}
    </div>}
  </div>
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'muted' }) {
  const color = tone === 'ok' ? 'var(--fin-cash)' : tone === 'warn' ? 'var(--fin-warning)' : 'var(--text-secondary)'
  return <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-[var(--border-primary)]" style={{ color }}>{children}</span>
}

function History({ id, load }: { id: string; load: (id: string) => Promise<HistoryEntry[]> }) {
  const [items, setItems] = useState<HistoryEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const show = async () => { try { setItems(await load(id)); setFailed(false) } catch { setFailed(true) } }
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')
  return <div data-testid="spending-history">
    {items === null ? <button type="button" className={btn} onClick={() => void show()}>Show history</button>
      : items.length === 0 ? <p className="text-xs text-[var(--text-secondary)]">No decisions yet.</p>
      : <ul className="space-y-1 text-xs">{items.map((h, i) => <li key={i}>{h.label} · {h.status === 'confirmed' ? 'active' : h.status}{h.status === 'undone' && h.undoReason === 'changed_by_owner' ? ' (replaced)' : ''} · {h.source === 'owner' ? 'by you' : 'from a suggestion'} · {when(h.decidedAt ?? h.createdAt)}{h.undoneAt ? ` → undone ${when(h.undoneAt)}` : ''}</li>)}</ul>}
    {failed && <p className="text-xs" style={{ color: 'var(--fin-negative)' }}>History could not be loaded.</p>}
  </div>
}

function Detail({ row, options, busy, onDecide, loadHistory }: { row: ExplorerRow; options: Options; busy: boolean; onDecide: ReturnType<typeof useSpendingExplorer>['decide']; loadHistory: (id: string) => Promise<HistoryEntry[]> }) {
  const [picking, setPicking] = useState(false)
  const [kind, setKind] = useState(row.relationship.state === 'confirmed' && row.relationship.kind !== 'unknown' ? row.relationship.kind : '')
  const [target, setTarget] = useState('')
  const needsTarget = kind === 'obligation' || kind === 'project' || kind === 'debt'
  const targets = kind === 'obligation' ? [...options.obligations.map(o => ({ value: `obligation:${o.id}`, label: `${o.label} · ${usd2(o.amountMinor)}` })), ...options.commitments.map(c => ({ value: `commitment:${c.id}`, label: `${c.label} · ${usd2(c.amountMinor)} · ${shortDate(c.expectedDate)}` }))]
    : kind === 'project' ? options.projects.map(p => ({ value: `project:${p.id}`, label: p.name })) : kind === 'debt' ? options.debts.map(d => ({ value: `debt:${d.id}`, label: d.label })) : []
  const sendRel = () => {
    if (!kind || (needsTarget && !target)) return
    const [type, ...rest] = target.split(':'); const id = rest.join(':')
    void onDecide({ action: 'set_relationship', transactionId: row.id, kind, ...(needsTarget ? { targetType: kind === 'obligation' ? type : undefined, targetId: id } : {}) })
  }
  return <div className={`mt-2 space-y-4 ${panel}`} data-testid="spending-detail">
    <p className="text-xs text-[var(--text-secondary)]">Bank description: {row.name} · {row.account.label}{row.account.mask ? ` ••••${row.account.mask}` : ''}</p>
    {row.pending && <p className="text-xs" style={{ color: 'var(--fin-warning)' }}>Pending: it can be categorized or ignored, but not given a relationship until it posts.</p>}

    <section aria-label="What was this money for?">
      <p className={eyebrow}>What was it for?</p>
      {row.bucket.state === 'suggested' && <div className="my-1 text-sm"><p>Suggested: <strong>{row.bucket.label}</strong> <Chip>{CONF[row.bucket.confidence ?? 'low']} confidence</Chip></p>
        <ul className="list-disc pl-5 text-xs text-[var(--text-secondary)]">{row.bucket.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <div className="mt-1 flex flex-wrap gap-2"><button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'accept_suggestion', transactionId: row.id, dimension: 'bucket' })}>Confirm {row.bucket.label}</button>
          <button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'reject_suggestion', transactionId: row.id, dimension: 'bucket' })}>Not this</button></div></div>}
      {/* BANK-6E: the category is chosen in a modal (BucketPicker); Apply sends the same set_bucket decision as before. */}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm" data-testid="detail-category">{row.bucket.state === 'confirmed' && row.bucket.label
          ? <CategoryPill categoryKey={row.bucket.key} label={row.bucket.label} state="confirmed" />
          : <span className="text-[var(--text-secondary)]">No category confirmed yet</span>}</span>
        <button type="button" className={btn} disabled={busy} onClick={() => setPicking(true)} data-testid="detail-change-category">{row.bucket.state === 'confirmed' ? 'Change category…' : 'Choose category…'}</button>
        {row.bucket.state === 'confirmed' && <button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'undo', transactionId: row.id, dimension: 'bucket' })}>Undo</button>}
      </div>
      <BucketPicker open={picking} busy={busy} options={bucketChoicesFor(row, options)}
        currentKey={row.bucket.state === 'confirmed' ? row.bucket.key : null} suggestedKey={row.bucket.state === 'suggested' ? row.bucket.key : null}
        context={`${row.merchant} · ${row.direction === 'money_out' ? '−' : '+'}${usd2(row.amountMinor)} · ${shortDate(row.date)}`}
        onClose={() => setPicking(false)} onApply={key => { setPicking(false); void onDecide({ action: 'set_bucket', transactionId: row.id, bucket: key }) }} />
    </section>

    <section aria-label="What does it belong to?">
      <p className={eyebrow}>What does it belong to?</p>
      {row.relationship.state === 'suggested' && <div className="my-1 text-sm"><p>Suggested: <strong>{row.relationship.label}{row.relationship.target?.label ? ` · ${row.relationship.target.label}` : ''}</strong> <Chip>{CONF[row.relationship.confidence ?? 'low']} confidence</Chip></p>
        <ul className="list-disc pl-5 text-xs text-[var(--text-secondary)]">{row.relationship.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        {!row.pending && <div className="mt-1 flex flex-wrap gap-2"><button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'accept_suggestion', transactionId: row.id, dimension: 'relationship' })}>Confirm</button>
          <button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'reject_suggestion', transactionId: row.id, dimension: 'relationship' })}>Not this</button></div>}</div>}
      {!row.pending && <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`k-${row.id}`}>Relationship</label>
        <select id={`k-${row.id}`} className={`${field} min-w-0 flex-1`} value={kind} onChange={e => { setKind(e.target.value); setTarget('') }}><option value="">Unknown / choose…</option>{REL_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
        {needsTarget && <><label className="sr-only" htmlFor={`t-${row.id}`}>Which one</label><select id={`t-${row.id}`} className={`${field} min-w-0 flex-1`} value={target} onChange={e => setTarget(e.target.value)}><option value="">Which one…</option>{targets.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></>}
        <button type="button" className={btn} disabled={busy || !kind || (needsTarget && !target)} onClick={sendRel}>Save</button>
        {row.relationship.state === 'confirmed' && <button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'undo', transactionId: row.id, dimension: 'relationship' })}>Undo</button>}
      </div>}
      <p className="mt-1 text-xs text-[var(--text-secondary)]">Business or personal: {row.scope.value}{row.scope.source === 'account' ? ' (from the account)' : row.scope.source === 'owner' ? ' (you set this)' : ''}. Use “Personal” or “General overhead” above to correct it.</p>
    </section>

    <div className="flex flex-wrap gap-2">
      {row.review === 'ignored'
        ? <button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'unignore', transactionId: row.id })}>Stop ignoring</button>
        : <button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'ignore', transactionId: row.id })}>Ignore this transaction</button>}
    </div>
    <section aria-label="History"><p className={eyebrow}>Decision history</p><History id={row.id} load={loadHistory} /></section>
    <p className="text-xs text-[var(--text-secondary)]">These choices label bank evidence only. They do not change your balances, ledger, bills, projects or reports.</p>
  </div>
}

function Row({ row, options, busy, onDecide, environment, loadHistory, selectable, selected, onToggle, overrideLabel, reviewedView, checkboxColumn }: { row: ExplorerRow; overrideLabel?: string | null; reviewedView?: boolean; /** keep merchants aligned when some rows in the list have a checkbox */ checkboxColumn?: boolean; environment?: string; loadHistory: (id: string) => Promise<HistoryEntry[]>; selectable: boolean; selected: boolean; onToggle: (row: ExplorerRow) => void; options: Options; busy: boolean; onDecide: ReturnType<typeof useSpendingExplorer>['decide'] }) {
  const [open, setOpen] = useState(false)
  const out = row.direction === 'money_out'
  const { categoryColor, tint } = useDisplayColors()
  // BANK-6D: the category owns the stripe (solid only when CONFIRMED); a selection is shown by a ring + the "✓ Selected" chip, never by the stripe.
  const stripe = categoryStripe({ key: row.bucket.key, state: row.bucket.state, ignored: row.review === 'ignored' }, categoryColor, tint.rows)
  const tinted = tintStyle(stripe)
  const status = row.review === 'confirmed' ? 'Reviewed' : row.review === 'ignored' ? 'Ignored' : row.review === 'suggested' ? 'Suggested' : 'Needs review'
  const type = entryType(row) // display only: from the interpretation, never from the amount sign alone
  // BANK-6E entry card: rail (category), merchant + amount on one line, date · account (with its color dot), then explicit text pills.
  return <li data-testid="spending-row" data-review={row.review} data-pending={row.pending ? 'true' : 'false'} data-selected={selected ? 'true' : 'false'} data-tint={tinted ? 'on' : 'off'}
    className={`relative rounded-xl border border-[var(--border-primary)] py-2 pl-5 pr-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.18)] motion-safe:transition-colors ${tinted || selected ? '' : 'bg-white/[0.02] hover:bg-white/[0.045]'} ${row.review === 'ignored' ? 'opacity-70' : ''}`}
    style={selected ? { background: tinted?.background ?? 'color-mix(in srgb, var(--fin-cash) 10%, transparent)', boxShadow: '0 0 0 2px var(--fin-cash-border)' } : tinted}>
    <StripeBar stripe={stripe} shape="card" />
    <div className="flex items-start gap-1.5">
    {selectable ? <label className="-ml-1 flex min-h-[44px] min-w-[40px] items-center justify-center"><input type="checkbox" className="h-5 w-5 cursor-pointer" style={CHECKBOX} checked={selected} onChange={() => onToggle(row)} aria-label={`Select ${row.merchant} for batch approval`} data-testid="spending-select" /></label>
      : checkboxColumn && <span aria-hidden="true" className="-ml-1 min-w-[40px]" />}
    <button type="button" className="grid min-h-[44px] w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span className="min-w-0 truncate text-[15px] font-semibold leading-6 tracking-[-0.01em]">{row.merchant}</span>
      <span className={`text-right text-[15px] font-semibold leading-6 tabular-nums ${row.pending ? 'opacity-70' : ''}`} style={{ color: toneColor(type.tone) }} data-testid="entry-amount">{out ? '−' : '+'}{usd2(row.amountMinor)}</span>
      <span className="min-w-0 truncate text-xs text-[var(--text-secondary)]">{shortDate(row.date)} · <AccountColorDot accountId={row.account.financialAccountId} />{row.account.mappedTo ?? row.account.label}</span>
      <span className="flex items-center justify-end gap-1 text-right text-xs font-semibold" style={{ color: toneColor(type.tone) ?? 'var(--text-secondary)' }} data-testid="entry-type" data-kind={type.kind}>
        <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[11px] leading-none ring-1 ring-current">{type.glyph}</span>{type.label}</span>
      <span className="col-span-2 mt-1.5 flex flex-wrap items-center gap-1">
          {selected && <Chip tone="ok">✓ Selected</Chip>}
          {overrideLabel && <Chip tone="ok">Your category: {overrideLabel}</Chip>}
          {row.pending && <Chip tone="warn">Pending</Chip>}
          {row.account.environment === 'sandbox' && environment === 'production' && <Chip>Sandbox</Chip>}
          {row.review === 'ignored' ? <Chip>Ignored</Chip> : <>
            {row.bucket.label && <CategoryPill categoryKey={row.bucket.key} label={row.bucket.label} state={row.bucket.state} />}
            <Chip tone={row.relationship.state === 'confirmed' ? 'ok' : 'muted'}>{row.relationship.state === 'none' ? (out ? 'Unassigned' : row.relationship.label) : `${row.relationship.state === 'confirmed' ? '✓ ' : ''}${row.relationship.label}${row.relationship.target?.label ? ` · ${row.relationship.target.label}` : ''}${row.relationship.state === 'suggested' ? ' · suggested' : ''}`}</Chip>
            {reviewedView && row.relationship.state === 'confirmed' && row.bucket.state !== 'confirmed' && <span data-testid="spending-category-needs-review"><Chip tone="warn">Relationship reviewed · Category needs review</Chip></span>}
            {reviewedView && <Chip tone={row.scope.value === 'unclear' ? 'muted' : 'ok'}>{row.scope.value === 'business' ? 'Business' : row.scope.value === 'personal' ? 'Personal' : 'Business or personal: unclear'}</Chip>}
            {row.pattern && out && (row.pattern.kind === 'obligation_like' ? <Chip tone="warn">Looks like a recurring bill</Chip> : <Chip>Repeats {row.pattern.cadence}</Chip>)}
          </>}
          <span className="ml-auto pl-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]" data-testid="entry-status">{status}</span>
      </span>
    </button>
    </div>
    {open && <Detail row={row} options={options} busy={busy} onDecide={onDecide} loadHistory={loadHistory} />}
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
  const categoryChoices = (data.options.buckets ?? []).filter(b => batchBuckets.includes(b.key)).map(b => ({ key: b.key, label: b.label }))
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
  const breakdown = [...chosen.reduce((m, r) => { const k = labelFor(effectiveKey(r)); const e = m.get(k) ?? { label: k, count: 0, totalMinor: 0 }; e.count += 1; e.totalMinor += Math.abs(r.amountMinor); return m.set(k, e) }, new Map<string, { label: string; count: number; totalMinor: number }>()).values()].sort((x, y) => y.totalMinor - x.totalMinor || x.label.localeCompare(y.label))
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
  const active = (['bucket', 'account', 'scope', 'review', 'confidence', 'project', 'search', 'min', 'max'] as const).filter(k => filters[k]).length + (filters.days !== DEFAULT_FILTERS.days ? 1 : 0) + (filters.accounts !== DEFAULT_FILTERS.accounts ? 1 : 0)
  return <section data-testid="spending-explorer" aria-label="Spending explorer" className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 sm:p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Spending explorer · bank evidence</h3>
      <span className="text-xs text-[var(--text-secondary)]">Suggestions only. Nothing here changes your balances, ledger or reports.</span>
    </div>
    <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="spending-scope-caption">Summary: last {a.windowDays} days · {data.accounts === 'all' ? 'all connected accounts' : 'mapped accounts'}</p>
    <div className="mt-3"><Snapshot a={a} selected={filters.bucket} onPick={bucket => update({ bucket, view: bucket ? 'unassigned' : filters.view })} /><Signals a={a} /></div>

    <div className="mt-4 inline-flex gap-1 rounded-2xl bg-white/[0.02] p-1 ring-1 ring-[var(--border-primary)]" role="group" aria-label="Review mode">
      <button type="button" aria-pressed={mode === 'explorer'} className={`${btn} ${mode === 'explorer' ? btnOn : ''}`} onClick={() => setMode('explorer')} data-testid="spending-mode-explorer">Explorer</button>
      <button type="button" aria-pressed={mode === 'smart'} className={`${btn} ${mode === 'smart' ? btnOn : ''}`} onClick={() => setMode('smart')} data-testid="spending-mode-smart">Smart Review</button>
    </div>
    {mode === 'smart' ? <SmartReview onChanged={() => void refresh()} /> : <>
    <p className="mt-4 text-xs text-[var(--text-secondary)]" data-testid="spending-list-caption">Transactions: last {filters.days} days · {data.accounts === 'all' ? 'all connected accounts' : 'mapped accounts'}</p>
    <div className="mt-1 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Spending views">
      {VIEWS.map(v => <button key={v.key} type="button" role="tab" aria-selected={filters.view === v.key} data-testid={`spending-view-${v.key}`} onClick={() => update({ view: v.key })}
        className={`${btn} shrink-0 ${filters.view === v.key ? btnOn : ''}`}>{v.label} <span className="ml-1 rounded-full bg-white/[0.06] px-1.5 text-xs tabular-nums text-[var(--text-secondary)]">{data.viewCounts[v.key] ?? (v.key === 'reviewed' ? data.reviewCounts?.reviewed : undefined)}</span></button>)}
    </div>
    {filters.view === 'reviewed' && <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="spending-reviewed-caption">Transactions you confirmed (marked ✓). Suggestions are not counted as reviewed. Open one to see its decision history or to undo it.</p>}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" className={btn} aria-expanded={showFilters} onClick={() => setShowFilters(s => !s)} data-testid="spending-filters-toggle">Filters{active ? ` (${active})` : ''}</button>
      {colorsEnabled && <button type="button" className={btn} aria-expanded={showColors} onClick={() => setShowColors(s => !s)} data-testid="spending-colors-toggle">Colors</button>}
      {active > 0 && <button type="button" className={btn} onClick={reset}>Clear</button>}
    </div>
    {showColors && <ColorsPanel categories={data.options.buckets.filter(b => b.key !== 'other_needs_review').map(b => ({ key: b.key, label: b.label, hint: b.hint }))} />}
    {data.accounts === 'mapped' && data.meta.hiddenUnmapped > 0 && <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="spending-unmapped-note">{data.meta.hiddenUnmapped} transaction{data.meta.hiddenUnmapped === 1 ? '' : 's'} from accounts not mapped to Cash OS{data.environment === 'production' ? ' (or from Sandbox test accounts)' : ''} {data.meta.hiddenUnmapped === 1 ? 'is' : 'are'} not included. <button type="button" className="underline" onClick={() => update({ accounts: 'all' })}>Show all connected accounts</button></p>}
    {data.accounts === 'all' && <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="spending-all-note">Including accounts not mapped to Cash OS{data.environment === 'production' ? ' and Sandbox test accounts' : ''}. <button type="button" className="underline" onClick={() => update({ accounts: 'mapped' })}>Mapped accounts only</button></p>}
    {data.meta.olderThanPeriod > 0 && <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="spending-older-note">{data.meta.olderThanPeriod} older transaction{data.meta.olderThanPeriod === 1 ? ' is' : 's are'} outside the last {filters.days} days{filters.days < 90 ? '. Choose a longer period to see more' : ''}.</p>}
    {showFilters && <div className={`mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 ${panel}`} data-testid="spending-filters">
      <label className="text-xs">Period<select className={`${field} mt-1 w-full`} value={filters.days} onChange={e => update({ days: Number(e.target.value) as 30 | 60 | 90 })}><option value={30}>Last 30 days</option><option value={60}>Last 60 days</option><option value={90}>Last 90 days</option></select></label>
      <label className="text-xs">Account<select className={`${field} mt-1 w-full`} value={filters.account} onChange={e => update({ account: e.target.value })}><option value="">All accounts</option>{data.options.accounts.map(x => <option key={x.ref} value={x.ref}>{x.label}{x.mask ? ` ••••${x.mask}` : ''}</option>)}</select></label>
      <label className="text-xs">Bucket<select className={`${field} mt-1 w-full`} value={filters.bucket} onChange={e => update({ bucket: e.target.value })}><option value="">All buckets</option>{data.options.buckets.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select></label>
      <label className="text-xs">Business / personal<select className={`${field} mt-1 w-full`} value={filters.scope} onChange={e => update({ scope: e.target.value })}><option value="">Both</option><option value="business">Business</option><option value="personal">Personal</option><option value="unclear">Unclear</option></select></label>
      <label className="text-xs">Review<select className={`${field} mt-1 w-full`} value={filters.review} onChange={e => update({ review: e.target.value })}><option value="">Any</option><option value="needs_review">Needs review</option><option value="suggested">Suggested</option><option value="confirmed">Confirmed</option><option value="ignored">Ignored</option></select></label>
      <label className="text-xs">Confidence<select className={`${field} mt-1 w-full`} value={filters.confidence} onChange={e => update({ confidence: e.target.value })}><option value="">Any</option><option value="high">High</option><option value="possible">Possible</option><option value="low">Low</option></select></label>
      <label className="text-xs">Project<select className={`${field} mt-1 w-full`} value={filters.project} onChange={e => update({ project: e.target.value })}><option value="">Any</option>{data.options.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="text-xs">Merchant search<input className={`${field} mt-1 w-full`} value={filters.search} onChange={e => update({ search: e.target.value })} placeholder="e.g. Home Depot" /></label>
      <label className="text-xs">Min amount ($)<input inputMode="decimal" className={`${field} mt-1 w-full`} value={filters.min} onChange={e => update({ min: e.target.value })} /></label>
      <label className="text-xs">Max amount ($)<input inputMode="decimal" className={`${field} mt-1 w-full`} value={filters.max} onChange={e => update({ max: e.target.value })} /></label>
    </div>}

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
    {items.length > 0 && <div className="sticky bottom-2 z-10 mt-3 space-y-2 rounded-xl border-2 bg-[var(--bg-card)] p-3 shadow-lg" style={{ borderColor: 'var(--fin-cash)' }} data-testid="spending-selection-bar" role="region" aria-label="Selected transactions">
      <p className="text-sm font-semibold" aria-live="polite"><span data-testid="spending-selected-count">{chosen.length} selected</span> <span className="font-normal text-[var(--text-secondary)]">· {usd2(totalOutMinor)} going out</span></p>
      {confirming
        ? <section role="alertdialog" aria-label="Confirm batch approval" data-testid="spending-confirm" className="space-y-2 rounded-lg border border-[var(--border-primary)] p-3">
            <p className="text-sm font-semibold" data-testid="spending-confirm-title">Approve {chosen.length} transaction{chosen.length === 1 ? '' : 's'}?</p>
            <ul className="text-sm" data-testid="spending-confirm-breakdown">{breakdown.map(b => <li key={b.label} className="flex justify-between gap-3"><span>{b.label} · {b.count}</span><span>{usd2(b.totalMinor)}</span></li>)}</ul>
            <p className="flex justify-between gap-3 border-t border-[var(--border-primary)] pt-2 text-sm font-semibold" data-testid="spending-confirm-total"><span>Total going out</span><span>{usd2(totalOutMinor)}</span></p>
            <p className="text-xs text-[var(--text-secondary)]">This labels these bank records with the categories shown. It does not change your balances, ledger, bills, payroll or reports, and each one can be undone.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void approveSelected()} data-testid="spending-confirm-approve">Confirm approval</button>
              <button type="button" className={btn} disabled={busy} onClick={() => setConfirming(false)} data-testid="spending-confirm-cancel">Cancel</button>
            </div>
          </section>
        : <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={busy} aria-pressed={showingSelected} onClick={() => setReviewing(r => !r)} data-testid="spending-review-selected">{showingSelected ? 'Back to review queue' : 'Review selected'}</button>
            <button type="button" className={btn} disabled={busy} onClick={clearSelection} data-testid="spending-clear-selection">Clear selection</button>
            <button type="button" className={btnPrimary} disabled={busy || chosen.length === 0} onClick={() => setConfirming(true)} data-testid="spending-approve-selected">Approve selected…</button>
          </div>}
    </div>}
    </>}
  </section>
}
