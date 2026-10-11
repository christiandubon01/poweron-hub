// @ts-nocheck -- direct SQL against PGlite
/**
 * PLAID-1E: final-apply performance and safety of docs/plaid1c/resumable-sync-proposal.sql on PostgreSQL (PGlite), with every bank migration
 * production carries (153-158, including BANK-6G's merchant rules) loaded first. Staging and the final apply are timed separately.
 *
 * PLAID-1D found the removal step quadratic (staged rows x existing evidence rows); these tests pin the linear form and the safeguards:
 * the 50,000-row run limit, the repeated-apply-failure block, rollback, fencing and organization isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

let PGliteCtor = null
try { PGliteCtor = (await import('@electric-sql/pglite')).PGlite } catch { PGliteCtor = null }

const ORG = '10000000-0000-4000-8000-00000000000a'
const ORG_B = '10000000-0000-4000-8000-00000000000b'
const OWNER_ID = 'b0000000-0000-4000-8000-000000000001'
const LEASE = '2026-10-11T12:00:00Z'
const BOOTSTRAP = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.organizations(id uuid PRIMARY KEY, name text);
CREATE TABLE public.test_profiles(id uuid PRIMARY KEY, org uuid, role text);
CREATE FUNCTION public.user_org_id() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT org FROM public.test_profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.is_org_admin_for(p uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM public.test_profiles WHERE id = auth.uid() AND org = p AND role IN ('owner','admin')) $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), public.user_org_id(), public.is_org_admin_for(uuid) TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
INSERT INTO public.organizations VALUES ('${ORG}','A'),('${ORG_B}','B');
INSERT INTO auth.users VALUES ('${OWNER_ID}');
INSERT INTO public.test_profiles VALUES ('${OWNER_ID}','${ORG}','owner');`
const MIGRATIONS = ['139_cash_accounts_manual_ledger', '140_cash_linked_pair_lifecycle_hardening', '141_cash_transfer_conflict_target_fix', '142_cash_pair_void_link_lock_fix',
  '143_cash_dated_obligations', '144_cash_os_buckets_envelopes', '145_cash_liability_terms', '146_balance_reconciliation_kind', '147_cash_owner_facts',
  '153_bank_provider_evidence_foundation', '154_bank_provider_credentials', '155_bank_interpretation_model', '156_bank_provider_environment',
  '157_bank_merchant_rules', '158_cash_os_display_colors']

/** jsonb for one page of `per` changes, built server-side. kind: 'added' | 'mixed' (50% modified existing, 20% removed, 30% added). */
const pageJson = (kind, p, per) => kind === 'added'
  ? `(SELECT jsonb_agg(jsonb_build_object('change_kind','added','provider_transaction_id','t${p}-' || j,'provider_account_ref',($1::uuid[])[1 + j % 3],
      'pending',(j % 25 = 0),'provider_amount',(j % 5000) + 0.37,'provider_amount_minor',(j % 5000) * 100 + 37,'currency','USD',
      'transaction_date',(DATE '2026-07-01' + (j % 90))::text,'name','PURCHASE AUTHORIZED HOME DEPOT #' || j,'merchant_name','Merchant ' || (j % 400),
      'provider_category',jsonb_build_object('primary','GENERAL_MERCHANDISE')) ORDER BY j) FROM generate_series(0, ${per - 1}) j)`
  : `(SELECT jsonb_agg(CASE
      WHEN j % 10 < 5 THEN jsonb_build_object('change_kind','modified','provider_transaction_id','old-' || (${p * per} + j + 1),'provider_account_ref',($1::uuid[])[1 + (${p * per} + j + 1) % 3],
        'pending',false,'provider_amount',12.5,'provider_amount_minor',1250,'currency','USD','transaction_date','2026-09-01','name','MODIFIED')
      WHEN j % 10 < 7 THEN jsonb_build_object('change_kind','removed','provider_transaction_id','old-' || (${p * per} + j + 1))
      ELSE jsonb_build_object('change_kind','added','provider_transaction_id','new${p}-' || j,'provider_account_ref',($1::uuid[])[1 + j % 3],'pending',false,
        'pending_provider_transaction_id',CASE WHEN j % 20 = 7 THEN 'old-' || (${p * per} + j) END,
        'provider_amount',99.99,'provider_amount_minor',9999,'currency','USD','transaction_date','2026-10-01','name','NEW ' || j) END ORDER BY j) FROM generate_series(0, ${per - 1}) j)`

