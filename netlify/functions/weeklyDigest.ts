// @ts-nocheck
/**
 * Netlify Scheduled Function — Weekly Digest
 *
 * B8 — Notification Layer
 *
 * Runs every Monday at 8:00 AM PST (16:00 UTC).
 * Queries Supabase for weekly stats and sends an HTML digest email to
 * app@poweronsolutionsllc.com.
 *
 * Schedule config (add to netlify.toml manually — DO NOT auto-modify netlify.toml):
 *   [functions."weeklyDigest"]
 *     schedule = "0 16 * * 1"
 *
 * Queries:
 *   - Active beta users count (profiles where is_active = true)
 *   - New signups this week   (profiles.created_at within last 7 days)
 *   - Total NDA signatures    (signed_agreements count)
 *   - Most used agents this week (audit_log actor_type='agent', past 7d, grouped by actor_name)
 *   - Error patterns this week   (audit_log action ILIKE '%error%', past 7d)
 *
 * Subject: 'PowerOn Hub Weekly — [date range]'
 * To: app@poweronsolutionsllc.com
 *
 * Requires env vars:
 *   RESEND_API_KEY
 *   SUPABASE_URL              (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const RESEND_API_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM   = 'Power On Solutions <noreply@poweronsolutions.com>'
const NOTIFY_EMAIL   = 'app@poweronsolutionsllc.com'

// ── Supabase REST helpers ──────────────────────────────────────────────────────

async function supabaseQuery(url: string, serviceKey: string, query: string): Promise<any[]> {
  const res = await fetch(`${url}/rest/v1/${query}`, {
    headers: {
      apikey:        serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept:        'application/json',
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Supabase query failed ${res.status}: ${err}`)
  }
  return res.json()
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function getWeekRange(): { startISO: string; endISO: string; label: string } {
  const now   = new Date()
  const end   = new Date(now)
  const start = new Date(now)
  start.setDate(now.getDate() - 7)

  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return {
    startISO: start.toISOString(),
    endISO:   end.toISOString(),
    label:    `${fmt(start)} – ${fmt(end)}`,
  }
}

// ── Email HTML builder ─────────────────────────────────────────────────────────

interface DigestData {
  dateRange:       string
  activeBetaUsers: number
  newSignupsWeek:  number
  totalNDAs:       number
  topAgents:       { name: string; count: number }[]
  errorPatterns:   { action: string; count: number }[]
}

function buildDigestHtml(data: DigestData): string {
  const { dateRange, activeBetaUsers, newSignupsWeek, totalNDAs, topAgents, errorPatterns } = data

  const agentRows = topAgents.length > 0
    ? topAgents.map(a => `
        <tr>
          <td style="padding: 6px 0; color: #374151; font-size: 13px; border-bottom: 1px solid #f9fafb;">${a.name || '(unknown)'}</td>
          <td style="padding: 6px 0; color: #111; font-weight: 600; font-size: 13px; text-align: right; border-bottom: 1px solid #f9fafb;">${a.count}</td>
        </tr>`).join('')
    : `<tr><td colspan="2" style="padding: 6px 0; color: #9ca3af; font-size: 13px; font-style: italic;">No agent activity logged this week</td></tr>`

  const errorRows = errorPatterns.length > 0
    ? errorPatterns.map(e => `
        <tr>
          <td style="padding: 6px 0; color: #dc2626; font-size: 12px; font-family: monospace; border-bottom: 1px solid #fef2f2; word-break: break-all;">${e.action || '(unknown)'}</td>
          <td style="padding: 6px 0; color: #111; font-weight: 600; font-size: 13px; text-align: right; border-bottom: 1px solid #fef2f2;">${e.count}</td>
        </tr>`).join('')
    : `<tr><td colspan="2" style="padding: 6px 0; color: #16a34a; font-size: 13px; font-style: italic;">No error patterns detected</td></tr>`

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: Arial, sans-serif; font-size: 14px; color: #111; max-width: 580px; margin: 0 auto; padding: 24px; background: #f9fafb;">

  <!-- Header -->
  <div style="background: #111827; border-radius: 10px 10px 0 0; padding: 24px 28px; margin-bottom: 0;">
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <div>
        <h1 style="margin: 0; font-size: 18px; font-weight: 700; color: #fff; letter-spacing: -0.01em;">
          PowerOn Hub Weekly
        </h1>
        <p style="margin: 4px 0 0 0; font-size: 13px; color: #9ca3af;">${dateRange}</p>
      </div>
      <div style="background: #16a34a; border-radius: 6px; padding: 6px 12px;">
        <span style="font-size: 11px; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.05em;">Beta</span>
      </div>
    </div>
  </div>

  <!-- Stats grid -->
  <div style="background: #fff; border: 1px solid #e5e7eb; border-top: none; padding: 24px 28px;">

    <h3 style="margin: 0 0 14px 0; font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.07em;">
      User Activity
    </h3>

    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr style="background: #f9fafb;">
        <td style="padding: 14px 16px; border-radius: 8px 0 0 8px; border: 1px solid #e5e7eb; border-right: none; text-align: center; width: 33%;">
          <div style="font-size: 28px; font-weight: 700; color: #111;">${activeBetaUsers}</div>
          <div style="font-size: 11px; color: #6b7280; margin-top: 2px;">Active Beta Users</div>
        </td>
        <td style="padding: 14px 16px; border: 1px solid #e5e7eb; border-left: none; border-right: none; text-align: center; width: 33%;">
          <div style="font-size: 28px; font-weight: 700; color: #16a34a;">+${newSignupsWeek}</div>
          <div style="font-size: 11px; color: #6b7280; margin-top: 2px;">New Signups</div>
        </td>
        <td style="padding: 14px 16px; border-radius: 0 8px 8px 0; border: 1px solid #e5e7eb; border-left: none; text-align: center; width: 33%;">
          <div style="font-size: 28px; font-weight: 700; color: #2563eb;">${totalNDAs}</div>
          <div style="font-size: 11px; color: #6b7280; margin-top: 2px;">Total NDAs Signed</div>
        </td>
      </tr>
    </table>

    <!-- Most used agents -->
    <h3 style="margin: 0 0 10px 0; font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.07em;">
      Most Used Agents This Week
    </h3>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr style="border-bottom: 2px solid #e5e7eb;">
        <th style="padding: 4px 0 8px 0; text-align: left; font-size: 11px; color: #9ca3af; font-weight: 600; text-transform: uppercase;">Agent</th>
        <th style="padding: 4px 0 8px 0; text-align: right; font-size: 11px; color: #9ca3af; font-weight: 600; text-transform: uppercase;">Calls</th>
      </tr>
      ${agentRows}
    </table>

    <!-- Error patterns -->
    <h3 style="margin: 0 0 10px 0; font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.07em;">
      Error Patterns This Week
    </h3>
    <table style="width: 100%; border-collapse: collapse;">
      <tr style="border-bottom: 2px solid #fee2e2;">
        <th style="padding: 4px 0 8px 0; text-align: left; font-size: 11px; color: #9ca3af; font-weight: 600; text-transform: uppercase;">Action / Pattern</th>
        <th style="padding: 4px 0 8px 0; text-align: right; font-size: 11px; color: #9ca3af; font-weight: 600; text-transform: uppercase;">Count</th>
      </tr>
      ${errorRows}
    </table>

  </div>

  <!-- Footer -->
  <div style="background: #f3f4f6; border-radius: 0 0 10px 10px; padding: 14px 28px; border: 1px solid #e5e7eb; border-top: none;">
    <p style="margin: 0; font-size: 11px; color: #9ca3af; text-align: center;">
      PowerOn Hub Weekly Digest · Automated · Every Monday 8AM PST<br>
      Power On Solutions LLC · C-10 License #1151468 · Desert Hot Springs, CA
    </p>
  </div>

</body>
</html>`
}

// ── Main handler ───────────────────────────────────────────────────────────────

exports.handler = async (event: any) => {
  console.log('[weeklyDigest] Triggered at:', new Date().toISOString())

  const resendKey   = process.env.RESEND_API_KEY
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!resendKey || !supabaseUrl || !serviceKey) {
    const missing = [
      !resendKey   && 'RESEND_API_KEY',
      !supabaseUrl && 'SUPABASE_URL',
      !serviceKey  && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter(Boolean).join(', ')
    console.error('[weeklyDigest] Missing env vars:', missing)
    return { statusCode: 500, body: `Missing env vars: ${missing}` }
  }

  const { startISO, label: dateRange } = getWeekRange()

  // ── Supabase queries ────────────────────────────────────────────────────────

  let activeBetaUsers = 0
  let newSignupsWeek  = 0
  let totalNDAs       = 0
  let topAgents: { name: string; count: number }[] = []
  let errorPatterns: { action: string; count: number }[] = []

  try {
    // 1. Active beta users — count all active profiles
    const activeProfiles = await supabaseQuery(
      supabaseUrl,
      serviceKey,
      `profiles?select=id&is_active=eq.true`
    )
    activeBetaUsers = activeProfiles.length
  } catch (err) {
    console.warn('[weeklyDigest] activeBetaUsers query failed:', err)
  }

  try {
    // 2. New signups this week — profiles created in the last 7 days
    const newProfiles = await supabaseQuery(
      supabaseUrl,
      serviceKey,
      `profiles?select=id&created_at=gte.${encodeURIComponent(startISO)}`
    )
    newSignupsWeek = newProfiles.length
  } catch (err) {
    console.warn('[weeklyDigest] newSignupsWeek query failed:', err)
  }

  try {
    // 3. Total NDA signatures — signed_agreements count (non-revoked)
    const ndaRows = await supabaseQuery(
      supabaseUrl,
      serviceKey,
      `signed_agreements?select=id&revoked=neq.true`
    )
    totalNDAs = ndaRows.length
  } catch (err) {
    console.warn('[weeklyDigest] totalNDAs query failed:', err)
  }

  try {
    // 4. Most used agents this week — audit_log where actor_type = 'agent'
    const agentRows = await supabaseQuery(
      supabaseUrl,
      serviceKey,
      `audit_log?select=actor_name&actor_type=eq.agent&created_at=gte.${encodeURIComponent(startISO)}`
    )

    // Group by actor_name in JS (Supabase REST doesn't support GROUP BY directly)
    const counts: Record<string, number> = {}
    for (const row of agentRows) {
      const name = row.actor_name || '(unknown)'
      counts[name] = (counts[name] || 0) + 1
    }

    topAgents = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }))
  } catch (err) {
    console.warn('[weeklyDigest] topAgents query failed:', err)
  }

  try {
    // 5. Error patterns — audit_log actions containing 'error'
    const errorRows = await supabaseQuery(
      supabaseUrl,
      serviceKey,
      `audit_log?select=action&action=ilike.*error*&created_at=gte.${encodeURIComponent(startISO)}`
    )

    const counts: Record<string, number> = {}
    for (const row of errorRows) {
      const action = row.action || '(unknown)'
      counts[action] = (counts[action] || 0) + 1
    }

    errorPatterns = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([action, count]) => ({ action, count }))
  } catch (err) {
    console.warn('[weeklyDigest] errorPatterns query failed:', err)
  }

  // ── Build and send email ────────────────────────────────────────────────────

  const digestData: DigestData = {
    dateRange,
    activeBetaUsers,
    newSignupsWeek,
    totalNDAs,
    topAgents,
    errorPatterns,
  }

  const subject  = `PowerOn Hub Weekly \u2014 ${dateRange}`
  const htmlBody = buildDigestHtml(digestData)

  const textBody = [
    `PowerOn Hub Weekly — ${dateRange}`,
    '',
    `Active Beta Users:  ${activeBetaUsers}`,
    `New Signups:        +${newSignupsWeek}`,
    `Total NDAs Signed:  ${totalNDAs}`,
    '',
    'Most Used Agents This Week:',
    topAgents.length > 0
      ? topAgents.map(a => `  ${a.name}: ${a.count}`).join('\n')
      : '  (no agent activity this week)',
    '',
    'Error Patterns This Week:',
    errorPatterns.length > 0
      ? errorPatterns.map(e => `  ${e.action}: ${e.count}`).join('\n')
      : '  (no errors detected)',
    '',
    'Power On Solutions LLC · PowerOn Hub Beta',
  ].join('\n')

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    DEFAULT_FROM,
        to:      [NOTIFY_EMAIL],
        subject,
        html:    htmlBody,
        text:    textBody,
      }),
    })

    const resData = await res.json()

    if (!res.ok) {
      console.error('[weeklyDigest] Resend error:', res.status, resData)
      return { statusCode: res.status, body: JSON.stringify({ error: resData?.message }) }
    }

    console.log('[weeklyDigest] Digest sent. messageId:', resData.id, '| Range:', dateRange)
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, messageId: resData.id, dateRange }),
    }
  } catch (err: any) {
    console.error('[weeklyDigest] Send failed:', err)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
