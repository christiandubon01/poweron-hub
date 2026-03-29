// @ts-nocheck
/**
 * googleCalendar.ts — Enhanced bidirectional Google Calendar sync for CHRONO
 *
 * Phase D enhancements:
 *   - READ: Pull events tagged "Power On" or created by app
 *   - READ: Merge with CHRONO internal calendar entries
 *   - READ: Detect conflicts between Google Calendar and app schedule
 *   - WRITE: After MiroFish approval, create Google Calendar event with:
 *     title "[Job type] — [Client name]", description, crew attendees
 *   - Sync frequency: every 15 minutes when app is open
 *   - Conflict resolution: app schedule is source of truth
 *
 * Uses existing VITE_GOOGLE_CALENDAR_API_KEY env variable.
 */

import { supabase } from '@/lib/supabase'
import { publish } from './agentEventBus'
import { submitProposal, runAutomatedReview } from './miroFish'
import { logAudit } from '@/lib/memory/audit'

// ── Types ────────────────────────────────────────────────────────────────────

export interface GoogleCalendarEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: { dateTime: string; timeZone?: string }
  end: { dateTime: string; timeZone?: string }
  status?: string
  htmlLink?: string
  attendees?: { email: string; displayName?: string; responseStatus?: string }[]
}

export interface CalendarSyncState {
  connected: boolean
  syncing: boolean
  lastSyncAt: string | null
  error: string | null
  eventCount: number
}

export interface SyncConflict {
  type: 'time_overlap' | 'missing_local' | 'missing_remote'
  localEventId?: string
  googleEventId?: string
  description: string
}

interface TokenData {
  access_token: string
  refresh_token?: string
  expires_at: number
  scope: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const SCOPES = 'https://www.googleapis.com/auth/calendar'
const REDIRECT_URI = `${window.location.origin}/auth/google/callback`
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const SYNC_INTERVAL_MS = 15 * 60 * 1000  // 15 minutes
const POWER_ON_TAG = 'Power On'

// ── Token Storage ────────────────────────────────────────────────────────────

let cachedToken: TokenData | null = null

async function getStoredToken(userId: string): Promise<TokenData | null> {
  if (cachedToken && cachedToken.expires_at > Date.now()) return cachedToken

  const { data } = await supabase
    .from('profiles' as never)
    .select('metadata')
    .eq('id', userId)
    .single()

  const token = (data as any)?.metadata?.google_calendar_token
  if (token) cachedToken = token
  return token || null
}

async function storeToken(userId: string, token: TokenData): Promise<void> {
  cachedToken = token

  const { data: profile } = await supabase
    .from('profiles' as never)
    .select('metadata')
    .eq('id', userId)
    .single()

  const currentMeta = (profile as any)?.metadata || {}

  await supabase
    .from('profiles' as never)
    .update({
      metadata: {
        ...currentMeta,
        google_calendar_token: token,
        google_calendar_connected_at: new Date().toISOString(),
      },
    })
    .eq('id', userId)
}

async function clearToken(userId: string): Promise<void> {
  cachedToken = null

  const { data: profile } = await supabase
    .from('profiles' as never)
    .select('metadata')
    .eq('id', userId)
    .single()

  const currentMeta = (profile as any)?.metadata || {}
  delete currentMeta.google_calendar_token
  delete currentMeta.google_calendar_connected_at

  await supabase
    .from('profiles' as never)
    .update({ metadata: currentMeta })
    .eq('id', userId)
}

// ── OAuth2 Flow ──────────────────────────────────────────────────────────────

export function initiateGoogleAuth(): void {
  if (!CLIENT_ID || CLIENT_ID.includes('your-google-client-id')) {
    alert('Google Calendar is not configured.\n\nSet VITE_GOOGLE_CLIENT_ID in .env.local with your Google OAuth client ID.')
    return
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: 'google_calendar_connect',
  })

  const width = 500
  const height = 600
  const left = window.screenX + (window.outerWidth - width) / 2
  const top = window.screenY + (window.outerHeight - height) / 2

  window.open(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    'google-calendar-auth',
    `width=${width},height=${height},left=${left},top=${top}`
  )
}

