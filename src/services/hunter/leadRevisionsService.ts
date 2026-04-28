import { supabase } from '@/lib/supabase';

export type ChangeAccent = 'status' | 'sqft' | 'notable' | 'minor';

export interface LeadRevision {
  id: string;
  tenant_id: string;
  lead_id: string;
  detected_at: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
}

/**
 * Fetch all revisions for a single lead, newest first.
 * Returns empty array on error or no revisions.
 */
export async function fetchLeadRevisions(leadId: string): Promise<LeadRevision[]> {
  if (!leadId) return [];
  const { data, error } = await (supabase as any)
    .from('hunter_lead_revisions')
    .select('*')
    .eq('lead_id', leadId)
    .order('detected_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('[leadRevisionsService] fetchLeadRevisions:', error);
    return [];
  }
  return (data ?? []) as LeadRevision[];
}

/**
 * Count revisions per lead — useful for the indicator badge.
 * Returns a Map<lead_id, count>.
 */
export async function fetchRevisionCounts(leadIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (leadIds.length === 0) return map;
  const { data, error } = await (supabase as any)
    .from('hunter_lead_revisions')
    .select('lead_id')
    .in('lead_id', leadIds);
  if (error || !data) {
    console.error('[leadRevisionsService] fetchRevisionCounts:', error);
    return map;
  }
  for (const row of data as Array<{ lead_id: string }>) {
    map.set(row.lead_id, (map.get(row.lead_id) ?? 0) + 1);
  }
  return map;
}

/**
 * Format a stored value for display. Old/new values are stored as text.
 */
export function formatRevisionValue(v: string | null): string {
  if (v == null || v === '') return '—';
  return v;
}

/**
 * Classify a field change into a visual accent. Storage layer doesn't
 * carry change_type, so the UI computes it here from field_name.
 * TODO (future): make this configurable via tenant_settings.
 */
export function classifyFieldChange(fieldName: string): ChangeAccent {
  switch (fieldName) {
    case 'permit_status':
      return 'status';
    case 'total_sqft':
    case 'sqft_breakdown':
      return 'sqft';
    case 'issued_date':
    case 'finalized_date':
    case 'expired_date':
    case 'work_class_code':
    case 'contact_name':
    case 'contact_company':
    case 'estimated_value':
      return 'notable';
    default:
      return 'minor';
  }
}

/**
 * Human-readable label for a tracked field name.
 */
export const FIELD_LABELS: Record<string, string> = {
  permit_status: 'Permit Status',
  total_sqft: 'Total Sqft',
  sqft_breakdown: 'Sqft Breakdown',
  issued_date: 'Issued Date',
  finalized_date: 'Finalized Date',
  expired_date: 'Expired Date',
  description: 'Description',
  contact_name: 'Contact Name',
  contact_company: 'Contact Company',
  contact_phone: 'Contact Phone',
  contact_email: 'Contact Email',
  work_class_code: 'Work Class',
  estimated_value: 'Estimated Value',
};