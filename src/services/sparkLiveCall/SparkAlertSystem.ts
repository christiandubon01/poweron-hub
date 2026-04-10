/**
 * SparkAlertSystem.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SP3 — SPARK Live Call Multi-Modal Alert System
 *
 * Notifies Christian during live conversations WITHOUT interrupting the flow.
 * Three independent alert channels — all configurable, all testable.
 *
 * CHANNEL 1 — HAPTIC
 *   Web Vibration API (navigator.vibrate) for phones & Apple Watch.
 *   Opportunity : 200 ms burst
 *   Warning     : 200-100-200 ms double buzz
 *   Emergency   : 200-100-200-100-200 ms triple rapid buzz ("you're losing money")
 *
 * CHANNEL 2 — AUDIO
 *   Web Audio API OscillatorNode — tones designed to sit UNDER conversation.
 *   Opportunity : single chime  800 Hz · 150 ms · vol 0.15
 *   Warning     : two quick    600 Hz · 100 ms each · vol 0.20
 *   Emergency   : descending   800→600→400 Hz · vol 0.30
 *   Audio ducking: reduces MediaSession/ambient audio by 50 % during tone.
 *
 * CHANNEL 3 — VISUAL
 *   12 px floating dot injected into the DOM corner.
 *   Green pulse  = opportunity
 *   Amber pulse  = warning
 *   Red pulse    = EMERGENCY
 *   Fades after 3 seconds, never blocks content.
 *
 * PRIORITY / FLAG TYPES
 *   Priority 1 — EMERGENCY : COST_ALERT, MARGIN_ALERT, EGO_CHECK
 *   Priority 2 — WARNING   : COMMITMENT_ALERT, PATTERN_ALERT
 *   Priority 3 — INFO      : OPPORTUNITY
 *
 * QUEUE RULES
 *   - Max 1 non-emergency alert per 30 s (configurable in SparkAlertConfig).
 *   - EMERGENCY alerts bypass the cooldown and fire immediately.
 *   - All fired alerts are logged to module-level history for post-call debrief.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  loadSparkAlertConfig,
  type SparkAlertConfig,
} from './SparkAlertConfig';

// ── Flag / Alert types ────────────────────────────────────────────────────────

/** Every type of flag SPARK can raise during a live call */
export type SparkFlagType =
  | 'COST_ALERT'
  | 'MARGIN_ALERT'
  | 'EGO_CHECK'
  | 'COMMITMENT_ALERT'
  | 'PATTERN_ALERT'
  | 'OPPORTUNITY';

/** Alert priority levels */
export type AlertPriority = 1 | 2 | 3;

/** Human-readable priority label */
export type AlertSeverity = 'EMERGENCY' | 'WARNING' | 'INFO';

/** A SPARK alert payload */
export interface SparkAlert {
  /** Unique identifier for deduplication and logging */
  id: string;
  /** Flag classification */
  flagType: SparkFlagType;
  /** Computed priority (1 = highest) */
  priority: AlertPriority;
  /** Human severity label */
  severity: AlertSeverity;
  /** Short description shown in logs / debrief */
  message: string;
  /** ISO timestamp when the alert was created */
  createdAt: string;
  /** ISO timestamp when the alert was actually fired (null if still queued) */
  firedAt: string | null;
  /** Which channels fired for this alert */
  channelsFired: Array<'haptic' | 'audio' | 'visual'>;
}

// ── Priority metadata ─────────────────────────────────────────────────────────

interface FlagMeta {
  priority: AlertPriority;
  severity: AlertSeverity;
  defaultMessage: string;
}

export const FLAG_TYPES: Record<SparkFlagType, FlagMeta> = {
  // ── EMERGENCY (priority 1) ───────────────────────────────────────────────
  COST_ALERT: {
    priority: 1,
    severity: 'EMERGENCY',
    defaultMessage: 'You just offered free hours — that costs real money',
  },
  MARGIN_ALERT: {
    priority: 1,
    severity: 'EMERGENCY',
    defaultMessage: 'That rate is below your margin floor — slow down',
  },
  EGO_CHECK: {
    priority: 1,
    severity: 'EMERGENCY',
    defaultMessage: "You're speeding up — take a breath before you commit",
  },
  // ── WARNING (priority 2) ─────────────────────────────────────────────────
  COMMITMENT_ALERT: {
    priority: 2,
    severity: 'WARNING',
    defaultMessage: 'You mentioned a day — check your schedule first',
  },
  PATTERN_ALERT: {
    priority: 2,
    severity: 'WARNING',
    defaultMessage: "Pattern detected — you've discounted multiple times this week",
  },
  // ── INFO (priority 3) ────────────────────────────────────────────────────
  OPPORTUNITY: {
    priority: 3,
    severity: 'INFO',
    defaultMessage: 'Opportunity detected — listen for the opening',
  },
};

