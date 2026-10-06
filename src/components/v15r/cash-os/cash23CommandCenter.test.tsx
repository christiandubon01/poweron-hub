// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('./CashMoneyPlan', () => ({ default: () => <div data-testid="money-plan-stub">money plan</div> }))

import CashOsOutlook from './CashOsOutlook'
import CashOsDecisionLayer, { CashOsDecisionView } from './CashOsDecisionLayer'
import { buildAttentionRows, buildMoneyRows, buildNextRows, buildTodayModel } from './commandCenterModel'
import { buildCashOsSnapshot } from '@/finance/cashOsSnapshot'
import type { DecisionAction, DecisionRisk, MoneyItem, OwnerDecisionView } from '@/finance/decisionLayer'
import type { CashCommitment } from '@/finance/obligationsTypes'
import type { BackupData } from '@/services/backupDataService'

const ORG = 'org-1'
const account = (id: string, over: Record<string, unknown> = {}) => ({ id, organization_id: ORG, display_name: id, account_type: 'checking',
  account_class: 'asset', ownership_context: 'business', include_in_cash: true, currency: 'USD', status: 'active', source_type: 'manual',
  source_metadata: {}, created_at: '', updated_at: '', archived_at: null, ...over })
const tx = (id: string, accountId: string, amount: number, over: Record<string, unknown> = {}) => ({ id, organization_id: ORG, account_id: accountId,
  amount_minor: amount, currency: 'USD', transaction_date: '2026-10-05', effective_at: null, posted_at: null, status: 'posted', transaction_kind: 'opening_balance',
  economic_effect: 'none', economic_amount_minor: 0, description: id, counterparty: null, category: null, project_id: null, employee_id: null,
  debt_account_id: null, source_type: 'opening_balance', source_organization_id: null, source_kind: null, source_record_id: null,
  source_effective_date: null, source_timestamp: null, source_metadata: {}, idempotency_key: id, created_at: '', updated_at: '',
  voided_at: null, voided_by: null, void_reason: null, ...over })
const commitment = (id: string, title: string, date: string, minor: number): CashCommitment => ({ id, organizationId: ORG, title, expectedDate: date,
  amount: { currency: 'USD', minor }, amountCertainty: 'fixed', requirement: 'required', confidence: 'confirmed', status: 'scheduled', sourceType: 'manual',
  reconciliationState: 'unreconciled', provenance: { source: { organizationId: ORG, kind: 'cash_commitment', recordId: id }, freshness: 'current',
    confidence: 'confirmed', reconciliationState: 'unreconciled' } } as any)

function snapshot(opts: { commitments?: CashCommitment[]; extraTx?: any[]; opening?: number } = {}) {
  return buildCashOsSnapshot({ organizationId: ORG, asOfDate: '2026-10-05', asOfTimestamp: '2026-10-05T20:00:00Z',
    accounts: [account('bank')] as any, transactions: [tx('o', 'bank', opts.opening ?? 500000), ...(opts.extraTx ?? [])] as any,
    obligations: [], occurrences: [], commitments: opts.commitments ?? [], timeEntries: [], sessions: [], bridges: [], employees: [], liabilityTerms: [], projectFacts: [],
    backup: { settings: {}, employees: [], logs: [], projects: [] } as unknown as BackupData,
    setup: { version: 1, organizationId: ORG, payrollPaidThroughDate: '2026-10-04', protectionHorizonDays: 14, operatingFloorMinor: 5000,
      taxReserve: { kind: 'disabled' }, includeOptionalObligations: false, includeOpenShiftEstimates: false, timezoneConfirmed: true,
      confirmedAt: '2026-10-05T20:00:00Z' }, horizonDays: 30, confidenceMode: 'conservative' })
}

const risk = (id: string, severity: DecisionRisk['severity'], title: string, over: Partial<DecisionRisk> = {}): DecisionRisk => ({
  id, kind: 'overdue_item', severity, title, detail: `DETAIL-${id}`, amountMinor: null, date: null, missing: [], related: {}, ...over })
const moneyItem = (id: string, state: MoneyItem['state'], label: string, amountMinor: number | null, projectId?: string): MoneyItem => ({
  id, state, label, amountMinor, basis: `BASIS-${id}`, projectId, unknowns: [], ownerConfirmed: false })
