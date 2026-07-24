/** Pure route-channel and playback path-state appearance rules. */

import type { BlueprintAnimationChannelType } from './types'

export type PlaybackPathState = 'not-yet' | 'dim-pulsing' | 'solid'

export const PLAYBACK_PATH_NOT_YET_OPACITY = 0.14
export const PLAYBACK_PATH_PULSE_OPACITIES = [0.18, 0.38, 0.18] as const
export const PLAYBACK_PATH_PULSE_DURATION_MS = 1_200
export const PLAYBACK_PATH_SOLID_OPACITY = 0.9
export const PLAYBACK_PATH_STROKE_WIDTH = 6
export const DEFAULT_AUTHORED_CIRCUIT_COLOR = '#facc15'

const CHANNEL_COLORS: Record<BlueprintAnimationChannelType, string> = {
  'switched-line-voltage': '#facc15',
  'constant-line-voltage': '#fb923c',
  'zero-to-ten-volt-control': '#a78bfa',
  'low-voltage-control-signal': '#38bdf8',
  'emergency-power': '#f43f5e',
  'generic-route': '#22d3ee',
}

/**
 * Cyan feed from the source switch/device to the first routed point (Role A — source connector).
 * The app already uses this cyan for the generic route color and the playback orb, so it is not a
 * new invented color. Every routed edge past this connector shares one continuous default route color.
 */
export const BLUEPRINT_ROUTE_SOURCE_CONNECTOR_COLOR = '#22d3ee'

export function resolvePlaybackChannelColor(channel: string | null | undefined): string {
  return CHANNEL_COLORS[channel as BlueprintAnimationChannelType] ?? CHANNEL_COLORS['generic-route']
}

/**
 * The one continuous default route color for the routed circuit (Role B — every edge past the source
 * connector, primary and branch alike). Routed edges are authored as `generic-route`, so the existing
 * default is that channel's color; nothing new is invented and no saved channel is read per-edge.
 */
export function resolveDefaultRouteColor(): string {
  return CHANNEL_COLORS['generic-route']
}

export type BlueprintAnimationRouteEdgeRole = 'source-connector' | 'route'

/**
 * Pure structural role for one saved route edge, for appearance only. The single edge leaving the
 * source node is the source connector; every other edge — including the branch-origin split — is a
 * routed edge. Identity is the stable edge id, so forward and reverse traversal agree.
 */
export function resolveAnimationRouteEdgeRole(
  edgeId: string | null | undefined,
  sourceConnectorEdgeId: string | null | undefined,
): BlueprintAnimationRouteEdgeRole {
  return !!edgeId && !!sourceConnectorEdgeId && edgeId === sourceConnectorEdgeId ? 'source-connector' : 'route'
}

/**
 * Structurally identifies the source-connector edge: the primary-route edge leaving the source node.
 * When the source also forks a branch, the branch order's primary continuation (its first outgoing
 * edge) is the connector; otherwise the source has exactly one outgoing edge. Never by coordinate,
 * array position, or a hardcoded index — and the returned edge id is stable across playback direction.
 */
export function resolveSourceConnectorEdgeId(scene: {
  sources: ReadonlyArray<{ nodeId: string }>
  edges: ReadonlyArray<{ id: string; fromNodeId: string; toNodeId: string }>
  branchOrders: ReadonlyArray<{ nodeId: string; outgoingEdgeIds: string[] }>
}): string | undefined {
  const sourceNodeId = scene.sources[0]?.nodeId
  if (!sourceNodeId) return undefined
  const outgoingFromSource = scene.edges.filter(
    (edge) => edge.fromNodeId === sourceNodeId && edge.toNodeId !== sourceNodeId,
  )
  if (outgoingFromSource.length === 1) return outgoingFromSource[0].id
  if (outgoingFromSource.length === 0) return undefined
  // The source is also a branch origin: its primary continuation (branch order's first outgoing edge)
  // is the source connector; the alternate outgoing edge is a routed branch edge.
  const branchAtSource = scene.branchOrders.find((order) => order.nodeId === sourceNodeId)
  const primaryEdgeId = branchAtSource?.outgoingEdgeIds[0]
  if (primaryEdgeId && outgoingFromSource.some((edge) => edge.id === primaryEdgeId)) return primaryEdgeId
  // A malformed/ambiguous source fan-out has no safe structural connector. Never let saved edge-array
  // order choose a physical segment merely for appearance.
  return undefined
}

