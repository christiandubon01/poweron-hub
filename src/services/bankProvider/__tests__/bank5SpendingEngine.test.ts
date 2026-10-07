import { describe, expect, it } from 'vitest'
import { classifyAll, buildMerchantHistory } from '../spending/classifier'
import { buildRows, filterRows, viewCounts } from '../spending/explorer'
import { analyze, detectRecurring, addDays } from '../spending/analytics'
import { buildBillCandidates, explorerFromContext, parseQuery, type SpendingContext } from '../spending/spendingService'
import { merchantKey, normalizeText } from '../spending/merchant'
import type { AccountContext, Decision, DebtOption, EvidenceTx, KnownBillCandidate, ProjectOption } from '../spending/types'

const AS_OF = '2026-10-07'
let seq = 0
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
const ACC_BIZ = '10000000-0000-4000-8000-0000000000a1'
const ACC_PERSONAL = '10000000-0000-4000-8000-0000000000a2'
const accounts = new Map<string, AccountContext>([
  [ACC_BIZ, { providerAccountRef: ACC_BIZ, label: 'Tartan · Plaid Checking', mask: '0000', ownership: 'business', financialAccountId: 'fa-biz', financialAccountName: 'Wells Fargo Business Checking 6960' }],
  [ACC_PERSONAL, { providerAccountRef: ACC_PERSONAL, label: 'Tartan · Plaid Savings', mask: '1111', ownership: 'personal', financialAccountId: 'fa-personal', financialAccountName: 'Personal Savings' }],
])
const tx = (name: string, dollars: number, date: string, over: Partial<EvidenceTx> = {}): EvidenceTx => ({
  id: id(), providerAccountRef: ACC_BIZ, date, name, merchantName: null, amountMinor: Math.round(dollars * 100), pending: false, removed: false, category: null, ...over,
})
const decision = (txId: string, over: Partial<Decision>): Decision => ({
  id: id(), txId, kind: 'category', status: 'confirmed', category: null, projectId: null, obligationId: null, commitmentId: null, debtAccountId: null, counterpartTxId: null,
  confidence: 'high', source: 'owner', decidedAt: '2026-10-01T00:00:00Z', ...over,
})
const run = (txs: EvidenceTx[], over: Partial<{ decisions: Decision[]; bills: KnownBillCandidate[]; debts: DebtOption[]; projects: ProjectOption[] }> = {}) =>
  classifyAll({ txs, accounts, decisions: over.decisions ?? [], bills: over.bills ?? [], debts: over.debts ?? [], projects: over.projects ?? [] })
const rowsFor = (txs: EvidenceTx[], over: Partial<{ decisions: Decision[]; bills: KnownBillCandidate[]; debts: DebtOption[]; projects: ProjectOption[] }> = {}) =>
  buildRows({ asOf: AS_OF, txs, accounts: [...accounts.values()], decisions: over.decisions ?? [], bills: over.bills ?? [], obligationLabels: new Map(), commitmentLabels: new Map(), debts: over.debts ?? [], projects: over.projects ?? [] })

describe('merchant normalization', () => {
  it('drops store numbers, prefixes and punctuation; groups the same merchant; never invents a project', () => {
    expect(normalizeText('SQ *BLUE BOTTLE #1234')).toBe('BLUE BOTTLE')
    expect(merchantKey('THE HOME DEPOT #0603', null)).toBe(merchantKey('HOME DEPOT 4417', null))
    expect(merchantKey('whatever', 'Uber')).toBe('UBER')
    expect(merchantKey(null, null)).toBe('UNKNOWN MERCHANT')
  })
})

