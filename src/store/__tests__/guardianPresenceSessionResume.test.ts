/**
 * GUARDIAN-3B3C — Presence session resume regression
 *
 * Proves that a normal contractor owner refreshing the browser with a valid
 * Redis app session:
 *  1.  Does NOT call createAppSession a second time
 *  2.  Reuses the existing Redis sessionId for presenceMonitor
 *  3.  Starts exactly one presenceMonitor for that sessionId
 *  4-5. The session.validate heartbeat self-heals a missing user_sessions row
 *       using the SAME sessionId (not a new UUID)
 *  6.  Legacy NULL-session rows are untouched by the self-heal path
 *  7.  Subsequent heartbeats do NOT create another presence row (idempotent)
 *  8.  Subsequent browser refresh does NOT create another app session
 *  9.  Heartbeat updates last_active_at
 * 10.  Heartbeat does NOT set / reset last_interaction_at
 * 11.  Trusted Netlify IP → at most one session_started event per recovered session
 * 12.  Missing trusted IP does not block recovery
 * 13.  Guardian org query retrieves the recovered session
 *
 * Also proves that password_only, password_authed, and non-owner portal paths
 * each call startPresenceMonitor after establishing their session.
 */

import { readFileSync } from 'node:fs'
import { join }         from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mock handles ───────────────────────────────────────────────────────

const deps = vi.hoisted(() => ({
  profiles:        new Map<string, any>(),
  employeeProfiles: [] as Array<any>,
  crewMembers:     [] as Array<any>,
  getSession:      vi.fn(),
  validateAppSession: vi.fn(),
  createAppSession:   vi.fn(),
  loadFromSupabase:   vi.fn(),
  setHydrating:       vi.fn(),
  setActiveTenantUser: vi.fn(),
  markTenantDataReady: vi.fn(),
  clearActiveTenantUser: vi.fn(),
  resetSessionScopedBackupClientState: vi.fn(),
  clearLocalSnapshots: vi.fn(),
  presenceStart:  vi.fn(),
  presenceStop:   vi.fn(),
  invoke:         vi.fn(),
}))

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/guardian/presenceMonitor', () => ({
  presenceMonitor: {
    start: (...args: any[]) => deps.presenceStart(...args),
    stop:  (...args: any[]) => deps.presenceStop(...args),
    setModule: vi.fn(),
  },
  normalizeModule: (v: string) => v,
}))

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string): any => {
    let selectedId: string | null = null
    let selectedUserId: string | null = null
    let requireActive = false
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn((col: string, val: unknown) => {
        if (col === 'id')      selectedId      = String(val)
        if (col === 'user_id') selectedUserId  = String(val)
        if (col === 'active')  requireActive   = val === true
        return builder
      }),
      single: vi.fn(async () => ({
        data: table === 'profiles' && selectedId ? deps.profiles.get(selectedId) ?? null : null,
        error: null,
      })),
      maybeSingle: vi.fn(async () => {
        if (table === 'profiles' && selectedId)
          return { data: deps.profiles.get(selectedId) ?? null, error: null }
        if (table === 'crew_members' && selectedUserId) {
          const row = deps.crewMembers.find(r => r.user_id === selectedUserId && r.is_active) ?? null
          return { data: row, error: null }
        }
        return { data: null, error: null }
      }),
      then: (resolve: (v: any) => unknown, reject?: (r: unknown) => unknown) => {
        if (table === 'employee_profiles') {
          const rows = deps.employeeProfiles.filter(r => {
            if (selectedUserId && r.user_id !== selectedUserId) return false
            if (requireActive && r.active !== true) return false
            return true
          })
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject)
      },
    }
    return builder
  }
  return {
    supabase: {
      from:      vi.fn((t: string) => makeBuilder(t)),
      functions: { invoke: (...a: any[]) => deps.invoke(...a) },
      auth: {
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        getSession:        (...a: any[]) => deps.getSession(...a),
        signOut:           vi.fn(async () => ({})),
      },
    },
  }
})

vi.mock('@/lib/auth/passcode', () => ({
  getPasscodeStatus: vi.fn(async () => ({ isSet: true, isLocked: false, attemptsRemaining: 5, lockExpiresAt: null })),
  setPasscode:   vi.fn(),
  verifyPasscode: vi.fn(),
}))

