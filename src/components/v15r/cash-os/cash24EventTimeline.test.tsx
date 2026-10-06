// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('./CashMoneyPlan', () => ({ default: () => <div data-testid="money-plan-stub" /> }))

import CashOsOutlook from './CashOsOutlook'
import CashOsDecisionLayer, { CashOsDecisionView } from './CashOsDecisionLayer'
import { buildTimeline, resolveGraphTarget, linkFor, findByKey, LABEL_MIN_GAP, MARKER_MIN_GAP, eventBandDomain, dataTicks, movementState } from './cashTimelineModel'
import { planWalkthrough, useCashFlowWalkthrough, type WalkStop } from './useCashFlowWalkthrough'
import { buildCashOsSnapshot } from '@/finance/cashOsSnapshot'
import type { OwnerDecisionView } from '@/finance/decisionLayer'
import type { CashCommitment } from '@/finance/obligationsTypes'
import type { BackupData } from '@/services/backupDataService'

const ORG = 'org-1'
const AS_OF = '2026-10-05'
const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// ── hand-built canonical projection (the model only reads it) ──
function ev(offset: number, key: string, direction: 'inflow' | 'outflow', amountMinor: number, over: Record<string, unknown> = {}) {
  return { id: key, organizationId: ORG, date: addDays(AS_OF, offset), direction, amountMinor, confidence: 'confirmed', requirement: 'required', sourceKey: key,
    sourceType: 'cash_commitment', category: null, attribution: {}, label: key, movementBasis: 'cash_commitment', ...over } as any
}
const mk = (offset: number, reason: string, key = `m${offset}`, over: Record<string, unknown> = {}) => ({ sourceKey: key, organizationId: ORG, date: addDays(AS_OF, offset), amountMinor: null,
  reason, label: `Marker ${key}`, category: null, attribution: {}, ...over }) as any
function proj(horizon: 7 | 14 | 30 | 60 | 90, events: any[] = [], markers: any[] = []) {
  let cash = 100000
  const day = (offset: number) => {
    const date = addDays(AS_OF, offset)
    const evs = events.filter(e => e.date === date)
    const inflowMinor = evs.filter(e => e.direction === 'inflow').reduce((s, e) => s + e.amountMinor, 0)
    const outflowMinor = evs.filter(e => e.direction === 'outflow').reduce((s, e) => s + e.amountMinor, 0)
    const openingCashMinor = cash; cash = cash + inflowMinor - outflowMinor
    return { date, openingCashMinor, inflowMinor, outflowMinor, closingCashMinor: cash, totalProtectedRequirementMinor: 0, protectedCashMinor: 0, trulyFreeCashMinor: cash,
      protectionDeficitMinor: 0, operatingFloorMinor: 0, events: evs, markers: markers.filter(m => m.date === date), uncertainty: {} } as any
  }
  const anchor = day(0)
  const days = Array.from({ length: horizon }, (_, i) => day(i + 1))
  return { organizationId: ORG, asOfDate: AS_OF, horizonDays: horizon, confidenceMode: 'conservative', anchor, days } as any
}
const stringify = (x: unknown) => JSON.stringify(x)

