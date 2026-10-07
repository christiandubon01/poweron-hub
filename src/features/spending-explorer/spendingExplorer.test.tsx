// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
import SpendingExplorer from './SpendingExplorer'
import { queryString, DEFAULT_FILTERS } from './useSpendingExplorer'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', date: '2026-10-03', name: 'CHEVRON 0098', merchant: 'CHEVRON', amountMinor: 6210, direction: 'money_out', pending: false,
  account: { ref: 'a1', label: 'Tartan · Plaid Checking', mask: '0000', ownership: 'business', mappedTo: 'Wells Fargo Business Checking 6960' },
  bucket: { key: 'fuel_vehicle', label: 'Fuel / Vehicle', state: 'suggested', confidence: 'high', reasons: ['The merchant looks like a fuel / vehicle merchant.'] },
  relationship: { kind: 'unknown', label: 'Unknown', target: null, state: 'none', confidence: null, reasons: [] },
  review: 'suggested', scope: { value: 'business', source: 'account' }, unassigned: true, recurringUnknown: false, recurring: null, ...over,
})
const analytics = (over: Record<string, unknown> = {}) => ({
  asOf: '2026-10-07', windowDays: 30,
  unassigned: { totalMinor: 128400, count: 31, previousMinor: 100000, deltaMinor: 28400, byBucket: [
    { key: 'fuel_vehicle', label: 'Fuel / Vehicle', totalMinor: 41200, count: 8, previousMinor: 0, deltaMinor: 41200, merchants: 3, recurringMerchants: 0 },
    { key: 'materials', label: 'Materials', totalMinor: 33800, count: 5, previousMinor: 0, deltaMinor: 33800, merchants: 2, recurringMerchants: 0 },
    { key: 'software_subscriptions', label: 'Software / Subscriptions', totalMinor: 17600, count: 4, previousMinor: 0, deltaMinor: 17600, merchants: 3, recurringMerchants: 1 }] },
  knownBills: { totalMinor: 3800, count: 1, confirmedCount: 0, suggestedCount: 1 }, pending: { totalMinor: 3000, count: 1 }, review: { needsReviewCount: 6, recurringUnknownCount: 1 },
  observations: [{ id: 'bucket:fuel_vehicle', basis: 'deterministic', text: 'Fuel / Vehicle $412 in 30 days · 3 merchants' }],
  suggestions: [{ id: 'sub:apple', basis: 'heuristic', title: 'Possible untracked recurring expense: Apple', detail: '$20 monthly pattern, not tied to any known bill.' }], ...over,
})
const payload = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  asOf: '2026-10-07', analytics: analytics(), viewCounts: { all: 10, known_bills: 1, unassigned: 7, recurring_unknown: 1, needs_review: 6 }, total: rows.length, rows,
  options: { buckets: [{ key: 'materials', label: 'Materials', hint: '' }, { key: 'fuel_vehicle', label: 'Fuel / Vehicle', hint: '' }], accounts: [{ ref: 'a1', label: 'Wells Fargo Business Checking 6960', mask: '0000' }],
    obligations: [{ id: 'o1', label: 'QuickBooks Online', amountMinor: 3800 }], commitments: [], debts: [{ id: 'd1', label: 'Chase Ink Card' }], projects: [{ id: 'p1', name: 'Desert Willow Remodel' }] }, ...over,
})

