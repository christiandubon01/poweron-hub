/**
 * BANK-5D: spending-intelligence calibration. PURE engine tests (no database): mapped-account default view, repeated spending pattern vs
 * recurring obligation, unknown is not money bleed, subscription signals need context, duplicate signals cannot explode, windows are explicit.
 */
import { describe, expect, it } from 'vitest'
import { buildRows, filterRows, viewCounts, type AccountScope } from '../spending/explorer'
import { isDiscretionary, SUBSCRIPTION_BUCKETS } from '../spending/taxonomy'
import type { AccountContext, Decision, EvidenceTx, KnownBillCandidate } from '../spending/types'

const AS_OF = '2026-10-07'
let seq = 0
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
const MAPPED = '10000000-0000-4000-8000-0000000000a1'
const UNMAPPED = '10000000-0000-4000-8000-0000000000b2'
const ACCOUNTS: AccountContext[] = [
  { providerAccountRef: MAPPED, label: 'Tartan · Plaid Checking', mask: '0000', ownership: 'business', financialAccountId: 'fa-biz', financialAccountName: 'Wells Fargo Business Checking 6960' },
  { providerAccountRef: UNMAPPED, label: 'Tartan · Plaid Credit Card', mask: '3333', ownership: null, financialAccountId: null, financialAccountName: null },
]
const tx = (name: string, dollars: number, date: string, over: Partial<EvidenceTx> = {}): EvidenceTx => ({
  id: id(), providerAccountRef: MAPPED, date, name, merchantName: null, amountMinor: Math.round(dollars * 100), pending: false, removed: false, category: null, ...over,
})
const rowsFor = (txs: EvidenceTx[], over: { accountScope?: AccountScope; bills?: KnownBillCandidate[]; decisions?: Decision[] } = {}) =>
  buildRows({ asOf: AS_OF, accountScope: over.accountScope, txs, accounts: ACCOUNTS, decisions: over.decisions ?? [], bills: over.bills ?? [], obligationLabels: new Map(), commitmentLabels: new Map(), debts: [], projects: [] })
const series = (name: string, dollars: number, dates: string[], over: Partial<EvidenceTx> = {}) => dates.map(d => tx(name, dollars, d, over))
const WEEKLY = ['2026-09-10', '2026-09-17', '2026-09-24', '2026-10-01']
const MONTHLY = ['2026-07-05', '2026-08-04', '2026-09-03', '2026-10-03']

describe('BANK-5D mapped accounts define the default business view', () => {
  const evidence = () => [
    tx('CHEVRON 0098', 62.1, '2026-10-01'), tx('HOME DEPOT 6', 120, '2026-10-02'),
    tx('ZZQ HOLDINGS', 400, '2026-10-03', { providerAccountRef: UNMAPPED }), tx('KFC', 12, '2026-10-04', { providerAccountRef: UNMAPPED }),
  ]
  it('the default (mapped) scope excludes unmapped provider accounts from rows, headline, buckets and signals', () => {
    const r = rowsFor(evidence(), { accountScope: 'mapped' })
    expect(r.rows).toHaveLength(2)
    expect(r.rows.every(x => x.account.mapped)).toBe(true)
    expect(r.analytics.unassigned).toMatchObject({ totalMinor: 6210 + 12000, count: 2 })
    expect(r.analytics.unassigned.byBucket.map(b => b.key).sort()).toEqual(['fuel_vehicle', 'materials'])
    expect(viewCounts(r.rows).all).toBe(2)
  })
  it('the owner can explicitly inspect ALL connected accounts, and unmapped evidence is preserved, never dropped', () => {
    const mapped = rowsFor(evidence(), { accountScope: 'mapped' }), all = rowsFor(evidence(), { accountScope: 'all' })
    expect(all.rows).toHaveLength(4)
    expect(all.rows.filter(x => !x.account.mapped).map(x => x.merchant).sort()).toEqual(['KFC', 'ZZQ HOLDINGS'])
    expect(all.analytics.unassigned.totalMinor).toBe(6210 + 12000 + 40000 + 1200)
    expect(mapped.outOfScopeDates.sort()).toEqual(['2026-10-03', '2026-10-04']) // reported so the UI can say how much is hidden
    expect(all.outOfScopeDates).toEqual([])
    expect(mapped.rows.length + mapped.outOfScopeDates.length).toBe(all.rows.length)
  })
  it('mapping is explicit: an account is "mapped" only with a Cash OS account id, never inferred from name, type, mask or balance', () => {
    const lookalike: AccountContext = { providerAccountRef: UNMAPPED, label: 'Wells Fargo Business Checking 6960', mask: '6960', ownership: 'business', financialAccountId: null, financialAccountName: null }
    const r = buildRows({ asOf: AS_OF, accountScope: 'mapped', txs: [tx('CHEVRON', 50, '2026-10-01', { providerAccountRef: UNMAPPED })], accounts: [lookalike], decisions: [], bills: [], obligationLabels: new Map(), commitmentLabels: new Map(), debts: [], projects: [] })
    expect(r.rows).toEqual([]) // looks like the business account, but the owner never mapped it
    expect(r.outOfScopeDates).toEqual(['2026-10-01'])
  })
  it('transfers between a mapped and an unmapped account are still paired and stay out of unassigned spending', () => {
    const out = tx('ONLINE TRANSFER', 500, '2026-10-02'), inn = tx('ONLINE TRANSFER', -500, '2026-10-02', { providerAccountRef: UNMAPPED })
    const r = rowsFor([out, inn], { accountScope: 'mapped' })
    expect(r.rows.map(x => x.id)).toEqual([out.id])
    expect(r.rows[0]).toMatchObject({ relationship: { kind: 'transfer', state: 'suggested' }, unassigned: false })
    expect(r.analytics.unassigned.totalMinor).toBe(0)
  })
  it('pending evidence never enters a total, in either scope', () => {
    const t = [tx('CHEVRON', 70, '2026-10-06', { pending: true }), tx('CHEVRON', 30, '2026-10-05'), tx('ZZQ', 90, '2026-10-05', { providerAccountRef: UNMAPPED, pending: true })]
    for (const accountScope of ['mapped', 'all'] as const) {
      const a = rowsFor(t, { accountScope }).analytics
      expect(a.unassigned.totalMinor).toBe(3000)
      expect(a.pending.totalMinor).toBe(accountScope === 'all' ? 16000 : 7000)
    }
  })
  it('filtering is still available inside the all-accounts scope (account filter, views)', () => {
    const all = rowsFor(evidence(), { accountScope: 'all' }).rows
    expect(filterRows(all, { account: UNMAPPED }).map(r => r.merchant).sort()).toEqual(['KFC', 'ZZQ HOLDINGS'])
  })
})

