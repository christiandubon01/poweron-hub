import { supabase } from '@/lib/supabase'

// Types
export type LeadStatus = 'new' | 'contacted' | 'estimate_scheduled' | 'estimate_delivered' | 'negotiating' | 'won' | 'lost'

export interface Lead {
  id: string
  org_id: string
  lead_source: string
  source_detail?: string
  name: string
  phone?: string
  email?: string
  gc_contact_id?: string
  client_id?: string
  project_type?: string
  estimated_value?: number
  status: LeadStatus
  assigned_to?: string
  contacted_at?: string
  estimate_scheduled_at?: string
  estimate_delivery_date?: string
  closed_at?: string
  lost_reason?: string
  close_notes?: string
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
}

// Valid status transitions
const VALID_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ['contacted', 'lost'],
  contacted: ['estimate_scheduled', 'lost'],
  estimate_scheduled: ['estimate_delivered', 'lost'],
  estimate_delivered: ['negotiating', 'won', 'lost'],
  negotiating: ['won', 'lost'],
  won: [],
  lost: ['new'], // re-engagement
}

export async function createLead(orgId: string, lead: Partial<Lead>): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads' as never)
    .insert({
      org_id: orgId,
      name: lead.name,
      lead_source: lead.lead_source || 'direct',
      source_detail: lead.source_detail || null,
      phone: lead.phone || null,
      email: lead.email || null,
      gc_contact_id: lead.gc_contact_id || null,
      client_id: lead.client_id || null,
      project_type: lead.project_type || null,
      estimated_value: lead.estimated_value || null,
      status: 'new',
      assigned_to: lead.assigned_to || null,
      metadata: lead.metadata || {},
    } as never)
    .select()
    .single()

  if (error) throw error
  return data as unknown as Lead
}

export async function updateLeadStatus(
  leadId: string,
  newStatus: LeadStatus,
  details?: { lost_reason?: string; close_notes?: string }
): Promise<Lead> {
  // Get current lead
  const { data: current, error: fetchError } = await supabase
    .from('leads' as never)
    .select('*')
    .eq('id', leadId)
    .single()

  if (fetchError) throw fetchError
  const currentLead = current as unknown as Lead

  // Validate transition
  const validNext = VALID_TRANSITIONS[currentLead.status]
  if (!validNext.includes(newStatus)) {
    throw new Error(`Invalid status transition: ${currentLead.status} → ${newStatus}`)
  }

  // Build update payload
  const updates: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  }

  if (newStatus === 'contacted') updates.contacted_at = new Date().toISOString()
  if (newStatus === 'estimate_scheduled') updates.estimate_scheduled_at = new Date().toISOString()
  if (newStatus === 'won' || newStatus === 'lost') updates.closed_at = new Date().toISOString()
  if (newStatus === 'lost' && details?.lost_reason) updates.lost_reason = details.lost_reason
  if (details?.close_notes) updates.close_notes = details.close_notes

  const { data, error } = await supabase
    .from('leads' as never)
    .update(updates as never)
    .eq('id', leadId)
    .select()
    .single()

  if (error) throw error
  return data as unknown as Lead
}

export async function getLeads(orgId: string, filters?: { status?: LeadStatus; source?: string }): Promise<Lead[]> {
  let query = supabase
    .from('leads' as never)
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.source) query = query.eq('lead_source', filters.source)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as Lead[]
}

export async function getLeadPipelineSummary(orgId: string): Promise<Record<LeadStatus, { count: number; total_value: number }>> {
  const { data, error } = await supabase
    .from('leads' as never)
    .select('status, estimated_value')
    .eq('org_id', orgId)

  if (error) throw error

  const summary: Record<string, { count: number; total_value: number }> = {
    new: { count: 0, total_value: 0 },
    contacted: { count: 0, total_value: 0 },
    estimate_scheduled: { count: 0, total_value: 0 },
    estimate_delivered: { count: 0, total_value: 0 },
    negotiating: { count: 0, total_value: 0 },
    won: { count: 0, total_value: 0 },
    lost: { count: 0, total_value: 0 },
  }

  const leads = (data ?? []) as unknown as Array<{ status: string; estimated_value: number | null }>
  leads.forEach(l => {
    if (summary[l.status]) {
      summary[l.status].count += 1
      summary[l.status].total_value += l.estimated_value ?? 0
    }
  })

  return summary as Record<LeadStatus, { count: number; total_value: number }>
}
