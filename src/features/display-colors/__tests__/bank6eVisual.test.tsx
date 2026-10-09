// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
import { ORIGINAL_HEXES, SWATCHES, SWATCH_GROUPS, contrast } from '../palette'
import { type ColorMaps, type DisplayColorStore } from '../colorStore'
import { AccountColorCard, CategoryPill, ColorsPanel, ColorSwatchPicker, DisplayColorsProvider } from '../DisplayColors'
import SpendingExplorer from '@/features/spending-explorer/SpendingExplorer'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const TEAL = '#14998f', GOLD = '#a8841f'
const ACCT = 'c0000000-0000-4000-8000-000000000001'

// CIEDE2000 (perceptual distance between two colors), used to hold the palette to "every swatch stays distinguishable".
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lab = (h: string) => { const n = parseInt(h.slice(1), 16); const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(lin)
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)] }
function de2000(h1: string, h2: string): number {
  const [L1, a1, b1] = lab(h1), [L2, a2, b2] = lab(h2), rad = Math.PI / 180
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2)
  const hue = (a: number, b: number) => { const v = Math.atan2(b, a) / rad; return v < 0 ? v + 360 : v }
  const h1p = hue(a1p, b1), h2p = hue(a2p, b2)
  let dh = h2p - h1p; if (C1p * C2p === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360
  const dL = L2 - L1, dC = C2p - C1p, dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad)
  const Lb = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2
  const hb = C1p * C2p === 0 ? h1p + h2p : Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad)
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T
  const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * Math.sin(2 * 30 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad)
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH))
}

describe('BANK-6E palette', () => {
  it('24 named, grouped swatches; every original BANK-6D color kept unchanged so saved organization colors stay valid', () => {
    expect(SWATCHES).toHaveLength(24)
    for (const hex of ORIGINAL_HEXES) expect(SWATCHES.map(s => s.hex), hex).toContain(hex)
    expect(new Set(SWATCHES.map(s => s.hex)).size).toBe(24); expect(new Set(SWATCHES.map(s => s.name)).size).toBe(24)
    expect(SWATCH_GROUPS.map(g => g.id)).toEqual(['warm', 'cool', 'natural', 'neutral'])
    for (const g of SWATCH_GROUPS) expect(SWATCHES.filter(s => s.group === g.id).length, g.id).toBeGreaterThanOrEqual(4)
  })

  it('one stable hex per swatch keeps >= 3:1 contrast on the card background of BOTH themes (no per-theme variants needed)', () => {
    for (const s of SWATCHES) {
      expect(contrast(s.hex, '#232738'), `${s.name} dark`).toBeGreaterThanOrEqual(3)
      expect(contrast(s.hex, '#f1f5f9'), `${s.name} light`).toBeGreaterThanOrEqual(3)
    }
  })

  it('no new swatch is closer to any other than the closest pair of the original palette (Indigo / Violet)', () => {
    let floor = Infinity
    for (let i = 0; i < ORIGINAL_HEXES.length; i++) for (let j = i + 1; j < ORIGINAL_HEXES.length; j++) floor = Math.min(floor, de2000(ORIGINAL_HEXES[i], ORIGINAL_HEXES[j]))
    expect(floor).toBeGreaterThan(8)
    const added = SWATCHES.filter(s => !ORIGINAL_HEXES.includes(s.hex))
    for (const s of added) for (const o of SWATCHES) if (o.hex !== s.hex) expect(de2000(s.hex, o.hex), `${s.name} vs ${o.name}`).toBeGreaterThanOrEqual(floor)
  })
})

