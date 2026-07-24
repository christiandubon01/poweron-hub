import { describe, expect, it } from 'vitest'
import { createPlaybackLoopController, type PlaybackLoopRuntime } from '../playbackLoopController'
import { buildPlaybackSegmentGeometry, type PreparedPlaybackGeometry } from '../playbackGeometry'
import { calculatePlaybackFrame, createPlaybackTimeline } from '../playbackModel'
import { DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS } from '../sceneSchema'

class FakePlaybackRuntime implements PlaybackLoopRuntime {
  private nextHandle = 1
  readonly frames = new Map<number, FrameRequestCallback>()
  readonly timeouts = new Map<number, () => void>()

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const handle = this.nextHandle++
    this.frames.set(handle, callback)
    return handle
  }

  cancelAnimationFrame(handle: number): void {
    this.frames.delete(handle)
  }

  setTimeout(callback: () => void): number {
    const handle = this.nextHandle++
    this.timeouts.set(handle, callback)
    return handle
  }

  clearTimeout(handle: number): void {
    this.timeouts.delete(handle)
  }

  runNextFrame(timestamp: number): void {
    const [handle, callback] = [...this.frames.entries()][0] ?? []
    if (handle == null || !callback) return
    this.frames.delete(handle)
    callback(timestamp)
  }

  runAllFrames(timestamp: number): void {
    const queued = [...this.frames.entries()]
    queued.forEach(([handle, callback]) => {
      if (!this.frames.has(handle)) return
      this.frames.delete(handle)
      callback(timestamp)
    })
  }

  runAllTimeouts(): void {
    const queued = [...this.timeouts.entries()]
    queued.forEach(([handle, callback]) => {
      if (!this.timeouts.has(handle)) return
      this.timeouts.delete(handle)
      callback()
    })
  }
}

const options = {
  ...DEFAULT_BLUEPRINT_ANIMATION_PLAYBACK_OPTIONS,
  travelSpeed: 1,
  nodePauseMs: 0,
  deviceReactionMs: 0,
  fixtureFadeMs: 0,
  loop: false,
}

function segment(start: { x: number; y: number }, end: { x: number; y: number }) {
  return buildPlaybackSegmentGeometry({
    kind: 'straight',
    start,
    end,
    pageMetrics: { width: 1000, height: 1000 },
  })
}

function commonFeederGeometry(): PreparedPlaybackGeometry {
  const common = segment({ x: 0, y: 0.5 }, { x: 0.1, y: 0.5 })
  const primary = segment({ x: 0.1, y: 0.5 }, { x: 0.2, y: 0.5 })
  const parallel = segment({ x: 0.1, y: 0.5 }, { x: 0.6, y: 0.5 })
  return {
    sourceNodeId: 'panel',
    nodes: [
      { id: 'panel', pageNumber: 1, point: { x: 0, y: 0.5 }, roles: ['source'] },
      { id: 'split', pageNumber: 1, point: { x: 0.1, y: 0.5 }, roles: ['junction'] },
      { id: 'primary-load', pageNumber: 1, point: { x: 0.2, y: 0.5 }, roles: ['load'] },
      { id: 'parallel-load', pageNumber: 1, point: { x: 0.6, y: 0.5 }, roles: ['load'] },
    ],
    steps: [
      { id: 'common', edgeId: 'edge-common', channel: 'constant-line-voltage', pageNumber: 1, fromNodeId: 'panel', toNodeId: 'split', kind: 'circuit-segment', start: common.start, end: common.end, geometry: common },
      { id: 'primary', edgeId: 'edge-primary', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'split', toNodeId: 'primary-load', kind: 'circuit-segment', start: primary.start, end: primary.end, geometry: primary },
      { id: 'parallel', edgeId: 'edge-parallel', channel: 'switched-line-voltage', pageNumber: 1, fromNodeId: 'split', toNodeId: 'parallel-load', kind: 'circuit-segment', start: parallel.start, end: parallel.end, geometry: parallel },
    ],
    branchOrders: [{ id: 'split-order', nodeId: 'split', mode: 'simultaneous', outgoingEdgeIds: ['edge-primary', 'edge-parallel'] }],
  }
}

function makeController(totalDurationMs: number) {
  const runtime = new FakePlaybackRuntime()
  const events: string[] = []
  const elapsed: number[] = []
  const statuses: string[] = []
  const controller = createPlaybackLoopController({
    totalDurationMs,
    runtime,
    callbacks: {
      onElapsedMs: (value) => elapsed.push(value),
      onStatus: (status) => statuses.push(status),
      onCycleReset: (cycle) => events.push(`reset:${cycle}`),
      onCycleStart: (cycle) => events.push(`start:${cycle}`),
      onCycleComplete: (cycle) => events.push(`complete:${cycle}`),
    },
  })
  return { controller, runtime, events, elapsed, statuses }
}

