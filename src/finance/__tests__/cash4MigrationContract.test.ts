import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  new URL('../../../supabase/migrations/144_cash_os_buckets_envelopes.sql', import.meta.url),
  'utf8',
)

describe('CASH-4 migration contract', () => {
  // ── Bucket tests 1–8 ──────────────────────────────────────────────────────

  it('1: creates the cash_os_buckets table', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.cash_os_buckets')
  })

  it('2: buckets have no amount_minor column (buckets are not cash)', () => {
    const start = sql.indexOf('CREATE TABLE IF NOT EXISTS public.cash_os_buckets')
    const end = sql.indexOf(');', start)
    expect(sql.slice(start, end)).not.toContain('amount_minor')
  })

  it('3: buckets have an archived boolean column', () => {
    expect(sql).toContain('archived BOOLEAN NOT NULL DEFAULT FALSE')
  })

  it('4: bucket color is nullable (no NOT NULL constraint)', () => {
    const start = sql.indexOf('CREATE TABLE IF NOT EXISTS public.cash_os_buckets')
    const end = sql.indexOf(');', start)
    const tableDef = sql.slice(start, end)
    expect(tableDef).toContain('color TEXT')
    expect(tableDef).not.toMatch(/color TEXT NOT NULL/)
  })

  it('5: buckets have dual (id, organization_id) unique constraint', () => {
    expect(sql).toContain('cash_os_buckets_id_org_unique UNIQUE (id, organization_id)')
  })

  it('6: updated_at trigger exists for buckets', () => {
    expect(sql).toContain('trg_cash_os_buckets_updated_at')
    expect(sql).toContain('EXECUTE FUNCTION public.set_cash_ledger_updated_at()')
  })

  it('7: RLS is enabled on cash_os_buckets', () => {
    expect(sql).toContain('ALTER TABLE public.cash_os_buckets ENABLE ROW LEVEL SECURITY')
  })

  it('8: bucket references organizations with ON DELETE RESTRICT', () => {
    const start = sql.indexOf('CREATE TABLE IF NOT EXISTS public.cash_os_buckets')
    const end = sql.indexOf(');', start)
    const tableDef = sql.slice(start, end)
    expect(tableDef).toContain('REFERENCES public.organizations(id) ON DELETE RESTRICT')
  })

  // ── Envelope tests 9–20 ───────────────────────────────────────────────────

  it('9: creates the cash_os_envelopes table', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.cash_os_envelopes')
  })

  it('10: creates the cash_os_envelope_entries table', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.cash_os_envelope_entries')
  })

  it('11: envelopes have a nullable target_amount_minor column', () => {
    const start = sql.indexOf('CREATE TABLE IF NOT EXISTS public.cash_os_envelopes')
    const end = sql.indexOf(');', start)
    const tableDef = sql.slice(start, end)
    expect(tableDef).toContain('target_amount_minor BIGINT')
    expect(tableDef).not.toMatch(/target_amount_minor BIGINT NOT NULL/)
  })

  it('12: envelope entries direction is constrained to allocate or release', () => {
    expect(sql).toContain("direction IN ('allocate', 'release')")
  })

  it('13: envelope entries amount_minor must be positive', () => {
    const start = sql.indexOf('CREATE TABLE IF NOT EXISTS public.cash_os_envelope_entries')
    const end = sql.indexOf(');', start)
    const tableDef = sql.slice(start, end)
    expect(tableDef).toContain('amount_minor BIGINT NOT NULL CHECK (amount_minor > 0)')
  })

  it('14: envelope entries have no updated_at column (immutable ledger)', () => {
    const start = sql.indexOf('CREATE TABLE IF NOT EXISTS public.cash_os_envelope_entries')
    const end = sql.indexOf(');', start)
    const tableDef = sql.slice(start, end)
    expect(tableDef).not.toContain('updated_at')
  })

  it('15: envelope_entries reference envelopes via composite org-safe FK', () => {
    expect(sql).toContain('cash_os_envelope_entries_envelope_org_fk')
    expect(sql).toContain(
      'FOREIGN KEY (envelope_id, organization_id)\n    REFERENCES public.cash_os_envelopes(id, organization_id)',
    )
  })

  it('16: envelopes reference buckets via composite org-safe FK (nullable)', () => {
    expect(sql).toContain('cash_os_envelopes_bucket_org_fk')
    expect(sql).toContain(
      'FOREIGN KEY (bucket_id, organization_id)\n    REFERENCES public.cash_os_buckets(id, organization_id)',
    )
  })

  it('17: RLS is enabled on cash_os_envelopes', () => {
    expect(sql).toContain('ALTER TABLE public.cash_os_envelopes ENABLE ROW LEVEL SECURITY')
  })

  it('18: RLS is enabled on cash_os_envelope_entries', () => {
    expect(sql).toContain('ALTER TABLE public.cash_os_envelope_entries ENABLE ROW LEVEL SECURITY')
  })

  it('19: transfer_between_envelopes RPC is defined as SECURITY INVOKER', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.transfer_between_envelopes')
    expect(sql).toContain('SECURITY INVOKER')
  })

  it('20: transfer RPC guards against same-envelope transfer', () => {
    expect(sql).toContain('Source and target envelopes must differ')
  })

  // ── Security tests 21–24 ─────────────────────────────────────────────────

  it('21: REVOKE from PUBLIC, anon, authenticated on all three tables', () => {
    expect(sql).toContain('REVOKE ALL ON public.cash_os_buckets,\n  public.cash_os_envelopes,\n  public.cash_os_envelope_entries')
    expect(sql).toContain('FROM PUBLIC, anon, authenticated')
  })

  it('22: RLS policies use user_org_id() and is_org_admin_for()', () => {
    expect(sql).toContain('organization_id = public.user_org_id()')
    expect(sql).toContain('public.is_org_admin_for(organization_id)')
    expect(sql.match(/cash_os_buckets_owner_admin_all/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(sql.match(/cash_os_envelopes_owner_admin_all/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(sql.match(/cash_os_envelope_entries_owner_admin_all/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('23: transfer RPC REVOKE and GRANT to authenticated only', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.transfer_between_envelopes(UUID, UUID, UUID, BIGINT, TEXT)',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.transfer_between_envelopes(UUID, UUID, UUID, BIGINT, TEXT)',
    )
    expect(sql).toContain('TO authenticated')
  })

  it('24: envelope_entries grant is SELECT + INSERT only (no UPDATE/DELETE)', () => {
    expect(sql).toContain('GRANT SELECT, INSERT ON public.cash_os_envelope_entries TO authenticated')
    expect(sql).not.toMatch(/GRANT SELECT, INSERT, UPDATE.*cash_os_envelope_entries/)
    expect(sql).not.toMatch(/GRANT.*DELETE.*cash_os_envelope_entries/)
  })

  // ── Regression guard tests 25–30 ─────────────────────────────────────────

  it('25: migration does not touch financial_accounts or financial_transactions', () => {
    expect(sql).not.toContain('CREATE TABLE IF NOT EXISTS public.financial_accounts')
    expect(sql).not.toContain('CREATE TABLE IF NOT EXISTS public.financial_transactions')
    expect(sql).not.toContain('ALTER TABLE public.financial_accounts')
    expect(sql).not.toContain('ALTER TABLE public.financial_transactions')
  })

  it('26: migration does not insert into financial_transactions (no ledger rows created)', () => {
    expect(sql).not.toMatch(/INSERT INTO public\.financial_transactions/i)
  })

  it('27: migration does not touch obligations or cash_commitments tables', () => {
    expect(sql).not.toContain('ALTER TABLE public.financial_obligations')
    expect(sql).not.toContain('ALTER TABLE public.cash_commitments')
    expect(sql).not.toContain('ALTER TABLE public.financial_obligation_occurrences')
  })

  it('28: migration does not use generate_series (no unbounded row materialization)', () => {
    expect(sql).not.toMatch(/generate_series/i)
  })

  it('29: envelope entries have no economic_effect column (not ledger entries)', () => {
    const start = sql.indexOf('CREATE TABLE IF NOT EXISTS public.cash_os_envelope_entries')
    const end = sql.indexOf(');', start)
    expect(sql.slice(start, end)).not.toContain('economic_effect')
  })

  it('30: migration is wrapped in BEGIN/COMMIT transaction block', () => {
    expect(sql.trimStart()).toMatch(/^-- CASH-OS-1C/)
    expect(sql).toMatch(/^\s*BEGIN\s*;/m)
    expect(sql).toMatch(/^\s*COMMIT\s*;/m)
  })
})
