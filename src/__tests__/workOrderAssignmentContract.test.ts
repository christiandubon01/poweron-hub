import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration093Path = join(process.cwd(), 'supabase/migrations/093_assignment_work_order_versions.sql')
const migration092TaskHoursPath = join(process.cwd(), 'supabase/migrations/092_task_hours_spent.sql')
const migration092WorkOrderPath = join(process.cwd(), 'supabase/migrations/092_assignment_work_order_versions.sql')

const migration093 = readFileSync(
  migration093Path,
  'utf8',
)

const migration089 = readFileSync(
  join(process.cwd(), 'supabase/migrations/089_work_order_snapshot_storage.sql'),
  'utf8',
)

const service = readFileSync(
  join(process.cwd(), 'src/services/employeeTaskAssignmentService.ts'),
  'utf8',
)

const panel = readFileSync(
  join(process.cwd(), 'src/components/admin/AdminTaskDelegationPanel.tsx'),
  'utf8',
)

describe('Work Order assignment migration 093 contract', () => {
  it('uses migration 093 without conflicting with committed task-hours migration 092', () => {
    expect(existsSync(migration093Path)).toBe(true)
    expect(existsSync(migration092TaskHoursPath)).toBe(true)
    expect(existsSync(migration092WorkOrderPath)).toBe(false)
  })

  it('adds assignment idempotency/current-version columns and the immutable versions table', () => {
    expect(migration093).toContain('ADD COLUMN IF NOT EXISTS client_request_id UUID NULL')
    expect(migration093).toContain('ADD COLUMN IF NOT EXISTS current_work_order_version INTEGER NULL')
    expect(migration093).toContain('CREATE TABLE IF NOT EXISTS public.assignment_work_order_versions')
    expect(migration093).toContain('payload JSONB NOT NULL')
    expect(migration093).toContain('created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT')
    expect(migration093).toContain('FOREIGN KEY (org_id, assignment_id)')
    expect(migration093).toContain('REFERENCES public.employee_task_assignments(org_id, id)')
    expect(migration093).toContain('ON DELETE CASCADE')
  })

  it('contains required constraints, indexes, and payload size policy', () => {
    expect(migration093).toContain('assignment_work_order_versions_assignment_version_key UNIQUE (assignment_id, version)')
    expect(migration093).toContain('idx_eta_org_client_request_id')
    expect(migration093).toContain('WHERE client_request_id IS NOT NULL')
    expect(migration093).toContain('CHECK (version >= 1)')
    expect(migration093).toContain('CHECK (schema_version >= 1)')
    expect(migration093).toContain("CHECK (jsonb_typeof(payload) = 'object')")
    expect(migration093).toContain('payload_bytes > 0 AND payload_bytes <= 512000')
    expect(migration093).toContain('idx_awov_assignment_version_desc')
    expect(migration093).toContain('idx_awov_org_created_at_desc')
  })

  it('enforces immutable updates while preserving parent cascade deletes', () => {
    expect(migration093).toContain('CREATE OR REPLACE FUNCTION public.reject_assignment_work_order_version_update()')
    expect(migration093).toContain('BEFORE UPDATE ON public.assignment_work_order_versions')
    expect(migration093).not.toMatch(/BEFORE DELETE ON public\.assignment_work_order_versions/i)
    expect(migration093).toContain('REVOKE ALL ON public.assignment_work_order_versions FROM authenticated')
    expect(migration093).not.toMatch(/FOR DELETE[\s\S]{0,180}assignment_work_order_versions/)
  })

  it('enables owner/admin-only read RLS with no direct authenticated write policies', () => {
    expect(migration093).toContain('ALTER TABLE public.assignment_work_order_versions ENABLE ROW LEVEL SECURITY')
    expect(migration093).toContain('CREATE POLICY awov_owner_admin_select')
    expect(migration093).toContain('FOR SELECT')
    expect(migration093).toContain('public.is_org_admin_for(org_id)')
    expect(migration093).not.toMatch(/CREATE POLICY[\s\S]{0,120}FOR INSERT[\s\S]{0,120}assignment_work_order_versions/i)
    expect(migration093).not.toMatch(/CREATE POLICY[\s\S]{0,120}FOR UPDATE[\s\S]{0,120}assignment_work_order_versions/i)
    expect(migration093).not.toMatch(/CREATE POLICY[\s\S]{0,120}FOR DELETE[\s\S]{0,120}assignment_work_order_versions/i)
  })

  it('defines a locked SECURITY DEFINER RPC with authorization, validation, atomic writes, and idempotency', () => {
    expect(migration093).toContain('CREATE OR REPLACE FUNCTION public.create_employee_task_assignment_with_work_order')
    expect(migration093).toContain('SECURITY DEFINER')
    expect(migration093).toContain('SET search_path = public')
    expect(migration093).toContain('v_uid := auth.uid()')
    expect(migration093).toContain('v_org_id := public.user_org_id()')
    expect(migration093).toContain('NOT public.is_org_admin_for(v_org_id)')
    expect(migration093).toContain('ep.active = true')
    expect(migration093).toContain('p_lead_employee_id = ANY (v_assigned)')
    expect(migration093).toContain('public.validate_assignment_work_order_payload_v1')
    expect(migration093).toContain("p_work_order_payload ? 'schemaVersion'")
    expect(migration093).toContain("'assignmentId'")
    expect(migration093).toContain("'createdBy'")
    expect(migration093).toContain('INSERT INTO public.employee_task_assignments')
    expect(migration093).toContain('INSERT INTO public.assignment_work_order_versions')
    expect(migration093).toContain('SET current_work_order_version = 1')
    expect(migration093).toContain('idempotentReplay')
    expect(migration093).toContain('WHEN unique_violation THEN')
  })

  it('defines a secure parent-delete revoke RPC without broad child DELETE access', () => {
    const revokeStart = migration093.indexOf('CREATE OR REPLACE FUNCTION public.revoke_employee_task_assignment')
    const revokeBody = migration093.slice(revokeStart, migration093.indexOf('COMMENT ON FUNCTION public.revoke_employee_task_assignment'))
    expect(revokeStart).toBeGreaterThan(-1)
    expect(revokeBody).toContain('SECURITY DEFINER')
    expect(revokeBody).toContain('SET search_path = public')
    expect(revokeBody).toContain('v_uid := auth.uid()')
    expect(revokeBody).toContain('v_org_id := public.user_org_id()')
    expect(revokeBody).toContain('NOT public.is_org_admin_for(v_org_id)')
    expect(revokeBody).toContain('WHERE id = p_assignment_id')
    expect(revokeBody).toContain('AND org_id = v_org_id')
    expect(revokeBody).toContain('DELETE FROM public.employee_task_assignments')
    expect(revokeBody).not.toContain('DELETE FROM public.assignment_work_order_versions')
    expect(migration093).toContain('relies on FK cascades')
    expect(migration093).toContain('REVOKE ALL ON FUNCTION public.revoke_employee_task_assignment(UUID) FROM PUBLIC')
    expect(migration093).toContain('GRANT EXECUTE ON FUNCTION public.revoke_employee_task_assignment(UUID) TO authenticated')
    expect(migration093).not.toMatch(/GRANT\s+DELETE\s+ON\s+public\.assignment_work_order_versions\s+TO\s+authenticated/i)
  })

  it('validates payload shape and forbidden fields without altering migration 089', () => {
    expect(migration093).toContain('assignment_work_order_payload_has_forbidden_key')
    expect(migration093).toContain('lead_employee_id')
    expect(migration093).toContain('assignedEmployeeIds')
    expect(migration093).toContain('proposalSummary')
    expect(migration093).toContain('pricing')
    expect(migration093).toContain('rawAnnotations')
    expect(migration093).toContain('animationGraph')
    expect(migration093).toContain('diagnostics')
    expect(migration093).toContain('signedUrl')
    expect(migration093).toContain("jsonb_typeof(p_payload->'items') <> 'array'")
    expect(migration089).toContain('CREATE TABLE IF NOT EXISTS public.assignment_snapshots')
    expect(migration089).not.toContain('assignment_work_order_versions')
  })
})

