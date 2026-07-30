/**
 * employeeTaskAssignmentService.ts — Owner + employee task delegation (Feature 1)
 *
 * Owner path: direct table CRUD on employee_task_assignments (RLS owner/admin).
 * Employee path: get_my_employee_tasks / update_my_employee_task RPCs only —
 * those omit lead_employee_id and expose can_complete instead.
 *
 * update_my_employee_task has two live signatures in the wild: the three-argument
 * one from 085 and the four-argument p_hours_spent one from 092. Overloads are
 * resolved by argument NAME, so updateMyEmployeeTask sends only the parameters it
 * is actually changing — see buildUpdateMyEmployeeTaskArgs.
 *
 * Work packages are read from BackupData JSON (operationsBlueprintScopeLayers);
 * there is no SQL work_packages table. Assignments store denormalized name /
 * project context. Does not modify backupDataService or blueprintLibraryService.
 */

import { supabase } from '@/lib/supabase'
import { getBackupData } from '@/services/backupDataService'
import {
  getOperationsBlueprintAnnotations,
  getOperationsBlueprintLibrary,
  getOperationsBlueprintScopeLayers,
  getOperationsBlueprintWireProfiles,
} from '@/services/blueprintLibraryService'
import { getActiveEmployeeProfiles, type AdminEmployeeProfile } from '@/services/adminTimecardService'
import {
  addEmployeeAnimationBackgrounds,
  buildWorkOrderPayloadV1Draft,
  parseEmployeeAnimationPresentation,
  type WorkOrderPayloadV1Draft,
} from '@/features/work-orders'
import { getBlueprintSnapshotsByIds } from '@/features/blueprint-snapshots/blueprintSnapshotService'
import { isValidPageSizeInches, type CalibrationData, type DetectedScaleResult, type PageSizeInches } from '@/features/blueprint-measurements'

const from = supabase.from as any
const rpc = supabase.rpc as any

export type TaskAssignmentStatus = 'assigned' | 'in_progress' | 'completed'

export interface AssignableWorkPackage {
  workPackageId: string
  workPackageName: string
  projectId: string
  projectName: string
  blueprintSetId: string
  blueprintTitle: string
}

export interface AssignableProject {
  id: string
  name: string
  status: string
}

export interface AssignableBlueprint {
  blueprintSetId: string
  title: string
  projectId: string
  projectName: string
}

/** Active / open project statuses for the delegation picker (excludes terminal). */
const ACTIVE_PROJECT_STATUSES = [
  'lead',
  'estimate',
  'pending',
  'approved',
  'in_progress',
  'on_hold',
  'punch_list',
  'closeout',
] as const


export interface EmployeeTaskAssignment {
  id: string
  org_id: string
  client_request_id?: string | null
  work_package_id: string
  work_package_name: string
  project_id: string | null
  project_name: string | null
  blueprint_set_id: string | null
  lead_employee_id: string
  assigned_employee_ids: string[]
  assigned_by: string
  assigned_at: string
  due_date: string | null
  status: TaskAssignmentStatus
  completion_notes: string | null
  hours_spent?: number | null
  completed_at: string | null
  completed_by: string | null
  updated_at: string
  created_at?: string
  current_work_order_version?: number | null
}

/** Employee-facing row — never includes lead_employee_id. */
export interface EmployeeMyTask {
  id: string
  org_id: string
  work_package_id: string
  work_package_name: string
  project_id: string | null
  project_name: string | null
  due_date: string | null
  status: TaskAssignmentStatus
  completion_notes: string | null
  hours_spent?: number | null
  completed_at: string | null
  assigned_at: string
  updated_at: string
  /** True only for the private primary assignee; does not reveal who that is to others. */
  can_complete: boolean
}

export interface EmployeeWorkOrderAssignmentHeader {
  id: string
  workPackageId: string
  workPackageName: string
  projectId: string | null
  projectName: string | null
  blueprintSetId: string | null
  dueDate: string | null
  status: TaskAssignmentStatus
}

export interface EmployeeWorkOrderSnapshotMetadata {
  snapshotId: string
  displayOrder: number
  caption: string | null
  pageNumber: number | null
  captureMode: string | null
}

export interface EmployeeWorkOrderVersion {
  version: number
  schemaVersion: number
  issuedAt: string
  payload: unknown
}

export interface EmployeeWorkOrderRead {
  available: boolean
  assignment: EmployeeWorkOrderAssignmentHeader | null
  workOrder: EmployeeWorkOrderVersion | null
  snapshots: EmployeeWorkOrderSnapshotMetadata[]
}

export interface CreateTaskAssignmentInput {
  orgId: string
  workPackageId: string
  workPackageName: string
  projectId?: string | null
  projectName?: string | null
  blueprintSetId?: string | null
  leadEmployeeId: string
  assignedEmployeeIds: string[]
  dueDate?: string | null
  status?: TaskAssignmentStatus
}

export interface CreateTaskAssignmentWithWorkOrderInput extends CreateTaskAssignmentInput {
  assignmentId: string
  clientRequestId: string
  blueprintTitle?: string | null
  workOrderPayload: WorkOrderPayloadV1Draft
}

