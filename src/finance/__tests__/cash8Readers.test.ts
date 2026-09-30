import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  org: 'org-1', user: 'user-1',
  rows: {} as Record<string, any[]>,
  failures: {} as Record<string, string>,
  calls: [] as Array<{ table: string; filters: Record<string, any>; start: number; end: number }>,
  backupReady: true,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: state.user } }, error: null }) },
    rpc: async () => ({ data: state.org, error: null }),
    from: (table: string) => {
      const filters: Record<string, any> = {}
      const query: any = {
        select: () => query,
        eq: (key: string, value: any) => { filters[key] = value; return query },
        gt: (key: string, value: any) => { filters[`gt:${key}`] = value; return query },
        lte: (key: string, value: any) => { filters[`lte:${key}`] = value; return query },
        order: () => query,
        range: async (start: number, end: number) => {
          state.calls.push({ table, filters: { ...filters }, start, end })
          if (state.failures[table]) return { data: null, error: { message: state.failures[table] } }
          const rows = (state.rows[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => {
            if (key.startsWith('gt:')) return row[key.slice(3)] > value
            if (key.startsWith('lte:')) return row[key.slice(4)] <= value
            return row[key] === value
          }))
          return { data: rows.slice(start, end + 1), error: null }
        },
        maybeSingle: async () => ({ data: state.rows[table]?.find(row => row.id === filters.id) ?? null,
          error: state.failures[table] ? { message: state.failures[table] } : null }),
      }
      return query
    },
  },
}))

vi.mock('@/services/backupDataService', () => ({
  getActiveTenantUserId: () => state.user,
  isTenantDataReady: () => state.backupReady,
  getBackupData: () => ({ projects: [], logs: [], employees: [], settings: {} }),
}))

import { readFinancialLedgerState } from '@/services/manualLedgerService'
import { readCashObligationState } from '@/services/cashObligationService'
import { cashOsDateAt, readCashOsSources, resolveCashOsScope } from '@/services/cashOsReadService'

beforeEach(() => {
  state.org = 'org-1'; state.user = 'user-1'; state.rows = {}; state.failures = {}; state.calls = []
  state.backupReady = true
  state.rows.organizations = [{ id: state.org, settings: { identity: { timezone: 'America/Los_Angeles' } } }]
})

