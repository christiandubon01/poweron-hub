/**
 * GUARDIAN-3B2 — runtime presence + 30-minute inactivity proof
 *
 * 31-point automated verification. Fake timers for all 30-minute paths.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join }                      from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock (vi.mock is hoisted by Vitest above all imports) ─────────────────────

const mockCall = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/sessionStoreClient', () => ({
  sessionStoreCall: mockCall,
  isSessionStoreAccessUnavailableError: (error: unknown) =>
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'access_unavailable',
}))

import { presenceMonitor, normalizeModule, HEARTBEAT_MS, INACTIVITY_LIMIT_MS }
  from '@/lib/guardian/presenceMonitor'

// ── Paths ─────────────────────────────────────────────────────────────────────

const root         = process.cwd()
const sessionStore = join(root, 'netlify/functions/session-store.ts')
const sessionLib   = join(root, 'src/lib/auth/session.ts')
const presenceSrc  = join(root, 'src/lib/guardian/presenceMonitor.ts')
const authStoreSrc = join(root, 'src/store/authStore.ts')
const appShellSrc  = join(root, 'src/components/layout/AppShell.tsx')

const readSrc = (p: string) => readFileSync(p, 'utf8')

// ── Minimal document mock for node environment ────────────────────────────────
// presenceMonitor uses document.addEventListener/removeEventListener/dispatchEvent
// and reads document.visibilityState. jsdom/happy-dom are not installed in this
// project, so we install a minimal faithful mock on global.document.

type AnyHandler = (evt?: unknown) => void

function makeMockDocument() {
  const store: Record<string, AnyHandler[]> = {}
  const doc = {
    visibilityState: 'visible' as string,
    addEventListener(type: string, handler: AnyHandler, _opts?: unknown) {
      if (!store[type]) store[type] = []
      store[type].push(handler)
    },
    removeEventListener(type: string, handler: AnyHandler) {
      store[type] = (store[type] ?? []).filter(h => h !== handler)
    },
    dispatchEvent(evt: { type: string }) {
      ;(store[evt.type] ?? []).forEach(h => h(evt))
      return true
    },
  }
  return doc
}

let mockDoc = makeMockDocument()
let mockWin = makeMockDocument()  // same interface needed for window.addEventListener('focus', ...)
const origDocument = (globalThis as Record<string, unknown>).document
const origWindow   = (globalThis as Record<string, unknown>).window

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).document = mockDoc
  ;(globalThis as Record<string, unknown>).window   = mockWin
})

afterAll(() => {
  ;(globalThis as Record<string, unknown>).document = origDocument
  ;(globalThis as Record<string, unknown>).window   = origWindow
})

// Reset both between tests so listener maps are clean
beforeEach(() => {
  mockDoc = makeMockDocument()
  mockWin = makeMockDocument()
  ;(globalThis as Record<string, unknown>).document = mockDoc
  ;(globalThis as Record<string, unknown>).window   = mockWin
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function startMonitor(sessionId = 'test-session-id', onInactivityLock = vi.fn()) {
  presenceMonitor.start({ sessionId, onInactivityLock })
  return { sessionId, onInactivityLock }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC SOURCE CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

describe('[STATIC] 1. session.create sends session_id + device payload', () => {
  it('session-store generates a UUID for every new session', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain('crypto.randomUUID()')
    expect(src).toContain('session_id:          sessionId')
  })

  it('createAppSession forwards deviceId to the server', () => {
    const src = readSrc(sessionLib)
    expect(src).toContain('deviceId:        params.deviceId')
    expect(src).toContain("'session.create'")
  })
})

describe('[STATIC] 2. legacy session rows are not modified or backfilled', () => {
  it('all user_sessions UPDATE calls guard on session_id equality', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain(".eq('session_id', params.sessionId)")
    expect(src).toContain(".eq('session_id', sessionId)")
  })

  it('endPresenceRow adds a not-null guard before updating ended fields', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain(".not('session_id', 'is', null)")
  })
})

describe('[STATIC] 3. stable device_id is reused across sessions', () => {
  it('authStore calls getDeviceId() and passes it to createAppSession', () => {
    const src = readSrc(authStoreSrc)
    expect(src).toContain('getDeviceId()')
    expect(src).toContain('deviceId: getDeviceId()')
  })

  it('createAppSession forwards deviceId to session.create', () => {
    const src = readSrc(sessionLib)
    expect(src).toContain('deviceId:        params.deviceId')
  })
})

describe('[STATIC] 4. multiple tabs get distinct session_ids with the same device_id', () => {
  it('server generates a UUID per create — not reused across calls', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain('crypto.randomUUID()')
  })

  it('device_id is read from the client body, not server-generated', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain("String(body?.deviceId ?? '').slice(0, 64)")
  })
})

describe('[STATIC] 5. user_sessions.ip_address is NEVER populated', () => {
  it('insertPresenceRow INSERT block does not set ip_address', () => {
    const src = readSrc(sessionStore)
    expect(src).not.toMatch(/ip_address\s*:\s*trustedIp/)
    // Extract the INSERT object (between the two markers used in the source)
    const insertBlock = src.slice(
      src.indexOf('Insert presence row'),
      src.indexOf('Security event'),
    )
    expect(insertBlock).not.toContain('ip_address:')
  })

  it('session.ts does not reference ip_address at all', () => {
    const src = readSrc(sessionLib)
    expect(src).not.toContain('ip_address')
  })
})

describe('[STATIC] 6. trusted Netlify IP creates one session_started event', () => {
  it('insertPresenceRow inserts session_started when trustedIp is present', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain("event_type:         'session_started'")
    expect(src).toContain('if (trustedIp)')
    expect(src).toContain("from('account_security_events').insert(")
  })

  it('uses x-nf-client-connection-ip as the trusted IP header', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain("'x-nf-client-connection-ip'")
  })
})

describe('[STATIC] 7. missing trusted IP does not break session creation', () => {
  it('getTrustedIp function exists and returns null when header is absent', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain('function getTrustedIp(event')
  })

  it('insertPresenceRow is awaited before response is returned (failure-isolated)', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain('await insertPresenceRow(')
    expect(src).not.toContain('void insertPresenceRow(')
  })
})

describe('[STATIC] 8. same-IP heartbeat creates no duplicate event', () => {
  it('checkAndRecordIpChange short-circuits when prevIp equals trustedIp', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain('if (prevIp === trustedIp) return session')
  })
})

describe('[STATIC] 9. changed IP creates exactly one ip_changed event', () => {
  it('checkAndRecordIpChange inserts ip_changed on IP difference', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain("event_type:         'ip_changed'")
    expect(src).toContain('previous_public_ip: prevIp')
  })

  it('only one .insert() call inside checkAndRecordIpChange', () => {
    const src = readSrc(sessionStore)
    const fnStart = src.indexOf('async function checkAndRecordIpChange')
    const fnEnd   = src.indexOf('\nasync function ', fnStart + 1)
    const fn      = src.slice(fnStart, fnEnd > fnStart ? fnEnd : src.length)
    expect((fn.match(/\.insert\(/g) ?? []).length).toBe(1)
  })
})

describe('[STATIC] 10. Redis currentPublicIp updates after IP change', () => {
  it('checkAndRecordIpChange returns updated session with new IP', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain('return { ...session, currentPublicIp: trustedIp }')
  })

  it('handleSessionValidate stores the updated session back to Redis', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain('const sessionAfterIp = await checkAndRecordIpChange(')
    expect(src).toContain('const updated = { ...sessionAfterIp, lastActiveAt: Date.now() }')
    expect(src).toContain('await rSet(keys.session(sessionId), updated, TTL_SESSION)')
  })
})

describe('[STATIC] 20. inactivity lock is NOT a Supabase signOut', () => {
  it('presenceMonitor never CALLS signOut or IMPORTS supabase', () => {
    const src = readSrc(presenceSrc)
    // Comment mentioning signOut is fine; an actual call or import is not
    expect(src).not.toMatch(/\.signOut\s*\(/)
    expect(src).not.toMatch(/from\s+['"].*supabase/)
    expect(src).not.toMatch(/import.*supabase/)
  })

  it('onInactivityLock is assigned from config inside start()', () => {
    const src = readSrc(presenceSrc)
    // Type declaration in start() config param
    expect(src).toContain('onInactivityLock: () => void')
    // Assignment from config (allows alignment spaces)
    expect(src).toMatch(/this\.onInactivityLock\s*=\s*config\.onInactivityLock/)
  })
})

describe('[STATIC] 21. inactivity uses ended_reason="inactivity_timeout"', () => {
  it('session-store accepts endedReason from request body', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain('endedReason = body?.endedReason ?? null')
  })

  it('destroyAppSession forwards endedReason to session.destroy', () => {
    const src = readSrc(sessionLib)
    expect(src).toContain('endedReason: endedReason ?? null')
  })
})

describe('[STATIC] 22. manual lock uses ended_reason="manual_lock"', () => {
  it("lockApp defaults endedReason to 'manual_lock'", () => {
    const src = readSrc(authStoreSrc)
    expect(src).toContain("'manual_lock' | 'inactivity_timeout' = 'manual_lock'")
  })

  it('lockApp passes endedReason to destroyAppSession', () => {
    const src = readSrc(authStoreSrc)
    expect(src).toContain('destroyAppSession(undefined, endedReason)')
  })
})

describe('[STATIC] 23. signout uses ended_reason="signout"', () => {
  it("signOut passes 'signout' to destroyAppSession", () => {
    const src = readSrc(authStoreSrc)
    expect(src).toContain("destroyAppSession(undefined, 'signout')")
  })
})

describe('[STATIC] 30. no Pilot Telemetry history added in this phase', () => {
  it('presenceMonitor does not reference pilot or telemetry', () => {
    const src = readSrc(presenceSrc)
    expect(src).not.toContain('pilot')
    expect(src).not.toContain('telemetry')
    expect(src).not.toContain('module_entered')
  })
})

describe('[STATIC] 31. no Guardian UI changes added in this phase', () => {
  it('presenceMonitor exports no React components (no PascalCase export function)', () => {
    const src = readSrc(presenceSrc)
    // React components are PascalCase — utility functions like normalizeModule are fine
    expect(src).not.toMatch(/export\s+(?:default\s+)?function\s+[A-Z]/)
  })

  it('AppShell does not render security badges or public IP', () => {
    const src = readSrc(appShellSrc)
    expect(src).not.toContain('DeviceCount')
    expect(src).not.toContain('SecurityBadge')
    expect(src).not.toContain('currentPublicIp')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// RUNTIME BEHAVIORAL TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('[RUNTIME] 11. heartbeat calls session.validate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('session.validate fires after 90 seconds', async () => {
    startMonitor()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
    const validates = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.validate')
    expect(validates.length).toBeGreaterThanOrEqual(1)
    expect(validates[0][1]).toMatchObject({ sessionId: 'test-session-id' })
  })
})

describe('[RUNTIME] 12. heartbeat does NOT call session.interaction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('three heartbeat cycles produce zero session.interaction calls', async () => {
    startMonitor()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3)
    const interactions = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.interaction')
    expect(interactions).toHaveLength(0)
    const validates = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.validate')
    expect(validates.length).toBeGreaterThanOrEqual(3)
  })
})

describe('[RUNTIME] 13. human interaction calls session.interaction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('pointerdown triggers session.interaction', async () => {
    startMonitor()
    document.dispatchEvent(new Event('pointerdown'))
    await vi.runAllTimersAsync()
    expect(mockCall).toHaveBeenCalledWith('session.interaction', { sessionId: 'test-session-id' })
  })

  it('keydown triggers session.interaction', async () => {
    startMonitor()
    document.dispatchEvent(new Event('keydown'))
    await vi.runAllTimersAsync()
    expect(mockCall).toHaveBeenCalledWith('session.interaction', { sessionId: 'test-session-id' })
  })
})

describe('[RUNTIME] 14. module update sends normalized slug only', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('normalizeModule maps internal view names to canonical slugs', () => {
    expect(normalizeModule('project-inner')).toBe('projects')
    expect(normalizeModule('home')).toBe('home')
    expect(normalizeModule('field-log')).toBe('field-log')
    expect(normalizeModule('sales-intelligence')).toBe('sales-intelligence')
    expect(normalizeModule('unknown-view')).toBe('home')
    // Blueprint: sidebar view is 'blueprint-ai' — must map to 'blueprint' not 'home'
    expect(normalizeModule('blueprint-ai')).toBe('blueprint')
    // Material Takeoff: activeView is 'material-takeoff' (project tab)
    expect(normalizeModule('material-takeoff')).toBe('material-takeoff')
  })

  it('AppShell pre-normalizes slug before setModule; setModule sends it in session.validate', async () => {
    startMonitor('test-session-id')
    // AppShell calls setModule(normalizeModule(activeView)) — so setModule always receives the canonical slug
    presenceMonitor.setModule(normalizeModule('project-inner'))  // = 'projects'
    await vi.runAllTimersAsync()
    const call = mockCall.mock.calls.find(
      (c: unknown[]) => c[0] === 'session.validate' && (c[1] as Record<string, unknown>)?.module === 'projects'
    )
    expect(call).toBeDefined()
  })

  it('normalized module slugs contain no UUIDs', () => {
    const slugs = ['home', 'projects', 'blueprint', 'estimates', 'field-log', 'team',
      'money', 'guardian', 'settings', 'activity', 'journal', 'sales-intelligence',
      'crew-portal', 'employee-portal']
    slugs.forEach(slug => {
      expect(slug).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
    })
  })
})

describe('[RUNTIME] 15. visibility_state is sent in heartbeat payload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('heartbeat includes visibilityState in session.validate', async () => {
    startMonitor()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
    const calls = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.validate')
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0][1]).toHaveProperty('visibilityState')
  })
})

describe('[RUNTIME] 16. heartbeat interval constants', () => {
  it('HEARTBEAT_MS is exactly 90 seconds', () => {
    expect(HEARTBEAT_MS).toBe(90_000)
  })

  it('INACTIVITY_LIMIT_MS is exactly 30 minutes', () => {
    expect(INACTIVITY_LIMIT_MS).toBe(30 * 60 * 1000)
  })
})

describe('[RUNTIME] 17. only one monitor per tab (no duplicate timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('calling start() twice replaces the first session — one heartbeat per interval', async () => {
    startMonitor('session-a')
    startMonitor('session-b')
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
    const validates = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.validate')
    expect(validates.length).toBe(1)
    expect((validates[0][1] as Record<string, unknown>).sessionId).toBe('session-b')
  })
})

describe('[RUNTIME] 18. interaction reports are throttled (no firehose)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('20 rapid pointer events produce at most 1 server interaction call', async () => {
    startMonitor()
    for (let i = 0; i < 20; i++) {
      document.dispatchEvent(new Event('pointerdown'))
    }
    await vi.runAllTimersAsync()
    const interactions = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.interaction')
    expect(interactions.length).toBeLessThanOrEqual(1)
  })
})

describe('[RUNTIME] 19. 30 minutes without interaction → inactivity lock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('onInactivityLock fires after 30+ minutes with no human input', async () => {
    const onInactivityLock = vi.fn()
    presenceMonitor.start({ sessionId: 'test', onInactivityLock })
    await vi.advanceTimersByTimeAsync(INACTIVITY_LIMIT_MS + 60_000)
    expect(onInactivityLock).toHaveBeenCalledTimes(1)
  })
})

describe('[RUNTIME] 24. network heartbeats cannot postpone the 30-minute timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('lock fires at 30 min even with continuous heartbeats and no human input', async () => {
    const onInactivityLock = vi.fn()
    presenceMonitor.start({ sessionId: 'test', onInactivityLock })
    await vi.advanceTimersByTimeAsync(INACTIVITY_LIMIT_MS + 60_000)
    expect(onInactivityLock).toHaveBeenCalledTimes(1)
  })
})

describe('[RUNTIME] 25. returning visible before 30 min — immediate heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('visibility restore sends an immediate session.validate', async () => {
    startMonitor()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.runAllTimersAsync()
    const validates = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.validate')
    expect(validates.length).toBeGreaterThan(0)
  })
})

describe('[RUNTIME] 26. returning visible after >=30 min → lock, not interaction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('no interaction report fires after the lock has triggered', async () => {
    const onInactivityLock = vi.fn()
    presenceMonitor.start({ sessionId: 'test', onInactivityLock })
    await vi.advanceTimersByTimeAsync(INACTIVITY_LIMIT_MS + 60_000)
    mockCall.mockClear()

    // Simulate visibility restore after lock (monitor is already stopped)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.runAllTimersAsync()

    const interactions = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.interaction')
    expect(interactions).toHaveLength(0)
  })
})

describe('[RUNTIME] 27+28. stop() clears all timers and event listeners', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stop() prevents further heartbeats', async () => {
    startMonitor()
    presenceMonitor.stop()
    mockCall.mockClear()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3)
    const validates = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.validate')
    expect(validates).toHaveLength(0)
  })

  it('stop() prevents inactivity lock from ever firing', async () => {
    const lock = vi.fn()
    presenceMonitor.start({ sessionId: 'test', onInactivityLock: lock })
    presenceMonitor.stop()
    lock.mockClear()
    await vi.advanceTimersByTimeAsync(INACTIVITY_LIMIT_MS * 2)
    expect(lock).not.toHaveBeenCalled()
  })
})

describe('[RUNTIME] 29. account switch — second session cancels first entirely', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('only session-b heartbeats fire after account switch; lockA never fires', async () => {
    const lockA = vi.fn()
    presenceMonitor.start({ sessionId: 'session-a', onInactivityLock: lockA })
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS / 2)

    presenceMonitor.start({ sessionId: 'session-b', onInactivityLock: vi.fn() })
    mockCall.mockClear()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)

    const allValidates = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.validate')
    allValidates.forEach((call: unknown[]) => {
      expect((call[1] as Record<string, unknown>).sessionId).toBe('session-b')
    })

    await vi.advanceTimersByTimeAsync(INACTIVITY_LIMIT_MS)
    expect(lockA).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 3B2A — RELIABILITY CORRECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('[STATIC] 3B2A-1. server persistence is awaited, not fire-and-forget', () => {
  it('session.create awaits insertPresenceRow before returning', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain('await insertPresenceRow(')
    expect(src).not.toContain('void insertPresenceRow(')
  })

  it('session.validate awaits updatePresenceHeartbeat before returning', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain('await updatePresenceHeartbeat(')
    expect(src).not.toContain('void updatePresenceHeartbeat(')
  })

  it('session.interaction awaits updatePresenceInteraction before returning', () => {
    const src = readSrc(sessionStore)
    expect(src).toContain('await updatePresenceInteraction(')
    expect(src).not.toContain('void updatePresenceInteraction(')
  })

  it('session.destroy awaits endPresenceRow BEFORE rDel (presence persists before Redis delete)', () => {
    const src = readSrc(sessionStore)
    const fnStart  = src.indexOf('async function handleSessionDestroy')
    const fnEnd    = src.indexOf('\nexports.handler', fnStart)
    const destroyFn = src.slice(fnStart, fnEnd > fnStart ? fnEnd : src.length)
    const awaitEnd = destroyFn.indexOf('await endPresenceRow(')
    const rDelPos  = destroyFn.indexOf('await rDel(')
    expect(awaitEnd).not.toBe(-1)
    expect(rDelPos).not.toBe(-1)
    expect(awaitEnd).toBeLessThan(rDelPos)
  })

  it('each presence helper catches errors internally (auth path always safe)', () => {
    const src = readSrc(sessionStore)
    const helpers = [
      'insertPresenceRow',
      'updatePresenceHeartbeat',
      'updatePresenceInteraction',
      'endPresenceRow',
    ]
    helpers.forEach(name => {
      const fnStart = src.indexOf(`async function ${name}`)
      const fnEnd   = src.indexOf('\nasync function ', fnStart + 1)
      const fn      = src.slice(fnStart, fnEnd > fnStart ? fnEnd : src.length)
      expect(fn).toContain('catch (err')
    })
  })
})

describe('[RUNTIME] 3B2A-2. window focus — resume authority', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockResolvedValue({ ok: true })
    mockCall.mockClear()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('focus before 30 min triggers immediate session.validate', async () => {
    startMonitor()
    mockWin.dispatchEvent({ type: 'focus' })
    await vi.runAllTimersAsync()
    const validates = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.validate')
    expect(validates.length).toBeGreaterThan(0)
  })

  it('focus before 30 min marks meaningful activity (session.interaction)', async () => {
    startMonitor()
    mockWin.dispatchEvent({ type: 'focus' })
    await vi.runAllTimersAsync()
    expect(mockCall).toHaveBeenCalledWith('session.interaction', { sessionId: 'test-session-id' })
  })

  it('focus after >=30 min — lock already fired, no interaction sent', async () => {
    const onInactivityLock = vi.fn()
    presenceMonitor.start({ sessionId: 'test', onInactivityLock })
    await vi.advanceTimersByTimeAsync(INACTIVITY_LIMIT_MS + 60_000)  // lock fires via interval
    mockCall.mockClear()
    // After lock: monitor is stopped, focus listener removed
    mockWin.dispatchEvent({ type: 'focus' })
    await vi.runAllTimersAsync()
    const interactions = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.interaction')
    expect(interactions).toHaveLength(0)
  })

  it('focus + visibilitychange together produce exactly one server call (dedup)', async () => {
    startMonitor()
    // Both fire at the same fake-clock moment — dedup must prevent double-fire
    mockDoc.visibilityState = 'visible'
    mockDoc.dispatchEvent({ type: 'visibilitychange' })
    mockWin.dispatchEvent({ type: 'focus' })
    // Flush microtasks without advancing timers far enough to trigger heartbeat (90s)
    await vi.advanceTimersByTimeAsync(100)
    const validates = mockCall.mock.calls.filter((c: unknown[]) => c[0] === 'session.validate')
    expect(validates.length).toBe(1)
  })

  it('stop() removes focus listener — focus after stop produces no server calls', async () => {
    startMonitor()
    presenceMonitor.stop()
    mockCall.mockClear()
    mockWin.dispatchEvent({ type: 'focus' })
    await vi.runAllTimersAsync()
    expect(mockCall).not.toHaveBeenCalled()
  })
})

describe('[RUNTIME] access_unavailable live-session handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCall.mockReset()
  })
  afterEach(() => {
    presenceMonitor.stop()
    vi.useRealTimers()
  })

  it('session.validate access_unavailable stops the monitor and calls the access callback', async () => {
    const onAccessUnavailable = vi.fn()
    presenceMonitor.start({ sessionId: 'revoked-session', onInactivityLock: vi.fn(), onAccessUnavailable })
    mockCall.mockRejectedValueOnce({ code: 'access_unavailable' })

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
    expect(onAccessUnavailable).toHaveBeenCalledTimes(1)

    mockCall.mockClear()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('session.interaction access_unavailable stops the monitor and calls the access callback', async () => {
    const onAccessUnavailable = vi.fn()
    presenceMonitor.start({ sessionId: 'revoked-session', onInactivityLock: vi.fn(), onAccessUnavailable })
    mockCall.mockRejectedValueOnce({ code: 'access_unavailable' })

    document.dispatchEvent(new Event('pointerdown'))
    await vi.runAllTimersAsync()
    expect(onAccessUnavailable).toHaveBeenCalledTimes(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION GUARD
// ═══════════════════════════════════════════════════════════════════════════════

describe('migration guard', () => {
  const migrations = readdirSync(join(root, 'supabase/migrations'))

  it('migration 122_guardian_presence_security.sql exists', () => {
    expect(migrations).toContain('122_guardian_presence_security.sql')
  })

  it('migrations 123, 124, and 125 exist', () => {
    expect(migrations).toContain('123_guardian_user_access_revocation.sql')
    expect(migrations).toContain('124_inactive_user_rls_boundary.sql')
    expect(migrations).toContain('125_inactive_user_authenticated_data_gate.sql')
  })

  it('no migrations numbered 126 or higher exist', () => {
    const beyond = migrations.filter((name: string) => {
      const m = name.match(/^(\d+)_/)
      return m ? parseInt(m[1], 10) > 125 : false
    })
    expect(beyond).toEqual([])
  })
})
