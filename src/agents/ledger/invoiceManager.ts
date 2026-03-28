// @ts-nocheck
/**
 * Invoice Manager — Core invoice lifecycle and payment operations.
 *
 * Handles:
 * - Invoice status transitions with validation
 * - Payment recording and reconciliation
 * - Invoice creation from estimates
 * - Overdue invoice detection and notification
 * - Invoice number generation
 */

import { supabase, type Tables, type InsertDto, type UpdateDto } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'

// ── Types ───────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'partial' | 'paid' | 'overdue' | 'void' | 'disputed'

export interface InvoiceStateTransition {
  from: InvoiceStatus
  to: InvoiceStatus
}

// Valid state transitions as per spec
const VALID_TRANSITIONS: InvoiceStateTransition[] = [
  { from: 'draft', to: 'sent' },
  { from: 'draft', to: 'void' },
  { from: 'sent', to: 'viewed' },
  { from: 'sent', to: 'partial' },
  { from: 'sent', to: 'paid' },
  { from: 'sent', to: 'overdue' },
  { from: 'viewed', to: 'paid' },
  { from: 'viewed', to: 'partial' },
  { from: 'viewed', to: 'overdue' },
  { from: 'partial', to: 'paid' },
  { from: 'overdue', to: 'paid' },
  { from: 'overdue', to: 'disputed' },
]

export interface PaymentInput {
  invoiceId: string
  amount: number
  method: 'check' | 'cash' | 'credit_card' | 'ach' | 'zelle' | 'venmo' | 'other'
  date: string // ISO date
  reference?: string // Check #, ACH ID, credit card last 4, etc.
  notes?: string
}

// ── Invoice Status Transitions ──────────────────────────────────────────────

/**
 * Validate and execute an invoice status transition.
 * Returns true if successful, throws if invalid.
 */
export async function transitionInvoiceStatus(
  invoiceId: string,
  newStatus: InvoiceStatus,
  reason?: string
): Promise<boolean> {
  // Get current invoice
  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single()

  if (fetchError || !invoice) {
    throw new Error(`Invoice not found: ${invoiceId}`)
  }

  // Validate transition
  const currentStatus = invoice.status as InvoiceStatus
  const isValidTransition = VALID_TRANSITIONS.some(
    t => t.from === currentStatus && t.to === newStatus
  )

  if (!isValidTransition) {
    throw new Error(
      `Invalid status transition: ${currentStatus} → ${newStatus}`
    )
  }

  // Prepare updates based on new status
  const updates: Partial<UpdateDto<'invoices'>> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  }

  // Set status-specific timestamps
  if (newStatus === 'sent' && !invoice.sent_at) {
    updates.sent_at = new Date().toISOString()
  }
  if (newStatus === 'paid' && !invoice.paid_at) {
    updates.paid_at = new Date().toISOString()
  }

  // Update invoice
  const { error: updateError } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', invoiceId)

  if (updateError) {
    throw new Error(`Status update failed: ${updateError.message}`)
  }

  // Log audit
  await logAudit({
    action: 'update',
    entity_type: 'invoices',
    entity_id: invoiceId,
    description: `Status transitioned: ${currentStatus} → ${newStatus}${reason ? `. Reason: ${reason}` : ''}`,
    changes: {
      status: { old: currentStatus, new: newStatus },
    },
  })

  return true
}

// ── Payment Recording ───────────────────────────────────────────────────────

/**
 * Record a payment against an invoice.
 * Validates amount <= balance_due, creates payment record, updates invoice.
 * Auto-transitions invoice if fully paid.
 */
export async function recordPayment(input: PaymentInput): Promise<{ paymentId: string; newStatus: InvoiceStatus }> {
  // Get invoice
  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', input.invoiceId)
    .single()

  if (fetchError || !invoice) {
    throw new Error(`Invoice not found: ${input.invoiceId}`)
  }

  const balanceDue = invoice.balance_due ?? 0
  if (input.amount <= 0) {
    throw new Error('Payment amount must be > 0')
  }
  if (input.amount > balanceDue) {
    throw new Error(`Payment amount (${input.amount}) exceeds balance due (${balanceDue})`)
  }

  // Get current user for recorded_by
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('User not authenticated')
  }

  // Create payment record
  const paymentData: InsertDto<'payments'> = {
    org_id: invoice.org_id,
    invoice_id: input.invoiceId,
    amount: input.amount,
    method: input.method,
    reference: input.reference,
    received_at: new Date(input.date).toISOString(),
    recorded_by: user.id,
    notes: input.notes,
  }

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .insert(paymentData as InsertDto<'payments'>)
    .select('id')
    .single()

  if (paymentError || !payment) {
    throw new Error(`Payment record failed: ${paymentError?.message}`)
  }

  // Calculate new balance and status
  const newBalanceDue = Math.max(0, balanceDue - input.amount)
  const newStatus: InvoiceStatus = newBalanceDue === 0 ? 'paid' : 'partial'

  // Update invoice
  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      amount_paid: (invoice.amount_paid ?? 0) + input.amount,
      balance_due: newBalanceDue,
      status: newStatus,
      updated_at: new Date().toISOString(),
      paid_at: newStatus === 'paid' ? new Date().toISOString() : invoice.paid_at,
    })
    .eq('id', input.invoiceId)

  if (updateError) {
    throw new Error(`Invoice update failed: ${updateError.message}`)
  }

  // Log audit
  await logAudit({
    action: 'update',
    entity_type: 'payments',
    entity_id: payment.id,
    description: `Payment recorded: $${input.amount.toFixed(2)} via ${input.method}. Invoice status: ${invoice.status} → ${newStatus}`,
    changes: {
      amount_paid: { old: invoice.amount_paid, new: (invoice.amount_paid ?? 0) + input.amount },
      balance_due: { old: balanceDue, new: newBalanceDue },
      status: { old: invoice.status, new: newStatus },
    },
  })

  return { paymentId: payment.id, newStatus }
}

