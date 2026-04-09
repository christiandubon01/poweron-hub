/**
 * NWSettings.ts — NW17: localStorage persistence for Neural World camera / movement settings.
 *
 * All settings persist to 'nw_settings_v2' key (bumped from v1 for new touch fields).
 * Loaded on mount, saved on change via debounce.
 */

export interface NWCameraSettings {
  /** Movement sensitivity multiplier (0.1–3.0, default 1.0) */
  moveSensitivity: number
  /** Mouse / look sensitivity multiplier (0.1–3.0, default 1.0) */
  lookSensitivity: number
  /** Invert mouse Y axis for movement (default false) */
  invertY: boolean
  /** NW20: Invert vertical view axis — flips WHERE you look, not how you move (default false) */
  invertViewY: boolean
  /** Base travel speed — scroll wheel adjusts within this range (0.5–MAX_SPEED, default 2.0) */
  travelSpeed: number
  /** Camera mode (ORBIT | FIRST_PERSON | THIRD_PERSON) */
  cameraMode: string
  /** Third person distance preset (CLOSE | MEDIUM | FAR) */
  tpDistance: 'CLOSE' | 'MEDIUM' | 'FAR'
  /** NW17: Touch-specific sensitivity multiplier applied on top of move/look sensitivity (0.1–3.0, default 1.5) */
  touchSensitivity: number
  /** NW17: Inner dead zone fraction of joystick radius — no movement within this zone (0.05–0.25, default 0.15) */
  touchDeadZone: number
}

/** NW20: Maximum travel speed — used by slider and scroll wheel clamping */
export const MAX_SPEED = 15.0

export const TP_DISTANCES: Record<'CLOSE' | 'MEDIUM' | 'FAR', number> = {
  CLOSE:  10,
  MEDIUM: 25,
  FAR:    100,
}

const STORAGE_KEY = 'nw_settings_v2'

const DEFAULTS: NWCameraSettings = {
  moveSensitivity: 1.0,
  lookSensitivity: 1.0,
  invertY:         false,
  invertViewY:     false,
  travelSpeed:     2.0,
  cameraMode:      'ORBIT',
  tpDistance:      'MEDIUM',
  touchSensitivity: 1.5,
  touchDeadZone:    0.15,
}

export function loadNWCameraSettings(): NWCameraSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<NWCameraSettings>
    return {
      moveSensitivity:  clamp(parsed.moveSensitivity  ?? DEFAULTS.moveSensitivity,  0.1,  3.0),
      lookSensitivity:  clamp(parsed.lookSensitivity  ?? DEFAULTS.lookSensitivity,  0.1,  3.0),
      invertY:          parsed.invertY ?? DEFAULTS.invertY,
      invertViewY:      parsed.invertViewY ?? DEFAULTS.invertViewY,
      travelSpeed:      clamp(parsed.travelSpeed      ?? DEFAULTS.travelSpeed,      0.5, MAX_SPEED),
      cameraMode:       parsed.cameraMode ?? DEFAULTS.cameraMode,
      tpDistance:       (parsed.tpDistance && ['CLOSE','MEDIUM','FAR'].includes(parsed.tpDistance))
        ? parsed.tpDistance
        : DEFAULTS.tpDistance,
      touchSensitivity: clamp(parsed.touchSensitivity ?? DEFAULTS.touchSensitivity, 0.1,  3.0),
      touchDeadZone:    clamp(parsed.touchDeadZone    ?? DEFAULTS.touchDeadZone,    0.05, 0.25),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveNWCameraSettings(settings: NWCameraSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Non-blocking
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
