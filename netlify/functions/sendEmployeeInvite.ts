// @ts-nocheck
/**
 * Netlify Function — Employee Time Tracking Invite Sender
 *
 * POST { displayName, email, employmentType?, role? }
 *   Authorization: Bearer <supabase access token>
 *   → Verifies caller is owner/admin via profiles
 *   → Inserts employee_profiles row (service role)
 *   → Sends invite email via Resend
 *   → Returns { success, inviteId, email }
 *
 * Requires env vars:
 *   RESEND_API_KEY
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) — JWT verification
 */

const crypto = require('crypto')

const RESEND_API_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM   = 'Power On Solutions <noreply@poweronsolutions.com>'
const APP_BASE_URL   = 'https://incomparable-croissant-a86c81.netlify.app'

const VALID_ROLES = new Set(['employee', 'foreman'])
const VALID_EMPLOYMENT_TYPES = new Set([
  'full_time',
  'part_time',
  'subcontractor',
  'helper',
])

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type':                   'application/json',
}

// ── Supabase REST helpers ─────────────────────────────────────────────────────

async function supabaseInsert(url, serviceKey, table, row) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method:  'POST',
    headers: {
      apikey:         serviceKey,
      Authorization:  `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer:         'return=representation',
    },
    body: JSON.stringify(row),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Supabase insert error ${res.status}`)
  }
  return Array.isArray(data) ? data[0] : data
}

async function supabaseSelectProfile(url, serviceKey, userId) {
  const res = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=org_id,role&limit=1`,
    {
      headers: {
        apikey:        serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    },
  )
  if (!res.ok) return null
  const data = await res.json()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

async function verifyAccessToken(supabaseUrl, anonKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey:        anonKey,
    },
  })
  if (!res.ok) return null
  const data = await res.json()
  if (data?.id) return data
  if (data?.user?.id) return data.user
  return null
}

function resolveBaseUrl(event) {
  const envUrl =
    process.env.APP_BASE_URL ||
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL
  if (envUrl) return envUrl.replace(/\/$/, '')

  const host = event?.headers?.['x-forwarded-host'] || event?.headers?.host
  const proto = event?.headers?.['x-forwarded-proto'] || 'https'
  if (host) return `${proto}://${host}`.replace(/\/$/, '')

  return APP_BASE_URL
}

