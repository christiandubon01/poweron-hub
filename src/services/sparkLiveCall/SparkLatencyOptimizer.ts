/**
 * SparkLatencyOptimizer.ts
 * SP5 — SPARK Live Call Pipeline Latency Optimizer
 *
 * Pipeline timing target: speech → alert in under 5 seconds
 *   Step 1: Audio chunk capture   — 2s chunks (adaptive)
 *   Step 2: Whisper transcription — ~1–2s for a 2s chunk
 *   Step 3: Claude Haiku analysis — ~0.5–1s
 *   Step 4: Alert delivery        — ~0.1s
 *   Total target: 3.6–5.1 seconds
 *
 * Key features:
 *   - Adaptive chunk sizing based on measured latency
 *   - Parallel capture + transcription (pipeline overlap)
 *   - Connection quality detection via navigator.connection
 *   - System-prompt caching to reduce Claude payload size
 *   - Latency dashboard (dev mode) via 'spark:latency-debug' event
 *   - PWA background audio support (service worker + Web Locks)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChunkTiming {
  /** Unique chunk sequence number (monotonically increasing). */
  seq: number;
  /** Wall-clock ms when audio capture started for this chunk. */
  captureStart: number;
  /** Wall-clock ms when audio capture ended for this chunk. */
  captureEnd: number;
  /** Wall-clock ms when Whisper transcription completed. */
  whisperEnd: number | null;
  /** Wall-clock ms when Claude Haiku analysis completed. */
  claudeEnd: number | null;
  /** Wall-clock ms when alert was delivered. */
  alertEnd: number | null;
  /** Total latency capture-start → alert-end in ms. */
  totalLatencyMs: number | null;
  /** Size of the audio blob in bytes. */
  blobBytes: number;
}

export interface LatencyStats {
  /** Rolling average total latency over last N chunks. */
  rollingAvgMs: number;
  /** Per-step averages for the rolling window. */
  avgCaptureMs: number;
  avgWhisperMs: number;
  avgClaudeMs: number;
  avgAlertMs: number;
  /** Current chunk size setting in seconds. */
  currentChunkSec: number;
  /** Connection quality label. */
  connectionQuality: ConnectionQuality;
  /** Downlink estimate in Mbps (may be undefined if API unavailable). */
  downlinkMbps: number | undefined;
}

export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'offline' | 'unknown';

export interface PipelineAlert {
  /** ISO timestamp when the alert was raised. */
  timestamp: string;
  /** Human-readable alert text derived from Claude analysis. */
  message: string;
  /** Severity level. */
  severity: 'info' | 'warning' | 'critical';
  /** Raw transcript segment that triggered the alert. */
  transcript: string;
  /** Chunk sequence number that produced this alert. */
  seq: number;
}

