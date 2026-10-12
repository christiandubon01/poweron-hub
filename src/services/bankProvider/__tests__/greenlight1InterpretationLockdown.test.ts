// @ts-nocheck -- direct SQL against PGlite
/**
 * GREENLIGHT-1 B-1: docs/plaid2/interpretation-write-lockdown-proposal.sql (UNINSTALLED). Today (migrations 153-158) an owner/admin can write decision rows
 * directly through PostgREST, forging who decided and when. With the proposal installed the browser roles can only READ; the server paths keep working.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pairFingerprint } from '../spending/reconciliation'
import { ADMIN_ID, EMPLOYEE_ID, ORG, OWNER_ID, addTx, asUser, createDb, loadPglite, makeItem, rows } from './helpers/pgliteHarness'

const PGlite = await loadPglite()
const PLAID3B = 'docs/plaid2/match-decisions-proposal.sql', LOCKDOWN = 'docs/plaid2/interpretation-write-lockdown-proposal.sql'
const direct = (db, user, sql, params) => asUser(db, user, () => rows(db, sql, params)).then(r => ({ ok: true, r }), e => ({ ok: false, code: e.code, message: String(e.message) }))
const FORGED_INSERT = `INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, created_by) VALUES ($1,$2,'transfer','confirmed','owner','high',$3)`
const FORGED_UPDATE = `UPDATE public.financial_provider_interpretations SET decided_by = $1, decided_at = '2026-01-02T00:00:00Z' WHERE provider_transaction_ref = $2 RETURNING id`

describe.runIf(!!PGlite)('GREENLIGHT-1 B-1 interpretation write lockdown (PGlite)', () => {
  let before, after
  beforeAll(async () => { before = await createDb(PGlite, [PLAID3B]); after = await createDb(PGlite, [PLAID3B, LOCKDOWN]) }, 180_000)
  afterAll(async () => { await before?.close?.(); await after?.close?.() })

  it('reproduction: without the proposal an admin can insert a decision attributed to the owner and backdate it', async () => {
    const item = await makeItem(before, ORG, ['chk', 'sav'])
    const dep = await addTx(before, item, 'chk', { amount: -3000, name: 'CUSTOMER DEPOSIT' })
    expect((await direct(before, ADMIN_ID, FORGED_INSERT, [ORG, dep, OWNER_ID])).ok).toBe(true)
    expect((await direct(before, ADMIN_ID, FORGED_UPDATE, [OWNER_ID, dep])).ok).toBe(true)
    expect((await direct(before, EMPLOYEE_ID, FORGED_INSERT, [ORG, dep, OWNER_ID])).ok).toBe(false)     // employees were already refused
  })

  it('with the proposal: owner and admin can no longer insert or update decision rows directly; they can still read them', async () => {
    const item = await makeItem(after, ORG, ['chk', 'sav'])
    const dep = await addTx(after, item, 'chk', { amount: -3000, name: 'CUSTOMER DEPOSIT' })
    // a legitimate server-side decision (service_role, as the Netlify functions write)
    await rows(after, `INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, category, decided_by, decided_at, created_by) VALUES ($1,$2,'category','confirmed','owner','high','customer_payment',$3,now(),$3)`, [ORG, dep, OWNER_ID])
    for (const user of [OWNER_ID, ADMIN_ID]) {
      const ins = await direct(after, user, FORGED_INSERT, [ORG, dep, OWNER_ID])
      expect(ins.ok, user).toBe(false); expect(ins.code ?? ins.message).toMatch(/42501|permission denied/)
      const upd = await direct(after, user, FORGED_UPDATE, [OWNER_ID, dep])
      expect(upd.ok, user).toBe(false); expect(upd.code ?? upd.message).toMatch(/42501|permission denied/)
      const read = await direct(after, user, `SELECT category, status FROM public.financial_provider_interpretations WHERE provider_transaction_ref = $1`, [dep])
      expect(read).toMatchObject({ ok: true, r: [{ category: 'customer_payment', status: 'confirmed' }] })
    }
    expect(await rows(after, `SELECT count(*)::int AS n FROM public.financial_provider_interpretations WHERE provider_transaction_ref = $1`, [dep])).toEqual([{ n: 1 }])
  })

  it('with the proposal: the server paths still work (service_role writes, the pair function confirms and reverses)', async () => {
    const item = await makeItem(after, ORG, ['chk', 'sav'])
    const o = await addTx(after, item, 'chk', { amount: 500, name: 'ONLINE TRANSFER' }), i = await addTx(after, item, 'sav', { amount: -500, name: 'ONLINE TRANSFER' })
    const tx = (id) => rows(after, `SELECT id, provider_account_ref AS "providerAccountRef", provider_amount_minor::int AS "amountMinor", to_char(transaction_date,'YYYY-MM-DD') AS date, pending FROM public.financial_provider_transactions WHERE id = $1`, [id]).then(r => r[0])
    const fp = pairFingerprint(await tx(o), await tx(i))
    const call = (action) => rows(after, `SELECT * FROM public.financial_provider_decide_match($1,$2,$3,$4,$5,'internal_transfer',$6,'{}'::jsonb)`, [ORG, OWNER_ID, action, o, i, action === 'reverse' ? null : fp]).then(r => r[0])
    expect(await call('confirm')).toMatchObject({ outcome: 'confirmed' })
    expect(await call('reverse')).toMatchObject({ outcome: 'reversed' })
  })

  it('grants after install: authenticated keeps SELECT only; service_role unchanged', async () => {
    const g = await rows(after, `SELECT has_table_privilege('authenticated','public.financial_provider_interpretations','SELECT') AS s, has_table_privilege('authenticated','public.financial_provider_interpretations','INSERT') AS i,
      has_table_privilege('authenticated','public.financial_provider_interpretations','UPDATE') AS u, has_table_privilege('service_role','public.financial_provider_interpretations','INSERT') AS si,
      has_table_privilege('service_role','public.financial_provider_interpretations','UPDATE') AS su`)
    expect(g[0]).toEqual({ s: true, i: false, u: false, si: true, su: true })
  })
})
