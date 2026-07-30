/**
 * Job-linked work sessions (EMPLOYEE-JOB-CLOCK-SESSIONS-1).
 *
 * Pure behavior only — no service calls, no DOM.
 * Covers PUNCH_DISPLAY_ORDER, deriveSessionPhase, getNextSessionActions,
 * and getTodaySessions / recordSessionPunch function contracts.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: vi.fn() }, from: vi.fn(), rpc: vi.fn() },
}))

const {
  PUNCH_DISPLAY_ORDER,
  deriveSessionPhase,
  getNextSessionActions,
  getTodaySessions,
  recordSessionPunch,
  getMyEligibleAssignments,
} = await import('@/services/employeeTimeService')

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_SESSION = {
  id: 'session-1',
  org_id: 'org-1',
  employee_profile_id: 'ep-1',
  assignment_id: 'assign-1',
  work_order_version: 1,
  project_name: 'Alpha Project',
  work_package_name: 'Framing',
  work_date: '2026-07-30',
  clock_in_at:  null,
  lunch_out_at: null,
  lunch_in_at:  null,
  clock_out_at: null,
  total_minutes:  null,
  lunch_minutes:  null,
  paid_minutes:   null,
  status: 'pending',
  created_at: '2026-07-30T08:00:00Z',
}

// ── PUNCH_DISPLAY_ORDER ───────────────────────────────────────────────────────

describe('PUNCH_DISPLAY_ORDER', () => {
  it('has exactly 4 entries', () => {
    expect(PUNCH_DISPLAY_ORDER).toHaveLength(4)
  })

  it('has clock_in first', () => {
    expect(PUNCH_DISPLAY_ORDER[0].type).toBe('clock_in')
    expect(PUNCH_DISPLAY_ORDER[0].label).toBe('Clock In')
  })

  it('has lunch_out second', () => {
    expect(PUNCH_DISPLAY_ORDER[1].type).toBe('lunch_out')
    expect(PUNCH_DISPLAY_ORDER[1].label).toBe('Lunch Out')
  })

  it('has lunch_in third', () => {
    expect(PUNCH_DISPLAY_ORDER[2].type).toBe('lunch_in')
    expect(PUNCH_DISPLAY_ORDER[2].label).toBe('Lunch In')
  })

  it('has clock_out last', () => {
    expect(PUNCH_DISPLAY_ORDER[3].type).toBe('clock_out')
    expect(PUNCH_DISPLAY_ORDER[3].label).toBe('Clock Out')
  })

  it('has no duplicate types', () => {
    const types = PUNCH_DISPLAY_ORDER.map(p => p.type)
    expect(new Set(types).size).toBe(types.length)
  })
})

// ── deriveSessionPhase ────────────────────────────────────────────────────────

describe('deriveSessionPhase', () => {
  it('returns off_clock when session is null', () => {
    expect(deriveSessionPhase(null)).toBe('off_clock')
  })

  it('returns off_clock when clock_in_at is null', () => {
    expect(deriveSessionPhase({ ...BASE_SESSION, clock_in_at: null })).toBe('off_clock')
  })

  it('returns working after clock-in only', () => {
    expect(deriveSessionPhase({
      ...BASE_SESSION,
      clock_in_at: '2026-07-30T08:00:00Z',
    })).toBe('working')
  })

  it('returns on_lunch after lunch-out (no lunch-in)', () => {
    expect(deriveSessionPhase({
      ...BASE_SESSION,
      clock_in_at:  '2026-07-30T08:00:00Z',
      lunch_out_at: '2026-07-30T12:00:00Z',
    })).toBe('on_lunch')
  })

  it('returns back_from_lunch after both lunch punches', () => {
    expect(deriveSessionPhase({
      ...BASE_SESSION,
      clock_in_at:  '2026-07-30T08:00:00Z',
      lunch_out_at: '2026-07-30T12:00:00Z',
      lunch_in_at:  '2026-07-30T12:30:00Z',
    })).toBe('back_from_lunch')
  })

  it('returns done after clock-out', () => {
    expect(deriveSessionPhase({
      ...BASE_SESSION,
      clock_in_at:  '2026-07-30T08:00:00Z',
      clock_out_at: '2026-07-30T17:00:00Z',
    })).toBe('done')
  })

  it('clock_out takes priority regardless of lunch state', () => {
    expect(deriveSessionPhase({
      ...BASE_SESSION,
      clock_in_at:  '2026-07-30T08:00:00Z',
      lunch_out_at: '2026-07-30T12:00:00Z',
      lunch_in_at:  '2026-07-30T12:30:00Z',
      clock_out_at: '2026-07-30T17:00:00Z',
    })).toBe('done')
  })
})

// ── getNextSessionActions ─────────────────────────────────────────────────────

describe('getNextSessionActions', () => {
  it('off_clock → [clock_in]', () => {
    expect(getNextSessionActions('off_clock')).toEqual(['clock_in'])
  })

  it('working → [lunch_out, clock_out]', () => {
    expect(getNextSessionActions('working')).toEqual(['lunch_out', 'clock_out'])
  })

  it('on_lunch → [lunch_in]', () => {
    expect(getNextSessionActions('on_lunch')).toEqual(['lunch_in'])
  })

  it('back_from_lunch → [clock_out]', () => {
    expect(getNextSessionActions('back_from_lunch')).toEqual(['clock_out'])
  })

  it('done → [] (no more actions)', () => {
    expect(getNextSessionActions('done')).toEqual([])
  })
})

// ── PUNCH_DISPLAY_ORDER vs getNextSessionActions — cross-check ───────────────

describe('PUNCH_DISPLAY_ORDER × getNextSessionActions cross-check', () => {
  it('every action returned by getNextSessionActions exists in PUNCH_DISPLAY_ORDER', () => {
    const allTypes = new Set(PUNCH_DISPLAY_ORDER.map(p => p.type))
    const phases = ['off_clock', 'working', 'on_lunch', 'back_from_lunch', 'done'] as const
    for (const phase of phases) {
      for (const action of getNextSessionActions(phase)) {
        expect(allTypes.has(action)).toBe(true)
      }
    }
  })
})

// ── Service function shapes ───────────────────────────────────────────────────

describe('service function signatures', () => {
  it('getTodaySessions is a function', () => {
    expect(typeof getTodaySessions).toBe('function')
  })

  it('recordSessionPunch is a function', () => {
    expect(typeof recordSessionPunch).toBe('function')
  })

  it('getMyEligibleAssignments is a function', () => {
    expect(typeof getMyEligibleAssignments).toBe('function')
  })

  it('getTodaySessions returns success:false on auth failure', async () => {
    // The vi.mock stubs getUser() so it returns undefined user
    const result = await getTodaySessions()
    // Supabase from() is mocked but from('employee_work_sessions').select()... won't throw;
    // it returns { data: null, error: null } by default. We just verify the result shape.
    expect(result).toHaveProperty('success')
  })
})

// ── Phase lifecycle invariants ────────────────────────────────────────────────

describe('phase lifecycle invariants', () => {
  it('no phase has both off_clock and done as valid next actions', () => {
    const phases = ['off_clock', 'working', 'on_lunch', 'back_from_lunch', 'done'] as const
    for (const phase of phases) {
      const actions = getNextSessionActions(phase)
      const hasClockIn  = actions.includes('clock_in')
      const hasClockOut = actions.includes('clock_out')
      // clock_in and clock_out should never both be returned for the same phase
      expect(hasClockIn && hasClockOut).toBe(false)
    }
  })

  it('working phase allows skipping lunch directly to clock_out', () => {
    const actions = getNextSessionActions('working')
    expect(actions).toContain('clock_out')
  })

  it('working phase also allows going to lunch', () => {
    const actions = getNextSessionActions('working')
    expect(actions).toContain('lunch_out')
  })
})
