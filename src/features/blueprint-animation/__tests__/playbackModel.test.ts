import { describe, expect, it } from 'vitest'
import { calculatePlaybackFrame, createPlaybackTimeline, detectPlaybackBranches, type PlaybackFrame } from '../playbackModel'
import { buildPlaybackSegmentGeometry, type PreparedPlaybackGeometry, type PreparedPlaybackNode } from '../playbackGeometry'
import { DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS } from '../sceneSchema'

function preparedGeometry(): PreparedPlaybackGeometry {
  const first = buildPlaybackSegmentGeometry({
    kind: 'straight', start: { x: 0, y: 0.5 }, end: { x: 0.25, y: 0.5 }, pageMetrics: { width: 1000, height: 1000 },
  })
  const second = buildPlaybackSegmentGeometry({
    kind: 'straight', start: { x: 0.25, y: 0.5 }, end: { x: 0.75, y: 0.5 }, pageMetrics: { width: 1000, height: 1000 },
  })
  return {
    sourceNodeId: 'source',
    nodes: [
      { id: 'source', pageNumber: 1, point: { x: 0, y: 0.5 }, roles: ['source'] },
      { id: 'junction', pageNumber: 1, point: { x: 0.25, y: 0.5 }, roles: ['junction'] },
      { id: 'load', pageNumber: 1, point: { x: 0.75, y: 0.5 }, roles: ['load'] },
    ],
    steps: [
      { id: 'step-1', edgeId: 'edge-1', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'source', toNodeId: 'junction', kind: 'circuit-segment', start: first.start, end: first.end, geometry: first },
      { id: 'step-2', edgeId: 'edge-2', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'junction', toNodeId: 'load', kind: 'circuit-segment', start: second.start, end: second.end, geometry: second },
    ],
  }
}

const options = {
  ...DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS,
  travelSpeed: 0.25,
  nodePauseMs: 200,
  deviceReactionMs: 100,
  fixtureFadeMs: 300,
}

describe('deterministic playback timeline', () => {
  it('makes segment duration exactly proportional to aspect-correct geometry length', () => {
    const timeline = createPlaybackTimeline(preparedGeometry(), options)
    expect(timeline.steps[0].travelEndMs - timeline.steps[0].travelStartMs).toBe(1000)
    expect(timeline.steps[1].travelEndMs - timeline.steps[1].travelStartMs).toBe(2000)
    expect(timeline.totalDurationMs).toBe(3600)
  })

  it('maps the same elapsed time to the same orb and energized state', () => {
    const timeline = createPlaybackTimeline(preparedGeometry(), options)
    const first = calculatePlaybackFrame(timeline, 1700)
    const replay = calculatePlaybackFrame(timeline, 1700)

    expect(replay).toEqual(first)
    expect(first.orb?.edgeId).toBe('edge-2')
    expect(first.orb?.progress).toBeCloseTo(0.25)
    expect(first.energizedEdges.map((edge) => [edge.edgeId, edge.progress])).toEqual([
      ['edge-1', 1],
      ['edge-2', 0.25],
    ])
  })

  it('derives reaction and fixture fade state from arrival time only', () => {
    const timeline = createPlaybackTimeline(preparedGeometry(), options)
    const arrival = timeline.steps[1].travelEndMs
    expect(calculatePlaybackFrame(timeline, arrival + 50).devices.find((device) => device.nodeId === 'load')).toMatchObject({ phase: 'reacting', progress: 0.5 })
    expect(calculatePlaybackFrame(timeline, arrival + 250).devices.find((device) => device.nodeId === 'load')).toMatchObject({ phase: 'activating', progress: 0.5 })
    expect(calculatePlaybackFrame(timeline, arrival + 500).devices.find((device) => device.nodeId === 'load')).toMatchObject({ phase: 'active', progress: 1 })
  })

  it('clamps completed playback and wraps loop playback deterministically', () => {
    const geometry = preparedGeometry()
    const finite = createPlaybackTimeline(geometry, options)
    expect(calculatePlaybackFrame(finite, 99999)).toMatchObject({ complete: true, elapsedMs: finite.totalDurationMs })

    const looping = createPlaybackTimeline(geometry, { ...options, loop: true })
    expect(calculatePlaybackFrame(looping, looping.totalDurationMs + 500)).toEqual(calculatePlaybackFrame(looping, 500))
  })

  it('reduces motion to an immediate final route with no orb', () => {
    const timeline = createPlaybackTimeline(preparedGeometry(), { ...options, reducedMotion: true })
    const frame = calculatePlaybackFrame(timeline, 0)
    expect(timeline.totalDurationMs).toBe(0)
    expect(frame.complete).toBe(true)
    expect(frame.orb).toBeNull()
    expect(frame.energizedEdges.map((edge) => edge.progress)).toEqual([1, 1])
    expect(frame.devices.every((device) => device.phase === 'active')).toBe(true)
  })
})