describe('timeline presentation model (derived from canonical projection)', () => {
  it('1: every canonical projection event becomes exactly one presentation event, with the same facts', () => {
    const events = [ev(3, 'truck', 'outflow', 56000, { label: 'Truck payment', category: 'debt' }), ev(10, 'dw', 'inflow', 90000, { label: 'Desert Willow', movementBasis: 'project_collection', sourceType: 'project_schedule' })]
    const t = buildTimeline(proj(30, events))
    const flat = t.days.flatMap(d => d.events)
    expect(t.eventCount).toBe(2)
    expect(flat.map(e => [e.key, e.date, e.direction, e.amountMinor, e.label])).toEqual([
      ['truck', addDays(AS_OF, 3), 'outflow', 56000, 'Truck payment'], ['dw', addDays(AS_OF, 10), 'inflow', 90000, 'Desert Willow']])
  })

  it('2: inflows and outflows stay directionally distinct, using the canonical daily totals', () => {
    const t = buildTimeline(proj(30, [ev(2, 'a', 'inflow', 90000), ev(2, 'b', 'outflow', 56000), ev(5, 'c', 'outflow', 1000)]))
    const d2 = t.days.find(d => d.date === addDays(AS_OF, 2))!
    expect([d2.inflowMinor, d2.outflowMinor, d2.netMinor]).toEqual([90000, 56000, 34000])
    expect(t.days.find(d => d.date === addDays(AS_OF, 5))!.netMinor).toBe(-1000)
    const cluster = t.clusters.find(c => c.days.includes(d2))!
    expect([cluster.inflowMinor, cluster.outflowMinor]).toEqual([90000, 56000])
  })

  it('3: unresolved markers are never cash movement and are excluded from walkthrough stops', () => {
    const t = buildTimeline(proj(30, [], [mk(0, 'overdue_unsettled', 'due-today'), mk(4, 'collection_linkage_unknown', 'dw-col'), mk(6, 'unknown_amount', 'amt'), mk(7, 'source_overlap', 'overlap')]))
    expect(t.eventCount).toBe(0)
    expect(t.days.every(d => d.events.length === 0 && d.netMinor === 0 && d.inflowMinor === 0 && d.outflowMinor === 0)).toBe(true)
    expect(t.days.flatMap(d => d.markers.map(m => m.key)).sort()).toEqual(['amt', 'dw-col', 'due-today'].sort()) // bookkeeping marker hidden
    expect(t.days.find(d => d.date === AS_OF)!.markers[0].text).toContain('not marked paid')
    expect(t.days.find(d => d.markers.some(m => m.key === 'dw-col'))!.markers[0].text).toContain('cannot link')
  })

  it('4: possible/unawarded project money is not a graph cash event', () => {
    // Money-section items (potential/unlockable) live in the decision view, not the projection; nothing there can reach the timeline.
    const t = buildTimeline(proj(30, [ev(3, 'bill', 'outflow', 100)]))
    expect(t.eventCount).toBe(1)
    expect(movementState({ movementBasis: 'project_collection', confidence: 'possible' })).toBe('possible')
    expect(movementState({ movementBasis: 'future_posted_ledger', confidence: 'confirmed' })).toBe('posted')
    expect(movementState({ movementBasis: 'planned_obligation', confidence: 'confirmed' })).toBe('projected')
    // `pending` is architecture only: no canonical input produces it.
    for (const basis of ['future_posted_ledger', 'planned_obligation', 'cash_commitment', 'project_collection', 'scenario'] as const)
      for (const confidence of ['confirmed', 'expected', 'possible'] as const) expect(movementState({ movementBasis: basis, confidence })).not.toBe('pending')
  })

  it('5: same-day events group without any ordering claim (input order does not leak)', () => {
    const a = ev(9, 'truck', 'outflow', 56000), b = ev(9, 'care', 'outflow', 11300)
    const t1 = buildTimeline(proj(30, [a, b])), t2 = buildTimeline(proj(30, [b, a]))
    const day = (t: ReturnType<typeof buildTimeline>) => t.days.find(d => d.date === addDays(AS_OF, 9))!
    expect(day(t1).events).toHaveLength(2)
    expect(day(t1).events.map(e => e.key)).toEqual(day(t2).events.map(e => e.key)) // deterministic set order, not event order
    expect(day(t1).events.map(e => e.amountMinor)).toEqual([56000, 11300]) // by amount, not by "which happened first"
    expect(t1.clusters.find(c => c.days.includes(day(t1)))!.eventCount).toBe(2)
  })

  it('11/12: command-center rows link ONLY through exact canonical identity', () => {
    const t = buildTimeline(proj(30, [ev(3, 'org:cash_commitment:c1', 'outflow', 56000, { label: 'Truck payment' }), ev(4, 'other', 'outflow', 56000, { label: 'Truck payment' })]))
    expect(resolveGraphTarget(t, { sourceKey: 'org:cash_commitment:c1' })).toEqual({ date: addDays(AS_OF, 3), key: 'org:cash_commitment:c1' })
    // Same amount and same label are NOT identity.
    expect(resolveGraphTarget(t, { sourceKey: 'org:cash_commitment:unknown' })).toBeNull()
    expect(resolveGraphTarget(t, {})).toBeNull()
    expect(findByKey(t, 'nope')).toBeNull()
    expect(linkFor(t, { date: addDays(AS_OF, 3), key: 'org:cash_commitment:c1' })).toEqual({ sourceKey: 'org:cash_commitment:c1', projectId: undefined })
    expect(linkFor(t, { date: addDays(AS_OF, 3), key: null })).toBeNull()
  })

  it('13: projectId links only when the project owns exactly one visible event', () => {
    const one = buildTimeline(proj(30, [ev(5, 'p:dw:final', 'inflow', 90000, { attribution: { projectId: 'dw' } })]))
    expect(resolveGraphTarget(one, { projectId: 'dw' })).toEqual({ date: addDays(AS_OF, 5), key: 'p:dw:final' })
    expect(resolveGraphTarget(one, { projectId: 'mh' })).toBeNull() // no events for that project
    const many = buildTimeline(proj(30, [ev(5, 'p:mh:a', 'outflow', 100, { attribution: { projectId: 'mh' } }), ev(8, 'p:mh:b', 'outflow', 200, { attribution: { projectId: 'mh' } })]))
    expect(resolveGraphTarget(many, { projectId: 'mh' })).toBeNull() // ambiguous: never guessed
    // An exact source key still wins even when the project is ambiguous.
    expect(resolveGraphTarget(many, { sourceKey: 'p:mh:b', projectId: 'mh' })).toEqual({ date: addDays(AS_OF, 8), key: 'p:mh:b' })
  })

  it('14: dense timelines keep every event reachable and never overlap resting labels', () => {
    const events = Array.from({ length: 30 }, (_, i) => ev(i + 1, `e${i}`, i % 2 ? 'inflow' : 'outflow', 1000 + i))
    const t = buildTimeline(proj(30, events))
    expect(t.clusters.flatMap(c => c.days).flatMap(d => d.events)).toHaveLength(30)
    expect(t.clusters.reduce((n, c) => n + c.eventCount, 0)).toBe(30)
    const shown = t.clusters.filter(c => c.showLabel)
    expect(shown.length).toBeLessThan(t.clusters.length)
    for (let i = 1; i < shown.length; i++) expect(shown[i].frac - shown[i - 1].frac).toBeGreaterThanOrEqual(LABEL_MIN_GAP - 1e-9)
    const t90 = buildTimeline(proj(90, Array.from({ length: 90 }, (_, i) => ev(i + 1, `x${i}`, 'outflow', 500))))
    expect(t90.clusters.length).toBeLessThan(90)
    expect(t90.clusters.reduce((n, c) => n + c.eventCount, 0)).toBe(90)
    for (const c of t90.clusters) expect(c.days[c.days.length - 1].frac - c.days[0].frac).toBeLessThan(MARKER_MIN_GAP)
  })

  it.each([7, 14, 30, 60, 90] as const)('15-19: %id window positions events on the date axis and keeps them accessible', horizon => {
    const t = buildTimeline(proj(horizon, [ev(1, 'a', 'outflow', 100), ev(2, 'b', 'outflow', 200), ev(horizon, 'z', 'inflow', 300)]))
    const last = t.days[t.days.length - 1]
    expect(t.horizonDays).toBe(horizon)
    expect(last.frac).toBe(1) // last visible day sits at the right edge
    expect(t.days.find(d => d.date === addDays(AS_OF, 1))!.frac).toBeCloseTo(1 / horizon, 6)
    expect(t.eventCount).toBe(3)
    const adjacent = t.clusters.find(c => c.days.some(d => d.date === addDays(AS_OF, 1)))!
    const together = adjacent.days.some(d => d.date === addDays(AS_OF, 2))
    // Consecutive days stay separate up to 30d and group at 60d/90d, but always remain reachable.
    expect(together).toBe(horizon > 30)
    expect(t.clusters.reduce((n, c) => n + c.eventCount, 0)).toBe(3)
  })

  it('value-axis headroom is presentation only and keeps real data ticks', () => {
    const d = eventBandDomain([100000, 90000, 50000])
    expect(d.min).toBeLessThan(50000); expect(d.max).toBeGreaterThan(100000)
    expect([d.dataMin, d.dataMax]).toEqual([50000, 100000])
    expect(dataTicks(50000, 100000)).toEqual([50000, 66667, 83333, 100000])
    expect(eventBandDomain([0, 0]).max).toBeGreaterThan(0)
  })
})

