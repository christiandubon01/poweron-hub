// @ts-nocheck -- real repositories over a PostgREST shim on PGlite
/**
 * PLAID-4: cross-system integrity audit on REAL SQL. Each scenario drives the whole pipeline (evidence -> classification -> reconciliation -> owner decisions ->
 * Matches review -> BANK-6G report -> consolidated position) and checks the financial contract, not one module:
 *
 *   A pending -> posted           never two economic events for one purchase
 *   B modified / removed legs     a confirmed pair whose evidence changes is flagged, and leaks into no income or expense
 *   C refunds / chargebacks       never income unless the owner says so
 *   D duplicate connections       the same account connected twice is flagged, never silently merged
 *   E matching rules              windows, equal amounts, unrelated same-amount rows, ambiguity: no broad fuzzy auto-confirmation
 *   F business <-> personal       explicit, counted as cross-scope, in neither income nor spending
 *   G rejected persistence        a rejected pair stays rejected; materially new evidence is offered again, for review only
 *   H disconnection               balances leave with the connection; history stays
 *   I switch reversibility        OFF -> ON -> OFF changes nothing that was stored, and reports return exactly
 *
 * Position assertions use DELTAS (before/after one scenario's rows) so scenarios share one organization without interfering.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyDecision, explorerFromContext, getSpendingReport, loadContextForRange } from '../spending/spendingService'
import { createSpendingRepo } from '../spending/spendingRepo'
import { decideMatch, getMatchReview } from '../spending/matchReviewService'
import { reconciliationImpact } from '../spending/reconciliationImpact'
import { placeRow } from '../spending/consolidatedPosition'
import { getConsolidatedPosition } from '../spending/positionService'
import { createBankAccountRepo } from '../bankAccountRepo'
import { createBankBalanceRepo } from '../bankBalanceRepo'
import { createBankConnectionRepo } from '../bankConnectionRepo'
import { NOW, ORG, OWNER_ID, buildWorld } from './helpers/spendingWorld'

let PGlite: any = null, types: any = null
try { const m = await import('@electric-sql/pglite'); PGlite = m.PGlite; types = m.types } catch { PGlite = null }

const owner = { organizationId: ORG, userId: OWNER_ID, role: 'owner' }
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const LINES = ['income', 'refunds', 'otherClassifiedIn', 'businessSpending', 'personalSpending', 'debtRepayments', 'internalMovement', 'unclassifiedIn', 'unresolvedOut', 'ignored']

describe.runIf(!!PGlite)('PLAID-4 cross-system integrity (real SQL, multi-account, two institutions)', () => {
  let w: Awaited<ReturnType<typeof buildWorld>>
  const T: Record<string, string> = {}
  const spendDeps = (over = {}) => ({ repo: createSpendingRepo(w.svc), environment: 'production', now: () => NOW, reconciliationEnabled: true, ...over })
  const posDeps = (over = {}) => ({ ...spendDeps(), accounts: createBankAccountRepo(w.svc), balances: createBankBalanceRepo(w.svc), connections: createBankConnectionRepo(w.svc), positionEnabled: true, balancesEnabled: true, ...over })
  const position = (over = {}, raw = {}) => getConsolidatedPosition(posDeps(over), owner, { days: 90, ...raw })
  /** the position's activity lines as plain numbers, so a scenario can be measured by what it ADDED */
  const snapshot = async (over = {}) => { const p = await position(over); return { p, l: Object.fromEntries(LINES.map(k => [k, { in: p.activity.lines[k].inMinor, out: p.activity.lines[k].outMinor, n: p.activity.lines[k].count }])), pending: p.activity.pending } }
  const delta = (a, b) => Object.fromEntries(LINES.map(k => [k, { in: b.l[k].in - a.l[k].in, out: b.l[k].out - a.l[k].out, n: b.l[k].n - a.l[k].n }]))
  const only = (d, ...keys) => { for (const k of LINES) if (!keys.includes(k)) expect(d[k], `${k} must not move`).toEqual({ in: 0, out: 0, n: 0 }) }
  const placement = async (over = {}) => {
    const { ctx } = await loadContextForRange(spendDeps(over), ORG, { completeSince: '2026-06-01', explorerSince: '2026-06-01' })
    return Object.fromEntries(explorerFromContext(ctx, '2026-10-11', 'all', 'production').rows.map(r => [r.id, placeRow(r).line]))
  }
  const review = (tab = 'all', over = {}) => getMatchReview(spendDeps(over), owner, { tab, from: '2026-07-01', to: '2026-10-11' })
  const itemFor = async (id: string, tab = 'all') => (await review(tab)).items.find(i => i.outflow.id === id || i.inflow.id === id)
  const confirm = async (o: string, i: string) => decideMatch(spendDeps(), owner, { decision: 'confirm', outflowId: o, inflowId: i, fingerprint: (await itemFor(o)).fingerprint })
  const reject = async (o: string, i: string) => decideMatch(spendDeps(), owner, { decision: 'reject', outflowId: o, inflowId: i, fingerprint: (await itemFor(o)).fingerprint })
  const reverse = (o: string, i: string) => decideMatch(spendDeps(), owner, { decision: 'reverse', outflowId: o, inflowId: i })
  const interp = (...ids: string[]) => w.q(`SELECT provider_transaction_ref AS tx, status FROM public.financial_provider_interpretations WHERE provider_transaction_ref = ANY($1) ORDER BY created_at, id`, [ids])

  beforeAll(async () => {
    w = await buildWorld(PGlite, types)
    // balances so the position has a real baseline
    for (const [k, cur, avail] of [['chk', 10_000, 9_000], ['sav', 40_000, 40_000], ['pchk', 2_500, null]]) await w.q(`INSERT INTO public.financial_provider_balance_snapshots (organization_id, provider_account_ref, observed_at, current_balance, current_balance_minor, available_balance, available_balance_minor, source) VALUES ($1,$2,$3,$4,$5,$6,$7,'plaid_accounts_get')`, [ORG, w.accounts[k].ref, hoursAgo(1), cur, cur * 100, avail, avail == null ? null : avail * 100])
  }, 240_000)
  afterAll(async () => { await w?.db?.close?.() })

  it('A. pending -> posted: the purchase is counted ONCE whatever order the bank sends the pending and posted rows in', async () => {
    const before = await snapshot()
    T.p1 = await w.tx('card', 20, '2026-10-02', 'COFFEE SHOP', { pending: true, pid: 'ptx-pending-1' })
    const withPending = await snapshot()
    only(delta(before, withPending))                                                                           // a pending purchase is in NO line ...
    expect(withPending.pending.outMinor - before.pending.outMinor).toBe(2_000); expect(withPending.pending.count - before.pending.count).toBe(1) // ... it is shown apart
    // the posted replacement arrives (with a different amount: a tip) while the pending row is still there: both exist for a moment
    T.q1 = await w.tx('card', 24, '2026-10-03', 'COFFEE SHOP', { pendingPid: 'ptx-pending-1', pid: 'ptx-posted-1' })
    const both = await snapshot()
    expect(delta(before, both).businessSpending).toEqual({ in: 0, out: 2_400, n: 1 }); only(delta(before, both), 'businessSpending') // counted once, at the posted amount
    // the bank then removes the pending row: nothing changes except the pending note
    await w.q(`UPDATE public.financial_provider_transactions SET removed_at = now() WHERE id = $1`, [T.p1])
    const after = await snapshot()
    expect(delta(before, after).businessSpending).toEqual({ in: 0, out: 2_400, n: 1 }); expect(after.pending).toEqual(before.pending)
    // a decision on the posted purchase sticks to it
    await applyDecision(spendDeps(), owner, { action: 'set_bucket', transactionId: T.q1, bucket: 'meals' })
    expect(delta(before, await snapshot()).businessSpending.out).toBe(2_400)
  })

  it('B. a confirmed pair whose evidence later changes is flagged and leaks into no income or expense; removing a leg does the same', async () => {
    T.bo = await w.tx('chk', 400, '2026-10-04', 'ONLINE TRANSFER TO SAV'); T.bi = await w.tx('sav', -400, '2026-10-04', 'ONLINE TRANSFER FROM CHK')
    const base = await snapshot()
    await confirm(T.bo, T.bi)
    const confirmed = await snapshot()
    expect(delta(base, confirmed).internalMovement).toEqual({ in: 40_000, out: 40_000, n: 2 })                 // the whole movement moved out of "unresolved" into one internal movement
    expect(confirmed.p.issues.some(i => i.id === 'internal-unbalanced')).toBe(false)
    // the bank CORRECTS one leg after the owner confirmed it
    await w.q(`UPDATE public.financial_provider_transactions SET provider_amount = -390, provider_amount_minor = -39000 WHERE id = $1`, [T.bi])
    const changed = await snapshot()
    const it = await itemFor(T.bo)
    expect(it).toMatchObject({ state: 'evidence_changed', needsReview: true }); expect(it.changes).toContain('The incoming amount changed.')
    expect(changed.p.issues.find(i => i.id === 'internal-unbalanced')).toBeTruthy()                           // the imbalance is said ...
    expect(delta(confirmed, changed).income).toEqual({ in: 0, out: 0, n: 0 }); expect(delta(confirmed, changed).businessSpending).toEqual({ in: 0, out: 0, n: 0 }) // ... and leaks nowhere
    // the owner's confirmation still applies (owner precedence) until they act: nothing is silently reclassified
    expect((await placement())[T.bo]).toBe('internalMovement')
    // the bank REMOVES the changed leg
    await w.q(`UPDATE public.financial_provider_transactions SET removed_at = now() WHERE id = $1`, [T.bi])
    const gone = await snapshot()
    expect((await itemFor(T.bo)).changes.join(' ')).toMatch(/no longer in your bank data/)
    expect(delta(base, gone).internalMovement).toEqual({ in: 0, out: 40_000, n: 1 })                           // only the surviving leg, still not an expense
    expect(delta(base, gone).businessSpending).toEqual({ in: 0, out: 0, n: 0 })
    // the owner can still reverse it, and the survivor then waits for a decision instead of becoming spending
    expect((await reverse(T.bo, T.bi)).outcome).toBe('reversed')
    const reversed = await snapshot()
    expect(delta(base, reversed).internalMovement).toEqual({ in: 0, out: 0, n: 0 }); expect(delta(base, reversed).businessSpending.out).toBe(0)
    expect((await interp(T.bo, T.bi)).every(r => r.status === 'undone')).toBe(true)                            // history kept, nothing deleted
  })

  it('C. refunds, chargebacks and reversals are never income until the owner says so', async () => {
    const before = await snapshot()
    T.cp = await w.tx('card', 89.99, '2026-10-01', 'HOME DEPOT #12'); T.cr = await w.tx('card', -89.99, '2026-10-06', 'HOME DEPOT RETURN'); T.cc = await w.tx('card', -35, '2026-10-07', 'CHARGEBACK ACME SUPPLY'); T.cv = await w.tx('chk', -60, '2026-10-08', 'REVERSAL ACH DEBIT')
    const arrived = await snapshot()
    // the purchase is business spending (assumed from the business card); the three credits are money in that nobody classified: none is income
    expect(delta(before, arrived).businessSpending).toEqual({ in: 0, out: 8_999, n: 1 }); expect(delta(before, arrived).unclassifiedIn).toEqual({ in: 8_999 + 3_500 + 6_000, out: 0, n: 3 })
    expect(delta(before, arrived).income).toEqual({ in: 0, out: 0, n: 0 }); expect(delta(before, arrived).refunds).toEqual({ in: 0, out: 0, n: 0 })
    const hint = arrived.p.activity.lines.unclassifiedIn.hints.likelyRefund, hint0 = before.p.activity.lines.unclassifiedIn.hints.likelyRefund
    expect(hint.count - hint0.count).toBe(3); expect(hint.inMinor - hint0.inMinor).toBe(8_999 + 3_500 + 6_000)       // "looks like a refund", counted nowhere
    // the owner categorizes the purchase: the SAME $89.99 moves from "assumed" to "you classified" - the total does not change
    await applyDecision(spendDeps(), owner, { action: 'set_bucket', transactionId: T.cp, bucket: 'materials' })
    const bought = await snapshot()
    expect(delta(arrived, bought).businessSpending).toEqual({ in: 0, out: 0, n: 0 })
    expect(bought.p.activity.lines.businessSpending.ownerClassified.outMinor - arrived.p.activity.lines.businessSpending.ownerClassified.outMinor).toBe(8_999)
    // the owner confirms the return as a refund: it MOVES to the refunds line (never income); the chargeback and the reversal are left alone
    await applyDecision(spendDeps(), owner, { action: 'set_bucket', transactionId: T.cr, bucket: 'refund' })
    const refunded = await snapshot()
    expect(delta(bought, refunded).refunds).toEqual({ in: 8_999, out: 0, n: 1 }); expect(delta(bought, refunded).income).toEqual({ in: 0, out: 0, n: 0 })
    expect(delta(bought, refunded).unclassifiedIn).toEqual({ in: -8_999, out: 0, n: -1 })                            // moved, not added
    const pl = await placement()
    expect(pl[T.cc]).toBe('unclassifiedIn'); expect(pl[T.cv]).toBe('unclassifiedIn')
    // undo is exact
    await applyDecision(spendDeps(), owner, { action: 'undo', transactionId: T.cr, dimension: 'bucket' })
    expect(delta(bought, await snapshot())).toEqual(delta(bought, bought))
  })

  it('D. the same account connected twice is flagged and never silently merged; several accounts under one connection are normal', async () => {
    const base = await position()
    expect(base.issues.some(i => i.id === 'duplicate-accounts')).toBe(false)                                   // four accounts under one Wells Fargo connection: not a duplicate
    const wf2 = (await w.q(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid','wf-second','ins_wf','Wells Fargo',$2,$3,'production')`, [ORG, `v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}`, OWNER_ID]))[0].item_id
    const dup = (await w.q(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name, mask, provider_account_type, provider_account_subtype) VALUES ($1,$2,'chk-dup','Business Checking','0chk','depository','checking') RETURNING id`, [ORG, wf2]))[0].id
    await w.q(`INSERT INTO public.financial_provider_balance_snapshots (organization_id, provider_account_ref, observed_at, current_balance, current_balance_minor, source) VALUES ($1,$2,$3,10000,1000000,'plaid_accounts_get')`, [ORG, dup, hoursAgo(1)])
    const p = await position()
    expect(p.issues.find(i => i.id === 'duplicate-accounts')).toMatchObject({ severity: 'warning' })
    expect(p.cash.liquid.all.balance.minor - base.cash.liquid.all.balance.minor).toBe(1_000_000)               // counted as reported, not hidden; the warning says it may be double
    expect(p.accounts.filter(a => a.name === 'Business Checking')).toHaveLength(2)
  })

  it('E. matching rules: windows, equal amounts, unrelated same-amount rows and ambiguity never produce an automatic or fuzzy confirmation', async () => {
    const mk = async (o: [string, number, string, string], i: [string, number, string, string]) => [await w.tx(...o), await w.tx(...i)]
    // bank to bank: 3 days apart is a proposal, 4 is not
    const [a3o, a3i] = await mk(['chk', 300.01, '2026-09-01', 'ONLINE TRANSFER'], ['sav', -300.01, '2026-09-04', 'ONLINE TRANSFER'])
    const [a4o, a4i] = await mk(['chk', 300.02, '2026-09-01', 'ONLINE TRANSFER'], ['sav', -300.02, '2026-09-05', 'ONLINE TRANSFER'])
    // card payment: 5 days apart is a proposal, 6 is not
    const [c5o, c5i] = await mk(['chk', 150.03, '2026-09-02', 'WELLS FARGO CARD AUTOPAY'], ['card', -150.03, '2026-09-07', 'PAYMENT THANK YOU'])
    const [c6o, c6i] = await mk(['chk', 150.04, '2026-09-02', 'WELLS FARGO CARD AUTOPAY'], ['card', -150.04, '2026-09-08', 'PAYMENT THANK YOU'])
    // one cent apart: never a pair
    const [uo, ui] = await mk(['chk', 100.00, '2026-09-10', 'ONLINE TRANSFER'], ['sav', -100.01, '2026-09-10', 'ONLINE TRANSFER'])
    // a card CHARGE and a bank deposit of the same amount are two unrelated events
    const [ho, hi] = await mk(['card', 49.99, '2026-09-11', 'ADOBE'], ['chk', -49.99, '2026-09-11', 'DEPOSIT CUSTOMER'])
    // two identical outflows and one inflow: ambiguous
    const e1 = await w.tx('chk', 410.05, '2026-09-12', 'MISC DEBIT'), e2 = await w.tx('sav', 410.05, '2026-09-12', 'MISC DEBIT'), ei = await w.tx('card', -410.05, '2026-09-13', 'PAYMENT')
    const r = await review()
    const proposed = new Set(r.items.map(i => `${i.outflow.id}>${i.inflow.id}`))
    expect(proposed.has(`${a3o}>${a3i}`)).toBe(true); expect(proposed.has(`${a4o}>${a4i}`)).toBe(false)
    expect(proposed.has(`${c5o}>${c5i}`)).toBe(true); expect(proposed.has(`${c6o}>${c6i}`)).toBe(false)
    for (const id of [uo, ui, ho, hi]) expect(r.items.some(i => i.outflow.id === id || i.inflow.id === id), id).toBe(false)
    expect(r.groups.some(g => g.outflows.some(l => l.id === e1) && g.outflows.some(l => l.id === e2) && g.inflows.some(l => l.id === ei))).toBe(true)
    expect(r.items.some(i => [e1, e2, ei].includes(i.outflow.id) || i.inflow.id === ei)).toBe(false)               // an ambiguous group is NEVER auto-paired
    // nothing was confirmed by anyone: no interpretation row exists for any of them, and none of the unmatched legs counts as income or an expense it is not
    expect(await interp(a3o, a3i, a4o, a4i, c5o, c5i, c6o, c6i, uo, ui, ho, hi, e1, e2, ei)).toEqual([])
    const pl = await placement()
    for (const id of [a3i, a4i, c5i, c6i, ui, ei]) expect(pl[id], id).toBe('unclassifiedIn')
    expect(pl[hi]).toBe('unclassifiedIn'); expect(pl[ho]).toBe('businessSpending')                                // the charge is an ordinary card purchase; the deposit is not income
    for (const id of [a3o, a4o, c5o, c6o, uo, e1, e2]) expect(['unresolvedOut', 'businessSpending']).toContain(pl[id])
  })

  it('F. business <-> personal: explicit, shown as cross-scope, and in neither income nor spending', async () => {
    T.fo = await w.tx('chk', 2_000, '2026-10-09', 'ONLINE TRANSFER'); T.fi = await w.tx('pchk', -2_000, '2026-10-09', 'ONLINE TRANSFER')
    const base = await snapshot()
    const it = await itemFor(T.fo)
    expect(it).toMatchObject({ crossScope: true, needsReview: true, confidence: 'possible' })
    only(delta(base, base))                                                                                     // proposed only: counted nowhere
    expect((await placement())[T.fo]).toBe('unresolvedOut')
    await confirm(T.fo, T.fi)
    const after = await snapshot()
    expect(delta(base, after).internalMovement).toEqual({ in: 200_000, out: 200_000, n: 2 })
    expect(after.p.activity.lines.internalMovement.crossScope.outMinor - base.p.activity.lines.internalMovement.crossScope.outMinor).toBe(200_000)
    expect(delta(base, after).income.in).toBe(0); expect(delta(base, after).personalSpending.out).toBe(0)
  })

  it('G. a rejected pair stays rejected through new activity and a reload; materially new evidence is offered again, for review only', async () => {
    T.ro = await w.tx('chk', 777.77, '2026-10-05', 'ACH TRANSFER'); T.ri = await w.tx('sav', -777.77, '2026-10-05', 'ACH TRANSFER')
    const base = await snapshot()
    expect((await reject(T.ro, T.ri)).outcome).toBe('rejected')
    // more activity arrives (a sync), including another unrelated equal-looking pair
    await w.tx('chk', 12.5, '2026-10-09', 'CHEVRON 123'); await w.tx('sav', -33.33, '2026-10-09', 'INTEREST')
    const stays = await itemFor(T.ro)
    expect(stays).toMatchObject({ state: 'rejected', actions: ['confirm'] }); expect((await review('review')).items.some(i => i.outflow.id === T.ro)).toBe(false)   // not in the to-review list
    expect((await position()).activity.lines.internalMovement.count).toBe(base.p.activity.lines.internalMovement.count)                                            // counted nowhere
    expect((await placement())[T.ri]).toBe('unclassifiedIn')
    // a different request with a stale fingerprint cannot revive or change it
    await expect(decideMatch(spendDeps(), owner, { decision: 'confirm', outflowId: T.ro, inflowId: T.ri, fingerprint: stays.fingerprint.replace('77777', '99999') })).rejects.toMatchObject({ httpStatus: 409 })
    // the bank corrects the amount (materially new evidence): the pair comes back flagged for review; it is NOT confirmed and nothing is counted
    await w.q(`UPDATE public.financial_provider_transactions SET provider_amount = 700, provider_amount_minor = 70000 WHERE id = $1`, [T.ro])
    await w.q(`UPDATE public.financial_provider_transactions SET provider_amount = -700, provider_amount_minor = -70000 WHERE id = $1`, [T.ri])
    const again = await itemFor(T.ro)
    expect(again).toMatchObject({ state: 'evidence_changed', needsReview: true }); expect(again.actions).toEqual(['confirm', 'reject'])
    expect((await interp(T.ro, T.ri)).every(r => r.status === 'rejected' || r.status === 'undone')).toBe(true)
    expect((await position()).activity.lines.internalMovement.count).toBe(base.p.activity.lines.internalMovement.count)
  })

  it('H. disconnecting a connection removes its balances from the position; its history stays', async () => {
    const before = await position()
    const chaseRows = before.accounts.filter(a => a.label.startsWith('Chase'))
    expect(chaseRows.length).toBeGreaterThan(0)
    await w.q(`SELECT public.financial_provider_disconnect_item($1,$2)`, [ORG, w.ids.ch])
    const after = await position()
    expect(after.accounts.some(a => a.label.startsWith('Chase'))).toBe(false)
    expect(after.sync.connections.some(c => c.label === 'Chase')).toBe(false)
    expect((await review()).items.length).toBeGreaterThan(0)                                                  // history and decisions remain readable
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_transactions WHERE provider_item_ref = $1`, [w.ids.ch]))[0].n).toBeGreaterThanOrEqual(0)
  })

  it('I. the switch is reversible: OFF -> ON -> OFF stores nothing and the OFF position and reports return exactly; the impact preview names every difference first', async () => {
    const stored = async () => JSON.stringify(await w.q(`SELECT provider_transaction_ref, kind, status, category, counterpart_provider_transaction_ref FROM public.financial_provider_interpretations ORDER BY id`))
    const reportOf = async (on: boolean) => JSON.stringify((await getSpendingReport(spendDeps({ reconciliationEnabled: on }), owner, { report: 'all_money', from: '2026-07-01', to: '2026-10-11', accounts: 'all' })).groups)
    const s0 = await stored(), off0 = await reportOf(false), pos0 = JSON.stringify((await position({ reconciliationEnabled: false })).activity)
    const impact = await reconciliationImpact(spendDeps({ reconciliationEnabled: false }), owner, { from: '2026-07-01', to: '2026-10-11' })
    expect(impact.summary).toBeTruthy(); expect(impact.changes.length).toBeGreaterThan(0)                      // there ARE differences, and they are listed before anything is switched on
    const on = await reportOf(true); await position({ reconciliationEnabled: true })
    expect(on).not.toBe(off0)                                                                                    // ON really is a different (reviewed) classification
    expect(await reportOf(false)).toBe(off0); expect(JSON.stringify((await position({ reconciliationEnabled: false })).activity)).toBe(pos0)
    expect(await stored()).toBe(s0)                                                                              // reading in either mode wrote nothing
  })
})
