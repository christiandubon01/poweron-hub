import type { BlueprintAnnotation, BlueprintScopeLayer } from '@/services/blueprintLibraryService'
import { validateBlueprintAnimationScene } from '@/features/blueprint-animation/graphValidation'
import { preparePlaybackGeometry } from '@/features/blueprint-animation/playbackGeometry'
import { createCircuitGeometryFingerprint, type NormalizedPoint } from '@/features/blueprint-animation/routeGeometry'
import { parseBlueprintAnimationScene } from '@/features/blueprint-animation/sceneSchema'
import type {
  BlueprintAnimationChannelType,
  BlueprintAnimationDeviceRole,
  BlueprintAnimationEventType,
  BlueprintScopeAnimationSceneV1,
} from '@/features/blueprint-animation/types'
import type { RouteBuilderAnnotation } from '@/features/blueprint-animation/routeBuilderModel'

const PRESENTATION_SCHEMA_VERSION = 1 as const
const PLAYER_SCENE_TIMESTAMP = '1970-01-01T00:00:00.000Z'
const DEVICE_ROLES = new Set<BlueprintAnimationDeviceRole>([
  'source',
  'control',
  'sensor',
  'junction',
  'load',
  'emergency-source',
  'emergency-driver',
  'transfer-device',
])
const CHANNELS = new Set<BlueprintAnimationChannelType>([
  'switched-line-voltage',
  'constant-line-voltage',
  'zero-to-ten-volt-control',
  'low-voltage-control-signal',
  'emergency-power',
  'generic-route',
])
const EVENT_TYPES = new Set<BlueprintAnimationEventType>([
  'activate-node',
  'deactivate-node',
  'send-control-signal',
  'transfer-emergency-power',
])

export interface EmployeeAnimationGeometrySource {
  id: string
  pageNumber: number
  label: string
  color?: string
  borderColor?: string
  shapeKind?: string
  rect?: { x: number; y: number; w: number; h: number }
  points?: NormalizedPoint[]
  arcCtrls?: NormalizedPoint[]
  pointIds?: string[]
  segmentIds?: string[]
}

export interface EmployeeAnimationRoutePresentation {
  title: string
  pageNumber: number
  pageAspect: number
  playback: BlueprintScopeAnimationSceneV1
  geometrySources: EmployeeAnimationGeometrySource[]
  background?: {
    snapshotId: string
    pageNumber: number
  }
}

export interface EmployeeAnimationPresentationV1 {
  schemaVersion: 1
  routes: EmployeeAnimationRoutePresentation[]
}

export interface EmployeeAnimationSnapshotCandidate {
  id: string
  pageNumber: number | null
  captureMode: string | null
}

type ProjectionInput = {
  workPackage: BlueprintScopeLayer
  annotations: readonly BlueprintAnnotation[]
  getPageAspect?: (pageNumber: number) => number | null
}

