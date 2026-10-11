// @ts-nocheck -- real repository over a PostgREST shim on PGlite
/**
 * PLAID-3B end to end on REAL SQL: the owner's Matches review through the REAL spending repository, REAL services and the REAL Netlify handler, against a
 * multi-account, two-institution organization (Wells Fargo checking / savings / personal checking / business card, plus a Chase card).
 *
 * Proves the whole lifecycle (see the proposals, understand them, confirm / reject / reverse, come back later), that decisions persist across reloads, that
 * reports react exactly as the financial contract requires, that every guard holds (organization, role, switch, stale evidence, owner precedence), and that
 * nothing but interpretation rows ever changes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyDecision, getExplorer, getSpendingReport } from '../spending/spendingService'
import { createSpendingRepo } from '../spending/spendingRepo'
import { decideMatch, getMatchReview } from '../spending/matchReviewService'
import { pairFingerprint } from '../spending/reconciliation'
import { buildHandler } from '../../../../netlify/functions/bank/plaid-spending'
import { NOW, ORG, ORG_B, OWNER_B_ID, OWNER_ID, buildWorld } from './helpers/spendingWorld'

let PGlite: any = null, types: any = null
try { const m = await import('@electric-sql/pglite'); PGlite = m.PGlite; types = m.types } catch { PGlite = null }

const owner = { organizationId: ORG, userId: OWNER_ID, role: 'owner' }
const ownerB = { organizationId: ORG_B, userId: OWNER_B_ID, role: 'owner' }

describe.runIf(!!PGlite)('PLAID-3B Matches review end to end (real SQL, two institutions, four Wells Fargo accounts)', () => {
  let w: Awaited<ReturnType<typeof buildWorld>>
  const T: Record<string, string> = {}
  const mkDeps = (over = {}) => ({ repo: createSpendingRepo(w.svc), environment: 'production', now: () => NOW, reconciliationEnabled: true, ...over })
  const review = (tab = 'all', actor = owner, over = {}) => getMatchReview(mkDeps(over), actor, { tab, from: '2026-07-01', to: '2026-10-11' })
  const item = async (txId: string, tab = 'all') => (await review(tab)).items.find(i => i.outflow.id === txId || i.inflow.id === txId)
  const confirm = async (o: string, i: string, actor = owner, over = {}) => decideMatch(mkDeps(over), actor, { decision: 'confirm', outflowId: o, inflowId: i, fingerprint: (await item(o)).fingerprint })
  const act = (activityRows) => Object.fromEntries(activityRows.map(r => [r.id, r.activity]))
  const report = async (over = {}) => act((await getSpendingReport(mkDeps(over), owner, { report: 'all_money', from: '2026-07-01', to: '2026-10-11', accounts: 'all' })).rows)
  const interp = (...ids: string[]) => w.q(`SELECT provider_transaction_ref AS tx, kind, status, counterpart_provider_transaction_ref AS cp, undo_reason FROM public.financial_provider_interpretations WHERE provider_transaction_ref = ANY($1) AND kind = 'transfer' ORDER BY created_at, id`, [ids])
  let pristine = ''

  beforeAll(async () => {
    w = await buildWorld(PGlite, types)
    // A: checking -> savings (both Wells Fargo business)
    T.aO = await w.tx('chk', 1000, '2026-09-05', 'ONLINE TRANSFER TO SAV'); T.aI = await w.tx('sav', -1000, '2026-09-05', 'ONLINE TRANSFER FROM CHK')
    // B: Wells Fargo checking -> Chase card (a different institution)
    T.bO = await w.tx('chk', 2500, '2026-09-08', 'CHASE CARD AUTOPAY'); T.bI = await w.tx('chase', -2500, '2026-09-09', 'AUTOMATIC PAYMENT - THANK YOU')
    // C: Wells Fargo checking -> Wells Fargo card
    T.cO = await w.tx('chk', 300, '2026-09-10', 'WELLS FARGO CARD PMT'); T.cI = await w.tx('card', -300, '2026-09-11', 'PAYMENT THANK YOU')
    // D: business checking -> PERSONAL checking (owner draw or transfer?)
    T.dO = await w.tx('chk', 1500, '2026-09-12', 'ONLINE TRANSFER'); T.dI = await w.tx('pchk', -1500, '2026-09-12', 'ONLINE TRANSFER')
    // E: two outflows, one inflow of the same amount (ambiguous)
    T.eO1 = await w.tx('chk', 400, '2026-09-14', 'MISC DEBIT'); T.eO2 = await w.tx('sav', 400, '2026-09-14', 'MISC DEBIT'); T.eI = await w.tx('card', -400, '2026-09-15', 'PAYMENT')
    // F: equal amounts, nothing in the descriptions (possible only)
    T.fO = await w.tx('chk', 75.25, '2026-09-16', 'ACME'); T.fI = await w.tx('sav', -75.25, '2026-09-17', 'DEPOSIT')
    // G: both legs still pending
    T.gO = await w.tx('chk', 60, '2026-09-20', 'ONLINE TRANSFER', { pending: true }); T.gI = await w.tx('sav', -60, '2026-09-20', 'ONLINE TRANSFER', { pending: true })
    // H: a card purchase and an unrelated deposit of the same amount: NOT a pair
    T.hP = await w.tx('card', 49.99, '2026-09-18', 'ADOBE'); T.hD = await w.tx('chk', -49.99, '2026-09-18', 'DEPOSIT CUSTOMER')
    // I: a refund of an earlier card purchase
    T.iP = await w.tx('card', 89.99, '2026-08-01', 'HOME DEPOT #12'); T.iR = await w.tx('card', -89.99, '2026-08-20', 'HOME DEPOT RETURN')
    // J/K: a customer deposit and ordinary spending
    T.jD = await w.tx('chk', -3000, '2026-09-22', 'DEPOSIT CUSTOMER'); T.kS = await w.tx('chk', 61.4, '2026-09-23', 'CHEVRON 123')
    pristine = await w.untouched()
  }, 180_000)
  afterAll(async () => { await w?.db?.close?.() })

  it('shows what the engine proposes, with both accounts, amounts, dates, reasons, confidence and ambiguity', async () => {
    const r = await review('all')
    expect(r).toMatchObject({ enabled: true, decisionsAvailable: true, environment: 'production', coverage: { complete: true } })
    const a = r.items.find(i => i.outflow.id === T.aO)!
    expect(a).toMatchObject({ state: 'suggested', kind: 'internal_transfer', confidence: 'high', amountMinor: 100000, daysApart: 0, needsReview: false, crossScope: false, actions: ['confirm', 'reject'] })
    expect(a.outflow).toMatchObject({ date: '2026-09-05', amountMinor: 100000, pending: false, missing: false, account: { label: 'WF Business Checking', institution: 'Wells Fargo', ownership: 'business', accountClass: 'bank_cash' } })
    expect(a.inflow).toMatchObject({ amountMinor: -100000, account: { label: 'WF Business Savings', ownership: 'business' } })
    expect(a.reasons.join(' ')).toMatch(/equal \$1000\.00 movement left .* arrived in/)
    expect(a.fingerprint).toBe(pairFingerprint({ id: T.aO, providerAccountRef: w.accounts.chk.ref, amountMinor: 100000, date: '2026-09-05', pending: false }, { id: T.aI, providerAccountRef: w.accounts.sav.ref, amountMinor: -100000, date: '2026-09-05', pending: false }))
    // a card payment to a card at ANOTHER institution is a card payment, and its institution is shown
    const b = r.items.find(i => i.outflow.id === T.bO)!
    expect(b).toMatchObject({ kind: 'card_payment', confidence: 'high', daysApart: 1 }); expect(b.inflow.account).toMatchObject({ institution: 'Chase', accountClass: 'credit_card' })
    expect(r.items.find(i => i.outflow.id === T.cO)).toMatchObject({ kind: 'card_payment', confidence: 'high' })
    // business <-> personal: capped, explained, needs review
    const d = r.items.find(i => i.outflow.id === T.dO)!
    expect(d).toMatchObject({ confidence: 'possible', crossScope: true, needsReview: true, caps: ['cross_scope'] }); expect(d.reasons.join(' ')).toMatch(/owner draw or a contribution/)
    // no wording: possible only
    expect(r.items.find(i => i.outflow.id === T.fO)).toMatchObject({ confidence: 'possible', needsReview: true, caps: ['no_signal'] })
    // pending legs wait; nothing can be decided
    expect(r.items.find(i => i.outflow.id === T.gO)).toMatchObject({ state: 'waiting', actions: [] })
    // the ambiguous group lists every candidate and is not paired
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].outflows.map(l => l.id).sort()).toEqual([T.eO1, T.eO2].sort()); expect(r.groups[0].inflows.map(l => l.id)).toEqual([T.eI])
    expect(r.groups[0].candidates).toHaveLength(2); expect(r.items.some(i => [T.eO1, T.eO2, T.eI].includes(i.outflow.id) || [T.eI].includes(i.inflow.id))).toBe(false)
    // the card purchase / deposit coincidence and ordinary rows are never proposed
    for (const id of [T.hP, T.hD, T.jD, T.kS]) expect(r.items.some(i => i.outflow.id === id || i.inflow.id === id)).toBe(false)
    // the refund is suggested, linked to its purchase, and is not a pair
    expect(r.refunds).toHaveLength(1); expect(r.refunds[0]).toMatchObject({ state: 'suggested', confidence: 'high', refund: { id: T.iR }, original: { id: T.iP } })
    expect(r.counts).toMatchObject({ suggested: 5, waiting: 1, ambiguous: 1, confirmed: 0, rejected: 0 })
  })

  it('is off unless the server switch is on: nothing is loaded, nothing can be decided', async () => {
    const spy: string[] = []
    const repo = createSpendingRepo(w.svc)
    const spied = new Proxy(repo, { get: (t, k) => typeof t[k] === 'function' ? (...a) => { spy.push(String(k)); return t[k](...a) } : t[k] })
    const off = await getMatchReview({ repo: spied, environment: 'production', now: () => NOW }, owner, {})
    expect(off).toEqual({ enabled: false, decisionsAvailable: false }); expect(spy).toEqual([])
    await expect(decideMatch({ repo: spied, environment: 'production', now: () => NOW }, owner, { decision: 'confirm', outflowId: T.aO, inflowId: T.aI, fingerprint: 'v1|' + 'x'.repeat(30) })).rejects.toMatchObject({ code: 'feature_disabled' })
    expect(await w.untouched()).toBe(pristine)
  })

  it('confirm: both legs are recorded, the pair moves to Confirmed, reports count it as an internal transfer, and nothing else changes', async () => {
    const before = await report()
    expect(before[T.aO]).toBe('unresolved'); expect(before[T.aI]).toBe('unresolved') // proposed but unconfirmed: in neither income nor expenses
    expect(await confirm(T.aO, T.aI)).toMatchObject({ outcome: 'confirmed' })
    const rows = await interp(T.aO, T.aI)
    expect(rows).toHaveLength(2); expect(rows.every(r => r.status === 'confirmed')).toBe(true)
    expect(rows.find(r => r.tx === T.aO).cp).toBe(T.aI); expect(rows.find(r => r.tx === T.aI).cp).toBe(T.aO)
    const it = await item(T.aO, 'all')
    expect(it).toMatchObject({ state: 'confirmed', needsReview: false, actions: ['reverse'], decision: { legacy: false } })
    expect((await review('review')).items.some(i => i.outflow.id === T.aO)).toBe(false) // out of the to-review list
    expect((await review('confirmed')).items.map(i => i.outflow.id)).toContain(T.aO)
    const after = await report()
    expect(after[T.aO]).toBe('transfer'); expect(after[T.aI]).toBe('transfer')
    // the Explorer shows both legs confirmed, resolved and not as unassigned spending
    const ex = await getExplorer(mkDeps(), owner, { accounts: 'all', from: '2026-07-01', limit: 200 })
    for (const id of [T.aO, T.aI]) expect(ex.rows.find(r => r.id === id)).toMatchObject({ relationship: { kind: 'transfer', state: 'confirmed' }, unassigned: false })
    // rolling the switch back does not change what the owner confirmed: each leg carries its own decision row
    const off = await report({ reconciliationEnabled: false })
    expect(off[T.aO]).toBe('transfer'); expect(off[T.aI]).toBe('transfer')
    // only interpretation rows moved
    expect(await w.untouched()).toBe(pristine)
  })

  it('repeating a confirmation is harmless; confirming from the other leg is the same pair', async () => {
    const again = await decideMatch(mkDeps(), owner, { decision: 'confirm', outflowId: T.aO, inflowId: T.aI, fingerprint: (await item(T.aO)).fingerprint })
    expect(again.outcome).toBe('unchanged'); expect(await interp(T.aO, T.aI)).toHaveLength(2)
  })

  it('card payments: the kind comes from the accounts (never the request), across institutions, and the card side is not income', async () => {
    expect(await confirm(T.bO, T.bI)).toMatchObject({ outcome: 'confirmed' })
    expect(await confirm(T.cO, T.cI)).toMatchObject({ outcome: 'confirmed' })
    const basis = await w.q(`SELECT suggestion_basis AS b FROM public.financial_provider_interpretations WHERE provider_transaction_ref = $1 AND status = 'confirmed'`, [T.bO])
    expect(basis[0].b).toMatchObject({ pair_kind: 'card_payment', mode: 'pair_review', source: 'owner_review' })
    const r = await report()
    for (const id of [T.bO, T.bI, T.cO, T.cI]) expect(r[id]).toBe('transfer')
    expect(r[T.hP]).not.toBe('income'); expect(r[T.hD]).toBe('income') // an unrelated deposit of the same amount stays a deposit; the purchase on the card stays spending
  })

  it('reject: the pair leaves the to-review list, is not suggested again anywhere, and survives a reload', async () => {
    expect(await decideMatch(mkDeps(), owner, { decision: 'reject', outflowId: T.fO, inflowId: T.fI, fingerprint: (await item(T.fO)).fingerprint })).toMatchObject({ outcome: 'rejected' })
    expect((await interp(T.fO, T.fI)).map(r => r.status)).toEqual(['rejected'])
    const fresh = mkDeps() // a new server instance / reload: nothing but the database remembers
    const r = await getMatchReview(fresh, owner, { tab: 'rejected', from: '2026-07-01', to: '2026-10-11' })
    expect(r.items.find(i => i.outflow.id === T.fO)).toMatchObject({ state: 'rejected', actions: ['confirm'], decision: { legacy: false } })
    expect((await getMatchReview(fresh, owner, { tab: 'review', from: '2026-07-01', to: '2026-10-11' })).items.some(i => i.outflow.id === T.fO)).toBe(false)
    const ex = await getExplorer(mkDeps(), owner, { accounts: 'all', from: '2026-07-01', limit: 200 })
    for (const id of [T.fO, T.fI]) expect(ex.rows.find(r => r.id === id).relationship.target?.id ?? null).toBeNull() // not suggested again
    expect((await report())[T.fO]).not.toBe('transfer')
  })

  it('a rejected pair comes back for REVIEW (never auto) only when its evidence changes', async () => {
    await w.q(`UPDATE public.financial_provider_transactions SET transaction_date = '2026-09-18' WHERE id = $1`, [T.fI]) // the bank re-dated one leg
    const it = await item(T.fO, 'all')
    expect(it).toMatchObject({ state: 'evidence_changed', needsReview: true, actions: ['confirm', 'reject'] })
    expect(it.changes.join(' ')).toMatch(/incoming date changed/)
    const ex = await getExplorer(mkDeps(), owner, { accounts: 'all', from: '2026-07-01', limit: 200 })
    expect(ex.rows.find(r => r.id === T.fO).relationship.target?.id ?? null).toBeNull() // reports and the Explorer still treat it as rejected
    await w.q(`UPDATE public.financial_provider_transactions SET transaction_date = '2026-09-17' WHERE id = $1`, [T.fI]) // restored: back to plainly rejected
    expect((await item(T.fO, 'all')).state).toBe('rejected')
  })

  it('a stale screen cannot decide: the fingerprint must still match the evidence, and nothing is written when it does not', async () => {
    const seen = (await item(T.fO)).fingerprint
    await w.q(`UPDATE public.financial_provider_transactions SET transaction_date = '2026-09-19' WHERE id = $1`, [T.fI])
    const before = (await interp(T.fO, T.fI)).length
    await expect(decideMatch(mkDeps(), owner, { decision: 'confirm', outflowId: T.fO, inflowId: T.fI, fingerprint: seen })).rejects.toMatchObject({ code: 'conflict', httpStatus: 409 })
    expect((await interp(T.fO, T.fI)).length).toBe(before)
    await w.q(`UPDATE public.financial_provider_transactions SET transaction_date = '2026-09-17' WHERE id = $1`, [T.fI])
  })

  it('reverse: both legs are undone with a trail, reports revert, the pair is undecided again ("Reversed"), and it can be decided again', async () => {
    expect(await decideMatch(mkDeps(), owner, { decision: 'reverse', outflowId: T.aO, inflowId: T.aI })).toMatchObject({ outcome: 'reversed' })
    const rows = await interp(T.aO, T.aI)
    expect(rows.filter(r => r.status === 'undone' && r.undo_reason === 'pair_reversed')).toHaveLength(2)
    const it = await item(T.aO, 'all')
    expect(it).toMatchObject({ state: 'reversed', actions: ['confirm', 'reject'], needsReview: true })
    expect(it.history.map(h => h.event)).toEqual(['confirmed', 'reversed'])
    expect((await review('review')).items.map(i => i.outflow.id)).toContain(T.aO) // back among the unresolved suggestions
    expect((await report())[T.aO]).toBe('unresolved')
    expect(await decideMatch(mkDeps(), owner, { decision: 'reverse', outflowId: T.aO, inflowId: T.aI })).toMatchObject({ outcome: 'nothing_to_reverse' })
    expect(await confirm(T.aO, T.aI)).toMatchObject({ outcome: 'confirmed' })
    expect((await item(T.aO, 'all')).history.map(h => h.event)).toEqual(['confirmed', 'reversed', 'confirmed'])
  })

  it('a confirmed pair whose evidence later changes keeps its effect, is flagged, and can be reconfirmed or reversed', async () => {
    await w.q(`UPDATE public.financial_provider_transactions SET transaction_date = '2026-09-06' WHERE id = $1`, [T.aI]) // the bank re-dated the incoming leg after confirmation
    const it = await item(T.aO, 'all')
    expect(it).toMatchObject({ state: 'evidence_changed', needsReview: true }); expect(it.actions).toEqual(['reverse', 'reconfirm'])
    expect((await report())[T.aO]).toBe('transfer') // the owner's decision still governs the numbers
    expect(await decideMatch(mkDeps(), owner, { decision: 'confirm', outflowId: T.aO, inflowId: T.aI, fingerprint: it.fingerprint })).toMatchObject({ outcome: 'confirmed' })
    expect((await item(T.aO, 'all')).state).toBe('confirmed')
    expect((await interp(T.aO, T.aI)).filter(r => r.undo_reason === 'pair_reconfirmed')).toHaveLength(2)
  })

  it('a leg later given a different meaning makes the pair "evidence changed" (one side), never silently confirmed', async () => {
    // the owner explicitly sets the incoming leg of pair B as something else through the ordinary Explorer action
    await applyDecision(mkDeps(), owner, { action: 'set_relationship', transactionId: T.bI, kind: 'personal' })
    const it = await item(T.bO, 'all')
    expect(it.state).toBe('evidence_changed'); expect(it.changes.join(' ')).toMatch(/different meaning/)
    expect(it.actions).toContain('reverse')
    await decideMatch(mkDeps(), owner, { decision: 'reverse', outflowId: T.bO, inflowId: T.bI })
    await applyDecision(mkDeps(), owner, { action: 'undo', transactionId: T.bI, dimension: 'relationship' })
  })

  it('owner decisions take precedence: a leg decided as something else is not proposed, and a late decision on it is refused with a reason', async () => {
    // D: the owner says the personal-account deposit is personal money
    expect(await item(T.dO, 'review')).toBeTruthy()
    await applyDecision(mkDeps(), owner, { action: 'set_relationship', transactionId: T.dI, kind: 'personal' })
    expect(await item(T.dO, 'all')).toBeUndefined() // no longer proposed
    await expect(decideMatch(mkDeps(), owner, { decision: 'confirm', outflowId: T.dO, inflowId: T.dI, fingerprint: pairFingerprint({ id: T.dO, providerAccountRef: w.accounts.chk.ref, amountMinor: 150000, date: '2026-09-12', pending: false }, { id: T.dI, providerAccountRef: w.accounts.pchk.ref, amountMinor: -150000, date: '2026-09-12', pending: false }) }))
      .rejects.toMatchObject({ code: 'conflict' })
    expect((await interp(T.dO, T.dI)).length).toBe(0)
    await applyDecision(mkDeps(), owner, { action: 'undo', transactionId: T.dI, dimension: 'relationship' })
    expect(await item(T.dO, 'all')).toMatchObject({ state: 'suggested', crossScope: true }) // undone: proposed again
  })

  it('an owner pick resolves an ambiguous group: only the chosen pair is confirmed, the rest stays visible', async () => {
    const g = (await review('all')).groups[0]
    const pick = g.candidates.find(c => c.outflowId === T.eO1 && c.inflowId === T.eI)!
    expect(await decideMatch(mkDeps(), owner, { decision: 'confirm', outflowId: pick.outflowId, inflowId: pick.inflowId, fingerprint: pick.fingerprint })).toMatchObject({ outcome: 'confirmed' })
    const r = await review('all')
    expect(r.groups).toHaveLength(0)
    expect(r.items.find(i => i.outflow.id === T.eO1)).toMatchObject({ state: 'confirmed' })
    expect(r.items.some(i => i.outflow.id === T.eO2)).toBe(false) // the other outflow no longer has a counterpart: not guessed
    // the second pairing for the same inflow is refused
    await expect(decideMatch(mkDeps(), owner, { decision: 'confirm', outflowId: T.eO2, inflowId: T.eI, fingerprint: pairFingerprint({ id: T.eO2, providerAccountRef: w.accounts.sav.ref, amountMinor: 40000, date: '2026-09-14', pending: false }, { id: T.eI, providerAccountRef: w.accounts.card.ref, amountMinor: -40000, date: '2026-09-15', pending: false }) }))
      .rejects.toMatchObject({ code: 'conflict' })
  })

  it('refuses forged and malformed requests: other organizations, wrong roles, bad ids, wrong kinds, pending, removed, a body that names an organization', async () => {
    const fp = (await item(T.dO)).fingerprint
    // another organization's owner cannot see or decide this organization's transactions
    await expect(decideMatch(mkDeps(), ownerB, { decision: 'confirm', outflowId: T.dO, inflowId: T.dI, fingerprint: fp })).rejects.toMatchObject({ code: 'not_found' })
    await expect(decideMatch(mkDeps(), ownerB, { decision: 'reverse', outflowId: T.aO, inflowId: T.aI })).resolves.toMatchObject({ outcome: 'nothing_to_reverse' })
    const rb = await getMatchReview(mkDeps(), ownerB, { from: '2026-07-01', to: '2026-10-11' })
    expect(JSON.stringify(rb)).not.toContain(T.aO); expect(rb.items).toEqual([])
    // roles
    for (const role of ['employee', 'viewer', '']) {
      await expect(decideMatch(mkDeps(), { ...owner, role }, { decision: 'reverse', outflowId: T.aO, inflowId: T.aI })).rejects.toMatchObject({ code: 'forbidden' })
      await expect(getMatchReview(mkDeps(), { ...owner, role }, {})).rejects.toMatchObject({ code: 'forbidden' })
    }
    // shape
    for (const bad of [{ decision: 'bogus' }, { decision: 'confirm', outflowId: 'x', inflowId: T.dI }, { decision: 'confirm', outflowId: T.dO, inflowId: T.dO, fingerprint: fp }, { decision: 'confirm', fingerprint: undefined }, { decision: 'confirm', fingerprint: 'garbage' }, { decision: 'reject', fingerprint: 42 }])
      await expect(decideMatch(mkDeps(), owner, { outflowId: T.dO, inflowId: T.dI, fingerprint: fp, ...bad })).rejects.toMatchObject({ code: 'invalid_request' })
    // not a pair at all (purchase on a card + an unrelated deposit), wrong direction, pending legs
    const hp = pairFingerprint({ id: T.hD, providerAccountRef: w.accounts.chk.ref, amountMinor: -4999, date: '2026-09-18', pending: false }, { id: T.hP, providerAccountRef: w.accounts.card.ref, amountMinor: 4999, date: '2026-09-18', pending: false })
    await expect(decideMatch(mkDeps(), owner, { decision: 'confirm', outflowId: T.hP, inflowId: T.hD, fingerprint: hp })).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(decideMatch(mkDeps(), owner, { decision: 'confirm', outflowId: T.hD, inflowId: T.hP, fingerprint: hp })).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(decideMatch(mkDeps(), owner, { decision: 'confirm', outflowId: T.gO, inflowId: T.gI, fingerprint: pairFingerprint({ id: T.gO, providerAccountRef: w.accounts.chk.ref, amountMinor: 6000, date: '2026-09-20', pending: true }, { id: T.gI, providerAccountRef: w.accounts.sav.ref, amountMinor: -6000, date: '2026-09-20', pending: true }) })).rejects.toMatchObject({ code: 'conflict' })
    // a removed leg
    const gone = await w.tx('chk', 11, '2026-09-24', 'ONLINE TRANSFER'); const goneI = await w.tx('sav', -11, '2026-09-24', 'ONLINE TRANSFER')
    await w.q(`UPDATE public.financial_provider_transactions SET removed_at = now() WHERE id = $1`, [goneI])
    await expect(decideMatch(mkDeps(), owner, { decision: 'confirm', outflowId: gone, inflowId: goneI, fingerprint: pairFingerprint({ id: gone, providerAccountRef: w.accounts.chk.ref, amountMinor: 1100, date: '2026-09-24', pending: false }, { id: goneI, providerAccountRef: w.accounts.sav.ref, amountMinor: -1100, date: '2026-09-24', pending: false }) })).rejects.toMatchObject({ code: expect.stringMatching(/conflict|not_found/) })
  })

  it('without the reviewed SQL the review is readable but cannot decide, and says why', async () => {
    const bare = await buildWorld(PGlite, types, { matchSql: false })
    try {
      const o = await bare.tx('chk', 500, '2026-09-05', 'ONLINE TRANSFER'), i = await bare.tx('sav', -500, '2026-09-05', 'ONLINE TRANSFER')
      const deps = { repo: createSpendingRepo(bare.svc), environment: 'production', now: () => NOW, reconciliationEnabled: true }
      const r = await getMatchReview(deps, owner, { from: '2026-07-01', to: '2026-10-11' })
      expect(r).toMatchObject({ enabled: true, decisionsAvailable: false }); expect(r.items).toHaveLength(1)
      await expect(decideMatch(deps, owner, { decision: 'confirm', outflowId: o, inflowId: i, fingerprint: r.items[0].fingerprint })).rejects.toMatchObject({ code: 'persistence_failed', httpStatus: 503 })
      expect((await bare.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n).toBe(0)
    } finally { await bare.db.close() }
  })

  it('through the real HTTP handler: the organization comes from the profile, ids and a fingerprint are all the browser sends, and the payload carries no user or organization id', async () => {
    const saved = { ...process.env }
    process.env.PLAID_ENV = 'production'; process.env.CASH_OS_RECONCILIATION_ENABLED = 'true'
    try {
      const overrides = (role = 'owner', org = ORG) => ({ verifyUser: async () => ({ id: OWNER_ID }), userClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: org, role, is_active: true } }) }) }) }) }),
        serviceClient: () => w.svc, now: () => NOW })
      const call = (method, body?, q?, o = overrides()) => buildHandler(o)({ httpMethod: method, headers: { authorization: 'Bearer t' }, queryStringParameters: q, body: body === undefined ? undefined : JSON.stringify(body) })
      const list = await call('GET', undefined, { matches: '1', tab: 'review', from: '2026-07-01', to: '2026-10-11' })
      expect(list.statusCode).toBe(200)
      const text = list.body
      expect(text).not.toContain(ORG); expect(text).not.toContain(OWNER_ID)
      const body = JSON.parse(text)
      const f = body.items.find(i => i.outflow.id === T.fO)
      expect(f).toBeUndefined() // F was rejected earlier and is not in the to-review list
      const d = body.items.find(i => i.outflow.id === T.dO)
      const res = await call('POST', { action: 'match_confirm', outflowId: T.dO, inflowId: T.dI, fingerprint: d.fingerprint, organizationId: ORG_B, userId: OWNER_B_ID })
      expect(res.statusCode).toBe(200); expect(JSON.parse(res.body)).toMatchObject({ outcome: 'confirmed' })
      expect((await w.q(`SELECT DISTINCT organization_id, decided_by FROM public.financial_provider_interpretations WHERE provider_transaction_ref = $1 AND status = 'confirmed'`, [T.dO]))).toEqual([{ organization_id: ORG, decided_by: OWNER_ID }]) // the body's organization and user were ignored
      expect((await call('POST', { action: 'match_reverse', outflowId: T.dO, inflowId: T.dI })).statusCode).toBe(200)
      expect((await call('POST', { action: 'match_confirm', outflowId: T.dO, inflowId: T.dI, fingerprint: d.fingerprint + 'x' })).statusCode).toBe(409)
      expect((await call('POST', { action: 'match_confirm', outflowId: T.dO }, undefined, overrides('employee'))).statusCode).toBe(403)
      expect((await call('GET', undefined, { matches: '1' }, overrides('employee'))).statusCode).toBe(403)
      delete process.env.CASH_OS_RECONCILIATION_ENABLED
      expect(JSON.parse((await call('GET', undefined, { matches: '1' })).body)).toEqual({ enabled: false, decisionsAvailable: false })
      expect((await call('POST', { action: 'match_reverse', outflowId: T.dO, inflowId: T.dI })).statusCode).toBe(403)
    } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved) }
  })

  it('through all of this only interpretation rows changed: evidence, ledger, Cash OS accounts and mappings are exactly as they were', async () => {
    // evidence dates were edited by the tests above to simulate bank changes; re-read the invariant on everything else
    const now = JSON.parse(await w.untouched()), was = JSON.parse(pristine)
    expect(now.ledger).toBe(was.ledger); expect(now.accounts).toEqual(was.accounts); expect(now.maps).toEqual(was.maps)
  })
})
