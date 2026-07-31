/**
 * Project-only instant punch state (EMERG-PROJECT-ONLY-INSTANT-STATE-1).
 *
 * Mocks the migration-104 successful RPC return shape and verifies:
 *   - service extracts the flat camelCase session payload
 *   - mapper accepts null assignment_id / work_package_name
 *   - TimeClock applies success immediately (no reload)
 *   - stale empty background loads cannot clear the active session
 *   - assignment / lunch / clock-out / failure paths still behave correctly
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const mockRpc = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from:  mockFrom,
    rpc:   mockRpc,
  },
}))

const {
  recordSessionPunch,
  extractSessionPunchPayload,
  sessionStateToWorkSession,
  resolveActiveSessionAfterLoad,
  deriveSessionPhase,
  getNextSessionActions,
} = await import('@/services/employeeTimeService')

import type { WorkSession } from '@/services/employeeTimeService'

// ── Fixtures matching migration 104 jsonb_build_object ───────────────────────

const SAMPLE_PROJECT_ID    = 'proj1778524126621o7dn'
const SAMPLE_ASSIGNMENT_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
const SAMPLE_SESSION_ID    = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const SAMPLE_CLOCK_IN      = '2026-07-30T15:00:00.000Z'

/** Exact top-level keys returned by migration 104 on successful Project-only Clock In. */
const MIGRATION_104_PROJECT_ONLY_SUCCESS = {
  sessionId:       SAMPLE_SESSION_ID,
  status:          'open',
  workDate:        '2026-07-30',
  projectId:       SAMPLE_PROJECT_ID,
  assignmentId:    null,
  projectName:     "Rock'n Avenue",
  workPackageName: null,
  clockInAt:       SAMPLE_CLOCK_IN,
  lunchOutAt:      null,
  lunchInAt:       null,
  clockOutAt:      null,
  paidMinutes:     null,
  lunchMinutes:    0,
  totalMinutes:    null,
}

const MIGRATION_104_ASSIGNMENT_SUCCESS = {
  ...MIGRATION_104_PROJECT_ONLY_SUCCESS,
  assignmentId:    SAMPLE_ASSIGNMENT_ID,
  projectName:     'Alpha Project',
  workPackageName: 'Emergency Circuit',
}

function rpcSuccess(data: unknown = MIGRATION_104_PROJECT_ONLY_SUCCESS) {
  mockRpc.mockResolvedValueOnce({ data, error: null })
}

function rpcError(message: string) {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message } })
}

function asWorkSession(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id:                  SAMPLE_SESSION_ID,
    org_id:              'org-1',
    employee_profile_id: 'ep-1',
    assignment_id:       null,
    project_id:          SAMPLE_PROJECT_ID,
    work_order_version:  null,
    project_name:        "Rock'n Avenue",
    work_package_name:   null,
    work_date:           '2026-07-30',
    clock_in_at:         SAMPLE_CLOCK_IN,
    lunch_out_at:        null,
    lunch_in_at:         null,
    clock_out_at:        null,
    total_minutes:       null,
    lunch_minutes:       0,
    paid_minutes:        null,
    status:              'open',
    created_at:          SAMPLE_CLOCK_IN,
    ...overrides,
  }
}

// ── Migration 104 return shape (source) ───────────────────────────────────────

const root = process.cwd()
const mig104Path = join(root, 'supabase/migrations/104_project_only_ownerless_assignment_fallback.sql')
const mig104 = existsSync(mig104Path) ? readFileSync(mig104Path, 'utf8') : ''
const timeClock = readFileSync(
  join(root, 'src/components/employee/EmployeeTimeClock.tsx'),
  'utf8',
)

describe('migration 104 success response shape', () => {
  it('returns flat camelCase jsonb_build_object keys (not session_state wrapper)', () => {
    expect(mig104).toContain("RETURN jsonb_build_object(")
    for (const key of [
      'sessionId', 'status', 'workDate', 'projectId', 'assignmentId',
      'projectName', 'workPackageName', 'clockInAt', 'lunchOutAt',
      'lunchInAt', 'clockOutAt', 'paidMinutes', 'lunchMinutes', 'totalMinutes',
    ]) {
      expect(mig104).toContain(`'${key}'`)
    }
    expect(mig104).not.toContain("'session_state'")
    expect(mig104).not.toContain("'sessionState'")
  })
})

