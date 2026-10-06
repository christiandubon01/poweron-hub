import { describe, expect, it, vi } from 'vitest'

// Any call into the database client during derivation would be a (hidden) read or write. There must be none.
const dbCalls = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/lib/supabase', () => ({
  supabase: new Proxy({}, { get: () => { dbCalls.count++; return () => { dbCalls.count++ } } }),
}))

import { buildCashOsSnapshot, type CashOsSnapshot } from '../cashOsSnapshot'
import { buildOwnerDecisionView, deriveCanonicalDecisionFacts } from '../decisionLayer'
import { classifyManualPayrollCategory } from '../adapters/employeeFinanceAdapter'
import { financialReconciliationKey } from '../domain'
import type { CashOsSourceBundle } from '@/services/cashOsReadService'
import type { CashOsSessionSetup } from '@/services/cashOsSessionSetup'
import type { FinancialAccountRow, FinancialTransactionRow } from '../ledgerTypes'
import type { CashCommitment, RecurringObligation } from '../obligationsTypes'
import type { LiabilityTermsRow } from '../liabilityTermsTypes'
import type { CashProjectFactsRow } from '../cashProjectFacts'
import type { BackupData } from '@/services/backupDataService'

const ORG = 'org-1'
const DAY = '2026-10-05'

const account = (id: string, over: Partial<FinancialAccountRow> = {}): FinancialAccountRow => ({ id, organization_id: ORG,
  display_name: id, account_type: 'checking', account_class: 'asset', ownership_context: 'business', include_in_cash: true,
  currency: 'USD', status: 'active', source_type: 'manual', source_metadata: {}, created_at: '', updated_at: '', archived_at: null, ...over })
const tx = (id: string, accountId: string, amount: number): FinancialTransactionRow => ({ id, organization_id: ORG, account_id: accountId,
  amount_minor: amount, currency: 'USD', transaction_date: DAY, effective_at: null, posted_at: null, status: 'posted',
  transaction_kind: 'opening_balance', economic_effect: 'none', economic_amount_minor: 0, description: id, counterparty: null,
  category: null, project_id: null, employee_id: null, debt_account_id: null, source_type: 'opening_balance', source_organization_id: null,
  source_kind: null, source_record_id: null, source_effective_date: null, source_timestamp: null, source_metadata: {},
  idempotency_key: id, created_at: '', updated_at: '', voided_at: null, voided_by: null, void_reason: null })
const commitment = (id: string, date: string, amount: number, over: Partial<CashCommitment> = {}): CashCommitment => ({
  id, organizationId: ORG, title: id, expectedDate: date, amount: { currency: 'USD', minor: amount }, amountCertainty: 'fixed',
  requirement: 'required', confidence: 'confirmed', status: 'scheduled', sourceType: 'manual', reconciliationState: 'unreconciled',
  provenance: { source: { organizationId: ORG, kind: 'cash_commitment', recordId: id }, freshness: 'current', confidence: 'confirmed',
    reconciliationState: 'unreconciled' }, ...over })
const obligation = (id: string, over: Partial<RecurringObligation> = {}): RecurringObligation => ({ id, organizationId: ORG, name: id,
  amount: { currency: 'USD', minor: 50000 }, amountCertainty: 'fixed', requirement: 'required', confidence: 'confirmed', status: 'active',
  sourceType: 'manual', recurrence: { kind: 'monthly', interval: 1, anchorDate: '2026-10-08', startDate: '2026-10-08' },
  provenance: { source: { organizationId: ORG, kind: 'financial_obligation', recordId: id }, freshness: 'current', confidence: 'confirmed',
    reconciliationState: 'unreconciled' }, ...over })
