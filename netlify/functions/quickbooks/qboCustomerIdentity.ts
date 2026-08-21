// @ts-nocheck
/**
 * netlify/functions/quickbooks/qboCustomerIdentity.ts
 *
 * QBO-4A.6 Task 2/3 — the single SERVER-ONLY authority for the canonical PowerOn
 * customer identity contract:
 *
 *   A valid canonical PowerOn customer identity is:
 *     (1) non-empty and bounded (shape),
 *     (2) an existing relationship_accounts.id (existence),
 *     (3) belonging to the authenticated PowerOn organization (org membership).
 *
 *   assertCanonicalPowerOnCustomerId({ organizationId, poweronCustomerId, identityRepo })
 *
 * is the boundary every QBO customer endpoint calls BEFORE building a mapping. It:
 *   1. Shape-checks poweronCustomerId via the pure assertPowerOnCustomerIdShape
 *      (non-empty, ≤128, no control chars) — rejects garbage without a DB round trip.
 *   2. Looks up relationship_accounts WHERE id = poweronCustomerId AND org_id =
 *      organizationId via the injected identityRepo (service role). Null => not
 *      canonical => reject.
 *
 * The browser may provide poweronCustomerId but may NEVER provide the authoritative
 * organizationId — that comes from the server-resolved context (RLS profile row).
 * This is the tenant-isolation boundary: a real id belonging to a different org is
 * rejected as not-canonical (cross-org rejected).
 *
 * This module NEVER uses isUuid for customer identity. Real PowerOn customer ids are
 * stable TEXT values ('gc…', 'import_gc…', 'acct_…'); format is never the authority.
 *
 * On failure it throws QboCustomerMappingIdentityError, which the endpoints catch and
 * map to a sanitized 400 (never leaking whether the id exists in another org — the
 * error message is uniform). Returns the validated identity row on success so the
 * endpoint can reuse the display name without a second lookup.
 */
import {
  assertPowerOnCustomerIdShape,
  QboCustomerMappingIdentityError,
} from '../../../src/services/quickbooks/quickbooksCustomerMappingStore'
import type {
  RelationshipAccountIdentity,
  RelationshipAccountIdentityRepo,
} from './qboCustomerIdentityRepo'

// Re-export the identity type under the server-facing name for endpoint convenience.
export type { RelationshipAccountIdentity, RelationshipAccountIdentityRepo } from './qboCustomerIdentityRepo'

export interface AssertCanonicalPowerOnCustomerIdArgs {
  /** Server-resolved organization id (RLS profile row) — never the request body. */
  organizationId: string
  /** Browser-supplied canonical customer id candidate (relationship_accounts.id). */
  poweronCustomerId: string
  /** Injected service-role identity lookup. */
  identityRepo: RelationshipAccountIdentityRepo
}

/**
 * Validate that poweronCustomerId is a canonical PowerOn customer identity for the
 * authenticated organization. Throws QboCustomerMappingIdentityError on any failure
 * (shape OR existence/org). Returns the validated identity row on success.
 *
 * The two failure modes are deliberately NOT distinguishable to the caller by message
 * content that would leak existence in another org: both surface the same uniform
 * "not a valid PowerOn customer for this organization" wording. The error CODE differs
 * (poweron_customer_id_invalid vs poweron_customer_id_not_canonical) for server-side
 * telemetry only — the browser only ever sees the mapped 400 string.
 */
export async function assertCanonicalPowerOnCustomerId(
  args: AssertCanonicalPowerOnCustomerIdArgs,
): Promise<RelationshipAccountIdentity> {
  const { organizationId, poweronCustomerId, identityRepo } = args
  // (1) Shape — pure, no DB. Rejects empty / too long / control chars / non-string.
  assertPowerOnCustomerIdShape(poweronCustomerId)
  // The org is server-derived; a missing/blank org is a server bug, not a client
  // identity error — fail closed with the shape error rather than a misleading
  // "not canonical" that would imply the customer is at fault.
  assertPowerOnCustomerIdShape(organizationId)
  // (2) Existence + org membership — the real authority. Null => not canonical.
  const trimmedCustomerId = poweronCustomerId.trim()
  const identity = await identityRepo.loadIdentity(organizationId, trimmedCustomerId)
  if (!identity) {
    throw new QboCustomerMappingIdentityError(
      'poweron_customer_id_not_canonical',
      'That is not a valid PowerOn customer for this organization.',
    )
  }
  return identity
}