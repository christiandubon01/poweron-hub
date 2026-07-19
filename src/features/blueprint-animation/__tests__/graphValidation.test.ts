import { describe, expect, it } from 'vitest'
import { validateBlueprintAnimationScene } from '../graphValidation'
import { createCircuitGeometryFingerprint } from '../routeGeometry'
import { createDefaultBlueprintAnimationScene, parseBlueprintAnimationScene } from '../sceneSchema'
import type { BlueprintAnimationNode, BlueprintScopeAnimationSceneV1 } from '../types'

const virtualNode = (id: string): BlueprintAnimationNode => ({
  id,
  roles: ['load'],
  anchor: { kind: 'virtual-point', pageNumber: 1, x: 0.2, y: 0.2 },
})

function scene(): BlueprintScopeAnimationSceneV1 {
  return {
    ...createDefaultBlueprintAnimationScene({ id: 'scene-1', now: '2026-07-19T00:00:00.000Z' }),
    nodes: [virtualNode('n1'), virtualNode('n2'), virtualNode('n3'), virtualNode('n4')],
    edges: [
      { id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', channel: 'generic-route', geometry: { kind: 'direct' } },
      { id: 'e2', fromNodeId: 'n1', toNodeId: 'n3', channel: 'generic-route', geometry: { kind: 'direct' } },
      { id: 'e3', fromNodeId: 'n2', toNodeId: 'n4', channel: 'generic-route', geometry: { kind: 'direct' } },
      { id: 'e4', fromNodeId: 'n3', toNodeId: 'n4', channel: 'generic-route', geometry: { kind: 'direct' } },
    ],
    sources: [{ id: 'source-1', nodeId: 'n1' }],
    branchOrders: [{ id: 'branch-1', nodeId: 'n1', mode: 'simultaneous', outgoingEdgeIds: ['e1', 'e2'] }],
  }
}

const codes = (value: BlueprintScopeAnimationSceneV1, context = {}) =>
  validateBlueprintAnimationScene(value, context).map((entry) => entry.code)

describe('graph validation', () => {
  it('allows acyclic branch splitting and rejoining', () => {
    expect(validateBlueprintAnimationScene(scene())).toEqual([])
  })

  it('reports duplicate IDs, exact duplicate edges, self edges, and missing endpoint nodes', () => {
    const value = scene()
    value.nodes.push(virtualNode('n1'))
    value.edges.push(
      { ...value.edges[0], id: 'e1' },
      { ...value.edges[0], id: 'exact-copy' },
      { id: 'self', fromNodeId: 'n2', toNodeId: 'n2', channel: 'generic-route', geometry: { kind: 'direct' } },
      { id: 'missing-node', fromNodeId: 'n4', toNodeId: 'gone', channel: 'generic-route', geometry: { kind: 'direct' } },
    )
    expect(codes(value)).toEqual(expect.arrayContaining([
      'duplicate-node-id', 'duplicate-edge-id', 'exact-duplicate-edge', 'self-edge', 'edge-node-missing',
    ]))
  })

  it('reports directed cycles', () => {
    const value = scene()
    value.edges.push({ id: 'cycle', fromNodeId: 'n4', toNodeId: 'n1', channel: 'generic-route', geometry: { kind: 'direct' } })
    expect(codes(value)).toContain('directed-cycle')
  })

  it('allows multiple components only when each has a source', () => {
    const value = scene()
    value.nodes.push(virtualNode('n5'), virtualNode('n6'))
    value.edges.push({ id: 'e5', fromNodeId: 'n5', toNodeId: 'n6', channel: 'emergency-power', geometry: { kind: 'direct' } })
    expect(codes(value)).toEqual(expect.arrayContaining(['disconnected-components', 'component-without-source', 'unreachable-node', 'unreachable-edge']))
    value.sources.push({ id: 'source-2', nodeId: 'n5' })
    expect(codes(value)).not.toContain('component-without-source')
  })

  it('validates missing sources and source node references', () => {
    const value = scene()
    value.sources = []
    expect(codes(value)).toContain('missing-source')
    value.sources = [{ id: 'broken', nodeId: 'missing' }]
    expect(codes(value)).toContain('source-node-missing')
  })

  it('validates branch orders and manual traversal', () => {
    const value = scene()
    value.branchOrders[0].outgoingEdgeIds = ['e1', 'e1', 'e3']
    value.manualTraversal = [{ id: 'step-1', edgeId: 'missing' }]
    expect(codes(value)).toEqual(expect.arrayContaining([
      'duplicate-branch-edge', 'branch-edge-not-outgoing', 'branch-order-missing-edge', 'manual-traversal-edge-missing',
    ]))
  })

  it('validates annotation anchors, traversal sources, and event references', () => {
    const value = scene()
    value.nodes[0].anchor = { kind: 'annotation-center', annotationId: 'missing-annotation' }
    value.manualTraversal = [{ id: 'step-1', edgeId: 'e1', sourceId: 'missing-source' }]
    value.events = [{
      id: 'event-1', type: 'send-control-signal', nodeId: 'missing-node', edgeId: 'missing-edge', delayMs: -1,
    }]
    expect(codes(value)).toEqual(expect.arrayContaining([
      'annotation-anchor-missing', 'manual-traversal-source-missing',
      'event-node-missing', 'event-edge-missing', 'invalid-event-timing',
    ]))
  })

  it('validates timing and segment ranges', () => {
    const value = scene()
    value.playbackOptions.travelSpeed = 0
    value.playbackOptions.nodePauseMs = -1
    value.playbackOptions.dimmedCircuitOpacity = 2
    value.edges[0].geometry = {
      kind: 'circuit-segment', annotationId: 'ann-1', segmentId: 'seg-1',
      fromT: -0.1, toT: 1.1, geometryFingerprint: 'stale',
    }
    expect(codes(value)).toEqual(expect.arrayContaining([
      'invalid-travel-speed', 'invalid-device-timing', 'invalid-dimmed-opacity', 'invalid-segment-range', 'geometry-annotation-missing',
    ]))
  })

  it('validates stable point/segment references, fingerprints, and package membership', () => {
    const points = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }]
    const annotation = { id: 'ann-1', pageNumber: 1, shapeKind: 'circuit-path' as const, points, pointIds: ['p1', 'p2'], segmentIds: ['s1'] }
    const fingerprint = createCircuitGeometryFingerprint({ annotationId: annotation.id, pageNumber: 1, shapeKind: 'circuit-path', points })
    const value = scene()
    value.nodes[0].anchor = { kind: 'circuit-point', annotationId: 'ann-1', pointId: 'missing', pointIndexHint: 0, geometryFingerprint: fingerprint }
    value.edges[0].geometry = { kind: 'circuit-segment', annotationId: 'ann-1', segmentId: 'missing', segmentIndexHint: 0, fromT: 0, toT: 1, geometryFingerprint: 'stale' }
    expect(codes(value, { annotations: [annotation], packageAnnotationIds: [] })).toEqual(expect.arrayContaining([
      'circuit-point-missing', 'geometry-segment-missing', 'geometry-fingerprint-mismatch', 'annotation-not-in-package',
    ]))
  })

  it('allows parallel edges when their channels differ', () => {
    const value = scene()
    value.edges.push({ ...value.edges[0], id: 'parallel', channel: 'low-voltage-control-signal' })
    expect(codes(value)).not.toContain('exact-duplicate-edge')
  })
})

