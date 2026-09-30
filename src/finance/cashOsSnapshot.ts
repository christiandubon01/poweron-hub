import { buildPayrollExposure, type PayrollExposureResult } from './adapters/employeeFinanceAdapter'
import { readClockProjects, readProjectCollectionEvidence } from './adapters/projectFinanceAdapter'
import { computeCashAllocation } from './allocationEngine'
import { computeProjectCollectionClock, allocatePayrollLiabilityToProjects } from './projectCollectionClock'
import { computeCashProjection } from './cashProjection'
import { accountBalanceMinor } from './ledgerCalculations'
import type { CashAllocationSnapshot } from './allocationTypes'
import type { CashProjectionConfidenceMode, CashProjectionHorizon, CashProjectionResult } from './cashProjectionTypes'
import type { ProjectCollectionClockResult, PayrollProjectAllocation, PayrollAttributionSession } from './projectCollectionClockTypes'
import type { CashOsSourceBundle } from '@/services/cashOsReadService'
import type { CashOsSessionSetup } from '@/services/cashOsSessionSetup'

export interface CashOsSnapshot extends CashOsSourceBundle {
  setup: CashOsSessionSetup
  allocation: CashAllocationSnapshot
  payroll: PayrollExposureResult
  payrollDiagnostics: PayrollExposureResult['diagnostics']
  payrollAllocations: PayrollProjectAllocation[]
  payrollExposureMinor: number
  accountBalancesMinor: Record<string, number>
  collectionClock: ProjectCollectionClockResult
  projection: CashProjectionResult
  readinessDiagnostics: string[]
}

export function buildCashOsSnapshot(input: CashOsSourceBundle & {
  setup: CashOsSessionSetup
  horizonDays: CashProjectionHorizon
  confidenceMode: CashProjectionConfidenceMode
}): CashOsSnapshot {
  const { organizationId, asOfDate, asOfTimestamp, setup } = input
  if (setup.organizationId !== organizationId) throw new Error('Cash OS setup organization mismatch')
  const allocationPolicy = {
    organizationId, asOfDate,
    protectionHorizonDays: setup.protectionHorizonDays,
    operatingFloorMinor: setup.operatingFloorMinor,
    taxReserve: setup.taxReserve,
    includeOptionalObligations: setup.includeOptionalObligations,
  }
  const payroll = buildPayrollExposure({ organizationId, asOfDate, asOfTimestamp,
    paidThroughDate: setup.payrollPaidThroughDate,
    includeOpenShiftEstimates: setup.includeOpenShiftEstimates,
  }, input.timeEntries, input.sessions, input.bridges, input.employees,
  input.obligations, input.commitments, input.payrollMultiplier)
  const scope = { organizationId, asOfDate }
  const projects = readClockProjects(scope, input.backup)
  const collectionEvidence = readProjectCollectionEvidence(scope, input.backup)
  const allocation = computeCashAllocation(input.accounts, input.transactions,
    input.obligations, input.occurrences, input.commitments, allocationPolicy, payroll.liabilities)

  const entryById = new Map(input.timeEntries.map(entry => [entry.id, entry]))
  const sessionsByDay = new Map<string, PayrollAttributionSession[]>()
  for (const session of input.sessions) {
    const key = `${session.employeeProfileId}:${session.workDate}`
    const list = sessionsByDay.get(key) ?? []
    list.push({ id: session.id, employeeProfileId: session.employeeProfileId,
      workDate: session.workDate, paidMinutes: session.paidMinutes, projectId: session.projectId })
    sessionsByDay.set(key, list)
  }
  const payrollAllocations: PayrollProjectAllocation[] = []
  for (const liability of payroll.liabilities) {
    if (liability.provenance.source.kind !== 'employee_time_entry') continue
    const entry = entryById.get(liability.provenance.source.recordId)
    if (!entry) throw new Error('Finalized payroll source entry missing')
    const key = `${entry.employeeProfileId}:${entry.workDate}`
    payrollAllocations.push(allocatePayrollLiabilityToProjects(liability,
      entry.employeeProfileId, entry.workDate, entry.paidMinutes ?? -1,
      sessionsByDay.get(key) ?? [], true))
  }
  const collectionClock = computeProjectCollectionClock({ organizationId, asOfDate,
    projects, collectionEvidence, commitments: input.commitments,
    obligations: input.obligations, occurrences: input.occurrences,
    payrollLiabilities: payroll.liabilities, payrollAllocations, allocationSnapshot: allocation })
  const projection = computeCashProjection({
    policy: { organizationId, asOfDate, horizonDays: input.horizonDays,
      confidenceMode: input.confidenceMode, cashAllocationPolicy: allocationPolicy },
    allocationSnapshot: allocation,
    accounts: input.accounts, transactions: input.transactions,
    obligations: input.obligations, occurrences: input.occurrences, commitments: input.commitments,
    derivedLiabilities: payroll.liabilities, projects, collectionEvidence, collectionClock,
  })
  const payrollExposureMinor = payroll.liabilities.reduce((sum, row) => sum + row.amountMinor, 0)
  const accountBalancesMinor = Object.fromEntries(input.accounts.map(account => [account.id,
    accountBalanceMinor(account.id, input.transactions, asOfDate)]))
  return { ...input, allocation, payroll, payrollDiagnostics: payroll.diagnostics,
    payrollAllocations, payrollExposureMinor, accountBalancesMinor, collectionClock, projection,
    readinessDiagnostics: [
      ...payroll.diagnostics.map(d => `${d.kind}:${d.sourceId ?? d.employeeProfileId ?? ''}`),
      ...collectionClock.diagnostics, ...projection.diagnostics,
    ] }
}
