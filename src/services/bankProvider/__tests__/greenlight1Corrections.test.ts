// @ts-nocheck -- real SQL world (PGlite) through the real repositories
/**
 * GREENLIGHT-1 corrections, on every bank migration production carries + the BANK-6G report source + the plaid3b pair function:
 *  D-1  a refund decision in the Matches review is always about the category 'refund', even when the Explorer suggests something else for the row
 *       (a PayPal refund worded "TRANSFER" is suggested as 'transfers'; it used to be saved as 'transfers' while the screen said "Confirmed as a refund").
 *  D-3  undo only reports "undone" when something was undone.
 *  B-2  reversing a pair is limited to this server's Plaid environment, like confirm and reject.
 *  All of it is reconciliation-only: with the switch off nothing is reachable and nothing is written.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decideRefund, getExplorer } from '../spending/spendingService'
import { createSpendingRepo } from '../spending/spendingRepo'
import { decideMatch, getMatchReview } from '../spending/matchReviewService'
import { NOW, ORG, OWNER_ID, buildWorld } from './helpers/spendingWorld'

const PG = await import('@electric-sql/pglite').catch(() => null)
const owner = { organizationId: ORG, userId: OWNER_ID, role: 'owner' }
const WINDOW = { from: '2026-07-01', to: '2026-10-11' }

describe.runIf(!!PG)('GREENLIGHT-1 corrections (real SQL)', () => {
  let w
  const T: Record<string, string> = {}
  const deps = (over = {}) => ({ repo: createSpendingRepo(w.svc), environment: 'production', now: () => NOW, reconciliationEnabled: true, ...over })
  const stored = (id: string) => w.q(`SELECT category, status FROM public.financial_provider_interpretations WHERE provider_transaction_ref = $1 AND kind = 'category' ORDER BY created_at, id`, [id])
  const card = async (id: string) => (await getMatchReview(deps(), owner, { tab: 'all', ...WINDOW })).refunds.find(r => r.refund.id === id)
  const explorerBucket = async (id: string) => (await getExplorer(deps(), owner, { accounts: 'all', from: WINDOW.from, limit: 200, view: 'all' })).rows.find(r => r.id === id)?.bucket
  const err = async (p: Promise<unknown>) => { try { await p; return null } catch (e) { return { status: e.httpStatus, code: e.code, message: e.message } } }

  beforeAll(async () => {
    w = await buildWorld(PG.PGlite, PG.types)
    // a tool bought through PayPal and refunded through PayPal to the same checking account: the refund's wording looks like a transfer
    T.p = await w.tx('chk', 120, '2026-09-01', 'PAYPAL INST XFER ACME TOOLS', { merchant: 'PayPal' }); T.r = await w.tx('chk', -120, '2026-09-10', 'PAYPAL TRANSFER', { merchant: 'PayPal' })
    T.p3 = await w.tx('chk', 75, '2026-09-03', 'PAYPAL INST XFER SPARKY SUPPLY', { merchant: 'PayPal' }); T.r3 = await w.tx('chk', -75, '2026-09-12', 'PAYPAL TRANSFER', { merchant: 'PayPal' })
    // a checking -> savings move for the environment check
    T.o = await w.tx('chk', 500, '2026-09-15', 'ONLINE TRANSFER TO SAVINGS'); T.i = await w.tx('sav', -500, '2026-09-15', 'ONLINE TRANSFER FROM CHECKING')
  }, 180_000)
  afterAll(async () => { await w?.db?.close?.() })

  it('D-1: the reproduction holds (the Explorer suggests something other than refund for this row, while Matches offers it as a refund)', async () => {
    expect((await card(T.r))?.state).toBe('suggested')
    const b = await explorerBucket(T.r)
    expect(b?.state).toBe('suggested'); expect(b?.key).not.toBe('refund')
  })

  it('D-1: "Confirm refund" saves the category refund (owner decision), the card becomes confirmed, and the Explorer shows Refund', async () => {
    expect(await decideRefund(deps(), owner, { decision: 'confirm', transactionId: T.r })).toEqual({ outcome: 'created' })
    expect(await stored(T.r)).toEqual([{ category: 'refund', status: 'confirmed' }])
    expect((await card(T.r))?.state).toBe('confirmed')
    expect(await explorerBucket(T.r)).toMatchObject({ key: 'refund', state: 'confirmed' })
    expect(await decideRefund(deps(), owner, { decision: 'confirm', transactionId: T.r })).toEqual({ outcome: 'unchanged' })   // idempotent
  })

  it('D-1: "Not a refund" rejects the category refund itself, never the unrelated Explorer suggestion; repeating it changes nothing', async () => {
    const suggestionBefore = await explorerBucket(T.r3)
    expect(await decideRefund(deps(), owner, { decision: 'reject', transactionId: T.r3 })).toEqual({ outcome: 'rejected' })
    expect(await stored(T.r3)).toEqual([{ category: 'refund', status: 'rejected' }])
    expect((await card(T.r3))?.state).toBe('rejected')
    expect(await explorerBucket(T.r3)).toEqual(suggestionBefore)                                       // the transfer suggestion is untouched
    expect(await decideRefund(deps(), owner, { decision: 'reject', transactionId: T.r3 })).toEqual({ outcome: 'unchanged' })
    expect(await stored(T.r3)).toHaveLength(1)
  })

  it('D-3: undo on a "not a refund" says nothing was undone; the owner can still confirm it IS a refund, and undo that', async () => {
    expect(await decideRefund(deps(), owner, { decision: 'undo', transactionId: T.r3 })).toEqual({ outcome: 'nothing_to_undo' })
    expect(await decideRefund(deps(), owner, { decision: 'confirm', transactionId: T.r3 })).toEqual({ outcome: 'created' })
    expect((await card(T.r3))?.state).toBe('confirmed')
    expect(await decideRefund(deps(), owner, { decision: 'undo', transactionId: T.r3 })).toEqual({ outcome: 'undone' })
    expect((await card(T.r3))?.state).toBe('rejected')                                                  // the earlier rejection is history again
  })

  it('D-1: "Not a refund" never overrides a category the owner chose; a refund on money going out is refused', async () => {
    expect(await err(decideRefund(deps(), owner, { decision: 'reject', transactionId: T.r }))).toMatchObject({ status: 409 })   // T.r is a confirmed refund
    expect(await err(decideRefund(deps(), owner, { decision: 'confirm', transactionId: T.p }))).toMatchObject({ status: 400 })  // a purchase is not a refund
    expect(await stored(T.p)).toEqual([])
  })

  it('refund decisions need the reconciliation switch: OFF -> 403 before anything is read or written', async () => {
    const before = await w.q(`SELECT count(*)::int AS n FROM public.financial_provider_interpretations`)
    for (const decision of ['confirm', 'reject', 'undo']) expect(await err(decideRefund(deps({ reconciliationEnabled: false }), owner, { decision, transactionId: T.p3 }))).toMatchObject({ status: 403, code: 'feature_disabled' })
    expect(await w.q(`SELECT count(*)::int AS n FROM public.financial_provider_interpretations`)).toEqual(before)
  })

  it('B-2: a server configured for another Plaid environment cannot reverse this environment\'s pair', async () => {
    const item = (await getMatchReview(deps(), owner, { tab: 'all', ...WINDOW })).items.find(x => x.outflow.id === T.o && x.inflow.id === T.i)
    expect(item).toBeTruthy()
    expect(await decideMatch(deps(), owner, { decision: 'confirm', outflowId: T.o, inflowId: T.i, fingerprint: item.fingerprint })).toMatchObject({ outcome: 'confirmed' })
    expect(await err(decideMatch(deps({ environment: 'sandbox' }), owner, { decision: 'reverse', outflowId: T.o, inflowId: T.i }))).toMatchObject({ status: 404 })
    expect(await w.q(`SELECT count(*)::int AS n FROM public.financial_provider_interpretations WHERE kind = 'transfer' AND status = 'confirmed' AND provider_transaction_ref = ANY($1)`, [[T.o, T.i]])).toEqual([{ n: 2 }])
    expect(await decideMatch(deps(), owner, { decision: 'reverse', outflowId: T.o, inflowId: T.i })).toMatchObject({ outcome: 'reversed' })   // the right server still can
  })
})
