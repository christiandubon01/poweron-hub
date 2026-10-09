export * from '../../../finance/bankSpendingHierarchy'
import { defaultHierarchy, type SpendingHierarchy } from '../../../finance/bankSpendingHierarchy'
import { isBucketKey } from './taxonomy'

type Svc = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> }
/** Single-statement registry read. A missing new migration is safe: built-ins remain fully readable. */
export async function loadSpendingHierarchy(svc: Svc, organizationId: string): Promise<SpendingHierarchy> {
  const { data, error } = await svc.rpc('bank_spending_read_hierarchy', { p_organization_id: organizationId })
  if (error) {
    if (['42883', 'PGRST202'].includes(error.code)) return defaultHierarchy()
    throw new Error('Category definitions could not be loaded.')
  }
  return decodeSpendingHierarchy(Array.isArray(data) ? data[0]?.bank_spending_read_hierarchy ?? data[0] : data)
}
export function decodeSpendingHierarchy(raw: any): SpendingHierarchy {
  if (!raw || !Array.isArray(raw.parents) || !Array.isArray(raw.categories)) return defaultHierarchy()
  const base = defaultHierarchy()
  const cats = new Map(base.categories.map(c => [c.key, c]))
  for (const c of raw.categories) cats.set(c.key, { key: c.key, name: c.name, parentKey: c.parent_key, builtin: isBucketKey(c.key), archived: c.archived })
  // Default parent membership exists only before initialization. Afterwards a null parent is intentional.
  return { available: true, writesEnabled: raw.writes_enabled === true,
    parents: raw.parents.map((p: any) => ({ key: p.key, name: p.name, color: p.color, archived: p.archived })), categories: [...cats.values()] }
}
