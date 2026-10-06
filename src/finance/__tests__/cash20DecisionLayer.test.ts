import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCashOsSnapshot, type CashOsSnapshot } from '../cashOsSnapshot'
import { buildOwnerDecisionView, type OwnerDecisionFacts, type OwnerDecisionView } from '../decisionLayer'
import { financialReconciliationKey } from '../domain'
import type { CashOsSourceBundle } from '@/services/cashOsReadService'
import type { CashOsSessionSetup } from '@/services/cashOsSessionSetup'
import type { FinancialAccountRow, FinancialTransactionRow } from '../ledgerTypes'
import type { CashCommitment, RecurringObligation } from '../obligationsTypes'
import type { LiabilityTermsRow } from '../liabilityTermsTypes'
import type { BackupData } from '@/services/backupDataService'

const ORG = 'org-1'
const DAY = '2026-10-05'

function account(id: string, over: Partial<FinancialAccountRow> = {}): FinancialAccountRow {
  return { id, organization_id: ORG, display_name: id, account_type: 'checking', account_class: 'asset',
    ownership_context: 'business', include_in_cash: true, currency: 'USD', status: 'active', source_type: 'manual',
    source_metadata: {}, created_at: '', updated_at: '', archived_at: null, ...over }
}
function tx(id: string, accountId: string, amount: number, date = DAY): FinancialTransactionRow {
  return { id, organization_id: ORG, account_id: accountId, amount_minor: amount, currency: 'USD', transaction_date: date,
    effective_at: null, posted_at: null, status: 'posted', transaction_kind: 'opening_balance', economic_effect: 'none',
    economic_amount_minor: 0, description: id, counterparty: null, category: null, project_id: null, employee_id: null,
    debt_account_id: null, source_type: 'opening_balance', source_organization_id: null, source_kind: null,
    source_record_id: null, source_effective_date: null, source_timestamp: null, source_metadata: {},
    idempotency_key: id, created_at: '', updated_at: '', voided_at: null, voided_by: null, void_reason: null }
}
function commitment(id: string, date: string, amount: number, over: Partial<CashCommitment> = {}): CashCommitment {
  return { id, organizationId: ORG, title: id, expectedDate: date, amount: { currency: 'USD', minor: amount },
    amountCertainty: 'fixed', requirement: 'required', confidence: 'confirmed', status: 'scheduled', sourceType: 'manual',
    reconciliationState: 'unreconciled',
    provenance: { source: { organizationId: ORG, kind: 'cash_commitment', recordId: id }, freshness: 'current',
      confidence: 'confirmed', reconciliationState: 'unreconciled' }, ...over }
}
function terms(over: Partial<LiabilityTermsRow> = {}): LiabilityTermsRow {
  return { id: 't1', organization_id: ORG, account_id: 'care', debt_structure: 'revolving', apr_basis_points: 3299,
    promo_apr_basis_points: 0, promo_type: 'deferred_interest', promo_started_on: null, promo_expires_on: '2026-12-22',
    minimum_payment_minor: 11300, payment_due_day: null, next_due_date: null, scheduled_payment_minor: null,
    original_principal_minor: null, maturity_date: null, owner_notes: null, created_at: '', updated_at: '', ...over }
}
const truckKey = financialReconciliationKey({ organizationId: ORG, kind: 'cash_commitment', recordId: 'truck' })

/** Production-shaped fixture covering the owner's real cases. */
function project(id: string, name: string, status: string, contract: number, extra: Record<string, unknown> = {}) {
  return { id, name, type: 'project', status, contract, billed: 0, paid: 0, phase_timeline: [], ...extra }
}
function log(id: string, projId: string, collected: number) {
  return { id, projId, date: '2026-09-01', collected, hrs: 0, mat: 0 }
}
const casePortfolio = () => ({
  projects: [
    project('dw', 'Desert Willow', 'active', 3000),            // $950 remaining
    project('mh', 'Mobile Home', 'active', 8000),              // $3,500 remaining
    project('ss', 'Surgery Center', 'active', 0),              // T&M, no fixed amount
    project('p400', '400A Panel Upgrade', 'coming', 5000),     // estimate only
    project('bs', 'Beauty Salon', 'completed', 4000),          // complete and fully paid
  ],
  logs: [log('l1', 'dw', 2050), log('l2', 'mh', 4500), log('l3', 'bs', 4000)],
})

