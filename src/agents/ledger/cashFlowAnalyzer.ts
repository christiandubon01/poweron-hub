// @ts-nocheck
/**
 * Cash Flow Analyzer — AR and collection analysis.
 *
 * Provides:
 * - AR summary with aging buckets
 * - Payment history analysis
 * - Collection recommendations (using Claude)
 */

import { supabase } from '@/lib/supabase'
import { LEDGER_SYSTEM_PROMPT } from './systemPrompt'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ARBucket {
  name: 'current' | 'follow_up' | 'escalate' | 'collections'
  label: string
  daysFrom: number
  daysTo: number
  count: number
  total: number
}

export interface ARSummary {
  totalAR: number
  overdueAmount: number
  agingBuckets: ARBucket[]
  collectionRisk: 'low' | 'medium' | 'high'
  dsoEstimate: number // Days Sales Outstanding
  lastCalculatedAt: string
}

export interface PaymentRecord {
  id: string
  invoiceNumber: string
  clientName: string
  amount: number
  method: string
  reference?: string
  receivedAt: string
  recordedBy: string
}

export interface CollectionRecommendation {
  invoiceId: string
  invoiceNumber: string
  clientName: string
  amount: number
  daysOverdue: number
  bucket: 'follow-up' | 'escalate' | 'collections'
  suggestedAction: string
  priority: 'high' | 'medium' | 'low'
  communicationTemplate: string
  estimatedCollectionDate: string
}

// ── AR Summary ───────────────────────────────────────────────────────────────

/**
 * Get AR summary with aging buckets for an organization.
 * Buckets:
 * - Current: 0-30 days
 * - Follow-up: 30-60 days
 * - Escalate: 60-90 days
 * - Collections: 90+ days
 */
export async function getARSummary(orgId: string): Promise<ARSummary> {
  const now = new Date()

  // Get all non-paid invoices
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, status, balance_due, due_date, total, sent_at')
    .eq('org_id', orgId)
    .in('status', ['sent', 'viewed', 'partial', 'overdue', 'disputed'])

  if (error) {
    throw new Error(`AR query failed: ${error.message}`)
  }

  if (!invoices || invoices.length === 0) {
    return {
      totalAR: 0,
      overdueAmount: 0,
      agingBuckets: [
        { name: 'current', label: 'Current (0-30 days)', daysFrom: 0, daysTo: 30, count: 0, total: 0 },
        { name: 'follow_up', label: 'Follow-up (30-60 days)', daysFrom: 30, daysTo: 60, count: 0, total: 0 },
        { name: 'escalate', label: 'Escalate (60-90 days)', daysFrom: 60, daysTo: 90, count: 0, total: 0 },
        { name: 'collections', label: 'Collections (90+ days)', daysFrom: 90, daysTo: Infinity, count: 0, total: 0 },
      ],
      collectionRisk: 'low',
      dsoEstimate: 0,
      lastCalculatedAt: now.toISOString(),
    }
  }

  // Calculate aging
  const buckets: ARBucket[] = [
    { name: 'current', label: 'Current (0-30 days)', daysFrom: 0, daysTo: 30, count: 0, total: 0 },
    { name: 'follow_up', label: 'Follow-up (30-60 days)', daysFrom: 30, daysTo: 60, count: 0, total: 0 },
    { name: 'escalate', label: 'Escalate (60-90 days)', daysFrom: 60, daysTo: 90, count: 0, total: 0 },
    { name: 'collections', label: 'Collections (90+ days)', daysFrom: 90, daysTo: Infinity, count: 0, total: 0 },
  ]

  let totalAR = 0
  let overdueAmount = 0

  for (const inv of invoices) {
    const balanceDue = inv.balance_due ?? 0
    if (balanceDue <= 0) continue

    totalAR += balanceDue

    // Calculate days outstanding
    const referenceDate = inv.due_date ? new Date(inv.due_date) : (inv.sent_at ? new Date(inv.sent_at) : now)
    const daysOut = Math.floor((now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24))

    // Assign to bucket
    let assigned = false
    for (const bucket of buckets) {
      if (daysOut >= bucket.daysFrom && daysOut < bucket.daysTo) {
        bucket.count++
        bucket.total += balanceDue
        assigned = true
        break
      }
    }

    // Handle edge case where days >= 90
    if (!assigned && daysOut >= 90) {
      const collectionsBucket = buckets.find(b => b.name === 'collections')
      if (collectionsBucket) {
        collectionsBucket.count++
        collectionsBucket.total += balanceDue
      }
    }

    // Track overdue (assume 30 day terms if no due_date)
    const effectiveDueDate = inv.due_date ? new Date(inv.due_date) : new Date(referenceDate.getTime() + 30 * 24 * 60 * 60 * 1000)
    if (now > effectiveDueDate) {
      overdueAmount += balanceDue
    }
  }

  // Determine collection risk
  let collectionRisk: 'low' | 'medium' | 'high' = 'low'
  const escalateBucket = buckets.find(b => b.name === 'escalate')
  const collectionsBucket = buckets.find(b => b.name === 'collections')

  if ((collectionsBucket?.total ?? 0) > totalAR * 0.15) {
    collectionRisk = 'high'
  } else if ((escalateBucket?.total ?? 0) > totalAR * 0.20) {
    collectionRisk = 'medium'
  }

  // Estimate DSO (Days Sales Outstanding)
  // Simple calculation: average days outstanding across all AR invoices
  const dsoEstimate = totalAR > 0 ? invoices.reduce((sum, inv) => {
    if (!inv.balance_due || inv.balance_due <= 0) return sum
    const referenceDate = inv.due_date ? new Date(inv.due_date) : (inv.sent_at ? new Date(inv.sent_at) : now)
    const daysOut = Math.floor((now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24))
    return sum + daysOut
  }, 0) / invoices.filter(i => (i.balance_due ?? 0) > 0).length : 0

  return {
    totalAR,
    overdueAmount,
    agingBuckets: buckets,
    collectionRisk,
    dsoEstimate: Math.round(dsoEstimate),
    lastCalculatedAt: now.toISOString(),
  }
}

