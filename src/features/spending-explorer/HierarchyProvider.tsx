import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { categoryOptions, defaultHierarchy, type SpendingHierarchy } from '@/finance/bankSpendingHierarchy'
import { parentColorKey } from '@/features/display-colors/hierarchyColors'
import { useDisplayColors } from '@/features/display-colors/DisplayColors'

export interface DefinitionEdit { type: 'parent' | 'category'; key?: string; name: string; parentKey?: string | null; color?: string | null; archived?: boolean }
export type DefinitionSave = (edit: DefinitionEdit) => Promise<string>
interface State { hierarchy: SpendingHierarchy; save: DefinitionSave; refresh: () => void }
const Context = createContext<State>({ hierarchy: defaultHierarchy(), save: async () => { throw new Error('Classification management is unavailable.') }, refresh: () => {} })
export const useHierarchy = () => useContext(Context)
async function browserSave(edit: DefinitionEdit): Promise<string> {
  const { supabase } = await import('@/lib/supabase')
  const { data, error } = await (supabase as any).rpc('bank_spending_manage_definition', {
    p_type: edit.type, p_key: edit.key ?? null, p_name: edit.name.trim(), p_parent_key: edit.parentKey ?? null, p_color: edit.color ?? null, p_archived: edit.archived ?? false,
  })
  if (error?.code === '23505') throw new Error('That name is already used in this organization. Choose a distinct name.')
  if (error || typeof data !== 'string') throw new Error('Could not save classification. Refresh and check its name, parent and management availability.')
  return data
}
export function HierarchyProvider({ value, onChanged, saveDefinition = browserSave, children }: { value?: SpendingHierarchy; onChanged?: () => void; saveDefinition?: DefinitionSave; children: ReactNode }) {
  const [hierarchy, setHierarchy] = useState(value ?? defaultHierarchy())
  const colors = useDisplayColors()
  useEffect(() => setHierarchy(value ?? defaultHierarchy()), [value])
  const save: DefinitionSave = async edit => {
    if (!hierarchy.available || !hierarchy.writesEnabled) throw new Error('Classification management has not been enabled.')
    const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()
    const definitions = edit.type === 'parent' ? hierarchy.parents : hierarchy.categories
    if (definitions.some(d => d.key !== edit.key && normalize(d.name) === normalize(edit.name))) throw new Error('That name is already used in this organization. Choose a distinct name.')
    const key = await saveDefinition(edit)
    if (edit.type === 'category') colors.acceptSavedCategoryColor(key, edit.color ?? null)
    else await colors.setColor('category', parentColorKey(key), edit.color ?? null)
    setHierarchy(prev => {
      if (edit.type === 'parent') {
        const old = prev.parents.find(p => p.key === key), item = { key, name: edit.name.trim(), color: edit.color ?? null, archived: edit.archived ?? false }
        return { ...prev, parents: old ? prev.parents.map(p => p.key === key ? item : p) : [...prev.parents, item] }
      }
      const old = prev.categories.find(c => c.key === key), item = { key, name: edit.name.trim(), parentKey: edit.parentKey ?? null, archived: edit.archived ?? false, builtin: old?.builtin ?? false }
      return { ...prev, categories: old ? prev.categories.map(c => c.key === key ? item : c) : [...prev.categories, item] }
    })
    // Creation never confirms a transaction. Caller retains its separate draft/Apply decision.
    onChanged?.()
    return key
  }
  return <Context.Provider value={{ hierarchy, save, refresh: () => onChanged?.() }}>{children}</Context.Provider>
}
export { categoryOptions }
