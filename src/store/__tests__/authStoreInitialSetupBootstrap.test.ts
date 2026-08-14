/**
 * COMM-PROD-1 Step 9 — new external contractor bootstrap contracts.
 *
 * Production smoke of Contractor #1 found that first-run setup finished by
 * writing status: 'authenticated' straight into the store. That skipped app
 * session creation, portal role resolution and tenant bootstrap, so:
 *   - the backup service had no active tenant and the shell fell through to the
 *     "No backup data loaded / Import Backup" recovery screen (defect B), and
 *   - no resumable session existed, so the next reload re-derived setup state
 *     from profiles.passcode_hash (defect C).
 *
 * These tests pin the corrected contract: setup completes through the auth store,
 * the authenticated organization is the only tenant ever activated, and a reload
 * with a stored passcode resolves "PIN configured", not PIN setup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markPasswordRecoveryRequest } from '@/lib/auth/passwordRecovery'

const deps = vi.hoisted(() => ({
  hydrationResult: { success: true, merged: false, status: 'no_remote' } as any,
  hasBackup: false,
  authStateChangeHandler: null as null | ((event: string, session: any) => unknown | Promise<unknown>),
  loadFromSupabase: vi.fn(),
  createAppSession: vi.fn(),
  validateAppSession: vi.fn(),
  destroyAppSession: vi.fn(),
  authSignOut: vi.fn(),
  signInWithPassword: vi.fn(),
  setActiveTenantUser: vi.fn(),
  markTenantDataReady: vi.fn(),
  clearActiveTenantUser: vi.fn(),
  clearLocalSnapshots: vi.fn(),
  saveBackupData: vi.fn(),
  hasBackupData: vi.fn(),
  createEmptyBackup: vi.fn(),
  setHydrating: vi.fn(),
  getSession: vi.fn(),
  getPasscodeStatus: vi.fn(),
  resetSessionScopedBackupClientState: vi.fn(),
  rpc: vi.fn(),
  profiles: new Map<string, any>(),
  statusSequence: [] as string[],
}))

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string): any => {
    let selectedId: string | null = null
    const builder: any = {
      select: vi.fn(() => builder),
      update: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        if (column === 'id' || column === 'user_id') selectedId = String(value)
        return builder
      }),
      single: vi.fn(async () => ({
        data: table === 'profiles' && selectedId ? deps.profiles.get(selectedId) ?? null : null,
        error: null,
      })),
      maybeSingle: vi.fn(async () => ({
        data: table === 'profiles' && selectedId ? deps.profiles.get(selectedId) ?? null : null,
        error: null,
      })),
      then: (resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(table === 'employee_profiles'
          ? { data: [], error: null }
          : { data: null, error: null }).then(resolve, reject),
    }
    return builder
  }
  return {
    supabase: {
      from: vi.fn((table: string) => makeBuilder(table)),
      rpc: (...args: any[]) => deps.rpc(...args),
      auth: {
        onAuthStateChange: vi.fn((callback: (event: string, session: any) => unknown) => {
          deps.authStateChangeHandler = callback
          return { data: { subscription: { unsubscribe: vi.fn() } } }
        }),
        getSession: (...args: any[]) => deps.getSession(...args),
        signInWithPassword: (...args: any[]) => deps.signInWithPassword(...args),
        signOut: (...args: any[]) => deps.authSignOut(...args),
      },
    },
  }
})

vi.mock('@/lib/auth/passcode', () => ({
  getPasscodeStatus: (...args: any[]) => deps.getPasscodeStatus(...args),
  setPasscode: vi.fn(),
  verifyPasscode: vi.fn(),
}))

vi.mock('@/lib/auth/biometric', () => ({
  authenticateWithBiometric: vi.fn(),
  getBiometricCapabilities: vi.fn(async () => ({
    available: false, enrolled: false, biometryType: 'none', platformLabel: 'Unavailable',
  })),
}))

vi.mock('@/lib/auth/session', () => ({
  createAppSession: (...args: any[]) => deps.createAppSession(...args),
  destroyAppSession: (...args: any[]) => deps.destroyAppSession(...args),
  validateAppSession: (...args: any[]) => deps.validateAppSession(...args),
  getDeviceInfo: vi.fn(() => 'test-device'),
}))

vi.mock('@/lib/memory/audit', () => ({
  logLogin: vi.fn(async () => {}),
  logAudit: vi.fn(async () => {}),
}))

vi.mock('@/services/security/AgentSafetySystem', () => ({ logAction: vi.fn(async () => {}) }))

vi.mock('@/services/backupDataService', () => ({
  hasBackupData: (...args: any[]) => deps.hasBackupData(...args),
  createEmptyBackup: (...args: any[]) => deps.createEmptyBackup(...args),
  saveBackupData: (...args: any[]) => deps.saveBackupData(...args),
  getBackupData: vi.fn(() => null),
  loadFromSupabase: (...args: any[]) => deps.loadFromSupabase(...args),
  setHydrating: (...args: any[]) => deps.setHydrating(...args),
  getCacheOwner: vi.fn(() => null),
  setCacheOwner: vi.fn(),
  clearCacheOwner: vi.fn(),
  setActiveTenantUser: (...args: any[]) => deps.setActiveTenantUser(...args),
  markTenantDataReady: (...args: any[]) => deps.markTenantDataReady(...args),
  clearActiveTenantUser: (...args: any[]) => deps.clearActiveTenantUser(...args),
  resetSessionScopedBackupClientState: (...args: any[]) => deps.resetSessionScopedBackupClientState(...args),
  clearLocalSnapshots: (...args: any[]) => deps.clearLocalSnapshots(...args),
  hasPendingLocalSave: vi.fn(() => false),
  reconcilePendingLocalSaveForHydration: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/services/liveCloudRefreshService', () => ({
  requestRemoteRefresh: vi.fn(async () => null),
}))

import { useAuthStore } from '../authStore'

class MemoryStorage {
  private values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(String(key), String(value)) }
}

const CONTRACTOR = 'contractor-1'
const CUSTOMER_ZERO = 'customer-zero-owner'
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

async function emitAuthEvent(event: string, session: any): Promise<void> {
  if (!deps.authStateChangeHandler) throw new Error('Auth state listener was not registered')
  await deps.authStateChangeHandler(event, session)
}

async function ensureAuthListenerRegistered(): Promise<void> {
  if (deps.authStateChangeHandler) return
  await useAuthStore.getState().initialize()
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { hash: '', search: '', pathname: '/' }, history: { replaceState: vi.fn() } },
  })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { title: 'Auth test' } })

  deps.hydrationResult = { success: true, merged: false, status: 'no_remote' }
  deps.hasBackup = false
  deps.loadFromSupabase.mockReset().mockImplementation(async () => deps.hydrationResult)
  deps.createAppSession.mockReset().mockResolvedValue('session-new')
  deps.validateAppSession.mockReset().mockImplementation(async () => ({
    sessionId: 'session-new', userId: CONTRACTOR, orgId: 'contractor-org', role: 'owner',
  }))
  deps.destroyAppSession.mockReset().mockResolvedValue(undefined)
  deps.authSignOut.mockReset().mockImplementation(async () => {
    if (deps.authStateChangeHandler) await emitAuthEvent('SIGNED_OUT', null)
    return {}
  })
  deps.signInWithPassword.mockReset().mockImplementation(async ({ email }: { email: string }) => {
    const userId = email === 'customer@example.test' ? CUSTOMER_ZERO : CONTRACTOR
    const session = { user: { id: userId, email } }
    deps.getSession.mockResolvedValue({ data: { session } })
    if (deps.authStateChangeHandler) await emitAuthEvent('SIGNED_IN', session)
    return { data: { session }, error: null }
  })
  deps.setActiveTenantUser.mockReset()
  deps.markTenantDataReady.mockReset()
  deps.clearActiveTenantUser.mockReset()
  deps.clearLocalSnapshots.mockReset().mockResolvedValue(true)
  deps.saveBackupData.mockReset()
  deps.hasBackupData.mockReset().mockImplementation(() => deps.hasBackup)
  deps.createEmptyBackup.mockReset().mockImplementation(() => ({
    projects: [], logs: [], settings: {},
  }))
  deps.setHydrating.mockReset()
  deps.getSession.mockReset().mockResolvedValue({ data: { session: null } })
  deps.getPasscodeStatus.mockReset().mockResolvedValue({
    isSet: true, isLocked: false, attemptsRemaining: 5, lockExpiresAt: null,
  })
  deps.resetSessionScopedBackupClientState.mockReset()
  deps.rpc.mockReset().mockReturnValue({ then: (r: any) => Promise.resolve({}).then(r), catch: () => {} })

  deps.profiles.clear()
  deps.profiles.set(CONTRACTOR, {
    id: CONTRACTOR, org_id: 'contractor-org', role: 'owner', is_active: true,
    full_name: 'Contractor One', passcode_hash: 'pbkdf2:100000:aa:bb', biometric_enabled: false,
  })
  deps.profiles.set(CUSTOMER_ZERO, {
    id: CUSTOMER_ZERO, org_id: 'power-on-org', role: 'owner', is_active: true,
    full_name: 'Power On Owner', passcode_hash: 'pbkdf2:100000:cc:dd', biometric_enabled: false,
  })

  deps.statusSequence.length = 0
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  useAuthStore.setState({
    status: 'needs_passcode_setup',
    user: { id: CONTRACTOR, email: 'contractor@example.test' } as any,
    profile: null,
    appSession: null,
    biometric: null,
    lockExpiresAt: null,
    error: null,
    role: 'owner',
    ownerId: null,
    employeeProfileId: null,
    employerOrgId: null,
    tenantDataReady: false,
    tenantUserId: null,
  })
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

function trackStatus(): () => void {
  deps.statusSequence.push(useAuthStore.getState().status)
  return useAuthStore.subscribe((state) => {
    const last = deps.statusSequence[deps.statusSequence.length - 1]
    if (state.status !== last) deps.statusSequence.push(state.status)
  })
}

function sessionFor(userId: string, email = `${userId}@example.test`) {
  return { user: { id: userId, email } }
}

async function initializePasswordAuthenticatedUser(userId: string): Promise<void> {
  sessionStorage.setItem('poweron_password_authed', '1')
  deps.getSession.mockResolvedValue({ data: { session: sessionFor(userId) } })
  deps.validateAppSession.mockResolvedValue(null)
  await useAuthStore.getState().initialize()
}

async function signInAfterSwitch(email: string): Promise<void> {
  await ensureAuthListenerRegistered()
  await useAuthStore.getState().signInWithEmail(email, 'correct-horse-battery-staple')
  await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'))
}

describe('COMM-PROD-1 A — new contractor bootstrap', () => {
  it('hydrates the authenticated organization before the shell is allowed to render', async () => {
    const unsubscribe = trackStatus()

    await useAuthStore.getState().completeInitialSetup()
    unsubscribe()

    // The workspace read must happen for this org, and only after it succeeds
    // may status become authenticated.
    expect(deps.loadFromSupabase).toHaveBeenCalledTimes(1)
    expect(deps.loadFromSupabase.mock.calls[0][0]).toBe(CONTRACTOR)
    expect(deps.setActiveTenantUser).toHaveBeenCalledWith(CONTRACTOR)
    expect(deps.markTenantDataReady).toHaveBeenCalledWith(CONTRACTOR)
    expect(deps.statusSequence).toEqual(['needs_passcode_setup', 'hydrating_user_data', 'authenticated'])

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      tenantDataReady: true,
      tenantUserId: CONTRACTOR,
      role: 'owner',
    })
  })

  it('gives a brand-new organization the canonical empty workspace instead of the Import Backup screen', async () => {
    deps.hasBackup = false

    await useAuthStore.getState().completeInitialSetup()

    // Canonical empty constructor — not a second competing default model, and
    // not another organization's data.
    expect(deps.createEmptyBackup).toHaveBeenCalled()
    expect(deps.saveBackupData).toHaveBeenCalledTimes(1)
    const [seeded, seededUserId] = deps.saveBackupData.mock.calls[0]
    expect(seededUserId).toBe(CONTRACTOR)
    expect(seeded.projects).toEqual([])
    expect(seeded.logs).toEqual([])
    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('creates a resumable app session so the next load does not restart setup', async () => {
    await useAuthStore.getState().completeInitialSetup()

    expect(deps.createAppSession).toHaveBeenCalledTimes(1)
    expect(deps.createAppSession.mock.calls[0][0]).toMatchObject({
      userId: CONTRACTOR,
      orgId: 'contractor-org',
    })
    expect(useAuthStore.getState().appSession).toMatchObject({ sessionId: 'session-new' })
  })

  it('re-reads the profile so the store carries the server-confirmed passcode state', async () => {
    await useAuthStore.getState().completeInitialSetup()

    expect(useAuthStore.getState().profile).toMatchObject({
      id: CONTRACTOR,
      org_id: 'contractor-org',
      passcode_hash: 'pbkdf2:100000:aa:bb',
    })
  })

  it('never lands on a half-authenticated shell when workspace hydration fails', async () => {
    deps.hydrationResult = { success: false, merged: false, status: 'failed', error: 'network unavailable' }

    await useAuthStore.getState().completeInitialSetup()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'needs_passcode',
      tenantDataReady: false,
      tenantUserId: null,
      appSession: null,
    })
    expect(deps.clearActiveTenantUser).toHaveBeenCalled()
  })
})

describe('COMM-PROD-1 A — password login (logout → login journey)', () => {
  it('does not publish authenticated before the tenant workspace is active', async () => {
    sessionStorage.setItem('poweron_password_authed', '1')
    deps.getSession.mockResolvedValue({ data: { session: { user: { id: CONTRACTOR } } } })
    deps.validateAppSession.mockResolvedValue(null)

    let releaseHydration!: () => void
    deps.loadFromSupabase.mockImplementation(() => new Promise(resolve => {
      releaseHydration = () => resolve(deps.hydrationResult)
    }))

    const run = useAuthStore.getState().initialize()
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('hydrating_user_data'))
    expect(useAuthStore.getState().status).not.toBe('authenticated')

    releaseHydration()
    await run

    expect(deps.setActiveTenantUser).toHaveBeenCalledWith(CONTRACTOR)
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated', tenantDataReady: true, tenantUserId: CONTRACTOR,
    })
  })

  it('keeps the shell closed when password-login hydration fails', async () => {
    sessionStorage.setItem('poweron_password_authed', '1')
    deps.getSession.mockResolvedValue({ data: { session: { user: { id: CONTRACTOR } } } })
    deps.validateAppSession.mockResolvedValue(null)
    deps.hydrationResult = { success: false, merged: false, status: 'failed', error: 'offline' }

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'hydrating_user_data',
      tenantDataReady: false,
      tenantUserId: null,
      error: 'Workspace data could not be loaded. Check your connection and retry.',
    })
  })

  it('emits the exact boundary diagnostic before storing the generic workspace error', async () => {
    sessionStorage.setItem('poweron_password_authed', '1')
    deps.getSession.mockResolvedValue({ data: { session: { user: { id: CONTRACTOR } } } })
    deps.validateAppSession.mockResolvedValue(null)
    deps.hydrationResult = { success: false, merged: false, status: 'failed', error: 'offline' }

    let boundaryLoggedBeforeUiError = false
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.error === 'Workspace data could not be loaded. Check your connection and retry.') {
        boundaryLoggedBeforeUiError = consoleErrorSpy.mock.calls.some((call) =>
          call[0] === '[AUTH-WORKSPACE-BOOTSTRAP-FAIL]'
          && (call[1] as any)?.message === 'offline')
      }
    })

    await useAuthStore.getState().initialize()
    unsubscribe()

    expect(boundaryLoggedBeforeUiError).toBe(true)
    expect(consoleErrorSpy.mock.calls).toEqual(expect.arrayContaining([[
      '[AUTH-WORKSPACE-BOOTSTRAP-FAIL]',
      expect.objectContaining({
        stage: 'loadFromSupabase',
        errorName: 'AuthHydrationFailureError',
        code: null,
        message: 'offline',
        userId: CONTRACTOR,
        profileId: CONTRACTOR,
        organizationId: expect.stringContaining('contract'),
        initSequenceId: expect.any(Number),
        authOperationGeneration: expect.any(Number),
        currentStatus: 'hydrating_user_data',
      }),
    ]]))
  })

  it('logs the workspace failure stage and retries against the current authenticated user only', async () => {
    sessionStorage.setItem('poweron_password_authed', '1')
    deps.getSession.mockResolvedValueOnce({ data: { session: { user: { id: CONTRACTOR } } } })
    deps.validateAppSession.mockResolvedValue(null)
    deps.hydrationResult = { success: false, merged: false, status: 'failed', error: 'offline' }

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'hydrating_user_data',
      tenantDataReady: false,
      tenantUserId: null,
      error: 'Workspace data could not be loaded. Check your connection and retry.',
    })
    expect(sessionStorage.getItem('poweron_password_authed')).toBe('1')
    expect(consoleErrorSpy.mock.calls).toEqual(expect.arrayContaining([[
      '[AUTH-HYDRATION-FAIL]',
      expect.objectContaining({
        stage: 'loadFromSupabase',
        userId: CONTRACTOR,
        message: 'offline',
        initSequenceId: expect.any(Number),
      }),
    ]]))

    deps.hydrationResult = { success: true, merged: false, status: 'no_remote' }
    deps.getSession.mockResolvedValueOnce({ data: { session: { user: { id: CUSTOMER_ZERO } } } })

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: CUSTOMER_ZERO },
      profile: { id: CUSTOMER_ZERO, org_id: 'power-on-org' },
      tenantDataReady: true,
      tenantUserId: CUSTOMER_ZERO,
      error: null,
    })
    expect(deps.loadFromSupabase.mock.calls.map((call) => call[0])).toEqual([CONTRACTOR, CUSTOMER_ZERO])
    expect(deps.setActiveTenantUser.mock.calls[deps.setActiveTenantUser.mock.calls.length - 1]?.[0]).toBe(CUSTOMER_ZERO)
  })

  it('clears session-scoped auth artifacts before Account B bootstraps after Account A logout', async () => {
    sessionStorage.setItem('poweron_password_authed', '1')
    deps.getSession.mockResolvedValueOnce({ data: { session: { user: { id: CONTRACTOR } } } })
    deps.validateAppSession.mockResolvedValue(null)

    await useAuthStore.getState().initialize()

    localStorage.setItem('poweron-hub-role:main', 'owner')
    localStorage.setItem('poweron-hub-owner-id:main', CONTRACTOR)
    localStorage.setItem('poweron-hub-role:employee', 'employee')
    sessionStorage.setItem('poweron-hub-portal-context', 'employee')

    await useAuthStore.getState().signOut()

    expect(deps.resetSessionScopedBackupClientState).toHaveBeenCalled()
    expect(localStorage.getItem('poweron-hub-role:main')).toBeNull()
    expect(localStorage.getItem('poweron-hub-owner-id:main')).toBeNull()
    expect(localStorage.getItem('poweron-hub-role:employee')).toBeNull()
    expect(sessionStorage.getItem('poweron-hub-portal-context')).toBeNull()
    expect(sessionStorage.getItem('poweron_password_authed')).toBeNull()
    expect(useAuthStore.getState()).toMatchObject({
      status: 'unauthenticated',
      user: null,
      profile: null,
      tenantDataReady: false,
      tenantUserId: null,
    })

    sessionStorage.setItem('poweron_password_authed', '1')
    deps.getSession.mockResolvedValueOnce({ data: { session: { user: { id: CUSTOMER_ZERO } } } })

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: CUSTOMER_ZERO },
      profile: { id: CUSTOMER_ZERO, org_id: 'power-on-org' },
      tenantDataReady: true,
      tenantUserId: CUSTOMER_ZERO,
      error: null,
    })
    expect(deps.loadFromSupabase.mock.calls.map((call) => call[0])).toEqual([CONTRACTOR, CUSTOMER_ZERO])
  })

  it('allows Account B to log out and Account A to load its own workspace again', async () => {
    sessionStorage.setItem('poweron_password_authed', '1')
    deps.getSession.mockResolvedValueOnce({ data: { session: { user: { id: CUSTOMER_ZERO } } } })
    deps.validateAppSession.mockResolvedValue(null)

    await useAuthStore.getState().initialize()
    await useAuthStore.getState().signOut()

    sessionStorage.setItem('poweron_password_authed', '1')
    deps.getSession.mockResolvedValueOnce({ data: { session: { user: { id: CONTRACTOR } } } })

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: CONTRACTOR },
      profile: { id: CONTRACTOR, org_id: 'contractor-org' },
      tenantDataReady: true,
      tenantUserId: CONTRACTOR,
      error: null,
    })
    expect(deps.loadFromSupabase.mock.calls.map((call) => call[0])).toEqual([CUSTOMER_ZERO, CONTRACTOR])
    expect(deps.resetSessionScopedBackupClientState).toHaveBeenCalled()
  })

  it('loads Account B on the first post-logout password login through the SIGNED_IN bootstrap path', async () => {
    await initializePasswordAuthenticatedUser(CONTRACTOR)
    await useAuthStore.getState().signOut()

    deps.loadFromSupabase.mockClear()
    deps.validateAppSession.mockResolvedValue(null)
    await signInAfterSwitch('customer@example.test')

    expect(deps.loadFromSupabase.mock.calls.map((call) => call[0])).toEqual([CUSTOMER_ZERO])
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: CUSTOMER_ZERO },
      profile: { id: CUSTOMER_ZERO, org_id: 'power-on-org' },
      tenantDataReady: true,
      tenantUserId: CUSTOMER_ZERO,
      error: null,
    })
    expect(sessionStorage.getItem('poweron_password_authed')).toBeNull()
  })

  it('starts exactly one workspace bootstrap for one post-logout Account B password login', async () => {
    await initializePasswordAuthenticatedUser(CONTRACTOR)
    await useAuthStore.getState().signOut()

    deps.loadFromSupabase.mockClear()
    deps.validateAppSession.mockResolvedValue(null)
    await signInAfterSwitch('customer@example.test')

    expect(deps.loadFromSupabase).toHaveBeenCalledTimes(1)
    expect(deps.loadFromSupabase.mock.calls[0][0]).toBe(CUSTOMER_ZERO)
  })

  it('keeps the same first-login success when switching from Account B back to Account A', async () => {
    await initializePasswordAuthenticatedUser(CUSTOMER_ZERO)
    await useAuthStore.getState().signOut()

    deps.validateAppSession.mockResolvedValue(null)
    await signInAfterSwitch('contractor@example.test')

    expect(deps.loadFromSupabase.mock.calls.map((call) => call[0])).toEqual([CUSTOMER_ZERO, CONTRACTOR])
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: CONTRACTOR },
      profile: { id: CONTRACTOR, org_id: 'contractor-org' },
      tenantDataReady: true,
      tenantUserId: CONTRACTOR,
      error: null,
    })
  })

  it('ignores a delayed Account A bootstrap success after Account B becomes current', async () => {
    let releaseAccountA!: () => void
    deps.getSession.mockResolvedValue({ data: { session: sessionFor(CONTRACTOR) } })
    deps.validateAppSession.mockResolvedValue(null)
    sessionStorage.setItem('poweron_password_authed', '1')
    deps.loadFromSupabase.mockImplementationOnce(() => new Promise(resolve => {
      releaseAccountA = () => resolve({ success: true, merged: false, status: 'no_remote' })
    }))

    const accountAInitialize = useAuthStore.getState().initialize()
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('hydrating_user_data'))

    await useAuthStore.getState().signOut()
    deps.loadFromSupabase.mockImplementation(async () => ({ success: true, merged: false, status: 'no_remote' }))
    await signInAfterSwitch('customer@example.test')

    releaseAccountA()
    await accountAInitialize

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: CUSTOMER_ZERO },
      profile: { id: CUSTOMER_ZERO, org_id: 'power-on-org' },
      tenantDataReady: true,
      tenantUserId: CUSTOMER_ZERO,
      error: null,
    })
    expect(deps.setActiveTenantUser.mock.calls[deps.setActiveTenantUser.mock.calls.length - 1]?.[0]).toBe(CUSTOMER_ZERO)
  })

  it('prevents a delayed Account A bootstrap failure from overwriting Account B status or error', async () => {
    let rejectAccountA!: (reason?: unknown) => void
    deps.getSession.mockResolvedValue({ data: { session: sessionFor(CONTRACTOR) } })
    deps.validateAppSession.mockResolvedValue(null)
    sessionStorage.setItem('poweron_password_authed', '1')
    deps.loadFromSupabase.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectAccountA = reject
    }))

    const accountAInitialize = useAuthStore.getState().initialize()
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('hydrating_user_data'))

    await useAuthStore.getState().signOut()
    deps.loadFromSupabase.mockImplementation(async () => ({ success: true, merged: false, status: 'no_remote' }))
    await signInAfterSwitch('customer@example.test')

    rejectAccountA(new Error('late Account A hydration failure'))
    await accountAInitialize

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: CUSTOMER_ZERO },
      tenantDataReady: true,
      tenantUserId: CUSTOMER_ZERO,
      error: null,
    })
    expect(consoleErrorSpy.mock.calls).not.toEqual(expect.arrayContaining([[
      '[AUTH-HYDRATION-FAIL]',
      expect.objectContaining({ userId: CONTRACTOR, message: 'late Account A hydration failure' }),
    ]]))
  })

  it('clears a stale previous-session workspace error before Account B begins a valid bootstrap', async () => {
    await ensureAuthListenerRegistered()
    useAuthStore.setState({
      status: 'unauthenticated',
      error: 'Workspace data could not be loaded. Check your connection and retry.',
      user: null,
      profile: null,
      tenantDataReady: false,
      tenantUserId: null,
    })

    await signInAfterSwitch('customer@example.test')

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: CUSTOMER_ZERO },
      tenantDataReady: true,
      tenantUserId: CUSTOMER_ZERO,
      error: null,
    })
  })

  it('discards stale Account A store identity and bootstraps Account B from the current session', async () => {
    await ensureAuthListenerRegistered()
    useAuthStore.setState({
      status: 'needs_passcode',
      user: { id: CONTRACTOR, email: 'contractor@example.test' } as any,
      profile: {
        id: CONTRACTOR,
        org_id: 'contractor-org',
        role: 'owner',
        is_active: true,
        full_name: 'Contractor One',
        passcode_hash: 'pbkdf2:100000:aa:bb',
      } as any,
      appSession: { sessionId: 'session-a', userId: CONTRACTOR, orgId: 'contractor-org', role: 'owner' } as any,
      biometric: null,
      lockExpiresAt: null,
      error: 'Workspace data could not be loaded. Check your connection and retry.',
      role: 'owner',
      ownerId: CONTRACTOR,
      employeeProfileId: null,
      employerOrgId: null,
      tenantDataReady: true,
      tenantUserId: CONTRACTOR,
    })
    sessionStorage.setItem('poweron_password_authed', '1')
    deps.loadFromSupabase.mockClear()
    deps.getSession.mockResolvedValue({ data: { session: sessionFor(CUSTOMER_ZERO, 'customer@example.test') } })
    deps.validateAppSession.mockResolvedValue(null)

    await useAuthStore.getState().initialize()

    expect(deps.loadFromSupabase.mock.calls.map((call) => call[0])).toEqual([CUSTOMER_ZERO])
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: CUSTOMER_ZERO },
      profile: { id: CUSTOMER_ZERO, org_id: 'power-on-org' },
      role: 'owner',
      ownerId: CUSTOMER_ZERO,
      tenantDataReady: true,
      tenantUserId: CUSTOMER_ZERO,
      error: null,
    })
  })

  it('resolves the same Account B workspace identity on immediate login and on authenticated reload', async () => {
    await ensureAuthListenerRegistered()
    deps.hasBackup = true
    useAuthStore.setState({
      status: 'unauthenticated',
      user: null,
      profile: null,
      appSession: null,
      biometric: null,
      lockExpiresAt: null,
      error: null,
      role: 'owner',
      ownerId: null,
      employeeProfileId: null,
      employerOrgId: null,
      tenantDataReady: false,
      tenantUserId: null,
    })
    deps.validateAppSession.mockResolvedValue(null)
    await signInAfterSwitch('customer@example.test')

    const immediateLoginState = {
      profileId: useAuthStore.getState().profile?.id,
      organizationId: useAuthStore.getState().profile?.org_id,
      tenantUserId: useAuthStore.getState().tenantUserId,
      tenantDataReady: useAuthStore.getState().tenantDataReady,
      loadUserIds: deps.loadFromSupabase.mock.calls.map((call) => call[0]),
    }

    useAuthStore.setState({
      status: 'loading',
      user: null,
      profile: null,
      appSession: null,
      biometric: null,
      lockExpiresAt: null,
      error: null,
      role: 'owner',
      ownerId: null,
      employeeProfileId: null,
      employerOrgId: null,
      tenantDataReady: false,
      tenantUserId: null,
    })
    deps.loadFromSupabase.mockClear()
    deps.getSession.mockResolvedValue({ data: { session: sessionFor(CUSTOMER_ZERO, 'customer@example.test') } })
    deps.validateAppSession.mockResolvedValue({
      sessionId: 'session-b',
      userId: CUSTOMER_ZERO,
      orgId: 'power-on-org',
      role: 'owner',
    })

    await useAuthStore.getState().initialize()

    expect({
      profileId: useAuthStore.getState().profile?.id,
      organizationId: useAuthStore.getState().profile?.org_id,
      tenantUserId: useAuthStore.getState().tenantUserId,
      tenantDataReady: useAuthStore.getState().tenantDataReady,
      loadUserIds: deps.loadFromSupabase.mock.calls.map((call) => call[0]),
    }).toEqual({
      ...immediateLoginState,
      loadUserIds: [CUSTOMER_ZERO],
    })
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: CUSTOMER_ZERO },
      profile: { id: CUSTOMER_ZERO, org_id: 'power-on-org' },
      tenantDataReady: true,
      tenantUserId: CUSTOMER_ZERO,
      error: null,
    })
    expect(deps.saveBackupData).not.toHaveBeenCalled()
  })
})

describe('COMM-PROD-4 password callback routing', () => {
  it('routes an authenticated recovery callback to the dedicated reset state', async () => {
    window.location.pathname = '/auth/reset-password'
    deps.getSession.mockResolvedValue({ data: { session: { user: { id: CONTRACTOR } } } })

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'password_recovery',
      user: { id: CONTRACTOR },
    })
    expect(deps.loadFromSupabase).not.toHaveBeenCalled()
  })

  it('keeps a normal signup confirmation on the established verification flow', async () => {
    window.location.search = '?verified=true'
    deps.getSession.mockResolvedValue({ data: { session: { user: { id: CONTRACTOR } } } })

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState().status).toBe('unauthenticated')
    expect(useAuthStore.getState().status).not.toBe('password_recovery')
    expect(deps.loadFromSupabase).not.toHaveBeenCalled()
  })

  it('treats a production-style root code callback as recovery only when a valid reset request is pending', async () => {
    window.location.search = '?code=recovery-pkce-code'
    markPasswordRecoveryRequest('https://app.poweronsolutionsllc.com/auth/reset-password')
    deps.getSession.mockResolvedValue({ data: { session: { user: { id: CONTRACTOR } } } })

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'password_recovery',
      user: { id: CONTRACTOR },
    })
    expect(deps.loadFromSupabase).not.toHaveBeenCalled()
  })

  it('does not treat an arbitrary root auth code as password recovery', async () => {
    window.location.search = '?code=signup-confirmation-code'
    deps.getSession.mockResolvedValue({ data: { session: { user: { id: CONTRACTOR } } } })

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useAuthStore.getState().status).not.toBe('password_recovery')
    expect(deps.loadFromSupabase).toHaveBeenCalledTimes(1)
  })
})

describe('COMM-PROD-1 B — organization isolation', () => {
  it('binds the empty workspace to the authenticated org and never touches Customer Zero', async () => {
    await useAuthStore.getState().completeInitialSetup()

    for (const call of deps.setActiveTenantUser.mock.calls) {
      expect(call[0]).toBe(CONTRACTOR)
    }
    for (const call of deps.loadFromSupabase.mock.calls) {
      expect(call[0]).toBe(CONTRACTOR)
    }
    for (const call of deps.saveBackupData.mock.calls) {
      expect(call[1]).toBe(CONTRACTOR)
    }
    expect(deps.hasBackupData).toHaveBeenCalledWith(CONTRACTOR)
    expect(useAuthStore.getState().tenantUserId).not.toBe(CUSTOMER_ZERO)
  })

  it('leaves an existing organization workspace intact — no empty seed over real data', async () => {
    deps.hasBackup = true

    await useAuthStore.getState().completeInitialSetup()

    expect(deps.saveBackupData).not.toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('authenticated')
  })
})

describe('COMM-PROD-1 D — PIN persistence across reload', () => {
  it('resolves PIN configured on reload once a passcode hash is stored', async () => {
    deps.getSession.mockResolvedValue({ data: { session: { user: { id: CONTRACTOR } } } })
    deps.validateAppSession.mockResolvedValue(null) // no Redis session — reload path

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState().status).toBe('needs_passcode')
    expect(useAuthStore.getState().status).not.toBe('needs_passcode_setup')
  })

  it('only restarts setup when the profile genuinely carries no passcode hash', async () => {
    deps.profiles.set(CONTRACTOR, { ...deps.profiles.get(CONTRACTOR), passcode_hash: null })
    deps.getSession.mockResolvedValue({ data: { session: { user: { id: CONTRACTOR } } } })
    deps.validateAppSession.mockResolvedValue(null)

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState().status).toBe('needs_passcode_setup')
  })

  it('keeps Customer Zero resolving its own organization and PIN state', async () => {
    useAuthStore.setState({ user: { id: CUSTOMER_ZERO, email: 'owner@poweron.test' } as any })
    deps.getSession.mockResolvedValue({ data: { session: { user: { id: CUSTOMER_ZERO } } } })
    deps.validateAppSession.mockResolvedValue(null)

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'needs_passcode',
      profile: { id: CUSTOMER_ZERO, org_id: 'power-on-org' },
    })
  })
})
