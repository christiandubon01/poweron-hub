import { validateBlueprintAnimationScene, type BlueprintAnimationValidationIssue } from './graphValidation'
import {
  createCircuitGeometryFingerprint,
  resolveCircuitSegmentIndex,
  type CircuitShapeKind,
  type NormalizedPoint,
} from './routeGeometry'
import {
  createDefaultBlueprintAnimationScene,
  parseBlueprintAnimationScene,
} from './sceneSchema'
import type {
  BlueprintAnimationChannelType,
  BlueprintAnimationBranchMode,
  BlueprintAnimationBranchOrder,
  BlueprintAnimationDeviceRole,
  BlueprintAnimationEdge,
  BlueprintAnimationNode,
  BlueprintAnimationPlaybackOptions,
  BlueprintAnimationTraversalStep,
  BlueprintScopeAnimationScene,
  BlueprintScopeAnimationSceneV1,
} from './types'
import type { RouteSegmentPick } from './routePicking'

export const ROUTE_BUILDER_SOURCE_KINDS = [
  'electrical-switch',
  'electrical-switch-3way',
  'electrical-switch-4way',
  'electrical-dimmer',
  'electrical-timer-control',
  'electrical-photocell',
  'electrical-ceiling-occupancy-sensor',
  'electrical-wall-occupancy-sensor',
  'electrical-panel',
] as const

export const ROUTE_BUILDER_SENSOR_KINDS = [
  'electrical-ceiling-occupancy-sensor',
  'electrical-wall-occupancy-sensor',
] as const

export const ROUTE_BUILDER_LOAD_KINDS = [
  'can-light-4',
  'can-light-6',
  'electrical-gfci',
  'electrical-receptacle',
  'electrical-receptacle-240v',
  'electrical-recessed-light',
  'electrical-pendant-light',
  'electrical-sconce',
  'electrical-led-panel-2x2',
  'electrical-led-panel-2x4',
] as const

export const ROUTE_BUILDER_CHANNEL_OPTIONS: Array<{ value: BlueprintAnimationChannelType; label: string }> = [
  { value: 'generic-route', label: 'Generic Route' },
  { value: 'switched-line-voltage', label: 'Switched Power' },
  { value: 'constant-line-voltage', label: 'Constant Power' },
  { value: 'zero-to-ten-volt-control', label: '0–10V Control' },
  { value: 'low-voltage-control-signal', label: 'Sensor Signal' },
  { value: 'emergency-power', label: 'Emergency Power' },
]

const SOURCE_KINDS = new Set<string>(ROUTE_BUILDER_SOURCE_KINDS)
const SENSOR_KINDS = new Set<string>(ROUTE_BUILDER_SENSOR_KINDS)
const LOAD_KINDS = new Set<string>(ROUTE_BUILDER_LOAD_KINDS)
const CIRCUIT_KINDS = new Set<string>(['circuit-path', 'circuit-arc'])
const CONNECTION_TOLERANCE = 0.02
const DEVICE_MATCH_TOLERANCE = 0.014

export interface RouteBuilderAnnotation {
  id: string
  pageNumber: number
  label: string
  text?: string
  color?: string
  borderColor?: string
  shapeKind?: string
  rect?: { x: number; y: number; w: number; h: number }
  points?: NormalizedPoint[]
  arcCtrls?: NormalizedPoint[]
  pointIds?: string[]
  segmentIds?: string[]
}

export interface RouteBuilderIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  selectionId?: string
}

export interface RouteBuilderSourceSelection {
  annotationId: string
  channel: BlueprintAnimationChannelType
}

export interface RouteBuilderSegmentSelection extends Omit<RouteSegmentPick, 'distancePx'> {
  id: string
  kind: 'segment'
  channel: BlueprintAnimationChannelType
  persistedEdgeId?: string
  persistedTraversalId?: string
  rejoinNodeId?: string
}

export interface RouteBuilderDirectSelection {
  id: string
  kind: 'direct'
  annotationId: string
  channel: BlueprintAnimationChannelType
  persistedEdgeId?: string
  persistedTraversalId?: string
  rejoinNodeId?: string
}

export type RouteBuilderTransition = RouteBuilderSegmentSelection | RouteBuilderDirectSelection

export interface RouteBuilderBranchDraft {
  id: string
  originSelectionId: 'source' | string
  mode: BlueprintAnimationBranchMode
  transitions: RouteBuilderTransition[]
  editing: boolean
  persistedBranchOrderId?: string
  persistedAlternateEdgeIds?: string[]
  editBaselineTransitions?: RouteBuilderTransition[]
}

export interface PackageAnimationRouteDraft {
  packageId: string
  packageName: string
  packageAnnotationIds: string[]
  annotations: RouteBuilderAnnotation[]
  expectedBaseRevision: number
  sceneId: string
  createdAt: string
  playbackOptions: BlueprintAnimationPlaybackOptions
  baseScene?: BlueprintScopeAnimationSceneV1
  sourceId: string
  sourcePriority?: number
  source?: RouteBuilderSourceSelection
  transitions: RouteBuilderTransition[]
  branches: RouteBuilderBranchDraft[]
  activeBranchId: string | null
  readOnlyReason?: string
  malformedSceneReason?: string
  dirty: boolean
  notice?: RouteBuilderIssue
}

interface ResolvedNode extends BlueprintAnimationNode {
  point: NormalizedPoint
  pageNumber: number
}

export interface ResolvedRouteTransition {
  selection: RouteBuilderTransition
  edge?: BlueprintAnimationEdge
  from?: ResolvedNode
  to?: ResolvedNode
}

export interface ResolvedPackageAnimationRouteDraft {
  nodes: ResolvedNode[]
  edges: BlueprintAnimationEdge[]
  traversal: BlueprintAnimationTraversalStep[]
  transitions: ResolvedRouteTransition[]
  branchTransitions: ResolvedRouteTransition[]
  branchResolutions: ResolvedPackageAnimationRouteBranch[]
  branchOriginNodeId?: string
  /** Set only when the alternate branch rejoins a later primary-route node (completion kind: rejoin). */
  branchConvergenceNodeId?: string
  /** Set only when the alternate branch ends at an eligible fixture/device (completion kind: terminal). */
  branchTerminalNodeId?: string
  issues: RouteBuilderIssue[]
  currentEndpoint?: { node: ResolvedNode; point: NormalizedPoint }
}

export interface ResolvedPackageAnimationRouteBranch {
  branchId: string
  originSelectionId: 'source' | string
  mode: BlueprintAnimationBranchMode
  transitions: ResolvedRouteTransition[]
  originNodeId?: string
  convergenceNodeId?: string
  terminalNodeId?: string
  endpoint?: ResolvedNode
}

export interface RouteBuilderMutationResult {
  accepted: boolean
  draft: PackageAnimationRouteDraft
  message?: string
}

export type PackageAnimationRoutePickAction =
  | { kind: 'segment'; pick: RouteSegmentPick }
  | { kind: 'annotation'; annotationId: string; clickedPoint?: NormalizedPoint; allowPrimaryDirectTransition?: boolean }
  | { kind: 'rejoin-node'; nodeId: string; clickedPoint?: NormalizedPoint }

export interface PackageAnimationRoutePickResult extends RouteBuilderMutationResult {
  consumed: true
  mode: 'alternate-branch' | 'primary-route'
  category: 'accepted' | 'rejected' | 'direct-confirmation-required'
  branchActive: boolean
  rejoinDiagnostics?: PackageAnimationBranchRejoinDiagnostics
}

