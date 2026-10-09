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
