/**
 * crewPortalService.ts — Crew Portal (TEAM sidebar) live data
 * CREW-PORTAL-LIVE-1 + LIVE-2 (health % from project_phases, employee_role).
 * EMS-PHASE-2: unified crew directory + active project visibility.
 *
 * Owner / crew / guest reads for src/views/CrewPortal.tsx.
 * Does not touch Guardian, field CrewPortal, or protected backup/blueprint services.
 *
 * Hours: time_punch_events has no duration column; weekly hours come from
 * time_entries.paid_minutes (denormalized from punches) for the current work week.
 */

import { supabase } from '@/lib/supabase'
import { getBackupData, type BackupEmployee } from '@/services/backupDataService'
import { getActiveEmployeeProfiles, type AdminEmployeeProfile } from '@/services/adminTimecardService'
import {
  getCurrentWeekRangeFromTenantDate,
  getMyTimeSummary,
} from '@/services/employeePortalService'
import {
  getMyEmployeeTasks,
  listOrgTaskAssignments,
  type EmployeeMyTask,
  type TaskAssignmentStatus,
} from '@/services/employeeTaskAssignmentService'
import { toTradeRole, type EmployeeTradeRole } from '@/services/roleService'

const from = supabase.from as any

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export interface CrewRosterMember {
  id: string
  userId: string | null
  name: string
  /** Portal access role (employee | foreman). */
  role: string
  /** Trade role when set; UI prefers this over role for badges. */
  employeeRole: EmployeeTradeRole | null
  assignedProjects: string[]
  hoursThisWeek: number
  active: boolean
}

export interface CrewSelfView {
  profileId: string
  name: string
  role: string
  employeeRole: EmployeeTradeRole | null
  hoursThisWeek: number
  assignedProjects: string[]
  tasksToday: Array<{
    id: string
    workPackageName: string
    projectName: string
    status: TaskAssignmentStatus
  }>
}

export interface GuestProjectView {
  id: string
  name: string
  phaseLabel: string
  /**
   * Average percent_complete of started project_phases, or null when none.
   * Never invent 0% for unstarted projects.
   */
  healthPercent: number | null
}

/** Active/open SQL project statuses (matches employeeTaskAssignmentService). */
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

const PROJECT_STATUS_PHASE_LABELS: Record<string, string> = {
  lead: 'Lead',
  estimate: 'Estimate',
  pending: 'Pending',
  approved: 'Approved',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  punch_list: 'Punch List',
  closeout: 'Closeout',
  completed: 'Completed',
  canceled: 'Canceled',
}

/** Resolve owner org_id from profiles (auth.uid()). */
export async function getOwnerOrgId(): Promise<ServiceResult<string>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { data, error } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    const orgId = (data as { org_id?: string } | null)?.org_id
    if (!orgId) return { success: false, error: 'No org_id on profile' }
    return { success: true, data: orgId }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    return { success: false, error: message }
  }
}

export function mapProjectStatusToPhaseLabel(status: string, phase?: string | null): string {
  const trimmedPhase = (phase || '').trim()
  if (trimmedPhase) return trimmedPhase
  return PROJECT_STATUS_PHASE_LABELS[status] || status || 'Unknown'
}

/**
 * Project health % from project_phases (read-only).
 *
 * Excludes skipped phases. Shows bar only when at least one phase is
 * in_progress or completed. Per-phase score:
 *   completed  → 100
 *   in_progress with checklist items → (done / total) * 100
 *   in_progress with no checklist   → 50
 *   pending    → 0
 * Returns rounded average across non-skipped phases, or null if none are started.
 */