export function projectEmployeeAnimationPresentation(
  input: ProjectionInput,
): EmployeeAnimationPresentationV1 | null {
  if (input.workPackage.deletedAt) return null
  const parsed = parseBlueprintAnimationScene(input.workPackage.animationScene)
  if (parsed.status !== 'supported') return null

  const packageIds = new Set(
    (Array.isArray(input.workPackage.selectedAnnotationIds) ? input.workPackage.selectedAnnotationIds : [])
      .map(cleanId)
      .filter(Boolean),
  )
  const routeAnnotations = input.annotations
    .map(toRouteAnnotation)
    .filter((entry): entry is RouteBuilderAnnotation => !!entry)
  const annotationById = new Map(routeAnnotations.map((entry) => [entry.id, entry]))

  const validation = validateBlueprintAnimationScene(parsed.scene, {
    packageAnnotationIds: [...packageIds],
    annotations: routeAnnotations.map((annotation) => ({
      id: annotation.id,
      pageNumber: annotation.pageNumber,
      shapeKind: annotation.shapeKind || '',
      points: annotation.points,
      arcCtrls: annotation.arcCtrls,
      pointIds: annotation.pointIds,
      segmentIds: annotation.segmentIds,
    })),
  })
  if (validation.some((issue) => issue.severity === 'error')) return null

  const traversalEdgeIds = parsed.scene.manualTraversal.map((step) => step.edgeId)
  if (
    parsed.scene.sources.length !== 1
    || traversalEdgeIds.length === 0
    || new Set(traversalEdgeIds).size !== traversalEdgeIds.length
    || parsed.scene.edges.some((edge) => !traversalEdgeIds.includes(edge.id))
  ) {
    return null
  }

  const referencedAnnotationIds = collectReferencedAnnotationIds(parsed.scene)
  if (
    referencedAnnotationIds.size === 0
    || [...referencedAnnotationIds].some((id) => !packageIds.has(id) || !annotationById.has(id))
  ) {
    return null
  }

  const routePages = new Set<number>()
  parsed.scene.nodes.forEach((node) => {
    if (node.anchor.kind === 'virtual-point') routePages.add(positivePage(node.anchor.pageNumber))
    else {
      const annotation = annotationById.get(node.anchor.annotationId)
      if (annotation) routePages.add(annotation.pageNumber)
    }
  })
  parsed.scene.edges.forEach((edge) => {
    if (edge.geometry.kind !== 'circuit-segment') return
    const annotation = annotationById.get(edge.geometry.annotationId)
    if (annotation) routePages.add(annotation.pageNumber)
  })
  if (routePages.size !== 1) return null
  const pageNumber = [...routePages][0]
  const requestedAspect = input.getPageAspect?.(pageNumber)
  const pageAspect = finitePositive(requestedAspect) ?? 1

  try {
    preparePlaybackGeometry({
      scene: parsed.scene,
      annotations: routeAnnotations,
      pageMetrics: { width: pageAspect, height: 1 },
    })
  } catch {
    return null
  }

  const projected = rekeyPlayerScene(parsed.scene, annotationById, referencedAnnotationIds)
  if (!projected) return null

  return {
    schemaVersion: PRESENTATION_SCHEMA_VERSION,
    routes: [{
      title: cleanText(input.workPackage.name, 200) || 'Animation Route',
      pageNumber,
      pageAspect,
      playback: projected.playback,
      geometrySources: projected.geometrySources,
    }],
  }
}

export function addEmployeeAnimationBackgrounds(
  presentation: EmployeeAnimationPresentationV1 | null | undefined,
  candidates: readonly EmployeeAnimationSnapshotCandidate[],
  orderedSnapshotIds: readonly string[],
): EmployeeAnimationPresentationV1 | null {
  const parsed = parseEmployeeAnimationPresentation(presentation)
  if (!parsed) return null
  const byId = new Map(candidates.map((candidate) => [cleanId(candidate.id), candidate]))
  const ordered = orderedSnapshotIds.map(cleanId).filter(Boolean)
  return {
    schemaVersion: PRESENTATION_SCHEMA_VERSION,
    routes: parsed.routes.map((route) => {
      const matchId = ordered.find((snapshotId) => {
        const candidate = byId.get(snapshotId)
        return candidate?.captureMode === 'full-page' && candidate.pageNumber === route.pageNumber
      })
      if (!matchId) {
        const { background: _background, ...withoutBackground } = route
        return withoutBackground
      }
      return {
        ...route,
        background: { snapshotId: matchId, pageNumber: route.pageNumber },
      }
    }),
  }
}

export function parseEmployeeAnimationPresentation(value: unknown): EmployeeAnimationPresentationV1 | null {
  if (!isRecord(value) || value.schemaVersion !== PRESENTATION_SCHEMA_VERSION || !Array.isArray(value.routes)) return null
  const routes = value.routes
    .map(parsePresentationRoute)
    .filter((route): route is EmployeeAnimationRoutePresentation => !!route)
  if (routes.length === 0 || routes.length !== value.routes.length) return null
  return { schemaVersion: PRESENTATION_SCHEMA_VERSION, routes }
}