// ── Payment History ─────────────────────────────────────────────────────────

/**
 * Get payment history for the organization.
 * Returns recent payments with invoice references.
 */
export async function getPaymentHistory(orgId: string, days: number = 90): Promise<PaymentRecord[]> {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  // Get payments with invoice and client info
  const { data: payments, error } = await supabase
    .from('payments')
    .select(`
      id,
      amount,
      method,
      reference,
      received_at,
      recorded_by,
      invoices!payments_invoice_id_fkey (
        invoice_number,
        clients!invoices_client_id_fkey (
          name
        )
      )
    `)
    .eq('org_id', orgId)
    .gte('received_at', startDate)
    .order('received_at', { ascending: false })

  if (error) {
    throw new Error(`Payment history query failed: ${error.message}`)
  }

  if (!payments) {
    return []
  }

  // Transform to expected format (with null-safe handling)
  return payments.map(p => ({
    id: p.id,
    invoiceNumber: (p.invoices as any)?.invoice_number ?? 'Unknown',
    clientName: (p.invoices as any)?.clients?.name ?? 'Unknown',
    amount: p.amount,
    method: p.method,
    reference: p.reference ?? undefined,
    receivedAt: p.received_at,
    recordedBy: p.recorded_by,
  }))
}

// ── Collection Recommendations ──────────────────────────────────────────────

/**
 * Generate collection recommendations using Claude AI.
 * Analyzes overdue invoices and suggests specific actions per invoice.
 */
export async function getCollectionRecommendations(orgId: string): Promise<CollectionRecommendation[]> {
  // Get overdue invoices
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      balance_due,
      days_overdue,
      due_date,
      status,
      clients!invoices_client_id_fkey (
        id,
        name,
        company,
        email,
        phone
      )
    `)
    .eq('org_id', orgId)
    .in('status', ['overdue', 'disputed', 'partial'])
    .not('due_date', 'is', null)
    .order('days_overdue', { ascending: false })

  if (error) {
    throw new Error(`Overdue invoices query failed: ${error.message}`)
  }

  if (!invoices || invoices.length === 0) {
    return []
  }

  // Build Claude prompt with overdue data
  const overdueData = invoices
    .filter(inv => (inv.balance_due ?? 0) > 0)
    .map(inv => ({
      invoiceNumber: inv.invoice_number,
      clientName: (inv.clients as any)?.name ?? 'Unknown',
      clientEmail: (inv.clients as any)?.email,
      clientPhone: (inv.clients as any)?.phone,
      balanceDue: inv.balance_due,
      daysOverdue: inv.days_overdue,
      status: inv.status,
      dueDate: inv.due_date,
    }))

  const prompt = `You are analyzing overdue invoices for collection action. Based on this data, generate specific, actionable collection recommendations for each invoice.

${JSON.stringify(overdueData, null, 2)}

For each invoice, provide:
1. A specific suggested action (call, email, formal demand letter, escalation to collections, etc.)
2. A brief communication template (2-3 sentences)
3. An estimated collection date

Return a JSON array of objects with: invoiceNumber, clientName, daysOverdue, suggestedAction (string), priority (high/medium/low), communicationTemplate (string), estimatedCollectionDate (ISO date).

Guidelines:
- 30-60 days: Friendly reminder call/email
- 60-90 days: Formal demand letter
- 90+ days: Escalate to collections agency or legal

Be specific with amounts and dates. Focus on actions the business can take immediately.`

  try {
    const response = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: LEDGER_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`)
    }

    const data = await response.json()
    const content = (data.content?.[0]?.text ?? '') as string

    // Parse JSON response
    let parsed: any[]
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0])
      } else {
        return []
      }
    } catch (parseErr) {
      console.warn('[LEDGER] Failed to parse Claude response:', parseErr)
      return []
    }

    // Map parsed data to CollectionRecommendation format
    const recommendations: CollectionRecommendation[] = parsed.map((item: any) => {
      const invoice = invoices.find(inv => inv.invoice_number === item.invoiceNumber)
      return {
        invoiceId: invoice?.id ?? '',
        invoiceNumber: item.invoiceNumber,
        clientName: item.clientName,
        amount: item.balanceDue ?? (invoice?.balance_due ?? 0),
        daysOverdue: item.daysOverdue ?? (invoice?.days_overdue ?? 0),
        bucket:
          (item.daysOverdue ?? 0) < 60 ? 'follow-up' : (item.daysOverdue ?? 0) < 90 ? 'escalate' : 'collections',
        suggestedAction: item.suggestedAction,
        priority: item.priority ?? 'medium',
        communicationTemplate: item.communicationTemplate,
        estimatedCollectionDate: item.estimatedCollectionDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      }
    })

    return recommendations
  } catch (err) {
    console.error('[LEDGER] Collection recommendations failed:', err)
    return []
  }
}