describe('Work Order assignment service/UI contract', () => {
  it('attempts the atomic create RPC first and only falls back on proven missing-RPC', () => {
    const atomicStart = service.indexOf('export async function createTaskAssignmentWithWorkOrder')
    const atomicBody = service.slice(atomicStart, service.indexOf('export function buildTaskAssignmentWorkOrderDraft'))
    expect(atomicBody).toContain("rpc('create_employee_task_assignment_with_work_order'")
    expect(atomicBody).toContain("isMissingSupabaseRpcError(error, 'create_employee_task_assignment_with_work_order')")
    expect(atomicBody).toContain('createTaskAssignment({')
    expect(atomicBody).toContain('workOrderCreated: false')
    expect(atomicBody).toContain('workOrderCreated: true')
    // No two-step assignment + Work Order browser write.
    expect(atomicBody).not.toContain("from('assignment_work_order_versions')")
    expect(atomicBody).not.toContain('.insert(')
  })

  it('preserves edit behavior and uses secure revoke with legacy delete only on missing RPC', () => {
    expect(service).toContain('export async function updateTaskAssignment')
    expect(service).toContain('export async function revokeTaskAssignment')
    expect(service).toContain('export function isMissingSupabaseRpcError')
    const revokeStart = service.indexOf('export async function revokeTaskAssignment')
    const revokeBody = service.slice(revokeStart, service.indexOf('export async function listAssignableEmployees'))
    expect(revokeBody).toContain("rpc('revoke_employee_task_assignment'")
    expect(revokeBody).toContain("isMissingSupabaseRpcError(error, 'revoke_employee_task_assignment')")
    expect(revokeBody).toContain('.delete()')
    expect(revokeBody).toContain("from('employee_task_assignments')")
    expect(panel).toContain('updateTaskAssignment(editingId')
    expect(panel).toContain('revokeTaskAssignment(id)')
    const editBranch = panel.slice(panel.indexOf('if (editingId)'), panel.indexOf('} else {', panel.indexOf('if (editingId)')))
    expect(editBranch).not.toContain('buildTaskAssignmentWorkOrderDraft')
    expect(editBranch).not.toContain('createTaskAssignmentWithWorkOrder')
  })

  it('keeps list/read projections free of undeployed 092/093 columns', () => {
    const colsMatch = service.match(/const ASSIGNMENT_BASE_COLS =\s*\n?\s*'([^']+)'/)
    expect(colsMatch?.[1]).toBeTruthy()
    expect(colsMatch![1]).not.toContain('hours_spent')
    expect(colsMatch![1]).not.toContain('client_request_id')
    expect(colsMatch![1]).not.toContain('current_work_order_version')
  })

  it('keeps retry IDs stable for an open failed create and refreshes them for a new modal', () => {
    expect(panel).toContain('const [createIds, setCreateIds] = useState(createAttemptIds)')
    expect(panel).toContain('assignmentId: createIds.assignmentId')
    expect(panel).toContain('clientRequestId: createIds.clientRequestId')
    expect(panel).toContain('if (!res.success) {')
    expect(panel).toContain("setError(res.error || 'Could not create assignment.')")
    expect(panel).toContain('setCreateIds(createAttemptIds())')
    expect(panel).toContain('if (saving) return')
  })
})
