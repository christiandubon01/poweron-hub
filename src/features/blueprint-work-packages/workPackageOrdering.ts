export type WorkPackageOrderRecord = {
  id: string
  createdAt?: string
  sortOrder?: number
  orderTouchedAt?: string
  deletedAt?: string
}

export type WorkPackageMoveDirection = 'up' | 'down'
export type WorkPackageDropPlacement = 'before' | 'after'

export type WorkPackageReorderResult<T extends WorkPackageOrderRecord> = {
  changed: boolean
  packages: T[]
  reason?: 'unknown-moved-id' | 'unknown-target-id' | 'boundary' | 'noop'
}

export function isValidWorkPackageSortOrder(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function normalizeWorkPackageSortOrder(value: unknown): number | undefined {
  return isValidWorkPackageSortOrder(value) ? Math.floor(value) : undefined
}

export function isValidWorkPackageOrderTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value))
}

function createdAtMs(value: unknown): number {
  return isValidWorkPackageOrderTimestamp(value) ? Date.parse(value) : Number.POSITIVE_INFINITY
}

function packageId(value: WorkPackageOrderRecord): string {
  return String(value.id || '')
}

export function compareWorkPackageOrder(a: WorkPackageOrderRecord, b: WorkPackageOrderRecord): number {
  const aOrder = normalizeWorkPackageSortOrder(a.sortOrder)
  const bOrder = normalizeWorkPackageSortOrder(b.sortOrder)
  const aHasOrder = aOrder != null
  const bHasOrder = bOrder != null

  if (aHasOrder && bHasOrder && aOrder !== bOrder) return aOrder - bOrder
  if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1

  const aCreated = createdAtMs(a.createdAt)
  const bCreated = createdAtMs(b.createdAt)
  if (aCreated !== bCreated) return aCreated - bCreated
  return packageId(a).localeCompare(packageId(b))
}

export function sortWorkPackages<T extends WorkPackageOrderRecord>(packages: readonly T[]): T[] {
  return [...packages].sort(compareWorkPackageOrder)
}

export function getLiveWorkPackages<T extends WorkPackageOrderRecord>(packages: readonly T[]): T[] {
  return packages.filter((pkg) => !isValidWorkPackageOrderTimestamp(pkg.deletedAt))
}

export function normalizeWorkPackageOrder<T extends WorkPackageOrderRecord>(
  packages: readonly T[],
  orderTouchedAt: string,
): T[] {
  if (!isValidWorkPackageOrderTimestamp(orderTouchedAt)) return [...packages]
  let index = 0
  return packages.map((pkg) => {
    if (isValidWorkPackageOrderTimestamp(pkg.deletedAt)) return pkg
    return {
      ...pkg,
      sortOrder: index++,
      orderTouchedAt,
    }
  })
}

function sameIdOrder<T extends WorkPackageOrderRecord>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((pkg, index) => pkg.id === b[index]?.id)
}

function applyVisibleSequenceToFullOrder<T extends WorkPackageOrderRecord>(
  fullOrderedLivePackages: readonly T[],
  visibleIds: readonly string[],
  nextVisibleIds: readonly string[],
): T[] {
  const visibleIdSet = new Set(visibleIds)
  const packageById = new Map(fullOrderedLivePackages.map((pkg) => [pkg.id, pkg]))
  const nextVisiblePackages = nextVisibleIds.map((id) => packageById.get(id)).filter(Boolean) as T[]
  let visibleIndex = 0
  return fullOrderedLivePackages.map((pkg) => {
    if (!visibleIdSet.has(pkg.id)) return pkg
    return nextVisiblePackages[visibleIndex++] || pkg
  })
}

export function reorderVisibleWorkPackagesById<T extends WorkPackageOrderRecord>(params: {
  fullOrderedLivePackages: readonly T[]
  visibleIds: readonly string[]
  movedId: string
  targetId: string
  placement: WorkPackageDropPlacement
  orderTouchedAt?: string
}): WorkPackageReorderResult<T> {
  const fullOrderedLivePackages = [...params.fullOrderedLivePackages]
  const visibleIds = params.visibleIds.filter((id) => fullOrderedLivePackages.some((pkg) => pkg.id === id))
  if (!fullOrderedLivePackages.some((pkg) => pkg.id === params.movedId)) {
    return { changed: false, packages: fullOrderedLivePackages, reason: 'unknown-moved-id' }
  }
  if (!fullOrderedLivePackages.some((pkg) => pkg.id === params.targetId)) {
    return { changed: false, packages: fullOrderedLivePackages, reason: 'unknown-target-id' }
  }
  if (params.movedId === params.targetId) {
    return { changed: false, packages: fullOrderedLivePackages, reason: 'noop' }
  }
  if (!visibleIds.includes(params.movedId)) {
    return { changed: false, packages: fullOrderedLivePackages, reason: 'unknown-moved-id' }
  }
  if (!visibleIds.includes(params.targetId)) {
    return { changed: false, packages: fullOrderedLivePackages, reason: 'unknown-target-id' }
  }

  const nextVisibleIds = [...visibleIds]
  const fromIndex = nextVisibleIds.indexOf(params.movedId)
  nextVisibleIds.splice(fromIndex, 1)
  const targetIndex = nextVisibleIds.indexOf(params.targetId)
  const insertIndex = params.placement === 'after' ? targetIndex + 1 : targetIndex
  nextVisibleIds.splice(insertIndex, 0, params.movedId)

  const reordered = applyVisibleSequenceToFullOrder(fullOrderedLivePackages, visibleIds, nextVisibleIds)
  if (sameIdOrder(fullOrderedLivePackages, reordered)) {
    return { changed: false, packages: fullOrderedLivePackages, reason: 'noop' }
  }

  const packages = params.orderTouchedAt
    ? normalizeWorkPackageOrder(reordered, params.orderTouchedAt)
    : reordered
  return { changed: true, packages }
}

