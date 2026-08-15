import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildProductUsageTelemetryRecord,
  boundEngagementDurationSeconds,
  ENGAGEMENT_WINDOW_MAX_SECONDS,
  isPilotTelemetryEventName,
  isProductUsageTelemetryEventName,
  normalizeCanonicalProductModule,
  sanitizeProductUsageTelemetryMetadata,
} from '@/services/pilotTelemetryShared'
import { ProductUsageTelemetryTracker } from '@/services/productUsageTelemetry'
import { normalizeModule } from '@/lib/guardian/presenceMonitor'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const SHARED = read('src/services/pilotTelemetryShared.ts')
const CLIENT = read('src/services/pilotTelemetryClient.ts')
const TRACKER = read('src/services/productUsageTelemetry.ts')
const FUNCTION = read('netlify/functions/pilot-telemetry.ts')
const PRESENCE = read('src/lib/guardian/presenceMonitor.ts')
const APP_SHELL = read('src/components/layout/AppShell.tsx')
const AUTH_STORE = read('src/store/authStore.ts')
const SURFACE = read('src/components/guardian/FounderContractorAdminSurface.tsx')
const MIGRATION_FILES = readdirSync(join(ROOT, 'supabase/migrations'))
const TELEMETRY_SCHEMA = read('supabase/migrations/117_pilot_telemetry.sql')

describe('GUARDIAN-3B4 privacy / sanitization', () => {
  it('module_entered accepts normalized module and identity fields only', () => {
    const record = buildProductUsageTelemetryRecord({
      eventName: 'module_entered',
      module: 'blueprint-ai',
      metadata: {
        previous_module: 'projects',
        device_id: 'device-abc-123456',
        session_id: 'session-abc-123456',
      },
    })
    expect(record).toEqual({
      eventName: 'module_entered',
      module: 'blueprint',
      feature: null,
      objectId: null,
      metadata: {
        previous_module: 'projects',
        device_id: 'device-abc-123456',
        session_id: 'session-abc-123456',
      },
      occurredAt: null,
    })
  })

  it('module_entered rejects/removes arbitrary metadata', () => {
    const metadata = sanitizeProductUsageTelemetryMetadata('module_entered', {
      previous_module: 'home',
      projectName: 'Secret Job',
      projectId: 'proj-1',
      customerName: 'Acme',
      estimateId: 'est-9',
      estimateTotal: 12000,
      fileName: 'plans.pdf',
      route: '/projects/123?q=roof',
      searchQuery: 'roof',
      mouseX: 12,
      keystrokes: 'abc',
      notes: 'do not store',
    })
    expect(metadata).toEqual({ previous_module: 'home' })
  })

  it('project/customer/estimate/file/route content cannot be persisted', () => {
    const record = buildProductUsageTelemetryRecord({
      eventName: 'module_entered',
      module: 'projects',
      metadata: {
        project_name: 'Blocked',
        project_id: 'p1',
        customer_id: 'c1',
        estimate_name: 'Bid',
        filename: 'x.pdf',
        path: '/tmp/x',
        routeParams: { id: '1' },
      },
    })
    expect(record?.metadata).toEqual({})
    expect(record?.objectId).toBeNull()
  })

  it('engagement duration is bounded to the 30-minute inactivity boundary', () => {
    expect(boundEngagementDurationSeconds(12.6)).toBe(13)
    expect(boundEngagementDurationSeconds(0)).toBeNull()
    expect(boundEngagementDurationSeconds(ENGAGEMENT_WINDOW_MAX_SECONDS + 500)).toBe(ENGAGEMENT_WINDOW_MAX_SECONDS)
    expect(ENGAGEMENT_WINDOW_MAX_SECONDS).toBe(30 * 60)
  })

  it('unknown event types are rejected', () => {
    expect(isPilotTelemetryEventName('clickstream')).toBe(false)
    expect(isProductUsageTelemetryEventName('heartbeat')).toBe(false)
    expect(buildProductUsageTelemetryRecord({
      eventName: 'module_entered',
      module: 'home',
      metadata: { duration_seconds: 5 },
    })?.metadata).not.toHaveProperty('duration_seconds')
  })
})