const setup = (floor = 5000): CashOsSessionSetup => ({ version: 1, organizationId: ORG, payrollPaidThroughDate: '2026-10-04',
  protectionHorizonDays: 14, operatingFloorMinor: floor, taxReserve: { kind: 'disabled' },
  includeOptionalObligations: false, includeOpenShiftEstimates: false, timezoneConfirmed: true, confirmedAt: '2026-10-05T20:00:00Z' })

function snap(opts: {
  cash?: number; floor?: number; portfolio?: { projects: any[]; logs: any[] }; commitments?: CashCommitment[]
  terms?: LiabilityTermsRow[]; debtBalance?: number; obligations?: RecurringObligation[]; timeEntries?: any[]
  bridges?: any[]; employees?: any[]; liability?: boolean
} = {}): CashOsSnapshot {
  const portfolio = opts.portfolio ?? casePortfolio()
  const accounts = [account('bank'), ...(opts.liability === false ? [] : [account('care', {
    display_name: 'CareCredit', account_type: 'credit_card', account_class: 'liability', include_in_cash: false })])]
  const transactions = [tx('open', 'bank', opts.cash ?? 15000),
    ...(opts.liability === false ? [] : [tx('care-open', 'care', opts.debtBalance ?? 341905)])]
  const bundle: CashOsSourceBundle = { organizationId: ORG, asOfDate: DAY, asOfTimestamp: '2026-10-05T20:00:00Z',
    accounts, transactions, obligations: opts.obligations ?? [], occurrences: [], commitments: opts.commitments ?? [],
    timeEntries: opts.timeEntries ?? [], sessions: [], bridges: opts.bridges ?? [], employees: opts.employees ?? [],
    liabilityTerms: opts.terms ?? [terms()],
    backup: { projects: portfolio.projects, logs: portfolio.logs, settings: {}, employees: [] } as unknown as BackupData }
  return buildCashOsSnapshot({ ...bundle, setup: setup(opts.floor), horizonDays: 30, confidenceMode: 'conservative' })
}

const text = (view: OwnerDecisionView) => JSON.stringify(view)
const actionIds = (view: OwnerDecisionView) => view.actions.map(a => a.id)
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as object)) deepFreeze((value as any)[key])
  }
  return value
}

describe('1. available cash is never increased by future money', () => {
  it('reports exactly the ledger cash while project money exists in other states', () => {
    const s = snap()
    const view = buildOwnerDecisionView(s)
    expect(view.today.availableMinor).toBe(15000)
    expect(view.today.availableMinor).toBe(s.allocation.totalCashMinor)
    expect(view.moneyStates.availableMinor).toBe(15000)
    expect(view.moneyStates.unlockable.length).toBeGreaterThan(0)
    const withoutProjects = buildOwnerDecisionView(snap({ portfolio: { projects: [], logs: [] } }))
    expect(withoutProjects.today.availableMinor).toBe(view.today.availableMinor)
    expect(withoutProjects.today.trulyFreeMinor).toBe(view.today.trulyFreeMinor)
  })
})

