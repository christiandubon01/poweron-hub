/**
 * adminTimecardService.ts — Owner/admin read-only timecard visibility (TIME-4)
 *
 * READ ONLY. SELECT queries only. This service never writes: no record_time_punch,
 * no write RPC, no insert/update/delete/upsert. Org scoping is enforced by RLS
 * (owner/admin SELECT policies on employee_profiles / time_punch_events /
 * time_entries in migration 081). No backupDataService, no localStorage.
 *
 * Public API:
 *   getActiveEmployeeProfiles()                    — active portal profiles for the org
 *   getAdminTimecardsForDate(workDate)             — merged rows + summary for a date
 *   getEmployeePunchesForDate(profileId, workDate) — punch history for one employee
 *   getOpenPriorDayEntries(beforeDate)             — open entries before a date
 */

import { supabase } from '@/lib/supabase'
import {
  deriveClockPhase,
  type ClockPhase,
  type PunchType,
  type TimePunchEvent,
  type TimeEntry,
} from '@/services/employeeTimeService'

// Re-export getTenantWorkDate so the panel has a single import surface.
export { getTenantWorkDate } from '@/services/employeeTimeService'
export type { ClockPhase, TimePunchEvent, TimeEntry } from '@/services/employeeTimeService'

// Time tables and admin RPCs aren't in the generated db types yet.
const rpc  = supabase.rpc as any
const from = supabase.from as any

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AdminEmployeeProfile {
  id: string
  user_id: string | null
  org_id: string
  display_name: string
  email: string | null
  role: string
  employee_role: string | null
  employment_type: string
  active: boolean
  portal_access: Record<string, unknown> | null
  accepted_at: string | null
  backup_employee_id: string | null
}

export interface AdminTimecardRow {
  profile: AdminEmployeeProfile
  entry: TimeEntry | null
  punches: TimePunchEvent[]
  phase: ClockPhase
  isPendingInvite: boolean
}

export interface AdminTimecardSummary {
  clockedInCount: number
  onLunchCount: number
  completedCount: number
  notClockedInCount: number
  pendingInviteCount: number
  totalEmployees: number
}

export interface AdminTimecardsForDate {
  workDate: string
  rows: AdminTimecardRow[]
  summary: AdminTimecardSummary
}

interface Result<T> {
  success: boolean
  data?: T
  error?: string
}

const PROFILE_COLS =
  'id, user_id, org_id, display_name, email, role, employee_role, employment_type, active, portal_access, accepted_at, backup_employee_id'
const ENTRY_COLS =
  'id, org_id, employee_user_id, employee_profile_id, work_date, clock_in_at, lunch_out_at, lunch_in_at, clock_out_at, total_minutes, lunch_minutes, paid_minutes, status, approval_status'
const PUNCH_COLS =
  'id, org_id, employee_user_id, employee_profile_id, work_date, punch_type, punched_at, source, is_void, session_id, notes, supersedes_id, end_of_day_summary'

// ── A. getActiveEmployeeProfiles ────────────────────────────────────────────────

export async function getActiveEmployeeProfiles(): Promise<Result<AdminEmployeeProfile[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    // RLS restricts rows to the caller's org for owner/admin.
    const { data, error } = await from('employee_profiles')
      .select(PROFILE_COLS)
      .eq('active', true)
      .order('display_name', { ascending: true })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: (data ?? []) as AdminEmployeeProfile[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.getActiveEmployeeProfiles] Error:', err)
    return { success: false, error: message }
  }
}

// ── A2. getAllOrgEmployeeProfiles ─────────────────────────────────────────────────
// Returns ALL profiles for the org — active, pending, and inactive.
// Used exclusively for role/permission configuration (ROLE-2+).
// Timecard operations must continue using getActiveEmployeeProfiles() above.

export async function getAllOrgEmployeeProfiles(): Promise<Result<AdminEmployeeProfile[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data, error } = await from('employee_profiles')
      .select(PROFILE_COLS)
      .order('display_name', { ascending: true })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: (data ?? []) as AdminEmployeeProfile[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.getAllOrgEmployeeProfiles] Error:', err)
    return { success: false, error: message }
  }
}

// ── A3. prepareEmployeeAccount ────────────────────────────────────────────────────
// Creates an employee_profiles row linked to a cost-model employee via backup_employee_id,
// WITHOUT sending an invite. The owner can assign roles immediately and invite later.
// RLS: ep_owner_admin_insert allows this from the browser (org_id validated by DB).

