/**
 * src/features/billing-draft/billingDraftModalState.ts
 *
 * QBO-2D — pure UI-state helpers for the Prepare Invoice owner-workflow modal.
 *
 * NO React, NO financial recalculation. The billing-draft MODEL
 * (prepareBillingDraft) remains the single source for invoice totals, payment
 * balance, capacity enforcement and review flags. These helpers only:
 *   - assemble the owner's UI selection into a DraftSelection (no math on amounts),
 *   - compose a customer-facing description from selected work context (text only),
 *   - map model review flags to human-readable warning copy WITH severity
 *     (incomplete = subtle inline helper; invalid = blocking amber block).
 *
 * QBO-2D §7/§8: Project Log notes are NEVER concatenated into the invoice
 * Product/Service title. A billing line's `title` is a stable default
 * (PROJECT_DEFAULT_TITLE / SERVICE_DEFAULT_TITLE), owner-editable. The
 * multi-line `description` is seeded from the selected work context — Project
 * Log notes / Service Log work description — and may be owner-edited; it is
 * never parsed as an amount.
 *
 * QBO-2D §3/§22: no previouslyInvoiced, no remainingContractAmount, no
 * paymentScheduleReference. Payment Balance is computed by the model from
 * contractValue − collectedSoFar (display only).
 *
 * QBO-2E §4/§5: itemization is OPTIONAL. The default workflow is ONE lump-sum
 * line (index 0, always active). An extra (optional) line that is completely
 * untouched — no amount, no description, and the unchanged default Product/
 * Service title — is INACTIVE: it is excluded from the invoice total and never
 * blocks approval. Once the owner enters any content or amount into an extra
 * line it becomes active and is validated. This filtering happens here (UI
 * state → model) so the pure model is unchanged; the model still sums and
 * validates every line it receives.
 *
 * No QuickBooks, no persistence, no payment/KPI mutation, no network, no AI.
 */
import type { BillingCandidate, BillingLine, DraftReviewFlag, DraftReviewReason, PreparedBillingDraft } from './billingDraftTypes'
import type { DraftSelection } from './billingDraftModel'

/** Stable default Product/Service names — owner may edit, never derived from log notes. */
export const PROJECT_DEFAULT_TITLE = 'Electrical Project - Progress Billing'
export const SERVICE_DEFAULT_TITLE = 'Electrical Work - Service Work'

/** The common read shape produced by readProjectBilling / readServiceBilling / readServiceCallBilling. */
export interface BillingRead {
  readonly sourceKind: 'project' | 'service'
  readonly sourceId: string
  readonly customerReference: string | null
  /**
   * Canonical reconciled relationship_accounts.id UUID when the source record
   * already carries a VERIFIED UUID (QBO-4A.2 Task 7). NEVER inferred from a
   * name; null/undefined when the source is name-only or has a temporary 'gc...'
   * id. Propagated to the prepared draft and onto the persisted invoice draft's
   * customer_id. A null here is valid (draft stays name-only until link/send).
   */
  readonly customerId?: string | null
  /** A. CONTRACT TRUTH — Project Value / Service Value; null = none. */
  readonly contractValue: number | null
  /** D. PAYMENT TRUTH — collected so far (read-only context). */
  readonly collectedSoFar: number
  /** B. WORK CONTEXT — selectable candidates. */
  readonly candidates: readonly BillingCandidate[]
  /** Service-only: the service log's actual work description, seeds the description textarea. Project reads leave this undefined. */
  readonly workDescription?: string
}

/** Owner UI selection state (text/selection only — never financial truth). */
export interface PrepareInvoiceUiState {
  /** Candidates the owner has checked (Project Logs / service basis). */
  readonly selectedCandidateIds: readonly string[]
  /** Owner-entered billing lines (title + description + Billing Now amount). */
  readonly lines: readonly BillingLine[]
  /** Per-line flags: has the owner edited the description away from the seeded value? */
  readonly descriptionDirty: Readonly<Record<string, boolean>>
}

