/**
 * employeePortalService.ts — Employee-facing portal data (TIME-5 + MY-TIME-WEEK-1)
 *
 * Reads: SELECT queries scoped to the signed-in employee via RLS.
 * Writes: only submitPunchEditRequest (calls SECURITY DEFINER RPC, migration 097).
 * No direct table inserts/updates/deletes. No backupDataService, no localStorage.
 *
 * Public API:
 *   getCurrentWeekRangeFromTenantDate()          — {startDate,endDate} Mon–Sun for today
 *   shiftWeekRange(range, weeks)                  — move a week range by ±N weeks
 *   addDaysToWorkDate(ymd, days)                  — shared YYYY-MM-DD day math
 *   getMyTimeSummary(startDate, endDate)          — own time entries + punches for a range
 *   getMyPunchEditRequests(entryIds)              — own punch edit requests for given entries
 *   submitPunchEditRequest(...)                   — employee submits a correction request
 */

import { supabase } from '@/lib/supabase'
import { getTenantWorkDate } from '@/services/employeeTimeService'

// Time tables and punch-edit RPC aren't in generated db types yet.
const from = supabase.from as any
const rpc  = supabase.rpc as any

// ── Types ─────────────────────────────────────────────────────────────────────

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export interface EmployeeMyTimeEntry {
  id: string
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

export interface EmployeeMyTimePunch {
  id: string
  work_date: string
  punch_type: 'clock_in' | 'lunch_out' | 'lunch_in' | 'clock_out'
  punched_at: string
  source: string
  is_void: boolean
  session_id: string | null
}

/** Per-session record returned by getMyTimeSummary (migration 099). */
export interface EmployeeWorkSession {
  id: string
  assignment_id: string | null
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
  created_at: string
}

export interface EmployeeMyTimeDay {
  workDate: string
  entry: EmployeeMyTimeEntry | null
  sessions: EmployeeWorkSession[]
  punches: EmployeeMyTimePunch[]
  paidMinutes: number | null
  lunchMinutes: number | null
  status: string
}

export interface EmployeeMyTimeSummary {
  startDate: string
  endDate: string
  days: EmployeeMyTimeDay[]
  totalPaidMinutes: number
  totalLunchMinutes: number
}

export interface WeekRange {
  startDate: string
  endDate: string
}

const ENTRY_COLS =
  'id, work_date, clock_in_at, lunch_out_at, lunch_in_at, clock_out_at, total_minutes, lunch_minutes, paid_minutes, status'
const PUNCH_COLS =
  'id, work_date, punch_type, punched_at, source, is_void, session_id'
const SESSION_COLS =
  'id, assignment_id, project_name, work_package_name, work_date, ' +
  'clock_in_at, lunch_out_at, lunch_in_at, clock_out_at, ' +
  'total_minutes, lunch_minutes, paid_minutes, status, created_at'

// ── Date helpers (YYYY-MM-DD, timezone-drift free) ─────────────────────────────

/** Parse a YYYY-MM-DD string as a local Date at midnight (no UTC shift). */
function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Format a local Date as YYYY-MM-DD. */
function formatLocalDate(date: Date): string {
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** Shift a YYYY-MM-DD string by n days. */
function addDays(ymd: string, days: number): string {
  const base = parseLocalDate(ymd)
  base.setDate(base.getDate() + days)
  return formatLocalDate(base)
}

/**
 * Current work week (Monday–Sunday) that contains the tenant work date.
 * Uses getTenantWorkDate() so the week aligns with the clock's work date.
 */
export function getCurrentWeekRangeFromTenantDate(): WeekRange {
  const today = getTenantWorkDate()
  const d = parseLocalDate(today)
  // getDay(): 0=Sun..6=Sat. Convert so Monday is the start of the week.
  const dow = d.getDay()
  const offsetToMonday = dow === 0 ? -6 : 1 - dow
  const startDate = addDays(today, offsetToMonday)
  const endDate = addDays(startDate, 6)
  return { startDate, endDate }
}

/**
 * Shared day math for portal week views (My Time, weekly task board) so every
 * employee surface derives its days from the same Monday-start convention.
 */
export function addDaysToWorkDate(ymd: string, days: number): string {
  return addDays(ymd, days)
}

/** Move a week range by ±N whole weeks. */
export function shiftWeekRange(range: WeekRange, weeks: number): WeekRange {
  return {
    startDate: addDays(range.startDate, weeks * 7),
    endDate: addDays(range.endDate, weeks * 7),
  }
}

/** Inclusive list of YYYY-MM-DD dates from startDate to endDate. */
function eachDate(startDate: string, endDate: string): string[] {
  const out: string[] = []
  let cursor = startDate
  // Guard against inverted ranges / runaway loops (cap at ~1 year).
  for (let i = 0; i < 400 && cursor <= endDate; i++) {
    out.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return out
}

// ── getMyTimeSummary ───────────────────────────────────────────────────────────

/**
 * Read-only weekly (or any range) time summary for the signed-in employee.
 * Rows are scoped to employee_user_id = auth.uid(); RLS enforces the same.
 * Never writes and never calls record_time_punch.
 */
export async function getMyTimeSummary(
  startDate: string,
  endDate: string,
): Promise<ServiceResult<EmployeeMyTimeSummary>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data: entryData, error: entryError } = await from('time_entries')
      .select(ENTRY_COLS)
      .eq('employee_user_id', user.id)
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .order('work_date', { ascending: true })

    if (entryError) {
      return { success: false, error: entryError.message }
    }

    const { data: punchData, error: punchError } = await from('time_punch_events')
      .select(PUNCH_COLS)
      .eq('employee_user_id', user.id)
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .eq('is_void', false)
      .order('punched_at', { ascending: true })

    if (punchError) {
      return { success: false, error: punchError.message }
    }

    // Fetch sessions (migration 099) — RLS scopes to this employee automatically
    const { data: sessionData, error: sessionError } = await from('employee_work_sessions')
      .select(SESSION_COLS)
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .order('work_date', { ascending: true })
      .order('created_at', { ascending: true })

    if (sessionError) {
      // Non-fatal: older installs without migration 099 — fall back to no sessions
      console.warn('[employeePortalService.getMyTimeSummary] sessions fetch skipped:', sessionError.message)
    }

    const entries = (entryData ?? []) as EmployeeMyTimeEntry[]
    const punches = (punchData ?? []) as EmployeeMyTimePunch[]
    const sessions = (sessionData ?? []) as EmployeeWorkSession[]

    // Index by work_date for the merge.
    const entryByDate = new Map<string, EmployeeMyTimeEntry>()
    for (const e of entries) entryByDate.set(e.work_date, e)

    const punchesByDate = new Map<string, EmployeeMyTimePunch[]>()
    for (const p of punches) {
      const list = punchesByDate.get(p.work_date) ?? []
      list.push(p)
      punchesByDate.set(p.work_date, list)
    }

    const sessionsByDate = new Map<string, EmployeeWorkSession[]>()
    for (const s of sessions) {
      const list = sessionsByDate.get(s.work_date) ?? []
      list.push(s)
      sessionsByDate.set(s.work_date, list)
    }

    // Build one row per calendar day so empty days still render.
    const days: EmployeeMyTimeDay[] = eachDate(startDate, endDate).map(workDate => {
      const entry = entryByDate.get(workDate) ?? null
      const dayPunches = punchesByDate.get(workDate) ?? []
      const daySessions = sessionsByDate.get(workDate) ?? []

      // Aggregate paid/lunch minutes: sum sessions when present, else use entry
      const paidMinutes = daySessions.length > 0
        ? daySessions.reduce((sum, s) => sum + (s.paid_minutes ?? 0), 0)
        : (entry?.paid_minutes ?? null)
      const lunchMinutes = daySessions.length > 0
        ? daySessions.reduce((sum, s) => sum + (s.lunch_minutes ?? 0), 0)
        : (entry?.lunch_minutes ?? null)

      return {
        workDate,
        entry,
        sessions: daySessions,
        punches: dayPunches,
        paidMinutes,
        lunchMinutes,
        status: entry?.status ?? (daySessions.length > 0 ? daySessions[daySessions.length - 1].status : 'none'),
      }
    })

    let totalPaidMinutes = 0
    let totalLunchMinutes = 0
    if (sessions.length > 0) {
      // Multi-session: aggregate from sessions directly
      for (const s of sessions) {
        if (typeof s.paid_minutes === 'number') totalPaidMinutes += s.paid_minutes
        if (typeof s.lunch_minutes === 'number') totalLunchMinutes += s.lunch_minutes
      }
    } else {
      // Legacy: aggregate from time_entries
      for (const e of entries) {
        if (typeof e.paid_minutes === 'number') totalPaidMinutes += e.paid_minutes
        if (typeof e.lunch_minutes === 'number') totalLunchMinutes += e.lunch_minutes
      }
    }

    return {
      success: true,
      data: {
        startDate,
        endDate,
        days,
        totalPaidMinutes,
        totalLunchMinutes,
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeePortalService.getMyTimeSummary] Error:', err)
    return { success: false, error: message }
  }
}

// ── PunchEditRequest (migration 097) ──────────────────────────────────────────

export interface PunchEditRequest {
  id: string
  org_id: string
  employee_profile_id: string
  time_entry_id: string
  session_id: string | null
  punch_event_id: string | null
  punch_type: 'clock_in' | 'lunch_out' | 'lunch_in' | 'clock_out'
  original_time: string | null
  requested_time: string
  employee_reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  requested_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

const PUNCH_EDIT_REQ_COLS =
  'id, org_id, employee_profile_id, time_entry_id, session_id, punch_event_id, punch_type, ' +
  'original_time, requested_time, employee_reason, status, requested_at, ' +
  'reviewed_by, reviewed_at, created_at, updated_at'

/**
 * Read the employee's own punch edit requests for the given time_entry IDs.
 * RLS restricts rows to the signed-in employee's profile.
 */
export async function getMyPunchEditRequests(
  entryIds: string[],
): Promise<ServiceResult<PunchEditRequest[]>> {
  if (entryIds.length === 0) return { success: true, data: [] }
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data, error } = await from('time_punch_edit_requests')
      .select(PUNCH_EDIT_REQ_COLS)
      .in('time_entry_id', entryIds)
      .order('requested_at', { ascending: false })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: (data ?? []) as PunchEditRequest[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeePortalService.getMyPunchEditRequests] Error:', err)
    return { success: false, error: message }
  }
}

/**
 * Submit a punch edit request via the submit_punch_edit_request RPC (migration 097/099).
 * sessionId (optional): targets a specific session when multiple sessions exist for the day.
 * The RPC captures the authoritative original_time from the server.
 */
export async function submitPunchEditRequest(
  timeEntryId: string,
  punchType: 'clock_in' | 'lunch_out' | 'lunch_in' | 'clock_out',
  requestedTime: string,
  employeeReason: string,
  sessionId?: string | null,
): Promise<ServiceResult<PunchEditRequest>> {
  try {
    const { data, error } = await rpc('submit_punch_edit_request', {
      p_time_entry_id:   timeEntryId,
      p_punch_type:      punchType,
      p_requested_time:  requestedTime,
      p_employee_reason: employeeReason,
      ...(sessionId ? { p_session_id: sessionId } : {}),
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data as PunchEditRequest }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeePortalService.submitPunchEditRequest] Error:', err)
    return { success: false, error: message }
  }
}
