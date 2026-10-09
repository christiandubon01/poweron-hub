// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
import { SWATCHES, contrast, isPaletteColor } from '../palette'
import { accountStripe, categoryStripe, stripeStyle, tintStyle } from '../stripes'
import { createDeviceColorStore, deviceColorsKey, loadTint, planImport, sanitizeColors, type ColorMaps, type DisplayColorStore } from '../colorStore'
import { AccountColorCard, ColorSwatchPicker, DisplayColorsProvider } from '../DisplayColors'
import SpendingExplorer from '@/features/spending-explorer/SpendingExplorer'
import SmartReview from '@/features/spending-explorer/SmartReview'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const ACCT = 'c0000000-0000-4000-8000-000000000001'
const ACCT2 = 'c0000000-0000-4000-8000-000000000002'
const TEAL = '#14998f', GOLD = '#a8841f', ROSE = '#cf4f7d', COPPER = '#c0652f'
const ORG_A = 'a0000000-0000-4000-8000-000000000001', ORG_B = 'a0000000-0000-4000-8000-000000000002'

/** An in-memory organization store that records every write (and proves nothing else is called). */
function memoryStore(initial: Partial<ColorMaps> = {}, opts: { failWrites?: boolean } = {}) {
  const colors: ColorMaps = { categories: { ...(initial.categories ?? {}) }, accounts: { ...(initial.accounts ?? {}) } }
  const writes: Array<[string, string, string | null]> = []
  const store: DisplayColorStore = {
    async load() { return { colors: JSON.parse(JSON.stringify(colors)), storage: 'shared' } },
    async set(kind, key, color) {
      writes.push([kind, key, color])
      if (opts.failWrites) throw new Error('Only owners and admins can change colors.')
      const m = kind === 'category' ? colors.categories : colors.accounts
      if (color) m[key] = color; else delete m[key]
      return { storage: 'shared' }
    },
  }
  return { store, writes, colors }
}