function parsePresentationRoute(value: unknown): EmployeeAnimationRoutePresentation | null {
  if (!isRecord(value) || !Array.isArray(value.geometrySources)) return null
  const title = cleanText(value.title, 200)
  const pageNumber = positiveInteger(value.pageNumber)
  const pageAspect = finitePositive(value.pageAspect)
  if (!title || !pageNumber || !pageAspect) return null

  const geometrySources = value.geometrySources
    .map(parseGeometrySource)
    .filter((source): source is EmployeeAnimationGeometrySource => !!source)
  if (geometrySources.length === 0 || geometrySources.length !== value.geometrySources.length) return null

  const parsedScene = parseBlueprintAnimationScene(value.playback)
  if (parsedScene.status !== 'supported') return null
  const geometryIds = geometrySources.map((source) => source.id)
  const validation = validateBlueprintAnimationScene(parsedScene.scene, {
    packageAnnotationIds: geometryIds,
    annotations: geometrySources.map((source) => ({
      id: source.id,
      pageNumber: source.pageNumber,
      shapeKind: source.shapeKind || '',
      points: source.points,
      arcCtrls: source.arcCtrls,
      pointIds: source.pointIds,
      segmentIds: source.segmentIds,
    })),
  })
  if (validation.some((issue) => issue.severity === 'error')) return null
  try {
    preparePlaybackGeometry({
      scene: parsedScene.scene,
      annotations: geometrySources,
      pageMetrics: { width: pageAspect, height: 1 },
    })
  } catch {
    return null
  }

  const backgroundRecord = isRecord(value.background) ? value.background : null
  const backgroundId = backgroundRecord ? cleanId(backgroundRecord.snapshotId) : ''
  const backgroundPage = backgroundRecord ? positiveInteger(backgroundRecord.pageNumber) : null
  if (backgroundRecord && (!backgroundId || backgroundPage !== pageNumber)) return null
  return {
    title,
    pageNumber,
    pageAspect,
    playback: parsedScene.scene,
    geometrySources,
    ...(backgroundId ? { background: { snapshotId: backgroundId, pageNumber } } : {}),
  }
}

function parseGeometrySource(value: unknown): EmployeeAnimationGeometrySource | null {
  if (!isRecord(value)) return null
  const id = cleanId(value.id)
  const pageNumber = positiveInteger(value.pageNumber)
  const label = cleanText(value.label, 200)
  if (!id || !pageNumber || !label) return null
  const rect = parseRect(value.rect)
  const points = parsePoints(value.points)
  const arcCtrls = parsePoints(value.arcCtrls)
  const pointIds = parseIds(value.pointIds)
  const segmentIds = parseIds(value.segmentIds)
  return {
    id,
    pageNumber,
    label,
    ...(cleanText(value.color, 40) ? { color: cleanText(value.color, 40) } : {}),
    ...(cleanText(value.borderColor, 40) ? { borderColor: cleanText(value.borderColor, 40) } : {}),
    ...(cleanText(value.shapeKind, 100) ? { shapeKind: cleanText(value.shapeKind, 100) } : {}),
    ...(rect ? { rect } : {}),
    ...(points ? { points } : {}),
    ...(arcCtrls ? { arcCtrls } : {}),
    ...(pointIds ? { pointIds } : {}),
    ...(segmentIds ? { segmentIds } : {}),
  }
}

