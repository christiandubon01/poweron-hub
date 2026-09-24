/**
 * ATB-5 — source-contract test for migration 136_agent_scope_packs.sql.
 * Reads the SQL file as text. Does not apply the migration or touch a database.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES } from '../scopePack/bounds'
import { IMPORT_SCOPE_PACK_PAYLOAD_KEYS, IMPORT_SCOPE_PACK_PHASE_KEYS } from '../scopePack/importPayload'

const ROOT = process.cwd()
const FILENAME = '136_agent_scope_packs.sql'
const MIG_PATH = join(ROOT, 'supabase', 'migrations', FILENAME)
const sql = existsSync(MIG_PATH) ? readFileSync(MIG_PATH, 'utf8') : ''
const codeSql = sql.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('ATB-5 migration 136 — file identity', () => {
  it('is the next available control-plane migration and exists on disk', () => {
    expect(existsSync(MIG_PATH)).toBe(true)
    const migs = readdirSync(join(ROOT, 'supabase', 'migrations'))
    expect(migs).toContain(FILENAME)
    const later = migs.filter((name) => /^\d+_/.test(name) && Number(name.slice(0, 3)) > 136)
    expect(later).toEqual([])
  })
})

describe('ATB-5 migration 136 — table + privacy', () => {
  it('creates public.agent_scope_packs with the required columns', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.agent_scope_packs')
    for (const col of [
      'id', 'organization_id', 'repo_key', 'title', 'source_filename', 'source_hash',
      'pack', 'reconciliation_state', 'current_phase_id', 'version', 'source_request_id',
      'created_at', 'updated_at', 'last_reconciled_at',
    ]) {
      expect(sql).toContain(col)
    }
  })

  it('does not persist raw source text or local filesystem paths', () => {
    expect(codeSql).not.toMatch(/\braw_source\b/)
    expect(codeSql).not.toMatch(/\bsource_text\b/)
    expect(codeSql).not.toMatch(/\bsource_contents\b/)
    expect(codeSql).not.toMatch(/\bfile_path\b/)
    expect(codeSql).not.toMatch(/\blocal_path\b/)
    expect(codeSql).not.toMatch(/\babsolute_path\b/)
    expect(sql).toMatch(/Never raw/i)
    expect(sql).toMatch(/source_filename must be a basename|Never a local filesystem path/i)
  })

  it('extends request_type CHECK with import_scope_pack only', () => {
    expect(sql).toContain("'import_scope_pack'")
    expect(sql).toMatch(/request_type IN \('create_plan', 'approve_plan', 'cancel_run', 'import_scope_pack'\)/)
    expect(codeSql).not.toMatch(/\bwebsocket\b/i)
    expect(codeSql).not.toMatch(/CREATE TYPE|argv\[/)
  })
})

describe('ATB-5 migration 136 — RLS', () => {
  it('enables RLS and revokes anon/PUBLIC/authenticated defaults', () => {
    expect(sql).toContain('ALTER TABLE public.agent_scope_packs ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON TABLE public.agent_scope_packs FROM PUBLIC')
    expect(sql).toContain('REVOKE ALL ON TABLE public.agent_scope_packs FROM anon')
    expect(sql).toContain('REVOKE ALL ON TABLE public.agent_scope_packs FROM authenticated')
  })

  it('grants owner/admin SELECT only — no authenticated writes, no employee policy', () => {
    expect(sql).toContain('CREATE POLICY agent_scope_packs_owner_admin_select')
    expect(sql).toContain('is_org_admin_for(organization_id)')
    expect(sql).toContain('user_org_id()')
    expect(sql).toContain('organization_id = public.user_org_id()')
    expect(sql).not.toMatch(/FOR INSERT/)
    expect(sql).not.toMatch(/FOR UPDATE/)
    expect(sql).not.toMatch(/FOR DELETE/)
    expect(sql).not.toMatch(/CREATE POLICY agent_scope_packs_.*employee/i)
    expect(sql).toMatch(/Employees have no policy/)
  })

  it('grants authenticated SELECT and no write, and leaves anon and service role unchanged', () => {
    expect(sql).toContain('GRANT SELECT ON TABLE public.agent_scope_packs TO authenticated')
    expect(sql).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)\s+ON\s+TABLE\s+public\.agent_scope_packs\s+TO\s+authenticated/i)
    expect(sql).not.toMatch(/GRANT\s+[^;]*\sTO\s+anon/i)
    expect(codeSql).not.toMatch(/service_role/i)
    expect(sql).toContain('REVOKE ALL ON TABLE public.agent_scope_packs FROM anon')
    expect(sql).toContain('REVOKE ALL ON TABLE public.agent_scope_packs FROM authenticated')
  })
})

describe('ATB-7A1 migration 136 — import payload firewall', () => {
  it('allowlists the Scope Pack draft and bounds persisted size before insert', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.enforce_import_scope_pack_payload()')
    expect(sql).toContain('trg_agent_control_requests_import_payload')
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF payload, request_type')
    expect(sql).toContain("NEW.request_type IS DISTINCT FROM 'import_scope_pack'")
    expect(sql).toContain(String(IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES))
    expect(IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES).toBeLessThan(256 * 1024)
    for (const key of IMPORT_SCOPE_PACK_PAYLOAD_KEYS) {
      expect(sql).toContain(`'${key}'`)
    }
    for (const key of IMPORT_SCOPE_PACK_PHASE_KEYS) {
      expect(sql).toContain(`'${key}'`)
    }
    expect(sql).toContain("'audit', 'implementation', 'verification', 'research'")
  })
})