describe('BANK-6D palette and stripe rules (pure)', () => {
  it('every curated swatch is named, unique, and keeps 3:1 contrast against the card background in BOTH themes; no status colors are reused', () => {
    expect(SWATCHES.length).toBeGreaterThanOrEqual(10)
    expect(new Set(SWATCHES.map(s => s.hex)).size).toBe(SWATCHES.length); expect(new Set(SWATCHES.map(s => s.name)).size).toBe(SWATCHES.length)
    for (const s of SWATCHES) {
      expect(s.hex).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrast(s.hex, '#232738'), `${s.name} on dark`).toBeGreaterThanOrEqual(3)
      expect(contrast(s.hex, '#f1f5f9'), `${s.name} on light`).toBeGreaterThanOrEqual(3)
    }
    const css = readFileSync('src/index.css', 'utf8')
    const status = [...css.matchAll(/--fin-(?:cash|free|protected|negative|warning):\s*(#[0-9a-f]{6})/gi)].map(m => m[1].toLowerCase())
    expect(status.length).toBeGreaterThan(0)
    for (const s of SWATCHES) expect(status).not.toContain(s.hex)
  })

  it('confirmed -> solid (tint only if enabled); suggested -> faded, never tinted; unknown / ignored -> neutral; no color assigned -> no stripe', () => {
    const colorOf = (k: string) => ({ fuel_vehicle: TEAL } as Record<string, string>)[k] ?? null
    expect(categoryStripe({ key: 'fuel_vehicle', state: 'confirmed' }, colorOf, false)).toEqual({ kind: 'solid', color: TEAL, tint: false })
    expect(categoryStripe({ key: 'fuel_vehicle', state: 'confirmed' }, colorOf, true)).toEqual({ kind: 'solid', color: TEAL, tint: true })
    expect(categoryStripe({ key: 'fuel_vehicle', state: 'suggested' }, colorOf, true)).toEqual({ kind: 'faded', color: TEAL, tint: false })
    expect(categoryStripe({ key: 'materials', state: 'confirmed' }, colorOf, true)).toEqual({ kind: 'none', color: null, tint: false })
    expect(categoryStripe({ key: 'other_needs_review', state: 'confirmed' }, colorOf, true).kind).toBe('neutral')
    expect(categoryStripe({ key: null, state: 'none' }, colorOf, true).kind).toBe('neutral')
    expect(categoryStripe({ key: 'fuel_vehicle', state: 'confirmed', ignored: true }, colorOf, true)).toEqual({ kind: 'neutral', color: null, tint: false })
    expect(tintStyle(categoryStripe({ key: 'fuel_vehicle', state: 'suggested' }, colorOf, true))).toBeUndefined()
    expect(stripeStyle({ kind: 'faded', color: TEAL, tint: false })).toEqual({ background: 'transparent', boxShadow: `inset 0 0 0 1.5px ${TEAL}` }) // BANK-6E: a HOLLOW rail for suggestions (a shape cue, not just color)
    expect(stripeStyle({ kind: 'solid', color: TEAL, tint: false })).toEqual({ background: TEAL })
    expect(accountStripe(GOLD, true)).toEqual({ kind: 'solid', color: GOLD, tint: true }); expect(accountStripe(null, true).kind).toBe('none')
  })

  it('stored colors are sanitized: only stable keys (category keys, account UUIDs) and curated colors survive; labels/names never become keys', () => {
    expect(sanitizeColors({ categories: { fuel_vehicle: TEAL, 'Fuel / Vehicle': TEAL, meals: '#123456', x: TEAL }, accounts: { [ACCT.toUpperCase()]: GOLD, 'Wells Fargo': GOLD } }))
      .toEqual({ categories: { fuel_vehicle: TEAL }, accounts: { [ACCT]: GOLD } })
    expect(sanitizeColors('junk')).toEqual({ categories: {}, accounts: {} })
    expect(isPaletteColor('#FFFFFF')).toBe(false)
  })

  it('the device fallback store validates writes and survives tampering; tint defaults to OFF', async () => {
    window.localStorage.clear()
    const s = createDeviceColorStore(ORG_A)
    await s.set('category', 'meals', ROSE)
    await expect(s.set('category', 'Meals', ROSE)).rejects.toThrow(); await expect(s.set('account', 'Chase', ROSE)).rejects.toThrow(); await expect(s.set('category', 'meals', 'red')).rejects.toThrow()
    expect((await s.load()).colors.categories).toEqual({ meals: ROSE })
    window.localStorage.setItem(deviceColorsKey(ORG_A)!, '{not json')
    expect((await s.load()).colors).toEqual({ categories: {}, accounts: {} })
    window.localStorage.removeItem('poweron.display.tint.v1')
    expect(loadTint()).toEqual({ rows: false, accounts: false })
  })
})

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', date: '2026-10-03', name: 'CHEVRON 0098', merchant: 'CHEVRON', merchantKey: 'CHEVRON', amountMinor: 6210, direction: 'money_out', pending: false,
  account: { ref: 'a1', label: 'Tartan', mask: '0000', ownership: 'business', mappedTo: 'Wells Fargo Business Checking 6960', mapped: true, environment: 'production', financialAccountId: ACCT },
  bucket: { key: 'fuel_vehicle', label: 'Fuel / Vehicle', state: 'confirmed', confidence: 'high', reasons: [] },
  relationship: { kind: 'unknown', label: 'Unknown', target: null, state: 'none', confidence: null, reasons: [] },
  review: 'confirmed', scope: { value: 'business', source: 'account' }, unassigned: false, repeatedPattern: false, pattern: null, ...over,
})
const analytics = { asOf: '2026-10-07', windowDays: 30, unassigned: { totalMinor: 0, count: 0, previousMinor: 0, deltaMinor: 0, byBucket: [] }, knownBills: { totalMinor: 0, count: 0, confirmedCount: 0, suggestedCount: 0 },
  pending: { totalMinor: 0, count: 0 }, review: { needsReviewCount: 0, repeatedPatternCount: 0 }, unclassified: { totalMinor: 0, count: 0 }, observations: [], suggestions: [] }
const BUCKETS = [{ key: 'fuel_vehicle', label: 'Fuel / Vehicle', hint: '' }, { key: 'meals', label: 'Meals', hint: '' }, { key: 'materials', label: 'Materials', hint: '' }, { key: 'other_needs_review', label: 'Other / Needs Review', hint: '' }]
const payload = (rows: unknown[]) => ({
  asOf: '2026-10-07', draftScope: 'abcdef0123456789', accounts: 'mapped', environment: 'production', meta: { billCandidates: 0, activeObligations: 0, scheduledCommitments: 0, evidenceRows: rows.length, hiddenUnmapped: 0, olderThanPeriod: 0, periodFrom: '2026-07-10' },
  analytics, viewCounts: { review_queue: 1, reviewed: 1, all: rows.length, known_bills: 0, unassigned: 0, repeated_spending: 0, needs_review: 0 }, reviewCounts: { reviewed: 1, unreviewed: 1, excluded: 0 }, total: rows.length, rows,
  options: { batchBuckets: ['fuel_vehicle', 'meals', 'materials'], maxBatch: 100, buckets: BUCKETS, accounts: [], obligations: [], commitments: [], debts: [], projects: [] },
})

