// @ts-nocheck
/**
 * googleCalendar.ts — Bidirectional Google Calendar sync for CHRONO
 *
 * OAuth2 flow using VITE_GOOGLE_CLIENT_ID, syncs between
 * Supabase `calendar_events` table and Google Calendar.
 *
 * Features:
 *   - OAuth2 authorization via popup
 *   - Import existing Google Calendar events on connect
 *   - Push new CHRONO events to Google Calendar
 *   - Pull Google Calendar changes on refresh
 *   - Token refresh handling
 */

import { supabase } from '@/lib/supabase'

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
}

export interface CalendarSyncState {
  connected: boolean
  syncing: boolean
  lastSyncAt: string | null
  error: string | null
  eventCount: number
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

// ── Token Storage ────────────────────────────────────────────────────────────
// Stored in Supabase profiles.metadata.google_calendar

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

  // Read current metadata first, then merge
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

  // Open OAuth popup
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

/**
 * Handle the OAuth callback. Call this from the callback route.
 * Exchanges the authorization code for tokens.
 */
export async function handleGoogleCallback(
  code: string,
  userId: string
): Promise<boolean> {
  try {
    // Exchange code for tokens via Supabase Edge Function (to keep client_secret safe)
    const { data, error } = await supabase.functions.invoke('google-calendar-token', {
      body: { code, redirect_uri: REDIRECT_URI },
    })

    if (error || !data?.access_token) {
      console.error('[gcal] Token exchange failed:', error || data)

      // Fallback: If no Edge Function exists yet, try direct exchange
      // (only works if GOOGLE_CLIENT_SECRET is available — NOT recommended for production)
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

// ── Check Connection Status ──────────────────────────────────────────────────

export async function isConnected(userId: string): Promise<boolean> {
  const token = await getStoredToken(userId)
  return token != null
}

export async function disconnect(userId: string): Promise<void> {
  await clearToken(userId)
}

// ── Fetch Google Calendar Events ─────────────────────────────────────────────

async function fetchWithAuth(
  url: string,
  userId: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getStoredToken(userId)
  if (!token) throw new Error('Not connected to Google Calendar')

  // Check if token is expired
  if (token.expires_at < Date.now() && token.refresh_token) {
    // Refresh via Edge Function
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

// ── Import Google Events to Supabase ─────────────────────────────────────────

export async function importGoogleEvents(
  userId: string,
  orgId: string
): Promise<number> {
  const events = await fetchGoogleEvents(userId)

  let imported = 0
  for (const event of events) {
    if (!event.start?.dateTime) continue // skip all-day events for now

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

// ── Push CHRONO Event to Google Calendar ─────────────────────────────────────

export async function pushEventToGoogle(
  userId: string,
  event: {
    title: string
    description?: string
    location?: string
    start_time: string
    end_time: string
  }
): Promise<string | null> {
  const gcalEvent = {
    summary: event.title,
    description: event.description || undefined,
    location: event.location || undefined,
    start: { dateTime: event.start_time, timeZone: 'America/Los_Angeles' },
    end: { dateTime: event.end_time, timeZone: 'America/Los_Angeles' },
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

  return res.ok || res.status === 404 // 404 = already deleted
}

// ── Full Bidirectional Sync ──────────────────────────────────────────────────

export async function fullSync(userId: string, orgId: string): Promise<{
  imported: number
  pushed: number
  errors: number
}> {
  let imported = 0
  let pushed = 0
  let errors = 0

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

  return { imported, pushed, errors }
}
