// @ts-nocheck
/**
 * receiptParser.ts — Parses material receipts from various sources
 *
 * Supported sources:
 *   - Home Depot order links (via detail_link in field_logs)
 *   - Manual entry (user types in items)
 *   - Future: OCR from receipt photos
 *
 * Used by: VAULT Material Variance Tracker, auto-triggered on field_log save
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ParsedLineItem {
  name: string
  qty: number
  unit_cost: number
  total: number
  sku?: string
  category?: string
}

export interface ParsedReceipt {
  source: 'home_depot' | 'lowes' | 'crawford' | 'platt' | 'manual' | 'other'
  receipt_url?: string
  receipt_date: string
  line_items: ParsedLineItem[]
  subtotal: number
  tax: number
  total: number
  store_name?: string
  store_location?: string
}

// ── Receipt Source Detection ─────────────────────────────────────────────────

export function detectSource(url: string): ParsedReceipt['source'] {
  if (!url) return 'manual'
  if (url.includes('homedepot.com')) return 'home_depot'
  if (url.includes('lowes.com')) return 'lowes'
  if (url.includes('crawford')) return 'crawford'
  if (url.includes('platt.com')) return 'platt'
  return 'other'
}

// ── Parse from Field Log ─────────────────────────────────────────────────────

/**
 * Creates a receipt record from a field_log entry.
 * When a field log has material_cost > 0, this extracts what we know
 * and creates a material_receipts row for VAULT variance tracking.
 */
export function parseFromFieldLog(log: {
  id: string
  material_cost: number
  material_store?: string
  detail_link?: string
  log_date: string
  phase?: string
  notes?: string
}): ParsedReceipt {
  const source = detectSource(log.detail_link || '')

  // We know the total but not individual line items from a field log.
  // Create a single aggregate line item.
  const lineItems: ParsedLineItem[] = [{
    name: `Materials — ${log.phase || 'General'}`,
    qty: 1,
    unit_cost: Number(log.material_cost) || 0,
    total: Number(log.material_cost) || 0,
    category: log.phase || 'General',
  }]

  return {
    source,
    receipt_url: log.detail_link || undefined,
    receipt_date: log.log_date,
    line_items: lineItems,
    subtotal: Number(log.material_cost) || 0,
    tax: 0,
    total: Number(log.material_cost) || 0,
    store_name: log.material_store || undefined,
  }
}

// ── Save Receipt to Supabase ─────────────────────────────────────────────────

export async function saveReceipt(params: {
  orgId: string
  projectId?: string
  fieldLogId?: string
  uploadedBy: string
  receipt: ParsedReceipt
  phase?: string
  mtoEstimated?: number
}): Promise<{ id: string } | null> {
  const { orgId, projectId, fieldLogId, uploadedBy, receipt, phase, mtoEstimated } = params

  const varianceAmount = mtoEstimated != null
    ? receipt.total - mtoEstimated
    : null

  const variancePct = mtoEstimated && mtoEstimated > 0
    ? Math.round(((receipt.total - mtoEstimated) / mtoEstimated) * 100 * 100) / 100
    : null

  const { data, error } = await supabase
    .from('material_receipts' as never)
    .insert({
      org_id: orgId,
      project_id: projectId || null,
      field_log_id: fieldLogId || null,
      uploaded_by: uploadedBy,
      source: receipt.source,
      receipt_url: receipt.receipt_url || null,
      receipt_date: receipt.receipt_date,
      line_items: receipt.line_items,
      subtotal: receipt.subtotal,
      tax: receipt.tax,
      total: receipt.total,
      phase: phase || null,
      mto_estimated: mtoEstimated || null,
      variance_amount: varianceAmount,
      variance_pct: variancePct,
      store_name: receipt.store_name || null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[receiptParser] Save failed:', error.message)
    return null
  }

  return data as { id: string }
}

// ── Auto-trigger on Field Log Save ───────────────────────────────────────────

/**
 * Called after a field_log is saved. If the log has material_cost > 0,
 * automatically creates a material_receipt record for variance tracking.
 */
export async function onFieldLogSave(params: {
  orgId: string
  profileId: string
  fieldLog: {
    id: string
    project_id?: string
    material_cost: number
    material_store?: string
    detail_link?: string
    log_date: string
    phase?: string
    notes?: string
  }
}): Promise<void> {
  const { orgId, profileId, fieldLog } = params

  // Skip if no material cost
  if (!fieldLog.material_cost || fieldLog.material_cost <= 0) return

  // Parse receipt from field log data
  const receipt = parseFromFieldLog(fieldLog)

  // Look up MTO estimate for this phase
  let mtoEstimated: number | undefined
  if (fieldLog.project_id && fieldLog.phase) {
    const { data: mtoLines } = await supabase
      .from('material_takeoff_lines' as never)
      .select('line_total')
      .eq('project_id', fieldLog.project_id)
      .eq('phase', fieldLog.phase)

    if (mtoLines && mtoLines.length > 0) {
      mtoEstimated = (mtoLines as any[]).reduce(
        (sum, line) => sum + (Number(line.line_total) || 0), 0
      )
    }
  }

  // Save the receipt
  await saveReceipt({
    orgId,
    projectId: fieldLog.project_id,
    fieldLogId: fieldLog.id,
    uploadedBy: profileId,
    receipt,
    phase: fieldLog.phase,
    mtoEstimated,
  })

  console.log(`[receiptParser] Auto-created receipt for field_log ${fieldLog.id} ($${fieldLog.material_cost})`)
}
