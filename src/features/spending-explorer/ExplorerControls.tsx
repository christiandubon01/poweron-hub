/**
 * src/features/spending-explorer/ExplorerControls.tsx
 *
 * BANK-6F Explorer views, search and filters. PRESENTATION ONLY: every control writes the same `Filters` field it wrote before, so every query the
 * server receives is unchanged (bank6fContract.test.tsx). All seven views stay directly visible (D6): three primary tabs plus a visible, wrapping row
 * of the other four. No overflow menu and no sideways scrolling. Server view keys and counts are untouched.
 *
 * View labels and captions were checked against the server's view rules (spending/explorer.ts `inView`, read for BANK-6F):
 *   review_queue      everything not yet confirmed or ignored (money in and out, pending included)
 *   reviewed          an active confirmed category or relationship, not ignored
 *   all               every transaction in the period and account scope
 *   known_bills       money out with a bill, debt or payroll relationship, confirmed or suggested, not ignored
 *   unassigned        posted, non-ignored money out not linked to a bill, debt, payroll, project, transfer, overhead or personal use, and not
 *                     confidently matched to one (so project-linked spending is NOT in it)
 *   repeated_spending unassigned spending from a merchant with a repeating pattern
 *   needs_review      money out not yet confirmed or ignored ("Money out to review")
 */
import { Search, SlidersHorizontal, Palette, X } from 'lucide-react'
import { DEFAULT_FILTERS, type ExplorerData, type ExplorerView, type Filters } from './useSpendingExplorer'
import { SegmentedControl, SelectField } from './controls'
import { btn, btnQuiet, focusRing, panel } from './ui'

const PRIMARY: Array<{ key: ExplorerView; label: string }> = [{ key: 'review_queue', label: 'To review' }, { key: 'reviewed', label: 'Reviewed' }, { key: 'all', label: 'All' }]
const MORE: Array<{ key: ExplorerView; label: string }> = [
  { key: 'known_bills', label: 'Known bills' }, { key: 'unassigned', label: 'Unassigned spending' }, { key: 'repeated_spending', label: 'Repeated spending' }, { key: 'needs_review', label: 'Money out to review' },
]
export const VIEW_CAPTION: Record<ExplorerView, string> = {
  review_queue: 'Everything not yet reviewed or ignored, money in and out. Pending transactions can be categorized here.',
  reviewed: 'Transactions you confirmed (marked ✓). Suggestions are not counted as reviewed. Open one to see its decision history or to undo it.',
  all: 'Every transaction in this period and account scope.',
  known_bills: 'Money going out with a bill, debt or payroll payment, confirmed or suggested.',
  unassigned: 'Posted money going out that is not linked to a bill, debt, payroll, project, transfer, overhead or personal use, and not confidently matched to one.',
  repeated_spending: 'Unassigned spending at merchants that repeat on a regular pattern.',
  needs_review: 'Money going out that is not yet reviewed or ignored.',
}

const SCOPE_LABEL: Record<string, string> = { business: 'Business', personal: 'Personal', unclear: 'Business or personal: unclear' }
const REVIEW_LABEL: Record<string, string> = { needs_review: 'Needs review', suggested: 'Suggested', confirmed: 'Confirmed', ignored: 'Ignored' }
const CONF_LABEL: Record<string, string> = { high: 'High', possible: 'Possible', low: 'Low' }

export function ViewTabs({ view, data, onView }: { view: ExplorerView; data: ExplorerData; onView: (v: ExplorerView) => void }) {
  const count = (k: ExplorerView) => data.viewCounts[k] ?? (k === 'reviewed' ? data.reviewCounts?.reviewed : undefined)
  const tab = (v: { key: ExplorerView; label: string }, primary: boolean) => {
    const on = view === v.key
    const n = count(v.key)
    return <button key={v.key} type="button" role="tab" aria-selected={on} data-testid={`spending-view-${v.key}`} onClick={() => onView(v.key)}
      className={primary
        ? `inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold motion-safe:transition-colors ${on ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.2)] ring-1 ring-[var(--surface-line)]' : 'text-[var(--text-secondary)] [@media(hover:hover)]:hover:bg-[var(--surface-2)]'} ${focusRing}`
        : `inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold motion-safe:transition-colors ${on ? 'bg-[var(--surface-selected)] text-[var(--text-primary)] ring-2 ring-[var(--text-primary)]' : 'text-[var(--text-secondary)] ring-1 ring-[var(--border-primary)] [@media(hover:hover)]:hover:bg-[var(--surface-2)]'} ${focusRing}`}>
      {v.label} <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-xs tabular-nums text-[var(--text-secondary)]">{n}</span>
    </button>
  }
  return <div role="tablist" aria-label="Spending views" className="space-y-2" data-testid="spending-views">
    <div role="none" className="inline-flex max-w-full flex-wrap gap-0.5 rounded-2xl bg-[var(--surface-1)] p-1 ring-1 ring-[var(--border-primary)]">{PRIMARY.map(v => tab(v, true))}</div>
    <div role="none" className="flex flex-wrap items-center gap-1.5"><span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">More views</span>{MORE.map(v => tab(v, false))}</div>
  </div>
}

