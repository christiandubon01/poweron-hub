import type { CSSProperties } from 'react'
import { TIMELINE_STATE_LABEL, type Timeline, type TimelineCluster, type TimelineDay, type TimelineEvent, type TimelineState } from './cashTimelineModel'
import type { Walkthrough } from './useCashFlowWalkthrough'
import { cashDate, money } from './cashOsUi'
import { inRange, type DateRange } from './cashRangeModel'

/** Plot rectangle of CashTrajectoryChart (margins + axes), so overlay fractions line up with the date axis. */
export const PLOT_INSET = { left: 86, right: 18, top: 15, bottom: 40 } as const
/** Vertical position of the timeline rail, as a fraction of the plot height (inside the reserved lower band). */
export const RAIL_TOP = 0.8
/** Visual stem length between the rail and the event capsule. */
const STEM = 8

type Kind = 'in' | 'out'
const TONE: Record<Kind, { color: string; border: string; tint: string }> = {
  in: { color: 'var(--fin-cash)', border: 'var(--fin-cash-border)', tint: 'var(--fin-cash-tint)' },
  out: { color: 'var(--fin-negative)', border: 'var(--fin-negative-border)', tint: 'var(--fin-negative-tint)' },
}
const WARN = 'var(--fin-warning)'

export function compactMoney(minor: number): string {
  return money(Math.abs(minor)).replace(/\.00$/, '')
}
const signed = (kind: Kind, minor: number) => `${kind === 'out' ? '−' : '+'}${compactMoney(minor)}`

function leastCertain(states: TimelineState[]): TimelineState {
  if (states.includes('pending')) return 'pending'
  if (states.includes('possible')) return 'possible'
  if (states.includes('projected')) return 'projected'
  return 'posted'
}
function stateOf(days: TimelineDay[]): TimelineState {
  const states = days.flatMap(d => d.events.map(e => e.state))
  return states.length ? leastCertain(states) : 'projected'
}

/** Border style carries certainty: solid = posted, thin outline = projected, dashed = possible/pending. */
function surface(kind: Kind, state: TimelineState): CSSProperties {
  const tone = TONE[kind]
  return {
    color: tone.color,
    background: `linear-gradient(0deg, ${tone.tint}, ${tone.tint}), var(--bg-card)`,
    border: state === 'posted' ? `1.5px solid ${tone.color}` : state === 'possible' || state === 'pending' ? `1px dashed ${tone.color}` : `1px solid ${tone.border}`,
  }
}

/** Small direction badge (arrow in a rounded square) used by chips. Shape + sign + color, never color alone. */
export function DirectionBadge({ kind }: { kind: Kind }) {
  const tone = TONE[kind]
  return <span aria-hidden="true" className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md" style={{ color: tone.color, background: tone.tint, border: `1px solid ${tone.border}` }}>
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      {kind === 'in' ? <path d="M5 8.5V1.8M2 4.5 5 1.5l3 3" /> : <path d="M5 1.5v6.7M2 5.5 5 8.5l3-3" />}
    </svg>
  </span>
}

function clusterAria(cluster: TimelineCluster): string {
  const first = cluster.days[0]
  const when = cluster.days.length === 1 ? cashDate(first.date) : `${cashDate(first.date)} to ${cashDate(cluster.days[cluster.days.length - 1].date)}`
  const parts: string[] = []
  if (cluster.eventCount) parts.push(`${cluster.eventCount} cash event${cluster.eventCount === 1 ? '' : 's'}`)
  if (cluster.inflowMinor > 0) parts.push(`money in ${money(cluster.inflowMinor)}`)
  if (cluster.outflowMinor > 0) parts.push(`money out ${money(cluster.outflowMinor)}`)
  if (cluster.markerCount) parts.push(`${cluster.markerCount} unresolved item${cluster.markerCount === 1 ? '' : 's'}`)
  return `${when}: ${parts.join(', ')}. Select to inspect.`
}

/**
 * One side of a marker (money in above the rail, money out below it): a short stem and a compact capsule.
 * Resting: the signed amount (or just a sign when labels would collide). Selected/active: an owner-facing card
 * with the event name, signed amount and state. No identifiers are ever rendered here.
 */
