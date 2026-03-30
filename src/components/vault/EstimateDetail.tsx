// @ts-nocheck
/**
 * EstimateDetail — Shows estimate detail: line items table, totals, margin analysis, status.
 *
 * Features:
 * - Line items table with costs and waste factors
 * - Totals breakdown (subtotal, tax, total)
 * - Margin analysis with insights
 * - Actions: send estimate, analyze margin
 * - Status display
 * - Dark themed modal/panel
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { processVaultRequest } from '@/agents/vault'
import {
  X,
  Send,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  AlertCircle,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { EstimateLineItem } from '@/agents/vault'

// ── Types ───────────────────────────────────────────────────────────────────

interface EstimateData {
  id: string
  estimate_number: string
  status: string
  client_id?: string
  client_name?: string
  total: number
  subtotal: number
  tax_amount: number
  tax_rate: number
  margin_pct: number
  valid_until?: string
  line_items: EstimateLineItem[]
  created_at: string
}

interface MarginAnalysisData {
  estimatedMarginPct: number
  actualMarginPct: number
  variance: number
  status: 'favorable' | 'warning' | 'critical'
  insights: string[]
}

export interface EstimateDetailProps {
  orgId: string
  estimateId: string
  onClose?: () => void
  onSent?: () => void
}

// ── Component ───────────────────────────────────────────────────────────────

export function EstimateDetail({
  orgId,
  estimateId,
  onClose,
  onSent,
}: EstimateDetailProps) {
  const [estimate, setEstimate] = useState<EstimateData | null>(null)
  const [marginAnalysis, setMarginAnalysis] = useState<MarginAnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load estimate on mount
  useEffect(() => {
    loadEstimate()
  }, [estimateId, orgId])

  async function loadEstimate() {
    try {
      setLoading(true)
      setError(null)

      const { data, error: err } = await supabase
        .from('estimates')
        .select(
          `
          id,
          estimate_number,
          status,
          client_id,
          total,
          subtotal,
          tax_amount,
          tax_rate,
          margin_pct,
          valid_until,
          line_items,
          created_at,
          clients (
            name
          )
        `
        )
        .eq('id', estimateId)
        .eq('org_id', orgId)
        .single()

      if (err) throw err

      setEstimate({
        ...data,
        client_name: data.clients?.name || 'No client',
        line_items: (data.line_items as EstimateLineItem[]) || [],
      })
    } catch (err) {
      console.error('[EstimateDetail] Load error:', err)
      setError('Failed to load estimate')
    } finally {
      setLoading(false)
    }
  }

  async function handleSend() {
    if (!estimate) return

    try {
      setSending(true)
      setError(null)

      const response = await processVaultRequest({
        action: 'send',
        orgId,
        estimateId,
      })

      if (!response.success) {
        setError(response.message)
        return
      }

      // Update local state
      setEstimate(prev => (prev ? { ...prev, status: 'sent' } : null))
      onSent?.()
    } catch (err) {
      console.error('[EstimateDetail] Send error:', err)
      setError(`Error sending estimate: ${String(err).slice(0, 100)}`)
    } finally {
      setSending(false)
    }
  }

  async function handleAnalyzeMargin() {
    try {
      setAnalyzing(true)
      setError(null)

      const response = await processVaultRequest({
        action: 'analyze_margin',
        orgId,
        estimateId,
      })

      if (!response.success) {
        setError(response.message)
        return
      }

      const analysis = response.data as any
      setMarginAnalysis({
        estimatedMarginPct: analysis.data?.estimatedMarginPct || estimate?.margin_pct || 0,
        actualMarginPct: analysis.data?.actualMarginPct || 0,
        variance: analysis.data?.variance || 0,
        status: analysis.data?.status || 'favorable',
        insights: analysis.insights?.map((i: any) => i.message) || [],
      })
    } catch (err) {
      console.error('[EstimateDetail] Analysis error:', err)
      setError(`Error analyzing margin: ${String(err).slice(0, 100)}`)
    } finally {
      setAnalyzing(false)
    }
  }

  function isExpired(): boolean {
    if (!estimate?.valid_until) return false
    return new Date(estimate.valid_until).getTime() < Date.now()
  }

  function daysUntilExpiry(): number {
    if (!estimate?.valid_until) return 0
    return Math.floor(
      (new Date(estimate.valid_until).getTime() - Date.now()) / (86400 * 1000)
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-800">
        <div className="flex items-center justify-center h-full text-gray-400">
          <div>Loading estimate...</div>
        </div>
      </div>
    )
  }

  if (!estimate) {
    return (
      <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-800">
        <div className="flex items-center justify-center h-full text-gray-400">
          <div>Estimate not found</div>
        </div>
      </div>
    )
  }

  const marginStatus = marginAnalysis
    ? marginAnalysis.status
    : estimate.margin_pct < 30
      ? 'warning'
      : 'favorable'

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-800/50">
        <div>
          <h2 className="text-lg font-bold text-gray-100">{estimate.estimate_number}</h2>
          <p className="text-xs text-gray-400 mt-1">{estimate.client_name}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-300 transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Status badge and expiry */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={clsx(
                'px-2 py-1 rounded text-xs font-semibold',
                estimate.status === 'draft'
                  ? 'bg-blue-900/50 text-blue-300'
                  : estimate.status === 'sent'
                    ? 'bg-cyan-900/50 text-cyan-300'
                    : 'bg-green-900/50 text-green-300'
              )}
            >
              {estimate.status.toUpperCase()}
            </span>

            {isExpired() && (
              <span className="px-2 py-1 rounded text-xs font-semibold bg-red-900/50 text-red-300 flex items-center gap-1">
                <AlertTriangle size={12} />
                EXPIRED
              </span>
            )}

            {!isExpired() && estimate.valid_until && (
              <span className="px-2 py-1 rounded text-xs font-semibold bg-gray-700 text-gray-300 flex items-center gap-1">
                <Clock size={12} />
                Expires in {daysUntilExpiry()} days
              </span>
            )}
          </div>

          {/* Line Items Table */}
          <div>
            <h3 className="text-sm font-bold text-gray-200 mb-2">Line Items</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-2 px-2 font-semibold text-gray-400">
                      Description
                    </th>
                    <th className="text-right py-2 px-2 font-semibold text-gray-400">
                      Qty
                    </th>
                    <th className="text-right py-2 px-2 font-semibold text-gray-400">
                      Unit Price
                    </th>
                    <th className="text-right py-2 px-2 font-semibold text-gray-400">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.line_items.map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/50">
                      <td className="py-2 px-2 text-gray-300">
                        <div>{item.description}</div>
                        {item.is_custom && (
                          <div className="text-[10px] text-orange-400 mt-0.5">
                            Custom item
                          </div>
                        )}
                      </td>
                      <td className="text-right py-2 px-2 text-gray-400">
                        {item.qty.toFixed(2)} {item.unit}
                      </td>
                      <td className="text-right py-2 px-2 text-gray-400">
                        ${item.unit_price.toFixed(2)}
                      </td>
                      <td className="text-right py-2 px-2 text-gray-300 font-semibold">
                        ${item.total.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="bg-gray-800 rounded-lg p-3 space-y-2 text-sm">
            <div className="flex justify-between text-gray-400">
              <span>Subtotal</span>
              <span>${estimate.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Tax ({(estimate.tax_rate * 100).toFixed(2)}%)</span>
              <span>${estimate.tax_amount.toFixed(2)}</span>
            </div>
            <div className="border-t border-gray-700 pt-2 flex justify-between font-semibold text-gray-100">
              <span>Total</span>
              <span>${estimate.total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-emerald-400 font-semibold">
              <span>Margin</span>
              <span>{estimate.margin_pct.toFixed(1)}%</span>
            </div>
          </div>

          {/* Margin Analysis */}
          {marginAnalysis && (
            <div className="bg-gray-800 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={16} className="text-emerald-400" />
                <h4 className="font-semibold text-gray-200">Margin Analysis</h4>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex justify-between text-gray-400">
                  <span>Estimated Margin</span>
                  <span className="text-gray-100">
                    {marginAnalysis.estimatedMarginPct.toFixed(1)}%
                  </span>
                </div>
                {marginAnalysis.actualMarginPct > 0 && (
                  <>
                    <div className="flex justify-between text-gray-400">
                      <span>Actual Margin</span>
                      <span className="text-gray-100">
                        {marginAnalysis.actualMarginPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
                      <span className="text-gray-400">Variance</span>
                      <span
                        className={
                          marginAnalysis.variance > 0
                            ? 'text-emerald-400 font-semibold'
                            : 'text-orange-400 font-semibold'
                        }
                      >
                        {marginAnalysis.variance > 0 ? '+' : ''}
                        {marginAnalysis.variance.toFixed(1)}%
                      </span>
                    </div>
                  </>
                )}
              </div>

              {marginAnalysis.insights.length > 0 && (
                <div className="mt-2 space-y-1 pt-2 border-t border-gray-700">
                  {marginAnalysis.insights.slice(0, 3).map((insight, idx) => (
                    <div key={idx} className="text-[10px] text-gray-400">
                      • {insight}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer / Actions */}
      <div className="p-4 border-t border-gray-800 space-y-2">
        {estimate.status !== 'sent' && estimate.status !== 'accepted' && !isExpired() && (
          <button
            onClick={handleSend}
            disabled={sending}
            className={clsx(
              'w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold transition-colors',
              sending
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            )}
          >
            <Send size={16} />
            {sending ? 'Sending...' : 'Send to Client'}
          </button>
        )}

        <button
          onClick={handleAnalyzeMargin}
          disabled={analyzing}
          className={clsx(
            'w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold transition-colors',
            analyzing
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-cyan-600 text-white hover:bg-cyan-700'
          )}
        >
          <TrendingUp size={16} />
          {analyzing ? 'Analyzing...' : 'Analyze Margin'}
        </button>

        <button
          onClick={onClose}
          className="w-full px-4 py-2 rounded-lg bg-gray-800 text-gray-300 font-semibold hover:bg-gray-700 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}
