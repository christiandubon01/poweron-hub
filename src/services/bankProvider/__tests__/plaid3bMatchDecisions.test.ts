// @ts-nocheck -- direct SQL against PGlite
/**
 * PLAID-3B: docs/plaid2/match-decisions-proposal.sql on PostgreSQL (PGlite) with every bank migration production carries (153-158).
 * Lifecycle (confirm / reject / reverse / reconfirm), idempotency, structural validation, evidence-fingerprint binding, owner-decision precedence,
 * organization isolation, privileges, and that nothing but interpretation rows ever changes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pairFingerprint } from '../spending/reconciliation'
import { ADMIN_ID, EMPLOYEE_ID, ORG, ORG_B, OWNER_B_ID, OWNER_ID, addTx, asUser, createDb, loadPglite, makeItem, rows } from './helpers/pgliteHarness'

const PGlite = await loadPglite()
const DRAFT = 'docs/plaid2/match-decisions-proposal.sql'

describe.runIf(!!PGlite)('PLAID-3B match decisions (PGlite)', () => {
  let db
  beforeAll(async () => { db = await createDb(PGlite, [DRAFT]) }, 120_000)
  afterAll(async () => { await db?.close?.() })

  const tx = (id) => rows(db, `SELECT id, provider_account_ref AS "providerAccountRef", provider_amount_minor::int AS "amountMinor", to_char(transaction_date,'YYYY-MM-DD') AS date, pending FROM public.financial_provider_transactions WHERE id = $1`, [id]).then(r => r[0])
  const fp = async (o, i) => pairFingerprint(await tx(o), await tx(i))
  const decide = (action, o, i, { kind = 'internal_transfer', fingerprint, org = ORG, actor = OWNER_ID, basis = {} } = {}) =>
    rows(db, `SELECT * FROM public.financial_provider_decide_match($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [org, actor, action, o, i, kind, fingerprint ?? null, JSON.stringify(basis)]).then(r => r[0])
  const confirm = async (o, i, over = {}) => decide('confirm', o, i, { fingerprint: await fp(o, i), ...over })
  const reject = async (o, i, over = {}) => decide('reject', o, i, { fingerprint: await fp(o, i), ...over })
  const reverse = (o, i, over = {}) => decide('reverse', o, i, over)
  const trows = (...ids) => rows(db, `SELECT provider_transaction_ref AS tx, kind, status, source, counterpart_provider_transaction_ref AS cp, undo_reason, decided_by, undone_by, suggestion_basis AS basis FROM public.financial_provider_interpretations WHERE provider_transaction_ref = ANY($1) AND kind = 'transfer' ORDER BY created_at, id`, [ids])
  const fingerprintOfWorld = () => rows(db, `SELECT (SELECT md5(string_agg(concat_ws('|', id, provider_amount_minor, transaction_date, pending, removed_at, name), ',' ORDER BY id)) FROM public.financial_provider_transactions) AS ev,
    (SELECT count(*)::int FROM public.financial_transactions) AS ledger, (SELECT count(*)::int FROM public.financial_accounts) AS accounts, (SELECT count(*)::int FROM public.financial_provider_account_mappings) AS maps`).then(r => r[0])
  /** a fresh checking -> savings pair (and a card pair when asked) */
  async function pair(kind = 'bank', org = ORG, over = {}) {
    const item = await makeItem(db, org, ['chk', 'sav', 'card'])
    const o = await addTx(db, item, 'chk', { amount: over.amount ?? 500, date: over.date ?? '2026-09-10', name: 'ONLINE TRANSFER', pending: over.pendingO ?? false })
    const i = await addTx(db, item, kind === 'card' ? 'card' : 'sav', { amount: -(over.amount ?? 500), date: over.dateI ?? '2026-09-10', name: kind === 'card' ? 'PAYMENT THANK YOU' : 'ONLINE TRANSFER', pending: over.pendingI ?? false })
    return { item, o, i, kind: kind === 'card' ? 'card_payment' : 'internal_transfer' }
  }

  it('probe reports availability without touching data or needing arguments', async () => {
    expect(await rows(db, `SELECT * FROM public.financial_provider_decide_match(NULL, NULL, 'probe')`).then(r => r[0])).toMatchObject({ outcome: 'available' })
  })

  it('confirm writes both legs in one step, each naming the other, bound to the reviewed evidence; nothing else changes', async () => {
    const p = await pair()
    const before = await fingerprintOfWorld()
    const out = await confirm(p.o, p.i, { kind: p.kind, basis: { confidence: 'high', reasons: ['x'], pair_id: 'forged', fingerprint: 'forged', role: 'forged', mode: 'forged' } })
    expect(out.outcome).toBe('confirmed'); expect(out.pair_id).toMatch(/^[0-9a-f-]{36}$/)
    const got = await trows(p.o, p.i)
    expect(got).toHaveLength(2)
    expect(got.find(r => r.tx === p.o)).toMatchObject({ status: 'confirmed', source: 'owner', cp: p.i, decided_by: OWNER_ID })
    expect(got.find(r => r.tx === p.i)).toMatchObject({ status: 'confirmed', source: 'owner', cp: p.o })
    for (const r of got) expect(r.basis).toMatchObject({ mode: 'pair_review', pair_id: out.pair_id, pair_kind: 'internal_transfer', fingerprint: await fp(p.o, p.i), confidence: 'high' }) // client-supplied keys cannot override the recorded ones
    expect(got.map(r => r.basis.role).sort()).toEqual(['inflow', 'outflow'])
    const after = await fingerprintOfWorld()
    expect(after).toEqual({ ...before })
  })

  it('is idempotent: repeating a confirm or a reject changes nothing', async () => {
    const p = await pair()
    const a = await confirm(p.o, p.i), b = await confirm(p.o, p.i)
    expect(a.outcome).toBe('confirmed'); expect(b).toMatchObject({ outcome: 'unchanged', pair_id: a.pair_id })
    expect(await trows(p.o, p.i)).toHaveLength(2)
    const q = await pair()
    const r1 = await reject(q.o, q.i), r2 = await reject(q.o, q.i)
    expect(r1.outcome).toBe('rejected'); expect(r2).toMatchObject({ outcome: 'unchanged', pair_id: r1.pair_id })
    expect(await trows(q.o, q.i)).toHaveLength(1)
  })

  it('a card payment needs a credit-card receiver; a plain transfer may not end on a card', async () => {
    const c = await pair('card')
    expect(await confirm(c.o, c.i, { kind: 'internal_transfer' })).toMatchObject({ outcome: 'invalid_pair', detail: 'KIND' })
    expect((await confirm(c.o, c.i, { kind: 'card_payment' })).outcome).toBe('confirmed')
    const b = await pair()
    expect(await confirm(b.o, b.i, { kind: 'card_payment' })).toMatchObject({ outcome: 'invalid_pair', detail: 'KIND' })
    expect(await trows(b.o, b.i)).toHaveLength(0)
  })

  it('refuses what is not a real pair: same account, unequal amounts, same sign, too far apart, pending, removed, unknown', async () => {
    const item = await makeItem(db, ORG, ['chk', 'sav'])
    const a = await addTx(db, item, 'chk', { amount: 100 }), b = await addTx(db, item, 'chk', { amount: -100 })
    expect(await confirm(a, b)).toMatchObject({ outcome: 'invalid_pair', detail: 'SAME_ACCOUNT' })
    const c = await addTx(db, item, 'sav', { amount: -101 })
    expect(await confirm(a, c)).toMatchObject({ outcome: 'invalid_pair', detail: 'AMOUNTS' })
    const d = await addTx(db, item, 'sav', { amount: 100 })
    expect(await confirm(a, d)).toMatchObject({ outcome: 'invalid_pair', detail: 'AMOUNTS' })
    const far = await addTx(db, item, 'sav', { amount: -100, date: '2026-09-20' })
    expect(await confirm(a, far)).toMatchObject({ outcome: 'invalid_pair', detail: 'DATES' })
    const pend = await addTx(db, item, 'sav', { amount: -100, pending: true })
    expect(await confirm(a, pend)).toMatchObject({ outcome: 'pending_not_allowed' })
    const gone = await addTx(db, item, 'sav', { amount: -100 })
    await rows(db, `UPDATE public.financial_provider_transactions SET removed_at = now() WHERE id = $1`, [gone])
    expect(await confirm(a, gone)).toMatchObject({ outcome: 'evidence_changed', detail: 'LEG_UNAVAILABLE' })
    expect(await decide('confirm', a, '00000000-0000-4000-8000-000000000999', { fingerprint: 'v1|' + 'x'.repeat(30) })).toMatchObject({ outcome: 'not_found' })
    expect(await trows(a, b, c, d, far, pend, gone)).toHaveLength(0)
  })

  it('rejects malformed calls', async () => {
    const p = await pair()
    for (const args of [['bogus', p.o, p.i], ['confirm', p.o, p.o], ['confirm', null, p.i], ['confirm', p.o, null]]) await expect(decide(args[0], args[1], args[2], { fingerprint: await fp(p.o, p.i) })).rejects.toThrow(/MATCH_ARGUMENTS_INVALID/)
    await expect(decide('confirm', p.o, p.i, { kind: 'transfer', fingerprint: await fp(p.o, p.i) })).rejects.toThrow(/MATCH_ARGUMENTS_INVALID/)
    await expect(decide('confirm', p.o, p.i, { fingerprint: 'short' })).rejects.toThrow(/MATCH_ARGUMENTS_INVALID/)
    await expect(decide('confirm', p.o, p.i, { fingerprint: await fp(p.o, p.i), basis: { access_token: 'x' } })).rejects.toThrow(/MATCH_ARGUMENTS_INVALID/)
    await expect(rows(db, `SELECT * FROM public.financial_provider_decide_match(NULL, $1, 'reverse', $2, $3)`, [OWNER_ID, p.o, p.i])).rejects.toThrow(/MATCH_ARGUMENTS_INVALID/)
    expect(await trows(p.o, p.i)).toHaveLength(0)
  })

  it('binds the decision to the evidence the owner reviewed: any change since is "evidence_changed" and writes nothing', async () => {
    const p = await pair()
    const reviewed = await fp(p.o, p.i)
    await rows(db, `UPDATE public.financial_provider_transactions SET transaction_date = '2026-09-11' WHERE id = $1`, [p.i]) // the bank re-dated one leg after the owner opened the screen
    expect(await decide('confirm', p.o, p.i, { fingerprint: reviewed })).toMatchObject({ outcome: 'evidence_changed', detail: 'FINGERPRINT' })
    expect(await decide('reject', p.o, p.i, { fingerprint: reviewed })).toMatchObject({ outcome: 'evidence_changed' })
    expect(await trows(p.o, p.i)).toHaveLength(0)
    expect((await confirm(p.o, p.i)).outcome).toBe('confirmed') // on the CURRENT evidence it works
    // the TypeScript fingerprint and the SQL one are the same string
    expect(await fp(p.o, p.i)).toBe((await trows(p.o))[0].basis.fingerprint)
  })

  it('never overrides another owner decision on either leg (precedence)', async () => {
    const mk = async () => { const p = await pair(); return p }
    const decideRel = (txId, kind, extra = {}) => rows(db, `SELECT * FROM public.financial_provider_replace_interpretation($1,$2,$3,'relationship',$4,'owner','high','{}'::jsonb,NULL,$5)`, [ORG, OWNER_ID, txId, kind, extra.project ?? null])
    const cases = [
      ['personal', async p => decideRel(p.i, 'personal'), 'LEG_ALREADY_DECIDED'],
      ['overhead', async p => decideRel(p.o, 'overhead'), 'LEG_ALREADY_DECIDED'],
      ['ignored', async p => rows(db, `SELECT * FROM public.financial_provider_replace_interpretation($1,$2,$3,'ignore','ignored','owner','high','{}'::jsonb)`, [ORG, OWNER_ID, p.o]), 'LEG_IGNORED'],
      ['categorized', async p => rows(db, `SELECT * FROM public.financial_provider_replace_interpretation($1,$2,$3,'bucket','category','owner','high','{}'::jsonb,'materials')`, [ORG, OWNER_ID, p.o]), 'LEG_CATEGORIZED'],
    ]
    for (const [name, setup, detail] of cases) {
      const p = await mk(); await setup(p)
      const before = await trows(p.o, p.i), allBefore = await rows(db, `SELECT count(*)::int n FROM public.financial_provider_interpretations WHERE provider_transaction_ref = ANY($1)`, [[p.o, p.i]])
      expect(await confirm(p.o, p.i, { kind: p.kind }), name).toMatchObject({ outcome: 'conflict', detail })
      expect(await trows(p.o, p.i)).toEqual(before)
      expect(await rows(db, `SELECT count(*)::int n FROM public.financial_provider_interpretations WHERE provider_transaction_ref = ANY($1)`, [[p.o, p.i]])).toEqual(allBefore)
    }
    // a confirmed "Transfers" category is consistent with the pair and does not block it
    const ok = await mk()
    await rows(db, `SELECT * FROM public.financial_provider_replace_interpretation($1,$2,$3,'bucket','category','owner','high','{}'::jsonb,'transfers')`, [ORG, OWNER_ID, ok.o])
    expect((await confirm(ok.o, ok.i)).outcome).toBe('confirmed')
  })

  it('a leg already paired elsewhere (either way round, or by a one-leg decision on a third transaction) must be reversed first', async () => {
    const item = await makeItem(db, ORG, ['chk', 'sav', 'chk2'])
    const o = await addTx(db, item, 'chk', { amount: 700 }), i1 = await addTx(db, item, 'sav', { amount: -700 }), i2 = await addTx(db, item, 'chk2', { amount: -700 })
    expect((await confirm(o, i1)).outcome).toBe('confirmed')
    expect(await confirm(o, i2)).toMatchObject({ outcome: 'conflict', detail: 'LEG_ALREADY_PAIRED' })
    const o2 = await addTx(db, item, 'chk2', { amount: 700 })
    expect(await confirm(o2, i1)).toMatchObject({ outcome: 'conflict', detail: 'LEG_ALREADY_PAIRED' })
    expect(await reject(o, i2)).toMatchObject({ outcome: 'rejected' }) // rejecting a different pairing is fine
    // a legacy one-leg decision on a THIRD transaction that names a leg
    const z = await addTx(db, item, 'sav', { amount: -800 }), oz = await addTx(db, item, 'chk', { amount: 800 }), other = await addTx(db, item, 'chk2', { amount: 800 })
    await rows(db, `SELECT * FROM public.financial_provider_replace_interpretation($1,$2,$3,'relationship','transfer','owner','high','{}'::jsonb,NULL,NULL,NULL,NULL,NULL,$4)`, [ORG, OWNER_ID, other, z])
    expect(await confirm(oz, z)).toMatchObject({ outcome: 'conflict', detail: 'LEG_ALREADY_PAIRED' })
    expect(await trows(oz)).toHaveLength(0)
  })

  it('completes an unpaired or one-leg transfer decision and supersedes unreviewed suggestions, keeping everything as history', async () => {
    const p = await pair()
    // an unpaired "this is a transfer" on the outflow, a system suggestion on the inflow
    await rows(db, `SELECT * FROM public.financial_provider_replace_interpretation($1,$2,$3,'relationship','transfer','owner','high','{}'::jsonb,NULL,NULL,NULL,NULL,NULL,NULL)`, [ORG, OWNER_ID, p.o])
    await rows(db, `INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, counterpart_provider_transaction_ref) VALUES ($1,$2,'transfer','suggested','system_suggestion','possible',$3)`, [ORG, p.i, p.o])
    expect((await confirm(p.o, p.i)).outcome).toBe('confirmed')
    const all = await trows(p.o, p.i)
    expect(all.filter(r => r.status === 'undone').map(r => r.undo_reason).sort()).toEqual(['completed_by_pair', 'superseded_by_pair_confirmation'])
    expect(all.filter(r => r.status === 'confirmed')).toHaveLength(2)
    expect(all.filter(r => r.status === 'undone').every(r => r.undone_by === OWNER_ID)).toBe(true)
  })

  it('reject keeps history only: one row, blocks nothing else, never replaces a confirmation, and a new proposal on new evidence can be rejected again', async () => {
    const p = await pair()
    expect((await reject(p.o, p.i)).outcome).toBe('rejected')
    expect((await trows(p.o, p.i))[0]).toMatchObject({ tx: p.o, status: 'rejected', cp: p.i })
    // "confirm anyway" is allowed: a rejection is not a lock
    expect((await confirm(p.o, p.i)).outcome).toBe('confirmed')
    expect(await reject(p.o, p.i)).toMatchObject({ outcome: 'conflict', detail: 'PAIR_CONFIRMED' })
    expect((await reverse(p.o, p.i)).outcome).toBe('reversed')
    // evidence changes, the old rejection no longer describes this pair: a fresh rejection is recorded
    await rows(db, `UPDATE public.financial_provider_transactions SET transaction_date = '2026-09-12' WHERE id = $1`, [p.i])
    expect((await reject(p.o, p.i)).outcome).toBe('rejected')
    expect((await trows(p.o, p.i)).filter(r => r.status === 'rejected')).toHaveLength(2)
  })

  it('reverse undoes both legs with who/when/why, is repeatable only once, and the pair can be decided again; the whole trail stays', async () => {
    const p = await pair()
    await confirm(p.o, p.i)
    const rev = await reverse(p.o, p.i, { actor: ADMIN_ID })
    expect(rev).toMatchObject({ outcome: 'reversed', detail: '2' })
    const got = await trows(p.o, p.i)
    expect(got.every(r => r.status === 'undone' && r.undo_reason === 'pair_reversed' && r.undone_by === ADMIN_ID)).toBe(true)
    expect(await reverse(p.o, p.i)).toMatchObject({ outcome: 'nothing_to_reverse' })
    expect((await confirm(p.o, p.i)).outcome).toBe('confirmed') // back to undecided, decide again
    expect(await trows(p.o, p.i)).toHaveLength(4)
    // reverse works from either order and even after a leg disappeared from the evidence
    await rows(db, `UPDATE public.financial_provider_transactions SET removed_at = now() WHERE id = $1`, [p.i])
    expect((await reverse(p.i, p.o)).outcome).toBe('reversed')
  })

  it('re-confirming on changed evidence retires the old pair as "reconfirmed" and records the new one', async () => {
    const p = await pair()
    await confirm(p.o, p.i)
    await rows(db, `UPDATE public.financial_provider_transactions SET transaction_date = '2026-09-12' WHERE id = $1`, [p.i])
    const again = await confirm(p.o, p.i)
    expect(again.outcome).toBe('confirmed')
    const got = await trows(p.o, p.i)
    expect(got.filter(r => r.status === 'undone').map(r => r.undo_reason)).toEqual(['pair_reconfirmed', 'pair_reconfirmed'])
    expect(got.filter(r => r.status === 'confirmed').every(r => r.basis.fingerprint.includes('2026-09-12'))).toBe(true)
  })

  it('organization isolation: another organization cannot see, decide, reject or reverse this organization\'s legs', async () => {
    const a = await pair('bank', ORG), b = await pair('bank', ORG_B)
    // org B's actor naming org A's transactions
    for (const action of ['confirm', 'reject']) expect(await decide(action, a.o, a.i, { org: ORG_B, actor: OWNER_B_ID, fingerprint: await fp(a.o, a.i) })).toMatchObject({ outcome: 'not_found' })
    expect((await confirm(a.o, a.i)).outcome).toBe('confirmed')
    expect(await reverse(a.o, a.i, { org: ORG_B, actor: OWNER_B_ID })).toMatchObject({ outcome: 'nothing_to_reverse' })
    expect((await trows(a.o, a.i)).every(r => r.status === 'confirmed')).toBe(true) // untouched
    // mixing one leg of each organization
    expect(await decide('confirm', a.o, b.i, { org: ORG, fingerprint: 'v1|' + 'x'.repeat(30) })).toMatchObject({ outcome: 'not_found' })
    expect(await decide('confirm', a.o, b.i, { org: ORG_B, actor: OWNER_B_ID, fingerprint: 'v1|' + 'x'.repeat(30) })).toMatchObject({ outcome: 'not_found' })
    expect(await trows(b.o, b.i)).toHaveLength(0)
    // the database itself refuses a cross-organization counterpart (composite foreign key), even via a direct insert
    await expect(rows(db, `INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, counterpart_provider_transaction_ref, decided_by, decided_at)
      VALUES ($1,$2,'transfer','confirmed','owner',$3,$4,now())`, [ORG, a.o, b.i, OWNER_ID])).rejects.toThrow()
  })

  it('privileges: only the server role can execute it; employees and browser roles cannot', async () => {
    const p = await pair()
    for (const user of [ADMIN_ID, EMPLOYEE_ID]) await expect(asUser(db, user, () => rows(db, `SELECT * FROM public.financial_provider_decide_match($1,$2,'confirm',$3,$4,'internal_transfer','v1|xxxxxxxxxxxxxxxxxxxxxxxxxxxx','{}')`, [ORG, user, p.o, p.i]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, ADMIN_ID, () => rows(db, `SELECT * FROM public.financial_provider_decide_match(NULL,NULL,'probe')`))).rejects.toThrow(/permission denied/)
    expect(await trows(p.o, p.i)).toHaveLength(0)
    const priv = await rows(db, `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc, p.prosecdef AS definer, p.proconfig AS cfg
      FROM pg_proc p WHERE p.proname = 'financial_provider_decide_match'`)
    expect(priv[0]).toMatchObject({ anon: false, auth: false, svc: true, definer: false }); expect(priv[0].cfg.join(',')).toMatch(/search_path=public/)
  })

  it('a partial failure rolls the whole call back: forcing the second insert to fail leaves no half pair', async () => {
    const p = await pair()
    await db.exec(`RESET ROLE; CREATE FUNCTION public.test_fail_second() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.suggestion_basis ->> 'role' = 'inflow' THEN RAISE EXCEPTION 'forced failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_fail_second BEFORE INSERT ON public.financial_provider_interpretations FOR EACH ROW EXECUTE FUNCTION public.test_fail_second(); SET ROLE service_role`)
    try { await expect(confirm(p.o, p.i)).rejects.toThrow(/forced failure/); expect(await trows(p.o, p.i)).toHaveLength(0) }
    finally { await db.exec(`RESET ROLE; DROP TRIGGER test_fail_second ON public.financial_provider_interpretations; DROP FUNCTION public.test_fail_second(); SET ROLE service_role`) }
  })

  it('the existing replace function still works on a paired leg: it is the owner explicitly changing that leg, and the trail shows it', async () => {
    const p = await pair()
    await confirm(p.o, p.i)
    await rows(db, `SELECT * FROM public.financial_provider_replace_interpretation($1,$2,$3,'relationship','personal','owner','high','{}'::jsonb)`, [ORG, OWNER_ID, p.o])
    const got = await trows(p.o, p.i)
    expect(got.find(r => r.tx === p.o && r.status === 'undone')).toBeTruthy()   // the outflow leg's pair row was retired by the owner's newer decision
    expect(got.find(r => r.tx === p.i && r.status === 'confirmed')).toBeTruthy() // the other leg still names it: the review model flags this as an incomplete pair
  })
})
