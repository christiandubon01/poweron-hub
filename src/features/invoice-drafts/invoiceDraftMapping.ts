/**
 * src/features/invoice-drafts/invoiceDraftMapping.ts
 *
 * QBO-2F — PURE mapping + status-transition authority for persistent invoice
 * drafts. No React, no Supabase, no network, no backup-data access, no AI, no
 * QuickBooks. The single reliable authority for status transitions lives here.
 *
 * Responsibilities:
 *  - Convert a save input → DB row fields (money-safe NUMERIC-ready numbers).
 *  - Convert a DB row → typed InvoiceDraftRecord.
 *  - Compute the deterministic invoice total (primary + separate charges).
 *  - Decide whether an edit to an APPROVED draft reverts it to DRAFT
 *    (meaningful billable fields changed) or preserves APPROVED (reopen w/o edit).
 *  - Rehydrate a persisted record into the Prepare Invoice UI state (lines +
 *    selected ids) so the existing modal reopens in EDIT mode.
 *
 * Financial-authority firewall: nothing here writes payment/collected/KPI/QBO
 * truth. Amounts are rounded to 2 decimals only; no other financial value is
 * touched.
 */
import { makeBillingLine } from '@/features/billing-draft/billingDraftModel'
import { PROJECT_DEFAULT_TITLE, SERVICE_DEFAULT_TITLE, type BillingRead } from '@/features/billing-draft/billingDraftModalState'
import type { BillingLine, PreparedBillingDraft } from '@/features/billing-draft/billingDraftTypes'

import type {
  HydratedDraft,
  InvoiceDraftRecord,
  InvoiceDraftSaveInput,
  InvoiceDraftSourceSnapshot,
  InvoiceSourceKind,
  InvoiceSourceType,
  SeparateCharge,
  SnapshotCandidate,
} from './invoiceDraftTypes'

const EPSILON = 0.005

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Round to 2 decimals (cents). Money-safe; matches the billing-draft model. */
export function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

/** Spec source category derived from the exact source discriminator. */
export function sourceTypeFromKind(kind: InvoiceSourceKind): InvoiceSourceType {
  return kind === 'project' ? 'project' : 'service'
}

/** Normalize a separate charge: trim strings, round amount to 2 decimals. */
export function normalizeCharge(charge: SeparateCharge): SeparateCharge {
  return {
    title: String(charge.title ?? '').slice(0, 200),
    description: String(charge.description ?? ''),
    amount: Math.max(0, round2(num(charge.amount))),
  }
}

/** Normalize + drop fully-blank separate charges (no title, no description, no amount). */
export function normalizeSeparateCharges(charges: readonly SeparateCharge[]): SeparateCharge[] {
  const out: SeparateCharge[] = []
  for (const c of charges) {
    const n = normalizeCharge(c)
    const blank = !n.title.trim() && !n.description.trim() && !(n.amount > 0)
    if (!blank) out.push(n)
  }
  return out
}

/** Deterministic invoice total = primary amount + sum of separate charges. */
export function computeTotalAmount(primaryAmount: number, charges: readonly SeparateCharge[]): number {
  const primary = Math.max(0, round2(num(primaryAmount)))
  const sum = charges.reduce((acc, c) => acc + Math.max(0, round2(num(c.amount))), 0)
  return round2(primary + sum)
}

/** Default Product/Service title for a source kind (mirrors the modal defaults). */
export function defaultTitleFor(sourceKind: InvoiceSourceKind): string {
  return sourceKind === 'project' ? PROJECT_DEFAULT_TITLE : SERVICE_DEFAULT_TITLE
}

/**
 * The DB row fields derived from a save input (excluding id, organization_id,
 * created_by, created_at, updated_at, status, approved_at which the service
 * supplies/applies). Amounts are rounded for NUMERIC(14,2) storage.
 */
export interface DraftRowFields {
  source_type: InvoiceSourceType
  source_kind: InvoiceSourceKind
  source_id: string
  selected_source_ids: string[]
  source_snapshot: InvoiceDraftSourceSnapshot
  customer_reference: string | null
  customer_id: string | null
  product_or_service: string
  description: string
  primary_amount: number
  separate_charges: SeparateCharge[]
  total_amount: number
  currency: string
}

