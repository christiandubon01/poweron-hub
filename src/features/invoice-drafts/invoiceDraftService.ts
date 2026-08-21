/**
 * src/features/invoice-drafts/invoiceDraftService.ts
 *
 * QBO-2F — focused persistence service for organization-scoped invoice drafts.
 *
 * A thin Supabase layer; all mapping + status-transition authority lives in
 * invoiceDraftMapping.ts. This service:
 *   - resolves the active organization via the proven user_org_id RPC (same
 *     convention as callLogService), never trusting a client-supplied org id,
 *   - create/save (upsert by persisted id — no duplicate on repeated Save),
 *   - approve (persist-first if new, then set approved + approved_at),
 *   - list organization drafts (newest-updated first),
 *   - get/reopen one draft,
 *   - delete (same-org only; allowed for both draft + approved this phase).
 *
 * FINANCIAL-AUTHORITY FIREWALL (QBO-2F): every operation touches ONLY
 * public.invoice_drafts. It never writes project collected amounts, service
 * payment ledgers, payment dates, project billed/collected truth, KPIs,
 * revenue/cash-flow truth, or QBO invoices/payments. It imports no PowerOn
 * mutation authority and no QBO module. Approval does NOT send to QBO.
 *
 * This file is the ONLY place the billing-draft feature touches Supabase. The
 * pure model / adapters / state helpers remain network-free.
 */
import { supabase } from '@/lib/supabase'

import {
  applyStatusOnUpdate,
  buildDraftRowFields,
  mapRowToRecord,
  recordToHydratedDraft,
} from './invoiceDraftMapping'
import {
  InvoiceDraftAuthorityError,
  type HydratedDraft,
  type InvoiceDraftRecord,
  type InvoiceDraftSaveInput,
  type InvoiceDraftSaveResult,
  type InvoiceDraftStatus,
} from './invoiceDraftTypes'

const TABLE = 'invoice_drafts'

async function resolveActiveOrganizationId(): Promise<{
  userId: string
  organizationId: string
}> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user?.id) {
    throw new InvoiceDraftAuthorityError(
      'invoice_draft_unauthenticated',
      'Not authenticated; cannot manage invoice drafts.',
    )
  }

  const { data: orgIdRaw, error: orgError } = await (supabase as any).rpc('user_org_id')
  const organizationId =
    typeof orgIdRaw === 'string' && orgIdRaw.trim() ? orgIdRaw.trim() : null
  if (orgError || !organizationId) {
    throw new InvoiceDraftAuthorityError(
      'invoice_draft_org_missing',
      'No active organization; cannot manage invoice drafts.',
    )
  }
  return { userId: user.id, organizationId }
}

function nowIso(): string {
  return new Date().toISOString()
}

function toSaveResult(record: InvoiceDraftRecord): InvoiceDraftSaveResult {
  return {
    id: record.id,
    status: record.status,
    approvedAt: record.approvedAt,
    updatedAt: record.updatedAt,
  }
}

/**
 * Save (create or update) a draft. When `input.id` is present the existing
 * record is UPDATED (continuing identity — no duplicate on repeated Save);
 * status-transition authority (revert approved→draft on meaningful edit) is
 * applied. When absent a new DRAFT record is INSERTed.
 */
