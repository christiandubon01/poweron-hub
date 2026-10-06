// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cloneElement, isValidElement, useState, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('./CashMoneyPlan', () => ({ default: () => <div data-testid="money-plan-stub" /> }))
// Give the chart a real size so recharts renders its SVG in the test environment.
vi.mock('recharts', async importOriginal => {
  const original = await importOriginal<typeof import('recharts')>()
  return { ...original, ResponsiveContainer: ({ children }: { children: ReactElement }) => (isValidElement(children) ? cloneElement(children as ReactElement<any>, { width: 900, height: 310 }) : null) }
})

import CashOsOutlook, { CashDayDetail } from './CashOsOutlook'
import CashOsDecisionLayer from './CashOsDecisionLayer'
import { buildTimeline, selectionEmphasis, eventKindLabel, markerExplanation } from './cashTimelineModel'
import { planWalkthrough, walkthroughPacing, useCashFlowWalkthrough, type WalkStop } from './useCashFlowWalkthrough'
import { buildCashOsSnapshot } from '@/finance/cashOsSnapshot'
import type { CashCommitment } from '@/finance/obligationsTypes'
import type { BackupData } from '@/services/backupDataService'

const ORG = 'org-1'
const AS_OF = '2026-10-05'
const stops = (n: number): WalkStop[] => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, frac: (i + 1) / (n + 1), date: `d${i}` }))

describe('A. range-aware walkthrough timing', () => {
  it('1-3: 7d / 14d / 30d keep the approved timing exactly (and equal the default)', () => {
    // Reference values of the policy the owner approved (3 stops and 8 stops).
    for (const horizon of [7, 14, 30]) {
      expect(planWalkthrough(stops(3), horizon).totalMs, `${horizon}d n=3`).toBe(5900)
      expect(planWalkthrough(stops(8), horizon).totalMs, `${horizon}d n=8`).toBe(6200)
      expect(planWalkthrough(stops(5), horizon)).toEqual(planWalkthrough(stops(5)))
      expect(walkthroughPacing(horizon)).toEqual({ travel: 1, target: 1 })
    }
  })

  it('4: 60d is modestly slower than the 30d behavior', () => {
    for (const n of [3, 8]) {
      const base = planWalkthrough(stops(n), 30).totalMs
      const sixty = planWalkthrough(stops(n), 60).totalMs
      expect(sixty / base, `n=${n}`).toBeGreaterThan(1.05)
      expect(sixty / base, `n=${n}`).toBeLessThan(1.4)
    }
  })

  it('5: 90d is meaningfully slower than both 30d and 60d', () => {
    for (const n of [3, 8]) {
      const base = planWalkthrough(stops(n), 30).totalMs
      const sixty = planWalkthrough(stops(n), 60).totalMs
      const ninety = planWalkthrough(stops(n), 90).totalMs
      expect(ninety / base, `n=${n}`).toBeGreaterThanOrEqual(1.45)
      expect(ninety / sixty, `n=${n}`).toBeGreaterThan(1.2)
    }
    expect([30, 60, 90].map(h => planWalkthrough(stops(8), h).totalMs)).toEqual([6200, 7752, 12400])
  })

  it('6: dense event sets stay bounded and compress locally in every window', () => {
    expect(planWalkthrough(stops(30), 30).totalMs).toBeLessThan(8500)
    expect(planWalkthrough(stops(30), 60).totalMs).toBeLessThan(10500)
    expect(planWalkthrough(stops(30), 90).totalMs).toBeLessThan(13000)
  })

  it('7: sparse stretches never create dead pauses (the pulse moves continuously between stops)', () => {
    const sparse: WalkStop[] = [{ id: 'a', frac: 0.1, date: 'a' }, { id: 'b', frac: 0.95, date: 'b' }]
    const { steps, totalMs } = planWalkthrough(sparse, 90)
    expect(totalMs).toBeLessThan(12000)
    const leaves = steps.filter(s => s.kind === 'leave').map(s => s.at)
    const moves = steps.filter(s => s.kind === 'move').map(s => s.at)
    expect(moves[1]).toBe(leaves[0]) // the next leg starts the instant the previous dwell ends
    // Dwell is bounded, so a long gap is travel, not waiting.
    const arrive = steps.filter(s => s.kind === 'arrive').map(s => s.at)
    expect(leaves[0] - arrive[0]).toBeLessThanOrEqual(900)
  })

  describe('hook uses the window', () => {
    let host: HTMLDivElement
    let root: Root
    let api: ReturnType<typeof useCashFlowWalkthrough>
    function Harness({ horizon }: { horizon: number }) {
      api = useCashFlowWalkthrough({ stops: stops(3), enabled: true, storageKey: `k${horizon}`, horizonDays: horizon })
      const [, force] = useState(0)
      return <button data-testid="x" data-phase={api.phase} onClick={() => force(n => n + 1)} />
    }
    beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); sessionStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
    afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.useRealTimers(); delete (window as any).matchMedia })
    const phase = () => host.querySelector('[data-testid="x"]')!.getAttribute('data-phase')

    it('30d finishes on the approved schedule while 90d is still running', async () => {
      await act(async () => { root.render(<Harness horizon={30} />) })
      await act(async () => { vi.advanceTimersByTime(5800) }); expect(phase()).toBe('running')
      await act(async () => { vi.advanceTimersByTime(200) }); expect(phase()).toBe('done')
      await act(async () => { root.unmount() }); sessionStorage.clear(); root = createRoot(host)
      await act(async () => { root.render(<Harness horizon={90} />) })
      await act(async () => { vi.advanceTimersByTime(6000) }); expect(phase()).toBe('running')
      await act(async () => { vi.advanceTimersByTime(3000) }); expect(phase()).toBe('done')
    })

    it('8/9: owner interaction still cancels, and replay still works, at 90d', async () => {
      await act(async () => { root.render(<Harness horizon={90} />) })
      await act(async () => { vi.advanceTimersByTime(3000) }); expect(phase()).toBe('running')
      await act(async () => { api.cancel() }); expect(phase()).toBe('done'); expect(vi.getTimerCount()).toBe(0)
      await act(async () => { api.start() }); await act(async () => { vi.advanceTimersByTime(10) }); expect(phase()).toBe('running')
    })

    it('10: reduced motion is unchanged: no auto-run, no replay', async () => {
      ;(window as any).matchMedia = (q: string) => ({ matches: /reduce/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {} })
      await act(async () => { root.render(<Harness horizon={90} />) })
      await act(async () => { vi.advanceTimersByTime(30000) }); expect(phase()).toBe('idle')
      await act(async () => { api.start() }); expect(phase()).toBe('idle')
    })
  })
})

