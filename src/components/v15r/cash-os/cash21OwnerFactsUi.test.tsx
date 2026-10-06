// @vitest-environment happy-dom
// Owner facts are captured where the owner meets the problem, in plain business questions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const spies = vi.hoisted(() => ({
  upsertFacts: vi.fn(async (_id: string, _input: any) => ({})),
  createCommitment: vi.fn(async (_input: any) => ({ id: 'new' })),
  updateCommitment: vi.fn(async (_id: string, _input: any) => undefined),
  upsertTerms: vi.fn(async (_id: string, _terms: any) => ({ id: 't' })),
}))

vi.mock('@/services/cashProjectFactsService', () => ({
  upsertCashProjectFacts: spies.upsertFacts, readCashProjectFacts: vi.fn(async () => []),
}))
vi.mock('@/services/cashObligationService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/cashObligationService')>()),
  createCashCommitment: spies.createCommitment, updateCashCommitment: spies.updateCommitment,
}))
vi.mock('@/services/liabilityTermsService', () => ({
  upsertLiabilityTerms: spies.upsertTerms, readLiabilityTerms: vi.fn(async () => []),
}))

import CashOsDecisionLayer from './CashOsDecisionLayer'
import CashOsObligations from './CashOsObligations'
import CashOsDebtTermsEditor from './CashOsDebtTermsEditor'
import { buildCashOsSnapshot } from '@/finance/cashOsSnapshot'
import type { BackupData } from '@/services/backupDataService'
import type { CashCommitment } from '@/finance/obligationsTypes'

const ORG = 'org-1'
const account = (id: string, over: Record<string, unknown> = {}) => ({ id, organization_id: ORG, display_name: id, account_type: 'checking',
  account_class: 'asset', ownership_context: 'business', include_in_cash: true, currency: 'USD', status: 'active', source_type: 'manual',
  source_metadata: {}, created_at: '', updated_at: '', archived_at: null, ...over })
const tx = (id: string, accountId: string, amount: number) => ({ id, organization_id: ORG, account_id: accountId, amount_minor: amount,
  currency: 'USD', transaction_date: '2026-10-05', effective_at: null, posted_at: null, status: 'posted', transaction_kind: 'opening_balance',
  economic_effect: 'none', economic_amount_minor: 0, description: id, counterparty: null, category: null, project_id: null, employee_id: null,
  debt_account_id: null, source_type: 'opening_balance', source_organization_id: null, source_kind: null, source_record_id: null,
  source_effective_date: null, source_timestamp: null, source_metadata: {}, idempotency_key: id, created_at: '', updated_at: '',
  voided_at: null, voided_by: null, void_reason: null })
const project = (id: string, name: string, status: string, contract: number) => ({ id, name, type: 'project', status, contract, billed: 0, paid: 0, phase_timeline: [] })

function snapshot(commitments: CashCommitment[] = []) {
  return buildCashOsSnapshot({ organizationId: ORG, asOfDate: '2026-10-05', asOfTimestamp: '2026-10-05T20:00:00Z',
    accounts: [account('bank')] as any, transactions: [tx('o', 'bank', 500000)] as any, obligations: [], occurrences: [], commitments,
    timeEntries: [], sessions: [], bridges: [], employees: [], liabilityTerms: [], projectFacts: [],
    backup: { settings: {}, employees: [], logs: [{ id: 'l1', projId: 'dw', date: '2026-09-01', collected: 2050 }, { id: 'l2', projId: 'mh', date: '2026-09-01', collected: 4500 }],
      projects: [project('dw', 'Desert Willow', 'active', 3000), project('mh', 'Mobile Home', 'active', 8000), project('ss', 'Surgery Center', 'active', 0)] } as unknown as BackupData,
    setup: { version: 1, organizationId: ORG, payrollPaidThroughDate: '2026-10-04', protectionHorizonDays: 14, operatingFloorMinor: 5000,
      taxReserve: { kind: 'disabled' }, includeOptionalObligations: false, includeOpenShiftEstimates: false, timezoneConfirmed: true,
      confirmedAt: '2026-10-05T20:00:00Z' }, horizonDays: 30, confidenceMode: 'conservative' })
}