describe('BANK-5 bucket suggestions (economic bucket)', () => {
  it('curated merchants and provider categories produce explainable suggestions with a confidence and reasons', () => {
    const chevron = tx('CHEVRON 0098', 62.1, '2026-10-01'), depot = tx('THE HOME DEPOT #6', 286.42, '2026-10-02')
    const fee = tx('MONTHLY SERVICE FEE', 15, '2026-10-03'), plain = tx('ZZQ HOLDINGS', 40, '2026-10-03')
    const pfc = tx('Lunch', 12, '2026-10-04', { category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT', confidence: 'VERY_HIGH' } })
    const s = run([chevron, depot, fee, plain, pfc])
    expect(s.get(chevron.id)!.bucket).toMatchObject({ bucket: 'fuel_vehicle', confidence: 'high', basis: 'merchant_rule' })
    expect(s.get(depot.id)!.bucket).toMatchObject({ bucket: 'materials', confidence: 'high' })
    expect(s.get(fee.id)!.bucket).toMatchObject({ bucket: 'bank_finance_fees', confidence: 'high', basis: 'fee_rule' })
    expect(s.get(pfc.id)!.bucket).toMatchObject({ bucket: 'meals', confidence: 'possible', basis: 'provider_category' })
    expect(s.get(plain.id)!.bucket).toBeNull() // unknown stays unknown: nothing is invented
    for (const t of [chevron, depot, fee, pfc]) expect(s.get(t.id)!.bucket!.reasons.length).toBeGreaterThan(0)
  })
  it('inflows get no spending bucket', () => {
    const dep = tx('CD DEPOSIT', -1000, '2026-10-01')
    expect(run([dep]).get(dep.id)!.bucket).toBeNull()
  })
  it('removed evidence is never classified', () => {
    const gone = tx('CHEVRON', 10, '2026-10-01', { removed: true })
    expect(run([gone]).has(gone.id)).toBe(false)
  })
})

describe('BANK-5 merchant learning (suggests a BUCKET only)', () => {
  const past = [tx('CHEVRON 0001', 50, '2026-09-01'), tx('CHEVRON 0002', 55, '2026-09-08')]
  it('repeated owner confirmations make a high-confidence bucket suggestion that is never auto-confirmed', () => {
    const decisions = past.map(p => decision(p.id, { category: 'fuel_vehicle' }))
    const next = tx('CHEVRON 0003', 60, '2026-10-01')
    const s = run([...past, next], { decisions }).get(next.id)!
    expect(s.bucket).toMatchObject({ bucket: 'fuel_vehicle', confidence: 'high', basis: 'owner_history' })
    expect(s.bucket!.reasons[0]).toMatch(/You confirmed 2 earlier/)
    const row = rowsFor([...past, next], { decisions }).rows.find(r => r.id === next.id)!
    expect(row.bucket.state).toBe('suggested') // a suggestion, not a decision
    expect(row.review).toBe('suggested')
  })
  it('a single confirmation is only "possible"; mixed history is not trusted; owner history beats the curated rule', () => {
    const one = tx('ZZQ HOLDINGS', 40, '2026-09-01'), next = tx('ZZQ HOLDINGS', 41, '2026-10-01')
    expect(run([one, next], { decisions: [decision(one.id, { category: 'meals' })] }).get(next.id)!.bucket).toMatchObject({ bucket: 'meals', confidence: 'possible' })
    const a = tx('ZZQ HOLDINGS', 40, '2026-08-01'), b = tx('ZZQ HOLDINGS', 40, '2026-08-08'), c = tx('ZZQ HOLDINGS', 40, '2026-09-01'), d = tx('ZZQ HOLDINGS', 42, '2026-10-01')
    expect(run([a, b, c, d], { decisions: [decision(a.id, { category: 'meals' }), decision(b.id, { category: 'materials' }), decision(c.id, { category: 'office_admin' })] }).get(d.id)!.bucket).toBeNull()
    const own = tx('CHEVRON', 30, '2026-09-01'), nx = tx('CHEVRON', 31, '2026-10-01')
    expect(run([own, nx], { decisions: [decision(own.id, { category: 'personal_owner' })] }).get(nx.id)!.bucket).toMatchObject({ bucket: 'personal_owner', basis: 'owner_history' })
  })
  it('merchant history NEVER assigns a project, even when every earlier purchase belonged to one', () => {
    const hd = [tx('HOME DEPOT 1', 100, '2026-09-01'), tx('HOME DEPOT 2', 120, '2026-09-05'), tx('HOME DEPOT 3', 90, '2026-09-09')]
    const decisions = hd.flatMap(t => [decision(t.id, { category: 'materials' }), decision(t.id, { kind: 'project', projectId: 'proj-desert-willow' })])
    const next = tx('HOME DEPOT 4', 286.42, '2026-10-01')
    const s = run([...hd, next], { decisions, projects: [{ id: 'proj-desert-willow', name: 'Desert Willow Remodel' }] }).get(next.id)!
    expect(s.bucket).toMatchObject({ bucket: 'materials' })
    expect(s.relationship).toBeNull()
    expect(buildMerchantHistory([...hd, next], decisions).get(merchantKey('HOME DEPOT 4', null))!.get('materials')).toBe(3)
  })
  it('a rejected suggestion is not repeated for that transaction', () => {
    const t = tx('CHEVRON', 30, '2026-10-01')
    expect(run([t], { decisions: [decision(t.id, { status: 'rejected', category: 'fuel_vehicle' })] }).get(t.id)!.bucket).toBeNull()
  })
})

describe('BANK-5 relationship: projects are explicit, never inferred from a merchant', () => {
  const projects = [{ id: 'proj-1', name: 'Desert Willow Remodel' }, { id: 'proj-2', name: 'Palm Ave Panel' }]
  it('a project is suggested only when the transaction text names it, and only as "possible"', () => {
    const named = tx('HOME DEPOT DESERT WILLOW REMODEL', 100, '2026-10-01'), plain = tx('HOME DEPOT', 100, '2026-10-01')
    const s = run([named, plain], { projects })
    expect(s.get(named.id)!.relationship).toMatchObject({ kind: 'project', confidence: 'possible', target: { type: 'project', id: 'proj-1' } })
    expect(s.get(plain.id)!.relationship).toBeNull()
  })
  it('two projects named in one description, or a too-short name, never produce a guess', () => {
    const both = tx('DESERT WILLOW REMODEL PALM AVE PANEL', 100, '2026-10-01')
    expect(run([both], { projects }).get(both.id)!.relationship).toBeNull()
    const short = tx('ACE HARDWARE', 10, '2026-10-01')
    expect(run([short], { projects: [{ id: 'p', name: 'Ace' }] }).get(short.id)!.relationship).toBeNull()
  })
})

describe('BANK-5 known-money matching (before anything is called unassigned)', () => {
  const bill = (over: Partial<KnownBillCandidate> = {}): KnownBillCandidate => ({ type: 'obligation', id: 'obl-qb', label: 'QuickBooks Online', expectedDate: '2026-10-05', amountMinor: 3800, estimatedMinMinor: null, estimatedMaxMinor: null, financialAccountId: 'fa-biz', ...over })
  it('a recurring bill is matched with explainable reasons (name + amount + date + account => high)', () => {
    const t = tx('INTUIT *QUICKBOOKS ONLINE', 38, '2026-10-05')
    const r = run([t], { bills: [bill()] }).get(t.id)!.relationship!
    expect(r).toMatchObject({ kind: 'obligation', confidence: 'high', target: { type: 'obligation', id: 'obl-qb', label: 'QuickBooks Online' } })
    expect(r.reasons.join(' ')).toMatch(/matches the bill name/); expect(r.reasons.join(' ')).toMatch(/matches the expected \$38\.00/)
  })
  it('the bucket and the relationship are independent: QuickBooks is Software AND a known bill, and is NOT counted as unassigned spending', () => {
    const t = tx('INTUIT *QUICKBOOKS ONLINE', 38, '2026-10-05')
    const { rows, analytics } = rowsFor([t], { bills: [bill()] })
    expect(rows[0].bucket).toMatchObject({ key: 'software_subscriptions', state: 'suggested' })
    expect(rows[0].relationship).toMatchObject({ kind: 'obligation', state: 'suggested', confidence: 'high' })
    expect(rows[0].unassigned).toBe(false)
    expect(analytics.unassigned.totalMinor).toBe(0)
    expect(analytics.knownBills).toMatchObject({ count: 1, suggestedCount: 1 })
  })
  it('amount alone is not enough: wrong amount, wrong date, or unrelated name give no high-confidence match', () => {
    const wrongAmt = tx('QUICKBOOKS ONLINE', 90, '2026-10-05'), wrongDate = tx('QUICKBOOKS ONLINE', 38, '2026-09-10'), other = tx('RANDOM VENDOR', 38, '2026-10-05')
    const s = run([wrongAmt, wrongDate, other], { bills: [bill()] })
    expect(s.get(wrongAmt.id)!.relationship).toBeNull(); expect(s.get(wrongDate.id)!.relationship).toBeNull()
    expect(s.get(other.id)!.relationship?.confidence).not.toBe('high')
  })
  it('a different payment account lowers the match; an estimated bill accepts an amount inside its range', () => {
    const t = tx('QUICKBOOKS ONLINE', 38, '2026-10-05', { providerAccountRef: ACC_PERSONAL })
    expect(run([t], { bills: [bill()] }).get(t.id)!.relationship!.confidence).toBe('possible')
    const est = tx('PG AND E', 212.4, '2026-10-06')
    expect(run([est], { bills: [bill({ id: 'obl-pge', label: 'PG&E Electric', amountMinor: 20000, estimatedMinMinor: 15000, estimatedMaxMinor: 25000, expectedDate: '2026-10-04' })] }).get(est.id)!.relationship).toMatchObject({ kind: 'obligation', target: { id: 'obl-pge' } })
  })
  it('one bill occurrence is claimed by one transaction only, and two equally good bills produce no guess', () => {
    const a = tx('QUICKBOOKS ONLINE', 38, '2026-10-05'), b = tx('QUICKBOOKS ONLINE', 38, '2026-10-06')
    const s = run([a, b], { bills: [bill()] })
    expect([s.get(a.id)!.relationship, s.get(b.id)!.relationship].filter(Boolean)).toHaveLength(1)
    const t = tx('MONTHLY SOFTWARE', 50, '2026-10-05')
    const twin = (i: string): KnownBillCandidate => bill({ id: i, label: 'Monthly Software', amountMinor: 5000, financialAccountId: null })
    expect(run([t], { bills: [twin('o1'), twin('o2')] }).get(t.id)!.relationship).toBeNull()
  })
  it('commitments match like bills and are labelled as such; debts and payroll are recognised before "unassigned"', () => {
    const c = tx('ELECTRIC SERVICE DEPOSIT', 500, '2026-10-02')
    expect(run([c], { bills: [bill({ type: 'commitment', id: 'com-1', label: 'Electric Service Deposit', amountMinor: 50000, expectedDate: '2026-10-02' })] }).get(c.id)!.relationship).toMatchObject({ kind: 'obligation', target: { type: 'commitment', id: 'com-1' } })
    const pay = tx('GUSTO PAYROLL 4412', 4200, '2026-10-03'), card = tx('CHASE CARD AUTOPAY', 350, '2026-10-03')
    const s = run([pay, card], { debts: [{ id: 'debt-chase', label: 'Chase Ink Card', accountType: 'credit_card' }] })
    expect(s.get(pay.id)!.relationship).toMatchObject({ kind: 'payroll', confidence: 'high' }); expect(s.get(pay.id)!.bucket).toMatchObject({ bucket: 'payroll_people' })
    expect(s.get(card.id)!.relationship).toMatchObject({ kind: 'debt', target: { id: 'debt-chase' } })
  })
})

describe('BANK-5 transfers (suggested, never canonicalized)', () => {
  it('equal opposite movements in different accounts within 3 days are suggested as a pair, on both sides', () => {
    const out = tx('ONLINE TRANSFER TO SAVINGS', 1000, '2026-10-01'), inn = tx('ONLINE TRANSFER FROM CHECKING', -1000, '2026-10-02', { providerAccountRef: ACC_PERSONAL })
    const s = run([out, inn])
    expect(s.get(out.id)!.relationship).toMatchObject({ kind: 'transfer', confidence: 'high', target: { type: 'counterpart_tx', id: inn.id } })
    expect(s.get(inn.id)!.relationship).toMatchObject({ kind: 'transfer', target: { id: out.id } })
    expect(s.get(out.id)!.bucket).toMatchObject({ bucket: 'transfers' })
  })
  it('same account, different amount, or too far apart is not a pair; a lone "transfer" is only possible', () => {
    const o = tx('XFER', 500, '2026-10-01'), same = tx('XFER BACK', -500, '2026-10-02'), far = tx('X', -500, '2026-10-20', { providerAccountRef: ACC_PERSONAL })
    const s = run([o, same, far])
    expect(s.get(o.id)!.relationship!.target.id).toBeNull(); expect(s.get(o.id)!.relationship!.confidence).toBe('possible')
  })
  it('a suggested transfer is NOT operating spending and NOT income: it never enters unassigned spending or the leak total', () => {
    const out = tx('ONLINE TRANSFER', 1000, '2026-10-01'), inn = tx('ONLINE TRANSFER', -1000, '2026-10-01', { providerAccountRef: ACC_PERSONAL })
    const { rows, analytics } = rowsFor([out, inn])
    expect(rows.every(r => !r.unassigned)).toBe(true)
    expect(analytics.unassigned.totalMinor).toBe(0); expect(analytics.transfers.totalMinor).toBe(100000)
  })
})

describe('BANK-5 explorer rows: three independent dimensions + review state', () => {
  it('Home Depot x2: one confirmed to a project, one needs review. Nothing is inferred between them', () => {
    const a = tx('HOME DEPOT 1', 286.42, '2026-10-01'), b = tx('HOME DEPOT 2', 120, '2026-10-02')
    const decisions = [decision(a.id, { category: 'materials' }), decision(a.id, { kind: 'project', projectId: 'proj-1' })]
    const { rows } = rowsFor([a, b], { decisions, projects: [{ id: 'proj-1', name: 'Desert Willow Remodel' }] })
    const ra = rows.find(r => r.id === a.id)!, rb = rows.find(r => r.id === b.id)!
    expect(ra).toMatchObject({ review: 'confirmed', bucket: { key: 'materials', state: 'confirmed' }, relationship: { kind: 'project', state: 'confirmed', target: { label: 'Desert Willow Remodel' } }, unassigned: false })
    expect(rb.relationship).toMatchObject({ kind: 'unknown', state: 'none' }); expect(rb.unassigned).toBe(true)
    expect(rb.bucket.key).toBe('materials') // same bucket suggestion, independently unassigned
  })
  it('review state: ignored, confirmed, suggested, needs_review are derived from decisions and suggestion strength', () => {
    const ig = tx('CHEVRON', 30, '2026-10-01'), ok = tx('CHEVRON', 31, '2026-10-01'), sug = tx('CHEVRON', 32, '2026-10-01'), nr = tx('ZZQ HOLDINGS', 40, '2026-10-01')
    const { rows } = rowsFor([ig, ok, sug, nr], { decisions: [decision(ig.id, { kind: 'ignored' }), decision(ok.id, { category: 'fuel_vehicle' })] })
    const by = (t: EvidenceTx) => rows.find(r => r.id === t.id)!.review
    expect([by(ig), by(ok), by(sug), by(nr)]).toEqual(['ignored', 'confirmed', 'suggested', 'needs_review'])
  })
  it('confidence is separate from review state (a confirmed row keeps its own confidence; a suggested row exposes its)', () => {
    const t = tx('CHEVRON', 30, '2026-10-01')
    const { rows } = rowsFor([t])
    expect(rows[0].review).toBe('suggested'); expect(rows[0].bucket.confidence).toBe('high')
  })
  it('pending evidence is shown and analysed cautiously: never unassigned spending, and never in the totals', () => {
    const p = tx('CHEVRON', 30, '2026-10-06', { pending: true }), posted = tx('CHEVRON', 20, '2026-10-05')
    const { rows, analytics } = rowsFor([p, posted])
    expect(rows.find(r => r.id === p.id)).toMatchObject({ pending: true, unassigned: false })
    expect(analytics.unassigned.totalMinor).toBe(2000); expect(analytics.pending).toMatchObject({ count: 1, totalMinor: 3000 })
  })
  it('ignored evidence is out of every total, view and leak signal, but still listed under All', () => {
    const t = tx('CHEVRON', 30, '2026-10-01')
    const { rows, analytics } = rowsFor([t], { decisions: [decision(t.id, { kind: 'ignored' })] })
    expect(analytics.unassigned.totalMinor).toBe(0); expect(viewCounts(rows)).toMatchObject({ all: 1, unassigned: 0, needs_review: 0 })
  })
  it('business/personal keeps account context but never assumes; the owner can correct either way', () => {
    const onBiz = tx('NETFLIX', 15, '2026-10-01'), onPersonal = tx('LUMBER YARD', 80, '2026-10-01', { providerAccountRef: ACC_PERSONAL })
    const base = rowsFor([onBiz, onPersonal]).rows
    expect(base.find(r => r.id === onBiz.id)!.scope).toEqual({ value: 'business', source: 'account' })
    expect(base.find(r => r.id === onPersonal.id)!.scope).toEqual({ value: 'personal', source: 'account' })
    const fixed = rowsFor([onBiz, onPersonal], { decisions: [decision(onBiz.id, { kind: 'personal' }), decision(onPersonal.id, { kind: 'overhead' })] }).rows
    expect(fixed.find(r => r.id === onBiz.id)!.scope).toEqual({ value: 'personal', source: 'owner' })
    expect(fixed.find(r => r.id === onPersonal.id)!.scope).toEqual({ value: 'business', source: 'owner' })
    expect(fixed.every(r => !r.unassigned)).toBe(true) // the owner reviewed them
  })
  it('unmapped account evidence is still analysed, with the account context left unclear', () => {
    const orphan = tx('CHEVRON', 30, '2026-10-01', { providerAccountRef: '10000000-0000-4000-8000-0000000000ff' })
    expect(rowsFor([orphan]).rows[0].scope).toEqual({ value: 'unclear', source: 'none' })
  })
})

describe('BANK-5 views and filters', () => {
  const set = () => {
    const bill = tx('QUICKBOOKS ONLINE', 38, '2026-10-05'), fuel = tx('CHEVRON', 60, '2026-10-04'), mystery = tx('ZZQ HOLDINGS', 40, '2026-10-03'), deposit = tx('CD DEPOSIT', -900, '2026-10-02')
    const bills: KnownBillCandidate[] = [{ type: 'obligation', id: 'o1', label: 'QuickBooks Online', expectedDate: '2026-10-05', amountMinor: 3800, estimatedMinMinor: null, estimatedMaxMinor: null, financialAccountId: 'fa-biz' }]
    return { all: rowsFor([bill, fuel, mystery, deposit], { bills }).rows, bill, fuel, mystery, deposit }
  }
  it('Known Bills / Unassigned / Needs Review views are exact', () => {
    const s = set(), ids = (q: Parameters<typeof filterRows>[1]) => filterRows(s.all, q).map(r => r.id).sort()
    expect(ids({ view: 'known_bills' })).toEqual([s.bill.id])
    expect(ids({ view: 'unassigned' })).toEqual([s.fuel.id, s.mystery.id].sort())
    expect(ids({ view: 'needs_review' }).sort()).toEqual([s.bill.id, s.fuel.id, s.mystery.id].sort())
    expect(viewCounts(s.all)).toMatchObject({ all: 4, known_bills: 1, unassigned: 2 })
  })
  it('bucket, search, amount, account, scope, review, date filters compose', () => {
    const s = set()
    expect(filterRows(s.all, { bucket: 'fuel_vehicle' }).map(r => r.id)).toEqual([s.fuel.id])
    expect(filterRows(s.all, { search: 'chev' }).map(r => r.id)).toEqual([s.fuel.id])
    expect(filterRows(s.all, { minMinor: 5000 }).map(r => r.id).sort()).toEqual([s.fuel.id, s.deposit.id].sort())
    expect(filterRows(s.all, { account: ACC_PERSONAL })).toHaveLength(0)
    expect(filterRows(s.all, { from: '2026-10-04', to: '2026-10-05' }).map(r => r.id).sort()).toEqual([s.bill.id, s.fuel.id].sort())
    expect(filterRows(s.all, { review: 'needs_review', scope: 'business' }).map(r => r.id).sort()).toEqual([s.mystery.id, s.deposit.id].sort()) // a plain deposit has nothing suggested, but the Needs Review VIEW is outflows only
  })
  it('query parsing drops anything it does not recognise', () => {
    expect(parseQuery({ view: 'nope', bucket: 'nope', from: 'x', account: 'x', limit: 99999, offset: -5, minMinor: -3 })).toEqual({ limit: 200, offset: 0 })
    expect(parseQuery({ view: 'unassigned', bucket: 'meals', from: '2026-01-01', limit: 20, includePending: 'false' })).toMatchObject({ view: 'unassigned', bucket: 'meals', from: '2026-01-01', limit: 20, includePending: false })
  })
})

describe('BANK-5 determinism, ordering and idempotent regeneration', () => {
  it('the same evidence always produces the same suggestions, whatever the input order', () => {
    const txs = [tx('CHEVRON', 60, '2026-10-04'), tx('QUICKBOOKS ONLINE', 38, '2026-10-05'), tx('ONLINE TRANSFER', 500, '2026-10-01'), tx('ONLINE TRANSFER', -500, '2026-10-01', { providerAccountRef: ACC_PERSONAL }), tx('ZZQ', 12, '2026-10-02')]
    const bills: KnownBillCandidate[] = [{ type: 'obligation', id: 'o1', label: 'QuickBooks Online', expectedDate: '2026-10-05', amountMinor: 3800, estimatedMinMinor: null, estimatedMaxMinor: null, financialAccountId: null }]
    const a = JSON.stringify([...run(txs, { bills })].sort(([x], [y]) => x.localeCompare(y)))
    const b = JSON.stringify([...run([...txs].reverse(), { bills })].sort(([x], [y]) => x.localeCompare(y)))
    expect(a).toBe(b); expect(JSON.stringify(rowsFor(txs, { bills }).rows)).toBe(JSON.stringify(rowsFor([...txs].reverse(), { bills }).rows))
  })
})

describe('BANK-5 recurring detection', () => {
  const series = (name: string, dollars: number, dates: string[]) => dates.map(d => tx(name, dollars, d))
  const detect = (txs: EvidenceTx[]) => detectRecurring(rowsFor(txs).rows)
  it('monthly, weekly and biweekly patterns with stable amounts are recognised; irregular spending is not', () => {
    const monthly = detect(series('APPLE COM BILL', 19.99, ['2026-07-05', '2026-08-04', '2026-09-03', '2026-10-03']))
    expect(monthly.get(merchantKey('APPLE COM BILL', null))).toMatchObject({ cadence: 'monthly', occurrences: 4, confidence: 'high', typicalAmountMinor: 1999 })
    expect(detect(series('COFFEE CART', 6, ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'])).get(merchantKey('COFFEE CART', null))).toMatchObject({ cadence: 'weekly' })
    expect(detect(series('GYM', 30, ['2026-09-01', '2026-09-15', '2026-09-29'])).get('GYM')).toMatchObject({ cadence: 'biweekly' })
    expect(detect(series('HARDWARE', 30, ['2026-09-01', '2026-09-04', '2026-09-30', '2026-10-02'])).size).toBe(0)
    expect(detect(series('SHOP', 10, ['2026-09-01'])).size).toBe(0)
  })
  it('two equal monthly charges are only "possible"; wildly different amounts are not recurring', () => {
    expect(detect(series('SAAS TOOL', 49, ['2026-08-30', '2026-09-29'])).get('SAAS TOOL')).toMatchObject({ confidence: 'possible' })
    const noisy = [tx('VARIES', 5, '2026-07-05'), tx('VARIES', 400, '2026-08-04'), tx('VARIES', 9, '2026-09-03')]
    expect(detect(noisy).size).toBe(0)
  })
  it('pending and money-in rows are not part of a pattern', () => {
    const t = [...series('APPLE COM BILL', 19.99, ['2026-08-04', '2026-09-03']), tx('APPLE COM BILL', 19.99, '2026-10-03', { pending: true })]
    expect(detect(t).get(merchantKey('APPLE COM BILL', null))).toMatchObject({ occurrences: 2, confidence: 'possible' })
  })
})

describe('BANK-5 money-bleed analytics', () => {
  /** Current window 2026-09-08..2026-10-07, previous window 2026-08-09..2026-09-07. */
  const data = () => {
    const txs = [
      // software this month: 3 merchants, one recurring unassigned (APPLE)
      tx('APPLE COM BILL', 19.99, '2026-08-04'), tx('APPLE COM BILL', 19.99, '2026-09-03'), tx('APPLE COM BILL', 19.99, '2026-10-03'),
      tx('ADOBE CREATIVE', 54.99, '2026-09-20'), tx('ZOOM VIDEO', 15.99, '2026-09-22'),
      // previous period software
      tx('DROPBOX', 11.99, '2026-08-20'),
      // materials, not assigned to any project
      tx('HOME DEPOT 1', 286.42, '2026-09-12'), tx('HOME DEPOT 2', 120, '2026-09-25'), tx('GRAYBAR ELECTRIC', 217.58, '2026-10-02'),
      // fees
      tx('MONTHLY SERVICE FEE', 15, '2026-09-30'), tx('OVERDRAFT FEE', 34, '2026-10-01'),
      // meals repeated
      tx('STARBUCKS 1', 6.5, '2026-09-10'), tx('STARBUCKS 2', 7, '2026-09-18'), tx('STARBUCKS 3', 9.1, '2026-09-29'),
      // pending + inflow + known + personal + transfers must not pollute the leak total
      tx('CHEVRON', 70, '2026-10-06', { pending: true }), tx('CD DEPOSIT', -2000, '2026-09-15'),
      tx('QUICKBOOKS ONLINE', 38, '2026-10-05'),
    ]
    const bills: KnownBillCandidate[] = [{ type: 'obligation', id: 'o1', label: 'QuickBooks Online', expectedDate: '2026-10-05', amountMinor: 3800, estimatedMinMinor: null, estimatedMaxMinor: null, financialAccountId: 'fa-biz' }]
    return rowsFor(txs, { bills })
  }
  it('aggregates unassigned spending by bucket for the current window, with previous-period comparison', () => {
    const { analytics: a } = data()
    const sw = a.unassigned.byBucket.find(b => b.key === 'software_subscriptions')!
    expect(sw).toMatchObject({ totalMinor: 1999 + 5499 + 1599, count: 3, previousMinor: 1999 + 1199, merchants: 3, recurringMerchants: 1 })
    expect(sw.deltaMinor).toBe(sw.totalMinor - sw.previousMinor)
    expect(a.unassigned.byBucket.find(b => b.key === 'materials')).toMatchObject({ totalMinor: 28642 + 12000 + 21758, count: 3 })
    expect(a.unassigned.totalMinor).toBe(a.unassigned.byBucket.reduce((n, b) => n + b.totalMinor, 0))
    expect(a.unassigned.deltaMinor).toBe(a.unassigned.totalMinor - a.unassigned.previousMinor)
  })
  it('keeps known bills, pending, transfers and inflows OUT of the leak total', () => {
    const { analytics: a } = data()
    expect(a.knownBills).toMatchObject({ count: 1, totalMinor: 3800 })
    expect(a.pending).toMatchObject({ count: 1, totalMinor: 7000 })
    expect(a.unassigned.byBucket.find(b => b.key === 'fuel_vehicle')).toBeUndefined() // the only fuel purchase is pending
    const names = a.observations.map(o => o.text).join(' | ')
    expect(names).not.toMatch(/QuickBooks|Chevron/i)
  })
  it('deterministic observations are separate from heuristic suggestions, and both carry their evidence', () => {
    const { analytics: a } = data()
    expect(a.observations.every(o => o.basis === 'deterministic')).toBe(true); expect(a.suggestions.every(s => s.basis === 'heuristic')).toBe(true)
    const sw = a.observations.find(o => o.id === 'bucket:software_subscriptions')!
    expect(sw.text).toMatch(/Software \/ Subscriptions \$91 in 30 days · 3 merchants · 1 appear recurring · \+\$59 vs previous 30 days/)
    expect(sw.txIds.length).toBe(3)
    for (const s of a.suggestions) expect(s.txIds.length).toBeGreaterThan(0)
  })
  it('flags possible untracked recurring expenses, unassigned project-like materials, fees, growth and repeated merchants', () => {
    const kinds = new Map(data().analytics.suggestions.map(s => [s.kind, s]))
    expect(kinds.get('possible_untracked_subscription')!.title).toMatch(/APPLE|Apple/i)
    expect(kinds.get('project_like_materials_unassigned')).toMatchObject({ amountMinor: 62400 }); expect(kinds.get('project_like_materials_unassigned')!.title).toMatch(/\$624 of material purchases are not assigned to a project/)
    expect(kinds.get('bank_finance_fees')).toMatchObject({ amountMinor: 4900 })
    expect(kinds.get('repeated_unassigned_merchant')!.title).toMatch(/STARBUCKS|Starbucks/i)
    expect(kinds.get('growing_category')).toBeTruthy()
  })
  it('a large purchase alone is never called wasteful: no flag without a signal (growth needs a pattern, not one big purchase)', () => {
    const { analytics: a } = rowsFor([tx('LUMBER MILL', 5000, '2026-10-01')])
    expect(a.suggestions).toEqual([])
    expect(a.unassigned.totalMinor).toBe(500000)
  })
  it('owner confirming a relationship removes that money from the leak, even for the same merchant', () => {
    const t = tx('HOME DEPOT 1', 286.42, '2026-10-01'), u = tx('HOME DEPOT 2', 100, '2026-10-02')
    const { analytics: a } = rowsFor([t, u], { decisions: [decision(t.id, { kind: 'project', projectId: 'p1' })], projects: [{ id: 'p1', name: 'Desert Willow Remodel' }] })
    expect(a.unassigned.totalMinor).toBe(10000)
  })
  it('exposes an Outlook-ready summary (discretionary/untracked, previous, delta, top buckets) that nothing consumes yet', () => {
    const { analytics: a } = data()
    expect(a.moneyBleed).toMatchObject({ windowDays: 30 })
    expect(a.moneyBleed.currentMinor).toBe(a.moneyBleed.topBuckets.length ? a.unassigned.byBucket.filter(b => ['software_subscriptions', 'bank_finance_fees', 'meals', 'other_needs_review', 'marketing', 'office_admin', 'tools_equipment'].includes(b.key)).reduce((n, b) => n + b.totalMinor, 0) : 0)
    expect(a.moneyBleed.topBuckets.map(b => b.key)).not.toContain('materials')
    expect(a.moneyBleed.deltaMinor).toBe(a.moneyBleed.currentMinor - a.moneyBleed.previousMinor)
  })
  it('window helpers are calendar-exact', () => { expect(addDays('2026-10-07', -29)).toBe('2026-09-08'); expect(addDays('2026-03-01', -1)).toBe('2026-02-28') })
})

describe('BANK-5 known-bill candidates come from existing Cash OS rows without materializing anything', () => {
  const ctx = (over: Partial<SpendingContext> = {}): SpendingContext => ({
    txs: [tx('x', 1, '2026-10-05')], accounts: [], decisions: [], debts: [], projects: [], occurrences: [], commitments: [],
    obligations: [{ id: 'o1', name: 'QuickBooks Online', amountMinor: 3800, amountType: 'fixed', estimatedMinMinor: null, estimatedMaxMinor: null, recurrenceKind: 'monthly', recurrenceInterval: 1, anchorDate: '2026-01-05', startDate: '2026-01-01', endDate: null, status: 'active', accountId: 'fa-biz' }], ...over,
  })
  it('expands a monthly rule to dated candidates, skips satisfied/skipped occurrences, honors overrides, and includes scheduled commitments', () => {
    expect(buildBillCandidates(ctx(), '2026-09-20', '2026-10-20').map(b => b.expectedDate)).toEqual(['2026-10-05'])
    expect(buildBillCandidates(ctx({ occurrences: [{ obligationId: 'o1', scheduledDate: '2026-10-05', overrideDate: null, overrideAmountMinor: null, status: 'satisfied', reconciliationState: 'reconciled' }] }), '2026-09-20', '2026-10-20')).toEqual([])
    expect(buildBillCandidates(ctx({ occurrences: [{ obligationId: 'o1', scheduledDate: '2026-10-05', overrideDate: '2026-10-08', overrideAmountMinor: 4100, status: 'scheduled', reconciliationState: 'unreconciled' }] }), '2026-09-20', '2026-10-20')[0]).toMatchObject({ expectedDate: '2026-10-08', amountMinor: 4100 })
    const withCommitment = ctx({ commitments: [{ id: 'c1', title: 'Permit', expectedDate: '2026-10-10', amountMinor: 9000, amountType: 'fixed', estimatedMinMinor: null, estimatedMaxMinor: null, status: 'scheduled', reconciliationState: 'unreconciled', accountId: null }] })
    expect(buildBillCandidates(withCommitment, '2026-09-20', '2026-10-20').map(b => `${b.type}:${b.id}`)).toEqual(['obligation:o1', 'commitment:c1'])
    expect(buildBillCandidates(ctx({ obligations: [{ ...ctx().obligations[0], status: 'paused' }] }), '2026-09-20', '2026-10-20')).toEqual([])
  })
  it('explorerFromContext wires evidence + cash obligations into suggestions end to end (read-only)', () => {
    const t = tx('INTUIT QUICKBOOKS ONLINE', 38, '2026-10-05')
    const c = ctx({ txs: [t], accounts: [...accounts.values()] })
    const { rows } = explorerFromContext(c, AS_OF)
    expect(rows[0].relationship).toMatchObject({ kind: 'obligation', state: 'suggested', target: { id: 'o1' } })
    expect(c.occurrences).toEqual([]) // no occurrence was materialized
  })
})
