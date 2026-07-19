import type { BlueprintAnimationDirection } from './types'

export interface NormalizedPoint {
  x: number
  y: number
}

function clampNormalizedCoordinate(value: unknown): number {
  const number = Number(value)
  return Math.max(0, Math.min(1, Number.isFinite(number) ? number : 0))
}

/** Translate absolute page-normalized geometry together when cloning an annotation. */
export function translateNormalizedPoints(
  points: NormalizedPoint[],
  dx: number,
  dy: number,
): NormalizedPoint[] {
  const safeDx = Number.isFinite(dx) ? dx : 0
  const safeDy = Number.isFinite(dy) ? dy : 0
  return (Array.isArray(points) ? points : []).map((point) => ({
    x: clampNormalizedCoordinate((Number.isFinite(point?.x) ? point.x : 0) + safeDx),
    y: clampNormalizedCoordinate((Number.isFinite(point?.y) ? point.y : 0) + safeDy),
  }))
}

export type CircuitShapeKind = 'circuit-path' | 'circuit-arc'

export interface CircuitTopologyMetadata {
  points: NormalizedPoint[]
  pointIds?: unknown
  segmentIds?: unknown
}

export interface CircuitTopologyIds {
  pointIds: string[]
  segmentIds: string[]
  changed: boolean
}

export type CircuitTopologyIdFactory = (kind: 'point' | 'segment') => string

