import { useHierarchy } from './HierarchyProvider'
import { useDisplayColors } from '@/features/display-colors/DisplayColors'
import { parentDisplayColor } from '@/features/display-colors/hierarchyColors'
export function ParentBucketTag({ categoryKey }: { categoryKey: string | null | undefined }) {
  const { hierarchy } = useHierarchy(), { categoryColor } = useDisplayColors()
  const category = hierarchy.categories.find(c => c.key === categoryKey)
  const parent = hierarchy.parents.find(p => p.key === category?.parentKey)
  if (!hierarchy.available || !parent) return null
  return <span className="inline-flex max-w-full items-center gap-1.5 text-[11px] text-[var(--text-secondary)]" data-testid="parent-bucket-tag"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: parentDisplayColor(parent.key, hierarchy, categoryColor) }} /><span className="truncate">Parent: {parent.name}</span><span aria-hidden="true">›</span></span>
}