export interface CreateTaskAssignmentWithWorkOrderAndSnapshotsInput extends CreateTaskAssignmentWithWorkOrderInput {
  snapshotIds?: string[]
}

export interface UpdateTaskAssignmentInput {
  leadEmployeeId?: string
  assignedEmployeeIds?: string[]
  dueDate?: string | null
  status?: TaskAssignmentStatus
  completionNotes?: string | null
  workPackageName?: string
  projectName?: string | null
}

type Result<T> = { success: true; data: T } | { success: false; error: string }

/** Pre-092/pre-093 projection. Do not add 092/093 columns without a compatibility plan. */
const ASSIGNMENT_BASE_COLS =
  'id, org_id, work_package_id, work_package_name, project_id, project_name, blueprint_set_id, lead_employee_id, assigned_employee_ids, assigned_by, assigned_at, due_date, status, completion_notes, completed_at, completed_by, updated_at, created_at'

// ── Work package catalog (BackupData read-only) ───────────────────────────────

/**
 * Lists live work packages from BackupData for owner assignment UI.
 * Uses getBackupData + blueprint library accessors — does not write backup.
 */
export function listAssignableWorkPackages(backup?: unknown): AssignableWorkPackage[] {
  const data = backup ?? getBackupData()
  const library = getOperationsBlueprintLibrary(data).filter(
    (item) => item.status !== 'archived' && !(item as { deletedAt?: string }).deletedAt,
  )
  const out: AssignableWorkPackage[] = []

  for (const set of library) {
    const layers = getOperationsBlueprintScopeLayers(data, set.id)
    for (const layer of layers) {
      if (!layer?.id || !layer?.name) continue
      out.push({
        workPackageId: layer.id,
        workPackageName: layer.name,
        projectId: set.projectId,
        projectName: set.projectName || set.projectId,
        blueprintSetId: set.id,
        blueprintTitle: set.title || set.id,
      })
    }
  }

  out.sort((a, b) => {
    const p = (a.projectName || '').localeCompare(b.projectName || '')
    if (p !== 0) return p
    return a.workPackageName.localeCompare(b.workPackageName)
  })
  return out
}

/**
 * BackupData projects for Step 1 of the cascading picker.
 * Active/open only (excludes deleted, archived, completed, and canceled).
 */