function parseBearerToken(event) {
  const header =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

// ── Email HTML ─────────────────────────────────────────────────────────────────

function buildEmployeeInviteHtml(inviteLink, displayName, orgName) {
  const greeting = displayName
    ? `Hi ${displayName},`
    : 'Hello,'

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #111; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb;">
  <div style="background: #fff; border-radius: 10px; padding: 36px 32px; border: 1px solid #e5e7eb;">

    <h2 style="margin: 0 0 6px 0; font-size: 22px; color: #111; font-weight: 700;">
      You're invited to Power On employee time tracking
    </h2>
    <p style="margin: 0 0 20px 0; color: #6b7280; font-size: 13px;">
      Power On Solutions LLC · C-10 License #1151468 · Desert Hot Springs, CA
    </p>

    <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 0 0 20px 0;">

    <p style="margin: 0 0 16px 0; line-height: 1.6; color: #374151;">
      ${greeting}
    </p>

    <p style="margin: 0 0 16px 0; line-height: 1.6; color: #374151;">
      <strong>${orgName || 'Your employer'}</strong> has invited you to use the
      <strong>Power On employee portal</strong> for clock-in and clock-out time tracking
      from your phone or computer.
    </p>

    <p style="margin: 0 0 24px 0; color: #374151; font-size: 14px;">
      Click the button below to create your account or sign in and accept the invite:
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
        Accept Employee Invite
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

async function sendEmail(apiKey, payload) {
  const res = await fetch(RESEND_API_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    DEFAULT_FROM,
      to:      Array.isArray(payload.to) ? payload.to : [payload.to],
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: false, error: 'Method not allowed' }),
    }
  }

  const resendKey   = process.env.RESEND_API_KEY
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey     =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY

  if (!resendKey || !supabaseUrl || !serviceKey || !anonKey) {
    const missing = [
      !resendKey   && 'RESEND_API_KEY',
      !supabaseUrl && 'SUPABASE_URL',
      !serviceKey  && 'SUPABASE_SERVICE_ROLE_KEY',
      !anonKey     && 'SUPABASE_ANON_KEY',
    ].filter(Boolean).join(', ')
    return {
      statusCode: 500,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: false, error: `Missing env vars: ${missing}` }),
    }
  }

  const accessToken = parseBearerToken(event)
  if (!accessToken) {
    return {
      statusCode: 401,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: false, error: 'Missing or invalid authorization' }),
    }
  }

  const authUser = await verifyAccessToken(supabaseUrl, anonKey, accessToken)
  if (!authUser?.id) {
    return {
      statusCode: 401,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: false, error: 'Invalid or expired session' }),
    }
  }

  const profile = await supabaseSelectProfile(supabaseUrl, serviceKey, authUser.id)
  if (!profile?.org_id || !['owner', 'admin'].includes(profile.role)) {
    return {
      statusCode: 403,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: false, error: 'Only owners and admins can send employee invites' }),
    }
  }

  let body = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return {
      statusCode: 400,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: false, error: 'Invalid JSON body' }),
    }
  }

  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  const emailRaw    = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const role        = VALID_ROLES.has(body.role) ? body.role : 'employee'
  const employmentType = VALID_EMPLOYMENT_TYPES.has(body.employmentType)
    ? body.employmentType
    : 'full_time'

  if (!displayName) {
    return {
      statusCode: 400,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: false, error: 'displayName is required' }),
    }
  }

  if (!emailRaw || !emailRaw.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return {
      statusCode: 400,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: false, error: 'Invalid or missing email address' }),
    }
  }

  try {
    const inviteToken = crypto.randomUUID()
    const baseUrl     = resolveBaseUrl(event)
    const inviteLink  = `${baseUrl}/employee/invite/${inviteToken}`

    const row = {
      org_id:           profile.org_id,
      user_id:          null,
      display_name:     displayName,
      email:            emailRaw,
      role,
      employment_type:  employmentType,
      portal_access:    { time_tracking: true },
      active:           true,
      invite_token:     inviteToken,
      invited_by:       authUser.id,
      invited_at:       new Date().toISOString(),
    }

    const inserted = await supabaseInsert(supabaseUrl, serviceKey, 'employee_profiles', row)
    const inviteId = inserted?.id

    let orgName = 'Your employer'
    try {
      const orgRes = await fetch(
        `${supabaseUrl}/rest/v1/organizations?id=eq.${encodeURIComponent(profile.org_id)}&select=name&limit=1`,
        {
          headers: {
            apikey:        serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        },
      )
      if (orgRes.ok) {
        const orgData = await orgRes.json()
        if (Array.isArray(orgData) && orgData[0]?.name) {
          orgName = orgData[0].name
        }
      }
    } catch {
      // Non-fatal — email still sends with fallback org name
    }

    await sendEmail(resendKey, {
      to:      emailRaw,
      subject: `${orgName} — Employee time tracking invite`,
      html:    buildEmployeeInviteHtml(inviteLink, displayName, orgName),
      text: [
        `${orgName} has invited you to Power On employee time tracking.`,
        '',
        'Use the link below to create your account or sign in and accept the invite:',
        inviteLink,
        '',
        'Power On Solutions LLC · C-10 License #1151468 · Desert Hot Springs, CA',
      ].join('\n'),
    })

    console.log(`[sendEmployeeInvite] Invite sent to ${emailRaw}, id=${inviteId}`)

    return {
      statusCode: 200,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({
        success:  true,
        inviteId,
        email:    emailRaw,
        // inviteToken omitted from production response — token is only in the email link
      }),
    }
  } catch (err) {
    console.error('[sendEmployeeInvite] Error:', err)
    return {
      statusCode: 500,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: false, error: err.message || 'Internal server error' }),
    }
  }
}