const terms = (over: Partial<LiabilityTermsRow> = {}): LiabilityTermsRow => ({ id: 't1', organization_id: ORG, account_id: 'care',
  debt_structure: 'revolving', apr_basis_points: 3299, promo_apr_basis_points: 0, promo_type: 'deferred_interest', promo_started_on: null,
  promo_expires_on: '2026-12-22', minimum_payment_minor: 11300, payment_due_day: null, next_due_date: null, scheduled_payment_minor: null,
  original_principal_minor: null, maturity_date: null, owner_notes: null, created_at: '', updated_at: '', ...over })
const factsRow = (projectId: string, over: Partial<CashProjectFactsRow> = {}): CashProjectFactsRow => ({ id: `f-${projectId}`,
  organization_id: ORG, project_id: projectId, billing_type: null, readiness: null, completion_requirement: null, blocked_reason: null,
  needs_spend: null, work_hours_remaining: null, expected_collection_date: null, collection_confidence: null, next_action: null,
  created_at: '', updated_at: '', ...over })

const project = (id: string, name: string, status: string, contract: number, extra: Record<string, unknown> = {}) =>
  ({ id, name, type: 'project', status, contract, billed: 0, paid: 0, phase_timeline: [], ...extra })
const log = (id: string, projId: string, collected: number) => ({ id, projId, date: '2026-09-01', collected, hrs: 0, mat: 0 })
const portfolio = () => ({
  projects: [project('dw', 'Desert Willow', 'active', 3000), project('mh', 'Mobile Home', 'active', 8000),
    project('ss', 'Surgery Center', 'active', 0), project('p400', '400A Panel Upgrade', 'coming', 5000),
    project('bs', 'Beauty Salon', 'completed', 4000)],
  logs: [log('l1', 'dw', 2050), log('l2', 'mh', 4500), log('l3', 'bs', 4000)],
})
const setup = (floor = 5000): CashOsSessionSetup => ({ version: 1, organizationId: ORG, payrollPaidThroughDate: '2026-10-04',
  protectionHorizonDays: 14, operatingFloorMinor: floor, taxReserve: { kind: 'disabled' }, includeOptionalObligations: false,
  includeOpenShiftEstimates: false, timezoneConfirmed: true, confirmedAt: '2026-10-05T20:00:00Z' })

function snap(o: {
  cash?: number; floor?: number; port?: { projects: any[]; logs: any[] }; facts?: CashProjectFactsRow[]
  commitments?: CashCommitment[]; obligations?: RecurringObligation[]; terms?: LiabilityTermsRow[]; extraAccounts?: FinancialAccountRow[]
  timeEntries?: any[]; bridges?: any[]; employees?: any[]
} = {}): CashOsSnapshot {
  const p = o.port ?? portfolio()
  const bundle: CashOsSourceBundle = { organizationId: ORG, asOfDate: DAY, asOfTimestamp: '2026-10-05T20:00:00Z',
    accounts: [account('bank'), account('care', { display_name: 'CareCredit', account_type: 'credit_card', account_class: 'liability', include_in_cash: false }), ...(o.extraAccounts ?? [])],
    transactions: [tx('open', 'bank', o.cash ?? 15000), tx('care-open', 'care', 341905)],
    obligations: o.obligations ?? [], occurrences: [], commitments: o.commitments ?? [], timeEntries: o.timeEntries ?? [], sessions: [],
    bridges: o.bridges ?? [], employees: o.employees ?? [], liabilityTerms: o.terms ?? [terms()], projectFacts: o.facts ?? [],
    backup: { projects: p.projects, logs: p.logs, settings: {}, employees: [] } as unknown as BackupData }
  return buildCashOsSnapshot({ ...bundle, setup: setup(o.floor), horizonDays: 30, confidenceMode: 'conservative' })
}
const ids = (v: ReturnType<typeof buildOwnerDecisionView>) => v.actions.map(a => a.id)
const truckKey = financialReconciliationKey({ organizationId: ORG, kind: 'cash_commitment', recordId: 'truck' })

