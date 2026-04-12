/**
 * SparkAlertConfig.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SP3 — SPARK Live Call Alert System
 *
 * User-configurable preferences for the multi-modal alert system.
 * Stored in localStorage under 'spark_alert_config'.
 *
 * Channels:
 *   - haptic  : Web Vibration API (Apple Watch fallback / phone)
 *   - audio   : Web Audio API tones in AirPods / headphones
 *   - visual  : Floating indicator dot on-screen
 *
 * All three channels are ON by default.
 * Emergency override is ON by default (bypasses cooldown).
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Storage key ──────────────────────────────────────────────────────────────

export const SPARK_ALERT_CONFIG_KEY = 'spark_alert_config';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Individual channel configuration */
export interface SparkAlertChannelConfig {
  /** Whether this channel is enabled by the user */
  enabled: boolean;
  /** Volume level 0.0 – 1.0 (only meaningful for audio channel) */
  volume: number;
}

/** Top-level alert preferences stored in localStorage */
export interface SparkAlertConfig {
  /** Haptic / vibration channel (Web Vibration API) */
  haptic: SparkAlertChannelConfig;
  /** Audio tone channel (Web Audio API) */
  audio: SparkAlertChannelConfig;
  /** Visual floating-dot channel */
  visual: SparkAlertChannelConfig;
  /**
   * Minimum seconds between non-emergency alerts.
   * Default: 30 seconds.
   */
  cooldownSeconds: number;
  /**
   * When true, EMERGENCY-priority alerts bypass the cooldown queue
   * and fire immediately regardless of the last alert time.
   * Default: true.
   */
  emergencyOverride: boolean;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_SPARK_ALERT_CONFIG: SparkAlertConfig = {
  haptic: {
    enabled: true,
    volume: 1.0, // not used by haptic but kept for schema consistency
  },
  audio: {
    enabled: true,
    volume: 0.2, // conservative — designed to play under a conversation
  },
  visual: {
    enabled: true,
    volume: 1.0, // not used by visual but kept for schema consistency
  },
  cooldownSeconds: 30,
  emergencyOverride: true,
};

// ── Persistence helpers ───────────────────────────────────────────────────────

/**
 * Load alert config from localStorage.
 * Returns merged result of defaults + stored values so new keys survive
 * across config schema additions without losing user preferences.
 */
export function loadSparkAlertConfig(): SparkAlertConfig {
  try {
    const raw = localStorage.getItem(SPARK_ALERT_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_SPARK_ALERT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<SparkAlertConfig>;
    return {
      haptic: { ...DEFAULT_SPARK_ALERT_CONFIG.haptic, ...parsed.haptic },
      audio: { ...DEFAULT_SPARK_ALERT_CONFIG.audio, ...parsed.audio },
      visual: { ...DEFAULT_SPARK_ALERT_CONFIG.visual, ...parsed.visual },
      cooldownSeconds:
        typeof parsed.cooldownSeconds === 'number'
          ? parsed.cooldownSeconds
          : DEFAULT_SPARK_ALERT_CONFIG.cooldownSeconds,
      emergencyOverride:
        typeof parsed.emergencyOverride === 'boolean'
          ? parsed.emergencyOverride
          : DEFAULT_SPARK_ALERT_CONFIG.emergencyOverride,
    };
  } catch {
    return { ...DEFAULT_SPARK_ALERT_CONFIG };
  }
}

/**
 * Persist current alert config to localStorage.
 */
export function saveSparkAlertConfig(config: SparkAlertConfig): void {
  try {
    localStorage.setItem(SPARK_ALERT_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Quota or SSR — silently ignore
  }
}

/**
 * Reset alert config to factory defaults and persist.
 */
export function resetSparkAlertConfig(): SparkAlertConfig {
  const defaults = { ...DEFAULT_SPARK_ALERT_CONFIG };
  saveSparkAlertConfig(defaults);
  return defaults;
}

/**
 * Toggle a single channel on/off and persist.
 */
export function toggleSparkAlertChannel(
  channel: keyof Pick<SparkAlertConfig, 'haptic' | 'audio' | 'visual'>,
  enabled: boolean
): SparkAlertConfig {
  const config = loadSparkAlertConfig();
  config[channel] = { ...config[channel], enabled };
  saveSparkAlertConfig(config);
  return config;
}

/**
 * Update audio volume (0.0 – 1.0) and persist.
 */
export function setSparkAudioVolume(volume: number): SparkAlertConfig {
  const config = loadSparkAlertConfig();
  config.audio = { ...config.audio, volume: Math.min(1, Math.max(0, volume)) };
  saveSparkAlertConfig(config);
  return config;
}

/**
 * Update cooldown period and persist.
 */
export function setSparkAlertCooldown(seconds: number): SparkAlertConfig {
  const config = loadSparkAlertConfig();
  config.cooldownSeconds = Math.max(0, seconds);
  saveSparkAlertConfig(config);
  return config;
}
