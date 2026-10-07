/**
 * src/services/bankProvider/spending/contract.ts
 *
 * PERMANENT BANK-5 CONTRACT: CONFIRMED INTERPRETATION != CANONICAL RECONCILIATION.
 *
 * An interpretation with status 'confirmed' means ONLY:
 *     "The owner confirmed this interpretation of provider evidence."
 * It does NOT mean any of:
 *     - a ledger transaction was created
 *     - an obligation / bill was paid or an occurrence was materialized
 *     - a debt was paid
 *     - a project payment or revenue was received
 *     - payroll was paid
 *     - a transfer was reconciled
 *     - provider evidence was adopted into canonical Cash OS truth
 *
 * Canonical adoption/reconciliation (BANK-6) must therefore require an ADDITIONAL, explicit operation with its own reference. Today the
 * only interpretation that carries a canonical reference is kind 'ledger_match' (ledger_transaction_id + match_mode are required by the
 * schema), and BANK-5 never creates one: the atomic replacement function refuses it and the spending code has no field for it.
 *
 * BANK-6 must use `representsCanonicalAdoption` (or an equally strict check), never `status === 'confirmed'` alone.
 */
export const CONFIRMED_INTERPRETATION_CONTRACT = Object.freeze({
  confirmedMeans: 'owner_confirmed_interpretation_of_provider_evidence',
  isCanonicalAdoption: false,
  doesNotMean: Object.freeze(['ledger_transaction_created', 'obligation_paid', 'debt_paid', 'project_payment_received', 'payroll_paid', 'transfer_reconciled', 'evidence_adopted'] as const),
  adoptionRequires: 'a separate explicit BANK-6 operation with its own canonical reference',
  /** Shown to the browser so no screen can imply otherwise. */
  ownerText: 'Confirming labels bank evidence only. It does not change your balances, ledger, bills, projects, payroll or reports.',
})

export interface InterpretationLike {
  kind: string
  status: string
  ledgerTransactionId?: string | null
  matchMode?: string | null
}

/**
 * The ONLY way a stored interpretation may be read as "tied to canonical truth": a confirmed ledger_match that actually carries a ledger
 * reference and a match mode. Every other confirmed kind (bucket, known bill, project, debt, payroll, transfer, overhead, personal, ignored)
 * is interpretation-only and returns false, whatever else it points at.
 */
export function representsCanonicalAdoption(i: InterpretationLike): boolean {
  return i.kind === 'ledger_match' && i.status === 'confirmed' && !!i.ledgerTransactionId && !!i.matchMode
}
