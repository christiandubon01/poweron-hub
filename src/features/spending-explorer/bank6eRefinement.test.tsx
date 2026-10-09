// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
import { BucketPicker, type BucketOption } from './BucketPicker'
import SpendingExplorer from './SpendingExplorer'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const OPTIONS: BucketOption[] = [
  { key: 'materials', label: 'Materials', hint: 'Job materials and supplies' }, { key: 'fuel_vehicle', label: 'Fuel / Vehicle', hint: 'Fuel, repairs, tolls, parking' },
  { key: 'tools_equipment', label: 'Tools & Equipment', hint: 'Tools, meters, equipment' }, { key: 'software_subscriptions', label: 'Software / Subscriptions', hint: 'Apps, SaaS' },
  { key: 'meals', label: 'Meals', hint: 'Food and drink' }, { key: 'office_admin', label: 'Office / Admin', hint: 'Office supplies' },
  { key: 'payroll_people', label: 'Payroll / People', hint: 'Wages' }, { key: 'personal_owner', label: 'Personal / Owner', hint: 'Owner personal spending' },
  { key: 'transfers', label: 'Transfers', hint: 'Moving money' }, { key: 'other_needs_review', label: 'Other / Needs Review', hint: '' },
]

describe('BANK-6E category picker modal', () => {
  let host: HTMLDivElement, root: Root
  const q = (s: string) => document.querySelector(s) as HTMLElement | null
  const qa = (s: string) => [...document.querySelectorAll(s)] as HTMLElement[]
  const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click() }); await flush() }
  const mount = async (props: Partial<Parameters<typeof BucketPicker>[0]> = {}) => {
    const onApply = vi.fn(), onClose = vi.fn()
    await act(async () => { root.render(<BucketPicker open options={OPTIONS} currentKey="fuel_vehicle" suggestedKey="materials" context="CHEVRON · −$62.10 · Oct 7" onApply={onApply} onClose={onClose} {...props} />) }); await flush()
    return { onApply, onClose }
  }
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  it('is a labelled modal dialog with a header, the transaction context, grouped options and Current / Suggested markers', async () => {
    await mount()
    const dlg = q('[role="dialog"]')!
    expect(dlg.getAttribute('aria-modal')).toBe('true'); expect(q('#bucket-picker-title')!.textContent).toBe('Choose a category')
    expect(q('[data-testid="bucket-picker-context"]')!.textContent).toBe('CHEVRON · −$62.10 · Oct 7')
    expect(qa('[data-testid="bucket-picker-options"] section').map(s => s.getAttribute('aria-label'))).toEqual(['Everyday business expenses', 'People and owner', 'Money movement', 'Not sure yet'])
    expect(q('[data-option="fuel_vehicle"]')!.textContent).toContain('Current'); expect(q('[data-option="fuel_vehicle"]')!.getAttribute('aria-checked')).toBe('true')
    expect(q('[data-option="materials"]')!.textContent).toContain('Suggested')
    for (const r of qa('[role="radio"]')) expect(r.className).toMatch(/min-h-\[52px\]/)
  })

  it('offers only the categories it is given (no invented buckets)', async () => {
    await mount({ options: OPTIONS.slice(0, 2) })
    expect(qa('[role="radio"]').map(r => r.getAttribute('data-option'))).toEqual(['materials', 'fuel_vehicle'])
    expect(q('input[type="search"]')).toBeNull() // search only when it genuinely helps (more than 8 options)
  })

  it('choosing moves only a draft: Apply is disabled until something changes, Reset restores the current category, Apply sends the choice', async () => {
    const { onApply } = await mount()
    const apply = () => q('[data-testid="bucket-picker-apply"]') as HTMLButtonElement
    expect(apply().disabled).toBe(true)
    await click(q('[data-option="materials"]'))
    expect(apply().disabled).toBe(false); expect(q('[data-testid="bucket-picker-summary"]')!.textContent).toContain('Change to Materials (from Fuel / Vehicle)')
    await click(q('[data-testid="bucket-picker-reset"]'))
    expect(apply().disabled).toBe(true); expect(q('[data-option="fuel_vehicle"]')!.getAttribute('aria-checked')).toBe('true')
    expect(onApply).not.toHaveBeenCalled()
    await click(q('[data-option="meals"]')); await click(apply())
    expect(onApply).toHaveBeenCalledWith('meals')
  })

  it('Cancel, the close button, Escape and the backdrop all close without applying anything', async () => {
    for (const how of ['cancel', 'close', 'escape', 'backdrop'] as const) {
      const { onApply, onClose } = await mount()
      await click(q('[data-option="meals"]'))
      if (how === 'cancel') await click(q('[data-testid="bucket-picker-cancel"]'))
      if (how === 'close') await click(q('[aria-label="Close without changes"]'))
      if (how === 'backdrop') await click(q('[data-testid="bucket-picker-backdrop"]'))
      if (how === 'escape') await act(async () => { q('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
      expect(onClose, how).toHaveBeenCalled(); expect(onApply, how).not.toHaveBeenCalled()
    }
  })

  it('search narrows the list by name or description, and says so when nothing matches', async () => {
    await mount()
    const input = q('input[type="search"]') as HTMLInputElement
    const type = async (v: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })) }); await flush() }
    await type('fuel'); expect(qa('[role="radio"]').map(r => r.getAttribute('data-option'))).toEqual(['fuel_vehicle'])
    await type('owner'); expect(qa('[role="radio"]').map(r => r.getAttribute('data-option'))).toEqual(['personal_owner'])
    await type('zzz'); expect(q('[data-testid="bucket-picker-options"]')!.textContent).toContain('No category matches')
  })

  it('keyboard: focus starts inside the dialog and Tab wraps around inside it', async () => {
    await mount()
    expect(document.activeElement?.getAttribute('type')).toBe('search')
    const focusables = qa('[role="dialog"] button:not([disabled]), [role="dialog"] input')
    focusables[focusables.length - 1].focus()
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })) })
    expect(document.activeElement).toBe(focusables[0])
  })
})

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', date: '2026-10-03', name: 'X', merchant: 'X', merchantKey: 'X', amountMinor: 6210, direction: 'money_out', pending: false,
  account: { ref: 'a1', label: 'Tartan', mask: '0000', ownership: 'business', mappedTo: 'Checking', mapped: true, environment: 'production', financialAccountId: null },
  bucket: { key: 'fuel_vehicle', label: 'Fuel / Vehicle', state: 'confirmed', confidence: 'high', reasons: [] },
  relationship: { kind: 'unknown', label: 'Unknown', target: null, state: 'none', confidence: null, reasons: [] },
  review: 'confirmed', scope: { value: 'business', source: 'account' }, unassigned: false, repeatedPattern: false, pattern: null, ...over,
})
const analytics = { asOf: '2026-10-07', windowDays: 30, unassigned: { totalMinor: 0, count: 0, previousMinor: 0, deltaMinor: 0, byBucket: [] }, knownBills: { totalMinor: 0, count: 0, confirmedCount: 0, suggestedCount: 0 },
  pending: { totalMinor: 0, count: 0 }, review: { needsReviewCount: 0, repeatedPatternCount: 0 }, unclassified: { totalMinor: 0, count: 0 }, observations: [], suggestions: [] }

