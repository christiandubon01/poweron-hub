// @ts-nocheck
/**
 * Netlify Function — NDA PIN Verification
 *
 * POST { email, pin, token }
 *   → Verifies the signed JWT issued by sendEmail (type: 'nda_pin')
 *   → Returns { valid: boolean, error?: string }
 *
 * The JWT is signed with HMAC-SHA256 using JWT_SECRET env var.
 * Tokens expire after 10 minutes (enforced via `exp` claim).
 */

const crypto = require('crypto')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

// ── JWT verification ───────────────────────────────────────────────────────────

function verifyPinJwt(token, email, pin) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing_token' }

  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed_token' }

  const [header, payload, sig] = parts
  const secret = process.env.JWT_SECRET || 'poweron-nda-pin-secret'
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url')

  // Constant-time comparison to prevent timing attacks
  if (sig.length !== expected.length) return { ok: false, reason: 'invalid_signature' }
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return { ok: false, reason: 'invalid_signature' }

  let decoded
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed_payload' }
  }

  if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'token_expired' }
  }

  if (decoded.email !== email) return { ok: false, reason: 'email_mismatch' }
  if (decoded.pin !== pin) return { ok: false, reason: 'pin_mismatch' }

  return { ok: true }
}

// ── Handler ────────────────────────────────────────────────────────────────────

exports.handler = async (event, _context) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  let body = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ valid: false, error: 'Invalid JSON body' }),
    }
  }

  const { email, pin, token } = body

  if (!email || !pin || !token) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ valid: false, error: 'Missing required fields: email, pin, token' }),
    }
  }

  const result = verifyPinJwt(token, email, String(pin))

  if (!result.ok) {
    console.log('[verifyPin] Verification failed:', result.reason, '| email:', email)
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ valid: false }),
    }
  }

  console.log('[verifyPin] PIN verified successfully for:', email)
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ valid: true }),
  }
}
