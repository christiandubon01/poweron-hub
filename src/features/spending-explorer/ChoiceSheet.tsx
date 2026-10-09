/**
 * src/features/spending-explorer/ChoiceSheet.tsx
 *
 * BANK-6F: the ONE choice sheet for the spending surfaces (category in the detail, category in Review Selected and Smart Review, the relationship
 * target). Extracted from the BANK-6E category modal without changing what it does: picking a row only moves a DRAFT; the primary button hands the
 * chosen key to the caller, which sends exactly the request it sent before (or, in a review, only changes the unsaved draft). Cancel, Escape, the
 * close button and the backdrop close it with nothing sent. A bottom sheet on a phone, a centred dialog from 640px (iPad).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Search, X } from 'lucide-react'

export interface ChoiceOption { key: string; label: string; hint?: string; leading?: ReactNode }
export interface ChoiceGroup { id: string; title: string; keys: string[] }

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]'

export function ChoiceSheet({
  open, options, groups, currentKey, suggestedKey, title, eyebrow, icon, context, onApply, onClose, onClear, busy, testId,
  applyLabel = 'Apply', clearLabel = 'Remove my choice', idleNote, changeNote, searchLabel = 'Search', emptyText = 'Nothing matches',
}: {
  open: boolean
  options: ChoiceOption[]
  /** Optional grouping; an option outside every group is still shown under "Other" (never dropped). */
  groups?: ChoiceGroup[]
  currentKey: string | null
  suggestedKey?: string | null
  title: string
  eyebrow: string
  icon?: ReactNode
  /** One line identifying what is being chosen for, e.g. "CHEVRON · −$62.10 · Oct 7". */
  context?: string
  onApply: (key: string) => void
  onClose: () => void
  /** When given and a current choice exists, a quiet button removes that choice (a draft change only). */
  onClear?: () => void
  busy?: boolean
  /** Test-id prefix; also the dialog title id (`${testId}-title`). */
  testId: string
  applyLabel?: string
  clearLabel?: string
  idleNote?: string
  changeNote?: (to: string, from: string | null) => ReactNode
  searchLabel?: string
  emptyText?: string
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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (o: ChoiceOption) => !q || o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q)
    if (!groups) return [{ id: 'all', title: '', items: options.filter(match) }].filter(g => g.items.length)
    const known = new Set(groups.flatMap(g => g.keys))
    const out = groups.map(g => ({ id: g.id, title: g.title, items: g.keys.map(k => options.find(o => o.key === k)).filter((o): o is ChoiceOption => !!o && match(o)) }))
    const rest = options.filter(o => !known.has(o.key) && match(o))
    if (rest.length) out.push({ id: 'other', title: 'Other', items: rest })
    return out.filter(g => g.items.length)
  }, [options, groups, query])

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
  const titleId = `${testId}-title`

  return <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" onKeyDown={onKey} data-testid={testId}>
    <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} data-testid={`${testId}-backdrop`} />
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
      className="relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-w-lg sm:rounded-2xl sm:pb-0">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border-primary)] bg-gradient-to-br from-[var(--surface-1)] to-transparent px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <span aria-hidden="true" className="rounded-xl border border-[var(--border-primary)] bg-[var(--surface-1)] p-2 text-[var(--text-secondary)]">{icon}</span>}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{eyebrow}</p>
            <h2 id={titleId} className="truncate text-base font-bold">{title}</h2>
            {context && <p className="truncate text-xs text-[var(--text-secondary)]" data-testid={`${testId}-context`}>{context}</p>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close without changes" className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl [@media(hover:hover)]:hover:bg-[var(--surface-2)] ${focusRing}`}><X size={18} /></button>
      </header>

      {showSearch && <div className="border-b border-[var(--border-primary)] px-4 py-2">
        <label className="flex min-h-[44px] items-center gap-2 rounded-xl px-3 ring-1 ring-[var(--border-primary)] focus-within:ring-2 focus-within:ring-[var(--text-secondary)]">
          <Search size={16} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" />
          <input data-autofocus type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={searchLabel} aria-label={searchLabel}
            className="min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm" style={{ appearance: 'none' }} />
        </label>
      </div>}

      <div role="radiogroup" aria-labelledby={titleId} className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3" data-testid={`${testId}-options`}>
        {shown.length === 0 && <p className="py-6 text-center text-sm text-[var(--text-secondary)]">{emptyText} “{query}”.</p>}
        {shown.map((g, gi) => <section key={g.id} aria-label={g.title || undefined}>
          {g.title && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{g.title}</p>}
          <ul className="space-y-1">{g.items.map((o, i) => {
            const on = draft === o.key
            return <li key={o.key}>
              <button type="button" role="radio" aria-checked={on} onClick={() => setDraft(o.key)} data-option={o.key} {...(!showSearch && gi === 0 && i === 0 ? { 'data-autofocus': true } : {})}
                className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left motion-safe:transition-colors ${on ? 'bg-[var(--surface-selected)] ring-2 ring-[var(--fin-cash-border)]' : 'ring-1 ring-[var(--border-primary)] [@media(hover:hover)]:hover:bg-[var(--surface-2)]'} ${focusRing}`}>
                {o.leading !== undefined && <span className="flex h-5 w-5 shrink-0 items-center justify-center">{o.leading}</span>}
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
        <p className="text-xs text-[var(--text-secondary)]" aria-live="polite" data-testid={`${testId}-summary`}>
          {changed ? (changeNote ? changeNote(label(draft) ?? '', label(currentKey)) : <>Change to <span className="font-semibold text-[var(--text-primary)]">{label(draft)}</span>{currentKey ? <> (from {label(currentKey)})</> : null}. Nothing is saved until you apply.</>)
            : (idleNote ?? 'Pick one, then Apply.')}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={() => setDraft(currentKey)} disabled={!changed} data-testid={`${testId}-reset`}
            className={`mr-auto min-h-[44px] rounded-xl px-3 text-sm font-semibold text-[var(--text-secondary)] [@media(hover:hover)]:hover:bg-[var(--surface-2)] disabled:opacity-40 ${focusRing}`}>Reset</button>
          {onClear && currentKey && <button type="button" onClick={onClear} data-testid={`${testId}-clear`}
            className={`min-h-[44px] rounded-xl px-3 text-sm font-semibold text-[var(--text-secondary)] [@media(hover:hover)]:hover:bg-[var(--surface-2)] ${focusRing}`}>{clearLabel}</button>}
          <button type="button" onClick={onClose} data-testid={`${testId}-cancel`} className={`min-h-[44px] rounded-xl px-4 text-sm font-semibold ring-1 ring-[var(--border-primary)] [@media(hover:hover)]:hover:bg-[var(--surface-2)] ${focusRing}`}>Cancel</button>
          <button type="button" onClick={() => draft && onApply(draft)} disabled={!changed || busy} data-testid={`${testId}-apply`}
            className={`min-h-[44px] rounded-xl border border-[var(--fin-cash-border)] bg-[var(--fin-cash-tint)] px-4 text-sm font-semibold text-[var(--fin-cash)] [@media(hover:hover)]:hover:brightness-110 disabled:opacity-40 ${focusRing}`}>{applyLabel}</button>
        </div>
      </footer>
    </div>
  </div>
}