describe('Desert Willow: a stored requirement explains why $950 is unlockable', () => {
  const dw = factsRow('dw', { billing_type: 'fixed', readiness: 'work_required', needs_spend: false, work_hours_remaining: 4,
    completion_requirement: 'Install remaining lights and receptacles', expected_collection_date: '2026-10-12', collection_confidence: 'high' })
  it('keeps the canonical $950 remaining, UNLOCKABLE, and not cash', () => {
    const view = buildOwnerDecisionView(snap({ facts: [dw] }))
    const item = view.moneyStates.unlockable.find(i => i.projectId === 'dw')!
    expect(item.amountMinor).toBe(95000)
    expect(item.basis).toContain('Install remaining lights and receptacles')
    expect(view.moneyStates.collectible.map(i => i.projectId)).not.toContain('dw')
    expect(view.today.availableMinor).toBe(15000)
  })
  it('turns the requirement into a ranked, recommended unlock path', () => {
    const view = buildOwnerDecisionView(snap({ facts: [dw] }))
    const action = view.actions.find(a => a.id === 'unlock:dw:unlockable')!
    expect(action.category).toBe('owner_work')
    expect(action.certainty).toBe('recommended')
    expect(action.title).toContain('finish the work')
    expect(action.why.join(' ')).toContain('Install remaining lights and receptacles')
    expect(action.resource.cashMinor).toBe(0)
    expect(action.timing.date).toBe('2026-10-12')
  })
  it('with only the requirement, it still says why, and lists exactly what is still missing', () => {
    const partial = factsRow('dw', { completion_requirement: 'Install remaining lights and receptacles' })
    const action = buildOwnerDecisionView(snap({ facts: [partial] })).actions.find(a => a.id === 'verify-unlock:dw:unlockable')!
    expect(action.title).toBe('Desert Willow: Install remaining lights and receptacles to unlock $950.00')
    expect(action.certainty).toBe('needs_verification')
    expect(action.missing).toEqual(expect.arrayContaining(['expected collection date', 'how confident the collection is']))
    expect(action.missing).not.toContain('what must be finished before it can be collected')
  })
})

describe('Mobile Home: project-linked required cash is understood without becoming revenue', () => {
  const mh = factsRow('mh', { billing_type: 'fixed', needs_spend: true, completion_requirement: 'Finish past rough-in' })
  const materials = commitment('mh-materials', '2026-10-12', 180000, { title: 'Materials', projectId: 'mh', category: 'Materials' })
  it('reads the cash required from the commitments tied to the job, not from a typed number', () => {
    const facts = deriveCanonicalDecisionFacts(snap({ facts: [mh], commitments: [materials] }))
    expect(facts.projects!.mh.cashRequiredMinor).toBe(180000)
    const moreSpend = commitment('mh-permit', '2026-10-13', 20000, { projectId: 'mh' })
    expect(deriveCanonicalDecisionFacts(snap({ facts: [mh], commitments: [materials, moreSpend] })).projects!.mh.cashRequiredMinor).toBe(200000)
  })
  it('only counts required, scheduled, unreconciled spend for that job', () => {
    const noise = [commitment('other-job', '2026-10-12', 99900, { projectId: 'dw' }), commitment('optional', '2026-10-12', 77700, { projectId: 'mh', requirement: 'optional' }),
      commitment('done', '2026-10-12', 55500, { projectId: 'mh', status: 'satisfied', reconciliationState: 'reconciled' })]
    expect(deriveCanonicalDecisionFacts(snap({ facts: [mh], commitments: [materials, ...noise] })).projects!.mh.cashRequiredMinor).toBe(180000)
  })
  it('shows a cash-required unlock for $3,500 while the balance is unchanged and never called profit', () => {
    const view = buildOwnerDecisionView(snap({ facts: [mh], commitments: [materials] }))
    const item = view.moneyStates.unlockable.find(i => i.projectId === 'mh')!
    expect(item.amountMinor).toBe(350000)
    const action = view.actions.find(a => a.id === 'verify-unlock:mh:unlockable')!
    expect(action.category).toBe('cash_required')
    expect(action.resource.cashMinor).toBe(180000)
    expect(JSON.stringify(view)).not.toMatch(/(?<!not )profit/i)
    expect(view.moneyStates.collectible.map(i => i.projectId)).not.toContain('mh')
    expect(view.moneyStates.totals.unlockable.knownMinor).toBe(95000 + 350000) // Desert Willow (no facts here) and Mobile Home are both still unlockable
  })
  it('the spend is a protected cost, not an inflow or receivable', () => {
    const s = snap({ facts: [mh], commitments: [materials] })
    const view = buildOwnerDecisionView(s)
    expect(s.allocation.allocationResult.requirements.some(r => r.sourceRecordId === 'mh-materials')).toBe(true)
    expect(view.next7Days.movements.filter(m => m.direction === 'inflow')).toEqual([])
    expect(view.today.availableMinor).toBe(15000)
  })
  it('"no spend needed" is a stated fact, but real linked spend wins over a stale "no"', () => {
    const none = factsRow('dw', { needs_spend: false })
    expect(deriveCanonicalDecisionFacts(snap({ facts: [none] })).projects!.dw.cashRequiredMinor).toBe(0)
    const contradicted = commitment('dw-wire', '2026-10-12', 5000, { projectId: 'dw' })
    expect(deriveCanonicalDecisionFacts(snap({ facts: [none], commitments: [contradicted] })).projects!.dw.cashRequiredMinor).toBe(5000)
    expect(deriveCanonicalDecisionFacts(snap({ facts: [factsRow('dw')] })).projects!.dw.cashRequiredMinor).toBeUndefined()
  })
})

