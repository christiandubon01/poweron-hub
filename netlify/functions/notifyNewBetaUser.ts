// @ts-nocheck
/**
 * Netlify Function — New Beta User Notification
 *
 * B8 — Notification Layer
 *
 * POST { orgId, businessName, industry, ownerName, signupTimestamp }
 *   → Sends notification email to app@poweronsolutionsllc.com
 *   → Subject: 'New Beta User Active — [Business Name]'
 *   → Body: business name, industry, owner name, signup timestamp, org_id
 *
 * Triggered by BetaOnboarding.handleComplete() after orgs.onboarding_complete = true.
 * Fire-and-forget — non-blocking.
 *
 * Requires RESEND_API_KEY environment variable.
 */

const RESEND_API_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM   = 'Power On Solutions <noreply@poweronsolutions.com>'
const NOTIFY_EMAIL   = 'app@poweronsolutionsllc.com'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

function buildNewBetaUserHtml(params: {
  orgId: string
  businessName: string
  industry: string
  ownerName: string
  signupTimestamp: string
}): string {
  const { orgId, businessName, industry, ownerName, signupTimestamp } = params

  const formattedDate = (() => {
    try {
      return new Date(signupTimestamp).toLocaleString('en-US', {
        year:     'numeric',
        month:    'long',
        day:      'numeric',
        hour:     '2-digit',
        minute:   '2-digit',
        timeZone: 'America/Los_Angeles',
        timeZoneName: 'short',
      })
    } catch {
      return signupTimestamp
    }
  })()

  const industryDisplay = industry
    ? industry.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
    : 'Not specified'

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: Arial, sans-serif; font-size: 14px; color: #111; max-width: 540px; margin: 0 auto; padding: 24px; background: #f9fafb;">
  <div style="background: #fff; border-radius: 10px; padding: 32px; border: 1px solid #e5e7eb;">

    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
      <div style="width: 10px; height: 10px; background: #16a34a; border-radius: 50%; flex-shrink: 0;"></div>
      <h2 style="margin: 0; font-size: 17px; font-weight: 700; color: #111;">New Beta User Active</h2>
    </div>

    <p style="margin: 0 0 20px 0; color: #4b5563; font-size: 13px;">
      A new user has completed onboarding and is now active on PowerOn Hub.
    </p>

    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 13px; width: 38%;">Business Name</td>
        <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #111; font-size: 13px; font-weight: 600;">${businessName || '(not provided)'}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 13px;">Industry</td>
        <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #111; font-size: 13px;">${industryDisplay}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 13px;">Owner Name</td>
        <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #111; font-size: 13px;">${ownerName || '(not provided)'}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 13px;">Signed Up</td>
        <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #111; font-size: 13px;">${formattedDate}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 13px;">Org ID</td>
        <td style="padding: 8px 0; color: #6b7280; font-size: 12px; font-family: monospace;">${orgId}</td>
      </tr>
    </table>

    <p style="margin: 20px 0 0 0; font-size: 12px; color: #9ca3af;">
      Sent automatically when a beta user completes the onboarding flow.
    </p>
  </div>

  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="font-size: 11px; color: #9ca3af; margin: 0; text-align: center;">
    Power On Solutions LLC · PowerOn Hub Beta · C-10 License #1151468
  </p>
</body>
</html>`
}

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

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[notifyNewBetaUser] RESEND_API_KEY not set')
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'RESEND_API_KEY not configured' }),
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

  const {
    orgId        = '',
    businessName = '',
    industry     = '',
    ownerName    = '',
    signupTimestamp = new Date().toISOString(),
  } = body as {
    orgId?: string
    businessName?: string
    industry?: string
    ownerName?: string
    signupTimestamp?: string
  }

  const displayName = (businessName as string).trim() || (ownerName as string).trim() || 'Unknown'
  const subject     = `New Beta User Active \u2014 ${displayName}`

  const textBody = [
    `New Beta User Active`,
    '',
    `Business Name: ${(businessName as string) || '(not provided)'}`,
    `Industry:      ${(industry as string) || '(not provided)'}`,
    `Owner Name:    ${(ownerName as string) || '(not provided)'}`,
    `Signed Up:     ${signupTimestamp}`,
    `Org ID:        ${orgId}`,
    '',
    'Sent automatically when a beta user completes the PowerOn Hub onboarding flow.',
    '',
    'Power On Solutions LLC · PowerOn Hub Beta',
  ].join('\n')

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    DEFAULT_FROM,
        to:      [NOTIFY_EMAIL],
        subject,
        html:    buildNewBetaUserHtml({
          orgId:           orgId as string,
          businessName:    businessName as string,
          industry:        industry as string,
          ownerName:       ownerName as string,
          signupTimestamp: signupTimestamp as string,
        }),
        text: textBody,
      }),
    })

    const resData = await res.json()

    if (!res.ok) {
      console.error('[notifyNewBetaUser] Resend error:', res.status, resData)
      return {
        statusCode: res.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: resData?.message || `Resend error ${res.status}` }),
      }
    }

    console.log('[notifyNewBetaUser] Sent for org:', orgId, '| messageId:', resData.id)
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, messageId: resData.id }),
    }
  } catch (err: any) {
    console.error('[notifyNewBetaUser] Handler error:', err)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: err.message || 'Internal server error' }),
    }
  }
}
