import { BLUEPRINT_ANIMATION_SCENE_SCHEMA_VERSION, isSupportedBlueprintAnimationScene } from './sceneSchema'
import {
  createCircuitGeometryFingerprint,
  resolveCircuitPointIndex,
  resolveCircuitSegmentIndex,
  type CircuitShapeKind,
  type NormalizedPoint,
} from './routeGeometry'
import type {
  BlueprintAnimationEdge,
  BlueprintAnimationNode,
  BlueprintScopeAnimationScene,
  BlueprintScopeAnimationSceneV1,
} from './types'

export type BlueprintAnimationValidationSeverity = 'error' | 'warning'

export interface BlueprintAnimationValidationIssue {
  severity: BlueprintAnimationValidationSeverity
  code: string
  message: string
  nodeIds?: string[]
  edgeIds?: string[]
  annotationIds?: string[]
}

export interface BlueprintAnimationAnnotationGeometry {
  id: string
  pageNumber: number
  shapeKind: CircuitShapeKind | string
  points?: NormalizedPoint[]
  arcCtrls?: NormalizedPoint[]
  pointIds?: string[]
  segmentIds?: string[]
}

export interface BlueprintAnimationValidationContext {
  annotations?: BlueprintAnimationAnnotationGeometry[]
  packageAnnotationIds?: string[]
}

function issue(
  severity: BlueprintAnimationValidationSeverity,
  code: string,
  message: string,
  refs: Pick<BlueprintAnimationValidationIssue, 'nodeIds' | 'edgeIds' | 'annotationIds'> = {},
): BlueprintAnimationValidationIssue {
  return { severity, code, message, ...refs }
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>()
  const duplicate = new Set<string>()
  values.forEach((value) => (seen.has(value) ? duplicate.add(value) : seen.add(value)))
  return [...duplicate]
}

function annotationIdsForNode(node: BlueprintAnimationNode): string[] {
  const anchor = node?.anchor as any
  return anchor?.kind === 'annotation-center' || anchor?.kind === 'circuit-point'
    ? [String(anchor.annotationId || '')].filter(Boolean)
    : []
}

function annotationIdsForEdge(edge: BlueprintAnimationEdge): string[] {
  const geometry = edge?.geometry as any
  return geometry?.kind === 'circuit-segment'
    ? [String(geometry.annotationId || '')].filter(Boolean)
    : []
}

export function validateBlueprintAnimationScene(
  scene: BlueprintScopeAnimationScene,
  context: BlueprintAnimationValidationContext = {},
): BlueprintAnimationValidationIssue[] {
  if (!isSupportedBlueprintAnimationScene(scene)) {
    return [issue(
      'error',
      'unsupported-schema-version',
      `Animation scene schema version ${String(scene?.schemaVersion)} is not supported; expected ${BLUEPRINT_ANIMATION_SCENE_SCHEMA_VERSION}.`,
    )]
  }
  return validateSchemaV1Scene(scene, context)
}

