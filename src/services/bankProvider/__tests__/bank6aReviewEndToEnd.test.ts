import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createSpendingRepo } from '../spending/spendingRepo'
import { applyDecision, getExplorer, getTransactionHistory, MAX_BATCH } from '../spending/spendingService'
import { buildHandler } from '../../../../netlify/functions/bank/plaid-spending'

/**
 * BANK-6A: organizing real bank transactions. Real repo + real service on REAL PostgreSQL (PGlite) with every migration through 156.
 * Interpretation only: no canonical row may change. Nothing touches production.
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
  '143_cash_dated_obligations', '146_balance_reconciliation_kind', '153_bank_provider_evidence_foundation', '154_bank_provider_credentials', '155_bank_interpretation_model', '156_bank_provider_environment']

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

describe.runIf(!!PGliteCtor)('BANK-6A review queue and safe batch approval (real PostgreSQL, interpretation only)', () => {
  let w: Awaited<ReturnType<typeof build>>
  const t: Record<string, string> = {}
  let baseline = ''
  const explore = (q: Record<string, unknown> = {}) => getExplorer(w.deps, owner, { limit: 200, ...q })
  const rowOf = async (id: string) => (await explore()).rows.find(r => r.id === id)!
  const rowCount = async () => (await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n
  beforeAll(async () => {
    w = await build()
    t.hd = await w.tx('THE HOME DEPOT #6', 120, '2026-10-01'); t.chev = await w.tx('CHEVRON 0098', 62.1, '2026-10-02'); t.sbux = await w.tx('STARBUCKS 1234', 5, '2026-10-03')
    t.fee = await w.tx('MONTHLY SERVICE FEE', 15, '2026-10-03'); t.gusto = await w.tx('GUSTO PAYROLL 4412', 4200, '2026-10-04')
    t.card = await w.tx('WELLS FARGO CREDIT CARD AUTOPAY', 350, '2026-10-04'); t.draw = await w.tx('OWNER DRAW', 1000, '2026-10-05')
    t.mystery = await w.tx('ZZQ HOLDINGS', 40, '2026-10-05'); t.pend = await w.tx('CHEVRON 0099', 30, '2026-10-06', { pending: true })
    t.dep = await w.tx('MOBILE DEPOSIT', -2500, '2026-10-02'); t.refund = await w.tx('AMAZON REFUND', -20, '2026-10-03'); t.named = await w.tx('LUMBER DESERT WILLOW REMODEL', 75, '2026-10-04')
    baseline = await w.canonical()
  }, 180_000)
  afterAll(async () => { await w?.db?.close?.() })

  it('suggests, but never decides: customer payments, refunds, owner draws, card payments and projects are only ever "possible", and nothing is persisted', async () => {
    const e = await explore()
    const by = (id: string) => e.rows.find(r => r.id === id)!
    expect(by(t.dep)).toMatchObject({ direction: 'money_in', bucket: { key: 'customer_payment', state: 'suggested', confidence: 'possible' }, review: 'suggested' })
    expect(by(t.refund).bucket).toMatchObject({ key: 'refund', state: 'suggested', confidence: 'possible' })
    expect(by(t.draw).bucket).toMatchObject({ key: 'owner_draw', state: 'suggested', confidence: 'possible' })
    expect(by(t.named).relationship).toMatchObject({ kind: 'project', state: 'suggested', confidence: 'possible' }) // a project is never confirmed from text
    // a credit-card payment is NOT ordinary spending: it is a (possible) transfer and sits outside the spending total
    expect(by(t.card)).toMatchObject({ relationship: { kind: 'transfer', state: 'suggested', confidence: 'possible' }, bucket: { key: 'transfers' }, unassigned: false })
    expect(by(t.gusto).relationship).toMatchObject({ kind: 'payroll', state: 'suggested' })
    for (const id of Object.values(t)) expect(by(id).review).not.toBe('confirmed')
    expect(await rowCount()).toBe(0)
  })

  it('the review queue lists every unconfirmed, unexcluded transaction (money in and out, pending included) with reviewed / unreviewed / excluded counts', async () => {
    const e = await explore({ view: 'review_queue' })
    expect(e.rows.map(r => r.id).sort()).toEqual(Object.values(t).sort())
    expect(e.viewCounts.review_queue).toBe(Object.keys(t).length)
    expect(e.reviewCounts).toEqual({ reviewed: 0, unreviewed: Object.keys(t).length, excluded: 0 })
  })

  it('batch approval confirms ONLY high-confidence ordinary expense categories on posted money-out rows, and says exactly why it skipped the rest', async () => {
    const ids = [...Object.values(t), '00000000-0000-4000-8000-0000000000ff']
    const out = await applyDecision(w.deps, owner, { action: 'confirm_batch', transactionIds: ids }) as any
    const byId = new Map(out.results.map((r: any) => [r.id, r]))
    for (const [name, bucket] of [['hd', 'materials'], ['chev', 'fuel_vehicle'], ['sbux', 'meals'], ['fee', 'bank_finance_fees']] as const) expect(byId.get(t[name]), name).toMatchObject({ result: 'confirmed', bucket })
    const reason = (id: string) => (byId.get(id) as any)
    expect(reason(t.gusto)).toMatchObject({ result: 'skipped', reason: 'needs_individual_review' }) // payroll is never a bulk decision
    expect(reason(t.card)).toMatchObject({ result: 'skipped', reason: 'not_high_confidence' })
    expect(reason(t.draw)).toMatchObject({ result: 'skipped', reason: 'not_high_confidence' })
    expect(reason(t.mystery)).toMatchObject({ result: 'skipped', reason: 'no_suggestion' })
    expect(reason(t.pend)).toMatchObject({ result: 'skipped', reason: 'pending' })
    expect(reason(t.dep)).toMatchObject({ result: 'skipped', reason: 'money_in' })
    expect(reason(t.refund)).toMatchObject({ result: 'skipped', reason: 'money_in' })
    expect(reason('00000000-0000-4000-8000-0000000000ff')).toMatchObject({ result: 'skipped', reason: 'not_found' })
    expect(out).toMatchObject({ confirmed: 4, unchanged: 0 })
    // persisted as audited, rule-sourced, owner-decided interpretations only
    const rows = await w.q(`SELECT kind, status, source, category, decided_by IS NOT NULL AS decided, suggestion_basis->>'mode' AS mode FROM public.financial_provider_interpretations ORDER BY category`)
    expect(rows).toHaveLength(4)
    expect(rows.every(r => r.kind === 'category' && r.status === 'confirmed' && r.source === 'rule' && r.decided && r.mode === 'suggestion_batch')).toBe(true)
    expect(await w.canonical()).toBe(baseline) // ledger, balances, accounts, obligations, projects, evidence, mappings: byte-identical
  })

  it('repeating a batch is safe (nothing duplicated), and the counts move: confirmed rows are reviewed and leave the queue', async () => {
    const again = await applyDecision(w.deps, owner, { action: 'confirm_batch', transactionIds: [t.hd, t.chev] }) as any
    expect(again.results.every((r: any) => r.result === 'skipped' && r.reason === 'already_decided')).toBe(true)
    expect(await rowCount()).toBe(4)
    const e = await explore({ view: 'review_queue' })
    expect(e.reviewCounts).toEqual({ reviewed: 4, unreviewed: Object.keys(t).length - 4, excluded: 0 })
    expect(e.rows.map(r => r.id)).not.toContain(t.hd)
    expect((await rowOf(t.hd))).toMatchObject({ review: 'confirmed', bucket: { key: 'materials', state: 'confirmed' } })
  })

  it('batch input is validated: empty, oversized, duplicate-padded and malformed lists are refused before anything is read or written', async () => {
    const before = await rowCount()
    const attempt = (transactionIds: unknown) => applyDecision(w.deps, owner, { action: 'confirm_batch', transactionIds } as any).catch(e => e)
    for (const bad of [undefined, [], 'abc', [t.hd, 'not-a-uuid'], Array.from({ length: MAX_BATCH + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)]) {
      const e = await attempt(bad); expect(e.httpStatus ?? e.code).toBeTruthy(); expect(e.httpStatus).toBe(400)
    }
    expect(await rowCount()).toBe(before)
  })

  it('organization isolation: another organization can neither see nor batch-approve these transactions, and nothing is created for it', async () => {
    const out = await applyDecision(w.deps, ownerB, { action: 'confirm_batch', transactionIds: [t.mystery, t.draw, t.dep] }) as any
    expect(out.results.every((r: any) => r.result === 'skipped' && r.reason === 'not_found')).toBe(true)
    expect(await getTransactionHistory(w.deps, ownerB, t.hd).catch(e => e.httpStatus)).toBe(404)
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations WHERE organization_id = $1`, [ORG_B]))[0].n).toBe(0)
    for (const role of ['employee', 'viewer']) expect((await applyDecision(w.deps, { ...owner, role }, { action: 'confirm_batch', transactionIds: [t.mystery] }).catch(e => e)).httpStatus).toBe(403)
  })

  it('a correction keeps the old decision as audit history (who-less, when, why) and the history endpoint shows the whole trail', async () => {
    expect(await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.hd, bucket: 'tools_equipment' })).toEqual({ outcome: 'changed' })
    const { history } = await getTransactionHistory(w.deps, owner, t.hd)
    expect(history.map(h => [h.label, h.status])).toEqual([['Materials', 'undone'], ['Tools & Equipment', 'confirmed']])
    expect(history[0]).toMatchObject({ undoReason: 'changed_by_owner', source: 'rule' }); expect(history[0].undoneAt).toBeTruthy()
    expect(history[1].source).toBe('owner')
    expect(JSON.stringify(history)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/) // no user or record ids in the trail
    expect(await applyDecision(w.deps, owner, { action: 'undo', transactionId: t.hd, dimension: 'bucket' })).toEqual({ outcome: 'undone' })
    expect((await getTransactionHistory(w.deps, owner, t.hd)).history.map(h => h.status)).toEqual(['undone', 'undone'])
    expect((await rowOf(t.hd)).review).not.toBe('confirmed') // back in the queue
  })

  it('categories must fit the direction of the money: customer payments/refunds only for money in, expense categories only for money out', async () => {
    const bad = (transactionId: string, bucket: string) => applyDecision(w.deps, owner, { action: 'set_bucket', transactionId, bucket }).catch(e => e)
    expect((await bad(t.mystery, 'customer_payment')).httpStatus).toBe(400)
    expect((await bad(t.mystery, 'refund')).httpStatus).toBe(400)
    expect((await bad(t.dep, 'materials')).httpStatus).toBe(400)
    expect(await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.dep, bucket: 'customer_payment' })).toEqual({ outcome: 'created' })
    expect(await applyDecision(w.deps, owner, { action: 'accept_suggestion', transactionId: t.refund, dimension: 'bucket' })).toEqual({ outcome: 'created' })
    expect(await rowOf(t.dep)).toMatchObject({ review: 'confirmed', bucket: { key: 'customer_payment', state: 'confirmed' } })
  })

  it('individual approval of an owner draw / personal / transfer removes it from business spending; excluding a row moves it to Excluded; pending can still be categorized', async () => {
    const before = (await explore()).analytics.unassigned.totalMinor
    expect(await applyDecision(w.deps, owner, { action: 'accept_suggestion', transactionId: t.draw, dimension: 'bucket' })).toEqual({ outcome: 'created' })
    expect((await explore()).analytics.unassigned.totalMinor).toBe(before - 100000) // the confirmed owner draw is no longer "unassigned business spending"
    expect(await applyDecision(w.deps, owner, { action: 'ignore', transactionId: t.mystery })).toEqual({ outcome: 'ignored' })
    expect(await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.pend, bucket: 'fuel_vehicle' })).toEqual({ outcome: 'created' })
    expect((await applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.pend, kind: 'personal' }).catch(e => e)).httpStatus).toBe(409) // pending cannot take a relationship
    const e = await explore()
    expect(e.reviewCounts.excluded).toBe(1)
    expect(e.reviewCounts.reviewed + e.reviewCounts.unreviewed + e.reviewCounts.excluded).toBe(Object.keys(t).length)
  })

  it('an optional project is associated only by an explicit owner choice, never inferred', async () => {
    expect((await rowOf(t.named)).relationship).toMatchObject({ kind: 'project', state: 'suggested' })
    expect(await rowCount()).toBeGreaterThan(0)
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations WHERE kind = 'project'`))[0].n).toBe(0)
    expect(await applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.named, kind: 'project', targetId: w.ids.project })).toEqual({ outcome: 'created' })
    expect((await rowOf(t.named)).relationship).toMatchObject({ kind: 'project', state: 'confirmed', target: { label: 'Desert Willow Remodel' } })
  })

  it('through all of the above, no canonical row changed and no ledger / balance / obligation / project / payroll / debt record was written', async () => {
    expect(await w.canonical()).toBe(baseline)
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_transactions WHERE source_type = 'future_provider' OR source_kind = 'provider_transaction'`))[0].n).toBe(0)
  })
})

describe.runIf(!!PGliteCtor)('BANK-6A endpoint', () => {
  let w: Awaited<ReturnType<typeof build>>
  const ids: string[] = []
  beforeAll(async () => {
    w = await build()
    for (let i = 0; i < 3; i++) ids.push(await w.tx('CHEVRON 00' + i, 20 + i, '2026-10-0' + (i + 1)))
  }, 180_000)
  afterAll(async () => { await w?.db?.close?.() })
  const ev = (method: string, body?: unknown, qs?: Record<string, string>) => ({ httpMethod: method, headers: { authorization: 'Bearer t' }, body: body === undefined ? undefined : JSON.stringify(body), queryStringParameters: qs })
  const overrides = (profile: any) => ({
    verifyUser: async () => ({ id: OWNER }), userClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }) }),
    serviceClient: () => w.svc, now: () => NOW,
  })
  const handlerFor = (profile: any) => buildHandler(overrides(profile)) as unknown as (e: unknown) => Promise<any>
  const owned = () => handlerFor({ org_id: ORG, role: 'owner', is_active: true })

  it('POST confirm_batch approves eligible rows, the explorer reflects it, and GET ?history= returns a sanitized trail', async () => {
    const res = await owned()(ev('POST', { action: 'confirm_batch', transactionIds: ids }))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ confirmed: 3, skipped: 0 })
    const got = JSON.parse((await owned()(ev('GET', undefined, { view: 'review_queue' }))).body)
    expect(got.rows).toEqual([]); expect(got.reviewCounts).toEqual({ reviewed: 3, unreviewed: 0, excluded: 0 })
    expect(got.options.batchBuckets).toContain('materials'); expect(got.options.batchBuckets).not.toContain('payroll_people'); expect(got.options.maxBatch).toBe(50)
    const hist = await owned()(ev('GET', undefined, { history: ids[0] }))
    expect(hist.statusCode).toBe(200)
    expect(JSON.parse(hist.body).history).toHaveLength(1)
    expect(hist.body).not.toMatch(/access-|v1:|encrypted|secret|PLAID|decided_by|created_by/i)
  })
  it('refuses non-owners and other organizations, validates sizes, and writes nothing on refusal', async () => {
    const before = (await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n
    for (const role of ['employee', 'viewer']) {
      expect((await handlerFor({ org_id: ORG, role, is_active: true })(ev('POST', { action: 'confirm_batch', transactionIds: ids }))).statusCode).toBe(403)
      expect((await handlerFor({ org_id: ORG, role, is_active: true })(ev('GET', undefined, { history: ids[0] }))).statusCode).toBe(403)
    }
    expect((await handlerFor({ org_id: ORG_B, role: 'owner', is_active: true })(ev('GET', undefined, { history: ids[0] }))).statusCode).toBe(404)
    expect((await owned()(ev('POST', { action: 'confirm_batch', transactionIds: [] }))).statusCode).toBe(400)
    expect((await owned()(ev('POST', { action: 'confirm_batch', transactionIds: Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`) }))).statusCode).toBe(400)
    expect(((await owned()(ev('POST', { action: 'confirm_batch', transactionIds: ids, padding: 'x'.repeat(9000) }))) as any).statusCode).toBe(400) // oversized body
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n).toBe(before)
  })
})

describe.runIf(!!PGliteCtor)('BANK-6A category overrides in batch approval (real PostgreSQL)', () => {
  let w: Awaited<ReturnType<typeof build>>
  const t: Record<string, string> = {}
  let baseline = ''
  const batch = (transactionIds: string[], categoryOverrides?: unknown, actor = owner) => applyDecision(w.deps, actor, { action: 'confirm_batch', transactionIds, categoryOverrides } as any) as Promise<any>
  const rows = async () => w.q(`SELECT provider_transaction_ref AS tx, category, source, status, suggestion_basis AS basis FROM public.financial_provider_interpretations ORDER BY created_at`)
  beforeAll(async () => {
    w = await build()
    t.autozone = await w.tx('AUTOZONE #4421', 11.95, '2026-10-02'); t.chev = await w.tx('CHEVRON 0098', 62.1, '2026-10-03'); t.hd = await w.tx('THE HOME DEPOT #6', 120, '2026-10-01')
    t.mystery = await w.tx('ZZQ HOLDINGS', 40, '2026-10-04'); t.pend = await w.tx('CHEVRON 0099', 30, '2026-10-05', { pending: true }); t.dep = await w.tx('MOBILE DEPOSIT', -2500, '2026-10-02')
    t.gusto = await w.tx('GUSTO PAYROLL 4412', 4200, '2026-10-04'); t.sbux = await w.tx('STARBUCKS 77', 6, '2026-10-03')
    baseline = await w.canonical()
  }, 180_000)
  afterAll(async () => { await w?.db?.close?.() })

  it('the existing catalog already has the category: Tools & Equipment (no "Tools / Supplies" exists, so none is invented), and AutoZone is suggested as Fuel / Vehicle', async () => {
    const e = await getExplorer(w.deps, owner, { limit: 200 })
    expect(e.options.buckets.find(b => b.key === 'tools_equipment')).toMatchObject({ label: 'Tools & Equipment' })
    expect(e.options.buckets.some(b => /tools\s*\/\s*supplies/i.test(b.label))).toBe(false)
    expect(e.rows.find(r => r.id === t.autozone)!.bucket).toMatchObject({ key: 'fuel_vehicle', state: 'suggested', confidence: 'high' })
    expect(e.options.batchBuckets).toContain('tools_equipment')
  })

  it('malformed or disallowed overrides refuse the WHOLE request and write nothing', async () => {
    const before = await rows()
    const bad: Array<[string, unknown]> = [
      ['unknown category', { [t.autozone]: 'not_a_category' }], ['payroll is an individual decision', { [t.autozone]: 'payroll_people' }], ['personal is an individual decision', { [t.autozone]: 'personal_owner' }],
      ['transfers', { [t.autozone]: 'transfers' }], ['owner draw', { [t.autozone]: 'owner_draw' }], ['money-in category on an expense', { [t.autozone]: 'customer_payment' }],
      ['not an object', ['tools_equipment']], ['a string', 'tools_equipment'], ['non-string value', { [t.autozone]: 7 }],
      ['id that is not selected', { [t.hd]: 'tools_equipment' }], ['not even an id', { 'x': 'tools_equipment' }],
    ]
    for (const [name, overrides] of bad) {
      const e = await batch([t.autozone], overrides).catch(x => x)
      expect(e.httpStatus, name).toBe(400)
    }
    expect(await batch([t.autozone], { [t.autozone]: 'tools_equipment', [t.hd]: 'materials' }).catch(x => x.httpStatus)).toBe(400) // more entries than selected ids
    expect(await rows()).toEqual(before)
    expect(await w.canonical()).toBe(baseline)
  })

  it('a valid override saves the OWNER\'s category (AutoZone work strap -> Tools & Equipment), keeps the original suggestion in the audit basis, and leaves other rows on the normal rule', async () => {
    const out = await batch([t.autozone, t.chev], { [t.autozone]: 'tools_equipment' })
    const by = new Map(out.results.map((r: any) => [r.id, r]))
    expect(by.get(t.autozone)).toMatchObject({ result: 'confirmed', bucket: 'tools_equipment', overridden: true })
    expect(by.get(t.chev)).toMatchObject({ result: 'confirmed', bucket: 'fuel_vehicle' })
    const saved = await rows()
    const az = saved.find(r => r.tx === t.autozone), ch = saved.find(r => r.tx === t.chev)
    expect(az).toMatchObject({ category: 'tools_equipment', source: 'owner', status: 'confirmed' })
    expect(az.basis).toMatchObject({ mode: 'owner_batch_override', suggested: 'fuel_vehicle', suggestedConfidence: 'high' })
    expect(ch).toMatchObject({ category: 'fuel_vehicle', source: 'rule' }) // not overridden: still a rule-sourced suggestion approval
    expect((await getExplorer(w.deps, owner, { limit: 200 })).rows.find(r => r.id === t.autozone)).toMatchObject({ bucket: { key: 'tools_equipment', state: 'confirmed' }, review: 'confirmed' })
    const { history } = await getTransactionHistory(w.deps, owner, t.autozone)
    expect(history.map(h => [h.label, h.status, h.source])).toEqual([['Tools & Equipment', 'confirmed', 'owner']])
    expect(await w.canonical()).toBe(baseline)
  })

  it('an override can be corrected later with the audit trail kept (replace, undo)', async () => {
    expect(await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.autozone, bucket: 'materials' })).toEqual({ outcome: 'changed' })
    const { history } = await getTransactionHistory(w.deps, owner, t.autozone)
    expect(history.map(h => [h.label, h.status])).toEqual([['Tools & Equipment', 'undone'], ['Materials', 'confirmed']])
  })

  it('overrides never bypass the row rules: pending, money in, competing relationship suggestions, and already-decided rows are skipped and unchanged', async () => {
    const before = (await rows()).length
    const out = await batch([t.pend, t.dep, t.gusto, t.chev, t.hd], { [t.pend]: 'tools_equipment', [t.dep]: 'tools_equipment', [t.gusto]: 'tools_equipment', [t.chev]: 'tools_equipment' })
    const reason = (id: string) => (out.results.find((r: any) => r.id === id) as any)
    expect(reason(t.pend)).toMatchObject({ result: 'skipped', reason: 'pending' })
    expect(reason(t.dep)).toMatchObject({ result: 'skipped', reason: 'money_in' })
    expect(reason(t.gusto)).toMatchObject({ result: 'skipped', reason: 'relationship_suggested' }) // a payroll suggestion stays an individual decision
    expect(reason(t.chev)).toMatchObject({ result: 'skipped', reason: 'already_decided' }) // confirmed earlier: an override cannot silently replace it
    expect(reason(t.hd)).toMatchObject({ result: 'confirmed', bucket: 'materials' }) // no override: the normal rule
    expect((await rows()).length).toBe(before + 1)
  })

  it('an override may categorize a row that had no suggestion (still the owner\'s explicit choice, and still audited)', async () => {
    const out = await batch([t.mystery], { [t.mystery]: 'office_admin' })
    expect(out.results[0]).toMatchObject({ result: 'confirmed', bucket: 'office_admin', overridden: true })
    expect((await rows()).find(r => r.tx === t.mystery)).toMatchObject({ source: 'owner', category: 'office_admin' })
    expect((await rows()).find(r => r.tx === t.mystery)!.basis).toMatchObject({ suggested: null })
  })

  it('another organization cannot override or approve these rows, and roles below owner are refused', async () => {
    const before = await rows()
    const out = await batch([t.sbux], { [t.sbux]: 'meals' }, ownerB)
    expect(out.results[0]).toMatchObject({ result: 'skipped', reason: 'not_found' })
    for (const role of ['employee', 'viewer']) expect((await batch([t.sbux], { [t.sbux]: 'meals' }, { ...owner, role }).catch(e => e)).httpStatus).toBe(403)
    expect(await rows()).toEqual(before)
  })

  it('the draft scope is opaque, stable, and private to the organization AND user', async () => {
    const a1 = (await getExplorer(w.deps, owner, { limit: 5 })).draftScope, a2 = (await getExplorer(w.deps, owner, { limit: 5 })).draftScope
    const b = (await getExplorer(w.deps, ownerB, { limit: 5 })).draftScope, otherUser = (await getExplorer(w.deps, { ...owner, userId: 'b0000000-0000-4000-8000-0000000000ff' }, { limit: 5 })).draftScope
    expect(a1).toMatch(/^[0-9a-f]{16}$/); expect(a1).toBe(a2)
    expect(new Set([a1, b, otherUser]).size).toBe(3)
    expect(a1).not.toContain(ORG.slice(0, 8)); expect(JSON.stringify(a1)).not.toContain(OWNER.slice(0, 8))
  })

  it('through all of it nothing canonical changed and no provider-sourced ledger row exists', async () => {
    expect(await w.canonical()).toBe(baseline)
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_transactions WHERE source_type = 'future_provider' OR source_kind = 'provider_transaction'`))[0].n).toBe(0)
  })
})
