import { describe, expect, it } from 'vitest'
import { entryType, type EntryLike } from './entryType'

const e = (direction: EntryLike['direction'], bucket: [string | null, EntryLike['bucket']['state']], rel: [string, EntryLike['relationship']['state']] = ['unknown', 'none']): EntryLike =>
  ({ direction, bucket: { key: bucket[0], state: bucket[1] }, relationship: { kind: rel[0], state: rel[1] } })

describe('BANK-6E entry type (display only, never from the amount sign alone)', () => {
  it('confirmed interpretations are stated plainly', () => {
    expect(entryType(e('money_in', ['customer_payment', 'confirmed']))).toMatchObject({ kind: 'income', label: 'Income', tone: 'in', glyph: '↓', certain: true })
    expect(entryType(e('money_in', ['refund', 'confirmed']))).toMatchObject({ kind: 'refund', label: 'Refund', glyph: '↩' })
    expect(entryType(e('money_out', ['materials', 'confirmed']))).toMatchObject({ kind: 'expense', label: 'Expense', tone: 'out', glyph: '↑' })
    expect(entryType(e('money_out', ['materials', 'suggested'], ['transfer', 'confirmed']))).toMatchObject({ kind: 'transfer', label: 'Transfer', tone: 'neutral', glyph: '⇄' })
    expect(entryType(e('money_out', [null, 'none'], ['debt', 'confirmed']))).toMatchObject({ kind: 'debt_payment', label: 'Debt payment' })
    expect(entryType(e('money_out', ['owner_draw', 'confirmed']))).toMatchObject({ kind: 'owner_draw', label: 'Owner draw' })
  })

  it('a kind that rests on a suggestion is "Likely …", never stated as fact', () => {
    expect(entryType(e('money_in', ['customer_payment', 'suggested']))).toMatchObject({ kind: 'income', label: 'Likely income', certain: false })
    expect(entryType(e('money_out', ['transfers', 'suggested'], ['transfer', 'suggested']))).toMatchObject({ label: 'Likely transfer', certain: false })
    expect(entryType(e('money_out', [null, 'none'], ['payroll', 'suggested']))).toMatchObject({ label: 'Likely payroll' })
  })

  it('the amount sign alone never makes income or an expense: unclassified money is only "Money in" / "Money out"', () => {
    expect(entryType(e('money_in', [null, 'none']))).toMatchObject({ kind: 'money_in', label: 'Money in' })
    expect(entryType(e('money_out', ['other_needs_review', 'none']))).toMatchObject({ kind: 'money_out', label: 'Money out' })
    expect(entryType(e('money_out', ['materials', 'suggested']))).toMatchObject({ kind: 'money_out', label: 'Money out' }) // a suggested category is not yet an expense
    expect(entryType(e('money_in', ['transfers', 'confirmed']))).toMatchObject({ kind: 'transfer' }) // money IN can be a transfer, not income
    expect(entryType(e('zero', [null, 'none']))).toMatchObject({ kind: 'zero', tone: 'neutral' })
  })

  it('confirmed decisions outrank suggestions', () => {
    expect(entryType(e('money_out', ['materials', 'confirmed'], ['transfer', 'suggested']))).toMatchObject({ kind: 'expense', certain: true })
    expect(entryType(e('money_in', ['refund', 'suggested'], ['transfer', 'confirmed']))).toMatchObject({ kind: 'transfer', certain: true })
  })
})