export interface RouteBuilderSceneSummary {
  state: 'absent' | 'supported' | 'unsupported' | 'malformed'
  sourceCount: number
  routeStepCount: number
  valid: boolean
  advanced: boolean
  message?: string
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function id(prefix: string): string {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function activeBranch(draft: PackageAnimationRouteDraft): RouteBuilderBranchDraft | undefined {
  return draft.activeBranchId ? draft.branches.find((branch) => branch.id === draft.activeBranchId) : undefined
}

function hasEditingBranch(draft: PackageAnimationRouteDraft): boolean {
  return draft.branches.some((branch) => branch.editing)
}

function updateBranch(
  draft: PackageAnimationRouteDraft,
  branchId: string,
  updater: (branch: RouteBuilderBranchDraft) => RouteBuilderBranchDraft,
): PackageAnimationRouteDraft {
  return {
    ...draft,
    branches: draft.branches.map((branch) => branch.id === branchId ? updater(branch) : branch),
  }
}

function normalizeDraftBranches(draft: PackageAnimationRouteDraft & { branch?: RouteBuilderBranchDraft }): PackageAnimationRouteDraft {
  const legacyBranch = draft.branch
  const branches = Array.isArray(draft.branches)
    ? draft.branches
    : legacyBranch
      ? [{ ...legacyBranch, id: legacyBranch.id || id('route_branch') }]
      : []
  const activeBranchId = draft.activeBranchId ?? branches.find((branch) => branch.editing)?.id ?? null
  const { branch: _legacyBranch, ...rest } = draft
  return {
    ...rest,
    branches,
    activeBranchId: activeBranchId && branches.some((branch) => branch.id === activeBranchId) ? activeBranchId : null,
  }
}

function center(annotation: RouteBuilderAnnotation): NormalizedPoint | null {
  const rect = annotation.rect
  if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return null
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

function distance(a: NormalizedPoint, b: NormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function annotationNodeId(draft: PackageAnimationRouteDraft, annotationId: string): string {
  const persisted = draft.baseScene?.nodes.find((node) => node.anchor.kind === 'annotation-center' && node.anchor.annotationId === annotationId)
  if (persisted) return persisted.id
  return `animation_node_annotation_${annotationId}`
}

function junctionNodeId(draft: PackageAnimationRouteDraft, annotationId: string, pointId: string): string {
  const persisted = draft.baseScene?.nodes.find((node) => node.anchor.kind === 'circuit-point' && node.anchor.annotationId === annotationId && node.anchor.pointId === pointId)
  if (persisted) return persisted.id
  return `animation_node_point_${annotationId}_${pointId}`
}

function isCircuitShapeKind(value: unknown): value is CircuitShapeKind {
  return value === 'circuit-path' || value === 'circuit-arc'
}

export function isRouteBuilderSourceKind(shapeKind: unknown): boolean {
  return typeof shapeKind === 'string' && SOURCE_KINDS.has(shapeKind)
}

export function isRouteBuilderLoadKind(shapeKind: unknown): boolean {
  return typeof shapeKind === 'string' && LOAD_KINDS.has(shapeKind)
}

export function isRouteBuilderDeviceKind(shapeKind: unknown): boolean {
  return isRouteBuilderSourceKind(shapeKind) || isRouteBuilderLoadKind(shapeKind)
}

export function inferRouteBuilderNodeRoles(
  shapeKind: unknown,
  options: { selectedAsSource?: boolean; junction?: boolean } = {},
): BlueprintAnimationDeviceRole[] {
  if (options.junction) return ['junction']
  if (options.selectedAsSource && shapeKind === 'electrical-panel') return ['source']
  if (shapeKind === 'electrical-panel') return []
  const roles: BlueprintAnimationDeviceRole[] = []
  if (options.selectedAsSource) roles.push('source')
  if (typeof shapeKind === 'string' && SENSOR_KINDS.has(shapeKind)) roles.push('sensor', 'control')
  else if (typeof shapeKind === 'string' && SOURCE_KINDS.has(shapeKind)) roles.push('control')
  if (typeof shapeKind === 'string' && LOAD_KINDS.has(shapeKind)) roles.push('load')
  return [...new Set(roles)]
}

export function inferRouteBuilderDefaultChannel(shapeKind: unknown): BlueprintAnimationChannelType {
  if (shapeKind === 'electrical-panel') return 'constant-line-voltage'
  if (typeof shapeKind === 'string' && SENSOR_KINDS.has(shapeKind)) return 'low-voltage-control-signal'
  if (typeof shapeKind === 'string' && SOURCE_KINDS.has(shapeKind)) return 'switched-line-voltage'
  return 'generic-route'
}

function issue(
  severity: RouteBuilderIssue['severity'],
  code: string,
  message: string,
  selectionId?: string,
): RouteBuilderIssue {
  return { severity, code, message, ...(selectionId ? { selectionId } : {}) }
}

function packageHas(draft: PackageAnimationRouteDraft, annotationId: string): boolean {
  return draft.packageAnnotationIds.includes(annotationId)
}

function byId(draft: PackageAnimationRouteDraft): Map<string, RouteBuilderAnnotation> {
  return new Map(draft.annotations.map((annotation) => [annotation.id, annotation]))
}

function annotationNode(draft: PackageAnimationRouteDraft, annotation: RouteBuilderAnnotation, selectedAsSource = false): ResolvedNode | null {
  const point = center(annotation)
  if (!point) return null
  const persisted = draft.baseScene?.nodes.find((node) => node.anchor.kind === 'annotation-center' && node.anchor.annotationId === annotation.id)
  return {
    ...persisted,
    id: annotationNodeId(draft, annotation.id),
    roles: inferRouteBuilderNodeRoles(annotation.shapeKind, { selectedAsSource }),
    anchor: { kind: 'annotation-center', annotationId: annotation.id },
    label: annotation.label,
    point,
    pageNumber: annotation.pageNumber,
  }
}

/**
 * A terminal branch may end at any eligible fixture/device — a node anchored to a real package
 * device annotation. Bare wire junctions (circuit-point anchors) are never valid terminal endpoints.
 */
function isEligibleTerminalNode(node: ResolvedNode): boolean {
  return node.anchor.kind === 'annotation-center'
    && (node.roles.includes('load') || node.roles.includes('source') || node.roles.includes('sensor') || node.roles.includes('control'))
}

function resolvePackageAnimationBranch(
  draft: PackageAnimationRouteDraft,
  branch: RouteBuilderBranchDraft,
  annotations: Map<string, RouteBuilderAnnotation>,
  nodes: ResolvedNode[],
  resolvedTransitions: ResolvedRouteTransition[],
  issues: RouteBuilderIssue[],
  usedSegmentKeys: Set<string>,
  edges: BlueprintAnimationEdge[],
  traversal: BlueprintAnimationTraversalStep[],
): {
  branchTransitions: ResolvedRouteTransition[]
  branchOriginNodeId?: string
  branchConvergenceNodeId?: string
  branchTerminalNodeId?: string
  branchEndpoint?: ResolvedNode
} {
  const branchTransitions: ResolvedRouteTransition[] = []
  let branchOriginNodeId: string | undefined
  let branchConvergenceNodeId: string | undefined
  let branchTerminalNodeId: string | undefined
  let branchEndpoint: ResolvedNode | undefined
  const primaryNodes: ResolvedNode[] = []
  if (nodes[0]) primaryNodes.push(nodes[0])
  resolvedTransitions.forEach((transition) => {
    if (transition.to && primaryNodes[primaryNodes.length - 1]?.id !== transition.to.id) primaryNodes.push(transition.to)
  })
  const originIndex = branch.originSelectionId === 'source'
    ? 0
    : resolvedTransitions.findIndex((transition) => transition.selection.id === branch.originSelectionId) + 1
  let branchCurrent = originIndex >= 0 ? primaryNodes[originIndex] : undefined
  branchOriginNodeId = branchCurrent?.id
  const branchVisitedNodeIds = new Set(branchCurrent ? [branchCurrent.id] : [])
  const branchVisitedPoints = branchCurrent ? [branchCurrent.point] : []

  if (!branchCurrent || originIndex >= primaryNodes.length - 1) {
    issues.push(issue('error', 'invalid-branch-origin', 'A branch must start at a primary-route node the route continues past, so the route can split.'))
  }

  for (const selection of branch.transitions) {
      if (!branchCurrent) {
        issues.push(issue('error', 'invalid-branch-traversal', 'This branch step cannot be resolved before a valid branch origin.', selection.id))
        branchTransitions.push({ selection })
        continue
      }
      if (branchConvergenceNodeId) {
        issues.push(issue('error', 'branch-after-convergence', 'The branch has already rejoined the primary route.', selection.id))
        branchTransitions.push({ selection, from: branchCurrent })
        continue
      }

      let destination: ResolvedNode | null = null
      let edgeGeometry: BlueprintAnimationEdge['geometry'] | null = null
      if (selection.kind === 'direct') {
        const target = annotations.get(selection.annotationId)
        if (!target || !packageHas(draft, selection.annotationId) || !isRouteBuilderDeviceKind(target.shapeKind)) {
          issues.push(issue('error', 'invalid-direct-destination', 'The branch direct destination must be a supported package device.', selection.id))
        } else {
          destination = annotationNode(draft, target)
          edgeGeometry = { kind: 'direct' }
          issues.push(issue('warning', 'direct-transition', 'This branch step intentionally jumps without visible circuit geometry.', selection.id))
        }
      } else {
        const segmentKey = `${selection.annotationId}:${selection.segmentId}`
        const annotation = annotations.get(selection.annotationId)
        const geometry = annotation ? geometryForSelection(annotation, selection) : null
        if (usedSegmentKeys.has(segmentKey)) {
          issues.push(issue('error', 'duplicate-segment', 'That exact circuit segment is already used by this route.', selection.id))
        } else if (!annotation || !packageHas(draft, selection.annotationId) || !geometry) {
          issues.push(issue('error', 'missing-segment', 'The referenced branch circuit segment is unavailable.', selection.id))
        } else {
          usedSegmentKeys.add(segmentKey)
          if (!geometry.fingerprintMatches) {
            issues.push(issue('error', 'geometry-fingerprint-mismatch', 'Circuit geometry changed after this branch step was saved. Remove and reselect the segment.', selection.id))
          }
          const startDistance = distance(branchCurrent.point, geometry.start)
          const endDistance = distance(branchCurrent.point, geometry.end)
          const connectsStart = startDistance <= CONNECTION_TOLERANCE
          const connectsEnd = endDistance <= CONNECTION_TOLERANCE
          if (!connectsStart && !connectsEnd) {
            issues.push(issue('error', 'disconnected-segment', 'That segment does not connect to the current branch endpoint.', selection.id))
          } else {
            const reversed = connectsEnd && (!connectsStart || endDistance < startDistance)
            const destinationPoint = reversed ? geometry.start : geometry.end
            const destinationPointId = reversed ? geometry.startPointId : geometry.endPointId
            const destinationPointIndex = reversed ? geometry.index : geometry.index + 1
            const matchedDevice = matchDeviceAtPoint(draft, destinationPoint, annotation.pageNumber)
            destination = matchedDevice ? annotationNode(draft, matchedDevice) : null
            if (!destination) {
              const persisted = draft.baseScene?.nodes.find((node) => node.anchor.kind === 'circuit-point' && node.anchor.annotationId === annotation.id && node.anchor.pointId === destinationPointId)
              destination = {
                ...persisted,
                id: junctionNodeId(draft, annotation.id, destinationPointId),
                roles: inferRouteBuilderNodeRoles(undefined, { junction: true }),
                anchor: { kind: 'circuit-point', annotationId: annotation.id, pointId: destinationPointId, pointIndexHint: destinationPointIndex, geometryFingerprint: selection.geometryFingerprint },
                label: `${annotation.label} point ${destinationPointIndex + 1}`,
                point: { ...destinationPoint },
                pageNumber: annotation.pageNumber,
              }
            }
            edgeGeometry = {
              kind: 'circuit-segment',
              annotationId: annotation.id,
              segmentId: selection.segmentId,
              segmentIndexHint: geometry.index,
              fromT: reversed ? 1 : 0,
              toT: reversed ? 0 : 1,
              geometryFingerprint: selection.geometryFingerprint,
            }
          }
        }
      }

      if (!destination || !edgeGeometry) {
        branchTransitions.push({ selection, from: branchCurrent })
        continue
      }
      let primaryDestinationIndex = primaryNodes.findIndex((node) => node.id === destination?.id)
      if (selection.rejoinNodeId) {
        const explicitIndex = primaryNodes.findIndex((node) => node.id === selection.rejoinNodeId)
        const explicitNode = explicitIndex >= 0 ? primaryNodes[explicitIndex] : undefined
        const explicitDistance = explicitNode ? distance(explicitNode.point, destination.point) : Number.POSITIVE_INFINITY
        if (!explicitNode) {
          issues.push(issue('error', 'missing-rejoin-node', 'The selected primary-route rejoin node is no longer available.', selection.id))
          branchTransitions.push({ selection, from: branchCurrent })
          continue
        }
        if (explicitIndex <= originIndex) {
          issues.push(issue('error', 'branch-cycle', 'A branch may only rejoin a later primary-route node.', selection.id))
          branchTransitions.push({ selection, from: branchCurrent })
          continue
        }
        if (explicitDistance > CONNECTION_TOLERANCE) {
          issues.push(issue('error', 'rejoin-outside-tolerance', `The branch endpoint is ${explicitDistance.toFixed(4)} from the selected primary node; the maximum is ${CONNECTION_TOLERANCE.toFixed(2)}.`, selection.id))
          branchTransitions.push({ selection, from: branchCurrent })
          continue
        }
        destination = explicitNode
        primaryDestinationIndex = explicitIndex
      }
      if (primaryDestinationIndex < 0) {
        let nearestDistance = Number.POSITIVE_INFINITY
        primaryNodes.forEach((node, index) => {
          if (index <= originIndex || node.pageNumber !== destination?.pageNumber) return
          const candidateDistance = distance(node.point, destination.point)
          if (candidateDistance <= CONNECTION_TOLERANCE && candidateDistance < nearestDistance) {
            primaryDestinationIndex = index
            nearestDistance = candidateDistance
          }
        })
        if (primaryDestinationIndex > originIndex) destination = primaryNodes[primaryDestinationIndex]
      }
      if (primaryDestinationIndex >= 0 && primaryDestinationIndex <= originIndex) {
        issues.push(issue('error', 'branch-cycle', 'A branch may only rejoin a later primary-route node.', selection.id))
        branchTransitions.push({ selection, from: branchCurrent })
        continue
      }
      if (primaryDestinationIndex < 0 && (branchVisitedNodeIds.has(destination.id) || branchVisitedPoints.some((point) => distance(point, destination?.point as NormalizedPoint) <= 0.00001))) {
        issues.push(issue('error', 'branch-cycle', 'That branch step returns to an already visited node.', selection.id))
        branchTransitions.push({ selection, from: branchCurrent })
        continue
      }
      const nextNode = pushUniqueNode(nodes, destination)
      const persistedEdge = selection.persistedEdgeId ? draft.baseScene?.edges.find((candidate) => candidate.id === selection.persistedEdgeId) : undefined
      const edge: BlueprintAnimationEdge = {
        ...persistedEdge,
        id: selection.persistedEdgeId || `animation_edge_${selection.id}`,
        fromNodeId: branchCurrent.id,
        toNodeId: nextNode.id,
        channel: selection.channel,
        geometry: edgeGeometry,
      }
      edges.push(edge)
      const persistedTraversal = selection.persistedTraversalId ? draft.baseScene?.manualTraversal.find((candidate) => candidate.id === selection.persistedTraversalId) : undefined
      traversal.push({ ...persistedTraversal, id: selection.persistedTraversalId || `animation_traversal_${selection.id}`, edgeId: edge.id, sourceId: draft.sourceId, direction: 'forward' })
      branchTransitions.push({ selection, edge, from: branchCurrent, to: nextNode })
      branchCurrent = nextNode
      branchEndpoint = nextNode
      if (primaryDestinationIndex > originIndex) branchConvergenceNodeId = nextNode.id
      else {
        branchVisitedNodeIds.add(nextNode.id)
        branchVisitedPoints.push(nextNode.point)
      }
    }
    // Completion is one of two kinds. A rejoin ends on a later primary-route node (branchConvergenceNodeId,
    // set above). Otherwise a terminal parallel branch may end at any eligible fixture/device without ever
    // rejoining the primary route. Only require the endpoint to be a device when every step resolved cleanly;
    // a per-step error already blocks the branch and should not be masked by an endpoint message.
    const allBranchStepsResolved = branchTransitions.length === branch.transitions.length
      && branchTransitions.every((entry) => !!entry.to)
    if (branch.transitions.length === 0) {
      issues.push(issue('error', 'empty-branch', 'Add at least one alternate branch step.'))
    } else if (!branchConvergenceNodeId && allBranchStepsResolved) {
      if (branchEndpoint && isEligibleTerminalNode(branchEndpoint)) {
        branchTerminalNodeId = branchEndpoint.id
      } else {
        issues.push(issue('error', 'invalid-branch-endpoint', 'This branch endpoint is not a valid fixture/device. Continue the alternate route to a fixture, or select a later primary-route node to rejoin.'))
      }
    }

  return {
    branchTransitions,
    ...(branchOriginNodeId ? { branchOriginNodeId } : {}),
    ...(branchConvergenceNodeId ? { branchConvergenceNodeId } : {}),
    ...(branchTerminalNodeId ? { branchTerminalNodeId } : {}),
    ...(branchEndpoint ? { branchEndpoint } : {}),
  }
}

function matchDeviceAtPoint(
  draft: PackageAnimationRouteDraft,
  point: NormalizedPoint,
  pageNumber: number,
): RouteBuilderAnnotation | null {
  let best: RouteBuilderAnnotation | null = null
  let bestDistance = DEVICE_MATCH_TOLERANCE
  for (const annotation of draft.annotations) {
    if (!packageHas(draft, annotation.id) || annotation.pageNumber !== pageNumber) continue
    if (!isRouteBuilderDeviceKind(annotation.shapeKind)) continue
    const annotationCenter = center(annotation)
    if (!annotationCenter) continue
    const nextDistance = distance(point, annotationCenter)
    if (nextDistance <= bestDistance) {
      best = annotation
      bestDistance = nextDistance
    }
  }
  return best
}

function geometryForSelection(
  annotation: RouteBuilderAnnotation,
  selection: RouteBuilderSegmentSelection,
): {
  index: number
  start: NormalizedPoint
  end: NormalizedPoint
  startPointId: string
  endPointId: string
  control?: NormalizedPoint
  fingerprintMatches: boolean
} | null {
  if (!isCircuitShapeKind(annotation.shapeKind) || !Array.isArray(annotation.points)) return null
  const resolution = resolveCircuitSegmentIndex({
    annotationId: annotation.id,
    pageNumber: annotation.pageNumber,
    shapeKind: annotation.shapeKind,
    points: annotation.points,
    arcCtrls: annotation.arcCtrls,
    segmentIds: annotation.segmentIds,
  }, selection.segmentId, selection.segmentIndexHint, selection.geometryFingerprint)
  if (resolution.status !== 'resolved') return null
  const index = resolution.index
  const start = annotation.points[index]
  const end = annotation.points[index + 1]
  const startPointId = annotation.pointIds?.[index]
  const endPointId = annotation.pointIds?.[index + 1]
  if (!start || !end || !startPointId || !endPointId) return null
  const rawControl = annotation.arcCtrls?.[index]
  const control = annotation.shapeKind === 'circuit-arc'
    ? (rawControl && Number.isFinite(rawControl.x) && Number.isFinite(rawControl.y)
        ? rawControl
        : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 })
    : undefined
  return { index, start, end, startPointId, endPointId, control, fingerprintMatches: resolution.fingerprintMatches }
}

function pushUniqueNode(nodes: ResolvedNode[], node: ResolvedNode): ResolvedNode {
  const existing = nodes.find((candidate) => candidate.id === node.id)
  if (existing) return existing
  nodes.push(node)
  return node
}

export function resolvePackageAnimationRouteDraft(draft: PackageAnimationRouteDraft): ResolvedPackageAnimationRouteDraft {
  draft = normalizeDraftBranches(draft as PackageAnimationRouteDraft & { branch?: RouteBuilderBranchDraft })
  const annotations = byId(draft)
  const nodes: ResolvedNode[] = []
  const edges: BlueprintAnimationEdge[] = []
  const traversal: BlueprintAnimationTraversalStep[] = []
  const resolvedTransitions: ResolvedRouteTransition[] = []
  const issues: RouteBuilderIssue[] = []
  const usedSegmentKeys = new Set<string>()
  const visitedNodeIds = new Set<string>()
  const visitedPoints: NormalizedPoint[] = []
  let current: ResolvedNode | undefined

  if (!draft.source) {
    issues.push(issue('error', 'missing-source', 'Select one eligible source device as the source.'))
  } else {
    const sourceAnnotation = annotations.get(draft.source.annotationId)
    if (!sourceAnnotation) {
      issues.push(issue('error', 'missing-source-annotation', 'The selected source annotation no longer exists.'))
    } else if (!packageHas(draft, sourceAnnotation.id)) {
      issues.push(issue('error', 'source-not-in-package', 'The selected source is no longer in this work package.'))
    } else if (!isRouteBuilderSourceKind(sourceAnnotation.shapeKind)) {
      issues.push(issue('error', 'invalid-source-kind', 'The source must be an electrical panel, switch, dimmer, timer, photocell, or occupancy sensor.'))
    } else {
      const sourceNode = annotationNode(draft, sourceAnnotation, true)
      if (!sourceNode) {
        issues.push(issue('error', 'source-anchor-missing', 'The selected source has no usable annotation center.'))
      } else {
        current = pushUniqueNode(nodes, sourceNode)
        visitedNodeIds.add(current.id)
        visitedPoints.push(current.point)
      }
    }
  }

  for (const selection of draft.transitions) {
    if (!current) {
      issues.push(issue('error', 'invalid-traversal', 'This route step cannot be resolved before a valid source.', selection.id))
      resolvedTransitions.push({ selection })
      continue
    }
    if (selection.kind === 'direct') {
      const target = annotations.get(selection.annotationId)
      if (!target) {
        issues.push(issue('error', 'missing-direct-annotation', 'The direct route destination no longer exists.', selection.id))
        resolvedTransitions.push({ selection, from: current })
        continue
      }
      if (!packageHas(draft, target.id)) {
        issues.push(issue('error', 'annotation-not-in-package', 'A direct route destination is not in this work package.', selection.id))
        resolvedTransitions.push({ selection, from: current })
        continue
      }
      if (!isRouteBuilderDeviceKind(target.shapeKind)) {
        issues.push(issue('error', 'invalid-direct-destination', 'Direct transitions may only end at a supported device or fixture.', selection.id))
        resolvedTransitions.push({ selection, from: current })
        continue
      }
      const destination = annotationNode(draft, target)
      if (!destination) {
        issues.push(issue('error', 'direct-anchor-missing', 'The direct route destination has no usable center.', selection.id))
        resolvedTransitions.push({ selection, from: current })
        continue
      }
      if (visitedNodeIds.has(destination.id)) {
        issues.push(issue('error', 'duplicate-load-or-cycle', 'This device is already in the route; selecting it again would create a cycle.', selection.id))
        resolvedTransitions.push({ selection, from: current })
        continue
      }
      const nextNode = pushUniqueNode(nodes, destination)
      const persistedEdge = selection.persistedEdgeId ? draft.baseScene?.edges.find((candidate) => candidate.id === selection.persistedEdgeId) : undefined
      const edge: BlueprintAnimationEdge = {
        ...persistedEdge,
        id: selection.persistedEdgeId || `animation_edge_${selection.id}`,
        fromNodeId: current.id,
        toNodeId: nextNode.id,
        channel: selection.channel,
        geometry: { kind: 'direct' },
      }
      edges.push(edge)
      const persistedTraversal = selection.persistedTraversalId ? draft.baseScene?.manualTraversal.find((candidate) => candidate.id === selection.persistedTraversalId) : undefined
      traversal.push({ ...persistedTraversal, id: selection.persistedTraversalId || `animation_traversal_${selection.id}`, edgeId: edge.id, sourceId: draft.sourceId, direction: 'forward' })
      resolvedTransitions.push({ selection, edge, from: current, to: nextNode })
      issues.push(issue('warning', 'direct-transition', 'This step intentionally jumps without visible circuit geometry.', selection.id))
      current = nextNode
      visitedNodeIds.add(current.id)
      visitedPoints.push(current.point)
      continue
    }

    const segmentKey = `${selection.annotationId}:${selection.segmentId}`
    if (usedSegmentKeys.has(segmentKey)) {
      issues.push(issue('error', 'duplicate-segment', 'That exact circuit segment is already in the route.', selection.id))
      resolvedTransitions.push({ selection, from: current })
      continue
    }
    usedSegmentKeys.add(segmentKey)
    const annotation = annotations.get(selection.annotationId)
    if (!annotation) {
      issues.push(issue('error', 'missing-circuit-annotation', 'The selected circuit annotation no longer exists.', selection.id))
      resolvedTransitions.push({ selection, from: current })
      continue
    }
    if (!packageHas(draft, annotation.id)) {
      issues.push(issue('error', 'annotation-not-in-package', 'A selected circuit segment is not in this work package.', selection.id))
      resolvedTransitions.push({ selection, from: current })
      continue
    }
    const geometry = geometryForSelection(annotation, selection)
    if (!geometry) {
      issues.push(issue('error', 'missing-segment', 'The referenced stable circuit segment no longer exists.', selection.id))
      resolvedTransitions.push({ selection, from: current })
      continue
    }
    if (!geometry.fingerprintMatches) {
      issues.push(issue('error', 'geometry-fingerprint-mismatch', 'Circuit geometry changed after this route step was saved. Remove and reselect the segment.', selection.id))
    }

    const startDistance = distance(current.point, geometry.start)
    const endDistance = distance(current.point, geometry.end)
    const connectsStart = startDistance <= CONNECTION_TOLERANCE
    const connectsEnd = endDistance <= CONNECTION_TOLERANCE
    if (!connectsStart && !connectsEnd) {
      issues.push(issue('error', 'disconnected-segment', 'That segment does not connect to the current route endpoint.', selection.id))
      resolvedTransitions.push({ selection, from: current })
      continue
    }
    const reversed = connectsEnd && (!connectsStart || endDistance < startDistance)
    const destinationPoint = reversed ? geometry.start : geometry.end
    const destinationPointId = reversed ? geometry.startPointId : geometry.endPointId
    const destinationPointIndex = reversed ? geometry.index : geometry.index + 1
    const matchedDevice = matchDeviceAtPoint(draft, destinationPoint, annotation.pageNumber)
    let destination: ResolvedNode | null = matchedDevice ? annotationNode(draft, matchedDevice) : null
    if (!destination) {
      const persisted = draft.baseScene?.nodes.find((node) => node.anchor.kind === 'circuit-point' && node.anchor.annotationId === annotation.id && node.anchor.pointId === destinationPointId)
      destination = {
        ...persisted,
        id: junctionNodeId(draft, annotation.id, destinationPointId),
        roles: inferRouteBuilderNodeRoles(undefined, { junction: true }),
        anchor: {
          kind: 'circuit-point',
          annotationId: annotation.id,
          pointId: destinationPointId,
          pointIndexHint: destinationPointIndex,
          geometryFingerprint: selection.geometryFingerprint,
        },
        label: `${annotation.label} point ${destinationPointIndex + 1}`,
        point: { ...destinationPoint },
        pageNumber: annotation.pageNumber,
      }
    }
    const repeatsPoint = visitedPoints.some((point) => distance(point, destinationPoint) <= 0.00001)
    if (visitedNodeIds.has(destination.id) || repeatsPoint) {
      issues.push(issue('error', 'route-cycle', 'That segment returns to a node already visited and would create a cycle.', selection.id))
      resolvedTransitions.push({ selection, from: current })
      continue
    }
    const nextNode = pushUniqueNode(nodes, destination)
    const persistedEdge = selection.persistedEdgeId ? draft.baseScene?.edges.find((candidate) => candidate.id === selection.persistedEdgeId) : undefined
    const edge: BlueprintAnimationEdge = {
      ...persistedEdge,
      id: selection.persistedEdgeId || `animation_edge_${selection.id}`,
      fromNodeId: current.id,
      toNodeId: nextNode.id,
      channel: selection.channel,
      geometry: {
        kind: 'circuit-segment',
        annotationId: annotation.id,
        segmentId: selection.segmentId,
        segmentIndexHint: geometry.index,
        fromT: reversed ? 1 : 0,
        toT: reversed ? 0 : 1,
        geometryFingerprint: selection.geometryFingerprint,
      },
    }
    edges.push(edge)
    const persistedTraversal = selection.persistedTraversalId ? draft.baseScene?.manualTraversal.find((candidate) => candidate.id === selection.persistedTraversalId) : undefined
    traversal.push({ ...persistedTraversal, id: selection.persistedTraversalId || `animation_traversal_${selection.id}`, edgeId: edge.id, sourceId: draft.sourceId, direction: 'forward' })
    resolvedTransitions.push({ selection, edge, from: current, to: nextNode })
    current = nextNode
    visitedNodeIds.add(current.id)
    visitedPoints.push(destinationPoint)
  }

  const branchResolutions: ResolvedPackageAnimationRouteBranch[] = []
  for (const branch of draft.branches) {
    const branchResolution = resolvePackageAnimationBranch(
      draft,
      branch,
      annotations,
      nodes,
      resolvedTransitions,
      issues,
      usedSegmentKeys,
      edges,
      traversal,
    )
    branchResolutions.push({
      branchId: branch.id,
      originSelectionId: branch.originSelectionId,
      mode: branch.mode,
      transitions: branchResolution.branchTransitions,
      ...(branchResolution.branchOriginNodeId ? { originNodeId: branchResolution.branchOriginNodeId } : {}),
      ...(branchResolution.branchConvergenceNodeId ? { convergenceNodeId: branchResolution.branchConvergenceNodeId } : {}),
      ...(branchResolution.branchTerminalNodeId ? { terminalNodeId: branchResolution.branchTerminalNodeId } : {}),
      ...(branchResolution.branchEndpoint ? { endpoint: branchResolution.branchEndpoint } : {}),
    })
  }
  const branchTransitions = branchResolutions.flatMap((branch) => branch.transitions)
  const currentBranch = activeBranch(draft)
  const activeBranchResolution = currentBranch
    ? branchResolutions.find((branch) => branch.branchId === currentBranch.id)
    : branchResolutions[0]
  const branchOriginNodeId = activeBranchResolution?.originNodeId
  const branchConvergenceNodeId = activeBranchResolution?.convergenceNodeId
  const branchTerminalNodeId = activeBranchResolution?.terminalNodeId
  const branchEndpoint = activeBranchResolution?.endpoint

  return {
    nodes,
    edges,
    traversal,
    transitions: resolvedTransitions,
    branchTransitions,
    branchResolutions,
    issues,
    ...(branchOriginNodeId ? { branchOriginNodeId } : {}),
    ...(branchConvergenceNodeId ? { branchConvergenceNodeId } : {}),
    ...(branchTerminalNodeId ? { branchTerminalNodeId } : {}),
    ...((currentBranch?.editing && branchEndpoint && !branchConvergenceNodeId)
      ? { currentEndpoint: { node: branchEndpoint, point: branchEndpoint.point } }
      : current ? { currentEndpoint: { node: current, point: current.point } } : {}),
  }
}

export function createEmptyPackageAnimationRouteDraft(options: {
  packageId: string
  packageName: string
  packageAnnotationIds: string[]
  annotations: RouteBuilderAnnotation[]
  expectedBaseRevision?: number
  now?: string
  sceneId?: string
}): PackageAnimationRouteDraft {
  const scene = createDefaultBlueprintAnimationScene({ id: options.sceneId, now: options.now })
  return {
    packageId: options.packageId,
    packageName: options.packageName,
    packageAnnotationIds: [...options.packageAnnotationIds],
    annotations: clone(options.annotations),
    expectedBaseRevision: Math.max(0, Math.floor(Number(options.expectedBaseRevision) || 0)),
    sceneId: scene.id,
    createdAt: scene.createdAt,
    playbackOptions: { ...scene.playbackOptions },
    sourceId: 'animation_source_primary',
    transitions: [],
    branches: [],
    activeBranchId: null,
    dirty: false,
  }
}

function withNotice(draft: PackageAnimationRouteDraft, nextIssue?: RouteBuilderIssue): PackageAnimationRouteDraft {
  return { ...draft, notice: nextIssue }
}

export function setRouteBuilderNotice(draft: PackageAnimationRouteDraft, nextIssue?: RouteBuilderIssue): PackageAnimationRouteDraft {
  return withNotice(draft, nextIssue)
}

export function selectPackageAnimationRouteSource(
  draft: PackageAnimationRouteDraft,
  annotationId: string,
): RouteBuilderMutationResult {
  if (draft.readOnlyReason) return { accepted: false, draft, message: draft.readOnlyReason }
  const annotation = byId(draft).get(annotationId)
  if (!annotation) return { accepted: false, draft, message: 'That annotation no longer exists.' }
  if (!packageHas(draft, annotationId)) {
    const message = 'Add this item to the work package before using it in the animation route.'
    return { accepted: false, draft: withNotice(draft, issue('error', 'annotation-not-in-package', message)), message }
  }
  if (!isRouteBuilderSourceKind(annotation.shapeKind)) {
    const message = 'Select an electrical panel, switch, dimmer, timer, photocell, or occupancy sensor as the source.'
    return { accepted: false, draft: withNotice(draft, issue('error', 'invalid-source-kind', message)), message }
  }
  const next: PackageAnimationRouteDraft = {
    ...draft,
    source: { annotationId, channel: inferRouteBuilderDefaultChannel(annotation.shapeKind) },
    transitions: [],
    branches: [],
    activeBranchId: null,
    dirty: true,
    notice: undefined,
  }
  return { accepted: true, draft: next }
}

export function addPackageAnimationRouteSegment(
  draft: PackageAnimationRouteDraft,
  pick: RouteSegmentPick,
): RouteBuilderMutationResult {
  if (draft.readOnlyReason) return { accepted: false, draft, message: draft.readOnlyReason }
  if (!draft.source) {
    const message = 'Select the source before adding circuit segments.'
    return { accepted: false, draft: withNotice(draft, issue('error', 'missing-source', message)), message }
  }
  if (!packageHas(draft, pick.annotationId)) {
    const message = 'Add this item to the work package before using it in the animation route.'
    return { accepted: false, draft: withNotice(draft, issue('error', 'annotation-not-in-package', message)), message }
  }
  const branch = activeBranch(draft)
  const targetTransitions = branch?.editing ? branch.transitions : draft.transitions
  const selection: RouteBuilderSegmentSelection = {
    ...clone(pick),
    id: id('route_segment'),
    kind: 'segment',
    channel: targetTransitions.length === 0 ? draft.source.channel : 'generic-route',
  }
  const candidate: PackageAnimationRouteDraft = branch?.editing
    ? { ...updateBranch(draft, branch.id, (entry) => ({ ...entry, transitions: [...entry.transitions, selection] })), dirty: true, notice: undefined }
    : { ...draft, transitions: [...draft.transitions, selection], dirty: true, notice: undefined }
  const blocking = resolvePackageAnimationRouteDraft(candidate).issues.find((entry) => entry.severity === 'error' && entry.selectionId === selection.id)
  if (blocking) return { accepted: false, draft: withNotice(draft, blocking), message: blocking.message }
  return { accepted: true, draft: candidate }
}

export function addPackageAnimationDirectTransition(
  draft: PackageAnimationRouteDraft,
  annotationId: string,
): RouteBuilderMutationResult {
  if (draft.readOnlyReason) return { accepted: false, draft, message: draft.readOnlyReason }
  if (!draft.source) return { accepted: false, draft, message: 'Select the source first.' }
  const annotation = byId(draft).get(annotationId)
  if (!annotation) return { accepted: false, draft, message: 'That annotation no longer exists.' }
  if (!packageHas(draft, annotationId)) {
    const message = 'Add this item to the work package before using it in the animation route.'
    return { accepted: false, draft: withNotice(draft, issue('error', 'annotation-not-in-package', message)), message }
  }
  if (!isRouteBuilderDeviceKind(annotation.shapeKind)) {
    const message = 'Only supported controls, sensors, and light fixtures can be direct destinations.'
    return { accepted: false, draft: withNotice(draft, issue('error', 'invalid-direct-destination', message)), message }
  }
  const branch = activeBranch(draft)
  const targetTransitions = branch?.editing ? branch.transitions : draft.transitions
  const selection: RouteBuilderDirectSelection = {
    id: id('route_direct'),
    kind: 'direct',
    annotationId,
    channel: targetTransitions.length === 0 ? draft.source.channel : 'generic-route',
  }
  const candidate: PackageAnimationRouteDraft = branch?.editing
    ? { ...updateBranch(draft, branch.id, (entry) => ({ ...entry, transitions: [...entry.transitions, selection] })), dirty: true, notice: undefined }
    : { ...draft, transitions: [...draft.transitions, selection], dirty: true, notice: undefined }
  const blocking = resolvePackageAnimationRouteDraft(candidate).issues.find((entry) => entry.severity === 'error' && entry.selectionId === selection.id)
  if (blocking) return { accepted: false, draft: withNotice(draft, blocking), message: blocking.message }
  return { accepted: true, draft: candidate, message: 'Direct transition added with a warning.' }
}

export interface PackageAnimationPrimaryRouteCandidate {
  nodeId: string
  index: number
  point: NormalizedPoint
  pageNumber: number
  label?: string
  annotationId?: string
}

export interface PackageAnimationBranchRejoinDiagnostics {
  clickedNodeId: string
  clickedAnnotationId?: string
  clickedNormalizedPoint?: NormalizedPoint
  clickedNodePoint?: NormalizedPoint
  branchEndpointId?: string
  branchEndpointPoint?: NormalizedPoint
  originIndex: number
  candidates: Array<PackageAnimationPrimaryRouteCandidate & { distance?: number; later: boolean }>
  selectedNodeId?: string
  rejectionReason?: string
}

function primaryRouteCandidatesFromResolved(resolved: ResolvedPackageAnimationRouteDraft): PackageAnimationPrimaryRouteCandidate[] {
  const primaryNodes: ResolvedNode[] = []
  const source = resolved.transitions[0]?.from || resolved.nodes[0]
  if (source) primaryNodes.push(source)
  resolved.transitions.forEach((transition) => {
    if (transition.to && primaryNodes[primaryNodes.length - 1]?.id !== transition.to.id) primaryNodes.push(transition.to)
  })
  return primaryNodes.map((node, index) => ({
    nodeId: node.id,
    index,
    point: { ...node.point },
    pageNumber: node.pageNumber,
    ...(node.label ? { label: node.label } : {}),
    ...(node.anchor.kind === 'annotation-center' ? { annotationId: node.anchor.annotationId } : {}),
  }))
}

export function getPackageAnimationPrimaryRouteCandidates(draft: PackageAnimationRouteDraft): PackageAnimationPrimaryRouteCandidate[] {
  return primaryRouteCandidatesFromResolved(resolvePackageAnimationRouteDraft(draft))
}

export function tryCompletePackageAnimationRouteBranchAtNode(
  draft: PackageAnimationRouteDraft,
  clickedNodeId: string,
  clickedPoint?: NormalizedPoint,
): RouteBuilderMutationResult & { diagnostics: PackageAnimationBranchRejoinDiagnostics } {
  const branch = activeBranch(draft)
  const resolved = resolvePackageAnimationRouteDraft(draft)
  const candidates = primaryRouteCandidatesFromResolved(resolved)
  const originIndex = branch?.originSelectionId === 'source'
    ? 0
    : resolved.transitions.findIndex((entry) => entry.selection.id === branch?.originSelectionId) + 1
  const activeResolvedBranch = branch ? resolved.branchResolutions.find((entry) => entry.branchId === branch.id) : undefined
  const endpoint = activeResolvedBranch?.transitions[activeResolvedBranch.transitions.length - 1]?.to
  const clicked = candidates.find((candidate) => candidate.nodeId === clickedNodeId)
  const diagnostics: PackageAnimationBranchRejoinDiagnostics = {
    clickedNodeId,
    ...(clicked?.annotationId ? { clickedAnnotationId: clicked.annotationId } : {}),
    ...(clickedPoint ? { clickedNormalizedPoint: { ...clickedPoint } } : {}),
    ...(clicked ? { clickedNodePoint: { ...clicked.point } } : {}),
    ...(endpoint ? { branchEndpointId: endpoint.id, branchEndpointPoint: { ...endpoint.point } } : {}),
    originIndex,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      ...(endpoint ? { distance: distance(endpoint.point, candidate.point) } : {}),
      later: candidate.index > originIndex,
    })),
  }
  const reject = (code: string, message: string) => ({
    accepted: false,
    draft: withNotice(draft, issue('error', code, message)),
    message,
    diagnostics: { ...diagnostics, rejectionReason: message },
  })