export async function getProjectHealthPercent(
  projectId: string,
): Promise<ServiceResult<number | null>> {
  try {
    const cleanId = String(projectId || '').trim()
    if (!cleanId) return { success: true, data: null }

    const { data, error } = await from('project_phases')
      .select('status, checklist')
      .eq('project_id', cleanId)

    if (error) {
      console.warn('[crewPortalService.getProjectHealthPercent]', error.message)
      return { success: false, error: error.message }
    }

    const rows = (data ?? []) as Array<{
      status: string | null
      checklist: Array<{ completed?: boolean }> | null
    }>

    const nonSkipped = rows.filter(
      (row) => String(row.status || '').toLowerCase() !== 'skipped',
    )

    const hasStarted = nonSkipped.some((row) => {
      const s = String(row.status || '').toLowerCase()
      return s === 'in_progress' || s === 'completed'
    })

    if (!hasStarted) return { success: true, data: null }

    let sum = 0
    for (const row of nonSkipped) {
      const s = String(row.status || '').toLowerCase()
      if (s === 'completed') {
        sum += 100
      } else if (s === 'in_progress') {
        const items = Array.isArray(row.checklist) ? row.checklist : []
        if (items.length > 0) {
          const done = items.filter((i) => i?.completed === true).length
          sum += Math.round((done / items.length) * 100)
        } else {
          sum += 50
        }
      }
      // pending → 0, already accounted for by adding nothing
    }

    const avg = Math.round(sum / nonSkipped.length)
    return { success: true, data: Math.max(0, Math.min(100, avg)) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[crewPortalService.getProjectHealthPercent]', err)
    return { success: false, error: message }
  }
}

function minutesToHours(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.round((minutes / 60) * 10) / 10
}

function todayYmdLocal(): string {
  const d = new Date()
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** Sum paid_minutes from time_entries for the current ISO (Mon–Sun) work week, by profile id. */
async function getWeeklyHoursByProfileId(orgId: string): Promise<Map<string, number>> {
  const { startDate, endDate } = getCurrentWeekRangeFromTenantDate()
  const hoursByProfile = new Map<string, number>()

  const { data, error } = await from('time_entries')
    .select('employee_profile_id, paid_minutes')
    .eq('org_id', orgId)
    .gte('work_date', startDate)
    .lte('work_date', endDate)

  if (error) {
    console.warn('[crewPortalService] weekly hours query failed:', error.message)
    return hoursByProfile
  }

  for (const row of (data ?? []) as Array<{ employee_profile_id: string; paid_minutes: number | null }>) {
    const mins = typeof row.paid_minutes === 'number' ? row.paid_minutes : 0
    hoursByProfile.set(
      row.employee_profile_id,
      (hoursByProfile.get(row.employee_profile_id) ?? 0) + mins,
    )
  }

  // Convert minutes → hours for callers.
  for (const [id, mins] of hoursByProfile) {
    hoursByProfile.set(id, minutesToHours(mins))
  }
  return hoursByProfile
}

/** Unique project names per employee from assignments (never exposes lead_employee_id). */
function projectNamesByEmployee(
  assignments: Array<{ assigned_employee_ids: string[]; project_name: string | null }>,
): Map<string, string[]> {
  const map = new Map<string, Set<string>>()
  for (const a of assignments) {
    const name = (a.project_name || '').trim()
    if (!name) continue
    for (const empId of a.assigned_employee_ids ?? []) {
      if (!empId) continue
      const set = map.get(empId) ?? new Set<string>()
      set.add(name)
      map.set(empId, set)
    }
  }
  const out = new Map<string, string[]>()
  for (const [id, set] of map) {
    out.set(id, [...set].sort((a, b) => a.localeCompare(b)))
  }
  return out
}

/**
 * Owner View roster: employee_profiles for org + assigned project names + hours this week.
 * Includes inactive profiles so Active/Inactive status can render.
 */
export async function getOwnerCrewRoster(): Promise<ServiceResult<CrewRosterMember[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const orgResult = await getOwnerOrgId()
    if (!orgResult.success) return { success: false, error: orgResult.error }

    const orgId = orgResult.data

    const { data: profiles, error: profileError } = await from('employee_profiles')
      .select('id, user_id, org_id, display_name, role, employee_role, active')
      .eq('org_id', orgId)
      .order('display_name', { ascending: true })

    if (profileError) return { success: false, error: profileError.message }

    const [hoursByProfile, assignmentsResult] = await Promise.all([
      getWeeklyHoursByProfileId(orgId),
      listOrgTaskAssignments(),
    ])

    const projectsByEmployee = assignmentsResult.success
      ? projectNamesByEmployee(assignmentsResult.data)
      : new Map<string, string[]>()

    const roster: CrewRosterMember[] = ((profiles ?? []) as Array<{
      id: string
      user_id: string | null
      display_name: string
      role: string
      employee_role: string | null
      active: boolean
    }>).map((p) => ({
      id: p.id,
      userId: p.user_id,
      name: p.display_name || 'Unknown',
      role: p.role || 'employee',
      employeeRole: toTradeRole(p.employee_role),
      assignedProjects: projectsByEmployee.get(p.id) ?? [],
      hoursThisWeek: hoursByProfile.get(p.id) ?? 0,
      active: p.active !== false,
    }))

    return { success: true, data: roster }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[crewPortalService.getOwnerCrewRoster]', err)
    return { success: false, error: message }
  }
}

/**
 * Crew View: identity + hours + projects + tasks for the logged-in employee
 * (employee_profiles.user_id = auth.uid()). Uses get_my_employee_tasks RPC
 * so lead_employee_id is never exposed.
 */
export async function getCrewSelfView(): Promise<ServiceResult<CrewSelfView | null>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { data: profileRows, error: profileError } = await from('employee_profiles')
      .select('id, display_name, role, employee_role, active, accepted_at')
      .eq('user_id', user.id)
      .eq('active', true)
      .order('accepted_at', { ascending: false })

    if (profileError) return { success: false, error: profileError.message }
    const profile = (profileRows ?? [])[0]
    if (!profile) return { success: true, data: null }

    const { startDate, endDate } = getCurrentWeekRangeFromTenantDate()
    const [summaryResult, tasksResult] = await Promise.all([
      getMyTimeSummary(startDate, endDate),
      getMyEmployeeTasks(),
    ])

    const hoursThisWeek = summaryResult.success
      ? minutesToHours(summaryResult.data.totalPaidMinutes)
      : 0

    const tasks = tasksResult.success ? tasksResult.data : []
    const today = todayYmdLocal()

    const tasksToday = tasks
      .filter((t: EmployeeMyTask) => {
        const dueToday = t.due_date === today
        const open = t.status === 'assigned' || t.status === 'in_progress'
        return dueToday || open
      })
      .map((t) => ({
        id: t.id,
        workPackageName: t.work_package_name,
        projectName: t.project_name || 'Untitled project',
        status: t.status,
      }))

    const projectSet = new Set<string>()
    for (const t of tasks) {
      const name = (t.project_name || '').trim()
      if (name) projectSet.add(name)
    }

    return {
      success: true,
      data: {
        profileId: profile.id,
        name: profile.display_name || 'Crew Member',
        role: profile.role || 'employee',
        employeeRole: toTradeRole(profile.employee_role),
        hoursThisWeek,
        assignedProjects: [...projectSet].sort((a, b) => a.localeCompare(b)),
        tasksToday,
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[crewPortalService.getCrewSelfView]', err)
    return { success: false, error: message }
  }
}

/**
 * Guest View project card.
 *
 * NEEDS OWNER DESIGN DECISION: no guest↔project linking table/column exists.
 * Placeholder: most recently updated active/open project for the owner's org.
 *
 * Health %: average of started project_phases.percent_complete (null if none).
 */
export async function getGuestProjectPlaceholder(): Promise<ServiceResult<GuestProjectView | null>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const orgResult = await getOwnerOrgId()
    if (!orgResult.success) return { success: false, error: orgResult.error }

    const { data, error } = await from('projects')
      .select('id, name, status, phase, updated_at')
      .eq('org_id', orgResult.data)
      .in('status', [...ACTIVE_PROJECT_STATUSES])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: true, data: null }

    const projectId = String(data.id)
    const healthResult = await getProjectHealthPercent(projectId)
    const healthPercent = healthResult.success ? healthResult.data : null

    return {
      success: true,
      data: {
        id: projectId,
        name: String(data.name || 'Untitled project'),
        phaseLabel: mapProjectStatusToPhaseLabel(String(data.status || ''), data.phase),
        healthPercent,
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[crewPortalService.getGuestProjectPlaceholder]', err)
    return { success: false, error: message }
  }
}

