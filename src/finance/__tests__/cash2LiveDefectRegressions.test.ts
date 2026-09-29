import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const transferFix = readFileSync(
  new URL('../../../supabase/migrations/141_cash_transfer_conflict_target_fix.sql', import.meta.url),
  'utf8',
)
const voidFix = readFileSync(
  new URL('../../../supabase/migrations/142_cash_pair_void_link_lock_fix.sql', import.meta.url),
  'utf8',
)

describe('CASH-2 live PostgreSQL defect regressions', () => {
  it('uses named constraint conflict resolution for transfer link insertion', () => {
    expect(transferFix).toContain('ON CONFLICT ON CONSTRAINT financial_links_unique')
  })

  it('does not regress to the ambiguous column-list conflict target', () => {
    expect(transferFix).not.toContain('ON CONFLICT (organization_id, source_transaction_id, target_transaction_id, relationship_type)')
  })

  it('preserves transfer RPC privilege hardening', () => {
    expect(transferFix).toContain('REVOKE ALL ON FUNCTION public.record_financial_transfer')
    expect(transferFix).toContain('TO authenticated')
  })

  it('does not request FOR UPDATE on the read-only link lookup', () => {
    const linkLookup = voidFix.slice(
      voidFix.indexOf('FROM public.financial_transaction_links l'),
      voidFix.indexOf("IF v_source IS NULL"),
    )
    expect(linkLookup).not.toContain('FOR UPDATE')
  })

  it('still locks both referenced transaction rows', () => {
    expect((voidFix.match(/FROM public\.financial_transactions[\s\S]*?FOR UPDATE/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('preserves exact two-row atomic void invariant', () => {
    expect(voidFix).toContain('v_updated_count <> 2')
  })

  it('preserves replay-safe already_voided behavior', () => {
    expect(voidFix).toContain("'already_voided'::TEXT")
  })

  it('does not mutate or delete the historical link', () => {
    expect(voidFix).not.toMatch(/UPDATE\s+public\.financial_transaction_links/i)
    expect(voidFix).not.toMatch(/DELETE\s+FROM\s+public\.financial_transaction_links/i)
  })
})