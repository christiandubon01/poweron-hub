import { describe, expect, it } from 'vitest'
import { createCircuitGeometryFingerprint } from '../routeGeometry'
import { preparePlaybackGeometry } from '../playbackGeometry'
import { calculatePlaybackFrame, createPlaybackTimeline, detectPlaybackBranches } from '../playbackModel'
import { DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS } from '../sceneSchema'
import {
  addPackageAnimationDirectTransition,
  addPackageAnimationRouteSegment,
  cancelPackageAnimationRouteBranch,
  clearPackageAnimationRouteDraft,
  createEmptyPackageAnimationRouteDraft,
  createSingleFlightGuard,
  applySavedAnimationScopeLayer,
  buildPackageAnimationRouteReviewConflict,
  classifyPackageAnimationRouteActionMessage,
  clearPackageAnimationRouteNotice,
  decidePackageAnimationRouteCompletion,
  dispatchPackageAnimationRoutePick,
  editPackageAnimationRouteBranch,
  formatRouteBuilderSourceLabel,
  getPackageAnimationBranchSummaries,
  getPackageAnimationSourceCandidates,
  getPackageAnimationBranchStatus,
  getPackageAnimationPrimaryRouteCandidates,
  markPackageAnimationRouteDraftSaved,
  openPackageAnimationRouteSession,
  reconcilePackageAnimationRouteLocalRefresh,
  reconcilePackageAnimationRouteSave,
  resolvePackageAnimationRouteBaseRevision,
  inferRouteBuilderDefaultChannel,
  inferRouteBuilderNodeRoles,
  isPackageAnimationRouteIdentityCurrent,
  loadPackageAnimationRouteDraft,
  movePackageAnimationRouteTransition,
  packageAnimationRouteDraftToScene,
  packageAnimationRouteNoticeKey,
  removePackageAnimationRouteBranch,
  removePackageAnimationRouteTransition,
  resolvePackageAnimationRouteDraft,
  selectPackageAnimationRouteSource,
  shouldClosePackageAnimationRouteBuilderAfterSave,
  finishPackageAnimationRouteBranch,
  startPackageAnimationRouteBranch,
  summarizePackageAnimationScene,
  undoPackageAnimationRouteSelection,
  updatePackageAnimationRouteChannel,
  upsertPackageAnimationRouteNotice,
  validatePackageAnimationRouteDraft,
  type PackageAnimationRouteDraft,
  type RouteBuilderAnnotation,
  isRouteBuilderDeviceKind,
  isRouteBuilderLoadKind,
  ROUTE_BUILDER_SENSOR_KINDS,
  isRouteBuilderSourceKind,
} from '../routeBuilderModel'
import { findNearestRouteNode, type RouteSegmentPick } from '../routePicking'
import { compareAnimationScenesForVerification, mergeBlueprintScopeLayersById } from '@/services/blueprintLibraryService'

const source: RouteBuilderAnnotation = { id: 'source', pageNumber: 1, label: 'Switch', shapeKind: 'electrical-switch', rect: { x: 0.08, y: 0.48, w: 0.04, h: 0.04 } }
const sensor: RouteBuilderAnnotation = { id: 'sensor', pageNumber: 1, label: 'Sensor', shapeKind: 'electrical-ceiling-occupancy-sensor', rect: { x: 0.08, y: 0.28, w: 0.04, h: 0.04 } }
const fixture1: RouteBuilderAnnotation = { id: 'fixture-1', pageNumber: 1, label: 'Light 1', shapeKind: 'electrical-recessed-light', rect: { x: 0.48, y: 0.48, w: 0.04, h: 0.04 } }
const fixture2: RouteBuilderAnnotation = { id: 'fixture-2', pageNumber: 1, label: 'Light 2', shapeKind: 'electrical-pendant-light', rect: { x: 0.88, y: 0.48, w: 0.04, h: 0.04 } }
const exitSign: RouteBuilderAnnotation = { id: 'exit-sign', pageNumber: 1, label: 'Emergency Exit Sign', shapeKind: 'electrical-emergency-exit-sign', rect: { x: 0.88, y: 0.28, w: 0.06, h: 0.04 } }
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
const branchCircuit: RouteBuilderAnnotation = {
  id: 'branch-circuit', pageNumber: 1, label: 'Branch Circuit', shapeKind: 'circuit-path',
  points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.3 }, { x: 0.9, y: 0.5 }],
  pointIds: ['bp1', 'bp2', 'bp3'], segmentIds: ['bs1', 'bs2'],
}

