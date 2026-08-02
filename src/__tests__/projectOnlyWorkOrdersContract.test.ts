/**
 * Project-only Work Orders (WORK-ORDER-PROJECT-ONLY-1 / migration 110).
 *
 * Classification:
 * - [STATIC SQL] migration-file contracts (not live Postgres)
 * - [UNIT] source-mode / title / project-scoped payload helpers
 * - [SERVICE] draft builder + RPC null identity wiring
 * - [COMPONENT SOURCE] assign form / panel / detail / employee viewer
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildProjectScopedSourceFingerprint,
  buildProjectScopedWorkOrderPayloadV1Draft,
  deriveWorkOrderSourceMode,
  isValidWorkOrderTitle,
  normalizeWorkOrderTitle,
  workOrderSourceLabel,
} from '@/features/work-orders'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const migration110Path = join(process.cwd(), 'supabase/migrations/110_project_only_work_orders.sql')
const migration109Path = join(process.cwd(), 'supabase/migrations/109_work_order_assigned_hours_archive_delete.sql')
const migration110 = readFileSync(migration110Path, 'utf8')
const form = read('src/components/admin/AdminWorkOrderAssignmentForm.tsx')
const panel = read('src/components/admin/AdminTaskDelegationPanel.tsx')
const board = read('src/components/admin/AdminWorkOrderAssignmentBoard.tsx')
const viewer = read('src/components/employee/EmployeeWorkOrderViewer.tsx')
const service = read('src/services/employeeTaskAssignmentService.ts')
const picker = read('src/features/blueprint-snapshots/SnapshotAssignmentPicker.tsx')

const mocks = vi.hoisted(() => ({
  getBackupData: vi.fn(),
  getOperationsBlueprintScopeLayers: vi.fn(),
  getOperationsBlueprintLibrary: vi.fn(),
  getOperationsBlueprintAnnotations: vi.fn(),
  getOperationsBlueprintWireProfiles: vi.fn(),
  authGetUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  getActiveEmployeeProfiles: vi.fn(),
  getBlueprintSnapshotsByIds: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: mocks.authGetUser },
    from: mocks.from,
    rpc: mocks.rpc,
  },
}))

vi.mock('@/services/backupDataService', () => ({
  getBackupData: mocks.getBackupData,
}))

vi.mock('@/services/blueprintLibraryService', async () => {
  const actual = await vi.importActual<typeof import('@/services/blueprintLibraryService')>('@/services/blueprintLibraryService')
  return {
    ...actual,
    getOperationsBlueprintScopeLayers: mocks.getOperationsBlueprintScopeLayers,
    getOperationsBlueprintLibrary: mocks.getOperationsBlueprintLibrary,
    getOperationsBlueprintAnnotations: mocks.getOperationsBlueprintAnnotations,
    getOperationsBlueprintWireProfiles: mocks.getOperationsBlueprintWireProfiles,
  }
})

vi.mock('@/services/adminTimecardService', () => ({
  getActiveEmployeeProfiles: mocks.getActiveEmployeeProfiles,
}))

vi.mock('@/features/blueprint-snapshots/blueprintSnapshotService', () => ({
  getBlueprintSnapshotsByIds: mocks.getBlueprintSnapshotsByIds,
}))

const { buildTaskAssignmentWorkOrderDraft } = await import('@/services/employeeTaskAssignmentService')

describe('[STATIC SQL] migration 110 Project-only Work Orders', () => {
  it('is the sole migration 110 and preserves migration 109', () => {
    const migrations = readdirSync(join(process.cwd(), 'supabase/migrations'))
      .filter((name) => /^\d+_/.test(name))
      .sort()
    expect(existsSync(migration109Path)).toBe(true)
    expect(existsSync(migration110Path)).toBe(true)
    expect(migrations.filter((name) => name.startsWith('110_'))).toEqual([
      '110_project_only_work_orders.sql',
    ])
    expect(migrations.filter((name) => name.startsWith('111_'))).toEqual(['111_private_portal_storage.sql'])
    expect(migrations).toContain('111_private_portal_storage.sql')
  })

  it('makes work_package_id nullable while keeping work_package_name as required title', () => {
    expect(migration110).toContain('ALTER COLUMN work_package_id DROP NOT NULL')
    expect(migration110).toContain('work_package_name must remain NOT NULL')
    expect(migration110).not.toContain('ALTER COLUMN work_package_name DROP NOT NULL')
  })

  it('accepts null Blueprint and Work Package IDs without inventing placeholders', () => {
    expect(migration110).toContain("nullif(btrim(coalesce(p_work_package_id, '')), '')")
    expect(migration110).toContain("nullif(btrim(coalesce(p_blueprint_set_id, '')), '')")
    expect(migration110).toContain("v_final_identity := v_final_identity - 'workPackageId'")
    expect(migration110).toContain("v_final_identity := v_final_identity - 'blueprintSetId'")
    expect(migration110).not.toContain("'No Blueprint'")
    expect(migration110).not.toContain("'Project Only'")
    expect(migration110).not.toContain("'General'")
  })

  it('keeps owner/admin authorization, archive reject, and title identity checks', () => {
    expect(migration110).toContain('NOT public.is_org_admin_for(v_org_id)')
    expect(migration110).toContain('Archived assignments cannot be edited; restore first')
    expect(migration110).toContain("RAISE EXCEPTION 'Invalid Work Order payload identity'")
    expect(migration110).toContain("(p_work_order_payload #>> '{scope,title}') IS DISTINCT FROM v_work_package_name")
    expect(migration110).toContain('v_work_package_name = \'\'')
  })

  it('rejects snapshots without full Blueprint + Work Package source', () => {
    expect(migration110).toContain('cardinality(v_snapshot_ids) > 0 AND (v_project_id IS NULL OR v_blueprint_set_id IS NULL OR v_work_package_id IS NULL)')
  })

  it('exposes project_only_work_orders_backend_ready for client readiness gating', () => {
    expect(migration110).toContain('project_only_work_orders_backend_ready')
    expect(migration110).toContain('GRANT EXECUTE ON FUNCTION public.project_only_work_orders_backend_ready() TO authenticated')
  })
})

describe('[UNIT] Project-only source and title helpers', () => {
  it('derives source mode from nullable IDs', () => {
    expect(deriveWorkOrderSourceMode({ blueprintSetId: null, workPackageId: null })).toBe('project')
    expect(deriveWorkOrderSourceMode({ blueprintSetId: 'set-1', workPackageId: null })).toBe('blueprint')
    expect(deriveWorkOrderSourceMode({ blueprintSetId: 'set-1', workPackageId: 'wp-1' })).toBe('work-package')
    expect(workOrderSourceLabel('project')).toBe('Project Work Order')
  })

  it('requires nonempty trimmed titles within 200 chars', () => {
    expect(isValidWorkOrderTitle('')).toBe(false)
    expect(isValidWorkOrderTitle('   ')).toBe(false)
    expect(isValidWorkOrderTitle(' Install temporary power ')).toBe(true)
    expect(normalizeWorkOrderTitle('  Install   temporary power  ')).toBe('Install temporary power')
    expect(normalizeWorkOrderTitle('x'.repeat(250)).length).toBe(200)
  })

  it('builds a Project-only payload without fake Blueprint/Work Package IDs', () => {
    const draft = buildProjectScopedWorkOrderPayloadV1Draft({
      projectId: ' project-1 ',
      projectName: ' Rock\'n Avenue ',
      workOrderTitle: ' Install temporary power ',
      workOrderInstructions: ' Gate access required ',
      assignedHours: 4.5,
    })
    expect(draft.identity).toEqual({
      projectId: 'project-1',
      projectName: 'Rock\'n Avenue',
    })
    expect(draft.identity).not.toHaveProperty('workPackageId')
    expect(draft.identity).not.toHaveProperty('blueprintSetId')
    expect(draft.scope.title).toBe('Install temporary power')
    expect(draft.workOrderInstructions).toBe('Gate access required')
    expect(draft.labor.totalHours).toBe(4.5)
    expect(draft.items).toEqual([])
    expect(draft.animationRoute).toBeNull()
    expect(draft.source.sourceFingerprint).toBe(
      buildProjectScopedSourceFingerprint({
        projectId: 'project-1',
        blueprintSetId: null,
        title: 'Install temporary power',
      }),
    )
  })

  it('builds Blueprint-only payloads with Blueprint identity and no Work Package', () => {
    const draft = buildProjectScopedWorkOrderPayloadV1Draft({
      projectId: 'project-1',
      projectName: 'Rock\'n Avenue',
      workOrderTitle: 'Site walkthrough',
      blueprintSetId: 'set-1',
      blueprintTitle: 'E1',
    })
    expect(draft.identity.blueprintSetId).toBe('set-1')
    expect(draft.identity.blueprintTitle).toBe('E1')
    expect(draft.identity).not.toHaveProperty('workPackageId')
  })
})

describe('[SERVICE] Project-only draft builder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a Project-only draft without BackupData Work Package lookup', () => {
    const result = buildTaskAssignmentWorkOrderDraft({
      projectId: 'project-1',
      projectName: 'Rock\'n Avenue',
      workOrderTitle: 'Install temporary power',
      workOrderInstructions: 'Use GFCI protection',
      assignedHours: 3,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.identity).not.toHaveProperty('workPackageId')
      expect(result.data.identity).not.toHaveProperty('blueprintSetId')
      expect(result.data.scope.title).toBe('Install temporary power')
      expect(result.data.labor.totalHours).toBe(3)
      expect(result.data.workOrderInstructions).toBe('Use GFCI protection')
    }
    expect(mocks.getBackupData).not.toHaveBeenCalled()
  })

  it('rejects blank and whitespace-only titles for Project-only drafts', () => {
    expect(buildTaskAssignmentWorkOrderDraft({
      projectId: 'project-1',
      projectName: 'Rock\'n Avenue',
      workOrderTitle: '   ',
    }).success).toBe(false)
    expect(buildTaskAssignmentWorkOrderDraft({
      projectId: 'project-1',
      projectName: 'Rock\'n Avenue',
      workOrderTitle: '',
    }).success).toBe(false)
  })

  it('rejects Work Package without Blueprint', () => {
    const result = buildTaskAssignmentWorkOrderDraft({
      projectId: 'project-1',
      projectName: 'Rock\'n Avenue',
      workPackageId: 'wp-1',
      workOrderTitle: 'Title',
    })
    expect(result).toEqual({ success: false, error: 'Select a Blueprint for the Work Package.' })
  })
})

describe('[COMPONENT SOURCE] Assign form / panel / display for Project-only', () => {
  it('enables Assign without Blueprint or Work Package when Project + title + employees are valid and backend is ready', () => {
    expect(form).toContain('Work Order Title')
    expect(form).toContain("e.g. Install temporary power")
    expect(form).toContain('const canSubmit =')
    expect(form).toContain('!!value.projectId &&')
    expect(form).toContain('titleValid &&')
    expect(form).toContain('value.employeeIds.length > 0 &&')
    expect(form).toContain('!!value.primaryEmployeeId')
    expect(form).toContain('!projectOnlyBlocked')
    expect(form).toContain('projectOnlyBackendStatus')
    expect(form).toContain('disabled={saving || !canSubmit}')
    expect(form).not.toContain('disabled={saving || !canSubmit || noBlueprints || noPackages}')
    expect(form).toContain('Optional: select a Blueprint or Work Package for more specific work.')
  })

  it('panel submit accepts Project-only and maps title into workPackageName', () => {
    expect(panel).toContain("setFormError('Select a Project.')")
    expect(panel).toContain("setFormError('Enter a Work Order title.')")
    expect(panel).not.toContain('Select a Project, Blueprint / Document, and Work Package.')
    expect(panel).toContain('workOrderTitle')
    expect(panel).toContain('workPackageName: workOrderTitle')
    expect(panel).toContain('workPackageId: form.workPackageId || null')
    expect(panel).toContain('blueprintSetId: form.blueprintSetId || null')
    expect(panel).toContain('titleTouched')
  })

  it('admin detail and employee viewer omit absent Blueprint/Work Package cleanly', () => {
    expect(board).toContain("'Project Work Order'")
    expect(board).toContain('{assignment.blueprint_set_id ? (')
    expect(board).toContain('{assignment.work_package_id ? (')
    expect(board).not.toContain("assignment.blueprint_title || assignment.blueprint_set_id || 'Not recorded'")
    expect(viewer).toContain("'Project Work Order'")
    expect(viewer).toContain('assignment.blueprintSetId ? (')
    expect(service).toContain('workPackageId: nullableString(value.workPackageId)')
    expect(service).toContain('if (!id || !workPackageName || !status) return null')
  })

  it('keeps snapshots optional and gated behind Blueprint + Work Package', () => {
    expect(picker).toContain('const contextReady = !!projectId && !!blueprintSetId && !!workPackageId')
    expect(picker).toContain('Select a Blueprint and Work Package before attaching snapshots.')
    expect(panel).toContain('Snapshots require a Blueprint and Work Package')
  })

  it('service passes null optional IDs to create/update RPCs', () => {
    expect(service).toContain('p_work_package_id: cleanOptionalId(input.workPackageId)')
    expect(service).toContain('p_blueprint_set_id: cleanOptionalId(input.blueprintSetId)')
    expect(service).toContain('buildProjectScopedWorkOrderPayloadV1Draft')
  })

  it('blocks unsafe legacy fallback for null Work Package creates', () => {
    expect(service).toContain('isNullWorkPackageSource')
    expect(service).toContain('PROJECT_ONLY_BACKEND_UNAVAILABLE')
    expect(service).toContain('getProjectOnlyWorkOrdersBackendReadiness')
  })
})
