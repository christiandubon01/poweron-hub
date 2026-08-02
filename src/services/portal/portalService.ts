/**
 * portalService.ts
 * Handles portal_requests CRUD and conversion to hunter_leads.
 *
 * convertToLead():
 *   1. Builds hunter_leads insert payload from portal_request fields
 *   2. Inserts into hunter_leads (source='customer_portal', score=82)
 *   3. Geocodes address via geocode-single Edge Function → updates lat/lng
 *   4. Updates portal_request: status → 'reviewed', hunter_lead_id → new id
 */

import { supabase } from '@/lib/supabase'
import { geocodeAddressViaEdge, triggerGeocodingBackfill } from '@/services/geocoding/GeocodingClient'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PortalRequest {
  id: string
  organization_id: string
  created_at: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  request_type: string
  service_category: string | null
  description: string | null
  preferred_date: string | null
  preferred_time: string | null
  status: string
  hunter_lead_id: string | null
  source: string
  notes: string | null
  completed_at?: string | null
  review_requested_at?: string | null
  review_request_sent_to?: string | null
  review_request_status?: string | null
  review_request_error?: string | null
  review_request_last_attempt_at?: string | null
}

export type PortalTimelineEventType =
  | 'request_received'
  | 'accepted'
  | 'scheduling'
  | 'confirmed'
  | 'on_my_way'
  | 'arrived'
  | 'work_started'
  | 'work_completed'

export interface PortalTimelineEvent {
  id: string
  portal_request_id: string
  event_type: PortalTimelineEventType | string
  title: string
  description: string | null
  event_time: string
  triggered_by: string | null
}

