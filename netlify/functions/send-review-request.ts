// @ts-nocheck
/**
 * Netlify Function - Send portal review request email
 *
 * POST { portal_request_id, email?, force? }
 *
 * Sends one honest-feedback Google review request after work is completed.
 * Uses portal_requests + job_timeline only. Does not touch legacy portal_leads
 * or customer_bookings.
 */

const RESEND_API_URL = 'https://api.resend.com/emails'
const FROM_ADDRESS = 'Power On Solutions <app@poweronsolutionsllc.com>'
const REVIEW_URL = 'https://g.page/r/CUEzgRLMP1cbEBM/review'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

function esc(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

async function supabaseFetch(path, method, body) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return { data: null, error: 'Supabase not configured' }
  }

  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  if (!res.ok) {
    return { data: null, error: `Supabase error ${res.status}: ${text}` }
  }

  return { data, error: null }
}

async function getPortalRequest(portalRequestId) {
  const path = `portal_requests?id=eq.${encodeURIComponent(portalRequestId)}&select=*`
  const { data, error } = await supabaseFetch(path, 'GET')
  if (error) return { request: null, error }
  const rows = Array.isArray(data) ? data : []
  return { request: rows[0] || null, error: rows[0] ? null : 'Portal request not found' }
}

async function hasWorkCompletedEvent(portalRequestId) {
  const path = `job_timeline?portal_request_id=eq.${encodeURIComponent(portalRequestId)}&event_type=eq.work_completed&select=id&limit=1`
  const { data, error } = await supabaseFetch(path, 'GET')
  if (error) return false
  return Array.isArray(data) && data.length > 0
}

async function patchPortalRequest(portalRequestId, patch) {
  const path = `portal_requests?id=eq.${encodeURIComponent(portalRequestId)}`
  const { data, error } = await supabaseFetch(path, 'PATCH', patch)
  const rows = Array.isArray(data) ? data : []
  return { request: rows[0] || null, error }
}

function buildText(name) {
  const firstName = String(name || 'there').trim().split(/\s+/)[0] || 'there'
  return `Hi ${firstName},

Thank you for allowing Power On Solutions to serve you at your property.

If you feel our service was worth a review, it would mean the world to us if you could share your honest feedback on Google. No pressure at all — either way, we appreciate the opportunity to help and we're grateful you trusted us with your electrical work.

Leave a Google Review:
${REVIEW_URL}

Your feedback helps local customers know what to expect when choosing Power On Solutions.

---
Power On Solutions, LLC
C-10 Licensed · California
(760) 623-8962`
}

