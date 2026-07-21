import type { NormalizedPoint } from './routeGeometry'
import type {
  PreparedPlaybackGeometry,
  PreparedPlaybackGeometryStep,
  PreparedPlaybackNode,
} from './playbackGeometry'
import type { BlueprintAnimationBranchMode, BlueprintAnimationChannelType, BlueprintAnimationPlaybackOptions } from './types'

export type PlaybackDevicePhase = 'idle' | 'reacting' | 'activating' | 'active'

export interface PlaybackTimelineStep extends PreparedPlaybackGeometryStep {
  travelStartMs: number
  travelEndMs: number
  pauseEndMs: number
}

export interface PlaybackTimeline {
  options: BlueprintAnimationPlaybackOptions
  sourceNodeId: string
  nodes: PreparedPlaybackNode[]
  steps: PlaybackTimelineStep[]
  totalDurationMs: number
  hasBranches: boolean
}

export interface PlaybackOrbState {
  edgeId: string
  pageNumber: number
  point: NormalizedPoint
  progress: number
}

export interface PlaybackEnergizedEdgeState {
  edgeId: string
  pageNumber: number
  channel: BlueprintAnimationChannelType
  progress: number
  step: PlaybackTimelineStep
}

export interface PlaybackDeviceState {
  nodeId: string
  pageNumber: number
  point: NormalizedPoint
  phase: PlaybackDevicePhase
  progress: number
}

export interface PlaybackFrame {
  elapsedMs: number
  complete: boolean
  orb: PlaybackOrbState | null
  orbs: PlaybackOrbState[]
  energizedEdges: PlaybackEnergizedEdgeState[]
  devices: PlaybackDeviceState[]
}

