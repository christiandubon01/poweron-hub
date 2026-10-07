// @ts-nocheck
/**
 * POST /.netlify/functions/plaid-webhook   (called by Plaid, NOT by the browser; authenticated by Plaid's signed JWT, not a user session)
 *
 * WEBHOOK = NUDGE, SYNC = TRUTH. The signature is verified over the RAW body (ES256 JWT, key from /webhook_verification_key/get,
 * iat <= 5 minutes, body SHA-256 match). A verified SYNC_UPDATES_AVAILABLE becomes ONE idempotent event row (no payload stored) that
 * the owner's next sync consumes. No transaction is read from the webhook, no sync runs here (Plaid expects a reply within 10 seconds),
 * and nothing financial is touched. Unknown Items and irrelevant webhook types are acknowledged with 200 and nothing is recorded.
 */
import { loadPlaidConfig } from '../../../src/services/bankProvider/plaidConfig'
import { createPlaidSdkPort } from '../../../src/services/bankProvider/plaidPort'
import { createBankConnectionRepo } from '../../../src/services/bankProvider/bankConnectionRepo'
import { createBankSyncRepo } from '../../../src/services/bankProvider/bankSyncRepo'
import { recordVerifiedWebhook } from '../../../src/services/bankProvider/bankSyncService'
import { MAX_WEBHOOK_BYTES, createWebhookKeyCache, sha256Hex, verifyPlaidWebhook } from '../../../src/services/bankProvider/plaidWebhookVerify'
import { CORS_HEADERS, jsonResponse, safeLog, serviceClient } from './plaidAuth'

let keyCache = null // lazily created: bounded, TTL'd cache of Plaid's PUBLIC verification keys

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    let config
    try { config = loadPlaidConfig(process.env) } catch { return jsonResponse(500, { error: 'Bank connection is not configured.' }) }
    // The EXACT bytes Plaid sent: Plaid's body hash is whitespace-sensitive, so the body is never parsed and re-serialised before hashing.
    const raw = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8')
    if (raw.length === 0 || raw.length > MAX_WEBHOOK_BYTES) return jsonResponse(400, { error: 'Invalid request.' })
    const plaid = (overrides.plaidPort ?? createPlaidSdkPort)(config)
    const getKey = overrides.getKey ?? (keyCache ??= createWebhookKeyCache(kid => plaid.getWebhookVerificationKey(kid)))
    const header = event.headers?.['plaid-verification'] || event.headers?.['Plaid-Verification']
    const verified = await (overrides.verify ?? verifyPlaidWebhook)({ rawBody: raw, verificationHeader: header, getKey })
    if (!verified) { safeLog({ event: 'bank.webhook.rejected', code: 'invalid_signature' }); return jsonResponse(401, { error: 'Invalid webhook.' }) }
    let body
    try { body = JSON.parse(raw.toString('utf8')) } catch { return jsonResponse(400, { error: 'Invalid request.' }) }
    try {
      const svc = (overrides.serviceClient ?? serviceClient)()
      if (!svc) return jsonResponse(500, { error: 'Server unavailable.' })
      const deps = { repo: (overrides.connectionRepo ?? createBankConnectionRepo)(svc), sync: (overrides.syncRepo ?? createBankSyncRepo)(svc), log: safeLog }
      await recordVerifiedWebhook(deps, { webhookType: body?.webhook_type, webhookCode: body?.webhook_code, plaidItemId: body?.item_id, bodyHash: sha256Hex(raw) })
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) }
    } catch {
      safeLog({ event: 'bank.webhook.failed', code: 'persistence_failed' })
      return jsonResponse(500, { error: 'Request failed.' }) // non-200 makes Plaid retry
    }
  }
}
export const handler = buildHandler()