describe('GUARDIAN-3B4 event behavior', () => {
  let trackFn: ReturnType<typeof vi.fn>
  let tracker: ProductUsageTelemetryTracker

  beforeEach(() => {
    trackFn = vi.fn().mockResolvedValue({ ok: true })
    tracker = new ProductUsageTelemetryTracker(trackFn as any)
    tracker.start({ sessionId: 'session-abc-123456', deviceId: 'device-abc-123456', initialModule: 'home' })
  })

  afterEach(() => {
    tracker.stop('stop')
  })

  it('module change emits exactly one module_entered; repeats emit nothing; next emits one', async () => {
    tracker.setModule('home')
    tracker.setModule('home')
    tracker.setModule('projects')
    tracker.setModule('projects')
    tracker.setModule('blueprint')
    await Promise.resolve()

    const moduleEvents = trackFn.mock.calls
      .map((call) => call[0])
      .filter((payload) => payload.eventName === 'module_entered')

    expect(moduleEvents).toHaveLength(3)
    expect(moduleEvents[0]).toMatchObject({ module: 'home' })
    expect(moduleEvents[1]).toMatchObject({
      module: 'projects',
      metadata: expect.objectContaining({ previous_module: 'home' }),
    })
    expect(moduleEvents[2]).toMatchObject({
      module: 'blueprint',
      metadata: expect.objectContaining({ previous_module: 'projects' }),
    })
  })

  it('Blueprint reports blueprint and Material Takeoff reports material-takeoff', () => {
    expect(normalizeCanonicalProductModule('blueprint-ai')).toBe('blueprint')
    expect(normalizeModule('blueprint-ai')).toBe('blueprint')
    expect(normalizeCanonicalProductModule('material-takeoff')).toBe('material-takeoff')
    expect(normalizeModule('material-takeoff')).toBe('material-takeoff')
  })

  it('heartbeat / pointer / keyboard activity do not directly send telemetry', () => {
    expect(PRESENCE).not.toContain('module_entered')
    expect(PRESENCE).not.toContain('engagement_window')
    expect(PRESENCE).not.toContain('trackPilotTelemetryEvent')
    expect(TRACKER).not.toContain('setInterval')
    expect(TRACKER).toContain('noteMeaningfulInteraction')
    expect(TRACKER).toContain('Never sends per-event telemetry')

    tracker.noteMeaningfulInteraction()
    tracker.noteMeaningfulInteraction()
    expect(trackFn).not.toHaveBeenCalled()
  })

  it('meaningful engagement creates a bounded engagement_window and flushes on module/hidden/lock boundaries', async () => {
    const started = Date.now() - 45_000
    tracker.noteMeaningfulInteraction(started)
    tracker.setModule('projects')
    await Promise.resolve()

    const engagement = trackFn.mock.calls
      .map((call) => call[0])
      .find((payload) => payload.eventName === 'engagement_window')

    expect(engagement).toMatchObject({
      eventName: 'engagement_window',
      module: 'home',
      metadata: expect.objectContaining({
        duration_seconds: expect.any(Number),
        device_id: 'device-abc-123456',
        session_id: 'session-abc-123456',
      }),
    })
    expect(engagement.metadata.duration_seconds).toBeGreaterThanOrEqual(1)
    expect(engagement.metadata.duration_seconds).toBeLessThanOrEqual(ENGAGEMENT_WINDOW_MAX_SECONDS)

    trackFn.mockClear()
    tracker.noteMeaningfulInteraction(Date.now() - 12_000)
    tracker.flushEngagement('hidden')
    await Promise.resolve()
    expect(trackFn.mock.calls.some((call) => call[0].eventName === 'engagement_window')).toBe(true)

    trackFn.mockClear()
    tracker.noteMeaningfulInteraction(Date.now() - 8_000)
    tracker.stop('manual_lock')
    await Promise.resolve()
    expect(trackFn.mock.calls.some((call) => call[0].eventName === 'engagement_window')).toBe(true)
  })

  it('signout and account switch clear prior attribution', async () => {
    tracker.setModule('projects')
    tracker.stop('signout')
    expect(tracker.getState().sessionId).toBeNull()
    expect(tracker.getState().running).toBe(false)

    tracker.start({ sessionId: 'session-xyz-999999', deviceId: 'device-xyz-999999' })
    tracker.setModule('money')
    await Promise.resolve()

    const moduleEvents = trackFn.mock.calls.map((call) => call[0]).filter((p) => p.eventName === 'module_entered')
    const last = moduleEvents[moduleEvents.length - 1]
    expect(last?.metadata.session_id).toBe('session-xyz-999999')
    expect(last?.metadata.device_id).toBe('device-xyz-999999')
  })
})

