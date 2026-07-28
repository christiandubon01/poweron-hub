/**
 * employeeTaskAssignmentService.ts — Owner + employee task delegation (Feature 1)
 *
 * Owner path: direct table CRUD on employee_task_assignments (RLS owner/admin).
 * Employee path: get_my_employee_tasks / update_my_employee_task RPCs only —
 * those omit lead_employee_id and expose can_complete instead.
 *
 * Work packages are read from BackupData JSON (operationsBlueprintScopeLayers);
 * there is no SQL work_packages table. Assignments store denormalized name /
 * project context. Does not modify backupDataService or blueprintLibraryService.
 */

import { supabase } from '@/lib/supabase'
import { getBackupData } from '@/services/backupDataService'
import {
  getOperationsBlueprintLibrary,
  getOperationsBlueprintScopeLayers,
} from '@/services/blueprintLibraryService'
import { getActiveEmployeeProfiles, type AdminEmployeeProfile } from '@/services/adminTimecardService'

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
  completed_at: string | null
  completed_by: string | null
  updated_at: string
  created_at?: string
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
  completed_at: string | null
  assigned_at: string
  updated_at: string
  /** True only for the private primary assignee; does not reveal who that is to others. */
  can_complete: boolean
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

const ASSIGNMENT_COLS =
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
        ACTIVE_PROJECT_STATUSES.includes(p.status as any)
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
      .select(ASSIGNMENT_COLS)
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
      .select(ASSIGNMENT_COLS)
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as EmployeeTaskAssignment }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTaskAssignmentService.createTaskAssignment]', err)
    return { success: false, error: message }
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
      .select(ASSIGNMENT_COLS)
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

    const { error } = await from('employee_task_assignments')
      .delete()
      .eq('id', assignmentId)

    if (error) return { success: false, error: error.message }
    return { success: true, data: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTaskAssignmentService.revokeTaskAssignment]', err)
    return { success: false, error: message }
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

export async function updateMyEmployeeTask(input: {
  assignmentId: string
  status?: TaskAssignmentStatus
  completionNotes?: string | null
}): Promise<Result<true>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { error } = await rpc('update_my_employee_task', {
      p_assignment_id: input.assignmentId,
      p_status: input.status ?? null,
      p_completion_notes: input.completionNotes === undefined ? null : input.completionNotes,
    })

    if (error) return { success: false, error: error.message }
    return { success: true, data: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTaskAssignmentService.updateMyEmployeeTask]', err)
    return { success: false, error: message }
  }
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
}
