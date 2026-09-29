/**
 * CT-LIVE-0C0 — source-contract test for migration 138.
 * Reads the SQL file as text. Does not apply the migration or touch a database.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const FILENAME = '138_apply_candidate_request_type.sql'
const MIG_PATH = join(ROOT, 'supabase', 'migrations', FILENAME)
const sql = existsSync(MIG_PATH) ? readFileSync(MIG_PATH, 'utf8') : ''
const statements = sql.replace(/--.*$/gm, ' ')
const claimSql = readFileSync(join(ROOT, 'supabase', 'migrations', '135_agent_control_plane.sql'), 'utf8')

function requestTypes(source: string): string[] {
  const match = source.match(/request_type IN \(\s*([\s\S]*?)\)/)
  if (!match) return []
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
}

describe('CT-LIVE-0C0 migration 138 — apply_candidate request type', () => {
  it('is the migration after 137 and exists on disk', () => {
    expect(existsSync(MIG_PATH)).toBe(true)
    const migs = readdirSync(join(ROOT, 'supabase', 'migrations'))
    expect(migs).toContain('137_create_plan_payload_envelope.sql')
    expect(migs).toContain(FILENAME)
    const sorted = migs.filter((n) => /^\d+_/.test(n)).sort((a, b) => parseInt(a) - parseInt(b))
    const idx = sorted.indexOf(FILENAME)
    expect(sorted[idx - 1]).toBe('137_create_plan_payload_envelope.sql')
  })

  it('keeps the existing request types and adds only apply_candidate', () => {
    expect(requestTypes(sql)).toEqual([
      'create_plan',
      'approve_plan',
      'cancel_run',
      'import_scope_pack',
      'apply_candidate',
    ])
    expect(requestTypes(sql)).not.toContain('shell')
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS agent_control_requests_request_type_check')
    expect(sql).toContain('ADD CONSTRAINT agent_control_requests_request_type_check')
  })

  it('does not change the control-request row shape or the claim RPC', () => {
    expect(statements).not.toMatch(/\bADD COLUMN\b/)
    expect(statements).not.toMatch(/\bDROP COLUMN\b/)
    expect(statements).not.toMatch(/\bALTER COLUMN\b/)
    expect(statements).not.toMatch(/\bCREATE TABLE\b/)
    expect(statements).not.toMatch(/claim_agent_control_requests/)
    expect(statements).not.toMatch(/CREATE OR REPLACE FUNCTION/)
    expect(claimSql).toContain('CREATE OR REPLACE FUNCTION public.claim_agent_control_requests(')
    expect(claimSql).toContain('p_organization_id uuid')
    expect(claimSql).toContain('p_repo_keys       text[]')
    expect(claimSql).toContain('p_host_instance_id text')
    expect(claimSql).toContain('p_limit           int DEFAULT 10')
    expect(claimSql).toContain('RETURNS SETOF public.agent_control_requests')
  })
})
