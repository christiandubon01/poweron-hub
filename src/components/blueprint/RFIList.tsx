/**
 * RFIList — RFI (Request for Information) management view.
 *
 * Features:
 * - List RFIs with status badges
 * - Due date and impact indicators
 * - Create, submit, respond, close actions
 * - Expandable detail view
 */

import { useState, useEffect, useCallback } from 'react'
import { Plus, ChevronRight, AlertCircle, Loader2, DollarSign, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

// ── Types ───────────────────────────────────────────────────────────────────

export interface RFI {
  id: string
  rfi_number: string
  status: 'open' | 'submitted' | 'responded' | 'closed' | 'rejected'
  question: string
  requested_from: string
  category: 'design' | 'coordination' | 'supplier' | 'permit' | 'ahj' | 'inspection'
  due_date: string | null
  response: string | null
  estimated_cost_impact: number | null
  estimated_days_impact: number | null
  created_at: string
}

const STATUS_COLORS: Record<RFI['status'], { label: string; color: string; bgColor: string }> = {
  open: { label: 'Open', color: 'text-blue-400', bgColor: 'bg-blue-400/10' },
  submitted: { label: 'Submitted', color: 'text-cyan-400', bgColor: 'bg-cyan-400/10' },
  responded: { label: 'Responded', color: 'text-emerald-400', bgColor: 'bg-emerald-400/10' },
  closed: { label: 'Closed', color: 'text-gray-400', bgColor: 'bg-gray-600/10' },
  rejected: { label: 'Rejected', color: 'text-red-400', bgColor: 'bg-red-400/10' },
}

const CATEGORY_LABELS: Record<RFI['category'], string> = {
  design: 'Design',
  coordination: 'Coordination',
  supplier: 'Supplier',
  permit: 'Permit',
  ahj: 'AHJ',
  inspection: 'Inspection',
}

// ── Component ───────────────────────────────────────────────────────────────

export interface RFIListProps {
  projectId?: string | null
  onSelectRFI?: (rfiId: string) => void
  selectedRFIId?: string | null
  onCreateRFI?: () => void
}

export function RFIList({
  projectId,
  onSelectRFI,
  selectedRFIId,
  onCreateRFI,
}: RFIListProps) {
  const { profile } = useAuth()
  const [rfis, setRFIs] = useState<RFI[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedIds] = useState<Set<string>>(new Set())

  const orgId = profile?.org_id

  // ── Fetch RFIs ─────────────────────────────────────────────────────────────
  const fetchRFIs = useCallback(async () => {
    if (!orgId || !projectId) return

    setLoading(true)
    setError(null)

    try {
      let query = supabase
        .from('rfis')
        .select('*')
        .eq('org_id', orgId)
        .eq('project_id', projectId)
        .order('due_date', { ascending: true, nullsFirst: true })

      const { data, error: queryError } = await query

      if (queryError) {
        throw new Error(queryError.message)
      }

      setRFIs((data || []) as RFI[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load RFIs')
    } finally {
      setLoading(false)
    }
  }, [orgId, projectId])

  useEffect(() => {
    fetchRFIs()
  }, [fetchRFIs])


  // ── Calculate days until due ────────────────────────────────────────────
  const daysUntilDue = (dueDate: string | null): number | null => {
    if (!dueDate) return null
    const due = new Date(dueDate)
    const now = new Date()
    return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!projectId) {
    return (
      <div className="p-4 text-center text-gray-400 bg-gray-800/30 rounded-lg">
        Select a project to view RFIs
      </div>
    )
  }

  if (loading && rfis.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100">RFIs</h3>
        {onCreateRFI && (
          <button
            onClick={onCreateRFI}
            className="flex items-center gap-2 px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New RFI
          </button>
        )}
      </div>

      {/* Error */}
      {error && <div className="p-3 bg-red-900/20 text-red-300 rounded-lg">{error}</div>}

      {/* RFI list */}
      {rfis.length === 0 ? (
        <div className="p-6 text-center text-gray-400 bg-gray-800/30 rounded-lg border border-gray-700">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No RFIs for this project</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rfis.map((rfi) => {
            const isExpanded = expandedIds.has(rfi.id)
            const isSelected = selectedRFIId === rfi.id
            const statusColor = STATUS_COLORS[rfi.status]
            const daysRemaining = daysUntilDue(rfi.due_date)
            const isOverdue = daysRemaining !== null && daysRemaining < 0

            return (
              <button
                key={rfi.id}
                onClick={() => onSelectRFI?.(rfi.id)}
                className={clsx(
                  'w-full p-3 rounded-lg border transition-colors text-left',
                  isSelected
                    ? 'bg-gray-800 border-cyan-400/30'
                    : 'bg-gray-800/50 border-gray-700 hover:bg-gray-800'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {/* RFI number and status */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm text-emerald-400">{rfi.rfi_number}</span>
                      <span
                        className={clsx('px-2 py-0.5 text-xs rounded', statusColor.bgColor, statusColor.color)}
                      >
                        {statusColor.label}
                      </span>
                      <span className="px-2 py-0.5 text-xs bg-gray-700/50 text-gray-300 rounded">
                        {CATEGORY_LABELS[rfi.category]}
                      </span>
                    </div>

                    {/* Question */}
                    <p className="text-sm text-gray-300 mb-2 line-clamp-2">{rfi.question}</p>

                    {/* Details */}
                    <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                      {/* Requested from */}
                      <div>Requested from: {rfi.requested_from}</div>

                      {/* Due date */}
                      {rfi.due_date && (
                        <div className={clsx('flex items-center gap-1', isOverdue && 'text-red-400')}>
                          <Clock className="w-3 h-3" />
                          {isOverdue ? (
                            <span>{Math.abs(daysRemaining!)} days overdue</span>
                          ) : (
                            <span>Due in {daysRemaining} days</span>
                          )}
                        </div>
                      )}

                      {/* Cost impact */}
                      {rfi.estimated_cost_impact && (
                        <div className="flex items-center gap-1 text-yellow-400">
                          <DollarSign className="w-3 h-3" />
                          {rfi.estimated_cost_impact.toLocaleString('en-US', {
                            style: 'currency',
                            currency: 'USD',
                            minimumFractionDigits: 0,
                          })}
                        </div>
                      )}
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

                {/* Expandable detail */}
                {isExpanded && rfi.response && (
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <p className="text-sm font-medium text-emerald-400 mb-1">Response:</p>
                    <p className="text-sm text-gray-300">{rfi.response}</p>
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
