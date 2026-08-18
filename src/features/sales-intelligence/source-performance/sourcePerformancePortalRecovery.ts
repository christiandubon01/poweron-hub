/**
 * LEAD-SRC-6C/6E — Exact portal lineage recovery for legacy Hunter leads.
 *
 * Only portal_requests.hunter_lead_id → source_category.
 * No name / email / phone / date matching.
 * Org scoping relies on existing portal_requests RLS (authenticated owner/admin).
 */

import { supabase } from '@/lib/supabase'
import { normalizePortalAcquisitionCategory } from '@/features/sales-intelligence/conversion-receipts/conversionReceiptSource'

/**
 * Load source_category for leads that were converted from portal_requests.
 * Keys are hunter_lead_id strings; values are normalized acquisition tokens.
 */
export async function fetchPortalCategoryByLeadId(): Promise<{
  map: Map<string, string>
  error: string | null
}> {
  const { data, error } = await (supabase as any)
    .from('portal_requests')
    .select('hunter_lead_id, source_category')
    .not('hunter_lead_id', 'is', null)

  if (error) {
    return { map: new Map(), error: error.message ?? 'Could not load portal attribution.' }
  }

  const map = new Map<string, string>()
  for (const row of data ?? []) {
    const leadId = row?.hunter_lead_id != null ? String(row.hunter_lead_id).trim() : ''
    const category = normalizePortalAcquisitionCategory(row?.source_category)
    if (!leadId || !category) continue
    // First exact link wins; do not overwrite with later ambiguous rows.
    if (!map.has(leadId)) map.set(leadId, category)
  }
  return { map, error: null }
}
