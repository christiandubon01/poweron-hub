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
  project_id: string | null
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

/** Employee-safe active project returned by get_employee_active_projects (mig 100). */
export interface EmployeeActiveProject {
  id: string
  name: string
  status: string
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
  'id, org_id, employee_profile_id, assignment_id, project_id, work_order_version, ' +
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
 * Returns the employee's eligible active projects for project-only clocking.
 * Calls get_employee_active_projects RPC (migration 100).
 */
export async function getEmployeeActiveProjects(): Promise<{
  success: boolean
  projects?: EmployeeActiveProject[]
  error?: string
}> {
  try {
    const { data, error } = await rpc('get_employee_active_projects', {})

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, projects: (data ?? []) as EmployeeActiveProject[] }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTimeService.getEmployeeActiveProjects] Error:', err)
    return { success: false, error: message }
  }
}

/**
 * Extract the flat session JSONB payload from a record_session_punch RPC result.
 *
 * Migration 104 returns a flat camelCase object via jsonb_build_object:
 *   sessionId, status, workDate, projectId, assignmentId, projectName,
 *   workPackageName, clockInAt, lunchOutAt, lunchInAt, clockOutAt,
 *   paidMinutes, lunchMinutes, totalMinutes
 *
 * Also accepts JSON strings and a few wrapper shapes so a successful punch
 * is never dropped solely due to transport wrapping.
 */
export function extractSessionPunchPayload(data: unknown): Record<string, unknown> | null {
  let payload: unknown = data

  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return null
    }
  }

  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const obj = payload as Record<string, unknown>

  for (const key of ['sessionState', 'session_state', 'session'] as const) {
    const nested = obj[key]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>
    }
  }

  if (
    obj.sessionId != null ||
    obj.session_id != null ||
    obj.clockInAt != null ||
    obj.clock_in_at != null
  ) {
    return obj
  }

  return null
}

function pickSessionField(
  state: Record<string, unknown>,
  camel: string,
  snake: string,
): unknown {
  return state[camel] !== undefined ? state[camel] : state[snake]
}

/**
 * Convert the migration-104 RPC session JSONB (camelCase, or snake_case) into
 * a WorkSession row. Accepts Project-only sessions where assignment_id and
 * work_package_name are null. Returns null only when session identity is missing.
 */
export function sessionStateToWorkSession(
  state: Record<string, unknown>,
  existing: WorkSession | null = null,
): WorkSession | null {
  const sessionId = pickSessionField(state, 'sessionId', 'session_id')
  if (typeof sessionId !== 'string' || !sessionId) return null

  const asStringOrNull = (v: unknown): string | null =>
    v == null ? null : typeof v === 'string' ? v : String(v)

  const asNumberOrNull = (v: unknown): number | null => {
    if (v == null) return null
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : null
  }

  return {
    id:                  sessionId,
    org_id:              existing?.org_id ?? '',
    employee_profile_id: existing?.employee_profile_id ?? '',
    assignment_id:       asStringOrNull(pickSessionField(state, 'assignmentId', 'assignment_id')),
    project_id:          asStringOrNull(pickSessionField(state, 'projectId', 'project_id')),
    work_order_version:  existing?.work_order_version ?? null,
    project_name:        asStringOrNull(pickSessionField(state, 'projectName', 'project_name')),
    work_package_name:   asStringOrNull(pickSessionField(state, 'workPackageName', 'work_package_name')),
    work_date:           asStringOrNull(pickSessionField(state, 'workDate', 'work_date')) ?? existing?.work_date ?? '',
    clock_in_at:         asStringOrNull(pickSessionField(state, 'clockInAt', 'clock_in_at')),
    lunch_out_at:        asStringOrNull(pickSessionField(state, 'lunchOutAt', 'lunch_out_at')),
    lunch_in_at:         asStringOrNull(pickSessionField(state, 'lunchInAt', 'lunch_in_at')),
    clock_out_at:        asStringOrNull(pickSessionField(state, 'clockOutAt', 'clock_out_at')),
    total_minutes:       asNumberOrNull(pickSessionField(state, 'totalMinutes', 'total_minutes')),
    lunch_minutes:       asNumberOrNull(pickSessionField(state, 'lunchMinutes', 'lunch_minutes')),
    paid_minutes:        asNumberOrNull(pickSessionField(state, 'paidMinutes', 'paid_minutes')),
    status:              asStringOrNull(pickSessionField(state, 'status', 'status')) ?? existing?.status ?? 'open',
    created_at:          existing?.created_at ?? new Date().toISOString(),
  }
}

/**
 * Fingerprint of the last punch successfully applied to local Clock state.
 * Lunch timestamps must be tracked so a lagging getTodaySessions row for the
 * same session id cannot roll the UI back from On Lunch / Working-after-lunch.
 */