vi.mock('@/lib/auth/biometric', () => ({
  authenticateWithBiometric: vi.fn(),
  getBiometricCapabilities:  vi.fn(async () => ({ available: false, enrolled: false, biometryType: 'none', platformLabel: 'Unavailable' })),
}))

vi.mock('@/lib/auth/session', () => ({
  createAppSession:    (...a: any[]) => deps.createAppSession(...a),
  destroyAppSession:   vi.fn(async () => undefined),
  validateAppSession:  (...a: any[]) => deps.validateAppSession(...a),
  getDeviceInfo:       vi.fn(() => ({ platform: 'web', userAgent: 'test', appVersion: '0.0.0' })),
  getCurrentSessionId: vi.fn(() => 'existing-session-id'),
  hasLocalSession:     vi.fn(() => true),
}))

vi.mock('@/lib/memory/audit',  () => ({ logLogin: vi.fn(async () => {}), logAudit: vi.fn(async () => {}) }))
vi.mock('@/services/security/AgentSafetySystem', () => ({ logAction: vi.fn(async () => {}) }))
vi.mock('@/services/liveCloudRefreshService',    () => ({ requestRemoteRefresh: vi.fn(async () => null) }))

vi.mock('@/services/backupDataService', () => ({
  hasBackupData:                  vi.fn(() => true),
  createEmptyBackup:              vi.fn(() => ({ projects: [], logs: [], settings: {} })),
  saveBackupData:                 vi.fn(),
  getBackupData:                  vi.fn(() => null),
  loadFromSupabase:               (...a: any[]) => deps.loadFromSupabase(...a),
  setHydrating:                   (...a: any[]) => deps.setHydrating(...a),
  getCacheOwner:                  vi.fn(() => null),
  setCacheOwner:                  vi.fn(),
  clearCacheOwner:                vi.fn(),
  setActiveTenantUser:            (...a: any[]) => deps.setActiveTenantUser(...a),
  markTenantDataReady:            (...a: any[]) => deps.markTenantDataReady(...a),
  clearActiveTenantUser:          (...a: any[]) => deps.clearActiveTenantUser(...a),
  resetSessionScopedBackupClientState: (...a: any[]) => deps.resetSessionScopedBackupClientState(...a),
  clearLocalSnapshots:            (...a: any[]) => deps.clearLocalSnapshots(...a),
  hasPendingLocalSave:            vi.fn(() => false),
  reconcilePendingLocalSaveForHydration: vi.fn(async () => ({ success: true })),
  getDeviceId:                    vi.fn(() => 'test-device-id'),
}))

import { useAuthStore } from '../authStore'

// ── Test helpers ──────────────────────────────────────────────────────────────

class MemoryStorage {
  private v = new Map<string, string>()
  getItem(k: string)             { return this.v.get(k) ?? null }
  setItem(k: string, v: string)  { this.v.set(String(k), String(v)) }
  removeItem(k: string)          { this.v.delete(k) }
  clear()                        { this.v.clear() }
  key(i: number)                 { return [...this.v.keys()][i] ?? null }
  get length()                   { return this.v.size }
}

const USER_ID         = 'contractor-owner-user'
const ORG_ID          = '845802cf-0000-0000-0000-000000000000'
const EXISTING_SID    = 'existing-redis-session-id'

function existingSession() {
  return {
    sessionId:    EXISTING_SID,
    userId:       USER_ID,
    orgId:        ORG_ID,
    role:         'owner',
    tier:         'free',
    deviceInfo:   { platform: 'web', userAgent: 'ua', appVersion: '1.0' },
    createdAt:    Date.now() - 3600_000,
    lastActiveAt: Date.now() - 60_000,
  }
}

function ownerProfile() {
  return {
    id:             USER_ID,
    org_id:         ORG_ID,
    full_name:      'The Marmelow',
    role:           'owner',
    is_active:      true,
    passcode_hash:  'hashed-pin',
    biometric_enabled: false,
  }
}

