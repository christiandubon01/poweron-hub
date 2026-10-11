// @ts-nocheck
/**
 * PLAID-1B · POST plaid-sync-background  { itemId }  — the long-running owner sync (NOT ROUTED YET, see below).
 *
 * Netlify runs a function whose top-level file name ends in "-background" asynchronously for up to 15 minutes and answers the caller 202 at once.
 * This handler is deliberately kept under netlify/functions/bank/ (Netlify does not route nested files), so it is NOT deployed as an endpoint.
 * Activation (separate owner approval, after confirming the site's plan supports background functions) is ONE new top-level file:
 *     netlify/functions/plaid-sync-background.ts  ->  export { handler } from './bank/plaid-sync-background'
 * plus PLAID_BACKGROUND_SYNC_ENABLED=true.
 *
 * Security: the same boundary as plaid-sync. The caller's Supabase session is verified, the organization and role come from the caller's profile
 * (never the body), owner/admin only; the body can name only an Item id, which is re-read under that organization. Nothing is returned to the
 * caller (Netlify discards a background function's response); the outcome is visible through GET plaid-sync and the Netlify log.
 * Handled outcomes answer 200 so the platform does not retry on its own: repeating a sync is the owner's explicit, safe choice.
 */
import { BACKGROUND_SYNC_BUDGET_MS, BACKGROUND_SYNC_LEASE_MS, syncTransactions } from '../../../src/services/bankProvider/bankSyncService'
import { BankConnectionError } from '../../../src/services/bankProvider/bankConnectionService'
import { backgroundSyncEnabled, jsonResponse, parseJsonBody, resolveBankContext, safeLog } from './plaidAuth'

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    if (!backgroundSyncEnabled()) { safeLog({ event: 'bank.sync.background_refused', code: 'disabled' }); return jsonResponse(403, { error: 'Background sync is not enabled.', code: 'feature_disabled' }) }
    const auth = await resolveBankContext(event, overrides)
    if (!auth.ok) { safeLog({ event: 'bank.sync.background_refused', code: `http_${auth.response.statusCode}` }); return auth.response }
    let itemId
    try { itemId = parseJsonBody(event).itemId } catch { return jsonResponse(400, { error: 'Invalid request.' }) }
    try {
      const result = await (overrides.sync ?? syncTransactions)(auth.deps, auth.actor, { itemId },
        { budgetMs: BACKGROUND_SYNC_BUDGET_MS, leaseMs: BACKGROUND_SYNC_LEASE_MS, trigger: 'owner_background' })
      return jsonResponse(200, { outcome: 'completed', state: result.state })
    } catch (error) {
      // The failure is already recorded on the Item (state, sanitized code) by the sync service. Never a stack or message.
      const code = error instanceof BankConnectionError ? error.code : 'internal'
      if (!(error instanceof BankConnectionError)) safeLog({ event: 'bank.sync.background_unhandled', organizationId: auth.actor.organizationId, code: 'internal' })
      return jsonResponse(200, { outcome: 'not_completed', code })
    }
  }
}
export const handler = buildHandler()