function defaultTopologyIdFactory(kind: 'point' | 'segment'): string {
  const prefix = kind === 'point' ? 'cpt' : 'cseg'
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function cleanUniqueIds(raw: unknown, count: number, kind: 'point' | 'segment', idFactory: CircuitTopologyIdFactory): string[] {
  const values = Array.isArray(raw) ? raw : []
  const used = new Set<string>()
  return Array.from({ length: count }, (_, index) => {
    const candidate = typeof values[index] === 'string' ? values[index].trim() : ''
    if (candidate && !used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
    let next = idFactory(kind)
    while (!next || used.has(next)) next = idFactory(kind)
    used.add(next)
    return next
  })
}

export function ensureCircuitTopologyIds(
  metadata: CircuitTopologyMetadata,
  idFactory: CircuitTopologyIdFactory = defaultTopologyIdFactory,
): CircuitTopologyIds {
  const pointCount = Array.isArray(metadata.points) ? metadata.points.length : 0
  const segmentCount = Math.max(0, pointCount - 1)
  const pointIds = cleanUniqueIds(metadata.pointIds, pointCount, 'point', idFactory)
  const segmentIds = cleanUniqueIds(metadata.segmentIds, segmentCount, 'segment', idFactory)
  const previousPointIds = Array.isArray(metadata.pointIds) ? metadata.pointIds : []
  const previousSegmentIds = Array.isArray(metadata.segmentIds) ? metadata.segmentIds : []
  const changed = previousPointIds.length !== pointIds.length
    || previousSegmentIds.length !== segmentIds.length
    || pointIds.some((id, index) => id !== previousPointIds[index])
    || segmentIds.some((id, index) => id !== previousSegmentIds[index])
  return { pointIds, segmentIds, changed }
}

export function regenerateCircuitTopologyIds(
  points: NormalizedPoint[],
  idFactory: CircuitTopologyIdFactory = defaultTopologyIdFactory,
): CircuitTopologyIds {
  return ensureCircuitTopologyIds({ points }, idFactory)
}

export interface CircuitGeometryFingerprintInput {
  annotationId: string
  pageNumber: number
  shapeKind: CircuitShapeKind
  points: NormalizedPoint[]
  arcCtrls?: NormalizedPoint[]
}

function canonicalNumber(value: number): number | null {
  return Number.isFinite(value) ? Number(value.toFixed(9)) : null
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function createCircuitGeometryFingerprint(input: CircuitGeometryFingerprintInput): string {
  const payload = {
    annotationId: String(input.annotationId),
    pageNumber: Math.max(1, Math.floor(Number(input.pageNumber) || 1)),
    shapeKind: input.shapeKind,
    points: (Array.isArray(input.points) ? input.points : []).map((point) => [canonicalNumber(point.x), canonicalNumber(point.y)]),
    arcCtrls: input.shapeKind === 'circuit-arc'
      ? (Array.isArray(input.arcCtrls) ? input.arcCtrls : []).map((point) => [canonicalNumber(point.x), canonicalNumber(point.y)])
      : undefined,
  }
  return `cgeom_v1_${fnv1a(JSON.stringify(payload))}`
}

export function isCircuitGeometryFingerprintCurrent(
  expected: string,
  input: CircuitGeometryFingerprintInput,
): boolean {
  return expected === createCircuitGeometryFingerprint(input)
}

export interface CircuitSegmentResolutionInput extends CircuitGeometryFingerprintInput {
  segmentIds?: unknown
}

export type CircuitSegmentResolution =
  | { status: 'resolved'; index: number; via: 'stable-id' | 'legacy-index-hint'; fingerprintMatches: boolean }
  | { status: 'missing'; fingerprintMatches: boolean }

export function resolveCircuitSegmentIndex(
  annotation: CircuitSegmentResolutionInput,
  segmentId: string,
  segmentIndexHint?: number,
  expectedFingerprint?: string,
): CircuitSegmentResolution {
  const fingerprintMatches = expectedFingerprint == null
    || isCircuitGeometryFingerprintCurrent(expectedFingerprint, annotation)
  const ids = Array.isArray(annotation.segmentIds)
    ? annotation.segmentIds.filter((id): id is string => typeof id === 'string')
    : []
  if (ids.length > 0) {
    const index = ids.indexOf(segmentId)
    return index >= 0
      ? { status: 'resolved', index, via: 'stable-id', fingerprintMatches }
      : { status: 'missing', fingerprintMatches }
  }
  const segmentCount = Math.max(0, annotation.points.length - 1)
  if (Number.isInteger(segmentIndexHint) && Number(segmentIndexHint) >= 0 && Number(segmentIndexHint) < segmentCount) {
    return { status: 'resolved', index: Number(segmentIndexHint), via: 'legacy-index-hint', fingerprintMatches }
  }
  return { status: 'missing', fingerprintMatches }
}

export function resolveCircuitPointIndex(pointIds: unknown, pointId: string, pointIndexHint?: number): number | null {
  const ids = Array.isArray(pointIds) ? pointIds.filter((id): id is string => typeof id === 'string') : []
  if (ids.length > 0) {
    const index = ids.indexOf(pointId)
    return index >= 0 ? index : null
  }
  return Number.isInteger(pointIndexHint) && Number(pointIndexHint) >= 0 ? Number(pointIndexHint) : null
}

export function interpolateStraight(start: NormalizedPoint, end: NormalizedPoint, t: number): NormalizedPoint {
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
}

export function pointOnQuadraticBezier(
  start: NormalizedPoint,
  control: NormalizedPoint,
  end: NormalizedPoint,
  t: number,
): NormalizedPoint {
  const oneMinusT = 1 - t
  return {
    x: oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * control.x + t * t * end.x,
    y: oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * control.y + t * t * end.y,
  }
}

export interface ArcLengthLookupEntry {
  t: number
  length: number
}

export interface RouteSegmentGeometry {
  length: number
  lookup: ArcLengthLookupEntry[]
  pointAtProgress(progress: number): NormalizedPoint
}

export interface RouteSegmentGeometryOptions {
  kind: 'straight' | 'quadratic'
  start: NormalizedPoint
  end: NormalizedPoint
  control?: NormalizedPoint
  fromT?: number
  toT?: number
  direction?: BlueprintAnimationDirection
  samples?: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

function distance(a: NormalizedPoint, b: NormalizedPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function assertFinitePoint(name: string, point: NormalizedPoint): void {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw new RangeError(`${name} must contain finite normalized x/y coordinates.`)
  }
}

export function buildRouteSegmentGeometry(options: RouteSegmentGeometryOptions): RouteSegmentGeometry {
  assertFinitePoint('Route start', options.start)
  assertFinitePoint('Route end', options.end)
  const fromT = clamp01(options.fromT ?? 0)
  const toT = clamp01(options.toT ?? 1)
  const effectiveStartT = options.direction === 'reverse' ? toT : fromT
  const effectiveEndT = options.direction === 'reverse' ? fromT : toT
  const control = options.control ?? interpolateStraight(options.start, options.end, 0.5)
  if (options.kind === 'quadratic') assertFinitePoint('Route control', control)
  const atT = (t: number) => options.kind === 'quadratic'
    ? pointOnQuadraticBezier(options.start, control, options.end, t)
    : interpolateStraight(options.start, options.end, t)
  const requestedSamples = Number(options.samples)
  const safeSamples = Number.isFinite(requestedSamples) ? Math.floor(requestedSamples) : 64
  const sampleCount = options.kind === 'quadratic'
    ? Math.min(4096, Math.max(8, safeSamples))
    : 1
  const lookup: ArcLengthLookupEntry[] = [{ t: effectiveStartT, length: 0 }]
  let previous = atT(effectiveStartT)
  let totalLength = 0
  for (let index = 1; index <= sampleCount; index += 1) {
    const progress = index / sampleCount
    const t = effectiveStartT + (effectiveEndT - effectiveStartT) * progress
    const point = atT(t)
    totalLength += distance(previous, point)
    lookup.push({ t, length: totalLength })
    previous = point
  }

  return {
    length: totalLength,
    lookup,
    pointAtProgress(progressValue: number): NormalizedPoint {
      const progress = clamp01(progressValue)
      if (progress === 0 || totalLength === 0) return atT(effectiveStartT)
      if (progress === 1) return atT(effectiveEndT)
      const targetLength = totalLength * progress
      let upperIndex = lookup.findIndex((entry) => entry.length >= targetLength)
      if (upperIndex <= 0) upperIndex = 1
      const lower = lookup[upperIndex - 1]
      const upper = lookup[upperIndex]
      const span = upper.length - lower.length
      const ratio = span > 0 ? (targetLength - lower.length) / span : 0
      return atT(lower.t + (upper.t - lower.t) * ratio)
    },
  }
}