export async function prepareEmployeeAccount(
  backupEmployeeId: string,
  displayName: string,
  orgId: string,
  email?: string,
): Promise<Result<AdminEmployeeProfile>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    // Prevent duplicate preparation for the same cost-model employee.
    const { data: existing } = await from('employee_profiles')
      .select('id, display_name')
      .eq('org_id', orgId)
      .eq('backup_employee_id', backupEmployeeId)
      .maybeSingle()
    if (existing) {
      return {
        success: false,
        error: `A portal profile for ${existing.display_name} already exists.`,
      }
    }

    const row: Record<string, unknown> = {
      org_id:             orgId,
      display_name:       displayName,
      backup_employee_id: backupEmployeeId,
      active:             true,
      portal_access:      { time_tracking: true },
      invited_by:         user.id,
    }
    if (email) row.email = email.trim().toLowerCase()

    const { data, error } = await from('employee_profiles')
      .insert(row)
      .select(PROFILE_COLS)
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as AdminEmployeeProfile }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.prepareEmployeeAccount] Error:', err)
    return { success: false, error: message }
  }
}

// ── A4. Link Existing Account (ROLE-2.2A) ──────────────────────────────────────
// Links an existing unlinked employee_profiles row to a Cost Model employee by
// setting backup_employee_id. Does NOT delete, merge, invite, or create auth.
// RLS: ep_owner_admin_update — ordinary employees cannot perform this write.

export type PortalLinkCandidateStatus = 'Invitation Pending' | 'Active' | 'Inactive'

export interface PortalLinkCandidate {
  profileId: string
  displayName: string
  email: string | null
  status: PortalLinkCandidateStatus
  /** True when this candidate's email exactly matches the Cost Model email (unique match preferred). */
  emailMatch: boolean
}

export function derivePortalLinkStatus(profile: {
  active: boolean
  user_id: string | null
}): PortalLinkCandidateStatus {
  if (!profile.active) return 'Inactive'
  if (profile.user_id) return 'Active'
  return 'Invitation Pending'
}

/**
 * Pure candidate filter for Link Existing Account.
 * Same-org only; excludes already-linked profiles; never auto-links by name.
 * When exactly one candidate has an exact email match, mark it as suggested.
 */
export function selectUnlinkedPortalCandidates(
  profiles: Array<{
    id: string
    org_id: string
    display_name: string
    email: string | null
    active: boolean
    user_id: string | null
    backup_employee_id: string | null
  }>,
  orgId: string,
  costModelEmail?: string | null,
): PortalLinkCandidate[] {
  const emailNorm = costModelEmail?.trim().toLowerCase() || null
  const unlinked = profiles
    .filter(p => p.org_id === orgId && !p.backup_employee_id)
    .map(p => {
      const profileEmail = p.email?.trim().toLowerCase() || null
      return {
        profileId: p.id,
        displayName: p.display_name,
        email: p.email,
        status: derivePortalLinkStatus(p),
        emailMatch: Boolean(emailNorm && profileEmail && profileEmail === emailNorm),
      }
    })

  // Prefer unique exact email matches as the suggested candidate (emailMatch stays true
  // only when exactly one match exists — never auto-link by display name).
  const emailMatches = unlinked.filter(c => c.emailMatch)
  if (emailMatches.length !== 1) {
    return unlinked.map(c => ({ ...c, emailMatch: false }))
  }
  return unlinked
}

export async function listUnlinkedPortalCandidates(
  orgId: string,
  costModelEmail?: string | null,
): Promise<Result<PortalLinkCandidate[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { data, error } = await from('employee_profiles')
      .select(PROFILE_COLS)
      .eq('org_id', orgId)
      .order('display_name', { ascending: true })

    if (error) return { success: false, error: error.message }

    const profiles = (data ?? []) as AdminEmployeeProfile[]
    return {
      success: true,
      data: selectUnlinkedPortalCandidates(profiles, orgId, costModelEmail),
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.listUnlinkedPortalCandidates] Error:', err)
    return { success: false, error: message }
  }
}

/**
 * Set employee_profiles.backup_employee_id for an existing unlinked profile.
 * Requires explicit owner confirmation in the UI before calling.
 * Does not delete either record.
 */
