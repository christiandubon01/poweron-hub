/**
 * InvoicePanel — Dark-themed invoice list with status filters.
 *
 * Features:
 * - Filter by status tabs
 * - Color-coded status badges
 * - Click to view detail
 * - Shows invoice_number, client, total, balance_due, status, days_overdue
 */

import { useState, useEffect, useCallback } from 'react'
import { FileText, Plus, Filter, Loader2, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { getBackupData, mapBackupInvoices, num, fmt } from '@/services/backupDataService'
import { useProactiveAI } from '@/hooks/useProactiveAI'
import { ProactiveInsightCard } from '@/components/shared/ProactiveInsightCard'

// ── Types ───────────────────────────────────────────────────────────────────

export interface Invoice {
  id: string
  invoice_number: string
  client_id: string | null
  total: number | null
  balance_due: number | null
  status: 'draft' | 'sent' | 'viewed' | 'partial' | 'paid' | 'overdue' | 'void' | 'disputed'
  days_overdue: number
  due_date: string | null
  created_at: string
  clients?: { name: string }
}

type InvoiceStatus = Invoice['status'] | 'all'

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; color: string; bgColor: string }> = {
  all: { label: 'All', color: 'text-text-2', bgColor: 'bg-bg-3' },
  draft: { label: 'Draft', color: 'text-text-3', bgColor: 'bg-gray-600/20' },
  sent: { label: 'Sent', color: 'text-blue', bgColor: 'bg-blue/10' },
  viewed: { label: 'Viewed', color: 'text-cyan', bgColor: 'bg-cyan/10' },
  partial: { label: 'Partial', color: 'text-yellow-400', bgColor: 'bg-yellow-400/10' },
  paid: { label: 'Paid', color: 'text-emerald-400', bgColor: 'bg-emerald-400/10' },
  overdue: { label: 'Overdue', color: 'text-red', bgColor: 'bg-red/10' },
  void: { label: 'Void', color: 'text-text-4', bgColor: 'bg-bg-4' },
  disputed: { label: 'Disputed', color: 'text-orange-400', bgColor: 'bg-orange-400/10' },
}

// ── Component ───────────────────────────────────────────────────────────────

export interface InvoicePanelProps {
  onSelectInvoice?: (invoiceId: string) => void
  selectedInvoiceId?: string | null
}

