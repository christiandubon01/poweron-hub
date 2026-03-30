// @ts-nocheck
/**
 * Netlify Function — Email Sender via Resend
 *
 * POST { to, subject, body, from? }
 *   → Sends transactional email via Resend API
 *   → Returns { success: boolean, messageId?: string, error?: string }
 *
 * Requires RESEND_API_KEY environment variable.
 * Default from address: noreply@poweronsolutions.com
 */

const RESEND_API_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM   = 'Power On Solutions <noreply@poweronsolutions.com>'

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

  const { to, subject, body: emailBody, from } = body as any

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