/** Build the DB row fields from a save input. Pure. */
export function buildDraftRowFields(input: InvoiceDraftSaveInput): DraftRowFields {
  const charges = normalizeSeparateCharges(input.separateCharges)
  const primaryAmount = Math.max(0, round2(num(input.primaryAmount)))
  return {
    source_type: sourceTypeFromKind(input.sourceKind),
    source_kind: input.sourceKind,
    source_id: String(input.sourceId ?? ''),
    selected_source_ids: (input.selectedSourceIds ?? []).map(String),
    source_snapshot: normalizeSnapshot(input.sourceSnapshot),
    customer_reference: input.customerReference ?? null,
    customer_id: input.customerId ?? null,
    product_or_service: String(input.productOrService ?? ''),
    description: String(input.description ?? ''),
    primary_amount: primaryAmount,
    separate_charges: charges,
    total_amount: computeTotalAmount(primaryAmount, charges),
    currency: 'USD',
  }
}

/** Normalize a source snapshot (defensive defaults for missing fields). */
export function normalizeSnapshot(snapshot: InvoiceDraftSourceSnapshot | undefined | null): InvoiceDraftSourceSnapshot {
  const s = (snapshot ?? {}) as Partial<InvoiceDraftSourceSnapshot>
  const candidates: SnapshotCandidate[] = Array.isArray((s as { candidates?: unknown }).candidates)
    ? ((s as { candidates: unknown[] }).candidates).map(normalizeSnapshotCandidate)
    : []
  const rawCust = (s as { customerReference?: unknown }).customerReference
  return {
    customerReference: typeof rawCust === 'string' ? rawCust : null,
    contractValue:
      typeof (s as { contractValue?: unknown }).contractValue === 'number'
        ? round2(num((s as { contractValue: number }).contractValue))
        : null,
    collectedSoFar: round2(num((s as { collectedSoFar?: unknown }).collectedSoFar)),
    candidates,
  }
}

function normalizeSnapshotCandidate(c: unknown): SnapshotCandidate {
  const r = (c ?? {}) as Record<string, unknown>
  return {
    id: String(r.id ?? ''),
    kind: String(r.kind ?? ''),
    label: String(r.label ?? ''),
    description: typeof r.description === 'string' ? r.description : null,
    date: typeof r.date === 'string' ? r.date : null,
    structuredAmount: typeof r.structuredAmount === 'number' && Number.isFinite(r.structuredAmount) ? round2(r.structuredAmount) : null,
    representationMode: typeof r.representationMode === 'string' ? r.representationMode : null,
    capacityGroup: typeof r.capacityGroup === 'string' ? r.capacityGroup : null,
  }
}

/** Map a raw DB row (snake_case, NUMERIC/string/jsonb) to a typed record. Pure. */
export function mapRowToRecord(row: Record<string, unknown>): InvoiceDraftRecord {
  const separateCharges = Array.isArray(row.separate_charges)
    ? (row.separate_charges as unknown[]).map(mapRowToCharge)
    : []
  const selectedSourceIds = Array.isArray(row.selected_source_ids)
    ? (row.selected_source_ids as unknown[]).map((s) => String(s))
    : []
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    status: row.status === 'approved' ? 'approved' : 'draft',
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    sourceType: row.source_type === 'project' ? 'project' : 'service',
    sourceKind: normalizeSourceKind(row.source_kind),
    sourceId: String(row.source_id ?? ''),
    selectedSourceIds,
    sourceSnapshot: normalizeSnapshot(row.source_snapshot as InvoiceDraftSourceSnapshot | undefined),
    customerReference: row.customer_reference ? String(row.customer_reference) : null,
    customerId: row.customer_id ? String(row.customer_id) : null,
    productOrService: String(row.product_or_service ?? ''),
    description: String(row.description ?? ''),
    primaryAmount: round2(num(row.primary_amount)),
    separateCharges,
    totalAmount: round2(num(row.total_amount)),
    currency: typeof row.currency === 'string' ? row.currency : 'USD',
  }
}

function mapRowToCharge(c: unknown): SeparateCharge {
  const r = (c ?? {}) as Record<string, unknown>
  return {
    title: String(r.title ?? ''),
    description: String(r.description ?? ''),
    amount: round2(num(r.amount)),
  }
}

function normalizeSourceKind(v: unknown): InvoiceSourceKind {
  return v === 'project' || v === 'serviceLog' || v === 'serviceCall' ? v : 'serviceLog'
}

/** Convert a typed record to a HydratedDraft for the Prepare Invoice modal. */
export function recordToHydratedDraft(record: InvoiceDraftRecord): HydratedDraft {
  return {
    id: record.id,
    status: record.status,
    approvedAt: record.approvedAt,
    sourceKind: record.sourceKind,
    sourceId: record.sourceId,
    customerReference: record.customerReference,
    customerId: record.customerId,
    productOrService: record.productOrService,
    description: record.description,
    primaryAmount: record.primaryAmount,
    separateCharges: record.separateCharges,
    selectedSourceIds: record.selectedSourceIds,
    sourceSnapshot: record.sourceSnapshot,
    totalAmount: record.totalAmount,
    updatedAt: record.updatedAt,
  }
}