  if (!branch?.editing) return reject('branch-not-active', 'Start or resume an alternate branch before selecting a rejoin node.')
  if (!clicked) return reject('missing-rejoin-node', `Primary-route node ${clickedNodeId} is no longer available.`)
  if (clicked.index <= originIndex) return reject('branch-cycle', `Node ${clicked.nodeId} is primary index ${clicked.index}; a rejoin must be later than origin index ${originIndex}.`)
  if (!endpoint || branch.transitions.length === 0) return reject('empty-branch', 'Select at least one alternate segment before choosing a rejoin node.')

  const endpointDistance = distance(endpoint.point, clicked.point)
  if (endpointDistance <= CONNECTION_TOLERANCE) {
    const lastIndex = branch.transitions.length - 1
    const transitions = branch.transitions.map((entry, index) => index === lastIndex ? { ...entry, rejoinNodeId: clicked.nodeId } : entry)
    const candidate = { ...updateBranch(draft, branch.id, (entry) => ({ ...entry, transitions })), dirty: true, notice: undefined }
    if (resolvePackageAnimationRouteDraft(candidate).branchConvergenceNodeId === clicked.nodeId) {
      return { accepted: true, draft: candidate, diagnostics: { ...diagnostics, selectedNodeId: clicked.nodeId } }
    }
  }