// ── integrated fixtures: ordinary obligations shaped like QuickBooks (small) and Phone Bills (larger) ──
const account = (id: string) => ({ id, organization_id: ORG, display_name: id, account_type: 'checking', account_class: 'asset', ownership_context: 'business',
  include_in_cash: true, currency: 'USD', status: 'active', source_type: 'manual', source_metadata: {}, created_at: '', updated_at: '', archived_at: null })
const tx = (id: string, amount: number, over: Record<string, unknown> = {}) => ({ id, organization_id: ORG, account_id: 'bank', amount_minor: amount, currency: 'USD',
  transaction_date: AS_OF, effective_at: null, posted_at: null, status: 'posted', transaction_kind: 'opening_balance', economic_effect: 'none', economic_amount_minor: 0,
  description: id, counterparty: null, category: null, project_id: null, employee_id: null, debt_account_id: null, source_type: 'opening_balance', source_organization_id: null,
  source_kind: null, source_record_id: null, source_effective_date: null, source_timestamp: null, source_metadata: {}, idempotency_key: id, created_at: '', updated_at: '',
  voided_at: null, voided_by: null, void_reason: null, ...over })
const commitment = (id: string, title: string, date: string, minor: number, category: string | null = null): CashCommitment => ({ id, organizationId: ORG, title, expectedDate: date,
  amount: { currency: 'USD', minor }, amountCertainty: 'fixed', requirement: 'required', confidence: 'confirmed', status: 'scheduled', sourceType: 'manual', category,
  reconciliationState: 'unreconciled', provenance: { source: { organizationId: ORG, kind: 'cash_commitment', recordId: id }, freshness: 'current',
    confidence: 'confirmed', reconciliationState: 'unreconciled' } } as any)

