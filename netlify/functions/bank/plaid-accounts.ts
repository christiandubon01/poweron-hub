// @ts-nocheck
/**
 * GET  /.netlify/functions/plaid-accounts                                             -> { accounts[], cashAccounts[] } for the caller's organization
 * POST /.netlify/functions/plaid-accounts  { action: 'discover', itemId }              -> fetch + persist allowlisted account metadata (retry-safe)
 * POST /.netlify/functions/plaid-accounts  { action: 'map', providerAccountId, financialAccountId }  -> owner creates / changes a mapping
 * POST /.netlify/functions/plaid-accounts  { action: 'unmap', providerAccountId }      -> owner removes a mapping (history kept)
 * POST /.netlify/functions/plaid-accounts  { action: 'preview', itemId }               -> PLAID-1A read-only: connected / newly shared / no longer shared
 * POST /.netlify/functions/plaid-accounts  { action: 'save_new', itemId, previewToken } -> PLAID-1A save ONLY the previewed new accounts (unmapped; off by default)
 * Organization comes from the authenticated profile only. No token, credential, balance or raw provider response is ever returned.
 */
import { discoverAccounts, listBankAccounts, mapAccount, previewAccountsForOwner, saveNewAccounts, unmapAccount } from '../../../src/services/bankProvider/bankAccountService'
import { BankConnectionError } from '../../../src/services/bankProvider/bankConnectionService'
import { corsPreflight, errorResponse, jsonResponse, parseJsonBody, resolveBankContext } from './plaidAuth'

export function buildHandler(overrides = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return corsPreflight()
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
    const auth = await resolveBankContext(event, overrides)
    if (!auth.ok) return auth.response
    try {
      if (event.httpMethod === 'GET') return jsonResponse(200, await listBankAccounts(auth.deps, auth.actor))
      const body = parseJsonBody(event)
      if (body.action === 'discover') return jsonResponse(200, await discoverAccounts(auth.deps, auth.actor, { itemId: body.itemId }))
      if (body.action === 'map') return jsonResponse(200, await mapAccount(auth.deps, auth.actor, { providerAccountId: body.providerAccountId, financialAccountId: body.financialAccountId }))
      if (body.action === 'preview') return jsonResponse(200, await previewAccountsForOwner(auth.deps, auth.actor, { itemId: body.itemId }))
      if (body.action === 'save_new') return jsonResponse(200, await saveNewAccounts(auth.deps, auth.actor, { itemId: body.itemId, previewToken: body.previewToken }))
      if (body.action === 'unmap') return jsonResponse(200, await unmapAccount(auth.deps, auth.actor, { providerAccountId: body.providerAccountId }))
      throw new BankConnectionError('invalid_request', 400, 'Unsupported request.')
    } catch (error) {
      return errorResponse(error)
    }
  }
}
export const handler = buildHandler()