export function moveWorkPackageById<T extends WorkPackageOrderRecord>(params: {
  fullOrderedLivePackages: readonly T[]
  visibleIds: readonly string[]
  movedId: string
  direction: WorkPackageMoveDirection
  orderTouchedAt?: string
}): WorkPackageReorderResult<T> {
  const visibleIds = params.visibleIds.filter((id) => params.fullOrderedLivePackages.some((pkg) => pkg.id === id))
  const visibleIndex = visibleIds.indexOf(params.movedId)
  if (visibleIndex === -1) {
    return { changed: false, packages: [...params.fullOrderedLivePackages], reason: 'unknown-moved-id' }
  }
  const targetIndex = params.direction === 'up' ? visibleIndex - 1 : visibleIndex + 1
  if (targetIndex < 0 || targetIndex >= visibleIds.length) {
    return { changed: false, packages: [...params.fullOrderedLivePackages], reason: 'boundary' }
  }
  return reorderVisibleWorkPackagesById({
    fullOrderedLivePackages: params.fullOrderedLivePackages,
    visibleIds,
    movedId: params.movedId,
    targetId: visibleIds[targetIndex],
    placement: params.direction === 'up' ? 'before' : 'after',
    orderTouchedAt: params.orderTouchedAt,
  })
}

export function reorderWorkPackagesById<T extends WorkPackageOrderRecord>(params: {
  packages: readonly T[]
  movedId: string
  targetId: string
  placement: WorkPackageDropPlacement
  orderTouchedAt?: string
}): WorkPackageReorderResult<T> {
  const orderedLive = sortWorkPackages(getLiveWorkPackages(params.packages))
  return reorderVisibleWorkPackagesById({
    fullOrderedLivePackages: orderedLive,
    visibleIds: orderedLive.map((pkg) => pkg.id),
    movedId: params.movedId,
    targetId: params.targetId,
    placement: params.placement,
    orderTouchedAt: params.orderTouchedAt,
  })
}

export function assignNewWorkPackageOrder(packages: readonly WorkPackageOrderRecord[]): number | undefined {
  const live = getLiveWorkPackages(packages)
  const explicitOrders = live
    .map((pkg) => normalizeWorkPackageSortOrder(pkg.sortOrder))
    .filter((value): value is number => value != null)
  if (live.length === 0) return 0
  if (explicitOrders.length !== live.length) return undefined
  return Math.max(...explicitOrders) + 1
}

export type WorkPackageRemoteRefreshApplyDecision = {
  loadScopeLayers: boolean
  deferScopeLayerRefresh: boolean
}

export function decideWorkPackageRemoteRefreshApply(isOrderSaving: boolean): WorkPackageRemoteRefreshApplyDecision {
  return isOrderSaving
    ? { loadScopeLayers: false, deferScopeLayerRefresh: true }
    : { loadScopeLayers: true, deferScopeLayerRefresh: false }
}

export function shouldRunDeferredWorkPackageRefresh(params: {
  deferred: boolean
  saved: boolean
  cloudSynced: boolean
  saveId: number
  currentSaveId: number
}): boolean {
  return params.deferred
    && params.saved
    && params.cloudSynced
    && params.saveId === params.currentSaveId
}

export function getVisibleWorkPackageMoveState(params: {
  visibleIds: readonly string[]
  packageId: string
  busy?: boolean
}): { canMoveUp: boolean; canMoveDown: boolean } {
  if (params.busy) return { canMoveUp: false, canMoveDown: false }
  const index = params.visibleIds.indexOf(params.packageId)
  return {
    canMoveUp: index > 0,
    canMoveDown: index >= 0 && index < params.visibleIds.length - 1,
  }
}
