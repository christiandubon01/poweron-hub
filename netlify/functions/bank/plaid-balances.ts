// @ts-nocheck
/**
 * GET  /.netlify/functions/plaid-balances                      -> { enabled, accounts[] } newest balance per live bank account, interpreted (bank cash / card debt / unused credit kept apart, with freshness)
 * POST /.netlify/functions/plaid-balances { action: 'refresh', itemId } -> one cached /accounts/get, stored as append-only snapshots
 * Owner/admin only; organization comes from the authenticated profile. Off unless PLAID_BALANCES_ENABLED=true. Never writes the ledger, a Cash OS account or a mapping.
 */
import { getBalances, refreshBalances } from '../../../src/services/bankProvider/bankBalanceService'
import { createBankBalanceRepo } from '../../../src/services/bankProvider/bankBalanceRepo'
import { BankConnectionError } from '../../../src/services/bankProvider/bankConnectionService'
import { balancesEnabled, corsPreflight, errorResponse, jsonResponse, parseJsonBody, resolveBankContext } from './plaidAuth'

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return corsPreflight()
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    const auth = await resolveBankContext(event, overrides)
    if (!auth.ok) return auth.response
    const deps = { ...auth.deps, balancesEnabled: balancesEnabled(), balances: (overrides.balanceRepo ?? createBankBalanceRepo)(auth.svc) }
    try {
      if (event.httpMethod === 'GET') return jsonResponse(200, await getBalances(deps, auth.actor))
      const body = parseJsonBody(event)
      if (body.action === 'refresh') return jsonResponse(200, await refreshBalances(deps, auth.actor, { itemId: body.itemId }))
      throw new BankConnectionError('invalid_request', 400, 'Unsupported request.')
    } catch (error) {
      return errorResponse(error)
    }
  }
}
export const handler = buildHandler()