export async function linkExistingEmployeeAccount(
  profileId: string,
  backupEmployeeId: string,
  orgId: string,
): Promise<Result<AdminEmployeeProfile>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    if (!profileId || !backupEmployeeId || !orgId) {
      return { success: false, error: 'Missing link parameters' }
    }

    // Refuse if this Cost Model employee is already linked in this org.
    const { data: existingLink } = await from('employee_profiles')
      .select('id, display_name')
      .eq('org_id', orgId)
      .eq('backup_employee_id', backupEmployeeId)
      .maybeSingle()
    if (existingLink) {
      return {
        success: false,
        error: `Cost Model employee is already linked to ${existingLink.display_name}.`,
      }
    }

    // Load target; must be same-org and currently unlinked.
    const { data: target, error: targetErr } = await from('employee_profiles')
      .select(PROFILE_COLS)
      .eq('id', profileId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (targetErr) return { success: false, error: targetErr.message }
    if (!target) return { success: false, error: 'Portal profile not found in this organization.' }
    if (target.backup_employee_id) {
      return {
        success: false,
        error: `Portal profile "${target.display_name}" is already linked to a Cost Model employee.`,
      }
    }

    const { data, error } = await from('employee_profiles')
      .update({ backup_employee_id: backupEmployeeId })
      .eq('id', profileId)
      .eq('org_id', orgId)
      .is('backup_employee_id', null)
      .select(PROFILE_COLS)
      .single()

    if (error) {
      if (error.code === '23505') {
        return {
          success: false,
          error: 'That Cost Model employee is already linked to another portal profile in this organization.',
        }
      }
      return { success: false, error: error.message }
    }
    if (!data) return { success: false, error: 'Link failed — profile may have been linked by another session.' }
    return { success: true, data: data as AdminEmployeeProfile }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.linkExistingEmployeeAccount] Error:', err)
    return { success: false, error: message }
  }
}

// ── B. getAdminTimecardsForDate ─────────────────────────────────────────────────

export async function getAdminTimecardsForDate(
  workDate: string,
): Promise<Result<AdminTimecardsForDate>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const profilesResult = await getActiveEmployeeProfiles()
    if (!profilesResult.success || !profilesResult.data) {
      return { success: false, error: profilesResult.error || 'Could not load employees' }
    }
    const profiles = profilesResult.data

    const { data: entryData, error: entryError } = await from('time_entries')
      .select(ENTRY_COLS)
      .eq('work_date', workDate)

    if (entryError) {
      return { success: false, error: entryError.message }
    }

    const { data: punchData, error: punchError } = await from('time_punch_events')
      .select(PUNCH_COLS)
      .eq('work_date', workDate)
      .eq('is_void', false)
      .order('punched_at', { ascending: true })

    if (punchError) {
      return { success: false, error: punchError.message }
    }

    const entries = (entryData ?? []) as TimeEntry[]
    const punches = (punchData ?? []) as TimePunchEvent[]

    // Merge client-side by employee_profile_id.
    const entryByProfile = new Map<string, TimeEntry>()
    for (const e of entries) entryByProfile.set(e.employee_profile_id, e)

    const punchesByProfile = new Map<string, TimePunchEvent[]>()
    for (const p of punches) {
      const list = punchesByProfile.get(p.employee_profile_id) ?? []
      list.push(p)
      punchesByProfile.set(p.employee_profile_id, list)
    }

    const rows: AdminTimecardRow[] = profiles.map(profile => {
      const rowPunches = punchesByProfile.get(profile.id) ?? []
      const entry = entryByProfile.get(profile.id) ?? null
      const phase = deriveClockPhase(rowPunches)
      const isPendingInvite = !profile.user_id
      return { profile, entry, punches: rowPunches, phase, isPendingInvite }
    })

    const summary: AdminTimecardSummary = {
      clockedInCount:     0,
      onLunchCount:       0,
      completedCount:     0,
      notClockedInCount:  0,
      pendingInviteCount: 0,
      totalEmployees:     rows.length,
    }

    for (const row of rows) {
      if (row.isPendingInvite) {
        summary.pendingInviteCount++
        continue
      }
      switch (row.phase) {
        case 'working':
        case 'back_from_lunch':
          summary.clockedInCount++
          break
        case 'on_lunch':
          summary.onLunchCount++
          break
        case 'done':
          summary.completedCount++
          break
        case 'off_clock':
        default:
          summary.notClockedInCount++
          break
      }
    }

    return { success: true, data: { workDate, rows, summary } }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.getAdminTimecardsForDate] Error:', err)
    return { success: false, error: message }
  }
}

// ── C. getEmployeePunchesForDate ────────────────────────────────────────────────

export async function getEmployeePunchesForDate(
  employeeProfileId: string,
  workDate: string,
): Promise<Result<TimePunchEvent[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data, error } = await from('time_punch_events')
      .select(PUNCH_COLS)
      .eq('employee_profile_id', employeeProfileId)
      .eq('work_date', workDate)
      .eq('is_void', false)
      .order('punched_at', { ascending: true })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: (data ?? []) as TimePunchEvent[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.getEmployeePunchesForDate] Error:', err)
    return { success: false, error: message }
  }
}

