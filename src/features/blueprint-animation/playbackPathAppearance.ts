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

export function resolvePlaybackChannelColor(channel: string | null | undefined): string {
  return CHANNEL_COLORS[channel as BlueprintAnimationChannelType] ?? CHANNEL_COLORS['generic-route']
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