export interface PortalTrackerState {
  request: PortalRequest
  timeline: PortalTimelineEvent[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getCurrentTenantId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await (supabase as any)
    .from('user_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()
  if (error || !data) return null
  return data.tenant_id
}

async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

async function getCurrentOrganizationId(): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc('user_org_id')
  if (error || typeof data !== 'string' || !data) return null
  return data
}

// ── Value range by service category ──────────────────────────────────────────

const VALUE_RANGE_MAP: Record<string, { min: number; max: number }> = {
  residential:   { min: 2000,  max: 8000  },
  commercial:    { min: 8000,  max: 40000 },
  solar:         { min: 10000, max: 22000 },
  maintenance:   { min: 250,   max: 1000  },
  panel_upgrade: { min: 3500,  max: 8000  },
  ev_charger:    { min: 500,  max: 1500  },
  other:         { min: 1500,  max: 6000  },
}

const PORTAL_TIMELINE_META: Record<PortalTimelineEventType, { title: string; description: string }> = {
  request_received: {
    title: 'Request Received',
    description: 'We got your request and are reviewing it.',
  },
  accepted: {
    title: 'Request Accepted',
    description: 'Your request has been accepted. We\'ll reach out with scheduling options soon.',
  },
  scheduling: {
    title: 'Scheduling in Progress',
    description: 'We\'re coordinating your appointment time and will confirm shortly.',
  },
  confirmed: {
    title: 'Appointment Confirmed',
    description: 'Your appointment has been scheduled. We will be there as planned.',
  },
  on_my_way: {
    title: 'On My Way',
    description: 'Your technician is heading to your location.',
  },
  arrived: {
    title: 'Arrived',
    description: 'Your technician has arrived.',
  },
  work_started: {
    title: 'Work Started',
    description: 'Work is in progress.',
  },
  work_completed: {
    title: 'Work Completed',
    description: 'All done. Thank you for choosing Power On Solutions.',
  },
}

export const PORTAL_LIFECYCLE_EVENT_TYPES: PortalTimelineEventType[] = [
  'on_my_way',
  'arrived',
  'work_started',
  'work_completed',
]

export function getPortalTimelineMeta(eventType: PortalTimelineEventType) {
  return PORTAL_TIMELINE_META[eventType]
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Fetch all portal_requests with status='new' (unreviewed submissions).
 * Owner-only — called from within the authenticated Hub.
 */
export async function fetchNewPortalRequests(): Promise<PortalRequest[]> {
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return []

  const { data, error } = await (supabase as any)
    .from('portal_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('status', 'new')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[portalService] fetchNewPortalRequests:', error)
    return []
  }
  return (data ?? []) as PortalRequest[]
}

export async function fetchPortalTrackerStateForLead(hunterLeadId: string): Promise<PortalTrackerState | null> {
  if (!hunterLeadId) return null
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return null

  const { data: request, error } = await (supabase as any)
    .from('portal_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('hunter_lead_id', hunterLeadId)
    .maybeSingle()

  if (error || !request?.id) {
    if (error) console.error('[portalService] fetchPortalTrackerStateForLead:', error)
    return null
  }

  const { data: timeline, error: timelineError } = await (supabase as any)
    .from('job_timeline')
    .select('*')
    .eq('portal_request_id', request.id)
    .order('event_time', { ascending: true })

  if (timelineError) {
    console.error('[portalService] fetchPortalTrackerStateForLead timeline:', timelineError)
  }

  return {
    request: request as PortalRequest,
    timeline: (timeline ?? []) as PortalTimelineEvent[],
  }
}

export async function writePortalTimelineEvent({
  portalRequestId,
  eventType,
  eventTime,
  triggeredBy = 'owner',
  description,
}: {
  portalRequestId: string
  eventType: PortalTimelineEventType
  eventTime?: string
  triggeredBy?: string
  description?: string
}): Promise<PortalTimelineEvent | null> {
  const meta = PORTAL_TIMELINE_META[eventType]
  if (!portalRequestId || !meta) return null
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return null

  const { data: authorizedRequest, error: authorizationError } = await (supabase as any)
    .from('portal_requests')
    .select('id')
    .eq('id', portalRequestId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (authorizationError || !authorizedRequest?.id) return null

  const now = eventTime || new Date().toISOString()
  const payload = {
    portal_request_id: portalRequestId,
    event_type: eventType,
    title: meta.title,
    description: description ?? meta.description,
    event_time: now,
    triggered_by: triggeredBy,
  }

  // Upsert on (portal_request_id, event_type) — requires the unique constraint
  // added in migration 080. Atomic: no race window between SELECT and INSERT.
  const { data, error } = await (supabase as any)
    .from('job_timeline')
    .upsert(payload, { onConflict: 'portal_request_id,event_type' })
    .select('*')
    .single()

  if (error) {
    console.error('[portalService] writePortalTimelineEvent upsert failed:', error)
    return null
  }

  return data as PortalTimelineEvent
}

export async function writePortalLifecycleEvent(
  portalRequestId: string,
  eventType: PortalTimelineEventType
): Promise<PortalTrackerState | null> {
  if (!PORTAL_LIFECYCLE_EVENT_TYPES.includes(eventType)) return null
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return null

  const event = await writePortalTimelineEvent({ portalRequestId, eventType })
  if (!event) return null

  if (eventType === 'work_completed') {
    const now = event.event_time || new Date().toISOString()
    const { error } = await (supabase as any)
      .from('portal_requests')
      .update({
        status: 'closed',
        completed_at: now,
      })
      .eq('id', portalRequestId)
      .eq('organization_id', organizationId)

    if (error) {
      console.error('[portalService] work_completed portal_request update failed:', error)
      return null
    }
  }

  const { data: request, error: requestError } = await (supabase as any)
    .from('portal_requests')
    .select('*')
    .eq('id', portalRequestId)
    .eq('organization_id', organizationId)
    .single()

  const { data: timeline, error: timelineError } = await (supabase as any)
    .from('job_timeline')
    .select('*')
    .eq('portal_request_id', portalRequestId)
    .order('event_time', { ascending: true })

  if (requestError || !request) {
    console.error('[portalService] writePortalLifecycleEvent reload request failed:', requestError)
    return null
  }
  if (timelineError) {
    console.error('[portalService] writePortalLifecycleEvent reload timeline failed:', timelineError)
  }

  return {
    request: request as PortalRequest,
    timeline: (timeline ?? []) as PortalTimelineEvent[],
  }
}

export async function sendPortalReviewRequest({
  portalRequestId,
  email,
  force = false,
}: {
  portalRequestId: string
  email?: string
  force?: boolean
}): Promise<{ success: boolean; error?: string; messageId?: string; sentTo?: string; alreadySent?: boolean; request?: PortalRequest }> {
  try {
    const res = await fetch('/.netlify/functions/send-review-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portal_request_id: portalRequestId,
        email,
        force,
      }),
    })

    const body = await res.json().catch(() => ({}))
    if (!res.ok || body?.success === false) {
      return {
        success: false,
        error: body?.error || `Review request failed (${res.status})`,
        alreadySent: !!body?.alreadySent,
        request: body?.request,
      }
    }

    return {
      success: true,
      messageId: body?.messageId,
      sentTo: body?.sentTo,
      alreadySent: !!body?.alreadySent,
      request: body?.request,
    }
  } catch (err: any) {
    console.error('[portalService] sendPortalReviewRequest failed:', err)
    return { success: false, error: err?.message || 'Review request failed' }
  }
}

