/**
 * LEAD-SRC-2F — Canonical Hunter tenant authority.
 *
 * active organization (user_org_id)
 *   → organizations.hunter_tenant_id
 *   → verify user_tenants membership
 *   → exact tenant_id
 *
 * No unordered membership fallback. No identity heuristics.
 */

import { supabase } from '@/lib/supabase'

export type HunterTenantErrorCode =
  | 'hunter_tenant_unauthenticated'
  | 'hunter_tenant_org_missing'
  | 'hunter_tenant_unmapped'
  | 'hunter_tenant_membership_missing'

export class HunterTenantAuthorityError extends Error {
  readonly code: HunterTenantErrorCode

  constructor(code: HunterTenantErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'HunterTenantAuthorityError'
    this.code = code
  }
}

export function isHunterTenantAuthorityError(
  err: unknown
): err is HunterTenantAuthorityError {
  return err instanceof HunterTenantAuthorityError
}

/**
 * Resolve the Hunter tenant for the caller's active organization.
 * Throws HunterTenantAuthorityError on fail-closed conditions.
 */
export async function resolveHunterTenantId(): Promise<string> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user?.id) {
    throw new HunterTenantAuthorityError(
      'hunter_tenant_unauthenticated',
      'Not authenticated; cannot resolve Hunter tenant.'
    )
  }

  const { data: orgIdRaw, error: orgError } = await (supabase as any).rpc(
    'user_org_id'
  )
  const organizationId =
    typeof orgIdRaw === 'string' && orgIdRaw.trim() ? orgIdRaw.trim() : null
  if (orgError || !organizationId) {
    throw new HunterTenantAuthorityError(
      'hunter_tenant_org_missing',
      'No active organization; cannot resolve Hunter tenant.'
    )
  }

  const { data: orgRow, error: mapError } = await (supabase as any)
    .from('organizations')
    .select('hunter_tenant_id')
    .eq('id', organizationId)
    .maybeSingle()

  if (mapError) {
    throw new HunterTenantAuthorityError(
      'hunter_tenant_unmapped',
      mapError.message || 'Failed to load organization Hunter tenant mapping.'
    )
  }

  const mappedTenantId =
    typeof orgRow?.hunter_tenant_id === 'string' &&
    orgRow.hunter_tenant_id.trim()
      ? String(orgRow.hunter_tenant_id).trim()
      : null

  if (!mappedTenantId) {
    throw new HunterTenantAuthorityError(
      'hunter_tenant_unmapped',
      'This organization has no Hunter tenant mapping. Map organizations.hunter_tenant_id before using Hunter settings or portal conversion.'
    )
  }

  const { data: membership, error: membershipError } = await (supabase as any)
    .from('user_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .eq('tenant_id', mappedTenantId)
    .maybeSingle()

  if (membershipError || !membership?.tenant_id) {
    throw new HunterTenantAuthorityError(
      'hunter_tenant_membership_missing',
      'You do not have Hunter tenant membership for this organization mapped tenant.'
    )
  }

  return mappedTenantId
}

/** Soft wrapper for call sites that historically returned null. */
export async function resolveHunterTenantIdOrNull(): Promise<string | null> {
  try {
    return await resolveHunterTenantId()
  } catch (err) {
    if (isHunterTenantAuthorityError(err)) return null
    throw err
  }
}
