import { describe, expect, it } from 'vitest'
import { calculatePlaybackFrame, createPlaybackTimeline, type PlaybackFrame } from '../playbackModel'
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

/** Same shape as preparedGeometry(), but the middle node is a sensor rather than a junction. */
function sensorNodeGeometry(): PreparedPlaybackGeometry {
  const base = preparedGeometry()
  const nodes: PreparedPlaybackNode[] = base.nodes.map((node) =>
    node.id === 'junction' ? { ...node, roles: ['sensor'] } : node)
  return { ...base, nodes }
}

/** Observable frame payload. `step` is dropped: it is a back-reference to the timeline, not output. */
function serializeFrame(frame: PlaybackFrame): string {
  return JSON.stringify({
    elapsedMs: frame.elapsedMs,
    complete: frame.complete,
    orb: frame.orb,
    energizedEdges: frame.energizedEdges.map(({ step, ...rest }) => rest),
    devices: frame.devices,
  })
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