describe('BANK-6E income / expense presentation on entries', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  it('labels each entry from its interpretation (Expense, Income, Likely transfer, Refund, Money in) with a direction glyph and tone', async () => {
    const rows = [
      row(),
      row({ id: 'r2', merchant: 'MOBILE DEPOSIT', direction: 'money_in', amountMinor: -250000, bucket: { key: 'customer_payment', label: 'Customer payment', state: 'confirmed', confidence: 'high', reasons: [] } }),
      row({ id: 'r3', merchant: 'ONLINE TRANSFER', review: 'suggested', bucket: { key: 'transfers', label: 'Transfers', state: 'suggested', confidence: 'possible', reasons: [] }, relationship: { kind: 'transfer', label: 'Transfer', target: null, state: 'suggested', confidence: 'possible', reasons: [] } }),
      row({ id: 'r4', merchant: 'HOME DEPOT RETURN', direction: 'money_in', amountMinor: -4500, bucket: { key: 'refund', label: 'Refund', state: 'confirmed', confidence: 'high', reasons: [] } }),
      row({ id: 'r5', merchant: 'ZELLE FROM J', direction: 'money_in', amountMinor: -10000, review: 'needs_review', bucket: { key: null, label: null, state: 'none', confidence: null, reasons: [] } }),
    ]
    const payload = { asOf: '2026-10-07', draftScope: 'abcdef0123456789', accounts: 'mapped', meta: { billCandidates: 0, activeObligations: 0, scheduledCommitments: 0, evidenceRows: 5, hiddenUnmapped: 0, olderThanPeriod: 0, periodFrom: '2026-07-10' },
      analytics, viewCounts: { review_queue: 2, reviewed: 3, all: 5, known_bills: 0, unassigned: 0, repeated_spending: 0, needs_review: 1 }, reviewCounts: { reviewed: 3, unreviewed: 2, excluded: 0 }, total: 5, rows,
      options: { batchBuckets: ['fuel_vehicle'], maxBatch: 100, buckets: [{ key: 'fuel_vehicle', label: 'Fuel / Vehicle', hint: '' }], accounts: [], obligations: [], commitments: [], debts: [], projects: [] } }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })))
    await act(async () => { root.render(<SpendingExplorer />) }); await flush()
    await act(async () => { (host.querySelector('[data-testid="spending-view-all"]') as HTMLElement).click() }); await flush()
    const types = [...host.querySelectorAll('[data-testid="entry-type"]')].map(t => [(t as HTMLElement).dataset.kind, t.textContent])
    expect(types).toEqual([['expense', '↑Expense'], ['income', '↓Income'], ['transfer', '⇄Likely transfer'], ['refund', '↩Refund'], ['money_in', '↓Money in']])
    const amounts = [...host.querySelectorAll('[data-testid="entry-amount"]')] as HTMLElement[]
    expect(amounts[0].style.color).toBe(''); expect(amounts[1].style.color).toBe('var(--fin-cash)'); expect(amounts[2].style.color).toBe('var(--text-secondary)')
    expect(amounts[1].textContent).toBe('+$2,500.00')
  })

  it('motion everywhere in the refined surfaces is behind motion-safe: (reduced motion respected)', () => {
    for (const f of ['src/features/spending-explorer/BucketPicker.tsx', 'src/features/spending-explorer/SmartReview.tsx', 'src/features/spending-explorer/ui.ts']) {
      const src = readFileSync(f, 'utf8')
      expect(src.match(/(?<![\w:-])(transition(-[\w-]+)?|hover:scale-\d+|animate-[\w-]+)(?=[\s'"`])/g) ?? [], f).toEqual([])
    }
  })
})
