import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CashOsSnapshot } from '@/finance/cashOsSnapshot'
import type { CashProjectionConfidenceMode, CashProjectionHorizon, DailyCashProjection } from '@/finance/cashProjectionTypes'
import type { CollectionClockEntry } from '@/finance/projectCollectionClockTypes'
import CashTrajectoryChart from './CashTrajectoryChart'
import CashStatusRow from './CashStatusRow'
import CashOsDetailsAccess from './CashOsDetailsAccess'
import type { DetailTab } from './commandCenterModel'
import { buildTimeline, eventKindLabel, linkFor, markerExplanation, movementState, resolveGraphTarget, TIMELINE_STATE_LABEL, type GraphLink } from './cashTimelineModel'
import { DirectionBadge } from './CashFlowTimelineLayer'
import { CashCard, CashEmpty, cashDate, money } from './cashOsUi'

export function CashCollectionClock({ snapshot }: { snapshot: CashOsSnapshot }) {
  function entries(rows: CollectionClockEntry[]) {
    return rows.length ? <div className="space-y-3">{rows.map(row => <div key={row.projectId} className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4">
      <div className="flex flex-wrap justify-between gap-2"><div><h4 className="font-semibold text-[var(--text-primary)]">{row.projectName}</h4>
        <p className="text-xs text-[var(--text-secondary)]">{row.nextCollection?.phase ?? 'Collection timing unknown'} · {cashDate(row.nextCollection?.expectedDate)}</p></div>
        <span className={`self-start rounded-full px-2 py-1 text-xs ${row.riskState === 'known_gap' ? 'bg-red-500/15 text-red-300' : row.riskState === 'coverage_unknown' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{row.riskState.replace(/_/g, ' ')}</span></div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
        <div><span className="block text-[var(--text-muted)]">Next collection</span>{money(row.nextCollection?.amountMinor)}</div>
        <div><span className="block text-[var(--text-muted)]">Required before</span>{money(row.requiredBeforeCollectionMinor)}</div>
        <div><span className="block text-[var(--text-muted)]">Reserved / covered</span>{money(row.reservedForRequiredCostsMinor)}</div>
        <div><span className="block text-[var(--text-muted)]">Funding gap</span><strong className={row.fundingGapMinor == null ? 'text-amber-300' : ''}>{money(row.fundingGapMinor)}</strong></div>
        <div><span className="block text-[var(--text-muted)]">Confidence</span>{row.nextCollection?.confidence ?? 'Unknown'}</div>
      </div><p className="mt-3 text-xs text-[var(--text-secondary)]">Coverage: {row.coverageStatus.replace(/_/g, ' ')}</p>
    </div>)}</div> : <CashEmpty>No projects in this group.</CashEmpty>
  }
  return <CashCard title="Collection Clock"><h4 className="mb-3 text-sm font-semibold">Active funding</h4>{entries(snapshot.collectionClock.activeFunding)}
    <h4 className="mb-3 mt-6 text-sm font-semibold">Collection follow-up</h4>{entries(snapshot.collectionClock.collectionFollowUp)}</CashCard>
}

const signed = (direction: 'inflow' | 'outflow', minor: number) => `${direction === 'outflow' ? '−' : '+'}${money(minor)}`

const sectionLabel = 'mb-2 mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]'

/**
 * Financial inspector for one day: Opening → Events → Day movement → Protection → Unresolved (only if any).
 * Daily view only: the projection has no time of day, so same-day events are a set with no implied order.
 * Internal identifiers (source keys, record ids) are never rendered; they stay on data attributes for linking.
 */
export function CashDayDetail({ day, compact = false, selectedKey = null }: { day: DailyCashProjection; compact?: boolean; selectedKey?: string | null }) {
  const net = day.inflowMinor - day.outflowMinor
  const metric = (label: string, value: string, strong = false) => <div key={label} className="min-w-0">
    <span className="block text-xs text-[var(--text-secondary)]">{label}</span>
    <strong className={`block break-words font-mono ${strong ? 'text-base' : 'text-sm'}`}>{value}</strong>
  </div>
  const grid = `grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`
  return <CashCard title={`Why? · ${cashDate(day.date)}`} className="h-full" >
    <div data-testid="day-detail" data-date={day.date}>
    {metric('Opening', money(day.openingCashMinor), true)}
    <h4 className={sectionLabel}>Events</h4>
    {day.events.length ? <div className="space-y-2">{day.events.map(event => {
      const selected = selectedKey === event.sourceKey
      const kind = event.direction === 'outflow' ? 'out' as const : 'in' as const
      const context = [eventKindLabel(event.sourceType), event.category].filter((v): v is string => !!v).join(' · ')
      const state = movementState(event)
      return <div key={event.sourceKey} data-testid="day-event" data-source-key={event.sourceKey} data-selected={selected || undefined}
        className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 ${selected ? 'border-[var(--text-secondary)] bg-white/10' : 'border-[var(--border-primary)]'}`}>
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5"><DirectionBadge kind={kind} /></span>
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold">{event.label}</p>
            {context && <p className="text-xs text-[var(--text-secondary)]">{context}</p>}
            <p className="text-xs text-[var(--text-secondary)]">{TIMELINE_STATE_LABEL[state]}{event.confidence !== 'confirmed' && state !== 'possible' ? ` · ${event.confidence}` : ''}</p>
          </div>
        </div>
        <strong className="shrink-0 font-mono text-sm" style={{ color: kind === 'out' ? 'var(--fin-negative)' : 'var(--fin-cash)' }}>{signed(event.direction, event.amountMinor)}</strong>
      </div>
    })}
      {day.events.length > 1 && <p className="text-xs text-[var(--text-secondary)]">These happen on the same day. No time of day is recorded, so no order is implied.</p>}
    </div> : <CashEmpty>No dated money movements on this day.</CashEmpty>}
    <h4 className={sectionLabel}>Day movement</h4>
    <div className={grid}>
      {metric('Money in', money(day.inflowMinor))}
      {metric('Money out', money(day.outflowMinor))}
      {metric(net < 0 ? 'Net movement (out)' : net > 0 ? 'Net movement (in)' : 'Net movement', `${net < 0 ? '−' : net > 0 ? '+' : ''}${money(Math.abs(net))}`, true)}
      {metric('Closing', money(day.closingCashMinor), true)}
    </div>
    <h4 className={sectionLabel}>Protection</h4>
    <div className={grid}>
      {metric('Required', money(day.totalProtectedRequirementMinor))}
      {metric('Protected', money(day.protectedCashMinor))}
      {metric('Free', money(day.trulyFreeCashMinor))}
      {metric('Deficit', money(day.protectionDeficitMinor))}
    </div>
    {day.markers.length > 0 && <>
      <h4 className={sectionLabel} style={{ color: 'var(--fin-warning)' }}>Unresolved</h4>
      <ul className="space-y-2 text-xs" data-testid="day-markers">{day.markers.filter(m => m.reason !== 'source_overlap').map(marker => <li key={`${marker.sourceKey}:${marker.reason}`} data-testid="day-marker"
        data-source-key={marker.sourceKey} data-selected={selectedKey === marker.sourceKey || undefined}
        className={`rounded-lg border border-dashed px-3 py-2 ${selectedKey === marker.sourceKey ? 'bg-white/10' : ''}`} style={{ borderColor: 'var(--fin-warning)' }}>
        <span className="block text-sm font-semibold">{marker.label}{marker.amountMinor != null ? <span className="ml-2 font-mono font-normal text-[var(--text-secondary)]">{money(marker.amountMinor)}</span> : null}</span>
        <span className="block text-[var(--text-secondary)]">{markerExplanation(marker.reason, marker.semanticCode)} It has no effect on projected cash.</span>
      </li>)}</ul>
    </>}
    </div>
  </CashCard>
}

