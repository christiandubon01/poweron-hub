/**
 * src/services/spending/classifier.ts
 *
 * BANK-5 deterministic, EXPLAINABLE suggestion engine. PURE: the same inputs always produce the same output, and nothing here reads or
 * writes anything. Every suggestion carries its confidence and the plain-language reasons behind it. There is no model, no scoring black
 * box and no learned weight: owner confirmations only enter as counted history.
 *
 * Hard rules (tested):
 *   - A suggestion is never a decision. Only an owner action persists anything.
 *   - Merchant history may suggest an ECONOMIC BUCKET. It NEVER suggests a project or any other relationship.
 *   - A project is suggested only when the transaction's own text names the project (explicit context), at most "possible".
 *   - Transfers are suggested (paired when an opposite, equal, nearby movement exists in another account) but never canonicalized.
 *   - Pending evidence gets suggestions for display only.
 */
import { distinctiveTokens, merchantKey, normalizeText, searchText } from './merchant'
import { OTHER_BUCKET, CONFIDENCE_RANK, bucketLabel, isBucketKey, type BucketKey, type Confidence, type Direction } from './taxonomy'
import type {
  AccountContext, BucketSuggestion, Decision, DebtOption, EvidenceTx, KnownBillCandidate, ProjectOption, RelationshipSuggestion, TxSuggestion,
} from './types'

export const directionOf = (amountMinor: number): Direction => amountMinor > 0 ? 'money_out' : amountMinor < 0 ? 'money_in' : 'zero'
const daysBetween = (a: string, b: string): number => Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000))
const money = (minor: number): string => `$${(Math.abs(minor) / 100).toFixed(2)}`

