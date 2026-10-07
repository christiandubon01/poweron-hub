// @ts-nocheck -- the Netlify handler and the PostgREST-style shim are untyped by design
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createSpendingRepo } from '../spending/spendingRepo'
import { applyDecision, getExplorer } from '../spending/spendingService'
import { CONFIRMED_INTERPRETATION_CONTRACT, representsCanonicalAdoption } from '../spending/contract'
import { BankConnectionError } from '../bankConnectionService'
import { buildHandler } from '../../../../netlify/functions/bank/plaid-spending'

/**
 * BANK-5 END TO END on REAL PostgreSQL (PGlite): the real repo + the real service, talking to the real tables and constraints through a small
 * PostgREST-style shim. Proves decisions persist, audit, isolate by organization, and change NO canonical row. Nothing touches production.
 */
let PGliteCtor: any = null, pgTypes: any = null
try { const m = await import('@electric-sql/pglite'); PGliteCtor = m.PGlite; pgTypes = m.types } catch { PGliteCtor = null }

const ORG = 'a0000000-0000-4000-8000-000000000001'
const ORG_B = 'a0000000-0000-4000-8000-000000000002'
const OWNER = 'b0000000-0000-4000-8000-000000000001'
const OWNER_B = 'b0000000-0000-4000-8000-000000000002'
const NOW = Date.parse('2026-10-07T12:00:00Z')
const BOOTSTRAP = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.organizations(id uuid PRIMARY KEY, name text);
CREATE TABLE public.test_profiles(id uuid PRIMARY KEY, org uuid, role text);
CREATE FUNCTION public.user_org_id() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT org FROM public.test_profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.is_org_admin_for(p uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.test_profiles WHERE id = auth.uid() AND org = p AND role IN ('owner', 'admin')) $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), public.user_org_id(), public.is_org_admin_for(uuid) TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
INSERT INTO public.organizations VALUES ('${ORG}', 'Org A'), ('${ORG_B}', 'Org B');
INSERT INTO auth.users VALUES ('${OWNER}'), ('${OWNER_B}');
INSERT INTO public.test_profiles VALUES ('${OWNER}', '${ORG}', 'owner'), ('${OWNER_B}', '${ORG_B}', 'owner');
-- the legacy projects table (migration 002) has far more columns and dependencies; the repo reads only these
CREATE TABLE public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, name text NOT NULL, status text NOT NULL DEFAULT 'in_progress');
`
const MIGRATIONS = ['139_cash_accounts_manual_ledger', '140_cash_linked_pair_lifecycle_hardening', '141_cash_transfer_conflict_target_fix', '142_cash_pair_void_link_lock_fix',
  '143_cash_dated_obligations', '146_balance_reconciliation_kind', '153_bank_provider_evidence_foundation', '154_bank_provider_credentials', '155_bank_interpretation_model']

/** A tiny PostgREST: just the query-builder surface the repo uses, executed as real SQL under the service role. */
function shim(db: any) {
  class Q {
    table: string; op = 'select'; cols = '*'; ret = '*'; where: Array<[string, string, any]> = []; ord: string[] = []; from = 0; to = -1; lim = 0; payload: any = null; one: '' | 'maybe' | 'single' = ''
    constructor(table: string) { this.table = table }
    select(cols = '*') { if (this.op === 'insert' || this.op === 'update') this.ret = cols; else this.cols = cols; return this }
    insert(p: any) { this.op = 'insert'; this.payload = p; return this }
    update(p: any) { this.op = 'update'; this.payload = p; return this }
    eq(c: string, v: any) { this.where.push([c, '=', v]); return this }
    neq(c: string, v: any) { this.where.push([c, '<>', v]); return this }
    in(c: string, v: any[]) { this.where.push([c, 'in', v]); return this }
    gte(c: string, v: any) { this.where.push([c, '>=', v]); return this }
    order(c: string, o: any = {}) { this.ord.push(`${c} ${o.ascending === false ? 'DESC' : 'ASC'}`); return this }
    range(a: number, b: number) { this.from = a; this.to = b; return this }
    limit(n: number) { this.lim = n; return this }
    maybeSingle() { this.one = 'maybe'; return this.run() }
    single() { this.one = 'single'; return this.run() }
    then(res: any, rej: any) { return this.run().then(res, rej) }
    async run() {
      const params: any[] = []
      const ph = (v: any) => { params.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v); return `$${params.length}` }
      const w = this.where.length ? ' WHERE ' + this.where.map(([c, o, v]) => o === 'in' ? `${c} = ANY(${ph(v)})` : `${c} ${o} ${ph(v)}`).join(' AND ') : ''
      let sql = ''
      if (this.op === 'insert') {
        const keys = Object.keys(this.payload)
        sql = `INSERT INTO public.${this.table} (${keys.join(',')}) VALUES (${keys.map(k => ph(this.payload[k])).join(',')}) RETURNING ${this.ret}`
      } else if (this.op === 'update') {
        const keys = Object.keys(this.payload)
        sql = `UPDATE public.${this.table} SET ${keys.map(k => `${k} = ${ph(this.payload[k])}`).join(',')}${w}`
      } else {
        sql = `SELECT ${this.cols} FROM public.${this.table}${w}${this.ord.length ? ' ORDER BY ' + this.ord.join(',') : ''}${this.to >= this.from && this.to >= 0 ? ` LIMIT ${this.to - this.from + 1} OFFSET ${this.from}` : this.lim ? ` LIMIT ${this.lim}` : ''}`
      }
      try {
        const rows = (await db.query(sql, params)).rows
        if (this.op === 'update') return { data: null, error: null }
        if (this.one) return { data: rows[0] ?? null, error: null }
        return { data: rows, error: null }
      } catch (e: any) { return { data: null, error: { code: e.code, message: String(e.message) } } }
    }
  }
  const rpc = async (fn: string, args: Record<string, any>) => {
    const keys = Object.keys(args)
    try {
      const rows = (await db.query(`SELECT * FROM public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, keys.map(k => { const v = args[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v }))).rows
      return { data: rows, error: null }
    } catch (e: any) { return { data: null, error: { code: e.code, message: String(e.message) } } }
  }
  return { from: (t: string) => new Q(t), rpc }
}

