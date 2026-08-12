/**
 * Project-only ownerless assignment fallback (EMERG-PROJECT-ONLY-CLOCK-104).
 *
 * Source-level contract tests for migration 104. Reads SQL sources only —
 * no DB, no DOM, no RPC calls.
 *
 * Verifies Project-only clock_in:
 *   Path A — app_state when organizations.owner_id IS NOT NULL
 *   Path B — eligible assignment when owner_id is null OR Path A misses
 *   No early 'Organization owner not configured' abort before Path B
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root   = process.cwd()
const migDir = join(root, 'supabase/migrations')

const read = (p: string) => readFileSync(p, 'utf8')

const MIG_104_NAME = '104_project_only_ownerless_assignment_fallback.sql'
const mig104Path   = join(migDir, MIG_104_NAME)
const mig104       = existsSync(mig104Path) ? read(mig104Path) : ''
const mig103       = read(join(migDir, '103_project_only_assignment_project_eligibility.sql'))
const mig102       = read(join(migDir, '102_unambiguous_employee_session_punch.sql'))

/** Slice the CREATE OR REPLACE body for record_session_punch in migration 104. */
function punchBody(): string {
  const start = mig104.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch(')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = mig104.indexOf('COMMENT ON FUNCTION public.record_session_punch')
  expect(end).toBeGreaterThan(start)
  return mig104.slice(start, end)
}

function projectOnlyBranch(): string {
  const body = punchBody()
  const marker = '-- ── PROJECT-ONLY MODE'
  const start = body.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const insertMarker = '-- Insert new session'
  const end = body.indexOf(insertMarker, start)
  expect(end).toBeGreaterThan(start)
  return body.slice(start, end)
}

function pathBFallback(): string {
  const branch = projectOnlyBranch()
  const marker = '-- Path B: assignment-backed Project eligibility'
  const start = branch.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  return branch.slice(start)
}

function pathABlock(): string {
  const branch = projectOnlyBranch()
  const start = branch.indexOf('IF v_project_json IS NOT NULL THEN')
  const end = branch.indexOf('-- Path B: assignment-backed Project eligibility')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return branch.slice(start, end)
}

function assignmentBranch(): string {
  const body = punchBody()
  const start = body.indexOf('-- ── ASSIGNMENT MODE')
  const end = body.indexOf('-- ── PROJECT-ONLY MODE')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return body.slice(start, end)
}

function lunchOutBlock(): string {
  const body = punchBody()
  const start = body.indexOf("IF p_action = 'lunch_out' THEN")
  const end = body.indexOf("ELSIF p_action = 'lunch_in' THEN")
  return body.slice(start, end)
}

function lunchInBlock(): string {
  const body = punchBody()
  const start = body.indexOf("ELSIF p_action = 'lunch_in' THEN")
  const end = body.indexOf("ELSIF p_action = 'clock_out' THEN")
  return body.slice(start, end)
}

function clockOutBlock(): string {
  const body = punchBody()
  const start = body.indexOf("ELSIF p_action = 'clock_out' THEN")
  const end = body.indexOf('INSERT INTO time_punch_events (', start)
  return body.slice(start, end)
}

// ── File / structure ─────────────────────────────────────────────────────────

describe('migration 104 file', () => {
  it('exists as 104_project_only_ownerless_assignment_fallback.sql', () => {
    expect(existsSync(mig104Path)).toBe(true)
  })

  it('is wrapped in BEGIN/COMMIT', () => {
    expect(mig104).toContain('BEGIN;')
    expect(mig104).toContain('COMMIT;')
  })

  it('CREATE OR REPLACE only the canonical three-arg record_session_punch', () => {
    expect(mig104).toContain('CREATE OR REPLACE FUNCTION public.record_session_punch(')
    expect(mig104).toContain('p_action        TEXT')
    expect(mig104).toContain('p_assignment_id UUID DEFAULT NULL')
    expect(mig104).toContain('p_project_id    TEXT DEFAULT NULL')
    expect(mig104).toContain('SECURITY DEFINER')
    expect(mig104).toContain('SET search_path = public')
    const creates = mig104.match(
      /CREATE OR REPLACE FUNCTION public\.record_session_punch\(/g
    )
    expect(creates).toHaveLength(1)
  })

  it('makes no table or data changes', () => {
    expect(mig104).not.toContain('ALTER TABLE')
    expect(mig104).not.toContain('CREATE TABLE')
    expect(mig104).not.toContain('DROP TABLE')
    expect(mig104).not.toContain('DELETE FROM')
    expect(mig104).toContain('-- No table or data changes.')
    const outsideFn =
      mig104.slice(0, mig104.indexOf('AS $$')) +
      mig104.slice(mig104.lastIndexOf('$$;') + 3)
    expect(outsideFn).not.toMatch(/\bUPDATE\b/i)
    expect(outsideFn).not.toMatch(/\bINSERT INTO\b/i)
  })

  it('revokes PUBLIC and anon, grants authenticated', () => {
    expect(mig104).toContain(
      'REVOKE ALL ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) FROM PUBLIC'
    )
    expect(mig104).toContain(
      'REVOKE EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) FROM anon'
    )
    expect(mig104).toContain(
      'GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) TO authenticated'
    )
  })
})

// ── Early owner_id abort removed ─────────────────────────────────────────────

describe('owner_id-null early abort removed', () => {
  it('does not raise Organization owner not configured', () => {
    // Executable function body must not RAISE this; header comments may mention it
    expect(punchBody()).not.toContain("RAISE EXCEPTION 'Organization owner not configured'")
    expect(projectOnlyBranch()).not.toContain("RAISE EXCEPTION 'Organization owner not configured'")
  })

  it('does not abort with IF v_owner_id IS NULL THEN before Path B', () => {
    const branch = projectOnlyBranch()
    expect(branch).not.toContain('IF v_owner_id IS NULL THEN')
    expect(branch).toContain('IF v_owner_id IS NOT NULL THEN')
  })
})

// ── 1–2. owner_id null → Path B ──────────────────────────────────────────────

describe('1–2. owner_id null reaches Path B', () => {
  it('1. owner_id null + eligible assignment → Path B accepted (no early abort)', () => {
    const branch = projectOnlyBranch()
    // App_state only when owner present; else fall through to Path B
    expect(branch).toContain('v_project_json := NULL')
    expect(branch).toContain('IF v_owner_id IS NOT NULL THEN')
    expect(branch).toContain('IF v_project_json IS NOT NULL THEN')
    const pathB = pathBFallback()
    expect(pathB).toContain('FROM public.employee_task_assignments t')
    expect(pathB).toContain('t.org_id = v_org_id')
    expect(pathB).toContain('t.project_id = p_project_id')
    expect(pathB).toContain("t.status IN ('assigned', 'in_progress')")
    expect(pathB).toContain('v_profile.id = ANY(t.assigned_employee_ids)')
  })

  it('2. owner_id null + no eligible assignment → rejected', () => {
    const pathB = pathBFallback()
    expect(pathB).toContain('IF v_assignment.id IS NULL THEN')
    expect(pathB).toContain(
      'Project not found, not active, or not available to this employee'
    )
  })
})

// ── 3–5. owner_id present Path A / miss → Path B ─────────────────────────────

describe('3–5. owner_id present — Path A or Path B', () => {
  it('3. owner_id present + active app_state Project → Path A accepted', () => {
    const branch = projectOnlyBranch()
    expect(branch).toContain('IF v_owner_id IS NOT NULL THEN')
    expect(branch).toContain("ast.state_key = 'poweron_v2'")
    expect(branch).toContain("sub.proj->>'id' = p_project_id")
    const pathA = pathABlock()
    expect(pathA).toContain('v_project_ref_id := p_project_id')
    expect(pathA).toContain("v_project_name   := v_project_json->>'name'")
    expect(pathA).toContain('v_assignment_id  := NULL')
  })

  it('4. owner_id present + app_state miss + eligible assignment → Path B', () => {
    const branch = projectOnlyBranch()
    // After Path A attempt, ELSE is Path B
    expect(branch).toContain('IF v_project_json IS NOT NULL THEN')
    expect(pathBFallback()).toContain('t.project_id = p_project_id')
  })

  it('5. owner_id present + app_state miss + no eligible assignment → rejected', () => {
    expect(pathBFallback()).toContain(
      'Project not found, not active, or not available to this employee'
    )
  })
})

// ── 6–8. Security rejections ─────────────────────────────────────────────────

describe('6–8. Security rejections for Path B', () => {
  it('6. assignment belonging only to another employee is rejected', () => {
    expect(pathBFallback()).toContain('v_profile.id = ANY(t.assigned_employee_ids)')
  })

  it('7. assignment from another organization is rejected', () => {
    expect(pathBFallback()).toContain('t.org_id = v_org_id')
  })

  it('8. completed/ineligible assignment is rejected', () => {
    const fallback = pathBFallback()
    expect(fallback).toContain("t.status IN ('assigned', 'in_progress')")
    expect(fallback).not.toContain("'completed'")
    expect(fallback).not.toMatch(/t\.status\s+IN\s*\([^)]*'cancelled'/)
  })
})

// ── 9–12. Path B session fields ──────────────────────────────────────────────

describe('9–12. Path B session field contracts', () => {
  it('9. Path B keeps assignment_id NULL', () => {
    const fallback = pathBFallback()
    expect(fallback).toContain('v_assignment_id  := NULL')
    expect(fallback).not.toContain('v_assignment_id  := v_assignment.id')
  })

  it('10. Path B keeps work_package_name NULL', () => {
    expect(pathBFallback()).toContain('v_work_pkg_name  := NULL')
  })

  it('11. canonical project_id stored unchanged', () => {
    const fallback = pathBFallback()
    expect(fallback).toContain('v_project_ref_id := p_project_id')
    expect(fallback).not.toContain('public.projects')
    expect(fallback).not.toContain('::uuid')
  })

  it('12. project_name comes from the eligible assignment', () => {
    const fallback = pathBFallback()
    expect(fallback).toContain('v_project_name   := v_assignment.project_name')
    expect(fallback).not.toContain('t.project_name =')
  })
})

// ── 13–16. Assignment / lunch / clock_out unchanged ───────────────────────────

describe('13–16. Assignment Clock In and later punches unchanged', () => {
  it('13. assignment Clock In still validates and attaches assignment', () => {
    const branch = assignmentBranch()
    expect(branch).toContain('t.id = p_assignment_id')
    expect(branch).toContain('t.org_id = v_org_id')
    expect(branch).toContain("t.status IN ('assigned', 'in_progress')")
    expect(branch).toContain('v_profile.id = ANY(t.assigned_employee_ids)')
    expect(branch).toContain('v_assignment_id  := v_assignment.id')
    expect(branch).toContain('v_work_pkg_name  := v_assignment.work_package_name')
    expect(branch).toContain('Assignment not found or not eligible')
  })

  it('14. lunch_out unchanged', () => {
    const block = lunchOutBlock()
    expect(block).toContain('SET lunch_out_at = v_now')
    expect(block).toContain('Lunch already started for this session')
  })

  it('15. lunch_in unchanged', () => {
    const block = lunchInBlock()
    expect(block).toContain('SET lunch_in_at = v_now')
    expect(block).toContain('Must start lunch before ending it')
  })

  it('16. clock_out unchanged', () => {
    const block = clockOutBlock()
    expect(block).toContain('clock_out_at  = v_now')
    expect(block).toContain('total_minutes = v_total_mins')
    expect(block).toContain('lunch_minutes = v_lunch_mins')
    expect(block).toContain('paid_minutes  = v_paid_mins')
    expect(block).toContain("status        = 'complete'")
    expect(block).toContain('clock_out not allowed: lunch started but not ended')
  })

  it('preserves duplicate and one-active-session guards', () => {
    const body = punchBody()
    expect(body).toContain('Duplicate clock_in: wait 60 seconds')
    expect(body).toContain('unique_violation')
    expect(body).toContain('An active session already exists')
  })
})

// ── 17. Single overload ──────────────────────────────────────────────────────

describe('17. Exactly one record_session_punch overload remains', () => {
  it('migration 104 only defines (TEXT, UUID, TEXT)', () => {
    expect(mig104).toContain('p_project_id    TEXT DEFAULT NULL')
    expect(mig104).toContain(
      'GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) TO authenticated'
    )
    expect(mig104).not.toContain(
      'GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID) TO authenticated'
    )
  })

  it('migration 102 still drops the obsolete 2-arg overload', () => {
    expect(mig102).toContain('DROP FUNCTION IF EXISTS public.record_session_punch(TEXT, UUID)')
  })
})

// ── 18. Migration guard — allow 104, reject 105+ ─────────────────────────────

describe('18. Migration guard allows 104 and rejects 105+', () => {
  it('migration 104 exists', () => {
    expect(existsSync(mig104Path)).toBe(true)
  })

  it('migrations 097–103 remain present and 103 is untouched historically', () => {
    expect(existsSync(join(migDir, '097_employee_punch_edit_requests.sql'))).toBe(true)
    expect(existsSync(join(migDir, '103_project_only_assignment_project_eligibility.sql'))).toBe(true)
    // 103 still has the early owner abort (immutable historical record)
    expect(mig103).toContain('Organization owner not configured')
    expect(mig103).toContain('IF v_owner_id IS NULL THEN')
  })

  it('no migrations beyond 118 exist', () => {
    const migrations = readdirSync(migDir)
    const beyondExpected = migrations
      .filter((name: string) => /^1\d\d_/.test(name))
      .filter(
        (name: string) =>
          !name.startsWith('100_') &&
          !name.startsWith('101_') &&
          !name.startsWith('102_') &&
          !name.startsWith('103_') &&
          !name.startsWith('104_') &&
          !name.startsWith('105_') &&
          !name.startsWith('106_') &&
          !name.startsWith('107_') &&
          !name.startsWith('108_') &&
        !name.startsWith('109_') &&
        !name.startsWith('110_') &&
        !name.startsWith('111_') &&
        !name.startsWith('112_') &&
        !name.startsWith('113_') &&
        !name.startsWith('114_') &&
        !name.startsWith('115_') &&
        !name.startsWith('116_') &&
        !name.startsWith('117_') &&
        !name.startsWith('118_')
      )
    expect(migrations).toContain('117_pilot_telemetry.sql')
    expect(migrations).toContain('118_pilot_telemetry_hardening.sql')
    expect(beyondExpected).toEqual([])
  })
})