describe('BANK-5D a repeated merchant is a spending pattern, not a recurring obligation', () => {
  it('repeated Starbucks is still DETECTED, but as a spending pattern with no bill/subscription claim', () => {
    const r = rowsFor(series('STARBUCKS', 4.33, WEEKLY))
    for (const row of r.rows) expect(row).toMatchObject({ repeatedPattern: true, pattern: { cadence: 'weekly', kind: 'spending_pattern' } })
    expect(viewCounts(r.rows).repeated_spending).toBe(4)
    expect(r.analytics.suggestions.map(s => s.kind)).not.toContain('possible_untracked_subscription')
    expect(r.analytics.suggestions.find(s => s.kind === 'repeated_spending_pattern')!.title).toMatch(/Meals: 1 merchant repeat on a schedule/)
  })
  it('a software/subscription charge on a schedule IS bill-like and may raise a subscription-style signal', () => {
    const r = rowsFor(series('APPLE COM BILL', 19.99, MONTHLY))
    expect(r.rows[0].pattern).toMatchObject({ cadence: 'monthly', kind: 'obligation_like' })
    const sub = r.analytics.suggestions.find(s => s.kind === 'possible_untracked_subscription')!
    expect(sub.title).toMatch(/Possible untracked recurring bill: /)
    expect(SUBSCRIPTION_BUCKETS).toEqual(['software_subscriptions', 'insurance'])
  })
  it('a pattern matched to a known bill (bill-type relationship) is bill-like even outside subscription buckets', () => {
    const bills: KnownBillCandidate[] = [{ type: 'obligation', id: 'o1', label: 'Virtual Mail', expectedDate: '2026-10-03', amountMinor: 2500, estimatedMinMinor: null, estimatedMaxMinor: null, financialAccountId: 'fa-biz' }]
    const r = rowsFor(series('VIRTUAL MAIL', 25, MONTHLY), { bills })
    const matched = r.rows.find(x => x.date === '2026-10-03')!
    expect(matched.relationship).toMatchObject({ kind: 'obligation', state: 'suggested' })
    expect(matched.pattern!.kind).toBe('obligation_like')
    expect(matched.repeatedPattern).toBe(false) // matched to a known bill: it is not "unassigned", so not a repeated-spending item
  })
  it('a merchant that merely repeats irregularly or with unstable amounts is NOT even a pattern (the detector is unchanged)', () => {
    const irregular = rowsFor(series('HARDWARE', 30, ['2026-09-01', '2026-09-04', '2026-09-30', '2026-10-02']))
    expect(irregular.rows.every(r => !r.pattern)).toBe(true)
    const noisy = rowsFor([tx('VARIES', 5, '2026-07-05'), tx('VARIES', 400, '2026-08-04'), tx('VARIES', 9, '2026-09-03')])
    expect(noisy.rows.every(r => !r.pattern)).toBe(true)
  })
  it('the view is "repeated_spending" and nothing in the engine is called "recurring unknown" any more', () => {
    const r = rowsFor(series('STARBUCKS', 4.33, WEEKLY))
    expect(filterRows(r.rows, { view: 'repeated_spending' })).toHaveLength(4)
    expect(JSON.stringify(r)).not.toMatch(/recurringUnknown|recurring_unknown/)
  })
})

