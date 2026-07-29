import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  getBackupData: vi.fn(),
  getOperationsBlueprintAnnotations: vi.fn(),
  getOperationsBlueprintLibrary: vi.fn(),
  getOperationsBlueprintScopeLayers: vi.fn(),
  getOperationsBlueprintWireProfiles: vi.fn(),
  getActiveEmployeeProfiles: vi.fn(),
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
    getOperationsBlueprintAnnotations: mocks.getOperationsBlueprintAnnotations,
    getOperationsBlueprintLibrary: mocks.getOperationsBlueprintLibrary,
    getOperationsBlueprintScopeLayers: mocks.getOperationsBlueprintScopeLayers,
    getOperationsBlueprintWireProfiles: mocks.getOperationsBlueprintWireProfiles,
  }
})

vi.mock('@/services/adminTimecardService', () => ({
  getActiveEmployeeProfiles: mocks.getActiveEmployeeProfiles,
}))

const {
  createTaskAssignmentWithWorkOrderAndSnapshots,
  createTaskAssignmentWithWorkOrder,
  isMissingSupabaseRpcError,
  listOrgTaskAssignments,
  revokeTaskAssignment,
  updateTaskAssignment,
} = await import('../employeeTaskAssignmentService')

const serviceSource = readFileSync(
  join(process.cwd(), 'src/services/employeeTaskAssignmentService.ts'),
  'utf8',
)

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assignment-1',
    org_id: 'org-1',
    work_package_id: 'package-1',
    work_package_name: 'Kitchen',
    project_id: 'project-1',
    project_name: 'Project One',
    blueprint_set_id: 'set-1',
    lead_employee_id: 'employee-1',
    assigned_employee_ids: ['employee-1'],
    assigned_by: 'user-1',
    assigned_at: '2026-01-01T00:00:00.000Z',
    due_date: null,
    status: 'assigned',
    completion_notes: null,
    completed_at: null,
    completed_by: null,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const BASE_ASSIGNMENT_COLUMNS = [
  'id',
  'org_id',
  'work_package_id',
  'work_package_name',
  'project_id',
  'project_name',
  'blueprint_set_id',
  'lead_employee_id',
  'assigned_employee_ids',
  'assigned_by',
  'assigned_at',
  'due_date',
  'status',
  'completion_notes',
  'completed_at',
  'completed_by',
  'updated_at',
  'created_at',
]

const POST_BASELINE_ASSIGNMENT_COLUMNS = [
  'hours_spent',
  'client_request_id',
  'current_work_order_version',
]

const workOrderPayload = {
  identity: { projectId: 'project-1', projectName: 'Project One', workPackageId: 'package-1', blueprintSetId: 'set-1' },
  source: { sourceFingerprint: 'fingerprint' },
  scope: { title: 'Kitchen', description: '', crewNotes: '' },
  labor: { roughInHours: 0, trimHours: 0, testingHours: 0, cleanupHours: 0, totalHours: 0 },
  items: [],
  electricalSymbols: [],
  wireQuantities: [],
  animationRoute: null,
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    assignmentId: 'assignment-1',
    clientRequestId: 'client-request-1',
    workPackageId: 'package-1',
    workPackageName: 'Kitchen',
    projectId: 'project-1',
    projectName: 'Project One',
    blueprintSetId: 'set-1',
    blueprintTitle: 'E1',
    leadEmployeeId: 'employee-1',
    assignedEmployeeIds: ['employee-1'],
    workOrderPayload,
    ...overrides,
  }
}

function missingCreateRpcError() {
  return {
    code: 'PGRST202',
    message: 'Could not find the function public.create_employee_task_assignment_with_work_order in the schema cache',
    details: 'Searched for the function public.create_employee_task_assignment_with_work_order with parameters...',
    hint: null,
  }
}

function missingCreateWithSnapshotsRpcError() {
  return {
    code: 'PGRST202',
    message: 'Could not find the function public.create_employee_task_assignment_with_work_order_and_snapshots in the schema cache',
    details: 'Searched for the function public.create_employee_task_assignment_with_work_order_and_snapshots with parameters...',
    hint: null,
  }
}