// ── extractSessionPunchPayload ────────────────────────────────────────────────

describe('extractSessionPunchPayload — migration 104 shape', () => {
  it('extracts the flat Project-only success object', () => {
    const extracted = extractSessionPunchPayload(MIGRATION_104_PROJECT_ONLY_SUCCESS)
    expect(extracted).not.toBeNull()
    expect(extracted!.sessionId).toBe(SAMPLE_SESSION_ID)
    expect(extracted!.assignmentId).toBeNull()
    expect(extracted!.workPackageName).toBeNull()
    expect(extracted!.projectId).toBe(SAMPLE_PROJECT_ID)
  })

  it('parses a JSON string payload', () => {
    const extracted = extractSessionPunchPayload(
      JSON.stringify(MIGRATION_104_PROJECT_ONLY_SUCCESS),
    )
    expect(extracted?.sessionId).toBe(SAMPLE_SESSION_ID)
  })

  it('unwraps nested session / sessionState wrappers', () => {
    expect(
      extractSessionPunchPayload({ session: MIGRATION_104_PROJECT_ONLY_SUCCESS })?.sessionId,
    ).toBe(SAMPLE_SESSION_ID)
    expect(
      extractSessionPunchPayload({ sessionState: MIGRATION_104_PROJECT_ONLY_SUCCESS })?.sessionId,
    ).toBe(SAMPLE_SESSION_ID)
  })

  it('returns null for empty / invalid payloads', () => {
    expect(extractSessionPunchPayload(null)).toBeNull()
    expect(extractSessionPunchPayload({})).toBeNull()
    expect(extractSessionPunchPayload('not-json')).toBeNull()
  })
})

// ── sessionStateToWorkSession mapper ──────────────────────────────────────────

describe('sessionStateToWorkSession — Project-only acceptance', () => {
  it('maps migration-104 Project-only success with null assignment and work package', () => {
    const session = sessionStateToWorkSession(MIGRATION_104_PROJECT_ONLY_SUCCESS, null)
    expect(session).not.toBeNull()
    expect(session!.id).toBe(SAMPLE_SESSION_ID)
    expect(session!.assignment_id).toBeNull()
    expect(session!.work_package_name).toBeNull()
    expect(session!.project_id).toBe(SAMPLE_PROJECT_ID)
    expect(session!.project_name).toBe("Rock'n Avenue")
    expect(session!.clock_in_at).toBe(SAMPLE_CLOCK_IN)
    expect(session!.lunch_out_at).toBeNull()
    expect(session!.clock_out_at).toBeNull()
    expect(session!.status).toBe('open')
  })

  it('does not require work_order_version or assignment_id', () => {
    const session = sessionStateToWorkSession(MIGRATION_104_PROJECT_ONLY_SUCCESS, null)
    expect(session!.work_order_version).toBeNull()
    expect(session!.assignment_id).toBeNull()
  })

  it('maps assignment Clock In with work package name preserved', () => {
    const session = sessionStateToWorkSession(MIGRATION_104_ASSIGNMENT_SUCCESS, null)
    expect(session!.assignment_id).toBe(SAMPLE_ASSIGNMENT_ID)
    expect(session!.work_package_name).toBe('Emergency Circuit')
  })

  it('returns null when session identity is missing', () => {
    expect(sessionStateToWorkSession({ clockInAt: SAMPLE_CLOCK_IN }, null)).toBeNull()
  })
})

// ── recordSessionPunch service extraction ─────────────────────────────────────