export interface PlaybackBranchDefinition {
  nodeId: string
  mode: BlueprintAnimationBranchMode
  outgoingStepIds: string[]
  convergenceNodeId?: string
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

function stepDuration(step: PreparedPlaybackGeometryStep, options: BlueprintAnimationPlaybackOptions): number {
  return options.reducedMotion || step.kind === 'direct'
    ? 0
    : (step.geometry?.length ?? 0) * 1000 / options.travelSpeed
}

function pauseDuration(
  step: PreparedPlaybackGeometryStep,
  nodeById: Map<string, PreparedPlaybackNode>,
  options: BlueprintAnimationPlaybackOptions,
): number {
  if (options.reducedMotion) return 0
  const directTarget = step.kind === 'direct' ? nodeById.get(step.toNodeId) : undefined
  const directActivationMs = directTarget
    ? options.deviceReactionMs + (directTarget.roles.includes('load') ? options.fixtureFadeMs : 0)
    : 0
  return Math.max(options.nodePauseMs, directActivationMs)
}

function traversalTopology(geometry: PreparedPlaybackGeometry) {
  const outgoing = new Map<string, PreparedPlaybackGeometryStep[]>()
  const incoming = new Map<string, PreparedPlaybackGeometryStep[]>()
  geometry.steps.forEach((step) => {
    outgoing.set(step.fromNodeId, [...(outgoing.get(step.fromNodeId) ?? []), step])
    incoming.set(step.toNodeId, [...(incoming.get(step.toNodeId) ?? []), step])
  })
  const reachableNodes = new Set<string>()
  const reachableStepIds = new Set<string>()
  const pending = [geometry.sourceNodeId]
  while (pending.length > 0) {
    const nodeId = pending.shift() as string
    if (reachableNodes.has(nodeId)) continue
    reachableNodes.add(nodeId)
    ;(outgoing.get(nodeId) ?? []).forEach((step) => {
      reachableStepIds.add(step.id)
      if (!reachableNodes.has(step.toNodeId)) pending.push(step.toNodeId)
    })
  }
  return { outgoing, incoming, reachableNodes, reachableStepIds }
}

function descendantDistances(startNodeId: string, outgoing: Map<string, PreparedPlaybackGeometryStep[]>): Map<string, number> {
  const distances = new Map<string, number>([[startNodeId, 0]])
  const pending = [startNodeId]
  while (pending.length > 0) {
    const nodeId = pending.shift() as string
    const nextDistance = (distances.get(nodeId) ?? 0) + 1
    ;(outgoing.get(nodeId) ?? []).forEach((step) => {
      const previous = distances.get(step.toNodeId)
      if (previous == null || nextDistance < previous) {
        distances.set(step.toNodeId, nextDistance)
        pending.push(step.toNodeId)
      }
    })
  }
  return distances
}

function findConvergenceNode(
  siblingSteps: readonly PreparedPlaybackGeometryStep[],
  outgoing: Map<string, PreparedPlaybackGeometryStep[]>,
  nodeOrder: Map<string, number>,
): string | undefined {
  if (siblingSteps.length < 2) return undefined
  const descendants = siblingSteps.map((step) => descendantDistances(step.toNodeId, outgoing))
  const candidates = [...descendants[0].keys()].filter((nodeId) => descendants.every((map) => map.has(nodeId)))
  candidates.sort((left, right) => {
    const leftDistances = descendants.map((map) => map.get(left) as number)
    const rightDistances = descendants.map((map) => map.get(right) as number)
    return Math.max(...leftDistances) - Math.max(...rightDistances)
      || leftDistances.reduce((sum, value) => sum + value, 0) - rightDistances.reduce((sum, value) => sum + value, 0)
      || (nodeOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (nodeOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
      || left.localeCompare(right)
  })
  return candidates[0]
}

export function detectPlaybackBranches(
  geometry: PreparedPlaybackGeometry,
  defaultMode: BlueprintAnimationBranchMode = 'simultaneous',
): PlaybackBranchDefinition[] {
  const { outgoing, reachableNodes } = traversalTopology(geometry)
  const nodeOrder = new Map<string, number>()
  geometry.steps.forEach((step, index) => {
    if (!nodeOrder.has(step.fromNodeId)) nodeOrder.set(step.fromNodeId, index)
    if (!nodeOrder.has(step.toNodeId)) nodeOrder.set(step.toNodeId, index + 1)
  })
  const orderByNode = new Map((geometry.branchOrders ?? []).map((order) => [order.nodeId, order]))
  return [...reachableNodes]
    .map((nodeId): PlaybackBranchDefinition | null => {
      const siblings = outgoing.get(nodeId) ?? []
      if (siblings.length < 2) return null
      const directSavedOrder = orderByNode.get(nodeId)
      const edgeRank = new Map((directSavedOrder?.outgoingEdgeIds ?? []).map((edgeId, index) => [edgeId, index]))
      const ordered = [...siblings].sort((left, right) => (
        (edgeRank.get(left.edgeId) ?? Number.MAX_SAFE_INTEGER) - (edgeRank.get(right.edgeId) ?? Number.MAX_SAFE_INTEGER)
        || geometry.steps.indexOf(left) - geometry.steps.indexOf(right)
        || left.id.localeCompare(right.id)
      ))
      const convergenceNodeId = findConvergenceNode(ordered, outgoing, nodeOrder)
      // In reverse playback a saved convergence becomes the runtime split, and the saved split
      // becomes its convergence. Reuse that branch's mode even though its outgoing edge IDs point
      // in the original direction.
      const savedOrder = directSavedOrder ?? (convergenceNodeId ? orderByNode.get(convergenceNodeId) : undefined)
      return {
        nodeId,
        mode: savedOrder?.mode ?? defaultMode,
        outgoingStepIds: ordered.map((step) => step.id),
        ...(convergenceNodeId ? { convergenceNodeId } : {}),
      }
    })
    .filter((branch): branch is PlaybackBranchDefinition => !!branch)
}

function createLinearPlaybackTimeline(
  geometry: PreparedPlaybackGeometry,
  options: BlueprintAnimationPlaybackOptions,
): PlaybackTimeline {
  let cursor = 0
  const nodeById = new Map(geometry.nodes.map((node) => [node.id, node]))
  const steps = geometry.steps.map((step): PlaybackTimelineStep => {
    const duration = stepDuration(step, options)
    const travelStartMs = cursor
    const travelEndMs = travelStartMs + duration
    const pauseEndMs = travelEndMs + pauseDuration(step, nodeById, options)
    cursor = pauseEndMs
    return { ...step, travelStartMs, travelEndMs, pauseEndMs }
  })
  const finalStep = steps[steps.length - 1]
  const finalNode = finalStep ? geometry.nodes.find((node) => node.id === finalStep.toNodeId) : undefined
  const finalActivationEnd = finalStep
    ? finalStep.travelEndMs + options.deviceReactionMs + (finalNode?.roles.includes('load') ? options.fixtureFadeMs : 0)
    : 0
  return {
    options,
    sourceNodeId: geometry.sourceNodeId,
    nodes: geometry.nodes,
    steps,
    totalDurationMs: options.reducedMotion ? 0 : Math.max(cursor, finalActivationEnd),
    hasBranches: false,
  }
}

export function createPlaybackTimeline(
  geometry: PreparedPlaybackGeometry,
  options: BlueprintAnimationPlaybackOptions,
): PlaybackTimeline {
  const topology = traversalTopology(geometry)
  const hasBranches = [...topology.reachableNodes].some((nodeId) => (
    (topology.outgoing.get(nodeId)?.length ?? 0) > 1 || (topology.incoming.get(nodeId)?.length ?? 0) > 1
  ))
  if (!hasBranches) return createLinearPlaybackTimeline(geometry, options)

  const duplicateEdgeIds = geometry.steps
    .map((step) => step.edgeId)
    .filter((edgeId, index, list) => list.indexOf(edgeId) !== index)
  if (duplicateEdgeIds.length > 0) throw new Error('Branch playback does not support repeated traversal edges.')

  const nodeById = new Map(geometry.nodes.map((node) => [node.id, node]))
  const stepById = new Map(geometry.steps.map((step) => [step.id, step]))
  const branches = detectPlaybackBranches(geometry, options.branchMode)
  const branchByNode = new Map(branches.map((branch) => [branch.nodeId, branch]))
  const scheduled = new Map<string, PlaybackTimelineStep>()

  type Boundary = { arrivalMs: number; readyMs: number }
  const scheduleStep = (step: PreparedPlaybackGeometryStep, startMs: number): PlaybackTimelineStep => {
    if (scheduled.has(step.id)) throw new Error(`Traversal step "${step.id}" is scheduled more than once.`)
    const travelEndMs = startMs + stepDuration(step, options)
    const result = { ...step, travelStartMs: startMs, travelEndMs, pauseEndMs: travelEndMs + pauseDuration(step, nodeById, options) }
    scheduled.set(step.id, result)
    return result
  }

  const compileNode = (nodeId: string, boundary: Boundary, stopNodeId?: string): Boundary => {
    if (nodeId === stopNodeId) return boundary
    const outgoingSteps = topology.outgoing.get(nodeId) ?? []
    if (outgoingSteps.length === 0) return boundary
    if (outgoingSteps.length === 1) {
      const timed = scheduleStep(outgoingSteps[0], boundary.readyMs)
      const next = { arrivalMs: timed.travelEndMs, readyMs: timed.pauseEndMs }
      return timed.toNodeId === stopNodeId ? next : compileNode(timed.toNodeId, next, stopNodeId)
    }

    const branch = branchByNode.get(nodeId)
    if (!branch) throw new Error(`Branch node "${nodeId}" has no deterministic schedule.`)
    const ordered = branch.outgoingStepIds.map((stepId) => stepById.get(stepId)).filter((step): step is PreparedPlaybackGeometryStep => !!step)
    let sequentialCursor = boundary.readyMs
    const results: Boundary[] = []
    ordered.forEach((step) => {
      const branchStart = branch.mode === 'sequential' ? sequentialCursor : boundary.readyMs
      const timed = scheduleStep(step, branchStart)
      const next = { arrivalMs: timed.travelEndMs, readyMs: timed.pauseEndMs }
      const result = timed.toNodeId === branch.convergenceNodeId
        ? next
        : compileNode(timed.toNodeId, next, branch.convergenceNodeId)
      results.push(result)
      if (branch.mode === 'sequential') sequentialCursor = result.readyMs
    })
    const joined = {
      arrivalMs: Math.max(...results.map((result) => result.arrivalMs)),
      readyMs: Math.max(...results.map((result) => result.readyMs)),
    }
    if (!branch.convergenceNodeId || branch.convergenceNodeId === stopNodeId) return joined
    return compileNode(branch.convergenceNodeId, joined, stopNodeId)
  }

  compileNode(geometry.sourceNodeId, { arrivalMs: 0, readyMs: 0 })
  if (scheduled.size !== geometry.steps.length) throw new Error('The traversal contains steps outside the reachable structured branch graph.')
  const steps = geometry.steps.map((step) => scheduled.get(step.id) as PlaybackTimelineStep)
  const totalDurationMs = options.reducedMotion ? 0 : Math.max(0, ...steps.map((step) => {
    const node = nodeById.get(step.toNodeId)
    const activationEnd = step.travelEndMs + options.deviceReactionMs + (node?.roles.includes('load') ? options.fixtureFadeMs : 0)
    return Math.max(step.pauseEndMs, activationEnd)
  }))
  return { options, sourceNodeId: geometry.sourceNodeId, nodes: geometry.nodes, steps, totalDurationMs, hasBranches: true }
}

function deviceStateAt(
  node: PreparedPlaybackNode,
  isPlaybackSource: boolean,
  arrivalMs: number,
  activeUntilMs: number,
  elapsedMs: number,
  options: BlueprintAnimationPlaybackOptions,
): PlaybackDeviceState {
  if (elapsedMs < arrivalMs || elapsedMs >= activeUntilMs) {
    return { nodeId: node.id, pageNumber: node.pageNumber, point: node.point, phase: 'idle', progress: 0 }
  }
  if (isPlaybackSource || node.roles.includes('source') || node.roles.includes('junction')) {
    return { nodeId: node.id, pageNumber: node.pageNumber, point: node.point, phase: 'active', progress: 1 }
  }
  const reactionEnd = arrivalMs + options.deviceReactionMs
  if (elapsedMs < reactionEnd) {
    return {
      nodeId: node.id,
      pageNumber: node.pageNumber,
      point: node.point,
      phase: 'reacting',
      progress: options.deviceReactionMs > 0 ? clamp01((elapsedMs - arrivalMs) / options.deviceReactionMs) : 1,
    }
  }
  if (node.roles.includes('load')) {
    const activationEnd = reactionEnd + options.fixtureFadeMs
    if (elapsedMs < activationEnd) {
      return {
        nodeId: node.id,
        pageNumber: node.pageNumber,
        point: node.point,
        phase: 'activating',
        progress: options.fixtureFadeMs > 0 ? clamp01((elapsedMs - reactionEnd) / options.fixtureFadeMs) : 1,
      }
    }
  }
  return { nodeId: node.id, pageNumber: node.pageNumber, point: node.point, phase: 'active', progress: 1 }
}

export function calculatePlaybackFrame(timeline: PlaybackTimeline, elapsedValue: number): PlaybackFrame {
  const rawElapsed = Math.max(0, Number.isFinite(elapsedValue) ? elapsedValue : 0)
  const complete = !timeline.options.loop && rawElapsed >= timeline.totalDurationMs
  const elapsedMs = timeline.options.loop && timeline.totalDurationMs > 0
    ? rawElapsed % timeline.totalDurationMs
    : Math.min(rawElapsed, timeline.totalDurationMs)
  const energizedEdges: PlaybackEnergizedEdgeState[] = []
  let orb: PlaybackOrbState | null = null
  const concurrentOrbs: PlaybackOrbState[] = []

  timeline.steps.forEach((step) => {
    if (step.kind !== 'circuit-segment' || !step.geometry || elapsedMs < step.travelStartMs) return
    const travelDuration = step.travelEndMs - step.travelStartMs
    const progress = travelDuration <= 0
      ? 1
      : clamp01((elapsedMs - step.travelStartMs) / travelDuration)
    energizedEdges.push({ edgeId: step.edgeId, pageNumber: step.pageNumber, channel: step.channel, progress, step })
    if (elapsedMs <= step.pauseEndMs && elapsedMs >= step.travelStartMs) {
      const nextOrb = {
        edgeId: step.edgeId,
        pageNumber: step.pageNumber,
        point: step.geometry.pointAtProgress(progress),
        progress,
      }
      orb = nextOrb
      concurrentOrbs.push(nextOrb)
    }
  })

  if (timeline.options.reducedMotion) orb = null
  const orbs = timeline.options.reducedMotion ? [] : timeline.hasBranches ? concurrentOrbs : orb ? [orb] : []
  const arrivalByNode = new Map<string, number>([[timeline.sourceNodeId, 0]])
  const activeUntilByNode = new Map<string, number>()
  timeline.steps.forEach((step) => {
    arrivalByNode.set(step.toNodeId, Math.max(arrivalByNode.get(step.toNodeId) ?? 0, step.travelEndMs))
    if (!timeline.options.holdActivatedNodes) {
      activeUntilByNode.set(step.fromNodeId, Math.min(activeUntilByNode.get(step.fromNodeId) ?? Number.POSITIVE_INFINITY, step.travelStartMs))
      if (!activeUntilByNode.has(step.toNodeId)) activeUntilByNode.set(step.toNodeId, Number.POSITIVE_INFINITY)
    }
  })
  const devices = timeline.nodes
    .filter((node) => arrivalByNode.has(node.id))
    .map((node) => deviceStateAt(
      node,
      node.id === timeline.sourceNodeId,
      arrivalByNode.get(node.id) as number,
      timeline.options.holdActivatedNodes ? Number.POSITIVE_INFINITY : activeUntilByNode.get(node.id) ?? Number.POSITIVE_INFINITY,
      timeline.options.reducedMotion ? Number.MAX_SAFE_INTEGER : elapsedMs,
      timeline.options,
    ))

  return { elapsedMs, complete, orb, orbs, energizedEdges, devices }
}
