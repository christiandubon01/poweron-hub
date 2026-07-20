import {
  buildRouteSegmentGeometry,
  createCircuitGeometryFingerprint,
  resolveCircuitPointIndex,
  resolveCircuitSegmentIndex,
  type NormalizedPoint,
  type RouteSegmentGeometry,
} from './routeGeometry'
import type { RouteBuilderAnnotation } from './routeBuilderModel'
import type {
  BlueprintAnimationChannelType,
  BlueprintAnimationDeviceRole,
  BlueprintAnimationNode,
  BlueprintScopeAnimationSceneV1,
} from './types'

export interface PlaybackPageMetrics {
  width: number
  height: number
}

export interface PreparedPlaybackNode {
  id: string
  pageNumber: number
  point: NormalizedPoint
  roles: BlueprintAnimationDeviceRole[]
}

export interface PreparedPlaybackSegmentGeometry extends RouteSegmentGeometry {
  kind: 'straight' | 'quadratic'
  start: NormalizedPoint
  end: NormalizedPoint
  control?: NormalizedPoint
  renderPoints: NormalizedPoint[]
}

export interface PreparedPlaybackGeometryStep {
  id: string
  edgeId: string
  channel: BlueprintAnimationChannelType
  pageNumber: number
  fromNodeId: string
  toNodeId: string
  kind: 'circuit-segment' | 'direct'
  start: NormalizedPoint
  end: NormalizedPoint
  geometry?: PreparedPlaybackSegmentGeometry
}

export interface PreparedPlaybackGeometry {
  sourceNodeId: string
  nodes: PreparedPlaybackNode[]
  steps: PreparedPlaybackGeometryStep[]
}

function finiteMetrics(metrics: PlaybackPageMetrics): PlaybackPageMetrics {
  if (!Number.isFinite(metrics.width) || metrics.width <= 0 || !Number.isFinite(metrics.height) || metrics.height <= 0) {
    throw new RangeError('Playback page metrics must contain positive finite dimensions.')
  }
  return metrics
}

function annotationCenter(annotation: RouteBuilderAnnotation): NormalizedPoint {
  const rect = annotation.rect
  if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) {
    throw new Error(`Animation annotation "${annotation.id}" has no resolvable center.`)
  }
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

function resolveNode(
  node: BlueprintAnimationNode,
  annotations: Map<string, RouteBuilderAnnotation>,
): PreparedPlaybackNode {
  if (node.anchor.kind === 'virtual-point') {
    return {
      id: node.id,
      pageNumber: node.anchor.pageNumber,
      point: { x: node.anchor.x, y: node.anchor.y },
      roles: [...node.roles],
    }
  }
  const annotation = annotations.get(node.anchor.annotationId)
  if (!annotation) throw new Error(`Animation node "${node.id}" references a missing annotation.`)
  if (node.anchor.kind === 'annotation-center') {
    return {
      id: node.id,
      pageNumber: annotation.pageNumber,
      point: annotationCenter(annotation),
      roles: [...node.roles],
    }
  }
  if (!Array.isArray(annotation.points)) throw new Error(`Animation node "${node.id}" references missing circuit points.`)
  const pointIndex = resolveCircuitPointIndex(annotation.pointIds, node.anchor.pointId, node.anchor.pointIndexHint)
  const point = pointIndex == null ? undefined : annotation.points[pointIndex]
  if (!point) throw new Error(`Animation node "${node.id}" references a missing circuit point.`)
  if (annotation.shapeKind === 'circuit-path' || annotation.shapeKind === 'circuit-arc') {
    const fingerprint = createCircuitGeometryFingerprint({
      annotationId: annotation.id,
      pageNumber: annotation.pageNumber,
      shapeKind: annotation.shapeKind,
      points: annotation.points,
      arcCtrls: annotation.arcCtrls,
    })
    if (fingerprint !== node.anchor.geometryFingerprint) {
      throw new Error(`Animation node "${node.id}" references circuit geometry that has changed.`)
    }
  }
  return { id: node.id, pageNumber: annotation.pageNumber, point: { ...point }, roles: [...node.roles] }
}

/**
 * Build an aspect-correct route geometry while reusing the foundation's arc-length sampler.
 * Length is expressed as a fraction of the page's longer side and is therefore zoom/DPI neutral.
 */
export function buildPlaybackSegmentGeometry(options: {
  kind: 'straight' | 'quadratic'
  start: NormalizedPoint
  end: NormalizedPoint
  control?: NormalizedPoint
  fromT?: number
  toT?: number
  reverse?: boolean
  pageMetrics: PlaybackPageMetrics
}): PreparedPlaybackSegmentGeometry {
  const metrics = finiteMetrics(options.pageMetrics)
  const longestSide = Math.max(metrics.width, metrics.height)
  const scaleX = metrics.width / longestSide
  const scaleY = metrics.height / longestSide
  const scale = (point: NormalizedPoint): NormalizedPoint => ({ x: point.x * scaleX, y: point.y * scaleY })
  const unscale = (point: NormalizedPoint): NormalizedPoint => ({
    x: scaleX > 0 ? point.x / scaleX : 0,
    y: scaleY > 0 ? point.y / scaleY : 0,
  })
  const scaled = buildRouteSegmentGeometry({
    kind: options.kind,
    start: scale(options.start),
    end: scale(options.end),
    ...(options.control ? { control: scale(options.control) } : {}),
    fromT: options.fromT,
    toT: options.toT,
    direction: options.reverse ? 'reverse' : 'forward',
  })
  const pointAtProgress = (progress: number) => unscale(scaled.pointAtProgress(progress))
  const renderPointCount = options.kind === 'quadratic' ? 49 : 2
  return {
    kind: options.kind,
    start: unscale(scaled.pointAtProgress(0)),
    end: unscale(scaled.pointAtProgress(1)),
    ...(options.control ? { control: { ...options.control } } : {}),
    length: scaled.length,
    lookup: scaled.lookup,
    pointAtProgress,
    renderPoints: Array.from({ length: renderPointCount }, (_, index) => (
      pointAtProgress(index / (renderPointCount - 1))
    )),
  }
}

