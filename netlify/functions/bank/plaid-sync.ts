// @ts-nocheck
/**
 * GET  /.netlify/functions/plaid-sync                          -> { syncs[] } sanitized per-connection sync status (state, last synced, evidence COUNTS, updatesAvailable)
 * POST /.netlify/functions/plaid-sync  { action: 'sync', itemId } -> owner-requested /transactions/sync of one connection (raw evidence only)
 * PLAID-2H: POST { action: 'discard_blocked_run', itemId, runId, confirm: 'DISCARD' } drops a blocked staged update after owner review (evidence and cursor untouched).
 * PLAID-2A: POST { action: 'relink_pending', itemId } re-runs pending-to-posted continuity (only when PLAID_PENDING_CONTINUITY_ENABLED is on).
 * Organization comes from the authenticated profile only. Owner/admin only. No token, cursor, transaction text or raw provider data is returned.
 * PLAID-1B: when PLAID_BACKGROUND_SYNC_ENABLED is on, syncs run only in plaid-sync-background (this short request would hold the long lease).
 * PLAID-1C: POST { action: 'sync_step', itemId } runs ONE bounded step of a resumable sync (only when PLAID_RESUMABLE_SYNC_ENABLED is on, which also
 * retires the single-request 'sync' action). The browser repeats the step while the answer says { more: true }.
 */
import { getSyncStatus, syncTransactions } from '../../../src/services/bankProvider/bankSyncService'
import { discardBlockedRun, relinkPendingPosted, resumableSyncStep } from '../../../src/services/bankProvider/resumableSync'
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
      if (body.action === 'sync_step') return jsonResponse(200, await resumableSyncStep(auth.deps, auth.actor, { itemId: body.itemId }))
      if (body.action === 'discard_blocked_run') return jsonResponse(200, await discardBlockedRun(auth.deps, auth.actor, { itemId: body.itemId, runId: body.runId, confirm: body.confirm }))
      if (body.action === 'relink_pending') return jsonResponse(200, await relinkPendingPosted(auth.deps, auth.actor, { itemId: body.itemId }))
      if (body.action === 'sync' && auth.deps.resumableSyncEnabled) throw new BankConnectionError('conflict', 409, 'Syncs on this server run in resumable steps. Press Sync again from the bank card.')
      if (body.action === 'sync' && auth.deps.backgroundSyncEnabled) throw new BankConnectionError('conflict', 409, 'Syncs run in the background on this server. Use Sync again from the bank card.')
      if (body.action === 'sync') return jsonResponse(200, await syncTransactions(auth.deps, auth.actor, { itemId: body.itemId }))
      throw new BankConnectionError('invalid_request', 400, 'Unsupported request.')
    } catch (error) {
      return errorResponse(error)
    }
  }
}
export const handler = buildHandler()