export async function handleGoogleCallback(
  code: string,
  userId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('google-calendar-token', {
      body: { code, redirect_uri: REDIRECT_URI },
    })

    if (error || !data?.access_token) {
      console.error('[gcal] Token exchange failed:', error || data)
      return false
    }

    const tokenData: TokenData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      scope: data.scope || SCOPES,
    }

    await storeToken(userId, tokenData)
    return true
  } catch (err) {
    console.error('[gcal] Callback handling failed:', err)
    return false
  }
}

// ── Connection Status ────────────────────────────────────────────────────────

export async function isConnected(userId: string): Promise<boolean> {
  const token = await getStoredToken(userId)
  return token != null
}

export async function disconnect(userId: string): Promise<void> {
  await clearToken(userId)
  stopAutoSync()
}

// ── Authenticated Fetch ──────────────────────────────────────────────────────

async function fetchWithAuth(
  url: string,
  userId: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getStoredToken(userId)
  if (!token) throw new Error('Not connected to Google Calendar')

  if (token.expires_at < Date.now() && token.refresh_token) {
    const { data } = await supabase.functions.invoke('google-calendar-token', {
      body: { refresh_token: token.refresh_token, grant_type: 'refresh_token' },
    })
    if (data?.access_token) {
      const refreshed: TokenData = {
        ...token,
        access_token: data.access_token,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      }
      await storeToken(userId, refreshed)
    }
  }

  const currentToken = await getStoredToken(userId)

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${currentToken?.access_token}`,
      'Content-Type': 'application/json',
    },
  })
}

// ── READ: Fetch Google Calendar Events ───────────────────────────────────────

export async function fetchGoogleEvents(
  userId: string,
  timeMin?: string,
  timeMax?: string
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    maxResults: '250',
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: timeMin || new Date(Date.now() - 30 * 86400000).toISOString(),
    timeMax: timeMax || new Date(Date.now() + 90 * 86400000).toISOString(),
  })

  const res = await fetchWithAuth(
    `${CALENDAR_API}/calendars/primary/events?${params}`,
    userId
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Google Calendar API error: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  return data.items || []
}

/**
 * Fetch only Power On related events from Google Calendar.
 * Filters for events tagged with "Power On" or created by the app.
 */
export async function fetchPowerOnEvents(
  userId: string,
  timeMin?: string,
  timeMax?: string
): Promise<GoogleCalendarEvent[]> {
  const allEvents = await fetchGoogleEvents(userId, timeMin, timeMax)

  return allEvents.filter(event => {
    const summary = (event.summary || '').toLowerCase()
    const desc = (event.description || '').toLowerCase()
    return (
      summary.includes('power on') ||
      desc.includes('power on') ||
      desc.includes('poweron hub') ||
      desc.includes('chrono:') ||
      summary.includes('—')  // Our format: "[Job type] — [Client name]"
    )
  })
}

// ── READ: Import Google Events to Supabase ───────────────────────────────────

export async function importGoogleEvents(
  userId: string,
  orgId: string
): Promise<number> {
  const events = await fetchGoogleEvents(userId)

  let imported = 0
  for (const event of events) {
    if (!event.start?.dateTime) continue

    const { error } = await supabase
      .from('schedule_entries' as never)
      .upsert({
        org_id: orgId,
        title: event.summary || 'Untitled',
        description: event.description || null,
        location: event.location || null,
        start_time: event.start.dateTime,
        end_time: event.end?.dateTime || event.start.dateTime,
        source: 'google_calendar',
        external_id: event.id,
        external_link: event.htmlLink || null,
        metadata: { google_calendar_id: event.id },
        created_by: userId,
      }, { onConflict: 'external_id' })

    if (!error) imported++
  }

  console.log(`[gcal] Imported ${imported} events from Google Calendar`)
  return imported
}

// ── READ: Detect Conflicts Between GCal and App Schedule ─────────────────────

export async function detectSyncConflicts(
  userId: string,
  orgId: string
): Promise<SyncConflict[]> {
  const conflicts: SyncConflict[] = []

  try {
    const googleEvents = await fetchPowerOnEvents(userId)

    // Get app calendar events for the same timeframe
    const { data: appEvents } = await supabase
      .from('calendar_events' as never)
      .select('id, title, start_time, end_time')
      .eq('org_id', orgId)
      .gte('start_time', new Date(Date.now() - 7 * 86400000).toISOString())
      .lte('start_time', new Date(Date.now() + 30 * 86400000).toISOString())

    const localEvents = (appEvents || []) as any[]

    // Check for time overlaps between Google events and local events
    for (const gEvent of googleEvents) {
      if (!gEvent.start?.dateTime) continue

      for (const local of localEvents) {
        const gStart = new Date(gEvent.start.dateTime).getTime()
        const gEnd = new Date(gEvent.end?.dateTime || gEvent.start.dateTime).getTime()
        const lStart = new Date(local.start_time).getTime()
        const lEnd = new Date(local.end_time).getTime()

        if (gStart < lEnd && gEnd > lStart) {
          // Overlap detected — only flag if titles don't match
          const gTitle = (gEvent.summary || '').toLowerCase()
          const lTitle = (local.title || '').toLowerCase()
          if (!gTitle.includes(lTitle) && !lTitle.includes(gTitle)) {
            conflicts.push({
              type: 'time_overlap',
              localEventId: local.id,
              googleEventId: gEvent.id,
              description: `Time overlap: Google "${gEvent.summary}" conflicts with app "${local.title}"`,
            })
          }
        }
      }
    }
  } catch (err) {
    console.warn('[gcal] Conflict detection error:', err)
  }

  return conflicts
}

// ── WRITE: Push CHRONO Event to Google Calendar (with MiroFish) ──────────────

/**
 * Create a Google Calendar event after MiroFish approval.
 * Format: title "[Job type] — [Client name]"
 * Includes crew members as attendees if they have email in backup.employees.
 */
export async function pushEventToGoogleWithApproval(
  userId: string,
  orgId: string,
  event: {
    jobType: string
    clientName: string
    description?: string
    location?: string
    start_time: string
    end_time: string
    crewEmails?: string[]
    projectDetails?: string
  }
): Promise<{ googleEventId?: string; proposalId?: string }> {
  const title = `${event.jobType} — ${event.clientName}`
  const description = [
    event.projectDetails || '',
    event.description || '',
    `Crew: ${event.crewEmails?.join(', ') || 'TBD'}`,
    `Location: ${event.location || 'TBD'}`,
    `\n— Created by PowerOn Hub / CHRONO`,
  ].filter(Boolean).join('\n')

  // Submit through MiroFish
  let proposalId: string | undefined
  try {
    const proposal = await submitProposal({
      orgId,
      proposingAgent: 'chrono',
      title: `Sync to Google Calendar: ${title}`,
      description: `Create Google Calendar event for ${event.clientName} on ${new Date(event.start_time).toLocaleDateString()}`,
      category: 'scheduling',
      impactLevel: 'low',
      actionType: 'create_gcal_event',
      actionPayload: { title, description, location: event.location, start_time: event.start_time, end_time: event.end_time, crewEmails: event.crewEmails },
    })

    proposalId = proposal.id
    await runAutomatedReview(proposal.id!)
  } catch (err) {
    console.error('[gcal] MiroFish submission error:', err)
  }

  // Note: Actual Google Calendar creation happens after MiroFish approval
  // The execution step calls pushEventToGoogle() with the confirmed payload
  return { proposalId }
}

/**
 * Direct push to Google Calendar (called after MiroFish approval).
 */
export async function pushEventToGoogle(
  userId: string,
  event: {
    title: string
    description?: string
    location?: string
    start_time: string
    end_time: string
    attendees?: string[]
  }
): Promise<string | null> {
  const gcalEvent: any = {
    summary: event.title,
    description: event.description || undefined,
    location: event.location || undefined,
    start: { dateTime: event.start_time, timeZone: 'America/Los_Angeles' },
    end: { dateTime: event.end_time, timeZone: 'America/Los_Angeles' },
  }

  // Add crew as attendees if emails provided
  if (event.attendees && event.attendees.length > 0) {
    gcalEvent.attendees = event.attendees.map(email => ({ email }))
  }

  const res = await fetchWithAuth(
    `${CALENDAR_API}/calendars/primary/events`,
    userId,
    { method: 'POST', body: JSON.stringify(gcalEvent) }
  )

  if (!res.ok) {
    console.error('[gcal] Push event failed:', await res.text())
    return null
  }

  const created = await res.json()
  return created.id || null
}

// ── Delete Google Calendar Event ─────────────────────────────────────────────

export async function deleteGoogleEvent(
  userId: string,
  googleEventId: string
): Promise<boolean> {
  const res = await fetchWithAuth(
    `${CALENDAR_API}/calendars/primary/events/${googleEventId}`,
    userId,
    { method: 'DELETE' }
  )

  return res.ok || res.status === 404
}

// ── Full Bidirectional Sync ──────────────────────────────────────────────────

/**
 * Full bidirectional sync. App schedule is source of truth.
 * Publishes GCAL_SYNCED event to agentEventBus.
 */
export async function fullSync(userId: string, orgId: string): Promise<{
  imported: number
  pushed: number
  conflicts: SyncConflict[]
  errors: number
}> {
  let imported = 0
  let pushed = 0
  let errors = 0
  let conflicts: SyncConflict[] = []

  try {
    // 1. Import from Google → Supabase
    imported = await importGoogleEvents(userId, orgId)
  } catch (err) {
    console.error('[gcal] Import failed:', err)
    errors++
  }

  try {
    // 2. Push local-only events to Google
    const { data: localEvents } = await supabase
      .from('schedule_entries' as never)
      .select('id, title, description, location, start_time, end_time, external_id')
      .eq('org_id', orgId)
      .is('external_id', null)
      .eq('source', 'chrono')

    for (const event of (localEvents || []) as any[]) {
      const googleId = await pushEventToGoogle(userId, event)
      if (googleId) {
        await supabase
          .from('schedule_entries' as never)
          .update({
            external_id: googleId,
            source: 'chrono_synced',
            metadata: { google_calendar_id: googleId },
          })
          .eq('id', event.id)
        pushed++
      } else {
        errors++
      }
    }
  } catch (err) {
    console.error('[gcal] Push failed:', err)
    errors++
  }

  try {
    // 3. Detect conflicts
    conflicts = await detectSyncConflicts(userId, orgId)
  } catch (err) {
    console.error('[gcal] Conflict detection failed:', err)
  }

  // Publish sync event
  publish(
    'GCAL_SYNCED',
    'chrono',
    { imported, pushed, conflicts: conflicts.length, errors },
    `Google Calendar sync: ${imported} imported, ${pushed} pushed, ${conflicts.length} conflict(s)`
  )

  await logAudit({
    orgId,
    actorType: 'agent',
    actorId: 'chrono',
    action: 'update',
    entityType: 'google_calendar_sync',
    description: `GCal sync completed: ${imported} imported, ${pushed} pushed`,
    metadata: { imported, pushed, conflicts: conflicts.length, errors },
  })

  return { imported, pushed, conflicts, errors }
}

// ── Auto-Sync Timer (every 15 minutes) ──────────────────────────────────────

let _autoSyncInterval: ReturnType<typeof setInterval> | null = null

/**
 * Start automatic sync every 15 minutes.
 * Call from SchedulePanel on mount when Google Calendar is connected.
 */
export function startAutoSync(userId: string, orgId: string): void {
  stopAutoSync()

  console.log('[gcal] Starting auto-sync every 15 minutes')

  _autoSyncInterval = setInterval(async () => {
    try {
      const connected = await isConnected(userId)
      if (!connected) {
        stopAutoSync()
        return
      }
      await fullSync(userId, orgId)
    } catch (err) {
      console.warn('[gcal] Auto-sync error:', err)
    }
  }, SYNC_INTERVAL_MS)
}

/**
 * Stop automatic sync.
 */
export function stopAutoSync(): void {
  if (_autoSyncInterval) {
    clearInterval(_autoSyncInterval)
    _autoSyncInterval = null
    console.log('[gcal] Auto-sync stopped')
  }
}