export function preparePlaybackGeometry(options: {
  scene: BlueprintScopeAnimationSceneV1
  annotations: RouteBuilderAnnotation[]
  pageMetrics: PlaybackPageMetrics
}): PreparedPlaybackGeometry {
  const { scene } = options
  const annotationById = new Map(options.annotations.map((annotation) => [annotation.id, annotation]))
  const nodeById = new Map(scene.nodes.map((node) => [node.id, resolveNode(node, annotationById)]))
  const edgeById = new Map(scene.edges.map((edge) => [edge.id, edge]))
  const globalReverse = scene.playbackOptions.direction === 'reverse'
  const orderedTraversal = globalReverse ? [...scene.manualTraversal].reverse() : [...scene.manualTraversal]
  const steps = orderedTraversal.map((traversal): PreparedPlaybackGeometryStep => {
    const edge = edgeById.get(traversal.edgeId)
    if (!edge) throw new Error(`Traversal step "${traversal.id}" references a missing edge.`)
    const reverseEdge = (traversal.direction === 'reverse') !== globalReverse
    const fromNodeId = reverseEdge ? edge.toNodeId : edge.fromNodeId
    const toNodeId = reverseEdge ? edge.fromNodeId : edge.toNodeId
    const fromNode = nodeById.get(fromNodeId)
    const toNode = nodeById.get(toNodeId)
    if (!fromNode || !toNode) throw new Error(`Animation edge "${edge.id}" references a missing node.`)
    if (fromNode.pageNumber !== toNode.pageNumber) {
      throw new Error(`Animation edge "${edge.id}" crosses pages and cannot be rendered as one page overlay.`)
    }
    if (edge.geometry.kind === 'direct') {
      return {
        id: traversal.id,
        edgeId: edge.id,
        channel: edge.channel,
        pageNumber: fromNode.pageNumber,
        fromNodeId,
        toNodeId,
        kind: 'direct',
        start: fromNode.point,
        end: toNode.point,
      }
    }
    const annotation = annotationById.get(edge.geometry.annotationId)
    if (!annotation || !Array.isArray(annotation.points)
      || (annotation.shapeKind !== 'circuit-path' && annotation.shapeKind !== 'circuit-arc')) {
      throw new Error(`Animation edge "${edge.id}" references missing circuit geometry.`)
    }
    const resolution = resolveCircuitSegmentIndex({
      annotationId: annotation.id,
      pageNumber: annotation.pageNumber,
      shapeKind: annotation.shapeKind,
      points: annotation.points,
      arcCtrls: annotation.arcCtrls,
      segmentIds: annotation.segmentIds,
    }, edge.geometry.segmentId, edge.geometry.segmentIndexHint, edge.geometry.geometryFingerprint)
    if (resolution.status !== 'resolved' || !resolution.fingerprintMatches) {
      throw new Error(`Animation edge "${edge.id}" references circuit geometry that is missing or has changed.`)
    }
    const start = annotation.points[resolution.index]
    const end = annotation.points[resolution.index + 1]
    if (!start || !end) throw new Error(`Animation edge "${edge.id}" references an incomplete circuit segment.`)
    const rawControl = annotation.arcCtrls?.[resolution.index]
    const control = annotation.shapeKind === 'circuit-arc'
      ? (rawControl ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 })
      : undefined
    const geometry = buildPlaybackSegmentGeometry({
      kind: annotation.shapeKind === 'circuit-arc' ? 'quadratic' : 'straight',
      start,
      end,
      control,
      fromT: edge.geometry.fromT,
      toT: edge.geometry.toT,
      reverse: reverseEdge,
      pageMetrics: options.pageMetrics,
    })
    return {
      id: traversal.id,
      edgeId: edge.id,
      channel: edge.channel,
      pageNumber: annotation.pageNumber,
      fromNodeId,
      toNodeId,
      kind: 'circuit-segment',
      start: geometry.start,
      end: geometry.end,
      geometry,
    }
  })
  const sourceNodeId = globalReverse
    ? steps[0]?.fromNodeId ?? scene.sources[0]?.nodeId
    : scene.sources[0]?.nodeId
  if (!sourceNodeId || !nodeById.has(sourceNodeId)) throw new Error('Animation scene has no resolvable source node.')
  return { sourceNodeId, nodes: [...nodeById.values()], steps }
}
