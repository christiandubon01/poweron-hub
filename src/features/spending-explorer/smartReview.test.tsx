// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
import SmartReview, { smartSummary } from './SmartReview'
import { draftKey, loadDraft } from './reviewDraft'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const SCOPE = 'abcdef0123456789'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const BUCKETS = [{ key: 'materials', label: 'Materials', hint: '' }, { key: 'fuel_vehicle', label: 'Fuel / Vehicle', hint: '' }, { key: 'tools_equipment', label: 'Tools & Equipment', hint: '' }, { key: 'software_subscriptions', label: 'Software / Subscriptions', hint: '' }, { key: 'meals', label: 'Meals', hint: '' }, { key: 'personal_owner', label: 'Personal / Owner', hint: '' }, { key: 'customer_payment', label: 'Customer payment', hint: '', flow: 'in' }]
const BATCH = ['materials', 'fuel_vehicle', 'tools_equipment', 'software_subscriptions', 'meals']
const group = (over: Record<string, unknown>) => ({ id: 'g', merchantKey: 'G', merchant: 'G', bucket: { key: 'software_subscriptions', label: 'Software / Subscriptions' }, confidence: 'high', basis: 'merchant_rule', needsChoice: false, mixed: false, count: 0, totalMinor: 0, flaggedCount: 0, reasons: [], rows: [], ...over })
const rowsOf = (start: number, amounts: number[], flags: string[][] = []) => amounts.map((a, i) => ({ id: id(start + i), date: `2026-09-0${i + 1}`, name: 'TX', amountMinor: a, flags: flags[i] ?? [] }))
const netlify = rowsOf(1, [1900, 1900, 1900])
const vons = rowsOf(10, [8351])
const payload = (over: Record<string, unknown> = {}) => ({
  asOf: '2026-10-07', accounts: 'mapped', draftScope: SCOPE, rulesAvailable: true, maxBatch: 100, merchantRules: [],
  groups: [
    group({ id: 'NETLIFY|software_subscriptions', merchantKey: 'NETLIFY', merchant: 'NETLIFY', count: 3, totalMinor: 5700, rows: netlify }),
    group({ id: 'VONS|meals', merchantKey: 'VONS', merchant: 'VONS', bucket: { key: 'meals', label: 'Meals' }, confidence: 'possible', needsChoice: true, mixed: true, count: 1, totalMinor: 8351, rows: vons }),
    group({ id: 'STAPLES|office_admin', merchantKey: 'STAPLES', merchant: 'STAPLES', bucket: { key: 'materials', label: 'Materials' }, count: 3, totalMinor: 5300, flaggedCount: 1, rows: rowsOf(20, [1000, 1200, 3100], [[], [], ['unusual_amount']]) }),
  ],
  exceptions: [{ reason: 'owner_or_personal', label: 'Owner draws and personal', count: 1, totalMinor: 100000, rows: [{ id: id(50), date: '2026-09-23', name: 'OWNER DRAW', merchant: 'OWNER DRAW', amountMinor: 100000, direction: 'money_out', reason: 'owner_or_personal', why: 'Owner draws and personal spending are your individual decision.', suggested: { key: 'owner_draw', label: 'Owner draw', confidence: 'possible' } }] }],
  totals: { groupedCount: 7, groupedMinor: 19351, groups: 3, exceptionCount: 1 }, options: { buckets: BUCKETS, batchBuckets: BATCH }, ...over,
})

