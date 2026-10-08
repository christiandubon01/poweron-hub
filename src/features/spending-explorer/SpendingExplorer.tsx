import { useState } from 'react'
import { DEFAULT_FILTERS, useSpendingExplorer, type Analytics, type BatchResult, type HistoryEntry, type ExplorerRow, type ExplorerView, type Options } from './useSpendingExplorer'

const btn = 'min-h-[44px] rounded-lg px-3 text-sm font-semibold ring-1 ring-[var(--border-primary)] hover:bg-white/5 disabled:opacity-50'
const field = 'min-h-[44px] rounded-lg bg-transparent px-2 text-sm ring-1 ring-[var(--border-primary)]'
const usd0 = (minor: number) => `$${Math.round(Math.abs(minor) / 100).toLocaleString('en-US')}`
const usd2 = (minor: number) => `$${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const SKIP_TEXT: Record<string, string> = {
  pending: 'still pending', money_in: 'money coming in', no_suggestion: 'nothing recognised', not_high_confidence: 'not a confident match', needs_individual_review: 'needs your individual decision',
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
  { key: 'review_queue', label: 'To Review' }, { key: 'all', label: 'All' }, { key: 'known_bills', label: 'Known Bills' }, { key: 'unassigned', label: 'Unassigned Spending' },
  { key: 'repeated_spending', label: 'Repeated Spending' }, { key: 'needs_review', label: 'Needs Review' },
]
const REL_KINDS: Array<{ key: string; label: string }> = [
  { key: 'obligation', label: 'Known bill' }, { key: 'project', label: 'Project' }, { key: 'debt', label: 'Debt payment' }, { key: 'payroll', label: 'Payroll' },
  { key: 'transfer', label: 'Transfer' }, { key: 'overhead', label: 'General overhead (business)' }, { key: 'personal', label: 'Personal' },
]

/** Glance state: where the unassigned money went, as tappable bars. Selecting a bucket drills into its transactions. */
function Snapshot({ a, selected, onPick }: { a: Analytics; selected: string; onPick: (bucket: string) => void }) {
  const top = a.unassigned.byBucket.filter(b => b.totalMinor > 0)
  const max = Math.max(1, ...top.map(b => b.totalMinor))
  const d = a.unassigned.deltaMinor
  return <div data-testid="spending-snapshot">
    <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Unassigned spending · last {a.windowDays} days</p>
    <p className="mt-1 text-2xl font-semibold" data-testid="spending-total">{usd0(a.unassigned.totalMinor)} <span className="text-sm font-normal text-[var(--text-secondary)]">· {a.unassigned.count} transaction{a.unassigned.count === 1 ? '' : 's'}</span></p>
    {(a.unassigned.previousMinor > 0 || d !== 0) && <p className="text-xs text-[var(--text-secondary)]" data-testid="spending-delta">{d >= 0 ? '▲' : '▼'} {usd0(d)} vs the previous {a.windowDays} days</p>}
    {top.length === 0 ? <p className="mt-2 text-sm text-[var(--text-secondary)]">Nothing unassigned in this period.</p> : <ul className="mt-2 space-y-1">{top.slice(0, 6).map(b => <li key={b.key}>
      <button type="button" onClick={() => onPick(selected === b.key ? '' : b.key)} aria-pressed={selected === b.key} data-testid="spending-bucket" data-bucket={b.key}
        className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-white/5 ${selected === b.key ? 'ring-1 ring-[var(--fin-cash)]' : ''}`}>
        <span className="w-40 shrink-0 truncate text-sm">{b.label}</span>
        <span className="h-2 flex-1 rounded bg-white/10" aria-hidden="true"><span className="block h-2 rounded" style={{ width: `${Math.max(4, Math.round((b.totalMinor / max) * 100))}%`, background: 'var(--fin-cash)' }} /></span>
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
      {a.suggestions.length > 0 && <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Possible issues <span className="font-normal normal-case">(a heuristic: check before acting)</span></p>
        <ul className="mt-1 space-y-1">{a.suggestions.map(s => <li key={s.id} className="rounded-lg border border-[var(--border-primary)] p-2 text-sm"><p className="font-semibold">{s.title}</p><p className="text-xs text-[var(--text-secondary)]">{s.detail}</p></li>)}</ul></div>}
      {a.observations.length > 0 && <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Measured <span className="font-normal normal-case">(straight from your bank evidence)</span></p>
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
  const [bucket, setBucket] = useState(row.bucket.state === 'confirmed' ? row.bucket.key ?? '' : '')
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
  return <div className="mt-2 space-y-3 rounded-lg border border-[var(--border-primary)] p-3" data-testid="spending-detail">
    <p className="text-xs text-[var(--text-secondary)]">Bank description: {row.name} · {row.account.label}{row.account.mask ? ` ••••${row.account.mask}` : ''}</p>
    {row.pending && <p className="text-xs" style={{ color: 'var(--fin-warning)' }}>Pending: it can be categorized or ignored, but not given a relationship until it posts.</p>}

    <section aria-label="What was this money for?">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">What was it for?</p>
      {row.bucket.state === 'suggested' && <div className="my-1 text-sm"><p>Suggested: <strong>{row.bucket.label}</strong> <Chip>{CONF[row.bucket.confidence ?? 'low']} confidence</Chip></p>
        <ul className="list-disc pl-5 text-xs text-[var(--text-secondary)]">{row.bucket.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <div className="mt-1 flex flex-wrap gap-2"><button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'accept_suggestion', transactionId: row.id, dimension: 'bucket' })}>Confirm {row.bucket.label}</button>
          <button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'reject_suggestion', transactionId: row.id, dimension: 'bucket' })}>Not this</button></div></div>}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`b-${row.id}`}>Spending bucket</label>
        <select id={`b-${row.id}`} className={`${field} min-w-0 flex-1`} value={bucket} onChange={e => setBucket(e.target.value)}><option value="">Choose a bucket…</option>{options.buckets.filter(b => (row.direction === 'money_in' ? (b.flow === 'in' || ['transfers', 'personal_owner', 'other_needs_review'].includes(b.key)) : b.flow !== 'in')).map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select>
        <button type="button" className={btn} disabled={busy || !bucket || bucket === row.bucket.key && row.bucket.state === 'confirmed'} onClick={() => void onDecide({ action: 'set_bucket', transactionId: row.id, bucket })}>Save bucket</button>
        {row.bucket.state === 'confirmed' && <button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'undo', transactionId: row.id, dimension: 'bucket' })}>Undo</button>}
      </div>
    </section>

    <section aria-label="What does it belong to?">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">What does it belong to?</p>
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
    <section aria-label="History"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Decision history</p><History id={row.id} load={loadHistory} /></section>
    <p className="text-xs text-[var(--text-secondary)]">These choices label bank evidence only. They do not change your balances, ledger, bills, projects or reports.</p>
  </div>
}

