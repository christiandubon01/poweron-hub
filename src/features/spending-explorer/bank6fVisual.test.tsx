// @vitest-environment happy-dom
/**
 * BANK-6F presentation rules (display only). The financial contract lives in bank6fContract.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
import SpendingExplorer from './SpendingExplorer'
import SmartReview from './SmartReview'
import { StatusBadge } from './controls'
import { sharePct } from './snapshot/SpendingSnapshot'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async (ms = 5) => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }

const SURFACES = [
  'src/features/spending-explorer/SpendingExplorer.tsx', 'src/features/spending-explorer/SmartReview.tsx', 'src/features/spending-explorer/ChoiceSheet.tsx',
  'src/features/spending-explorer/BucketPicker.tsx', 'src/features/spending-explorer/controls.tsx', 'src/features/spending-explorer/ui.ts', 'src/features/display-colors/DisplayColors.tsx',
]

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', date: '2026-10-03', name: 'CHEVRON 0098', merchant: 'CHEVRON', amountMinor: 6210, direction: 'money_out', pending: false,
  account: { ref: 'a1', label: 'Plaid Checking', mask: '4417', ownership: 'business', mappedTo: 'Wells Fargo Business Checking', mapped: true, environment: 'production', financialAccountId: null },
  bucket: { key: 'fuel_vehicle', label: 'Fuel / Vehicle', state: 'suggested', confidence: 'high', reasons: ['The merchant looks like a fuel / vehicle merchant.'] },
  relationship: { kind: 'unknown', label: 'Unknown', target: null, state: 'none', confidence: null, reasons: [] },
  review: 'suggested', scope: { value: 'business', source: 'account' }, unassigned: true, repeatedPattern: false, pattern: null, ...over,
})
const analytics = (over: Record<string, unknown> = {}) => ({
  asOf: '2026-10-07', windowDays: 30,
  unassigned: { totalMinor: 75000, count: 13, previousMinor: 60000, deltaMinor: 15000, byBucket: [
    { key: 'fuel_vehicle', label: 'Fuel / Vehicle', totalMinor: 41200, count: 8, previousMinor: 0, deltaMinor: 41200, merchants: 3, repeatedMerchants: 0 },
    { key: 'materials', label: 'Materials', totalMinor: 33800, count: 5, previousMinor: 0, deltaMinor: 33800, merchants: 2, repeatedMerchants: 0 }] },
  knownBills: { totalMinor: 3800, count: 1, confirmedCount: 0, suggestedCount: 1 }, pending: { totalMinor: 3000, count: 1 }, review: { needsReviewCount: 6, repeatedPatternCount: 0 },
  unclassified: { totalMinor: 0, count: 0 }, observations: [], suggestions: [], ...over,
})
const payload = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  asOf: '2026-10-07', draftScope: 'abcdef0123456789', accounts: 'mapped', environment: 'production',
  meta: { billCandidates: 0, activeObligations: 1, scheduledCommitments: 0, evidenceRows: 10, hiddenUnmapped: 0, olderThanPeriod: 0, periodFrom: '2026-07-10' },
  analytics: analytics(), viewCounts: { review_queue: 8, reviewed: 2, all: 10, known_bills: 1, unassigned: 7, repeated_spending: 1, needs_review: 6 }, reviewCounts: { reviewed: 2, unreviewed: 8, excluded: 0 },
  total: rows.length, rows,
  options: { batchBuckets: ['materials', 'fuel_vehicle', 'meals'], maxBatch: 50,
    buckets: [{ key: 'materials', label: 'Materials', hint: 'Job materials and supplies' }, { key: 'fuel_vehicle', label: 'Fuel / Vehicle', hint: 'Fuel, repairs, tolls, parking' }, { key: 'meals', label: 'Meals', hint: 'Food and drink' }, { key: 'customer_payment', label: 'Customer payment', hint: '', flow: 'in' }],
    accounts: [{ ref: 'a1', label: 'Wells Fargo Business Checking', mask: '4417' }], obligations: [], commitments: [], debts: [], projects: [{ id: 'p1', name: 'Desert Willow Remodel' }] },
  ...over,
})

let host: HTMLDivElement, root: Root
const q = (s: string, el: ParentNode = host) => el.querySelector(s) as HTMLElement | null
const qa = (s: string, el: ParentNode = host) => [...el.querySelectorAll(s)] as HTMLElement[]
const byText = (t: string, el: ParentNode = host) => qa('button', el).find(b => b.textContent!.trim() === t)!
const click = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await flush() }
const render = async (node: React.ReactNode, get?: unknown) => {
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: any) => ({ ok: true, status: 200, json: async () => (init?.method === 'POST' ? { outcome: 'created' } : get) })))
  await act(async () => { root.render(node) }); await flush()
}
beforeEach(() => { window.localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('BANK-6F step 2 · semantic layer', () => {
  it('source audit: theme-safe surfaces (no white overlays), hover only where hover exists (D14), no undefined tokens, motion only behind motion-safe', () => {
    for (const f of SURFACES) {
      const src = readFileSync(f, 'utf8')
      expect(src.match(/bg-white\/|ring-white\/|border-white\//g) ?? [], `${f}: white overlays vanish in the light theme`).toEqual([])
      expect(src.match(/(?<=[\s'"`{])hover:/g) ?? [], `${f}: hover must be wrapped in [@media(hover:hover)]`).toEqual([])
      expect(src, f).not.toContain('--fin-positive')
      expect(src.match(/(?<![\w:-])(transition(-[\w-]+)?|animate-[\w-]+)(?=[\s'"`])/g) ?? [], f).toEqual([])
    }
  })

  it('touch targets: no control in the BANK-6F surfaces is set below 44px (rem sizes shrink with the app\'s 14px root, so targets use px)', () => {
    for (const f of [...SURFACES, 'src/features/spending-explorer/ExplorerControls.tsx', 'src/features/spending-explorer/detail/TransactionDetail.tsx', 'src/features/spending-explorer/SelectionBar.tsx'])
      expect(readFileSync(f, 'utf8').split('\n').filter(l => /min-h-\[(3\d|40)px\]/.test(l) || (/<button/.test(l) && /\bh-(7|8|9|10) w-(7|8|9|10)\b/.test(l))), f).toEqual([]) // decorative circles inside a 44px button are fine
  })

  it('no small text uses --text-muted (below 4.5:1 on the light card)', () => {
    for (const f of ['src/features/spending-explorer/controls.tsx', 'src/features/spending-explorer/SmartReview.tsx', 'src/features/spending-explorer/SpendingExplorer.tsx', 'src/features/spending-explorer/detail/TransactionDetail.tsx', 'src/features/spending-explorer/snapshot/SpendingSnapshot.tsx'])
      expect(readFileSync(f, 'utf8').match(/\btext-\[var\(--text-muted\)\]/g) ?? [], f).toEqual([])
  })

  it('status badge (D2): an icon and a word for every review state; Reviewed is never green', async () => {
    await render(<>{(['confirmed', 'suggested', 'needs_review', 'ignored'] as const).map(s => <StatusBadge key={s} state={s} />)}</>)
    const badges = qa('[data-testid="entry-status"]')
    expect(badges.map(b => b.textContent)).toEqual(['Reviewed', 'Suggested', 'Needs review', 'Ignored'])
    expect(badges.map(b => b.dataset.state)).toEqual(['confirmed', 'suggested', 'needs_review', 'ignored'])
    for (const b of badges) { expect(b.querySelector('[aria-hidden="true"]')).not.toBeNull(); expect(b.className).not.toContain('fin-cash') }
    expect(badges[2].className).toContain('fin-warning')
  })

  it('selection (D1) is blue everywhere: the row ring, the "✓ Selected" chip and the checked box; green stays for money in and the primary action', async () => {
    await render(<SpendingExplorer />, payload([row(), row({ id: 'r2', merchant: 'SHELL', name: 'SHELL' })]))
    await click(q('[data-testid="spending-select"]'))
    const sel = qa('[data-testid="spending-row"]').find(r => r.dataset.selected === 'true')!
    expect(sel.style.boxShadow).toBe('0 0 0 2px var(--fin-protected-border)'); expect(sel.style.background).toBe('var(--fin-protected-tint)')
    const chip = qa('[data-tone]', sel).find(c => c.textContent === '✓ Selected')!
    expect(chip.dataset.tone).toBe('sel')
    expect(q('[data-testid="spending-selection-bar"]')!.style.borderColor).toBe('var(--fin-protected-border)')
    expect(q('[data-testid="spending-approve-selected"]')!.className).toContain('fin-cash') // the one primary action keeps the action color
  })

  it('Smart Review: one chip recipe (warnings amber, not red), flags amber, a selected row blue with a drawn check box', async () => {
    const g = { id: 'S|materials', merchantKey: 'S', merchant: 'STAPLES', bucket: { key: 'materials', label: 'Materials' }, confidence: 'high', basis: 'merchant_rule', needsChoice: false, mixed: true, count: 2, totalMinor: 2200, flaggedCount: 1, reasons: [],
      rows: [{ id: 'x1', date: '2026-09-01', name: 'TX', amountMinor: 1000, flags: [] }, { id: 'x2', date: '2026-09-02', name: 'TX', amountMinor: 1200, flags: ['unusual_amount'] }] }
    await render(<SmartReview />, { asOf: '2026-10-07', accounts: 'mapped', draftScope: 'abcdef0123456789', rulesAvailable: true, maxBatch: 100, merchantRules: [], groups: [g], exceptions: [],
      totals: { groupedCount: 2, groupedMinor: 2200, groups: 1, exceptionCount: 0 }, options: { buckets: [{ key: 'materials', label: 'Materials', hint: '' }], batchBuckets: ['materials'] } })
    const warn = qa('[data-tone="warn"]').map(c => c.textContent)
    expect(warn).toEqual(['Mixed purpose', '1 to check'])
    await click(q('[data-testid="smart-group-header"]'))
    const flagged = qa('[data-testid="smart-row"]')[1]
    expect((q('span.block.text-xs', flagged) as HTMLElement).style.color).toBe('var(--fin-warning)')
    await click(qa('[data-testid="smart-row"]')[0])
    expect(qa('[data-testid="smart-row"]')[0].className).toContain('fin-protected-tint')
  })
})

describe('BANK-6F step 3 · Spending Snapshot', () => {
  const b = (key: string, label: string, totalMinor: number, count = 1) => ({ key, label, totalMinor, count, previousMinor: 0, deltaMinor: 0, merchants: 1, repeatedMerchants: 0 })
  const many = [b('materials', 'Materials', 168000, 9), b('fuel_vehicle', 'Fuel / Vehicle', 98000, 12), b('software_subscriptions', 'Software / Subscriptions', 61000, 6), b('meals', 'Meals', 47000, 8),
    b('office_admin', 'Office / Admin', 37700, 3), b('bank_finance_fees', 'Bank / Finance Fees', 300, 1), b('taxes', 'Taxes', 0, 0)]
  const a6 = analytics({ unassigned: { totalMinor: 412000, count: 39, previousMinor: 380000, deltaMinor: 32000, byBucket: many }, unclassified: { totalMinor: 4000, count: 1 } })

  it('shows the server figures exactly (no recomputed totals): headline, count, change in words, known bills, pending, not classified', async () => {
    await render(<SpendingExplorer />, payload([row()], { analytics: a6 }))
    expect(q('[data-testid="spending-total"]')!.textContent).toBe('$4,120 · 39 transactions')
    expect(q('[data-testid="spending-delta"]')!.textContent).toBe('$320 more than the previous 30 days')
    expect(q('[data-testid="spending-tile-bills"]')!.textContent).toContain('$38')
    expect(q('[data-testid="spending-tile-pending"]')!.textContent).toContain('$30')
    expect(q('[data-testid="spending-tile-unclassified"]')!.textContent).toBe('Not classified yet$401 transaction · included in unassigned · stays in review')
  })

  it('says exactly what "unassigned" counts, matching the server rule (projects, overhead, personal and transfers are excluded; pending and ignored are left out)', async () => {
    await render(<SpendingExplorer />, payload([row()], { analytics: a6 }))
    expect(q('[data-testid="spending-definition"]')!.textContent).toBe('Unassigned: posted money going out that is not linked to a bill, debt, payroll, project, transfer, overhead or personal use, and not confidently matched to one. Ignored transactions are left out.')
  })

  it('every percentage names its denominator, is display-only rounding, and a tiny share is never shown as 0%', async () => {
    expect([sharePct(168000, 412000), sharePct(300, 412000), sharePct(0, 412000), sharePct(5, 0)]).toEqual(['41%', '<1%', '0%', '0%'])
    await render(<SpendingExplorer />, payload([row()], { analytics: a6 }))
    const shares = qa('[data-testid="spending-bucket-share"]').map(e => e.textContent)
    expect(shares).toEqual(['41% of unassigned · 9 transactions', '24% of unassigned · 12 transactions', '15% of unassigned · 6 transactions', '11% of unassigned · 8 transactions', '9% of unassigned · 3 transactions'])
    expect(q('[data-testid="spending-composition"]')!.getAttribute('aria-label')).toMatch(/^Share of unassigned spending by category: Materials 41%, .*Bank \/ Finance Fees <1%$/)
  })

  it('no category is hidden: the first five show, "Show all" reveals the rest, and a zero-amount category is not drawn', async () => {
    await render(<SpendingExplorer />, payload([row()], { analytics: a6 }))
    expect(qa('[data-testid="spending-bucket"]')).toHaveLength(5)
    expect(qa('[data-testid="spending-composition"] span')).toHaveLength(6) // the bar always shows every non-zero category
    await click(q('[data-testid="spending-buckets-all"]'))
    expect(qa('[data-testid="spending-bucket"]').map(e => e.dataset.bucket)).toEqual(['materials', 'fuel_vehicle', 'software_subscriptions', 'meals', 'office_admin', 'bank_finance_fees'])
    expect(q('[data-testid="spending-buckets-all"]')!.textContent).toBe('Show fewer categories')
  })

  it('the category in use as a filter is marked as a selection (blue, aria-pressed) and the drill-in is unchanged', async () => {
    await render(<SpendingExplorer />, payload([row()], { analytics: a6 }))
    await click(q('[data-bucket="fuel_vehicle"]'))
    const on = q('[data-bucket="fuel_vehicle"]')!
    expect(on.getAttribute('aria-pressed')).toBe('true'); expect(on.className).toContain('fin-protected-border')
  })
})

describe('BANK-6F step 4 · transaction detail (inline, four sections, same decisions)', () => {
  const posts = () => (globalThis.fetch as any).mock.calls.filter(([, i]: any) => i?.method === 'POST').map(([, i]: any) => JSON.parse(i.body))
  const open = async (i = 0) => click(qa('[data-testid="spending-row"] button[aria-expanded]')[i])
  const detail = () => q('[data-testid="spending-detail"]')!
  const buttons = () => qa('button', detail()).map(b => b.textContent!.trim())

  it('opens inline beneath its own transaction with four sections in order: evidence, category, belongs to, history', async () => {
    await render(<SpendingExplorer />, payload([row(), row({ id: 'r2', merchant: 'SHELL' })]))
    await open(1)
    const rowEl = qa('[data-testid="spending-row"]')[1]
    expect(rowEl.contains(detail())).toBe(true)
    expect(qa('section', detail()).map(x => x.getAttribute('aria-label'))).toEqual(['Bank evidence', 'What was this money for?', 'What does it belong to?', 'History'])
    expect(q('[data-testid="detail-evidence"]')!.textContent).toMatch(/Bank descriptionCHEVRON 0098.*Wells Fargo Business Checking ••••4417 · bank: Plaid Checking.*Oct 3 · Posted.*−\$62\.10 · ↓ Money out/)
  })

  it('the account shows its last four digits once, even when the account name already contains them', async () => {
    await render(<SpendingExplorer />, payload([row({ account: { ...row().account, mappedTo: 'Wells Fargo Business Checking 4417' } })]))
    await open()
    expect(q('[data-testid="detail-evidence"]')!.textContent).toContain('AccountWells Fargo Business Checking 4417 · bank: Plaid Checking')
  })

  it('a suggested category puts the decision first (Confirm is the primary action), with the reasons collapsed but present', async () => {
    await render(<SpendingExplorer />, payload([row()]))
    await open()
    expect(buttons().slice(0, 3)).toEqual(['Confirm Fuel / Vehicle', 'Choose another…', 'Not this'])
    expect(byText('Confirm Fuel / Vehicle').className).toContain('fin-cash')
    const why = q('[data-testid="detail-suggestion"] details') as HTMLDetailsElement
    expect(why.open).toBe(false); expect(why.textContent).toContain('The merchant looks like a fuel / vehicle merchant.')
    expect(q('[data-testid="detail-suggestion"]')!.textContent).toContain('High confidence')
  })

  it('no new actions or confirmations: a suggested row offers exactly the pre-6F decisions, and Ignore sends ignore at once', async () => {
    await render(<SpendingExplorer />, payload([row()]))
    await open()
    expect(buttons()).toEqual(['Confirm Fuel / Vehicle', 'Choose another…', 'Not this', ...['Known bill', 'Project', 'Debt payment', 'Payroll', 'Transfer', 'General overhead (business)', 'Personal'], 'Save', 'Ignore this transaction', 'Show history'])
    await click(byText('Ignore this transaction'))
    expect(posts()).toEqual([{ action: 'ignore', transactionId: 'r1' }])
  })

  it('a confirmed relationship shows the decision and Undo first; changing it is one tap away (no editor clutter)', async () => {
    await render(<SpendingExplorer />, payload([row({ relationship: { kind: 'project', label: 'Project', target: { type: 'project', id: 'p1', label: 'Desert Willow Remodel' }, state: 'confirmed', confidence: 'high', reasons: [] } })]))
    await open()
    expect(q('[data-testid="detail-rel-editor"]')).toBeNull()
    expect(q('section[aria-label="What does it belong to?"]')!.textContent).toContain('✓ Project · Desert Willow Remodel')
    await click(q('[data-testid="detail-rel-change"]'))
    expect(q('[data-testid="detail-rel-kind"][data-kind="project"]')!.getAttribute('aria-pressed')).toBe('true') // the current kind, not a guess
    await click(byText('Cancel'))
    expect(q('[data-testid="detail-rel-editor"]')).toBeNull()
    expect(posts()).toEqual([])
  })

  it('a long target list opens a searchable sheet; choosing there sends nothing, Save sends the same set_relationship', async () => {
    const projects = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `Project ${String(i).padStart(2, '0')}` }))
    const p = payload([row()]); (p.options as any).projects = projects
    await render(<SpendingExplorer />, p)
    await open()
    await click(q('[data-testid="detail-rel-kind"][data-kind="project"]'))
    expect(q('select[id^="t-"]')).toBeNull()
    await click(q('[data-testid="detail-rel-target"]'))
    expect(q('[role="dialog"] input[type="search"]')).not.toBeNull()
    await click(q('[role="dialog"] [data-option="project:p7"]')); await click(q('[data-testid="target-picker-apply"]'))
    expect(posts()).toEqual([])
    expect(q('[data-testid="detail-rel-target"]')!.textContent).toBe('Project 07')
    await click(byText('Save'))
    expect(posts()).toEqual([{ action: 'set_relationship', transactionId: 'r1', kind: 'project', targetId: 'p7' }])
  })

  it('history stays collapsed until asked, then can be hidden again; it is read-only', async () => {
    await render(<SpendingExplorer />, payload([row()]))
    ;(globalThis.fetch as any).mockImplementation(async (u: string) => ({ ok: true, status: 200, json: async () => (/history=/.test(String(u)) ? { history: [{ label: 'Materials', kind: 'category', status: 'confirmed', source: 'owner', decidedAt: '2026-10-02T10:00:00Z', undoneAt: null, undoReason: null, createdAt: '2026-10-02T10:00:00Z' }] } : payload([row()])) }))
    await open()
    expect(q('[data-testid="spending-history"] ol')).toBeNull()
    await click(byText('Show history'))
    expect(q('[data-testid="spending-history"] ol')!.textContent).toContain('Materials · active · by you')
    await click(byText('Hide history'))
    expect(q('[data-testid="spending-history"] ol')).toBeNull()
    expect(posts()).toEqual([])
  })
})

describe('BANK-6F step 5 · unified category sheets and Smart Review', () => {
  const posts = () => (globalThis.fetch as any).mock.calls.filter(([, i]: any) => i?.method === 'POST').map(([, i]: any) => JSON.parse(i.body))
  const sheetKeys = () => qa('[role="dialog"] [data-option]', document).map(o => o.dataset.option)
  const BUCKETS = [{ key: 'materials', label: 'Materials', hint: 'Job materials and supplies' }, { key: 'fuel_vehicle', label: 'Fuel / Vehicle', hint: '' }, { key: 'meals', label: 'Meals', hint: '' }, { key: 'personal_owner', label: 'Personal / Owner', hint: '' }, { key: 'customer_payment', label: 'Customer payment', hint: '', flow: 'in' }]
  const smartData = (over: Record<string, unknown> = {}) => ({ asOf: '2026-10-07', accounts: 'mapped', draftScope: 'abcdef0123456789', rulesAvailable: true, maxBatch: 100, merchantRules: [],
    groups: [
      { id: 'NETLIFY|materials', merchantKey: 'NETLIFY', merchant: 'NETLIFY', bucket: { key: 'materials', label: 'Materials' }, confidence: 'high', basis: 'merchant_rule', needsChoice: false, mixed: false, count: 2, totalMinor: 3800, flaggedCount: 0, reasons: [], rows: [{ id: 'n1', date: '2026-09-01', name: 'NETLIFY', amountMinor: 1900, flags: [] }, { id: 'n2', date: '2026-09-02', name: 'NETLIFY', amountMinor: 1900, flags: [] }] },
      { id: 'VONS|meals', merchantKey: 'VONS', merchant: 'VONS', bucket: { key: 'meals', label: 'Meals' }, confidence: 'possible', basis: 'provider_category', needsChoice: true, mixed: true, count: 1, totalMinor: 8351, flaggedCount: 0, reasons: [], rows: [{ id: 'v1', date: '2026-09-08', name: 'VONS', amountMinor: 8351, flags: [] }] }],
    exceptions: [{ reason: 'pending', label: 'Pending', count: 1, totalMinor: 500, rows: [{ id: 'p1', date: '2026-09-09', name: 'SHELL', merchant: 'SHELL', amountMinor: 500, direction: 'money_out', reason: 'pending', why: 'Still pending.', suggested: { key: 'fuel_vehicle', label: 'Fuel / Vehicle', confidence: 'high' } }] }],
    totals: { groupedCount: 3, groupedMinor: 12151, groups: 2, exceptionCount: 1 }, options: { buckets: BUCKETS, batchBuckets: ['materials', 'fuel_vehicle', 'meals'] }, ...over })
  const groupEl = (m: string) => qa('[data-testid="smart-group"]').find(g => g.dataset.merchant === m)!

  it('Smart Review group: signed total and entry type like an entry card; the sheet lists only categories that can be approved together', async () => {
    await render(<SmartReview />, smartData())
    expect(q('[data-testid="smart-group-header"]', groupEl('NETLIFY'))!.textContent).toMatch(/NETLIFY2 transactions · Show−\$38\.00.*Money out/)
    await click(q('[data-testid="smart-group-category"]', groupEl('NETLIFY')))
    expect(sheetKeys()).toEqual(['materials', 'fuel_vehicle', 'meals'])
    expect(q('[data-option="materials"]', document)!.getAttribute('aria-checked')).toBe('true') // the confident suggestion is the current value
    await click(q('[data-testid="bucket-picker-cancel"]', document))
    expect(posts()).toEqual([])
  })

  it('D13: the owner\'s pick reads "Your choice · X" on a dashed pill (not approved); "Remove my choice" undoes it and its selection; nothing is sent', async () => {
    await render(<SmartReview />, smartData())
    await click(q('[data-testid="smart-group-category"]', groupEl('VONS')))
    expect(qa('[role="dialog"] [aria-checked="true"]', document)).toHaveLength(0) // a mixed-purpose merchant is never preselected
    expect(q('[data-testid="bucket-picker-clear"]', document)).toBeNull() // nothing to remove yet
    await click(q('[data-option="fuel_vehicle"]', document)); await click(q('[data-testid="bucket-picker-apply"]', document))
    const pill = q('[data-testid="category-pill"]', groupEl('VONS'))!
    expect(pill.dataset.state).toBe('draft'); expect(pill.textContent).toBe('Your choice · Fuel / Vehicle'); expect(pill.className).toContain('border-dashed')
    expect(q('[data-testid="smart-selected-count"]')!.textContent).toBe('1 selected')
    await click(q('[data-testid="smart-group-category"]', groupEl('VONS')))
    await click(q('[data-testid="bucket-picker-clear"]', document))
    expect(q('[data-testid="category-pill"]', groupEl('VONS'))!.dataset.state).toBe('suggested')
    expect(q('[data-testid="smart-selection-bar"]')).toBeNull()
    expect(posts()).toEqual([])
  })

  it('the stepper marks the current step: select, then check, then approve', async () => {
    await render(<SmartReview />, smartData())
    const current = () => q('[data-testid="smart-steps"] [aria-current="step"]')!.textContent
    expect(current()).toBe('1Select transactions')
    await click(q('[data-testid="smart-group-select"]', groupEl('NETLIFY')))
    expect(current()).toBe('2Check the category')
    await click(q('[data-testid="smart-approve"]'))
    expect(current()).toBe('3Approve selected')
  })

  it('a pending exception cannot be categorized yet and says why (same rule as the old disabled Save)', async () => {
    await render(<SmartReview />, smartData())
    await click(q('[data-testid="smart-exception-group"] button'))
    const b = q('[data-testid="smart-exception-category"]') as HTMLButtonElement
    expect(b.disabled).toBe(true); expect(q('[data-testid="smart-exception-row"]')!.textContent).toContain('Can be categorized once it posts.')
  })

  it('one selection bar and one confirmation for both surfaces: blue, above the home indicator, with category dots in the breakdown', async () => {
    await render(<SmartReview />, smartData())
    await click(q('[data-testid="smart-group-select"]', groupEl('NETLIFY')))
    const bar = q('[data-testid="smart-selection-bar"]')!
    expect(bar.className).toContain('sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))]'); expect(bar.style.borderColor).toBe('var(--fin-protected-border)')
    await click(q('[data-testid="smart-approve"]'))
    expect(q('[data-testid="smart-confirm-title"]')!.textContent).toBe('Approve 2 transactions?')
    expect(q('[data-testid="smart-confirm-breakdown"] li')!.textContent).toBe('Materials · 2$38.00')
  })

  it('Review Selected: the category opens the same sheet (only batch categories); choosing changes the draft, not the server', async () => {
    const mk = (id: string, merchant: string) => row({ id, merchant, name: merchant })
    await render(<SpendingExplorer />, payload([mk('a1', 'CHEVRON'), mk('a2', 'SHELL')]))
    await click(q('[data-testid="spending-select-all"]')); await click(q('[data-testid="spending-review-selected"]'))
    const item = qa('[data-testid="spending-selected-item"]').find(i => i.textContent!.includes('SHELL'))!
    expect(item.querySelector('select')).toBeNull()
    await click(q('[data-testid="spending-selected-category"]', item))
    expect(sheetKeys()).toEqual(['materials', 'fuel_vehicle', 'meals'])
    await click(q('[data-option="meals"]', document)); await click(q('[data-testid="bucket-picker-apply"]', document))
    expect(q('[data-testid="spending-category-changed"]', item)!.textContent).toMatch(/Changed from the suggestion \(Fuel \/ Vehicle\)/)
    expect(posts()).toEqual([])
  })
})

describe('BANK-6F step 6 · views, search and filters', () => {
  const gets = () => (globalThis.fetch as any).mock.calls.filter(([, i]: any) => !i || i.method === 'GET').map(([u]: any) => String(u))
  const lastQuery = () => Object.fromEntries(new URLSearchParams(gets().slice(-1)[0].split('?')[1]))
  const setSel = async (label: RegExp, v: string) => {
    const el = qa('[data-testid="spending-filters"] label').find(l => label.test(l.textContent ?? ''))!.querySelector('select') as HTMLSelectElement
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })) }); await flush()
  }

  it('D6: all seven views are directly visible tabs (three primary, four in a visible wrapping row); no overflow menu, no sideways scroll', async () => {
    await render(<SpendingExplorer />, payload([row()]))
    const list = q('[role="tablist"]')!
    expect(qa('[role="tab"]', list)).toHaveLength(7)
    expect(list.className).not.toMatch(/overflow-x/); expect(qa('[role="tablist"] [class*="overflow-x"]')).toHaveLength(0)
    const groups = [...list.children] as HTMLElement[]
    expect(groups.map(g => qa('[role="tab"]', g).map(t => t.dataset.testid!.replace('spending-view-', '')))).toEqual([['review_queue', 'reviewed', 'all'], ['known_bills', 'unassigned', 'repeated_spending', 'needs_review']])
    for (const g of groups) expect(g.className).toContain('flex-wrap')
  })

  it('each view says exactly what it contains, matching the server rule (Unassigned excludes project-linked spending; Money out to review is money going out)', async () => {
    await render(<SpendingExplorer />, payload([row()]))
    const caption = () => (q('[data-testid="spending-view-caption"]') ?? q('[data-testid="spending-reviewed-caption"]'))!.textContent
    await click(q('[data-testid="spending-view-unassigned"]'))
    expect(caption()).toBe('Posted money going out that is not linked to a bill, debt, payroll, project, transfer, overhead or personal use, and not confidently matched to one.')
    await click(q('[data-testid="spending-view-needs_review"]'))
    expect(caption()).toBe('Money going out that is not yet reviewed or ignored.')
    await click(q('[data-testid="spending-view-known_bills"]'))
    expect(caption()).toBe('Money going out with a bill, debt or payroll payment, confirmed or suggested.')
  })

  it('search and the period are always visible; the filters panel groups the rest with a visible arrow on every menu', async () => {
    await render(<SpendingExplorer />, payload([row()]))
    expect(q('[data-testid="spending-search"]')).not.toBeNull(); expect(q('[data-testid="spending-period-90"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(q('[data-testid="spending-filters"]')).toBeNull()
    await click(q('[data-testid="spending-filters-toggle"]'))
    expect(qa('[data-testid="spending-filters"] legend').map(l => l.textContent)).toEqual(['Where', 'What', 'Status', 'Amount'])
    const selects = qa('[data-testid="spending-filters"] select')
    expect(selects).toHaveLength(6)
    for (const s of selects) expect(s.parentElement!.querySelector('svg')).not.toBeNull()
  })

  it('every active filter is a removable chip; removing one clears only that field (same query otherwise); Clear all is the same reset', async () => {
    await render(<SpendingExplorer />, payload([row()]))
    await click(q('[data-testid="spending-filters-toggle"]'))
    await setSel(/^Category/, 'meals'); await setSel(/^Confidence/, 'high')
    expect(qa('[data-testid="spending-filter-chip"]').map(c => c.textContent)).toEqual(['Category: Meals', 'Confidence: High'])
    expect(q('[data-testid="spending-filters-toggle"]')!.textContent).toBe('Filters (2)')
    await click(q('[aria-label="Remove filter: Category: Meals"]'))
    expect(lastQuery()).toMatchObject({ confidence: 'high' }); expect(lastQuery().bucket).toBeUndefined()
    await click(q('[data-testid="spending-filters-clear"]'))
    expect(lastQuery().confidence).toBeUndefined(); expect(q('[data-testid="spending-filter-chips"]')).toBeNull()
  })
})
