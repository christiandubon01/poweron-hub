/**
 * servicePaymentStatus.ts — Service payment WORKFLOW status.
 *
 * FORENSIC-KPI-2B1: this reconciler no longer owns money.
 *
 * It used to. "Paid in Full" forced collected up to the Total Quoted and "Unpaid"
 * forced it to 0, so a workflow control manufactured and erased real dollars. The
 * Status select (Unpaid / Partial / Paid in Full) is still the owner-facing workflow
 * UX and its labels are unchanged — but cash now flows the other way: real money
 * decides the status, and a status choice that contradicts the money is REFUSED
 * rather than applied.
 *
 * Cash is written only by recordServicePayment() in servicePaymentLedger.ts.
 *
 * Pure module: no I/O, no React.
 */

import {
  MONEY_EPSILON,
  deriveServicePayStatus,
  resolveServiceBalanceDue,
  type ServicePayStatusCode,
} from './servicePaymentLedger'
import { num, round2 } from './serviceQuoteMath'

export type ServicePayStatus = ServicePayStatusCode

/**
 * `collected-would-be-erased` — Unpaid was requested while real money is recorded.
 * `outstanding-balance`       — Paid in Full was requested while a balance remains.
 *                               The shortfall is NOT manufactured (locked rule 4);
 *                               resolving it is a separate, explicit business action.
 */
export type ServicePaymentBlockReason = 'collected-would-be-erased' | 'outstanding-balance'

export interface ReconciledServicePayment {
  /** The status that will actually be stored — always truthful against the money. */
  payStatus: ServicePayStatus
  /** Unchanged by this function, except for a negative-input clamp. */
  collected: number
  balanceDue: number
  /** What the owner asked for, so the UI can explain the difference. */
  requestedStatus: ServicePayStatus
  blocked: boolean
  blockedReason: ServicePaymentBlockReason | null
  /** Owner-facing explanation, or null when the request was honoured as-is. */
  message: string | null
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function normalizeStatus(value: unknown): ServicePayStatus {
  return value === 'Y' || value === 'P' || value === 'N' ? value : 'N'
}

/**
 * Resolve the workflow status the owner picked against the money that actually exists.
 *
 * - Paid in Full → allowed only when the outstanding balance is genuinely resolved.
 *                  Never raises Collected to the amount due.
 * - Unpaid       → allowed only when no money is recorded. Never zeroes Collected;
 *                  reversing real cash will be an explicit refund action, not this.
 * - Partial      → reflects that money exists and a balance remains. Never invents an
 *                  amount; resolves to the truthful status when the money says
 *                  otherwise (0 collected reads Unpaid, fully covered reads Paid).
 *
 * `totalBillable` is the full amount due — protected Total Quoted plus valid income
 * adjustments (locked rule 6). Total Quoted is never rewritten to fit a status.
 *
 * Never throws: validation is returned as a result the caller can display.
 */
export function reconcileServicePayment(
  selectedStatus: string,
  collectedInput: unknown,
  totalBillable: unknown,
): ReconciledServicePayment {
  const total = round2(Math.max(0, num(totalBillable)))
  // A negative Collected is not representable money, so it clamps to zero. This is
  // not an erase: there was never a legitimate negative amount to protect.
  const collected = round2(Math.max(0, num(collectedInput)))
  const requestedStatus = normalizeStatus(selectedStatus)
  const truthfulStatus = deriveServicePayStatus(collected, total)
  const balanceDue = resolveServiceBalanceDue(collected, total)

  const base = {
    collected,
    balanceDue,
    requestedStatus,
  }

  if (requestedStatus === 'N' && collected > MONEY_EPSILON) {
    return {
      ...base,
      payStatus: truthfulStatus,
      blocked: true,
      blockedReason: 'collected-would-be-erased',
      message: `Unpaid can't be applied — ${money(collected)} is already recorded as collected. Record a refund to reverse real money.`,
    }
  }

  if (requestedStatus === 'Y' && total > MONEY_EPSILON && collected + MONEY_EPSILON < total) {
    return {
      ...base,
      payStatus: truthfulStatus,
      blocked: true,
      blockedReason: 'outstanding-balance',
      message: `Paid in Full can't be applied — ${money(balanceDue)} of ${money(total)} is still outstanding. Record the payment to settle it.`,
    }
  }

  return {
    ...base,
    payStatus: truthfulStatus,
    blocked: false,
    blockedReason: null,
    message: null,
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
