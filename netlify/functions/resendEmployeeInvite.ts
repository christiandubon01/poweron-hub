// @ts-nocheck
/**
 * Netlify Function — Resend Employee Invite
 *
 * POST { profileId: string }
 *   Authorization: Bearer <supabase access token>
 *   → Verifies caller is owner/admin
 *   → Verifies employee_profiles row: user_id IS NULL (still pending) + active = true
 *   → Generates new invite_token, updates the row (does NOT insert a new row)
 *   → Re-sends invite email via Resend
 *   → Returns { success, email }
 *
 * Requires env vars:
 *   RESEND_API_KEY
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)
 */

const crypto = require('crypto')

const RESEND_API_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM   = 'Power On Solutions <no-reply@poweronsolutionsllc.com>'
const APP_BASE_URL   = 'https://incomparable-croissant-a86c81.netlify.app'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type':                  'application/json',
}

// ── Supabase REST helpers ─────────────────────────────────────────────────────

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

async function supabaseSelectEmployeeProfile(url, serviceKey, profileId) {
  const res = await fetch(
    `${url}/rest/v1/employee_profiles?id=eq.${encodeURIComponent(profileId)}&select=id,org_id,user_id,email,display_name,active,invite_token&limit=1`,
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

async function supabaseUpdateEmployeeProfile(url, serviceKey, profileId, patch) {
  const res = await fetch(
    `${url}/rest/v1/employee_profiles?id=eq.${encodeURIComponent(profileId)}`,
    {
      method:  'PATCH',
      headers: {
        apikey:         serviceKey,
        Authorization:  `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer:         'return=minimal',
      },
      body: JSON.stringify(patch),
    },
  )
  if (!res.ok) {
    let msg = `Supabase PATCH error ${res.status}`
    try {
      const d = await res.json()
      msg = d?.message || d?.error || msg
    } catch { /* ignore */ }
    throw new Error(msg)
  }
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

// ── Email (same template as sendEmployeeInvite) ───────────────────────────────

function buildEmployeeInviteHtml(inviteLink, displayName, orgName) {
  const greeting = displayName ? `Hi ${displayName},` : 'Hello,'
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
      <strong>${orgName || 'Your employer'}</strong> has resent your invite to the
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
  const anonKey     = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

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

  const callerProfile = await supabaseSelectProfile(supabaseUrl, serviceKey, authUser.id)
  if (!callerProfile?.org_id || !['owner', 'admin'].includes(callerProfile.role)) {
    return {
      statusCode: 403,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: false, error: 'Only owners and admins can resend employee invites' }),
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

  const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
  if (!profileId) {
    return {
      statusCode: 400,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: false, error: 'profileId is required' }),
    }
  }

  try {
    const empProfile = await supabaseSelectEmployeeProfile(supabaseUrl, serviceKey, profileId)

    if (!empProfile) {
      return {
        statusCode: 404,
        headers:    CORS_HEADERS,
        body:       JSON.stringify({ success: false, error: 'Employee profile not found' }),
      }
    }

    // Org guard — resend only within caller's own org
    if (empProfile.org_id !== callerProfile.org_id) {
      return {
        statusCode: 403,
        headers:    CORS_HEADERS,
        body:       JSON.stringify({ success: false, error: 'Employee profile not found' }),
      }
    }

    if (empProfile.user_id !== null) {
      return {
        statusCode: 409,
        headers:    CORS_HEADERS,
        body:       JSON.stringify({ success: false, error: 'Employee has already accepted the invite' }),
      }
    }

    if (empProfile.active !== true) {
      return {
        statusCode: 409,
        headers:    CORS_HEADERS,
        body:       JSON.stringify({ success: false, error: 'Employee profile is inactive' }),
      }
    }

    const newToken = crypto.randomUUID()
    const baseUrl  = resolveBaseUrl(event)
    const inviteLink = `${baseUrl}/employee/invite/${newToken}`

    await supabaseUpdateEmployeeProfile(supabaseUrl, serviceKey, profileId, {
      invite_token: newToken,
      invited_at:   new Date().toISOString(),
    })

    let orgName = 'Your employer'
    try {
      const orgRes = await fetch(
        `${supabaseUrl}/rest/v1/organizations?id=eq.${encodeURIComponent(callerProfile.org_id)}&select=name&limit=1`,
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

    const emailTo = empProfile.email
    await sendEmail(resendKey, {
      to:      emailTo,
      subject: `${orgName} — Your employee invite (resent)`,
      html:    buildEmployeeInviteHtml(inviteLink, empProfile.display_name, orgName),
      text: [
        `${orgName} has resent your invite to Power On employee time tracking.`,
        '',
        'Use the link below to create your account or sign in and accept the invite:',
        inviteLink,
        '',
        'Power On Solutions LLC · C-10 License #1151468 · Desert Hot Springs, CA',
      ].join('\n'),
    })

    console.log(`[resendEmployeeInvite] Invite resent to ${emailTo}, profileId=${profileId}`)

    return {
      statusCode: 200,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: true, email: emailTo }),
    }
  } catch (err) {
    console.error('[resendEmployeeInvite] Error:', err)
    return {
      statusCode: 500,
      headers:    CORS_HEADERS,
      body:       JSON.stringify({ success: false, error: err.message || 'Internal server error' }),
    }
  }
}