/** Full-width horizontal then full-height vertical on a 2:1 page. */
function nonSquarePageGeometry(): PreparedPlaybackGeometry {
  const pageMetrics = { width: 2000, height: 1000 }
  const horizontal = buildPlaybackSegmentGeometry({
    kind: 'straight', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, pageMetrics,
  })
  const vertical = buildPlaybackSegmentGeometry({
    kind: 'straight', start: { x: 1, y: 0 }, end: { x: 1, y: 1 }, pageMetrics,
  })
  return {
    sourceNodeId: 'source',
    nodes: [
      { id: 'source', pageNumber: 1, point: { x: 0, y: 0 }, roles: ['source'] },
      { id: 'corner', pageNumber: 1, point: { x: 1, y: 0 }, roles: ['junction'] },
      { id: 'load', pageNumber: 1, point: { x: 1, y: 1 }, roles: ['load'] },
    ],
    steps: [
      { id: 'h', edgeId: 'edge-h', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'source', toNodeId: 'corner', kind: 'circuit-segment', start: horizontal.start, end: horizontal.end, geometry: horizontal },
      { id: 'v', edgeId: 'edge-v', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'corner', toNodeId: 'load', kind: 'circuit-segment', start: vertical.start, end: vertical.end, geometry: vertical },
    ],
  }
}

/** Circuit segment into a junction, then a `direct` hop to the load — the direct step carries no geometry. */
function directEdgeGeometry(): PreparedPlaybackGeometry {
  const first = buildPlaybackSegmentGeometry({
    kind: 'straight', start: { x: 0, y: 0.5 }, end: { x: 0.5, y: 0.5 }, pageMetrics: { width: 1000, height: 1000 },
  })
  return {
    sourceNodeId: 'source',
    nodes: [
      { id: 'source', pageNumber: 1, point: { x: 0, y: 0.5 }, roles: ['source'] },
      { id: 'junction', pageNumber: 1, point: { x: 0.5, y: 0.5 }, roles: ['junction'] },
      { id: 'load', pageNumber: 1, point: { x: 0.9, y: 0.5 }, roles: ['load'] },
    ],
    steps: [
      { id: 'step-1', edgeId: 'edge-1', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'source', toNodeId: 'junction', kind: 'circuit-segment', start: first.start, end: first.end, geometry: first },
      { id: 'step-2', edgeId: 'edge-direct', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'junction', toNodeId: 'load', kind: 'direct', start: { x: 0.5, y: 0.5 }, end: { x: 0.9, y: 0.5 } },
    ],
  }
}

/** Three back-to-back direct fixture transitions with no circuit geometry between them. */
function consecutiveDirectEdgeGeometry(): PreparedPlaybackGeometry {
  return {
    sourceNodeId: 'source',
    nodes: [
      { id: 'source', pageNumber: 1, point: { x: 0.1, y: 0.5 }, roles: ['source'] },
      { id: 'load-1', pageNumber: 1, point: { x: 0.3, y: 0.5 }, roles: ['load'] },
      { id: 'load-2', pageNumber: 1, point: { x: 0.5, y: 0.5 }, roles: ['load'] },
      { id: 'load-3', pageNumber: 1, point: { x: 0.7, y: 0.5 }, roles: ['load'] },
    ],
    steps: [
      { id: 'direct-1', edgeId: 'edge-direct-1', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'source', toNodeId: 'load-1', kind: 'direct', start: { x: 0.1, y: 0.5 }, end: { x: 0.3, y: 0.5 } },
      { id: 'direct-2', edgeId: 'edge-direct-2', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'load-1', toNodeId: 'load-2', kind: 'direct', start: { x: 0.3, y: 0.5 }, end: { x: 0.5, y: 0.5 } },
      { id: 'direct-3', edgeId: 'edge-direct-3', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'load-2', toNodeId: 'load-3', kind: 'direct', start: { x: 0.5, y: 0.5 }, end: { x: 0.7, y: 0.5 } },
    ],
  }
}