describe('Surgery Center and billing type', () => {
  const blocked = factsRow('ss', { billing_type: 'time_and_material', blocked_reason: 'Waiting on other trades.' })
  it('T&M + blocked: nothing is receivable, the reason is shown', () => {
    const view = buildOwnerDecisionView(snap({ facts: [blocked] }))
    const item = view.moneyStates.blocked.find(i => i.projectId === 'ss')!
    expect(item.amountMinor).toBeNull()
    expect(item.basis).toContain('Waiting on other trades.')
    const waiting = view.actions.find(a => a.category === 'waiting')!
    expect(waiting.title).toContain('Waiting on other trades.')
    expect(view.moneyStates.collectible.concat(view.moneyStates.unlockable).map(i => i.projectId)).not.toContain('ss')
    expect(view.moneyStates.totals.blocked.knownMinor).toBe(0)
  })
  it('T&M future work is never a receivable, even when a contract amount is on the project', () => {
    const port = { projects: [project('tm', 'T&M Job', 'active', 9000)], logs: [] }
    const view = buildOwnerDecisionView(snap({ port, facts: [factsRow('tm', { billing_type: 'time_and_material', readiness: 'work_required', completion_requirement: 'More work' })] }))
    expect(view.moneyStates.unlockable).toEqual([])
    expect(view.moneyStates.collectible).toEqual([])
    expect(view.moneyStates.notCounted[0].reason).toContain('Nothing future is counted')
  })
  it('T&M: only what was actually billed and unpaid becomes collectible', () => {
    const port = { projects: [project('tm', 'T&M Job', 'active', 9000, { billed: 1200 })], logs: [log('p', 'tm', 500)] }
    const view = buildOwnerDecisionView(snap({ port, facts: [factsRow('tm', { billing_type: 'time_and_material' })] }))
    expect(view.moneyStates.collectible.map(i => i.amountMinor)).toEqual([70000])
    expect(view.moneyStates.unlockable).toEqual([])
  })
  it('without the owner fact, a job with no fixed amount is not claimed blocked', () => {
    const view = buildOwnerDecisionView(snap())
    expect(view.moneyStates.blocked).toEqual([])
    expect(view.moneyStates.notCounted.some(i => i.projectId === 'ss')).toBe(true)
  })
  it('billing type is stored per project and fixed price keeps its remaining balance', () => {
    const facts = deriveCanonicalDecisionFacts(snap({ facts: [factsRow('dw', { billing_type: 'fixed' }), blocked] }))
    expect(facts.projects!.dw.billingType).toBe('fixed')
    expect(facts.projects!.ss.billingType).toBe('time_and_material')
    expect(facts.projects!.ss.readiness).toBe('blocked')
    expect(facts.projects!.ss.blocker).toBe('Waiting on other trades.')
  })
})

