// @ts-nocheck
import { mockWeeklySnapshots } from '../mock';
import type { WeeklyLeadSnapshot } from '../types';

// ─── Derived stats ────────────────────────────────────────────────────────────

function getAdvanceRate(snap: WeeklyLeadSnapshot): number {
  return snap.totalLeads > 0
    ? Math.round((snap.advanceCount / snap.totalLeads) * 100)
    : 0;
}

function getAvgRPL(snapshots: WeeklyLeadSnapshot[]): number {
  const total = snapshots.reduce((sum, s) => sum + s.revenuePerLead, 0);
  return Math.round(total / snapshots.length);
}

function getBestWeek(snapshots: WeeklyLeadSnapshot[]): WeeklyLeadSnapshot {
  return snapshots.reduce((best, s) =>
    s.revenuePerLead > best.revenuePerLead ? s : best
  );
}

function isTrendImproving(snapshots: WeeklyLeadSnapshot[]): boolean {
  const last = snapshots[snapshots.length - 1];
  const prev = snapshots[snapshots.length - 2];
  return last.revenuePerLead >= prev.revenuePerLead;
}

// ─── Stacked Bar Chart (pure div/Tailwind) ────────────────────────────────────

interface StackedBarProps {
  snapshots: WeeklyLeadSnapshot[];
}

function StackedBarChart({ snapshots }: StackedBarProps) {
  const maxLeads = Math.max(...(snapshots ?? []).map((s) => s.totalLeads));
  const chartHeight = 160; // px

  return (
    <div>
      <div className="flex items-end gap-6 justify-center" style={{ height: chartHeight }}>
        {(snapshots ?? []).map((snap) => {
          const barHeight = (snap.totalLeads / maxLeads) * chartHeight;
          const advancePct = (snap.advanceCount / snap.totalLeads) * 100;
          const parkPct = (snap.parkCount / snap.totalLeads) * 100;
          const killPct = (snap.killCount / snap.totalLeads) * 100;

          return (
            <div key={snap.week} className="flex flex-col items-center gap-1">
              <div
                className="w-12 flex flex-col-reverse overflow-hidden rounded-t"
                style={{ height: barHeight }}
              >
                {/* Kill — red (bottom of stack = rendered last in flex-col-reverse) */}
                <div
                  className="bg-red-500 w-full"
                  style={{ height: `${killPct}%` }}
                  title={`Kill: ${snap.killCount}`}
                />
                {/* Park — yellow */}
                <div
                  className="bg-yellow-400 w-full"
                  style={{ height: `${parkPct}%` }}
                  title={`Park: ${snap.parkCount}`}
                />
                {/* Advance — green (top) */}
                <div
                  className="bg-green-500 w-full"
                  style={{ height: `${advancePct}%` }}
                  title={`Advance: ${snap.advanceCount}`}
                />
              </div>
              <span className="text-xs text-gray-500">{snap.week}</span>
            </div>
          );
        })}
      </div>

      {/* Y-axis label */}
      <div className="mt-1 text-center text-xs text-gray-400">Lead Count</div>

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-3 text-xs">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-green-500" />
          Advance
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-yellow-400" />
          Park
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-500" />
          Kill
        </span>
      </div>
    </div>
  );
}

// ─── RPL Trend Line (inline SVG) ─────────────────────────────────────────────

interface RPLLineChartProps {
  snapshots: WeeklyLeadSnapshot[];
}

function RPLLineChart({ snapshots }: RPLLineChartProps) {
  const svgWidth = 360;
  const svgHeight = 140;
  const paddingX = 40;
  const paddingY = 24;

  const rplValues = (snapshots ?? []).map((s) => s.revenuePerLead);
  const minRPL = Math.min(...rplValues) - 500;
  const maxRPL = Math.max(...rplValues) + 500;

  const xStep = (svgWidth - paddingX * 2) / (snapshots.length - 1);

  function toX(index: number): number {
    return paddingX + index * xStep;
  }

  function toY(value: number): number {
    return (
      svgHeight -
      paddingY -
      ((value - minRPL) / (maxRPL - minRPL)) * (svgHeight - paddingY * 2)
    );
  }

  const points = (snapshots ?? [])
    .map((s, i) => `${toX(i)},${toY(s.revenuePerLead)}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      className="w-full max-w-sm mx-auto"
      aria-label="Revenue per lead trend"
    >
      {/* Grid lines */}
      {[0, 0.5, 1].map((t) => {
        const y = paddingY + t * (svgHeight - paddingY * 2);
        const rpl = Math.round(maxRPL - t * (maxRPL - minRPL));
        return (
          <g key={t}>
            <line
              x1={paddingX}
              y1={y}
              x2={svgWidth - paddingX}
              y2={y}
              stroke="#e5e7eb"
              strokeWidth={1}
            />
            <text x={paddingX - 4} y={y + 4} textAnchor="end" fontSize={9} fill="#9ca3af">
              ${(rpl / 1000).toFixed(1)}k
            </text>
          </g>
        );
      })}

      {/* Trend line */}
      <polyline
        points={points}
        fill="none"
        stroke="#22c55e"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Data points + labels */}
      {(snapshots ?? []).map((snap, i) => {
        const cx = toX(i);
        const cy = toY(snap.revenuePerLead);
        return (
          <g key={snap.week}>
            <circle cx={cx} cy={cy} r={4} fill="#22c55e" />
            <text
              x={cx}
              y={cy - 8}
              textAnchor="middle"
              fontSize={9}
              fill="#15803d"
              fontWeight="600"
            >
              ${snap.revenuePerLead.toLocaleString()}
            </text>
            <text
              x={cx}
              y={svgHeight - 6}
              textAnchor="middle"
              fontSize={9}
              fill="#6b7280"
            >
              {snap.week}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: string;
  accent?: string;
}

function SummaryCard({ label, value, accent }: SummaryCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-col gap-1 shadow-sm">
      <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</span>
      <span className={`text-lg font-bold ${accent ?? 'text-gray-800'}`}>{value}</span>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function LeadRollingTrend() {
  // Replace with real Supabase query during integration
  const snapshots = mockWeeklySnapshots;
  const thisWeek = snapshots[snapshots.length - 1];
  const advanceRate = getAdvanceRate(thisWeek);
  const avgRPL = getAvgRPL(snapshots);
  const bestWeek = getBestWeek(snapshots);
  const improving = isTrendImproving(snapshots);

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Lead Rolling Trend</h1>
        <p className="text-sm text-gray-400">4-week advance / park / kill ratio · revenue per lead</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <SummaryCard
          label="This Week Advance Rate"
          value={`${advanceRate}%`}
          accent="text-green-600"
        />
        <SummaryCard
          label="4-Week Avg RPL"
          value={`$${avgRPL.toLocaleString()}`}
        />
        <SummaryCard
          label="Best Performing Week"
          value={bestWeek.week}
          accent="text-blue-600"
        />
        <SummaryCard
          label="Trend"
          value={improving ? '↑ Improving' : '↓ Declining'}
          accent={improving ? 'text-green-600' : 'text-red-500'}
        />
      </div>

      {/* Chart 1 — Stacked Bar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">
          Lead Status by Week
        </h2>
        <StackedBarChart snapshots={snapshots} />
      </div>

      {/* Chart 2 — RPL Trend Line */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">
          Revenue Per Lead Trend
        </h2>
        <RPLLineChart snapshots={snapshots} />
      </div>
    </div>
  );
}
