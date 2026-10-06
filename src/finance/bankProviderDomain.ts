import type { InterpretationKind, InterpretationStatus, LedgerMatchMode } from './bankProviderTypes'

/**
 * BANK-1 pure domain helpers. No network, no database, no provider SDK. They mirror the database rules so the same
 * contract can be checked in the client before BANK-2 adds any provider call.
 */

/**
 * Deterministic provider decimal -> signed integer minor units (cents). Never uses floating-point arithmetic on strings.
 * The provider sign is preserved as given: it is NOT interpreted here (depository vs card/loan meaning is decided later,
 * per account class). Throws on anything that is not an exact cent amount.
 */
export function providerAmountToMinor(input: string | number): number {
  const text = typeof input === 'number' ? numberToExactDecimal(input) : input.trim()
  const match = /^([+-])?(\d+)(?:\.(\d{1,4}))?$/.exec(text)
  if (!match) throw new Error(`Invalid provider amount: ${String(input)}`)
  const [, sign, whole, fraction = ''] = match
  const padded = fraction.padEnd(4, '0')
  if (!/^\d{2}0{2}$/.test(padded)) throw new Error(`Provider amount is not an exact cent value: ${String(input)}`)
  const minor = Number(whole) * 100 + Number(padded.slice(0, 2))
  if (!Number.isSafeInteger(minor)) throw new Error(`Provider amount out of range: ${String(input)}`)
  return sign === '-' && minor !== 0 ? -minor : minor
}

function numberToExactDecimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Invalid provider amount: ${value}`)
  const cents = Math.round(value * 100)
  if (Math.abs(value * 100 - cents) > 1e-6) throw new Error(`Provider amount is not an exact cent value: ${value}`)
  return minorToDecimalString(cents)
}

/** Exact inverse of providerAmountToMinor for 2-decimal evidence (e.g. -1234 -> "-12.34"). */
export function minorToDecimalString(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new Error(`Invalid minor amount: ${minor}`)
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * The ledger identity a posted `financial_transactions` row must carry when it is ADOPTED from one provider transaction.
 * Reusing the ledger's existing source identity (unique per organization for live rows) is what keeps
 * ONE provider transaction -> AT MOST ONE live canonical financial transaction. No second ledger is introduced.
 */
export function providerTransactionLedgerSource(organizationId: string, providerTransactionRowId: string) {
  if (!organizationId || !providerTransactionRowId) throw new Error('Organization and provider transaction ids are required')
  return {
    source_type: 'future_provider' as const,
    source_organization_id: organizationId,
    source_kind: 'provider_transaction' as const,
    source_record_id: providerTransactionRowId,
    idempotency_key: `provider_transaction:${providerTransactionRowId}`,
  }
}

/** suggested -> confirmed | rejected | undone ; confirmed -> undone ; rejected and undone are final. */
export function canTransitionInterpretation(from: InterpretationStatus, to: InterpretationStatus): boolean {
  if (from === to) return true
  if (from === 'suggested') return to === 'confirmed' || to === 'rejected' || to === 'undone'
  if (from === 'confirmed') return to === 'undone'
  return false
}

export interface InterpretationDraft {
  kind: InterpretationKind
  status: InterpretationStatus
  ledgerTransactionId?: string | null
  matchMode?: LedgerMatchMode | null
  category?: string | null
  obligationOccurrenceId?: string | null
  cashCommitmentId?: string | null
  transactionLinkId?: string | null
  counterpartProviderTransactionRef?: string | null
  debtAccountId?: string | null
  projectId?: string | null
}

const present = (value: unknown): boolean => value !== null && value !== undefined && String(value).trim() !== ''

/**
 * Mirrors the database CHECK constraints for each interpretation kind. There is deliberately no project-payment or
 * payroll-paid target: those have no durable canonical id yet and are never fabricated.
 */
export function validateInterpretationDraft(d: InterpretationDraft): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const has = {
    ledger: present(d.ledgerTransactionId), mode: present(d.matchMode), category: present(d.category),
    occurrence: present(d.obligationOccurrenceId), commitment: present(d.cashCommitmentId), link: present(d.transactionLinkId),
    counterpart: present(d.counterpartProviderTransactionRef), debt: present(d.debtAccountId), project: present(d.projectId),
  }
  const only = (allowed: Array<keyof typeof has>) => {
    for (const key of Object.keys(has) as Array<keyof typeof has>) {
      if (key === 'ledger' || key === 'mode') continue // ledger anchor is optional except for ledger_match; the match mode is checked per kind
      if (has[key] && !allowed.includes(key)) errors.push(`${d.kind} cannot carry ${key}`)
    }
  }
  switch (d.kind) {
    case 'ledger_match':
      if (!has.ledger) errors.push('ledger_match requires a ledger transaction')
      if (!has.mode) errors.push('ledger_match requires adopted or linked')
      only([])
      break
    case 'category':
      if (!has.category) errors.push('category requires a category')
      if (has.mode) errors.push('category cannot carry a match mode')
      only(['category'])
      break
    case 'transfer':
      if (!has.link && !has.counterpart) errors.push('transfer requires a transaction link or a counterpart provider transaction')
      if (has.mode) errors.push('transfer cannot carry a match mode')
      only(['link', 'counterpart'])
      break
    case 'obligation':
      if (Number(has.occurrence) + Number(has.commitment) !== 1) errors.push('obligation requires exactly one of occurrence or commitment')
      if (has.mode) errors.push('obligation cannot carry a match mode')
      only(['occurrence', 'commitment'])
      break
    case 'debt':
      if (!has.debt) errors.push('debt requires a liability account')
      if (has.mode) errors.push('debt cannot carry a match mode')
      only(['debt', 'link'])
      break
    case 'project':
      if (!has.project) errors.push('project requires a project id')
      if (has.mode) errors.push('project cannot carry a match mode')
      only(['project'])
      break
    case 'payroll':
    case 'ignored':
      if (has.mode) errors.push(`${d.kind} cannot carry a match mode`)
      only([])
      break
  }
  if (d.status === 'confirmed' && d.kind !== 'category' && d.kind !== 'ignored' && !has.ledger) {
    errors.push('A confirmed interpretation needs its canonical ledger transaction')
  }
  return { ok: errors.length === 0, errors }
}