function snapshot() {
  return buildCashOsSnapshot({ organizationId: ORG, asOfDate: AS_OF, asOfTimestamp: `${AS_OF}T20:00:00Z`,
    accounts: [account('bank')] as any,
    transactions: [tx('o', 500000), tx('inc', 95000, { transaction_date: '2026-10-20', transaction_kind: 'income', economic_effect: 'inflow', economic_amount_minor: 95000, source_type: 'manual', description: 'Deposit' })] as any,
    obligations: [], occurrences: [],
    commitments: [commitment('c-today', 'Rent', AS_OF, 30000), commitment('qb', 'QuickBooks', '2026-10-09', 3800, 'Software'), commitment('phone', 'Phone Bills', '2026-10-12', 18500, 'Phone'),
      commitment('truck', 'Truck payment', '2026-10-14', 56000), commitment('care', 'CareCredit', '2026-10-14', 11300)],
    timeEntries: [], sessions: [], bridges: [], employees: [], liabilityTerms: [], projectFacts: [],
    backup: { settings: {}, employees: [], logs: [], projects: [] } as unknown as BackupData,
    setup: { version: 1, organizationId: ORG, payrollPaidThroughDate: '2026-10-04', protectionHorizonDays: 14, operatingFloorMinor: 5000, taxReserve: { kind: 'disabled' },
      includeOptionalObligations: false, includeOpenShiftEstimates: false, timezoneConfirmed: true, confirmedAt: `${AS_OF}T20:00:00Z` }, horizonDays: 30, confidenceMode: 'conservative' })
}

