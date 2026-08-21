/**
 * src/features/billing-draft/unpaidServiceEligibility.ts
 *
 * QBO-2F1 — the SINGLE eligibility filter for "unpaid service work ready to
 * invoice." Pure: no React, no DOM, no Supabase, no settings read, no QBO.
 *
 * IMPORTANT — authority separation (no duplicate financial rule):
 *   - The BALANCE authority (what a service log still owes) is the existing
 *     `serviceBalanceDue()` in V15rFieldLogPanel. This module does NOT redefine
 *     "unpaid", "outstanding", "balance due", or "service balance". It receives
 *     the balance as an injected predicate and only owns the THRESHOLD + SORT
 *     mechanics.
 *   - The THRESHOLD (0.009) and the "biggest balance first" ordering are the
 *     same ones the existing Collections queue uses, lifted here so the global
 *     Prepare Invoice selector and the Collections queue derive from ONE rule
 *     instead of two inline copies.
 *
 * Both the Collections queue and the global Prepare Invoice selector go through
 * `getUnpaidServiceCalls()` in V15rFieldLogPanel, which calls
 * `filterUnpaidByBalance(logs, serviceBalanceDue)` — one balance authority, one
 * eligibility filter, zero duplication.
 */

/** Balance above which a service log is considered still unpaid/invoice-eligible.
 *  Matches the existing Collections queue threshold (`> 0.009`). */
export const UNPAID_BALANCE_THRESHOLD = 0.009

/**
 * Filter `items` to those whose `balanceOf(item)` exceeds the unpaid threshold,
 * sorted largest balance first. Generic over the item type so it is fully unit
 * testable with a stubbed balance function — proving paid (balance 0) entries
 * are excluded and unpaid (balance > 0) entries are included, without
 * redefining how a balance is computed.
 */
export function filterUnpaidByBalance<T>(
  items: readonly T[],
  balanceOf: (item: T) => number,
): T[] {
  return items
    .filter((item) => balanceOf(item) > UNPAID_BALANCE_THRESHOLD)
    .sort((a, b) => balanceOf(b) - balanceOf(a))
}