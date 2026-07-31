/**
 * sessionElapsed.ts — Pure elapsed-time calculations for employee work sessions.
 *
 * No I/O, no side-effects, no React. All functions are deterministic given the
 * same inputs. Use these in components and in unit tests without any mocking.
 */

export interface ElapsedResult {
  /** Net worked time in ms (lunch duration subtracted). Increases each second while working. */
  workedMs: number
  /** Lunch time in ms (completed + current in-progress). */
  lunchMs: number
  /** True when lunch_out_at is set but lunch_in_at is not (and no clock_out). */
  isOnLunch: boolean
  /** True when clock_out_at is present. */
  isComplete: boolean
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return isNaN(t) ? null : t
}

/**
 * Calculate display-only elapsed times from session punch timestamps.
 *
 * @param clockInAt   - ISO string of Clock In punch (or null)
 * @param lunchOutAt  - ISO string of Lunch Out punch (or null)
 * @param lunchInAt   - ISO string of Lunch In punch (or null)
 * @param clockOutAt  - ISO string of Clock Out punch (or null)
 * @param nowMs       - Current wall-clock milliseconds (Date.now())
 *
 * Behavior:
 *   - Before Clock In:        workedMs=0, lunchMs=0
 *   - Working:                workedMs increases each second
 *   - On Lunch:               workedMs frozen at (lunchOut-clockIn), lunchMs increases
 *   - Back from Lunch:        workedMs increases (total - completedLunch), lunchMs frozen
 *   - Complete (clocked out): workedMs frozen at (clockOut-clockIn-lunch)
 */
export function calcElapsedMs(
  clockInAt:  string | null | undefined,
  lunchOutAt: string | null | undefined,
  lunchInAt:  string | null | undefined,
  clockOutAt: string | null | undefined,
  nowMs: number,
): ElapsedResult {
  const clockIn  = toMs(clockInAt)
  const lunchOut = toMs(lunchOutAt)
  const lunchIn  = toMs(lunchInAt)
  const clockOut = toMs(clockOutAt)

  if (clockIn == null) {
    return { workedMs: 0, lunchMs: 0, isOnLunch: false, isComplete: false }
  }

  const isComplete = clockOut != null
  const isOnLunch  = lunchOut != null && lunchIn == null && !isComplete

  // Completed lunch (lunch_out → lunch_in)
  const completedLunchMs = (lunchOut != null && lunchIn != null)
    ? Math.max(0, lunchIn - lunchOut)
    : 0

  // Current in-progress lunch (lunch_out → now)
  const activeLunchMs = isOnLunch ? Math.max(0, nowMs - lunchOut!) : 0
  const lunchMs = completedLunchMs + activeLunchMs

  // End of the time span we measure
  const end = isComplete ? clockOut! : nowMs

  // If on lunch, worked time is frozen at (lunchOut - clockIn)
  const workedMs = isOnLunch
    ? Math.max(0, lunchOut! - clockIn)
    : Math.max(0, (end - clockIn) - completedLunchMs)

  return { workedMs, lunchMs, isOnLunch, isComplete }
}

/**
 * Format elapsed milliseconds as H:MM:SS (no leading zero on hours).
 * Used for the active session timer display.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Format elapsed milliseconds as "Xh Ym" (rounded to minutes).
 * Used for compact worked/lunch summaries.
 */
export function formatElapsedHM(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/**
 * Format the tenant-local wall clock time (with seconds) from a timestamp.
 * Uses America/Los_Angeles to match the existing TENANT_TIMEZONE constant.
 */
export function formatTenantTime(nowMs: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour:     'numeric',
    minute:   '2-digit',
    second:   '2-digit',
    hour12:   true,
  }).format(new Date(nowMs))
}