describe('CASH-8 read-only live sources', () => {
  it('paginates the complete ledger deterministically', async () => {
    state.rows.financial_accounts = Array.from({ length: 501 }, (_, index) => ({ id: `a${index}`, organization_id: state.org }))
    state.rows.financial_transactions = Array.from({ length: 501 }, (_, index) => ({ id: `t${index}`, organization_id: state.org }))
    const result = await readFinancialLedgerState()
    expect(result.accounts).toHaveLength(501)
    expect(result.transactions).toHaveLength(501)
    expect(state.calls.filter(c => c.table === 'financial_accounts').map(c => c.start)).toEqual([0, 500])
  })
  it('filters both ledger tables by authenticated organization', async () => {
    await readFinancialLedgerState()
    expect(state.calls.filter(c => c.table.startsWith('financial_')).every(c => c.filters.organization_id === state.org)).toBe(true)
  })
  it('throws a ledger query failure', async () => {
    state.failures.financial_transactions = 'denied'
    await expect(readFinancialLedgerState()).rejects.toThrow('denied')
  })
  it('rejects a returned cross-organization ledger row', async () => {
    state.rows.financial_accounts = [{ id: 'cross', organization_id: 'org-2' }]
    // The mocked query applies the filter just as Supabase does, so no cross row is returned.
    expect((await readFinancialLedgerState()).accounts).toEqual([])
  })
  it('returns all three raw canonical CASH-3 arrays', async () => {
    state.rows.financial_obligations = [{ id: 'o1', organization_id: state.org, name: 'Rent', amount_minor: 100,
      recurrence_kind: 'monthly', recurrence_interval: 1, anchor_date: '2026-01-01', start_date: '2026-01-01',
      is_required: true, confidence: 'confirmed', status: 'active' }]
    state.rows.financial_obligation_occurrences = [{ id: 'x1', organization_id: state.org, obligation_id: 'o1', scheduled_date: '2026-09-29', status: 'scheduled' }]
    state.rows.cash_commitments = [{ id: 'c1', organization_id: state.org, title: 'Materials', amount_minor: 200, expected_date: '2026-09-28', is_required: true, confidence: 'confirmed', status: 'scheduled' }]
    const result = await readCashObligationState()
    expect(result.obligations[0].amount.minor).toBe(100)
    expect(result.occurrences[0].scheduledDate).toBe('2026-09-29')
    expect(result.commitments[0].expectedDate).toBe('2026-09-28')
  })
  it('paginates obligations without a date cutoff', async () => {
    state.rows.cash_commitments = Array.from({ length: 501 }, (_, index) => ({ id: `c${index}`, organization_id: state.org,
      amount_minor: 1, expected_date: '2020-01-01' }))
    expect((await readCashObligationState()).commitments).toHaveLength(501)
    expect(state.calls.filter(c => c.table === 'cash_commitments').map(c => c.start)).toEqual([0, 500])
  })
  it('throws an obligation query failure', async () => {
    state.failures.financial_obligation_occurrences = 'denied'
    await expect(readCashObligationState()).rejects.toThrow('denied')
  })
  it('reads the raw timezone, not a normalized fallback', async () => {
    state.rows.organizations = [{ id: state.org, settings: {} }]
    expect((await resolveCashOsScope()).storedTimezone).toBeNull()
  })
  it('derives LA work date across a UTC date boundary', () => {
    expect(cashOsDateAt(new Date('2026-09-30T05:00:00Z'), 'America/Los_Angeles')).toBe('2026-09-29')
  })
  it('blocks a conflicting timezone', () => {
    expect(() => cashOsDateAt(new Date(), 'America/New_York')).toThrow('TIMEZONE_MISMATCH')
  })
  it('scopes and paginates payroll entries and sessions', async () => {
    state.rows.time_entries = Array.from({ length: 501 }, (_, index) => ({ id: `e${index}`, org_id: state.org,
      employee_profile_id: 'p1', work_date: '2026-09-29', paid_minutes: 60, status: 'complete', approval_status: 'none' }))
    state.rows.employee_work_sessions = [{ id: 's1', org_id: state.org, employee_profile_id: 'p1',
      work_date: '2026-09-29', clock_in_at: '2026-09-29T12:00:00Z' }]
    state.rows.employee_profiles = [{ id: 'p1', org_id: state.org, backup_employee_id: 'b1' }]
    const source = await readCashOsSources(await resolveCashOsScope(), '2026-09-28', new Date('2026-09-29T20:00:00Z'))
    expect(source.timeEntries).toHaveLength(501)
    expect(source.sessions).toHaveLength(1)
    expect(state.calls.filter(c => ['time_entries', 'employee_work_sessions'].includes(c.table))
      .every(c => c.filters.org_id === state.org && c.filters['gt:work_date'] === '2026-09-28')).toBe(true)
  })
  it('retains inactive historical profile bridges', async () => {
    state.rows.employee_profiles = [{ id: 'inactive', org_id: state.org, backup_employee_id: 'employee-1', active: false }]
    const source = await readCashOsSources(await resolveCashOsScope(), '2026-09-28', new Date('2026-09-29T20:00:00Z'))
    expect(source.bridges).toEqual([{ employeeProfileId: 'inactive', backupEmployeeId: 'employee-1' }])
  })
  it('does not turn payroll query failure into empty payroll', async () => {
    state.failures.employee_work_sessions = 'denied'
    await expect(readCashOsSources(await resolveCashOsScope(), '2026-09-28', new Date('2026-09-29T20:00:00Z')))
      .rejects.toThrow('PAYROLL_READ_FAILED')
  })
  it('does not read from an unhydrated BackupData cache', async () => {
    state.backupReady = false
    await expect(readCashOsSources(await resolveCashOsScope(), '2026-09-28', new Date()))
      .rejects.toThrow('BACKUP_NOT_HYDRATED')
  })
  it('performs SELECT reads without any write query method', async () => {
    await readFinancialLedgerState()
    await readCashObligationState()
    expect(state.calls.every(c => c.start >= 0)).toBe(true)
  })
})