describe('estimates and finished work stay out of the decision layer', () => {
  it('400A Panel stays POTENTIAL even when the owner records a follow-up and expected collection', () => {
    const row = factsRow('p400', { next_action: 'Call customer Friday', expected_collection_date: '2026-10-30', collection_confidence: 'high' })
    const view = buildOwnerDecisionView(snap({ facts: [row] }))
    expect(view.moneyStates.potential.map(i => i.projectId)).toContain('p400')
    expect(view.moneyStates.collectible.concat(view.moneyStates.unlockable).map(i => i.projectId)).not.toContain('p400')
    expect(ids(view).some(id => id.startsWith('unlock:p400') || id.startsWith('collect:p400'))).toBe(false)
  })
  it('Beauty Salon (complete, fully paid) needs no action even if a stale facts row exists', () => {
    const view = buildOwnerDecisionView(snap({ facts: [factsRow('bs', { readiness: 'ready_to_bill', next_action: 'Send invoice' })] }))
    expect(view.moneyStates.settledProjectCount).toBe(1)
    expect(view.actions.some(a => a.related.projectId === 'bs')).toBe(false)
    expect(JSON.stringify(view)).not.toContain('Beauty Salon')
  })
  it('"ready to bill" is the owner\'s explicit statement and the only way unbilled balance becomes collectible', () => {
    const view = buildOwnerDecisionView(snap({ facts: [factsRow('dw', { readiness: 'ready_to_bill' })] }))
    const item = view.moneyStates.collectible.find(i => i.projectId === 'dw')!
    expect(item.ownerConfirmed).toBe(true)
    expect(item.amountMinor).toBe(95000)
    expect(view.today.availableMinor).toBe(15000)
  })
})

describe('debt facts stay separate: normal payment, past due, catch-up, balance', () => {
  const careTerms = terms({ minimum_payment_minor: 11300, past_due_minor: 32900, catch_up_minor: 44200, consequence_note: 'Late fee and account flag' })
  it('maps each concept to its own field without merging them', () => {
    const s = snap({ terms: [careTerms] })
    const care = deriveCanonicalDecisionFacts(s).debts!.care
    expect(care).toMatchObject({ minimumDueMinor: 11300, pastDueMinor: 32900, catchUpMinor: 44200, consequence: 'Late fee and account flag' })
    expect(s.accountBalancesMinor.care).toBe(341905)
    expect(new Set([care.minimumDueMinor, care.pastDueMinor, care.catchUpMinor, s.accountBalancesMinor.care]).size).toBe(4)
  })
  it('makes no debt fact up when the owner stated none', () => {
    expect(deriveCanonicalDecisionFacts(snap({ terms: [terms()] })).debts).toBeUndefined()
  })
  it('Rule 4 with stored facts: full catch-up when affordable', () => {
    const view = buildOwnerDecisionView(snap({ cash: 100000, terms: [careTerms] }))
    expect(view.actions.find(a => a.id === 'cure:care')!.amount.minor).toBe(44200)
  })
  it('Rule 4 with stored facts: a partial only when it meets the stated requirement and a consequence is stored', () => {
    const view = buildOwnerDecisionView(snap({ cash: 30000, terms: [careTerms] }))
    const partial = view.actions.find(a => a.id === 'partial:care')!
    expect(partial.amount.minor).toBe(11300)
    expect(partial.why.join(' ')).toContain('Late fee and account flag')
    expect(partial.why.join(' ')).toContain('$442.00')
    const noConsequence = buildOwnerDecisionView(snap({ cash: 30000, terms: [terms({ catch_up_minor: 44200 })] }))
    expect(ids(noConsequence)).toContain('hold:care')
    expect(ids(noConsequence)).not.toContain('partial:care')
  })
  it('the promo risk and the stored catch-up appear together without inventing either', () => {
    const view = buildOwnerDecisionView(snap({ terms: [careTerms] }))
    expect(view.risks.some(r => r.kind === 'promo_deadline')).toBe(true)
    expect(view.dataGaps.join(' ')).not.toContain('Past-due and catch-up amounts are not stored')
  })
})

