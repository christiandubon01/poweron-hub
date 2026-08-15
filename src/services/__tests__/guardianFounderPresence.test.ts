import { describe, expect, it, vi } from 'vitest'
import {
  buildFounderPresenceDetail,
  buildFounderPresenceSummary,
  buildFounderSecurityAlerts,
  buildFounderSecurityHistory,
  countUnreadGuardianSecurityAlerts,
  createGuardianPollingLoop,
  deriveFounderPresenceStatus,
  FOUNDER_GUARDIAN_POLL_INTERVAL_MS,
  getFounderModuleLabel,
  isAlertWorthySecurityEvent,
  readGuardianSecurityLastSeen,
  writeGuardianSecurityLastSeen,
} from '@/services/guardianFounderPresence'

const SERVER_NOW = '2026-08-15T12:00:00.000Z'

function session(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'session-1',
    user_id: 'user-1',
    org_id: 'org-1',
    device_id: 'device-1',
    device_type: 'web',
    device_info: { platform: 'web' },
    module: 'guardian',
    started_at: '2026-08-15T11:00:00.000Z',
    last_active_at: '2026-08-15T11:58:00.000Z',
    last_interaction_at: '2026-08-15T11:59:00.000Z',
    visibility_state: 'visible',
    ended_reason: null,
    ended_at: null,
    user_full_name: 'Founder Visible User',
    user_email: 'user@example.test',
    user_role: 'owner',
    ...overrides,
  }
}

function securityEvent(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'session-1',
    user_id: 'user-1',
    org_id: 'org-1',
    device_id: 'device-1',
    event_type: 'session_started',
    public_ip: '203.0.113.10',
    previous_public_ip: null,
    is_new_device: false,
    occurred_at: '2026-08-15T11:55:00.000Z',
    user_full_name: 'Founder Visible User',
    user_email: 'user@example.test',
    ...overrides,
  }
}

describe('guardian founder presence status logic', () => {
  it('fresh visible + recent interaction = Active', () => {
    expect(deriveFounderPresenceStatus(session(), SERVER_NOW)).toBe('active')
  })

  it('fresh heartbeat + older interaction = Idle', () => {
    expect(deriveFounderPresenceStatus(session({
      last_interaction_at: '2026-08-15T11:55:30.000Z',
    }), SERVER_NOW)).toBe('idle')
  })

  it('hidden fresh session = Idle', () => {
    expect(deriveFounderPresenceStatus(session({
      visibility_state: 'hidden',
    }), SERVER_NOW)).toBe('idle')
  })

  it('manual_lock = Locked', () => {
    expect(deriveFounderPresenceStatus(session({
      ended_reason: 'manual_lock',
      ended_at: '2026-08-15T11:59:30.000Z',
    }), SERVER_NOW)).toBe('locked')
  })

  it('inactivity_timeout = Locked', () => {
    expect(deriveFounderPresenceStatus(session({
      ended_reason: 'inactivity_timeout',
      ended_at: '2026-08-15T11:59:30.000Z',
    }), SERVER_NOW)).toBe('locked')
  })

  it('signout = Offline', () => {
    expect(deriveFounderPresenceStatus(session({
      ended_reason: 'signout',
      ended_at: '2026-08-15T11:59:30.000Z',
    }), SERVER_NOW)).toBe('offline')
  })

  it('stale heartbeat = Offline', () => {
    expect(deriveFounderPresenceStatus(session({
      last_active_at: '2026-08-15T11:54:30.000Z',
    }), SERVER_NOW)).toBe('offline')
  })
})

