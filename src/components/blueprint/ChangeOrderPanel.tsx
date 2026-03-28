/**
 * ChangeOrderPanel — Change order list with status filter and actions.
 *
 * Features:
 * - Filter by status (all, draft, submitted, approved, rejected, voided)
 * - CO number, description, amount, status display
 * - Draft, submit, approve actions
 * - Expandable detail view
 */

import { useState, useEffect, useCallback } from 'react'
import { Plus, ChevronRight, Loader2, DollarSign, TrendingUp } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ChangeOrder {
  id: string
  co_number: string
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'voided'
  description: string
  reason: string
  amount: number
  labor_hours: number | null
  material_cost: number | null
  rfi_id: string | null
  submitted_at: string | null
  approved_at: string | null
  notes: string | null
  created_at: string
}

type COStatus = ChangeOrder['status'] | 'all'

const STATUS_CONFIG: Record<COStatus, { label: string; color: string; bgColor: string }> = {
  all: { label: 'All', color: 'text-gray-300', bgColor: 'bg-gray-700/30' },
  draft: { label: 'Draft', color: 'text-gray-400', bgColor: 'bg-gray-600/20' },
  submitted: { label: 'Submitted', color: 'text-blue-400', bgColor: 'bg-blue-400/10' },
  approved: { label: 'Approved', color: 'text-emerald-400', bgColor: 'bg-emerald-400/10' },
  rejected: { label: 'Rejected', color: 'text-red-400', bgColor: 'bg-red-400/10' },
  voided: { label: 'Voided', color: 'text-gray-500', bgColor: 'bg-gray-700/20' },
}

// ── Component ───────────────────────────────────────────────────────────────

export interface ChangeOrderPanelProps {
  projectId?: string | null
  onSelectCO?: (coId: string) => void
  selectedCOId?: string | null
  onCreateCO?: () => void
  onSubmitCO?: (coId: string) => void
  onApproveCO?: (coId: string) => void
  onRejectCO?: (coId: string) => void
}

export function ChangeOrderPanel({
  projectId,
  onSelectCO,
  selectedCOId,
  onCreateCO,
  onSubmitCO,
  onApproveCO,
  onRejectCO,
}: ChangeOrderPanelProps) {
  const { profile } = useAuth()
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([])
  const [filterStatus, setFilterStatus] = useState<COStatus>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedIds] = useState<Set<string>>(new Set())

  const orgId = profile?.org_id

  // ── Fetch change orders ────────────────────────────────────────────────────
  const fetchChangeOrders = useCallback(async () => {
    if (!orgId || !projectId) return

    setLoading(true)
    setError(null)

    try {
      let query = supabase
        .from('change_orders')
        .select('*')
        .eq('org_id', orgId)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus)
      }

      const { data, error: queryError } = await query

      if (queryError) {
        throw new Error(queryError.message)
      }

      setChangeOrders((data || []) as ChangeOrder[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load change orders')
    } finally {
      setLoading(false)
    }
  }, [orgId, projectId, filterStatus])

  useEffect(() => {
    fetchChangeOrders()
  }, [fetchChangeOrders])


  // ── Render ─────────────────────────────────────────────────────────────────

  if (!projectId) {
    return (
      <div className="p-4 text-center text-gray-400 bg-gray-800/30 rounded-lg">
        Select a project to view change orders
      </div>
    )
  }

  if (loading && changeOrders.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    )
  }

  const filteredCOs =
    filterStatus === 'all' ? changeOrders : changeOrders.filter((c) => c.status === filterStatus)

  // Calculate total impact
  const totalApproved = filteredCOs
    .filter((c) => c.status === 'approved')
    .reduce((sum, c) => sum + c.amount, 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100">Change Orders</h3>
        {onCreateCO && (
          <button
            onClick={onCreateCO}
            className="flex items-center gap-2 px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New CO
          </button>
        )}
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 border-b border-gray-800">
        {(['all', 'draft', 'submitted', 'approved', 'rejected', 'voided'] as const).map((status) => {
          const config = STATUS_CONFIG[status]
          const isActive = filterStatus === status
          return (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={clsx(
                'px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                isActive ? `${config.bgColor} ${config.color}` : 'text-gray-400 hover:text-gray-300'
              )}
            >
              {config.label}
            </button>
          )
        })}
      </div>

      {/* Error */}
      {error && <div className="p-3 bg-red-900/20 text-red-300 rounded-lg">{error}</div>}

      {/* Total approved impact */}
      {totalApproved > 0 && (
        <div className="p-3 bg-emerald-900/20 border border-emerald-700/50 rounded-lg flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-emerald-300">
            Total Approved Impact:{' '}
            <span className="font-semibold">
              {totalApproved.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
              })}
            </span>
          </span>
        </div>
      )}

      {/* COs list */}
      {filteredCOs.length === 0 ? (
        <div className="p-6 text-center text-gray-400 bg-gray-800/30 rounded-lg border border-gray-700">
          <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No change orders in this status</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredCOs.map((co) => {
            const isExpanded = expandedIds.has(co.id)
            const isSelected = selectedCOId === co.id
            const statusConfig = STATUS_CONFIG[co.status]

            return (
              <button
                key={co.id}
                onClick={() => onSelectCO?.(co.id)}
                className={clsx(
                  'w-full p-3 rounded-lg border transition-colors text-left',
                  isSelected
                    ? 'bg-gray-800 border-cyan-400/30'
                    : 'bg-gray-800/50 border-gray-700 hover:bg-gray-800'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {/* CO number and status */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm text-emerald-400">{co.co_number}</span>
                      <span
                        className={clsx('px-2 py-0.5 text-xs rounded', statusConfig.bgColor, statusConfig.color)}
                      >
                        {statusConfig.label}
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-sm text-gray-300 mb-2 line-clamp-2">{co.description}</p>

                    {/* Details */}
                    <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                      {/* Amount */}
                      <div className="flex items-center gap-1 text-yellow-400 font-medium">
                        <DollarSign className="w-3 h-3" />
                        {co.amount.toLocaleString('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          minimumFractionDigits: 0,
                        })}
                      </div>

                      {/* Reason */}
                      <div>Reason: {co.reason}</div>

                      {/* Labor hours */}
                      {co.labor_hours && <div>Labor: {co.labor_hours}h</div>}
                    </div>
                  </div>

                  {/* Chevron */}
                  <ChevronRight
                    className={clsx(
                      'w-5 h-5 text-gray-500 flex-shrink-0 transition-transform',
                      isExpanded && 'rotate-90'
                    )}
                  />
                </div>

                {/* Expandable detail with actions */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-gray-700 space-y-3">
                    {/* Notes */}
                    {co.notes && (
                      <div>
                        <p className="text-xs font-medium text-gray-400 mb-1">Notes:</p>
                        <p className="text-xs text-gray-300">{co.notes}</p>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2 flex-wrap">
                      {co.status === 'draft' && onSubmitCO && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onSubmitCO(co.id)
                          }}
                          className="px-2 py-1 text-xs bg-blue-600/30 hover:bg-blue-600/50 text-blue-400 rounded transition-colors"
                        >
                          Submit
                        </button>
                      )}

                      {co.status === 'submitted' && onApproveCO && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onApproveCO(co.id)
                          }}
                          className="px-2 py-1 text-xs bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-400 rounded transition-colors"
                        >
                          Approve
                        </button>
                      )}

                      {(co.status === 'draft' || co.status === 'submitted') && onRejectCO && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onRejectCO(co.id)
                          }}
                          className="px-2 py-1 text-xs bg-red-600/30 hover:bg-red-600/50 text-red-400 rounded transition-colors"
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