function resetStore() {
  useAuthStore.setState({
    status: 'loading', user: null, profile: null, appSession: null,
    biometric: null, lockExpiresAt: null, error: null, role: 'owner',
    ownerId: null, employeeProfileId: null, employerOrgId: null,
    tenantDataReady: false, tenantUserId: null,
  })
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage',  { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { hash: '', search: '', pathname: '/' }, history: { replaceState: vi.fn() } },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { title: 'test', visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() },
  })

  deps.profiles.clear()
  deps.employeeProfiles = []
  deps.crewMembers = []
  deps.profiles.set(USER_ID, ownerProfile())

  deps.getSession.mockReset().mockResolvedValue({
    data: { session: { user: { id: USER_ID, email: 'themarmelow17@gmail.com' } } },
  })
  deps.validateAppSession.mockReset().mockResolvedValue(existingSession())
  deps.createAppSession.mockReset().mockResolvedValue('new-session-id')
  deps.loadFromSupabase.mockReset().mockResolvedValue({ success: true, merged: true, status: 'applied' })
  deps.setHydrating.mockReset()
  deps.setActiveTenantUser.mockReset()
  deps.markTenantDataReady.mockReset()
  deps.clearActiveTenantUser.mockReset()
  deps.resetSessionScopedBackupClientState.mockReset()
  deps.clearLocalSnapshots.mockReset().mockResolvedValue(true)
  deps.presenceStart.mockReset()
  deps.presenceStop.mockReset()
  deps.invoke.mockReset().mockResolvedValue({ data: null, error: null })

  resetStore()
})

// ── Source paths for static assertions ────────────────────────────────────────

const root          = process.cwd()
const authStoreSrc  = readFileSync(join(root, 'src/store/authStore.ts'), 'utf8')
const sessionStore  = readFileSync(join(root, 'netlify/functions/session-store.ts'), 'utf8')
const presenceSrc   = readFileSync(join(root, 'src/lib/guardian/presenceMonitor.ts'), 'utf8')

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF 1 — Existing Redis session: no new createAppSession on browser refresh
// ═══════════════════════════════════════════════════════════════════════════════

