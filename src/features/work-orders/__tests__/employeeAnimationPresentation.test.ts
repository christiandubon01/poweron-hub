import { describe, expect, it } from 'vitest'
import type { BlueprintAnnotation, BlueprintScopeLayer } from '@/services/blueprintLibraryService'
import type { BlueprintScopeAnimationSceneV1 } from '@/features/blueprint-animation/types'
import {
  addEmployeeAnimationBackgrounds,
  parseEmployeeAnimationPresentation,
  projectEmployeeAnimationPresentation,
} from '../employeeAnimationPresentation'

function annotation(id: string, x: number, patch: Partial<BlueprintAnnotation> = {}): BlueprintAnnotation {
  return {
    id,
    projectId: 'project-1',
    blueprintSetId: 'set-1',
    pageNumber: 2,
    type: 'shape',
    color: '#38bdf8',
    rect: { x, y: 0.2, w: 0.05, h: 0.05 },
    meta: { shapeKind: id === 'panel' ? 'electrical-panel' : 'electrical-receptacle' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  } as BlueprintAnnotation
}

function scene(): BlueprintScopeAnimationSceneV1 {
  return {
    schemaVersion: 1,
    id: 'owner-scene-secret',
    revision: 17,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    nodes: [
      { id: 'owner-node-panel', roles: ['source'], anchor: { kind: 'annotation-center', annotationId: 'panel' }, label: 'Main Panel' },
      { id: 'owner-node-a', roles: ['load'], anchor: { kind: 'annotation-center', annotationId: 'load-a' }, label: 'Load A' },
      { id: 'owner-node-b', roles: ['load'], anchor: { kind: 'annotation-center', annotationId: 'load-b' }, label: 'Load B' },
    ],
    edges: [
      { id: 'owner-edge-a', fromNodeId: 'owner-node-panel', toNodeId: 'owner-node-a', channel: 'switched-line-voltage', geometry: { kind: 'direct' } },
      { id: 'owner-edge-b', fromNodeId: 'owner-node-panel', toNodeId: 'owner-node-b', channel: 'emergency-power', geometry: { kind: 'direct' } },
    ],
    sources: [{ id: 'owner-source', nodeId: 'owner-node-panel', channel: 'constant-line-voltage' }],
    manualTraversal: [
      { id: 'owner-step-b', edgeId: 'owner-edge-b', sourceId: 'owner-source' },
      { id: 'owner-step-a', edgeId: 'owner-edge-a', sourceId: 'owner-source' },
    ],
    branchOrders: [{
      id: 'owner-branch',
      nodeId: 'owner-node-panel',
      mode: 'sequential',
      outgoingEdgeIds: ['owner-edge-b', 'owner-edge-a'],
    }],
    events: [{ id: 'owner-event', type: 'activate-node', nodeId: 'owner-node-b', delayMs: 25 }],
    playbackOptions: {
      travelSpeed: 0.35,
      nodePauseMs: 150,
      fixtureFadeMs: 300,
      deviceReactionMs: 120,
      dimmedCircuitOpacity: 0.45,
      branchMode: 'simultaneous',
      sourceMode: 'simultaneous',
      direction: 'forward',
      loop: true,
      holdActivatedNodes: true,
      reducedMotion: false,
    },
  }
}

function workPackage(animationScene: unknown = scene()): BlueprintScopeLayer {
  return {
    id: 'package-1',
    name: 'Kitchen Route',
    description: '',
    color: '#38bdf8',
    selectedAnnotationIds: ['panel', 'load-a', 'load-b'],
    itemRefs: [],
    pageNumber: 2,
    roughInHours: 0,
    trimHours: 0,
    testingHours: 0,
    cleanupHours: 0,
    crewNotes: '',
    proposalSummary: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    visible: true,
    isolated: false,
    animationScene: animationScene as BlueprintScopeLayer['animationScene'],
    animationSceneRevision: 17,
  }
}

const annotations = [
  annotation('panel', 0.1),
  annotation('load-a', 0.5),
  annotation('load-b', 0.8),
  annotation('unrelated', 0.9, {
    meta: {
      shapeKind: 'electrical-switch',
      pricing: { unitCost: 999 },
      diagnostics: { selected: true },
    },
  }),
]

describe('employee animation presentation projection', () => {
  it('projects only the package route into the existing player schema and preserves authored order', () => {
    const projection = projectEmployeeAnimationPresentation({
      workPackage: workPackage(),
      annotations,
      getPageAspect: () => 1.5,
    })
    expect(projection?.schemaVersion).toBe(1)
    expect(projection?.routes).toHaveLength(1)
    const route = projection!.routes[0]
    expect(route.pageNumber).toBe(2)
    expect(route.pageAspect).toBe(1.5)
    expect(route.geometrySources).toHaveLength(3)
    expect(route.geometrySources.map((entry) => entry.id)).toEqual(['geometry-1', 'geometry-2', 'geometry-3'])
    expect(JSON.stringify(route)).not.toMatch(/unrelated|pricing|diagnostics|owner-scene-secret|owner-node|owner-edge|owner-source/)
    expect(route.playback.manualTraversal.map((step) => step.edgeId)).toEqual(['edge-1', 'edge-2'])
    expect(route.playback.edges.map((edge) => edge.channel)).toEqual(['emergency-power', 'switched-line-voltage'])
    expect(route.playback.branchOrders[0]).toMatchObject({
      nodeId: 'node-1',
      mode: 'sequential',
      outgoingEdgeIds: ['edge-1', 'edge-2'],
    })
    expect(route.playback.events[0]).toEqual({
      id: 'event-1',
      type: 'activate-node',
      nodeId: 'node-3',
      delayMs: 25,
    })
    expect(route.playback.playbackOptions.loop).toBe(false)
  })

  it('is deterministic and does not retain editor identity or revision metadata', () => {
    const sourcePackage = workPackage()
    const first = projectEmployeeAnimationPresentation({ workPackage: sourcePackage, annotations })
    const second = projectEmployeeAnimationPresentation({ workPackage: sourcePackage, annotations })
    expect(first).toEqual(second)
    expect(first?.routes[0].playback).toMatchObject({
      id: 'employee-route-1',
      revision: 1,
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
    })
    ;(sourcePackage.animationScene as BlueprintScopeAnimationSceneV1).nodes[0].label = 'Owner changed this later'
    expect(first?.routes[0].playback.nodes[0].label).toBe('Main Panel')
  })

  it('rejects absent, malformed, unsupported, unrelated, and deleted route sources', () => {
    expect(projectEmployeeAnimationPresentation({ workPackage: workPackage(null), annotations })).toBeNull()
    expect(projectEmployeeAnimationPresentation({ workPackage: workPackage({ bad: true }), annotations })).toBeNull()
    expect(projectEmployeeAnimationPresentation({
      workPackage: workPackage({ schemaVersion: 2 }),
      annotations,
    })).toBeNull()
    expect(projectEmployeeAnimationPresentation({
      workPackage: { ...workPackage(), selectedAnnotationIds: ['panel', 'load-a'] },
      annotations,
    })).toBeNull()
    expect(projectEmployeeAnimationPresentation({
      workPackage: workPackage(),
      annotations: annotations.map((entry) => entry.id === 'load-b' ? { ...entry, deletedAt: '2026-07-01T00:00:00.000Z' } : entry),
    })).toBeNull()
    expect(projectEmployeeAnimationPresentation({
      workPackage: { ...workPackage(), deletedAt: '2026-07-01T00:00:00.000Z' },
      annotations,
    })).toBeNull()
  })

  it('captures a stable matching full-page snapshot id and never matches by array position alone', () => {
    const projection = projectEmployeeAnimationPresentation({ workPackage: workPackage(), annotations })!
    const withBackground = addEmployeeAnimationBackgrounds(projection, [
      { id: 'area-page-2', pageNumber: 2, captureMode: 'area' },
      { id: 'full-page-1', pageNumber: 1, captureMode: 'full-page' },
      { id: 'full-page-2', pageNumber: 2, captureMode: 'full-page' },
    ], ['area-page-2', 'full-page-1', 'full-page-2'])
    expect(withBackground?.routes[0].background).toEqual({ snapshotId: 'full-page-2', pageNumber: 2 })
    expect(addEmployeeAnimationBackgrounds(projection, [
      { id: 'area-page-2', pageNumber: 2, captureMode: 'area' },
    ], ['area-page-2'])?.routes[0].background).toBeUndefined()
  })

  it('validates payload versions and fails malformed playback safely', () => {
    const projection = projectEmployeeAnimationPresentation({ workPackage: workPackage(), annotations })!
    expect(parseEmployeeAnimationPresentation(projection)).toEqual(projection)
    expect(parseEmployeeAnimationPresentation({ ...projection, schemaVersion: 2 })).toBeNull()
    expect(parseEmployeeAnimationPresentation({
      ...projection,
      routes: [{ ...projection.routes[0], playback: { schemaVersion: 1 } }],
    })).toBeNull()
  })
})
