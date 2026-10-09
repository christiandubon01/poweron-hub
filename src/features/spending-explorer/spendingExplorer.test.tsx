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
  account: { ref: 'a1', label: 'Tartan · Plaid Checking', mask: '0000', ownership: 'business', mappedTo: 'Wells Fargo Business Checking 6960', mapped: true },
  bucket: { key: 'fuel_vehicle', label: 'Fuel / Vehicle', state: 'suggested', confidence: 'high', reasons: ['The merchant looks like a fuel / vehicle merchant.'] },
  relationship: { kind: 'unknown', label: 'Unknown', target: null, state: 'none', confidence: null, reasons: [] },
  review: 'suggested', scope: { value: 'business', source: 'account' }, unassigned: true, repeatedPattern: false, pattern: null, ...over,
})
const analytics = (over: Record<string, unknown> = {}) => ({
  asOf: '2026-10-07', windowDays: 30,
  unassigned: { totalMinor: 128400, count: 31, previousMinor: 100000, deltaMinor: 28400, byBucket: [
    { key: 'fuel_vehicle', label: 'Fuel / Vehicle', totalMinor: 41200, count: 8, previousMinor: 0, deltaMinor: 41200, merchants: 3, repeatedMerchants: 0 },
    { key: 'materials', label: 'Materials', totalMinor: 33800, count: 5, previousMinor: 0, deltaMinor: 33800, merchants: 2, repeatedMerchants: 0 },
    { key: 'software_subscriptions', label: 'Software / Subscriptions', totalMinor: 17600, count: 4, previousMinor: 0, deltaMinor: 17600, merchants: 3, repeatedMerchants: 1 }] },
  knownBills: { totalMinor: 3800, count: 1, confirmedCount: 0, suggestedCount: 1 }, pending: { totalMinor: 3000, count: 1 }, review: { needsReviewCount: 6, repeatedPatternCount: 1 },
  unclassified: { totalMinor: 0, count: 0 },
  observations: [{ id: 'bucket:fuel_vehicle', basis: 'deterministic', text: 'Fuel / Vehicle $412 in 30 days · 3 merchants' }],
  suggestions: [{ id: 'sub:apple', basis: 'heuristic', title: 'Possible untracked recurring expense: Apple', detail: '$20 monthly pattern, not tied to any known bill.' }], ...over,
})
const payload = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  asOf: '2026-10-07', draftScope: 'abcdef0123456789', accounts: 'mapped', meta: { billCandidates: 4, activeObligations: 3, scheduledCommitments: 1, evidenceRows: 10, hiddenUnmapped: 0, olderThanPeriod: 0, periodFrom: '2026-07-10' }, analytics: analytics(), viewCounts: { review_queue: 8, all: 10, known_bills: 1, unassigned: 7, repeated_spending: 1, needs_review: 6 }, reviewCounts: { reviewed: 2, unreviewed: 8, excluded: 0 }, total: rows.length, rows,
  options: { batchBuckets: ['materials', 'fuel_vehicle', 'meals', 'tools_equipment'], maxBatch: 50, buckets: [{ key: 'materials', label: 'Materials', hint: '' }, { key: 'fuel_vehicle', label: 'Fuel / Vehicle', hint: '' }, { key: 'meals', label: 'Meals', hint: '' }, { key: 'tools_equipment', label: 'Tools & Equipment', hint: '' }, { key: 'customer_payment', label: 'Customer payment', hint: '', flow: 'in' }, { key: 'transfers', label: 'Transfers', hint: '' }], accounts: [{ ref: 'a1', label: 'Wells Fargo Business Checking 6960', mask: '0000' }],
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
  beforeEach(() => { window.localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  it('renders nothing for callers who may not review spending (403) and when there is no bank evidence', async () => {
    await mount({ status: 403, body: { error: 'Only owners and admins can review spending.' } })
    expect(host.textContent).toBe('')
    act(() => root.unmount()); root = createRoot(host)
    await mount(payload([], { viewCounts: { review_queue: 0, all: 0, known_bills: 0, unassigned: 0, repeated_spending: 0, needs_review: 0 } }))
    expect(host.textContent).toBe('')
  })

  it('glance state: a compact unassigned-spending snapshot with bucket bars, delta, and honest exclusions - and no auto-writes', async () => {
    await mount(payload([row()]))
    expect(host.querySelector('[data-testid="spending-total"]')!.textContent).toMatch(/\$1,284.*31 transactions/)
    expect(host.querySelector('[data-testid="spending-delta"]')!.textContent).toBe('$284 more than the previous 30 days') // BANK-6F D5: in words, neutral
    expect([...host.querySelectorAll('[data-testid="spending-bucket"]')].map(b => b.getAttribute('data-bucket'))).toEqual(['fuel_vehicle', 'materials', 'software_subscriptions'])
    // BANK-6F: known bills and pending are their own tiles; the wording no longer claims every known bill is outside the total (a merely possible bill match stays in it)
    expect(host.querySelector('[data-testid="spending-tile-bills"]')!.textContent).toBe('Known bills$381 bill, debt or payroll payment · confirmed or suggested')
    expect(host.querySelector('[data-testid="spending-tile-pending"]')!.textContent).toBe('Pending$301 transaction · not counted until posted')
    expect(host.textContent).toMatch(/Suggestions only\. Nothing here changes your balances, ledger or reports\./)
    expect(posts()).toEqual([]) // looking is never writing
  })

  it('offers the five owner views with counts, and switching a view re-queries the server', async () => {
    await mount(payload([row()]))
    const labels = [...host.querySelectorAll('[role="tab"]')].map(t => t.textContent!.replace(/\s+/g, ' ').trim())
    expect(labels).toEqual(['To Review 8', 'Reviewed 2', 'All 10', 'Known Bills 1', 'Unassigned Spending 7', 'Repeated Spending 1', 'Needs Review 6']) // an older server without viewCounts.reviewed falls back to reviewCounts.reviewed
    await click(host.querySelector('[data-testid="spending-view-known_bills"]'))
    expect(gets().slice(-1)[0]).toMatch(/view=known_bills/)
  })

  const chips = (el: Element) => [...el.querySelectorAll('span.rounded-full')].map(c => c.textContent)
  it('BANK-6C: the Reviewed tab shows its count, re-queries view=reviewed, marks confirmed decisions, shows business/personal, and keeps other filters', async () => {
    const confirmed = row({ id: 'c1', name: 'THE HOME DEPOT #6', merchant: 'THE HOME DEPOT #6', amountMinor: 12000, review: 'confirmed', bucket: { key: 'materials', label: 'Materials', state: 'confirmed', confidence: 'high', reasons: ['You confirmed this.'] } })
    const personal = row({ id: 'c2', merchant: 'CASA BLANCA RESTAURANT', amountMinor: 10000, review: 'confirmed', scope: { value: 'personal', source: 'owner' }, bucket: { key: 'personal_owner', label: 'Personal / Owner', state: 'confirmed', confidence: 'high', reasons: [] } })
    await mount(payload([confirmed, personal], { viewCounts: { review_queue: 8, reviewed: 58, all: 10, known_bills: 1, unassigned: 7, repeated_spending: 1, needs_review: 6 } }))
    expect(host.querySelector('[data-testid="spending-view-reviewed"]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Reviewed 58')
    await click(host.querySelector('[data-testid="spending-view-reviewed"]'))
    expect(gets().slice(-1)[0]).toMatch(/view=reviewed/)
    expect(host.querySelector('[data-testid="spending-reviewed-caption"]')!.textContent).toMatch(/you confirmed.*Suggestions are not counted as reviewed.*undo/)
    const rows = [...host.querySelectorAll('[data-testid="spending-row"]')] as HTMLElement[]
    expect(rows[0].textContent).toContain('✓ Materials'); expect(rows[0].textContent).not.toContain('suggested'); expect(chips(rows[0])).toContain('Business')
    expect(rows[1].textContent).toContain('✓ Personal / Owner'); expect(chips(rows[1])).toContain('Personal')
    expect(host.querySelectorAll('[data-testid="spending-select"]')).toHaveLength(0) // confirmed rows are never offered for batch approval
    // the Filters panel still works on top of Reviewed: the view stays "reviewed" and the bucket narrows it
    await click(host.querySelector('[data-testid="spending-filters-toggle"]'))
    const bucketSelect = [...host.querySelectorAll('label')].find(l => l.textContent!.startsWith('Bucket'))!.querySelector('select') as HTMLSelectElement
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(bucketSelect, 'materials'); bucketSelect.dispatchEvent(new Event('change', { bubbles: true })) }); await flush()
    expect(gets().slice(-1)[0]).toMatch(/view=reviewed/); expect(gets().slice(-1)[0]).toMatch(/bucket=materials/)
  })

  it('BANK-6C: a relationship-only confirmation is labelled "Category needs review" and its suggested category is never shown as approved', async () => {
    const relOnly = row({ id: 'r9', merchant: 'WELLS FARGO CREDIT CARD AUTOPAY', amountMinor: 35000, review: 'suggested',
      bucket: { key: 'materials', label: 'Materials', state: 'suggested', confidence: 'high', reasons: [] },
      relationship: { kind: 'debt', label: 'Debt payment', target: { type: 'debt_account', id: 'd1', label: 'Chase Ink Card' }, state: 'confirmed', confidence: 'high', reasons: ['You confirmed this.'] } })
    const unsuggested = row({ id: 'r10', merchant: 'ZZQ HOLDINGS', review: 'needs_review', bucket: { key: 'other_needs_review', label: 'Other / Needs Review', state: 'none', confidence: null, reasons: [] },
      relationship: { kind: 'overhead', label: 'General overhead', target: null, state: 'confirmed', confidence: 'high', reasons: [] } })
    const both = row({ id: 'r11', merchant: 'THE HOME DEPOT #6', review: 'confirmed', bucket: { key: 'materials', label: 'Materials', state: 'confirmed', confidence: 'high', reasons: [] },
      relationship: { kind: 'overhead', label: 'General overhead', target: null, state: 'confirmed', confidence: 'high', reasons: [] } })
    await mount(payload([relOnly, unsuggested, both]))
    await click(host.querySelector('[data-testid="spending-view-reviewed"]'))
    const [a, b, c] = [...host.querySelectorAll('[data-testid="spending-row"]')] as HTMLElement[]
    expect(a.querySelector('[data-testid="spending-category-needs-review"]')!.textContent).toBe('Relationship reviewed · Category needs review')
    expect(chips(a)).toContain('✓ Debt payment · Chase Ink Card')
    expect(chips(a)).toContain('Suggested · Materials'); expect(chips(a)).not.toContain('✓ Materials') // the suggestion is not shown as approved
    expect(b.querySelector('[data-testid="spending-category-needs-review"]')).not.toBeNull()
    expect(c.querySelector('[data-testid="spending-category-needs-review"]')).toBeNull(); expect(chips(c)).toContain('✓ Materials') // a confirmed category keeps its label
    // outside the Reviewed tab the extra label is not shown (no change to the other views)
    await click(host.querySelector('[data-testid="spending-view-review_queue"]'))
    expect(host.querySelector('[data-testid="spending-category-needs-review"]')).toBeNull()
  })

  it('BANK-6C: the scope chip appears only in the Reviewed tab', async () => {
    await mount(payload([row()]))
    expect(chips(host.querySelector('[data-testid="spending-row"]')!)).not.toContain('Business')
  })

  it('BANK-6C: undo from the Reviewed tab uses the existing undo action, then re-reads the server so the row and the count update', async () => {
    const confirmed = row({ id: 'c1', merchant: 'THE HOME DEPOT #6', amountMinor: 12000, review: 'confirmed', bucket: { key: 'materials', label: 'Materials', state: 'confirmed', confidence: 'high', reasons: ['You confirmed this.'] } })
    const before = payload([confirmed], { viewCounts: { review_queue: 8, reviewed: 1, all: 10, known_bills: 1, unassigned: 7, repeated_spending: 1, needs_review: 6 } })
    const after = payload([], { viewCounts: { review_queue: 9, reviewed: 0, all: 10, known_bills: 1, unassigned: 7, repeated_spending: 1, needs_review: 6 }, reviewCounts: { reviewed: 0, unreviewed: 9, excluded: 0 } })
    let undone = false
    fetchMock = vi.fn(async (_url: string, init?: any) => {
      if (init?.method === 'POST') { undone = true; return { ok: true, status: 200, json: async () => ({ outcome: 'undone' }) } }
      return { ok: true, status: 200, json: async () => (undone ? after : before) }
    })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<SpendingExplorer />) }); await flush()
    await click(host.querySelector('[data-testid="spending-view-reviewed"]'))
    await click(host.querySelector('[data-testid="spending-row"] button[aria-expanded]'))
    await click([...host.querySelectorAll('[data-testid="spending-detail"] button')].find(b => b.textContent === 'Undo')!)
    expect(posts()).toEqual([{ action: 'undo', transactionId: 'c1', dimension: 'bucket' }])
    expect(gets().slice(-1)[0]).toMatch(/view=reviewed/) // the same view is re-read from the server
    expect(host.querySelectorAll('[data-testid="spending-row"]')).toHaveLength(0)
    expect(host.querySelector('[data-testid="spending-view-reviewed"]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Reviewed 0')
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
    expect(rows[0].textContent).toMatch(/Suggested · Fuel \/ Vehicle/); expect(rows[0].textContent).toMatch(/Unassigned/); expect(rows[0].textContent).toMatch(/−\$62\.10/)
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
    // BANK-6F: the relationship kind is a group of buttons (none preselected); the target stays a menu for short lists
    const kind = async (k: string) => click(host.querySelector(`[data-testid="detail-rel-kind"][data-kind="${k}"]`))
    expect(d.querySelector('[data-testid="detail-category"]')!.textContent).toBe('No category confirmed yet')
    expect([...d.querySelectorAll('[data-testid="detail-rel-kind"]')].filter(b => b.getAttribute('aria-pressed') === 'true')).toHaveLength(0)
    // BANK-6E: the category is picked in a modal; nothing is sent until Apply, and Apply sends the same set_bucket decision as before
    await click(d.querySelector('[data-testid="detail-change-category"]'))
    expect((host.querySelector('[data-testid="bucket-picker-apply"]') as HTMLButtonElement).disabled).toBe(true)
    await click(host.querySelector('[data-testid="bucket-picker"] [data-option="materials"]'))
    expect(posts()).toEqual([])
    await click(host.querySelector('[data-testid="bucket-picker-apply"]'))
    expect(posts()[0]).toEqual({ action: 'set_bucket', transactionId: 'r1', bucket: 'materials' })
    expect(host.querySelector('[data-testid="bucket-picker"]')).toBeNull()
    await kind('project')
    const save = () => [...host.querySelectorAll('[data-testid="spending-detail"] button')].filter(b => b.textContent === 'Save').pop() as HTMLButtonElement
    expect(save().disabled).toBe(true) // no project chosen yet
    await set(host.querySelector('select[id^="t-"]') as HTMLSelectElement, 'project:p1'); expect(save().disabled).toBe(false); await click(save())
    expect(posts()[1]).toEqual({ action: 'set_relationship', transactionId: 'r1', kind: 'project', targetId: 'p1' })
    await kind('overhead'); await click(save())
    expect(posts()[2]).toEqual({ action: 'set_relationship', transactionId: 'r1', kind: 'overhead' })
    await kind('obligation'); await set(host.querySelector('select[id^="t-"]') as HTMLSelectElement, 'obligation:o1'); await click(save())
    expect(posts()[3]).toEqual({ action: 'set_relationship', transactionId: 'r1', kind: 'obligation', targetType: 'obligation', targetId: 'o1' })
  })

  it('pending rows can be categorized or ignored but offer no relationship controls', async () => {
    await mount(payload([row({ pending: true })]))
    await click(host.querySelector('[data-testid="spending-row"] button'))
    const d = host.querySelector('[data-testid="spending-detail"]')!
    expect(d.textContent).toMatch(/Pending: it can be categorized or ignored, but not given a relationship until it posts/)
    expect(d.querySelector('[data-testid="detail-rel-kind"]')).toBeNull(); expect(d.querySelector('[data-testid="detail-change-category"]')).not.toBeNull()
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

  describe('BANK-5D time windows, account scope and pattern wording', () => {
    it('states the two windows explicitly: summary = last 30 days, transactions/counts = the active period (default 90)', async () => {
      await mount(payload([row()]))
      expect(host.querySelector('[data-testid="spending-scope-caption"]')!.textContent).toBe('Summary: last 30 days · mapped accounts')
      expect(host.querySelector('[data-testid="spending-list-caption"]')!.textContent).toBe('Transactions: last 90 days · mapped accounts')
      expect(host.textContent).toMatch(/Unassigned spending · last 30 days/)
    })
    it('explains evidence outside the period compactly instead of hiding it silently', async () => {
      await mount(payload([row()], { meta: { billCandidates: 4, activeObligations: 3, scheduledCommitments: 1, evidenceRows: 49, hiddenUnmapped: 0, olderThanPeriod: 1, periodFrom: '2026-07-10' } }))
      expect(host.querySelector('[data-testid="spending-older-note"]')!.textContent).toBe('1 older transaction is outside the last 90 days.')
      act(() => root.unmount()); root = createRoot(host)
      await mount(payload([row()]))
      expect(host.querySelector('[data-testid="spending-older-note"]')).toBeNull() // nothing to explain, nothing shown
    })
    it('mapped accounts are the default; hidden unmapped evidence is disclosed with an explicit way to show all connected accounts', async () => {
      await mount(payload([row()], { meta: { billCandidates: 0, activeObligations: 0, scheduledCommitments: 0, evidenceRows: 49, hiddenUnmapped: 12, olderThanPeriod: 0, periodFrom: '2026-07-10' } }))
      expect(gets()[0]).toMatch(/accounts=mapped/)
      expect(host.querySelector('[data-testid="spending-unmapped-note"]')!.textContent).toMatch(/12 transactions from accounts not mapped to Cash OS are not included/)
      await click([...host.querySelectorAll('[data-testid="spending-unmapped-note"] button')][0])
      expect(gets().slice(-1)[0]).toMatch(/accounts=all/)
      expect(posts()).toEqual([]) // a view choice is never a write, and nothing is auto-mapped
    })
    it('in the all-accounts scope the page says so and offers the way back', async () => {
      await mount(payload([row()], { accounts: 'all' }))
      expect(host.querySelector('[data-testid="spending-all-note"]')!.textContent).toMatch(/Including accounts not mapped to Cash OS/)
      expect(host.querySelector('[data-testid="spending-scope-caption"]')!.textContent).toMatch(/all connected accounts/)
    })
    it('a repeated merchant reads as a repeating pattern; only bill-like context says "recurring bill"; no generic "Recurring" chip remains', async () => {
      const pattern = row({ id: 'r2', merchant: 'STARBUCKS', repeatedPattern: true, pattern: { cadence: 'weekly', occurrences: 4, kind: 'spending_pattern' } })
      const bill = row({ id: 'r3', merchant: 'ADOBE', repeatedPattern: true, pattern: { cadence: 'monthly', occurrences: 4, kind: 'obligation_like' } })
      await mount(payload([pattern, bill]))
      const chips = host.textContent!
      expect(chips).toMatch(/Repeats weekly/); expect(chips).toMatch(/Looks like a recurring bill/)
      expect(chips).not.toMatch(/Recurring Unknown/); expect(chips).not.toMatch(/Possible untracked subscription/)
    })
    it('unclassified spending is explained as review work, not waste, inside the collapsed signals', async () => {
      await mount(payload([row()], { analytics: analytics({ unclassified: { totalMinor: 320500, count: 8 } }) }))
      expect(host.querySelector('[data-testid="spending-unclassified-note"]')).toBeNull() // collapsed by default
      await click(host.querySelector('[data-testid="spending-signals-toggle"]'))
      expect(host.querySelector('[data-testid="spending-unclassified-note"]')!.textContent).toBe('$3,205 across 8 transactions is not classified yet. It stays in review and is not counted as wasteful spending.')
    })
  })

  describe('BANK-6A review queue, safe batch approval, history', () => {
    const batchable = (id: string, merchant: string) => row({ id, merchant, name: merchant })
    it('opens on the To Review queue with reviewed / unreviewed / excluded counts', async () => {
      await mount(payload([row()]))
      expect(gets()[0]).toMatch(/view=review_queue/)
      expect(host.querySelector('[data-testid="spending-review-counts"]')!.textContent).toBe('Reviewed 2 · Unreviewed 8 · Excluded 0')
      expect(host.querySelector('[data-testid="spending-view-review_queue"]')!.getAttribute('aria-selected')).toBe('true')
    })
    it('offers checkboxes ONLY on rows the server would approve in a batch (confident everyday expense category, posted, money out, no relationship suggestion)', async () => {
      const ok = batchable('a1', 'CHEVRON')
      const payroll = row({ id: 'p1', merchant: 'GUSTO', bucket: { key: 'payroll_people', label: 'Payroll / People', state: 'suggested', confidence: 'high', reasons: [] } })
      const pending = row({ id: 'p2', merchant: 'SHELL', pending: true })
      const possible = row({ id: 'p3', merchant: 'MAYBE', bucket: { key: 'fuel_vehicle', label: 'Fuel / Vehicle', state: 'suggested', confidence: 'possible', reasons: [] } })
      const deposit = row({ id: 'p4', merchant: 'MOBILE DEPOSIT', direction: 'money_in', amountMinor: -250000, bucket: { key: 'customer_payment', label: 'Customer payment', state: 'suggested', confidence: 'possible', reasons: [] } })
      const withRel = row({ id: 'p5', merchant: 'QB', relationship: { kind: 'obligation', label: 'Known bill', target: null, state: 'suggested', confidence: 'high', reasons: [] } })
      await mount(payload([ok, payroll, pending, possible, deposit, withRel]))
      const boxes = [...host.querySelectorAll('[data-testid="spending-select"]')]
      expect(boxes).toHaveLength(1)
      expect(boxes[0].getAttribute('aria-label')).toBe('Select CHEVRON for batch approval')
      expect(host.querySelector('[data-testid="spending-batch-bar"]')!.textContent).toMatch(/Payroll, transfers, owner draws, personal items, deposits and refunds always need your individual decision/)
    })
    it('Select + Approve posts ONLY the action and transaction ids, then explains what was left for individual review; nothing else is written', async () => {
      const a = batchable('a1', 'CHEVRON'), b = batchable('a2', 'SHELL')
      const summary = { outcome: 'batch', confirmed: 1, unchanged: 0, skipped: 1, results: [{ id: 'a1', result: 'confirmed' }, { id: 'a2', result: 'skipped', reason: 'not_high_confidence' }] }
      await mount(payload([a, b]), summary)
      await click(host.querySelector('[data-testid="spending-select-all"]'))
      expect(host.querySelector('[data-testid="spending-selected-count"]')!.textContent).toBe('2 selected')
      await click(host.querySelector('[data-testid="spending-approve-selected"]'))
      expect(posts()).toEqual([]) // asking to approve never writes: the owner must confirm the summary first
      await click(host.querySelector('[data-testid="spending-confirm-approve"]'))
      expect(posts()).toEqual([{ action: 'confirm_batch', transactionIds: ['a1', 'a2'] }])
      expect(host.querySelector('[data-testid="spending-batch-note"]')!.textContent).toBe('Approved 1. 1 left for individual review: 1 not a confident match.')
      expect(gets().length).toBeGreaterThan(1) // a fresh read follows: the server is the source of truth
    })
    it('the picker offers only categories that fit the direction of the money (a deposit gets Customer payment, not Materials)', async () => {
      const dep = row({ id: 'd1', merchant: 'MOBILE DEPOSIT', direction: 'money_in', amountMinor: -250000, bucket: { key: 'customer_payment', label: 'Customer payment', state: 'suggested', confidence: 'possible', reasons: [] } })
      await mount(payload([dep, row({ id: 'e1' })]))
      const rowsEls = [...host.querySelectorAll('[data-testid="spending-row"]')]
      await click(rowsEls[0].querySelector('button'))
      await click(rowsEls[0].querySelector('[data-testid="detail-change-category"]'))
      const opts = [...host.querySelectorAll('[data-testid="bucket-picker"] [role="radio"]')].map(o => o.getAttribute('data-option'))
      expect(opts).toEqual(['customer_payment', 'transfers'])
    })
    it('shows the audit trail on request only (read-only), including replaced decisions', async () => {
      await mount(payload([row()]))
      await click(host.querySelector('[data-testid="spending-row"] button'))
      expect(gets().some(u => /history=/.test(u))).toBe(false) // not loaded until asked
      fetchMock.mockImplementation(async (url: string, init?: any) => ({ ok: true, status: 200, json: async () => (/history=/.test(String(url)) ? { history: [{ label: 'Materials', kind: 'category', status: 'undone', source: 'rule', decidedAt: '2026-10-02T10:00:00Z', undoneAt: '2026-10-03T10:00:00Z', undoReason: 'changed_by_owner', createdAt: '2026-10-02T10:00:00Z' }, { label: 'Tools & Equipment', kind: 'category', status: 'confirmed', source: 'owner', decidedAt: '2026-10-03T10:00:00Z', undoneAt: null, undoReason: null, createdAt: '2026-10-03T10:00:00Z' }] } : payload([row()])) }))
      await click([...host.querySelectorAll('[data-testid="spending-history"] button')][0])
      const text = host.querySelector('[data-testid="spending-history"]')!.textContent!
      expect(text).toMatch(/Materials · undone \(replaced\) · from a suggestion/); expect(text).toMatch(/Tools & Equipment · active · by you/)
      expect(posts()).toEqual([])
    })
  })

  describe('BANK-6A visible batch selection, review and confirmation', () => {
    const mk = (id: string, merchant: string, bucketKey: string, bucketLabel: string, amountMinor: number, date: string) => row({ id, merchant, name: merchant, amountMinor, date, bucket: { key: bucketKey, label: bucketLabel, state: 'suggested', confidence: 'high', reasons: [] } })
    const three = () => [mk('a1', 'HOME DEPOT', 'materials', 'Materials', 12000, '2026-10-01'), mk('a2', 'CHEVRON', 'fuel_vehicle', 'Fuel / Vehicle', 6210, '2026-10-03'), mk('a3', 'SHELL', 'fuel_vehicle', 'Fuel / Vehicle', 4000, '2026-10-02')]
    const selectAll = async () => { await click(host.querySelector('[data-testid="spending-select-all"]')) }
    const count = () => host.querySelector('[data-testid="spending-selected-count"]')?.textContent ?? null
    const rowEls = () => [...host.querySelectorAll('[data-testid="spending-row"]')]
    const box = (i: number) => rowEls()[i].querySelector('input[type="checkbox"]') as HTMLInputElement

    it('every selected row is unmistakable: checked checkbox, highlighted row, a "Selected" chip - and unselected rows are not', async () => {
      await mount(payload([...three(), row({ id: 'z9', merchant: 'ZZQ', bucket: { key: 'materials', label: 'Materials', state: 'suggested', confidence: 'possible', reasons: [] } })]))
      expect(rowEls().every(r => r.getAttribute('data-selected') === 'false')).toBe(true)
      await selectAll()
      const sel = rowEls().filter(r => r.getAttribute('data-selected') === 'true')
      expect(sel).toHaveLength(3)
      for (const r of sel) {
        const cb = r.querySelector('input[type="checkbox"]') as HTMLInputElement
        expect(cb.checked).toBe(true)
        expect(r.textContent).toContain('✓ Selected')
        expect((r as HTMLElement).style.boxShadow).toMatch(/^0 0 0 2px/) // BANK-6D: a selection RING (the left edge belongs to the category stripe), plus the chip and the checkbox - never colour alone
      }
      const other = rowEls().find(r => r.textContent!.includes('ZZQ'))!
      expect(other.getAttribute('data-selected')).toBe('false'); expect(other.querySelector('input[type="checkbox"]')).toBeNull()
    })

    it('shows a persistent, live count with the outgoing total, and it follows every individual change', async () => {
      await mount(payload(three()))
      expect(count()).toBeNull()
      await selectAll()
      expect(count()).toBe('3 selected')
      expect(host.querySelector('[data-testid="spending-selection-bar"]')!.textContent).toContain('$222.10 going out') // 120.00 + 62.10 + 40.00
      await click(box(0))
      expect(count()).toBe('2 selected')
      await click(box(0)); expect(count()).toBe('3 selected')
      expect(host.querySelector('[data-testid="spending-selection-bar"]')!.getAttribute('aria-label')).toBe('Selected transactions')
    })

    it('Review selected shows ONLY the selected rows with merchant, date, signed amount, suggested category and account', async () => {
      await mount(payload([...three(), mk('a4', 'OTHER', 'meals', 'Meals', 900, '2026-10-04')]))
      await click(box(0)); await click(box(2)) // first and third rows only
      expect(count()).toBe('2 selected')
      await click(host.querySelector('[data-testid="spending-review-selected"]'))
      const items = [...host.querySelectorAll('[data-testid="spending-selected-item"]')]
      expect(items).toHaveLength(2)
      expect(host.querySelector('[data-testid="spending-list"]')).toBeNull() // the full queue is hidden while reviewing
      const text = items.map(i => i.textContent!.replace(/\s+/g, ' ')).join(' | ')
      expect(text).toMatch(/HOME DEPOT.*Oct 1.*Wells Fargo Business Checking 6960.*••••0000.*−\$120\.00/)
      const hd = items.find(i => i.textContent!.includes('HOME DEPOT'))!
      expect((hd.querySelector('select') as HTMLSelectElement).value).toBe('materials') // the suggested category is the control's current value
      expect([...hd.querySelectorAll('option')].find(o => (o as HTMLOptionElement).value === 'materials')!.textContent).toBe('Materials (suggested)')
      expect(text).toMatch(/CHEVRON|SHELL/); expect(text).not.toContain('OTHER')
      expect(host.querySelector('[data-testid="spending-review-selected"]')!.textContent).toBe('Back to review queue')
    })

    it('a tap in Review selected only UNchecks the line (it stays listed); Clear selection empties everything; going back keeps the selection', async () => {
      await mount(payload(three()))
      await selectAll()
      await click(host.querySelector('[data-testid="spending-review-selected"]'))
      await click(host.querySelectorAll('[data-testid="spending-selected-toggle"]')[0])
      expect(count()).toBe('2 selected'); expect(host.querySelectorAll('[data-testid="spending-selected-item"]')).toHaveLength(3) // still listed
      await click(host.querySelector('[data-testid="spending-review-selected"]')) // Back to review queue
      expect(host.querySelector('[data-testid="spending-selected-list"]')).toBeNull()
      expect(rowEls()).toHaveLength(3)
      expect(rowEls().filter(r => r.getAttribute('data-selected') === 'true')).toHaveLength(2) // nothing lost
      expect(count()).toBe('2 selected')
      await click(host.querySelector('[data-testid="spending-clear-selection"]'))
      expect(count()).toBeNull(); expect(host.querySelector('[data-testid="spending-selection-bar"]')).toBeNull()
      expect(rowEls().every(r => r.getAttribute('data-selected') === 'false')).toBe(true)
      expect(posts()).toEqual([])
    })

    it('the selection survives changing the view or filters', async () => {
      await mount(payload(three()))
      await selectAll()
      await click(host.querySelector('[data-testid="spending-view-all"]'))
      expect(count()).toBe('3 selected')
    })

    it('asking to approve shows an exact summary (count, category breakdown, total going out) and writes NOTHING until the owner confirms; Cancel writes nothing', async () => {
      await mount(payload(three()), { outcome: 'batch', confirmed: 3, unchanged: 0, skipped: 0, results: [] })
      await selectAll()
      await click(host.querySelector('[data-testid="spending-approve-selected"]'))
      expect(host.querySelector('[data-testid="spending-confirm-title"]')!.textContent).toBe('Approve 3 transactions?')
      const lines = [...host.querySelectorAll('[data-testid="spending-confirm-breakdown"] li')].map(l => l.textContent)
      expect(lines).toEqual(['Materials · 1$120.00', 'Fuel / Vehicle · 2$102.10'])
      expect(host.querySelector('[data-testid="spending-confirm-total"]')!.textContent).toBe('Total going out$222.10')
      expect(host.querySelector('[data-testid="spending-confirm"]')!.textContent).toMatch(/does not change your balances, ledger, bills, payroll or reports/)
      expect(posts()).toEqual([])
      await click(host.querySelector('[data-testid="spending-confirm-cancel"]'))
      expect(posts()).toEqual([]); expect(host.querySelector('[data-testid="spending-confirm"]')).toBeNull(); expect(count()).toBe('3 selected') // still selected
    })

    it('changing the selection while the summary is open voids it, so the owner always confirms exactly what is selected', async () => {
      await mount(payload(three()))
      await selectAll()
      await click(host.querySelector('[data-testid="spending-approve-selected"]'))
      expect(host.querySelector('[data-testid="spending-confirm"]')).not.toBeNull()
      await click(box(1))
      expect(host.querySelector('[data-testid="spending-confirm"]')).toBeNull()
      await click(host.querySelector('[data-testid="spending-approve-selected"]'))
      expect(host.querySelector('[data-testid="spending-confirm-title"]')!.textContent).toBe('Approve 2 transactions?')
    })

    it('Confirm sends ONLY the ids once; the server reply (what it actually approved or refused) is shown, and the selection is cleared', async () => {
      const reply = { outcome: 'batch', confirmed: 2, unchanged: 0, skipped: 1, results: [{ id: 'a1', result: 'confirmed' }, { id: 'a2', result: 'confirmed' }, { id: 'a3', result: 'skipped', reason: 'not_high_confidence' }] }
      await mount(payload(three()), reply)
      await selectAll()
      await click(host.querySelector('[data-testid="spending-approve-selected"]'))
      await click(host.querySelector('[data-testid="spending-confirm-approve"]'))
      expect(posts()).toHaveLength(1)
      expect(posts()[0]).toEqual({ action: 'confirm_batch', transactionIds: ['a2', 'a3', 'a1'] }) // ids only (newest first); no categories, amounts or eligibility claims are sent
      expect(host.querySelector('[data-testid="spending-batch-note"]')!.textContent).toBe('Approved 2. 1 left for individual review: 1 not a confident match.')
      expect(host.querySelector('[data-testid="spending-selection-bar"]')).toBeNull()
    })

    it('cannot select more than the server\'s batch limit', async () => {
      const many = Array.from({ length: 52 }, (_, i) => mk(`m${i}`, `SHOP ${i}`, 'materials', 'Materials', 1000, '2026-10-01'))
      await mount(payload(many))
      await selectAll()
      expect(count()).toBe('50 selected')
      await click(box(51))
      expect(count()).toBe('50 selected'); expect(host.querySelector('[data-testid="spending-batch-note"]')!.textContent).toBe('You can select up to 50 at a time.')
    })
  })

  describe('BANK-6A review: accidental taps, category corrections, reload safety', () => {
    const mk = (id: string, merchant: string, bucketKey: string, bucketLabel: string, amountMinor: number, date: string) => row({ id, merchant, name: merchant, amountMinor, date, bucket: { key: bucketKey, label: bucketLabel, state: 'suggested', confidence: 'high', reasons: [] } })
    const SCOPE = 'abcdef0123456789'
    const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    const mixed = () => [mk(u(1), 'STARBUCKS', 'meals', 'Meals', 500, '2026-10-05'), mk(u(2), 'CHIPOTLE', 'meals', 'Meals', 1200, '2026-10-04'), mk(u(3), 'KFC', 'meals', 'Meals', 800, '2026-10-03'),
      mk(u(4), 'AUTOZONE', 'fuel_vehicle', 'Fuel / Vehicle', 1195, '2026-10-02'), mk(u(5), 'HOME DEPOT', 'materials', 'Materials', 12000, '2026-10-01')]
    const count = () => host.querySelector('[data-testid="spending-selected-count"]')?.textContent ?? null
    const bar = () => host.querySelector('[data-testid="spending-selection-bar"]')?.textContent ?? ''
    const items = () => [...host.querySelectorAll('[data-testid="spending-selected-item"]')]
    const itemOf = (name: string) => items().find(i => i.textContent!.includes(name))!
    const queueRows = () => [...host.querySelectorAll('[data-testid="spending-row"]')]
    const tap = (name: string) => click(itemOf(name).querySelector('span.font-semibold'))
    const review = async () => { await click(host.querySelector('[data-testid="spending-select-all"]')); await click(host.querySelector('[data-testid="spending-review-selected"]')) }
    const pickCategory = async (name: string, key: string) => {
      const sel = itemOf(name).querySelector('select') as HTMLSelectElement
      await act(async () => { sel.value = key; sel.dispatchEvent(new Event('change', { bubbles: true })) }); await flush()
    }
    const stored = () => window.localStorage.getItem(`poweron.spending.review.draft.v1:${SCOPE}`)
    const remount = async (body: unknown, post: unknown = { outcome: 'created' }) => { act(() => root.unmount()); root = createRoot(host); await mount(body, post) }

    it('an accidental tap only UNchecks the line (it stays listed, visibly unchecked); a second tap restores it; count and total follow at once', async () => {
      await mount(payload(mixed()))
      await review()
      expect(items()).toHaveLength(5); expect(count()).toBe('5 selected'); expect(bar()).toContain('$156.95 going out')
      await tap('STARBUCKS')
      expect(items()).toHaveLength(5) // not removed
      const sb = itemOf('STARBUCKS')
      expect(sb.getAttribute('data-checked')).toBe('false'); expect((sb.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false); expect(sb.textContent).toContain('Not selected')
      expect(count()).toBe('4 selected'); expect(bar()).toContain('$151.95 going out')
      await tap('STARBUCKS')
      expect(itemOf('STARBUCKS').getAttribute('data-checked')).toBe('true'); expect(itemOf('STARBUCKS').textContent).toContain('✓ Selected')
      expect(count()).toBe('5 selected'); expect(bar()).toContain('$156.95 going out')
    })

    it('only CHECKED transactions are sent for approval', async () => {
      await mount(payload(mixed()), { outcome: 'batch', confirmed: 4, unchanged: 0, skipped: 0, results: [] })
      await review()
      await tap('STARBUCKS')
      await click(host.querySelector('[data-testid="spending-approve-selected"]'))
      expect(host.querySelector('[data-testid="spending-confirm-title"]')!.textContent).toBe('Approve 4 transactions?')
      await click(host.querySelector('[data-testid="spending-confirm-approve"]'))
      expect(posts()).toHaveLength(1)
      expect(posts()[0].transactionIds.sort()).toEqual([u(2), u(3), u(4), u(5)])
      expect(posts()[0].categoryOverrides).toBeUndefined() // no corrections were made
    })

    it('an unchecked line is also unchecked in the full queue, can be re-checked there, and the selection persists going back and forth', async () => {
      await mount(payload(mixed()))
      await review()
      await tap('KFC')
      await click(host.querySelector('[data-testid="spending-review-selected"]')) // back to the queue
      const kfc = queueRows().find(r => r.textContent!.includes('KFC'))!
      expect(kfc.getAttribute('data-selected')).toBe('false'); expect(queueRows()).toHaveLength(5)
      await click(kfc.querySelector('input[type="checkbox"]')) // re-check from the queue
      expect(count()).toBe('5 selected')
      await click(host.querySelector('[data-testid="spending-review-selected"]'))
      expect(itemOf('KFC').getAttribute('data-checked')).toBe('true')
    })

    it('"Uncheck all <category>" is one explicit tap, affects only that category, keeps every line listed, and saves nothing', async () => {
      await mount(payload(mixed()))
      await review()
      expect([...host.querySelectorAll('[data-testid="spending-uncheck-category"]')].map(b => b.textContent)).toEqual(['Uncheck all Meals (3)', 'Uncheck all Fuel / Vehicle (1)', 'Uncheck all Materials (1)'])
      expect(count()).toBe('5 selected')
      await click(host.querySelector('[data-testid="spending-uncheck-category"]'))
      expect(count()).toBe('2 selected'); expect(bar()).toContain('$131.95 going out'); expect(items()).toHaveLength(5)
      for (const m of ['STARBUCKS', 'CHIPOTLE', 'KFC']) expect(itemOf(m).getAttribute('data-checked')).toBe('false')
      await tap('CHIPOTLE'); expect(count()).toBe('3 selected') // individually restorable
      expect(posts()).toEqual([])
    })

    it('the owner can CORRECT a suggested category before approving: the change is shown, totals are by the corrected category, and the payload carries only the correction', async () => {
      await mount(payload(mixed()), { outcome: 'batch', confirmed: 5, unchanged: 0, skipped: 0, results: [] })
      await review()
      await pickCategory('AUTOZONE', 'tools_equipment')
      expect(itemOf('AUTOZONE').querySelector('[data-testid="spending-category-changed"]')!.textContent).toMatch(/Changed from the suggestion \(Fuel \/ Vehicle\)/)
      expect([...itemOf('AUTOZONE').querySelectorAll('option')].map(o => o.textContent)).toEqual(['Materials', 'Fuel / Vehicle (suggested)', 'Meals', 'Tools & Equipment'])
      expect([...host.querySelectorAll('[data-testid="spending-uncheck-category"]')].map(b => b.textContent)).toContain('Uncheck all Tools & Equipment (1)')
      await click(host.querySelector('[data-testid="spending-approve-selected"]'))
      expect([...host.querySelectorAll('[data-testid="spending-confirm-breakdown"] li')].map(l => l.textContent)).toEqual(['Materials · 1$120.00', 'Meals · 3$25.00', 'Tools & Equipment · 1$11.95'])
      expect(host.querySelector('[data-testid="spending-confirm-total"]')!.textContent).toBe('Total going out$156.95')
      await click(host.querySelector('[data-testid="spending-confirm-approve"]'))
      expect(posts()[0].categoryOverrides).toEqual({ [u(4)]: 'tools_equipment' })
      expect(posts()[0].transactionIds).toHaveLength(5)
    })

    it('a category correction survives going to the queue and back, shows on the queue row, and choosing the suggestion again clears it', async () => {
      await mount(payload(mixed()))
      await review()
      await pickCategory('AUTOZONE', 'tools_equipment')
      await click(host.querySelector('[data-testid="spending-review-selected"]'))
      expect(queueRows().find(r => r.textContent!.includes('AUTOZONE'))!.textContent).toContain('Your category: Tools & Equipment')
      await click(host.querySelector('[data-testid="spending-review-selected"]'))
      expect((itemOf('AUTOZONE').querySelector('select') as HTMLSelectElement).value).toBe('tools_equipment')
      await pickCategory('AUTOZONE', 'fuel_vehicle')
      expect(itemOf('AUTOZONE').querySelector('[data-testid="spending-category-changed"]')).toBeNull()
    })

    it('the category list offers only everyday expense categories (never payroll, personal, transfers, owner draw) and changing a category voids an open confirmation', async () => {
      await mount(payload(mixed()))
      await review()
      expect([...itemOf('KFC').querySelectorAll('option')].map(o => (o as HTMLOptionElement).value)).toEqual(['materials', 'fuel_vehicle', 'meals', 'tools_equipment'])
      await click(host.querySelector('[data-testid="spending-approve-selected"]'))
      expect(host.querySelector('[data-testid="spending-confirm"]')).not.toBeNull()
      await pickCategory('KFC', 'materials')
      expect(host.querySelector('[data-testid="spending-confirm"]')).toBeNull()
    })

    it('the draft is saved as IDS and category choices only (no merchant, amount or account detail), under an account-scoped key', async () => {
      await mount(payload(mixed()))
      await review()
      await tap('KFC'); await pickCategory('AUTOZONE', 'tools_equipment')
      const raw = stored()!
      const draft = JSON.parse(raw)
      expect(draft.ids.sort()).toEqual([u(1), u(2), u(3), u(4), u(5)]); expect(draft.off).toEqual([u(3)]); expect(draft.overrides).toEqual({ [u(4)]: 'tools_equipment' })
      for (const secret of ['STARBUCKS', 'AUTOZONE', 'KFC', '1195', '12000', 'Wells', '6960']) expect(raw).not.toContain(secret)
      expect(Object.keys(window.localStorage)).toEqual([`poweron.spending.review.draft.v1:${SCOPE}`])
    })

    it('an accidental reload restores the review - selected, unchecked and corrected - but never an approval: nothing is confirmed or sent', async () => {
      await mount(payload(mixed()))
      await review()
      await tap('KFC'); await pickCategory('AUTOZONE', 'tools_equipment')
      await click(host.querySelector('[data-testid="spending-approve-selected"]')) // a confirmation is open at the moment of the "reload"
      await remount(payload(mixed()))
      expect(count()).toBe('4 selected'); expect(bar()).toContain('$148.95 going out')
      expect(host.querySelector('[data-testid="spending-confirm"]')).toBeNull() // the confirmation was NOT restored
      expect(queueRows().find(r => r.textContent!.includes('AUTOZONE'))!.textContent).toContain('Your category: Tools & Equipment')
      expect(queueRows().find(r => r.textContent!.includes('KFC'))!.getAttribute('data-selected')).toBe('false')
      expect(posts()).toEqual([])
      await click(host.querySelector('[data-testid="spending-review-selected"]'))
      expect(items()).toHaveLength(5); expect((itemOf('AUTOZONE').querySelector('select') as HTMLSelectElement).value).toBe('tools_equipment')
    })

    it('restored ids are reconciled against CURRENT eligible evidence: a row decided in the meantime is dropped, and the draft is rewritten without it', async () => {
      await mount(payload(mixed()))
      await review()
      const changed = mixed(); changed[0] = row({ ...changed[0], bucket: { key: 'meals', label: 'Meals', state: 'confirmed', confidence: 'high', reasons: [] }, review: 'confirmed' })
      await remount(payload(changed))
      expect(count()).toBe('4 selected'); expect(bar()).toContain('$151.95 going out')
      expect(JSON.parse(stored()!).ids).not.toContain(u(1))
    })

    it('saved ids that are not on the loaded page wait (with a note) instead of being guessed; once the whole queue has loaded without them they are dropped', async () => {
      await mount(payload(mixed()))
      await review()
      await remount(payload(mixed().slice(0, 3), { total: 10 })) // only 3 of the 5 loaded, 10 exist
      expect(count()).toBe('3 selected')
      expect(host.querySelector('[data-testid="spending-pending-restore"]')!.textContent).toMatch(/2 saved selections are on transactions not loaded yet/)
      expect(JSON.parse(stored()!).ids).toHaveLength(5) // still kept
      await remount(payload(mixed().slice(0, 3))) // now the full queue (3 of 3) is loaded and they are not in it
      expect(host.querySelector('[data-testid="spending-pending-restore"]')).toBeNull()
      expect(JSON.parse(stored()!).ids.sort()).toEqual([u(1), u(2), u(3)])
    })

    it('a draft belongs to one organization and user: another scope, an expired draft, or garbage restores nothing', async () => {
      await mount(payload(mixed()))
      await review()
      await remount(payload(mixed(), { draftScope: 'ffffffffffffffff' }))
      expect(count()).toBeNull()
      window.localStorage.setItem(`poweron.spending.review.draft.v1:${SCOPE}`, JSON.stringify({ v: 1, at: Date.now() - 25 * 3600 * 1000, ids: [u(1)], off: [], overrides: {} }))
      await remount(payload(mixed()))
      expect(count()).toBeNull(); expect(stored()).toBeNull() // expired: discarded
      window.localStorage.setItem(`poweron.spending.review.draft.v1:${SCOPE}`, '{not json')
      await remount(payload(mixed()))
      expect(count()).toBeNull(); expect(stored()).toBeNull()
    })

    it('Clear selection and a successful approval remove the draft; a FAILED approval keeps the review so nothing has to be rebuilt', async () => {
      await mount(payload(mixed()), { outcome: 'batch', confirmed: 5, unchanged: 0, skipped: 0, results: [] })
      await review()
      expect(stored()).not.toBeNull()
      fetchMock.mockImplementation(async (_u: string, init?: any) => init?.method === 'POST'
        ? { ok: false, status: 503, json: async () => ({ error: 'The change could not be saved. Nothing was changed; please try again.' }) } : { ok: true, status: 200, json: async () => payload(mixed()) })
      await click(host.querySelector('[data-testid="spending-approve-selected"]'))
      await click(host.querySelector('[data-testid="spending-confirm-approve"]'))
      expect(count()).toBe('5 selected'); expect(stored()).not.toBeNull() // kept
      expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/could not be saved/)
      fetchMock.mockImplementation(async (_u: string, init?: any) => init?.method === 'POST'
        ? { ok: true, status: 200, json: async () => ({ outcome: 'batch', confirmed: 5, unchanged: 0, skipped: 0, results: [] }) } : { ok: true, status: 200, json: async () => payload(mixed()) })
      await click(host.querySelector('[data-testid="spending-approve-selected"]'))
      await click(host.querySelector('[data-testid="spending-confirm-approve"]'))
      expect(count()).toBeNull(); expect(stored()).toBeNull() // approved: the draft is gone
      await click(host.querySelector('[data-testid="spending-select-all"]')); expect(stored()).not.toBeNull()
      await click(host.querySelector('[data-testid="spending-clear-selection"]')); expect(stored()).toBeNull()
    })
  })
})
