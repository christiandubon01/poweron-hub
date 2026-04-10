// @ts-nocheck
/**
 * Netlify Function — Customer Portal Confirmation Email
 *
 * POST { email, name, confirmation_number, service_type }
 *
 * → Sends a professional HTML confirmation email via Resend API
 * → Targets: within 60 seconds of lead submission
 * → From: app@poweronsolutionsllc.com
 * → Includes: confirmation number, expected response window, CSLB license
 *     + verify link, "what to expect" timeline
 *
 * Environment variables required:
 *   RESEND_API_KEY — Resend API secret key
 *
 * Called internally by portal-submit (fire-and-forget) and optionally
 * directly for manual resend scenarios.
 *
 * DATA FIREWALL: This function receives only confirmation metadata.
 * It never accesses portal_leads or any operational Supabase table.
 */

const RESEND_API_URL = 'https://api.resend.com/emails'
const FROM_ADDRESS   = 'Power On Solutions <app@poweronsolutionsllc.com>'
const COMPANY_NAME   = 'Power On Solutions LLC'
const LICENSE_NUMBER = '1151468'
const CSLB_VERIFY_URL = `https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx?LicNum=${LICENSE_NUMBER}`
const PHONE_DISPLAY  = '(760) 555-0100'   // Replace with real number
const WEBSITE_URL    = 'https://poweronsolutionsllc.com'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

// ── Service type labels ──────────────────────────────────────────────────────

const SERVICE_TYPE_LABELS = {
  electrical_service: 'Electrical Service',
  panel_upgrade: 'Panel Upgrade',
  solar_installation: 'Solar Installation',
  battery_storage: 'Battery Storage / Backup Power',
  ev_charger: 'EV Charger Installation',
  whole_home_rewire: 'Whole-Home Rewire',
  lighting: 'Lighting',
  troubleshooting: 'Electrical Troubleshooting',
  commercial: 'Commercial Electrical',
  other: 'Electrical Service',
}

function getServiceLabel(service_type) {
  return SERVICE_TYPE_LABELS[service_type] || 'Electrical Service'
}

// ── HTML email template ──────────────────────────────────────────────────────

