/**
 * LEAD-SRC-6 / 6E — Pure source-performance rollups.
 *
 * Lead source: deriveConversionSource(lead) after exact portal recovery when needed.
 * Conversion / value: same display bucket as the lead when legacy portal recovery
 * applies; otherwise receipt.sourceFamily / sourceDetail (durable snapshot).
 * Converted Value amounts: sum of non-null receipt.convertedValue only.
 * Receipt DB rows are never mutated.
 */

import type { ConversionReceipt } from '@/features/sales-intelligence/conversion-receipts/conversionReceiptTypes'
import {
  deriveConversionSource,
  formatSourceLabel,
  normalizePortalAcquisitionCategory,
  PORTAL_CHANNEL_TAG,
  sourceSummaryKey,
} from '@/features/sales-intelligence/conversion-receipts/conversionReceiptSource'
import type {
  SourcePerformanceReport,
  SourcePerformanceRow,
  SourcePerformanceTotals,
} from './sourcePerformanceTypes'

function emptyRow(family: string, detail: string | null): SourcePerformanceRow {
  return {
    key: sourceSummaryKey(family, detail),
    family,
    detail,
    label: formatSourceLabel(family, detail),
    leads: 0,
    converted: 0,
    conversionRate: 0,
    convertedValue: 0,
    receiptsWithValue: 0,
    receiptCount: 0,
  }
}

function conversionRate(converted: number, leads: number): number {
  if (!leads || leads <= 0) return 0
  return converted / leads
}

function ensureRow(
  map: Map<string, SourcePerformanceRow>,
  family: string,
  detail: string | null
): SourcePerformanceRow {
  const key = sourceSummaryKey(family, detail)
  let row = map.get(key)
  if (!row) {
    row = emptyRow(family, detail)
    map.set(key, row)
  }
  return row
}

/** Legacy Hunter shape that collapsed acquisition into the portal channel. */
export function isLegacyCollapsedPortalLead(lead: Record<string, any> | null | undefined): boolean {
  if (!lead) return false
  const source = String(lead?.source ?? lead?.leadSource ?? '').trim().toLowerCase()
  const sourceTag = String(lead?.source_tag ?? lead?.sourceTag ?? '').trim().toLowerCase()
  return (
    source === PORTAL_CHANNEL_TAG &&
    (sourceTag === PORTAL_CHANNEL_TAG || sourceTag === '')
  )
}

/**
 * Legacy portal leads hard-coded source=customer_portal. When an exact
 * portal_requests.hunter_lead_id link supplies a valid source_category, rebuild
 * the LEAD-SRC-6C shape for display aggregation only.
 */
export function applyExactPortalCategoryRecovery(
  lead: Record<string, any>,
  portalCategory: string | null | undefined
): Record<string, any> {
  const category = normalizePortalAcquisitionCategory(portalCategory)
  if (!category) return lead
  if (!isLegacyCollapsedPortalLead(lead)) return lead

  return {
    ...lead,
    source: category,
    source_tag: PORTAL_CHANNEL_TAG,
  }
}

/**
 * LEAD-SRC-6E — Single Source Performance display-bucket authority.
 *
 * Lead loop: omit receiptSnapshot → always derive from (possibly recovered) lead.
 * Receipt loop: pass receiptSnapshot → recover only for legacy-collapsed portal
 * leads with a valid exact portal_requests.source_category; otherwise keep the
 * durable receipt snapshot. Never mutates receipt or lead rows.
 */
export function resolveSourcePerformanceBucket(params: {
  lead?: Record<string, any> | null
  portalCategory?: string | null
  receiptSnapshot?: { family: string; detail: string | null } | null
}): { family: string; detail: string | null } {
  const { lead, portalCategory, receiptSnapshot } = params

  if (lead) {
    if (receiptSnapshot != null) {
      const category = normalizePortalAcquisitionCategory(portalCategory)
      if (category && isLegacyCollapsedPortalLead(lead)) {
        return deriveConversionSource(applyExactPortalCategoryRecovery(lead, category))
      }
      return {
        family: receiptSnapshot.family || 'Other',
        detail: receiptSnapshot.detail ?? null,
      }
    }
    return deriveConversionSource(applyExactPortalCategoryRecovery(lead, portalCategory))
  }

  return {
    family: receiptSnapshot?.family || 'Other',
    detail: receiptSnapshot?.detail ?? null,
  }
}

/**
 * Build the owner-facing Source Performance report.
 *
 * Dedup rules:
 *   - Leads / Converted use distinct lead IDs
 *   - Receipts are processed once by receipt.id
 *   - One lead with multiple distinct destination receipts still counts as one
 *     converted lead; Converted Value sums each receipt's non-null snapshot
 */
