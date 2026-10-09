// @vitest-environment happy-dom
/**
 * BANK-6F FINANCIAL CONTRACT. Written BEFORE the redesign and run after every step.
 *
 * The EXPECTED requests below are the contract: every owner decision must send exactly these bodies to exactly this endpoint, every view or filter must
 * send exactly these query parameters, and looking, opening, cancelling or closing must send nothing. The small "drivers" find a control whether it is
 * the pre-6F native menu or the 6F sheet / button, so this file does not need to change while the presentation does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
import SpendingExplorer from './SpendingExplorer'
import SmartReview from './SmartReview'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const ENDPOINT = '/.netlify/functions/plaid-spending'
const flush = async (ms = 5) => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }

// ---------- fixtures (Explorer) ----------
const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', date: '2026-10-03', name: 'CHEVRON 0098', merchant: 'CHEVRON', amountMinor: 6210, direction: 'money_out', pending: false,
  account: { ref: 'a1', label: 'Plaid Checking', mask: '0000', ownership: 'business', mappedTo: 'Wells Fargo Business Checking 6960', mapped: true },
  bucket: { key: 'fuel_vehicle', label: 'Fuel / Vehicle', state: 'suggested', confidence: 'high', reasons: ['The merchant looks like a fuel / vehicle merchant.'] },
  relationship: { kind: 'unknown', label: 'Unknown', target: null, state: 'none', confidence: null, reasons: [] },
  review: 'suggested', scope: { value: 'business', source: 'account' }, unassigned: true, repeatedPattern: false, pattern: null, ...over,
})
const explorerPayload = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  asOf: '2026-10-07', draftScope: 'abcdef0123456789', accounts: 'mapped', environment: 'production',
  meta: { billCandidates: 0, activeObligations: 1, scheduledCommitments: 0, evidenceRows: 10, hiddenUnmapped: 3, olderThanPeriod: 0, periodFrom: '2026-07-10' },
  analytics: { asOf: '2026-10-07', windowDays: 30,
    unassigned: { totalMinor: 75000, count: 13, previousMinor: 60000, deltaMinor: 15000, byBucket: [
      { key: 'fuel_vehicle', label: 'Fuel / Vehicle', totalMinor: 41200, count: 8, previousMinor: 0, deltaMinor: 41200, merchants: 3, repeatedMerchants: 0 },
      { key: 'materials', label: 'Materials', totalMinor: 33800, count: 5, previousMinor: 0, deltaMinor: 33800, merchants: 2, repeatedMerchants: 0 }] },
    knownBills: { totalMinor: 3800, count: 1, confirmedCount: 0, suggestedCount: 1 }, pending: { totalMinor: 0, count: 0 }, review: { needsReviewCount: 6, repeatedPatternCount: 0 },
    unclassified: { totalMinor: 0, count: 0 }, observations: [], suggestions: [] },
  viewCounts: { review_queue: 8, reviewed: 2, all: 10, known_bills: 1, unassigned: 7, repeated_spending: 1, needs_review: 6 }, reviewCounts: { reviewed: 2, unreviewed: 8, excluded: 0 },
  total: rows.length, rows,
  options: { batchBuckets: ['materials', 'fuel_vehicle', 'meals', 'tools_equipment'], maxBatch: 50,
    buckets: [{ key: 'materials', label: 'Materials', hint: '' }, { key: 'fuel_vehicle', label: 'Fuel / Vehicle', hint: '' }, { key: 'meals', label: 'Meals', hint: '' }, { key: 'tools_equipment', label: 'Tools & Equipment', hint: '' }, { key: 'customer_payment', label: 'Customer payment', hint: '', flow: 'in' }, { key: 'transfers', label: 'Transfers', hint: '' }],
    accounts: [{ ref: 'a1', label: 'Wells Fargo Business Checking 6960', mask: '0000' }],
    obligations: [{ id: 'o1', label: 'QuickBooks Online', amountMinor: 3800 }], commitments: [], debts: [{ id: 'd1', label: 'Chase Ink Card' }], projects: [{ id: 'p1', name: 'Desert Willow Remodel' }] },
  ...over,
})

// ---------- fixtures (Smart Review) ----------
const SCOPE = 'abcdef0123456789'
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sRows = (start: number, amounts: number[]) => amounts.map((a, i) => ({ id: uid(start + i), date: `2026-09-0${i + 1}`, name: 'TX', amountMinor: a, flags: [] }))
const sGroup = (over: Record<string, unknown>) => ({ id: 'g', merchantKey: 'G', merchant: 'G', bucket: { key: 'software_subscriptions', label: 'Software / Subscriptions' }, confidence: 'high', basis: 'merchant_rule', needsChoice: false, mixed: false, count: 0, totalMinor: 0, flaggedCount: 0, reasons: [], rows: [], ...over })
const smartPayload = () => ({
  asOf: '2026-10-07', accounts: 'mapped', draftScope: SCOPE, rulesAvailable: true, maxBatch: 100,
  merchantRules: [{ merchantKey: 'ADOBE', label: 'ADOBE', category: 'software_subscriptions', categoryLabel: 'Software / Subscriptions' }],
  groups: [
    sGroup({ id: 'NETLIFY|software_subscriptions', merchantKey: 'NETLIFY', merchant: 'NETLIFY', count: 2, totalMinor: 3800, rows: sRows(1, [1900, 1900]) }),
    sGroup({ id: 'VONS|meals', merchantKey: 'VONS', merchant: 'VONS', bucket: { key: 'meals', label: 'Meals' }, confidence: 'possible', needsChoice: true, mixed: true, count: 1, totalMinor: 8351, rows: sRows(10, [8351]) }),
  ],
  exceptions: [{ reason: 'owner_or_personal', label: 'Owner draws and personal', count: 1, totalMinor: 100000, rows: [{ id: uid(50), date: '2026-09-23', name: 'OWNER DRAW', merchant: 'OWNER DRAW', amountMinor: 100000, direction: 'money_out', reason: 'owner_or_personal', why: 'Owner draws and personal spending are your individual decision.', suggested: { key: 'owner_draw', label: 'Owner draw', confidence: 'possible' } }] }],
  totals: { groupedCount: 3, groupedMinor: 12151, groups: 2, exceptionCount: 1 },
  options: { buckets: [{ key: 'materials', label: 'Materials', hint: '' }, { key: 'fuel_vehicle', label: 'Fuel / Vehicle', hint: '' }, { key: 'software_subscriptions', label: 'Software / Subscriptions', hint: '' }, { key: 'meals', label: 'Meals', hint: '' }, { key: 'personal_owner', label: 'Personal / Owner', hint: '' }, { key: 'customer_payment', label: 'Customer payment', hint: '', flow: 'in' }],
    batchBuckets: ['materials', 'fuel_vehicle', 'software_subscriptions', 'meals'] },
})

// ---------- harness ----------
let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: (init?.method ?? 'GET') as string, body: init?.body ? JSON.parse(init.body) : undefined }))
const posts = () => calls().filter(c => c.method === 'POST')
const gets = () => calls().filter(c => c.method === 'GET').map(c => c.url)
const lastQuery = () => Object.fromEntries(new URLSearchParams(gets().slice(-1)[0].split('?')[1]))
const click = async (el: Element | null | undefined) => { expect(el, 'control not found').toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await flush() }
const setValue = async (el: HTMLSelectElement | HTMLInputElement, value: string, wait = 5) => {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }); await flush(wait)
}
const mount = async (node: React.ReactNode, get: unknown, post: unknown = { outcome: 'created' }) => {
  fetchMock = vi.fn(async (_url: string, init?: any) => ({ ok: true, status: 200, json: async () => (init?.method === 'POST' ? post : get) }))
  vi.stubGlobal('fetch', fetchMock)
  await act(async () => { root.render(node) }); await flush()
}
beforeEach(() => { window.localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

// ---------- drivers (pre-6F native menus OR 6F sheets / buttons) ----------
const q = (sel: string, el: ParentNode = host) => el.querySelector(sel) as HTMLElement | null
const byText = (el: ParentNode, text: string) => [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === text) as HTMLButtonElement | undefined
const detail = () => q('[data-testid="spending-detail"]')!
const openRow = (i = 0) => click(host.querySelectorAll('[data-testid="spending-row"] button[aria-expanded]')[i])
/** Pick an option inside whichever sheet is open (category or relationship target), then Apply. */
const sheetPick = async (key: string) => {
  const sheet = q('[role="dialog"]')!; expect(sheet, 'sheet not open').toBeTruthy()
  await click(sheet.querySelector(`[data-option="${key}"]`))
  await click(q('[data-testid$="-apply"]', q('[role="dialog"]')!) ?? q('[data-testid="bucket-picker-apply"]'))
}
/** A control that is a native <select> before 6F and a sheet trigger after it. */
const choose = async (control: HTMLElement | null, key: string) => {
  expect(control, 'choice control not found').toBeTruthy()
  if (control instanceof HTMLSelectElement) { await setValue(control, key); return }
  await click(control); await sheetPick(key)
}
const relKind = (kind: string) => (q('select[id^="k-"]', detail()) as HTMLSelectElement | null) ?? q(`[data-testid="detail-rel-kind"][data-kind="${kind}"]`, detail())
const setRelationship = async (kind: string, target?: string) => {
  const k = relKind(kind)
  if (k instanceof HTMLSelectElement) await setValue(k, kind); else await click(k)
  if (target) await choose((q('select[id^="t-"]', detail()) as HTMLElement | null) ?? q('[data-testid="detail-rel-target"]', detail()), target)
  await click([...detail().querySelectorAll('button')].filter(b => b.textContent!.trim() === 'Save').pop())
}
const filtersPanel = async () => { if (!q('[data-testid="spending-filters"]')) await click(q('[data-testid="spending-filters-toggle"]')); return q('[data-testid="spending-filters"]')! }
const filterControl = (panel: HTMLElement, label: RegExp) => [...panel.querySelectorAll('label')].find(l => label.test(l.textContent ?? ''))?.querySelector('select, input') as HTMLSelectElement | HTMLInputElement
const setPeriod = async (days: number) => {
  const seg = q(`[data-testid="spending-period-${days}"]`)
  if (seg) { await click(seg); return }
  await setValue(filterControl(await filtersPanel(), /^Period/) as HTMLSelectElement, String(days))
}
const setSearch = async (text: string) => {
  const box = (q('[data-testid="spending-search"]') as HTMLInputElement | null) ?? filterControl(await filtersPanel(), /^Merchant search/) as HTMLInputElement
  await setValue(box, text, 300) // the hook debounces search by 250ms
}