export function CashUpcomingEvents({ snapshot }: { snapshot: CashOsSnapshot }) {
  const projection = snapshot.projection
  const events = projection.datedEvents.slice(0, 12)
  return <CashCard title="Upcoming cash events">
    {events.length ? <div className="space-y-2">{events.map(event => <div key={event.sourceKey} className="flex justify-between gap-3 border-b border-[var(--border-primary)] py-2 text-sm">
      <div><span className="font-semibold">{event.label}</span><span className="block text-xs text-[var(--text-secondary)]">{cashDate(event.date)} · {event.confidence} · {event.category ?? event.sourceType}</span></div>
      <span className="whitespace-nowrap font-mono">{event.direction === 'outflow' ? '−' : '+'}{money(event.amountMinor)}</span>
    </div>)}</div> : <CashEmpty>No dated events in this horizon.</CashEmpty>}
    {(projection.datedMarkers.length > 0 || projection.undatedMarkers.length > 0) && <div className="mt-5">
      <h4 className="mb-2 text-sm font-semibold text-amber-300">Unresolved</h4>
      {[...projection.datedMarkers, ...projection.undatedMarkers].slice(0, 12).map(marker => <p key={`${marker.sourceKey}:${marker.reason}`} className="border-b border-[var(--border-primary)] py-2 text-xs">
        {marker.label} · {marker.date ? cashDate(marker.date) : 'Date unknown'} · {marker.amountMinor == null ? 'Amount unknown' : money(marker.amountMinor)} · {marker.semanticCode === 'payment_timing_unknown' ? 'Payment timing unknown' : marker.reason.replace(/_/g, ' ')}
      </p>)}</div>}
  </CashCard>
}

