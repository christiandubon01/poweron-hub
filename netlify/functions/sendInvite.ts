// @ts-nocheck
/**
 * Netlify Function — Beta Invite Sender
 *
 * POST { email, industry, invitedBy }
 *   → Generates a UUID invite_token
 *   → Inserts row into beta_invites (via Supabase service key)
 *   → Sends invite email to the invitee via Resend
 *   → Sends notification email to app@poweronsolutionsllc.com
 *   → Returns { success: boolean, inviteId?: string, error?: string }
 *
 * Requires env vars:
 *   RESEND_API_KEY
 *   SUPABASE_URL  (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const crypto = require('crypto')

const RESEND_API_URL  = 'https://api.resend.com/emails'
const DEFAULT_FROM    = 'Power On Solutions <noreply@poweronsolutions.com>'
const NOTIFY_EMAIL    = 'app@poweronsolutionsllc.com'
const APP_BASE_URL    = 'https://incomparable-croissant-a86c81.netlify.app'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

// ── Supabase REST helper ───────────────────────────────────────────────────────

async function supabaseInsert(url: string, serviceKey: string, table: string, row: object) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey:          serviceKey,
      Authorization:   `Bearer ${serviceKey}`,
      'Content-Type':  'application/json',
      Prefer:          'return=representation',
    },
    body: JSON.stringify(row),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Supabase insert error ${res.status}`)
  }
  return Array.isArray(data) ? data[0] : data
}

// ── Email HTML ─────────────────────────────────────────────────────────────────

function buildInviteHtml(inviteLink: string, industry: string | null): string {
  const industryLine = industry
    ? `<p style="margin:0 0 12px 0; color:#4b5563; font-size:14px;">Industry: <strong>${industry}</strong></p>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #111; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb;">
  <div style="background: #fff; border-radius: 10px; padding: 36px 32px; border: 1px solid #e5e7eb;">

    <h2 style="margin: 0 0 6px 0; font-size: 22px; color: #111; font-weight: 700;">
      You've been invited to PowerOn Hub Beta
    </h2>
    <p style="margin: 0 0 20px 0; color: #6b7280; font-size: 13px;">
      Power On Solutions LLC · C-10 License #1151468 · Desert Hot Springs, CA
    </p>

    <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 0 0 20px 0;">

    <p style="margin: 0 0 16px 0; line-height: 1.6; color: #374151;">
      <strong>PowerOn Hub</strong> is an intelligent business operating system built for electrical contractors.
      It gives you real-time visibility into your projects, finances, crew, and field operations — all in one
      place, powered by AI agents that learn how you work.
    </p>

    <p style="margin: 0 0 16px 0; line-height: 1.6; color: #374151;">
      You've been selected for <strong>early beta access</strong>. Beta users help shape the product
      before it's publicly available. You may encounter rough edges, and we'll ask for your feedback regularly.
    </p>

    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 0 0 20px 0;">
      <p style="margin: 0; font-size: 13px; color: #92400e; line-height: 1.5;">
        <strong>⚠ NDA Requirement:</strong> Beta access requires signing a Non-Disclosure Agreement.
        You will be prompted to sign it when you first log in. Do not share screenshots, feature details,
        or pricing information with anyone outside your organization.
      </p>
    </div>

    ${industryLine}

    <p style="margin: 0 0 24px 0; color: #374151; font-size: 14px;">
      Your invite link is valid for <strong>7 days</strong>. Click the button below to get started:
    </p>

    <div style="text-align: center; margin: 0 0 28px 0;">
      <a
        href="${inviteLink}"
        style="
          display: inline-block;
          background: #16a34a;
          color: #fff;
          font-size: 15px;
          font-weight: 700;
          text-decoration: none;
          padding: 14px 36px;
          border-radius: 8px;
          letter-spacing: 0.02em;
        "
      >
        Accept Invite &amp; Sign In
      </a>
    </div>

    <p style="margin: 0; font-size: 12px; color: #9ca3af; line-height: 1.6;">
      Or copy this link into your browser:<br>
      <span style="font-family: monospace; color: #6b7280; word-break: break-all;">${inviteLink}</span>
    </p>

  </div>

  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="font-size: 12px; color: #9ca3af; margin: 0; text-align: center;">
    Power On Solutions LLC · C-10 License #1151468 · Desert Hot Springs, CA<br>
    Coachella Valley Electrical Contractor
  </p>
</body>
</html>`
}

// ── Notification email to owner ────────────────────────────────────────────────

function buildNotificationHtml(email: string, industry: string | null, inviteLink: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; font-size: 14px; color: #111; max-width: 500px; margin: 0 auto; padding: 24px;">
  <h3 style="margin: 0 0 12px 0;">Beta Invite Sent</h3>
  <p style="margin: 0 0 8px 0;"><strong>To:</strong> ${email}</p>
  ${industry ? `<p style="margin: 0 0 8px 0;"><strong>Industry:</strong> ${industry}</p>` : ''}
  <p style="margin: 0 0 8px 0;"><strong>Link:</strong> <a href="${inviteLink}">${inviteLink}</a></p>
  <p style="margin: 0; color: #6b7280; font-size: 12px;">Sent via PowerOn Hub → GUARDIAN → Beta Invites</p>
</body>
</html>`
}

// ── Resend helper ──────────────────────────────────────────────────────────────

async function sendEmail(apiKey: string, payload: {
  to: string | string[]
  subject: string
  html: string
  text: string
}) {
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: DEFAULT_FROM,
      to:   Array.isArray(payload.to) ? payload.to : [payload.to],
      subject: payload.subject,
      html:    payload.html,
      text:    payload.text,
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.message || `Resend error ${res.status}`)
  }
  return data
}

// ── Handler ────────────────────────────────────────────────────────────────────

exports.handler = async (event: any) => {
  // Preflight
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

  // Env checks
  const resendKey    = process.env.RESEND_API_KEY
  const supabaseUrl  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!resendKey || !supabaseUrl || !serviceKey) {
    const missing = [
      !resendKey   && 'RESEND_API_KEY',
      !supabaseUrl && 'SUPABASE_URL',
      !serviceKey  && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter(Boolean).join(', ')
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: `Missing env vars: ${missing}` }),
    }
  }

  // Parse body
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

  const { email, industry, invitedBy } = body as {
    email?: string
    industry?: string
    invitedBy?: string
  }

  // Validate email
  if (!email || typeof email !== 'string' || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Invalid or missing email address' }),
    }
  }

  try {
    // 1. Generate unique invite token
    const inviteToken = crypto.randomUUID()
    const inviteLink  = `${APP_BASE_URL}?invite=${inviteToken}`

    // 2. Insert row into beta_invites
    const row: Record<string, unknown> = {
      email,
      invite_token: inviteToken,
      status:       'pending',
    }
    if (industry)  row.industry   = industry
    if (invitedBy) row.invited_by = invitedBy

    const inserted = await supabaseInsert(supabaseUrl, serviceKey, 'beta_invites', row)
    const inviteId = inserted?.id as string | undefined

    // 3. Send invite email to invitee
    await sendEmail(resendKey, {
      to:      email,
      subject: 'You have been invited to PowerOn Hub Beta',
      html:    buildInviteHtml(inviteLink, industry || null),
      text: [
        'You have been invited to PowerOn Hub Beta',
        '',
        'PowerOn Hub is an intelligent business OS for electrical contractors.',
        'You have been selected for early beta access.',
        '',
        'IMPORTANT: Beta access requires signing a Non-Disclosure Agreement.',
        'You will be prompted to sign it when you first log in.',
        '',
        `Accept your invitation here:\n${inviteLink}`,
        '',
        'This link expires in 7 days.',
        '',
        'Power On Solutions LLC · C-10 License #1151468 · Desert Hot Springs, CA',
      ].join('\n'),
    })

    // 4. Send notification to owner
    try {
      await sendEmail(resendKey, {
        to:      NOTIFY_EMAIL,
        subject: `[PowerOn Hub] Beta invite sent to ${email}`,
        html:    buildNotificationHtml(email, industry || null, inviteLink),
        text:    `Beta invite sent to: ${email}${industry ? `\nIndustry: ${industry}` : ''}\nLink: ${inviteLink}`,
      })
    } catch (notifyErr) {
      // Non-fatal — log but don't fail the whole request
      console.warn('[sendInvite] Notification email failed:', notifyErr)
    }

    console.log(`[sendInvite] Invite sent to ${email}, id=${inviteId}, token=${inviteToken}`)

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, inviteId, inviteToken }),
    }
  } catch (err: any) {
    console.error('[sendInvite] Error:', err)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: err.message || 'Internal server error' }),
    }
  }
}
