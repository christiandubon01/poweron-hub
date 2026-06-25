// @ts-nocheck
/**
 * Netlify Function - Internal New Portal Lead Notification
 *
 * POST {
 *   requestId, name, phone, email, address, city,
 *   serviceCategory, requestType, description,
 *   preferredDate, preferredTime, source,
 *   attribution, notes, submittedAt
 * }
 *   Sends notification email to app@poweronsolutionsllc.com
 *   Subject: "New Portal Lead - {name} | {serviceCategory}"
 *
 * Called by CustomerPortalView after a successful portal_requests insert.
 * Fire-and-forget - lead creation never depends on this call succeeding.
 *
 * Requires RESEND_API_KEY environment variable.
 */

const RESEND_API_URL = 'https://api.resend.com/emails'
const FROM_ADDRESS   = 'Power On Solutions <app@poweronsolutionsllc.com>'
const NOTIFY_EMAIL   = 'app@poweronsolutionsllc.com'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

const SERVICE_LABELS = {
  residential:   'Residential',
  commercial:    'Commercial',
  solar:         'Solar / PV',
  maintenance:   'Maintenance & Service',
  panel_upgrade: 'Panel Upgrade',
  ev_charger:    'EV Charger Installation',
  other:         'Other',
}

function esc(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function row(label, value) {
  if (!value) return ''
  return `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;width:36%;vertical-align:top;">${esc(label)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#111;font-size:13px;font-weight:600;">${esc(String(value))}</td>
    </tr>`
}

function buildHtml({
  requestId, name, phone, email, address, city,
  serviceCategory, requestType, description,
  preferredDate, preferredTime, source,
  attribution, notes, submittedAt,
}) {
  const serviceLabel = SERVICE_LABELS[serviceCategory] || serviceCategory || 'Unknown'

  const formattedDate = (() => {
    try {
      return new Date(submittedAt).toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Los_Angeles', timeZoneName: 'short',
      })
    } catch { return submittedAt || '' }
  })()

  // Strip attribution prefix from notes string for clean display
  let mainNotes = notes || ''
  const attrMarker = 'Attribution: '
  const nlIdx = mainNotes.indexOf('\n' + attrMarker)
  if (nlIdx !== -1) {
    mainNotes = mainNotes.slice(0, nlIdx)
  } else if (mainNotes.startsWith(attrMarker)) {
    mainNotes = ''
  }

  // Build attribution rows from the structured object (preferred) or fall back to notes
  const attrObj = attribution && typeof attribution === 'object' ? attribution : {}
  const attrEntries = Object.entries(attrObj).filter(([, v]) => v)

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:580px;margin:0 auto;padding:24px;background:#f9fafb;">
  <div style="background:#fff;border-radius:10px;padding:32px;border:1px solid #e5e7eb;">

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      <div style="width:10px;height:10px;background:#16a34a;border-radius:50%;flex-shrink:0;"></div>
      <h2 style="margin:0;font-size:17px;font-weight:700;color:#111;">New Portal Lead</h2>
      <span style="margin-left:auto;background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;border:1px solid #fde68a;">${esc(serviceLabel)}</span>
    </div>

    <p style="margin:0 0 20px;color:#4b5563;font-size:13px;">
      A new <strong>${esc(requestType || 'portal')}</strong> request was submitted on Power On Solutions.
    </p>

    <table style="width:100%;border-collapse:collapse;">
      ${row('Name', name)}
      ${row('Phone', phone)}
      ${row('Email', email)}
      ${row('Address', address)}
      ${row('City', city)}
      ${row('Service', serviceLabel)}
      ${row('Request Type', requestType)}
      ${row('Preferred Date', preferredDate)}
      ${row('Preferred Time', preferredTime)}
      ${row('Submitted', formattedDate)}
      ${row('Request ID', requestId)}
    </table>

    ${description ? `
    <div style="margin-top:16px;padding:12px 16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.06em;color:#6b7280;text-transform:uppercase;">Description</p>
      <p style="margin:0;font-size:13px;color:#374151;white-space:pre-wrap;">${esc(description)}</p>
    </div>` : ''}

    ${mainNotes ? `
    <div style="margin-top:12px;padding:12px 16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.06em;color:#6b7280;text-transform:uppercase;">Notes</p>
      <p style="margin:0;font-size:13px;color:#374151;white-space:pre-wrap;">${esc(mainNotes)}</p>
    </div>` : ''}

    ${attrEntries.length ? `
    <div style="margin-top:12px;padding:12px 16px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.06em;color:#166534;text-transform:uppercase;">Attribution</p>
      <table style="width:100%;border-collapse:collapse;">
        ${attrEntries.map(([k, v]) => `
        <tr>
          <td style="padding:3px 0;color:#6b7280;font-size:11px;font-family:monospace;width:34%;vertical-align:top;">${esc(k)}</td>
          <td style="padding:3px 0;color:#166534;font-size:11px;font-family:monospace;word-break:break-all;">${esc(String(v))}</td>
        </tr>`).join('')}
      </table>
    </div>` : ''}

    <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">
      Sent automatically when a customer submits the portal request form.
    </p>
  </div>
  <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
  <p style="font-size:11px;color:#9ca3af;margin:0;text-align:center;">
    Power On Solutions LLC | C-10 License #1151468 | PowerOn Hub
  </p>