describe('operational criticality comes from the owner fact, never from a word', () => {
  it('a stored critical commitment activates protect-first with the owner\'s reason', () => {
    const truck = commitment('truck', '2026-10-10', 56000, { category: 'vehicle', operationallyCritical: true,
      criticalReason: 'Primary work vehicle; needed for jobs, estimates, materials and collections' })
    const first = buildOwnerDecisionView(snap({ commitments: [truck] })).actions.find(a => a.id === `protect-first:${truckKey}`)!
    expect(first.certainty).toBe('recommended')
    expect(first.why.join(' ')).toContain('Primary work vehicle')
    expect(first.rules).toContain(1)
  })
  it('a recurring obligation flagged critical protects every one of its occurrences', () => {
    const loan = obligation('truck-loan', { name: 'Truck loan', category: 'Vehicle', operationallyCritical: true, criticalReason: 'Work truck' })
    const view = buildOwnerDecisionView(snap({ obligations: [loan] }))
    expect(view.actions.some(a => a.id.startsWith('protect-first:') && a.title.includes('Truck loan'))).toBe(true)
  })
  it('a debt marked critical makes the payments linked to it critical', () => {
    const loanAccount = account('truck-acct', { display_name: 'Truck Loan', account_type: 'loan', account_class: 'liability', include_in_cash: false })
    const pay = commitment('truck-pay', '2026-10-10', 56000, { debtAccountId: 'truck-acct' })
    const view = buildOwnerDecisionView(snap({ extraAccounts: [loanAccount], commitments: [pay],
      terms: [terms(), terms({ id: 't2', account_id: 'truck-acct', operationally_critical: true, critical_reason: 'Work truck' })] }))
    expect(view.actions.some(a => a.id.startsWith('protect-first:') && a.why.join(' ').includes('Work truck'))).toBe(true)
  })
  it('a vehicle payment WITHOUT the owner fact is not critical, whatever it is called', () => {
    const loanAccount = account('truck-acct', { display_name: 'Work Truck Loan', account_type: 'loan', account_class: 'liability', include_in_cash: false })
    const pay = commitment('truck', '2026-10-10', 56000, { title: 'Work truck payment', category: 'vehicle', debtAccountId: 'truck-acct' })
    const view = buildOwnerDecisionView(snap({ extraAccounts: [loanAccount], commitments: [pay], terms: [terms(), terms({ id: 't2', account_id: 'truck-acct' })] }))
    expect(ids(view).some(id => id.startsWith('protect-first'))).toBe(false)
    expect(view.actions.every(a => a.certainty !== 'recommended' || !a.rules.includes(1))).toBe(true)
  })
  it('an owner-uncategorized vehicle item is flagged "check first", never promoted', () => {
    const pay = commitment('truck', '2026-10-10', 56000, { category: 'vehicle' })
    const view = buildOwnerDecisionView(snap({ commitments: [pay] }))
    expect(ids(view).some(id => id.startsWith('protect-first'))).toBe(false)
    const hint = view.actions.find(a => a.id === `criticality-unknown:${truckKey}`)!
    expect(hint.certainty).toBe('needs_verification')
    expect(hint.missing).toContain('operational criticality')
  })
  it('an explicit "not critical" (false) is the same as not stated', () => {
    const pay = commitment('truck', '2026-10-10', 56000, { category: 'vehicle', operationallyCritical: false })
    expect(ids(buildOwnerDecisionView(snap({ commitments: [pay] }))).some(id => id.startsWith('protect-first'))).toBe(false)
  })
  it('Rule 3 runs entirely from stored facts: spend on a credible unlock to fund a critical payment', () => {
    const truck = commitment('truck', '2026-10-10', 56000, { category: 'vehicle', operationallyCritical: true })
    const wire = commitment('dw-wire', '2026-10-06', 5000, { projectId: 'dw', title: 'Wire and devices' })
    const dw = factsRow('dw', { readiness: 'work_required', completion_requirement: 'Install lights and receptacles', needs_spend: true,
      work_hours_remaining: 6, expected_collection_date: '2026-10-08', collection_confidence: 'high' })
    const view = buildOwnerDecisionView(snap({ commitments: [truck, wire], facts: [dw] }))
    const plan = view.actions.find(a => a.id.startsWith('fund-via-unlock:'))!
    expect(plan.certainty).toBe('recommended')
    expect(plan.resource.cashMinor).toBe(5000)
    expect(plan.rules).toEqual(expect.arrayContaining([1, 2, 3, 5]))
  })
})

