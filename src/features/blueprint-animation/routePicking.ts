import {
  createCircuitGeometryFingerprint,
  pointOnQuadraticBezier,
  type CircuitShapeKind,
  type NormalizedPoint,
} from './routeGeometry'

export interface RoutePickCircuitAnnotation {
  id: string
  pageNumber: number
  shapeKind?: string
  points?: NormalizedPoint[]
  arcCtrls?: NormalizedPoint[]
  pointIds?: string[]
  segmentIds?: string[]
}

export interface RoutePickDeviceAnnotation {
  id: string
  pageNumber: number
  rect?: { x: number; y: number; w: number; h: number }
  hitRect?: { x: number; y: number; w: number; h: number }
}

export interface RouteSegmentPick {
  annotationId: string
  pageNumber: number
  shapeKind: CircuitShapeKind
  segmentId: string
  segmentIndexHint: number
  geometryFingerprint: string
  startPointId: string
  endPointId: string
  startPointIndexHint: number
  endPointIndexHint: number
  start: NormalizedPoint
  end: NormalizedPoint
  control?: NormalizedPoint
  distancePx: number
}

export interface RoutePointPick {
  annotationId: string
  pageNumber: number
  shapeKind: CircuitShapeKind
  pointId: string
  pointIndexHint: number
  geometryFingerprint: string
  point: NormalizedPoint
  distancePx: number
}

export interface RoutePickOptions {
  pageWidth: number
  pageHeight: number
  tolerancePx: number
  quadraticSamples?: number
}

export interface RouteNodePickCandidate {
  nodeId: string
  pageNumber: number
  point: NormalizedPoint
}

export interface RouteNodePick extends RouteNodePickCandidate {
  distancePx: number
}

export interface RouteDevicePick {
  annotationId: string
  pageNumber: number
  distancePx: number
}

export type RoutePickIntent =
  | { kind: 'annotation'; annotationId: string }
  | { kind: 'segment'; hit: RouteSegmentPick }

export interface RoutePickIntentOptions {
  sourceSelected: boolean
  overlappingAnnotationIds: string[]
  eligibleDeviceIds: ReadonlySet<string>
  diagnosticSourceIds?: ReadonlySet<string>
  eligibleDeviceHitId?: string
  currentEndpointAnnotationId?: string
  segmentHit: RouteSegmentPick | null
  fallbackAnnotationId?: string
}

/**
 * Resolves one route-builder pointer gesture after DOM and geometry hit-testing. An eligible
 * device actually under the pointer is more specific than a nearby circuit segment. DOM order is
 * deliberately ignored for that geometry choice; overlapping annotations remain fallback context
 * for precise source-selection notices and non-device route notices.
 */
export function resolveRoutePickIntent(options: RoutePickIntentOptions): RoutePickIntent | null {
  const overlappingIds = Array.from(new Set(
    options.overlappingAnnotationIds.filter((id) => typeof id === 'string' && id.trim()),
  ))
  const fallbackId = overlappingIds[0] || options.fallbackAnnotationId

  if (!options.sourceSelected) {
    if (options.eligibleDeviceHitId && options.eligibleDeviceIds.has(options.eligibleDeviceHitId)) {
      return { kind: 'annotation', annotationId: options.eligibleDeviceHitId }
    }
    const sourceId = overlappingIds.find((id) => options.eligibleDeviceIds.has(id))
    if (sourceId) return { kind: 'annotation', annotationId: sourceId }
    if (options.fallbackAnnotationId && options.eligibleDeviceIds.has(options.fallbackAnnotationId)) {
      return { kind: 'annotation', annotationId: options.fallbackAnnotationId }
    }
    const diagnosticSourceId = overlappingIds.find((id) => options.diagnosticSourceIds?.has(id))
    if (diagnosticSourceId) return { kind: 'annotation', annotationId: diagnosticSourceId }
    if (options.fallbackAnnotationId && options.diagnosticSourceIds?.has(options.fallbackAnnotationId)) {
      return { kind: 'annotation', annotationId: options.fallbackAnnotationId }
    }
    return fallbackId ? { kind: 'annotation', annotationId: fallbackId } : null
  }

  if (
    options.eligibleDeviceHitId
    && options.eligibleDeviceHitId !== options.currentEndpointAnnotationId
    && options.eligibleDeviceIds.has(options.eligibleDeviceHitId)
  ) {
    return { kind: 'annotation', annotationId: options.eligibleDeviceHitId }
  }
  const deviceId = overlappingIds.find((id) => id !== options.currentEndpointAnnotationId && options.eligibleDeviceIds.has(id))
  if (deviceId) return { kind: 'annotation', annotationId: deviceId }
  if (options.segmentHit) return { kind: 'segment', hit: options.segmentHit }
  return fallbackId && fallbackId !== options.currentEndpointAnnotationId
    ? { kind: 'annotation', annotationId: fallbackId }
    : null
}

