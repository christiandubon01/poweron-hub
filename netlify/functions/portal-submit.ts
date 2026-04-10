// @ts-nocheck
/**
 * Netlify Function — Customer Portal Lead Submission
 *
 * POST { service_type, name, email, phone, address, city, description,
 *         urgency, photos_urls?, sq_ft?, property_type?, roof_type?,
 *         utility?, monthly_bill?, battery_interest?, drawings_available? }
 *
 * → Validates all required fields
 * → Writes to `portal_leads` table using SUPABASE_SERVICE_ROLE_KEY (never anon)
 * → Dispatches SPARK notification via agent_messages (sanitized — name, service_type,
 *     city, email, phone ONLY; no full address, no description, no photos)
 * → Returns { success: true, confirmation_number: "POL-XXXXXXXX" }
 *
 * DATA FIREWALL (non-negotiable):
 * - Writes ONLY to portal_leads — never to any operational table
 * - SPARK message payload contains ONLY the 5 sanitized fields
 * - No anon key used here; service role key is server-side only
 * - Portal user credentials never reach this function; the function is public POST only
 *
 * Environment variables required (Netlify → Site settings → Environment variables):
 *   SUPABASE_URL              — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role secret key (server-side ONLY)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

// ── UUID utilities ───────────────────────────────────────────────────────────

function generateUUID() {
  // RFC 4122 v4 UUID — works in Node.js 14+
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Short confirmation number in format: POL-XXXXXXXX (8 hex chars, uppercase)
 * Derived from a UUID v4 segment for uniqueness without exposing sequential IDs.
 */
function generateConfirmationNumber() {
  const uuid = generateUUID()
  const segment = uuid.replace(/-/g, '').slice(0, 8).toUpperCase()
  return `POL-${segment}`
}

// ── Field validation ─────────────────────────────────────────────────────────

const REQUIRED_FIELDS = ['service_type', 'name', 'email', 'phone', 'address', 'city', 'description', 'urgency']

const VALID_SERVICE_TYPES = [
  'electrical_service',
  'panel_upgrade',
  'solar_installation',
  'battery_storage',
  'ev_charger',
  'whole_home_rewire',
  'lighting',
  'troubleshooting',
  'commercial',
  'other',
]

const VALID_URGENCY = ['emergency', 'urgent', 'standard', 'flexible']

const VALID_PROPERTY_TYPES = ['residential', 'commercial', 'industrial', 'multi_family', '']
const VALID_ROOF_TYPES = ['shingle', 'tile', 'metal', 'flat', 'other', '']

function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

function validatePhone(phone) {
  // Allow digits, spaces, dashes, parens, plus — at least 10 digits total
  if (typeof phone !== 'string') return false
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}

function sanitizeString(val, maxLen = 500) {
  if (val === null || val === undefined) return ''
  return String(val).trim().slice(0, maxLen)
}

function validateBody(body) {
  const errors = []

  // Required fields presence check
  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || sanitizeString(body[field]).length === 0) {
      errors.push(`Missing required field: ${field}`)
    }
  }

  if (errors.length > 0) return errors

  // Type-specific validations
  if (!validateEmail(body.email)) {
    errors.push('Invalid email address format')
  }

  if (!validatePhone(body.phone)) {
    errors.push('Invalid phone number — must contain at least 10 digits')
  }

  if (body.service_type && !VALID_SERVICE_TYPES.includes(body.service_type)) {
    errors.push(`Invalid service_type. Must be one of: ${VALID_SERVICE_TYPES.join(', ')}`)
  }

  if (body.urgency && !VALID_URGENCY.includes(body.urgency)) {
    errors.push(`Invalid urgency. Must be one of: ${VALID_URGENCY.join(', ')}`)
  }

  if (body.property_type && !VALID_PROPERTY_TYPES.includes(body.property_type)) {
    errors.push(`Invalid property_type`)
  }

  if (body.roof_type && !VALID_ROOF_TYPES.includes(body.roof_type)) {
    errors.push(`Invalid roof_type`)
  }

  if (body.sq_ft !== undefined && body.sq_ft !== null && body.sq_ft !== '') {
    const sqFtNum = Number(body.sq_ft)
    if (isNaN(sqFtNum) || sqFtNum < 0 || sqFtNum > 100000) {
      errors.push('Invalid sq_ft — must be a number between 0 and 100,000')
    }
  }

  if (body.monthly_bill !== undefined && body.monthly_bill !== null && body.monthly_bill !== '') {
    const billNum = Number(body.monthly_bill)
    if (isNaN(billNum) || billNum < 0) {
      errors.push('Invalid monthly_bill — must be a non-negative number')
    }
  }

  return errors
}

// ── Supabase REST helpers (no SDK — server-side fetch only) ─────────────────

