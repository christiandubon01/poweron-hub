import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * BANK-6P on REAL PostgreSQL (PGlite): migration 156 gives provider Items a durable environment and puts a database wall between provider
 * evidence and canonical records. Everything here runs in a throwaway in-memory database; production is never touched.
 */
let PGliteCtor: any = null
try { const m = await import('@electric-sql/pglite'); PGliteCtor = m.PGlite } catch { PGliteCtor = null }

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

const BASE = ['139_cash_accounts_manual_ledger', '140_cash_linked_pair_lifecycle_hardening', '141_cash_transfer_conflict_target_fix', '142_cash_pair_void_link_lock_fix',
  '143_cash_dated_obligations', '146_balance_reconciliation_kind', '153_bank_provider_evidence_foundation', '154_bank_provider_credentials', '155_bank_interpretation_model']
const M156 = '156_bank_provider_environment'
const sql = (n: string) => readFileSync(`supabase/migrations/${n}.sql`, 'utf8')
const ENVELOPE = `v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}`

async function build(withEnvironment: boolean) {
  const db = new PGliteCtor()
  await db.exec(BOOTSTRAP)
  for (const n of BASE) await db.exec(sql(n))
  await db.exec('SET ROLE service_role')
  const q = async (text: string, p: any[] = []) => (await db.query(text, p)).rows as any[]
  const asBrowser = async <T,>(fn: () => Promise<T>): Promise<T> => {
    await db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${OWNER}', false)`)
    try { return await fn() } finally { await db.exec('RESET ROLE; SET ROLE service_role') }
  }
  // A Sandbox Item created exactly as production's was: through the 154 connect function, before 156 exists.
  const sandboxItem = (await q(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid','item-sandbox','ins_1','Tartan Bank',$2,$3)`, [ORG, ENVELOPE, OWNER]))[0].item_id
  const mkAccount = async (item: string, pid: string, name: string) => (await q(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name, mask, currency, status) VALUES ($1,$2,$3,$4,'0000','USD','active') RETURNING id`, [ORG, item, pid, name]))[0].id
  const mkTx = async (item: string, acct: string, name: string, dollars: number, date: string, pending = false) => (await q(
    `INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, currency, transaction_date, name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'USD',$8,$9) RETURNING id`, [ORG, item, acct, `ptx-${Math.random().toString(36).slice(2)}`, pending, dollars, Math.round(dollars * 100), date, name]))[0].id
  const fin = (await q(`INSERT INTO public.financial_accounts (organization_id, display_name, account_type, account_class, ownership_context, include_in_cash) VALUES ($1,'Wells Fargo Business Checking 6960','checking','asset','business',true) RETURNING id`, [ORG]))[0].id
  const sAcct = await mkAccount(sandboxItem, 'acc-s', 'Plaid Checking')
  await q(`INSERT INTO public.financial_provider_account_mappings (organization_id, provider_account_ref, financial_account_id, status, mapped_by) VALUES ($1,$2,$3,'active',$4)`, [ORG, sAcct, fin, OWNER])
  const sTx = await mkTx(sandboxItem, sAcct, 'UNITED AIRLINES', 500, '2026-10-01')
  await q(`INSERT INTO public.financial_transactions (organization_id, account_id, amount_minor, transaction_date, transaction_kind, economic_effect, economic_amount_minor, description, idempotency_key) VALUES ($1,$2,100000,'2026-09-01','opening_balance','none',0,'opening','open-1'), ($1,$2,-8899,'2026-09-20','expense','outflow',8899,'manual expense','manual-1')`, [ORG, fin])
  if (withEnvironment) { await db.exec('RESET ROLE'); await db.exec(sql(M156)); await db.exec('SET ROLE service_role') }
  const snapshot = async () => JSON.stringify({
    ledger: await q(`SELECT * FROM public.financial_transactions ORDER BY id`), accounts: await q(`SELECT id, display_name, include_in_cash, status FROM public.financial_accounts ORDER BY id`),
    evidence: await q(`SELECT * FROM public.financial_provider_transactions ORDER BY id`), mappings: await q(`SELECT * FROM public.financial_provider_account_mappings ORDER BY id`),
    interpretations: await q(`SELECT * FROM public.financial_provider_interpretations ORDER BY id`), provider_accounts: await q(`SELECT * FROM public.financial_provider_accounts ORDER BY id`),
  })
  return { db, q, asBrowser, sandboxItem, sAcct, sTx, fin, mkAccount, mkTx, snapshot }
}
const fail = async (p: Promise<unknown>) => { try { await p; return null } catch (e) { return String((e as Error).message) } }

describe.runIf(!!PGliteCtor)('BANK-6P migration 156 on real PostgreSQL', () => {
  it('backfills every existing Item as SANDBOX and changes no financial, evidence, mapping or interpretation row', async () => {
    const w = await build(false)
    const before = await w.snapshot()
    await w.db.exec('RESET ROLE'); await w.db.exec(sql(M156)); await w.db.exec('SET ROLE service_role')
    expect(await w.snapshot()).toBe(before) // not one row of any financial / evidence / mapping / interpretation table changed
    expect((await w.q(`SELECT environment FROM public.financial_provider_items`)).map(r => r.environment)).toEqual(['sandbox'])
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_transactions`))[0].n).toBe(1) // existing Sandbox evidence preserved
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_account_mappings WHERE status='active'`))[0].n).toBe(1) // mapping preserved
  })

  it('a new Item must state its environment; Production is recorded explicitly; the environment is immutable and never relabelled', async () => {
    const w = await build(true)
    const connect = (item: string, env: string | null) => w.q(`SELECT * FROM public.financial_provider_connect_item($1,'plaid',$2,'ins_2','Wells Fargo',$3,$4,$5)`, [ORG, item, ENVELOPE, OWNER, env])
    expect(await fail(connect('item-x', null))).toMatch(/PROVIDER_ENVIRONMENT_REQUIRED/)
    expect(await fail(connect('item-x', 'live'))).toMatch(/PROVIDER_ENVIRONMENT_REQUIRED/)
    const prod = (await connect('item-prod', 'production'))[0]
    expect(prod.outcome).toBe('created')
    expect((await w.q(`SELECT environment FROM public.financial_provider_items WHERE id=$1`, [prod.item_id]))[0].environment).toBe('production')
    expect((await connect('item-prod', 'production'))[0].outcome).toBe('credential_rotated') // idempotent reconnect keeps it
    expect(await fail(connect('item-prod', 'sandbox'))).toMatch(/PROVIDER_ITEM_ENVIRONMENT_MISMATCH/) // never relabelled
    expect(await fail(connect('item-sandbox', 'production'))).toMatch(/PROVIDER_ITEM_ENVIRONMENT_MISMATCH/) // a Sandbox Item is never treated as Production
    expect(await fail(w.q(`UPDATE public.financial_provider_items SET environment='production' WHERE id=$1`, [w.sandboxItem]))).toMatch(/environment is immutable/)
    expect(await fail(w.q(`INSERT INTO public.financial_provider_items (organization_id, provider, provider_item_id) VALUES ($1,'plaid','no-env')`, [ORG]))).toBeTruthy() // no silent default
  })

  it('the old 7-argument connect (code deployed before 156) can only ever create or touch a SANDBOX Item', async () => {
    const w = await build(true)
    const id = (await w.q(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid','legacy-call','ins_9','X',$2,$3)`, [ORG, ENVELOPE, OWNER]))[0].item_id
    expect((await w.q(`SELECT environment FROM public.financial_provider_items WHERE id=$1`, [id]))[0].environment).toBe('sandbox')
    const prod = (await w.q(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid','item-prod','ins_2','WF',$2,$3,'production')`, [ORG, ENVELOPE, OWNER]))[0].item_id
    expect(await fail(w.q(`SELECT * FROM public.financial_provider_connect_item($1,'plaid','item-prod','ins_2','WF',$2,$3)`, [ORG, ENVELOPE, OWNER]))).toMatch(/PROVIDER_ITEM_ENVIRONMENT_MISMATCH/)
    expect((await w.q(`SELECT environment FROM public.financial_provider_items WHERE id=$1`, [prod]))[0].environment).toBe('production')
  })

  it('Sandbox evidence can NEVER be adopted: a provider-sourced ledger row or a ledger_match for it is refused, even for the server role', async () => {
    const w = await build(true)
    const before = await w.snapshot()
    const adopt = (txId: string | null, over: Record<string, unknown> = {}) => w.q(
      `INSERT INTO public.financial_transactions (organization_id, account_id, amount_minor, transaction_date, transaction_kind, economic_effect, economic_amount_minor, description, source_type, source_organization_id, source_kind, source_record_id, idempotency_key)
       VALUES ($1,$2,-50000,'2026-10-01','expense','outflow',50000,'adopted','future_provider',$1,'provider_transaction',$3,$4)`, [ORG, w.fin, txId, `provider_transaction:${txId}${over.suffix ?? ''}`])
    expect(await fail(adopt(w.sTx))).toMatch(/SANDBOX_EVIDENCE_NOT_ADOPTABLE/)
    expect(await fail(adopt('00000000-0000-4000-8000-0000000000aa'))).toMatch(/PROVIDER_LEDGER_SOURCE_NOT_FOUND/)
    expect(await fail(w.q(`INSERT INTO public.financial_transactions (organization_id, account_id, amount_minor, transaction_date, transaction_kind, economic_effect, economic_amount_minor, description, source_type, idempotency_key) VALUES ($1,$2,-1,'2026-10-01','expense','outflow',1,'x','future_provider','k-fp')`, [ORG, w.fin]))).toMatch(/PROVIDER_LEDGER_SOURCE_INVALID/)
    expect(await fail(w.q(`INSERT INTO public.financial_transactions (organization_id, account_id, amount_minor, transaction_date, transaction_kind, economic_effect, economic_amount_minor, description, source_type, source_organization_id, source_kind, source_record_id, idempotency_key) VALUES ($1,$2,-1,'2026-10-01','expense','outflow',1,'x','manual',$1,'provider_transaction','abc','k-pt')`, [ORG, w.fin]))).toMatch(/PROVIDER_LEDGER_SOURCE_INVALID/)
    expect(await fail(w.q(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, match_mode, ledger_transaction_id, decided_at, decided_by) SELECT $1,$2,'ledger_match','confirmed','owner','high','linked', id, now(), $3 FROM public.financial_transactions LIMIT 1`, [ORG, w.sTx, OWNER]))).toMatch(/SANDBOX_EVIDENCE_NOT_ADOPTABLE/)
    expect(await w.snapshot()).toBe(before) // every refusal left everything untouched
  })

  it('PRODUCTION evidence is not adoptable either until BANK-6: no provider-sourced ledger row or ledger_match can exist, for any role', async () => {
    const w = await build(true)
    const prodItem = (await w.q(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid','item-prod','ins_2','WF',$2,$3,'production')`, [ORG, ENVELOPE, OWNER]))[0].item_id
    const pAcct = await w.mkAccount(prodItem, 'acc-p', 'Business Checking')
    const pTx = await w.mkTx(prodItem, pAcct, 'HOME DEPOT', 120, '2026-10-02')
    const before = await w.snapshot()
    expect(await fail(w.q(`INSERT INTO public.financial_transactions (organization_id, account_id, amount_minor, transaction_date, transaction_kind, economic_effect, economic_amount_minor, description, source_type, source_organization_id, source_kind, source_record_id, idempotency_key)
       VALUES ($1,$2,-12000,'2026-10-02','expense','outflow',12000,'adopted','future_provider',$1,'provider_transaction',$3,$4)`, [ORG, w.fin, pTx, `provider_transaction:${pTx}`]))).toMatch(/PROVIDER_ADOPTION_NOT_ENABLED/)
    expect(await fail(w.q(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, match_mode, ledger_transaction_id, decided_at, decided_by) SELECT $1,$2,'ledger_match','confirmed','owner','high','linked', id, now(), $3 FROM public.financial_transactions LIMIT 1`, [ORG, pTx, OWNER]))).toMatch(/PROVIDER_ADOPTION_NOT_ENABLED/)
    expect(await w.snapshot()).toBe(before) // the ledger (and everything else) is byte-identical
    // Evidence itself stays freely writable by the server (sync) and a normal manual entry is unaffected.
    expect(await fail(w.mkTx(prodItem, pAcct, 'CHEVRON', 40, '2026-10-03'))).toBeNull()
  })

  it('the BROWSER (authenticated owner) cannot create provider-sourced ledger rows or ledger_match interpretations, but normal behaviour is unchanged', async () => {
    const w = await build(true)
    const prodItem = (await w.q(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid','item-prod','ins_2','WF',$2,$3,'production')`, [ORG, ENVELOPE, OWNER]))[0].item_id
    const pTx = await w.mkTx(prodItem, await w.mkAccount(prodItem, 'acc-p', 'Business Checking'), 'HOME DEPOT', 120, '2026-10-02')
    const forged = (src: string, kind: string | null, rec: string | null, key: string) => w.asBrowser(() => w.q(
      `INSERT INTO public.financial_transactions (organization_id, account_id, amount_minor, transaction_date, transaction_kind, economic_effect, economic_amount_minor, description, source_type, source_organization_id, source_kind, source_record_id, idempotency_key)
       VALUES ($1,$2,-100,'2026-10-02','expense','outflow',100,'forged',$3,$4,$5,$6,$7)`, [ORG, w.fin, src, kind ? ORG : null, kind, rec, key]))
    expect(await fail(forged('future_provider', 'provider_transaction', pTx, 'forge-1'))).toMatch(/PROVIDER_ADOPTION_NOT_ENABLED|row-level security/)
    // (BEFORE triggers run before the row-level-security check, so a malformed forgery is stopped by the trigger and a well-formed one by the policy)
    expect(await fail(forged('manual', 'provider_transaction', pTx, 'forge-2'))).toMatch(/PROVIDER_LEDGER_SOURCE_INVALID|row-level security/)
    expect(await fail(forged('future_provider', null, null, 'forge-3'))).toMatch(/PROVIDER_LEDGER_SOURCE_INVALID|row-level security/)
    expect(await fail(forged('manual', null, null, 'normal-manual'))).toBeNull() // a normal manual entry still works
    expect(await fail(w.asBrowser(() => w.q(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, match_mode, ledger_transaction_id) SELECT $1,$2,'ledger_match','suggested','owner','high','linked', id FROM public.financial_transactions LIMIT 1`, [ORG, pTx])))).toMatch(/PROVIDER_ADOPTION_NOT_ENABLED|row-level security/)
    expect(await fail(w.asBrowser(() => w.q(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, category) VALUES ($1,$2,'category','suggested','owner','high','meals')`, [ORG, pTx])))).toBeNull() // owner category notes still allowed
  })

  it('from scratch 139 -> 156 applies, re-running 156 is clean, and migrations 153/154/155 are untouched', async () => {
    const w = await build(true)
    for (let i = 0; i < 2; i++) { await w.db.exec('RESET ROLE'); await w.db.exec(sql(M156)); await w.db.exec('SET ROLE service_role') }
    expect((await w.q(`SELECT environment FROM public.financial_provider_items WHERE id=$1`, [w.sandboxItem]))[0].environment).toBe('sandbox')
    const changed = execSync('git status --porcelain -- supabase/migrations/153_bank_provider_evidence_foundation.sql supabase/migrations/154_bank_provider_credentials.sql supabase/migrations/155_bank_interpretation_model.sql').toString().trim()
    expect(changed).toBe('')
  })

  it('function privileges: the connect functions are service_role only; the guard functions are not callable by anyone', async () => {
    const w = await build(true)
    const can = async (role: string, fn: string) => (await w.q(`SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS ok`, [role, fn]))[0].ok
    const connect8 = 'public.financial_provider_connect_item(uuid,text,text,text,text,text,uuid,text)'
    expect([await can('service_role', connect8), await can('authenticated', connect8), await can('anon', connect8)]).toEqual([true, false, false])
    for (const g of ['public.financial_provider_guard_ledger_source()', 'public.financial_provider_guard_ledger_match()']) {
      expect([await can('authenticated', g), await can('anon', g), await can('public', g)]).toEqual([false, false, false])
    }
    const meta = await w.q(`SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname IN ('financial_provider_guard_ledger_source','financial_provider_guard_ledger_match') ORDER BY 1`)
    expect(meta.every(m => m.prosecdef === true && JSON.stringify(m.proconfig).includes('search_path=public'))).toBe(true)
  })

  it('the file is one transaction, contains no INSERT/DELETE/TRUNCATE on any table, and creates no adoption function', () => {
    const text = sql(M156).replace(/--.*$/gm, '')
    expect(text.trim().startsWith('BEGIN;')).toBe(true); expect(text.trim().endsWith('COMMIT;')).toBe(true)
    expect(text).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b|\bDROP\s+COLUMN\b/i)
    expect(text).not.toMatch(/\bUPDATE\s+public\.financial_(transactions|accounts|obligations)/i)
    expect([...text.matchAll(/INSERT INTO\s+(public\.[a-z_]+)/gi)].map(m => m[1])).toEqual(['public.financial_provider_items', 'public.financial_provider_credentials']) // only inside the connect function body
    expect([...text.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.([a-z_]+)/gi)].map(m => m[1])).toEqual(['financial_provider_connect_item', 'financial_provider_connect_item', 'financial_provider_guard_ledger_source', 'financial_provider_guard_ledger_match']) // no adoption function exists
  })
})
