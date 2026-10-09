import type { SpendingHierarchy } from '@/finance/bankSpendingHierarchy'
import { SWATCHES } from './palette'

/** Reserved display-only keys in the existing organization color store; never category assignments. */
export const parentColorKey = (key: string): string => `parent_${key.startsWith('custom_') ? key.slice(7) : key}`
export function parentDisplayColor(key: string, hierarchy: SpendingHierarchy, categoryColor: (key: string) => string | null): string {
  const parent = hierarchy.parents.find(p => p.key === key)
  const saved = categoryColor(parentColorKey(key))
  if (saved) return saved
  if (parent?.color) return parent.color // existing hierarchy colors remain readable
  const inherited = hierarchy.categories.filter(c => c.parentKey === key).map(c => categoryColor(c.key)).find(Boolean)
  if (inherited) return inherited
  // Palette fallback is display-only: no automatic writes or financial meaning.
  const hash = [...key].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0)
  return SWATCHES[hash % SWATCHES.length].hex
}
