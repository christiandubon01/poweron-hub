/**
 * WORK-ORDER-PROJECT-ONLY-R1 — session terminology, readiness, fallback.
 *
 * Classification:
 * - [UNIT] resolver (see timeSessionIdentity.test.ts)
 * - [COMPONENT SOURCE] Time Session / form surfaces use resolver + readiness
 * - [SERVICE] null-WP create never succeeds via legacy fallback; readiness probe
 * - [STATIC SQL] migration 110 readiness RPC
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const migration110 = read('supabase/migrations/110_project_only_work_orders.sql')
const clock = read('src/components/employee/EmployeeTimeClock.tsx')
const weekBoard = read('src/components/employee/EmployeeTimeWeekBoard.tsx')
const modal = read('src/components/admin/AdminPunchHistoryModal.tsx')
const punchEdit = read('src/components/employee/EmployeePunchEditRequestDialog.tsx')
const form = read('src/components/admin/AdminWorkOrderAssignmentForm.tsx')
const panel = read('src/components/admin/AdminTaskDelegationPanel.tsx')
const serviceSrc = read('src/services/employeeTaskAssignmentService.ts')
const timeServiceSrc = read('src/services/employeeTimeService.ts')
const terminology = read('src/components/admin/__tests__/timeSessionTerminology.test.ts')

const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: mocks.authGetUser },
    rpc: mocks.rpc,
    from: mocks.from,
  },
}))

vi.mock('@/services/backupDataService', () => ({ getBackupData: vi.fn() }))
vi.mock('@/services/blueprintLibraryService', () => ({
  getOperationsBlueprintScopeLayers: vi.fn(),
  getOperationsBlueprintLibrary: vi.fn(),
  getOperationsBlueprintAnnotations: vi.fn(),
  getOperationsBlueprintWireProfiles: vi.fn(),
}))
vi.mock('@/services/adminTimecardService', () => ({ getActiveEmployeeProfiles: vi.fn() }))
vi.mock('@/features/blueprint-snapshots/blueprintSnapshotService', () => ({
  getBlueprintSnapshotsByIds: vi.fn(),
}))

const {
  __resetProjectOnlyBackendReadinessCacheForTests,
  createTaskAssignmentWithWorkOrderAndSnapshots,
  getProjectOnlyWorkOrdersBackendReadiness,
  isNullWorkPackageSource,
} = await import('@/services/employeeTaskAssignmentService')

describe('[STATIC SQL] migration 110 readiness probe', () => {
  it('adds project_only_work_orders_backend_ready without creating migration 111', () => {
    const migrations = readdirSync(join(process.cwd(), 'supabase/migrations'))
      .filter((name) => /^\d+_/.test(name))
      .sort()
    expect(existsSync(join(process.cwd(), 'supabase/migrations/110_project_only_work_orders.sql'))).toBe(true)
    expect(migrations.filter((name) => name.startsWith('111_'))).toHaveLength(0)
    expect(migration110).toContain('CREATE OR REPLACE FUNCTION public.project_only_work_orders_backend_ready()')
    expect(migration110).toContain('GRANT EXECUTE ON FUNCTION public.project_only_work_orders_backend_ready() TO authenticated')
    expect(migration110).toContain('REVOKE EXECUTE ON FUNCTION public.project_only_work_orders_backend_ready() FROM anon')
  })
})

describe('[COMPONENT SOURCE] Time Session surfaces use resolver', () => {
  it('active clock, closeout, history, week board, punch edit, and admin modal import resolver', () => {
    expect(clock).toContain('resolveTimeSessionIdentity')
    expect(clock).toContain('timeSessionIdentityDisplayValue')
    expect(weekBoard).toContain('resolveTimeSessionIdentity')
    expect(modal).toContain('resolveTimeSessionIdentity')
    expect(punchEdit).toContain('resolveTimeSessionIdentity')
  })

  it('does not hardcode Work Package label over assignment-linked work_package_name', () => {
    expect(clock).not.toContain("activeSession.work_package_name ? (\n                  <>\n                    <p className=\"text-[10px] text-gray-400 uppercase tracking-wide mt-0.5\">Work Package</p>")
    expect(clock).toContain("identity.kind === 'project-only'")
    expect(weekBoard).toContain("identity.kind === 'project-only' ? 'Work Package' : identity.label")
    expect(modal).toContain("identity.kind === 'project-only' ? 'Work Package' : identity.label")
  })

  it('ready-to-clock assignment selection labels Work Order', () => {
    expect(clock).toContain('Work Order')
    expect(clock).toContain('selection.workPackageName')
  })

  it('terminology contract tests expect Work Order for assignment-linked sessions', () => {
    expect(terminology).toContain('resolveTimeSessionIdentity')
    expect(terminology).toContain('Work Order')
  })
})

describe('[COMPONENT SOURCE] Project-only Assign readiness gating', () => {
  it('form disables Project-only / Blueprint-only when backend is not ready', () => {
    expect(form).toContain('projectOnlyBackendStatus')
    expect(form).toContain('needsProjectOnlyBackend')
    expect(form).toContain('projectOnlyBlocked')
    expect(form).toContain('Project-only Work Orders will be available after the Work Order backend update is deployed')
    expect(form).toContain('!projectOnlyBlocked')
  })

  it('panel probes readiness on form open and blocks null-WP submit when not ready', () => {
    expect(panel).toContain('getProjectOnlyWorkOrdersBackendReadiness')
    expect(panel).toContain('ensureProjectOnlyBackendReadiness')
    expect(panel).toContain("if (!form.workPackageId)")
    expect(panel).toContain("readiness !== 'ready'")
  })
})

describe('[SERVICE] readiness probe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetProjectOnlyBackendReadinessCacheForTests()
    mocks.authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  })

  it('ready when RPC returns true', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    await expect(getProjectOnlyWorkOrdersBackendReadiness({ force: true })).resolves.toEqual({ status: 'ready' })
  })

  it('not_ready when readiness RPC is missing', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.project_only_work_orders_backend_ready' },
    })
    await expect(getProjectOnlyWorkOrdersBackendReadiness({ force: true })).resolves.toEqual({ status: 'not_ready' })
  })

  it('auth failure does not report ready', async () => {
    mocks.authGetUser.mockResolvedValue({ data: { user: null } })
    const result = await getProjectOnlyWorkOrdersBackendReadiness({ force: true })
    expect(result.status).toBe('unknown')
    expect(result.status).not.toBe('ready')
  })

  it('network failure does not report ready', async () => {
    mocks.rpc.mockRejectedValue(new Error('Failed to fetch'))
    const result = await getProjectOnlyWorkOrdersBackendReadiness({ force: true })
    expect(result.status).toBe('unknown')
    expect(result.status).not.toBe('ready')
  })

  it('caches ready/not_ready and does not re-probe until force', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    await getProjectOnlyWorkOrdersBackendReadiness({ force: true })
    await getProjectOnlyWorkOrdersBackendReadiness()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})

describe('[SERVICE] null-WP create never uses unsafe legacy success', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetProjectOnlyBackendReadinessCacheForTests()
    mocks.authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  })

  it('detects null Work Package sources', () => {
    expect(isNullWorkPackageSource(null)).toBe(true)
    expect(isNullWorkPackageSource('')).toBe(true)
    expect(isNullWorkPackageSource('   ')).toBe(true)
    expect(isNullWorkPackageSource('wp-1')).toBe(false)
  })

  it('Project-only request fails closed when snapshot RPC is missing (no legacy success)', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.create_employee_task_assignment_with_work_order_and_snapshots',
      },
    })
    const result = await createTaskAssignmentWithWorkOrderAndSnapshots({
      orgId: 'org-1',
      assignmentId: 'a1',
      clientRequestId: 'c1',
      workPackageId: null,
      workPackageName: 'Install temporary power',
      projectId: 'p1',
      projectName: 'Project',
      blueprintSetId: null,
      leadEmployeeId: 'e1',
      assignedEmployeeIds: ['e1'],
      workOrderPayload: {
        identity: { projectId: 'p1', projectName: 'Project' },
        source: { sourceFingerprint: 'x' },
        scope: { title: 'Install temporary power', description: '' },
        labor: { roughInHours: 0, trimHours: 0, testingHours: 0, cleanupHours: 0, totalHours: 1 },
        items: [],
        electricalSymbols: [],
        wireQuantities: [],
        animationRoute: null,
      } as any,
      snapshotIds: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('Project-only Work Orders will be available')
    }
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('Blueprint-only request fails closed when create RPC is missing', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.create_employee_task_assignment_with_work_order_and_snapshots',
        },
      })
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.create_employee_task_assignment_with_work_order',
        },
      })
    const result = await createTaskAssignmentWithWorkOrderAndSnapshots({
      orgId: 'org-1',
      assignmentId: 'a1',
      clientRequestId: 'c1',
      workPackageId: null,
      workPackageName: 'Walkthrough',
      projectId: 'p1',
      projectName: 'Project',
      blueprintSetId: 'set-1',
      blueprintTitle: 'E1',
      leadEmployeeId: 'e1',
      assignedEmployeeIds: ['e1'],
      workOrderPayload: {
        identity: { projectId: 'p1', projectName: 'Project', blueprintSetId: 'set-1' },
        source: { sourceFingerprint: 'x' },
        scope: { title: 'Walkthrough', description: '' },
        labor: { roughInHours: 0, trimHours: 0, testingHours: 0, cleanupHours: 0, totalHours: 0 },
        items: [],
        electricalSymbols: [],
        wireQuantities: [],
        animationRoute: null,
      } as any,
      snapshotIds: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('Project-only Work Orders will be available')
    }
  })
})

describe('[TYPES] EligibleAssignment nullable work_package_id', () => {
  it('types EligibleAssignment.work_package_id as string | null', () => {
    expect(timeServiceSrc).toContain('work_package_id: string | null')
    expect(timeServiceSrc).not.toMatch(/export interface EligibleAssignment \{[\s\S]*?work_package_id: string\n/)
  })
})
