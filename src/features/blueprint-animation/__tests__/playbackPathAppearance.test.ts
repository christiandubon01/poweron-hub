import { describe, expect, it } from 'vitest'
import {
  buildCircuitSegmentChannelColorMap,
  buildPlaybackRouteEdgeAppearanceMap,
  circuitSegmentChannelKey,
  resolvePlaybackChannelColor,
  resolvePlaybackPathState,
} from '../playbackPathAppearance'
import type { BlueprintAnimationChannelType } from '../types'

describe('playback route channel colors', () => {
  it.each<[BlueprintAnimationChannelType, string]>([
    ['switched-line-voltage', '#facc15'],
    ['constant-line-voltage', '#fb923c'],
    ['zero-to-ten-volt-control', '#a78bfa'],
    ['low-voltage-control-signal', '#38bdf8'],
    ['emergency-power', '#f43f5e'],
    ['generic-route', '#22d3ee'],
  ])('maps %s to its fixed color', (channel, color) => {
    expect(resolvePlaybackChannelColor(channel)).toBe(color)
  })

  it('falls back to Generic Route for malformed runtime values', () => {
    expect(resolvePlaybackChannelColor('future-channel')).toBe('#22d3ee')
    expect(resolvePlaybackChannelColor(undefined)).toBe('#22d3ee')
  })
})

describe('playback path state', () => {
  it('moves from not-yet through dim-pulsing to solid at the exact travel boundaries', () => {
    const stateAt = (elapsedMs: number) => resolvePlaybackPathState({
      elapsedMs,
      travelStartMs: 100,
      travelEndMs: 300,
    })
    expect(stateAt(99)).toBe('not-yet')
    expect(stateAt(100)).toBe('dim-pulsing')
    expect(stateAt(299)).toBe('dim-pulsing')
    expect(stateAt(300)).toBe('solid')
  })

  it('settles zero-duration and reduced-motion travel immediately', () => {
    expect(resolvePlaybackPathState({ elapsedMs: 0, travelStartMs: 0, travelEndMs: 0 })).toBe('solid')
    expect(resolvePlaybackPathState({ elapsedMs: 100, travelStartMs: 100, travelEndMs: 300, reducedMotion: true })).toBe('solid')
  })
})

describe('resting circuit segment colors', () => {
  it('deduplicates matching assignments and omits conflicting assignments', () => {
    const colors = buildCircuitSegmentChannelColorMap([
      { annotationId: 'circuit-1', segmentId: 'segment-1', channel: 'switched-line-voltage' },
      { annotationId: 'circuit-1', segmentId: 'segment-1', channel: 'switched-line-voltage' },
      { annotationId: 'circuit-1', segmentId: 'segment-2', channel: 'emergency-power' },
      { annotationId: 'circuit-1', segmentId: 'segment-2', channel: 'generic-route' },
    ])
    expect(colors.get(circuitSegmentChannelKey('circuit-1', 'segment-1'))).toBe('#facc15')
    expect(colors.has(circuitSegmentChannelKey('circuit-1', 'segment-2'))).toBe(false)
  })
})

describe('wire profile animation boundary', () => {
  it('uses authored annotation appearance instead of wire profile display color', () => {
    const colors = buildPlaybackRouteEdgeAppearanceMap({
      edges: [{
        id: 'edge-1',
        fromNodeId: 'source',
        toNodeId: 'load',
        geometry: { kind: 'circuit-segment', annotationId: 'circuit-1' },
      }],
      manualTraversal: [{ edgeId: 'edge-1' }],
    }, [{
      id: 'circuit-1',
      color: '#facc15',
      borderColor: '#ef4444',
      meta: { wireProfileId: 'wire_profile_blue', displayColor: '#3b82f6' },
    } as any])

    expect(colors.get('edge-1')).toEqual({ baseColor: '#ef4444', overlayColor: '#ef4444' })
  })
})
