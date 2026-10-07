// @ts-nocheck
/**
 * GET  /.netlify/functions/plaid-spending?view=&from=&to=&bucket=&...  -> the Spending Explorer: analytics + filtered rows + picker options
 * POST /.netlify/functions/plaid-spending  { action, transactionId, ... } -> ONE owner decision (set_bucket / set_relationship /
 *      accept_suggestion / reject_suggestion / undo / ignore / unignore)
 *
 * PLAID TRANSACTION = EVIDENCE. This endpoint reads provider evidence and writes ONLY interpretation rows. It never creates a ledger
 * transaction, changes a balance or include_in_cash, marks a bill or debt paid, records a project payment, or touches payroll or Outlook.
 * Organization and role come from the authenticated profile only (a body organizationId is ignored). Owner/admin only.
 */
import { applyDecision, getExplorer } from '../../../src/services/bankProvider/spending/spendingService'
import { createSpendingRepo } from '../../../src/services/bankProvider/spending/spendingRepo'
import { BankConnectionError } from '../../../src/services/bankProvider/bankConnectionService'
import { corsPreflight, errorResponse, jsonResponse, parseJsonBody, resolveOwnerContext, safeLog } from './plaidAuth'

const ACTIONS = new Set(['set_bucket', 'set_relationship', 'accept_suggestion', 'reject_suggestion', 'undo', 'ignore', 'unignore'])

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return corsPreflight()
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    const auth = await resolveOwnerContext(event, overrides, 'Only owners and admins can review spending.')
    if (!auth.ok) return auth.response
    const deps = { repo: (overrides.spendingRepo ?? createSpendingRepo)(auth.svc), log: safeLog, now: overrides.now }
    try {
      if (event.httpMethod === 'GET') return jsonResponse(200, await getExplorer(deps, auth.actor, event.queryStringParameters ?? {}))
      const body = parseJsonBody(event)
      if (!ACTIONS.has(body.action)) throw new BankConnectionError('invalid_request', 400, 'Unsupported request.')
      return jsonResponse(200, await applyDecision(deps, auth.actor, body)) // the body can never name an organization
    } catch (error) {
      return errorResponse(error)
    }
  }
}
export const handler = buildHandler()
