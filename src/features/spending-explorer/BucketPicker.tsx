/**
 * src/features/spending-explorer/BucketPicker.tsx
 *
 * BANK-6E: the category ("bucket") picker. Since BANK-6F it is a thin wrapper around the shared ChoiceSheet, with the same behaviour: picking a row
 * only moves a draft; "Apply" hands the chosen key to the caller, which sends the SAME existing decision as before (set_bucket) or, in a review, only
 * changes the unsaved draft. Cancel / Escape / the backdrop close it with nothing sent. The options are exactly the categories the caller passes (no
 * invented buckets), already filtered by the caller.
 */
import type { ReactNode } from 'react'
import { Tag } from 'lucide-react'
import { CategoryDot } from '@/features/display-colors/DisplayColors'
import { ChoiceSheet, type ChoiceGroup } from './ChoiceSheet'

export interface BucketOption { key: string; label: string; hint?: string; flow?: 'in' | 'out' }

const GROUPS: ChoiceGroup[] = [
  { id: 'everyday', title: 'Everyday business expenses', keys: ['materials', 'fuel_vehicle', 'tools_equipment', 'software_subscriptions', 'insurance', 'permits_fees', 'marketing', 'meals', 'office_admin', 'bank_finance_fees', 'taxes'] },
  { id: 'people', title: 'People and owner', keys: ['payroll_people', 'personal_owner', 'owner_draw'] },
  { id: 'in', title: 'Money in', keys: ['customer_payment', 'refund'] },
  { id: 'movement', title: 'Money movement', keys: ['transfers'] },
  { id: 'unsure', title: 'Not sure yet', keys: ['other_needs_review'] },
]

export function BucketPicker({ open, options, currentKey, suggestedKey, title = 'Choose a category', context, onApply, onClose, onClear, busy, applyLabel, idleNote, changeNote, eyebrow = 'Category' }: {
  open: boolean
  options: BucketOption[]
  currentKey: string | null
  suggestedKey?: string | null
  title?: string
  /** One line identifying the transaction, e.g. "CHEVRON · −$62.10 · Oct 7". */
  context?: string
  onApply: (key: string) => void
  onClose: () => void
  onClear?: () => void
  busy?: boolean
  applyLabel?: string
  idleNote?: string
  changeNote?: (to: string, from: string | null) => ReactNode
  eyebrow?: string
}) {
  return <ChoiceSheet open={open} testId="bucket-picker" groups={GROUPS} title={title} eyebrow={eyebrow} icon={<Tag size={18} />} context={context}
    options={options.map(o => ({ key: o.key, label: o.label, hint: o.hint, leading: <CategoryDot categoryKey={o.key} className="!h-3 !w-3" /> }))}
    currentKey={currentKey} suggestedKey={suggestedKey} onApply={onApply} onClose={onClose} onClear={onClear} busy={busy} applyLabel={applyLabel} changeNote={changeNote}
    idleNote={idleNote ?? 'Pick a category, then Apply. This only labels the bank record.'} searchLabel="Search categories" emptyText="No category matches" />
}
