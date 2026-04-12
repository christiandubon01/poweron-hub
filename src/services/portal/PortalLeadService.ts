// @ts-nocheck
/**
 * PortalLeadService — Data layer for portal lead inbox
 *
 * Wraps Supabase queries for:
 *  - portal_leads table (owner-only RLS)
 *  - Lead status transitions
 *  - Project creation from lead data
 *  - AI-generated response drafts via Claude
 *
 * Events are published to agentEventBus after writes.
 */

import { supabase } from '@/lib/supabase'
import { publish } from '@/services/agentEventBus'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PortalLeadStatus = 'new' | 'contacted' | 'quoted' | 'won' | 'lost'

export interface PortalLead {
  id: string
  user_id: string
  name: string
  email: string
  phone?: string
  service_type: string
  city: string
  address?: string
  description: string
  photos?: string[]
  urgency: 'low' | 'medium' | 'high'
  status: PortalLeadStatus
  date_submitted: string
  last_contacted?: string
  quoted_at?: string
  project_id?: string
  notes?: string
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ConvertToProjectInput {
  leadId: string
  projectName?: string
  projectType?: string
  estimatedValue?: number
}

export interface DraftResponseInput {
  leadId: string
  leadData: PortalLead
}

// ── Helper functions ──────────────────────────────────────────────────────────

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id ?? null
}

// ── fetchPortalLeads ──────────────────────────────────────────────────────────

/**
 * Fetches all portal leads for the authenticated user (owner).
 * RLS policy ensures user_id matches authenticated user.
 *
 * @returns Array of portal leads, filtered by user_id via RLS
 */
export async function fetchPortalLeads(): Promise<PortalLead[]> {
  const userId = await getCurrentUserId()
  if (!userId) {
    console.error('[PortalLeadService] fetchPortalLeads: No authenticated user')
    return []
  }

  const { data, error } = await supabase
    .from('portal_leads')
    .select('*')
    .eq('user_id', userId)
    .order('date_submitted', { ascending: false })

  if (error) {
    console.error('[PortalLeadService] fetchPortalLeads error:', error)
    return []
  }

  return (data as PortalLead[]) ?? []
}

// ── updateLeadStatus ──────────────────────────────────────────────────────────

/**
 * Updates a portal lead's status with RLS enforcement.
 * Valid transitions: new → contacted/quoted/lost
 *                    contacted → quoted/won/lost
 *                    quoted → won/lost
 *                    won/lost → (terminal)
 *
 * @param leadId - Portal lead ID
 * @param newStatus - New status value
 * @returns Updated lead record or null if error
 */
export async function updateLeadStatus(
  leadId: string,
  newStatus: PortalLeadStatus
): Promise<PortalLead | null> {
  const userId = await getCurrentUserId()
  if (!userId) {
    console.error('[PortalLeadService] updateLeadStatus: No authenticated user')
    return null
  }

  const updateData: Record<string, any> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  }

  // Set timestamps based on status transition
  if (newStatus === 'contacted') {
    updateData.last_contacted = new Date().toISOString()
  } else if (newStatus === 'quoted') {
    updateData.quoted_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('portal_leads')
    .update(updateData)
    .eq('id', leadId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) {
    console.error('[PortalLeadService] updateLeadStatus error:', error)
    return null
  }

  // Publish event to SPARK pipeline
  publish({
    type: 'portal_lead_updated',
    payload: {
      leadId,
      status: newStatus,
      timestamp: new Date().toISOString(),
    },
  })

  return (data as PortalLead) ?? null
}

// ── convertToProject ──────────────────────────────────────────────────────────

/**
 * Creates a new project in BLUEPRINT from portal lead data.
 * Sets project_id on the lead and updates status to 'quoted'.
 *
 * @param input - ConvertToProjectInput with leadId and optional project details
 * @returns Project ID if created, null on error
 */
