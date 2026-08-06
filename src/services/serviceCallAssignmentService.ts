/**
 * serviceCallAssignmentService.ts — SERVICE-LOG-1 service-call ↔ employee link.
 *
 * Owner/admin writes the assignment set for one service call; the assigned
 * employees read their own rows in the Employee Portal. Both sides go through
 * public.service_call_assignments (migration 115), which is RLS-scoped to the
 * organization for owners and to the signed-in employee's own profile rows for
 * employees.
 *
 * Financial isolation: this module only ever sends the employee-safe payload
 * produced by buildServiceCallPortalPayload(). Total Quoted, Suggested Quote,
 * profit, margin, internal cost and collections never leave the owner app.
 */

import { supabase } from '@/lib/supabase'
import {
  buildServiceCallPortalPayload,
  payloadOmitsFinancials,
  type ServiceCallPortalPayload,
} from '@/features/service-quote/serviceAssignments'

// service_call_assignments is not in the generated db types yet.
const from = supabase.from as any

export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export const SERVICE_CALL_ASSIGNMENT_TABLE = 'service_call_assignments'

export const SERVICE_CALL_ASSIGNMENT_COLS =
  'id, org_id, service_call_id, service_call_kind, employee_profile_id, ' +
  'customer_name, address, scheduled_date, job_type, work_description, ' +
  'assignment_status, created_at, updated_at'

export interface ServiceCallAssignmentRow {
  id: string
  org_id: string
  service_call_id: string
  service_call_kind: 'service_estimate' | 'service_call'
  employee_profile_id: string
  customer_name: string
  address: string
  scheduled_date: string | null
  job_type: string
  work_description: string
  assignment_status: 'assigned' | 'in_progress' | 'completed' | 'cancelled'
  created_at?: string
  updated_at?: string
}

export interface SyncServiceCallAssignmentsInput {
  orgId: string | null | undefined
  /** BackupData service estimate / service log id. */
  serviceCallId: string
  kind: ServiceCallPortalPayload['serviceCallKind']
  /** Canonical employee_profiles.id list — the complete set after this save. */
  profileIds: string[]
  /** The service-call record; only employee-safe fields are read from it. */
  record: unknown
}

/** Dedupe + drop blanks without reordering. */
function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids || []) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Make the stored assignment set for one service call exactly `profileIds`.
 *
 * Adding an employee never disturbs the others, and removing one deletes only
 * that row. An empty list clears the service call's assignments.
 */
export async function syncServiceCallAssignments(
  input: SyncServiceCallAssignmentsInput,
): Promise<Result<{ assigned: number }>> {
  const orgId = String(input.orgId || '').trim()
  const serviceCallId = String(input.serviceCallId || '').trim()
  if (!orgId || !serviceCallId) {
    // Local-only / not signed into an org — BackupData still holds the
    // assignments, there is just no portal row to write.
    return { success: true, data: { assigned: 0 } }
  }

  const profileIds = uniqueIds(input.profileIds)
  const payload = buildServiceCallPortalPayload(input.record, input.kind)
  if (!payloadOmitsFinancials(payload as unknown as Record<string, unknown>)) {
    return { success: false, error: 'Refusing to send financial fields to the Employee Portal' }
  }

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    if (profileIds.length > 0) {
      const rows = profileIds.map((employeeProfileId) => ({
        org_id: orgId,
        service_call_id: serviceCallId,
        service_call_kind: input.kind,
        employee_profile_id: employeeProfileId,
        customer_name: payload.customerName,
        address: payload.address,
        scheduled_date: payload.scheduledDate,
        job_type: payload.jobType,
        work_description: payload.workDescription,
        assigned_by: user.id,
      }))

      const { error: upsertError } = await from(SERVICE_CALL_ASSIGNMENT_TABLE)
        .upsert(rows, { onConflict: 'org_id,service_call_id,employee_profile_id' })

      if (upsertError) return { success: false, error: upsertError.message }
    }

    // Drop employees who are no longer assigned — this service call only.
    let deleteQuery = from(SERVICE_CALL_ASSIGNMENT_TABLE)
      .delete()
      .eq('org_id', orgId)
      .eq('service_call_id', serviceCallId)

    if (profileIds.length > 0) {
      deleteQuery = deleteQuery.not(
        'employee_profile_id',
        'in',
        `(${profileIds.join(',')})`,
      )
    }

    const { error: deleteError } = await deleteQuery
    if (deleteError) return { success: false, error: deleteError.message }

    return { success: true, data: { assigned: profileIds.length } }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[serviceCallAssignmentService.syncServiceCallAssignments]', err)
    return { success: false, error: message }
  }
}

/** Owner/admin read: current assignments for the given service call ids. */
export async function listServiceCallAssignments(
  serviceCallIds: string[],
): Promise<Result<ServiceCallAssignmentRow[]>> {
  const ids = uniqueIds(serviceCallIds)
  if (ids.length === 0) return { success: true, data: [] }
  try {
    const { data, error } = await from(SERVICE_CALL_ASSIGNMENT_TABLE)
      .select(SERVICE_CALL_ASSIGNMENT_COLS)
      .in('service_call_id', ids)

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as ServiceCallAssignmentRow[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[serviceCallAssignmentService.listServiceCallAssignments]', err)
    return { success: false, error: message }
  }
}

/**
 * Employee Portal read: the service calls assigned to the signed-in employee.
 *
 * RLS already restricts rows to this employee's own profile; the explicit
 * employee_profile_id filter keeps the query honest when a profile id is known.
 */
export async function getMyServiceCallAssignments(
  employeeProfileId?: string | null,
): Promise<Result<ServiceCallAssignmentRow[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    let query = from(SERVICE_CALL_ASSIGNMENT_TABLE)
      .select(SERVICE_CALL_ASSIGNMENT_COLS)
      .order('scheduled_date', { ascending: false, nullsFirst: false })

    const profileId = String(employeeProfileId || '').trim()
    if (profileId) query = query.eq('employee_profile_id', profileId)

    const { data, error } = await query
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as ServiceCallAssignmentRow[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[serviceCallAssignmentService.getMyServiceCallAssignments]', err)
    return { success: false, error: message }
  }
}
