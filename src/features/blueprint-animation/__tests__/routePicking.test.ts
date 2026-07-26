import { describe, expect, it } from 'vitest'
import { createCircuitGeometryFingerprint } from '../routeGeometry'
import { findFirstRouteDeviceHit, findNearestRoutePoint, findNearestRouteSegment, resolveRoutePickIntent, type RouteSegmentPick } from '../routePicking'

const segmentHit: RouteSegmentPick = {
  annotationId: 'circuit-1',
  pageNumber: 1,
  shapeKind: 'circuit-path',
  segmentId: 'segment-1',
  segmentIndexHint: 0,
  geometryFingerprint: 'fingerprint',
  startPointId: 'point-1',
  endPointId: 'point-2',
  startPointIndexHint: 0,
  endPointIndexHint: 1,
  start: { x: 0.1, y: 0.1 },
  end: { x: 0.2, y: 0.2 },
  distancePx: 2,
}

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

  it('prefers an overlapping eligible fixture over a circuit-segment hit after source selection', () => {
    expect(resolveRoutePickIntent({
      sourceSelected: true,
      overlappingAnnotationIds: ['fixture-1', 'circuit-1'],
      eligibleDeviceIds: new Set(['fixture-1']),
      segmentHit,
    })).toEqual({ kind: 'annotation', annotationId: 'fixture-1' })
  })

  it('falls back to the nearest segment when only a circuit annotation overlaps', () => {
    expect(resolveRoutePickIntent({
      sourceSelected: true,
      overlappingAnnotationIds: ['circuit-1'],
      eligibleDeviceIds: new Set(['fixture-1']),
      segmentHit,
    })).toEqual({ kind: 'segment', hit: segmentHit })
  })

  it('keeps the direct-device intent when a fixture is outside segment tolerance', () => {
    expect(resolveRoutePickIntent({
      sourceSelected: true,
      overlappingAnnotationIds: ['fixture-1'],
      eligibleDeviceIds: new Set(['fixture-1']),
      segmentHit: null,
    })).toEqual({ kind: 'annotation', annotationId: 'fixture-1' })
  })

  it('prefers the fixture regardless of overlapping DOM order', () => {
    const resolve = (overlappingAnnotationIds: string[]) => resolveRoutePickIntent({
      sourceSelected: true,
      overlappingAnnotationIds,
      eligibleDeviceIds: new Set(['fixture-1']),
      segmentHit,
    })
    expect(resolve(['fixture-1', 'circuit-1'])).toEqual({ kind: 'annotation', annotationId: 'fixture-1' })
    expect(resolve(['circuit-1', 'fixture-1'])).toEqual({ kind: 'annotation', annotationId: 'fixture-1' })
  })

  it('keeps device precedence when touch tolerance produces a segment hit', () => {
    const touchToleranceHit = { ...segmentHit, distancePx: 27 }
    expect(resolveRoutePickIntent({
      sourceSelected: true,
      overlappingAnnotationIds: ['circuit-1', 'fixture-1'],
      eligibleDeviceIds: new Set(['fixture-1']),
      segmentHit: touchToleranceHit,
    })).toEqual({ kind: 'annotation', annotationId: 'fixture-1' })
  })

  it('finds a package device by geometry when its body overlaps a route segment', () => {
    const receptacle = { id: 'receptacle-1', pageNumber: 1, rect: { x: 0.68, y: 0.46, w: 0.04, h: 0.08 } }
    const deviceHit = findFirstRouteDeviceHit({ x: 0.7, y: 0.5 }, [receptacle], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 4 })

    expect(deviceHit).toMatchObject({ annotationId: 'receptacle-1', pageNumber: 1 })
    expect(resolveRoutePickIntent({
      sourceSelected: true,
      overlappingAnnotationIds: ['circuit-1'],
      eligibleDeviceIds: new Set(['receptacle-1']),
      eligibleDeviceHitId: deviceHit?.annotationId,
      segmentHit,
    })).toEqual({ kind: 'annotation', annotationId: 'receptacle-1' })
  })

  it('lets an emergency exit sign device hit beat an overlapping segment after source selection', () => {
    const exitSign = { id: 'exit-sign', pageNumber: 1, rect: { x: 0.68, y: 0.46, w: 0.08, h: 0.04 } }
    const deviceHit = findFirstRouteDeviceHit({ x: 0.7, y: 0.48 }, [exitSign], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 4 })

    expect(deviceHit).toMatchObject({ annotationId: 'exit-sign', pageNumber: 1 })
    expect(resolveRoutePickIntent({
      sourceSelected: true,
      overlappingAnnotationIds: ['circuit-1'],
      eligibleDeviceIds: new Set(['exit-sign']),
      eligibleDeviceHitId: deviceHit?.annotationId,
      segmentHit,
    })).toEqual({ kind: 'annotation', annotationId: 'exit-sign' })
  })

  it('prefers an eligible source geometry hit over an overlapping route segment before source selection', () => {
    const switchDevice = { id: 'switch-1', pageNumber: 1, rect: { x: 0.68, y: 0.46, w: 0.04, h: 0.08 } }
    const deviceHit = findFirstRouteDeviceHit({ x: 0.7, y: 0.5 }, [switchDevice], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 4 })

    expect(resolveRoutePickIntent({
      sourceSelected: false,
      overlappingAnnotationIds: ['circuit-1'],
      eligibleDeviceIds: new Set(['switch-1']),
      eligibleDeviceHitId: deviceHit?.annotationId,
      segmentHit,
    })).toEqual({ kind: 'annotation', annotationId: 'switch-1' })
  })

  it('prefers an eligible source geometry hit over a non-source DOM annotation before source selection', () => {
    const switchDevice = { id: 'switch-1', pageNumber: 1, rect: { x: 0.68, y: 0.46, w: 0.04, h: 0.08 } }
    const deviceHit = findFirstRouteDeviceHit({ x: 0.7, y: 0.5 }, [switchDevice], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 4 })

    expect(resolveRoutePickIntent({
      sourceSelected: false,
      overlappingAnnotationIds: ['fixture-1'],
      eligibleDeviceIds: new Set(['switch-1']),
      eligibleDeviceHitId: deviceHit?.annotationId,
      segmentHit: null,
    })).toEqual({ kind: 'annotation', annotationId: 'switch-1' })
  })

  it('does not promote an emergency exit sign to a source candidate before source selection', () => {
    const exitSign = { id: 'exit-sign', pageNumber: 1, rect: { x: 0.68, y: 0.46, w: 0.08, h: 0.04 } }
    const deviceHit = findFirstRouteDeviceHit({ x: 0.7, y: 0.48 }, [exitSign], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 4 })

    expect(deviceHit?.annotationId).toBe('exit-sign')
    expect(resolveRoutePickIntent({
      sourceSelected: false,
      overlappingAnnotationIds: ['exit-sign', 'circuit-1'],
      eligibleDeviceIds: new Set(['switch-1']),
      eligibleDeviceHitId: deviceHit?.annotationId,
      segmentHit,
      fallbackAnnotationId: 'exit-sign',
    })).toEqual({ kind: 'annotation', annotationId: 'exit-sign' })
  })

  it('prefers eligible overlapping source annotations over captured fallback before source selection', () => {
    expect(resolveRoutePickIntent({
      sourceSelected: false,
      overlappingAnnotationIds: ['circuit-1', 'switch-1'],
      eligibleDeviceIds: new Set(['switch-1']),
      segmentHit,
      fallbackAnnotationId: 'fixture-1',
    })).toEqual({ kind: 'annotation', annotationId: 'switch-1' })
  })

  it('does not let a route segment become the source before source selection', () => {
    expect(resolveRoutePickIntent({
      sourceSelected: false,
      overlappingAnnotationIds: [],
      eligibleDeviceIds: new Set(['switch-1']),
      segmentHit,
    })).toBeNull()
  })

  it('returns an overlapping supported source diagnostic before generic fallback in source mode', () => {
    expect(resolveRoutePickIntent({
      sourceSelected: false,
      overlappingAnnotationIds: ['circuit-1', 'outside-switch'],
      eligibleDeviceIds: new Set(['inside-switch']),
      diagnosticSourceIds: new Set(['outside-switch']),
      segmentHit,
      fallbackAnnotationId: 'fixture-1',
    })).toEqual({ kind: 'annotation', annotationId: 'outside-switch' })
  })

  it('leaves the route segment selectable away from the device body and hit radius', () => {
    const receptacle = { id: 'receptacle-1', pageNumber: 1, rect: { x: 0.68, y: 0.46, w: 0.04, h: 0.08 } }
    const deviceHit = findFirstRouteDeviceHit({ x: 0.55, y: 0.5 }, [receptacle], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 4 })

    expect(deviceHit).toBeNull()
    expect(resolveRoutePickIntent({
      sourceSelected: true,
      overlappingAnnotationIds: ['circuit-1'],
      eligibleDeviceIds: new Set(['receptacle-1']),
      segmentHit,
    })).toEqual({ kind: 'segment', hit: segmentHit })
  })

  it('does not let devices omitted by package membership or visibility intercept segment picks', () => {
    const receptacle = { id: 'receptacle-1', pageNumber: 1, rect: { x: 0.68, y: 0.46, w: 0.04, h: 0.08 } }
    const deviceHit = findFirstRouteDeviceHit({ x: 0.7, y: 0.5 }, [], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 4 })

    expect(deviceHit).toBeNull()
    expect(resolveRoutePickIntent({
      sourceSelected: true,
      overlappingAnnotationIds: ['circuit-1'],
      eligibleDeviceIds: new Set(['receptacle-1']),
      segmentHit,
    })).toEqual({ kind: 'segment', hit: segmentHit })
    expect(findFirstRouteDeviceHit({ x: 0.7, y: 0.5 }, [{ ...receptacle, rect: undefined }], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 4 })).toBeNull()
  })

  it('uses nearest center when two eligible devices overlap', () => {
    const first = { id: 'device-a', pageNumber: 1, rect: { x: 0.68, y: 0.46, w: 0.04, h: 0.08 } }
    const second = { id: 'device-b', pageNumber: 1, rect: { x: 0.69, y: 0.47, w: 0.04, h: 0.08 } }

    expect(findFirstRouteDeviceHit({ x: 0.71, y: 0.51 }, [first, second], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 4 })?.annotationId).toBe('device-b')
  })

  it('uses stable annotation id order when eligible device center distances tie', () => {
    const first = { id: 'device-b', pageNumber: 1, rect: { x: 0.68, y: 0.46, w: 0.04, h: 0.08 } }
    const second = { id: 'device-a', pageNumber: 1, rect: { x: 0.68, y: 0.46, w: 0.04, h: 0.08 } }

    expect(findFirstRouteDeviceHit({ x: 0.7, y: 0.5 }, [first, second], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 4 })?.annotationId).toBe('device-a')
  })

  it('excludes the current endpoint device so its outgoing segment remains selectable', () => {
    const currentDevice = { id: 'receptacle-a', pageNumber: 1, rect: { x: 0.68, y: 0.46, w: 0.04, h: 0.08 } }
    const excluded = new Set(['receptacle-a'])
    const deviceHit = findFirstRouteDeviceHit({ x: 0.701, y: 0.5 }, [currentDevice], {
      pageWidth: 1000,
      pageHeight: 1000,
      tolerancePx: 4,
      excludedAnnotationIds: excluded,
    })

    expect(deviceHit).toBeNull()
    expect(resolveRoutePickIntent({
      sourceSelected: true,
      overlappingAnnotationIds: ['receptacle-a', 'circuit-1'],
      eligibleDeviceIds: new Set(['receptacle-a']),
      currentEndpointAnnotationId: 'receptacle-a',
      segmentHit,
      fallbackAnnotationId: 'receptacle-a',
    })).toEqual({ kind: 'segment', hit: segmentHit })
  })

  it('still lets a different back-to-back device win while the current endpoint is excluded', () => {
    const currentDevice = { id: 'receptacle-a', pageNumber: 1, rect: { x: 0.68, y: 0.46, w: 0.04, h: 0.08 } }
    const nextDevice = { id: 'receptacle-b', pageNumber: 1, rect: { x: 0.71, y: 0.46, w: 0.04, h: 0.08 } }
    const deviceHit = findFirstRouteDeviceHit({ x: 0.725, y: 0.5 }, [currentDevice, nextDevice], {
      pageWidth: 1000,
      pageHeight: 1000,
      tolerancePx: 4,
      excludedAnnotationIds: new Set(['receptacle-a']),
    })

    expect(deviceHit?.annotationId).toBe('receptacle-b')
    expect(resolveRoutePickIntent({
      sourceSelected: true,
      overlappingAnnotationIds: ['receptacle-a', 'receptacle-b', 'circuit-1'],
      eligibleDeviceIds: new Set(['receptacle-a', 'receptacle-b']),
      currentEndpointAnnotationId: 'receptacle-a',
      eligibleDeviceHitId: deviceHit?.annotationId,
      segmentHit,
    })).toEqual({ kind: 'annotation', annotationId: 'receptacle-b' })
  })

  it('uses visible body bounds instead of a large center-radius dead zone', () => {
    const receptacle = {
      id: 'receptacle-1',
      pageNumber: 1,
      rect: { x: 0.68, y: 0.46, w: 0.04, h: 0.08 },
      hitRect: { x: 0.69, y: 0.4672, w: 0.02, h: 0.0592 },
    }

    expect(findFirstRouteDeviceHit({ x: 0.709, y: 0.5 }, [receptacle], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 4 })?.annotationId).toBe('receptacle-1')
    expect(findFirstRouteDeviceHit({ x: 0.715, y: 0.5 }, [receptacle], { pageWidth: 1000, pageHeight: 1000, tolerancePx: 4 })).toBeNull()
  })
})
