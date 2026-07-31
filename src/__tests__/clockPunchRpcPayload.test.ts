/**
 * Clock punch RPC payload contract (EMERG-EMPLOYEE-CLOCK-RPC-1 + CLOSEOUT-1).
 *
 * Verifies that recordSessionPunch always sends all four named parameters to
 * record_session_punch(TEXT, UUID, TEXT, TEXT) from migration 105, preventing
 * PostgREST overload ambiguity.
 *
 * Root cause context:
 *   Migration 099 created record_session_punch(TEXT, UUID DEFAULT NULL).
 *   Migration 101 created the 3-arg (TEXT, UUID, TEXT).
 *   Migration 102 drops the 2-arg overload permanently.
 *   Migration 105 replaces the 3-arg with a 4-arg that adds p_end_of_day_summary.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Mock Supabase before importing the service ────────────────────────────────

const mockRpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from:  vi.fn(),
    rpc:   mockRpc,
  },
}))

const { recordSessionPunch } = await import('@/services/employeeTimeService')

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_PROJECT_ID    = 'proj1778524126621o7dn'
const SAMPLE_ASSIGNMENT_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
const SAMPLE_SESSION_ID    = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

const makeSessionState = (overrides: Record<string, unknown> = {}) => ({
  sessionId:       SAMPLE_SESSION_ID,
  status:          'open',
  workDate:        '2026-07-30',
  projectId:       SAMPLE_PROJECT_ID,
  assignmentId:    null,
  projectName:     'Test Project',
  workPackageName: null,
  clockInAt:       '2026-07-30T15:00:00Z',
  lunchOutAt:      null,
  lunchInAt:       null,
  clockOutAt:      null,
  paidMinutes:     null,
  lunchMinutes:    0,
  totalMinutes:    null,
  ...overrides,
})

function rpcSuccess(data: unknown = makeSessionState()) {
  mockRpc.mockResolvedValueOnce({ data, error: null })
}

function rpcError(message: string) {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message } })
}

// ── Project-only clock_in ─────────────────────────────────────────────────────

describe('recordSessionPunch — project-only clock_in', () => {
  beforeEach(() => mockRpc.mockClear())

  it('sends p_action=clock_in, p_assignment_id=null, p_project_id=BackupData ID', async () => {
    rpcSuccess()
    await recordSessionPunch('clock_in', null, SAMPLE_PROJECT_ID)

    expect(mockRpc).toHaveBeenCalledWith('record_session_punch', {
      p_action:             'clock_in',
      p_assignment_id:      null,
      p_project_id:         SAMPLE_PROJECT_ID,
      p_end_of_day_summary: null,
    })
  })

  it('returns success:true with sessionState on RPC success', async () => {
    rpcSuccess()
    const res = await recordSessionPunch('clock_in', null, SAMPLE_PROJECT_ID)

    expect(res.success).toBe(true)
    expect(res.sessionState).toBeDefined()
    expect((res.sessionState as Record<string, unknown>).sessionId).toBe(SAMPLE_SESSION_ID)
  })

  it('returns success:false with error on project-not-found', async () => {
    rpcError('Project not found, not active, or does not belong to this organization')
    const res = await recordSessionPunch('clock_in', null, SAMPLE_PROJECT_ID)

    expect(res.success).toBe(false)
    expect(res.error).toContain('Project not found')
  })

  it('returns success:false when RPC returns null data with no error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })
    const res = await recordSessionPunch('clock_in', null, SAMPLE_PROJECT_ID)

    expect(res.success).toBe(false)
    expect(res.error).toBeDefined()
  })

  it('p_assignment_id is explicitly null — not undefined, not absent', async () => {
    rpcSuccess()
    await recordSessionPunch('clock_in', null, SAMPLE_PROJECT_ID)

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(params, 'p_assignment_id')).toBe(true)
    expect(params.p_assignment_id).toBeNull()
  })
})

// ── Assignment clock_in ───────────────────────────────────────────────────────

describe('recordSessionPunch — assignment clock_in', () => {
  beforeEach(() => mockRpc.mockClear())

  it('sends p_action=clock_in, p_assignment_id=UUID, p_project_id=null', async () => {
    rpcSuccess(makeSessionState({ assignmentId: SAMPLE_ASSIGNMENT_ID, projectId: null }))
    await recordSessionPunch('clock_in', SAMPLE_ASSIGNMENT_ID, null)

    expect(mockRpc).toHaveBeenCalledWith('record_session_punch', {
      p_action:             'clock_in',
      p_assignment_id:      SAMPLE_ASSIGNMENT_ID,
      p_project_id:         null,
      p_end_of_day_summary: null,
    })
  })

  it('prefers assignmentId over projectId when both supplied', async () => {
    rpcSuccess()
    await recordSessionPunch('clock_in', SAMPLE_ASSIGNMENT_ID, SAMPLE_PROJECT_ID)

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>
    expect(params.p_assignment_id).toBe(SAMPLE_ASSIGNMENT_ID)
    expect(params.p_project_id).toBeNull()
  })

  it('p_project_id is explicitly null — not undefined, not absent', async () => {
    rpcSuccess()
    await recordSessionPunch('clock_in', SAMPLE_ASSIGNMENT_ID, null)

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(params, 'p_project_id')).toBe(true)
    expect(params.p_project_id).toBeNull()
  })

  it('returns success:true with sessionState on RPC success', async () => {
    rpcSuccess(makeSessionState({ assignmentId: SAMPLE_ASSIGNMENT_ID }))
    const res = await recordSessionPunch('clock_in', SAMPLE_ASSIGNMENT_ID, null)

    expect(res.success).toBe(true)
    expect(res.sessionState).toBeDefined()
  })

  it('returns success:false on assignment-not-found error', async () => {
    rpcError('Assignment not found or not eligible')
    const res = await recordSessionPunch('clock_in', SAMPLE_ASSIGNMENT_ID, null)

    expect(res.success).toBe(false)
    expect(res.error).toContain('Assignment not found')
  })
})

// ── Non-clock-in punches: all four params, id + summary null by default ───────

describe.each([
  ['lunch_out' as const, { lunchOutAt: '2026-07-30T12:00:00Z' }],
  ['lunch_in'  as const, { lunchOutAt: '2026-07-30T12:00:00Z', lunchInAt: '2026-07-30T12:30:00Z' }],
  ['clock_out' as const, { clockOutAt: '2026-07-30T17:00:00Z', status: 'complete' }],
])('recordSessionPunch — %s', (action, sessionOverrides) => {
  beforeEach(() => mockRpc.mockClear())

  it(`sends p_action=${action} with all four named parameters`, async () => {
    rpcSuccess(makeSessionState(sessionOverrides))
    await recordSessionPunch(action)

    expect(mockRpc).toHaveBeenCalledWith('record_session_punch', {
      p_action:             action,
      p_assignment_id:      null,
      p_project_id:         null,
      p_end_of_day_summary: null,
    })
  })

  it('p_project_id is explicitly null in request body (not omitted)', async () => {
    rpcSuccess(makeSessionState(sessionOverrides))
    await recordSessionPunch(action)

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(params, 'p_project_id')).toBe(true)
    expect(params.p_project_id).toBeNull()
  })

  it('p_assignment_id is explicitly null in request body (not omitted)', async () => {
    rpcSuccess(makeSessionState(sessionOverrides))
    await recordSessionPunch(action)

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(params, 'p_assignment_id')).toBe(true)
    expect(params.p_assignment_id).toBeNull()
  })

  it('p_end_of_day_summary is explicitly present in request body', async () => {
    rpcSuccess(makeSessionState(sessionOverrides))
    await recordSessionPunch(action)

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(params, 'p_end_of_day_summary')).toBe(true)
  })

  it('returns success:true with sessionState on RPC success', async () => {
    rpcSuccess(makeSessionState(sessionOverrides))
    const res = await recordSessionPunch(action)

    expect(res.success).toBe(true)
    expect(res.sessionState).toBeDefined()
  })

  it('propagates RPC error as success:false', async () => {
    rpcError('No active session found for today; clock in first')
    const res = await recordSessionPunch(action)

    expect(res.success).toBe(false)
    expect(res.error).toBeDefined()
  })
})

// ── Migration 102 — obsolete overload removal ────────────────────────────────

const root   = process.cwd()
const migDir = join(root, 'supabase/migrations')
const mig102Path = join(migDir, '102_unambiguous_employee_session_punch.sql')
const mig102 = existsSync(mig102Path)
  ? readFileSync(mig102Path, 'utf8')
  : ''

describe('migration 102 — drop ambiguous 2-arg overload', () => {
  it('migration 102 file exists with correct name', () => {
    expect(existsSync(mig102Path)).toBe(true)
  })

  it('is wrapped in BEGIN/COMMIT', () => {
    expect(mig102).toContain('BEGIN;')
    expect(mig102).toContain('COMMIT;')
  })

  it('drops the 2-arg (TEXT, UUID) overload from migration 099', () => {
    expect(mig102).toContain('DROP FUNCTION IF EXISTS public.record_session_punch(TEXT, UUID)')
  })

  it('does NOT drop the canonical 3-arg (TEXT, UUID, TEXT) overload', () => {
    expect(mig102).not.toContain(
      'DROP FUNCTION IF EXISTS public.record_session_punch(TEXT, UUID, TEXT)'
    )
  })

  it('re-applies REVOKE PUBLIC on the canonical function', () => {
    expect(mig102).toContain(
      'REVOKE ALL ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) FROM PUBLIC'
    )
  })

  it('revokes anon execute on the canonical function', () => {
    expect(mig102).toContain(
      'REVOKE EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) FROM anon'
    )
  })

  it('re-applies GRANT authenticated on the canonical function', () => {
    expect(mig102).toContain(
      'GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) TO authenticated'
    )
  })

  it('does not modify any session rows or punch data', () => {
    expect(mig102).not.toContain('UPDATE employee_work_sessions')
    expect(mig102).not.toContain('UPDATE time_punch_events')
    expect(mig102).not.toContain('DELETE FROM')
    expect(mig102).not.toContain('INSERT INTO')
  })

  it('does not touch migrations 099–101 SQL objects', () => {
    expect(mig102).not.toContain('DROP TABLE')
    expect(mig102).not.toContain('ALTER TABLE')
    expect(mig102).not.toContain('DROP TRIGGER')
    expect(mig102).not.toContain('DROP INDEX')
  })
})