</body>
</html>`
}

exports.handler = async (event) => {
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

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[notify-new-lead] RESEND_API_KEY not set')
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'RESEND_API_KEY not configured' }),
    }
  }

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

  const {
    requestId       = '',
    name            = '',
    phone           = null,
    email           = null,
    address         = null,
    city            = null,
    serviceCategory = '',
    requestType     = 'portal',
    description     = null,
    preferredDate   = null,
    preferredTime   = null,
    source          = 'customer_portal',
    attribution     = null,
    notes           = null,
    submittedAt     = new Date().toISOString(),
  } = body

  const serviceLabel = SERVICE_LABELS[serviceCategory] || serviceCategory || 'Unknown'
  const displayName  = String(name).trim() || 'Unknown'
  const subject      = `New Portal Lead - ${displayName} | ${serviceLabel}`

  const textLines = [
    'New Portal Lead',
    '',
    `Name:           ${name || '-'}`,
    `Phone:          ${phone || '-'}`,
    `Email:          ${email || '-'}`,
    `Address:        ${address || '-'}`,
    `City:           ${city || '-'}`,
    `Service:        ${serviceLabel}`,
    `Request Type:   ${requestType}`,
    `Preferred Date: ${preferredDate || '-'}`,
    `Preferred Time: ${preferredTime || '-'}`,
    `Submitted:      ${submittedAt}`,
    `Request ID:     ${requestId}`,
    `Source:         ${source}`,
  ]

  if (description) {
    textLines.push('', 'Description:', description)
  }

  if (notes) {
    textLines.push('', 'Notes:', notes)
  }

  if (attribution && typeof attribution === 'object') {
    const attrLines = Object.entries(attribution)
      .filter(([, v]) => v)
      .map(([k, v]) => `  ${k}=${v}`)
    if (attrLines.length) {
      textLines.push('', 'Attribution:', ...attrLines)
    }
  }

  textLines.push('', '---', 'Power On Solutions LLC | PowerOn Hub')

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    FROM_ADDRESS,
        to:      [NOTIFY_EMAIL],
        subject,
        html:    buildHtml({
          requestId, name, phone, email, address, city,
          serviceCategory, requestType, description,
          preferredDate, preferredTime, source,
          attribution, notes, submittedAt,
        }),
        text: textLines.join('\n'),
      }),
    })

    const resData = await res.json()

    if (!res.ok) {
      console.error('[notify-new-lead] Resend error:', res.status, resData)
      return {
        statusCode: res.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: resData?.message || `Resend error ${res.status}` }),
      }
    }

    console.log('[notify-new-lead] Sent for request:', requestId, '| messageId:', resData.id)
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, messageId: resData.id }),
    }
  } catch (err) {
    console.error('[notify-new-lead] Handler error:', err)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: err.message || 'Internal server error' }),
    }
  }
}
