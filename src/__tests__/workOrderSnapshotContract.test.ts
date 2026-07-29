import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/089_work_order_snapshot_storage.sql'),
  'utf8',
)

const edgeFunction = readFileSync(
  join(process.cwd(), 'supabase/functions/getAssignmentSnapshotUrls/index.ts'),
  'utf8',
)

describe('Work Order snapshot migration contract', () => {
  it('creates the private storage bucket with PNG and 10 MB limits', () => {
    expect(migration).toContain("'blueprint-snapshots'")
    expect(migration).toContain('public = false')
    expect(migration).toContain('10485760')
    expect(migration).toContain("ARRAY['image/png']")
    expect(migration).not.toMatch(/\bpublic_url\b/i)
  })

  it('creates constrained snapshot metadata without public URLs', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.blueprint_snapshots')
    expect(migration).toContain('CONSTRAINT blueprint_snapshots_storage_path_key UNIQUE (storage_path)')
    expect(migration).toContain('width > 0 AND width <= 4096')
    expect(migration).toContain('height > 0 AND height <= 4096')
    expect(migration).toContain('file_size_bytes > 0 AND file_size_bytes <= 10485760')
    expect(migration).toContain("mime_type = 'image/png'")
    expect(migration).toContain("jsonb_typeof(capture_metadata) = 'object'")
    expect(migration).toContain('deleted_at TIMESTAMPTZ')
  })

  it('enforces organization-aware assignment attachments and retention semantics', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.assignment_snapshots')
    expect(migration).toContain('CONSTRAINT employee_task_assignments_org_id_id_key UNIQUE (org_id, id)')
    expect(migration).toContain('CONSTRAINT blueprint_snapshots_org_id_id_key UNIQUE (org_id, id)')
    expect(migration).toContain('FOREIGN KEY (org_id, assignment_id)')
    expect(migration).toContain('ON DELETE CASCADE')
    expect(migration).toContain('FOREIGN KEY (org_id, snapshot_id)')
    expect(migration).toContain('ON DELETE RESTRICT')
    expect(migration).toContain('CONSTRAINT assignment_snapshots_assignment_snapshot_key UNIQUE (assignment_id, snapshot_id)')
  })

  it('rejects a ninth attachment through a locked database trigger', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.enforce_assignment_snapshot_limit()')
    expect(migration).toContain('FOR UPDATE')
    expect(migration).toContain('IF v_count >= 8 THEN')
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF org_id, assignment_id')
  })

  it('keeps direct table and storage access owner/admin-only', () => {
    expect(migration).toContain('ALTER TABLE public.blueprint_snapshots ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE public.assignment_snapshots ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('public.is_org_admin_for(org_id)')
    expect(migration).toContain("bucket_id = 'blueprint-snapshots'")
    expect(migration).toContain('CASE')
    expect(migration).toContain("public.is_org_admin_for(split_part(name, '/', 1)::uuid)")
    expect(migration).not.toMatch(/auth\.role\(\)\s*=\s*'authenticated'/)
    expect(migration).not.toMatch(/FOR SELECT[\s\S]{0,220}auth\.uid\(\)\s+IS NOT NULL/)
    expect(migration).not.toMatch(/TO anon/)
  })
})

describe('getAssignmentSnapshotUrls Edge Function contract', () => {
  it('requires POST, JWT auth, and a valid assignment UUID', () => {
    expect(edgeFunction).toContain("req.method === 'OPTIONS'")
    expect(edgeFunction).toContain("req.method !== 'POST'")
    expect(edgeFunction).toContain('Authentication required')
    expect(edgeFunction).toContain('Valid assignment_id is required')
    expect(edgeFunction).toContain('auth.getUser(jwt)')
  })

  it('authorizes owner/admins and currently assigned active employees only', () => {
    expect(edgeFunction).toContain(".from('profiles')")
    expect(edgeFunction).toContain(".in('role', ['owner', 'admin'])")
    expect(edgeFunction).toContain(".from('employee_profiles')")
    expect(edgeFunction).toContain(".eq('active', true)")
    expect(edgeFunction).toContain(".in('id', assignment.assigned_employee_ids)")
    expect(edgeFunction).not.toContain('lead_employee_id')
  })

  it('returns only safe fields and signs URLs for 600 seconds', () => {
    const responseShape = edgeFunction.slice(edgeFunction.indexOf('snapshots.push({'))
    expect(edgeFunction).toContain('const SIGNED_URL_TTL_SECONDS = 600')
    expect(edgeFunction).toContain("createSignedUrl(snapshot.storage_path, SIGNED_URL_TTL_SECONDS)")
    expect(edgeFunction).toContain('signed_url: signed.signedUrl')
    expect(edgeFunction).toContain('expires_in: SIGNED_URL_TTL_SECONDS')
    expect(edgeFunction).not.toContain('captured_by')
    expect(edgeFunction).not.toContain('attached_by')
    expect(responseShape).not.toMatch(/storage_path:/)
    expect(responseShape).not.toContain('assigned_employee_ids')
  })
})
