import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlaybackRouteOverlay } from '../PackageAnimationPlaybackControls'
import {
  DEFAULT_AUTHORED_CIRCUIT_COLOR,
  buildPlaybackRouteEdgeAppearanceMap,
  resolveAuthoredCircuitColor,
  resolvePlaybackGlowColor,
  resolvePlaybackOrbColor,
  resolvePlaybackPathState,
} from '../playbackPathAppearance'
import { createPlaybackLoopController, type PlaybackLoopRuntime } from '../playbackLoopController'
import type { PlaybackFrame, PlaybackTimeline } from '../playbackModel'

class FakePlaybackRuntime implements PlaybackLoopRuntime {
  private nextHandle = 1
  readonly frames = new Map<number, FrameRequestCallback>()

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const handle = this.nextHandle++
    this.frames.set(handle, callback)
    return handle
  }

  cancelAnimationFrame(handle: number): void {
    this.frames.delete(handle)
  }

  runNextFrame(timestamp: number): void {
    const [handle, callback] = [...this.frames.entries()][0] ?? []
    if (handle == null || !callback) return
    this.frames.delete(handle)
    callback(timestamp)
  }

  runAllFrames(timestamp: number): void {
    ;[...this.frames.entries()].forEach(([handle, callback]) => {
      if (!this.frames.has(handle)) return
      this.frames.delete(handle)
      callback(timestamp)
    })
  }
}

const annotations = [
  { id: 'yellow-path', color: '#111111', borderColor: '#facc15' },
  { id: 'red-path', borderColor: '#ef4444' },
  { id: 'blue-path', borderColor: '#3b82f6' },
  { id: 'custom-arc', borderColor: '#12abef' },
]

const scene = {
  edges: [
    { id: 'panel-connector', fromNodeId: 'panel', toNodeId: 'yellow-start', geometry: { kind: 'direct' as const } },
    { id: 'yellow-edge', fromNodeId: 'yellow-start', toNodeId: 'split', geometry: { kind: 'circuit-segment' as const, annotationId: 'yellow-path' } },
    { id: 'red-primary', fromNodeId: 'split', toNodeId: 'primary-load', geometry: { kind: 'circuit-segment' as const, annotationId: 'red-path' } },
    { id: 'blue-parallel', fromNodeId: 'split', toNodeId: 'parallel-load', geometry: { kind: 'circuit-segment' as const, annotationId: 'blue-path' } },
    { id: 'custom-arc-edge', fromNodeId: 'parallel-load', toNodeId: 'terminal', geometry: { kind: 'circuit-segment' as const, annotationId: 'custom-arc' } },
    { id: 'terminal-connector', fromNodeId: 'terminal', toNodeId: 'receptacle', geometry: { kind: 'direct' as const } },
  ],
  manualTraversal: [
    { edgeId: 'panel-connector' },
    { edgeId: 'yellow-edge' },
    { edgeId: 'red-primary' },
    { edgeId: 'blue-parallel' },
    { edgeId: 'custom-arc-edge' },
    { edgeId: 'terminal-connector' },
  ],
}

const overlaySteps = [
  {
    id: 'panel-step',
    edgeId: 'panel-connector',
    channel: 'generic-route' as const,
    pageNumber: 1,
    fromNodeId: 'panel',
    toNodeId: 'yellow-start',
    kind: 'direct' as const,
    start: { x: 0.1, y: 0.5 },
    end: { x: 0.3, y: 0.5 },
    travelStartMs: 0,
    travelEndMs: 0,
    pauseEndMs: 200,
  },
  {
    id: 'yellow-step',
    edgeId: 'yellow-edge',
    channel: 'generic-route' as const,
    pageNumber: 1,
    fromNodeId: 'yellow-start',
    toNodeId: 'split',
    kind: 'circuit-segment' as const,
    start: { x: 0.3, y: 0.5 },
    end: { x: 0.6, y: 0.5 },
    geometry: {
      kind: 'straight' as const,
      start: { x: 0.3, y: 0.5 },
      end: { x: 0.6, y: 0.5 },
      length: 0.3,
      lookup: [],
      pointAtProgress: (progress: number) => ({ x: 0.3 + 0.3 * progress, y: 0.5 }),
      renderPoints: [{ x: 0.3, y: 0.5 }, { x: 0.6, y: 0.5 }],
    },
    travelStartMs: 200,
    travelEndMs: 500,
    pauseEndMs: 700,
  },
  {
    id: 'red-terminal-step',
    edgeId: 'red-terminal-connector',
    channel: 'generic-route' as const,
    pageNumber: 1,
    fromNodeId: 'red-end',
    toNodeId: 'receptacle',
    kind: 'direct' as const,
    start: { x: 0.7, y: 0.5 },
    end: { x: 0.9, y: 0.5 },
    travelStartMs: 700,
    travelEndMs: 700,
    pauseEndMs: 900,
  },
] satisfies PlaybackTimeline['steps']

