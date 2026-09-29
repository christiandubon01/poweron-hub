import { describe, expect, it } from 'vitest'
import {
  dollarsToMinor,
  financialReconciliationKey,
  usd,
  type FinancialSourceRef,
} from '../domain'
import { FINANCIAL_AUTHORITY, getFinancialAuthority } from '../authority'

describe('CASH-1 financial truth contracts', () => {
  it('stores USD money in integer cents', () => {
    expect(usd(1234)).toEqual({ currency: 'USD', minor: 1234 })
  })

  it('rejects non-integer MoneyAmount values', () => {
    expect(() => usd(12.5)).toThrow(/integer/)
  })

  it('converts dollars to cents deterministically', () => {
    expect(dollarsToMinor(12.345)).toBe(1235)
  })

  it('treats invalid dollar input as zero', () => {
    expect(dollarsToMinor('not-money')).toBe(0)
  })

  it('uses organization + source kind + record id as reconciliation identity', () => {
    const ref: FinancialSourceRef = {
      organizationId: 'org-1',
      kind: 'project_collection',
      recordId: 'log-7',
    }
    expect(financialReconciliationKey(ref)).toBe('org-1:project_collection:log-7')
  })

  it('makes project collections canonical', () => {
    expect(getFinancialAuthority('project_collection').level).toBe('canonical')
  })

  it('makes service collection events canonical', () => {
    expect(getFinancialAuthority('service_collection').level).toBe('canonical')
  })

  it('keeps planned project cost separate from actual cost', () => {
    expect(getFinancialAuthority('project_planned_cost').level).toBe('canonical-derived')
    expect(getFinancialAuthority('project_actual_cost').level).toBe('canonical-derived')
  })

  it('uses time entries as payroll quantity authority', () => {
    expect(getFinancialAuthority('employee_time_entry').level).toBe('canonical')
  })

  it('keeps work sessions attribution-only', () => {
    expect(getFinancialAuthority('employee_work_session').note).toMatch(/attribution/i)
  })

  it('keeps overhead as assumption rather than bank truth', () => {
    expect(getFinancialAuthority('overhead_assumption').level).toBe('assumption')
  })

  it('keeps Debt Killer local state non-canonical', () => {
    expect(getFinancialAuthority('debt_killer_local').level).toBe('non-canonical')
  })

  it('has exactly one authority entry per source', () => {
    expect(new Set(FINANCIAL_AUTHORITY.map((row) => row.source)).size).toBe(FINANCIAL_AUTHORITY.length)
  })
})
