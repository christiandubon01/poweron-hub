import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceDot } from 'recharts'
import type { CashProjectionResult, CashProjectionConfidenceMode, CashProjectionHorizon } from '@/finance/cashProjectionTypes'
import { CashCard, cashDate, money } from './cashOsUi'
import { buildTimeline, dataTicks, eventBandDomain, selectionEmphasis, type Timeline, type TimelineCluster } from './cashTimelineModel'
import { CashFlowSelectionStrip, CashFlowTimelineOverlay } from './CashFlowTimelineLayer'
import { CashRangePlot } from './CashRangeLayer'
import { CashRangeControls, CashRangeSummary } from './CashRangeSummary'
import { inRange, summarizeRange, type DateRange } from './cashRangeModel'
import { usePrefersReducedMotion, useCashFlowWalkthrough, type WalkStop } from './useCashFlowWalkthrough'

const TOTAL = '#38bdf8'
const FREE = '#34d399'
const PROTECT = '#fbbf24'
const IN_HEX = '#34d399'
const OUT_HEX = '#f87171'

function Legend() {
  const item = 'inline-flex items-center gap-1.5'
  return <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]" data-testid="graph-legend">
    <span className={item}><span aria-hidden="true" className="inline-block h-0.5 w-5" style={{ background: TOTAL }} />Total Cash</span>
    <span className={item}><span aria-hidden="true" className="inline-block h-0.5 w-5" style={{ background: FREE }} />Truly Free</span>
    <span className={item}><span aria-hidden="true" className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: PROTECT }} />Required protection</span>
    <span className={item}><span aria-hidden="true" className="rounded-full px-1.5 font-mono text-[10px] font-semibold" style={{ color: IN_HEX, border: `1px solid ${IN_HEX}` }}>+$</span>Money in</span>
    <span className={item}><span aria-hidden="true" className="rounded-full px-1.5 font-mono text-[10px] font-semibold" style={{ color: OUT_HEX, border: `1px solid ${OUT_HEX}` }}>−$</span>Money out</span>
    <span className={item}><span aria-hidden="true" style={{ color: PROTECT }}>◇</span>Unresolved</span>
    <span className={item}><span aria-hidden="true">solid outline = posted · thin = projected · dashed = possible</span></span>
  </div>
}

