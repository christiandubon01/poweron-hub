import type { NormalizedPoint } from './routeGeometry'
import type {
  PreparedPlaybackGeometry,
  PreparedPlaybackGeometryStep,
  PreparedPlaybackNode,
} from './playbackGeometry'
import type { BlueprintAnimationChannelType, BlueprintAnimationPlaybackOptions } from './types'

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
  energizedEdges: PlaybackEnergizedEdgeState[]
  devices: PlaybackDeviceState[]
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

export function createPlaybackTimeline(
  geometry: PreparedPlaybackGeometry,
  options: BlueprintAnimationPlaybackOptions,
): PlaybackTimeline {
  let cursor = 0
  const steps = geometry.steps.map((step): PlaybackTimelineStep => {
    const duration = options.reducedMotion || step.kind === 'direct'
      ? 0
      : (step.geometry?.length ?? 0) * 1000 / options.travelSpeed
    const travelStartMs = cursor
    const travelEndMs = travelStartMs + duration
    const pauseEndMs = travelEndMs + (options.reducedMotion ? 0 : options.nodePauseMs)
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
  }
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

  timeline.steps.forEach((step) => {
    if (step.kind !== 'circuit-segment' || !step.geometry || elapsedMs < step.travelStartMs) return
    const travelDuration = step.travelEndMs - step.travelStartMs
    const progress = travelDuration <= 0
      ? 1
      : clamp01((elapsedMs - step.travelStartMs) / travelDuration)
    energizedEdges.push({ edgeId: step.edgeId, pageNumber: step.pageNumber, channel: step.channel, progress, step })
    if (elapsedMs <= step.pauseEndMs && elapsedMs >= step.travelStartMs) {
      orb = {
        edgeId: step.edgeId,
        pageNumber: step.pageNumber,
        point: step.geometry.pointAtProgress(progress),
        progress,
      }
    }
  })

  if (timeline.options.reducedMotion) orb = null
  const arrivalByNode = new Map<string, number>([[timeline.sourceNodeId, 0]])
  const activeUntilByNode = new Map<string, number>()
  timeline.steps.forEach((step, index) => {
    arrivalByNode.set(step.toNodeId, step.travelEndMs)
    if (!timeline.options.holdActivatedNodes) {
      activeUntilByNode.set(step.fromNodeId, step.travelStartMs)
      activeUntilByNode.set(step.toNodeId, timeline.steps[index + 1]?.travelStartMs ?? Number.POSITIVE_INFINITY)
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

  return { elapsedMs, complete, orb, energizedEdges, devices }
}
