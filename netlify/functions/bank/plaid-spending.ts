// @ts-nocheck
/**
 * GET  /.netlify/functions/plaid-spending?view=&from=&to=&bucket=&...  -> the Spending Explorer: analytics + filtered rows + picker options
 * POST /.netlify/functions/plaid-spending  { action, transactionId, ... } -> ONE owner decision (set_bucket / set_relationship /
 *      accept_suggestion / reject_suggestion / undo / ignore / unignore)
 *
 * PLAID-3B: GET ?matches=1 is the Matches review; POST { action: 'match_confirm' | 'match_reject' | 'match_reverse', outflowId, inflowId, fingerprint } records ONE pair decision.
 * GREENLIGHT-1: POST { action: 'refund_confirm' | 'refund_reject' | 'refund_undo', transactionId } answers a proposed refund (always the category 'refund'; reconciliation only).
 * PLAID TRANSACTION = EVIDENCE. This endpoint reads provider evidence and writes ONLY interpretation rows. It never creates a ledger
 * transaction, changes a balance or include_in_cash, marks a bill or debt paid, records a project payment, or touches payroll or Outlook.
 * Organization and role come from the authenticated profile only (a body organizationId is ignored). Owner/admin only.
 */
import { relatedTransactions, previewCategoryBatch, confirmCategoryBatch } from '../../../src/services/bankProvider/spending/merchantExplorer'
import { previewDefinitionCleanup } from '../../../src/services/bankProvider/spending/definitionCleanup'
import { reconciliationImpact } from '../../../src/services/bankProvider/spending/reconciliationImpact'
import { decideMatch, getMatchReview } from '../../../src/services/bankProvider/spending/matchReviewService'
import { applyDecision, decideRefund, getExplorer, getSmartReview, getSpendingReport, getTransactionHistory } from '../../../src/services/bankProvider/spending/spendingService'
import { createSpendingRepo } from '../../../src/services/bankProvider/spending/spendingRepo'
import { BankConnectionError } from '../../../src/services/bankProvider/bankConnectionService'
import { corsPreflight, errorResponse, jsonResponse, parseJsonBody, reconciliationEnabled, resolveOwnerContext, safeLog } from './plaidAuth'

const ACTIONS = new Set(['preview_categories', 'confirm_categories', 'confirm_batch', 'set_bucket', 'set_relationship', 'accept_suggestion', 'reject_suggestion', 'undo', 'ignore', 'unignore', 'forget_rule', 'match_confirm', 'match_reject', 'match_reverse', 'refund_confirm', 'refund_reject', 'refund_undo'])

// a batch carries up to 100 ids plus category choices and remembered-merchant ids (~12 KB); every other action is tiny
const body_limit = (event) => (String(event.body || '').match(/preview_categories|confirm_categories/) ? 262144 : String(event.body || '').includes('confirm_batch') ? 16384 : 4096)

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return corsPreflight()
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    const auth = await resolveOwnerContext(event, overrides, 'Only owners and admins can review spending.')
    if (!auth.ok) return auth.response
    // The environment is server configuration, never a request value. Spending only READS evidence, so it needs no Plaid credentials.
    const environment = (process.env.PLAID_ENV ?? '').trim().toLowerCase() === 'production' ? 'production' : 'sandbox'
    // PLAID-3A: the reconciliation switch is server configuration (CASH_OS_RECONCILIATION_ENABLED), default off, and is stamped on every context by the service layer.
    const deps = { repo: (overrides.spendingRepo ?? createSpendingRepo)(auth.svc), log: safeLog, now: overrides.now, environment, reconciliationEnabled: (overrides.reconciliationEnabled ?? reconciliationEnabled)() }
    try {
      if (event.httpMethod === 'GET') {
        const q = event.queryStringParameters ?? {}
        if (q.definition_preview !== undefined) return jsonResponse(200, await previewDefinitionCleanup(auth.svc,auth.actor,q.definition_type,q.definition_preview))
        if (q.impact !== undefined) return jsonResponse(200, await reconciliationImpact(deps, auth.actor, q)) // PLAID-3A: read-only OFF-versus-ON comparison, available while the switch is OFF
        if (q.matches !== undefined) return jsonResponse(200, await getMatchReview(deps, auth.actor, q)) // PLAID-3B: the Matches review (read-only; off unless the reconciliation switch is on)
        if (q.related !== undefined) return jsonResponse(200, await relatedTransactions(deps,auth.actor,q))
        if (q.report !== undefined) return jsonResponse(200, await getSpendingReport(deps, auth.actor, q))
        if (typeof q.history === 'string') return jsonResponse(200, await getTransactionHistory(deps, auth.actor, q.history)) // the audit trail of ONE transaction
        if (q.smart === '1') return jsonResponse(200, await getSmartReview(deps, auth.actor, q)) // BANK-6B: grouped review, read-only
        return jsonResponse(200, await getExplorer(deps, auth.actor, q))
      }
      const body = parseJsonBody(event, body_limit(event))
      if (!ACTIONS.has(body.action)) throw new BankConnectionError('invalid_request', 400, 'Unsupported request.')
      if (body.action.startsWith('match_')) return jsonResponse(200, await decideMatch(deps, auth.actor, { decision: body.action.slice(6), outflowId: body.outflowId, inflowId: body.inflowId, fingerprint: body.fingerprint })) // PLAID-3B: ids + the fingerprint the owner saw; nothing else is trusted
      if (body.action.startsWith('refund_')) return jsonResponse(200, await decideRefund(deps, auth.actor, { decision: body.action.slice(7), transactionId: body.transactionId })) // GREENLIGHT-1: always about the category 'refund'
      if(body.action==='preview_categories')return jsonResponse(200,await previewCategoryBatch(deps,auth.actor,body))
      if(body.action==='confirm_categories')return jsonResponse(200,await confirmCategoryBatch(deps,auth.actor,body))
      return jsonResponse(200, await applyDecision(deps, auth.actor, body)) // the body can never name an organization
    } catch (error) {
      return errorResponse(error)
    }
  }
}
export const handler = buildHandler()