function rekeyPlayerScene(
  scene: BlueprintScopeAnimationSceneV1,
  annotationById: Map<string, RouteBuilderAnnotation>,
  referencedAnnotationIds: Set<string>,
): { playback: BlueprintScopeAnimationSceneV1; geometrySources: EmployeeAnimationGeometrySource[] } | null {
  const annotationOrder = [...referencedAnnotationIds]
  const annotationIds = new Map(annotationOrder.map((id, index) => [id, `geometry-${index + 1}`]))
  const nodeIds = new Map(scene.nodes.map((node, index) => [node.id, `node-${index + 1}`]))
  const traversalEdgeIds = scene.manualTraversal.map((step) => step.edgeId)
  const edgeIds = new Map(traversalEdgeIds.map((id, index) => [id, `edge-${index + 1}`]))
  const sourceIds = new Map(scene.sources.map((source, index) => [source.id, `source-${index + 1}`]))

  const geometrySources = annotationOrder.map((oldId, geometryIndex) => {
    const annotation = annotationById.get(oldId)
    const id = annotationIds.get(oldId)
    if (!annotation || !id) return null
    const pointIds = annotation.points?.map((_point, index) => `point-${geometryIndex + 1}-${index + 1}`)
    const segmentIds = annotation.points?.slice(1).map((_point, index) => `segment-${geometryIndex + 1}-${index + 1}`)
    return {
      id,
      pageNumber: annotation.pageNumber,
      label: cleanText(annotation.label, 200) || 'Route element',
      ...(cleanText(annotation.color, 40) ? { color: cleanText(annotation.color, 40) } : {}),
      ...(cleanText(annotation.borderColor, 40) ? { borderColor: cleanText(annotation.borderColor, 40) } : {}),
      ...(cleanText(annotation.shapeKind, 100) ? { shapeKind: cleanText(annotation.shapeKind, 100) } : {}),
      ...(annotation.rect ? { rect: { ...annotation.rect } } : {}),
      ...(annotation.points ? { points: annotation.points.map((point) => ({ ...point })) } : {}),
      ...(annotation.arcCtrls ? { arcCtrls: annotation.arcCtrls.map((point) => ({ ...point })) } : {}),
      ...(pointIds ? { pointIds } : {}),
      ...(segmentIds ? { segmentIds } : {}),
    } satisfies EmployeeAnimationGeometrySource
  }).filter((source): source is EmployeeAnimationGeometrySource => !!source)
  if (geometrySources.length !== annotationOrder.length) return null
  const geometryByOldId = new Map(annotationOrder.map((oldId, index) => [oldId, geometrySources[index]]))

  const nodes = scene.nodes.map((node) => {
    const id = nodeIds.get(node.id)
    if (!id) return null
    if (node.anchor.kind === 'virtual-point') {
      return {
        id,
        roles: sanitizeRoles(node.roles),
        anchor: {
          kind: 'virtual-point' as const,
          pageNumber: positivePage(node.anchor.pageNumber),
          x: finiteCoordinate(node.anchor.x),
          y: finiteCoordinate(node.anchor.y),
        },
        ...(cleanText(node.label, 200) ? { label: cleanText(node.label, 200) } : {}),
      }
    }
    const oldAnnotation = annotationById.get(node.anchor.annotationId)
    const geometrySource = geometryByOldId.get(node.anchor.annotationId)
    if (!oldAnnotation || !geometrySource) return null
    if (node.anchor.kind === 'annotation-center') {
      return {
        id,
        roles: sanitizeRoles(node.roles),
        anchor: { kind: 'annotation-center' as const, annotationId: geometrySource.id },
        ...(cleanText(node.label, 200) ? { label: cleanText(node.label, 200) } : {}),
      }
    }
    const oldPointIndex = oldAnnotation.pointIds?.indexOf(node.anchor.pointId) ?? -1
    const pointIndex = oldPointIndex >= 0 ? oldPointIndex : Number(node.anchor.pointIndexHint)
    const pointId = geometrySource.pointIds?.[pointIndex]
    const fingerprint = geometryFingerprint(geometrySource)
    if (!pointId || !fingerprint) return null
    return {
      id,
      roles: sanitizeRoles(node.roles),
      anchor: {
        kind: 'circuit-point' as const,
        annotationId: geometrySource.id,
        pointId,
        pointIndexHint: pointIndex,
        geometryFingerprint: fingerprint,
      },
      ...(cleanText(node.label, 200) ? { label: cleanText(node.label, 200) } : {}),
    }
  })
  if (nodes.some((node) => !node)) return null

  const edgeByOldId = new Map(scene.edges.map((edge) => [edge.id, edge]))
  const edges = traversalEdgeIds.map((oldEdgeId) => {
    const edge = edgeByOldId.get(oldEdgeId)
    const id = edgeIds.get(oldEdgeId)
    const fromNodeId = edge ? nodeIds.get(edge.fromNodeId) : undefined
    const toNodeId = edge ? nodeIds.get(edge.toNodeId) : undefined
    if (!edge || !id || !fromNodeId || !toNodeId) return null
    if (edge.geometry.kind === 'direct') {
      return {
        id,
        fromNodeId,
        toNodeId,
        channel: sanitizeChannel(edge.channel),
        geometry: { kind: 'direct' as const },
      }
    }
    const oldAnnotation = annotationById.get(edge.geometry.annotationId)
    const geometrySource = geometryByOldId.get(edge.geometry.annotationId)
    if (!oldAnnotation || !geometrySource) return null
    const oldSegmentIndex = oldAnnotation.segmentIds?.indexOf(edge.geometry.segmentId) ?? -1
    const segmentIndex = oldSegmentIndex >= 0 ? oldSegmentIndex : Number(edge.geometry.segmentIndexHint)
    const segmentId = geometrySource.segmentIds?.[segmentIndex]
    const fingerprint = geometryFingerprint(geometrySource)
    if (!segmentId || !fingerprint) return null
    return {
      id,
      fromNodeId,
      toNodeId,
      channel: sanitizeChannel(edge.channel),
      geometry: {
        kind: 'circuit-segment' as const,
        annotationId: geometrySource.id,
        segmentId,
        segmentIndexHint: segmentIndex,
        fromT: clamp01(edge.geometry.fromT),
        toT: clamp01(edge.geometry.toT),
        geometryFingerprint: fingerprint,
      },
    }
  })
  if (edges.some((edge) => !edge)) return null

  const playback: BlueprintScopeAnimationSceneV1 = {
    schemaVersion: 1,
    id: 'employee-route-1',
    revision: 1,
    createdAt: PLAYER_SCENE_TIMESTAMP,
    updatedAt: PLAYER_SCENE_TIMESTAMP,
    nodes: nodes as BlueprintScopeAnimationSceneV1['nodes'],
    edges: edges as BlueprintScopeAnimationSceneV1['edges'],
    sources: scene.sources.map((source) => ({
      id: sourceIds.get(source.id) as string,
      nodeId: nodeIds.get(source.nodeId) as string,
      ...(source.channel ? { channel: sanitizeChannel(source.channel) } : {}),
      ...(Number.isFinite(source.priority) ? { priority: Number(source.priority) } : {}),
    })),
    manualTraversal: scene.manualTraversal.map((step, index) => ({
      id: `step-${index + 1}`,
      edgeId: edgeIds.get(step.edgeId) as string,
      ...(step.sourceId && sourceIds.get(step.sourceId) ? { sourceId: sourceIds.get(step.sourceId) } : {}),
      ...(step.direction === 'reverse' ? { direction: 'reverse' as const } : {}),
    })),
    branchOrders: scene.branchOrders.map((order, index) => ({
      id: `branch-${index + 1}`,
      nodeId: nodeIds.get(order.nodeId) as string,
      mode: order.mode === 'sequential' ? 'sequential' : 'simultaneous',
      outgoingEdgeIds: order.outgoingEdgeIds.map((id) => edgeIds.get(id)).filter((id): id is string => !!id),
    })),
    events: scene.events
      .filter((event) => EVENT_TYPES.has(event.type))
      .map((event, index) => ({
        id: `event-${index + 1}`,
        type: event.type,
        ...(event.nodeId && nodeIds.get(event.nodeId) ? { nodeId: nodeIds.get(event.nodeId) } : {}),
        ...(event.edgeId && edgeIds.get(event.edgeId) ? { edgeId: edgeIds.get(event.edgeId) } : {}),
        ...(Number.isFinite(event.delayMs) ? { delayMs: Math.max(0, Number(event.delayMs)) } : {}),
      })),
    playbackOptions: {
      ...scene.playbackOptions,
      loop: false,
    },
  }
  return { playback, geometrySources }
}

