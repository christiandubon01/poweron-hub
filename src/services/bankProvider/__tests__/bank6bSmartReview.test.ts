import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createSpendingRepo } from '../spending/spendingRepo'
import { applyDecision, getExplorer, getSmartReview, getTransactionHistory, MAX_BATCH } from '../spending/spendingService'
import { buildHandler } from '../../../../netlify/functions/bank/plaid-spending'

/**
 * BANK-6B: Smart Review + owner-approved merchant rules. Real repo + real service on REAL PostgreSQL (PGlite) with every migration through 157.
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
  '143_cash_dated_obligations', '146_balance_reconciliation_kind', '153_bank_provider_evidence_foundation', '154_bank_provider_credentials', '155_bank_interpretation_model', '156_bank_provider_environment', '157_bank_merchant_rules']

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
        sql = `UPDATE public.${this.table} SET ${keys.map(k => `${k} = ${ph(this.payload[k])}`).join(',')}${w}${this.ret !== '*' ? ` RETURNING ${this.ret}` : ''}`
      } else {
        sql = `SELECT ${this.cols} FROM public.${this.table}${w}${this.ord.length ? ' ORDER BY ' + this.ord.join(',') : ''}${this.to >= this.from && this.to >= 0 ? ` LIMIT ${this.to - this.from + 1} OFFSET ${this.from}` : this.lim ? ` LIMIT ${this.lim}` : ''}`
      }
      try {
        const rows = (await db.query(sql, params)).rows
        if (this.op === 'update') return { data: this.ret === '*' ? null : rows, error: null }
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

describe.runIf(!!PGliteCtor)('BANK-6B Smart Review (real PostgreSQL, suggestions and interpretations only)', () => {
  let w: Awaited<ReturnType<typeof build>>
  const t: Record<string, string> = {}
  let baseline = ''
  const smart = (actor = owner, q: Record<string, unknown> = {}) => getSmartReview(w.deps, actor, q)
  const batch = (transactionIds: string[], extra: Record<string, unknown> = {}, actor = owner) => applyDecision(w.deps, actor, { action: 'confirm_batch', transactionIds, ...extra } as any) as Promise<any>
  const groupOf = async (merchantKey: string) => (await smart()).groups.filter(g => g.merchantKey === merchantKey)
  const decisions = async () => w.q(`SELECT provider_transaction_ref AS tx, category, source, status FROM public.financial_provider_interpretations ORDER BY created_at`)
  beforeAll(async () => {
    w = await build()
    t.net1 = await w.tx('NETLIFY', 19, '2026-09-01'); t.net2 = await w.tx('NETLIFY', 19, '2026-09-08'); t.net3 = await w.tx('NETLIFY', 19, '2026-09-15')
    t.oll = await w.tx('OLLAMA', 20, '2026-09-02'); t.el = await w.tx('ELEVENLABS', 22, '2026-09-03')
    t.apple = await w.tx('APPLE', 35, '2026-09-05', { category: { primary: 'BANK_FEES', detailed: 'BANK_FEES_OTHER_BANK_FEES', confidence: 'VERY_HIGH' } })
    t.vons = await w.tx('VONS #1234', 83.51, '2026-09-08', { category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES', confidence: 'HIGH' } })
    t.casa = await w.tx('CASA BLANCA RESTAURANT', 100, '2026-09-11')
    t.az = await w.tx('AUTOZONE #4421', 11.95, '2026-09-17')
    t.od = await w.tx('OVERDRAFT FEE', 35, '2026-09-18'); t.atm = await w.tx('NON-WF ATM FEE', 2.5, '2026-09-19')
    t.hd1 = await w.tx('THE HOME DEPOT #6', 120, '2026-09-20'); t.hd2 = await w.tx('THE HOME DEPOT #9', 60, '2026-09-21')
    t.gusto = await w.tx('GUSTO PAYROLL 4412', 4200, '2026-09-22'); t.draw = await w.tx('OWNER DRAW', 1000, '2026-09-23'); t.dep = await w.tx('MOBILE DEPOSIT', -2500, '2026-09-24')
    t.card = await w.tx('WELLS FARGO CREDIT CARD AUTOPAY', 350, '2026-09-25'); t.mystery = await w.tx('ZZQ HOLDINGS', 40, '2026-09-26'); t.pend = await w.tx('NETLIFY', 19, '2026-10-06', { pending: true })
    t.dupA = await w.tx('ADOBE', 55, '2026-09-27'); t.dupB = await w.tx('ADOBE', 55, '2026-09-27')
    t.big = await w.tx('STAPLES', 5000, '2026-09-28'); for (const [i, d] of [10, 12, 11].entries()) t[`st${i}`] = await w.tx('STAPLES', d, `2026-09-0${i + 1}`)
    baseline = await w.canonical()
  }, 180_000)
  afterAll(async () => { await w?.db?.close?.() })

  it('groups unreviewed posted money-out by normalized merchant + suggested category: count, combined outgoing amount, confidence, individual rows kept', async () => {
    const [g] = await groupOf('NETLIFY')
    expect(g).toMatchObject({ merchant: 'NETLIFY', bucket: { key: 'software_subscriptions' }, confidence: 'high', count: 3, totalMinor: 5700, needsChoice: false, mixed: false })
    expect(g.rows.map(r => [r.date, r.amountMinor]).sort()).toEqual([['2026-09-01', 1900], ['2026-09-08', 1900], ['2026-09-15', 1900]])
    expect(g.rows.map(r => r.id)).not.toContain(t.pend) // pending is not groupable
  })

  it('never hides a transaction: every unreviewed row is either in exactly one group or in exactly one exception list', async () => {
    const s = await smart()
    const inGroups = s.groups.flatMap(g => g.rows.map(r => r.id))
    const inExceptions = s.exceptions.flatMap(e => e.rows.map(r => r.id))
    expect(new Set([...inGroups, ...inExceptions]).size).toBe(inGroups.length + inExceptions.length) // no duplicates
    expect([...inGroups, ...inExceptions].sort()).toEqual(Object.values(t).sort())
    expect(s.totals.groupedCount + s.totals.exceptionCount).toBe(Object.values(t).length)
  })

  it('exceptions never enter a group: payroll, owner draw, deposits, card payments, pending, unclear merchants', async () => {
    const s = await smart()
    const reasonOf = (id: string) => s.exceptions.find(e => e.rows.some(r => r.id === id))?.reason
    expect(reasonOf(t.gusto)).toBe('payroll'); expect(reasonOf(t.draw)).toBe('owner_or_personal'); expect(reasonOf(t.dep)).toBe('money_in')
    expect(reasonOf(t.card)).toBe('transfer'); expect(reasonOf(t.pend)).toBe('pending'); expect(reasonOf(t.mystery)).toBe('unclear')
    const grouped = new Set(s.groups.flatMap(g => g.rows.map(r => r.id)))
    for (const id of [t.gusto, t.draw, t.dep, t.card, t.pend, t.mystery]) expect(grouped.has(id)).toBe(false)
  })

  it('suggestion quality: Apple is NOT a bank fee (and not assumed software), Ollama / ElevenLabs are possible software, overdraft and ATM fees are bank fees', async () => {
    const e = await getExplorer(w.deps, owner, { limit: 200 })
    const by = (id: string) => e.rows.find(r => r.id === id)!
    expect(by(t.apple).bucket.key).not.toBe('bank_finance_fees')
    expect(by(t.apple).bucket).toMatchObject({ key: 'software_subscriptions', confidence: 'possible', mixed: true })
    expect(by(t.oll).bucket).toMatchObject({ key: 'software_subscriptions', confidence: 'possible', state: 'suggested' })
    expect(by(t.el).bucket).toMatchObject({ key: 'software_subscriptions', confidence: 'possible', state: 'suggested' })
    expect(by(t.od).bucket).toMatchObject({ key: 'bank_finance_fees', confidence: 'high' })
    expect(by(t.atm).bucket).toMatchObject({ key: 'bank_finance_fees', confidence: 'high' })
  })

  it('mixed-purpose merchants (Home Depot, grocery, restaurants, gas, Apple) need the owner to pick the category; software with possible confidence too', async () => {
    const s = await smart()
    const g = s.groups.find(x => x.merchantKey.startsWith('HOME DEPOT'))!
    expect(g).toMatchObject({ mixed: true, needsChoice: true, bucket: { key: 'materials' } })
    for (const key of ['VONS', 'CASA BLANCA', 'AUTOZONE']) expect(s.groups.find(x => x.merchantKey === key), key).toMatchObject({ mixed: true, needsChoice: true })
    const out = await batch([t.vons, t.casa, t.az, t.hd1, t.apple, t.oll])
    expect(out.results.filter((r: any) => r.reason === 'mixed_purpose').map((r: any) => r.id).sort()).toEqual([t.casa, t.az, t.hd1].sort())
    for (const id of [t.vons, t.apple, t.oll]) expect(out.results.find((r: any) => r.id === id)).toMatchObject({ result: 'skipped', reason: 'not_high_confidence' }) // weak suggestions are not bulk-approvable either
    expect(await decisions()).toEqual([]) // nothing was approved silently
  })

  it('flags unusual amounts, same-day duplicates and a bank category that disagrees, without hiding the rows', async () => {
    const s = await smart()
    const staples = s.groups.find(x => x.merchantKey === 'STAPLES')!
    expect(staples.count).toBe(4)
    expect(staples.rows.find(r => r.id === t.big)!.flags).toContain('unusual_amount')
    expect(staples.flaggedCount).toBe(1)
    const adobe = s.groups.find(x => x.merchantKey === 'ADOBE')!
    expect(adobe.rows.every(r => r.flags.includes('possible_duplicate'))).toBe(true)
    const vons = s.groups.find(x => x.merchantKey === 'VONS')!
    expect(vons.rows[0].flags).toEqual([]) // groceries map to Meals at the bank and in our suggestion: no disagreement to flag
  })

  it('the owner picks the categories (Vons = business fuel, Casa Blanca = personal, AutoZone = Tools & Equipment); each is the owner\'s decision and the original suggestion is kept in the audit basis', async () => {
    const out = await batch([t.vons, t.az], { categoryOverrides: { [t.vons]: 'fuel_vehicle', [t.az]: 'tools_equipment' } })
    expect(out).toMatchObject({ confirmed: 2, skipped: 0 })
    expect((await decisions()).map(d => [d.tx, d.category, d.source]).sort()).toEqual([[t.vons, 'fuel_vehicle', 'owner'], [t.az, 'tools_equipment', 'owner']].sort())
    const { history } = await getTransactionHistory(w.deps, owner, t.vons)
    expect(history.map(h => [h.label, h.status, h.source])).toEqual([['Fuel / Vehicle', 'confirmed', 'owner']])
    // personal food is not an everyday batch category: it is an individual decision
    expect((await batch([t.casa], { categoryOverrides: { [t.casa]: 'personal_owner' } }).catch(e => e)).httpStatus).toBe(400)
    expect(await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.casa, bucket: 'personal_owner' })).toEqual({ outcome: 'created' })
    const s = await smart()
    expect(s.groups.flatMap(g => g.rows.map(r => r.id))).not.toContain(t.vons) // reviewed rows leave Smart Review
    expect(await w.canonical()).toBe(baseline)
  })

  it('remembering a category: saved ONLY for merchants whose rows were actually approved, derived by the server, never auto-approving anything', async () => {
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_merchant_rules`))[0].n).toBe(0)
    const out = await batch([t.net1], { rememberTransactionIds: [t.net1] })
    expect(out.rules.saved).toEqual([{ merchantKey: 'NETLIFY', label: 'NETLIFY', category: 'software_subscriptions' }])
    const rules = await w.q(`SELECT merchant_key, category, status FROM public.financial_provider_merchant_rules`)
    expect(rules).toEqual([{ merchant_key: 'NETLIFY', category: 'software_subscriptions', status: 'active' }])
    // the other two Netlify transactions are NOT approved just because a rule exists
    expect((await decisions()).map(d => d.tx)).not.toContain(t.net2)
    const [g] = await groupOf('NETLIFY')
    expect(g).toMatchObject({ count: 2, basis: 'owner_rule', needsChoice: false })
    const e = await getExplorer(w.deps, owner, { limit: 200 })
    expect(e.rows.find(r => r.id === t.net2)!.bucket).toMatchObject({ state: 'suggested', basis: 'owner_rule' })
    expect(e.options.merchantRules).toEqual([{ merchantKey: 'NETLIFY', label: 'NETLIFY', category: 'software_subscriptions', categoryLabel: 'Software / Subscriptions' }])
  })

  it('"this transaction only" saves no rule', async () => {
    const out = await batch([t.dupA, t.dupB])
    expect(out.rules.saved).toEqual([])
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_merchant_rules`))[0].n).toBe(1)
  })

  it('a remembered rule PREFILLS a mixed-purpose merchant but never removes the owner\'s category confirmation (server-enforced), and never beats fee, payroll or owner-draw text', async () => {
    const out = await batch([t.hd1, t.hd2], { categoryOverrides: { [t.hd1]: 'materials', [t.hd2]: 'materials' }, rememberTransactionIds: [t.hd1] })
    expect(out.rules.saved[0]).toMatchObject({ merchantKey: 'HOME DEPOT', category: 'materials' })
    const later = await w.tx('THE HOME DEPOT #77', 44, '2026-10-01')
    const g = (await smart()).groups.find(x => x.rows.some(r => r.id === later))!
    expect(g).toMatchObject({ basis: 'owner_rule', mixed: true, needsChoice: true, bucket: { key: 'materials' } }) // prefilled, but the owner must still confirm
    // server-side: approving the group on the remembered suggestion alone is refused; nothing is decided
    const refused = await batch([later])
    expect(refused.results[0]).toMatchObject({ result: 'skipped', reason: 'mixed_purpose' })
    expect((await decisions()).map(d => d.tx)).not.toContain(later)
    // an explicit category confirmation for the group goes through, as the OWNER's decision
    const confirmed = await batch([later], { categoryOverrides: { [later]: 'materials' } })
    expect(confirmed.results[0]).toMatchObject({ result: 'confirmed', bucket: 'materials', overridden: true })
    expect((await decisions()).find(d => d.tx === later)).toMatchObject({ source: 'owner', category: 'materials' })
    // earlier approvals are untouched
    expect((await decisions()).filter(d => [t.hd1, t.hd2].includes(d.tx)).every(d => d.status === 'confirmed' && d.source === 'owner')).toBe(true)
    // the rule never wins over fee wording
    const fee = await w.tx('HOME DEPOT OVERDRAFT FEE', 35, '2026-10-02')
    const e = await getExplorer(w.deps, owner, { limit: 200 })
    expect(e.rows.find(r => r.id === fee)!.bucket).toMatchObject({ key: 'bank_finance_fees', basis: 'fee_rule' })
  })

  it('a rule never overrides an explicit decision already made, and the original decision is not rewritten', async () => {
    await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.net2, bucket: 'office_admin' })
    const e = await getExplorer(w.deps, owner, { limit: 200 })
    expect(e.rows.find(r => r.id === t.net2)!.bucket).toMatchObject({ key: 'office_admin', state: 'confirmed' })
    expect((await groupOf('NETLIFY')).flatMap(g => g.rows.map(r => r.id))).not.toContain(t.net2)
  })

  it('a rule never beats a higher-priority relationship: a payroll/transfer-looking transaction stays an exception', async () => {
    const pay = await w.tx('NETLIFY PAYROLL', 900, '2026-10-03')
    const s = await smart()
    expect(s.groups.flatMap(g => g.rows.map(r => r.id))).not.toContain(pay)
    expect(s.exceptions.find(x => x.rows.some(r => r.id === pay))?.reason).toBe('payroll')
    expect((await batch([pay])).results[0]).toMatchObject({ result: 'skipped' })
  })

  it('rules are organization-scoped: another organization neither sees nor is affected by them, and cannot forget them', async () => {
    const sB = await getSmartReview(w.deps, ownerB, {})
    expect(sB.merchantRules).toEqual([]); expect(sB.groups).toEqual([])
    expect(await applyDecision(w.deps, ownerB, { action: 'forget_rule', merchantKey: 'NETLIFY' } as any)).toEqual({ outcome: 'nothing_to_forget' })
    expect((await w.q(`SELECT status FROM public.financial_provider_merchant_rules WHERE merchant_key = 'NETLIFY'`))[0].status).toBe('active')
    // a rule for another org's transaction ids cannot be created either
    const out = await batch([t.net3], { rememberTransactionIds: [t.net3] }, ownerB)
    expect(out.results[0]).toMatchObject({ result: 'skipped', reason: 'not_found' }); expect(out.rules.saved).toEqual([])
  })

  it('the browser cannot read or write rules (service role only); only everyday categories can be remembered', async () => {
    await w.db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${OWNER}', false)`)
    await expect(w.db.query(`SELECT * FROM public.financial_provider_merchant_rules`)).rejects.toThrow(/permission denied/)
    await expect(w.db.query(`INSERT INTO public.financial_provider_merchant_rules (organization_id, merchant_key, category) VALUES ($1,'X','materials')`, [ORG])).rejects.toThrow(/permission denied/)
    await w.db.exec('RESET ROLE; SET ROLE service_role')
    for (const cat of ['payroll_people', 'personal_owner', 'transfers', 'owner_draw', 'customer_payment', 'bogus']) {
      await expect(w.db.query(`INSERT INTO public.financial_provider_merchant_rules (organization_id, merchant_key, category) VALUES ($1,'BAD',$2)`, [ORG, cat])).rejects.toThrow(/check/i)
    }
  })

  it('remembering rejects bad requests before anything is written, and conflicting categories for one merchant are not remembered', async () => {
    const before = (await w.q(`SELECT count(*)::int n FROM public.financial_provider_merchant_rules`))[0].n
    expect((await batch([t.net3], { rememberTransactionIds: [t.mystery] }).catch(e => e)).httpStatus).toBe(400) // not a selected id
    expect((await batch([t.net3], { rememberTransactionIds: 'x' }).catch(e => e)).httpStatus).toBe(400)
    expect((await batch([t.net3], { rememberTransactionIds: ['nope'] }).catch(e => e)).httpStatus).toBe(400)
    const a = await w.tx('ACE HARDWARE', 10, '2026-10-04'), b = await w.tx('ACE HARDWARE', 12, '2026-10-05')
    const out = await batch([a, b], { categoryOverrides: { [a]: 'materials', [b]: 'tools_equipment' }, rememberTransactionIds: [a, b] })
    expect(out.rules.saved).toEqual([]); expect(out.rules.skipped).toEqual([{ merchantKey: 'ACE HARDWARE', reason: 'conflicting_categories' }])
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_merchant_rules`))[0].n).toBe(before)
  })

  it('forgetting a rule stops it influencing suggestions and keeps the row as history; earlier approvals are untouched', async () => {
    const approvedBefore = (await decisions()).length
    expect(await applyDecision(w.deps, owner, { action: 'forget_rule', merchantKey: 'NETLIFY' } as any)).toEqual({ outcome: 'forgotten' })
    expect((await w.q(`SELECT status, revoked_at IS NOT NULL AS r FROM public.financial_provider_merchant_rules WHERE merchant_key = 'NETLIFY'`))[0]).toEqual({ status: 'revoked', r: true })
    expect((await smart()).merchantRules.map(r => r.merchantKey)).not.toContain('NETLIFY')
    expect((await groupOf('NETLIFY'))[0]?.basis ?? 'merchant_rule').not.toBe('owner_rule')
    expect(await applyDecision(w.deps, owner, { action: 'forget_rule', merchantKey: 'NETLIFY' } as any)).toEqual({ outcome: 'nothing_to_forget' }) // idempotent
    expect((await decisions()).length).toBe(approvedBefore)
    // remembering again re-activates the same row (still one row per merchant)
    await batch([t.net3], { rememberTransactionIds: [t.net3] })
    expect((await w.q(`SELECT count(*)::int n, min(status) s FROM public.financial_provider_merchant_rules WHERE merchant_key = 'NETLIFY'`))[0]).toEqual({ n: 1, s: 'active' })
  })

  it('approval is idempotent: repeating a batch creates no duplicate interpretation and server eligibility is re-decided each time', async () => {
    const before = (await decisions()).length
    const again = await batch([t.net3, t.vons, t.az])
    expect(again.results.every((r: any) => r.result === 'skipped' && r.reason === 'already_decided')).toBe(true)
    expect((await decisions()).length).toBe(before)
    expect((await w.q(`SELECT count(*)::int n FROM (SELECT provider_transaction_ref FROM public.financial_provider_interpretations WHERE status = 'confirmed' AND kind = 'category' GROUP BY 1 HAVING count(*) > 1) d`))[0].n).toBe(0)
  })

  it('Smart Review is read-only and refuses non-owners; roles below owner cannot forget rules either', async () => {
    const before = await decisions()
    for (const role of ['employee', 'viewer']) {
      expect((await getSmartReview(w.deps, { ...owner, role }, {}).catch(e => e)).httpStatus).toBe(403)
      expect((await applyDecision(w.deps, { ...owner, role }, { action: 'forget_rule', merchantKey: 'NETLIFY' } as any).catch(e => e)).httpStatus).toBe(403)
    }
    await smart(); await smart()
    expect(await decisions()).toEqual(before)
  })

  it('through everything: no ledger row, balance, account, bill, project, payroll or evidence changed', async () => {
    // evidence is excluded only because this test file itself inserted more evidence rows along the way; every canonical table must be identical
    const strip = (j: string) => { const o = JSON.parse(j); delete o.evidence; return o }
    expect(strip(await w.canonical())).toEqual(strip(baseline))
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_transactions WHERE source_type = 'future_provider' OR source_kind = 'provider_transaction'`))[0].n).toBe(0)
  })
})

describe.runIf(!!PGliteCtor)('BANK-6B before migration 157 is applied', () => {
  it('Smart Review still works, rules are reported unavailable, and remembering saves the approval but no rule', async () => {
    const w = await build(MIGRATIONS.slice(0, -1))
    try {
      const a = await w.tx('NETLIFY', 19, '2026-09-01')
      const s = await getSmartReview(w.deps, owner, {})
      expect(s.rulesAvailable).toBe(false); expect(s.groups).toHaveLength(1)
      const out = await applyDecision(w.deps, owner, { action: 'confirm_batch', transactionIds: [a], rememberTransactionIds: [a] } as any) as any
      expect(out).toMatchObject({ confirmed: 1 }); expect(out.rules).toEqual({ saved: [], skipped: [{ merchantKey: 'NETLIFY', reason: 'unavailable' }] })
    } finally { await w.db.close?.() }
  }, 120_000)
})

describe('BANK-6B migration 157 and static guarantees', () => {
  const sql = readFileSync('supabase/migrations/157_bank_merchant_rules.sql', 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  it('is additive, creates only the rules table, and grants nothing to the browser', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.financial_provider_merchant_rules/)
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER TABLE public\.(?!financial_provider_merchant_rules)|DELETE FROM|TRUNCATE/i)
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/); expect(sql).toMatch(/REVOKE ALL ON public\.financial_provider_merchant_rules FROM PUBLIC, anon, authenticated/)
    expect(sql).not.toMatch(/GRANT[^;]*\bTO\b[^;]*(authenticated|anon|PUBLIC)/i)
  })
  it('migrations 153-156 are unchanged', () => {
    const { execSync } = require('node:child_process')
    expect(execSync('git diff --name-only HEAD -- supabase/migrations/153_bank_provider_evidence_foundation.sql supabase/migrations/154_bank_provider_credentials.sql supabase/migrations/155_bank_interpretation_model.sql supabase/migrations/156_bank_provider_environment.sql').toString().trim()).toBe('')
  })
  it('the rule code never writes interpretations on its own, a ledger, or anything canonical', () => {
    for (const f of ['../spending/smartReview.ts']) expect(readFileSync(new URL(f, import.meta.url), 'utf8')).not.toMatch(/\.insert\(|\.update\(|\.rpc\(|replaceDecision|financial_transactions/)
    expect(MAX_BATCH).toBe(100)
  })
})

describe.runIf(!!PGliteCtor)('BANK-6C Reviewed view (real PostgreSQL, read-only filter over existing decisions)', () => {
  let w: Awaited<ReturnType<typeof build>>
  const t: Record<string, string> = {}
  let baseline = ''
  const explore = (q: Record<string, unknown> = {}, actor = owner) => getExplorer(w.deps, actor, { limit: 200, ...q })
  beforeAll(async () => {
    w = await build()
    t.net = await w.tx('NETLIFY', 19, '2026-09-01'); t.hd = await w.tx('THE HOME DEPOT #6', 120, '2026-09-02'); t.casa = await w.tx('CASA BLANCA RESTAURANT', 100, '2026-09-03')
    t.dep = await w.tx('MOBILE DEPOSIT', -2500, '2026-09-04'); t.mystery = await w.tx('ZZQ HOLDINGS', 40, '2026-09-05'); t.adobe = await w.tx('ADOBE', 55, '2026-09-06')
    await applyDecision(w.deps, owner, { action: 'confirm_batch', transactionIds: [t.net, t.hd], categoryOverrides: { [t.hd]: 'materials' } } as any)
    await applyDecision(w.deps, owner, { action: 'set_bucket', transactionId: t.casa, bucket: 'personal_owner' })
    await applyDecision(w.deps, owner, { action: 'set_relationship', transactionId: t.dep, kind: 'personal' })
    await applyDecision(w.deps, owner, { action: 'ignore', transactionId: t.mystery })
    baseline = await w.canonical()
  }, 180_000)
  afterAll(async () => { await w?.db?.close?.() })

  it('shows only transactions with an active confirmed decision (category or relationship), never suggestions or excluded rows, and its count equals the Reviewed count', async () => {
    const e = await explore({ view: 'reviewed' })
    expect(e.rows.map(r => r.id).sort()).toEqual([t.net, t.hd, t.casa, t.dep].sort())
    expect(e.rows.map(r => r.id)).not.toContain(t.adobe) // a high-confidence suggestion is not "reviewed"
    expect(e.rows.map(r => r.id)).not.toContain(t.mystery) // excluded is not reviewed
    expect(e.viewCounts.reviewed).toBe(4); expect(e.reviewCounts.reviewed).toBe(4); expect(e.total).toBe(4)
    const by = (id: string) => e.rows.find(r => r.id === id)!
    expect(by(t.hd)).toMatchObject({ merchant: 'THE HOME DEPOT #6', date: '2026-09-02', amountMinor: 12000, bucket: { key: 'materials', state: 'confirmed' }, scope: { value: 'business' } })
    expect(by(t.casa)).toMatchObject({ bucket: { key: 'personal_owner', state: 'confirmed' }, scope: { value: 'personal', source: 'owner' } })
    expect(by(t.dep).relationship).toMatchObject({ kind: 'personal', state: 'confirmed' })
  })

  it('keeps the other filters: bucket, search, account and period narrow the Reviewed view', async () => {
    expect((await explore({ view: 'reviewed', bucket: 'materials' })).rows.map(r => r.id)).toEqual([t.hd])
    expect((await explore({ view: 'reviewed', search: 'netlify' })).rows.map(r => r.id)).toEqual([t.net])
    expect((await explore({ view: 'reviewed', account: w.ids.acct })).total).toBe(4)
    expect((await explore({ view: 'reviewed', from: '2026-09-03' })).rows.map(r => r.id).sort()).toEqual([t.casa, t.dep].sort())
  })

  it('undo moves a transaction out of Reviewed and the count follows; approving moves one in; history is kept', async () => {
    expect(await applyDecision(w.deps, owner, { action: 'undo', transactionId: t.hd, dimension: 'bucket' })).toEqual({ outcome: 'undone' })
    let e = await explore({ view: 'reviewed' })
    expect(e.rows.map(r => r.id)).not.toContain(t.hd); expect(e.viewCounts.reviewed).toBe(3); expect(e.reviewCounts.reviewed).toBe(3)
    expect((await getTransactionHistory(w.deps, owner, t.hd)).history.map(h => h.status)).toEqual(['undone'])
    await applyDecision(w.deps, owner, { action: 'confirm_batch', transactionIds: [t.adobe] } as any)
    e = await explore({ view: 'reviewed' })
    expect(e.rows.map(r => r.id)).toContain(t.adobe); expect(e.viewCounts.reviewed).toBe(4)
  })

  it('is organization-scoped and read-only: another organization sees nothing, and no canonical record changed', async () => {
    expect((await explore({ view: 'reviewed' }, ownerB)).total).toBe(0)
    const before = (await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n
    await explore({ view: 'reviewed' }); await explore({ view: 'reviewed', bucket: 'materials' })
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations`))[0].n).toBe(before)
    expect(await w.canonical()).toBe(baseline)
  })
})
