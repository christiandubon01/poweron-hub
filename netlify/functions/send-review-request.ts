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

Thank you for trusting Power On Solutions with your electrical project. If you have a moment, we would appreciate your honest feedback about your experience.

You can leave a Google review here:
${REVIEW_URL}

Thank you again,
Power On Solutions, LLC
(760) 623-8962`
}

function buildHtml(name) {
  const text = buildText(name)
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px;">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#166534;margin-bottom:18px;">Power On Solutions, LLC</div>
      <p style="white-space:pre-line;font-size:15px;line-height:1.65;color:#1f2937;margin:0 0 22px;">${esc(text)}</p>
      <a href="${REVIEW_URL}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;border-radius:8px;padding:12px 18px;">Leave honest feedback</a>
    </div>
  </div>
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
        subject: 'Thank you from Power On Solutions',
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