/** Same shape as preparedGeometry(), but the middle node is a sensor rather than a junction. */
function sensorNodeGeometry(): PreparedPlaybackGeometry {
  const base = preparedGeometry()
  const nodes: PreparedPlaybackNode[] = base.nodes.map((node) =>
    node.id === 'junction' ? { ...node, roles: ['sensor'] } : node)
  return { ...base, nodes }
}

function branchedGeometry(mode: 'simultaneous' | 'sequential' = 'simultaneous'): PreparedPlaybackGeometry {
  const segment = (start: { x: number; y: number }, end: { x: number; y: number }) => buildPlaybackSegmentGeometry({
    kind: 'straight', start, end, pageMetrics: { width: 1000, height: 1000 },
  })
  const a1 = segment({ x: 0, y: 0.5 }, { x: 0.25, y: 0.25 })
  const a2 = segment({ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.5 })
  const b1 = segment({ x: 0, y: 0.5 }, { x: 0.5, y: 0.75 })
  const b2 = segment({ x: 0.5, y: 0.75 }, { x: 0.75, y: 0.5 })
  return {
    sourceNodeId: 'source',
    nodes: [
      { id: 'source', pageNumber: 1, point: { x: 0, y: 0.5 }, roles: ['source'] },
      { id: 'branch-a', pageNumber: 1, point: { x: 0.25, y: 0.25 }, roles: ['junction'] },
      { id: 'branch-b', pageNumber: 1, point: { x: 0.5, y: 0.75 }, roles: ['junction'] },
      { id: 'merge-load', pageNumber: 1, point: { x: 0.75, y: 0.5 }, roles: ['load'] },
    ],
    steps: [
      { id: 'a1', edgeId: 'edge-a1', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'source', toNodeId: 'branch-a', kind: 'circuit-segment', start: a1.start, end: a1.end, geometry: a1 },
      { id: 'a2', edgeId: 'edge-a2', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'branch-a', toNodeId: 'merge-load', kind: 'circuit-segment', start: a2.start, end: a2.end, geometry: a2 },
      { id: 'b1', edgeId: 'edge-b1', channel: 'low-voltage-control-signal', pageNumber: 1, fromNodeId: 'source', toNodeId: 'branch-b', kind: 'circuit-segment', start: b1.start, end: b1.end, geometry: b1 },
      { id: 'b2', edgeId: 'edge-b2', channel: 'low-voltage-control-signal', pageNumber: 1, fromNodeId: 'branch-b', toNodeId: 'merge-load', kind: 'circuit-segment', start: b2.start, end: b2.end, geometry: b2 },
    ],
    branchOrders: [{ id: 'source-branches', nodeId: 'source', mode, outgoingEdgeIds: ['edge-a1', 'edge-b1'] }],
  }
}

/** Observable frame payload. `step` is dropped: it is a back-reference to the timeline, not output. */
function serializeFrame(frame: PlaybackFrame): string {
  return JSON.stringify({
    elapsedMs: frame.elapsedMs,
    complete: frame.complete,
    orb: frame.orb,
    orbs: frame.orbs,
    energizedEdges: frame.energizedEdges.map(({ step, ...rest }) => rest),
    devices: frame.devices,
  })
}

// Golden output captured from the shipped ANIM4.1 linear scheduler before branch support.
// This intentionally pins the complete observable frame rather than re-deriving expectations.
const RECORDED_ANIM4_1_LINEAR_FRAME_AT_1700 = {
  elapsedMs: 1700,
  complete: false,
  orb: { edgeId: 'edge-2', pageNumber: 1, point: { x: 0.375, y: 0.5 }, progress: 0.25 },
  orbs: [{ edgeId: 'edge-2', pageNumber: 1, point: { x: 0.375, y: 0.5 }, progress: 0.25 }],
  energizedEdges: [
    { edgeId: 'edge-1', pageNumber: 1, channel: 'switched-line-voltage', progress: 1 },
    { edgeId: 'edge-2', pageNumber: 1, channel: 'switched-line-voltage', progress: 0.25 },
  ],
  devices: [
    { nodeId: 'source', pageNumber: 1, point: { x: 0, y: 0.5 }, phase: 'active', progress: 1 },
    { nodeId: 'junction', pageNumber: 1, point: { x: 0.25, y: 0.5 }, phase: 'active', progress: 1 },
    { nodeId: 'load', pageNumber: 1, point: { x: 0.75, y: 0.5 }, phase: 'idle', progress: 0 },
  ],
}

