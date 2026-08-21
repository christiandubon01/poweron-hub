// @ts-nocheck
/**
 * netlify/functions/quickbooks/qbo-customer-unlink.ts
 *
 * QBO-4A.3 Task 8 — UNLINK (change mapping): deactivate the active QuickBooks
 * customer mapping for a PowerOn customer in the CURRENT QBO company/environment.
 *
 * Browser endpoint: /.netlify/functions/qbo-customer-unlink  (POST)
 *   body: { poweronCustomerId }
 *
 * Retained-history model: the mapping row is NEVER deleted. `is_active` flips to
 * false with `unlinked_at` + `unlinked_by_user_id` stamped, so the accounting-link
 * provenance survives for future "Change mapping" / audit. A relink then creates a
 * NEW active row (the old inactive row is retained).
 *
 * This endpoint NEVER:
 *   - deletes the QBO customer (the QBO customer remains in QuickBooks),
 *   - deletes the mapping row (retained history),
 *   - changes any estimate/invoice/payment record (none exist yet — Send to
 *     QuickBooks is not implemented; the financial-authority firewall is untouched).
 *
 * FUTURE ESTIMATE/INVOICE DEPENDENCY SAFEGUARD (interface designed, NOT built):
 *   When QBO Estimates/Invoices/Payments are later introduced (future QBO-4B+), an
 *   owner may unlink a customer that still has in-flight QBO estimates/invoices
 *   referencing this mapping. The safeguard interface this endpoint is designed to
 *   accept is:
 *
 *     interface QboCustomerMappingDependencyGuard {
 *       // Returns { allowed: true } or { allowed: false, reason } when an in-flight
 *       // QBO estimate/invoice/payment references the active mapping.
 *       checkUnlinkAllowed(scope: QboCustomerMappingScope, row: QboCustomerMappingRow)
 *         : Promise<{ allowed: true } | { allowed: false; reason: string }>
 *     }
 *
 *   The handler would call it BEFORE deactivateMapping and return 409 with the
 *   reason when not allowed. This phase does NOT implement it: there are no QBO
 *   estimates/invoices/payments yet (Send to QuickBooks is out of scope), so the
 *   guard would always allow. Wiring a no-op now would be dead code; the interface
 *   above is the documented extension point for the future dependency check.
 *
 * MIGRATION NOTE: migration 133 had NO DB CHECK enforcing
 *   (is_active = false  <=>  unlinked_at IS NOT NULL). This is intentional and safe:
 *   the table is SERVER-ONLY (RLS, REVOKE ALL, zero authenticated policies), the
 *   service role is the sole writer, and the repo adapter ALWAYS sets is_active +
 *   unlinked_at + unlinked_by_user_id atomically in a single UPDATE. There is no
 *   app write path that can leave an inconsistent row, so repo-level enforcement +
 *   tests suffice.
 *
 *   Migration 134 (QBO-4A.6) exists for a SEPARATE reason: it corrects
 *   poweron_customer_id from UUID → TEXT to match the real canonical identity
 *   (relationship_accounts.id). It does NOT add an is_active/unlinked_at CHECK.
 *
 * Response (sanitized): { linked: false } on success; 409 if not currently linked.
 */
import {
  loadCurrentCustomerMapping,
  unlinkCustomerMapping,
  QboCustomerMappingIdentityError,
  type QboCustomerMappingScope,
} from '../../../src/services/quickbooks/quickbooksCustomerMappingStore'
import { assertCanonicalPowerOnCustomerId } from './qboCustomerIdentity'
import {
  corsPreflight,
  jsonResponse,
  resolveCustomerApiContext,
  resolveQboCompanyScope,
} from './qboCustomerAuth'

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

  const scope = await resolveQboCompanyScope(ctx)
  if (!scope.ok) return scope.response

  const mappingScope: QboCustomerMappingScope = {
    organizationId: ctx.orgId,
    poweronCustomerId,
    qboCompanyFingerprint: scope.scope.fingerprint,
    qboEnvironment: scope.scope.environment,
  }

  // Only unlink if there is an active mapping in the current company/env. A mapping
  // for a different company/env is a different scope and is left untouched.
  const existing = await loadCurrentCustomerMapping(ctx.mappingRepo, mappingScope)
  if (!existing) {
    return jsonResponse(409, { error: 'This customer is not linked to a QuickBooks customer.' })
  }

  // Retained-history unlink: flip is_active=false, stamp unlinked_at/by. Row survives.
  await unlinkCustomerMapping(ctx.mappingRepo, mappingScope, ctx.user.id, ctx.now)
  return jsonResponse(200, { linked: false })
}