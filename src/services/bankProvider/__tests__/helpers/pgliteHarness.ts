// @ts-nocheck -- direct SQL against PGlite
/**
 * Shared PGlite harness for the PLAID-2 SQL tests: a Supabase-like role/auth bootstrap, every application migration the bank tables need
 * (139-147, 153-158), then any proposal drafts under test. Nothing here talks to a real database.
 */
import { readFileSync } from 'node:fs'

export const ORG = '10000000-0000-4000-8000-00000000000a'
export const ORG_B = '10000000-0000-4000-8000-00000000000b'
export const OWNER_ID = 'b0000000-0000-4000-8000-000000000001'
export const ADMIN_ID = 'b0000000-0000-4000-8000-000000000002'
export const EMPLOYEE_ID = 'b0000000-0000-4000-8000-000000000003'
export const OWNER_B_ID = 'b0000000-0000-4000-8000-000000000004'

export const BOOTSTRAP = `
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
INSERT INTO auth.users VALUES ('${OWNER_ID}'),('${ADMIN_ID}'),('${EMPLOYEE_ID}'),('${OWNER_B_ID}');
INSERT INTO public.test_profiles VALUES ('${OWNER_ID}','${ORG}','owner'),('${ADMIN_ID}','${ORG}','admin'),('${EMPLOYEE_ID}','${ORG}','employee'),('${OWNER_B_ID}','${ORG_B}','owner');`

export const MIGRATIONS = ['139_cash_accounts_manual_ledger', '140_cash_linked_pair_lifecycle_hardening', '141_cash_transfer_conflict_target_fix', '142_cash_pair_void_link_lock_fix',
  '143_cash_dated_obligations', '144_cash_os_buckets_envelopes', '145_cash_liability_terms', '146_balance_reconciliation_kind', '147_cash_owner_facts',
  '153_bank_provider_evidence_foundation', '154_bank_provider_credentials', '155_bank_interpretation_model', '156_bank_provider_environment',
  '157_bank_merchant_rules', '158_cash_os_display_colors']

export async function loadPglite() {
  try { return (await import('@electric-sql/pglite')).PGlite } catch { return null }
}
export async function loadPgliteTypes() {
  try { return (await import('@electric-sql/pglite')).types } catch { return null }
}

/** A fresh database with the application migrations and the given proposal drafts (repo-relative paths) installed, running as service_role. */
export async function createDb(PGlite, drafts = []) {
  const db = new PGlite()
  await db.exec(BOOTSTRAP)
  for (const m of MIGRATIONS) await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'))
  for (const f of drafts) await db.exec(readFileSync(f, 'utf8'))
  await db.exec('SET ROLE service_role')
  return db
}

/** Runs `fn` as an authenticated browser user (RLS applies), then restores service_role. */
export async function asUser(db, userId, fn) {
  await db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${userId}', false)`)
  try { return await fn() } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SET ROLE service_role`) }
}

export const rows = async (db, sql, params = []) => (await db.query(sql, params)).rows

let seq = 0
/** A connected Item with the given accounts. Returns { id, accounts: { name: uuid } }. */
export async function makeItem(db, org = ORG, accountNames = ['chk', 'sav', 'card'], over = {}) {
  const id = (await rows(db, `SELECT item_id FROM public.financial_provider_connect_item($1,'plaid',$2,$3,'Wells Fargo','v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}',$4,'production')`,
    [org, `item-${++seq}`, over.institution ?? 'ins_127991', OWNER_ID]))[0].item_id
  const accounts = {}
  for (const n of accountNames) {
    const type = n.startsWith('card') ? 'credit' : 'depository'
    const subtype = n.startsWith('card') ? 'credit card' : n.startsWith('sav') ? 'savings' : 'checking'
    accounts[n] = (await rows(db, `INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name, provider_account_type, provider_account_subtype)
      VALUES ($1,$2,$3,$3,$4,$5) RETURNING id`, [org, id, `${n}-${seq}`, type, subtype]))[0].id
  }
  return { id, org, accounts }
}

let txSeq = 0
/** Inserts one provider transaction (evidence). amount = provider convention (positive = money out of a depository account / purchase on a card). */
export async function addTx(db, item, account, o = {}) {
  const amount = o.amount ?? 25
  return (await rows(db, `INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, pending_provider_transaction_id,
    provider_amount, provider_amount_minor, currency, transaction_date, name, merchant_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'USD',$9,$10,$11) RETURNING id`,
    [item.org, item.id, item.accounts[account] ?? account, o.pid ?? `tx-${++txSeq}`, o.pending ?? false, o.pendingPid ?? null, amount, Math.round(amount * 100), o.date ?? '2026-09-10', o.name ?? 'HOME DEPOT', o.merchant ?? null]))[0].id
}
