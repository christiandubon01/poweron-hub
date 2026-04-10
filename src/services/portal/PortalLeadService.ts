/**
 * PortalLeadService.ts
 * 
 * Service for managing portal leads — leads submitted via PowerOn Hub portal.
 * Provides CRUD operations, status updates, project conversion, and AI response generation.
 * 
 * Features:
 * - Fetch portal leads with RLS (owner only)
 * - Update lead status (New → Contacted → Quoted → Won/Lost)
 * - Convert lead to project in BLUEPRINT
 * - Generate professional response draft via Claude
 */

import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────

export type PortalLeadStatus = 'New' | 'Contacted' | 'Quoted' | 'Won' | 'Lost'

export interface PortalLead {
  id: string
  owner_id?: string
  name: string
  email?: string
  phone?: string
  service_type: string
  city: string
  address?: string
  urgency: 'Low' | 'Medium' | 'High' | 'Critical'
  description: string
  photos?: string[] // JSON array or comma-separated URLs
  date_submitted: string
  status: PortalLeadStatus
  estimated_value?: number
  service_scope?: string
  additional_notes?: string
  created_at?: string
  updated_at?: string
}

export interface ProjectCreationData {
  leadId: string
  name: string
  type: string
  contract?: number
  city: string
  address?: string
  description?: string
  serviceType: string
  urgency: string
}

export interface ResponseDraft {
  subject: string
  body: string
  leadId: string
}

// ── Fetch Portal Leads ────────────────────────────────────────────────────

/**
 * Fetch all portal leads for the logged-in owner.
 * Uses RLS to filter by owner_id.
 */
export async function fetchPortalLeads(): Promise<PortalLead[]> {
  try {
    const { data, error } = await (supabase as any)
      .from('portal_leads')
      .select('*')
      .order('date_submitted', { ascending: false })

    if (error) {
      console.warn('[PortalLeadService] fetch error:', error.message)
      return []
    }

    return (data ?? []) as PortalLead[]
  } catch (err) {
    console.warn('[PortalLeadService] fetch failed:', err)
    return []
  }
}

/**
 * Fetch a single portal lead by ID.
 */
export async function fetchPortalLeadById(leadId: string): Promise<PortalLead | null> {
  try {
    const { data, error } = await (supabase as any)
      .from('portal_leads')
      .select('*')
      .eq('id', leadId)
      .single()

    if (error) {
      console.warn('[PortalLeadService] fetch by ID error:', error.message)
      return null
    }

    return (data ?? null) as PortalLead | null
  } catch (err) {
    console.warn('[PortalLeadService] fetch by ID failed:', err)
    return null
  }
}

// ── Update Lead Status ────────────────────────────────────────────────────

/**
 * Update the status of a portal lead.
 * Status flow: New → Contacted → Quoted → Won/Lost
 */
export async function updateLeadStatus(
  leadId: string,
  status: PortalLeadStatus
): Promise<PortalLead | null> {
  try {
    const { data, error } = await (supabase as any)
      .from('portal_leads')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leadId)
      .select()
      .single()

    if (error) {
      console.warn('[PortalLeadService] update status error:', error.message)
      return null
    }

    return (data ?? null) as PortalLead | null
  } catch (err) {
    console.warn('[PortalLeadService] update status failed:', err)
    return null
  }
}

// ── Convert to Project ────────────────────────────────────────────────────

/**
 * Convert a portal lead to a project in BLUEPRINT.
 * Creates a project entry with pre-filled data from the lead.
 */
export async function convertToProject(leadData: ProjectCreationData): Promise<string | null> {
  try {
    // Prepare project data with lead information pre-filled
    const projectPayload = {
      name: leadData.name,
      type: leadData.type,
      contract: leadData.contract ?? 0,
      city: leadData.city,
      address: leadData.address ?? '',
      status: 'coming', // New projects start as 'coming'
      description: leadData.description ?? '',
      service_type: leadData.serviceType,
      urgency: leadData.urgency,
      source: 'portal_lead',
      source_lead_id: leadData.leadId,
      created_from_portal: true,
      created_at: new Date().toISOString(),
    }

    // Insert into projects table
    const { data, error } = await (supabase as any)
      .from('projects')
      .insert(projectPayload)
      .select()
      .single()

    if (error) {
      console.warn('[PortalLeadService] convert to project error:', error.message)
      return null
    }

    // Optionally: update the lead status to 'Quoted' when converted
    if (data?.id) {
      await updateLeadStatus(leadData.leadId, 'Quoted')
      return data.id as string
    }

    return null
  } catch (err) {
    console.warn('[PortalLeadService] convert to project failed:', err)
    return null
  }
}

// ── Generate Response Draft ───────────────────────────────────────────────

/**
 * Generate a professional response email draft using Claude API.
 * Sends the lead details to Claude and returns a suggested response.
 */
export async function generateResponseDraft(lead: PortalLead): Promise<ResponseDraft | null> {
  try {
    // Build context for Claude
    const urgencyLabel = {
      Low: 'low priority',
      Medium: 'moderate priority',
      High: 'high priority',
      Critical: 'urgent/critical',
    }[lead.urgency] || 'not specified'

    const prompt = `
You are a professional electrical contractor responding to a service inquiry.
Generate a professional, friendly email response to the following lead inquiry:

Lead Name: ${lead.name}
Service Type: ${lead.service_type}
Location: ${lead.city}${lead.address ? `, ${lead.address}` : ''}
Urgency: ${urgencyLabel}
Description: ${lead.description}
${lead.additional_notes ? `Additional Notes: ${lead.additional_notes}` : ''}

Generate a professional response that:
1. Thanks them for reaching out
2. Acknowledges their specific service request
3. Provides next steps (e.g., scheduling a consultation, sending an estimate)
4. Includes a call to action with contact information
5. Maintains a professional but friendly tone

Format the response as JSON with 'subject' and 'body' fields only.
Example: {"subject": "...", "body": "..."}
    `.trim()

    // Call Claude API via the proxy
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        maxTokens: 500,
      }),
    })

    if (!response.ok) {
      console.warn('[PortalLeadService] Claude API error:', response.status)
      return null
    }

    const responseData = await response.json()
    
    // Parse the Claude response
    if (responseData.text) {
      try {
        const parsed = JSON.parse(responseData.text)
        return {
          subject: parsed.subject || 'Re: Service Inquiry',
          body: parsed.body || '',
          leadId: lead.id,
        }
      } catch (parseErr) {
        console.warn('[PortalLeadService] Failed to parse Claude response as JSON:', parseErr)
        // Return a basic response if parsing fails
        return {
          subject: 'Re: Service Inquiry',
          body: responseData.text || 'Thank you for reaching out. We will get back to you shortly.',
          leadId: lead.id,
        }
      }
    }

    return null
  } catch (err) {
    console.warn('[PortalLeadService] generate response draft failed:', err)
    return null
  }
}

// ── Helper: Update lead with additional data ──────────────────────────────

/**
 * Update a lead's additional notes or other fields.
 */
export async function updateLeadDetails(
  leadId: string,
  updates: Partial<PortalLead>
): Promise<PortalLead | null> {
  try {
    const { data, error } = await (supabase as any)
      .from('portal_leads')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leadId)
      .select()
      .single()

    if (error) {
      console.warn('[PortalLeadService] update details error:', error.message)
      return null
    }

    return (data ?? null) as PortalLead | null
  } catch (err) {
    console.warn('[PortalLeadService] update details failed:', err)
    return null
  }
}
