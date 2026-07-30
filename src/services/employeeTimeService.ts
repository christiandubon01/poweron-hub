/**
 * employeeTimeService.ts — Employee time-clock read/write helpers (TIME-3 + SESSIONS-1)
 *
 * All punch writes go through the record_time_punch RPC (migration 081) or
 * the newer record_session_punch RPC (migration 099) for job-linked sessions.
 * This service NEVER inserts into time_punch_events or writes time_entries
 * directly — time_entries is maintained by the sync trigger. Reads are
 * plain SELECTs scoped by RLS (employee_user_id = auth.uid()).
 *
 * Public API (original):
 *   getTenantWorkDate()          — YYYY-MM-DD for the tenant tz (America/Los_Angeles)
 *   deriveClockPhase(punches)    — pure state machine from today's punches
 *   getNextActions(phase)        — allowed punch types for a phase
 *   getTodayTimeStatus()         — today's punches + summary + derived phase
 *   recordTimePunch(punchType, opts?) — calls record_time_punch RPC
 *
 * Public API (multi-session, migration 099):
 *   PUNCH_DISPLAY_ORDER          — fixed ordered punch labels (shared constant)
 *   EligibleAssignment           — type for job picker
 *   WorkSession                  — type for per-session clock row
 *   getMyEligibleAssignments()   — calls get_my_eligible_assignments RPC
 *   getTodaySessions()           — reads employee_work_sessions for today
 *   deriveSessionPhase(session)  — pure: ClockPhase from a WorkSession | null
 *   getNextSessionActions(phase) — pure: allowed punch types for a phase
 *   recordSessionPunch(action, assignmentId?) — calls record_session_punch RPC
 */

import { supabase } from '@/lib/supabase'

// Migration 081 RPC + time tables — cast until generated db types include them.
const rpc  = supabase.rpc as any
const from = supabase.from as any

// ── Types ─────────────────────────────────────────────────────────────────────

export type PunchType = 'clock_in' | 'lunch_out' | 'lunch_in' | 'clock_out'

export type ClockPhase =
  | 'off_clock'
  | 'working'
  | 'on_lunch'
  | 'back_from_lunch'
  | 'done'

/**
 * Fixed ordered punch definitions — shared across the session card, punch-edit
 * dialog, and tests. Do NOT duplicate this array.
 */
export const PUNCH_DISPLAY_ORDER: ReadonlyArray<{ type: PunchType; label: string }> = [
  { type: 'clock_in',  label: 'Clock In' },
  { type: 'lunch_out', label: 'Lunch Out' },
  { type: 'lunch_in',  label: 'Lunch In' },
  { type: 'clock_out', label: 'Clock Out' },
] as const

// ── Session types (migration 099) ─────────────────────────────────────────────

export interface EligibleAssignment {
  id: string
  project_id: string
  project_name: string
  work_package_id: string
  work_package_name: string
  due_date: string | null
  status: string
  work_order_version: number | null
}