/**
 * Convert a portal_request to a hunter_lead.
 * Returns the new hunter lead id, or null on failure.
 */
export async function convertToLead(request: PortalRequest): Promise<string | null> {
  const [tenantId, userId, organizationId] = await Promise.all([
    getCurrentTenantId(),
    getCurrentUserId(),
    getCurrentOrganizationId(),
  ])

  if (!tenantId || !userId || !organizationId) {
    console.error('[portalService] convertToLead: unauthorized organization or missing identity')
    return null
  }

  // Never trust the request object supplied by the component as authorization
  // or canonical Portal data. Re-read the exact request through organization-
  // bound RLS and an explicit organization predicate before conversion.
  const { data: canonicalRequest, error: canonicalRequestError } = await (supabase as any)
    .from('portal_requests')
    .select('*')
    .eq('id', request.id)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (canonicalRequestError || !canonicalRequest?.id) {
    console.error('[portalService] convertToLead: request unavailable for organization')
    return null
  }
  request = canonicalRequest as PortalRequest

  // Map service_category → lead_type
  const leadTypeMap: Record<string, string> = {
    residential:   'residential',
    commercial:    'commercial',
    solar:         'solar',
    maintenance:   'maintenance',
    panel_upgrade: 'panel_upgrade',
    ev_charger:    'ev_charger',
    other:         'electrical',
  }
  const leadType = leadTypeMap[request.service_category ?? ''] ?? 'electrical'

  // Build description
  const descParts: string[] = []
  if (request.description) descParts.push(request.description)
  if (request.preferred_date) descParts.push(`Preferred date: ${request.preferred_date}`)
  if (request.preferred_time) descParts.push(`Preferred time: ${request.preferred_time}`)
  if (request.notes) descParts.push(request.notes)

  // Value range for cost analysis
  const valueRange = VALUE_RANGE_MAP[request.service_category ?? ''] ?? { min: 1500, max: 6000 }

  const insertPayload = {
    tenant_id:        tenantId,
    user_id:          userId,
    lead_type:        leadType,
    source:           'customer_portal',
    source_tag:       'customer_portal',
    status:           'new',
    score:            82,   // inbound hot lead — customer actively reached out
    score_tier:       'strong',
    contact_name:     request.name,
    phone:            request.phone ?? null,
    email:            request.email ?? null,
    address:          request.address ?? null,
    city:             request.city ?? null,
    description:      descParts.join('\n') || null,
    notes:            `Portal submission — ${request.request_type} request`,
    estimated_value:  Math.round((valueRange.min + valueRange.max) / 2),
    estimated_margin: 35,
    // Geocoding fields — populated below after insert
    geocoding_status: 'pending',
    latitude:         null,
    longitude:        null,
    distance_from_base_miles: null,
  }

  const { data: leadData, error: leadError } = await (supabase as any)
    .from('hunter_leads')
    .insert(insertPayload)
    .select('id')
    .single()

  if (leadError || !leadData) {
    console.error('[portalService] convertToLead insert failed:', leadError)
    return null
  }

  const newLeadId = leadData.id as string

  // ── Geocode address (best-effort, non-blocking on failure) ────────────────
  const addressStr = [request.address, request.city, 'CA']
    .filter(Boolean)
    .join(', ')

  if (addressStr.trim().length > 3) {
    geocodeAddressViaEdge(addressStr)
      .then(async (geo) => {
        if (!geo) {
          await (supabase as any)
            .from('hunter_leads')
            .update({ geocoding_status: 'failed' })
            .eq('id', newLeadId)
          return
        }
        // Calculate distance from home base
        let distanceFromBaseMiles: number | null = null
        try {
          const { data: setting } = await (supabase as any)
            .from('tenant_settings')
            .select('setting_value')
            .eq('tenant_id', tenantId)
            .eq('setting_key', 'home_base_address')
            .maybeSingle()
          if (setting?.setting_value?.lat && setting?.setting_value?.lng) {
            const R = 3958.8
            const dLat = (geo.lat - setting.setting_value.lat) * Math.PI / 180
            const dLng = (geo.lng - setting.setting_value.lng) * Math.PI / 180
            const lat1r = setting.setting_value.lat * Math.PI / 180
            const lat2r = geo.lat * Math.PI / 180
            const a = Math.sin(dLat/2)**2 + Math.cos(lat1r)*Math.cos(lat2r)*Math.sin(dLng/2)**2
            distanceFromBaseMiles = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 10) / 10
          }
        } catch (e) {
          console.warn('[portalService] distance calc failed (non-fatal):', e)
        }
        await (supabase as any)
          .from('hunter_leads')
          .update({
            latitude:                 geo.lat,
            longitude:                geo.lng,
            geocoding_status:         'success',
            geocoded_at:              new Date().toISOString(),
            distance_from_base_miles: distanceFromBaseMiles,
          })
          .eq('id', newLeadId)
        // Trigger backfill to calculate distance_from_base_miles
        triggerGeocodingBackfill(tenantId).catch((err) => {
          console.error('[portalService] backfill failed (non-fatal):', err)
        })
        // Re-fetch hunter store so map pin appears immediately after geocoding
        try {
          const { useHunterStore } = await import('@/store/hunterStore')
          useHunterStore.getState().fetchLeads()
        } catch (err) {
          console.error('[portalService] hunter store re-fetch failed (non-fatal):', err)
        }
      })
      .catch((err) => {
        console.error('[portalService] geocoding failed (non-fatal):', err)
      })
  }

  // ── Update portal_request ─────────────────────────────────────────────────
  const { error: updateError } = await (supabase as any)
    .from('portal_requests')
    .update({
      status:         'accepted',
      hunter_lead_id: newLeadId,
    })
    .eq('id', request.id)
    .eq('organization_id', organizationId)

  if (updateError) {
    console.error('[portalService] update portal_request failed:', updateError)
  }

  // ── Insert "Accepted" + "Scheduling" job_timeline milestones ─────────────
  try {
    await writePortalTimelineEvent({
      portalRequestId: request.id,
      eventType: 'accepted',
      eventTime: new Date().toISOString(),
    })
    await writePortalTimelineEvent({
      portalRequestId: request.id,
      eventType: 'scheduling',
      eventTime: new Date(Date.now() + 1000).toISOString(),
    })
  } catch (err: any) {
    console.error('[portalService] job_timeline accepted+scheduling write failed (non-fatal):', err)
  }

  return newLeadId
}

/**
 * Dismiss a portal_request without converting (mark as 'closed').
 */
export async function dismissPortalRequest(requestId: string): Promise<void> {
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return

  const { error } = await (supabase as any)
    .from('portal_requests')
    .update({ status: 'dismissed' })
    .eq('id', requestId)
    .eq('organization_id', organizationId)

  // Write rejected disposition to linked hunter lead if exists
  if (!error) {
    try {
      const { data: portalReq } = await (supabase as any)
        .from('portal_requests')
        .select('hunter_lead_id')
        .eq('id', requestId)
        .eq('organization_id', organizationId)
        .maybeSingle()
      if (portalReq?.hunter_lead_id) {
        await (supabase as any).from('hunter_leads').update({
          disposition: 'rejected',
          disposition_detail: 'Portal request dismissed by owner',
          disposition_at: new Date().toISOString(),
        }).eq('id', portalReq.hunter_lead_id)
      }
    } catch (err) {
      console.error('[portalService] rejected disposition write failed (non-fatal):', err)
    }
  }

  if (error) {
    console.error('[portalService] dismissPortalRequest:', error)
  }
}
