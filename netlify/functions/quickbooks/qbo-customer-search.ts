// @ts-nocheck
/**
 * netlify/functions/quickbooks/qbo-customer-search.ts
 *
 * QBO-4A.3 Task 3 — Search existing QuickBooks customers in the CURRENT company.
 *
 * Browser endpoint: /.netlify/functions/qbo-customer-search  (GET)
 *   query params:
 *     q          — search term, matched against QBO DisplayName (LIKE '%q%').
 *                  Required, trimmed, 1..100 chars. Server-built query — the
 *                  browser NEVER supplies a raw QBO SQL string.
 *     activeOnly — optional ('1'/'true' => only Active=true customers). Default
 *                  returns BOTH active and inactive so the owner can see the full
 *                  picture (inactive names can still trip the 6240 duplicate-name
 *                  error). Inactive customers are returned with active:false.
 *
 * Response (sanitized — no realmId/fingerprint/tokens/SyncToken/raw metadata):
 *   { customers: [{ id, displayName, companyName, email, phone, active }] }
 *
 * The query is BUILT server-side from a bounded, single-quote-escaped literal. The
 * browser cannot inject raw SQL: the term is only ever placed inside a quoted LIKE
 * operand, and single quotes are doubled (O'Brien -> O''Brien), so the operand can
 * never break out of the string literal.
 */
import { toCustomerSummary, type QboCustomerSummary, QboCustomerApiError, buildCustomerSearchQuery } from '../../../src/services/quickbooks/qboCustomerContract'
import { queryCustomersWithBearer } from '../../../src/services/quickbooks/qboAccountingClient'
import {
  CORS_HEADERS,
  corsPreflight,
  jsonResponse,
  resolveCustomerApiContext,
  resolveQboCompanyScope,
} from './qboCustomerAuth'

/** Max search-term length (bounded input). */
const SEARCH_TERM_MAX = 100

function parseBool(value: string | undefined): boolean {
  if (value === undefined) return false
  return value === '1' || value === 'true' || value === 'yes'
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight()
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const auth = await resolveCustomerApiContext(event)
  if (!auth.ok) return auth.response
  const ctx = auth.ctx

  const qs = event.queryStringParameters || {}
  const term = typeof qs.q === 'string' ? qs.q.trim() : ''
  if (!term) {
    return jsonResponse(400, { error: 'A search term is required.' })
  }
  if (term.length > SEARCH_TERM_MAX) {
    return jsonResponse(400, { error: 'Search term is too long.' })
  }

  const scope = await resolveQboCompanyScope(ctx)
  if (!scope.ok) return scope.response

  const query = buildCustomerSearchQuery(term, { activeOnly: parseBool(qs.activeOnly) })
  let rawCustomers: unknown[]
  try {
    rawCustomers = await queryCustomersWithBearer(scope.scope.bearer, ctx.fetchImpl, query)
  } catch (err) {
    if (err instanceof QboCustomerApiError) {
      return jsonResponse(502, { error: err.toSanitized().message })
    }
    return jsonResponse(502, { error: 'QuickBooks search failed.' })
  }

  const customers: QboCustomerSummary[] = []
  for (const raw of rawCustomers) {
    const summary = toCustomerSummary(raw)
    if (summary) customers.push(summary)
  }
  return jsonResponse(200, { customers })
}