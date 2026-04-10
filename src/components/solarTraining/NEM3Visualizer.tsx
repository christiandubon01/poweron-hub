/**
 * NEM3Visualizer.tsx
 *
 * Interactive NEM 3.0 Savings Visualizer — PowerOn Hub Solar Training
 *
 * Features:
 *   - 24-hour timeline: solar production, home consumption, battery, grid
 *   - Color coded: yellow (solar), blue (grid import), green (battery), red (TOU peak)
 *   - Sliders: system size → curves update live
 *   - Toggle: battery on/off → savings impact
 *   - TOU rate overlay on timeline
 *   - Summary cards: monthly/annual savings, payback
 *   - Input fields: monthly bill, system size, battery size
 *   - Comparison table: NEM 2.0 vs NEM 3.0 vs NEM 3.0 + Battery
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  calculateNEM3Savings,
  compareNEM2vsNEM3,
  TOU_RATE_SCHEDULES,
  NEM3_KEY_FACTS,
  TOU_EDUCATION,
  type NEM3Inputs,
  type Utility,
  type RatePlan,
} from '../../services/solarTraining/SolarNEM3Calculator';

// ============================================================================
// CONSTANTS
// ============================================================================

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const HOUR_LABELS = [
  '12a', '1a', '2a', '3a', '4a', '5a',
  '6a', '7a', '8a', '9a', '10a', '11a',
  '12p', '1p', '2p', '3p', '4p', '5p',
  '6p', '7p', '8p', '9p', '10p', '11p',
];

/** Hourly solar production weights (normalized) — mirrors the service */
const SOLAR_WEIGHTS = [
  0.000, 0.000, 0.000, 0.000, 0.000, 0.002,
  0.015, 0.055, 0.095, 0.120, 0.135, 0.140,
  0.135, 0.130, 0.110, 0.065, 0.030, 0.012,
  0.004, 0.001, 0.000, 0.000, 0.000, 0.000,
];

/** Hourly home consumption weights (normalized) — mirrors the service */
const LOAD_WEIGHTS = [
  0.030, 0.025, 0.022, 0.022, 0.025, 0.030,
  0.038, 0.050, 0.048, 0.040, 0.035, 0.035,
  0.038, 0.038, 0.038, 0.040, 0.050, 0.060,
  0.065, 0.060, 0.050, 0.042, 0.037, 0.032,
];

const PEAK_SUN_HOURS: Record<Utility, number> = { SCE: 5.5, IID: 6.2 };
const DERATE_FACTOR: Record<Utility, number> = { SCE: 0.80, IID: 0.77 };

const fmt = (n: number, digits = 0): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const fmtMoney = (n: number): string =>
  '$' + fmt(Math.round(n));

// ============================================================================
// MINI CARD COMPONENT
// ============================================================================

