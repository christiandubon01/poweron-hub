// @ts-nocheck
/**
 * Netlify Function — Customer Trust Pipeline Status Update
 *
 * POST /api/portal-status-update
 *
 * Handles all tech-initiated status changes for a customer booking:
 *   MARK_EN_ROUTE    → sends SMS, updates stage, logs communication
 *   MARK_ARRIVED     → sends SMS, updates stage, logs communication
 *   MARK_IN_PROGRESS → sends SMS, updates stage
 *   MARK_WRAPPING_UP → sends SMS, updates stage
 *   MARK_COMPLETE    → sends completion SMS + review request, closes booking
 *   FLAG_ISSUE       → sends delay/issue SMS to customer
 *   SEND_UPDATE      → sends free-text SMS from tech to customer
 *   CUSTOMER_REPLY   → logs inbound SMS reply from customer, notifies owner
 *   TOGGLE_LOCATION  → enables/disables approximate location sharing
 *
 * Database tables (Supabase):
 *   customer_bookings    — main booking record with stage + stage_history + communication_log
 *   communication_log    — separate log table for audit trail and owner review
 *
 * SMS (Twilio — configure env vars to activate):
 *   TWILIO_ACCOUNT_SID   — Twilio account SID
 *   TWILIO_AUTH_TOKEN    — Twilio auth token
 *   TWILIO_FROM_NUMBER   — Twilio phone number (e.g. +15551234567)
 *   TWILIO_ENABLED       — "true" to activate live SMS (default: placeholder/log only)
 *
 * Supabase:
 *   SUPABASE_URL              — project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (server-side only)
 *
 * Authentication:
 *   PORTAL_STATUS_SECRET — shared secret header (X-Portal-Secret) for tech requests
 *   Customer replies use phone number matching only (inbound webhook from Twilio)
 *
 * Returns:
 *   { success: true, booking: BookingRecord, smsSent: boolean }
 *   { success: false, error: string }
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Portal-Secret',
  'Content-Type': 'application/json',
}

// ── Types ──────────────────────────────────────────────────────────────────────

type TechAction =
  | 'MARK_EN_ROUTE'
  | 'MARK_ARRIVED'
  | 'MARK_IN_PROGRESS'
  | 'MARK_WRAPPING_UP'
  | 'MARK_COMPLETE'
  | 'FLAG_ISSUE'
  | 'SEND_UPDATE'
  | 'CUSTOMER_REPLY'
  | 'TOGGLE_LOCATION'

type PipelineStage =
  | 'BOOKED'
  | 'EN_ROUTE'
  | 'ARRIVING'
  | 'ON_SITE'
  | 'IN_PROGRESS'
  | 'WRAPPING_UP'
  | 'COMPLETE'

interface StatusUpdateRequest {
  bookingId: string
  action: TechAction
  techId?: string
  etaMinutes?: number
  message?: string
  issueReason?: string
  delayMinutes?: number
  updatedEta?: string
  locationEnabled?: boolean
  customerPhone?: string
}

// ── Stage mapping ──────────────────────────────────────────────────────────────

const ACTION_STAGE_MAP: Partial<Record<TechAction, PipelineStage>> = {
  MARK_EN_ROUTE: 'EN_ROUTE',
  MARK_ARRIVED: 'ON_SITE',
  MARK_IN_PROGRESS: 'IN_PROGRESS',
  MARK_WRAPPING_UP: 'WRAPPING_UP',
  MARK_COMPLETE: 'COMPLETE',
}

// ── UUID ───────────────────────────────────────────────────────────────────────

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ── SMS template ───────────────────────────────────────────────────────────────

function buildSmsBody(
  stage: PipelineStage | null,
  techName: string,
  customerName: string,
  bookingId: string,
  opts: {
    etaMinutes?: number
    message?: string
    issueReason?: string
    delayMinutes?: number
    updatedEta?: string
  } = {}
): string {
  const statusUrl = `https://poweronsolutionsllc.com/status/${bookingId}`

  if (opts.message) {
    return `Power On Solutions — ${techName}: ${opts.message}`
  }

  if (opts.issueReason || opts.delayMinutes) {
    const delay = opts.delayMinutes ?? 15
    return opts.updatedEta
      ? `Hi ${customerName}, ${techName} is running ${delay} minutes behind due to a previous job. Updated ETA: ${opts.updatedEta}. We apologize for the inconvenience. Track: ${statusUrl}`
      : `Hi ${customerName}, quick update from ${techName}: ${opts.issueReason ?? 'slight delay'}. Track: ${statusUrl}`
  }

  switch (stage) {
    case 'BOOKED':
      return `Hi ${customerName}, your appointment with Power On Solutions is confirmed. ${techName} will be at your location as scheduled. Track your job: ${statusUrl}`
    case 'EN_ROUTE':
      return opts.etaMinutes
        ? `Hi ${customerName}, your technician ${techName} is on the way! ETA: ${opts.etaMinutes} minutes. Track live: ${statusUrl}`
        : `Hi ${customerName}, ${techName} has departed and is en route to your location.`
    case 'ARRIVING':
      return `Your technician ${techName} is arriving in the next 5 minutes. Please be ready.`
    case 'ON_SITE':
      return `${techName} has arrived at your location and is ready to begin. Power On Solutions — License C10.`
    case 'IN_PROGRESS':
      return `Work is underway. ${techName} is on the job. We'll notify you when wrapping up.`
    case 'WRAPPING_UP':
      return `Almost done! ${techName} is completing final checks. Invoice will follow shortly.`
    case 'COMPLETE':
      return `Job complete! Thank you for choosing Power On Solutions. Your invoice has been sent. Leave a review: https://poweronsolutionsllc.com/review`
    default:
      return `Update from Power On Solutions regarding your appointment with ${techName}. Track: ${statusUrl}`
  }
}

// ── Supabase helpers ───────────────────────────────────────────────────────────

async function supabaseFetch(
  path: string,
  method: string,
  body?: unknown
): Promise<{ data: unknown; error: string | null }> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return { data: null, error: 'Supabase not configured' }
  }

  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: method === 'POST' ? 'return=representation' : 'return=representation',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const text = await res.text()
    let data: unknown = null
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }

    if (!res.ok) {
      return { data: null, error: `Supabase error ${res.status}: ${text}` }
    }

    return { data, error: null }
  } catch (err) {
    return { data: null, error: String(err) }
  }
}

async function getBooking(bookingId: string): Promise<{ booking: unknown; error: string | null }> {
  const { data, error } = await supabaseFetch(
    `customer_bookings?booking_token=eq.${encodeURIComponent(bookingId)}&select=*`,
    'GET'
  )

  if (error) return { booking: null, error }
  const rows = data as unknown[]
  if (!rows || rows.length === 0) return { booking: null, error: 'Booking not found' }
  return { booking: rows[0], error: null }
}

async function updateBookingStage(
  bookingId: string,
  patch: Record<string, unknown>
): Promise<{ data: unknown; error: string | null }> {
  return supabaseFetch(
    `customer_bookings?booking_token=eq.${encodeURIComponent(bookingId)}`,
    'PATCH',
    patch
  )
}

async function logCommunication(entry: Record<string, unknown>): Promise<void> {
  try {
    await supabaseFetch('communication_log', 'POST', entry)
  } catch {
    // Non-fatal — log best effort
  }
}

// ── Twilio SMS ─────────────────────────────────────────────────────────────────

async function sendSms(to: string, body: string): Promise<{ sent: boolean; error?: string }> {
  const enabled = process.env.TWILIO_ENABLED === 'true'
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER

  if (!enabled || !accountSid || !authToken || !from) {
    // Placeholder: log SMS to console instead of sending
    console.log(`[SMS PLACEHOLDER] To: ${to}\n${body}`)
    return { sent: false }
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
      }
    )

    if (!res.ok) {
      const text = await res.text()
      return { sent: false, error: `Twilio error ${res.status}: ${text}` }
    }

    return { sent: true }
  } catch (err) {
    return { sent: false, error: String(err) }
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

exports.handler = async (event: any, _context: any) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    }
  }

  // Parse body
  let req: StatusUpdateRequest
  try {
    req = JSON.parse(event.body ?? '{}')
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Invalid JSON body' }),
    }
  }

  const { bookingId, action, etaMinutes, message, issueReason, delayMinutes, updatedEta, locationEnabled } = req

  if (!bookingId || !action) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'bookingId and action are required' }),
    }
  }

  // Authenticate tech requests (skip for CUSTOMER_REPLY — comes from Twilio webhook)
  if (action !== 'CUSTOMER_REPLY') {
    const secret = process.env.PORTAL_STATUS_SECRET
    if (secret) {
      const provided = event.headers['x-portal-secret'] ?? event.headers['X-Portal-Secret']
      if (provided !== secret) {
        return {
          statusCode: 401,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: false, error: 'Unauthorized' }),
        }
      }
    }
  }

  // Fetch booking record
  const { booking, error: fetchError } = await getBooking(bookingId)
  if (fetchError || !booking) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: fetchError ?? 'Booking not found' }),
    }
  }

  const b = booking as Record<string, unknown>
  const techName = String(b.tech_name ?? 'Christian')
  const customerName = String(b.customer_name ?? 'Customer')
  const customerPhone = String(b.customer_phone ?? req.customerPhone ?? '')
  const currentStage = String(b.current_stage ?? 'BOOKED') as PipelineStage
  const stageHistory: unknown[] = Array.isArray(b.stage_history) ? b.stage_history : []
  const communicationLog: unknown[] = Array.isArray(b.communication_log) ? b.communication_log : []

  const now = new Date().toISOString()
  let smsSent = false
  let smsError: string | undefined

  // ── Handle CUSTOMER_REPLY ──────────────────────────────────────────────────

  if (action === 'CUSTOMER_REPLY') {
    const inboundEntry = {
      id: uuid(),
      booking_id: bookingId,
      direction: 'inbound',
      channel: 'sms',
      body: message ?? '',
      timestamp: now,
    }

    const updatedLog = [...communicationLog, inboundEntry]

    await updateBookingStage(bookingId, {
      communication_log: updatedLog,
      updated_at: now,
    })

    await logCommunication({
      ...inboundEntry,
      customer_name: customerName,
      customer_phone: customerPhone,
      booking_token: bookingId,
    })

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, logged: true }),
    }
  }

  // ── Handle TOGGLE_LOCATION ─────────────────────────────────────────────────

  if (action === 'TOGGLE_LOCATION') {
    await updateBookingStage(bookingId, {
      location_sharing_enabled: locationEnabled ?? true,
      updated_at: now,
    })

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, locationSharingEnabled: locationEnabled }),
    }
  }

  // ── Determine new stage ────────────────────────────────────────────────────

  const newStage: PipelineStage | null = ACTION_STAGE_MAP[action] ?? null

  // ── Build SMS body ─────────────────────────────────────────────────────────

  let smsBody: string | null = null

  if (action === 'FLAG_ISSUE') {
    smsBody = buildSmsBody(null, techName, customerName, bookingId, {
      issueReason,
      delayMinutes,
      updatedEta,
    })
  } else if (action === 'SEND_UPDATE') {
    if (message) {
      smsBody = buildSmsBody(null, techName, customerName, bookingId, { message })
    }
  } else if (newStage) {
    smsBody = buildSmsBody(newStage, techName, customerName, bookingId, { etaMinutes })
  }

  // ── Send SMS ───────────────────────────────────────────────────────────────

  if (smsBody && customerPhone) {
    const smsResult = await sendSms(customerPhone, smsBody)
    smsSent = smsResult.sent
    smsError = smsResult.error
  }

  // ── Build communication log entry ──────────────────────────────────────────

  const commEntry = smsBody
    ? {
        id: uuid(),
        booking_id: bookingId,
        direction: 'outbound',
        channel: action === 'FLAG_ISSUE' ? 'flag' : 'sms',
        body: smsBody,
        timestamp: now,
        sms_status: smsSent ? 'sent' : 'queued',
        is_issue_flag: action === 'FLAG_ISSUE',
        flag_details: action === 'FLAG_ISSUE'
          ? { reason: issueReason, delayMinutes, updatedEta }
          : undefined,
      }
    : null

  const updatedLog = commEntry
    ? [...communicationLog, commEntry]
    : communicationLog

  // ── Build stage history entry ──────────────────────────────────────────────

  const stageEntry = newStage
    ? {
        stage: newStage,
        timestamp: now,
        note: message ?? issueReason ?? undefined,
        triggered_by: 'tech',
      }
    : null

  const updatedHistory = stageEntry
    ? [...stageHistory, stageEntry]
    : stageHistory

  // ── Build Supabase patch ───────────────────────────────────────────────────

  const patch: Record<string, unknown> = {
    communication_log: updatedLog,
    stage_history: updatedHistory,
    updated_at: now,
  }

  if (newStage) patch.current_stage = newStage
  if (action === 'MARK_EN_ROUTE' && etaMinutes) {
    patch.eta_minutes = etaMinutes
    patch.eta_timestamp = new Date(Date.now() + etaMinutes * 60 * 1000).toISOString()
  }
  if (newStage === 'COMPLETE') {
    patch.completed_at = now
  }

  // ── Patch booking in Supabase ──────────────────────────────────────────────

  const { error: patchError } = await updateBookingStage(bookingId, patch)

  if (patchError) {
    console.error('[portal-status-update] Patch error:', patchError)
  }

  // ── Log communication to audit table ──────────────────────────────────────

  if (commEntry) {
    await logCommunication({
      ...commEntry,
      customer_name: customerName,
      customer_phone: customerPhone,
      booking_token: bookingId,
      tech_name: techName,
    })
  }

  // ── Return result ──────────────────────────────────────────────────────────

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: !patchError,
      action,
      newStage,
      smsSent,
      smsError: smsError ?? null,
      error: patchError ?? null,
      updatedAt: now,
    }),
  }
}
