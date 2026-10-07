/**
 * src/services/spending/merchant.ts
 *
 * Deterministic merchant normalization. The key groups "the same merchant" for merchant learning and recurrence detection; it is NEVER
 * used to infer a project or any other consequential relationship.
 */

const NOISE_PREFIX = /^(?:(?:SQ|TST|SP|PP|PAYPAL|PY|GOOGLE|APLPAY|APPLE PAY|POS|DEBIT|CHECKCARD|PURCHASE|RECURRING|ACH|WEB|ONLINE)\s*[*#:-]\s*)+/
const STOP = new Set(['THE', 'INC', 'LLC', 'CO', 'CORP', 'COM', 'LTD', 'AND', 'OF', 'PAYMENT', 'PMT', 'ONLINE', 'BILL', 'WWW', 'HTTP', 'HTTPS', 'US', 'USA', 'STORE', 'POS', 'DEBIT', 'CARD', 'PURCHASE', 'RECURRING'])

/** Upper-case, drop store numbers / punctuation / noise prefixes, collapse spaces. */
export function normalizeText(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return ''
  let t = raw.toUpperCase().replace(/[\u0000-\u001f]+/g, ' ').trim()
  t = t.replace(NOISE_PREFIX, '')
  t = t.replace(/\d+/g, ' ').replace(/[^A-Z&\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return t
}

export const tokens = (raw: string | null | undefined): string[] => normalizeText(raw).split(' ').filter(t => t.length >= 2 && !STOP.has(t))

/** The text signals of a transaction: the provider merchant name when present, else the description. Both are searched by the rules. */
export function searchText(name: string | null, merchantName: string | null): string {
  return normalizeText([merchantName, name].filter(Boolean).join(' '))
}

/** A short, stable grouping key: the merchant name when the provider gave one, otherwise the first two meaningful words of the description. */
export function merchantKey(name: string | null, merchantName: string | null): string {
  const m = tokens(merchantName)
  if (m.length) return m.slice(0, 3).join(' ')
  const n = tokens(name)
  return n.slice(0, 2).join(' ') || 'UNKNOWN MERCHANT'
}

/** Owner-readable merchant label. */
export function merchantLabel(name: string | null, merchantName: string | null): string {
  const raw = (merchantName && merchantName.trim()) || (name && name.trim()) || 'Unknown merchant'
  return raw.replace(/\s+/g, ' ').slice(0, 60)
}

/** Token overlap helper for explainable name matching. */
export function distinctiveTokens(raw: string | null | undefined): string[] {
  return tokens(raw).filter(t => t.length >= 3)
}
