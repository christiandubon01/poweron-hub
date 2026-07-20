import { describe, expect, it } from 'vitest'
import { createCircuitGeometryFingerprint } from '../routeGeometry'
import {
  addPackageAnimationDirectTransition,
  addPackageAnimationRouteSegment,
  clearPackageAnimationRouteDraft,
  createEmptyPackageAnimationRouteDraft,
  createSingleFlightGuard,
  markPackageAnimationRouteDraftSaved,
  openPackageAnimationRouteSession,
  reconcilePackageAnimationRouteLocalRefresh,
  reconcilePackageAnimationRouteSave,
  resolvePackageAnimationRouteBaseRevision,
  inferRouteBuilderDefaultChannel,
  inferRouteBuilderNodeRoles,
  loadPackageAnimationRouteDraft,
  movePackageAnimationRouteTransition,
  packageAnimationRouteDraftToScene,
  removePackageAnimationRouteTransition,
  resolvePackageAnimationRouteDraft,
  selectPackageAnimationRouteSource,
  summarizePackageAnimationScene,
  undoPackageAnimationRouteSelection,
  updatePackageAnimationRouteChannel,
  validatePackageAnimationRouteDraft,
  type PackageAnimationRouteDraft,
  type RouteBuilderAnnotation,
} from '../routeBuilderModel'
import type { RouteSegmentPick } from '../routePicking'

const source: RouteBuilderAnnotation = { id: 'source', pageNumber: 1, label: 'Switch', shapeKind: 'electrical-switch', rect: { x: 0.08, y: 0.48, w: 0.04, h: 0.04 } }
const sensor: RouteBuilderAnnotation = { id: 'sensor', pageNumber: 1, label: 'Sensor', shapeKind: 'electrical-ceiling-occupancy-sensor', rect: { x: 0.08, y: 0.28, w: 0.04, h: 0.04 } }
const fixture1: RouteBuilderAnnotation = { id: 'fixture-1', pageNumber: 1, label: 'Light 1', shapeKind: 'electrical-recessed-light', rect: { x: 0.48, y: 0.48, w: 0.04, h: 0.04 } }
const fixture2: RouteBuilderAnnotation = { id: 'fixture-2', pageNumber: 1, label: 'Light 2', shapeKind: 'electrical-pendant-light', rect: { x: 0.88, y: 0.48, w: 0.04, h: 0.04 } }
const circuit: RouteBuilderAnnotation = {
  id: 'circuit', pageNumber: 1, label: 'Circuit Path', shapeKind: 'circuit-path',
  points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }],
  pointIds: ['p1', 'p2', 'p3'], segmentIds: ['s1', 's2'],
}
const arc: RouteBuilderAnnotation = {
  id: 'arc', pageNumber: 1, label: 'Circuit Arc', shapeKind: 'circuit-arc',
  points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }], arcCtrls: [{ x: 0.3, y: 0.2 }],
  pointIds: ['a1', 'a2'], segmentIds: ['as1'],
}

function allAnnotations(): RouteBuilderAnnotation[] {
  return [source, sensor, fixture1, fixture2, circuit, arc].map((entry) => structuredClone(entry))
}

function empty(overrides: Partial<Parameters<typeof createEmptyPackageAnimationRouteDraft>[0]> = {}) {
  return createEmptyPackageAnimationRouteDraft({
    packageId: 'package', packageName: 'Lighting',
    packageAnnotationIds: allAnnotations().map((entry) => entry.id),
    annotations: allAnnotations(), now: '2026-07-19T00:00:00.000Z', sceneId: 'scene-1',
    ...overrides,
  })
}

function sourceDraft(base = empty(), annotationId = 'source'): PackageAnimationRouteDraft {
  const result = selectPackageAnimationRouteSource(base, annotationId)
  expect(result.accepted).toBe(true)
  return result.draft
}

function segmentPick(annotation: RouteBuilderAnnotation, index: number, reverseSnapshot = false): RouteSegmentPick {
  const points = annotation.points!
  const shapeKind = annotation.shapeKind as 'circuit-path' | 'circuit-arc'
  const start = points[index]
  const end = points[index + 1]
  return {
    annotationId: annotation.id,
    pageNumber: annotation.pageNumber,
    shapeKind,
    segmentId: annotation.segmentIds![index],
    segmentIndexHint: index,
    geometryFingerprint: createCircuitGeometryFingerprint({ annotationId: annotation.id, pageNumber: annotation.pageNumber, shapeKind, points, arcCtrls: annotation.arcCtrls }),
    startPointId: annotation.pointIds![index],
    endPointId: annotation.pointIds![index + 1],
    startPointIndexHint: index,
    endPointIndexHint: index + 1,
    start: reverseSnapshot ? end : start,
    end: reverseSnapshot ? start : end,
    ...(shapeKind === 'circuit-arc' ? { control: annotation.arcCtrls![index] } : {}),
    distancePx: 1,
  }
}