function overlayMarkup(options: {
  edgeId: string
  color?: string
  steps?: PlaybackTimeline['steps']
  orbs?: PlaybackFrame['orbs']
  energizedEdges?: PlaybackFrame['energizedEdges']
  elapsedMs?: number
}) {
  const color = options.color ?? edgeColors().get(options.edgeId)?.overlayColor ?? DEFAULT_AUTHORED_CIRCUIT_COLOR
  const appearances = new Map([[options.edgeId, { baseColor: color, overlayColor: color }]])
  const steps = options.steps ?? overlaySteps.filter((step) => step.edgeId === options.edgeId)
  const energizedEdges = options.energizedEdges ?? steps.map((step) => ({
    edgeId: step.edgeId,
    pageNumber: step.pageNumber,
    channel: step.channel,
    progress: 1,
    step,
  }))
  const orbs = options.orbs ?? [{
    edgeId: options.edgeId,
    pageNumber: 1,
    point: steps[0]?.end ?? { x: 0.5, y: 0.5 },
    progress: 1,
  }]
  return renderToStaticMarkup(createElement(PlaybackRouteOverlay, {
    frame: {
      elapsedMs: options.elapsedMs ?? steps[0]?.travelEndMs ?? 0,
      complete: false,
      orb: orbs[0] ?? null,
      orbs,
      energizedEdges,
      devices: [],
    },
    steps,
    routeEdgeAppearances: appearances,
    currentPage: 1,
    pageWidth: 1000,
    pageHeight: 1000,
    overlayWidth: 1000,
    overlayHeight: 1000,
    playing: true,
  }))
}

function edgeColors() {
  return buildPlaybackRouteEdgeAppearanceMap(scene, annotations)
}

function visibleOverlay(progress: number, pathState: ReturnType<typeof resolvePlaybackPathState>) {
  return pathState !== 'not-yet' && progress > 0
}

