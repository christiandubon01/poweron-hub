import type { ReactNode } from 'react'

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
export function money(minor: number | null | undefined): string {
  return minor == null ? 'Unknown' : dollars.format(minor / 100)
}

export function cashDate(value: string | null | undefined): string {
  if (!value) return 'Date unknown'
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(Date.UTC(year, month - 1, day, 12)))
}

export function CashCard({ title, children, className = '' }: {
  title?: string; children: ReactNode; className?: string
}) {
  return <section className={`rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 sm:p-5 ${className}`}>
    {title && <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">{title}</h3>}
    {children}
  </section>
}

export function CashEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-[var(--border-primary)] px-4 py-6 text-sm text-[var(--text-secondary)]">{children}</p>
}
