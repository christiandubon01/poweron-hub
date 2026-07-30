import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration095Path = join(process.cwd(), 'supabase/migrations/095_employee_work_order_read.sql')
const migration092WorkOrderPath = join(process.cwd(), 'supabase/migrations/092_assignment_work_order_versions.sql')
const migration095 = readFileSync(migration095Path, 'utf8')

describe('Employee Work Order read migration 095 contract', () => {
  it('creates exactly one migration 095 and does not require migration 092 Work Order storage', () => {
    const migrations = readdirSync(join(process.cwd(), 'supabase/migrations'))
      .filter((name) => name.startsWith('095_'))

    expect(migrations).toEqual(['095_employee_work_order_read.sql'])
    expect(existsSync(migration095Path)).toBe(true)
    expect(existsSync(migration092WorkOrderPath)).toBe(false)
    expect(migration095).toContain('BEGIN;')
    expect(migration095).toContain('COMMIT;')
  })

  it('defines a locked plpgsql SECURITY DEFINER employee read RPC', () => {
    expect(migration095).toContain('CREATE OR REPLACE FUNCTION public.get_my_employee_work_order')
    expect(migration095).toContain('p_assignment_id UUID')
    expect(migration095).toContain('RETURNS JSONB')
    expect(migration095).toContain('LANGUAGE plpgsql')
    expect(migration095).toContain('SECURITY DEFINER')
    expect(migration095).toContain('SET search_path = public')
    expect(migration095).toContain('Returns an authenticated employee')
  })

  it('requires auth and reuses the active employee profile assignment path', () => {
    expect(migration095).toContain('v_uid := auth.uid()')
    expect(migration095).toContain('IF v_uid IS NULL THEN')
    expect(migration095).toContain("RAISE EXCEPTION 'Not authenticated'")
    expect(migration095).toContain('FROM public.employee_task_assignments t')
    expect(migration095).toContain('INNER JOIN public.employee_profiles ep')
    expect(migration095).toContain('ON ep.user_id = v_uid')
    expect(migration095).toContain('AND ep.active = true')
    expect(migration095).toContain('AND ep.org_id = t.org_id')
    expect(migration095).toContain('AND ep.id = ANY (t.assigned_employee_ids)')
  })

  it('prevents assignment enumeration with one generic unavailable shape', () => {
    const missingAssignmentStart = migration095.indexOf('IF NOT FOUND THEN')
    const missingAssignmentBody = migration095.slice(missingAssignmentStart, migration095.indexOf('END IF;', missingAssignmentStart))

    expect(missingAssignmentBody).toContain("'available', false")
    expect(missingAssignmentBody).toContain("'assignment', NULL")
    expect(missingAssignmentBody).toContain("'workOrder', NULL")
    expect(missingAssignmentBody).toContain("'snapshots', '[]'::jsonb")
    expect(migration095).not.toMatch(/assignment not found|not authorized|forbidden/i)
  })

  it('returns only the safe assignment header fields', () => {
    const headerStart = migration095.indexOf('v_assignment_json := jsonb_build_object')
    const headerBody = migration095.slice(headerStart, migration095.indexOf(');', headerStart))

    expect(headerBody).toContain("'id', v_assignment.id")
    expect(headerBody).toContain("'workPackageId', v_assignment.work_package_id")
    expect(headerBody).toContain("'workPackageName', v_assignment.work_package_name")
    expect(headerBody).toContain("'projectId', v_assignment.project_id")
    expect(headerBody).toContain("'projectName', v_assignment.project_name")
    expect(headerBody).toContain("'blueprintSetId', v_assignment.blueprint_set_id")
    expect(headerBody).toContain("'dueDate', v_assignment.due_date")
    expect(headerBody).toContain("'status', v_assignment.status")
    expect(headerBody).not.toContain('lead_employee_id')
    expect(headerBody).not.toContain('assigned_employee_ids')
    expect(headerBody).not.toContain('assigned_by')
    expect(headerBody).not.toContain('client_request_id')
    expect(headerBody).not.toContain('org_id')
    expect(headerBody).not.toContain('completion_notes')
  })

  it('uses current_work_order_version and assignment_work_order_versions as the only payload source', () => {
    expect(migration095).toContain('IF v_assignment.current_work_order_version IS NULL THEN')
    expect(migration095).toContain('FROM public.assignment_work_order_versions awov')
    expect(migration095).toContain('awov.org_id = v_assignment.org_id')
    expect(migration095).toContain('awov.assignment_id = v_assignment.id')
    expect(migration095).toContain('awov.version = v_assignment.current_work_order_version')
    expect(migration095).toContain("'version', v_work_order.version")
    expect(migration095).toContain("'schemaVersion', v_work_order.schema_version")
    expect(migration095).toContain("'issuedAt', v_work_order.created_at")
    expect(migration095).toContain("'payload', v_work_order.payload")
    expect(migration095).not.toContain('getOperationsBlueprint')
    expect(migration095).not.toContain('BackupData')
  })

  it('returns no issued Work Order as unavailable without mutable fallback', () => {
    const nullVersionStart = migration095.indexOf('IF v_assignment.current_work_order_version IS NULL THEN')
    const missingVersionStart = migration095.indexOf('IF NOT FOUND THEN', nullVersionStart)
    const unavailableBody = migration095.slice(nullVersionStart, migration095.indexOf('END IF;', missingVersionStart))

    expect(unavailableBody).toContain("'available', false")
    expect(unavailableBody).toContain("'assignment', v_assignment_json")
    expect(unavailableBody).toContain("'workOrder', NULL")
    expect(unavailableBody).toContain("'snapshots', '[]'::jsonb")
  })

  it('restricts snapshot metadata to the same assignment, version, and org ordered by display_order', () => {
    const snapshotStart = migration095.indexOf('FROM public.assignment_snapshots ats')
    const snapshotBody = migration095.slice(snapshotStart, migration095.indexOf('RETURN jsonb_build_object', snapshotStart))

    expect(snapshotBody).toContain('INNER JOIN public.blueprint_snapshots bs')
    expect(snapshotBody).toContain('bs.org_id = ats.org_id')
    expect(snapshotBody).toContain('bs.id = ats.snapshot_id')
    expect(snapshotBody).toContain('ats.org_id = v_assignment.org_id')
    expect(snapshotBody).toContain('ats.assignment_id = v_assignment.id')
    expect(snapshotBody).toContain('ats.work_order_version = v_work_order.version')
    expect(migration095).toContain('ORDER BY ats.display_order ASC')
  })

  it('returns only safe snapshot metadata with caption override fallback', () => {
    const snapshotBuildStart = migration095.indexOf("'snapshotId', bs.id")
    const snapshotBuildBody = migration095.slice(snapshotBuildStart, migration095.indexOf('FROM public.assignment_snapshots ats', snapshotBuildStart))

    expect(snapshotBuildBody).toContain("'snapshotId', bs.id")
    expect(snapshotBuildBody).toContain("'displayOrder', ats.display_order")
    expect(snapshotBuildBody).toContain("coalesce(nullif(btrim(coalesce(ats.caption_override, '')), ''), bs.caption)")
    expect(snapshotBuildBody).toContain("'pageNumber', bs.page_number")
    expect(snapshotBuildBody).toContain("'captureMode'")
    expect(snapshotBuildBody).toContain("bs.capture_metadata->>'captureMode' IN ('area', 'full-page')")
    expect(snapshotBuildBody).not.toContain('storage_path')
    expect(snapshotBuildBody).not.toMatch(/signed[_-]?url|public[_-]?url|bucket/i)
  })

  it('does not weaken table RLS or add broad table grants', () => {
    expect(migration095).not.toMatch(/CREATE POLICY|ALTER TABLE[\s\S]{0,80}ROW LEVEL SECURITY/i)
    expect(migration095).not.toMatch(/GRANT\s+SELECT\s+ON\s+public\.(assignment_work_order_versions|assignment_snapshots|blueprint_snapshots)\s+TO\s+authenticated/i)
    expect(migration095).not.toMatch(/REVOKE\s+ALL\s+ON\s+public\.(assignment_work_order_versions|assignment_snapshots|blueprint_snapshots)/i)
  })

  it('does not create signed URLs, expose storage paths, or touch storage objects', () => {
    expect(migration095).not.toMatch(/createSignedUrl|signedUrl|signed_url|publicUrl|public_url|storage_path|bucket|storage\.objects/i)
    expect(migration095).not.toContain('blueprint-snapshots')
  })

  it('locks function execution to authenticated callers only', () => {
    expect(migration095).toContain('REVOKE ALL ON FUNCTION public.get_my_employee_work_order(UUID) FROM PUBLIC')
    expect(migration095).toContain('GRANT EXECUTE ON FUNCTION public.get_my_employee_work_order(UUID) TO authenticated')
  })
})