describe('ANIM-5.6 authored route colors', () => {
  it('keeps a yellow authored base color and derives yellow playback glow', () => {
    const yellow = resolveAuthoredCircuitColor(annotations[0])
    expect(yellow).toBe('#facc15')
    expect(resolvePlaybackGlowColor(yellow)).toBe('#facc15')
    expect(visibleOverlay(0, 'not-yet')).toBe(false)
    expect(visibleOverlay(0.5, 'dim-pulsing')).toBe(true)
    expect(visibleOverlay(0, 'not-yet')).toBe(false)
  })

  it('preserves red, blue, and custom hex colors independently', () => {
    const colors = edgeColors()
    expect(colors.get('red-primary')).toEqual({ baseColor: '#ef4444', overlayColor: '#ef4444' })
    expect(colors.get('blue-parallel')).toEqual({ baseColor: '#3b82f6', overlayColor: '#3b82f6' })
    expect(colors.get('custom-arc-edge')).toEqual({ baseColor: '#12abef', overlayColor: '#12abef' })
  })

  it('keeps multiple route colors from leaking across edges', () => {
    const colors = edgeColors()
    expect(colors.get('yellow-edge')?.baseColor).toBe('#facc15')
    expect(colors.get('red-primary')?.baseColor).toBe('#ef4444')
    expect(colors.get('blue-parallel')?.baseColor).toBe('#3b82f6')
    expect(new Set([...colors.values()].map((color) => color.baseColor))).toEqual(new Set(['#facc15', '#ef4444', '#3b82f6', '#12abef']))
  })

  it('uses the same authored-color rule for Circuit Path and Circuit Arc geometry', () => {
    const colors = edgeColors()
    expect(colors.get('yellow-edge')?.overlayColor).toBe('#facc15')
    expect(colors.get('custom-arc-edge')?.overlayColor).toBe('#12abef')
  })

  it('inherits source and terminal connector colors from adjacent physical route edges', () => {
    const colors = edgeColors()
    expect(colors.get('panel-connector')).toEqual({ baseColor: '#facc15', overlayColor: '#facc15' })
    expect(colors.get('terminal-connector')).toEqual({ baseColor: '#12abef', overlayColor: '#12abef' })
  })

  it('renders panel-to-route direct connector glow and orb in inherited yellow with no cyan', () => {
    const markup = overlayMarkup({ edgeId: 'panel-connector' })
    expect(markup).toContain('data-playback-route-glow="direct"')
    expect(markup).toContain('stroke="#facc15"')
    expect(markup).toContain('data-playback-orb="true"')
    expect(markup).not.toContain('#22d3ee')
  })

  it('renders route-to-terminal direct connector glow and orb in inherited red', () => {
    const terminalScene = {
      edges: [
        { id: 'red-arc', fromNodeId: 'route-start', toNodeId: 'red-end', geometry: { kind: 'circuit-segment' as const, annotationId: 'red-path' } },
        { id: 'red-terminal-connector', fromNodeId: 'red-end', toNodeId: 'receptacle', geometry: { kind: 'direct' as const } },
      ],
      manualTraversal: [{ edgeId: 'red-arc' }, { edgeId: 'red-terminal-connector' }],
    }
    const colors = buildPlaybackRouteEdgeAppearanceMap(terminalScene, annotations)
    expect(colors.get('red-arc')).toEqual({ baseColor: '#ef4444', overlayColor: '#ef4444' })
    expect(colors.get('red-terminal-connector')).toEqual({ baseColor: '#ef4444', overlayColor: '#ef4444' })
    const markup = overlayMarkup({ edgeId: 'red-terminal-connector', color: colors.get('red-terminal-connector')?.overlayColor })
    expect(markup).toContain('data-playback-route-glow="direct"')
    expect(markup).toContain('stroke="#ef4444"')
    expect(markup).not.toContain('#22d3ee')
  })

  it('keeps direct source fan-out connectors on their own branch authored colors', () => {
    const fanOutScene = {
      edges: [
        { id: 'connector-a', fromNodeId: 'panel', toNodeId: 'yellow-start', geometry: { kind: 'direct' as const } },
        { id: 'connector-b', fromNodeId: 'panel', toNodeId: 'blue-start', geometry: { kind: 'direct' as const } },
        { id: 'yellow-branch', fromNodeId: 'yellow-start', toNodeId: 'yellow-load', geometry: { kind: 'circuit-segment' as const, annotationId: 'yellow-path' } },
        { id: 'blue-branch', fromNodeId: 'blue-start', toNodeId: 'blue-load', geometry: { kind: 'circuit-segment' as const, annotationId: 'blue-path' } },
      ],
      manualTraversal: [
        { edgeId: 'connector-a' },
        { edgeId: 'yellow-branch' },
        { edgeId: 'connector-b' },
        { edgeId: 'blue-branch' },
      ],
      branchOrders: [{ nodeId: 'panel', outgoingEdgeIds: ['connector-a', 'connector-b'] }],
    }
    const colors = buildPlaybackRouteEdgeAppearanceMap(fanOutScene, annotations)
    expect(colors.get('connector-a')?.overlayColor).toBe('#facc15')
    expect(colors.get('connector-b')?.overlayColor).toBe('#3b82f6')
  })

  it('uses deterministic branch structure instead of scene.edges order at ambiguous junctions', () => {
    const ambiguousScene = {
      edges: [
        { id: 'yellow-route', fromNodeId: 'yellow-start', toNodeId: 'junction', geometry: { kind: 'circuit-segment' as const, annotationId: 'yellow-path' } },
        { id: 'red-route', fromNodeId: 'red-start', toNodeId: 'junction', geometry: { kind: 'circuit-segment' as const, annotationId: 'red-path' } },
        { id: 'yellow-direct', fromNodeId: 'junction', toNodeId: 'yellow-load', geometry: { kind: 'direct' as const } },
        { id: 'red-direct', fromNodeId: 'junction', toNodeId: 'red-load', geometry: { kind: 'direct' as const } },
        { id: 'yellow-terminal', fromNodeId: 'yellow-load', toNodeId: 'yellow-terminal', geometry: { kind: 'circuit-segment' as const, annotationId: 'yellow-path' } },
        { id: 'red-terminal', fromNodeId: 'red-load', toNodeId: 'red-terminal', geometry: { kind: 'circuit-segment' as const, annotationId: 'red-path' } },
      ],
      manualTraversal: [
        { edgeId: 'yellow-route' },
        { edgeId: 'yellow-direct' },
        { edgeId: 'yellow-terminal' },
        { edgeId: 'red-route' },
        { edgeId: 'red-direct' },
        { edgeId: 'red-terminal' },
      ],
      branchOrders: [{ nodeId: 'junction', outgoingEdgeIds: ['yellow-direct', 'red-direct'] }],
    }
    const colors = buildPlaybackRouteEdgeAppearanceMap(ambiguousScene, annotations)
    const reordered = buildPlaybackRouteEdgeAppearanceMap({ ...ambiguousScene, edges: [...ambiguousScene.edges].reverse() }, annotations)
    expect(colors.get('yellow-direct')?.overlayColor).toBe('#facc15')
    expect(colors.get('red-direct')?.overlayColor).toBe('#ef4444')
    expect(reordered.get('yellow-direct')).toEqual(colors.get('yellow-direct'))
    expect(reordered.get('red-direct')).toEqual(colors.get('red-direct'))
  })

  it('keeps primary and parallel branches on their authored colors with no cyan or amber accent', () => {
    const colors = edgeColors()
    expect(colors.get('red-primary')?.baseColor).toBe('#ef4444')
    expect(colors.get('blue-parallel')?.baseColor).toBe('#3b82f6')
    expect([...colors.values()].some((color) => color.baseColor === '#22d3ee' || color.baseColor === '#f59e0b')).toBe(false)
  })

  it('resets overlay visibility between loop cycles without changing base colors', () => {
    const runtime = new FakePlaybackRuntime()
    const elapsed: number[] = []
    const controller = createPlaybackLoopController({
      totalDurationMs: 100,
      runtime,
      callbacks: { onElapsedMs: (value) => elapsed.push(value), onStatus: () => {} },
    })
    const colorsBefore = edgeColors()
    controller.play()
    runtime.runNextFrame(0)
    runtime.runNextFrame(50)
    expect(visibleOverlay(0.5, 'dim-pulsing')).toBe(true)
    runtime.runNextFrame(100)
    expect(elapsed[elapsed.length - 1]).toBe(0)
    expect(edgeColors()).toEqual(colorsBefore)
    runtime.runNextFrame(116)
    expect(visibleOverlay(0.25, 'dim-pulsing')).toBe(true)
  })

  it('hard Stop and Pause affect only overlay progress, never authored base colors', () => {
    const runtime = new FakePlaybackRuntime()
    const elapsed: number[] = []
    const controller = createPlaybackLoopController({
      totalDurationMs: 100,
      runtime,
      callbacks: { onElapsedMs: (value) => elapsed.push(value), onStatus: () => {} },
    })
    controller.play()
    runtime.runNextFrame(0)
    runtime.runNextFrame(40)
    controller.pause()
    runtime.runAllFrames(100)
    expect(elapsed[elapsed.length - 1]).toBe(40)
    expect(edgeColors().get('yellow-edge')?.baseColor).toBe('#facc15')
    controller.stop()
    runtime.runAllFrames(140)
    expect(elapsed[elapsed.length - 1]).toBe(0)
    expect(visibleOverlay(0, 'not-yet')).toBe(false)
    expect(edgeColors().get('yellow-edge')?.baseColor).toBe('#facc15')
  })

  it('keeps colors tied to physical edges under reverse traversal', () => {
    const reverseScene = { ...scene, manualTraversal: [...scene.manualTraversal].reverse() }
    const colors = buildPlaybackRouteEdgeAppearanceMap(reverseScene, annotations)
    expect(colors.get('yellow-edge')?.baseColor).toBe('#facc15')
    expect(colors.get('red-primary')?.baseColor).toBe('#ef4444')
    expect(colors.get('blue-parallel')?.baseColor).toBe('#3b82f6')
    expect(colors.get('panel-connector')?.baseColor).toBe('#facc15')
    expect(colors.get('terminal-connector')?.baseColor).toBe('#12abef')
  })

  it('uses a safe legacy fallback for missing annotation colors without mutating scene data', () => {
    const legacyScene = {
      edges: [{ id: 'missing', fromNodeId: 'a', toNodeId: 'b', geometry: { kind: 'circuit-segment' as const, annotationId: 'missing-ann' } }],
      manualTraversal: [{ edgeId: 'missing' }],
    }
    const before = JSON.stringify(legacyScene)
    const colors = buildPlaybackRouteEdgeAppearanceMap(legacyScene, [])
    expect(colors.get('missing')).toEqual({ baseColor: DEFAULT_AUTHORED_CIRCUIT_COLOR, overlayColor: DEFAULT_AUTHORED_CIRCUIT_COLOR })
    expect(JSON.stringify(legacyScene)).toBe(before)
  })

  it('renders playback route overlays, direct connector paths, and orbs as noninteractive SVG elements', () => {
    const markup = overlayMarkup({ edgeId: 'panel-connector' })
    expect(markup).toContain('pointer-events-none')
    expect(markup).toContain('pointer-events="none"')
    expect(markup).toContain('data-playback-route-glow="direct"')
    expect(markup).toContain('data-playback-orb="true"')
  })

  it('resolves orb color from the active edge appearance with authored-color fallback', () => {
    expect(resolvePlaybackOrbColor({ baseColor: '#facc15', overlayColor: '#facc15' })).toBe('#facc15')
    expect(resolvePlaybackOrbColor({ baseColor: '#ef4444', overlayColor: '#ef4444' })).toBe('#ef4444')
    expect(resolvePlaybackOrbColor({ baseColor: '#12abef', overlayColor: '#12abef' })).toBe('#12abef')
    expect(resolvePlaybackOrbColor(undefined)).toBe(DEFAULT_AUTHORED_CIRCUIT_COLOR)
  })

  it('updates rendered orb color when the active edge changes', () => {
    const yellow = overlayMarkup({ edgeId: 'yellow-edge', steps: [overlaySteps[1]], color: '#facc15' })
    const red = overlayMarkup({ edgeId: 'red-terminal-connector', steps: [overlaySteps[2]], color: '#ef4444' })
    expect(yellow).toContain('stroke="#facc15"')
    expect(yellow).not.toContain('stroke="#ef4444"')
    expect(red).toContain('stroke="#ef4444"')
    expect(red).not.toContain('stroke="#22d3ee"')
  })

  it('removes the orb on Stop and between-loop reset, then recreates it with the current edge color', () => {
    const active = overlayMarkup({ edgeId: 'yellow-edge', steps: [overlaySteps[1]], color: '#facc15' })
    const stopped = overlayMarkup({ edgeId: 'yellow-edge', steps: [overlaySteps[1]], color: '#facc15', orbs: [] })
    const reset = overlayMarkup({
      edgeId: 'yellow-edge',
      steps: [overlaySteps[1]],
      color: '#facc15',
      orbs: [],
      energizedEdges: [],
      elapsedMs: 0,
    })
    const nextLoop = overlayMarkup({ edgeId: 'yellow-edge', steps: [overlaySteps[1]], color: '#facc15' })
    expect(active).toContain('data-playback-orb="true"')
    expect(stopped).not.toContain('data-playback-orb="true"')
    expect(reset).not.toContain('data-playback-orb="true"')
    expect(nextLoop).toContain('stroke="#facc15"')
  })
})
