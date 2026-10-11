// @ts-nocheck
/**
 * POST /.netlify/functions/plaid-exchange
 *   body: { publicToken, institutionId? }                  -> exchange a Link public token (new connection). institutionId is Link's
 *                                                             advisory hint; a bank that is already connected is refused (PLAID-1A)
 *   body: { mode: 'update_complete', itemId }              -> confirm a finished update-mode (re-authentication) Link
 * The access token is encrypted server-side and is NEVER returned. The browser only receives a sanitized connection summary.
 */
import { completeUpdateMode, exchangePublicToken } from '../../../src/services/bankProvider/bankConnectionService'
import { corsPreflight, errorResponse, jsonResponse, parseJsonBody, resolveBankContext } from './plaidAuth'

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return corsPreflight()
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    const auth = await resolveBankContext(event, overrides)
    if (!auth.ok) return auth.response
    try {
      const body = parseJsonBody(event)
      if (body.mode === 'update_complete') return jsonResponse(200, await completeUpdateMode(auth.deps, auth.actor, { itemId: body.itemId }))
      return jsonResponse(200, await exchangePublicToken(auth.deps, auth.actor, { publicToken: body.publicToken, institutionId: body.institutionId }))
    } catch (error) {
      return errorResponse(error)
    }
  }
}
export const handler = buildHandler()