export async function listAssignableProjects(): Promise<Result<AssignableProject[]>> {
  try {
    const backup = getBackupData()
    if (!backup) return { success: true, data: [] }

    const projects = (backup.projects || [])
      .filter((p) =>
        !p.deletedAt &&
        !(p as any).archived &&
        p.status === 'active' || ACTIVE_PROJECT_STATUSES.includes(p.status as any)
      )
      .map((p) => ({
        id: String(p.id),
        name: String(p.name || 'Untitled project'),
        status: String(p.status || ''),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { success: true, data: projects }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTaskAssignmentService.listAssignableProjects]', err)
    return { success: false, error: message }
  }
}

/**
 * Blueprint documents for a SQL project id — same read pattern as Feature 1:
 * getBackupData() → getOperationsBlueprintLibrary(backup) filtered by projectId.
 */
export function listBlueprintsForProject(
  projectId: string,
  backup?: unknown,
): AssignableBlueprint[] {
  const cleanProjectId = String(projectId || '').trim()
  if (!cleanProjectId) return []

  const data = backup ?? getBackupData()
  const library = getOperationsBlueprintLibrary(data).filter(
    (item) =>
      String(item.projectId || '').trim() === cleanProjectId &&
      item.status !== 'archived' &&
      !(item as { deletedAt?: string }).deletedAt,
  )

  return library
    .map((set) => ({
      blueprintSetId: set.id,
      title: set.title || set.id,
      projectId: set.projectId,
      projectName: set.projectName || set.projectId,
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * Work packages for a blueprint set — getOperationsBlueprintScopeLayers(backup, setId).
 */
export function listWorkPackagesForBlueprint(
  blueprintSetId: string,
  backup?: unknown,
): AssignableWorkPackage[] {
  const cleanSetId = String(blueprintSetId || '').trim()
  if (!cleanSetId) return []

  const data = backup ?? getBackupData()
  const library = getOperationsBlueprintLibrary(data)
  const set = library.find((item) => item.id === cleanSetId)
  const layers = getOperationsBlueprintScopeLayers(data, cleanSetId)

  return layers
    .filter((layer) => layer?.id && layer?.name)
    .map((layer) => ({
      workPackageId: layer.id,
      workPackageName: layer.name,
      projectId: set?.projectId || '',
      projectName: set?.projectName || set?.projectId || '',
      blueprintSetId: cleanSetId,
      blueprintTitle: set?.title || cleanSetId,
    }))
    .sort((a, b) => a.workPackageName.localeCompare(b.workPackageName))
}


// ── Owner admin CRUD ──────────────────────────────────────────────────────────

export async function listOrgTaskAssignments(): Promise<Result<EmployeeTaskAssignment[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { data, error } = await from('employee_task_assignments')
      .select(ASSIGNMENT_BASE_COLS)
      .order('assigned_at', { ascending: false })

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as EmployeeTaskAssignment[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTaskAssignmentService.listOrgTaskAssignments]', err)
    return { success: false, error: message }
  }
}

export async function createTaskAssignment(
  input: CreateTaskAssignmentInput,
): Promise<Result<EmployeeTaskAssignment>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const assigned = uniqueIds(input.assignedEmployeeIds)
    if (assigned.length === 0) {
      return { success: false, error: 'Select at least one employee' }
    }
    if (!assigned.includes(input.leadEmployeeId)) {
      return { success: false, error: 'Primary assignee must be one of the selected employees' }
    }

    const row = {
      org_id: input.orgId,
      work_package_id: input.workPackageId,
      work_package_name: input.workPackageName,
      project_id: input.projectId ?? null,
      project_name: input.projectName ?? null,
      blueprint_set_id: input.blueprintSetId ?? null,
      lead_employee_id: input.leadEmployeeId,
      assigned_employee_ids: assigned,
      assigned_by: user.id,
      due_date: input.dueDate || null,
      status: input.status || 'assigned',
      completion_notes: null,
    }

    const { data, error } = await from('employee_task_assignments')
      .insert(row)
      .select(ASSIGNMENT_BASE_COLS)
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as EmployeeTaskAssignment }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTaskAssignmentService.createTaskAssignment]', err)
    return { success: false, error: message }
  }
}

export async function createTaskAssignmentWithWorkOrder(
  input: CreateTaskAssignmentWithWorkOrderInput,
): Promise<Result<{
  assignment: EmployeeTaskAssignment
  workOrderVersion?: 1
  attachmentCount: number
  orderedSnapshotIds: string[]
  idempotentReplay: boolean
  workOrderCreated: boolean
}>> {
  return createTaskAssignmentWithWorkOrderAndSnapshots({ ...input, snapshotIds: [] })
}

export async function createTaskAssignmentWithWorkOrderAndSnapshots(
  input: CreateTaskAssignmentWithWorkOrderAndSnapshotsInput,
): Promise<Result<{
  assignment: EmployeeTaskAssignment
  workOrderVersion?: 1
  attachmentCount: number
  orderedSnapshotIds: string[]
  idempotentReplay: boolean
  workOrderCreated: boolean
}>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const assigned = uniqueIds(input.assignedEmployeeIds)
    const submittedSnapshotIds = input.snapshotIds ?? []
    const snapshotIds = submittedSnapshotIds.map((id) => String(id || '').trim()).filter(Boolean)
    if (assigned.length === 0) {
      return { success: false, error: 'Select at least one employee' }
    }
    if (!assigned.includes(input.leadEmployeeId)) {
      return { success: false, error: 'Primary assignee must be one of the selected employees' }
    }
    if (snapshotIds.length > 15) {
      return { success: false, error: 'Maximum of 15 snapshots.' }
    }
    const workOrderPayload = await captureAnimationBackgroundReferences(input.workOrderPayload, snapshotIds)

    const { data, error } = await rpc('create_employee_task_assignment_with_work_order_and_snapshots', {
      p_client_request_id: input.clientRequestId,
      p_assignment_id: input.assignmentId,
      p_work_package_id: input.workPackageId,
      p_work_package_name: input.workPackageName,
      p_project_id: input.projectId ?? '',
      p_project_name: input.projectName ?? '',
      p_blueprint_set_id: input.blueprintSetId ?? '',
      p_blueprint_title: input.blueprintTitle ?? null,
      p_lead_employee_id: input.leadEmployeeId,
      p_assigned_employee_ids: assigned,
      p_due_date: input.dueDate || null,
      p_status: input.status || 'assigned',
      p_work_order_payload: workOrderPayload,
      p_snapshot_ids: snapshotIds,
    })

    if (error) {
      if (isMissingSupabaseRpcError(error, 'create_employee_task_assignment_with_work_order_and_snapshots')) {
        if (snapshotIds.length > 0) {
          return { success: false, error: 'Snapshot assignment storage is not available yet.' }
        }
        return createTaskAssignmentWithWorkOrder1C({ ...input, assignedEmployeeIds: assigned })
      }
      return { success: false, error: safeSnapshotAssignmentError(error.message) }
    }

    const result = data as {
      assignment?: EmployeeTaskAssignment
      workOrderVersion?: number
      attachmentCount?: number
      orderedSnapshotIds?: string[]
      idempotentReplay?: boolean
    } | null
    if (!result?.assignment || result.workOrderVersion !== 1) {
      return { success: false, error: snapshotIds.length > 0 ? 'Could not create assignment with snapshots.' : 'Could not create assignment.' }
    }

    return {
      success: true,
      data: {
        assignment: result.assignment,
        workOrderVersion: 1,
        attachmentCount: Number(result.attachmentCount || 0),
        orderedSnapshotIds: Array.isArray(result.orderedSnapshotIds) ? result.orderedSnapshotIds.map(String) : [],
        idempotentReplay: !!result.idempotentReplay,
        workOrderCreated: true,
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTaskAssignmentService.createTaskAssignmentWithWorkOrderAndSnapshots]', err)
    return { success: false, error: safeSnapshotAssignmentError(message) }
  }
}

