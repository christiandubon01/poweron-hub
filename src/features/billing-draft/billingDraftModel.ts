/**
 * src/features/billing-draft/billingDraftModel.ts
 *
 * QBO-2D — pure billing-draft builder (owner-workflow model).
 *
 * Simplified from QBO-2C to fit the real owner workflow (QBO-2D §22): selected
 * work candidates are provenance/context (never a title, never a project
 * amount); a billing line is owner-created financial truth (title +
 * description + amount); payment data is context; invoice history is unknown.
 *
 * Pure: no I/O, no React, no clock, no network, no AI, no QuickBooks. It reads
 * structured values supplied by the caller (assembled by the read-only project
 * / service adapters) and produces a PreparedBillingDraft. It never mutates a
 * source contract, payment ledger, or collected-cash value — inputs are
 * consumed by value.
 *
 * RULES:
 *  1. Invoice amount = sum of owner billing line amounts.
 *  2. A blank/zero amount is INCOMPLETE (normal draft), not an error. Only a
 *     negative amount is a blocking INVALID error. Approval is blocked until
 *     the draft is complete (no incomplete OR invalid flags).
 *  3. The owner always controls the amount; structured values only suggest.
 *  4. Draft creation cannot mutate contract / payment ledger / collected cash.
 *  5. Collected cash is read-only context; Payment Balance = contractValue −
 *     collected (display only, never an invoice limit, never "remaining to invoice").
 *  6. Invoice history is unknown — not manufactured, no "remaining to invoice".
 *  7. A service call billed under both total and component representations is
 *     a blocking INVALID (double-count).
 */
import type {
  BillingCandidate,
  BillingLine,
  BillingRepresentationMode,
  DraftReviewFlag,
  DraftReviewReason,
  DraftReviewSeverity,
  PreparedBillingDraft,
} from './billingDraftTypes'

const EPSILON = 0.005

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Severity for each review reason — drives incomplete-vs-invalid UI display. */
const REASON_SEVERITY: Record<DraftReviewReason, DraftReviewSeverity> = {
  line_amount_negative: 'invalid',
  line_amount_incomplete: 'incomplete',
  line_title_missing: 'incomplete',
  overlapping_representation: 'invalid',
}

// ── Candidate / line construction ────────────────────────────────────────────

export interface MakeBillingCandidateInput {
  readonly id: string
  readonly kind: BillingCandidate['kind']
  readonly sourceId: string
  readonly label: string
  readonly description?: string | null
  readonly date?: string | null
  readonly structuredAmount?: number | null
  readonly representationMode?: BillingRepresentationMode | null
  readonly capacityGroup?: string | null
}

/** Build a BillingCandidate. Pure data; validation happens in prepareBillingDraft. */
export function makeBillingCandidate(input: MakeBillingCandidateInput): BillingCandidate {
  const structured = input.structuredAmount
  const structuredAmount = typeof structured === 'number' && Number.isFinite(structured) && structured > 0
    ? round2(structured)
    : null
  return {
    id: input.id,
    kind: input.kind,
    sourceId: input.sourceId,
    label: input.label,
    description: input.description ?? null,
    date: input.date ?? null,
    structuredAmount,
    representationMode: input.representationMode ?? null,
    capacityGroup: input.capacityGroup ?? null,
  }
}

export interface MakeBillingLineInput {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly amount: number
  readonly candidateIds?: readonly string[]
}

/** Build an owner billing line. Pure data. */
export function makeBillingLine(input: MakeBillingLineInput): BillingLine {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    amount: round2(num(input.amount)),
    candidateIds: input.candidateIds ?? [],
  }
}

// ── Draft assembly ───────────────────────────────────────────────────────────

