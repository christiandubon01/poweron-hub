import { describe, expect, it } from 'vitest'
import {
  buildRouteSegmentGeometry,
  createCircuitGeometryFingerprint,
  ensureCircuitTopologyIds,
  pointOnQuadraticBezier,
  regenerateCircuitTopologyIds,
  resolveCircuitSegmentIndex,
  translateNormalizedPoints,
} from '../routeGeometry'

const start = { x: 0, y: 0 }
const end = { x: 1, y: 0 }
const control = { x: 0.5, y: 1 }

describe('stable circuit topology identity', () => {
  it('materializes the exact point and segment counts while preserving existing IDs', () => {
    let serial = 0
    const ids = ensureCircuitTopologyIds({
      points: [start, { x: 0.5, y: 0 }, end],
      pointIds: ['point-a'],
      segmentIds: ['segment-a'],
    }, (kind) => `${kind}-${++serial}`)

    expect(ids.pointIds).toEqual(['point-a', 'point-1', 'point-2'])
    expect(ids.segmentIds).toEqual(['segment-a', 'segment-3'])
    expect(ids.changed).toBe(true)

    const unchanged = ensureCircuitTopologyIds({
      points: [start, { x: 0.6, y: 0.1 }, end],
      pointIds: ids.pointIds,
      segmentIds: ids.segmentIds,
    })
    expect(unchanged).toEqual({ ...ids, changed: false })
  })

  it('regenerates every point and segment ID for a copied circuit', () => {
    let firstSerial = 0
    let secondSerial = 0
    const original = regenerateCircuitTopologyIds([start, end], (kind) => `original-${kind}-${++firstSerial}`)
    const copy = regenerateCircuitTopologyIds([start, end], (kind) => `copy-${kind}-${++secondSerial}`)
    expect(copy.pointIds).not.toEqual(original.pointIds)
    expect(copy.segmentIds).not.toEqual(original.segmentIds)
  })

  it('repairs duplicate and mismatched ID arrays without retaining excess IDs', () => {
    let serial = 0
    const repaired = ensureCircuitTopologyIds({
      points: [start, { x: 0.5, y: 0 }, end],
      pointIds: ['point-a', 'point-a', 'point-c', 'excess-point'],
      segmentIds: ['segment-a', 'segment-a', 'excess-segment'],
    }, (kind) => `${kind}-replacement-${++serial}`)
    expect(repaired.pointIds).toEqual(['point-a', 'point-replacement-1', 'point-c'])
    expect(repaired.segmentIds).toEqual(['segment-a', 'segment-replacement-2'])
  })

  it('translates copied circuit points and arc controls by the same delta', () => {
    const points = [{ x: 0.125, y: 0.25 }, { x: 0.5, y: 0.375 }]
    const controls = [{ x: 0.25, y: 0.125 }]
    const copiedPoints = translateNormalizedPoints(points, 0.25, 0.25)
    const copiedControls = translateNormalizedPoints(controls, 0.25, 0.25)
    expect(copiedPoints).toEqual([{ x: 0.375, y: 0.5 }, { x: 0.75, y: 0.625 }])
    expect(copiedControls).toEqual([{ x: 0.5, y: 0.375 }])
    expect(copiedControls[0].x - copiedPoints[0].x).toBeCloseTo(controls[0].x - points[0].x)
    expect(copiedControls[0].y - copiedPoints[0].y).toBeCloseTo(controls[0].y - points[0].y)
  })

  it('resolves by stable segment ID and uses the index hint only for legacy topology', () => {
    const annotation = {
      annotationId: 'ann-1', pageNumber: 1, shapeKind: 'circuit-path' as const,
      points: [start, { x: 0.5, y: 0 }, end], segmentIds: ['seg-a', 'seg-b'],
    }
    expect(resolveCircuitSegmentIndex(annotation, 'seg-b', 0)).toMatchObject({ status: 'resolved', index: 1, via: 'stable-id' })
    expect(resolveCircuitSegmentIndex(annotation, 'missing', 0)).toMatchObject({ status: 'missing' })
    expect(resolveCircuitSegmentIndex({ ...annotation, segmentIds: undefined }, 'legacy', 1)).toMatchObject({ status: 'resolved', index: 1, via: 'legacy-index-hint' })
  })
})