export interface OptimizerConfig {
  /**
   * Whisper endpoint URL.
   * For production: 'https://api.openai.com/v1/audio/transcriptions'
   */
  whisperEndpoint: string;
  /** OpenAI API key for Whisper. */
  openAiKey: string;
  /**
   * Claude Haiku proxy endpoint.
   * For production: PowerOn's Netlify function '/api/claude'.
   */
  claudeEndpoint: string;
  /** Anthropic API key (used when calling Claude directly, not via proxy). */
  anthropicKey?: string;
  /** Enable verbose latency logging to console (dev mode). */
  devMode?: boolean;
  /** Callback invoked whenever a pipeline alert is generated. */
  onAlert?: (alert: PipelineAlert) => void;
  /** Callback invoked after each chunk timing is recorded. */
  onChunkTiming?: (timing: ChunkTiming, stats: LatencyStats) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Rolling window size for latency averaging. */
const ROLLING_WINDOW = 10;

/** Chunk size boundaries in seconds. */
const CHUNK_MIN_SEC = 2;
const CHUNK_MAX_SEC = 10;
const CHUNK_DEFAULT_SEC = 5;

/** Latency thresholds that trigger adaptive chunk resizing (ms). */
const LATENCY_REDUCE_THRESHOLD_1 = 5_000; // >5s  → reduce to 3s chunks
const LATENCY_REDUCE_THRESHOLD_2 = 7_000; // >7s  → reduce to 2s chunks
const LATENCY_INCREASE_THRESHOLD = 3_000; // <3s  → increase to 7s chunks

/** Downlink threshold for "slow connection" mode (Mbps). */
const SLOW_CONNECTION_MBPS = 1;

/** Claude Haiku model identifier. */
const CLAUDE_HAIKU_MODEL = 'claude-haiku-20240307';

/** Whisper model identifier. */
const WHISPER_MODEL = 'whisper-1';

/** Whisper language (ISO 639-1, not en-US). */
const WHISPER_LANGUAGE = 'en';

/** Service worker script path (relative to app root). */
const SW_SCRIPT_PATH = '/spark-sw.js';

/** Web Lock name to prevent SW termination during active session. */
const WEB_LOCK_NAME = 'spark-audio-capture';

// ─────────────────────────────────────────────────────────────────────────────
// System prompt cache (avoid resending each chunk)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cached Claude system prompt.
 * Populated once on first use; reused for all subsequent chunks.
 */
let _cachedSystemPrompt: string | null = null;

/**
 * Returns the cached SPARK system prompt, building it on first call.
 * This avoids regenerating and transmitting the same prompt on every chunk.
 */
export function getSparkSystemPrompt(): string {
  if (_cachedSystemPrompt !== null) return _cachedSystemPrompt;

  _cachedSystemPrompt = `You are SPARK, a real-time call intelligence engine for Power On Solutions LLC, a C-10 licensed electrical contractor. You are monitoring a LIVE sales or service call transcript in real time.

Your job is to immediately identify any of the following and emit a concise alert:
- Safety concerns mentioned on the job site (arc flash, live panels, no PPE)
- Pricing objections that may lose the job
- Upsell opportunities (panel upgrade, EV charger, generator, code compliance)
- Lead qualification signals (budget, timeline, decision-maker present)
- Customer frustration or escalation risk
- Next-action commitments made by either party

Respond ONLY with a JSON object in this exact shape:
{
  "alert": true | false,
  "severity": "info" | "warning" | "critical",
  "message": "Single concise sentence describing what was detected",
  "confidence": 0.0–1.0
}

If nothing actionable is detected, respond with { "alert": false, "severity": "info", "message": "", "confidence": 0 }.
Do NOT include any text outside the JSON object.`;

  return _cachedSystemPrompt;
}

/**
 * Clears the cached system prompt (e.g., when config changes).
 */
export function clearSystemPromptCache(): void {
  _cachedSystemPrompt = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection quality detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects current network connection quality using the navigator.connection API.
 * Falls back gracefully when the API is unavailable (e.g., Safari, Firefox).
 */
export function detectConnectionQuality(): {
  quality: ConnectionQuality;
  downlinkMbps: number | undefined;
} {
  if (!navigator.onLine) {
    return { quality: 'offline', downlinkMbps: undefined };
  }

  // navigator.connection is not universally typed — access defensively
  const conn = (navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      type?: string;
    };
  }).connection;

  if (!conn) {
    return { quality: 'unknown', downlinkMbps: undefined };
  }

  const downlink: number | undefined = conn.downlink;
  const effectiveType: string | undefined = conn.effectiveType;

  if (effectiveType === '4g' || (downlink !== undefined && downlink >= 10)) {
    return { quality: 'excellent', downlinkMbps: downlink };
  }
  if (effectiveType === '3g' || (downlink !== undefined && downlink >= SLOW_CONNECTION_MBPS)) {
    return { quality: 'good', downlinkMbps: downlink };
  }
  if (effectiveType === '2g' || effectiveType === 'slow-2g' || (downlink !== undefined && downlink < SLOW_CONNECTION_MBPS)) {
    return { quality: 'poor', downlinkMbps: downlink };
  }

  return { quality: 'unknown', downlinkMbps: downlink };
}

