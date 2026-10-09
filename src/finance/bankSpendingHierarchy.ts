import { BUCKETS, BATCH_APPROVABLE_BUCKETS, bucketLabel, isBucketKey } from './bankSpendingTaxonomy'

export interface ParentBucket { key: string; name: string; color: string | null; archived: boolean }
export interface CategoryDefinition { key: string; name: string; parentKey: string | null; builtin: boolean; archived: boolean }
export interface SpendingHierarchy { parents: ParentBucket[]; categories: CategoryDefinition[]; available: boolean; writesEnabled: boolean }
export const DEFINITION_KEY = /^[a-z][a-z_]{1,39}$/
const DEFAULT_PARENTS = [
  ['vehicle', 'Vehicle Expenses', 'fuel_vehicle'], ['overhead', 'Business Overhead', 'bank_finance_fees,software_subscriptions,office_admin'],
  ['materials', 'Materials & Supplies', 'materials'], ['tools', 'Tools & Equipment', 'tools_equipment'], ['insurance', 'Insurance & Protection', 'insurance'],
  ['people', 'People & Payroll', 'payroll_people'], ['permits', 'Permits & Licensing', 'permits_fees'], ['marketing', 'Marketing', 'marketing'],
  ['meals', 'Meals', 'meals'], ['taxes', 'Taxes', 'taxes'], ['personal', 'Personal & Owner', 'personal_owner,owner_draw'],
  ['movement', 'Money Movement', 'transfers'], ['income', 'Money In', 'customer_payment,refund'],
] as const
export function defaultHierarchy(): SpendingHierarchy {
  return { available: false, writesEnabled: false,
    parents: DEFAULT_PARENTS.map(([key, name]) => ({ key, name, color: null, archived: false })),
    categories: BUCKETS.map(b => ({ key: b.key, name: b.label, parentKey: DEFAULT_PARENTS.find(p => p[2].split(',').includes(b.key))?.[0] ?? null, builtin: true, archived: false })) }
}
export function categoryName(key: string | null, hierarchy?: SpendingHierarchy): string {
  return hierarchy?.categories.find(c => c.key === key)?.name ?? bucketLabel(key)
}
export function categoryOptions(h: SpendingHierarchy) {
  return h.categories.filter(c => !c.archived).map(c => {
    const builtin = BUCKETS.find(b => b.key === c.key)
    return { key: c.key, label: c.name, hint: builtin?.hint ?? 'Owner-created expense category', flow: ((builtin as { flow?: 'in' } | undefined)?.flow ?? 'out') as 'in' | 'out', parentKey: c.parentKey, builtin: c.builtin }
  })
}
/** Custom categories require the reviewed registry and an explicit write gate. Never inferred from a name. */
export function canAssign(key: unknown, h: SpendingHierarchy): key is string {
  if (isBucketKey(key)) return true
  return typeof key === 'string' && h.available && h.writesEnabled && h.categories.some(c => c.key === key && !c.builtin && !c.archived)
}
export function explicitBatchKeys(h: SpendingHierarchy): string[] {
  return [...BATCH_APPROVABLE_BUCKETS, ...(h.available && h.writesEnabled ? h.categories.filter(c => !c.builtin && !c.archived).map(c => c.key) : [])]
}

