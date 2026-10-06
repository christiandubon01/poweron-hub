import { financialReconciliationKey, usd, type FinanceAdapterScope, type FinancialAttribution, type FinancialProvenance } from '../domain'
import type { FinancialLiabilityInput } from '../allocationTypes'
import { parseCalendarDate } from '../recurrence'

// ── Existing CASH-4A adapter types (unchanged) ────────────────────────────────

export interface PaidTimeEntryLike {
  id: string
  employeeProfileId: string
  backupEmployeeId?: string | null
  projectId?: string | null
  workDate: string
  paidMinutes: number
}

export interface EmployeeCashRateLike {
  backupEmployeeId: string
  /** Cash wage rate only. Do not substitute billRate or loaded cost. */
  cashWageMinorPerHour: number
}

export interface PayrollQuantityEvent {
  id: string
  organizationId: string
  employeeProfileId: string
  backupEmployeeId?: string | null
  projectId?: string | null
  workDate: string
  paidMinutes: number
  provenance: FinancialProvenance
}

export interface PayrollExposureEvent extends PayrollQuantityEvent {
  amount: ReturnType<typeof usd>
  attribution: FinancialAttribution
}

export function readPaidTimeQuantities(
  scope: FinanceAdapterScope,
  rows: readonly PaidTimeEntryLike[],
): PayrollQuantityEvent[] {
  return rows
    .filter((row) => Number.isInteger(row.paidMinutes) && row.paidMinutes >= 0)
    .map((row) => ({
      id: `paid-time:${row.id}`,
      organizationId: scope.organizationId,
      employeeProfileId: row.employeeProfileId,
      backupEmployeeId: row.backupEmployeeId ?? null,
      projectId: row.projectId ?? null,
      workDate: row.workDate,
      paidMinutes: row.paidMinutes,
      provenance: {
        source: {
          organizationId: scope.organizationId,
          kind: 'employee_time_entry',
          recordId: row.id,
          effectiveDate: row.workDate,
        },
        freshness: 'current',
        confidence: 'confirmed',
        reconciliationState: 'unreconciled',
        note: 'Paid minutes are quantity truth. Work sessions are not added as a second quantity.',
      },
    }))
}

export function pricePaidTimeAtCashWage(
  quantities: readonly PayrollQuantityEvent[],
  rates: readonly EmployeeCashRateLike[],
): PayrollExposureEvent[] {
  const rateByBackupId = new Map(rates.map((rate) => [rate.backupEmployeeId, rate.cashWageMinorPerHour]))
  return quantities.flatMap((quantity) => {
    if (!quantity.backupEmployeeId) return []
    const rate = rateByBackupId.get(quantity.backupEmployeeId)
    if (!Number.isSafeInteger(rate) || rate! < 0) return []
    const amountMinor = Math.round((quantity.paidMinutes * rate!) / 60)
    return [{
      ...quantity,
      amount: usd(amountMinor),
      attribution: {
        employeeId: quantity.backupEmployeeId,
        projectId: quantity.projectId ?? null,
        category: 'payroll',
      },
    }]
  })
}

// ── CASH-5B: Payroll exposure types ──────────────────────────────────────────

export interface PayrollExposurePolicy {
  organizationId: string
  /** YYYY-MM-DD. The "as of" date; only entries with workDate <= asOfDate are included. */
  asOfDate: string
  /** ISO timestamp used to estimate accruing minutes for open sessions. Injected; no Date.now(). */
  asOfTimestamp: string
  /** YYYY-MM-DD, inclusive. Any workDate <= paidThroughDate is excluded as already settled. */
  paidThroughDate: string
  /** When true, open sessions provide provisional estimates even without a closed time_entry. */
  includeOpenShiftEstimates: boolean
}

/** Input from time_entries (one row per employee per workday). */
export interface ClosedTimeEntryInput {
  id: string
  organizationId: string
  employeeProfileId: string
  /** YYYY-MM-DD */
  workDate: string
  /** null when the daily entry is still open (no clock_out for any session that day). */
  paidMinutes: number | null
  status: 'open' | 'complete' | 'incomplete' | 'corrected' | 'auto_closed'
  approvalStatus: 'none' | 'pending' | 'approved' | 'rejected'
}

