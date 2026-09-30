import { supabase } from '@/lib/supabase'
import { getActiveTenantUserId, getBackupData, isTenantDataReady, type BackupData } from './backupDataService'
import { resolveFinanceContext, readFinancialLedgerState, type FinanceContext } from './manualLedgerService'
import { readCashObligationState } from './cashObligationService'
import { readCashPages } from './cashReadPagination'
import type { FinancialAccountRow, FinancialTransactionRow } from '@/finance/ledgerTypes'
import type { CashCommitment, ObligationOccurrence, RecurringObligation } from '@/finance/obligationsTypes'
import type { ClosedTimeEntryInput, EmployeeRateInput, OpenSessionInput, ProfileIdentityBridge } from '@/finance/adapters/employeeFinanceAdapter'

export const CASH_OS_TIMEZONE = 'America/Los_Angeles'

export interface CashOsScope {
  context: FinanceContext
  /** Raw stored identity timezone. Null is not the legacy normalizer's LA fallback. */
  storedTimezone: string | null
}

export interface CashOsSourceBundle {
  organizationId: string
  asOfDate: string
  asOfTimestamp: string
  accounts: FinancialAccountRow[]
  transactions: FinancialTransactionRow[]
  obligations: RecurringObligation[]
  occurrences: ObligationOccurrence[]
  commitments: CashCommitment[]
  timeEntries: ClosedTimeEntryInput[]
  sessions: OpenSessionInput[]
  bridges: ProfileIdentityBridge[]
  employees: EmployeeRateInput[]
  payrollMultiplier?: number
  backup: BackupData
}

function from(table: string): any { return (supabase.from as any)(table) }

export async function resolveCashOsScope(): Promise<CashOsScope> {
  const context = await resolveFinanceContext()
  const { data, error } = await from('organizations').select('id,settings')
    .eq('id', context.organizationId).maybeSingle()
  if (error) throw new Error(`TIMEZONE_READ_FAILED: ${error.message}`)
  if (!data || data.id !== context.organizationId) throw new Error('TIMEZONE_READ_FAILED: Organization unavailable')
  const identity = data.settings?.identity
  const stored = identity && typeof identity === 'object' && !Array.isArray(identity)
    ? identity.timezone : null
  return { context, storedTimezone: typeof stored === 'string' && stored.trim() ? stored.trim() : null }
}

export function cashOsDateAt(now: Date, timezone: string): string {
  if (timezone !== CASH_OS_TIMEZONE) throw new Error('TIMEZONE_MISMATCH')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find(value => value.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** SELECT-only source capture. The caller supplies one instant for every engine.
 *  Pass payrollPaidThroughDate=null when session assumptions have not been confirmed;
 *  the payroll queries are skipped and the bundle returns empty arrays for those fields. */
export async function readCashOsSources(
  scope: CashOsScope,
  payrollPaidThroughDate: string | null,
  now: Date,
): Promise<CashOsSourceBundle> {
  const { userId, organizationId } = scope.context
  if (scope.storedTimezone && scope.storedTimezone !== CASH_OS_TIMEZONE) throw new Error('TIMEZONE_MISMATCH')
  if (!isTenantDataReady() || getActiveTenantUserId() !== userId) throw new Error('BACKUP_NOT_HYDRATED')
  const backup = getBackupData(userId)
  if (!backup) throw new Error('BACKUP_NOT_HYDRATED')
  const asOfDate = cashOsDateAt(now, CASH_OS_TIMEZONE)
  const asOfTimestamp = now.toISOString()
  const [ledger, obligations, entries, sessions, profiles] = await Promise.all([
    readFinancialLedgerState().catch(error => { throw new Error(`LEDGER_READ_FAILED: ${String(error)}`) }),
    readCashObligationState().catch(error => { throw new Error(`OBLIGATION_READ_FAILED: ${String(error)}`) }),
    payrollPaidThroughDate !== null
      ? readCashPages<any>('time_entries', q => q.select('id,org_id,employee_profile_id,work_date,paid_minutes,status,approval_status')
          .eq('org_id', organizationId).gt('work_date', payrollPaidThroughDate).lte('work_date', asOfDate), from)
          .catch(error => { throw new Error(`PAYROLL_READ_FAILED: ${String(error)}`) })
      : Promise.resolve([]),
    payrollPaidThroughDate !== null
      ? readCashPages<any>('employee_work_sessions', q => q.select('id,org_id,employee_profile_id,work_date,project_id,clock_in_at,lunch_out_at,lunch_in_at,clock_out_at,paid_minutes,status')
          .eq('org_id', organizationId).gt('work_date', payrollPaidThroughDate).lte('work_date', asOfDate), from)
          .catch(error => { throw new Error(`PAYROLL_READ_FAILED: ${String(error)}`) })
      : Promise.resolve([]),
    payrollPaidThroughDate !== null
      ? readCashPages<any>('employee_profiles', q => q.select('id,org_id,backup_employee_id')
          .eq('org_id', organizationId), from)
          .catch(error => { throw new Error(`PAYROLL_READ_FAILED: ${String(error)}`) })
      : Promise.resolve([]),
  ])
  if (ledger.context.organizationId !== organizationId || ledger.context.userId !== userId
    || obligations.obligations.some(row => row.organizationId !== organizationId)
    || obligations.occurrences.some(row => row.organizationId !== organizationId)
    || obligations.commitments.some(row => row.organizationId !== organizationId)
    || [...entries, ...sessions, ...profiles].some(row => row.org_id !== organizationId)
    || getActiveTenantUserId() !== userId || !isTenantDataReady()) throw new Error('CASH_OS_SCOPE_CHANGED')
  const employeeRows = Array.isArray(backup.employees) ? backup.employees : []
  const multiplier = backup.settings?.payrollMult
  return {
    organizationId, asOfDate, asOfTimestamp, backup,
    accounts: ledger.accounts, transactions: ledger.transactions,
    obligations: obligations.obligations, occurrences: obligations.occurrences, commitments: obligations.commitments,
    timeEntries: entries.map(row => ({ id: row.id, organizationId: row.org_id,
      employeeProfileId: row.employee_profile_id, workDate: row.work_date,
      paidMinutes: row.paid_minutes, status: row.status, approvalStatus: row.approval_status })),
    sessions: sessions.map(row => ({ id: row.id, organizationId: row.org_id,
      employeeProfileId: row.employee_profile_id, workDate: row.work_date,
      clockInAt: row.clock_in_at, lunchOutAt: row.lunch_out_at, lunchInAt: row.lunch_in_at,
      clockOutAt: row.clock_out_at, paidMinutes: row.paid_minutes, projectId: row.project_id })),
    bridges: profiles.map(row => ({ employeeProfileId: row.id, backupEmployeeId: row.backup_employee_id })),
    employees: employeeRows.map(row => ({ backupEmployeeId: row.id,
      hourly_rate: (row as any).hourly_rate, costRate: row.costRate,
      classification: (row as any).classification, employee_type: (row as any).employee_type,
      isOwner: (row as any).isOwner })),
    ...(typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier >= 1
      ? { payrollMultiplier: multiplier } : {}),
  }
}