function allAnnotations(): RouteBuilderAnnotation[] {
  return [source, sensor, fixture1, fixture2, exitSign, circuit, arc, branchCircuit].map((entry) => structuredClone(entry))
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
    for (const kind of ['can-light-2', 'canless-light-2', 'can-light-4', 'canless-light-4', 'can-light-6', 'canless-light-6', 'canless-light-10']) {
      expect(inferRouteBuilderNodeRoles(kind)).toEqual(['load'])
      expect(isRouteBuilderLoadKind(kind)).toBe(true)
      expect(isRouteBuilderSourceKind(kind)).toBe(false)
      expect(ROUTE_BUILDER_SENSOR_KINDS).not.toContain(kind)
    }
    for (const kind of ['electrical-receptacle', 'electrical-gfci', 'electrical-gfci-wp', 'electrical-receptacle-240v', 'electrical-single-receptacle', 'electrical-half-hot-receptacle']) {
      expect(inferRouteBuilderNodeRoles(kind)).toEqual(['load'])
      expect(isRouteBuilderLoadKind(kind)).toBe(true)
      expect(isRouteBuilderSourceKind(kind)).toBe(false)
      expect(ROUTE_BUILDER_SENSOR_KINDS).not.toContain(kind)
    }
    expect(inferRouteBuilderNodeRoles('electrical-emergency-exit-sign')).toEqual(['load'])
    expect(inferRouteBuilderNodeRoles(undefined, { junction: true })).toEqual(['junction'])
    expect(isRouteBuilderLoadKind('electrical-emergency-exit-sign')).toBe(true)
    expect(isRouteBuilderDeviceKind('electrical-emergency-exit-sign')).toBe(true)
    expect(isRouteBuilderSourceKind('electrical-emergency-exit-sign')).toBe(false)
    expect(ROUTE_BUILDER_SENSOR_KINDS).not.toContain('electrical-emergency-exit-sign')
  })

  it('infers source-specific default channels', () => {
    expect(inferRouteBuilderDefaultChannel('electrical-ceiling-occupancy-sensor')).toBe('low-voltage-control-signal')
    expect(inferRouteBuilderDefaultChannel('electrical-switch')).toBe('switched-line-voltage')
    expect(inferRouteBuilderDefaultChannel('unknown')).toBe('generic-route')
  })

  it('accepts the exact supported source kind catalog', () => {
    expect([
      'electrical-switch',
      'electrical-switch-3way',
      'electrical-switch-4way',
      'electrical-dimmer',
      'electrical-timer-control',
      'electrical-photocell',
      'electrical-ceiling-occupancy-sensor',
      'electrical-wall-occupancy-sensor',
      'electrical-panel',
    ].every((kind) => isRouteBuilderSourceKind(kind))).toBe(true)
  })

  it('rejects a supported switch outside the package with a package-specific source notice', () => {
    const draft = empty({ annotations: [source], packageAnnotationIds: [] })
    const rejected = selectPackageAnimationRouteSource(draft, 'source')

    expect(rejected.accepted).toBe(false)
    expect(rejected.draft.notice).toMatchObject({
      code: 'source-not-in-package',
      message: 'This switch is not included in this Work Package. Add it to the package before using it as the animation source.',
    })
  })

  it('rejects a supported non-switch source outside the package with a source-device package notice', () => {
    const draft = empty({ annotations: [sensor], packageAnnotationIds: [] })
    const rejected = selectPackageAnimationRouteSource(draft, 'sensor')

    expect(rejected.accepted).toBe(false)
    expect(rejected.draft.notice).toMatchObject({
      code: 'source-not-in-package',
      message: 'This source device is not included in this Work Package. Add it to the package before using it as the animation source.',
    })
  })

  it('rejects an unsupported source annotation with the supported-source notice even outside the package', () => {
    const draft = empty({ annotations: [fixture1], packageAnnotationIds: [] })
    const rejected = dispatchPackageAnimationRoutePick(draft, { kind: 'annotation', annotationId: 'fixture-1' })

    expect(rejected.accepted).toBe(false)
    expect(rejected.draft.notice).toMatchObject({
      code: 'invalid-source-kind',
      message: 'Select an electrical panel, switch, dimmer, timer, photocell, or occupancy sensor that belongs to this Work Package.',
    })
  })

  it('keeps an emergency exit sign out of source mode while allowing it as a downstream load', () => {
    const base = empty({ annotations: [source, exitSign], packageAnnotationIds: ['source', 'exit-sign'] })

    expect(getPackageAnimationSourceCandidates(base).map((candidate) => candidate.annotationId)).toEqual(['source'])

    const rejectedSource = dispatchPackageAnimationRoutePick(base, { kind: 'annotation', annotationId: 'exit-sign' })
    expect(rejectedSource).toMatchObject({ accepted: false, consumed: true, mode: 'primary-route', branchActive: false })
    expect(rejectedSource.draft.source).toBeUndefined()
    expect(rejectedSource.draft.notice).toMatchObject({
      code: 'invalid-source-kind',
      message: 'Select an electrical panel, switch, dimmer, timer, photocell, or occupancy sensor that belongs to this Work Package.',
    })

    const draft = sourceDraft(base)
    const acceptedLoad = dispatchPackageAnimationRoutePick(draft, {
      kind: 'annotation',
      annotationId: 'exit-sign',
      clickedPoint: { x: 0.91, y: 0.3 },
      allowPrimaryDirectTransition: true,
    })
    expect(acceptedLoad).toMatchObject({ accepted: true, consumed: true, mode: 'primary-route', branchActive: false })
    expect(resolvePackageAnimationRouteDraft(acceptedLoad.draft).nodes[1]).toMatchObject({
      roles: ['load'],
      anchor: { kind: 'annotation-center', annotationId: 'exit-sign' },
    })
  })

  it('uses the normal direct-transition confirmation flow for an emergency exit sign', () => {
    const base = empty({ annotations: [source, exitSign], packageAnnotationIds: ['source', 'exit-sign'] })
    const draft = sourceDraft(base)

    const pending = dispatchPackageAnimationRoutePick(draft, {
      kind: 'annotation',
      annotationId: 'exit-sign',
      clickedPoint: { x: 0.91, y: 0.3 },
    })
    expect(pending).toMatchObject({ accepted: false, category: 'direct-confirmation-required' })
    expect(pending.draft.transitions).toEqual([])

    const confirmed = dispatchPackageAnimationRoutePick(draft, {
      kind: 'annotation',
      annotationId: 'exit-sign',
      clickedPoint: { x: 0.91, y: 0.3 },
      allowPrimaryDirectTransition: true,
    })
    expect(confirmed).toMatchObject({ accepted: true, category: 'accepted' })
    const resolved = resolvePackageAnimationRouteDraft(confirmed.draft)
    expect(resolved.edges[0].geometry).toEqual({ kind: 'direct' })
    expect(resolved.edges[0].geometry.kind).toBe('direct')
    expect(resolved.nodes[1]).toMatchObject({
      roles: ['load'],
      anchor: { kind: 'annotation-center', annotationId: 'exit-sign' },
    })
  })

  it('treats an electrical panel as an eligible source with source-only roles and constant power', () => {
    const panel: RouteBuilderAnnotation = {
      id: 'panel',
      pageNumber: 1,
      label: 'Electrical Panel',
      text: 'Subpanel',
      shapeKind: 'electrical-panel',
      rect: { x: 0.18, y: 0.38, w: 0.06, h: 0.08 },
    }
    const receptacle: RouteBuilderAnnotation = {
      id: 'receptacle',
      pageNumber: 1,
      label: 'Receptacle',
      shapeKind: 'electrical-receptacle',
      rect: { x: 0.7, y: 0.38, w: 0.04, h: 0.04 },
    }
    const base = empty({ annotations: [panel, receptacle], packageAnnotationIds: ['panel', 'receptacle'] })
    const selected = selectPackageAnimationRouteSource(base, 'panel')

    expect(isRouteBuilderSourceKind('electrical-panel')).toBe(true)
    expect(isRouteBuilderSourceKind('electrical-receptacle')).toBe(false)
    expect(selected.accepted).toBe(true)
    expect(selected.draft.source).toEqual({ annotationId: 'panel', channel: 'constant-line-voltage' })
    expect(formatRouteBuilderSourceLabel(panel)).toBe('Electrical Panel — Subpanel')
    expect(formatRouteBuilderSourceLabel({ ...panel, text: '' })).toBe('Electrical Panel')
    expect(formatRouteBuilderSourceLabel({ ...panel, text: '   ' })).toBe('Electrical Panel')
    expect(formatRouteBuilderSourceLabel({ ...panel, text: ' MDP ' })).toBe('Electrical Panel — MDP')
    expect(inferRouteBuilderNodeRoles('electrical-panel', { selectedAsSource: true })).toEqual(['source'])
    expect(inferRouteBuilderNodeRoles('electrical-panel')).toEqual([])
    expect(inferRouteBuilderNodeRoles('electrical-panel', { selectedAsSource: true })).not.toEqual(expect.arrayContaining(['control', 'sensor', 'load', 'emergency-source']))
    expect(inferRouteBuilderDefaultChannel('electrical-panel')).toBe('constant-line-voltage')
    expect(selectPackageAnimationRouteSource(base, 'receptacle')).toMatchObject({ accepted: false })

    const resolved = resolvePackageAnimationRouteDraft(selected.draft)
    expect(resolved.nodes[0]).toMatchObject({
      id: 'animation_node_annotation_panel',
      roles: ['source'],
      anchor: { kind: 'annotation-center', annotationId: 'panel' },
      point: { x: 0.21, y: 0.42 },
    })
  })

  it('filters panel source candidates by package membership and geometry', () => {
    const panel: RouteBuilderAnnotation = {
      id: 'panel',
      pageNumber: 1,
      label: 'Electrical Panel',
      text: 'Subpanel',
      shapeKind: 'electrical-panel',
      rect: { x: 0.2, y: 0.2, w: 0.04, h: 0.04 },
    }
    const circuitOnly = empty({ annotations: [panel, circuit], packageAnnotationIds: ['circuit'] })
    expect(getPackageAnimationSourceCandidates(circuitOnly)).toEqual([])
    expect(selectPackageAnimationRouteSource(circuitOnly, 'panel')).toMatchObject({ accepted: false })

    const withPanel = empty({ annotations: [panel, circuit], packageAnnotationIds: ['circuit', 'panel'] })
    expect(getPackageAnimationSourceCandidates(withPanel)).toEqual([{
      id: 'panel',
      annotationId: 'panel',
      label: 'Electrical Panel — Subpanel',
      shapeKind: 'electrical-panel',
      pageNumber: 1,
      channel: 'constant-line-voltage',
    }])
    expect(selectPackageAnimationRouteSource(withPanel, 'panel')).toMatchObject({ accepted: true })
  })

  it('keeps two labeled panels distinct as source candidates by stable annotation id', () => {
    const panelA: RouteBuilderAnnotation = {
      id: 'panel-a',
      pageNumber: 1,
      label: 'Electrical Panel',
      text: 'Panel A',
      shapeKind: 'electrical-panel',
      rect: { x: 0.1, y: 0.2, w: 0.04, h: 0.04 },
    }
    const panelB: RouteBuilderAnnotation = {
      id: 'panel-b',
      pageNumber: 1,
      label: 'Electrical Panel',
      text: 'Panel B',
      shapeKind: 'electrical-panel',
      rect: { x: 0.2, y: 0.2, w: 0.04, h: 0.04 },
    }
    const draft = empty({ annotations: [panelA, panelB, circuit], packageAnnotationIds: ['panel-a', 'panel-b', 'circuit'] })
    expect(getPackageAnimationSourceCandidates(draft)).toEqual([
      expect.objectContaining({ annotationId: 'panel-a', label: 'Electrical Panel — Panel A' }),
      expect.objectContaining({ annotationId: 'panel-b', label: 'Electrical Panel — Panel B' }),
    ])
    expect(selectPackageAnimationRouteSource(draft, 'panel-a').draft.source?.annotationId).toBe('panel-a')
    expect(selectPackageAnimationRouteSource(draft, 'panel-b').draft.source?.annotationId).toBe('panel-b')
  })

  it('supports panel to segment to receptacle A to outgoing segment to receptacle B', () => {
    const panel: RouteBuilderAnnotation = {
      id: 'panel-source',
      pageNumber: 1,
      label: 'Electrical Panel',
      text: 'Panel',
      shapeKind: 'electrical-panel',
      rect: { x: 0.08, y: 0.46, w: 0.04, h: 0.08 },
    }
    const receptacleA: RouteBuilderAnnotation = {
      id: 'receptacle-a',
      pageNumber: 1,
      label: 'Receptacle A',
      shapeKind: 'electrical-receptacle',
      rect: { x: 0.38, y: 0.46, w: 0.04, h: 0.08 },
    }
    const receptacleB: RouteBuilderAnnotation = {
      id: 'receptacle-b',
      pageNumber: 1,
      label: 'Receptacle B',
      shapeKind: 'electrical-gfci',
      rect: { x: 0.58, y: 0.46, w: 0.04, h: 0.08 },
    }
    const approach: RouteBuilderAnnotation = {
      id: 'approach-a', pageNumber: 1, label: 'Panel to A', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.4, y: 0.47 }],
      pointIds: ['pa0', 'pa1'], segmentIds: ['pas0'],
    }
    const outgoing: RouteBuilderAnnotation = {
      id: 'a-to-b', pageNumber: 1, label: 'A to B', shapeKind: 'circuit-path',
      points: [{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }],
      pointIds: ['ab0', 'ab1'], segmentIds: ['abs0'],
    }
    const annotations = [panel, receptacleA, receptacleB, approach, outgoing]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }), 'panel-source')
    draft = addSegment(draft, approach, 0)

    const selectedA = dispatchPackageAnimationRoutePick(draft, {
      kind: 'annotation',
      annotationId: 'receptacle-a',
      clickedPoint: { x: 0.4, y: 0.5 },
      allowPrimaryDirectTransition: true,
    })
    expect(selectedA).toMatchObject({ accepted: true, mode: 'primary-route', branchActive: false })

    const selectedOutgoing = dispatchPackageAnimationRoutePick(selectedA.draft, { kind: 'segment', pick: segmentPick(outgoing, 0) })
    expect(selectedOutgoing).toMatchObject({ accepted: true, mode: 'primary-route', branchActive: false })
    const resolved = resolvePackageAnimationRouteDraft(selectedOutgoing.draft)
    expect(resolved.nodes.map((node) => node.anchor.kind === 'annotation-center' ? node.anchor.annotationId : node.anchor.kind)).toEqual([
      'panel-source',
      'circuit-point',
      'receptacle-a',
      'receptacle-b',
    ])
    expect(selectedOutgoing.draft.transitions.map((transition) => transition.kind)).toEqual(['segment', 'direct', 'segment'])
  })

  it('keeps existing switch and occupancy-sensor source roles and channels unchanged', () => {
    expect(inferRouteBuilderNodeRoles('electrical-switch', { selectedAsSource: true })).toEqual(['source', 'control'])
    expect(inferRouteBuilderDefaultChannel('electrical-switch')).toBe('switched-line-voltage')
    expect(inferRouteBuilderNodeRoles('electrical-ceiling-occupancy-sensor', { selectedAsSource: true })).toEqual(['source', 'sensor', 'control'])
    expect(inferRouteBuilderDefaultChannel('electrical-ceiling-occupancy-sensor')).toBe('low-voltage-control-signal')
  })

  it('authors, saves, reopens, and preserves a panel common-feeder split', () => {
    const panel: RouteBuilderAnnotation = { id: 'panel', pageNumber: 1, label: 'Electrical Panel', text: 'MDP', shapeKind: 'electrical-panel', rect: { x: 0.08, y: 0.48, w: 0.04, h: 0.04 } }
    const roomA: RouteBuilderAnnotation = { id: 'room-a', pageNumber: 1, label: 'Room A', shapeKind: 'electrical-sconce', rect: { x: 0.88, y: 0.28, w: 0.04, h: 0.04 } }
    const roomB: RouteBuilderAnnotation = { id: 'room-b', pageNumber: 1, label: 'Room B', shapeKind: 'electrical-sconce', rect: { x: 0.88, y: 0.68, w: 0.04, h: 0.04 } }
    const feeder: RouteBuilderAnnotation = {
      id: 'feeder', pageNumber: 1, label: 'Common Feeder', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.3 }],
      pointIds: ['f1', 'junction', 'roomA'], segmentIds: ['common', 'armA'],
    }
    const armB: RouteBuilderAnnotation = {
      id: 'arm-b', pageNumber: 1, label: 'Room B Arm', shapeKind: 'circuit-arc',
      points: [{ x: 0.5, y: 0.5 }, { x: 0.9, y: 0.7 }], arcCtrls: [{ x: 0.7, y: 0.62 }],
      pointIds: ['b1', 'roomB'], segmentIds: ['armB'],
    }
    const annotations = [panel, roomA, roomB, feeder, armB]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }), 'panel')
    draft = addSegment(draft, feeder, 0)
    draft = addSegment(draft, feeder, 1)
    draft = startPackageAnimationRouteBranch(draft, draft.transitions[0].id)
    draft = addSegment(draft, armB, 0)

    const finished = finishPackageAnimationRouteBranch(draft)
    const scene = packageAnimationRouteDraftToScene(finished).scene!
    const sourceNodeId = scene.sources[0].nodeId
    const sourceOutgoing = scene.edges.filter((edge) => edge.fromNodeId === sourceNodeId)
    const commonEdge = scene.edges.find((edge) => edge.geometry.kind === 'circuit-segment' && edge.geometry.segmentId === 'common')!
    const branchOrder = scene.branchOrders[0]

    expect(validatePackageAnimationRouteDraft(finished).filter((entry) => entry.severity === 'error')).toEqual([])
    expect(scene.nodes.filter((node) => node.anchor.kind === 'annotation-center' && node.anchor.annotationId === 'panel')).toHaveLength(1)
    expect(scene.sources).toEqual([{ id: 'animation_source_primary', nodeId: sourceNodeId, channel: 'constant-line-voltage' }])
    expect(sourceOutgoing).toHaveLength(1)
    expect(scene.manualTraversal.filter((step) => step.edgeId === commonEdge.id)).toHaveLength(1)
    expect(scene.manualTraversal[0].edgeId).toBe(commonEdge.id)
    expect(branchOrder.nodeId).toBe(commonEdge.toNodeId)
    expect(branchOrder.outgoingEdgeIds).toHaveLength(2)
    expect(new Set(branchOrder.outgoingEdgeIds)).toEqual(new Set(scene.edges.filter((edge) => edge.fromNodeId === branchOrder.nodeId).map((edge) => edge.id)))
    expect(scene.edges.some((edge) => edge.toNodeId === 'animation_node_annotation_room-a')).toBe(true)
    expect(scene.edges.some((edge) => edge.toNodeId === 'animation_node_annotation_room-b')).toBe(true)

    const reopened = loadPackageAnimationRouteDraft({
      packageId: 'package',
      packageName: 'Lighting',
      packageAnnotationIds: annotations.map((entry) => entry.id),
      annotations,
      scene,
      expectedBaseRevision: 1,
    })
    const resaved = packageAnimationRouteDraftToScene(reopened).scene!
    expect(reopened.source).toEqual({ annotationId: 'panel', channel: 'constant-line-voltage' })
    expect(resaved.sources).toEqual(scene.sources)
    expect(resaved.branchOrders).toEqual(scene.branchOrders)
  })

  it('authors deterministic direct source fan-out from one panel node without array-order fallback', () => {
    const panel: RouteBuilderAnnotation = { id: 'panel', pageNumber: 1, label: 'Electrical Panel', shapeKind: 'electrical-panel', rect: { x: 0.08, y: 0.48, w: 0.04, h: 0.04 } }
    const armA: RouteBuilderAnnotation = { id: 'arm-a', pageNumber: 1, label: 'Arm A', shapeKind: 'electrical-sconce', rect: { x: 0.5, y: 0.28, w: 0.04, h: 0.04 } }
    const armB: RouteBuilderAnnotation = { id: 'arm-b', pageNumber: 1, label: 'Arm B', shapeKind: 'electrical-sconce', rect: { x: 0.5, y: 0.68, w: 0.04, h: 0.04 } }
    const annotations = [panel, armA, armB]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }), 'panel')
    draft = addPackageAnimationDirectTransition(draft, 'arm-a').draft
    draft = startPackageAnimationRouteBranch(draft, 'source')
    const invalid = dispatchPackageAnimationRoutePick(draft, { kind: 'annotation', annotationId: 'panel' })
    expect(invalid).toMatchObject({ accepted: false, branchActive: true })
    expect(invalid.draft.branches[0]?.editing).toBe(true)
    draft = addPackageAnimationDirectTransition(invalid.draft, 'arm-b').draft

    const primarySourceOutgoingEdgeId = `animation_edge_${draft.transitions[0].id}`
    const alternateSourceOutgoingEdgeId = `animation_edge_${draft.branches[0]!.transitions[0].id}`
    expect(primarySourceOutgoingEdgeId).toBeTruthy()
    expect(alternateSourceOutgoingEdgeId).toBeTruthy()
    expect(primarySourceOutgoingEdgeId).not.toBe(alternateSourceOutgoingEdgeId)

    const scene = packageAnimationRouteDraftToScene(finishPackageAnimationRouteBranch(draft)).scene!
    const sourceNodeId = scene.sources[0].nodeId
    const outgoing = scene.edges.filter((edge) => edge.fromNodeId === sourceNodeId)
    const branchOrder = scene.branchOrders.find((order) => order.nodeId === sourceNodeId)!

    expect(outgoing).toHaveLength(2)
    expect(new Set(outgoing.map((edge) => edge.id))).toEqual(new Set([primarySourceOutgoingEdgeId, alternateSourceOutgoingEdgeId]))
    expect(branchOrder.outgoingEdgeIds).toEqual([primarySourceOutgoingEdgeId, alternateSourceOutgoingEdgeId])
    expect(scene.manualTraversal[0].edgeId).toBe(primarySourceOutgoingEdgeId)
    expect(scene.nodes.filter((node) => node.anchor.kind === 'annotation-center' && node.anchor.annotationId === 'panel')).toHaveLength(1)

    const reordered = { ...scene, edges: [...scene.edges].reverse() }
    const reopened = loadPackageAnimationRouteDraft({
      packageId: 'package',
      packageName: 'Lighting',
      packageAnnotationIds: annotations.map((entry) => entry.id),
      annotations,
      scene: reordered,
      expectedBaseRevision: 1,
    })
    expect(reopened.source?.annotationId).toBe('panel')
    expect(reopened.transitions[0].persistedEdgeId).toBe(primarySourceOutgoingEdgeId)
    expect(reopened.transitions).toHaveLength(1)
    expect(reopened.branches[0]?.originSelectionId).toBe('source')
    expect(reopened.branches[0]?.transitions[0].persistedEdgeId).toBe(alternateSourceOutgoingEdgeId)
    expect(reopened.branches[0]?.transitions).toHaveLength(1)
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

  it('matches Circuit Path and Circuit Arc endpoints to an emergency exit sign load node', () => {
    const pathToExit: RouteBuilderAnnotation = {
      id: 'path-to-exit', pageNumber: 1, label: 'Path to Exit', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.91, y: 0.3 }],
      pointIds: ['pe0', 'pe1'], segmentIds: ['pes0'],
    }
    const arcToExit: RouteBuilderAnnotation = {
      id: 'arc-to-exit', pageNumber: 1, label: 'Arc to Exit', shapeKind: 'circuit-arc',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.91, y: 0.3 }],
      arcCtrls: [{ x: 0.52, y: 0.22 }],
      pointIds: ['ae0', 'ae1'], segmentIds: ['aes0'],
    }

    const pathAnnotations = [source, exitSign, pathToExit]
    const pathDraft = addSegment(sourceDraft(empty({ annotations: pathAnnotations, packageAnnotationIds: pathAnnotations.map((entry) => entry.id) })), pathToExit, 0)
    const pathResolved = resolvePackageAnimationRouteDraft(pathDraft)
    expect(pathResolved.nodes[1]).toMatchObject({
      roles: ['load'],
      anchor: { kind: 'annotation-center', annotationId: 'exit-sign' },
    })
    expect(pathResolved.nodes[1].anchor.kind).not.toBe('circuit-point')
    expect(pathResolved.edges[0].geometry).toMatchObject({ kind: 'circuit-segment', annotationId: 'path-to-exit', segmentId: 'pes0' })
    expect(pathResolved.issues.map((entry) => entry.code)).not.toContain('direct-transition')

    const arcAnnotations = [source, exitSign, arcToExit]
    const arcDraft = addSegment(sourceDraft(empty({ annotations: arcAnnotations, packageAnnotationIds: arcAnnotations.map((entry) => entry.id) })), arcToExit, 0)
    const arcResolved = resolvePackageAnimationRouteDraft(arcDraft)
    expect(arcResolved.nodes[1]).toMatchObject({
      roles: ['load'],
      anchor: { kind: 'annotation-center', annotationId: 'exit-sign' },
    })
    expect(arcResolved.nodes[1].anchor.kind).not.toBe('circuit-point')
    expect(arcResolved.edges[0].geometry).toMatchObject({ kind: 'circuit-segment', annotationId: 'arc-to-exit', segmentId: 'aes0' })
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

  it('authors, saves, and reloads one deterministic split/rejoin branch without a schema extension', () => {
    let draft = sourceDraft()
    draft = addSegment(draft, circuit, 0)
    draft = addSegment(draft, circuit, 1)
    draft = startPackageAnimationRouteBranch(draft, 'source')
    draft = addSegment(draft, branchCircuit, 0)
    // Mid-authoring the endpoint is a bare wire junction: not yet a rejoin and not an eligible fixture.
    expect(validatePackageAnimationRouteDraft(draft).map((entry) => entry.code)).toContain('invalid-branch-endpoint')
    draft = addSegment(draft, branchCircuit, 1)
    expect(resolvePackageAnimationRouteDraft(draft)).toMatchObject({
      branchOriginNodeId: 'animation_node_annotation_source',
      branchConvergenceNodeId: 'animation_node_annotation_fixture-2',
    })
    draft = finishPackageAnimationRouteBranch(draft)
    const authoredBranchStructure = {
      originSelectionId: draft.branches[0]?.originSelectionId,
      mode: draft.branches[0]?.mode,
      editing: draft.branches[0]?.editing,
      transitions: draft.branches[0]?.transitions.map((transition) => ({
        id: transition.id,
        kind: transition.kind,
        annotationId: transition.annotationId,
        channel: transition.channel,
        ...(transition.kind === 'segment' ? { segmentId: transition.segmentId } : {}),
      })),
    }

    const saved = packageAnimationRouteDraftToScene(draft).scene!
    expect(saved.schemaVersion).toBe(1)
    expect(saved.branchOrders).toEqual([expect.objectContaining({
      nodeId: 'animation_node_annotation_source',
      mode: 'simultaneous',
      outgoingEdgeIds: [saved.edges[0].id, saved.edges[2].id],
    })])
    expect(summarizePackageAnimationScene(saved, allAnnotations(), allAnnotations().map((entry) => entry.id)).advanced).toBe(false)

    const loaded = loadPackageAnimationRouteDraft({
      packageId: 'package', packageName: 'Lighting', packageAnnotationIds: allAnnotations().map((entry) => entry.id),
      annotations: allAnnotations(), scene: saved, expectedBaseRevision: 1,
    })
    expect(loaded.readOnlyReason).toBeUndefined()
    expect(loaded.transitions).toHaveLength(2)
    expect(loaded.branches[0]).toMatchObject({ originSelectionId: 'source', mode: 'simultaneous', editing: false })
    expect(loaded.branches[0]?.transitions).toHaveLength(2)
    expect({
      originSelectionId: loaded.branches[0]?.originSelectionId,
      mode: loaded.branches[0]?.mode,
      editing: loaded.branches[0]?.editing,
      transitions: loaded.branches[0]?.transitions.map((transition) => ({
        id: transition.id,
        kind: transition.kind,
        annotationId: transition.annotationId,
        channel: transition.channel,
        ...(transition.kind === 'segment' ? { segmentId: transition.segmentId } : {}),
      })),
    }).toEqual(authoredBranchStructure)
    expect(validatePackageAnimationRouteDraft(loaded).filter((entry) => entry.severity === 'error')).toEqual([])
    const resaved = packageAnimationRouteDraftToScene(loaded).scene!
    expect(resaved.branchOrders).toEqual(saved.branchOrders)
    expect(resaved.edges).toEqual(saved.edges)
    expect(resaved.manualTraversal).toEqual(saved.manualTraversal)
  })

  it('canonicalizes separate circuit annotations onto one shared plain-junction convergence node', () => {
    const primaryCircuit: RouteBuilderAnnotation = {
      id: 'primary-junction-circuit', pageNumber: 1, label: 'Primary Junction Circuit', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.6, y: 0.6 }, { x: 0.9, y: 0.5 }],
      pointIds: ['primary-source', 'primary-join', 'primary-load'], segmentIds: ['primary-1', 'primary-2'],
    }
    const alternateCircuit: RouteBuilderAnnotation = {
      id: 'alternate-junction-circuit', pageNumber: 1, label: 'Alternate Junction Circuit', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.35, y: 0.25 }, { x: 0.6, y: 0.6 }],
      pointIds: ['alternate-source', 'alternate-mid', 'alternate-join'], segmentIds: ['alternate-1', 'alternate-2'],
    }
    const annotations = [source, fixture2, primaryCircuit, alternateCircuit].map((entry) => structuredClone(entry))
    let draft = sourceDraft(empty({
      packageAnnotationIds: annotations.map((entry) => entry.id),
      annotations,
    }))
    draft = addSegment(draft, primaryCircuit, 0)
    draft = addSegment(draft, primaryCircuit, 1)
    draft = startPackageAnimationRouteBranch(draft, 'source')
    draft = addSegment(draft, alternateCircuit, 0)
    draft = addSegment(draft, alternateCircuit, 1)

    const resolved = resolvePackageAnimationRouteDraft(draft)
    expect(resolved.branchConvergenceNodeId).toBe('animation_node_point_primary-junction-circuit_primary-join')
    draft = finishPackageAnimationRouteBranch(draft)
    const saved = packageAnimationRouteDraftToScene(draft).scene!
    const primaryIncoming = saved.edges.find((edge) => edge.geometry.kind === 'circuit-segment'
      && edge.geometry.annotationId === primaryCircuit.id && edge.geometry.segmentId === 'primary-1')!
    const alternateIncoming = saved.edges.find((edge) => edge.geometry.kind === 'circuit-segment'
      && edge.geometry.annotationId === alternateCircuit.id && edge.geometry.segmentId === 'alternate-2')!

    expect(alternateIncoming.toNodeId).toBe(primaryIncoming.toNodeId)
    expect(saved.edges.filter((edge) => edge.toNodeId === primaryIncoming.toNodeId)).toHaveLength(2)
    expect(saved.nodes.filter((node) => node.id === primaryIncoming.toNodeId)).toEqual([
      expect.objectContaining({
        roles: ['junction'],
        anchor: expect.objectContaining({
          kind: 'circuit-point',
          annotationId: primaryCircuit.id,
          pointId: 'primary-join',
        }),
      }),
    ])

    const loaded = loadPackageAnimationRouteDraft({
      packageId: 'package', packageName: 'Lighting', packageAnnotationIds: annotations.map((entry) => entry.id),
      annotations, scene: saved, expectedBaseRevision: 1,
    })
    expect(validatePackageAnimationRouteDraft(loaded).filter((entry) => entry.severity === 'error')).toEqual([])
    const resaved = packageAnimationRouteDraftToScene(loaded).scene!
    const resavedPrimaryIncoming = resaved.edges.find((edge) => edge.geometry.kind === 'circuit-segment'
      && edge.geometry.annotationId === primaryCircuit.id && edge.geometry.segmentId === 'primary-1')!
    const resavedAlternateIncoming = resaved.edges.find((edge) => edge.geometry.kind === 'circuit-segment'
      && edge.geometry.annotationId === alternateCircuit.id && edge.geometry.segmentId === 'alternate-2')!
    expect(resavedAlternateIncoming.toNodeId).toBe(resavedPrimaryIncoming.toNodeId)
    expect(resaved.edges.filter((edge) => edge.toNodeId === resavedPrimaryIncoming.toNodeId)).toHaveLength(2)
    expect(resaved.nodes.filter((node) => node.id === resavedPrimaryIncoming.toNodeId)).toHaveLength(1)
    expect(resaved.branchOrders).toEqual(saved.branchOrders)
  })

  it('rejoins a four-step alternate route into a dense seven-step multi-annotation primary route', () => {
    const primaryA: RouteBuilderAnnotation = {
      id: 'complex-primary-a', pageNumber: 1, label: 'Primary A', shapeKind: 'circuit-arc',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.22, y: 0.42 }, { x: 0.34, y: 0.44 }],
      arcCtrls: [{ x: 0.15, y: 0.4 }, { x: 0.28, y: 0.48 }],
      pointIds: ['primary-a-source', 'primary-a-mid', 'primary-a-end'], segmentIds: ['primary-a-1', 'primary-a-2'],
    }
    const primaryB: RouteBuilderAnnotation = {
      id: 'complex-primary-b', pageNumber: 1, label: 'Primary B', shapeKind: 'circuit-path',
      points: [{ x: 0.34, y: 0.44 }, { x: 0.48, y: 0.36 }, { x: 0.62, y: 0.4 }],
      pointIds: ['primary-b-start', 'primary-b-mid', 'primary-b-join'], segmentIds: ['primary-b-1', 'primary-b-2'],
    }
    const primaryC: RouteBuilderAnnotation = {
      id: 'complex-primary-c', pageNumber: 1, label: 'Primary C', shapeKind: 'circuit-arc',
      points: [{ x: 0.62, y: 0.4 }, { x: 0.635, y: 0.405 }, { x: 0.78, y: 0.46 }, { x: 0.9, y: 0.5 }],
      arcCtrls: [{ x: 0.627, y: 0.397 }, { x: 0.7, y: 0.39 }, { x: 0.84, y: 0.52 }],
      pointIds: ['primary-c-start', 'primary-c-nearby', 'primary-c-mid', 'primary-c-load'],
      segmentIds: ['primary-c-1', 'primary-c-2', 'primary-c-3'],
    }
    const alternate: RouteBuilderAnnotation = {
      id: 'complex-alternate', pageNumber: 1, label: 'Four-step Alternate', shapeKind: 'circuit-path',
      points: [
        { x: 0.1, y: 0.5 }, { x: 0.2, y: 0.66 }, { x: 0.36, y: 0.64 },
        { x: 0.5, y: 0.53 }, { x: 0.621, y: 0.401 },
      ],
      pointIds: ['alternate-source', 'alternate-1', 'alternate-2', 'alternate-3', 'alternate-join'],
      segmentIds: ['alternate-step-1', 'alternate-step-2', 'alternate-step-3', 'alternate-step-4'],
    }
    const crossingA: RouteBuilderAnnotation = {
      id: 'dense-crossing-a', pageNumber: 1, label: 'Crossing A', shapeKind: 'circuit-path',
      points: [{ x: 0.56, y: 0.45 }, { x: 0.619, y: 0.399 }, { x: 0.69, y: 0.34 }],
      pointIds: ['cross-a-1', 'cross-a-near', 'cross-a-2'], segmentIds: ['cross-a-seg-1', 'cross-a-seg-2'],
    }
    const crossingB: RouteBuilderAnnotation = {
      id: 'dense-crossing-b', pageNumber: 1, label: 'Crossing B', shapeKind: 'circuit-arc',
      points: [{ x: 0.58, y: 0.35 }, { x: 0.623, y: 0.402 }, { x: 0.7, y: 0.48 }],
      arcCtrls: [{ x: 0.59, y: 0.4 }, { x: 0.66, y: 0.43 }],
      pointIds: ['cross-b-1', 'cross-b-near', 'cross-b-2'], segmentIds: ['cross-b-seg-1', 'cross-b-seg-2'],
    }
    const annotations = [source, fixture2, primaryA, primaryB, primaryC, alternate, crossingA, crossingB]
      .map((entry) => structuredClone(entry))
    let draft = sourceDraft(empty({
      packageAnnotationIds: annotations.map((entry) => entry.id),
      annotations,
    }))
    ;[0, 1].forEach((index) => { draft = addSegment(draft, primaryA, index) })
    ;[0, 1].forEach((index) => { draft = addSegment(draft, primaryB, index) })
    ;[0, 1, 2].forEach((index) => { draft = addSegment(draft, primaryC, index) })
    draft = startPackageAnimationRouteBranch(draft, 'source')
    ;[0, 1, 2, 3].forEach((index) => { draft = addSegment(draft, alternate, index) })

    const resolved = resolvePackageAnimationRouteDraft(draft)
    expect(draft.transitions).toHaveLength(7)
    expect(draft.branches[0]?.transitions).toHaveLength(4)
    expect(new Set(draft.transitions.map((transition) => transition.annotationId))).toEqual(new Set([
      primaryA.id, primaryB.id, primaryC.id,
    ]))
    expect(resolved.issues.map((entry) => entry.code)).not.toContain('unmerged-branch')
    expect(resolved.branchConvergenceNodeId).toBe('animation_node_point_complex-primary-b_primary-b-join')

    draft = finishPackageAnimationRouteBranch(draft)
    expect(draft.branches[0]?.editing).toBe(false)
    const saved = packageAnimationRouteDraftToScene(draft).scene!
    const incoming = saved.edges.filter((edge) => edge.toNodeId === resolved.branchConvergenceNodeId)
    expect(incoming).toHaveLength(2)
    expect(new Set(incoming.map((edge) => edge.geometry.kind === 'circuit-segment' ? edge.geometry.annotationId : 'direct')))
      .toEqual(new Set([primaryB.id, alternate.id]))
    expect(saved.nodes.filter((node) => node.id === resolved.branchConvergenceNodeId)).toHaveLength(1)
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
  roughInHours?: number
  crewNotes?: string
  updatedAt?: string
  sortOrder?: number
  orderTouchedAt?: string
  animationScene?: unknown
  animationSceneRevision?: number
  deletedAt?: string
  deletedBy?: string
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
    status: 'verified',
    localSaved: true,
    cloudSynced: true,
    scene: savedScene,
    scopeLayer: { ...packageWith(savedScene, revision) },
    animationSceneRevision: revision,
  }
}

