/**
 * src/services/quickbooks/quickbooksState.ts
 *
 * Stateless, signed OAuth `state` envelope for CSRF protection and PowerOn
 * user/org binding.
 *
 * Design:
 *  - HMAC-SHA256 over a base64url JSON payload, using a server-only secret.
 *  - Constant-time signature comparison (crypto.timingSafeEqual).
 *  - Expiry via an `exp` claim (stateless — no server/browser storage needed).
 *  - Binds the attempt to PowerOn userId + orgId (minimum necessary context).
 *  - Versioned so legacy/different envelopes are rejected.
 *
 * No dependency is installed for this — only platform-native node:crypto.
 */
import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { QBO_STATE_TTL_SECONDS, QBO_STATE_VERSION } from './quickbooksConstants'
import type { QboSignedState, QboStateContext } from './quickbooksTypes'

interface QboStatePayload {
  v: number
  iat: number
  exp: number
  nonce: string
  uid: string
  org: string
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url')
}

export type QboStateVerifyReason = 'malformed' | 'invalid_signature' | 'expired' | 'missing_context'

export type QboStateVerifyResult =
  | { ok: true; context: QboStateContext; expiresAt: number; nonce: string }
  | { ok: false; reason: QboStateVerifyReason }

/**
 * Sign a stateless OAuth state envelope binding the attempt to PowerOn user/org.
 */
export function signState(
  ctx: QboStateContext,
  secret: string,
  options?: { ttlSeconds?: number; now?: number; nonce?: string },
): QboSignedState {
  const now = options?.now ?? Date.now()
  const ttl = options?.ttlSeconds ?? QBO_STATE_TTL_SECONDS
  const nonce = options?.nonce ?? randomBytes(16).toString('hex')
  const expiresAt = now + ttl * 1000
  const payload: QboStatePayload = {
    v: QBO_STATE_VERSION,
    iat: now,
    exp: expiresAt,
    nonce,
    uid: ctx.userId,
    org: ctx.orgId,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = signPayload(payloadB64, secret)
  return { state: `${payloadB64}.${sig}`, nonce, expiresAt }
}

/**
 * Verify a returned state envelope: signature, version, expiry, and required
 * PowerOn user/org context.
 */
export function verifyState(state: string, secret: string, options?: { now?: number }): QboStateVerifyResult {
  if (!state || typeof state !== 'string') return { ok: false, reason: 'malformed' }
  const dot = state.indexOf('.')
  if (dot <= 0 || dot === state.length - 1) return { ok: false, reason: 'malformed' }
  const payloadB64 = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  const expected = signPayload(payloadB64, secret)

  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length) return { ok: false, reason: 'invalid_signature' }
  if (!timingSafeEqual(sigBuf, expBuf)) return { ok: false, reason: 'invalid_signature' }

  let payload: QboStatePayload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.v !== QBO_STATE_VERSION) return { ok: false, reason: 'malformed' }
  const now = options?.now ?? Date.now()
  if (typeof payload.exp !== 'number' || payload.exp < now) return { ok: false, reason: 'expired' }
  if (!payload.uid || !payload.org) return { ok: false, reason: 'missing_context' }
  if (!payload.nonce) return { ok: false, reason: 'malformed' }
  return {
    ok: true,
    context: { userId: payload.uid, orgId: payload.org },
    expiresAt: payload.exp,
    nonce: payload.nonce,
  }
}