async function captureAnimationBackgroundReferences(
  payload: WorkOrderPayloadV1Draft,
  orderedSnapshotIds: string[],
): Promise<WorkOrderPayloadV1Draft> {
  const presentation = parseEmployeeAnimationPresentation(payload.animationPresentation)
  if (!presentation) return payload
  if (orderedSnapshotIds.length === 0) {
    return {
      ...payload,
      animationPresentation: addEmployeeAnimationBackgrounds(presentation, [], []),
    }
  }
  const snapshots = await getBlueprintSnapshotsByIds(orderedSnapshotIds)
  if (snapshots.status !== 'available') {
    return {
      ...payload,
      animationPresentation: addEmployeeAnimationBackgrounds(presentation, [], []),
    }
  }
  return {
    ...payload,
    animationPresentation: addEmployeeAnimationBackgrounds(
      presentation,
      snapshots.snapshots.map((snapshot) => ({
        id: snapshot.id,
        pageNumber: snapshot.pageNumber,
        captureMode: snapshot.captureMode,
      })),
      orderedSnapshotIds,
    ),
  }
}

async function createTaskAssignmentWithWorkOrder1C(
  input: CreateTaskAssignmentWithWorkOrderInput,
): Promise<Result<{
  assignment: EmployeeTaskAssignment
  workOrderVersion?: 1
  attachmentCount: number
  orderedSnapshotIds: string[]
  idempotentReplay: boolean
  workOrderCreated: boolean
}>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const assigned = uniqueIds(input.assignedEmployeeIds)
    if (assigned.length === 0) {
      return { success: false, error: 'Select at least one employee' }
    }
    if (!assigned.includes(input.leadEmployeeId)) {
      return { success: false, error: 'Primary assignee must be one of the selected employees' }
    }

    const { data, error } = await rpc('create_employee_task_assignment_with_work_order', {
      p_client_request_id: input.clientRequestId,
      p_assignment_id: input.assignmentId,
      p_work_package_id: input.workPackageId,
      p_work_package_name: input.workPackageName,
      p_project_id: input.projectId ?? '',
      p_project_name: input.projectName ?? '',
      p_blueprint_set_id: input.blueprintSetId ?? '',
      p_blueprint_title: input.blueprintTitle ?? null,
      p_lead_employee_id: input.leadEmployeeId,
      p_assigned_employee_ids: assigned,
      p_due_date: input.dueDate || null,
      p_status: input.status || 'assigned',
      p_work_order_payload: input.workOrderPayload,
    })

    if (error) {
      // Pre-093 only: fall back to legacy assignment insert when the atomic RPC is absent.
      if (isMissingSupabaseRpcError(error, 'create_employee_task_assignment_with_work_order')) {
        const legacy = await createTaskAssignment({
          orgId: input.orgId,
          workPackageId: input.workPackageId,
          workPackageName: input.workPackageName,
          projectId: input.projectId,
          projectName: input.projectName,
          blueprintSetId: input.blueprintSetId,
          leadEmployeeId: input.leadEmployeeId,
          assignedEmployeeIds: assigned,
          dueDate: input.dueDate,
          status: input.status,
        })
        if (!legacy.success) return legacy
        return {
          success: true,
          data: {
            assignment: legacy.data,
            attachmentCount: 0,
            orderedSnapshotIds: [],
            idempotentReplay: false,
            workOrderCreated: false,
          },
        }
      }
      return { success: false, error: safeAssignmentError(error.message) }
    }

    const result = data as {
      assignment?: EmployeeTaskAssignment
      workOrderVersion?: number
      idempotentReplay?: boolean
    } | null
    if (!result?.assignment || result.workOrderVersion !== 1) {
      return { success: false, error: 'Could not create assignment.' }
    }

    return {
      success: true,
      data: {
        assignment: result.assignment,
        workOrderVersion: 1,
        attachmentCount: 0,
        orderedSnapshotIds: [],
        idempotentReplay: !!result.idempotentReplay,
        workOrderCreated: true,
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTaskAssignmentService.createTaskAssignmentWithWorkOrder]', err)
    return { success: false, error: safeAssignmentError(message) }
  }
}

