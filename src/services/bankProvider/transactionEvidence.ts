/**
 * src/services/bankProvider/transactionEvidence.ts
 *
 * SERVER-ONLY, PURE (BANK-4). The strict allowlist boundary between a provider transaction and what Cash OS persists as RAW EVIDENCE.
 *
 *   Plaid SDK transaction --(adapter picks explicit fields)--> SyncedTransaction --(this file)--> TransactionEvidence --> persistence
 *
 * PLAID TRANSACTION = EVIDENCE, NOT A CASH OS TRANSACTION. Nothing here creates a ledger row or interprets business meaning.
 * Only the fields below are ever stored. There is no spread, no raw payload, no nested provider object: `provider_category` is built
 * from three explicit strings, and `raw_payload` is never written (it stays at its empty default). Free text is also screened for
 * credential-shaped strings as a SECONDARY guard (the allowlist is the primary boundary).
 */
import type { SyncedTransaction } from './plaidPort'

const TRANSACTION_ID = /^[A-Za-z0-9_=+/-]{1,128}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** Credential-shaped substrings that must never be persisted from free text. */
const CREDENTIAL_SHAPED = /(?:access|public|link|processor)-(?:sandbox|development|production)-[A-Za-z0-9-]{8,}|\bBearer\s+[A-Za-z0-9._~+/-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY|\bsk-[A-Za-z0-9]{16,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./i

export interface TransactionEvidence {
  providerTransactionId: string
  /** The provider's account id; resolved to the internal provider-account row by the sync service (same Item + organization). */
  providerAccountId: string
  pending: boolean
  /** Only on a POSTED row, and only when the provider itself linked it. Never inferred. */
  pendingProviderTransactionId: string | null
  /**
   * The provider's amount, exactly as reported. Convention (Plaid, documented): POSITIVE = money moving OUT of the account
   * (a debit-card purchase; a charge on a credit account), NEGATIVE = money moving IN (deposit, refund, credit-card payment).
   * Cash OS does not reinterpret it here; see providerAmountDirection.
   */
  providerAmount: number
  providerAmountMinor: number
  currency: 'USD'
  transactionDate: string
  authorizedDate: string | null
  name: string | null
  merchantName: string | null
  providerCategory: { primary: string; detailed: string | null; confidence: string | null } | null
  /** Count of free-text fields dropped by the secondary credential screen (for logs only). */
  redactedFields: number
}

export type EvidenceOutcome =
  | { kind: 'evidence'; evidence: TransactionEvidence }
  | { kind: 'skipped'; reason: 'unsupported_currency' }

/** Thrown for evidence that cannot be stored faithfully. The sync fails closed (the cursor does not advance) instead of dropping it. */
export class EvidenceRejected extends Error {
  readonly reason: 'invalid_id' | 'invalid_amount' | 'invalid_date'
  constructor(reason: 'invalid_id' | 'invalid_amount' | 'invalid_date') { super(`transaction evidence rejected: ${reason}`); this.name = 'EvidenceRejected'; this.reason = reason }
}

function cleanText(v: string | null, max: number): { value: string | null; redacted: boolean } {
  if (typeof v !== 'string') return { value: null, redacted: false }
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
  if (!t) return { value: null, redacted: false }
  if (CREDENTIAL_SHAPED.test(t)) return { value: null, redacted: true }
  return { value: t, redacted: false }
}
function validDate(v: string | null): string | null {
  if (v === null) return null
  if (!ISO_DATE.test(v)) throw new EvidenceRejected('invalid_date')
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new EvidenceRejected('invalid_date')
  return v
}

export function toTransactionEvidence(t: SyncedTransaction): EvidenceOutcome {
  if (!t || !TRANSACTION_ID.test(t.transactionId) || !/^[A-Za-z0-9_-]{1,128}$/.test(t.accountId)) throw new EvidenceRejected('invalid_id')
  if (t.currency !== 'USD') return { kind: 'skipped', reason: 'unsupported_currency' } // the schema is USD-only; never coerced
  if (typeof t.amount !== 'number' || !Number.isFinite(t.amount)) throw new EvidenceRejected('invalid_amount')
  const minor = Math.round(t.amount * 100)
  if (Math.abs(t.amount * 100 - minor) > 1e-6 || Math.abs(minor) > 9e15) throw new EvidenceRejected('invalid_amount') // the schema requires exact cents
  const date = validDate(t.date)
  if (!date) throw new EvidenceRejected('invalid_date')
  const authorized = validDate(t.authorizedDate)
  let pendingRef: string | null = null
  if (!t.pending && t.pendingTransactionId !== null) {
    if (!TRANSACTION_ID.test(t.pendingTransactionId)) throw new EvidenceRejected('invalid_id')
    pendingRef = t.pendingTransactionId // the provider linked it; we never invent one
  }
  const name = cleanText(t.name, 200), merchant = cleanText(t.merchantName, 200)
  const primary = cleanText(t.categoryPrimary, 64), detailed = cleanText(t.categoryDetailed, 96), confidence = cleanText(t.categoryConfidence, 32)
  return { kind: 'evidence', evidence: {
    providerTransactionId: t.transactionId, providerAccountId: t.accountId, pending: t.pending === true, pendingProviderTransactionId: pendingRef,
    providerAmount: minor / 100, providerAmountMinor: minor, currency: 'USD', transactionDate: date, authorizedDate: authorized,
    name: name.value, merchantName: merchant.value,
    providerCategory: primary.value ? { primary: primary.value, detailed: detailed.value, confidence: confidence.value } : null,
    redactedFields: [name, merchant, primary, detailed, confidence].filter(f => f.redacted).length,
  } }
}

/**
 * Explicit money direction for later phases, from the provider's own convention (never guessed from a name or category).
 * 'money_out' = left the account / charge on a credit account; 'money_in' = arrived / refund / payment. Zero is allowed and stays zero.
 */
export function providerAmountDirection(providerAmountMinor: number): 'money_out' | 'money_in' | 'zero' {
  return providerAmountMinor > 0 ? 'money_out' : providerAmountMinor < 0 ? 'money_in' : 'zero'
}