describe('GUARDIAN-3B4 identity / authority / wiring', () => {
  it('server associates org/user and allowlists product usage events with device/session metadata', () => {
    expect(FUNCTION).toContain('isProductUsageTelemetryEventName')
    expect(FUNCTION).toContain('buildProductUsageTelemetryRecord')
    expect(FUNCTION).toContain("actor.isActive === false")
    expect(FUNCTION).toContain("return json(403, { error: 'Access unavailable.' })")
    // Product-usage org comes from owned user_sessions; other events keep actor.organizationId.
    expect(FUNCTION).toContain('resolveProductUsageSessionContext')
    expect(FUNCTION).toContain('organization_id: sessionCtx.organizationId')
    expect(FUNCTION).toContain('organization_id: actor.organizationId')
    expect(FUNCTION).toContain('actor_user_id: actor.actorUserId')
  })

  it('demo behavior remains isolated/unchanged', () => {
    expect(CLIENT).toContain('isDemoRuntimeActive()')
    expect(CLIENT).toContain('return { ok: true, skipped: true }')
    expect(FUNCTION).toContain("reason: 'demo_mode'")
  })

  it('tracker is wired through AppShell module changes and auth lifecycle without presence firehose', () => {
    expect(APP_SHELL).toContain('productUsageTelemetry.setModule(module)')
    expect(AUTH_STORE).toContain('productUsageTelemetry.start({')
    expect(AUTH_STORE).toContain('productUsageTelemetry.stop(reason)')
    expect(AUTH_STORE).toContain("stopPresenceMonitor(endedReason)")
    expect(AUTH_STORE).toContain("stopPresenceMonitor('signout')")
    expect(PRESENCE).not.toContain('productUsageTelemetry')
    expect(PRESENCE).not.toContain('pilot')
  })

  it('telemetry schema remains sufficient; LEAD-SRC-2F owns migration 126', () => {
    expect(SHARED).toContain("'module_entered'")
    expect(SHARED).toContain("'engagement_window'")
    expect(MIGRATION_FILES.some((name) => name.startsWith('126_organization_hunter_tenant'))).toBe(true)
    expect(TELEMETRY_SCHEMA).toContain('event_name')
    expect(TELEMETRY_SCHEMA).toContain('module')
    expect(TELEMETRY_SCHEMA).toContain('metadata')
    expect(TELEMETRY_SCHEMA).toContain('organization_id')
    expect(TELEMETRY_SCHEMA).toContain('actor_user_id')
  })

  it('Security Center / contractor modal / revoke restore remain intact', () => {
    expect(SURFACE).toContain('Security Center')
    expect(SURFACE).toContain('data-testid="contractor-detail-modal"')
    expect(SURFACE).toContain('Revoke Access')
    expect(SURFACE).toContain('Restore Access')
  })
})