export function buildTaskAssignmentWorkOrderDraft(input: {
  projectId: string
  projectName: string
  blueprintSetId: string
  blueprintTitle?: string | null
  workPackageId: string
}): Result<WorkOrderPayloadV1Draft> {
  try {
    const backup = getBackupData()
    if (!backup) return { success: false, error: 'Could not load Work Order source data.' }

    const workPackage = getOperationsBlueprintScopeLayers(backup, input.blueprintSetId)
      .find((layer) => layer.id === input.workPackageId)
    if (!workPackage) return { success: false, error: 'Selected work package was not found.' }

    const library = getOperationsBlueprintLibrary(backup)
    const blueprint = library.find((item) => item.id === input.blueprintSetId)
    const annotations = getOperationsBlueprintAnnotations(backup, input.blueprintSetId)
    const wireProfiles = getOperationsBlueprintWireProfiles(backup, input.projectId)
    const savedCalibrations = readStoredBlueprintCalibrations(input.blueprintSetId)
    const detectedScales = readStoredBlueprintDetectedScales(input.blueprintSetId)
    const getPageSizeInches = buildStoredPageSizeResolver(blueprint, savedCalibrations)

    return {
      success: true,
      data: buildWorkOrderPayloadV1Draft({
        projectId: input.projectId,
        projectName: input.projectName,
        blueprintSetId: input.blueprintSetId,
        blueprintTitle: input.blueprintTitle || blueprint?.title || input.blueprintSetId,
        workPackage,
        blueprint,
        annotations,
        wireProfiles,
        savedCalibrations,
        detectedScales,
        getPageSizeInches,
      }),
    }
  } catch (err: unknown) {
    console.error('[employeeTaskAssignmentService.buildTaskAssignmentWorkOrderDraft]', err)
    return { success: false, error: 'Could not build Work Order.' }
  }
}

export async function updateTaskAssignment(
  assignmentId: string,
  patch: UpdateTaskAssignmentInput,
): Promise<Result<EmployeeTaskAssignment>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const updates: Record<string, unknown> = {}
    if (patch.assignedEmployeeIds) {
      const assigned = uniqueIds(patch.assignedEmployeeIds)
      if (assigned.length === 0) {
        return { success: false, error: 'Select at least one employee' }
      }
      updates.assigned_employee_ids = assigned
      const lead = patch.leadEmployeeId
      if (lead && !assigned.includes(lead)) {
        return { success: false, error: 'Primary assignee must be one of the selected employees' }
      }
      if (!lead && patch.leadEmployeeId === undefined) {
        // Keep existing lead if still in list — validated server-side via CHECK on update if we set lead
      }
    }
    if (patch.leadEmployeeId !== undefined) updates.lead_employee_id = patch.leadEmployeeId
    if (patch.dueDate !== undefined) updates.due_date = patch.dueDate
    if (patch.status !== undefined) updates.status = patch.status
    if (patch.completionNotes !== undefined) updates.completion_notes = patch.completionNotes
    if (patch.workPackageName !== undefined) updates.work_package_name = patch.workPackageName
    if (patch.projectName !== undefined) updates.project_name = patch.projectName

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'No changes' }
    }

    const { data, error } = await from('employee_task_assignments')
      .update(updates)
      .eq('id', assignmentId)
      .select(ASSIGNMENT_BASE_COLS)
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as EmployeeTaskAssignment }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTaskAssignmentService.updateTaskAssignment]', err)
    return { success: false, error: message }
  }
}

export async function revokeTaskAssignment(assignmentId: string): Promise<Result<true>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { data, error } = await rpc('revoke_employee_task_assignment', {
      p_assignment_id: assignmentId,
    })

    if (error) {
      // Pre-093 only: no Work Order children exist yet — direct parent delete is safe.
      if (isMissingSupabaseRpcError(error, 'revoke_employee_task_assignment')) {
        const { error: deleteError } = await from('employee_task_assignments')
          .delete()
          .eq('id', assignmentId)
        if (deleteError) return { success: false, error: safeRevokeError(deleteError.message) }
        return { success: true, data: true }
      }
      return { success: false, error: safeRevokeError(error.message) }
    }
    if (data && typeof data === 'object' && (data as { revoked?: boolean }).revoked === false) {
      return { success: false, error: 'Assignment not found' }
    }
    return { success: true, data: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTaskAssignmentService.revokeTaskAssignment]', err)
    return { success: false, error: safeRevokeError(message) }
  }
}

export async function listAssignableEmployees(): Promise<Result<AdminEmployeeProfile[]>> {
  const res = await getActiveEmployeeProfiles()
  if (!res.success || !res.data) {
    return { success: false, error: res.error || 'Could not load employees' }
  }
  // Only accepted portal employees (have a linked user_id).
  return {
    success: true,
    data: res.data.filter((p) => !!p.user_id),
  }
}

// ── Employee portal ───────────────────────────────────────────────────────────

export async function getMyEmployeeTasks(): Promise<Result<EmployeeMyTask[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { data, error } = await rpc('get_my_employee_tasks')
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as EmployeeMyTask[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTaskAssignmentService.getMyEmployeeTasks]', err)
    return { success: false, error: message }
  }
}

export async function getMyEmployeeWorkOrder(assignmentId: string): Promise<Result<EmployeeWorkOrderRead>> {
  try {
    const cleanAssignmentId = String(assignmentId || '').trim()
    if (!cleanAssignmentId) return { success: true, data: unavailableEmployeeWorkOrder() }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { data, error } = await rpc('get_my_employee_work_order', {
      p_assignment_id: cleanAssignmentId,
    })

    if (error) return { success: true, data: unavailableEmployeeWorkOrder() }
    return { success: true, data: normalizeEmployeeWorkOrderRead(data) }
  } catch (err: unknown) {
    console.error('[employeeTaskAssignmentService.getMyEmployeeWorkOrder]', err)
    return { success: true, data: unavailableEmployeeWorkOrder() }
  }
}