const action = (id: string, category: DecisionAction['category'], title: string, over: Partial<DecisionAction> = {}): DecisionAction => ({
  id, category, title, why: [`WHY-${id}`], resource: { cashMinor: 0, ownerWork: 'none' }, amount: { minor: null, meaning: 'none' },
  timing: { date: null, basis: '' }, certainty: 'recommended', dataCompleteness: 'complete', missing: [], related: {}, rules: [], order: 1, ...over })

function makeView(over: Partial<OwnerDecisionView> = {}): OwnerDecisionView {
  return {
    asOfDate: '2026-10-05', status: 'ready',
    today: { availableMinor: 15000, protectedMinor: 5000, trulyFreeMinor: 10000, protectionShortfallMinor: 0, operatingFloorMinor: 5000, notes: [] },
    next7Days: { endDate: '2026-10-12', movements: [], requiredOutflowMinor: 0, lowestCashMinor: null, lowestCashDate: null, firstShortfallDate: null, undatedPayrollMinor: 0, notes: [] },
    moneyStates: { availableMinor: 15000,
      collectible: [moneyItem('c1', 'collectible', 'Collectible Job', 120000, 'p-c')],
      unlockable: [moneyItem('u1', 'unlockable', 'Desert Willow', 90000, 'dw'), moneyItem('u2', 'unlockable', 'Mobile Home', 400000, 'mh')],
      potential: [moneyItem('p1', 'potential', '400A Panel Upgrade', 500000)],
      blocked: [moneyItem('b1', 'blocked', 'Surgery Center', null, 'ss')],
      totals: { collectible: { knownMinor: 120000, unknownCount: 0 }, unlockable: { knownMinor: 490000, unknownCount: 0 }, potential: { knownMinor: 500000, unknownCount: 0 }, blocked: { knownMinor: 0, unknownCount: 1 } },
      notCounted: [], settledProjectCount: 0 },
    risks: [
      risk('r-low', 'low', 'Low note'),
      risk('r-med1', 'medium', 'Medium one'),
      risk('r-high1', 'high', 'High one', { amountMinor: 39094, date: '2026-10-05', kind: 'cash_negative' }),
      risk('r-med2', 'medium', 'Medium two', { missing: ['whether it was paid'] }),
      risk('r-high2', 'high', 'High two'),
    ],
    actions: [
      action('a-watch', 'watch', 'Watch thing'),
      action('a-no', 'no_cash', 'Collect it', { order: 1, amount: { minor: 120000, meaning: 'collects' } }),
      action('a-work', 'owner_work', 'Do the work', { order: 1, resource: { cashMinor: 0, ownerWork: 'required' } }),
      action('a-cash', 'cash_required', 'Finish Mobile Home', { order: 1, resource: { cashMinor: 180000, ownerWork: 'required' }, amount: { minor: 400000, meaning: 'unlocks' }, related: { projectId: 'mh' }, certainty: 'needs_verification', missing: ['work time required'] }),
      action('a-prot', 'protection', 'Protect rent', { order: 1 }),
      action('a-wait', 'waiting', 'Waiting on trades', { order: 1 }),
      action('a-no2', 'no_cash', 'Second no-cash', { order: 2 }),
    ],
    dataGaps: ['GAP-ONE'], ...over }
}