/** One removable chip per active filter. Removing a chip clears only that field (the same `update` as before); "Clear all" is the same `reset`. */
function activeChips(f: Filters, data: ExplorerData): Array<{ key: string; label: string; clear: Partial<Filters> }> {
  const out: Array<{ key: string; label: string; clear: Partial<Filters> }> = []
  const bucket = data.options.buckets.find(b => b.key === f.bucket)?.label ?? f.bucket
  const account = data.options.accounts.find(a => a.ref === f.account)
  const project = data.options.projects.find(p => p.id === f.project)?.name ?? f.project
  if (f.bucket) out.push({ key: 'bucket', label: `Category: ${bucket}`, clear: { bucket: '' } })
  if (f.account) out.push({ key: 'account', label: `Account: ${account ? `${account.label}${account.mask ? ` ••••${account.mask}` : ''}` : f.account}`, clear: { account: '' } })
  if (f.scope) out.push({ key: 'scope', label: SCOPE_LABEL[f.scope] ?? f.scope, clear: { scope: '' } })
  if (f.review) out.push({ key: 'review', label: `Review: ${REVIEW_LABEL[f.review] ?? f.review}`, clear: { review: '' } })
  if (f.confidence) out.push({ key: 'confidence', label: `Confidence: ${CONF_LABEL[f.confidence] ?? f.confidence}`, clear: { confidence: '' } })
  if (f.project) out.push({ key: 'project', label: `Project: ${project}`, clear: { project: '' } })
  if (f.search) out.push({ key: 'search', label: `Search: “${f.search}”`, clear: { search: '' } })
  if (f.min) out.push({ key: 'min', label: `At least $${f.min}`, clear: { min: '' } })
  if (f.max) out.push({ key: 'max', label: `At most $${f.max}`, clear: { max: '' } })
  if (f.days !== DEFAULT_FILTERS.days) out.push({ key: 'days', label: `Last ${f.days} days`, clear: { days: DEFAULT_FILTERS.days } })
  if (f.accounts !== DEFAULT_FILTERS.accounts) out.push({ key: 'accounts', label: 'All connected accounts', clear: { accounts: DEFAULT_FILTERS.accounts } })
  return out
}