function addSegment(draft: PackageAnimationRouteDraft, annotation: RouteBuilderAnnotation, index: number) {
  const result = addPackageAnimationRouteSegment(draft, segmentPick(annotation, index))
  expect(result.accepted).toBe(true)
  return result.draft
}

describe('routeBuilderModel', () => {
  it('creates a new empty draft without mutating package data', () => {
    const draft = empty()
    expect(draft).toMatchObject({ packageId: 'package', sceneId: 'scene-1', transitions: [], dirty: false })
    expect(draft.source).toBeUndefined()
    expect(validatePackageAnimationRouteDraft(draft).map((entry) => entry.code)).toEqual(expect.arrayContaining(['missing-source', 'empty-route']))
  })

  it('selects exactly one eligible source and resets the traversal', () => {
    let draft = sourceDraft()
    draft = addSegment(draft, circuit, 0)
    const changed = selectPackageAnimationRouteSource(draft, 'sensor')
    expect(changed.draft.source?.annotationId).toBe('sensor')
    expect(changed.draft.transitions).toEqual([])
  })

  it('infers source, sensor, control, load, and junction roles', () => {
    expect(inferRouteBuilderNodeRoles('electrical-wall-occupancy-sensor', { selectedAsSource: true })).toEqual(['source', 'sensor', 'control'])
    expect(inferRouteBuilderNodeRoles('electrical-dimmer', { selectedAsSource: true })).toEqual(['source', 'control'])
    expect(inferRouteBuilderNodeRoles('electrical-recessed-light')).toEqual(['load'])
    expect(inferRouteBuilderNodeRoles(undefined, { junction: true })).toEqual(['junction'])
  })

  it('infers source-specific default channels', () => {
    expect(inferRouteBuilderDefaultChannel('electrical-ceiling-occupancy-sensor')).toBe('low-voltage-control-signal')
    expect(inferRouteBuilderDefaultChannel('electrical-switch')).toBe('switched-line-voltage')
    expect(inferRouteBuilderDefaultChannel('unknown')).toBe('generic-route')
  })

  it('adds a connected straight segment and matches its destination fixture', () => {
    const resolved = resolvePackageAnimationRouteDraft(addSegment(sourceDraft(), circuit, 0))
    expect(resolved.edges).toHaveLength(1)
    expect(resolved.nodes[1]).toMatchObject({ roles: ['load'], anchor: { kind: 'annotation-center', annotationId: 'fixture-1' } })
  })

  it('adds a connected quadratic Arc segment', () => {
    const draft = addSegment(sourceDraft(), arc, 0)
    expect(resolvePackageAnimationRouteDraft(draft).edges[0].geometry).toMatchObject({ kind: 'circuit-segment', annotationId: 'arc', segmentId: 'as1' })
  })

  it('reverses segment direction from the current endpoint while persisting forward traversal', () => {
    const reverseCircuit: RouteBuilderAnnotation = {
      id: 'reverse', pageNumber: 1, label: 'Reverse', shapeKind: 'circuit-path',
      points: [{ x: 0.5, y: 0.5 }, { x: 0.1, y: 0.5 }], pointIds: ['r1', 'r2'], segmentIds: ['rs'],
    }
    const base = empty({ annotations: [...allAnnotations(), reverseCircuit], packageAnnotationIds: [...allAnnotations().map((entry) => entry.id), 'reverse'] })
    const draft = addSegment(sourceDraft(base), reverseCircuit, 0)
    expect(resolvePackageAnimationRouteDraft(draft).edges[0].geometry).toMatchObject({ fromT: 1, toT: 0 })
    expect(resolvePackageAnimationRouteDraft(draft).traversal[0].direction).toBe('forward')
  })

  it('rejects a disconnected segment without changing the draft', () => {
    const disconnected: RouteBuilderAnnotation = {
      id: 'far', pageNumber: 1, label: 'Far', shapeKind: 'circuit-path',
      points: [{ x: 0.7, y: 0.2 }, { x: 0.9, y: 0.2 }], pointIds: ['f1', 'f2'], segmentIds: ['fs'],
    }
    const base = empty({ annotations: [...allAnnotations(), disconnected], packageAnnotationIds: [...allAnnotations().map((entry) => entry.id), 'far'] })
    const draft = sourceDraft(base)
    const result = addPackageAnimationRouteSegment(draft, segmentPick(disconnected, 0))
    expect(result.accepted).toBe(false)
    expect(result.draft.transitions).toEqual([])
    expect(result.message).toContain('does not connect')
  })

  it('prevents exact duplicate segment use', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const duplicate = addPackageAnimationRouteSegment(draft, segmentPick(circuit, 0))
    expect(duplicate.accepted).toBe(false)
    expect(duplicate.message).toContain('already in the route')
  })

  it('prevents a cycle back to the source through a different segment', () => {
    const returning: RouteBuilderAnnotation = {
      id: 'return', pageNumber: 1, label: 'Return', shapeKind: 'circuit-path',
      points: [{ x: 0.5, y: 0.5 }, { x: 0.1, y: 0.5 }], pointIds: ['x1', 'x2'], segmentIds: ['return-seg'],
    }
    const base = empty({ annotations: [...allAnnotations(), returning], packageAnnotationIds: [...allAnnotations().map((entry) => entry.id), 'return'] })
    const first = addSegment(sourceDraft(base), circuit, 0)
    expect(addPackageAnimationRouteSegment(first, segmentPick(returning, 0))).toMatchObject({ accepted: false })
  })

  it('creates a junction node when no included device matches a circuit point', () => {
    const annotations = allAnnotations().filter((entry) => entry.id !== 'fixture-1')
    const base = empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) })
    const resolved = resolvePackageAnimationRouteDraft(addSegment(sourceDraft(base), circuit, 0))
    expect(resolved.nodes[1]).toMatchObject({ roles: ['junction'], anchor: { kind: 'circuit-point', pointId: 'p2' } })
  })

  it('undoes the last segment, then the source', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const withoutSegment = undoPackageAnimationRouteSelection(draft)
    expect(withoutSegment.transitions).toHaveLength(0)
    expect(undoPackageAnimationRouteSelection(withoutSegment).source).toBeUndefined()
  })

  it('clears the source and all route steps together', () => {
    const cleared = clearPackageAnimationRouteDraft(addSegment(sourceDraft(), circuit, 0))
    expect(cleared.source).toBeUndefined()
    expect(cleared.transitions).toEqual([])
  })

  it('removes a middle step and detects broken continuity', () => {
    const longCircuit: RouteBuilderAnnotation = {
      id: 'long', pageNumber: 1, label: 'Long', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.35, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.85, y: 0.5 }],
      pointIds: ['l1', 'l2', 'l3', 'l4'], segmentIds: ['ls1', 'ls2', 'ls3'],
    }
    const base = empty({ annotations: [source, longCircuit], packageAnnotationIds: ['source', 'long'] })
    let draft = sourceDraft(base)
    draft = addSegment(draft, longCircuit, 0)
    draft = addSegment(draft, longCircuit, 1)
    draft = addSegment(draft, longCircuit, 2)
    const removed = removePackageAnimationRouteTransition(draft, draft.transitions[1].id)
    expect(validatePackageAnimationRouteDraft(removed).map((entry) => entry.code)).toContain('disconnected-segment')
  })

  it('accepts a valid direct-transition reorder and rejects a disconnected geometry reorder', () => {
    let direct = sourceDraft()
    direct = addPackageAnimationDirectTransition(direct, 'fixture-1').draft
    direct = addPackageAnimationDirectTransition(direct, 'fixture-2').draft
    expect(movePackageAnimationRouteTransition(direct, direct.transitions[1].id, 'up').accepted).toBe(true)

    let geometric = addSegment(sourceDraft(), circuit, 0)
    geometric = addSegment(geometric, circuit, 1)
    const invalid = movePackageAnimationRouteTransition(geometric, geometric.transitions[1].id, 'up')
    expect(invalid.accepted).toBe(false)
    expect(invalid.message).toContain('break route continuity')
  })

  it('changes an edge channel without changing geometry or membership', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const changed = updatePackageAnimationRouteChannel(draft, draft.transitions[0].id, 'emergency-power')
    expect(changed.transitions[0]).toMatchObject({ channel: 'emergency-power', segmentId: 's1' })
    expect(changed.packageAnnotationIds).toEqual(draft.packageAnnotationIds)
  })

  it('converts a valid draft to a graph-compatible persisted scene', () => {
    let draft = addSegment(sourceDraft(), circuit, 0)
    draft = addSegment(draft, circuit, 1)
    const result = packageAnimationRouteDraftToScene(draft, '2026-07-19T01:00:00.000Z')
    expect(result.issues.filter((entry) => entry.severity === 'error')).toEqual([])
    expect(result.scene).toMatchObject({ id: 'scene-1', createdAt: '2026-07-19T00:00:00.000Z' })
    expect(result.scene?.nodes).toHaveLength(3)
    expect(result.scene?.manualTraversal.map((step) => step.edgeId)).toEqual(result.scene?.edges.map((edge) => edge.id))
  })

  it('loads a supported saved scene and preserves identity, revision baseline, and playback defaults', () => {
    const original = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    original.playbackOptions.travelSpeed = 0.77
    const loaded = loadPackageAnimationRouteDraft({
      packageId: 'package', packageName: 'Lighting', packageAnnotationIds: allAnnotations().map((entry) => entry.id), annotations: allAnnotations(),
      scene: original, expectedBaseRevision: 7,
    })
    expect(loaded).toMatchObject({ sceneId: 'scene-1', createdAt: '2026-07-19T00:00:00.000Z', expectedBaseRevision: 7, dirty: false })
    expect(loaded.playbackOptions.travelSpeed).toBe(0.77)
    expect(loaded.transitions).toHaveLength(1)
  })

  it('refuses destructive editing of multi-source and branch scenes', () => {
    const scene = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    scene.sources.push({ id: 'source-2', nodeId: scene.nodes[0].id })
    const loaded = loadPackageAnimationRouteDraft({ packageId: 'package', packageName: 'Lighting', packageAnnotationIds: allAnnotations().map((entry) => entry.id), annotations: allAnnotations(), scene, expectedBaseRevision: 1 })
    expect(loaded.readOnlyReason).toContain('multiple')
  })

  it('keeps a caller draft intact when conversion/save handling reports a conflict', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const snapshot = structuredClone(draft)
    packageAnimationRouteDraftToScene(draft)
    const simulatedConflict = { success: false, callerDraft: snapshot }
    expect(simulatedConflict.callerDraft).toEqual(draft)
    expect(draft).toEqual(snapshot)
  })

  it('keeps an unsupported future scene read-only and does not coerce it', () => {
    const future = { schemaVersion: 99, id: 'future', futureGraph: { branches: true } }
    const loaded = loadPackageAnimationRouteDraft({ packageId: 'package', packageName: 'Lighting', packageAnnotationIds: [], annotations: [], scene: future, expectedBaseRevision: 12 })
    expect(loaded.readOnlyReason).toContain('newer app version')
    expect(summarizePackageAnimationScene(future, [], [])).toMatchObject({ state: 'unsupported', advanced: true })
  })

  it('reports package membership violations and rejects out-of-package picks', () => {
    const base = empty({ packageAnnotationIds: ['source'] })
    const draft = sourceDraft(base)
    const result = addPackageAnimationRouteSegment(draft, segmentPick(circuit, 0))
    expect(result.accepted).toBe(false)
    expect(result.message).toContain('work package')
  })

  it('blocks saving stale geometry fingerprints without remapping the stable segment', () => {
    const original = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    const changedAnnotations = allAnnotations().map((entry) => entry.id === 'circuit'
      ? { ...entry, points: [{ x: 0.1, y: 0.5 }, { x: 0.55, y: 0.5 }, { x: 0.9, y: 0.5 }] }
      : entry)
    const loaded = loadPackageAnimationRouteDraft({ packageId: 'package', packageName: 'Lighting', packageAnnotationIds: changedAnnotations.map((entry) => entry.id), annotations: changedAnnotations, scene: original, expectedBaseRevision: 1 })
    expect(validatePackageAnimationRouteDraft(loaded).map((entry) => entry.code)).toContain('geometry-fingerprint-mismatch')
    expect(loaded.transitions[0]).toMatchObject({ kind: 'segment', segmentId: 's1' })
  })
})

