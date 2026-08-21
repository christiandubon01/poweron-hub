/**
 * src/features/billing-draft/billingDraftTypes.ts
 *
 * QBO-2D — Prepare Invoice owner-workflow model (PowerOn-side, pure types).
 *
 * RUNTIME-DRIVEN UX CORRECTION to QBO-2C. The owner's runtime test showed the
 * data source was corrected (real Project Logs / Service Log) but the UX still
 * failed: unclear selected state, log notes concatenated into the invoice
 * title, a scary "Billing amount invalid" warning on a normal blank draft,
 * bogus $360,000 phase-schedule values, and a fake "Remaining on Contract"
 * concept that cannot be truthful while invoice history is not yet tracked.
 *
 * This model simplifies to the REAL owner workflow:
 *   - Selected work candidates are CONTEXT / PROVENANCE — they answer "what
 *     work is this invoice related to?". They never become the invoice
 *     product/service title, and they never carry a dollar amount for projects.
 *   - A billing LINE is owner-created financial truth for THIS draft: a short
 *     Product/Service title, a multi-line Description, and a Billing Now amount
 *     the owner enters.
 *   - Payment data is CONTEXT (Project Value, Collected, Payment Balance).
 *   - Invoice history is UNKNOWN until real invoice persistence exists, so it
 *     is displayed as "Not tracked yet" and never manufactured.
 *
 * FOUR SEPARATE TRUTHS (kept explicit; "remaining to invoice" removed):
 *   A. CONTRACT TRUTH   — Project Value (change-order-adjusted contract) or
 *                         Service Value (structured total billable). null = none.
 *   B. WORK CONTEXT     — selectable Project Logs / Service Log components.
 *                         Provenance only; never a title; never a project amount.
 *   C. INVOICE TRUTH    — owner-entered billing lines (title + description + amount).
 *   D. PAYMENT TRUTH    — collected so far (read-only context). Payment Balance
 *                         = Contract Truth − Collected (display only; NOT an
 *                         invoice limit). Never "previously invoiced".
 *
 * INCOMPLETE vs INVALID (QBO-2D §10): a blank/zero Billing Now is a NORMAL
 * incomplete draft, not an error. Only a negative amount or a structural
 * conflict (service total + itemized double-count) is a blocking INVALID
 * error. Missing title is incomplete. Approval is blocked until the draft is
 * complete (no incomplete OR invalid flags).
 *
 * KPI FIREWALL: preparing a draft is OUTBOUND (PowerOn → QBO later). It READS
 * PowerOn values and never WRITES PowerOn financial/KPI truth. No QBO API call,
 * no persistence, no migration, no AI. No phase_timeline / getPhasePaymentSchedule
 * value participates (QBO-2D §2/§21) — those were the source of the bogus
 * $360,000 schedule and are absent from this workflow entirely.
 */
export type BillingSourceKind = 'project' | 'service'

/**
 * Service representation mode (QBO-2A1 exclusivity, retained for SERVICE only):
 *  - 'total'     covers the WHOLE billable value of the call.
 *  - 'component' covers a SLICE (labor or materials).
 * Billing a call under both 'total' and 'component' on one draft double-counts
 * the same value → INVALID. Project log candidates carry no mode.
 */
export type BillingRepresentationMode = 'total' | 'component'

/** Kind of a selectable work candidate — real operational truth, never synthesized. */
export type BillingCandidateKind =
  | 'project_log'
  | 'service_total'
  | 'service_labor'
  | 'service_material'

/**
 * WORK CONTEXT — one selectable candidate. Real PowerOn operational truth:
 * a Project Log, or a Service Log's structured total/labor/material component.
 * `structuredAmount` is the structured billing amount where the source genuinely
 * stores one (a service quote, itemized materials); null when none exists, in
 * which case the owner enters the amount. The model never invents an amount from
 * prose. For PROJECT logs this is always null — logs are context, not amounts.
 */
export interface BillingCandidate {
  readonly id: string
  readonly kind: BillingCandidateKind
  readonly sourceId: string
  readonly label: string
  /** Descriptive context ONLY — never parsed as an amount, never a title. */
  readonly description: string | null
  readonly date: string | null
  readonly structuredAmount: number | null
  readonly representationMode: BillingRepresentationMode | null
  readonly capacityGroup: string | null
}

/**
 * INVOICE TRUTH — one owner-entered billing line.
 *  - `title`       : short Product / Service name (stable default, NOT from log notes).
 *  - `description` : multi-line customer-facing description (may be seeded from
 *                    selected work context; owner-edited; never a title).
 *  - `amount`      : Billing Now — chosen by the owner (never from logs/schedule/collected).
 *  - `candidateIds`: provenance only — which work this line relates to. Never affects math.
 */
export interface BillingLine {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly amount: number
  readonly candidateIds: readonly string[]
}

/** Why a draft is not yet approvable, and how to display it. */
export type DraftReviewSeverity = 'incomplete' | 'invalid'

export type DraftReviewReason =
  /** A billing line amount is negative — a blocking error (invalid). */
  | 'line_amount_negative'
  /** A billing line amount is blank/zero — a normal incomplete draft (incomplete). */
  | 'line_amount_incomplete'
  /** A billing line is missing its Product/Service title (incomplete). */
  | 'line_title_missing'
  /** A service call is billed under both total and component representations (invalid). */
  | 'overlapping_representation'

export interface DraftReviewFlag {
  readonly reason: DraftReviewReason
  readonly severity: DraftReviewSeverity
  readonly detail: string
  readonly lineId?: string | null
}

/**
 * PREPARED BILLING DRAFT — the terminal artifact. OUTBOUND owner-approved
 * PowerOn data destined for QuickBooks LATER; it is NOT a QBO invoice and carries
 * no QBO id. It exposes NO mutation method. Invoice history is unknown
 * ("Not tracked yet") and "remaining to invoice" is not manufactured.
 */
export interface PreparedBillingDraft {
  readonly authority: 'owner_approved_outbound'
  readonly sourceKind: BillingSourceKind
  readonly sourceId: string
  readonly customerReference: string | null
  /**
   * Canonical reconciled relationship_accounts.id UUID when the source record
   * already carries a VERIFIED UUID (QBO-4A.2 Task 7). NEVER inferred from a
   * name — null when the source has only a name snapshot or a temporary 'gc...'
   * id. Propagated onto the persisted invoice draft's customer_id so future
   * customer-mapping lookup can resolve it; a null here is valid and leaves the
   * draft name-only (resolved later when the owner links/sends).
   */
  readonly customerId?: string | null

  // ── A. CONTRACT TRUTH ──
  /** Project Value (CO-adjusted) or Service Value (structured total billable). null = none. */
  readonly contractValue: number | null

  // ── C. INVOICE TRUTH ──
  /** Current invoice amount = sum of owner billing line amounts. */
  readonly currentInvoiceAmount: number

  // ── D. PAYMENT TRUTH (read-only context) ──
  readonly collectedSoFar: number
  /** Payment Balance = contractValue − collectedSoFar (display only; NOT an invoice limit). null when contractValue is null. */
  readonly paymentBalance: number | null

  // ── B. WORK CONTEXT / PROVENANCE ──
  readonly candidates: readonly BillingCandidate[]
  /** Selected work candidate ids — provenance for the whole draft (what work this invoice relates to). */
  readonly selectedCandidateIds: readonly string[]
  readonly lines: readonly BillingLine[]

  /** Owner-review flags. `ready` is true only when this is empty (approval allowed). */
  readonly reviewRequired: readonly DraftReviewFlag[]
  readonly ready: boolean
}