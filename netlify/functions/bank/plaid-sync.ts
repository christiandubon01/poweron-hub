// @ts-nocheck
/**
 * GET  /.netlify/functions/plaid-sync                          -> { syncs[] } sanitized per-connection sync status (state, last synced, evidence COUNTS, updatesAvailable)
 * POST /.netlify/functions/plaid-sync  { action: 'sync', itemId } -> owner-requested /transactions/sync of one connection (raw evidence only)
 * Organization comes from the authenticated profile only. Owner/admin only. No token, cursor, transaction text or raw provider data is returned.
 */
import { getSyncStatus, syncTransactions } from '../../../src/services/bankProvider/bankSyncService'
import { BankConnectionError } from '../../../src/services/bankProvider/bankConnectionService'
import { corsPreflight, errorResponse, jsonResponse, parseJsonBody, resolveBankContext } from './plaidAuth'

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return corsPreflight()
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    const auth = await resolveBankContext(event, overrides)
    if (!auth.ok) return auth.response
    try {
      if (event.httpMethod === 'GET') return jsonResponse(200, await getSyncStatus(auth.deps, auth.actor))
      const body = parseJsonBody(event)
      if (body.action === 'sync') return jsonResponse(200, await syncTransactions(auth.deps, auth.actor, { itemId: body.itemId }))
      throw new BankConnectionError('invalid_request', 400, 'Unsupported request.')
    } catch (error) {
      return errorResponse(error)
    }
  }
}
export const handler = buildHandler()
