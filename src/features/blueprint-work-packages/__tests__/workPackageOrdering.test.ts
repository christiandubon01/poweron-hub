import { describe, expect, it } from 'vitest'
import {
  assignNewWorkPackageOrder,
  decideWorkPackageRemoteRefreshApply,
  getVisibleWorkPackageMoveState,
  moveWorkPackageById,
  normalizeWorkPackageOrder,
  reorderVisibleWorkPackagesById,
  reorderWorkPackagesById,
  shouldRunDeferredWorkPackageRefresh,
  sortWorkPackages,
  type WorkPackageOrderRecord,
} from '../workPackageOrdering'

const T1 = '2026-07-17T10:00:00.000Z'
const T2 = '2026-07-17T11:00:00.000Z'

type Package = WorkPackageOrderRecord & {
  pageNumber?: number
  updatedAt: string
  roughInHours: number
  trimHours: number
  testingHours: number
  cleanupHours: number
  crewNotes: string
  selectedAnnotationIds: string[]
  itemRefs: Array<{ annotationId: string; pageNumber: number; label: string }>
  animationScene?: { id: string; revision: number }
}

function pkg(id: string, extra: Partial<Package> = {}): Package {
  return {
    id,
    createdAt: `2026-07-17T10:00:0${id.charCodeAt(0) % 4}.000Z`,
    updatedAt: T1,
    roughInHours: 1,
    trimHours: 2,
    testingHours: 3,
    cleanupHours: 4,
    crewNotes: `notes-${id}`,
    selectedAnnotationIds: [`ann-${id}`],
    itemRefs: [{ annotationId: `ann-${id}`, pageNumber: 1, label: `Item ${id}` }],
    animationScene: { id: `scene-${id}`, revision: 1 },
    ...extra,
  }
}

function omitOrder(value: Package): Omit<Package, 'sortOrder' | 'orderTouchedAt'> {
  const { sortOrder, orderTouchedAt, ...rest } = value
  return rest
}

