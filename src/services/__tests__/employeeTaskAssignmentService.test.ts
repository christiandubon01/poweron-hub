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
    getOperationsBlueprintAnnotations: mocks.getOperationsBlueprintAnnotations,
    getOperationsBlueprintLibrary: mocks.getOperationsBlueprintLibrary,
    getOperationsBlueprintScopeLayers: mocks.getOperationsBlueprintScopeLayers,
    getOperationsBlueprintWireProfiles: mocks.getOperationsBlueprintWireProfiles,
  }
})

vi.mock('@/services/adminTimecardService', () => ({
  getActiveEmployeeProfiles: mocks.getActiveEmployeeProfiles,
}))

vi.mock('@/features/blueprint-snapshots/blueprintSnapshotService', () => ({
  getBlueprintSnapshotsByIds: mocks.getBlueprintSnapshotsByIds,
}))

const {
  buildUpdateMyEmployeeTaskArgs,
  createTaskAssignmentWithWorkOrderAndSnapshots,
  createTaskAssignmentWithWorkOrder,
  getMyEmployeeWorkOrder,
  isMissingSupabaseRpcError,
  listOrgTaskAssignments,
  revokeTaskAssignment,
  updateMyEmployeeTask,
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
    mocks.getBlueprintSnapshotsByIds.mockResolvedValue({
      status: 'available',
      snapshots: [],
      totalCount: 0,
      nextCursor: null,
      hasMore: false,
    })
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

  it('freezes the matching full-page animation background by stable attached snapshot id', async () => {
    mocks.getBlueprintSnapshotsByIds.mockResolvedValueOnce({
      status: 'available',
      snapshots: [
        { id: 'area-2', pageNumber: 2, captureMode: 'area' },
        { id: 'full-2', pageNumber: 2, captureMode: 'full-page' },
      ],
      totalCount: 2,
      nextCursor: null,
      hasMore: false,
    })
    mocks.rpc.mockResolvedValueOnce({
      data: {
        assignment: assignment(),
        workOrderVersion: 1,
        attachmentCount: 2,
        orderedSnapshotIds: ['area-2', 'full-2'],
        idempotentReplay: false,
      },
      error: null,
    })
    const animationPresentation = {
      schemaVersion: 1 as const,
      routes: [{
        title: 'Kitchen Route',
        pageNumber: 2,
        pageAspect: 1,
        geometrySources: [
          { id: 'geometry-1', pageNumber: 2, label: 'Panel', rect: { x: 0.1, y: 0.1, w: 0.05, h: 0.05 }, shapeKind: 'electrical-panel' },
          { id: 'geometry-2', pageNumber: 2, label: 'Load', rect: { x: 0.8, y: 0.8, w: 0.05, h: 0.05 }, shapeKind: 'electrical-receptacle' },
        ],
        playback: {
          schemaVersion: 1 as const,
          id: 'employee-route-1',
          revision: 1,
          createdAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '1970-01-01T00:00:00.000Z',
          nodes: [
            { id: 'node-1', roles: ['source' as const], anchor: { kind: 'annotation-center' as const, annotationId: 'geometry-1' } },
            { id: 'node-2', roles: ['load' as const], anchor: { kind: 'annotation-center' as const, annotationId: 'geometry-2' } },
          ],
          edges: [{ id: 'edge-1', fromNodeId: 'node-1', toNodeId: 'node-2', channel: 'generic-route' as const, geometry: { kind: 'direct' as const } }],
          sources: [{ id: 'source-1', nodeId: 'node-1' }],
          manualTraversal: [{ id: 'step-1', edgeId: 'edge-1' }],
          branchOrders: [],
          events: [],
          playbackOptions: {
            travelSpeed: 0.35,
            nodePauseMs: 150,
            fixtureFadeMs: 300,
            deviceReactionMs: 120,
            dimmedCircuitOpacity: 0.45,
            branchMode: 'simultaneous' as const,
            sourceMode: 'simultaneous' as const,
            direction: 'forward' as const,
            loop: false,
            holdActivatedNodes: true,
            reducedMotion: false,
          },
        },
      }],
    }

    const result = await createTaskAssignmentWithWorkOrderAndSnapshots(createInput({
      snapshotIds: ['area-2', 'full-2'],
      workOrderPayload: { ...workOrderPayload, animationPresentation },
    }))

    expect(result.success).toBe(true)
    expect(mocks.getBlueprintSnapshotsByIds).toHaveBeenCalledWith(['area-2', 'full-2'])
    expect(mocks.rpc).toHaveBeenCalledWith(
      'create_employee_task_assignment_with_work_order_and_snapshots',
      expect.objectContaining({
        p_work_order_payload: expect.objectContaining({
          animationPresentation: expect.objectContaining({
            routes: [expect.objectContaining({
              background: { snapshotId: 'full-2', pageNumber: 2 },
            })],
          }),
        }),
      }),
    )
  })

  it('passes exactly fifteen selected snapshots to the 1D RPC in requested order', async () => {
    const fifteen = Array.from({ length: 15 }, (_, index) => `snap-${index + 1}`)
    mocks.rpc.mockResolvedValueOnce({
      data: {
        assignment: assignment(),
        workOrderVersion: 1,
        attachmentCount: 15,
        orderedSnapshotIds: fifteen,
        idempotentReplay: false,
      },
      error: null,
    })

    const result = await createTaskAssignmentWithWorkOrderAndSnapshots(createInput({
      snapshotIds: fifteen,
    }))

    expect(result.success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('create_employee_task_assignment_with_work_order_and_snapshots', expect.objectContaining({
      p_snapshot_ids: fifteen,
    }))
  })

  it('rejects sixteen selected snapshots before calling the 1D RPC', async () => {
    const sixteen = Array.from({ length: 16 }, (_, index) => `snap-${index + 1}`)

    const result = await createTaskAssignmentWithWorkOrderAndSnapshots(createInput({
      snapshotIds: sixteen,
    }))

    expect(result).toEqual({ success: false, error: 'Maximum of 15 snapshots.' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not deduplicate selected snapshots before the database duplicate-ID guard', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'Duplicate snapshot attachments are not allowed' },
    })

    const result = await createTaskAssignmentWithWorkOrderAndSnapshots(createInput({
      snapshotIds: ['snap-2', 'snap-1', 'snap-2'],
    }))

    expect(result).toEqual({ success: false, error: 'A selected snapshot is no longer available.' })
    expect(mocks.rpc).toHaveBeenCalledWith('create_employee_task_assignment_with_work_order_and_snapshots', expect.objectContaining({
      p_snapshot_ids: ['snap-2', 'snap-1', 'snap-2'],
    }))
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
    const baseProjection = serviceSource.match(/const ASSIGNMENT_BASE_COLS =\s*\n?\s*'([^']+)'/)?.[1] || ''
    expect(baseProjection).not.toContain('hours_spent')
    // hours_spent reaches the database only through the employee RPC.
    expect(serviceSource).toContain('args.p_hours_spent = hours')
  })

  it('loads employee Work Orders through the employee-safe RPC with assignment ID only', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        available: true,
        assignment: {
          id: 'assignment-1',
          workPackageId: 'package-1',
          workPackageName: 'Kitchen',
          projectId: 'project-1',
          projectName: 'Project One',
          blueprintSetId: 'set-1',
          dueDate: '2026-08-01',
          status: 'assigned',
        },
        workOrder: {
          version: 1,
          schemaVersion: 1,
          issuedAt: '2026-07-30T00:00:00.000Z',
          payload: workOrderPayload,
        },
        snapshots: [
          { snapshotId: 'snap-2', displayOrder: 2, caption: 'Second', pageNumber: 2, captureMode: 'area' },
          { snapshotId: 'snap-1', displayOrder: 1, caption: 'First', pageNumber: 1, captureMode: 'full-page' },
        ],
      },
      error: null,
    })

    const result = await getMyEmployeeWorkOrder('assignment-1')

    expect(result.success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_employee_work_order', {
      p_assignment_id: 'assignment-1',
    })
    expect(JSON.stringify(mocks.rpc.mock.calls[0]?.[1] ?? {})).not.toMatch(/org|employee|workPackage|storage/i)
    if (result.success) {
      expect(result.data.available).toBe(true)
      expect(result.data.workOrder?.payload).toBe(workOrderPayload)
      expect(result.data.snapshots.map((snapshot) => snapshot.snapshotId)).toEqual(['snap-1', 'snap-2'])
    }
    expect(mocks.getBackupData).not.toHaveBeenCalled()
  })

  it('treats malformed or unauthorized employee Work Order responses as unavailable', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { available: true, assignment: null, workOrder: null, snapshots: [] }, error: null })

    await expect(getMyEmployeeWorkOrder('assignment-1')).resolves.toEqual({
      success: true,
      data: {
        available: false,
        assignment: null,
        workOrder: null,
        snapshots: [],
      },
    })

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Not authorized' } })
    await expect(getMyEmployeeWorkOrder('assignment-2')).resolves.toEqual({
      success: true,
      data: {
        available: false,
        assignment: null,
        workOrder: null,
        snapshots: [],
      },
    })
  })

  /**
   * The live schema-cache failure this suite exists for:
   *   Could not find the function public.update_my_employee_task(
   *     p_assignment_id, p_completion_notes, p_hours_spent, p_status)
   *   in the schema cache
   *
   * PostgREST picks an overload from the exact set of argument NAMES posted, so a
   * present-but-null p_hours_spent still has to exist in the target signature.
   */
  describe('updateMyEmployeeTask RPC contract', () => {
    function missingUpdateRpcError(sentArgNames: string[]) {
      const names = [...sentArgNames].sort().join(', ')
      return {
        code: 'PGRST202',
        message: `Could not find the function public.update_my_employee_task(${names}) in the schema cache`,
        details: `Searched for the function public.update_my_employee_task with parameters ${names}`,
        hint: null,
      }
    }

    it('invokes the authoritative RPC name with p_assignment_id always present', async () => {
      await updateMyEmployeeTask({ assignmentId: 'assignment-1', status: 'in_progress' })

      expect(mocks.rpc).toHaveBeenCalledTimes(1)
      expect(mocks.rpc.mock.calls[0]?.[0]).toBe('update_my_employee_task')
      expect(mocks.rpc.mock.calls[0]?.[1]).toHaveProperty('p_assignment_id', 'assignment-1')
    })

    it('Start Task sends only p_assignment_id and p_status=in_progress', async () => {
      const result = await updateMyEmployeeTask({ assignmentId: 'assignment-1', status: 'in_progress' })

      expect(result).toEqual({ success: true, data: true })
      const args = mocks.rpc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(Object.keys(args).sort()).toEqual(['p_assignment_id', 'p_status'])
      expect(args.p_status).toBe('in_progress')
      // The defect: an unconditional null p_hours_spent made this call unresolvable.
      expect(args).not.toHaveProperty('p_hours_spent')
      expect(args).not.toHaveProperty('p_completion_notes')
    })

    it('Mark Complete sends completed, positive numeric hours and the notes string', async () => {
      const result = await updateMyEmployeeTask({
        assignmentId: 'assignment-1',
        status: 'completed',
        completionNotes: 'Rough-in finished',
        hoursSpent: 2.5,
      })

      expect(result).toEqual({ success: true, data: true })
      const args = mocks.rpc.mock.calls[0]?.[1] as Record<string, unknown>
      expect(Object.keys(args).sort()).toEqual([
        'p_assignment_id',
        'p_completion_notes',
        'p_hours_spent',
        'p_status',
      ])
      expect(args.p_status).toBe('completed')
      expect(args.p_completion_notes).toBe('Rough-in finished')
      expect(args.p_hours_spent).toBe(2.5)
      expect(typeof args.p_hours_spent).toBe('number')
      expect(typeof args.p_assignment_id).toBe('string')
    })

    it('omits notes and hours when they are not being changed', async () => {
      await updateMyEmployeeTask({ assignmentId: 'assignment-1', completionNotes: 'notes only' })
      expect(Object.keys(mocks.rpc.mock.calls[0]?.[1] as object).sort())
        .toEqual(['p_assignment_id', 'p_completion_notes'])

      mocks.rpc.mockClear()
      await updateMyEmployeeTask({ assignmentId: 'assignment-1', status: 'completed', hoursSpent: 4 })
      expect(Object.keys(mocks.rpc.mock.calls[0]?.[1] as object).sort())
        .toEqual(['p_assignment_id', 'p_hours_spent', 'p_status'])

      // null means "no change" in the function body, so it is omitted too.
      mocks.rpc.mockClear()
      await updateMyEmployeeTask({ assignmentId: 'assignment-1', status: 'in_progress', completionNotes: null, hoursSpent: null })
      expect(Object.keys(mocks.rpc.mock.calls[0]?.[1] as object).sort())
        .toEqual(['p_assignment_id', 'p_status'])
    })

    it('sends no unsupported argument name for any call shape', async () => {
      const supported = ['p_assignment_id', 'p_status', 'p_completion_notes', 'p_hours_spent']
      const shapes = [
        { assignmentId: 'a', status: 'in_progress' as const },
        { assignmentId: 'a', status: 'completed' as const, completionNotes: 'x', hoursSpent: 1 },
        { assignmentId: 'a', completionNotes: '' },
      ]
      for (const shape of shapes) {
        mocks.rpc.mockClear()
        await updateMyEmployeeTask(shape)
        for (const key of Object.keys(mocks.rpc.mock.calls[0]?.[1] as object)) {
          expect(supported).toContain(key)
        }
      }
    })

    it('rejects non-positive or unparseable hours before any request', async () => {
      for (const hoursSpent of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = await updateMyEmployeeTask({ assignmentId: 'a', status: 'completed', hoursSpent })
        expect(result).toEqual({
          success: false,
          error: 'Enter the hours worked as a number greater than zero.',
        })
      }
      expect(mocks.rpc).not.toHaveBeenCalled()
    })

    it('rejects an unknown status and a blank assignment id before any request', async () => {
      await expect(updateMyEmployeeTask({ assignmentId: 'a', status: 'archived' as never })).resolves.toEqual({
        success: false,
        error: 'Invalid task status',
      })
      await expect(updateMyEmployeeTask({ assignmentId: '   ', status: 'in_progress' })).resolves.toEqual({
        success: false,
        error: 'Assignment not found',
      })
      expect(mocks.rpc).not.toHaveBeenCalled()
    })

    it('reports a real failure instead of a false success, and never retries without hours', async () => {
      mocks.rpc.mockResolvedValueOnce({
        data: null,
        error: missingUpdateRpcError(['p_assignment_id', 'p_status', 'p_completion_notes', 'p_hours_spent']),
      })

      const result = await updateMyEmployeeTask({
        assignmentId: 'assignment-1',
        status: 'completed',
        completionNotes: 'done',
        hoursSpent: 3,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe(
          'Recording task hours is not available on this database yet. Ask your administrator to finish the task-hours update.',
        )
      }
      // Exactly one attempt: a silent retry without p_hours_spent would report a
      // completion that recorded no time.
      expect(mocks.rpc).toHaveBeenCalledTimes(1)
      expect(mocks.from).not.toHaveBeenCalled()
    })

    it('distinguishes a genuinely absent function from the missing hours parameter', async () => {
      mocks.rpc.mockResolvedValueOnce({
        data: null,
        error: missingUpdateRpcError(['p_assignment_id', 'p_status']),
      })

      await expect(updateMyEmployeeTask({ assignmentId: 'a', status: 'in_progress' })).resolves.toEqual({
        success: false,
        error: 'Task updates are not available on this database yet. Ask your administrator.',
      })
    })

    it('maps the function\'s own guard failures to safe employee-facing text', async () => {
      const cases: [string, string][] = [
        ['Only the primary assignee can update this task', 'Only the primary assignee can update this task'],
        ['Assignment not found', 'Assignment not found'],
        ['No active employee profile', 'Your employee profile is no longer active.'],
        ['Not assigned to this task', 'You are no longer assigned to this task'],
        ['hours_spent must be greater than zero', 'Enter the hours worked as a number greater than zero.'],
        ['violates row level security policy for table employee_task_assignments', 'Could not update task.'],
      ]
      for (const [raw, expected] of cases) {
        mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: raw } })
        const result = await updateMyEmployeeTask({ assignmentId: 'a', status: 'in_progress' })
        expect(result).toEqual({ success: false, error: expected })
      }
    })

    it('surfaces a network failure as a retryable error and writes no table directly', async () => {
      mocks.rpc.mockRejectedValueOnce(new Error('Failed to fetch'))

      await expect(updateMyEmployeeTask({ assignmentId: 'a', status: 'in_progress' })).resolves.toEqual({
        success: false,
        error: 'Network error. Try again.',
      })
      expect(mocks.from).not.toHaveBeenCalled()
    })

    it('requires an authenticated session before calling the RPC', async () => {
      mocks.authGetUser.mockResolvedValueOnce({ data: { user: null } })

      await expect(updateMyEmployeeTask({ assignmentId: 'a', status: 'in_progress' })).resolves.toEqual({
        success: false,
        error: 'Not authenticated',
      })
      expect(mocks.rpc).not.toHaveBeenCalled()
    })

    it('builds argument sets compatible with both live signatures', () => {
      const start = buildUpdateMyEmployeeTaskArgs({ assignmentId: 'a', status: 'in_progress' })
      expect(start).toEqual({ success: true, data: { p_assignment_id: 'a', p_status: 'in_progress' } })

      const complete = buildUpdateMyEmployeeTaskArgs({
        assignmentId: ' a ',
        status: 'completed',
        completionNotes: 'x',
        hoursSpent: 1.25,
      })
      expect(complete).toEqual({
        success: true,
        data: { p_assignment_id: 'a', p_status: 'completed', p_completion_notes: 'x', p_hours_spent: 1.25 },
      })

      // Start Task resolves against the three-argument 085 signature and the
      // four-argument 092 signature alike; only hours needs 092.
      const threeArgParams = new Set(['p_assignment_id', 'p_status', 'p_completion_notes'])
      if (start.success) {
        expect(Object.keys(start.data).every((key) => threeArgParams.has(key))).toBe(true)
      }
      if (complete.success) {
        expect(Object.keys(complete.data).some((key) => !threeArgParams.has(key))).toBe(true)
      }
    })
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