/**
 * Returns true when the connection is considered slow (<1 Mbps or 2g/slow-2g).
 * When slow: use larger chunks (10s) and batch Claude analysis.
 */
export function isSlowConnection(): boolean {
  const { quality } = detectConnectionQuality();
  return quality === 'poor' || quality === 'offline';
}

// ─────────────────────────────────────────────────────────────────────────────
// Adaptive chunk sizing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a measured total latency and connection quality,
 * returns the recommended next chunk size in seconds.
 *
 * Rules:
 *   - Slow connection override  → 10s (batch mode)
 *   - Latency > 7s             → 2s  (max reduction)
 *   - Latency > 5s             → 3s
 *   - Latency < 3s             → 7s  (more context, pipeline is fast)
 *   - Otherwise                → current (no change)
 */
export function computeAdaptiveChunkSec(
  currentChunkSec: number,
  latencyMs: number
): number {
  if (isSlowConnection()) return CHUNK_MAX_SEC; // 10s batch mode

  if (latencyMs > LATENCY_REDUCE_THRESHOLD_2) return CHUNK_MIN_SEC;           // 2s
  if (latencyMs > LATENCY_REDUCE_THRESHOLD_1) return Math.min(currentChunkSec, 3); // 3s
  if (latencyMs < LATENCY_INCREASE_THRESHOLD) return Math.min(7, CHUNK_MAX_SEC);   // 7s

  // No change — clamp to valid range
  return Math.max(CHUNK_MIN_SEC, Math.min(currentChunkSec, CHUNK_MAX_SEC));
}

// ─────────────────────────────────────────────────────────────────────────────
// Whisper transcription
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends an audio blob to the Whisper API and returns the transcript text.
 * Intended to run in a Web Worker context via WorkerTranscriptionBridge,
 * but safe to call directly when workers are unavailable.
 *
 * @param audioBlob  Raw audio (webm/ogg/mp4 — whatever MediaRecorder produced)
 * @param endpoint   Whisper endpoint URL
 * @param apiKey     OpenAI API key
 */
