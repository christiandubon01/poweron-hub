/**
 * Session-aware admin_void_punch contract (ADMIN-SESSION-PUNCH-VOID-1).
 *
 * Source-level contract tests for migration 106. No DOM, no DB writes, no RPC calls.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migDir = join(root, 'supabase/migrations')
const serviceDir = join(root, 'src/services')
const adminDir = join(root, 'src/components/admin')
const employeeDir = join(root, 'src/components/employee')

const read = (p: string) => readFileSync(p, 'utf8')

const mig106Path = join(migDir, '106_session_aware_admin_punch_void.sql')
const mig106 = existsSync(mig106Path) ? read(mig106Path) : ''
const mig090 = read(join(migDir, '090_admin_punch_control.sql'))
const adminSvc = read(join(serviceDir, 'adminTimecardService.ts'))
const modal = read(join(adminDir, 'AdminPunchHistoryModal.tsx'))
const empTimeSvc = read(join(serviceDir, 'employeeTimeService.ts'))
const empPortalSvc = read(join(serviceDir, 'employeePortalService.ts'))
const monthMetrics = read(join(employeeDir, 'employeeMonthMetrics.ts'))

function rpcBlock(): string {
  const start = mig106.indexOf('CREATE OR REPLACE FUNCTION public.admin_void_punch(')
  expect(start).toBeGreaterThanOrEqual(0)
  return mig106.slice(start)
}

// ── 1. Migration existence / replace-in-place ─────────────────────────────────

describe('migration 106 — session-aware admin_void_punch', () => {
  it('exists as 106_session_aware_admin_punch_void.sql', () => {
    expect(existsSync(mig106Path)).toBe(true)
  })

  it('is wrapped in BEGIN/COMMIT', () => {
    expect(mig106).toContain('BEGIN;')
    expect(mig106).toContain('COMMIT;')
  })

  it('replaces admin_void_punch(UUID) without creating an overload', () => {
    expect(mig106).toContain('CREATE OR REPLACE FUNCTION public.admin_void_punch(p_punch_id uuid)')
    expect(mig106).not.toContain('DROP FUNCTION')
    // Exactly one CREATE for admin_void_punch in this migration
    const creates = mig106.match(/CREATE OR REPLACE FUNCTION public\.admin_void_punch\(/g) ?? []
    expect(creates).toHaveLength(1)
    // Privilege statements target the single UUID signature only
    expect(mig106).toContain('REVOKE ALL ON FUNCTION public.admin_void_punch(uuid) FROM PUBLIC')
    expect(mig106).toContain('REVOKE EXECUTE ON FUNCTION public.admin_void_punch(uuid) FROM anon')
    expect(mig106).toContain('GRANT EXECUTE ON FUNCTION public.admin_void_punch(uuid) TO authenticated')
  })

  it('is SECURITY DEFINER with restricted search_path', () => {
    const block = rpcBlock()
    expect(block).toContain('SECURITY DEFINER')
    expect(block).toContain('SET search_path = public')
  })

  it('enforces org admin authorization', () => {
    const block = rpcBlock()
    expect(block).toContain('public.is_org_admin_for(v_punch.org_id)')
    expect(block).toContain("RAISE EXCEPTION 'Not authorized'")
    expect(block).toContain("RAISE EXCEPTION 'Punch not found'")
  })
})

// ── 2. Legacy session_id-null behavior ────────────────────────────────────────

describe('legacy session_id-null void path', () => {
  it('voids legacy punches when session_id IS NULL without touching sessions', () => {
    const block = rpcBlock()
    expect(block).toContain('IF v_punch.session_id IS NULL THEN')
    expect(block).toContain('SET is_void = true')
    // Legacy branch returns immediately after void — no employee_work_sessions UPDATE/DELETE
    const legacySlice = block.slice(
      block.indexOf('IF v_punch.session_id IS NULL THEN'),
      block.indexOf('-- ── 3. Session-linked path'),
    )
    expect(legacySlice).toContain('SET is_void = true')
    expect(legacySlice).not.toContain('DELETE FROM public.employee_work_sessions')
    expect(legacySlice).not.toContain('UPDATE public.employee_work_sessions')
  })

  it('preserves migration 090 authorization and void semantics for the legacy contract', () => {
    expect(mig090).toContain('CREATE OR REPLACE FUNCTION public.admin_void_punch(p_punch_id uuid)')
    expect(mig090).toContain('SET is_void = true')
    expect(mig106).toContain('Legacy punches (session_id IS NULL)')
  })
})

// ── 3. Session rebuild / delete semantics ─────────────────────────────────────

describe('session-linked void rebuild semantics', () => {
  it('locks the punch and session before mutation', () => {
    const block = rpcBlock()
    expect(block).toContain('FOR UPDATE')
    expect(block).toMatch(/FROM public\.time_punch_events[\s\S]*FOR UPDATE/)
    expect(block).toMatch(/FROM public\.employee_work_sessions[\s\S]*FOR UPDATE/)
  })

  it('marks the event is_void = true and keeps the audit row', () => {
    const block = rpcBlock()
    expect(block).toContain('SET is_void = true')
    expect(block).not.toContain('DELETE FROM public.time_punch_events')
  })

  it('rebuilds session timestamps from remaining non-void clock/lunch events', () => {
    const block = rpcBlock()
    expect(block).toContain("punch_type = 'clock_in'")
    expect(block).toContain("punch_type = 'lunch_out'")
    expect(block).toContain("punch_type = 'lunch_in'")
    expect(block).toContain("punch_type = 'clock_out'")
    expect(block).toContain('AND tpe.is_void = false')
    expect(block).toContain('clock_in_at   = v_clock_in')
    expect(block).toContain('lunch_out_at  = v_lunch_out')
    expect(block).toContain('lunch_in_at   = v_lunch_in')
    expect(block).toContain('clock_out_at  = v_clock_out')
  })

  it('all events voided / Clock In void removes the session and rebuilds daily totals', () => {
    const block = rpcBlock()
    expect(block).toContain('IF v_clock_in IS NULL THEN')
    expect(block).toContain('DELETE FROM public.employee_work_sessions')
    expect(block).toContain('DELETE FROM public.time_entries')
    expect(block).toContain('INSERT INTO public.time_entries')
  })

  it('Clock In void removes the session (no non-void clock_in remains)', () => {
    const block = rpcBlock()
    // Same delete branch: absence of clock_in deletes the session
    expect(block).toContain('IF v_clock_in IS NULL THEN')
    expect(block).toMatch(/DELETE FROM public\.employee_work_sessions\s+WHERE id = v_session\.id/)
  })

  it('Lunch Out or Lunch In void clears the full lunch pair and recalculates totals', () => {
    const block = rpcBlock()
    expect(block).toContain('IF v_lunch_out IS NULL OR v_lunch_in IS NULL THEN')
    expect(block).toContain('v_lunch_out := NULL')
    expect(block).toContain('v_lunch_in  := NULL')
    expect(block).toContain('v_lunch_mins := 0')
    expect(block).toContain('v_paid_mins  := GREATEST(0, v_total_mins - v_lunch_mins)')
  })

  it('Clock Out void reopens safely when no other active session exists', () => {
    const block = rpcBlock()
    expect(block).toContain("v_status     := 'open'")
    expect(block).toContain('v_total_mins := NULL')
    expect(block).toContain('v_paid_mins  := NULL')
    expect(block).toContain("status        = v_status")
  })

  it('Clock Out void is rejected when another active session exists (before voiding)', () => {
    const block = rpcBlock()
    expect(block).toContain("RAISE EXCEPTION 'Cannot void clock_out: another active session exists'")
    // Guard appears before the void UPDATE in the session path
    const guardIdx = block.indexOf("RAISE EXCEPTION 'Cannot void clock_out: another active session exists'")
    const voidIdx = block.indexOf('-- ── 5. Void the event')
    expect(guardIdx).toBeGreaterThan(0)
    expect(voidIdx).toBeGreaterThan(guardIdx)
    expect(block).toContain('ews.clock_out_at IS NULL')
  })

  it('recomputes total/lunch/paid when Clock Out remains', () => {
    const block = rpcBlock()
    expect(block).toContain('IF v_clock_out IS NOT NULL THEN')
    expect(block).toContain("v_status     := 'complete'")
    expect(block).toContain('total_minutes = v_total_mins')
    expect(block).toContain('lunch_minutes = v_lunch_mins')
    expect(block).toContain('paid_minutes  = v_paid_mins')
  })
})

// ── 4. Audit + employee read contracts ────────────────────────────────────────

describe('audit events and employee-facing reads', () => {
  it('preserves voided events as audit history', () => {
    const block = rpcBlock()
    expect(block).not.toContain('DELETE FROM public.time_punch_events')
    expect(block).toContain('SET is_void = true')
  })

  it('employee Clock reads sessions from employee_work_sessions (removed sessions disappear)', () => {
    expect(empTimeSvc).toContain("from('employee_work_sessions')")
    expect(empTimeSvc).toContain('export async function getTodaySessions(')
    // Completed Today is driven by session rows, not voided punch events
    const todaySessionsBlock = empTimeSvc.slice(empTimeSvc.indexOf('export async function getTodaySessions('))
    expect(todaySessionsBlock).toContain("from('employee_work_sessions')")
    expect(todaySessionsBlock).not.toContain("from('time_punch_events')")
  })

  it('employee My Time / Schedule hours use sessions + paidMinutes (removed sessions disappear)', () => {
    expect(empPortalSvc).toContain("from('employee_work_sessions')")
    expect(empPortalSvc).toContain('export async function getMyTimeSummary(')
    expect(monthMetrics).toContain('paidMinutes')
    expect(monthMetrics).toContain('workedHours')
  })
})

// ── 5. Service / UI signature unchanged ───────────────────────────────────────

describe('admin service and UI call signature', () => {
  it('adminVoidPunch still calls admin_void_punch with p_punch_id only', () => {
    expect(adminSvc).toContain('export async function adminVoidPunch(')
    expect(adminSvc).toContain("rpc('admin_void_punch', {")
    expect(adminSvc).toContain('p_punch_id: punchId')
  })

  it('AdminPunchHistoryModal still voids via adminVoidPunch(id)', () => {
    expect(modal).toContain('async function voidPunch(id: string)')
    expect(modal).toContain('adminVoidPunch(id)')
  })
})

// ── 6. One-time ghost / stale session reconciliation on apply ─────────────────

function reconciliationBlock(): string {
  const marker = 'One-time reconciliation: remove ghost sessions'
  const start = mig106.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  return mig106.slice(start)
}

describe('migration 106 — one-time existing ghost cleanup', () => {
  it('includes a DO block that runs on migration apply (no admin click)', () => {
    expect(mig106).toContain('One-time reconciliation')
    expect(mig106).toMatch(/DO\s+\$\$/)
    expect(mig106).toContain('no admin click required')
    // Reconciliation is after the RPC replace, still inside BEGIN/COMMIT
    const rpcIdx = mig106.indexOf('CREATE OR REPLACE FUNCTION public.admin_void_punch(')
    const reconIdx = mig106.indexOf('One-time reconciliation: remove ghost sessions')
    const commitIdx = mig106.lastIndexOf('COMMIT;')
    expect(rpcIdx).toBeGreaterThanOrEqual(0)
    expect(reconIdx).toBeGreaterThan(rpcIdx)
    expect(commitIdx).toBeGreaterThan(reconIdx)
  })

  it('deletes sessions with no remaining non-void session punch events', () => {
    const block = reconciliationBlock()
    expect(block).toContain('NOT EXISTS (')
    expect(block).toContain('AND tpe.is_void = false')
    expect(block).toContain('IF v_clock_in IS NULL THEN')
    expect(block).toMatch(/DELETE FROM public\.employee_work_sessions\s+WHERE id = v_sess\.id/)
  })

  it('rebuilds partially voided sessions from remaining non-void events when safe', () => {
    const block = reconciliationBlock()
    expect(block).toContain('AND tpe.is_void = true')
    expect(block).toContain('IF v_lunch_out IS NULL OR v_lunch_in IS NULL THEN')
    expect(block).toContain('v_needs_rebuild')
    expect(block).toContain('UPDATE public.employee_work_sessions')
    // Unsafe reopen skipped (does not fail the migration)
    expect(block).toContain('Unsafe reopen')
    expect(block).toContain('CONTINUE')
  })

  it('rebuilds or removes time_entries for every affected employee/date', () => {
    const block = reconciliationBlock()
    expect(block).toContain('mig106_affected_days')
    expect(block).toContain('DELETE FROM public.time_entries')
    expect(block).toContain('INSERT INTO public.time_entries')
    expect(block).toContain('ON CONFLICT ON CONSTRAINT time_entries_org_employee_date_unique')
  })

  it('preserves voided audit events via FK (no DELETE of time_punch_events)', () => {
    const block = reconciliationBlock()
    expect(block).not.toContain('DELETE FROM public.time_punch_events')
    expect(block).toContain('ON DELETE SET NULL')
  })

  it('contains no hardcoded employee, session, assignment, or project IDs', () => {
    const block = reconciliationBlock()
    expect(block).not.toMatch(/64380419-c921-4336-ad90-050571d36553/)
    expect(block).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(block).not.toContain('Test Employee')
    expect(block).not.toContain("Rock'n Avenue")
    expect(block).not.toContain('proj1778524126621o7dn')
    expect(block).not.toContain('Emergency Circuit')
  })

  it('does not select or mutate sessions that have only live non-void events', () => {
    const block = reconciliationBlock()
    // Candidate filter is ghost (no live events) OR partially voided — not all sessions
    expect(block).toContain('NOT EXISTS (')
    expect(block).toContain('is_void = true')
    expect(block).toContain('IF NOT v_needs_rebuild THEN')
    expect(block).toContain('CONTINUE')
  })

  it('proves employee Clock/My Time stop seeing ghosts once sessions are deleted by apply', () => {
    // Migration deletes ghost session rows; employee reads are session-backed.
    expect(reconciliationBlock()).toMatch(/DELETE FROM public\.employee_work_sessions/)
    expect(empTimeSvc).toContain("from('employee_work_sessions')")
    expect(empPortalSvc).toContain("from('employee_work_sessions')")
    expect(monthMetrics).toContain('paidMinutes')
  })
})

// ── 7. Migration guards ───────────────────────────────────────────────────────

describe('migration guard — allow 106 reject 107+', () => {
  it('migration 106 exists', () => {
    expect(existsSync(mig106Path)).toBe(true)
  })

  it('allows 100–106 and rejects 107+', () => {
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
          !name.startsWith('106_'),
      )
    expect(beyond).toEqual([])
    expect(migrations).toContain('106_session_aware_admin_punch_void.sql')
  })

  it('does not modify migrations 097–105 content via this file', () => {
    expect(mig106).not.toContain('097_employee_punch_edit_requests')
    expect(mig106).not.toContain('CREATE OR REPLACE FUNCTION public.record_session_punch(')
    expect(mig106).not.toContain('CREATE OR REPLACE FUNCTION public.admin_record_session_punch(')
  })
})
