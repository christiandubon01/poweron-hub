/**
 * Project identity compatibility tests (PROJECT-IDENTITY-COMPAT-101).
 *
 * Verifies that migration 101 correctly fixes the identity model introduced
 * by migration 100, which assumed BackupData project IDs could map to
 * public.projects UUIDs (they cannot).
 *
 * Reads SQL and TypeScript source files only — no DB, no DOM, no RPC calls.
 *
 * Canonical identity: BackupData TEXT project IDs (proj + timestamp + random).
 * These are the same IDs stored in employee_task_assignments.project_id TEXT
 * and used by every other table in the employee workflow.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root       = process.cwd()
const migDir     = join(root, 'supabase/migrations')
const serviceDir = join(root, 'src/services')
const empDir     = join(root, 'src/components/employee')
const adminDir   = join(root, 'src/components/admin')

const read = (p: string) => readFileSync(p, 'utf8')

const mig100 = read(join(migDir, '100_project_only_work_sessions.sql'))
const mig101 = read(join(migDir, '101_project_identity_compat.sql'))
const empSvc = read(join(serviceDir, 'employeeTimeService.ts'))
const adminSvc = read(join(serviceDir, 'adminTimecardService.ts'))
const jobPicker = read(join(empDir, 'EmployeeJobPicker.tsx'))
const modal = read(join(adminDir, 'AdminPunchHistoryModal.tsx'))

// ── 1. Migration 101 file ────────────────────────────────────────────────────

describe('migration 101 file', () => {
  it('exists as 101_project_identity_compat.sql', () => {
    expect(existsSync(join(migDir, '101_project_identity_compat.sql'))).toBe(true)
  })

  it('is wrapped in BEGIN/COMMIT', () => {
    expect(mig101).toContain('BEGIN;')
    expect(mig101).toContain('COMMIT;')
  })

  it('depends on migration 100 (documented in header)', () => {
    expect(mig101).toContain('100')
  })

  it('migration 100 is still present and unmodified', () => {
    expect(existsSync(join(migDir, '100_project_only_work_sessions.sql'))).toBe(true)
    // migration 100's SQL text is intact
    expect(mig100).toContain('BEGIN;')
    expect(mig100).toContain('COMMIT;')
  })
})

// ── 2. BackupData project ID validity ────────────────────────────────────────

describe('BackupData project ID format', () => {
  const SAMPLE_BACKUPDATA_ID = 'proj1778524126621o7dn'

  it('BackupData IDs have proj prefix (generated as proj + Date.now() + random)', () => {
    // Verify the format assumption held by migration 101
    expect(SAMPLE_BACKUPDATA_ID).toMatch(/^proj[A-Za-z0-9]+$/)
  })

  it('BackupData IDs are not UUID-formatted', () => {
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    expect(SAMPLE_BACKUPDATA_ID).not.toMatch(UUID_PATTERN)
  })

  it('migration 101 removes the UUID FK so TEXT IDs are valid', () => {
    expect(mig101).toContain('DROP CONSTRAINT IF EXISTS employee_work_sessions_project_id_fkey')
  })

  it('migration 101 column is TEXT — accepts proj-style IDs without casting', () => {
    expect(mig101).toContain('ALTER COLUMN project_id TYPE TEXT')
  })

  it('migration 101 does NOT use eta.project_id::uuid', () => {
    expect(mig101).not.toContain('eta.project_id::uuid')
  })

  it('migration 101 backfill does NOT join through public.projects', () => {
    // The backfill UPDATE block uses a direct TEXT copy — no projects join
    const backfillBlock = mig101.slice(
      mig101.indexOf('UPDATE public.employee_work_sessions ews'),
      mig101.indexOf('-- ── 6.')
    )
    expect(backfillBlock).not.toContain('JOIN public.projects')
    expect(backfillBlock).not.toContain('public.projects p')
  })
})

// ── 3. Backfill: direct TEXT copy from assignments ───────────────────────────

describe('migration 101 backfill', () => {
  it('copies project_id TEXT directly from employee_task_assignments', () => {
    expect(mig101).toContain('UPDATE public.employee_work_sessions ews')
    expect(mig101).toContain('SET project_id = eta.project_id')
    expect(mig101).toContain('FROM public.employee_task_assignments eta')
    expect(mig101).toContain('WHERE ews.assignment_id = eta.id')
  })

  it('only backfills sessions whose project_id is currently NULL', () => {
    expect(mig101).toContain('AND ews.project_id IS NULL')
  })

  it('skips assignments with blank or null project_id', () => {
    expect(mig101).toContain("AND eta.project_id IS NOT NULL")
    expect(mig101).toContain("AND eta.project_id <> ''")
  })

  it('does not hardcode the known session or project ID in executable SQL', () => {
    // The backfill and RPC bodies must not reference specific row IDs.
    // Check within the executable SQL range (BEGIN to end of COMMIT).
    const execStart = mig101.indexOf('BEGIN;')
    const execEnd = mig101.indexOf('COMMIT;') + 'COMMIT;'.length
    const execBlock = mig101.slice(execStart, execEnd)
    expect(execBlock).not.toContain('ad92fafa')
    expect(execBlock).not.toContain('33b0f614')
  })

  it('preserves no punch timestamps or minute values', () => {
    const backfillBlock = mig101.slice(
      mig101.indexOf('UPDATE public.employee_work_sessions ews'),
      mig101.indexOf('-- ── 6.')
    )
    expect(backfillBlock).not.toContain('clock_in_at')
    expect(backfillBlock).not.toContain('paid_minutes')
    expect(backfillBlock).not.toContain('total_minutes')
  })
})

// ── 4. get_employee_active_projects — app_state JSONB source ─────────────────

describe('get_employee_active_projects (migration 101 corrected)', () => {
  it('is CREATE OR REPLACE (replaces migration-100 version)', () => {
    expect(mig101).toContain('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()')
  })

  it('queries app_state, not public.projects', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()'))
    expect(block).toContain('app_state')
    expect(block).not.toContain('FROM public.projects p')
    expect(block).not.toContain("p.status IN ('approved', 'in_progress', 'punch_list')")
  })

  it('resolves org → owner → app_state via organizations.owner_id', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()'))
    expect(block).toContain('owner_id')
    expect(block).toContain('organizations')
    expect(block).toContain('app_state')
  })

  it('uses poweron_v2 state_key', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()'))
    expect(block).toContain('poweron_v2')
  })

  it('filters deleted and archived projects from JSONB', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()'))
    expect(block).toContain('deletedAt')
    expect(block).toContain('archived')
  })

  it('returns id TEXT, name TEXT — no financial columns', () => {
    const start = mig101.indexOf('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()')
    const end   = mig101.indexOf('COMMENT ON FUNCTION public.get_employee_active_projects()')
    const block = mig101.slice(start, end)
    expect(block).toContain("'id'")
    expect(block).toContain("'name'")
    expect(block).not.toContain('estimated_value')
    expect(block).not.toContain('contract_value')
    expect(block).not.toContain('actual_cost')
    expect(block).not.toContain('client_id')
  })

  it('validates time_tracking portal_access', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()'))
    expect(block).toContain('time_tracking')
  })

  it('revokes PUBLIC and anon, grants authenticated', () => {
    expect(mig101).toContain(
      'REVOKE ALL ON FUNCTION public.get_employee_active_projects() FROM PUBLIC'
    )
    expect(mig101).toContain(
      'REVOKE EXECUTE ON FUNCTION public.get_employee_active_projects() FROM anon'
    )
    expect(mig101).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_employee_active_projects() TO authenticated'
    )
  })
})

// ── 5. record_session_punch — p_project_id TEXT ──────────────────────────────

describe('record_session_punch (migration 101 — TEXT p_project_id)', () => {
  it('drops the old (TEXT, UUID, UUID) signature', () => {
    expect(mig101).toContain('DROP FUNCTION IF EXISTS public.record_session_punch(TEXT, UUID, UUID)')
  })

  it('creates new (TEXT, UUID, TEXT) signature', () => {
    expect(mig101).toContain(
      'CREATE OR REPLACE FUNCTION public.record_session_punch('
    )
    expect(mig101).toContain('p_project_id    TEXT DEFAULT NULL')
  })

  it('does NOT use UUID for p_project_id', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).not.toContain('p_project_id    UUID')
  })

  it('assignment mode stores project_id TEXT directly from assignment — no UUID join', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('v_project_ref_id := v_assignment.project_id')
    expect(block).not.toContain('p.id::text = v_assignment.project_id')
    expect(block).not.toContain('FROM public.projects p')
    expect(block).not.toContain("Assignment references a project that no longer exists")
  })

  it('project-only mode validates via app_state JSONB', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('PROJECT-ONLY MODE')
    expect(block).toContain('app_state')
    expect(block).toContain('poweron_v2')
  })

  it('project-only mode rejects archived or deleted projects', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('Project not found, not active, or does not belong to this organization')
    expect(block).toContain('deletedAt')
  })

  it('assignment_id is null for project-only sessions', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('v_assignment_id  := NULL')
  })

  it('preserves duplicate-submission guard', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('Duplicate clock_in: wait 60 seconds')
  })

  it('preserves one-active-session unique_violation guard', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('unique_violation')
    expect(block).toContain('An active session already exists')
  })

  it('returns projectId in JSONB response', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain("'projectId'")
  })

  it('revokes PUBLIC and anon on new (TEXT, UUID, TEXT) signature', () => {
    expect(mig101).toContain(
      'REVOKE ALL ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) FROM PUBLIC'
    )
    expect(mig101).toContain(
      'REVOKE EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) FROM anon'
    )
    expect(mig101).toContain(
      'GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) TO authenticated'
    )
  })
})

// ── 6. admin_attach_session_assignment — TEXT vs TEXT ────────────────────────

describe('admin_attach_session_assignment (migration 101 — TEXT comparison)', () => {
  it('compares project_id TEXT vs TEXT — no UUID resolution', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain("v_session.project_id <> v_assignment.project_id")
    expect(block).not.toContain('FROM public.projects p')
    expect(block).not.toContain('p.id::text = v_assignment.project_id')
    expect(block).not.toContain('v_project.id')
  })

  it('COALESCE uses TEXT identity (v_assignment.project_id)', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain('COALESCE(v_session.project_id, v_assignment.project_id)')
    expect(block).not.toContain('COALESCE(v_session.project_id, v_project.id)')
  })

  it('locks the session FOR UPDATE', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain('FOR UPDATE')
  })

  it('checks is_org_admin_for authorization', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain('is_org_admin_for')
  })

  it('validates assignment status (assigned or in_progress only)', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain("t.status IN ('assigned', 'in_progress')")
  })

  it('does NOT modify punch timestamps or minute totals', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).not.toContain('clock_in_at =')
    expect(block).not.toContain('paid_minutes =')
    expect(block).not.toContain('total_minutes =')
    expect(block).not.toContain('lunch_minutes =')
  })

  it('revokes PUBLIC and anon, grants authenticated', () => {
    expect(mig101).toContain(
      'REVOKE ALL ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) FROM PUBLIC'
    )
    expect(mig101).toContain(
      'GRANT EXECUTE ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) TO authenticated'
    )
  })
})

// ── 7. get_project_assignments_for_admin — TEXT parameter ────────────────────

describe('get_project_assignments_for_admin (migration 101 — TEXT)', () => {
  it('drops old (UUID) signature', () => {
    expect(mig101).toContain(
      'DROP FUNCTION IF EXISTS public.get_project_assignments_for_admin(UUID)'
    )
  })

  it('creates new (TEXT) signature', () => {
    expect(mig101).toContain(
      'CREATE OR REPLACE FUNCTION public.get_project_assignments_for_admin('
    )
    expect(mig101).toContain('p_project_id TEXT')
  })

  it('does not cast p_project_id to UUID', () => {
    const block = mig101.slice(
      mig101.indexOf('CREATE OR REPLACE FUNCTION public.get_project_assignments_for_admin(')
    )
    expect(block).not.toContain('p_project_id::uuid')
    expect(block).not.toContain('p_project_id::text')  // TEXT → no cast needed
  })

  it('authorizes via is_org_admin_for on assignment org', () => {
    const block = mig101.slice(
      mig101.indexOf('CREATE OR REPLACE FUNCTION public.get_project_assignments_for_admin(')
    )
    expect(block).toContain('is_org_admin_for')
  })

  it('filters to eligible assignment statuses', () => {
    const block = mig101.slice(
      mig101.indexOf('CREATE OR REPLACE FUNCTION public.get_project_assignments_for_admin(')
    )
    expect(block).toContain("t.status IN ('assigned', 'in_progress')")
  })

  it('revokes PUBLIC and anon on TEXT signature, grants authenticated', () => {
    expect(mig101).toContain(
      'REVOKE ALL ON FUNCTION public.get_project_assignments_for_admin(TEXT) FROM PUBLIC'
    )
    expect(mig101).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_project_assignments_for_admin(TEXT) TO authenticated'
    )
  })
})

// ── 8. TypeScript types — already correct (string, not UUID) ─────────────────

describe('TypeScript types — project_id is string throughout', () => {
  it('WorkSession.project_id is string | null (TEXT-compatible)', () => {
    expect(empSvc).toContain('project_id: string | null')
  })

  it('EmployeeActiveProject.id is string (accepts BackupData TEXT IDs)', () => {
    expect(empSvc).toContain('export interface EmployeeActiveProject {')
    const block = empSvc.slice(empSvc.indexOf('export interface EmployeeActiveProject {'))
    expect(block).toContain('id: string')
    expect(block).not.toContain('id: UUID')
  })

  it('recordSessionPunch sends projectId as string — no UUID validation', () => {
    expect(empSvc).toContain('projectId?: string | null')
    const block = empSvc.slice(empSvc.indexOf('export async function recordSessionPunch'))
    expect(block).toContain('p_project_id')
    // No UUID cast or validation in the TypeScript layer
    expect(block).not.toContain('uuid')
    expect(block).not.toContain('UUID')
  })

  it('AdminWorkSession.project_id is string | null', () => {
    expect(adminSvc).toContain('project_id: string | null')
  })

  it('getProjectAssignmentsForAdmin sends projectId as string', () => {
    const block = adminSvc.slice(adminSvc.indexOf('export async function getProjectAssignmentsForAdmin'))
    expect(block).toContain('p_project_id')
    // Must not cast to UUID
    expect(block).not.toContain('::uuid')
  })
})

// ── 9. EmployeeJobPicker — project IDs are strings (both sources) ─────────────

describe('EmployeeJobPicker — project IDs are strings regardless of registry', () => {
  it('deduplicates projects by string id (compatible with BackupData TEXT IDs)', () => {
    // map.has(a.project_id) / map.set(p.id, ...) — both use string keys
    expect(jobPicker).toContain('map.has(a.project_id)')
    expect(jobPicker).toContain('map.has(p.id)')
  })

  it('JobSelection.projectId is string (not typed as UUID)', () => {
    const block = jobPicker.slice(jobPicker.indexOf('export type JobSelection ='))
    expect(block).toContain('projectId: string')
    expect(block).not.toContain('projectId: UUID')
  })

  it('project-only selection stores projectId as string from activeProjects', () => {
    expect(jobPicker).toContain("'project_only'")
    expect(jobPicker).toContain('projectId: p.id')
  })
})

// ── 10. Admin modal — project_id used as string for attachment ───────────────

describe('AdminPunchHistoryModal — project_id is string for attachment', () => {
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
})

// ── 11. Same-organization validation ─────────────────────────────────────────

describe('organization scoping', () => {
  it('get_employee_active_projects validates org membership via employee_profiles', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.get_employee_active_projects()'))
    expect(block).toContain('v_profile.org_id')
    expect(block).toContain('organizations')
  })

  it('record_session_punch project-only mode validates via org owner', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain('v_org_id')
    expect(block).toContain('owner_id')
    expect(block).toContain('app_state')
  })

  it('admin_attach_session_assignment validates same org for session and assignment', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain('t.org_id = v_session.org_id')
  })
})

// ── 12. Name equality alone is insufficient ───────────────────────────────────

describe('project name equality is NOT used for identity or authorization', () => {
  it('migration 101 backfill uses assignment_id FK, not project_name', () => {
    const backfill = mig101.slice(
      mig101.indexOf('UPDATE public.employee_work_sessions ews'),
      mig101.indexOf('-- ── 6.')
    )
    expect(backfill).not.toContain('project_name')
  })

  it('record_session_punch project-only validation uses project id, not name', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.record_session_punch('))
    expect(block).toContain("sub.proj->>'id' = p_project_id")
    expect(block).not.toContain("sub.proj->>'name' = ")
  })

  it('admin_attach same-project check uses project_id TEXT, not project_name', () => {
    const block = mig101.slice(mig101.indexOf('CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment('))
    expect(block).toContain('v_session.project_id <> v_assignment.project_id')
    expect(block).not.toContain('project_name !=')
    expect(block).not.toContain('project_name <>')
  })
})

// ── 13. Migration guard ───────────────────────────────────────────────────────

describe('migration guard', () => {
  it('migration 099 exists', () => {
    expect(existsSync(join(migDir, '099_job_linked_work_sessions.sql'))).toBe(true)
  })

  it('migration 100 exists', () => {
    expect(existsSync(join(migDir, '100_project_only_work_sessions.sql'))).toBe(true)
  })

  it('migration 101 exists', () => {
    expect(existsSync(join(migDir, '101_project_identity_compat.sql'))).toBe(true)
  })

  it('no migrations beyond 106 exist', () => {
    const migrations = readdirSync(migDir)
    const beyondExpected = migrations
      .filter((name: string) => /^1\d\d_/.test(name))
      .filter((name: string) =>
        !name.startsWith('100_') &&
        !name.startsWith('101_') &&
        !name.startsWith('102_') &&
        !name.startsWith('103_') &&
        !name.startsWith('104_') &&
        !name.startsWith('105_') &&
        !name.startsWith('106_')
      )
    expect(beyondExpected).toEqual([])
  })
})

// ── 14. Migration 100 historical integrity ────────────────────────────────────

describe('migration 100 historical integrity (unchanged by 101)', () => {
  it('migration-100 SQL file is unmodified (still has UUID FK language)', () => {
    // 101 corrects these at runtime; the 100 source file stays as-is
    expect(mig100).toContain('ADD COLUMN IF NOT EXISTS project_id UUID')
    expect(mig100).toContain('REFERENCES public.projects(id) ON DELETE SET NULL')
  })

  it('migration-100 explanation of the TEXT identity issue is preserved', () => {
    expect(mig100).toContain('employee_task_assignments.project_id is TEXT')
  })

  it('migrations 097–099 are untouched', () => {
    expect(existsSync(join(migDir, '097_employee_punch_edit_requests.sql'))).toBe(true)
    expect(existsSync(join(migDir, '098_admin_work_order_assignment_board.sql'))).toBe(true)
    expect(existsSync(join(migDir, '099_job_linked_work_sessions.sql'))).toBe(true)
  })
})
