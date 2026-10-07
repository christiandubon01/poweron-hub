// @ts-nocheck
/** GET /.netlify/functions/plaid-connection-status -> { environment, connected, connections[] } for the caller's organization only. */
import { getConnectionStatus } from '../../../src/services/bankProvider/bankConnectionService'
import { corsPreflight, errorResponse, jsonResponse, resolveBankContext } from './plaidAuth'

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return corsPreflight()
    if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' })
    const auth = await resolveBankContext(event, overrides)
    if (!auth.ok) return auth.response
    try {
      return jsonResponse(200, await getConnectionStatus(auth.deps, auth.actor))
    } catch (error) {
      return errorResponse(error)
    }
  }
}
export const handler = buildHandler()