function buildHtml(name) {
  const firstName = String(name || 'there').trim().split(/\s+/)[0] || 'there'
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Thank you — Power On Solutions</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#0f172a;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Card -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600"
               style="max-width:600px;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">

          <!-- Header bar -->
          <tr>
            <td style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);padding:6px 0;text-align:center;">
              <span style="font-size:11px;font-weight:700;letter-spacing:0.15em;color:#0f172a;text-transform:uppercase;">
                Power On Solutions LLC · C-10 Licensed · CA
              </span>
            </td>
          </tr>

          <!-- Logo / brand row -->
          <tr>
            <td style="padding:36px 40px 24px;text-align:center;border-bottom:1px solid #334155;">
              <img src="https://edxxbtyugohtowvslbfo.supabase.co/storage/v1/object/public/brand-assets/ChatGPT%20Image%20Jan%2030,%202026,%2010_40_53%20AM1.png"
                   alt="Power On Solutions LLC" width="240" height="59"
                   style="display:block;margin:0 auto 16px;height:59px;width:240px;object-fit:contain;" />
              <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#f8fafc;">
                Thank you for choosing Power On Solutions
              </h1>
              <p style="margin:0;font-size:15px;color:#94a3b8;">
                We appreciate you trusting us with your electrical work
              </p>
            </td>
          </tr>

          <!-- Greeting / body -->
          <tr>
            <td style="padding:28px 40px 20px;">
              <p style="margin:0 0 16px;font-size:16px;color:#e2e8f0;">
                Hi ${esc(firstName)},
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#94a3b8;line-height:1.65;">
                Thank you for allowing Power On Solutions to serve you at your property.
              </p>
              <p style="margin:0;font-size:15px;color:#94a3b8;line-height:1.65;">
                If you feel our service was worth a review, it would mean the world to us if you could
                share your honest feedback on Google. No pressure at all &mdash; either way, we appreciate
                the opportunity to help and we&rsquo;re grateful you trusted us with your electrical work.
              </p>
            </td>
          </tr>

          <!-- CTA button -->
          <tr>
            <td style="padding:0 40px 12px;text-align:center;">
              <a href="${REVIEW_URL}"
                 style="display:inline-block;background:#16a34a;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;border-radius:8px;padding:14px 32px;letter-spacing:0.01em;">
                Leave a Google Review
              </a>
            </td>
          </tr>

          <!-- Note under button -->
          <tr>
            <td style="padding:0 40px 32px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">
                Your feedback helps local customers know what to expect when choosing Power On Solutions.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#0f172a;padding:20px 40px;border-top:1px solid #1e293b;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:#475569;">Power On Solutions, LLC</p>
              <p style="margin:0 0 4px;font-size:12px;color:#475569;">C-10 Licensed &bull; California</p>
              <p style="margin:0;font-size:12px;color:#475569;">(760) 623-8962</p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
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

  const portalRequestId = body.portal_request_id || body.portalRequestId
  const force = body.force === true
  if (!portalRequestId) {
    return {
      statusCode: 422,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'portal_request_id is required' }),
    }
  }

  const { request, error: requestError } = await getPortalRequest(portalRequestId)
  if (requestError || !request) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: requestError || 'Portal request not found' }),
    }
  }

  if (request.review_requested_at && !force) {
    return {
      statusCode: 409,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        alreadySent: true,
        error: 'Review request already sent',
        request,
      }),
    }
  }

  const completed = request.status === 'closed' || request.completed_at || await hasWorkCompletedEvent(portalRequestId)
  if (!completed) {
    return {
      statusCode: 409,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Work must be completed before sending a review request' }),
    }
  }

  const email = normalizeEmail(body.email || request.email)
  if (!isEmail(email)) {
    return {
      statusCode: 422,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'A valid customer email is required' }),
    }
  }

  const attemptAt = new Date().toISOString()
  await patchPortalRequest(portalRequestId, {
    email,
    review_request_last_attempt_at: attemptAt,
    review_request_status: 'sending',
    review_request_error: null,
  })

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [email],
        subject: 'Thank you for choosing Power On Solutions',
        html: buildHtml(request.name),
        text: buildText(request.name),
      }),
    })

    const resData = await res.json().catch(() => ({}))
    if (!res.ok) {
      const errorMessage = resData?.message || `Resend error ${res.status}`
      await patchPortalRequest(portalRequestId, {
        review_request_last_attempt_at: new Date().toISOString(),
        review_request_status: 'failed',
        review_request_error: errorMessage,
      })
      return {
        statusCode: res.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: errorMessage }),
      }
    }

    const { request: updatedRequest } = await patchPortalRequest(portalRequestId, {
      email,
      review_requested_at: new Date().toISOString(),
      review_request_sent_to: email,
      review_request_status: 'sent',
      review_request_error: null,
      review_request_last_attempt_at: new Date().toISOString(),
    })

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        messageId: resData.id,
        sentTo: email,
        request: updatedRequest,
      }),
    }
  } catch (err) {
    const errorMessage = err?.message || 'Internal server error sending review request'
    await patchPortalRequest(portalRequestId, {
      review_request_last_attempt_at: new Date().toISOString(),
      review_request_status: 'failed',
      review_request_error: errorMessage,
    })
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: errorMessage }),
    }
  }
}

