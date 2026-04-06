// @ts-nocheck
/**
 * Netlify Function — Email Sender via Resend
 *
 * POST { to, subject, body, from? }
 *   → Sends transactional email via Resend API
 *   → Returns { success: boolean, messageId?: string, error?: string }
 *
 * POST { to, type: 'nda_pin' }
 *   → Generates a 6-digit PIN, stores it in a signed JWT (10-min TTL),
 *     sends email via Resend with subject 'PowerOn Hub — NDA Confirmation Code'
 *   → Returns { success: boolean, pinToken: string, error?: string }
 *
 * Requires RESEND_API_KEY environment variable.
 * Optional JWT_SECRET environment variable (falls back to default).
 * Default from address: noreply@poweronsolutions.com
 */

const crypto = require('crypto')

const RESEND_API_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM   = 'Power On Solutions <noreply@poweronsolutions.com>'

// ── PIN JWT helpers ────────────────────────────────────────────────────────────

function createPinJwt(email, pin) {
  const secret = process.env.JWT_SECRET || 'poweron-nda-pin-secret'
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    email,
    pin,
    exp: Math.floor(Date.now() / 1000) + 600, // 10-minute TTL
  })).toString('base64url')
  const data = `${header}.${payload}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

async function handleNdaPinRequest(to, apiKey) {
  if (!to || typeof to !== 'string' || !to.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Invalid email address' }),
    }
  }

  // Generate 6-digit PIN
  const pin = String(Math.floor(100000 + crypto.randomInt(900000))).padStart(6, '0')
  const pinToken = createPinJwt(to, pin)

  const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #222; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb;">
  <div style="background: #fff; border-radius: 8px; padding: 32px; border: 1px solid #e5e7eb;">
    <h2 style="margin: 0 0 8px 0; font-size: 20px; color: #111;">PowerOn Hub — NDA Confirmation Code</h2>
    <p style="margin: 0 0 24px 0; color: #6b7280; font-size: 14px;">Use the code below to verify your email and complete the NDA signing process.</p>
    <div style="background: #f3f4f6; border-radius: 8px; padding: 24px; text-align: center; margin: 0 0 24px 0;">
      <span style="font-size: 36px; font-weight: 700; letter-spacing: 0.25em; color: #111; font-family: monospace;">${pin}</span>
    </div>
    <p style="margin: 0 0 8px 0; font-size: 13px; color: #6b7280;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
    <p style="margin: 0; font-size: 13px; color: #6b7280;">If you did not request this code, you can safely ignore this email.</p>
  </div>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="font-size: 12px; color: #888; margin: 0;">
    Power On Solutions LLC · C-10 License #1151468 · Desert Hot Springs, CA<br>
    Coachella Valley Electrical Contractor
  </p>
</body>
</html>`

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: DEFAULT_FROM,
        to: [to],
        subject: 'PowerOn Hub \u2014 NDA Confirmation Code',
        html: emailHtml,
        text: `PowerOn Hub — NDA Confirmation Code\n\nYour confirmation code is: ${pin}\n\nThis code expires in 10 minutes. Do not share it with anyone.\n\nPower On Solutions LLC`,
      }),
    })

    const resData = await res.json()
    if (!res.ok) {
      console.error('[sendEmail/nda_pin] Resend error:', res.status, resData)
      return {
        statusCode: res.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: resData?.message || `Resend API error ${res.status}` }),
      }
    }

    console.log('[sendEmail/nda_pin] PIN email sent to:', to)
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, pinToken }),
    }
  } catch (err) {
    console.error('[sendEmail/nda_pin] Handler error:', err)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: err.message || 'Internal server error' }),
    }
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

exports.handler = async (event: any, _context: any) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  // Only POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'RESEND_API_KEY not configured. Add it in Netlify → Site settings → Environment variables.',
      }),
    }
  }

  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Invalid JSON body' }),
    }
  }

  const { to, subject, body: emailBody, from, type } = body as any

  // ── NDA PIN request — branch before standard validation ───────────────────
  if (type === 'nda_pin') {
    return handleNdaPinRequest(to, apiKey)
  }

  // Validate required fields
  if (!to || !subject || !emailBody) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Missing required fields: to, subject, body' }),
    }
  }

  // Normalize "to" — accept string or array
  const recipients: string[] = Array.isArray(to) ? to : [to]

  try {
    const resendPayload = {
      from:    from || DEFAULT_FROM,
      to:      recipients,
      subject: subject,
      html:    convertToHtml(emailBody as string),
      text:    emailBody as string,
    }

    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload),
    })

    const resData = await res.json()

    if (!res.ok) {
      console.error('[sendEmail] Resend API error:', res.status, resData)
      return {
        statusCode: res.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: resData?.message || `Resend API error ${res.status}`,
        }),
      }
    }

    console.log('[sendEmail] Email sent successfully:', resData.id)
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        messageId: resData.id,
      }),
    }
  } catch (err: any) {
    console.error('[sendEmail] Handler error:', err)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: err.message || 'Internal server error' }),
    }
  }
}

// ── HTML conversion ────────────────────────────────────────────────────────

/**
 * Converts plain text email body to a basic HTML email.
 * Wraps paragraphs and preserves line breaks.
 */
function convertToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const paragraphs = escaped
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 12px 0;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #222; max-width: 600px; margin: 0 auto; padding: 24px;">
  ${paragraphs}
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="font-size: 12px; color: #888; margin: 0;">
    Power On Solutions LLC · C-10 License #1151468 · Desert Hot Springs, CA<br>
    Coachella Valley Electrical Contractor
  </p>
</body>
</html>`
}
