import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  new URL('../../../supabase/migrations/139_cash_accounts_manual_ledger.sql', import.meta.url),
  'utf8',
)

describe('CASH-2 migration contract', () => {
  it('creates the three canonical ledger tables', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.financial_accounts')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.financial_transactions')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.financial_transaction_links')
  })

  it('uses integer cents', () => {
    expect(sql).toContain('amount_minor BIGINT NOT NULL')
    expect(sql).toContain('economic_amount_minor BIGINT NOT NULL DEFAULT 0')
  })

  it('does not store an editable current balance', () => {
    expect(sql).not.toMatch(/current_balance/i)
  })

  it('restricts Total Cash to assets', () => {
    expect(sql).toContain('financial_accounts_cash_assets_only')
  })

  it('keeps opening balances economically neutral', () => {
    expect(sql).toContain("'opening_balance', 'transfer', 'card_debt_payment'")
    expect(sql).toContain("economic_effect = 'none'")
  })

  it('allows only one live opening balance per account', () => {
    expect(sql).toContain('uq_financial_transactions_one_live_opening')
  })

  it('uses org-safe composite foreign keys', () => {
    expect(sql).toContain('FOREIGN KEY (account_id, organization_id)')
    expect(sql).toContain('FOREIGN KEY (source_transaction_id, organization_id)')
  })

  it('enables RLS on all three ledger tables', () => {
    expect(sql).toContain('ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE public.financial_transaction_links ENABLE ROW LEVEL SECURITY')
  })

  it('uses owner/admin organization policies', () => {
    expect(sql).toContain('public.user_org_id()')
    expect(sql).toContain('public.is_org_admin_for(organization_id)')
  })

  it('creates SECURITY INVOKER transfer and card-payment RPCs', () => {
    expect(sql).toContain('record_financial_transfer')
    expect(sql).toContain('record_financial_card_payment')
    expect(sql.match(/SECURITY INVOKER/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('revokes public/anon mutation RPC execution', () => {
    expect(sql).toContain('FROM PUBLIC, anon')
    expect(sql).toContain('TO authenticated')
  })
})