/**
 * src/services/bankProvider/balanceModel.ts
 *
 * PURE (PLAID-2E). How a provider balance snapshot is read. A balance is EVIDENCE about an account at an instant; it is not profit, not income and
 * not a ledger entry. The rules below are the whole point of this file:
 *
 *   * Bank cash (checking / savings) and credit-card debt are DIFFERENT KINDS of number. A card balance is a liability the owner owes; it is never
 *     "negative bank cash", and a card's unused credit is never available cash. The output has no field that mixes them.
 *   * `current` and `available` are different facts. For a bank account `available` already subtracts pending debits; when the bank did not report
 *     it, it is UNKNOWN (null), never silently replaced by `current`.
 *   * Every reading carries when the bank says the number was true and how old that is. Missing = 'unknown', never 'fresh'.
 *
 * Provider sign convention (Plaid, documented): depository `current` = funds in the account; credit `current` = amount OWED (positive); credit
 * `available` = remaining credit; credit `limit` = credit limit.
 */
export type AccountClass = 'bank_cash' | 'credit_card' | 'loan' | 'investment' | 'other'
export type Freshness = 'fresh' | 'aging' | 'stale' | 'unknown'

/** Hours: <= FRESH is current for owner decisions, <= AGING is usable with a warning, beyond is stale. */
export const FRESH_HOURS = 24
export const AGING_HOURS = 72

const RESTRICTED_SUBTYPES = new Set(['cd', 'hsa', 'cash management', 'prepaid', 'paypal', 'ebt'])

export function classifyAccount(type: string | null | undefined, subtype: string | null | undefined): { accountClass: AccountClass; restricted: boolean } {
  const t = (type ?? '').toLowerCase(), s = (subtype ?? '').toLowerCase()
  if (t === 'depository') return { accountClass: 'bank_cash', restricted: RESTRICTED_SUBTYPES.has(s) && s !== 'cash management' }
  if (t === 'credit') return { accountClass: 'credit_card', restricted: false }
  if (t === 'loan') return { accountClass: 'loan', restricted: false }
  if (t === 'investment' || t === 'brokerage') return { accountClass: 'investment', restricted: false }
  return { accountClass: 'other', restricted: false }
}

export interface BalanceSnapshotInput {
  currentMinor: number | null
  availableMinor: number | null
  limitMinor: number | null
  /** When the bank says the balance was true (Plaid balances.last_updated_datetime), else when Cash OS retrieved it. */
  observedAt: string
  /** When Cash OS retrieved it. */
  retrievedAt: string
  /** True when `observedAt` is the bank's own timestamp rather than our retrieval time. */
  observedIsProvider: boolean
}

export interface InterpretedBalance {
  accountClass: AccountClass
  restricted: boolean
  freshness: Freshness
  ageHours: number | null
  observedAt: string | null
  retrievedAt: string | null
  observedIsProvider: boolean
  /** Bank accounts only. Funds posted in the account. */
  bankBalanceMinor: number | null
  /** Bank accounts only. What the bank says can be spent now (after pending debits). null = the bank did not say. NEVER copied from current. */
  availableMinor: number | null
  /** Credit cards / loans only. What is owed (>= 0). */
  owedMinor: number | null
  /** A card in the owner's favour (the bank reports a negative amount owed). */
  creditInFavourMinor: number | null
  /** Credit cards only. Spendable CREDIT, never cash. */
  unusedCreditMinor: number | null
  creditLimitMinor: number | null
  /** Constant guard: nothing in this object is ever added to bank cash. */
  unusedCreditIsCash: false
}

export function freshnessOf(observedAt: string | null, nowMs: number, itemHealthy = true): { freshness: Freshness; ageHours: number | null } {
  if (!observedAt) return { freshness: 'unknown', ageHours: null }
  const t = Date.parse(observedAt)
  if (!Number.isFinite(t)) return { freshness: 'unknown', ageHours: null }
  const ageHours = Math.max(0, (nowMs - t) / 3_600_000)
  if (!itemHealthy) return { freshness: ageHours > AGING_HOURS ? 'stale' : 'aging', ageHours } // a connection that needs sign-in can never be called fresh
  return { freshness: ageHours <= FRESH_HOURS ? 'fresh' : ageHours <= AGING_HOURS ? 'aging' : 'stale', ageHours }
}

const nn = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function interpretBalance(account: { type: string | null; subtype: string | null }, snap: BalanceSnapshotInput | null, nowMs: number, itemHealthy = true): InterpretedBalance {
  const { accountClass, restricted } = classifyAccount(account.type, account.subtype)
  const base: InterpretedBalance = { accountClass, restricted, freshness: 'unknown', ageHours: null, observedAt: null, retrievedAt: null, observedIsProvider: false,
    bankBalanceMinor: null, availableMinor: null, owedMinor: null, creditInFavourMinor: null, unusedCreditMinor: null, creditLimitMinor: null, unusedCreditIsCash: false }
  if (!snap) return base
  const f = freshnessOf(snap.observedAt, nowMs, itemHealthy)
  const out = { ...base, freshness: f.freshness, ageHours: f.ageHours, observedAt: snap.observedAt, retrievedAt: snap.retrievedAt, observedIsProvider: snap.observedIsProvider }
  const current = nn(snap.currentMinor), available = nn(snap.availableMinor), limit = nn(snap.limitMinor)
  if (accountClass === 'bank_cash') return { ...out, bankBalanceMinor: current, availableMinor: available }
  if (accountClass === 'credit_card' || accountClass === 'loan') {
    const owed = current === null ? null : Math.max(current, 0)
    const inFavour = current !== null && current < 0 ? -current : null
    // Unused credit: the bank's own `available` when given, else limit - owed. Only for cards; a loan has no revolving credit.
    const unused = accountClass === 'credit_card' ? (available !== null ? Math.max(available, 0) : limit !== null && owed !== null ? Math.max(limit - owed, 0) : null) : null
    return { ...out, owedMinor: owed, creditInFavourMinor: inFavour, unusedCreditMinor: unused, creditLimitMinor: accountClass === 'credit_card' ? limit : null }
  }
  return out
}

/** Whole cents from a provider decimal, or null when it is not exactly representable (the schema needs exact cents; nothing is rounded silently). */
export function toExactMinor(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const minor = Math.round(v * 100)
  if (Math.abs(v * 100 - minor) > 1e-6 || Math.abs(minor) > 9e15) return null
  return minor
}
