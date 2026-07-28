import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyWorkPackageVisibility,
  hiddenIdsFromWorkPackages,
  resolveWorkPackageVisible,
  sortWorkPackages,
} from '@/features/blueprint-work-packages'

type Package = {
  id: string
  name: string
  visible?: unknown
  updatedAt: string
  selectedAnnotationIds: string[]
  itemRefs: Array<{ annotationId: string; kind: string }>
  roughInHours: number
  trimHours: number
  crewNotes: string
  proposalSummary: string
  sortOrder?: number
  orderTouchedAt?: string
  animationScene?: { revision: number; nodes: string[] }
  deletedAt?: string
}

const viewerSource = readFileSync(
  join(process.cwd(), 'src/components/blueprint/OperationsBlueprintPdfViewer.tsx'),
  'utf8',
)

function pkg(id: string, extras: Partial<Package> = {}): Package {
  return {
    id,
    name: `Package ${id}`,
    visible: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    selectedAnnotationIds: [`ann-${id}`],
    itemRefs: [{ annotationId: `ann-${id}`, kind: 'shape' }],
    roughInHours: 1,
    trimHours: 2,
    crewNotes: `notes-${id}`,
    proposalSummary: `summary-${id}`,
    sortOrder: id.charCodeAt(0),
    orderTouchedAt: '2026-01-01T00:00:00.000Z',
    animationScene: { revision: 3, nodes: [`node-${id}`] },
    ...extras,
  }
}

