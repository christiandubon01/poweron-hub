/**
 * SALES-CONVERSION-1 — Conversion receipt persistence.
 *
 * Contract enforced here:
 *   A receipt is minted ONLY when a real destination record already exists and
 *   its id is known. Opening a modal, cancelling, or a failed destination save
 *   never reaches this module.
 *
 * Idempotency is enforced by the database:
 *   UNIQUE (tenant_id, lead_id, destination_type, destination_id)
 * so double-clicks, React rerenders, network retries and repeated status
 * updates converge on one row. `persistConversionReceipt` treats a unique
 * violation as success-with-created:false and returns the existing row.
 *
 * Table + RLS live in supabase/migrations/116_sales_conversion_receipts.sql.
 */

import { supabase } from '@/lib/supabase'
import {
  CONVERSION_RECEIPTS_TABLE,
  type ConversionDestinationType,
  type ConversionReceipt,
  type ConversionReceiptDraft,
  type ConversionReceiptResult,
} from './conversionReceiptTypes'
import { deriveConversionSource } from './conversionReceiptSource'
import { resolveHunterTenantIdOrNull } from '@/services/hunter/resolveHunterTenantId'

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505'

const RECEIPT_COLUMNS = [
  'id',
  'receipt_number',
  'tenant_id',
  'lead_id',
  'lead_name',
  'lead_company',
  'lead_contact_name',
  'source_family',
  'source_detail',
  'source_raw',
  'destination_type',
  'destination_id',
  'destination_label',
  'lead_estimated_value',
  'converted_value',
  'lead_score_at_conversion',
  'lead_status_before',
  'converted_at',
  'converted_by',
  'converted_by_name',
  'created_at',
].join(', ')

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Maps a Supabase row onto the camelCase UI shape. */
export function mapReceiptRow(row: Record<string, any>): ConversionReceipt {
  return {
    id: String(row.id),
    receiptNumber: row.receipt_number ?? null,
    tenantId: String(row.tenant_id),
    leadId: row.lead_id ?? null,
    leadName: row.lead_name ?? 'Unknown lead',
    leadCompany: row.lead_company ?? null,
    leadContactName: row.lead_contact_name ?? null,
    sourceFamily: row.source_family ?? 'Other',
    sourceDetail: row.source_detail ?? null,
    sourceRaw: row.source_raw ?? null,
    destinationType: row.destination_type as ConversionDestinationType,
    destinationId: String(row.destination_id),
    destinationLabel: row.destination_label ?? null,
    leadEstimatedValue: toNumberOrNull(row.lead_estimated_value),
    convertedValue: toNumberOrNull(row.converted_value),
    leadScoreAtConversion: toNumberOrNull(row.lead_score_at_conversion),
    leadStatusBefore: row.lead_status_before ?? null,
    convertedAt: row.converted_at ?? row.created_at ?? new Date().toISOString(),
    convertedBy: row.converted_by ?? null,
    convertedByName: row.converted_by_name ?? null,
    createdAt: row.created_at ?? new Date().toISOString(),
  }
}