describe('B-J. marker redesign, consistent selection, clean inspector', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); sessionStorage.setItem(`poweron:cash-os-flow-walkthrough:${ORG}`, '1'); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); sessionStorage.clear() })
  const render = async (s = snapshot()) => act(async () => {
    root.render(<CashOsOutlook snapshot={s} horizonDays={30} confidenceMode="conservative" onHorizon={vi.fn()} onConfidence={vi.fn()}
      afterGraph={link => <CashOsDecisionLayer snapshot={s} graphLink={link} />} />)
  })
  const click = async (el: Element | null | undefined) => { if (!el) throw new Error('missing element'); await act(async () => { (el as HTMLElement).click() }) }
  const markerOn = (date: string) => host.querySelector(`[data-testid="timeline-marker"][data-date="${date}"]`) as HTMLElement
  const detail = () => host.querySelector('[data-testid="day-detail"]') as HTMLElement

  it('11/12: money in and money out use compact signed capsules, not outlined triangles', async () => {
    await render()
    const out = markerOn('2026-10-12'), inn = markerOn('2026-10-20')
    expect(out.getAttribute('data-marker-style')).toBe('capsule')
    const outCap = out.querySelector('[data-testid="timeline-capsule"],[data-testid="timeline-node"]')!
    const inCap = inn.querySelector('[data-testid="timeline-capsule"],[data-testid="timeline-node"]')!
    expect(outCap.getAttribute('data-kind')).toBe('out'); expect(inCap.getAttribute('data-kind')).toBe('in')
    if (out.getAttribute('data-resting') === 'amount') expect(outCap.textContent).toBe('−$185')
    if (inn.getAttribute('data-resting') === 'amount') expect(inCap.textContent).toBe('+$950')
    for (const m of [out, inn]) expect(m.querySelector('svg')).toBeNull() // no triangle glyphs on the graph
    expect(out.getAttribute('aria-label')).toContain('money out $185.00')
  })

  it('13: an unresolved marker is a distinct amber node, never a money capsule', async () => {
    await render()
    const today = markerOn(AS_OF)
    expect(today.getAttribute('data-state')).toBe('uncertain')
    expect(today.querySelector('[data-testid="timeline-uncertain"]')).not.toBeNull()
    expect(today.querySelector('[data-testid="timeline-capsule"]')).toBeNull()
    expect(today.querySelector('[data-testid="timeline-node"]')).toBeNull()
    await click(today)
    expect(today.querySelector('[data-testid="timeline-selected-card"]')?.getAttribute('data-kind')).toBe('unresolved')
  })

  it('14: the practical touch target is preserved (44px wide, 88px tall) around the compact visual', async () => {
    await render()
    const cls = markerOn('2026-10-12').className
    expect(cls).toContain('w-11'); expect(cls).toContain('h-[88px]')
  })

  it('15-19/21-24: QuickBooks-shaped and Phone-Bills-shaped events get IDENTICAL selection treatment', async () => {
    const s = snapshot()
    await render(s)
    const rows = [s.projection.anchor, ...s.projection.days]
    const treatments: Array<Record<string, unknown>> = []
    for (const [date, name, signedAmount] of [['2026-10-09', 'QuickBooks', '−$38'], ['2026-10-12', 'Phone Bills', '−$185']] as const) {
      await click(markerOn(date))
      const marker = markerOn(date)
      const card = marker.querySelector('[data-testid="timeline-selected-card"]') as HTMLElement
      const chip = host.querySelector('[data-testid="timeline-event-chip"][aria-pressed="true"]') as HTMLElement
      const event = detail().querySelector('[data-testid="day-event"][data-selected]') as HTMLElement
      const emphasis = selectionEmphasis(rows, date)!
      // graph: expanded card with name, signed amount and state
      expect(card.textContent).toContain(name); expect(card.textContent).toContain(signedAmount); expect(card.textContent).toContain('Projected')
      // strip + inspector receive the selected event
      expect(chip.textContent).toContain(name)
      expect(detail().getAttribute('data-date')).toBe(date)
      expect(event.textContent).toContain(name); expect(event.textContent).toContain(signedAmount.replace('−$', '−$') + '.00')
      // cash impact: same day-level emphasis path for any amount
      expect(emphasis.direction).toBe('out'); expect(emphasis.prevDate).not.toBeNull()
      treatments.push({ marker: marker.hasAttribute('data-selected'), card: !!card, chip: !!chip, event: !!event, dir: emphasis.direction, hasPrev: emphasis.prevDate !== null,
        keys: Object.keys(emphasis).join(), kind: card.getAttribute('data-kind') })
    }
    expect(treatments[0]).toEqual(treatments[1])
  })

  it('17/18 (root-cause fix): the cash-impact emphasis is the SAME curve as Total Cash, for any amount', async () => {
    await render()
    for (const date of ['2026-10-09', '2026-10-12']) {
      await click(markerOn(date))
      const svg = host.querySelector('[data-testid="graph-plot"] svg')
      expect(svg, 'chart rendered').not.toBeNull()
      const gradient = svg!.querySelector('linearGradient#cashMoveGradient')
      expect(gradient).not.toBeNull()
      const offsets = [...gradient!.querySelectorAll('stop')].map(s => Number(s.getAttribute('offset')))
      const rows = [snapshot().projection.anchor, ...snapshot().projection.days]
      const idx = rows.findIndex(r => r.date === date)
      expect(offsets[2]).toBeCloseTo((idx - 1) / (rows.length - 1), 6)
      expect(offsets[3]).toBeCloseTo(idx / (rows.length - 1), 6)
      const paths = [...svg!.querySelectorAll('.recharts-line-curve, .recharts-area-curve')]
      const total = paths.find(p => p.getAttribute('stroke') === '#38bdf8')
      const move = paths.find(p => p.getAttribute('stroke') === 'url(#cashMoveGradient)')
      expect(total, 'total cash curve').toBeTruthy(); expect(move, 'move emphasis curve').toBeTruthy()
      expect(move!.getAttribute('d')).toBe(total!.getAttribute('d')) // follows the real curve, not a straight chord
      expect(svg!.querySelector('.recharts-reference-line-line')).not.toBeNull() // date guide
      expect(svg!.querySelectorAll('.recharts-reference-dot').length).toBeGreaterThan(0) // selected cash point
    }
  })

  it('20/21-24: the inspector is a clean financial inspector with no technical identifiers', async () => {
    await render()
    await click(markerOn('2026-10-12'))
    const text = detail().textContent ?? ''
    expect(text).toContain('Phone Bills'); expect(text).toContain('−$185.00'); expect(text).toContain('Projected')
    expect(text).toContain('One-time payment · Phone') // canonical sourceType + canonical category
    for (const technical of ['cash_commitment', 'financial_obligation', 'org-1:', 'sourceKey', 'Project ', 'phone']) expect(text, technical).not.toContain(technical)
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i)
    for (const label of ['Opening', 'Events', 'Day movement', 'Money in', 'Money out', 'Net movement', 'Closing', 'Protection', 'Required', 'Protected', 'Free', 'Deficit']) expect(text, label).toContain(label)
    expect(text).not.toContain('Unresolved') // only when relevant
    // Identity stays internal, on data attributes, for selection and linking.
    expect(detail().querySelector('[data-testid="day-event"]')!.getAttribute('data-source-key')).toContain('phone')
    // Nothing identifier-like is visible anywhere in the graph card or the command center either.
    const visible = (host.querySelector('[data-testid="graph-card-body"]')!.textContent ?? '') + (host.querySelector('[data-testid="command-center"]')!.textContent ?? '')
    expect(visible).not.toContain('org-1:cash_commitment')
  })

  it('unresolved items appear in the inspector only when relevant, in owner language', async () => {
    await render()
    await click(markerOn(AS_OF))
    const text = detail().textContent ?? ''
    expect(text).toContain('Unresolved')
    expect(text).toContain('Rent')
    expect(text).toContain('not marked paid')
    expect(text).toContain('no effect on projected cash')
    expect(text).not.toContain('overdue_unsettled')
  })

  it('26/27: same-day honesty and grouping are intact with the new markers', async () => {
    await render()
    const group = markerOn('2026-10-14')
    expect(group.getAttribute('aria-label')).toContain('2 cash events')
    expect(group.querySelector('[data-testid="timeline-count"]')?.textContent).toBe('2')
    await click(group)
    expect(group.querySelector('[data-testid="timeline-selected-card"]')?.textContent).toContain('2 events')
    expect(group.querySelector('[data-testid="timeline-selected-card"]')?.textContent).not.toContain('Truck')
    expect(detail().textContent).toContain('no order is implied')
    const chips = [...host.querySelectorAll('[data-testid="timeline-event-chip"]')]
    expect(chips).toHaveLength(2)
    await click(chips.find(c => c.textContent?.includes('CareCredit')))
    expect(detail().querySelector('[data-selected]')?.textContent).toContain('CareCredit')
  })

  it('30: building and rendering with the redesigned markers does not change the projection', async () => {
    const s = snapshot()
    const before = JSON.stringify(s.projection)
    buildTimeline(s.projection)
    await render(s)
    await click(markerOn('2026-10-12'))
    expect(JSON.stringify(s.projection)).toBe(before)
  })

  it('helpers map only canonical enums and reasons', () => {
    expect(eventKindLabel('cash_commitment')).toBe('One-time payment')
    expect(eventKindLabel('obligation_occurrence')).toBe('Recurring bill')
    expect(eventKindLabel('mystery')).toBeNull() // never invented
    expect(markerExplanation('overdue_unsettled')).toContain('not marked paid')
    expect(markerExplanation('unknown_payment_date')).toContain('Payment timing')
  })

  it('inspector hides context it does not have rather than inventing it', () => {
    const day: any = { date: '2026-10-12', openingCashMinor: 1000, inflowMinor: 0, outflowMinor: 500, closingCashMinor: 500, totalProtectedRequirementMinor: 0, protectedCashMinor: 0,
      trulyFreeCashMinor: 500, protectionDeficitMinor: 0, operatingFloorMinor: 0, markers: [],
      events: [{ sourceKey: 'org:mystery:abc', label: 'Mystery bill', direction: 'outflow', amountMinor: 500, category: null, confidence: 'confirmed', sourceType: 'mystery', movementBasis: 'planned_obligation', attribution: {} }] }
    const html = renderToStaticMarkup(<CashDayDetail day={day} />)
    expect(html).toContain('Mystery bill'); expect(html).toContain('−$5.00'); expect(html).toContain('Projected')
    const visibleText = html.replace(/<[^>]*>/g, ' ')
    expect(visibleText).not.toContain('org:mystery:abc')
    expect(html).toContain('data-source-key="org:mystery:abc"') // identity stays internal
    expect(html).not.toContain('Personal'); expect(html).not.toContain('Business')
  })
})
