import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

/**
 * BANK-1 static migration contract: checks the reviewed SQL text itself, independent of any database.
 * (Behavior is exercised against PostgreSQL in bank1ProviderDatabase.test.ts.)
 */
const FILE = 'supabase/migrations/153_bank_provider_evidence_foundation.sql'
const sql = readFileSync(FILE, 'utf8').replace(/\r/g, '')
const code = sql.replace(/--[^\n]*/g, '')
const TABLES = ['financial_provider_items', 'financial_provider_accounts', 'financial_provider_account_mappings', 'financial_provider_transactions',
  'financial_provider_balance_snapshots', 'financial_provider_webhook_events', 'financial_provider_interpretations']

describe('BANK-1 migration contract', () => {
  it('is migration 153, directly after the audited latest (152), with a unique number and a three-digit name', () => {
    const files = readdirSync('supabase/migrations').filter(f => /^\d{3}_/.test(f))
    expect(files.filter(f => f.startsWith('153_'))).toEqual(['153_bank_provider_evidence_foundation.sql'])
    expect(existsSync('supabase/migrations/152_panel_planner_photo_retry.sql')).toBe(true)
    expect(files.filter(f => /^\d{4,}/.test(f))).toEqual([]) // no timestamp-style names
  })

  it('runs in a single transaction and is re-runnable (IF NOT EXISTS / drop-guarded / OR REPLACE)', () => {
    expect(code).toMatch(/\bBEGIN;/); expect(code).toMatch(/\bCOMMIT;/)
    expect((code.match(/CREATE TABLE/g) ?? []).length).toBe(TABLES.length)
    expect((code.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length).toBe(TABLES.length)
    expect(code).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/)
    expect((code.match(/CREATE POLICY/g) ?? []).length).toBe((code.match(/DROP POLICY IF EXISTS/g) ?? []).length)
    expect((code.match(/CREATE TRIGGER/g) ?? []).length).toBe((code.match(/DROP TRIGGER IF EXISTS/g) ?? []).length)
    expect(code).not.toMatch(/CREATE FUNCTION/)
  })

  it('creates only the seven provider tables and no second ledger or economic-event table', () => {
    const created = [...code.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(m => m[1])
    expect(created.sort()).toEqual([...TABLES].sort())
    expect(created.some(t => /economic_event|ledger|plaid_/.test(t))).toBe(false)
  })

  it('stores no token, secret, credential or password column anywhere', () => {
    const columns = [...code.matchAll(/^\s{2}([a-z_]+)\s+(?:UUID|TEXT|BOOLEAN|INTEGER|BIGINT|NUMERIC|JSONB|DATE|TIMESTAMPTZ)\b/gm)].map(m => m[1])
    expect(columns.length).toBeGreaterThan(80)
    expect(columns.filter(c => /token|secret|password|credential|api_key/.test(c))).toEqual([])
    expect(code).toMatch(/financial_provider_json_is_safe/)
    expect(code).toMatch(/'access_token'.*'public_token'.*'client_secret'/s)
  })

  it('never writes to the canonical ledger or the Cash OS account tables', () => {
    expect(code).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+public\.financial_(transactions|accounts|transaction_links|obligations|obligation_occurrences|planned_reconciliations|liability_terms)\b/i)
    expect(code).not.toMatch(/ALTER TABLE\s+public\.(financial_(transactions|accounts|obligations|transaction_links)|cash_)/i)
    expect(code).not.toMatch(/CREATE (OR REPLACE )?TRIGGER[^;]*ON public\.(financial_transactions|financial_accounts)\b/i)
    // Only prose COMMENT statements may mention include_in_cash; no executable statement touches it.
    expect(code.replace(/COMMENT ON [^;]*;/g, '')).not.toMatch(/\binclude_in_cash\b/)
  })

  it('references canonical records only through organization-composite foreign keys', () => {
    for (const target of ['financial_transactions', 'financial_accounts', 'financial_obligation_occurrences', 'cash_commitments']) {
      expect(code, target).toMatch(new RegExp(`FOREIGN KEY \\(\\w+, organization_id\\)\\s+REFERENCES public\\.${target}\\(id, organization_id\\)`))
    }
    expect(code).toMatch(/FOREIGN KEY \(provider_account_ref, provider_item_ref, organization_id\)/)
  })

  it('enables RLS on every table; server-only tables have no policy; browser tables are owner/admin only', () => {
    for (const t of TABLES) expect(code, t).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`))
    for (const t of ['financial_provider_items', 'financial_provider_webhook_events']) expect(code, t).not.toMatch(new RegExp(`CREATE POLICY \\w+ ON public\\.${t}\\b`))
    const policies = [...code.matchAll(/CREATE POLICY (\w+) ON public\.(\w+) FOR (\w+) TO (\w+)/g)]
    expect(policies.length).toBeGreaterThan(8)
    for (const [, , , , role] of policies) expect(role).toBe('authenticated')
    expect(code.match(/public\.user_org_id\(\) AND public\.is_org_admin_for\(organization_id\)/g)!.length).toBeGreaterThanOrEqual(policies.length)
    expect(code).toMatch(/source = 'owner'/) // browser inserts are owner-sourced only
    expect(code).toMatch(/mapped_by = auth\.uid\(\)/)
  })

  it('grants nothing to PUBLIC or anon, and nothing writable to the browser for provider evidence', () => {
    expect(code).toMatch(/REVOKE ALL ON public\.financial_provider_items,[\s\S]*?FROM PUBLIC, anon, authenticated;/)
    const grants = [...code.matchAll(/GRANT ([A-Z, ]+) ON ([\s\S]*?) TO (\w+);/g)].filter(m => /financial_provider/.test(m[2]))
    expect(grants.length).toBe(2)
    for (const [, , , role] of grants) expect(role).toBe('authenticated')
    const readOnly = grants.find(g => /^SELECT$/.test(g[1].trim()))!
    expect(readOnly[2]).toMatch(/financial_provider_accounts/); expect(readOnly[2]).toMatch(/financial_provider_transactions/); expect(readOnly[2]).toMatch(/balance_snapshots/)
    expect(readOnly[2]).not.toMatch(/items|webhook/)
    expect(code).not.toMatch(/GRANT[^;]*\banon\b/i)
    expect(code).not.toMatch(/GRANT[^;]*\bDELETE\b/i)
  })

  it('has no project-payment or payroll-paid target (no durable canonical id exists yet) and no automation columns', () => {
    const interpretation = sql.slice(sql.indexOf('financial_provider_interpretations ('), sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_provider_interpretations_active_kind'))
    expect(interpretation.replace(/--[^\n]*/g, '')).not.toMatch(/project_payment|payment_log|payroll_paid|log_id|wage/i)
    expect(interpretation).toMatch(/project_id TEXT/) // the existing project identity is referenced, never a payment
    expect(interpretation).toMatch(/NO project-payment or\s+-- payroll-paid target/)
  })

  it('has no Plaid-specific table, endpoint or SDK dependency', () => {
    expect(code).not.toMatch(/plaid_/i)
    expect(readFileSync('package.json', 'utf8')).not.toMatch(/"plaid"|react-plaid-link/)
  })
})
