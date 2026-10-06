// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import CashOsOutlook, { CashDayDetail } from './CashOsOutlook'
import CashOsDecisionLayer from './CashOsDecisionLayer'
import { buildStatusCards } from './CashStatusRow'
import { buildCashOsSnapshot } from '@/finance/cashOsSnapshot'
import { money } from './cashOsUi'
import type { BackupData } from '@/services/backupDataService'

// Money Plan reads Supabase on mount; it is unchanged and out of scope for this slice.
vi.mock('./CashMoneyPlan', () => ({ default: () => <div data-testid="money-plan-stub">money plan</div> }))

const ORG = 'org-1'
const account = (id: string, over: Record<string, unknown> = {}) => ({ id, organization_id: ORG, display_name: id,
  account_type: 'checking', account_class: 'asset', ownership_context: 'business', include_in_cash: true, currency: 'USD',
  status: 'active', source_type: 'manual', source_metadata: {}, created_at: '', updated_at: '', archived_at: null, ...over })
const tx = (id: string, accountId: string, amount: number) => ({ id, organization_id: ORG, account_id: accountId,
  amount_minor: amount, currency: 'USD', transaction_date: '2026-10-05', effective_at: null, posted_at: null, status: 'posted',
  transaction_kind: 'opening_balance', economic_effect: 'none', economic_amount_minor: 0, description: id, counterparty: null,
  category: null, project_id: null, employee_id: null, debt_account_id: null, source_type: 'opening_balance',
  source_organization_id: null, source_kind: null, source_record_id: null, source_effective_date: null, source_timestamp: null,
  source_metadata: {}, idempotency_key: id, created_at: '', updated_at: '', voided_at: null, voided_by: null, void_reason: null })

function snapshot() {
  return buildCashOsSnapshot({ organizationId: ORG, asOfDate: '2026-10-05', asOfTimestamp: '2026-10-05T20:00:00Z',
    accounts: [account('bank'), account('care', { display_name: 'CareCredit', account_class: 'liability', account_type: 'credit_card', include_in_cash: false })] as any,
    transactions: [tx('o1', 'bank', 15000), tx('o2', 'care', 341905)] as any,
    obligations: [], occurrences: [], commitments: [], timeEntries: [], sessions: [], bridges: [], employees: [],
    liabilityTerms: [{ id: 't', organization_id: ORG, account_id: 'care', debt_structure: 'revolving', apr_basis_points: 3299,
      promo_apr_basis_points: 0, promo_type: 'deferred_interest', promo_started_on: null, promo_expires_on: '2026-12-22',
      minimum_payment_minor: 11300, payment_due_day: null, next_due_date: null, scheduled_payment_minor: null,
      original_principal_minor: null, maturity_date: null, owner_notes: null, created_at: '', updated_at: '' }] as any,
    backup: { settings: {}, employees: [], logs: [{ id: 'l', projId: 'dw', date: '2026-09-01', collected: 2050 }],
      projects: [{ id: 'dw', name: 'Desert Willow', type: 'project', status: 'active', contract: 3000, billed: 0, paid: 0, phase_timeline: [] }] } as unknown as BackupData,
    setup: { version: 1, organizationId: ORG, payrollPaidThroughDate: '2026-10-04', protectionHorizonDays: 14, operatingFloorMinor: 5000,
      taxReserve: { kind: 'disabled' }, includeOptionalObligations: false, includeOpenShiftEstimates: false, timezoneConfirmed: true,
      confirmedAt: '2026-10-05T20:00:00Z' }, horizonDays: 30, confidenceMode: 'conservative' })
}

function outlook(s = snapshot()) {
  return <CashOsOutlook snapshot={s} horizonDays={30} confidenceMode="conservative" onHorizon={vi.fn()} onConfidence={vi.fn()}
    afterGraph={<CashOsDecisionLayer snapshot={s} />} />
}