/** Re-export for Role Manager / invite refresh — same source as Timesheets tab. */
export async function listPortalEmployees(): Promise<ServiceResult<AdminEmployeeProfile[]>> {
  const res = await getActiveEmployeeProfiles()
  if (!res.success || !res.data) {
    return { success: false, error: res.error || 'Could not load employees' }
  }
  return { success: true, data: res.data }
}

// ─── EMS-PHASE-2: Unified Crew Directory + Active Projects ───────────────────

export interface UnifiedCrewMember {
  key: string
  name: string
  employeeRole: EmployeeTradeRole | null
  source: 'portal' | 'cost_model'
  status: 'active' | 'pending_invite' | 'cost_model_only' | 'inactive'
  hoursThisWeek: number
  assignedProjects: string[]
  profileId: string | null
  userId: string | null
  backupEmployeeId: string | null
}

export interface PhaseChecklistItem {
  item?: string
  completed?: boolean
  completed_by?: string
  completed_at?: string
}

export interface ProjectPhaseRow {
  id: string
  name: string
  order_index: number
  status: string
  checklist: PhaseChecklistItem[] | null
  started_at: string | null
  completed_at: string | null
  notes: string | null
}

export interface ActiveProject {
  id: string
  name: string
  status: string
  estimated_start: string | null
  estimated_end: string | null
  phases: ProjectPhaseRow[]
  healthPercent: number | null
}

