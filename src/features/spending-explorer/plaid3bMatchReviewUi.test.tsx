// @vitest-environment happy-dom
/**
 * PLAID-3B: the Matches review screen. The server (and its tests) own every financial rule; these tests pin what the OWNER can see and do:
 * each state the persistence model supports, the exact request each button sends, the two-step reverse, the read-only mode, error handling, and that the
 * mode appears in the Explorer only when the server says the feature is on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MatchItem, MatchLeg } from '@/finance/bankMatchReview'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
import MatchReview from './MatchReview'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const acct = (label: string, over: Record<string, unknown> = {}) => ({ ref: `ref-${label}`, label, mask: '6960', ownership: 'business', accountClass: 'bank_cash', institution: 'Wells Fargo', ...over })
const leg = (n: number, dollars: number, date: string, name: string, account: any, over: Partial<MatchLeg> = {}): MatchLeg =>
  ({ id: id(n), date, name, merchant: null, amountMinor: Math.round(dollars * 100), pending: false, missing: false, account, ...over })
const FP = (o: number, i: number) => `v1|o:${id(o)}:acct-o:50000:2026-10-03:0|i:${id(i)}:acct-i:-50000:2026-10-04:0`
const item = (o: number, i: number, over: Partial<MatchItem> = {}): MatchItem => ({
  key: `${id(o)}:${id(i)}`, state: 'suggested', kind: 'internal_transfer', confidence: 'high', needsReview: false,
  outflow: leg(o, 500, '2026-10-03', 'ONLINE TRANSFER TO SAVINGS', acct('Business Checking')),
  inflow: leg(i, -500, '2026-10-04', 'ONLINE TRANSFER FROM CHECKING', acct('Business Savings', { mask: '1234' })),
  amountMinor: 50000, daysApart: 1, reasons: ['Equal and opposite amounts', 'Both accounts are yours'], caps: [], crossScope: false,
  fingerprint: FP(o, i), decision: null, changes: [], history: [], actions: ['confirm', 'reject'], ...over,
})
const counts = (over: Record<string, number> = {}) => ({ suggested: 0, waiting: 0, ambiguous: 0, confirmed: 0, rejected: 0, reversed: 0, evidence_changed: 0, needsReview: 0, refunds: 0, ...over })
const payload = (over: Record<string, unknown> = {}) => ({
  enabled: true, decisionsAvailable: true, asOf: '2026-10-11', window: { from: '2026-07-14', to: '2026-10-11' }, environment: 'production', coverage: { complete: true, reason: null },
  tab: 'review', counts: counts({ suggested: 1 }), total: 1, items: [item(1, 2)], groups: [], refunds: [],
  contract: 'A match is your statement that two bank movements are the same event. It labels bank evidence only: it does not change your balances, ledger or any account.', ...over,
})

describe('Matches review screen (PLAID-3B)', () => {
  let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>
  let responder: (url: string, init?: any) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>
  const mount = async (get: unknown | ((url: string) => unknown), post: unknown = { outcome: 'confirmed', pairId: id(99) }) => {
    responder = (url, init) => init?.method === 'POST' ? { body: post } : { body: typeof get === 'function' ? (get as any)(url) : get }
    fetchMock = vi.fn(async (url: string, init?: any) => { const r = await responder(url, init); const status = r.status ?? 200; return { ok: status < 400, status, json: async () => r.body } })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<MatchReview />) })
    await flush()
  }
  const q = (s: string) => host.querySelector(s) as HTMLElement | null
  const qa = (s: string) => [...host.querySelectorAll(s)] as HTMLElement[]
  const click = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await flush() }
  const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST').map(([, i]) => JSON.parse(i.body))
  const gets = () => fetchMock.mock.calls.filter(([, i]) => !i?.method || i.method === 'GET').map(([u]) => String(u))
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  it('shows one compact card per match: kind, state, confidence, amount, both accounts with ownership, dates and signed amounts; no ids leak into the text', async () => {
    await mount(payload())
    const card = q('[data-testid="match-card"]')!
    expect(card.dataset.state).toBe('suggested'); expect(card.dataset.kind).toBe('internal_transfer')
    const t = card.textContent!
    expect(t).toContain('Move between your accounts'); expect(t).toContain('Suggested'); expect(t).toContain('High confidence'); expect(t).toContain('$500.00'); expect(t).toContain('1 day apart')
    const [out, inn] = qa('[data-testid="match-leg"]')
    expect(out.textContent).toContain('Money out'); expect(out.textContent).toContain('Business Checking ••••6960'); expect(out.textContent).toContain('Wells Fargo'); expect(out.textContent).toContain('Business')
    expect(out.textContent).toContain('Oct 3'); expect(out.textContent).toContain('−$500.00'); expect(out.textContent).toContain('ONLINE TRANSFER TO SAVINGS')
    expect(inn.textContent).toContain('Money in'); expect(inn.textContent).toContain('Business Savings ••••1234'); expect(inn.textContent).toContain('Oct 4'); expect(inn.textContent).toContain('+$500.00')
    expect(host.textContent).not.toMatch(/0000-4000|v1\||organization/i)
    expect(q('[data-testid="match-contract"]')!.textContent).toContain('does not change your balances')
  })

  it('"Why this match?" opens the reasons the server gave; they are hidden until asked', async () => {
    await mount(payload())
    expect(q('[data-testid="match-why"]')).toBeNull()
    await click(q('[data-testid="match-why-toggle"]'))
    expect(q('[data-testid="match-why"]')!.textContent).toContain('Equal and opposite amounts'); expect(q('[data-testid="match-why"]')!.textContent).toContain('Both accounts are yours')
    expect(q('[data-testid="match-why-toggle"]')!.getAttribute('aria-expanded')).toBe('true')
    await click(q('[data-testid="match-why-toggle"]')); expect(q('[data-testid="match-why"]')).toBeNull()
  })

  it('Confirm sends exactly the two ids and the fingerprint that was shown, then re-reads from the server', async () => {
    await mount(payload())
    const before = gets().length
    await click(q('[data-testid="match-confirm"]'))
    expect(posts()).toEqual([{ action: 'match_confirm', outflowId: id(1), inflowId: id(2), fingerprint: FP(1, 2) }])
    expect(gets().length).toBe(before + 1) // the server is the only source of truth: the list is re-read after every decision
    expect(q('[data-testid="match-message"]')!.textContent).toContain('Match confirmed'); expect(q('[data-testid="match-message"]')!.dataset.kind).toBe('ok')
  })

  it('"Not a match" sends a rejection with the same evidence fingerprint', async () => {
    await mount(payload(), { outcome: 'rejected', pairId: id(98) })
    await click(q('[data-testid="match-reject"]'))
    expect(posts()).toEqual([{ action: 'match_reject', outflowId: id(1), inflowId: id(2), fingerprint: FP(1, 2) }])
    expect(q('[data-testid="match-message"]')!.textContent).toContain('not be suggested again')
  })

  it('a double tap sends ONE request (every action is disabled while one is in flight)', async () => {
    await mount(payload())
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const original = responder
    responder = async (url, init) => { if (init?.method === 'POST') await gate; return original(url, init) }
    await act(async () => { (q('[data-testid="match-confirm"]') as HTMLButtonElement).click() })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    expect((q('[data-testid="match-confirm"]') as HTMLButtonElement).disabled).toBe(true); expect((q('[data-testid="match-reject"]') as HTMLButtonElement).disabled).toBe(true)
    expect(q('[data-testid="match-confirm"]')!.textContent).toBe('Saving…')
    await act(async () => { (q('[data-testid="match-confirm"]') as HTMLButtonElement).click(); (q('[data-testid="match-reject"]') as HTMLButtonElement).click() })
    release(); await flush(); await flush()
    expect(posts()).toHaveLength(1)
  })

  it('a confirmed match shows its history and can be reversed only after an explicit second step; "Keep it" sends nothing', async () => {
    const confirmed = item(1, 2, { state: 'confirmed', actions: ['reverse'], reasons: ['You confirmed this transfer.'], history: [{ at: '2026-10-05T12:00:00Z', event: 'confirmed' }], decision: { at: '2026-10-05T12:00:00Z', legacy: false } })
    await mount(payload({ tab: 'confirmed', counts: counts({ confirmed: 1 }), items: [confirmed] }))
    expect(q('[data-testid="match-card"]')!.dataset.state).toBe('confirmed'); expect(q('[data-testid="match-state"]')!.textContent).toContain('Confirmed')
    expect(q('[data-testid="match-history"]')!.textContent).toContain('Confirmed Oct 5')
    expect(q('[data-testid="match-confirm"]')).toBeNull(); expect(q('[data-testid="match-reject"]')).toBeNull() // a confirmed match offers only Reverse
    await click(q('[data-testid="match-reverse"]'))
    expect(posts()).toEqual([]) // first tap only asks
    expect(q('[data-testid="match-reverse-panel"]')!.textContent).toContain('Nothing is deleted')
    await click(q('[data-testid="match-reverse-cancel"]'))
    expect(q('[data-testid="match-reverse-panel"]')).toBeNull(); expect(posts()).toEqual([])
    await click(q('[data-testid="match-reverse"]')); await click(q('[data-testid="match-reverse-confirm"]'))
    expect(posts()).toEqual([{ action: 'match_reverse', outflowId: id(1), inflowId: id(2) }]) // a reversal carries no fingerprint: it needs no live evidence
  })

  it('evidence-changed: lists what changed, keeps the confirmation visible, and "Confirm again" sends the CURRENT fingerprint', async () => {
    const changed = item(1, 2, { state: 'evidence_changed', needsReview: true, actions: ['reverse', 'reconfirm'], changes: ['The outgoing amount changed.', 'The incoming date changed.'], reasons: ['You confirmed this transfer.'], fingerprint: FP(1, 2) })
    await mount(payload({ tab: 'confirmed', counts: counts({ evidence_changed: 1 }), items: [changed] }))
    const c = q('[data-testid="match-card"]')!
    expect(c.dataset.state).toBe('evidence_changed'); expect(c.dataset.needsReview).toBe('true')
    expect(q('[data-testid="match-changes"]')!.textContent).toContain('The outgoing amount changed.'); expect(q('[data-testid="match-changes"]')!.textContent).toContain('The incoming date changed.')
    expect(q('[data-testid="match-state"]')!.textContent).toContain('Evidence changed')
    await click(q('[data-testid="match-reconfirm"]'))
    expect(posts()).toEqual([{ action: 'match_confirm', outflowId: id(1), inflowId: id(2), fingerprint: FP(1, 2) }])
  })

  it('rejected: shown under its own tab as "Not a match"; the owner can still change their mind (Confirm) but is not nagged', async () => {
    const rejected = item(1, 2, { state: 'rejected', actions: ['confirm'], reasons: ['You said this is not a match.'], history: [{ at: '2026-10-06T08:00:00Z', event: 'rejected' }] })
    await mount(payload({ tab: 'rejected', counts: counts({ rejected: 1 }), items: [rejected] }))
    expect(q('[data-testid="match-state"]')!.textContent).toContain('Not a match'); expect(q('[data-testid="match-history"]')!.textContent).toContain('Marked not a match Oct 6')
    expect(q('[data-testid="match-reject"]')).toBeNull(); expect(q('[data-testid="match-confirm"]')).toBeTruthy()
  })

  it('reversed: the pair is undecided again, says so, and is flagged for a fresh look', async () => {
    const reversed = item(1, 2, { state: 'reversed', needsReview: true, confidence: 'high', reasons: ['You reversed this earlier, so it is undecided again.'], history: [{ at: '2026-10-05T12:00:00Z', event: 'confirmed' }, { at: '2026-10-07T09:00:00Z', event: 'reversed' }] })
    await mount(payload({ counts: counts({ reversed: 1 }), items: [reversed] }))
    expect(q('[data-testid="match-state"]')!.textContent).toContain('Reversed'); expect(q('[data-testid="match-needs-review"]')).toBeTruthy()
    expect(q('[data-testid="match-history"]')!.textContent).toContain('Confirmed Oct 5 · Reversed Oct 7')
    expect(q('[data-testid="match-confirm"]')).toBeTruthy(); expect(q('[data-testid="match-reject"]')).toBeTruthy()
  })

  it('waiting (both legs pending): shown, explained, and offers no decision', async () => {
    const waiting = item(1, 2, { state: 'waiting', actions: [], outflow: leg(1, 500, '2026-10-10', 'TRANSFER', acct('Business Checking'), { pending: true }), inflow: leg(2, -500, '2026-10-10', 'TRANSFER', acct('Business Savings', { mask: '1234' }), { pending: true }) })
    await mount(payload({ counts: counts({ waiting: 1 }), items: [waiting] }))
    expect(q('[data-testid="match-state"]')!.textContent).toContain('Waiting to post'); expect(q('[data-testid="match-waiting"]')!.textContent).toContain('still pending')
    expect(q('[data-testid="match-actions"]')).toBeNull(); expect(qa('[data-testid="match-leg"]')[0].textContent).toContain('pending')
  })

  it('credit-card payments are labelled as payments on the card and a possible match shows its lower confidence', async () => {
    const pay = item(1, 2, { kind: 'card_payment', confidence: 'possible', needsReview: true, inflow: leg(2, -500, '2026-10-04', 'PAYMENT THANK YOU', acct('Business Card', { accountClass: 'credit_card', mask: '8080' })) })
    await mount(payload({ items: [pay] }))
    const c = q('[data-testid="match-card"]')!
    expect(c.textContent).toContain('Credit card payment'); expect(c.textContent).toContain('Payment on the card'); expect(c.textContent).toContain('Credit card')
    expect(q('[data-testid="match-confidence"]')!.textContent).toBe('Possible'); expect(q('[data-testid="match-needs-review"]')).toBeTruthy()
  })

  it('a business↔personal pair is flagged and explained before it can be confirmed', async () => {
    const cross = item(1, 2, { crossScope: true, confidence: 'possible', needsReview: true, inflow: leg(2, -500, '2026-10-04', 'TRANSFER IN', acct('Personal Checking', { ownership: 'personal', mask: '4321' })) })
    await mount(payload({ items: [cross] }))
    expect(q('[data-testid="match-cross-scope"]')!.textContent).toContain('Business ↔ Personal'); expect(q('[data-testid="match-cross-note"]')!.textContent).toContain('owner contribution or draw')
    expect(qa('[data-testid="match-leg"]')[1].textContent).toContain('Personal')
  })

  it('ambiguous movements are listed as one group; the owner picks the right pair and the candidate\'s own fingerprint is sent', async () => {
    const legs = { o1: leg(1, 500, '2026-10-03', 'TRANSFER A', acct('Business Checking')), o2: leg(2, 500, '2026-10-05', 'TRANSFER B', acct('Business Checking')), i1: leg(3, -500, '2026-10-04', 'IN A', acct('Business Savings', { mask: '1234' })), i2: leg(4, -500, '2026-10-06', 'IN B', acct('Business Savings', { mask: '1234' })) }
    const cand = (o: number, i: number, daysApart: number) => ({ outflowId: id(o), inflowId: id(i), kind: 'internal_transfer' as const, daysApart, confidence: 'possible' as const, crossScope: false, fingerprint: FP(o, i) })
    const group = { key: 'group:1,2:3,4', outflows: [legs.o1, legs.o2], inflows: [legs.i1, legs.i2], reasons: ['Two $500.00 movements could each match two others.'], candidates: [cand(2, 4, 1), cand(1, 4, 3), cand(1, 3, 1), cand(2, 3, 1)] }
    await mount(payload({ counts: counts({ ambiguous: 1 }), total: 0, items: [], groups: [group] }))
    expect(q('[data-testid="match-group"]')!.textContent).toContain('Several movements could match'); expect(q('[data-testid="match-group"]')!.textContent).toContain('Ambiguous')
    expect(q('[data-testid="match-group"]')!.textContent).toContain('Nothing is matched automatically') // the owner is told nothing was decided for them
    const cands = qa('[data-testid="match-candidate"]'); expect(cands).toHaveLength(4)
    expect(cands[0].textContent).toContain('Oct 3'); // shortest gap first, then stable order
    await click(cands[0].querySelector('[data-testid="match-candidate-confirm"]'))
    const [p] = posts(); expect(p.action).toBe('match_confirm'); expect(p.fingerprint).toMatch(/^v1\|o:/); expect(new Set([p.outflowId, p.inflowId]).size).toBe(2)
    expect(p.fingerprint).toContain(p.outflowId); expect(p.fingerprint).toContain(p.inflowId) // the fingerprint belongs to the chosen pair, not to another
  })

  it('more than six possible pairs are collapsed behind "Show all"', async () => {
    const outs = [1, 2, 3, 4].map(n => leg(n, 500, `2026-10-0${n}`, 'OUT', acct('Business Checking'))), ins = [5, 6, 7, 8].map(n => leg(n, -500, `2026-10-0${n - 3}`, 'IN', acct('Business Savings', { mask: '1234' })))
    const candidates = outs.flatMap(o => ins.map(i => ({ outflowId: o.id, inflowId: i.id, kind: 'internal_transfer' as const, daysApart: 1, confidence: 'possible' as const, crossScope: false, fingerprint: `v1|o:${o.id}:a:50000:2026-10-01:0|i:${i.id}:b:-50000:2026-10-01:0` })))
    await mount(payload({ counts: counts({ ambiguous: 1 }), total: 0, items: [], groups: [{ key: 'g', outflows: outs, inflows: ins, reasons: [], candidates }] }))
    expect(qa('[data-testid="match-candidate"]')).toHaveLength(6)
    await click(q('[data-testid="match-candidates-more"]')); expect(qa('[data-testid="match-candidate"]')).toHaveLength(16)
  })

  it('read-only until the reviewed database function is installed: proposals are visible, every action is disabled and nothing is sent', async () => {
    await mount(payload({ decisionsAvailable: false }))
    expect(q('[data-testid="match-readonly"]')!.textContent).toContain('database update that has not been installed')
    for (const t of ['match-confirm', 'match-reject']) expect((q(`[data-testid="${t}"]`) as HTMLButtonElement).disabled).toBe(true)
    await click(q('[data-testid="match-confirm"]')); expect(posts()).toEqual([])
  })

  it('tells the owner when the loaded history is incomplete', async () => {
    await mount(payload({ coverage: { complete: false, reason: 'Only 200 days were loaded.' } }))
    expect(q('[data-testid="match-coverage"]')!.textContent).toContain('Only 200 days were loaded.'); expect(q('[data-testid="match-coverage"]')!.textContent).toContain('may be missing')
  })

  it('a conflict from the server is shown in plain words, nothing is claimed saved, and the list is re-read', async () => {
    await mount(payload())
    const original = responder
    responder = (url, init) => init?.method === 'POST' ? { status: 409, body: { error: 'This match changed since you opened it. Refresh and review it again; nothing was saved.' } } : original(url, init)
    const before = gets().length
    await click(q('[data-testid="match-confirm"]'))
    const msg = q('[data-testid="match-message"]')!
    expect(msg.dataset.kind).toBe('error'); expect(msg.getAttribute('role')).toBe('alert'); expect(msg.textContent).toContain('nothing was saved')
    expect(gets().length).toBe(before + 1); expect(q('[data-testid="match-confirm"]')).toBeTruthy() // still decidable after a refresh
  })

  it('tabs request their own list from the server, show counts, and have friendly empty states', async () => {
    await mount((url: string) => {
      const tab = new URL(url, 'https://x.invalid').searchParams.get('tab')
      return tab === 'review' ? payload({ counts: counts({ suggested: 2, ambiguous: 1, confirmed: 3, rejected: 1 }), total: 1 }) : payload({ tab, counts: counts({ suggested: 2, ambiguous: 1, confirmed: 3, rejected: 1 }), total: 0, items: [], groups: [] })
    })
    expect(q('[data-testid="match-tab-review"]')!.textContent).toContain('3') // 2 suggested + 1 ambiguous group
    expect(q('[data-testid="match-tab-confirmed"]')!.textContent).toContain('3'); expect(q('[data-testid="match-tab-rejected"]')!.textContent).toContain('1')
    await click(q('[data-testid="match-tab-rejected"]'))
    expect(gets().some(u => u.includes('tab=rejected'))).toBe(true)
    expect(q('[data-testid="match-empty"]')!.textContent).toContain('not marked any match as wrong')
    expect(q('[data-testid="match-tab-rejected"]')!.getAttribute('aria-selected')).toBe('true')
  })

  it('"Show more" appends the next page instead of replacing the list', async () => {
    const page = (start: number, n: number) => Array.from({ length: n }, (_, k) => item(start + k * 2, start + k * 2 + 1))
    await mount((url: string) => new URL(url, 'https://x.invalid').searchParams.get('offset') === '0' ? payload({ total: 3, items: page(1, 2) }) : payload({ total: 3, items: page(101, 1) }))
    expect(qa('[data-testid="match-card"]')).toHaveLength(2); expect(q('[data-testid="match-more"]')!.textContent).toContain('1 left')
    await click(q('[data-testid="match-more"]'))
    expect(qa('[data-testid="match-card"]')).toHaveLength(3); expect(q('[data-testid="match-more"]')).toBeNull()
    expect(gets().some(u => u.includes('offset=2'))).toBe(true)
  })

  it('refunds use the existing category decisions: confirm, "not a refund" and undo each send the matching request, and say it is never income', async () => {
    const refundLeg = leg(10, -42, '2026-10-02', 'AMAZON REFUND', acct('Business Checking'))
    const original = leg(11, 42, '2026-09-20', 'AMAZON MKTPLACE', acct('Business Checking'))
    const suggested = { key: `refund:${id(10)}`, state: 'suggested' as const, confidence: 'high' as const, refund: refundLeg, original, candidates: [], reasons: ['Same merchant, same account, equal amount'] }
    await mount(payload({ counts: counts({ refunds: 1 }), total: 0, items: [], refunds: [suggested] }), { ok: true })
    expect(q('[data-testid="match-refund"]')!.textContent).toContain('Suggested refund'); expect(q('[data-testid="match-refund"]')!.textContent).toContain('never counted as income')
    await click(q('[data-testid="match-refund-confirm"]'))
    expect(posts()).toEqual([{ action: 'accept_suggestion', transactionId: id(10), dimension: 'bucket' }])
    expect(q('[data-testid="match-message"]')!.textContent).toContain('not counted as income')
    await click(q('[data-testid="match-refund-reject"]'))
    expect(posts()[1]).toEqual({ action: 'reject_suggestion', transactionId: id(10), dimension: 'bucket' })
  })

  it('a confirmed refund can be undone; an ambiguous refund lists its candidate purchases without claiming a link', async () => {
    const refundLeg = leg(10, -42, '2026-10-02', 'AMAZON REFUND', acct('Business Checking'))
    const confirmed = { key: `refund:${id(10)}`, state: 'confirmed' as const, confidence: null, refund: refundLeg, original: null, candidates: [], reasons: ['You confirmed this as a refund. It is shown as a refund, never as new income.'] }
    await mount(payload({ tab: 'confirmed', counts: counts(), total: 0, items: [], refunds: [confirmed] }), { ok: true })
    expect(q('[data-testid="match-refund"]')!.dataset.state).toBe('confirmed')
    await click(q('[data-testid="match-refund-undo"]'))
    expect(posts()).toEqual([{ action: 'undo', transactionId: id(10), dimension: 'bucket' }])
    const amb = { key: `refund:${id(12)}`, state: 'suggested' as const, confidence: 'ambiguous' as const, refund: refundLeg, original: null, candidates: [leg(11, 42, '2026-09-20', 'AMAZON A', acct('Business Checking')), leg(13, 42, '2026-09-22', 'AMAZON B', acct('Business Checking'))], reasons: [] }
    await act(async () => { root.unmount() }); root = createRoot(host)
    await mount(payload({ total: 0, items: [], refunds: [amb] }), { ok: true })
    const t = q('[data-testid="match-refund"]')!.textContent!
    expect(t).toContain('Several purchases fit'); expect(t).toContain('Could reverse one of'); expect(t).toContain('does not link to one purchase yet')
  })

  it('is quiet when the feature is off for the caller (403) and recovers from a failed first load with a retry', async () => {
    await mount(payload()); await act(async () => { root.unmount() }); root = createRoot(host)
    await mount(() => payload()); await act(async () => { root.unmount() }); root = createRoot(host)
    responder = () => ({ status: 403, body: { error: 'forbidden' } })
    fetchMock = vi.fn(async (url: string, init?: any) => { const r = await responder(url, init); return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body } }); vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<MatchReview />) }); await flush()
    expect(q('[data-testid="match-disabled"]')).toBeTruthy(); expect(q('[data-testid="match-card"]')).toBeNull()
    await act(async () => { root.unmount() }); root = createRoot(host)
    let fail = true
    responder = () => fail ? { status: 500, body: { error: 'Something went wrong.' } } : { body: payload() }
    await act(async () => { root.render(<MatchReview />) }); await flush()
    expect(q('[data-testid="match-error"]')!.textContent).toContain('Something went wrong.')
    fail = false; await click(q('[data-testid="match-error"] button'))
    expect(qa('[data-testid="match-card"]')).toHaveLength(1)
  })

  it('touch and keyboard contract: every action is a real button of at least 44px with an accessible name that names the amount and accounts; legs stack below the sm breakpoint', async () => {
    const confirmed = item(3, 4, { state: 'confirmed', actions: ['reverse'] })
    await mount(payload({ counts: counts({ suggested: 1, confirmed: 1 }), total: 2, items: [item(1, 2), confirmed] }))
    const buttons = qa('[data-testid="match-actions"] button, [data-testid="match-why-toggle"]')
    expect(buttons.length).toBeGreaterThanOrEqual(5)
    for (const b of buttons) { expect(b.tagName).toBe('BUTTON'); expect(b.className).toMatch(/min-h-\[44px\]/) }
    for (const t of ['match-confirm', 'match-reject', 'match-reverse']) expect(q(`[data-testid="${t}"]`)!.getAttribute('aria-label')).toMatch(/\$500\.00 from Business Checking to Business Savings/)
    const legs = q('[data-testid="match-legs"]')!
    expect(legs.className).toContain('grid'); expect(legs.className).toContain('sm:grid-cols-[1fr_auto_1fr]'); expect(legs.className).not.toMatch(/(^|\s)grid-cols-/) // one column by default (phone), three from sm
    expect(q('[data-testid="match-card"]')!.getAttribute('aria-label')).toContain('Move between your accounts')
  })
})
