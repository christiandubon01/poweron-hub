/**
 * src/features/spending-explorer/controls.tsx
 *
 * BANK-6F shared controls for the Cash OS spending surfaces. Presentation only: every control reports the same value its native predecessor did.
 *   SegmentedControl  one choice from a few (mode, period, views, remember); 44px targets; aria-pressed or role="tab" + aria-selected
 *   Checkbox          a REAL checkbox input (keyboard, screen readers, tests) under a drawn box that looks the same in both themes and on iPad Safari
 *   SelectField       a native <select> with a visible arrow (the app-wide `-webkit-appearance: none` reset removes Safari's own)
 *   Chip / StatusBadge  one chip recipe with fixed meanings, and the review-status badge (icon + word, never color alone)
 */
import type { ReactNode, SelectHTMLAttributes } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { focusRing } from './ui'

export function SegmentedControl<T extends string>({ value, options, onChange, label, role = 'group', size = 'md', testIdPrefix, className = '' }: {
  value: T
  options: Array<{ value: T; label: ReactNode; count?: number | null; testId?: string; disabled?: boolean }>
  onChange: (v: T) => void
  label: string
  /** `tablist` renders role="tab" + aria-selected (views); `group` renders aria-pressed buttons. */
  role?: 'group' | 'tablist'
  size?: 'md' | 'sm'
  testIdPrefix?: string
  className?: string
}) {
  const h = size === 'sm' ? 'min-h-[40px] px-3' : 'min-h-[44px] px-3.5'
  return <div role={role} aria-label={label} className={`inline-flex max-w-full flex-wrap gap-0.5 rounded-2xl bg-[var(--surface-1)] p-1 ring-1 ring-[var(--border-primary)] ${className}`}>
    {options.map(o => {
      const on = o.value === value
      const a11y = role === 'tablist' ? { role: 'tab', 'aria-selected': on } : { 'aria-pressed': on }
      return <button key={o.value} type="button" {...a11y} disabled={o.disabled} onClick={() => onChange(o.value)} data-testid={o.testId ?? (testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined)}
        className={`inline-flex ${h} items-center gap-1.5 rounded-xl text-sm font-semibold motion-safe:transition-colors disabled:opacity-50 ${on ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.2)] ring-1 ring-[var(--surface-line)]' : 'text-[var(--text-secondary)] [@media(hover:hover)]:hover:bg-[var(--surface-2)]'} ${focusRing}`}>
        {o.label}{o.count != null && <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-xs tabular-nums text-[var(--text-secondary)]">{o.count}</span>}
      </button>
    })}
  </div>
}

/** Selection check box (a draft, never an approval): blue when checked, per D1. The input stays the real control. */
export function Checkbox({ checked, onChange, label, disabled, testId, size = 'md' }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean; testId?: string; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-6 w-6' : 'h-[22px] w-[22px]'
  return <span className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} data-testid={testId}
      className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default" />
    <span aria-hidden="true" className={`inline-flex ${box} items-center justify-center rounded-[7px] motion-safe:transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--text-primary)] peer-disabled:opacity-50 ${checked ? 'bg-[var(--fin-protected)] text-[var(--bg-card)]' : 'bg-[var(--surface-1)] ring-[1.5px] ring-inset ring-[var(--surface-line)]'}`}>
      {checked && <Check size={15} strokeWidth={3} />}
    </span>
  </span>
}

export function SelectField({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return <span className={`relative block min-w-0 ${className}`}>
    <select {...rest} className={`min-h-[44px] w-full min-w-0 cursor-pointer rounded-xl bg-[var(--surface-1)] pl-3 pr-9 text-sm text-[var(--text-primary)] ring-1 ring-[var(--border-primary)] ${focusRing}`}>{children}</select>
    <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
  </span>
}

/**
 * One chip, fixed meanings:
 *   neutral   plain fact                      done   a confirmed decision (text color + ✓ supplied by the caller), never green
 *   warn      something to check (amber)      sel    a draft selection (blue, D1)            muted  quiet / secondary
 */
export type ChipTone = 'neutral' | 'done' | 'warn' | 'sel' | 'muted'
const CHIP_TONE: Record<ChipTone, string> = {
  neutral: 'text-[var(--text-secondary)] ring-1 ring-[var(--border-primary)]',
  done: 'text-[var(--text-primary)] ring-1 ring-[var(--surface-line)]',
  warn: 'bg-[var(--fin-warning-tint)] text-[var(--fin-warning)] ring-1 ring-[var(--fin-warning-border)]',
  sel: 'bg-[var(--fin-protected-tint)] text-[var(--fin-protected)] ring-1 ring-[var(--fin-protected-border)]',
  muted: 'text-[var(--text-muted)] ring-1 ring-[var(--border-primary)]',
}
export function Chip({ children, tone = 'neutral', testId }: { children: ReactNode; tone?: ChipTone; testId?: string }) {
  return <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ${CHIP_TONE[tone]}`} data-testid={testId} data-tone={tone}>{children}</span>
}

export type ReviewState = 'confirmed' | 'suggested' | 'needs_review' | 'ignored'
const STATUS: Record<ReviewState, { word: string; cls: string; icon: string }> = {
  confirmed: { word: 'Reviewed', cls: 'text-[var(--text-primary)]', icon: 'bg-[var(--text-primary)] text-[var(--bg-card)]' },
  suggested: { word: 'Suggested', cls: 'text-[var(--text-secondary)]', icon: 'border border-dashed border-[var(--text-secondary)]' },
  needs_review: { word: 'Needs review', cls: 'text-[var(--fin-warning)]', icon: 'ring-2 ring-inset ring-[var(--fin-warning)]' },
  ignored: { word: 'Ignored', cls: 'text-[var(--text-muted)]', icon: 'ring-[1.5px] ring-inset ring-[var(--text-muted)]' },
}
/** Review status (D2): an icon AND a word, at the end of the pill row. Not green: green is reserved for money in and the primary action. */
export function StatusBadge({ state, testId = 'entry-status' }: { state: ReviewState; testId?: string }) {
  const s = STATUS[state]
  return <span className={`inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-[0.09em] ${s.cls}`} data-testid={testId} data-state={state}>
    <span aria-hidden="true" className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ${s.icon}`}>{state === 'confirmed' && <Check size={9} strokeWidth={4} />}</span>{s.word}
  </span>
}