export interface UpdateMyEmployeeTaskInput {
  assignmentId: string
  status?: TaskAssignmentStatus
  completionNotes?: string | null
  hoursSpent?: number | null
}

/** Named arguments actually posted to public.update_my_employee_task. */
export interface UpdateMyEmployeeTaskArgs {
  p_assignment_id: string
  p_status?: TaskAssignmentStatus
  p_completion_notes?: string
  p_hours_spent?: number
}

/**
 * Builds the named argument set for public.update_my_employee_task.
 *
 * PostgREST resolves an RPC overload from the exact set of argument NAMES in the
 * request body, so an argument that is present-but-null still has to exist in the
 * target signature. Sending p_hours_spent unconditionally therefore fails with
 * PGRST202 ('Could not find the function public.update_my_employee_task(...) in
 * the schema cache') against any database still on the pre-092 three-argument
 * signature — including a Start Task call that carries no hours at all.
 *
 * The function treats a NULL parameter as 'no change', so omitting an unchanged
 * parameter is behaviorally identical to passing NULL while staying compatible
 * with both the three- and four-argument signatures.
 */
export function buildUpdateMyEmployeeTaskArgs(
  input: UpdateMyEmployeeTaskInput,
): Result<UpdateMyEmployeeTaskArgs> {
  const assignmentId = String(input?.assignmentId || '').trim()
  if (!assignmentId) return { success: false, error: 'Assignment not found' }

  const args: UpdateMyEmployeeTaskArgs = { p_assignment_id: assignmentId }

  if (input.status != null) {
    const status = cleanStatus(input.status)
    if (!status) return { success: false, error: 'Invalid task status' }
    args.p_status = status
  }

  if (input.completionNotes != null) {
    args.p_completion_notes = String(input.completionNotes)
  }

  // Mirrors the function's own hours guard so a rejected value costs no round trip.
  if (input.hoursSpent != null) {
    const hours = Number(input.hoursSpent)
    if (!Number.isFinite(hours) || hours <= 0) {
      return { success: false, error: 'Enter the hours worked as a number greater than zero.' }
    }
    args.p_hours_spent = hours
  }

  return { success: true, data: args }
}

export async function updateMyEmployeeTask(input: UpdateMyEmployeeTaskInput): Promise<Result<true>> {
  const built = buildUpdateMyEmployeeTaskArgs(input)
  if (!built.success) return built
  const args = built.data

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { error } = await rpc('update_my_employee_task', args)
    if (error) return { success: false, error: safeTaskUpdateError(error, args) }
    return { success: true, data: true }
  } catch (err: unknown) {
    console.error('[employeeTaskAssignmentService.updateMyEmployeeTask]', err)
    const message = err instanceof Error ? err.message : 'Network error'
    return { success: false, error: safeTaskUpdateError({ message }, args) }
  }
}

/**
 * Employee-facing message for a failed task update.
 *
 * Never retries a rejected write with fewer arguments: dropping p_hours_spent to
 * satisfy an older signature would silently discard hours the employee typed and
 * report a completion that recorded no time.
 */
function safeTaskUpdateError(error: unknown, args: UpdateMyEmployeeTaskArgs): string {
  const message = String((error as { message?: string })?.message ?? '')

  if (isMissingSupabaseRpcError(error, 'update_my_employee_task')) {
    return args.p_hours_spent === undefined
      ? 'Task updates are not available on this database yet. Ask your administrator.'
      : 'Recording task hours is not available on this database yet. Ask your administrator to finish the task-hours update.'
  }

  if (/not authenticated/i.test(message)) return 'Not authenticated'
  if (/no active employee profile/i.test(message)) return 'Your employee profile is no longer active.'
  if (/assignment not found/i.test(message)) return 'Assignment not found'
  if (/only the primary assignee/i.test(message)) return 'Only the primary assignee can update this task'
  if (/not assigned to this task/i.test(message)) return 'You are no longer assigned to this task'
  if (/invalid status/i.test(message)) return 'Invalid task status'
  if (/hours_spent must be greater than zero/i.test(message)) {
    return 'Enter the hours worked as a number greater than zero.'
  }
  if (/failed to fetch|networkerror|network request failed|timeout/i.test(message)) {
    return 'Network error. Try again.'
  }
  return 'Could not update task.'
}

function normalizeEmployeeWorkOrderRead(value: unknown): EmployeeWorkOrderRead {
  if (!isPlainObject(value)) return unavailableEmployeeWorkOrder()
  const available = value.available === true
  const assignment = normalizeEmployeeWorkOrderAssignment(value.assignment)
  const workOrder = normalizeEmployeeWorkOrderVersion(value.workOrder)
  const snapshots = normalizeEmployeeWorkOrderSnapshots(value.snapshots)

  if (!available || !assignment || !workOrder) {
    return {
      available: false,
      assignment,
      workOrder: null,
      snapshots: [],
    }
  }

  return {
    available: true,
    assignment,
    workOrder,
    snapshots,
  }
}

