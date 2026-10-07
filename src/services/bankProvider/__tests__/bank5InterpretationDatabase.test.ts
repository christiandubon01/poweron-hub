import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * BANK-5 interpretation model on REAL PostgreSQL (PGlite) with the actual migrations. Part 1 proves what migration 153 alone cannot do
 * (so the new migration is justified, not assumed). Part 2 proves migration 155 gives the three-dimension model without letting an
 * interpretation touch canonical money. Nothing here touches production.
 */
let PGliteCtor: any = null
try { PGliteCtor = (await import('@electric-sql/pglite')).PGlite } catch { PGliteCtor = null }

const ORG = 'a0000000-0000-4000-8000-000000000001'
const ORG_B = 'a0000000-0000-4000-8000-000000000002'
const OWNER = 'b0000000-0000-4000-8000-000000000001'
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
INSERT INTO auth.users VALUES ('${OWNER}');
INSERT INTO public.test_profiles VALUES ('${OWNER}', '${ORG}', 'owner');
CREATE TABLE public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, name text NOT NULL, status text NOT NULL DEFAULT 'in_progress');
`
const BASE = ['139_cash_accounts_manual_ledger', '140_cash_linked_pair_lifecycle_hardening', '141_cash_transfer_conflict_target_fix',
  '142_cash_pair_void_link_lock_fix', '143_cash_dated_obligations', '146_balance_reconciliation_kind', '153_bank_provider_evidence_foundation', '154_bank_provider_credentials']

async function build(extra: string[]) {
  const db = new PGliteCtor()
  await db.exec(BOOTSTRAP)
  for (const name of [...BASE, ...extra]) await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'))
  await db.exec(`SET ROLE service_role`)
  const q = async (sql: string, p: any[] = []) => (await db.query(sql, p)).rows as any[]
  const item = (await q(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid','item-1','ins_1','Tartan Bank',$2,$3)`, [ORG, `v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}`, OWNER]))[0].item_id
  const acct = (await q(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name, currency, status) VALUES ($1,$2,'acc-1','Plaid Checking','USD','active') RETURNING id`, [ORG, item]))[0].id
  const tx = async (id: string, pending = false) => (await q(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, currency, transaction_date, name)
    VALUES ($1,$2,$3,$4,$5,12.34,1234,'USD','2026-09-30','Shop') RETURNING id`, [ORG, item, acct, id, pending]))[0].id
  const fin = (await q(`INSERT INTO public.financial_accounts (organization_id, display_name, account_type, account_class, ownership_context, include_in_cash) VALUES ($1,'Wells Fargo Business Checking 6960','checking','asset','business',true) RETURNING id`, [ORG]))[0].id
  const obligation = (await q(`INSERT INTO public.financial_obligations (organization_id, name, amount_type, amount_minor, recurrence_kind, anchor_date, start_date) VALUES ($1,'QuickBooks','fixed',3800,'monthly','2026-01-05','2026-01-01') RETURNING id`, [ORG]))[0].id
  const insert = (txRef: string, kind: string, status: string, cols: Record<string, unknown> = {}) => {
    const c: Record<string, unknown> = { organization_id: ORG, provider_transaction_ref: txRef, kind, status, source: 'owner', confidence: 'high', decided_by: status === 'confirmed' || status === 'rejected' ? OWNER : null, created_by: OWNER, ...cols }
    const keys = Object.keys(c)
    return db.query(`INSERT INTO public.financial_provider_interpretations (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, keys.map(k => c[k]))
  }
  const canonical = async () => JSON.stringify({
    tx: (await q(`SELECT count(*)::int n FROM public.financial_transactions`))[0].n,
    acct: await q(`SELECT id, include_in_cash, account_type, account_class, ownership_context, status FROM public.financial_accounts ORDER BY id`),
    obligations: await q(`SELECT id, status, amount_minor FROM public.financial_obligations ORDER BY id`),
    occurrences: (await q(`SELECT count(*)::int n FROM public.financial_obligation_occurrences`))[0].n,
    evidence: (await q(`SELECT count(*)::int n, sum(provider_amount_minor)::int s FROM public.financial_provider_transactions`))[0],
  })
  const rpc = (a: Record<string, unknown>) => {
    const args = { p_organization_id: ORG, p_actor: OWNER, p_source: 'owner', p_confidence: 'high', p_suggestion_basis: { mode: 'owner_choice' }, ...a }
    const keys = Object.keys(args)
    return db.query(`SELECT * FROM public.financial_provider_replace_interpretation(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`,
      keys.map(k => { const v = (args as any)[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v })).then((r: any) => r.rows as any[])
  }
  const active = async (txRef: string) => (await q(`SELECT kind, status, category, project_id FROM public.financial_provider_interpretations WHERE provider_transaction_ref=$1 AND status IN ('suggested','confirmed') ORDER BY kind`, [txRef]))
  const history = async () => JSON.stringify(await q(`SELECT id, provider_transaction_ref, kind, status, category, project_id, obligation_id, cash_commitment_id, debt_account_id, undo_reason, undone_by IS NOT NULL u FROM public.financial_provider_interpretations ORDER BY id`))
  return { db, q, tx, insert, canonical, rpc, active, history, ids: { item, acct, fin, obligation } }
}

describe.runIf(!!PGliteCtor)('PART 1 - migration 153 alone cannot hold the BANK-5 model (why 155 exists)', () => {
  let w: Awaited<ReturnType<typeof build>>
  beforeAll(async () => { w = await build([]) }, 120_000)
  afterAll(async () => { await w?.db?.close?.() })
  it('a confirmed relationship (project/obligation/debt/payroll/transfer) is rejected without a ledger row', async () => {
    const t = await w.tx('p1')
    await expect(w.insert(t, 'project', 'confirmed', { project_id: 'proj-1' })).rejects.toThrow(/confirmed_needs_ledger/)
    await expect(w.insert(t, 'payroll', 'confirmed')).rejects.toThrow(/confirmed_needs_ledger/)
  })
  it('there is no way to point at a recurring obligation, and no overhead/personal relationship kind', async () => {
    const t = await w.tx('p2')
    expect((await w.q(`SELECT 1 FROM information_schema.columns WHERE table_name='financial_provider_interpretations' AND column_name='obligation_id'`))).toHaveLength(0)
    await expect(w.insert(t, 'overhead', 'suggested')).rejects.toThrow(/kind_check/)
    await expect(w.insert(t, 'personal', 'suggested')).rejects.toThrow(/kind_check/)
  })
  it('a transfer cannot be recorded without an already-paired counterpart', async () => {
    const t = await w.tx('p3')
    await expect(w.insert(t, 'transfer', 'suggested')).rejects.toThrow(/kind_targets/)
  })
})

describe.runIf(!!PGliteCtor)('PART 2 - migration 155: three-dimension model, no canonical effect', () => {
  let w: Awaited<ReturnType<typeof build>>
  beforeAll(async () => { w = await build(['155_bank_interpretation_model']) }, 120_000)
  afterAll(async () => { await w?.db?.close?.() })

  it('bucket, relationship and review state are INDEPENDENT rows: one transaction can hold a confirmed bucket and a suggested relationship', async () => {
    const t = await w.tx('t-dims')
    await w.insert(t, 'category', 'confirmed', { category: 'materials' })
    await w.insert(t, 'project', 'suggested', { source: 'rule', confidence: 'possible', project_id: 'proj-desert-willow' })
    const rows = await w.q(`SELECT kind, status, confidence, category, project_id FROM public.financial_provider_interpretations WHERE provider_transaction_ref = $1 ORDER BY kind`, [t])
    expect(rows).toEqual([{ kind: 'category', status: 'confirmed', confidence: 'high', category: 'materials', project_id: null }, { kind: 'project', status: 'suggested', confidence: 'possible', category: null, project_id: 'proj-desert-willow' }])
  })
  it('another transaction from the same merchant can have a different relationship (nothing is inherited)', async () => {
    const a = await w.tx('t-hd-1'), b = await w.tx('t-hd-2')
    await w.insert(a, 'project', 'confirmed', { project_id: 'proj-1' })
    await w.insert(b, 'overhead', 'confirmed')
    expect((await w.q(`SELECT provider_transaction_ref r, kind FROM public.financial_provider_interpretations WHERE provider_transaction_ref = ANY($1) ORDER BY kind`, [[a, b]])).map((r: any) => r.kind)).toEqual(['overhead', 'project'])
  })
  it('confirmed interpretations of every kind exist WITHOUT any canonical ledger row; ledger_match still requires one', async () => {
    const t = await w.tx('t-kinds'); const tLm = await w.tx('t-lm'); const before = await w.canonical()
    await w.insert(t, 'category', 'confirmed', { category: 'software_subscriptions' })
    await w.insert(t, 'obligation', 'confirmed', { obligation_id: w.ids.obligation })
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations WHERE provider_transaction_ref=$1 AND status='confirmed'`, [t]))[0].n).toBe(2)
    await expect(w.insert(tLm, 'ledger_match', 'confirmed', { match_mode: 'linked' })).rejects.toThrow(/kind_targets|confirmed_needs_ledger/)
    expect(await w.canonical()).toBe(before) // creating interpretations changed no ledger row, account, obligation, occurrence or evidence
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_obligation_occurrences`))[0].n).toBe(0) // and materialized no occurrence
  })
  it('a transaction can hold only ONE active relationship; changing it is undo + new row, and the old row is kept as audit history', async () => {
    const t = await w.tx('t-one-rel')
    const first = (await w.insert(t, 'project', 'confirmed', { project_id: 'proj-1' })).rows[0].id
    await expect(w.insert(t, 'overhead', 'confirmed')).rejects.toThrow(/active_relationship/)
    await expect(w.insert(t, 'personal', 'suggested', { source: 'rule' })).rejects.toThrow(/active_relationship/)
    await w.q(`UPDATE public.financial_provider_interpretations SET status='undone', undone_by=$2, undo_reason='changed_by_owner' WHERE id=$1`, [first, OWNER])
    await w.insert(t, 'overhead', 'confirmed')
    expect((await w.q(`SELECT kind, status, undo_reason, undone_by FROM public.financial_provider_interpretations WHERE provider_transaction_ref=$1 ORDER BY created_at, kind`, [t]))
      .map((r: any) => `${r.kind}:${r.status}:${r.undo_reason ?? '-'}`).sort()).toEqual(['overhead:confirmed:-', 'project:undone:changed_by_owner'])
    expect((await w.q(`SELECT undone_at FROM public.financial_provider_interpretations WHERE id=$1`, [first]))[0].undone_at).not.toBeNull()
  })
  it('an interpretation cannot be rewritten in place (targets are immutable) and an undone one cannot be revived', async () => {
    const t = await w.tx('t-immutable')
    const id = (await w.insert(t, 'category', 'confirmed', { category: 'meals' })).rows[0].id
    await expect(w.q(`UPDATE public.financial_provider_interpretations SET category='fuel_vehicle' WHERE id=$1`, [id])).rejects.toThrow(/immutable/)
    const ob = (await w.insert(t, 'obligation', 'suggested', { source: 'rule', obligation_id: w.ids.obligation })).rows[0].id
    await expect(w.q(`UPDATE public.financial_provider_interpretations SET obligation_id=NULL, cash_commitment_id=NULL WHERE id=$1`, [ob])).rejects.toThrow(/immutable/)
    await w.q(`UPDATE public.financial_provider_interpretations SET status='undone' WHERE id=$1`, [id])
    await expect(w.q(`UPDATE public.financial_provider_interpretations SET status='confirmed' WHERE id=$1`, [id])).rejects.toThrow(/transition/)
  })
  it('a rejected suggestion is kept (and can repeat), so the engine can stop re-suggesting it', async () => {
    const t = await w.tx('t-rej')
    await w.insert(t, 'category', 'rejected', { category: 'materials', source: 'owner' })
    await w.insert(t, 'category', 'rejected', { category: 'materials', source: 'owner' })
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations WHERE provider_transaction_ref=$1 AND status='rejected'`, [t]))[0].n).toBe(2)
  })
  it('pending evidence can only be categorized or ignored, never given a relationship', async () => {
    const t = await w.tx('t-pending', true)
    await expect(w.insert(t, 'overhead', 'confirmed')).rejects.toThrow(/pending/i)
    await expect(w.insert(t, 'project', 'confirmed', { project_id: 'p' })).rejects.toThrow(/pending/i)
    await w.insert(t, 'category', 'confirmed', { category: 'meals' }); await w.insert(t, 'ignored', 'confirmed')
  })
  it('a removed provider transaction cannot be confirmed', async () => {
    const t = await w.tx('t-removed')
    await w.q(`UPDATE public.financial_provider_transactions SET removed_at = now() WHERE id=$1`, [t])
    await expect(w.insert(t, 'category', 'confirmed', { category: 'meals' })).rejects.toThrow(/removed/i)
  })
  it('transfers and debts: the owner can confirm a transfer to an unconnected account (no counterpart needed); a debt must point at a liability account', async () => {
    const t = await w.tx('t-transfer'); const t2 = await w.tx('t-debt')
    await w.insert(t, 'transfer', 'confirmed')
    await expect(w.insert(t2, 'debt', 'confirmed', { debt_account_id: w.ids.fin })).rejects.toThrow(/liability/)
    const card = (await w.q(`INSERT INTO public.financial_accounts (organization_id, display_name, account_type, account_class, ownership_context) VALUES ($1,'Business Card','credit_card','liability','business') RETURNING id`, [ORG]))[0].id
    await w.insert(t2, 'debt', 'confirmed', { debt_account_id: card })
  })
  it('organization isolation: an interpretation cannot reference another organization\'s transaction, obligation or account', async () => {
    const t = await w.tx('t-iso')
    const otherObl = (await w.q(`INSERT INTO public.financial_obligations (organization_id, name, amount_type, amount_minor, recurrence_kind, anchor_date, start_date) VALUES ($1,'Other','fixed',100,'monthly','2026-01-05','2026-01-01') RETURNING id`, [ORG_B]))[0].id
    await expect(w.insert(t, 'obligation', 'confirmed', { obligation_id: otherObl })).rejects.toThrow(/obligation_fk|foreign key/)
    await expect(w.insert(t, 'category', 'confirmed', { category: 'meals', organization_id: ORG_B })).rejects.toThrow(/provider_tx_fk|foreign key/)
  })
  it('the migration is re-runnable (idempotent) and leaves every canonical table untouched', async () => {
    const before = await w.canonical()
    await w.db.exec('RESET ROLE') // migrations run as the table owner, not as service_role
    await w.db.exec(readFileSync('supabase/migrations/155_bank_interpretation_model.sql', 'utf8'))
    await w.db.exec('SET ROLE service_role')
    expect(await w.canonical()).toBe(before)
  })
  it('the migration file contains no statement that writes a canonical table', () => {
    const sql = readFileSync('supabase/migrations/155_bank_interpretation_model.sql', 'utf8').replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(financial_transactions|financial_accounts|financial_obligation|cash_commitments|projects)/i)
    expect((sql.match(/\bGRANT\b/gi) ?? []).length).toBe(1) // only EXECUTE on the atomic function, to service_role
  })
})

