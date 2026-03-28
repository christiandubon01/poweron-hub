// @ts-nocheck
/**
 * LEDGER Orchestrator — Routes and processes financial requests.
 *
 * Actions:
 * - create_invoice: Natural language invoice creation
 * - create_from_estimate: Create invoice from approved estimate
 * - send: Send invoice (transition to sent + set due_date)
 * - record_payment: Record a payment
 * - check_overdue: Find and transition overdue invoices
 * - get_ar_summary: Get AR summary with aging buckets
 * - get_collection_recommendations: Generate collection actions
 *
 * Uses Claude API for natural language invoice creation and collection recommendations.
 */

import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'
import { LEDGER_SYSTEM_PROMPT } from './systemPrompt'
import * as invoiceManager from './invoiceManager'
import * as cashFlowAnalyzer from './cashFlowAnalyzer'
import { subscribe, publish, type AgentEvent } from '@/services/agentEventBus'

// ── Types ───────────────────────────────────────────────────────────────────

export type LedgerAction =
  | 'create_invoice'
  | 'create_from_estimate'
  | 'send'
  | 'record_payment'
  | 'check_overdue'
  | 'get_ar_summary'
  | 'get_collection_recommendations'

export interface LedgerRequest {
  action: LedgerAction
  orgId: string
  userId: string
  payload?: Record<string, unknown>
  userMessage?: string
}

export interface LedgerResponse {
  success: boolean
  action: LedgerAction
  data?: unknown
  error?: string
  metadata?: Record<string, unknown>
}

// ── Main Orchestrator ───────────────────────────────────────────────────────

/**
 * Process a LEDGER request.
 * Routes to appropriate handler based on action.
 */
export async function processLedgerRequest(request: LedgerRequest): Promise<LedgerResponse> {
  try {
    switch (request.action) {
      case 'create_invoice':
        return await handleCreateInvoice(request)

      case 'create_from_estimate':
        return await handleCreateFromEstimate(request)

      case 'send':
        return await handleSendInvoice(request)

      case 'record_payment':
        return await handleRecordPayment(request)

      case 'check_overdue':
        return await handleCheckOverdue(request)

      case 'get_ar_summary':
        return await handleGetARSummary(request)

      case 'get_collection_recommendations':
        return await handleGetCollectionRecommendations(request)

      default:
        return {
          success: false,
          action: request.action,
          error: `Unknown action: ${request.action}`,
        }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[LEDGER] ${request.action} failed:`, err)
    return {
      success: false,
      action: request.action,
      error: errorMessage,
    }
  }
}

// ── Create Invoice Handler ──────────────────────────────────────────────────

async function handleCreateInvoice(req: LedgerRequest): Promise<LedgerResponse> {
  if (!req.userMessage) {
    return { success: false, action: 'create_invoice', error: 'No invoice description provided' }
  }

  // Use Claude to parse natural language invoice request
  const prompt = `Parse this invoice creation request and return a JSON object with:
- clientId: UUID or name (required)
- projectId: UUID or null
- lineItems: array of {description, quantity, unitPrice}
- taxRate: decimal (0-1) or null
- notes: string or null

User request: "${req.userMessage}"

Return ONLY valid JSON with these fields. If any required field is missing, include null.`

  try {
    const response = await fetch('/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: LEDGER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`)
    }

    const data = await response.json()
    const content = (data.content?.[0]?.text ?? '') as string

    // Parse JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Failed to parse invoice data from Claude')
    }

    const invoiceData = JSON.parse(jsonMatch[0])

    // Resolve client if provided as name
    let clientId = invoiceData.clientId
    if (typeof clientId === 'string' && !clientId.includes('-')) {
      const { data: clients } = await supabase
        .from('clients')
        .select('id')
        .eq('org_id', req.orgId)
        .ilike('name', clientId)
        .limit(1)
      clientId = clients?.[0]?.id ?? null
    }

    // Build line items with calculated totals
    const lineItems = (invoiceData.lineItems ?? []).map((item: any) => ({
      description: item.description,
      quantity: item.quantity || 1,
      unitPrice: item.unitPrice || 0,
      total: (item.quantity || 1) * (item.unitPrice || 0),
    }))

    const subtotal = lineItems.reduce((sum: number, item: any) => sum + (item.total || 0), 0)
    const taxRate = invoiceData.taxRate ?? 0
    const taxAmount = subtotal * taxRate
    const total = subtotal + taxAmount

    // Generate invoice number
    const invoiceNumber = await invoiceManager.generateInvoiceNumber()

    // Create invoice
    const { data: invoice, error } = await supabase
      .from('invoices')
      .insert({
        org_id: req.orgId,
        project_id: invoiceData.projectId || null,
        client_id: clientId,
        invoice_number: invoiceNumber,
        status: 'draft',
        line_items: lineItems,
        subtotal,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total,
        amount_paid: 0,
        balance_due: total,
        due_date: null,
        days_overdue: 0,
        created_by: req.userId,
      })
      .select('id')
      .single()

    if (error || !invoice) {
      throw new Error(`Invoice creation failed: ${error?.message}`)
    }

    // Log audit
    await logAudit({
      action: 'insert',
      entity_type: 'invoices',
      entity_id: invoice.id,
      description: `Invoice created from natural language request. Invoice #${invoiceNumber}`,
      metadata: { invoice_number: invoiceNumber, total },
    })

    // Publish invoice creation event
    publish(
      'INVOICE_CREATED',
      'ledger',
      { invoiceId: invoice.id, invoiceNumber, total, lineItemCount: lineItems.length },
      `Invoice ${invoiceNumber} created: $${total.toLocaleString()}, ${lineItems.length} line items`
    )

    return {
      success: true,
      action: 'create_invoice',
      data: { invoiceId: invoice.id, invoiceNumber, total },
      metadata: { lineItemCount: lineItems.length },
    }
  } catch (err) {
    throw err
  }
}