function memoryStore(initial: Partial<ColorMaps> = {}) {
  const colors: ColorMaps = { categories: { ...(initial.categories ?? {}) }, accounts: { ...(initial.accounts ?? {}) } }
  const writes: Array<[string, string, string | null]> = []
  const store: DisplayColorStore = {
    async load() { return { colors: JSON.parse(JSON.stringify(colors)), storage: 'shared' } },
    async set(kind, key, color) { writes.push([kind, key, color]); const m = kind === 'category' ? colors.categories : colors.accounts; if (color) m[key] = color; else delete m[key]; return { storage: 'shared' } },
  }
  return { store, writes }
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', date: '2026-10-03', name: 'CHEVRON 0098', merchant: 'CHEVRON', merchantKey: 'CHEVRON', amountMinor: 6210, direction: 'money_out', pending: false,
  account: { ref: 'a1', label: 'Tartan', mask: '0000', ownership: 'business', mappedTo: 'Wells Fargo Business Checking 6960', mapped: true, environment: 'production', financialAccountId: ACCT },
  bucket: { key: 'fuel_vehicle', label: 'Fuel / Vehicle', state: 'confirmed', confidence: 'high', reasons: [] },
  relationship: { kind: 'unknown', label: 'Unknown', target: null, state: 'none', confidence: null, reasons: [] },
  review: 'confirmed', scope: { value: 'business', source: 'account' }, unassigned: false, repeatedPattern: false, pattern: null, ...over,
})
const analytics = { asOf: '2026-10-07', windowDays: 30, unassigned: { totalMinor: 30000, count: 2, previousMinor: 0, deltaMinor: 0, byBucket: [
  { key: 'fuel_vehicle', label: 'Fuel / Vehicle', totalMinor: 20000, count: 1, previousMinor: 0, deltaMinor: 0, merchants: 1, repeatedMerchants: 0 },
  { key: 'meals', label: 'Meals', totalMinor: 10000, count: 1, previousMinor: 0, deltaMinor: 0, merchants: 1, repeatedMerchants: 0 }] },
  knownBills: { totalMinor: 0, count: 0, confirmedCount: 0, suggestedCount: 0 }, pending: { totalMinor: 0, count: 0 }, review: { needsReviewCount: 0, repeatedPatternCount: 0 }, unclassified: { totalMinor: 0, count: 0 }, observations: [], suggestions: [] }
const BUCKETS = [{ key: 'fuel_vehicle', label: 'Fuel / Vehicle', hint: 'Fuel, repairs, tolls, parking' }, { key: 'meals', label: 'Meals', hint: 'Food and drink' }]
const payload = (rows: unknown[]) => ({
  asOf: '2026-10-07', draftScope: 'abcdef0123456789', accounts: 'mapped', environment: 'production', meta: { billCandidates: 0, activeObligations: 0, scheduledCommitments: 0, evidenceRows: rows.length, hiddenUnmapped: 0, olderThanPeriod: 0, periodFrom: '2026-07-10' },
  analytics, viewCounts: { review_queue: 1, reviewed: 1, all: rows.length, known_bills: 0, unassigned: 0, repeated_spending: 0, needs_review: 0 }, reviewCounts: { reviewed: 1, unreviewed: 1, excluded: 0 }, total: rows.length, rows,
  options: { batchBuckets: ['fuel_vehicle', 'meals'], maxBatch: 100, buckets: BUCKETS, accounts: [], obligations: [], commitments: [], debts: [], projects: [] },
})