// ── Invoice Creation from Estimate ──────────────────────────────────────────

/**
 * Create an invoice from an approved estimate.
 * Copies line_items, calculates totals.
 * Returns invoice ID.
 */
export async function createInvoiceFromEstimate(
  estimateId: string,
  orgId: string,
  userId: string
): Promise<string> {
  // Get estimate
  const { data: estimate, error: estimateError } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', estimateId)
    .eq('org_id', orgId)
    .single()

  if (estimateError || !estimate) {
    throw new Error(`Estimate not found: ${estimateId}`)
  }

  // Generate invoice number
  const invoiceNumber = await generateInvoiceNumber()

  // Prepare invoice
  const invoiceData: InsertDto<'invoices'> = {
    org_id: orgId,
    project_id: estimate.project_id,
    client_id: estimate.client_id,
    invoice_number: invoiceNumber,
    status: 'draft',
    line_items: estimate.line_items,
    subtotal: estimate.subtotal,
    tax_rate: estimate.tax_rate,
    tax_amount: estimate.tax_amount,
    total: estimate.total,
    amount_paid: 0,
    balance_due: estimate.total,
    due_date: null, // Will be set when sent
    days_overdue: 0,
    created_by: userId,
  }

  const { data: invoice, error: insertError } = await supabase
    .from('invoices')
    .insert(invoiceData)
    .select('id')
    .single()

  if (insertError || !invoice) {
    throw new Error(`Invoice creation failed: ${insertError?.message}`)
  }

  // Log audit
  await logAudit({
    action: 'insert',
    entity_type: 'invoices',
    entity_id: invoice.id,
    description: `Invoice created from estimate ${estimateId}. Number: ${invoiceNumber}`,
    metadata: {
      estimate_id: estimateId,
      invoice_number: invoiceNumber,
      total: estimate.total,
    },
  })

  return invoice.id
}

// ── Overdue Detection ───────────────────────────────────────────────────────

/**
 * Check for overdue invoices and transition them.
 * Creates notifications for overdue items.
 * Returns count of invoices transitioned to overdue.
 */
export async function checkOverdueInvoices(orgId: string): Promise<number> {
  const now = new Date().toISOString()
  let overdueCount = 0

  // Find sent/viewed/partial invoices past due date
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('org_id', orgId)
    .in('status', ['sent', 'viewed', 'partial'])
    .not('due_date', 'is', null)
    .lt('due_date', now)

  if (error) {
    console.error('[LEDGER] Overdue check query failed:', error.message)
    return 0
  }

  if (!invoices || invoices.length === 0) {
    return 0
  }

  // Transition each to overdue
  for (const invoice of invoices) {
    try {
      await transitionInvoiceStatus(invoice.id, 'overdue', 'Auto-transitioned: past due date')
      overdueCount++

      // Create notification
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.id) {
        await supabase
          .from('notifications')
          .insert({
            org_id: orgId,
            user_id: user.id,
            type: 'alert',
            title: `Invoice Overdue: ${invoice.invoice_number}`,
            body: `Invoice #${invoice.invoice_number} is now ${invoice.days_overdue} days overdue. Balance due: $${invoice.balance_due?.toFixed(2)}`,
            data: {
              invoice_id: invoice.id,
              invoice_number: invoice.invoice_number,
              balance_due: invoice.balance_due,
              days_overdue: invoice.days_overdue,
            },
          } as InsertDto<'notifications'>)
      }
    } catch (err) {
      console.warn(`[LEDGER] Failed to transition invoice ${invoice.id}:`, err)
    }
  }

  return overdueCount
}

// ── Invoice Number Generation ───────────────────────────────────────────────

/**
 * Generate next invoice number in format INV-YYYY-NNNNN.
 * YYYY = current year, NNNNN = 5-digit zero-padded sequence.
 */
export async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const yearStr = year.toString()

  // Get the highest sequence number for this year
  const { data, error } = await supabase
    .from('invoices')
    .select('invoice_number')
    .like('invoice_number', `INV-${yearStr}-%`)
    .order('invoice_number', { ascending: false })
    .limit(1)

  let nextSequence = 1
  if (!error && data && data.length > 0) {
    const lastNumber = data[0].invoice_number
    const match = lastNumber.match(/INV-\d+-(\d+)/)
    if (match) {
      nextSequence = parseInt(match[1], 10) + 1
    }
  }

  const sequence = String(nextSequence).padStart(5, '0')
  return `INV-${yearStr}-${sequence}`
}