/** Input from employee_work_sessions. Used only when the daily time_entry is still open. */
export interface OpenSessionInput {
  id: string
  organizationId: string
  employeeProfileId: string
  /** YYYY-MM-DD */
  workDate: string
  /** ISO timestamp. Not null: sessions always start with clock_in. */
  clockInAt: string
  lunchOutAt: string | null
  lunchInAt: string | null
  /** null when the session is still open. */
  clockOutAt: string | null
  /** null when the session is still open; authoritative when closed. */
  paidMinutes: number | null
  /** From assignment → project. May be null. */
  projectId: string | null
}

/** Maps an employee_profiles row to its cost-model BackupEmployee id. */
export interface ProfileIdentityBridge {
  employeeProfileId: string
  backupEmployeeId: string | null
}

/** Raw employee record for CASH-safe wage resolution. */
export interface EmployeeRateInput {
  backupEmployeeId: string
  /** True base wage in dollars (set at record save time). Preferred. */
  hourly_rate?: number | null
  /** Loaded rate for W-2 (base × multiplier) or base for owner/1099. Used as fallback. */
  costRate?: number | null
  classification?: 'W-2' | '1099' | null
  employee_type?: 'permanent' | 'per_project' | 'hypothetical' | null
  isOwner?: boolean | null
}

/**
 * What a manually entered planned item's free-text category says about payroll.
 *  - 'wages'   : the employee wage liability itself (category is just "payroll"). Derived payroll already
 *                covers this, so a manual copy is a genuine duplicate risk.
 *  - 'service' : a cost of running payroll (agency, processing, software, filing fees). An operating expense,
 *                a different financial fact from wages, so it never overlaps derived wage exposure.
 *  - 'none'    : unrelated to payroll.
 */
export type ManualPayrollCategoryKind = 'wages' | 'service' | 'none'

const PAYROLL_SERVICE_WORDS = /\b(service|services|fee|fees|processing|processor|agency|provider|software|subscription|filing|admin|administration|charge|charges)\b/

export function classifyManualPayrollCategory(category: string | null | undefined): ManualPayrollCategoryKind {
  const normalized = String(category ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!normalized.includes('payroll')) return 'none'
  if (PAYROLL_SERVICE_WORDS.test(normalized)) return 'service'
  return normalized === 'payroll' ? 'wages' : 'none'
}

/** Minimal interface for checking manual payroll obligation overlap. */
export interface ManualPayrollObligationLike {
  id: string
  organizationId: string
  /** RecurringObligation has no employeeId — included for future schema extension. */
  attribution?: { employeeId?: string | null } | null
  /** Free-text category. 'payroll' triggers overlap diagnostic. */
  category?: string | null
}

/** Minimal interface for checking manual payroll commitment overlap. */
export interface ManualPayrollCommitmentLike {
  id: string
  organizationId: string
  /** CashCommitment.employeeId — if set, this is an employee-attributed commitment. */
  employeeId?: string | null
  category?: string | null
}

export type PayrollExposureDiagnosticKind =
  | 'missing_employee_bridge'
  | 'missing_employee_record'
  | 'missing_cash_wage'
  | 'incomplete_time_entry'
  | 'invalid_time_quantity'
  | 'invalid_work_date'
  | 'invalid_open_session_time'
  | 'potential_manual_payroll_overlap'

export interface PayrollExposureDiagnostic {
  kind: PayrollExposureDiagnosticKind
  employeeProfileId?: string
  sourceId?: string
  note: string
}