describe('BANK-5D unknown does not mean money bleed', () => {
  it('Other / Needs Review stays visible and reviewable but is not discretionary and not in the bleed totals', () => {
    expect(isDiscretionary('other_needs_review')).toBe(false)
    expect(isDiscretionary('some_future_unknown_bucket')).toBe(false)
    const r = rowsFor([tx('ZZQ HOLDINGS', 500, '2026-10-01'), tx('TECTRA', 500, '2026-10-02'), tx('STARBUCKS', 12, '2026-10-03')])
    const a = r.analytics
    expect(a.unassigned.byBucket.find(b => b.key === 'other_needs_review')).toMatchObject({ totalMinor: 100000, count: 2 }) // still visible
    expect(a.unclassified).toEqual({ totalMinor: 100000, count: 2 })
    expect(a.unassigned.totalMinor).toBe(101200) // still part of unassigned spending
    expect(a.moneyBleed).toMatchObject({ currentMinor: 1200, unclassifiedMinor: 100000 }) // only the classified discretionary meal is "bleed"
    expect(a.moneyBleed.topBuckets.map(b => b.key)).toEqual(['meals'])
    expect(viewCounts(r.rows).needs_review).toBe(3)
  })
  it('unknown spending alone produces no growth or waste claim', () => {
    const a = rowsFor([tx('ZZQ', 300, '2026-10-01'), tx('QQZ', 300, '2026-10-02'), tx('XXY', 300, '2026-10-03'), tx('ZZQ', 300, '2026-09-01')]).analytics
    expect(a.suggestions.some(s => s.kind === 'growing_category')).toBe(false)
    expect(a.moneyBleed.currentMinor).toBe(0)
  })
})

describe('BANK-5D duplicate-looking signals cannot explode', () => {
  const sandboxFive00 = () => ['UNITED AIRLINES', 'TECTRA INC', 'MADISON BICYCLE CENTER', 'KFC', 'FUN', 'TOUCHSTONE CLIMBING']
    .flatMap(name => series(name, 500, ['2026-08-05', '2026-09-04', '2026-10-04']))
  it('many merchants sharing an artificial $500 amount do not generate pairwise duplicate warnings', () => {
    const a = rowsFor(sandboxFive00()).analytics
    expect(a.suggestions.filter(s => s.kind === 'duplicate_looking_recurring')).toEqual([])
    expect(a.suggestions.filter(s => s.kind === 'possible_untracked_subscription')).toEqual([]) // none of these has subscription context
    expect(a.suggestions.length).toBeLessThanOrEqual(3) // one summary per bucket, not one per merchant or pair
  })
  it('similar amount alone is never evidence; similar NAMES in the same bill-like bucket and cadence collapse into ONE signal', () => {
    const t = [...series('ADOBE CREATIVE', 54.99, MONTHLY), ...series('ADOBE ACROBAT', 19.99, MONTHLY), ...series('ADOBE STOCK', 29.99, MONTHLY), ...series('ZOOM VIDEO', 54.99, MONTHLY)]
    const dups = rowsFor(t).analytics.suggestions.filter(s => s.kind === 'duplicate_looking_recurring')
    expect(dups).toHaveLength(1)
    expect(dups[0].title).toBe('3 similarly named recurring charges')
    expect(dups[0].txIds.length).toBeGreaterThan(0)
  })
  it('signal output is deterministic regardless of input order', () => {
    const t = sandboxFive00()
    expect(JSON.stringify(rowsFor(t).analytics.suggestions)).toBe(JSON.stringify(rowsFor([...t].reverse()).analytics.suggestions))
  })
})

describe('BANK-5D evidence and inputs are never modified by analysis', () => {
  it('building the explorer does not mutate its inputs (deep-frozen evidence, accounts and decisions)', () => {
    const deepFreeze = <T,>(o: T): T => { if (o && typeof o === 'object') { Object.values(o as object).forEach(deepFreeze); Object.freeze(o) } return o }
    const txs = deepFreeze([...series('STARBUCKS', 4.33, WEEKLY), tx('ZZQ', 40, '2026-10-02', { providerAccountRef: UNMAPPED })])
    const accounts = deepFreeze(ACCOUNTS.map(a => ({ ...a })))
    expect(() => buildRows({ asOf: AS_OF, accountScope: 'mapped', txs, accounts, decisions: deepFreeze([]), bills: deepFreeze([]), obligationLabels: new Map(), commitmentLabels: new Map(), debts: [], projects: [] })).not.toThrow()
  })
})