function collectReferencedAnnotationIds(scene: BlueprintScopeAnimationSceneV1): Set<string> {
  const ids = new Set<string>()
  scene.nodes.forEach((node) => {
    if (node.anchor.kind !== 'virtual-point') ids.add(node.anchor.annotationId)
  })
  scene.edges.forEach((edge) => {
    if (edge.geometry.kind === 'circuit-segment') ids.add(edge.geometry.annotationId)
  })
  return ids
}

function toRouteAnnotation(annotation: BlueprintAnnotation): RouteBuilderAnnotation | null {
  const id = cleanId(annotation?.id)
  if (!id || annotation?.deletedAt) return null
  const meta = isRecord(annotation.meta) ? annotation.meta : isRecord(annotation.metadata) ? annotation.metadata : {}
  const points = parsePoints(meta.points)
  const arcCtrls = parsePoints(meta.arcCtrls)
  const rect = parseRect(annotation.rect)
  const pointIds = parseIds(meta.pointIds)
  const segmentIds = parseIds(meta.segmentIds)
  return {
    id,
    pageNumber: positivePage(annotation.pageNumber),
    label: cleanText(annotation.text || meta.label || meta.shapeKind, 200) || 'Route element',
    ...(cleanText(annotation.text, 200) ? { text: cleanText(annotation.text, 200) } : {}),
    ...(cleanText(annotation.color, 40) ? { color: cleanText(annotation.color, 40) } : {}),
    ...(cleanText(meta.borderColor, 40) ? { borderColor: cleanText(meta.borderColor, 40) } : {}),
    ...(cleanText(meta.shapeKind, 100) ? { shapeKind: cleanText(meta.shapeKind, 100) } : {}),
    ...(rect ? { rect } : {}),
    ...(points ? { points } : {}),
    ...(arcCtrls ? { arcCtrls } : {}),
    ...(pointIds ? { pointIds } : {}),
    ...(segmentIds ? { segmentIds } : {}),
  }
}