function buildConfirmationEmail(name, confirmationNumber, serviceType) {
  const firstName = (name || 'there').split(' ')[0]
  const serviceLabel = getServiceLabel(serviceType)
  const year = new Date().getFullYear()

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Request Confirmed — Power On Solutions</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
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
              <div style="display:inline-block;background:#f59e0b;border-radius:10px;padding:10px 20px;margin-bottom:16px;">
                <span style="font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.5px;">⚡ POWER ON</span>
              </div>
              <h1 style="margin:0 0 6px;font-size:26px;font-weight:700;color:#f8fafc;">
                Request Confirmed
              </h1>
              <p style="margin:0;font-size:15px;color:#94a3b8;">
                We've received your ${serviceLabel} request
              </p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:28px 40px 0;">
              <p style="margin:0 0 8px;font-size:16px;color:#e2e8f0;">
                Hi ${escHtml(firstName)},
              </p>
              <p style="margin:0;font-size:15px;color:#94a3b8;line-height:1.6;">
                Thank you for reaching out to Power On Solutions. Your request has been received and
                logged in our system. A licensed electrician will review your information and
                follow up with you shortly.
              </p>
            </td>
          </tr>

          <!-- Confirmation number box -->
          <tr>
            <td style="padding:24px 40px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
                     style="background:#0f172a;border-radius:8px;border:1px solid #f59e0b;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.12em;color:#f59e0b;text-transform:uppercase;">
                      Your Confirmation Number
                    </p>
                    <p style="margin:0;font-size:28px;font-weight:800;color:#f8fafc;letter-spacing:0.08em;font-family:monospace;">
                      ${escHtml(confirmationNumber)}
                    </p>
                    <p style="margin:6px 0 0;font-size:12px;color:#64748b;">
                      Save this number — you may need it when we call.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Response window -->
          <tr>
            <td style="padding:0 40px 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
                     style="background:#1e3a5f;border-radius:8px;border:1px solid #2563eb;">
                <tr>
                  <td style="padding:18px 24px;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:0.08em;">
                      ⏱ Expected Response Window
                    </p>
                    <p style="margin:0;font-size:15px;color:#e2e8f0;line-height:1.5;">
                      <strong style="color:#f8fafc;">Within 1 business day</strong> — typically same day for requests received before 3 PM.
                      Emergency service calls are prioritized and may be contacted within hours.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- What to expect timeline -->
          <tr>
            <td style="padding:0 40px 28px;">
              <p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#f8fafc;text-transform:uppercase;letter-spacing:0.08em;">
                What to Expect
              </p>

              <!-- Step 1 -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:12px;">
                <tr>
                  <td width="40" valign="top" style="padding-top:2px;">
                    <div style="width:28px;height:28px;background:#f59e0b;border-radius:50%;text-align:center;line-height:28px;font-weight:800;font-size:13px;color:#0f172a;">1</div>
                  </td>
                  <td style="padding-left:8px;">
                    <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#f8fafc;">Review &amp; Contact</p>
                    <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.5;">
                      We review your request and call or text you to confirm details and schedule a visit.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Step 2 -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:12px;">
                <tr>
                  <td width="40" valign="top" style="padding-top:2px;">
                    <div style="width:28px;height:28px;background:#f59e0b;border-radius:50%;text-align:center;line-height:28px;font-weight:800;font-size:13px;color:#0f172a;">2</div>
                  </td>
                  <td style="padding-left:8px;">
                    <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#f8fafc;">On-Site Assessment</p>
                    <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.5;">
                      A licensed C-10 electrician visits your property to assess the scope of work.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Step 3 -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:0;">
                <tr>
                  <td width="40" valign="top" style="padding-top:2px;">
                    <div style="width:28px;height:28px;background:#f59e0b;border-radius:50%;text-align:center;line-height:28px;font-weight:800;font-size:13px;color:#0f172a;">3</div>
                  </td>
                  <td style="padding-left:8px;">
                    <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#f8fafc;">Written Quote</p>
                    <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.5;">
                      We provide a clear, itemized written estimate before any work begins. No surprises.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- License / trust block -->
          <tr>
            <td style="padding:0 40px 28px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
                     style="background:#0f172a;border-radius:8px;border:1px solid #334155;">
                <tr>
                  <td style="padding:18px 24px;">
                    <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#e2e8f0;">
                      🛡 Licensed, Bonded &amp; Insured
                    </p>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="padding-right:6px;">
                          <span style="font-size:13px;color:#94a3b8;">CSLB License #</span>
                          <span style="font-size:13px;font-weight:700;color:#f8fafc;">&nbsp;${LICENSE_NUMBER}</span>
                        </td>
                        <td>
                          <a href="${CSLB_VERIFY_URL}"
                             style="display:inline-block;font-size:12px;font-weight:600;color:#f59e0b;text-decoration:none;border:1px solid #f59e0b;border-radius:4px;padding:2px 10px;">
                            Verify ↗
                          </a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:8px 0 0;font-size:12px;color:#64748b;line-height:1.5;">
                      C-10 Electrical · Coachella Valley, CA · Serving the Desert Southwest
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 40px 32px;text-align:center;">
              <p style="margin:0 0 16px;font-size:14px;color:#94a3b8;">
                Need to reach us directly?
              </p>
              <a href="tel:${PHONE_DISPLAY.replace(/\D/g,'')}"
                 style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:800;font-size:15px;text-decoration:none;border-radius:8px;padding:13px 32px;letter-spacing:0.02em;">
                Call Us: ${PHONE_DISPLAY}
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#0f172a;padding:20px 40px;border-top:1px solid #1e293b;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:#475569;">
                ${COMPANY_NAME} · C-10 License #${LICENSE_NUMBER}
              </p>
              <p style="margin:0 0 6px;font-size:12px;color:#475569;">
                Desert Hot Springs, CA · Coachella Valley Electrical Contractor
              </p>
              <p style="margin:0;font-size:11px;color:#334155;">
                You received this email because you submitted a service request at
                <a href="${WEBSITE_URL}" style="color:#64748b;text-decoration:none;">${WEBSITE_URL}</a>.
                If you did not submit this request, please disregard this email.
              </p>
              <p style="margin:8px 0 0;font-size:11px;color:#334155;">
                © ${year} ${COMPANY_NAME}. All rights reserved.
              </p>
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

function escHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Plain-text fallback ──────────────────────────────────────────────────────

function buildPlainText(name, confirmationNumber, serviceType) {
  const firstName = (name || 'there').split(' ')[0]
  const serviceLabel = getServiceLabel(serviceType)
  return `Hi ${firstName},

Thank you for contacting Power On Solutions LLC.

Your ${serviceLabel} request has been confirmed.

CONFIRMATION NUMBER: ${confirmationNumber}
Save this number — you may need it when we call.

EXPECTED RESPONSE: Within 1 business day (same day for requests received before 3 PM).

WHAT TO EXPECT:
1. Review & Contact — We'll call or text you to confirm details and schedule a visit.
2. On-Site Assessment — A licensed C-10 electrician visits your property.
3. Written Quote — Clear, itemized estimate before any work begins.

Licensed, Bonded & Insured
CSLB License #${LICENSE_NUMBER}
Verify: ${CSLB_VERIFY_URL}

Need to reach us directly? Call ${PHONE_DISPLAY}

---
${COMPANY_NAME} · C-10 License #${LICENSE_NUMBER}
Desert Hot Springs, CA · Coachella Valley Electrical Contractor
${WEBSITE_URL}

You received this email because you submitted a service request through our portal.
If you did not submit this request, please disregard this email.`
}

// ── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async (event, _context) => {
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
    console.error('[portal-confirm-email] RESEND_API_KEY not configured')
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'Email service not configured. Lead was saved; please contact us directly.',
      }),
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

  const { email, name, confirmation_number, service_type } = body

  // Validate required fields
  if (!email || !name || !confirmation_number) {
    return {
      statusCode: 422,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'Missing required fields: email, name, confirmation_number',
      }),
    }
  }

  // Build email content
  const htmlBody = buildConfirmationEmail(name, confirmation_number, service_type || 'other')
  const textBody = buildPlainText(name, confirmation_number, service_type || 'other')

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [String(email).toLowerCase().trim()],
        subject: `Request Confirmed — ${confirmation_number} | Power On Solutions`,
        html: htmlBody,
        text: textBody,
      }),
    })

    const resData = await res.json()

    if (!res.ok) {
      console.error('[portal-confirm-email] Resend error:', res.status, resData)
      return {
        statusCode: res.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: resData?.message || `Email send failed [${res.status}]`,
        }),
      }
    }

    console.log('[portal-confirm-email] Confirmation sent to:', email, '| messageId:', resData.id)
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        messageId: resData.id,
        confirmation_number,
      }),
    }
  } catch (err) {
    console.error('[portal-confirm-email] Handler error:', err)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: err.message || 'Internal server error sending confirmation email',
      }),
    }
  }
}
