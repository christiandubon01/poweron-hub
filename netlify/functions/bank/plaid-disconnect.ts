// @ts-nocheck
/** POST /.netlify/functions/plaid-disconnect  body: { itemId } -> removes the Item at Plaid, revokes the credential, keeps all history. */
import { disconnectConnection } from '../../../src/services/bankProvider/bankConnectionService'
import { corsPreflight, errorResponse, jsonResponse, parseJsonBody, resolveBankContext } from './plaidAuth'

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return corsPreflight()
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    const auth = await resolveBankContext(event, overrides)
    if (!auth.ok) return auth.response
    try {
      const body = parseJsonBody(event)
      return jsonResponse(200, await disconnectConnection(auth.deps, auth.actor, { itemId: body.itemId }))
    } catch (error) {
      return errorResponse(error)
    }
  }
}
export const handler = buildHandler()
