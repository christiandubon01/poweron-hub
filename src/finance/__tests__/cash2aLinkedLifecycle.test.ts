import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const hardening = readFileSync(
  new URL('../../../supabase/migrations/140_cash_linked_pair_lifecycle_hardening.sql', import.meta.url),
  'utf8',
)
const finalVoid = readFileSync(
  new URL('../../../supabase/migrations/142_cash_pair_void_link_lock_fix.sql', import.meta.url),
  'utf8',
)

describe('CASH-2A linked lifecycle hardening', () => {
  it('uses a deferred constraint trigger for final pair state', () => {
    expect(hardening).toContain('CREATE CONSTRAINT TRIGGER trg_financial_pair_lifecycle_consistency')
    expect(hardening).toContain('DEFERRABLE INITIALLY DEFERRED')
  })

  it('rejects mixed lifecycle states in confirmed pairs', () => {
    expect(hardening).toContain('Confirmed transfer/card-payment pairs must share one lifecycle state')
  })

  it('requires matching state when a confirmed link is created', () => {
    expect(hardening).toContain('Confirmed financial pair link requires matching transaction lifecycle states')
  })

  it('requires a nonblank reason for pair void', () => {
    expect(finalVoid).toContain('Pair void reason is required')
  })

  it('voids exactly two transactions', () => {
    expect(finalVoid).toContain('v_updated_count <> 2')
    expect(finalVoid).toContain('Financial pair void must update exactly two transactions')
  })

  it('has deterministic already_voided replay', () => {
    expect(finalVoid).toContain("'already_voided'::TEXT")
  })

  it('preserves historical link rows', () => {
    expect(finalVoid).not.toMatch(/DELETE\s+FROM\s+public\.financial_transaction_links/i)
  })

  it('keeps the final pair-void RPC SECURITY INVOKER', () => {
    expect(finalVoid).toContain('SECURITY INVOKER')
  })

  it('grants pair void only back to authenticated', () => {
    expect(finalVoid).toContain('FROM PUBLIC, anon, authenticated')
    expect(finalVoid).toContain('TO authenticated')
  })
})