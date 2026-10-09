/**
 * src/features/spending-explorer/entryType.ts
 *
 * BANK-6E: what KIND of money movement an entry is, for display only. It never decides anything and never changes a category, relationship or
 * balance. The kind comes from the owner's (or the engine's) interpretation, NOT from the amount sign alone:
 *   - a transfer relationship or the Transfers category                -> Transfer        (neither income nor expense)
 *   - the Refund category                                              -> Refund          (money back, not income)
 *   - the Customer payment category                                    -> Income
 *   - a debt relationship / owner draw / payroll                       -> Debt payment / Owner draw / Payroll
 *   - a confirmed everyday category on money going out                 -> Expense
 *   - otherwise only the direction is known                            -> Money in / Money out (honestly "unclassified")
 * A kind that rests on a SUGGESTION is labelled "Likely …" so a guess never reads as a fact.
 */
export type EntryKind = 'income' | 'refund' | 'transfer' | 'expense' | 'debt_payment' | 'owner_draw' | 'payroll' | 'money_in' | 'money_out' | 'zero'
export type EntryTone = 'in' | 'out' | 'neutral'
export interface EntryType { kind: EntryKind; label: string; glyph: string; tone: EntryTone; certain: boolean }

type State = 'confirmed' | 'suggested' | 'none'
export interface EntryLike {
  direction: 'money_out' | 'money_in' | 'zero'
  bucket: { key: string | null; state: State }
  relationship: { kind: string; state: State }
}

const BASE: Record<EntryKind, { label: string; glyph: string; tone: EntryTone }> = {
  income: { label: 'Income', glyph: '↓', tone: 'in' },
  refund: { label: 'Refund', glyph: '↩', tone: 'in' },
  transfer: { label: 'Transfer', glyph: '⇄', tone: 'neutral' },
  expense: { label: 'Expense', glyph: '↑', tone: 'out' },
  debt_payment: { label: 'Debt payment', glyph: '↑', tone: 'out' },
  owner_draw: { label: 'Owner draw', glyph: '↑', tone: 'out' },
  payroll: { label: 'Payroll', glyph: '↑', tone: 'out' },
  money_in: { label: 'Money in', glyph: '↓', tone: 'in' },
  money_out: { label: 'Money out', glyph: '↑', tone: 'out' },
  zero: { label: 'No amount', glyph: '·', tone: 'neutral' },
}
const make = (kind: EntryKind, certain: boolean): EntryType => {
  const b = BASE[kind]
  const likely = !certain && kind !== 'money_in' && kind !== 'money_out' && kind !== 'zero'
  return { kind, glyph: b.glyph, tone: b.tone, certain, label: likely ? `Likely ${b.label.toLowerCase()}` : b.label }
}
const EVERYDAY = new Set(['materials', 'fuel_vehicle', 'tools_equipment', 'software_subscriptions', 'insurance', 'permits_fees', 'marketing', 'meals', 'office_admin', 'bank_finance_fees', 'taxes', 'personal_owner'])

export function entryType(e: EntryLike): EntryType {
  if (e.direction === 'zero') return make('zero', true)
  const rel = e.relationship.state !== 'none' ? e.relationship : null
  const bucket = e.bucket.state !== 'none' ? e.bucket : null
  // Confirmed decisions first, then suggestions; within each, the relationship (what it belongs to) before the category.
  for (const certain of [true, false]) {
    const want = certain ? 'confirmed' : 'suggested'
    if (rel?.state === want) {
      if (rel.kind === 'transfer') return make('transfer', certain)
      if (rel.kind === 'debt') return make('debt_payment', certain)
      if (rel.kind === 'payroll') return make('payroll', certain)
    }
    if (bucket?.state === want && bucket.key) {
      if (bucket.key === 'transfers') return make('transfer', certain)
      if (bucket.key === 'refund' && e.direction === 'money_in') return make('refund', certain)
      if (bucket.key === 'customer_payment' && e.direction === 'money_in') return make('income', certain)
      if (bucket.key === 'owner_draw' && e.direction === 'money_out') return make('owner_draw', certain)
      if (bucket.key === 'payroll_people' && e.direction === 'money_out') return make('payroll', certain)
      if (certain && EVERYDAY.has(bucket.key) && e.direction === 'money_out') return make('expense', true)
    }
  }
  return make(e.direction === 'money_in' ? 'money_in' : 'money_out', true)
}

/** Amount styling by tone (subtle): money in uses the cash color, money out the normal text color, transfers the secondary color. */
export const toneColor = (tone: EntryTone): string | undefined => (tone === 'in' ? 'var(--fin-cash)' : tone === 'neutral' ? 'var(--text-secondary)' : undefined)