export interface PayrollExposureResult {
  liabilities: FinancialLiabilityInput[]
  diagnostics: PayrollExposureDiagnostic[]
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseMs(ts: string): number | null {
  const ms = new Date(ts).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Resolve the cash wage in integer cents per hour for a payroll employee.
 *
 * Priority:
 * 1. hourly_rate > 0 → base wage directly
 * 2. costRate > 0 AND NOT W-2 → costRate equals base (owner/1099/per_project)
 * 3. costRate > 0 AND W-2 AND valid payrollMultiplier → decode: base = costRate / multiplier
 * 4. otherwise → null (missing_cash_wage diagnostic)
 *
 * billRate and settings.opCost are never consulted — they are not parameters.
 */
function resolveCashWageMinor(emp: EmployeeRateInput, payrollMultiplier?: number): number | null {
  const raw = Number(emp.hourly_rate)
  if (raw > 0) {
    const cents = Math.round(raw * 100)
    return Number.isSafeInteger(cents) && cents >= 0 ? cents : null
  }

  const cr = Number(emp.costRate)
  if (cr > 0) {
    const isW2 = !emp.isOwner && emp.classification !== '1099' && emp.employee_type !== 'per_project'
    if (isW2) {
      if (payrollMultiplier != null && Number.isFinite(payrollMultiplier) && payrollMultiplier >= 1) {
        const base = cr / payrollMultiplier
        const cents = Math.round(base * 100)
        return Number.isSafeInteger(cents) && cents >= 0 ? cents : null
      }
      return null
    }
    const cents = Math.round(cr * 100)
    return Number.isSafeInteger(cents) && cents >= 0 ? cents : null
  }

  return null
}

/**
 * Estimate paid minutes for an open (not yet clocked-out) session.
 *
 * Returns { minutes, diagnosticNote? }. diagnosticNote is set when timestamps
 * are malformed or logically inconsistent; in that case minutes = 0.
 */
function estimateOpenSessionMinutes(
  session: OpenSessionInput,
  asOfMs: number,
): { minutes: number; diagnosticNote?: string } {
  const clockInMs = parseMs(session.clockInAt)
  if (clockInMs === null) return { minutes: 0, diagnosticNote: 'unparseable clock_in_at' }
  if (clockInMs > asOfMs) return { minutes: 0, diagnosticNote: 'clock_in_at is in the future relative to asOfTimestamp' }

  const totalMs = asOfMs - clockInMs
  const totalMinutes = Math.floor(totalMs / 60_000)

  if (session.lunchOutAt == null) {
    return { minutes: Math.max(0, totalMinutes) }
  }

  const lunchOutMs = parseMs(session.lunchOutAt)
  if (lunchOutMs === null || lunchOutMs < clockInMs || lunchOutMs > asOfMs) {
    return { minutes: 0, diagnosticNote: 'invalid or future lunch_out_at' }
  }

  if (session.lunchInAt != null) {
    // Completed lunch: subtract the full lunch duration
    const lunchInMs = parseMs(session.lunchInAt)
    if (lunchInMs === null || lunchInMs < lunchOutMs) {
      return { minutes: 0, diagnosticNote: 'invalid lunch_in_at (before lunch_out_at or unparseable)' }
    }
    const lunchMinutes = Math.floor((lunchInMs - lunchOutMs) / 60_000)
    return { minutes: Math.max(0, totalMinutes - lunchMinutes) }
  }

  // Currently on lunch: subtract elapsed lunch time — paid minutes stop accruing during lunch
  const lunchElapsedMinutes = Math.floor((asOfMs - lunchOutMs) / 60_000)
  return { minutes: Math.max(0, totalMinutes - lunchElapsedMinutes) }
}

// ── buildPayrollExposure ──────────────────────────────────────────────────────

/**
 * Build canonical payroll exposure liabilities for CASH-4 ingestion.
 *
 * Rules:
 * - Finalized daily time_entries own quantity even when invalid; valid quantities
 *   produce confirmed or expected exposure.
 * - Open entries use employee_work_sessions as provisional
 *   estimates when policy.includeOpenShiftEstimates is true.
 * - Sessions are NEVER added on top of a closed time_entry for the same employee+date.
 * - approval_status='rejected' entries and their sessions are excluded.
 * - Cash wage = base wage only. billRate and settings.opCost are not parameters.
 * - Each liability retains canonical provenance: 'employee_time_entry' or 'employee_work_session'.
 * - Missing identity, missing rate, or invalid quantities produce diagnostics, not invented money.
 *
 * @param policy           Date bounds and open-shift estimation toggle.
 * @param timeEntries      Rows from time_entries for the org.
 * @param sessions         Rows from employee_work_sessions for the org (used only when open estimates enabled).
 * @param bridges          Rows from employee_profiles mapping profileId → backupEmployeeId.
 * @param employees        Cost-model employee records for rate resolution.
 * @param manualObligations Existing CASH-3 obligations to check for payroll overlap.
 * @param manualCommitments Existing CASH-3 commitments to check for payroll overlap.
 * @param payrollMultiplier For decoding stale W-2 costRate only (base = costRate / mult).
 */
export function buildPayrollExposure(
  policy: PayrollExposurePolicy,
  timeEntries: readonly ClosedTimeEntryInput[],
  sessions: readonly OpenSessionInput[],
  bridges: readonly ProfileIdentityBridge[],
  employees: readonly EmployeeRateInput[],
  manualObligations: readonly ManualPayrollObligationLike[],
  manualCommitments: readonly ManualPayrollCommitmentLike[],
  payrollMultiplier?: number,
): PayrollExposureResult {
  // ── Validate policy dates ──────────────────────────────────────────────────
  parseCalendarDate(policy.asOfDate)
  parseCalendarDate(policy.paidThroughDate)
  const asOfMs = parseMs(policy.asOfTimestamp)
  if (asOfMs === null) {
    throw new Error(`PayrollExposurePolicy.asOfTimestamp is not a valid ISO timestamp: ${policy.asOfTimestamp}`)
  }

  const orgId = policy.organizationId
  const liabilities: FinancialLiabilityInput[] = []
  const diagnostics: PayrollExposureDiagnostic[] = []

  // ── Build identity lookup maps ─────────────────────────────────────────────
  const bridgeMap = new Map<string, string | null>()
  for (const b of bridges) {
    if (b.employeeProfileId && b.employeeProfileId !== '') {
      bridgeMap.set(b.employeeProfileId, b.backupEmployeeId)
    }
  }

  const employeeMap = new Map<string, EmployeeRateInput>()
  for (const e of employees) {
    if (e.backupEmployeeId) employeeMap.set(e.backupEmployeeId, e)
  }

  // ── Track which (employeeProfileId, workDate) are handled by closed entries ─
  const closedHandledKey = (profileId: string, workDate: string) => `${profileId}:${workDate}`
  const closedHandled = new Set<string>()
  const rejectedDays = new Set<string>()

  // ── Step 1: Closed time entries ────────────────────────────────────────────
  for (const entry of timeEntries) {
    if (entry.organizationId !== orgId) continue
    try {
      parseCalendarDate(entry.workDate)
    } catch {
      diagnostics.push({
        kind: 'invalid_work_date',
        employeeProfileId: entry.employeeProfileId,
        sourceId: entry.id,
        note: `time_entries.work_date is not a valid calendar date: ${entry.workDate}`,
      })
      continue
    }
    if (entry.workDate <= policy.paidThroughDate) continue
    if (entry.workDate > policy.asOfDate) continue

    if (entry.approvalStatus === 'rejected') {
      rejectedDays.add(closedHandledKey(entry.employeeProfileId, entry.workDate))
      continue
    }

    if (entry.status === 'open') continue

    // A finalized daily entry owns the quantity even if its own data cannot be priced.
    closedHandled.add(closedHandledKey(entry.employeeProfileId, entry.workDate))

    if (entry.paidMinutes === null || !Number.isInteger(entry.paidMinutes) || entry.paidMinutes < 0) {
      diagnostics.push({
        kind: 'invalid_time_quantity',
        employeeProfileId: entry.employeeProfileId,
        sourceId: entry.id,
        note: `time_entries.paid_minutes is not a valid non-negative integer: ${entry.paidMinutes}`,
      })
      continue
    }

    // Resolve identity
    if (!bridgeMap.has(entry.employeeProfileId)) {
      diagnostics.push({
        kind: 'missing_employee_bridge',
        employeeProfileId: entry.employeeProfileId,
        sourceId: entry.id,
        note: `No ProfileIdentityBridge found for employeeProfileId ${entry.employeeProfileId}`,
      })
      continue
    }
    const backupEmployeeId = bridgeMap.get(entry.employeeProfileId)
    if (!backupEmployeeId) {
      diagnostics.push({
        kind: 'missing_employee_bridge',
        employeeProfileId: entry.employeeProfileId,
        sourceId: entry.id,
        note: `ProfileIdentityBridge exists but backupEmployeeId is null for employeeProfileId ${entry.employeeProfileId}`,
      })
      continue
    }

    const emp = employeeMap.get(backupEmployeeId)
    if (!emp) {
      diagnostics.push({
        kind: 'missing_employee_record',
        employeeProfileId: entry.employeeProfileId,
        sourceId: entry.id,
        note: `No EmployeeRateInput found for backupEmployeeId ${backupEmployeeId}`,
      })
      continue
    }

    const rateMinor = resolveCashWageMinor(emp, payrollMultiplier)
    if (rateMinor === null) {
      diagnostics.push({
        kind: 'missing_cash_wage',
        employeeProfileId: entry.employeeProfileId,
        sourceId: entry.id,
        note: `Cannot resolve base cash wage for backupEmployeeId ${backupEmployeeId}. A W-2 costRate requires a valid payrollMultiplier >= 1. billRate and opCost are never used as substitutes.`,
      })
      continue
    }

    const amountMinor = Math.round((entry.paidMinutes * rateMinor) / 60)
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      diagnostics.push({
        kind: 'invalid_time_quantity',
        employeeProfileId: entry.employeeProfileId,
        sourceId: entry.id,
        note: `Computed amountMinor ${amountMinor} is invalid`,
      })
      continue
    }

    let confidence: 'confirmed' | 'expected'
    if (entry.status === 'incomplete') {
      confidence = 'expected'
      diagnostics.push({
        kind: 'incomplete_time_entry',
        employeeProfileId: entry.employeeProfileId,
        sourceId: entry.id,
        note: `time_entry status is 'incomplete'; exposure is expected (not confirmed)`,
      })
    } else {
      confidence = 'confirmed'
    }

    liabilities.push({
      organizationId: orgId,
      dueDate: entry.workDate,
      amountMinor,
      requirement: 'required',
      provenance: {
        source: {
          organizationId: orgId,
          kind: 'employee_time_entry',
          recordId: entry.id,
          effectiveDate: entry.workDate,
        },
        freshness: 'current',
        confidence,
        reconciliationState: 'unreconciled',
        note: 'Earned payroll — wages accrued, protected immediately on work date.',
      },
      attribution: { employeeId: backupEmployeeId, projectId: null },
      label: `Payroll: ${backupEmployeeId} (${entry.workDate})`,
    })
  }

  // ── Step 2: Open session estimates ────────────────────────────────────────
  if (policy.includeOpenShiftEstimates) {
    for (const session of sessions) {
      if (session.organizationId !== orgId) continue
      try {
        parseCalendarDate(session.workDate)
      } catch {
        diagnostics.push({
          kind: 'invalid_work_date',
          employeeProfileId: session.employeeProfileId,
          sourceId: session.id,
          note: `employee_work_sessions.work_date is not a valid calendar date: ${session.workDate}`,
        })
        continue
      }
      if (session.workDate <= policy.paidThroughDate) continue
      if (session.workDate > policy.asOfDate) continue

      const dayKey = closedHandledKey(session.employeeProfileId, session.workDate)
      if (closedHandled.has(dayKey)) continue   // closed time_entry already covers this day
      if (rejectedDays.has(dayKey)) continue    // day was rejected, skip sessions too

      // Resolve identity (same chain as closed entries)
      if (!bridgeMap.has(session.employeeProfileId)) {
        diagnostics.push({
          kind: 'missing_employee_bridge',
          employeeProfileId: session.employeeProfileId,
          sourceId: session.id,
          note: `No ProfileIdentityBridge found for employeeProfileId ${session.employeeProfileId} (session)`,
        })
        continue
      }
      const backupEmployeeId = bridgeMap.get(session.employeeProfileId)
      if (!backupEmployeeId) {
        diagnostics.push({
          kind: 'missing_employee_bridge',
          employeeProfileId: session.employeeProfileId,
          sourceId: session.id,
          note: `backupEmployeeId is null for employeeProfileId ${session.employeeProfileId} (session)`,
        })
        continue
      }

      const emp = employeeMap.get(backupEmployeeId)
      if (!emp) {
        diagnostics.push({
          kind: 'missing_employee_record',
          employeeProfileId: session.employeeProfileId,
          sourceId: session.id,
          note: `No EmployeeRateInput found for backupEmployeeId ${backupEmployeeId} (session)`,
        })
        continue
      }

      const rateMinor = resolveCashWageMinor(emp, payrollMultiplier)
      if (rateMinor === null) {
        diagnostics.push({
          kind: 'missing_cash_wage',
          employeeProfileId: session.employeeProfileId,
          sourceId: session.id,
          note: `Cannot resolve base cash wage for backupEmployeeId ${backupEmployeeId} (session)`,
        })
        continue
      }

      let sessionPaidMinutes: number
      let sessionConfidence: 'confirmed' | 'expected'

      if (session.clockOutAt !== null) {
        // Closed session for an open day — use authoritative paid_minutes
        if (session.paidMinutes === null || !Number.isInteger(session.paidMinutes) || session.paidMinutes < 0) {
          diagnostics.push({
            kind: 'invalid_time_quantity',
            employeeProfileId: session.employeeProfileId,
            sourceId: session.id,
            note: `Closed session has invalid paid_minutes: ${session.paidMinutes}`,
          })
          continue
        }
        sessionPaidMinutes = session.paidMinutes
        sessionConfidence = 'confirmed'
      } else {
        // Open session — estimate from asOfTimestamp
        const estimate = estimateOpenSessionMinutes(session, asOfMs)
        if (estimate.diagnosticNote !== undefined) {
          diagnostics.push({
            kind: 'invalid_open_session_time',
            employeeProfileId: session.employeeProfileId,
            sourceId: session.id,
            note: estimate.diagnosticNote,
          })
          continue
        }
        sessionPaidMinutes = estimate.minutes
        sessionConfidence = 'expected'
      }

      const amountMinor = Math.round((sessionPaidMinutes * rateMinor) / 60)
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
        diagnostics.push({
          kind: 'invalid_time_quantity',
          employeeProfileId: session.employeeProfileId,
          sourceId: session.id,
          note: `Computed session amountMinor ${amountMinor} is invalid`,
        })
        continue
      }

      liabilities.push({
        organizationId: orgId,
        dueDate: session.workDate,
        amountMinor,
        requirement: 'required',
        provenance: {
          source: {
            organizationId: orgId,
            kind: 'employee_work_session',
            recordId: session.id,
            effectiveDate: session.workDate,
          },
          freshness: 'current',
          confidence: sessionConfidence,
          reconciliationState: 'unreconciled',
          note: session.clockOutAt === null
            ? 'Provisional open-session estimate. Replaced by time_entry once closed.'
            : 'Closed session on an open day. Authoritative session paid_minutes.',
        },
        attribution: {
          employeeId: backupEmployeeId,
          projectId: session.projectId ?? null,
        },
        label: `Payroll (session): ${backupEmployeeId} (${session.workDate})`,
      })
    }
  }