function geometryFingerprint(source: EmployeeAnimationGeometrySource): string | null {
  if (
    (source.shapeKind !== 'circuit-path' && source.shapeKind !== 'circuit-arc')
    || !source.points
  ) return null
  return createCircuitGeometryFingerprint({
    annotationId: source.id,
    pageNumber: source.pageNumber,
    shapeKind: source.shapeKind,
    points: source.points,
    arcCtrls: source.arcCtrls,
  })
}

function sanitizeRoles(value: unknown): BlueprintAnimationDeviceRole[] {
  if (!Array.isArray(value)) return []
  return value.filter((role): role is BlueprintAnimationDeviceRole => DEVICE_ROLES.has(role as BlueprintAnimationDeviceRole))
}

function sanitizeChannel(value: unknown): BlueprintAnimationChannelType {
  return CHANNELS.has(value as BlueprintAnimationChannelType) ? value as BlueprintAnimationChannelType : 'generic-route'
}

function parseRect(value: unknown): { x: number; y: number; w: number; h: number } | null {
  if (!isRecord(value)) return null
  const numbers = [value.x, value.y, value.w, value.h].map(Number)
  if (!numbers.every(Number.isFinite) || numbers[2] <= 0 || numbers[3] <= 0) return null
  return { x: numbers[0], y: numbers[1], w: numbers[2], h: numbers[3] }
}

function parsePoints(value: unknown): NormalizedPoint[] | null {
  if (!Array.isArray(value)) return null
  const points = value.map((point) => {
    if (!isRecord(point)) return null
    const x = Number(point.x)
    const y = Number(point.y)
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  })
  return points.length > 0 && points.every(Boolean) ? points as NormalizedPoint[] : null
}

function parseIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const ids = value.map(cleanId)
  return ids.length > 0 && ids.every(Boolean) && new Set(ids).size === ids.length ? ids : null
}

function cleanText(value: unknown, max: number): string {
  return value == null ? '' : String(value).trim().replace(/\s+/g, ' ').slice(0, max)
}

function cleanId(value: unknown): string {
  return cleanText(value, 200)
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function positivePage(value: unknown): number {
  return positiveInteger(value) ?? 1
}

function finitePositive(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function finiteCoordinate(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0
}

function clamp01(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