describe('scene schema parsing', () => {
  it('supplies safe schema-v1 defaults without deleting broken graph references', () => {
    const parsed = parseBlueprintAnimationScene({
      schemaVersion: 1,
      id: 'scene',
      revision: 1,
      nodes: [],
      edges: [{ id: 'edge', fromNodeId: 'missing-a', toNodeId: 'missing-b', channel: 'generic-route', geometry: { kind: 'direct' } }],
    })
    expect(parsed.status).toBe('supported')
    if (parsed.status === 'supported') {
      expect(parsed.scene.edges).toHaveLength(1)
      expect(parsed.scene.playbackOptions.travelSpeed).toBeGreaterThan(0)
    }
  })

  it('preserves unsupported future scenes raw and rejects malformed values', () => {
    const future = { schemaVersion: 99, id: 'future', futureField: { keep: true } }
    expect(parseBlueprintAnimationScene(future)).toMatchObject({ status: 'unsupported-version', scene: future })
    expect(validateBlueprintAnimationScene(future)).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', code: 'unsupported-schema-version' }),
    ]))
    expect(parseBlueprintAnimationScene('broken')).toMatchObject({ status: 'malformed' })
  })

  it('preserves finite invalid timing values so validation can report them', () => {
    const raw = scene()
    raw.playbackOptions.travelSpeed = 0
    raw.playbackOptions.nodePauseMs = -5
    raw.playbackOptions.dimmedCircuitOpacity = 2
    const parsed = parseBlueprintAnimationScene(raw)
    expect(parsed.status).toBe('supported')
    if (parsed.status === 'supported') {
      expect(parsed.scene.playbackOptions).toMatchObject({ travelSpeed: 0, nodePauseMs: -5, dimmedCircuitOpacity: 2 })
      expect(codes(parsed.scene)).toEqual(expect.arrayContaining([
        'invalid-travel-speed', 'invalid-device-timing', 'invalid-dimmed-opacity',
      ]))
    }
  })
})
