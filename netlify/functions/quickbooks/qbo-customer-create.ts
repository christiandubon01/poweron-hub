// @ts-nocheck
/**
 * netlify/functions/quickbooks/qbo-customer-create.ts
 *
 * QBO-4A.3 Task 6 + Task 7 — Explicitly CREATE a new QuickBooks customer and link
 * it to a PowerOn customer in the CURRENT QBO company/environment.
 *
 * Browser endpoint: /.netlify/functions/qbo-customer-create  (POST)
 *   body: { poweronCustomerId, displayName, companyName?, givenName?, familyName?,
 *           middleName?, suffix?, title?, email?, phone?,
 *           billAddr?: { line1?, city?, state?, postalCode?, country? } }
 *
 * This endpoint is ONLY reached by an explicit owner "Create customer in QuickBooks"
 * action. It is NEVER called automatically from a lookup/search result — even an
 * obvious single search result must never auto-create. There is no automatic caller.
 *
 * Server, IN ORDER:
 *   1. Validate + build the QBO payload server-side (bounded, trimmed, no passthrough).
 *      poweronCustomerId MUST be a valid canonical PowerOn customer identity for this
 *      org (assertCanonicalPowerOnCustomerId: shape + org-scoped existence) — never
 *      derived from a name, never validated by UUID format. (400 on bad input)
 *   2. Derive org / connection / company fingerprint / environment server-side. (422)
 *   3. If this PowerOn customer ALREADY has an active mapping in the current
 *      company/env, do NOT create another QBO customer. Return 409 with the existing
 *      mapping so the UI shows the customer is already linked. No QBO call is made.
 *   4. POST the Customer to QBO. On 6240 duplicate-name: return a sanitized
 *      duplicate-name condition (422) — NO auto-suffix / merge / auto-link. The owner
 *      stays in control (a future UI offers Search Existing or edit-the-name).
 *   5. Read the created QBO Customer Id + display name from the provider response.
 *   6. Persist the mapping link_origin='created' with the QBO-sourced display name +
 *      a provenance snapshot of the owner-reviewed input.
 *
 * SPLIT-OPERATION FAILURE SAFEGUARD (Task 7): QBO create + mapping persistence are two
 * separate operations that cannot be one transaction. If the QBO Customer create
 * SUCCEEDED (provider confirmed, we have a QBO Customer Id) but mapping persistence
 * FAILED, this handler NEVER automatically retries the QBO create. It returns a
 * sanitized RECOVERABLE error carrying only the safe provider identity (QBO Customer
 * Id + display name) needed for a future explicit Search/Link recovery. A later
 * search/link action can find and explicitly link that newly created QBO customer.
 *
 * Response (sanitized):
 *   200 { linked: true, customer: { id, displayName, active }, linkOrigin: 'created' }
 *   422 { error: 'A QuickBooks customer with that name already exists.', category: 'duplicate_name' }
 *   409 { error, recoverable, qboCustomer?, mapping? }  — created but mapping not saved
 */
import { toCustomerSummary, QboCustomerApiError } from '../../../src/services/quickbooks/qboCustomerContract'
import { createCustomerWithBearer } from '../../../src/services/quickbooks/qboAccountingClient'
import { validateAndBuildCreateCustomerPayload } from '../../../src/services/quickbooks/qboCustomerCreateInput'
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

