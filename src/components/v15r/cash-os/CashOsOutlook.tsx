import { useEffect, useState } from 'react'
import type { CashOsSnapshot } from '@/finance/cashOsSnapshot'
import type { CashProjectionConfidenceMode, CashProjectionHorizon, DailyCashProjection } from '@/finance/cashProjectionTypes'
import type { CollectionClockEntry } from '@/finance/projectCollectionClockTypes'
import type { CashOsBucket, CashOsEnvelope, CashOsEnvelopeBalance } from '@/finance/cashOsAllocationTypes'
import { listCashOsBuckets, listCashOsEnvelopes, readEnvelopeBalances } from '@/services/cashOsAllocationService'
import CashTrajectoryChart from './CashTrajectoryChart'
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

export function CashDayDetail({ day }: { day: DailyCashProjection }) {
  const metrics = [
    ['Opening', day.openingCashMinor], ['Inflows', day.inflowMinor], ['Outflows', day.outflowMinor],
    ['Closing Cash', day.closingCashMinor], ['Protected requirement', day.totalProtectedRequirementMinor],
    ['Protected Cash', day.protectedCashMinor], ['Truly Free', day.trulyFreeCashMinor],
    ['Protection deficit', day.protectionDeficitMinor],
  ] as const
  return <CashCard title={`Why? · ${cashDate(day.date)}`}>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{metrics.map(([label, minor]) => <div key={label}>
      <span className="block text-xs text-[var(--text-muted)]">{label}</span><strong className="font-mono text-sm">{money(minor)}</strong>
    </div>)}</div>
    <h4 className="mb-2 mt-5 text-sm font-semibold">Canonical events</h4>
    {day.events.length ? <div className="space-y-2">{day.events.map(event => <div key={event.sourceKey} className="flex flex-wrap justify-between gap-2 border-b border-[var(--border-primary)] py-2 text-sm">
      <div><span>{event.label}</span><span className="ml-2 text-xs text-[var(--text-muted)]">{event.category ?? 'Uncategorized'} · {event.confidence}</span>
        <span className="block break-all text-[10px] text-[var(--text-muted)]">{event.sourceKey}{event.attribution.projectId ? ` · Project ${event.attribution.projectId}` : ''}</span></div>
      <strong className="font-mono">{event.direction === 'outflow' ? '−' : '+'}{money(event.amountMinor)}</strong>
    </div>)}</div> : <CashEmpty>No dated money movements on this day.</CashEmpty>}
    <h4 className="mb-2 mt-5 text-sm font-semibold">Unresolved markers</h4>
    {day.markers.length ? <ul className="space-y-2 text-xs text-amber-300">{day.markers.map(marker => <li key={`${marker.sourceKey}:${marker.reason}`}>
      {marker.label} · {marker.semanticCode === 'payment_timing_unknown' ? 'Payment timing unknown' : marker.reason.replace(/_/g, ' ')} · {money(marker.amountMinor)}
    </li>)}</ul> : <CashEmpty>No unresolved markers on this day.</CashEmpty>}
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

function CashMoneyPlan() {
  const [buckets, setBuckets] = useState<CashOsBucket[]>([])
  const [envelopes, setEnvelopes] = useState<CashOsEnvelope[]>([])
  const [balances, setBalances] = useState<CashOsEnvelopeBalance[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    Promise.all([listCashOsBuckets(), listCashOsEnvelopes(), readEnvelopeBalances()])
      .then(([b, e, bal]) => { setBuckets(b); setEnvelopes(e); setBalances(bal) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  if (loading) return null
  const balanceMap = new Map(balances.map(b => [b.envelopeId, b]))
  const unallocatedTotal = balances.reduce((sum, b) => sum + b.balanceMinor, 0)
  return <CashCard title="Money Plan">
    <div className="grid gap-5 sm:grid-cols-2">
      <div>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Buckets</h4>
        {buckets.length ? <div className="space-y-2">{buckets.map(bucket => {
          const bucketEnvelopes = envelopes.filter(e => e.bucketId === bucket.id)
          const bucketTotal = bucketEnvelopes.reduce((sum, e) => sum + (balanceMap.get(e.id)?.balanceMinor ?? 0), 0)
          return <div key={bucket.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-primary)] px-3 py-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              {bucket.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: bucket.color }} />}
              <span className="truncate font-medium">{bucket.name}</span>
              <span className="shrink-0 text-xs text-[var(--text-muted)]">{bucketEnvelopes.length} envelope{bucketEnvelopes.length !== 1 ? 's' : ''}</span>
            </div>
            <span className="shrink-0 font-mono text-xs">{money(bucketTotal)}</span>
          </div>
        })}</div> : <CashEmpty>No buckets yet.</CashEmpty>}
      </div>
      <div>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Envelopes</h4>
        {envelopes.length ? <div className="space-y-2">{envelopes.map(env => {
          const bal = balanceMap.get(env.id)
          const balance = bal?.balanceMinor ?? 0
          const hasTarget = env.targetAmountMinor != null
          const pct = hasTarget && env.targetAmountMinor! > 0 ? Math.min(100, Math.round((balance / env.targetAmountMinor!) * 100)) : null
          return <div key={env.id} className="rounded-lg border border-[var(--border-primary)] px-3 py-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="truncate font-medium">{env.name}</span>
              <span className="shrink-0 font-mono text-xs">{money(balance)}{hasTarget ? ` / ${money(env.targetAmountMinor)}` : ''}</span>
            </div>
            {pct !== null && <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--border-primary)]">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
            </div>}
          </div>
        })}</div> : <CashEmpty>No envelopes yet.</CashEmpty>}
        {envelopes.length > 0 && <p className="mt-3 text-xs text-[var(--text-muted)]">Total allocated: {money(unallocatedTotal)}</p>}
      </div>
    </div>
  </CashCard>
}

