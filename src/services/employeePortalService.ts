/**
 * employeePortalService.ts — Employee-facing read-only portal data (TIME-5)
 *
 * READ ONLY. SELECT queries only. This service never writes: no record_time_punch,
 * no write RPC, no insert/update/delete/upsert. Every query is scoped to the
 * signed-in employee via employee_user_id = auth.uid() (RLS te_employee_select_own
 * / tpe_employee_select_own from migration 081). No backupDataService, no
 * localStorage.
 *
 * Public API:
 *   getCurrentWeekRangeFromTenantDate()          — {startDate,endDate} Mon–Sun for today
 *   shiftWeekRange(range, weeks)                  — move a week range by ±N weeks
 *   getMyTimeSummary(startDate, endDate)          — own time entries + punches for a range
 */

import { supabase } from '@/lib/supabase'
import { getTenantWorkDate } from '@/services/employeeTimeService'

// Time tables aren't in the generated db types yet — cast the query builder.
const from = supabase.from as any

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
}

export interface EmployeeMyTimeDay {
  workDate: string
  entry: EmployeeMyTimeEntry | null
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
  'id, work_date, punch_type, punched_at, source, is_void'

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

    const entries = (entryData ?? []) as EmployeeMyTimeEntry[]
    const punches = (punchData ?? []) as EmployeeMyTimePunch[]

    // Index by work_date for the merge.
    const entryByDate = new Map<string, EmployeeMyTimeEntry>()
    for (const e of entries) entryByDate.set(e.work_date, e)

    const punchesByDate = new Map<string, EmployeeMyTimePunch[]>()
    for (const p of punches) {
      const list = punchesByDate.get(p.work_date) ?? []
      list.push(p)
      punchesByDate.set(p.work_date, list)
    }

    // Build one row per calendar day so empty days still render.
    const days: EmployeeMyTimeDay[] = eachDate(startDate, endDate).map(workDate => {
      const entry = entryByDate.get(workDate) ?? null
      const dayPunches = punchesByDate.get(workDate) ?? []
      return {
        workDate,
        entry,
        punches: dayPunches,
        paidMinutes: entry?.paid_minutes ?? null,
        lunchMinutes: entry?.lunch_minutes ?? null,
        status: entry?.status ?? 'none',
      }
    })

    let totalPaidMinutes = 0
    let totalLunchMinutes = 0
    for (const e of entries) {
      if (typeof e.paid_minutes === 'number') totalPaidMinutes += e.paid_minutes
      if (typeof e.lunch_minutes === 'number') totalLunchMinutes += e.lunch_minutes
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