// ── ANIM-2B1 post-save reconciliation ──
// Regression cover for the reported bug: a verified save left the builder open, dirty and still
// holding its pre-save expectedBaseRevision, so the very next Save was rejected against this
// device's own freshly stored revision and surfaced as "another device changed this route".

interface FakeScopeLayer {
  id: string
  name: string
  selectedAnnotationIds: string[]
  itemRefs: Array<{ annotationId: string; pageNumber: number }>
  animationScene?: unknown
  animationSceneRevision?: number
}

function packageWith(scene?: unknown, revision?: number): FakeScopeLayer {
  return {
    id: 'package',
    name: 'Lighting',
    selectedAnnotationIds: allAnnotations().map((entry) => entry.id),
    itemRefs: [{ annotationId: 'source', pageNumber: 1 }],
    ...(scene ? { animationScene: scene } : {}),
    ...(revision ? { animationSceneRevision: revision } : {}),
  }
}

function builderState(draft: PackageAnimationRouteDraft) {
  return { sessionId: 'session-1', layerId: 'package', pageNumber: 1, draft, saving: true }
}

/** Verified-success result shape returned by saveOperationsBlueprintScopeLayerAnimationScene. */
function verifiedSave(scene: unknown, revision: number) {
  const savedScene = scene == null ? undefined : { ...structuredClone(scene as any), revision }
  return {
    success: true as const,
    conflict: false as const,
    localSaved: true,
    cloudSynced: true,
    scene: savedScene,
    scopeLayer: { ...packageWith(savedScene, revision) },
  }
}

