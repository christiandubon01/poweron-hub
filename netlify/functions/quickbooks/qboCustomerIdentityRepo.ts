// @ts-nocheck
/**
 * netlify/functions/quickbooks/qboCustomerIdentityRepo.ts
 *
 * QBO-4A.6 Task 2/3 — SERVER-ONLY canonical PowerOn customer identity lookup.
 *
 * The canonical PowerOn customer identity is relationship_accounts.id — a TEXT
 * PRIMARY KEY (stable, immutable, org-scoped). It is NEVER validated by format
 * (not a UUID). The single authority for "is this a valid PowerOn customer for the
 * authenticated organization" is:
 *
 *   SELECT id FROM relationship_accounts WHERE id = $1 AND org_id = $2 LIMIT 1
 *
 * This module is that lookup, behind a tiny injectable interface so the validator
 * (qboCustomerIdentity.ts) is unit-testable with an in-memory fake — mirroring the
 * QboCustomerMappingRepo / QboConnectionRepo pattern. It is imported ONLY by the
 * Netlify handlers, the shared auth bootstrap (qboCustomerAuth), and tests. It
 * performs no write and imports no financial-authority module.
 *
 * SECURITY:
 *   * The client passed in MUST be a service-role client (SUPABASE_SERVICE_ROLE_KEY)
 *     so RLS is bypassed — the browser has no direct read path to relationship_accounts
 *     beyond its own RLS-scoped projection, and the server must be able to validate
 *     identity regardless of the row's RLS visibility to the anon token.
 *   * organizationId is ALWAYS the server-resolved org (RLS profile row), NEVER the
 *     request body. The browser may supply poweronCustomerId but may NEVER choose the
 *     org authority. This is the tenant-isolation boundary: a cross-org id is rejected.
 *   * Only the minimal identity fields (id, company, contact) are read — never tokens,
 *     never QuickBooks secrets, never financial authority.
 */
/** The minimal canonical identity row returned to the validator. */
export interface RelationshipAccountIdentity {
  /** relationship_accounts.id — the canonical TEXT PowerOn customer identity. */
  readonly id: string
  /** company display name (nullable — some accounts are contact-only). */
  readonly company: string | null
  /** contact name (nullable). */
  readonly contact: string | null
}

/**
 * Injected canonical-identity lookup surface. The Supabase adapter below implements
 * this with the service role key. The browser/endpoint never calls this directly; it
 * is consumed by assertCanonicalPowerOnCustomerId inside the server boundary.
 */
export interface RelationshipAccountIdentityRepo {
  /**
   * Load the canonical identity for (organizationId, customerId). Returns null when
   * no relationship_accounts row exists for that id in that org — which is the
   * authoritative "not a valid canonical PowerOn customer" signal. org-scoped:
   * a real id that belongs to a DIFFERENT org returns null (cross-org rejected).
   */
  loadIdentity(
    organizationId: string,
    customerId: string,
  ): Promise<RelationshipAccountIdentity | null>
}

/**
 * Build a Supabase-backed canonical-identity repo from a service-role client.
 * Reads only (id, company, contact) from relationship_accounts, scoped by org_id.
 */
export function createRelationshipAccountIdentityRepo(client: any): RelationshipAccountIdentityRepo {
  return {
    async loadIdentity(
      organizationId: string,
      customerId: string,
    ): Promise<RelationshipAccountIdentity | null> {
      const { data, error } = await client
        .from('relationship_accounts')
        .select('id, company, contact')
        .eq('id', customerId)
        .eq('org_id', organizationId)
        .maybeSingle()
      if (error) throw new Error('Failed to verify PowerOn customer identity.')
      if (!data) return null
      return {
        id: String(data.id),
        company: data.company ?? null,
        contact: data.contact ?? null,
      }
    },
  }
}