/**
 * servicePaymentStatus.ts — SERVICE-LOG-1 polish: payment status reconciliation.
 *
 * The Status select (Unpaid / Partial / Paid in Full) is authoritative.
 *
 * Collected is the value every downstream reader actually uses — getServiceRollup,
 * getServicePaymentMeta, the Collections Queue, balance colours and the KPI
 * rollups all derive from it. The save path used to recompute payStatus from
 * Collected alone, which silently discarded whatever the owner selected. This
 * helper reconciles the two the same way the existing Mark Paid / Partial row
 * actions do, so the stored payStatus, balanceDue and the displayed status all
 * agree with the choice.
 *
 * Pure module: no I/O, no React.
 */

export type ServicePayStatus = 'Y' | 'P' | 'N'

export interface ReconciledServicePayment {
  payStatus: ServicePayStatus
  collected: number
  balanceDue: number
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Resolve the status the owner picked against the amount collected.
 *
 * - Paid in Full  → Collected becomes the full Total Quoted, balance 0.
 * - Unpaid        → Collected becomes 0, full balance outstanding.
 * - Partial       → keeps the typed amount, but only while it is genuinely
 *                   partial; 0 resolves to Unpaid and >= total resolves to Paid,
 *                   because the rest of the app cannot represent anything else.
 */
export function reconcileServicePayment(
  selectedStatus: string,
  collectedInput: unknown,
  totalQuoted: unknown,
): ReconciledServicePayment {
  const total = Math.max(0, num(totalQuoted))
  let collected = Math.max(0, num(collectedInput))
  let payStatus: ServicePayStatus =
    selectedStatus === 'Y' || selectedStatus === 'P' || selectedStatus === 'N'
      ? selectedStatus
      : 'N'

  if (payStatus === 'Y') {
    collected = total
  } else if (payStatus === 'N') {
    collected = 0
  } else if (total > 0) {
    if (collected <= 0) {
      payStatus = 'N'
      collected = 0
    } else if (collected >= total) {
      payStatus = 'Y'
      collected = total
    }
  } else if (collected <= 0) {
    payStatus = 'N'
  }

  return {
    payStatus,
    collected,
    balanceDue: payStatus === 'Y' ? 0 : Math.max(0, total - collected),
  }
}

/** Total Quoted slider granularity — the owner prices in $5 increments. */
export const TOTAL_QUOTED_STEP = 5

/** Round up to the next slider stop. */
export function roundUpToQuoteStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.ceil(value / TOTAL_QUOTED_STEP) * TOTAL_QUOTED_STEP
}

/** Snap a value onto the $5 slider grid for thumb positioning (display only). */
export function snapToQuoteStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value / TOTAL_QUOTED_STEP) * TOTAL_QUOTED_STEP
}
