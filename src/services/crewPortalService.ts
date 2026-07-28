/**
 * crewPortalService.ts — Crew Portal (TEAM sidebar) live data (CREW-PORTAL-LIVE-1)
 *
 * Owner / crew / guest reads for src/views/CrewPortal.tsx.
 * Does not touch Guardian, field CrewPortal, or protected backup/blueprint services.
 *
 * Hours: time_punch_events has no duration column; weekly hours come from
 * time_entries.paid_minutes (denormalized from punches) for the current work week.
 */

import { supabase } from '@/lib/supabase'
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

const from = supabase.from as any

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export interface CrewRosterMember {
  id: string
  userId: string | null
  name: string
  role: string
  assignedProjects: string[]
  hoursThisWeek: number
  active: boolean
}

export interface CrewSelfView {
  profileId: string
  name: string
  role: string
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
  /** Null when projects has no health column — UI must not invent a value. */
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
      .select('id, user_id, org_id, display_name, role, active')
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
      active: boolean
    }>).map((p) => ({
      id: p.id,
      userId: p.user_id,
      name: p.display_name || 'Unknown',
      role: p.role || 'employee',
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
      .select('id, display_name, role, active, accepted_at')
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
 * NEEDS OWNER DESIGN DECISION: no health % column on projects — healthPercent is null.
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

    return {
      success: true,
      data: {
        id: String(data.id),
        name: String(data.name || 'Untitled project'),
        phaseLabel: mapProjectStatusToPhaseLabel(String(data.status || ''), data.phase),
        // No health_% / health_percent column on projects — do not invent.
        healthPercent: null,
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