/** Shared in-memory health % logic — avoids N+1 queries in getActiveProjects. */
function computeHealthFromPhases(
  phases: Array<{ status: string | null; checklist: Array<{ completed?: boolean }> | null }>,
): number | null {
  const nonSkipped = phases.filter((p) => String(p.status || '').toLowerCase() !== 'skipped')
  const hasStarted = nonSkipped.some((p) => {
    const s = String(p.status || '').toLowerCase()
    return s === 'in_progress' || s === 'completed'
  })
  if (!hasStarted) return null
  let sum = 0
  for (const p of nonSkipped) {
    const s = String(p.status || '').toLowerCase()
    if (s === 'completed') {
      sum += 100
    } else if (s === 'in_progress') {
      const items = Array.isArray(p.checklist) ? p.checklist : []
      sum += items.length > 0
        ? Math.round((items.filter((i) => i?.completed === true).length / items.length) * 100)
        : 50
    }
  }
  return Math.max(0, Math.min(100, Math.round(sum / nonSkipped.length)))
}

/**
 * All active/open SQL projects for this org, each with their non-skipped phases.
 * Two queries: one for projects, one batch-fetch of all phases (no N+1).
 * Read-only. No financial columns.
 */
export async function getActiveProjects(): Promise<ServiceResult<ActiveProject[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const orgResult = await getOwnerOrgId()
    if (!orgResult.success) return { success: false, error: orgResult.error }

    const { data: projects, error: projError } = await from('projects')
      .select('id, name, status, estimated_start, estimated_end')
      .eq('org_id', orgResult.data)
      .in('status', [...ACTIVE_PROJECT_STATUSES])
      .order('name', { ascending: true })

    if (projError) return { success: false, error: projError.message }
    if (!projects || projects.length === 0) return { success: true, data: [] }

    const projectIds = (projects as Array<{ id: string }>).map((p) => p.id)

    const { data: allPhases, error: phaseError } = await from('project_phases')
      .select('id, project_id, name, order_index, status, checklist, started_at, completed_at, notes')
      .in('project_id', projectIds)
      .order('order_index', { ascending: true })

    if (phaseError) {
      console.warn('[crewPortalService.getActiveProjects] phases query:', phaseError.message)
    }

    const phasesByProject = new Map<string, ProjectPhaseRow[]>()
    for (const phase of (allPhases ?? []) as Array<{
      id: string; project_id: string; name: string; order_index: number;
      status: string; checklist: unknown; started_at: string | null;
      completed_at: string | null; notes: string | null;
    }>) {
      const rows = phasesByProject.get(phase.project_id) ?? []
      rows.push({
        id: phase.id,
        name: phase.name,
        order_index: phase.order_index,
        status: phase.status,
        checklist: Array.isArray(phase.checklist) ? phase.checklist as PhaseChecklistItem[] : null,
        started_at: phase.started_at,
        completed_at: phase.completed_at,
        notes: phase.notes,
      })
      phasesByProject.set(phase.project_id, rows)
    }

    const result: ActiveProject[] = (projects as Array<{
      id: string; name: string; status: string;
      estimated_start: string | null; estimated_end: string | null;
    }>).map((p) => {
      const phases = phasesByProject.get(p.id) ?? []
      return {
        id: p.id,
        name: p.name || 'Untitled',
        status: p.status,
        estimated_start: p.estimated_start,
        estimated_end: p.estimated_end,
        phases,
        healthPercent: computeHealthFromPhases(phases),
      }
    })

    return { success: true, data: result }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[crewPortalService.getActiveProjects]', err)
    return { success: false, error: message }
  }
}

/**
 * Single project with all its phases. Used by Task Delegation drill-in.
 * Returns null when the project is not found or not active.
 */
