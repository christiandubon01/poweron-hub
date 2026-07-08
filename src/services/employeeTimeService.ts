/**
 * employeeTimeService.ts — Employee time-clock read/write helpers (TIME-3)
 *
 * All punch writes go through the record_time_punch RPC (migration 081).
 * This service NEVER inserts into time_punch_events or writes time_entries
 * directly — time_entries is maintained by the sync trigger. Reads are
 * plain SELECTs scoped by RLS (employee_user_id = auth.uid()).
 *
 * Public API:
 *   getTenantWorkDate()          — YYYY-MM-DD for the tenant tz (America/Los_Angeles)
 *   deriveClockPhase(punches)    — pure state machine from today's punches
 *   getNextActions(phase)        — allowed punch types for a phase
 *   getTodayTimeStatus()         — today's punches + summary + derived phase
 *   recordTimePunch(punchType)   — calls record_time_punch RPC
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
      .select('id, org_id, employee_user_id, employee_profile_id, work_date, punch_type, punched_at, source, is_void')
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

/**
 * Records a punch via the record_time_punch RPC. The RPC validates sequence,
 * duplicates, and profile access, then returns the inserted row. Expected RPC
 * errors (invalid sequence, duplicate punch) are returned, not thrown.
 */
export async function recordTimePunch(punchType: PunchType): Promise<{
  success: boolean
  punch?: TimePunchEvent
  error?: string
}> {
  try {
    const { data, error } = await rpc('record_time_punch', {
      p_punch_type: punchType,
    })

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