describe('2. a remaining balance is surfaced without being collectible', () => {
  it('Desert Willow ($950) and Mobile Home ($3,500) are UNLOCKABLE with unknown prerequisites', () => {
    const view = buildOwnerDecisionView(snap())
    const dw = view.moneyStates.unlockable.find(i => i.projectId === 'dw')!
    const mh = view.moneyStates.unlockable.find(i => i.projectId === 'mh')!
    expect(dw.amountMinor).toBe(95000)
    expect(mh.amountMinor).toBe(350000)
    expect(dw.unknowns.length).toBeGreaterThan(0)
    expect(view.moneyStates.collectible.map(i => i.projectId)).not.toContain('dw')
    expect(view.moneyStates.collectible.map(i => i.projectId)).not.toContain('mh')
  })
  it('only a real business event makes money collectible: billed, completed, or owner-confirmed', () => {
    const portfolio = {
      projects: [project('bill', 'Billed Job', 'active', 2000, { billed: 1500 }),
        project('done', 'Done Job', 'completed', 1000), project('plain', 'Plain Job', 'active', 900)],
      logs: [log('b1', 'bill', 500)],
    }
    const view = buildOwnerDecisionView(snap({ portfolio }))
    expect(view.moneyStates.collectible.find(i => i.projectId === 'bill')!.amountMinor).toBe(100000)
    expect(view.moneyStates.unlockable.find(i => i.projectId === 'bill')!.amountMinor).toBe(50000)
    expect(view.moneyStates.collectible.find(i => i.projectId === 'done')!.amountMinor).toBe(100000)
    expect(view.moneyStates.collectible.map(i => i.projectId)).not.toContain('plain')
    const confirmed = buildOwnerDecisionView(snap({ portfolio }), { facts: { projects: { plain: { readiness: 'ready_to_bill' } } } })
    const item = confirmed.moneyStates.collectible.find(i => i.projectId === 'plain')!
    expect(item.amountMinor).toBe(90000)
    expect(item.ownerConfirmed).toBe(true)
  })
  it('time passing or a payment schedule date does not promote money', () => {
    const portfolio = { projects: [project('late', 'Late Phase Job', 'active', 1000, {
      deposit_pct: 0, phase_timeline: [{ phase_name: 'Rough', payment_trigger_pct: 50, actual_end_date: '2026-08-01' }] })], logs: [] }
    const view = buildOwnerDecisionView(snap({ portfolio }))
    expect(view.moneyStates.collectible).toHaveLength(0)
    expect(view.moneyStates.unlockable[0].amountMinor).toBe(100000)
  })
})

describe('3. completed and fully paid work generates no active action', () => {
  it('Beauty Salon disappears from every state and from every action', () => {
    const view = buildOwnerDecisionView(snap())
    expect(view.moneyStates.settledProjectCount).toBe(1)
    expect(text(view)).not.toContain('Beauty Salon')
    expect(view.actions.some(a => a.related.projectId === 'bs')).toBe(false)
  })
})

describe('4. estimates and opportunities are never guaranteed cash', () => {
  it('400A Panel (status coming) is POTENTIAL, counted as no cash, with a verify-not-recommend action', () => {
    const view = buildOwnerDecisionView(snap())
    const item = view.moneyStates.potential.find(i => i.projectId === 'p400')!
    expect(item.state).toBe('potential')
    expect(view.moneyStates.collectible.concat(view.moneyStates.unlockable).map(i => i.projectId)).not.toContain('p400')
    const action = view.actions.find(a => a.related.projectId === 'p400')!
    expect(action.category).toBe('no_cash')
    expect(action.certainty).toBe('needs_verification')
    expect(action.amount.meaning).not.toBe('collects')
    expect(view.today.availableMinor).toBe(15000)
  })
  it('an owner-supplied estimate gets a no-cash follow-up and stays out of collectible', () => {
    const view = buildOwnerDecisionView(snap({ portfolio: { projects: [], logs: [] } }), { facts: { opportunities: [
      { id: 'o1', label: '400A panel — Smith', amountMinor: 650000, status: 'estimate_sent' }] } })
    expect(view.moneyStates.potential[0].amountMinor).toBe(650000)
    expect(view.moneyStates.collectible).toHaveLength(0)
    const action = view.actions.find(a => a.id === 'follow-up:opportunity:o1')!
    expect(action.title).toContain('Follow up')
    expect(action.resource.cashMinor).toBe(0)
  })
  it('an explicit awarded:false fact keeps a normal-looking project potential', () => {
    const view = buildOwnerDecisionView(snap(), { facts: { projects: { dw: { awarded: false } } } })
    expect(view.moneyStates.potential.map(i => i.projectId)).toContain('dw')
    expect(view.moneyStates.unlockable.map(i => i.projectId)).not.toContain('dw')
  })
})

