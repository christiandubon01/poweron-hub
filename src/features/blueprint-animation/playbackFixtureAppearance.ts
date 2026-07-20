/**
 * Pure phase → visual-treatment mapping for Package Circuit Animation playback (ANIM-4).
 *
 * This module never reads or writes annotation data. It converts the device phases ANIM-3's
 * timeline already produces into transient render values, so a fixture's saved Light Output can
 * be faded in during playback and abandoned on Stop with nothing persisted.
 *
 * The caller supplies each fixture's already-resolved glow radius/colour rather than its raw
 * lightIntensity/lightKelvin. That keeps the Kelvin and Light Output maths in the single place
 * that already owns it (the viewer's getLightOutputGlowMetrics) instead of duplicating those
 * constants here, where they could silently drift apart from the resting glow.
 */

import type { BlueprintAnimationDeviceRole, BlueprintAnimationEventDefinition } from './types'
import type { PlaybackDevicePhase } from './playbackModel'

/** How a node is treated visually. Distinct from its phase, which the timeline owns. */
export type PlaybackNodeVisualRole = 'source' | 'junction' | 'control' | 'load' | 'passive'

export type PlaybackDeviceVisualKind = 'none' | 'source-pulse' | 'ready' | 'reacting' | 'energized'

export interface PlaybackDeviceVisual {
  kind: PlaybackDeviceVisualKind
  /** Fraction of the fixture's configured glow radius. 1 = exactly its resting appearance. */
  glowRadiusFraction: number
  /** Multiplier applied to the fixture's configured glow opacity. 1 = exactly its resting appearance. */
  glowOpacity: number
  /** Strength of the non-glow ring indicator, 0..1. */
  ringStrength: number
}

/** A fixture's resting Light Output appearance, resolved by the caller from its own saved meta. */
export interface PlaybackFixtureAppearance {
  /** Normalized page-fraction rect of the annotation, matching how the viewer positions it. */
  rect: { x: number; y: number; w: number; h: number }
  /** Glow radius in the symbol's 0-100 viewBox units at full configured output. */
  glowRadius: number
  /** Colour-temperature tint for the glow. */
  glowColor: string
}

/** How long the source's arrival pulse lasts. Presentational only — the source's phase is 'active'
 *  for the whole run, so the pulse is derived from elapsed time rather than from the timeline. */
export const PLAYBACK_SOURCE_PULSE_MS = 420

/** A fixture starts its fade partly open rather than at zero, so switching on reads as a light
 *  coming up to its configured spread instead of a dot inflating from nothing. */
const GLOW_MIN_RADIUS_FRACTION = 0.35

/** The ring recedes but does not vanish once lit, so route membership stays legible even when a
 *  fully-activated fixture matches its resting appearance exactly. */
const ENERGIZED_RING_FLOOR = 0.35

const NONE: PlaybackDeviceVisual = { kind: 'none', glowRadiusFraction: 0, glowOpacity: 0, ringStrength: 0 }

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

export function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - clamp01(value), 3)
}

/**
 * Precedence deliberately mirrors playbackModel's deviceStateAt so a multi-role node can never be
 * given a visual treatment that disagrees with the phase the timeline actually produced for it.
 */
export function classifyPlaybackNodeVisualRole(
  roles: readonly BlueprintAnimationDeviceRole[] | undefined,
  isPlaybackSource = false,
): PlaybackNodeVisualRole {
  const list = roles ?? []
  if (isPlaybackSource || list.includes('source')) return 'source'
  if (list.includes('junction')) return 'junction'
  if (list.includes('load')) return 'load'
  if (list.includes('control') || list.includes('sensor')) return 'control'
  return 'passive'
}

/**
 * Node ids the saved scene explicitly activates. Today the one-source editor always writes an
 * empty events array and any scene carrying events is read-only and unplayable, so this is
 * always empty in practice — it exists so the "never auto-activate a control" rule is enforced by
 * the data rather than by the absence of a code path.
 */
export function buildPlaybackActivationEventNodeIds(
  events: readonly BlueprintAnimationEventDefinition[] | undefined,
): Set<string> {
  const ids = new Set<string>()
  ;(events ?? []).forEach((event) => {
    if (event?.type !== 'activate-node') return
    if (typeof event.nodeId === 'string' && event.nodeId) ids.add(event.nodeId)
  })
  return ids
}

export function resolvePlaybackDeviceVisual(options: {
  visualRole: PlaybackNodeVisualRole
  phase: PlaybackDevicePhase
  progress: number
  elapsedMs: number
  hasActivationEvent?: boolean
  reducedMotion?: boolean
}): PlaybackDeviceVisual {
  const { visualRole, phase } = options
  const progress = clamp01(options.progress)
  if (phase === 'idle') return NONE

  // A junction is a pass-through: the energized route line through it is the whole signal.
  if (visualRole === 'junction') return NONE

  if (visualRole === 'source') {
    // Reduced motion collapses the timeline to zero duration and pins elapsed at 0, so a
    // time-derived pulse would sit at full strength forever. Every other treatment settles into a
    // static end state on its own; the pulse is the one that has to be dropped explicitly.
    if (options.reducedMotion) return NONE
    const elapsedMs = Math.max(0, Number(options.elapsedMs) || 0)
    if (elapsedMs >= PLAYBACK_SOURCE_PULSE_MS) return NONE
    return {
      kind: 'source-pulse',
      glowRadiusFraction: 0,
      glowOpacity: 0,
      ringStrength: 1 - elapsedMs / PLAYBACK_SOURCE_PULSE_MS,
    }
  }

  // Reaching a switch/dimmer shows that it is ready and nothing more. It only energizes when the
  // saved scene carries an explicit activation event naming it.
  if (visualRole === 'control' && !options.hasActivationEvent) {
    return {
      kind: 'ready',
      glowRadiusFraction: 0,
      glowOpacity: 0,
      ringStrength: phase === 'reacting' ? progress : 1,
    }
  }

  // The device acknowledges before it draws power; no light is emitted yet.
  if (phase === 'reacting') {
    return { kind: 'reacting', glowRadiusFraction: 0, glowOpacity: 0, ringStrength: progress }
  }

  // 'activating' carries the fade fraction; 'active' is the settled end state, which must land
  // exactly on the fixture's configured appearance.
  const fade = phase === 'activating' ? easeOutCubic(progress) : 1
  return {
    kind: 'energized',
    glowRadiusFraction: GLOW_MIN_RADIUS_FRACTION + (1 - GLOW_MIN_RADIUS_FRACTION) * fade,
    glowOpacity: fade,
    ringStrength: 1 - (1 - ENERGIZED_RING_FLOOR) * fade,
  }
}