// ── curated merchant rules: exact, explainable, high confidence ──────────────────────────────────────────────────
const re = (...words: string[]) => new RegExp(`\\b(?:${words.join('|')})\\b`)
const MERCHANT_RULES: Array<{ bucket: BucketKey; pattern: RegExp; label: string }> = [
  { bucket: 'fuel_vehicle', pattern: re('CHEVRON', 'SHELL', 'ARCO', 'EXXON', 'EXXONMOBIL', 'MOBIL', 'VALERO', 'SPEEDWAY', 'COSTCO GAS', 'AUTOZONE', 'O REILLY', 'JIFFY LUBE', 'CALTRANS', 'FASTRAK'), label: 'fuel / vehicle merchant' },
  { bucket: 'materials', pattern: re('HOME DEPOT', 'LOWES', 'LOWE S', 'ACE HARDWARE', 'GRAYBAR', 'PLATT ELECTRIC', 'CITY ELECTRIC SUPPLY', 'WESCO', 'FERGUSON', 'RESIDENTIAL LIGHTING'), label: 'building / electrical supply merchant' },
  { bucket: 'tools_equipment', pattern: re('HARBOR FREIGHT', 'MILWAUKEE TOOL', 'DEWALT', 'SNAP ON', 'FLUKE', 'KLEIN TOOLS', 'NORTHERN TOOL', 'GRAINGER'), label: 'tool / equipment merchant' },
  { bucket: 'software_subscriptions', pattern: re('QUICKBOOKS', 'INTUIT', 'QBOOKS', 'ADOBE', 'MICROSOFT', 'DROPBOX', 'ZOOM', 'SLACK', 'GITHUB', 'OPENAI', 'ANTHROPIC', 'NETLIFY', 'SUPABASE', 'CANVA', 'NOTION', 'APPLE COM', 'ITUNES', 'GOOGLE WORKSPACE', 'GSUITE', 'GOOGLE ONE'), label: 'software / subscription merchant' },
  { bucket: 'insurance', pattern: re('STATE FARM', 'PROGRESSIVE', 'GEICO', 'NEXT INSURANCE', 'HISCOX', 'LIBERTY MUTUAL', 'ALLSTATE', 'FARMERS INS', 'INSURANCE', 'WORKERS COMP'), label: 'insurance merchant' },
  { bucket: 'permits_fees', pattern: re('PERMIT', 'CSLB', 'CONTRACTORS STATE LICENSE', 'BUILDING DEPT', 'BUILDING AND SAFETY', 'CITY OF', 'COUNTY OF', 'DMV'), label: 'permit / license / government fee' },
  { bucket: 'marketing', pattern: re('GOOGLE ADS', 'FACEBK', 'META ADS', 'FACEBOOK ADS', 'YELP', 'ANGI', 'HOMEADVISOR', 'THUMBTACK', 'NEXTDOOR', 'VISTAPRINT'), label: 'marketing / lead-service merchant' },
  { bucket: 'meals', pattern: re('MCDONALD S', 'MCDONALDS', 'STARBUCKS', 'CHIPOTLE', 'SUBWAY', 'DOORDASH', 'UBER EATS', 'GRUBHUB', 'IN N OUT', 'TACO BELL', 'WENDY S', 'KFC', 'DUNKIN', 'PANERA', 'RESTAURANT', 'PIZZA', 'COFFEE'), label: 'food / drink merchant' },
  { bucket: 'office_admin', pattern: re('STAPLES', 'OFFICE DEPOT', 'USPS', 'UPS STORE', 'FEDEX', 'POSTAGE'), label: 'office / shipping merchant' },
  { bucket: 'taxes', pattern: re('IRS', 'EFTPS', 'FRANCHISE TAX', 'CDTFA', 'SALES TAX', 'TAX PAYMENT', 'EDD'), label: 'tax payment' },
  { bucket: 'personal_owner', pattern: re('NETFLIX', 'SPOTIFY', 'HULU', 'DISNEY PLUS', 'HBO MAX', 'PELOTON'), label: 'consumer subscription' },
]
const FEE_RULE = re('OVERDRAFT', 'NSF', 'ATM FEE', 'ATM WITHDRAWAL FEE', 'NON WF ATM', 'NON WELLS FARGO ATM', 'INTERNATIONAL TRANSACTION FEE', 'INTL TRANSACTION FEE', 'STOP PAYMENT FEE', 'PAPER STATEMENT FEE', 'SERVICE FEE', 'MONTHLY FEE', 'MAINTENANCE FEE', 'WIRE FEE', 'FOREIGN TRANSACTION FEE', 'INTEREST CHARGE', 'FINANCE CHARGE', 'ANNUAL FEE', 'LATE FEE', 'RETURNED ITEM')
/** Probably business software, but only the owner can verify: suggested as "possible", never in bulk without a choice. */
const POSSIBLE_SOFTWARE = re('OLLAMA', 'ELEVENLABS', 'ELEVEN LABS')
/** Merchants that serve more than one purpose (home/business, personal/business): the owner picks the category, a merchant name never decides. */
const MIXED_MERCHANT = re('APPLE', 'APPLE COM', 'ITUNES', 'AMAZON', 'AMZN', 'WALMART', 'TARGET', 'COSTCO', 'VONS', 'SAFEWAY', 'RALPHS', 'ALBERTSONS', 'TRADER JOE S', 'WHOLE FOODS', 'HOME DEPOT', 'LOWES', 'LOWE S', 'ACE HARDWARE', 'HARBOR FREIGHT', 'AUTOZONE', 'O REILLY', 'SEVEN ELEVEN', 'PAYPAL', 'VENMO', 'CASH APP', 'SQUARE', 'GOOGLE')
/** Buckets that describe a kind of merchant (food, fuel) rather than a business purpose: the same place can be business or personal. */
const MIXED_BUCKETS = new Set<BucketKey>(['meals', 'fuel_vehicle'])
const PAYROLL_PROCESSORS = re('GUSTO', 'ADP', 'PAYCHEX', 'PAYLOCITY', 'TRINET', 'JUSTWORKS', 'QUICKBOOKS PAYROLL', 'INTUIT PAYROLL')
const PAYROLL_GENERIC = re('PAYROLL')
const TRANSFER_KEYWORD = re('TRANSFER', 'XFER', 'ONLINE TRANSFER', 'ACH TRANSFER', 'WIRE TRANSFER')
const PAYMENT_KEYWORD = re('PAYMENT', 'PMT', 'AUTOPAY', 'AUTO PAY', 'LOAN', 'EPAY')
const OWNER_DRAW = re('OWNER DRAW', 'OWNERS DRAW', 'OWNER S DRAW', 'MEMBER DRAW', 'OWNER DISTRIBUTION', 'SHAREHOLDER DISTRIBUTION')
const REFUND_WORDS = re('REFUND', 'RETURN', 'REVERSAL', 'CHARGEBACK')
const DEPOSIT_WORDS = re('DEPOSIT', 'ZELLE', 'ACH CREDIT', 'MOBILE DEPOSIT', 'CHECK DEPOSIT', 'CUSTOMER', 'PAYMENT FROM', 'REMOTE ONLINE DEPOSIT')
const CARD_PAYMENT = /\b(?:CREDIT CARD|CARD PAYMENT|CARD PMT|CRCARDPMT|CARD SERVICES|AUTOPAY CARD|CARD AUTOPAY|CARD EPAY|CARD ONLINE PMT)\b/
const GENERIC_ACCOUNT_WORDS = new Set(['CARD', 'LOAN', 'CREDIT', 'BUSINESS', 'ACCOUNT', 'VISA', 'MASTERCARD', 'AMEX', 'PERSONAL', 'BANK', 'CHECKING', 'SAVINGS'])