/** Map a record to a save input (for re-saving after an edit). Pure. */
export function recordToSaveInput(record: InvoiceDraftRecord): InvoiceDraftSaveInput {
  return {
    id: record.id,
    sourceKind: record.sourceKind,
    sourceId: record.sourceId,
    customerReference: record.customerReference,
    customerId: record.customerId,
    productOrService: record.productOrService,
    description: record.description,
    primaryAmount: record.primaryAmount,
    separateCharges: record.separateCharges,
    selectedSourceIds: record.selectedSourceIds,
    sourceSnapshot: record.sourceSnapshot,
  }
}

/**
 * The meaningful billable fields whose change, on an APPROVED draft, reverts
 * it to DRAFT (QBO-2F). Reopening without changing these keeps APPROVED.
 *  - primary invoice amount
 *  - separate charges (title / description / amount, by value + count)
 *  - Product / Service title
 *  - description
 *  - selected work/provenance ids (where editable)
 * (total_amount is derived from primary + charges, so it is covered.)
 */
export function meaningfulFieldsChanged(
  prev: InvoiceDraftRecord,
  next: InvoiceDraftSaveInput,
): boolean {
  if (round2(num(prev.primaryAmount)) !== Math.max(0, round2(num(next.primaryAmount)))) return true
  if (String(prev.productOrService ?? '') !== String(next.productOrService ?? '')) return true
  if (String(prev.description ?? '') !== String(next.description ?? '')) return true
  if (!sameSourceIds(prev.selectedSourceIds, next.selectedSourceIds)) return true
  if (!sameCharges(prev.separateCharges, next.separateCharges)) return true
  return false
}

function sameSourceIds(a: readonly string[], b: readonly string[]): boolean {
  const ax = (a ?? []).map(String)
  const bx = (b ?? []).map(String)
  if (ax.length !== bx.length) return false
  const sa = new Set(ax)
  for (const x of bx) if (!sa.has(x)) return false
  return true
}

function sameCharges(a: readonly SeparateCharge[], b: readonly SeparateCharge[]): boolean {
  const na = normalizeSeparateCharges(a)
  const nb = normalizeSeparateCharges(b)
  if (na.length !== nb.length) return false
  for (let i = 0; i < na.length; i++) {
    if (na[i].title !== nb[i].title) return false
    if (na[i].description !== nb[i].description) return false
    if (Math.abs(round2(num(na[i].amount)) - round2(num(nb[i].amount))) > EPSILON) return false
  }
  return true
}

/**
 * The single status-transition authority for an UPDATE. Returns the status +
 * approved_at to write.
 *  - If the draft was APPROVED and a meaningful field changed → revert to DRAFT
 *    (status='draft', approved_at=null).
 *  - If the draft was APPROVED and no meaningful field changed → keep APPROVED
 *    (preserve approved_at; reopening without edits must NOT revert).
 *  - If the draft was DRAFT → stay DRAFT (approved_at=null).
 */
export function applyStatusOnUpdate(
  prev: InvoiceDraftRecord,
  next: InvoiceDraftSaveInput,
  nowIso: string,
): { status: 'draft' | 'approved'; approved_at: string | null } {
  if (prev.status === 'approved') {
    if (meaningfulFieldsChanged(prev, next)) {
      return { status: 'draft', approved_at: null }
    }
    return { status: 'approved', approved_at: prev.approvedAt ?? nowIso }
  }
  return { status: 'draft', approved_at: null }
}

/**
 * Build an InvoiceDraftSaveInput from the in-memory PreparedBillingDraft + the
 * read-only BillingRead it was prepared from, plus the exact source kind and
 * (optionally) the persisted draft id. Pure: shapes data only; no I/O.
 *
 *  - primary line = draft.lines[0] (the lump-sum line; always active).
 *  - separate charges = draft.lines[1..] (active extra lines; the model already
 *    filtered inactive untouched extras via activeLines).
 *  - sourceSnapshot captures the billing read at save time (provenance/context).
 */