export async function getProjectWithPhases(
  projectId: string,
): Promise<ServiceResult<ActiveProject | null>> {
  try {
    const cleanId = String(projectId || '').trim()
    if (!cleanId) return { success: true, data: null }

    const orgResult = await getOwnerOrgId()
    if (!orgResult.success) return { success: false, error: orgResult.error }

    const { data: project, error: projError } = await from('projects')
      .select('id, name, status, estimated_start, estimated_end')
      .eq('id', cleanId)
      .eq('org_id', orgResult.data)
      .maybeSingle()

    if (projError) return { success: false, error: projError.message }
    if (!project) return { success: true, data: null }

    const { data: phases, error: phaseError } = await from('project_phases')
      .select('id, project_id, name, order_index, status, checklist, started_at, completed_at, notes')
      .eq('project_id', cleanId)
      .order('order_index', { ascending: true })

    if (phaseError) {
      console.warn('[crewPortalService.getProjectWithPhases] phases query:', phaseError.message)
    }

    const phaseRows: ProjectPhaseRow[] = ((phases ?? []) as Array<{
      id: string; project_id: string; name: string; order_index: number;
      status: string; checklist: unknown; started_at: string | null;
      completed_at: string | null; notes: string | null;
    }>).map((ph) => ({
      id: ph.id,
      name: ph.name,
      order_index: ph.order_index,
      status: ph.status,
      checklist: Array.isArray(ph.checklist) ? ph.checklist as PhaseChecklistItem[] : null,
      started_at: ph.started_at,
      completed_at: ph.completed_at,
      notes: ph.notes,
    }))

    return {
      success: true,
      data: {
        id: String(project.id),
        name: String(project.name || 'Untitled'),
        status: String(project.status),
        estimated_start: project.estimated_start ?? null,
        estimated_end: project.estimated_end ?? null,
        phases: phaseRows,
        healthPercent: computeHealthFromPhases(phaseRows),
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[crewPortalService.getProjectWithPhases]', err)
    return { success: false, error: message }
  }
}

/**
 * Unified Crew Directory: merges SQL employee_profiles with BackupData employees[].
 *
 * Match key: employee_profiles.backup_employee_id = BackupEmployee.id.
 * Portal-only → source: 'portal'. BackupData-only (no linked profile) → source: 'cost_model'.
 * Tombstoned BackupData employees (deletedAt set) are excluded.
 */
export async function getUnifiedCrewDirectory(): Promise<ServiceResult<UnifiedCrewMember[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const orgResult = await getOwnerOrgId()
    if (!orgResult.success) return { success: false, error: orgResult.error }
    const orgId = orgResult.data

    const [profilesRes, hoursByProfile, assignmentsResult] = await Promise.all([
      from('employee_profiles')
        .select('id, user_id, display_name, employee_role, active, accepted_at, backup_employee_id')
        .eq('org_id', orgId)
        .eq('active', true)
        .order('display_name', { ascending: true }),
      getWeeklyHoursByProfileId(orgId),
      listOrgTaskAssignments(),
    ])

    if (profilesRes.error) return { success: false, error: profilesRes.error.message }

    const profiles = (profilesRes.data ?? []) as Array<{
      id: string
      user_id: string | null
      display_name: string
      employee_role: string | null
      active: boolean
      accepted_at: string | null
      backup_employee_id: string | null
    }>

    const projectsByEmployee = assignmentsResult.success
      ? projectNamesByEmployee(assignmentsResult.data)
      : new Map<string, string[]>()

    const backupEmployees: BackupEmployee[] = (getBackupData()?.employees ?? [])
      .filter((e: BackupEmployee) => !e.deletedAt)

    const matchedBackupIds = new Set<string>()
    for (const p of profiles) {
      if (p.backup_employee_id) matchedBackupIds.add(p.backup_employee_id)
    }

    const result: UnifiedCrewMember[] = []

    for (const profile of profiles) {
      const status: UnifiedCrewMember['status'] = profile.user_id
        ? 'active'
        : 'pending_invite'

      result.push({
        key: `portal-${profile.id}`,
        name: profile.display_name || 'Unknown',
        employeeRole: toTradeRole(profile.employee_role),
        source: 'portal',
        status,
        hoursThisWeek: hoursByProfile.get(profile.id) ?? 0,
        assignedProjects: projectsByEmployee.get(profile.id) ?? [],
        profileId: profile.id,
        userId: profile.user_id,
        backupEmployeeId: profile.backup_employee_id,
      })
    }

    for (const emp of backupEmployees) {
      if (matchedBackupIds.has(emp.id)) continue
      result.push({
        key: `backup-${emp.id}`,
        name: emp.name || 'Unknown',
        employeeRole: null,
        source: 'cost_model',
        status: 'cost_model_only',
        hoursThisWeek: 0,
        assignedProjects: [],
        profileId: null,
        userId: null,
        backupEmployeeId: emp.id,
      })
    }

    const STATUS_ORDER: Record<UnifiedCrewMember['status'], number> = {
      active: 0, pending_invite: 1, cost_model_only: 2, inactive: 3,
    }
    result.sort((a, b) => {
      const diff = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
      return diff !== 0 ? diff : a.name.localeCompare(b.name)
    })

    return { success: true, data: result }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[crewPortalService.getUnifiedCrewDirectory]', err)
    return { success: false, error: message }
  }
}
