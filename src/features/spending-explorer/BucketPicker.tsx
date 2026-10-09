/**
 * src/features/spending-explorer/BucketPicker.tsx
 *
 * BANK-6E: the category ("bucket") picker. A modal in the Settings-hub visual language (rounded-2xl card, eyebrow labels, icon chip, tinted
 * actions) that replaces the bare native select. It changes NOTHING by itself: picking a row only moves a draft; "Apply" hands the chosen key to the
 * caller, which sends the SAME existing decision as before (set_bucket). Cancel / Escape / the backdrop close it with nothing sent. Reset returns
 * the draft to the current category. The options are exactly the categories the caller passes (no invented buckets), already filtered to the
 * direction of the money.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search, Tag, X } from 'lucide-react'
import { CategoryDot } from '@/features/display-colors/DisplayColors'

export interface BucketOption { key: string; label: string; hint?: string; flow?: 'in' | 'out' }

const GROUPS: Array<{ id: string; title: string; keys: string[] }> = [
  { id: 'everyday', title: 'Everyday business expenses', keys: ['materials', 'fuel_vehicle', 'tools_equipment', 'software_subscriptions', 'insurance', 'permits_fees', 'marketing', 'meals', 'office_admin', 'bank_finance_fees', 'taxes'] },
  { id: 'people', title: 'People and owner', keys: ['payroll_people', 'personal_owner', 'owner_draw'] },
  { id: 'in', title: 'Money in', keys: ['customer_payment', 'refund'] },
  { id: 'movement', title: 'Money movement', keys: ['transfers'] },
  { id: 'unsure', title: 'Not sure yet', keys: ['other_needs_review'] },
]
const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]'

export function BucketPicker({ open, options, currentKey, suggestedKey, title = 'Choose a category', context, onApply, onClose, busy }: {
  open: boolean
  options: BucketOption[]
  currentKey: string | null
  suggestedKey?: string | null
  title?: string
  /** One line identifying the transaction, e.g. "CHEVRON · −$62.10 · Oct 7". */
  context?: string
  onApply: (key: string) => void
  onClose: () => void
  busy?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(currentKey)
  const [query, setQuery] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(currentKey); setQuery('')
    opener.current = document.activeElement
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 0)
    return () => { clearTimeout(t); (opener.current as HTMLElement | null)?.focus?.() }
  }, [open, currentKey])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (o: BucketOption) => !q || o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q)
    const known = new Set(GROUPS.flatMap(g => g.keys))
    const out = GROUPS.map(g => ({ ...g, items: g.keys.map(k => options.find(o => o.key === k)).filter((o): o is BucketOption => !!o && match(o)) }))
    const rest = options.filter(o => !known.has(o.key) && match(o)) // a category the app knows but this list does not group: shown, never dropped
    if (rest.length) out.push({ id: 'other', title: 'Other', keys: [], items: rest })
    return out.filter(g => g.items.length)
  }, [options, query])

  if (!open) return null
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    if (e.key === 'Tab' && panel.current) { // keep focus inside the dialog
      const f = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input')]
      if (!f.length) return
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
    }
  }
  const changed = !!draft && draft !== currentKey
  const label = (k: string | null) => options.find(o => o.key === k)?.label ?? null
  const showSearch = options.length > 8

  return <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" onKeyDown={onKey} data-testid="bucket-picker">
    <div className="absolute inset-0 bg-black/60 motion-safe:transition-opacity" aria-hidden="true" onClick={onClose} data-testid="bucket-picker-backdrop" />
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="bucket-picker-title"
      className="relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-2xl sm:max-w-lg sm:rounded-2xl">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border-primary)] bg-gradient-to-br from-white/[0.04] to-transparent px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="rounded-xl border border-[var(--border-primary)] bg-white/[0.04] p-2 text-[var(--text-secondary)]"><Tag size={18} /></span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Category</p>
            <h2 id="bucket-picker-title" className="truncate text-base font-bold">{title}</h2>
            {context && <p className="truncate text-xs text-[var(--text-secondary)]" data-testid="bucket-picker-context">{context}</p>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close without changes" className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-white/5 ${focusRing}`}><X size={18} /></button>
      </header>

      {showSearch && <div className="border-b border-[var(--border-primary)] px-4 py-2">
        <label className="flex min-h-[44px] items-center gap-2 rounded-xl px-3 ring-1 ring-[var(--border-primary)] focus-within:ring-2 focus-within:ring-[var(--text-secondary)]">
          <Search size={16} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" />
          <input data-autofocus type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search categories" aria-label="Search categories"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ appearance: 'none' }} />
        </label>
      </div>}

      <div role="radiogroup" aria-labelledby="bucket-picker-title" className="flex-1 space-y-4 overflow-y-auto px-4 py-3" data-testid="bucket-picker-options">
        {groups.length === 0 && <p className="py-6 text-center text-sm text-[var(--text-secondary)]">No category matches “{query}”.</p>}
        {groups.map(g => <section key={g.id} aria-label={g.title}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{g.title}</p>
          <ul className="space-y-1">{g.items.map((o, i) => {
            const on = draft === o.key
            return <li key={o.key}>
              <button type="button" role="radio" aria-checked={on} onClick={() => setDraft(o.key)} data-option={o.key} {...(!showSearch && g === groups[0] && i === 0 ? { 'data-autofocus': true } : {})}
                className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left motion-safe:transition-colors ${on ? 'bg-white/[0.07] ring-2 ring-[var(--fin-cash-border)]' : 'ring-1 ring-[var(--border-primary)] hover:bg-white/[0.04]'} ${focusRing}`}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center"><CategoryDot categoryKey={o.key} className="!h-3 !w-3" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">{o.label}
                    {o.key === currentKey && <span className="rounded-full px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] ring-1 ring-[var(--border-primary)]">Current</span>}
                    {o.key === suggestedKey && o.key !== currentKey && <span className="rounded-full border border-dashed border-[var(--border-primary)] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Suggested</span>}
                  </span>
                  {o.hint && <span className="block truncate text-xs text-[var(--text-secondary)]">{o.hint}</span>}
                </span>
                <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${on ? 'bg-[var(--fin-cash)] text-[var(--bg-card)]' : 'ring-1 ring-[var(--border-primary)]'}`}>{on && <Check size={14} strokeWidth={3} />}</span>
              </button>
            </li>
          })}</ul>
        </section>)}
      </div>

      <footer className="space-y-2 border-t border-[var(--border-primary)] px-4 pb-4 pt-3">
        <p className="text-xs text-[var(--text-secondary)]" aria-live="polite" data-testid="bucket-picker-summary">
          {changed ? <>Change to <span className="font-semibold text-[var(--text-primary)]">{label(draft)}</span>{currentKey ? <> (from {label(currentKey)})</> : null}. Nothing is saved until you apply.</>
            : 'Pick a category, then Apply. This only labels the bank record.'}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={() => setDraft(currentKey)} disabled={!changed} data-testid="bucket-picker-reset"
            className={`mr-auto min-h-[44px] rounded-xl px-3 text-sm font-semibold text-[var(--text-secondary)] hover:bg-white/5 disabled:opacity-40 ${focusRing}`}>Reset</button>
          <button type="button" onClick={onClose} data-testid="bucket-picker-cancel" className={`min-h-[44px] rounded-xl px-4 text-sm font-semibold ring-1 ring-[var(--border-primary)] hover:bg-white/5 ${focusRing}`}>Cancel</button>
          <button type="button" onClick={() => draft && onApply(draft)} disabled={!changed || busy} data-testid="bucket-picker-apply"
            className={`min-h-[44px] rounded-xl border border-[var(--fin-cash-border)] bg-[var(--fin-cash-tint)] px-4 text-sm font-semibold text-[var(--fin-cash)] hover:brightness-110 disabled:opacity-40 ${focusRing}`}>Apply</button>
        </div>
      </footer>
    </div>
  </div>
}
