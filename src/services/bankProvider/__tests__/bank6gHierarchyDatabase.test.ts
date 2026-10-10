import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { loadSpendingHierarchy, defaultHierarchy, canAssign } from '../spending/hierarchy'

const ORG = 'a0000000-0000-4000-8000-000000000001', OTHER = 'a0000000-0000-4000-8000-000000000002'
const OWNER = 'b0000000-0000-4000-8000-000000000001', MEMBER = 'b0000000-0000-4000-8000-000000000002'
let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
    CREATE TABLE public.organizations(id uuid PRIMARY KEY);
    CREATE FUNCTION public.user_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${ORG}'::uuid $$;
    CREATE FUNCTION public.is_org_admin_for(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT p = '${ORG}'::uuid AND auth.uid() = '${OWNER}'::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    INSERT INTO public.organizations VALUES ('${ORG}'),('${OTHER}');
    CREATE TABLE public.financial_provider_transactions(id uuid,organization_id uuid,provider_account_ref uuid,transaction_date date,name text,merchant_name text,provider_amount_minor bigint,pending boolean,removed_at timestamptz,provider_category jsonb);
    CREATE TABLE public.financial_provider_interpretations(id uuid,organization_id uuid,provider_transaction_ref uuid,kind text,status text,category text,project_id text,obligation_id uuid,cash_commitment_id uuid,debt_account_id uuid,counterpart_provider_transaction_ref uuid,confidence text,source text,decided_at timestamptz,created_at timestamptz);
    CREATE TABLE public.financial_provider_accounts(id uuid,organization_id uuid,provider_item_ref uuid,name text,mask text);
    CREATE TABLE public.financial_provider_items(id uuid,organization_id uuid,environment text);
    CREATE TABLE public.financial_provider_account_mappings(provider_account_ref uuid,organization_id uuid,financial_account_id uuid,status text);
    CREATE TABLE public.financial_accounts(id uuid,organization_id uuid,ownership_context text,display_name text,account_type text,account_class text,status text);
    CREATE TABLE public.financial_obligations(id uuid,organization_id uuid,name text,amount_minor bigint,amount_type text,estimated_min_minor bigint,estimated_max_minor bigint,recurrence_kind text,recurrence_interval int,anchor_date date,start_date date,end_date date,status text,account_id uuid);
    CREATE TABLE public.financial_obligation_occurrences(organization_id uuid,obligation_id uuid,scheduled_date date,override_date date,override_amount_minor bigint,status text,reconciliation_state text);
    CREATE TABLE public.cash_commitments(id uuid,organization_id uuid,title text,expected_date date,amount_minor bigint,amount_type text,estimated_min_minor bigint,estimated_max_minor bigint,status text,reconciliation_state text,account_id uuid);
    CREATE TABLE public.projects(id uuid,org_id uuid,name text,status text);
    CREATE TABLE public.financial_provider_merchant_rules(id uuid,organization_id uuid,merchant_key text,merchant_label text,category text,status text,updated_at timestamptz);
    GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
    CREATE TABLE public.test_category_colors(key text,color text);
    CREATE TABLE public.cash_os_display_colors(organization_id uuid,category_key text,target_kind text,color text);
    GRANT SELECT,INSERT,UPDATE ON public.test_category_colors TO authenticated;
    CREATE FUNCTION public.cash_os_set_display_color(p_kind text,p_key text,p_color text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN
      IF p_color IS NOT NULL AND p_color <> '#5a72d9' THEN RAISE EXCEPTION 'INVALID_COLOR' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.test_category_colors VALUES(p_key,p_color); RETURN p_key; END; $$;`)
  await db.exec(readFileSync('docs/bank6g/hierarchy-proposal.sql', 'utf8'))
}, 30000)
afterAll(async () => db?.close())
async function owner() { await db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${OWNER}';`) }
describe('BANK-6G separately reviewable metadata SQL (local PostgreSQL only)', () => {
  // Additional name-override coverage below uses the same installed management contract.
  it('seeds built-ins for both organizations with custom writes disabled', async () => {
    const r = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM bank_spending_category_definitions')
    expect(r.rows[0].n).toBe(36)
    expect((await db.query('SELECT writes_enabled FROM bank_spending_hierarchy_controls')).rows).toEqual([{ writes_enabled: false }, { writes_enabled: false }])
  })
  it('defaults compatibility reads only on an absent RPC; does not hide authorization failures', async () => {
    const svc = (error: any) => ({ from: () => null, rpc: async () => ({ data: null, error }) })
    expect(await loadSpendingHierarchy(svc({ code: '42883' }), ORG)).toEqual(defaultHierarchy())
    await expect(loadSpendingHierarchy(svc({ code: '42501', message: 'bank_spending_read_hierarchy forbidden' }), ORG)).rejects.toThrow()
    expect(canAssign('custom_supplies', defaultHierarchy())).toBe(false)
  })
  it('blocks owner creation and gate changes before explicit enablement', async () => {
    await owner()
    await expect(db.query('INSERT INTO bank_spending_category_definitions VALUES ($1,$2,$3,$4,false,false)', [ORG, 'custom_supplies', 'Supplies', 'materials'])).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('UPDATE bank_spending_hierarchy_controls SET writes_enabled = true')).rejects.toMatchObject({ code: '42501' })
    await db.exec(`RESET ROLE; SET ROLE service_role;`)
    await expect(db.query('INSERT INTO bank_spending_parent_definitions (organization_id,key,name) VALUES ($1,$2,$3)', [ORG, 'custom_parent', 'Parent'])).rejects.toMatchObject({ code: '42501' })
  })
  it('permits explicit owner metadata creation after a local-only service enablement and audits it', async () => {
    await db.exec(`RESET ROLE; SET ROLE service_role;`)
    await db.query('UPDATE bank_spending_hierarchy_controls SET writes_enabled = true WHERE organization_id = $1', [ORG])
    await owner()
    await db.query('INSERT INTO bank_spending_category_definitions VALUES ($1,$2,$3,$4,false,false)', [ORG, 'custom_supplies', 'Supplies', 'materials'])
    const rows = (await db.query<{ actor_user_id: string; after_value: any }>('SELECT actor_user_id,after_value FROM bank_spending_hierarchy_history')).rows
    expect(rows).toHaveLength(1); expect(rows[0].actor_user_id).toBe(OWNER)
    expect(rows[0].after_value.key).toBe('custom_supplies')
  })
  it('rejects cross-organization creation, parent assignment and registry reads', async () => {
    await owner()
    await expect(db.query('INSERT INTO bank_spending_parent_definitions (organization_id,key,name) VALUES ($1,$2,$3)', [OTHER, 'custom_parent', 'Foreign'])).rejects.toMatchObject({ code: '42501' })
    expect((await db.query('SELECT * FROM bank_spending_category_definitions WHERE organization_id = $1', [OTHER])).rows).toEqual([])
    await expect(db.query('SELECT bank_spending_read_hierarchy($1)', [OTHER])).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('UPDATE bank_spending_category_definitions SET parent_key = $1 WHERE key = $2', ['missing_parent', 'custom_supplies'])).rejects.toMatchObject({ code: '23514' })
  })
  it('protects stable keys, built-in identity and active children; rejects nonpalette colors', async () => {
    await owner()
    await expect(db.query("UPDATE bank_spending_category_definitions SET key = 'changed_key' WHERE key = 'custom_supplies'")).rejects.toMatchObject({ code: '23514' })
    await expect(db.query("UPDATE bank_spending_category_definitions SET archived = true WHERE key = 'transfers'")).rejects.toMatchObject({ code: '23514' })
    await expect(db.query("UPDATE bank_spending_parent_definitions SET archived = true WHERE key = 'materials'")).rejects.toMatchObject({ code: '23514' })
    await expect(db.query("UPDATE bank_spending_parent_definitions SET color = '#ffffff' WHERE key = 'vehicle'")).rejects.toMatchObject({ code: '23514' })
  })
  it('audits rename, move, recolor and archive without changing stable keys; history is append-only to callers', async () => {
    await owner()
    await db.query("UPDATE bank_spending_category_definitions SET name = 'Shop Supplies', parent_key = 'overhead' WHERE key = 'custom_supplies'")
    await db.query("UPDATE bank_spending_parent_definitions SET color = '#5a72d9' WHERE key = 'vehicle'")
    await db.query("UPDATE bank_spending_category_definitions SET archived = true WHERE key = 'custom_supplies'")
    expect((await db.query('SELECT id FROM bank_spending_hierarchy_history')).rows).toHaveLength(4)
    await expect(db.query('DELETE FROM bank_spending_hierarchy_history')).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('DELETE FROM bank_spending_category_definitions')).rejects.toMatchObject({ code: '42501' })
  })
  it('blocks members and anonymous callers', async () => {
    await db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${MEMBER}';`)
    expect((await db.query('SELECT * FROM bank_spending_parent_definitions')).rows).toEqual([])
    await expect(db.query('SELECT bank_spending_read_hierarchy($1)', [ORG])).rejects.toMatchObject({ code: '42501' })
    await db.exec('RESET ROLE; SET ROLE anon;')
    await expect(db.query('SELECT * FROM bank_spending_parent_definitions')).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('SELECT bank_spending_read_hierarchy($1)', [ORG])).rejects.toMatchObject({ code: '42501' })
  })
  it('atomically creates a stable-key category with color and rolls back invalid colors', async () => {
    await owner()
    const before = (await db.query('SELECT key FROM bank_spending_category_definitions')).rows.length
    const r = await db.query<{ key:string }>('SELECT bank_spending_manage_definition($1,NULL,$2,$3,$4,false) AS key',['category','Maintenance','vehicle','#5a72d9'])
    expect(r.rows[0].key).toMatch(/^[a-z][a-z_]{1,39}$/)
    expect((await db.query('SELECT key FROM bank_spending_category_definitions')).rows).toHaveLength(before+1)
    await expect(db.query('SELECT bank_spending_manage_definition($1,NULL,$2,$3,$4,false)',['category','Bad color','vehicle','#ffffff'])).rejects.toMatchObject({ code:'23514' })
    expect((await db.query('SELECT key FROM bank_spending_category_definitions')).rows).toHaveLength(before+1)
  })
  it('uses a complete service-only snapshot beyond the legacy 5000 evidence limit and fails closed at its explicit cap', async () => {
    await db.exec('RESET ROLE; SET ROLE service_role;')
    await db.query(`INSERT INTO financial_provider_transactions(id,organization_id,transaction_date,provider_amount_minor,pending)
      SELECT md5(n::text)::uuid,$1,'2026-10-09',100,false FROM generate_series(1,5001) n`,[ORG])
    const read = async () => (await db.query<{ payload:any }>('SELECT bank_spending_report_source($1,$2) AS payload',[ORG,'2026-10-01'])).rows[0].payload
    let raw = await read(); expect(raw.complete).toBe(true); expect(raw.txs).toHaveLength(5001)
    await db.query(`INSERT INTO financial_provider_transactions(id,organization_id,transaction_date,provider_amount_minor,pending)
      SELECT md5(n::text)::uuid,$1,'2026-10-09',100,false FROM generate_series(5002,50001) n`,[ORG])
    raw = await read(); expect(raw.complete).toBe(false); expect(raw.txs).toEqual([])
    await owner()
    await expect(db.query('SELECT bank_spending_report_source($1,$2)',[ORG,'2026-10-01'])).rejects.toMatchObject({ code:'42501' })
  },30000)
  it('persists built-in/custom display overrides and moves without changing financial records; uniqueness is organization scoped', async () => {
    await db.exec('RESET ROLE;')
    await db.exec(readFileSync('docs/bank6h/definition-names-proposal.sql', 'utf8'))
    await db.query("INSERT INTO financial_provider_interpretations(id,organization_id,kind,status,category,debt_account_id) VALUES ($1,$2,'category','confirmed','bank_finance_fees',NULL),($3,$2,'debt_payment','confirmed',NULL,$4)",['c0000000-0000-4000-8000-000000000001',ORG,'c0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001'])
    const before = (await db.query('SELECT * FROM financial_provider_interpretations')).rows
    const evidence = (await db.query('SELECT count(*) AS n FROM financial_provider_transactions')).rows
    const sample = (await db.query('SELECT * FROM financial_provider_transactions ORDER BY id LIMIT 1')).rows
    await owner()
    for (const [type,key,name,parent] of [
      ['parent','vehicle','Transport Costs',null], ['parent','overhead','Office Overhead',null],
      ['category','bank_finance_fees','Bank Charges','vehicle'], ['category','custom_supplies','Workshop Stock','overhead'],
    ]) await db.query('SELECT bank_spending_manage_definition($1,$2,$3,$4,NULL,false)',[type,key,name,parent])
    const custom = (await db.query<{ key:string }>("SELECT bank_spending_manage_definition('parent',NULL,'My Parent',NULL,NULL,false) AS key")).rows[0].key
    await db.query("SELECT bank_spending_manage_definition('parent',$1,'Renamed Parent',NULL,NULL,false)",[custom])
    const read = (await db.query<{ h:any }>('SELECT bank_spending_read_hierarchy($1) AS h',[ORG])).rows[0].h
    expect(read.parents.find((p:any)=>p.key==='vehicle').name).toBe('Transport Costs')
    expect(read.parents.find((p:any)=>p.key===custom).name).toBe('Renamed Parent')
    expect(read.categories.find((c:any)=>c.key==='bank_finance_fees')).toMatchObject({name:'Bank Charges',parent_key:'vehicle',builtin:true})
    expect(read.categories.find((c:any)=>c.key==='custom_supplies').name).toBe('Workshop Stock')
    await expect(db.query("SELECT bank_spending_manage_definition('category','materials',' bank   charges ','materials',NULL,false)")).rejects.toMatchObject({code:'23505'})
    await expect(db.query("SELECT bank_spending_manage_definition('parent','materials','TRANSPORT COSTS',NULL,NULL,false)")).rejects.toMatchObject({code:'23505'})
    await db.exec('RESET ROLE;')
    expect((await db.query('SELECT * FROM financial_provider_interpretations')).rows).toEqual(before)
    expect((await db.query('SELECT count(*) AS n FROM financial_provider_transactions')).rows).toEqual(evidence)
    expect((await db.query('SELECT * FROM financial_provider_transactions ORDER BY id LIMIT 1')).rows).toEqual(sample)
    expect((await db.query('SELECT name FROM bank_spending_parent_definitions WHERE organization_id=$1 AND key=$2',[OTHER,'vehicle'])).rows[0]).toEqual({name:'Vehicle Expenses'})
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${MEMBER}';`)
    await expect(db.query("SELECT bank_spending_manage_definition('parent','vehicle','Forbidden',NULL,NULL,false)")).rejects.toMatchObject({code:'42501'})
  })
})