describe('guardian founder presence summaries', () => {
  it('newer Active session overrides an older Locked session on the same user/device', () => {
    const summaries = buildFounderPresenceSummary([
      session({
        session_id: 'locked-session',
        ended_reason: 'manual_lock',
        ended_at: '2026-08-15T11:40:00.000Z',
        last_active_at: '2026-08-15T11:39:00.000Z',
        last_interaction_at: '2026-08-15T11:38:00.000Z',
      }),
      session({
        session_id: 'active-session',
        started_at: '2026-08-15T11:50:00.000Z',
        last_active_at: '2026-08-15T11:58:00.000Z',
        last_interaction_at: '2026-08-15T11:59:00.000Z',
      }),
    ], ['org-1'], SERVER_NOW)

    expect(summaries['org-1'].status).toBe('active')
  })

  it('account with no new-runtime history gets No Session History state', () => {
    const summaries = buildFounderPresenceSummary([], ['org-1'], SERVER_NOW)
    expect(summaries['org-1']).toMatchObject({
      status: 'no_history',
      hasHistory: false,
      liveDeviceCount: 0,
      liveSessionCount: 0,
    })
  })

  it('two live tabs same device_id = 1 live device / 2 live sessions', () => {
    const summaries = buildFounderPresenceSummary([
      session({ session_id: 'tab-1' }),
      session({ session_id: 'tab-2', last_interaction_at: '2026-08-15T11:58:30.000Z' }),
    ], ['org-1'], SERVER_NOW)

    expect(summaries['org-1']).toMatchObject({
      liveDeviceCount: 1,
      liveSessionCount: 2,
    })
  })

  it('two different device_ids = 2 live devices', () => {
    const summaries = buildFounderPresenceSummary([
      session({ session_id: 'tab-1', device_id: 'device-1' }),
      session({ session_id: 'tab-2', device_id: 'device-2' }),
    ], ['org-1'], SERVER_NOW)

    expect(summaries['org-1'].liveDeviceCount).toBe(2)
  })

  it('Locked and Offline sessions are excluded from live counts', () => {
    const summaries = buildFounderPresenceSummary([
      session({
        session_id: 'locked',
        ended_reason: 'manual_lock',
        ended_at: '2026-08-15T11:57:00.000Z',
      }),
      session({
        session_id: 'offline',
        device_id: 'device-2',
        last_active_at: '2026-08-15T11:54:00.000Z',
      }),
    ], ['org-1'], SERVER_NOW)

    expect(summaries['org-1']).toMatchObject({
      liveDeviceCount: 0,
      liveSessionCount: 0,
    })
  })

  it('missing device_id does not fabricate fingerprinting and counts conservatively', () => {
    const summaries = buildFounderPresenceSummary([
      session({ session_id: 'tab-1', device_id: null }),
      session({ session_id: 'tab-2', device_id: null, last_interaction_at: '2026-08-15T11:58:30.000Z' }),
    ], ['org-1'], SERVER_NOW)

    expect(summaries['org-1']).toMatchObject({
      liveDeviceCount: 1,
      liveSessionCount: 2,
    })
  })
})

describe('guardian founder presence detail shaping', () => {
  it('returns normalized modules only with friendly labels', () => {
    const detail = buildFounderPresenceDetail({
      serverNow: SERVER_NOW,
      sessions: [session({
        session_id: 'session-blueprint',
        module: 'blueprint',
      })],
    })

    expect(detail.sessions[0]).toMatchObject({
      module: 'blueprint',
      moduleLabel: 'Blueprint',
    })
    expect(getFounderModuleLabel('material-takeoff')).toBe('Material Takeoff')
  })
})