describe('5. unknown prerequisites produce uncertainty, not invented recommendations', () => {
  it('with no owner facts there is no unlock, funding or ranking recommendation', () => {
    const view = buildOwnerDecisionView(snap())
    expect(actionIds(view).some(id => id.startsWith('unlock:') || id.startsWith('fund-via-unlock') || id.startsWith('protect-first'))).toBe(false)
    const verify = view.actions.filter(a => a.id.startsWith('verify-unlock:'))
    expect(verify.map(a => a.related.projectId).sort()).toEqual(['dw', 'mh'])
    for (const a of verify) {
      expect(a.certainty).toBe('needs_verification')
      expect(a.dataCompleteness).toBe('unknown')
      expect(a.missing.length).toBeGreaterThan(0)
    }
    expect(view.actions.filter(a => a.certainty === 'recommended' && a.amount.meaning === 'unlocks')).toHaveLength(0)
  })
  it('Surgery Center (no fixed amount) is not counted and is not claimed blocked without a fact', () => {
    const view = buildOwnerDecisionView(snap())
    const note = view.moneyStates.notCounted.find(i => i.projectId === 'ss')!
    expect(note.reason).toContain('time-and-material')
    expect(note.reason).toContain('not recorded')
    expect(view.moneyStates.blocked).toHaveLength(0)
    expect(view.moneyStates.collectible.concat(view.moneyStates.unlockable).map(i => i.projectId)).not.toContain('ss')
  })
  it('with an owner fact, Surgery Center becomes BLOCKED and forecasts nothing', () => {
    const view = buildOwnerDecisionView(snap(), { facts: { projects: { ss: {
      billingType: 'time_and_material', readiness: 'blocked', blocker: 'other trades' } } } })
    expect(view.moneyStates.blocked[0].projectId).toBe('ss')
    expect(view.moneyStates.blocked[0].amountMinor).toBeNull()
    const waiting = view.actions.find(a => a.category === 'waiting')!
    expect(waiting.title).toContain('other trades')
    expect(view.moneyStates.collectible).toHaveLength(0)
  })
})

describe('6. debt promotional deadline surfaces without inventing a past-due amount', () => {
  it('CareCredit: $3,419.05, deferred-interest deadline Dec 22, standard APR 32.99%, $113 payment', () => {
    const view = buildOwnerDecisionView(snap())
    const risk = view.risks.find(r => r.kind === 'promo_deadline')!
    expect(risk.date).toBe('2026-12-22')
    expect(risk.amountMinor).toBe(341905)
    expect(risk.detail).toContain('$3,419.05')
    expect(risk.detail).toContain('will not clear')
    expect(risk.detail).toContain('deferred interest')
    expect(risk.detail).toContain('32.99%')
    expect(risk.severity).toBe('high')
    expect(text(view)).not.toMatch(/\$442/)
    expect(view.dataGaps.join(' ')).toContain('Past-due and catch-up amounts are not stored')
    const watch = view.actions.find(a => a.id === 'watch:promo:care')!
    expect(watch.category).toBe('watch')
    expect(watch.missing).toContain('past-due amount (not stored)')
  })
  it('an expired promo is flagged for verification, not assumed charged', () => {
    const view = buildOwnerDecisionView(snap({ terms: [terms({ promo_expires_on: '2026-09-01' })] }))
    const risk = view.risks.find(r => r.id === 'promo-passed:care')!
    expect(risk.detail).toContain('cannot tell')
    expect(risk.missing).toContain('statement confirmation')
  })
  it('a promo far in the future is not surfaced', () => {
    const view = buildOwnerDecisionView(snap({ terms: [terms({ promo_expires_on: '2028-01-01' })] }))
    expect(view.risks.some(r => r.kind === 'promo_deadline')).toBe(false)
  })
})

describe('7. every recommendation carries its reasoning and its uncertainty', () => {
  it('exposes why, certainty, completeness, missing facts, timing, resource and rule ids', () => {
    const view = buildOwnerDecisionView(snap({ commitments: [commitment('truck', '2026-10-10', 56000, { category: 'vehicle' })] }),
      { facts: { projects: { dw: { readiness: 'work_required', cashRequiredMinor: 0, workHours: 4,
        expectedCollectionDate: '2026-10-08', collectionConfidence: 'high' } } } })
    expect(view.actions.length).toBeGreaterThan(3)
    for (const a of view.actions) {
      expect(a.why.length, a.id).toBeGreaterThan(0)
      expect(a.why.every(w => w.trim().length > 0), a.id).toBe(true)
      expect(['recommended', 'needs_verification', 'informational']).toContain(a.certainty)
      expect(['complete', 'partial', 'unknown']).toContain(a.dataCompleteness)
      expect(Array.isArray(a.missing)).toBe(true)
      expect(Array.isArray(a.rules)).toBe(true)
      expect(a.timing).toHaveProperty('basis')
      expect(a.resource).toHaveProperty('ownerWork')
    }
  })
})