function isFinitePoint(point: unknown): point is NormalizedPoint {
  const value = point as NormalizedPoint
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.y)
}

function pixelPoint(point: NormalizedPoint, width: number, height: number): NormalizedPoint {
  return { x: point.x * width, y: point.y * height }
}

function validRect(rect: RoutePickDeviceAnnotation['rect']): NonNullable<RoutePickDeviceAnnotation['rect']> | null {
  if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return null
  if (rect.w <= 0 || rect.h <= 0) return null
  return rect
}

function distanceToRectPx(
  pointer: NormalizedPoint,
  rect: NonNullable<RoutePickDeviceAnnotation['rect']>,
  pageWidth: number,
  pageHeight: number,
): number {
  const x = pointer.x * pageWidth
  const y = pointer.y * pageHeight
  const left = rect.x * pageWidth
  const top = rect.y * pageHeight
  const right = (rect.x + rect.w) * pageWidth
  const bottom = (rect.y + rect.h) * pageHeight
  const dx = x < left ? left - x : x > right ? x - right : 0
  const dy = y < top ? top - y : y > bottom ? y - bottom : 0
  return Math.hypot(dx, dy)
}

/**
 * Finds an eligible package device under the pointer using page geometry, independent of DOM/SVG
 * layering. The visible annotation body wins with only a small rendered-pixel tolerance.
 * Candidate order is preserved so overlapping devices follow the same deterministic annotation
 * ordering supplied by the caller rather than display text.
 */
export function findFirstRouteDeviceHit(
  pointer: NormalizedPoint,
  annotations: RoutePickDeviceAnnotation[],
  options: Pick<RoutePickOptions, 'pageWidth' | 'pageHeight'> & { tolerancePx: number; excludedAnnotationIds?: ReadonlySet<string> },
): RouteDevicePick | null {
  const width = Math.max(1, Number(options.pageWidth) || 1)
  const height = Math.max(1, Number(options.pageHeight) || 1)
  const tolerance = Math.max(0, Number(options.tolerancePx) || 0)
  let best: (RouteDevicePick & { centerDistancePx: number }) | null = null
  for (const annotation of annotations) {
    if (options.excludedAnnotationIds?.has(annotation.id)) continue
    const rect = validRect(annotation.hitRect) ?? validRect(annotation.rect)
    if (!rect) continue
    const rectDistancePx = distanceToRectPx(pointer, rect, width, height)
    if (rectDistancePx <= tolerance) {
      const centerDistancePx = Math.hypot(
        (pointer.x - (rect.x + rect.w / 2)) * width,
        (pointer.y - (rect.y + rect.h / 2)) * height,
      )
      if (
        !best
        || centerDistancePx < best.centerDistancePx
        || (centerDistancePx === best.centerDistancePx && annotation.id < best.annotationId)
      ) {
        best = { annotationId: annotation.id, pageNumber: annotation.pageNumber, distancePx: rectDistancePx, centerDistancePx }
      }
    }
  }
  if (!best) return null
  const { centerDistancePx: _centerDistancePx, ...hit } = best
  return hit
}

export function distanceToLineSegmentPx(
  pointer: NormalizedPoint,
  start: NormalizedPoint,
  end: NormalizedPoint,
  pageWidth: number,
  pageHeight: number,
): number {
  const p = pixelPoint(pointer, pageWidth, pageHeight)
  const a = pixelPoint(start, pageWidth, pageHeight)
  const b = pixelPoint(end, pageWidth, pageHeight)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const denominator = dx * dx + dy * dy
  const t = denominator > 0
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator))
    : 0
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

export function distanceToQuadraticSegmentPx(
  pointer: NormalizedPoint,
  start: NormalizedPoint,
  control: NormalizedPoint,
  end: NormalizedPoint,
  pageWidth: number,
  pageHeight: number,
  requestedSamples = 48,
): number {
  const samples = Math.min(256, Math.max(12, Math.floor(Number(requestedSamples) || 48)))
  let best = Number.POSITIVE_INFINITY
  let previous = start
  for (let index = 1; index <= samples; index += 1) {
    const next = pointOnQuadraticBezier(start, control, end, index / samples)
    best = Math.min(best, distanceToLineSegmentPx(pointer, previous, next, pageWidth, pageHeight))
    previous = next
  }
  return best
}

function circuitKind(value: unknown): CircuitShapeKind | null {
  return value === 'circuit-path' || value === 'circuit-arc' ? value : null
}

function validTopology(annotation: RoutePickCircuitAnnotation): {
  points: NormalizedPoint[]
  pointIds: string[]
  segmentIds: string[]
} | null {
  const points = Array.isArray(annotation.points) ? annotation.points.filter(isFinitePoint) : []
  const pointIds = Array.isArray(annotation.pointIds) ? annotation.pointIds : []
  const segmentIds = Array.isArray(annotation.segmentIds) ? annotation.segmentIds : []
  if (points.length < 2 || pointIds.length !== points.length || segmentIds.length !== points.length - 1) return null
  if (pointIds.some((id) => typeof id !== 'string' || !id.trim())) return null
  if (segmentIds.some((id) => typeof id !== 'string' || !id.trim())) return null
  return { points, pointIds, segmentIds }
}

