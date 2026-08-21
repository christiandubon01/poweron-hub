// @ts-nocheck
/**
 * netlify/functions/quickbooks/qboCustomerMappingRepo.ts
 *
 * Supabase-backed adapter implementing the pure QboCustomerMappingRepo interface
 * against public.quickbooks_customer_mappings. SERVER-ONLY: the client passed in
 * MUST be a service-role client (SUPABASE_SERVICE_ROLE_KEY) so RLS is bypassed —
 * this mapping table deliberately has NO authenticated RLS policies and the
 * browser has no direct CRUD path to it.
 *
 * Snake_case DB columns are mapped to/from the camelCase interface here, keeping
 * the pure store module (quickbooksCustomerMappingStore.ts) database-agnostic
 * and unit-testable. No QBO API call is made here — this is Supabase CRUD only.
 *
 * Duplicate-prevention: the partial UNIQUE indexes
 *   uq_qbo_customer_mappings_one_active_per_poweron
 *   ubo_qbo_customer_mappings_one_active_per_qbo
 * are the backstop for races. insertMapping surfaces a unique-violation as a
 * typed "already linked" error so the caller can react idempotently.
 */
import type {
  QboCustomerMappingInput,
  QboCustomerMappingRepo,
  QboCustomerMappingRow,
  QboCustomerMappingScope,
} from '../../../src/services/quickbooks/quickbooksCustomerMappingStore'

/** Error raised when a mapping insert collides with an existing active mapping. */
export class QboCustomerMappingConflictError extends Error {
  readonly code: 'already_linked' | 'qbo_customer_claimed'
  constructor(code: QboCustomerMappingConflictError['code'], message?: string) {
    super(message ?? code)
    this.name = 'QboCustomerMappingConflictError'
    this.code = code
  }
}

function mapRow(r: any): QboCustomerMappingRow {
  return {
    id: r.id,
    organizationId: r.organization_id,
    poweronCustomerId: String(r.poweron_customer_id),
    qboCustomerId: String(r.qbo_customer_id),
    qboCompanyFingerprint: String(r.qbo_company_fingerprint),
    qboEnvironment: r.qbo_environment,
    linkOrigin: r.link_origin === 'created' ? 'created' : 'linked',
    qboDisplayName: r.qbo_display_name ?? null,
    poweronCustomerSnapshot: r.poweron_customer_snapshot ?? null,
    isActive: r.is_active !== false,
    unlinkedAt: r.unlinked_at ?? null,
    unlinkedByUserId: r.unlinked_by_user_id ?? null,
    linkedByUserId: r.linked_by_user_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function scopeFilter(client: any, scope: QboCustomerMappingScope) {
  return client
    .from('quickbooks_customer_mappings')
    .eq('organization_id', scope.organizationId)
    .eq('poweron_customer_id', scope.poweronCustomerId)
    .eq('qbo_company_fingerprint', scope.qboCompanyFingerprint)
    .eq('qbo_environment', scope.qboEnvironment)
}

/** Build a Supabase-backed customer-mapping repo from a service-role client. */
export function createCustomerMappingRepo(client: any): QboCustomerMappingRepo {
  return {
    async loadActiveMapping(scope: QboCustomerMappingScope): Promise<QboCustomerMappingRow | null> {
      const { data, error } = await scopeFilter(client, scope)
        .eq('is_active', true)
        .select('*')
        .maybeSingle()
      if (error) throw new Error('Failed to load QuickBooks customer mapping.')
      if (!data) return null
      return mapRow(data)
    },

    async insertMapping(input: QboCustomerMappingInput, now: string): Promise<QboCustomerMappingRow> {
      // Preflight: refuse if this PowerOn customer already has an active mapping
      // in the same company/env (clear message before hitting the DB constraint).
      const scope: QboCustomerMappingScope = {
        organizationId: input.organizationId,
        poweronCustomerId: input.poweronCustomerId,
        qboCompanyFingerprint: input.qboCompanyFingerprint,
        qboEnvironment: input.qboEnvironment,
      }
      const { data: existing, error: preError } = await scopeFilter(client, scope)
        .eq('is_active', true)
        .select('id')
        .maybeSingle()
      if (preError) throw new Error('Failed to preflight QuickBooks customer mapping.')
      if (existing) {
        throw new QboCustomerMappingConflictError('already_linked', 'This customer is already linked to a QuickBooks customer.')
      }

      // Preflight: refuse if the QBO customer is already claimed by a different
      // PowerOn customer in the same org/company/env.
      const { data: claimed, error: claimError } = await client
        .from('quickbooks_customer_mappings')
        .eq('organization_id', input.organizationId)
        .eq('qbo_customer_id', input.qboCustomerId)
        .eq('qbo_company_fingerprint', input.qboCompanyFingerprint)
        .eq('qbo_environment', input.qboEnvironment)
        .eq('is_active', true)
        .select('id, poweron_customer_id')
        .maybeSingle()
      if (claimError) throw new Error('Failed to preflight QuickBooks customer claim.')
      if (claimed && String(claimed.poweron_customer_id) !== input.poweronCustomerId) {
        throw new QboCustomerMappingConflictError('qbo_customer_claimed', 'That QuickBooks customer is already linked to another customer.')
      }

      const payload = {
        organization_id: input.organizationId,
        poweron_customer_id: input.poweronCustomerId,
        qbo_customer_id: input.qboCustomerId,
        qbo_company_fingerprint: input.qboCompanyFingerprint,
        qbo_environment: input.qboEnvironment,
        link_origin: input.linkOrigin,
        qbo_display_name: input.qboDisplayName,
        poweron_customer_snapshot: input.poweronCustomerSnapshot,
        is_active: true,
        unlinked_at: null,
        unlinked_by_user_id: null,
        linked_by_user_id: input.linkedByUserId,
      }
      const { data, error } = await client
        .from('quickbooks_customer_mappings')
        .insert(payload)
        .select('*')
        .maybeSingle()
      if (error) {
        // Race: a concurrent insert won the partial unique index. Surface as a
        // conflict so the caller can react idempotently rather than crash.
        if (/duplicate key|unique/i.test(String(error.message || ''))) {
          throw new QboCustomerMappingConflictError('already_linked', 'This customer was just linked in another session.')
        }
        throw new Error('Failed to persist QuickBooks customer mapping.')
      }
      if (!data) throw new Error('Failed to persist QuickBooks customer mapping.')
      return mapRow(data)
    },

    async deactivateMapping(
      scope: QboCustomerMappingScope,
      unlinkedByUserId: string | null,
      now: string,
    ): Promise<void> {
      const { error } = await scopeFilter(client, scope)
        .eq('is_active', true)
        .update({
          is_active: false,
          unlinked_at: now,
          unlinked_by_user_id: unlinkedByUserId,
        })
      if (error) throw new Error('Failed to unlink QuickBooks customer mapping.')
    },
  }
}