// ── Alert history (in-memory, accessed via getAlertHistory for debrief) ──────

const _alertHistory: SparkAlert[] = [];

/** Return a copy of all fired alerts for post-call debrief */
export function getAlertHistory(): SparkAlert[] {
  return [..._alertHistory];
}

/** Clear alert history (call at the start of each new live call session) */
export function clearAlertHistory(): void {
  _alertHistory.length = 0;
}

// ── Cooldown tracking ─────────────────────────────────────────────────────────

let _lastNonEmergencyFiredAt: number | null = null;

/** Reset cooldown state (call at the start of each new live call session) */
export function resetAlertCooldown(): void {
  _lastNonEmergencyFiredAt = null;
}

/** Check whether the cooldown period has elapsed for non-emergency alerts */
function isCooldownClear(config: SparkAlertConfig): boolean {
  if (_lastNonEmergencyFiredAt === null) return true;
  const elapsedMs = Date.now() - _lastNonEmergencyFiredAt;
  return elapsedMs >= config.cooldownSeconds * 1000;
}

// ── Unique ID helper ──────────────────────────────────────────────────────────

function generateAlertId(): string {
  return `spark-alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL 1 — HAPTIC
// ─────────────────────────────────────────────────────────────────────────────

/** Vibration patterns in milliseconds [on, off, on, off, on …] */
const HAPTIC_PATTERNS: Record<AlertSeverity, number[]> = {
  INFO: [200],                          // single soft buzz — opportunity
  WARNING: [200, 100, 200],             // double buzz — commitment / pattern
  EMERGENCY: [200, 100, 200, 100, 200], // triple rapid — money at risk
};

/**
 * Fire the haptic channel using Web Vibration API.
 * No-ops silently on unsupported browsers.
 */
function fireHaptic(severity: AlertSeverity): void {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  try {
    navigator.vibrate(HAPTIC_PATTERNS[severity]);
  } catch {
    // Silently ignore — permission denied or API not supported
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL 2 — AUDIO
// ─────────────────────────────────────────────────────────────────────────────

/** Shared AudioContext — lazily created on first use */
let _audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
    }
    return _audioCtx;
  } catch {
    return null;
  }
}

interface ToneSpec {
  frequency: number; // Hz
  duration: number;  // ms
  volume: number;    // 0.0 – 1.0
  startAt: number;   // seconds offset from AudioContext.currentTime
}

/** Play a single tone using OscillatorNode + GainNode */
function playTone(ctx: AudioContext, spec: ToneSpec): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(spec.frequency, ctx.currentTime + spec.startAt);

  const startTime = ctx.currentTime + spec.startAt;
  const endTime = startTime + spec.duration / 1000;

  // Ramp up gently to avoid click
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(spec.volume, startTime + 0.01);
  // Ramp down to avoid click at end
  gain.gain.setValueAtTime(spec.volume, endTime - 0.02);
  gain.gain.linearRampToValueAtTime(0, endTime);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(endTime);
}

/**
 * Duck ambient audio by lowering any playing <audio>/<video> elements to 50 %,
 * then restore after the tone sequence finishes.
 */
function duckAmbientAudio(toneDurationMs: number): void {
  if (typeof document === 'undefined') return;
  const mediaEls = Array.from(
    document.querySelectorAll<HTMLMediaElement>('audio, video')
  );
  if (mediaEls.length === 0) return;

  // Save original volumes and duck
  const originals = mediaEls.map((el) => el.volume);
  mediaEls.forEach((el) => {
    el.volume = Math.max(0, el.volume * 0.5);
  });

  // Restore after the tone finishes (add 50 ms buffer)
  setTimeout(() => {
    mediaEls.forEach((el, i) => {
      el.volume = originals[i];
    });
  }, toneDurationMs + 50);
}

/** Tone specifications per severity (before volume scaling) */
interface AudioSequenceSpec {
  tones: Array<{ freq: number; durationMs: number; startMs: number }>;
  baseVolume: number;
  totalDurationMs: number;
}

const AUDIO_SEQUENCES: Record<AlertSeverity, AudioSequenceSpec> = {
  // Single soft chime — sits gently in left ear
  INFO: {
    tones: [{ freq: 800, durationMs: 150, startMs: 0 }],
    baseVolume: 0.15,
    totalDurationMs: 150,
  },
  // Two quick tones — draws attention without jarring
  WARNING: {
    tones: [
      { freq: 600, durationMs: 100, startMs: 0 },
      { freq: 600, durationMs: 100, startMs: 150 },
    ],
    baseVolume: 0.2,
    totalDurationMs: 250,
  },
  // Three descending tones — unmistakable but not panic-inducing
  EMERGENCY: {
    tones: [
      { freq: 800, durationMs: 150, startMs: 0 },
      { freq: 600, durationMs: 150, startMs: 200 },
      { freq: 400, durationMs: 200, startMs: 400 },
    ],
    baseVolume: 0.3,
    totalDurationMs: 600,
  },
};

/**
 * Fire the audio channel.
 * Ducks ambient media during the tone sequence.
 * Volume is multiplied by the user's configured audio.volume preference.
 */
function fireAudio(severity: AlertSeverity, userVolume: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume context if suspended (browser autoplay policy)
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => undefined);
  }

  const seq = AUDIO_SEQUENCES[severity];
  const finalVolume = seq.baseVolume * userVolume;

  duckAmbientAudio(seq.totalDurationMs);

  seq.tones.forEach(({ freq, durationMs, startMs }) => {
    playTone(ctx, {
      frequency: freq,
      duration: durationMs,
      volume: finalVolume,
      startAt: startMs / 1000,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL 3 — VISUAL
// ─────────────────────────────────────────────────────────────────────────────

const VISUAL_DOT_ID = 'spark-alert-dot';

const VISUAL_COLORS: Record<AlertSeverity, string> = {
  INFO: '#22c55e',      // green  — opportunity
  WARNING: '#f59e0b',   // amber  — commitment / pattern
  EMERGENCY: '#ef4444', // red    — money at risk / ego trigger
};

/** CSS keyframe animation for the pulse effect */
const PULSE_KEYFRAMES = `
@keyframes spark-alert-pulse {
  0%   { transform: scale(1);   opacity: 1; }
  50%  { transform: scale(1.6); opacity: 0.7; }
  100% { transform: scale(1);   opacity: 1; }
}
@keyframes spark-alert-fade {
  0%   { opacity: 1; }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}
`;

function ensurePulseStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('spark-alert-styles')) return;
  const style = document.createElement('style');
  style.id = 'spark-alert-styles';
  style.textContent = PULSE_KEYFRAMES;
  document.head.appendChild(style);
}

/**
 * Inject or update the floating indicator dot.
 * Dot is 12 px, positioned in the bottom-right corner,
 * fades out after 3 seconds.
 * Never blocks any content (pointer-events: none, high z-index).
 */
function fireVisual(severity: AlertSeverity): void {
  if (typeof document === 'undefined') return;
  ensurePulseStyles();

  // Remove any existing dot first
  const existing = document.getElementById(VISUAL_DOT_ID);
  if (existing) existing.remove();

  const dot = document.createElement('div');
  dot.id = VISUAL_DOT_ID;

  const color = VISUAL_COLORS[severity];

  Object.assign(dot.style, {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    backgroundColor: color,
    boxShadow: `0 0 8px 2px ${color}88`,
    zIndex: '999999',
    pointerEvents: 'none',
    animation: 'spark-alert-pulse 0.6s ease-in-out 3, spark-alert-fade 3s ease-in-out 1 forwards',
  });

  dot.setAttribute('aria-hidden', 'true');
  dot.setAttribute('data-spark-severity', severity);

  document.body.appendChild(dot);

  // Remove from DOM after animation completes (3 s)
  setTimeout(() => {
    if (document.getElementById(VISUAL_DOT_ID) === dot) {
      dot.remove();
    }
  }, 3100);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a SparkAlert object from a flag type and optional custom message.
 * Does NOT fire any channels — use `fireAlert()` or `queueAlert()` for that.
 */
export function buildAlert(
  flagType: SparkFlagType,
  customMessage?: string
): SparkAlert {
  const meta = FLAG_TYPES[flagType];
  return {
    id: generateAlertId(),
    flagType,
    priority: meta.priority,
    severity: meta.severity,
    message: customMessage ?? meta.defaultMessage,
    createdAt: new Date().toISOString(),
    firedAt: null,
    channelsFired: [],
  };
}

/**
 * Immediately fire all enabled channels for the given alert.
 * Updates the alert record in-place (firedAt, channelsFired) and
 * appends it to the in-memory history log.
 *
 * Use this directly only when you want to bypass the cooldown queue
 * (e.g., for test-fire or guaranteed-emergency paths).
 */
export function fireAlertNow(
  alert: SparkAlert,
  config: SparkAlertConfig
): SparkAlert {
  const fired = { ...alert, firedAt: new Date().toISOString(), channelsFired: [] as SparkAlert['channelsFired'] };

  if (config.haptic.enabled) {
    fireHaptic(alert.severity);
    fired.channelsFired.push('haptic');
  }

  if (config.audio.enabled) {
    fireAudio(alert.severity, config.audio.volume);
    fired.channelsFired.push('audio');
  }

  if (config.visual.enabled) {
    fireVisual(alert.severity);
    fired.channelsFired.push('visual');
  }

  _alertHistory.push(fired);
  return fired;
}

/**
 * Queue an alert with cooldown logic:
 *
 * - EMERGENCY alerts (priority 1) bypass the cooldown when emergencyOverride is ON.
 *   They fire immediately regardless of when the last alert played.
 * - WARNING / INFO alerts respect the cooldown window.
 *   If the window hasn't elapsed, the alert is discarded (not queued).
 *   Rationale: during a live call, a skipped non-critical alert is better than
 *   constant buzzing that distracts from the conversation.
 *
 * Returns the fired alert record, or null if suppressed by cooldown.
 */
export function queueAlert(
  flagType: SparkFlagType,
  customMessage?: string
): SparkAlert | null {
  const config = loadSparkAlertConfig();
  const alert = buildAlert(flagType, customMessage);

  const isEmergency = alert.priority === 1;

  // EMERGENCY bypass
  if (isEmergency && config.emergencyOverride) {
    return fireAlertNow(alert, config);
  }

  // Cooldown gate for non-emergency alerts
  if (!isCooldownClear(config)) {
    return null; // Suppressed — still within cooldown window
  }

  const fired = fireAlertNow(alert, config);
  _lastNonEmergencyFiredAt = Date.now();
  return fired;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST-FIRE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Test-fire a specific channel in isolation without touching the queue or history.
 * Useful for the settings UI "Test" buttons.
 */
export function testHapticChannel(severity: AlertSeverity = 'INFO'): void {
  fireHaptic(severity);
}

export function testAudioChannel(
  severity: AlertSeverity = 'INFO',
  volume = 0.2
): void {
  fireAudio(severity, volume);
}

export function testVisualChannel(severity: AlertSeverity = 'INFO'): void {
  fireVisual(severity);
}

/**
 * Test all three channels simultaneously with the currently saved config.
 * Uses INFO severity by default — safe for any environment.
 */
export function testAllChannels(severity: AlertSeverity = 'INFO'): void {
  const config = loadSparkAlertConfig();
  if (config.haptic.enabled) fireHaptic(severity);
  if (config.audio.enabled) fireAudio(severity, config.audio.volume);
  if (config.visual.enabled) fireVisual(severity);
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call at the start of each live call session.
 * Clears history and resets cooldown so the new call starts fresh.
 */
export function startAlertSession(): void {
  clearAlertHistory();
  resetAlertCooldown();
}

/**
 * Call at the end of a live call session.
 * Returns the full alert history for debrief / SparkStore logging.
 */
export function endAlertSession(): SparkAlert[] {
  const history = getAlertHistory();
  return history;
}
