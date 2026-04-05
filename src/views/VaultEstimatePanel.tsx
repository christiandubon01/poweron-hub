/**
 * src/views/VaultEstimatePanel.tsx
 * VAULT Estimate Panel — V3-27
 *
 * Connects material intelligence to the VAULT price book and estimates.
 * Features:
 *   - Price competitiveness indicator (colored dot) per line item
 *   - "Check Market" button opens mini-panel: top 3 suppliers, stock, lead time
 *   - "Update Price" button per supplier (user-initiated, no auto-update)
 *   - Supplier credit gate badges (credit application / min order requirements)
 *   - Estimate summary with VAULT total vs market-optimized total
 *
 * V2 integration notes:
 *   - Replace MOCK_ESTIMATE_ITEMS with Supabase fetch from `estimate_line_items`
 *   - Wire "Update Price" to persist to `vault_price_book` table
 *   - Add `estimate_id` prop once the estimate context is available
 */

import { useState, useEffect, useCallback } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CreditCard,
  ShoppingCart,
  RefreshCw,
  X,
  Zap,
  Package,
} from 'lucide-react';
import {
  searchMaterialPricing,
  comparePrices,
  type SupplierResult,
} from '../services/materialIntelligence';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface EstimateLineItem {
  id: string;
  description: string;
  itemKey: string;           // normalized key for materialIntelligence lookup
  qty: number;
  unit: string;
  vaultPrice: number;        // current VAULT price book price
  category: string;
}

type CompetitivenessStatus = 'green' | 'yellow' | 'red' | 'loading' | 'unknown';

interface CompetitivenessData {
  status: CompetitivenessStatus;
  diff_pct: number;
  market_best: number;
  market_best_supplier: string;
  results: SupplierResult[];
}

// ─── Supplier Credit Requirements ─────────────────────────────────────────────

/**
 * Credit gate info per supplier.
 * "requires_credit": show "Requires credit application" badge.
 * "min_order_value": show "Min order: $X" badge when order < threshold.
 */
const SUPPLIER_CREDIT_INFO: Record<string, {
  requires_credit: boolean;
  credit_label?: string;
  min_order_value?: number;
  min_order_label?: string;
}> = {
  'Graybar': {
    requires_credit: false,
    min_order_value: 50,
    min_order_label: 'Min order: $50',
  },
  'Rexel': {
    requires_credit: false,
    min_order_value: 50,
    min_order_label: 'Min order: $50',
  },
  'WESCO': {
    requires_credit: true,
    credit_label: 'Requires credit application',
    min_order_value: 500,
    min_order_label: 'Min order: $500',
  },
  'Home Depot Pro': {
    requires_credit: true,
    credit_label: 'Requires Pro account',
    min_order_value: 0,
  },
  'Local Supplier': {
    requires_credit: false,
    min_order_value: 0,
  },
};

// ─── Mock Estimate Data ────────────────────────────────────────────────────────

/**
 * Mock estimate line items for "Riverside Commercial Buildout".
 * Vault prices intentionally span green / yellow / red states for demo.
 * V2 integration: replace with Supabase fetch from `estimate_line_items`.
 */
