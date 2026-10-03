import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  new URL('../../../supabase/migrations/145_cash_liability_terms.sql', import.meta.url),
  'utf8',
)

describe('CORE-CLOSE-2B migration contract (145_cash_liability_terms)', () => {

  it('creates financial_liability_terms table', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.financial_liability_terms')
  })

  it('primary key is UUID with gen_random_uuid()', () => {
    expect(sql).toContain('id')
    expect(sql).toContain('UUID')
    expect(sql).toContain('PRIMARY KEY DEFAULT gen_random_uuid()')
  })

  it('organization_id is NOT NULL with direct FK to organizations', () => {
    expect(sql).toContain('organization_id')
    expect(sql).toContain('NOT NULL REFERENCES public.organizations(id)')
  })

  it('account_id is NOT NULL', () => {
    expect(sql).toMatch(/account_id\s+UUID\s+NOT NULL/)
  })

  it('has composite FK to financial_accounts(id, organization_id) — org-safe join', () => {
    expect(sql).toContain('financial_liability_terms_account_org_fk')
    expect(sql).toContain('FOREIGN KEY (account_id, organization_id)')
    expect(sql).toContain('REFERENCES public.financial_accounts(id, organization_id)')
  })

  it('composite FK cascades on account deletion', () => {
    expect(sql).toContain('ON DELETE CASCADE')
  })

  it('one-per-account unique constraint exists', () => {
    expect(sql).toContain('financial_liability_terms_one_per_account')
    expect(sql).toContain('UNIQUE (account_id, organization_id)')
  })

  it('id+org composite unique exists for downstream FK support', () => {
    expect(sql).toContain('financial_liability_terms_id_org_unique')
    expect(sql).toContain('UNIQUE (id, organization_id)')
  })

  it('APR is stored as INTEGER basis points — not DECIMAL or FLOAT', () => {
    expect(sql).toContain('apr_basis_points')
    // Must be INTEGER, not DECIMAL/NUMERIC/FLOAT/REAL
    expect(sql).not.toMatch(/apr_basis_points\s+DECIMAL/)
    expect(sql).not.toMatch(/apr_basis_points\s+NUMERIC/)
    expect(sql).not.toMatch(/apr_basis_points\s+FLOAT/)
    expect(sql).not.toMatch(/apr_basis_points\s+REAL/)
    expect(sql).toMatch(/apr_basis_points\s+INTEGER/)
  })

  it('promo APR is stored separately from regular APR', () => {
    expect(sql).toContain('promo_apr_basis_points')
    expect(sql).toContain('apr_basis_points')
    // They are distinct columns
    const aprIdx = sql.indexOf('apr_basis_points')
    const promoIdx = sql.indexOf('promo_apr_basis_points')
    expect(promoIdx).not.toBe(aprIdx)
  })

  it('promo coherence constraint: expiry only valid when promo APR or promo_type is present', () => {
    expect(sql).toContain('financial_liability_terms_promo_coherence')
    // Constraint is multi-line; check for each clause independently
    expect(sql).toContain('promo_expires_on IS NULL')
    expect(sql).toContain('OR promo_apr_basis_points IS NOT NULL')
  })

  it('debt_structure check constraint covers revolving, installment, other', () => {
    expect(sql).toContain("debt_structure IN ('revolving', 'installment', 'other')")
  })

  it('apr_basis_points check constraint enforces non-negative', () => {
    expect(sql).toContain('apr_basis_points >= 0')
  })

  it('payment_due_day check constraint enforces 1–31 range', () => {
    expect(sql).toContain('payment_due_day BETWEEN 1 AND 31')
  })

  it('minimum_payment_minor check enforces non-negative', () => {
    expect(sql).toContain('minimum_payment_minor')
    expect(sql).toContain('minimum_payment_minor >= 0')
  })

  it('does NOT store current_balance — balance authority remains financial_transactions', () => {
    expect(sql).not.toMatch(/current_balance/i)
    // No amount_minor column (that belongs to the ledger, not debt terms)
    expect(sql).not.toMatch(/^\s+amount_minor/m)
  })

  it('updated_at trigger uses existing set_cash_ledger_updated_at() function', () => {
    expect(sql).toContain('trg_financial_liability_terms_updated_at')
    expect(sql).toContain('EXECUTE FUNCTION set_cash_ledger_updated_at()')
  })

  it('RLS is enabled on the table', () => {
    expect(sql).toContain('ALTER TABLE public.financial_liability_terms ENABLE ROW LEVEL SECURITY')
  })

  it('REVOKE ALL from PUBLIC, anon, authenticated before granting', () => {
    expect(sql).toContain('REVOKE ALL ON public.financial_liability_terms FROM PUBLIC, anon, authenticated')
  })

  it('FOR ALL policy uses user_org_id() and is_org_admin_for() for org isolation', () => {
    expect(sql).toContain('financial_liability_terms_owner_admin_all')
    expect(sql).toContain('FOR ALL TO authenticated')
    expect(sql).toContain('organization_id = public.user_org_id()')
    expect(sql).toContain('public.is_org_admin_for(organization_id)')
  })

  it('GRANT covers SELECT, INSERT, UPDATE — no DELETE (deletion via account CASCADE)', () => {
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE ON public.financial_liability_terms TO authenticated')
    expect(sql).not.toContain('GRANT SELECT, INSERT, UPDATE, DELETE')
    expect(sql).not.toContain('GRANT DELETE')
  })

  it('table comment states balance is not stored here', () => {
    expect(sql).toContain('COMMENT ON TABLE public.financial_liability_terms')
    expect(sql).toMatch(/Current balance is derived exclusively from financial_transactions/i)
  })

  it('column comment documents basis-points convention and promo-APR separation', () => {
    expect(sql).toContain('COMMENT ON COLUMN public.financial_liability_terms.apr_basis_points')
    expect(sql).toContain('1 bp = 0.01')
    expect(sql).toContain('Never overwrite with the promotional rate')
  })

  it('minimum_payment comment documents it is informational — not a transaction', () => {
    expect(sql).toContain('COMMENT ON COLUMN public.financial_liability_terms.minimum_payment_minor')
    expect(sql).toContain('Informational only')
  })

  // ── Promo financing truth correction ──────────────────────────────────────

  it('promo_type column exists with constrained values', () => {
    expect(sql).toContain('promo_type')
    expect(sql).toContain("promo_type IN ('intro_apr', 'deferred_interest', 'reduced_apr_fixed_payment', 'other')")
  })

  it('promo_started_on column exists as DATE', () => {
    expect(sql).toContain('promo_started_on')
    expect(sql).toMatch(/promo_started_on\s+DATE/)
  })

  it('promo_type comment warns against inferring deferred_interest from 0% APR', () => {
    expect(sql).toContain('COMMENT ON COLUMN public.financial_liability_terms.promo_type')
    expect(sql).toContain('Do NOT infer deferred_interest from promo_apr_basis_points = 0 alone')
  })

  it('promo_started_on comment states it is required for 2C deferred-interest calculation', () => {
    expect(sql).toContain('COMMENT ON COLUMN public.financial_liability_terms.promo_started_on')
    expect(sql).toContain('CORE-CLOSE-2C')
  })

  it('promo coherence constraint allows promo_expires_on with promo_type even when promo_apr_basis_points is null', () => {
    // Deferred interest: promo_expires_on + promo_type, but promo_apr_basis_points may be null
    // Constraint must permit: promo_expires_on IS NULL OR promo_apr_basis_points IS NOT NULL OR promo_type IS NOT NULL
    expect(sql).toContain('promo_expires_on IS NULL')
    expect(sql).toContain('OR promo_apr_basis_points IS NOT NULL')
    expect(sql).toContain('OR promo_type IS NOT NULL')
  })

  it('table comment documents single-promotion limitation for CORE-CLOSE-2C', () => {
    expect(sql).toContain('CORE-CLOSE-2C')
    expect(sql).toContain('Multi-tranche')
  })
})