describe('guardian founder security alerts + unread state', () => {
  it('known-device session_started = history but not alert', () => {
    const history = buildFounderSecurityHistory([securityEvent()])
    expect(history[0].isAlert).toBe(false)
    expect(isAlertWorthySecurityEvent(securityEvent())).toBe(false)
  })

  it('new-device session_started = alert', () => {
    const event = securityEvent({ is_new_device: true })
    expect(isAlertWorthySecurityEvent(event)).toBe(true)
    const alerts = buildFounderSecurityAlerts([event], { 'org-1': 'Alpha Electric' })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].alertKind).toBe('new_device')
  })

  it('ip_changed = alert', () => {
    const event = securityEvent({
      event_type: 'ip_changed',
      previous_public_ip: '203.0.113.9',
    })
    expect(isAlertWorthySecurityEvent(event)).toBe(true)
    const alerts = buildFounderSecurityAlerts([event], { 'org-1': 'Alpha Electric' })
    expect(alerts[0].alertKind).toBe('ip_changed')
  })

  it('heartbeat cannot create security alert', () => {
    expect(isAlertWorthySecurityEvent({
      event_type: 'heartbeat',
      is_new_device: null,
    })).toBe(false)
  })

  it('unread count includes only alert-worthy events newer than last-seen', () => {
    const alerts = buildFounderSecurityAlerts([
      securityEvent({ is_new_device: true, occurred_at: '2026-08-15T11:56:00.000Z' }),
      securityEvent({ event_type: 'ip_changed', occurred_at: '2026-08-15T11:59:00.000Z', previous_public_ip: '203.0.113.9' }),
      securityEvent({ occurred_at: '2026-08-15T11:58:00.000Z' }),
    ], { 'org-1': 'Alpha Electric' })

    expect(countUnreadGuardianSecurityAlerts(alerts, '2026-08-15T11:57:00.000Z')).toBe(1)
  })

  it('opening Security Alerts advances last-seen state without deleting history', () => {
    const storage = {
      value: null as string | null,
      getItem: vi.fn(function () { return storage.value }),
      setItem: vi.fn(function (_key: string, value: string) { storage.value = value }),
    }

    writeGuardianSecurityLastSeen(storage as any, '2026-08-15T12:00:00.000Z')
    expect(readGuardianSecurityLastSeen(storage as any)).toBe('2026-08-15T12:00:00.000Z')

    const history = buildFounderSecurityHistory([securityEvent({ is_new_device: true })])
    expect(history).toHaveLength(1)
  })
})

describe('guardian founder polling loop', () => {
  it('immediately fetches on mount/open', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    const loop = createGuardianPollingLoop(task, FOUNDER_GUARDIAN_POLL_INTERVAL_MS)
    loop.start()
    await Promise.resolve()
    expect(task).toHaveBeenCalledTimes(1)
    loop.stop()
  })

  it('polls at approximately 90 seconds', async () => {
    vi.useFakeTimers()
    const task = vi.fn().mockResolvedValue(undefined)
    const loop = createGuardianPollingLoop(task, FOUNDER_GUARDIAN_POLL_INTERVAL_MS)
    loop.start()
    await Promise.resolve()
    expect(FOUNDER_GUARDIAN_POLL_INTERVAL_MS).toBe(90_000)
    expect(task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(FOUNDER_GUARDIAN_POLL_INTERVAL_MS)
    expect(task).toHaveBeenCalledTimes(2)
    loop.stop()
    vi.useRealTimers()
  })

  it('polling stops on unmount', async () => {
    vi.useFakeTimers()
    const task = vi.fn().mockResolvedValue(undefined)
    const loop = createGuardianPollingLoop(task, FOUNDER_GUARDIAN_POLL_INTERVAL_MS)
    loop.start()
    await Promise.resolve()
    loop.stop()
    await vi.advanceTimersByTimeAsync(FOUNDER_GUARDIAN_POLL_INTERVAL_MS * 2)
    expect(task).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('duplicate or overlapping polling is prevented', async () => {
    vi.useFakeTimers()
    let release: (() => void) | null = null
    const task = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    const loop = createGuardianPollingLoop(task, FOUNDER_GUARDIAN_POLL_INTERVAL_MS)
    loop.start()
    await Promise.resolve()
    expect(task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(FOUNDER_GUARDIAN_POLL_INTERVAL_MS)
    expect(task).toHaveBeenCalledTimes(1)
    expect(release).not.toBeNull()
    release!()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(FOUNDER_GUARDIAN_POLL_INTERVAL_MS)
    expect(task).toHaveBeenCalledTimes(2)
    loop.stop()
    vi.useRealTimers()
  })
})
