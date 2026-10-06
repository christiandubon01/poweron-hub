import { useState, type ReactNode } from 'react'
import { money } from './cashOsUi'

/**
 * The single authoritative Cash Status row on Outlook.
 * Values are passed in from the existing projection anchor; nothing is calculated here.
 */
export interface CashStatusValues {
  cashMinor: number
  protectedMinor: number
  freeMinor: number
  /** Protection deficit: how much of what must be set aside is not covered by cash. */
  shortMinor: number
}

type Tone = 'cash' | 'free' | 'protected' | 'negative' | 'warning' | 'neutral'

const TONE_VARS: Record<Tone, { text: string; border: string; tint: string }> = {
  cash: { text: 'var(--fin-cash)', border: 'var(--fin-cash-border)', tint: 'var(--fin-cash-tint)' },
  free: { text: 'var(--fin-free)', border: 'var(--fin-free-border)', tint: 'var(--fin-free-tint)' },
  protected: { text: 'var(--fin-protected)', border: 'var(--fin-protected-border)', tint: 'var(--fin-protected-tint)' },
  negative: { text: 'var(--fin-negative)', border: 'var(--fin-negative-border)', tint: 'var(--fin-negative-tint)' },
  warning: { text: 'var(--fin-warning)', border: 'var(--fin-warning-border)', tint: 'var(--fin-warning-tint)' },
  neutral: { text: 'var(--text-secondary)', border: 'var(--border-primary)', tint: 'transparent' },
}

type IconName = 'cash' | 'lock' | 'free' | 'alert' | 'ok'

/** Small inline icons: shape carries meaning too, so state is never color-only. */
function StatusIcon({ name }: { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false }
  switch (name) {
    case 'cash': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v10M14.5 9.5h-3.2a1.8 1.8 0 0 0 0 3.6h1.4a1.8 1.8 0 0 1 0 3.6H9.5" /></svg>
    case 'lock': return <svg {...common}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
    case 'free': return <svg {...common}><path d="M12 19V5M6 11l6-6 6 6" /></svg>
    case 'alert': return <svg {...common}><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4.5M12 17.5v.01" /></svg>
    case 'ok': return <svg {...common}><path d="M5 12.5 10 17.5 19 7" /></svg>
  }
}

interface Card {
  id: 'cash' | 'set-aside' | 'free' | 'short'
  label: string
  value: number
  tone: Tone
  icon: IconName
  /** Plain-word state, shown beside the icon so color is never the only signal. */
  state: string
  caption: string
}

export function buildStatusCards(values: CashStatusValues): Card[] {
  const { cashMinor, protectedMinor, freeMinor, shortMinor } = values
  return [
    { id: 'cash', label: 'CASH I HAVE', value: cashMinor, icon: 'cash',
      tone: cashMinor < 0 ? 'negative' : 'cash', state: cashMinor < 0 ? 'Below zero' : 'In your accounts',
      caption: 'Across the accounts counted as cash' },
    { id: 'set-aside', label: 'SET ASIDE FOR BILLS', value: protectedMinor, icon: 'lock',
      tone: 'protected', state: 'Reserved', caption: 'Held back for bills coming due' },
    { id: 'free', label: 'FREE TO USE', value: freeMinor, icon: 'free',
      tone: freeMinor > 0 ? 'free' : 'neutral', state: freeMinor > 0 ? 'Available' : 'None free',
      caption: 'What is left after bills are set aside' },
    { id: 'short', label: 'SHORT', value: shortMinor, icon: shortMinor > 0 ? 'alert' : 'ok',
      tone: shortMinor > 0 ? 'negative' : 'neutral', state: shortMinor > 0 ? 'Short' : 'Nothing short',
      caption: shortMinor > 0 ? 'Needed for bills but not covered by cash' : 'Cash covers what is set aside' },
  ]
}

export default function CashStatusRow({ values, sourceNote, info }: {
  values: CashStatusValues
  /** Optional provenance line for the Cash I Have card (e.g. "Manual"; later "Synced 12 min ago"). */
  sourceNote?: ReactNode
  /** Explanatory detail kept behind a small info control instead of permanently consuming space. */
  info?: ReactNode
}) {
  const cards = buildStatusCards(values)
  const [infoOpen, setInfoOpen] = useState(false)
  return <section aria-label="Cash status" data-testid="cash-status-row">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(card => {
      const tone = TONE_VARS[card.tone]
      return <div key={card.id} data-testid={`cash-status-${card.id}`} data-tone={card.tone}
        className="flex min-h-[8.5rem] min-w-0 flex-col rounded-xl border p-4"
        style={{ borderColor: tone.border, borderLeftWidth: 4, background: `linear-gradient(0deg, ${tone.tint}, ${tone.tint}), var(--bg-card)` }}>
        <span className="flex items-center justify-between gap-2 text-[11px] font-bold tracking-[0.12em] text-[var(--text-secondary)]">
          <span className="flex items-center gap-2"><span style={{ color: tone.text }}><StatusIcon name={card.icon} /></span>{card.label}</span>
          {card.id === 'set-aside' && info ? <button type="button" onClick={() => setInfoOpen(v => !v)} aria-expanded={infoOpen}
            aria-controls="cash-status-info" aria-label="About what is set aside" data-testid="cash-status-info-button"
            className="-my-3 -mr-3 inline-flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold hover:bg-white/10"
            style={{ color: tone.text }}><span aria-hidden="true">ⓘ</span></button> : null}
        </span>
        <strong className="mt-2 block break-words font-mono text-2xl" style={{ color: tone.text }}>{money(card.value)}</strong>
        <span className="mt-1 text-xs font-semibold" style={{ color: tone.text }}>{card.state}</span>
        <span className="mt-auto pt-2 text-xs text-[var(--text-secondary)]">
          {card.caption}
          {card.id === 'cash' && sourceNote ? <span data-testid="cash-status-source" className="block text-[var(--text-secondary)]">{sourceNote}</span> : null}
        </span>
      </div>
    })}</div>
    {info && infoOpen ? <p id="cash-status-info" data-testid="cash-status-info" className="mt-3 rounded-lg bg-[var(--bg-secondary)] p-3 text-sm text-[var(--text-secondary)]">{info}</p> : null}
  </section>
}