/**
 * Finds the nearest individual package circuit segment in page-normalized space while measuring
 * in rendered pixels. Stable IDs are mandatory: a legacy annotation without persisted topology
 * is skipped rather than creating a reference that would change after reload.
 */
export function findNearestRouteSegment(
  pointer: NormalizedPoint,
  annotations: RoutePickCircuitAnnotation[],
  options: RoutePickOptions,
): RouteSegmentPick | null {
  const width = Math.max(1, Number(options.pageWidth) || 1)
  const height = Math.max(1, Number(options.pageHeight) || 1)
  const tolerance = Math.max(1, Number(options.tolerancePx) || 1)
  let best: RouteSegmentPick | null = null

  for (const annotation of annotations) {
    const shapeKind = circuitKind(annotation.shapeKind)
    const topology = validTopology(annotation)
    if (!shapeKind || !topology) continue
    const geometryFingerprint = createCircuitGeometryFingerprint({
      annotationId: annotation.id,
      pageNumber: annotation.pageNumber,
      shapeKind,
      points: topology.points,
      arcCtrls: annotation.arcCtrls,
    })
    for (let index = 0; index < topology.points.length - 1; index += 1) {
      const start = topology.points[index]
      const end = topology.points[index + 1]
      const fallbackControl = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      const candidateControl = annotation.arcCtrls?.[index]
      const control = isFinitePoint(candidateControl) ? candidateControl : fallbackControl
      const distancePx = shapeKind === 'circuit-arc'
        ? distanceToQuadraticSegmentPx(pointer, start, control, end, width, height, options.quadraticSamples)
        : distanceToLineSegmentPx(pointer, start, end, width, height)
      if (distancePx > tolerance || (best && distancePx >= best.distancePx)) continue
      best = {
        annotationId: annotation.id,
        pageNumber: annotation.pageNumber,
        shapeKind,
        segmentId: topology.segmentIds[index],
        segmentIndexHint: index,
        geometryFingerprint,
        startPointId: topology.pointIds[index],
        endPointId: topology.pointIds[index + 1],
        startPointIndexHint: index,
        endPointIndexHint: index + 1,
        start: { ...start },
        end: { ...end },
        ...(shapeKind === 'circuit-arc' ? { control: { ...control } } : {}),
        distancePx,
      }
    }
  }
  return best
}

export function findNearestRoutePoint(
  pointer: NormalizedPoint,
  annotations: RoutePickCircuitAnnotation[],
  options: Pick<RoutePickOptions, 'pageWidth' | 'pageHeight' | 'tolerancePx'>,
): RoutePointPick | null {
  const width = Math.max(1, Number(options.pageWidth) || 1)
  const height = Math.max(1, Number(options.pageHeight) || 1)
  const tolerance = Math.max(1, Number(options.tolerancePx) || 1)
  let best: RoutePointPick | null = null
  for (const annotation of annotations) {
    const shapeKind = circuitKind(annotation.shapeKind)
    const topology = validTopology(annotation)
    if (!shapeKind || !topology) continue
    const geometryFingerprint = createCircuitGeometryFingerprint({
      annotationId: annotation.id,
      pageNumber: annotation.pageNumber,
      shapeKind,
      points: topology.points,
      arcCtrls: annotation.arcCtrls,
    })
    topology.points.forEach((point, index) => {
      const distancePx = Math.hypot((pointer.x - point.x) * width, (pointer.y - point.y) * height)
      if (distancePx > tolerance || (best && distancePx >= best.distancePx)) return
      best = {
        annotationId: annotation.id,
        pageNumber: annotation.pageNumber,
        shapeKind,
        pointId: topology.pointIds[index],
        pointIndexHint: index,
        geometryFingerprint,
        point: { ...point },
        distancePx,
      }
    })
  }
  return best
}

/** Resolves a visible primary-route badge/node in rendered pixels before nearby segment picking. */
export function findNearestRouteNode(
  pointer: NormalizedPoint,
  candidates: RouteNodePickCandidate[],
  options: Pick<RoutePickOptions, 'pageWidth' | 'pageHeight' | 'tolerancePx'>,
): RouteNodePick | null {
  const width = Math.max(1, Number(options.pageWidth) || 1)
  const height = Math.max(1, Number(options.pageHeight) || 1)
  const tolerance = Math.max(1, Number(options.tolerancePx) || 1)
  let best: RouteNodePick | null = null
  candidates.forEach((candidate) => {
    const distancePx = Math.hypot((pointer.x - candidate.point.x) * width, (pointer.y - candidate.point.y) * height)
    if (distancePx > tolerance || (best && distancePx >= best.distancePx)) return
    best = { ...candidate, point: { ...candidate.point }, distancePx }
  })
  return best
}