function Side({ kind, cluster, state, minor, showAmount, expanded, shift }: {
  kind: Kind; cluster: TimelineCluster; state: TimelineState; minor: number; showAmount: boolean; expanded: boolean; shift: number
}) {
  const tone = TONE[kind]
  const single = cluster.days.length === 1 && cluster.days[0].events.length === 1 ? cluster.days[0].events[0] : null
  const placeAbove = kind === 'in'
  const pos: CSSProperties = placeAbove ? { bottom: `calc(50% + ${STEM}px)` } : { top: `calc(50% + ${STEM}px)` }
  const shiftStyle: CSSProperties = { left: '50%', transform: `translateX(${shift}%)` }
  const word = kind === 'in' ? 'in' : 'out'
  return <>
    <span aria-hidden="true" className="absolute left-1/2 w-px" style={{ background: tone.color, height: STEM, [placeAbove ? 'bottom' : 'top']: '50%', opacity: expanded ? 1 : 0.75 }} />
    {expanded ? <span data-testid="timeline-selected-card" data-kind={kind} className="absolute z-20 max-w-[190px] rounded-lg px-2 py-1 text-left shadow-lg"
      style={{ ...pos, ...shiftStyle, ...surface(kind, state), minWidth: 84, boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
      <span className="block truncate text-[11px] font-semibold text-[var(--text-primary)]">
        {single ? single.label : `${cluster.eventCount} event${cluster.eventCount === 1 ? '' : 's'}${cluster.days.length > 1 ? ` · ${cluster.days.length} dates` : ''}`}</span>
      <span className="block whitespace-nowrap font-mono text-[11px] font-semibold">{signed(kind, minor)}
        <span className="ml-1 font-sans font-normal text-[var(--text-secondary)]">{single ? TIMELINE_STATE_LABEL[single.state] : word}</span></span>
    </span>
    : showAmount ? <span data-testid="timeline-capsule" data-kind={kind} className="absolute whitespace-nowrap rounded-full px-1.5 font-mono text-[11px] font-semibold leading-[16px]"
      style={{ ...pos, ...shiftStyle, ...surface(kind, state) }}>{signed(kind, minor)}</span>
    : <span data-testid="timeline-node" data-kind={kind} aria-hidden="true" className="absolute flex h-[12px] w-[16px] items-center justify-center rounded-full text-[9px] font-bold leading-none"
      style={{ ...pos, ...shiftStyle, ...surface(kind, state) }}>{kind === 'in' ? '+' : '−'}</span>}
  </>
}

function Marker({ cluster, selected, active, rangeState, onSelect }: {
  cluster: TimelineCluster; selected: boolean; active: boolean; rangeState: 'inside' | 'outside' | null; onSelect: (cluster: TimelineCluster) => void
}) {
  const up = cluster.inflowMinor > 0
  const down = cluster.outflowMinor > 0
  const markersOnly = cluster.eventCount === 0
  const state = stateOf(cluster.days)
  const emphasized = selected || active
  const showAmount = cluster.showLabel || emphasized
  // Keep wide capsules/cards inside the plot at the edges.
  const shift = cluster.frac < 0.12 ? -15 : cluster.frac > 0.88 ? -85 : -50
  // Hierarchy: resting < inside the selected range (soft glow) < individually selected (existing expanded card).
  const style: CSSProperties = { left: `${cluster.frac * 100}%`, top: `${RAIL_TOP * 100}%`,
    ...(rangeState === 'outside' && !emphasized ? { opacity: 0.45 } : {}),
    ...(rangeState === 'inside' && !emphasized ? { filter: 'drop-shadow(0 0 3px rgba(125,211,252,0.75))' } : {}) }
  return <button type="button" onClick={() => onSelect(cluster)} data-range={rangeState ?? undefined} aria-label={clusterAria(cluster)} aria-pressed={selected}
    data-testid="timeline-marker" data-marker-style="capsule" data-cluster-id={cluster.id} data-date={cluster.days[0].date} data-selected={selected || undefined} data-active={active || undefined}
    data-resting={showAmount ? 'amount' : 'node'}
    data-direction={up && down ? 'mixed' : up ? 'inflow' : down ? 'outflow' : 'unresolved'} data-state={markersOnly ? 'uncertain' : state}
    className={`pointer-events-auto absolute h-[88px] w-11 -translate-x-1/2 -translate-y-1/2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sky-300 motion-reduce:transition-none ${emphasized ? 'z-20' : ''}`}
    style={style}>
    <span aria-hidden="true" className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-secondary)]"
      style={{ boxShadow: emphasized ? '0 0 0 4px rgba(148,163,184,0.25)' : undefined, transition: 'box-shadow 200ms' }} />
    {up && <Side kind="in" cluster={cluster} state={state} minor={cluster.inflowMinor} showAmount={showAmount} expanded={emphasized} shift={shift} />}
    {down && <Side kind="out" cluster={cluster} state={state} minor={cluster.outflowMinor} showAmount={showAmount} expanded={emphasized} shift={shift} />}
    {cluster.eventCount > 1 && !emphasized && <span aria-hidden="true" data-testid="timeline-count" className="absolute right-0 top-[calc(50%-9px)] rounded-full bg-[var(--bg-secondary)] px-1 text-[10px] font-bold text-[var(--text-primary)] ring-1 ring-[var(--border-primary)]">{cluster.eventCount}</span>}
    {markersOnly && <>
      <span aria-hidden="true" data-testid="timeline-uncertain" className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 bg-[var(--bg-card)]"
        style={{ borderColor: WARN, transform: `translate(-50%,-50%) rotate(45deg) scale(${emphasized ? 1.3 : 1})`, transition: 'transform 200ms' }} />
      {emphasized && <span data-testid="timeline-selected-card" data-kind="unresolved" className="absolute z-20 max-w-[190px] rounded-lg px-2 py-1 text-left"
        style={{ top: 'calc(50% + 12px)', left: '50%', transform: `translateX(${shift}%)`, color: WARN, border: `1px dashed ${WARN}`, background: 'var(--bg-card)', boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
        <span className="block text-[11px] font-semibold">Unresolved</span>
        <span className="block truncate text-[11px] text-[var(--text-primary)]">{cluster.days[0].markers[0]?.label ?? 'Needs a look'}</span>
      </span>}
    </>}
    {!markersOnly && cluster.markerCount > 0 && <span aria-hidden="true" data-testid="timeline-uncertain" className="absolute left-[calc(50%+6px)] top-[calc(50%-4px)] h-2 w-2 rotate-45 border-[1.5px] bg-[var(--bg-card)]" style={{ borderColor: WARN }} />}
  </button>
}

/** The animated pulse. Travel is a CSS transition set once per leg, so nothing re-renders per frame. */
function Orb({ walk }: { walk: Walkthrough }) {
  if (walk.phase !== 'running' || walk.orbFrac == null) return null
  return <span aria-hidden="true" data-testid="walkthrough-orb" data-frac={walk.orbFrac}
    className="pointer-events-none absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full motion-reduce:hidden"
    style={{ left: `${walk.orbFrac * 100}%`, top: `${RAIL_TOP * 100}%`, background: 'radial-gradient(circle, #fff 0%, var(--fin-protected) 55%, transparent 75%)',
      boxShadow: '0 0 14px 4px rgba(125,211,252,0.55)', transition: `left ${walk.travelMs}ms ease-in-out` }} />
}

/** Event layer drawn over the chart's plot area. Presentation only. */
export function CashFlowTimelineOverlay({ timeline, selectedDate, walk, onSelectCluster, range = null }: {
  timeline: Timeline
  selectedDate: string
  walk: Walkthrough
  onSelectCluster: (cluster: TimelineCluster) => void
  /** Selected date range, if any: markers inside get a soft emphasis, markers outside are slightly de-emphasized. */
  range?: DateRange | null
}) {
  const activeDate = walk.activeId
  return <div role="group" aria-label="Cash events timeline" data-testid="timeline-layer" className="pointer-events-none absolute"
    style={{ left: PLOT_INSET.left, right: PLOT_INSET.right, top: PLOT_INSET.top, bottom: PLOT_INSET.bottom }}>
    <div aria-hidden="true" className="absolute left-0 right-0 border-t border-dashed border-[var(--border-primary)]" style={{ top: `${RAIL_TOP * 100}%` }} />
    <span aria-hidden="true" className="absolute left-0 text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]" style={{ top: `calc(${RAIL_TOP * 100}% + 38px)` }}>Today</span>
    {timeline.clusters.map(cluster => <Marker key={cluster.id} cluster={cluster}
      selected={cluster.days.some(d => d.date === selectedDate)}
      active={!!activeDate && cluster.days.some(d => d.date === activeDate)}
      rangeState={range ? (cluster.days.some(d => inRange(d.date, range)) ? 'inside' : 'outside') : null} onSelect={onSelectCluster} />)}
    <Orb walk={walk} />
  </div>
}

function EventChip({ event, selected, onSelect }: { event: TimelineEvent; selected: boolean; onSelect: () => void }) {
  const kind: Kind = event.direction === 'outflow' ? 'out' : 'in'
  return <button type="button" onClick={onSelect} aria-pressed={selected} data-testid="timeline-event-chip" data-source-key={event.key}
    data-direction={event.direction} data-state={event.state}
    className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-1 text-sm ring-1 ${selected ? 'bg-white/10 ring-[var(--text-secondary)]' : 'ring-[var(--border-primary)] hover:bg-white/5'}`}>
    <DirectionBadge kind={kind} />
    <span className="font-semibold">{event.label}</span>
    <span className="font-mono" style={{ color: TONE[kind].color }}>{signed(kind, event.amountMinor)}</span>
    <span className="text-xs text-[var(--text-secondary)]">{TIMELINE_STATE_LABEL[event.state]}</span>
  </button>
}

/**
 * Compact selection strip under the chart: the selected date's events as a SET (no order implied), its
 * unresolved items, and the other dates grouped into the same cluster. It coordinates with the day inspector;
 * the inspector remains the detailed explanation.
 */
export function CashFlowSelectionStrip({ timeline, selectedDate, selectedKey, onSelectDay, onSelectEvent }: {
  timeline: Timeline
  selectedDate: string
  selectedKey: string | null
  onSelectDay: (date: string) => void
  onSelectEvent: (date: string, key: string) => void
}) {
  const day = timeline.days.find(d => d.date === selectedDate)
  const cluster = timeline.clusters.find(c => c.days.some(d => d.date === selectedDate))
  if (!day || !cluster) return null
  const markerSelected = day.markers.find(m => m.key === selectedKey)
  return <div data-testid="timeline-selection" aria-live="polite" className="mt-3 rounded-lg bg-[var(--bg-secondary)] p-3">
    <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">
      {cashDate(day.date)} · {day.events.length} event{day.events.length === 1 ? '' : 's'}
      {day.events.length > 0 && <> · Net {day.netMinor < 0 ? '−' : day.netMinor > 0 ? '+' : ''}{compactMoney(day.netMinor)}</>}
    </p>
    {day.events.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
      {day.events.map(event => <EventChip key={event.key} event={event} selected={selectedKey === event.key} onSelect={() => onSelectEvent(day.date, event.key)} />)}
    </div>}
    {day.events.length > 1 && <p className="mt-2 text-xs text-[var(--text-secondary)]">Same day. No time of day is recorded, so no order is implied.</p>}
    {day.markers.length > 0 && <div className="mt-2 space-y-1" data-testid="timeline-markers">
      {day.markers.map(marker => <button key={marker.key + marker.reason} type="button" onClick={() => onSelectEvent(day.date, marker.key)} aria-pressed={selectedKey === marker.key}
        data-testid="timeline-marker-chip" data-source-key={marker.key}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-1 text-left text-sm ring-1 ring-[var(--border-primary)] hover:bg-white/5">
        <span aria-hidden="true" style={{ color: WARN }}>◇</span><span className="font-semibold" style={{ color: WARN }}>Unresolved</span>
        <span>{marker.label}</span>
      </button>)}
      {markerSelected && <p className="text-xs text-[var(--text-secondary)]" data-testid="timeline-marker-text">{markerSelected.text} It has no effect on projected cash.</p>}
    </div>}
    {cluster.days.length > 1 && <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="timeline-cluster-days">
      <span className="text-xs text-[var(--text-secondary)]">Dates grouped here:</span>
      {cluster.days.map(d => <button key={d.date} type="button" onClick={() => onSelectDay(d.date)} aria-pressed={d.date === selectedDate} data-date={d.date}
        className={`min-h-[44px] rounded-lg px-3 text-sm ring-1 ${d.date === selectedDate ? 'bg-white/10 ring-[var(--text-secondary)]' : 'ring-[var(--border-primary)] hover:bg-white/5'}`}>
        {cashDate(d.date).replace(/, \d{4}$/, '')}{d.events.length ? ` · ${d.events.length}` : ' · !'}</button>)}
    </div>}
  </div>
}
