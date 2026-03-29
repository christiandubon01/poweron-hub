import { supabase } from '@/lib/supabase'
import { publish } from '@/services/agentEventBus'

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

// ── Lead Scoring Pipeline ─────────────────────────────────────────────────

/**
 * Electrical job types that score higher (core competency).
 */
const ELECTRICAL_JOB_TYPES = new Set([
  'panel upgrade', 'panel', 'electrical', 'wiring', 'rewire',
  'ev charger', 'ev', 'lighting', 'outlet', 'circuit',
  'service upgrade', 'meter', 'generator', 'solar', 'battery',
  'commercial electrical', 'industrial', 'troubleshoot',
])

/**
 * High-value referral sources.
 */
const REFERRAL_SOURCE_SCORES: Record<string, number> = {
  gc_referral: 3,       // GC referral = highest
  contractor_referral: 2.5,
  past_client: 2,
  google: 1.5,
  yelp: 1.5,
  facebook: 1,
  direct: 1,
  website: 1,
  other: 0.5,
}

/**
 * Desert Hot Springs lat/lon for proximity scoring.
 */
const DHS_LAT = 33.9611
const DHS_LON = -116.5017

/**
 * Score a lead 1-10 based on multiple factors:
 * - Job type match (electrical = higher)
 * - Estimated value
 * - Referral source (GC referral = highest)
 * - Geographic proximity to Desert Hot Springs
 */
export function scoreLead(lead: {
  project_type?: string
  estimated_value?: number | null
  lead_source?: string
  address?: string
  city?: string
  metadata?: Record<string, unknown>
}): { score: number; factors: Record<string, number> } {
  const factors: Record<string, number> = {}

  // 1. Job type match (0-3 points)
  const jobType = (lead.project_type || '').toLowerCase()
  const isElectrical = ELECTRICAL_JOB_TYPES.has(jobType) ||
    Array.from(ELECTRICAL_JOB_TYPES).some(t => jobType.includes(t))
  factors.jobType = isElectrical ? 3 : 1
  if (!jobType) factors.jobType = 1.5 // Unknown

  // 2. Estimated value (0-2.5 points)
  const value = lead.estimated_value || 0
  if (value >= 50000) factors.value = 2.5
  else if (value >= 20000) factors.value = 2
  else if (value >= 5000) factors.value = 1.5
  else if (value >= 1000) factors.value = 1
  else factors.value = 0.5

  // 3. Referral source (0-3 points)
  const source = (lead.lead_source || 'other').toLowerCase().replace(/\s+/g, '_')
  factors.source = REFERRAL_SOURCE_SCORES[source] ?? 1

  // 4. Geographic proximity (0-1.5 points)
  const city = (lead.city || lead.address || '').toLowerCase()
  if (city.includes('desert hot springs') || city.includes('dhs')) {
    factors.proximity = 1.5
  } else if (city.includes('palm springs') || city.includes('cathedral city')) {
    factors.proximity = 1.2
  } else if (city.includes('palm desert') || city.includes('rancho mirage') || city.includes('thousand palms')) {
    factors.proximity = 1
  } else if (city.includes('indio') || city.includes('la quinta') || city.includes('coachella')) {
    factors.proximity = 0.8
  } else if (city) {
    factors.proximity = 0.5
  } else {
    factors.proximity = 0.75 // Unknown location
  }

  // Total: max theoretical = 3 + 2.5 + 3 + 1.5 = 10
  const rawScore = factors.jobType + factors.value + factors.source + factors.proximity
  const score = Math.min(10, Math.max(1, Math.round(rawScore)))

  return { score, factors }
}

/**
 * Score a lead from backup serviceLeads and publish LEAD_SCORED event.
 * - Score >= 7: NEXUS alerts immediately
 * - Score <= 3: NEXUS asks "Low priority lead — park or kill?"
 * - Score >= 5: Auto-create follow-up task in CHRONO
 */
