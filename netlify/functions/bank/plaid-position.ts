// @ts-nocheck
/**
 * GET /.netlify/functions/plaid-position?days=30|60|90 -> the consolidated position of the owner's connected money (read-only):
 *   bank cash (current and available, with freshness), card and loan debt, unused credit (not cash), and the window's activity placed by what the OWNER decided.
 *
 * Owner/admin only; organization and role come from the authenticated profile (a request can name neither). Off unless the server sets CASH_OS_POSITION_ENABLED=true:
 * while off it answers { enabled: false } and reads no data. It writes nothing, calls no bank and needs no Plaid credentials. Balance figures additionally need
 * PLAID_BALANCES_ENABLED=true (otherwise they are reported as unavailable, never as zero).
 */
import { getConsolidatedPosition } from '../../../src/services/bankProvider/spending/positionService'
import { createSpendingRepo } from '../../../src/services/bankProvider/spending/spendingRepo'
import { createBankAccountRepo } from '../../../src/services/bankProvider/bankAccountRepo'
import { createBankBalanceRepo } from '../../../src/services/bankProvider/bankBalanceRepo'
import { createBankConnectionRepo } from '../../../src/services/bankProvider/bankConnectionRepo'
import { createHistoryRecoveryRepo } from '../../../src/services/bankProvider/historyRecoveryRepo'
import { balancesEnabled, corsPreflight, errorResponse, historyRecoveryEnabled, jsonResponse, positionEnabled, reconciliationEnabled, resolveOwnerContext, safeLog } from './plaidAuth'

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return corsPreflight()
    if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' })
    const auth = await resolveOwnerContext(event, overrides, 'Only owners and admins can view the cash position.')
    if (!auth.ok) return auth.response
    // The environment is server configuration, never a request value (the same rule as the spending endpoint).
    const environment = (process.env.PLAID_ENV ?? '').trim().toLowerCase() === 'production' ? 'production' : 'sandbox'
    const deps = {
      repo: (overrides.spendingRepo ?? createSpendingRepo)(auth.svc), accounts: (overrides.accountRepo ?? createBankAccountRepo)(auth.svc), balances: (overrides.balanceRepo ?? createBankBalanceRepo)(auth.svc),
      connections: (overrides.connectionRepo ?? createBankConnectionRepo)(auth.svc), log: safeLog, now: overrides.now, environment,
      recovery: (overrides.historyRecoveryRepo ?? createHistoryRecoveryRepo)(auth.svc), historyRecoveryEnabled: (overrides.historyRecoveryEnabled ?? historyRecoveryEnabled)(),
      positionEnabled: (overrides.positionEnabled ?? positionEnabled)(), balancesEnabled: (overrides.balancesEnabled ?? balancesEnabled)(), reconciliationEnabled: (overrides.reconciliationEnabled ?? reconciliationEnabled)(),
    }
    try {
      return jsonResponse(200, await getConsolidatedPosition(deps, auth.actor, event.queryStringParameters ?? {}))
    } catch (error) {
      return errorResponse(error)
    }
  }
}
export const handler = buildHandler()