function validateSchemaV1Scene(
  scene: BlueprintScopeAnimationSceneV1,
  context: BlueprintAnimationValidationContext,
): BlueprintAnimationValidationIssue[] {
  const issues: BlueprintAnimationValidationIssue[] = []
  const nodes = Array.isArray(scene.nodes) ? scene.nodes : []
  const edges = Array.isArray(scene.edges) ? scene.edges : []
  const sources = Array.isArray(scene.sources) ? scene.sources : []
  const branchOrders = Array.isArray(scene.branchOrders) ? scene.branchOrders : []
  const annotations = new Map((context.annotations ?? []).map((annotation) => [annotation.id, annotation]))
  const packageMembership = context.packageAnnotationIds ? new Set(context.packageAnnotationIds) : null

  const duplicateNodeIds = duplicates(nodes.map((node) => String(node?.id || '')))
  duplicateNodeIds.forEach((id) => issues.push(issue('error', 'duplicate-node-id', `Node ID "${id}" is duplicated.`, { nodeIds: [id] })))
  const duplicateEdgeIds = duplicates(edges.map((edge) => String(edge?.id || '')))
  duplicateEdgeIds.forEach((id) => issues.push(issue('error', 'duplicate-edge-id', `Edge ID "${id}" is duplicated.`, { edgeIds: [id] })))

  const nodeById = new Map<string, BlueprintAnimationNode>()
  nodes.forEach((node) => { if (!nodeById.has(node.id)) nodeById.set(node.id, node) })
  const edgeById = new Map<string, BlueprintAnimationEdge>()
  edges.forEach((edge) => { if (!edgeById.has(edge.id)) edgeById.set(edge.id, edge) })
  const sourceById = new Map(sources.map((source) => [source.id, source]))

  if (sources.length === 0) issues.push(issue('error', 'missing-source', 'The scene has no source.'))
  sources.forEach((source) => {
    if (!nodeById.has(source.nodeId)) {
      issues.push(issue('error', 'source-node-missing', `Source "${source.id}" references missing node "${source.nodeId}".`, { nodeIds: [source.nodeId] }))
    }
  })

  const exactEdgeKeys = new Map<string, string>()
  edges.forEach((edge) => {
    if (!nodeById.has(edge.fromNodeId) || !nodeById.has(edge.toNodeId)) {
      issues.push(issue('error', 'edge-node-missing', `Edge "${edge.id}" references a missing endpoint node.`, {
        edgeIds: [edge.id],
        nodeIds: [edge.fromNodeId, edge.toNodeId].filter((id) => !nodeById.has(id)),
      }))
    }
    if (edge.fromNodeId === edge.toNodeId) {
      issues.push(issue('warning', 'self-edge', `Edge "${edge.id}" starts and ends at the same node.`, { edgeIds: [edge.id], nodeIds: [edge.fromNodeId] }))
    }
    const exactKey = JSON.stringify([
      edge.fromNodeId,
      edge.toNodeId,
      edge.channel,
      edge.fromPort ?? null,
      edge.toPort ?? null,
      edge.geometry,
    ])
    const previousEdgeId = exactEdgeKeys.get(exactKey)
    if (previousEdgeId) {
      issues.push(issue('error', 'exact-duplicate-edge', `Edge "${edge.id}" exactly duplicates edge "${previousEdgeId}".`, { edgeIds: [previousEdgeId, edge.id] }))
    } else {
      exactEdgeKeys.set(exactKey, edge.id)
    }
  })

  const referencedAnnotationIds = new Set<string>()
  nodes.forEach((node) => {
    const anchor = node.anchor as any
    annotationIdsForNode(node).forEach((id) => referencedAnnotationIds.add(id))
    if (anchor?.kind === 'annotation-center') {
      const annotationId = String(anchor.annotationId || '')
      if (!annotations.has(annotationId)) {
        issues.push(issue('error', 'annotation-anchor-missing', `Node "${node.id}" references missing annotation "${annotationId}".`, { nodeIds: [node.id], annotationIds: [annotationId] }))
      }
      return
    }
    if (anchor?.kind !== 'circuit-point') return
    const annotationId = String(anchor.annotationId || '')
    const annotation = annotations.get(annotationId)
    if (!annotation) {
      issues.push(issue('error', 'circuit-point-annotation-missing', `Node "${node.id}" references missing circuit annotation "${annotationId}".`, { nodeIds: [node.id], annotationIds: [annotationId] }))
      return
    }
    const pointIndex = resolveCircuitPointIndex(annotation.pointIds, String(anchor.pointId || ''), anchor.pointIndexHint)
    if (pointIndex == null || pointIndex >= (annotation.points?.length ?? 0)) {
      issues.push(issue('error', 'circuit-point-missing', `Node "${node.id}" references a missing circuit point.`, { nodeIds: [node.id], annotationIds: [annotationId] }))
    }
    if (anchor.geometryFingerprint && (annotation.shapeKind === 'circuit-path' || annotation.shapeKind === 'circuit-arc')) {
      const current = createCircuitGeometryFingerprint({
        annotationId,
        pageNumber: annotation.pageNumber,
        shapeKind: annotation.shapeKind,
        points: annotation.points ?? [],
        arcCtrls: annotation.arcCtrls,
      })
      if (current !== anchor.geometryFingerprint) {
        issues.push(issue('warning', 'geometry-fingerprint-mismatch', `Node "${node.id}" references stale circuit geometry.`, { nodeIds: [node.id], annotationIds: [annotationId] }))
      }
    }
  })

  edges.forEach((edge) => {
    const geometry = edge.geometry as any
    annotationIdsForEdge(edge).forEach((id) => referencedAnnotationIds.add(id))
    if (geometry?.kind !== 'circuit-segment') return
    if (!Number.isFinite(geometry.fromT) || !Number.isFinite(geometry.toT)
      || geometry.fromT < 0 || geometry.fromT > 1 || geometry.toT < 0 || geometry.toT > 1) {
      issues.push(issue('error', 'invalid-segment-range', `Edge "${edge.id}" has invalid fromT/toT values.`, { edgeIds: [edge.id] }))
    }
    const annotationId = String(geometry.annotationId || '')
    const annotation = annotations.get(annotationId)
    if (!annotation || (annotation.shapeKind !== 'circuit-path' && annotation.shapeKind !== 'circuit-arc')) {
      issues.push(issue('error', 'geometry-annotation-missing', `Edge "${edge.id}" references missing circuit geometry "${annotationId}".`, { edgeIds: [edge.id], annotationIds: [annotationId] }))
      return
    }
    const resolution = resolveCircuitSegmentIndex({
      annotationId,
      pageNumber: annotation.pageNumber,
      shapeKind: annotation.shapeKind,
      points: annotation.points ?? [],
      arcCtrls: annotation.arcCtrls,
      segmentIds: annotation.segmentIds,
    }, String(geometry.segmentId || ''), geometry.segmentIndexHint, geometry.geometryFingerprint)
    if (resolution.status === 'missing') {
      issues.push(issue('error', 'geometry-segment-missing', `Edge "${edge.id}" references a missing circuit segment.`, { edgeIds: [edge.id], annotationIds: [annotationId] }))
    }
    if (!resolution.fingerprintMatches) {
      issues.push(issue('warning', 'geometry-fingerprint-mismatch', `Edge "${edge.id}" references stale circuit geometry.`, { edgeIds: [edge.id], annotationIds: [annotationId] }))
    }
  })

  if (packageMembership) {
    referencedAnnotationIds.forEach((annotationId) => {
      if (!packageMembership.has(annotationId)) {
        issues.push(issue('error', 'annotation-not-in-package', `Animation annotation "${annotationId}" is not included in package membership.`, { annotationIds: [annotationId] }))
      }
    })
  }

  const options = scene.playbackOptions as any
  if (!Number.isFinite(options?.travelSpeed) || options.travelSpeed <= 0) {
    issues.push(issue('error', 'invalid-travel-speed', 'Playback travelSpeed must be greater than zero.'))
  }
  ;(['nodePauseMs', 'fixtureFadeMs', 'deviceReactionMs'] as const).forEach((field) => {
    if (!Number.isFinite(options?.[field]) || options[field] < 0) {
      issues.push(issue('error', 'invalid-device-timing', `Playback ${field} must be a non-negative number.`))
    }
  })
  if (!Number.isFinite(options?.dimmedCircuitOpacity) || options.dimmedCircuitOpacity < 0 || options.dimmedCircuitOpacity > 1) {
    issues.push(issue('error', 'invalid-dimmed-opacity', 'Playback dimmedCircuitOpacity must be between 0 and 1.'))
  }

  branchOrders.forEach((order) => {
    const outgoing = edges.filter((edge) => edge.fromNodeId === order.nodeId).map((edge) => edge.id)
    const listed = Array.isArray(order.outgoingEdgeIds) ? order.outgoingEdgeIds : []
    const duplicateListed = duplicates(listed)
    if (!nodeById.has(order.nodeId)) {
      issues.push(issue('error', 'invalid-branch-order-node', `Branch order "${order.id}" references missing node "${order.nodeId}".`, { nodeIds: [order.nodeId] }))
    }
    duplicateListed.forEach((edgeId) => issues.push(issue('error', 'duplicate-branch-edge', `Branch order "${order.id}" repeats edge "${edgeId}".`, { edgeIds: [edgeId], nodeIds: [order.nodeId] })))
    listed.filter((edgeId) => !outgoing.includes(edgeId)).forEach((edgeId) => {
      issues.push(issue('error', 'branch-edge-not-outgoing', `Branch order "${order.id}" references non-outgoing edge "${edgeId}".`, { edgeIds: [edgeId], nodeIds: [order.nodeId] }))
    })
    outgoing.filter((edgeId) => !listed.includes(edgeId)).forEach((edgeId) => {
      issues.push(issue('error', 'branch-order-missing-edge', `Branch order "${order.id}" omits outgoing edge "${edgeId}".`, { edgeIds: [edgeId], nodeIds: [order.nodeId] }))
    })
  })

  const validEdges = edges.filter((edge) => nodeById.has(edge.fromNodeId) && nodeById.has(edge.toNodeId))
  const adjacency = new Map<string, string[]>()
  const undirected = new Map<string, Set<string>>()
  nodes.forEach((node) => { adjacency.set(node.id, []); undirected.set(node.id, new Set()) })
  validEdges.forEach((edge) => {
    adjacency.get(edge.fromNodeId)?.push(edge.toNodeId)
    undirected.get(edge.fromNodeId)?.add(edge.toNodeId)
    undirected.get(edge.toNodeId)?.add(edge.fromNodeId)
  })

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const cycleNodes = new Set<string>()
  const visitForCycle = (nodeId: string) => {
    if (visiting.has(nodeId)) { cycleNodes.add(nodeId); return }
    if (visited.has(nodeId)) return
    visiting.add(nodeId)
    ;(adjacency.get(nodeId) ?? []).forEach(visitForCycle)
    visiting.delete(nodeId)
    visited.add(nodeId)
  }
  nodes.forEach((node) => visitForCycle(node.id))
  if (cycleNodes.size > 0) issues.push(issue('error', 'directed-cycle', 'The animation graph contains a directed cycle.', { nodeIds: [...cycleNodes] }))

  const sourceNodeIds = new Set(sources.filter((source) => nodeById.has(source.nodeId)).map((source) => source.nodeId))
  const reachable = new Set<string>()
  const queue = [...sourceNodeIds]
  while (queue.length > 0) {
    const nodeId = queue.shift() as string
    if (reachable.has(nodeId)) continue
    reachable.add(nodeId)
    ;(adjacency.get(nodeId) ?? []).forEach((next) => { if (!reachable.has(next)) queue.push(next) })
  }
  nodes.filter((node) => !reachable.has(node.id)).forEach((node) => {
    issues.push(issue('warning', 'unreachable-node', `Node "${node.id}" is unreachable from every source.`, { nodeIds: [node.id] }))
  })
  validEdges.filter((edge) => !reachable.has(edge.fromNodeId)).forEach((edge) => {
    issues.push(issue('warning', 'unreachable-edge', `Edge "${edge.id}" is unreachable from every source.`, { edgeIds: [edge.id] }))
  })

  const componentVisited = new Set<string>()
  const components: string[][] = []
  nodes.forEach((node) => {
    if (componentVisited.has(node.id)) return
    const component: string[] = []
    const pending = [node.id]
    while (pending.length > 0) {
      const current = pending.pop() as string
      if (componentVisited.has(current)) continue
      componentVisited.add(current)
      component.push(current)
      undirected.get(current)?.forEach((next) => { if (!componentVisited.has(next)) pending.push(next) })
    }
    components.push(component)
  })
  if (components.length > 1) issues.push(issue('warning', 'disconnected-components', `The animation graph has ${components.length} disconnected components.`))
  components.forEach((component) => {
    if (!component.some((nodeId) => sourceNodeIds.has(nodeId))) {
      issues.push(issue('error', 'component-without-source', 'A playable graph component has no source.', { nodeIds: component }))
    }
  })

  ;(scene.manualTraversal ?? []).forEach((step) => {
    if (!edgeById.has(step.edgeId)) issues.push(issue('error', 'manual-traversal-edge-missing', `Traversal step "${step.id}" references missing edge "${step.edgeId}".`, { edgeIds: [step.edgeId] }))
    if (step.sourceId && !sourceById.has(step.sourceId)) {
      issues.push(issue('error', 'manual-traversal-source-missing', `Traversal step "${step.id}" references missing source "${step.sourceId}".`))
    }
  })

  ;(scene.events ?? []).forEach((event) => {
    if (event.nodeId && !nodeById.has(event.nodeId)) {
      issues.push(issue('error', 'event-node-missing', `Event "${event.id}" references missing node "${event.nodeId}".`, { nodeIds: [event.nodeId] }))
    }
    if (event.edgeId && !edgeById.has(event.edgeId)) {
      issues.push(issue('error', 'event-edge-missing', `Event "${event.id}" references missing edge "${event.edgeId}".`, { edgeIds: [event.edgeId] }))
    }
    if (event.delayMs != null && (!Number.isFinite(event.delayMs) || event.delayMs < 0)) {
      issues.push(issue('error', 'invalid-event-timing', `Event "${event.id}" delayMs must be a non-negative number.`))
    }
  })

  return issues
}