interface SummaryCardProps {
  label: string;
  value: string;
  sub?: string;
  color?: 'yellow' | 'green' | 'blue' | 'red' | 'white';
}

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, sub, color = 'white' }) => {
  const colorMap: Record<string, string> = {
    yellow: 'border-yellow-400 bg-yellow-900/20',
    green:  'border-green-400 bg-green-900/20',
    blue:   'border-blue-400 bg-blue-900/20',
    red:    'border-red-400 bg-red-900/20',
    white:  'border-gray-600 bg-gray-800/40',
  };
  const textMap: Record<string, string> = {
    yellow: 'text-yellow-300',
    green:  'text-green-300',
    blue:   'text-blue-300',
    red:    'text-red-300',
    white:  'text-white',
  };

  return (
    <div className={`rounded-xl border p-3 ${colorMap[color]}`}>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-xl font-bold ${textMap[color]}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
};

// ============================================================================
// 24-HOUR TIMELINE CHART (SVG-based, no external deps)
// ============================================================================

interface TimelineChartProps {
  systemSizeKw: number;
  batteryKwh: number;
  monthlyKwh: number;
  utility: Utility;
  ratePlan: RatePlan;
  showBattery: boolean;
}

const TimelineChart: React.FC<TimelineChartProps> = ({
  systemSizeKw,
  batteryKwh,
  monthlyKwh,
  utility,
  ratePlan,
  showBattery,
}) => {
  const schedule = TOU_RATE_SCHEDULES[ratePlan];
  const peakSunHours = PEAK_SUN_HOURS[utility];
  const derateFactor = DERATE_FACTOR[utility];

  const dailyProductionKwh = (systemSizeKw * peakSunHours * 365 * derateFactor) / 365;
  const dailyConsumptionKwh = (monthlyKwh * 12) / 365;

  // Compute hourly values
  const usableBattery = batteryKwh * 0.90 * 0.90;
  let batteryCharge = 0;

  const hourly = HOURS.map((h) => {
    const solar = dailyProductionKwh * SOLAR_WEIGHTS[h];
    const load = dailyConsumptionKwh * LOAD_WEIGHTS[h];
    const block = schedule.hours[h];

    let gridImport = 0;
    let gridExport = 0;
    let batteryDischarge = 0;
    let batteryChargeH = 0;

    if (showBattery && batteryKwh > 0) {
      let solarR = solar;
      let loadR = load;
      const directSolar = Math.min(solarR, loadR);
      solarR -= directSolar;
      loadR -= directSolar;

      if (solarR > 0 && batteryCharge < usableBattery) {
        const cap = usableBattery - batteryCharge;
        const charged = Math.min(solarR, cap);
        batteryChargeH = charged;
        batteryCharge += charged * 0.90;
        solarR -= charged;
      }
      gridExport = solarR;

      if (loadR > 0 && batteryCharge > 0) {
        const discharged = Math.min(loadR, batteryCharge);
        batteryDischarge = discharged;
        batteryCharge -= discharged;
        loadR -= discharged;
      }
      gridImport = Math.max(0, loadR);
    } else {
      if (solar >= load) {
        gridExport = solar - load;
      } else {
        gridImport = load - solar;
      }
    }

    return {
      hour: h,
      solar,
      load,
      gridImport,
      gridExport,
      batteryCharge: batteryChargeH,
      batteryDischarge,
      isPeak: block.period === 'peak',
      isSuperOffPeak: block.period === 'super_off_peak',
      importRate: block.import_rate,
    };
  });

  const maxVal = Math.max(
    ...hourly.map((h) => Math.max(h.solar, h.load, h.gridImport))
  ) * 1.1 || 1;

  const W = 720;
  const H = 200;
  const padL = 40;
  const padR = 10;
  const padT = 10;
  const padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barW = chartW / 24;

  const yScale = (v: number) => padT + chartH - (v / maxVal) * chartH;
  const xCenter = (h: number) => padL + h * barW + barW / 2;
  const xLeft = (h: number) => padL + h * barW;

  // Build polyline for solar and load
  const solarPath = hourly
    .map((h, i) => `${i === 0 ? 'M' : 'L'}${xCenter(h.hour)},${yScale(h.solar)}`)
    .join(' ');
  const loadPath = hourly
    .map((h, i) => `${i === 0 ? 'M' : 'L'}${xCenter(h.hour)},${yScale(h.load)}`)
    .join(' ');

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ minWidth: 400, maxHeight: 220 }}
        aria-label="24-hour solar energy flow chart"
      >
        {/* Peak period backgrounds */}
        {hourly.map((h) => (
          <rect
            key={h.hour}
            x={xLeft(h.hour)}
            y={padT}
            width={barW}
            height={chartH}
            fill={
              h.isPeak ? 'rgba(239,68,68,0.12)' :
              h.isSuperOffPeak ? 'rgba(234,179,8,0.06)' :
              'transparent'
            }
          />
        ))}

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = padT + chartH * (1 - pct);
          const val = maxVal * pct;
          return (
            <g key={pct}>
              <line
                x1={padL} y1={y} x2={W - padR} y2={y}
                stroke="rgba(255,255,255,0.08)" strokeWidth={0.5}
              />
              <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={7} fill="#6b7280">
                {val.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Grid import bars (blue) */}
        {hourly.map((h) => (
          h.gridImport > 0 && (
            <rect
              key={`gi-${h.hour}`}
              x={xLeft(h.hour) + barW * 0.1}
              y={yScale(h.gridImport)}
              width={barW * 0.35}
              height={Math.max(0, yScale(0) - yScale(h.gridImport))}
              fill="rgba(59,130,246,0.65)"
              rx={1}
            />
          )
        ))}

        {/* Grid export bars (orange/yellow) */}
        {hourly.map((h) => (
          h.gridExport > 0 && (
            <rect
              key={`ge-${h.hour}`}
              x={xLeft(h.hour) + barW * 0.55}
              y={yScale(h.gridExport)}
              width={barW * 0.35}
              height={Math.max(0, yScale(0) - yScale(h.gridExport))}
              fill="rgba(251,191,36,0.55)"
              rx={1}
            />
          )
        ))}

        {/* Battery discharge bars (green) */}
        {showBattery && hourly.map((h) => (
          h.batteryDischarge > 0 && (
            <rect
              key={`bd-${h.hour}`}
              x={xLeft(h.hour) + barW * 0.1}
              y={yScale(h.batteryDischarge)}
              width={barW * 0.35}
              height={Math.max(0, yScale(0) - yScale(h.batteryDischarge))}
              fill="rgba(34,197,94,0.70)"
              rx={1}
            />
          )
        ))}

        {/* Solar production curve (yellow) */}
        <path d={solarPath} fill="none" stroke="#facc15" strokeWidth={2} strokeLinejoin="round" />

        {/* Home consumption curve (white/gray) */}
        <path d={loadPath} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4,2" strokeLinejoin="round" />

        {/* Hour labels (every 3) */}
        {hourly.map((h) => (
          h.hour % 3 === 0 && (
            <text
              key={`lbl-${h.hour}`}
              x={xCenter(h.hour)}
              y={H - 5}
              textAnchor="middle"
              fontSize={7.5}
              fill="#6b7280"
            >
              {HOUR_LABELS[h.hour]}
            </text>
          )
        ))}

        {/* TOU rate label at peak hours */}
        <text x={xCenter(17)} y={padT + 14} textAnchor="middle" fontSize={7} fill="#ef4444" fontWeight="bold">
          TOU PEAK
        </text>
        <text x={xCenter(17)} y={padT + 23} textAnchor="middle" fontSize={6.5} fill="#ef4444">
          {schedule.hours[17]?.import_rate
            ? `$${schedule.hours[17].import_rate.toFixed(2)}/kWh`
            : ''}
        </text>

        {/* Y-axis label */}
        <text
          x={8} y={padT + chartH / 2}
          textAnchor="middle" fontSize={7} fill="#6b7280"
          transform={`rotate(-90, 8, ${padT + chartH / 2})`}
        >
          kWh
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-1 px-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-6 h-1 rounded" style={{ background: '#facc15' }} />
          <span className="text-gray-400">Solar production</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-6 h-0.5 rounded" style={{ background: '#94a3b8', borderTop: '1px dashed #94a3b8' }} />
          <span className="text-gray-400">Home load</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-3 rounded" style={{ background: 'rgba(59,130,246,0.65)' }} />
          <span className="text-gray-400">Grid import</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-3 rounded" style={{ background: 'rgba(251,191,36,0.55)' }} />
          <span className="text-gray-400">Solar export</span>
        </span>
        {showBattery && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-3 rounded" style={{ background: 'rgba(34,197,94,0.70)' }} />
            <span className="text-gray-400">Battery discharge</span>
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-3 rounded" style={{ background: 'rgba(239,68,68,0.20)' }} />
          <span className="text-gray-400">TOU peak zone</span>
        </span>
      </div>
    </div>
  );
};