function sourceBetween(startNeedle: string, endNeedle: string) {
  const start = viewerSource.indexOf(startNeedle)
  const end = viewerSource.indexOf(endNeedle, start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return viewerSource.slice(start, end)
}

describe('Work Package General View visibility persistence helpers', () => {
  it('defaults missing or malformed visible values to shown', () => {
    expect(resolveWorkPackageVisible(undefined)).toBe(true)
    expect(resolveWorkPackageVisible(null)).toBe(true)
    expect(resolveWorkPackageVisible('false')).toBe(true)
    expect(resolveWorkPackageVisible(0)).toBe(true)
    expect(resolveWorkPackageVisible(true)).toBe(true)
    expect(resolveWorkPackageVisible(false)).toBe(false)
  })

  it('hydrates hidden ids from complete live packages and ignores tombstones', () => {
    const hidden = hiddenIdsFromWorkPackages([
      pkg('A', { visible: false }),
      pkg('B', { visible: true }),
      pkg('C', { visible: false, deletedAt: '2026-01-02T00:00:00.000Z' }),
      pkg('D', { visible: 'bad' }),
    ])

    expect(Array.from(hidden)).toEqual(['A'])
  })

  it('patches only visible and updatedAt on the stable package id', () => {
    const original = [pkg('A'), pkg('B', { selectedAnnotationIds: ['keep'], animationScene: { revision: 8, nodes: ['keep'] } })]
    const result = applyWorkPackageVisibility(original, 'B', false, '2026-02-01T00:00:00.000Z')

    expect(result.changed).toBe(true)
    expect(result.packages[0]).toBe(original[0])
    expect(result.packages[1]).toEqual({
      ...original[1],
      visible: false,
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
    expect(result.packages[1].selectedAnnotationIds).toEqual(['keep'])
    expect(result.packages[1].itemRefs).toEqual(original[1].itemRefs)
    expect(result.packages[1].roughInHours).toBe(1)
    expect(result.packages[1].trimHours).toBe(2)
    expect(result.packages[1].crewNotes).toBe('notes-B')
    expect(result.packages[1].proposalSummary).toBe('summary-B')
    expect(result.packages[1].sortOrder).toBe(original[1].sortOrder)
    expect(result.packages[1].orderTouchedAt).toBe(original[1].orderTouchedAt)
    expect(result.packages[1].animationScene).toEqual({ revision: 8, nodes: ['keep'] })
  })

  it('does not patch deleted or unknown packages', () => {
    expect(applyWorkPackageVisibility([pkg('A', { deletedAt: '2026-01-02T00:00:00.000Z' })], 'A', false, 'now').changed).toBe(false)
    expect(applyWorkPackageVisibility([pkg('A')], 'missing', false, 'now').changed).toBe(false)
  })

  it('keeps hidden live packages in totals/order source arrays while only hydrating hidden state', () => {
    const packages = sortWorkPackages([pkg('B', { visible: false, sortOrder: 1 }), pkg('A', { visible: true, sortOrder: 0 })])

    expect(packages.map((item) => item.id)).toEqual(['A', 'B'])
    expect(packages.flatMap((item) => item.selectedAnnotationIds)).toEqual(['ann-A', 'ann-B'])
    expect(hiddenIdsFromWorkPackages(packages)).toEqual(new Set(['B']))
  })
})

describe('OperationsBlueprintPdfViewer Work Package visibility wiring', () => {
  it('hydrates hiddenWorkPackageIds from complete live scope layers on load and clears stale ids', () => {
    const loadSource = sourceBetween('const loadScopeLayers = useCallback(() => {', 'const persistScopeLayers = useCallback')

    expect(loadSource).toContain('getOperationsBlueprintScopeLayers(backup || {}, blueprint.id)')
    expect(loadSource).toContain('setScopeLayers(orderedItems)')
    expect(loadSource).toContain('setHiddenWorkPackageIds(hiddenIdsFromWorkPackages(orderedItems))')
    expect(loadSource).not.toContain('pageFilteredScopeLayers')
  })

  it('persists eye changes from a fresh complete live package array, not page-filtered UI lists', () => {
    const saveSource = sourceBetween('const saveScopeLayerVisibility = useCallback', 'const toggleScopeLayerHidden = useCallback')

    expect(saveSource).toContain('scopeLayerVisibilitySaveQueueRef')
    expect(saveSource).toContain('scopeLayerVisibilityGenerationRef')
    expect(saveSource).toContain('getOperationsBlueprintScopeLayers(backup || {}, blueprintSetId)')
    expect(saveSource).toContain('applyWorkPackageVisibility(liveLayers, layerId, visible')
    expect(saveSource).toContain('saveOperationsBlueprintScopeLayers(backup, blueprintSetId, result.packages)')
    expect(saveSource).not.toContain('pageFilteredScopeLayers')
    expect(saveSource).not.toContain('deleteOperationsBlueprintScopeLayer')
  })

  it('optimistically updates General View filtering without changing isolate state or membership', () => {
    const optimisticSource = sourceBetween('const applyOptimisticScopeLayerVisibility = useCallback', 'const saveScopeLayerVisibility = useCallback')
    const toggleSource = sourceBetween('const toggleScopeLayerHidden = useCallback', 'const clearHiddenScopeLayers = useCallback')

    expect(optimisticSource).toContain('setHiddenWorkPackageIds')
    expect(optimisticSource).toContain('setScopeLayers')
    expect(toggleSource).toContain('hiddenWorkPackageIdsRef.current.has(layerId)')
    expect(optimisticSource).not.toContain('setIsolatedScopeLayerIds')
    expect(optimisticSource).not.toContain('selectedAnnotationIds')
    expect(toggleSource).not.toContain('selectedAnnotationIds')
  })

  it('keeps Show All scoped/isolate clearing separate from persisted hidden visibility', () => {
    const clearScopedSource = sourceBetween('const clearScopeLayerVisibilityFilter = useCallback', 'const applyOptimisticScopeLayerVisibility = useCallback')

    expect(clearScopedSource).toContain('applyOptimisticScopeLayerScopedSelection(next)')
    expect(clearScopedSource).toContain('saveScopeLayerScopedSelection(next)')
    expect(clearScopedSource).not.toContain('setHiddenWorkPackageIds')
    expect(clearScopedSource).not.toContain('saveScopeLayerVisibility')
  })

  it('preserves visible through edit and reorder paths', () => {
    const modalSaveSource = sourceBetween('const saveScopeLayerFromModal = useCallback', 'const deleteScopeLayer = useCallback')
    const reorderSource = sourceBetween('const persistReorderedScopeLayers = useCallback', 'const requestScopeLayerReorder = useCallback')

    expect(modalSaveSource).toContain('? { ...layer, ...payloadBase, updatedAt: now }')
    expect(modalSaveSource).toContain('visible: true')
    expect(reorderSource).toContain('saveOperationsBlueprintScopeLayers(backup, blueprint.id, nextLayers)')
    expect(reorderSource).not.toContain('visible: true')
  })

  it('keeps Package Pick visibility-aware without rewriting membership', () => {
    const pickSource = sourceBetween('const addablePickedAnnotationIds = useMemo', 'const togglePackageSelection = useCallback')

    expect(pickSource).toContain('if (!isAnnotationVisibleOnCanvas(id)) return')
    expect(pickSource).toContain('package visibility state')
    expect(pickSource).not.toContain('saveOperationsBlueprintScopeLayers')
  })

  it('keeps shared annotation hide-if-any-hidden and scoped override behavior', () => {
    const hiddenSource = sourceBetween('const hiddenAnnotationIdSet = useMemo', 'const canvasPageAnnotations = useMemo')

    expect(hiddenSource).toContain('if (isolatedScopeLayers.length > 0) return null')
    expect(hiddenSource).toContain('scopeLayers.forEach((layer) => {')
    expect(hiddenSource).toContain('if (!hiddenWorkPackageIds.has(layer.id)) return')
    expect(hiddenSource).toContain('ids.add(clean)')
  })
})