describe('BANK-6D surfaces', () => {
  let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>
  const render = async (ui: React.ReactNode, get?: unknown) => {
    fetchMock = vi.fn(async (_u: string, init?: any) => ({ ok: true, status: 200, json: async () => (init?.method === 'POST' ? { outcome: 'created' } : get) }))
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(ui) }); await flush()
  }
  const q = (s: string) => host.querySelector(s) as HTMLElement | null
  const qa = (s: string) => [...host.querySelectorAll(s)] as HTMLElement[]
  const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click() }); await flush() }
  const rowById = (id: string) => qa('[data-testid="spending-row"]').find(r => r.textContent!.includes(id === 'r1' ? 'CHEVRON' : id === 'r2' ? 'STARBUCKS' : id === 'r3' ? 'ZZQ' : id === 'r4' ? 'IGNORED CO' : 'SHELL'))!
  beforeEach(() => { window.localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  const rows = [
    row(), // confirmed fuel (teal)
    row({ id: 'r2', name: 'STARBUCKS', merchant: 'STARBUCKS', review: 'suggested', bucket: { key: 'meals', label: 'Meals', state: 'suggested', confidence: 'high', reasons: [] } }), // suggested meals (rose)
    row({ id: 'r3', name: 'ZZQ', merchant: 'ZZQ', review: 'needs_review', bucket: { key: 'other_needs_review', label: 'Other / Needs Review', state: 'none', confidence: null, reasons: [] } }),
    row({ id: 'r4', name: 'IGNORED CO', merchant: 'IGNORED CO', review: 'ignored' }),
    row({ id: 'r5', name: 'SHELL', merchant: 'SHELL', review: 'suggested', bucket: { key: 'meals', label: 'Meals', state: 'suggested', confidence: 'high', reasons: [] },
      relationship: { kind: 'overhead', label: 'General overhead', target: null, state: 'confirmed', confidence: 'high', reasons: [] } }), // relationship-only reviewed
  ]

  it('Explorer rows: solid rail for confirmed, hollow rail for suggested and relationship-only, neutral for unknown and ignored; text cues unchanged; no tint by default', async () => {
    const m = memoryStore({ categories: { fuel_vehicle: TEAL, meals: ROSE } })
    await render(<DisplayColorsProvider store={m.store}><SpendingExplorer /></DisplayColorsProvider>, payload(rows))
    await click(q('[data-testid="spending-view-all"]'))
    const stripe = (id: string) => rowById(id).querySelector('[data-testid="color-stripe"]') as HTMLElement
    expect(stripe('r1').dataset).toMatchObject({ stripe: 'solid', color: TEAL })
    expect(stripe('r2').dataset).toMatchObject({ stripe: 'faded', color: ROSE })
    expect(stripe('r3').dataset.stripe).toBe('neutral'); expect(stripe('r4').dataset.stripe).toBe('neutral')
    expect(stripe('r5').dataset.stripe).toBe('faded') // relationship confirmed, category still a suggestion: never solid
    expect(rowById('r2').textContent).toContain('Suggested · Meals'); expect(rowById('r1').textContent).toContain('✓ Fuel / Vehicle')
    expect(qa('[data-testid="spending-row"]').every(r => r.dataset.tint === 'off')).toBe(true)
    expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST')).toEqual([])
  })

  it('the row-tint switch tints ONLY confirmed rows; turning it off removes the tint and keeps the stripe; it is remembered on this device only', async () => {
    const m = memoryStore({ categories: { fuel_vehicle: TEAL, meals: ROSE } })
    await render(<DisplayColorsProvider store={m.store}><SpendingExplorer /></DisplayColorsProvider>, payload(rows))
    await click(q('[data-testid="spending-view-all"]'))
    await click(q('[data-testid="spending-colors-toggle"]'))
    await click(q('[data-testid="tint-rows"]'))
    expect(rowById('r1').dataset.tint).toBe('on'); expect(rowById('r1').style.background).toContain('rgba(20, 153, 143, 0.1)')
    for (const id of ['r2', 'r3', 'r4', 'r5']) expect(rowById(id).dataset.tint, id).toBe('off')
    expect(JSON.parse(window.localStorage.getItem('poweron.display.tint.v1')!)).toEqual({ rows: true, accounts: false })
    expect(m.writes).toEqual([]) // a viewing preference is not an organization write
    await click(q('[data-testid="tint-rows"]'))
    expect(rowById('r1').dataset.tint).toBe('off'); expect((rowById('r1').querySelector('[data-testid="color-stripe"]') as HTMLElement).dataset.stripe).toBe('solid')
  })

  it('choosing a color in the Colors panel saves it organization-wide by category KEY, updates stripes at once, and "None" removes it', async () => {
    const m = memoryStore()
    await render(<DisplayColorsProvider store={m.store}><SpendingExplorer /></DisplayColorsProvider>, payload(rows))
    await click(q('[data-testid="spending-view-all"]'))
    await click(q('[data-testid="spending-colors-toggle"]'))
    const panel = q('[data-testid="colors-panel"]')!
    expect(panel.textContent).toContain('never mean approved or reviewed'); expect(panel.textContent).toContain('shared with your organization')
    expect(panel.textContent).not.toContain('Other / Needs Review') // unknown is always neutral, never colored
    await click([...panel.querySelectorAll('[data-testid="color-line"] button')].find(b => b.textContent!.startsWith('Fuel / Vehicle'))!)
    await click(panel.querySelector('[aria-label="Color for Fuel / Vehicle"] [aria-label="Teal"]'))
    expect(m.writes).toEqual([['category', 'fuel_vehicle', TEAL]])
    expect((rowById('r1').querySelector('[data-testid="color-stripe"]') as HTMLElement).dataset).toMatchObject({ stripe: 'solid', color: TEAL })
    await click(panel.querySelector('[aria-label="Color for Fuel / Vehicle"] [aria-label="No color"]'))
    expect(m.writes[1]).toEqual(['category', 'fuel_vehicle', null])
    expect((rowById('r1').querySelector('[data-testid="color-stripe"]') as HTMLElement).dataset.stripe).toBe('none')
    expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST')).toEqual([]) // no financial endpoint was called
  })

  it('a refused write (not an owner/admin) puts the color back and says why', async () => {
    const m = memoryStore({}, { failWrites: true })
    await render(<DisplayColorsProvider store={m.store}><SpendingExplorer /></DisplayColorsProvider>, payload(rows))
    await click(q('[data-testid="spending-view-all"]')); await click(q('[data-testid="spending-colors-toggle"]'))
    const panel = q('[data-testid="colors-panel"]')!
    await click([...panel.querySelectorAll('[data-testid="color-line"] button')].find(b => b.textContent!.startsWith('Fuel / Vehicle'))!)
    await click(panel.querySelector('[aria-label="Color for Fuel / Vehicle"] [aria-label="Teal"]'))
    expect(q('[data-testid="colors-panel"] [role="alert"]')!.textContent).toBe('Only owners and admins can change colors.')
    expect((rowById('r1').querySelector('[data-testid="color-stripe"]') as HTMLElement).dataset.stripe).toBe('none')
  })

  it('a renamed category label keeps its color (colors are keyed by the stable key, not the label)', async () => {
    const m = memoryStore({ categories: { fuel_vehicle: TEAL } })
    const renamed = payload([row({ bucket: { key: 'fuel_vehicle', label: 'Vehicles & Fuel', state: 'confirmed', confidence: 'high', reasons: [] } })])
    await render(<DisplayColorsProvider store={m.store}><SpendingExplorer /></DisplayColorsProvider>, renamed)
    await click(q('[data-testid="spending-view-all"]'))
    expect((q('[data-testid="spending-row"] [data-testid="color-stripe"]') as HTMLElement).dataset).toMatchObject({ stripe: 'solid', color: TEAL })
  })

  it('the account color appears as a small square next to the account NAME (the category keeps the stripe); unmapped rows show no square', async () => {
    const m = memoryStore({ categories: { fuel_vehicle: TEAL }, accounts: { [ACCT]: GOLD } })
    await render(<DisplayColorsProvider store={m.store}><SpendingExplorer /></DisplayColorsProvider>, payload([row(), row({ id: 'r6', name: 'SHELL', merchant: 'SHELL', account: { ref: 'a2', label: 'Unmapped', mask: null, ownership: null, mappedTo: null, mapped: false, environment: 'production', financialAccountId: null } })]))
    await click(q('[data-testid="spending-view-all"]'))
    const [a, b] = qa('[data-testid="spending-row"]')
    expect((a.querySelector('[data-testid="account-color-dot"]') as HTMLElement).dataset.color).toBe(GOLD)
    expect(a.textContent).toContain('Wells Fargo Business Checking 6960')
    expect((a.querySelector('[data-testid="color-stripe"]') as HTMLElement).dataset.color).toBe(TEAL)
    expect(b.querySelector('[data-testid="account-color-dot"]')).toBeNull()
  })

  it('selection is a ring plus the "✓ Selected" chip; the category stripe stays on the left edge', async () => {
    const m = memoryStore({ categories: { meals: ROSE } })
    await render(<DisplayColorsProvider store={m.store}><SpendingExplorer /></DisplayColorsProvider>, payload([rows[1]]))
    await click(q('[data-testid="spending-view-all"]'))
    await act(async () => { (q('[data-testid="spending-select"]') as HTMLInputElement).click() }); await flush()
    const r = q('[data-testid="spending-row"]')!
    expect(r.dataset.selected).toBe('true'); expect(r.style.boxShadow).toBe('0 0 0 2px var(--fin-protected-border)') /* BANK-6F D1: a selection is blue, never the green of money in */; expect(r.style.boxShadow).not.toContain('inset')
    expect(r.textContent).toContain('✓ Selected')
    expect((r.querySelector('[data-testid="color-stripe"]') as HTMLElement).dataset).toMatchObject({ stripe: 'faded', color: ROSE })
  })

  it('without a provider (or before colors load) every surface renders exactly as before: no stripes with colors, no Colors button', async () => {
    await render(<SpendingExplorer />, payload(rows))
    await click(q('[data-testid="spending-view-all"]'))
    expect(q('[data-testid="spending-colors-toggle"]')).toBeNull()
    expect(qa('[data-testid="color-stripe"]').every(s => s.dataset.stripe === 'neutral' || s.dataset.stripe === 'none')).toBe(true)
  })

  it('Smart Review groups are suggestions: a faded stripe in the category color, never solid or tinted, even after the owner picks a category', async () => {
    window.localStorage.setItem('poweron.display.tint.v1', JSON.stringify({ rows: true, accounts: true }))
    const m = memoryStore({ categories: { meals: ROSE, fuel_vehicle: TEAL } })
    const smart = { asOf: '2026-10-07', accounts: 'mapped', draftScope: 'abcdef0123456789', rulesAvailable: true, maxBatch: 100, merchantRules: [],
      groups: [{ id: 'VONS|meals', merchantKey: 'VONS', merchant: 'VONS', bucket: { key: 'meals', label: 'Meals' }, confidence: 'possible', basis: 'provider_category', needsChoice: true, mixed: true, count: 1, totalMinor: 8351, flaggedCount: 0, reasons: [], rows: [{ id: 'c0000000-0000-4000-8000-0000000000aa', date: '2026-09-08', name: 'VONS', amountMinor: 8351, flags: [] }] }],
      exceptions: [{ reason: 'unclear', label: 'Unclear', count: 1, totalMinor: 4000, rows: [{ id: 'c0000000-0000-4000-8000-0000000000bb', date: '2026-09-05', name: 'ZZQ', merchant: 'ZZQ', amountMinor: 4000, direction: 'money_out', reason: 'unclear', why: 'x', suggested: { key: null, label: null, confidence: null } }] }],
      totals: { groupedCount: 1, groupedMinor: 8351, groups: 1, exceptionCount: 1 }, options: { buckets: BUCKETS, batchBuckets: ['fuel_vehicle', 'meals', 'materials'] } }
    await render(<DisplayColorsProvider store={m.store}><SmartReview /></DisplayColorsProvider>, smart)
    const g = q('[data-testid="smart-group"]')!
    expect((g.querySelector('[data-testid="color-stripe"]') as HTMLElement).dataset).toMatchObject({ stripe: 'faded', color: ROSE })
    // BANK-6F: the group category is chosen in the shared sheet (open, pick, Use)
    await click(g.querySelector('[data-testid="smart-group-category"]')); await click(document.querySelector('[role="dialog"] [data-option="fuel_vehicle"]')); await click(document.querySelector('[data-testid="bucket-picker-apply"]'))
    expect((q('[data-testid="smart-group"] [data-testid="color-stripe"]') as HTMLElement).dataset).toMatchObject({ stripe: 'faded', color: TEAL }) // chosen, not approved
    expect(q('[data-testid="smart-group"]')!.getAttribute('style') ?? '').not.toContain('rgba')
    await click(q('[data-testid="smart-exception-group"] button'))
    expect((q('[data-testid="smart-exception-row"] [data-testid="color-stripe"]') as HTMLElement).dataset.stripe).toBe('neutral')
  })

  it('account cards: a permanent stripe in the account color, an optional tint (off by default), archived cards never tinted', async () => {
    const m = memoryStore({ accounts: { [ACCT]: GOLD } })
    await render(<DisplayColorsProvider store={m.store} accounts={[{ id: ACCT, label: 'Wells Fargo' }, { id: ACCT2, label: 'Chase' }]}>
      <AccountColorCard accountId={ACCT}><strong>Wells Fargo</strong></AccountColorCard>
      <AccountColorCard accountId={ACCT2}><strong>Chase</strong></AccountColorCard>
      <AccountColorCard accountId={ACCT} archived><strong>Old</strong></AccountColorCard>
    </DisplayColorsProvider>)
    const cards = qa('[data-testid="account-card"]')
    expect((cards[0].querySelector('[data-testid="color-stripe"]') as HTMLElement).dataset).toMatchObject({ stripe: 'solid', color: GOLD })
    expect((cards[1].querySelector('[data-testid="color-stripe"]') as HTMLElement).dataset.stripe).toBe('none')
    expect(cards.every(c => c.dataset.tint === 'off')).toBe(true)
    window.localStorage.setItem('poweron.display.tint.v1', JSON.stringify({ rows: false, accounts: true }))
    act(() => root.unmount()); root = createRoot(host)
    await render(<DisplayColorsProvider store={m.store}><AccountColorCard accountId={ACCT}><b>W</b></AccountColorCard><AccountColorCard accountId={ACCT} archived><b>O</b></AccountColorCard></DisplayColorsProvider>)
    const [live, archived] = qa('[data-testid="account-card"]')
    expect(live.dataset.tint).toBe('on'); expect(archived.dataset.tint).toBe('off')
    expect((archived.querySelector('[data-testid="color-stripe"]') as HTMLElement).dataset.stripe).toBe('solid')
  })

  it('the swatch picker: a labelled radio group with "No color" and named 44px swatches', async () => {
    let picked: string | null = 'x'
    await render(<ColorSwatchPicker label="Meals" value={ROSE} onChange={c => { picked = c }} />)
    const group = q('[role="radiogroup"]')!
    expect(group.getAttribute('aria-label')).toBe('Color for Meals')
    const radios = qa('[role="radio"]')
    expect(radios).toHaveLength(SWATCHES.length + 1)
    expect(radios[0].getAttribute('aria-label')).toBe('No color')
    expect(radios.every(r => /min-h-\[44px\]/.test(r.className) && /min-w-\[44px\]/.test(r.className))).toBe(true)
    expect(radios.find(r => r.getAttribute('aria-label') === 'Rose')!.getAttribute('aria-checked')).toBe('true')
    await click(radios[0]); expect(picked).toBeNull()
  })

  it('Cash OS mounts one provider scoped to its organization and keyed by financial_accounts.id (never names) around the bank panel, Explorer and account cards', () => {
    const src = readFileSync('src/components/v15r/cash-os/CashOsViews.tsx', 'utf8')
    expect(src).toMatch(/<DisplayColorsProvider organizationId=\{snapshot\.setup\?\.organizationId \?\? null\} accounts=\{\[\.\.\.accounts, \.\.\.archivedAccounts\]\.map\(a => \(\{ id: a\.id, label: a\.display_name, detail: /) // scoped to the Cash OS organization, keyed by account id
    expect((src.match(/<AccountColorCard key=\{account\.id\} accountId=\{account\.id\}/g) ?? []).length).toBe(2)
  })
})

import { ColorsPanel, useDisplayColors } from '../DisplayColors'
function Probe() { const c = useDisplayColors(); return <output data-testid="probe" data-enabled={String(c.enabled)} data-storage={c.storage ?? ''}>{JSON.stringify(c.colors)}</output> }
const CATS = [{ key: 'fuel_vehicle', label: 'Fuel / Vehicle' }, { key: 'meals', label: 'Meals' }]

describe('BANK-6D organization scoping and device-color import', () => {
  let host: HTMLDivElement, root: Root
  const render = async (ui: React.ReactNode) => { await act(async () => { root.render(ui) }); await flush() }
  const q = (s: string) => host.querySelector(s) as HTMLElement | null
  const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click() }); await flush() }
  const probe = () => JSON.parse(q('[data-testid="probe"]')!.textContent!)
  const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await flush(); expect(ok()).toBe(true) }
  beforeEach(() => { window.localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  it('device colors are kept per organization; a missing or malformed organization id gets safe defaults and no storage key at all', async () => {
    const a = createDeviceColorStore(ORG_A), b = createDeviceColorStore(ORG_B)
    await a.set('category', 'meals', ROSE)
    expect((await b.load()).colors).toEqual({ categories: {}, accounts: {} })
    await b.set('category', 'meals', TEAL)
    expect((await a.load()).colors.categories).toEqual({ meals: ROSE }) // never overwritten by the other organization
    expect(deviceColorsKey(ORG_A)).not.toBe(deviceColorsKey(ORG_B))
    for (const bad of [null, undefined, '', 'org-1', 'a0000000-0000-4000-8000-00000000000Z']) {
      expect(deviceColorsKey(bad as never)).toBeNull()
      const none = createDeviceColorStore(bad as never)
      expect(none.available).toBe(false)
      expect((await none.load()).colors).toEqual({ categories: {}, accounts: {} })
      await expect(none.set('category', 'meals', ROSE)).rejects.toThrow(/organization could not be identified/)
    }
    expect(Object.keys(window.localStorage).filter(k => k.startsWith('poweron.display.colors')).sort()).toEqual([deviceColorsKey(ORG_A), deviceColorsKey(ORG_B)].sort())
    window.localStorage.setItem(deviceColorsKey(ORG_B)!, JSON.stringify({ categories: { meals: 'javascript:x', 'Meals': TEAL }, accounts: 'nope' }))
    expect((await b.load()).colors).toEqual({ categories: {}, accounts: {} })
    expect((await a.load()).colors.categories).toEqual({ meals: ROSE }) // one organization's bad data never affects another
  })

  it('switching organization never shows the previous organization\'s colors; without an organization id the provider stays off', async () => {
    await createDeviceColorStore(ORG_A).set('category', 'meals', ROSE)
    const offline = { from: () => ({ select: async () => ({ data: null, error: { code: '42P01', message: 'relation "cash_os_display_colors" does not exist' } }) }), rpc: async () => ({ data: null, error: { code: '42883' } }) }
    vi.doMock('@/lib/supabase', () => ({ supabase: offline }))
    await render(<DisplayColorsProvider organizationId={ORG_A}><Probe /></DisplayColorsProvider>)
    await until(() => q('[data-testid="probe"]')!.dataset.storage === 'device') // the store is imported lazily: wait for it, do not race it
    expect(probe().categories).toEqual({ meals: ROSE }); expect(q('[data-testid="probe"]')!.dataset.storage).toBe('device')
    await render(<DisplayColorsProvider organizationId={ORG_B}><Probe /></DisplayColorsProvider>)
    expect(probe().categories).toEqual({})
    await render(<DisplayColorsProvider organizationId={null}><Probe /><ColorsPanel categories={CATS} /></DisplayColorsProvider>)
    expect(q('[data-testid="probe"]')!.dataset.enabled).toBe('false'); expect(probe().categories).toEqual({}); expect(q('[data-testid="colors-panel"]')).toBeNull()
    vi.doUnmock('@/lib/supabase')
  })

  it('before migration 158 (device storage) there is nothing to import', async () => {
    const device = createDeviceColorStore(ORG_A); await device.set('category', 'meals', ROSE)
    await render(<DisplayColorsProvider store={device} deviceStore={device}><ColorsPanel categories={CATS} /></DisplayColorsProvider>)
    expect(q('[data-testid="import-device-colors"]')).toBeNull()
    expect(q('[data-testid="colors-panel"]')!.textContent).toContain('saved on this device for now')
  })

  const transition = async (shared: ReturnType<typeof memoryStore>) => {
    const device = createDeviceColorStore(ORG_A)
    await device.set('category', 'meals', ROSE); await device.set('category', 'fuel_vehicle', COPPER)
    await render(<DisplayColorsProvider store={shared.store} deviceStore={device}><ColorsPanel categories={CATS} /><Probe /></DisplayColorsProvider>)
    return device
  }

  it('after migration 158: device colors are offered, never applied automatically; conflicts are listed; "Not now" writes nothing', async () => {
    const shared = memoryStore({ categories: { fuel_vehicle: TEAL } })
    const device = await transition(shared)
    expect(probe().categories).toEqual({ fuel_vehicle: TEAL }) // shared colors shown as they are
    const box = q('[data-testid="import-device-colors"]')!
    expect(box.textContent).toContain('This device has 2 colors')
    expect(q('[data-testid="import-conflicts"]')!.textContent).toContain('Fuel / Vehicle: shared Teal, this device Copper')
    await click(q('[data-testid="import-decline"]'))
    expect(q('[data-testid="import-device-colors"]')).toBeNull()
    expect(shared.writes).toEqual([]); expect(probe().categories).toEqual({ fuel_vehicle: TEAL })
    expect((await device.load()).colors.categories).toEqual({ meals: ROSE, fuel_vehicle: COPPER }) // device colors preserved
  })

  it('import adds only new colors unless the owner also ticks "replace"; cancelling the confirmation writes nothing', async () => {
    const shared = memoryStore({ categories: { fuel_vehicle: TEAL } })
    const device = await transition(shared)
    await click(q('[data-testid="import-start"]'))
    expect(q('[data-testid="import-confirm"]')!.textContent).toContain('Add 1 new shared color')
    expect((q('[data-testid="import-replace"]') as HTMLInputElement).checked).toBe(false)
    await click(q('[data-testid="import-cancel"]')); expect(shared.writes).toEqual([])
    await click(q('[data-testid="import-start"]')); await click(q('[data-testid="import-confirm-button"]'))
    expect(shared.writes).toEqual([['category', 'meals', ROSE]]) // the different shared Fuel color was NOT replaced
    expect(probe().categories).toEqual({ fuel_vehicle: TEAL, meals: ROSE })
    expect(q('[data-testid="import-note"]')!.textContent).toContain('Imported 1 color')
    // the conflict is still offered, and is replaced only with the explicit tick
    expect(q('[data-testid="import-conflicts"]')!.textContent).toContain('Fuel / Vehicle')
    await click(q('[data-testid="import-start"]'))
    await act(async () => { (q('[data-testid="import-replace"]') as HTMLInputElement).click() }); await flush()
    await click(q('[data-testid="import-confirm-button"]'))
    expect(shared.writes[1]).toEqual(['category', 'fuel_vehicle', COPPER])
    expect(probe().categories).toEqual({ fuel_vehicle: COPPER, meals: ROSE })
    expect(q('[data-testid="import-device-colors"] [data-testid="import-start"]')).toBeNull()
    expect((await device.load()).colors.categories).toEqual({ meals: ROSE, fuel_vehicle: COPPER })
  })

  it('a non-owner cannot import: the write is refused, shared colors and device colors are unchanged, and the reason is shown', async () => {
    const shared = memoryStore({ categories: { fuel_vehicle: TEAL } }, { failWrites: true })
    const device = await transition(shared)
    await click(q('[data-testid="import-start"]')); await click(q('[data-testid="import-confirm-button"]'))
    expect(q('[data-testid="colors-panel"] [role="alert"]')!.textContent).toBe('Only owners and admins can change colors.')
    expect(probe().categories).toEqual({ fuel_vehicle: TEAL })
    expect((await device.load()).colors.categories).toEqual({ meals: ROSE, fuel_vehicle: COPPER })
  })

  it('plans skip accounts that are no longer listed, and colors already equal are not offered', () => {
    const plan = planImport({ categories: { meals: ROSE }, accounts: { [ACCT]: GOLD, [ACCT2]: TEAL } }, { categories: { meals: ROSE }, accounts: {} }, new Set([ACCT]))
    expect(plan).toEqual({ additions: [{ kind: 'account', key: ACCT, device: GOLD, shared: null }], conflicts: [], skipped: 1 })
  })
})
