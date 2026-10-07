/**
 * src/services/bankProvider/plaidWebhookVerify.ts
 *
 * SERVER-ONLY. Verifies a Plaid webhook per Plaid's documented scheme, using only node:crypto. Checked against:
 *   - Plaid's webhook-verification guide and its Node sample (alg must be ES256; kid selects the key from /webhook_verification_key/get;
 *     iat no more than 5 minutes old; SHA-256 of the body compared to the signed request_body_sha256 with a constant-time compare;
 *     keys are cacheable), and
 *   - the official Plaid SDK's JWKPublicKey typing (alg, crv, kid, kty, use, x, y, created_at, expired_at; `expired_at` is "the
 *     timestamp when the key expired", so ANY non-null value means the key must not be used).
 *
 * Steps (every failure returns false; nothing throws to the caller):
 *   1. the `Plaid-Verification` header is exactly three bounded base64url segments;
 *   2. the JWT header has alg === 'ES256' EXACTLY (so `none`, HS256 "key-confusion", RS256, lower-case variants are all refused) and a
 *      well-formed `kid`; the key alg/kty/crv must also be ES256 / EC / P-256, and the key is used ONLY as an EC public key;
 *   3. the signature (IEEE-P1363, 64 bytes) verifies over `header.payload`;
 *   4. `iat` is a number, not older than 5 minutes and not in the future beyond a 60 s clock skew; an `exp`, if present, must be unexpired;
 *   5. SHA-256 of the EXACT raw request BYTES equals `request_body_sha256` (constant-time). Plaid's hash is sensitive to whitespace, so the
 *      body must never be re-serialised: callers pass the raw bytes as received.
 * Verification only authenticates the NUDGE; no webhook content is trusted as evidence.
 */
import { createHash, createPublicKey, createVerify, timingSafeEqual } from 'node:crypto'
import type { WebhookVerificationKey } from './plaidPort'

export const MAX_WEBHOOK_AGE_SECONDS = 300
export const MAX_WEBHOOK_BYTES = 16 * 1024
const MAX_SEGMENT = 4096
const KID = /^[A-Za-z0-9_-]{1,128}$/
const B64URL = /^[A-Za-z0-9_-]+$/

const b64urlToBuf = (v: string) => Buffer.from(v, 'base64url')
const json = (v: string): any => { try { return JSON.parse(b64urlToBuf(v).toString('utf8')) } catch { return null } }

export function sha256Hex(body: string | Buffer): string { return createHash('sha256').update(body).digest('hex') }

export async function verifyPlaidWebhook(input: {
  /** The EXACT bytes Plaid sent (do not parse and re-serialise). A string is hashed as UTF-8. */
  rawBody: string | Buffer
  verificationHeader: string | undefined
  getKey: (kid: string) => Promise<WebhookVerificationKey | null>
  nowSeconds?: number
}): Promise<boolean> {
  try {
    const { rawBody, verificationHeader } = input
    const length = typeof rawBody === 'string' ? Buffer.byteLength(rawBody, 'utf8') : rawBody.length
    if (typeof verificationHeader !== 'string' || length === 0 || length > MAX_WEBHOOK_BYTES) return false
    const parts = verificationHeader.split('.')
    if (parts.length !== 3 || parts.some(p => p.length === 0 || p.length > MAX_SEGMENT || !B64URL.test(p))) return false
    const header = json(parts[0]), payload = json(parts[1])
    if (!header || typeof header !== 'object' || header.alg !== 'ES256' || typeof header.kid !== 'string' || !KID.test(header.kid)) return false
    if (!payload || typeof payload !== 'object') return false
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
    if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || now - payload.iat > MAX_WEBHOOK_AGE_SECONDS || payload.iat - now > 60) return false
    if (payload.exp !== undefined && (typeof payload.exp !== 'number' || payload.exp <= now)) return false
    const key = await input.getKey(header.kid)
    if (!key || key.kid !== header.kid || key.alg !== 'ES256' || key.kty !== 'EC' || key.crv !== 'P-256') return false
    if (key.expiredAt !== null) return false // a non-null expired_at means the key has been rotated out
    const signature = b64urlToBuf(parts[2])
    if (signature.length !== 64) return false
    const publicKey = createPublicKey({ key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y }, format: 'jwk' })
    if (!createVerify('SHA256').update(`${parts[0]}.${parts[1]}`).verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)) return false
    const expected = Buffer.from(typeof payload.request_body_sha256 === 'string' ? payload.request_body_sha256 : '', 'utf8')
    const actual = Buffer.from(sha256Hex(rawBody), 'utf8')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/**
 * Bounded in-memory cache of Plaid's PUBLIC verification keys (safe to cache: they are public and Plaid's sample caches them).
 * Positive entries expire after `ttlMs` so a key that Plaid later rotates out (expired_at set) is re-fetched; a lookup that fails
 * (unknown or garbage kid) is remembered briefly so an attacker cannot turn every request into a Plaid API call.
 */
export function createWebhookKeyCache(fetchKey: (kid: string) => Promise<WebhookVerificationKey>, opts: { ttlMs?: number; negativeTtlMs?: number; maxEntries?: number; nowMs?: () => number } = {}) {
  const ttl = opts.ttlMs ?? 60 * 60 * 1000, negTtl = opts.negativeTtlMs ?? 60 * 1000, max = opts.maxEntries ?? 16
  const clock = opts.nowMs ?? Date.now
  const cache = new Map<string, { key: WebhookVerificationKey | null; until: number }>()
  return async (kid: string): Promise<WebhookVerificationKey | null> => {
    if (!KID.test(kid)) return null
    const hit = cache.get(kid)
    if (hit && hit.until > clock()) return hit.key
    let key: WebhookVerificationKey | null = null
    try { key = await fetchKey(kid) } catch { key = null }
    if (cache.size >= max) cache.delete(cache.keys().next().value as string) // oldest first
    cache.set(kid, { key, until: clock() + (key ? ttl : negTtl) })
    return key
  }
}
