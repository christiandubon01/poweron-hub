/**
 * src/views/MaterialIntelligence.tsx
 * SCOUT Material Intelligence View — V3-27
 *
 * Provides a full dashboard for material pricing intelligence:
 * - Header stats (Items Tracked, Price Alerts, Avg Savings, Suppliers)
 * - Search bar
 * - Price history chart with 30/60/90 day toggle (Recharts)
 * - Price Alerts panel (>5% change cards)
 * - Supplier Comparison with "Best Deal" badge
 * - Alternative Products section
 * - Weekly Material Market Report panel (V3-27 — VAULT integration)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  TrendingUp,
  TrendingDown,
  Package,
  AlertTriangle,
  DollarSign,
  Truck,
  Star,
  ChevronRight,
  RefreshCw,
  BarChart2,
  ShoppingCart,
  CheckCircle,
  Clock,
  XCircle,
  Zap,
  FileText,
  ArrowRight,
} from 'lucide-react';
import {
  getLatestMarketReport,
  markReportSeen,
  type MarketReport,
} from '../services/vaultMarketReport';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  searchMaterialPricing,
  comparePrices,
  findAlternatives,
  checkPriceChanges,
  getMockItemCount,
  type SupplierResult,
  type PriceComparison,
  type AlternativeProduct,
  type PriceAlert,
} from '../services/materialIntelligence';

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPPLIER_COUNT = 5;

const DEFAULT_ITEMS = [
  'thhn wire 12 awg black',
  'square d 20a single pole breaker',
  '3/4 emt conduit 10ft',
  'leviton 20a tamper resistant receptacle',
];

const CHART_ITEM_OPTIONS = [
  { label: '12 AWG THHN Black', key: 'thhn wire 12 awg black' },
  { label: '10 AWG THHN Black', key: 'thhn wire 10 awg black' },
  { label: 'Square D 20A Breaker', key: 'square d 20a single pole breaker' },
  { label: '3/4" EMT Conduit', key: '3/4 emt conduit 10ft' },
  { label: '20A TR Receptacle', key: 'leviton 20a tamper resistant receptacle' },
];

const SUPPLIER_COLORS: Record<string, string> = {
  'Graybar':         '#4ade80',
  'Rexel':           '#60a5fa',
  'WESCO':           '#f59e0b',
  'Home Depot Pro':  '#f97316',
  'Local Supplier':  '#c084fc',
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceHistoryPoint {
  date: string;
  [key: string]: string | number | undefined;
}

type DayRange = 30 | 60 | 90;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtShort(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function titleCase(s: string): string {
  return s
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Generate synthetic price history data for chart display.
 * Produces realistic price drift over the specified number of days.
 */
function generatePriceHistory(
  results: SupplierResult[],
  days: DayRange,
): PriceHistoryPoint[] {
  if (results.length === 0) return [];

  const points: PriceHistoryPoint[] = [];
  const step = days <= 30 ? 7 : days <= 60 ? 10 : 14;
  const totalPoints = Math.ceil(days / step);

  // Seeded pseudo-random drift per supplier
  function drift(base: number, supplierIndex: number, i: number): number {
    const seed = (supplierIndex * 13 + i * 7) % 17;
    const variance = 0.04; // ±4%
    const factor = 1 + ((seed / 17) * 2 - 1) * variance;
    return Math.round(base * factor * 100) / 100;
  }

  for (let i = totalPoints - 1; i >= 0; i--) {
    const d = new Date(2026, 3, 5); // April 5, 2026
    d.setDate(d.getDate() - i * step);
    const label =
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const point: PriceHistoryPoint = { date: label };
    results.forEach((r, idx) => {
      point[r.supplier_name] = drift(r.price, idx, i);
    });
    points.push(point);
  }

  // Last point = current prices
  const last = points[points.length - 1];
  if (last) {
    results.forEach(r => {
      last[r.supplier_name] = r.price;
    });
  }

  return points;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      className="flex-1 min-w-0 rounded-xl px-5 py-4 border"
      style={{ backgroundColor: '#111318', borderColor: '#1e2128' }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color: accent ?? '#4ade80' }}>{icon}</span>
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div
        className="text-2xl font-bold"
        style={{ color: accent ?? '#f9fafb' }}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Price Alert Card ─────────────────────────────────────────────────────────

