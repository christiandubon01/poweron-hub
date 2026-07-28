import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyWorkPackageScopedSelection,
  applyWorkPackageScopedState,
  clearWorkPackageScopedState,
  isWorkPackageScoped,
  scopedIdsFromWorkPackages,
} from '@/features/blueprint-work-packages'

type Package = {
  id: string
  name: string
  visible?: boolean
  isolated?: unknown
  updatedAt: string
  selectedAnnotationIds: string[]
  itemRefs: Array<{ annotationId: string; kind: string }>
  roughInHours: number
  trimHours: number
  testingHours: number
  cleanupHours: number
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
    isolated: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    selectedAnnotationIds: [`ann-${id}`],
    itemRefs: [{ annotationId: `ann-${id}`, kind: 'shape' }],
    roughInHours: 1,
    trimHours: 2,
    testingHours: 3,
    cleanupHours: 4,
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

describe('Work Package Scoped View persistence helpers', () => {
  it('defaults missing and malformed isolated values to unscoped', () => {
    expect(isWorkPackageScoped(pkg('A', { isolated: undefined }))).toBe(false)
    expect(isWorkPackageScoped(pkg('B', { isolated: null }))).toBe(false)
    expect(isWorkPackageScoped(pkg('C', { isolated: 'true' }))).toBe(false)
    expect(isWorkPackageScoped(pkg('D', { isolated: 1 }))).toBe(false)
    expect(isWorkPackageScoped(pkg('E', { isolated: false }))).toBe(false)
    expect(isWorkPackageScoped(pkg('F', { isolated: true }))).toBe(true)
  })

  it('hydrates one or several selected ids from complete live packages and ignores tombstones', () => {
    const scoped = scopedIdsFromWorkPackages([
      pkg('A', { isolated: true }),
      pkg('B', { isolated: false }),
      pkg('C', { isolated: true }),
      pkg('D', { isolated: true, deletedAt: '2026-01-02T00:00:00.000Z' }),
      pkg('E', { isolated: 'bad' }),
    ])

    expect(Array.from(scoped)).toEqual(['A', 'C'])
  })

  it('patches only isolated and updatedAt on the stable package id', () => {
    const original = [pkg('A'), pkg('B', { visible: false, selectedAnnotationIds: ['keep'], animationScene: { revision: 8, nodes: ['keep'] } })]
    const result = applyWorkPackageScopedState(original, 'B', true, '2026-02-01T00:00:00.000Z')

    expect(result.changed).toBe(true)
    expect(result.packages[0]).toBe(original[0])
    expect(result.packages[1]).toEqual({
      ...original[1],
      isolated: true,
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
    expect(result.packages[1].visible).toBe(false)
    expect(result.packages[1].selectedAnnotationIds).toEqual(['keep'])
    expect(result.packages[1].itemRefs).toEqual(original[1].itemRefs)
    expect(result.packages[1].roughInHours).toBe(1)
    expect(result.packages[1].trimHours).toBe(2)
    expect(result.packages[1].testingHours).toBe(3)
    expect(result.packages[1].cleanupHours).toBe(4)
    expect(result.packages[1].crewNotes).toBe('notes-B')
    expect(result.packages[1].proposalSummary).toBe('summary-B')
    expect(result.packages[1].sortOrder).toBe(original[1].sortOrder)
    expect(result.packages[1].orderTouchedAt).toBe(original[1].orderTouchedAt)
    expect(result.packages[1].animationScene).toEqual({ revision: 8, nodes: ['keep'] })
  })

  it('does not patch deleted or unknown packages', () => {
    expect(applyWorkPackageScopedState([pkg('A', { deletedAt: '2026-01-02T00:00:00.000Z' })], 'A', true, 'now').changed).toBe(false)
    expect(applyWorkPackageScopedState([pkg('A')], 'missing', true, 'now').changed).toBe(false)
  })

  it('persists a complete intended multi-package selected set without dropping unrelated packages', () => {
    const original = [
      pkg('A', { isolated: true, visible: false }),
      pkg('B', { isolated: false }),
      pkg('C', { isolated: true, sortOrder: 7 }),
    ]
    const result = applyWorkPackageScopedSelection(original, new Set(['B']), '2026-03-01T00:00:00.000Z')

    expect(result.changed).toBe(true)
    expect(result.packages.map((item) => item.id)).toEqual(['A', 'B', 'C'])
    expect(result.packages.map((item) => item.isolated)).toEqual([false, true, false])
    expect(result.packages[0].visible).toBe(false)
    expect(result.packages[2].sortOrder).toBe(7)
    expect(result.packages[2].selectedAnnotationIds).toEqual(['ann-C'])
  })

  it('clears only scoped state for live packages while preserving EyeOff and package data', () => {
    const original = [
      pkg('A', { isolated: true, visible: false }),
      pkg('B', { isolated: false }),
      pkg('C', { isolated: true, deletedAt: '2026-01-02T00:00:00.000Z' }),
    ]
    const result = clearWorkPackageScopedState(original, '2026-04-01T00:00:00.000Z')

    expect(result.changed).toBe(true)
    expect(result.packages[0]).toEqual({
      ...original[0],
      isolated: false,
      updatedAt: '2026-04-01T00:00:00.000Z',
    })
    expect(result.packages[0].visible).toBe(false)
    expect(result.packages[1]).toBe(original[1])
    expect(result.packages[2]).toBe(original[2])
  })
})

describe('OperationsBlueprintPdfViewer Work Package Scoped View wiring', () => {
  it('hydrates isolatedScopeLayerIds from complete live scope layers and clears stale ids on load failure or missing blueprint', () => {
    const loadSource = sourceBetween('const loadScopeLayers = useCallback(() => {', 'const persistScopeLayers = useCallback')
    expect(loadSource).toContain('getOperationsBlueprintScopeLayers(backup || {}, blueprint.id)')
    expect(loadSource).toContain('setScopeLayers(orderedItems)')
    expect(loadSource).toContain('const scopedIds = scopedIdsFromWorkPackages(orderedItems)')
    expect(loadSource).toContain('setIsolatedScopeLayerIds(scopedIds)')
    expect(loadSource).toContain('isolatedScopeLayerIdsRef.current = scopedIds')
    expect(loadSource).toContain('const emptyScopedIds = new Set<string>()')
    expect(loadSource).toContain('isolatedScopeLayerIdsRef.current = emptyScopedIds')
    expect(loadSource).not.toContain('pageFilteredScopeLayers')
    expect(viewerSource).not.toContain('loadScopeLayers()\n    setIsolatedScopeLayerIds(new Set())')
    expect(viewerSource).not.toContain('loadScopeLayers()\r\n    setIsolatedScopeLayerIds(new Set())')
  })

  it('uses a separate scoped-state queue and generation from Hide from General View', () => {
    const stateSource = sourceBetween('const scopeLayerVisibilitySaveQueueRef', 'const deferredScopeLayerRefreshRef')
    const scopedSaveSource = sourceBetween('const saveScopeLayerScopedSelection = useCallback', 'const toggleScopeLayerIsolation = useCallback')

    expect(stateSource).toContain('scopeLayerVisibilitySaveQueueRef')
    expect(stateSource).toContain('scopeLayerVisibilityGenerationRef')
    expect(stateSource).toContain('scopeLayerScopedSaveQueueRef')
    expect(stateSource).toContain('scopeLayerScopedGenerationRef')
    expect(scopedSaveSource).toContain('scopeLayerScopedSaveQueueRef')
    expect(scopedSaveSource).toContain('scopeLayerScopedGenerationRef')
    expect(scopedSaveSource).not.toContain('scopeLayerVisibilitySaveQueueRef')
    expect(scopedSaveSource).not.toContain('applyWorkPackageVisibility')
  })

  it('persists scoped toggles from a fresh complete live package array and prevents partial UI payloads', () => {
    const scopedSaveSource = sourceBetween('const saveScopeLayerScopedSelection = useCallback', 'const toggleScopeLayerIsolation = useCallback')

    expect(scopedSaveSource).toContain('getOperationsBlueprintScopeLayers(backup || {}, blueprintSetId)')
    expect(scopedSaveSource).toContain('applyWorkPackageScopedSelection(liveLayers, selectedSnapshot')
    expect(scopedSaveSource).toContain('saveOperationsBlueprintScopeLayers(backup, blueprintSetId, result.packages)')
    expect(scopedSaveSource).not.toContain('pageFilteredScopeLayers')
    expect(scopedSaveSource).not.toContain('isolatedScopeLayers')
    expect(scopedSaveSource).not.toContain('deleteOperationsBlueprintScopeLayer')
  })

  it('preserves multi-package toggle semantics and writes the full intended selected set', () => {
    const toggleSource = sourceBetween('const toggleScopeLayerIsolation = useCallback', 'const clearScopeLayerVisibilityFilter = useCallback')

    expect(toggleSource).toContain('const next = new Set(isolatedScopeLayerIdsRef.current)')
    expect(toggleSource).toContain('if (next.has(layerId)) next.delete(layerId)')
    expect(toggleSource).toContain('else next.add(layerId)')
    expect(toggleSource).toContain('saveScopeLayerScopedSelection(next, layerId)')
    expect(toggleSource).not.toContain('setHiddenWorkPackageIds')
    expect(toggleSource).not.toContain('visible')
  })

  it('persists Show All as empty scoped state without clearing EyeOff values', () => {
    const clearScopedSource = sourceBetween('const clearScopeLayerVisibilityFilter = useCallback', 'const applyOptimisticScopeLayerVisibility = useCallback')
    const scopedSaveSource = sourceBetween('const saveScopeLayerScopedSelection = useCallback', 'const toggleScopeLayerIsolation = useCallback')

    expect(clearScopedSource).toContain('const next = new Set<string>()')
    expect(clearScopedSource).toContain('applyOptimisticScopeLayerScopedSelection(next)')
    expect(clearScopedSource).toContain('saveScopeLayerScopedSelection(next)')
    expect(scopedSaveSource).toContain('clearWorkPackageScopedState(liveLayers')
    expect(clearScopedSource).not.toContain('clearHiddenScopeLayers')
    expect(clearScopedSource).not.toContain('setHiddenWorkPackageIds')
    expect(clearScopedSource).not.toContain('saveScopeLayerVisibility')
    expect(clearScopedSource).not.toContain('visible: true')
  })

  it('keeps visible and isolated precedence independent for General View and Scoped View', () => {
    const hiddenSource = sourceBetween('const hiddenAnnotationIdSet = useMemo', 'const canvasPageAnnotations = useMemo')
    const optimisticScopedSource = sourceBetween('const applyOptimisticScopeLayerScopedSelection = useCallback', 'const saveScopeLayerScopedSelection = useCallback')
    const visibilityToggleSource = sourceBetween('const toggleScopeLayerHidden = useCallback', 'const clearHiddenScopeLayers = useCallback')

    expect(hiddenSource).toContain('if (isolatedScopeLayers.length > 0) return null')
    expect(hiddenSource).toContain('if (!hiddenWorkPackageIds.has(layer.id)) return')
    expect(optimisticScopedSource).toContain('{ ...layer, isolated }')
    expect(optimisticScopedSource).not.toContain('visible')
    expect(visibilityToggleSource).not.toContain('setIsolatedScopeLayerIds')
    expect(visibilityToggleSource).not.toContain('isolated')
  })

  it('removes deleted scoped package ids locally while preserving delete/tombstone behavior', () => {
    const deleteSource = sourceBetween('const deleteScopeLayer = useCallback', 'const applyOptimisticScopeLayerScopedSelection = useCallback')

    expect(deleteSource).toContain('setIsolatedScopeLayerIds')
    expect(deleteSource).toContain('next.delete(layerId)')
    expect(deleteSource).toContain('persistScopeLayerDeletion(layerId)')
    expect(deleteSource).not.toContain('saveScopeLayerScopedSelection')
    expect(deleteSource).not.toContain('clearWorkPackageScopedState')
  })

  it('preserves Package Pick and totals by keeping scoped state view-only', () => {
    const pickSource = sourceBetween('const addablePickedAnnotationIds = useMemo', 'const togglePackageSelection = useCallback')
    const scopedSaveSource = sourceBetween('const saveScopeLayerScopedSelection = useCallback', 'const toggleScopeLayerIsolation = useCallback')

    expect(pickSource).toContain('if (!isAnnotationVisibleOnCanvas(id)) return')
    expect(pickSource).not.toContain('saveOperationsBlueprintScopeLayers')
    expect(scopedSaveSource).not.toContain('selectedAnnotationIds')
    expect(scopedSaveSource).not.toContain('roughInHours')
    expect(scopedSaveSource).not.toContain('trimHours')
  })
})
