// @ts-nocheck
/**
 * PaymentForm — Payment recording form.
 *
 * Features:
 * - Amount input (pre-filled with balance_due)
 * - Payment method dropdown
 * - Reference input (check #, ACH ID, etc.)
 * - Date picker
 * - Submit and cancel buttons
 * - Dark themed
 */

import { useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'

// ── Types ───────────────────────────────────────────────────────────────────

export type PaymentMethod = 'check' | 'cash' | 'credit_card' | 'ach' | 'zelle' | 'venmo' | 'other'

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'check', label: 'Check' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'ach', label: 'ACH Transfer' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'other', label: 'Other' },
]

// ── Component ───────────────────────────────────────────────────────────────

export interface PaymentFormProps {
  invoiceId: string
  balanceDue: number
  onSuccess: () => void
  onCancel: () => void
}

export function PaymentForm({ invoiceId, balanceDue, onSuccess, onCancel }: PaymentFormProps) {
  const [amount, setAmount] = useState<string>(balanceDue.toFixed(2))
  const [method, setMethod] = useState<PaymentMethod>('check')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validate
    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Amount must be greater than 0')
      return
    }
    if (parsedAmount > balanceDue) {
      setError(`Amount cannot exceed balance due ($${balanceDue.toFixed(2)})`)
      return
    }
    if (!date) {
      setError('Payment date is required')
      return
    }

    setLoading(true)

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error('User not authenticated')
      }

      // Get invoice org_id
      const { data: invoice } = await supabase
        .from('invoices')
        .select('org_id, balance_due, status, amount_paid')
        .eq('id', invoiceId)
        .single()

      if (!invoice) {
        throw new Error('Invoice not found')
      }

      // Create payment record
      const paymentData = {
        org_id: invoice.org_id,
        invoice_id: invoiceId,
        amount: parsedAmount,
        method,
        reference: reference || null,
        received_at: new Date(date).toISOString(),
        recorded_by: user.id,
        notes: notes || null,
      }

      const { data: payment, error: paymentError } = await supabase
        .from('payments')
        .insert(paymentData)
        .select('id')
        .single()

      if (paymentError || !payment) {
        throw new Error(paymentError?.message ?? 'Payment creation failed')
      }

      // Calculate new invoice state
      const newAmountPaid = (invoice.amount_paid ?? 0) + parsedAmount
      const newBalanceDue = Math.max(0, (invoice.balance_due ?? 0) - parsedAmount)
      const newStatus = newBalanceDue === 0 ? 'paid' : 'partial'

      // Update invoice
      const { error: updateError } = await supabase
        .from('invoices')
        .update({
          amount_paid: newAmountPaid,
          balance_due: newBalanceDue,
          status: newStatus,
          updated_at: new Date().toISOString(),
          paid_at: newStatus === 'paid' ? new Date().toISOString() : invoice.paid_at,
        })
        .eq('id', invoiceId)

      if (updateError) {
        throw new Error(updateError.message)
      }

      // Log audit
      await logAudit({
        action: 'update',
        entity_type: 'payments',
        entity_id: payment.id,
        description: `Payment recorded: $${parsedAmount.toFixed(2)} via ${method}. Invoice status: ${invoice.status} → ${newStatus}`,
        changes: {
          amount_paid: { old: invoice.amount_paid, new: newAmountPaid },
          balance_due: { old: invoice.balance_due, new: newBalanceDue },
          status: { old: invoice.status, new: newStatus },
        },
      })

      onSuccess()
    } catch (err) {
      console.error('[PaymentForm] Submit failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to record payment')
    } finally {
      setLoading(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h3 className="text-sm font-bold text-text-1">Record Payment</h3>

      {/* Amount */}
      <div>
        <label className="block text-xs font-semibold text-text-2 mb-1.5">
          Amount
          <span className="text-text-4 ml-1">
            (Balance due: ${balanceDue.toFixed(2)})
          </span>
        </label>
        <div className="relative">
          <span className="absolute left-3 top-2 text-text-3 font-semibold">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            max={balanceDue}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-full pl-6 pr-3 py-2 bg-bg-1 border border-bg-4 rounded-lg text-sm text-text-1 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            required
          />
        </div>
      </div>

      {/* Payment Method */}
      <div>
        <label className="block text-xs font-semibold text-text-2 mb-1.5">
          Payment Method
        </label>
        <select
          value={method}
          onChange={e => setMethod(e.target.value as PaymentMethod)}
          className="w-full px-3 py-2 bg-bg-1 border border-bg-4 rounded-lg text-sm text-text-1 focus:outline-none focus:ring-1 focus:ring-emerald-400"
        >
          {PAYMENT_METHODS.map(m => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Reference */}
      <div>
        <label className="block text-xs font-semibold text-text-2 mb-1.5">
          Reference
          <span className="text-text-4 font-normal ml-1">
            (Check #, ACH ID, card last 4, etc.)
          </span>
        </label>
        <input
          type="text"
          value={reference}
          onChange={e => setReference(e.target.value)}
          placeholder="e.g., Check #12345"
          className="w-full px-3 py-2 bg-bg-1 border border-bg-4 rounded-lg text-sm text-text-1 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
      </div>

      {/* Date */}
      <div>
        <label className="block text-xs font-semibold text-text-2 mb-1.5">
          Payment Date
        </label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="w-full px-3 py-2 bg-bg-1 border border-bg-4 rounded-lg text-sm text-text-1 focus:outline-none focus:ring-1 focus:ring-emerald-400"
          required
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-semibold text-text-2 mb-1.5">
          Notes
          <span className="text-text-4 font-normal ml-1">(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Any additional notes about this payment..."
          rows={2}
          className="w-full px-3 py-2 bg-bg-1 border border-bg-4 rounded-lg text-sm text-text-1 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-emerald-400 resize-none"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 bg-red/10 border border-red/25 rounded-lg text-xs text-red">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={loading}
          className={clsx(
            'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all',
            loading
              ? 'bg-emerald-400/20 text-emerald-400 cursor-not-allowed'
              : 'bg-emerald-400 text-bg-1 hover:brightness-110'
          )}
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Check size={14} />
              Record Payment
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold bg-bg-3 text-text-2 hover:bg-bg-4 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
