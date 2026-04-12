/**
 * InvoiceHistory — Invoice list with download and status tracking
 *
 * Features:
 * - List of past invoices from Stripe
 * - Columns: date, amount, status (paid/failed/pending), download link
 * - Status badges with color coding
 * - Fetch via Netlify function that queries Stripe API
 * - Dark theme styling
 */

import { useState, useEffect } from 'react'
import { Download, FileText, Loader2, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string
  number: string | null
  amount: number
  amountPaid: number
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'
  dueDate: string | null
  createdAt: string
  pdfUrl: string | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InvoiceHistory() {
  const { profile } = useAuth()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const orgId = profile?.org_id

  // ── Fetch invoices from Stripe via Netlify function ──────────────────────────
  useEffect(() => {
    const fetchInvoices = async () => {
      if (!orgId) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        const { data, error: fnError } = await supabase.functions.invoke('get-invoices', {
          body: { orgId },
        })

        if (fnError) {
          throw new Error(fnError.message || 'Failed to fetch invoices')
        }

        if (data?.invoices) {
          // Transform Stripe invoice object to our Invoice type
          const invoiceList: Invoice[] = (data.invoices as Record<string, unknown>[]).map(inv => ({
            id: inv.id as string,
            number: inv.number as string | null,
            amount: (inv.amount_due as number) / 100,
            amountPaid: (inv.amount_paid as number) / 100,
            status: (inv.status as Invoice['status']) || 'draft',
            dueDate: inv.due_date ? new Date((inv.due_date as number) * 1000).toISOString() : null,
            createdAt: new Date((inv.created as number) * 1000).toISOString(),
            pdfUrl: inv.invoice_pdf as string | null,
          }))

          setInvoices(invoiceList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
        }
      } catch (err) {
        console.error('[invoice-history] Failed to fetch invoices:', err)
        setError(err instanceof Error ? err.message : 'Failed to load invoices')
      } finally {
        setLoading(false)
      }
    }

    fetchInvoices()
  }, [orgId])

  // ── Download invoice PDF ──────────────────────────────────────────────────────
  const handleDownloadPdf = async (invoice: Invoice) => {
    if (!invoice.pdfUrl) return

    try {
      setDownloadingId(invoice.id)
      const response = await fetch(invoice.pdfUrl)
      if (!response.ok) throw new Error('Download failed')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Invoice-${invoice.number || invoice.id}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[invoice-history] PDF download failed:', err)
      alert('Failed to download invoice PDF')
    } finally {
      setDownloadingId(null)
    }
  }

  // ── Status badge styling ──────────────────────────────────────────────────────
  const getStatusConfig = (status: Invoice['status']) => {
    switch (status) {
      case 'paid':
        return { label: 'Paid', color: 'emerald', bg: 'bg-emerald-500/10' }
      case 'open':
        return { label: 'Outstanding', color: 'yellow', bg: 'bg-yellow-500/10' }
      case 'draft':
        return { label: 'Draft', color: 'gray', bg: 'bg-text-4/10' }
      case 'void':
        return { label: 'Void', color: 'text-4', bg: 'bg-text-4/5' }
      case 'uncollectible':
        return { label: 'Uncollectible', color: 'red', bg: 'bg-red-500/10' }
      default:
        return { label: status, color: 'text-3', bg: 'bg-text-3/5' }
    }
  }

  // ── Format date ───────────────────────────────────────────────────────────────
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-bg-2 to-bg-3 border border-bg-4 rounded-2xl p-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-cyan animate-spin mr-3" />
          <p className="text-text-2">Loading invoices...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-gradient-to-br from-bg-2 to-bg-3 border border-bg-4 rounded-2xl p-8">
        <div className="flex items-start gap-3 text-red-400">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Failed to load invoices</p>
            <p className="text-sm text-text-3 mt-1">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (invoices.length === 0) {
    return (
      <div className="bg-gradient-to-br from-bg-2 to-bg-3 border border-bg-4 rounded-2xl p-12">
        <div className="text-center">
          <FileText className="w-12 h-12 text-text-4 mx-auto mb-3 opacity-50" />
          <p className="text-text-3">No invoices yet</p>
          <p className="text-text-4 text-sm mt-1">Your billing invoices will appear here</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-bg-2 to-bg-3 border border-bg-4 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-bg-4 bg-bg-1/20">
        <h3 className="text-lg font-bold text-text-1">Invoice History</h3>
      </div>

      {/* List */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-bg-4 bg-bg-1/40">
              <th className="px-6 py-3 text-left text-xs font-bold text-text-4 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-text-4 uppercase tracking-wider">Invoice #</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-text-4 uppercase tracking-wider">Amount</th>
              <th className="px-6 py-3 text-center text-xs font-bold text-text-4 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-center text-xs font-bold text-text-4 uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(invoice => {
              const statusConfig = getStatusConfig(invoice.status)
              const statusColorClass =
                statusConfig.color === 'emerald'
                  ? 'text-emerald-400'
                  : statusConfig.color === 'yellow'
                    ? 'text-yellow-400'
                    : statusConfig.color === 'red'
                      ? 'text-red-400'
                      : 'text-text-4'

              return (
                <tr
                  key={invoice.id}
                  className="border-b border-bg-4 hover:bg-bg-1/30 transition-colors"
                >
                  <td className="px-6 py-4">
                    <p className="text-sm text-text-2 font-medium">{formatDate(invoice.createdAt)}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-text-2">
                      {invoice.number ? `INV-${invoice.number}` : invoice.id.slice(-8).toUpperCase()}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <p className="text-sm font-bold text-text-1">${invoice.amount.toFixed(2)}</p>
                    {invoice.amountPaid > 0 && invoice.amountPaid < invoice.amount && (
                      <p className="text-xs text-text-4 mt-0.5">
                        Paid: ${invoice.amountPaid.toFixed(2)}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span
                      className={clsx(
                        'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold',
                        statusConfig.bg,
                        statusColorClass
                      )}
                    >
                      {statusConfig.label}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {invoice.pdfUrl ? (
                      <button
                        onClick={() => handleDownloadPdf(invoice)}
                        disabled={downloadingId === invoice.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-bg-3 disabled:text-text-4 text-white rounded-lg text-xs font-medium transition-colors"
                      >
                        {downloadingId === invoice.id ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Downloading...
                          </>
                        ) : (
                          <>
                            <Download className="w-3 h-3" />
                            PDF
                          </>
                        )}
                      </button>
                    ) : (
                      <p className="text-xs text-text-4">—</p>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Note */}
      <div className="px-6 py-3 bg-bg-1/20 border-t border-bg-4 text-xs text-text-4">
        Invoices older than 7 years are archived. Contact support for historical records.
      </div>
    </div>
  )
}

export default InvoiceHistory
