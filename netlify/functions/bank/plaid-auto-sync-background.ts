// @ts-nocheck
/**
 * PLAID-2A · POST plaid-auto-sync-background  { itemId }  — the automatic sync worker (webhook and schedule only KICK IT OFF).
 *
 * NO USER SESSION. Authenticated by an HMAC signature (key derived from the service-role key, bound to the Item id, valid 5 minutes), never by a bearer
 * token. It then reads the Item with the service role, refuses anything that is not a HEALTHY PRODUCTION Plaid Item, and runs the existing resumable
 * sync in a loop (autoSync.ts). Concurrency is the Item's own lease: if a manual sync or another run holds it, this stops quietly.
 * Handled outcomes answer 200 so the platform never retries on its own; the outcome is in the log and in the Item's sync status.
 */
import { AUTO_SYNC_BUDGET_MS, autoSyncEnabled, buildAutoSyncDeps, runAutoSyncForItem, verifyAutoSyncRequest } from '../../../src/services/bankProvider/autoSync'
import { createBankConnectionRepo } from '../../../src/services/bankProvider/bankConnectionRepo'
import { jsonResponse, parseJsonBody, resumableSyncEnabled, safeLog, serviceClient } from './plaidAuth'

export function buildHandler(overrides = {}) {
  return async (event) => {
    const env = overrides.env ?? process.env
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    if (!autoSyncEnabled(env)) { safeLog({ event: 'bank.autosync.refused', code: 'disabled' }); return jsonResponse(403, { error: 'Automatic sync is not enabled.' }) }
    let itemId
    try { itemId = parseJsonBody(event).itemId } catch { return jsonResponse(400, { error: 'Invalid request.' }) }
    const header = name => event.headers?.[name] ?? event.headers?.[name.toLowerCase()]
    const signed = verifyAutoSyncRequest(env.SUPABASE_SERVICE_ROLE_KEY ?? '', { itemId, timestamp: header('x-poweron-ts'), signature: header('x-poweron-sig') }, overrides.now?.())
    if (!signed) { safeLog({ event: 'bank.autosync.refused', code: 'bad_signature' }); return jsonResponse(401, { error: 'Not authorized.' }) }
    if (!resumableSyncEnabled(env)) { safeLog({ event: 'bank.autosync.refused', code: 'resumable_sync_off' }); return jsonResponse(409, { error: 'Resumable sync is not enabled.' }) }
    try {
      const svc = (overrides.serviceClient ?? serviceClient)()
      if (!svc) return jsonResponse(500, { error: 'Server unavailable.' })
      const item = await createBankConnectionRepo(svc).findItemById(itemId)
      if (!item || item.provider !== 'plaid' || item.status !== 'healthy' || item.environment !== 'production') {
        safeLog({ event: 'bank.autosync.skipped', itemId: item?.id, organizationId: item?.organizationId, code: 'not_healthy_production' })
        return jsonResponse(200, { outcome: 'skipped' })
      }
      const deps = (overrides.buildDeps ?? buildAutoSyncDeps)(svc, env, safeLog)
      const result = await (overrides.run ?? runAutoSyncForItem)(deps, item, { budgetMs: AUTO_SYNC_BUDGET_MS })
      safeLog({ event: 'bank.autosync.finished', organizationId: item.organizationId, itemId: item.id, outcome: result.outcome, code: result.code, detail: 'steps=' + result.steps })
      return jsonResponse(200, { outcome: result.outcome })
    } catch {
      safeLog({ event: 'bank.autosync.failed', code: 'internal' })
      return jsonResponse(200, { outcome: 'error' })
    }
  }
}
export const handler = buildHandler()
