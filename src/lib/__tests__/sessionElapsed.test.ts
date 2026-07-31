/**
 * Pure elapsed-time helper tests (EMPLOYEE-CLOCK-WORKSPACE-1).
 *
 * calcElapsedMs is a pure function — no mocking, no I/O.
 * All behavior verified against concrete timestamps.
 */

import { describe, expect, it } from 'vitest'
import {
  calcElapsedMs,
  formatElapsed,
  formatElapsedHM,
  formatTenantTime,
} from '@/lib/sessionElapsed'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const T0 = '2026-07-30T08:00:00Z'   // Clock In
const T1 = '2026-07-30T12:00:00Z'   // Lunch Out  (4 h after T0)
const T2 = '2026-07-30T12:30:00Z'   // Lunch In   (30 m after T1)
const T3 = '2026-07-30T17:00:00Z'   // Clock Out  (8.5 h after T0, 30 m lunch)

const ms  = (iso: string) => new Date(iso).getTime()
const NOW = ms('2026-07-30T14:00:00Z')  // arbitrary "now" for open-session tests

// ── Before Clock In ───────────────────────────────────────────────────────────

describe('calcElapsedMs — before clock in', () => {
  it('returns all zeros when session is null (no timestamps)', () => {
    const r = calcElapsedMs(null, null, null, null, NOW)
    expect(r).toEqual({ workedMs: 0, lunchMs: 0, isOnLunch: false, isComplete: false })
  })

  it('returns all zeros when clock_in_at is undefined', () => {
    const r = calcElapsedMs(undefined, null, null, null, NOW)
    expect(r).toEqual({ workedMs: 0, lunchMs: 0, isOnLunch: false, isComplete: false })
  })
})

// ── Working (clocked in, no lunch yet) ────────────────────────────────────────

describe('calcElapsedMs — working phase', () => {
  it('workedMs equals (now - clockIn) when no lunch', () => {
    const now = ms(T0) + 2 * 3600_000   // 2 hours after clock-in
    const r = calcElapsedMs(T0, null, null, null, now)
    expect(r.workedMs).toBe(2 * 3600_000)
    expect(r.lunchMs).toBe(0)
    expect(r.isOnLunch).toBe(false)
    expect(r.isComplete).toBe(false)
  })

  it('workedMs is zero immediately at clock-in', () => {
    const r = calcElapsedMs(T0, null, null, null, ms(T0))
    expect(r.workedMs).toBe(0)
  })
})

// ── On Lunch ──────────────────────────────────────────────────────────────────

describe('calcElapsedMs — on_lunch phase', () => {
  it('workedMs is frozen at (lunchOut - clockIn)', () => {
    const now = ms(T1) + 15 * 60_000   // 15 min into lunch
    const r = calcElapsedMs(T0, T1, null, null, now)
    expect(r.workedMs).toBe(ms(T1) - ms(T0))   // 4 hours in ms
    expect(r.isOnLunch).toBe(true)
    expect(r.isComplete).toBe(false)
  })

  it('lunchMs increases while on lunch', () => {
    const nowA = ms(T1) + 10 * 60_000
    const nowB = ms(T1) + 20 * 60_000
    const rA = calcElapsedMs(T0, T1, null, null, nowA)
    const rB = calcElapsedMs(T0, T1, null, null, nowB)
    expect(rB.lunchMs).toBeGreaterThan(rA.lunchMs)
    expect(rB.lunchMs - rA.lunchMs).toBe(10 * 60_000)
  })

  it('workedMs does not increase while on lunch', () => {
    const nowA = ms(T1) + 5 * 60_000
    const nowB = ms(T1) + 25 * 60_000
    const rA = calcElapsedMs(T0, T1, null, null, nowA)
    const rB = calcElapsedMs(T0, T1, null, null, nowB)
    expect(rA.workedMs).toBe(rB.workedMs)
  })
})

// ── Back from Lunch ───────────────────────────────────────────────────────────

describe('calcElapsedMs — back_from_lunch phase', () => {
  it('lunchMs is the completed lunch duration', () => {
    const r = calcElapsedMs(T0, T1, T2, null, NOW)
    expect(r.lunchMs).toBe(ms(T2) - ms(T1))   // 30 min
    expect(r.isOnLunch).toBe(false)
  })

  it('workedMs resumes from lunch_in and subtracts completed lunch', () => {
    // 2 h after lunch return
    const now = ms(T2) + 2 * 3600_000
    const r = calcElapsedMs(T0, T1, T2, null, now)
    const totalElapsed = now - ms(T0)
    const completedLunch = ms(T2) - ms(T1)
    expect(r.workedMs).toBe(totalElapsed - completedLunch)
  })

  it('isOnLunch is false after lunch_in is set', () => {
    const r = calcElapsedMs(T0, T1, T2, null, NOW)
    expect(r.isOnLunch).toBe(false)
  })
})

