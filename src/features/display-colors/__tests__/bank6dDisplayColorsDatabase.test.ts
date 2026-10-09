// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createSharedColorStore, createDeviceColorStore, planImport } from '../colorStore'

/**
 * BANK-6D migration 158 on REAL PostgreSQL (PGlite): organization-wide display colors. Row-level security, validation, organization isolation,
 * and proof that no financial record changes. Throwaway in-memory database; production is never touched.
 */
let PGliteCtor: any = null
try { const m = await import('@electric-sql/pglite'); PGliteCtor = m.PGlite } catch { PGliteCtor = null }

const ORG = 'a0000000-0000-4000-8000-000000000001'
const ORG_B = 'a0000000-0000-4000-8000-000000000002'
const OWNER = 'b0000000-0000-4000-8000-000000000001'
const MEMBER = 'b0000000-0000-4000-8000-000000000003'
const OWNER_B = 'b0000000-0000-4000-8000-000000000002'
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
-- Supabase gives new public tables broad default grants; the migration must take them away itself.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
INSERT INTO public.organizations VALUES ('${ORG}', 'Org A'), ('${ORG_B}', 'Org B');
INSERT INTO auth.users VALUES ('${OWNER}'), ('${MEMBER}'), ('${OWNER_B}');
INSERT INTO public.test_profiles VALUES ('${OWNER}', '${ORG}', 'owner'), ('${MEMBER}', '${ORG}', 'employee'), ('${OWNER_B}', '${ORG_B}', 'owner');
`
const sql = (n: string) => readFileSync(`supabase/migrations/${n}.sql`, 'utf8')

async function build(with158 = true) {
  const db = new PGliteCtor()
  await db.exec(BOOTSTRAP)
  await db.exec(sql('139_cash_accounts_manual_ledger'))
  if (with158) await db.exec(sql('158_cash_os_display_colors'))
  const q = async (text: string, p: any[] = []) => (await db.query(text, p)).rows as any[]
  const acct = async (org: string, name: string) => (await q(`INSERT INTO public.financial_accounts (organization_id, display_name, account_type, account_class, ownership_context, include_in_cash) VALUES ($1,$2,'checking','asset','business',true) RETURNING id`, [org, name]))[0].id as string
  /** Run as a signed-in browser user (role authenticated, row-level security on). */
  const as = async <T,>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    await db.exec(user ? `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${user}', false)` : `SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false)`)
    try { return await fn() } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false)`) }
  }
  const setColor = (user: string, kind: string, key: string, color: string | null) => as(user, () => q(`SELECT public.cash_os_set_display_color($1, $2, $3) AS r`, [kind, key, color]))
  const rows = () => q(`SELECT organization_id, target_kind, category_key, financial_account_id, color FROM public.cash_os_display_colors ORDER BY target_kind, category_key, financial_account_id`)
  /** The same tiny surface the browser store uses (supabase-js from().select() and rpc()), executed as `user` under row-level security. */
  const clientFor = (user: string) => ({
    from: (t: string) => ({ select: async (c: string) => { try { return { data: await as(user, () => q(`SELECT ${c} FROM public.${t}`)), error: null } } catch (e: any) { return { data: null, error: { code: e.code, message: String(e.message) } } } } }),
    rpc: async (fn: string, a: Record<string, unknown>) => { try { return { data: await as(user, () => q(`SELECT public.${fn}(p_kind => $1, p_key => $2, p_color => $3) AS r`, [a.p_kind, a.p_key, a.p_color])), error: null } } catch (e: any) { return { data: null, error: { code: e.code, message: String(e.message) } } } },
  })
  return { db, q, acct, as, setColor, rows, clientFor }
}

describe.runIf(!!PGliteCtor)('BANK-6D migration 158: organization-wide display colors (real PostgreSQL)', () => {
  let w: Awaited<ReturnType<typeof build>>
  let a1 = '', a2 = '', b1 = '', accountsBefore = ''
  beforeAll(async () => {
    w = await build()
    a1 = await w.acct(ORG, 'Wells Fargo Business Checking 6960'); a2 = await w.acct(ORG, 'Chase Ink'); b1 = await w.acct(ORG_B, 'Other org account')
    accountsBefore = JSON.stringify(await w.q(`SELECT * FROM public.financial_accounts ORDER BY id`))
  }, 120_000)
  afterAll(async () => { await w?.db?.close?.() })

  it('an owner sets, replaces and clears category and account colors by stable key / account id', async () => {
    expect((await w.setColor(OWNER, 'category', 'fuel_vehicle', '#14998f'))[0].r).toBe('saved')
    expect((await w.setColor(OWNER, 'account', a1, '#a8841f'))[0].r).toBe('saved')
    expect((await w.setColor(OWNER, 'category', 'fuel_vehicle', '#c0652f'))[0].r).toBe('saved') // replaced, still one row
    expect(await w.rows()).toEqual([
      { organization_id: ORG, target_kind: 'account', category_key: null, financial_account_id: a1, color: '#a8841f' },
      { organization_id: ORG, target_kind: 'category', category_key: 'fuel_vehicle', financial_account_id: null, color: '#c0652f' },
    ])
    expect((await w.setColor(OWNER, 'account', a1, null))[0].r).toBe('cleared')
    expect((await w.rows()).map(r => r.target_kind)).toEqual(['category'])
  })

  it('members can read their organization\'s colors but cannot change them (function or direct writes)', async () => {
    expect((await w.as(MEMBER, () => w.q(`SELECT category_key, color FROM public.cash_os_display_colors`)))).toEqual([{ category_key: 'fuel_vehicle', color: '#c0652f' }])
    await expect(w.setColor(MEMBER, 'category', 'meals', '#cf4f7d')).rejects.toThrow(/DISPLAY_COLOR_FORBIDDEN/)
    await expect(w.as(MEMBER, () => w.q(`INSERT INTO public.cash_os_display_colors (organization_id, target_kind, category_key, color) VALUES ($1,'category','meals','#cf4f7d')`, [ORG]))).rejects.toThrow(/row-level security/)
    expect(await w.as(MEMBER, () => w.q(`UPDATE public.cash_os_display_colors SET color = '#7f8aa3' RETURNING id`))).toEqual([])
    expect(await w.as(MEMBER, () => w.q(`DELETE FROM public.cash_os_display_colors RETURNING id`))).toEqual([])
    expect((await w.rows())[0].color).toBe('#c0652f')
  })

  it('organizations are isolated: another organization sees nothing, cannot color this organization\'s account, and cannot write rows for it', async () => {
    expect(await w.as(OWNER_B, () => w.q(`SELECT * FROM public.cash_os_display_colors`))).toEqual([])
    await expect(w.setColor(OWNER_B, 'account', a2, '#14998f')).rejects.toMatchObject({ code: '23503' }) // the composite foreign key: not an account of org B
    await expect(w.setColor(OWNER, 'account', b1, '#14998f')).rejects.toMatchObject({ code: '23503' })
    await expect(w.as(OWNER_B, () => w.q(`INSERT INTO public.cash_os_display_colors (organization_id, target_kind, category_key, color) VALUES ($1,'category','meals','#cf4f7d')`, [ORG]))).rejects.toThrow(/row-level security/)
    await expect(w.as(OWNER, () => w.q(`INSERT INTO public.cash_os_display_colors (organization_id, target_kind, category_key, color) VALUES ($1,'category','meals','#cf4f7d')`, [ORG_B]))).rejects.toThrow(/row-level security/)
    expect(await w.as(OWNER_B, () => w.q(`UPDATE public.cash_os_display_colors SET color = '#7f8aa3' RETURNING id`))).toEqual([])
    expect((await w.setColor(OWNER_B, 'category', 'fuel_vehicle', '#5a72d9'))[0].r).toBe('saved') // its own row, same key: no collision
    expect((await w.rows()).filter(r => r.category_key === 'fuel_vehicle').map(r => [r.organization_id, r.color]).sort()).toEqual([[ORG, '#c0652f'], [ORG_B, '#5a72d9']].sort())
  })

  it('anonymous callers have no access at all', async () => {
    await expect(w.as(null, () => w.q(`SELECT * FROM public.cash_os_display_colors`))).rejects.toThrow(/permission denied/)
    await expect(w.as(null, () => w.q(`SELECT public.cash_os_set_display_color('category', 'meals', '#cf4f7d')`))).rejects.toThrow(/permission denied/)
  })

  it('validates everything: target kind, category key format, account id format, and #rrggbb colors', async () => {
    for (const [kind, key, color] of [['bucket', 'meals', '#cf4f7d'], ['category', 'Meals', '#cf4f7d'], ['category', 'meals; drop', '#cf4f7d'], ['account', 'Wells Fargo', '#cf4f7d'],
      ['category', 'meals', 'red'], ['category', 'meals', '#CF4F7D'], ['category', 'meals', '#cf4f7d00'], ['category', 'meals', 'url(x)']] as const) {
      await expect(w.setColor(OWNER, kind, key, color), `${kind}/${key}/${color}`).rejects.toThrow(/DISPLAY_COLOR_INVALID/)
    }
    await expect(w.q(`INSERT INTO public.cash_os_display_colors (organization_id, target_kind, category_key, financial_account_id, color) VALUES ($1,'category','meals',$2,'#cf4f7d')`, [ORG, a1])).rejects.toThrow(/target_consistent/)
  })

  it('removing an account removes its color (a color never blocks an account change)', async () => {
    const tmp = await w.acct(ORG, 'Temporary')
    await w.setColor(OWNER, 'account', tmp, '#7f68d6')
    await w.q(`DELETE FROM public.financial_accounts WHERE id = $1`, [tmp])
    expect((await w.rows()).some(r => r.financial_account_id === tmp)).toBe(false)
  })

  it('the browser store reads and writes through row-level security, as the signed-in owner', async () => {
    const store = createSharedColorStore(w.clientFor(OWNER) as never, createDeviceColorStore(ORG))
    expect(await store.set('category', 'meals', '#cf4f7d')).toEqual({ storage: 'shared' })
    expect(await store.set('account', a2, '#2f8fcf')).toEqual({ storage: 'shared' })
    const loaded = await store.load()
    expect(loaded.storage).toBe('shared')
    expect(loaded.colors).toEqual({ categories: { fuel_vehicle: '#c0652f', meals: '#cf4f7d' }, accounts: { [a2]: '#2f8fcf' } })
    await expect(createSharedColorStore(w.clientFor(MEMBER) as never, createDeviceColorStore(ORG)).set('category', 'meals', null)).rejects.toThrow('Only owners and admins can change colors.')
    await expect(store.set('category', 'meals', '#123456')).rejects.toThrow() // not a curated color: refused before any request
  })

  it('no financial record changed: financial_accounts rows (including updated_at) are byte-identical, and no other table was created or altered', async () => {
    // the temporary account above was created and removed by this test itself
    expect(JSON.stringify(await w.q(`SELECT * FROM public.financial_accounts ORDER BY id`))).toBe(accountsBefore)
    const src = sql('158_cash_os_display_colors').split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(src).not.toMatch(/ALTER TABLE public\.(?!cash_os_display_colors)|DROP TABLE|TRUNCATE|DELETE FROM public\.(?!cash_os_display_colors)|UPDATE public\./i)
    expect(src).not.toMatch(/SECURITY DEFINER/)
    expect(src).toMatch(/BEGIN;[\s\S]*COMMIT;\s*$/)
  })
})

describe.runIf(!!PGliteCtor)('BANK-6D before migration 158 is applied', () => {
  it('the browser store falls back to this device, says so, and saves nothing to the database', async () => {
    const w = await build(false)
    try {
      window.localStorage?.clear?.()
      const store = createSharedColorStore(w.clientFor(OWNER) as never, createDeviceColorStore(ORG))
      expect((await store.load()).storage).toBe('device')
      expect(await store.set('category', 'meals', '#cf4f7d')).toEqual({ storage: 'device' })
      expect((await store.load()).colors.categories).toEqual({ meals: '#cf4f7d' })
    } finally { await w.db.close?.() }
  }, 120_000)

  it('migration transition: device colors are preserved when 158 arrives, never applied automatically, imported only by an owner, conflicts replaced only on request', async () => {
    const w = await build(false)
    try {
      window.localStorage?.clear?.()
      const device = createDeviceColorStore(ORG)
      const a1 = await w.acct(ORG, 'Checking')
      const before = createSharedColorStore(w.clientFor(OWNER) as never, device)
      await before.set('category', 'meals', '#cf4f7d'); await before.set('category', 'fuel_vehicle', '#c0652f'); await before.set('account', a1, '#a8841f')
      await w.db.exec(sql('158_cash_os_display_colors')) // the owner applies migration 158
      await w.setColor(OWNER, 'category', 'fuel_vehicle', '#14998f') // someone already chose a shared color
      const shared = createSharedColorStore(w.clientFor(OWNER) as never, device)
      const now = await shared.load()
      expect(now).toEqual({ storage: 'shared', colors: { categories: { fuel_vehicle: '#14998f' }, accounts: {} } }) // nothing was applied automatically
      expect((await device.load()).colors.categories).toEqual({ meals: '#cf4f7d', fuel_vehicle: '#c0652f' }) // device colors are preserved
      const plan = planImport((await device.load()).colors, now.colors, new Set([a1]))
      expect(plan.additions.map(e => e.key).sort()).toEqual([a1, 'meals'].sort())
      expect(plan.conflicts).toEqual([{ kind: 'category', key: 'fuel_vehicle', device: '#c0652f', shared: '#14998f' }])
      // a member cannot import (row-level security through the function)
      const memberStore = createSharedColorStore(w.clientFor(MEMBER) as never, device)
      await expect(memberStore.set('category', 'meals', '#cf4f7d')).rejects.toThrow('Only owners and admins can change colors.')
      expect(await w.rows()).toHaveLength(1)
      // the owner imports additions only: the conflicting shared color stays
      for (const e of plan.additions) await shared.set(e.kind, e.key, e.device)
      expect((await shared.load()).colors).toEqual({ categories: { fuel_vehicle: '#14998f', meals: '#cf4f7d' }, accounts: { [a1]: '#a8841f' } })
      // and replaces the conflict only when explicitly chosen
      for (const e of plan.conflicts) await shared.set(e.kind, e.key, e.device)
      expect((await shared.load()).colors.categories.fuel_vehicle).toBe('#c0652f')
    } finally { await w.db.close?.() }
  }, 120_000)
})