describe('workPackageOrdering', () => {
  it('handles empty and single-package lists', () => {
    expect(sortWorkPackages([])).toEqual([])
    expect(sortWorkPackages([pkg('A')]).map((item) => item.id)).toEqual(['A'])
  })

  it('sorts legacy packages by createdAt then id', () => {
    const items = [
      pkg('C', { createdAt: T2 }),
      pkg('B', { createdAt: T1 }),
      pkg('A', { createdAt: T1 }),
    ]
    expect(sortWorkPackages(items).map((item) => item.id)).toEqual(['A', 'B', 'C'])
  })

  it('respects explicit order and places missing-order records after explicit records', () => {
    const items = [pkg('A'), pkg('B', { sortOrder: 2 }), pkg('C', { sortOrder: 0 })]
    expect(sortWorkPackages(items).map((item) => item.id)).toEqual(['C', 'B', 'A'])
  })

  it('uses deterministic fallback for duplicate and invalid orders without mutating input', () => {
    const items = [
      pkg('C', { sortOrder: Number.NaN, createdAt: T2 }),
      pkg('B', { sortOrder: 1, createdAt: T1 }),
      pkg('A', { sortOrder: 1, createdAt: T1 }),
      pkg('D', { sortOrder: Number.POSITIVE_INFINITY, createdAt: T2 }),
      pkg('E', { sortOrder: -1, createdAt: T2 }),
    ]
    const snapshot = items.map((item) => ({ ...item }))
    expect(sortWorkPackages(items).map((item) => item.id)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(items).toEqual(snapshot)
  })

  it('moves middle packages up and down while respecting visible boundaries', () => {
    const items = [pkg('A'), pkg('B'), pkg('C')]
    expect(moveWorkPackageById({ fullOrderedLivePackages: items, visibleIds: ['A', 'B', 'C'], movedId: 'B', direction: 'up' }).packages.map((item) => item.id)).toEqual(['B', 'A', 'C'])
    expect(moveWorkPackageById({ fullOrderedLivePackages: items, visibleIds: ['A', 'B', 'C'], movedId: 'B', direction: 'down' }).packages.map((item) => item.id)).toEqual(['A', 'C', 'B'])
    expect(moveWorkPackageById({ fullOrderedLivePackages: items, visibleIds: ['A', 'B', 'C'], movedId: 'A', direction: 'up' }).changed).toBe(false)
    expect(moveWorkPackageById({ fullOrderedLivePackages: items, visibleIds: ['A', 'B', 'C'], movedId: 'C', direction: 'down' }).changed).toBe(false)
  })

  it('drags by stable ids and reports no-op or unknown ids unchanged', () => {
    const items = [pkg('A'), pkg('B'), pkg('C')]
    expect(reorderWorkPackagesById({ packages: items, movedId: 'A', targetId: 'C', placement: 'before' }).packages.map((item) => item.id)).toEqual(['B', 'A', 'C'])
    expect(reorderWorkPackagesById({ packages: items, movedId: 'C', targetId: 'A', placement: 'after' }).packages.map((item) => item.id)).toEqual(['A', 'C', 'B'])
    expect(reorderWorkPackagesById({ packages: items, movedId: 'A', targetId: 'A', placement: 'before' }).changed).toBe(false)
    expect(reorderWorkPackagesById({ packages: items, movedId: 'X', targetId: 'A', placement: 'before' }).reason).toBe('unknown-moved-id')
    expect(reorderWorkPackagesById({ packages: items, movedId: 'A', targetId: 'X', placement: 'before' }).reason).toBe('unknown-target-id')
  })

  it('reorders a page-visible subset while hidden packages retain their full-list slots', () => {
    const items = [pkg('A', { pageNumber: 1 }), pkg('B', { pageNumber: 2 }), pkg('C', { pageNumber: 1 })]
    const result = reorderVisibleWorkPackagesById({
      fullOrderedLivePackages: items,
      visibleIds: ['A', 'C'],
      movedId: 'C',
      targetId: 'A',
      placement: 'before',
    })
    expect(result.packages.map((item) => item.id)).toEqual(['C', 'B', 'A'])
  })

  it('normalizes live packages to one coherent timestamp and preserves content fields', () => {
    const items = [pkg('C'), pkg('B', { deletedAt: T1, sortOrder: 7 }), pkg('A')]
    const normalized = normalizeWorkPackageOrder(items, T2)
    expect(normalized.map((item) => item.sortOrder)).toEqual([0, 7, 1])
    expect(normalized.filter((item) => !item.deletedAt).map((item) => item.orderTouchedAt)).toEqual([T2, T2])
    expect(normalized[1].orderTouchedAt).toBeUndefined()
    expect(omitOrder(normalized[0])).toEqual(omitOrder(items[0]))
    expect(normalized[0].roughInHours).toBe(1)
    expect(normalized[0].trimHours).toBe(2)
    expect(normalized[0].testingHours).toBe(3)
    expect(normalized[0].cleanupHours).toBe(4)
    expect(normalized[0].selectedAnnotationIds).toEqual(['ann-C'])
    expect(normalized[0].itemRefs).toEqual([{ annotationId: 'ann-C', pageNumber: 1, label: 'Item C' }])
    expect(normalized[0].animationScene).toEqual({ id: 'scene-C', revision: 1 })
    expect(normalized[0].updatedAt).toBe(T1)
  })

  it('assigns new packages to the deterministic bottom order and preserves stable ids', () => {
    expect(assignNewWorkPackageOrder([])).toBe(0)
    expect(assignNewWorkPackageOrder([pkg('A', { sortOrder: 0 }), pkg('B', { sortOrder: 1 }), pkg('C', { sortOrder: 2 })])).toBe(3)
    expect(assignNewWorkPackageOrder([pkg('A', { sortOrder: 0 }), pkg('B', { sortOrder: 5 }), pkg('C', { sortOrder: 10 })])).toBe(11)
    expect(assignNewWorkPackageOrder([pkg('A'), pkg('B'), pkg('C')])).toBeUndefined()
    expect(assignNewWorkPackageOrder([pkg('A', { sortOrder: 0 }), pkg('B'), pkg('C', { sortOrder: 1 })])).toBeUndefined()
    const result = normalizeWorkPackageOrder([pkg('A'), pkg('B')], T2)
    expect(result.map((item) => item.id)).toEqual(['A', 'B'])
  })

  it('keeps newly created packages last in legacy and mixed sequences without mutating existing records', () => {
    const legacy = [pkg('A', { createdAt: '2026-07-17T10:00:00.000Z' }), pkg('B', { createdAt: '2026-07-17T10:01:00.000Z' }), pkg('C', { createdAt: '2026-07-17T10:02:00.000Z' })]
    const legacySnapshot = legacy.map((item) => ({ ...item }))
    const legacyD = pkg('D', { createdAt: T2 })
    const legacyCreated = sortWorkPackages([...legacy, legacyD])
    expect(legacyCreated.map((item) => item.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(legacy).toEqual(legacySnapshot)
    expect(legacy.some((item) => item.orderTouchedAt)).toBe(false)

    const mixed = [
      pkg('A', { sortOrder: 0, createdAt: '2026-07-17T10:00:00.000Z' }),
      pkg('B', { createdAt: '2026-07-17T10:01:00.000Z' }),
      pkg('C', { sortOrder: 1, createdAt: '2026-07-17T10:02:00.000Z' }),
      pkg('D', { createdAt: T2 }),
    ]
    expect(sortWorkPackages(mixed).map((item) => item.id)).toEqual(['A', 'C', 'B', 'D'])
  })

  it('normalizes every live package on the first explicit reorder after legacy create', () => {
    const items = [
      pkg('A', { createdAt: '2026-07-17T10:00:00.000Z' }),
      pkg('B', { createdAt: '2026-07-17T10:01:00.000Z' }),
      pkg('C', { createdAt: '2026-07-17T10:02:00.000Z' }),
      pkg('D', { createdAt: T2 }),
    ]
    const result = moveWorkPackageById({
      fullOrderedLivePackages: sortWorkPackages(items),
      visibleIds: ['A', 'B', 'C', 'D'],
      movedId: 'D',
      direction: 'up',
      orderTouchedAt: T2,
    })
    expect(result.packages.map((item) => [item.id, item.sortOrder, item.orderTouchedAt])).toEqual([
      ['A', 0, T2],
      ['B', 1, T2],
      ['D', 2, T2],
      ['C', 3, T2],
    ])
  })

  it('exposes visible arrow boundary state and busy lock state', () => {
    expect(getVisibleWorkPackageMoveState({ visibleIds: ['A', 'B'], packageId: 'A' })).toEqual({ canMoveUp: false, canMoveDown: true })
    expect(getVisibleWorkPackageMoveState({ visibleIds: ['A', 'B'], packageId: 'B' })).toEqual({ canMoveUp: true, canMoveDown: false })
    expect(getVisibleWorkPackageMoveState({ visibleIds: ['A', 'B'], packageId: 'B', busy: true })).toEqual({ canMoveUp: false, canMoveDown: false })
  })

  it('models remote refresh deferral during order saves', () => {
    expect(decideWorkPackageRemoteRefreshApply(true)).toEqual({ loadScopeLayers: false, deferScopeLayerRefresh: true })
    expect(decideWorkPackageRemoteRefreshApply(false)).toEqual({ loadScopeLayers: true, deferScopeLayerRefresh: false })
    expect(shouldRunDeferredWorkPackageRefresh({ deferred: true, saved: true, cloudSynced: true, saveId: 2, currentSaveId: 2 })).toBe(true)
    expect(shouldRunDeferredWorkPackageRefresh({ deferred: true, saved: false, cloudSynced: false, saveId: 2, currentSaveId: 2 })).toBe(false)
    expect(shouldRunDeferredWorkPackageRefresh({ deferred: true, saved: true, cloudSynced: false, saveId: 2, currentSaveId: 2 })).toBe(false)
    expect(shouldRunDeferredWorkPackageRefresh({ deferred: true, saved: true, cloudSynced: true, saveId: 1, currentSaveId: 2 })).toBe(false)
  })
})
