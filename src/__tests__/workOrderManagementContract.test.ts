/**
 * Work Order management contract (migration 109).
 *
 * Classification:
 * - [STATIC SQL] source-string / migration-file contracts (not live Postgres)
 * - [UNIT] Assigned Hours helpers
 * - [COMPONENT SOURCE] admin UI wiring contracts
 *
 * These tests do not execute PostgreSQL as employee/owner/service_role.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyAssignedHoursOverride,
  parseAssignedHoursInput,
  presentAssignedActualVariance,
} from '@/features/work-orders'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const migration109Path = join(process.cwd(), 'supabase/migrations/109_work_order_assigned_hours_archive_delete.sql')
const migration109 = readFileSync(migration109Path, 'utf8')
const service = read('src/services/employeeTaskAssignmentService.ts')
const form = read('src/components/admin/AdminWorkOrderAssignmentForm.tsx')
const board = read('src/components/admin/AdminWorkOrderAssignmentBoard.tsx')
const panel = read('src/components/admin/AdminTaskDelegationPanel.tsx')
const migration093 = read('supabase/migrations/093_assignment_work_order_versions.sql')
const migration099 = read('supabase/migrations/099_job_linked_work_sessions.sql')

function functionBlock(source: string, marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `missing ${marker}`).toBeGreaterThanOrEqual(0)
  const after = source.slice(start)
  const endMarkers = [
    after.indexOf('\nCREATE OR REPLACE FUNCTION', 1),
    after.indexOf('\nDROP FUNCTION', 1),
    after.indexOf('\n-- ── 7. Grants'),
    after.indexOf('\n-- ── 8. Transactional'),
    after.indexOf('\nCOMMIT;'),
  ].filter((index) => index > 0)
  const end = Math.min(...endMarkers)
  return after.slice(0, end)
}

const updateMyTaskBlock = functionBlock(
  migration109,
  'CREATE OR REPLACE FUNCTION public.update_my_employee_task(',
)
const recordPunchBlock = functionBlock(
  migration109,
  'CREATE OR REPLACE FUNCTION public.record_session_punch(',
)
const adminAttachBlock = functionBlock(
  migration109,
  'CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment(',
)
const assertionsBlock = migration109.slice(migration109.indexOf('-- ── 8. Transactional assertions'))

describe('[STATIC SQL] Work Order management migration 109', () => {
  it('is the sole next migration after 108 and no migration 110 exists', () => {
    const migrations = readdirSync(join(process.cwd(), 'supabase/migrations'))
      .filter((name) => /^\d+_/.test(name))
      .sort()
    expect(migrations[migrations.length - 1]).toBe('109_work_order_assigned_hours_archive_delete.sql')
    expect(existsSync(migration109Path)).toBe(true)
    expect(migrations.filter((name) => name.startsWith('110_'))).toHaveLength(0)
    expect(migration109).toContain('BEGIN;')
    expect(migration109).toContain('COMMIT;')
    expect(migrations.filter((name) => name.startsWith('107_') || name.startsWith('108_'))).toHaveLength(2)
  })

  it('reuses payload.labor.totalHours for assigned hours and hours_spent for actual hours', () => {
    expect(migration109).toContain("payload #> '{labor,totalHours}'")
    expect(migration109).toContain("'assigned_hours'")
    expect(service).toContain('applyAssignedHoursOverride')
    expect(service).toContain('hours_spent')
    expect(board).toContain('assignment.hours_spent')
    expect(board).toContain('presentAssignedActualVariance')
  })

  it('keeps permanent delete on revoke with session SET NULL preservation contract', () => {
    expect(migration093).toContain('CREATE OR REPLACE FUNCTION public.revoke_employee_task_assignment')
    expect(migration093).toContain('DELETE FROM public.employee_task_assignments')
    expect(migration099).toContain('ON DELETE SET NULL')
    expect(panel).toContain('revokeTaskAssignment')
    expect(board).toContain('Delete permanently')
    expect(board).toContain('employee time/payroll history are preserved')
  })

  it('authorizes archive/restore/delete as owner/admin SECURITY DEFINER only', () => {
    expect(migration109).toContain('NOT public.is_org_admin_for(v_org_id)')
    expect(migration109).toContain("RAISE EXCEPTION 'Not authorized'")
    expect(migration109).toContain('GRANT EXECUTE ON FUNCTION public.archive_employee_task_assignment')
    expect(migration109).toContain('GRANT EXECUTE ON FUNCTION public.restore_employee_task_assignment')
    expect(migration109).toContain('get_my_employee_tasks')
    expect(migration109).toContain('AND t.archived_at IS NULL')
    expect(service).toContain("rpc('archive_employee_task_assignment'")
    expect(service).toContain("rpc('restore_employee_task_assignment'")
    expect(panel).not.toContain('GRANT EXECUTE')
  })
})

describe('[STATIC SQL] Archive write-boundary on employee/admin RPCs', () => {
  it('update_my_employee_task rejects archived assignments before mutation', () => {
    expect(updateMyTaskBlock).toContain('FOR UPDATE')
    expect(updateMyTaskBlock).toContain('v_row.archived_at IS NOT NULL')
    expect(updateMyTaskBlock).toContain("RAISE EXCEPTION 'Assignment not found'")
    expect(updateMyTaskBlock).toContain('AND archived_at IS NULL')
    expect(updateMyTaskBlock).toContain('p_hours_spent')
    expect(updateMyTaskBlock).toContain('p_completion_notes')
    expect(updateMyTaskBlock).toContain('employee_task_completions')
    // Cross-org and archived share the same controlled message.
    expect(updateMyTaskBlock).toContain('v_row.org_id <> v_profile.org_id OR v_row.archived_at IS NOT NULL')
  })

  it('record_session_punch direct-assignment and project-fallback paths require archived_at IS NULL', () => {
    expect(recordPunchBlock).toContain('p_assignment_id IS NOT NULL')
    expect(recordPunchBlock).toContain("AND t.status IN ('assigned', 'in_progress')")
    const archivedFilters = recordPunchBlock.match(/archived_at IS NULL/g) ?? []
    expect(archivedFilters.length).toBeGreaterThanOrEqual(2)
    expect(recordPunchBlock).toContain("RAISE EXCEPTION 'Assignment not found or not eligible'")
    expect(recordPunchBlock).toContain('t.project_id = p_project_id')
    expect(recordPunchBlock).toContain('v_assignment_id  := NULL')
    // Direct assignment clock-in still binds the Work Package via assignment row.
    expect(recordPunchBlock).toContain('v_work_pkg_name  := v_assignment.work_package_name')
    expect(recordPunchBlock).toContain('FOR UPDATE')
  })

  it('record_session_punch keeps project-only Path A without requiring an active Work Order', () => {
    expect(recordPunchBlock).toContain("ast.state_key = 'poweron_v2'")
    expect(recordPunchBlock).toContain('v_project_json IS NOT NULL')
    expect(recordPunchBlock).toContain('v_assignment_id  := NULL')
    expect(recordPunchBlock).toContain('lunch_out')
    expect(recordPunchBlock).toContain('clock_out')
  })

  it('admin_attach_session_assignment rejects archived attach targets and leaves failed attach unchanged', () => {
    expect(adminAttachBlock).toContain('AND t.archived_at IS NULL')
    expect(adminAttachBlock).toContain('FOR UPDATE')
    expect(adminAttachBlock).toContain("RAISE EXCEPTION 'Assignment not found, belongs to a different organization, or is not in an eligible status'")
    expect(adminAttachBlock).toContain('is_org_admin_for')
    // Attach UPDATE only runs after eligibility; no detach path rewritten here.
    expect(adminAttachBlock).toContain('assignment_id      = v_assignment.id')
    expect(adminAttachBlock).toContain('Punch timestamps and minute totals preserved exactly')
  })

  it('migration postconditions assert archive eligibility on all three write RPCs', () => {
    expect(assertionsBlock).toContain("to_regprocedure('public.update_my_employee_task(uuid,text,text,numeric)')")
    expect(assertionsBlock).toContain("to_regprocedure('public.record_session_punch(text,uuid,text,text)')")
    expect(assertionsBlock).toContain("to_regprocedure('public.admin_attach_session_assignment(uuid,uuid)')")
    expect(assertionsBlock).toContain('pg_get_functiondef')
    expect(assertionsBlock).toContain('update_my_employee_task missing archive eligibility')
    expect(assertionsBlock).toContain('record_session_punch missing archive filters on both assignment paths')
    expect(assertionsBlock).toContain('admin_attach_session_assignment missing archive eligibility')
    expect(assertionsBlock).toContain('legacy 3-arg update_my_employee_task still present')
    expect(assertionsBlock).toContain('get_my_employee_tasks missing archive filter')
    expect(assertionsBlock).toContain('completed-edit RPC missing archived reject')
  })

  it('employee queues stay filtered and no employee-role archive/restore/delete permission is added', () => {
    expect(migration109).toContain('CREATE OR REPLACE FUNCTION public.get_my_employee_tasks()')
    expect(migration109).toContain('CREATE OR REPLACE FUNCTION public.get_my_eligible_assignments()')
    const eligible = functionBlock(migration109, 'CREATE OR REPLACE FUNCTION public.get_my_eligible_assignments(')
    expect(eligible).toContain('AND t.archived_at IS NULL')
    // Grants go to authenticated only; body enforces is_org_admin_for. No employee_role table.
    expect(migration109).not.toContain('CREATE TABLE')
    expect(migration109).toContain('GRANT EXECUTE ON FUNCTION public.archive_employee_task_assignment(UUID, TIMESTAMPTZ) TO authenticated')
    expect(migration109).toContain('REVOKE EXECUTE ON FUNCTION public.archive_employee_task_assignment(UUID, TIMESTAMPTZ) FROM anon')
    expect(service).toContain("rpc('revoke_employee_task_assignment'")
  })
})

describe('[STATIC SQL] Old frontend update_my_employee_task compatibility', () => {
  it('keeps a single 4-arg signature with p_hours_spent DEFAULT NULL and no 3-arg overload', () => {
    expect(updateMyTaskBlock).toContain('p_hours_spent      NUMERIC DEFAULT NULL')
    expect(updateMyTaskBlock).toContain('p_status           TEXT    DEFAULT NULL')
    expect(updateMyTaskBlock).toContain('p_completion_notes TEXT    DEFAULT NULL')
    // p_assignment_id remains required (no DEFAULT) so PostgREST still requires it.
    expect(updateMyTaskBlock).toMatch(/p_assignment_id\s+UUID,/)
    expect(updateMyTaskBlock).not.toMatch(/p_assignment_id\s+UUID\s+DEFAULT/)
    expect(migration109).toContain('DROP FUNCTION IF EXISTS public.update_my_employee_task(UUID, TEXT, TEXT);')
    expect(assertionsBlock).toContain('legacy 3-arg update_my_employee_task still present')
    // Single overload avoids PostgREST AmbiguousRpc when old clients omit p_hours_spent.
    expect(assertionsBlock).toContain("to_regprocedure('public.update_my_employee_task(uuid,text,text,numeric)')")
  })

  it('documents that committed 1b47dfd payloads omit unused optionals and remain PostgREST-resolvable', () => {
    // Exact argument objects posted by buildUpdateMyEmployeeTaskArgs at HEAD 1b47dfd.
    const oldStartTaskPayload = {
      p_assignment_id: '11111111-1111-1111-1111-111111111111',
      p_status: 'in_progress',
    }
    const oldCompleteNotesPayload = {
      p_assignment_id: '11111111-1111-1111-1111-111111111111',
      p_status: 'completed',
      p_completion_notes: 'done',
    }
    const oldCompleteWithHoursPayload = {
      p_assignment_id: '11111111-1111-1111-1111-111111111111',
      p_status: 'completed',
      p_completion_notes: 'done',
      p_hours_spent: 4.5,
    }

    const allowedKeys = new Set(['p_assignment_id', 'p_status', 'p_completion_notes', 'p_hours_spent'])
    const requiredKeys = new Set(['p_assignment_id'])
    const optionalKeys = new Set(['p_status', 'p_completion_notes', 'p_hours_spent'])

    for (const payload of [oldStartTaskPayload, oldCompleteNotesPayload, oldCompleteWithHoursPayload]) {
      const keys = new Set(Object.keys(payload))
      // PostgREST match: (keys - optional) == required
      const withoutOptional = [...keys].filter((key) => !optionalKeys.has(key))
      expect(withoutOptional).toEqual([...requiredKeys])
      expect([...keys].every((key) => allowedKeys.has(key))).toBe(true)
    }

    expect(Object.keys(oldStartTaskPayload)).not.toContain('p_hours_spent')
    expect(Object.keys(oldCompleteNotesPayload)).not.toContain('p_hours_spent')
    expect(Object.keys(oldCompleteWithHoursPayload)).toContain('p_hours_spent')

    // Committed service still builds those shapes (omit unused optionals).
    expect(service).toContain('export function buildUpdateMyEmployeeTaskArgs')
    expect(service).toContain('args.p_hours_spent = hours')
    expect(service).toContain("const args: UpdateMyEmployeeTaskArgs = { p_assignment_id: assignmentId }")

    // Archive eligibility remains in the final function body for every call shape.
    expect(updateMyTaskBlock).toContain('v_row.archived_at IS NOT NULL')
    expect(updateMyTaskBlock).toContain('AND archived_at IS NULL')
  })
})

describe('[UNIT] Assigned hours behavioral contract', () => {
  it('covers create defaults, accepted decimals, rejects, variance, and incomplete actual display', () => {
    expect(parseAssignedHoursInput('')).toEqual({ ok: true, value: null })
    expect(parseAssignedHoursInput('1')).toEqual({ ok: true, value: 1 })
    expect(parseAssignedHoursInput('1.5')).toEqual({ ok: true, value: 1.5 })
    expect(parseAssignedHoursInput('2.25')).toEqual({ ok: true, value: 2.25 })
    expect(parseAssignedHoursInput('-1').ok).toBe(false)
    expect(parseAssignedHoursInput('NaN').ok).toBe(false)
    expect(parseAssignedHoursInput('Infinity').ok).toBe(false)

    const draft = applyAssignedHoursOverride(
      { labor: { roughInHours: 1, trimHours: 1, testingHours: 0, cleanupHours: 0, totalHours: 2 } },
      2.25,
    )
    expect(draft.labor.totalHours).toBe(2.25)
    expect(draft.labor.roughInHours).toBe(1)

    expect(presentAssignedActualVariance({ assignedHours: 4, actualHours: 3 }).varianceLabel).toBe('1h under')
    expect(presentAssignedActualVariance({ assignedHours: 4, actualHours: 5.5 }).varianceLabel).toBe('1.5h over')
    expect(presentAssignedActualVariance({ assignedHours: 4, actualHours: 4 }).varianceLabel).toBe('On target')
    expect(presentAssignedActualVariance({ assignedHours: 4, actualHours: null }).actualLabel).toBe('Not recorded')
  })
})

describe('[COMPONENT SOURCE] Archive / restore / delete UI + completed-edit wiring', () => {
  it('keeps Assigned Hours optional in the assign modal and editable afterward', () => {
    expect(form).toContain('Optional. Leave blank to keep the Work Package labor total')
    expect(form).toContain('type="number"')
    expect(form).toContain('min={0}')
    expect(form).toContain('step={0.25}')
    expect(panel).toContain('assignedHours:')
    expect(panel).toContain("editing.status === 'completed' ? 'completed' : form.status")
    expect(panel).not.toContain("if (assignment.status === 'completed') return")
  })

  it('hides archived rows from active board counts and exposes a dedicated bucket', () => {
    expect(board).toContain('activeAssignments')
    expect(board).toContain('archivedAssignments')
    expect(board).toContain('Archived Work Orders ({archivedAssignments.length})')
    expect(board).toContain('ArchivedWorkOrdersBucket')
    expect(board).toContain('onRestore')
    expect(board).toContain('ConfirmArchiveDialog')
    expect(board).toContain('ConfirmPermanentDeleteDialog')
    expect(board).toContain('Type the Work Order title to confirm')
    expect(board).toContain('presentAssignedActualVariance')
    expect(service).toContain('archiveTaskAssignment')
    expect(service).toContain('restoreTaskAssignment')
  })

  it('preserves completed-edit protection and restore same-ID archive clearing in migration SQL', () => {
    expect(migration109).toContain("v_status := 'completed'")
    expect(migration109).toContain('Archived assignments cannot be edited; restore first')
    expect(migration109).not.toContain('Completed assignments cannot be edited')
    expect(migration109).toContain('archived_at = NULL')
    expect(migration109).toContain('archived_by = NULL')
  })
})
