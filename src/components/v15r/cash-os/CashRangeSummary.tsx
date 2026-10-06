import { useState } from 'react'
import { DirectionBadge, compactMoney } from './CashFlowTimelineLayer'
import { TIMELINE_STATE_LABEL, type TimelineEvent } from './cashTimelineModel'
import type { DateRange, RangeSummary } from './cashRangeModel'
import { normalizeRange } from './cashRangeModel'
import { shortDate } from './commandCenterModel'
import { cashDate, money } from './cashOsUi'

const signedMoney = (minor: number) => `${minor < 0 ? '−' : minor > 0 ? '+' : ''}${money(Math.abs(minor))}`
const tone = (minor: number) => (minor < 0 ? 'var(--fin-negative)' : minor > 0 ? 'var(--fin-cash)' : undefined)

function Stat({ label, value, color, testId }: { label: string; value: string; color?: string; testId: string }) {
  return <div className="min-w-0" data-testid={testId}>
    <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{label}</span>
    <strong className="block break-words font-mono text-sm" style={{ color }}>{value}</strong>
  </div>
}

/**
 * Compact summary for the selected range. Every figure is read from the canonical projection rows (see cashRangeModel);
 * the events list stays collapsed until asked for. Nothing here is a second financial calculation.
 */
export function CashRangeSummary({ summary, selectedKey, onClear, onSelectEvent }: {
  summary: RangeSummary
  selectedKey: string | null
  onClear: () => void
  onSelectEvent: (date: string, key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const { range } = summary
  const sameDay = range.start === range.end
  const states = (['posted', 'projected', 'possible'] as const).filter(s => summary.byState[s] > 0)
  const chip = (event: TimelineEvent, date: string) => {
    const kind = event.direction === 'outflow' ? 'out' as const : 'in' as const
    return <button key={event.key} type="button" onClick={() => onSelectEvent(date, event.key)} aria-pressed={selectedKey === event.key}
      data-testid="range-event" data-source-key={event.key} data-state={event.state}
      className={`flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-1 text-left text-sm ring-1 ${selectedKey === event.key ? 'bg-white/10 ring-[var(--text-secondary)]' : 'ring-[var(--border-primary)] hover:bg-white/5'}`}>
      <DirectionBadge kind={kind} />
      <span className="min-w-0 flex-1 truncate font-semibold">{event.label}</span>
      <span className="font-mono" style={{ color: kind === 'out' ? 'var(--fin-negative)' : 'var(--fin-cash)' }}>{kind === 'out' ? '−' : '+'}{compactMoney(event.amountMinor)}</span>
      <span className="text-xs text-[var(--text-secondary)]">{TIMELINE_STATE_LABEL[event.state]}</span>
    </button>
  }
  return <section data-testid="range-summary" aria-label="Selected range summary" aria-live="polite" className="mt-3 rounded-lg bg-[var(--bg-secondary)] p-3">
    <div className="flex items-start justify-between gap-2">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]" data-testid="range-title">
        {shortDate(range.start)}{sameDay ? '' : ` → ${shortDate(range.end)}`} · {summary.dayCount} day{summary.dayCount === 1 ? '' : 's'} · {summary.eventCount} event{summary.eventCount === 1 ? '' : 's'}
      </p>
      <button type="button" onClick={onClear} aria-label="Clear selected range" data-testid="range-clear"
        className="-m-2 flex h-11 min-w-[44px] items-center justify-center rounded-lg px-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-white/10"><span aria-hidden="true">× </span>Clear</button>
    </div>
    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Stat testId="range-in" label="Money in" value={money(summary.moneyInMinor)} color={summary.moneyInMinor > 0 ? 'var(--fin-cash)' : undefined} />
      <Stat testId="range-out" label="Money out" value={money(summary.moneyOutMinor)} color={summary.moneyOutMinor > 0 ? 'var(--fin-negative)' : undefined} />
      <Stat testId="range-net" label={summary.netMinor < 0 ? 'Net (out)' : summary.netMinor > 0 ? 'Net (in)' : 'Net'} value={signedMoney(summary.netMinor)} color={tone(summary.netMinor)} />
      <Stat testId="range-opening" label="Opening" value={money(summary.openingCashMinor)} color={summary.openingCashMinor < 0 ? 'var(--fin-negative)' : undefined} />
      <Stat testId="range-closing" label="Closing" value={money(summary.closingCashMinor)} color={summary.closingCashMinor < 0 ? 'var(--fin-negative)' : undefined} />
      <Stat testId="range-lowest" label={`Lowest · ${shortDate(summary.lowestCashDate)}`} value={money(summary.lowestCashMinor)} color={summary.lowestCashMinor < 0 ? 'var(--fin-negative)' : undefined} />
    </div>
    {(states.length > 1 || summary.byState.possible > 0 || summary.unresolvedCount > 0) && <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="range-honesty">
      {states.length > 0 && states.map(s => `${summary.byState[s]} ${TIMELINE_STATE_LABEL[s].toLowerCase()}`).join(' · ')}
      {summary.byState.possible > 0 && ' (possible events are counted only because this view includes them)'}
      {summary.unresolvedCount > 0 && <span style={{ color: 'var(--fin-warning)' }}>{states.length > 0 ? ' · ' : ''}{summary.unresolvedCount} unresolved, not in these totals</span>}
    </p>}
    {summary.days.length > 0 && <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls="range-events-panel" data-testid="range-events-toggle"
      className="mt-2 min-h-[44px] w-full rounded-lg text-sm font-semibold text-[var(--text-secondary)] ring-1 ring-[var(--border-primary)] hover:bg-white/5">
      {open ? 'Hide events' : `Events in this range (${summary.eventCount + summary.unresolvedCount})`}</button>}
    {open && <div id="range-events-panel" data-testid="range-events" className="mt-2 space-y-3">
      {summary.days.map(day => <div key={day.date} data-date={day.date}>
        <p className="mb-1 text-xs font-bold text-[var(--text-secondary)]">{cashDate(day.date)}{day.events.length > 1 ? ' · same day, no order implied' : ''}</p>
        <div className="space-y-1">
          {day.events.map(event => chip(event, day.date))}
          {day.markers.map(marker => <button key={marker.key + marker.reason} type="button" onClick={() => onSelectEvent(day.date, marker.key)} aria-pressed={selectedKey === marker.key}
            data-testid="range-marker" data-source-key={marker.key}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-1 text-left text-sm ring-1 ring-[var(--border-primary)] hover:bg-white/5">
            <span aria-hidden="true" style={{ color: 'var(--fin-warning)' }}>◇</span><span className="font-semibold" style={{ color: 'var(--fin-warning)' }}>Unresolved</span><span className="truncate">{marker.label}</span>
          </button>)}
        </div>
      </div>)}
    </div>}
  </section>
}

/**
 * Non-drag path (keyboard, touch, narrow screens): two date pickers. Changing either one sets the range; the start/end
 * order is normalized, so picking an end before the start is still a valid range.
 */
export function CashRangeControls({ dates, range, fallbackDate, onChange, onDone }: {
  dates: readonly string[]
  range: DateRange | null
  fallbackDate: string
  onChange: (range: DateRange) => void
  onDone: () => void
}) {
  const start = range?.start ?? fallbackDate
  const end = range?.end ?? fallbackDate
  const select = (label: string, value: string, set: (v: string) => void, id: string) => <label className="flex items-center gap-2 text-sm" htmlFor={id}>
    <span className="text-[var(--text-secondary)]">{label}</span>
    <select id={id} value={value} onChange={e => set(e.target.value)} data-testid={id}
      className="min-h-[44px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] px-2 text-sm">
      {dates.map(d => <option key={d} value={d}>{cashDate(d)}</option>)}
    </select>
  </label>
  return <div data-testid="range-controls" role="group" aria-label="Select a date range" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-[var(--bg-secondary)] p-2">
    <span className="text-xs text-[var(--text-secondary)]">Range mode: drag across the graph, or choose dates.</span>
    {/* With no range yet, choosing a start begins a one-day range there (so the choice never jumps to the other box). */}
    {select('Start date', start, v => { const r = normalizeRange(dates, v, range ? end : v); if (r) onChange(r) }, 'range-start-select')}
    {select('End date', end, v => { const r = normalizeRange(dates, start, v); if (r) onChange(r) }, 'range-end-select')}
    <button type="button" onClick={onDone} className="min-h-[44px] rounded-lg px-4 text-sm font-semibold ring-1 ring-[var(--border-primary)] hover:bg-white/5" data-testid="range-done">Done</button>
  </div>
}
