import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * BANK-1 database behavior, executed on a real PostgreSQL engine (PGlite) with the actual Cash ledger migrations
 * (139-143, 146) underneath migration 153 and Supabase-style roles/default grants. Nothing here touches production.
 * `@electric-sql/pglite` is a declared devDependency (added by the Planner work); if it is not installed these tests are
 * skipped with an explicit marker rather than silently passing.
 */
let PGliteCtor: any = null
try { PGliteCtor = (await import('@electric-sql/pglite')).PGlite } catch { PGliteCtor = null }

const ORG_A = 'a0000000-0000-4000-8000-000000000001'
const ORG_B = 'a0000000-0000-4000-8000-000000000002'
const OWNER_A = 'b0000000-0000-4000-8000-000000000001'
const EMPLOYEE_A = 'b0000000-0000-4000-8000-000000000002'
const OWNER_B = 'b0000000-0000-4000-8000-000000000003'
const FIN_A = 'e0000000-0000-4000-8000-000000000001'
const FIN_B = 'e0000000-0000-4000-8000-000000000002'
const CARD_A = 'e0000000-0000-4000-8000-000000000003'
const ITEM_A = 'c0000000-0000-4000-8000-000000000001'
const ITEM_B = 'c0000000-0000-4000-8000-000000000002'
const PACC_A = 'd0000000-0000-4000-8000-000000000001'
const PACC_A2 = 'd0000000-0000-4000-8000-000000000003'
const PACC_B = 'd0000000-0000-4000-8000-000000000002'
const PTX_A = 'f0000000-0000-4000-8000-000000000001'
const PTX_A2 = 'f0000000-0000-4000-8000-000000000002'
const PTX_B = 'f0000000-0000-4000-8000-000000000003'

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
INSERT INTO public.organizations VALUES ('${ORG_A}', 'Org A'), ('${ORG_B}', 'Org B');
INSERT INTO auth.users VALUES ('${OWNER_A}'), ('${EMPLOYEE_A}'), ('${OWNER_B}');
INSERT INTO public.test_profiles VALUES ('${OWNER_A}', '${ORG_A}', 'owner'), ('${EMPLOYEE_A}', '${ORG_A}', 'employee'), ('${OWNER_B}', '${ORG_B}', 'owner');
`
const MIGRATIONS = ['139_cash_accounts_manual_ledger', '140_cash_linked_pair_lifecycle_hardening', '141_cash_transfer_conflict_target_fix',
  '142_cash_pair_void_link_lock_fix', '143_cash_dated_obligations', '146_balance_reconciliation_kind', '153_bank_provider_evidence_foundation']
const BANK_TABLES = ['financial_provider_items', 'financial_provider_accounts', 'financial_provider_account_mappings', 'financial_provider_transactions',
  'financial_provider_balance_snapshots', 'financial_provider_webhook_events', 'financial_provider_interpretations']

describe.runIf(!!PGliteCtor)('BANK-1 provider foundation on PostgreSQL (PGlite)', () => {
  let db: any
  beforeAll(async () => {
    db = new PGliteCtor()
    await db.exec(BOOTSTRAP)
    for (const name of MIGRATIONS) await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'))
  }, 120_000)
  afterAll(async () => { await db?.close?.() })

  const claim = (user: string | null) => `SELECT set_config('request.jwt.claim.sub', '${user ?? ''}', false)`
  async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
    await db.exec(`${claim(user)}; SET ROLE authenticated`)
    try { return await fn() } finally { await db.exec(`RESET ROLE; ${claim(null)}`) }
  }
  const q = async (sql: string, params: any[] = []) => (await db.query(sql, params)).rows as any[]
  const fails = (promise: Promise<unknown>, pattern: RegExp) => expect(promise).rejects.toThrow(pattern)

  async function seed() {
    await db.exec(`
      TRUNCATE public.financial_provider_interpretations, public.financial_provider_webhook_events, public.financial_provider_balance_snapshots,
        public.financial_provider_transactions, public.financial_provider_account_mappings, public.financial_provider_accounts,
        public.financial_provider_items, public.financial_transactions, public.financial_accounts, public.financial_obligations,
        public.financial_obligation_occurrences, public.cash_commitments, public.financial_transaction_links CASCADE;
      INSERT INTO public.financial_accounts (id, organization_id, display_name, account_type, account_class, ownership_context, include_in_cash) VALUES
        ('${FIN_A}', '${ORG_A}', 'Business Checking', 'checking', 'asset', 'business', true),
        ('${CARD_A}', '${ORG_A}', 'CareCredit', 'credit_card', 'liability', 'business', false),
        ('${FIN_B}', '${ORG_B}', 'Org B Checking', 'checking', 'asset', 'business', true);
      INSERT INTO public.financial_provider_items (id, organization_id, provider, provider_item_id, status) VALUES
        ('${ITEM_A}', '${ORG_A}', 'plaid', 'item-a', 'healthy'), ('${ITEM_B}', '${ORG_B}', 'plaid', 'item-b', 'healthy');
      INSERT INTO public.financial_provider_accounts (id, organization_id, provider_item_ref, provider_account_id, name, mask, provider_account_type, provider_account_subtype) VALUES
        ('${PACC_A}', '${ORG_A}', '${ITEM_A}', 'acct-a1', 'Plaid Checking', '1234', 'depository', 'checking'),
        ('${PACC_A2}', '${ORG_A}', '${ITEM_A}', 'acct-a2', 'Plaid Savings', '5678', 'depository', 'savings'),
        ('${PACC_B}', '${ORG_B}', '${ITEM_B}', 'acct-b1', 'Org B Checking', '9999', 'depository', 'checking');
      INSERT INTO public.financial_provider_transactions (id, organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, transaction_date, name) VALUES
        ('${PTX_A}', '${ORG_A}', '${ITEM_A}', '${PACC_A}', 'ptx-a1', false, -900.00, -90000, '2026-10-06', 'DEPOSIT'),
        ('${PTX_A2}', '${ORG_A}', '${ITEM_A}', '${PACC_A}', 'ptx-a2', false, 38.00, 3800, '2026-10-07', 'QUICKBOOKS ONLINE'),
        ('${PTX_B}', '${ORG_B}', '${ITEM_B}', '${PACC_B}', 'ptx-b1', false, 10.00, 1000, '2026-10-07', 'ORG B');
    `)
  }
  beforeEach(async () => { await seed() })

  const ledger = (id: string, org: string, account: string, minor: number, extra = '') =>
    `INSERT INTO public.financial_transactions (id, organization_id, account_id, amount_minor, transaction_date, transaction_kind, economic_effect, economic_amount_minor, idempotency_key ${extra ? ', ' + extra.split('|')[0] : ''})
     VALUES ('${id}', '${org}', '${account}', ${minor}, '2026-10-06', '${minor > 0 ? 'income' : 'expense'}', '${minor > 0 ? 'inflow' : 'outflow'}', ${Math.abs(minor)}, 'k-${id}' ${extra ? ', ' + extra.split('|')[1] : ''})`
  const ledgerBalance = async () => Number((await q(`SELECT coalesce(sum(amount_minor), 0)::bigint AS s FROM public.financial_transactions WHERE status = 'posted'`))[0].s)

  it('1: provider items are organization-owned and a provider item id is globally unique', async () => {
    await fails(db.exec(`INSERT INTO public.financial_provider_items (organization_id, provider, provider_item_id) VALUES ('${ORG_B}', 'plaid', 'item-a')`), /duplicate key|unique/i)
    await fails(db.exec(`INSERT INTO public.financial_provider_items (organization_id, provider, provider_item_id) VALUES ('00000000-0000-4000-8000-0000000000ff', 'plaid', 'x')`), /foreign key/i)
    await fails(db.exec(`UPDATE public.financial_provider_items SET organization_id = '${ORG_B}' WHERE id = '${ITEM_A}'`), /immutable/i)
    await fails(db.exec(`UPDATE public.financial_provider_items SET provider_item_id = 'other' WHERE id = '${ITEM_A}'`), /immutable/i)
  })

  it('2: provider account identity is the provider id, not the name or mask', async () => {
    await fails(db.exec(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name) VALUES ('${ORG_A}', '${ITEM_A}', 'acct-a1', 'Renamed')`), /duplicate key|unique/i)
    await db.exec(`UPDATE public.financial_provider_accounts SET name = 'Renamed Checking', mask = '4321' WHERE id = '${PACC_A}'`)
    expect((await q(`SELECT count(*)::int AS n FROM public.financial_provider_accounts WHERE organization_id = '${ORG_A}'`))[0].n).toBe(2) // no new account
    await fails(db.exec(`UPDATE public.financial_provider_accounts SET provider_account_id = 'x' WHERE id = '${PACC_A}'`), /immutable/i)
    await fails(db.exec(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id) VALUES ('${ORG_B}', '${ITEM_A}', 'z')`), /foreign key/i) // item belongs to org A
  })

  it('3: account mapping is one-to-one while active, and history is kept', async () => {
    const map = (p: string, f: string) => as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_account_mappings (organization_id, provider_account_ref, financial_account_id) VALUES ('${ORG_A}', '${p}', '${f}')`))
    await map(PACC_A, FIN_A)
    await fails(map(PACC_A, CARD_A), /duplicate key|unique/i) // provider account already mapped
    await fails(map(PACC_A2, FIN_A), /duplicate key|unique/i) // Cash OS account already fed by another provider account
    const id = (await q(`SELECT id FROM public.financial_provider_account_mappings WHERE status = 'active'`))[0].id
    await as(OWNER_A, () => db.exec(`UPDATE public.financial_provider_account_mappings SET status = 'inactive', deactivation_reason = 'wrong account' WHERE id = '${id}'`))
    const row = (await q(`SELECT * FROM public.financial_provider_account_mappings WHERE id = '${id}'`))[0]
    expect(row.deactivated_by).toBe(OWNER_A); expect(row.deactivated_at).toBeTruthy()
    await fails(as(OWNER_A, () => db.exec(`UPDATE public.financial_provider_account_mappings SET status = 'active', deactivated_at = NULL WHERE id = '${id}'`)), /cannot be reactivated/i)
    await map(PACC_A2, FIN_A) // a fresh mapping is fine after deactivation; the old row remains as history
    expect((await q(`SELECT count(*)::int AS n FROM public.financial_provider_account_mappings`))[0].n).toBe(2)
    await fails(db.exec(`UPDATE public.financial_provider_account_mappings SET financial_account_id = '${CARD_A}' WHERE status = 'active'`), /immutable/i)
  })

  it('4: a cross-organization mapping is impossible (database and RLS)', async () => {
    await fails(db.exec(`INSERT INTO public.financial_provider_account_mappings (organization_id, provider_account_ref, financial_account_id) VALUES ('${ORG_A}', '${PACC_A}', '${FIN_B}')`), /foreign key|must exist in this organization/i) // the guard trigger fires first; the composite FK is the second line
    await fails(db.exec(`INSERT INTO public.financial_provider_account_mappings (organization_id, provider_account_ref, financial_account_id) VALUES ('${ORG_A}', '${PACC_B}', '${FIN_A}')`), /foreign key|must exist in this organization/i)
    await fails(as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_account_mappings (organization_id, provider_account_ref, financial_account_id) VALUES ('${ORG_B}', '${PACC_B}', '${FIN_B}')`)), /row-level security|must exist in this organization/i) // RLS hides org B rows from the guard, and the policy is the second line
    // spoofing mapped_by is refused
    await fails(as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_account_mappings (organization_id, provider_account_ref, financial_account_id, mapped_by) VALUES ('${ORG_A}', '${PACC_A}', '${FIN_A}', '${OWNER_B}')`)), /row-level security|foreign key/i)
  })

  it('5: a mapping never changes the Cash OS account (include_in_cash, class, type are untouched)', async () => {
    const before = await q(`SELECT * FROM public.financial_accounts ORDER BY id`)
    await as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_account_mappings (organization_id, provider_account_ref, financial_account_id) VALUES ('${ORG_A}', '${PACC_A}', '${FIN_A}')`))
    expect(await q(`SELECT * FROM public.financial_accounts ORDER BY id`)).toEqual(before)
    expect((await q(`SELECT include_in_cash FROM public.financial_accounts WHERE id = '${FIN_A}'`))[0].include_in_cash).toBe(true)
  })

  it('6: raw provider transaction identity is unique per item, and the upsert pattern is idempotent', async () => {
    await fails(db.exec(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, transaction_date)
      VALUES ('${ORG_A}', '${ITEM_A}', '${PACC_A}', 'ptx-a1', false, 1.00, 100, '2026-10-06')`), /duplicate key|unique/i)
    const upsert = `INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, transaction_date, name)
      VALUES ('${ORG_A}', '${ITEM_A}', '${PACC_A}', 'ptx-a2', false, 38.50, 3850, '2026-10-07', 'QUICKBOOKS (modified)')
      ON CONFLICT (provider_item_ref, provider_transaction_id) DO UPDATE SET provider_amount = EXCLUDED.provider_amount, provider_amount_minor = EXCLUDED.provider_amount_minor, name = EXCLUDED.name, last_seen_at = now()`
    await db.exec(upsert); await db.exec(upsert) // redelivered
    const rows = await q(`SELECT * FROM public.financial_provider_transactions WHERE provider_transaction_id = 'ptx-a2'`)
    expect(rows).toHaveLength(1); expect(rows[0].provider_amount_minor).toBe('3850' === String(rows[0].provider_amount_minor) ? 3850 : rows[0].provider_amount_minor)
    expect(Number(rows[0].provider_amount_minor)).toBe(3850)
    await fails(db.exec(`UPDATE public.financial_provider_transactions SET provider_transaction_id = 'other' WHERE id = '${PTX_A}'`), /immutable/i)
    await fails(db.exec(`UPDATE public.financial_provider_transactions SET organization_id = '${ORG_B}' WHERE id = '${PTX_A}'`), /immutable/i)
  })

  it('7/8: pending and removed states are representable, and the pending-to-posted link is only on posted rows', async () => {
    await db.exec(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, transaction_date)
      VALUES ('${ORG_A}', '${ITEM_A}', '${PACC_A}', 'p-pending', true, 25.00, 2500, '2026-10-08')`)
    await db.exec(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, pending_provider_transaction_id, provider_amount, provider_amount_minor, transaction_date)
      VALUES ('${ORG_A}', '${ITEM_A}', '${PACC_A}', 'p-posted', false, 'p-pending', 25.00, 2500, '2026-10-09')`)
    await fails(db.exec(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, pending_provider_transaction_id, provider_amount, provider_amount_minor, transaction_date)
      VALUES ('${ORG_A}', '${ITEM_A}', '${PACC_A}', 'bad', true, 'x', 1.00, 100, '2026-10-09')`), /pending_link|check/i)
    await db.exec(`UPDATE public.financial_provider_transactions SET removed_at = now() WHERE provider_transaction_id = 'p-pending'`)
    const row = (await q(`SELECT pending, removed_at FROM public.financial_provider_transactions WHERE provider_transaction_id = 'p-pending'`))[0]
    expect(row.pending).toBe(true); expect(row.removed_at).toBeTruthy() // still there: evidence is never deleted
  })

  it('9: provider rows cannot touch the ledger, and no trigger or function links the two', async () => {
    const before = { balance: await ledgerBalance(), n: (await q(`SELECT count(*)::int AS n FROM public.financial_transactions`))[0].n }
    await db.exec(`INSERT INTO public.financial_provider_balance_snapshots (organization_id, provider_account_ref, observed_at, current_balance, current_balance_minor, source)
      VALUES ('${ORG_A}', '${PACC_A}', now(), 123456.78, 12345678, 'test')`)
    await as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, category) VALUES ('${ORG_A}', '${PTX_A2}', 'category', 'owner', 'Software')`))
    expect({ balance: await ledgerBalance(), n: (await q(`SELECT count(*)::int AS n FROM public.financial_transactions`))[0].n }).toEqual(before)
    const writers = await q(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'financial_provider%' AND (p.prosrc ILIKE '%INSERT INTO public.financial_transactions%' OR p.prosrc ILIKE '%UPDATE public.financial_transactions%' OR p.prosrc ILIKE '%UPDATE public.financial_accounts%')`)
    expect(writers).toEqual([])
    const triggersOnLedger = await q(`SELECT tgname FROM pg_trigger WHERE tgrelid IN ('public.financial_transactions'::regclass, 'public.financial_accounts'::regclass) AND tgname LIKE 'trg_fp%'`)
    expect(triggersOnLedger).toEqual([])
  })

  it('10/11/12: interpretation is reversible and auditable; raw evidence is never altered', async () => {
    const rawBefore = (await q(`SELECT * FROM public.financial_provider_transactions WHERE id = '${PTX_A2}'`))[0]
    await as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (id, organization_id, provider_transaction_ref, kind, source, category, confidence)
      VALUES ('11111111-0000-4000-8000-000000000001', '${ORG_A}', '${PTX_A2}', 'category', 'owner', 'Software', 'high')`))
    // owner confirms; the caller's identity is stamped and cannot be spoofed
    await as(OWNER_A, () => db.exec(`UPDATE public.financial_provider_interpretations SET status = 'confirmed', decided_by = '${OWNER_B}' WHERE id = '11111111-0000-4000-8000-000000000001'`))
    let row = (await q(`SELECT * FROM public.financial_provider_interpretations WHERE id = '11111111-0000-4000-8000-000000000001'`))[0]
    expect(row.status).toBe('confirmed'); expect(row.decided_by).toBe(OWNER_A); expect(row.decided_at).toBeTruthy()
    await as(OWNER_A, () => db.exec(`UPDATE public.financial_provider_interpretations SET status = 'undone', undo_reason = 'wrong category' WHERE id = '11111111-0000-4000-8000-000000000001'`))
    row = (await q(`SELECT * FROM public.financial_provider_interpretations WHERE id = '11111111-0000-4000-8000-000000000001'`))[0]
    expect(row.status).toBe('undone'); expect(row.undone_by).toBe(OWNER_A); expect(row.undone_at).toBeTruthy()
    expect(row.created_by).toBe(OWNER_A)
    expect((await q(`SELECT * FROM public.financial_provider_transactions WHERE id = '${PTX_A2}'`))[0]).toEqual(rawBefore) // raw row untouched
    await fails(as(OWNER_A, () => db.exec(`UPDATE public.financial_provider_interpretations SET status = 'confirmed' WHERE id = '11111111-0000-4000-8000-000000000001'`)), /Invalid interpretation transition/i)
    await fails(as(OWNER_A, () => db.exec(`UPDATE public.financial_provider_interpretations SET category = 'Other' WHERE id = '11111111-0000-4000-8000-000000000001'`)), /immutable/i)
    // after an undo the owner can record a fresh interpretation of the same kind
    await as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, category) VALUES ('${ORG_A}', '${PTX_A2}', 'category', 'owner', 'Subscriptions')`))
    await fails(as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, category) VALUES ('${ORG_A}', '${PTX_A2}', 'category', 'owner', 'Again')`)), /duplicate key|unique/i) // one ACTIVE per kind
  })

  it('13: the browser can only insert owner-sourced interpretations; suggestions come from the server', async () => {
    await fails(as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, category) VALUES ('${ORG_A}', '${PTX_A2}', 'category', 'system_suggestion', 'X')`)), /row-level security/i)
    await db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, category, confidence) VALUES ('${ORG_A}', '${PTX_A2}', 'category', 'system_suggestion', 'Software', 'possible')`) // service/superuser path
    expect((await q(`SELECT status FROM public.financial_provider_interpretations`))[0].status).toBe('suggested')
  })

  it('14: a confirmed interpretation needs its canonical ledger row; project meaning cannot be fabricated without one', async () => {
    await fails(as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, project_id, status) VALUES ('${ORG_A}', '${PTX_A}', 'project', 'owner', 'dw', 'confirmed')`)), /confirmed_needs_ledger|check/i)
    await as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, project_id) VALUES ('${ORG_A}', '${PTX_A}', 'project', 'owner', 'dw')`)) // only a suggestion
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'financial_provider_interpretations'`)).map(r => r.column_name)
    expect(cols.filter(c => /project_payment|payment_log|payroll_paid|log_id/i.test(c))).toEqual([]) // no invented project-payment/payroll targets
    await fails(db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source) VALUES ('${ORG_A}', '${PTX_A}', 'project', 'owner')`), /kind_targets|check/i) // project needs a project id
  })

  it('15: kind-specific targets are enforced and must be organization-consistent', async () => {
    const ins = (cols: string, vals: string) => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, source, ${cols}) VALUES ('${ORG_A}', '${PTX_A}', 'owner', ${vals})`)
    await fails(ins('kind, debt_account_id', `'debt', '${FIN_A}'`), /liability account/i) // asset account is not a debt target
    await ins('kind, debt_account_id', `'debt', '${CARD_A}'`)
    await fails(ins('kind, debt_account_id', `'debt', '${FIN_B}'`), /foreign key|liability account/i) // other organization: guard or composite FK
    await fails(ins('kind, category, project_id', `'category', 'x', 'dw'`), /kind_targets|check/i)
    await fails(ins('kind', `'obligation'`), /kind_targets|check/i)
  })

  it('16: ledger adoption identity: one provider transaction -> at most one live ledger row', async () => {
    const src = (ptx: string) => `source_type, source_organization_id, source_kind, source_record_id`
    const insertLedger = (id: string, ptx: string, key: string) => db.exec(`INSERT INTO public.financial_transactions
      (id, organization_id, account_id, amount_minor, transaction_date, transaction_kind, economic_effect, economic_amount_minor, idempotency_key, source_type, source_organization_id, source_kind, source_record_id)
      VALUES ('${id}', '${ORG_A}', '${FIN_A}', 3800, '2026-10-07', 'income', 'inflow', 3800, '${key}', 'future_provider', '${ORG_A}', 'provider_transaction', '${ptx}')`)
    const L1 = '22222222-0000-4000-8000-000000000001', L2 = '22222222-0000-4000-8000-000000000002'
    await insertLedger(L1, PTX_A2, 'provider_transaction:a2')
    await fails(insertLedger(L2, PTX_A2, 'provider_transaction:a2-dup'), /duplicate key|uq_financial_transactions_operational_source/i) // existing ledger identity blocks a second live row
    // adopted match must carry the matching source identity
    await as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, ledger_transaction_id, match_mode, status) VALUES ('${ORG_A}', '${PTX_A2}', 'ledger_match', 'owner', '${L1}', 'adopted', 'confirmed')`))
    await fails(as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, ledger_transaction_id, match_mode, status) VALUES ('${ORG_A}', '${PTX_A}', 'ledger_match', 'owner', '${L1}', 'adopted', 'confirmed')`)), /source identity|unique|different provider/i)
    // a manually entered ledger row can be LINKED (not adopted); and a ledger row can be the confirmed match of only one provider transaction
    const MANUAL = '22222222-0000-4000-8000-000000000009'
    await db.exec(ledger(MANUAL, ORG_A, FIN_A, -90000))
    await as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, ledger_transaction_id, match_mode, status) VALUES ('${ORG_A}', '${PTX_A}', 'ledger_match', 'owner', '${MANUAL}', 'linked', 'confirmed')`))
    await fails(as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, ledger_transaction_id, match_mode, status) VALUES ('${ORG_A}', '${PTX_A2}', 'ledger_match', 'owner', '${MANUAL}', 'linked', 'confirmed')`)), /duplicate key|unique|ledger_match/i)
    // voiding the adopted ledger row frees the identity for a clean re-adoption (existing ledger lifecycle)
    await db.exec(`UPDATE public.financial_transactions SET status = 'voided', void_reason = 'test' WHERE id = '${L1}'`)
    await insertLedger(L2, PTX_A2, 'provider_transaction:a2-readopt')
  })

  it('17: pending or removed provider transactions cannot be confirmed into canonical meaning', async () => {
    await db.exec(`INSERT INTO public.financial_provider_transactions (id, organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, transaction_date)
      VALUES ('f0000000-0000-4000-8000-0000000000aa', '${ORG_A}', '${ITEM_A}', '${PACC_A}', 'pend', true, 5.00, 500, '2026-10-08')`)
    const LID = '22222222-0000-4000-8000-0000000000aa'
    await db.exec(ledger(LID, ORG_A, FIN_A, -500))
    await fails(as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, ledger_transaction_id, match_mode, status)
      VALUES ('${ORG_A}', 'f0000000-0000-4000-8000-0000000000aa', 'ledger_match', 'owner', '${LID}', 'linked', 'confirmed')`)), /pending provider transaction/i)
    await db.exec(`UPDATE public.financial_provider_transactions SET pending = false, removed_at = now() WHERE id = 'f0000000-0000-4000-8000-0000000000aa'`)
    await fails(as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, ledger_transaction_id, match_mode, status)
      VALUES ('${ORG_A}', 'f0000000-0000-4000-8000-0000000000aa', 'ledger_match', 'owner', '${LID}', 'linked', 'confirmed')`)), /removed provider transaction/i)
  })

  it('18: money is exact minor units: sub-cent amounts and mismatched minors are rejected', async () => {
    const ins = (amount: string, minor: number) => db.exec(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, transaction_date)
      VALUES ('${ORG_A}', '${ITEM_A}', '${PACC_A}', 'm-${amount}-${minor}', false, ${amount}, ${minor}, '2026-10-06')`)
    await ins('-12.34', -1234); await ins('0.00', 0); await ins('1234567.89', 123456789)
    await fails(ins('12.345', 1235), /minor_exact|check/i) // fractional cent
    await fails(ins('12.34', 1235), /minor_exact|check/i) // minor does not match the decimal
    await fails(ins('12.34', -1234), /minor_exact|check/i) // sign flip is not silently fixed
    await fails(db.exec(`INSERT INTO public.financial_provider_balance_snapshots (organization_id, provider_account_ref, observed_at, current_balance, current_balance_minor, source) VALUES ('${ORG_A}', '${PACC_A}', now(), 1.005, 100, 'x')`), /exact|check/i)
    await fails(db.exec(`INSERT INTO public.financial_provider_balance_snapshots (organization_id, provider_account_ref, observed_at, source) VALUES ('${ORG_A}', '${PACC_A}', now(), 'x')`), /has_balance|check/i)
  })

  it('19: balance snapshots are append-only evidence and never change the ledger balance', async () => {
    await db.exec(ledger('22222222-0000-4000-8000-0000000000b1', ORG_A, FIN_A, 100000))
    const before = await ledgerBalance()
    await db.exec(`INSERT INTO public.financial_provider_balance_snapshots (id, organization_id, provider_account_ref, observed_at, current_balance, current_balance_minor, available_balance, available_balance_minor, source)
      VALUES ('33333333-0000-4000-8000-000000000001', '${ORG_A}', '${PACC_A}', now(), 5.55, 555, 5.00, 500, 'sync')`)
    expect(await ledgerBalance()).toBe(before) // provider says $5.55, ledger still says $1,000.00
    await fails(db.exec(`UPDATE public.financial_provider_balance_snapshots SET current_balance_minor = 0 WHERE id = '33333333-0000-4000-8000-000000000001'`), /append-only/i)
  })

  it('20: no credentials can be stored in raw evidence, and no table has a token/secret column', async () => {
    await fails(db.exec(`UPDATE public.financial_provider_transactions SET raw_payload = '{"access_token":"abc"}' WHERE id = '${PTX_A}'`), /is_safe|check/i)
    await fails(db.exec(`UPDATE public.financial_provider_accounts SET provider_metadata = '{"client_secret":"abc"}' WHERE id = '${PACC_A}'`), /is_safe|check/i)
    await fails(db.exec(`INSERT INTO public.financial_provider_webhook_events (organization_id, provider_item_ref, provider, event_key, payload) VALUES ('${ORG_A}', '${ITEM_A}', 'plaid', 'k', '{"public_token":"x"}')`), /is_safe|check/i)
    const cols = await q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)`, [BANK_TABLES])
    expect(cols.filter(c => /token|secret|password|credential|api_key/i.test(c.column_name))).toEqual([])
  })

  it('21: webhook events are idempotent per organization/provider/event key', async () => {
    const ins = `INSERT INTO public.financial_provider_webhook_events (organization_id, provider_item_ref, provider, event_key, webhook_type, webhook_code) VALUES ('${ORG_A}', '${ITEM_A}', 'plaid', 'evt-1', 'TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE')`
    await db.exec(ins)
    await fails(db.exec(ins), /duplicate key|unique/i)
    await db.exec(`UPDATE public.financial_provider_webhook_events SET delivery_count = delivery_count + 1, last_received_at = now() WHERE event_key = 'evt-1'`)
    await fails(db.exec(`UPDATE public.financial_provider_webhook_events SET event_key = 'evt-2' WHERE event_key = 'evt-1'`), /immutable/i)
    await fails(db.exec(`UPDATE public.financial_provider_webhook_events SET processing_status = 'processed' WHERE event_key = 'evt-1'`), /processed_consistent|check/i)
  })

  it('22: sync state lives on the server-only item and the provider-neutral model accepts other providers', async () => {
    await db.exec(`UPDATE public.financial_provider_items SET sync_status = 'syncing', sync_cursor = 'cursor-1', last_sync_started_at = now() WHERE id = '${ITEM_A}'`)
    await db.exec(`UPDATE public.financial_provider_items SET sync_status = 'idle', last_sync_completed_at = now(), last_successful_sync_at = now() WHERE id = '${ITEM_A}'`)
    await db.exec(`INSERT INTO public.financial_provider_items (organization_id, provider, provider_item_id) VALUES ('${ORG_A}', 'othervendor', 'item-a')`) // same item id, different provider
    await fails(db.exec(`INSERT INTO public.financial_provider_items (organization_id, provider, provider_item_id, status) VALUES ('${ORG_A}', 'plaid', 'x', 'not_connected')`), /check/i)
    await fails(db.exec(`UPDATE public.financial_provider_items SET status = 'disconnected' WHERE id = '${ITEM_A}'`), /disconnect_consistent|check/i)
    await db.exec(`UPDATE public.financial_provider_items SET status = 'disconnected', disconnected_at = now() WHERE id = '${ITEM_A}'`)
    expect((await q(`SELECT count(*)::int AS n FROM public.financial_provider_transactions WHERE provider_item_ref = '${ITEM_A}'`))[0].n).toBeGreaterThan(0) // evidence survives disconnect
  })

  it('23: RLS is enabled on every table and tenants cannot read or change each other\'s rows', async () => {
    const flags = await q(`SELECT relname, relrowsecurity FROM pg_class WHERE oid = ANY(SELECT ('public.' || t)::regclass FROM unnest($1::text[]) t)`, [BANK_TABLES])
    expect(flags).toHaveLength(7); expect(flags.every(f => f.relrowsecurity)).toBe(true)
    await as(OWNER_A, async () => {
      expect((await q(`SELECT count(*)::int AS n FROM public.financial_provider_transactions`))[0].n).toBe(2) // org A only
      expect((await q(`SELECT count(*)::int AS n FROM public.financial_provider_accounts`))[0].n).toBe(2)
      expect((await q(`SELECT count(*)::int AS n FROM public.financial_provider_transactions WHERE id = '${PTX_B}'`))[0].n).toBe(0)
    })
    // The policy itself (not a guard) is what refuses a cross-organization write here.
    await fails(as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, source, category) VALUES ('${ORG_B}', '${PTX_B}', 'category', 'owner', 'X')`)), /row-level security/i)
    await as(OWNER_B, async () => { expect((await q(`SELECT count(*)::int AS n FROM public.financial_provider_transactions`))[0].n).toBe(1) })
    await as(EMPLOYEE_A, async () => { expect((await q(`SELECT count(*)::int AS n FROM public.financial_provider_transactions`))[0].n).toBe(0) }) // non-admin sees nothing
    await db.exec(`INSERT INTO public.financial_provider_account_mappings (organization_id, provider_account_ref, financial_account_id, mapped_by) VALUES ('${ORG_B}', '${PACC_B}', '${FIN_B}', '${OWNER_B}')`)
    await as(OWNER_A, async () => {
      const r = await db.query(`UPDATE public.financial_provider_account_mappings SET status = 'inactive' WHERE organization_id = '${ORG_B}' RETURNING id`)
      expect(r.rows).toHaveLength(0) // cannot touch another org's mapping
      expect((await q(`SELECT count(*)::int AS n FROM public.financial_provider_account_mappings`))[0].n).toBe(0)
    })
  })

  it('24/25: least privilege: nothing for anon, server-only tables closed to the browser, browser tables read-only where evidence', async () => {
    const priv = async (role: string, table: string, p: string) => (await q(`SELECT has_table_privilege('${role}', 'public.${table}', '${p}') AS ok`))[0].ok as boolean
    for (const t of BANK_TABLES) for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(await priv('anon', t, p), `anon ${p} ${t}`).toBe(false)
    for (const t of ['financial_provider_items', 'financial_provider_webhook_events']) for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(await priv('authenticated', t, p), `authenticated ${p} ${t}`).toBe(false)
    for (const t of ['financial_provider_accounts', 'financial_provider_transactions', 'financial_provider_balance_snapshots']) {
      expect(await priv('authenticated', t, 'SELECT')).toBe(true)
      for (const p of ['INSERT', 'UPDATE', 'DELETE']) expect(await priv('authenticated', t, p), `authenticated ${p} ${t}`).toBe(false)
    }
    for (const t of ['financial_provider_account_mappings', 'financial_provider_interpretations']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE']) expect(await priv('authenticated', t, p)).toBe(true)
      expect(await priv('authenticated', t, 'DELETE'), `authenticated DELETE ${t}`).toBe(false)
    }
    // the browser cannot write provider evidence even as an owner
    await fails(as(OWNER_A, () => db.exec(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, transaction_date) VALUES ('${ORG_A}', '${ITEM_A}', '${PACC_A}', 'x', false, 1.00, 100, '2026-10-06')`)), /permission denied/i)
    await fails(as(OWNER_A, () => q(`SELECT * FROM public.financial_provider_items`)), /permission denied/i)
  })

  it('26: the migration is re-runnable without changing data or erroring', async () => {
    const before = (await q(`SELECT count(*)::int AS n FROM public.financial_provider_transactions`))[0].n
    await db.exec(readFileSync('supabase/migrations/153_bank_provider_evidence_foundation.sql', 'utf8'))
    expect((await q(`SELECT count(*)::int AS n FROM public.financial_provider_transactions`))[0].n).toBe(before)
  })
})

describe.runIf(!PGliteCtor)('BANK-1 database behavior (skipped)', () => {
  it('PGlite is not installed; run `npm install` to enable the database behavior tests', () => { expect(PGliteCtor).toBeNull() })
})