export default function CashOsOutlook({ snapshot, horizonDays, confidenceMode, onHorizon, onConfidence }: {
  snapshot: CashOsSnapshot
  horizonDays: CashProjectionHorizon
  confidenceMode: CashProjectionConfidenceMode
  onHorizon: (value: CashProjectionHorizon) => void
  onConfidence: (value: CashProjectionConfidenceMode) => void
}) {
  const { projection } = snapshot
  const [selectedDate, setSelectedDate] = useState(snapshot.asOfDate)
  useEffect(() => {
    if (![projection.anchor, ...projection.days].some(day => day.date === selectedDate)) setSelectedDate(snapshot.asOfDate)
  }, [projection, selectedDate, snapshot.asOfDate])
  const day = [projection.anchor, ...projection.days].find(row => row.date === selectedDate) ?? projection.anchor
  const covered = projection.summary.daysCovered
  const metrics = [
    ['TOTAL CASH', money(projection.anchor.closingCashMinor)],
    ['PROTECTED', money(projection.anchor.protectedCashMinor)],
    ['TRULY FREE', money(projection.anchor.trulyFreeCashMinor)],
    ['14-DAY LOW', money(projection.summary.fourteenDayLowestTotalCashMinor)],
    ['DAYS COVERED', `${covered.days}${covered.bounded ? '+' : ''} days`],
  ] as const
  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{metrics.map(([label, value]) => <div key={label}
      className={`min-w-0 rounded-xl border p-4 ${label === 'TRULY FREE' ? 'col-span-2 border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 to-[var(--bg-card)] md:col-span-1' : 'border-[var(--border-primary)] bg-[var(--bg-card)]'}`}>
      <span className="block text-[10px] font-bold tracking-[0.16em] text-[var(--text-secondary)]">{label}</span>
      <strong className={`mt-2 block break-words font-mono ${label === 'TRULY FREE' ? 'text-3xl text-emerald-300' : 'text-xl sm:text-2xl'}`}>{value}</strong>
      {label === 'DAYS COVERED' && covered.bounded && <span className="mt-1 block text-[10px] text-[var(--text-muted)]">No breach inside selected horizon</span>}
    </div>)}</div>
    <CashTrajectoryChart projection={projection} horizonDays={horizonDays} confidenceMode={confidenceMode}
      onHorizon={onHorizon} onConfidence={onConfidence} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
    <CashMoneyPlan />
    <div className="grid gap-5 xl:grid-cols-2"><CashCollectionClock snapshot={snapshot} /><CashUpcomingEvents snapshot={snapshot} /></div>
    <CashDayDetail day={day} />
  </div>
}