const MOCK_ESTIMATE_ITEMS: EstimateLineItem[] = [
  {
    id: 'li-001',
    description: '12 AWG THHN Black — Service Rough-In',
    itemKey: 'thhn wire 12 awg black',
    qty: 5,
    unit: '1000ft spool',
    vaultPrice: 89.50,
    category: 'wire',
  },
  {
    id: 'li-002',
    description: '10 AWG THHN Black — Feeder Runs',
    itemKey: 'thhn wire 10 awg black',
    qty: 3,
    unit: '500ft spool',
    vaultPrice: 94.00,
    category: 'wire',
  },
  {
    id: 'li-003',
    description: '3/4" EMT Conduit 10ft — Branch Circuits',
    itemKey: '3/4 emt conduit 10ft',
    qty: 50,
    unit: 'stick (10ft)',
    vaultPrice: 11.50,   // intentionally above market for RED demo
    category: 'conduit',
  },
  {
    id: 'li-004',
    description: 'Square D 20A Single Pole Breaker',
    itemKey: 'square d 20a single pole breaker',
    qty: 24,
    unit: 'each',
    vaultPrice: 12.50,
    category: 'breakers',
  },
  {
    id: 'li-005',
    description: 'Square D 200A 40-Circuit Main Panel',
    itemKey: 'square d 200a 40-circuit panel',
    qty: 1,
    unit: 'each',
    vaultPrice: 385.00,
    category: 'panels',
  },
  {
    id: 'li-006',
    description: 'Leviton 20A TR Receptacle — Commercial Grade',
    itemKey: 'leviton 20a tamper resistant receptacle',
    qty: 30,
    unit: 'each',
    vaultPrice: 5.50,
    category: 'devices',
  },
  {
    id: 'li-007',
    description: 'Leviton 20A Decora GFCI — Wet Locations',
    itemKey: 'leviton 20a decora gfci',
    qty: 8,
    unit: 'each',
    vaultPrice: 28.00,   // intentionally above market for RED demo
    category: 'devices',
  },
  {
    id: 'li-008',
    description: '4" Square Box 1-1/2" Deep — J-Boxes',
    itemKey: '4 square box 1-1/2 deep',
    qty: 40,
    unit: 'each',
    vaultPrice: 3.25,
    category: 'boxes',
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

function getCompetitivenessStatus(
  vaultPrice: number,
  results: SupplierResult[],
): Omit<CompetitivenessData, 'results'> | null {
  if (!results.length) return null;
  const market_best = Math.min(...results.map((r) => r.price));
  const bestResult  = results.find((r) => r.price === market_best)!;
  const diff_pct    = ((vaultPrice - market_best) / market_best) * 100;

  let status: CompetitivenessStatus;
  if (diff_pct <= 10)        status = 'green';
  else if (diff_pct <= 25)   status = 'yellow';
  else                       status = 'red';

  return {
    status,
    diff_pct,
    market_best,
    market_best_supplier: bestResult.supplier_name,
  };
}

const STATUS_DOT_COLORS: Record<CompetitivenessStatus, string> = {
  green:   '#22c55e',
  yellow:  '#f59e0b',
  red:     '#ef4444',
  loading: '#4b5563',
  unknown: '#4b5563',
};

const STATUS_LABELS: Record<CompetitivenessStatus, string> = {
  green:   'Competitive',
  yellow:  'Review',
  red:     'Above Market',
  loading: 'Loading…',
  unknown: 'No Data',
};

// ─── Price Competitiveness Dot ─────────────────────────────────────────────────

function CompetitivenessDot({
  status,
  vaultPrice,
  data,
}: {
  status: CompetitivenessStatus;
  vaultPrice: number;
  data: CompetitivenessData | null;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const color = STATUS_DOT_COLORS[status];

  return (
    <div className="relative flex items-center">
      <button
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        className="flex items-center gap-1.5 group"
        aria-label={`Price status: ${STATUS_LABELS[status]}`}
      >
        {/* Colored dot */}
        <span
          className="inline-block rounded-full flex-shrink-0"
          style={{
            width: 10,
            height: 10,
            backgroundColor: color,
            boxShadow: status !== 'loading' && status !== 'unknown'
              ? `0 0 6px ${color}88`
              : undefined,
          }}
        />
        <span
          className="text-xs font-medium"
          style={{ color }}
        >
          {STATUS_LABELS[status]}
        </span>
      </button>

      {/* Tooltip */}
      {showTooltip && data && data.status !== 'loading' && data.status !== 'unknown' && (
        <div
          className="absolute left-0 bottom-full mb-2 z-50 rounded-lg border px-3 py-2 text-xs shadow-xl min-w-56"
          style={{ backgroundColor: '#1a1c24', borderColor: '#2d3040', whiteSpace: 'nowrap' }}
        >
          <div className="flex items-center gap-1.5 mb-1.5 font-semibold text-gray-200">
            Market Best
          </div>
          <div className="flex justify-between gap-4 text-gray-400">
            <span>Market best:</span>
            <span className="text-green-400 font-medium">
              {fmt(data.market_best)} @ {data.market_best_supplier}
            </span>
          </div>
          <div className="flex justify-between gap-4 text-gray-400">
            <span>Your price:</span>
            <span className="text-gray-200 font-medium">{fmt(vaultPrice)}</span>
          </div>
          <div className="flex justify-between gap-4 mt-1 pt-1.5 border-t" style={{ borderColor: '#2d3040' }}>
            <span className="text-gray-500">Difference:</span>
            <span
              className="font-semibold"
              style={{ color: STATUS_DOT_COLORS[data.status] }}
            >
              {data.diff_pct > 0 ? '+' : ''}{data.diff_pct.toFixed(1)}%
              {data.diff_pct > 0 ? ' above' : ' below'} market
            </span>
          </div>
          {/* Tooltip arrow */}
          <div
            className="absolute left-3 top-full"
            style={{
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid #2d3040',
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Supplier Credit Badge ─────────────────────────────────────────────────────

function CreditBadge({ label, type }: { label: string; type: 'credit' | 'min_order' }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0"
      style={
        type === 'credit'
          ? { backgroundColor: '#1a0a00', borderColor: '#92400e', color: '#fbbf24' }
          : { backgroundColor: '#0c0c1a', borderColor: '#3730a3', color: '#a5b4fc' }
      }
    >
      {type === 'credit' ? <CreditCard size={9} /> : <ShoppingCart size={9} />}
      {label}
    </span>
  );
}

// ─── Check Market Mini-Panel ───────────────────────────────────────────────────

function CheckMarketPanel({
  item,
  results,
  onUpdatePrice,
  onClose,
}: {
  item: EstimateLineItem;
  results: SupplierResult[];
  onUpdatePrice: (supplier: SupplierResult) => void;
  onClose: () => void;
}) {
  // Show top 3 suppliers by price (ascending)
  const top3 = [...results].sort((a, b) => a.price - b.price).slice(0, 3);

  return (
    <div
      className="mt-3 rounded-xl border p-4"
      style={{ backgroundColor: '#0d0e14', borderColor: '#2d3040' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Package size={13} className="text-green-400" />
          <span className="text-sm font-semibold text-gray-200">Market Check</span>
          <span className="text-xs text-gray-600">Top 3 suppliers</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-600 hover:text-gray-400 transition-colors"
          aria-label="Close market panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Supplier rows */}
      <div className="flex flex-col gap-2">
        {top3.map((result, idx) => {
          const creditInfo = SUPPLIER_CREDIT_INFO[result.supplier_name];
          const isCheapest = idx === 0;
          const savings    = item.vaultPrice - result.price;

          return (
            <div
              key={result.supplier_name}
              className="rounded-lg border px-3 py-2.5"
              style={{
                backgroundColor: isCheapest ? '#051a0e' : '#111318',
                borderColor:     isCheapest ? '#16a34a55' : '#1e2128',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                {/* Supplier name + price */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {isCheapest && (
                      <span
                        className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: '#16a34a22', color: '#4ade80', border: '1px solid #16a34a44' }}
                      >
                        Best
                      </span>
                    )}
                    <span className="text-sm font-medium text-gray-200 truncate">
                      {result.supplier_name}
                    </span>
                  </div>

                  {/* Stock + lead time */}
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      {result.in_stock ? (
                        <CheckCircle size={10} className="text-green-500" />
                      ) : (
                        <XCircle size={10} className="text-red-500" />
                      )}
                      {result.in_stock ? 'In Stock' : 'Out of Stock'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {result.lead_time_days === 0 ? 'Same-day' : `${result.lead_time_days}d lead`}
                    </span>
                    <span className="flex items-center gap-1">
                      <ShoppingCart size={10} />
                      Min: {result.minimum_order}
                    </span>
                  </div>

                  {/* Credit gate badges */}
                  {creditInfo && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {creditInfo.requires_credit && creditInfo.credit_label && (
                        <CreditBadge label={creditInfo.credit_label} type="credit" />
                      )}
                      {creditInfo.min_order_value !== undefined && creditInfo.min_order_value > 0 && (
                        <CreditBadge label={creditInfo.min_order_label ?? `Min: $${creditInfo.min_order_value}`} type="min_order" />
                      )}
                    </div>
                  )}

                  {/* Notes */}
                  {result.notes && (
                    <div className="text-xs text-yellow-700 mt-1 flex items-center gap-1">
                      <AlertTriangle size={9} />
                      {result.notes}
                    </div>
                  )}
                </div>

                {/* Price + Update button */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <div className="text-right">
                    <div
                      className="text-base font-bold"
                      style={{ color: isCheapest ? '#4ade80' : '#f9fafb' }}
                    >
                      {fmt(result.price)}
                    </div>
                    <div className="text-xs text-gray-600">/ {result.unit}</div>
                    {savings > 0.01 && (
                      <div className="text-xs text-green-600 font-medium">
                        Save {fmt(savings)}/unit
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onUpdatePrice(result)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors"
                    style={{
                      backgroundColor: '#16a34a22',
                      color: '#4ade80',
                      border: '1px solid #16a34a55',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#16a34a44';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#16a34a22';
                    }}
                  >
                    <Zap size={10} />
                    Update Price
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-700 mt-3 flex items-center gap-1">
        <AlertTriangle size={9} />
        Clicking "Update Price" updates your VAULT price book for this item.
      </p>
    </div>
  );
}

// ─── Line Item Row ─────────────────────────────────────────────────────────────

function LineItemRow({
  item,
  marketData,
  isLoadingMarket,
  isExpanded,
  acceptedPrice,
  onCheckMarket,
  onUpdatePrice,
  onToggleExpand,
}: {
  item: EstimateLineItem;
  marketData: CompetitivenessData | null;
  isLoadingMarket: boolean;
  isExpanded: boolean;
  acceptedPrice: { price: number; supplier: string } | null;
  onCheckMarket: () => void;
  onUpdatePrice: (supplier: SupplierResult) => void;
  onToggleExpand: () => void;
}) {
  const effectiveVaultPrice = acceptedPrice ? acceptedPrice.price : item.vaultPrice;
  const extendedTotal       = effectiveVaultPrice * item.qty;

  let competitivenessData: CompetitivenessData | null = null;
  let status: CompetitivenessStatus = 'unknown';

  if (isLoadingMarket) {
    status = 'loading';
  } else if (marketData) {
    competitivenessData = marketData;
    status = marketData.status;
    // If price was updated, recompute status against new vault price
    if (acceptedPrice) {
      const comp = getCompetitivenessStatus(acceptedPrice.price, marketData.results);
      if (comp) {
        status = comp.status;
        competitivenessData = { ...marketData, ...comp };
      }
    }
  }

  return (
    <div
      className="border-b last:border-b-0"
      style={{ borderColor: '#1e2128' }}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Description + competitiveness */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 truncate font-medium">
                {item.description}
              </p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-gray-600">
                  {item.qty} × {fmt(effectiveVaultPrice)}/{item.unit}
                </span>
                {acceptedPrice && (
                  <span
                    className="text-xs font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-1"
                    style={{ backgroundColor: '#16a34a22', color: '#4ade80', border: '1px solid #16a34a44' }}
                  >
                    <CheckCircle size={9} />
                    Updated · {acceptedPrice.supplier}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Competitiveness dot */}
        <div className="flex-shrink-0 w-32">
          <CompetitivenessDot
            status={status}
            vaultPrice={effectiveVaultPrice}
            data={competitivenessData}
          />
        </div>

        {/* Extended total */}
        <div className="flex-shrink-0 w-24 text-right">
          <span className="text-sm font-semibold text-gray-200">
            {fmt(extendedTotal)}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Check Market button */}
          <button
            onClick={isExpanded ? onToggleExpand : onCheckMarket}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{
              backgroundColor: isExpanded ? '#1e2128' : '#0c1a2e',
              color:           isExpanded ? '#9ca3af' : '#60a5fa',
              border: `1px solid ${isExpanded ? '#2d3040' : '#1d4ed855'}`,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = isExpanded ? '#2d3040' : '#1d4ed822';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = isExpanded ? '#1e2128' : '#0c1a2e';
            }}
          >
            {isLoadingMarket ? (
              <RefreshCw size={10} className="animate-spin" />
            ) : isExpanded ? (
              <ChevronUp size={10} />
            ) : (
              <ChevronDown size={10} />
            )}
            {isExpanded ? 'Close' : 'Check Market'}
          </button>
        </div>
      </div>

      {/* Expanded mini-panel */}
      {isExpanded && marketData && (
        <div className="px-4 pb-4">
          <CheckMarketPanel
            item={item}
            results={marketData.results}
            onUpdatePrice={onUpdatePrice}
            onClose={onToggleExpand}
          />
        </div>
      )}
    </div>
  );
}

// ─── VaultEstimatePanel ────────────────────────────────────────────────────────

export default function VaultEstimatePanel() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [marketData, setMarketData] = useState<Record<string, CompetitivenessData>>({});
  const [loadingItems, setLoadingItems] = useState<Record<string, boolean>>({});
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [acceptedPrices, setAcceptedPrices] = useState<
    Record<string, { price: number; supplier: string }>
  >({});
  const [isFetchingAll, setIsFetchingAll] = useState(false);

  // ── Pre-load market data for all line items ────────────────────────────────
  useEffect(() => {
    async function preload() {
      setIsFetchingAll(true);
      const loadingState: Record<string, boolean> = {};
      MOCK_ESTIMATE_ITEMS.forEach((item) => {
        loadingState[item.id] = true;
      });
      setLoadingItems(loadingState);

      const results: Record<string, CompetitivenessData> = {};
      await Promise.all(
        MOCK_ESTIMATE_ITEMS.map(async (item) => {
          const supplierResults = await searchMaterialPricing(item.itemKey);
          const comp = getCompetitivenessStatus(item.vaultPrice, supplierResults);
          if (comp) {
            results[item.id] = { ...comp, results: supplierResults };
          }
          setLoadingItems((prev) => ({ ...prev, [item.id]: false }));
        }),
      );

      setMarketData(results);
      setIsFetchingAll(false);
    }
    void preload();
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleCheckMarket = useCallback(
    async (item: EstimateLineItem) => {
      setExpandedItemId(item.id);
      // If we already have data, just expand — no refetch needed
      if (marketData[item.id]) return;

      setLoadingItems((prev) => ({ ...prev, [item.id]: true }));
      const results = await searchMaterialPricing(item.itemKey);
      const comp    = getCompetitivenessStatus(item.vaultPrice, results);
      if (comp) {
        setMarketData((prev) => ({ ...prev, [item.id]: { ...comp, results } }));
      }
      setLoadingItems((prev) => ({ ...prev, [item.id]: false }));
    },
    [marketData],
  );

  const handleUpdatePrice = useCallback(
    (itemId: string, supplier: SupplierResult) => {
      setAcceptedPrices((prev) => ({
        ...prev,
        [itemId]: { price: supplier.price, supplier: supplier.supplier_name },
      }));
      // Recompute competitiveness for updated price
      setMarketData((prev) => {
        const existing = prev[itemId];
        if (!existing) return prev;
        const comp = getCompetitivenessStatus(supplier.price, existing.results);
        if (!comp) return prev;
        return { ...prev, [itemId]: { ...comp, results: existing.results } };
      });
      setExpandedItemId(null);
    },
    [],
  );

  const handleToggleExpand = useCallback((itemId: string) => {
    setExpandedItemId((prev) => (prev === itemId ? null : itemId));
  }, []);

  // ── Derived Totals ─────────────────────────────────────────────────────────

  const vaultTotal = MOCK_ESTIMATE_ITEMS.reduce((sum, item) => {
    const price = acceptedPrices[item.id]?.price ?? item.vaultPrice;
    return sum + price * item.qty;
  }, 0);

  const marketOptimalTotal = MOCK_ESTIMATE_ITEMS.reduce((sum, item) => {
    const data = marketData[item.id];
    const price = data ? data.market_best : (acceptedPrices[item.id]?.price ?? item.vaultPrice);
    return sum + price * item.qty;
  }, 0);

  const potentialSavings = vaultTotal - marketOptimalTotal;

  // Status counts
  const statusCounts = MOCK_ESTIMATE_ITEMS.reduce(
    (acc, item) => {
      const data = marketData[item.id];
      if (data) acc[data.status] = (acc[data.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: '#0a0b0f', color: '#e5e7eb' }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 px-6 py-5 border-b"
        style={{ backgroundColor: '#0d0e14', borderColor: '#1e2128' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <DollarSign size={16} className="text-green-400" />
              <h1 className="text-lg font-bold text-gray-100">VAULT Estimate</h1>
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full border"
                style={{ color: '#4ade80', borderColor: '#16a34a33', backgroundColor: '#052e1688' }}
              >
                EST-2026-031
              </span>
            </div>
            <p className="text-sm text-gray-500">
              Riverside Commercial Buildout · Phase 2 — Panel & Service
            </p>
          </div>

          {/* VAULT vs Market Summary Pills */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {isFetchingAll && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <RefreshCw size={11} className="animate-spin" />
                Fetching market prices…
              </div>
            )}
            <div className="flex items-center gap-2">
              {[
                { label: 'Competitive', color: '#22c55e', count: statusCounts['green'] ?? 0 },
                { label: 'Review',      color: '#f59e0b', count: statusCounts['yellow'] ?? 0 },
                { label: 'Above Mkt',   color: '#ef4444', count: statusCounts['red'] ?? 0 },
              ].map(({ label, color, count }) => (
                <div
                  key={label}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border"
                  style={{ borderColor: `${color}44`, backgroundColor: `${color}11`, color }}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  {count} {label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Totals bar */}
        <div
          className="flex items-center gap-6 mt-4 pt-4 border-t"
          style={{ borderColor: '#1e2128' }}
        >
          <div>
            <p className="text-xs text-gray-600 mb-0.5">VAULT Total</p>
            <p className="text-xl font-bold text-gray-100">{fmt(vaultTotal)}</p>
          </div>
          <div className="h-8 w-px" style={{ backgroundColor: '#1e2128' }} />
          <div>
            <p className="text-xs text-gray-600 mb-0.5">Market Optimal</p>
            <p className="text-xl font-bold text-green-400">{fmt(marketOptimalTotal)}</p>
          </div>
          {potentialSavings > 0 && (
            <>
              <div className="h-8 w-px" style={{ backgroundColor: '#1e2128' }} />
              <div>
                <p className="text-xs text-gray-600 mb-0.5">Potential Savings</p>
                <div className="flex items-center gap-1.5">
                  <TrendingDown size={16} className="text-green-400" />
                  <p className="text-xl font-bold text-green-400">{fmt(potentialSavings)}</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Table Header ───────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b text-xs font-semibold uppercase tracking-wider text-gray-600"
        style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
      >
        <div className="flex-1">Item Description</div>
        <div className="w-32">Price Status</div>
        <div className="w-24 text-right">Extended</div>
        <div className="w-28" />
      </div>

      {/* ── Line Items ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: '#0f1014' }}>
        {MOCK_ESTIMATE_ITEMS.map((item) => (
          <LineItemRow
            key={item.id}
            item={item}
            marketData={marketData[item.id] ?? null}
            isLoadingMarket={loadingItems[item.id] ?? false}
            isExpanded={expandedItemId === item.id}
            acceptedPrice={acceptedPrices[item.id] ?? null}
            onCheckMarket={() => handleCheckMarket(item)}
            onUpdatePrice={(supplier) => handleUpdatePrice(item.id, supplier)}
            onToggleExpand={() => handleToggleExpand(item.id)}
          />
        ))}
      </div>

      {/* ── Footer Legend ──────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-t text-xs text-gray-700"
        style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
      >
        <div className="flex items-center gap-5">
          {[
            { color: '#22c55e', label: 'Within 10% of market best' },
            { color: '#f59e0b', label: '10–25% above market' },
            { color: '#ef4444', label: '>25% above market' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              {label}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1 text-gray-700">
          <TrendingUp size={11} />
          Market data sourced from SCOUT · Updated hourly
        </div>
      </div>
    </div>
  );
}
