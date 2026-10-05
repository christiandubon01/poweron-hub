import type { FinancialAccountClass } from './ledgerTypes'

/**
 * Owner-entered real-world balance → canonical ledger target → reconciliation delta.
 *
 * Canonical ledger sign convention is unchanged: an account's balance is the signed sum of its
 * posted `amount_minor` rows. For an ASSET account that is the ledger balance itself and may be
 * positive, zero, or negative (an overdrawn checking account). For a LIABILITY account the
 * canonical balance is the positive amount owed, so the owner enters the amount owed as a
 * positive number and a negative entry is refused rather than silently flipped.
 */

export type ReconciliationEntry =
  | { ok: true; targetMinor: number; deltaMinor: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'negative_liability' }

/**
 * Parses an owner-typed dollar amount to signed integer cents. Accepts `$`, thousands commas,
 * a leading `-` / `−`, and accounting parentheses `(103.00)`. Returns null when the text is not
 * a plain amount (no stripping of unrelated characters).
 */
export function parseSignedDollarsToMinor(raw: string): number | null {
  const text = raw.trim().replace(/\s+/g, '').replace(/,/g, '')
  const match = /^(?:\(\$?(\d+(?:\.\d*)?|\.\d+)\)|([-−]?)\$?([-−]?)(\d+(?:\.\d*)?|\.\d+))$/.exec(text)
  if (!match) return null
  if (match[2] && match[3]) return null
  const negative = match[1] !== undefined || Boolean(match[2] || match[3])
  const minor = Math.round(parseFloat(match[1] ?? match[4]) * 100)
  if (!Number.isSafeInteger(minor)) return null
  return negative && minor !== 0 ? -minor : minor
}

export function resolveReconciliationEntry(input: {
  accountClass: FinancialAccountClass | undefined
  rawAmount: string
  currentCanonicalMinor: number
}): ReconciliationEntry {
  if (!input.rawAmount.trim()) return { ok: false, reason: 'empty' }
  const targetMinor = parseSignedDollarsToMinor(input.rawAmount)
  if (targetMinor === null) return { ok: false, reason: 'invalid' }
  if (input.accountClass === 'liability' && targetMinor < 0) return { ok: false, reason: 'negative_liability' }
  return { ok: true, targetMinor, deltaMinor: targetMinor - input.currentCanonicalMinor }
}

export function reconciliationEntryHelp(accountClass: FinancialAccountClass | undefined): string {
  return accountClass === 'liability'
    ? 'Enter the positive amount you currently owe.'
    : 'Enter the balance your bank shows. Use a minus sign if the account is overdrawn (e.g. -103.00).'
}

export function reconciliationEntryError(reason: 'invalid' | 'negative_liability'): string {
  return reason === 'negative_liability'
    ? 'Enter the amount owed as a positive number.'
    : 'Enter a valid amount, for example 53.00 or -103.00.'
}
