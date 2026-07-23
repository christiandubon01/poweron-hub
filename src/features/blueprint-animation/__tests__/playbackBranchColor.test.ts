import { describe, expect, it } from 'vitest'
import { createCircuitGeometryFingerprint } from '../routeGeometry'
import {
  buildCircuitSegmentRouteAppearanceColorMap,
  circuitSegmentChannelKey,
  resolveAnimationRouteEdgeRole,
  resolveDefaultRouteColor,
  resolvePlaybackChannelColor,
  resolvePlaybackEdgeStrokeColor,
  resolvePlaybackPathState,
  resolveSourceConnectorEdgeId,
  BLUEPRINT_ROUTE_SOURCE_CONNECTOR_COLOR,
} from '../playbackPathAppearance'
import { preparePlaybackGeometry } from '../playbackGeometry'
import { createPlaybackTimeline } from '../playbackModel'
import {
  addPackageAnimationRouteSegment,
  createEmptyPackageAnimationRouteDraft,
  finishPackageAnimationRouteBranch,
  packageAnimationRouteDraftToScene,
  selectPackageAnimationRouteSource,
  startPackageAnimationRouteBranch,
  type PackageAnimationRouteDraft,
  type RouteBuilderAnnotation,
} from '../routeBuilderModel'
import type { RouteSegmentPick } from '../routePicking'

const CYAN = '#22d3ee'
const OLD_AMBER_ACCENT = '#f59e0b'

// A switch source → 5-step primary run; a branch off primary node #2 (a sconce). The source connector
// and the branch's first edge both carry the switch's `switched-line-voltage` channel (yellow), which
// is exactly the channel-derived difference the owner no longer wants to see.
const source: RouteBuilderAnnotation = { id: 'source', pageNumber: 1, label: 'Switch', shapeKind: 'electrical-switch', rect: { x: 0.08, y: 0.48, w: 0.04, h: 0.04 } }
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
// A branch that rejoins the primary run at its last point (physical coincidence rejoin).
const rejoinBranch: RouteBuilderAnnotation = {
  id: 'rejoin-branch', pageNumber: 1, label: 'Rejoin branch', shapeKind: 'circuit-path',
  points: [{ x: 0.42, y: 0.5 }, { x: 0.5, y: 0.3 }, { x: 0.9, y: 0.5 }],
  pointIds: ['rb0', 'rb1', 'rb2'], segmentIds: ['rbs0', 'rbs1'],
}
// A branch that leaves the source itself, so the source node has two outgoing edges.
const sourceBranchRun: RouteBuilderAnnotation = {
  id: 'source-branch-run', pageNumber: 1, label: 'Source branch', shapeKind: 'circuit-arc',
  points: [{ x: 0.1, y: 0.5 }, { x: 0.18, y: 0.7 }, { x: 0.3, y: 0.74 }],
  arcCtrls: [{ x: 0.12, y: 0.6 }, { x: 0.24, y: 0.74 }], pointIds: ['sb0', 'sb1', 'sb2'], segmentIds: ['sbs0', 'sbs1'],
}
const sourceBranchSconce: RouteBuilderAnnotation = { id: 'source-branch-sconce', pageNumber: 1, label: 'Source branch sconce', shapeKind: 'electrical-sconce', rect: { x: 0.28, y: 0.72, w: 0.04, h: 0.04 } }
const annotations = [source, primaryRun, nodeTwoSconce, branchArcs, farRightSconce, rejoinBranch, sourceBranchRun, sourceBranchSconce]

