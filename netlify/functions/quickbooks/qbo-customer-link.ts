// @ts-nocheck
/**
 * netlify/functions/quickbooks/qbo-customer-link.ts
 *
 * QBO-4A.3 Task 5 — Explicitly LINK an existing QuickBooks customer to a PowerOn
 * customer in the CURRENT QBO company/environment.
 *
 * Browser endpoint: /.netlify/functions/qbo-customer-link  (POST)
 *   body: { poweronCustomerId, qboCustomerId }
 *     - poweronCustomerId: the canonical PowerOn customer identity (relationship_accounts.id,
 *       a TEXT id). Validated server-side by ORG-SCOPED EXISTENCE, never by UUID format.
 *     - qboCustomerId: the owner-SELECTED existing QuickBooks customer id (from a
 *       search result). Validated server-side; never derived from a name.
 *
 * Server, IN ORDER:
 *   1. Validate poweronCustomerId is a canonical PowerOn customer for this org
 *      (assertCanonicalPowerOnCustomerId); qboCustomerId is a bounded id. (400)
 *   2. Derive org / connection / company fingerprint / environment server-side.
 *      Not connected => 422. The browser NEVER supplies org/realmId/fingerprint/env.
 *   3. If this PowerOn customer already has an ACTIVE mapping in the current
 *      company/env:
 *        - to the SAME qboCustomerId  => idempotent success (return the mapping).
 *        - to a DIFFERENT qboCustomerId => 409 "already linked to another".
 *      A mapping for a DIFFERENT company/env is a different scope and is NOT treated
 *      as current (Sandbox link does not block a Production link).
 *   4. VERIFY the QBO customer exists in the CURRENT company by reading it from QBO.
 *      The display name + active flag come from QBO — NEVER from the browser body.
 *      Not found => 409.
 *   5. Persist the mapping link_origin='linked' with the QBO-sourced display name.
 *      Conflicts (race): already_linked => 409; qbo_customer_claimed (the QBO
 *      customer is linked to another PowerOn customer) => 409.
 *
 * Response (sanitized): the browser-safe mapping shape
 *   { linked: true, customer: { id, displayName, active }, linkOrigin: 'linked' }
 */
import { toCustomerSummary, QboCustomerApiError } from '../../../src/services/quickbooks/qboCustomerContract'
import { readCustomerWithBearer } from '../../../src/services/quickbooks/qboAccountingClient'
import {
  createCustomerMapping,
  loadCurrentCustomerMapping,
  sanitizeCustomerMapping,
  QboCustomerMappingIdentityError,
  type QboCustomerMappingInput,
  type QboCustomerMappingScope,
} from '../../../src/services/quickbooks/quickbooksCustomerMappingStore'
import { assertCanonicalPowerOnCustomerId } from './qboCustomerIdentity'
import {
  corsPreflight,
  jsonResponse,
  resolveCustomerApiContext,
  resolveQboCompanyScope,
} from './qboCustomerAuth'
import { QboCustomerMappingConflictError } from './qboCustomerMappingRepo'

/** A QBO customer id is a bounded alphanumeric string (QBO ids are numeric). */
function isValidQboCustomerId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,50}$/.test(id)
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight()
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const auth = await resolveCustomerApiContext(event)
  if (!auth.ok) return auth.response
  const ctx = auth.ctx

  let body: any = {}
  try {
    body = event.body ? JSON.parse(event.body) : {}
  } catch {
    return jsonResponse(400, { error: 'Invalid request body.' })
  }
  const poweronCustomerId = typeof body.poweronCustomerId === 'string' ? body.poweronCustomerId.trim() : ''
  const qboCustomerId = typeof body.qboCustomerId === 'string' ? String(body.qboCustomerId).trim() : ''
  // Canonical identity = org-scoped existence in relationship_accounts (NOT format).
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
  if (!isValidQboCustomerId(qboCustomerId)) {
    return jsonResponse(400, { error: 'A valid QuickBooks customer id is required.' })
  }

  const scope = await resolveQboCompanyScope(ctx)
  if (!scope.ok) return scope.response
  const { bearer, fingerprint, environment } = scope.scope

  const mappingScope: QboCustomerMappingScope = {
    organizationId: ctx.orgId,
    poweronCustomerId,
    qboCompanyFingerprint: fingerprint,
    qboEnvironment: environment,
  }

  // (3) Existing active mapping for this PowerOn customer in the current company/env.
  const existing = await loadCurrentCustomerMapping(ctx.mappingRepo, mappingScope)
  if (existing) {
    if (existing.qboCustomerId === qboCustomerId) {
      // Same link => idempotent success. No re-persist, no QBO read.
      return jsonResponse(200, sanitizeCustomerMapping(existing))
    }
    return jsonResponse(409, { error: 'This customer is already linked to another QuickBooks customer. Unlink it first to change the mapping.' })
  }

  // (4) Verify the QBO customer exists in the CURRENT company. Display/active come
  // from QBO — never from the browser body.
  let rawCustomer: Record<string, unknown>
  try {
    rawCustomer = await readCustomerWithBearer(bearer, ctx.fetchImpl, qboCustomerId)
  } catch (err) {
    if (err instanceof QboCustomerApiError) {
      if (err.category === 'not_found') {
        return jsonResponse(409, { error: 'That QuickBooks customer was not found in the current company.' })
      }
      return jsonResponse(502, { error: err.toSanitized().message })
    }
    return jsonResponse(502, { error: 'QuickBooks could not be reached.' })
  }
  const summary = toCustomerSummary(rawCustomer)
  if (!summary) {
    return jsonResponse(409, { error: 'That QuickBooks customer was not found in the current company.' })
  }

  // (5) Persist the mapping. link_origin='linked'; display name from QBO.
  const input: QboCustomerMappingInput = {
    organizationId: ctx.orgId,
    poweronCustomerId,
    qboCustomerId,
    qboCompanyFingerprint: fingerprint,
    qboEnvironment: environment,
    linkOrigin: 'linked',
    qboDisplayName: summary.displayName,
    poweronCustomerSnapshot: null,
    linkedByUserId: ctx.user.id,
  }
  try {
    const row = await createCustomerMapping(ctx.mappingRepo, input, ctx.now)
    return jsonResponse(200, sanitizeCustomerMapping(row))
  } catch (err) {
    if (err instanceof QboCustomerMappingConflictError) {
      if (err.code === 'qbo_customer_claimed') {
        return jsonResponse(409, { error: 'That QuickBooks customer is already linked to another customer.' })
      }
      // already_linked race: re-check for idempotent vs conflict.
      const after = await loadCurrentCustomerMapping(ctx.mappingRepo, mappingScope)
      if (after && after.qboCustomerId === qboCustomerId) {
        return jsonResponse(200, sanitizeCustomerMapping(after))
      }
      return jsonResponse(409, { error: 'This customer was just linked in another session.' })
    }
    return jsonResponse(500, { error: 'Failed to persist the QuickBooks customer mapping.' })
  }
}