export function InvoicePanel({ onSelectInvoice, selectedInvoiceId }: InvoicePanelProps) {
  const { profile } = useAuth()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [filterStatus, setFilterStatus] = useState<InvoiceStatus>('all')
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [error, setError] = useState<string | null>(null)

  const orgId = profile?.org_id

  // ── Proactive AI Context ────────────────────────────────────────────────────
  const backup = getBackupData()
  const serviceLogs = backup?.serviceLogs || []
  const overdue30 = serviceLogs.filter(s => num(s.quoted) > 0 && num(s.collected) === 0 && s.date && new Date(s.date) < new Date(Date.now() - 30 * 86400000))
  const overdue60 = serviceLogs.filter(s => num(s.quoted) > 0 && num(s.collected) === 0 && s.date && new Date(s.date) < new Date(Date.now() - 60 * 86400000))
  const overdue90 = serviceLogs.filter(s => num(s.quoted) > 0 && num(s.collected) === 0 && s.date && new Date(s.date) < new Date(Date.now() - 90 * 86400000))
  const totalOutstanding = serviceLogs.reduce((sum, s) => sum + Math.max(0, num(s.quoted) - num(s.collected)), 0)
  const ledgerContext = `AR Aging: $${totalOutstanding.toFixed(0)} total outstanding. 30+ days: ${overdue30.length} invoices. 60+ days: ${overdue60.length}. 90+ days: ${overdue90.length}. Total service logs: ${serviceLogs.length}. Analyze AR aging and recommend collection actions.`
  const ledgerSystem = 'You are LEDGER, the financial tracking agent for Power On Solutions LLC. Analyze accounts receivable aging, flag overdue invoices, and recommend collection priorities. Be specific with dollar amounts and customer names when possible.'
  const ledger = useProactiveAI('ledger', ledgerSystem, ledgerContext, serviceLogs.length > 0)

  // ── Fetch invoices ─────────────────────────────────────────────────────────
  const fetchInvoices = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)

    try {
      let query = supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          client_id,
          total,
          balance_due,
          status,
          days_overdue,
          due_date,
          created_at,
          clients!invoices_client_id_fkey (
            name
          )
        `)
        .eq('org_id', orgId)

      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus)
      }

      const { data, error: fetchError } = await query.order('created_at', { ascending: false })

      if (fetchError) throw fetchError
      const results = (data as Invoice[]) ?? []
      // Fall back to backup data if Supabase returns empty
      if (results.length === 0) {
        const backup = getBackupData()
        if (backup) {
          setInvoices(mapBackupInvoices(backup) as any)
          setLoading(false)
          return
        }
      }
      setInvoices(results)
    } catch (err) {
      console.error('[InvoicePanel] Fetch error:', err)
      // Fall back to backup data on error
      const backup = getBackupData()
      if (backup) {
        setInvoices(mapBackupInvoices(backup) as any)
        setError(null)
      } else {
        setError('Failed to load invoices')
      }
    } finally {
      setLoading(false)
    }
  }, [orgId, filterStatus])

  useEffect(() => {
    fetchInvoices()
  }, [fetchInvoices])

  // ── Filter invoices by search ──────────────────────────────────────────────
  const filteredInvoices = invoices.filter(inv =>
    inv.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (inv.clients?.name ?? '').toLowerCase().includes(searchTerm.toLowerCase())
  )

  // ── Render status badge ────────────────────────────────────────────────────
  const renderStatusBadge = (status: Invoice['status']) => {
    const config = STATUS_CONFIG[status]
    return (
      <span
        className={clsx(
          'inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold',
          config.bgColor,
          config.color
        )}
      >
        {config.label}
      </span>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-bg-1">
      <ProactiveInsightCard
        agentName="LEDGER"
        agentColor="#f97316"
        response={ledger.response}
        loading={ledger.loading}
        error={ledger.error}
        onRefresh={ledger.refresh}
        emptyMessage="No invoices yet. Once you log service calls I'll track your AR aging."
        systemPrompt={ledgerSystem}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-bg-4 bg-bg-1 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-400/10 border border-emerald-400/25 flex items-center justify-center">
            <FileText className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text-1">Invoices</h2>
            <div className="text-[10px] text-text-3 font-mono">
              {filteredInvoices.length} {filterStatus === 'all' ? 'total' : filterStatus}
            </div>
          </div>
        </div>

        <button className="p-1.5 hover:bg-bg-3 rounded-lg transition-colors">
          <Plus size={16} className="text-text-2" />
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 px-5 py-3 border-b border-bg-4 overflow-x-auto">
        {(['all', 'draft', 'sent', 'viewed', 'partial', 'paid', 'overdue'] as const).map(status => {
          const config = STATUS_CONFIG[status]
          const count = status === 'all' ? invoices.length : invoices.filter(i => i.status === status).length
          return (
            <button
              key={status}
              onClick={() => {
                setFilterStatus(status)
                setSearchTerm('')
              }}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all min-h-[44px]',
                filterStatus === status
                  ? clsx(config.bgColor, config.color, 'ring-1 ring-current')
                  : 'bg-bg-3 text-text-3 hover:bg-bg-4'
              )}
            >
              <span>{config.label}</span>
              <span className="text-[10px] opacity-70">({count})</span>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="px-5 py-3 border-b border-bg-4">
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-2 rounded-lg border border-bg-4">
          <Search size={14} className="text-text-4" />
          <input
            type="text"
            placeholder="Search invoice number or client..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4"
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mx-5 mt-3 px-4 py-2 rounded-lg bg-red/10 border border-red/25 text-xs text-red">
          {error}
        </div>
      )}

      {/* Invoice list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-text-3" />
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <div className="w-12 h-12 rounded-xl bg-bg-3 border border-bg-4 flex items-center justify-center mb-3">
              <FileText className="w-6 h-6 text-text-4" />
            </div>
            <p className="text-xs text-text-3">
              {searchTerm ? 'No invoices match your search' : 'No invoices found'}
            </p>
          </div>
        ) : (
          <div className="space-y-2 p-5">
            {filteredInvoices.map(inv => {
              const isSelected = selectedInvoiceId === inv.id
              return (
                <button
                  key={inv.id}
                  onClick={() => onSelectInvoice?.(inv.id)}
                  className={clsx(
                    'w-full text-left p-3 rounded-lg border transition-all duration-200',
                    isSelected
                      ? 'bg-emerald-400/10 border-emerald-400/50 ring-1 ring-emerald-400/25'
                      : 'bg-bg-2 border-bg-4 hover:bg-bg-3'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-text-1 truncate">
                        {inv.invoice_number}
                      </h4>
                      <p className="text-[10px] text-text-3 truncate">
                        {inv.clients?.name ?? 'Unknown client'}
                      </p>
                    </div>
                    {renderStatusBadge(inv.status)}
                  </div>

                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-[10px] text-text-4">
                      Due: {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : 'Not set'}
                      {inv.days_overdue > 0 && (
                        <span className="text-red ml-1 font-semibold">({inv.days_overdue}d overdue)</span>
                      )}
                    </div>
                    <div className="flex gap-2 items-baseline text-right">
                      <div className="text-right">
                        <div className="text-xs font-bold text-text-1">
                          ${(inv.total ?? 0).toFixed(2)}
                        </div>
                        {(inv.balance_due ?? 0) > 0 && (
                          <div className="text-[10px] text-text-4">
                            ${(inv.balance_due ?? 0).toFixed(2)} due
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