export default function CashTrajectoryChart({ projection, horizonDays, confidenceMode,
  onHorizon, onConfidence, selectedDate, onSelectDate, selectedKey = null, onSelectEvent, timeline: timelineProp }: {
  projection: CashProjectionResult
  horizonDays: CashProjectionHorizon
  confidenceMode: CashProjectionConfidenceMode
  onHorizon: (value: CashProjectionHorizon) => void
  onConfidence: (value: CashProjectionConfidenceMode) => void
  selectedDate: string
  onSelectDate: (value: string) => void
  /** Canonical source key of the selected event/marker, when one is selected (shared selection model). */
  selectedKey?: string | null
  onSelectEvent?: (date: string, key: string) => void
  /** Optional precomputed presentation timeline (same pure function of the projection). */
  timeline?: Timeline
}) {
  const rows = useMemo(() => [projection.anchor, ...projection.days], [projection])
  const low = rows.find(row => row.date === projection.summary.lowestTotalCashDate)
  const summary = projection.summary
  const covered = summary.daysCovered
  const selectedIndex = Math.max(0, rows.findIndex(row => row.date === selectedDate))

  const timeline = useMemo(() => timelineProp ?? buildTimeline(projection), [timelineProp, projection])

  // ── Date-range selection (a lens over the same projection rows; independent from single date/event selection) ──
  const dates = useMemo(() => rows.map(row => row.date), [rows])
  const [range, setRange] = useState<DateRange | null>(null)
  const [rangeMode, setRangeMode] = useState(false)
  const commitRange = useCallback((next: DateRange, source: 'drag' | 'key') => { setRange(next); if (source === 'drag') setRangeMode(false) }, [])
  const rangeSummary = useMemo(() => (range ? summarizeRange(rows, timeline, range) : null), [rows, timeline, range])
  // Deterministic clearing rules (idempotent under Strict Mode):
  //  * a different window or confidence mode clears the range;
  //  * selecting a date/event OUTSIDE the range clears it; selecting inside keeps it.
  const ctx = useRef({ horizonDays, confidenceMode, selectedDate, selectedKey })
  useEffect(() => {
    const prev = ctx.current
    ctx.current = { horizonDays, confidenceMode, selectedDate, selectedKey }
    if (prev.horizonDays !== horizonDays || prev.confidenceMode !== confidenceMode) { setRange(null); setRangeMode(false); return }
    const selectionChanged = prev.selectedDate !== selectedDate || prev.selectedKey !== selectedKey
    if (selectionChanged && range && !inRange(selectedDate, range)) setRange(null)
  }, [horizonDays, confidenceMode, selectedDate, selectedKey, range])
  const stops = useMemo<WalkStop[]>(() => timeline.days.filter(d => d.events.length > 0).map(d => ({ id: d.date, frac: d.frac, date: d.date })), [timeline])
  const stopsKey = stops.map(s => s.id).join('|')
  const reduced = usePrefersReducedMotion()
  const walk = useCashFlowWalkthrough({ stops, enabled: true, storageKey: `poweron:cash-os-flow-walkthrough:${projection.organizationId}`, horizonDays })

  // Cancel only when something actually CHANGED (idempotent under Strict Mode's double effect run):
  // the shared selection changed (graph, inspector, command center, steppers) => that is the owner, so stop the pulse;
  // a different window or confidence mode is a different story => stop rather than replay it.
  const seen = useRef({ selectedDate, selectedKey, stopsKey })
  useEffect(() => {
    const prev = seen.current
    if (prev.selectedDate === selectedDate && prev.selectedKey === selectedKey && prev.stopsKey === stopsKey) return
    seen.current = { selectedDate, selectedKey, stopsKey }
    walk.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedKey, stopsKey])

  // One emphasis path for every selected/active date: the same day-level move, whatever the event's amount,
  // category or label. The emphasis follows the real cash curve (see the gradient stroke below).
  const emphasisDate = walk.phase === 'running' && walk.activeId ? walk.activeId : selectedDate
  const emphasis = useMemo(() => selectionEmphasis(rows, emphasisDate), [rows, emphasisDate])
  const emphasisColor = emphasis?.direction === 'in' ? IN_HEX : OUT_HEX
  const showMove = !!emphasis && emphasis.prevDate !== null && emphasis.direction !== 'none'

  const domain = useMemo(() => eventBandDomain(rows.flatMap(row => [row.closingCashMinor, row.trulyFreeCashMinor, row.totalProtectedRequirementMinor, row.operatingFloorMinor])), [rows])
  const ticks = useMemo(() => dataTicks(domain.dataMin, domain.dataMax), [domain])

  function selectCluster(cluster: TimelineCluster) {
    const day = cluster.days.find(d => d.events.length > 0) ?? cluster.days[0]
    if (day.events.length === 1 && cluster.days.length === 1 && onSelectEvent) onSelectEvent(day.date, day.events[0].key)
    else if (day.events.length === 0 && day.markers.length === 1 && onSelectEvent) onSelectEvent(day.date, day.markers[0].key)
    else onSelectDate(day.date)
  }

  return <CashCard title="Forward cash trajectory">
    <div onPointerDownCapture={walk.cancel} onClickCapture={walk.cancel} onKeyDownCapture={walk.cancel} data-testid="graph-card-body"
      onKeyDown={e => { if (e.key === 'Escape' && rangeMode) setRangeMode(false) }}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1" aria-label="Projection horizon">
        {([7, 14, 30, 60, 90] as const).map(days => <button key={days} onClick={() => onHorizon(days)}
          aria-pressed={horizonDays === days}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${horizonDays === days ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40' : 'text-[var(--text-secondary)] hover:bg-white/5'}`}>{days}d</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-1" aria-label="Projection confidence">
        {(['conservative', 'likely', 'upside'] as const).map(mode => <button key={mode} onClick={() => onConfidence(mode)}
          aria-pressed={confidenceMode === mode}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${confidenceMode === mode ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40' : 'text-[var(--text-secondary)] hover:bg-white/5'}`}>{mode}</button>)}
        <button type="button" onClick={() => setRangeMode(v => !v)} aria-pressed={rangeMode} data-testid="range-mode-button"
          className={`ml-1 min-h-[32px] rounded-lg px-2 text-xs font-semibold ring-1 ${rangeMode ? 'bg-sky-500/20 text-sky-300 ring-sky-500/40' : 'text-[var(--text-secondary)] ring-[var(--border-primary)] hover:bg-white/5'}`}>
          <span aria-hidden="true">⇔ </span>Select range</button>
        {!reduced && stops.length > 0 && <button type="button" onClick={walk.start} aria-label="Replay cash flow walkthrough" data-testid="walkthrough-replay"
          className="ml-1 min-h-[32px] rounded-lg px-2 text-xs font-semibold text-[var(--text-secondary)] ring-1 ring-[var(--border-primary)] hover:bg-white/5">
          <span aria-hidden="true">↻ </span>Replay flow</button>}
      </div>
    </div>
    <div className="mb-4 flex flex-wrap items-stretch gap-3" data-testid="graph-secondary-metrics">
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
        <span className="block text-[10px] font-bold tracking-[0.14em] text-[var(--text-secondary)]">14-DAY LOW</span>
        <strong className="font-mono text-sm">{money(summary.fourteenDayLowestTotalCashMinor)}</strong>
        <span className="ml-2 text-xs text-[var(--text-secondary)]">{cashDate(summary.fourteenDayLowestTotalCashDate)}</span>
      </div>
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
        <span className="block text-[10px] font-bold tracking-[0.14em] text-[var(--text-secondary)]">DAYS COVERED</span>
        <strong className="font-mono text-sm">{covered.days}{covered.bounded ? '+' : ''} days</strong>
        {covered.bounded && <span className="ml-2 text-xs text-[var(--text-secondary)]">No breach inside selected horizon</span>}
      </div>
    </div>
    {rangeMode && <CashRangeControls dates={dates} range={range} fallbackDate={selectedDate} onChange={next => setRange(next)} onDone={() => setRangeMode(false)} />}
    <Legend />
    <div className="overflow-x-auto">
      <CashRangePlot dates={dates} range={range} rangeMode={rangeMode} onCommit={commitRange}>
        <div className="relative h-full w-full" role="img" aria-label="Projected total cash and truly free cash by day">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 15, right: 18, left: 10, bottom: 10 }}
              onClick={(state: any) => { if (state?.activeLabel) onSelectDate(String(state.activeLabel)) }}>
              <defs><linearGradient id="cashTotalFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TOTAL} stopOpacity={0.2} /><stop offset="100%" stopColor={TOTAL} stopOpacity={0} />
              </linearGradient>
              {showMove && emphasis && <linearGradient id="cashMoveGradient" x1="0" y1="0" x2="1" y2="0" data-testid="move-gradient">
                {/* Hard-edged window along the curve: exactly the previous-day -> selected-day stretch. */}
                <stop offset={0} stopColor={emphasisColor} stopOpacity={0} />
                <stop offset={emphasis.startFrac} stopColor={emphasisColor} stopOpacity={0} />
                <stop offset={emphasis.startFrac} stopColor={emphasisColor} stopOpacity={0.9} />
                <stop offset={emphasis.endFrac} stopColor={emphasisColor} stopOpacity={0.9} />
                <stop offset={emphasis.endFrac} stopColor={emphasisColor} stopOpacity={0} />
                <stop offset={1} stopColor={emphasisColor} stopOpacity={0} />
              </linearGradient>}</defs>
              <CartesianGrid stroke="#475569" strokeOpacity={0.18} vertical={false} />
              <XAxis dataKey="date" height={30} tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={25} />
              <YAxis width={76} domain={[domain.min, domain.max]} ticks={ticks} allowDataOverflow tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={v => money(Number(v)).replace(/\.00$/, '')} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #475569', borderRadius: 12 }}
                formatter={(value: any, name: any) => [money(Number(value)), String(name)]} />
              <ReferenceLine y={projection.anchor.operatingFloorMinor} stroke={PROTECT} strokeDasharray="4 4" label={{ value: 'Floor', fill: PROTECT, fontSize: 10 }} />
              {domain.dataMin < 0 && <ReferenceLine y={0} stroke={OUT_HEX} strokeDasharray="2 3" label={{ value: 'Zero', fill: OUT_HEX, fontSize: 10 }} />}
              <Area type="monotone" dataKey="closingCashMinor" name="Total Cash" stroke={TOTAL} strokeWidth={3} fill="url(#cashTotalFill)" dot={false} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="trulyFreeCashMinor" name="Truly Free" stroke={FREE} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="totalProtectedRequirementMinor" name="Required protection" stroke={PROTECT} strokeDasharray="3 5" dot={false} strokeOpacity={0.65} />
              {low && <ReferenceDot x={low.date} y={low.closingCashMinor} r={5} fill="#f59e0b" stroke="#0f1117" />}
              {showMove && <Line type="monotone" dataKey="closingCashMinor" name="Selected day move" stroke="url(#cashMoveGradient)" strokeWidth={6} dot={false} activeDot={false}
                isAnimationActive={false} tooltipType="none" legendType="none" />}
              <ReferenceLine x={emphasisDate} stroke="#e2e8f0" strokeOpacity={0.6} />
              {emphasis && <ReferenceDot x={emphasis.date} y={emphasis.closingCashMinor} r={6} fill="#e2e8f0" stroke={TOTAL} strokeWidth={2} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <CashFlowTimelineOverlay timeline={timeline} selectedDate={selectedDate} walk={walk} onSelectCluster={selectCluster} range={range} />
      </CashRangePlot>
    </div>
    {rangeSummary && <CashRangeSummary summary={rangeSummary} selectedKey={selectedKey} onClear={() => setRange(null)}
      onSelectEvent={(date, key) => (onSelectEvent ? onSelectEvent(date, key) : onSelectDate(date))} />}
    <div className="mt-3 flex items-center justify-between gap-2" data-testid="graph-day-stepper">
      <button type="button" onClick={() => onSelectDate(rows[selectedIndex - 1].date)} disabled={selectedIndex <= 0}
        className="min-h-[44px] rounded-lg px-4 text-sm font-semibold text-[var(--text-primary)] ring-1 ring-[var(--border-primary)] hover:bg-white/5 disabled:opacity-40">‹ Previous day</button>
      <span className="text-center text-sm font-semibold" aria-live="polite" data-testid="graph-selected-date">{cashDate(rows[selectedIndex]?.date)}</span>
      <button type="button" onClick={() => onSelectDate(rows[selectedIndex + 1].date)} disabled={selectedIndex >= rows.length - 1}
        className="min-h-[44px] rounded-lg px-4 text-sm font-semibold text-[var(--text-primary)] ring-1 ring-[var(--border-primary)] hover:bg-white/5 disabled:opacity-40">Next day ›</button>
    </div>
    <CashFlowSelectionStrip timeline={timeline} selectedDate={selectedDate} selectedKey={selectedKey}
      onSelectDay={onSelectDate} onSelectEvent={(date, key) => (onSelectEvent ? onSelectEvent(date, key) : onSelectDate(date))} />
    <p className="mt-3 text-xs text-[var(--text-secondary)]">Markers sit on the date money moves: + in (above), − out (below), ◇ unresolved. Tap a marker or the graph, or use the day buttons, to inspect that day. Future inflows depend on the confidence mode.</p>
    </div>
  </CashCard>
}