describe('payroll service fee is not employee wages', () => {
  it('classifies the category explicitly', () => {
    for (const wages of ['Payroll', 'payroll', ' PAYROLL ', 'Payroll.']) expect(classifyManualPayrollCategory(wages)).toBe('wages')
    for (const service of ['Payroll service fee', 'payroll service', 'Payroll fees', 'ADP payroll processing', 'Payroll agency', 'Payroll software subscription', 'payroll_service_fee']) {
      expect(classifyManualPayrollCategory(service)).toBe('service')
    }
    for (const other of ['Rent', 'Vehicle', 'Insurance', '', null, undefined, 'Payroll taxes']) expect(classifyManualPayrollCategory(other as any)).toBe('none')
  })

  const wageInputs = {
    timeEntries: [{ id: 'te1', organizationId: ORG, employeeProfileId: 'p1', workDate: '2026-10-05', paidMinutes: 480, status: 'complete', approvalStatus: 'none' }],
    bridges: [{ employeeProfileId: 'p1', backupEmployeeId: 'emp1' }], employees: [{ backupEmployeeId: 'emp1', hourly_rate: 25 }],
  }
  const fee = (category: string) => obligation('agency-fee', { name: 'Payroll agency fee', category,
    amount: { currency: 'USD', minor: 16495 }, recurrence: { kind: 'monthly', interval: 1, anchorDate: '2026-10-20', startDate: '2026-10-20' } })

  it('a $164.95 payroll-service fee next to real wages does NOT raise the overlap diagnostic', () => {
    const s = snap({ ...wageInputs, obligations: [fee('Payroll service fee')] })
    expect(s.payroll.liabilities.length).toBeGreaterThan(0)
    expect(s.payrollDiagnostics.some(d => d.kind === 'potential_manual_payroll_overlap')).toBe(false)
    expect(s.payrollDiagnostics).toEqual([])
  })
  it('both facts still count exactly once: wages as derived payroll, the fee as an operating expense', () => {
    const s = snap({ ...wageInputs, obligations: [fee('Payroll service fee')], floor: 0 })
    expect(s.payrollExposureMinor).toBe(20000)
    const reqs = s.allocation.allocationResult.requirements
    expect(reqs.filter(r => r.bucket === 'payroll')).toHaveLength(1)
    expect(reqs.filter(r => r.sourceType === 'obligation_occurrence' && r.label === 'Payroll agency fee').length).toBeLessThanOrEqual(1)
  })
  it('genuine manual wage duplication is still detected (category "payroll")', () => {
    for (const category of ['payroll', 'Payroll']) {
      const s = snap({ ...wageInputs, obligations: [fee(category)] })
      expect(s.payrollDiagnostics.some(d => d.kind === 'potential_manual_payroll_overlap'), category).toBe(true)
    }
    const manualWages = commitment('wages', '2026-10-07', 20000, { category: 'Payroll' })
    expect(snap({ ...wageInputs, commitments: [manualWages] }).payrollDiagnostics.some(d => d.kind === 'potential_manual_payroll_overlap')).toBe(true)
  })
  it('anything attributed to an employee is still wages, whatever its category says', () => {
    const attributed = commitment('emp-pay', '2026-10-07', 20000, { category: 'Payroll service fee', employeeId: 'emp1' })
    expect(snap({ ...wageInputs, commitments: [attributed] }).payrollDiagnostics.some(d => d.kind === 'potential_manual_payroll_overlap')).toBe(true)
  })
  it('the decision layer no longer withholds cash for the service-fee case', () => {
    const s = snap({ ...wageInputs, obligations: [fee('Payroll service fee')] })
    const view = buildOwnerDecisionView(s, { partial: false })
    expect(view.status).toBe('ready')
    expect(view.risks.some(r => r.id === 'payroll-data')).toBe(false)
  })
})