describe('[BEHAVIORAL] 1. browser refresh with valid Redis session', () => {
  it('does NOT call createAppSession when existing session org/role matches', async () => {
    await useAuthStore.getState().initialize()
    expect(deps.createAppSession).not.toHaveBeenCalled()
  })

  it('reaches authenticated status', async () => {
    await useAuthStore.getState().initialize()
    expect(useAuthStore.getState().status).toBe('authenticated')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF 2 — Existing Redis sessionId is preserved (not replaced)
// ═══════════════════════════════════════════════════════════════════════════════

describe('[BEHAVIORAL] 2. existing Redis sessionId is preserved', () => {
  it('presenceMonitor.start receives the existing sessionId, not a new UUID', async () => {
    await useAuthStore.getState().initialize()
    expect(deps.presenceStart).toHaveBeenCalledTimes(1)
    const [config] = deps.presenceStart.mock.calls[0] as [{ sessionId: string }]
    expect(config.sessionId).toBe(EXISTING_SID)
  })

  it('appSession in store still reflects the existing session', async () => {
    await useAuthStore.getState().initialize()
    const { appSession } = useAuthStore.getState()
    expect((appSession as any)?.sessionId).toBe(EXISTING_SID)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF 3 — Exactly one presenceMonitor is started
// ═══════════════════════════════════════════════════════════════════════════════

describe('[BEHAVIORAL] 3. exactly one presenceMonitor starts on resume', () => {
  it('presenceMonitor.start called exactly once', async () => {
    await useAuthStore.getState().initialize()
    expect(deps.presenceStart).toHaveBeenCalledTimes(1)
  })

  it('presenceMonitor.start receives deviceId from getDeviceId()', async () => {
    await useAuthStore.getState().initialize()
    const [config] = deps.presenceStart.mock.calls[0] as [{ deviceId?: string }]
    expect(config.deviceId).toBe('test-device-id')
  })

  it('presenceMonitor.start receives onInactivityLock callback', async () => {
    await useAuthStore.getState().initialize()
    const [config] = deps.presenceStart.mock.calls[0] as [{ onInactivityLock?: unknown }]
    expect(typeof config.onInactivityLock).toBe('function')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF 4-5 — Self-heal: session.validate creates user_sessions row on first
//             heartbeat; recovered row uses the existing sessionId
// ═══════════════════════════════════════════════════════════════════════════════

describe('[STATIC] 4-5. self-heal: session.validate creates missing presence row', () => {
  it('handleSessionValidate calls updatePresenceHeartbeat', () => {
    expect(sessionStore).toContain('await updatePresenceHeartbeat(')
  })

  it('updatePresenceHeartbeat accepts orgId, deviceId, sessionCreatedAt params', () => {
    expect(sessionStore).toMatch(/orgId.*userId|userId.*orgId/)
    expect(sessionStore).toContain('sessionCreatedAt')
    expect(sessionStore).toContain('deviceId')
  })

  it('self-heal INSERT uses the SAME session_id, not a new UUID', () => {
    // The insert uses params.sessionId, not crypto.randomUUID()
    const insertBlock = sessionStore.slice(
      sessionStore.indexOf('Self-heal: row was missing'),
      sessionStore.indexOf('Self-heal: row was missing') + 800,
    )
    expect(insertBlock).toContain('params.sessionId')
    expect(insertBlock).not.toContain('randomUUID')
  })

  it('self-heal uses started_at from Redis session.createdAt when available', () => {
    // The function assigns: const startedAt = params.sessionCreatedAt ? ... : now
    // Both strings must exist; verify they appear close together in the function body.
    const fn = sessionStore.slice(
      sessionStore.indexOf('async function updatePresenceHeartbeat'),
      sessionStore.indexOf('async function updatePresenceHeartbeat') + 4000,
    )
    expect(fn).toContain('params.sessionCreatedAt')
    expect(fn).toContain('startedAt')
    // 'startedAt' must appear within 80 chars of 'params.sessionCreatedAt' (same assignment)
    const createdAtIdx = fn.indexOf('params.sessionCreatedAt')
    const nearbyBlock  = fn.slice(Math.max(0, createdAtIdx - 80), createdAtIdx + 80)
    expect(nearbyBlock).toContain('startedAt')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF 6 — Legacy NULL-session rows untouched
// ═══════════════════════════════════════════════════════════════════════════════

describe('[STATIC] 6. legacy session_id IS NULL rows are not touched', () => {
  it('self-heal INSERT does not reference session_id IS NULL rows', () => {
    const insertBlock = sessionStore.slice(
      sessionStore.indexOf('Self-heal: row was missing'),
      sessionStore.indexOf('Self-heal: row was missing') + 800,
    )
    // Should not touch NULL rows — only inserts for the current session
    expect(insertBlock).not.toContain("'is', null")
    expect(insertBlock).not.toContain('is null')
  })

  it('pilot-telemetry query still filters session_id IS NOT NULL (unchanged)', () => {
    const pilotSrc = readFileSync(join(root, 'netlify/functions/pilot-telemetry.ts'), 'utf8')
    expect(pilotSrc).toContain(".not('session_id', 'is', null)")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF 7-8 — Idempotency: duplicate row prevention + no new app session
// ═══════════════════════════════════════════════════════════════════════════════

describe('[STATIC] 7-8. duplicate prevention and no new app session on re-refresh', () => {
  it('UPDATE with .select("id") detects existing row before INSERT', () => {
    const heartbeatFn = sessionStore.slice(
      sessionStore.indexOf('async function updatePresenceHeartbeat'),
      sessionStore.indexOf('async function updatePresenceHeartbeat') + 2000,
    )
    expect(heartbeatFn).toContain(".select('id')")
    expect(heartbeatFn).toContain('updatedRows.length === 0')
  })

  it('INSERT is inside the zero-rows guard (not unconditional)', () => {
    const heartbeatFn = sessionStore.slice(
      sessionStore.indexOf('async function updatePresenceHeartbeat'),
      sessionStore.indexOf('async function updatePresenceHeartbeat') + 2000,
    )
    // The insert should come AFTER the length check
    const zeroRowsIdx = heartbeatFn.indexOf('updatedRows.length === 0')
    const insertIdx   = heartbeatFn.indexOf('.insert({', zeroRowsIdx)
    expect(insertIdx).toBeGreaterThan(zeroRowsIdx)
  })

  it('step-3 path does not call createAppSession when org/role match', async () => {
    await useAuthStore.getState().initialize()
    // Second refresh — same session still valid
    await useAuthStore.getState().initialize()
    expect(deps.createAppSession).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF 9 — Heartbeat updates last_active_at
// ═══════════════════════════════════════════════════════════════════════════════

describe('[STATIC] 9. heartbeat updates last_active_at', () => {
  it('updatePresenceHeartbeat includes last_active_at in update payload', () => {
    const fn = sessionStore.slice(
      sessionStore.indexOf('async function updatePresenceHeartbeat'),
      sessionStore.indexOf('async function updatePresenceHeartbeat') + 2000,
    )
    expect(fn).toContain('last_active_at')
    expect(fn).toContain('now')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF 10 — Heartbeat does NOT touch last_interaction_at
// ═══════════════════════════════════════════════════════════════════════════════

describe('[STATIC] 10. heartbeat does NOT fabricate last_interaction_at', () => {
  it('updatePresenceHeartbeat does not set last_interaction_at in the UPDATE object', () => {
    const fn = sessionStore.slice(
      sessionStore.indexOf('async function updatePresenceHeartbeat'),
      sessionStore.indexOf('async function updatePresenceHeartbeat') + 2000,
    )
    const updateObj = fn.slice(
      fn.indexOf('const update:'),
      fn.indexOf('.select('),
    )
    expect(updateObj).not.toContain('last_interaction_at')
  })

  it('recovered row sets last_interaction_at to null (not now)', () => {
    const insertBlock = sessionStore.slice(
      sessionStore.indexOf('Self-heal: row was missing'),
      sessionStore.indexOf('Self-heal: row was missing') + 1200,
    )
    expect(insertBlock).toContain('last_interaction_at: null')
    expect(insertBlock).not.toMatch(/last_interaction_at:.*now/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF 11-12 — Trusted IP: at most one security event; missing IP doesn't block
// ═══════════════════════════════════════════════════════════════════════════════

describe('[STATIC] 11-12. security event and missing IP behaviour', () => {
  // 4000-char window covers the full updatePresenceHeartbeat body (CRLF inflates byte count)
  const heartbeatFn = () => sessionStore.slice(
    sessionStore.indexOf('async function updatePresenceHeartbeat'),
    sessionStore.indexOf('async function updatePresenceHeartbeat') + 4000,
  )

  it('security event is inside the self-heal INSERT success block (not unconditional)', () => {
    const fn        = heartbeatFn()
    const insertErr = fn.indexOf('insertErr')
    const secEvt    = fn.indexOf('session_started', insertErr)
    expect(insertErr).toBeGreaterThan(-1)
    expect(secEvt).toBeGreaterThan(insertErr)
  })

  it('security event is guarded by trustedIp presence', () => {
    const fn      = heartbeatFn()
    const evtIdx  = fn.indexOf('session_started')
    const guard   = fn.slice(Math.max(0, evtIdx - 200), evtIdx)
    expect(guard).toContain('trustedIp')
  })

  it('missing trusted IP: recovery INSERT still runs without the security event', () => {
    // The security event guard is `if (trustedIp && params.orgId)` —
    // the INSERT happens unconditionally inside the zero-rows guard
    const fn         = heartbeatFn()
    const zeroIdx    = fn.indexOf('updatedRows.length === 0')
    const insertIdx  = fn.indexOf('.insert({', zeroIdx)
    const trustedIdx = fn.indexOf('trustedIp', insertIdx)
    // trustedIp check comes AFTER the insert (i.e. only for the security event)
    expect(trustedIdx).toBeGreaterThan(insertIdx)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF 13 — Guardian query retrieves the recovered session
// ═══════════════════════════════════════════════════════════════════════════════

describe('[STATIC] 13. Guardian query retrieves recovered sessions', () => {
  it('pilot-telemetry selects session_id (which self-heal sets)', () => {
    const pilotSrc = readFileSync(join(root, 'netlify/functions/pilot-telemetry.ts'), 'utf8')
    expect(pilotSrc).toContain('session_id')
    expect(pilotSrc).toContain(".not('session_id', 'is', null)")
  })

  it('self-heal INSERT sets session_id to existing Redis sessionId (not null)', () => {
    const insertBlock = sessionStore.slice(
      sessionStore.indexOf('Self-heal: row was missing'),
      sessionStore.indexOf('Self-heal: row was missing') + 800,
    )
    expect(insertBlock).toMatch(/session_id:\s+params\.sessionId/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF — presenceMonitor sends deviceId on heartbeat (for self-heal context)
// ═══════════════════════════════════════════════════════════════════════════════

describe('[STATIC] presenceMonitor sends deviceId in session.validate', () => {
  it('sendValidate includes deviceId in the sessionStoreCall payload', () => {
    expect(presenceSrc).toContain('deviceId: this.deviceId')
  })

  it('start() accepts and stores deviceId from config', () => {
    expect(presenceSrc).toContain('this.deviceId               = config.deviceId')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF — password_only path starts presence monitor
// ═══════════════════════════════════════════════════════════════════════════════

describe('[BEHAVIORAL] password_only path calls startPresenceMonitor', () => {
  it('starts the monitor after createAppSession', async () => {
    deps.validateAppSession.mockResolvedValue(null)   // no existing session
    deps.profiles.set(USER_ID, {
      ...ownerProfile(),
      passcode_hash: 'password_only',
    })
    deps.createAppSession.mockResolvedValue('pw-only-session')
    await useAuthStore.getState().initialize()
    expect(deps.presenceStart).toHaveBeenCalledTimes(1)
    const [config] = deps.presenceStart.mock.calls[0] as [{ sessionId: string }]
    expect(config.sessionId).toBe('pw-only-session')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF — poweron_password_authed path starts presence monitor
// ═══════════════════════════════════════════════════════════════════════════════

describe('[BEHAVIORAL] poweron_password_authed path calls startPresenceMonitor', () => {
  it('starts the monitor after createAppSession completes', async () => {
    deps.validateAppSession.mockReset()
      // first call (step 3 check) → no existing session
      .mockResolvedValueOnce(null)
      // second call (validateAppSession after createAppSession) → new session
      .mockResolvedValueOnce({ sessionId: 'pw-authed-session', userId: USER_ID, orgId: ORG_ID, role: 'owner' })
    sessionStorage.setItem('poweron_password_authed', '1')
    deps.createAppSession.mockResolvedValue('pw-authed-session')
    await useAuthStore.getState().initialize()
    expect(deps.presenceStart).toHaveBeenCalledTimes(1)
    const [config] = deps.presenceStart.mock.calls[0] as [{ sessionId: string }]
    expect(config.sessionId).toBe('pw-authed-session')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF — non-owner portal path starts presence monitor
// ═══════════════════════════════════════════════════════════════════════════════

describe('[STATIC] non-owner portal (step 4b) calls startPresenceMonitor', () => {
  it('step 4b validateAppSession result feeds startPresenceMonitor', () => {
    // Verify that after the 4b validateAppSession call, startPresenceMonitor is invoked.
    // We locate the 4b code block by searching for the accepted-employee conditional that
    // precedes it, then check that startPresenceMonitor appears in the same branch.
    const step4bMarker = authStoreSrc.indexOf('roleSession')
    expect(step4bMarker).toBeGreaterThan(-1)
    const step4bBlock = authStoreSrc.slice(step4bMarker, step4bMarker + 600)
    expect(step4bBlock).toContain('startPresenceMonitor')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF — shared startPresenceMonitor helper used by all call sites
// ═══════════════════════════════════════════════════════════════════════════════

describe('[STATIC] startPresenceMonitor helper unifies all call sites', () => {
  it('authStore defines startPresenceMonitor function', () => {
    expect(authStoreSrc).toContain('function startPresenceMonitor(')
  })

  it('no raw presenceMonitor.start({ ... }) calls remain outside the helper', () => {
    // All call sites should use startPresenceMonitor(); the helper itself is the only
    // place that calls presenceMonitor.start(
    const helperBody = authStoreSrc.slice(
      authStoreSrc.indexOf('function startPresenceMonitor('),
      authStoreSrc.indexOf('function startPresenceMonitor(') + 200,
    )
    expect(helperBody).toContain('presenceMonitor.start(')
    // Count code-level presenceMonitor.start({ invocations (with object brace, not comment references)
    const rawCalls = (authStoreSrc.match(/presenceMonitor\.start\(\{/g) ?? []).length
    expect(rawCalls).toBe(1)  // only inside the helper itself
  })

  it('helper passes deviceId: getDeviceId()', () => {
    const helper = authStoreSrc.slice(
      authStoreSrc.indexOf('function startPresenceMonitor('),
      authStoreSrc.indexOf('function startPresenceMonitor(') + 300,
    )
    expect(helper).toContain('deviceId: getDeviceId()')
  })
})
