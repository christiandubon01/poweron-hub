import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration094Path = join(process.cwd(), 'supabase/migrations/094_assignment_snapshot_attachments.sql')
const migration089Path = join(process.cwd(), 'supabase/migrations/089_work_order_snapshot_storage.sql')
const migration092Path = join(process.cwd(), 'supabase/migrations/092_task_hours_spent.sql')
const migration093Path = join(process.cwd(), 'supabase/migrations/093_assignment_work_order_versions.sql')
const migration094 = readFileSync(migration094Path, 'utf8')

describe('Work Order snapshot attachment migration 094 contract', () => {
  it('uses the expected migration number without replacing protected baseline migrations', () => {
    expect(existsSync(migration094Path)).toBe(true)
    expect(existsSync(migration089Path)).toBe(true)
    expect(existsSync(migration092Path)).toBe(true)
    expect(existsSync(migration093Path)).toBe(true)
    expect(migration094Path.endsWith('094_assignment_snapshot_attachments.sql')).toBe(true)
  })

  it('adds version-scoped attachment schema and order constraints', () => {
    expect(migration094).toContain('ADD COLUMN IF NOT EXISTS work_order_version INTEGER NOT NULL DEFAULT 1')
    expect(migration094).toContain('CHECK (work_order_version >= 1)')
    expect(migration094).toContain('UNIQUE (assignment_id, work_order_version, snapshot_id)')
    expect(migration094).toContain('UNIQUE (assignment_id, work_order_version, display_order)')
    expect(migration094).toContain('CHECK (display_order >= 0 AND display_order <= 7)')
    expect(migration094).not.toContain('WorkOrderPayloadV1')
  })

  it('enforces maximum eight per assignment and Work Order version with a parent lock', () => {
    expect(migration094).toContain('FOR UPDATE')
    expect(migration094).toContain('ats.work_order_version = NEW.work_order_version')
    expect(migration094).toContain('IF v_count >= 8 THEN')
    expect(migration094).toContain('BEFORE INSERT OR UPDATE OF org_id, assignment_id, work_order_version')
  })

  it('locks down direct writes while preserving owner/admin org-scoped select', () => {
    expect(migration094).toContain('DROP POLICY IF EXISTS assignment_snapshots_owner_admin_insert')
    expect(migration094).toContain('DROP POLICY IF EXISTS assignment_snapshots_owner_admin_update')
    expect(migration094).toContain('DROP POLICY IF EXISTS assignment_snapshots_owner_admin_delete')
    expect(migration094).toContain('CREATE POLICY assignment_snapshots_owner_admin_select')
    expect(migration094).toContain('USING (public.is_org_admin_for(org_id))')
    expect(migration094).toContain('REVOKE ALL ON public.assignment_snapshots FROM authenticated')
    expect(migration094).toContain('GRANT SELECT ON public.assignment_snapshots TO authenticated')
    expect(migration094).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE)[\s\S]{0,80}assignment_snapshots\s+TO\s+authenticated/i)
  })

  it('guards historical snapshots from soft delete while allowing non-delete updates', () => {
    const guardStart = migration094.indexOf('CREATE OR REPLACE FUNCTION public.prevent_attached_blueprint_snapshot_soft_delete()')
    const guardBody = migration094.slice(guardStart, migration094.indexOf('DROP TRIGGER IF EXISTS trg_blueprint_snapshots_prevent_attached_soft_delete'))
    expect(migration094).toContain('CREATE OR REPLACE FUNCTION public.prevent_attached_blueprint_snapshot_soft_delete()')
    expect(migration094).toContain('OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL')
    expect(guardBody).toContain('FROM public.assignment_snapshots ats')
    expect(migration094).toContain('BEFORE UPDATE OF deleted_at ON public.blueprint_snapshots')
    expect(guardBody).not.toContain('storage_path')
  })

  it('creates the 1D SECURITY DEFINER RPC with fixed search path and grants only authenticated execute', () => {
    expect(migration094).toContain('CREATE OR REPLACE FUNCTION public.create_employee_task_assignment_with_work_order_and_snapshots')
    expect(migration094).toContain('p_snapshot_ids UUID[]')
    expect(migration094).toContain('SECURITY DEFINER')
    expect(migration094).toContain('SET search_path = public')
    expect(migration094).toContain('REVOKE ALL ON FUNCTION public.create_employee_task_assignment_with_work_order_and_snapshots')
    expect(migration094).toContain('FROM PUBLIC')
    expect(migration094).toContain('GRANT EXECUTE ON FUNCTION public.create_employee_task_assignment_with_work_order_and_snapshots')
    expect(migration094).toContain('TO authenticated')
  })

  it('validates snapshots server-side before success', () => {
    expect(migration094).toContain('cardinality(v_snapshot_ids) > 8')
    expect(migration094).toContain('COUNT(*) - COUNT(DISTINCT snapshot_id)')
    expect(migration094).toContain('bs.deleted_at IS NULL')
    expect(migration094).toContain("btrim(coalesce(bs.storage_path, '')) <> ''")
    expect(migration094).toContain('bs.project_id = btrim(coalesce(p_project_id')
    expect(migration094).toContain('bs.blueprint_set_id = btrim(coalesce(p_blueprint_set_id')
    expect(migration094).toContain('bs.work_package_id IS NULL OR bs.work_package_id = btrim(coalesce(p_work_package_id')
  })

  it('atomically calls 1C create, freezes captions, and inserts array order as version 1', () => {
    expect(migration094).toContain('public.create_employee_task_assignment_with_work_order(')
    expect(migration094).toContain('INSERT INTO public.assignment_snapshots')
    expect(migration094).toContain('display_order')
    expect(migration094).toContain('v_index')
    expect(migration094).toContain('work_order_version')
    expect(migration094).toContain('1,')
    expect(migration094).toContain('caption_override')
    expect(migration094).toContain('v_snapshot.caption')
  })

  it('returns stable replay metadata and rejects changed replay lists', () => {
    expect(migration094).toContain('client_request_id = p_client_request_id')
    expect(migration094).toContain('array_agg(ats.snapshot_id ORDER BY ats.display_order ASC)')
    expect(migration094).toContain('coalesce(v_existing_snapshot_ids, ARRAY[]::UUID[]) <> v_snapshot_ids')
    expect(migration094).toContain('Idempotent replay snapshot list does not match')
    expect(migration094).toContain('attachmentCount')
    expect(migration094).toContain('orderedSnapshotIds')
    expect(migration094).toContain('idempotentReplay')
  })

  it('checks nested 093 idempotent replay before inserting attachments', () => {
    const nestedStart = migration094.indexOf('v_created := public.create_employee_task_assignment_with_work_order(')
    const insertStart = migration094.indexOf('INSERT INTO public.assignment_snapshots', nestedStart)
    const replayBody = migration094.slice(nestedStart, insertStart)

    expect(replayBody).toContain("coalesce((v_created->>'idempotentReplay')::boolean, false)")
    expect(replayBody).toContain('ats.work_order_version = 1')
    expect(replayBody).toContain('array_agg(ats.snapshot_id ORDER BY ats.display_order ASC)')
    expect(replayBody).toContain('coalesce(v_existing_snapshot_ids, ARRAY[]::UUID[]) <> v_snapshot_ids')
    expect(replayBody).toContain('Idempotent replay snapshot list does not match')
    expect(replayBody).toContain("'idempotentReplay', true")
    expect(replayBody).not.toContain('INSERT INTO public.assignment_snapshots')
  })
})