  // A clicked primary-route device is an explicit graph edge to that same canonical node. Plain
  // junctions still require physical endpoint equivalence; a visual crossing cannot create one.
  if (clicked.annotationId) {
    const direct = addPackageAnimationDirectTransition(draft, clicked.annotationId)
    if (direct.accepted && resolvePackageAnimationRouteDraft(direct.draft).branchConvergenceNodeId === clicked.nodeId) {
      return { ...direct, diagnostics: { ...diagnostics, selectedNodeId: clicked.nodeId } }
    }
  }
  return reject('rejoin-outside-tolerance', `Branch endpoint ${endpoint.id} is ${endpointDistance.toFixed(4)} from primary node ${clicked.nodeId}; a junction rejoin must be within ${CONNECTION_TOLERANCE.toFixed(2)}.`)
}

/**
 * Routes one viewer pick through exactly one authoring mode. In particular, an active alternate
 * branch owns device and segment picks before any primary-route source/cycle logic can run.
 */
export function dispatchPackageAnimationRoutePick(
  draft: PackageAnimationRouteDraft,
  action: PackageAnimationRoutePickAction,
): PackageAnimationRoutePickResult {
  const branchActive = !!activeBranch(draft)?.editing
  const mode = branchActive ? 'alternate-branch' : 'primary-route'
  let mutation: RouteBuilderMutationResult

  if (action.kind === 'rejoin-node') {
    mutation = tryCompletePackageAnimationRouteBranchAtNode(draft, action.nodeId, action.clickedPoint)
  } else if (action.kind === 'segment') {
    mutation = addPackageAnimationRouteSegment(draft, action.pick)
  } else {
    const annotation = byId(draft).get(action.annotationId)
    if (!packageHas(draft, action.annotationId)) {
      const message = 'Add this item to the work package before using it in the animation route.'
      mutation = { accepted: false, draft: withNotice(draft, issue('error', 'annotation-not-in-package', message)), message }
    } else if (branchActive) {
      if (annotation && isRouteBuilderDeviceKind(annotation.shapeKind)) {
        const matchingPrimaryNode = getPackageAnimationPrimaryRouteCandidates(draft)
          .find((candidate) => candidate.annotationId === action.annotationId)
        mutation = matchingPrimaryNode
          ? tryCompletePackageAnimationRouteBranchAtNode(draft, matchingPrimaryNode.nodeId, action.clickedPoint)
          : addPackageAnimationDirectTransition(draft, action.annotationId)
      } else {
        const message = isCircuitShapeKind(annotation?.shapeKind)
          ? 'Tap closer to an individual branch circuit segment.'
          : 'Select a connected branch segment, a terminal fixture/device, or a later primary-route node to rejoin. The branch remains open.'
        mutation = { accepted: false, draft: withNotice(draft, issue('error', 'invalid-branch-selection', message)), message }
      }
    } else if (!draft.source) {
      mutation = selectPackageAnimationRouteSource(draft, action.annotationId)
    } else if (annotation && isRouteBuilderDeviceKind(annotation.shapeKind)) {
      if (!action.allowPrimaryDirectTransition) {
        const message = 'Confirm the direct transition before adding this device.'
        mutation = { accepted: false, draft, message }
        return { ...mutation, consumed: true, mode, category: 'direct-confirmation-required', branchActive }
      }
      mutation = addPackageAnimationDirectTransition(draft, action.annotationId)
    } else if (annotation && isCircuitShapeKind(annotation.shapeKind)) {
      const message = Array.isArray(annotation.segmentIds)
        ? 'Tap closer to an individual circuit segment.'
        : 'This circuit annotation has no persisted stable segment IDs and cannot be used safely.'
      mutation = { accepted: false, draft: withNotice(draft, issue('error', 'segment-not-hit', message)), message }
    } else {
      const message = 'That annotation is not an eligible route source, circuit segment, control, or light fixture.'
      mutation = { accepted: false, draft: withNotice(draft, issue('error', 'ineligible-route-item', message)), message }
    }
  }

  const rejoinDiagnostics = 'diagnostics' in mutation
    ? mutation.diagnostics as PackageAnimationBranchRejoinDiagnostics
    : undefined
  return {
    ...mutation,
    consumed: true,
    mode,
    category: mutation.accepted ? 'accepted' : 'rejected',
    branchActive: !!activeBranch(mutation.draft)?.editing,
    ...(rejoinDiagnostics ? { rejoinDiagnostics } : {}),
  }
}

