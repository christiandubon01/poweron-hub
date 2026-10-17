// @ts-nocheck
/** Owner-only controlled 730-day replacement workflow. No action here disconnects the source Item. */
import { activateHistoryRecovery, confirmHistoryRecoveryAccount, confirmHistoryRecoveryTransaction, createHistoryRecoveryLinkToken, getHistoryRecoveries, prepareHistoryRecoveryAccounts, reconcileHistoryRecovery } from '../../../src/services/bankProvider/historyRecoveryService'
import { corsPreflight, errorResponse, jsonResponse, parseJsonBody, resolveBankContext } from './plaidAuth'

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return corsPreflight()
    if (!['GET', 'POST'].includes(event.httpMethod)) return jsonResponse(405, { error: 'Method not allowed' })
    const auth = await resolveBankContext(event, overrides)
    if (!auth.ok) return auth.response
    try {
      if (event.httpMethod === 'GET') return jsonResponse(200, await getHistoryRecoveries(auth.deps, auth.actor))
      const body = parseJsonBody(event)
      if (body.action === 'start') return jsonResponse(200, await createHistoryRecoveryLinkToken(auth.deps, auth.actor, { sourceItemId: body.sourceItemId }))
      if (body.action === 'prepare_accounts') return jsonResponse(200, await prepareHistoryRecoveryAccounts(auth.deps, auth.actor, body.recoveryId))
      if (body.action === 'confirm_account') return jsonResponse(200, await confirmHistoryRecoveryAccount(auth.deps, auth.actor, body))
      if (body.action === 'confirm_transaction') return jsonResponse(200, await confirmHistoryRecoveryTransaction(auth.deps, auth.actor, body))
      if (body.action === 'reconcile') return jsonResponse(200, await reconcileHistoryRecovery(auth.deps, auth.actor, body.recoveryId))
      if (body.action === 'activate') return jsonResponse(200, await activateHistoryRecovery(auth.deps, auth.actor, body.recoveryId))
      return jsonResponse(400, { error: 'Unsupported recovery action.' })
    } catch (error) { return errorResponse(error) }
  }
}
export const handler = buildHandler()
