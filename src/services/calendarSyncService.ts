// @ts-nocheck
/**
 * calendarSyncService.ts — CHRONO Phase D Part 2
 *
 * Google Calendar two-way sync for PowerOn Hub job schedule.
 * All Google Calendar calls proxy through /.netlify/functions/calendar
 * so credentials never leave the server.
 *
 * Public API:
 *   syncJobToCalendar(jobId)   — Push one calendar_event to Google, store google_event_id
 *   removeFromCalendar(jobId)  — Delete Google event, null out google_event_id
 *   syncAllPending()           — Sync all calendar_events missing a google_event_id
 *   pullCalendarEvents(days?)  — Fetch Google Calendar events for the next N days
 */

import { supabase } from '@/lib/supabase'

const CALENDAR_FN = '/.netlify/functions/calendar'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExternalCalendarEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: string   // ISO datetime
  end: string     // ISO datetime
  htmlLink?: string
  isExternal: true
}

export interface SyncResult {
  jobId: string
  googleEventId: string | null
  success: boolean
  error?: string
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function calendarFetch(
  action: 'list' | 'create' | 'delete',
  options: {
    method?: 'GET' | 'POST'
    queryParams?: Record<string, string>
    body?: Record<string, unknown>
  } = {}
): Promise<any> {
  const url = new URL(CALENDAR_FN, window.location.origin)
  url.searchParams.set('action', action)

  if (options.queryParams) {
    for (const [k, v] of Object.entries(options.queryParams)) {
      url.searchParams.set(k, v)
    }
  }

  const fetchOptions: RequestInit = {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
  }

  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body)
  }

  const res = await fetch(url.toString(), fetchOptions)
  const json = await res.json()

  if (!res.ok) {
    throw new Error(json.error || `Calendar API error ${res.status}`)
  }

  return json
}

// ── Public: syncJobToCalendar ─────────────────────────────────────────────────

/**
 * Push one calendar_event row to Google Calendar and store the returned google_event_id.
 * No-ops if the event already has a google_event_id.
 */
export async function syncJobToCalendar(jobId: string): Promise<SyncResult> {
  try {
    // Fetch job from Supabase
    const { data: job, error: fetchErr } = await supabase
      .from('calendar_events' as never)
      .select('id, title, start_time, end_time, location, address, google_event_id, org_id')
      .eq('id', jobId)
      .single()

    if (fetchErr || !job) {
      return { jobId, googleEventId: null, success: false, error: fetchErr?.message || 'Job not found' }
    }

    const j = job as any

    // Already synced — return existing id
    if (j.google_event_id) {
      return { jobId, googleEventId: j.google_event_id, success: true }
    }

    // Build description from job data
    const description = [
      `Job ID: ${j.id}`,
      j.location ? `Location: ${j.location}` : null,
      j.address  ? `Address: ${j.address}`   : null,
      '— PowerOn Hub / CHRONO',
    ].filter(Boolean).join('\n')

    // Push to Google via Netlify proxy
    const result = await calendarFetch('create', {
      method: 'POST',
      body: {
        summary:     j.title || 'Power On Job',
        start:       j.start_time,
        end:         j.end_time || j.start_time,
        description,
        location:    j.address || j.location || undefined,
      },
    })

    const googleEventId: string = result.eventId

    if (!googleEventId) {
      return { jobId, googleEventId: null, success: false, error: 'No event ID returned from Google' }
    }

    // Persist google_event_id back to Supabase
    const { error: updateErr } = await supabase
      .from('calendar_events' as never)
      .update({ google_event_id: googleEventId } as never)
      .eq('id', jobId)

    if (updateErr) {
      console.warn('[calendarSync] Failed to persist google_event_id:', updateErr.message)
    }

    console.log(`[calendarSync] Synced job ${jobId} → Google event ${googleEventId}`)
    return { jobId, googleEventId, success: true }
  } catch (e: any) {
    console.error('[calendarSync] syncJobToCalendar error:', e)
    return { jobId, googleEventId: null, success: false, error: e.message }
  }
}

// ── Public: removeFromCalendar ────────────────────────────────────────────────

/**
 * Delete the Google Calendar event for a job and null out its google_event_id.
 */
export async function removeFromCalendar(jobId: string): Promise<SyncResult> {
  try {
    const { data: job, error: fetchErr } = await supabase
      .from('calendar_events' as never)
      .select('id, google_event_id')
      .eq('id', jobId)
      .single()

    if (fetchErr || !job) {
      return { jobId, googleEventId: null, success: false, error: fetchErr?.message || 'Job not found' }
    }

    const j = job as any

    if (!j.google_event_id) {
      // Nothing to remove
      return { jobId, googleEventId: null, success: true }
    }

    // Delete from Google
    await calendarFetch('delete', {
      method: 'POST',
      body: { eventId: j.google_event_id },
    })

    // Null out in Supabase
    await supabase
      .from('calendar_events' as never)
      .update({ google_event_id: null } as never)
      .eq('id', jobId)

    console.log(`[calendarSync] Removed job ${jobId} from Google (event ${j.google_event_id})`)
    return { jobId, googleEventId: null, success: true }
  } catch (e: any) {
    console.error('[calendarSync] removeFromCalendar error:', e)
    return { jobId, googleEventId: null, success: false, error: e.message }
  }
}

// ── Public: syncAllPending ────────────────────────────────────────────────────

/**
 * Find all calendar_events where google_event_id IS NULL and status != 'cancelled',
 * then sync each one. Returns an array of sync results.
 */
export async function syncAllPending(orgId: string): Promise<SyncResult[]> {
  const { data: pending, error } = await supabase
    .from('calendar_events' as never)
    .select('id')
    .eq('org_id', orgId)
    .is('google_event_id', null)
    .neq('event_type', 'cancelled')

  if (error || !pending) {
    console.error('[calendarSync] syncAllPending fetch error:', error?.message)
    return []
  }

  const results: SyncResult[] = []
  for (const row of pending as any[]) {
    const result = await syncJobToCalendar(row.id)
    results.push(result)
  }

  const succeeded = results.filter(r => r.success).length
  console.log(`[calendarSync] syncAllPending: ${succeeded}/${results.length} jobs synced`)
  return results
}

// ── Public: pullCalendarEvents ────────────────────────────────────────────────

/**
 * Fetch Google Calendar events for the next N days.
 * Returns them as ExternalCalendarEvent[] for display in CHRONO week view
 * alongside internal events (rendered in a lighter color).
 */
export async function pullCalendarEvents(days = 14): Promise<ExternalCalendarEvent[]> {
  try {
    const timeMin = new Date().toISOString()
    const timeMax = new Date(Date.now() + days * 86400000).toISOString()

    const items: any[] = await calendarFetch('list', {
      method: 'GET',
      queryParams: { timeMin, timeMax },
    })

    return items
      .filter((item: any) => item.start?.dateTime || item.start?.date)
      .map((item: any) => ({
        id:          item.id,
        summary:     item.summary || 'Untitled',
        description: item.description || undefined,
        location:    item.location || undefined,
        start:       item.start.dateTime || item.start.date,
        end:         item.end?.dateTime   || item.end?.date || item.start.dateTime || item.start.date,
        htmlLink:    item.htmlLink || undefined,
        isExternal:  true as const,
      }))
  } catch (e: any) {
    console.warn('[calendarSync] pullCalendarEvents error:', e.message)
    return []
  }
}