/** The safe provider identity returned in a recoverable (split-failure) error. */
function safeQboCustomer(id: string, displayName: string | null) {
  return { id, displayName }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight()
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const auth = await resolveCustomerApiContext(event)
  if (!auth.ok) return auth.response
  const ctx = auth.ctx

  let body: unknown = null
  try {
    body = event.body ? JSON.parse(event.body) : null
  } catch {
    return jsonResponse(400, { error: 'Invalid request body.' })
  }
  const validation = validateAndBuildCreateCustomerPayload(body)
  if (!validation.ok || !validation.payload || !validation.poweronCustomerId) {
    return jsonResponse(400, { error: validation.error ?? 'Invalid request.' })
  }
  const { poweronCustomerId, payload } = validation

  // Canonical identity = org-scoped existence in relationship_accounts (NOT format).
  // The shape was already bounded by validateAndBuildCreateCustomerPayload; here we
  // prove the id is a real PowerOn customer belonging to the authenticated org before
  // any QBO call. A name, arbitrary text, or a cross-org id is rejected with 400.
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

  const scope = await resolveQboCompanyScope(ctx)
  if (!scope.ok) return scope.response
  const { bearer, fingerprint, environment } = scope.scope

  const mappingScope: QboCustomerMappingScope = {
    organizationId: ctx.orgId,
    poweronCustomerId,
    qboCompanyFingerprint: fingerprint,
    qboEnvironment: environment,
  }

  // (3) Already mapped in the current company/env? Do NOT create another QBO customer.
  const existing = await loadCurrentCustomerMapping(ctx.mappingRepo, mappingScope)
  if (existing) {
    return jsonResponse(409, {
      error: 'This customer is already linked to a QuickBooks customer.',
      mapping: sanitizeCustomerMapping(existing),
    })
  }

  // (4) POST the Customer to QBO.
  let createdRaw: Record<string, unknown>
  try {
    createdRaw = await createCustomerWithBearer(bearer, ctx.fetchImpl, payload)
  } catch (err) {
    if (err instanceof QboCustomerApiError) {
      if (err.category === 'duplicate_name') {
        return jsonResponse(422, {
          error: 'A QuickBooks customer with that name already exists. Search existing customers or edit the name.',
          category: 'duplicate_name',
        })
      }
      return jsonResponse(502, { error: err.toSanitized().message })
    }
    return jsonResponse(502, { error: 'QuickBooks could not be reached.' })
  }

  // (5) Read the created QBO Customer Id + display name.
  const created = toCustomerSummary(createdRaw)
  if (!created || !created.id) {
    // Provider returned a success-shaped response without a usable Customer Id. We
    // cannot safely persist a mapping or offer recovery without an id. Surface a
    // sanitized parse error — do NOT retry the create.
    return jsonResponse(502, { error: 'QuickBooks did not return the created customer identity.' })
  }

  // (6) Persist the mapping. Provenance snapshot = the owner-reviewed input (display +
  // name components + contact), stored for future recovery/audit. No secrets.
  const input: QboCustomerMappingInput = {
    organizationId: ctx.orgId,
    poweronCustomerId,
    qboCustomerId: created.id,
    qboCompanyFingerprint: fingerprint,
    qboEnvironment: environment,
    linkOrigin: 'created',
    qboDisplayName: created.displayName,
    poweronCustomerSnapshot: {
      source: 'create',
      displayName: payload.DisplayName,
      companyName: payload.CompanyName ?? null,
      givenName: payload.GivenName ?? null,
      familyName: payload.FamilyName ?? null,
      email: payload.PrimaryEmailAddr ? (payload.PrimaryEmailAddr as any).Address ?? null : null,
      phone: payload.PrimaryPhone ? (payload.PrimaryPhone as any).FreeFormNumber ?? null : null,
    },
    linkedByUserId: ctx.user.id,
  }
  try {
    const row = await createCustomerMapping(ctx.mappingRepo, input, ctx.now)
    return jsonResponse(200, sanitizeCustomerMapping(row))
  } catch (err) {
    // SPLIT-OPERATION FAILURE: the QBO Customer WAS created (provider confirmed), but
    // the mapping could not be persisted. NEVER retry the QBO create. Return a
    // sanitized RECOVERABLE error with only the safe provider identity so a future
    // explicit Search/Link can find and link the newly created QBO customer.
    if (err instanceof QboCustomerMappingConflictError) {
      // A mapping was established in another session between our check and create.
      const after = await loadCurrentCustomerMapping(ctx.mappingRepo, mappingScope)
      return jsonResponse(409, {
        error: 'A mapping was established in another session. The QuickBooks customer was created; you can link it from Search.',
        recoverable: true,
        qboCustomer: safeQboCustomer(created.id, created.displayName),
        mapping: after ? sanitizeCustomerMapping(after) : null,
      })
    }
    return jsonResponse(500, {
      error: 'The QuickBooks customer was created but the mapping could not be saved. You can link it from Search.',
      recoverable: true,
      qboCustomer: safeQboCustomer(created.id, created.displayName),
    })
  }
}