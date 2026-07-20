import { describe, expect, it } from 'vitest'
import {
  PLAYBACK_SOURCE_PULSE_MS,
  buildPlaybackActivationEventNodeIds,
  classifyPlaybackNodeVisualRole,
  easeOutCubic,
  resolvePlaybackDeviceVisual,
  type PlaybackNodeVisualRole,
} from '../playbackFixtureAppearance'
import type { BlueprintAnimationEventDefinition } from '../types'

function visual(
  visualRole: PlaybackNodeVisualRole,
  phase: 'idle' | 'reacting' | 'activating' | 'active',
  progress = 0,
  extra: { elapsedMs?: number; hasActivationEvent?: boolean } = {},
) {
  return resolvePlaybackDeviceVisual({
    visualRole,
    phase,
    progress,
    elapsedMs: extra.elapsedMs ?? 10_000,
    ...(extra.hasActivationEvent != null ? { hasActivationEvent: extra.hasActivationEvent } : {}),
  })
}

describe('playback node visual role classification', () => {
  it('resolves each role a playable scene can carry', () => {
    expect(classifyPlaybackNodeVisualRole(['source'])).toBe('source')
    expect(classifyPlaybackNodeVisualRole(['junction'])).toBe('junction')
    expect(classifyPlaybackNodeVisualRole(['load'])).toBe('load')
    expect(classifyPlaybackNodeVisualRole(['control'])).toBe('control')
    expect(classifyPlaybackNodeVisualRole(['sensor'])).toBe('control')
    expect(classifyPlaybackNodeVisualRole([])).toBe('passive')
    expect(classifyPlaybackNodeVisualRole(undefined)).toBe('passive')
  })

  it('keeps multi-role precedence identical to the timeline that produced the phase', () => {
    // playbackModel checks source/junction before load, so the visual must agree or a node would
    // be drawn as a fading fixture while the timeline holds it permanently active.
    expect(classifyPlaybackNodeVisualRole(['load', 'source'])).toBe('source')
    expect(classifyPlaybackNodeVisualRole(['load', 'junction'])).toBe('junction')
    expect(classifyPlaybackNodeVisualRole(['control', 'load'])).toBe('load')
  })

  it('treats the traversal source as a source whatever roles it declares', () => {
    expect(classifyPlaybackNodeVisualRole(['load'], true)).toBe('source')
  })
})

describe('device visual treatment by role', () => {
  it('renders nothing at all while a device is idle', () => {
    expect(visual('load', 'idle').kind).toBe('none')
    expect(visual('control', 'idle').kind).toBe('none')
    expect(visual('source', 'idle', 0, { elapsedMs: 0 }).kind).toBe('none')
  })

  it('never draws a junction — the energized route line is the only signal', () => {
    expect(visual('junction', 'active', 1).kind).toBe('none')
    expect(visual('junction', 'reacting', 0.5).kind).toBe('none')
  })

  it('pulses the source briefly at the start and then stops', () => {
    const start = visual('source', 'active', 1, { elapsedMs: 0 })
    const mid = visual('source', 'active', 1, { elapsedMs: PLAYBACK_SOURCE_PULSE_MS / 2 })
    expect(start.kind).toBe('source-pulse')
    expect(start.ringStrength).toBe(1)
    expect(mid.ringStrength).toBeCloseTo(0.5, 5)
    expect(mid.ringStrength).toBeLessThan(start.ringStrength)
    expect(visual('source', 'active', 1, { elapsedMs: PLAYBACK_SOURCE_PULSE_MS }).kind).toBe('none')
    expect(visual('source', 'active', 1, { elapsedMs: 10_000 }).kind).toBe('none')
  })

  it('drops the source pulse under reduced motion', () => {
    // Reduced motion pins elapsed at 0 for the whole run, so a time-derived pulse would otherwise
    // sit at full strength permanently — an animation in the mode that asks for none.
    const result = resolvePlaybackDeviceVisual({
      visualRole: 'source', phase: 'active', progress: 1, elapsedMs: 0, reducedMotion: true,
    })
    expect(result.kind).toBe('none')
  })

  it('still settles a fixture on its configured appearance under reduced motion', () => {
    const result = resolvePlaybackDeviceVisual({
      visualRole: 'load', phase: 'active', progress: 1, elapsedMs: 0, reducedMotion: true,
    })
    expect(result.kind).toBe('energized')
    expect(result.glowRadiusFraction).toBe(1)
    expect(result.glowOpacity).toBe(1)
  })
})