async function build(migrations: string[] = MIGRATIONS) {
  const db = new PGliteCtor({ parsers: { [pgTypes.DATE]: (v: string) => v, [pgTypes.TIMESTAMPTZ]: (v: string) => v, [pgTypes.INT8]: (v: string) => Number(v), [pgTypes.NUMERIC]: (v: string) => Number(v) } })
  await db.exec(BOOTSTRAP)
  for (const n of migrations) await db.exec(readFileSync(`supabase/migrations/${n}.sql`, 'utf8'))
  await db.exec('SET ROLE service_role')
  const q = async (sql: string, p: any[] = []) => (await db.query(sql, p)).rows as any[]
  const item = (await q(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid','item-1','ins_1','Tartan Bank',$2,$3)`, [ORG, `v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}`, OWNER]))[0].item_id
  const acct = (await q(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name, mask, currency, status) VALUES ($1,$2,'acc-1','Plaid Checking','0000','USD','active') RETURNING id`, [ORG, item]))[0].id
  const fin = (await q(`INSERT INTO public.financial_accounts (organization_id, display_name, account_type, account_class, ownership_context, include_in_cash) VALUES ($1,'Wells Fargo Business Checking 6960','checking','asset','business',true) RETURNING id`, [ORG]))[0].id
  const card = (await q(`INSERT INTO public.financial_accounts (organization_id, display_name, account_type, account_class, ownership_context) VALUES ($1,'Chase Ink Card','credit_card','liability','business') RETURNING id`, [ORG]))[0].id
  await q(`INSERT INTO public.financial_provider_account_mappings (organization_id, provider_account_ref, financial_account_id, status, mapped_by) VALUES ($1,$2,$3,'active',$4)`, [ORG, acct, fin, OWNER])
  const obligation = (await q(`INSERT INTO public.financial_obligations (organization_id, name, amount_type, amount_minor, recurrence_kind, anchor_date, start_date, account_id) VALUES ($1,'QuickBooks Online','fixed',3800,'monthly','2026-01-05','2026-01-01',$2) RETURNING id`, [ORG, fin]))[0].id
  const project = (await q(`INSERT INTO public.projects (org_id, name) VALUES ($1,'Desert Willow Remodel') RETURNING id`, [ORG]))[0].id
  const projectB = (await q(`INSERT INTO public.projects (org_id, name) VALUES ($1,'Other Org Project') RETURNING id`, [ORG_B]))[0].id
  const tx = async (name: string, dollars: number, date: string, o: { pending?: boolean; merchant?: string | null; category?: any; org?: string } = {}) => (await q(
    `INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, currency, transaction_date, name, merchant_name, provider_category)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'USD',$8,$9,$10,$11) RETURNING id`, [o.org ?? ORG, item, acct, `ptx-${Math.random().toString(36).slice(2)}`, !!o.pending, dollars, Math.round(dollars * 100), date, name, o.merchant ?? null, o.category ? JSON.stringify(o.category) : null]))[0].id
  const canonical = async () => JSON.stringify({
    ledger: (await q(`SELECT count(*)::int n FROM public.financial_transactions`))[0].n,
    accounts: await q(`SELECT id, display_name, include_in_cash, account_type, account_class, ownership_context, status FROM public.financial_accounts ORDER BY id`),
    obligations: await q(`SELECT id, name, amount_minor, status FROM public.financial_obligations ORDER BY id`),
    occurrences: (await q(`SELECT count(*)::int n FROM public.financial_obligation_occurrences`))[0].n,
    commitments: (await q(`SELECT count(*)::int n FROM public.cash_commitments`))[0].n,
    projects: await q(`SELECT id, name, status FROM public.projects ORDER BY id`),
    evidence: await q(`SELECT id, pending, provider_amount_minor, name, merchant_name, removed_at, provider_category FROM public.financial_provider_transactions ORDER BY id`),
    mappings: await q(`SELECT provider_account_ref, financial_account_id, status FROM public.financial_provider_account_mappings ORDER BY id`),
  })
  const svc = shim(db)
  const repo = createSpendingRepo(svc)
  const deps = { repo, now: () => NOW, log: () => {} }
  return { db, q, svc, repo, deps, tx, canonical, ids: { item, acct, fin, card, obligation, project, projectB } }
}
const owner = { organizationId: ORG, userId: OWNER, role: 'owner' }
const ownerB = { organizationId: ORG_B, userId: OWNER_B, role: 'owner' }

describe.runIf(!!PGliteCtor)('BANK-5 spending on real PostgreSQL (real repo + real service + real constraints)', () => {
  let w: Awaited<ReturnType<typeof build>>
  const t: Record<string, string> = {}
  beforeAll(async () => {
    w = await build()
    t.qb = await w.tx('INTUIT *QUICKBOOKS ONLINE', 38, '2026-10-05')
    t.hd1 = await w.tx('THE HOME DEPOT #6', 286.42, '2026-10-01')
    t.hd2 = await w.tx('THE HOME DEPOT #6', 120, '2026-10-02')
    t.chev = await w.tx('CHEVRON 0098', 62.1, '2026-10-03')
    t.mystery = await w.tx('ZZQ HOLDINGS', 40, '2026-10-03')
    t.named = await w.tx('LUMBER DESERT WILLOW REMODEL', 75, '2026-10-04')
    t.pend = await w.tx('CHEVRON 0099', 30, '2026-10-06', { pending: true })
    t.out = await w.tx('ONLINE TRANSFER TO SAVINGS', 500, '2026-10-02')
    t.deposit = await w.tx('CD DEPOSIT', -2000, '2026-10-01')
    t.card = await w.tx('CHASE INK CARD AUTOPAY', 350, '2026-10-04')
  }, 180_000)
  afterAll(async () => { await w?.db?.close?.() })

  const explore = (q: Record<string, unknown> = {}, actor = owner) => getExplorer(w.deps, actor, q)
  const rowOf = async (id: string, q: Record<string, unknown> = {}) => (await explore({ limit: 200, ...q })).rows.find(r => r.id === id)
  const decisionRows = async (id: string) => w.q(`SELECT kind, status, source, confidence, category, project_id, obligation_id, cash_commitment_id, debt_account_id, undo_reason, decided_by IS NOT NULL AS decided FROM public.financial_provider_interpretations WHERE provider_transaction_ref = $1 ORDER BY created_at, id`, [id])

  it('reads evidence + cash context from the real tables and suggests: known bill, bucket, debt, transfer, explicit project; nothing is persisted', async () => {
    const e = await explore({ limit: 200 })
    const by = (id: string) => e.rows.find(r => r.id === id)
    expect(by(t.qb)).toMatchObject({ bucket: { key: 'software_subscriptions' }, relationship: { kind: 'obligation', state: 'suggested', confidence: 'high', target: { type: 'obligation', id: w.ids.obligation } }, unassigned: false })
    expect(by(t.hd1)).toMatchObject({ bucket: { key: 'materials', state: 'suggested' }, relationship: { kind: 'unknown' }, unassigned: true })
    expect(by(t.named).relationship).toMatchObject({ kind: 'project', state: 'suggested', confidence: 'possible', target: { id: w.ids.project } })
    expect(by(t.card).relationship).toMatchObject({ kind: 'debt', target: { id: w.ids.card } })
    expect(by(t.out).relationship).toMatchObject({ kind: 'transfer' })
    expect(by(t.pend)).toMatchObject({ pending: true, unassigned: false })
    expect(by(t.qb).account).toMatchObject({ mappedTo: 'Wells Fargo Business Checking 6960', ownership: 'business' })
    expect(e.viewCounts.all).toBe(10)
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n).toBe(0) // suggestions are computed, never stored
    expect(e.options.projects.map(p => p.id)).toEqual([w.ids.project]) // only this organization's projects
  })

  it('every owner decision persists, audits and changes NO canonical row (ledger, accounts, include_in_cash, obligations, occurrences, projects, evidence, mappings)', async () => {
    const before = await w.canonical()
    expect(await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.hd1, bucket: 'materials' })).toEqual({ outcome: 'created' })
    expect(await applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.hd1, kind: 'project', targetId: w.ids.project })).toEqual({ outcome: 'created' })
    expect(await applyDecision(w.deps, owner, { action: 'accept_suggestion', transactionId: t.qb, dimension: 'relationship' })).toEqual({ outcome: 'created' })
    expect(await applyDecision(w.deps, owner, { action: 'accept_suggestion', transactionId: t.qb, dimension: 'bucket' })).toEqual({ outcome: 'created' })
    expect(await applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.card, kind: 'debt', targetId: w.ids.card })).toEqual({ outcome: 'created' })
    expect(await applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.out, kind: 'transfer' })).toEqual({ outcome: 'created' })
    expect(await applyDecision(w.deps, owner, { action: 'ignore', transactionId: t.deposit })).toEqual({ outcome: 'ignored' })
    expect(await w.canonical()).toBe(before)

    // persisted exactly as decided, with the audit fields the schema requires
    expect(await decisionRows(t.hd1)).toEqual([
      expect.objectContaining({ kind: 'category', status: 'confirmed', source: 'owner', category: 'materials', decided: true }),
      expect.objectContaining({ kind: 'project', status: 'confirmed', source: 'owner', project_id: w.ids.project, decided: true }),
    ])
    expect(await decisionRows(t.qb)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'obligation', status: 'confirmed', source: 'rule', obligation_id: w.ids.obligation, confidence: 'high' })]))
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_obligation_occurrences`))[0].n).toBe(0) // confirming a bill NEVER materializes an occurrence
  })

  it('confirmed decisions show up in the explorer (and survive a fresh read): bucket, relationship and review are independent', async () => {
    const hd1 = await rowOf(t.hd1), hd2 = await rowOf(t.hd2), qb = await rowOf(t.qb)
    expect(hd1).toMatchObject({ review: 'confirmed', bucket: { key: 'materials', state: 'confirmed' }, relationship: { kind: 'project', state: 'confirmed', target: { label: 'Desert Willow Remodel' } }, unassigned: false })
    expect(hd2).toMatchObject({ relationship: { kind: 'unknown' }, unassigned: true }) // the same merchant, a different transaction: nothing inherited
    expect(hd2.bucket).toMatchObject({ key: 'materials', state: 'suggested', confidence: 'high' })
    expect(qb).toMatchObject({ review: 'confirmed', relationship: { kind: 'obligation', state: 'confirmed', target: { label: 'QuickBooks Online' } }, unassigned: false })
    const e = await explore({ limit: 200 })
    expect(e.analytics.unassigned.byBucket.find(b => b.key === 'software_subscriptions')).toBeUndefined() // the confirmed bill is not leakage
  })

  it('changing a decision keeps the old one as audit history (undone, with a reason) and writes a new one; repeating is a no-op', async () => {
    expect(await applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.hd1, kind: 'overhead' })).toEqual({ outcome: 'changed' })
    expect(await applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.hd1, kind: 'overhead' })).toEqual({ outcome: 'unchanged' })
    const rows = await decisionRows(t.hd1)
    expect(rows.filter(r => r.kind === 'project')).toEqual([expect.objectContaining({ status: 'undone', undo_reason: 'changed_by_owner' })])
    expect(rows.filter(r => r.kind === 'overhead')).toEqual([expect.objectContaining({ status: 'confirmed' })])
    expect(await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.hd1, bucket: 'materials' })).toEqual({ outcome: 'unchanged' })
    expect(await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.hd1, bucket: 'tools_equipment' })).toEqual({ outcome: 'changed' })
    expect((await decisionRows(t.hd1)).filter(r => r.kind === 'category').map(r => `${r.category}:${r.status}`)).toEqual(['materials:undone', 'tools_equipment:confirmed'])
  })

  it('undo, unignore and reject: undo is idempotent; a rejected suggestion is not offered again', async () => {
    expect(await applyDecision(w.deps, owner, { action: 'undo', transactionId: t.hd1, dimension: 'relationship' })).toEqual({ outcome: 'undone' })
    expect(await applyDecision(w.deps, owner, { action: 'undo', transactionId: t.hd1, dimension: 'relationship' })).toEqual({ outcome: 'nothing_to_undo' })
    expect(await applyDecision(w.deps, owner, { action: 'unignore', transactionId: t.deposit })).toEqual({ outcome: 'undone' })
    expect(await applyDecision(w.deps, owner, { action: 'reject_suggestion', transactionId: t.chev, dimension: 'bucket' })).toEqual({ outcome: 'rejected' })
    expect((await rowOf(t.chev)).bucket).toMatchObject({ state: 'none', key: 'other_needs_review' })
    expect((await decisionRows(t.chev))[0]).toMatchObject({ kind: 'category', status: 'rejected', category: 'fuel_vehicle' })
  })

  it('merchant learning from REAL confirmations: later same-merchant transactions get a high-confidence BUCKET suggestion, never a project', async () => {
    await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.mystery, bucket: 'office_admin' })
    const next = await w.tx('ZZQ HOLDINGS', 41, '2026-10-06'), next2 = await w.tx('ZZQ HOLDINGS', 42, '2026-10-06')
    await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: next, bucket: 'office_admin' })
    const r = await rowOf(next2)
    expect(r.bucket).toMatchObject({ key: 'office_admin', state: 'suggested', confidence: 'high' }); expect(r.bucket.reasons[0]).toMatch(/You confirmed 2 earlier/)
    expect(r.relationship.kind).toBe('unknown'); expect(r.review).toBe('suggested')
  })

  it('pending evidence can only be categorized or ignored; relationships are refused before and by the database', async () => {
    await expect(applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.pend, kind: 'overhead' })).rejects.toMatchObject({ httpStatus: 409 })
    expect(await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.pend, bucket: 'fuel_vehicle' })).toEqual({ outcome: 'created' })
    expect(await applyDecision(w.deps, owner, { action: 'ignore', transactionId: t.pend })).toEqual({ outcome: 'ignored' })
    // the database itself also refuses a relationship on pending evidence, even if the service were bypassed
    await expect(w.q(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, decided_by) VALUES ($1,$2,'overhead','confirmed','owner','high',$3)`, [ORG, t.pend, OWNER])).rejects.toThrow(/pending/i)
  })

  it('validates every target against the caller\'s organization: unknown bill, other-org project, wrong-class debt account, missing counterpart', async () => {
    const bogus = '99999999-9999-4999-8999-999999999999'
    await expect(applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.mystery, kind: 'obligation', targetType: 'obligation', targetId: bogus })).rejects.toMatchObject({ httpStatus: 404 })
    await expect(applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.mystery, kind: 'project', targetId: w.ids.projectB })).rejects.toMatchObject({ httpStatus: 404 })
    await expect(applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.mystery, kind: 'debt', targetId: w.ids.fin })).rejects.toMatchObject({ httpStatus: 404 }) // an asset account is not a debt
    await expect(applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.mystery, kind: 'transfer', counterpartTransactionId: bogus })).rejects.toMatchObject({ httpStatus: 404 })
    await expect(applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.mystery, kind: 'project' })).rejects.toMatchObject({ httpStatus: 400 })
    await expect(applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.mystery, bucket: 'not_a_bucket' })).rejects.toMatchObject({ httpStatus: 400 })
    expect(await decisionRows(t.mystery)).toHaveLength(1) // only the earlier bucket decision exists
  })

  it('organization isolation: another organization cannot see, decide on or learn from this one\'s evidence', async () => {
    await expect(applyDecision(w.deps, ownerB, { action: 'set_bucket', transactionId: t.hd2, bucket: 'materials' })).rejects.toMatchObject({ httpStatus: 404 })
    await expect(applyDecision(w.deps, ownerB, { action: 'ignore', transactionId: t.hd2 })).rejects.toMatchObject({ httpStatus: 404 })
    const e = await explore({ limit: 200 }, ownerB)
    expect(e.rows).toEqual([]); expect(e.options.projects.map(p => p.id)).toEqual([w.ids.projectB]); expect(e.options.obligations).toEqual([])
    expect((await decisionRows(t.hd2))).toHaveLength(0)
  })

  it('owner/admin only: employees and viewers are refused before anything is read or written', async () => {
    for (const role of ['employee', 'viewer', '', undefined]) {
      await expect(getExplorer(w.deps, { ...owner, role }, {})).rejects.toMatchObject({ httpStatus: 403 })
      await expect(applyDecision(w.deps, { ...owner, role }, { action: 'ignore', transactionId: t.hd2 })).rejects.toMatchObject({ httpStatus: 403 })
    }
    expect(await decisionRows(t.hd2)).toHaveLength(0)
  })

  it('a duplicate active decision is refused by the database (no duplicate interpretations), and the service never creates one', async () => {
    await expect(w.q(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, decided_by, category) VALUES ($1,$2,'category','confirmed','owner','high',$3,'meals')`, [ORG, t.mystery, OWNER])).rejects.toThrow(/active_kind|duplicate|unique/i)
    const rows = await w.q(`SELECT provider_transaction_ref, kind, count(*)::int n FROM public.financial_provider_interpretations WHERE status IN ('suggested','confirmed') GROUP BY 1,2 HAVING count(*) > 1`)
    expect(rows).toEqual([])
  })

  it('the explorer is deterministic: reading twice yields identical output, and reading never writes', async () => {
    const before = (await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n
    const a = JSON.stringify(await explore({ limit: 200 })), b = JSON.stringify(await explore({ limit: 200 }))
    expect(a).toBe(b); expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n).toBe(before)
  })

  it('FINAL INVARIANT: after all of the above, canonical truth is exactly what it was (only interpretation rows were written)', async () => {
    const a = await w.canonical()
    await explore({ limit: 200 })
    expect(await w.canonical()).toBe(a)
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_transactions`))[0].n).toBe(0)
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n).toBeGreaterThan(8)
  })

  describe('endpoint', () => {
    const ENV = {}
    const ev = (method: string, body?: unknown, qs?: Record<string, string>, headers: Record<string, string> = { authorization: 'Bearer t' }) => ({ httpMethod: method, headers, body: body === undefined ? undefined : JSON.stringify(body), queryStringParameters: qs })
    const overrides = (profile: any) => ({
      verifyUser: async () => ({ id: OWNER }), userClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }) }),
      serviceClient: () => w.svc, now: () => NOW,
    })
    it('401 unauthenticated, 403 employee/viewer/inactive, 400 unknown action, 405 wrong method - and nothing is written', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const before = (await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n
      expect((await buildHandler({ ...overrides({ org_id: ORG, role: 'owner', is_active: true }), verifyUser: async () => null })(ev('GET', undefined, undefined, {}))).statusCode).toBe(401)
      for (const role of ['employee', 'viewer']) expect((await buildHandler(overrides({ org_id: ORG, role, is_active: true }))(ev('POST', { action: 'ignore', transactionId: t.hd2 }))).statusCode).toBe(403)
      expect((await buildHandler(overrides({ org_id: ORG, role: 'owner', is_active: false }))(ev('GET'))).statusCode).toBe(403)
      expect((await buildHandler(overrides({ org_id: ORG, role: 'owner', is_active: true }))(ev('POST', { action: 'wipe_ledger' }))).statusCode).toBe(400)
      expect((await buildHandler(overrides({ org_id: ORG, role: 'owner', is_active: true }))(ev('DELETE'))).statusCode).toBe(405)
      expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n).toBe(before)
    })
    it('the organization comes only from the profile: a body organizationId is ignored, and the response carries no credential, token or raw provider data', async () => {
      const h = buildHandler(overrides({ org_id: ORG_B, role: 'owner', is_active: true }))
      const res = await h(ev('POST', { action: 'ignore', transactionId: t.hd2, organizationId: ORG }))
      expect(res.statusCode).toBe(404) // the caller is org B; org A's transaction is "not found" whatever the body claims
      const got = await buildHandler(overrides({ org_id: ORG, role: 'owner', is_active: true }))(ev('GET', undefined, { view: 'unassigned', limit: '50' }))
      expect(got.statusCode).toBe(200)
      const body = JSON.parse(got.body)
      expect(body.rows.every(r => r.unassigned)).toBe(true)
      expect(got.body).not.toMatch(/access-|v1:|encrypted|secret|provider_transaction_id|ptx-|raw_payload|PLAID/i)
    })
    it('applies a decision through the endpoint and reflects it on the next read', async () => {
      const h = buildHandler(overrides({ org_id: ORG, role: 'owner', is_active: true }))
      expect(JSON.parse((await h(ev('POST', { action: 'set_bucket', transactionId: t.named, bucket: 'materials' }))).body)).toEqual({ outcome: 'created' })
      const got = JSON.parse((await h(ev('GET', undefined, { bucket: 'materials', limit: '200' }))).body)
      expect(got.rows.find(r => r.id === t.named).bucket).toMatchObject({ key: 'materials', state: 'confirmed' })
    })
  })
})

describe.runIf(!!PGliteCtor)('CONTRACT: a confirmed interpretation is NOT canonical reconciliation', () => {
  let w: Awaited<ReturnType<typeof build>>
  const t: Record<string, string> = {}
  let cardId = '', commitmentId = ''
  /** Everything canonical, as full rows: any change to any of it would show. Balances are derived from the ledger exactly as Cash OS derives them. */
  const truth = async () => JSON.stringify({
    ledger: await w.q(`SELECT * FROM public.financial_transactions ORDER BY id`),
    balances: await w.q(`SELECT account_id, sum(amount_minor)::int AS balance_minor FROM public.financial_transactions WHERE status = 'posted' GROUP BY 1 ORDER BY 1`),
    accounts: await w.q(`SELECT id, display_name, include_in_cash, account_type, account_class, ownership_context, status FROM public.financial_accounts ORDER BY id`),
    obligations: await w.q(`SELECT * FROM public.financial_obligations ORDER BY id`),
    occurrences: await w.q(`SELECT * FROM public.financial_obligation_occurrences ORDER BY id`),
    commitments: await w.q(`SELECT * FROM public.cash_commitments ORDER BY id`),
    planned_reconciliations: await w.q(`SELECT * FROM public.financial_planned_reconciliations ORDER BY id`),
    transaction_links: await w.q(`SELECT * FROM public.financial_transaction_links ORDER BY id`),
    projects: await w.q(`SELECT * FROM public.projects ORDER BY id`),
    mappings: await w.q(`SELECT * FROM public.financial_provider_account_mappings ORDER BY id`),
    evidence: await w.q(`SELECT * FROM public.financial_provider_transactions ORDER BY id`),
  })
  beforeAll(async () => {
    w = await build()
    await w.q(`INSERT INTO public.financial_transactions (organization_id, account_id, amount_minor, transaction_date, transaction_kind, economic_effect, economic_amount_minor, description, idempotency_key) VALUES ($1,$2,100000,'2026-09-01','opening_balance','none',0,'opening','seed-open')`, [ORG, w.ids.fin])
    await w.q(`INSERT INTO public.financial_transactions (organization_id, account_id, amount_minor, transaction_date, transaction_kind, economic_effect, economic_amount_minor, description, idempotency_key) VALUES ($1,$2,-8899,'2026-09-20','expense','outflow',8899,'manual expense','seed-exp')`, [ORG, w.ids.fin])
    cardId = w.ids.card
    commitmentId = (await w.q(`INSERT INTO public.cash_commitments (organization_id, title, expected_date, amount_type, amount_minor) VALUES ($1,'Permit fee','2026-10-04','fixed',9000) RETURNING id`, [ORG]))[0].id
    t.bill = await w.tx('INTUIT *QUICKBOOKS ONLINE', 38, '2026-10-05'); t.project = await w.tx('HOME DEPOT 6', 286.42, '2026-10-01'); t.debt = await w.tx('CHASE INK CARD AUTOPAY', 350, '2026-10-04')
    t.payroll = await w.tx('GUSTO PAYROLL 4412', 4200, '2026-10-03'); t.out = await w.tx('ONLINE TRANSFER TO SAVINGS', 500, '2026-10-02'); t.bucket = await w.tx('CHEVRON 0098', 62.1, '2026-10-03')
    t.permit = await w.tx('CITY PERMIT FEE', 90, '2026-10-04')
  }, 180_000)
  afterAll(async () => { await w?.db?.close?.() })

  it('the seeded ledger really is non-empty, so a balance change could not hide', async () => {
    expect((await w.q(`SELECT sum(amount_minor)::int b FROM public.financial_transactions`))[0].b).toBe(91101) // $1,000.00 - $88.99 = $911.01
  })

  const cases: Array<[string, () => Promise<unknown>]> = [
    ['known bill (recurring obligation)', () => applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.bill, kind: 'obligation', targetType: 'obligation', targetId: w.ids.obligation })],
    ['known bill (one-off commitment)', () => applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.permit, kind: 'obligation', targetType: 'commitment', targetId: commitmentId })],
    ['project relationship', () => applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.project, kind: 'project', targetId: w.ids.project })],
    ['debt relationship', () => applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.debt, kind: 'debt', targetId: cardId })],
    ['payroll relationship', () => applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.payroll, kind: 'payroll' })],
    ['transfer', () => applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.out, kind: 'transfer' })],
    ['economic bucket', () => applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.bucket, bucket: 'fuel_vehicle' })],
    ['accepting a suggested relationship', () => applyDecision(w.deps, owner, { action: 'accept_suggestion', transactionId: t.bill, dimension: 'relationship' }).catch(() => ({ outcome: 'already decided' }))],
    ['general overhead / personal / ignore', async () => { await applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.bucket, kind: 'overhead' }); await applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.bucket, kind: 'personal' }); await applyDecision(w.deps, owner, { action: 'ignore', transactionId: t.bucket }) }],
    ['changing and undoing decisions', async () => { await applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.project, kind: 'overhead' }); await applyDecision(w.deps, owner, { action: 'undo', transactionId: t.project, dimension: 'relationship' }) }],
  ]
  for (const [label, act] of cases) {
    it(`a confirmed ${label} leaves the ledger, balances, include_in_cash, obligations/occurrences, commitments, project, payroll, debt, reconciliation and Outlook inputs EXACTLY as they were`, async () => {
      const before = await truth()
      await act()
      expect(await truth()).toBe(before)
    })
  }

  it('after all of that: decisions DO exist (so the test is not vacuous), yet nothing canonical exists or moved', async () => {
    const rows = await w.q(`SELECT kind, status FROM public.financial_provider_interpretations WHERE status = 'confirmed'`)
    expect([...new Set(rows.map((r: any) => r.kind))].sort()).toEqual(['category', 'debt', 'ignored', 'obligation', 'payroll', 'personal', 'transfer'])
    expect(rows.length).toBeGreaterThan(5)
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_transactions`))[0].n).toBe(2) // only the two seeded ledger rows
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_obligation_occurrences`))[0].n).toBe(0)
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_planned_reconciliations`))[0].n).toBe(0)
    expect((await w.q(`SELECT count(*)::int n FROM public.cash_commitments WHERE status <> 'scheduled' OR reconciliation_state <> 'unreconciled' OR actual_transaction_id IS NOT NULL`))[0].n).toBe(0)
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations WHERE kind = 'ledger_match' OR ledger_transaction_id IS NOT NULL OR match_mode IS NOT NULL`))[0].n).toBe(0) // BANK-5 never makes a canonical reference
  })

  it('no confirmed kind except a ledger_match with a ledger reference can ever be read as canonical adoption', () => {
    for (const kind of ['category', 'obligation', 'project', 'debt', 'payroll', 'transfer', 'overhead', 'personal', 'ignored']) {
      expect(representsCanonicalAdoption({ kind, status: 'confirmed' })).toBe(false)
      expect(representsCanonicalAdoption({ kind, status: 'confirmed', ledgerTransactionId: 'led-1', matchMode: 'linked' })).toBe(false) // even carrying a ledger id: only a ledger_match counts
    }
    expect(representsCanonicalAdoption({ kind: 'ledger_match', status: 'confirmed' })).toBe(false)
    expect(representsCanonicalAdoption({ kind: 'ledger_match', status: 'suggested', ledgerTransactionId: 'l', matchMode: 'linked' })).toBe(false)
    expect(representsCanonicalAdoption({ kind: 'ledger_match', status: 'confirmed', ledgerTransactionId: 'l', matchMode: 'linked' })).toBe(true)
    expect(CONFIRMED_INTERPRETATION_CONTRACT).toMatchObject({ isCanonicalAdoption: false, confirmedMeans: 'owner_confirmed_interpretation_of_provider_evidence' })
    expect(CONFIRMED_INTERPRETATION_CONTRACT.doesNotMean).toEqual(expect.arrayContaining(['ledger_transaction_created', 'obligation_paid', 'debt_paid', 'project_payment_received', 'payroll_paid', 'transfer_reconciled', 'evidence_adopted']))
    expect(Object.isFrozen(CONFIRMED_INTERPRETATION_CONTRACT)).toBe(true)
  })

  it('the explorer tells the browser the contract in every payload, and the Decision type has no ledger field to misread', async () => {
    const e = await getExplorer(w.deps, owner, { limit: 5 })
    expect(e.contract).toMatchObject({ isCanonicalAdoption: false, confirmedMeans: 'owner_confirmed_interpretation_of_provider_evidence' })
    expect(e.contract.text).toMatch(/does not change your balances, ledger, bills, projects, payroll or reports/)
    const types = readFileSync(new URL('../spending/types.ts', import.meta.url), 'utf8')
    const decisionType = types.slice(types.indexOf('export interface Decision'), types.indexOf('export interface BucketSuggestion'))
    expect(decisionType).not.toMatch(/ledger|matchMode|match_mode/i)
  })
})

describe.runIf(!!PGliteCtor)('BANK-5 deployed BEFORE migration 155 is applied (safe degradation)', () => {
  let w: Awaited<ReturnType<typeof build>>
  let a = '', b = ''
  beforeAll(async () => {
    w = await build(MIGRATIONS.filter(m => !m.startsWith('155')))
    a = await w.tx('CHEVRON 0098', 62.1, '2026-10-03'); b = await w.tx('INTUIT *QUICKBOOKS ONLINE', 38, '2026-10-05')
  }, 180_000)
  afterAll(async () => { await w?.db?.close?.() })
  it('the explorer still reads and suggests (the missing obligation_id column is tolerated)', async () => {
    const e = await getExplorer(w.deps, owner, { limit: 200 })
    expect(e.rows).toHaveLength(2)
    expect(e.rows.find(r => r.id === b).relationship).toMatchObject({ kind: 'obligation', state: 'suggested' })
  })
  it('every decision write fails safely until 155 is applied: nothing partial, no canonical change, reads unaffected', async () => {
    const before = await w.canonical()
    await expect(applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: a, bucket: 'fuel_vehicle' })).rejects.toMatchObject({ httpStatus: 503, code: 'persistence_failed' })
    await expect(applyDecision(w.deps, owner, { action: 'ignore', transactionId: b })).rejects.toMatchObject({ httpStatus: 503 })
    await expect(applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: a, kind: 'overhead' })).rejects.toMatchObject({ httpStatus: 503 })
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n).toBe(0)
    expect(await w.canonical()).toBe(before)
    expect((await getExplorer(w.deps, owner, { limit: 200 })).rows).toHaveLength(2)
  })
})

describe('BANK-5 static guarantees', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  it('the spending code writes ONLY interpretation rows and never touches the ledger, accounts, obligations, projects, payroll, debt or Outlook', () => {
    const repo = read('../spending/spendingRepo.ts')
    const writes = [...repo.matchAll(/from\('([a-z_]+)'\)\s*\.(insert|update|upsert|delete)/g)].map(m => `${m[1]}:${m[2]}`)
    expect([...new Set(writes)].sort()).toEqual(['financial_provider_interpretations:insert', 'financial_provider_interpretations:update'])
    expect(repo).not.toMatch(/\.delete\(|\.upsert\(/)
    expect([...repo.matchAll(/\.rpc\('([a-z_]+)'/g)].map(m => m[1])).toEqual(['financial_provider_replace_interpretation']) // the ONE atomic function, nothing else
    for (const f of ['../spending/spendingService.ts', '../spending/classifier.ts', '../spending/analytics.ts', '../spending/explorer.ts', '../../../../netlify/functions/bank/plaid-spending.ts']) {
      expect(read(f), f).not.toMatch(/financial_transactions|include_in_cash|materializeObligation|reconcilePlannedOutflow|financial_obligation_occurrences|outlook|payroll_runs|from\('financial_accounts'\)\.(insert|update)/i)
    }
  })
  it('the spending code has no way to name a ledger reference: no ledger_match, ledger_transaction_id or match_mode anywhere in it', () => {
    for (const f of ['../spending/spendingRepo.ts', '../spending/spendingService.ts', '../spending/classifier.ts', '../spending/explorer.ts', '../spending/analytics.ts', '../spending/types.ts', '../../../../netlify/functions/bank/plaid-spending.ts']) {
      expect(read(f), f).not.toMatch(/ledger_match|ledger_transaction_id|match_mode|ledgerTransactionId|matchMode/)
    }
  })
  it('no Plaid call, transaction endpoint or raw provider JSON is used by the spending code', () => {
    for (const f of ['../spending/spendingRepo.ts', '../spending/spendingService.ts', '../spending/classifier.ts', '../spending/explorer.ts', '../spending/analytics.ts']) {
      expect(read(f), f).not.toMatch(/plaid['"]|PlaidApi|transactionsSync|transactionsGet|raw_payload|original_description|provider_metadata|access_token/i)
    }
  })
  it('no browser-reachable code imports the server-only spending modules', async () => {
    const { readdirSync, statSync } = await import('node:fs'); const { join } = await import('node:path')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
    const browser = walk('src').filter(f => /\.tsx?$/.test(f) && !/__tests__|\.test\./.test(f) && !f.replace(/\\/g, '/').includes('src/services/bankProvider/'))
    expect(browser.filter(f => /bankProvider\/spending|spendingRepo|spendingService/.test(readFileSync(f, 'utf8')))).toEqual([])
  })
})
