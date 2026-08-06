/**
 * SALES-CONVERSION-1 — Conversion Receipts ledger.
 *
 * Rendered underneath the active Pipeline list inside the Sales Intelligence
 * Pipeline subtab, and visually separated from it: the active list is a set of
 * actionable lead cards, this is a closed, append-only ledger.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Receipt, Search, RefreshCw } from 'lucide-react'
import {
  DEFAULT_RECEIPT_FILTERS,
  type ConversionReceipt,
  type ConversionReceiptFilters,
} from './conversionReceiptTypes'
import {
  availableSourceDetails,
  availableSourceFamilies,
  filterReceipts,
  sortReceiptsNewestFirst,
  summarizeBySource,
} from './conversionReceiptCalculations'
import { fetchConversionReceipts } from './conversionReceiptService'
import ConversionReceiptCard from './ConversionReceiptCard'

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`
}

export interface ConversionReceiptsPanelProps {
  /** Bumping this refetches — the Pipeline raises it after a conversion. */
  refreshToken?: number
  /** Injectable for tests. */
  loadReceipts?: () => Promise<{ receipts: ConversionReceipt[]; error: string | null }>
}

export const ConversionReceiptsPanel: React.FC<ConversionReceiptsPanelProps> = ({
  refreshToken = 0,
  loadReceipts = fetchConversionReceipts,
}) => {
  const [receipts, setReceipts] = useState<ConversionReceipt[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ConversionReceiptFilters>(DEFAULT_RECEIPT_FILTERS)
  const [manualRefresh, setManualRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    loadReceipts()
      .then((result) => {
        if (cancelled) return
        setReceipts(sortReceiptsNewestFirst(result.receipts))
        setError(result.error)
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? 'Could not load conversion receipts.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadReceipts, refreshToken, manualRefresh])

  // Filter option lists come from the receipts themselves, never a fixed enum.
  const families = useMemo(() => availableSourceFamilies(receipts), [receipts])
  const details = useMemo(
    () => availableSourceDetails(receipts, filters.sourceFamily),
    [receipts, filters.sourceFamily]
  )
  const visible = useMemo(() => filterReceipts(receipts, filters), [receipts, filters])
  const summary = useMemo(() => summarizeBySource(visible), [visible])

  return (
    <section
      data-testid="conversion-receipts-panel"
      className="bg-gray-950 border-2 border-dashed border-gray-700 rounded-lg p-5"
    >
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <Receipt size={20} className="text-amber-400" />
          <h2 className="text-lg font-bold text-white">Conversion Receipts</h2>
          <span className="text-[11px] font-semibold bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
            {receipts.length}
          </span>
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
        Permanent tickets for leads that produced a real Project or Service Call. Append-only —
        receipts are never edited from here.
      </p>

      {error && (
        <div className="text-xs text-red-300 bg-red-900/25 border border-red-800 rounded px-3 py-2 mb-4">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Search lead or destination"
            aria-label="Search receipts by lead or destination name"
            className="w-full bg-gray-900 border border-gray-800 rounded pl-8 pr-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600"
          />
        </div>
        <select
          aria-label="Filter by source family"
          value={filters.sourceFamily ?? ''}
          onChange={(e) =>
            // Changing family clears a now-unreachable detail selection.
            setFilters({ ...filters, sourceFamily: e.target.value || null, sourceDetail: null })
          }
          className="bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-gray-600"
        >
          <option value="">All sources</option>
          {families.map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by source detail"
          value={filters.sourceDetail ?? ''}
          onChange={(e) => setFilters({ ...filters, sourceDetail: e.target.value || null })}
          disabled={details.length === 0}
          className="bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-200 disabled:opacity-40 focus:outline-none focus:border-gray-600"
        >
          <option value="">All detail</option>
          {details.map((detail) => (
            <option key={detail} value={detail}>
              {detail}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by conversion type"
          value={filters.destinationType}
          onChange={(e) =>
            setFilters({ ...filters, destinationType: e.target.value as ConversionReceiptFilters['destinationType'] })
          }
          className="bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-gray-600"
        >
          <option value="all">All conversions</option>
          <option value="project">Projects</option>
          <option value="service_call">Service Calls</option>
        </select>
      </div>

      {/* Source summary — counts and dollars are labelled separately */}
      {summary.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-wider text-gray-600 mb-2">
            By source
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {summary.map((row) => (
              <div
                key={row.key}
                className="bg-gray-900 border border-gray-800 rounded px-3 py-2 text-xs"
              >
                <div className="text-gray-200 font-semibold truncate">{row.label}</div>
                <div className="text-gray-500">
                  {row.conversions} conversion{row.conversions === 1 ? '' : 's'}
                </div>
                <div className="text-gray-600 mt-0.5">
                  {row.projectConversions} project · {row.serviceCallConversions} service call
                </div>
                <div className="text-gray-500 mt-0.5">
                  {row.convertedValueCount > 0 ? (
                    <>
                      Converted value: {formatMoney(row.convertedValueTotal)}{' '}
                      <span className="text-gray-700">
                        (from {row.convertedValueCount} of {row.conversions})
                      </span>
                    </>
                  ) : (
                    <span className="text-gray-700">Converted value: not available</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ledger */}
      {isLoading && receipts.length === 0 && (
        <div className="text-sm text-gray-500">Loading conversion receipts...</div>
      )}

      {!isLoading && receipts.length === 0 && !error && (
        <div className="text-sm text-gray-500 bg-gray-900/50 border border-gray-800 rounded px-4 py-6 text-center">
          No conversions yet.
          <br />
          <span className="text-gray-600 text-xs">
            A receipt is created the moment a lead becomes a real Project or Service Call.
          </span>
        </div>
      )}

      {receipts.length > 0 && visible.length === 0 && (
        <div className="text-sm text-gray-500 bg-gray-900/50 border border-gray-800 rounded px-4 py-6 text-center">
          No receipts match these filters.
        </div>
      )}

      {visible.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {visible.map((receipt) => (
            <ConversionReceiptCard key={receipt.id} receipt={receipt} />
          ))}
        </div>
      )}
    </section>
  )
}

export default ConversionReceiptsPanel
