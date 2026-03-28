// @ts-nocheck
/**
 * EstimatePanel — Dark-themed list of estimates with status badges, margin %, totals.
 * @ts-nocheck is needed because 'estimates' table is not in generated Supabase types.
 *
 * Features:
 * - Lists all estimates with status color coding
 * - Shows margin %, total amount, and client name
 * - Button to create new estimate
 * - Click to view detail
 * - Loading and error states
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, TrendingUp, AlertCircle, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import { useProactiveAI } from '@/hooks/useProactiveAI'
import { ProactiveInsightCard } from '@/components/shared/ProactiveInsightCard'
import { getBackupData, num, fmt } from '@/services/backupDataService'

// ── Types ───────────────────────────────────────────────────────────────────

interface Estimate {
  id: string
  estimate_number: string
  client_id?: string
  client_name?: string
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired'
  total: number
  margin_pct: number
  valid_until?: string
  created_at: string
}

export interface EstimatePanelProps {
  orgId: string
  onCreateNew?: () => void
  onSelectEstimate?: (estimateId: string) => void
}

// ── Status badge styles ──────────────────────────────────────────────────────

const STATUS_STYLES: Record<
  string,
  { label: string; bgColor: string; textColor: string; borderColor: string }
> = {
  draft: {
    label: 'Draft',
    bgColor: 'bg-blue-subtle',
    textColor: 'text-blue',
    borderColor: 'border-blue/20',
  },
  sent: {
    label: 'Sent',
    bgColor: 'bg-cyan-subtle',
    textColor: 'text-cyan',
    borderColor: 'border-cyan/20',
  },
  viewed: {
    label: 'Viewed',
    bgColor: 'bg-purple-subtle',
    textColor: 'text-purple',
    borderColor: 'border-purple/20',
  },
  accepted: {
    label: 'Accepted',
    bgColor: 'bg-green-subtle',
    textColor: 'text-green',
    borderColor: 'border-green/20',
  },
  rejected: {
    label: 'Rejected',
    bgColor: 'bg-red-subtle',
    textColor: 'text-red',
    borderColor: 'border-red/20',
  },
  expired: {
    label: 'Expired',
    bgColor: 'bg-orange-subtle',
    textColor: 'text-orange',
    borderColor: 'border-orange/20',
  },
}

// ── Component ───────────────────────────────────────────────────────────────

export function EstimatePanel({
  orgId,
  onCreateNew,
  onSelectEstimate,
}: EstimatePanelProps) {
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Proactive AI context
  const backup = getBackupData()
  const activeProjects = (backup?.projects || []).filter(p => p.status !== 'completed')
  const lowMarginProjects = activeProjects.filter(p => {
    const contract = num(p.contract)
    const totalCost = (p.laborRows || []).reduce((s,r) => s + num(r.hrs)*num(r.rate), 0) + (p.matRows || []).reduce((s,r) => s + num(r.total), 0)
    return contract > 0 && totalCost > 0 && ((contract - totalCost) / contract * 100) < 20
  })
  const vaultContext = `Active estimates: ${activeProjects.length}. Low margin (<20%) projects: ${lowMarginProjects.length}. ${lowMarginProjects.map(p => p.name).join(', ')}. Analyze margin risk and recommend adjustments.`
  const vaultSystem = 'You are VAULT, the estimating agent for Power On Solutions LLC, a C-10 electrical contractor. Analyze active estimates and flag margin risks. Be concise with specific project names and numbers.'
  const vault = useProactiveAI('vault', vaultSystem, vaultContext, activeProjects.length > 0)

  // Fetch estimates on mount and setup realtime subscription
  useEffect(() => {
    if (!orgId) return

    loadEstimates()

    // Supabase v2 realtime: use channel API
    const channel = supabase
      .channel('estimates-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'estimates', filter: `org_id=eq.${orgId}` },
        () => { loadEstimates() }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [orgId])

  async function loadEstimates() {
    try {
      setLoading(true)
      setError(null)

      const { data, error: fetchError } = await supabase
        .from('estimates' as never)
        .select(
          `
          id,
          estimate_number,
          client_id,
          status,
          total,
          margin_pct,
          valid_until,
          created_at
        `
        )
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(50)

      if (fetchError) {
        // Table may not exist yet — show empty state instead of crashing
        console.warn('[EstimatePanel] Query error (table may not exist yet):', fetchError.message)
        setEstimates([])
        setLoading(false)
        return
      }

      const formatted: Estimate[] = (data ?? []).map((row: any) => ({
        id: row.id,
        estimate_number: row.estimate_number || '',
        client_id: row.client_id,
        client_name: row.client_name || 'No client',
        status: row.status || 'draft',
        total: row.total ?? 0,
        margin_pct: row.margin_pct ?? 0,
        valid_until: row.valid_until,
        created_at: row.created_at,
      }))

      setEstimates(formatted)
    } catch (err) {
      console.error('[EstimatePanel] Load error:', err)
      setEstimates([])
    } finally {
      setLoading(false)
    }
  }

  // Check if estimate is expiring soon
  function isExpiringsoon(validUntil?: string): boolean {
    if (!validUntil) return false
    const daysUntilExpiry = Math.floor(
      (new Date(validUntil).getTime() - Date.now()) / (86400 * 1000)
    )
    return daysUntilExpiry >= 0 && daysUntilExpiry <= 7
  }

  // Check if estimate is expired
  function isExpired(validUntil?: string): boolean {
    if (!validUntil) return false
    return new Date(validUntil).getTime() < Date.now()
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-800">
      <ProactiveInsightCard
        agentName="VAULT"
        agentColor="#f59e0b"
        response={vault.response}
        loading={vault.loading}
        error={vault.error}
        onRefresh={vault.refresh}
        emptyMessage="No active estimates. Want me to help you build one from your price book?"
        systemPrompt={vaultSystem}
      />

      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <h2 className="text-lg font-bold text-gray-100">Estimates</h2>
        <button
          onClick={onCreateNew}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
        >
          <Plus size={16} />
          New
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40 text-gray-400">
            <div className="text-sm">Loading estimates...</div>
          </div>
        )}

        {error && (
          <div className="m-4 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && estimates.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400">
            <div className="text-sm">No estimates yet</div>
            <button
              onClick={onCreateNew}
              className="mt-3 text-emerald-400 hover:text-emerald-300 text-sm font-semibold"
            >
              Create your first estimate
            </button>
          </div>
        )}

        {!loading && estimates.length > 0 && (
          <div className="space-y-2 p-4">
            {estimates.map(est => {
              const style = STATUS_STYLES[est.status] || STATUS_STYLES.draft
              const expiring = isExpiringsoon(est.valid_until)
              const expired = isExpired(est.valid_until)

              return (
                <div
                  key={est.id}
                  onClick={() => onSelectEstimate?.(est.id)}
                  className={clsx(
                    'p-3 rounded-lg border transition-all cursor-pointer',
                    'hover:shadow-lg hover:border-gray-700',
                    'bg-gray-800 border-gray-700'
                  )}
                >
                  {/* Top row: Number + Status badge */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-bold text-gray-100">
                      {est.estimate_number}
                    </span>
                    <span
                      className={clsx(
                        'px-2 py-0.5 rounded text-xs font-semibold',
                        style.bgColor,
                        style.textColor
                      )}
                    >
                      {style.label}
                    </span>
                  </div>

                  {/* Client name */}
                  <div className="text-xs text-gray-400 mb-2 truncate">
                    {est.client_name}
                  </div>

                  {/* Bottom row: Total + Margin + Alerts */}
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-gray-100">
                        ${(est.total ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <TrendingUp size={12} className="text-emerald-400" />
                        <span className="text-xs text-emerald-400 font-mono">
                          {(est.margin_pct ?? 0).toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {/* Expiration warning */}
                    {expired && (
                      <div className="flex items-center gap-1 text-red-400">
                        <AlertCircle size={14} />
                        <span className="text-[10px] font-mono">Expired</span>
                      </div>
                    )}

                    {expiring && !expired && (
                      <div className="flex items-center gap-1 text-orange-400">
                        <Clock size={14} />
                        <span className="text-[10px] font-mono">Expiring</span>
                      </div>
                    )}
                  </div>

                  {/* Timestamp */}
                  <div className="text-[10px] text-gray-500 mt-2">
                    {new Date(est.created_at).toLocaleDateString()}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
