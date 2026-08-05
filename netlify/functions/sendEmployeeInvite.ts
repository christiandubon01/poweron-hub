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
const DEFAULT_FROM   = 'Power On Solutions <no-reply@poweronsolutionsllc.com>'
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

async function supabaseUpdate(url, serviceKey, table, id, patch) {
  const res = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method:  'PATCH',
    headers: {
      apikey:         serviceKey,
      Authorization:  `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer:         'return=representation',
    },
    body: JSON.stringify(patch),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Supabase PATCH error ${res.status}`)
  }
  return Array.isArray(data) ? data[0] : data
}

async function supabaseSelectById(url, serviceKey, table, id, select) {
  const res = await fetch(
    `${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=${select}&limit=1`,
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

async function supabaseSelectByBackupId(url, serviceKey, orgId, backupEmployeeId) {
  const res = await fetch(
    `${url}/rest/v1/employee_profiles?org_id=eq.${encodeURIComponent(orgId)}&backup_employee_id=eq.${encodeURIComponent(backupEmployeeId)}&select=id,org_id,user_id,active,display_name&limit=1`,
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

// signInUrl (Employee Portal login for future visits) is derived from the invite
// link so callers don't need to thread another argument through every path.
function employeeSignInUrl(inviteLink) {
  try {
    return inviteLink.replace(/\/employee\/invite\/[^/?#]+.*/, '/employee/login')
  } catch {
    return inviteLink
  }
}

function buildEmployeeInviteHtml(inviteLink, displayName, orgName) {
  const greeting = displayName
    ? `Hi ${displayName},`
    : 'Hello,'
  const signInUrl = employeeSignInUrl(inviteLink)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #111; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb;">
  <div style="background: #fff; border-radius: 10px; padding: 36px 32px; border: 1px solid #e5e7eb;">

    <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #16a34a;">
      Power On Solutions Employee Account
    </p>
    <h2 style="margin: 0 0 6px 0; font-size: 22px; color: #111; font-weight: 700;">
      You're invited to the Power On Employee Portal
    </h2>
    <p style="margin: 0 0 20px 0; color: #6b7280; font-size: 13px;">
      Power On Solutions LLC · C-10 License #1151468 · Desert Hot Springs, CA
    </p>

    <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 0 0 20px 0;">

    <p style="margin: 0 0 16px 0; line-height: 1.6; color: #374151;">
      ${greeting}
    </p>

    <p style="margin: 0 0 16px 0; line-height: 1.6; color: #374151;">
      <strong>${orgName || 'Your employer'}</strong> has invited you to activate your
      <strong>Power On Solutions employee account</strong> and use the Employee Portal to
      clock in and out and track your time from your phone or computer.
    </p>

    <p style="margin: 0 0 24px 0; color: #374151; font-size: 14px;">
      Tap the button below to activate your account. Use the same email address this
      invitation was sent to.
    </p>

    <div style="text-align: center; margin: 0 0 24px 0;">
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
        Activate Employee Account
      </a>
    </div>

    <p style="margin: 0 0 20px 0; font-size: 12px; color: #9ca3af; line-height: 1.6;">
      Or copy this link into your browser:<br>
      <span style="font-family: monospace; color: #6b7280; word-break: break-all;">${inviteLink}</span>
    </p>

    <div style="background: #f9fafb; border: 1px solid #f3f4f6; border-radius: 8px; padding: 14px 16px; margin: 0 0 8px 0;">
      <p style="margin: 0 0 6px 0; font-size: 13px; color: #374151;">
        <strong>Already activated?</strong> Sign in to the Employee Portal any time:
      </p>
      <p style="margin: 0 0 10px 0; font-size: 13px;">
        <a href="${signInUrl}" style="color: #16a34a; font-weight: 600; word-break: break-all;">${signInUrl}</a>
      </p>
      <p style="margin: 0; font-size: 12px; color: #9ca3af; line-height: 1.6;">
        This activation link expires in 7 days. If it has expired, ask ${orgName || 'your employer'} to
        resend your invitation. Need help? Reply to this email or contact your employer.
      </p>
    </div>

  </div>

  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="font-size: 12px; color: #9ca3af; margin: 0; text-align: center;">
    Power On Solutions LLC · C-10 License #1151468 · Desert Hot Springs, CA<br>
    Coachella Valley Electrical Contractor
  </p>
</body>
</html>`
}

function buildEmployeeInviteText(inviteLink, orgName) {
  const signInUrl = employeeSignInUrl(inviteLink)
  return [
    `${orgName || 'Your employer'} has invited you to activate your Power On Solutions employee account.`,
    '',
    'Activate your account (use the email this invite was sent to):',
    inviteLink,
    '',
    'Already activated? Sign in to the Employee Portal any time:',
    signInUrl,
    '',
    'This activation link expires in 7 days. If it has expired, ask your employer to resend it.',
    'Questions? Reply to this email or contact your employer.',
    '',
    'Power On Solutions LLC · C-10 License #1151468 · Desert Hot Springs, CA',
  ].join('\n')
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
  const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : null
  const backupEmployeeId = typeof body.backupEmployeeId === 'string' && body.backupEmployeeId.trim()
    ? body.backupEmployeeId.trim()
    : null

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

  // ── Invite to an existing prepared profile (UPDATE path) ───────────────────
  if (profileId) {
    try {
      const existing = await supabaseSelectById(
        supabaseUrl, serviceKey, 'employee_profiles', profileId,
        'id,org_id,user_id,active,display_name',
      )
      if (!existing || existing.org_id !== profile.org_id) {
        return {
          statusCode: 403,
          headers:    CORS_HEADERS,
          body:       JSON.stringify({ success: false, error: 'Profile not found or not in your organization' }),
        }
      }
      if (existing.user_id !== null) {
        return {
          statusCode: 409,
          headers:    CORS_HEADERS,
          body:       JSON.stringify({ success: false, error: 'Employee has already accepted an invite' }),
        }
      }
      if (existing.active !== true) {
        return {
          statusCode: 409,
          headers:    CORS_HEADERS,
          body:       JSON.stringify({ success: false, error: 'Employee profile is inactive' }),
        }
      }

      const inviteToken = crypto.randomUUID()
      const baseUrl     = resolveBaseUrl(event)
      const inviteLink  = `${baseUrl}/employee/invite/${inviteToken}`

      await supabaseUpdate(supabaseUrl, serviceKey, 'employee_profiles', profileId, {
        email:        emailRaw,
        display_name: displayName,
        invite_token: inviteToken,
        invited_by:   authUser.id,
        invited_at:   new Date().toISOString(),
      })

      let orgName = 'Your employer'
      try {
        const orgRes = await fetch(
          `${supabaseUrl}/rest/v1/organizations?id=eq.${encodeURIComponent(profile.org_id)}&select=name&limit=1`,
          { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
        )
        if (orgRes.ok) {
          const orgData = await orgRes.json()
          if (Array.isArray(orgData) && orgData[0]?.name) orgName = orgData[0].name
        }
      } catch { /* non-fatal */ }

      await sendEmail(resendKey, {
        to:      emailRaw,
        subject: `${orgName} — Activate your Power On employee account`,
        html:    buildEmployeeInviteHtml(inviteLink, displayName, orgName),
        text:    buildEmployeeInviteText(inviteLink, orgName),
      })

      console.log(`[sendEmployeeInvite] Invite (update) sent to ${emailRaw}, profileId=${profileId}`)

      return {
        statusCode: 200,
        headers:    CORS_HEADERS,
        body:       JSON.stringify({ success: true, inviteId: profileId, email: emailRaw }),
      }
    } catch (err) {
      console.error('[sendEmployeeInvite] Update-path error:', err)
      return {
        statusCode: 500,
        headers:    CORS_HEADERS,
        body:       JSON.stringify({ success: false, error: err.message || 'Internal server error' }),
      }
    }
  }

  // ── Standard new invite (INSERT path) ────────────────────────────────────────
  try {
    const inviteToken = crypto.randomUUID()
    const baseUrl     = resolveBaseUrl(event)
    const inviteLink  = `${baseUrl}/employee/invite/${inviteToken}`

    // ROLE-2.4 duplicate prevention / invite reuse:
    // When inviting from a Cost Model employee (backupEmployeeId), never create a
    // second portal profile if one already exists for that Cost Model employee.
    // Reuse the existing unlinked profile; reject if it is already activated.
    // backup_employee_id is unique per org (migration 114) — this is the app-side
    // guard that keeps the constraint from ever being hit.
    if (backupEmployeeId) {
      const existingByBackup = await supabaseSelectByBackupId(
        supabaseUrl, serviceKey, profile.org_id, backupEmployeeId,
      )
      if (existingByBackup) {
        if (existingByBackup.user_id !== null) {
          return {
            statusCode: 409,
            headers:    CORS_HEADERS,
            body:       JSON.stringify({ success: false, error: 'This employee already has an active portal account.' }),
          }
        }
        // Reuse the existing prepared/unlinked profile — do NOT insert a new row.
        await supabaseUpdate(supabaseUrl, serviceKey, 'employee_profiles', existingByBackup.id, {
          email:        emailRaw,
          display_name: displayName,
          invite_token: inviteToken,
          invited_by:   authUser.id,
          invited_at:   new Date().toISOString(),
        })

        let reuseOrgName = 'Your employer'
        try {
          const orgRes = await fetch(
            `${supabaseUrl}/rest/v1/organizations?id=eq.${encodeURIComponent(profile.org_id)}&select=name&limit=1`,
            { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
          )
          if (orgRes.ok) {
            const orgData = await orgRes.json()
            if (Array.isArray(orgData) && orgData[0]?.name) reuseOrgName = orgData[0].name
          }
        } catch { /* non-fatal */ }

        await sendEmail(resendKey, {
          to:      emailRaw,
          subject: `${reuseOrgName} — Activate your Power On employee account`,
          html:    buildEmployeeInviteHtml(inviteLink, displayName, reuseOrgName),
          text:    buildEmployeeInviteText(inviteLink, reuseOrgName),
        })

        console.log(`[sendEmployeeInvite] Invite (reuse by backup_employee_id) sent to ${emailRaw}, profileId=${existingByBackup.id}`)

        return {
          statusCode: 200,
          headers:    CORS_HEADERS,
          body:       JSON.stringify({ success: true, inviteId: existingByBackup.id, email: emailRaw, reused: true }),
        }
      }
    }

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
      // Carry the Cost Model linkage so the new profile is unified from creation.
      ...(backupEmployeeId ? { backup_employee_id: backupEmployeeId } : {}),
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
      subject: `${orgName} — Activate your Power On employee account`,
      html:    buildEmployeeInviteHtml(inviteLink, displayName, orgName),
      text:    buildEmployeeInviteText(inviteLink, orgName),
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