export function undoPackageAnimationRouteSelection(draft: PackageAnimationRouteDraft): PackageAnimationRouteDraft {
  if (draft.readOnlyReason) return draft
  const branch = activeBranch(draft)
  if (branch?.editing) {
    if (branch.transitions.length > 0) {
      return { ...updateBranch(draft, branch.id, (entry) => ({ ...entry, transitions: entry.transitions.slice(0, -1) })), dirty: true, notice: undefined }
    }
    return withNotice(draft, issue('warning', 'empty-branch-undo', 'There are no alternate branch steps to undo. Use Cancel Branch to leave alternate-branch mode.'))
  }
  if (draft.transitions.length > 0) {
    return { ...draft, transitions: draft.transitions.slice(0, -1), dirty: true, notice: undefined }
  }
  return { ...draft, source: undefined, branches: [], activeBranchId: null, dirty: true, notice: undefined }
}

export function clearPackageAnimationRouteDraft(draft: PackageAnimationRouteDraft): PackageAnimationRouteDraft {
  if (draft.readOnlyReason) return draft
  return { ...draft, source: undefined, transitions: [], branches: [], activeBranchId: null, dirty: true, notice: undefined }
}

export function startPackageAnimationRouteBranch(
  draft: PackageAnimationRouteDraft,
  originSelectionId: 'source' | string,
): PackageAnimationRouteDraft {
  if (draft.readOnlyReason) return draft
  if (hasEditingBranch(draft)) return withNotice(draft, issue('error', 'branch-edit-active', 'Finish or cancel the active branch before starting another branch.'))
  if (draft.branches.some((branch) => branch.originSelectionId === originSelectionId)) {
    return withNotice(draft, issue('error', 'duplicate-branch-origin', 'That primary-route point already has a branch. Edit or delete the existing branch instead.'))
  }
  const resolved = resolvePackageAnimationRouteDraft(draft)
  const originIndex = originSelectionId === 'source'
    ? 0
    : resolved.transitions.findIndex((transition) => transition.selection.id === originSelectionId) + 1
  const primaryNodes = primaryRouteCandidatesFromResolved(resolved)
  if (originIndex < 0 || originIndex >= primaryNodes.length - 1) {
    return withNotice(draft, issue('error', 'invalid-branch-origin', 'A branch must start at a primary-route point the route continues past.'))
  }
  const branchId = id('route_branch')
  return {
    ...draft,
    branches: [...draft.branches, { id: branchId, originSelectionId, mode: draft.playbackOptions.branchMode, transitions: [], editing: true }],
    activeBranchId: branchId,
    dirty: true,
    notice: undefined,
  }
}

export function finishPackageAnimationRouteBranch(draft: PackageAnimationRouteDraft): PackageAnimationRouteDraft {
  const branch = activeBranch(draft)
  if (!branch) return draft
  const resolved = resolvePackageAnimationRouteDraft(draft)
  const branchResolution = resolved.branchResolutions.find((entry) => entry.branchId === branch.id)
  // A branch may finish two ways: rejoining a later primary node, or terminating at an eligible fixture/device.
  if (!branchResolution?.convergenceNodeId && !branchResolution?.terminalNodeId) return draft
  return {
    ...updateBranch(draft, branch.id, (entry) => ({ ...entry, editing: false, editBaselineTransitions: undefined })),
    activeBranchId: null,
    dirty: true,
    notice: undefined,
  }
}

export function removePackageAnimationRouteBranch(draft: PackageAnimationRouteDraft, branchId = draft.activeBranchId ?? draft.branches[0]?.id): PackageAnimationRouteDraft {
  if (draft.readOnlyReason || !branchId) return draft
  return {
    ...draft,
    branches: draft.branches.filter((branch) => branch.id !== branchId),
    activeBranchId: draft.activeBranchId === branchId ? null : draft.activeBranchId,
    dirty: true,
    notice: undefined,
  }
}

export function cancelPackageAnimationRouteBranch(draft: PackageAnimationRouteDraft): PackageAnimationRouteDraft {
  const branch = activeBranch(draft)
  if (draft.readOnlyReason || !branch) return draft
  if (branch.editBaselineTransitions) {
    return {
      ...updateBranch(draft, branch.id, (entry) => ({
        ...entry,
        transitions: clone(entry.editBaselineTransitions ?? []),
        editBaselineTransitions: undefined,
        editing: false,
      })),
      activeBranchId: null,
      dirty: true,
      notice: undefined,
    }
  }
  return removePackageAnimationRouteBranch(draft, branch.id)
}

export function editPackageAnimationRouteBranch(draft: PackageAnimationRouteDraft, branchId: string): PackageAnimationRouteDraft {
  if (draft.readOnlyReason || hasEditingBranch(draft)) return draft
  const branch = draft.branches.find((entry) => entry.id === branchId)
  if (!branch) return draft
  return {
    ...updateBranch(draft, branchId, (entry) => ({
      ...entry,
      editing: true,
      editBaselineTransitions: clone(entry.transitions),
    })),
    activeBranchId: branchId,
    dirty: true,
    notice: undefined,
  }
}

export function setPackageAnimationRouteBranchMode(
  draft: PackageAnimationRouteDraft,
  mode: BlueprintAnimationBranchMode,
): PackageAnimationRouteDraft {
  const branch = activeBranch(draft)
  if (!branch || (mode !== 'simultaneous' && mode !== 'sequential')) return draft
  return { ...updateBranch(draft, branch.id, (entry) => ({ ...entry, mode })), dirty: true, notice: undefined }
}

export function removePackageAnimationRouteTransition(
  draft: PackageAnimationRouteDraft,
  selectionId: string,
): PackageAnimationRouteDraft {
  if (draft.readOnlyReason) return draft
  const branch = draft.branches.find((entry) => entry.transitions.some((transition) => transition.id === selectionId))
  if (branch) {
    return { ...updateBranch(draft, branch.id, (entry) => ({ ...entry, transitions: entry.transitions.filter((transition) => transition.id !== selectionId), editing: true })), activeBranchId: branch.id, dirty: true, notice: undefined }
  }
  return {
    ...draft,
    transitions: draft.transitions.filter((entry) => entry.id !== selectionId),
    branches: draft.branches.filter((branch) => branch.originSelectionId !== selectionId),
    activeBranchId: draft.branches.some((branch) => branch.id === draft.activeBranchId && branch.originSelectionId === selectionId) ? null : draft.activeBranchId,
    dirty: true,
    notice: undefined,
  }
}

export function updatePackageAnimationRouteChannel(
  draft: PackageAnimationRouteDraft,
  selectionId: string,
  channel: BlueprintAnimationChannelType,
): PackageAnimationRouteDraft {
  if (draft.readOnlyReason || !ROUTE_BUILDER_CHANNEL_OPTIONS.some((entry) => entry.value === channel)) return draft
  return {
    ...draft,
    transitions: draft.transitions.map((entry) => entry.id === selectionId ? { ...entry, channel } : entry),
    branches: draft.branches.map((branch) => ({ ...branch, transitions: branch.transitions.map((entry) => entry.id === selectionId ? { ...entry, channel } : entry) })),
    dirty: true,
    notice: undefined,
  }
}

export function movePackageAnimationRouteTransition(
  draft: PackageAnimationRouteDraft,
  selectionId: string,
  direction: 'up' | 'down',
): RouteBuilderMutationResult {
  if (draft.readOnlyReason) return { accepted: false, draft, message: draft.readOnlyReason }
  const index = draft.transitions.findIndex((entry) => entry.id === selectionId)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= draft.transitions.length) return { accepted: false, draft }
  const transitions = [...draft.transitions]
  ;[transitions[index], transitions[target]] = [transitions[target], transitions[index]]
  const candidate = { ...draft, transitions, dirty: true, notice: undefined }
  const blocking = resolvePackageAnimationRouteDraft(candidate).issues.find((entry) => entry.severity === 'error')
  if (blocking) {
    const message = `That move would break route continuity: ${blocking.message}`
    return { accepted: false, draft: withNotice(draft, issue('error', 'invalid-reorder', message)), message }
  }
  return { accepted: true, draft: candidate }
}

function validationContext(draft: PackageAnimationRouteDraft) {
  return {
    packageAnnotationIds: draft.packageAnnotationIds,
    annotations: draft.annotations.map((annotation) => ({
      id: annotation.id,
      pageNumber: annotation.pageNumber,
      shapeKind: annotation.shapeKind || '',
      points: annotation.points,
      arcCtrls: annotation.arcCtrls,
      pointIds: annotation.pointIds,
      segmentIds: annotation.segmentIds,
    })),
  }
}

function graphIssue(entry: BlueprintAnimationValidationIssue): RouteBuilderIssue {
  return issue(entry.severity, entry.code, entry.message)
}