export interface WorkSession {
  id: string
  org_id: string
  employee_profile_id: string
  assignment_id: string | null
  work_order_version: number | null
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

export interface TimePunchEvent {
  id: string
  org_id: string
  employee_user_id: string
  employee_profile_id: string
  work_date: string
  punch_type: PunchType
  punched_at: string
  source: string
  is_void: boolean
  session_id?: string | null
  notes?: string | null
  supersedes_id?: string | null
  end_of_day_summary?: string | null
}

export interface TimeEntry {
  id: string
  org_id: string
  employee_user_id: string
  employee_profile_id: string
  work_date: string
  clock_in_at: string | null
  lunch_out_at: string | null
  lunch_in_at: string | null
  clock_out_at: string | null
  total_minutes: number | null
  lunch_minutes: number | null
  paid_minutes: number | null
  status: string
  approval_status?: string
}

export interface TodayTimeStatus {
  workDate: string
  phase: ClockPhase
  punches: TimePunchEvent[]
  entry: TimeEntry | null
  nextActions: PunchType[]
}

// ── A. getTenantWorkDate ───────────────────────────────────────────────────────

const TENANT_TIMEZONE = 'America/Los_Angeles'

/**
 * Returns the current work date (YYYY-MM-DD) in the tenant timezone.
 * Mirrors migration 081 tenant_work_date() Phase 1 behavior.
 */
export function getTenantWorkDate(): string {
  // en-CA formats as YYYY-MM-DD; timeZone shifts the instant to LA local date.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TENANT_TIMEZONE,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).format(new Date())
}

// ── B. deriveClockPhase ────────────────────────────────────────────────────────

/**
 * Pure state machine — derives the clock phase from today's non-void punches.
 * Order of checks matters: clock_out is terminal, then lunch_in, lunch_out.
 */
export function deriveClockPhase(punches: TimePunchEvent[]): ClockPhase {
  const has = (t: PunchType) => punches.some(p => p.punch_type === t && !p.is_void)

  if (has('clock_out')) return 'done'
  if (!has('clock_in')) return 'off_clock'
  if (has('lunch_out') && !has('lunch_in')) return 'on_lunch'
  if (has('lunch_in')) return 'back_from_lunch'
  return 'working'
}

// ── C. getNextActions ──────────────────────────────────────────────────────────

export function getNextActions(phase: ClockPhase): PunchType[] {
  switch (phase) {
    case 'off_clock':       return ['clock_in']
    case 'working':         return ['lunch_out', 'clock_out']
    case 'on_lunch':        return ['lunch_in']
    case 'back_from_lunch': return ['clock_out']
    case 'done':            return []
    default:                return []
  }
}

// ── D. getTodayTimeStatus ──────────────────────────────────────────────────────

export async function getTodayTimeStatus(): Promise<{
  success: boolean
  status?: TodayTimeStatus
  error?: string
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    const workDate = getTenantWorkDate()

    const { data: punchData, error: punchError } = await from('time_punch_events')
      .select('id, org_id, employee_user_id, employee_profile_id, work_date, punch_type, punched_at, source, is_void, end_of_day_summary')
      .eq('employee_user_id', user.id)
      .eq('work_date', workDate)
      .eq('is_void', false)
      .order('punched_at', { ascending: true })

    if (punchError) {
      return { success: false, error: punchError.message }
    }

    const { data: entryData, error: entryError } = await from('time_entries')
      .select('id, org_id, employee_user_id, employee_profile_id, work_date, clock_in_at, lunch_out_at, lunch_in_at, clock_out_at, total_minutes, lunch_minutes, paid_minutes, status')
      .eq('employee_user_id', user.id)
      .eq('work_date', workDate)
      .maybeSingle()

    if (entryError) {
      return { success: false, error: entryError.message }
    }

    const punches = (punchData ?? []) as TimePunchEvent[]
    const phase = deriveClockPhase(punches)

    return {
      success: true,
      status: {
        workDate,
        phase,
        punches,
        entry: (entryData ?? null) as TimeEntry | null,
        nextActions: getNextActions(phase),
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTimeService.getTodayTimeStatus] Error:', err)
    return { success: false, error: message }
  }
}

// ── E. recordTimePunch ─────────────────────────────────────────────────────────

export interface RecordTimePunchOptions {
  /** Optional end-of-day summary; only sent / stored on clock_out. */
  endOfDaySummary?: string | null
}

/**
 * Records a punch via the record_time_punch RPC. The RPC validates sequence,
 * duplicates, and profile access, then returns the inserted row. Expected RPC
 * errors (invalid sequence, duplicate punch) are returned, not thrown.
 */
export async function recordTimePunch(
  punchType: PunchType,
  options?: RecordTimePunchOptions,
): Promise<{
  success: boolean
  punch?: TimePunchEvent
  error?: string
}> {
  try {
    const payload: { p_punch_type: PunchType; p_end_of_day_summary?: string | null } = {
      p_punch_type: punchType,
    }
    if (punchType === 'clock_out') {
      const trimmed = (options?.endOfDaySummary ?? '').trim()
      payload.p_end_of_day_summary = trimmed.length > 0 ? trimmed : null
    }

    const { data, error } = await rpc('record_time_punch', payload)

    if (error) {
      return { success: false, error: error.message || 'Could not record punch' }
    }

    return { success: true, punch: (data ?? undefined) as TimePunchEvent | undefined }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTimeService.recordTimePunch] Error:', err)
    return { success: false, error: message }
  }
}

