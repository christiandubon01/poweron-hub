/**
 * GUARDIAN-3B4 — sanitized product-usage telemetry tracker.
 *
 * Separate from presenceMonitor:
 *   - presence heartbeat / interaction remain operational only
 *   - this tracker emits sparse module_entered + engagement_window events
 *   - never a 90s telemetry heartbeat, never per-click network firehose
 */

import { INACTIVITY_LIMIT_MS } from '@/lib/guardian/presenceMonitor'
import { trackPilotTelemetryEvent } from '@/services/pilotTelemetryClient'
import {
  ENGAGEMENT_WINDOW_MAX_SECONDS,
  normalizeCanonicalProductModule,
  type CanonicalProductModule,
} from '@/services/pilotTelemetryShared'

const MIN_ENGAGEMENT_SECONDS = 1

type TrackFn = typeof trackPilotTelemetryEvent

export type ProductUsageCloseReason =
  | 'module_change'
  | 'hidden'
  | 'manual_lock'
  | 'inactivity_timeout'
  | 'signout'
  | 'account_switch'
  | 'stop'

export class ProductUsageTelemetryTracker {
  private sessionId: string | null = null
  private deviceId: string | null = null
  private currentModule: CanonicalProductModule = 'home'
  private hasEmittedCurrentModule = false
  private windowStartedAt: number | null = null
  private lastInteractionAt = 0
  private running = false
  private cleanupFns: Array<() => void> = []
  private trackFn: TrackFn

  constructor(trackFn: TrackFn = trackPilotTelemetryEvent) {
    this.trackFn = trackFn
  }

  start(config: {
    sessionId: string
    deviceId?: string | null
    initialModule?: string | null
  }): void {
    this.stop('account_switch')

    this.sessionId = config.sessionId
    this.deviceId = config.deviceId ?? null
    this.currentModule = normalizeCanonicalProductModule(config.initialModule)
    this.hasEmittedCurrentModule = false
    this.windowStartedAt = null
    this.lastInteractionAt = Date.now()
    this.running = true

    if (typeof document === 'undefined') return

    const onPointerdown = () => this.noteMeaningfulInteraction()
    const onKeydown = () => this.noteMeaningfulInteraction()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        this.flushEngagement('hidden')
      }
    }

    document.addEventListener('pointerdown', onPointerdown, { passive: true })
    document.addEventListener('keydown', onKeydown, { passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)

    this.cleanupFns = [
      () => document.removeEventListener('pointerdown', onPointerdown),
      () => document.removeEventListener('keydown', onKeydown),
      () => document.removeEventListener('visibilitychange', onVisibilityChange),
    ]
  }

  stop(reason: ProductUsageCloseReason = 'stop'): void {
    if (this.running) {
      this.flushEngagement(reason)
    }
    this.cleanupFns.forEach((fn) => fn())
    this.cleanupFns = []
    this.sessionId = null
    this.deviceId = null
    this.windowStartedAt = null
    this.hasEmittedCurrentModule = false
    this.running = false
  }

  /**
   * Called when the active product module changes (already normalized preferred).
   * Emits at most one module_entered per actual module transition.
   */
  setModule(viewOrModule: string): void {
    if (!this.running || !this.sessionId) return

    const next = normalizeCanonicalProductModule(viewOrModule)
    if (next === this.currentModule) {
      if (!this.hasEmittedCurrentModule) {
        this.hasEmittedCurrentModule = true
        void this.emitModuleEntered(next, null)
      }
      return
    }

    const previous = this.currentModule
    this.flushEngagement('module_change')
    this.currentModule = next
    this.hasEmittedCurrentModule = true
    void this.emitModuleEntered(next, previous)
  }

  /** Local-only: starts/resumes an engagement window. Never sends per-event telemetry. */
  noteMeaningfulInteraction(now = Date.now()): void {
    if (!this.running || !this.sessionId) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    this.lastInteractionAt = now
    if (this.windowStartedAt == null) {
      this.windowStartedAt = now
    }

    // Cap absurd forgotten-tab engagement without emitting a telemetry heartbeat.
    if (now - this.windowStartedAt >= INACTIVITY_LIMIT_MS) {
      this.flushEngagement('inactivity_timeout')
    }
  }

  flushEngagement(_reason: ProductUsageCloseReason = 'stop', now = Date.now()): void {
    if (!this.running || !this.sessionId || this.windowStartedAt == null) {
      this.windowStartedAt = null
      return
    }

    const rawSeconds = Math.floor((now - this.windowStartedAt) / 1000)
    this.windowStartedAt = null
    if (rawSeconds < MIN_ENGAGEMENT_SECONDS) return

    const durationSeconds = Math.min(rawSeconds, ENGAGEMENT_WINDOW_MAX_SECONDS)
    void this.emitEngagementWindow(this.currentModule, durationSeconds)
  }

  getState() {
    return {
      running: this.running,
      sessionId: this.sessionId,
      deviceId: this.deviceId,
      currentModule: this.currentModule,
      hasEmittedCurrentModule: this.hasEmittedCurrentModule,
      windowStartedAt: this.windowStartedAt,
      lastInteractionAt: this.lastInteractionAt,
    }
  }

  private async emitModuleEntered(
    module: CanonicalProductModule,
    previousModule: CanonicalProductModule | null,
  ): Promise<void> {
    try {
      await this.trackFn({
        eventName: 'module_entered',
        module,
        feature: null,
        objectId: null,
        metadata: {
          ...(previousModule ? { previous_module: previousModule } : {}),
          ...(this.deviceId ? { device_id: this.deviceId } : {}),
          ...(this.sessionId ? { session_id: this.sessionId } : {}),
        },
      })
    } catch {
      // Telemetry must never break navigation.
    }
  }

  private async emitEngagementWindow(
    module: CanonicalProductModule,
    durationSeconds: number,
  ): Promise<void> {
    try {
      await this.trackFn({
        eventName: 'engagement_window',
        module,
        feature: null,
        objectId: null,
        metadata: {
          duration_seconds: durationSeconds,
          ...(this.deviceId ? { device_id: this.deviceId } : {}),
          ...(this.sessionId ? { session_id: this.sessionId } : {}),
        },
      })
    } catch {
      // Telemetry must never break lock/signout.
    }
  }
}

export const productUsageTelemetry = new ProductUsageTelemetryTracker()