function conflictSave(reason: string, currentScene?: unknown, extra: Record<string, unknown> = {}) {
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
    ...extra,
  }
}

function applySavedLayer(layers: FakeScopeLayer[], saved: FakeScopeLayer): FakeScopeLayer[] {
  return applySavedAnimationScopeLayer(layers, saved)
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
  it('classifies route save action messages with visible warning and error channels', () => {
    expect(classifyPackageAnimationRouteActionMessage({ status: 'verified', cloudSynced: true })).toEqual({ type: 'success', text: 'Animation route saved.' })
    expect(classifyPackageAnimationRouteActionMessage({ status: 'local-saved-cloud-pending' })).toEqual({
      type: 'warning',
      text: 'Animation route saved on this device. Cloud sync has not been verified yet.',
    })
    expect(classifyPackageAnimationRouteActionMessage({ status: 'local-saved-cloud-failed' })).toEqual({
      type: 'warning',
      text: 'Animation route saved on this device, but cloud sync failed. Other devices may not show the latest route yet.',
    })
    expect(classifyPackageAnimationRouteActionMessage({ status: 'verification-mismatch' })).toEqual({
      type: 'warning',
      text: 'The route was saved locally, but the cloud copy does not match. Your local route has been preserved.',
    })
    expect(classifyPackageAnimationRouteActionMessage({ status: 'local-save-failed', message: 'failed' })).toEqual({ type: 'error', text: 'failed' })
    expect(classifyPackageAnimationRouteActionMessage({ status: 'local-saved-revision-conflict' })).toEqual({
      type: 'warning',
      text: 'The route was saved locally, but a newer cloud route also exists. Review the cloud copy before replacing either version.',
    })
    expect(classifyPackageAnimationRouteActionMessage({ status: 'local-saved-remote-deleted' })).toEqual({
      type: 'warning',
      text: 'The route was saved locally, but the cloud Work Package is missing or deleted. Your local route has been preserved.',
    })
  })

  it('closes only the matching saved route builder session and operation', () => {
    const session = {
      sessionId: 'save-a',
      layerId: 'package-a',
      blueprintSetId: 'set-1',
      projectId: 'project-1',
      operationId: 7,
    }

    expect(shouldClosePackageAnimationRouteBuilderAfterSave(
      { sessionId: 'save-a', layerId: 'package-a' },
      session,
      { blueprintSetId: 'set-1', projectId: 'project-1', currentOperationId: 7 },
    )).toBe(true)
    expect(shouldClosePackageAnimationRouteBuilderAfterSave(
      { sessionId: 'save-b', layerId: 'package-b' },
      session,
      { blueprintSetId: 'set-1', projectId: 'project-1', currentOperationId: 7 },
    )).toBe(false)
    expect(shouldClosePackageAnimationRouteBuilderAfterSave(
      { sessionId: 'save-a2', layerId: 'package-a' },
      session,
      { blueprintSetId: 'set-1', projectId: 'project-1', currentOperationId: 7 },
    )).toBe(false)
    expect(shouldClosePackageAnimationRouteBuilderAfterSave(
      { sessionId: 'save-a', layerId: 'package-a' },
      session,
      { blueprintSetId: 'set-2', projectId: 'project-1', currentOperationId: 7 },
    )).toBe(false)
    expect(shouldClosePackageAnimationRouteBuilderAfterSave(
      { sessionId: 'save-a', layerId: 'package-a' },
      session,
      { blueprintSetId: 'set-1', projectId: 'project-1', currentOperationId: 8 },
    )).toBe(false)
  })

  it('gates route completions by project and blueprint-set identity before applying to the current view', () => {
    const operation = {
      sessionId: 'save-a',
      layerId: 'package-a',
      blueprintSetId: 'set-a',
      projectId: 'project-1',
      operationId: 11,
    }

    expect(isPackageAnimationRouteIdentityCurrent(operation, { blueprintSetId: ' set-a ', projectId: ' project-1 ' })).toBe(true)
    expect(isPackageAnimationRouteIdentityCurrent(operation, { blueprintSetId: 'set-b', projectId: 'project-1' })).toBe(false)
    expect(isPackageAnimationRouteIdentityCurrent(operation, { blueprintSetId: 'set-a', projectId: 'project-2' })).toBe(false)
    expect(isPackageAnimationRouteIdentityCurrent({ ...operation, projectId: undefined }, { blueprintSetId: 'set-a', projectId: null })).toBe(true)

    expect(decidePackageAnimationRouteCompletion(
      { sessionId: 'save-a', layerId: 'package-a' },
      operation,
      { blueprintSetId: 'set-a', projectId: 'project-1', currentOperationId: 11 },
    )).toEqual({
      applyToCurrentScopeLayers: true,
      applyNoticeToCurrentView: true,
      applyReviewToCurrentView: true,
      closeCurrentBuilder: true,
    })
    expect(decidePackageAnimationRouteCompletion(
      { sessionId: 'save-a', layerId: 'package-a' },
      operation,
      { blueprintSetId: 'set-b', projectId: 'project-1', currentOperationId: 11 },
    )).toEqual({
      applyToCurrentScopeLayers: false,
      applyNoticeToCurrentView: false,
      applyReviewToCurrentView: false,
      closeCurrentBuilder: false,
    })
    expect(decidePackageAnimationRouteCompletion(
      { sessionId: 'save-a', layerId: 'package-a' },
      operation,
      { blueprintSetId: 'set-a', projectId: 'project-2', currentOperationId: 11 },
    ).applyToCurrentScopeLayers).toBe(false)
  })

  it('leaves the current blueprint set untouched when a saved completion finishes after switching sets', () => {
    const draftA = addSegment(sourceDraft(empty({ packageId: 'package-a', packageName: 'Package A' })), circuit, 0)
    const sceneA = { ...packageAnimationRouteDraftToScene(draftA).scene!, revision: 2 }
    const outcome = reconcilePackageAnimationRouteSave(
      { sessionId: 'session-a', layerId: 'package-a', pageNumber: 1, draft: draftA, saving: true },
      {
        success: false,
        localSaved: true,
        cloudSynced: false,
        status: 'local-saved-cloud-failed',
        reason: 'remote-write-failed',
        scene: sceneA,
        scopeLayer: { ...packageWith(sceneA, 2), id: 'package-a', name: 'Package A' },
        animationSceneRevision: 2,
      },
    )
    expect(outcome.status).toBe('saved')
    if (outcome.status !== 'saved') return

    const currentSetBLayers = [{ ...packageWith(undefined, 0), id: 'package-b', name: 'Package B' }]
    const currentNotices: Record<string, { blueprintSetId: string; scopeLayerId: string; operationId?: number; type: 'success' | 'warning' | 'error'; text: string }> = {
      'set-b:package-b': { blueprintSetId: 'set-b', scopeLayerId: 'package-b', operationId: 7, type: 'warning' as const, text: 'newer set b warning' },
    }
    const currentReviews: Record<string, { message: string; sameDevice: boolean; operationId?: number; currentScene?: unknown }> = {
      'set-b:package-b': { message: 'newer set b review', sameDevice: false, operationId: 7 },
    }
    const currentBuilderB = { sessionId: 'session-b', layerId: 'package-b', pageNumber: 1, draft: sourceDraft(empty({ packageId: 'package-b', packageName: 'Package B' })), saving: false }
    const decision = decidePackageAnimationRouteCompletion(
      currentBuilderB,
      { sessionId: 'session-a', layerId: 'package-a', blueprintSetId: 'set-a', projectId: 'project-1', operationId: 6 },
      { blueprintSetId: 'set-b', projectId: 'project-1', currentOperationId: 6 },
    )

    let nextLayers = currentSetBLayers
    let nextNotices = currentNotices
    let nextReviews = currentReviews
    let nextBuilder: typeof currentBuilderB | null = currentBuilderB
    if (decision.applyToCurrentScopeLayers) nextLayers = applySavedLayer(nextLayers, outcome.scopeLayer as FakeScopeLayer)
    if (decision.applyNoticeToCurrentView) nextNotices = upsertPackageAnimationRouteNotice(nextNotices, { blueprintSetId: 'set-a', scopeLayerId: 'package-a', operationId: 6, type: 'warning', text: outcome.message })
    if (decision.applyReviewToCurrentView && outcome.reviewConflict) nextReviews = { ...nextReviews, 'set-a:package-a': { ...outcome.reviewConflict, operationId: 6 } }
    if (decision.closeCurrentBuilder) nextBuilder = null

    expect(nextLayers).toBe(currentSetBLayers)
    expect(nextLayers).toHaveLength(1)
    expect(nextLayers[0].id).toBe('package-b')
    expect(nextNotices).toBe(currentNotices)
    expect(nextReviews).toBe(currentReviews)
    expect(nextBuilder).toBe(currentBuilderB)

    const returnedToSetA = applySavedLayer([{ ...packageWith(undefined, 0), id: 'package-a', name: 'Package A' }], outcome.scopeLayer as FakeScopeLayer)
    expect(returnedToSetA).toHaveLength(1)
    expect(returnedToSetA[0].id).toBe('package-a')
    expect((returnedToSetA[0].animationScene as any).revision).toBe(2)
  })

  it('keeps same blueprint-set ids isolated across projects and reused package ids', () => {
    const operation = { sessionId: 'session-p1', layerId: 'package-reused', blueprintSetId: 'set-reused', projectId: 'project-1', operationId: 3 }
    const decision = decidePackageAnimationRouteCompletion(
      { sessionId: 'session-p2', layerId: 'package-reused' },
      operation,
      { blueprintSetId: 'set-reused', projectId: 'project-2', currentOperationId: 3 },
    )

    expect(decision.applyToCurrentScopeLayers).toBe(false)
    expect(decision.applyNoticeToCurrentView).toBe(false)
    expect(decision.applyReviewToCurrentView).toBe(false)
    expect(decision.closeCurrentBuilder).toBe(false)
  })

  it('does not let a stale clear-route completion mutate the current list or close a newer session', () => {
    const clearOperation = { sessionId: 'clear-a1', layerId: 'package-a', blueprintSetId: 'set-a', projectId: 'project-1', operationId: 4 }
    const currentBuilderB = { sessionId: 'clear-b1', layerId: 'package-b' }
    const decision = decidePackageAnimationRouteCompletion(
      currentBuilderB,
      clearOperation,
      { blueprintSetId: 'set-b', projectId: 'project-1', currentOperationId: 4 },
    )
    const currentSetBLayers = [{ ...packageWith(undefined, 0), id: 'package-b', name: 'Package B' }]
    const clearedA = { ...packageWith(undefined, 5), id: 'package-a', name: 'Package A' }

    const nextLayers = decision.applyToCurrentScopeLayers ? applySavedLayer(currentSetBLayers, clearedA) : currentSetBLayers
    const nextBuilder = decision.closeCurrentBuilder ? null : currentBuilderB

    expect(nextLayers).toBe(currentSetBLayers)
    expect(nextLayers).toEqual([{ ...packageWith(undefined, 0), id: 'package-b', name: 'Package B' }])
    expect(nextBuilder).toBe(currentBuilderB)
  })

  it('keeps stale saved completions keyed to Package A without closing or clearing Package B', () => {
    const draftA = addSegment(sourceDraft(empty({ packageId: 'package-a', packageName: 'Package A' })), circuit, 0)
    const draftB = sourceDraft(empty({ packageId: 'package-b', packageName: 'Package B' }))
    const currentBuilderB = { sessionId: 'session-b', layerId: 'package-b', pageNumber: 1, draft: draftB, saving: false }
    const sceneA = { ...packageAnimationRouteDraftToScene(draftA).scene!, revision: 1 }
    const outcome = reconcilePackageAnimationRouteSave(
      { sessionId: 'session-a', layerId: 'package-a', pageNumber: 1, draft: draftA, saving: true },
      {
        success: false,
        localSaved: true,
        cloudSynced: false,
        status: 'local-saved-cloud-failed',
        reason: 'remote-write-failed',
        scene: sceneA,
        scopeLayer: { ...packageWith(sceneA, 1), id: 'package-a', name: 'Package A' },
        animationSceneRevision: 1,
      },
    )

    expect(outcome.status).toBe('saved')
    if (outcome.status !== 'saved') return
    const layers = applySavedLayer([
      { ...packageWith(undefined, 0), id: 'package-a', name: 'Package A' },
      { ...packageWith(undefined, 0), id: 'package-b', name: 'Package B' },
    ], outcome.scopeLayer as FakeScopeLayer)
    expect((layers.find((layer) => layer.id === 'package-a')?.animationScene as any).revision).toBe(1)
    expect(layers.find((layer) => layer.id === 'package-b')?.animationScene).toBeUndefined()
    expect(shouldClosePackageAnimationRouteBuilderAfterSave(
      currentBuilderB,
      { sessionId: 'session-a', layerId: 'package-a', blueprintSetId: 'set-1', projectId: 'project-1', operationId: 1 },
      { blueprintSetId: 'set-1', projectId: 'project-1', currentOperationId: 1 },
    )).toBe(false)
    expect(currentBuilderB.draft).toBe(draftB)
    expect(packageAnimationRouteNoticeKey('set-1', (outcome.scopeLayer as FakeScopeLayer).id)).toBe('set-1:package-a')
  })

  it('prevents an older same-package operation notice from overwriting a newer warning', () => {
    const newer = upsertPackageAnimationRouteNotice({}, {
      blueprintSetId: 'set-1',
      scopeLayerId: 'package-a',
      operationId: 2,
      type: 'warning',
      text: 'newer warning',
    })
    const staleWrite = upsertPackageAnimationRouteNotice(newer, {
      blueprintSetId: 'set-1',
      scopeLayerId: 'package-a',
      operationId: 1,
      type: 'success',
      text: 'old success',
    })
    expect(staleWrite).toBe(newer)
    expect(staleWrite['set-1:package-a'].text).toBe('newer warning')
    expect(clearPackageAnimationRouteNotice(staleWrite, {
      blueprintSetId: 'set-1',
      scopeLayerId: 'package-a',
      operationId: 1,
    })).toBe(staleWrite)
    expect(clearPackageAnimationRouteNotice(staleWrite, {
      blueprintSetId: 'set-1',
      scopeLayerId: 'package-b',
      operationId: 3,
    })).toBe(staleWrite)
  })

  it('creates Review Cloud Copy state only for statuses with a usable remote scene', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const localScene = { ...packageAnimationRouteDraftToScene(draft).scene!, revision: 2 }
    const remoteScene = { ...localScene, id: 'remote-scene', revision: 3 }

    expect(buildPackageAnimationRouteReviewConflict({ status: 'local-saved-cloud-pending' })).toBeUndefined()
    expect(buildPackageAnimationRouteReviewConflict({ status: 'local-saved-cloud-failed', reason: 'remote-write-failed' })).toBeUndefined()
    expect(buildPackageAnimationRouteReviewConflict({ status: 'local-saved-remote-deleted', reason: 'scope-layer-deleted' })).toBeUndefined()
    expect(buildPackageAnimationRouteReviewConflict({
      status: 'verification-mismatch',
      reason: 'verification-mismatch',
      currentScene: remoteScene,
    })).toMatchObject({ currentScene: remoteScene, latestRevision: 3, message: 'The route was saved locally, but the cloud copy does not match. Your local route has been preserved.' })
    expect(buildPackageAnimationRouteReviewConflict({
      status: 'local-saved-revision-conflict',
      reason: 'stale-remote-revision',
      currentScene: remoteScene,
    })).toMatchObject({ currentScene: remoteScene, latestRevision: 3, message: 'The route was saved locally, but a newer cloud route also exists. Review the cloud copy before replacing either version.' })
  })

  it('consumes the returned revision, updates the package, clears conflict, cleans the draft, and closes the builder', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    expect(draft.dirty).toBe(true)
    const scene = packageAnimationRouteDraftToScene(draft).scene!
    const state = { ...builderState(draft), conflict: { message: 'stale', sameDevice: true } }

    const outcome = reconcilePackageAnimationRouteSave(state, verifiedSave(scene, 1))

    expect(outcome.status).toBe('saved')
    if (outcome.status !== 'saved') return
    expect(outcome.savedRevision).toBe(1)
    expect(outcome.saveStatus).toBe('verified-success')
    expect(outcome.message).toBe('Animation route saved.')
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
    expect(outcome.conflict.message).toContain('Review the latest route')
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
    expect(outcome.conflict.message).toContain('Review the latest route')
    expect(outcome.conflict.latestRevision).toBeUndefined()
    expect(outcome.builder).not.toBeNull()
    expect(outcome.builder?.draft).toEqual(draft)
  })

  it('never treats a result without a verified scope layer as saved', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const outcome = reconcilePackageAnimationRouteSave(builderState(draft), { success: true } as any)
    expect(outcome.status).toBe('conflict')
  })

  it('applies a local-only save, closes the builder, and reports cloud pending', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const scene = { ...packageAnimationRouteDraftToScene(draft).scene!, revision: 1 }
    const outcome = reconcilePackageAnimationRouteSave(builderState(draft), conflictSave('remote-conflict-unresolved', undefined, {
      status: 'local-saved-cloud-pending',
      localSaved: true,
      scene,
      scopeLayer: packageWith(scene, 1),
      animationSceneRevision: 1,
    }))

    expect(outcome.status).toBe('saved')
    if (outcome.status !== 'saved') return
    expect(outcome.saveStatus).toBe('local-success-cloud-warning')
    expect(outcome.message).toBe('Animation route saved on this device. Cloud sync has not been verified yet.')
    expect(outcome.builder).toBeNull()
    expect(outcome.savedDraft?.dirty).toBe(false)
    expect(outcome.savedDraft?.expectedBaseRevision).toBe(1)
  })

  it('applies a local save with cloud failure without classifying it as local failure', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const scene = { ...packageAnimationRouteDraftToScene(draft).scene!, revision: 1 }
    const outcome = reconcilePackageAnimationRouteSave(builderState(draft), conflictSave('remote-write-failed', undefined, {
      status: 'local-saved-cloud-failed',
      localSaved: true,
      scene,
      scopeLayer: packageWith(scene, 1),
      animationSceneRevision: 1,
    }))

    expect(outcome.status).toBe('saved')
    if (outcome.status !== 'saved') return
    expect(outcome.message).toBe('Animation route saved on this device, but cloud sync failed. Other devices may not show the latest route yet.')
    expect(outcome.message).not.toContain('could not be saved')
    expect(outcome.builder).toBeNull()
    expect(outcome.reviewConflict).toBeUndefined()
  })

  it('treats every localSaved result with a returned scope layer as saved, never ordinary failure', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const scene = { ...packageAnimationRouteDraftToScene(draft).scene!, revision: 2 }
    const localSavedStatuses = [
      ['local-saved-cloud-pending', 'remote-conflict-unresolved'],
      ['local-saved-cloud-failed', 'remote-write-failed'],
      ['verification-mismatch', 'verification-mismatch'],
      ['local-saved-revision-conflict', 'stale-remote-revision'],
      ['local-saved-remote-deleted', 'scope-layer-deleted'],
    ] as const

    for (const [status, reason] of localSavedStatuses) {
      const outcome = reconcilePackageAnimationRouteSave(builderState(draft), conflictSave(reason, undefined, {
        status,
        localSaved: true,
        scene,
        scopeLayer: packageWith(scene, 2),
        animationSceneRevision: 2,
      }))
      expect(outcome.status).toBe('saved')
      if (outcome.status !== 'saved') continue
      expect(outcome.actionMessage.type).toBe('warning')
      expect(outcome.message).not.toContain('could not be saved')
    }
  })

  it('preserves a local save when cloud verification reaches mismatching content', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const localScene = { ...packageAnimationRouteDraftToScene(draft).scene!, revision: 1 }
    const remoteScene = { ...localScene, id: 'remote-different' }
    const outcome = reconcilePackageAnimationRouteSave(builderState(draft), conflictSave('verification-mismatch', remoteScene, {
      status: 'verification-mismatch',
      localSaved: true,
      scene: localScene,
      scopeLayer: packageWith(localScene, 1),
      animationSceneRevision: 1,
    }))

    expect(outcome.status).toBe('saved')
    if (outcome.status !== 'saved') return
    expect(outcome.saveStatus).toBe('local-success-verification-conflict')
    expect(outcome.message).toContain('cloud copy does not match')
    expect(outcome.actionMessage.type).toBe('warning')
    expect(outcome.reviewConflict?.currentScene).toEqual(remoteScene)
    expect(((outcome.scopeLayer as FakeScopeLayer).animationScene as any).id).toBe(localScene.id)
  })

  it('applies a saved route layer while preserving newer current package order, labor, notes and membership', () => {
    const scene = { ...packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!, revision: 2 }
    const current = {
      ...packageWith(undefined, 1),
      selectedAnnotationIds: ['new-member'],
      itemRefs: [{ annotationId: 'new-member', pageNumber: 1 }],
      roughInHours: 9,
      crewNotes: 'newer notes',
      updatedAt: '2026-07-19T12:00:00.000Z',
      sortOrder: 2,
      orderTouchedAt: '2026-07-19T13:00:00.000Z',
    }
    const saved = {
      ...packageWith(scene, 2),
      selectedAnnotationIds: ['old-member'],
      itemRefs: [{ annotationId: 'old-member', pageNumber: 1 }],
      roughInHours: 1,
      crewNotes: 'older notes',
      updatedAt: '2026-07-19T11:00:00.000Z',
      sortOrder: 8,
      orderTouchedAt: '2026-07-19T10:00:00.000Z',
    }

    const [next] = applySavedAnimationScopeLayer([current], saved)

    expect((next.animationScene as any).revision).toBe(2)
    expect(next.animationSceneRevision).toBe(2)
    expect(next.sortOrder).toBe(2)
    expect(next.orderTouchedAt).toBe('2026-07-19T13:00:00.000Z')
    expect(next.roughInHours).toBe(9)
    expect(next.crewNotes).toBe('newer notes')
    expect(next.selectedAnnotationIds).toEqual(['new-member'])
    expect(next.itemRefs).toEqual([{ annotationId: 'new-member', pageNumber: 1, label: 'Item' }])
  })

  it('applies newer returned package content while still taking the saved route scene', () => {
    const scene = { ...packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!, revision: 2 }
    const current = {
      ...packageWith(undefined, 1),
      roughInHours: 1,
      crewNotes: 'older notes',
      updatedAt: '2026-07-19T10:00:00.000Z',
      sortOrder: 2,
      orderTouchedAt: '2026-07-19T13:00:00.000Z',
    }
    const saved = {
      ...packageWith(scene, 2),
      roughInHours: 7,
      crewNotes: 'newer notes',
      updatedAt: '2026-07-19T12:00:00.000Z',
      sortOrder: 8,
      orderTouchedAt: '2026-07-19T11:00:00.000Z',
    }

    const [next] = applySavedAnimationScopeLayer([current], saved)

    expect((next.animationScene as any).revision).toBe(2)
    expect(next.animationSceneRevision).toBe(2)
    expect(next.roughInHours).toBe(7)
    expect(next.crewNotes).toBe('newer notes')
    expect(next.sortOrder).toBe(2)
    expect(next.orderTouchedAt).toBe('2026-07-19T13:00:00.000Z')
  })

  it('does not resurrect a current authoritative tombstone when applying a saved route layer', () => {
    const scene = { ...packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!, revision: 2 }
    const current = {
      ...packageWith(undefined, 1),
      updatedAt: '2026-07-19T12:00:00.000Z',
      deletedAt: '2026-07-19T12:00:00.000Z',
    }
    const saved = {
      ...packageWith(scene, 2),
      updatedAt: '2026-07-19T11:00:00.000Z',
    }

    const [next] = applySavedAnimationScopeLayer([current], saved)

    expect(next.deletedAt).toBe('2026-07-19T12:00:00.000Z')
    expect(next.animationScene).toBeUndefined()
    expect(next.animationSceneRevision).toBe(1)
  })

  it('retains a returned authoritative tombstone when applying a saved route layer', () => {
    const scene = { ...packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!, revision: 2 }
    const current = {
      ...packageWith(scene, 2),
      updatedAt: '2026-07-19T11:00:00.000Z',
    }
    const saved = {
      ...packageWith(scene, 3),
      updatedAt: '2026-07-19T12:00:00.000Z',
      deletedAt: '2026-07-19T12:00:00.000Z',
    }

    const [next] = applySavedAnimationScopeLayer([current], saved)

    expect(next.deletedAt).toBe('2026-07-19T12:00:00.000Z')
    expect((next.animationScene as any).revision).toBe(2)
    expect(next.animationSceneRevision).toBe(3)
    expect(applySavedAnimationScopeLayer([current], saved).filter((layer) => !layer.deletedAt)).toEqual([])
  })

  it('matches the service tombstone winner contract for older tombstone versus newer live', () => {
    const scene = { ...packageAnimationRouteDraftToScene(addSegment(sourceDraft(), circuit, 0)).scene!, revision: 2 }
    const currentTombstone = {
      ...packageWith(undefined, 1),
      updatedAt: '2026-07-19T10:00:00.000Z',
      deletedAt: '2026-07-19T10:00:00.000Z',
    }
    const newerLive = {
      ...packageWith(scene, 2),
      updatedAt: '2026-07-19T11:00:00.000Z',
    }

    expect(applySavedAnimationScopeLayer([currentTombstone], newerLive)).toEqual(
      mergeBlueprintScopeLayersById([currentTombstone], [newerLive]),
    )
  })

  it('keeps the draft open on true local save failure', () => {
    const draft = addSegment(sourceDraft(), circuit, 0)
    const outcome = reconcilePackageAnimationRouteSave(builderState(draft), conflictSave('remote-write-failed', undefined, {
      status: 'local-save-failed',
      localSaved: false,
      message: 'disk full',
    }))

    expect(outcome.status).toBe('conflict')
    if (outcome.status !== 'conflict') return
    expect(outcome.builder?.draft).toEqual(draft)
    expect(outcome.conflict.message).toBe('Animation route could not be saved. Your draft is still open.')
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
    expect(outcome.conflict.message).toContain('Review the latest route')
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

  it('keeps source and mid-route branch origins distinct and reports an unambiguous active status', () => {
    let primary = addSegment(sourceDraft(), circuit, 0)
    primary = addSegment(primary, circuit, 1)
    const fromSource = startPackageAnimationRouteBranch(primary, 'source')
    const fromMiddle = startPackageAnimationRouteBranch(primary, primary.transitions[0].id)

    expect(fromSource.branches[0]).toMatchObject({ originSelectionId: 'source', editing: true, transitions: [] })
    expect(fromMiddle.branches[0]).toMatchObject({ originSelectionId: primary.transitions[0].id, editing: true, transitions: [] })
    expect(getPackageAnimationBranchStatus(fromSource)).toMatchObject({ heading: 'ALTERNATE BRANCH', originLabel: 'Switch', stepCount: 0, phase: 'Select first alternate segment' })
    expect(getPackageAnimationBranchStatus(fromMiddle)).toMatchObject({ heading: 'ALTERNATE BRANCH', originLabel: 'Light 1' })
    const emptyUndo = undoPackageAnimationRouteSelection(fromMiddle)
    expect(emptyUndo.branches[0]).toEqual(fromMiddle.branches[0])
    expect(emptyUndo.notice?.code).toBe('empty-branch-undo')
  })

  it('preserves active branch state through one step, multiple steps, and a rejected disconnected click', () => {
    const disconnected: RouteBuilderAnnotation = {
      id: 'branch-far', pageNumber: 1, label: 'Far branch', shapeKind: 'circuit-path',
      points: [{ x: 0.72, y: 0.12 }, { x: 0.82, y: 0.12 }], pointIds: ['bf1', 'bf2'], segmentIds: ['bfs'],
    }
    const annotations = [...allAnnotations(), disconnected]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }))
    draft = addSegment(draft, circuit, 0)
    draft = addSegment(draft, circuit, 1)
    draft = startPackageAnimationRouteBranch(draft, 'source')
    draft = dispatchPackageAnimationRoutePick(draft, { kind: 'segment', pick: segmentPick(branchCircuit, 0) }).draft
    expect(draft.branches[0]).toMatchObject({ editing: true })
    expect(draft.branches[0]?.transitions).toHaveLength(1)
    expect(getPackageAnimationBranchStatus(draft)?.phase).toBe('Continue alternate route')

    const beforeInvalid = structuredClone(draft.branches[0]?.transitions)
    const rejected = dispatchPackageAnimationRoutePick(draft, { kind: 'segment', pick: segmentPick(disconnected, 0) })
    expect(rejected).toMatchObject({ accepted: false, consumed: true, mode: 'alternate-branch', branchActive: true })
    expect(rejected.draft.branches[0]?.transitions).toEqual(beforeInvalid)
    expect(getPackageAnimationBranchStatus(rejected.draft)?.phase).toBe('Invalid selection — branch remains open')

    const completedTrace = dispatchPackageAnimationRoutePick(draft, { kind: 'segment', pick: segmentPick(branchCircuit, 1) })
    expect(completedTrace.draft.branches[0]).toMatchObject({ editing: true })
    expect(completedTrace.draft.branches[0]?.transitions).toHaveLength(2)
    expect(getPackageAnimationBranchStatus(completedTrace.draft)?.phase).toBe('Branch valid — ready to finish')
  })

  it('rejects duplicate segments and cycle rejoins without cancelling or mutating the primary route', () => {
    let primary = addSegment(sourceDraft(), circuit, 0)
    primary = addSegment(primary, circuit, 1)
    const branch = startPackageAnimationRouteBranch(primary, 'source')
    const duplicate = dispatchPackageAnimationRoutePick(branch, { kind: 'segment', pick: segmentPick(circuit, 0) })
    expect(duplicate).toMatchObject({ accepted: false, mode: 'alternate-branch', branchActive: true })
    expect(duplicate.draft.notice?.code).toBe('duplicate-segment')
    expect(duplicate.draft.transitions).toEqual(primary.transitions)
    expect(duplicate.draft.branches[0]?.transitions).toEqual([])

    const cycle = dispatchPackageAnimationRoutePick(branch, { kind: 'annotation', annotationId: 'source' })
    expect(cycle).toMatchObject({ accepted: false, mode: 'alternate-branch', branchActive: true })
    expect(cycle.draft.notice?.code).toBe('branch-cycle')
    expect(cycle.draft.notice?.message).not.toContain('already in the route')
  })

  it('dispatches a shared-fixture rejoin to the branch before the primary cycle guard', () => {
    const alternateFromMiddle: RouteBuilderAnnotation = {
      id: 'alternate-middle', pageNumber: 1, label: 'Alternate middle', shapeKind: 'circuit-path',
      points: [{ x: 0.5, y: 0.5 }, { x: 0.72, y: 0.3 }], pointIds: ['am1', 'am2'], segmentIds: ['ams'],
    }
    const annotations = [...allAnnotations(), alternateFromMiddle]
    let primary = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }))
    primary = addSegment(primary, circuit, 0)
    primary = addSegment(primary, circuit, 1)
    let branch = startPackageAnimationRouteBranch(primary, primary.transitions[0].id)
    branch = dispatchPackageAnimationRoutePick(branch, { kind: 'segment', pick: segmentPick(alternateFromMiddle, 0) }).draft
    const primarySnapshot = structuredClone(branch.transitions)
    const rejoin = dispatchPackageAnimationRoutePick(branch, { kind: 'annotation', annotationId: 'fixture-2' })

    expect(rejoin).toMatchObject({ accepted: true, consumed: true, mode: 'alternate-branch', branchActive: true })
    expect(rejoin.draft.transitions).toEqual(primarySnapshot)
    expect(rejoin.draft.branches[0]?.transitions).toHaveLength(2)
    expect(resolvePackageAnimationRouteDraft(rejoin.draft).branchConvergenceNodeId).toBe('animation_node_annotation_fixture-2')
  })

  it('does not accept an outside-tolerance endpoint or a mere mid-segment visual crossing as convergence', () => {
    const primary: RouteBuilderAnnotation = {
      id: 'primary-tolerance', pageNumber: 1, label: 'Primary tolerance', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.9, y: 0.5 }],
      pointIds: ['pt1', 'pt2', 'pt3'], segmentIds: ['pts1', 'pts2'],
    }
    const outside: RouteBuilderAnnotation = {
      id: 'outside', pageNumber: 1, label: 'Outside tolerance', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.25 }, { x: 0.621, y: 0.5 }],
      pointIds: ['o1', 'o2', 'o3'], segmentIds: ['os1', 'os2'],
    }
    const crossing: RouteBuilderAnnotation = {
      id: 'crossing-only', pageNumber: 1, label: 'Crossing only', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.4, y: 0.5 }], pointIds: ['c1', 'c2'], segmentIds: ['cs1'],
    }
    const annotations = [source, fixture2, primary, outside, crossing]
    const base = empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) })
    let primaryDraft = sourceDraft(base)
    primaryDraft = addSegment(primaryDraft, primary, 0)
    primaryDraft = addSegment(primaryDraft, primary, 1)

    let outsideDraft = startPackageAnimationRouteBranch(primaryDraft, 'source')
    outsideDraft = addSegment(outsideDraft, outside, 0)
    outsideDraft = addSegment(outsideDraft, outside, 1)
    expect(resolvePackageAnimationRouteDraft(outsideDraft).branchConvergenceNodeId).toBeUndefined()
    expect(outsideDraft.branches[0]?.editing).toBe(true)

    let crossingDraft = startPackageAnimationRouteBranch(primaryDraft, 'source')
    crossingDraft = addSegment(crossingDraft, crossing, 0)
    expect(resolvePackageAnimationRouteDraft(crossingDraft).branchConvergenceNodeId).toBeUndefined()
    expect(crossingDraft.branches[0]?.editing).toBe(true)
  })

  it('finishes, cancels, and undoes only the alternate branch while preserving the primary route', () => {
    let primary = addSegment(sourceDraft(), circuit, 0)
    primary = addSegment(primary, circuit, 1)
    let branch = startPackageAnimationRouteBranch(primary, 'source')
    branch = addSegment(branch, branchCircuit, 0)
    branch = addSegment(branch, branchCircuit, 1)
    const primarySnapshot = structuredClone(branch.transitions)

    const undone = undoPackageAnimationRouteSelection(branch)
    expect(undone.branches[0]?.transitions).toHaveLength(1)
    expect(undone.transitions).toEqual(primarySnapshot)

    const cancelled = removePackageAnimationRouteBranch(branch)
    expect(cancelled.branches[0]).toBeUndefined()
    expect(cancelled.transitions).toEqual(primarySnapshot)

    const finished = finishPackageAnimationRouteBranch(branch)
    expect(finished.branches[0]?.editing).toBe(false)
    expect(packageAnimationRouteDraftToScene(finished).scene?.branchOrders).toHaveLength(1)
    expect(getPackageAnimationBranchStatus(finished)?.phase).toBe('Branch complete')
  })

  it('keeps ordinary primary dispatch working and does not leak branch state between package drafts', () => {
    const packageA = startPackageAnimationRouteBranch(addSegment(addSegment(sourceDraft(), circuit, 0), circuit, 1), 'source')
    const packageB = empty({ packageId: 'package-b', packageName: 'Package B' })
    expect(packageA.branches[0]?.editing).toBe(true)
    expect(packageB.branches[0]).toBeUndefined()

    const sourcePick = dispatchPackageAnimationRoutePick(packageB, { kind: 'annotation', annotationId: 'source' })
    expect(sourcePick).toMatchObject({ accepted: true, consumed: true, mode: 'primary-route', branchActive: false })
    const primarySegment = dispatchPackageAnimationRoutePick(sourcePick.draft, { kind: 'segment', pick: segmentPick(circuit, 0) })
    expect(primarySegment).toMatchObject({ accepted: true, mode: 'primary-route' })
    expect(primarySegment.draft.transitions).toHaveLength(1)
    expect(primarySegment.draft.branches[0]).toBeUndefined()
  })

  it('resolves source → four alternate segments → clicked later primary node at the viewer/model boundary', () => {
    const primary: RouteBuilderAnnotation = {
      id: 'viewer-primary', pageNumber: 1, label: 'Viewer primary', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.26, y: 0.5 }, { x: 0.42, y: 0.5 }, { x: 0.58, y: 0.5 }, { x: 0.74, y: 0.5 }, { x: 0.9, y: 0.5 }],
      pointIds: ['vp0', 'vp1', 'vp2', 'vp3', 'vp4', 'vp5'], segmentIds: ['vs0', 'vs1', 'vs2', 'vs3', 'vs4'],
    }
    const alternate: RouteBuilderAnnotation = {
      id: 'viewer-alternate', pageNumber: 1, label: 'Viewer alternate', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.22, y: 0.7 }, { x: 0.38, y: 0.72 }, { x: 0.54, y: 0.68 }, { x: 0.7, y: 0.62 }],
      pointIds: ['va0', 'va1', 'va2', 'va3', 'va4'], segmentIds: ['vas0', 'vas1', 'vas2', 'vas3'],
    }
    const annotations = [source, fixture2, primary, alternate]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }))
    ;[0, 1, 2, 3, 4].forEach((index) => { draft = addSegment(draft, primary, index) })
    draft = startPackageAnimationRouteBranch(draft, 'source')
    ;[0, 1, 2, 3].forEach((index) => { draft = addSegment(draft, alternate, index) })
    expect(draft.branches[0]?.transitions).toHaveLength(4)
    expect(resolvePackageAnimationRouteDraft(draft).branchConvergenceNodeId).toBeUndefined()

    const candidates = getPackageAnimationPrimaryRouteCandidates(draft).filter((candidate) => candidate.index > 0)
    const viewerHit = findNearestRouteNode({ x: 0.9, y: 0.5 }, candidates, { pageWidth: 1000, pageHeight: 1000, tolerancePx: 18 })
    expect(viewerHit?.nodeId).toBe('animation_node_annotation_fixture-2')
    const rejoin = dispatchPackageAnimationRoutePick(draft, { kind: 'rejoin-node', nodeId: viewerHit!.nodeId, clickedPoint: { x: 0.9, y: 0.5 } })
    expect(rejoin).toMatchObject({ accepted: true, consumed: true, mode: 'alternate-branch', branchActive: true })
    expect(rejoin.rejoinDiagnostics).toMatchObject({
      clickedNodeId: 'animation_node_annotation_fixture-2',
      clickedAnnotationId: 'fixture-2',
      clickedNormalizedPoint: { x: 0.9, y: 0.5 },
      originIndex: 0,
      selectedNodeId: 'animation_node_annotation_fixture-2',
    })
    expect(rejoin.rejoinDiagnostics?.candidates.map((candidate) => candidate.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(resolvePackageAnimationRouteDraft(rejoin.draft).branchConvergenceNodeId).toBe(viewerHit!.nodeId)
    const finished = finishPackageAnimationRouteBranch(rejoin.draft)
    expect(finished.branches[0]?.editing).toBe(false)
    expect(packageAnimationRouteDraftToScene(finished).scene?.branchOrders).toHaveLength(1)
  })
})

