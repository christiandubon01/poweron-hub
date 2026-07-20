import { describe, expect, it } from 'vitest'
import { createCircuitGeometryFingerprint } from '../routeGeometry'
import { findNearestRoutePoint, findNearestRouteSegment } from '../routePicking'

describe('routePicking', () => {
  it('selects the nearest individual straight segment with stable IDs', () => {
    const annotation = {
      id: 'circuit-1',
      pageNumber: 1,
      shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 }],
      pointIds: ['p1', 'p2', 'p3'],
      segmentIds: ['s1', 's2'],
    }
    const hit = findNearestRouteSegment({ x: 0.51, y: 0.65 }, [annotation], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 20 })
    expect(hit).toMatchObject({ annotationId: 'circuit-1', segmentId: 's2', segmentIndexHint: 1, startPointId: 'p2', endPointId: 'p3' })
    expect(hit?.geometryFingerprint).toBe(createCircuitGeometryFingerprint({ annotationId: annotation.id, pageNumber: 1, shapeKind: 'circuit-path', points: annotation.points }))
  })

  it('selects a sampled quadratic segment instead of its straight chord', () => {
    const annotation = {
      id: 'arc-1',
      pageNumber: 1,
      shapeKind: 'circuit-arc',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
      arcCtrls: [{ x: 0.5, y: 0.1 }],
      pointIds: ['p1', 'p2'],
      segmentIds: ['curve-1'],
    }
    expect(findNearestRouteSegment({ x: 0.5, y: 0.3 }, [annotation], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 18 }))
      .toMatchObject({ segmentId: 'curve-1', shapeKind: 'circuit-arc', control: { x: 0.5, y: 0.1 } })
    expect(findNearestRouteSegment({ x: 0.5, y: 0.5 }, [annotation], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 18 })).toBeNull()
  })

  it('is aspect-aware and honors the rendered-pixel tolerance', () => {
    const annotation = {
      id: 'wide', pageNumber: 1, shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], pointIds: ['a', 'b'], segmentIds: ['ab'],
    }
    expect(findNearestRouteSegment({ x: 0.5, y: 0.52 }, [annotation], { pageWidth: 1600, pageHeight: 500, tolerancePx: 11 })?.segmentId).toBe('ab')
    expect(findNearestRouteSegment({ x: 0.5, y: 0.52 }, [annotation], { pageWidth: 1600, pageHeight: 1000, tolerancePx: 11 })).toBeNull()
  })

  it('refuses legacy geometry without persisted stable topology IDs', () => {
    const annotation = { id: 'legacy', pageNumber: 1, shapeKind: 'circuit-path', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }
    expect(findNearestRouteSegment({ x: 0.5, y: 0 }, [annotation], { pageWidth: 100, pageHeight: 100, tolerancePx: 20 })).toBeNull()
  })

  it('finds the nearest stable circuit point independently of segment picking', () => {
    const annotation = {
      id: 'circuit-1', pageNumber: 1, shapeKind: 'circuit-path',
      points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }], pointIds: ['a', 'b'], segmentIds: ['ab'],
    }
    expect(findNearestRoutePoint({ x: 0.79, y: 0.8 }, [annotation], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 15 }))
      .toMatchObject({ pointId: 'b', pointIndexHint: 1 })
  })
})