export interface DraftSelection {
  readonly sourceKind: 'project' | 'service'
  readonly sourceId: string
  readonly customerReference: string | null
  /**
   * Reconciled relationship_accounts.id UUID when verified on the source record
   * (QBO-4A.2 Task 7); null otherwise. Never inferred from a name. Propagated to
   * the prepared draft and the persisted invoice draft's customer_id.
   */
  readonly customerId?: string | null
  /** A. CONTRACT TRUTH — Project Value / Service Value; null = none. */
  readonly contractValue: number | null
  /** D. PAYMENT TRUTH — collected so far (read-only context). */
  readonly collectedSoFar: number
  /** B. WORK CONTEXT — selectable candidates. */
  readonly candidates: readonly BillingCandidate[]
  /** Selected candidate ids — provenance for the whole draft. */
  readonly selectedCandidateIds: readonly string[]
  /** C. INVOICE TRUTH — owner-entered billing lines. */
  readonly lines: readonly BillingLine[]
}

/**
 * Prepare a billing draft from an owner selection. Validates the rules above
 * and produces a review-ready draft. A blank amount is INCOMPLETE (subtle),
 * a negative amount is INVALID (blocking), and a service total+component
 * selection is INVALID. Values are reported honestly; nothing is clamped.
 * The draft exposes no mutation method.
 */
export function prepareBillingDraft(selection: DraftSelection): PreparedBillingDraft {
  const candidateById = new Map<string, BillingCandidate>()
  for (const c of selection.candidates) candidateById.set(c.id, c)

  const reviewRequired: DraftReviewFlag[] = []
  const flag = (reason: DraftReviewReason, detail: string, lineId?: string | null): void => {
    reviewRequired.push({ reason, severity: REASON_SEVERITY[reason], detail, lineId: lineId ?? null })
  }

  // ── Owner billing lines.
  for (const line of selection.lines) {
    const amt = num(line.amount)
    if (amt < -EPSILON) {
      flag('line_amount_negative', `Billing line "${line.title || '(no title)'}" has a negative amount. Enter a Billing Now amount of zero or more.`, line.id)
    } else if (!(amt > EPSILON)) {
      // Blank / zero — a normal incomplete draft, NOT an error.
      flag('line_amount_incomplete', 'Enter an amount to continue.', line.id)
    }
    if (!line.title || !String(line.title).trim()) {
      flag('line_title_missing', 'Add a Product / Service name for this line.', line.id)
    }
  }

  // RULE 1: invoice amount = sum of owner billing line amounts.
  const currentInvoiceAmount = round2(selection.lines.reduce((sum, l) => sum + num(l.amount), 0))

  // RULE 7: service representation exclusivity (SERVICE only).
  const groupModes = new Map<string, Set<BillingRepresentationMode>>()
  for (const id of selection.selectedCandidateIds) {
    const c = candidateById.get(id)
    if (c && c.capacityGroup && c.representationMode) {
      let set = groupModes.get(c.capacityGroup)
      if (!set) {
        set = new Set()
        groupModes.set(c.capacityGroup, set)
      }
      set.add(c.representationMode)
    }
  }
  for (const [group, modes] of groupModes) {
    if (modes.has('total') && modes.has('component')) {
      flag('overlapping_representation', `Service call "${group}" is billed under both the total and the itemized (labor/material) representations. These describe the same billable value; choose one billing basis.`)
    }
  }

  // RULE 5: Payment Balance (display only; never an invoice limit).
  const contractValue =
    typeof selection.contractValue === 'number' && Number.isFinite(selection.contractValue)
      ? round2(selection.contractValue)
      : null
  const collectedSoFar = round2(num(selection.collectedSoFar))
  const paymentBalance = contractValue == null ? null : round2(contractValue - collectedSoFar)

  return {
    authority: 'owner_approved_outbound',
    sourceKind: selection.sourceKind,
    sourceId: selection.sourceId,
    customerReference: selection.customerReference ?? null,
    customerId: selection.customerId ?? null,
    contractValue,
    currentInvoiceAmount,
    collectedSoFar,
    paymentBalance,
    candidates: selection.candidates,
    selectedCandidateIds: selection.selectedCandidateIds,
    lines: selection.lines,
    reviewRequired,
    ready: reviewRequired.length === 0,
  }
}