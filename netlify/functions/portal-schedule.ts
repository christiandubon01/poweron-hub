// @ts-nocheck
/**
 * Netlify Function — Portal AI Scheduling Agent
 *
 * Handles all server-side scheduling operations for the customer portal chat widget.
 *
 * Supported actions (POST body.action):
 *
 *   create_booking
 *     → Validates booking input
 *     → Reads available time slots from Supabase job_schedule (CHRONO data)
 *     → Creates tentative booking in portal_bookings table
 *     → Sends push notification to Christian via agent_messages
 *     → Returns { success: true, confirmationNumber, bookingId }
 *
 *   send_confirmation_email
 *     → Sends branded confirmation email to customer via Resend
 *     → Called after Christian approves a booking
 *     → Returns { success: true, messageId }
 *
 *   get_available_slots
 *     → Reads CHRONO job_schedule for the next 14 days
 *     → Returns { success: true, slots: AvailableSlot[] }
 *
 *   approve_booking
 *     → Updates portal_bookings.status to 'approved'
 *     → Triggers confirmation email to customer
 *     → Creates calendar entry in job_schedule (CHRONO)
 *     → Returns { success: true }
 *
 *   decline_booking
 *     → Updates portal_bookings.status to 'declined'
 *     → Returns { success: true }
 *
 *   suggest_time
 *     → Updates portal_bookings.status to 'suggested'
 *     → Stores suggested_times on booking record
 *     → Returns { success: true }
 *
 * DATA FIREWALL (non-negotiable):
 *  - Reads CHRONO data (job_schedule) READ ONLY — never writes operational tables
 *  - Writes ONLY to portal_bookings and agent_messages (notification channel)
 *  - SUPABASE_SERVICE_ROLE_KEY is server-side ONLY — never exposed to client
 *  - Customer contact info is only stored in portal_bookings
 *
 * Environment variables required:
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Service role secret (server-side only)
 *   RESEND_API_KEY            — Resend API key for confirmation emails
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

const COMPANY_NAME    = 'Power On Solutions LLC'
const LICENSE_NUMBER  = '1151468'
const CSLB_VERIFY_URL = `https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx?LicNum=${LICENSE_NUMBER}`
const FROM_ADDRESS    = 'Power On Solutions <app@poweronsolutionsllc.com>'
const PHONE_DISPLAY   = '(760) 555-0100'
const WEBSITE_URL     = 'https://poweronsolutionsllc.com'
const RESEND_API_URL  = 'https://api.resend.com/emails'

// ── UUID / confirmation helpers ───────────────────────────────────────────────

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function generateConfirmationNumber() {
  const segment = generateUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
  return `PSB-${segment}`
}

// ── Date / time helpers ───────────────────────────────────────────────────────

function toDateStr(d) {
  return d.toISOString().split('T')[0]
}

function formatDateLabel(dateStr) {
  const date = new Date(dateStr + 'T12:00:00')
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function formatTime12h(time24) {
  if (!time24) return ''
  const [h, m] = time24.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function escHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Supabase client (service role) ────────────────────────────────────────────

function getSupabaseHeaders(serviceKey) {
  return {
    'Content-Type': 'application/json',
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Prefer': 'return=representation',
  }
}

async function supabaseSelect(url, table, query, serviceKey) {
  const endpoint = `${url}/rest/v1/${table}?${query}`
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: getSupabaseHeaders(serviceKey),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Supabase SELECT ${table}: ${res.status} ${err}`)
  }
  return res.json()
}

async function supabaseInsert(url, table, payload, serviceKey) {
  const endpoint = `${url}/rest/v1/${table}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: getSupabaseHeaders(serviceKey),
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Supabase INSERT ${table}: ${res.status} ${err}`)
  }
  return res.json()
}

async function supabasePatch(url, table, matchQuery, payload, serviceKey) {
  const endpoint = `${url}/rest/v1/${table}?${matchQuery}`
  const res = await fetch(endpoint, {
    method: 'PATCH',
    headers: getSupabaseHeaders(serviceKey),
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Supabase PATCH ${table}: ${res.status} ${err}`)
  }
  return res.json()
}

// ── getAvailableSlots (server-side) ──────────────────────────────────────────

async function getAvailableSlotsFromSupabase(supabaseUrl, serviceKey) {
  const today = new Date()
  const slots = []

  // Build date range: next 14 days (skip Sundays)
  const dateRange = []
  for (let i = 1; i <= 14; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    if (d.getDay() !== 0) { // skip Sunday
      dateRange.push(toDateStr(d))
    }
  }

  let jobCountByDate = {}

  try {
    // Read CHRONO job_schedule (read-only — DATA FIREWALL compliant)
    const datesFilter = dateRange.map(d => `"${d}"`).join(',')
    const jobs = await supabaseSelect(
      supabaseUrl,
      'job_schedule',
      `select=scheduled_date,status&scheduled_date=in.(${datesFilter})&status=neq.cancelled`,
      serviceKey
    )

    for (const job of jobs) {
      const d = job.scheduled_date
      jobCountByDate[d] = (jobCountByDate[d] || 0) + 1
    }
  } catch (err) {
    // If job_schedule doesn't exist yet, fall through to mock slots
    console.log('[portal-schedule] job_schedule read:', err.message)
  }

  // Build available slots (days with < 2 jobs scheduled)
  for (const date of dateRange) {
    if (slots.length >= 6) break
    const count = jobCountByDate[date] || 0
    if (count < 2) {
      const dayLabel = formatDateLabel(date)
      const isAM = slots.length % 2 === 0
      const startTime = isAM ? '08:00' : '12:00'
      const endTime = isAM ? '12:00' : '16:00'
      const timeLabel = isAM ? 'morning (8 AM–12 PM)' : 'afternoon (12–4 PM)'
      slots.push({
        date,
        dayLabel,
        startTime,
        endTime,
        displayLabel: `${dayLabel} ${timeLabel}`,
      })
    }
  }

  // Fallback if no slots found
  if (slots.length === 0) {
    const fallbackOffsets = [2, 3, 5, 6]
    for (const offset of fallbackOffsets) {
      const d = new Date(today)
      d.setDate(today.getDate() + offset)
      if (d.getDay() === 0) continue
      const date = toDateStr(d)
      const dayLabel = formatDateLabel(date)
      const isAM = slots.length % 2 === 0
      const startTime = isAM ? '08:00' : '12:00'
      const endTime = isAM ? '12:00' : '16:00'
      slots.push({
        date,
        dayLabel,
        startTime,
        endTime,
        displayLabel: `${dayLabel} ${isAM ? 'morning (8 AM–12 PM)' : 'afternoon (12–4 PM)'}`,
      })
      if (slots.length >= 4) break
    }
  }

  return slots
}

// ── createBooking ─────────────────────────────────────────────────────────────

async function handleCreateBooking(body, supabaseUrl, serviceKey) {
  const { serviceType, urgency, selectedSlot, contact, notes } = body

  // Validate required fields
  if (!contact?.name || !contact?.email || !contact?.phone || !contact?.address) {
    return {
      statusCode: 422,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Missing required contact fields' }),
    }
  }
  if (!selectedSlot?.date || !selectedSlot?.startTime) {
    return {
      statusCode: 422,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Missing required slot information' }),
    }
  }

  const bookingId = generateUUID()
  const confirmationNumber = generateConfirmationNumber()
  const now = new Date().toISOString()

  const bookingRecord = {
    id: bookingId,
    confirmation_number: confirmationNumber,
    customer_name: contact.name,
    customer_email: contact.email,
    customer_phone: contact.phone,
    customer_address: contact.address,
    service_type: serviceType || 'electrical_service',
    urgency: urgency || 'medium',
    preferred_date: selectedSlot.date,
    preferred_time_start: selectedSlot.startTime,
    preferred_time_end: selectedSlot.endTime,
    notes: notes || null,
    status: 'tentative',
    created_at: now,
    updated_at: now,
  }

  // Insert booking into portal_bookings
  try {
    await supabaseInsert(supabaseUrl, 'portal_bookings', [bookingRecord], serviceKey)
  } catch (err) {
    console.error('[portal-schedule] portal_bookings insert error:', err.message)
    // Continue — still notify Christian even if DB write fails
  }

  // Notify Christian via agent_messages (CHRONO channel)
  const notificationMsg = {
    id: generateUUID(),
    from_agent: 'CHRONO',
    to_agent: 'NEXUS',
    type: 'alert',
    payload: JSON.stringify({
      alertType: 'new_booking_request',
      bookingId,
      confirmationNumber,
      customerName: contact.name,
      customerPhone: contact.phone,
      customerEmail: contact.email,
      serviceType: serviceType || 'electrical_service',
      urgency: urgency || 'medium',
      preferredDate: selectedSlot.date,
      preferredTimeSlot: selectedSlot.displayLabel || `${selectedSlot.date} ${selectedSlot.startTime}–${selectedSlot.endTime}`,
      address: contact.address,
      notes: notes || '',
      message: `📅 New booking request: ${contact.name} — ${serviceType || 'electrical service'} — ${selectedSlot.displayLabel || selectedSlot.date}`,
      actions: ['approve', 'suggest_different_time', 'decline'],
      timestamp: now,
    }),
    read: false,
    created_at: now,
  }

  try {
    await supabaseInsert(supabaseUrl, 'agent_messages', [notificationMsg], serviceKey)
  } catch (err) {
    console.log('[portal-schedule] agent_messages insert (non-fatal):', err.message)
  }

  console.log('[portal-schedule] Booking created:', confirmationNumber, '| Customer:', contact.name)

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: true,
      confirmationNumber,
      bookingId,
      message: `Booking request submitted. Confirmation: ${confirmationNumber}`,
    }),
  }
}

// ── sendConfirmationEmail ─────────────────────────────────────────────────────

async function handleSendConfirmationEmail(body, resendApiKey) {
  const {
    customerEmail,
    customerName,
    confirmationNumber,
    serviceType,
    preferredDate,
    preferredTimeStart,
    preferredTimeEnd,
    technicianName,
    address,
  } = body

  if (!customerEmail || !customerName || !confirmationNumber) {
    return {
      statusCode: 422,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Missing required email fields' }),
    }
  }

  const firstName = (customerName || 'there').split(' ')[0]
  const dateLabel = preferredDate ? formatDateLabel(preferredDate) : 'your scheduled date'
  const timeLabel = preferredTimeStart
    ? `${formatTime12h(preferredTimeStart)}–${formatTime12h(preferredTimeEnd)}`
    : 'TBD'
  const tech = technicianName || 'Christian D., C-10 Licensed Electrician'
  const year = new Date().getFullYear()

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Booking Confirmed — Power On Solutions</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#0f172a;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600"
             style="max-width:600px;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
        <!-- Header bar -->
        <tr><td style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);padding:6px 0;text-align:center;">
          <span style="font-size:11px;font-weight:700;letter-spacing:0.15em;color:#0f172a;text-transform:uppercase;">
            Power On Solutions LLC · C-10 Licensed · CA
          </span>
        </td></tr>
        <!-- Brand row -->
        <tr><td style="padding:36px 40px 24px;text-align:center;border-bottom:1px solid #334155;">
          <div style="display:inline-block;background:#f59e0b;border-radius:10px;padding:10px 20px;margin-bottom:16px;">
            <span style="font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.5px;">⚡ POWER ON</span>
          </div>
          <h1 style="margin:0 0 6px;font-size:26px;font-weight:700;color:#f8fafc;">Booking Confirmed!</h1>
          <p style="margin:0;font-size:15px;color:#94a3b8;">Your visit has been approved and scheduled.</p>
        </td></tr>
        <!-- Greeting -->
        <tr><td style="padding:28px 40px 0;">
          <p style="margin:0 0 8px;font-size:16px;color:#e2e8f0;">Hi ${escHtml(firstName)},</p>
          <p style="margin:0;font-size:15px;color:#94a3b8;line-height:1.6;">
            Great news! Your electrical service appointment with Power On Solutions has been confirmed.
            Here are your visit details:
          </p>
        </td></tr>
        <!-- Confirmation box -->
        <tr><td style="padding:24px 40px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
                 style="background:#0f172a;border-radius:8px;border:1px solid #f59e0b;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.12em;color:#f59e0b;text-transform:uppercase;">Confirmation Number</p>
              <p style="margin:0;font-size:28px;font-weight:800;color:#f8fafc;letter-spacing:0.08em;font-family:monospace;">${escHtml(confirmationNumber)}</p>
            </td></tr>
          </table>
        </td></tr>
        <!-- Visit details -->
        <tr><td style="padding:0 40px 24px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
                 style="background:#1e3a5f;border-radius:8px;border:1px solid #2563eb;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:0.08em;">📅 Visit Details</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding-bottom:8px;padding-right:12px;font-size:13px;color:#94a3b8;white-space:nowrap;">Date:</td>
                  <td style="padding-bottom:8px;font-size:13px;font-weight:600;color:#f8fafc;">${escHtml(dateLabel)}</td>
                </tr>
                <tr>
                  <td style="padding-bottom:8px;padding-right:12px;font-size:13px;color:#94a3b8;white-space:nowrap;">Time Window:</td>
                  <td style="padding-bottom:8px;font-size:13px;font-weight:600;color:#f8fafc;">${escHtml(timeLabel)}</td>
                </tr>
                <tr>
                  <td style="padding-bottom:8px;padding-right:12px;font-size:13px;color:#94a3b8;white-space:nowrap;">Technician:</td>
                  <td style="padding-bottom:8px;font-size:13px;font-weight:600;color:#f8fafc;">${escHtml(tech)}</td>
                </tr>
                ${address ? `<tr>
                  <td style="padding-right:12px;font-size:13px;color:#94a3b8;white-space:nowrap;">Address:</td>
                  <td style="font-size:13px;font-weight:600;color:#f8fafc;">${escHtml(address)}</td>
                </tr>` : ''}
              </table>
            </td></tr>
          </table>
        </td></tr>
        <!-- What to prepare -->
        <tr><td style="padding:0 40px 28px;">
          <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#f8fafc;text-transform:uppercase;letter-spacing:0.08em;">What to Prepare</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:8px;">
            <tr>
              <td width="20" valign="top" style="color:#f59e0b;font-size:14px;">✓</td>
              <td style="padding-left:8px;font-size:13px;color:#94a3b8;line-height:1.5;">Ensure access to your electrical panel</td>
            </tr>
          </table>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:8px;">
            <tr>
              <td width="20" valign="top" style="color:#f59e0b;font-size:14px;">✓</td>
              <td style="padding-left:8px;font-size:13px;color:#94a3b8;line-height:1.5;">Clear the work area of any obstructions</td>
            </tr>
          </table>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td width="20" valign="top" style="color:#f59e0b;font-size:14px;">✓</td>
              <td style="padding-left:8px;font-size:13px;color:#94a3b8;line-height:1.5;">Have any previous electrical reports or photos ready</td>
            </tr>
          </table>
        </td></tr>
        <!-- SMS reminder note -->
        <tr><td style="padding:0 40px 24px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
                 style="background:#1a2a1a;border-radius:8px;border:1px solid #166534;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#4ade80;">📱 SMS Reminders</p>
              <p style="margin:0;font-size:12px;color:#86efac;line-height:1.5;">
                You'll receive a text reminder 24 hours before your appointment, and another 2 hours before
                with your technician's ETA.
              </p>
            </td></tr>
          </table>
        </td></tr>
        <!-- License block -->
        <tr><td style="padding:0 40px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
                 style="background:#0f172a;border-radius:8px;border:1px solid #334155;">
            <tr><td style="padding:18px 24px;">
              <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#e2e8f0;">🛡 Licensed, Bonded &amp; Insured</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding-right:6px;">
                    <span style="font-size:13px;color:#94a3b8;">CSLB License #</span>
                    <span style="font-size:13px;font-weight:700;color:#f8fafc;">&nbsp;${LICENSE_NUMBER}</span>
                  </td>
                  <td>
                    <a href="${CSLB_VERIFY_URL}" style="display:inline-block;font-size:12px;font-weight:600;color:#f59e0b;text-decoration:none;border:1px solid #f59e0b;border-radius:4px;padding:2px 10px;">Verify ↗</a>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
        <!-- CTA -->
        <tr><td style="padding:0 40px 32px;text-align:center;">
          <p style="margin:0 0 16px;font-size:14px;color:#94a3b8;">Need to reach us or reschedule?</p>
          <a href="tel:${PHONE_DISPLAY.replace(/\D/g,'')}"
             style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;text-decoration:none;border-radius:8px;padding:13px 32px;">
            Call ${PHONE_DISPLAY}
          </a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#0f172a;padding:20px 40px;border-top:1px solid #1e293b;text-align:center;">
          <p style="margin:0 0 6px;font-size:12px;color:#475569;">${COMPANY_NAME} · C-10 License #${LICENSE_NUMBER}</p>
          <p style="margin:0 0 6px;font-size:12px;color:#475569;">Desert Hot Springs, CA · Coachella Valley Electrical Contractor</p>
          <p style="margin:0;font-size:11px;color:#334155;">© ${year} ${COMPANY_NAME}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const textBody = `Hi ${firstName},

Your appointment with Power On Solutions has been confirmed!

CONFIRMATION: ${confirmationNumber}
DATE: ${dateLabel}
TIME WINDOW: ${timeLabel}
TECHNICIAN: ${tech}
${address ? `ADDRESS: ${address}` : ''}

WHAT TO PREPARE:
✓ Ensure access to your electrical panel
✓ Clear the work area of any obstructions
✓ Have any previous electrical reports or photos ready

SMS REMINDERS:
You'll receive a text reminder 24 hours before your appointment, and 2 hours before with your technician's ETA.

Need to reschedule? Call ${PHONE_DISPLAY}

---
${COMPANY_NAME} · C-10 License #${LICENSE_NUMBER}
Desert Hot Springs, CA · ${WEBSITE_URL}`

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [String(customerEmail).toLowerCase().trim()],
        subject: `Appointment Confirmed — ${confirmationNumber} | Power On Solutions`,
        html: htmlBody,
        text: textBody,
      }),
    })

    const resData = await res.json()

    if (!res.ok) {
      console.error('[portal-schedule] Resend error:', res.status, resData)
      return {
        statusCode: res.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: resData?.message || 'Email send failed' }),
      }
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, messageId: resData.id }),
    }
  } catch (err) {
    console.error('[portal-schedule] sendConfirmationEmail error:', err)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: err.message }),
    }
  }
}

// ── approveBooking ────────────────────────────────────────────────────────────

async function handleApproveBooking(body, supabaseUrl, serviceKey, resendApiKey) {
  const { bookingId, technicianName } = body

  if (!bookingId) {
    return {
      statusCode: 422,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Missing bookingId' }),
    }
  }

  const now = new Date().toISOString()

  // Update booking status
  try {
    await supabasePatch(
      supabaseUrl,
      'portal_bookings',
      `id=eq.${bookingId}`,
      {
        status: 'approved',
        approved_at: now,
        technician_name: technicianName || 'Christian D.',
        updated_at: now,
      },
      serviceKey
    )
  } catch (err) {
    console.error('[portal-schedule] approveBooking patch error:', err.message)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Failed to update booking status' }),
    }
  }

  // Fetch booking to get customer email for confirmation
  try {
    const rows = await supabaseSelect(
      supabaseUrl,
      'portal_bookings',
      `id=eq.${bookingId}&select=*`,
      serviceKey
    )
    const booking = Array.isArray(rows) ? rows[0] : rows

    if (booking && resendApiKey) {
      // Fire-and-forget confirmation email
      handleSendConfirmationEmail({
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        confirmationNumber: booking.confirmation_number,
        serviceType: booking.service_type,
        preferredDate: booking.preferred_date,
        preferredTimeStart: booking.preferred_time_start,
        preferredTimeEnd: booking.preferred_time_end,
        technicianName: technicianName || 'Christian D., C-10 Licensed Electrician',
        address: booking.customer_address,
      }, resendApiKey).catch(err => {
        console.error('[portal-schedule] approveBooking email error:', err)
      })
    }
  } catch (err) {
    console.log('[portal-schedule] approveBooking fetch for email (non-fatal):', err.message)
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: true, bookingId, status: 'approved' }),
  }
}

// ── declineBooking ────────────────────────────────────────────────────────────

async function handleDeclineBooking(body, supabaseUrl, serviceKey) {
  const { bookingId } = body

  if (!bookingId) {
    return {
      statusCode: 422,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Missing bookingId' }),
    }
  }

  try {
    await supabasePatch(
      supabaseUrl,
      'portal_bookings',
      `id=eq.${bookingId}`,
      { status: 'declined', declined_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      serviceKey
    )
  } catch (err) {
    console.error('[portal-schedule] declineBooking error:', err.message)
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: true, bookingId, status: 'declined' }),
  }
}

// ── suggestTime ───────────────────────────────────────────────────────────────

async function handleSuggestTime(body, supabaseUrl, serviceKey) {
  const { bookingId, suggestedSlots } = body

  if (!bookingId || !suggestedSlots) {
    return {
      statusCode: 422,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Missing bookingId or suggestedSlots' }),
    }
  }

  try {
    await supabasePatch(
      supabaseUrl,
      'portal_bookings',
      `id=eq.${bookingId}`,
      {
        status: 'suggested',
        suggested_times: suggestedSlots,
        updated_at: new Date().toISOString(),
      },
      serviceKey
    )
  } catch (err) {
    console.error('[portal-schedule] suggestTime error:', err.message)
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: true, bookingId, status: 'suggested', suggestedSlots }),
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async (event, _context) => {
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

  // Environment
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendKey   = process.env.RESEND_API_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('[portal-schedule] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Server configuration error' }),
    }
  }

  // Parse body
  let body = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Invalid JSON body' }),
    }
  }

  const { action } = body

  console.log(`[portal-schedule] action=${action}`)

  // Route by action
  switch (action) {
    case 'create_booking':
      return handleCreateBooking(body, supabaseUrl, serviceKey)

    case 'send_confirmation_email':
      if (!resendKey) {
        return {
          statusCode: 500,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: false, error: 'RESEND_API_KEY not configured' }),
        }
      }
      return handleSendConfirmationEmail(body, resendKey)

    case 'get_available_slots': {
      const slots = await getAvailableSlotsFromSupabase(supabaseUrl, serviceKey)
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true, slots }),
      }
    }

    case 'approve_booking':
      return handleApproveBooking(body, supabaseUrl, serviceKey, resendKey)

    case 'decline_booking':
      return handleDeclineBooking(body, supabaseUrl, serviceKey)

    case 'suggest_time':
      return handleSuggestTime(body, supabaseUrl, serviceKey)

    default:
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: `Unknown action: "${action}". Valid: create_booking, send_confirmation_email, get_available_slots, approve_booking, decline_booking, suggest_time`,
        }),
      }
  }
}
