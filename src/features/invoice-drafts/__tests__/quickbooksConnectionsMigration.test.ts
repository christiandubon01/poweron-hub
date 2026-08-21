/**
 * QBO-3A — source-contract test for migration 132_quickbooks_connections_and_oauth_states.sql.
 *
 * Verifies the SQL file (read as text — no DB is touched):
 *  - the migration is numbered 132 and the filename is descriptive.
 *  - both server-only tables exist with the required columns.
 *  - one connection row per organization (UNIQUE(organization_id)).
 *  - nonce_hash is UNIQUE; only the hash is stored (raw nonce never persisted).
 *  - status / environment CHECK constraints; token_version default 0.
 *  - RLS enabled, REVOKE ALL from PUBLIC/anon/authenticated, NO authenticated
 *    policies (server-only — browser has no direct CRUD; service role is sole
 *    authority). This is the crux of tests 21 + 22 (browser no direct read,
 *    anon no access).
 *  - the migration stores no plaintext tokens (only encrypted_* columns) and
 *    writes no payment / collected / KPI / invoice_draft / service / historical
 *    truth (QBO-1A2 firewall intact).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const MIG_PATH = join(ROOT, 'supabase', 'migrations', '132_quickbooks_connections_and_oauth_states.sql')
const sql = existsSync(MIG_PATH) ? readFileSync(MIG_PATH, 'utf8') : ''
// Strip comments for NEGATIVE scans so header comments mentioning "payment"/
// "token"/"QBO" do not false-positive. Positive assertions use raw `sql`.
const codeSql = sql
  .replace(/--.*$/gm, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('QBO-3A migration 132 — file identity', () => {
  it('the migration file exists and is numbered 132', () => {
    expect(existsSync(MIG_PATH)).toBe(true)
    const migs = readdirSync(join(ROOT, 'supabase', 'migrations'))
    expect(migs).toContain('132_quickbooks_connections_and_oauth_states.sql')
  })

  it('no migration file numbered > 132 other than the approved 133 (ceiling honored)', () => {
    // QBO-4A.2 raised the approved migration ceiling from 132 to 133. 133 is the
    // ONLY new migration; this guard catches any accidental migration beyond it.
    const migs = readdirSync(join(ROOT, 'supabase', 'migrations'))
    const nums = migs
      .map((m) => parseInt(m.split('_')[0], 10))
      .filter((n) => Number.isFinite(n) && n > 132)
    expect(nums).toEqual([133])
  })
})

describe('QBO-3A migration 132 — quickbooks_connections table', () => {
  it('creates public.quickbooks_connections with the required columns', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.quickbooks_connections')
    for (const col of [
      'id', 'organization_id', 'created_by', 'created_at', 'updated_at',
      'status', 'connected_at', 'disconnected_at', 'connected_by',
      'environment', 'company_name',
      'encrypted_access_token', 'encrypted_refresh_token', 'encrypted_realm_id',
      'access_token_expires_at', 'refresh_token_expires_at', 'last_refreshed_at',
      'token_version',
    ]) {
      expect(sql).toContain(col)
    }
  })

  it('organization_id references public.organizations(id) ON DELETE RESTRICT', () => {
    expect(sql).toMatch(/organization_id\s+UUID\s+NOT NULL\s+REFERENCES public\.organizations\(id\)\s+ON DELETE RESTRICT/)
  })

  it('one connection row per organization (UNIQUE(organization_id))', () => {
    expect(sql).toMatch(/quickbooks_connections_organization_unique UNIQUE \(organization_id\)/)
  })

  it('status CHECK connected|disconnected; environment CHECK sandbox|production', () => {
    expect(sql).toMatch(/status\s+TEXT\s+NOT NULL\s+DEFAULT 'connected'\s+CHECK \(status IN \('connected', 'disconnected'\)\)/)
    expect(sql).toMatch(/environment\s+TEXT\s+NOT NULL\s+DEFAULT 'production'\s+CHECK \(environment IN \('sandbox', 'production'\)\)/)
  })

  it('status / disconnected_at consistency CHECK', () => {
    expect(sql).toContain('quickbooks_connections_status_disconnected_at_consistency')
    expect(sql).toMatch(/status = 'connected'\s+AND disconnected_at IS NULL/)
    expect(sql).toMatch(/status = 'disconnected'\s+AND disconnected_at IS NOT NULL/)
  })

  it('token_version INTEGER NOT NULL DEFAULT 0', () => {
    expect(sql).toMatch(/token_version\s+INTEGER\s+NOT NULL\s+DEFAULT 0/)
  })

  it('a BEFORE UPDATE trigger refreshes updated_at', () => {
    expect(sql).toContain('public.set_quickbooks_connections_updated_at()')
    expect(sql).toContain('BEFORE UPDATE ON public.quickbooks_connections')
    expect(sql).toMatch(/NEW\.updated_at := now\(\)/)
  })
})

describe('QBO-3A migration 132 — quickbooks_oauth_states table', () => {
  it('creates public.quickbooks_oauth_states with the required columns', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.quickbooks_oauth_states')
    for (const col of ['id', 'nonce_hash', 'organization_id', 'user_id', 'return_path', 'expires_at', 'consumed_at', 'created_at']) {
      expect(sql).toContain(col)
    }
  })

  it('nonce_hash is UNIQUE', () => {
    expect(sql).toMatch(/quickbooks_oauth_states_nonce_hash_unique UNIQUE \(nonce_hash\)/)
  })

  it('org/user cascade on delete', () => {
    expect(sql).toMatch(/organization_id\s+UUID\s+NOT NULL\s+REFERENCES public\.organizations\(id\)\s+ON DELETE CASCADE/)
    expect(sql).toMatch(/user_id\s+UUID\s+NOT NULL\s+REFERENCES auth\.users\(id\)\s+ON DELETE CASCADE/)
  })

  it('only the nonce HASH column exists (no raw nonce column)', () => {
    expect(sql).not.toMatch(/raw_nonce|nonce_plain|nonce_value/i)
  })
})

describe('QBO-3A migration 132 — RLS server-only (tests 21 + 22)', () => {
  it('enables RLS on both tables', () => {
    expect(sql).toMatch(/ALTER TABLE public\.quickbooks_connections\s+ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/ALTER TABLE public\.quickbooks_oauth_states\s+ENABLE ROW LEVEL SECURITY/)
  })

  it('21: revokes ALL from PUBLIC, anon, AND authenticated on both tables (browser has no direct read)', () => {
    for (const table of ['quickbooks_connections', 'quickbooks_oauth_states']) {
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC`)
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon`)
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM authenticated`)
    }
    // No CRUD grant to authenticated or anon on either table.
    expect(codeSql).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE)[\s\S]*?ON TABLE public\.quickbooks_(connections|oauth_states)\s+TO (authenticated|anon)/i)
  })

  it('22: NO authenticated RLS policies on either table (server-only; service role is sole authority)', () => {
    expect(codeSql).not.toMatch(/CREATE POLICY[\s\S]*?ON public\.quickbooks_connections/i)
    expect(codeSql).not.toMatch(/CREATE POLICY[\s\S]*?ON public\.quickbooks_oauth_states/i)
    // Only schema USAGE is granted to authenticated (no table data).
    expect(sql).toContain('GRANT USAGE ON SCHEMA public TO authenticated')
  })
})

describe('QBO-3A migration 132 — no plaintext secrets + no financial truth writes', () => {
  it('stores NO plaintext token columns (only encrypted_* envelopes)', () => {
    // No plaintext access/refresh token or realmId columns: the only token-named
    // columns are the encrypted_* envelopes and the *_expires_at metadata.
    expect(codeSql).not.toMatch(/\baccess_token\b(?!_expires_at)/i)
    expect(codeSql).not.toMatch(/\brefresh_token\b(?!_expires_at)/i)
    // No Anthropic / service-role / client-secret literals.
    expect(codeSql).not.toMatch(/anthropic_api_key|service_role|client_secret|supabase.*key/i)
  })

  it('writes no payment / collected / KPI / invoice_draft / service / historical truth', () => {
    expect(codeSql).not.toMatch(/INSERT INTO public\.(projects|service_logs|service_calls|call_logs|weekly|kpi|referral|invoice_drafts|historical)/i)
    expect(codeSql).not.toMatch(/UPDATE public\.(projects|service_logs|service_calls|call_logs|weekly|kpi|invoice_drafts|historical)/i)
    // No QBO API / external http.
    expect(codeSql).not.toMatch(/quickbooks\.api|oauth\.platform|http_request|pg_http/i)
  })

  it('includes postcondition assertions (RLS, anon denied, no policies, UNIQUE, defaults)', () => {
    expect(sql).toContain('POSTCONDITION FAILED: RLS not enabled on quickbooks_connections')
    expect(sql).toContain('POSTCONDITION FAILED: anon must not access quickbooks_connections')
    expect(sql).toContain('POSTCONDITION FAILED: quickbooks_connections must have no RLS policies (server-only)')
    expect(sql).toContain('POSTCONDITION FAILED: quickbooks_connections.organization_id must be UNIQUE')
    expect(sql).toContain('POSTCONDITION FAILED: quickbooks_oauth_states.nonce_hash must be UNIQUE')
    expect(sql).toContain('POSTCONDITION FAILED: token_version default must be 0')
  })
})