function PriceAlertCard({ alert }: { alert: PriceAlert }) {
  const isUp = alert.direction === 'up';
  const pct = Math.abs(alert.change_pct);

  const severityColors = {
    info:     { bg: '#0c1a2e', border: '#1d4ed8', text: '#93c5fd' },
    warning:  { bg: '#1c1200', border: '#ca8a04', text: '#fbbf24' },
    critical: { bg: '#1a0000', border: '#dc2626', text: '#f87171' },
  };
  const colors = severityColors[alert.severity];

  return (
    <div
      className="rounded-lg px-4 py-3 border"
      style={{ backgroundColor: colors.bg, borderColor: colors.border }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-200 truncate">
            {titleCase(alert.item_name)}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">{alert.supplier_name}</div>
        </div>
        <div
          className="flex items-center gap-1 text-sm font-bold flex-shrink-0"
          style={{ color: colors.text }}
        >
          {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {isUp ? '+' : '-'}{pct.toFixed(1)}%
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
        <span>{fmt(alert.previous_price)}</span>
        <ChevronRight size={10} />
        <span style={{ color: isUp ? '#f87171' : '#4ade80' }}>
          {fmt(alert.current_price)}
        </span>
      </div>
    </div>
  );
}

// ─── Supplier Card ────────────────────────────────────────────────────────────

function SupplierCard({
  result,
  isBest,
}: {
  result: SupplierResult;
  isBest: boolean;
}) {
  const accentColor = SUPPLIER_COLORS[result.supplier_name] ?? '#9ca3af';

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-2 relative"
      style={{
        backgroundColor: isBest ? '#051a0e' : '#111318',
        borderColor: isBest ? '#16a34a' : '#1e2128',
      }}
    >
      {isBest && (
        <div
          className="absolute top-2 right-2 flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: '#16a34a22', color: '#4ade80', border: '1px solid #16a34a55' }}
        >
          <Star size={10} /> Best Deal
        </div>
      )}
      <div className="flex items-center gap-2">
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: accentColor }}
        />
        <span className="text-sm font-semibold text-gray-200 truncate">
          {result.supplier_name}
        </span>
      </div>
      <div
        className="text-xl font-bold"
        style={{ color: isBest ? '#4ade80' : '#f9fafb' }}
      >
        {fmt(result.price)}
        <span className="text-xs text-gray-500 font-normal ml-1">
          / {result.unit}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          {result.in_stock ? (
            <CheckCircle size={11} className="text-green-500" />
          ) : (
            <XCircle size={11} className="text-red-500" />
          )}
          {result.in_stock ? 'In Stock' : 'Out of Stock'}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={11} />
          {result.lead_time_days === 0 ? 'Same-day' : `${result.lead_time_days}d lead`}
        </span>
      </div>
      <div className="flex items-center gap-1 text-xs text-gray-600">
        <ShoppingCart size={10} />
        Min order: {result.minimum_order}
        {result.sku && (
          <span className="ml-2 text-gray-700">SKU: {result.sku}</span>
        )}
      </div>
      {result.notes && (
        <div className="text-xs text-yellow-600 mt-1 flex items-center gap-1">
          <AlertTriangle size={10} />
          {result.notes}
        </div>
      )}
    </div>
  );
}

// ─── Alternative Product Card ─────────────────────────────────────────────────