/** Parse a user-typed amount string into a number (commas stripped; '' → 0). */
export function parseAmount(input: string | number | undefined | null): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0
  const cleaned = String(input ?? '').replace(/,/g, '').trim()
  if (cleaned === '') return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

/**
 * Is a billing line ACTIVE (counted toward the invoice and validated)?
 *
 * The PRIMARY line (index 0) is always active — the lump-sum line the owner is
 * billing. An EXTRA (optional/itemized) line is INACTIVE only when it is
 * completely untouched: no amount, no description, and the Product/Service
 * title is still the unchanged source-kind default. As soon as the owner enters
 * any content (a non-default title or a description) or an amount, the extra
 * line becomes active and is validated (QBO-2E §5).
 */
export function isLineActive(line: BillingLine, index: number, defaultTitle: string): boolean {
  if (index === 0) return true
  const untouched = line.amount <= 0 && !line.description.trim() && line.title === defaultTitle
  return !untouched
}

/** The active lines for a source kind — blank untouched extras are dropped (QBO-2E §5). */
export function activeLines(lines: readonly BillingLine[], sourceKind: 'project' | 'service'): BillingLine[] {
  const defaultTitle = sourceKind === 'service' ? SERVICE_DEFAULT_TITLE : PROJECT_DEFAULT_TITLE
  return lines.filter((l, i) => isLineActive(l, i, defaultTitle))
}

/** Build the full DraftSelection handed to prepareBillingDraft. No financial math. */
export function buildSelection(read: BillingRead, ui: PrepareInvoiceUiState): DraftSelection {
  return {
    sourceKind: read.sourceKind,
    sourceId: read.sourceId,
    customerReference: read.customerReference,
    customerId: read.customerId ?? null,
    contractValue: read.contractValue,
    collectedSoFar: read.collectedSoFar,
    candidates: read.candidates,
    selectedCandidateIds: ui.selectedCandidateIds,
    lines: activeLines(ui.lines, read.sourceKind),
  }
}

/**
 * Compose a customer-facing description from selected work context (text only —
 * never amounts). PROJECT: "Work completed:\n- <note1>\n- <note2>" from selected
 * Project Log descriptions (empty string when none selected). SERVICE: the
 * service's actual work description (workDescription), or '' when none.
 *
 * Used to SEED a billing line's description when the owner has not yet dirtied it.
 */
export function composeWorkDescription(args: {
  candidates: readonly BillingCandidate[]
  selectedIds: readonly string[]
  sourceKind: 'project' | 'service'
  workDescription?: string
}): string {
  const { candidates, selectedIds, sourceKind, workDescription } = args
  if (sourceKind === 'service') {
    return typeof workDescription === 'string' ? workDescription : ''
  }
  const selected = new Set(selectedIds)
  const parts = candidates
    .filter((c) => selected.has(c.id))
    .map((c) => c.description)
    .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
  // De-duplicate while preserving order.
  const seen = new Set<string>()
  const unique = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
  if (unique.length === 0) return ''
  return `Work completed:\n- ${unique.join('\n- ')}`
}

/** Human-readable title/body for a model review flag, WITH severity. */
export function reviewWarning(flag: DraftReviewFlag): { title: string; body: string; severity: 'incomplete' | 'invalid' } {
  const TITLES: Record<DraftReviewReason, string> = {
    line_amount_negative: 'Billing amount invalid',
    line_amount_incomplete: 'Enter an amount to continue',
    line_title_missing: 'Add a Product / Service name',
    overlapping_representation: 'Overlapping billing basis',
  }
  return { title: TITLES[flag.reason] ?? 'Review required', body: flag.detail, severity: flag.severity }
}

/** All warnings for a draft, in model order, each with its severity. */
export function reviewWarnings(draft: PreparedBillingDraft): { title: string; body: string; severity: 'incomplete' | 'invalid' }[] {
  return draft.reviewRequired.map(reviewWarning)
}