function dedupeIssues(entries: RouteBuilderIssue[]): RouteBuilderIssue[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = `${entry.severity}:${entry.code}:${entry.selectionId || ''}:${entry.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function packageAnimationRouteDraftToScene(
  draft: PackageAnimationRouteDraft,
  now = new Date().toISOString(),
): { scene?: BlueprintScopeAnimationSceneV1; issues: RouteBuilderIssue[] } {
  draft = normalizeDraftBranches(draft as PackageAnimationRouteDraft & { branch?: RouteBuilderBranchDraft })
  const resolved = resolvePackageAnimationRouteDraft(draft)
  const issues = [...resolved.issues]
  if (draft.readOnlyReason) issues.push(issue('error', 'read-only-scene', draft.readOnlyReason))
  if (resolved.edges.length === 0) issues.push(issue('error', 'empty-route', 'Add at least one connected route segment or confirmed direct transition.'))
  const branchIds = new Set<string>()
  const branchOrigins = new Set<string>()
  for (const branch of draft.branches) {
    if (branchIds.has(branch.id)) issues.push(issue('error', 'duplicate-branch-id', 'Two alternate branches have the same stable branch ID.'))
    branchIds.add(branch.id)
    if (!branch.originSelectionId) issues.push(issue('error', 'missing-branch-origin', 'A branch is missing its primary-route origin.'))
    if (branchOrigins.has(branch.originSelectionId)) issues.push(issue('error', 'duplicate-branch-origin', 'Each primary-route point can have only one authored alternate branch.'))
    branchOrigins.add(branch.originSelectionId)
  }
  if (draft.activeBranchId && !draft.branches.some((branch) => branch.id === draft.activeBranchId)) {
    issues.push(issue('error', 'missing-active-branch', 'The active branch edit no longer points to an existing branch.'))
  }
  const sourceNode = resolved.nodes[0]
  if (!sourceNode || !draft.source) return { issues: dedupeIssues(issues) }
  const branchOrders: BlueprintAnimationBranchOrder[] = []
  // Both completion kinds split at the origin (primary continuation + alternate), so both persist a
  // branch order. A rejoin adds a downstream merge; a terminal branch simply ends at its final fixture.
  for (const branch of draft.branches) {
    const branchResolution = resolved.branchResolutions.find((entry) => entry.branchId === branch.id)
    if (!branchResolution?.originNodeId) continue
    if (!branchResolution.convergenceNodeId && !branchResolution.terminalNodeId) {
      if (!branch.editing) issues.push(issue('error', 'invalid-branch-endpoint', 'A completed branch no longer has a valid terminal or rejoin endpoint.'))
      continue
    }
    if (branch.editing) continue
    const originIndex = branch.originSelectionId === 'source'
      ? -1
      : draft.transitions.findIndex((transition) => transition.id === branch.originSelectionId)
    const primaryOutgoing = resolved.transitions[originIndex + 1]?.edge
    const alternateOutgoing = branchResolution.transitions[0]?.edge
    if (primaryOutgoing && alternateOutgoing) {
      branchOrders.push({
        id: branch.persistedBranchOrderId || `animation_branch_${branchResolution.originNodeId}`,
        nodeId: branchResolution.originNodeId,
        mode: branch.mode,
        outgoingEdgeIds: [primaryOutgoing.id, alternateOutgoing.id],
      })
    } else {
      issues.push(issue('error', 'missing-primary-continuation', 'A branch junction is missing its primary continuation or alternate outgoing edge.'))
    }
  }
  const scene: BlueprintScopeAnimationSceneV1 = {
    ...(draft.baseScene ? clone(draft.baseScene) : createDefaultBlueprintAnimationScene({ id: draft.sceneId, now: draft.createdAt })),
    schemaVersion: 1,
    id: draft.sceneId,
    revision: Math.max(1, draft.expectedBaseRevision || 1),
    createdAt: draft.createdAt,
    updatedAt: now,
    nodes: resolved.nodes.map(({ point: _point, pageNumber: _pageNumber, ...node }) => node),
    edges: resolved.edges,
    sources: [{ ...(draft.baseScene?.sources.find((source) => source.id === draft.sourceId) || {}), id: draft.sourceId, nodeId: sourceNode.id, channel: draft.source.channel, ...(draft.sourcePriority != null ? { priority: draft.sourcePriority } : {}) }],
    manualTraversal: resolved.traversal,
    branchOrders,
    events: [],
    playbackOptions: { ...draft.playbackOptions },
  }
  issues.push(...validateBlueprintAnimationScene(scene, validationContext(draft)).map(graphIssue))
  return { scene, issues: dedupeIssues(issues) }
}

export function validatePackageAnimationRouteDraft(draft: PackageAnimationRouteDraft): RouteBuilderIssue[] {
  return packageAnimationRouteDraftToScene(draft).issues
}

function advancedSceneReason(scene: BlueprintScopeAnimationSceneV1): string | undefined {
  if (scene.sources.length !== 1) return 'This scene uses multiple or missing sources and is read-only in the one-source editor.'
  if (scene.events.length > 0) return 'This scene contains animation events that this editor cannot safely preserve.'
  if (scene.edges.some((edge) => edge.fromPort || edge.toPort)) return 'This scene uses explicit graph ports and is read-only in this editor.'
  const supportedRoles = new Set<BlueprintAnimationDeviceRole>(['source', 'control', 'sensor', 'junction', 'load'])
  if (scene.nodes.some((node) => node.roles.some((role) => !supportedRoles.has(role)))) {
    return 'This scene contains advanced emergency or transfer roles and is read-only in this editor.'
  }
  const outgoing = new Map<string, number>()
  const incoming = new Map<string, number>()
  scene.edges.forEach((edge) => {
    outgoing.set(edge.fromNodeId, (outgoing.get(edge.fromNodeId) || 0) + 1)
    incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) || 0) + 1)
  })
  if (scene.branchOrders.length === 0 && ([...outgoing.values()].some((count) => count > 1) || [...incoming.values()].some((count) => count > 1))) {
    return 'This scene contains an unordered branch and is read-only in this editor.'
  }
  if (scene.branchOrders.length > 0) {
    const branchNodes = new Set<string>()
    for (const branch of scene.branchOrders) {
      if (branchNodes.has(branch.nodeId)) return 'This scene has multiple alternate branches at one junction, which this editor cannot author yet.'
      branchNodes.add(branch.nodeId)
      const outgoingEdges = scene.edges.filter((edge) => edge.fromNodeId === branch.nodeId)
      if (
        branch.outgoingEdgeIds.length !== 2
        || outgoingEdges.length !== 2
        || new Set(branch.outgoingEdgeIds).size !== 2
        || outgoingEdges.some((edge) => !branch.outgoingEdgeIds.includes(edge.id))
      ) {
        return 'This scene uses a branch junction this editor cannot reconstruct.'
      }
    }
    const branchNodeIds = new Set(scene.branchOrders.map((branch) => branch.nodeId))
    if ([...outgoing.entries()].some(([nodeId, count]) => count > 1 && !branchNodeIds.has(nodeId))) {
      return 'This scene contains an unordered branch and is read-only in this editor.'
    }
    if ([...outgoing.values(), ...incoming.values()].some((count) => count > 2)) {
      return 'This scene uses more than two connections at a junction and is read-only in this editor.'
    }
    for (const branch of scene.branchOrders) {
    const outgoingEdges = scene.edges.filter((edge) => edge.fromNodeId === branch.nodeId)
    const splitNodes = [...outgoing.values()].filter((count) => count > 1)
    // Each supported split is described by its own branch order. A rejoin adds a downstream merge;
    // a terminal branch adds none. Multiple simple splits are authorable as independent junctions.
    if (
      splitNodes.length !== scene.branchOrders.length
      || outgoingEdges.length !== 2
    ) {
      return 'This scene uses a branch structure beyond the simple route builder.'
    }
    }
  }
  if (scene.manualTraversal.length !== scene.edges.length) {
    return 'This scene has graph edges outside its manual traversal and cannot be edited without data loss.'
  }
  const traversalEdgeIds = scene.manualTraversal.map((step) => step.edgeId)
  if (new Set(traversalEdgeIds).size !== traversalEdgeIds.length || scene.edges.some((edge) => !traversalEdgeIds.includes(edge.id))) {
    return 'This scene has an advanced traversal structure and is read-only in this editor.'
  }
  return undefined
}

function selectionFromEdge(
  edge: BlueprintAnimationEdge,
  draft: PackageAnimationRouteDraft,
  traversalId?: string,
): RouteBuilderTransition {
  if (edge.geometry.kind === 'direct') {
    const destination = draft.baseScene?.nodes.find((node) => node.id === edge.toNodeId)
    const annotationId = destination?.anchor.kind === 'annotation-center' ? destination.anchor.annotationId : ''
    return {
      id: edge.id.replace(/^animation_edge_/, '') || id('route_direct'),
      kind: 'direct',
      annotationId,
      channel: edge.channel,
      persistedEdgeId: edge.id,
      ...(traversalId ? { persistedTraversalId: traversalId } : {}),
    }
  }
  const geometry = edge.geometry
  const annotation = draft.annotations.find((entry) => entry.id === geometry.annotationId)
  const shapeKind = isCircuitShapeKind(annotation?.shapeKind) ? annotation.shapeKind : 'circuit-path'
  const resolution = annotation && isCircuitShapeKind(annotation.shapeKind) && Array.isArray(annotation.points)
    ? resolveCircuitSegmentIndex({
        annotationId: annotation.id,
        pageNumber: annotation.pageNumber,
        shapeKind: annotation.shapeKind,
        points: annotation.points,
        arcCtrls: annotation.arcCtrls,
        segmentIds: annotation.segmentIds,
      }, geometry.segmentId, geometry.segmentIndexHint, geometry.geometryFingerprint)
    : null
  const index = resolution?.status === 'resolved' ? resolution.index : Math.max(0, geometry.segmentIndexHint || 0)
  const start = annotation?.points?.[index] || { x: 0, y: 0 }
  const end = annotation?.points?.[index + 1] || { x: 0, y: 0 }
  return {
    id: edge.id.replace(/^animation_edge_/, '') || id('route_segment'),
    kind: 'segment',
    annotationId: geometry.annotationId,
    pageNumber: annotation?.pageNumber || 1,
    shapeKind,
    segmentId: geometry.segmentId,
    segmentIndexHint: geometry.segmentIndexHint ?? index,
    geometryFingerprint: geometry.geometryFingerprint,
    startPointId: annotation?.pointIds?.[index] || '',
    endPointId: annotation?.pointIds?.[index + 1] || '',
    startPointIndexHint: index,
    endPointIndexHint: index + 1,
    start: clone(start),
    end: clone(end),
    ...(shapeKind === 'circuit-arc' ? { control: clone(annotation?.arcCtrls?.[index] || { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }) } : {}),
    channel: edge.channel,
    persistedEdgeId: edge.id,
    ...(traversalId ? { persistedTraversalId: traversalId } : {}),
  }
}

export function loadPackageAnimationRouteDraft(options: {
  packageId: string
  packageName: string
  packageAnnotationIds: string[]
  annotations: RouteBuilderAnnotation[]
  scene: unknown
  expectedBaseRevision: number
  now?: string
}): PackageAnimationRouteDraft {
  const empty = createEmptyPackageAnimationRouteDraft(options)
  const parsed = parseBlueprintAnimationScene(options.scene)
  if (parsed.status === 'absent') return empty
  if (parsed.status === 'unsupported-version') {
    return { ...empty, readOnlyReason: 'Animation created by a newer app version.', expectedBaseRevision: options.expectedBaseRevision }
  }
  if (parsed.status === 'malformed') {
    return { ...empty, readOnlyReason: 'The saved animation scene is malformed and cannot be safely edited.', malformedSceneReason: parsed.reason }
  }
  const scene = parsed.scene
  const readOnlyReason = advancedSceneReason(scene)
  const source = scene.sources[0]
  const sourceNode = scene.nodes.find((node) => node.id === source?.nodeId)
  const sourceAnnotationId = sourceNode?.anchor.kind === 'annotation-center' ? sourceNode.anchor.annotationId : undefined
  const draft: PackageAnimationRouteDraft = {
    ...empty,
    sceneId: scene.id,
    createdAt: scene.createdAt,
    expectedBaseRevision: Math.max(options.expectedBaseRevision, scene.revision),
    playbackOptions: { ...scene.playbackOptions },
    baseScene: clone(scene),
    sourceId: source?.id || 'animation_source_primary',
    ...(source?.priority != null ? { sourcePriority: source.priority } : {}),
    ...(sourceAnnotationId ? { source: { annotationId: sourceAnnotationId, channel: source.channel || inferRouteBuilderDefaultChannel(options.annotations.find((entry) => entry.id === sourceAnnotationId)?.shapeKind) } } : {}),
    transitions: [],
    branches: [],
    activeBranchId: null,
    ...(readOnlyReason ? { readOnlyReason } : {}),
    dirty: false,
  }
  const edgeById = new Map(scene.edges.map((edge) => [edge.id, edge]))
  const traversalByEdgeId = new Map(scene.manualTraversal.map((step) => [step.edgeId, step]))
  if (scene.branchOrders.length === 0 || !source) {
    draft.transitions = scene.manualTraversal
      .map((step) => ({ step, edge: edgeById.get(step.edgeId) }))
      .filter((entry): entry is { step: BlueprintAnimationTraversalStep; edge: BlueprintAnimationEdge } => !!entry.edge)
      .map(({ step, edge }) => selectionFromEdge(edge, draft, step.id))
    return draft
  }

  const outgoingByNode = new Map<string, BlueprintAnimationEdge[]>()
  scene.edges.forEach((edge) => outgoingByNode.set(edge.fromNodeId, [...(outgoingByNode.get(edge.fromNodeId) ?? []), edge]))
  const walk = (firstEdgeId: string, stopNodes = new Set<string>()): BlueprintAnimationEdge[] => {
    const path: BlueprintAnimationEdge[] = []
    let next = edgeById.get(firstEdgeId)
    const seen = new Set<string>()
    while (next && !seen.has(next.id)) {
      path.push(next)
      seen.add(next.id)
      if (stopNodes.has(next.toNodeId)) break
      next = (outgoingByNode.get(next.toNodeId) ?? [])[0]
    }
    return path
  }
  const branchOrderByNode = new Map(scene.branchOrders.map((order) => [order.nodeId, order]))
  const primaryEdges: BlueprintAnimationEdge[] = []
  let cursorNodeId = source.nodeId
  const seenPrimaryNodes = new Set<string>()
  while (!seenPrimaryNodes.has(cursorNodeId)) {
    seenPrimaryNodes.add(cursorNodeId)
    const branchOrder = branchOrderByNode.get(cursorNodeId)
    const next = branchOrder
      ? edgeById.get(branchOrder.outgoingEdgeIds[0])
      : (outgoingByNode.get(cursorNodeId) ?? [])[0]
    if (!next) break
    primaryEdges.push(next)
    cursorNodeId = next.toNodeId
  }
  const primaryNodeIds = new Set([source.nodeId, ...primaryEdges.map((edge) => edge.toNodeId)])
  draft.transitions = primaryEdges.map((edge) => selectionFromEdge(edge, draft, traversalByEdgeId.get(edge.id)?.id))
  const loadedBranches: Array<RouteBuilderBranchDraft & { originIndex: number }> = []
  scene.branchOrders.forEach((branchOrder) => {
    const originEdgeIndex = primaryEdges.findIndex((edge) => edge.toNodeId === branchOrder.nodeId)
    const originSelectionId = branchOrder.nodeId === source.nodeId
      ? 'source'
      : draft.transitions[originEdgeIndex]?.id
    if (!originSelectionId) return
    const alternateEdges = walk(branchOrder.outgoingEdgeIds[1], primaryNodeIds)
    loadedBranches.push({
      id: branchOrder.id || `route_branch_${branchOrder.nodeId}`,
      originSelectionId,
      mode: branchOrder.mode,
      transitions: alternateEdges.map((edge) => selectionFromEdge(edge, draft, traversalByEdgeId.get(edge.id)?.id)),
      editing: false,
      ...(branchOrder.id ? { persistedBranchOrderId: branchOrder.id } : {}),
      persistedAlternateEdgeIds: alternateEdges.map((edge) => edge.id),
      originIndex: originSelectionId === 'source' ? 0 : originEdgeIndex + 1,
    })
  })
  draft.branches = loadedBranches
    .sort((a, b) => a.originIndex - b.originIndex)
    .map(({ originIndex: _originIndex, ...branch }) => branch)
  draft.activeBranchId = null
  return draft
}

export function summarizePackageAnimationScene(
  scene: BlueprintScopeAnimationScene | undefined,
  annotations: RouteBuilderAnnotation[],
  packageAnnotationIds: string[],
): RouteBuilderSceneSummary {
  const parsed = parseBlueprintAnimationScene(scene)
  if (parsed.status === 'absent') return { state: 'absent', sourceCount: 0, routeStepCount: 0, valid: false, advanced: false }
  if (parsed.status === 'unsupported-version') {
    return { state: 'unsupported', sourceCount: 0, routeStepCount: 0, valid: false, advanced: true, message: 'Animation created by a newer app version.' }
  }
  if (parsed.status === 'malformed') {
    return { state: 'malformed', sourceCount: 0, routeStepCount: 0, valid: false, advanced: true, message: parsed.reason }
  }
  const advancedReason = advancedSceneReason(parsed.scene)
  const validation = validateBlueprintAnimationScene(parsed.scene, {
    packageAnnotationIds,
    annotations: annotations.map((annotation) => ({
      id: annotation.id,
      pageNumber: annotation.pageNumber,
      shapeKind: annotation.shapeKind || '',
      points: annotation.points,
      arcCtrls: annotation.arcCtrls,
      pointIds: annotation.pointIds,
      segmentIds: annotation.segmentIds,
    })),
  })
  return {
    state: 'supported',
    sourceCount: parsed.scene.sources.length,
    routeStepCount: parsed.scene.manualTraversal.length,
    valid: !validation.some((entry) => entry.severity === 'error'),
    advanced: !!advancedReason,
    ...(advancedReason ? { message: advancedReason } : {}),
  }
}

export interface RouteBuilderListEntry {
  id: string
  number?: number
  label: string
  typeLabel: string
  channel?: BlueprintAnimationChannelType
  isSource?: boolean
}

export function formatRouteBuilderSourceLabel(annotation: RouteBuilderAnnotation | undefined): string {
  if (!annotation) return 'Missing source'
  if (annotation.shapeKind !== 'electrical-panel') return annotation.label || 'Source'
  const customLabel = String(annotation.text || '').trim()
  return customLabel ? `Electrical Panel — ${customLabel}` : 'Electrical Panel'
}

export interface RouteBuilderSourceCandidate {
  id: string
  annotationId: string
  label: string
  shapeKind?: string
  pageNumber: number
  channel: BlueprintAnimationChannelType
}

export function getPackageAnimationSourceCandidates(draft: Pick<PackageAnimationRouteDraft, 'packageAnnotationIds' | 'annotations'>): RouteBuilderSourceCandidate[] {
  const packageIds = new Set(draft.packageAnnotationIds)
  return draft.annotations
    .filter((annotation) => packageIds.has(annotation.id) && isRouteBuilderSourceKind(annotation.shapeKind) && !!center(annotation))
    .map((annotation) => ({
      id: annotation.id,
      annotationId: annotation.id,
      label: formatRouteBuilderSourceLabel(annotation),
      ...(annotation.shapeKind ? { shapeKind: annotation.shapeKind } : {}),
      pageNumber: annotation.pageNumber,
      channel: inferRouteBuilderDefaultChannel(annotation.shapeKind),
    }))
}

export function getPackageAnimationRouteList(draft: PackageAnimationRouteDraft): RouteBuilderListEntry[] {
  const annotations = byId(draft)
  const resolvedBySelectionId = new Map(resolvePackageAnimationRouteDraft(draft).transitions.map((transition) => [transition.selection.id, transition]))
  const entries: RouteBuilderListEntry[] = []
  if (draft.source) {
    const annotation = annotations.get(draft.source.annotationId)
    entries.push({ id: 'source', number: 1, label: formatRouteBuilderSourceLabel(annotation), typeLabel: 'Source device', channel: draft.source.channel, isSource: true })
  }
  draft.transitions.forEach((selection, index) => {
    const annotation = annotations.get(selection.annotationId)
    const destinationLabel = resolvedBySelectionId.get(selection.id)?.to?.label
    entries.push({
      id: selection.id,
      label: selection.kind === 'segment'
        ? `${annotation?.label || 'Missing circuit'} · segment ${selection.segmentIndexHint + 1}${destinationLabel ? ` → ${destinationLabel}` : ''}`
        : annotation?.label || 'Missing device',
      typeLabel: selection.kind === 'segment'
        ? (selection.shapeKind === 'circuit-arc' ? 'Circuit Arc segment' : 'Circuit Path segment')
        : 'Direct transition',
      channel: selection.channel,
      number: index + 2,
    })
  })
  return entries
}

export function getPackageAnimationBranchList(draft: PackageAnimationRouteDraft): RouteBuilderListEntry[] {
  const branch = activeBranch(draft)
  if (!branch) return []
  const annotations = byId(draft)
  const resolvedBranch = resolvePackageAnimationRouteDraft(draft).branchResolutions.find((entry) => entry.branchId === branch.id)
  const resolved = new Map((resolvedBranch?.transitions ?? []).map((transition) => [transition.selection.id, transition]))
  return branch.transitions.map((selection, index) => {
    const annotation = annotations.get(selection.annotationId)
    const destinationLabel = resolved.get(selection.id)?.to?.label
    return {
      id: selection.id,
      number: index + 1,
      label: selection.kind === 'segment'
        ? `${annotation?.label || 'Missing circuit'} · segment ${selection.segmentIndexHint + 1}${destinationLabel ? ` → ${destinationLabel}` : ''}`
        : annotation?.label || 'Missing device',
      typeLabel: selection.kind === 'segment'
        ? (selection.shapeKind === 'circuit-arc' ? 'Circuit Arc segment' : 'Circuit Path segment')
        : 'Direct transition',
      channel: selection.channel,
    }
  })
}

export interface PackageAnimationBranchSummary {
  id: string
  originSelectionId: 'source' | string
  originLabel: string
  originNumber: number
  stepCount: number
  endpointLabel?: string
  editing: boolean
}

export function getPackageAnimationBranchSummaries(draft: PackageAnimationRouteDraft): PackageAnimationBranchSummary[] {
  const routeEntries = getPackageAnimationRouteList(draft)
  const resolved = resolvePackageAnimationRouteDraft(draft)
  const resolvedByBranchId = new Map(resolved.branchResolutions.map((branch) => [branch.branchId, branch]))
  return draft.branches
    .map((branch) => {
      const routeEntry = branch.originSelectionId === 'source'
        ? routeEntries.find((entry) => entry.isSource)
        : routeEntries.find((entry) => entry.id === branch.originSelectionId)
      const branchResolution = resolvedByBranchId.get(branch.id)
      return {
        id: branch.id,
        originSelectionId: branch.originSelectionId,
        originLabel: routeEntry?.label || 'Primary-route point',
        originNumber: routeEntry?.number || 1,
        stepCount: branch.transitions.length,
        ...(branchResolution?.endpoint?.label ? { endpointLabel: branchResolution.endpoint.label } : {}),
        editing: branch.editing,
      }
    })
    .sort((a, b) => a.originNumber - b.originNumber)
}

export function packageAnimationRouteHasBranchAtOrigin(draft: PackageAnimationRouteDraft, originSelectionId: 'source' | string): boolean {
  return draft.branches.some((branch) => branch.originSelectionId === originSelectionId)
}

export interface PackageAnimationBranchStatus {
  heading: 'ALTERNATE BRANCH'
  originLabel: string
  stepCount: number
  phase: 'Select first alternate segment' | 'Continue alternate route' | 'Branch valid — ready to finish' | 'Invalid selection — branch remains open' | 'Branch complete'
  /** Which completion the current endpoint satisfies, once valid. Absent while the branch is still open. */
  completionKind?: 'rejoin' | 'terminal'
  /** Label of the resolved endpoint device/node, when the branch is valid to finish. */
  endpointLabel?: string
  instruction: string
  nextAction: string
  valid: boolean
}

export function getPackageAnimationBranchStatus(draft: PackageAnimationRouteDraft): PackageAnimationBranchStatus | null {
  const branch = activeBranch(draft) ?? (draft.branches.length === 1 ? draft.branches[0] : undefined)
  if (!branch) return null
  const resolved = resolvePackageAnimationRouteDraft(draft)
  const branchResolution = resolved.branchResolutions.find((entry) => entry.branchId === branch.id)
  const entries = getPackageAnimationRouteList(draft)
  const originLabel = branch.originSelectionId === 'source'
    ? entries.find((entry) => entry.isSource)?.label || 'Source'
    : resolved.transitions.find((entry) => entry.selection.id === branch.originSelectionId)?.to?.label || 'Primary-route node'
  const completionKind = branchResolution?.convergenceNodeId ? 'rejoin' : branchResolution?.terminalNodeId ? 'terminal' : undefined
  const valid = !!completionKind
  const endpointLabel = valid
    ? branchResolution?.transitions[branchResolution.transitions.length - 1]?.to?.label
    : undefined
  const invalidSelection = branch.editing && draft.notice?.severity === 'error'
  const phase = !branch.editing
    ? 'Branch complete'
    : invalidSelection
      ? 'Invalid selection — branch remains open'
      : valid
        ? 'Branch valid — ready to finish'
        : branch.transitions.length === 0
          ? 'Select first alternate segment'
          : 'Continue alternate route'
  const instruction = completionKind === 'rejoin'
    ? `The alternate route rejoins the primary route${endpointLabel ? ` at ${endpointLabel}` : ''}.`
    : completionKind === 'terminal'
      ? `Terminal endpoint${endpointLabel ? `: ${endpointLabel}` : ''}. Finish here, or keep selecting alternate segments to extend the branch.`
      : branch.transitions.length === 0
        ? 'Select the first connected Circuit Path or Circuit Arc segment.'
        : 'Continue the alternate route, finish at a terminal fixture/device, or select a later primary-route node to rejoin.'
  const nextAction = !branch.editing
    ? 'Save Route, or remove the completed branch to author it again.'
    : valid
      ? 'Choose Finish Branch.'
      : 'Select another connected branch segment, a terminal fixture/device, or a later primary-route rejoin node.'
  return {
    heading: 'ALTERNATE BRANCH',
    originLabel,
    stepCount: branch.transitions.length,
    phase,
    ...(completionKind ? { completionKind } : {}),
    ...(endpointLabel ? { endpointLabel } : {}),
    instruction,
    nextAction,
    valid,
  }
}

export interface RouteBuilderOverlay {
  segments: Array<{ id: string; pageNumber: number; kind: 'straight' | 'quadratic'; start: NormalizedPoint; end: NormalizedPoint; control?: NormalizedPoint }>
  badges: Array<{ id: string; nodeId: string; route: 'primary' | 'branch'; pageNumber: number; label?: number; point: NormalizedPoint; junction: boolean; ariaLabel: string }>
}

export function getPackageAnimationRouteOverlay(draft: PackageAnimationRouteDraft): RouteBuilderOverlay {
  const annotations = byId(draft)
  const segments: RouteBuilderOverlay['segments'] = []
  ;[...draft.transitions, ...draft.branches.flatMap((branch) => branch.transitions)].forEach((selection) => {
    if (selection.kind !== 'segment') return
    const annotation = annotations.get(selection.annotationId)
    if (!annotation) return
    const geometry = geometryForSelection(annotation, selection)
    if (!geometry) return
    segments.push({
      id: selection.id,
      pageNumber: annotation.pageNumber,
      kind: annotation.shapeKind === 'circuit-arc' ? 'quadratic' : 'straight',
      start: geometry.start,
      end: geometry.end,
      ...(geometry.control ? { control: geometry.control } : {}),
    })
  })
  const resolved = resolvePackageAnimationRouteDraft(draft)
  const badges: RouteBuilderOverlay['badges'] = []
  let meaningfulNumber = 1
  const source = resolved.nodes[0]
  if (source) badges.push({ id: source.id, nodeId: source.id, route: 'primary', pageNumber: source.pageNumber, label: meaningfulNumber, point: source.point, junction: false, ariaLabel: `Animation route step ${meaningfulNumber}: ${source.label || 'source'}` })
  resolved.transitions.forEach((transition) => {
    const destination = transition.to
    if (!destination) return
    const junction = destination.roles.includes('junction')
    if (junction) {
      badges.push({ id: `${transition.selection.id}-junction`, nodeId: destination.id, route: 'primary', pageNumber: destination.pageNumber, point: destination.point, junction: true, ariaLabel: `Animation route junction: ${destination.label || 'circuit point'}` })
      return
    }
    meaningfulNumber += 1
    badges.push({ id: destination.id, nodeId: destination.id, route: 'primary', pageNumber: destination.pageNumber, label: meaningfulNumber, point: destination.point, junction: false, ariaLabel: `Animation route step ${meaningfulNumber}: ${destination.label || 'device'}` })
  })
  resolved.branchTransitions.forEach((transition) => {
    const destination = transition.to
    if (!destination) return
    const junction = destination.roles.includes('junction')
    badges.push({
      id: `branch-${transition.selection.id}`,
      nodeId: destination.id,
      route: 'branch',
      pageNumber: destination.pageNumber,
      point: destination.point,
      junction,
      ariaLabel: `Animation branch: ${destination.label || (junction ? 'circuit point' : 'device')}`,
    })
  })
  return { segments, badges }
}

// ── ANIM-2B1: post-save reconciliation ──
// The builder captures `expectedBaseRevision` when it opens and the draft scene freezes that
// number (see packageAnimationRouteDraftToScene). Nothing used to advance it after a verified
// save, so the builder stayed permanently behind local storage and every later save tripped the
// service's revision check. These helpers are pure so the reconciliation can be tested without
// mounting the PDF viewer.

/**
 * Synchronous single-flight guard for Save Route / Clear Route. React state alone cannot close
 * the double-tap window: the handler closure keeps reading the pre-render `saving: false` until
 * the next commit, so two taps would issue two scene saves at the same expected revision — the
 * second of which the service correctly rejects as stale. `begin()` flips synchronously.
 */
export interface SingleFlightGuard {
  begin(): boolean
  end(): void
  readonly busy: boolean
}

export function createSingleFlightGuard(): SingleFlightGuard {
  let inFlight = false
  return {
    begin() {
      if (inFlight) return false
      inFlight = true
      return true
    },
    end() {
      inFlight = false
    },
    get busy() {
      return inFlight
    },
  }
}

export interface PackageAnimationRouteConflictState {
  message: string
  latestRevision?: number
  currentScene?: unknown
  /** True when this device's own stored route is ahead of the builder — not a remote edit. */
  sameDevice: boolean
}

export interface PackageAnimationRouteBuilderState {
  /**
   * Identifies one builder session. A save/clear that resolves after its session closed (or
   * after a different package was opened) must not stamp its conflict onto the session that
   * happens to be open now — that is how a brand-new clean builder inherited a stale
   * "out of date" banner before the owner had touched anything.
   */
  sessionId: string
  layerId: string
  pageNumber: number
  draft: PackageAnimationRouteDraft
  saving: boolean
  conflict?: PackageAnimationRouteConflictState
}

/** Minimal shape the builder needs from a canonical scope layer. */
export interface PackageAnimationRouteSourceLayer {
  id: string
  name: string
  selectedAnnotationIds: string[]
  animationScene?: unknown
  animationSceneRevision?: number
}

/**
 * The approved revision convention, in one place: the greater of the supported scene's own
 * revision and the layer's revision marker. Open, Reload Latest and Clear must all agree.
 */
export function resolvePackageAnimationRouteBaseRevision(layer: PackageAnimationRouteSourceLayer | undefined): number {
  if (!layer) return 0
  const parsed = parseBlueprintAnimationScene(layer.animationScene)
  return Math.max(
    Math.max(0, Math.floor(Number(layer.animationSceneRevision) || 0)),
    parsed.status === 'supported' ? parsed.scene.revision : 0,
  )
}

/**
 * Build a clean builder session from a canonical package. This is the single entry point for
 * both Edit Animation Route and Reload Latest, so the normal open path starts in exactly the
 * state Reload Latest produces: latest scene, latest revision, clean, no conflict.
 */
export function openPackageAnimationRouteSession(options: {
  layer: PackageAnimationRouteSourceLayer
  annotations: RouteBuilderAnnotation[]
  pageNumber: number
  sessionId: string
  now?: string
}): PackageAnimationRouteBuilderState {
  const { layer } = options
  const expectedBaseRevision = resolvePackageAnimationRouteBaseRevision(layer)
  const draftOptions = {
    packageId: layer.id,
    packageName: layer.name,
    packageAnnotationIds: [...layer.selectedAnnotationIds],
    annotations: options.annotations,
    expectedBaseRevision,
    ...(options.now ? { now: options.now } : {}),
  }
  const parsed = parseBlueprintAnimationScene(layer.animationScene)
  const draft = parsed.status === 'absent'
    ? createEmptyPackageAnimationRouteDraft(draftOptions)
    : loadPackageAnimationRouteDraft({ ...draftOptions, scene: layer.animationScene })
  return {
    sessionId: options.sessionId,
    layerId: layer.id,
    pageNumber: options.pageNumber,
    // A freshly loaded scene is the baseline, so it is clean by construction: nothing about
    // normalization, default playback fields or rebuilt traversal may mark it dirty.
    draft: { ...draft, dirty: false, notice: undefined },
    saving: false,
    // No conflict, no save error, no verification message carried in from any earlier session.
  }
}

export type PackageAnimationRouteRefreshOutcome =
  | { status: 'unchanged'; state: PackageAnimationRouteBuilderState }
  | { status: 'rebased'; state: PackageAnimationRouteBuilderState }
  | { status: 'conflict'; state: PackageAnimationRouteBuilderState }

/**
 * The canonical local package advanced while a builder was open. A clean builder has no owner
 * work to protect, so it silently rebases onto the newer scene instead of demanding a manual
 * Reload Latest. A dirty builder keeps its draft byte-for-byte and raises the local banner.
 */
export function reconcilePackageAnimationRouteLocalRefresh(
  state: PackageAnimationRouteBuilderState,
  canonicalLayer: PackageAnimationRouteSourceLayer | undefined,
  annotations: RouteBuilderAnnotation[],
): PackageAnimationRouteRefreshOutcome {
  // Case C: a save owns the revision handshake while it is in flight. A refresh watcher must
  // not manufacture a conflict against the save's own expected revision.
  if (state.saving || !canonicalLayer || canonicalLayer.id !== state.layerId) {
    return { status: 'unchanged', state }
  }
  const canonicalRevision = resolvePackageAnimationRouteBaseRevision(canonicalLayer)
  if (canonicalRevision <= state.draft.expectedBaseRevision) {
    return { status: 'unchanged', state }
  }
  if (!state.draft.dirty) {
    // Case A: auto-rebase, stay clean, drop any stale local banner.
    return {
      status: 'rebased',
      state: openPackageAnimationRouteSession({
        layer: canonicalLayer,
        annotations,
        pageNumber: state.pageNumber,
        sessionId: state.sessionId,
      }),
    }
  }
  // Idempotent: once the banner for this revision is showing, re-running the watcher must not
  // rebuild it (the state object would change identity every pass and spin the effect).
  if (state.conflict?.sameDevice && state.conflict.latestRevision === canonicalRevision) {
    return { status: 'unchanged', state }
  }
  // Case B: preserve the draft and its expected revision until the owner explicitly reloads.
  return {
    status: 'conflict',
    state: {
      ...state,
      conflict: {
        message: conflictMessageFor('stale-local-revision', undefined),
        sameDevice: true,
        latestRevision: canonicalRevision,
        ...(canonicalLayer.animationScene != null ? { currentScene: canonicalLayer.animationScene } : {}),
      },
    },
  }
}

export interface PackageAnimationRouteSaveResultLike<TLayer> {
  success: boolean
  reason?: string
  message?: string
  scene?: unknown
  scopeLayer?: TLayer
  currentScene?: unknown
}

export type PackageAnimationRouteSaveOutcome<TLayer> =
  | {
      status: 'saved'
      scopeLayer: TLayer
      savedScene: BlueprintScopeAnimationSceneV1 | undefined
      savedRevision: number
      /** Clean draft rebased on the verified saved scene, for callers that reconcile before closing. */
      savedDraft?: PackageAnimationRouteDraft
      builder: null
    }
  | {
      status: 'conflict'
      conflict: PackageAnimationRouteConflictState
      builder: PackageAnimationRouteBuilderState | null
    }

/**
 * A same-device stale result means local storage already moved past this builder. Calling that
 * "another device changed this route" is what made the owner-reported save look like a phantom
 * remote conflict, so only genuinely remote reasons get that wording.
 */
const SAME_DEVICE_CONFLICT_REASONS = new Set(['stale-local-revision'])

function conflictMessageFor(reason: string | undefined, fallback: string | undefined): string {
  switch (reason) {
    case 'stale-local-revision':
      return 'This route builder is out of date with the animation route already saved on this device. Reload the latest route, or keep your draft open.'
    case 'stale-remote-revision':
      return 'Another device changed this animation route. Your draft has not been overwritten.'
    case 'remote-conflict-unresolved':
      return 'The route save could not be verified. Your draft is still open and unchanged.'
    case 'scope-layer-missing':
      return 'The work package no longer exists.'
    case 'scope-layer-deleted':
      return 'The work package was deleted.'
    case 'unsupported-current-scene':
      return 'The saved animation route uses a newer app version and cannot be replaced here.'
    case 'invalid-next-scene':
      return 'The animation route draft could not be saved because it is not valid.'
    default:
      return fallback || 'The route save could not be completed. Your draft is still open.'
  }
}

function supportedSceneRevision(scene: unknown): number | undefined {
  const parsed = parseBlueprintAnimationScene(scene)
  return parsed.status === 'supported' ? parsed.scene.revision : undefined
}

/**
 * Rebase a draft onto the scene the service verified as saved: clean, with the final revision.
 * Reopening the builder from the reconciled package must produce exactly this state.
 */
export function markPackageAnimationRouteDraftSaved(
  draft: PackageAnimationRouteDraft,
  savedScene: unknown,
  savedRevision: number,
): PackageAnimationRouteDraft {
  const revision = Math.max(0, Math.floor(Number(savedRevision) || 0))
  if (savedScene == null) {
    return {
      ...draft,
      baseScene: undefined,
      source: undefined,
      transitions: [],
      branches: [],
      activeBranchId: null,
      expectedBaseRevision: revision,
      dirty: false,
      notice: undefined,
    }
  }
  return loadPackageAnimationRouteDraft({
    packageId: draft.packageId,
    packageName: draft.packageName,
    packageAnnotationIds: [...draft.packageAnnotationIds],
    annotations: draft.annotations,
    scene: savedScene,
    expectedBaseRevision: revision,
  })
}

/**
 * Translate a public scene-save result into the next builder/package state. Only an explicit
 * `success: true` carrying the saved scope layer counts as saved; the final revision is always
 * taken from the service result, never derived from the draft.
 */
export function reconcilePackageAnimationRouteSave<TLayer extends { id: string }>(
  state: PackageAnimationRouteBuilderState | null,
  result: PackageAnimationRouteSaveResultLike<TLayer>,
): PackageAnimationRouteSaveOutcome<TLayer> {
  if (result.success && result.scopeLayer) {
    const layer = result.scopeLayer as TLayer & { animationSceneRevision?: number }
    const parsed = parseBlueprintAnimationScene(result.scene)
    const savedScene = parsed.status === 'supported' ? parsed.scene : undefined
    const savedRevision = Math.max(
      savedScene?.revision ?? 0,
      Math.max(0, Math.floor(Number(layer.animationSceneRevision) || 0)),
    )
    return {
      status: 'saved',
      scopeLayer: result.scopeLayer,
      savedScene,
      savedRevision,
      ...(state ? { savedDraft: markPackageAnimationRouteDraftSaved(state.draft, savedScene, savedRevision) } : {}),
      builder: null,
    }
  }
  const conflict: PackageAnimationRouteConflictState = {
    message: conflictMessageFor(result.reason, result.message),
    sameDevice: SAME_DEVICE_CONFLICT_REASONS.has(result.reason || ''),
    ...(supportedSceneRevision(result.currentScene) != null ? { latestRevision: supportedSceneRevision(result.currentScene) } : {}),
    ...(result.currentScene != null ? { currentScene: result.currentScene } : {}),
  }
  return {
    status: 'conflict',
    conflict,
    // Draft, dirty flag and overlays are deliberately untouched on every non-success result.
    builder: state ? { ...state, saving: false, conflict } : null,
  }
}