// ── walkthrough ──
const stops = (n: number): WalkStop[] => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, frac: (i + 1) / (n + 1), date: `d${i}` }))

describe('walkthrough plan and hook', () => {
  it('plans roughly 5–8 seconds for a normal event set and adapts for many', () => {
    for (const n of [1, 3, 5, 8]) { const { totalMs } = planWalkthrough(stops(n)); expect(totalMs, `n=${n}`).toBeGreaterThanOrEqual(3000); expect(totalMs, `n=${n}`).toBeLessThanOrEqual(8000) }
    expect(planWalkthrough(stops(3)).totalMs).toBeGreaterThanOrEqual(5000)
    expect(planWalkthrough(stops(30)).totalMs).toBeLessThan(8500) // dwell shrinks instead of spending seconds per event
    expect(planWalkthrough([]).totalMs).toBe(0)
    const steps = planWalkthrough(stops(2)).steps
    expect(steps.filter(s => s.kind === 'arrive').map((s: any) => s.id)).toEqual(['d0', 'd1'])
    expect(steps[steps.length - 1].kind).toBe('finish')
  })

  let host: HTMLDivElement
  let root: Root
  let api: ReturnType<typeof useCashFlowWalkthrough>
  let renders = 0
  function Harness({ s, storageKey = 'k', auto = true }: { s: WalkStop[]; storageKey?: string; auto?: boolean }) {
    api = useCashFlowWalkthrough({ stops: s, enabled: true, storageKey, autoStart: auto }); renders++
    const [, force] = useState(0)
    return <button data-testid="x" data-phase={api.phase} data-active={api.activeId ?? ''} data-orb={api.orbFrac ?? ''} onClick={() => force(n => n + 1)} />
  }
  const q = (name: string) => host.querySelector('[data-testid="x"]')!.getAttribute(name)
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); sessionStorage.clear(); renders = 0
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); delete (window as any).matchMedia })
  const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms) }) }

  it('20/21: runs once under normal motion, visits each stop in order, then stops with no leftover timers', async () => {
    const s = stops(3)
    await act(async () => { root.render(<Harness s={s} />) })
    await advance(1)
    expect(q('data-phase')).toBe('running')
    const seen: string[] = []
    const { totalMs } = planWalkthrough(s)
    for (let t = 0; t < totalMs + 50; t += 25) { await advance(25); const a = q('data-active'); if (a && seen[seen.length - 1] !== a) seen.push(a) }
    expect(seen).toEqual(['d0', 'd1', 'd2'])
    expect(q('data-phase')).toBe('done')
    expect(q('data-orb')).toBe('')
    expect(vi.getTimerCount()).toBe(0)
    const before = renders
    await advance(60000)
    expect(renders).toBe(before) // nothing keeps ticking
    expect(q('data-phase')).toBe('done')
  })

  it('does not re-render the host every frame: state changes only at stop boundaries', async () => {
    const s = stops(4)
    await act(async () => { root.render(<Harness s={s} />) })
    await advance(planWalkthrough(s).totalMs + 100)
    expect(renders).toBeLessThan(2 + 4 * 3 + 6) // ~2 per stop plus start/finish
  })

  it('22: owner interaction cancels the walkthrough immediately', async () => {
    await act(async () => { root.render(<Harness s={stops(3)} />) })
    await advance(1500)
    expect(q('data-phase')).toBe('running')
    await act(async () => { api.cancel() })
    expect(q('data-phase')).toBe('done')
    expect(q('data-orb')).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('23/24: replay works on demand, and a re-render or re-mount in the same session does not auto-replay', async () => {
    const s = stops(2)
    await act(async () => { root.render(<Harness s={s} />) })
    await advance(planWalkthrough(s).totalMs + 100)
    expect(q('data-phase')).toBe('done')
    await act(async () => { host.querySelector('button')!.click() }) // plain re-render
    expect(q('data-phase')).toBe('done')
    await act(async () => { root.unmount() }); root = createRoot(host)
    await act(async () => { root.render(<Harness s={s} />) }) // re-mount, same session
    await advance(10)
    expect(q('data-phase')).toBe('idle') // not replayed automatically
    await act(async () => { api.start() }); await advance(10)
    expect(q('data-phase')).toBe('running') // replay on request
    await advance(planWalkthrough(s).totalMs + 100)
    expect(q('data-phase')).toBe('done')
  })

  it('25: reduced motion never runs or replays the traveling pulse', async () => {
    ;(window as any).matchMedia = (query: string) => ({ matches: /reduce/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {} })
    await act(async () => { root.render(<Harness s={stops(3)} />) })
    await advance(20000)
    expect(q('data-phase')).toBe('idle')
    expect(q('data-orb')).toBe('')
    await act(async () => { api.start() }); await advance(100)
    expect(q('data-phase')).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })
})