describe('SmartReview (BANK-6B)', () => {
  let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>
  const mount = async (get: unknown, post: unknown = { outcome: 'batch', confirmed: 3, unchanged: 0, skipped: 0, results: [], rules: { saved: [], skipped: [] } }) => {
    fetchMock = vi.fn(async (_url: string, init?: any) => ({ ok: true, status: 200, json: async () => (init?.method === 'POST' ? post : get) }))
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<SmartReview />) })
    await flush()
  }
  const q = (sel: string) => host.querySelector(sel) as HTMLElement | null
  const qa = (sel: string) => [...host.querySelectorAll(sel)] as HTMLElement[]
  const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click() }); await flush() }
  const pick = async (el: HTMLSelectElement, value: string) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!; set.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })) }); await flush() }
  const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST').map(([, i]) => JSON.parse(i.body))
  const groupEl = (m: string) => qa('[data-testid="smart-group"]').find(g => g.dataset.merchant === m)!
  beforeEach(() => { window.localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  it('shows compact group cards: merchant, count, combined amount, suggested category, confidence and origin; transactions are collapsed until opened', async () => {
    await mount(payload())
    const net = groupEl('NETLIFY')
    expect(net.textContent).toMatch(/NETLIFY.*3 transactions.*\$57\.00/)
    expect(net.textContent).toContain('Software / Subscriptions'); expect(net.textContent).toContain('High'); expect(net.textContent).toContain('Suggestion')
    expect(net.querySelector('[data-testid="smart-group-rows"]')).toBeNull()
    await click(net.querySelector('[data-testid="smart-group-header"]'))
    expect(net.querySelectorAll('[data-testid="smart-row"]')).toHaveLength(3) // every individual date and amount is available
    expect(q('[data-testid="smart-totals"]')!.textContent).toContain('7 in 3 groups')
  })

  it('selects a whole group, lets individual transactions be unchecked (and rechecked), and keeps a persistent summary with the total', async () => {
    await mount(payload())
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-group-select"]'))
    expect(q('[data-testid="smart-selected-count"]')!.textContent).toBe('3 selected')
    expect(q('[data-testid="smart-selection-bar"]')!.textContent).toContain('$57.00 going out')
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-group-header"]'))
    const rows = qa('[data-testid="smart-row"]')
    await click(rows[0])
    expect(q('[data-testid="smart-selected-count"]')!.textContent).toBe('2 selected')
    expect(qa('[data-testid="smart-row"]')[0].dataset.selected).toBe('false'); expect(qa('[data-testid="smart-row"]')).toHaveLength(3) // still listed
    await click(qa('[data-testid="smart-row"]')[0]) // a second tap restores it
    expect(q('[data-testid="smart-selected-count"]')!.textContent).toBe('3 selected')
  })

  it('flagged transactions are marked, are not selected by "select group", and can be chosen individually', async () => {
    await mount(payload())
    const st = groupEl('STAPLES')
    expect(st.textContent).toContain('1 to check')
    await click(st.querySelector('[data-testid="smart-group-select"]'))
    expect(q('[data-testid="smart-selected-count"]')!.textContent).toBe('2 selected')
    await click(st.querySelector('[data-testid="smart-group-header"]'))
    expect(st.textContent).toContain('Unusually large for this merchant')
    await click(qa('[data-testid="smart-row"]').find(r => r.dataset.selected === 'false')!)
    expect(q('[data-testid="smart-selected-count"]')!.textContent).toBe('3 selected')
  })

  it('a mixed-purpose merchant cannot be selected until the owner picks a category (no silent approval)', async () => {
    await mount(payload())
    const v = groupEl('VONS')
    expect(v.textContent).toContain('Mixed purpose'); expect(v.textContent).toContain('you pick the category')
    expect((v.querySelector('[data-testid="smart-group-category"]') as HTMLSelectElement).value).toBe('')
    await click(v.querySelector('[data-testid="smart-group-header"]'))
    await click(v.querySelector('[data-testid="smart-row"]'))
    expect(q('[data-testid="smart-selection-bar"]')).toBeNull()
    expect(q('[data-testid="smart-note"]')!.textContent).toContain('Choose a category')
    await pick(v.querySelector('[data-testid="smart-group-category"]') as HTMLSelectElement, 'fuel_vehicle')
    expect(q('[data-testid="smart-selected-count"]')!.textContent).toBe('1 selected')
    expect(groupEl('VONS').textContent).toContain('Your choice')
  })

  it('approval needs a confirmation that shows the exact category totals, then sends ids, the owner\'s category choices and nothing else', async () => {
    await mount(payload())
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-group-select"]'))
    await pick(groupEl('VONS').querySelector('[data-testid="smart-group-category"]') as HTMLSelectElement, 'fuel_vehicle')
    await click(q('[data-testid="smart-approve"]'))
    expect(posts()).toEqual([]) // nothing is sent before the confirmation
    const bd = q('[data-testid="smart-confirm-breakdown"]')!.textContent!
    expect(bd).toContain('Software / Subscriptions · 3'); expect(bd).toContain('$57.00'); expect(bd).toContain('Fuel / Vehicle · 1'); expect(bd).toContain('$83.51')
    expect(q('[data-testid="smart-confirm"]')!.textContent).toContain('$140.51')
    await click(q('[data-testid="smart-confirm-approve"]'))
    const [post] = posts()
    expect(post.action).toBe('confirm_batch')
    expect(post.transactionIds.slice().sort()).toEqual([...netlify.map(r => r.id), vons[0].id].sort())
    expect(post.categoryOverrides).toEqual({ [vons[0].id]: 'fuel_vehicle' }) // the confident Netlify suggestion carries no override; the mixed merchant carries the owner's pick
    expect(post.rememberTransactionIds).toBeUndefined()
    expect(JSON.stringify(post)).not.toMatch(/merchantKey|NETLIFY|organization/i)
  })

  it('"Apply to this transaction only" is the default; "Remember this category" must be chosen, is shown in the confirmation, and sends one id per merchant', async () => {
    await mount(payload())
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-group-select"]'))
    const g = groupEl('NETLIFY')
    expect(g.querySelector('[data-testid="smart-this-only"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(g.querySelector('[data-testid="smart-remember-on"]')!.getAttribute('aria-pressed')).toBe('false')
    await click(q('[data-testid="smart-approve"]'))
    await click(q('[data-testid="smart-confirm-cancel"]'))
    await click(g.querySelector('[data-testid="smart-remember-on"]'))
    await click(q('[data-testid="smart-approve"]'))
    expect(q('[data-testid="smart-confirm-remember"]')!.textContent).toContain('NETLIFY → Software / Subscriptions')
    await click(q('[data-testid="smart-confirm-approve"]'))
    const [post] = posts()
    expect(post.rememberTransactionIds).toHaveLength(1); expect(netlify.map(r => r.id)).toContain(post.rememberTransactionIds[0])
  })

  it('when rules are unavailable, no remember control is offered; a clear message says so, before and after selecting', async () => {
    await mount(payload({ rulesAvailable: false }))
    const g = groupEl('NETLIFY')
    expect(g.querySelector('[data-testid="smart-remember"]')).toBeNull(); expect(g.querySelector('[data-testid="smart-remember-on"]')).toBeNull()
    expect(g.querySelector('[data-testid="smart-remember-unavailable"]')!.textContent).toMatch(/not available right now.*Approving still works/)
    await click(g.querySelector('[data-testid="smart-group-select"]'))
    expect(qa('[data-testid="smart-remember-on"]')).toHaveLength(0)
    expect(groupEl('NETLIFY').querySelector('[data-testid="smart-remember-unavailable"]')).not.toBeNull()
  })

  it('discoverability: before any selection the future-preference control is visible, "Don\'t remember" is the default, and "Remember this category" is disabled with a reason', async () => {
    await mount(payload())
    expect(q('[data-testid="smart-steps"]')!.textContent).toMatch(/Select transactions.*Check the category.*Approve selected/)
    expect(host.textContent).toContain('Selecting and choosing categories saves nothing')
    for (const g of qa('[data-testid="smart-group"]')) {
      const on = g.querySelector('[data-testid="smart-remember-on"]') as HTMLButtonElement, off = g.querySelector('[data-testid="smart-this-only"]') as HTMLButtonElement
      expect(off.textContent).toBe("Don't remember"); expect(off.getAttribute('aria-pressed')).toBe('true')
      expect(on.disabled).toBe(true); expect(on.getAttribute('aria-pressed')).toBe('false')
      expect(g.querySelector('[data-testid="smart-remember-hint"]')!.textContent).toBe('Select a transaction first to remember its category.')
    }
    expect(host.textContent).not.toContain('Apply to this transaction only')
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-remember-on"]')) // disabled: nothing happens
    expect(posts()).toEqual([]); expect(q('[data-testid="smart-selection-bar"]')).toBeNull()
  })

  it('after selecting: count, total and "not approved yet" are shown; remembering is explained as a suggestion only and falls back to the default when the selection is cleared', async () => {
    await mount(payload())
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-group-select"]'))
    const g = groupEl('NETLIFY')
    expect(g.querySelector('[data-testid="smart-group-selected"]')!.textContent).toBe('3 selected · $57.00 · not approved yet')
    expect(q('[data-testid="smart-selection-bar"]')!.textContent).toContain('3 selected · $57.00 going out · not approved yet')
    expect(g.querySelector('[data-testid="smart-remember-hint"]')!.textContent).toMatch(/Default: nothing is remembered.*never approves/)
    expect((g.querySelector('[data-testid="smart-remember-on"]') as HTMLButtonElement).disabled).toBe(false)
    await click(g.querySelector('[data-testid="smart-remember-on"]'))
    expect(groupEl('NETLIFY').querySelector('[data-testid="smart-remember-hint"]')!.textContent).toMatch(/suggested as Software \/ Subscriptions.*still need your approval.*Saved only when you confirm/)
    expect(posts()).toEqual([]) // choosing to remember saves nothing
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-group-select"]')) // deselect the group
    const after = groupEl('NETLIFY')
    expect(after.querySelector('[data-testid="smart-this-only"]')!.getAttribute('aria-pressed')).toBe('true')
    expect((after.querySelector('[data-testid="smart-remember-on"]') as HTMLButtonElement).disabled).toBe(true)
    await click(after.querySelector('[data-testid="smart-group-select"]')) // reselect: still the default, not silently "remember"
    expect(groupEl('NETLIFY').querySelector('[data-testid="smart-this-only"]')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('a mixed-purpose merchant still needs an explicit category; remember stays disabled until it is chosen, and flagged rows are never auto-selected', async () => {
    await mount(payload())
    const v = groupEl('VONS')
    expect((v.querySelector('[data-testid="smart-remember-on"]') as HTMLButtonElement).disabled).toBe(true)
    await click(v.querySelector('[data-testid="smart-group-header"]')); await click(v.querySelector('[data-testid="smart-row"]'))
    expect(q('[data-testid="smart-selection-bar"]')).toBeNull()
    expect((groupEl('VONS').querySelector('[data-testid="smart-remember-on"]') as HTMLButtonElement).disabled).toBe(true)
    await pick(groupEl('VONS').querySelector('[data-testid="smart-group-category"]') as HTMLSelectElement, 'fuel_vehicle')
    expect((groupEl('VONS').querySelector('[data-testid="smart-remember-on"]') as HTMLButtonElement).disabled).toBe(false)
    await pick(groupEl('STAPLES').querySelector('[data-testid="smart-group-category"]') as HTMLSelectElement, 'tools_equipment')
    const st = groupEl('STAPLES')
    expect(st.querySelector('[data-testid="smart-group-selected"]')!.textContent).toContain('2 selected') // the flagged $31.00 row is not included
  })

  it('cancelling the confirmation saves nothing and keeps the selection and the remember choice; the confirmation states when nothing is remembered', async () => {
    await mount(payload())
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-group-select"]'))
    await click(q('[data-testid="smart-approve"]'))
    expect(q('[data-testid="smart-confirm-no-remember"]')!.textContent).toBe('No category will be remembered for future transactions.')
    await click(q('[data-testid="smart-confirm-cancel"]'))
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-remember-on"]'))
    await click(q('[data-testid="smart-approve"]'))
    expect(q('[data-testid="smart-confirm-no-remember"]')).toBeNull(); expect(q('[data-testid="smart-confirm-remember"]')).not.toBeNull()
    await click(q('[data-testid="smart-confirm-cancel"]'))
    expect(posts()).toEqual([])
    expect(q('[data-testid="smart-confirm"]')).toBeNull()
    expect(q('[data-testid="smart-selected-count"]')!.textContent).toBe('3 selected')
    expect(groupEl('NETLIFY').querySelector('[data-testid="smart-remember-on"]')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('tells suggestions, remembered rules and the owner\'s own choices apart, and lists remembered categories with a Forget control', async () => {
    const p = payload({ merchantRules: [{ merchantKey: 'NETLIFY', label: 'NETLIFY', category: 'software_subscriptions', categoryLabel: 'Software / Subscriptions' }] })
    p.groups[0] = group({ ...p.groups[0], basis: 'owner_rule' }) as any
    await mount(p)
    expect(groupEl('NETLIFY').textContent).toContain('Your remembered rule'); expect(groupEl('STAPLES').textContent).toContain('Suggestion')
    await click(q('[data-testid="smart-rules-toggle"]'))
    expect(q('[data-testid="smart-rules"]')!.textContent).toContain('NETLIFY → Software / Subscriptions')
    await click(q('[aria-label="Forget NETLIFY"]'))
    expect(posts()).toEqual([{ action: 'forget_rule', merchantKey: 'NETLIFY' }])
  })

  it('exceptions are set apart: no checkbox, no bulk approval, only an individual category save', async () => {
    await mount(payload())
    const ex = q('[data-testid="smart-exception-group"]')!
    expect(ex.textContent).toContain('Owner draws and personal')
    await click(ex.querySelector('button'))
    expect(ex.querySelector('[role="checkbox"]')).toBeNull()
    const select = ex.querySelector('select') as HTMLSelectElement
    await pick(select, 'personal_owner')
    await click([...ex.querySelectorAll('button')].find(b => b.textContent === 'Save')!)
    expect(posts()).toEqual([{ action: 'set_bucket', transactionId: id(50), bucket: 'personal_owner' }])
  })

  it('the selection draft survives a reload (ids and category choices only, in its own storage key) and drops rows that no longer need review', async () => {
    await mount(payload())
    await pick(groupEl('VONS').querySelector('[data-testid="smart-group-category"]') as HTMLSelectElement, 'fuel_vehicle')
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-group-select"]'))
    const saved = loadDraft(SCOPE, Date.now(), 'smart')!
    expect(saved.ids).toHaveLength(4); expect(saved.overrides).toEqual({ [vons[0].id]: 'fuel_vehicle' })
    expect(window.localStorage.getItem(draftKey(SCOPE, 'smart'))).not.toMatch(/NETLIFY|VONS|1900|8351/)
    expect(window.localStorage.getItem(draftKey(SCOPE))).toBeNull() // the Explorer's own draft is untouched
    act(() => root.unmount()); root = createRoot(host)
    const p = payload(); p.groups[0].rows = p.groups[0].rows.slice(0, 2) as any // one Netlify transaction was reviewed elsewhere
    await mount(p)
    expect(q('[data-testid="smart-selected-count"]')!.textContent).toBe('3 selected')
    expect(q('[data-testid="smart-note"]')!.textContent).toMatch(/Restored 3.*1 no longer need review.*Nothing was approved/)
    expect(posts()).toEqual([])
  })

  it('a mixed-purpose merchant WITH a remembered rule is prefilled but still needs the owner to confirm the category before anything is selected or sent', async () => {
    const p = payload({ merchantRules: [{ merchantKey: 'VONS', label: 'VONS', category: 'fuel_vehicle', categoryLabel: 'Fuel / Vehicle' }] })
    p.groups[1] = group({ ...p.groups[1], bucket: { key: 'fuel_vehicle', label: 'Fuel / Vehicle' }, confidence: 'high', basis: 'owner_rule', needsChoice: true, mixed: true }) as any
    await mount(p)
    const v = groupEl('VONS')
    expect(v.textContent).toContain('Your remembered rule'); expect(v.textContent).toContain('you pick the category')
    expect((v.querySelector('[data-testid="smart-group-category"]') as HTMLSelectElement).value).toBe('') // not silently chosen
    await click(v.querySelector('[data-testid="smart-group-header"]'))
    await click(v.querySelector('[data-testid="smart-row"]'))
    expect(q('[data-testid="smart-selection-bar"]')).toBeNull() // a row tap alone does not approve-select it
    expect(v.querySelector('[data-testid="smart-group-select"]')!.textContent).toBe('Use Fuel / Vehicle for 1') // the rule only suggests the label
    await click(v.querySelector('[data-testid="smart-group-select"]')) // the owner's explicit confirmation
    await click(q('[data-testid="smart-approve"]')); await click(q('[data-testid="smart-confirm-approve"]'))
    expect(posts()[0].categoryOverrides).toEqual({ [vons[0].id]: 'fuel_vehicle' })
  })

  it('reload before confirmation restores "Remember this category" as an unconfirmed draft choice only: no request is sent, then it is cleared after approval', async () => {
    await mount(payload())
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-group-select"]'))
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-remember-on"]'))
    const saved = loadDraft(SCOPE, Date.now(), 'smart')!
    expect(saved.remember).toHaveLength(1); expect(netlify.map(r => r.id)).toContain(saved.remember![0])
    expect(window.localStorage.getItem(draftKey(SCOPE, 'smart'))).not.toMatch(/NETLIFY|software/i) // ids only
    act(() => root.unmount()); root = createRoot(host)
    await mount(payload())
    expect(posts()).toEqual([]) // restoring creates no rule, approval or confirmation
    const g = groupEl('NETLIFY')
    expect(g.querySelector('[data-testid="smart-remember-on"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(q('[data-testid="smart-confirm"]')).toBeNull()
    expect(q('[data-testid="smart-note"]')!.textContent).toContain('Nothing was approved')
    await click(q('[data-testid="smart-approve"]'))
    expect(posts()).toEqual([]) // still only the confirmation screen
    await click(q('[data-testid="smart-confirm-approve"]'))
    expect(posts()[0].rememberTransactionIds).toHaveLength(1)
    expect(loadDraft(SCOPE, Date.now(), 'smart')).toBeNull() // cleared after a successful approval
  })

  it('"Apply to this transaction only" is restored as the default, and Clear selection removes the saved remember choice', async () => {
    await mount(payload())
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-group-select"]'))
    expect(loadDraft(SCOPE, Date.now(), 'smart')!.remember ?? []).toEqual([])
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-remember-on"]'))
    await click(q('[data-testid="smart-clear"]'))
    expect(loadDraft(SCOPE, Date.now(), 'smart')).toBeNull()
    expect(posts()).toEqual([])
  })

  it('a rules-unavailable reload does not restore a remember choice', async () => {
    await mount(payload())
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-group-select"]'))
    await click(groupEl('NETLIFY').querySelector('[data-testid="smart-remember-on"]'))
    act(() => root.unmount()); root = createRoot(host)
    await mount(payload({ rulesAvailable: false }))
    await click(q('[data-testid="smart-approve"]')); await click(q('[data-testid="smart-confirm-approve"]'))
    expect(posts()[0].rememberTransactionIds).toBeUndefined()
  })

  it('summarises the result honestly, including mixed-purpose skips and rules that could not be remembered', () => {
    const text = smartSummary({ confirmed: 2, unchanged: 0, skipped: 1, results: [{ id: 'a', result: 'skipped', reason: 'mixed_purpose' }], rules: { saved: [{ merchantKey: 'NETLIFY', label: 'NETLIFY', category: 'software_subscriptions' }], skipped: [{ merchantKey: 'X', reason: 'failed' }] } })
    expect(text).toContain('Approved 2'); expect(text).toContain('1 needs you to pick the category'); expect(text).toContain('Remembered: NETLIFY'); expect(text).toContain('approvals were still saved')
  })

  it('is built for an iPhone: a single column of cards, 44px tap targets, no fixed widths, a sticky summary, and no horizontal overflow classes', () => {
    const src = readFileSync('src/features/spending-explorer/SmartReview.tsx', 'utf8')
    expect(src).toContain('min-h-[44px]'); expect(src).toContain('sticky bottom-2'); expect(src).toContain('truncate'); expect(src).toContain('flex-wrap')
    expect(src).not.toMatch(/\bw-\[\d{3,}px\]|\bmin-w-\[\d{3,}px\]|whitespace-nowrap|overflow-x-scroll|table/)
    const buttons = (src.match(/<button/g) ?? []).length
    expect(buttons).toBeLessThan(16)
  })
})
