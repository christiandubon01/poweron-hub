/**
 * PULSE Dashboard Panel — Main financial operations dashboard
 *
 * Features:
 * - 4 KPI cards (revenue, pending, AR aging, margin)
 * - Revenue trend chart (actual vs target)
 * - Cash flow forecast chart
 * - AR aging breakdown table
 * - Auto-refresh every 5 minutes
 * - Loading and error states
 * - Dark theme (Tailwind)
 */

import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, TrendingDown, AlertTriangle, RefreshCw, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import { processPulseRequest, type PulseResponse } from '@/agents/pulse'
import { getHistoricalRevenue, type HistoricalRevenue } from '@/agents/pulse/kpiCalculator'
import { KPICard } from './KPICard'
import { lazy, Suspense } from 'react'
import ImportBackupButton from '@/components/ImportBackupButton'
import { getBackupData, getBackupKPIs, mapBackupWeeklyData } from '@/services/backupDataService'

// Lazy-load chart components (recharts may not be installed yet)
const RevenueChart = lazy(() =>
  import('./RevenueChart').then(m => ({ default: m.RevenueChart })).catch(() => ({
    default: () => (
      <div className="flex items-center justify-center h-[300px] bg-gray-800/30 rounded-lg border border-gray-700 text-gray-500 text-sm">
        Install recharts to view Revenue Chart
      </div>
    ),
  }))
)

const CashFlowChart = lazy(() =>
  import('./CashFlowChart').then(m => ({ default: m.CashFlowChart })).catch(() => ({
    default: () => (
      <div className="flex items-center justify-center h-[300px] bg-gray-800/30 rounded-lg border border-gray-700 text-gray-500 text-sm">
        Install recharts to view Cash Flow Chart
      </div>
    ),
  }))
)

// ── Types ────────────────────────────────────────────────────────────────────

interface DashboardState {
  kpis: PulseResponse | null
  cashFlow: PulseResponse | null
  arAging: PulseResponse | null
  trends: PulseResponse | null
  revenueHistory: HistoricalRevenue[] | null
  isLoading: boolean
  error: string | null
  lastRefresh: Date | null
}

// ── Component ────────────────────────────────────────────────────────────────

