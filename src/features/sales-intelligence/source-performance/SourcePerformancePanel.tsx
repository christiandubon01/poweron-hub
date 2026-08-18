/**
 * LEAD-SRC-6 — Source Performance panel for Sales Intelligence Coach.
 *
 * All-time rollup of hunter_leads + hunter_conversion_receipts.
 * Converted Value uses receipt snapshots only.
 * LEAD-SRC-6E: legacy portal acquisition may be recovered via exact
 * portal_requests.hunter_lead_id → source_category for display aggregation of
 * both leads and conversions. Receipt DB snapshots are never rewritten.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { BarChart3, RefreshCw } from 'lucide-react'
import { useHunterStore } from '@/store/hunterStore'
import type { ConversionReceipt } from '@/features/sales-intelligence/conversion-receipts/conversionReceiptTypes'
import { fetchConversionReceipts } from '@/features/sales-intelligence/conversion-receipts/conversionReceiptService'
import {
  computeSourcePerformance,
  formatConversionRate,
  formatConvertedValue,
} from './sourcePerformanceCalculations'
import { fetchPortalCategoryByLeadId } from './sourcePerformancePortalRecovery'

export interface SourcePerformancePanelProps {
  loadReceipts?: () => Promise<{ receipts: ConversionReceipt[]; error: string | null }>
  loadPortalCategories?: () => Promise<{ map: Map<string, string>; error: string | null }>
  /** Injectable leads for tests; defaults to hunter store. */
  leads?: Array<Record<string, any>>
}

function MetricCell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-sm font-semibold font-mono truncate ${accent ?? 'text-gray-100'}`}>
        {value}
      </div>
    </div>
  )
}

export const SourcePerformancePanel: React.FC<SourcePerformancePanelProps> = ({
  loadReceipts = fetchConversionReceipts,
  loadPortalCategories = fetchPortalCategoryByLeadId,
  leads: leadsProp,
}) => {
  const storeLeads = useHunterStore((s) => s.leads)
  const fetchLeads = useHunterStore((s) => s.fetchLeads)
  const leads = leadsProp ?? (storeLeads as any[])

  const [receipts, setReceipts] = useState<ConversionReceipt[]>([])
  const [portalCategoryByLeadId, setPortalCategoryByLeadId] = useState<Map<string, string>>(
    () => new Map()
  )
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [manualRefresh, setManualRefresh] = useState(0)

  useEffect(() => {
    if (!leadsProp) void fetchLeads()
  }, [fetchLeads, leadsProp, manualRefresh])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    Promise.all([loadReceipts(), loadPortalCategories()])
      .then(([receiptResult, portalResult]) => {
        if (cancelled) return
        setReceipts(receiptResult.receipts)
        setPortalCategoryByLeadId(portalResult.map)
        const errors = [receiptResult.error, portalResult.error].filter(Boolean)
        setError(errors.length ? errors.join(' · ') : null)
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? 'Could not load source performance.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadReceipts, loadPortalCategories, manualRefresh])

  const report = useMemo(
    () =>
      computeSourcePerformance({
        leads: leads as any[],
        receipts,
        portalCategoryByLeadId,
      }),
    [leads, receipts, portalCategoryByLeadId]
  )

  return (
    <section
      data-testid="source-performance-panel"
      className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-lg p-5"
    >
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <BarChart3 size={20} className="text-cyan-400" />
          <h2 className="text-lg font-bold text-white">Source Performance</h2>
        </div>
        <button
          type="button"
          onClick={() => setManualRefresh((n) => n + 1)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-800 transition"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        All-time Sales Intelligence acquisition sources. Converted Value uses durable conversion
        receipt snapshots — never estimates, invoices, or payments.
      </p>

      {error && (
        <div className="text-xs text-red-300 bg-red-900/25 border border-red-800 rounded px-3 py-2 mb-4">
          {error}
        </div>
      )}

      {isLoading && report.rows.length === 0 && report.totals.leads === 0 && (
        <div className="text-sm text-gray-500">Loading source performance...</div>
      )}

      {!isLoading && report.totals.leads === 0 && report.totals.converted === 0 && !error && (
        <div className="text-sm text-gray-500 bg-gray-900/50 border border-gray-800 rounded px-4 py-6 text-center">
          No source data yet.
          <br />
          <span className="text-gray-600 text-xs">
            Leads and conversion receipts will appear here as Sales Intelligence acquires and
            converts them.
          </span>
        </div>
      )}

      {(report.totals.leads > 0 || report.totals.converted > 0) && (
        <>
          <div
            data-testid="source-performance-all"
            className="mb-4 rounded-lg border border-cyan-900/40 bg-cyan-950/20 px-4 py-3"
          >
            <div className="text-[11px] uppercase tracking-wider text-cyan-400/80 font-semibold mb-2">
              All Sources
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCell label="Leads" value={String(report.totals.leads)} />
              <MetricCell label="Converted" value={String(report.totals.converted)} />
              <MetricCell
                label="Rate"
                value={formatConversionRate(report.totals.conversionRate)}
                accent="text-emerald-300"
              />
              <MetricCell
                label="Value"
                value={formatConvertedValue(report.totals.convertedValue)}
                accent="text-amber-300"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {report.rows.map((row) => (
              <div
                key={row.key}
                data-testid="source-performance-row"
                className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-3"
              >
                <div className="text-sm text-gray-100 font-semibold truncate mb-2">{row.label}</div>
                <div className="grid grid-cols-2 gap-2">
                  <MetricCell label="Leads" value={String(row.leads)} />
                  <MetricCell label="Converted" value={String(row.converted)} />
                  <MetricCell
                    label="Rate"
                    value={formatConversionRate(row.conversionRate)}
                    accent="text-emerald-300/90"
                  />
                  <MetricCell
                    label="Value"
                    value={formatConvertedValue(row.convertedValue)}
                    accent="text-amber-300/90"
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export default SourcePerformancePanel