export async function saveInvoiceDraft(input: InvoiceDraftSaveInput): Promise<InvoiceDraftSaveResult> {
  const { userId, organizationId } = await resolveActiveOrganizationId()
  const fields = buildDraftRowFields(input)

  if (input.id) {
    // Update path: fetch the persisted record to apply status-transition authority.
    const { data: prevRow, error: prevErr } = await (supabase as any)
      .from(TABLE)
      .select('*')
      .eq('id', input.id)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (prevErr) throw new Error(prevErr.message || 'Failed to load invoice draft')

    if (!prevRow) {
      // Stale id (record deleted / cross-org): fall through to INSERT a new draft.
      return insertDraft(fields, userId, organizationId, 'draft', null)
    }

    const prev = mapRowToRecord(prevRow as Record<string, unknown>)
    const transition = applyStatusOnUpdate(prev, input, nowIso())

    const patch = {
      ...fields,
      status: transition.status,
      approved_at: transition.approved_at,
    }
    const { data, error } = await (supabase as any)
      .from(TABLE)
      .update(patch)
      .eq('id', input.id)
      .eq('organization_id', organizationId)
      .select('*')
      .single()
    if (error) throw new Error(error.message || 'Failed to save invoice draft')
    return toSaveResult(mapRowToRecord(data as Record<string, unknown>))
  }

  return insertDraft(fields, userId, organizationId, 'draft', null)
}

async function insertDraft(
  fields: ReturnType<typeof buildDraftRowFields>,
  userId: string,
  organizationId: string,
  status: InvoiceDraftStatus,
  approvedAt: string | null,
): Promise<InvoiceDraftSaveResult> {
  const row = {
    ...fields,
    organization_id: organizationId,
    created_by: userId,
    status,
    approved_at: approvedAt,
  }
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .insert(row)
    .select('*')
    .single()
  if (error) throw new Error(error.message || 'Failed to create invoice draft')
  return toSaveResult(mapRowToRecord(data as Record<string, unknown>))
}

/**
 * Approve an invoice draft. Operates on the persistent record: if new (no id)
 * it is persisted first, then set to approved. Sets status='approved' and
 * approved_at=now. The record stays discoverable. Does NOT send to QBO and does
 * NOT change PowerOn payment/KPI truth.
 */
export async function approveInvoiceDraft(input: InvoiceDraftSaveInput): Promise<InvoiceDraftSaveResult> {
  const { userId, organizationId } = await resolveActiveOrganizationId()
  const fields = buildDraftRowFields(input)
  const approvedAt = nowIso()

  if (input.id) {
    const patch = {
      ...fields,
      status: 'approved' as const,
      approved_at: approvedAt,
    }
    const { data, error } = await (supabase as any)
      .from(TABLE)
      .update(patch)
      .eq('id', input.id)
      .eq('organization_id', organizationId)
      .select('*')
      .single()
    if (error) throw new Error(error.message || 'Failed to approve invoice draft')
    return toSaveResult(mapRowToRecord(data as Record<string, unknown>))
  }

  return insertDraft(fields, userId, organizationId, 'approved', approvedAt)
}

/** List organization drafts, newest-updated first. Optional status filter. */
export async function listInvoiceDrafts(status?: InvoiceDraftStatus | 'all'): Promise<HydratedDraft[]> {
  const { organizationId } = await resolveActiveOrganizationId()
  let query = (supabase as any)
    .from(TABLE)
    .select('*')
    .eq('organization_id', organizationId)
  if (status && status !== 'all') query = query.eq('status', status)
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(500)
  if (error) throw new Error(error.message || 'Failed to list invoice drafts')
  return (data ?? []).map((row: Record<string, unknown>) =>
    recordToHydratedDraft(mapRowToRecord(row)),
  )
}

/** Get/reopen one draft (same-org only; RLS enforces cross-org denial). */
export async function getInvoiceDraft(id: string): Promise<HydratedDraft | null> {
  const { organizationId } = await resolveActiveOrganizationId()
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load invoice draft')
  if (!data) return null
  return recordToHydratedDraft(mapRowToRecord(data as Record<string, unknown>))
}

/** Delete a draft (same-org only; allowed for both draft + approved this phase). */
export async function deleteInvoiceDraft(id: string): Promise<void> {
  const { organizationId } = await resolveActiveOrganizationId()
  const { error } = await (supabase as any)
    .from(TABLE)
    .delete()
    .eq('id', id)
    .eq('organization_id', organizationId)
  if (error) throw new Error(error.message || 'Failed to delete invoice draft')
}