// @ts-nocheck
/**
 * MaterialVariancePanel — VAULT Material Variance Tracker UI
 *
 * Displays a per-project breakdown of estimated vs actual material spend,
 * highlights over-budget phases, and shows variance alerts.
 */

import { useState, useEffect } from 'react'
import { AlertTriangle, TrendingDown, TrendingUp, CheckCircle, RefreshCw, Package, Camera } from 'lucide-react'
import ReceiptScanModal from './ReceiptScanModal'
import {
  getOrgVarianceSummary,
  type VarianceSummary,
  type PhaseVariance,
  type VarianceAlert,
} from '@/services/materialVariance'

// ── Component ────────────────────────────────────────────────────────────────

export default function MaterialVariancePanel({ orgId }: { orgId: string }) {
  const [summary, setSummary] = useState<VarianceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [showScanModal, setShowScanModal] = useState(false)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const data = await getOrgVarianceSummary(orgId)
      setSummary(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load variance data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [orgId])

  if (loading) {
    return (
      <div className="p-6 bg-gray-900 min-h-full">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-800 rounded w-1/3" />
          <div className="h-32 bg-gray-800 rounded" />
          <div className="h-32 bg-gray-800 rounded" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 bg-gray-900 min-h-full">
        <div className="flex items-center gap-3 bg-red-900/20 border border-red-700/50 rounded-lg p-4">
          <AlertTriangle className="text-red-400" size={20} />
          <p className="text-red-300 text-sm">{error}</p>
          <button onClick={loadData} className="ml-auto text-red-400 hover:text-red-300">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
    )
  }

  const hasData = summary && summary.projects.length > 0

  return (
    <div className="p-6 bg-gray-900 min-h-full space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Package className="text-emerald-400" size={28} />
            Material Variance Tracker
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Estimated vs actual material spend by project and phase
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowScanModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-colors text-sm"
          >
            <Camera size={14} />
            Scan Receipt
          </button>
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors text-sm"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Alerts */}
      {summary && summary.alerts.length > 0 && (
        <div className="space-y-2">
          {summary.alerts.slice(0, 5).map((alert, i) => (
            <AlertBanner key={i} alert={alert} />
          ))}
        </div>
      )}

      {/* Summary Cards */}
      {hasData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SummaryCard
            label="Total Estimated"
            value={fmt(summary!.totalEstimated)}
            sub="From material takeoffs"
            color="gray"
          />
          <SummaryCard
            label="Total Actual"
            value={fmt(summary!.totalActual)}
            sub="From receipts & field logs"
            color={summary!.totalVariance > 0 ? 'red' : 'emerald'}
          />
          <SummaryCard
            label="Net Variance"
            value={(summary!.totalVariance >= 0 ? '+' : '') + fmt(summary!.totalVariance)}
            sub={summary!.totalVariance > 0 ? 'Over budget' : summary!.totalVariance < 0 ? 'Under budget' : 'On budget'}
            color={summary!.totalVariance > 0 ? 'red' : summary!.totalVariance < 0 ? 'emerald' : 'gray'}
          />
        </div>
      )}

      {/* Empty State */}
      {!hasData && (
        <div className="text-center py-16">
          <Package className="mx-auto text-gray-600" size={48} />
          <h3 className="mt-4 text-lg font-medium text-gray-400">No variance data yet</h3>
          <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
            Material receipts are automatically created when you save field logs with material costs.
            Add a material takeoff estimate to see budget comparisons.
          </p>
        </div>
      )}

      {/* Receipt Scan Modal */}
      {showScanModal && (
        <ReceiptScanModal
          orgId={orgId}
          onClose={() => setShowScanModal(false)}
          onSaved={() => { setShowScanModal(false); loadData() }}
        />
      )}

      {/* Project Breakdown */}
      {hasData && summary!.projects.map(proj => (
        <div
          key={proj.projectId}
          className="rounded-xl bg-gray-800/50 border border-gray-700/50 overflow-hidden"
        >
          {/* Project Header */}
          <button
            onClick={() => setExpandedProject(
              expandedProject === proj.projectId ? null : proj.projectId
            )}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-800/80 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${
                proj.overBudgetPhases > 0 ? 'bg-red-500' :
                proj.totalVariance < 0 ? 'bg-emerald-500' : 'bg-gray-500'
              }`} />
              <div className="text-left">
                <h3 className="text-white font-semibold">{proj.projectName}</h3>
                <p className="text-gray-400 text-xs">
                  {proj.phases.length} phases tracked • {proj.overBudgetPhases} over budget
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className={`font-bold ${
                proj.totalVariance > 0 ? 'text-red-400' :
                proj.totalVariance < 0 ? 'text-emerald-400' : 'text-gray-300'
              }`}>
                {proj.totalVariance >= 0 ? '+' : ''}{fmt(proj.totalVariance)}
              </p>
              <p className="text-gray-500 text-xs">
                {proj.totalActual > 0 ? `${fmt(proj.totalActual)} actual` : 'No spend'}
              </p>
            </div>
          </button>

          {/* Expanded Phase Detail */}
          {expandedProject === proj.projectId && (
            <div className="border-t border-gray-700/50">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs">
                    <th className="text-left py-2 px-4">Phase</th>
                    <th className="text-right py-2 px-4">Estimated</th>
                    <th className="text-right py-2 px-4">Actual</th>
                    <th className="text-right py-2 px-4">Variance</th>
                    <th className="text-right py-2 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/30">
                  {proj.phases.map(ph => (
                    <tr key={ph.phase} className="hover:bg-gray-700/20">
                      <td className="py-2.5 px-4 text-gray-300">{ph.phase}</td>
                      <td className="py-2.5 px-4 text-right text-gray-400">
                        {ph.estimated > 0 ? fmt(ph.estimated) : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-300">
                        {fmt(ph.actual)}
                      </td>
                      <td className={`py-2.5 px-4 text-right font-medium ${
                        ph.variance > 0 ? 'text-red-400' :
                        ph.variance < 0 ? 'text-emerald-400' : 'text-gray-400'
                      }`}>
                        {ph.estimated > 0
                          ? `${ph.variance >= 0 ? '+' : ''}${fmt(ph.variance)} (${ph.variancePct.toFixed(0)}%)`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <StatusBadge status={ph.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Sub Components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color }: {
  label: string; value: string; sub: string; color: string
}) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    gray: 'text-gray-300',
  }
  return (
    <div className="rounded-lg bg-gray-800/50 border border-gray-700/50 p-4">
      <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colors[color] || 'text-gray-300'}`}>{value}</p>
      <p className="text-gray-500 text-xs mt-1">{sub}</p>
    </div>
  )
}

function AlertBanner({ alert }: { alert: VarianceAlert }) {
  const Icon = alert.level === 'critical' ? AlertTriangle : TrendingUp
  const bgClass = alert.level === 'critical'
    ? 'bg-red-900/20 border-red-700/50'
    : 'bg-yellow-900/20 border-yellow-700/50'
  const textClass = alert.level === 'critical' ? 'text-red-300' : 'text-yellow-300'
  const iconClass = alert.level === 'critical' ? 'text-red-400' : 'text-yellow-400'

  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3 ${bgClass}`}>
      <Icon size={16} className={iconClass} />
      <p className={`text-sm ${textClass}`}>
        <span className="font-semibold">{alert.projectName}</span>
        {alert.phase && <span className="text-gray-400"> / {alert.phase}</span>}
        {' — '}{alert.message}
      </p>
    </div>
  )
}

function StatusBadge({ status }: { status: PhaseVariance['status'] }) {
  const config = {
    over_budget:  { label: 'Over',   bg: 'bg-red-500/20',     text: 'text-red-400' },
    on_budget:    { label: 'On Track', bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
    under_budget: { label: 'Under',  bg: 'bg-cyan-500/20',    text: 'text-cyan-400' },
    no_estimate:  { label: 'No Est', bg: 'bg-gray-500/20',    text: 'text-gray-400' },
  }[status]

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}