// ── Plaid personal_finance_category -> bucket (a DISPLAY mapping of the provider's own classification, never authoritative) ──────
const PFC_DETAILED: Array<{ prefix: string; bucket: BucketKey; strong: boolean }> = [
  { prefix: 'BANK_FEES', bucket: 'bank_finance_fees', strong: true },
  { prefix: 'TRANSPORTATION_GAS', bucket: 'fuel_vehicle', strong: true },
  { prefix: 'TRANSPORTATION_PARKING', bucket: 'fuel_vehicle', strong: false },
  { prefix: 'TRANSPORTATION_TOLLS', bucket: 'fuel_vehicle', strong: false },
  { prefix: 'GENERAL_SERVICES_AUTOMOTIVE', bucket: 'fuel_vehicle', strong: false },
  { prefix: 'GENERAL_SERVICES_INSURANCE', bucket: 'insurance', strong: true },
  { prefix: 'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING', bucket: 'office_admin', strong: false },
  { prefix: 'GENERAL_SERVICES_POSTAGE_AND_SHIPPING', bucket: 'office_admin', strong: false },
  { prefix: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', bucket: 'office_admin', strong: false },
  { prefix: 'GENERAL_MERCHANDISE_ELECTRONICS', bucket: 'tools_equipment', strong: false },
  { prefix: 'HOME_IMPROVEMENT_HARDWARE', bucket: 'materials', strong: false },
  { prefix: 'HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE', bucket: 'materials', strong: false },
  { prefix: 'RENT_AND_UTILITIES', bucket: 'office_admin', strong: false },
  { prefix: 'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT', bucket: 'taxes', strong: true },
  { prefix: 'GOVERNMENT_AND_NON_PROFIT', bucket: 'permits_fees', strong: false },
  { prefix: 'ENTERTAINMENT', bucket: 'personal_owner', strong: false },
  { prefix: 'PERSONAL_CARE', bucket: 'personal_owner', strong: false },
  { prefix: 'MEDICAL', bucket: 'personal_owner', strong: false },
  { prefix: 'FOOD_AND_DRINK', bucket: 'meals', strong: false },
]
const FEE_WORDS = re('FEE', 'FEES', 'CHARGE', 'OVERDRAFT', 'NSF', 'INTEREST', 'PENALTY')
const HIGH_PLAID = new Set(['VERY_HIGH', 'HIGH'])

function bucketFromProvider(tx: EvidenceTx): BucketSuggestion | null {
  const c = tx.category
  if (!c) return null
  const detailed = (c.detailed ?? '').toUpperCase(), primary = c.primary.toUpperCase()
  const hit = PFC_DETAILED.find(p => detailed.startsWith(p.prefix) || (!detailed && primary.startsWith(p.prefix)))
  if (!hit) return null
  // BANK-6B: a provider "bank fees" label alone is not evidence of a fee (Plaid labelled a plain Apple purchase that way). Without fee wording
  // in the description it is shown only as a LOW-confidence hint the owner must check.
  if (hit.bucket === 'bank_finance_fees' && !FEE_WORDS.test(searchText(tx.name, tx.merchantName))) {
    return { bucket: hit.bucket, confidence: 'low', basis: 'provider_category', reasons: ['The bank labelled this as a fee, but the description does not mention a fee, so check it before approving.'] }
  }
  const sure = hit.strong && HIGH_PLAID.has((c.confidence ?? '').toUpperCase())
  return {
    bucket: hit.bucket, confidence: sure ? 'high' : 'possible', basis: 'provider_category',
    reasons: [`The bank's own category (${primary.toLowerCase().replace(/_/g, ' ')}) maps to ${bucketLabel(hit.bucket)}${sure ? ' with high provider confidence' : ' (a general mapping)'}.`],
  }
}

export interface ClassifierInput {
  txs: EvidenceTx[]
  accounts: Map<string, AccountContext>
  decisions: Decision[]
  bills: KnownBillCandidate[]
  debts: DebtOption[]
  projects: ProjectOption[]
  /** BANK-6B: active owner-approved merchant rules (merchantKey -> everyday category). They only improve suggestions. */
  ownerRules?: Map<string, BucketKey>
}

/** Owner-confirmed bucket decisions grouped by merchant: the ONLY learned signal, and it only ever informs a bucket. */
export function buildMerchantHistory(txs: EvidenceTx[], decisions: Decision[]): Map<string, Map<BucketKey, number>> {
  const byId = new Map(txs.map(t => [t.id, t]))
  const history = new Map<string, Map<BucketKey, number>>()
  for (const d of decisions) {
    // Custom categories are reusable by explicit choice only in BANK-6G. Never learn an unknown/archived key into a suggestion.
    if (d.kind !== 'category' || d.status !== 'confirmed' || !isBucketKey(d.category)) continue
    const tx = byId.get(d.txId)
    if (!tx) continue
    const key = merchantKey(tx.name, tx.merchantName)
    const counts = history.get(key) ?? new Map<BucketKey, number>()
    counts.set(d.category as BucketKey, (counts.get(d.category as BucketKey) ?? 0) + 1)
    history.set(key, counts)
  }
  return history
}

export const isMixedMerchant = (text: string): boolean => MIXED_MERCHANT.test(text)

/** The bucket suggested by the provider's own category alone (used only to flag a disagreement; never a decision). */
export const providerBucketOf = (tx: EvidenceTx): BucketKey | null => bucketFromProvider(tx)?.bucket ?? null

function bucketFor(tx: EvidenceTx, history: Map<string, Map<BucketKey, number>>, ownerRules: Map<string, BucketKey> = new Map()): BucketSuggestion | null {
  const s = bucketForUnflagged(tx, history, ownerRules)
  if (!s) return s
  // A remembered rule may PREFILL the category, but it never lifts the mixed-purpose requirement: the owner still confirms the category for the group.
  const mixed = MIXED_BUCKETS.has(s.bucket) || MIXED_MERCHANT.test(searchText(tx.name, tx.merchantName))
  return mixed ? { ...s, mixed: true } : s
}

function bucketForUnflagged(tx: EvidenceTx, history: Map<string, Map<BucketKey, number>>, ownerRules: Map<string, BucketKey>): BucketSuggestion | null {
  const text = searchText(tx.name, tx.merchantName)
  const key = merchantKey(tx.name, tx.merchantName)
  const learned = history.get(key)
  let fromHistory: BucketSuggestion | null = null
  if (learned && learned.size) {
    const total = [...learned.values()].reduce((a, b) => a + b, 0)
    const [bucket, n] = [...learned.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    const share = n / total
    if (share >= 0.6) {
      fromHistory = {
        bucket, basis: 'owner_history', confidence: n >= 2 && share >= 0.8 ? 'high' : 'possible',
        reasons: [`You confirmed ${n} earlier ${key.toLowerCase()} transaction${n === 1 ? '' : 's'} as ${bucketLabel(bucket)}${share < 1 ? ` (${Math.round(share * 100)}% of your decisions for this merchant)` : ''}. This suggests a bucket only; it never assigns a project.`],
      }
    }
  }
  let fromRules: BucketSuggestion | null = null
  const rule = MERCHANT_RULES.find(r => r.pattern.test(text))
  if (OWNER_DRAW.test(text)) fromRules = { bucket: 'owner_draw', confidence: 'possible', basis: 'merchant_rule', reasons: ['The description mentions an owner draw. Confirm it yourself: a draw is not a business expense.'] }
  else if (FEE_RULE.test(text)) fromRules = { bucket: 'bank_finance_fees', confidence: 'high', basis: 'fee_rule', reasons: ['The description reads like a bank or finance fee.'] }
  else if (PAYROLL_PROCESSORS.test(text)) fromRules = { bucket: 'payroll_people', confidence: 'high', basis: 'payroll', reasons: ['The merchant is a payroll provider.'] }
  else if (rule) fromRules = { bucket: rule.bucket, confidence: 'high', basis: 'merchant_rule', reasons: [`The merchant looks like a ${rule.label}.`] }
  else if (POSSIBLE_SOFTWARE.test(text)) fromRules = { bucket: 'software_subscriptions', confidence: 'possible', basis: 'merchant_rule', reasons: ['This looks like a software or AI service, which is usually a business subscription. Confirm it is yours for the business.'] }
  else if (/\bAPPLE\b/.test(text) && !MERCHANT_RULES.some(r => r.pattern.test(text))) fromRules = { bucket: 'software_subscriptions', confidence: 'possible', basis: 'merchant_rule', reasons: ['Apple sells hardware, apps and services, so the purpose is unclear. It could be software, equipment or personal.'] }
  else if (PAYROLL_GENERIC.test(text)) fromRules = { bucket: 'payroll_people', confidence: 'possible', basis: 'payroll', reasons: ['The description mentions payroll.'] }
  // BANK-6B precedence: an explicit decision on the transaction (handled by the caller) > a REMEMBERED OWNER RULE > implicit owner history > curated rule >
  // provider category. A remembered rule only improves the suggestion: it never approves anything, and it never overrides text that signals an owner
  // draw, payroll or a fee (those are always individual decisions).
  const remembered = ownerRules.get(key)
  if (remembered && !OWNER_DRAW.test(text) && !FEE_RULE.test(text) && !PAYROLL_PROCESSORS.test(text) && !PAYROLL_GENERIC.test(text)) {
    return { bucket: remembered, basis: 'owner_rule', confidence: 'high', reasons: [`You asked to remember ${bucketLabel(remembered)} for ${key.toLowerCase()}. This is only a suggestion: each transaction still needs your approval.`] }
  }
  // Fee wording, payroll processors and owner-draw text describe WHAT the money was; a merchant's earlier decisions do not outrank them.
  if (fromHistory && fromRules && (fromRules.basis === 'fee_rule' || fromRules.basis === 'payroll' || OWNER_DRAW.test(text))) return fromRules
  if (fromHistory) {
    // The owner's own decisions win a disagreement. When the owner and a curated rule AGREE, the suggestion is as strong as it gets.
    if (fromRules && fromRules.bucket === fromHistory.bucket) return { ...fromHistory, confidence: 'high', reasons: [...fromHistory.reasons, ...fromRules.reasons] }
    return fromHistory
  }
  return fromRules ?? bucketFromProvider(tx)
}

// ── known-bill matching: explainable signal scoring + one-to-one assignment ──────────────────────────────────────
interface Scored { tx: EvidenceTx; bill: KnownBillCandidate; score: number; days: number; confidence: Confidence; reasons: string[] }

function scoreBill(tx: EvidenceTx, bill: KnownBillCandidate, account: AccountContext | undefined, text: string): Scored | null {
  const days = daysBetween(tx.date, bill.expectedDate)
  if (days > 7) return null
  const reasons: string[] = []
  let score = 0
  const billTokens = distinctiveTokens(bill.label).filter(t => !GENERIC_ACCOUNT_WORDS.has(t))
  const txTokens = new Set(distinctiveTokens(text))
  const matched = billTokens.filter(t => txTokens.has(t))
  let nameFull = false
  if (billTokens.length && matched.length === billTokens.length) { score += 3; nameFull = true; reasons.push(`The description matches the bill name "${bill.label}".`) }
  else if (matched.some(t => t.length >= 5)) { score += 2; reasons.push(`The description shares "${matched.find(t => t.length >= 5)!.toLowerCase()}" with the bill "${bill.label}".`) }
  else if (matched.length) { score += 1; reasons.push(`The description shares a word with the bill "${bill.label}".`) }
  const diff = Math.abs(tx.amountMinor - bill.amountMinor)
  let amount = 0
  if (bill.estimatedMinMinor !== null && bill.estimatedMaxMinor !== null && tx.amountMinor >= bill.estimatedMinMinor && tx.amountMinor <= bill.estimatedMaxMinor) { amount = 2; reasons.push(`${money(tx.amountMinor)} is inside the expected range ${money(bill.estimatedMinMinor)}-${money(bill.estimatedMaxMinor)}.`) }
  else if (diff <= Math.max(100, Math.round(bill.amountMinor * 0.02))) { amount = 2; reasons.push(`${money(tx.amountMinor)} matches the expected ${money(bill.amountMinor)}.`) }
  else if (diff <= Math.round(bill.amountMinor * 0.1)) { amount = 1; reasons.push(`${money(tx.amountMinor)} is within 10% of the expected ${money(bill.amountMinor)}.`) }
  score += amount * 2
  if (days <= 3) { score += 1; reasons.push(days === 0 ? 'It posted on the expected date.' : `It posted ${days} day${days === 1 ? '' : 's'} from the expected date.`) }
  let accountOk = false, accountMismatch = false
  if (bill.financialAccountId && account?.financialAccountId) {
    if (bill.financialAccountId === account.financialAccountId) { score += 1; accountOk = true; reasons.push('It came from the account this bill is normally paid from.') }
    else { score -= 1; accountMismatch = true; reasons.push('The bill is normally paid from a different account, so this is a weaker match.') }
  }
  const dateOk = days <= 3
  let confidence: Confidence | null = null
  if (nameFull && amount >= 1 && (dateOk || accountOk)) confidence = 'high'
  else if (matched.length && amount >= 1) confidence = 'possible'
  else if (amount === 2 && dateOk && accountOk) confidence = 'possible'
  else if (amount === 2 && dateOk) confidence = 'low'
  if (confidence === 'high' && accountMismatch) confidence = 'possible' // the right amount and name from the wrong account is worth a look, not a conclusion
  if (!confidence) return null
  return { tx, bill, score, days, confidence, reasons }
}

function matchKnownBills(txs: EvidenceTx[], accounts: Map<string, AccountContext>, bills: KnownBillCandidate[], skip: Set<string>): Map<string, RelationshipSuggestion> {
  const pairs: Scored[] = []
  for (const tx of txs) {
    if (skip.has(tx.id) || tx.amountMinor <= 0) continue
    const text = searchText(tx.name, tx.merchantName)
    for (const bill of bills) {
      const s = scoreBill(tx, bill, accounts.get(tx.providerAccountRef), text)
      if (s) pairs.push(s)
    }
  }
  const order = (a: Scored, b: Scored) => b.score - a.score || a.days - b.days || a.tx.date.localeCompare(b.tx.date) || a.tx.id.localeCompare(b.tx.id) || `${a.bill.type}:${a.bill.id}:${a.bill.expectedDate}`.localeCompare(`${b.bill.type}:${b.bill.id}:${b.bill.expectedDate}`)
  pairs.sort(order)
  const out = new Map<string, RelationshipSuggestion>()
  const usedBills = new Set<string>()
  const byTx = new Map<string, Scored[]>()
  for (const p of pairs) byTx.set(p.tx.id, [...(byTx.get(p.tx.id) ?? []), p])
  for (const p of pairs) {
    const billKey = `${p.bill.type}:${p.bill.id}:${p.bill.expectedDate}`
    if (out.has(p.tx.id) || usedBills.has(billKey)) continue
    const rivals = (byTx.get(p.tx.id) ?? []).filter(o => o.score === p.score && `${o.bill.type}:${o.bill.id}` !== `${p.bill.type}:${p.bill.id}`)
    if (rivals.length) { // two different bills fit equally well: do not guess
      out.set(p.tx.id, { kind: 'obligation', target: { type: null, id: null, label: null }, confidence: 'low', reasons: [`${rivals.length + 1} known bills fit equally well, so none is suggested. Pick the right one.`] })
      continue
    }
    usedBills.add(billKey)
    out.set(p.tx.id, { kind: 'obligation', target: { type: p.bill.type, id: p.bill.id, label: p.bill.label }, confidence: p.confidence, reasons: p.reasons })
  }
  for (const [id, s] of [...out]) if (!s.target.id) out.delete(id) // an ambiguity note is not a suggestion
  return out
}

// ── transfers ─────────────────────────────────────────────────────────────────────────────────────────────────────
function transferSuggestions(txs: EvidenceTx[], accounts: Map<string, AccountContext>): Map<string, RelationshipSuggestion> {
  const out = new Map<string, RelationshipSuggestion>()
  const strongOf = (t: EvidenceTx) => {
    const d = (t.category?.detailed ?? '').toUpperCase(), p = (t.category?.primary ?? '').toUpperCase()
    return { keyword: TRANSFER_KEYWORD.test(searchText(t.name, t.merchantName)), pfc: p.startsWith('TRANSFER_'), account: d.includes('ACCOUNT_TRANSFER') }
  }
  const outs = txs.filter(t => t.amountMinor > 0).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const ins = txs.filter(t => t.amountMinor < 0)
  const taken = new Set<string>()
  for (const o of outs) {
    const candidates = ins.filter(i => !taken.has(i.id) && i.providerAccountRef !== o.providerAccountRef && i.pending === o.pending && Math.abs(i.amountMinor) === o.amountMinor && daysBetween(i.date, o.date) <= 3)
      .sort((a, b) => daysBetween(a.date, o.date) - daysBetween(b.date, o.date) || a.id.localeCompare(b.id))
    const match = candidates[0]
    if (!match) continue
    taken.add(match.id)
    const a = strongOf(o), b = strongOf(match)
    const signal = a.keyword || b.keyword || a.account || b.account || a.pfc || b.pfc
    const conf: Confidence = signal ? 'high' : 'possible'
    const labelOf = (t: EvidenceTx) => accounts.get(t.providerAccountRef)?.financialAccountName ?? accounts.get(t.providerAccountRef)?.label ?? 'another account'
    out.set(o.id, { kind: 'transfer', target: { type: 'counterpart_tx', id: match.id, label: labelOf(match) }, confidence: conf, reasons: [`An equal ${money(o.amountMinor)} movement arrived in ${labelOf(match)} within ${daysBetween(match.date, o.date)} day(s).`, ...(signal ? ['The description or bank category says transfer.'] : ['Only the equal opposite amounts suggest a transfer.'])] })
    out.set(match.id, { kind: 'transfer', target: { type: 'counterpart_tx', id: o.id, label: labelOf(o) }, confidence: conf, reasons: [`An equal ${money(o.amountMinor)} movement left ${labelOf(o)} within ${daysBetween(match.date, o.date)} day(s).`, ...(signal ? ['The description or bank category says transfer.'] : ['Only the equal opposite amounts suggest a transfer.'])] })
  }
  for (const t of txs) {
    if (out.has(t.id)) continue
    const s = strongOf(t)
    if (s.keyword || s.account) out.set(t.id, { kind: 'transfer', target: { type: null, id: null, label: null }, confidence: 'possible', reasons: ['The description or bank category says transfer, but no matching movement was found in another connected account (it may go to an account that is not connected).'] })
    else if (s.pfc) out.set(t.id, { kind: 'transfer', target: { type: null, id: null, label: null }, confidence: 'low', reasons: ['The bank category looks like a transfer, but that category is also used for payments to people.'] })
  }
  return out
}

/**
 * Money coming IN. Never "high": a deposit's wording cannot prove who paid or why, so these are always an individual owner decision.
 * A refund still needs the owner to pick the original purchase later (BANK-6); here it is only an interpretation.
 */
function inflowBucketFor(tx: EvidenceTx): BucketSuggestion | null {
  const text = searchText(tx.name, tx.merchantName)
  if (REFUND_WORDS.test(text)) return { bucket: 'refund', confidence: 'possible', basis: 'merchant_rule', reasons: ['The description mentions a refund or return. Confirm it, and later link it to the purchase it reverses.'] }
  if (DEPOSIT_WORDS.test(text)) return { bucket: 'customer_payment', confidence: 'possible', basis: 'merchant_rule', reasons: ['A deposit or incoming payment. It may be a customer payment, but the wording alone does not say who paid or for what job.'] }
  return null
}

/** A payment to a credit card moves money to pay a debt. It is never ordinary business spending, so it leaves the spending totals (still unconfirmed). */
function cardPaymentSuggestion(tx: EvidenceTx, text: string): RelationshipSuggestion | null {
  if (tx.amountMinor <= 0) return null
  const pfcCard = (tx.category?.detailed ?? '').toUpperCase().includes('CREDIT_CARD_PAYMENT')
  if (!pfcCard && !CARD_PAYMENT.test(text)) return null
  return { kind: 'transfer', target: { type: null, id: null, label: null }, confidence: 'possible', reasons: ['This looks like a payment to a credit card. Paying a card is not ordinary business spending; the purchases on the card are what count.'] }
}

function debtSuggestion(tx: EvidenceTx, debts: DebtOption[], text: string): RelationshipSuggestion | null {
  if (tx.amountMinor <= 0 || !debts.length) return null
  const pfcLoan = (tx.category?.primary ?? '').toUpperCase().startsWith('LOAN_PAYMENTS')
  const payment = PAYMENT_KEYWORD.test(text) || pfcLoan
  if (!payment) return null
  const txTokens = new Set(distinctiveTokens(text))
  const named = debts.filter(d => distinctiveTokens(d.label).filter(t => t.length >= 4 && !GENERIC_ACCOUNT_WORDS.has(t)).some(t => txTokens.has(t)))
  if (named.length === 1) return { kind: 'debt', target: { type: 'debt_account', id: named[0].id, label: named[0].label }, confidence: pfcLoan ? 'high' : 'possible', reasons: [`The payment text names "${named[0].label}".`] }
  if (!named.length && pfcLoan && debts.length === 1) return { kind: 'debt', target: { type: 'debt_account', id: debts[0].id, label: debts[0].label }, confidence: 'low', reasons: [`The bank calls this a loan or card payment and "${debts[0].label}" is your only debt account.`] }
  return null
}

function payrollSuggestion(tx: EvidenceTx, text: string): RelationshipSuggestion | null {
  if (tx.amountMinor <= 0) return null
  if (PAYROLL_PROCESSORS.test(text)) return { kind: 'payroll', target: { type: null, id: null, label: null }, confidence: 'high', reasons: ['The merchant is a payroll provider.'] }
  if (PAYROLL_GENERIC.test(text)) return { kind: 'payroll', target: { type: null, id: null, label: null }, confidence: 'possible', reasons: ['The description mentions payroll.'] }
  return null
}

/** Explicit project context only: the transaction's OWN text must name the project. Merchant history is never consulted here. */
function projectSuggestion(text: string, projects: ProjectOption[]): RelationshipSuggestion | null {
  const hits = projects.filter(p => {
    const name = normalizeText(p.name)
    if (name.length < 5 || !/\s|^.{6,}$/.test(name)) return false
    return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)
  })
  if (hits.length !== 1) return null
  return { kind: 'project', target: { type: 'project', id: hits[0].id, label: hits[0].name }, confidence: 'possible', reasons: [`The description names the project "${hits[0].name}". Confirm it before it counts.`] }
}

const rejectedKey = (d: Decision) => d.kind === 'category' ? `bucket:${d.category}` : `rel:${d.kind}:${d.obligationId ?? d.commitmentId ?? d.projectId ?? d.debtAccountId ?? ''}`

/**
 * One deterministic pass over all evidence. Returns at most one bucket and one relationship suggestion per transaction, with owner-rejected
 * suggestions suppressed. Removed evidence is never classified.
 */
export function classifyAll(input: ClassifierInput): Map<string, TxSuggestion> {
  const live = input.txs.filter(t => !t.removed).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const history = buildMerchantHistory(live, input.decisions)
  const rejected = new Map<string, Set<string>>()
  for (const d of input.decisions) if (d.status === 'rejected') rejected.set(d.txId, new Set([...(rejected.get(d.txId) ?? []), rejectedKey(d)]))

  const transfers = transferSuggestions(live, input.accounts)
  const relationships = new Map<string, RelationshipSuggestion>()
  const claimed = new Set<string>()
  for (const tx of live) {
    const text = searchText(tx.name, tx.merchantName)
    const t = transfers.get(tx.id)
    if (t) { relationships.set(tx.id, t); claimed.add(tx.id); continue }
    const rel = debtSuggestion(tx, input.debts, text) ?? payrollSuggestion(tx, text) ?? cardPaymentSuggestion(tx, text)
    if (rel) { relationships.set(tx.id, rel); claimed.add(tx.id) }
  }
  for (const [id, s] of matchKnownBills(live, input.accounts, input.bills, claimed)) relationships.set(id, s)
  for (const tx of live) {
    if (relationships.has(tx.id) || tx.amountMinor <= 0) continue
    const p = projectSuggestion(searchText(tx.name, tx.merchantName), input.projects)
    if (p) relationships.set(tx.id, p)
  }

  const out = new Map<string, TxSuggestion>()
  for (const tx of live) {
    let bucket: BucketSuggestion | null = tx.amountMinor > 0 ? bucketFor(tx, history, input.ownerRules) : tx.amountMinor < 0 ? inflowBucketFor(tx) : null
    const relationship = relationships.get(tx.id) ?? null
    if (relationship?.kind === 'transfer') bucket = { bucket: 'transfers', confidence: relationship.confidence, basis: 'transfer', reasons: ['It looks like a movement between accounts.'] }
    else if (relationship?.kind === 'payroll' && !bucket) bucket = { bucket: 'payroll_people', confidence: relationship.confidence, basis: 'payroll', reasons: ['It looks like payroll.'] }
    const rej = rejected.get(tx.id)
    if (bucket && rej?.has(`bucket:${bucket.bucket}`)) bucket = null
    const rel = relationship && !(rej?.has(`rel:${relationship.kind}:${relationship.target.id ?? ''}`)) ? relationship : null
    out.set(tx.id, { bucket, relationship: rel })
  }
  return out
}

export const confidenceAtLeast = (c: Confidence | null | undefined, min: Confidence): boolean => !!c && CONFIDENCE_RANK[c] >= CONFIDENCE_RANK[min]
export { OTHER_BUCKET }
