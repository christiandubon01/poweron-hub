export type WorkPackageVisibilityRecord = {
  id: string
  visible?: unknown
  updatedAt?: string
  deletedAt?: string
}

export function resolveWorkPackageVisible(value: unknown): boolean {
  return value === false ? false : true
}

function hasDeletedAt(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function hiddenIdsFromWorkPackages<T extends WorkPackageVisibilityRecord>(packages: readonly T[]): Set<string> {
  const hiddenIds = new Set<string>()
  packages.forEach((pkg) => {
    const id = String(pkg.id || '').trim()
    if (!id || hasDeletedAt(pkg.deletedAt)) return
    if (!resolveWorkPackageVisible(pkg.visible)) hiddenIds.add(id)
  })
  return hiddenIds
}

export function applyWorkPackageVisibility<T extends WorkPackageVisibilityRecord>(
  packages: readonly T[],
  packageId: string,
  visible: boolean,
  timestamp: string,
): { changed: boolean; packages: T[] } {
  const cleanId = String(packageId || '').trim()
  if (!cleanId) return { changed: false, packages: [...packages] }
  let changed = false
  const nextPackages = packages.map((pkg) => {
    if (pkg.id !== cleanId || hasDeletedAt(pkg.deletedAt)) return pkg
    changed = true
    return {
      ...pkg,
      visible,
      updatedAt: timestamp,
    }
  })
  return { changed, packages: nextPackages }
}