describe('playback loop controller', () => {
  it('loops a single route by resetting and starting the next cycle on the next frame', () => {
    const { controller, runtime, events, elapsed } = makeController(100)
    controller.play()
    runtime.runNextFrame(0)
    runtime.runNextFrame(100)

    expect(events).toEqual(['reset:0', 'start:1', 'complete:1', 'reset:1'])
    expect(elapsed[elapsed.length - 1]).toBe(0)
    runtime.runNextFrame(116)
    expect(events).toContain('start:2')
  })

  it('waits for every branch before queueing exactly one next cycle', () => {
    const timeline = createPlaybackTimeline(commonFeederGeometry(), options)
    const primaryEnd = timeline.steps.find((step) => step.id === 'primary')?.travelEndMs as number
    const finalEnd = timeline.totalDurationMs
    const { controller, runtime, events } = makeController(finalEnd)

    controller.play()
    runtime.runNextFrame(0)
    runtime.runNextFrame(primaryEnd)
    expect(events).toEqual(['reset:0', 'start:1'])

    runtime.runNextFrame(finalEnd)
    expect(events.filter((event) => event === 'complete:1')).toHaveLength(1)
    runtime.runNextFrame(finalEnd + 16)
    expect(events.filter((event) => event === 'start:2')).toHaveLength(1)
  })

  it('plays the common feeder once per cycle and only loops after terminal branches finish', () => {
    const timeline = createPlaybackTimeline(commonFeederGeometry(), options)
    expect(timeline.steps.find((step) => step.id === 'common')).toMatchObject({ travelStartMs: 0, travelEndMs: 100 })
    expect(timeline.totalDurationMs).toBe(600)

    const beforeSplit = calculatePlaybackFrame(timeline, 50)
    const afterSplit = calculatePlaybackFrame(timeline, 150)
    expect(beforeSplit.orbs.map((orb) => orb.edgeId)).toEqual(['edge-common'])
    expect(afterSplit.orbs.map((orb) => orb.edgeId).sort()).toEqual(['edge-parallel', 'edge-primary'])
  })

  it('hard-stops during primary traversal and clears frames, timers, progress and status', () => {
    const { controller, runtime, elapsed } = makeController(300)
    let delayed = false
    controller.play()
    controller.schedulePlaybackTimeout(() => { delayed = true }, 25)
    runtime.runNextFrame(0)
    runtime.runNextFrame(120)

    controller.stop()
    runtime.runAllFrames(300)
    runtime.runAllTimeouts()

    expect(delayed).toBe(false)
    expect(elapsed[elapsed.length - 1]).toBe(0)
    expect(controller.getSnapshot()).toMatchObject({ status: 'idle', activeFrameCount: 0, activeTimeoutCount: 0, cycleIndex: 0 })
  })

  it('hard-stops during parallel branch traversal without allowing branch frames to continue', () => {
    const timeline = createPlaybackTimeline(commonFeederGeometry(), options)
    const { controller, runtime, events } = makeController(timeline.totalDurationMs)
    controller.play()
    runtime.runNextFrame(0)
    runtime.runNextFrame(250)
    expect(calculatePlaybackFrame(timeline, 250).orbs.map((orb) => orb.edgeId)).toContain('edge-parallel')

    controller.stop()
    runtime.runAllFrames(600)

    expect(events).not.toContain('complete:1')
    expect(events).not.toContain('start:2')
    expect(controller.getSnapshot().status).toBe('idle')
  })

  it('guards a queued completion-boundary restart with the active session id', () => {
    const { controller, runtime, events } = makeController(100)
    controller.play()
    runtime.runNextFrame(0)
    runtime.runNextFrame(100)
    controller.stop()
    runtime.runAllFrames(116)

    expect(events).toEqual(['reset:0', 'start:1', 'complete:1', 'reset:1', 'reset:0'])
    expect(controller.getSnapshot()).toMatchObject({ status: 'idle', cycleIndex: 0 })
  })

  it('keeps repeated Play to one active session and one RAF chain', () => {
    const { controller, runtime } = makeController(100)
    controller.play()
    const firstSession = controller.getSnapshot().sessionId
    controller.play()

    expect(controller.getSnapshot().sessionId).toBe(firstSession + 1)
    expect(controller.getSnapshot().activeFrameCount).toBe(1)
    expect(runtime.frames.size).toBe(1)
  })

  it('starts cleanly after Stop and preserves pause/resume within the same cycle', () => {
    const { controller, runtime, events, elapsed } = makeController(200)
    controller.play()
    runtime.runNextFrame(0)
    runtime.runNextFrame(80)
    controller.pause()
    runtime.runAllFrames(200)
    expect(elapsed[elapsed.length - 1]).toBe(80)
    expect(events).not.toContain('complete:1')

    controller.resume()
    runtime.runNextFrame(100)
    runtime.runNextFrame(220)
    expect(events).toContain('complete:1')

    controller.stop()
    controller.play()
    expect(elapsed[elapsed.length - 1]).toBe(0)
    expect(events[events.length - 1]).toBe('start:1')
  })

  it('dispose cancels close/unmount work and loop state never mutates saved scene options', () => {
    const savedOptions = { ...options, loop: true, direction: 'reverse' as const }
    const runtimeOptions = { ...savedOptions, loop: false }
    const { controller, runtime, events } = makeController(100)

    controller.play()
    runtime.runNextFrame(0)
    controller.dispose()
    runtime.runAllFrames(100)

    expect(events).toEqual(['reset:0', 'start:1'])
    expect(savedOptions).toMatchObject({ loop: true, direction: 'reverse' })
    expect(runtimeOptions).toMatchObject({ loop: false, direction: 'reverse' })
  })
})
