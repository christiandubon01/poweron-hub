// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cloneElement, isValidElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const counters = vi.hoisted(() => ({ containerRenders: 0 }))
vi.mock('./CashMoneyPlan', () => ({ default: () => <div data-testid="money-plan-stub" /> }))
vi.mock('recharts', async importOriginal => {
  const original = await importOriginal<typeof import('recharts')>()
  return { ...original, ResponsiveContainer: ({ children }: { children: ReactElement }) => {
    counters.containerRenders += 1
    return isValidElement(children) ? cloneElement(children as ReactElement<any>, { width: 1000, height: 310 }) : null
  } }
})

import CashOsOutlook from './CashOsOutlook'
import CashOsDecisionLayer from './CashOsDecisionLayer'
import { fracFromClientX, inRange, normalizeRange, rangeFromIndices, snapIndex, summarizeRange } from './cashRangeModel'
import { buildTimeline } from './cashTimelineModel'
import { buildCashOsSnapshot } from '@/finance/cashOsSnapshot'
import type { CashCommitment } from '@/finance/obligationsTypes'
import type { BackupData } from '@/services/backupDataService'

const ORG = 'org-1'
const AS_OF = '2026-10-05'
const PLOT = { width: 1000, inset: { left: 86, right: 18 } }
const dayStr = (offset: number) => { const d = new Date(`${AS_OF}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10) }
const xFor = (index: number, count = 31) => PLOT.inset.left + ((PLOT.width - PLOT.inset.left - PLOT.inset.right) * index) / (count - 1)

const account = (id: string) => ({ id, organization_id: ORG, display_name: id, account_type: 'checking', account_class: 'asset', ownership_context: 'business',
  include_in_cash: true, currency: 'USD', status: 'active', source_type: 'manual', source_metadata: {}, created_at: '', updated_at: '', archived_at: null })
const tx = (id: string, amount: number, over: Record<string, unknown> = {}) => ({ id, organization_id: ORG, account_id: 'bank', amount_minor: amount, currency: 'USD',
  transaction_date: AS_OF, effective_at: null, posted_at: null, status: 'posted', transaction_kind: 'opening_balance', economic_effect: 'none', economic_amount_minor: 0,
  description: id, counterparty: null, category: null, project_id: null, employee_id: null, debt_account_id: null, source_type: 'opening_balance', source_organization_id: null,
  source_kind: null, source_record_id: null, source_effective_date: null, source_timestamp: null, source_metadata: {}, idempotency_key: id, created_at: '', updated_at: '',
  voided_at: null, voided_by: null, void_reason: null, ...over })
const commitment = (id: string, title: string, date: string, minor: number): CashCommitment => ({ id, organizationId: ORG, title, expectedDate: date,
  amount: { currency: 'USD', minor }, amountCertainty: 'fixed', requirement: 'required', confidence: 'confirmed', status: 'scheduled', sourceType: 'manual',
  reconciliationState: 'unreconciled', provenance: { source: { organizationId: ORG, kind: 'cash_commitment', recordId: id }, freshness: 'current',
    confidence: 'confirmed', reconciliationState: 'unreconciled' } } as any)

function snapshot() {
  return buildCashOsSnapshot({ organizationId: ORG, asOfDate: AS_OF, asOfTimestamp: `${AS_OF}T20:00:00Z`,
    accounts: [account('bank')] as any,
    transactions: [tx('o', 500000), tx('inc', 95000, { transaction_date: '2026-10-20', transaction_kind: 'income', economic_effect: 'inflow', economic_amount_minor: 95000, source_type: 'manual', description: 'Desert Willow deposit' })] as any,
    obligations: [], occurrences: [],
    commitments: [commitment('c-today', 'Rent', AS_OF, 30000), commitment('qb', 'QuickBooks', '2026-10-09', 3800), commitment('phone', 'Phone Bills', '2026-10-12', 18500),
      commitment('truck', 'Truck payment', '2026-10-14', 56000), commitment('care', 'CareCredit', '2026-10-14', 11300), commitment('ins', 'Business Insurance', '2026-10-18', 8225)],
    timeEntries: [], sessions: [], bridges: [], employees: [], liabilityTerms: [], projectFacts: [],
    backup: { settings: {}, employees: [], logs: [], projects: [] } as unknown as BackupData,
    setup: { version: 1, organizationId: ORG, payrollPaidThroughDate: '2026-10-04', protectionHorizonDays: 14, operatingFloorMinor: 5000, taxReserve: { kind: 'disabled' },
      includeOptionalObligations: false, includeOpenShiftEstimates: false, timezoneConfirmed: true, confirmedAt: `${AS_OF}T20:00:00Z` }, horizonDays: 30, confidenceMode: 'conservative' })
}

describe('range model (pure)', () => {
  const dates = Array.from({ length: 31 }, (_, i) => dayStr(i))
  it('2: pointer positions snap to the nearest graph date and clamp to the plot', () => {
    expect(snapIndex(0, 31)).toBe(0); expect(snapIndex(1, 31)).toBe(30)
    expect(snapIndex(0.5, 31)).toBe(15); expect(snapIndex(0.5 + 0.4 / 30, 31)).toBe(15); expect(snapIndex(0.5 + 0.6 / 30, 31)).toBe(16)
    expect(snapIndex(-3, 31)).toBe(0); expect(snapIndex(9, 31)).toBe(30)
    const rect = { left: 100, width: 1000 }
    expect(fracFromClientX(100, rect, PLOT.inset)).toBe(0) // left of the plot clamps
    expect(fracFromClientX(100 + 86, rect, PLOT.inset)).toBe(0)
    expect(fracFromClientX(100 + 1000 - 18, rect, PLOT.inset)).toBe(1)
    expect(fracFromClientX(5000, rect, PLOT.inset)).toBe(1)
  })
  it('3: start/end normalize regardless of drag direction', () => {
    expect(rangeFromIndices(dates, 20, 3)).toEqual(rangeFromIndices(dates, 3, 20))
    expect(normalizeRange(dates, dayStr(20), dayStr(3))).toEqual({ start: dayStr(3), end: dayStr(20) })
    expect(normalizeRange(dates, 'nope', dayStr(3))).toBeNull()
    expect(inRange(dayStr(5), { start: dayStr(3), end: dayStr(5) })).toBe(true)
    expect(inRange(dayStr(6), { start: dayStr(3), end: dayStr(5) })).toBe(false)
  })
  it('19/20: summary keeps states separate and never counts unresolved markers as cash', () => {
    let cash = 1000
    const row = (offset: number, inflow: number, outflow: number, events: any[] = [], markers: any[] = []) => { const opening = cash; cash = opening + inflow - outflow; return ({ date: dayStr(offset), openingCashMinor: opening, inflowMinor: inflow, outflowMinor: outflow,
      closingCashMinor: cash, totalProtectedRequirementMinor: 0, protectedCashMinor: 0, trulyFreeCashMinor: 0, protectionDeficitMinor: 0, operatingFloorMinor: 0, events, markers, uncertainty: {} }) as any }
    const ev = (key: string, offset: number, direction: 'inflow' | 'outflow', amount: number, over: any = {}) => ({ id: key, organizationId: ORG, date: dayStr(offset), direction, amountMinor: amount, confidence: 'confirmed',
      requirement: 'required', sourceKey: key, sourceType: 'cash_commitment', category: null, attribution: {}, label: key, movementBasis: 'cash_commitment', ...over })
    const rows = [row(0, 0, 0), row(1, 0, 100, [ev('a', 1, 'outflow', 100)]), row(2, 500, 0, [ev('p', 2, 'inflow', 500, { confidence: 'possible', movementBasis: 'project_collection' })],
      [{ sourceKey: 'm', organizationId: ORG, date: dayStr(2), amountMinor: 9999, reason: 'unknown_amount', label: 'Unknown', category: null, attribution: {} }])]
    const t = buildTimeline({ organizationId: ORG, asOfDate: dayStr(0), horizonDays: 7, confidenceMode: 'upside', anchor: rows[0], days: rows.slice(1) } as any)
    const s = summarizeRange(rows, t, { start: dayStr(0), end: dayStr(2) })!
    expect([s.moneyInMinor, s.moneyOutMinor, s.netMinor, s.eventCount]).toEqual([500, 100, 400, 2])
    expect(s.byState).toEqual({ posted: 0, projected: 1, possible: 1, pending: 0 })
    expect(s.unresolvedCount).toBe(1)
    expect(s.moneyInMinor + s.moneyOutMinor).toBe(600) // the 9,999 unresolved amount is nowhere in the totals
    expect(s.closingCashMinor - s.openingCashMinor).toBe(s.netMinor)
  })
})

describe('range selection on the graph', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    sessionStorage.setItem(`poweron:cash-os-flow-walkthrough:${ORG}`, '1') // walkthrough already played this session
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const w = this.getAttribute('data-testid') === 'graph-plot' ? PLOT.width : 0
      return { left: 0, top: 0, width: w, height: w ? 310 : 0, right: w, bottom: w ? 310 : 0, x: 0, y: 0, toJSON() {} } as DOMRect
    })
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); sessionStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); delete (window as any).matchMedia })

  const render = async (s = snapshot(), horizon: 7 | 14 | 30 | 60 | 90 = 30) => act(async () => {
    root.render(<CashOsOutlook snapshot={s} horizonDays={horizon} confidenceMode="conservative" onHorizon={vi.fn()} onConfidence={vi.fn()}
      afterGraph={link => <CashOsDecisionLayer snapshot={s} graphLink={link} />} />)
  })
  const plot = () => host.querySelector('[data-testid="graph-plot"]') as HTMLElement
  const ptr = (target: Element, type: string, clientX: number, extra: Record<string, unknown> = {}) => {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 100, button: 0 })
    for (const [k, v] of Object.entries(extra)) Object.defineProperty(ev, k, { value: v })
    return act(async () => { target.dispatchEvent(ev) })
  }
  const drag = async (fromIdx: number, toIdx: number, extra: Record<string, unknown> = {}) => {
    await ptr(plot(), 'pointerdown', xFor(fromIdx), extra)
    await ptr(plot(), 'pointermove', xFor((fromIdx + toIdx) / 2), extra)
    await ptr(plot(), 'pointermove', xFor(toIdx), extra)
    await ptr(plot(), 'pointerup', xFor(toIdx), extra)
  }
  const click = async (el: Element | null | undefined) => { if (!el) throw new Error('missing element'); await act(async () => { (el as HTMLElement).click() }) }
  const band = () => host.querySelector('[data-testid="range-band"]') as HTMLElement | null
  const summary = () => host.querySelector('[data-testid="range-summary"]') as HTMLElement | null
  const markerOn = (date: string) => host.querySelector(`[data-testid="timeline-marker"][data-date="${date}"]`) as HTMLElement
  const detailDate = () => host.querySelector('[data-testid="day-detail"]')!.getAttribute('data-date')
  const rowsOf = (s: ReturnType<typeof snapshot>) => [s.projection.anchor, ...s.projection.days]

  it('1/4: a desktop drag creates a date range that persists after release', async () => {
    await render()
    expect(band()).toBeNull(); expect(summary()).toBeNull() // no range: the clean approved graph
    await drag(3, 20)
    expect(band()!.getAttribute('data-start')).toBe('2026-10-08')
    expect(band()!.getAttribute('data-end')).toBe('2026-10-25')
    expect(plot().getAttribute('data-dragging')).toBeNull() // released
    expect(summary()!.querySelector('[data-testid="range-title"]')!.textContent).toContain('Oct 8 → Oct 25')
    await act(async () => { await Promise.resolve() })
    expect(band()).not.toBeNull() // persists
  })

  it('2: the drag snaps to graph dates even when the pointer is between them', async () => {
    await render()
    await ptr(plot(), 'pointerdown', xFor(3) + 6); await ptr(plot(), 'pointermove', xFor(19) + 9); await ptr(plot(), 'pointerup', xFor(19) + 9)
    expect([band()!.getAttribute('data-start'), band()!.getAttribute('data-end')]).toEqual(['2026-10-08', '2026-10-24'])
  })

  it('3: dragging right-to-left gives the same range', async () => {
    await render()
    await drag(20, 3)
    expect([band()!.getAttribute('data-start'), band()!.getAttribute('data-end')]).toEqual(['2026-10-08', '2026-10-25'])
  })

  it('a click without movement is not a range (normal date selection still works)', async () => {
    await render()
    await ptr(plot(), 'pointerdown', xFor(8)); await ptr(plot(), 'pointerup', xFor(8))
    expect(band()).toBeNull()
  })

  it('5: the range can be cleared', async () => {
    await render()
    await drag(3, 20)
    await click(host.querySelector('[data-testid="range-clear"]'))
    expect(band()).toBeNull(); expect(summary()).toBeNull()
    expect(host.querySelector('[data-testid="range-handle-start"]')).toBeNull()
  })

  it('6: changing the horizon clears the range deterministically', async () => {
    await render()
    await drag(3, 20)
    expect(band()).not.toBeNull()
    await render(snapshot(), 14)
    expect(band()).toBeNull(); expect(summary()).toBeNull()
  })

  it('7/29: the band and summary leave the approved graph height and width untouched', async () => {
    await render()
    const before = plot().className
    expect(before).toContain('h-[310px]'); expect(before).toContain('min-w-[500px]')
    await drag(3, 20)
    expect(plot().className).toContain('h-[310px]')
    expect(band()!.closest('[data-testid="graph-plot"]')).toBe(plot()) // drawn inside the plot, not added around it
  })

  it('8/10: markers inside the range are emphasized, outside ones stay visible but softer, selected is strongest', async () => {
    await render()
    await drag(3, 9) // Oct 8 .. Oct 14: Quick Books (9), Phone (12), the 14th pair
    expect(markerOn('2026-10-09').getAttribute('data-range')).toBe('inside')
    expect(markerOn('2026-10-14').getAttribute('data-range')).toBe('inside')
    const outside = markerOn('2026-10-20')
    expect(outside.getAttribute('data-range')).toBe('outside')
    expect(outside.style.opacity).toBe('0.45'); expect(outside.isConnected).toBe(true) // still visible
    expect(markerOn('2026-10-09').style.filter).toContain('drop-shadow')
    await click(markerOn('2026-10-12'))
    const selected = markerOn('2026-10-12')
    expect(selected.hasAttribute('data-selected')).toBe(true)
    expect(selected.querySelector('[data-testid="timeline-selected-card"]')).not.toBeNull() // stronger than range membership
    expect(selected.style.filter).toBe('') // the selected treatment replaces the soft range glow
    expect(markerOn('2026-10-09').querySelector('[data-testid="timeline-selected-card"]')).toBeNull()
    expect(band()).not.toBeNull() // range persists while an event inside it is selected
  })

  it('11-18: opening, closing, money in/out, net and count come straight from the canonical projection', async () => {
    const s = snapshot()
    await render(s)
    await drag(3, 20)
    const rows = rowsOf(s).filter(r => r.date >= '2026-10-08' && r.date <= '2026-10-25')
    const expected = {
      opening: s.projection.days.find(d => d.date === '2026-10-08')!.openingCashMinor,
      closing: s.projection.days.find(d => d.date === '2026-10-25')!.closingCashMinor,
      inflow: rows.reduce((n, r) => n + r.inflowMinor, 0), outflow: rows.reduce((n, r) => n + r.outflowMinor, 0), events: rows.reduce((n, r) => n + r.events.length, 0),
    }
    const text = (id: string) => summary()!.querySelector(`[data-testid="${id}"]`)!.textContent ?? ''
    const fmt = (m: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(m) / 100)
    expect(expected.inflow).toBe(95000); expect(expected.outflow).toBe(3800 + 18500 + 56000 + 11300 + 8225); expect(expected.events).toBe(6)
    expect(text('range-opening')).toContain(fmt(expected.opening))
    expect(text('range-closing')).toContain(fmt(expected.closing))
    expect(text('range-in')).toContain(fmt(expected.inflow))
    expect(text('range-out')).toContain(fmt(expected.outflow))
    expect(text('range-net')).toContain(fmt(expected.inflow - expected.outflow)) // display arithmetic only
    expect(expected.closing - expected.opening).toBe(expected.inflow - expected.outflow) // consistent with the engine's own rows
    expect(summary()!.querySelector('[data-testid="range-title"]')!.textContent).toContain('6 events')
    expect(text('range-lowest')).toContain('Lowest')
  })

  it('17/18/21/22/27: every event incl. same-day ones is listed without order, selectable via the existing inspector, and shows no technical ids', async () => {
    const s = snapshot()
    await render(s)
    await drag(3, 20)
    expect(host.querySelector('[data-testid="range-events"]')).toBeNull() // collapsed by default
    await click(host.querySelector('[data-testid="range-events-toggle"]'))
    const panel = host.querySelector('[data-testid="range-events"]')!
    const names = [...panel.querySelectorAll('[data-testid="range-event"]')].map(e => e.textContent ?? '')
    for (const name of ['QuickBooks', 'Phone Bills', 'Truck payment', 'CareCredit', 'Business Insurance', 'Desert Willow deposit']) expect(names.some(n => n.includes(name)), name).toBe(true)
    const day14 = panel.querySelector('[data-date="2026-10-14"]')!
    expect(day14.querySelectorAll('[data-testid="range-event"]')).toHaveLength(2)
    expect(day14.textContent).toContain('same day, no order implied')
    expect(day14.textContent).not.toMatch(/\bfirst\b|\bthen\b|\bafter\b/i)
    expect(panel.textContent).toContain('+$950'); expect(panel.textContent).toContain('−$38')
    expect(panel.textContent).not.toMatch(/cash_commitment|org-1:|[0-9a-f]{8}-[0-9a-f]{4}-/)
    // existing event selection: marker, date, trajectory emphasis, inspector
    const qb = [...panel.querySelectorAll('[data-testid="range-event"]')].find(e => e.textContent?.includes('QuickBooks')) as HTMLElement
    expect(qb.getAttribute('data-source-key')).toBe(s.projection.days.find(d => d.date === '2026-10-09')!.events[0].sourceKey) // canonical identity reused
    await click(qb)
    expect(detailDate()).toBe('2026-10-09')
    expect(host.querySelector('[data-testid="day-event"][data-selected]')?.textContent).toContain('QuickBooks')
    expect(markerOn('2026-10-09').querySelector('[data-testid="timeline-selected-card"]')?.textContent).toContain('QuickBooks')
    expect(band()).not.toBeNull() // the range stays while the event is inspected
    expect(summary()).not.toBeNull()
  })

  it('19/20: unresolved items are listed apart and are not in the totals; state counts stay separate', async () => {
    const s = snapshot()
    await render(s)
    await drag(0, 4) // Oct 5 .. Oct 9 includes today's unresolved Rent
    const sum = summary()!
    expect(sum.querySelector('[data-testid="range-out"]')!.textContent).toContain('$38.00') // QuickBooks only
    expect(sum.querySelector('[data-testid="range-out"]')!.textContent).not.toContain('300')
    expect(sum.querySelector('[data-testid="range-honesty"]')!.textContent).toContain('1 unresolved, not in these totals')
    await click(host.querySelector('[data-testid="range-events-toggle"]'))
    expect(host.querySelector('[data-testid="range-marker"]')).not.toBeNull()
    expect(s.projection.datedEvents.some(e => e.sourceKey.endsWith('c-today'))).toBe(false)
  })

  it('9: selecting a date or event outside the range clears it; inside keeps it', async () => {
    await render()
    await drag(3, 9)
    await click(markerOn('2026-10-12')); expect(band()).not.toBeNull() // inside
    await click(markerOn('2026-10-20')); expect(band()).toBeNull() // outside: cleared, deterministic
    expect(detailDate()).toBe('2026-10-20')
    await drag(3, 9)
    await click(markerOn('2026-10-12')) // select inside the range
    await click([...host.querySelectorAll('button')].find(b => b.textContent?.includes('Next day')))
    expect(detailDate()).toBe('2026-10-13')
    expect(band()).not.toBeNull() // stepping within the range keeps it
    await click([...host.querySelectorAll('button')].find(b => b.textContent?.includes('Next day')))
    await click([...host.querySelectorAll('button')].find(b => b.textContent?.includes('Next day')))
    expect(detailDate()).toBe('2026-10-15')
    expect(band()).toBeNull() // stepping past the edge clears it
  })

  it('23/24: manual range selection cancels the Replay walkthrough, and Replay still works afterwards', async () => {
    sessionStorage.clear(); vi.useFakeTimers()
    await render()
    await act(async () => { vi.advanceTimersByTime(700) })
    expect(host.querySelector('[data-testid="walkthrough-orb"]')).not.toBeNull()
    await ptr(plot(), 'pointerdown', xFor(3)) // owner takes control
    expect(host.querySelector('[data-testid="walkthrough-orb"]')).toBeNull()
    await ptr(plot(), 'pointermove', xFor(15)); await ptr(plot(), 'pointerup', xFor(15))
    expect(band()).not.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    await click(host.querySelector('[data-testid="walkthrough-replay"]'))
    await act(async () => { vi.advanceTimersByTime(700) })
    expect(host.querySelector('[data-testid="walkthrough-orb"]')).not.toBeNull()
    expect(band()).not.toBeNull() // the range is untouched by Replay
  })

  it('25: touch needs the deliberate Select range mode, then drags with Pointer Events and exits the mode', async () => {
    await render()
    const touch = { pointerType: 'touch', pointerId: 7 }
    await drag(3, 20, touch)
    expect(band()).toBeNull() // plain touch drag is ignored: page scrolling is never hijacked
    const button = host.querySelector('[data-testid="range-mode-button"]') as HTMLElement
    await click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(plot().getAttribute('data-range-mode')).toBe('true'); expect(plot().style.touchAction).toBe('none')
    await drag(3, 20, touch)
    expect(band()!.getAttribute('data-start')).toBe('2026-10-08')
    expect(button.getAttribute('aria-pressed')).toBe('false') // back to normal taps
    expect(plot().style.touchAction).toBe('')
  })

  it('26: a non-drag path exists: date pickers and keyboard-movable handles', async () => {
    await render()
    await click(host.querySelector('[data-testid="range-mode-button"]'))
    const setSelect = async (id: string, value: string) => act(async () => {
      const el = host.querySelector(`#${id}`) as HTMLSelectElement
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await setSelect('range-start-select', '2026-10-08'); await setSelect('range-end-select', '2026-10-18')
    expect([band()!.getAttribute('data-start'), band()!.getAttribute('data-end')]).toEqual(['2026-10-08', '2026-10-18'])
    await setSelect('range-end-select', '2026-10-07') // before the start: still a valid, ordered range
    expect([band()!.getAttribute('data-start'), band()!.getAttribute('data-end')]).toEqual(['2026-10-07', '2026-10-08'])
    await click(host.querySelector('[data-testid="range-done"]'))
    const endHandle = host.querySelector('[data-testid="range-handle-end"]') as HTMLElement
    expect(endHandle.getAttribute('role')).toBe('slider'); expect(endHandle.getAttribute('aria-label')).toContain('Range end')
    await act(async () => { endHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(band()!.getAttribute('data-end')).toBe('2026-10-09')
    const startHandle = host.querySelector('[data-testid="range-handle-start"]') as HTMLElement
    await act(async () => { startHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
    expect(band()!.getAttribute('data-start')).toBe('2026-10-06')
  })

  it('adjusting only one boundary by dragging a handle keeps the other', async () => {
    await render()
    await drag(3, 20) // Oct 8 .. Oct 25
    const start = host.querySelector('[data-testid="range-handle-start"]') as HTMLElement
    await ptr(start, 'pointerdown', xFor(3), { pointerId: 1 })
    await ptr(plot(), 'pointermove', xFor(10), { pointerId: 1 })
    await ptr(plot(), 'pointerup', xFor(10), { pointerId: 1 })
    expect([band()!.getAttribute('data-start'), band()!.getAttribute('data-end')]).toEqual(['2026-10-15', '2026-10-25'])
    const end = host.querySelector('[data-testid="range-handle-end"]') as HTMLElement
    await ptr(end, 'pointerdown', xFor(20), { pointerId: 1 })
    await ptr(plot(), 'pointermove', xFor(12), { pointerId: 1 }); await ptr(plot(), 'pointerup', xFor(12), { pointerId: 1 })
    expect([band()!.getAttribute('data-start'), band()!.getAttribute('data-end')]).toEqual(['2026-10-15', '2026-10-17'])
  })

  it('performance: dragging re-renders only the range layer, not the chart', async () => {
    await render()
    await ptr(plot(), 'pointerdown', xFor(3))
    await ptr(plot(), 'pointermove', xFor(5)) // drag begins
    const before = counters.containerRenders
    for (let i = 6; i <= 20; i++) await ptr(plot(), 'pointermove', xFor(i))
    expect(counters.containerRenders).toBe(before) // 15 pointer moves, zero chart renders
    expect(band()!.getAttribute('data-end')).toBe('2026-10-25')
    await ptr(plot(), 'pointerup', xFor(20))
  })

  it('28/projection: range selection never writes anything or alters the projection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const s = snapshot(); const before = JSON.stringify(s.projection)
    await render(s)
    await drag(3, 20); await click(host.querySelector('[data-testid="range-events-toggle"]')); await click(host.querySelector('[data-testid="range-clear"]'))
    expect(JSON.stringify(s.projection)).toBe(before)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('33: setup/partial states are unaffected (the decision layer still renders without a graph)', async () => {
    await act(async () => { root.render(<CashOsDecisionLayer snapshot={snapshot()} partial />) })
    expect(host.textContent).toContain('Cash totals are being held back')
  })
})