// ── D. getOpenPriorDayEntries (optional, read-only) ─────────────────────────────

export async function getOpenPriorDayEntries(
  beforeDate: string,
): Promise<Result<TimeEntry[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data, error } = await from('time_entries')
      .select(ENTRY_COLS)
      .eq('status', 'open')
      .lt('work_date', beforeDate)
      .order('work_date', { ascending: true })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: (data ?? []) as TimeEntry[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.getOpenPriorDayEntries] Error:', err)
    return { success: false, error: message }
  }
}

// ── E. getPunchesForDay — all punches including voided (admin audit view) ──────

export async function getPunchesForDay(
  employeeProfileId: string,
  workDate: string,
): Promise<Result<TimePunchEvent[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data, error } = await from('time_punch_events')
      .select(PUNCH_COLS)
      .eq('employee_profile_id', employeeProfileId)
      .eq('work_date', workDate)
      .order('punched_at', { ascending: true })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: (data ?? []) as TimePunchEvent[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.getPunchesForDay] Error:', err)
    return { success: false, error: message }
  }
}

// ── F. getTimeEntryForDay — targeted entry fetch for the modal ─────────────────

export async function getTimeEntryForDay(
  employeeProfileId: string,
  workDate: string,
): Promise<Result<TimeEntry | null>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data, error } = await from('time_entries')
      .select(ENTRY_COLS)
      .eq('employee_profile_id', employeeProfileId)
      .eq('work_date', workDate)
      .maybeSingle()

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: (data ?? null) as TimeEntry | null }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.getTimeEntryForDay] Error:', err)
    return { success: false, error: message }
  }
}

// ── G. adminRecordPunch — insert or correct a punch via migration 090 RPC ─────

export async function adminRecordPunch(
  employeeProfileId: string,
  punchType: PunchType,
  punchedAt: string,
  workDate: string,
  notes?: string,
  supersedesId?: string,
): Promise<Result<TimePunchEvent>> {
  try {
    const { data, error } = await rpc('admin_record_punch', {
      p_employee_profile_id: employeeProfileId,
      p_punch_type:          punchType,
      p_punched_at:          punchedAt,
      p_work_date:           workDate,
      p_notes:               notes ?? null,
      p_supersedes_id:       supersedesId ?? null,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data as TimePunchEvent }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.adminRecordPunch] Error:', err)
    return { success: false, error: message }
  }
}

// ── H. adminVoidPunch — void a punch via migration 090 RPC ────────────────────

export async function adminVoidPunch(
  punchId: string,
): Promise<Result<TimePunchEvent>> {
  try {
    const { data, error } = await rpc('admin_void_punch', {
      p_punch_id: punchId,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data as TimePunchEvent }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.adminVoidPunch] Error:', err)
    return { success: false, error: message }
  }
}

// ── I. adminUpdateApprovalStatus — approve/reject via migration 090 RPC ───────

export type { PunchEditRequest } from '@/services/employeePortalService'
import type { PunchEditRequest } from '@/services/employeePortalService'

// ── J. getPunchEditRequestsForDay — admin view of employee requests ────────────

const PUNCH_EDIT_REQ_ADMIN_COLS =
  'id, org_id, employee_profile_id, time_entry_id, session_id, punch_event_id, punch_type, ' +
  'original_time, requested_time, employee_reason, status, requested_at, ' +
  'reviewed_by, reviewed_at, created_at, updated_at'

/** Per-session record for admin visibility (migration 099/100). */
export interface AdminWorkSession {
  id: string
  assignment_id: string | null
  project_id: string | null
  project_name: string | null
  work_package_name: string | null
  work_date: string
  clock_in_at: string | null
  lunch_out_at: string | null
  lunch_in_at: string | null
  clock_out_at: string | null
  total_minutes: number | null
  lunch_minutes: number | null
  paid_minutes: number | null
  status: string
}

/** Assignment summary for the admin Attach Work Package dropdown. */
export interface AdminProjectAssignment {
  id: string
  work_package_name: string
  status: string
}

const ADMIN_SESSION_COLS =
  'id, assignment_id, project_id, project_name, work_package_name, work_date, ' +
  'clock_in_at, lunch_out_at, lunch_in_at, clock_out_at, ' +
  'total_minutes, lunch_minutes, paid_minutes, status'