function missingRevokeRpcError() {
  return {
    code: 'PGRST202',
    message: 'Could not find the function public.revoke_employee_task_assignment in the schema cache',
    details: 'Searched for the function public.revoke_employee_task_assignment with parameter p_assignment_id...',
    hint: null,
  }
}

function mockLegacyInsertSuccess(row = assignment()) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null })
  const select = vi.fn((_cols: string) => ({ single }))
  const insert = vi.fn((_row: Record<string, unknown>) => ({ select }))
  mocks.from.mockReturnValueOnce({ insert })
  return { insert, select, single }
}

function mockLegacyDeleteSuccess() {
  const eq = vi.fn().mockResolvedValue({ data: null, error: null })
  const del = vi.fn(() => ({ eq }))
  mocks.from.mockReturnValueOnce({ delete: del })
  return { delete: del, eq }
}

describe('employeeTaskAssignmentService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mocks.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('assignment base projection is pre-092/pre-093 compatible and contains the UI-required fields', () => {
    const colsMatch = serviceSource.match(/const ASSIGNMENT_BASE_COLS =\s*\n?\s*'([^']+)'/)
    expect(colsMatch?.[1]).toBeTruthy()
    const cols = colsMatch![1].split(',').map((col) => col.trim())
    expect(cols).toEqual(BASE_ASSIGNMENT_COLUMNS)
    for (const postBaselineColumn of POST_BASELINE_ASSIGNMENT_COLUMNS) {
      expect(cols).not.toContain(postBaselineColumn)
    }
    expect(serviceSource).toContain('Do not add 092/093 columns without a compatibility plan')
  })

  it('loads assignments against a pre-092 mocked schema without selecting post-baseline columns', async () => {
    const pre092Row = assignment()
    const order = vi.fn().mockResolvedValue({ data: [pre092Row], error: null })
    const select = vi.fn((_cols: string) => ({ order }))
    mocks.from.mockReturnValueOnce({ select })

    const result = await listOrgTaskAssignments()

    expect(result).toEqual({ success: true, data: [pre092Row] })
    expect(select).toHaveBeenCalledTimes(1)
    const projection = String(select.mock.calls[0]?.[0] ?? '')
    for (const postBaselineColumn of POST_BASELINE_ASSIGNMENT_COLUMNS) {
      expect(projection).not.toContain(postBaselineColumn)
    }
    if (result.success) {
      expect(result.data[0].hours_spent).toBeUndefined()
      expect(result.data[0].client_request_id).toBeUndefined()
      expect(result.data[0].current_work_order_version).toBeUndefined()
    }
  })

  it('zero snapshots attempts 1D create RPC first and performs no direct insert on success', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        assignment: assignment({ current_work_order_version: 1 }),
        workOrderVersion: 1,
        attachmentCount: 0,
        orderedSnapshotIds: [],
        idempotentReplay: false,
      },
      error: null,
    })

    const result = await createTaskAssignmentWithWorkOrder(createInput())

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.workOrderCreated).toBe(true)
      expect(result.data.workOrderVersion).toBe(1)
      expect(result.data.attachmentCount).toBe(0)
      expect(result.data.orderedSnapshotIds).toEqual([])
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('create_employee_task_assignment_with_work_order_and_snapshots', expect.objectContaining({
      p_assignment_id: 'assignment-1',
      p_work_order_payload: expect.objectContaining({ wireQuantities: [] }),
      p_snapshot_ids: [],
    }))
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('missing 1D with zero snapshots calls 1C, then missing 1C can use legacy create', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: missingCreateWithSnapshotsRpcError() })
      .mockResolvedValueOnce({ data: null, error: missingCreateRpcError() })
    const { insert } = mockLegacyInsertSuccess(assignment({ id: 'legacy-assignment-1' }))

    const result = await createTaskAssignmentWithWorkOrder(createInput())

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.workOrderCreated).toBe(false)
      expect(result.data.workOrderVersion).toBeUndefined()
      expect(result.data.attachmentCount).toBe(0)
      expect(result.data.orderedSnapshotIds).toEqual([])
      expect(result.data.assignment.id).toBe('legacy-assignment-1')
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.from).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledTimes(1)
    const inserted = insert.mock.calls[0]?.[0] as Record<string, unknown>
    expect(inserted).not.toHaveProperty('client_request_id')
    expect(inserted).not.toHaveProperty('current_work_order_version')
    expect(inserted).not.toHaveProperty('hours_spent')
    expect(inserted).not.toHaveProperty('id')
    expect(inserted.org_id).toBe('org-1')
    expect(inserted.work_package_id).toBe('package-1')
  })

  it('does not fall back on create authorization errors', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Not authorized' },
    })

    const result = await createTaskAssignmentWithWorkOrder(createInput())

    expect(result).toEqual({ success: false, error: 'Not authorized' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('does not fall back on create validation errors', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'work order payload is invalid' },
    })

    const result = await createTaskAssignmentWithWorkOrder(createInput())

    expect(result).toEqual({ success: false, error: 'Could not create the Work Order for this assignment' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('does not fall back on create network errors', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('Failed to fetch'))

    const result = await createTaskAssignmentWithWorkOrder(createInput())

    expect(result).toEqual({ success: false, error: 'Network error. Try again.' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('does not create a Work Order claim on missing-RPC create fallback', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: missingCreateWithSnapshotsRpcError() })
      .mockResolvedValueOnce({ data: null, error: missingCreateRpcError() })
    mockLegacyInsertSuccess()

    const result = await createTaskAssignmentWithWorkOrder(createInput())

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.workOrderCreated).toBe(false)
      expect(result.data).not.toHaveProperty('workOrderVersion', 1)
    }
  })

  it('does not duplicate create when atomic RPC succeeds', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { assignment: assignment(), workOrderVersion: 1, attachmentCount: 0, orderedSnapshotIds: [], idempotentReplay: false },
      error: null,
    })

    await createTaskAssignmentWithWorkOrder(createInput())
    await createTaskAssignmentWithWorkOrder(createInput({
      assignmentId: 'assignment-2',
      clientRequestId: 'client-request-2',
    }))

    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('selected snapshots call 1D RPC only and pass ordered IDs unchanged', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        assignment: assignment(),
        workOrderVersion: 1,
        attachmentCount: 2,
        orderedSnapshotIds: ['snap-2', 'snap-1'],
        idempotentReplay: true,
      },
      error: null,
    })

    const result = await createTaskAssignmentWithWorkOrderAndSnapshots(createInput({
      snapshotIds: ['snap-2', 'snap-1'],
    }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.attachmentCount).toBe(2)
      expect(result.data.orderedSnapshotIds).toEqual(['snap-2', 'snap-1'])
      expect(result.data.idempotentReplay).toBe(true)
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('create_employee_task_assignment_with_work_order_and_snapshots', expect.objectContaining({
      p_snapshot_ids: ['snap-2', 'snap-1'],
    }))
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('selected snapshots never use 1C or legacy fallback when 1D is missing', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: missingCreateWithSnapshotsRpcError() })

    const result = await createTaskAssignmentWithWorkOrderAndSnapshots(createInput({
      snapshotIds: ['snap-1'],
    }))

    expect(result).toEqual({ success: false, error: 'Snapshot assignment storage is not available yet.' })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('selected snapshots do not fall back on validation, authorization, or network errors', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Not authorized' } })
    await expect(createTaskAssignmentWithWorkOrderAndSnapshots(createInput({ snapshotIds: ['snap-1'] }))).resolves.toEqual({
      success: false,
      error: 'Not authorized',
    })

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'A selected snapshot is no longer available' } })
    await expect(createTaskAssignmentWithWorkOrderAndSnapshots(createInput({ snapshotIds: ['snap-1'] }))).resolves.toEqual({
      success: false,
      error: 'A selected snapshot is no longer available.',
    })

    mocks.rpc.mockRejectedValueOnce(new Error('Failed to fetch'))
    await expect(createTaskAssignmentWithWorkOrderAndSnapshots(createInput({ snapshotIds: ['snap-1'] }))).resolves.toEqual({
      success: false,
      error: 'Network error. Try again.',
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('revokes through secure RPC first without direct delete on success', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { revoked: true }, error: null })

    const result = await revokeTaskAssignment('assignment-1')

    expect(result).toEqual({ success: true, data: true })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('revoke_employee_task_assignment', {
      p_assignment_id: 'assignment-1',
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('falls back to exactly one legacy parent delete when revoke RPC is proven missing', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: missingRevokeRpcError() })
    const { delete: del, eq } = mockLegacyDeleteSuccess()

    const result = await revokeTaskAssignment('assignment-1')

    expect(result).toEqual({ success: true, data: true })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.from).toHaveBeenCalledWith('employee_task_assignments')
    expect(del).toHaveBeenCalledTimes(1)
    expect(eq).toHaveBeenCalledWith('id', 'assignment-1')
  })

  it('does not fall back on revoke authorization errors', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Not authorized' },
    })

    const result = await revokeTaskAssignment('assignment-1')

    expect(result).toEqual({ success: false, error: 'Not authorized' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('does not fall back on revoke network errors', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('Network request failed'))

    const result = await revokeTaskAssignment('assignment-1')

    expect(result).toEqual({ success: false, error: 'Could not revoke assignment.' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('maps safe revoke RPC failures without exposing raw Supabase details', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'violates row level security policy for table employee_task_assignments' },
    })

    const result = await revokeTaskAssignment('assignment-1')

    expect(result).toEqual({ success: false, error: 'Could not revoke assignment.' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('maps revoke not-found results to the existing service result shape', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { revoked: false, reason: 'not_found' }, error: null })

    await expect(revokeTaskAssignment('missing-assignment')).resolves.toEqual({
      success: false,
      error: 'Assignment not found',
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('keeps update behavior on the assignment table update path', async () => {
    const single = vi.fn().mockResolvedValue({ data: assignment({ status: 'completed' }), error: null })
    const select = vi.fn((_cols: string) => ({ single }))
    const eq = vi.fn(() => ({ select }))
    const update = vi.fn(() => ({ eq }))
    mocks.from.mockReturnValueOnce({ update })

    const result = await updateTaskAssignment('assignment-1', { status: 'completed' })

    expect(result.success).toBe(true)
    expect(mocks.from).toHaveBeenCalledWith('employee_task_assignments')
    expect(update).toHaveBeenCalledWith({ status: 'completed' })
    expect(eq).toHaveBeenCalledWith('id', 'assignment-1')
    expect(mocks.rpc).not.toHaveBeenCalled()
    const projection = String(select.mock.calls[0]?.[0] ?? '')
    for (const postBaselineColumn of POST_BASELINE_ASSIGNMENT_COLUMNS) {
      expect(projection).not.toContain(postBaselineColumn)
    }
  })

  it('keeps dedicated employee hours-spent RPC behavior outside the base owner list projection', () => {
    expect(serviceSource).toContain('p_hours_spent: input.hoursSpent === undefined ? null : input.hoursSpent')
    const baseProjection = serviceSource.match(/const ASSIGNMENT_BASE_COLS =\s*\n?\s*'([^']+)'/)?.[1] || ''
    expect(baseProjection).not.toContain('hours_spent')
  })

  describe('isMissingSupabaseRpcError', () => {
    it('recognizes PostgREST PGRST202 and PostgreSQL 42883 for the named RPC', () => {
      expect(isMissingSupabaseRpcError(missingCreateRpcError(), 'create_employee_task_assignment_with_work_order')).toBe(true)
      expect(isMissingSupabaseRpcError({
        code: '42883',
        message: 'function public.revoke_employee_task_assignment(uuid) does not exist',
      }, 'revoke_employee_task_assignment')).toBe(true)
    })

    it('rejects auth, validation, network, and unrelated 404/500 shapes', () => {
      expect(isMissingSupabaseRpcError({ code: '42501', message: 'Not authorized' }, 'revoke_employee_task_assignment')).toBe(false)
      expect(isMissingSupabaseRpcError({ code: '23514', message: 'violates check constraint' }, 'create_employee_task_assignment_with_work_order')).toBe(false)
      expect(isMissingSupabaseRpcError({ message: 'Failed to fetch' }, 'create_employee_task_assignment_with_work_order')).toBe(false)
      expect(isMissingSupabaseRpcError({ code: '404', message: 'Not Found' }, 'create_employee_task_assignment_with_work_order')).toBe(false)
      expect(isMissingSupabaseRpcError({
        code: 'PGRST202',
        message: 'Could not find the function public.some_other_rpc in the schema cache',
      }, 'create_employee_task_assignment_with_work_order')).toBe(false)
    })
  })
})