describe('owner facts UI', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.values(spies).forEach(spy => spy.mockClear())
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

  const text = () => host.textContent ?? ''
  const click = async (el: Element | null | undefined) => { if (!el) throw new Error('missing element: ' + text().slice(0, 200)); await act(async () => { (el as HTMLElement).click() }) }
  const byText = (selector: string, value: string, scope: ParentNode = host) =>
    [...scope.querySelectorAll(selector)].find(e => (e.textContent ?? '').trim() === value)
  const setField = async (el: Element | null, value: string) => {
    if (!el) throw new Error('missing field')
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    })
  }
  const card = (testId: string, name: string) => [...host.querySelectorAll(`[data-testid="${testId}"] .text-sm`)].find(d => d.textContent?.includes(name)) as HTMLElement
  const field = (scope: ParentNode, question: string) => {
    const labelEl = [...scope.querySelectorAll('label')].find(l => l.textContent?.includes(question))
    return (labelEl?.querySelector('input,select,textarea') ?? null) as HTMLInputElement | null
  }

  async function openEditor(testId: string, name: string, onRefresh = vi.fn()) {
    await act(async () => { root.render(<CashOsDecisionLayer snapshot={snapshot()} onRefresh={onRefresh} />) })
    await click(byText('button', 'Tell Cash OS about this job', card(testId, name)))
    return { editor: host.querySelector('[data-testid="project-facts-editor"]') as HTMLElement, onRefresh }
  }

  it('Desert Willow: asks plain questions, saves the facts, then refreshes the shared data', async () => {
    const { editor, onRefresh } = await openEditor('money-unlockable', 'Desert Willow')
    expect(editor.textContent).toContain("Can you collect what's left on this job right now?")
    await setField(field(editor, 'How is this job billed?'), 'fixed')
    await setField(field(editor, "Can you collect what's left"), 'work_required')
    await setField(field(editor, 'What needs to happen before you can collect?'), 'Install remaining lights and receptacles')
    await setField(field(editor, 'Do you need to spend money'), 'no')
    await setField(field(editor, 'About how many hours'), '4')
    await setField(field(editor, 'When do you realistically expect to collect?'), '2026-10-12')
    await setField(field(editor, 'How sure are you?'), 'high')
    await click(byText('button', 'Save', editor))
    expect(spies.upsertFacts).toHaveBeenCalledTimes(1)
    const [projectId, input] = spies.upsertFacts.mock.calls[0]
    expect(projectId).toBe('dw')
    expect(input).toMatchObject({ billingType: 'fixed', readiness: 'work_required', completionRequirement: 'Install remaining lights and receptacles',
      needsSpend: false, workHoursRemaining: 4, expectedCollectionDate: '2026-10-12', collectionConfidence: 'high', blockedReason: null })
    expect(Object.keys(input).some(k => /amount|balance|minor/i.test(k))).toBe(false)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-testid="project-facts-editor"]')).toBeNull()
  })

  it('Surgery Center: time & material plus a plain-language blocker', async () => {
    await act(async () => { root.render(<CashOsDecisionLayer snapshot={snapshot()} onRefresh={vi.fn()} />) })
    const notCounted = host.querySelector('[data-testid="money-not-counted"]')!
    await click(byText('button', 'Tell Cash OS about this job', notCounted))
    const editor = host.querySelector('[data-testid="project-facts-editor"]') as HTMLElement
    await setField(field(editor, 'How is this job billed?'), 'time_and_material')
    expect(editor.textContent).toContain('Future hours are never counted as money owed')
    await click(editor.querySelector('input[type="checkbox"]'))
    await setField(editor.querySelector('input[aria-label="What is in the way?"]'), 'Waiting on other trades')
    await click(byText('button', 'Save', editor))
    expect(spies.upsertFacts.mock.calls[0][1]).toMatchObject({ billingType: 'time_and_material', blockedReason: 'Waiting on other trades' })
  })

  it('Mobile Home: spending is recorded as a real required cost tied to the job, never as revenue', async () => {
    const { editor, onRefresh } = await openEditor('money-unlockable', 'Mobile Home')
    await setField(field(editor, 'Do you need to spend money'), 'yes')
    expect(editor.textContent).toContain("Nothing is tied to this job yet, so Cash OS doesn't know how much")
    expect(editor.textContent).toContain('cost, never revenue')
    await setField(editor.querySelector('input[aria-label="What will you buy?"]'), 'Materials')
    await setField(editor.querySelector('input[aria-label="About how much?"]'), '1800')
    await setField(editor.querySelector('input[aria-label="When will you buy it?"]'), '2026-10-12')
    await click(byText('button', 'Add this spend', editor))
    expect(spies.createCommitment).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Materials', amountMinor: 180000, expectedDate: '2026-10-12', isRequired: true, projectId: 'mh' }))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('shows spend already tied to the job and its total', async () => {
    const spend: CashCommitment = { id: 'c1', organizationId: ORG, title: 'Materials', expectedDate: '2026-10-12', amount: { currency: 'USD', minor: 180000 },
      amountCertainty: 'fixed', requirement: 'required', confidence: 'expected', status: 'scheduled', sourceType: 'manual', reconciliationState: 'unreconciled',
      projectId: 'mh', provenance: { source: { organizationId: ORG, kind: 'cash_commitment', recordId: 'c1' }, freshness: 'current', confidence: 'expected', reconciliationState: 'unreconciled' } }
    await act(async () => { root.render(<CashOsDecisionLayer snapshot={snapshot([spend])} onRefresh={vi.fn()} />) })
    await click(byText('button', 'Tell Cash OS about this job', card('money-unlockable', 'Mobile Home')))
    const editor = host.querySelector('[data-testid="project-facts-editor"]') as HTMLElement
    await setField(field(editor, 'Do you need to spend money'), 'yes')
    expect(editor.textContent).toContain('$1,800.00 total')
    expect(editor.textContent).toContain('Materials — $1,800.00')
  })

  it('refuses a blocked-and-ready contradiction without writing a fact the database would reject', async () => {
    spies.upsertFacts.mockRejectedValueOnce(new Error('A job that is blocked right now cannot also be ready to bill.'))
    const { editor } = await openEditor('money-unlockable', 'Desert Willow')
    await setField(field(editor, "Can you collect what's left"), 'ready_to_bill')
    await click(editor.querySelector('input[type="checkbox"]'))
    await setField(editor.querySelector('input[aria-label="What is in the way?"]'), 'Waiting')
    await click(byText('button', 'Save', editor))
    expect(host.textContent).toContain('cannot also be ready to bill')
    expect(host.querySelector('[data-testid="project-facts-editor"]')).not.toBeNull()
  })

  it('the questions are plain business language, with no internal vocabulary', async () => {
    const { editor } = await openEditor('money-unlockable', 'Desert Willow')
    for (const jargon of ['OwnerDecisionFacts', 'decision', 'collection evidence', 'ranking', 'weight', 'score', 'Collection Clock', 'funding gap', 'envelope', 'bucket']) {
      expect((editor.textContent ?? '').toLowerCase(), jargon).not.toContain(jargon.toLowerCase())
    }
    expect(editor.textContent).toContain('Something is stopping me from working on this right now')
  })

  it('a one-time commitment can be tied to a job and marked as needed to keep working', async () => {
    await act(async () => {
      root.render(<CashOsObligations obligations={[]} commitments={[]} projects={[{ id: 'mh', name: 'Mobile Home' }]} onRefresh={vi.fn()} />)
    })
    await click(byText('button', '+ Commitment'))
    await setField(field(host, 'Title'), 'Materials')
    await setField(field(host, 'Amount'), '1800.00')
    await setField(field(host, 'Which job is this spend for?'), 'mh')
    await click(host.querySelector('input[type="checkbox"]:not([class*="sr-only"])'))
    await setField(host.querySelector('input[placeholder^="e.g. Primary work vehicle"]'), 'Needed to finish the job')
    await click(byText('button', 'Add commitment'))
    expect(spies.createCommitment).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Materials', amountMinor: 180000, projectId: 'mh', operationallyCritical: true, criticalReason: 'Needed to finish the job' }))
  })

  it('a commitment is not forced onto a job, and an untouched edit sends no new columns (safe before the migration)', async () => {
    const legacy: CashCommitment = { id: 'c9', organizationId: ORG, title: 'Tool', expectedDate: '2026-10-20', amount: { currency: 'USD', minor: 5000 },
      amountCertainty: 'fixed', requirement: 'required', confidence: 'expected', status: 'scheduled', sourceType: 'manual', reconciliationState: 'unreconciled',
      provenance: { source: { organizationId: ORG, kind: 'cash_commitment', recordId: 'c9' }, freshness: 'current', confidence: 'expected', reconciliationState: 'unreconciled' } }
    await act(async () => {
      root.render(<CashOsObligations obligations={[]} commitments={[legacy]} projects={[{ id: 'mh', name: 'Mobile Home' }]} onRefresh={vi.fn()} />)
    })
    await click(byText('button', 'Edit', [...host.querySelectorAll('section')].find(s => s.textContent?.includes('Cash commitments'))!))
    await click(byText('button', 'Save changes'))
    const patch = spies.updateCommitment.mock.calls[0][1]
    expect('projectId' in patch).toBe(false)
    expect('operationallyCritical' in patch).toBe(false)
  })

  it('debt terms: past due, catch-up and criticality are saved separately from the normal payment', async () => {
    const terms: any = { id: 't', organization_id: ORG, account_id: 'care', debt_structure: 'revolving', apr_basis_points: 3299, promo_apr_basis_points: null,
      promo_type: null, promo_started_on: null, promo_expires_on: null, minimum_payment_minor: 11300, payment_due_day: null, next_due_date: null,
      scheduled_payment_minor: null, original_principal_minor: null, maturity_date: null, owner_notes: null, created_at: '', updated_at: '',
      past_due_minor: null, catch_up_minor: null, consequence_note: null, operationally_critical: false, critical_reason: null }
    await act(async () => {
      root.render(<CashOsDebtTermsEditor accountId="care" accountDisplayName="CareCredit" initialTerms={terms} onSave={vi.fn()} onCancel={vi.fn()} />)
    })
    const inputs = [...host.querySelectorAll('input')]
    const byPlaceholder = (p: string) => inputs.find(i => i.getAttribute('placeholder') === p)!
    await setField(byPlaceholder('e.g. 329'), '329')
    await setField(byPlaceholder('e.g. 442'), '442')
    await setField(byPlaceholder('e.g. Late fee, account sent to collections'), 'Late fee')
    await click(byText('button', 'Save terms'))
    expect(spies.upsertTerms).toHaveBeenCalledTimes(1)
    const sent = spies.upsertTerms.mock.calls[0][1]
    expect(sent).toMatchObject({ minimum_payment_minor: 11300, past_due_minor: 32900, catch_up_minor: 44200, consequence_note: 'Late fee', operationally_critical: false })
    expect(new Set([sent.minimum_payment_minor, sent.past_due_minor, sent.catch_up_minor]).size).toBe(3)
  })

  it('debt terms: marking a debt as needed to keep working stores the owner\'s reason, not a guess', async () => {
    const terms: any = { id: 't', organization_id: ORG, account_id: 'loan', debt_structure: 'installment', apr_basis_points: null, promo_apr_basis_points: null,
      promo_type: null, promo_started_on: null, promo_expires_on: null, minimum_payment_minor: null, payment_due_day: null, next_due_date: null,
      scheduled_payment_minor: 56000, original_principal_minor: null, maturity_date: null, owner_notes: null, created_at: '', updated_at: '' }
    await act(async () => {
      root.render(<CashOsDebtTermsEditor accountId="loan" accountDisplayName="Work Truck Loan" initialTerms={terms} onSave={vi.fn()} onCancel={vi.fn()} />)
    })
    await click(host.querySelector('input[type="checkbox"]'))
    await setField(host.querySelector('input[placeholder^="e.g. Primary work vehicle"]'), 'Primary work vehicle')
    await click(byText('button', 'Save terms'))
    expect(spies.upsertTerms.mock.calls[0][1]).toMatchObject({ operationally_critical: true, critical_reason: 'Primary work vehicle' })
  })

  it('debt terms: before the migration, saving ordinary terms sends none of the new columns', async () => {
    const legacy: any = { id: 't', organization_id: ORG, account_id: 'care', debt_structure: 'revolving', apr_basis_points: 2499, promo_apr_basis_points: null,
      promo_type: null, promo_started_on: null, promo_expires_on: null, minimum_payment_minor: 11300, payment_due_day: null, next_due_date: null,
      scheduled_payment_minor: null, original_principal_minor: null, maturity_date: null, owner_notes: null, created_at: '', updated_at: '' }
    await act(async () => {
      root.render(<CashOsDebtTermsEditor accountId="care" accountDisplayName="CareCredit" initialTerms={legacy} onSave={vi.fn()} onCancel={vi.fn()} />)
    })
    await click(byText('button', 'Save terms'))
    const sent = spies.upsertTerms.mock.calls[0][1]
    for (const key of ['past_due_minor', 'catch_up_minor', 'consequence_note', 'operationally_critical', 'critical_reason']) expect(key in sent, key).toBe(false)
  })
})