describe('aspect correction, direct edges and per-role reactions', () => {
  it('keeps segment durations aspect-correct on a non-square page', () => {
    const timeline = createPlaybackTimeline(nonSquarePageGeometry(), options)
    const horizontalMs = timeline.steps[0].travelEndMs - timeline.steps[0].travelStartMs
    const verticalMs = timeline.steps[1].travelEndMs - timeline.steps[1].travelStartMs

    // Lengths are normalized against the longer side, so on a 2:1 page a full-height vertical
    // run is half the length of a full-width horizontal run. travelSpeed 0.25 => length * 4000ms.
    expect(horizontalMs).toBeCloseTo(4000)
    expect(verticalMs).toBeCloseTo(2000)
    // Page shape must reach the durations: equal timings here would mean aspect was ignored and
    // the same normalized delta was being traversed at the same rate in both axes.
    expect(horizontalMs).not.toBeCloseTo(verticalMs)
  })

  it('treats a direct edge as an instant jump with no traversable geometry', () => {
    const timeline = createPlaybackTimeline(directEdgeGeometry(), options)
    const direct = timeline.steps[1]
    expect(direct.kind).toBe('direct')
    expect(direct.geometry).toBeUndefined()
    expect(direct.travelEndMs - direct.travelStartMs).toBe(0)

    const frame = calculatePlaybackFrame(timeline, direct.travelEndMs + 10)
    // The hop is never drawn and never traversed — no energized line, no orb riding it ...
    expect(frame.energizedEdges.map((edge) => edge.edgeId)).toEqual(['edge-1'])
    expect(frame.orb?.edgeId).not.toBe('edge-direct')
    // ... yet the node on its far side still arrives on schedule and reacts.
    expect(frame.devices.find((device) => device.nodeId === 'load')).toMatchObject({ phase: 'reacting' })
  })

  it('gives consecutive direct fixtures distinct observable activation windows', () => {
    const timeline = createPlaybackTimeline(consecutiveDirectEdgeGeometry(), {
      ...options,
      nodePauseMs: 0,
      holdActivatedNodes: false,
    })
    const activationWindowMs = options.deviceReactionMs + options.fixtureFadeMs

    expect(timeline.steps.map((step) => step.travelEndMs - step.travelStartMs)).toEqual([0, 0, 0])
    expect(timeline.steps.map((step) => step.travelStartMs)).toEqual([
      0,
      activationWindowMs,
      activationWindowMs * 2,
    ])

    timeline.steps.forEach((step, index) => {
      const frame = calculatePlaybackFrame(timeline, step.travelEndMs + options.deviceReactionMs + 1)
      expect(frame.devices.find((device) => device.nodeId === `load-${index + 1}`)).toMatchObject({
        phase: 'activating',
      })
      timeline.steps.slice(index + 1).forEach((laterStep) => {
        expect(frame.devices.find((device) => device.nodeId === laterStep.toNodeId)).toMatchObject({ phase: 'idle' })
      })
    })
  })

  it('activates a junction instantly on arrival with no reaction ramp', () => {
    const timeline = createPlaybackTimeline(preparedGeometry(), options)
    const arrival = timeline.steps[0].travelEndMs
    const junctionAt = (ms: number) =>
      calculatePlaybackFrame(timeline, ms).devices.find((device) => device.nodeId === 'junction')

    expect(junctionAt(arrival - 1)).toMatchObject({ phase: 'idle' })
    // A junction has no reacting/activating ramp — it is fully on the instant it is reached.
    expect(junctionAt(arrival)).toMatchObject({ phase: 'active', progress: 1 })
    expect(junctionAt(arrival + 1)).toMatchObject({ phase: 'active', progress: 1 })
  })

  it('gives a sensor a timed reaction that completes without a fixture fade', () => {
    const timeline = createPlaybackTimeline(sensorNodeGeometry(), options)
    const arrival = timeline.steps[0].travelEndMs
    const sensorAt = (ms: number) =>
      calculatePlaybackFrame(timeline, ms).devices.find((device) => device.nodeId === 'junction')

    // deviceReactionMs is 100, so halfway through the reaction is +50.
    expect(sensorAt(arrival + 50)).toMatchObject({ phase: 'reacting', progress: 0.5 })
    // Past the reaction a sensor goes straight to active: the 'activating' fade is load-only.
    expect(sensorAt(arrival + 150)).toMatchObject({ phase: 'active', progress: 1 })
  })

  it('produces byte-identical frames for the same elapsed time across rebuilt timelines', () => {
    for (const ms of [0, 250, 1000, 1700, 3200, 3599, 3600, 9999]) {
      const first = calculatePlaybackFrame(createPlaybackTimeline(preparedGeometry(), options), ms)
      const replay = calculatePlaybackFrame(createPlaybackTimeline(preparedGeometry(), options), ms)
      expect(serializeFrame(replay)).toBe(serializeFrame(first))
    }
  })
})

