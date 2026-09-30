import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceDot, Legend } from 'recharts'
import type { CashProjectionResult, CashProjectionConfidenceMode, CashProjectionHorizon } from '@/finance/cashProjectionTypes'
import { CashCard, money } from './cashOsUi'

export default function CashTrajectoryChart({ projection, horizonDays, confidenceMode,
  onHorizon, onConfidence, selectedDate, onSelectDate }: {
  projection: CashProjectionResult
  horizonDays: CashProjectionHorizon
  confidenceMode: CashProjectionConfidenceMode
  onHorizon: (value: CashProjectionHorizon) => void
  onConfidence: (value: CashProjectionConfidenceMode) => void
  selectedDate: string
  onSelectDate: (value: string) => void
}) {
  const rows = [projection.anchor, ...projection.days]
  const low = rows.find(row => row.date === projection.summary.lowestTotalCashDate)
  const markedDates = new Set(projection.datedEvents.map(event => event.date))
  const chartData = rows.map(row => ({ ...row, hasEvent: markedDates.has(row.date) }))
  return <CashCard title="Forward cash trajectory">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1" aria-label="Projection horizon">
        {([7, 14, 30, 60, 90] as const).map(days => <button key={days} onClick={() => onHorizon(days)}
          aria-pressed={horizonDays === days}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${horizonDays === days ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40' : 'text-[var(--text-secondary)] hover:bg-white/5'}`}>{days}d</button>)}
      </div>
      <div className="flex flex-wrap gap-1" aria-label="Projection confidence">
        {(['conservative', 'likely', 'upside'] as const).map(mode => <button key={mode} onClick={() => onConfidence(mode)}
          aria-pressed={confidenceMode === mode}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${confidenceMode === mode ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40' : 'text-[var(--text-secondary)] hover:bg-white/5'}`}>{mode}</button>)}
      </div>
    </div>
    <div className="overflow-x-auto">
      <div className="h-[310px] min-w-[500px]" role="img" aria-label="Projected total cash and truly free cash by day">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 15, right: 18, left: 10, bottom: 10 }}
            onClick={(state: any) => { if (state?.activeLabel) onSelectDate(String(state.activeLabel)) }}>
            <defs><linearGradient id="cashTotalFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.2} /><stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
            </linearGradient></defs>
            <CartesianGrid stroke="#475569" strokeOpacity={0.18} vertical={false} />
            <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={25} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => money(Number(v)).replace(/\.00$/, '')} width={76} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #475569', borderRadius: 12 }}
              formatter={(value: any, name: any) => [money(Number(value)), String(name)]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={projection.anchor.operatingFloorMinor} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: 'Floor', fill: '#fbbf24', fontSize: 10 }} />
            <Area type="monotone" dataKey="closingCashMinor" name="Total Cash" stroke="#38bdf8" strokeWidth={3} fill="url(#cashTotalFill)" dot={false} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="trulyFreeCashMinor" name="Truly Free" stroke="#34d399" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="totalProtectedRequirementMinor" name="Required protection" stroke="#fbbf24" strokeDasharray="3 5" dot={false} strokeOpacity={0.65} />
            {low && <ReferenceDot x={low.date} y={low.closingCashMinor} r={5} fill="#f59e0b" stroke="#0f1117" />}
            {chartData.filter(row => row.hasEvent).map(row => <ReferenceDot key={row.date} x={row.date} y={row.closingCashMinor} r={3} fill="#e2e8f0" stroke="none" />)}
            <ReferenceLine x={selectedDate} stroke="#e2e8f0" strokeOpacity={0.55} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
    <p className="mt-3 text-xs text-[var(--text-secondary)]">Dots mark dated events. Future inflows depend on the selected confidence mode; unresolved dates and payment timing are listed below. Select a day for its source detail.</p>
  </CashCard>
}
