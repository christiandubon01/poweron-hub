// @ts-nocheck
/**
 * Estimate Builder — Core functions for creating and calculating estimates.
 *
 * Functions:
 * - buildEstimateLineItems: Looks up SKUs in price book, applies waste factors
 * - calculateEstimateTotals: Sums subtotal, tax, total, margin %
 * - findSimilarEstimates: Queries estimates table for similar past bids
 * - generateEstimateNumber: Returns EST-YYYY-NNNNN format
 */

import { supabase } from '@/lib/supabase'
import type { Tables } from '@/lib/supabase'

// ── Types ───────────────────────────────────────────────────────────────────

export interface EstimateLineItem {
  id?: string
  sku: string
  description: string
  qty: number
  unit: string
  unit_price: number
  total: number
  is_custom: boolean
  reviewed: boolean
  cost_price?: number
}

export interface EstimateTotals {
  lineItems: EstimateLineItem[]
  subtotal: number
  tax: number
  total: number
  costPrice: number
  marginPct: number
}

export interface ParsedLineItem {
  sku?: string
  description: string
  qty: number
  unit: string
  unit_price?: number
  cost_price?: number
}

// ── Line Item Builder ────────────────────────────────────────────────────────

/**
 * Build estimate line items by looking up SKUs in price_book_items.
 * Applies waste factors based on item type.
 * Returns array of line items ready for total calculation.
 */
export async function buildEstimateLineItems(
  parsedItems: ParsedLineItem[],
  orgId: string,
  wasteFactorOverride?: number
): Promise<EstimateLineItem[]> {
  const lineItems: EstimateLineItem[] = []

  for (const item of parsedItems) {
    // Lookup in price book if SKU provided
    let unitPrice = item.unit_price ?? 0
    let costPrice = item.cost_price ?? 0
    let isCustom = false

    if (item.sku) {
      try {
        const { data: priceBookItem } = await supabase
          .from('price_book_items' as never)
          .select('name, unit_cost, unit, supplier, category_name')
          .eq('org_id', orgId)
          .ilike('name', `%${item.sku}%`)
          .maybeSingle()

        if (priceBookItem) {
          unitPrice = (priceBookItem as any).unit_cost ?? item.unit_price ?? 0
          costPrice = unitPrice * 0.75 // Assume 25% margin on material cost
        } else {
          isCustom = true
          unitPrice = item.unit_price ?? 0
        }
      } catch (err) {
        console.warn('[VAULT] Price book lookup failed:', err)
        isCustom = true
      }
    } else {
      isCustom = !item.unit_price
    }

    // Calculate waste factor
    const wasteFactor = wasteFactorOverride ?? getWasteFactor(item.description, item.unit)
    const qtyWithWaste = item.qty * (1 + wasteFactor)

    const lineItem: EstimateLineItem = {
      sku: item.sku || `CUSTOM-${Date.now()}`,
      description: item.description,
      qty: qtyWithWaste,
      unit: item.unit,
      unit_price: unitPrice,
      total: qtyWithWaste * unitPrice,
      is_custom: isCustom,
      reviewed: !isCustom,
      cost_price: costPrice,
    }

    lineItems.push(lineItem)
  }

  return lineItems
}

// ── Waste Factor Helper ──────────────────────────────────────────────────────

/**
 * Return waste factor (0.0-0.15) based on item type and unit.
 * Electrical work categories:
 * - Wire/cable: 8-12%
 * - Boxes/conduit: 10-15%
 * - Switches/outlets: 3-5%
 * - Panels/breakers: 2-3%
 */
function getWasteFactor(description: string, unit: string): number {
  const desc = description.toLowerCase()

  // Wire/cable: 10%
  if (desc.includes('wire') || desc.includes('cable') || desc.includes('romex')) {
    return 0.10
  }

  // Conduit/boxes: 12%
  if (desc.includes('conduit') || desc.includes('box') || desc.includes('pvc')) {
    return 0.12
  }

  // Switches/outlets: 4%
  if (desc.includes('switch') || desc.includes('outlet') || desc.includes('receptacle')) {
    return 0.04
  }

  // Panels/breakers: 2%
  if (desc.includes('panel') || desc.includes('breaker') || desc.includes('disconnect')) {
    return 0.02
  }

  // Labor: 0% waste
  if (unit === 'hr' || desc.includes('labor') || desc.includes('hour')) {
    return 0
  }

  // Default: 10%
  return 0.10
}

// ── Totals Calculator ────────────────────────────────────────────────────────

/**
 * Calculate estimate totals: subtotal, tax (8.25% on materials only), total, cost, margin %.
 */
