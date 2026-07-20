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

function isFinitePoint(point: unknown): point is NormalizedPoint {
  const value = point as NormalizedPoint
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.y)
}

function pixelPoint(point: NormalizedPoint, width: number, height: number): NormalizedPoint {
  return { x: point.x * width, y: point.y * height }
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