describe('BANK-6E surfaces', () => {
  let host: HTMLDivElement, root: Root
  const render = async (ui: React.ReactNode, get?: unknown) => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: any) => ({ ok: true, status: 200, json: async () => (init?.method === 'POST' ? { outcome: 'created' } : get) })))
    await act(async () => { root.render(ui) }); await flush()
  }
  const q = (s: string) => host.querySelector(s) as HTMLElement | null
  const qa = (s: string) => [...host.querySelectorAll(s)] as HTMLElement[]
  const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click() }); await flush() }
  beforeEach(() => { window.localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  it('category pill: confirmed = "✓ label" with a color wash; suggested = "Suggested · label", dashed and unfilled; uncolored still explicit', async () => {
    const m = memoryStore({ categories: { fuel_vehicle: TEAL } })
    await render(<DisplayColorsProvider store={m.store}>
      <CategoryPill categoryKey="fuel_vehicle" label="Fuel / Vehicle" state="confirmed" />
      <CategoryPill categoryKey="fuel_vehicle" label="Fuel / Vehicle" state="suggested" />
      <CategoryPill categoryKey="meals" label="Meals" state="confirmed" />
      <CategoryPill categoryKey={null} label="Other / Needs Review" state="none" />
    </DisplayColorsProvider>)
    const [conf, sug, plain, none] = qa('[data-testid="category-pill"]')
    expect(conf.textContent).toBe('✓ Fuel / Vehicle'); expect(conf.dataset.state).toBe('confirmed'); expect(conf.style.background).toContain('rgba(20, 153, 143, 0.14)')
    expect(sug.textContent).toBe('Suggested · Fuel / Vehicle'); expect(sug.className).toContain('border-dashed'); expect(sug.style.background).toBe('')
    expect(plain.textContent).toBe('✓ Meals') // no color assigned: the text still says confirmed
    expect(none.textContent).toBe('Other / Needs Review')
  })

  it('entry card: merchant and amount share the top line, then date · account (with account dot), an explicit status word, and pills', async () => {
    const m = memoryStore({ categories: { fuel_vehicle: TEAL, meals: GOLD }, accounts: { [ACCT]: GOLD } })
    await render(<DisplayColorsProvider store={m.store}><SpendingExplorer /></DisplayColorsProvider>, payload([
      row(), row({ id: 'r2', name: 'STARBUCKS', merchant: 'STARBUCKS', review: 'suggested', bucket: { key: 'meals', label: 'Meals', state: 'suggested', confidence: 'high', reasons: [] } }),
    ]))
    await click(q('[data-testid="spending-view-all"]'))
    const [a, b] = qa('[data-testid="spending-row"]')
    const btn = a.querySelector('button[aria-expanded]')!
    expect(btn.children[0].textContent).toBe('CHEVRON'); expect(btn.children[1].textContent).toBe('−$62.10')
    expect(btn.children[1].className).toContain('tabular-nums')
    expect(btn.children[2].textContent).toBe('Oct 3 · Wells Fargo Business Checking 6960'); expect(btn.children[2].querySelector('[data-testid="account-color-dot"]')).not.toBeNull()
    expect(a.querySelector('[data-testid="entry-status"]')!.textContent).toBe('Reviewed'); expect(b.querySelector('[data-testid="entry-status"]')!.textContent).toBe('Suggested')
    expect((a.querySelector('[data-testid="color-stripe"]') as HTMLElement).dataset.stripe).toBe('solid')
    expect((b.querySelector('[data-testid="color-stripe"]') as HTMLElement).dataset.stripe).toBe('faded') // hollow rail
    expect((b.querySelector('[data-testid="color-stripe"]') as HTMLElement).style.boxShadow).toContain('inset 0 0 0 1.5px')
    expect(q('[data-testid="spending-list"]')!.className).toContain('space-y') // separated cards, compact spacing
  })

  it('batch checkboxes are visible despite the app-wide appearance:none reset, and merchants stay aligned when only some rows can be selected', async () => {
    const m = memoryStore({ categories: { meals: GOLD } })
    await render(<DisplayColorsProvider store={m.store}><SpendingExplorer /></DisplayColorsProvider>, payload([
      row(), row({ id: 'r2', name: 'STARBUCKS', merchant: 'STARBUCKS', review: 'suggested', bucket: { key: 'meals', label: 'Meals', state: 'suggested', confidence: 'high', reasons: [] } }),
    ]))
    await click(q('[data-testid="spending-view-all"]'))
    const box = q('[data-testid="spending-select"]') as HTMLInputElement
    // BANK-6F: the real checkbox input stays the control (keyboard, screen readers) over a DRAWN box, so the app-wide appearance:none reset cannot hide it
    expect(box.type).toBe('checkbox'); expect(box.className).toContain('opacity-0'); expect(box.nextElementSibling!.className).toContain('ring-[var(--surface-line)]')
    await click(box); expect(box.nextElementSibling!.className).toContain('bg-[var(--fin-protected)]') // checked = a filled blue box with a check
    const [confirmed] = qa('[data-testid="spending-row"]')
    expect(confirmed.querySelector('[data-testid="spending-select"]')).toBeNull()
    expect(confirmed.querySelector('span.min-w-\\[44px\\]')).not.toBeNull() // reserved column keeps the merchant aligned
  })

  it('Snapshot: a category dot before each colored category label; the bars keep the existing cash color', async () => {
    const m = memoryStore({ categories: { fuel_vehicle: TEAL } })
    await render(<DisplayColorsProvider store={m.store}><SpendingExplorer /></DisplayColorsProvider>, payload([row()]))
    const [fuel, meals] = qa('[data-testid="spending-bucket"]')
    expect((fuel.querySelector('[data-testid="category-dot"]') as HTMLElement).dataset.color).toBe(TEAL)
    expect(meals.querySelector('[data-testid="category-dot"]')).toBeNull()
    expect((fuel.querySelector('[aria-hidden="true"] span') as HTMLElement).style.background).toBe('var(--fin-cash)')
  })

  it('Colors panel: category descriptions, account details, a live preview (confirmed + suggested), grouped swatches and a "Selected" line', async () => {
    const m = memoryStore({ categories: { fuel_vehicle: TEAL } })
    await render(<DisplayColorsProvider store={m.store} accounts={[{ id: ACCT, label: 'Wells Fargo Checking', detail: 'Business · Checking' }]}><ColorsPanel categories={BUCKETS} /></DisplayColorsProvider>)
    const panel = q('[data-testid="colors-panel"]')!
    expect(panel.textContent).toContain('Fuel, repairs, tolls, parking'); expect(panel.textContent).toContain('Business · Checking'); expect(panel.textContent).toContain('Expense categories · 2')
    const lines = qa('[data-testid="color-line"]')
    expect(lines[0].textContent).toContain('Teal')
    await click(lines[0].querySelector('button'))
    const preview = q('[data-testid="color-preview"]')!
    expect(preview.textContent).toContain('✓ Fuel / Vehicle'); expect(preview.textContent).toContain('Suggested · Fuel / Vehicle')
    expect([...preview.querySelectorAll('[data-testid="color-stripe"]')].map(s => (s as HTMLElement).dataset.stripe)).toEqual(['solid', 'faded'])
    expect([...panel.querySelectorAll('[data-testid="color-picker"] p')].map(p => p.textContent).slice(0, 4)).toEqual(['Warm', 'Cool', 'Natural', 'Neutral'])
    expect(q('[data-testid="picker-selected"]')!.textContent).toBe('Selected: Teal')
    await click(q('[aria-label="Color for Fuel / Vehicle"] [aria-label="Grass"]'))
    expect(m.writes).toEqual([['category', 'fuel_vehicle', '#3f9a1e']])
    expect(q('[data-testid="picker-selected"]')!.textContent).toBe('Selected: Grass') // immediate preview of the new choice
    expect(q('[aria-label="Color for Fuel / Vehicle"] [aria-label="Grass"]')!.textContent).toBe('✓') // selected swatch carries a check, not color alone
    await click(qa('[data-testid="color-line"]')[2].querySelector('button')) // the account row
    expect(q('[data-testid="color-preview"]')!.textContent).toContain('Wells Fargo Checking')
  })

  it('picker: every swatch is a labelled 44px radio button reachable by keyboard, with a None option first', async () => {
    await render(<ColorSwatchPicker label="Meals" value={null} onChange={() => {}} />)
    const radios = qa('[role="radio"]')
    expect(radios).toHaveLength(25); expect(radios[0].getAttribute('aria-label')).toBe('No color'); expect(radios[0].getAttribute('aria-checked')).toBe('true')
    for (const r of radios) { expect(r.tagName).toBe('BUTTON'); expect(r.getAttribute('type')).toBe('button'); expect(r.className).toMatch(/min-h-\[44px\]/); expect(r.className).toMatch(/focus-visible:outline/) }
  })

  it('account card: a card-shaped rail in the account color; no color = a faint hairline rail', async () => {
    const m = memoryStore({ accounts: { [ACCT]: GOLD } })
    await render(<DisplayColorsProvider store={m.store}><AccountColorCard accountId={ACCT} className="rounded-xl"><b>A</b></AccountColorCard><AccountColorCard accountId="c0000000-0000-4000-8000-000000000009" className="rounded-xl"><b>B</b></AccountColorCard></DisplayColorsProvider>)
    const [a, b] = qa('[data-testid="color-stripe"]')
    expect(a.dataset.stripe).toBe('solid'); expect(a.className).toContain('rounded-full'); expect(a.className).toContain('w-[7px]') // a floating capsule rail
    expect(b.dataset.stripe).toBe('none'); expect(b.style.opacity).toBe('0.45')
  })

  it('motion is restrained and respects reduced-motion: every transition / transform is behind motion-safe:', () => {
    for (const f of ['src/features/display-colors/DisplayColors.tsx', 'src/features/spending-explorer/SpendingExplorer.tsx']) {
      const src = readFileSync(f, 'utf8')
      const bare = src.match(/(?<![\w:-])(transition-[\w-]+|hover:scale-\d+|animate-[\w-]+)/g) ?? []
      expect(bare, f).toEqual([])
    }
  })
})