/**
 * Resolves the stroke color for one playback/resting route edge from its structural role. The source
 * connector is cyan; every routed edge — primary, branch split, terminal branch, rejoin — is the one
 * continuous default route color. No branch accent and no per-edge channel-derived difference.
 */
export function resolvePlaybackEdgeStrokeColor(options: { role: BlueprintAnimationRouteEdgeRole }): string {
  return options.role === 'source-connector' ? BLUEPRINT_ROUTE_SOURCE_CONNECTOR_COLOR : resolveDefaultRouteColor()
}

export interface RouteAppearanceAnnotation {
  id: string
  color?: string
  borderColor?: string
}

export interface RouteAppearanceEdge {
  id: string
  fromNodeId: string
  toNodeId: string
  geometry: {
    kind: 'circuit-segment' | 'direct'
    annotationId?: string
  }
}

export interface RouteAppearanceScene {
  edges: ReadonlyArray<RouteAppearanceEdge>
  manualTraversal?: ReadonlyArray<{ edgeId: string }>
  branchOrders?: ReadonlyArray<{ nodeId: string; outgoingEdgeIds: string[] }>
}

export interface PlaybackRouteEdgeAppearance {
  baseColor: string
  overlayColor: string
}

export function resolveAuthoredCircuitColor(
  annotation: RouteAppearanceAnnotation | undefined,
  fallback = DEFAULT_AUTHORED_CIRCUIT_COLOR,
): string {
  const borderColor = String(annotation?.borderColor || '').trim()
  if (borderColor) return borderColor
  const color = String(annotation?.color || '').trim()
  return color || fallback
}

export function resolvePlaybackGlowColor(baseColor: string): string {
  return String(baseColor || '').trim() || DEFAULT_AUTHORED_CIRCUIT_COLOR
}

export function resolvePlaybackOrbColor(
  appearance: PlaybackRouteEdgeAppearance | undefined,
  fallback = DEFAULT_AUTHORED_CIRCUIT_COLOR,
): string {
  return resolvePlaybackGlowColor(appearance?.overlayColor || appearance?.baseColor || fallback)
}