describe('route geometry', () => {
  it('interpolates straight endpoints and halfway point', () => {
    const geometry = buildRouteSegmentGeometry({ kind: 'straight', start, end })
    expect(geometry.pointAtProgress(0)).toEqual(start)
    expect(geometry.pointAtProgress(0.5)).toEqual({ x: 0.5, y: 0 })
    expect(geometry.pointAtProgress(1)).toEqual(end)
    expect(geometry.length).toBeCloseTo(1, 8)
  })

  it('supports straight partial and reverse traversal', () => {
    const partial = buildRouteSegmentGeometry({ kind: 'straight', start, end, fromT: 0.25, toT: 0.75 })
    expect(partial.pointAtProgress(0)).toEqual({ x: 0.25, y: 0 })
    expect(partial.pointAtProgress(1)).toEqual({ x: 0.75, y: 0 })
    const reverse = buildRouteSegmentGeometry({ kind: 'straight', start, end, fromT: 0.25, toT: 0.75, direction: 'reverse' })
    expect(reverse.pointAtProgress(0)).toEqual({ x: 0.75, y: 0 })
    expect(reverse.pointAtProgress(1)).toEqual({ x: 0.25, y: 0 })
  })

  it('uses the existing quadratic Bezier convention at endpoints and midpoint', () => {
    expect(pointOnQuadraticBezier(start, control, end, 0)).toEqual(start)
    expect(pointOnQuadraticBezier(start, control, end, 0.5)).toEqual({ x: 0.5, y: 0.5 })
    expect(pointOnQuadraticBezier(start, control, end, 1)).toEqual(end)
  })

  it('supports quadratic partial and reverse traversal with deterministic arc-length lookup', () => {
    const partial = buildRouteSegmentGeometry({ kind: 'quadratic', start, control, end, fromT: 0.25, toT: 0.75, samples: 64 })
    expect(partial.pointAtProgress(0)).toEqual(pointOnQuadraticBezier(start, control, end, 0.25))
    expect(partial.pointAtProgress(0.5)).toMatchObject({ x: 0.5 })
    expect(partial.pointAtProgress(1)).toEqual(pointOnQuadraticBezier(start, control, end, 0.75))
    expect(partial.lookup).toHaveLength(65)

    const reverse = buildRouteSegmentGeometry({ kind: 'quadratic', start, control, end, fromT: 0.25, toT: 0.75, direction: 'reverse', samples: 64 })
    expect(reverse.pointAtProgress(0)).toEqual(pointOnQuadraticBezier(start, control, end, 0.75))
    expect(reverse.pointAtProgress(1)).toEqual(pointOnQuadraticBezier(start, control, end, 0.25))
    expect(reverse.length).toBeCloseTo(partial.length, 10)
  })

  it('handles zero-length ranges, coincident arc endpoints, and controls at an endpoint', () => {
    const zeroStraight = buildRouteSegmentGeometry({ kind: 'straight', start, end: start })
    expect(zeroStraight.length).toBe(0)
    expect(zeroStraight.pointAtProgress(0.5)).toEqual(start)

    const noRange = buildRouteSegmentGeometry({ kind: 'quadratic', start, control, end, fromT: 0.4, toT: 0.4 })
    expect(noRange.length).toBe(0)
    expect(noRange.pointAtProgress(0.5)).toEqual(pointOnQuadraticBezier(start, control, end, 0.4))

    const loop = buildRouteSegmentGeometry({ kind: 'quadratic', start, control, end: start })
    expect(loop.length).toBeGreaterThan(0)
    expect(loop.pointAtProgress(0)).toEqual(start)
    expect(loop.pointAtProgress(1)).toEqual(start)

    const endpointControl = buildRouteSegmentGeometry({ kind: 'quadratic', start, control: end, end })
    expect(endpointControl.pointAtProgress(0)).toEqual(start)
    expect(endpointControl.pointAtProgress(1)).toEqual(end)
  })

  it('treats fromT greater than toT as a deterministic backwards sub-range', () => {
    const geometry = buildRouteSegmentGeometry({ kind: 'straight', start, end, fromT: 0.8, toT: 0.2 })
    expect(geometry.pointAtProgress(0)).toEqual({ x: 0.8, y: 0 })
    expect(geometry.pointAtProgress(1)).toEqual({ x: 0.2, y: 0 })
    expect(geometry.length).toBeCloseTo(0.6, 8)
  })

  it('rejects non-finite geometry and bounds invalid sample counts without producing NaN points', () => {
    expect(() => buildRouteSegmentGeometry({ kind: 'straight', start: { x: Number.NaN, y: 0 }, end })).toThrow(RangeError)
    expect(() => buildRouteSegmentGeometry({ kind: 'straight', start, end: { x: Number.POSITIVE_INFINITY, y: 0 } })).toThrow(RangeError)
    expect(() => buildRouteSegmentGeometry({ kind: 'quadratic', start, control: { x: 0.5, y: Number.NEGATIVE_INFINITY }, end })).toThrow(RangeError)
    expect(() => buildRouteSegmentGeometry({ kind: 'straight', start, end: { x: Number.MAX_VALUE, y: 0 } })).toThrow(RangeError)

    const geometry = buildRouteSegmentGeometry({ kind: 'quadratic', start, control, end, samples: Number.POSITIVE_INFINITY })
    expect(geometry.lookup).toHaveLength(65)
    expect(Object.values(geometry.pointAtProgress(Number.NaN)).every(Number.isFinite)).toBe(true)
  })

  it('fingerprints geometry but not visual styling and detects stale coordinates', () => {
    const geometry = { annotationId: 'ann-1', pageNumber: 2, shapeKind: 'circuit-arc' as const, points: [start, end], arcCtrls: [control] }
    const fingerprint = createCircuitGeometryFingerprint(geometry)
    expect(createCircuitGeometryFingerprint({ ...geometry })).toBe(fingerprint)
    expect(createCircuitGeometryFingerprint({ ...geometry, points: [start, { x: 0.9, y: 0 }] })).not.toBe(fingerprint)
    expect(resolveCircuitSegmentIndex({ ...geometry, segmentIds: ['seg-1'] }, 'seg-1', 0, fingerprint)).toMatchObject({ fingerprintMatches: true })
    expect(resolveCircuitSegmentIndex({ ...geometry, points: [start, { x: 0.9, y: 0 }], segmentIds: ['seg-1'] }, 'seg-1', 0, fingerprint)).toMatchObject({ fingerprintMatches: false })
  })
})
