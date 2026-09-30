import type { FinancialAttribution, FinancialConfidence, FinancialProvenance } from './domain'

// ── Policy ──────────────────────────────────────────────────────────────────

/**
 * All inputs that govern what "must be protected right now" means.
 * No business-value defaults live inside the engine; the caller must supply
 * every field explicitly.
 *
 * Intentionally extensible:
 *   taxReserve may gain a 'percentage_of_inflow' variant once its canonical
 *   taxable-income basis is defined. Do not add that variant until then.
 */
export interface CashAllocationPolicy {
  organizationId: string
  /** YYYY-MM-DD. Injected for determinism; validated on entry. */
  asOfDate: string
  /** Non-negative integer. How many calendar days forward counts as "now". */
  protectionHorizonDays: number
  /** Non-negative integer cents. Always-protected policy floor (0 = disabled). */
  operatingFloorMinor: number
  taxReserve: TaxReservePolicy
  /**
   * When false (default) only requirement='required' events are protected.
   * When true, requirement='optional' events inside the horizon are also included.
   */
  includeOptionalObligations: boolean
}

export type TaxReservePolicy =
  | { kind: 'disabled' }
  | { kind: 'fixed_amount'; amountMinor: number }

// ── Buckets ─────────────────────────────────────────────────────────────────

export type AllocationBucket =
  | 'project_reserve'   // obligation-backed, project-attributed (no employee)
  | 'payroll'           // obligation-backed, employee-attributed (wins over project)
  | 'tax'               // policy-driven
  | 'vehicle'           // obligation-backed, category='vehicle'
  | 'overhead'          // obligation-backed, category='overhead'
  | 'owner_pay'         // obligation-backed, category='owner_pay'
  | 'operating_floor'   // policy-driven
  | 'debt_service'      // obligation-backed, debtAccountId set (no employee)
  | 'other'             // obligation-backed, uncategorized

// ── Protected requirement ────────────────────────────────────────────────────

export type ProtectedRequirementReason =
  | 'overdue'           // event.date < policy.asOfDate
  | 'in_horizon'        // event.date is within [asOfDate, asOfDate + horizonDays]
  | 'operating_floor'   // policy slot
  | 'tax_reserve'       // policy slot

export interface ProtectedRequirement {
  /** Org-scoped, canonical, stable dedup key. See allocationEngine.ts. */
  dedupeKey: string
  label: string
  bucket: AllocationBucket
  /** Integer cents. Never negative. */
  amountMinor: number
  reason: ProtectedRequirementReason
  confidence: FinancialConfidence
  sourceType: 'obligation_occurrence' | 'cash_commitment' | 'policy' | 'derived_liability'
  /** null for policy-driven slots. */
  sourceRecordId: string | null
  attribution: FinancialAttribution
}

// ── Derived liability input ──────────────────────────────────────────────────

/**
 * A canonical derived liability that CASH-4 can protect alongside CASH-3
 * obligations and commitments. Used by CASH-5+ to inject payroll exposure
 * (and future project-gap liabilities) without masquerading as obligations.
 *
 * Provenance must retain the original source kind ('employee_time_entry' or
 * 'employee_work_session'). Callers must never use 'cash_commitment' or
 * 'financial_obligation_occurrence' here.
 *
 * The dedup key is derived from provenance.source via financialReconciliationKey,
 * so the same canonical source record is never counted twice even across
 * CASH-3 and CASH-5 inputs.
 */
export interface FinancialLiabilityInput {
  organizationId: string
  /** YYYY-MM-DD. The date the liability became due / was earned. */
  dueDate: string
  /** Non-negative integer cents. */
  amountMinor: number
  requirement: 'required' | 'optional'
  provenance: FinancialProvenance
  attribution: FinancialAttribution
  label: string
}

// ── Allocation result ────────────────────────────────────────────────────────

export interface ProtectedAllocationResult {
  organizationId: string
  asOfDate: string
  requirements: ProtectedRequirement[]
  /** Sum of all ProtectedRequirement.amountMinor. */
  totalProtectedRequirementMinor: number
  /**
   * Canonical source keys of events that were suppressed because their
   * exact dedup key had already been seen. Diagnostic only.
   */
  suppressedDuplicateSourceKeys: string[]
}

// ── Final snapshot ───────────────────────────────────────────────────────────

export interface CashAllocationSnapshot {
  organizationId: string
  asOfDate: string
  /** Signed. May be negative when included asset accounts are overdrawn. */
  totalCashMinor: number
  /** Total amount that SHOULD be protected per policy. */
  totalProtectedRequirementMinor: number
  /**
   * Amount of currently available cash actually covered/protected.
   * = max(0, min(totalCashMinor, totalProtectedRequirementMinor))
   * Never negative.
   */
  protectedCashMinor: number
  /**
   * Cash available beyond all protection requirements.
   * = max(0, totalCashMinor - totalProtectedRequirementMinor)
   * Never negative.
   */
  trulyFreeCashMinor: number
  /**
   * Protection requirements not covered by available cash.
   * = max(0, totalProtectedRequirementMinor - totalCashMinor)
   * Includes any negative-cash shortfall.
   * Never negative.
   */
  uncoveredProtectionDeficitMinor: number
  allocationResult: ProtectedAllocationResult
  policy: CashAllocationPolicy
}