export function buildPlaybackRouteEdgeAppearanceMap(
  scene: RouteAppearanceScene,
  annotations: readonly RouteAppearanceAnnotation[],
): Map<string, PlaybackRouteEdgeAppearance> {
  const annotationById = new Map(annotations.map((annotation) => [annotation.id, annotation]))
  const appearances = new Map<string, PlaybackRouteEdgeAppearance>()
  const setEdgeColor = (edgeId: string, color: string) => {
    appearances.set(edgeId, { baseColor: color, overlayColor: resolvePlaybackGlowColor(color) })
  }

  scene.edges.forEach((edge) => {
    if (edge.geometry.kind !== 'circuit-segment') return
    setEdgeColor(edge.id, resolveAuthoredCircuitColor(annotationById.get(edge.geometry.annotationId || '')))
  })

  const traversalEdgeIds = (scene.manualTraversal ?? []).map((step) => step.edgeId)
  const edgeById = new Map(scene.edges.map((edge) => [edge.id, edge]))
  const branchRankByNode = new Map(
    (scene.branchOrders ?? []).map((order) => [
      order.nodeId,
      new Map(order.outgoingEdgeIds.map((edgeId, index) => [edgeId, index])),
    ]),
  )
  const edgeRank = (nodeId: string, edgeId: string): number => branchRankByNode.get(nodeId)?.get(edgeId) ?? Number.MAX_SAFE_INTEGER
  const stableEdgeSort = (nodeId: string) => (left: RouteAppearanceEdge, right: RouteAppearanceEdge) => (
    edgeRank(nodeId, left.id) - edgeRank(nodeId, right.id)
    || left.id.localeCompare(right.id)
  )
  const outgoingByNode = new Map<string, RouteAppearanceEdge[]>()
  const incomingByNode = new Map<string, RouteAppearanceEdge[]>()
  scene.edges.forEach((edge) => {
    outgoingByNode.set(edge.fromNodeId, [...(outgoingByNode.get(edge.fromNodeId) ?? []), edge])
    incomingByNode.set(edge.toNodeId, [...(incomingByNode.get(edge.toNodeId) ?? []), edge])
  })
  outgoingByNode.forEach((edges, nodeId) => edges.sort(stableEdgeSort(nodeId)))
  incomingByNode.forEach((edges, nodeId) => edges.sort(stableEdgeSort(nodeId)))

  const sharesNode = (left: RouteAppearanceEdge | undefined, right: RouteAppearanceEdge | undefined): boolean => (
    !!left && !!right
    && (left.fromNodeId === right.fromNodeId
      || left.fromNodeId === right.toNodeId
      || left.toNodeId === right.fromNodeId
      || left.toNodeId === right.toNodeId)
  )
  const tryInheritFromTraversalNeighbor = (edge: RouteAppearanceEdge): string | undefined => {
    const indexes = traversalEdgeIds
      .map((edgeId, index) => (edgeId === edge.id ? index : -1))
      .filter((index) => index >= 0)
    for (const index of indexes) {
      for (const neighborIndex of [index + 1, index - 1]) {
        const neighborEdge = edgeById.get(traversalEdgeIds[neighborIndex] || '')
        const neighborColor = neighborEdge && sharesNode(edge, neighborEdge) ? appearances.get(neighborEdge.id)?.baseColor : undefined
        if (neighborColor) return neighborColor
      }
    }
    for (const index of indexes) {
      for (let offset = 2; offset < traversalEdgeIds.length; offset += 1) {
        for (const neighborIndex of [index + offset, index - offset]) {
          const neighborEdge = edgeById.get(traversalEdgeIds[neighborIndex] || '')
          const neighborColor = neighborEdge && sharesNode(edge, neighborEdge) ? appearances.get(neighborEdge.id)?.baseColor : undefined
          if (neighborColor) return neighborColor
        }
      }
    }
    return undefined
  }

  const firstCircuitColorFromNode = (
    startNodeId: string,
    blockedEdgeId: string,
    firstDirection: 'outgoing' | 'incoming',
  ): string | undefined => {
    const pending = [startNodeId]
    const visitedNodes = new Set<string>()
    const visitedEdges = new Set([blockedEdgeId])
    while (pending.length > 0) {
      const nodeId = pending.shift() as string
      if (visitedNodes.has(nodeId)) continue
      visitedNodes.add(nodeId)
      const first = firstDirection === 'outgoing' ? outgoingByNode.get(nodeId) ?? [] : incomingByNode.get(nodeId) ?? []
      const second = firstDirection === 'outgoing' ? incomingByNode.get(nodeId) ?? [] : outgoingByNode.get(nodeId) ?? []
      for (const nextEdge of [...first, ...second]) {
        if (visitedEdges.has(nextEdge.id)) continue
        visitedEdges.add(nextEdge.id)
        const color = appearances.get(nextEdge.id)?.baseColor
        if (color) return color
        pending.push(nextEdge.fromNodeId === nodeId ? nextEdge.toNodeId : nextEdge.fromNodeId)
      }
    }
    return undefined
  }
  const tryInheritFromGraphStructure = (edge: RouteAppearanceEdge): string | undefined => {
    const directlyConnected = [
      ...(outgoingByNode.get(edge.toNodeId) ?? []),
      ...(incomingByNode.get(edge.fromNodeId) ?? []),
      ...(outgoingByNode.get(edge.fromNodeId) ?? []),
      ...(incomingByNode.get(edge.toNodeId) ?? []),
    ].filter((candidate, index, list) => candidate.id !== edge.id && list.findIndex((item) => item.id === candidate.id) === index)
    const directCircuit = directlyConnected
      .filter((candidate) => appearances.has(candidate.id))
      .sort((left, right) => left.id.localeCompare(right.id))[0]
    if (directCircuit) return appearances.get(directCircuit.id)?.baseColor
    return firstCircuitColorFromNode(edge.toNodeId, edge.id, 'outgoing')
      ?? firstCircuitColorFromNode(edge.fromNodeId, edge.id, 'incoming')
      ?? firstCircuitColorFromNode(edge.fromNodeId, edge.id, 'outgoing')
      ?? firstCircuitColorFromNode(edge.toNodeId, edge.id, 'incoming')
  }

  for (let pass = 0; pass < scene.edges.length; pass += 1) {
    let changed = false
    ;[...scene.edges].sort((left, right) => left.id.localeCompare(right.id)).forEach((edge) => {
      if (appearances.has(edge.id)) return
      const inherited = tryInheritFromTraversalNeighbor(edge) ?? tryInheritFromGraphStructure(edge)
      if (!inherited) return
      setEdgeColor(edge.id, inherited)
      changed = true
    })
    if (!changed) break
  }

  scene.edges.forEach((edge) => {
    if (!appearances.has(edge.id)) setEdgeColor(edge.id, DEFAULT_AUTHORED_CIRCUIT_COLOR)
  })

  return appearances
}