describe('CASH-UX-3C1 Outlook foundation', () => {
  it('renders exactly one primary cash-status presentation with the four labels in order', () => {
    const html = renderToStaticMarkup(outlook())
    expect((html.match(/data-testid="cash-status-row"/g) ?? []).length).toBe(1)
    const order = ['CASH I HAVE', 'SET ASIDE FOR BILLS', 'FREE TO USE', 'SHORT'].map(label => html.indexOf(label))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    for (const retired of ['TOTAL CASH', 'TRULY FREE', 'Where you stand today', 'Short of what']) expect(html).not.toContain(retired)
    for (const cardId of ['cash', 'set-aside', 'free', 'short']) expect(html).toContain(`data-testid="cash-status-${cardId}"`)
  })

  it('status values come from the existing projection anchor / allocation, unchanged', () => {
    const s = snapshot()
    const html = renderToStaticMarkup(outlook(s))
    const a = s.projection.anchor
    const cards = buildStatusCards({ cashMinor: a.closingCashMinor, protectedMinor: a.protectedCashMinor, freeMinor: a.trulyFreeCashMinor, shortMinor: a.protectionDeficitMinor })
    expect(cards.map(c => c.value)).toEqual([a.closingCashMinor, a.protectedCashMinor, a.trulyFreeCashMinor, a.protectionDeficitMinor])
    // Same numbers the allocation engine produced (what the old decision-layer tiles used).
    expect(a.closingCashMinor).toBe(s.allocation.totalCashMinor)
    expect(a.protectedCashMinor).toBe(s.allocation.protectedCashMinor)
    expect(a.trulyFreeCashMinor).toBe(s.allocation.trulyFreeCashMinor)
    expect(a.protectionDeficitMinor).toBe(s.allocation.uncoveredProtectionDeficitMinor)
    expect(html).toContain(money(a.closingCashMinor))
  })

  it('cards stay equal in size and state is carried by words and icons, not color alone', () => {
    const none = buildStatusCards({ cashMinor: 15000, protectedMinor: 5000, freeMinor: 10000, shortMinor: 0 })
    expect(none.find(c => c.id === 'short')).toMatchObject({ tone: 'neutral', state: 'Nothing short', icon: 'ok' })
    const short = buildStatusCards({ cashMinor: 1000, protectedMinor: 1000, freeMinor: 0, shortMinor: 4000 })
    expect(short.find(c => c.id === 'short')).toMatchObject({ tone: 'negative', state: 'Short', icon: 'alert' })
    expect(short.find(c => c.id === 'free')).toMatchObject({ tone: 'neutral', state: 'None free' })
    expect(buildStatusCards({ cashMinor: -500, protectedMinor: 0, freeMinor: 0, shortMinor: 0 })[0]).toMatchObject({ tone: 'negative', state: 'Below zero' })
    const html = renderToStaticMarkup(outlook())
    expect(html).not.toContain('text-3xl') // Free to Use is no longer enlarged
    expect((html.match(/min-h-\[8\.5rem\]/g) ?? []).length).toBe(4)
  })

  it('places the graph right after the status row, with the day detail attached and decision intelligence below', () => {
    const html = renderToStaticMarkup(outlook())
    const at = (needle: string) => { const i = html.indexOf(needle); expect(i).toBeGreaterThanOrEqual(0); return i }
    const status = at('data-testid="cash-status-row"')
    const graph = at('Forward cash trajectory')
    const detail = at('data-testid="day-detail"')
    const decision = at('data-testid="cash-decision-layer"')
    const details = at('data-testid="details-access"')
    expect(status).toBeLessThan(graph)
    expect(graph).toBeLessThan(detail)
    expect(detail).toBeLessThan(decision)
    expect(decision).toBeLessThan(details)
    expect(html).not.toContain('money-plan-stub')
    expect(html).not.toContain('Collection Clock')
    expect((html.match(/data-testid="day-detail"/g) ?? []).length).toBe(1)
    // Nothing from the decision layer sits between the status row and the graph.
    expect(html.slice(status, graph)).not.toContain('command-center')
  })

  it('keeps 14-day low and days covered as secondary graph metrics', () => {
    const s = snapshot()
    const html = renderToStaticMarkup(outlook(s))
    const chip = html.slice(html.indexOf('data-testid="graph-secondary-metrics"'))
    expect(chip).toContain('14-DAY LOW')
    expect(chip).toContain(money(s.projection.summary.fourteenDayLowestTotalCashMinor))
    expect(chip).toContain('DAYS COVERED')
    const c = s.projection.summary.daysCovered
    expect(chip).toContain(`${c.days}${c.bounded ? '+' : ''} days`)
    expect(html.indexOf('14-DAY LOW')).toBeGreaterThan(html.indexOf('Forward cash trajectory'))
  })

  it('keeps the decision intelligence below the graph as the compact command center', () => {
    const html = renderToStaticMarkup(outlook())
    expect(html).toContain('data-testid="command-center"')
    expect(html.indexOf('data-testid="command-center"')).toBeGreaterThan(html.indexOf('data-testid="graph-and-day"'))
    expect(html).toContain('data-testid="decision-data-gaps"')
  })

  describe('selected day', () => {
    let host: HTMLDivElement
    let root: Root
    beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
    afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

    it('day buttons change the adjacent detail without hover', async () => {
      const s = snapshot()
      await act(async () => { root.render(outlook(s)) })
      const detail = () => host.querySelector('[data-testid="day-detail"]')!.getAttribute('data-date')
      expect(detail()).toBe(s.asOfDate)
      const next = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Next day'))!
      await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(detail()).toBe(s.projection.days[0].date)
      expect(host.querySelector('[data-testid="graph-selected-date"]')?.textContent).toBeTruthy()
      const prev = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Previous day'))!
      await act(async () => { prev.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(detail()).toBe(s.asOfDate)
      expect((prev as HTMLButtonElement).disabled).toBe(true)
    })
  })

  it('shows a day as Opening → events → net → closing with no implied order', () => {
    const day: any = { date: '2026-10-14', openingCashMinor: 90000, inflowMinor: 0, outflowMinor: 67300, closingCashMinor: 22700,
      totalProtectedRequirementMinor: 0, protectedCashMinor: 0, trulyFreeCashMinor: 22700, protectionDeficitMinor: 0, operatingFloorMinor: 0,
      events: [
        { sourceKey: 'a', label: 'Truck payment', direction: 'outflow', amountMinor: 56000, category: 'debt', confidence: 'confirmed', attribution: {} },
        { sourceKey: 'b', label: 'CareCredit', direction: 'outflow', amountMinor: 11300, category: 'debt', confidence: 'confirmed', attribution: {} },
      ], markers: [], uncertainty: {} }
    const html = renderToStaticMarkup(<CashDayDetail day={day} />)
    const idx = ['Opening', 'Events', 'Net movement', 'Closing'].map(t => html.indexOf(t))
    expect(idx.every(i => i >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    expect(html).toContain('−$673.00')
    expect(html).toContain('No time of day is recorded, so no order is implied')
  })

  it('partial/withheld decision layer still explains itself with its own status card', () => {
    const html = renderToStaticMarkup(<CashOsDecisionLayer snapshot={snapshot()} partial />)
    expect(html).toContain('Cash totals are being held back')
  })
})