describe('control devices never self-activate', () => {
  it('shows ready and emits no light for every phase it can reach', () => {
    for (const phase of ['reacting', 'activating', 'active'] as const) {
      const result = visual('control', phase, 1)
      expect(result.kind).toBe('ready')
      expect(result.glowOpacity).toBe(0)
      expect(result.glowRadiusFraction).toBe(0)
    }
  })

  it('holds ready even once the timeline reports it fully active', () => {
    expect(visual('control', 'active', 1, { hasActivationEvent: false }).kind).toBe('ready')
  })

  it('energizes only when the saved scene explicitly activates it', () => {
    expect(visual('control', 'active', 1, { hasActivationEvent: true }).kind).toBe('energized')
  })
})

describe('load fixture activation', () => {
  it('reacts before drawing any light', () => {
    const result = visual('load', 'reacting', 0.5)
    expect(result.kind).toBe('reacting')
    expect(result.glowOpacity).toBe(0)
    expect(result.glowRadiusFraction).toBe(0)
    expect(result.ringStrength).toBe(0.5)
  })

  it('fades the glow up monotonically while activating', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map((progress) => visual('load', 'activating', progress))
    samples.forEach((sample) => expect(sample.kind).toBe('energized'))
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].glowOpacity).toBeGreaterThan(samples[index - 1].glowOpacity)
      expect(samples[index].glowRadiusFraction).toBeGreaterThan(samples[index - 1].glowRadiusFraction)
    }
  })

  it('opens partly rather than from nothing so it reads as a light coming up', () => {
    expect(visual('load', 'activating', 0).glowRadiusFraction).toBeGreaterThan(0)
    expect(visual('load', 'activating', 0).glowOpacity).toBe(0)
  })

  it('lands exactly on the fixture\'s own configured appearance once active', () => {
    // The whole point of ANIM-4: a fully activated fixture is its saved Light Output, untouched.
    const active = visual('load', 'active', 1)
    expect(active.kind).toBe('energized')
    expect(active.glowRadiusFraction).toBe(1)
    expect(active.glowOpacity).toBe(1)
    expect(visual('load', 'activating', 1).glowRadiusFraction).toBe(1)
    expect(visual('load', 'activating', 1).glowOpacity).toBe(1)
  })

  it('keeps a residual ring so route membership stays legible when lit', () => {
    expect(visual('load', 'active', 1).ringStrength).toBeGreaterThan(0)
    expect(visual('load', 'active', 1).ringStrength).toBeLessThan(1)
  })

  it('clamps progress that arrives out of range', () => {
    expect(visual('load', 'activating', 5).glowOpacity).toBe(1)
    expect(visual('load', 'activating', -3).glowOpacity).toBe(0)
    expect(visual('load', 'activating', Number.NaN).glowOpacity).toBe(0)
  })
})

describe('activation event index', () => {
  it('collects only explicit activate-node ids', () => {
    const events = [
      { id: 'e1', type: 'activate-node', nodeId: 'switch-1' },
      { id: 'e2', type: 'deactivate-node', nodeId: 'switch-2' },
      { id: 'e3', type: 'send-control-signal', nodeId: 'switch-3' },
      { id: 'e4', type: 'activate-node' },
    ] as BlueprintAnimationEventDefinition[]
    const ids = buildPlaybackActivationEventNodeIds(events)
    expect([...ids]).toEqual(['switch-1'])
  })

  it('is empty for the scenes the one-source editor actually writes', () => {
    expect(buildPlaybackActivationEventNodeIds([]).size).toBe(0)
    expect(buildPlaybackActivationEventNodeIds(undefined).size).toBe(0)
  })
})

describe('easing', () => {
  it('is pinned at both ends and monotonic between them', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    let previous = -1
    for (let step = 0; step <= 10; step += 1) {
      const value = easeOutCubic(step / 10)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })
})
