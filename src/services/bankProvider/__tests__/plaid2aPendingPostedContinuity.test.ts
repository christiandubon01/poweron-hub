// @ts-nocheck -- direct SQL against PGlite
/**
 * PLAID-2A / Track B: pending-to-posted continuity (docs/plaid2/pending-posted-continuity-proposal.sql) on PostgreSQL (PGlite) with every bank
 * migration production carries (153-158). Pins: deterministic linkage, safe inheritance of confirmed decisions, never overwriting a newer owner
 * decision, ambiguity handling, idempotency, out-of-order arrival, evidence immutability and organization isolation.
 */
import { performance } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_ID, EMPLOYEE_ID, ORG, ORG_B, OWNER_ID, addTx, asUser, createDb, loadPglite, makeItem, rows } from './helpers/pgliteHarness'

const PGlite = await loadPglite()
const DRAFT = 'docs/plaid2/pending-posted-continuity-proposal.sql'

describe.runIf(!!PGlite)('PLAID-2A pending-to-posted continuity (PGlite)', () => {
  let db
  beforeAll(async () => { db = await createDb(PGlite, [DRAFT]) }, 120_000)
  afterAll(async () => { await db?.close?.() })

  const decide = (tx, category = 'materials', dimension = 'bucket', kind = 'category') =>
    rows(db, `SELECT * FROM public.financial_provider_replace_interpretation($1,$2,$3,$4,$5,'owner','high','{}'::jsonb,$6)`, [ORG, OWNER_ID, tx, dimension, kind, dimension === 'bucket' ? category : null]).then(r => r[0])
  const link = (item, org = ORG) => rows(db, `SELECT * FROM public.financial_provider_link_pending_posted($1,$2)`, [org, item.id]).then(r => r[0])
  const active = (tx, kind = 'category') => rows(db, `SELECT id, status, source, category, decided_by, suggestion_basis, undo_reason FROM public.financial_provider_interpretations WHERE provider_transaction_ref = $1 AND kind = $2 ORDER BY created_at, id`, [tx, kind])
  const removePending = tx => rows(db, `UPDATE public.financial_provider_transactions SET removed_at = now() WHERE id = $1`, [tx])
  const linkRow = posted => rows(db, `SELECT status, reason, pending_ref, inherited_count FROM public.financial_provider_pending_posted_links WHERE posted_ref = $1`, [posted]).then(r => r[0])
  const evidenceHash = item => rows(db, `SELECT md5(string_agg(concat_ws('|', provider_transaction_id, pending, pending_provider_transaction_id, provider_amount_minor, transaction_date, name, merchant_name, provider_account_ref), ',' ORDER BY provider_transaction_id)) AS h
    FROM public.financial_provider_transactions WHERE provider_item_ref = $1`, [item.id]).then(r => r[0].h)

  it('carries a confirmed category from the pending row to its posted replacement, with provenance, and leaves the pending decision alone', async () => {
    const item = await makeItem(db)
    const pend = await addTx(db, item, 'card', { pending: true, pid: 'P1', amount: 80 })
    await decide(pend, 'materials')
    const posted = await addTx(db, item, 'card', { pid: 'Q1', pendingPid: 'P1', amount: 82.5 })
    await removePending(pend)
    const before = await evidenceHash(item)
    expect(await link(item)).toMatchObject({ linked_count: 1, inherited_count: 1, ambiguous_count: 0 })
    const got = await active(posted)
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ status: 'confirmed', source: 'owner', category: 'materials', decided_by: OWNER_ID })
    expect(got[0].suggestion_basis).toMatchObject({ inherited_from_pending_transaction: pend, pending_provider_transaction_id: 'P1' })
    expect((await active(pend))[0]).toMatchObject({ status: 'confirmed', category: 'materials' }) // the pending row keeps its history
    expect(await linkRow(posted)).toMatchObject({ status: 'linked', pending_ref: pend, inherited_count: 1 })
    expect(await evidenceHash(item)).toBe(before) // no provider fact changed
  })

  it('is idempotent: a second and third run create nothing', async () => {
    const item = await makeItem(db)
    const pend = await addTx(db, item, 'chk', { pending: true, pid: 'P2' }); await decide(pend, 'fuel')
    const posted = await addTx(db, item, 'chk', { pid: 'Q2', pendingPid: 'P2' })
    await link(item)
    const r2 = await link(item), r3 = await link(item)
    expect(r2.inherited_count).toBe(0); expect(r3.inherited_count).toBe(0)
    expect(await active(posted)).toHaveLength(1)
    expect((await linkRow(posted)).inherited_count).toBe(1)
  })

  it('never overwrites a confirmed decision the posted row already has', async () => {
    const item = await makeItem(db)
    const pend = await addTx(db, item, 'card', { pending: true, pid: 'P3' }); await decide(pend, 'materials')
    const posted = await addTx(db, item, 'card', { pid: 'Q3', pendingPid: 'P3' })
    await decide(posted, 'fuel')
    expect(await link(item)).toMatchObject({ inherited_count: 0, skipped_count: 1 })
    const got = await active(posted)
    expect(got.filter(r => r.status === 'confirmed')).toHaveLength(1)
    expect(got.find(r => r.status === 'confirmed').category).toBe('fuel')
  })

  it('does not resurrect a decision the owner undid on the posted row afterwards', async () => {
    const item = await makeItem(db)
    const pend = await addTx(db, item, 'card', { pending: true, pid: 'P4' }); await decide(pend, 'materials')
    const posted = await addTx(db, item, 'card', { pid: 'Q4', pendingPid: 'P4' })
    await link(item)
    const inherited = (await active(posted))[0]
    await rows(db, `UPDATE public.financial_provider_interpretations SET status = 'undone', undo_reason = 'owner_undo' WHERE id = $1`, [inherited.id])
    await link(item)
    const got = await active(posted)
    expect(got).toHaveLength(1)
    expect(got[0].status).toBe('undone')
  })

  it('a newer explicit owner decision on the posted row beats the older pending decision', async () => {
    const item = await makeItem(db)
    const pend = await addTx(db, item, 'card', { pending: true, pid: 'P5' }); await decide(pend, 'materials')
    const posted = await addTx(db, item, 'card', { pid: 'Q5', pendingPid: 'P5' })
    await decide(posted, 'tools')
    await rows(db, `UPDATE public.financial_provider_interpretations SET status = 'undone', undo_reason = 'owner_undo' WHERE provider_transaction_ref = $1 AND status = 'confirmed'`, [posted])
    await link(item)
    expect((await active(posted)).filter(r => r.status === 'confirmed')).toHaveLength(0)
  })

  it('two posted rows claiming one pending id are both ambiguous and inherit nothing', async () => {
    const item = await makeItem(db)
    const pend = await addTx(db, item, 'card', { pending: true, pid: 'P6', amount: 100 }); await decide(pend, 'materials')
    const a = await addTx(db, item, 'card', { pid: 'Q6a', pendingPid: 'P6', amount: 60 })
    const b = await addTx(db, item, 'card', { pid: 'Q6b', pendingPid: 'P6', amount: 40 })
    expect(await link(item)).toMatchObject({ ambiguous_count: 2, linked_count: 0, inherited_count: 0 })
    expect(await linkRow(a)).toMatchObject({ status: 'ambiguous', reason: 'MULTIPLE_POSTED_CLAIM_PENDING' })
    expect(await active(a)).toHaveLength(0); expect(await active(b)).toHaveLength(0)
    // The ambiguity resolves itself when one claimant is removed by Plaid.
    await removePending(b)
    await link(item)
    expect((await linkRow(a)).status).toBe('linked')
    expect((await active(a))[0]).toMatchObject({ status: 'confirmed', category: 'materials' })
  })

  it('refuses a link across accounts or opposite money directions', async () => {
    const item = await makeItem(db)
    const p1 = await addTx(db, item, 'chk', { pending: true, pid: 'P7a', amount: 50 }); await decide(p1, 'materials')
    const q1 = await addTx(db, item, 'sav', { pid: 'Q7a', pendingPid: 'P7a', amount: 50 })
    const p2 = await addTx(db, item, 'chk', { pending: true, pid: 'P7b', amount: 50 }); await decide(p2, 'materials')
    const q2 = await addTx(db, item, 'chk', { pid: 'Q7b', pendingPid: 'P7b', amount: -50 })
    expect(await link(item)).toMatchObject({ mismatch_count: 2, inherited_count: 0 })
    expect(await linkRow(q1)).toMatchObject({ status: 'mismatch', reason: 'ACCOUNT_DIFFERS' })
    expect(await linkRow(q2)).toMatchObject({ status: 'mismatch', reason: 'DIRECTION_DIFFERS' })
    expect(await active(q1)).toHaveLength(0); expect(await active(q2)).toHaveLength(0)
  })

  it('out of order: a posted row seen before its pending row is unresolved, then links when the pending row arrives', async () => {
    const item = await makeItem(db)
    const posted = await addTx(db, item, 'card', { pid: 'Q8', pendingPid: 'P8' })
    expect(await link(item)).toMatchObject({ unresolved_count: 1, inherited_count: 0 })
    expect(await linkRow(posted)).toMatchObject({ status: 'unresolved', reason: 'PENDING_NOT_IN_EVIDENCE', pending_ref: null })
    const pend = await addTx(db, item, 'card', { pending: true, pid: 'P8' }); await decide(pend, 'meals')
    await link(item)
    expect(await linkRow(posted)).toMatchObject({ status: 'linked', pending_ref: pend })
    expect((await active(posted))[0].category).toBe('meals')
  })

  it('a decision made on the pending row after the first evaluation is inherited by the next run', async () => {
    const item = await makeItem(db)
    const pend = await addTx(db, item, 'card', { pending: true, pid: 'P9' })
    const posted = await addTx(db, item, 'card', { pid: 'Q9', pendingPid: 'P9' })
    expect(await link(item)).toMatchObject({ linked_count: 1, inherited_count: 0 })
    await decide(pend, 'insurance')
    await link(item)
    expect((await active(posted))[0]).toMatchObject({ status: 'confirmed', category: 'insurance' })
  })

  it('an unmodified inherited copy follows a changed pending decision; the old copy is retired, not edited', async () => {
    const item = await makeItem(db)
    const pend = await addTx(db, item, 'card', { pending: true, pid: 'P10' }); await decide(pend, 'materials')
    const posted = await addTx(db, item, 'card', { pid: 'Q10', pendingPid: 'P10' })
    await link(item)
    await decide(pend, 'tools') // retires the first pending decision, confirms a new one (newer decided_at)
    await link(item)
    const got = await active(posted)
    expect(got.filter(r => r.status === 'confirmed').map(r => r.category)).toEqual(['tools'])
    expect(got.find(r => r.status === 'undone')).toMatchObject({ category: 'materials', undo_reason: 'pending_decision_changed' })
  })

  it('supersedes an unreviewed suggestion but never a confirmed decision', async () => {
    const item = await makeItem(db)
    const pend = await addTx(db, item, 'card', { pending: true, pid: 'P11' }); await decide(pend, 'materials')
    const posted = await addTx(db, item, 'card', { pid: 'Q11', pendingPid: 'P11' })
    await rows(db, `INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, category) VALUES ($1,$2,'category','suggested','system_suggestion','possible','fuel')`, [ORG, posted])
    await link(item)
    const got = await active(posted)
    expect(got.map(r => `${r.status}:${r.category}`).sort()).toEqual(['confirmed:materials', 'undone:fuel'])
  })

  it('inherits an ignore decision; relationship decisions are never inherited', async () => {
    const item = await makeItem(db)
    const pend = await addTx(db, item, 'chk', { pending: true, pid: 'P12' })
    await decide(pend, null, 'ignore', 'ignored')
    const posted = await addTx(db, item, 'chk', { pid: 'Q12', pendingPid: 'P12' })
    await link(item)
    expect((await active(posted, 'ignored'))[0]).toMatchObject({ status: 'confirmed' })
    // a pending row cannot hold a relationship decision at all
    await expect(decide(pend, null, 'relationship', 'personal')).rejects.toThrow(/INTERPRETATION_PENDING_RELATIONSHIP/)
  })

  it('three accounts at once: each posted row inherits only from its own pending row', async () => {
    const item = await makeItem(db, ORG, ['chk', 'sav', 'card'])
    const specs = [['chk', 'fuel'], ['sav', 'insurance'], ['card', 'materials']]
    const posted = {}
    for (const [acct, cat] of specs) {
      const p = await addTx(db, item, acct, { pending: true, pid: `PP-${acct}` }); await decide(p, cat)
      posted[acct] = await addTx(db, item, acct, { pid: `QQ-${acct}`, pendingPid: `PP-${acct}` })
    }
    expect(await link(item)).toMatchObject({ linked_count: 3, inherited_count: 3 })
    for (const [acct, cat] of specs) expect((await active(posted[acct]))[0].category).toBe(cat)
  })

  it('ignores posted rows Plaid has removed', async () => {
    const item = await makeItem(db)
    const pend = await addTx(db, item, 'card', { pending: true, pid: 'P14' }); await decide(pend, 'materials')
    const posted = await addTx(db, item, 'card', { pid: 'Q14', pendingPid: 'P14' })
    await removePending(posted)
    expect(await link(item)).toMatchObject({ linked_count: 0, inherited_count: 0 })
    expect(await linkRow(posted)).toBeUndefined()
  })

  it('organization isolation: another organization cannot evaluate this Item, and its rows never inherit', async () => {
    const item = await makeItem(db)
    await expect(link(item, ORG_B)).rejects.toThrow(/CONTINUITY_ITEM_NOT_FOUND/)
    const itemB = await makeItem(db, ORG_B)
    const pend = await addTx(db, itemB, 'card', { pending: true, pid: 'PB' })
    await rows(db, `SELECT * FROM public.financial_provider_replace_interpretation($1,$2,$3,'bucket','category','owner','high','{}'::jsonb,'materials')`, [ORG_B, 'b0000000-0000-4000-8000-000000000004', pend])
    const postedB = await addTx(db, itemB, 'card', { pid: 'QB', pendingPid: 'PB' })
    await link(itemB, ORG_B)
    expect((await active(postedB))[0].category).toBe('materials')
    const seen = await asUser(db, ADMIN_ID, () => rows(db, `SELECT count(*)::int AS n FROM public.financial_provider_pending_posted_links`))
    expect(seen[0].n).toBeGreaterThan(0)
    expect((await asUser(db, ADMIN_ID, () => rows(db, `SELECT count(*)::int AS n FROM public.financial_provider_pending_posted_links WHERE organization_id = $1`, [ORG_B])))[0].n).toBe(0)
  })

  it('permissions: employees and browser roles read nothing, cannot call the function, and cannot write links', async () => {
    const item = await makeItem(db)
    expect((await asUser(db, EMPLOYEE_ID, () => rows(db, `SELECT count(*)::int AS n FROM public.financial_provider_pending_posted_links`)))[0].n).toBe(0)
    await expect(asUser(db, ADMIN_ID, () => rows(db, `SELECT * FROM public.financial_provider_link_pending_posted($1,$2)`, [ORG, item.id]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, ADMIN_ID, () => rows(db, `INSERT INTO public.financial_provider_pending_posted_links (organization_id, provider_item_ref, posted_ref, pending_provider_transaction_id, status) VALUES ($1,$2,gen_random_uuid(),'x','unresolved')`, [ORG, item.id]))).rejects.toThrow(/permission denied/)
  })

  it('links cannot be deleted and their identity cannot be rewritten', async () => {
    const item = await makeItem(db)
    const posted = await addTx(db, item, 'card', { pid: 'Q17', pendingPid: 'P17' })
    await link(item)
    await expect(rows(db, `DELETE FROM public.financial_provider_pending_posted_links WHERE posted_ref = $1`, [posted])).rejects.toThrow(/append-only/)
    await expect(rows(db, `UPDATE public.financial_provider_pending_posted_links SET pending_provider_transaction_id = 'other' WHERE posted_ref = $1`, [posted])).rejects.toThrow(/immutable/)
  })

  it('stays fast: 3,000 linked pairs evaluate and inherit in one bounded call, and a rerun is cheap', async () => {
    const item = await makeItem(db)
    await rows(db, `INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, currency, transaction_date, name)
      SELECT $1,$2,$3,'BP' || g, true, 10, 1000, 'USD', DATE '2026-09-01', 'N' FROM generate_series(1,3000) g`, [ORG, item.id, item.accounts.chk])
    await rows(db, `INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, category, decided_by, decided_at)
      SELECT $1, t.id, 'category', 'confirmed', 'owner', 'high', 'materials', $2, now() - interval '1 day' FROM public.financial_provider_transactions t WHERE t.provider_item_ref = $3 AND t.pending`, [ORG, OWNER_ID, item.id])
    await rows(db, `UPDATE public.financial_provider_transactions SET removed_at = now() WHERE provider_item_ref = $1 AND pending`, [item.id])
    await rows(db, `INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, pending_provider_transaction_id, provider_amount, provider_amount_minor, currency, transaction_date, name)
      SELECT $1,$2,$3,'BQ' || g, false, 'BP' || g, 10, 1000, 'USD', DATE '2026-09-02', 'N' FROM generate_series(1,3000) g`, [ORG, item.id, item.accounts.chk])
    await db.exec('ANALYZE') // a bulk-loaded scratch database has no planner statistics; production autovacuum provides them
    const t0 = performance.now()
    let linked = 0, inherited = 0, calls = 0
    for (;;) { // each call is bounded (at most 2,000 rows); the sync step simply calls again while work remains
      const r = await rows(db, `SELECT * FROM public.financial_provider_link_pending_posted($1,$2,2000)`, [ORG, item.id]).then(x => x[0])
      calls += 1; linked += r.linked_count; inherited += r.inherited_count
      if (r.linked_count + r.ambiguous_count + r.unresolved_count + r.mismatch_count === 0) break
    }
    const first = performance.now() - t0
    expect({ linked, inherited }).toEqual({ linked: 3000, inherited: 3000 })
    const t1 = performance.now()
    expect((await rows(db, `SELECT * FROM public.financial_provider_link_pending_posted($1,$2,2000)`, [ORG, item.id]))[0]).toMatchObject({ linked_count: 0, inherited_count: 0 })
    const rerun = performance.now() - t1
    console.log('PLAID-2A continuity timings (ms): 3000 pairs in', calls, 'calls', Math.round(first), 'rerun', Math.round(rerun))
    expect(rerun).toBeLessThan(2_000) // settled links are not re-read
  }, 120_000)
})