// ── Completed session (clocked out) ──────────────────────────────────────────

describe('calcElapsedMs — complete phase', () => {
  it('isComplete is true when clock_out_at is set', () => {
    const r = calcElapsedMs(T0, T1, T2, T3, NOW)
    expect(r.isComplete).toBe(true)
  })

  it('workedMs is frozen at (clockOut - clockIn - lunchDuration)', () => {
    const r = calcElapsedMs(T0, T1, T2, T3, NOW)
    const totalElapsed = ms(T3) - ms(T0)
    const lunchDur = ms(T2) - ms(T1)
    expect(r.workedMs).toBe(totalElapsed - lunchDur)
  })

  it('workedMs does not change when now advances past clockOut', () => {
    const later = ms(T3) + 2 * 3600_000
    const rA = calcElapsedMs(T0, T1, T2, T3, ms(T3))
    const rB = calcElapsedMs(T0, T1, T2, T3, later)
    expect(rA.workedMs).toBe(rB.workedMs)
  })

  it('isOnLunch is false when clock_out_at is set', () => {
    const r = calcElapsedMs(T0, T1, T2, T3, NOW)
    expect(r.isOnLunch).toBe(false)
  })
})

// ── No lunch session (skip lunch, clock straight out) ─────────────────────────

describe('calcElapsedMs — no-lunch session', () => {
  it('workedMs equals (clockOut - clockIn) with no lunch', () => {
    const r = calcElapsedMs(T0, null, null, T3, NOW)
    expect(r.workedMs).toBe(ms(T3) - ms(T0))
    expect(r.lunchMs).toBe(0)
    expect(r.isComplete).toBe(true)
  })
})

// ── Refresh reconstructs timer ────────────────────────────────────────────────

describe('calcElapsedMs — reconstructs correctly from stored timestamps', () => {
  it('gives same result before and after a simulated page refresh', () => {
    const nowA = ms(T2) + 90 * 60_000
    // "Refresh" — same nowMs, same timestamps. Result must be identical.
    const rA = calcElapsedMs(T0, T1, T2, null, nowA)
    const rB = calcElapsedMs(T0, T1, T2, null, nowA)
    expect(rA).toEqual(rB)
  })
})

// ── Edge: non-negative results ────────────────────────────────────────────────

describe('calcElapsedMs — non-negative invariants', () => {
  it('workedMs is never negative', () => {
    // Pathological: clockIn in the future
    const r = calcElapsedMs(T3, null, null, null, ms(T0))
    expect(r.workedMs).toBeGreaterThanOrEqual(0)
  })

  it('lunchMs is never negative', () => {
    const r = calcElapsedMs(T0, T1, null, null, ms(T0))
    expect(r.lunchMs).toBeGreaterThanOrEqual(0)
  })
})

// ── formatElapsed ─────────────────────────────────────────────────────────────

describe('formatElapsed', () => {
  it('formats zero as 0:00:00', () => {
    expect(formatElapsed(0)).toBe('0:00:00')
  })

  it('formats 1 hour 2 min 3 sec', () => {
    expect(formatElapsed((3600 + 123) * 1000)).toBe('1:02:03')
  })

  it('pads minutes and seconds with leading zeros', () => {
    expect(formatElapsed(61 * 1000)).toBe('0:01:01')
  })

  it('handles large values (10+ hours)', () => {
    expect(formatElapsed(36000 * 1000)).toBe('10:00:00')
  })

  it('clamps negative input to 0:00:00', () => {
    expect(formatElapsed(-5000)).toBe('0:00:00')
  })
})

// ── formatElapsedHM ──────────────────────────────────────────────────────────

describe('formatElapsedHM', () => {
  it('formats 0 ms as 0m', () => {
    expect(formatElapsedHM(0)).toBe('0m')
  })

  it('formats 90 minutes as 1h 30m', () => {
    expect(formatElapsedHM(90 * 60_000)).toBe('1h 30m')
  })

  it('formats 45 minutes as 45m (no hour prefix)', () => {
    expect(formatElapsedHM(45 * 60_000)).toBe('45m')
  })
})

// ── formatTenantTime ──────────────────────────────────────────────────────────

describe('formatTenantTime', () => {
  it('returns a non-empty string', () => {
    expect(typeof formatTenantTime(Date.now())).toBe('string')
    expect(formatTenantTime(Date.now()).length).toBeGreaterThan(0)
  })

  it('includes AM or PM (12-hour format)', () => {
    const s = formatTenantTime(ms(T0))
    expect(s).toMatch(/AM|PM/)
  })
})
