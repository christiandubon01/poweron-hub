import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { toTransactionEvidence } from '../transactionEvidence'
import { createPlaidSdkPort } from '../plaidPort'
import { loadPlaidConfig } from '../plaidConfig'

/**
 * BANK-4 evidence persistence on REAL PostgreSQL (PGlite) with the actual migrations (153/154). Unit fakes cannot enforce table
 * CHECK constraints, which is how the first live sync failure slipped through. Nothing here touches production.
 */
let PGliteCtor: any = null
try { PGliteCtor = (await import('@electric-sql/pglite')).PGlite } catch { PGliteCtor = null }

const ORG = 'a0000000-0000-4000-8000-000000000001'
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
INSERT INTO public.organizations VALUES ('${ORG}', 'Org A');
INSERT INTO auth.users VALUES ('${OWNER}');
INSERT INTO public.test_profiles VALUES ('${OWNER}', '${ORG}', 'owner');
`
const MIGRATIONS = ['139_cash_accounts_manual_ledger', '140_cash_linked_pair_lifecycle_hardening', '141_cash_transfer_conflict_target_fix',
  '142_cash_pair_void_link_lock_fix', '143_cash_dated_obligations', '146_balance_reconciliation_kind', '153_bank_provider_evidence_foundation', '154_bank_provider_credentials']

/** A realistic Plaid Sandbox transaction, shaped like plaid@48's `Transaction` (extra fields included on purpose). */
const plaidTx = (id: string, over: Record<string, unknown> = {}) => ({
  account_id: 'acc-1', amount: 5.4, iso_currency_code: 'USD', unofficial_currency_code: null, date: '2026-09-28', authorized_date: '2026-09-27',
  name: 'Uber 063015 SF**POOL**', merchant_name: 'Uber', pending: false, pending_transaction_id: null, transaction_id: id,
  personal_finance_category: { primary: 'TRANSPORTATION', detailed: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', confidence_level: 'VERY_HIGH' },
  location: { city: null }, payment_meta: { reference_number: null }, counterparties: [], category: ['Travel'], payment_channel: 'online', ...over,
})

describe.runIf(!!PGliteCtor)('BANK-4 evidence upsert on PostgreSQL (PGlite)', () => {
  let db: any, itemRef = '', accountRef = ''
  beforeAll(async () => {
    db = new PGliteCtor()
    await db.exec(BOOTSTRAP)
    for (const name of MIGRATIONS) await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'))
    await db.exec(`SET ROLE service_role`)
    itemRef = (await db.query(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid','item-1','ins_1','Tartan Bank',$2,$3)`, [ORG, `v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}`, OWNER])).rows[0].item_id
    accountRef = (await db.query(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name, currency, status) VALUES ($1,$2,'acc-1','Plaid Checking','USD','active') RETURNING id`, [ORG, itemRef])).rows[0].id
  }, 120_000)
  afterAll(async () => { await db?.close?.() })

  /**
   * Mirrors a PostgREST upsert (INSERT ... ON CONFLICT DO UPDATE SET <every column in the payload>) of bankSyncRepo.upsertEvidence's rows.
   * `withLastSeen` reproduces the FIRST live-sync defect (application-clock last_seen_at); the fixed repo never sends it.
   */
  const upsert = (rows: any[], withLastSeen = false) => db.query(`
    INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending,
      pending_provider_transaction_id, provider_amount, provider_amount_minor, currency, transaction_date, authorized_date, name, merchant_name,
      provider_category, removed_at${withLastSeen ? ', last_seen_at' : ''})
    SELECT $1, $2, $3, r.provider_transaction_id, r.pending, r.pending_provider_transaction_id, r.provider_amount, r.provider_amount_minor, r.currency,
      r.transaction_date, r.authorized_date, r.name, r.merchant_name, r.provider_category, r.removed_at${withLastSeen ? ', r.last_seen_at' : ''}
    FROM jsonb_to_recordset($4::jsonb) AS r(provider_transaction_id text, pending boolean, pending_provider_transaction_id text, provider_amount numeric,
      provider_amount_minor bigint, currency text, transaction_date date, authorized_date date, name text, merchant_name text, provider_category jsonb,
      removed_at timestamptz, last_seen_at timestamptz)
    ON CONFLICT (provider_item_ref, provider_transaction_id) DO UPDATE SET organization_id = EXCLUDED.organization_id,
      provider_item_ref = EXCLUDED.provider_item_ref, provider_account_ref = EXCLUDED.provider_account_ref, provider_transaction_id = EXCLUDED.provider_transaction_id,
      pending = EXCLUDED.pending, pending_provider_transaction_id = EXCLUDED.pending_provider_transaction_id, provider_amount = EXCLUDED.provider_amount,
      provider_amount_minor = EXCLUDED.provider_amount_minor, currency = EXCLUDED.currency, transaction_date = EXCLUDED.transaction_date,
      authorized_date = EXCLUDED.authorized_date, name = EXCLUDED.name, merchant_name = EXCLUDED.merchant_name, provider_category = EXCLUDED.provider_category,
      removed_at = EXCLUDED.removed_at${withLastSeen ? ', last_seen_at = EXCLUDED.last_seen_at' : ''}`, [ORG, itemRef, accountRef, JSON.stringify(rows)])
  const payloadFor = (ids: string[], lastSeenAt: string | null = null) => ids.map(id => {
    const e: any = (toTransactionEvidence({
      transactionId: id, accountId: 'acc-1', amount: 5.4, currency: 'USD', date: '2026-09-28', authorizedDate: '2026-09-27', name: 'Uber', merchantName: 'Uber',
      pending: false, pendingTransactionId: null, categoryPrimary: 'TRANSPORTATION', categoryDetailed: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', categoryConfidence: 'VERY_HIGH',
    }) as any).evidence
    return { provider_transaction_id: e.providerTransactionId, pending: e.pending, pending_provider_transaction_id: e.pendingProviderTransactionId, provider_amount: e.providerAmount,
      provider_amount_minor: e.providerAmountMinor, currency: e.currency, transaction_date: e.transactionDate, authorized_date: e.authorizedDate, name: e.name,
      merchant_name: e.merchantName, provider_category: e.providerCategory, removed_at: null, ...(lastSeenAt ? { last_seen_at: lastSeenAt } : {}) }
  })

  it('DIAGNOSTIC (the first live-sync failure): an application-clock last_seen_at taken BEFORE the statement violates seen_order against the database-clock first_seen_at default', async () => {
    const appClock = new Date(Date.now() - 5).toISOString() // the Node server reads its clock before the request reaches PostgreSQL
    await expect(upsert(payloadFor(['t-live-1'], appClock), true)).rejects.toThrow(/seen_order/)
    expect((await db.query(`SELECT count(*)::int n FROM public.financial_provider_transactions`)).rows[0].n).toBe(0) // the statement is atomic: nothing partial
  })

  it('FIX: the repo no longer sends last_seen_at, so new rows are stamped by the database clock and satisfy seen_order', async () => {
    await upsert(payloadFor(['t-ok-1', 't-ok-2']))
    const rows = (await db.query(`SELECT provider_transaction_id, first_seen_at, last_seen_at FROM public.financial_provider_transactions ORDER BY 1`)).rows
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(new Date(r.last_seen_at).getTime()).toBeGreaterThanOrEqual(new Date(r.first_seen_at).getTime())
  })

  it('re-delivering the same rows is idempotent (update path, identity columns unchanged, first_seen_at kept, updated_at advances)', async () => {
    const before = (await db.query(`SELECT provider_transaction_id, first_seen_at, created_at, updated_at FROM public.financial_provider_transactions ORDER BY 1`)).rows
    await new Promise(r => setTimeout(r, 15))
    await upsert(payloadFor(['t-ok-1', 't-ok-2']))
    const after = (await db.query(`SELECT provider_transaction_id, first_seen_at, created_at, updated_at FROM public.financial_provider_transactions ORDER BY 1`)).rows
    expect(after).toHaveLength(2)
    for (let i = 0; i < 2; i++) {
      expect(after[i].first_seen_at).toEqual(before[i].first_seen_at); expect(after[i].created_at).toEqual(before[i].created_at)
      expect(new Date(after[i].updated_at).getTime()).toBeGreaterThan(new Date(before[i].updated_at).getTime()) // DB-stamped re-sight marker
    }
  })

  it('REALISTIC CHAIN: a plaid@48-shaped /transactions/sync response -> adapter -> evidence -> real database, including pending, posted-with-link, inflow, nulls and extra provider fields', async () => {
    const raw = {
      accounts: [{ account_id: 'acc-1', balances: { iso_currency_code: 'USD', current: 110, available: 100 }, name: 'Plaid Checking', mask: '0000', type: 'depository', subtype: 'checking' }],
      added: [
        plaidTx('tx-posted-outflow', { amount: 5.4 }),
        plaidTx('tx-inflow', { amount: -4220.5, name: 'INTRST PYMNT', merchant_name: null, authorized_date: null, personal_finance_category: null }),
        plaidTx('tx-pending', { pending: true, amount: 89.4, date: '2026-10-05', authorized_date: '2026-10-05', merchant_name: null }),
        plaidTx('tx-posted-linked', { pending_transaction_id: 'tx-pending-old', amount: 12 }),
        plaidTx('tx-zero', { amount: 0 }),
      ],
      modified: [plaidTx('tx-posted-outflow', { amount: 5.4, name: 'Uber (edited)' })],
      removed: [{ transaction_id: 'tx-pending-old', account_id: 'acc-1' }],
      next_cursor: 'cursor-1', has_more: false, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE', request_id: 'req-1',
    }
    const api = { transactionsSync: async () => ({ data: raw }) }
    const port = createPlaidSdkPort(loadPlaidConfig({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's' }), api as never)
    const page = await port.syncTransactions({ accessToken: 'access-sandbox-x', cursor: null, count: 500 })
    const toPayload = (list: any[]) => list.map(t => { const e = (toTransactionEvidence(t) as any).evidence
      return { provider_transaction_id: e.providerTransactionId, pending: e.pending, pending_provider_transaction_id: e.pendingProviderTransactionId, provider_amount: e.providerAmount, provider_amount_minor: e.providerAmountMinor,
        currency: e.currency, transaction_date: e.transactionDate, authorized_date: e.authorizedDate, name: e.name, merchant_name: e.merchantName, provider_category: e.providerCategory, removed_at: null } })
    await db.query(`DELETE FROM public.financial_provider_transactions`)
    await upsert(toPayload(page.added)); await upsert(toPayload(page.modified))
    const rows = (await db.query(`SELECT provider_transaction_id id, pending, pending_provider_transaction_id link, provider_amount::float8 amount, provider_amount_minor::int minor, name, merchant_name, provider_category, authorized_date FROM public.financial_provider_transactions ORDER BY 1`)).rows
    const by = Object.fromEntries(rows.map((r: any) => [r.id, r]))
    expect(rows).toHaveLength(5)
    expect(by['tx-posted-outflow']).toMatchObject({ amount: 5.4, minor: 540, name: 'Uber (edited)', pending: false })
    expect(by['tx-inflow']).toMatchObject({ amount: -4220.5, minor: -422050, merchant_name: null, provider_category: null, authorized_date: null })
    expect(by['tx-pending']).toMatchObject({ pending: true, link: null, minor: 8940 })
    expect(by['tx-posted-linked']).toMatchObject({ pending: false, link: 'tx-pending-old' }) // the provider's own link, never invented
    expect(by['tx-zero'].minor).toBe(0)
    expect(by['tx-posted-outflow'].provider_category).toEqual({ primary: 'TRANSPORTATION', detailed: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', confidence: 'VERY_HIGH' })
    // removal marks, never deletes (what markRemoved does); a never-ingested id changes nothing
    await db.query(`UPDATE public.financial_provider_transactions SET removed_at = now() WHERE organization_id = $1 AND provider_item_ref = $2 AND provider_transaction_id = ANY($3) AND removed_at IS NULL`, [ORG, itemRef, ['tx-pending', 'never-seen']])
    expect((await db.query(`SELECT count(*)::int n, count(removed_at)::int removed FROM public.financial_provider_transactions`)).rows[0]).toEqual({ n: 5, removed: 1 })
    // no ledger or Cash OS account row was touched by any of this
    expect((await db.query(`SELECT count(*)::int n FROM public.financial_transactions`)).rows[0].n).toBe(0)
    expect((await db.query(`SELECT count(*)::int n FROM public.financial_accounts`)).rows[0].n).toBe(0)
  })
  it('the repo source sends no application-clock last_seen_at (regression guard for the live failure)', () => {
    const repo = readFileSync('src/services/bankProvider/bankSyncRepo.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    const upsertBody = repo.slice(repo.indexOf('async upsertEvidence'), repo.indexOf('async markRemoved'))
    expect(upsertBody).not.toMatch(/last_seen_at|now\(\)/)
  })
})