describe('invariants', () => {
  const fullFacts = () => [
    factsRow('dw', { readiness: 'work_required', completion_requirement: 'Install lights', needs_spend: true, work_hours_remaining: 4,
      expected_collection_date: '2026-10-12', collection_confidence: 'high' }),
    factsRow('mh', { needs_spend: true }), factsRow('ss', { billing_type: 'time_and_material', blocked_reason: 'Waiting on other trades' }),
    factsRow('p400', { next_action: 'Follow up' })]
  it('no unlockable, potential or blocked amount ever enters available cash', () => {
    const withFacts = buildOwnerDecisionView(snap({ facts: fullFacts(), commitments: [commitment('m', '2026-10-12', 180000, { projectId: 'mh' })] }))
    const without = buildOwnerDecisionView(snap({ port: { projects: [], logs: [] } }))
    expect(withFacts.today.availableMinor).toBe(15000)
    expect(withFacts.moneyStates.availableMinor).toBe(15000)
    expect(without.today.availableMinor).toBe(15000)
    expect(withFacts.moneyStates.unlockable.length + withFacts.moneyStates.potential.length + withFacts.moneyStates.blocked.length).toBeGreaterThan(0)
  })
  it('derivation is pure: a deeply frozen snapshot is untouched and the database is never called', () => {
    const s = snap({ facts: fullFacts(), commitments: [commitment('m', '2026-10-12', 180000, { projectId: 'mh' })], terms: [terms({ catch_up_minor: 44200 })] })
    const before = JSON.stringify(s)
    const freeze = (v: any) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.keys(v).forEach(k => freeze(v[k])) } return v }
    freeze(s)
    dbCalls.count = 0
    expect(() => buildOwnerDecisionView(s)).not.toThrow()
    expect(JSON.stringify(s)).toBe(before)
    expect(dbCalls.count).toBe(0)
  })
  it('recommendations are advice objects: no action carries or implies an applied change', () => {
    const view = buildOwnerDecisionView(snap({ facts: fullFacts(), cash: 100000, terms: [terms({ catch_up_minor: 44200 })] }))
    expect(view.actions.length).toBeGreaterThan(0)
    for (const a of view.actions) {
      expect(Object.keys(a).sort()).toEqual(['amount', 'category', 'dataCompleteness', 'id', 'certainty', 'missing', 'order', 'related', 'resource', 'rules', 'timing', 'title', 'why'].sort())
    }
  })
  it('a snapshot with no facts at all behaves exactly as CASH-UX-1 did (no invented facts)', () => {
    const view = buildOwnerDecisionView(snap())
    expect(ids(view).some(id => id.startsWith('unlock:') || id.startsWith('fund-via-unlock') || id.startsWith('protect-first') || id.startsWith('cure:'))).toBe(false)
    expect(deriveCanonicalDecisionFacts(snap())).toEqual({})
  })
})
