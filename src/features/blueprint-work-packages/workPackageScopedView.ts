export type WorkPackageScopedViewRecord = {
  id: string
  isolated?: unknown
  updatedAt?: string
  deletedAt?: string
}

function hasDeletedAt(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function isWorkPackageScoped(layer: WorkPackageScopedViewRecord): boolean {
  return !hasDeletedAt(layer.deletedAt) && layer.isolated === true
}

export function scopedIdsFromWorkPackages<T extends WorkPackageScopedViewRecord>(packages: readonly T[]): Set<string> {
  const scopedIds = new Set<string>()
  packages.forEach((pkg) => {
    const id = String(pkg.id || '').trim()
    if (!id || !isWorkPackageScoped(pkg)) return
    scopedIds.add(id)
  })
  return scopedIds
}

export function applyWorkPackageScopedState<T extends WorkPackageScopedViewRecord>(
  packages: readonly T[],
  packageId: string,
  isolated: boolean,
  timestamp: string,
): { changed: boolean; packages: T[] } {
  const cleanId = String(packageId || '').trim()
  if (!cleanId) return { changed: false, packages: [...packages] }
  let changed = false
  const nextPackages = packages.map((pkg) => {
    if (String(pkg.id || '').trim() !== cleanId || hasDeletedAt(pkg.deletedAt)) return pkg
    if (pkg.isolated === isolated) return pkg
    changed = true
    return {
      ...pkg,
      isolated,
      updatedAt: timestamp,
    }
  })
  return { changed, packages: nextPackages }
}

export function applyWorkPackageScopedSelection<T extends WorkPackageScopedViewRecord>(
  packages: readonly T[],
  selectedPackageIds: ReadonlySet<string>,
  timestamp: string,
): { changed: boolean; packages: T[] } {
  let changed = false
  const nextPackages = packages.map((pkg) => {
    const id = String(pkg.id || '').trim()
    if (!id || hasDeletedAt(pkg.deletedAt)) return pkg
    const isolated = selectedPackageIds.has(id)
    if (pkg.isolated === isolated) return pkg
    changed = true
    return {
      ...pkg,
      isolated,
      updatedAt: timestamp,
    }
  })
  return { changed, packages: nextPackages }
}

export function clearWorkPackageScopedState<T extends WorkPackageScopedViewRecord>(
  packages: readonly T[],
  timestamp: string,
): { changed: boolean; packages: T[] } {
  let changed = false
  const nextPackages = packages.map((pkg) => {
    if (hasDeletedAt(pkg.deletedAt) || pkg.isolated !== true) return pkg
    changed = true
    return {
      ...pkg,
      isolated: false,
      updatedAt: timestamp,
    }
  })
  return { changed, packages: nextPackages }
}
