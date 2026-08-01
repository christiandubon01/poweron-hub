/**
 * Session Clock Out closeout (EMPLOYEE-SESSION-CLOSEOUT-1).
 *
 * Source + mocked-RPC contracts for migration 105 and the restored
 * EmployeeTimeClock end-of-day summary form (reused for assignment and
 * Project-only sessions).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const mockRpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from:  vi.fn(),
    rpc:   mockRpc,
  },
}))

const { recordSessionPunch } = await import('@/services/employeeTimeService')

const root = process.cwd()
const migDir = join(root, 'supabase/migrations')
const mig105Path = join(migDir, '105_session_clock_out_summary.sql')
const mig105 = existsSync(mig105Path) ? readFileSync(mig105Path, 'utf8') : ''
const mig104 = readFileSync(join(migDir, '104_project_only_ownerless_assignment_fallback.sql'), 'utf8')
const timeClock = readFileSync(join(root, 'src/components/employee/EmployeeTimeClock.tsx'), 'utf8')
const empSvc = readFileSync(join(root, 'src/services/employeeTimeService.ts'), 'utf8')

const SAMPLE_PROJECT_ID = 'proj1778524126621o7dn'
const SAMPLE_SESSION_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

function clockOutState(overrides: Record<string, unknown> = {}) {
  return {
    sessionId:       SAMPLE_SESSION_ID,
    status:          'complete',
    workDate:        '2026-07-30',
    projectId:       SAMPLE_PROJECT_ID,
    assignmentId:    null,
    projectName:     "Rock'n Avenue",
    workPackageName: null,
    clockInAt:       '2026-07-30T15:00:00Z',
    lunchOutAt:      null,
    lunchInAt:       null,
    clockOutAt:      '2026-07-30T17:00:00Z',
    paidMinutes:     120,
    lunchMinutes:    0,
    totalMinutes:    120,
    ...overrides,
  }
}

// ── Migration 105 ─────────────────────────────────────────────────────────────

describe('migration 105 — session clock out summary', () => {
  it('exists as 105_session_clock_out_summary.sql', () => {
    expect(existsSync(mig105Path)).toBe(true)
  })

  it('is wrapped in BEGIN/COMMIT', () => {
    expect(mig105).toContain('BEGIN;')
    expect(mig105).toContain('COMMIT;')
  })

  it('drops the prior 3-arg canonical overload before creating the 4-arg function', () => {
    expect(mig105).toContain('DROP FUNCTION IF EXISTS public.record_session_punch(TEXT, UUID, TEXT)')
    expect(mig105).toContain(
      'CREATE OR REPLACE FUNCTION public.record_session_punch(',
    )
    expect(mig105).toContain('p_end_of_day_summary  TEXT DEFAULT NULL')
  })

  it('keeps exactly one overload via 4-arg privileges', () => {
    expect(mig105).toContain(
      'REVOKE ALL ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT, TEXT) FROM PUBLIC',
    )
    expect(mig105).toContain(
      'REVOKE EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT, TEXT) FROM anon',
    )
    expect(mig105).toContain(
      'GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT, TEXT) TO authenticated',
    )
    expect(mig105).toContain('SECURITY DEFINER')
    expect(mig105).toContain('SET search_path = public')
  })

  it('persists end_of_day_summary on the Clock Out punch event only', () => {
    expect(mig105).toContain('end_of_day_summary')
    expect(mig105).toContain("p_action = 'clock_out'")
    expect(mig105).toContain('NULLIF(btrim(p_end_of_day_summary), \'\')')
    expect(mig105).toContain('char_length(v_summary) > 4000')
  })

  it('does not invent a fake Work Package or touch completion_notes', () => {
    expect(mig105).not.toContain('completion_notes')
    expect(mig105).not.toContain('UPDATE employee_task_assignments')
  })

  it('preserves migration-104 Project-only Path B and ownerless flow', () => {
    expect(mig105).toContain('IF v_owner_id IS NOT NULL THEN')
    expect(mig105).toContain('PROJECT-ONLY MODE')
    expect(mig105).not.toContain('Organization owner not configured')
  })

  it('migration 104 SQL file is untouched', () => {
    expect(mig104).toContain('CREATE OR REPLACE FUNCTION public.record_session_punch(')
    expect(mig104).toContain('p_project_id    TEXT DEFAULT NULL')
    expect(mig104).not.toContain('p_end_of_day_summary')
  })
})

describe('migration guard — allow 106 reject 107+', () => {
  it('allows 100–106 and rejects anything beyond', () => {
    const migrations = readdirSync(migDir)
    const beyond = migrations
      .filter((name: string) => /^1\d\d_/.test(name))
      .filter(
        (name: string) =>
          !name.startsWith('100_') &&
          !name.startsWith('101_') &&
          !name.startsWith('102_') &&
          !name.startsWith('103_') &&
          !name.startsWith('104_') &&
          !name.startsWith('105_') &&
          !name.startsWith('106_') &&
          !name.startsWith('107_') &&
          !name.startsWith('108_'),
      )
    expect(beyond).toEqual([])
    expect(migrations).toContain('105_session_clock_out_summary.sql')
    expect(migrations).toContain('106_session_aware_admin_punch_void.sql')
  })
})

// ── Service: four-parameter payload ───────────────────────────────────────────

describe('recordSessionPunch — four-parameter closeout payload', () => {
  beforeEach(() => mockRpc.mockClear())

  it('always sends all four named parameters', async () => {
    mockRpc.mockResolvedValueOnce({ data: clockOutState(), error: null })
    await recordSessionPunch('clock_out', null, null, 'Finished rough-in')

    expect(mockRpc).toHaveBeenCalledWith('record_session_punch', {
      p_action:             'clock_out',
      p_assignment_id:      null,
      p_project_id:         null,
      p_end_of_day_summary: 'Finished rough-in',
    })
  })

  it('sends summary null for non-clock_out actions', async () => {
    mockRpc.mockResolvedValueOnce({
      data: clockOutState({ status: 'open', clockOutAt: null, lunchOutAt: '2026-07-30T16:00:00Z' }),
      error: null,
    })
    await recordSessionPunch('lunch_out', null, null, 'should be ignored')

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>
    expect(params.p_end_of_day_summary).toBeNull()
  })

  it('trims empty Clock Out summary to null', async () => {
    mockRpc.mockResolvedValueOnce({ data: clockOutState(), error: null })
    await recordSessionPunch('clock_out', null, null, '   ')

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>
    expect(params.p_end_of_day_summary).toBeNull()
  })

  it('preserves failed RPC as success:false without inventing sessionState', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'No active session found for today; clock in first' },
    })
    const res = await recordSessionPunch('clock_out', null, null, 'notes')
    expect(res.success).toBe(false)
    expect(res.sessionState).toBeUndefined()
    expect(res.error).toBeTruthy()
  })

  it('sends p_end_of_day_summary null on project-only clock_in', async () => {
    mockRpc.mockResolvedValueOnce({
      data: clockOutState({ status: 'open', clockOutAt: null }),
      error: null,
    })
    await recordSessionPunch('clock_in', null, SAMPLE_PROJECT_ID)

    expect(mockRpc).toHaveBeenCalledWith('record_session_punch', {
      p_action:             'clock_in',
      p_assignment_id:      null,
      p_project_id:         SAMPLE_PROJECT_ID,
      p_end_of_day_summary: null,
    })
  })
})

// ── EmployeeTimeClock closeout UI contracts ───────────────────────────────────

describe('EmployeeTimeClock closeout UI', () => {
  it('reuses the historical showClockOutSummary closeout form', () => {
    expect(timeClock).toContain('showClockOutSummary')
    expect(timeClock).toContain('clockOutSummary')
    expect(timeClock).toContain('cancelClockOutSummary')
    expect(timeClock).toContain('What did you get done today?')
    expect(timeClock).toContain('Submit Clock Out')
  })

  it('opens closeout before punching and cancels without clock out', () => {
    expect(timeClock).toContain("punchType === 'clock_out' && endOfDaySummary === undefined && !showClockOutSummary")
    expect(timeClock).toContain('setShowClockOutSummary(true)')
    expect(timeClock).toContain('setShowClockOutSummary(false)')
    expect(timeClock).toContain('Cancel')
  })

  it('shows Project and Work Package / Not assigned yet for both session types', () => {
    expect(timeClock).toContain('activeSession?.project_name')
    expect(timeClock).toContain("'Not assigned yet'")
    expect(timeClock).toContain('activeSession?.work_package_name')
  })

  it('uses one shared form (no separate Project-only closeout component)', () => {
    expect(timeClock).toContain('eod-summary')
    expect(timeClock).not.toContain('ProjectOnlyCloseout')
    expect(timeClock).not.toContain('AssignmentCloseout')
  })

  it('submits summary via recordSessionPunch and clears form only on success', () => {
    expect(timeClock).toContain('recordSessionPunch(punchType, assignmentId, projectId, summaryForRpc)')
    expect(timeClock).toContain("handlePunch('clock_out', clockOutSummary)")
    // Failure keeps form: loadSessions skipped while form open
    expect(timeClock).toContain('if (!showClockOutSummary)')
  })

  it('disables duplicate submit while pending', () => {
    expect(timeClock).toContain("aria-busy={pending === 'clock_out'}")
    expect(timeClock).toContain('disabled={busy}')
  })

  it('does not use location.reload or setTimeout for closeout', () => {
    expect(timeClock).not.toContain('location.reload')
    expect(timeClock).not.toContain('setTimeout(')
  })

  it('service exposes endOfDaySummary parameter', () => {
    expect(empSvc).toContain('endOfDaySummary?: string | null')
    expect(empSvc).toContain('p_end_of_day_summary')
  })
})
