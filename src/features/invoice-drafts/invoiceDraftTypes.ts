/**
 * src/features/invoice-drafts/invoiceDraftTypes.ts
 *
 * QBO-2F — Persistent invoice draft types (PowerOn-side preparation records).
 *
 * These are OUTBOUND owner-approved invoice PREPARATION records destined for
 * QuickBooks LATER. They are NOT QBO invoices and carry no QBO id. They are
 * tenant data (organization-scoped). Creating/saving/editing/approving/deleting
 * or reopening a draft must NOT write PowerOn payment, collected-cash, KPI, or
 * QBO truth (see the QBO-2F financial-authority firewall).
 *
 * STATUS MODEL: 'draft' | 'approved'. No 'sent' status in this phase.
 *   - Approval sets status='approved' + approved_at; the record stays discoverable.
 *   - Editing meaningful billable content of an approved draft reverts it to
 *     'draft' and clears approved_at. Reopening without editing keeps 'approved'.
 *
 * PROVENANCE: selected_source_ids + source_snapshot are CONTEXT only. They are
 * never separate financial line items. The default invoice remains lump-sum-first
 * (primary_amount) with optional separate_charges.
 *
 * Money is stored as NUMERIC(14,2) in Postgres; on the JS side amounts are
 * Numbers rounded to 2 decimals (round2). No floating-point accounting drift.
 */

/** Optional separate charge line (owner-entered; itemization is OPTIONAL). */
export interface SeparateCharge {
  readonly title: string
  readonly description: string
  readonly amount: number
}

/** Source discriminator matching the Prepare Invoice source union. */
export type InvoiceSourceKind = 'project' | 'serviceLog' | 'serviceCall'

/** Spec source category (derived from source_kind). */
export type InvoiceSourceType = 'project' | 'service'

/** Status of a persisted invoice draft. */
export type InvoiceDraftStatus = 'draft' | 'approved'

/**
 * Safe snapshot of the billing read at save time — enough to reopen and
 * understand the draft later even if surrounding live data changes. Carries no
 * mutation authority; context only.
 */
export interface InvoiceDraftSourceSnapshot {
  readonly customerReference: string | null
  /** A. CONTRACT TRUTH at save time (display context). null = none. */
  readonly contractValue: number | null
  /** D. PAYMENT TRUTH at save time (read-only context). */
  readonly collectedSoFar: number
  /** B. WORK CONTEXT candidate summaries (provenance; never financial line items). */
  readonly candidates: readonly SnapshotCandidate[]
}

export interface SnapshotCandidate {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly description: string | null
  readonly date: string | null
  readonly structuredAmount: number | null
  readonly representationMode: string | null
  readonly capacityGroup: string | null
}

/** A persisted invoice draft record (typed view of a DB row). */
export interface InvoiceDraftRecord {
  readonly id: string
  readonly organizationId: string
  readonly createdBy: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly status: InvoiceDraftStatus
  readonly approvedAt: string | null
  readonly sourceType: InvoiceSourceType
  readonly sourceKind: InvoiceSourceKind
  readonly sourceId: string
  readonly selectedSourceIds: readonly string[]
  readonly sourceSnapshot: InvoiceDraftSourceSnapshot
  readonly customerReference: string | null
  readonly customerId: string | null
  readonly productOrService: string
  readonly description: string
  readonly primaryAmount: number
  readonly separateCharges: readonly SeparateCharge[]
  readonly totalAmount: number
  readonly currency: string
}

/**
 * Input to save a draft (create or update). When `id` is present the service
 * UPDATES the existing record (continuing identity); when absent it INSERTs.
 * The service derives totalAmount + sourceType; it supplies organization_id,
 * created_by, timestamps, and status transitions.
 */
export interface InvoiceDraftSaveInput {
  /** Persisted draft id. Present → update (no duplicate); absent → insert. */
  readonly id?: string
  readonly sourceKind: InvoiceSourceKind
  readonly sourceId: string
  readonly customerReference: string | null
  readonly customerId?: string | null
  readonly productOrService: string
  readonly description: string
  readonly primaryAmount: number
  readonly separateCharges: readonly SeparateCharge[]
  readonly selectedSourceIds: readonly string[]
  readonly sourceSnapshot: InvoiceDraftSourceSnapshot
}

/** Result of a save/approve operation returned to the UI. */
export interface InvoiceDraftSaveResult {
  readonly id: string
  readonly status: InvoiceDraftStatus
  readonly approvedAt: string | null
  readonly updatedAt: string
}

/** A draft reopened for editing, handed to the Prepare Invoice modal. */
export interface HydratedDraft {
  readonly id: string
  readonly status: InvoiceDraftStatus
  readonly approvedAt: string | null
  readonly sourceKind: InvoiceSourceKind
  readonly sourceId: string
  readonly customerReference: string | null
  /** Reconciled UUID preserved from the persisted record (QBO-4A.2 Task 7). */
  readonly customerId: string | null
  readonly productOrService: string
  readonly description: string
  readonly primaryAmount: number
  readonly separateCharges: readonly SeparateCharge[]
  readonly selectedSourceIds: readonly string[]
  readonly sourceSnapshot: InvoiceDraftSourceSnapshot
  /** Deterministic invoice total (primary + separate charges) for display. */
  readonly totalAmount: number
  readonly updatedAt: string
}

/** Authority errors raised by the persistence service. */
export class InvoiceDraftAuthorityError extends Error {
  readonly code: 'invoice_draft_unauthenticated' | 'invoice_draft_org_missing'
  constructor(code: InvoiceDraftAuthorityError['code'], message?: string) {
    super(message ?? code)
    this.name = 'InvoiceDraftAuthorityError'
    this.code = code
  }
}