// ── integrated Outlook ──
const account = (id: string) => ({ id, organization_id: ORG, display_name: id, account_type: 'checking', account_class: 'asset', ownership_context: 'business',
  include_in_cash: true, currency: 'USD', status: 'active', source_type: 'manual', source_metadata: {}, created_at: '', updated_at: '', archived_at: null })
const tx = (id: string, amount: number, over: Record<string, unknown> = {}) => ({ id, organization_id: ORG, account_id: 'bank', amount_minor: amount, currency: 'USD',
  transaction_date: AS_OF, effective_at: null, posted_at: null, status: 'posted', transaction_kind: 'opening_balance', economic_effect: 'none', economic_amount_minor: 0,
  description: id, counterparty: null, category: null, project_id: null, employee_id: null, debt_account_id: null, source_type: 'opening_balance', source_organization_id: null,
  source_kind: null, source_record_id: null, source_effective_date: null, source_timestamp: null, source_metadata: {}, idempotency_key: id, created_at: '', updated_at: '',
  voided_at: null, voided_by: null, void_reason: null, ...over })
const commitment = (id: string, title: string, date: string, minor: number, projectId?: string): CashCommitment => ({ id, organizationId: ORG, title, expectedDate: date,
  amount: { currency: 'USD', minor }, amountCertainty: 'fixed', requirement: 'required', confidence: 'confirmed', status: 'scheduled', sourceType: 'manual',
  reconciliationState: 'unreconciled', projectId: projectId ?? null, provenance: { source: { organizationId: ORG, kind: 'cash_commitment', recordId: id }, freshness: 'current',
    confidence: 'confirmed', reconciliationState: 'unreconciled' } } as any)