export async function getPunchEditRequestsForDay(
  employeeProfileId: string,
  workDate: string,
): Promise<Result<PunchEditRequest[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    // RLS restricts to same org for owner/admin. Join through time_entries to filter by work_date.
    const { data: entryData } = await from('time_entries')
      .select('id')
      .eq('employee_profile_id', employeeProfileId)
      .eq('work_date', workDate)
      .maybeSingle()

    if (!entryData?.id) return { success: true, data: [] }

    const { data, error } = await from('time_punch_edit_requests')
      .select(PUNCH_EDIT_REQ_ADMIN_COLS)
      .eq('time_entry_id', entryData.id)
      .order('requested_at', { ascending: false })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: (data ?? []) as PunchEditRequest[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.getPunchEditRequestsForDay] Error:', err)
    return { success: false, error: message }
  }
}

// ── K. adminReviewPunchEditRequest — approve/reject via migration 097 RPC ─────

export async function adminReviewPunchEditRequest(
  requestId: string,
  status: 'approved' | 'rejected',
): Promise<Result<PunchEditRequest>> {
  try {
    const { data, error } = await rpc('admin_review_punch_edit_request', {
      p_request_id: requestId,
      p_status:     status,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data as PunchEditRequest }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.adminReviewPunchEditRequest] Error:', err)
    return { success: false, error: message }
  }
}

// ── L. getSessionsForDay — read employee sessions for admin modal (mig 099) ────

export async function getSessionsForDay(
  employeeProfileId: string,
  workDate: string,
): Promise<Result<AdminWorkSession[]>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data, error } = await from('employee_work_sessions')
      .select(ADMIN_SESSION_COLS)
      .eq('employee_profile_id', employeeProfileId)
      .eq('work_date', workDate)
      .order('created_at', { ascending: true })

    if (error) {
      // Non-fatal: table absent on older installs (pre-099)
      console.warn('[adminTimecardService.getSessionsForDay] sessions unavailable:', error.message)
      return { success: true, data: [] }
    }

    return { success: true, data: (data ?? []) as AdminWorkSession[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.getSessionsForDay] Error:', err)
    return { success: false, error: message }
  }
}

// ── M. adminRecordSessionPunch — session-aware correction (mig 099) ────────────
// Use this instead of adminRecordPunch when the punch has a session_id.
// The RPC updates the employee_work_sessions row, recomputes minutes, voids the
// old punch event, writes a new admin_edit event with session_id, and triggers
// sync_time_entry_from_sessions to rebuild the daily time_entries aggregate.

export async function adminRecordSessionPunch(
  sessionId: string,
  punchType: PunchType,
  punchedAt: string,
  notes?: string,
  supersedesId?: string,
): Promise<Result<AdminWorkSession>> {
  try {
    const { data, error } = await rpc('admin_record_session_punch', {
      p_session_id:    sessionId,
      p_punch_type:    punchType,
      p_punched_at:    punchedAt,
      p_supersedes_id: supersedesId ?? null,
      p_notes:         notes ?? null,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data as AdminWorkSession }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.adminRecordSessionPunch] Error:', err)
    return { success: false, error: message }
  }
}

// ── N. adminAttachSessionAssignment — attach a Work Package to a project-only session

/**
 * Owner/admin attaches an assignment (Work Package) to a project-only session.
 * Preserves all punch timestamps and minute totals exactly.
 * Calls admin_attach_session_assignment RPC (migration 100).
 */
export async function adminAttachSessionAssignment(
  sessionId: string,
  assignmentId: string,
): Promise<Result<AdminWorkSession>> {
  try {
    const { data, error } = await rpc('admin_attach_session_assignment', {
      p_session_id:    sessionId,
      p_assignment_id: assignmentId,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data as AdminWorkSession }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.adminAttachSessionAssignment] Error:', err)
    return { success: false, error: message }
  }
}

// ── O. getProjectAssignmentsForAdmin — active assignments for Attach Work Package UI

/**
 * Returns active assignments for a project so the admin can pick one to attach.
 * Calls get_project_assignments_for_admin RPC (migration 100).
 */
export async function getProjectAssignmentsForAdmin(
  projectId: string,
): Promise<Result<AdminProjectAssignment[]>> {
  try {
    const { data, error } = await rpc('get_project_assignments_for_admin', {
      p_project_id: projectId,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: (data ?? []) as AdminProjectAssignment[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.getProjectAssignmentsForAdmin] Error:', err)
    return { success: false, error: message }
  }
}

export async function adminUpdateApprovalStatus(
  timeEntryId: string,
  approvalStatus: string,
): Promise<Result<TimeEntry>> {
  try {
    const { data, error } = await rpc('admin_update_approval_status', {
      p_time_entry_id:   timeEntryId,
      p_approval_status: approvalStatus,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data as TimeEntry }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[adminTimecardService.adminUpdateApprovalStatus] Error:', err)
    return { success: false, error: message }
  }
}
