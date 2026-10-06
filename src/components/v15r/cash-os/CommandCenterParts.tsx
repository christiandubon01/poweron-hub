import type { ReactNode } from 'react'
import type { RowRefs } from './commandCenterModel'

/** Small state tag: a word AND a shape, so state never relies on color alone. */
export function StateTag({ label, glyph, color, tint }: { label: string; glyph: string; color: string; tint?: string }) {
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide"
    style={{ color, background: tint ?? 'transparent', border: `1px solid ${color}` }}>
    <span aria-hidden="true">{glyph}</span>{label}
  </span>
}

/** One compact, keyboard-accessible row. The whole header is a real button; the panel is Level 2. */
export function CommandRow({ id, expanded, onToggle, lead, title, sub, trailing, refs, linked = false, testId = 'command-row', children }: {
  id: string
  expanded: boolean
  onToggle: () => void
  lead?: ReactNode
  title: ReactNode
  sub?: ReactNode
  trailing?: ReactNode
  /** Stable pointers (source key / project) so graph ↔ row linking can be added without copying records. */
  refs?: RowRefs
  /** True when this row shares canonical identity with the selected graph item. A quiet outline only. */
  linked?: boolean
  testId?: string
  children?: ReactNode
}) {
  const panelId = `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}-panel`
  return <div data-testid={testId} data-row-id={id} data-source-key={refs?.sourceKey} data-project-id={refs?.projectId}
    data-account-id={refs?.accountId} data-date={refs?.date ?? undefined} data-linked={linked || undefined}
    className={`border-b border-[var(--border-primary)] last:border-b-0 ${linked ? 'rounded-md outline outline-2 -outline-offset-2 outline-sky-300/70' : ''}`}>
    <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}
      className="flex min-h-[44px] w-full items-center gap-3 py-2 text-left hover:bg-white/5">
      {lead}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug text-[var(--text-primary)]">{title}</span>
        {sub ? <span className="block text-xs text-[var(--text-secondary)]">{sub}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 text-right text-sm">{trailing}</span> : null}
      <span aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]">{expanded ? '⌃' : '›'}</span>
    </button>
    {expanded && <div id={panelId} role="region" className="pb-3 pl-1 pr-1 text-sm text-[var(--text-secondary)]">{children}</div>}
  </div>
}

export function CommandSection({ title, count, testId, className = '', children }: {
  title: string; count?: ReactNode; testId: string; className?: string; children: ReactNode
}) {
  return <section data-testid={testId} aria-label={title} className={`min-w-0 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 ${className}`}>
    <h3 className="mb-2 flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
      <span>{title}</span>{count != null ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] tracking-normal text-[var(--text-primary)]">{count}</span> : null}
    </h3>
    {children}
  </section>
}

export function ShowMore({ count, open, onToggle, noun = 'more' }: { count: number; open: boolean; onToggle: () => void; noun?: string }) {
  if (count <= 0) return null
  return <button type="button" onClick={onToggle} aria-expanded={open}
    className="mt-1 min-h-[44px] w-full rounded-lg text-sm font-semibold text-[var(--text-secondary)] ring-1 ring-[var(--border-primary)] hover:bg-white/5">
    {open ? 'Show fewer' : `Show ${count} ${noun}`}
  </button>
}

export function Quiet({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-[var(--text-secondary)]" data-testid="command-empty">{children}</p>
}
