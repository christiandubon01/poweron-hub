/**
 * src/services/spending/taxonomy.ts
 *
 * BANK-5 vocabulary. Three INDEPENDENT dimensions describe a provider transaction (PLAID TRANSACTION = EVIDENCE, NOT TRUTH):
 *   1. ECONOMIC BUCKET  - what was this money for?  (stored as an interpretation of kind 'category'; the key is just TEXT, so buckets
 *                          can be added or renamed later without rewriting any transaction evidence)
 *   2. RELATIONSHIP     - what does it belong to?   (obligation / project / debt / payroll / transfer / overhead / personal; "unknown" is the
 *                          ABSENCE of a decision)
 *   3. REVIEW STATE     - how certain/approved is it? (derived: suggested / confirmed / needs_review / ignored)
 * Confidence (high / possible / low) is a fourth, separate fact about a SUGGESTION, never a review state.
 */

export interface BucketDef {
  key: string
  label: string
  /** Counts toward "money bleeding" (discretionary / untracked) when unassigned. Operating costs like materials and fuel do not. */
  discretionary: boolean
  /** Short owner-facing hint for pickers. */
  hint: string
  /** Which direction of money this bucket describes. Omitted = money OUT (an expense-like use of money). */
  flow?: 'in'
}

export const BUCKETS = [
  { key: 'materials', label: 'Materials', discretionary: false, hint: 'Job materials and supplies' },
  { key: 'fuel_vehicle', label: 'Fuel / Vehicle', discretionary: false, hint: 'Fuel, repairs, tolls, parking' },
  { key: 'tools_equipment', label: 'Tools & Equipment', discretionary: true, hint: 'Tools, meters, equipment' },
  { key: 'software_subscriptions', label: 'Software / Subscriptions', discretionary: true, hint: 'Apps, SaaS, memberships' },
  { key: 'insurance', label: 'Insurance', discretionary: false, hint: 'Business, vehicle, liability, workers comp' },
  { key: 'payroll_people', label: 'Payroll / People', discretionary: false, hint: 'Wages, payroll providers, contractors' },
  { key: 'permits_fees', label: 'Permits & Fees', discretionary: false, hint: 'Permits, licenses, government fees' },
  { key: 'marketing', label: 'Marketing', discretionary: true, hint: 'Ads, lead services, print' },
  { key: 'meals', label: 'Meals', discretionary: true, hint: 'Food and drink' },
  { key: 'office_admin', label: 'Office / Admin', discretionary: true, hint: 'Office supplies, shipping, utilities' },
  { key: 'bank_finance_fees', label: 'Bank / Finance Fees', discretionary: true, hint: 'Bank, card and finance charges' },
  { key: 'personal_owner', label: 'Personal / Owner', discretionary: false, hint: 'Owner personal spending' },
  { key: 'taxes', label: 'Taxes', discretionary: false, hint: 'Income, payroll and sales taxes' },
  { key: 'transfers', label: 'Transfers', discretionary: false, hint: 'Moving money between accounts' },
  { key: 'owner_draw', label: 'Owner draw', discretionary: false, hint: 'Money taken out by the owner (not a business expense)' },
  { key: 'customer_payment', label: 'Customer payment', discretionary: false, hint: 'Money received from a customer', flow: 'in' },
  { key: 'refund', label: 'Refund', discretionary: false, hint: 'Money returned to you for an earlier purchase', flow: 'in' },
  { key: 'other_needs_review', label: 'Other / Needs Review', discretionary: false, hint: 'Not classified yet (unknown is not waste)' },
] as const satisfies readonly BucketDef[]

export type BucketKey = (typeof BUCKETS)[number]['key']
export const BUCKET_KEYS: readonly string[] = BUCKETS.map(b => b.key)
export const OTHER_BUCKET: BucketKey = 'other_needs_review'
export const bucketLabel = (key: string | null | undefined): string => BUCKETS.find(b => b.key === key)?.label ?? 'Other / Needs Review'
export const isBucketKey = (v: unknown): v is BucketKey => typeof v === 'string' && BUCKET_KEYS.includes(v)
/**
 * Buckets a SELECTED-BATCH approval may confirm: ordinary operating-expense categories only, and only from a HIGH-confidence suggestion.
 * Everything that moves money-meaning (payroll, personal, transfers, owner draws) or describes money coming IN (customer payments, refunds)
 * is always an individual decision: a merchant name alone never confirms those.
 */
export const BATCH_APPROVABLE_BUCKETS: readonly string[] = ['materials', 'fuel_vehicle', 'tools_equipment', 'software_subscriptions', 'insurance', 'permits_fees', 'marketing', 'meals', 'office_admin', 'bank_finance_fees', 'taxes']
/** Money-IN buckets fit only money in; expense-like buckets do not describe a deposit (except transfers, personal/owner money and "unknown"). */
export const bucketFitsDirection = (key: string, direction: Direction): boolean => {
  const inBucket = (BUCKETS as readonly BucketDef[]).find(b => b.key === key)?.flow === 'in'
  if (direction === 'money_in') return inBucket || key === 'transfers' || key === 'personal_owner' || key === OTHER_BUCKET
  return !inBucket
}
/** Unknown / unclassified spending is never discretionary: it stays visible for review but is not labelled leakage. */
export const isDiscretionary = (key: string): boolean => BUCKETS.find(b => b.key === key)?.discretionary ?? false
/** Buckets where a repeating charge reasonably looks like a bill or subscription. */
export const SUBSCRIPTION_BUCKETS: readonly string[] = ['software_subscriptions', 'insurance']

export const RELATIONSHIP_KINDS = ['obligation', 'project', 'debt', 'payroll', 'transfer', 'overhead', 'personal'] as const
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number]
export const isRelationshipKind = (v: unknown): v is RelationshipKind => typeof v === 'string' && (RELATIONSHIP_KINDS as readonly string[]).includes(v)
export const RELATIONSHIP_LABELS: Record<RelationshipKind | 'unknown', string> = {
  obligation: 'Known bill', project: 'Project', debt: 'Debt payment', payroll: 'Payroll', transfer: 'Transfer',
  overhead: 'General overhead', personal: 'Personal', unknown: 'Unknown',
}
/** Relationships that mean "this money is already accounted for by something Cash OS knows" (so it is not unassigned spending). */
export const KNOWN_MONEY_KINDS: readonly RelationshipKind[] = ['obligation', 'debt', 'payroll', 'transfer']

export type Confidence = 'high' | 'possible' | 'low'
export const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, possible: 2, low: 1 }
export type ReviewState = 'suggested' | 'confirmed' | 'needs_review' | 'ignored'
export type Direction = 'money_out' | 'money_in' | 'zero'