export default function CashOsOutlook({ snapshot, horizonDays, confidenceMode, onHorizon, onConfidence, afterGraph, cashSourceNote, onNavigate }: {
  snapshot: CashOsSnapshot
  horizonDays: CashProjectionHorizon
  confidenceMode: CashProjectionConfidenceMode
  onHorizon: (value: CashProjectionHorizon) => void
  onConfidence: (value: CashProjectionConfidenceMode) => void
  /** Rendered directly below the graph + selected-day detail. May be a function to receive the graph ↔ command-center link. */
  afterGraph?: ReactNode | ((link: GraphLink) => ReactNode)
  /** Optional provenance for the Cash I Have card (e.g. "Manual"; future bank sync age). */
  cashSourceNote?: ReactNode
  /** Opens a detailed Cash OS tab from the Details access point. */
  onNavigate?: (tab: DetailTab) => void
}) {
  const { projection } = snapshot
  // One shared selection: a date, optionally narrowed to one canonical event/marker (by source key).
  const [selection, setSelection] = useState<{ date: string; key: string | null }>({ date: snapshot.asOfDate, key: null })
  const selectedDate = selection.date
  const setSelectedDate = useCallback((date: string) => setSelection({ date, key: null }), [])
  const selectEvent = useCallback((date: string, key: string) => setSelection({ date, key }), [])
  useEffect(() => {
    if (![projection.anchor, ...projection.days].some(day => day.date === selectedDate)) setSelection({ date: snapshot.asOfDate, key: null })
  }, [projection, selectedDate, snapshot.asOfDate])
  const timeline = useMemo(() => buildTimeline(projection), [projection])
  const graphLink = useMemo<GraphLink>(() => ({
    highlight: linkFor(timeline, selection),
    onRowSelect: refs => { const target = resolveGraphTarget(timeline, refs); if (target) setSelection({ date: target.date, key: target.key }) },
  }), [timeline, selection])
  const day = [projection.anchor, ...projection.days].find(row => row.date === selectedDate) ?? projection.anchor
  const anchor = projection.anchor
  return <div className="space-y-5">
    <CashStatusRow
      values={{ cashMinor: anchor.closingCashMinor, protectedMinor: anchor.protectedCashMinor,
        freeMinor: anchor.trulyFreeCashMinor, shortMinor: anchor.protectionDeficitMinor }}
      sourceNote={cashSourceNote}
      info={`${anchor.operatingFloorMinor != null ? `Your operating floor of ${money(anchor.operatingFloorMinor)} is already included in what is set aside. ` : ''}Money you may collect later is not part of these numbers.`} />
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_21rem]" data-testid="graph-and-day">
      <CashTrajectoryChart projection={projection} horizonDays={horizonDays} confidenceMode={confidenceMode}
        onHorizon={onHorizon} onConfidence={onConfidence} selectedDate={selectedDate} onSelectDate={setSelectedDate}
        selectedKey={selection.key} onSelectEvent={selectEvent} timeline={timeline} />
      <CashDayDetail day={day} compact selectedKey={selection.key} />
    </div>
    {typeof afterGraph === 'function' ? afterGraph(graphLink) : afterGraph}
    <CashOsDetailsAccess totalCashMinor={anchor.closingCashMinor} onNavigate={onNavigate} />
  </div>
}