// ── Session functions (migration 099) ─────────────────────────────────────────

/** Pure: derives the clock phase from a WorkSession row (or null = off_clock). */
export function deriveSessionPhase(session: WorkSession | null): ClockPhase {
  if (!session || !session.clock_in_at) return 'off_clock'
  if (session.clock_out_at) return 'done'
  if (session.lunch_out_at && !session.lunch_in_at) return 'on_lunch'
  if (session.lunch_in_at) return 'back_from_lunch'
  return 'working'
}

/** Pure: which punch actions are allowed for a given session phase. */
export function getNextSessionActions(phase: ClockPhase): PunchType[] {
  switch (phase) {
    case 'off_clock':       return ['clock_in']
    case 'working':         return ['lunch_out', 'clock_out']
    case 'on_lunch':        return ['lunch_in']
    case 'back_from_lunch': return ['clock_out']
    case 'done':            return []
    default:                return []
  }
}

const SESSION_COLS =
  'id, org_id, employee_profile_id, assignment_id, work_order_version, ' +
  'project_name, work_package_name, work_date, ' +
  'clock_in_at, lunch_out_at, lunch_in_at, clock_out_at, ' +
  'total_minutes, lunch_minutes, paid_minutes, status, created_at'

/**
 * Returns all of today's sessions for the signed-in employee, ordered by
 * clock_in_at ascending. RLS scopes to the employee's own sessions.
 */
export async function getTodaySessions(): Promise<{
  success: boolean
  sessions?: WorkSession[]
  error?: string
}> {
  try {
    const workDate = getTenantWorkDate()
    const { data, error } = await from('employee_work_sessions')
      .select(SESSION_COLS)
      .eq('work_date', workDate)
      .order('created_at', { ascending: true })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, sessions: (data ?? []) as WorkSession[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTimeService.getTodaySessions] Error:', err)
    return { success: false, error: message }
  }
}

/**
 * Returns the employee's eligible assignments for the job picker.
 * Calls get_my_eligible_assignments RPC (migration 099).
 */
export async function getMyEligibleAssignments(): Promise<{
  success: boolean
  assignments?: EligibleAssignment[]
  error?: string
}> {
  try {
    const { data, error } = await rpc('get_my_eligible_assignments', {})

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, assignments: (data ?? []) as EligibleAssignment[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTimeService.getMyEligibleAssignments] Error:', err)
    return { success: false, error: message }
  }
}

/**
 * Records a job-linked session punch via record_session_punch RPC (migration 099).
 * For clock_in: assignmentId is required.
 * For lunch_out, lunch_in, clock_out: assignmentId is ignored (server resolves active session).
 * Returns the updated session state JSONB.
 */
export async function recordSessionPunch(
  action: PunchType,
  assignmentId?: string | null,
): Promise<{
  success: boolean
  sessionState?: Record<string, unknown>
  error?: string
}> {
  try {
    const payload: { p_action: PunchType; p_assignment_id?: string } = {
      p_action: action,
    }
    if (action === 'clock_in' && assignmentId) {
      payload.p_assignment_id = assignmentId
    }

    const { data, error } = await rpc('record_session_punch', payload)

    if (error) {
      return { success: false, error: error.message || 'Could not record punch' }
    }

    return { success: true, sessionState: (data ?? undefined) as Record<string, unknown> | undefined }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTimeService.recordSessionPunch] Error:', err)
    return { success: false, error: message }
  }
}
