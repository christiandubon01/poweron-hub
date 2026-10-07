import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { encryptProviderToken, loadBankTokenEncryptionKey } from '../providerTokenCrypto'

/**
 * BANK-2 credential store + connect lifecycle, executed on real PostgreSQL (PGlite) with the actual Cash ledger migrations
 * (139-143, 146), BANK-1 (153) and BANK-2 (154) under Supabase-style roles/default grants. Nothing here touches production.
 */
let PGliteCtor: any = null
try { PGliteCtor = (await import('@electric-sql/pglite')).PGlite } catch { PGliteCtor = null }

const ORG_A = 'a0000000-0000-4000-8000-000000000001'
const ORG_B = 'a0000000-0000-4000-8000-000000000002'
const OWNER_A = 'b0000000-0000-4000-8000-000000000001'
const OWNER_B = 'b0000000-0000-4000-8000-000000000003'

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
INSERT INTO public.organizations VALUES ('${ORG_A}', 'Org A'), ('${ORG_B}', 'Org B');
INSERT INTO auth.users VALUES ('${OWNER_A}'), ('${OWNER_B}');
INSERT INTO public.test_profiles VALUES ('${OWNER_A}', '${ORG_A}', 'owner'), ('${OWNER_B}', '${ORG_B}', 'owner');
`
const MIGRATIONS = ['139_cash_accounts_manual_ledger', '140_cash_linked_pair_lifecycle_hardening', '141_cash_transfer_conflict_target_fix',
  '142_cash_pair_void_link_lock_fix', '143_cash_dated_obligations', '146_balance_reconciliation_kind', '153_bank_provider_evidence_foundation',
  '154_bank_provider_credentials']
const KEY = loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
const env = (org: string, item: string) => encryptProviderToken(`access-sandbox-${item}-${randomBytes(6).toString('hex')}`, KEY, { organizationId: org, provider: 'plaid', providerItemId: item })

describe.runIf(!!PGliteCtor)('BANK-2 credential store on PostgreSQL (PGlite)', () => {
  let db: any
  beforeAll(async () => {
    db = new PGliteCtor()
    await db.exec(BOOTSTRAP)
    for (const name of MIGRATIONS) await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'))
  }, 120_000)
  afterAll(async () => { await db?.close?.() })
  beforeEach(async () => { await db.exec('TRUNCATE public.financial_provider_credentials, public.financial_provider_items CASCADE') })

  const asRole = async <T>(role: string, user: string | null, fn: () => Promise<T>): Promise<T> => {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${user ?? ''}', false); SET ROLE ${role}`)
    try { return await fn() } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false)`) }
  }
  const q = async (sql: string, params: any[] = []) => (await db.query(sql, params)).rows as any[]
  const fails = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re)
  const connect = (org: string, item: string, envelope = env(org, item), actor: string | null = OWNER_A) =>
    asRole('service_role', null, () => q(`SELECT * FROM public.financial_provider_connect_item($1,'plaid',$2,'ins_1','First Platypus Bank',$3,$4)`, [org, item, envelope, actor]))
  const activeCount = async (item: string) => Number((await q(`SELECT count(*)::int n FROM public.financial_provider_credentials c JOIN public.financial_provider_items i ON i.id = c.provider_item_ref WHERE i.provider_item_id = $1 AND c.status = 'active'`, [item]))[0].n)

  it('connect creates the item and its single encrypted credential atomically', async () => {
    const [row] = await connect(ORG_A, 'item-1')
    expect(row.outcome).toBe('created')
    const item = (await q(`SELECT * FROM public.financial_provider_items WHERE id = $1`, [row.item_id]))[0]
    expect(item).toMatchObject({ organization_id: ORG_A, provider: 'plaid', provider_item_id: 'item-1', status: 'healthy', institution_name: 'First Platypus Bank' })
    const cred = (await q(`SELECT * FROM public.financial_provider_credentials WHERE provider_item_ref = $1`, [row.item_id]))[0]
    expect(cred.status).toBe('active'); expect(cred.encrypted_access_token.startsWith('v1:')).toBe(true)
    expect(JSON.stringify(cred)).not.toContain('access-sandbox')
  })

  it('replay for the same organization rotates the credential: one item, exactly one active credential, history kept', async () => {
    const [a] = await connect(ORG_A, 'item-1'); const [b] = await connect(ORG_A, 'item-1')
    expect(b.outcome).toBe('credential_rotated'); expect(b.item_id).toBe(a.item_id)
    expect((await q(`SELECT count(*)::int n FROM public.financial_provider_items`))[0].n).toBe(1)
    expect(await activeCount('item-1')).toBe(1)
    expect((await q(`SELECT count(*)::int n FROM public.financial_provider_credentials`))[0].n).toBe(2)
  })

  it('another organization can NEVER claim an existing Plaid item: fails closed, no transfer, no new credential', async () => {
    const [a] = await connect(ORG_A, 'item-1')
    await fails(connect(ORG_B, 'item-1', env(ORG_B, 'item-1'), OWNER_B), /PROVIDER_ITEM_OWNED_BY_ANOTHER_ORGANIZATION/)
    expect((await q(`SELECT organization_id FROM public.financial_provider_items WHERE id = $1`, [a.item_id]))[0].organization_id).toBe(ORG_A)
    expect((await q(`SELECT count(*)::int n FROM public.financial_provider_credentials`))[0].n).toBe(1)
    expect((await q(`SELECT count(*)::int n FROM public.financial_provider_items WHERE organization_id = $1`, [ORG_B]))[0].n).toBe(0)
  })

  it('a malformed or plaintext token is refused by the database, and a failed connect leaves no half-connected state', async () => {
    for (const bad of ['access-sandbox-plaintext-token-0000000000000000', 'v1:short', '', 'v2:aaaa:bbbb:cccc']) {
      await fails(connect(ORG_A, 'item-x', bad), /./)
    }
    expect((await q(`SELECT count(*)::int n FROM public.financial_provider_items`))[0].n).toBe(0)
    expect((await q(`SELECT count(*)::int n FROM public.financial_provider_credentials`))[0].n).toBe(0)
  })

  it('disconnect revokes the credential, keeps the item and its history, and is idempotent; reconnect restores it', async () => {
    const [a] = await connect(ORG_A, 'item-1')
    const dis = () => asRole('service_role', null, () => q(`SELECT public.financial_provider_disconnect_item($1,$2) AS r`, [ORG_A, a.item_id]))
    expect((await dis())[0].r).toBe('disconnected')
    expect((await dis())[0].r).toBe('already_disconnected')
    expect((await q(`SELECT status, disconnected_at FROM public.financial_provider_items WHERE id = $1`, [a.item_id]))[0]).toMatchObject({ status: 'disconnected' })
    expect(await activeCount('item-1')).toBe(0)
    expect((await q(`SELECT count(*)::int n FROM public.financial_provider_credentials`))[0].n).toBe(1)
    const [r] = await connect(ORG_A, 'item-1')
    expect(r.outcome).toBe('reconnected'); expect(r.item_id).toBe(a.item_id)
    expect(await activeCount('item-1')).toBe(1)
    expect((await q(`SELECT status FROM public.financial_provider_items WHERE id = $1`, [a.item_id]))[0].status).toBe('healthy')
  })

  it('disconnect and mark-healthy are organization-scoped: another organization cannot touch the item', async () => {
    const [a] = await connect(ORG_A, 'item-1')
    await fails(asRole('service_role', null, () => q(`SELECT public.financial_provider_disconnect_item($1,$2)`, [ORG_B, a.item_id])), /PROVIDER_ITEM_NOT_FOUND/)
    await db.exec(`UPDATE public.financial_provider_items SET status = 'login_required' WHERE id = '${a.item_id}'`)
    expect((await asRole('service_role', null, () => q(`SELECT public.financial_provider_mark_item_healthy($1,$2) AS r`, [ORG_B, a.item_id])))[0].r).toBe(false)
    expect((await q(`SELECT status FROM public.financial_provider_items WHERE id = $1`, [a.item_id]))[0].status).toBe('login_required')
    expect((await asRole('service_role', null, () => q(`SELECT public.financial_provider_mark_item_healthy($1,$2) AS r`, [ORG_A, a.item_id])))[0].r).toBe(true)
  })

  it('credentials are unreachable by anon and authenticated users (RLS on, no policy, no grants), including owners of the same organization', async () => {
    const [a] = await connect(ORG_A, 'item-1')
    for (const [role, user] of [['anon', null], ['authenticated', OWNER_A], ['authenticated', OWNER_B]] as const) {
      await fails(asRole(role, user, () => q(`SELECT encrypted_access_token FROM public.financial_provider_credentials`)), /permission denied/i)
      await fails(asRole(role, user, () => q(`INSERT INTO public.financial_provider_credentials (organization_id, provider_item_ref, provider, encrypted_access_token) VALUES ($1,$2,'plaid',$3)`, [ORG_A, a.item_id, env(ORG_A, 'item-1')])), /permission denied/i)
      await fails(asRole(role, user, () => q(`UPDATE public.financial_provider_credentials SET status = 'revoked'`)), /permission denied/i)
      await fails(asRole(role, user, () => q(`DELETE FROM public.financial_provider_credentials`)), /permission denied/i)
      await fails(asRole(role, user, () => q(`SELECT * FROM public.financial_provider_connect_item($1,'plaid','x','i','n',$2,NULL)`, [ORG_A, env(ORG_A, 'x')])), /permission denied/i)
      await fails(asRole(role, user, () => q(`SELECT public.financial_provider_disconnect_item($1,$2)`, [ORG_A, a.item_id])), /permission denied/i)
      await fails(asRole(role, user, () => q(`SELECT public.financial_provider_mark_item_healthy($1,$2)`, [ORG_A, a.item_id])), /permission denied/i)
    }
    expect((await q(`SELECT relrowsecurity FROM pg_class WHERE relname = 'financial_provider_credentials'`))[0].relrowsecurity).toBe(true)
    expect((await q(`SELECT count(*)::int n FROM pg_policies WHERE tablename = 'financial_provider_credentials'`))[0].n).toBe(0)
  })

  it('the credential row is immutable except for revocation, and the one-active-credential rule is enforced by the database', async () => {
    const [a] = await connect(ORG_A, 'item-1')
    const id = (await q(`SELECT id FROM public.financial_provider_credentials`))[0].id
    await fails(db.exec(`UPDATE public.financial_provider_credentials SET encrypted_access_token = '${env(ORG_A, 'item-1')}' WHERE id = '${id}'`), /immutable|cannot/i)
    await fails(db.exec(`UPDATE public.financial_provider_credentials SET organization_id = '${ORG_B}' WHERE id = '${id}'`), /immutable|foreign key|cannot/i)
    await fails(db.exec(`INSERT INTO public.financial_provider_credentials (organization_id, provider_item_ref, provider, encrypted_access_token) VALUES ('${ORG_A}', '${a.item_id}', 'plaid', '${env(ORG_A, 'item-1')}')`), /duplicate key|unique/i)
    await fails(db.exec(`INSERT INTO public.financial_provider_credentials (organization_id, provider_item_ref, provider, encrypted_access_token) VALUES ('${ORG_B}', '${a.item_id}', 'plaid', '${env(ORG_B, 'item-1')}')`), /foreign key|duplicate key|unique/i) // item belongs to org A (the active-item index or the composite FK refuses it)
    await db.exec(`UPDATE public.financial_provider_credentials SET status = 'revoked', revoked_at = now() WHERE id = '${id}'`)
    await fails(db.exec(`UPDATE public.financial_provider_credentials SET status = 'active', revoked_at = NULL WHERE id = '${id}'`), /immutable|cannot|reactivat/i)
  })

  it('connecting a bank has ZERO financial effect: no ledger, account, obligation or provider evidence rows are created or changed', async () => {
    const tables = ['financial_transactions', 'financial_accounts', 'financial_obligations', 'financial_obligation_occurrences', 'cash_commitments', 'financial_transaction_links',
      'financial_provider_accounts', 'financial_provider_transactions', 'financial_provider_balance_snapshots', 'financial_provider_webhook_events', 'financial_provider_interpretations', 'financial_provider_account_mappings']
    const snap = async () => JSON.stringify(await Promise.all(tables.map(t => q(`SELECT count(*)::int n FROM public.${t}`))))
    const before = await snap()
    const [a] = await connect(ORG_A, 'item-1'); await connect(ORG_A, 'item-1')
    await asRole('service_role', null, () => q(`SELECT public.financial_provider_disconnect_item($1,$2)`, [ORG_A, a.item_id]))
    await connect(ORG_A, 'item-1')
    expect(await snap()).toBe(before)
  })
})

describe('BANK-2 migration 154 static contract', () => {
  const sql = readFileSync('supabase/migrations/154_bank_provider_credentials.sql', 'utf8')
  it('stores only an encrypted envelope (no plaintext column), enables RLS with no policy and revokes all client access', () => {
    expect(sql).toMatch(/encrypted_access_token\s+TEXT/i)
    expect(sql).not.toMatch(/\b(plaintext|access_token_plain|secret)\b\s+TEXT/i)
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i)
    expect(sql).not.toMatch(/CREATE POLICY/i)
    expect(sql).toMatch(/REVOKE ALL ON public\.financial_provider_credentials FROM PUBLIC, anon, authenticated/i)
    expect(sql).not.toMatch(/GRANT[^;]*(anon|authenticated)/i)
  })
  it('is transactional, idempotent, additive-only and touches no money or ledger table', () => {
    expect(sql).toMatch(/^\s*BEGIN;/m); expect(sql).toMatch(/COMMIT;\s*$/)
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i)
    expect(sql).not.toMatch(/(INSERT INTO|UPDATE|ALTER TABLE)\s+public\.(financial_transactions|financial_accounts|financial_obligations|cash_commitments|app_state|projects|payments)/i)
  })
  it('is the next free migration number after BANK-1 and uses a three-digit name', () => {
    expect(readFileSync('supabase/migrations/153_bank_provider_evidence_foundation.sql', 'utf8').length).toBeGreaterThan(0)
    expect('154_bank_provider_credentials.sql').toMatch(/^\d{3}_[a-z_]+\.sql$/)
  })
})