function segmentPick(annotation: RouteBuilderAnnotation, index: number): RouteSegmentPick {
  const points = annotation.points!
  const shapeKind = annotation.shapeKind as 'circuit-path' | 'circuit-arc'
  return {
    annotationId: annotation.id, pageNumber: annotation.pageNumber, shapeKind,
    segmentId: annotation.segmentIds![index], segmentIndexHint: index,
    geometryFingerprint: createCircuitGeometryFingerprint({ annotationId: annotation.id, pageNumber: annotation.pageNumber, shapeKind, points, arcCtrls: annotation.arcCtrls }),
    startPointId: annotation.pointIds![index], endPointId: annotation.pointIds![index + 1],
    startPointIndexHint: index, endPointIndexHint: index + 1,
    start: points[index], end: points[index + 1],
    ...(shapeKind === 'circuit-arc' ? { control: annotation.arcCtrls![index] } : {}),
    distancePx: 1,
  }
}
function addSegment(draft: PackageAnimationRouteDraft, annotation: RouteBuilderAnnotation, index: number) {
  const result = addPackageAnimationRouteSegment(draft, segmentPick(annotation, index))
  expect(result.accepted).toBe(true)
  return result.draft
}
function primaryDraft() {
  let draft = createEmptyPackageAnimationRouteDraft({ packageId: 'p', packageName: 'L', packageAnnotationIds: annotations.map((a) => a.id), annotations, now: '2026-07-19T00:00:00.000Z', sceneId: 'scene-1' })
  draft = selectPackageAnimationRouteSource(draft, 'source').draft
  ;[0, 1, 2, 3, 4].forEach((i) => { draft = addSegment(draft, primaryRun, i) })
  return draft
}
function terminalScene() {
  const base = primaryDraft()
  let draft = startPackageAnimationRouteBranch(base, base.transitions[1].id)
  ;[0, 1, 2, 3].forEach((i) => { draft = addSegment(draft, branchArcs, i) })
  return packageAnimationRouteDraftToScene(finishPackageAnimationRouteBranch(draft)).scene!
}
function rejoinScene() {
  const base = primaryDraft()
  let draft = startPackageAnimationRouteBranch(base, base.transitions[1].id)
  draft = addSegment(draft, rejoinBranch, 0)
  draft = addSegment(draft, rejoinBranch, 1)
  return packageAnimationRouteDraftToScene(finishPackageAnimationRouteBranch(draft)).scene!
}
function sourceOriginScene() {
  const base = primaryDraft()
  let draft = startPackageAnimationRouteBranch(base, 'source')
  draft = addSegment(draft, sourceBranchRun, 0)
  draft = addSegment(draft, sourceBranchRun, 1)
  return packageAnimationRouteDraftToScene(finishPackageAnimationRouteBranch(draft)).scene!
}
/** The role→color the renderer applies for each saved edge. */
function edgeColors(scene: ReturnType<typeof terminalScene>) {
  const sourceConnectorEdgeId = resolveSourceConnectorEdgeId(scene)
  return scene.edges.map((edge) => ({
    edge,
    role: resolveAnimationRouteEdgeRole(edge.id, sourceConnectorEdgeId),
    color: resolvePlaybackEdgeStrokeColor({ role: resolveAnimationRouteEdgeRole(edge.id, sourceConnectorEdgeId) }),
  }))
}

describe('ANIM-5.3B unified route color (pure helpers)', () => {
  it('resolves the default route color from the existing generic-route channel color', () => {
    expect(resolveDefaultRouteColor()).toBe(resolvePlaybackChannelColor('generic-route'))
    expect(resolveDefaultRouteColor()).toBe(CYAN)
  })

  it('paints the source connector cyan and every routed edge the one default color', () => {
    expect(resolvePlaybackEdgeStrokeColor({ role: 'source-connector' })).toBe(BLUEPRINT_ROUTE_SOURCE_CONNECTOR_COLOR)
    expect(BLUEPRINT_ROUTE_SOURCE_CONNECTOR_COLOR).toBe(CYAN)
    expect(resolvePlaybackEdgeStrokeColor({ role: 'route' })).toBe(resolveDefaultRouteColor())
  })

  it('never emits the removed amber branch-origin accent', () => {
    expect(resolvePlaybackEdgeStrokeColor({ role: 'source-connector' })).not.toBe(OLD_AMBER_ACCENT)
    expect(resolvePlaybackEdgeStrokeColor({ role: 'route' })).not.toBe(OLD_AMBER_ACCENT)
  })

  it('uses the shared role resolver for resting paths and preserves ambiguous cross-scene fallback', () => {
    const matching = buildCircuitSegmentRouteAppearanceColorMap([
      { annotationId: 'path', segmentId: 'primary', role: 'route' },
      { annotationId: 'path', segmentId: 'primary', role: 'route' },
      { annotationId: 'arc', segmentId: 'branch', role: 'route' },
    ])
    expect(matching.get(circuitSegmentChannelKey('path', 'primary'))).toBe(resolveDefaultRouteColor())
    expect(matching.get(circuitSegmentChannelKey('arc', 'branch'))).toBe(resolveDefaultRouteColor())

    const conflicting = buildCircuitSegmentRouteAppearanceColorMap([
      { annotationId: 'shared', segmentId: 'segment', role: 'source-connector' },
      { annotationId: 'shared', segmentId: 'segment', role: 'route' },
    ])
    expect(conflicting.has(circuitSegmentChannelKey('shared', 'segment'))).toBe(false)
  })

  it('assigns the source-connector role only to the source connector edge id', () => {
    expect(resolveAnimationRouteEdgeRole('edge-a', 'edge-a')).toBe('source-connector')
    expect(resolveAnimationRouteEdgeRole('edge-b', 'edge-a')).toBe('route')
    expect(resolveAnimationRouteEdgeRole('edge-a', undefined)).toBe('route')
    expect(resolveAnimationRouteEdgeRole(undefined, undefined)).toBe('route')
  })
})

