/** Pure route-channel and playback path-state appearance rules. */

import type { BlueprintAnimationChannelType } from './types'

export type PlaybackPathState = 'not-yet' | 'dim-pulsing' | 'solid'

export const PLAYBACK_PATH_NOT_YET_OPACITY = 0.14
export const PLAYBACK_PATH_PULSE_OPACITIES = [0.18, 0.38, 0.18] as const
export const PLAYBACK_PATH_PULSE_DURATION_MS = 1_200
export const PLAYBACK_PATH_SOLID_OPACITY = 0.9
export const PLAYBACK_PATH_STROKE_WIDTH = 6

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