export async function convertToProject(input: ConvertToProjectInput): Promise<string | null> {
  const userId = await getCurrentUserId()
  if (!userId) {
    console.error('[PortalLeadService] convertToProject: No authenticated user')
    return null
  }

  // Fetch the lead to get its data
  const { data: leadData, error: fetchError } = await supabase
    .from('portal_leads')
    .select('*')
    .eq('id', input.leadId)
    .eq('user_id', userId)
    .single()

  if (fetchError || !leadData) {
    console.error('[PortalLeadService] convertToProject: Could not fetch lead', fetchError)
    return null
  }

  const lead = leadData as PortalLead

  // Create project entry in BLUEPRINT pipeline
  // Note: This integrates with the projects table through the BLUEPRINT agent
  const projectPayload = {
    user_id: userId,
    name: input.projectName || `${lead.name} - ${lead.service_type}`,
    type: input.projectType || lead.service_type,
    city: lead.city,
    address: lead.address || '',
    description: lead.description,
    estimated_value: input.estimatedValue || 0,
    portal_lead_id: input.leadId,
    status: 'coming', // Projects start in 'coming' status
    created_at: new Date().toISOString(),
  }

  const { data: projectData, error: projectError } = await supabase
    .from('projects')
    .insert([projectPayload] as never)
    .select()
    .single()

  if (projectError || !projectData) {
    console.error('[PortalLeadService] convertToProject: Project creation error', projectError)
    return null
  }

  const projectId = (projectData as any).id

  // Update the lead to link it to the new project
  await supabase
    .from('portal_leads')
    .update({
      project_id: projectId,
      status: 'quoted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.leadId)
    .eq('user_id', userId)

  // Publish event to SPARK/BLUEPRINT pipeline
  publish({
    type: 'project_created_from_lead',
    payload: {
      leadId: input.leadId,
      projectId,
      leadName: lead.name,
      serviceType: lead.service_type,
      timestamp: new Date().toISOString(),
    },
  })

  console.log('[PortalLeadService] convertToProject: Created project', projectId)
  return projectId
}

// ── generateResponseDraft ─────────────────────────────────────────────────────

/**
 * Generates a professional email response draft using Claude.
 * Integrates with SPARK/NEXUS pipeline for AI-powered customer communication.
 *
 * @param input - DraftResponseInput with leadId and lead data
 * @returns Draft response text or null if error
 */
export async function generateResponseDraft(input: DraftResponseInput): Promise<string | null> {
  const userId = await getCurrentUserId()
  if (!userId) {
    console.error('[PortalLeadService] generateResponseDraft: No authenticated user')
    return null
  }

  const { leadData } = input

  // Build context for Claude
  const prompt = `
You are a professional electrical contractor responding to a lead inquiry.

Lead Details:
- Name: ${leadData.name}
- Service Type: ${leadData.service_type}
- City: ${leadData.city}
- Urgency: ${leadData.urgency}
- Description: ${leadData.description}

Write a professional, warm email response that:
1. Thanks them for contacting us
2. Acknowledges their specific service request
3. Offers next steps (site visit, estimate timeline)
4. Includes a call to action
5. Keeps tone professional but approachable

Keep the response to 3-4 paragraphs. Start directly with the greeting, no preamble.
`

  try {
    // Call Claude API through proxy
    const response = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        maxTokens: 300,
        temperature: 0.7,
      }),
    })

    if (!response.ok) {
      console.error('[PortalLeadService] generateResponseDraft: API error', response.status)
      return null
    }

    const result = await response.json()
    const draftText = result.content || result.text || ''

    // Publish event to track draft generation
    publish({
      type: 'lead_response_draft_generated',
      payload: {
        leadId: input.leadId,
        draftLength: draftText.length,
        timestamp: new Date().toISOString(),
      },
    })

    return draftText
  } catch (error) {
    console.error('[PortalLeadService] generateResponseDraft: Exception', error)
    return null
  }
}

// ── getLeadById ───────────────────────────────────────────────────────────────

/**
 * Fetches a single portal lead by ID with RLS enforcement.
 *
 * @param leadId - Portal lead ID
 * @returns Portal lead or null if not found
 */
export async function getLeadById(leadId: string): Promise<PortalLead | null> {
  const userId = await getCurrentUserId()
  if (!userId) {
    console.error('[PortalLeadService] getLeadById: No authenticated user')
    return null
  }

  const { data, error } = await supabase
    .from('portal_leads')
    .select('*')
    .eq('id', leadId)
    .eq('user_id', userId)
    .single()

  if (error) {
    console.error('[PortalLeadService] getLeadById error:', error)
    return null
  }

  return (data as PortalLead) ?? null
}

// ── updateLeadNotes ───────────────────────────────────────────────────────────

/**
 * Updates notes on a portal lead.
 *
 * @param leadId - Portal lead ID
 * @param notes - Notes text
 * @returns Updated lead or null
 */
export async function updateLeadNotes(leadId: string, notes: string): Promise<PortalLead | null> {
  const userId = await getCurrentUserId()
  if (!userId) {
    console.error('[PortalLeadService] updateLeadNotes: No authenticated user')
    return null
  }

  const { data, error } = await supabase
    .from('portal_leads')
    .update({
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) {
    console.error('[PortalLeadService] updateLeadNotes error:', error)
    return null
  }

  return (data as PortalLead) ?? null
}

// Export all as named exports
export default {
  fetchPortalLeads,
  updateLeadStatus,
  convertToProject,
  generateResponseDraft,
  getLeadById,
  updateLeadNotes,
}