export interface CircuitSegmentRouteAppearanceAssignment {
  annotationId: string
  segmentId: string
  role: BlueprintAnimationRouteEdgeRole
}

/**
 * Produces the transient saved-route overlay while preserving the prior cross-scene conflict rule:
 * if one physical segment has incompatible route roles, omit its override and retain its annotation
 * appearance. Matching assignments are deduplicated.
 */
export function buildCircuitSegmentRouteAppearanceColorMap(
  assignments: readonly CircuitSegmentRouteAppearanceAssignment[],
): Map<string, string> {
  const colors = new Map<string, string>()
  const roles = new Map<string, BlueprintAnimationRouteEdgeRole>()
  const conflicts = new Set<string>()
  assignments.forEach((assignment) => {
    const annotationId = String(assignment.annotationId || '').trim()
    const segmentId = String(assignment.segmentId || '').trim()
    if (!annotationId || !segmentId) return
    const key = circuitSegmentChannelKey(annotationId, segmentId)
    if (conflicts.has(key)) return
    const previous = roles.get(key)
    if (previous && previous !== assignment.role) {
      roles.delete(key)
      colors.delete(key)
      conflicts.add(key)
      return
    }
    roles.set(key, assignment.role)
    colors.set(key, resolvePlaybackEdgeStrokeColor({ role: assignment.role }))
  })
  return colors
}

export function resolvePlaybackPathState(options: {
  elapsedMs: number
  travelStartMs: number
  travelEndMs: number
  reducedMotion?: boolean
}): PlaybackPathState {
  const elapsedMs = Math.max(0, Number.isFinite(options.elapsedMs) ? options.elapsedMs : 0)
  const travelStartMs = Math.max(0, Number.isFinite(options.travelStartMs) ? options.travelStartMs : 0)
  const travelEndMs = Math.max(travelStartMs, Number.isFinite(options.travelEndMs) ? options.travelEndMs : travelStartMs)
  if (elapsedMs < travelStartMs) return 'not-yet'
  if (options.reducedMotion || travelEndMs <= travelStartMs || elapsedMs >= travelEndMs) return 'solid'
  return 'dim-pulsing'
}

export function circuitSegmentChannelKey(annotationId: string, segmentId: string): string {
  return `${annotationId}:${segmentId}`
}

export interface CircuitSegmentChannelAssignment {
  annotationId: string
  segmentId: string
  channel: BlueprintAnimationChannelType
}

/**
 * Produces transient canvas colors. Conflicting assignments are deliberately omitted so the
 * annotation renderer falls back to its saved color instead of picking a misleading winner.
 */
export function buildCircuitSegmentChannelColorMap(
  assignments: readonly CircuitSegmentChannelAssignment[],
): Map<string, string> {
  const colors = new Map<string, string>()
  const channels = new Map<string, BlueprintAnimationChannelType>()
  const conflicts = new Set<string>()
  assignments.forEach((assignment) => {
    const annotationId = String(assignment.annotationId || '').trim()
    const segmentId = String(assignment.segmentId || '').trim()
    if (!annotationId || !segmentId) return
    const key = circuitSegmentChannelKey(annotationId, segmentId)
    if (conflicts.has(key)) return
    const previous = channels.get(key)
    if (previous && previous !== assignment.channel) {
      channels.delete(key)
      colors.delete(key)
      conflicts.add(key)
      return
    }
    channels.set(key, assignment.channel)
    colors.set(key, resolvePlaybackChannelColor(assignment.channel))
  })
  return colors
}