function unavailableEmployeeWorkOrder(): EmployeeWorkOrderRead {
  return {
    available: false,
    assignment: null,
    workOrder: null,
    snapshots: [],
  }
}

function normalizeEmployeeWorkOrderAssignment(value: unknown): EmployeeWorkOrderAssignmentHeader | null {
  if (!isPlainObject(value)) return null
  const id = cleanString(value.id)
  const workPackageId = cleanString(value.workPackageId)
  const workPackageName = cleanString(value.workPackageName)
  const status = cleanStatus(value.status)
  if (!id || !workPackageId || !workPackageName || !status) return null
  return {
    id,
    workPackageId,
    workPackageName,
    projectId: nullableString(value.projectId),
    projectName: nullableString(value.projectName),
    blueprintSetId: nullableString(value.blueprintSetId),
    dueDate: nullableString(value.dueDate),
    status,
  }
}

function normalizeEmployeeWorkOrderVersion(value: unknown): EmployeeWorkOrderVersion | null {
  if (!isPlainObject(value) || !isPlainObject(value.payload)) return null
  const version = Number(value.version)
  const schemaVersion = Number(value.schemaVersion)
  const issuedAt = cleanString(value.issuedAt)
  if (!Number.isInteger(version) || version < 1 || !Number.isInteger(schemaVersion) || schemaVersion < 1 || !issuedAt) {
    return null
  }
  return {
    version,
    schemaVersion,
    issuedAt,
    payload: value.payload,
  }
}

function normalizeEmployeeWorkOrderSnapshots(value: unknown): EmployeeWorkOrderSnapshotMetadata[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!isPlainObject(entry)) return null
      const snapshotId = cleanString(entry.snapshotId)
      const displayOrder = Number(entry.displayOrder)
      if (!snapshotId || !Number.isFinite(displayOrder)) return null
      return {
        snapshotId,
        displayOrder,
        caption: nullableString(entry.caption),
        pageNumber: nullablePositiveInteger(entry.pageNumber),
        captureMode: nullableString(entry.captureMode),
      } satisfies EmployeeWorkOrderSnapshotMetadata
    })
    .filter((entry): entry is EmployeeWorkOrderSnapshotMetadata => Boolean(entry))
    .sort((a, b) => a.displayOrder - b.displayOrder)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableString(value: unknown): string | null {
  const text = cleanString(value)
  return text || null
}

function nullablePositiveInteger(value: unknown): number | null {
  if (value == null) return null
  const next = Number(value)
  return Number.isInteger(next) && next > 0 ? next : null
}

function cleanStatus(value: unknown): TaskAssignmentStatus | null {
  return value === 'assigned' || value === 'in_progress' || value === 'completed' ? value : null
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
}

/**
 * True only when the error specifically proves the named RPC is absent
 * (PostgREST schema-cache / PostgreSQL undefined_function). Does not match
 * auth, validation, or network failures.
 */
export function isMissingSupabaseRpcError(error: unknown, functionName: string): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as {
    code?: string | number
    message?: string
    details?: string
    hint?: string
  }
  const code = String(err.code ?? '').trim()
  const fn = String(functionName || '').trim().toLowerCase()
  if (!fn) return false

  const message = String(err.message ?? '')
  const details = String(err.details ?? '')
  const hint = String(err.hint ?? '')
  const haystack = `${message}\n${details}\n${hint}`.toLowerCase()

  // Never treat auth / permission failures as missing RPC.
  if (
    code === '42501' ||
    code === 'PGRST301' ||
    /not (authenticated|authorized)|permission denied|row[- ]level security|jwt/i.test(haystack)
  ) {
    return false
  }

  // Never treat validation / check / constraint failures as missing RPC.
  if (
    code === '23514' ||
    code === '23502' ||
    code === '23503' ||
    code === '23505' ||
    code === '22P02' ||
    /violates (check|not-null|foreign key|unique) constraint|invalid input|validation/i.test(haystack)
  ) {
    return false
  }

  // Never treat network / transport failures as missing RPC.
  if (/failed to fetch|networkerror|network request failed|timeout|econnrefused|enotfound/i.test(haystack)) {
    return false
  }

  const namesFunction = haystack.includes(fn) || haystack.includes(`public.${fn}`)

  // PostgREST: function missing from schema cache (require RPC name).
  if (code === 'PGRST202') {
    return namesFunction
  }

  // PostgreSQL undefined_function (require RPC name when message names it).
  if (code === '42883') {
    return namesFunction
  }

  // Message-shaped missing-function errors (require the RPC name).
  if (!namesFunction) return false
  if (/could not find the (?:function|rpc)/i.test(message)) return true
  if (/function .* does not exist/i.test(message)) return true
  if (/schema cache/i.test(haystack) && /could not find/i.test(haystack)) return true

  return false
}