export function calculateEstimateTotals(lineItems: EstimateLineItem[]): EstimateTotals {
  // Sum subtotal (materials only, exclude labor marked as 'hr')
  let subtotal = 0
  let costPrice = 0

  for (const item of lineItems) {
    subtotal += item.total
    costPrice += (item.cost_price ?? 0) * item.qty
  }

  // Tax: 8.25% on materials only (assume labor items have unit='hr')
  const materialSubtotal = lineItems
    .filter(item => item.unit !== 'hr')
    .reduce((sum, item) => sum + item.total, 0)
  const tax = materialSubtotal * 0.0825

  // Total
  const total = subtotal + tax

  // Margin %: (total - costPrice) / total * 100
  const marginPct = costPrice > 0 ? ((total - costPrice) / total) * 100 : 0

  return {
    lineItems,
    subtotal: Math.round(subtotal * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    total: Math.round(total * 100) / 100,
    costPrice: Math.round(costPrice * 100) / 100,
    marginPct: Math.round(marginPct * 10) / 10,
  }
}

// ── Similar Estimates Search ─────────────────────────────────────────────────

export interface SimilarEstimate {
  id: string
  estimate_number: string
  client_id?: string
  project_id?: string
  total: number
  margin_pct: number
  status: string
  valid_until?: string
  notes?: string
}

/**
 * Find similar estimates by searching description field.
 * Returns the most recent similar estimates.
 */
export async function findSimilarEstimates(
  description: string,
  orgId: string,
  limit: number = 5
): Promise<SimilarEstimate[]> {
  try {
    // Simple keyword search on notes field
    // In production, this would use full-text search or embeddings
    const keywords = description.toLowerCase().split(' ').filter(w => w.length > 3)

    let query = supabase
      .from('estimates')
      .select('id, estimate_number, client_id, project_id, total, margin_pct, status, valid_until, notes')
      .eq('org_id', orgId)
      .in('status', ['sent', 'accepted', 'rejected'])

    // Filter by keyword match (simplified)
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit * 2) // Fetch extra to filter manually

    if (error) {
      console.warn('[VAULT] Similar estimates search failed:', error.message)
      return []
    }

    // Manual filtering by keyword match
    const scored = (data ?? [])
      .map((est: any) => ({
        ...est,
        score: keywords.filter(kw => (est.notes ?? '').toLowerCase().includes(kw)).length,
      }))
      .filter(est => est.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return scored.map(({ score, ...est }: any) => est)
  } catch (err) {
    console.warn('[VAULT] Similar estimates lookup error:', err)
    return []
  }
}

// ── Estimate Number Generator ───────────────────────────────────────────────

/**
 * Generate estimate number in format EST-YYYY-NNNNN.
 * Example: EST-2026-00001
 */
export function generateEstimateNumber(): string {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 100000)
  const padded = String(random).padStart(5, '0')
  return `EST-${year}-${padded}`
}

// ── Margin Analysis ─────────────────────────────────────────────────────────

export interface MarginAnalysis {
  estimatedMarginPct: number
  actualCostPrice: number
  actualTotal: number
  actualMarginPct: number
  variance: number // Percentage points (actual - estimated)
  status: 'favorable' | 'acceptable' | 'overrun'
  insights: string[]
}

/**
 * Analyze estimate margin against actual project costs.
 * Compares estimated margin vs actual from project_cost_summary.
 */
export async function analyzeEstimateMargin(
  estimateId: string,
  orgId: string
): Promise<MarginAnalysis | null> {
  try {
    // Get the estimate
    const { data: estimate, error: estErr } = await supabase
      .from('estimates')
      .select('*')
      .eq('id', estimateId)
      .eq('org_id', orgId)
      .single()

    if (estErr || !estimate) {
      console.warn('[VAULT] Estimate not found:', estimateId)
      return null
    }

    // Get project cost summary if linked
    if (!estimate.project_id) {
      return {
        estimatedMarginPct: estimate.margin_pct ?? 0,
        actualCostPrice: 0,
        actualTotal: 0,
        actualMarginPct: 0,
        variance: 0,
        status: 'acceptable',
        insights: ['No project linked — margin analysis unavailable'],
      }
    }

    const { data: costSummary, error: costErr } = await supabase
      .from('project_cost_summary' as never)
      .select('*')
      .eq('project_id', estimate.project_id)
      .single()

    if (costErr || !costSummary) {
      return null
    }

    const cs = costSummary as any
    const estimatedMargin = estimate.margin_pct ?? 0
    const actualMargin = cs.actual_margin_pct ?? 0
    const variance = actualMargin - estimatedMargin

    const status =
      variance > 5 ? 'favorable' : variance < -10 ? 'overrun' : 'acceptable'

    const insights: string[] = []
    if (variance > 5) {
      insights.push(`Favorable variance: ${variance.toFixed(1)}% better than estimate`)
    }
    if (variance < -10) {
      insights.push(`Margin overrun: ${Math.abs(variance).toFixed(1)}% worse than estimate`)
    }

    return {
      estimatedMarginPct: estimatedMargin,
      actualCostPrice: cs.actual_cost ?? 0,
      actualTotal: cs.actual_revenue ?? 0,
      actualMarginPct: actualMargin,
      variance,
      status,
      insights,
    }
  } catch (err) {
    console.warn('[VAULT] Margin analysis error:', err)
    return null
  }
}