/** Short, human-quotable id for a receipt that has no server number yet. */
export function shortReceiptId(receipt: ConversionReceipt): string {
  return receipt.receiptNumber ?? `CR-${receipt.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

/**
 * Resolves the caller's mapped Hunter tenant. Mirrors resolveHunterTenantId so
 * receipts land in exactly the tenant the leads came from.
 */
export async function getCurrentTenantId(): Promise<string | null> {
  return resolveHunterTenantIdOrNull()
}

/** Identity stamped onto the receipt. Display name is best-effort. */
export async function getConvertedByIdentity(): Promise<{ id: string | null; name: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { id: null, name: null }
  let name: string | null =
    (user.user_metadata as any)?.full_name ?? (user.user_metadata as any)?.name ?? null
  if (!name) {
    const { data } = await (supabase as any)
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle()
    name = data?.full_name ?? user.email ?? null
  }
  return { id: user.id, name }
}

/** Fetches the receipt that already occupies the idempotency key, if any. */
async function findExistingReceipt(
  tenantId: string,
  leadId: string,
  destinationType: ConversionDestinationType,
  destinationId: string
): Promise<ConversionReceipt | null> {
  const { data, error } = await (supabase as any)
    .from(CONVERSION_RECEIPTS_TABLE)
    .select(RECEIPT_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId)
    .eq('destination_type', destinationType)
    .eq('destination_id', destinationId)
    .maybeSingle()
  if (error || !data) return null
  return mapReceiptRow(data)
}

/**
 * Persist one conversion receipt.
 *
 * Callers MUST already hold a real destination record id. Returns
 * `{ ok: false }` with a retryable error message on failure — the caller is
 * then responsible for leaving the lead in the active Pipeline.
 */
export async function persistConversionReceipt(
  draft: ConversionReceiptDraft
): Promise<ConversionReceiptResult> {
  if (!draft.tenantId) {
    return { ok: false, created: false, receipt: null, error: 'No tenant membership for the current user.' }
  }
  if (!draft.leadId) {
    return { ok: false, created: false, receipt: null, error: 'Missing lead id — refusing to write a receipt.' }
  }
  if (!draft.destinationId) {
    return {
      ok: false,
      created: false,
      receipt: null,
      error: 'No destination record id — refusing to write a receipt.',
    }
  }

  const payload = {
    tenant_id: draft.tenantId,
    lead_id: draft.leadId,
    lead_name: draft.leadName || 'Unknown lead',
    lead_company: draft.leadCompany ?? null,
    lead_contact_name: draft.leadContactName ?? null,
    source_family: draft.source.family,
    source_detail: draft.source.detail,
    source_raw: draft.source.raw,
    destination_type: draft.destinationType,
    destination_id: draft.destinationId,
    destination_label: draft.destinationLabel ?? null,
    lead_estimated_value: draft.leadEstimatedValue ?? null,
    converted_value: draft.convertedValue ?? null,
    lead_score_at_conversion: draft.leadScoreAtConversion ?? null,
    lead_status_before: draft.leadStatusBefore ?? null,
    converted_by: draft.convertedBy ?? null,
    converted_by_name: draft.convertedByName ?? null,
  }

  try {
    const { data, error } = await (supabase as any)
      .from(CONVERSION_RECEIPTS_TABLE)
      .insert(payload)
      .select(RECEIPT_COLUMNS)
      .single()

    if (!error && data) {
      return { ok: true, created: true, receipt: mapReceiptRow(data), error: null }
    }

    if (error?.code === UNIQUE_VIOLATION) {
      // A concurrent click, retry, or rerender already minted this receipt.
      const existing = await findExistingReceipt(
        draft.tenantId,
        draft.leadId,
        draft.destinationType,
        draft.destinationId
      )
      return { ok: true, created: false, receipt: existing, error: null }
    }

    return {
      ok: false,
      created: false,
      receipt: null,
      error: error?.message ?? 'Conversion receipt could not be saved.',
    }
  } catch (err: any) {
    return {
      ok: false,
      created: false,
      receipt: null,
      error: err?.message ?? 'Conversion receipt could not be saved.',
    }
  }
}

/**
 * Builds a receipt draft from a lead row plus a proven destination record.
 * `convertedValue` stays null unless the caller passes a canonical amount —
 * an estimated lead value is never promoted into the converted column.
 */
export function buildReceiptDraft(params: {
  tenantId: string
  lead: Record<string, any>
  destinationType: ConversionDestinationType
  destinationId: string
  destinationLabel?: string | null
  convertedValue?: number | null
  convertedBy?: string | null
  convertedByName?: string | null
}): ConversionReceiptDraft {
  const { lead } = params
  const contact = lead.contact_name ?? lead.contactName ?? null
  const company = lead.company_name ?? lead.companyName ?? null
  return {
    tenantId: params.tenantId,
    leadId: String(lead.id),
    leadName: contact || company || 'Unknown lead',
    leadCompany: company,
    leadContactName: contact,
    source: deriveConversionSource(lead),
    destinationType: params.destinationType,
    destinationId: params.destinationId,
    destinationLabel: params.destinationLabel ?? null,
    leadEstimatedValue: toNumberOrNull(lead.estimated_value ?? lead.estimatedValue),
    convertedValue: params.convertedValue ?? null,
    leadScoreAtConversion: toNumberOrNull(lead.score),
    leadStatusBefore: lead.status ?? null,
    convertedBy: params.convertedBy ?? null,
    convertedByName: params.convertedByName ?? null,
  }
}

/**
 * One-call conversion completion used by both destination paths.
 *
 * Order is fixed and must not be reordered — the lead may only leave the
 * active Pipeline after the receipt is durable:
 *   1. destination already created by the caller (id required)
 *   2. receipt persisted here
 *   3. caller flips lead status
 */
export async function recordConversion(params: {
  lead: Record<string, any>
  destinationType: ConversionDestinationType
  destinationId: string
  destinationLabel?: string | null
  convertedValue?: number | null
  tenantId?: string | null
}): Promise<ConversionReceiptResult> {
  const tenantId = params.tenantId ?? (await getCurrentTenantId())
  if (!tenantId) {
    return {
      ok: false,
      created: false,
      receipt: null,
      error: 'No tenant membership for the current user; conversion receipt not saved.',
    }
  }
  const identity = await getConvertedByIdentity()
  const draft = buildReceiptDraft({
    tenantId,
    lead: params.lead,
    destinationType: params.destinationType,
    destinationId: params.destinationId,
    destinationLabel: params.destinationLabel ?? null,
    convertedValue: params.convertedValue ?? null,
    convertedBy: identity.id,
    convertedByName: identity.name,
  })
  return persistConversionReceipt(draft)
}

/** Loads the ledger for the current tenant, newest conversion first. */
export async function fetchConversionReceipts(): Promise<{
  receipts: ConversionReceipt[]
  error: string | null
}> {
  const { data, error } = await (supabase as any)
    .from(CONVERSION_RECEIPTS_TABLE)
    .select(RECEIPT_COLUMNS)
    .order('converted_at', { ascending: false })

  if (error) {
    return { receipts: [], error: error.message ?? 'Could not load conversion receipts.' }
  }
  return { receipts: (data ?? []).map(mapReceiptRow), error: null }
}
