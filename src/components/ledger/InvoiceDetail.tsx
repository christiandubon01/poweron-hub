// @ts-nocheck
/**
 * InvoiceDetail — Invoice detail view/modal.
 *
 * Features:
 * - Full invoice header and details
 * - Line items table
 * - Totals breakdown
 * - Status and actions (send, record payment, void)
 * - Dark themed
 */

import { useState } from 'react'
import { X, Send, DollarSign, Trash2, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'
import type { Invoice } from './InvoicePanel'
import { PaymentForm } from './PaymentForm'

// ── Types ───────────────────────────────────────────────────────────────────

export interface LineItem {
  description: string
  quantity: number
  unitPrice: number
  total: number
}

export interface InvoiceDetailData extends Invoice {
  line_items?: LineItem[]
  subtotal?: number
  tax_rate?: number
  tax_amount?: number
  notes?: string
  sent_at?: string | null
  paid_at?: string | null
}

// ── Component ───────────────────────────────────────────────────────────────

export interface InvoiceDetailProps {
  invoice: InvoiceDetailData | null
  onClose: () => void
  onStatusChange?: (newStatus: string) => void
  onPaymentRecorded?: () => void
}

export function InvoiceDetail({ invoice, onClose, onStatusChange, onPaymentRecorded }: InvoiceDetailProps) {
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  if (!invoice) {
    return null
  }

  const lineItems = (invoice.line_items ?? []) as LineItem[]
  const subtotal = invoice.subtotal ?? 0
  const taxRate = invoice.tax_rate ?? 0
  const taxAmount = invoice.tax_amount ?? 0
  const total = invoice.total ?? 0
  const balanceDue = invoice.balance_due ?? 0

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleSendInvoice = async () => {
    setActionLoading(true)
    setError(null)

    try {
      // Calculate due date (Net 30)
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + 30)

      // Update invoice
      const { error: updateError } = await supabase
        .from('invoices')
        .update({
          status: 'sent',
          due_date: dueDate.toISOString().split('T')[0],
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id)

      if (updateError) throw updateError

      // Log audit
      await logAudit({
        action: 'send',
        entity_type: 'invoices',
        entity_id: invoice.id,
        description: `Invoice ${invoice.invoice_number} sent to client. Due date: ${dueDate.toISOString().split('T')[0]}`,
      })

      setSuccessMessage('Invoice sent successfully')
      onStatusChange?.('sent')
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (err) {
      console.error('[InvoiceDetail] Send failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to send invoice')
    } finally {
      setActionLoading(false)
    }
  }

  const handleVoidInvoice = async () => {
    if (!window.confirm('Are you sure? This cannot be undone.')) return

    setActionLoading(true)
    setError(null)

    try {
      const { error: updateError } = await supabase
        .from('invoices')
        .update({
          status: 'void',
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id)

      if (updateError) throw updateError

      await logAudit({
        action: 'update',
        entity_type: 'invoices',
        entity_id: invoice.id,
        description: `Invoice ${invoice.invoice_number} voided`,
      })

      setSuccessMessage('Invoice voided')
      onStatusChange?.('void')
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (err) {
      console.error('[InvoiceDetail] Void failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to void invoice')
    } finally {
      setActionLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'text-text-3',
      sent: 'text-blue',
      viewed: 'text-cyan',
      partial: 'text-yellow-400',
      paid: 'text-emerald-400',
      overdue: 'text-red',
      void: 'text-text-4',
      disputed: 'text-orange-400',
    }
    return colors[status] ?? 'text-text-2'
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] bg-bg-1 rounded-xl border border-bg-4 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-bg-4 bg-bg-1">
          <div>
            <h2 className="text-lg font-bold text-text-1">{invoice.invoice_number}</h2>
            <p className="text-xs text-text-3 mt-1">
              {invoice.clients?.name ?? 'Unknown client'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={clsx('text-xs font-bold', getStatusColor(invoice.status))}>
              {invoice.status.toUpperCase()}
            </span>
            <button
              onClick={onClose}
              className="p-1 hover:bg-bg-2 rounded-lg transition-colors"
            >
              <X size={16} className="text-text-3" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-6">
            {/* Status info */}
            {(invoice.days_overdue ?? 0) > 0 && (
              <div className="flex items-start gap-3 p-3 bg-red/10 border border-red/25 rounded-lg">
                <AlertCircle size={16} className="text-red mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-red">
                    {invoice.days_overdue} days overdue
                  </p>
                  <p className="text-[10px] text-red/80 mt-0.5">
                    Due date: {invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : 'Not set'}
                  </p>
                </div>
              </div>
            )}

            {/* Line items table */}
            {lineItems.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-text-1 mb-3 uppercase tracking-wide">Line Items</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-bg-4">
                        <th className="text-left py-2 px-3 font-semibold text-text-2">Description</th>
                        <th className="text-right py-2 px-3 font-semibold text-text-2">Qty</th>
                        <th className="text-right py-2 px-3 font-semibold text-text-2">Unit Price</th>
                        <th className="text-right py-2 px-3 font-semibold text-text-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((item, i) => (
                        <tr key={i} className="border-b border-bg-3">
                          <td className="py-2 px-3 text-text-2">{item.description}</td>
                          <td className="py-2 px-3 text-right text-text-2">{item.quantity}</td>
                          <td className="py-2 px-3 text-right text-text-2">${item.unitPrice.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-text-1 font-semibold">
                            ${item.total.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Totals */}
            <div className="space-y-2 p-4 bg-bg-2 rounded-lg border border-bg-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-2">Subtotal:</span>
                <span className="text-text-1 font-semibold">${subtotal.toFixed(2)}</span>
              </div>
              {taxRate > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-2">Tax ({(taxRate * 100).toFixed(0)}%):</span>
                  <span className="text-text-1 font-semibold">${taxAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-bg-4 text-base">
                <span className="font-bold text-text-1">Total:</span>
                <span className="font-bold text-emerald-400">${total.toFixed(2)}</span>
              </div>
              {(invoice.amount_paid ?? 0) > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-bg-4 text-sm">
                  <span className="text-text-2">Paid:</span>
                  <span className="text-emerald-400 font-semibold">${(invoice.amount_paid ?? 0).toFixed(2)}</span>
                </div>
              )}
              {balanceDue > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-2">Balance Due:</span>
                  <span className="text-red font-bold">${balanceDue.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Additional info */}
            {invoice.notes && (
              <div>
                <h3 className="text-xs font-bold text-text-1 mb-2 uppercase tracking-wide">Notes</h3>
                <p className="text-xs text-text-2 bg-bg-2 p-3 rounded-lg border border-bg-4">
                  {invoice.notes}
                </p>
              </div>
            )}

            {/* Timestamps */}
            <div className="grid grid-cols-2 gap-3 text-[10px]">
              <div>
                <span className="text-text-4 block">Created</span>
                <span className="text-text-2 font-mono">
                  {new Date(invoice.created_at).toLocaleDateString()}
                </span>
              </div>
              {invoice.sent_at && (
                <div>
                  <span className="text-text-4 block">Sent</span>
                  <span className="text-text-2 font-mono">
                    {new Date(invoice.sent_at).toLocaleDateString()}
                  </span>
                </div>
              )}
              {invoice.paid_at && (
                <div>
                  <span className="text-text-4 block">Paid</span>
                  <span className="text-text-2 font-mono">
                    {new Date(invoice.paid_at).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Payment form (if shown) */}
        {showPaymentForm && (
          <div className="border-t border-bg-4 bg-bg-2 p-6">
            <PaymentForm
              invoiceId={invoice.id}
              balanceDue={balanceDue}
              onSuccess={() => {
                setShowPaymentForm(false)
                onPaymentRecorded?.()
                setSuccessMessage('Payment recorded')
                setTimeout(() => onClose(), 1500)
              }}
              onCancel={() => setShowPaymentForm(false)}
            />
          </div>
        )}

        {/* Messages */}
        {error && (
          <div className="px-6 py-2 bg-red/10 border-t border-red/25 text-xs text-red">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="px-6 py-2 bg-emerald-400/10 border-t border-emerald-400/25 text-xs text-emerald-400">
            {successMessage}
          </div>
        )}

        {/* Actions */}
        {!showPaymentForm && (
          <div className="border-t border-bg-4 bg-bg-2 px-6 py-4 flex items-center justify-end gap-2">
            {balanceDue > 0 && invoice.status !== 'paid' && (
              <button
                onClick={() => setShowPaymentForm(true)}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <DollarSign size={14} />
                Record Payment
              </button>
            )}

            {invoice.status === 'draft' && (
              <button
                onClick={handleSendInvoice}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue/10 text-blue hover:bg-blue/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={14} />
                Send Invoice
              </button>
            )}

            {invoice.status !== 'void' && invoice.status !== 'paid' && (
              <button
                onClick={handleVoidInvoice}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-text-4/10 text-text-3 hover:bg-text-4/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 size={14} />
                Void
              </button>
            )}

            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-bg-3 text-text-2 hover:bg-bg-4 transition-all"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