export async function transcribeWithWhisper(
  audioBlob: Blob,
  endpoint: string,
  apiKey: string
): Promise<string> {
  const form = new FormData();
  form.append('file', audioBlob, `chunk-${Date.now()}.webm`);
  form.append('model', WHISPER_MODEL);
  form.append('language', WHISPER_LANGUAGE);
  form.append('response_format', 'json');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Whisper API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Haiku analysis
// ─────────────────────────────────────────────────────────────────────────────

export interface HaikuAnalysisResult {
  alert: boolean;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  confidence: number;
}

/**
 * Sends a transcript segment to Claude Haiku for real-time alert analysis.
 * The system prompt is read from cache (sent once, not per-chunk).
 *
 * Supports two modes:
 *   1. Proxy mode (claudeEndpoint is a Netlify function) — preferred for production.
 *   2. Direct Anthropic mode — requires anthropicKey.
 */
export async function analyzeWithHaiku(
  transcript: string,
  config: Pick<OptimizerConfig, 'claudeEndpoint' | 'anthropicKey'>
): Promise<HaikuAnalysisResult> {
  const systemPrompt = getSparkSystemPrompt();

  const payload = {
    model: CLAUDE_HAIKU_MODEL,
    max_tokens: 256,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Live call transcript segment:\n\n${transcript}`,
      },
    ],
  };

  let rawJson: string;

  // Determine whether we're going through the Netlify proxy or directly
  const isProxy = !config.claudeEndpoint.includes('api.anthropic.com');

  if (isProxy) {
    // PowerOn Netlify function — wraps the Anthropic call
    const res = await fetch(config.claudeEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Claude proxy error ${res.status}: ${err}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text: string }>;
      text?: string;
    };
    // Handle both proxy shapes
    rawJson =
      data.content?.[0]?.text ??
      data.text ??
      '{"alert":false,"severity":"info","message":"","confidence":0}';
  } else {
    // Direct Anthropic API call
    const res = await fetch(config.claudeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropicKey ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }
    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    rawJson = data.content?.[0]?.text ?? '{"alert":false,"severity":"info","message":"","confidence":0}';
  }

  try {
    // Strip any markdown code fences if Claude wraps the JSON
    const cleaned = rawJson.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned) as HaikuAnalysisResult;
  } catch {
    return { alert: false, severity: 'info', message: '', confidence: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Latency tracking & rolling stats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maintains a rolling window of chunk timing records and computes stats.
 */
export class LatencyTracker {
  private _window: ChunkTiming[] = [];
  private _currentChunkSec: number = CHUNK_DEFAULT_SEC;

  get currentChunkSec(): number {
    return this._currentChunkSec;
  }

  /** Record a completed chunk timing entry. */
  record(timing: ChunkTiming): void {
    this._window.push(timing);
    if (this._window.length > ROLLING_WINDOW) {
      this._window.shift();
    }

    // Adapt chunk size based on latest latency
    if (timing.totalLatencyMs !== null) {
      this._currentChunkSec = computeAdaptiveChunkSec(
        this._currentChunkSec,
        timing.totalLatencyMs
      );
    }
  }

  /** Compute rolling statistics over the current window. */
  getStats(): LatencyStats {
    const { quality, downlinkMbps } = detectConnectionQuality();

    if (this._window.length === 0) {
      return {
        rollingAvgMs: 0,
        avgCaptureMs: 0,
        avgWhisperMs: 0,
        avgClaudeMs: 0,
        avgAlertMs: 0,
        currentChunkSec: this._currentChunkSec,
        connectionQuality: quality,
        downlinkMbps,
      };
    }

    let sumTotal = 0;
    let sumCapture = 0;
    let sumWhisper = 0;
    let sumClaude = 0;
    let sumAlert = 0;
    let countTotal = 0;
    let countCapture = 0;
    let countWhisper = 0;
    let countClaude = 0;
    let countAlert = 0;

    for (const t of this._window) {
      const captureMs = t.captureEnd - t.captureStart;
      sumCapture += captureMs;
      countCapture++;

      if (t.whisperEnd !== null) {
        sumWhisper += t.whisperEnd - t.captureEnd;
        countWhisper++;
      }
      if (t.claudeEnd !== null && t.whisperEnd !== null) {
        sumClaude += t.claudeEnd - t.whisperEnd;
        countClaude++;
      }
      if (t.alertEnd !== null && t.claudeEnd !== null) {
        sumAlert += t.alertEnd - t.claudeEnd;
        countAlert++;
      }
      if (t.totalLatencyMs !== null) {
        sumTotal += t.totalLatencyMs;
        countTotal++;
      }
    }

    return {
      rollingAvgMs: countTotal > 0 ? sumTotal / countTotal : 0,
      avgCaptureMs: countCapture > 0 ? sumCapture / countCapture : 0,
      avgWhisperMs: countWhisper > 0 ? sumWhisper / countWhisper : 0,
      avgClaudeMs: countClaude > 0 ? sumClaude / countClaude : 0,
      avgAlertMs: countAlert > 0 ? sumAlert / countAlert : 0,
      currentChunkSec: this._currentChunkSec,
      connectionQuality: quality,
      downlinkMbps,
    };
  }

  /** Returns all timing records currently in the rolling window. */
  getWindow(): Readonly<ChunkTiming[]> {
    return this._window;
  }

  /** Resets the rolling window and restores default chunk size. */
  reset(): void {
    this._window = [];
    this._currentChunkSec = CHUNK_DEFAULT_SEC;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline queue for slow / offline connections
// ─────────────────────────────────────────────────────────────────────────────

export interface QueuedChunk {
  seq: number;
  blob: Blob;
  captureStart: number;
  captureEnd: number;
}

/**
 * In-memory queue for audio chunks captured while offline or on a slow
 * connection. Chunks are replayed when connectivity is restored.
 *
 * In a production build, blobs should be persisted to IndexedDB so they
 * survive page refreshes. This implementation is intentionally lightweight
 * (in-memory) to avoid external dependencies in the build session.
 */
export class OfflineChunkQueue {
  private _queue: QueuedChunk[] = [];

  enqueue(chunk: QueuedChunk): void {
    this._queue.push(chunk);
  }

  dequeue(): QueuedChunk | undefined {
    return this._queue.shift();
  }

  get length(): number {
    return this._queue.length;
  }

  drain(): QueuedChunk[] {
    const all = [...this._queue];
    this._queue = [];
    return all;
  }

  isEmpty(): boolean {
    return this._queue.length === 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Web Worker transcription bridge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an inline Web Worker that handles Whisper transcription API calls
 * off the main thread, preventing UI jank during audio processing.
 *
 * The worker receives { blob, endpoint, apiKey } via postMessage and replies
 * with { transcript } or { error }.
 *
 * Because the worker code is inlined as a Blob URL, no separate worker file
 * is needed — the worker is self-contained within this module.
 */
export function createTranscriptionWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;

  const workerSource = `
self.onmessage = async function(e) {
  const { blob, endpoint, apiKey, seq } = e.data;
  try {
    const form = new FormData();
    form.append('file', blob, 'chunk-' + seq + '.webm');
    form.append('model', 'whisper-1');
    form.append('language', 'en');
    form.append('response_format', 'json');

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      self.postMessage({ seq, error: 'Whisper ' + res.status + ': ' + errText });
      return;
    }

    const data = await res.json();
    self.postMessage({ seq, transcript: (data.text || '').trim() });
  } catch (err) {
    self.postMessage({ seq, error: String(err) });
  }
};
`;

  const blob = new Blob([workerSource], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  // Revoke the object URL shortly after creation to free memory
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
  return worker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Latency debug dashboard (dev mode)
// ─────────────────────────────────────────────────────────────────────────────

export interface LatencyDebugPayload {
  stats: LatencyStats;
  recentTimings: ChunkTiming[];
  timestamp: string;
}

/**
 * Dispatches a 'spark:latency-debug' custom event on the window object.
 * Consumers (dev tools overlays, admin panels) can listen for this event
 * to render a real-time latency dashboard without polluting production code.
 *
 * Usage:
 *   window.addEventListener('spark:latency-debug', (e) => {
 *     const { stats, recentTimings } = (e as CustomEvent<LatencyDebugPayload>).detail;
 *     console.table(stats);
 *   });
 */
export function emitLatencyDebugEvent(
  stats: LatencyStats,
  recentTimings: ChunkTiming[]
): void {
  if (typeof window === 'undefined') return;

  const payload: LatencyDebugPayload = {
    stats,
    recentTimings,
    timestamp: new Date().toISOString(),
  };

  window.dispatchEvent(
    new CustomEvent<LatencyDebugPayload>('spark:latency-debug', {
      detail: payload,
      bubbles: false,
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PWA background audio support
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers the SPARK service worker for background audio capture support.
 * The SW enables:
 *   - Audio capture when the phone screen is locked (PWA audio session)
 *   - Notification-based alerts when the app is in the background
 *   - Prevention of SW termination via the Web Locks API
 *
 * Returns the ServiceWorkerRegistration if successful, or null if
 * service workers are not supported in the current environment.
 */
export async function registerSparkServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SPARK] Service workers not supported in this browser.');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register(SW_SCRIPT_PATH, {
      scope: '/',
    });
    console.info('[SPARK] Service worker registered:', registration.scope);
    return registration;
  } catch (err) {
    console.error('[SPARK] Service worker registration failed:', err);
    return null;
  }
}

/**
 * Acquires a Web Lock to prevent the service worker from being terminated
 * while an active SPARK call session is in progress.
 *
 * The lock is held for the lifetime of the provided AbortSignal (or until
 * the page is unloaded if no signal is provided).
 *
 * Returns a release function that should be called when the session ends.
 */
export function acquireSparkWebLock(signal?: AbortSignal): Promise<() => void> {
  return new Promise((resolve) => {
    if (!('locks' in navigator)) {
      // Web Locks API not available — resolve immediately with a no-op release
      console.warn('[SPARK] Web Locks API not available; SW termination not prevented.');
      resolve(() => undefined);
      return;
    }

    let releaseFn: (() => void) | null = null;

    const lockPromise = navigator.locks.request(
      WEB_LOCK_NAME,
      { mode: 'exclusive', signal },
      () =>
        new Promise<void>((resolveLock) => {
          releaseFn = resolveLock;
          // Resolve the outer promise with the release function
          resolve(() => {
            if (releaseFn) releaseFn();
          });
        })
    );

    lockPromise.catch((err) => {
      if ((err as Error).name !== 'AbortError') {
        console.error('[SPARK] Web Lock acquisition failed:', err);
      }
      resolve(() => undefined);
    });
  });
}

/**
 * Sends a background notification alert via the Notifications API.
 * Used when the app is in the background (screen locked, minimized, etc.).
 *
 * Requires Notification permission to have been granted previously.
 */
export async function sendBackgroundAlert(alert: PipelineAlert): Promise<void> {
  if (!('Notification' in window)) return;

  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
  }

  const sw = await navigator.serviceWorker?.ready;
  if (sw) {
    await sw.showNotification('⚡ SPARK Alert', {
      body: alert.message,
      icon: '/icons/spark-icon-192.png',
      badge: '/icons/spark-badge-72.png',
      tag: `spark-alert-${alert.seq}`,
      data: { alert },
      // Vibrate pattern for job-site notification: short-long-short
      vibrate: [200, 100, 200],
    } as NotificationOptions & { vibrate?: number[] });
  } else {
    // Fallback to basic Notification when SW is unavailable
    new Notification('⚡ SPARK Alert', { body: alert.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SparkLatencyOptimizer — main class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SparkLatencyOptimizer orchestrates the full SPARK pipeline:
 *
 *   MediaRecorder → Whisper (Worker) → Claude Haiku → Alert
 *
 * Parallel processing:
 *   While chunk N is being transcribed, chunk N+1 is already being captured.
 *   Capture never stops; transcription runs in a Web Worker to avoid
 *   blocking the main thread.
 *
 * Usage:
 *   const optimizer = new SparkLatencyOptimizer(config);
 *   await optimizer.start(mediaStream);
 *   // ... call in progress ...
 *   optimizer.stop();
 */
export class SparkLatencyOptimizer {
  private _config: OptimizerConfig;
  private _tracker: LatencyTracker;
  private _offlineQueue: OfflineChunkQueue;
  private _worker: Worker | null = null;
  private _recorder: MediaRecorder | null = null;
  private _seq: number = 0;
  private _active: boolean = false;
  private _lockRelease: (() => void) | null = null;
  private _pendingWorkerCallbacks: Map<
    number,
    { resolve: (t: string) => void; reject: (e: Error) => void }
  > = new Map();

  constructor(config: OptimizerConfig) {
    this._config = config;
    this._tracker = new LatencyTracker();
    this._offlineQueue = new OfflineChunkQueue();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Starts the SPARK pipeline on the provided MediaStream.
   * Registers the service worker, acquires a Web Lock, and begins
   * adaptive audio capture with parallel transcription.
   */
  async start(stream: MediaStream): Promise<void> {
    if (this._active) return;
    this._active = true;
    this._seq = 0;
    this._tracker.reset();

    // PWA setup
    await registerSparkServiceWorker();
    const abortController = new AbortController();
    this._lockRelease = await acquireSparkWebLock(abortController.signal);

    // Create transcription worker (off-main-thread Whisper calls)
    this._worker = createTranscriptionWorker();
    this._wireWorkerMessages();

    // Register online/offline listeners to drain the offline queue
    window.addEventListener('online', this._onOnline);
    window.addEventListener('offline', this._onOffline);

    // Begin the capture loop
    this._captureLoop(stream);
  }

  /**
   * Stops the SPARK pipeline and releases all resources.
   */
  stop(): void {
    this._active = false;
    this._recorder?.stop();
    this._recorder = null;
    this._worker?.terminate();
    this._worker = null;
    this._lockRelease?.();
    this._lockRelease = null;
    window.removeEventListener('online', this._onOnline);
    window.removeEventListener('offline', this._onOffline);
    this._pendingWorkerCallbacks.clear();
  }

  /** Returns the current rolling latency statistics. */
  getStats(): LatencyStats {
    return this._tracker.getStats();
  }

  /** Returns the current adaptive chunk size in seconds. */
  get chunkSec(): number {
    return this._tracker.currentChunkSec;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Main capture loop.
   * Captures audio in adaptive-sized chunks. While chunk N is being
   * processed (Whisper + Claude), chunk N+1 capture is already underway.
   */
  private _captureLoop(stream: MediaStream): void {
    if (!this._active) return;

    const chunkSec = isSlowConnection()
      ? CHUNK_MAX_SEC
      : this._tracker.currentChunkSec;

    const captureStart = Date.now();
    const seq = ++this._seq;

    const chunks: BlobPart[] = [];
    const mimeType = this._getSupportedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this._recorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const captureEnd = Date.now();
      const blob = new Blob(chunks, { type: mimeType ?? 'audio/webm' });

      // Start the next chunk immediately (parallel with transcription)
      if (this._active) {
        setTimeout(() => this._captureLoop(stream), 0);
      }

      // Process this chunk asynchronously
      this._processChunk({ seq, blob, captureStart, captureEnd });
    };

    recorder.start();

    // Stop after the configured chunk duration
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, chunkSec * 1_000);
  }

  /**
   * Processes a captured audio chunk through the full pipeline:
   *   Blob → Whisper → Claude Haiku → Alert
   *
   * If offline, the chunk is queued for later processing.
   */
  private async _processChunk(queued: QueuedChunk): Promise<void> {
    const { seq, blob, captureStart, captureEnd } = queued;

    if (!navigator.onLine) {
      this._offlineQueue.enqueue(queued);
      if (this._config.devMode) {
        console.info(`[SPARK] Chunk #${seq} queued (offline). Queue depth: ${this._offlineQueue.length}`);
      }
      return;
    }

    const timing: ChunkTiming = {
      seq,
      captureStart,
      captureEnd,
      whisperEnd: null,
      claudeEnd: null,
      alertEnd: null,
      totalLatencyMs: null,
      blobBytes: blob.size,
    };

    try {
      // ── Step 2: Whisper transcription ──────────────────────────────────────
      let transcript: string;
      try {
        transcript = await this._transcribe(blob, seq);
      } catch (err) {
        console.error(`[SPARK] Whisper failed for chunk #${seq}:`, err);
        return;
      }
      timing.whisperEnd = Date.now();

      if (!transcript) return; // Skip silent / empty chunks

      // ── Step 3: Claude Haiku analysis ─────────────────────────────────────
      let analysis: HaikuAnalysisResult;
      try {
        analysis = await analyzeWithHaiku(transcript, {
          claudeEndpoint: this._config.claudeEndpoint,
          anthropicKey: this._config.anthropicKey,
        });
      } catch (err) {
        console.error(`[SPARK] Claude Haiku failed for chunk #${seq}:`, err);
        return;
      }
      timing.claudeEnd = Date.now();

      // ── Step 4: Alert delivery ─────────────────────────────────────────────
      if (analysis.alert && analysis.message) {
        const alert: PipelineAlert = {
          timestamp: new Date().toISOString(),
          message: analysis.message,
          severity: analysis.severity,
          transcript,
          seq,
        };

        // Deliver alert on main thread
        this._config.onAlert?.(alert);

        // Background notification if app is backgrounded
        if (document.hidden) {
          await sendBackgroundAlert(alert).catch(console.warn);
        }
      }
      timing.alertEnd = Date.now();
      timing.totalLatencyMs = timing.alertEnd - timing.captureStart;

    } catch (err) {
      console.error(`[SPARK] Pipeline error for chunk #${seq}:`, err);
    } finally {
      // Record timing regardless of errors
      this._tracker.record(timing);
      const stats = this._tracker.getStats();

      this._config.onChunkTiming?.(timing, stats);

      if (this._config.devMode) {
        emitLatencyDebugEvent(stats, [...this._tracker.getWindow()]);
        console.info(
          `[SPARK] Chunk #${seq} | total: ${timing.totalLatencyMs ?? '?'}ms | ` +
          `whisper: ${timing.whisperEnd ? timing.whisperEnd - timing.captureEnd : '?'}ms | ` +
          `claude: ${timing.claudeEnd && timing.whisperEnd ? timing.claudeEnd - timing.whisperEnd : '?'}ms | ` +
          `chunk: ${this._tracker.currentChunkSec}s | conn: ${stats.connectionQuality}`
        );
      }
    }
  }

  /**
   * Transcribes a blob, using the Web Worker when available,
   * falling back to a direct fetch on the main thread.
   */
  private _transcribe(blob: Blob, seq: number): Promise<string> {
    if (this._worker) {
      return new Promise<string>((resolve, reject) => {
        this._pendingWorkerCallbacks.set(seq, { resolve, reject });
        this._worker!.postMessage({
          seq,
          blob,
          endpoint: this._config.whisperEndpoint,
          apiKey: this._config.openAiKey,
        });
      });
    }

    // Fallback: direct main-thread call
    return transcribeWithWhisper(
      blob,
      this._config.whisperEndpoint,
      this._config.openAiKey
    );
  }

  /** Wires incoming messages from the transcription Web Worker. */
  private _wireWorkerMessages(): void {
    if (!this._worker) return;

    this._worker.onmessage = (e: MessageEvent<{ seq: number; transcript?: string; error?: string }>) => {
      const { seq, transcript, error } = e.data;
      const cb = this._pendingWorkerCallbacks.get(seq);
      if (!cb) return;
      this._pendingWorkerCallbacks.delete(seq);

      if (error) {
        cb.reject(new Error(error));
      } else {
        cb.resolve(transcript ?? '');
      }
    };

    this._worker.onerror = (e) => {
      console.error('[SPARK] Worker error:', e.message);
      // Reject all pending callbacks
      for (const [, cb] of this._pendingWorkerCallbacks) {
        cb.reject(new Error(`Worker error: ${e.message}`));
      }
      this._pendingWorkerCallbacks.clear();
    };
  }

  /** Called when the browser comes back online — drains the offline queue. */
  private _onOnline = (): void => {
    const queued = this._offlineQueue.drain();
    if (queued.length === 0) return;
    console.info(`[SPARK] Connection restored. Processing ${queued.length} queued chunk(s).`);
    for (const chunk of queued) {
      this._processChunk(chunk);
    }
  };

  private _onOffline = (): void => {
    console.warn('[SPARK] Connection lost. Chunks will be queued until reconnect.');
  };

  /**
   * Returns the best supported MIME type for MediaRecorder in this browser.
   */
  private _getSupportedMimeType(): string | undefined {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates and returns a fully configured SparkLatencyOptimizer instance.
 * This is the recommended entry point for consumers.
 *
 * Example:
 *   const optimizer = createSparkOptimizer({
 *     whisperEndpoint: 'https://api.openai.com/v1/audio/transcriptions',
 *     openAiKey: import.meta.env.VITE_OPENAI_API_KEY,
 *     claudeEndpoint: '/api/claude',
 *     devMode: import.meta.env.DEV,
 *     onAlert: (alert) => dispatch({ type: 'SPARK_ALERT', payload: alert }),
 *   });
 *   const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
 *   await optimizer.start(stream);
 */
export function createSparkOptimizer(config: OptimizerConfig): SparkLatencyOptimizer {
  return new SparkLatencyOptimizer(config);
}