function conflictSave(reason: string, currentScene?: unknown) {
  return {
    success: false as const,
    conflict: true as const,
    localSaved: false,
    cloudSynced: false as const,
    reason,
    message: `Expected revision mismatch (${reason}).`,
    expectedBaseRevision: 1,
    currentScene,
    callerDraft: null,
  }
}

/** Mirrors the viewer's setScopeLayers reconciliation. */
function applySavedLayer(layers: FakeScopeLayer[], saved: FakeScopeLayer): FakeScopeLayer[] {
  return layers.map((layer) => layer.id === saved.id ? saved : layer)
}

/** Mirrors openPackageAnimationRouteBuilder's expected-revision derivation + draft load. */
function reopen(layer: FakeScopeLayer): PackageAnimationRouteDraft {
  const scene = layer.animationScene as any
  const expectedBaseRevision = Math.max(
    Math.max(0, Math.floor(Number(layer.animationSceneRevision) || 0)),
    scene?.schemaVersion === 1 ? Math.max(1, Math.floor(Number(scene.revision) || 1)) : 0,
  )
  const options = {
    packageId: layer.id,
    packageName: layer.name,
    packageAnnotationIds: [...layer.selectedAnnotationIds],
    annotations: allAnnotations(),
    expectedBaseRevision,
  }
  return scene
    ? loadPackageAnimationRouteDraft({ ...options, scene })
    : createEmptyPackageAnimationRouteDraft(options)
}