// ============================================================================
// COMPARISON TABLE
// ============================================================================

interface ComparisonTableProps {
  nem2Annual: number;
  nem3Annual: number;
  nem3BattAnnual: number;
  nem2Payback: number;
  nem3Payback: number;
  nem3BattPayback: number;
  nem225yr: number;
  nem325yr: number;
  nem3Batt25yr: number;
}

const ComparisonTable: React.FC<ComparisonTableProps> = ({
  nem2Annual, nem3Annual, nem3BattAnnual,
  nem2Payback, nem3Payback, nem3BattPayback,
  nem225yr, nem325yr, nem3Batt25yr,
}) => {
  const rows = [
    { label: 'Year 1 savings', nem2: fmtMoney(nem2Annual), nem3: fmtMoney(nem3Annual), nem3b: fmtMoney(nem3BattAnnual) },
    { label: '25-year savings', nem2: fmtMoney(nem225yr), nem3: fmtMoney(nem325yr), nem3b: fmtMoney(nem3Batt25yr) },
    {
      label: 'Payback period',
      nem2: nem2Payback < 9000 ? `${(nem2Payback / 12).toFixed(1)} yrs` : 'N/A',
      nem3: nem3Payback < 9000 ? `${(nem3Payback / 12).toFixed(1)} yrs` : 'N/A',
      nem3b: nem3BattPayback < 9000 ? `${(nem3BattPayback / 12).toFixed(1)} yrs` : 'N/A',
    },
    {
      label: 'Export credit rate',
      nem2: '$0.25–$0.35/kWh',
      nem3: '$0.05–$0.08/kWh',
      nem3b: '$0.05–$0.08/kWh',
    },
    {
      label: 'Battery TOU savings',
      nem2: '—',
      nem3: '—',
      nem3b: fmtMoney(nem3BattAnnual - nem3Annual) + '/yr',
    },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left py-2 px-3 text-gray-400 font-medium border-b border-gray-700 w-40" />
            <th className="py-2 px-3 text-center border-b border-gray-700">
              <div className="text-yellow-400 font-bold text-sm">NEM 2.0</div>
              <div className="text-gray-500 text-xs">Grandfathered</div>
            </th>
            <th className="py-2 px-3 text-center border-b border-gray-700">
              <div className="text-orange-400 font-bold text-sm">NEM 3.0</div>
              <div className="text-gray-500 text-xs">No battery</div>
            </th>
            <th className="py-2 px-3 text-center border-b border-gray-700 bg-green-900/15 rounded-t-lg">
              <div className="text-green-400 font-bold text-sm">NEM 3.0 + 🔋</div>
              <div className="text-gray-500 text-xs">With battery</div>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.label} className={i % 2 === 0 ? 'bg-gray-800/20' : ''}>
              <td className="py-2 px-3 text-gray-400 text-xs">{row.label}</td>
              <td className="py-2 px-3 text-center text-yellow-300 font-mono text-sm">{row.nem2}</td>
              <td className="py-2 px-3 text-center text-orange-300 font-mono text-sm">{row.nem3}</td>
              <td className="py-2 px-3 text-center text-green-300 font-mono text-sm bg-green-900/10">
                {row.nem3b}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============================================================================
// MONTHLY BAR CHART
// ============================================================================

interface MonthlyChartProps {
  monthlyBreakdown: ReturnType<typeof calculateNEM3Savings>['monthly_breakdown'];
  showBattery: boolean;
}

const MonthlyBarChart: React.FC<MonthlyChartProps> = ({ monthlyBreakdown, showBattery }) => {
  const maxBill = Math.max(...monthlyBreakdown.map((m) => m.bill_before_solar));
  const shortLabels = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  return (
    <div className="w-full">
      <div className="text-xs text-gray-400 mb-2">Monthly Bill Comparison</div>
      <div className="flex items-end gap-1 h-24">
        {monthlyBreakdown.map((m, i) => {
          const beforePct = (m.bill_before_solar / maxBill) * 100;
          const afterNoBattPct = (m.bill_after_solar_no_battery / maxBill) * 100;
          const afterBattPct = (m.bill_after_solar_with_battery / maxBill) * 100;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${m.month_label}: Before $${m.bill_before_solar} | After $${showBattery ? m.bill_after_solar_with_battery : m.bill_after_solar_no_battery}`}>
              <div className="w-full flex gap-px items-end" style={{ height: 80 }}>
                {/* Before solar */}
                <div
                  className="flex-1 rounded-t"
                  style={{ height: `${beforePct}%`, background: 'rgba(156,163,175,0.5)' }}
                />
                {/* After solar */}
                <div
                  className="flex-1 rounded-t"
                  style={{
                    height: `${showBattery ? afterBattPct : afterNoBattPct}%`,
                    background: showBattery
                      ? 'rgba(34,197,94,0.7)'
                      : 'rgba(234,179,8,0.65)',
                  }}
                />
              </div>
              <div className="text-gray-600 text-center" style={{ fontSize: 8 }}>
                {shortLabels[i]}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded" style={{ background: 'rgba(156,163,175,0.5)' }} />
          <span className="text-gray-500">Before solar</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded" style={{
            background: showBattery ? 'rgba(34,197,94,0.7)' : 'rgba(234,179,8,0.65)'
          }} />
          <span className="text-gray-500">After solar {showBattery ? '+ battery' : ''}</span>
        </span>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const NEM3Visualizer: React.FC = () => {
  // ── INPUTS ──────────────────────────────────────────────────────────────
  const [monthlyKwh, setMonthlyKwh] = useState<number>(900);
  const [systemSizeKw, setSystemSizeKw] = useState<number>(8);
  const [batteryKwh, setBatteryKwh] = useState<number>(13.5);
  const [panelWattage, setPanelWattage] = useState<number>(420);
  const [utility, setUtility] = useState<Utility>('SCE');
  const [ratePlan, setRatePlan] = useState<RatePlan>('SCE_TOU_D_PRIME');
  const [systemCost, setSystemCost] = useState<number>(28000);
  const [showBattery, setShowBattery] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'timeline' | 'monthly' | 'comparison' | 'learn'>('timeline');

  // ── DERIVED CALCULATION ──────────────────────────────────────────────────
  const inputs: NEM3Inputs = useMemo(() => ({
    monthly_kwh: monthlyKwh,
    utility,
    rate_plan: ratePlan,
    system_size_kw: systemSizeKw,
    battery_kwh: showBattery ? batteryKwh : 0,
    panel_wattage: panelWattage,
    system_cost: systemCost,
  }), [monthlyKwh, utility, ratePlan, systemSizeKw, batteryKwh, panelWattage, systemCost, showBattery]);

  const result = useMemo(() => calculateNEM3Savings(inputs), [inputs]);

  const comparison = useMemo(() => {
    const inputsWithBattery: NEM3Inputs = { ...inputs, battery_kwh: batteryKwh };
    return compareNEM2vsNEM3(inputsWithBattery);
  }, [inputs, batteryKwh]);

  // ── UTILITY SWITCH HANDLER ───────────────────────────────────────────────
  const handleUtilityChange = useCallback((u: Utility) => {
    setUtility(u);
    setRatePlan(u === 'SCE' ? 'SCE_TOU_D_PRIME' : 'IID_TOU_RESIDENTIAL');
  }, []);

  const savings = showBattery ? result.with_battery : result.without_battery;
  const schedule = TOU_RATE_SCHEDULES[ratePlan];

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 font-sans">
      {/* ── HEADER ── */}
      <div className="mb-5">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-2 h-8 rounded bg-yellow-400" />
          <h1 className="text-2xl font-bold text-white">NEM 3.0 Savings Visualizer</h1>
        </div>
        <p className="text-sm text-gray-400 ml-5">
          Interactive solar savings calculator with TOU rate engine, battery optimization, and NEM 2.0 vs 3.0 comparison
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* ── LEFT: INPUTS ── */}
        <div className="xl:col-span-1 space-y-4">
          {/* System Inputs */}
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">System Configuration</h2>

            {/* Utility */}
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">Utility</label>
              <div className="flex gap-2">
                {(['SCE', 'IID'] as Utility[]).map((u) => (
                  <button
                    key={u}
                    onClick={() => handleUtilityChange(u)}
                    className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      utility === u
                        ? 'bg-yellow-500 text-gray-900'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            {/* Rate Plan */}
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">Rate Plan</label>
              <select
                value={ratePlan}
                onChange={(e) => setRatePlan(e.target.value as RatePlan)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                {utility === 'SCE' ? (
                  <>
                    <option value="SCE_TOU_D_PRIME">TOU-D-PRIME (4–9 PM peak)</option>
                    <option value="SCE_TOU_D_4_9PM">TOU-D-4-9PM</option>
                  </>
                ) : (
                  <>
                    <option value="IID_TOU_RESIDENTIAL">IID TOU Residential</option>
                    <option value="IID_STANDARD">IID Standard (flat)</option>
                  </>
                )}
              </select>
            </div>

            {/* Monthly kWh */}
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">
                Monthly Usage: <span className="text-yellow-300 font-bold">{fmt(monthlyKwh)} kWh</span>
              </label>
              <input
                type="range" min={300} max={2500} step={50}
                value={monthlyKwh}
                onChange={(e) => setMonthlyKwh(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-0.5">
                <span>300 kWh</span><span>2,500 kWh</span>
              </div>
            </div>

            {/* System Size */}
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">
                System Size: <span className="text-yellow-300 font-bold">{systemSizeKw} kW</span>
                <span className="ml-2 text-gray-500">({result.system_info.panel_count} panels @ {panelWattage}W)</span>
              </label>
              <input
                type="range" min={2} max={20} step={0.5}
                value={systemSizeKw}
                onChange={(e) => setSystemSizeKw(Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-0.5">
                <span>2 kW</span><span>20 kW</span>
              </div>
            </div>

            {/* Panel Wattage */}
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">Panel Wattage</label>
              <select
                value={panelWattage}
                onChange={(e) => setPanelWattage(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                <option value={380}>380W (standard)</option>
                <option value={400}>400W</option>
                <option value={420}>420W (common)</option>
                <option value={440}>440W</option>
                <option value={450}>450W (premium)</option>
                <option value={480}>480W (high-eff)</option>
              </select>
            </div>

            {/* Battery Toggle */}
            <div className="mb-3 flex items-center justify-between">
              <label className="text-xs text-gray-400">Battery Storage</label>
              <button
                onClick={() => setShowBattery(!showBattery)}
                className={`relative w-11 h-6 rounded-full transition-colors ${showBattery ? 'bg-green-500' : 'bg-gray-600'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${showBattery ? 'translate-x-5' : ''}`}
                />
              </button>
            </div>

            {showBattery && (
              <div className="mb-3">
                <label className="block text-xs text-gray-400 mb-1">
                  Battery Size: <span className="text-green-300 font-bold">{batteryKwh} kWh</span>
                </label>
                <input
                  type="range" min={5} max={40} step={1.5}
                  value={batteryKwh}
                  onChange={(e) => setBatteryKwh(Number(e.target.value))}
                  className="w-full accent-green-400"
                />
                <div className="flex justify-between text-xs text-gray-600 mt-0.5">
                  <span>5 kWh</span><span>40 kWh</span>
                </div>
              </div>
            )}

            {/* System Cost */}
            <div className="mb-1">
              <label className="block text-xs text-gray-400 mb-1">
                Install Cost (for payback): <span className="text-white font-bold">{fmtMoney(systemCost)}</span>
              </label>
              <input
                type="range" min={8000} max={60000} step={1000}
                value={systemCost}
                onChange={(e) => setSystemCost(Number(e.target.value))}
                className="w-full accent-blue-400"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-0.5">
                <span>$8k</span><span>$60k</span>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-2">
            <SummaryCard
              label="Annual Savings"
              value={fmtMoney(savings.annual_savings_year1)}
              sub="Year 1"
              color="yellow"
            />
            <SummaryCard
              label="Payback"
              value={savings.payback_months < 9000 ? `${savings.payback_years} yrs` : 'N/A'}
              sub={savings.payback_months < 9000 ? `${Math.round(savings.payback_months)} months` : undefined}
              color="green"
            />
            <SummaryCard
              label="10-Year Savings"
              value={fmtMoney(savings.savings_10yr)}
              sub="3% rate escalation"
              color="blue"
            />
            <SummaryCard
              label="25-Year Savings"
              value={fmtMoney(savings.savings_25yr)}
              sub="System lifetime"
              color="white"
            />
          </div>

          {/* Production Stats */}
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4">
            <h2 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">Production Stats</h2>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Annual production</span>
                <span className="text-yellow-300">{fmt(result.system_info.annual_production_kwh)} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Annual consumption</span>
                <span className="text-white">{fmt(result.system_info.annual_consumption_kwh)} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Self-consumption</span>
                <span className="text-green-300">{Math.round(savings.self_consumption_ratio * 100)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Annual export</span>
                <span className="text-blue-300">{fmt(savings.annual_export_kwh)} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Export credit (NEM 3.0)</span>
                <span className="text-orange-300">{fmtMoney(savings.annual_export_credit_nem3)}/yr</span>
              </div>
              {showBattery && result.with_battery.tou_arbitrage_savings > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">TOU arbitrage savings</span>
                  <span className="text-green-300">{fmtMoney(result.with_battery.tou_arbitrage_savings)}/yr</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Peak TOU rate</span>
                <span className="text-red-300">${schedule.hours[17]?.import_rate.toFixed(2)}/kWh</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: VISUALIZATIONS ── */}
        <div className="xl:col-span-2 space-y-4">
          {/* Tab Navigation */}
          <div className="flex gap-1 bg-gray-900 border border-gray-700 rounded-xl p-1">
            {([
              { key: 'timeline', label: '24-Hour Timeline' },
              { key: 'monthly', label: 'Monthly Bills' },
              { key: 'comparison', label: 'NEM 2 vs 3' },
              { key: 'learn', label: 'Learn' },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-all ${
                  activeTab === tab.key
                    ? 'bg-yellow-500 text-gray-900 font-bold'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* TAB: 24-Hour Timeline */}
          {activeTab === 'timeline' && (
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-300">24-Hour Energy Flow</h2>
                <div className="text-xs text-gray-500">{schedule.plan_label} · Peak: {schedule.peak_hours_label}</div>
              </div>

              <TimelineChart
                systemSizeKw={systemSizeKw}
                batteryKwh={batteryKwh}
                monthlyKwh={monthlyKwh}
                utility={utility}
                ratePlan={ratePlan}
                showBattery={showBattery}
              />

              {/* Hourly rate bar */}
              <div className="mt-4">
                <div className="text-xs text-gray-500 mb-1">TOU Import Rate by Hour</div>
                <div className="flex gap-px">
                  {schedule.hours.map((block) => (
                    <div
                      key={block.hour}
                      className="flex-1 rounded-sm"
                      style={{
                        height: 20,
                        background:
                          block.period === 'peak'
                            ? `rgba(239,68,68,${0.4 + block.import_rate * 0.6})`
                            : block.period === 'super_off_peak'
                            ? 'rgba(234,179,8,0.25)'
                            : 'rgba(59,130,246,0.30)',
                      }}
                      title={`${HOUR_LABELS[block.hour]}: $${block.import_rate}/kWh (${block.period})`}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-xs text-gray-600 mt-0.5">
                  <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                </div>
              </div>

              {/* Key insight box */}
              <div className="mt-4 bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-3">
                <div className="text-xs font-semibold text-yellow-400 mb-1">⚡ Why NEM 3.0 Changes the Math</div>
                <div className="text-xs text-gray-300 space-y-1">
                  <p>
                    Solar panels produce peak power from <strong className="text-yellow-300">9am–3pm</strong> —
                    the same hours when grid electricity is cheapest (super off-peak).
                    Under NEM 3.0, this daytime solar exported to the grid earns only{' '}
                    <strong className="text-orange-300">$0.04–$0.07/kWh</strong> (ACC rate).
                  </p>
                  <p>
                    But your home needs power during <strong className="text-red-300">4pm–9pm</strong> TOU peak,
                    when grid electricity costs <strong className="text-red-300">$0.45–$0.55/kWh</strong>.
                  </p>
                  <p className="text-green-300">
                    A battery stores the midday solar and delivers it at peak hours — replacing{' '}
                    expensive peak grid power instead of exporting cheap credits.
                    That's the NEM 3.0 battery opportunity.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB: Monthly Bills */}
          {activeTab === 'monthly' && (
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-300">Monthly Bill Comparison</h2>
                <div className="text-xs text-gray-500">Before solar vs after solar {showBattery ? '+ battery' : ''}</div>
              </div>

              <MonthlyBarChart
                monthlyBreakdown={result.monthly_breakdown}
                showBattery={showBattery}
              />

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-1 px-2 text-gray-500">Month</th>
                      <th className="text-right py-1 px-2 text-gray-500">Production</th>
                      <th className="text-right py-1 px-2 text-gray-500">Before</th>
                      <th className="text-right py-1 px-2 text-gray-500">No Battery</th>
                      <th className="text-right py-1 px-2 text-gray-500">With Battery</th>
                      <th className="text-right py-1 px-2 text-gray-500">Savings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.monthly_breakdown.map((m, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-gray-800/20' : ''}>
                        <td className="py-1 px-2 text-gray-400">{m.month_label.slice(0, 3)}</td>
                        <td className="py-1 px-2 text-right text-yellow-300">{fmt(m.solar_production_kwh)} kWh</td>
                        <td className="py-1 px-2 text-right text-gray-400">{fmtMoney(m.bill_before_solar)}</td>
                        <td className="py-1 px-2 text-right text-orange-300">{fmtMoney(m.bill_after_solar_no_battery)}</td>
                        <td className="py-1 px-2 text-right text-green-300">{fmtMoney(m.bill_after_solar_with_battery)}</td>
                        <td className="py-1 px-2 text-right text-blue-300">
                          {fmtMoney(m.bill_before_solar - (showBattery ? m.bill_after_solar_with_battery : m.bill_after_solar_no_battery))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: NEM 2 vs NEM 3 Comparison */}
          {activeTab === 'comparison' && (
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-300 mb-1">NEM 2.0 vs NEM 3.0 Side-by-Side</h2>
                <p className="text-xs text-gray-500">Based on {systemSizeKw}kW system · {utility} · {fmtMoney(systemCost)} install</p>
              </div>

              <ComparisonTable
                nem2Annual={comparison.nem2.annual_savings}
                nem3Annual={comparison.nem3_no_battery.annual_savings}
                nem3BattAnnual={comparison.nem3_with_battery.annual_savings}
                nem2Payback={comparison.nem2.payback_months}
                nem3Payback={comparison.nem3_no_battery.payback_months}
                nem3BattPayback={comparison.nem3_with_battery.payback_months}
                nem225yr={comparison.nem2.savings_25yr}
                nem325yr={comparison.nem3_no_battery.savings_25yr}
                nem3Batt25yr={comparison.nem3_with_battery.savings_25yr}
              />

              {/* Summary Statement */}
              <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl p-3">
                <div className="text-xs font-semibold text-blue-400 mb-1.5">💬 Customer Conversation Script</div>
                <p className="text-xs text-gray-300 leading-relaxed">{comparison.summary_statement}</p>
              </div>

              {/* Recommendation */}
              <div className="bg-green-900/20 border border-green-700/30 rounded-xl p-3">
                <div className="text-xs font-semibold text-green-400 mb-1.5">✅ Recommendation</div>
                <p className="text-xs text-gray-300 leading-relaxed">{comparison.recommendation}</p>
              </div>

              {/* Export credit breakdown */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-2 text-center">
                  <div className="text-xs text-gray-400 mb-0.5">NEM 2.0 Export Rate</div>
                  <div className="text-lg font-bold text-yellow-300">
                    ~${comparison.nem2.export_credit_rate_avg.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-500">/kWh (weighted)</div>
                </div>
                <div className="bg-orange-900/20 border border-orange-700/30 rounded-xl p-2 text-center">
                  <div className="text-xs text-gray-400 mb-0.5">NEM 3.0 Export Rate</div>
                  <div className="text-lg font-bold text-orange-300">
                    ~${comparison.nem3_no_battery.export_credit_rate_avg.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-500">/kWh (ACC)</div>
                </div>
                <div className="bg-green-900/20 border border-green-700/30 rounded-xl p-2 text-center">
                  <div className="text-xs text-gray-400 mb-0.5">Battery TOU Gain</div>
                  <div className="text-lg font-bold text-green-300">
                    {fmtMoney(comparison.nem3_with_battery.tou_arbitrage_savings)}
                  </div>
                  <div className="text-xs text-gray-500">/yr arbitrage</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: Learn */}
          {activeTab === 'learn' && (
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 space-y-4">
              <h2 className="text-sm font-semibold text-gray-300">NEM 3.0 Training — Key Facts</h2>

              <div className="space-y-3">
                <div className="bg-gray-800/50 rounded-xl p-3">
                  <div className="text-xs font-semibold text-yellow-400 mb-1">📅 What is NEM 3.0?</div>
                  <div className="text-xs text-gray-300 space-y-1">
                    <p>Net Energy Metering 3.0 (NEM 3.0) took effect <strong>{NEM3_KEY_FACTS.effective_date}</strong> for the three California IOUs: SCE, PG&E, and SDG&E.</p>
                    <p>New solar customers are now placed on NEM 3.0 by default. <strong>Existing NEM 2.0 customers are grandfathered for {NEM3_KEY_FACTS.grandfathered_period_years} years</strong> from their original interconnection date.</p>
                  </div>
                </div>

                <div className="bg-gray-800/50 rounded-xl p-3">
                  <div className="text-xs font-semibold text-orange-400 mb-1">💸 The Export Credit Drop</div>
                  <div className="text-xs text-gray-300 space-y-1">
                    <p><strong>NEM 2.0:</strong> Solar exported to the grid earned full retail credit — typically ${NEM3_KEY_FACTS.nem2_export_credit_range.min}–${NEM3_KEY_FACTS.nem2_export_credit_range.max}/kWh.</p>
                    <p><strong>NEM 3.0:</strong> Export credits dropped to ${NEM3_KEY_FACTS.nem3_export_credit_range.min}–${NEM3_KEY_FACTS.nem3_export_credit_range.max}/kWh under the <strong>{NEM3_KEY_FACTS.acc_stands_for}</strong>.</p>
                    <p className="text-orange-300">Export value fell by ~{NEM3_KEY_FACTS.export_value_reduction_pct}%. Exporting solar is no longer financially optimal.</p>
                  </div>
                </div>

                <div className="bg-gray-800/50 rounded-xl p-3">
                  <div className="text-xs font-semibold text-blue-400 mb-1">🔋 Why Battery is the Answer</div>
                  <div className="text-xs text-gray-300 space-y-1">
                    <p>{NEM3_KEY_FACTS.battery_impact}</p>
                    <p><strong>{TOU_EDUCATION.battery_strategy}</strong></p>
                    <p className="text-green-300">{TOU_EDUCATION.why_battery_wins}</p>
                  </div>
                </div>

                <div className="bg-gray-800/50 rounded-xl p-3">
                  <div className="text-xs font-semibold text-red-400 mb-1">⏰ SCE TOU-D-PRIME Rates</div>
                  <div className="text-xs text-gray-300 space-y-1">
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <div className="text-center bg-red-900/30 rounded-lg p-2">
                        <div className="text-red-300 font-bold">{TOU_EDUCATION.sce_peak_rate_range}</div>
                        <div className="text-gray-500 text-xs">Peak ({TOU_EDUCATION.sce_peak_hours})</div>
                      </div>
                      <div className="text-center bg-blue-900/30 rounded-lg p-2">
                        <div className="text-blue-300 font-bold">~$0.23/kWh</div>
                        <div className="text-gray-500 text-xs">Off-peak</div>
                      </div>
                      <div className="text-center bg-yellow-900/30 rounded-lg p-2">
                        <div className="text-yellow-300 font-bold">{TOU_EDUCATION.sce_super_off_peak_rate}</div>
                        <div className="text-gray-500 text-xs">Super off-peak (solar hours)</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-800/50 rounded-xl p-3">
                  <div className="text-xs font-semibold text-purple-400 mb-1">🏛️ IID Exception</div>
                  <div className="text-xs text-gray-300">
                    <p>{NEM3_KEY_FACTS.iid_note}</p>
                    <p className="mt-1">IID customers generally have lower rates and a different peak window (11am–7pm). Solar economics are still strong with or without battery in the Imperial Valley.</p>
                  </div>
                </div>

                <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-xl p-3">
                  <div className="text-xs font-semibold text-yellow-300 mb-1">🎯 Sales Key Message</div>
                  <div className="text-xs text-gray-300 italic">{NEM3_KEY_FACTS.sales_key_message}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NEM3Visualizer;
