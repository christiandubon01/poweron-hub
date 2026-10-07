// @ts-nocheck
/** POST /.netlify/functions/plaid-link-token  body: { mode?: 'new' | 'update', itemId?: string }  -> { linkToken, expiration, mode } */
import { createLinkToken } from '../../../src/services/bankProvider/bankConnectionService'
import { corsPreflight, errorResponse, jsonResponse, parseJsonBody, resolveBankContext } from './plaidAuth'

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return corsPreflight()
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    const auth = await resolveBankContext(event, overrides)
    if (!auth.ok) return auth.response
    try {
      const body = parseJsonBody(event)
      // The body can name a mode and an item; it can NEVER name an organization (an organizationId field is ignored).
      return jsonResponse(200, await createLinkToken(auth.deps, auth.actor, { mode: body.mode, itemId: body.itemId }))
    } catch (error) {
      return errorResponse(error)
    }
  }
}
export const handler = buildHandler()
