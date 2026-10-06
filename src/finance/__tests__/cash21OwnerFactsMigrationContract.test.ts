import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(new URL('../../../supabase/migrations/147_cash_owner_facts.sql', import.meta.url), 'utf8')
/** Column definitions only: comments may legitimately say what the table does NOT hold. */
const tableDefinition = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.cash_project_facts'), sql.indexOf('COMMENT ON TABLE public.cash_project_facts'))
  .split('\n').filter(line => !line.trim().startsWith('--')).join('\n')

describe('CASH-UX-2 migration 147 contract', () => {
  it('is additive: no drops, no data rewrites, no deletes', () => {
    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
    expect(sql).not.toMatch(/^\s*UPDATE\s/im)
    expect(sql).toContain('BEGIN;')
    expect(sql).toContain('COMMIT;')
  })
  it('keeps debt past-due, catch-up and the normal payment as separate nullable integer-cent facts', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS past_due_minor BIGINT')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS catch_up_minor BIGINT')
    expect(sql).toMatch(/past_due_minor IS NULL OR past_due_minor >= 0/)
    expect(sql).toMatch(/catch_up_minor IS NULL OR catch_up_minor >= 0/)
    expect(sql).not.toMatch(/ALTER COLUMN\s+(minimum_payment_minor|scheduled_payment_minor)/i)
  })
  it('adds criticality as an owner-answered boolean defaulting to false, never derived', () => {
    expect((sql.match(/operationally_critical BOOLEAN NOT NULL DEFAULT false/g) ?? []).length).toBe(3)
    expect(sql).toContain('public.financial_obligations')
    expect(sql).toContain('public.cash_commitments')
    expect(sql).toContain('public.financial_liability_terms')
  })
  it('project facts hold no balance, receivable or amount, and are one row per project', () => {
    const table = tableDefinition
    expect(table).not.toMatch(/amount|balance|_minor|receivable|contract|revenue/i)
    expect(table).toContain('UNIQUE (organization_id, project_id)')
    expect(table).toContain("billing_type TEXT CHECK (billing_type IN ('fixed', 'time_and_material'))")
    expect(table).toContain("readiness TEXT CHECK (readiness IN ('work_required', 'ready_to_bill'))")
    expect(table).toContain('project_id TEXT NOT NULL')
  })
  it('does not use a generic JSON dumping ground', () => {
    const table = tableDefinition
    expect(table).not.toMatch(/JSONB|JSON\b/i)
  })
  it('is org-scoped with the same admin-only RLS as the other Cash OS tables, and no DELETE grant', () => {
    expect(sql).toContain('ALTER TABLE public.cash_project_facts ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON public.cash_project_facts FROM PUBLIC, anon, authenticated')
    expect(sql).toContain('organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id)')
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE ON public.cash_project_facts TO authenticated')
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*cash_project_facts/i)
  })
  it('rejects blank text so an empty answer is stored as unknown, not as an empty string', () => {
    expect(sql).toMatch(/completion_requirement IS NULL OR length\(trim\(completion_requirement\)\) > 0/)
    expect(sql).toMatch(/blocked_reason IS NULL OR length\(trim\(blocked_reason\)\) > 0/)
    expect(sql).toMatch(/critical_reason IS NULL OR length\(trim\(critical_reason\)\) > 0/)
  })
})
