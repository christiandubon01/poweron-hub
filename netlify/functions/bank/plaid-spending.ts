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
import { applyDecision, getExplorer, getSmartReview, getTransactionHistory } from '../../../src/services/bankProvider/spending/spendingService'
import { createSpendingRepo } from '../../../src/services/bankProvider/spending/spendingRepo'
import { BankConnectionError } from '../../../src/services/bankProvider/bankConnectionService'
import { corsPreflight, errorResponse, jsonResponse, parseJsonBody, resolveOwnerContext, safeLog } from './plaidAuth'

const ACTIONS = new Set(['confirm_batch', 'set_bucket', 'set_relationship', 'accept_suggestion', 'reject_suggestion', 'undo', 'ignore', 'unignore', 'forget_rule'])

// a batch carries up to 100 ids plus category choices and remembered-merchant ids (~12 KB); every other action is tiny
const body_limit = (event) => (String(event.body || '').includes('confirm_batch') ? 16384 : 4096)

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return corsPreflight()
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    const auth = await resolveOwnerContext(event, overrides, 'Only owners and admins can review spending.')
    if (!auth.ok) return auth.response
    // The environment is server configuration, never a request value. Spending only READS evidence, so it needs no Plaid credentials.
    const environment = (process.env.PLAID_ENV ?? '').trim().toLowerCase() === 'production' ? 'production' : 'sandbox'
    const deps = { repo: (overrides.spendingRepo ?? createSpendingRepo)(auth.svc), log: safeLog, now: overrides.now, environment }
    try {
      if (event.httpMethod === 'GET') {
        const q = event.queryStringParameters ?? {}
        if (typeof q.history === 'string') return jsonResponse(200, await getTransactionHistory(deps, auth.actor, q.history)) // the audit trail of ONE transaction
        if (q.smart === '1') return jsonResponse(200, await getSmartReview(deps, auth.actor, q)) // BANK-6B: grouped review, read-only
        return jsonResponse(200, await getExplorer(deps, auth.actor, q))
      }
      const body = parseJsonBody(event, body_limit(event))
      if (!ACTIONS.has(body.action)) throw new BankConnectionError('invalid_request', 400, 'Unsupported request.')
      return jsonResponse(200, await applyDecision(deps, auth.actor, body)) // the body can never name an organization
    } catch (error) {
      return errorResponse(error)
    }
  }
}
export const handler = buildHandler()
