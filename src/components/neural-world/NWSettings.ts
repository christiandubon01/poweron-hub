/**
 * NWSettings.ts — NW16: localStorage persistence for Neural World camera / movement settings.
 *
 * All settings persist to 'nw_settings_v1' key.
 * Loaded on mount, saved on change via debounce.
 */

export interface NWCameraSettings {
  /** Movement sensitivity multiplier (0.1–3.0, default 1.0) */
  moveSensitivity: number
  /** Mouse / look sensitivity multiplier (0.1–3.0, default 1.0) */
  lookSensitivity: number
  /** Invert mouse Y axis (default false) */
  invertY: boolean
  /** Base travel speed — scroll wheel adjusts within this range (0.5–10.0, default 2.0) */
  travelSpeed: number
  /** Camera mode (ORBIT | FIRST_PERSON | THIRD_PERSON) */
  cameraMode: string
  /** Third person distance preset (CLOSE | MEDIUM | FAR) */
  tpDistance: 'CLOSE' | 'MEDIUM' | 'FAR'
}

export const TP_DISTANCES: Record<'CLOSE' | 'MEDIUM' | 'FAR', number> = {
  CLOSE:  10,
  MEDIUM: 25,
  FAR:    100,
}

const STORAGE_KEY = 'nw_settings_v1'

const DEFAULTS: NWCameraSettings = {
  moveSensitivity: 1.0,
  lookSensitivity: 1.0,
  invertY:         false,
  travelSpeed:     2.0,
  cameraMode:      'ORBIT',
  tpDistance:      'MEDIUM',
}

export function loadNWCameraSettings(): NWCameraSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<NWCameraSettings>
    return {
      moveSensitivity: clamp(parsed.moveSensitivity ?? DEFAULTS.moveSensitivity, 0.1, 3.0),
      lookSensitivity: clamp(parsed.lookSensitivity ?? DEFAULTS.lookSensitivity, 0.1, 3.0),
      invertY:         parsed.invertY ?? DEFAULTS.invertY,
      travelSpeed:     clamp(parsed.travelSpeed ?? DEFAULTS.travelSpeed, 0.5, 10.0),
      cameraMode:      parsed.cameraMode ?? DEFAULTS.cameraMode,
      tpDistance:      (parsed.tpDistance && ['CLOSE','MEDIUM','FAR'].includes(parsed.tpDistance))
        ? parsed.tpDistance
        : DEFAULTS.tpDistance,
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