describe('CASH-UX-3C2 command center', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })
  const render = async (node: JSX.Element) => { await act(async () => { root.render(node) }) }
  const click = async (el: Element | null | undefined) => { if (!el) throw new Error('missing element'); await act(async () => { (el as HTMLElement).click() }) }
  const text = () => host.textContent ?? ''
  const section = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement

  it('Outlook default flow no longer renders the old walls or the demoted detail components', () => {
    const s = snapshot()
    const html = renderToStaticMarkup(<CashOsOutlook snapshot={s} horizonDays={30} confidenceMode="conservative" onHorizon={vi.fn()} onConfidence={vi.fn()}
      afterGraph={<CashOsDecisionLayer snapshot={s} />} />)
    for (const old of ['Next 7 days', 'Watch out for', 'What you could do next', "Money that isn", 'Upcoming cash events', 'Collection Clock', 'money-plan-stub', 'Where you stand today'])
      expect(html, old).not.toContain(old)
    for (const label of ['Today', 'Needs attention', 'Money', 'Next']) expect(html).toContain(`aria-label="${label}"`)
    expect(html).not.toMatch(/best next move/i)
    expect(html).not.toContain('CASH REQUIRED')
  })

  describe('Today', () => {
    it('shows bills due today from existing markers, without changing the projection, and never assumes paid', async () => {
      const s = snapshot({ commitments: [commitment('c-today', 'Truck payment', '2026-10-05', 56000)] })
      const markers = (s.projection.anchor as any).markers
      expect(markers.some((m: any) => m.sourceKey.endsWith('c-today') && m.reason === 'overdue_unsettled')).toBe(true)
      expect(s.projection.datedEvents.some(e => e.sourceKey.endsWith('c-today'))).toBe(false) // projection untouched: still a marker
      const model = buildTodayModel(s)
      expect(model.due).toHaveLength(1)
      expect(model.due[0]).toMatchObject({ label: 'Truck payment', amountMinor: 56000, kind: 'bill', state: 'Due today · not marked paid' })
      expect(model.due[0].refs.sourceKey).toContain('c-today')
      await render(<CashOsDecisionLayer snapshot={s} />)
      const today = section('command-today')
      expect(today.textContent).toContain('Truck payment')
      expect(today.textContent).toContain('not marked paid')
      expect(today.textContent).not.toMatch(/\bpaid today\b/i)
      expect(today.textContent).not.toContain('No scheduled cash movement today.')
    })

    it('shows money received today only from posted ledger income', async () => {
      const s = snapshot({ extraTx: [tx('inc', 'bank', 95000, { transaction_kind: 'income', economic_effect: 'inflow', economic_amount_minor: 95000, counterparty: 'Desert Willow', source_type: 'manual' }),
        tx('trf', 'bank', 20000, { transaction_kind: 'transfer', source_type: 'manual' })] })
      const model = buildTodayModel(s)
      expect(model.received.map(r => r.amountMinor)).toEqual([95000])
      await render(<CashOsDecisionLayer snapshot={s} />)
      expect(section('command-today').textContent).toContain('Received today')
      expect(section('command-today').textContent).toContain('+$950.00')
    })

    it('shows a calm empty state when nothing is scheduled today', async () => {
      await render(<CashOsDecisionLayer snapshot={snapshot()} />)
      expect(section('command-today').textContent).toContain('No scheduled cash movement today.')
    })
  })

  describe('Needs attention', () => {
    it('keeps the decision layer severity, orders by it, and caps the default at three', async () => {
      const view = makeView()
      const rows = buildAttentionRows(view)
      expect(rows.map(r => r.severity)).toEqual(['high', 'high', 'medium', 'medium', 'low'])
      expect(rows.map(r => r.label)).toEqual(['HIGH', 'HIGH', 'CHECK', 'CHECK', 'NOTE'])
      await render(<CashOsDecisionView view={view} />)
      const shown = [...host.querySelectorAll('[data-testid="attention-row"]')]
      expect(shown).toHaveLength(3)
      expect(shown[0].querySelector('[data-severity="high"]')).not.toBeNull()
      // Level 1 shows triage info only.
      expect(text()).not.toContain('DETAIL-r-high1')
      expect(shown[0].textContent).toContain('$390.94')
      expect(shown[0].textContent).toContain('Today')
    })

    it('reaches the remaining items and opens the full explanation on tap', async () => {
      await render(<CashOsDecisionView view={makeView()} />)
      await click([...host.querySelectorAll('[data-testid="command-attention"] button')].find(b => b.textContent === 'Show 2 more'))
      expect(host.querySelectorAll('[data-testid="attention-row"]')).toHaveLength(5)
      const medium = [...host.querySelectorAll('[data-testid="attention-row"]')].find(r => r.textContent?.includes('Medium two'))!
      const button = medium.querySelector('button[aria-expanded]') as HTMLElement
      expect(button.getAttribute('aria-expanded')).toBe('false')
      await click(button)
      expect(button.getAttribute('aria-expanded')).toBe('true')
      expect(medium.textContent).toContain('DETAIL-r-med2')
      expect(medium.textContent).toContain('whether it was paid')
      await click(button)
      expect(medium.textContent).not.toContain('DETAIL-r-med2')
    })

    it('carries stable identifiers for later graph linking', async () => {
      const view = makeView({ risks: [risk('overdue:org:cash_commitment:c1', 'medium', 'Truck', { related: { sourceKey: 'org:cash_commitment:c1', accountId: 'a1' }, date: '2026-10-01' })] })
      await render(<CashOsDecisionView view={view} />)
      const row = host.querySelector('[data-testid="attention-row"]')!
      expect(row.getAttribute('data-source-key')).toBe('org:cash_commitment:c1')
      expect(row.getAttribute('data-account-id')).toBe('a1')
    })
  })

  describe('Money', () => {
    it('keeps the four money states distinct and never adds them to cash', async () => {
      const view = makeView()
      await render(<CashOsDecisionView view={view} />)
      await click([...host.querySelectorAll('[data-testid="command-money"] button')].find(b => /^Show \d+ more$/.test(b.textContent ?? '')))
      const states = [...host.querySelectorAll('[data-testid="money-row"] [data-money-state]')].map(e => e.getAttribute('data-money-state'))
      expect(new Set(states)).toEqual(new Set(['collectible', 'unlockable', 'potential', 'blocked']))
      const money = section('command-money').textContent ?? ''
      for (const label of ['COLLECTIBLE', 'UNLOCKABLE', 'POTENTIAL', 'BLOCKED']) expect(money).toContain(label)
      expect(money).toContain('None of this is in your cash total')
      expect(money).toContain('Amount unknown')
      expect(view.moneyStates.availableMinor).toBe(15000) // untouched by presentation
      expect(buildMoneyRows(view).every(r => r.state !== undefined)).toBe(true)
    })

    it('shows cash required as a constraint on the money row, not as a module', async () => {
      const view = makeView()
      const mobile = buildMoneyRows(view).find(r => r.label === 'Mobile Home')!
      expect(mobile.requiresMinor).toBe(180000)
      await render(<CashOsDecisionView view={view} />)
      const row = [...host.querySelectorAll('[data-testid="money-row"]')].find(r => r.textContent?.includes('Mobile Home'))!
      expect(row.textContent).toContain('Requires $1,800.00')
      expect(row.textContent).toContain('UNLOCKABLE')
      expect([...host.querySelectorAll('section[data-testid^="command-"]')].map(e => e.getAttribute('data-testid')).filter(id => id !== 'command-center'))
        .toEqual(['command-today', 'command-attention', 'command-money', 'command-next'])
      expect(text()).not.toContain('CASH REQUIRED')
      expect(text().toLowerCase()).not.toContain('profit')
    })

    it('opens the job editor from an expanded row', async () => {
      const s = snapshot()
      const editor = { factsFor: () => null, spendFor: () => [], onSaved: vi.fn() }
      await render(<CashOsDecisionView view={makeView()} snapshot={s} editor={editor} />)
      const row = [...host.querySelectorAll('[data-testid="money-row"]')].find(r => r.textContent?.includes('Desert Willow'))!
      await click(row.querySelector('button[aria-expanded]'))
      await click([...row.querySelectorAll('button')].find(b => b.textContent === 'Tell Cash OS about this job'))
      expect(host.querySelector('[data-testid="project-facts-editor"]')).not.toBeNull()
    })
  })

  describe('Next', () => {
    it('folds cash_required into WORK, never universal ranking, top action per group', async () => {
      const view = makeView()
      const { top, rest } = buildNextRows(view)
      expect(top.map(r => r.group)).toEqual(['no_cash', 'work', 'protect', 'waiting', 'watch'])
      expect(top.map(r => r.action.id)).toEqual(['a-no', 'a-work', 'a-prot', 'a-wait', 'a-watch'])
      expect(rest.map(r => r.action.id)).toEqual(['a-no2', 'a-cash'].sort((a, b) => rest.findIndex(r => r.action.id === a) - rest.findIndex(r => r.action.id === b)))
      expect(rest.some(r => r.action.id === 'a-cash' && r.group === 'work' && r.requiresMinor === 180000)).toBe(true)
      await render(<CashOsDecisionView view={view} />)
      expect(section('command-next').textContent).not.toMatch(/best next move/i)
      expect(section('command-next').textContent).not.toContain('CASH REQUIRED')
      expect([...host.querySelectorAll('[data-testid="next-row"] [data-next-group]')].map(e => e.getAttribute('data-next-group'))).toEqual(['no_cash', 'work', 'protect', 'waiting', 'watch'])
      await click([...host.querySelectorAll('[data-testid="command-next"] button')].find(b => b.textContent === 'Show 2 more'))
      const cash = [...host.querySelectorAll('[data-testid="next-row"]')].find(r => r.textContent?.includes('Finish Mobile Home'))!
      expect(cash.querySelector('[data-next-group="work"]')).not.toBeNull()
      expect(cash.textContent).toContain('Requires $1,800.00')
      expect(cash.textContent).toContain('Could unlock $4,000.00')
      expect(cash.textContent).toContain('Check first')
      await click(cash.querySelector('button[aria-expanded]'))
      expect(cash.textContent).toContain('WHY-a-cash')
      expect(cash.textContent).toContain('work time required')
    })
  })

  it('segmented control switches the focused section on narrow screens', async () => {
    await render(<CashOsDecisionView view={makeView()} />)
    const segs = [...host.querySelectorAll('[data-testid="command-segments"] button')]
    expect(segs.map(b => b.textContent)).toEqual(['Today', 'Attention', 'Money', 'Next'])
    expect(segs[0].getAttribute('aria-pressed')).toBe('true')
    await click(segs[2])
    expect(segs[2].getAttribute('aria-pressed')).toBe('true')
    expect(segs[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('withheld (partial) state still explains itself and keeps the sections available', async () => {
    await render(<CashOsDecisionLayer snapshot={snapshot()} partial />)
    expect(text()).toContain('Cash totals are being held back')
    expect(section('command-today').textContent).toContain('Held back with the cash totals.')
    expect(host.querySelector('[data-testid="command-center"]')).not.toBeNull()
  })

  it('keeps the full data gaps list reachable, collapsed by default', async () => {
    await render(<CashOsDecisionView view={makeView()} />)
    const details = host.querySelector('[data-testid="decision-data-gaps"]') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('GAP-ONE')
  })

  describe('Details access and status info', () => {
    it('reaches deeper tabs and Money Plan on demand, not by default', async () => {
      const s = snapshot()
      const onNavigate = vi.fn()
      await render(<CashOsOutlook snapshot={s} horizonDays={30} confidenceMode="conservative" onHorizon={vi.fn()} onConfidence={vi.fn()} onNavigate={onNavigate} />)
      expect(host.querySelector('[data-testid="money-plan-stub"]')).toBeNull()
      expect(host.querySelector('[data-testid="details-link-calendar"]')).toBeNull()
      await click(host.querySelector('[data-testid="details-access"] button[aria-expanded]'))
      await click(host.querySelector('[data-testid="details-link-calendar"]'))
      expect(onNavigate).toHaveBeenCalledWith('Calendar')
      for (const tab of ['projects', 'payroll', 'transactions', 'obligations', 'debt-plan']) expect(host.querySelector(`[data-testid="details-link-${tab}"]`), tab).not.toBeNull()
      await click([...host.querySelectorAll('[data-testid="details-access"] button')].find(b => /Money Plan/.test(b.textContent ?? '')))
      expect(host.querySelector('[data-testid="money-plan-stub"]')).not.toBeNull()
    })

    it('keeps the operating-floor explanation behind an info control', async () => {
      const s = snapshot()
      await render(<CashOsOutlook snapshot={s} horizonDays={30} confidenceMode="conservative" onHorizon={vi.fn()} onConfidence={vi.fn()} />)
      expect(text()).not.toContain('operating floor')
      const button = host.querySelector('[data-testid="cash-status-info-button"]') as HTMLElement
      expect(button.getAttribute('aria-expanded')).toBe('false')
      await click(button)
      expect(button.getAttribute('aria-expanded')).toBe('true')
      expect(host.querySelector('[data-testid="cash-status-info"]')?.textContent).toContain('operating floor of $50.00')
      expect(host.querySelector('[data-testid="cash-status-info"]')?.textContent).toContain('not part of these numbers')
    })

    it('status colors follow the actual state, not the card identity', () => {
      const html = renderToStaticMarkup(<CashOsOutlook snapshot={snapshot({ opening: -10300 })} horizonDays={30} confidenceMode="conservative" onHorizon={vi.fn()} onConfidence={vi.fn()} />)
      expect(html).toMatch(/data-testid="cash-status-cash" data-tone="negative"/)
      expect(html).toContain('Below zero')
    })
  })
})