describe('8. partial or insufficient data degrades safely', () => {
  it('no snapshot is unavailable, not an error', () => {
    for (const bad of [null, undefined]) {
      const view = buildOwnerDecisionView(bad)
      expect(view.status).toBe('unavailable')
      expect(view.actions).toEqual([])
    }
  })
  it('a payroll-overlap partial snapshot withholds cash totals but still shows the diagnostic', () => {
    const overlapping: RecurringObligation = { id: 'agency', organizationId: ORG, name: 'Payroll service fee',
      amount: { currency: 'USD', minor: 16495 }, amountCertainty: 'fixed', category: 'payroll', requirement: 'required',
      confidence: 'confirmed', status: 'active', sourceType: 'manual',
      recurrence: { kind: 'monthly', interval: 1, anchorDate: '2026-10-20', startDate: '2026-10-20' },
      provenance: { source: { organizationId: ORG, kind: 'financial_obligation', recordId: 'agency' }, freshness: 'current',
        confidence: 'confirmed', reconciliationState: 'unreconciled' } }
    const s = snap({ obligations: [overlapping],
      timeEntries: [{ id: 'te1', organizationId: ORG, employeeProfileId: 'p1', workDate: '2026-10-05', paidMinutes: 480, status: 'complete', approvalStatus: 'none' }],
      bridges: [{ employeeProfileId: 'p1', backupEmployeeId: 'emp1' }], employees: [{ backupEmployeeId: 'emp1', hourly_rate: 25 }] })
    expect(s.payrollDiagnostics.some(d => d.kind === 'potential_manual_payroll_overlap')).toBe(true)
    const view = buildOwnerDecisionView(s, { partial: true })
    expect(view.status).toBe('withheld')
    expect(view.today.availableMinor).toBeNull()
    expect(view.today.protectedMinor).toBeNull()
    expect(view.moneyStates.availableMinor).toBeNull()
    expect(view.next7Days.movements).toEqual([])
    const risk = view.risks.find(r => r.id === 'payroll-data')!
    expect(risk.severity).toBe('high')
    expect(risk.detail).toContain('potential manual payroll overlap')
    expect(view.moneyStates.unlockable.length).toBeGreaterThan(0) // project money does not depend on payroll
  })
  it('a snapshot missing backup, terms, accounts and projection does not throw', () => {
    const broken = { ...snap(), backup: undefined, liabilityTerms: undefined, accounts: undefined, projection: undefined } as unknown as CashOsSnapshot
    expect(() => buildOwnerDecisionView(broken)).not.toThrow()
    const view = buildOwnerDecisionView(broken)
    expect(view.moneyStates.unlockable).toEqual([])
    expect(view.risks.some(r => r.kind === 'promo_deadline')).toBe(false)
  })
})

