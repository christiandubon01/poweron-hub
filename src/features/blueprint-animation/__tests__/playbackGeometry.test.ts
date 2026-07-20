import { describe, expect, it } from 'vitest'
import { createCircuitGeometryFingerprint } from '../routeGeometry'
import { buildPlaybackSegmentGeometry, preparePlaybackGeometry } from '../playbackGeometry'
import { createDefaultBlueprintAnimationScene } from '../sceneSchema'
import type { RouteBuilderAnnotation } from '../routeBuilderModel'

describe('playback geometry', () => {
  it('measures real page geometry in zoom-independent longer-side units', () => {
    const horizontal = buildPlaybackSegmentGeometry({
      kind: 'straight', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, pageMetrics: { width: 2000, height: 1000 },
    })
    const vertical = buildPlaybackSegmentGeometry({
      kind: 'straight', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, pageMetrics: { width: 2000, height: 1000 },
    })
    const zoomed = buildPlaybackSegmentGeometry({
      kind: 'straight', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, pageMetrics: { width: 4000, height: 2000 },
    })

    expect(horizontal.length).toBeCloseTo(1)
    expect(vertical.length).toBeCloseTo(0.5)
    expect(zoomed.length).toBeCloseTo(horizontal.length)
  })

  it('samples reversed quadratic geometry by constant arc-length progress', () => {
    const geometry = buildPlaybackSegmentGeometry({
      kind: 'quadratic',
      start: { x: 0.1, y: 0.8 },
      control: { x: 0.5, y: 0.1 },
      end: { x: 0.9, y: 0.8 },
      reverse: true,
      pageMetrics: { width: 1000, height: 1000 },
    })

    expect(geometry.pointAtProgress(0)).toEqual({ x: 0.9, y: 0.8 })
    expect(geometry.pointAtProgress(1)).toEqual({ x: 0.1, y: 0.8 })
    expect(geometry.renderPoints).toHaveLength(49)
    expect(geometry.pointAtProgress(0.5).x).toBeCloseTo(0.5)
  })

  it('resolves the stable saved segment and traversal direction without persisting distance', () => {
    const annotation: RouteBuilderAnnotation = {
      id: 'circuit', pageNumber: 1, label: 'Circuit', shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
      pointIds: ['p1', 'p2'], segmentIds: ['s1'],
    }
    const fingerprint = createCircuitGeometryFingerprint({
      annotationId: annotation.id,
      pageNumber: annotation.pageNumber,
      shapeKind: 'circuit-path',
      points: annotation.points!,
    })
    const scene = createDefaultBlueprintAnimationScene({ id: 'scene', now: '2026-07-19T00:00:00.000Z' })
    scene.nodes = [
      { id: 'source', roles: ['source'], anchor: { kind: 'virtual-point', pageNumber: 1, x: 0.1, y: 0.5 } },
      { id: 'load', roles: ['load'], anchor: { kind: 'virtual-point', pageNumber: 1, x: 0.9, y: 0.5 } },
    ]
    scene.sources = [{ id: 'source-1', nodeId: 'source' }]
    scene.edges = [{
      id: 'edge-1', fromNodeId: 'source', toNodeId: 'load', channel: 'switched-line-voltage',
      geometry: { kind: 'circuit-segment', annotationId: 'circuit', segmentId: 's1', fromT: 1, toT: 0, geometryFingerprint: fingerprint },
    }]
    scene.manualTraversal = [{ id: 'step-1', edgeId: 'edge-1', direction: 'forward' }]

    const prepared = preparePlaybackGeometry({ scene, annotations: [annotation], pageMetrics: { width: 1000, height: 1000 } })
    expect(prepared.steps[0].geometry?.pointAtProgress(0)).toEqual({ x: 0.9, y: 0.5 })
    expect(prepared.steps[0].geometry?.pointAtProgress(1)).toEqual({ x: 0.1, y: 0.5 })
    expect(prepared.steps[0].geometry?.length).toBeCloseTo(0.8)
  })
})
