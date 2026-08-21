// @ts-nocheck
/**
 * netlify/functions/quickbooks/qbo-customer-mapping.ts
 *
 * QBO-4A.3 Task 4 — "Is this PowerOn customer linked to the CURRENT QuickBooks
 * company?" The smallest Customer-mapping endpoint.
 *
 * Browser endpoint: /.netlify/functions/qbo-customer-mapping  (GET)
 *   query params:
 *     poweronCustomerId — the canonical PowerOn customer identity (relationship_accounts.id,
 *                         a TEXT id such as 'gc…' / 'import_gc…'). Validated server-side by
 *                         ORG-SCOPED EXISTENCE (assertCanonicalPowerOnCustomerId); a name,
 *                         arbitrary text, or an id belonging to another org is rejected with
 *                         400. The browser NEVER chooses org authority, realmId,
 *                         fingerprint, or environment — all derived here.
 *
 * Response (sanitized — no realmId/fingerprint/tokens):
 *   { linked: false }  — when not connected, or connected but no active mapping.
 *   { linked: true, customer: { id, displayName, active }, linkOrigin }
 *
 * When QuickBooks is not connected there is no "current QBO company" to be linked
 * to, so the answer is simply linked:false (no secret is revealed; the separate
 * connection-status endpoint reports the connection state).
 */
import {
  loadCurrentCustomerMapping,
  sanitizeCustomerMapping,
  type QboCustomerMappingScope,
  QboCustomerMappingIdentityError,
} from '../../../src/services/quickbooks/quickbooksCustomerMappingStore'
import { assertCanonicalPowerOnCustomerId } from './qboCustomerIdentity'
import {
  CORS_HEADERS,
  corsPreflight,
  jsonResponse,
  resolveCustomerApiContext,
  resolveQboCompanyScope,
} from './qboCustomerAuth'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight()
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const auth = await resolveCustomerApiContext(event)
  if (!auth.ok) return auth.response
  const ctx = auth.ctx

  const qs = event.queryStringParameters || {}
  const poweronCustomerId = typeof qs.poweronCustomerId === 'string' ? qs.poweronCustomerId.trim() : ''
  // Canonical identity = org-scoped existence in relationship_accounts (NOT format).
  // A name, arbitrary text, or a cross-org id is rejected uniformly with 400.
  try {
    await assertCanonicalPowerOnCustomerId({
      organizationId: ctx.orgId,
      poweronCustomerId,
      identityRepo: ctx.identityRepo,
    })
  } catch (err) {
    if (err instanceof QboCustomerMappingIdentityError) {
      return jsonResponse(400, { error: 'A valid PowerOn customer id is required.' })
    }
    return jsonResponse(500, { error: 'Failed to verify PowerOn customer identity.' })
  }

  // Resolve the current QBO company scope. Not connected => not linked (no current
  // company). The fingerprint is derived server-side and never returned.
  const scope = await resolveQboCompanyScope(ctx)
  if (!scope.ok) {
    return jsonResponse(200, { linked: false })
  }

  const mappingScope: QboCustomerMappingScope = {
    organizationId: ctx.orgId,
    poweronCustomerId,
    qboCompanyFingerprint: scope.scope.fingerprint,
    qboEnvironment: scope.scope.environment,
  }

  const row = await loadCurrentCustomerMapping(ctx.mappingRepo, mappingScope)
  return jsonResponse(200, sanitizeCustomerMapping(row))
}