describe('recordSessionPunch — extracts migration-104 session', () => {
  beforeEach(() => mockRpc.mockClear())

  it('returns success with Project-only sessionState (null assignment_id accepted)', async () => {
    rpcSuccess(MIGRATION_104_PROJECT_ONLY_SUCCESS)
    const res = await recordSessionPunch('clock_in', null, SAMPLE_PROJECT_ID)

    expect(res.success).toBe(true)
    expect(res.sessionState).toBeDefined()
    expect(res.sessionState!.sessionId).toBe(SAMPLE_SESSION_ID)
    expect(res.sessionState!.assignmentId).toBeNull()
    expect(res.sessionState!.workPackageName).toBeNull()

    const mapped = sessionStateToWorkSession(res.sessionState!, null)
    expect(deriveSessionPhase(mapped)).toBe('working')
    expect(getNextSessionActions('working')).toEqual(['lunch_out', 'clock_out'])
  })

  it('returns success for assignment Clock In', async () => {
    rpcSuccess(MIGRATION_104_ASSIGNMENT_SUCCESS)
    const res = await recordSessionPunch('clock_in', SAMPLE_ASSIGNMENT_ID, null)
    expect(res.success).toBe(true)
    const mapped = sessionStateToWorkSession(res.sessionState!, null)
    expect(mapped!.work_package_name).toBe('Emergency Circuit')
    expect(deriveSessionPhase(mapped)).toBe('working')
  })

  it('does not invent local success on RPC failure', async () => {
    rpcError('Project not found, not active, or not available to this employee')
    const res = await recordSessionPunch('clock_in', null, SAMPLE_PROJECT_ID)
    expect(res.success).toBe(false)
    expect(res.sessionState).toBeUndefined()
    expect(res.error).toBeTruthy()
  })

  it('Start Lunch / End Lunch / Clock Out return updated sessionState', async () => {
    rpcSuccess({
      ...MIGRATION_104_PROJECT_ONLY_SUCCESS,
      lunchOutAt: '2026-07-30T16:00:00.000Z',
    })
    const lunchOut = await recordSessionPunch('lunch_out')
    expect(lunchOut.success).toBe(true)
    expect(deriveSessionPhase(sessionStateToWorkSession(lunchOut.sessionState!, null))).toBe('on_lunch')

    rpcSuccess({
      ...MIGRATION_104_PROJECT_ONLY_SUCCESS,
      lunchOutAt: '2026-07-30T16:00:00.000Z',
      lunchInAt:  '2026-07-30T16:30:00.000Z',
    })
    const lunchIn = await recordSessionPunch('lunch_in')
    expect(deriveSessionPhase(sessionStateToWorkSession(lunchIn.sessionState!, null))).toBe('back_from_lunch')

    rpcSuccess({
      ...MIGRATION_104_PROJECT_ONLY_SUCCESS,
      clockOutAt: '2026-07-30T17:00:00.000Z',
      status: 'complete',
    })
    const clockOut = await recordSessionPunch('clock_out')
    expect(deriveSessionPhase(sessionStateToWorkSession(clockOut.sessionState!, null))).toBe('done')
    expect(getNextSessionActions('done')).toEqual([])
  })
})

// ── Stale background load protection ──────────────────────────────────────────

function appliedOf(session: WorkSession) {
  return {
    id: session.id,
    clockOutAt: session.clock_out_at,
    lunchOutAt: session.lunch_out_at,
    lunchInAt:  session.lunch_in_at,
  }
}

describe('resolveActiveSessionAfterLoad — stale empty protection', () => {
  it('keeps local Project-only active when server returns empty sessions', () => {
    const local = asWorkSession()
    const next = resolveActiveSessionAfterLoad([], local, appliedOf(local))
    expect(next).toBe(local)
    expect(deriveSessionPhase(next)).toBe('working')
    expect(getNextSessionActions('working')).toContain('lunch_out')
    expect(getNextSessionActions('working')).toContain('clock_out')
  })

  it('prefers a newer valid server active session', () => {
    const local = asWorkSession({ id: 'old' })
    const server = asWorkSession({ id: 'new', project_name: 'Server Wins' })
    const next = resolveActiveSessionAfterLoad([server], local, appliedOf(local))
    expect(next?.id).toBe('new')
  })

  it('does not restore server active after local clock-out of same session', () => {
    const serverStillActive = asWorkSession()
    const next = resolveActiveSessionAfterLoad([serverStillActive], null, {
      id: SAMPLE_SESSION_ID,
      clockOutAt: '2026-07-30T17:00:00.000Z',
      lunchOutAt: null,
      lunchInAt: null,
    })
    expect(next).toBeNull()
    expect(deriveSessionPhase(next)).toBe('off_clock')
  })

  it('clears active when server and local are both idle', () => {
    const next = resolveActiveSessionAfterLoad(
      [asWorkSession({ clock_out_at: '2026-07-30T17:00:00.000Z' })],
      null,
      null,
    )
    expect(next).toBeNull()
  })
})