export async function scoreAndProcessLead(
  orgId: string,
  lead: Partial<Lead> & { id?: string; city?: string; address?: string }
): Promise<{ score: number; factors: Record<string, number> }> {
  const result = scoreLead(lead)

  // Publish LEAD_SCORED event
  publish(
    'LEAD_SCORED' as any,
    'spark',
    {
      leadId: lead.id || 'unknown',
      leadName: lead.name || 'Unknown',
      score: result.score,
      factors: result.factors,
      estimatedValue: lead.estimated_value || 0,
      source: lead.lead_source || 'unknown',
    },
    `Lead "${lead.name}" scored ${result.score}/10 (source: ${lead.lead_source || 'unknown'})`
  )

  // High-value lead alert
  if (result.score >= 7) {
    publish(
      'HIGH_VALUE_LEAD' as any,
      'spark',
      {
        leadId: lead.id || 'unknown',
        leadName: lead.name || 'Unknown',
        score: result.score,
        estimatedValue: lead.estimated_value || 0,
        source: lead.lead_source || 'unknown',
      },
      `HIGH VALUE: "${lead.name}" scored ${result.score}/10 — $${lead.estimated_value || 0} (${lead.lead_source})`
    )
  }

  // Low-value lead flag
  if (result.score < 4) {
    publish(
      'LOW_VALUE_LEAD' as any,
      'spark',
      {
        leadId: lead.id || 'unknown',
        leadName: lead.name || 'Unknown',
        score: result.score,
      },
      `Low priority: "${lead.name}" scored ${result.score}/10 — consider parking`
    )
  }

  // Auto-create CHRONO follow-up for score >= 5
  if (result.score >= 5) {
    try {
      const { getBackupData, saveBackupData } = await import('@/services/backupDataService')
      const backup = getBackupData()
      if (backup) {
        const tasks = backup.taskSchedule || []
        tasks.push({
          id: `task_lead_${lead.id || Date.now()}`,
          title: `Follow up: ${lead.name} (Score: ${result.score}/10)`,
          description: `Lead scored ${result.score}/10. Source: ${lead.lead_source}. Value: $${lead.estimated_value || 0}. Auto-created by SPARK.`,
          dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 2 days from now
          status: 'pending',
          priority: result.score >= 7 ? 'high' : 'medium',
          assignedAgent: 'chrono',
          createdBy: 'spark',
          createdAt: new Date().toISOString(),
        })
        backup.taskSchedule = tasks
        saveBackupData(backup)
        console.log(`[SPARK] Auto-created CHRONO follow-up for "${lead.name}" (score: ${result.score})`)
      }
    } catch (err) {
      console.warn('[SPARK] Failed to create CHRONO follow-up:', err)
    }
  }

  return result
}

/**
 * Get lead source attribution — which channel produces the best leads.
 */
export async function getLeadSourceAttribution(orgId: string): Promise<Array<{
  source: string
  totalLeads: number
  wonLeads: number
  totalValue: number
  conversionRate: number
  avgValue: number
}>> {
  const { data, error } = await supabase
    .from('leads' as never)
    .select('lead_source, status, estimated_value')
    .eq('org_id', orgId)

  if (error) throw error
  const leads = (data ?? []) as unknown as Array<{
    lead_source: string
    status: string
    estimated_value: number | null
  }>

  const bySource: Record<string, { total: number; won: number; value: number }> = {}

  leads.forEach(l => {
    const src = l.lead_source || 'unknown'
    if (!bySource[src]) bySource[src] = { total: 0, won: 0, value: 0 }
    bySource[src].total += 1
    if (l.status === 'won') {
      bySource[src].won += 1
      bySource[src].value += l.estimated_value ?? 0
    }
  })

  return Object.entries(bySource)
    .map(([source, data]) => ({
      source,
      totalLeads: data.total,
      wonLeads: data.won,
      totalValue: data.value,
      conversionRate: data.total > 0 ? parseFloat(((data.won / data.total) * 100).toFixed(1)) : 0,
      avgValue: data.won > 0 ? Math.round(data.value / data.won) : 0,
    }))
    .sort((a, b) => b.conversionRate - a.conversionRate)
}
