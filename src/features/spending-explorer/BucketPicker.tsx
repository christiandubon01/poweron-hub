/**
 * src/features/spending-explorer/BucketPicker.tsx
 *
 * BANK-6E: the category ("bucket") picker. Since BANK-6F it is a thin wrapper around the shared ChoiceSheet, with the same behaviour: picking a row
 * only moves a draft; "Apply" hands the chosen key to the caller, which sends the SAME existing decision as before (set_bucket) or, in a review, only
 * changes the unsaved draft. Cancel / Escape / the backdrop close it with nothing sent. The options are exactly the categories the caller passes (no
 * invented buckets), already filtered by the caller.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Tag } from 'lucide-react'
import { CategoryDot } from '@/features/display-colors/DisplayColors'
import { ChoiceSheet, type ChoiceGroup } from './ChoiceSheet'
import { categoryOptions, useHierarchy } from './HierarchyProvider'
import { DefinitionForm } from './HierarchyManager'
import { btn } from './ui'

export interface BucketOption { key: string; label: string; hint?: string; flow?: 'in' | 'out' }

const GROUPS: ChoiceGroup[] = [
  { id: 'everyday', title: 'Everyday business expenses', keys: ['materials', 'fuel_vehicle', 'tools_equipment', 'software_subscriptions', 'insurance', 'permits_fees', 'marketing', 'meals', 'office_admin', 'bank_finance_fees', 'taxes'] },
  { id: 'people', title: 'People and owner', keys: ['payroll_people', 'personal_owner', 'owner_draw'] },
  { id: 'in', title: 'Money in', keys: ['customer_payment', 'refund'] },
  { id: 'movement', title: 'Money movement', keys: ['transfers'] },
  { id: 'unsure', title: 'Not sure yet', keys: ['other_needs_review'] },
]

export function BucketPicker({ open, options, currentKey, suggestedKey, title = 'Choose a category', context, onApply, onClose, onClear, busy, applyLabel, idleNote, changeNote, eyebrow = 'Category', allowCustom = true }: {
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
  allowCustom?: boolean
}) {
  const { hierarchy } = useHierarchy()
  const creationPanel = useRef<HTMLDivElement>(null)
  const [creating, setCreating] = useState<'category' | 'parent' | null>(null), [created, setCreated] = useState<string | null>(null)
  useEffect(() => { if (!open) { setCreating(null); setCreated(null) } }, [open])
  const canCreate = allowCustom && hierarchy.available && hierarchy.writesEnabled
  const additions = allowCustom ? categoryOptions(hierarchy).filter(o => !o.builtin && !options.some(x => x.key === o.key)) : []
  const available = hierarchy.available ? [...options.map(o => ({ ...o, label: hierarchy.categories.find(c => c.key === o.key)?.name ?? o.label })).filter(o => !hierarchy.categories.find(c => c.key === o.key)?.archived), ...additions] : options
  const groups = hierarchy.available ? hierarchy.parents.filter(p => !p.archived).map(p => ({ id: p.key, title: p.name, keys: hierarchy.categories.filter(c => c.parentKey === p.key).map(c => c.key) })) : GROUPS
  if (open && creating) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Create reusable classification" onKeyDown={e => {
    if (e.key === 'Escape') setCreating(null)
    if (e.key === 'Tab') {
      const focusable = [...(creationPanel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled])') ?? [])]
      if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable[focusable.length-1]?.focus() }
      else if (!e.shiftKey && document.activeElement === focusable[focusable.length-1]) { e.preventDefault(); focusable[0]?.focus() }
    }
  }}><div ref={creationPanel} className="max-h-[88dvh] w-full max-w-lg overflow-auto rounded-xl bg-[var(--bg-card)]"><DefinitionForm initial={{ type: creating, name: '' }} onClose={() => setCreating(null)} onSaved={key => { if (creating === 'category') setCreated(key); setCreating(null) }} /></div></div>
  return <ChoiceSheet open={open} testId="bucket-picker" groups={groups} title={title} eyebrow={eyebrow} icon={<Tag size={18} />} context={context}
    options={available.map(o => ({ key: o.key, label: o.label, hint: o.hint, leading: <CategoryDot categoryKey={o.key} className="!h-3 !w-3" /> }))}
    initialDraftKey={created} extra={canCreate ? <div className="flex flex-wrap gap-2"><button className={btn} type="button" disabled={busy} onClick={() => setCreating('category')}>+ Create new category</button><button className={btn} type="button" disabled={busy} onClick={() => setCreating('parent')}>+ Create parent bucket</button></div> : allowCustom && hierarchy.available ? <p className="text-xs text-[var(--text-secondary)]">Custom category creation awaits owner approval. Existing categories remain available.</p> : undefined}
    currentKey={currentKey} suggestedKey={suggestedKey} onApply={onApply} onClose={onClose} onClear={onClear} busy={busy} applyLabel={applyLabel} changeNote={changeNote}
    idleNote={idleNote ?? 'Pick a category, then Apply. This only labels the bank record.'} searchLabel="Search categories" emptyText="No category matches" />
}