describe('9. derivation performs no writes', () => {
  it('runs against a deeply frozen snapshot and leaves it untouched (no project.finance creation)', () => {
    const s = snap()
    const before = JSON.stringify(s)
    deepFreeze(s)
    expect(() => buildOwnerDecisionView(s, { facts: { projects: { dw: { readiness: 'work_required' } } } })).not.toThrow()
    expect(JSON.stringify(s)).toBe(before)
    expect((s as any).backup.projects[0].finance).toBeUndefined()
  })
  it('imports no service, storage or network and never calls the mutating getProjectFinancials', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/finance/decisionLayer.ts'), 'utf8')
    const imports = source.split('\n').filter(l => /^\s*import /.test(l)).join('\n')
    expect(imports).not.toMatch(/supabase|Service|services\/|localStorage|sessionStorage/)
    expect(source).not.toMatch(/getProjectFinancials\(|fetch\(|localStorage|sessionStorage|\.insert\(|\.update\(|\.rpc\(/)
  })
})

describe('locked rules with owner-supplied facts', () => {
  const truck = commitment('truck', '2026-10-10', 56000, { category: 'vehicle' })
  const dwReady = { readiness: 'work_required' as const, workRequirement: 'install lights and receptacles', cashRequiredMinor: 5000,
    workHours: 6, expectedCollectionDate: '2026-10-08', collectionConfidence: 'high' as const }

  it('Rule 1: a work vehicle is protected by operational consequence, not by APR or lateness', () => {
    const facts: OwnerDecisionFacts = { obligations: { [truckKey]: { operationallyCritical: true, consequence: 'needed to reach jobs and collect money' } } }
    const s = snap({ commitments: [truck] })
    const withFact = buildOwnerDecisionView(s, { facts })
    const first = withFact.actions.find(a => a.id === `protect-first:${truckKey}`)!
    expect(first.certainty).toBe('recommended')
    expect(first.rules).toContain(1)
    expect(first.why.join(' ')).toContain('not by interest rate')
    const none = buildOwnerDecisionView(s)
    expect(actionIds(none).some(id => id.startsWith('protect-first'))).toBe(false)
    const hint = none.actions.find(a => a.id === `criticality-unknown:${truckKey}`)!
    expect(hint.certainty).toBe('needs_verification')
    expect(hint.missing).toContain('operational criticality')
  })

  it('Rule 2: ranks attainable unlocks, not the largest balance, and never calls gross money profit', () => {
    const facts: OwnerDecisionFacts = { projects: {
      dw: { readiness: 'work_required', workRequirement: 'lights and receptacles', cashRequiredMinor: 0, workHours: 4,
        expectedCollectionDate: '2026-10-12', collectionConfidence: 'high' },
      mh: { readiness: 'work_required', workRequirement: 'materials and finish past rough-in', cashRequiredMinor: 180000, workHours: 40,
        expectedCollectionDate: '2026-10-30', collectionConfidence: 'medium' } } }
    const view = buildOwnerDecisionView(snap(), { facts })
    const dw = view.actions.find(a => a.id === 'unlock:dw:unlockable')!
    const mh = view.actions.find(a => a.id === 'unlock:mh:unlockable')!
    expect(dw.why.join(' ')).toContain('#1 of 2')
    expect(mh.why.join(' ')).toContain('#2 of 2')
    expect(dw.amount.minor).toBeLessThan(mh.amount.minor!)
    expect(dw.category).toBe('owner_work')
    expect(mh.category).toBe('cash_required')
    expect(mh.certainty).toBe('needs_verification')
    expect(mh.resource.cashMinor).toBe(180000)
    expect(text(view)).not.toMatch(/1,700|\bprofit of\b/i)
  })

  it('Rule 3: recommends spending scarce cash on a credible unlock that funds a critical obligation', () => {
    const facts: OwnerDecisionFacts = {
      obligations: { [truckKey]: { operationallyCritical: true, consequence: 'needed to reach jobs' } },
      projects: { dw: dwReady } }
    const view = buildOwnerDecisionView(snap({ commitments: [truck] }), { facts })
    const plan = view.actions.find(a => a.id.startsWith('fund-via-unlock:'))!
    expect(plan.category).toBe('cash_required')
    expect(plan.certainty).toBe('recommended')
    expect(plan.rules).toEqual(expect.arrayContaining([1, 2, 3, 5]))
    expect(plan.resource.cashMinor).toBe(5000)
    expect(plan.why.join(' ')).toContain('nothing is spent or reserved for you')
  })
  it('Rule 3: is withheld when the chain is not credible (low confidence, late, or unknown date)', () => {
    const base = { obligations: { [truckKey]: { operationallyCritical: true } } }
    for (const dw of [{ ...dwReady, collectionConfidence: 'low' as const }, { ...dwReady, expectedCollectionDate: '2026-10-20' }]) {
      const view = buildOwnerDecisionView(snap({ commitments: [truck] }), { facts: { ...base, projects: { dw } } })
      expect(actionIds(view).some(id => id.startsWith('fund-via-unlock'))).toBe(false)
    }
    const { expectedCollectionDate: _drop, ...missingDate } = dwReady
    const unknown = buildOwnerDecisionView(snap({ commitments: [truck] }), { facts: { ...base, projects: { dw: missingDate } } })
    expect(actionIds(unknown).some(id => id.startsWith('fund-via-unlock'))).toBe(false)
    expect(unknown.actions.find(a => a.id === 'verify-unlock:dw:unlockable')!.missing).toContain('expected collection date')
  })
  it('Rule 3 never fires without a critical fact (no automatic reprioritization)', () => {
    const view = buildOwnerDecisionView(snap({ commitments: [truck] }), { facts: { projects: { dw: dwReady } } })
    expect(actionIds(view).some(id => id.startsWith('fund-via-unlock'))).toBe(false)
  })

  it('Rule 4: no partial payment is recommended without a known purpose', () => {
    const facts: OwnerDecisionFacts = { debts: { care: { catchUpMinor: 44200 } } }
    const view = buildOwnerDecisionView(snap(), { facts })
    expect(actionIds(view)).toContain('hold:care')
    expect(actionIds(view).some(id => id.startsWith('partial:') || id.startsWith('cure:'))).toBe(false)
    expect(view.actions.find(a => a.id === 'hold:care')!.certainty).toBe('needs_verification')
  })
  it('Rule 4: a partial payment is recommended only when it meets a stated requirement with a consequence', () => {
    const facts: OwnerDecisionFacts = { debts: { care: { catchUpMinor: 44200, minimumDueMinor: 11300, consequence: 'late fee and account flag' } } }
    const view = buildOwnerDecisionView(snap({ cash: 30000 }), { facts })
    const partial = view.actions.find(a => a.id === 'partial:care')!
    expect(partial.certainty).toBe('recommended')
    expect(partial.amount.minor).toBe(11300)
    expect(partial.why.join(' ')).toContain('late fee')
  })
  it('Rule 4: full catch-up is recommended only when it is actually affordable', () => {
    const facts: OwnerDecisionFacts = { debts: { care: { catchUpMinor: 44200 } } }
    const view = buildOwnerDecisionView(snap({ cash: 100000 }), { facts })
    expect(view.actions.find(a => a.id === 'cure:care')!.certainty).toBe('recommended')
  })

  it('Rule 5: cash needed for an unlock must stay above the operating floor', () => {
    const facts: OwnerDecisionFacts = { projects: { dw: { ...dwReady, cashRequiredMinor: 12000 } } }
    const view = buildOwnerDecisionView(snap({ cash: 15000, floor: 5000 }), { facts })
    const action = view.actions.find(a => a.id === 'unlock:dw:unlockable')!
    expect(action.certainty).toBe('needs_verification')
    expect(action.why.join(' ')).toContain('more than you have above your operating floor')
  })

  it('Rule 6: compatible actions coexist and ordering is per category', () => {
    const facts: OwnerDecisionFacts = {
      projects: { dw: { ...dwReady, cashRequiredMinor: 0 } },
      opportunities: [{ id: 'o1', label: '400A panel', amountMinor: 650000, status: 'estimate_sent' }] }
    const view = buildOwnerDecisionView(snap(), { facts })
    const categories = new Set(view.actions.map(a => a.category))
    expect(categories.size).toBeGreaterThanOrEqual(3)
    expect(categories.has('no_cash') && categories.has('owner_work') && categories.has('watch')).toBe(true)
    for (const category of categories) {
      const orders = view.actions.filter(a => a.category === category).map(a => a.order)
      expect(orders).toEqual(orders.map((_, i) => i + 1))
    }
  })

  it('Rule 8: owner authority — outputs are advice only; nothing resembles an applied change', () => {
    const view = buildOwnerDecisionView(snap(), { facts: { projects: { dw: dwReady } } })
    expect(Object.keys(view).sort()).toEqual(['actions', 'asOfDate', 'dataGaps', 'moneyStates', 'next7Days', 'risks', 'status', 'today'])
    for (const a of view.actions) expect(a).not.toHaveProperty('apply')
    expect(view.moneyStates.collectible.map(i => i.projectId)).not.toContain('dw')
  })
})
