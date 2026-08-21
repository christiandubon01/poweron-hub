/**
 * QBO-2F — source-contract test for migration 131_invoice_drafts.sql.
 *
 * Verifies the SQL file (read as text — no DB is touched):
 *  - the migration is numbered 131 and the filename avoids qbo/quickbooks/intuit
 *    keywords (does not collide with the QBO firewall guards).
 *  - the org-scoped invoice_drafts table exists with the required columns.
 *  - money columns are NUMERIC(14,2) (no floating-point drift).
 *  - the status consistency CHECK enforces approved_at ↔ status.
 *  - RLS is enabled with four owner/admin policies scoped by user_org_id() +
 *    is_org_admin_for() (reuse of proven helpers, no parallel authority model).
 *  - anon/PUBLIC access is revoked and never granted (anon denied).
 *  - the migration stores NO secrets (no Anthropic key / QBO OAuth token /
 *    refresh token / service-role credential / browser auth token columns).
 *  - the migration writes no payment / collected / KPI / QBO truth.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const MIG_PATH = join(ROOT, 'supabase', 'migrations', '131_invoice_drafts.sql')
const sql = existsSync(MIG_PATH) ? readFileSync(MIG_PATH, 'utf8') : ''
// Strip comments for NEGATIVE scans (so descriptive header comments mentioning
// "OAuth"/"payment"/"QBO" do not false-positive). Positive assertions use raw `sql`.
const codeSql = sql
  .replace(/--.*$/gm, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('QBO-2F migration 131 — file identity', () => {
  it('the migration file exists and is numbered 131', () => {
    expect(existsSync(MIG_PATH)).toBe(true)
    const migs = readdirSync(join(ROOT, 'supabase', 'migrations'))
    expect(migs).toContain('131_invoice_drafts.sql')
  })

  it('the filename avoids qbo/quickbooks/intuit/billing keywords (QBO firewall)', () => {
    expect('131_invoice_drafts.sql').not.toMatch(/qbo|quickbooks|intuit|billing/i)
  })
})

describe('QBO-2F migration 131 — table + columns', () => {
  it('creates public.invoice_drafts with the required columns', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.invoice_drafts')
    for (const col of [
      'id', 'organization_id', 'created_by', 'created_at', 'updated_at',
      'status', 'approved_at',
      'source_type', 'source_kind', 'source_id', 'selected_source_ids', 'source_snapshot',
      'customer_reference', 'customer_id',
      'product_or_service', 'description', 'primary_amount', 'separate_charges',
      'total_amount', 'currency',
    ]) {
      expect(sql).toContain(col)
    }
  })

  it('organization_id references public.organizations(id) ON DELETE RESTRICT', () => {
    expect(sql).toMatch(/organization_id\s+UUID\s+NOT NULL\s+REFERENCES public\.organizations\(id\)\s+ON DELETE RESTRICT/)
  })

  it('money columns are NUMERIC(14,2) (no floating-point drift)', () => {
    expect(sql).toMatch(/primary_amount\s+NUMERIC\(14,2\)/)
    expect(sql).toMatch(/total_amount\s+NUMERIC\(14,2\)/)
    // No double precision / real money columns.
    expect(sql).not.toMatch(/primary_amount\s+(double precision|real)/i)
    expect(sql).not.toMatch(/total_amount\s+(double precision|real)/i)
  })
})

describe('QBO-2F migration 131 — status model', () => {
  it('status is CHECK-constrained to draft | approved (no sent status)', () => {
    expect(sql).toMatch(/status\s+TEXT\s+NOT NULL\s+DEFAULT 'draft'\s+CHECK \(status IN \('draft', 'approved'\)\)/)
    expect(codeSql).not.toMatch(/'sent'/)
  })

  it('source_kind is CHECK-constrained to project | serviceLog | serviceCall', () => {
    expect(sql).toMatch(/source_kind\s+TEXT\s+NOT NULL\s+CHECK \(source_kind IN \('project', 'serviceLog', 'serviceCall'\)\)/)
  })

  it('status_approved_at_consistency CHECK enforces approved ↔ approved_at', () => {
    expect(sql).toContain('invoice_drafts_status_approved_at_consistency')
    expect(sql).toMatch(/status = 'approved' AND approved_at IS NOT NULL/)
    expect(sql).toMatch(/status = 'draft' AND approved_at IS NULL/)
  })

  it('a BEFORE UPDATE trigger refreshes updated_at', () => {
    expect(sql).toContain('public.set_invoice_drafts_updated_at()')
    expect(sql).toContain('BEFORE UPDATE ON public.invoice_drafts')
    expect(sql).toMatch(/NEW\.updated_at := now\(\)/)
  })
})

describe('QBO-2F migration 131 — RLS (org-scoped, anon denied)', () => {
  it('enables RLS', () => {
    expect(sql).toContain('ALTER TABLE public.invoice_drafts ENABLE ROW LEVEL SECURITY')
  })

  it('revokes access from PUBLIC and anon', () => {
    expect(sql).toContain('REVOKE ALL ON TABLE public.invoice_drafts FROM PUBLIC')
    expect(sql).toContain('REVOKE ALL ON TABLE public.invoice_drafts FROM anon')
  })

  it('grants CRUD only to authenticated (not to anon)', () => {
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoice_drafts TO authenticated')
    // No GRANT to anon.
    expect(sql).not.toMatch(/GRANT.*ON TABLE public\.invoice_drafts TO anon/i)
  })

  it('all four policies are scoped by user_org_id() + is_org_admin_for() (no parallel authority)', () => {
    for (const policy of [
      'invoice_drafts_owner_admin_select',
      'invoice_drafts_owner_admin_insert',
      'invoice_drafts_owner_admin_update',
      'invoice_drafts_owner_admin_delete',
    ]) {
      expect(sql).toContain(policy)
    }
    // Every policy uses both proven helpers (no bespoke role logic).
    const policyBlocks = sql.match(/CREATE POLICY invoice_drafts_owner_admin_\w+[\s\S]*?;/g) ?? []
    expect(policyBlocks.length).toBeGreaterThanOrEqual(4)
    for (const block of policyBlocks) {
      expect(block).toContain('public.user_org_id()')
      expect(block).toContain('public.is_org_admin_for(organization_id)')
    }
  })

  it('the SELECT policy is FOR SELECT to authenticated only', () => {
    expect(sql).toMatch(/invoice_drafts_owner_admin_select\s+ON public\.invoice_drafts FOR SELECT\s+TO authenticated/)
  })

  it('the DELETE policy is FOR DELETE to authenticated only', () => {
    expect(sql).toMatch(/invoice_drafts_owner_admin_delete\s+ON public\.invoice_drafts FOR DELETE\s+TO authenticated/)
  })
})

describe('QBO-2F migration 131 — no secrets + no canonical truth writes', () => {
  it('stores NO secrets (no key/token/credential columns or literals)', () => {
    expect(codeSql).not.toMatch(/anthropic_api_key|ANTHROPIC_API_KEY|x-api-key/i)
    expect(codeSql).not.toMatch(/qbo.*token|refresh_token|oauth|client_secret|service_role|supabase.*key/i)
    expect(codeSql).not.toMatch(/access_token|id_token|session_token/i)
  })

  it('writes no payment / collected / KPI / QBO truth (only invoice_drafts is touched)', () => {
    // No DML against other tables.
    expect(codeSql).not.toMatch(/INSERT INTO public\.(projects|service_logs|service_calls|call_logs|weekly|kpi|referral)/i)
    expect(codeSql).not.toMatch(/UPDATE public\.(projects|service_logs|service_calls|call_logs|weekly|kpi)/i)
    // No QBO API / no external http.
    expect(codeSql).not.toMatch(/intuit|quickbooks\.api|oauth\.platform|http_request|pg_http/i)
  })

  it('includes postcondition assertions (RLS enabled, anon denied, NUMERIC, policies)', () => {
    expect(sql).toContain('POSTCONDITION FAILED: RLS not enabled')
    expect(sql).toContain('POSTCONDITION FAILED: anon must not access invoice_drafts')
    expect(sql).toContain('POSTCONDITION FAILED: primary_amount must be NUMERIC')
    expect(sql).toContain('POSTCONDITION FAILED: select policy missing')
  })
})