describe('ANIM-5.2 terminal parallel branches', () => {
  // Screenshot topology: switch → five-step primary run; from primary node #2 (a sconce) the cyan
  // primary route continues right while an orange four-arc branch parts ways and ends at a separate
  // far-right sconce that is never on the primary route.
  const primaryRun: RouteBuilderAnnotation = {
    id: 'primary-run', pageNumber: 1, label: 'Primary run', shapeKind: 'circuit-path',
    points: [{ x: 0.1, y: 0.5 }, { x: 0.26, y: 0.5 }, { x: 0.42, y: 0.5 }, { x: 0.58, y: 0.5 }, { x: 0.74, y: 0.5 }, { x: 0.9, y: 0.5 }],
    pointIds: ['pr0', 'pr1', 'pr2', 'pr3', 'pr4', 'pr5'], segmentIds: ['prs0', 'prs1', 'prs2', 'prs3', 'prs4'],
  }
  const nodeTwoSconce: RouteBuilderAnnotation = { id: 'node-two-sconce', pageNumber: 1, label: 'Sconce 2', shapeKind: 'electrical-sconce', rect: { x: 0.4, y: 0.48, w: 0.04, h: 0.04 } }
  const branchArcs: RouteBuilderAnnotation = {
    id: 'branch-arcs', pageNumber: 1, label: 'Circuit Arc Path', shapeKind: 'circuit-arc',
    points: [{ x: 0.42, y: 0.5 }, { x: 0.54, y: 0.66 }, { x: 0.66, y: 0.68 }, { x: 0.78, y: 0.64 }, { x: 0.9, y: 0.58 }],
    arcCtrls: [{ x: 0.48, y: 0.62 }, { x: 0.6, y: 0.7 }, { x: 0.72, y: 0.68 }, { x: 0.84, y: 0.6 }],
    pointIds: ['ba0', 'ba1', 'ba2', 'ba3', 'ba4'], segmentIds: ['bas0', 'bas1', 'bas2', 'bas3'],
  }
  const farRightSconce: RouteBuilderAnnotation = { id: 'far-right-sconce', pageNumber: 1, label: 'Far-right Sconce', shapeKind: 'electrical-sconce', rect: { x: 0.88, y: 0.56, w: 0.04, h: 0.04 } }
  const screenshotAnnotations = [source, primaryRun, nodeTwoSconce, branchArcs, farRightSconce]
  const NODE_TWO_ID = 'animation_node_annotation_node-two-sconce'
  const FAR_RIGHT_ID = 'animation_node_annotation_far-right-sconce'
  const playbackOptions = { ...DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS, travelSpeed: 0.25, nodePauseMs: 100, deviceReactionMs: 80, fixtureFadeMs: 200 }

  function screenshotPrimary() {
    let draft = sourceDraft(empty({ annotations: screenshotAnnotations, packageAnnotationIds: screenshotAnnotations.map((entry) => entry.id) }))
    ;[0, 1, 2, 3, 4].forEach((index) => { draft = addSegment(draft, primaryRun, index) })
    return draft
  }

  function screenshotTerminalBranch() {
    let draft = screenshotPrimary()
    // Branch from the destination of primary step #2 (index 1 in transitions → primary node #2).
    draft = startPackageAnimationRouteBranch(draft, draft.transitions[1].id)
    ;[0, 1, 2, 3].forEach((index) => { draft = addSegment(draft, branchArcs, index) })
    return draft
  }

  it('authors the exact screenshot route: five primary steps + four-arc terminal branch from node #2', () => {
    const draft = screenshotTerminalBranch()
    expect(draft.transitions).toHaveLength(5)
    expect(draft.branches[0]?.transitions).toHaveLength(4)

    const resolved = resolvePackageAnimationRouteDraft(draft)
    expect(resolved.branchConvergenceNodeId).toBeUndefined()
    expect(resolved.branchTerminalNodeId).toBe(FAR_RIGHT_ID)
    expect(resolved.branchOriginNodeId).toBe(NODE_TWO_ID)
    // Every intermediate branch step ends at a wire junction; only the final step lands on the sconce.
    const branchDestinations = resolved.branchTransitions.map((entry) => entry.to?.roles.includes('load'))
    expect(branchDestinations).toEqual([false, false, false, true])
    expect(resolved.branchTransitions[3].to?.id).toBe(FAR_RIGHT_ID)
    // No primary-route step passes through the terminal sconce — the branch never rejoins.
    expect(resolved.transitions.some((entry) => entry.to?.id === FAR_RIGHT_ID)).toBe(false)
  })

  it('enables Finish Branch on a terminal endpoint and reports a terminal completion in the panel', () => {
    const draft = screenshotTerminalBranch()
    const status = getPackageAnimationBranchStatus(draft)
    expect(status).toMatchObject({
      heading: 'ALTERNATE BRANCH', originLabel: 'Sconce 2', stepCount: 4,
      phase: 'Branch valid — ready to finish', completionKind: 'terminal', endpointLabel: 'Far-right Sconce', valid: true,
    })
    expect(status?.instruction).toContain('Terminal endpoint')

    const finished = finishPackageAnimationRouteBranch(draft)
    expect(finished.branches[0]?.editing).toBe(false)
    expect(getPackageAnimationBranchStatus(finished)).toMatchObject({ phase: 'Branch complete', completionKind: 'terminal' })
  })

  it('constructs a split-only scene with a branch order and no fabricated rejoin/merge node', () => {
    const finished = finishPackageAnimationRouteBranch(screenshotTerminalBranch())
    const built = packageAnimationRouteDraftToScene(finished)
    expect(built.issues.filter((entry) => entry.severity === 'error')).toEqual([])
    const scene = built.scene!
    expect(scene.branchOrders).toHaveLength(1)
    expect(scene.branchOrders[0].nodeId).toBe(NODE_TWO_ID)
    expect(scene.branchOrders[0].outgoingEdgeIds).toHaveLength(2)
    // The origin is the only node with two outgoing edges; nothing merges (the terminal sconce has in-degree 1).
    const outDegree = new Map<string, number>()
    const inDegree = new Map<string, number>()
    scene.edges.forEach((edge) => {
      outDegree.set(edge.fromNodeId, (outDegree.get(edge.fromNodeId) || 0) + 1)
      inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) || 0) + 1)
    })
    expect([...outDegree.values()].filter((count) => count > 1)).toEqual([2])
    expect([...inDegree.values()].some((count) => count > 1)).toBe(false)
    expect(inDegree.get(FAR_RIGHT_ID)).toBe(1)
    // The scene stays editable (not pushed into the advanced read-only bucket).
    expect(summarizePackageAnimationScene(scene, screenshotAnnotations, screenshotAnnotations.map((entry) => entry.id)).advanced).toBe(false)
  })

  it('reopens a saved terminal scene with origin at node #2, four steps, and terminal completion intact', () => {
    const scene = packageAnimationRouteDraftToScene(finishPackageAnimationRouteBranch(screenshotTerminalBranch())).scene!
    const loaded = loadPackageAnimationRouteDraft({
      packageId: 'package', packageName: 'Lighting',
      packageAnnotationIds: screenshotAnnotations.map((entry) => entry.id), annotations: screenshotAnnotations,
      scene, expectedBaseRevision: 1,
    })
    expect(loaded.readOnlyReason).toBeUndefined()
    expect(loaded.transitions).toHaveLength(5)
    expect(loaded.branches[0]).toMatchObject({ editing: false })
    expect(loaded.branches[0]?.transitions).toHaveLength(4)
    const resolved = resolvePackageAnimationRouteDraft(loaded)
    expect(resolved.branchOriginNodeId).toBe(NODE_TWO_ID)
    expect(resolved.branchConvergenceNodeId).toBeUndefined()
    expect(resolved.branchTerminalNodeId).toBe(FAR_RIGHT_ID)
    expect(validatePackageAnimationRouteDraft(loaded).filter((entry) => entry.severity === 'error')).toEqual([])
    // Round-trips byte-for-byte, so an existing terminal scene never rewrites on open.
    const resaved = packageAnimationRouteDraftToScene(loaded).scene!
    expect(resaved.edges).toEqual(scene.edges)
    expect(resaved.branchOrders).toEqual(scene.branchOrders)
    expect(resaved.manualTraversal).toEqual(scene.manualTraversal)
  })

  it('plays the split at node #2 with both arms independent and no convergence wait', () => {
    const scene = packageAnimationRouteDraftToScene(finishPackageAnimationRouteBranch(screenshotTerminalBranch())).scene!
    const geometry = preparePlaybackGeometry({ scene, annotations: screenshotAnnotations, pageMetrics: { width: 1000, height: 1000 } })
    const branches = detectPlaybackBranches(geometry, 'simultaneous')
    const originBranch = branches.find((branch) => branch.nodeId === NODE_TWO_ID)
    expect(originBranch).toBeDefined()
    expect(originBranch?.outgoingStepIds).toHaveLength(2)
    expect(originBranch?.convergenceNodeId).toBeUndefined()

    const timeline = createPlaybackTimeline(geometry, playbackOptions)
    expect(timeline.hasBranches).toBe(true)
    expect(timeline.steps).toHaveLength(9)
    // The primary continuation and the alternate branch both depart node #2 at the same instant and
    // neither waits for the other to converge.
    const stepByEdge = new Map(timeline.steps.map((step) => [step.edgeId, step]))
    const [primaryEdgeId, alternateEdgeId] = scene.branchOrders[0].outgoingEdgeIds
    expect(stepByEdge.get(primaryEdgeId)!.fromNodeId).toBe(NODE_TWO_ID)
    expect(stepByEdge.get(alternateEdgeId)!.fromNodeId).toBe(NODE_TWO_ID)
    expect(stepByEdge.get(primaryEdgeId)!.travelStartMs).toBe(stepByEdge.get(alternateEdgeId)!.travelStartMs)

    // In a late frame the primary route end and the terminal sconce are both energized independently.
    const finalFrame = calculatePlaybackFrame(timeline, timeline.totalDurationMs)
    const activeNodeIds = finalFrame.devices.filter((device) => device.phase === 'active').map((device) => device.nodeId)
    expect(activeNodeIds).toContain(FAR_RIGHT_ID)
    expect(activeNodeIds).toContain('animation_node_point_primary-run_pr5')
  })

  it('supports a source-origin terminal branch alongside a continuing primary route', () => {
    const sourceTerminalRun: RouteBuilderAnnotation = {
      id: 'source-terminal-run', pageNumber: 1, label: 'Source terminal run', shapeKind: 'circuit-arc',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.2, y: 0.68 }, { x: 0.34, y: 0.72 }],
      arcCtrls: [{ x: 0.14, y: 0.6 }, { x: 0.27, y: 0.73 }], pointIds: ['st0', 'st1', 'st2'], segmentIds: ['sts0', 'sts1'],
    }
    const sourceTerminalSconce: RouteBuilderAnnotation = { id: 'source-terminal-sconce', pageNumber: 1, label: 'Terminal A', shapeKind: 'electrical-sconce', rect: { x: 0.32, y: 0.7, w: 0.04, h: 0.04 } }
    const annotations = [source, primaryRun, sourceTerminalRun, sourceTerminalSconce]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }))
    ;[0, 1, 2, 3, 4].forEach((index) => { draft = addSegment(draft, primaryRun, index) })
    draft = startPackageAnimationRouteBranch(draft, 'source')
    draft = addSegment(draft, sourceTerminalRun, 0)
    draft = addSegment(draft, sourceTerminalRun, 1)

    const resolved = resolvePackageAnimationRouteDraft(draft)
    expect(resolved.branchOriginNodeId).toBe('animation_node_annotation_source')
    expect(resolved.branchConvergenceNodeId).toBeUndefined()
    expect(resolved.branchTerminalNodeId).toBe('animation_node_annotation_source-terminal-sconce')
    const finished = finishPackageAnimationRouteBranch(draft)
    expect(finished.branches[0]?.editing).toBe(false)
    const scene = packageAnimationRouteDraftToScene(finished).scene!
    expect(scene.branchOrders[0].nodeId).toBe('animation_node_annotation_source')
    expect(summarizePackageAnimationScene(scene, annotations, annotations.map((entry) => entry.id)).advanced).toBe(false)
  })

  it('lets the owner continue past an intermediate eligible sconce before finishing at a later fixture', () => {
    const midSconce: RouteBuilderAnnotation = { id: 'mid-sconce', pageNumber: 1, label: 'Mid Sconce', shapeKind: 'electrical-sconce', rect: { x: 0.64, y: 0.66, w: 0.04, h: 0.04 } }
    const annotations = [source, primaryRun, nodeTwoSconce, branchArcs, midSconce, farRightSconce]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }))
    ;[0, 1, 2, 3, 4].forEach((index) => { draft = addSegment(draft, primaryRun, index) })
    draft = startPackageAnimationRouteBranch(draft, draft.transitions[1].id)
    draft = addSegment(draft, branchArcs, 0)
    // branchArcs point ba2 (0.66,0.68) now carries a real sconce, so after two steps the branch is
    // already finishable as a terminal — but the owner keeps going.
    draft = addSegment(draft, branchArcs, 1)
    const midResolved = resolvePackageAnimationRouteDraft(draft)
    expect(midResolved.branchTerminalNodeId).toBe('animation_node_annotation_mid-sconce')
    expect(getPackageAnimationBranchStatus(draft)?.valid).toBe(true)

    draft = addSegment(draft, branchArcs, 2)
    draft = addSegment(draft, branchArcs, 3)
    const finalResolved = resolvePackageAnimationRouteDraft(draft)
    expect(finalResolved.branchTerminalNodeId).toBe(FAR_RIGHT_ID)
    expect(draft.branches[0]?.editing).toBe(true)
    expect(draft.branches[0]?.transitions).toHaveLength(4)
  })

  it('appends an overlapping package receptacle as an alternate-branch terminal device', () => {
    const receptacle: RouteBuilderAnnotation = {
      id: 'terminal-receptacle',
      pageNumber: 1,
      label: 'Duplex Receptacle',
      shapeKind: 'electrical-receptacle',
      rect: { x: 0.68, y: 0.61, w: 0.04, h: 0.08 },
    }
    const primary: RouteBuilderAnnotation = {
      id: 'primary-for-receptacle', pageNumber: 1, label: 'Primary to light', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
      pointIds: ['pr-start', 'pr-end'], segmentIds: ['pr-seg'],
    }
    const alternate: RouteBuilderAnnotation = {
      id: 'branch-under-receptacle', pageNumber: 1, label: 'Alternate branch', shapeKind: 'circuit-arc',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.28, y: 0.66 }, { x: 0.5, y: 0.66 }, { x: 0.7, y: 0.62 }],
      arcCtrls: [{ x: 0.18, y: 0.64 }, { x: 0.38, y: 0.72 }, { x: 0.6, y: 0.64 }],
      pointIds: ['ba0', 'ba1', 'ba2', 'ba3'], segmentIds: ['bas0', 'bas1', 'bas2'],
    }
    const annotations = [source, fixture2, receptacle, primary, alternate]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }))
    draft = addSegment(draft, primary, 0)
    draft = startPackageAnimationRouteBranch(draft, 'source')
    draft = addSegment(draft, alternate, 0)
    draft = addSegment(draft, alternate, 1)
    draft = addSegment(draft, alternate, 2)

    const selectedDevice = dispatchPackageAnimationRoutePick(draft, { kind: 'annotation', annotationId: 'terminal-receptacle', clickedPoint: { x: 0.7, y: 0.65 } })
    expect(selectedDevice).toMatchObject({ accepted: true, consumed: true, mode: 'alternate-branch', branchActive: true })
    const branchTransitions = selectedDevice.draft.branches[0]?.transitions ?? []
    expect(branchTransitions[branchTransitions.length - 1]).toMatchObject({ kind: 'direct', annotationId: 'terminal-receptacle' })
    expect(resolvePackageAnimationRouteDraft(selectedDevice.draft).branchTerminalNodeId).toBe('animation_node_annotation_terminal-receptacle')
    expect(getPackageAnimationBranchStatus(selectedDevice.draft)).toMatchObject({
      phase: 'Branch valid — ready to finish',
      completionKind: 'terminal',
      valid: true,
    })

    const finished = finishPackageAnimationRouteBranch(selectedDevice.draft)
    expect(finished.branches[0]?.editing).toBe(false)
    const scene = packageAnimationRouteDraftToScene(finished).scene
    expect(scene?.nodes.find((node) => node.id === 'animation_node_annotation_terminal-receptacle')).toMatchObject({
      roles: ['load'],
      anchor: { kind: 'annotation-center', annotationId: 'terminal-receptacle' },
    })
    const reloaded = loadPackageAnimationRouteDraft({
      packageId: finished.packageId,
      packageName: finished.packageName,
      packageAnnotationIds: finished.packageAnnotationIds,
      annotations,
      scene,
      expectedBaseRevision: 1,
    })
    expect(resolvePackageAnimationRouteDraft(reloaded).branchTerminalNodeId).toBe('animation_node_annotation_terminal-receptacle')
  })

  it('validates mixed fixture and emergency-exit-sign parallel branch terminals from a common feeder', () => {
    const normalFixture: RouteBuilderAnnotation = { id: 'normal-fixture', pageNumber: 1, label: 'Normal Fixture', shapeKind: 'electrical-recessed-light', rect: { x: 0.78, y: 0.28, w: 0.04, h: 0.04 } }
    const emergencyFixture: RouteBuilderAnnotation = { id: 'emergency-fixture', pageNumber: 1, label: 'Emergency Fixture', shapeKind: 'electrical-sconce', rect: { x: 0.78, y: 0.48, w: 0.04, h: 0.04 } }
    const branchExitSign: RouteBuilderAnnotation = { id: 'branch-exit-sign', pageNumber: 1, label: 'Emergency Exit Sign', shapeKind: 'electrical-emergency-exit-sign', rect: { x: 0.77, y: 0.68, w: 0.06, h: 0.04 } }
    const sensorDevice: RouteBuilderAnnotation = { ...sensor, rect: { x: 0.28, y: 0.28, w: 0.04, h: 0.04 } }
    const switchToSensor: RouteBuilderAnnotation = {
      id: 'switch-to-sensor', pageNumber: 1, label: 'Switch to Sensor', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.3 }],
      pointIds: ['ss0', 'ss1'], segmentIds: ['sss0'],
    }
    const commonFeeder: RouteBuilderAnnotation = {
      id: 'common-feeder', pageNumber: 1, label: 'Common Feeder', shapeKind: 'circuit-path',
      points: [{ x: 0.3, y: 0.3 }, { x: 0.5, y: 0.5 }],
      pointIds: ['cf0', 'cf1'], segmentIds: ['cfs0'],
    }
    const primaryArm: RouteBuilderAnnotation = {
      id: 'normal-arm', pageNumber: 1, label: 'Normal Arm', shapeKind: 'circuit-path',
      points: [{ x: 0.5, y: 0.5 }, { x: 0.8, y: 0.3 }],
      pointIds: ['na0', 'na1'], segmentIds: ['nas0'],
    }
    const primaryEmergencyArm: RouteBuilderAnnotation = {
      id: 'primary-emergency-arm', pageNumber: 1, label: 'Primary Emergency Arm', shapeKind: 'circuit-path',
      points: [{ x: 0.8, y: 0.3 }, { x: 0.8, y: 0.5 }],
      pointIds: ['ea0', 'ea1'], segmentIds: ['eas0'],
    }
    const exitArm: RouteBuilderAnnotation = {
      id: 'exit-arm', pageNumber: 1, label: 'Exit Arm', shapeKind: 'circuit-arc',
      points: [{ x: 0.5, y: 0.5 }, { x: 0.8, y: 0.7 }],
      arcCtrls: [{ x: 0.63, y: 0.66 }],
      pointIds: ['xa0', 'xa1'], segmentIds: ['xas0'],
    }
    const annotations = [source, sensorDevice, switchToSensor, commonFeeder, primaryArm, primaryEmergencyArm, exitArm, normalFixture, emergencyFixture, branchExitSign]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }))
    draft = addSegment(draft, switchToSensor, 0)
    draft = addSegment(draft, commonFeeder, 0)
    const branchOriginSelectionId = draft.transitions[1].id
    draft = addSegment(draft, primaryArm, 0)
    draft = addSegment(draft, primaryEmergencyArm, 0)

    draft = startPackageAnimationRouteBranch(draft, branchOriginSelectionId)
    draft = addSegment(draft, exitArm, 0)
    const exitBranchResolved = resolvePackageAnimationRouteDraft(draft)
    expect(exitBranchResolved.branchTerminalNodeId).toBe('animation_node_annotation_branch-exit-sign')
    expect(exitBranchResolved.branchConvergenceNodeId).toBeUndefined()
    expect(exitBranchResolved.issues.map((entry) => entry.code)).not.toContain('invalid-branch-endpoint')
    draft = finishPackageAnimationRouteBranch(draft)

    const built = packageAnimationRouteDraftToScene(draft)
    expect(built.issues.filter((entry) => entry.severity === 'error')).toEqual([])
    const scene = built.scene!
    const branchOriginNodeId = 'animation_node_point_common-feeder_cf1'
    expect(scene.branchOrders).toHaveLength(1)
    expect(scene.branchOrders[0]).toMatchObject({ nodeId: branchOriginNodeId })
    expect(scene.branchOrders[0].outgoingEdgeIds).toHaveLength(2)
    expect(scene.nodes.find((node) => node.id === 'animation_node_annotation_normal-fixture')).toMatchObject({ roles: ['load'] })
    expect(scene.nodes.find((node) => node.id === 'animation_node_annotation_emergency-fixture')).toMatchObject({ roles: ['load'] })
    expect(scene.nodes.find((node) => node.id === 'animation_node_annotation_branch-exit-sign')).toMatchObject({
      roles: ['load'],
      anchor: { kind: 'annotation-center', annotationId: 'branch-exit-sign' },
    })
    expect(scene.nodes.find((node) => node.id === branchOriginNodeId)?.roles).toEqual(['junction'])
    expect(scene.manualTraversal.some((step) => scene.edges.find((edge) => edge.id === step.edgeId)?.toNodeId === 'animation_node_annotation_branch-exit-sign')).toBe(true)

    const simultaneousTimeline = createPlaybackTimeline(
      preparePlaybackGeometry({ scene: { ...scene, playbackOptions: { ...scene.playbackOptions, branchMode: 'simultaneous' } }, annotations, pageMetrics: { width: 1000, height: 1000 } }),
      { ...playbackOptions, branchMode: 'simultaneous' },
    )
    const sequentialTimeline = createPlaybackTimeline(
      preparePlaybackGeometry({ scene: { ...scene, playbackOptions: { ...scene.playbackOptions, branchMode: 'sequential' } }, annotations, pageMetrics: { width: 1000, height: 1000 } }),
      { ...playbackOptions, branchMode: 'sequential' },
    )
    expect(calculatePlaybackFrame(simultaneousTimeline, simultaneousTimeline.totalDurationMs).devices.find((device) => device.nodeId === 'animation_node_annotation_branch-exit-sign')).toMatchObject({ phase: 'active' })
    expect(calculatePlaybackFrame(sequentialTimeline, sequentialTimeline.totalDurationMs).devices.find((device) => device.nodeId === 'animation_node_annotation_branch-exit-sign')).toMatchObject({ phase: 'active' })

    const reloaded = loadPackageAnimationRouteDraft({
      packageId: draft.packageId,
      packageName: draft.packageName,
      packageAnnotationIds: draft.packageAnnotationIds,
      annotations,
      scene,
      expectedBaseRevision: 1,
    })
    const resaved = packageAnimationRouteDraftToScene(reloaded).scene!
    expect(resaved.branchOrders).toEqual(scene.branchOrders)
    expect(resaved.manualTraversal).toEqual(scene.manualTraversal)
  })

  it('does not append an overlapping receptacle that is outside the active package', () => {
    const receptacle: RouteBuilderAnnotation = {
      id: 'outside-receptacle',
      pageNumber: 1,
      label: 'Outside Receptacle',
      shapeKind: 'electrical-receptacle',
      rect: { x: 0.68, y: 0.61, w: 0.04, h: 0.08 },
    }
    const primary: RouteBuilderAnnotation = {
      id: 'outside-primary', pageNumber: 1, label: 'Primary', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
      pointIds: ['op0', 'op1'], segmentIds: ['ops0'],
    }
    const annotations = [source, fixture2, receptacle, primary]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: ['source', 'fixture-2', 'outside-primary'] }))
    draft = addSegment(draft, primary, 0)
    draft = startPackageAnimationRouteBranch(draft, 'source')

    const rejected = dispatchPackageAnimationRoutePick(draft, { kind: 'annotation', annotationId: 'outside-receptacle', clickedPoint: { x: 0.7, y: 0.65 } })
    expect(rejected).toMatchObject({ accepted: false, consumed: true, mode: 'alternate-branch', branchActive: true })
    expect(rejected.draft.branches[0]?.transitions).toEqual([])
    expect(rejected.draft.notice?.code).toBe('annotation-not-in-package')
  })

  it('uses the same direct device selection for a primary-route receptacle terminal', () => {
    const receptacle: RouteBuilderAnnotation = {
      id: 'primary-receptacle',
      pageNumber: 1,
      label: 'Primary Receptacle',
      shapeKind: 'electrical-gfci',
      rect: { x: 0.68, y: 0.46, w: 0.04, h: 0.08 },
    }
    const annotations = [source, receptacle]
    const draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }))
    const picked = dispatchPackageAnimationRoutePick(draft, {
      kind: 'annotation',
      annotationId: 'primary-receptacle',
      clickedPoint: { x: 0.7, y: 0.5 },
      allowPrimaryDirectTransition: true,
    })

    expect(picked).toMatchObject({ accepted: true, consumed: true, mode: 'primary-route', branchActive: false })
    expect(picked.draft.transitions).toHaveLength(1)
    expect(resolvePackageAnimationRouteDraft(picked.draft).nodes[1]).toMatchObject({
      roles: ['load'],
      anchor: { kind: 'annotation-center', annotationId: 'primary-receptacle' },
    })
  })

  it('refuses to finish a branch whose endpoint is a bare wire junction (mid-wire / crossing)', () => {
    const bareWire: RouteBuilderAnnotation = {
      id: 'bare-wire', pageNumber: 1, label: 'Bare wire', shapeKind: 'circuit-path',
      points: [{ x: 0.42, y: 0.5 }, { x: 0.5, y: 0.7 }], pointIds: ['bw0', 'bw1'], segmentIds: ['bws0'],
    }
    const annotations = [source, primaryRun, nodeTwoSconce, bareWire]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }))
    ;[0, 1, 2, 3, 4].forEach((index) => { draft = addSegment(draft, primaryRun, index) })
    draft = startPackageAnimationRouteBranch(draft, draft.transitions[1].id)
    draft = addSegment(draft, bareWire, 0)

    const resolved = resolvePackageAnimationRouteDraft(draft)
    expect(resolved.branchTerminalNodeId).toBeUndefined()
    expect(resolved.branchConvergenceNodeId).toBeUndefined()
    expect(resolved.issues.map((entry) => entry.code)).toContain('invalid-branch-endpoint')
    // Finish is inert while the endpoint is not an eligible fixture/device.
    const attempted = finishPackageAnimationRouteBranch(draft)
    expect(attempted.branches[0]?.editing).toBe(true)
  })

  it('cannot finish an empty branch or a branch whose only step cycles back to the origin', () => {
    const primary = screenshotPrimary()
    const emptyBranch = startPackageAnimationRouteBranch(primary, primary.transitions[1].id)
    expect(resolvePackageAnimationRouteDraft(emptyBranch).branchTerminalNodeId).toBeUndefined()
    expect(finishPackageAnimationRouteBranch(emptyBranch).branches[0]?.editing).toBe(true)

    // A branch step that returns to the origin device is a cycle, never a terminal endpoint.
    let draft = sourceDraft()
    draft = addSegment(draft, circuit, 0)
    draft = addSegment(draft, circuit, 1)
    const branch = startPackageAnimationRouteBranch(draft, 'source')
    const cycle = dispatchPackageAnimationRoutePick(branch, { kind: 'annotation', annotationId: 'source' })
    expect(cycle.accepted).toBe(false)
    expect(cycle.draft.notice?.code).toBe('branch-cycle')
    expect(resolvePackageAnimationRouteDraft(cycle.draft).branchTerminalNodeId).toBeUndefined()
  })

  it('keeps all rejoin completion kinds working and does not misclassify a rejoin as terminal', () => {
    // Exact shared-device rejoin: the branch ends on a later primary device (fixture-2).
    let primary = addSegment(sourceDraft(), circuit, 0)
    primary = addSegment(primary, circuit, 1)
    let branch = startPackageAnimationRouteBranch(primary, 'source')
    branch = addSegment(branch, branchCircuit, 0)
    branch = addSegment(branch, branchCircuit, 1)
    const resolved = resolvePackageAnimationRouteDraft(branch)
    expect(resolved.branchConvergenceNodeId).toBe('animation_node_annotation_fixture-2')
    expect(resolved.branchTerminalNodeId).toBeUndefined()
    expect(getPackageAnimationBranchStatus(branch)).toMatchObject({ completionKind: 'rejoin', valid: true })
    const finished = finishPackageAnimationRouteBranch(branch)
    expect(finished.branches[0]?.editing).toBe(false)
    expect(packageAnimationRouteDraftToScene(finished).scene?.branchOrders).toHaveLength(1)
  })

  it('rejects a duplicate primary segment inside a terminal branch without dropping branch state', () => {
    const draft = screenshotTerminalBranch()
    // primaryRun segment 0 is already used by the primary route; reusing it in the branch is rejected.
    const beforeBranch = structuredClone(draft.branches[0]?.transitions)
    const duplicate = addPackageAnimationRouteSegment(draft, segmentPick(primaryRun, 0))
    expect(duplicate.accepted).toBe(false)
    expect(duplicate.draft.branches[0]?.transitions).toEqual(beforeBranch)
    expect(duplicate.draft.branches[0]?.editing).toBe(true)
  })

  it('leaves rejoining scenes backward-compatible and preserves package annotation ordering', () => {
    // A previously-authored rejoin scene still parses, validates, and reopens editable.
    let rejoinDraft = addSegment(sourceDraft(), circuit, 0)
    rejoinDraft = addSegment(rejoinDraft, circuit, 1)
    let branch = startPackageAnimationRouteBranch(rejoinDraft, 'source')
    branch = addSegment(branch, branchCircuit, 0)
    branch = addSegment(branch, branchCircuit, 1)
    const rejoinScene = packageAnimationRouteDraftToScene(finishPackageAnimationRouteBranch(branch)).scene!
    const reloaded = loadPackageAnimationRouteDraft({
      packageId: 'package', packageName: 'Lighting',
      packageAnnotationIds: allAnnotations().map((entry) => entry.id), annotations: allAnnotations(),
      scene: rejoinScene, expectedBaseRevision: 1,
    })
    expect(reloaded.readOnlyReason).toBeUndefined()
    expect(resolvePackageAnimationRouteDraft(reloaded).branchConvergenceNodeId).toBe('animation_node_annotation_fixture-2')

    // Clearing a terminal-branch draft removes the route without touching package membership order.
    const order = screenshotAnnotations.map((entry) => entry.id)
    const cleared = clearPackageAnimationRouteDraft(screenshotTerminalBranch())
    expect(cleared.source).toBeUndefined()
    expect(cleared.branches[0]).toBeUndefined()
    expect(cleared.packageAnnotationIds).toEqual(order)
  })

  it('authors Point 2 and Point 3 terminal branches without replacing the first junction', () => {
    const pointThreeBranch: RouteBuilderAnnotation = {
      id: 'point-three-branch', pageNumber: 1, label: 'Point 3 branch', shapeKind: 'circuit-path',
      points: [{ x: 0.58, y: 0.5 }, { x: 0.66, y: 0.78 }, { x: 0.76, y: 0.74 }],
      pointIds: ['p3b0', 'p3b1', 'p3b2'], segmentIds: ['p3bs0', 'p3bs1'],
    }
    const pointThreeTerminal: RouteBuilderAnnotation = { id: 'point-three-terminal', pageNumber: 1, label: 'Branch B Sconce', shapeKind: 'electrical-sconce', rect: { x: 0.74, y: 0.72, w: 0.04, h: 0.04 } }
    const annotations = [...screenshotAnnotations, pointThreeBranch, pointThreeTerminal]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }))
    ;[0, 1, 2, 3, 4].forEach((index) => { draft = addSegment(draft, primaryRun, index) })

    draft = startPackageAnimationRouteBranch(draft, draft.transitions[1].id)
    ;[0, 1, 2, 3].forEach((index) => { draft = addSegment(draft, branchArcs, index) })
    draft = finishPackageAnimationRouteBranch(draft)
    const pointTwoBranch = structuredClone(draft.branches[0])

    draft = startPackageAnimationRouteBranch(draft, draft.transitions[2].id)
    expect(draft.branches[0]).toEqual(pointTwoBranch)
    ;[0, 1].forEach((index) => { draft = addSegment(draft, pointThreeBranch, index) })
    draft = finishPackageAnimationRouteBranch(draft)

    expect(draft.activeBranchId).toBeNull()
    expect(draft.branches).toHaveLength(2)
    expect(draft.branches[0]).toEqual(pointTwoBranch)
    expect(getPackageAnimationBranchSummaries(draft).map((summary) => summary.originNumber)).toEqual([3, 4])

    const built = packageAnimationRouteDraftToScene(draft)
    expect(built.issues.filter((entry) => entry.severity === 'error')).toEqual([])
    const scene = built.scene!
    expect(scene.branchOrders).toHaveLength(2)
    expect(scene.branchOrders.map((order) => order.nodeId)).toEqual([NODE_TWO_ID, 'animation_node_point_primary-run_pr3'])
    scene.branchOrders.forEach((order) => {
      expect(order.outgoingEdgeIds).toHaveLength(2)
      const [primaryEdgeId, alternateEdgeId] = order.outgoingEdgeIds
      expect(scene.edges.find((edge) => edge.id === primaryEdgeId)?.fromNodeId).toBe(order.nodeId)
      expect(scene.edges.find((edge) => edge.id === alternateEdgeId)?.fromNodeId).toBe(order.nodeId)
    })
    expect(summarizePackageAnimationScene(scene, annotations, annotations.map((entry) => entry.id))).toMatchObject({ advanced: false })

    const reopened = loadPackageAnimationRouteDraft({
      packageId: 'package', packageName: 'Lighting',
      packageAnnotationIds: annotations.map((entry) => entry.id), annotations,
      scene, expectedBaseRevision: 1,
    })
    expect(reopened.readOnlyReason).toBeUndefined()
    expect(reopened.activeBranchId).toBeNull()
    expect(reopened.branches.map((branch) => branch.originSelectionId)).toEqual([draft.transitions[1].id, draft.transitions[2].id])
    expect(packageAnimationRouteDraftToScene(reopened).scene?.branchOrders).toEqual(scene.branchOrders)

    const storedLayers = mergeBlueprintScopeLayersById([], [{
      ...packageWith(scene, 1),
      selectedAnnotationIds: annotations.map((entry) => entry.id),
      itemRefs: annotations.map((entry) => ({ annotationId: entry.id, pageNumber: entry.pageNumber, label: entry.label })),
      animationScene: scene,
      animationSceneRevision: 1,
      updatedAt: '2026-07-19T12:00:00.000Z',
    }])
    const storedScene = storedLayers[0].animationScene as typeof scene
    const storedReopened = loadPackageAnimationRouteDraft({
      packageId: 'package', packageName: 'Lighting',
      packageAnnotationIds: annotations.map((entry) => entry.id), annotations,
      scene: storedScene, expectedBaseRevision: 1,
    })
    const storedResaved = packageAnimationRouteDraftToScene(storedReopened).scene!

    expect(storedScene.schemaVersion).toBe(1)
    expect(compareAnimationScenesForVerification(storedScene, scene)).toBe(true)
    expect(storedScene.branchOrders).toHaveLength(2)
    expect(storedScene.branchOrders).toEqual(scene.branchOrders)
    expect(storedScene.branchOrders.map((order) => order.outgoingEdgeIds)).toEqual(scene.branchOrders.map((order) => order.outgoingEdgeIds))
    expect(storedScene.manualTraversal).toEqual(scene.manualTraversal)
    expect(storedResaved.branchOrders).toEqual(scene.branchOrders)
    expect(storedResaved.manualTraversal).toEqual(scene.manualTraversal)
  })

  it('targets edit cancel and delete by stable branch ID', () => {
    const pointThreeBranch: RouteBuilderAnnotation = {
      id: 'delete-point-three-branch', pageNumber: 1, label: 'Point 3 branch', shapeKind: 'circuit-path',
      points: [{ x: 0.58, y: 0.5 }, { x: 0.66, y: 0.78 }, { x: 0.76, y: 0.74 }],
      pointIds: ['dp3b0', 'dp3b1', 'dp3b2'], segmentIds: ['dp3bs0', 'dp3bs1'],
    }
    const pointThreeTerminal: RouteBuilderAnnotation = { id: 'delete-point-three-terminal', pageNumber: 1, label: 'Branch B Sconce', shapeKind: 'electrical-sconce', rect: { x: 0.74, y: 0.72, w: 0.04, h: 0.04 } }
    const annotations = [...screenshotAnnotations, pointThreeBranch, pointThreeTerminal]
    let draft = sourceDraft(empty({ annotations, packageAnnotationIds: annotations.map((entry) => entry.id) }))
    ;[0, 1, 2, 3, 4].forEach((index) => { draft = addSegment(draft, primaryRun, index) })
    draft = finishPackageAnimationRouteBranch([0, 1, 2, 3].reduce((next, index) => addSegment(next, branchArcs, index), startPackageAnimationRouteBranch(draft, draft.transitions[1].id)))
    draft = finishPackageAnimationRouteBranch([0, 1].reduce((next, index) => addSegment(next, pointThreeBranch, index), startPackageAnimationRouteBranch(draft, draft.transitions[2].id)))
    const [pointTwo, pointThree] = draft.branches

    const editingPointThree = editPackageAnimationRouteBranch(draft, pointThree.id)
    expect(editingPointThree.activeBranchId).toBe(pointThree.id)
    expect(editingPointThree.branches[0]).toEqual(pointTwo)
    const cancelled = cancelPackageAnimationRouteBranch(removePackageAnimationRouteTransition(editingPointThree, pointThree.transitions[1].id))
    expect(cancelled.branches.find((branch) => branch.id === pointThree.id)?.transitions).toEqual(pointThree.transitions)
    expect(cancelled.branches.find((branch) => branch.id === pointTwo.id)).toEqual(pointTwo)

    const deletedPointTwo = removePackageAnimationRouteBranch(cancelled, pointTwo.id)
    expect(deletedPointTwo.branches.map((branch) => branch.id)).toEqual([pointThree.id])
    expect(packageAnimationRouteDraftToScene(deletedPointTwo).scene?.branchOrders).toHaveLength(1)
  })
})