function AlternativeCard({ alt }: { alt: AlternativeProduct }) {
  const best =
    alt.pricing.length > 0
      ? alt.pricing.reduce((min, r) => (r.price < min.price ? r : min))
      : null;

  return (
    <div
      className="rounded-xl border p-4"
      style={{ backgroundColor: '#111318', borderColor: '#1e2128' }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-sm font-semibold text-gray-200">
            {alt.product_name}
          </div>
          <div className="text-xs text-gray-500">{alt.brand} · {alt.description}</div>
        </div>
        {best && (
          <div className="text-right flex-shrink-0">
            <div className="text-base font-bold text-green-400">
              {fmt(best.price)}
            </div>
            <div className="text-xs text-gray-600">{best.supplier_name}</div>
          </div>
        )}
      </div>
      <div
        className="text-xs text-gray-500 mt-1 rounded p-2"
        style={{ backgroundColor: '#0d0e14' }}
      >
        {alt.compatibility_notes}
      </div>
    </div>
  );
}

// ─── Weekly Digest Panel ──────────────────────────────────────────────────────

function WeeklyDigest({
  searches,
  alerts,
  avgSavings,
}: {
  searches: number;
  alerts: number;
  avgSavings: number;
}) {
  const items = [
    { label: 'Material searches', value: searches, icon: <Search size={13} /> },
    { label: 'Price alerts fired', value: alerts, icon: <AlertTriangle size={13} /> },
    {
      label: 'Avg savings identified',
      value: fmt(avgSavings),
      icon: <DollarSign size={13} />,
    },
    { label: 'Suppliers polled', value: SUPPLIER_COUNT, icon: <Truck size={13} /> },
  ];

  return (
    <div
      className="rounded-xl border p-5"
      style={{ backgroundColor: '#111318', borderColor: '#1e2128' }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Zap size={14} className="text-green-400" />
        <span className="text-sm font-semibold text-gray-200">
          Weekly Digest
        </span>
        <span className="text-xs text-gray-600 ml-auto">Apr 1–5, 2026</span>
      </div>
      <div className="flex flex-col gap-3">
        {items.map(item => (
          <div
            key={item.label}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="text-gray-600">{item.icon}</span>
              {item.label}
            </div>
            <span className="text-sm font-semibold text-gray-200">
              {item.value}
            </span>
          </div>
        ))}
      </div>
      <div
        className="mt-4 pt-3 border-t text-xs text-gray-600"
        style={{ borderColor: '#1e2128' }}
      >
        Digest resets Monday. Data sourced from SCOUT material cache.
      </div>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function MaterialIntelligence() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SupplierResult[]>([]);
  const [comparison, setComparison] = useState<PriceComparison | null>(null);
  const [alternatives, setAlternatives] = useState<AlternativeProduct[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeChartItem, setActiveChartItem] = useState(CHART_ITEM_OPTIONS[0].key);
  const [chartRange, setChartRange] = useState<DayRange>(30);
  const [chartData, setChartData] = useState<PriceHistoryPoint[]>([]);
  const [chartResults, setChartResults] = useState<SupplierResult[]>([]);
  const [itemCount, setItemCount] = useState(0);
  const [avgSavings, setAvgSavings] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchedItem, setSearchedItem] = useState('');
  // V3-27: Weekly Market Report state
  const [marketReport, setMarketReport] = useState<MarketReport | null>(null);

  // ── Initial Load ───────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      setLoading(true);
      setItemCount(getMockItemCount());

      // Pre-load first default item for supplier comparison
      const defaultResults = await searchMaterialPricing(DEFAULT_ITEMS[0]);
      if (defaultResults.length > 0) {
        const comp = comparePrices(defaultResults, DEFAULT_ITEMS[0]);
        setSearchResults(defaultResults);
        setComparison(comp);
        setSearchedItem(DEFAULT_ITEMS[0]);
      }

      // Calculate average savings across default items
      let totalSavings = 0;
      let count = 0;
      for (const item of DEFAULT_ITEMS) {
        const results = await searchMaterialPricing(item);
        if (results.length > 0) {
          const comp = comparePrices(results, item);
          totalSavings += comp.savings_vs_highest;
          count++;
        }
      }
      if (count > 0) setAvgSavings(Math.round(totalSavings / count * 100) / 100);

      // Load alternatives for default item
      const alts = await findAlternatives(DEFAULT_ITEMS[0]);
      setAlternatives(alts);

      // Load price alerts (will be empty on first run — no previous cache)
      const alerts = await checkPriceChanges();
      setPriceAlerts(alerts);

      // V3-27: Load weekly market report and mark as seen
      const report = await getLatestMarketReport();
      setMarketReport(report);
      markReportSeen();

      setLoading(false);
    }
    void init();
  }, []);

  // ── Load chart data ────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadChart() {
      const results = await searchMaterialPricing(activeChartItem);
      setChartResults(results);
      setChartData(generatePriceHistory(results, chartRange));
    }
    void loadChart();
  }, [activeChartItem, chartRange]);

  // ── Search Handler ─────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    setIsSearching(true);
    const results = await searchMaterialPricing(query);
    if (results.length > 0) {
      const comp = comparePrices(results, query);
      setSearchResults(results);
      setComparison(comp);
      setSearchedItem(query);
      const alts = await findAlternatives(query);
      setAlternatives(alts);
    } else {
      setSearchResults([]);
      setComparison(null);
      setAlternatives([]);
      setSearchedItem(query);
    }
    setIsSearching(false);
  }, [searchQuery]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleSearch();
  };

  // ── Computed values ────────────────────────────────────────────────────────
  const alertThisWeek = priceAlerts.length;

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: '#4b5563' }}
      >
        <RefreshCw size={18} className="animate-spin mr-2" />
        <span className="text-sm">Loading material intelligence…</span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-0 min-h-full"
      style={{ backgroundColor: '#0a0b0f' }}
    >
      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div
        className="px-6 pt-5 pb-4 border-b"
        style={{ borderColor: '#1a1c23' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Package size={16} className="text-green-400" />
          <h1 className="text-base font-semibold text-gray-100">
            Material Intelligence
          </h1>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full border ml-1"
            style={{
              color: '#4ade80',
              borderColor: '#16a34a33',
              backgroundColor: '#052e1688',
            }}
          >
            SCOUT
          </span>
        </div>
        <p className="text-xs text-gray-600">
          Real-time pricing, supplier comparisons, and alternative materials for
          electrical contractors.
        </p>
      </div>

      <div className="px-6 py-5 flex flex-col gap-6">

        {/* ── Search Bar ─────────────────────────────────────────────────────── */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
            />
            <input
              type="text"
              placeholder="Search materials… e.g. 12 AWG THHN, Square D 20A breaker"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm text-gray-200 placeholder-gray-600 outline-none border"
              style={{
                backgroundColor: '#111318',
                borderColor: '#1e2128',
                transition: 'border-color 0.15s',
              }}
              onFocus={e =>
                (e.currentTarget.style.borderColor = '#16a34a')
              }
              onBlur={e =>
                (e.currentTarget.style.borderColor = '#1e2128')
              }
            />
          </div>
          <button
            onClick={() => void handleSearch()}
            disabled={isSearching || !searchQuery.trim()}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity"
            style={{
              backgroundColor: '#16a34a',
              opacity: isSearching || !searchQuery.trim() ? 0.5 : 1,
            }}
          >
            {isSearching ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              'Search'
            )}
          </button>
        </div>

        {/* ── Stats Bar ──────────────────────────────────────────────────────── */}
        <div className="flex gap-3">
          <StatCard
            icon={<Package size={14} />}
            label="Items Tracked"
            value={itemCount}
            sub="Across all categories"
          />
          <StatCard
            icon={<AlertTriangle size={14} />}
            label="Price Alerts This Week"
            value={alertThisWeek}
            sub=">5% change threshold"
            accent="#f59e0b"
          />
          <StatCard
            icon={<DollarSign size={14} />}
            label="Avg Savings Found"
            value={avgSavings > 0 ? fmt(avgSavings) : '—'}
            sub="Best vs. highest price"
            accent="#4ade80"
          />
          <StatCard
            icon={<Truck size={14} />}
            label="Suppliers Monitored"
            value={SUPPLIER_COUNT}
            sub="Graybar · Rexel · WESCO + 2"
            accent="#60a5fa"
          />
        </div>

        {/* ── Main Two-Column Layout ─────────────────────────────────────────── */}
        <div className="flex gap-4 items-start">

          {/* ── Left Column ──────────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">

            {/* ── Price History Chart ─────────────────────────────────────────── */}
            <div
              className="rounded-xl border p-5"
              style={{ backgroundColor: '#111318', borderColor: '#1e2128' }}
            >
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <BarChart2 size={14} className="text-green-400" />
                  <span className="text-sm font-semibold text-gray-200">
                    Price History
                  </span>
                </div>

                {/* Item selector */}
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={activeChartItem}
                    onChange={e => setActiveChartItem(e.target.value)}
                    className="text-xs rounded-lg px-2 py-1.5 border text-gray-300 outline-none"
                    style={{
                      backgroundColor: '#0d0e14',
                      borderColor: '#1e2128',
                    }}
                  >
                    {CHART_ITEM_OPTIONS.map(opt => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {/* Day range toggle */}
                  <div
                    className="flex rounded-lg overflow-hidden border"
                    style={{ borderColor: '#1e2128' }}
                  >
                    {([30, 60, 90] as DayRange[]).map(range => (
                      <button
                        key={range}
                        onClick={() => setChartRange(range)}
                        className="px-3 py-1.5 text-xs font-medium transition-colors"
                        style={{
                          backgroundColor:
                            chartRange === range ? '#16a34a' : '#0d0e14',
                          color:
                            chartRange === range ? '#fff' : '#6b7280',
                        }}
                      >
                        {range}d
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart
                    data={chartData}
                    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#1e2128"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#6b7280', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#6b7280', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={v =>
                        `$${(v as number).toFixed(0)}`
                      }
                      width={48}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0d0e14',
                        border: '1px solid #1e2128',
                        borderRadius: 8,
                        fontSize: 12,
                        color: '#e5e7eb',
                      }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any) =>
                        value != null ? fmt(Number(value)) : '—'
                      }
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11, color: '#6b7280' }}
                    />
                    {chartResults.map(r => (
                      <Line
                        key={r.supplier_name}
                        type="monotone"
                        dataKey={r.supplier_name}
                        stroke={
                          SUPPLIER_COLORS[r.supplier_name] ?? '#9ca3af'
                        }
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-48 text-gray-600 text-sm">
                  No chart data available
                </div>
              )}
            </div>

            {/* ── Supplier Comparison ─────────────────────────────────────────── */}
            {searchResults.length > 0 && comparison && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Truck size={14} className="text-blue-400" />
                  <h2 className="text-sm font-semibold text-gray-200">
                    Supplier Comparison
                  </h2>
                  <span className="text-xs text-gray-600">
                    — {titleCase(searchedItem)}
                  </span>
                </div>

                {/* Savings summary */}
                {comparison.savings_vs_highest > 0 && (
                  <div
                    className="rounded-lg p-3 mb-3 text-xs flex items-center gap-2 border"
                    style={{
                      backgroundColor: '#051a0e',
                      borderColor: '#16a34a44',
                      color: '#4ade80',
                    }}
                  >
                    <TrendingDown size={13} />
                    Save{' '}
                    <strong>{fmt(comparison.savings_vs_highest)}</strong>{' '}
                    ({comparison.savings_pct_vs_highest.toFixed(1)}%) vs
                    highest price. Best: {comparison.best_deal.supplier_name} at{' '}
                    {fmt(comparison.best_deal.price)}.
                    {comparison.savings_vs_vault !== undefined &&
                      comparison.savings_vs_vault > 0 && (
                        <>
                          {' '}
                          <span className="text-yellow-400">
                            {fmt(comparison.savings_vs_vault)} better than VAULT
                            reference.
                          </span>
                        </>
                      )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  {comparison.results.map(result => (
                    <SupplierCard
                      key={result.supplier_name}
                      result={result}
                      isBest={
                        result.supplier_name ===
                        comparison.best_deal.supplier_name
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── No Results State ─────────────────────────────────────────────── */}
            {searchedItem &&
              searchResults.length === 0 &&
              !isSearching && (
                <div
                  className="rounded-xl border p-6 text-center"
                  style={{
                    backgroundColor: '#111318',
                    borderColor: '#1e2128',
                  }}
                >
                  <Package
                    size={28}
                    className="mx-auto mb-2 text-gray-700"
                  />
                  <div className="text-sm text-gray-400 mb-1">
                    No results for "{searchedItem}"
                  </div>
                  <div className="text-xs text-gray-600">
                    Try a specific product name like "12 AWG THHN black" or
                    "Square D 20A breaker"
                  </div>
                </div>
              )}

            {/* ── Alternative Products ─────────────────────────────────────────── */}
            {alternatives.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <RefreshCw size={14} className="text-purple-400" />
                  <h2 className="text-sm font-semibold text-gray-200">
                    Alternative Products
                  </h2>
                  <span className="text-xs text-gray-600">
                    — {alternatives.length} option
                    {alternatives.length !== 1 ? 's' : ''} found
                  </span>
                </div>
                <div className="flex flex-col gap-3">
                  {alternatives.map(alt => (
                    <AlternativeCard key={alt.product_name} alt={alt} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Right Column ─────────────────────────────────────────────────── */}
          <div className="w-72 flex-shrink-0 flex flex-col gap-4">

            {/* ── Weekly Market Report (V3-27) ────────────────────────────────── */}
            {marketReport ? (
              <div
                className="rounded-xl border p-5"
                style={{ backgroundColor: '#111318', borderColor: '#1e2128' }}
              >
                {/* Report header */}
                <div className="flex items-center gap-2 mb-3">
                  <FileText size={14} className="text-green-400" />
                  <span className="text-sm font-semibold text-gray-200">
                    Market Report
                  </span>
                  <span className="text-xs text-gray-600 ml-auto">
                    {marketReport.week_label}
                  </span>
                </div>

                {/* Summary text */}
                <p className="text-xs text-gray-500 leading-relaxed mb-4">
                  {marketReport.summary}
                </p>

                {/* Key stats */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { label: 'Items Tracked',  value: marketReport.items_tracked,                            color: '#9ca3af' },
                    { label: 'Potential Save',  value: `$${marketReport.total_potential_savings.toFixed(0)}`, color: '#4ade80' },
                    { label: 'Above Market',    value: marketReport.items_at_risk,                            color: '#ef4444' },
                    { label: 'Competitive',     value: marketReport.items_competitive,                        color: '#22c55e' },
                  ].map(({ label, value, color }) => (
                    <div
                      key={label}
                      className="rounded-lg px-2.5 py-2 text-center"
                      style={{ backgroundColor: '#0d0e14', border: '1px solid #1e2128' }}
                    >
                      <div className="text-base font-bold" style={{ color }}>{value}</div>
                      <div className="text-xs text-gray-600 mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>

                {/* Top movers */}
                <div className="mb-3">
                  <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
                    Top Movers This Week
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {marketReport.top_movers.slice(0, 3).map((mover) => (
                      <div
                        key={mover.item_name}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-gray-500 truncate flex-1 mr-2">
                          {mover.display_name}
                        </span>
                        <span
                          className="flex items-center gap-0.5 font-semibold flex-shrink-0"
                          style={{
                            color: mover.direction === 'up' ? '#ef4444' : '#4ade80',
                          }}
                        >
                          {mover.direction === 'up' ? (
                            <TrendingUp size={10} />
                          ) : (
                            <TrendingDown size={10} />
                          )}
                          {mover.direction === 'up' ? '+' : ''}
                          {mover.change_pct.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Link to VAULT */}
                <div
                  className="mt-3 pt-3 border-t text-xs text-gray-600 flex items-center justify-between"
                  style={{ borderColor: '#1e2128' }}
                >
                  <span>Generated by SCOUT · Monday 6 AM</span>
                  <button
                    className="flex items-center gap-1 text-green-600 hover:text-green-400 transition-colors font-medium"
                    onClick={() => {
                      // V2 integration: navigate to vault-estimate view
                      // onNavigate?.('vault-estimate')
                    }}
                  >
                    VAULT <ArrowRight size={10} />
                  </button>
                </div>
              </div>
            ) : (
              /* Fallback: original WeeklyDigest */
              <WeeklyDigest
                searches={DEFAULT_ITEMS.length}
                alerts={alertThisWeek}
                avgSavings={avgSavings}
              />
            )}

            {/* ── Price Alerts ─────────────────────────────────────────────────── */}
            <div
              className="rounded-xl border p-5"
              style={{ backgroundColor: '#111318', borderColor: '#1e2128' }}
            >
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle size={14} className="text-yellow-400" />
                <span className="text-sm font-semibold text-gray-200">
                  Price Alerts
                </span>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full ml-auto"
                  style={{
                    backgroundColor:
                      priceAlerts.length > 0 ? '#451a0388' : '#1a1c23',
                    color:
                      priceAlerts.length > 0 ? '#fbbf24' : '#4b5563',
                  }}
                >
                  {priceAlerts.length}
                </span>
              </div>

              {priceAlerts.length === 0 ? (
                <div className="text-center py-4">
                  <CheckCircle
                    size={24}
                    className="mx-auto mb-2 text-green-600"
                  />
                  <div className="text-xs text-gray-600">
                    All prices stable — no changes exceed the 5% threshold
                    this session.
                  </div>
                  <div className="text-xs text-gray-700 mt-1">
                    Alerts appear after materials are searched and re-fetched.
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {priceAlerts.map((alert, i) => (
                    <PriceAlertCard
                      key={`${alert.item_name}-${alert.supplier_name}-${i}`}
                      alert={alert}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ── Quick Search Suggestions ──────────────────────────────────────── */}
            <div
              className="rounded-xl border p-4"
              style={{ backgroundColor: '#111318', borderColor: '#1e2128' }}
            >
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Quick Searches
              </div>
              <div className="flex flex-col gap-1.5">
                {DEFAULT_ITEMS.map(item => (
                  <button
                    key={item}
                    onClick={() => {
                      setSearchQuery(item);
                    }}
                    className="text-left text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded-lg transition-colors hover:bg-gray-800/50 flex items-center gap-2"
                  >
                    <ChevronRight size={10} className="text-gray-700" />
                    {titleCase(item)}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Supplier Key ──────────────────────────────────────────────────── */}
            <div
              className="rounded-xl border p-4"
              style={{ backgroundColor: '#111318', borderColor: '#1e2128' }}
            >
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Suppliers
              </div>
              <div className="flex flex-col gap-2">
                {Object.entries(SUPPLIER_COLORS).map(([name, color]) => (
                  <div key={name} className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs text-gray-500">{name}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