describe('SpendingExplorer (BANK-5)', () => {
  let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>
  const mount = async (get: unknown | { status: number; body: unknown }, post: unknown = { outcome: 'created' }) => {
    fetchMock = vi.fn(async (_url: string, init?: any) => {
      const r: any = init?.method === 'POST' ? { status: 200, body: post } : (get as any)?.status ? get : { status: 200, body: get }
      return { ok: r.status < 400, status: r.status, json: async () => r.body }
    })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<SpendingExplorer />) })
    await flush()
  }
  const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST').map(([, i]) => JSON.parse(i.body))
  const gets = () => fetchMock.mock.calls.filter(([, i]) => !i || i.method === 'GET').map(([u]) => String(u))
  const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click() }); await flush() }
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  it('renders nothing for callers who may not review spending (403) and when there is no bank evidence', async () => {
    await mount({ status: 403, body: { error: 'Only owners and admins can review spending.' } })
    expect(host.textContent).toBe('')
    act(() => root.unmount()); root = createRoot(host)
    await mount(payload([], { viewCounts: { all: 0, known_bills: 0, unassigned: 0, recurring_unknown: 0, needs_review: 0 } }))
    expect(host.textContent).toBe('')
  })

  it('glance state: a compact unassigned-spending snapshot with bucket bars, delta, and honest exclusions - and no auto-writes', async () => {
    await mount(payload([row()]))
    expect(host.querySelector('[data-testid="spending-total"]')!.textContent).toMatch(/\$1,284.*31 transactions/)
    expect(host.querySelector('[data-testid="spending-delta"]')!.textContent).toMatch(/▲ \$284 vs the previous 30 days/)
    expect([...host.querySelectorAll('[data-testid="spending-bucket"]')].map(b => b.getAttribute('data-bucket'))).toEqual(['fuel_vehicle', 'materials', 'software_subscriptions'])
    expect(host.textContent).toMatch(/1 known bill \(\$38\) matched, not counted above/); expect(host.textContent).toMatch(/1 pending \(\$30\) not counted until posted/)
    expect(host.textContent).toMatch(/Suggestions only\. Nothing here changes your balances, ledger or reports\./)
    expect(posts()).toEqual([]) // looking is never writing
  })

  it('offers the five owner views with counts, and switching a view re-queries the server', async () => {
    await mount(payload([row()]))
    const labels = [...host.querySelectorAll('[role="tab"]')].map(t => t.textContent!.replace(/\s+/g, ' ').trim())
    expect(labels).toEqual(['All 10', 'Known Bills 1', 'Unassigned Spending 7', 'Recurring Unknown 1', 'Needs Review 6'])
    await click(host.querySelector('[data-testid="spending-view-known_bills"]'))
    expect(gets().slice(-1)[0]).toMatch(/view=known_bills/)
  })

  it('selecting a bucket drills into that bucket (unassigned view + bucket filter) and a second tap clears it', async () => {
    await mount(payload([row()]))
    await click(host.querySelector('[data-bucket="materials"]'))
    expect(gets().slice(-1)[0]).toMatch(/view=unassigned/); expect(gets().slice(-1)[0]).toMatch(/bucket=materials/)
    await click(host.querySelector('[data-bucket="materials"]'))
    expect(gets().slice(-1)[0]).not.toMatch(/bucket=/)
  })

  it('filters are progressive: hidden by default, and each one is sent to the server', async () => {
    await mount(payload([row()]))
    expect(host.querySelector('[data-testid="spending-filters"]')).toBeNull()
    await click(host.querySelector('[data-testid="spending-filters-toggle"]'))
    const f = host.querySelector('[data-testid="spending-filters"]')!
    const select = (label: RegExp) => [...f.querySelectorAll('label')].find(l => label.test(l.textContent ?? ''))!.querySelector('select') as HTMLSelectElement
    await act(async () => { const s = select(/Business \/ personal/); s.value = 'personal'; s.dispatchEvent(new Event('change', { bubbles: true })) }); await flush()
    await act(async () => { const s = select(/Confidence/); s.value = 'high'; s.dispatchEvent(new Event('change', { bubbles: true })) }); await flush()
    expect(gets().slice(-1)[0]).toMatch(/scope=personal/); expect(gets().slice(-1)[0]).toMatch(/confidence=high/)
    expect(host.querySelector('[data-testid="spending-filters-toggle"]')!.textContent).toMatch(/Filters \(2\)/)
  })

  it('query building: period → from date, dollars → minor units, junk is dropped', () => {
    const q = new URLSearchParams(queryString({ ...DEFAULT_FILTERS, view: 'unassigned', days: 30, bucket: 'meals', min: '12.5', max: 'abc', search: 'depot' }, '2026-10-07'))
    expect(q.get('from')).toBe('2026-09-08'); expect(q.get('minMinor')).toBe('1250'); expect(q.get('maxMinor')).toBeNull(); expect(q.get('search')).toBe('depot'); expect(q.get('bucket')).toBe('meals')
  })

  it('a row shows pending/posted, bucket and relationship states without implying they are final', async () => {
    await mount(payload([row(), row({ id: 'r2', merchant: 'HOME DEPOT', pending: true, bucket: { key: 'materials', label: 'Materials', state: 'confirmed', confidence: 'high', reasons: ['You confirmed this.'] },
      relationship: { kind: 'project', label: 'Project', target: { type: 'project', id: 'p1', label: 'Desert Willow Remodel' }, state: 'confirmed', confidence: 'high', reasons: [] }, review: 'confirmed', unassigned: false })]))
    const rows = [...host.querySelectorAll('[data-testid="spending-row"]')]
    expect(rows[0].textContent).toMatch(/Fuel \/ Vehicle · suggested/); expect(rows[0].textContent).toMatch(/Unassigned/); expect(rows[0].textContent).toMatch(/−\$62\.10/)
    expect(rows[1].getAttribute('data-pending')).toBe('true'); expect(rows[1].textContent).toMatch(/Pending/)
    expect(rows[1].textContent).toMatch(/✓ Materials/); expect(rows[1].textContent).toMatch(/✓ Project · Desert Willow Remodel/)
  })

  it('opening a suggested row shows WHY, and confirming/rejecting is an explicit button that posts only the action and ids', async () => {
    await mount(payload([row()]))
    await click(host.querySelector('[data-testid="spending-row"] button'))
    const d = host.querySelector('[data-testid="spending-detail"]')!
    expect(d.textContent).toMatch(/The merchant looks like a fuel \/ vehicle merchant/); expect(d.textContent).toMatch(/High confidence/)
    expect(posts()).toEqual([])
    await click([...d.querySelectorAll('button')].find(b => b.textContent === 'Confirm Fuel / Vehicle')!)
    expect(posts()).toEqual([{ action: 'accept_suggestion', transactionId: 'r1', dimension: 'bucket' }])
    await click([...host.querySelectorAll('[data-testid="spending-detail"] button')].find(b => b.textContent === 'Not this')!)
    expect(posts()[1]).toEqual({ action: 'reject_suggestion', transactionId: 'r1', dimension: 'bucket' })
  })

  it('the owner picks a bucket and a relationship; a project is never preselected and needs an explicit target', async () => {
    await mount(payload([row({ bucket: { key: 'other_needs_review', label: 'Other / Needs Review', state: 'none', confidence: null, reasons: [] } })]))
    await click(host.querySelector('[data-testid="spending-row"] button'))
    const d = host.querySelector('[data-testid="spending-detail"]')!
    const set = async (sel: HTMLSelectElement, v: string) => { await act(async () => { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })) }); await flush() }
    const bucketSel = d.querySelector('select[id^="b-"]') as HTMLSelectElement, kindSel = d.querySelector('select[id^="k-"]') as HTMLSelectElement
    expect(bucketSel.value).toBe(''); expect(kindSel.value).toBe('')
    await set(bucketSel, 'materials'); await click([...d.querySelectorAll('button')].find(b => b.textContent === 'Save bucket')!)
    expect(posts()[0]).toEqual({ action: 'set_bucket', transactionId: 'r1', bucket: 'materials' })
    await set(kindSel, 'project')
    const save = () => [...host.querySelectorAll('[data-testid="spending-detail"] button')].filter(b => b.textContent === 'Save').pop() as HTMLButtonElement
    expect(save().disabled).toBe(true) // no project chosen yet
    await set(host.querySelector('select[id^="t-"]') as HTMLSelectElement, 'project:p1'); expect(save().disabled).toBe(false); await click(save())
    expect(posts()[1]).toEqual({ action: 'set_relationship', transactionId: 'r1', kind: 'project', targetId: 'p1' })
    await set(host.querySelector('select[id^="k-"]') as HTMLSelectElement, 'overhead'); await click(save())
    expect(posts()[2]).toEqual({ action: 'set_relationship', transactionId: 'r1', kind: 'overhead' })
    await set(host.querySelector('select[id^="k-"]') as HTMLSelectElement, 'obligation'); await set(host.querySelector('select[id^="t-"]') as HTMLSelectElement, 'obligation:o1'); await click(save())
    expect(posts()[3]).toEqual({ action: 'set_relationship', transactionId: 'r1', kind: 'obligation', targetType: 'obligation', targetId: 'o1' })
  })

  it('pending rows can be categorized or ignored but offer no relationship controls', async () => {
    await mount(payload([row({ pending: true })]))
    await click(host.querySelector('[data-testid="spending-row"] button'))
    const d = host.querySelector('[data-testid="spending-detail"]')!
    expect(d.textContent).toMatch(/Pending: it can be categorized or ignored, but not given a relationship until it posts/)
    expect(d.querySelector('select[id^="k-"]')).toBeNull(); expect(d.querySelector('select[id^="b-"]')).not.toBeNull()
    expect([...d.querySelectorAll('button')].map(b => b.textContent)).toContain('Ignore this transaction')
  })

  it('shows money-bleed signals separately labelled "measured" versus "possible issues (a heuristic)", collapsed by default', async () => {
    await mount(payload([row()]))
    expect(host.querySelector('[data-testid="spending-signals"]')).toBeNull()
    await click(host.querySelector('[data-testid="spending-signals-toggle"]'))
    const s = host.querySelector('[data-testid="spending-signals"]')!
    expect(s.textContent).toMatch(/Possible issues \(a heuristic: check before acting\)/); expect(s.textContent).toMatch(/Possible untracked recurring expense: Apple/)
    expect(s.textContent).toMatch(/Measured \(straight from your bank evidence\)/); expect(s.textContent).toMatch(/Fuel \/ Vehicle \$412 in 30 days/)
  })

  it('a failed decision shows the server message and a fresh read follows; the UI never assumes it worked', async () => {
    await mount(payload([row()]))
    fetchMock.mockImplementation(async (_u: string, init?: any) => init?.method === 'POST'
      ? { ok: false, status: 409, json: async () => ({ error: 'A pending transaction can only be categorized or ignored until it posts.' }) } : { ok: true, status: 200, json: async () => payload([row()]) })
    await click(host.querySelector('[data-testid="spending-row"] button'))
    await click([...host.querySelectorAll('[data-testid="spending-detail"] button')].find(b => b.textContent === 'Ignore this transaction')!)
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/pending transaction can only be categorized or ignored/)
  })

  it('never exposes secrets, provider ids or raw payloads', async () => {
    await mount(payload([row()]))
    expect(host.innerHTML).not.toMatch(/access-|v1:|encrypted|provider_transaction_id|raw_payload|PLAID_SECRET/i)
  })
})
