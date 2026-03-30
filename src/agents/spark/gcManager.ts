import { supabase } from '@/lib/supabase'

export interface GCContact {
  id: string
  org_id: string
  name: string
  company?: string
  phone?: string
  email?: string
  fit_score: number
  activity_score: number
  historical_win_rate: number
  relationship_health: 'green' | 'yellow' | 'red'
  total_projects: number
  total_revenue: number
  last_contact_at?: string
  created_at: string
  updated_at: string
}

export interface GCActivity {
  id: string
  org_id: string
  gc_contact_id: string
  activity_type: 'call' | 'email' | 'in_person' | 'proposal_sent' | 'follow_up' | 'project_closed'
  activity_date: string
  description?: string
  logged_by?: string
  lead_id?: string
  created_at: string
}

export async function getGCContacts(orgId: string, filters?: { health?: string }): Promise<GCContact[]> {
  let query = supabase
    .from('gc_contacts' as never)
    .select('*')
    .eq('org_id', orgId)
    .order('fit_score', { ascending: false })

  if (filters?.health) query = query.eq('relationship_health', filters.health)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as GCContact[]
}

export async function updateGCScores(gcContactId: string, orgId: string): Promise<GCContact> {
  // Fetch activity logs for this GC in last 90 days
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data: activities, error: actError } = await supabase
    .from('gc_activity_log' as never)
    .select('*')
    .eq('gc_contact_id', gcContactId)
    .gte('activity_date', ninetyDaysAgo)

  if (actError) throw actError
  const acts = (activities ?? []) as unknown as GCActivity[]

  // Calculate activity score (0-100) based on recency and frequency
  const activityCount = acts.length
  let activity_score = Math.min(100, activityCount * 15) // 15 pts per activity, capped at 100

  // Fetch leads associated with this GC
  const { data: leads, error: leadError } = await supabase
    .from('leads' as never)
    .select('status, estimated_value')
    .eq('gc_contact_id', gcContactId)

  if (leadError) throw leadError
  const gcLeads = (leads ?? []) as unknown as Array<{ status: string; estimated_value: number | null }>

  // Calculate win rate
  const totalLeads = gcLeads.length
  const wonLeads = gcLeads.filter(l => l.status === 'won').length
  const historical_win_rate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0

  // Calculate total revenue from won leads
  const total_revenue = gcLeads
    .filter(l => l.status === 'won')
    .reduce((sum, l) => sum + (l.estimated_value ?? 0), 0)

  // Determine relationship health
  const daysSinceLastActivity = acts.length > 0
    ? (Date.now() - new Date(acts[0].activity_date).getTime()) / (1000 * 60 * 60 * 24)
    : 999

  let relationship_health: 'green' | 'yellow' | 'red' = 'green'
  if (daysSinceLastActivity > 60) relationship_health = 'red'
  else if (daysSinceLastActivity > 30) relationship_health = 'yellow'

  const { data, error } = await supabase
    .from('gc_contacts' as never)
    .update({
      activity_score,
      historical_win_rate,
      total_revenue,
      total_projects: wonLeads,
      relationship_health,
      last_contact_at: acts.length > 0 ? acts[0].activity_date : undefined,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', gcContactId)
    .select()
    .single()

  if (error) throw error
  return data as unknown as GCContact
}

export async function logGCActivity(
  orgId: string,
  gcContactId: string,
  activity: {
    activity_type: GCActivity['activity_type']
    description?: string
    logged_by?: string
    lead_id?: string
  }
): Promise<GCActivity> {
  const { data, error } = await supabase
    .from('gc_activity_log' as never)
    .insert({
      org_id: orgId,
      gc_contact_id: gcContactId,
      activity_type: activity.activity_type,
      description: activity.description || null,
      logged_by: activity.logged_by || null,
      lead_id: activity.lead_id || null,
      activity_date: new Date().toISOString(),
    } as never)
    .select()
    .single()

  if (error) throw error
  return data as unknown as GCActivity
}