function snapshot() {
  return buildCashOsSnapshot({ organizationId: ORG, asOfDate: AS_OF, asOfTimestamp: `${AS_OF}T20:00:00Z`,
    accounts: [account('bank')] as any,
    transactions: [tx('o', 500000), tx('inc', 95000, { transaction_date: '2026-10-20', transaction_kind: 'income', economic_effect: 'inflow', economic_amount_minor: 95000, source_type: 'manual', description: 'Deposit' })] as any,
    obligations: [], occurrences: [],
    commitments: [commitment('c-today', 'Rent', AS_OF, 30000), commitment('truck', 'Truck payment', '2026-10-14', 56000, 'dw'), commitment('care', 'CareCredit', '2026-10-14', 11300),
      commitment('solo', 'Insurance', '2026-10-09', 20000)],
    timeEntries: [], sessions: [], bridges: [], employees: [], liabilityTerms: [], projectFacts: [],
    backup: { settings: {}, employees: [], logs: [], projects: [] } as unknown as BackupData,
    setup: { version: 1, organizationId: ORG, payrollPaidThroughDate: '2026-10-04', protectionHorizonDays: 14, operatingFloorMinor: 5000, taxReserve: { kind: 'disabled' },
      includeOptionalObligations: false, includeOpenShiftEstimates: false, timezoneConfirmed: true, confirmedAt: `${AS_OF}T20:00:00Z` }, horizonDays: 30, confidenceMode: 'conservative' })
}

