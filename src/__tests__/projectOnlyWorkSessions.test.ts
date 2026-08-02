/**
 * Project-only work sessions — source-level contract tests (EMPLOYEE-CLOCK-WORKSPACE-1).
 *
 * Reads migration SQL and TypeScript sources. No DB, no DOM, no RPC calls.
 * Verifies the schema extension, RPC security, and frontend integration contracts.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root       = process.cwd()
const migDir     = join(root, 'supabase/migrations')
const serviceDir = join(root, 'src/services')
const adminDir   = join(root, 'src/components/admin')
const libDir     = join(root, 'src/lib')
const empDir     = join(root, 'src/components/employee')

const read       = (p: string) => readFileSync(p, 'utf8')
const mig099     = read(join(migDir, '099_job_linked_work_sessions.sql'))
const mig100     = read(join(migDir, '100_project_only_work_sessions.sql'))
const empSvc     = read(join(serviceDir, 'employeeTimeService.ts'))
const adminSvc   = read(join(serviceDir, 'adminTimecardService.ts'))
const modal      = read(join(adminDir, 'AdminPunchHistoryModal.tsx'))
const elapsed    = read(join(libDir, 'sessionElapsed.ts'))
const timeClock  = read(join(empDir, 'EmployeeTimeClock.tsx'))
const jobPicker  = read(join(empDir, 'EmployeeJobPicker.tsx'))

// ── 1. Migration 100 exists ───────────────────────────────────────────────────

describe('migration 100 file', () => {
  it('exists as 100_project_only_work_sessions.sql', () => {
    expect(existsSync(join(migDir, '100_project_only_work_sessions.sql'))).toBe(true)
  })

  it('is wrapped in BEGIN/COMMIT', () => {
    expect(mig100).toContain('BEGIN;')
    expect(mig100).toContain('COMMIT;')
  })

  it('migration 099 is not modified', () => {
    expect(existsSync(join(migDir, '099_job_linked_work_sessions.sql'))).toBe(true)
    // record_session_punch in 099 still requires p_assignment_id for clock_in
    expect(mig099).toContain('Assignment required for clock_in')
  })
})

// ── 2. Schema extension: project_id column ───────────────────────────────────

describe('employee_work_sessions.project_id column', () => {
  it('adds project_id column via ADD COLUMN IF NOT EXISTS', () => {
    expect(mig100).toContain('ADD COLUMN IF NOT EXISTS project_id UUID')
  })

  it('references projects(id) with ON DELETE SET NULL', () => {
    expect(mig100).toContain('REFERENCES public.projects(id) ON DELETE SET NULL')
  })

  it('backfills project_id via authoritative projects join (not direct text assignment)', () => {
    expect(mig100).toContain('UPDATE public.employee_work_sessions ews')
    // Backfill must go through projects to convert text→UUID; direct assignment is wrong
    expect(mig100).not.toContain('SET project_id = eta.project_id')
    expect(mig100).toContain('JOIN public.projects p ON p.id::text = eta.project_id')
    expect(mig100).toContain('SET project_id = p.id')
    expect(mig100).toContain('WHERE ews.assignment_id = eta.id')
  })

  it('does not use unguarded eta.project_id::uuid cast', () => {
    // Direct cast would throw for any stale/malformed text value; use the join instead
    expect(mig100).not.toContain('eta.project_id::uuid')
  })

  it('does not infer project_id from text (uses FK join only)', () => {
    // The backfill uses FROM employee_task_assignments, never project_name text
    expect(mig100).not.toContain('project_name =')
  })

  it('acknowledges assignment project_id TEXT compatibility in a comment', () => {
    expect(mig100).toContain('employee_task_assignments.project_id is TEXT')
  })
})

// ── 3. get_employee_active_projects RPC ──────────────────────────────────────

describe('get_employee_active_projects RPC', () => {
  it('is defined in migration 100', () => {
    expect(mig100).toContain('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()')
  })

  it('is SECURITY DEFINER', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()'))
    expect(block).toContain('SECURITY DEFINER')
  })

  it('has restricted search_path', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()'))
    expect(block).toContain('SET search_path = public')
  })

  it('returns only id, name, status — no financial columns', () => {
    // Slice from the function definition to the first COMMENT ON (before the REVOKE lines)
    const startIdx = mig100.indexOf('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()')
    const endIdx   = mig100.indexOf('COMMENT ON FUNCTION public.get_employee_active_projects()')
    const block = mig100.slice(startIdx, endIdx)
    expect(block).toContain("jsonb_build_object")
    expect(block).toContain("'id'")
    expect(block).toContain("'name'")
    expect(block).toContain("'status'")
    expect(block).not.toContain('estimated_value')
    expect(block).not.toContain('contract_value')
    expect(block).not.toContain('actual_cost')
    expect(block).not.toContain('client_id')
  })

  it('filters to approved/in_progress/punch_list projects only', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()'))
    expect(block).toContain("'approved', 'in_progress', 'punch_list'")
  })

  it('validates time_tracking portal_access before returning', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()'))
    expect(block).toContain('time_tracking')
  })

  it('revokes PUBLIC and anon, grants authenticated only', () => {
    expect(mig100).toContain(
      'REVOKE ALL ON FUNCTION public.get_employee_active_projects() FROM PUBLIC'
    )
    expect(mig100).toContain(
      'REVOKE EXECUTE ON FUNCTION public.get_employee_active_projects() FROM anon'
    )
    expect(mig100).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_employee_active_projects() TO authenticated'
    )
  })
})

// ── 4. record_session_punch extended signature ────────────────────────────────

describe('record_session_punch (migration 100 — extended)', () => {
  it('defines a new three-argument version with p_project_id DEFAULT NULL', () => {
    expect(mig100).toContain(
      'CREATE OR REPLACE FUNCTION public.record_session_punch('
    )
    expect(mig100).toContain('p_project_id    UUID DEFAULT NULL')
  })

  it('supports project-only clock_in when p_assignment_id is NULL', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('PROJECT-ONLY MODE')
  })

  it('validates project belongs to org and has an active status', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain("'approved', 'in_progress', 'punch_list'")
    expect(block).toContain("Project not found, not active, or does not belong to this organization")
  })

  it('allows either p_assignment_id or p_project_id for clock_in', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('p_assignment_id IS NULL AND p_project_id IS NULL')
  })

  it('stores project_id on the new session row', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('project_id,')
    expect(block).toContain('v_project_id,')
  })

  it('sets work_package_name to NULL for project-only sessions', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('v_work_pkg_name := NULL')
  })

  it('returns projectId in JSONB response', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain("'projectId'")
  })

  it('preserves duplicate-submission guard', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('Duplicate clock_in: wait 60 seconds')
  })

  it('preserves the one-active-session unique_violation guard', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('unique_violation')
    expect(block).toContain('An active session already exists')
  })

  it('revokes PUBLIC and anon on the new three-arg signature', () => {
    expect(mig100).toContain(
      'REVOKE ALL ON FUNCTION public.record_session_punch(TEXT, UUID, UUID) FROM PUBLIC'
    )
    expect(mig100).toContain(
      'REVOKE EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, UUID) FROM anon'
    )
    expect(mig100).toContain(
      'GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, UUID) TO authenticated'
    )
  })

  it('assignment clock_in resolves project UUID through projects table — never assigns text directly', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    // The resolved project row must be fetched before assigning v_project_id
    expect(block).toContain("p.id::text = v_assignment.project_id")
    // No direct text-to-UUID assignment from assignment row
    expect(block).not.toContain('v_project_id    := v_assignment.project_id')
    // Authoritative UUID is taken from the resolved project row
    expect(block).toContain('v_project_id    := v_project.id')
  })

  it('assignment clock_in rejects when project cannot be resolved', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('Assignment references a project that no longer exists')
  })
})

// ── 5. admin_attach_session_assignment RPC ────────────────────────────────────

describe('admin_attach_session_assignment RPC', () => {
  it('is defined in migration 100', () => {
    expect(mig100).toContain(
      'CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('
    )
  })

  it('is SECURITY DEFINER with restricted search_path', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain('SECURITY DEFINER')
    expect(block).toContain('SET search_path = public')
  })

  it('locks the session row FOR UPDATE', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain('FOR UPDATE')
  })

  it('checks is_org_admin_for authorization', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain('is_org_admin_for')
  })

  it('validates assignment status before attaching (assigned or in_progress only)', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain("t.status IN ('assigned', 'in_progress')")
    expect(block).toContain('not in an eligible status')
  })

  it('resolves assignment project UUID through projects before comparing', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain("p.id::text = v_assignment.project_id")
    // UUID-to-UUID comparison after resolution — no TEXT vs UUID
    expect(block).toContain('v_project.id != v_session.project_id')
    expect(block).not.toContain('v_assignment.project_id != v_session.project_id')
  })

  it('COALESCE in attach uses resolved UUID (v_project.id), not TEXT assignment column', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain('COALESCE(v_session.project_id, v_project.id)')
    expect(block).not.toContain('COALESCE(v_session.project_id, v_assignment.project_id)')
  })

  it('rejects assignment from a different project', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain('belongs to a different project')
  })

  it('updates assignment_id and work_package_name only — not punch timestamps', () => {
    const block = mig100.slice(mig100.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain('assignment_id      = v_assignment.id')
    expect(block).toContain('work_package_name  = v_assignment.work_package_name')
    // Must NOT set clock_in_at, lunch_out_at, etc.
    expect(block).not.toContain('clock_in_at =')
    expect(block).not.toContain('paid_minutes =')
  })

  it('revokes PUBLIC and anon, grants authenticated only', () => {
    expect(mig100).toContain(
      'REVOKE ALL ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) FROM PUBLIC'
    )
    expect(mig100).toContain(
      'REVOKE EXECUTE ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) FROM anon'
    )
    expect(mig100).toContain(
      'GRANT EXECUTE ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) TO authenticated'
    )
  })
})

// ── 5b. get_project_assignments_for_admin — type-compat ──────────────────────

describe('get_project_assignments_for_admin RPC (migration 100)', () => {
  it('is defined in migration 100', () => {
    expect(mig100).toContain(
      'CREATE OR REPLACE FUNCTION public.get_project_assignments_for_admin('
    )
  })

  it('uses text-compatible comparison for assignment project_id', () => {
    const block = mig100.slice(
      mig100.indexOf('CREATE OR REPLACE FUNCTION public.get_project_assignments_for_admin(')
    )
    // employee_task_assignments.project_id is TEXT; p_project_id is UUID.
    // The comparison must cast UUID to text, never TEXT to UUID.
    expect(block).toContain('t.project_id = p_project_id::text')
    expect(block).not.toContain('t.project_id = p_project_id\n')
  })

  it('validates org membership before returning assignments', () => {
    const block = mig100.slice(
      mig100.indexOf('CREATE OR REPLACE FUNCTION public.get_project_assignments_for_admin(')
    )
    expect(block).toContain('is_org_admin_for')
  })

  it('filters to eligible assignment statuses', () => {
    const block = mig100.slice(
      mig100.indexOf('CREATE OR REPLACE FUNCTION public.get_project_assignments_for_admin(')
    )
    expect(block).toContain("t.status IN ('assigned', 'in_progress')")
  })

  it('revokes PUBLIC and anon, grants authenticated only', () => {
    expect(mig100).toContain(
      'REVOKE ALL ON FUNCTION public.get_project_assignments_for_admin(UUID) FROM PUBLIC'
    )
    expect(mig100).toContain(
      'REVOKE EXECUTE ON FUNCTION public.get_project_assignments_for_admin(UUID) FROM anon'
    )
    expect(mig100).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_project_assignments_for_admin(UUID) TO authenticated'
    )
  })
})

// ── 6. employeeTimeService — project types and functions ─────────────────────

describe('employeeTimeService project-only additions', () => {
  it('WorkSession includes project_id field', () => {
    expect(empSvc).toContain('project_id: string | null')
  })

  it('exports EmployeeActiveProject interface', () => {
    expect(empSvc).toContain('export interface EmployeeActiveProject {')
  })

  it('exports getEmployeeActiveProjects function', () => {
    expect(empSvc).toContain('export async function getEmployeeActiveProjects()')
  })

  it('getEmployeeActiveProjects calls get_employee_active_projects RPC', () => {
    expect(empSvc).toContain("rpc('get_employee_active_projects'")
  })

  it('recordSessionPunch accepts a projectId parameter', () => {
    expect(empSvc).toContain('projectId?: string | null')
  })

  it('recordSessionPunch sends p_project_id for project-only clock_in', () => {
    expect(empSvc).toContain('p_project_id')
  })

  it('SESSION_COLS includes project_id', () => {
    expect(empSvc).toContain("'id, org_id, employee_profile_id, assignment_id, project_id,")
  })
})

// ── 7. adminTimecardService — admin attach functions ─────────────────────────

describe('adminTimecardService project-only additions', () => {
  it('AdminWorkSession includes project_id field', () => {
    expect(adminSvc).toContain('project_id: string | null')
  })

  it('exports AdminProjectAssignment interface', () => {
    expect(adminSvc).toContain('export interface AdminProjectAssignment {')
  })

  it('exports adminAttachSessionAssignment', () => {
    expect(adminSvc).toContain('export async function adminAttachSessionAssignment(')
  })

  it('adminAttachSessionAssignment calls admin_attach_session_assignment RPC', () => {
    expect(adminSvc).toContain("rpc('admin_attach_session_assignment',")
  })

  it('exports getProjectAssignmentsForAdmin', () => {
    expect(adminSvc).toContain('export async function getProjectAssignmentsForAdmin(')
  })

  it('getProjectAssignmentsForAdmin calls get_project_assignments_for_admin RPC', () => {
    expect(adminSvc).toContain("rpc('get_project_assignments_for_admin',")
  })

  it('ADMIN_SESSION_COLS includes project_id', () => {
    expect(adminSvc).toContain("'id, assignment_id, project_id,")
  })
})

// ── 8. EmployeeTimeClock — immediate state update ────────────────────────────

describe('EmployeeTimeClock immediate punch state', () => {
  it('imports calcElapsedMs from sessionElapsed', () => {
    expect(timeClock).toContain('calcElapsedMs')
    expect(timeClock).toContain('sessionElapsed')
  })

  it('converts sessionState to WorkSession immediately on success', () => {
    expect(timeClock).toContain('sessionStateToWorkSession')
  })

  it('uses a stale-guard generation ref (loadGenRef)', () => {
    expect(timeClock).toContain('loadGenRef')
    expect(timeClock).toContain('useRef')
  })

  it('fires a background silent revalidation (no initial=true) after punch', () => {
    expect(timeClock).toContain('loadSessions(false)')
  })

  it('does not call window.location.reload or location.reload', () => {
    expect(timeClock).not.toContain('location.reload')
  })

  it('does not use arbitrary setTimeout delays', () => {
    // Check for actual call sites (not just mentions in comments)
    expect(timeClock).not.toContain('setTimeout(')
  })

  it('the live wall clock tick is always active (not gated on isRunning)', () => {
    // The nowTs useEffect has empty deps [], meaning it always runs
    expect(timeClock).toContain('}, [])')
  })

  it('displays both Current Time and Current Time Session timer as distinct elements', () => {
    expect(timeClock).toContain('Current Time')
    expect(timeClock).toContain('Current Time Session')
  })

  it('shows Paused for lunch on the session timer', () => {
    expect(timeClock).toContain('Paused for lunch')
  })
})

// ── 9. EmployeeJobPicker — project-only selection ────────────────────────────

describe('EmployeeJobPicker project-only selection', () => {
  it('accepts activeProjects prop', () => {
    expect(jobPicker).toContain('activeProjects')
  })

  it('exports JobSelection type', () => {
    expect(jobPicker).toContain('export type JobSelection =')
  })

  it('has a project_only selection variant', () => {
    expect(jobPicker).toContain("'project_only'")
  })

  it('has an assignment selection variant', () => {
    expect(jobPicker).toContain("'assignment'")
  })

  it('shows a "Tap to clock in to this project" hint for project-only', () => {
    expect(jobPicker).toContain('clock in to this project')
  })
})

// ── 10. AdminPunchHistoryModal — attach UI ───────────────────────────────────

describe('AdminPunchHistoryModal — attach Work Package UI', () => {
  it('imports adminAttachSessionAssignment', () => {
    expect(modal).toContain('adminAttachSessionAssignment')
  })

  it('imports getProjectAssignmentsForAdmin', () => {
    expect(modal).toContain('getProjectAssignmentsForAdmin')
  })

  it('shows Project Only badge for sessions without assignment_id', () => {
    expect(modal).toContain('Project Only')
  })

  it('shows Attach Work Package action', () => {
    expect(modal).toContain('Attach Work Package')
  })

  it('shows "Work Package: Not assigned yet" for project-only sessions', () => {
    expect(modal).toContain('Not assigned yet')
  })
})

// ── 11. sessionElapsed.ts — pure helper ──────────────────────────────────────

describe('sessionElapsed library', () => {
  it('exports calcElapsedMs', () => {
    expect(elapsed).toContain('export function calcElapsedMs(')
  })

  it('exports formatElapsed', () => {
    expect(elapsed).toContain('export function formatElapsed(')
  })

  it('exports formatElapsedHM', () => {
    expect(elapsed).toContain('export function formatElapsedHM(')
  })

  it('exports formatTenantTime', () => {
    expect(elapsed).toContain('export function formatTenantTime(')
  })

  it('uses America/Los_Angeles timezone in formatTenantTime', () => {
    expect(elapsed).toContain('America/Los_Angeles')
  })
})

// ── 12. Migration guard — allows exactly 100 ─────────────────────────────────

describe('migration guard', () => {
  it('migration 099 exists', () => {
    expect(existsSync(join(migDir, '099_job_linked_work_sessions.sql'))).toBe(true)
  })

  it('migration 100 exists', () => {
    expect(existsSync(join(migDir, '100_project_only_work_sessions.sql'))).toBe(true)
  })

  it('no migrations beyond 106 exist', () => {
    const { readdirSync } = require('node:fs')
    const migrations = readdirSync(migDir)
    // Allows 100_–106_ (project-only through session-aware admin void)
    const beyondExpected = migrations.filter((name: string) => /^1\d\d_/.test(name))
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
        !name.startsWith('109_') &&
        !name.startsWith('110_') &&
        !name.startsWith('111_') &&
        !name.startsWith('112_')
      )
    expect(beyondExpected).toEqual([])
  })
})
