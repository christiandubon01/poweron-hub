import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  new URL('../../../supabase/migrations/143_cash_dated_obligations.sql', import.meta.url),
  'utf8',
)

describe('CASH-3 migration contract', () => {
  it('adds exactly the planned-outflow foundation tables', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.financial_obligations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.financial_obligation_occurrences')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.cash_commitments')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.financial_planned_reconciliations')
  })

  it('stores money in integer cents and due dates as DATE', () => {
    expect(sql).toContain('amount_minor BIGINT NOT NULL')
    expect(sql).toContain('expected_date DATE NOT NULL')
    expect(sql).toContain('scheduled_date DATE NOT NULL')
  })

  it('keeps required and confidence as separate dimensions', () => {
    expect(sql).toContain('is_required BOOLEAN')
    expect(sql).toContain("confidence IN ('confirmed','expected','possible')")
  })

  it('supports bounded occurrence materialization instead of infinite future rows', () => {
    expect(sql).toContain('financial_obligation_occurrences')
    expect(sql).not.toMatch(/generate_series/i)
  })

  it('prevents one actual transaction satisfying multiple planned items', () => {
    expect(sql).toContain('financial_planned_one_actual_transaction UNIQUE')
  })

  it('prevents one occurrence or commitment reconciling more than once', () => {
    expect(sql).toContain('uq_financial_planned_occurrence')
    expect(sql).toContain('uq_financial_planned_commitment')
  })

  it('rejects opening balances and transfers as reconciliation actuals', () => {
    expect(sql).toContain("v_tx_kind IN ('opening_balance','transfer')")
  })

  it('requires exact-cent full reconciliation in V1', () => {
    expect(sql).toContain('abs(v_tx_amount) <> v_plan_amount')
    expect(sql).toContain('partial/variance matching is not supported')
  })

  it('stores no duplicate reconciliation amount', () => {
    const start = sql.indexOf('CREATE TABLE IF NOT EXISTS public.financial_planned_reconciliations')
    const end = sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_planned_occurrence')
    expect(sql.slice(start, end)).not.toContain('amount_minor')
  })

  it('uses org-safe composite foreign keys to CASH-2 actual transactions', () => {
    expect(sql).toContain('FOREIGN KEY (transaction_id, organization_id)')
    expect(sql).toContain('REFERENCES public.financial_transactions(id, organization_id)')
  })

  it('enables RLS on all CASH-3 tables', () => {
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)?.length ?? 0).toBe(4)
  })

  it('requires same-org owner/admin authorization', () => {
    expect(sql).toContain('organization_id = public.user_org_id()')
    expect(sql).toContain('public.is_org_admin_for(organization_id)')
  })

  it('revokes anon/PUBLIC table access before authenticated grants', () => {
    expect(sql).toContain('FROM PUBLIC, anon, authenticated')
  })

  it('hardens the reconciliation RPC as SECURITY INVOKER', () => {
    expect(sql).toContain('public.reconcile_financial_planned_outflow')
    expect(sql).toContain('SECURITY INVOKER')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.reconcile_financial_planned_outflow')
  })

  it('does not auto-materialize legacy overhead assumptions', () => {
    expect(sql).not.toContain('settings.overhead')
    expect(sql).toContain("'owner_reviewed_overhead'")
  })

  it('does not modify pair-void behavior', () => {
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.void_financial_transaction_pair')
  })
})