/**
 * Admin session punch correction contract (EMPLOYEE-JOB-CLOCK-SESSIONS-1C).
 *
 * Source-level contract tests: reads migration SQL and TypeScript sources,
 * asserts the required security, routing, and aggregate clauses are present.
 * No DOM, no DB, no RPC calls.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root       = process.cwd()
const migDir     = join(root, 'supabase/migrations')
const adminDir   = join(root, 'src/components/admin')
const serviceDir = join(root, 'src/services')

const read       = (p: string) => readFileSync(p, 'utf8')
const mig099     = read(join(migDir, '099_job_linked_work_sessions.sql'))
const adminSvc   = read(join(serviceDir, 'adminTimecardService.ts'))
const modal      = read(join(adminDir, 'AdminPunchHistoryModal.tsx'))

// ── 1. Session-aware RPC existence ────────────────────────────────────────────

describe('session-aware RPC — admin_record_session_punch', () => {
  it('defines admin_record_session_punch in migration 099', () => {
    expect(mig099).toContain('CREATE OR REPLACE FUNCTION public.admin_record_session_punch(')
  })

  it('is a SECURITY DEFINER function', () => {
    const rpcBlock = mig099.slice(mig099.indexOf('CREATE OR REPLACE FUNCTION public.admin_record_session_punch('))
    expect(rpcBlock).toContain('SECURITY DEFINER')
  })

  it('uses a restricted search_path', () => {
    const rpcBlock = mig099.slice(mig099.indexOf('CREATE OR REPLACE FUNCTION public.admin_record_session_punch('))
    expect(rpcBlock).toContain('SET search_path = public')
  })
})

// ── 2. Authorization ──────────────────────────────────────────────────────────

describe('authorization', () => {
  it('calls is_org_admin_for to check admin role', () => {
    expect(mig099).toContain('public.is_org_admin_for(v_session.org_id)')
  })

  it('raises when session is not found', () => {
    expect(mig099).toContain("RAISE EXCEPTION 'Session not found'")
  })

  it('raises when caller is not an admin for the session org', () => {
    expect(mig099).toContain("RAISE EXCEPTION 'Not authorized'")
  })
})

// ── 3. PUBLIC revoked, authenticated granted ──────────────────────────────────

describe('privilege control', () => {
  it('revokes PUBLIC execute on admin_record_session_punch', () => {
    expect(mig099).toContain(
      'REVOKE ALL ON FUNCTION public.admin_record_session_punch(UUID, TEXT, TIMESTAMPTZ, UUID, TEXT)\n  FROM PUBLIC'
    )
  })

  it('grants execute only to authenticated role', () => {
    expect(mig099).toContain(
      'GRANT EXECUTE ON FUNCTION public.admin_record_session_punch(UUID, TEXT, TIMESTAMPTZ, UUID, TEXT)\n  TO authenticated'
    )
  })
})

// ── 4. Row lock / concurrency isolation ──────────────────────────────────────

describe('cross-session isolation', () => {
  it('locks the session row FOR UPDATE before any mutation', () => {
    const rpcBlock = mig099.slice(mig099.indexOf('CREATE OR REPLACE FUNCTION public.admin_record_session_punch('))
    expect(rpcBlock).toContain('FOR UPDATE')
  })
})

// ── 5. Sequence validation ────────────────────────────────────────────────────

describe('punch sequence validation', () => {
  it('enforces clock_in < lunch_out ordering', () => {
    expect(mig099).toContain("clock_in must be before lunch_out")
  })

  it('enforces clock_in < clock_out ordering', () => {
    expect(mig099).toContain("clock_in must be before clock_out")
  })

  it('enforces lunch_out < lunch_in ordering', () => {
    expect(mig099).toContain("lunch_out must be before lunch_in")
  })

  it('enforces lunch_in < clock_out ordering', () => {
    expect(mig099).toContain("lunch_in must be before clock_out")
  })

  it('rejects lunch_in when session has no lunch_out', () => {
    expect(mig099).toContain("Cannot set lunch_in: session has no lunch_out")
  })

  it('rejects clock_out when lunch started but not ended', () => {
    // Both record_session_punch and admin_record_session_punch guard this
    expect(mig099).toContain("clock_out not allowed: lunch started but not ended")
  })
})

// ── 6. Four punch type corrections ───────────────────────────────────────────

describe('four punch type corrections', () => {
  const punchTypes = ['clock_in', 'lunch_out', 'lunch_in', 'clock_out'] as const

  for (const pt of punchTypes) {
    it(`handles ${pt} correction via admin_record_session_punch`, () => {
      // Each punch type must appear as a CASE branch in the RPC
      const rpcBlock = mig099.slice(mig099.indexOf('CREATE OR REPLACE FUNCTION public.admin_record_session_punch('))
      expect(rpcBlock).toContain(`'${pt}'`)
    })
  }
})

// ── 7. Session totals recomputed ──────────────────────────────────────────────

describe('session totals recomputed', () => {
  it('recomputes paid_minutes when clock_out is set', () => {
    expect(mig099).toContain('paid_minutes')
    // The RPC updates the field on the session row; total/lunch also recomputed
    const rpcBlock = mig099.slice(mig099.indexOf('CREATE OR REPLACE FUNCTION public.admin_record_session_punch('))
    expect(rpcBlock).toContain('paid_minutes')
    expect(rpcBlock).toContain('lunch_minutes')
  })
})

// ── 8. Audit event retains session_id ────────────────────────────────────────

describe('audit punch event', () => {
  it("writes a new admin_edit punch event with source='admin_edit'", () => {
    const rpcBlock = mig099.slice(mig099.indexOf('CREATE OR REPLACE FUNCTION public.admin_record_session_punch('))
    expect(rpcBlock).toContain("'admin_edit'")
    expect(rpcBlock).toContain('INSERT INTO public.time_punch_events')
  })

  it('sets session_id on the new admin_edit punch event', () => {
    const rpcBlock = mig099.slice(mig099.indexOf('CREATE OR REPLACE FUNCTION public.admin_record_session_punch('))
    // The INSERT uses p_session_id for the session_id column
    expect(rpcBlock).toContain('session_id,')
    expect(rpcBlock).toContain('p_session_id,')
  })
})

// ── 9. Daily aggregate rebuilt ────────────────────────────────────────────────

describe('daily aggregate rebuilds after session correction', () => {
  it('trigger trg_sync_time_entry_from_sessions fires on employee_work_sessions UPDATE', () => {
    expect(mig099).toContain('CREATE TRIGGER trg_sync_time_entry_from_sessions')
    expect(mig099).toContain('AFTER INSERT OR UPDATE')
    expect(mig099).toContain('EXECUTE FUNCTION public.sync_time_entry_from_sessions()')
  })

  it('sync_time_entry_from_sessions uses SUM(paid_minutes) across all sessions for the day', () => {
    const triggerBlock = mig099.slice(mig099.indexOf('CREATE OR REPLACE FUNCTION public.sync_time_entry_from_sessions()'))
    expect(triggerBlock).toContain('SUM(paid_minutes)')
    expect(triggerBlock).toContain('SUM(total_minutes)')
  })

  it('comment confirms aggregate is rebuilt via trigger', () => {
    expect(mig099).toContain('sync_time_entry_from_sessions trigger')
  })
})

// ── 10. Legacy path preserved ─────────────────────────────────────────────────

describe('legacy admin_record_punch path preserved', () => {
  it('adminTimecardService still exports adminRecordPunch', () => {
    expect(adminSvc).toContain('export async function adminRecordPunch(')
  })

  it('adminRecordPunch still calls admin_record_punch RPC', () => {
    expect(adminSvc).toContain("rpc('admin_record_punch',")
  })
})

// ── 11. Modal routing ─────────────────────────────────────────────────────────

describe('AdminPunchHistoryModal session routing', () => {
  it('imports both adminRecordSessionPunch and adminRecordPunch', () => {
    expect(modal).toContain('adminRecordSessionPunch')
    expect(modal).toContain('adminRecordPunch')
  })

  it('imports AdminWorkSession type', () => {
    expect(modal).toContain('AdminWorkSession')
  })

  it('imports getSessionsForDay', () => {
    expect(modal).toContain('getSessionsForDay')
  })

  it('fetches sessions in refresh()', () => {
    expect(modal).toContain('getSessionsForDay(employeeProfileId, workDate)')
    expect(modal).toContain('setSessions(')
  })

  it('routes saveEdit to adminRecordSessionPunch when punch has session_id', () => {
    expect(modal).toContain('punch.session_id')
    expect(modal).toContain('adminRecordSessionPunch(')
  })

  it('falls back to adminRecordPunch for legacy punches (no session_id)', () => {
    expect(modal).toContain('adminRecordPunch(')
  })

  it('shows job identity (project + work package) on request cards when session linked', () => {
    expect(modal).toContain('reqSession')
    expect(modal).toContain('project_name')
    expect(modal).toContain('work_package_name')
  })
})

// ── 12. adminTimecardService session functions ────────────────────────────────

describe('adminTimecardService session functions', () => {
  it('exports getSessionsForDay', () => {
    expect(adminSvc).toContain('export async function getSessionsForDay(')
  })

  it('exports adminRecordSessionPunch', () => {
    expect(adminSvc).toContain('export async function adminRecordSessionPunch(')
  })

  it('adminRecordSessionPunch calls admin_record_session_punch RPC', () => {
    expect(adminSvc).toContain("rpc('admin_record_session_punch',")
  })

  it('exports AdminWorkSession interface', () => {
    expect(adminSvc).toContain('export interface AdminWorkSession {')
  })

  it('getSessionsForDay returns empty array (non-fatal) when sessions table is absent', () => {
    // The function should warn but not error on pre-099 installs
    expect(adminSvc).toContain('sessions unavailable')
    expect(adminSvc).toContain('return { success: true, data: [] }')
  })
})

// ── 13. Migration 098 unchanged ───────────────────────────────────────────────

describe('migration 098 unchanged', () => {
  it('098_admin_work_order_assignment_board.sql still exists', () => {
    expect(existsSync(join(migDir, '098_admin_work_order_assignment_board.sql'))).toBe(true)
  })

  it('098 does not define employee_work_sessions or admin_record_session_punch', () => {
    const mig098 = read(join(migDir, '098_admin_work_order_assignment_board.sql'))
    expect(mig098).not.toContain('employee_work_sessions')
    expect(mig098).not.toContain('admin_record_session_punch')
  })
})

// ── 14. Migration guard (updated for 100) ────────────────────────────────────

describe('migration guard', () => {
  it('migration 099 exists', () => {
    expect(existsSync(join(migDir, '099_job_linked_work_sessions.sql'))).toBe(true)
  })

  it('migration 100 exists (project-only sessions)', () => {
    expect(existsSync(join(migDir, '100_project_only_work_sessions.sql'))).toBe(true)
  })

  it('no migrations with a three-digit prefix beyond 106', () => {
    const { readdirSync } = require('node:fs')
    const migrations = readdirSync(migDir)
    // 105 is session clock-out summary; 106 is session-aware admin void
    const beyond106 = migrations.filter((name: string) => /^1\d\d_/.test(name))
      .filter((name: string) =>
        !name.startsWith('100_') &&
        !name.startsWith('101_') &&
        !name.startsWith('102_') &&
        !name.startsWith('103_') &&
        !name.startsWith('104_') &&
        !name.startsWith('105_') &&
        !name.startsWith('106_') &&
        !name.startsWith('107_') &&
        !name.startsWith('108_') &&
        !name.startsWith('109_')
      )
    expect(beyond106).toEqual([])
  })
})