export function FilterBar({ filters, data, update, reset, showFilters, setShowFilters, showColors, setShowColors, colorsEnabled }: {
  filters: Filters; data: ExplorerData; update: (p: Partial<Filters>) => void; reset: () => void
  showFilters: boolean; setShowFilters: (f: (s: boolean) => boolean) => void; showColors: boolean; setShowColors: (f: (s: boolean) => boolean) => void; colorsEnabled: boolean
}) {
  const chips = activeChips(filters, data)
  // Same count as before BANK-6F: every narrowing field, plus a non-default period or account scope.
  const active = (['bucket', 'account', 'scope', 'review', 'confidence', 'project', 'search', 'min', 'max'] as const).filter(k => filters[k]).length + (filters.days !== DEFAULT_FILTERS.days ? 1 : 0) + (filters.accounts !== DEFAULT_FILTERS.accounts ? 1 : 0)
  const label = 'text-xs font-semibold text-[var(--text-secondary)]'
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <label className={`flex min-h-[44px] min-w-[12rem] flex-1 items-center gap-2 rounded-xl bg-[var(--surface-1)] px-3 ring-1 ring-[var(--border-primary)] focus-within:ring-2 focus-within:ring-[var(--text-secondary)]`}>
        <Search size={16} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" />
        <span className="sr-only">Search merchants</span>
        <input type="search" value={filters.search} onChange={e => update({ search: e.target.value })} placeholder="Search merchants" data-testid="spending-search"
          className="min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm" style={{ appearance: 'none' }} />
      </label>
      <SegmentedControl label="Period" size="sm" value={String(filters.days) as '30' | '60' | '90'} onChange={v => update({ days: Number(v) as 30 | 60 | 90 })} testIdPrefix="spending-period"
        options={[{ value: '30', label: '30 days' }, { value: '60', label: '60' }, { value: '90', label: '90' }]} />
      <button type="button" className={`${btn} inline-flex items-center gap-1.5`} aria-expanded={showFilters} onClick={() => setShowFilters(s => !s)} data-testid="spending-filters-toggle">
        <SlidersHorizontal size={16} aria-hidden="true" />Filters{active ? ` (${active})` : ''}</button>
      {colorsEnabled && <button type="button" className={`${btn} inline-flex items-center gap-1.5`} aria-expanded={showColors} onClick={() => setShowColors(s => !s)} data-testid="spending-colors-toggle"><Palette size={16} aria-hidden="true" />Colors</button>}
    </div>
    {chips.length > 0 && <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters in use" data-testid="spending-filter-chips">
      {chips.map(c => <span key={c.key} data-testid="spending-filter-chip" data-filter={c.key}
        className="inline-flex min-h-[36px] max-w-full items-center gap-1 rounded-full bg-[var(--fin-protected-tint)] pl-3 pr-1 text-[13px] font-semibold text-[var(--fin-protected)] ring-1 ring-[var(--fin-protected-border)]">
        <span className="truncate">{c.label}</span>
        <button type="button" aria-label={`Remove filter: ${c.label}`} onClick={() => update(c.clear)} className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full [@media(hover:hover)]:hover:bg-[var(--surface-2)] ${focusRing}`}><X size={14} aria-hidden="true" /></button>
      </span>)}
      <button type="button" className={btnQuiet} onClick={reset} data-testid="spending-filters-clear">Clear all</button>
    </div>}
    {showFilters && <div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ${panel}`} data-testid="spending-filters">
      <fieldset className="min-w-0 space-y-2"><legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Where</legend>
        <label className={`block ${label}`}>Account<SelectField className="mt-1" value={filters.account} onChange={e => update({ account: e.target.value })}><option value="">All accounts</option>{data.options.accounts.map(x => <option key={x.ref} value={x.ref}>{x.label}{x.mask ? ` ••••${x.mask}` : ''}</option>)}</SelectField></label>
        <label className={`block ${label}`}>Business / personal<SelectField className="mt-1" value={filters.scope} onChange={e => update({ scope: e.target.value })}><option value="">Both</option><option value="business">Business</option><option value="personal">Personal</option><option value="unclear">Unclear</option></SelectField></label>
      </fieldset>
      <fieldset className="min-w-0 space-y-2"><legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">What</legend>
        <label className={`block ${label}`}>Category<SelectField className="mt-1" value={filters.bucket} onChange={e => update({ bucket: e.target.value })}><option value="">All categories</option>{data.options.buckets.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</SelectField></label>
        <label className={`block ${label}`}>Project<SelectField className="mt-1" value={filters.project} onChange={e => update({ project: e.target.value })}><option value="">Any</option>{data.options.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField></label>
      </fieldset>
      <fieldset className="min-w-0 space-y-2"><legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Status</legend>
        <label className={`block ${label}`}>Review<SelectField className="mt-1" value={filters.review} onChange={e => update({ review: e.target.value })}><option value="">Any</option><option value="needs_review">Needs review</option><option value="suggested">Suggested</option><option value="confirmed">Confirmed</option><option value="ignored">Ignored</option></SelectField></label>
        <label className={`block ${label}`}>Confidence<SelectField className="mt-1" value={filters.confidence} onChange={e => update({ confidence: e.target.value })}><option value="">Any</option><option value="high">High</option><option value="possible">Possible</option><option value="low">Low</option></SelectField></label>
      </fieldset>
      <fieldset className="min-w-0 space-y-2"><legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Amount</legend>
        <label className={`block ${label}`}>Min amount ($)<input inputMode="decimal" className={`mt-1 min-h-[44px] w-full rounded-xl bg-[var(--surface-1)] px-3 text-base ring-1 ring-[var(--border-primary)] sm:text-sm ${focusRing}`} value={filters.min} onChange={e => update({ min: e.target.value })} placeholder="0.00" /></label>
        <label className={`block ${label}`}>Max amount ($)<input inputMode="decimal" className={`mt-1 min-h-[44px] w-full rounded-xl bg-[var(--surface-1)] px-3 text-base ring-1 ring-[var(--border-primary)] sm:text-sm ${focusRing}`} value={filters.max} onChange={e => update({ max: e.target.value })} placeholder="No limit" /></label>
      </fieldset>
    </div>}
  </div>
}