describe('BANK-6F financial contract · Explorer decisions', () => {
  it('confirm / reject a suggested category send exactly accept_suggestion / reject_suggestion', async () => {
    await mount(<SpendingExplorer />, explorerPayload([row()]))
    await openRow()
    expect(posts()).toEqual([]) // opening a transaction is never a write
    await click(byText(detail(), 'Confirm Fuel / Vehicle'))
    await click(byText(detail(), 'Not this'))
    expect(posts()).toEqual([
      { url: ENDPOINT, method: 'POST', body: { action: 'accept_suggestion', transactionId: 'r1', dimension: 'bucket' } },
      { url: ENDPOINT, method: 'POST', body: { action: 'reject_suggestion', transactionId: 'r1', dimension: 'bucket' } },
    ])
  })

  it('choosing a category sends exactly set_bucket; opening, cancelling and Escape send nothing', async () => {
    await mount(<SpendingExplorer />, explorerPayload([row({ bucket: { key: 'other_needs_review', label: 'Other / Needs Review', state: 'none', confidence: null, reasons: [] }, review: 'needs_review' })]))
    await openRow()
    await click(q('[data-testid="detail-change-category"]', detail()))
    await click(q('[role="dialog"] [data-option="materials"]'))
    await click(q('[data-testid="bucket-picker-cancel"]'))
    await click(q('[data-testid="detail-change-category"]', detail()))
    await act(async () => { q('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) }); await flush()
    expect(q('[role="dialog"]')).toBeNull()
    expect(posts()).toEqual([])
    await click(q('[data-testid="detail-change-category"]', detail()))
    await sheetPick('materials')
    expect(posts().map(p => p.body)).toEqual([{ action: 'set_bucket', transactionId: 'r1', bucket: 'materials' }])
  })

  it('undo a confirmed category, and ignore / stop ignoring, send exactly undo / ignore / unignore', async () => {
    const confirmed = row({ id: 'c1', review: 'confirmed', bucket: { key: 'materials', label: 'Materials', state: 'confirmed', confidence: 'high', reasons: [] } })
    await mount(<SpendingExplorer />, explorerPayload([confirmed]))
    await openRow()
    await click(byText(detail(), 'Undo'))
    await click(byText(detail(), 'Ignore this transaction'))
    expect(posts().map(p => p.body)).toEqual([{ action: 'undo', transactionId: 'c1', dimension: 'bucket' }, { action: 'ignore', transactionId: 'c1' }])
    act(() => root.unmount()); root = createRoot(host)
    await mount(<SpendingExplorer />, explorerPayload([row({ id: 'i1', review: 'ignored' })]))
    await openRow()
    await click(byText(detail(), 'Stop ignoring'))
    expect(posts().map(p => p.body)).toEqual([{ action: 'unignore', transactionId: 'i1' }])
  })

  it('relationships send exactly set_relationship with the same target fields; a suggested relationship is accepted / rejected the same way', async () => {
    await mount(<SpendingExplorer />, explorerPayload([row()]))
    await openRow()
    await setRelationship('project', 'project:p1')
    await setRelationship('overhead')
    await setRelationship('obligation', 'obligation:o1')
    await setRelationship('debt', 'debt:d1')
    expect(posts().map(p => p.body)).toEqual([
      { action: 'set_relationship', transactionId: 'r1', kind: 'project', targetId: 'p1' },
      { action: 'set_relationship', transactionId: 'r1', kind: 'overhead' },
      { action: 'set_relationship', transactionId: 'r1', kind: 'obligation', targetType: 'obligation', targetId: 'o1' },
      { action: 'set_relationship', transactionId: 'r1', kind: 'debt', targetId: 'd1' },
    ])
    act(() => root.unmount()); root = createRoot(host)
    await mount(<SpendingExplorer />, explorerPayload([row({ id: 's1', relationship: { kind: 'obligation', label: 'Known bill', target: { type: 'obligation', id: 'o1', label: 'QuickBooks Online' }, state: 'suggested', confidence: 'high', reasons: ['Matches a known bill.'] } })]))
    await openRow()
    const relSection = [...detail().querySelectorAll('section')].find(s => /belong/i.test(s.getAttribute('aria-label') ?? ''))!
    await click(byText(relSection, 'Confirm'))
    await click(byText(relSection, 'Not this'))
    expect(posts().map(p => p.body)).toEqual([
      { action: 'accept_suggestion', transactionId: 's1', dimension: 'relationship' },
      { action: 'reject_suggestion', transactionId: 's1', dimension: 'relationship' },
    ])
  })

  it('decision history is read only on request, with exactly the history query, and writes nothing', async () => {
    await mount(<SpendingExplorer />, explorerPayload([row()]))
    await openRow()
    expect(gets().some(u => u.includes('history='))).toBe(false)
    await click(q('[data-testid="spending-history"] button'))
    expect(gets().slice(-1)[0]).toBe(`${ENDPOINT}?history=r1`)
    expect(posts()).toEqual([])
  })
})

describe('BANK-6F financial contract · batch approval', () => {
  const mk = (id: string, merchant: string, key: string, label: string, amountMinor: number, date: string) => row({ id, merchant, name: merchant, amountMinor, date, bucket: { key, label, state: 'suggested', confidence: 'high', reasons: [] } })
  const three = () => [mk('a1', 'HOME DEPOT', 'materials', 'Materials', 12000, '2026-10-01'), mk('a2', 'CHEVRON', 'fuel_vehicle', 'Fuel / Vehicle', 6210, '2026-10-03'), mk('a3', 'AUTOZONE', 'fuel_vehicle', 'Fuel / Vehicle', 4000, '2026-10-02')]
  const reply = { outcome: 'batch', confirmed: 3, unchanged: 0, skipped: 0, results: [] }

  it('selecting, reviewing, asking to approve and cancelling send nothing; Confirm sends exactly confirm_batch with the ids (newest first)', async () => {
    await mount(<SpendingExplorer />, explorerPayload(three()), reply)
    await click(q('[data-testid="spending-select-all"]'))
    await click(q('[data-testid="spending-review-selected"]'))
    await click(q('[data-testid="spending-approve-selected"]'))
    await click(q('[data-testid="spending-confirm-cancel"]'))
    expect(posts()).toEqual([])
    await click(q('[data-testid="spending-approve-selected"]'))
    await click(q('[data-testid="spending-confirm-approve"]'))
    expect(posts()).toEqual([{ url: ENDPOINT, method: 'POST', body: { action: 'confirm_batch', transactionIds: ['a2', 'a3', 'a1'] } }])
  })

  it('a category correction in Review Selected is sent only as categoryOverrides for that id, and only on Confirm', async () => {
    await mount(<SpendingExplorer />, explorerPayload(three()), reply)
    await click(q('[data-testid="spending-select-all"]'))
    await click(q('[data-testid="spending-review-selected"]'))
    const item = [...host.querySelectorAll('[data-testid="spending-selected-item"]')].find(i => i.textContent!.includes('AUTOZONE'))!
    await choose(q('[data-testid="spending-selected-category"]', item), 'tools_equipment')
    expect(posts()).toEqual([])
    await click(q('[data-testid="spending-approve-selected"]'))
    await click(q('[data-testid="spending-confirm-approve"]'))
    expect(posts().map(p => p.body)).toEqual([{ action: 'confirm_batch', transactionIds: ['a2', 'a3', 'a1'], categoryOverrides: { a3: 'tools_equipment' } }])
  })
})

describe('BANK-6F financial contract · views and filters (read-only queries)', () => {
  it('the opening read, every view and every filter send exactly the same query parameters as before; none of them writes', async () => {
    await mount(<SpendingExplorer />, explorerPayload([row()]))
    expect(lastQuery()).toEqual({ view: 'review_queue', limit: '100', offset: '0', accounts: 'mapped' }) // the first read does not know the server's date yet
    for (const view of ['reviewed', 'all', 'known_bills', 'unassigned', 'repeated_spending', 'needs_review', 'review_queue']) {
      await click(q(`[data-testid="spending-view-${view}"]`))
      expect(lastQuery()).toEqual({ view, limit: '100', offset: '0', accounts: 'mapped', from: '2026-07-10' })
    }
    await click(q('[data-bucket="materials"]')) // the Snapshot drill-in
    expect(lastQuery()).toMatchObject({ view: 'unassigned', bucket: 'materials' })
    await click(q('[data-bucket="materials"]'))
    expect(lastQuery().bucket).toBeUndefined()
    await setPeriod(30)
    expect(lastQuery().from).toBe('2026-09-08')
    const panel = await filtersPanel()
    await setValue(filterControl(panel, /^(Bucket|Category)/) as HTMLSelectElement, 'meals')
    await setValue(filterControl(await filtersPanel(), /^Account/) as HTMLSelectElement, 'a1')
    await setValue(filterControl(await filtersPanel(), /^Business \/ personal/) as HTMLSelectElement, 'personal')
    await setValue(filterControl(await filtersPanel(), /^Review/) as HTMLSelectElement, 'suggested')
    await setValue(filterControl(await filtersPanel(), /^Confidence/) as HTMLSelectElement, 'high')
    await setValue(filterControl(await filtersPanel(), /^Project/) as HTMLSelectElement, 'p1')
    await setValue(filterControl(await filtersPanel(), /^Min amount/) as HTMLInputElement, '12.5')
    await setValue(filterControl(await filtersPanel(), /^Max amount/) as HTMLInputElement, '400')
    await setSearch('depot')
    expect(lastQuery()).toEqual({ view: 'unassigned', limit: '100', offset: '0', accounts: 'mapped', from: '2026-09-08', bucket: 'meals', account: 'a1', scope: 'personal', review: 'suggested', confidence: 'high', project: 'p1', search: 'depot', minMinor: '1250', maxMinor: '40000' })
    await click(q('[data-testid="spending-unmapped-note"] button'))
    await flush(300) // with a search active, every read is debounced by 250ms
    expect(lastQuery()).toMatchObject({ accounts: 'all', search: 'depot', bucket: 'meals' })
    expect(posts()).toEqual([])
  })
})

describe('BANK-6F financial contract · Smart Review', () => {
  const groupEl = (m: string) => [...host.querySelectorAll('[data-testid="smart-group"]')].find(g => (g as HTMLElement).dataset.merchant === m) as HTMLElement
  const reply = { outcome: 'batch', confirmed: 3, unchanged: 0, skipped: 0, results: [], rules: { saved: [], skipped: [] } }

  it('group approval sends exactly confirm_batch with ids, the owner\'s explicit category for the mixed merchant, and remember ids only when chosen', async () => {
    await mount(<SmartReview />, smartPayload(), reply)
    await click(q('[data-testid="smart-group-select"]', groupEl('NETLIFY')))
    await choose(q('[data-testid="smart-group-category"]', groupEl('VONS')), 'fuel_vehicle')
    await click(q('[data-testid="smart-remember-on"]', groupEl('NETLIFY')))
    expect(posts()).toEqual([]) // selecting, choosing and "remember" save nothing
    await click(q('[data-testid="smart-approve"]'))
    await click(q('[data-testid="smart-confirm-cancel"]'))
    expect(posts()).toEqual([])
    await click(q('[data-testid="smart-approve"]'))
    await click(q('[data-testid="smart-confirm-approve"]'))
    const [p] = posts()
    expect(p.url).toBe(ENDPOINT)
    expect(Object.keys(p.body).sort()).toEqual(['action', 'categoryOverrides', 'rememberTransactionIds', 'transactionIds'])
    expect(p.body.action).toBe('confirm_batch')
    expect(p.body.transactionIds.slice().sort()).toEqual([uid(1), uid(2), uid(10)])
    expect(p.body.categoryOverrides).toEqual({ [uid(10)]: 'fuel_vehicle' })
    expect(p.body.rememberTransactionIds).toHaveLength(1); expect([uid(1), uid(2)]).toContain(p.body.rememberTransactionIds[0])
  })

  it('a mixed-purpose merchant is never preselected: tapping its row selects nothing and sends nothing', async () => {
    await mount(<SmartReview />, smartPayload(), reply)
    const ctl = q('[data-testid="smart-group-category"]', groupEl('VONS'))!
    if (ctl instanceof HTMLSelectElement) expect(ctl.value).toBe('')
    else expect(ctl.getAttribute('data-value') ?? '').toBe('')
    await click(q('[data-testid="smart-group-header"]', groupEl('VONS')))
    await click(q('[data-testid="smart-row"]', groupEl('VONS')))
    expect(q('[data-testid="smart-selection-bar"]')).toBeNull()
    expect(posts()).toEqual([])
  })

  it('an exception is saved individually with exactly set_bucket, and forgetting a remembered rule sends exactly forget_rule', async () => {
    await mount(<SmartReview />, smartPayload(), reply)
    const ex = q('[data-testid="smart-exception-group"]')!
    await click(ex.querySelector('button'))
    const exRow = q('[data-testid="smart-exception-row"]', ex)!
    const native = exRow.querySelector('select') as HTMLSelectElement | null
    if (native) { await setValue(native, 'personal_owner'); expect(posts()).toEqual([]); await click(byText(exRow, 'Save')) }
    else await choose(q('[data-testid="smart-exception-category"]', exRow), 'personal_owner')
    await click(q('[data-testid="smart-rules-toggle"]'))
    await click(q('[aria-label="Forget ADOBE"]'))
    expect(posts().map(p => p.body)).toEqual([{ action: 'set_bucket', transactionId: uid(50), bucket: 'personal_owner' }, { action: 'forget_rule', merchantKey: 'ADOBE' }])
  })
})