describe('Outlook event timeline (integrated)', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); sessionStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.useRealTimers(); delete (window as any).matchMedia })
  const render = async (s = snapshot(), props: Record<string, unknown> = {}) => act(async () => {
    root.render(<CashOsOutlook snapshot={s} horizonDays={30} confidenceMode="conservative" onHorizon={vi.fn()} onConfidence={vi.fn()}
      afterGraph={link => <CashOsDecisionLayer snapshot={s} graphLink={link} />} {...props} />)
  })
  const click = async (el: Element | null | undefined) => { if (!el) throw new Error('missing element'); await act(async () => { (el as HTMLElement).click() }) }
  const markerOn = (date: string) => host.querySelector(`[data-testid="timeline-marker"][data-date="${date}"]`) as HTMLElement
  const detailDate = () => host.querySelector('[data-testid="day-detail"]')!.getAttribute('data-date')

  it('renders a marker per date, directions distinct, markers separate from events, from the real projection', async () => {
    const s = snapshot()
    await render(s)
    const layer = host.querySelector('[data-testid="timeline-layer"]')!
    expect(layer).not.toBeNull()
    expect(markerOn('2026-10-14').getAttribute('data-direction')).toBe('outflow')
    expect(markerOn('2026-10-20').getAttribute('data-direction')).toBe('inflow')
    expect(markerOn('2026-10-14').getAttribute('aria-label')).toContain('2 cash events')
    // Today's unresolved bill is a distinct amber marker, not a cash movement.
    const today = markerOn(AS_OF)
    expect(today.getAttribute('data-state')).toBe('uncertain')
    expect(today.getAttribute('data-direction')).toBe('unresolved')
    expect(s.projection.datedEvents.some(e => e.sourceKey.endsWith('c-today'))).toBe(false)
    expect(layer.textContent).not.toContain('$300') // no fake cash amount for the unresolved item
  })

  it('6/7/8/27/28: tapping a single event selects its date AND event, updates the inspector, and persists', async () => {
    await render()
    await click(markerOn('2026-10-09'))
    expect(detailDate()).toBe('2026-10-09')
    expect(host.querySelector('[data-testid="day-event"][data-selected]')?.getAttribute('data-source-key')).toContain('solo')
    expect(host.querySelector('[data-testid="timeline-marker"][data-selected]')).not.toBeNull()
    expect(host.querySelector('[data-testid="graph-selected-date"]')?.textContent).toContain('Oct 9')
    await click(host.querySelector('button[aria-label="About what is set aside"]')) // unrelated interaction
    expect(host.querySelector('[data-testid="day-event"][data-selected]')).not.toBeNull() // still selected
  })

  it('5/6/27: a same-day group opens by tap, lists every event as a set, and each is individually inspectable', async () => {
    await render()
    await click(markerOn('2026-10-14'))
    expect(detailDate()).toBe('2026-10-14')
    const strip = host.querySelector('[data-testid="timeline-selection"]')!
    expect(strip.textContent).toContain('2 events')
    expect(strip.textContent).toContain('no order is implied')
    expect(strip.textContent).not.toMatch(/\bfirst\b|\bthen\b|\bafter\b/i)
    const chips = [...strip.querySelectorAll('[data-testid="timeline-event-chip"]')]
    expect(chips).toHaveLength(2)
    await click(chips.find(c => c.textContent?.includes('CareCredit')))
    expect(host.querySelector('[data-testid="day-event"][data-selected]')?.textContent).toContain('CareCredit')
    await click([...host.querySelectorAll('[data-testid="timeline-event-chip"]')].find(c => c.textContent?.includes('Truck')))
    expect(host.querySelector('[data-testid="day-event"][data-selected]')?.textContent).toContain('Truck')
    // The inspector keeps Opening → events → inflows/outflows → net → closing.
    const text = host.querySelector('[data-testid="day-detail"]')!.textContent ?? ''
    for (const label of ['Opening', 'Events', 'Money in', 'Money out', 'Net movement', 'Closing']) expect(text).toContain(label)
  })

  it('selecting an unresolved marker explains it and states it has no cash effect', async () => {
    await render()
    await click(markerOn(AS_OF))
    expect(detailDate()).toBe(AS_OF)
    const strip = host.querySelector('[data-testid="timeline-selection"]')!
    expect(strip.querySelector('[data-testid="timeline-marker-chip"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="day-marker"][data-selected]')).not.toBeNull()
    expect(strip.textContent).toContain('no effect on projected cash')
  })

  it('9/10: day buttons still move the shared selection and clear the event selection', async () => {
    await render()
    await click(markerOn('2026-10-09'))
    await click([...host.querySelectorAll('button')].find(b => b.textContent?.includes('Next day')))
    expect(detailDate()).toBe('2026-10-10')
    expect(host.querySelector('[data-testid="day-event"][data-selected]')).toBeNull()
    await click([...host.querySelectorAll('button')].find(b => b.textContent?.includes('Previous day')))
    expect(detailDate()).toBe('2026-10-09')
  })

  it('graph → command center: highlight only rows sharing canonical identity, no automatic expansion or tab switch', async () => {
    await render()
    await click(markerOn(AS_OF))
    const linkedRows = [...host.querySelectorAll('[data-testid="command-center"] [data-linked]')]
    // The Today row for the unresolved bill carries the same source key as the selected marker.
    expect(linkedRows.some(r => r.getAttribute('data-source-key')?.endsWith('c-today'))).toBe(true)
    expect(host.querySelectorAll('[data-testid="command-center"] [aria-expanded="true"]')).toHaveLength(0)
    const segs = [...host.querySelectorAll('[data-testid="command-segments"] button')]
    expect(segs[0].getAttribute('aria-pressed')).toBe('true') // active segment untouched
    await click(markerOn('2026-10-09')) // an event no row refers to
    expect(host.querySelectorAll('[data-testid="command-center"] [data-linked]')).toHaveLength(0)
  })

  it('command center → graph: opening a row selects its graph item by exact identity only', async () => {
    await render()
    const row = [...host.querySelectorAll('[data-testid="command-today"] [data-testid="command-row"]')].find(r => r.getAttribute('data-source-key')?.endsWith('c-today'))!
    await click(row.querySelector('button[aria-expanded]'))
    expect(detailDate()).toBe(AS_OF)
    expect(host.querySelector('[data-testid="timeline-marker"][data-selected]')?.getAttribute('data-date')).toBe(AS_OF)
  })

  it('13: a Money row links to the graph only when its project owns exactly one visible event', async () => {
    const view = { asOfDate: AS_OF, status: 'ready', today: { notes: [] }, next7Days: {}, risks: [], actions: [], dataGaps: [],
      moneyStates: { availableMinor: 0, collectible: [], unlockable: [
        { id: 'u-dw', state: 'unlockable', label: 'Desert Willow', amountMinor: 90000, basis: 'b', projectId: 'dw', unknowns: [], ownerConfirmed: false },
        { id: 'u-mh', state: 'unlockable', label: 'Mobile Home', amountMinor: 1, basis: 'b', projectId: 'mh', unknowns: [], ownerConfirmed: false }], potential: [], blocked: [],
        totals: {}, notCounted: [], settledProjectCount: 0 } } as unknown as OwnerDecisionView
    const onRowSelect = vi.fn()
    await act(async () => { root.render(<CashOsDecisionView view={view} snapshot={null} graphLink={{ highlight: { projectId: 'dw' }, onRowSelect }} />) })
    const rows = [...host.querySelectorAll('[data-testid="money-row"]')]
    expect(rows.find(r => r.textContent?.includes('Desert Willow'))!.getAttribute('data-linked')).toBe('true')
    expect(rows.find(r => r.textContent?.includes('Mobile Home'))!.getAttribute('data-linked')).toBeNull()
    await click(rows[1].querySelector('button[aria-expanded]'))
    expect(onRowSelect).toHaveBeenCalledWith({ sourceKey: undefined, projectId: 'mh' })
    // And through Outlook's resolver: Desert Willow owns one event (truck on Oct 14), Mobile Home owns none.
    const t = buildTimeline(snapshot().projection)
    expect(resolveGraphTarget(t, { projectId: 'dw' })?.date).toBe('2026-10-14')
    expect(resolveGraphTarget(t, { projectId: 'mh' })).toBeNull()
  })

  it('26: reduced motion shows the complete static timeline immediately, with all information and interaction', async () => {
    ;(window as any).matchMedia = (query: string) => ({ matches: /reduce/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {} })
    vi.useFakeTimers()
    await render()
    expect(host.querySelector('[data-testid="walkthrough-orb"]')).toBeNull()
    expect(host.querySelector('[data-testid="walkthrough-replay"]')).toBeNull()
    expect(host.querySelectorAll('[data-testid="timeline-marker"]').length).toBeGreaterThanOrEqual(4)
    await act(async () => { vi.advanceTimersByTime(20000) })
    expect(host.querySelector('[data-testid="walkthrough-orb"]')).toBeNull()
    await click(markerOn('2026-10-14'))
    expect(host.querySelectorAll('[data-testid="timeline-event-chip"]')).toHaveLength(2)
  })

  it('20-25: the pulse plays once on first presentation, a marker or tap cancels it, and replay restarts it', async () => {
    vi.useFakeTimers()
    await render()
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(host.querySelector('[data-testid="walkthrough-orb"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="graph-card-body"]')).not.toBeNull()
    // Let it reach the first stop: a marker illuminates.
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(host.querySelector('[data-testid="timeline-marker"][data-active]')).not.toBeNull()
    // Owner taps something: the walkthrough stops and the tap is honored.
    await click(markerOn('2026-10-09'))
    expect(host.querySelector('[data-testid="walkthrough-orb"]')).toBeNull()
    expect(host.querySelector('[data-testid="timeline-marker"][data-active]')).toBeNull()
    expect(detailDate()).toBe('2026-10-09')
    expect(vi.getTimerCount()).toBe(0)
    // Replay is available and restarts it; it then runs to completion and stops by itself.
    await click(host.querySelector('[data-testid="walkthrough-replay"]'))
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(host.querySelector('[data-testid="walkthrough-orb"]')).not.toBeNull()
    await act(async () => { vi.advanceTimersByTime(12000) })
    expect(host.querySelector('[data-testid="walkthrough-orb"]')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    // Selection survived the whole story.
    expect(detailDate()).toBe('2026-10-09')
  })

  it('29: building and rendering the timeline never changes the canonical projection', async () => {
    const s = snapshot()
    const before = stringify(s.projection)
    buildTimeline(s.projection)
    await render(s)
    await click(markerOn('2026-10-14'))
    expect(stringify(s.projection)).toBe(before)
  })

  it('32: partial/withheld decision layer still renders without a graph link', () => {
    const html = renderToStaticMarkup(<CashOsDecisionLayer snapshot={snapshot()} partial />)
    expect(html).toContain('Cash totals are being held back')
  })
})