describe.runIf(!!PGliteCtor)('PLAID-1E final apply on PostgreSQL (PGlite)', () => {
  let db
  const timings = {}
  beforeAll(async () => {
    db = new PGliteCtor(); await db.exec(BOOTSTRAP)
    for (const m of MIGRATIONS) await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'))
    await db.exec(readFileSync('docs/plaid1c/resumable-sync-proposal.sql', 'utf8'))
    await db.exec('SET ROLE service_role')
  }, 120_000)
  afterAll(async () => { console.log('PLAID-1E PGlite timings (ms):', JSON.stringify(timings)); await db?.close?.() })

  const q = async (sql, params = []) => (await db.query(sql, params)).rows
  let n = 0
  /** A connected Item (organization `org`) with three accounts, `existing` committed evidence rows (old-1..old-N) and the lease held. */
  async function item(org = ORG, existing = 0) {
    const id = (await q(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid',$2,'ins_127991','Wells Fargo','v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}',$3,'production')`, [org, `bench-${++n}`, OWNER_ID]))[0].item_id
    const accts = (await q(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name) SELECT $1, $2, a, a FROM unnest(ARRAY['wf-chk','wf-sav','wf-card']) a RETURNING id`, [org, id])).map(r => r.id)
    if (existing) {
      await q(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, currency, transaction_date, name)
        SELECT $1, $2, ($3::uuid[])[1 + g % 3], 'old-' || g, (g % 20 = 0), 10.25, 1025, 'USD', DATE '2026-07-01' + (g % 90), 'OLD ' || g FROM generate_series(1, ${existing}) g`, [org, id, accts])
      await q(`UPDATE public.financial_provider_items SET sync_cursor = 'prev' WHERE id = $1`, [id])
    }
    await q(`UPDATE public.financial_provider_items SET sync_status = 'syncing', last_sync_started_at = $2 WHERE id = $1`, [id, LEASE])
    const run = (await q(`SELECT run_id FROM public.financial_provider_sync_open_run($1, $2)`, [org, id]))[0].run_id
    return { id, accts, run, org }
  }
  /** Stages `pages` pages of `per` changes; the last one ends the update unless `open`. Returns the staging time. */
  async function stage(it, pages, per, kind = 'added', { open = false, maxRows } = {}) {
    const t = performance.now()
    for (let p = 0; p < pages; p++) {
      const last = p === pages - 1 && !open
      const out = (await q(`SELECT public.financial_provider_sync_stage_page($2, $3, 1, ${p}, $4, $5, 'HISTORICAL_UPDATE_COMPLETE', ${pageJson(kind, p, per)}${maxRows ? `, ${maxRows}` : ''}) AS r`,
        [it.accts, it.org, it.run, last ? 'final' : `c${p + 1}`, !last]))[0].r
      expect(out).toBe('staged')
    }
    return performance.now() - t
  }
  const apply = (it, over = {}) => q(`SELECT * FROM public.financial_provider_sync_apply_run($1, $2, $3, $4, $5, 'synced')`,
    [over.org ?? it.org, it.id, it.run, over.generation ?? 1, over.lease ?? LEASE]).then(r => r[0])
  const timed = async f => { const t = performance.now(); const r = await f(); return [r, performance.now() - t] }
  const itemRow = it => q(`SELECT sync_cursor, sync_status, last_sync_started_at FROM public.financial_provider_items WHERE id = $1`, [it.id]).then(r => r[0])
  const runRow = it => q(`SELECT status, blocked_reason, apply_failures, staged_rows, (SELECT count(*)::int FROM public.financial_provider_sync_staged_changes s WHERE s.run_id = r.id) AS staged FROM public.financial_provider_sync_staging_runs r WHERE id = $1`, [it.run]).then(r => r[0])
  const evidence = it => q(`SELECT count(*)::int AS rows, count(*) FILTER (WHERE removed_at IS NOT NULL)::int AS removed, count(*) FILTER (WHERE pending_provider_transaction_id IS NOT NULL)::int AS linked,
    count(*) FILTER (WHERE name = 'MODIFIED')::int AS modified FROM public.financial_provider_transactions WHERE provider_item_ref = $1`, [it.id]).then(r => r[0])

  it('12,000- and 50,000-row backfills: the final apply is linear and far inside the 8 s statement timeout', async () => {
    const a = await item(); timings.stage12k = await stage(a, 24, 500)
    const [r12, t12] = await timed(() => apply(a)); timings.apply12k = t12
    expect(r12).toMatchObject({ outcome: 'applied', added_count: 12000 })
    const b = await item(); timings.stage50k = await stage(b, 100, 500)
    const [r50, t50] = await timed(() => apply(b)); timings.apply50k = t50
    expect(r50).toMatchObject({ outcome: 'applied', added_count: 50000 })
    expect(await evidence(b)).toMatchObject({ rows: 50000, removed: 0 })
    expect(await itemRow(b)).toMatchObject({ sync_cursor: 'final', sync_status: 'idle' })
    expect(await runRow(b)).toMatchObject({ status: 'applied', staged: 0 })
    // Quadratic (PLAID-1D) took 61 s for 12k on native PostgreSQL; 4.2x the rows must cost well under 17x (quadratic) the time.
    expect(t12).toBeLessThan(8_000)
    expect(t50).toBeLessThan(30_000) // PGlite (single-threaded WebAssembly) is several times slower than PostgreSQL; native timings are in the report
    expect(t50 / t12).toBeLessThan(8)
  }, 300_000)

  it('large existing history with a small update: cost follows the update, not the history', async () => {
    const it = await item(ORG, 50_000); timings.stageSmall = await stage(it, 1, 500, 'mixed')
    const [r, t] = await timed(() => apply(it)); timings.applySmallOn50k = t
    expect(r).toMatchObject({ outcome: 'applied', added_count: 150, modified_count: 250, removed_count: 100, pending_linked_count: 25 })
    expect(await evidence(it)).toMatchObject({ rows: 50_150, removed: 100, modified: 250, linked: 25 })
    expect(t).toBeLessThan(2_000) // quadratic form: ~0.24 ms per EXISTING row per page (12 s here on native PostgreSQL)
  }, 300_000)

  it('mixed additions, modifications and removals over 10,000 existing rows keep every row id and never delete evidence', async () => {
    const it = await item(ORG, 10_000)
    const before = await q(`SELECT id, provider_transaction_id FROM public.financial_provider_transactions WHERE provider_item_ref = $1`, [it.id])
    timings.stageMixed10k = await stage(it, 20, 500, 'mixed')
    const [r, t] = await timed(() => apply(it)); timings.applyMixed10k = t
    expect(r).toMatchObject({ outcome: 'applied', added_count: 3000, modified_count: 5000, removed_count: 2000, pending_linked_count: 500 })
    expect(await evidence(it)).toMatchObject({ rows: 13_000, removed: 2000, modified: 5000, linked: 500 })
    const after = new Map((await q(`SELECT id, provider_transaction_id FROM public.financial_provider_transactions WHERE provider_item_ref = $1`, [it.id])).map(x => [x.provider_transaction_id, x.id]))
    expect(before.every(x => after.get(x.provider_transaction_id) === x.id)).toBe(true)
    expect(t).toBeLessThan(8_000)
  }, 300_000)

  it('the last event wins across pages: added -> modified -> removed, removed -> re-added, pending -> posted', async () => {
    const it = await item()
    const ch = (kind, id, over = {}) => kind === 'removed' ? { change_kind: 'removed', provider_transaction_id: id }
      : { change_kind: kind, provider_transaction_id: id, provider_account_ref: it.accts[0], pending: false, provider_amount: 1.5, provider_amount_minor: 150, currency: 'USD', transaction_date: '2026-09-01', name: kind, ...over }
    const pages = [[ch('added', 'x'), ch('added', 'y'), ch('added', 'p', { pending: true })], [ch('modified', 'x', { provider_amount: 2.5, provider_amount_minor: 250 }), ch('removed', 'y'), ch('removed', 'p')],
      [ch('added', 'y', { name: 'back' }), ch('added', 'posted', { pending_provider_transaction_id: 'p' }), ch('removed', 'x')]]
    for (const [i, c] of pages.entries()) expect((await q(`SELECT public.financial_provider_sync_stage_page($1, $2, 1, $3, $4, $5, null, $6::jsonb) AS r`, [it.org, it.run, i, `c${i + 1}`, i < 2, JSON.stringify(c)]))[0].r).toBe('staged')
    expect(await apply(it)).toMatchObject({ outcome: 'applied', removed_count: 2 })
    const ev = Object.fromEntries((await q(`SELECT provider_transaction_id AS id, provider_amount_minor::int AS minor, name, removed_at FROM public.financial_provider_transactions WHERE provider_item_ref = $1`, [it.id])).map(r => [r.id, r]))
    expect(ev.x).toMatchObject({ minor: 250 }); expect(ev.x.removed_at).not.toBeNull()
    expect(ev.y).toMatchObject({ name: 'back', removed_at: null })
    expect(ev.p.removed_at).not.toBeNull(); expect(ev.posted.removed_at).toBeNull()
  })

  it('a statement timeout (or any error) in the middle of the final apply rolls everything back; the same staging applies afterwards', async () => {
    const it = await item(ORG, 3_000); await stage(it, 6, 500, 'mixed')
    const snapshot = () => q(`SELECT md5(string_agg(id::text || name || provider_amount_minor || coalesce(removed_at::text, '-') || updated_at::text, ',' ORDER BY id)) AS h FROM public.financial_provider_transactions WHERE provider_item_ref = $1`, [it.id]).then(r => r[0].h)
    const before = await snapshot()
    // query_canceled (57014) is exactly what statement_timeout raises; injected after 1,000 evidence writes, mid-statement.
    await db.exec(`RESET ROLE; CREATE SEQUENCE test_cancel_seq; GRANT USAGE ON SEQUENCE test_cancel_seq TO service_role;
      CREATE FUNCTION public.test_cancel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('test_cancel_seq') > 1000 THEN RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_cancel BEFORE INSERT OR UPDATE ON public.financial_provider_transactions FOR EACH ROW EXECUTE FUNCTION public.test_cancel(); SET ROLE service_role`)
    try {
      await expect(apply(it)).rejects.toMatchObject({ code: '57014' })
    } finally { await db.exec('RESET ROLE; DROP TRIGGER test_cancel ON public.financial_provider_transactions; DROP FUNCTION public.test_cancel(); DROP SEQUENCE test_cancel_seq; SET ROLE service_role') }
    expect(await snapshot()).toBe(before)
    expect(await itemRow(it)).toMatchObject({ sync_cursor: 'prev', sync_status: 'syncing' }) // lease still this request's; cursor unmoved
    expect(await runRow(it)).toMatchObject({ status: 'fetched', staged: 3000, staged_rows: 3000 })
    expect(await apply(it)).toMatchObject({ outcome: 'applied', removed_count: 600 })
    expect(await itemRow(it)).toMatchObject({ sync_cursor: 'final', sync_status: 'idle' })
  }, 120_000)

  it('repeated failures: the third counted failure blocks the run; a blocked run is never applied, expired or replaced automatically', async () => {
    const it = await item(ORG, 10); await stage(it, 1, 10, 'mixed')
    const fail = (over = {}) => q(`SELECT public.financial_provider_sync_record_apply_failure($1, $2, $3, $4, $5${over.max ? `, ${over.max}` : ''}) AS r`,
      [over.org ?? it.org, it.id, it.run, over.generation ?? 1, over.lease ?? LEASE]).then(r => r[0].r)
    expect(await fail({ lease: '2026-10-11T11:00:00Z' })).toBe('stale') // only the lease holder counts
    expect(await fail({ generation: 2 })).toBe('stale')
    await expect(fail({ org: ORG_B })).rejects.toThrow(/SYNC_ITEM_NOT_FOUND/)
    expect(await fail({ max: 99 })).toBe('retry') // a caller cannot raise the limit above three
    expect(await fail()).toBe('retry')
    expect(await fail()).toBe('blocked')
    expect(await runRow(it)).toMatchObject({ status: 'blocked', blocked_reason: 'APPLY_FAILED_REPEATEDLY', apply_failures: 3, staged: 10 })
    expect(await apply(it)).toMatchObject({ outcome: 'blocked' })
    await q(`RESET ROLE`); await q(`UPDATE public.financial_provider_sync_staging_runs SET created_at = now() - interval '3 days' WHERE id = $1`, [it.run]); await q('SET ROLE service_role')
    const reopened = (await q(`SELECT run_id, status, blocked_reason FROM public.financial_provider_sync_open_run($1, $2)`, [it.org, it.id]))[0]
    expect(reopened).toEqual({ run_id: it.run, status: 'blocked', blocked_reason: 'APPLY_FAILED_REPEATEDLY' }) // not expired, not replaced
    expect(await evidence(it)).toMatchObject({ rows: 10, removed: 0, modified: 0 })
    expect(await itemRow(it)).toMatchObject({ sync_cursor: 'prev' })
    expect((await q(`SELECT public.financial_provider_sync_abandon_run($1, $2, 'OWNER_REVIEWED') AS r`, [it.org, it.run]))[0].r).toBe('abandoned') // the only exit
  })

  it('run-size limit: at most 50,000 staged rows even when a caller asks for more; the run is blocked with its staged rows kept', async () => {
    const it = await item(); await stage(it, 100, 500, 'added', { open: true })
    const one = JSON.stringify([{ change_kind: 'removed', provider_transaction_id: 'one-more' }])
    expect((await q(`SELECT public.financial_provider_sync_stage_page($1, $2, 1, 100, 'c101', true, null, $3::jsonb, 1000000) AS r`, [it.org, it.run, one]))[0].r).toBe('blocked')
    expect(await runRow(it)).toMatchObject({ status: 'blocked', blocked_reason: 'RUN_TOO_LARGE', staged_rows: 50000, staged: 50000 })
    expect((await q(`SELECT public.financial_provider_sync_stage_page($1, $2, 1, 100, 'c101', true, null, $3::jsonb) AS r`, [it.org, it.run, one]))[0].r).toBe('stale') // blocked: nothing more staged
    expect(await evidence(it)).toMatchObject({ rows: 0 })
    expect(await itemRow(it)).toMatchObject({ sync_cursor: null })
  }, 300_000)

  it('fencing and isolation still hold on the corrected apply: lease, generation, cursor compare-and-set and organization', async () => {
    const it = await item(ORG, 100); await stage(it, 1, 50, 'mixed')
    expect(await apply(it, { lease: '2026-10-11T11:59:59Z' })).toMatchObject({ outcome: 'lease_lost' })
    expect(await apply(it, { generation: 2 })).toMatchObject({ outcome: 'stale' })
    await expect(apply(it, { org: ORG_B })).rejects.toThrow(/SYNC_ITEM_NOT_FOUND/)
    const b = await item(ORG_B)
    await expect(q(`SELECT * FROM public.financial_provider_sync_apply_run($1, $2, $3, 1, $4, 'synced')`, [ORG_B, b.id, it.run, LEASE])).rejects.toThrow(/SYNC_RUN_NOT_FOUND/)
    expect(await evidence(it)).toMatchObject({ rows: 100, removed: 0, modified: 0 })
    await q(`UPDATE public.financial_provider_items SET sync_cursor = 'moved' WHERE id = $1`, [it.id])
    expect(await apply(it)).toMatchObject({ outcome: 'stale' })
    expect(await runRow(it)).toMatchObject({ status: 'abandoned', staged: 0 })
    expect(await evidence(it)).toMatchObject({ rows: 100, removed: 0, modified: 0 })
    expect(await itemRow(it)).toMatchObject({ sync_cursor: 'moved', sync_status: 'syncing' })
  }, 120_000)

  it('the corrected functions stay service-role only, SECURITY INVOKER, with a fixed search_path', async () => {
    const fns = await q(`SELECT proname, prosecdef, proconfig, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth, has_function_privilege('anon', oid, 'EXECUTE') AS anon,
      has_function_privilege('service_role', oid, 'EXECUTE') AS svc FROM pg_proc WHERE proname LIKE 'financial_provider_sync_%' ORDER BY 1`)
    expect(fns.map(f => f.proname)).toEqual(['financial_provider_sync_abandon_run', 'financial_provider_sync_apply_run', 'financial_provider_sync_open_run',
      'financial_provider_sync_record_apply_failure', 'financial_provider_sync_restart_run', 'financial_provider_sync_stage_page'])
    for (const f of fns) expect(f).toMatchObject({ prosecdef: false, proconfig: ['search_path=public'], auth: false, anon: false, svc: true })
  })
})