async function supabaseInsert(table, row, supabaseUrl, serviceRoleKey) {
  const url = `${supabaseUrl}/rest/v1/${table}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(
      `Supabase insert to ${table} failed [${res.status}]: ${JSON.stringify(data)}`
    )
  }

  return Array.isArray(data) ? data[0] : data
}

// ── SPARK notification via agent_messages ────────────────────────────────────

/**
 * Dispatches a SPARK lead notification into the agent_messages table.
 *
 * DATA FIREWALL: Only sanitized fields cross to ops side:
 *   name, service_type, city, email, phone
 *
 * No address, no description, no photos, no financial data.
 */
async function dispatchSparkNotification(sanitizedPayload, confirmationNumber, supabaseUrl, serviceRoleKey) {
  const message = {
    id: generateUUID(),
    from: 'PORTAL',
    to: 'SPARK',
    type: 'data_updated',
    payload: {
      event: 'new_portal_lead',
      confirmation_number: confirmationNumber,
      // DATA FIREWALL: Only these 5 fields allowed across the boundary
      name: sanitizedPayload.name,
      service_type: sanitizedPayload.service_type,
      city: sanitizedPayload.city,
      email: sanitizedPayload.email,
      phone: sanitizedPayload.phone,
    },
    timestamp: Date.now(),
    status: 'pending',
  }

  try {
    await supabaseInsert('agent_messages', message, supabaseUrl, serviceRoleKey)
    console.log('[portal-submit] SPARK notification dispatched:', confirmationNumber)
  } catch (err) {
    // Non-fatal — lead is already written; SPARK notification is best-effort
    console.error('[portal-submit] SPARK dispatch failed (non-fatal):', err.message)
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async (event, _context) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  // Only POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    }
  }

  // Require service role key — never anon key
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[portal-submit] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'Server configuration error. Please contact support.',
      }),
    }
  }

  // Parse body
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

  // Validate fields
  const validationErrors = validateBody(body)
  if (validationErrors.length > 0) {
    return {
      statusCode: 422,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'Validation failed',
        errors: validationErrors,
      }),
    }
  }

  // Build portal_leads row — sanitize all inputs
  const confirmationNumber = generateConfirmationNumber()
  const leadId = generateUUID()

  const leadRow = {
    id: leadId,
    // created_at set by Supabase default (now())
    confirmation_number: confirmationNumber,
    service_type: sanitizeString(body.service_type, 100),
    name: sanitizeString(body.name, 200),
    email: sanitizeString(body.email, 200).toLowerCase(),
    phone: sanitizeString(body.phone, 30),
    address: sanitizeString(body.address, 300),
    city: sanitizeString(body.city, 100),
    description: sanitizeString(body.description, 2000),
    urgency: sanitizeString(body.urgency, 50),
    photos_urls: Array.isArray(body.photos_urls)
      ? body.photos_urls.slice(0, 10).map((u) => sanitizeString(u, 500))
      : [],
    sq_ft: body.sq_ft ? Number(body.sq_ft) || null : null,
    property_type: sanitizeString(body.property_type || '', 50) || null,
    roof_type: sanitizeString(body.roof_type || '', 50) || null,
    utility: sanitizeString(body.utility || '', 100) || null,
    monthly_bill: body.monthly_bill ? Number(body.monthly_bill) || null : null,
    battery_interest: body.battery_interest === true || body.battery_interest === 'true',
    drawings_available: body.drawings_available === true || body.drawings_available === 'true',
    status: 'new',
  }

  // Write to portal_leads — service role key only
  try {
    await supabaseInsert('portal_leads', leadRow, supabaseUrl, serviceRoleKey)
    console.log('[portal-submit] Lead written:', leadId, confirmationNumber)
  } catch (err) {
    console.error('[portal-submit] Supabase write error:', err.message)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'Failed to submit your request. Please try again or call us directly.',
      }),
    }
  }

  // Dispatch SPARK notification (sanitized — 5 fields only, fire-and-forget)
  await dispatchSparkNotification(
    {
      name: leadRow.name,
      service_type: leadRow.service_type,
      city: leadRow.city,
      email: leadRow.email,
      phone: leadRow.phone,
    },
    confirmationNumber,
    supabaseUrl,
    serviceRoleKey
  )

  // Trigger confirmation email (fire-and-forget — handled by portal-confirm-email)
  // We call our own sibling function internally to keep responsibilities separate
  try {
    const baseUrl = process.env.URL || 'https://poweron-hub.netlify.app'
    fetch(`${baseUrl}/.netlify/functions/portal-confirm-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: leadRow.email,
        name: leadRow.name,
        confirmation_number: confirmationNumber,
        service_type: leadRow.service_type,
      }),
    }).catch((err) => {
      console.error('[portal-submit] Confirmation email trigger failed (non-fatal):', err.message)
    })
  } catch (err) {
    // Non-fatal
    console.error('[portal-submit] Confirmation email setup error:', err.message)
  }

  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: true,
      confirmation_number: confirmationNumber,
      message: 'Your request has been received. Check your email for confirmation details.',
    }),
  }
}
