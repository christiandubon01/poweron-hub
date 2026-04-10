/**
 * SoundProfileManager.ts — NW46: 5 sound profiles for Neural World.
 *
 * Profiles:
 *   SILENT    — all audio off. AudioContext suspended.
 *   MINIMAL   — events only, no ambient (DEFAULT for new users).
 *   AMBIENT   — gentle wind + crystal chimes + events, no drone.
 *   FOCUS     — proximity tones + agents + events + wind, NO drone, pulse 50%.
 *   IMMERSIVE — full NW43 system (drone + spatial + proximity + events + pulse).
 *
 * Persistence keys:
 *   nw_sound_profile_v1  — active SoundProfile string
 *   nw_layer_volumes_v1  — LayerVolumes JSON
 */

export type SoundProfile = 'SILENT' | 'MINIMAL' | 'AMBIENT' | 'FOCUS' | 'IMMERSIVE'

/** Per-layer volume controls (all 0–1). */
export interface LayerVolumes {
  master:    number   // overall master
  events:    number   // event chimes (invoice paid, lead captured, etc.)
  ambient:   number   // wind noise + crystal chimes
  proximity: number   // node proximity tones, GUARDIAN hum, agent sounds
  pulse:     number   // world pulse ticks
  drone:     number   // ambient oscillator drone (IMMERSIVE only)
}

/** Internal config derived from a profile. */
export interface ProfileConfig {
  droneEnabled:     boolean
  proximityEnabled: boolean
  pulseEnabled:     boolean
  eventsEnabled:    boolean
  windEnabled:      boolean
  crystalChimes:    boolean
  pulseVolumeScale: number   // FOCUS uses 0.5
}

export const PROFILE_CONFIGS: Record<SoundProfile, ProfileConfig> = {
  SILENT: {
    droneEnabled:     false,
    proximityEnabled: false,
    pulseEnabled:     false,
    eventsEnabled:    false,
    windEnabled:      false,
    crystalChimes:    false,
    pulseVolumeScale: 0,
  },
  MINIMAL: {
    droneEnabled:     false,
    proximityEnabled: false,
    pulseEnabled:     false,
    eventsEnabled:    true,
    windEnabled:      false,
    crystalChimes:    false,
    pulseVolumeScale: 0,
  },
  AMBIENT: {
    droneEnabled:     false,
    proximityEnabled: false,
    pulseEnabled:     false,
    eventsEnabled:    true,
    windEnabled:      true,
    crystalChimes:    true,
    pulseVolumeScale: 0,
  },
  FOCUS: {
    droneEnabled:     false,
    proximityEnabled: true,
    pulseEnabled:     true,
    eventsEnabled:    true,
    windEnabled:      true,
    crystalChimes:    false,
    pulseVolumeScale: 0.5,
  },
  IMMERSIVE: {
    droneEnabled:     true,
    proximityEnabled: true,
    pulseEnabled:     true,
    eventsEnabled:    true,
    windEnabled:      false,
    crystalChimes:    false,
    pulseVolumeScale: 1.0,
  },
}

export const PROFILE_LABELS: Record<SoundProfile, string> = {
  SILENT:    'Silent',
  MINIMAL:   'Minimal',
  AMBIENT:   'Ambient',
  FOCUS:     'Focus',
  IMMERSIVE: 'Immersive',
}

export const PROFILE_ICONS: Record<SoundProfile, string> = {
  SILENT:    '🔇',
  MINIMAL:   '🔈',
  AMBIENT:   '🔉',
  FOCUS:     '🔊',
  IMMERSIVE: '🔊',
}

export const PROFILE_DESCRIPTIONS: Record<SoundProfile, string> = {
  SILENT:    'All audio off.',
  MINIMAL:   'Event sounds only — invoice paid, lead captured, agent flyby, etc.',
  AMBIENT:   'Soft wind + occasional crystal chimes + event sounds. No drone.',
  FOCUS:     'Proximity tones, agent sounds, wind, events. No drone. Pulse at 50%.',
  IMMERSIVE: 'Full experience — drone, spatial, proximity, events, world pulse.',
}

const PROFILE_KEY = 'nw_sound_profile_v1'
const VOLUMES_KEY = 'nw_layer_volumes_v1'

export const DEFAULT_PROFILE: SoundProfile = 'MINIMAL'

export const DEFAULT_VOLUMES: LayerVolumes = {
  master:    0.30,
  events:    1.0,
  ambient:   0.70,
  proximity: 1.0,
  pulse:     1.0,
  drone:     1.0,
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export function loadProfile(): SoundProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw && ['SILENT', 'MINIMAL', 'AMBIENT', 'FOCUS', 'IMMERSIVE'].includes(raw)) {
      return raw as SoundProfile
    }
  } catch { /* ignore */ }
  return DEFAULT_PROFILE
}

export function saveProfile(profile: SoundProfile): void {
  try { localStorage.setItem(PROFILE_KEY, profile) } catch { /* ignore */ }
}

export function loadLayerVolumes(): LayerVolumes {
  try {
    const raw = localStorage.getItem(VOLUMES_KEY)
    if (!raw) return { ...DEFAULT_VOLUMES }
    const parsed = JSON.parse(raw) as Partial<LayerVolumes>
    return {
      master:    clamp01(parsed.master    ?? DEFAULT_VOLUMES.master),
      events:    clamp01(parsed.events    ?? DEFAULT_VOLUMES.events),
      ambient:   clamp01(parsed.ambient   ?? DEFAULT_VOLUMES.ambient),
      proximity: clamp01(parsed.proximity ?? DEFAULT_VOLUMES.proximity),
      pulse:     clamp01(parsed.pulse     ?? DEFAULT_VOLUMES.pulse),
      drone:     clamp01(parsed.drone     ?? DEFAULT_VOLUMES.drone),
    }
  } catch {
    return { ...DEFAULT_VOLUMES }
  }
}

export function saveLayerVolumes(v: LayerVolumes): void {
  try { localStorage.setItem(VOLUMES_KEY, JSON.stringify(v)) } catch { /* ignore */ }
}

/** Returns which per-layer sliders are active (non-grayed) for a profile. */
export function getActiveSliders(profile: SoundProfile): Record<keyof Omit<LayerVolumes, 'master'>, boolean> {
  const cfg = PROFILE_CONFIGS[profile]
  return {
    events:    cfg.eventsEnabled,
    ambient:   cfg.windEnabled || false,
    proximity: cfg.proximityEnabled,
    pulse:     cfg.pulseEnabled,
    drone:     cfg.droneEnabled,
  }
}