// ── Create From Estimate Handler ────────────────────────────────────────────

async function handleCreateFromEstimate(req: LedgerRequest): Promise<LedgerResponse> {
  const estimateId = req.payload?.estimateId as string | undefined
  if (!estimateId) {
    return { success: false, action: 'create_from_estimate', error: 'estimateId required' }
  }

  const invoiceId = await invoiceManager.createInvoiceFromEstimate(estimateId, req.orgId, req.userId)

  return {
    success: true,
    action: 'create_from_estimate',
    data: { invoiceId },
  }
}

// ── Send Invoice Handler ────────────────────────────────────────────────────

async function handleSendInvoice(req: LedgerRequest): Promise<LedgerResponse> {
  const invoiceId = req.payload?.invoiceId as string | undefined
  if (!invoiceId) {
    return { success: false, action: 'send', error: 'invoiceId required' }
  }

  // Get invoice to calculate due date (Net 30)
  const { data: invoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single()

  if (!invoice) {
    return { success: false, action: 'send', error: 'Invoice not found' }
  }

  // Set due date 30 days from now
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 30)

  // Update due date and transition
  await supabase
    .from('invoices')
    .update({
      due_date: dueDate.toISOString().split('T')[0],
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)

  // Transition to sent
  await invoiceManager.transitionInvoiceStatus(invoiceId, 'sent', 'Sent to client')

  return {
    success: true,
    action: 'send',
    data: { invoiceId, dueDate: dueDate.toISOString().split('T')[0] },
  }
}

// ── Record Payment Handler ──────────────────────────────────────────────────

async function handleRecordPayment(req: LedgerRequest): Promise<LedgerResponse> {
  const invoiceId = req.payload?.invoiceId as string | undefined
  const amount = req.payload?.amount as number | undefined
  const method = req.payload?.method as string | undefined
  const date = req.payload?.date as string | undefined

  if (!invoiceId || !amount || !method || !date) {
    return { success: false, action: 'record_payment', error: 'invoiceId, amount, method, date required' }
  }

  const result = await invoiceManager.recordPayment({
    invoiceId,
    amount,
    method: method as any,
    date,
    reference: req.payload?.reference as string | undefined,
    notes: req.payload?.notes as string | undefined,
  })

  // Publish payment event
  publish(
    'PAYMENT_RECEIVED',
    'ledger',
    { invoiceId, amount, method, newStatus: result.newStatus },
    `Payment recorded: $${amount.toLocaleString()} via ${method}. Invoice → ${result.newStatus}`
  )

  return {
    success: true,
    action: 'record_payment',
    data: result,
  }
}

// ── Check Overdue Handler ───────────────────────────────────────────────────

async function handleCheckOverdue(req: LedgerRequest): Promise<LedgerResponse> {
  const count = await invoiceManager.checkOverdueInvoices(req.orgId)

  return {
    success: true,
    action: 'check_overdue',
    data: { overduCount: count },
    metadata: { processedAt: new Date().toISOString() },
  }
}

// ── Get AR Summary Handler ──────────────────────────────────────────────────

async function handleGetARSummary(req: LedgerRequest): Promise<LedgerResponse> {
  const summary = await cashFlowAnalyzer.getARSummary(req.orgId)

  return {
    success: true,
    action: 'get_ar_summary',
    data: summary,
  }
}

// ── Get Collection Recommendations Handler ──────────────────────────────────

async function handleGetCollectionRecommendations(req: LedgerRequest): Promise<LedgerResponse> {
  const recommendations = await cashFlowAnalyzer.getCollectionRecommendations(req.orgId)

  return {
    success: true,
    action: 'get_collection_recommendations',
    data: { recommendations, count: recommendations.length },
  }
}

// ── Event Bus Integration ────────────────────────────────────────────────────

/**
 * Subscribe LEDGER to relevant events from other agents.
 * - ESTIMATE_APPROVED → auto-create invoice from estimate
 * Call once on app startup after initEventBus().
 * Returns an unsubscribe function.
 */
export function subscribeLedgerToEvents(): () => void {
  const unsubs: Array<() => void> = []

  // VAULT → LEDGER: estimate approved triggers invoice creation
  unsubs.push(subscribe('ESTIMATE_APPROVED', async (event: AgentEvent) => {
    const { estimateId, orgId, estimateNumber, total } = event.payload as {
      estimateId: string; orgId: string; estimateNumber?: string; total?: number
    }

    if (!estimateId || !orgId) {
      console.warn('[LEDGER] ESTIMATE_APPROVED missing required payload:', event.payload)
      return
    }

    console.log(`[LEDGER] Creating invoice from approved estimate ${estimateId}`)

    try {
      const invoiceId = await invoiceManager.createInvoiceFromEstimate(estimateId, orgId, '')

      // Publish invoice creation event
      publish(
        'INVOICE_CREATED',
        'ledger',
        {
          invoiceId,
          fromEstimate: estimateId,
          estimateNumber: estimateNumber || 'unknown',
          total: total || 0,
        },
        `Invoice created from approved estimate ${estimateNumber || estimateId}: $${(total || 0).toLocaleString()}`
      )

      console.log(`[LEDGER] Invoice ${invoiceId} created from estimate ${estimateId}`)
    } catch (err) {
      console.error(`[LEDGER] Failed to create invoice from estimate ${estimateId}:`, err)
    }
  }))

  return () => unsubs.forEach(fn => fn())
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { invoiceManager, cashFlowAnalyzer }