function Row({ row, options, busy, onDecide, environment, loadHistory, selectable, selected, onToggle }: { row: ExplorerRow; environment?: string; loadHistory: (id: string) => Promise<HistoryEntry[]>; selectable: boolean; selected: boolean; onToggle: (id: string) => void; options: Options; busy: boolean; onDecide: ReturnType<typeof useSpendingExplorer>['decide'] }) {
  const [open, setOpen] = useState(false)
  const out = row.direction === 'money_out'
  return <li data-testid="spending-row" data-review={row.review} data-pending={row.pending ? 'true' : 'false'} className="py-2">
    <div className="flex items-start gap-2">
    {selectable && <label className="flex min-h-[44px] min-w-[44px] items-center justify-center"><input type="checkbox" checked={selected} onChange={() => onToggle(row.id)} aria-label={`Select ${row.merchant} for batch approval`} data-testid="spending-select" /></label>}
    <button type="button" className="flex min-h-[44px] w-full items-start justify-between gap-3 text-left" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{row.merchant}</span>
        <span className="block text-xs text-[var(--text-secondary)]">{shortDate(row.date)} · {row.account.mappedTo ?? row.account.label}</span>
        <span className="mt-1 flex flex-wrap gap-1">
          {row.pending && <Chip tone="warn">Pending</Chip>}
          {row.account.environment === 'sandbox' && environment === 'production' && <Chip>Sandbox</Chip>}
          {row.review === 'ignored' ? <Chip>Ignored</Chip> : <>
            {row.bucket.label && <Chip tone={row.bucket.state === 'confirmed' ? 'ok' : 'muted'}>{row.bucket.state === 'confirmed' ? '✓ ' : ''}{row.bucket.label}{row.bucket.state === 'suggested' ? ` · suggested` : ''}</Chip>}
            <Chip tone={row.relationship.state === 'confirmed' ? 'ok' : 'muted'}>{row.relationship.state === 'none' ? (out ? 'Unassigned' : row.relationship.label) : `${row.relationship.state === 'confirmed' ? '✓ ' : ''}${row.relationship.label}${row.relationship.target?.label ? ` · ${row.relationship.target.label}` : ''}${row.relationship.state === 'suggested' ? ' · suggested' : ''}`}</Chip>
            {row.pattern && out && (row.pattern.kind === 'obligation_like' ? <Chip tone="warn">Looks like a recurring bill</Chip> : <Chip>Repeats {row.pattern.cadence}</Chip>)}
          </>}
        </span>
      </span>
      <span className={`shrink-0 text-sm font-semibold ${row.pending ? 'opacity-70' : ''}`} style={{ color: out ? undefined : 'var(--fin-cash)' }}>{out ? '−' : '+'}{usd2(row.amountMinor)}</span>
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
  const { load, data, rows, filters, update, reset, busy, message, decide, decideBatch, loadHistory, loadMore } = useSpendingExplorer()
  const [showFilters, setShowFilters] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchNote, setBatchNote] = useState<string | null>(null)
  if (load !== 'ready' || !data || data.viewCounts.all === 0) return null
  const a = data.analytics
  // Which rows may be approved together is decided by the SERVER; this only mirrors its rule so the checkboxes appear on the right rows.
  const batchBuckets = data.options.batchBuckets ?? []
  const approvable = (r: ExplorerRow) => r.direction === 'money_out' && !r.pending && r.review !== 'ignored' && r.bucket.state === 'suggested' && r.bucket.confidence === 'high'
    && !!r.bucket.key && batchBuckets.includes(r.bucket.key) && r.relationship.state !== 'suggested'
  const eligible = rows.filter(approvable)
  const chosen = [...selected].filter(id => eligible.some(r => r.id === id))
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const approveSelected = async () => {
    const ids = chosen.slice(0, data.options.maxBatch ?? 50)
    if (!ids.length) return
    const out = await decideBatch(ids)
    setSelected(new Set())
    setBatchNote(out ? batchSummary(out) : null)
  }
  const active = (['bucket', 'account', 'scope', 'review', 'confidence', 'project', 'search', 'min', 'max'] as const).filter(k => filters[k]).length + (filters.days !== DEFAULT_FILTERS.days ? 1 : 0) + (filters.accounts !== DEFAULT_FILTERS.accounts ? 1 : 0)
  return <section data-testid="spending-explorer" aria-label="Spending explorer" className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 sm:p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Spending explorer · bank evidence</h3>
      <span className="text-xs text-[var(--text-secondary)]">Suggestions only. Nothing here changes your balances, ledger or reports.</span>
    </div>
    <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="spending-scope-caption">Summary: last {a.windowDays} days · {data.accounts === 'all' ? 'all connected accounts' : 'mapped accounts'}</p>
    <div className="mt-3"><Snapshot a={a} selected={filters.bucket} onPick={bucket => update({ bucket, view: bucket ? 'unassigned' : filters.view })} /><Signals a={a} /></div>

    <p className="mt-4 text-xs text-[var(--text-secondary)]" data-testid="spending-list-caption">Transactions: last {filters.days} days · {data.accounts === 'all' ? 'all connected accounts' : 'mapped accounts'}</p>
    <div className="mt-1 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Spending views">
      {VIEWS.map(v => <button key={v.key} type="button" role="tab" aria-selected={filters.view === v.key} data-testid={`spending-view-${v.key}`} onClick={() => update({ view: v.key })}
        className={`${btn} shrink-0 ${filters.view === v.key ? 'bg-white/10' : ''}`}>{v.label} <span className="text-[var(--text-secondary)]">{data.viewCounts[v.key]}</span></button>)}
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" className={btn} aria-expanded={showFilters} onClick={() => setShowFilters(s => !s)} data-testid="spending-filters-toggle">Filters{active ? ` (${active})` : ''}</button>
      {active > 0 && <button type="button" className={btn} onClick={reset}>Clear</button>}
    </div>
    {data.accounts === 'mapped' && data.meta.hiddenUnmapped > 0 && <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="spending-unmapped-note">{data.meta.hiddenUnmapped} transaction{data.meta.hiddenUnmapped === 1 ? '' : 's'} from accounts not mapped to Cash OS{data.environment === 'production' ? ' (or from Sandbox test accounts)' : ''} {data.meta.hiddenUnmapped === 1 ? 'is' : 'are'} not included. <button type="button" className="underline" onClick={() => update({ accounts: 'all' })}>Show all connected accounts</button></p>}
    {data.accounts === 'all' && <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="spending-all-note">Including accounts not mapped to Cash OS{data.environment === 'production' ? ' and Sandbox test accounts' : ''}. <button type="button" className="underline" onClick={() => update({ accounts: 'mapped' })}>Mapped accounts only</button></p>}
    {data.meta.olderThanPeriod > 0 && <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="spending-older-note">{data.meta.olderThanPeriod} older transaction{data.meta.olderThanPeriod === 1 ? ' is' : 's are'} outside the last {filters.days} days{filters.days < 90 ? '. Choose a longer period to see more' : ''}.</p>}
    {showFilters && <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="spending-filters">
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
      <button type="button" className={btn} disabled={busy} onClick={() => setSelected(new Set(eligible.slice(0, data.options.maxBatch ?? 50).map(r => r.id)))} data-testid="spending-select-all">Select {Math.min(eligible.length, data.options.maxBatch ?? 50)} confident matches</button>
      {chosen.length > 0 && <button type="button" className={btn} disabled={busy} onClick={() => setSelected(new Set())}>Clear</button>}
      <button type="button" className={`${btn} bg-white/10`} disabled={busy || chosen.length === 0} onClick={() => void approveSelected()} data-testid="spending-approve-selected">Approve {chosen.length} selected</button>
      <p className="w-full text-xs text-[var(--text-secondary)]">Only confident everyday expense categories can be approved together. Payroll, transfers, owner draws, personal items, deposits and refunds always need your individual decision. Approving labels bank evidence only.</p>
    </div>}
    {batchNote && <p className="mt-1 text-xs" data-testid="spending-batch-note" role="status">{batchNote}</p>}
    {message && <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--fin-negative)' }}>{message}</p>}
    {rows.length === 0 ? <p className="mt-3 text-sm text-[var(--text-secondary)]" data-testid="spending-empty">No transactions match this view.</p>
      : <ul className="mt-2 divide-y divide-[var(--border-primary)]" data-testid="spending-list">{rows.map(r => <Row key={r.id} row={r} options={data.options} busy={busy} onDecide={decide} environment={data.environment} loadHistory={loadHistory} selectable={approvable(r)} selected={selected.has(r.id)} onToggle={toggle} />)}</ul>}
    {rows.length < data.total && <button type="button" className={`${btn} mt-2`} onClick={() => void loadMore()} disabled={busy} data-testid="spending-more">Show more ({data.total - rows.length} left)</button>}
  </section>
}
