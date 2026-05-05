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

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Fetch all portal_requests with status='new' (unreviewed submissions).
 * Owner-only — called from within the authenticated Hub.
 */
export async function fetchNewPortalRequests(): Promise<PortalRequest[]> {
  const { data, error } = await (supabase as any)
    .from('portal_requests')
    .select('*')
    .eq('status', 'new')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[portalService] fetchNewPortalRequests:', error)
    return []
  }
  return (data ?? []) as PortalRequest[]
}

/**
 * Convert a portal_request to a hunter_lead.
 * Returns the new hunter lead id, or null on failure.
 */
export async function convertToLead(request: PortalRequest): Promise<string | null> {
  const [tenantId, userId] = await Promise.all([
    getCurrentTenantId(),
    getCurrentUserId(),
  ])

  if (!tenantId || !userId) {
    console.error('[portalService] convertToLead: not authenticated or no tenant')
    return null
  }

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

  if (updateError) {
    console.error('[portalService] update portal_request failed:', updateError)
  }

  // ── Insert "Accepted" + "Scheduling" job_timeline milestones ─────────────
  try {
    await (supabase as any)
      .from('job_timeline')
      .insert([
        {
          portal_request_id: request.id,
          event_type:        'accepted',
          title:             'Request Accepted',
          description:       'Your request has been accepted. We\'ll reach out with scheduling options soon.',
          event_time:        new Date().toISOString(),
          triggered_by:      'owner',
        },
        {
          portal_request_id: request.id,
          event_type:        'scheduling',
          title:             'Scheduling in Progress',
          description:       'We\'re coordinating your appointment time and will confirm shortly.',
          event_time:        new Date(Date.now() + 1000).toISOString(),
          triggered_by:      'owner',
        },
      ])
  } catch (err: any) {
    console.error('[portalService] job_timeline accepted+scheduling insert failed (non-fatal):', err)
  }

  return newLeadId
}

/**
 * Dismiss a portal_request without converting (mark as 'closed').
 */
export async function dismissPortalRequest(requestId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('portal_requests')
    .update({ status: 'dismissed' })
    .eq('id', requestId)

  // Write rejected disposition to linked hunter lead if exists
  if (!error) {
    try {
      const { data: portalReq } = await (supabase as any)
        .from('portal_requests')
        .select('hunter_lead_id')
        .eq('id', requestId)
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
