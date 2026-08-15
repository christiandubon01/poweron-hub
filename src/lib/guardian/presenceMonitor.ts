/**
 * Guardian presence monitor — GUARDIAN-3B2
 *
 * Responsibilities:
 *   - 90-second heartbeat → session.validate (last_active_at, module, visibility)
 *   - Human-interaction tracking → session.interaction (last_interaction_at)
 *   - 30-minute inactivity → existing PIN lock via onInactivityLock callback
 *   - Visibility/focus transitions → immediate presence update + inactivity check
 *   - Module change reporting → immediate session.validate on module switch
 *
 * Design rules (from spec):
 *   - Heartbeat MUST NOT update last_interaction_at (network != human activity)
 *   - Inactivity lock is NOT a Supabase signOut — reuses existing PIN lock path
 *   - Timer duplication is prevented by stop() before start()
 *   - Background throttling defence: check elapsed time on visibility/focus restore
 *   - Interaction reports are throttled: max one server call per 10 seconds
 *   - focus + visibilitychange deduped: only one resume check per RESUME_DEDUP_MS
 */

import { sessionStoreCall } from '@/lib/auth/sessionStoreClient'

// ── Constants ─────────────────────────────────────────────────────────────────

export const HEARTBEAT_MS          = 90_000        // 90 seconds
export const INACTIVITY_LIMIT_MS   = 30 * 60_000   // 30 minutes
const        INACTIVITY_CHECK_MS   = 60_000         // check every 60 s (foreground)
const        INTERACTION_THROTTLE  = 10_000         // max 1 server interaction per 10 s
const        RESUME_DEDUP_MS       = 5_000          // prevent double-fire when focus+visibilitychange fire together

// ── Module normalization ──────────────────────────────────────────────────────

const MODULE_MAP: Record<string, string> = {
  'project-inner':    'projects',
  'team':             'team',
  'money':            'money',
  'field-log':        'field-log',
  'settings':         'settings',
  'activity':         'activity',
  'guardian':         'guardian',
  'journal':          'journal',
  'sales-intelligence': 'sales-intelligence',
  'home':             'home',
  'projects':         'projects',
  'blueprint':        'blueprint',
  'blueprint-ai':     'blueprint',    // sidebar view name for Blueprint AI panel
  'material-takeoff': 'material-takeoff',
  'estimates':        'estimates',
  'crew-portal':      'crew-portal',
  'employee-portal':  'employee-portal',
}

export function normalizeModule(view: string): string {
  return MODULE_MAP[view] ?? 'home'
}

// ── Presence monitor (singleton) ──────────────────────────────────────────────

class PresenceMonitor {
  private sessionId: string | null = null
  private currentModule: string = 'home'
  private onInactivityLock: (() => void) | null = null

  private heartbeatTimer:  ReturnType<typeof setInterval> | null = null
  private inactivityTimer: ReturnType<typeof setInterval> | null = null
  private cleanupFns: Array<() => void> = []

  private lastInteractionAt: number = 0
  private lastInteractionReportAt: number = 0
  private lastResumeAt: number = 0   // dedup: focus+visibilitychange often fire together

  // ── Public API ──────────────────────────────────────────────────────────────

  start(config: {
    sessionId: string
    initialModule?: string
    onInactivityLock: () => void
  }): void {
    this.stop()  // clear any prior monitor — ensures single timer per tab

    this.sessionId              = config.sessionId
    this.currentModule          = config.initialModule ?? 'home'
    this.onInactivityLock       = config.onInactivityLock
    this.lastInteractionAt      = Date.now()
    this.lastInteractionReportAt = 0
    this.lastResumeAt           = 0

    // 90-second heartbeat (updates last_active_at, module, visibility)
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS)

    // 60-second inactivity check (defence when timers run in foreground)
    this.inactivityTimer = setInterval(() => this.checkInactivity(), INACTIVITY_CHECK_MS)