function safeAssignmentError(message: string): string {
  if (/not authenticated/i.test(message)) return 'Not authenticated'
  if (/not authorized/i.test(message)) return 'Not authorized'
  if (/select at least one employee/i.test(message)) return 'Select at least one employee'
  if (/primary assignee/i.test(message)) return 'Primary assignee must be one of the selected employees'
  if (/invalid assigned employee/i.test(message)) return 'One or more selected employees can no longer be assigned'
  if (/work order payload/i.test(message)) return 'Could not create the Work Order for this assignment'
  if (/assignment request/i.test(message)) return 'Check the assignment details and try again'
  return 'Could not create assignment.'
}

function safeSnapshotAssignmentError(message: string): string {
  if (/snapshot assignment storage is not available/i.test(message)) return 'Snapshot assignment storage is not available yet.'
  if (/maximum of (?:8|15) snapshots|more than (?:8|15) snapshots|sixteenth attachment/i.test(message)) return 'Maximum of 15 snapshots.'
  if (/selected snapshot|snapshot.*no longer available|duplicate snapshot|replay snapshot list/i.test(message)) return 'A selected snapshot is no longer available.'
  if (/not authenticated/i.test(message)) return 'Not authenticated'
  if (/not authorized/i.test(message)) return 'Not authorized'
  if (/failed to fetch|networkerror|network request failed|timeout/i.test(message)) return 'Network error. Try again.'
  if (/work order payload/i.test(message)) return 'Could not create the Work Order for this assignment'
  if (/assignment request|invalid/i.test(message)) return 'Check the assignment details and try again'
  return 'Could not create assignment with snapshots.'
}

function safeRevokeError(message: string): string {
  if (/not authenticated/i.test(message)) return 'Not authenticated'
  if (/not authorized/i.test(message)) return 'Not authorized'
  if (/not[_ -]?found|assignment not found/i.test(message)) return 'Assignment not found'
  return 'Could not revoke assignment.'
}

function readStoredBlueprintCalibrations(blueprintSetId: string): Record<number, CalibrationData | undefined> {
  return readNumberKeyedLocalStorageRecord<CalibrationData>(`blueprint_calibrations_${blueprintSetId}`)
}

function readStoredBlueprintDetectedScales(blueprintSetId: string): Record<number, DetectedScaleResult | undefined> {
  return readNumberKeyedLocalStorageRecord<DetectedScaleResult>(`blueprint_detected_scales_v2_${blueprintSetId}`)
}

function readNumberKeyedLocalStorageRecord<T>(key: string): Record<number, T | undefined> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<number, T | undefined> = {}
    for (const [rawKey, value] of Object.entries(parsed)) {
      const pageNumber = Math.max(1, Math.floor(Number(rawKey) || 0))
      if (pageNumber > 0 && value && typeof value === 'object') out[pageNumber] = value as T
    }
    return out
  } catch {
    return {}
  }
}

function buildStoredPageSizeResolver(
  blueprint: unknown,
  savedCalibrations: Record<number, CalibrationData | undefined>,
): (pageNumber: number) => PageSizeInches | null {
  return (pageNumber: number) => {
    const cleanPage = Math.max(1, Math.floor(Number(pageNumber) || 1))
    const fromBlueprint = resolveBlueprintPageSizeInches(blueprint, cleanPage)
    if (fromBlueprint) return fromBlueprint
    const cal = savedCalibrations[cleanPage]
    if (cal && isValidPageSizeInches({ pageWidthInches: Number(cal.pageWidthInches), pageHeightInches: Number(cal.pageHeightInches) })) {
      return { pageWidthInches: Number(cal.pageWidthInches), pageHeightInches: Number(cal.pageHeightInches) }
    }
    return null
  }
}

function resolveBlueprintPageSizeInches(blueprint: unknown, pageNumber: number): PageSizeInches | null {
  const source = blueprint as any
  const candidates = [
    source?.pageSizesInches?.[pageNumber],
    source?.pageSizesInches?.[String(pageNumber)],
    source?.pageDimensionsInches?.[pageNumber],
    source?.pageDimensionsInches?.[String(pageNumber)],
    source?.pdfPageSizesInches?.[pageNumber],
    source?.pdfPageSizesInches?.[String(pageNumber)],
    Array.isArray(source?.pages) ? source.pages.find((page: any) => Number(page?.pageNumber) === pageNumber) : null,
    Array.isArray(source?.pageDimensions) ? source.pageDimensions.find((page: any) => Number(page?.pageNumber) === pageNumber) : null,
  ]
  for (const candidate of candidates) {
    const size = normalizePageSizeCandidate(candidate)
    if (size) return size
  }
  return null
}

function normalizePageSizeCandidate(candidate: unknown): PageSizeInches | null {
  const item = candidate as any
  if (!item || typeof item !== 'object') return null
  const direct = {
    pageWidthInches: Number(item.pageWidthInches ?? item.widthInches),
    pageHeightInches: Number(item.pageHeightInches ?? item.heightInches),
  }
  if (isValidPageSizeInches(direct)) return direct
  const pts = {
    pageWidthInches: Number(item.pageWidthPts ?? item.widthPts ?? item.width) / 72,
    pageHeightInches: Number(item.pageHeightPts ?? item.heightPts ?? item.height) / 72,
  }
  return isValidPageSizeInches(pts) ? pts : null
}