export interface LastAppliedPunchState {
  id: string
  clockOutAt: string | null
  lunchOutAt: string | null
  lunchInAt: string | null
}

/** Relative punch-phase rank for an open or completed session (higher = later). */
export function sessionPunchPhaseRank(s: {
  lunch_out_at?: string | null
  lunch_in_at?: string | null
  clock_out_at?: string | null
  lunchOutAt?: string | null
  lunchInAt?: string | null
  clockOutAt?: string | null
}): number {
  const clockOut = s.clock_out_at ?? s.clockOutAt
  const lunchIn  = s.lunch_in_at  ?? s.lunchInAt
  const lunchOut = s.lunch_out_at ?? s.lunchOutAt
  if (clockOut) return 3
  if (lunchIn)  return 2
  if (lunchOut) return 1
  return 0
}

/**
 * Resolve which session should be active after a background getTodaySessions
 * response. Protects authoritative local punch state from a stale load.
 *
 * Rules:
 *   - Prefer a server active session, unless we just clocked that session out.
 *   - If local/lastApplied is the same session and further ahead on lunch
 *     transitions than the server row, keep local (stale pre-lunch / on-lunch
 *     revalidation must not undo Start Lunch / End Lunch).
 *   - If the server has no active session but local still has one, keep local.
 *   - Otherwise clear active.
 */
export function resolveActiveSessionAfterLoad(
  serverSessions: WorkSession[],
  localActive: WorkSession | null,
  lastApplied: LastAppliedPunchState | null,
): WorkSession | null {
  const serverActive =
    serverSessions.find(s => s.clock_in_at && !s.clock_out_at) ?? null

  if (serverActive) {
    if (
      lastApplied &&
      lastApplied.id === serverActive.id &&
      lastApplied.clockOutAt
    ) {
      return null
    }

    if (
      localActive &&
      localActive.id === serverActive.id &&
      localActive.clock_in_at &&
      !localActive.clock_out_at &&
      sessionPunchPhaseRank(localActive) > sessionPunchPhaseRank(serverActive)
    ) {
      return localActive
    }

    if (
      lastApplied &&
      lastApplied.id === serverActive.id &&
      !lastApplied.clockOutAt &&
      sessionPunchPhaseRank(lastApplied) > sessionPunchPhaseRank(serverActive) &&
      localActive?.id === lastApplied.id &&
      localActive.clock_in_at &&
      !localActive.clock_out_at
    ) {
      return localActive
    }

    return serverActive
  }

  if (localActive?.clock_in_at && !localActive.clock_out_at) {
    return localActive
  }

  return null
}

/**
 * Records a job-linked session punch via record_session_punch RPC (migration 105).
 *
 * Clock In:
 *   - assignmentId supplied → assignment mode (stores BackupData project_id from assignment)
 *   - projectId supplied, no assignmentId → project-only mode (validated via app_state)
 *   - at least one must be supplied for clock_in
 *
 * Other actions (lunch_out, lunch_in, clock_out):
 *   - both assignmentId and projectId are sent as null; server resolves active session
 *
 * Clock Out:
 *   - optional endOfDaySummary is trimmed; empty becomes null
 *   - persisted on the Clock Out time_punch_events.end_of_day_summary row
 *
 * Always sends all four named parameters so PostgREST unambiguously routes to
 * record_session_punch(TEXT, UUID, TEXT, TEXT) from migration 105.
 */
export async function recordSessionPunch(
  action: PunchType,
  assignmentId?: string | null,
  projectId?: string | null,
  endOfDaySummary?: string | null,
): Promise<{
  success: boolean
  sessionState?: Record<string, unknown>
  error?: string
}> {
  try {
    const trimmedSummary =
      action === 'clock_out' && endOfDaySummary != null
        ? endOfDaySummary.trim()
        : ''

    const { data, error } = await rpc('record_session_punch', {
      p_action:             action,
      p_assignment_id:      action === 'clock_in' && assignmentId ? assignmentId : null,
      p_project_id:         action === 'clock_in' && !assignmentId && projectId ? projectId : null,
      p_end_of_day_summary: action === 'clock_out'
        ? (trimmedSummary.length > 0 ? trimmedSummary : null)
        : null,
    })

    if (error) {
      return { success: false, error: error.message || 'Could not record punch' }
    }

    const sessionState = extractSessionPunchPayload(data)
    if (!sessionState) {
      return { success: false, error: 'Punch was not recorded. Please try again.' }
    }

    return { success: true, sessionState }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeTimeService.recordSessionPunch] Error:', err)
    return { success: false, error: message }
  }
}