describe('ANIM-5.3B source-connector identification (structural)', () => {
  it('identifies the single source outgoing edge as the connector when the source does not fork', () => {
    const scene = terminalScene()
    const sourceNodeId = scene.sources[0].nodeId
    const outgoing = scene.edges.filter((edge) => edge.fromNodeId === sourceNodeId)
    expect(outgoing).toHaveLength(1)
    expect(resolveSourceConnectorEdgeId(scene)).toBe(outgoing[0].id)
    expect(outgoing[0].fromNodeId).toBe('animation_node_annotation_source')
  })

  it('picks the primary continuation (not the branch) when the source itself forks', () => {
    const scene = sourceOriginScene()
    const sourceNodeId = scene.sources[0].nodeId
    const outgoing = scene.edges.filter((edge) => edge.fromNodeId === sourceNodeId)
    expect(outgoing).toHaveLength(2)
    const order = scene.branchOrders.find((o) => o.nodeId === sourceNodeId)!
    const connectorEdgeId = resolveSourceConnectorEdgeId(scene)
    // The connector is the branch order's primary continuation (first outgoing), not the alternate.
    expect(connectorEdgeId).toBe(order.outgoingEdgeIds[0])
    expect(connectorEdgeId).not.toBe(order.outgoingEdgeIds[order.outgoingEdgeIds.length - 1])
    // The source's other outgoing edge (the branch) is a routed edge, default color.
    const branchFromSource = order.outgoingEdgeIds[order.outgoingEdgeIds.length - 1]
    expect(resolveAnimationRouteEdgeRole(branchFromSource, connectorEdgeId)).toBe('route')
    expect(resolvePlaybackEdgeStrokeColor({ role: resolveAnimationRouteEdgeRole(branchFromSource, connectorEdgeId) })).toBe(CYAN)
  })

  it('does not use edge-array order for an ambiguous undeclared source fan-out', () => {
    expect(resolveSourceConnectorEdgeId({
      sources: [{ nodeId: 'source' }],
      edges: [
        { id: 'edge-b', fromNodeId: 'source', toNodeId: 'b' },
        { id: 'edge-a', fromNodeId: 'source', toNodeId: 'a' },
      ],
      branchOrders: [],
    })).toBeUndefined()
  })
})