describe('branch playback scheduling', () => {
  it('detects a reachable split and its shared convergence node', () => {
    expect(detectPlaybackBranches(branchedGeometry())).toEqual([{
      nodeId: 'source',
      mode: 'simultaneous',
      outgoingStepIds: ['a1', 'b1'],
      convergenceNodeId: 'merge-load',
    }])
  })

  it('runs simultaneous branches from one clock with independent deterministic progress', () => {
    const firstTimeline = createPlaybackTimeline(branchedGeometry(), options)
    const replayTimeline = createPlaybackTimeline(branchedGeometry(), options)
    expect(firstTimeline.steps.find((step) => step.id === 'a1')?.travelStartMs).toBe(0)
    expect(firstTimeline.steps.find((step) => step.id === 'b1')?.travelStartMs).toBe(0)
    const elapsed = 500
    const first = calculatePlaybackFrame(firstTimeline, elapsed)
    const sameTimelineReplay = calculatePlaybackFrame(firstTimeline, elapsed)
    const replay = calculatePlaybackFrame(replayTimeline, elapsed)
    expect(serializeFrame(sameTimelineReplay)).toBe(serializeFrame(first))
    expect(serializeFrame(replay)).toBe(serializeFrame(first))
    expect(first.orbs.map((orb) => orb.edgeId).sort()).toEqual(['edge-a1', 'edge-b1'])
    expect(first.orbs[0].progress).not.toBe(first.orbs[1].progress)
  })

  it('serializes whole sibling paths when branch mode is sequential', () => {
    const timeline = createPlaybackTimeline(branchedGeometry('sequential'), options)
    const firstBranchEnd = timeline.steps.find((step) => step.id === 'a2')?.pauseEndMs as number
    expect(timeline.steps.find((step) => step.id === 'b1')?.travelStartMs).toBe(firstBranchEnd)
  })

  it('deduplicates convergence activation and starts it at the latest branch arrival', () => {
    const timeline = createPlaybackTimeline(branchedGeometry(), options)
    const incoming = timeline.steps.filter((step) => step.toNodeId === 'merge-load')
    const convergenceArrival = Math.max(...incoming.map((step) => step.travelEndMs))
    expect(calculatePlaybackFrame(timeline, convergenceArrival - 1).devices.filter((device) => device.nodeId === 'merge-load')).toEqual([
      expect.objectContaining({ phase: 'idle' }),
    ])
    expect(calculatePlaybackFrame(timeline, convergenceArrival + 50).devices.filter((device) => device.nodeId === 'merge-load')).toEqual([
      expect.objectContaining({ phase: 'reacting', progress: 0.5 }),
    ])
  })

  it('keeps the legacy linear cursor timings and sole orb behavior unchanged', () => {
    const timeline = createPlaybackTimeline(preparedGeometry(), options)
    expect(timeline.hasBranches).toBe(false)
    expect(timeline.steps.map((step) => [step.travelStartMs, step.travelEndMs, step.pauseEndMs])).toEqual([
      [0, 1000, 1200],
      [1200, 3200, 3400],
    ])
    const frame = calculatePlaybackFrame(timeline, 1700)
    expect(frame.orbs).toEqual(frame.orb ? [frame.orb] : [])
  })

  it('matches the complete recorded ANIM4.1 linear frame byte-for-byte', () => {
    const frame = calculatePlaybackFrame(createPlaybackTimeline(preparedGeometry(), options), 1700)
    expect(serializeFrame(frame)).toBe(JSON.stringify(RECORDED_ANIM4_1_LINEAR_FRAME_AT_1700))
  })
})
