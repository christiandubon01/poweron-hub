import { supabase } from '@/lib/supabase'

export interface PlannerOwnerDetails {
  request_id: string
  schema_version: 1
  snapshot: Record<string, unknown>
  customer_note: string | null
  preferred_contact: 'phone' | 'text' | 'email' | null
  consent_granted: true
  consent_version: 'panel_planner_contact_v1'
  consent_recorded_at: string
  photos: Array<Record<string, unknown>>
  created_at: string
}

/** Safe RPC projection: server verifies JWT, active organization and owner/admin role. */
export async function getPlannerOwnerDetails(requestId: string): Promise<PlannerOwnerDetails | null> {
  const { data, error } = await (supabase as any).rpc('get_panel_planner_owner_details', {
    p_request_id: requestId,
  })
  if (error) throw new Error('Planner details unavailable')
  return data as PlannerOwnerDetails | null
}