    // Human-interaction signals
    const onPointerdown = () => this.onInteraction()
    const onKeydown     = () => this.onInteraction()
    document.addEventListener('pointerdown', onPointerdown, { passive: true })
    document.addEventListener('keydown',     onKeydown,     { passive: true })

    // Visibility change (covers browser tab hide/show and app backgrounding)
    const onVisibilityChange = () => this.handleVisibilityChange()
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Window focus — same resume logic as visibilitychange:visible; dedup prevents double-fire
    const onFocus = () => this.handleResume()
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus)
    }

    this.cleanupFns = [
      () => document.removeEventListener('pointerdown',      onPointerdown),
      () => document.removeEventListener('keydown',          onKeydown),
      () => document.removeEventListener('visibilitychange', onVisibilityChange),
      () => { if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus) },
    ]
  }

  stop(): void {
    if (this.heartbeatTimer)  { clearInterval(this.heartbeatTimer);  this.heartbeatTimer  = null }
    if (this.inactivityTimer) { clearInterval(this.inactivityTimer); this.inactivityTimer = null }
    this.cleanupFns.forEach(fn => fn())
    this.cleanupFns = []
    this.sessionId       = null
    this.onInactivityLock = null
  }

  /**
   * Called by AppShell whenever the active view changes.
   * AppShell pre-normalizes via normalizeModule() before calling here.
   * Reports the new module immediately then stores it for future heartbeats.
   */
  setModule(module: string): void {
    if (!this.sessionId) return
    if (module === this.currentModule) return
    this.currentModule = module
    // Module change → immediate heartbeat (no interaction_at update)
    void this.sendValidate(module, document.visibilityState === 'visible' ? 'visible' : 'hidden')
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private onInteraction(): void {
    this.lastInteractionAt = Date.now()
    const now = Date.now()
    if (now - this.lastInteractionReportAt > INTERACTION_THROTTLE) {
      this.lastInteractionReportAt = now
      void this.reportInteraction()
    }
  }

  private async reportInteraction(): Promise<void> {
    if (!this.sessionId) return
    await sessionStoreCall('session.interaction', { sessionId: this.sessionId })
  }

  private async heartbeat(): Promise<void> {
    if (!this.sessionId) return
    const vis = document.visibilityState === 'visible' ? 'visible' : 'hidden'
    await this.sendValidate(this.currentModule, vis)
  }

  private async sendValidate(module: string, visibilityState: string): Promise<void> {
    if (!this.sessionId) return
    await sessionStoreCall('session.validate', {
      sessionId: this.sessionId,
      module,
      visibilityState,
    })
  }

  private checkInactivity(): void {
    if (!this.onInactivityLock) return
    if (Date.now() - this.lastInteractionAt >= INACTIVITY_LIMIT_MS) {
      this.triggerInactivityLock()
    }
  }

  private triggerInactivityLock(): void {
    const cb = this.onInactivityLock
    this.stop()  // stop timers and listeners before calling lock
    cb?.()
  }

  /**
   * Shared resume handler for window focus and visibilitychange:visible.
   * Deduped so that focus+visibilitychange firing together (< RESUME_DEDUP_MS apart)
   * produce only one server call and one inactivity check.
   *
   * Inactivity elapsed time is checked FIRST — lock fires before any interaction reset.
   */
  private handleResume(): void {
    if (!this.sessionId) return
    const now = Date.now()
    if (now - this.lastResumeAt < RESUME_DEDUP_MS) return   // dedup
    this.lastResumeAt = now

    const elapsed = now - this.lastInteractionAt
    if (elapsed >= INACTIVITY_LIMIT_MS) {
      this.triggerInactivityLock()
      return
    }
    // Return from < 30 min idle → immediate activity report + heartbeat
    this.onInteraction()
    void this.heartbeat()
  }

  private handleVisibilityChange(): void {
    if (!this.sessionId) return
    if (document.visibilityState === 'visible') {
      this.handleResume()
    } else {
      // Page hidden — report immediately so the row shows hidden state
      void this.sendValidate(this.currentModule, 'hidden')
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const presenceMonitor = new PresenceMonitor()