export function DashboardPanel({ orgId, userId }: { orgId: string; userId: string }) {
  const [state, setState] = useState<DashboardState>({
    kpis: null,
    cashFlow: null,
    arAging: null,
    trends: null,
    revenueHistory: null,
    isLoading: true,
    error: null,
    lastRefresh: null,
  })

  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true)

  // ── Data Fetching ────────────────────────────────────────────────────────

  const fetchAllData = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const [kpis, cashFlow, arAging, trends, revenueHistory] = await Promise.all([
        processPulseRequest({ action: 'get_kpis', orgId, userId }),
        processPulseRequest({ action: 'get_cash_flow', orgId, userId }),
        processPulseRequest({ action: 'get_ar_aging', orgId, userId }),
        processPulseRequest({ action: 'get_trends', orgId, userId }),
        getHistoricalRevenue(orgId, 12),
      ])

      setState(prev => ({
        ...prev,
        kpis,
        cashFlow,
        arAging,
        trends,
        revenueHistory,
        isLoading: false,
        lastRefresh: new Date(),
      }))
    } catch (err) {
      console.error('[PULSE Dashboard] fetch error:', err)
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: null, // suppress error — we'll show backup data instead
      }))
    }
  }, [orgId, userId])

  // Backup data fallback
  const backup = getBackupData()
  const rawBackupKPIs = backup ? getBackupKPIs(backup) : null
  const backupKPIs = rawBackupKPIs ? {
    totalRevenue: rawBackupKPIs.pipeline,
    projectCount: rawBackupKPIs.activeProjects,
    totalCollected: rawBackupKPIs.paid,
    totalMaterialCost: 0,
    totalProfit: rawBackupKPIs.paid - rawBackupKPIs.exposure,
    totalHours: rawBackupKPIs.totalHours,
    activeProjects: rawBackupKPIs.activeProjects,
  } : null
  const backupCashFlow = backup ? (mapBackupWeeklyData(backup) as any[]) : null
  const showBackupFallback = !state.isLoading && !state.kpis?.data && backupKPIs

  // Initial load
  useEffect(() => {
    fetchAllData()
  }, [fetchAllData])

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (!autoRefreshEnabled) return

    const interval = setInterval(fetchAllData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchAllData, autoRefreshEnabled])

  // ── Render ───────────────────────────────────────────────────────────────

  const kpiData = state.kpis?.data as any
  const arData = state.arAging?.data as any[]
  const cashFlowData = state.cashFlow?.data as any[]
  const trendsData = state.trends?.data as any[]

  // Map historical revenue to RevenueChart shape
  const revenueChartData = state.revenueHistory?.map(h => ({
    week: h.week.replace('Week ', 'W'),
    revenue: h.revenue,
    target: h.target,
    margin_pct: h.margin_pct,
  })) ?? undefined

  const isDataLoaded = !state.isLoading && state.kpis && state.cashFlow && state.arAging

  return (
    <div className="space-y-6 p-6 bg-gray-900 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100">Financial Dashboard</h1>
          <p className="mt-2 text-sm text-gray-400">
            Real-time KPIs, trends, and forecasts powered by PULSE
          </p>
        </div>

        <div className="flex items-center gap-3">
          {state.lastRefresh && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Clock size={14} />
              <span>Updated {formatTimeAgo(state.lastRefresh)}</span>
            </div>
          )}
          <button
            onClick={fetchAllData}
            disabled={state.isLoading}
            className={clsx(
              'flex items-center gap-2 px-3 py-2 rounded-lg font-medium transition-all',
              state.isLoading
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
            )}
          >
            <RefreshCw size={16} className={state.isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>

          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer hover:text-gray-300">
            <input
              type="checkbox"
              checked={autoRefreshEnabled}
              onChange={e => setAutoRefreshEnabled(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>
        </div>
      </div>

      {/* Import Backup Button — always visible */}
      <ImportBackupButton />

      {/* Backup KPI Cards — shown when Supabase returns nothing */}
      {showBackupFallback && backupKPIs && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              label="Total Contract Value"
              value={formatCurrency(backupKPIs.totalRevenue)}
              subtext={`${backupKPIs.projectCount} projects`}
              trend="up"
              trendPercent={0}
              warning={false}
            />
            <KPICard
              label="Total Collected"
              value={formatCurrency(backupKPIs.totalCollected)}
              subtext={`${backupKPIs.activeProjects} active projects`}
              trend={backupKPIs.totalCollected > 0 ? 'up' : 'flat'}
              trendPercent={0}
              warning={false}
            />
            <KPICard
              label="Material Spend"
              value={formatCurrency(backupKPIs.totalMaterialCost)}
              subtext={`${backupKPIs.totalHours.toFixed(1)} hours logged`}
              trend="flat"
              trendPercent={0}
              warning={false}
            />
            <KPICard
              label="Running Profit"
              value={formatCurrency(backupKPIs.totalProfit)}
              subtext="From latest field log"
              trend={backupKPIs.totalProfit > 0 ? 'up' : 'down'}
              trendPercent={0}
              warning={backupKPIs.totalProfit < 0}
            />
          </div>

          {/* Cash Flow from backup */}
          {backupCashFlow && backupCashFlow.length > 0 && (
            <div className="rounded-lg bg-gray-800/50 border border-gray-700/50 p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-4">Cash Flow (from backup)</h3>
              <Suspense fallback={<div className="h-[300px] flex items-center justify-center text-gray-500">Loading chart...</div>}>
                <CashFlowChart data={backupCashFlow} />
              </Suspense>
            </div>
          )}
        </>
      )}

      {/* Error State */}
      {state.error && (
        <div className="flex items-gap-3 gap-3 rounded-lg bg-red-900/20 border border-red-700/50 p-4">
          <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-300">Error Loading Data</h3>
            <p className="mt-1 text-sm text-red-200">{state.error}</p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {state.isLoading && !isDataLoaded && (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 bg-gray-800 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* KPI Cards */}
      {isDataLoaded && kpiData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            label="Revenue Received"
            value={formatCurrency(kpiData.revenue_received)}
            subtext={`${kpiData.active_projects} active projects`}
            trend={kpiData.revenue_received > 0 ? 'up' : 'flat'}
            trendPercent={5}
            warning={false}
          />

          <KPICard
            label="Revenue Pending"
            value={formatCurrency(kpiData.revenue_pending)}
            subtext={`${kpiData.dso_days.toFixed(0)} days DSO`}
            trend={kpiData.dso_days > 45 ? 'up' : 'down'}
            trendPercent={kpiData.dso_days > 45 ? 2 : -2}
            warning={kpiData.dso_days > 45}
          />

          <KPICard
            label="AR 90+ Days"
            value={formatCurrency(kpiData.overdue_amount)}
            subtext={`${kpiData.overdue_count} invoices`}
            trend={kpiData.overdue_amount > 5000 ? 'up' : 'down'}
            trendPercent={0}
            warning={kpiData.overdue_amount > 5000}
          />

          <KPICard
            label="Avg Margin"
            value={`${kpiData.avg_margin_pct.toFixed(1)}%`}
            subtext="Target: 18-22%"
            trend={kpiData.avg_margin_pct > 18 ? 'up' : 'down'}
            trendPercent={0}
            warning={kpiData.avg_margin_pct < 12}
          />
        </div>
      )}

      {/* Summary Text */}
      {state.kpis?.summary && (
        <div className="rounded-lg bg-gray-800/50 border border-gray-700/50 p-4">
          <p className="text-sm text-gray-300 leading-relaxed">{state.kpis.summary}</p>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        {isDataLoaded && (
          <div className="rounded-lg bg-gray-800/50 border border-gray-700/50 p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4">Revenue Trend</h3>
            <Suspense fallback={<div className="h-[300px] flex items-center justify-center text-gray-500">Loading chart...</div>}>
              <RevenueChart data={revenueChartData} />
            </Suspense>
          </div>
        )}

        {/* Cash Flow Chart */}
        {isDataLoaded && (
          <div className="rounded-lg bg-gray-800/50 border border-gray-700/50 p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4">Cash Flow Forecast</h3>
            <Suspense fallback={<div className="h-[300px] flex items-center justify-center text-gray-500">Loading chart...</div>}>
              <CashFlowChart data={cashFlowData} />
            </Suspense>
          </div>
        )}
      </div>

      {/* AR Aging Table */}
      {isDataLoaded && arData && (
        <div className="rounded-lg bg-gray-800/50 border border-gray-700/50 p-6">
          <h3 className="text-lg font-semibold text-gray-100 mb-4">AR Aging Breakdown</h3>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-700">
                <tr>
                  <th className="text-left py-3 px-4 text-gray-300 font-semibold">Days</th>
                  <th className="text-right py-3 px-4 text-gray-300 font-semibold">Count</th>
                  <th className="text-right py-3 px-4 text-gray-300 font-semibold">Amount</th>
                  <th className="text-right py-3 px-4 text-gray-300 font-semibold">% of Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {arData.map(bucket => (
                  <tr
                    key={bucket.bucket}
                    className={clsx(
                      'hover:bg-gray-700/30 transition-colors',
                      bucket.bucket === '90+' && bucket.total_amount > 5000 && 'bg-red-900/10'
                    )}
                  >
                    <td className="py-3 px-4 text-gray-300">{bucket.bucket} days</td>
                    <td className="py-3 px-4 text-right text-gray-300">{bucket.invoice_count}</td>
                    <td className="py-3 px-4 text-right text-gray-300">{formatCurrency(bucket.total_amount)}</td>
                    <td className="py-3 px-4 text-right">
                      <span
                        className={clsx(
                          'font-semibold',
                          bucket.bucket === '0-30' && 'text-emerald-400',
                          bucket.bucket === '30-60' && 'text-yellow-400',
                          bucket.bucket === '60-90' && 'text-orange-400',
                          bucket.bucket === '90+' && 'text-red-400'
                        )}
                      >
                        {bucket.pct_of_total.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {state.arAging?.summary && (
            <p className="mt-4 text-xs text-gray-400 italic">{state.arAging.summary}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Utilities ────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
