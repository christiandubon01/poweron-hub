import { usd, type FinanceAdapterScope, type FinancialAttribution, type FinancialProvenance } from '../domain'

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
