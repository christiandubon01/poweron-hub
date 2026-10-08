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
  asOf: '2026-10-07', accounts: 'mapped', meta: { billCandidates: 4, activeObligations: 3, scheduledCommitments: 1, evidenceRows: 10, hiddenUnmapped: 0, olderThanPeriod: 0, periodFrom: '2026-07-10' }, analytics: analytics(), viewCounts: { review_queue: 8, all: 10, known_bills: 1, unassigned: 7, repeated_spending: 1, needs_review: 6 }, reviewCounts: { reviewed: 2, unreviewed: 8, excluded: 0 }, total: rows.length, rows,
  options: { batchBuckets: ['materials', 'fuel_vehicle', 'meals'], maxBatch: 50, buckets: [{ key: 'materials', label: 'Materials', hint: '' }, { key: 'fuel_vehicle', label: 'Fuel / Vehicle', hint: '' }, { key: 'customer_payment', label: 'Customer payment', hint: '', flow: 'in' }, { key: 'transfers', label: 'Transfers', hint: '' }], accounts: [{ ref: 'a1', label: 'Wells Fargo Business Checking 6960', mask: '0000' }],
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
    await mount(payload([], { viewCounts: { review_queue: 0, all: 0, known_bills: 0, unassigned: 0, repeated_spending: 0, needs_review: 0 } }))
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
    expect(labels).toEqual(['To Review 8', 'All 10', 'Known Bills 1', 'Unassigned Spending 7', 'Repeated Spending 1', 'Needs Review 6'])
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
      const opts = [...rowsEls[0].querySelectorAll('select#b-d1 option')].map(o => o.textContent)
      expect(opts).toEqual(['Choose a bucket…', 'Customer payment', 'Transfers'])
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
        expect((r as HTMLElement).style.boxShadow).toMatch(/inset/) // a highlight bar, not colour alone
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
      expect(text).toMatch(/HOME DEPOT.*Oct 1.*Wells Fargo Business Checking 6960.*••••0000.*Materials · suggested.*−\$120\.00/)
      expect(text).toMatch(/CHEVRON|SHELL/); expect(text).not.toContain('OTHER')
      expect(host.querySelector('[data-testid="spending-review-selected"]')!.textContent).toBe('Back to review queue')
    })

    it('rows can be deselected one by one inside the review, Clear selection empties it, and going back to the queue keeps the selection', async () => {
      await mount(payload(three()))
      await selectAll()
      await click(host.querySelector('[data-testid="spending-review-selected"]'))
      await click(host.querySelectorAll('[data-testid="spending-selected-remove"]')[0])
      expect(count()).toBe('2 selected'); expect(host.querySelectorAll('[data-testid="spending-selected-item"]')).toHaveLength(2)
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

  describe('BANK-6A deselecting inside Review selected', () => {
    const mk = (id: string, merchant: string, bucketKey: string, bucketLabel: string, amountMinor: number, date: string) => row({ id, merchant, name: merchant, amountMinor, date, bucket: { key: bucketKey, label: bucketLabel, state: 'suggested', confidence: 'high', reasons: [] } })
    const mixed = () => [mk('m1', 'STARBUCKS', 'meals', 'Meals', 500, '2026-10-05'), mk('m2', 'CHIPOTLE', 'meals', 'Meals', 1200, '2026-10-04'), mk('m3', 'KFC', 'meals', 'Meals', 800, '2026-10-03'),
      mk('f1', 'CHEVRON', 'fuel_vehicle', 'Fuel / Vehicle', 6210, '2026-10-02'), mk('h1', 'HOME DEPOT', 'materials', 'Materials', 12000, '2026-10-01')]
    const count = () => host.querySelector('[data-testid="spending-selected-count"]')?.textContent ?? null
    const total = () => host.querySelector('[data-testid="spending-selection-bar"]')?.textContent ?? ''
    const items = () => [...host.querySelectorAll('[data-testid="spending-selected-item"]')]
    const queueRows = () => [...host.querySelectorAll('[data-testid="spending-row"]')]
    const startReview = async () => {
      await click(host.querySelector('[data-testid="spending-select-all"]'))
      await click(host.querySelector('[data-testid="spending-review-selected"]'))
    }

    it('every line is a visible control: a checked checkbox and a "Remove" label, with an instruction above the list', async () => {
      await mount(payload(mixed()))
      await startReview()
      expect(items()).toHaveLength(5)
      for (const i of items()) {
        expect((i.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true)
        expect(i.textContent).toContain('Remove')
      }
      expect(host.querySelector('[data-testid="spending-selected-review"]')!.textContent).toMatch(/Tap a transaction to remove it from the selection\. Removing never approves or saves anything/)
    })

    it('tapping ANYWHERE on a line (its merchant name, not just the box) removes it at once, and the count and dollar total update immediately', async () => {
      await mount(payload(mixed()))
      await startReview()
      expect(count()).toBe('5 selected'); expect(total()).toContain('$207.10 going out') // 5.00 + 12.00 + 8.00 + 62.10 + 120.00
      const starbucks = items().find(i => i.textContent!.includes('STARBUCKS'))!
      await click(starbucks.querySelector('span.font-semibold'))
      expect(items().map(i => i.textContent).join('|')).not.toContain('STARBUCKS')
      expect(items()).toHaveLength(4)
      expect(count()).toBe('4 selected'); expect(total()).toContain('$202.10 going out')
      await click(items().find(i => i.textContent!.includes('HOME DEPOT'))!.querySelector('input'))
      expect(count()).toBe('3 selected'); expect(total()).toContain('$82.10 going out')
    })

    it('a removed transaction stays in the full To Review queue (unchecked), and the rest of the selection survives going back and forth', async () => {
      await mount(payload(mixed()))
      await startReview()
      await click(items().find(i => i.textContent!.includes('CHEVRON'))!.querySelector('span.font-semibold'))
      await click(host.querySelector('[data-testid="spending-review-selected"]')) // Back to review queue
      expect(host.querySelector('[data-testid="spending-selected-list"]')).toBeNull()
      expect(queueRows()).toHaveLength(5) // the queue still lists everything
      const chevron = queueRows().find(r => r.textContent!.includes('CHEVRON'))!
      expect(chevron.getAttribute('data-selected')).toBe('false'); expect((chevron.querySelector('input') as HTMLInputElement).checked).toBe(false)
      expect(queueRows().filter(r => r.getAttribute('data-selected') === 'true')).toHaveLength(4)
      await click(host.querySelector('[data-testid="spending-review-selected"]')) // Review selected again
      expect(items()).toHaveLength(4); expect(count()).toBe('4 selected')
    })

    it('one tap removes a whole suggested category (e.g. Meals) from the selection - only that category, and only the selection', async () => {
      await mount(payload(mixed()))
      await startReview()
      const buttons = [...host.querySelectorAll('[data-testid="spending-remove-category"]')]
      expect(buttons.map(b => b.textContent)).toEqual(['Remove all Meals (3)', 'Remove all Fuel / Vehicle (1)', 'Remove all Materials (1)'])
      expect(count()).toBe('5 selected') // nothing happens until the owner taps it
      await click(buttons[0])
      expect(count()).toBe('2 selected'); expect(total()).toContain('$182.10 going out')
      expect(items().map(i => i.textContent).join('|')).not.toMatch(/STARBUCKS|CHIPOTLE|KFC/)
      expect(items().map(i => i.textContent).join('|')).toMatch(/CHEVRON/); expect(items().map(i => i.textContent).join('|')).toMatch(/HOME DEPOT/)
      expect([...host.querySelectorAll('[data-testid="spending-remove-category"]')].map(b => b.textContent)).toEqual(['Remove all Fuel / Vehicle (1)', 'Remove all Materials (1)'])
      await click(host.querySelector('[data-testid="spending-review-selected"]'))
      expect(queueRows().filter(r => /STARBUCKS|CHIPOTLE|KFC/.test(r.textContent!)).every(r => r.getAttribute('data-selected') === 'false')).toBe(true)
      expect(queueRows()).toHaveLength(5) // all five are still in the queue to be reviewed
    })

    it('removing the last selected line leaves Review selected and returns to the full queue (the next selection does not jump into review)', async () => {
      await mount(payload([mk('only', 'CHEVRON', 'fuel_vehicle', 'Fuel / Vehicle', 6210, '2026-10-02'), mk('o2', 'SHELL', 'fuel_vehicle', 'Fuel / Vehicle', 4000, '2026-10-01')]))
      await startReview()
      await click(items()[0].querySelector('input')); await click(items()[0].querySelector('input'))
      expect(count()).toBeNull(); expect(host.querySelector('[data-testid="spending-selected-review"]')).toBeNull()
      expect(queueRows()).toHaveLength(2)
      await click((queueRows()[0].querySelector('input[type="checkbox"]')) as HTMLElement)
      expect(count()).toBe('1 selected'); expect(host.querySelector('[data-testid="spending-selected-review"]')).toBeNull() // still the queue, not the review list
    })

    it('removing anything (a line or a category) saves and approves NOTHING: no request is made, and any open confirmation is withdrawn', async () => {
      await mount(payload(mixed()))
      await startReview()
      const callsBefore = fetchMock.mock.calls.length
      await click(items()[0].querySelector('span.font-semibold'))
      await click(host.querySelector('[data-testid="spending-remove-category"]'))
      expect(posts()).toEqual([])
      expect(fetchMock.mock.calls.length).toBe(callsBefore) // not even a read: it is purely local selection state
      await click(host.querySelector('[data-testid="spending-approve-selected"]'))
      expect(host.querySelector('[data-testid="spending-confirm"]')).not.toBeNull()
      await click(items()[0].querySelector('span.font-semibold')) // changing the selection withdraws the open confirmation
      expect(host.querySelector('[data-testid="spending-confirm"]')).toBeNull()
      expect(posts()).toEqual([])
    })
  })
})