export function computeSourcePerformance(params: {
  leads: Array<Record<string, any>>
  receipts: ConversionReceipt[]
  /**
   * LEAD-SRC-6C/6E — exact portal_requests.hunter_lead_id → source_category map.
   * Used only to recover acquisition for legacy leads that still store
   * source=customer_portal. Never used for fuzzy matching. Receipt DB snapshots
   * are not rewritten; display aggregation may re-key via resolveSourcePerformanceBucket.
   */
  portalCategoryByLeadId?: Map<string, string> | Record<string, string>
}): SourcePerformanceReport {
  const rows = new Map<string, SourcePerformanceRow>()
  const leadIdsBySource = new Map<string, Set<string>>()
  const convertedIdsBySource = new Map<string, Set<string>>()
  const allLeadIds = new Set<string>()
  const allConvertedIds = new Set<string>()
  const seenReceiptIds = new Set<string>()
  const leadById = new Map<string, Record<string, any>>()

  let totalConvertedValue = 0
  let totalReceiptsWithValue = 0
  let totalReceiptCount = 0

  const portalCategoryByLeadId =
    params.portalCategoryByLeadId instanceof Map
      ? params.portalCategoryByLeadId
      : new Map(Object.entries(params.portalCategoryByLeadId ?? {}))

  for (const lead of params.leads ?? []) {
    const leadId = lead?.id != null ? String(lead.id).trim() : ''
    if (!leadId) continue
    allLeadIds.add(leadId)
    leadById.set(leadId, lead)
    const source = resolveSourcePerformanceBucket({
      lead,
      portalCategory: portalCategoryByLeadId.get(leadId),
    })
    const row = ensureRow(rows, source.family, source.detail)
    let set = leadIdsBySource.get(row.key)
    if (!set) {
      set = new Set()
      leadIdsBySource.set(row.key, set)
    }
    set.add(leadId)
  }

  for (const receipt of params.receipts ?? []) {
    const receiptId = receipt?.id != null ? String(receipt.id) : ''
    if (receiptId) {
      if (seenReceiptIds.has(receiptId)) continue
      seenReceiptIds.add(receiptId)
    }

    const leadId = receipt.leadId != null ? String(receipt.leadId).trim() : ''
    const lead = leadId ? leadById.get(leadId) : undefined
    const source = resolveSourcePerformanceBucket({
      lead: lead ?? null,
      portalCategory: leadId ? portalCategoryByLeadId.get(leadId) : undefined,
      receiptSnapshot: {
        family: receipt.sourceFamily || 'Other',
        detail: receipt.sourceDetail ?? null,
      },
    })
    const row = ensureRow(rows, source.family, source.detail)
    row.receiptCount += 1
    totalReceiptCount += 1

    if (leadId) {
      allConvertedIds.add(leadId)
      let set = convertedIdsBySource.get(row.key)
      if (!set) {
        set = new Set()
        convertedIdsBySource.set(row.key, set)
      }
      set.add(leadId)
    }

    const value = receipt.convertedValue
    if (typeof value === 'number' && Number.isFinite(value)) {
      row.convertedValue += value
      row.receiptsWithValue += 1
      totalConvertedValue += value
      totalReceiptsWithValue += 1
    }
  }

  for (const [key, set] of leadIdsBySource) {
    const row = rows.get(key)
    if (row) row.leads = set.size
  }
  for (const [key, set] of convertedIdsBySource) {
    const row = rows.get(key)
    if (row) row.converted = set.size
  }

  const sorted = [...rows.values()]
    .map((row) => ({
      ...row,
      conversionRate: conversionRate(row.converted, row.leads),
    }))
    .sort(
      (a, b) =>
        b.convertedValue - a.convertedValue ||
        b.leads - a.leads ||
        a.label.localeCompare(b.label)
    )

  const totals: SourcePerformanceTotals = {
    leads: allLeadIds.size,
    converted: allConvertedIds.size,
    conversionRate: conversionRate(allConvertedIds.size, allLeadIds.size),
    convertedValue: totalConvertedValue,
    receiptsWithValue: totalReceiptsWithValue,
    receiptCount: totalReceiptCount,
  }

  return {
    timeHorizon: 'all_time',
    rows: sorted,
    totals,
  }
}

/** Percent display helper — always finite. */
export function formatConversionRate(rate: number): string {
  const safe = Number.isFinite(rate) ? Math.max(0, rate) : 0
  return `${(safe * 100).toFixed(1)}%`
}

export function formatConvertedValue(value: number): string {
  const safe = Number.isFinite(value) ? value : 0
  return `$${Math.round(safe).toLocaleString('en-US')}`
}