describe('resolveActiveSessionAfterLoad — lunch phase preservation (EMERG-LUNCH-INSTANT-STATE-1)', () => {
  it('keeps local On Lunch when server returns same session still pre-lunch', () => {
    const local = asWorkSession({
      lunch_out_at: '2026-07-30T16:00:00.000Z',
    })
    const staleServer = asWorkSession({
      lunch_out_at: null,
      lunch_in_at: null,
    })
    const next = resolveActiveSessionAfterLoad([staleServer], local, appliedOf(local))
    expect(next).toBe(local)
    expect(deriveSessionPhase(next)).toBe('on_lunch')
    expect(getNextSessionActions('on_lunch')).toEqual(['lunch_in'])
  })

  it('keeps local back-from-lunch when server returns same session still on lunch', () => {
    const local = asWorkSession({
      lunch_out_at: '2026-07-30T16:00:00.000Z',
      lunch_in_at:  '2026-07-30T16:30:00.000Z',
    })
    const staleServer = asWorkSession({
      lunch_out_at: '2026-07-30T16:00:00.000Z',
      lunch_in_at: null,
    })
    const next = resolveActiveSessionAfterLoad([staleServer], local, appliedOf(local))
    expect(next).toBe(local)
    expect(deriveSessionPhase(next)).toBe('back_from_lunch')
    expect(getNextSessionActions('back_from_lunch')).toEqual(['clock_out'])
  })

  it('accepts server when it has caught up to the same lunch phase', () => {
    const local = asWorkSession({
      lunch_out_at: '2026-07-30T16:00:00.000Z',
    })
    const server = asWorkSession({
      lunch_out_at: '2026-07-30T16:00:00.000Z',
      project_name: 'Server Echo',
    })
    const next = resolveActiveSessionAfterLoad([server], local, appliedOf(local))
    expect(next?.project_name).toBe('Server Echo')
    expect(deriveSessionPhase(next)).toBe('on_lunch')
  })
})

// ── EmployeeTimeClock source contracts ────────────────────────────────────────

describe('EmployeeTimeClock immediate-state contracts', () => {
  it('imports sessionStateToWorkSession and resolveActiveSessionAfterLoad', () => {
    expect(timeClock).toContain('sessionStateToWorkSession')
    expect(timeClock).toContain('resolveActiveSessionAfterLoad')
  })

  it('applies RPC session immediately on success before background load', () => {
    expect(timeClock).toContain('setActiveSession(updated)')
    expect(timeClock).toContain('loadGenRef.current += 1')
    expect(timeClock).toContain('lastAppliedRef')
    expect(timeClock).toContain('onPunchSuccess?.()')
    expect(timeClock).toContain('loadSessions(false)')
  })

  it('fingerprints lunchOutAt and lunchInAt on lastAppliedRef', () => {
    expect(timeClock).toContain('lunchOutAt: updated.lunch_out_at')
    expect(timeClock).toContain('lunchInAt:  updated.lunch_in_at')
    expect(timeClock).toContain('sessionPunchPhaseRank')
  })

  it('does not call location.reload or setTimeout', () => {
    expect(timeClock).not.toContain('location.reload')
    expect(timeClock).not.toContain('setTimeout(')
  })

  it('shows Clocked in / Project Only / Start Lunch / Clock Out labels', () => {
    expect(timeClock).toContain('Clocked in')
    expect(timeClock).toContain('Project Only')
    expect(timeClock).toContain("lunch_out: 'Start Lunch'")
    expect(timeClock).toContain("clock_out: 'Clock Out'")
    expect(timeClock).toContain('Current Time Session')
  })

  it('clears pending in finally and surfaces errors without inventing active state', () => {
    expect(timeClock).toContain('finally {')
    expect(timeClock).toContain('setPending(null)')
    expect(timeClock).toContain("setError(res.error || 'Could not record punch.')")
  })
})