describe('ANIM-2B1 route save reconciliation', () => {
  it('consumes the returned revision, updates the package, clears conflict, cleans the draft, and closes the builder', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    expect(draft.dirty).toBe(true)
    const scene = packageAnimationRouteDraftToScene(draft).scene!
    const state = { ...builderState(draft), conflict: { message: 'stale', sameDevice: true } }

    const outcome = reconcilePackageAnimationRouteSave(state, verifiedSave(scene, 1))

    expect(outcome.status).toBe('saved')
    if (outcome.status !== 'saved') return
    expect(outcome.savedRevision).toBe(1)
    expect(outcome.builder).toBeNull()
    expect(outcome.savedDraft?.dirty).toBe(false)
    expect(outcome.savedDraft?.expectedBaseRevision).toBe(1)
    expect((outcome.scopeLayer.animationScene as any).revision).toBe(1)
    const layers = applySavedLayer([packageWith()], outcome.scopeLayer)
    expect((layers[0].animationScene as any).revision).toBe(1)
  })

  it('advances an existing scene from N to the returned N+1 without producing an immediate stale conflict', () => {
    const first = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    let layers = [packageWith(first, 1)]

    let draft = reopen(layers[0])
    expect(draft.expectedBaseRevision).toBe(1)
    draft = addSegment(draft, circuit, 1)
    const nextScene = packageAnimationRouteDraftToScene(draft).scene!

    const outcome = reconcilePackageAnimationRouteSave(builderState(draft), verifiedSave(nextScene, 2))
    expect(outcome.status).toBe('saved')
    if (outcome.status !== 'saved') return
    expect(outcome.savedRevision).toBe(2)
    layers = applySavedLayer(layers, outcome.scopeLayer)

    // Reopening must now expect 2 — this is the exact step that used to stay at 1 and make the
    // next save collide with this device's own stored revision.
    const reopened = reopen(layers[0])
    expect(reopened.expectedBaseRevision).toBe(2)
    expect(reopened.dirty).toBe(false)
    expect(packageAnimationRouteDraftToScene(reopened).scene?.revision).toBe(2)
    expect(reopened.transitions).toHaveLength(2)
  })

  it('leaves no unsaved-changes warning after a verified save, and none after save-reopen-close', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const scene = packageAnimationRouteDraftToScene(draft).scene!
    const outcome = reconcilePackageAnimationRouteSave(builderState(draft), verifiedSave(scene, 1))
    if (outcome.status !== 'saved') throw new Error('expected saved')

    // Closing after a verified save: builder is gone, and the reconciled draft is clean.
    expect(outcome.builder).toBeNull()
    expect(outcome.savedDraft?.dirty).toBe(false)

    const reopened = reopen(applySavedLayer([packageWith()], outcome.scopeLayer)[0])
    expect(reopened.dirty).toBe(false)
  })

  it('preserves the saved route order and channels through save and reopen', () => {
    let draft = addSegment(sourceDraft(), circuit, 0)
    draft = addSegment(draft, circuit, 1)
    draft = updatePackageAnimationRouteChannel(draft, draft.transitions[1].id, 'switched-line-voltage')
    const scene = packageAnimationRouteDraftToScene(draft).scene!

    const outcome = reconcilePackageAnimationRouteSave(builderState(draft), verifiedSave(scene, 3))
    if (outcome.status !== 'saved') throw new Error('expected saved')
    const reopened = reopen(applySavedLayer([packageWith()], outcome.scopeLayer)[0])

    expect(reopened.expectedBaseRevision).toBe(3)
    expect(reopened.source?.annotationId).toBe('source')
    expect(reopened.transitions.map((entry) => (entry as any).segmentId)).toEqual(['s1', 's2'])
    expect(reopened.transitions[1].channel).toBe('switched-line-voltage')
  })

  it('keeps a real remote conflict open, dirty and unreconciled, and does not touch the local package', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const remoteScene = { ...packageAnimationRouteDraftToScene(draft).scene!, revision: 2 }
    const layers = [packageWith(packageAnimationRouteDraftToScene(draft).scene!, 1)]

    const outcome = reconcilePackageAnimationRouteSave(builderState(draft), conflictSave('stale-remote-revision', remoteScene))

    expect(outcome.status).toBe('conflict')
    if (outcome.status !== 'conflict') return
    expect(outcome.conflict.message).toContain('Another device changed')
    expect(outcome.conflict.sameDevice).toBe(false)
    expect(outcome.conflict.latestRevision).toBe(2)
    expect(outcome.builder?.saving).toBe(false)
    expect(outcome.builder?.draft).toEqual(draft)
    expect(outcome.builder?.draft.dirty).toBe(true)
    expect(outcome.builder?.draft.expectedBaseRevision).toBe(draft.expectedBaseRevision)
    expect((layers[0].animationScene as any).revision).toBe(1)
  })

  it('does not blame another device when this device is simply ahead of the builder', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const localScene = { ...packageAnimationRouteDraftToScene(draft).scene!, revision: 2 }

    const outcome = reconcilePackageAnimationRouteSave(builderState(draft), conflictSave('stale-local-revision', localScene))

    expect(outcome.status).toBe('conflict')
    if (outcome.status !== 'conflict') return
    expect(outcome.conflict.sameDevice).toBe(true)
    expect(outcome.conflict.message).not.toContain('Another device')
    expect(outcome.conflict.message).toContain('out of date')
    expect(outcome.conflict.latestRevision).toBe(2)
    expect(outcome.builder?.draft.dirty).toBe(true)
  })

  it('keeps the draft open without success on remote-conflict-unresolved', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const outcome = reconcilePackageAnimationRouteSave(builderState(draft), conflictSave('remote-conflict-unresolved', undefined))

    expect(outcome.status).toBe('conflict')
    if (outcome.status !== 'conflict') return
    expect(outcome.conflict.message).toContain('could not be verified')
    expect(outcome.conflict.latestRevision).toBeUndefined()
    expect(outcome.builder).not.toBeNull()
    expect(outcome.builder?.draft).toEqual(draft)
  })

  it('never treats a result without a verified scope layer as saved', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const outcome = reconcilePackageAnimationRouteSave(builderState(draft), { success: true } as any)
    expect(outcome.status).toBe('conflict')
  })

  it('invokes the public saver exactly once while the first save is still pending', async () => {
    const guard = createSingleFlightGuard()
    let calls = 0
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => { release = resolve })

    const save = async () => {
      if (!guard.begin()) return
      try {
        calls += 1
        await pending
      } finally {
        guard.end()
      }
    }

    const first = save()
    const second = save() // double tap before the first resolves
    expect(calls).toBe(1)
    expect(guard.busy).toBe(true)
    release()
    await Promise.all([first, second])

    expect(calls).toBe(1)
    // A deliberate retry after settling is still allowed.
    expect(guard.busy).toBe(false)
    await save()
    expect(calls).toBe(2)
  })

  it('reconciles a verified scene removal into the package without leaving a dirty draft', () => {
    const scene = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    const layers = [packageWith(scene, 1)]
    const removal = { ...verifiedSave(null, 2), scene: undefined, scopeLayer: { ...packageWith(undefined, 2) } }

    const outcome = reconcilePackageAnimationRouteSave(builderState(reopen(layers[0])), removal)

    expect(outcome.status).toBe('saved')
    if (outcome.status !== 'saved') return
    expect(outcome.savedScene).toBeUndefined()
    expect(outcome.savedRevision).toBe(2)
    expect(outcome.builder).toBeNull()
    expect(outcome.savedDraft?.dirty).toBe(false)
    expect(outcome.savedDraft?.source).toBeUndefined()
    expect(outcome.savedDraft?.transitions).toEqual([])
    const next = applySavedLayer(layers, outcome.scopeLayer)
    expect(next[0].animationScene).toBeUndefined()
    expect(next[0].animationSceneRevision).toBe(2)
  })

  it('performs no local removal when the removal is stale', () => {
    const scene = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    const layers = [packageWith(scene, 1)]
    const remoteScene = { ...scene, revision: 2 }

    const outcome = reconcilePackageAnimationRouteSave(null, conflictSave('stale-remote-revision', remoteScene))

    expect(outcome.status).toBe('conflict')
    if (outcome.status !== 'conflict') return
    expect(outcome.conflict.message).toContain('Another device changed')
    expect(outcome.builder).toBeNull()
    expect((layers[0].animationScene as any).revision).toBe(1)
    expect(layers[0].animationSceneRevision).toBe(1)
  })

  it('opens an existing route clean so closing without edits does not warn', () => {
    const scene = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    const reopened = reopen(packageWith(scene, 1))
    expect(reopened.dirty).toBe(false)
    expect(reopened.expectedBaseRevision).toBe(1)
  })

  it('opens a saved revision-2 scene clean, at revision 2, with no conflict', () => {
    const scene = { ...packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!, revision: 2 }
    const session = openPackageAnimationRouteSession({
      layer: packageWith(scene, 2), annotations: allAnnotations(), pageNumber: 1, sessionId: 's1',
    })

    expect(session.draft.expectedBaseRevision).toBe(2)
    expect(session.draft.dirty).toBe(false)
    expect(session.conflict).toBeUndefined()
    expect(session.saving).toBe(false)
    expect(session.draft.transitions).toHaveLength(1)
  })

  it('prefers the canonical package over a stale clicked card object', () => {
    const sceneOne = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    let draftTwo = addSegment(sourceDraft(), circuit, 0)
    draftTwo = addSegment(draftTwo, circuit, 1)
    const sceneTwo = { ...packageAnimationRouteDraftToScene(draftTwo).scene!, revision: 2 }

    const staleCard = packageWith(sceneOne, 1)
    const canonical = packageWith(sceneTwo, 2)
    const layers = [canonical]

    // Mirrors the viewer resolving the clicked card id against canonical scopeLayers.
    const resolved = layers.find((entry) => entry.id === staleCard.id) || staleCard
    const session = openPackageAnimationRouteSession({
      layer: resolved, annotations: allAnnotations(), pageNumber: 1, sessionId: 's1',
    })

    expect(resolvePackageAnimationRouteBaseRevision(staleCard)).toBe(1)
    expect(session.draft.expectedBaseRevision).toBe(2)
    expect(session.draft.transitions).toHaveLength(2)
    expect(session.conflict).toBeUndefined()
    expect(session.draft.dirty).toBe(false)
  })

  it('does not mark a loaded scene dirty when normalization fills equivalent defaults', () => {
    const scene = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    // Strip defaulted playback fields and let the parser restore them.
    const stripped = { ...structuredClone(scene), playbackOptions: undefined, branchOrders: undefined, events: undefined }
    const session = openPackageAnimationRouteSession({
      layer: packageWith(stripped, 1), annotations: allAnnotations(), pageNumber: 1, sessionId: 's1',
    })
    expect(session.draft.dirty).toBe(false)
    expect(session.conflict).toBeUndefined()
  })

  it('auto-rebases a clean builder when the canonical package advances', () => {
    const sceneOne = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    let draftTwo = addSegment(sourceDraft(), circuit, 0)
    draftTwo = addSegment(draftTwo, circuit, 1)
    const sceneTwo = { ...packageAnimationRouteDraftToScene(draftTwo).scene!, revision: 2 }

    const open = openPackageAnimationRouteSession({
      layer: packageWith(sceneOne, 1), annotations: allAnnotations(), pageNumber: 1, sessionId: 's1',
    })
    const outcome = reconcilePackageAnimationRouteLocalRefresh(open, packageWith(sceneTwo, 2), allAnnotations())

    expect(outcome.status).toBe('rebased')
    expect(outcome.state.draft.expectedBaseRevision).toBe(2)
    expect(outcome.state.draft.dirty).toBe(false)
    expect(outcome.state.conflict).toBeUndefined()
    expect(outcome.state.draft.transitions).toHaveLength(2)
    expect(outcome.state.sessionId).toBe('s1')

    // Idempotent: a second pass over the already-rebased state changes nothing.
    expect(reconcilePackageAnimationRouteLocalRefresh(outcome.state, packageWith(sceneTwo, 2), allAnnotations()).status).toBe('unchanged')
  })

  it('protects a dirty draft when the canonical package advances, without moving its base revision', () => {
    const sceneOne = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    const open = openPackageAnimationRouteSession({
      layer: packageWith(sceneOne, 1), annotations: allAnnotations(), pageNumber: 1, sessionId: 's1',
    })
    const edited = { ...open, draft: addSegment(open.draft, circuit, 1) }
    expect(edited.draft.dirty).toBe(true)
    const sceneTwo = { ...sceneOne, revision: 2 }

    const outcome = reconcilePackageAnimationRouteLocalRefresh(edited, packageWith(sceneTwo, 2), allAnnotations())

    expect(outcome.status).toBe('conflict')
    expect(outcome.state.draft).toEqual(edited.draft)
    expect(outcome.state.draft.dirty).toBe(true)
    expect(outcome.state.draft.expectedBaseRevision).toBe(1)
    expect(outcome.state.conflict?.sameDevice).toBe(true)
    expect(outcome.state.conflict?.latestRevision).toBe(2)
    expect(outcome.state.conflict?.message).not.toContain('Another device')

    // Idempotent: the banner is not rebuilt on every refresh pass.
    expect(reconcilePackageAnimationRouteLocalRefresh(outcome.state, packageWith(sceneTwo, 2), allAnnotations()).status).toBe('unchanged')
  })

  it('never manufactures a local conflict while a save is in flight', () => {
    const sceneOne = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    const open = openPackageAnimationRouteSession({
      layer: packageWith(sceneOne, 1), annotations: allAnnotations(), pageNumber: 1, sessionId: 's1',
    })
    const saving = { ...open, draft: addSegment(open.draft, circuit, 1), saving: true }
    const sceneTwo = { ...sceneOne, revision: 2 }

    const outcome = reconcilePackageAnimationRouteLocalRefresh(saving, packageWith(sceneTwo, 2), allAnnotations())
    expect(outcome.status).toBe('unchanged')
    expect(outcome.state.conflict).toBeUndefined()
  })

  it('does not reconcile against a different package', () => {
    const scene = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    const open = openPackageAnimationRouteSession({
      layer: packageWith(scene, 1), annotations: allAnnotations(), pageNumber: 1, sessionId: 's1',
    })
    const otherPackage = { ...packageWith({ ...scene, revision: 9 }, 9), id: 'package-b' }
    expect(reconcilePackageAnimationRouteLocalRefresh(open, otherPackage, allAnnotations()).status).toBe('unchanged')
  })

  it('does not carry a conflict, saving flag or draft across builder sessions', () => {
    const scene = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    const first = openPackageAnimationRouteSession({
      layer: packageWith(scene, 1), annotations: allAnnotations(), pageNumber: 1, sessionId: 's1',
    })
    const conflicted = {
      ...first,
      saving: true,
      draft: addSegment(first.draft, circuit, 1),
      conflict: { message: 'stale', sameDevice: true, latestRevision: 1, currentScene: scene },
    }

    // Closing is setAnimationRouteBuilder(null); opening package B starts from scratch.
    const packageB = { ...packageWith(undefined, 0), id: 'package-b', name: 'Power' }
    const second = openPackageAnimationRouteSession({
      layer: packageB, annotations: allAnnotations(), pageNumber: 1, sessionId: 's2',
    })

    expect(conflicted.conflict).toBeDefined()
    expect(second.conflict).toBeUndefined()
    expect(second.saving).toBe(false)
    expect(second.layerId).toBe('package-b')
    expect(second.draft.expectedBaseRevision).toBe(0)
    expect(second.draft.dirty).toBe(false)
    expect(second.draft.source).toBeUndefined()
    expect(second.draft.transitions).toEqual([])

    // A late save result from session 1 must not stamp session 2.
    const late = reconcilePackageAnimationRouteSave(conflicted, conflictSave('stale-local-revision', scene))
    expect(late.status).toBe('conflict')
    if (late.status !== 'conflict') return
    expect(late.builder?.sessionId).toBe('s1')
    expect(late.builder?.sessionId).not.toBe(second.sessionId)
  })

  it('reopens clean at N+1 after a verified save', () => {
    const sceneOne = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    const open = openPackageAnimationRouteSession({
      layer: packageWith(sceneOne, 1), annotations: allAnnotations(), pageNumber: 1, sessionId: 's1',
    })
    const edited = { ...open, draft: addSegment(open.draft, circuit, 1) }
    const nextScene = packageAnimationRouteDraftToScene(edited.draft).scene!

    const outcome = reconcilePackageAnimationRouteSave(edited, verifiedSave(nextScene, 2))
    if (outcome.status !== 'saved') throw new Error('expected saved')

    const reopened = openPackageAnimationRouteSession({
      layer: outcome.scopeLayer, annotations: allAnnotations(), pageNumber: 1, sessionId: 's2',
    })
    expect(reopened.draft.expectedBaseRevision).toBe(2)
    expect(reopened.draft.dirty).toBe(false)
    expect(reopened.conflict).toBeUndefined()
  })

  it('resolves the base revision from whichever marker is ahead', () => {
    const scene = packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!
    expect(resolvePackageAnimationRouteBaseRevision(packageWith({ ...scene, revision: 3 }, 2))).toBe(3)
    expect(resolvePackageAnimationRouteBaseRevision(packageWith({ ...scene, revision: 1 }, 4))).toBe(4)
    expect(resolvePackageAnimationRouteBaseRevision(packageWith(undefined, 0))).toBe(0)
    expect(resolvePackageAnimationRouteBaseRevision(undefined)).toBe(0)
  })

  it('rebases a draft onto the verified saved scene', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const saved = { ...packageAnimationRouteDraftToScene(draft).scene!, revision: 5 }
    const rebased = markPackageAnimationRouteDraftSaved(draft, saved, 5)
    expect(rebased).toMatchObject({ dirty: false, expectedBaseRevision: 5 })
    expect(rebased.notice).toBeUndefined()
    expect(rebased.transitions).toHaveLength(1)
  })
})
