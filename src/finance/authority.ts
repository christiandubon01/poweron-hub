import type { FinancialSourceKind } from './domain'

export type FinancialAuthorityLevel =
  | 'canonical'
  | 'canonical-derived'
  | 'compatibility'
  | 'assumption'
  | 'non-canonical'

export interface FinancialAuthorityRule {
  source: FinancialSourceKind | 'debt_killer_local'
  level: FinancialAuthorityLevel
  note: string
}

export const FINANCIAL_AUTHORITY: readonly FinancialAuthorityRule[] = [
  {
    source: 'project_collection',
    level: 'canonical',
    note: 'Project payment logs are canonical for project cash collected. Project header paid fields are not a second authority.',
  },
  {
    source: 'service_collection',
    level: 'canonical',
    note: 'Service payments[] is canonical when present; scalar collected is compatibility fallback only.',
  },
  {
    source: 'project_actual_cost',
    level: 'canonical-derived',
    note: 'Actual field/project log costs describe project cost truth, not bank transaction proof.',
  },
  {
    source: 'project_planned_cost',
    level: 'canonical-derived',
    note: 'Estimate rows are planned costs and remain separate from actual costs.',
  },
  {
    source: 'employee_time_entry',
    level: 'canonical',
    note: 'Paid/closed time-entry minutes are the payroll quantity foundation. Work sessions are attribution/context, not a duplicate quantity.',
  },
  {
    source: 'employee_work_session',
    level: 'canonical-derived',
    note: 'Work sessions contribute project/session attribution only; they must not duplicate paid minutes.',
  },
  {
    source: 'overhead_assumption',
    level: 'assumption',
    note: 'Settings overhead is a planning assumption. It is not bank transaction truth and is never silently materialized.',
  },
  {
    source: 'normalized_payment',
    level: 'compatibility',
    note: 'Normalized payment tables may overlap operational cash and require reconciliation before becoming canonical.',
  },
  {
    source: 'manual_ledger',
    level: 'canonical',
    note: 'CASH-2 ledger rows are canonical account movements once explicitly entered or reconciled.',
  },
  {
    source: 'financial_obligation',
    level: 'canonical',
    note: 'CASH-3 obligation rules are canonical planned-outflow definitions, distinct from actual ledger movement.',
  },
  {
    source: 'financial_obligation_occurrence',
    level: 'canonical',
    note: 'Persisted occurrence exceptions/reconciliation targets are canonical planned-event state, never a second expense.',
  },
  {
    source: 'cash_commitment',
    level: 'canonical',
    note: 'One-time commitments are canonical planned outflows until explicitly reconciled to one actual ledger transaction.',
  },
  {
    source: 'debt_killer_local',
    level: 'non-canonical',
    note: 'Legacy Debt Killer mock/localStorage values are UI state and must not become financial truth automatically.',
  },
] as const

export function getFinancialAuthority(source: FinancialAuthorityRule['source']): FinancialAuthorityRule {
  const rule = FINANCIAL_AUTHORITY.find((candidate) => candidate.source === source)
  if (!rule) throw new Error(`No financial authority rule for ${source}`)
  return rule
}