  // ── Step 3: Overlap diagnostic ─────────────────────────────────────────────
  // Surface when CASH-3 manual obligations/commitments carry employee-level
  // payroll attribution alongside derived payroll exposure.
  // Does NOT suppress either source — the caller reconciles.
  if (liabilities.length > 0) {
    for (const obl of manualObligations) {
      if (obl.organizationId !== orgId) continue
      const hasEmployeeAttr = obl.attribution?.employeeId != null
      const isPayrollCategory = classifyManualPayrollCategory(obl.category) === 'wages'
      if (hasEmployeeAttr || isPayrollCategory) {
        diagnostics.push({
          kind: 'potential_manual_payroll_overlap',
          sourceId: obl.id,
          note: `RecurringObligation ${obl.id} may overlap derived payroll exposure (${hasEmployeeAttr ? 'has employeeId attr' : 'category=payroll'}). Neither source is suppressed.`,
        })
      }
    }
    for (const comm of manualCommitments) {
      if (comm.organizationId !== orgId) continue
      const hasEmployeeId = comm.employeeId != null
      const isPayrollCategory = classifyManualPayrollCategory(comm.category) === 'wages'
      if (hasEmployeeId || isPayrollCategory) {
        diagnostics.push({
          kind: 'potential_manual_payroll_overlap',
          sourceId: comm.id,
          note: `CashCommitment ${comm.id} may overlap derived payroll exposure (${hasEmployeeId ? `employeeId=${comm.employeeId}` : 'category=payroll'}). Neither source is suppressed.`,
        })
      }
    }
  }

  return { liabilities, diagnostics }
}

// Re-export FinancialLiabilityInput for callers that only import from this module
export type { FinancialLiabilityInput }