export function buildSaveInputFromDraft(args: {
  draft: PreparedBillingDraft
  read: BillingRead
  sourceKind: InvoiceSourceKind
  id?: string
  /**
   * When the reopened source is no longer live (synthetic fallback), preserve the
   * ORIGINAL saved snapshot instead of overwriting it with the empty synthetic
   * read. Omit in the normal (live) path so the snapshot refreshes from live data.
   */
  snapshotOverride?: InvoiceDraftSourceSnapshot
  /**
   * QBO-4A.2 Task 7: when the reopened source is no longer live, preserve the
   * ORIGINAL persisted customer_id instead of nulling it from the empty synthetic
   * read. Omit in the normal (live) path so the id refreshes from the live source.
   */
  customerIdOverride?: string | null
}): InvoiceDraftSaveInput {
  const { draft, read, sourceKind, id, snapshotOverride, customerIdOverride } = args
  const primary = draft.lines[0]
  const charges: SeparateCharge[] = draft.lines.slice(1).map((l) => ({
    title: l.title,
    description: l.description,
    amount: l.amount,
  }))
  const liveSnapshot: InvoiceDraftSourceSnapshot = {
    customerReference: read.customerReference,
    contractValue: read.contractValue,
    collectedSoFar: read.collectedSoFar,
    candidates: read.candidates.map((c) => ({
      id: c.id,
      kind: c.kind,
      label: c.label,
      description: c.description,
      date: c.date,
      structuredAmount: c.structuredAmount,
      representationMode: c.representationMode,
      capacityGroup: c.capacityGroup,
    })),
  }
  return {
    id,
    sourceKind,
    sourceId: draft.sourceId,
    customerReference: draft.customerReference,
    // QBO-4A.2 Task 7: propagate the reconciled UUID when the source carried a
    // VERIFIED one; null when name-only. Never inferred from a name, and NOT a
    // meaningful-field change (identity/provenance, not a billable amount), so
    // it does not revert an APPROVED draft on reopen. For a synthetic (source no
    // longer live) reopen, customerIdOverride preserves the ORIGINAL persisted id
    // — the empty synthetic read would otherwise null it. Omitted on the live
    // path so the id refreshes from the fresh source read.
    customerId: customerIdOverride !== undefined ? customerIdOverride : (draft.customerId ?? null),
    productOrService: primary?.title ?? '',
    description: primary?.description ?? '',
    primaryAmount: primary?.amount ?? 0,
    separateCharges: charges,
    selectedSourceIds: [...draft.selectedCandidateIds],
    sourceSnapshot: snapshotOverride ?? liveSnapshot,
  }
}

/** Shape carrying the fields needed to rehydrate Prepare Invoice UI lines. */
export interface RehydrateLinesSource {
  readonly productOrService: string
  readonly description: string
  readonly primaryAmount: number
  readonly separateCharges: readonly SeparateCharge[]
  readonly selectedSourceIds: readonly string[]
  readonly sourceKind: InvoiceSourceKind
}

/**
 * Rehydrate a persisted draft into the Prepare Invoice UI state (EDIT mode):
 *  - The PRIMARY line (index 0) = product_or_service + description + primary_amount,
 *    carrying the saved provenance (selectedSourceIds).
 *  - Each separate charge becomes an extra active billing line.
 *  - descriptionDirty marks every line so the modal does not reseed its
 *    description from live work context (the owner's saved wording is preserved).
 *
 * Accepts an InvoiceDraftRecord OR a HydratedDraft (both satisfy the shape).
 */
export function mapHydratedToUiLines(src: RehydrateLinesSource): {
  lines: BillingLine[]
  selectedCandidateIds: string[]
  descriptionDirty: Record<string, boolean>
} {
  const lines: BillingLine[] = []
  const primaryId = 'line-1'
  lines.push(
    makeBillingLine({
      id: primaryId,
      title: src.productOrService || defaultTitleFor(src.sourceKind),
      description: src.description,
      amount: src.primaryAmount,
      candidateIds: [...src.selectedSourceIds],
    }),
  )
  src.separateCharges.forEach((c, i) => {
    lines.push(
      makeBillingLine({
        id: `line-${i + 2}`,
        title: c.title || defaultTitleFor(src.sourceKind),
        description: c.description,
        amount: c.amount,
        candidateIds: [],
      }),
    )
  })
  const descriptionDirty: Record<string, boolean> = {}
  for (const l of lines) descriptionDirty[l.id] = true
  return { lines, selectedCandidateIds: [...src.selectedSourceIds], descriptionDirty }
}

/** Rehydrate from a full InvoiceDraftRecord (convenience wrapper). */
export function mapRecordToUiLines(record: InvoiceDraftRecord): {
  lines: BillingLine[]
  selectedCandidateIds: string[]
  descriptionDirty: Record<string, boolean>
} {
  return mapHydratedToUiLines({
    productOrService: record.productOrService,
    description: record.description,
    primaryAmount: record.primaryAmount,
    separateCharges: record.separateCharges,
    selectedSourceIds: record.selectedSourceIds,
    sourceKind: record.sourceKind,
  })
}