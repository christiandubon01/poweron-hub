/**
 * CT-LIVE-0A — source-contract test for migration 137.
 * Reads the SQL file as text. Does not apply the migration or touch a database.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CREATE_PLAN_STORAGE_MAX_BYTES } from '../capacity'

const ROOT = process.cwd()
const FILENAME = '137_create_plan_payload_envelope.sql'
const MIG_PATH = join(ROOT, 'supabase', 'migrations', FILENAME)
const sql = existsSync(MIG_PATH) ? readFileSync(MIG_PATH, 'utf8') : ''

describe('CT-LIVE-0A migration 137 — create_plan payload envelope', () => {
  it('is the migration after 136 and exists on disk', () => {
    expect(existsSync(MIG_PATH)).toBe(true)
    const migs = readdirSync(join(ROOT, 'supabase', 'migrations'))
    expect(migs).toContain('136_agent_scope_packs.sql')
    expect(migs).toContain(FILENAME)
    const sorted = migs.filter((n) => /^\d+_/.test(n)).sort((a, b) => parseInt(a) - parseInt(b))
    const idx = sorted.indexOf(FILENAME)
    expect(sorted[idx + 1]).toBe('138_apply_candidate_request_type.sql')
  })

  it('enforces the 192 KiB storage ceiling only for create_plan', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.enforce_create_plan_payload_envelope()')
    expect(sql).toContain('trg_agent_control_requests_create_plan_payload')
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF payload, request_type')
    expect(sql).toContain("NEW.request_type IS DISTINCT FROM 'create_plan'")
    expect(sql).toContain('CREATE_PLAN_PAYLOAD_REJECTED')
    expect(sql).toContain(String(CREATE_PLAN_STORAGE_MAX_BYTES))
    expect(CREATE_PLAN_STORAGE_MAX_BYTES).toBe(192 * 1024)
    expect(sql).not.toMatch(/\bDROP TABLE\b/)
    expect(sql).not.toMatch(/\bALTER TABLE public\.agent_scope_packs\b/)
  })
})