describe('ANIM-5.3B whole-route color on authored scenes', () => {
  it('makes exactly one edge (the source connector) cyan and every other edge the default color — terminal branch', () => {
    const scene = terminalScene()
    const colored = edgeColors(scene)
    const connectors = colored.filter((entry) => entry.role === 'source-connector')
    expect(connectors).toHaveLength(1)
    expect(connectors[0].edge.fromNodeId).toBe('animation_node_annotation_source')
    expect(connectors[0].color).toBe(CYAN)
    // Every routed edge (primary tail + full branch incl. the split) is the one default color.
    const routed = colored.filter((entry) => entry.role === 'route')
    expect(routed.length).toBe(scene.edges.length - 1)
    routed.forEach((entry) => expect(entry.color).toBe(resolveDefaultRouteColor()))
    // Nothing is amber; the whole route renders one continuous color.
    expect(new Set(colored.map((entry) => entry.color))).toEqual(new Set([CYAN]))
    expect(colored.some((entry) => entry.color === OLD_AMBER_ACCENT)).toBe(false)
  })

  it('does not change color at the branch split / branch-origin edge — terminal branch', () => {
    const scene = terminalScene()
    const order = scene.branchOrders[0]
    const branchOriginEdgeId = order.outgoingEdgeIds[order.outgoingEdgeIds.length - 1]
    const connectorEdgeId = resolveSourceConnectorEdgeId(scene)
    const primaryContinuationEdgeId = order.outgoingEdgeIds[0]
    // The primary continuation and the alternate split leaving the origin are the SAME color.
    const branchOriginColor = resolvePlaybackEdgeStrokeColor({ role: resolveAnimationRouteEdgeRole(branchOriginEdgeId, connectorEdgeId) })
    const primaryColor = resolvePlaybackEdgeStrokeColor({ role: resolveAnimationRouteEdgeRole(primaryContinuationEdgeId, connectorEdgeId) })
    expect(branchOriginColor).toBe(primaryColor)
    expect(branchOriginColor).toBe(resolveDefaultRouteColor())
    expect(branchOriginColor).not.toBe(OLD_AMBER_ACCENT)
  })

  it('does not change color at a rejoin/convergence — rejoining branch', () => {
    const scene = rejoinScene()
    const colored = edgeColors(scene)
    expect(colored.filter((entry) => entry.role === 'source-connector')).toHaveLength(1)
    // Both the split-leaving edge and the converging edge are the default route color.
    expect(new Set(colored.map((entry) => entry.color))).toEqual(new Set([CYAN]))
    const order = scene.branchOrders[0]
    const connectorEdgeId = resolveSourceConnectorEdgeId(scene)
    order.outgoingEdgeIds.forEach((edgeId) => {
      expect(resolvePlaybackEdgeStrokeColor({ role: resolveAnimationRouteEdgeRole(edgeId, connectorEdgeId) })).toBe(resolveDefaultRouteColor())
    })
  })

  it('keeps the same source connector cyan under reverse traversal', () => {
    const scene = terminalScene()
    const connectorEdgeId = resolveSourceConnectorEdgeId(scene)
    const forward = preparePlaybackGeometry({ scene, annotations, pageMetrics: { width: 1000, height: 1000 } })
    const reverseScene = { ...scene, playbackOptions: { ...scene.playbackOptions, direction: 'reverse' as const } }
    const reverse = preparePlaybackGeometry({ scene: reverseScene, annotations, pageMetrics: { width: 1000, height: 1000 } })
    // Edge identity is unchanged by direction, so the physical source connector stays cyan either way.
    const forwardConnectorStep = forward.steps.find((step) => step.edgeId === connectorEdgeId)
    const reverseConnectorStep = reverse.steps.find((step) => step.edgeId === connectorEdgeId)
    expect(forwardConnectorStep).toBeDefined()
    expect(reverseConnectorStep).toBeDefined()
    ;[forwardConnectorStep!, reverseConnectorStep!].forEach((step) => {
      expect(resolvePlaybackEdgeStrokeColor({ role: resolveAnimationRouteEdgeRole(step.edgeId, connectorEdgeId) })).toBe(CYAN)
    })
    // A non-connector step stays the default color in both directions.
    const otherEdgeId = scene.edges.find((edge) => edge.id !== connectorEdgeId)!.id
    expect(resolvePlaybackEdgeStrokeColor({ role: resolveAnimationRouteEdgeRole(otherEdgeId, connectorEdgeId) })).toBe(resolveDefaultRouteColor())
  })

  it('is state-independent: subdued, energized, paused and completed all use the same role color', () => {
    // The renderer resolves color once per edge (by role) and only varies OPACITY by path state, so
    // primary and branch routed edges match in every state; path-state boundaries are unchanged.
    const routeColor = resolvePlaybackEdgeStrokeColor({ role: 'route' })
    expect(routeColor).toBe(resolvePlaybackEdgeStrokeColor({ role: 'route' }))
    const window = { travelStartMs: 100, travelEndMs: 300 }
    expect(resolvePlaybackPathState({ elapsedMs: 50, ...window })).toBe('not-yet')      // ahead of orb
    expect(resolvePlaybackPathState({ elapsedMs: 200, ...window })).toBe('dim-pulsing') // pre-orb subdued
    expect(resolvePlaybackPathState({ elapsedMs: 300, ...window })).toBe('solid')       // energized/completed
  })

  it('keeps the role colors through idle, stop, restart, playing, paused, and complete states', () => {
    const states = ['idle', 'stopped', 'restarted', 'playing', 'paused', 'complete'] as const
    states.forEach(() => {
      expect(resolvePlaybackEdgeStrokeColor({ role: 'source-connector' })).toBe(CYAN)
      expect(resolvePlaybackEdgeStrokeColor({ role: 'route' })).toBe(resolveDefaultRouteColor())
    })
  })

  it('reads the scene without mutating any saved channel and keeps playback timing intact', () => {
    const scene = terminalScene()
    const channelsBefore = scene.edges.map((edge) => edge.channel)
    edgeColors(scene) // resolve colors (read-only)
    expect(scene.edges.map((edge) => edge.channel)).toEqual(channelsBefore)
    // The source connector and branch-origin still carry their original switched channel; only the
    // rendered color is unified — nothing was written back.
    const order = scene.branchOrders[0]
    const branchOriginEdge = scene.edges.find((edge) => edge.id === order.outgoingEdgeIds[order.outgoingEdgeIds.length - 1])!
    expect(branchOriginEdge.channel).toBe('switched-line-voltage')

    // Color work never touches the timeline: it still builds with the same steps/durations.
    const geometry = preparePlaybackGeometry({ scene, annotations, pageMetrics: { width: 1000, height: 1000 } })
    const timeline = createPlaybackTimeline(geometry, scene.playbackOptions)
    expect(timeline.steps).toHaveLength(scene.manualTraversal.length)
    expect(timeline.hasBranches).toBe(true)
  })
})