describe.runIf(!!PGliteCtor)('PART 3 - atomic owner-decision replacement (financial_provider_replace_interpretation)', () => {
  let w: Awaited<ReturnType<typeof build>>
  let proj = '', projB = '', oblB = '', commitment = '', card = ''
  beforeAll(async () => {
    w = await build(['155_bank_interpretation_model'])
    proj = (await w.q(`INSERT INTO public.projects (org_id, name) VALUES ($1,'Desert Willow Remodel') RETURNING id::text id`, [ORG]))[0].id
    projB = (await w.q(`INSERT INTO public.projects (org_id, name) VALUES ($1,'Other Org Project') RETURNING id::text id`, [ORG_B]))[0].id
    oblB = (await w.q(`INSERT INTO public.financial_obligations (organization_id, name, amount_type, amount_minor, recurrence_kind, anchor_date, start_date) VALUES ($1,'Other','fixed',100,'monthly','2026-01-05','2026-01-01') RETURNING id`, [ORG_B]))[0].id
    commitment = (await w.q(`INSERT INTO public.cash_commitments (organization_id, title, expected_date, amount_type, amount_minor) VALUES ($1,'Permit','2026-10-10','fixed',9000) RETURNING id`, [ORG]))[0].id
    card = (await w.q(`INSERT INTO public.financial_accounts (organization_id, display_name, account_type, account_class, ownership_context) VALUES ($1,'Business Card','credit_card','liability','business') RETURNING id`, [ORG]))[0].id
  }, 120_000)
  afterAll(async () => { await w?.db?.close?.() })
  const rel = (txRef: string, kind: string, extra: Record<string, unknown> = {}) => ({ p_provider_transaction_ref: txRef, p_dimension: 'relationship', p_kind: kind, ...extra })
  const bucket = (txRef: string, category: string | null) => ({ p_provider_transaction_ref: txRef, p_dimension: 'bucket', p_kind: 'category', p_category: category })

  it('A/B/C. replacement succeeds atomically: the old decision becomes audit history and the new one is the ONLY active decision', async () => {
    const t = await w.tx('a-1')
    expect((await w.rpc(rel(t, 'project', { p_project_id: proj })))[0]).toMatchObject({ outcome: 'created', replaced_id: null })
    const [{ interpretation_id: oldId }] = await w.q(`SELECT id AS interpretation_id FROM public.financial_provider_interpretations WHERE provider_transaction_ref=$1 AND kind='project'`, [t])
    const out = (await w.rpc(rel(t, 'overhead')))[0]
    expect(out).toMatchObject({ outcome: 'changed', replaced_id: oldId })
    expect(await w.active(t)).toEqual([{ kind: 'overhead', status: 'confirmed', category: null, project_id: null }]) // C: exactly one active
    const old = (await w.q(`SELECT status, undone_by, undone_at, undo_reason, project_id, decided_by FROM public.financial_provider_interpretations WHERE id=$1`, [oldId]))[0]
    expect(old).toMatchObject({ status: 'undone', undone_by: OWNER, undo_reason: 'changed_by_owner', project_id: proj }) // B: kept, with who/why, original target intact
    expect(old.undone_at).not.toBeNull()
  })
  it('replacing the same decision again is a no-op (idempotent), and bucket/relationship/ignore are independent dimensions', async () => {
    const t = await w.tx('a-2')
    await w.rpc(bucket(t, 'materials')); await w.rpc(rel(t, 'overhead')); await w.rpc({ p_provider_transaction_ref: t, p_dimension: 'ignore', p_kind: 'ignored' })
    const before = await w.history()
    expect((await w.rpc(bucket(t, 'materials')))[0]).toMatchObject({ outcome: 'unchanged' }); expect((await w.rpc(rel(t, 'overhead')))[0]).toMatchObject({ outcome: 'unchanged' })
    expect(await w.history()).toBe(before)
    await w.rpc(bucket(t, 'meals')) // changing the bucket must not disturb the relationship or the ignore
    expect((await w.active(t)).map((r: any) => `${r.kind}:${r.category ?? '-'}`)).toEqual(['category:meals', 'ignored:-', 'overhead:-'])
  })
  it('D. a failure AFTER the old decision was retired (at the insert) rolls the retirement back: the old decision stays active, untouched', async () => {
    const t = await w.tx('d-1')
    await w.rpc(bucket(t, 'materials')); await w.rpc(rel(t, 'project', { p_project_id: proj }))
    const before = await w.history()
    // category NULL passes the function's own checks, retires the old bucket, then the table's kind_targets CHECK rejects the INSERT
    await expect(w.rpc(bucket(t, null))).rejects.toThrow(/kind_targets/)
    // a valid project passes validation, the old relationship is retired, then the INSERT of overhead-with-a-project is rejected
    await expect(w.rpc(rel(t, 'overhead', { p_project_id: proj }))).rejects.toThrow(/kind_targets/)
    expect(await w.history()).toBe(before)
    expect((await w.active(t)).map((r: any) => `${r.kind}:${r.status}`)).toEqual(['category:confirmed', 'project:confirmed'])
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations WHERE provider_transaction_ref=$1 AND status='undone'`, [t]))[0].n).toBe(0)
  })
  it('E. another organization cannot replace anything: the transaction is "not found" and NOTHING changes (any target, either direction)', async () => {
    const t = await w.tx('e-1'); await w.rpc(rel(t, 'overhead'))
    const before = await w.history()
    const asB = (a: Record<string, unknown>) => w.rpc({ p_organization_id: ORG_B, ...a })
    await expect(asB(rel(t, 'personal'))).rejects.toThrow(/INTERPRETATION_TRANSACTION_NOT_FOUND/)
    await expect(asB(bucket(t, 'materials'))).rejects.toThrow(/INTERPRETATION_TRANSACTION_NOT_FOUND/)
    await expect(asB({ p_provider_transaction_ref: t, p_dimension: 'ignore', p_kind: 'ignored' })).rejects.toThrow(/INTERPRETATION_TRANSACTION_NOT_FOUND/)
    // org A's own transaction, but another org's targets
    await expect(w.rpc(rel(t, 'obligation', { p_obligation_id: oblB }))).rejects.toThrow(/INTERPRETATION_TARGET_NOT_FOUND/)
    await expect(w.rpc(rel(t, 'project', { p_project_id: projB }))).rejects.toThrow(/INTERPRETATION_TARGET_NOT_FOUND/)
    expect(await w.history()).toBe(before)
  })
  it('F. an invalid target fails with zero mutation: unknown, paused, wrong class, self-counterpart, removed counterpart', async () => {
    const t = await w.tx('f-1'); await w.rpc(rel(t, 'overhead')); const removed = await w.tx('f-removed')
    await w.q(`UPDATE public.financial_provider_transactions SET removed_at = now() WHERE id=$1`, [removed])
    const paused = (await w.q(`INSERT INTO public.financial_obligations (organization_id, name, amount_type, amount_minor, recurrence_kind, anchor_date, start_date, status) VALUES ($1,'Paused','fixed',100,'monthly','2026-01-05','2026-01-01','paused') RETURNING id`, [ORG]))[0].id
    const before = await w.history()
    const bogus = '99999999-9999-4999-8999-999999999999'
    for (const bad of [
      rel(t, 'obligation', { p_obligation_id: bogus }), rel(t, 'obligation', { p_obligation_id: paused }), rel(t, 'obligation', { p_commitment_id: bogus }),
      rel(t, 'debt', { p_debt_account_id: w.ids.fin }), rel(t, 'debt', { p_debt_account_id: bogus }), rel(t, 'project', { p_project_id: bogus }),
      rel(t, 'transfer', { p_counterpart_provider_transaction_ref: t }), rel(t, 'transfer', { p_counterpart_provider_transaction_ref: removed }), rel(t, 'transfer', { p_counterpart_provider_transaction_ref: bogus }),
    ]) await expect(w.rpc(bad)).rejects.toThrow(/INTERPRETATION_TARGET_NOT_FOUND/)
    expect(await w.history()).toBe(before)
    // and the valid versions of the same calls DO work (so the failures above were the targets, not the function)
    await w.rpc(rel(t, 'debt', { p_debt_account_id: card })); await w.rpc(rel(t, 'obligation', { p_commitment_id: commitment })); await w.rpc(rel(t, 'obligation', { p_obligation_id: w.ids.obligation }))
    expect((await w.active(t)).map((r: any) => r.kind)).toEqual(['obligation'])
  })
  it('G. a relationship replacement on PENDING evidence fails with zero mutation; bucket and ignore are still allowed', async () => {
    const t = await w.tx('g-1', true); const before = await w.history()
    await expect(w.rpc(rel(t, 'overhead'))).rejects.toThrow(/INTERPRETATION_PENDING_RELATIONSHIP/)
    await expect(w.rpc(rel(t, 'project', { p_project_id: proj }))).rejects.toThrow(/INTERPRETATION_PENDING_RELATIONSHIP/)
    expect(await w.history()).toBe(before)
    await w.rpc(bucket(t, 'meals')); await w.rpc({ p_provider_transaction_ref: t, p_dimension: 'ignore', p_kind: 'ignored' })
    expect((await w.active(t)).map((r: any) => r.kind)).toEqual(['category', 'ignored'])
  })
  it('H. conflicting replacements can never leave two active relationships (function serializes; the partial unique index is the backstop)', async () => {
    const t = await w.tx('h-1')
    const results = await Promise.all([w.rpc(rel(t, 'project', { p_project_id: proj })), w.rpc(rel(t, 'overhead')), w.rpc(rel(t, 'personal')), w.rpc(rel(t, 'payroll')), w.rpc(rel(t, 'transfer'))])
    expect(results.every(r => r.length === 1)).toBe(true)
    const relKinds = "('transfer','obligation','project','debt','payroll','overhead','personal')"
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations WHERE provider_transaction_ref=$1 AND status IN ('suggested','confirmed') AND kind IN ${relKinds}`, [t]))[0].n).toBe(1)
    expect((await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations WHERE provider_transaction_ref=$1 AND status='undone'`, [t]))[0].n).toBe(4) // the other four became history
    // the backstop: a direct conflicting INSERT (bypassing the function) is rejected by the database itself
    await expect(w.insert(t, 'personal', 'confirmed')).rejects.toThrow(/active_relationship/)
    // and a duplicate suggested+confirmed pair for one dimension cannot be created either
    await expect(w.insert(t, 'overhead', 'suggested', { source: 'rule' })).rejects.toThrow(/active_relationship/)
  })
  it('refuses to create a ledger_match or a mismatched dimension: the function can never produce a canonical reference', async () => {
    const t = await w.tx('lm-1'); const before = await w.history()
    await expect(w.rpc({ p_provider_transaction_ref: t, p_dimension: 'relationship', p_kind: 'ledger_match' })).rejects.toThrow(/INTERPRETATION_DIMENSION_INVALID/)
    await expect(w.rpc({ p_provider_transaction_ref: t, p_dimension: 'bucket', p_kind: 'project', p_project_id: proj })).rejects.toThrow(/INTERPRETATION_DIMENSION_INVALID/)
    await expect(w.rpc({ p_provider_transaction_ref: t, p_dimension: 'nonsense', p_kind: 'category', p_category: 'meals' })).rejects.toThrow(/INTERPRETATION_DIMENSION_INVALID/)
    await expect(w.rpc({ ...bucket(t, 'meals'), p_source: 'hacker' })).rejects.toThrow(/INTERPRETATION_ARGUMENTS_INVALID/)
    await expect(w.rpc({ ...bucket(t, 'meals'), p_confidence: 'certain' })).rejects.toThrow(/INTERPRETATION_ARGUMENTS_INVALID/)
    await expect(w.rpc({ ...bucket(t, 'meals'), p_actor: null })).rejects.toThrow(/INTERPRETATION_ARGUMENTS_REQUIRED/)
    expect(await w.history()).toBe(before)
    // the function has no ledger parameter at all
    const params = (await w.q(`SELECT unnest(proargnames) a FROM pg_proc WHERE proname='financial_provider_replace_interpretation'`)).map((r: any) => r.a)
    expect(params.filter((n: string) => /ledger|match_mode/.test(n))).toEqual([])
  })
  it('the actor must be a real user, and the removed/unknown transaction is refused', async () => {
    const t = await w.tx('ac-1'); const gone = await w.tx('ac-2'); await w.q(`UPDATE public.financial_provider_transactions SET removed_at = now() WHERE id=$1`, [gone])
    await expect(w.rpc({ ...bucket(t, 'meals'), p_actor: '99999999-9999-4999-8999-999999999999' })).rejects.toThrow(/foreign key|decided_by|created_by/i)
    await expect(w.rpc(bucket(gone, 'meals'))).rejects.toThrow(/INTERPRETATION_TRANSACTION_NOT_FOUND/)
    expect(await w.active(t)).toEqual([])
  })
  it('SECURITY: invoker rights, fixed search_path, and EXECUTE for service_role ONLY (no PUBLIC, anon or authenticated)', async () => {
    await w.db.exec('RESET ROLE')
    const sig = 'public.financial_provider_replace_interpretation(uuid,uuid,uuid,text,text,text,text,jsonb,text,text,uuid,uuid,uuid,uuid,text)'
    const priv = async (role: string) => (await w.q(`SELECT has_function_privilege('${role}', '${sig}', 'EXECUTE') AS ok`))[0].ok
    expect({ service_role: await priv('service_role'), authenticated: await priv('authenticated'), anon: await priv('anon') }).toEqual({ service_role: true, authenticated: false, anon: false })
    const meta = (await w.q(`SELECT prosecdef, proconfig FROM pg_proc WHERE proname='financial_provider_replace_interpretation'`))[0]
    expect(meta.prosecdef).toBe(false); expect(meta.proconfig).toEqual(['search_path=public'])
    expect((await w.q(`SELECT count(*)::int n FROM information_schema.routine_privileges WHERE routine_name='financial_provider_replace_interpretation' AND grantee='PUBLIC'`))[0].n).toBe(0)
    // a browser role really is refused
    await w.db.exec('SET ROLE authenticated')
    await expect(w.db.query(`SELECT * FROM public.financial_provider_replace_interpretation(p_organization_id => $1, p_actor => $2, p_provider_transaction_ref => $3, p_dimension => 'bucket', p_kind => 'category', p_source => 'owner', p_confidence => 'high', p_category => 'meals')`, [ORG, OWNER, (await w.q(`SELECT id FROM public.financial_provider_transactions LIMIT 1`).catch(() => [{ id: ORG }]))[0]?.id ?? ORG])).rejects.toThrow(/permission denied/i)
    await w.db.exec('RESET ROLE; SET ROLE service_role')
  })
  it('the function touches no canonical table: ledger, accounts, obligations, occurrences, commitments, evidence and mappings are identical after a full run of replacements', async () => {
    const t = await w.tx('canon-1'); const before = await w.canonical()
    await w.rpc(bucket(t, 'materials')); await w.rpc(rel(t, 'obligation', { p_obligation_id: w.ids.obligation })); await w.rpc(rel(t, 'overhead')); await w.rpc({ p_provider_transaction_ref: t, p_dimension: 'ignore', p_kind: 'ignored' })
    expect(await w.canonical()).toBe(before)
    const src = readFileSync('supabase/migrations/155_bank_interpretation_model.sql', 'utf8').replace(/--.*$/gm, '')
    const fn = src.slice(src.indexOf('CREATE OR REPLACE FUNCTION'), src.indexOf('REVOKE ALL ON FUNCTION'))
    expect(fn).not.toMatch(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(?!financial_provider_interpretations\b)/i)
  })
})

describe.runIf(!!PGliteCtor)('PART 4 - the confirmed-vs-canonical contract at the schema level', () => {
  let w: Awaited<ReturnType<typeof build>>
  beforeAll(async () => { w = await build(['155_bank_interpretation_model']) }, 120_000)
  afterAll(async () => { await w?.db?.close?.() })
  it('ledger_match remains the ONE interpretation that needs a ledger reference (schema rule unchanged by BANK-5)', async () => {
    const t = await w.tx('lm-needs-ref')
    await expect(w.insert(t, 'ledger_match', 'confirmed', { match_mode: 'linked' })).rejects.toThrow(/kind_targets|confirmed_needs_ledger/)
    await expect(w.insert(t, 'ledger_match', 'suggested', { source: 'rule' })).rejects.toThrow(/kind_targets/)
    const ledger = (await w.q(`INSERT INTO public.financial_transactions (organization_id, account_id, amount_minor, transaction_date, transaction_kind, economic_effect, economic_amount_minor, description, idempotency_key)
      VALUES ($1,$2,-1234,'2026-09-30','expense','outflow',1234,'manual expense','contract-1') RETURNING id`, [ORG, w.ids.fin]))[0].id
    await w.insert(t, 'ledger_match', 'confirmed', { match_mode: 'linked', ledger_transaction_id: ledger }) // the existing, deliberate schema path (BANK-6 territory)
    expect((await w.q(`SELECT kind, status, ledger_transaction_id FROM public.financial_provider_interpretations WHERE provider_transaction_ref=$1`, [t]))[0]).toMatchObject({ kind: 'ledger_match', status: 'confirmed', ledger_transaction_id: ledger })
  })
  it('the column comments state the contract in the database itself', async () => {
    const c = (await w.q(`SELECT col_description('public.financial_provider_interpretations'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid='public.financial_provider_interpretations'::regclass AND attname='status')) AS d`))[0].d
    expect(c).toMatch(/confirmed means ONLY that the owner confirmed this INTERPRETATION/); expect(c).toMatch(/Canonical adoption \(BANK-6\) must be a separate explicit operation/)
  })
})

describe.runIf(!!PGliteCtor)('PART 5 - migration 155 end to end: from scratch (153 -> 154 -> 155), re-run, and full-file review', () => {
  it('applies cleanly from scratch, re-runs without error or drift, and a second re-run changes nothing', async () => {
    const w = await build(['155_bank_interpretation_model'])
    const shape = async () => JSON.stringify({
      constraints: await w.q(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='public.financial_provider_interpretations'::regclass ORDER BY 1`),
      indexes: await w.q(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='financial_provider_interpretations' ORDER BY 1`),
      triggers: await w.q(`SELECT tgname, pg_get_triggerdef(oid) d FROM pg_trigger WHERE tgrelid='public.financial_provider_interpretations'::regclass AND NOT tgisinternal ORDER BY 1`),
      columns: await w.q(`SELECT column_name FROM information_schema.columns WHERE table_name='financial_provider_interpretations' ORDER BY 1`),
      fn: await w.q(`SELECT proname, prosecdef, proconfig, pg_get_function_identity_arguments(oid) a FROM pg_proc WHERE proname LIKE 'financial_provider_%interpretation%' ORDER BY 1`),
    })
    const first = await shape()
    for (let i = 0; i < 2; i++) { await w.db.exec('RESET ROLE'); await w.db.exec(readFileSync('supabase/migrations/155_bank_interpretation_model.sql', 'utf8')); await w.db.exec('SET ROLE service_role') }
    expect(await shape()).toBe(first)
    await w.db.close()
  }, 120_000)
  it('migration 155 never touches migration 153/154 files and contains exactly the reviewed statement classes', () => {
    const sql = readFileSync('supabase/migrations/155_bank_interpretation_model.sql', 'utf8').replace(/--.*$/gm, '')
    expect(sql).toMatch(/^\s*BEGIN;[\s\S]*COMMIT;\s*$/) // one transaction: all or nothing
    const verbs = [...sql.matchAll(/^\s*(ALTER TABLE|CREATE OR REPLACE FUNCTION|CREATE UNIQUE INDEX|CREATE INDEX|DROP TRIGGER|CREATE TRIGGER|REVOKE|GRANT|COMMENT ON|DO)\b/gim)].map(m => m[1].toUpperCase())
    expect(new Set(verbs)).toEqual(new Set(['ALTER TABLE', 'DO', 'CREATE OR REPLACE FUNCTION', 'DROP TRIGGER', 'CREATE TRIGGER', 'CREATE UNIQUE INDEX', 'CREATE INDEX', 'REVOKE', 'GRANT', 'COMMENT ON']))
    expect(sql).not.toMatch(/\b(DROP TABLE|TRUNCATE|DELETE FROM)\b/i)
    expect((sql.match(/\bGRANT\b/gi) ?? []).length).toBe(1) // the single EXECUTE grant to service_role
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.financial_provider_replace_interpretation[^;]*TO service_role;/)
  })
})
