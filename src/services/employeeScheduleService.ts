/**
 * employeeScheduleService.ts — Employee daily scheduling (EMS Phase 4)
 *
 * Owner path: direct table CRUD on employee_schedules (RLS owner/admin).
 * Employee path: get_my_schedule / update_my_schedule_status RPCs, plus
 * getMyScheduleRange for the monthly calendar (read-only, RLS-scoped — see its
 * doc comment for why a direct range select is used instead of 42 RPC calls).
 *
 * Does not modify backupDataService, blueprintLibraryService, or any
 * protected services. Conflict detection is client-side only (no server lock).
 */

import { supabase } from '@/lib/supabase'
import { getOwnerOrgId } from '@/services/crewPortalService'

const rpc = supabase.rpc as any
const from = supabase.from as any

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScheduleStatus = 'scheduled' | 'in_progress' | 'done' | 'cancelled'

export interface ScheduleItem {
  id: string
  org_id: string
  employee_profile_id: string
  employee_name?: string
  work_date: string
  start_time: string | null
  end_time: string | null
  estimated_minutes: number | null
  assignment_id: string | null
  work_package_id: string | null
  work_package_name: string | null
  project_id: string | null
  project_name: string | null
  notes: string | null
  status: ScheduleStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CreateScheduleItem {
  employee_profile_id: string
  work_date: string
  start_time?: string | null
  end_time?: string | null
  estimated_minutes?: number | null
  assignment_id?: string | null
  work_package_id?: string | null
  work_package_name?: string | null
  project_id?: string | null
  project_name?: string | null
  notes?: string | null
}

export interface UpdateScheduleItem {
  start_time?: string | null
  end_time?: string | null
  estimated_minutes?: number | null
  assignment_id?: string | null
  work_package_id?: string | null
  work_package_name?: string | null
  project_id?: string | null
  project_name?: string | null
  notes?: string | null
  status?: ScheduleStatus
}

type Result<T> = { success: true; data: T } | { success: false; error: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function toIso(d: string): string {
  return d.slice(0, 10)
}

/** Returns YYYY-MM-DD for the Monday of the week containing `date`. */
export function weekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

/** Returns YYYY-MM-DD for the Sunday ending the week containing `date`. */
export function weekEnd(date: Date): string {
  const start = weekStart(date)
  const d = new Date(start)
  d.setDate(d.getDate() + 6)
  return d.toISOString().slice(0, 10)
}

/** True when [aStart, aEnd] overlaps [bStart, bEnd] (any null end = open). */
function timesOverlap(
  aStart: string | null,
  aEnd: string | null,
  bStart: string | null,
  bEnd: string | null,
): boolean {
  if (!aStart || !bStart) return false
  const aE = aEnd ?? '23:59:59'
  const bE = bEnd ?? '23:59:59'
  return aStart < bE && bStart < aE
}

// ── Owner functions ───────────────────────────────────────────────────────────

export async function getScheduleForDate(workDate: string): Promise<Result<ScheduleItem[]>> {
  try {
    const orgResult = await getOwnerOrgId()
    if (!orgResult.success) return { success: false, error: orgResult.error }

    const { data, error } = await from('employee_schedules')
      .select('*, employee_profiles(display_name)')
      .eq('org_id', orgResult.data)
      .eq('work_date', toIso(workDate))
      .order('start_time', { ascending: true, nullsFirst: false })

    if (error) return { success: false, error: error.message }

    const items: ScheduleItem[] = (data ?? []).map((row: any) => ({
      ...row,
      employee_name: row.employee_profiles?.display_name ?? undefined,
      employee_profiles: undefined,
    }))
    return { success: true, data: items }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function getScheduleForEmployee(
  profileId: string,
  workDate: string,
): Promise<Result<ScheduleItem[]>> {
  try {
    const orgResult = await getOwnerOrgId()
    if (!orgResult.success) return { success: false, error: orgResult.error }

    const { data, error } = await from('employee_schedules')
      .select('*')
      .eq('org_id', orgResult.data)
      .eq('employee_profile_id', profileId)
      .eq('work_date', toIso(workDate))
      .order('start_time', { ascending: true, nullsFirst: false })

    if (error) return { success: false, error: error.message }
    return { success: true, data: data ?? [] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function getScheduleForWeek(weekStartDate: string): Promise<Result<ScheduleItem[]>> {
  try {
    const orgResult = await getOwnerOrgId()
    if (!orgResult.success) return { success: false, error: orgResult.error }

    const start = toIso(weekStartDate)
    const end = (() => {
      const d = new Date(start)
      d.setDate(d.getDate() + 6)
      return d.toISOString().slice(0, 10)
    })()

    const { data, error } = await from('employee_schedules')
      .select('*, employee_profiles(display_name)')
      .eq('org_id', orgResult.data)
      .gte('work_date', start)
      .lte('work_date', end)
      .order('work_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: false })

    if (error) return { success: false, error: error.message }

    const items: ScheduleItem[] = (data ?? []).map((row: any) => ({
      ...row,
      employee_name: row.employee_profiles?.display_name ?? undefined,
      employee_profiles: undefined,
    }))
    return { success: true, data: items }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function createScheduleItem(
  item: CreateScheduleItem,
): Promise<Result<ScheduleItem>> {
  try {
    const orgResult = await getOwnerOrgId()
    if (!orgResult.success) return { success: false, error: orgResult.error }

    const { data: { user } } = await supabase.auth.getUser()

    const { data, error } = await from('employee_schedules')
      .insert({
        org_id: orgResult.data,
        employee_profile_id: item.employee_profile_id,
        work_date: toIso(item.work_date),
        start_time: item.start_time ?? null,
        end_time: item.end_time ?? null,
        estimated_minutes: item.estimated_minutes ?? null,
        assignment_id: item.assignment_id ?? null,
        work_package_id: item.work_package_id ?? null,
        work_package_name: item.work_package_name ?? null,
        project_id: item.project_id ?? null,
        project_name: item.project_name ?? null,
        notes: item.notes ?? null,
        created_by: user?.id ?? null,
      })
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function updateScheduleItem(
  id: string,
  updates: UpdateScheduleItem,
): Promise<Result<ScheduleItem>> {
  try {
    const { data, error } = await from('employee_schedules')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function deleteScheduleItem(id: string): Promise<Result<void>> {
  try {
    const { error } = await from('employee_schedules').delete().eq('id', id)
    if (error) return { success: false, error: error.message }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/**
 * Returns existing schedule items for an employee on a date that overlap the
 * given time range. Used to surface conflict warnings in the owner form.
 * excludeId: skip the item being edited.
 */
export async function checkConflicts(
  profileId: string,
  workDate: string,
  startTime: string | null,
  endTime: string | null,
  excludeId?: string,
): Promise<Result<ScheduleItem[]>> {
  try {
    const result = await getScheduleForEmployee(profileId, workDate)
    if (!result.success) return result

    const candidates = result.data.filter(
      (item) =>
        item.id !== excludeId &&
        item.status !== 'cancelled' &&
        timesOverlap(startTime, endTime, item.start_time, item.end_time),
    )
    return { success: true, data: candidates }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function getScheduleForMonth(
  monthStart: string,
  monthEnd: string,
): Promise<Result<ScheduleItem[]>> {
  try {
    const orgResult = await getOwnerOrgId()
    if (!orgResult.success) return { success: false, error: orgResult.error }

    const { data, error } = await from('employee_schedules')
      .select('*, employee_profiles(display_name)')
      .eq('org_id', orgResult.data)
      .gte('work_date', toIso(monthStart))
      .lte('work_date', toIso(monthEnd))
      .order('work_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: false })

    if (error) return { success: false, error: error.message }

    const items: ScheduleItem[] = (data ?? []).map((row: any) => ({
      ...row,
      employee_name: row.employee_profiles?.display_name ?? undefined,
      employee_profiles: undefined,
    }))
    return { success: true, data: items }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

// ── Employee functions (RPC path) ─────────────────────────────────────────────

export async function getMySchedule(date: string): Promise<Result<ScheduleItem[]>> {
  try {
    const { data, error } = await rpc('get_my_schedule', { p_date: toIso(date) })
    if (error) return { success: false, error: error.message }
    return { success: true, data: data ?? [] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/**
 * Read-only range read of the caller's own schedule rows.
 *
 * get_my_schedule takes a single p_date, so a monthly calendar grid would need
 * up to 42 round trips. There is no employee-facing range RPC, so this reads
 * employee_schedules directly and relies on the deployed RLS policy
 * es_employee_select_own (migration 086), which restricts SELECT to rows whose
 * employee_profile_id belongs to the signed-in active employee — the same rows
 * get_my_schedule returns. Never writes, and never widens the row set: the
 * status transition path stays on update_my_schedule_status.
 */
export async function getMyScheduleRange(
  startDate: string,
  endDate: string,
): Promise<Result<ScheduleItem[]>> {
  try {
    const start = toIso(startDate)
    const end = toIso(endDate)
    if (!start || !end || start > end) {
      return { success: false, error: 'Invalid date range' }
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { data, error } = await from('employee_schedules')
      .select('*')
      .gte('work_date', start)
      .lte('work_date', end)
      .order('work_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: false })

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as ScheduleItem[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function updateMyScheduleStatus(
  id: string,
  status: ScheduleStatus,
): Promise<Result<ScheduleItem>> {
  try {
    const { data, error } = await rpc('update_my_schedule_status', {
      p_schedule_id: id,
      p_status: status,
    })
    if (error) return { success: false, error: error.message }
    return { success: true, data }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}
