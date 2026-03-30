// @ts-nocheck
/**
 * netlify/functions/calendar.ts
 * Google Calendar API proxy for PowerOn Hub — CHRONO Phase D Part 2
 *
 * ALL Google Calendar calls route through here. Credentials never exposed to client.
 * Auth: Uses GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (Netlify env)
 *       to obtain a fresh access_token on every request (standard OAuth2 refresh flow).
 *
 * Endpoints (via ?action= query param):
 *   action=list   GET  ?timeMin=<ISO>&timeMax=<ISO>  → Google Calendar events array
 *   action=create POST { summary, start, end, description?, location? } → { eventId, htmlLink }
 *   action=delete POST { eventId } → { deleted: true }
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

// ── OAuth2 Token Refresh ─────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      'Google Calendar credentials missing. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ' +
      'and GOOGLE_REFRESH_TOKEN in Netlify environment variables.'
    )
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OAuth2 token refresh failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const json = await res.json()

  if (!json.access_token) {
    throw new Error('OAuth2 response missing access_token')
  }

  return json.access_token as string
}

// ── CORS headers ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
}

function ok(body: unknown) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body) }
}

function err(status: number, message: string) {
  return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify({ error: message }) }
}

// ── Handler ──────────────────────────────────────────────────────────────────

const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  const action = event.queryStringParameters?.action

  if (!action) {
    return err(400, 'Missing required query param: action (list | create | delete)')
  }

  let accessToken: string
  try {
    accessToken = await getAccessToken()
  } catch (e: any) {
    console.error('[calendar.ts] Token error:', e.message)
    return err(503, `OAuth2 error: ${e.message}`)
  }

  try {
    // ── action=list ────────────────────────────────────────────────────────
    if (action === 'list') {
      const timeMin =
        event.queryStringParameters?.timeMin || new Date().toISOString()
      const timeMax =
        event.queryStringParameters?.timeMax ||
        new Date(Date.now() + 14 * 86400000).toISOString()

      const params = new URLSearchParams({
        maxResults: '250',
        singleEvents: 'true',
        orderBy: 'startTime',
        timeMin,
        timeMax,
      })

      const res = await fetch(`${CALENDAR_API}/calendars/primary/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!res.ok) {
        const text = await res.text()
        return err(res.status, `Google Calendar API error: ${text.slice(0, 200)}`)
      }

      const data = await res.json()
      return ok(data.items || [])
    }

    // ── action=create ──────────────────────────────────────────────────────
    if (action === 'create') {
      if (event.httpMethod !== 'POST') {
        return err(405, 'action=create requires POST method')
      }

      let body: any
      try {
        body = JSON.parse(event.body || '{}')
      } catch {
        return err(400, 'Invalid JSON in request body')
      }

      const { summary, start, end, description, location } = body

      if (!summary) return err(400, 'Missing required field: summary')
      if (!start)   return err(400, 'Missing required field: start (ISO datetime string)')
      if (!end)     return err(400, 'Missing required field: end (ISO datetime string)')

      const gcalEvent: Record<string, unknown> = {
        summary,
        start: { dateTime: start, timeZone: 'America/Los_Angeles' },
        end:   { dateTime: end,   timeZone: 'America/Los_Angeles' },
        extendedProperties: {
          private: {
            source:    'poweron_hub',
            createdBy: 'CHRONO',
          },
        },
      }

      if (description) gcalEvent.description = description
      if (location)    gcalEvent.location    = location

      const res = await fetch(`${CALENDAR_API}/calendars/primary/events`, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gcalEvent),
      })

      if (!res.ok) {
        const text = await res.text()
        return err(res.status, `Create event failed: ${text.slice(0, 200)}`)
      }

      const created = await res.json()
      return ok({ eventId: created.id, htmlLink: created.htmlLink || null })
    }

    // ── action=delete ──────────────────────────────────────────────────────
    if (action === 'delete') {
      if (event.httpMethod !== 'POST') {
        return err(405, 'action=delete requires POST method')
      }

      let body: any
      try {
        body = JSON.parse(event.body || '{}')
      } catch {
        return err(400, 'Invalid JSON in request body')
      }

      const { eventId } = body
      if (!eventId) return err(400, 'Missing required field: eventId')

      const res = await fetch(
        `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
        {
          method:  'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      )

      // 404 = already gone — treat as success
      if (!res.ok && res.status !== 404) {
        const text = await res.text()
        return err(res.status, `Delete event failed: ${text.slice(0, 200)}`)
      }

      return ok({ deleted: true })
    }

    return err(400, `Unknown action "${action}". Valid values: list | create | delete`)
  } catch (e: any) {
    console.error('[calendar.ts] Unhandled error:', e)
    return err(500, e.message || 'Internal server error')
  }
}

export { handler }
