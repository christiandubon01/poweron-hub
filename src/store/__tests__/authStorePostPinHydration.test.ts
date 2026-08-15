import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authDeps = vi.hoisted(() => ({
  verifyResult: { success: true } as any,
  hydrationResult: { success: true, merged: true, status: 'applied' } as any,
  pending: false,
  verifyPasscode: vi.fn(),
  loadFromSupabase: vi.fn(),
  reconcilePending: vi.fn(),
  requestRemoteRefresh: vi.fn(),
  createAppSession: vi.fn(),
  validateAppSession: vi.fn(),
  destroyAppSession: vi.fn(),
  setActiveTenantUser: vi.fn(),
  markTenantDataReady: vi.fn(),
  setHydrating: vi.fn(),
  clearActiveTenantUser: vi.fn(),
  resetSessionScopedBackupClientState: vi.fn(),
  clearLocalSnapshots: vi.fn(),
  authSignOut: vi.fn(),
  getSession: vi.fn(),
  getPasscodeStatus: vi.fn(),
  profiles: new Map<string, any>(),
}))

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string): any => {
    let selectedId: string | null = null
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        if (column === 'id') selectedId = String(value)
        return builder
      }),
      update: vi.fn(() => builder),
      single: vi.fn(async () => ({ data: selectedId ? authDeps.profiles.get(selectedId) ?? null : null, error: null })),
      maybeSingle: vi.fn(async () => ({
        data: table === 'profiles' && selectedId ? authDeps.profiles.get(selectedId) ?? null : null,
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
      auth: {
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        getSession: (...args: any[]) => authDeps.getSession(...args),
        signOut: (...args: any[]) => authDeps.authSignOut(...args),
      },
    },
  }
})

vi.mock('@/lib/auth/passcode', () => ({
  getPasscodeStatus: (...args: any[]) => authDeps.getPasscodeStatus(...args),
  setPasscode: vi.fn(),
  verifyPasscode: (...args: any[]) => authDeps.verifyPasscode(...args),
}))

vi.mock('@/lib/auth/biometric', () => ({
  authenticateWithBiometric: vi.fn(),
  getBiometricCapabilities: vi.fn(async () => ({
    available: false, enrolled: false, biometryType: 'none', platformLabel: 'Unavailable',
  })),
}))

vi.mock('@/lib/auth/session', () => ({
  createAppSession: (...args: any[]) => authDeps.createAppSession(...args),
  destroyAppSession: (...args: any[]) => authDeps.destroyAppSession(...args),
  validateAppSession: (...args: any[]) => authDeps.validateAppSession(...args),
  getDeviceInfo: vi.fn(() => 'test-device'),
}))

vi.mock('@/lib/guardian/presenceMonitor', () => ({
  presenceMonitor: { start: vi.fn(), stop: vi.fn(), setModule: vi.fn() },
  normalizeModule: (v: string) => v,
}))

vi.mock('@/lib/memory/audit', () => ({
  logLogin: vi.fn(async () => {}),
  logAudit: vi.fn(async () => {}),
}))

vi.mock('@/services/security/AgentSafetySystem', () => ({
  logAction: vi.fn(async () => {}),
}))

vi.mock('@/services/backupDataService', () => ({
  hasBackupData: vi.fn(() => true),
  createEmptyBackup: vi.fn(() => ({ projects: [], logs: [], settings: {} })),
  saveBackupData: vi.fn(),
  getBackupData: vi.fn(() => null),
  loadFromSupabase: (...args: any[]) => authDeps.loadFromSupabase(...args),
  setHydrating: (...args: any[]) => authDeps.setHydrating(...args),
  getCacheOwner: vi.fn(() => null),
  setCacheOwner: vi.fn(),
  clearCacheOwner: vi.fn(),
  setActiveTenantUser: (...args: any[]) => authDeps.setActiveTenantUser(...args),
  markTenantDataReady: (...args: any[]) => authDeps.markTenantDataReady(...args),
  clearActiveTenantUser: (...args: any[]) => authDeps.clearActiveTenantUser(...args),
  resetSessionScopedBackupClientState: (...args: any[]) => authDeps.resetSessionScopedBackupClientState(...args),
  clearLocalSnapshots: (...args: any[]) => authDeps.clearLocalSnapshots(...args),
  hasPendingLocalSave: vi.fn(() => authDeps.pending),
  reconcilePendingLocalSaveForHydration: (...args: any[]) => authDeps.reconcilePending(...args),
  getDeviceId: vi.fn(() => 'test-device-id'),
}))

vi.mock('@/services/liveCloudRefreshService', () => ({
  requestRemoteRefresh: (...args: any[]) => authDeps.requestRemoteRefresh(...args),
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

function resetStore(): void {
  useAuthStore.setState({
    status: 'needs_passcode',
    user: { id: 'owner-1' } as any,
    profile: {
      id: 'owner-1', org_id: 'org-1', role: 'owner', is_active: true,
      passcode_hash: 'pbkdf2:test', full_name: 'Owner',
    } as any,
    appSession: null,
    biometric: null,
    lockExpiresAt: null,
    error: null,
    role: 'owner',
    ownerId: 'owner-1',
    employeeProfileId: null,
    employerOrgId: null,
    tenantDataReady: false,
    tenantUserId: null,
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

function expectHydrationFailureLogged(stage: string, message: string): void {
  expect(consoleErrorSpy.mock.calls).toEqual(expect.arrayContaining([[
    '[AUTH-HYDRATION-FAIL]',
    expect.objectContaining({
      stage,
      userId: 'owner-1',
      organizationId: 'org-1',
      message,
    }),
  ]]))
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { hash: '', search: '', pathname: '/' },
      history: { replaceState: vi.fn() },
    },
  })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { title: 'Auth test' } })
  authDeps.verifyResult = { success: true }
  authDeps.hydrationResult = { success: true, merged: true, status: 'applied' }
  authDeps.pending = false
  authDeps.verifyPasscode.mockReset().mockImplementation(async () => authDeps.verifyResult)
  authDeps.loadFromSupabase.mockReset().mockImplementation(async () => authDeps.hydrationResult)
  authDeps.reconcilePending.mockReset().mockImplementation(async () => {
    authDeps.pending = false
    return { success: true }
  })
  authDeps.requestRemoteRefresh.mockReset().mockResolvedValue(null)
  authDeps.createAppSession.mockReset().mockResolvedValue('session-1')
  authDeps.validateAppSession.mockReset().mockImplementation(async (sessionId?: string) => ({
    sessionId: sessionId ?? 'session-1', userId: 'owner-1', orgId: 'org-1', role: 'owner',
  }))
  authDeps.destroyAppSession.mockReset().mockResolvedValue(undefined)
  authDeps.setActiveTenantUser.mockReset()
  authDeps.markTenantDataReady.mockReset()
  authDeps.setHydrating.mockReset()
  authDeps.clearActiveTenantUser.mockReset()
  authDeps.resetSessionScopedBackupClientState.mockReset()
  authDeps.clearLocalSnapshots.mockReset().mockResolvedValue(true)
  authDeps.authSignOut.mockReset().mockResolvedValue({})
  authDeps.getSession.mockReset().mockResolvedValue({ data: { session: null } })
  authDeps.getPasscodeStatus.mockReset().mockResolvedValue({
    isSet: true, isLocked: false, attemptsRemaining: 5, lockExpiresAt: null,
  })
  authDeps.profiles.clear()
  authDeps.profiles.set('owner-1', {
    id: 'owner-1', org_id: 'org-1', role: 'owner', is_active: true,
    passcode_hash: 'pbkdf2:test', full_name: 'Owner', biometric_enabled: false,
  })
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  resetStore()
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('SYNC-08 auth-store PIN hydration', () => {
  it('awaits one successful remote hydration before authenticating', async () => {
    let releaseHydration!: () => void
    authDeps.loadFromSupabase.mockImplementation(() => new Promise(resolve => {
      releaseHydration = () => resolve(authDeps.hydrationResult)
    }))

    const submission = useAuthStore.getState().submitPasscode('123456')
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('hydrating_user_data'))
    expect(useAuthStore.getState().status).not.toBe('authenticated')

    releaseHydration()
    await submission

    expect(authDeps.loadFromSupabase).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated', tenantDataReady: true, tenantUserId: 'owner-1',
    })
  })

  it('reconciles a deferred pending save and requests the guarded refresh exactly once', async () => {
    authDeps.pending = true
    authDeps.hydrationResult = {
      success: true, merged: false, status: 'deferred_pending_local',
    }

    await useAuthStore.getState().submitPasscode('123456')

    expect(authDeps.reconcilePending).toHaveBeenCalledTimes(1)
    expect(authDeps.requestRemoteRefresh).toHaveBeenCalledTimes(1)
    expect(authDeps.requestRemoteRefresh).toHaveBeenCalledWith({ source: 'manual' })
    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('does not hydrate after a failed PIN', async () => {
    authDeps.verifyResult = { success: false, locked: false, attemptsRemaining: 4 }

    await useAuthStore.getState().submitPasscode('000000')

    expect(authDeps.loadFromSupabase).not.toHaveBeenCalled()
    expect(authDeps.reconcilePending).not.toHaveBeenCalled()
    expect(authDeps.requestRemoteRefresh).not.toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({
      status: 'needs_passcode',
      error: 'Incorrect passcode. 4 attempts remaining.',
    })
  })

  it('returns to a retryable PIN state when app_state hydration fails', async () => {
    authDeps.hydrationResult = {
      success: false, merged: false, status: 'failed', error: 'network unavailable',
    }

    await useAuthStore.getState().submitPasscode('123456')

    expect(useAuthStore.getState()).toMatchObject({
      status: 'needs_passcode',
      tenantDataReady: false,
      tenantUserId: null,
      appSession: null,
      error: 'Workspace refresh failed. Check your connection and enter your PIN to retry.',
    })
    expect(authDeps.clearActiveTenantUser).toHaveBeenCalled()
    expect(authDeps.destroyAppSession).toHaveBeenCalledWith('session-1')
    expect(authDeps.requestRemoteRefresh).not.toHaveBeenCalled()
  })

  it('logs reconcile-stage diagnostics when deferred local sync cannot be completed', async () => {
    authDeps.pending = true
    authDeps.hydrationResult = {
      success: true, merged: false, status: 'deferred_pending_local',
    }
    authDeps.reconcilePending.mockResolvedValue({
      success: false,
      error: 'pending sync failed',
    })

    await useAuthStore.getState().submitPasscode('123456')

    expectHydrationFailureLogged('reconcile', 'pending sync failed')
    expect(authDeps.requestRemoteRefresh).not.toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({
      status: 'needs_passcode',
      tenantDataReady: false,
      tenantUserId: null,
      error: 'Workspace refresh failed. Check your connection and enter your PIN to retry.',
    })
  })

  it('logs refresh-stage diagnostics when post-reconcile cloud refresh fails', async () => {
    authDeps.pending = true
    authDeps.hydrationResult = {
      success: true, merged: false, status: 'deferred_pending_local',
    }
    authDeps.reconcilePending.mockImplementation(async () => {
      authDeps.pending = false
      return { success: true }
    })
    authDeps.requestRemoteRefresh.mockRejectedValue(new Error('refresh offline'))

    await useAuthStore.getState().submitPasscode('123456')

    expectHydrationFailureLogged('refresh', 'refresh offline')
    expect(authDeps.requestRemoteRefresh).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState()).toMatchObject({
      status: 'needs_passcode',
      tenantDataReady: false,
      tenantUserId: null,
      error: 'Workspace refresh failed. Check your connection and enter your PIN to retry.',
    })
  })

  it('logs bootstrap-stage diagnostics when workspace hydration throws before stage classification', async () => {
    authDeps.loadFromSupabase.mockRejectedValue(Object.assign(new Error('supabase exploded'), { code: 'ECONNRESET' }))

    await useAuthStore.getState().submitPasscode('123456')

    expectHydrationFailureLogged('bootstrap', 'supabase exploded')
    expect(useAuthStore.getState()).toMatchObject({
      status: 'needs_passcode',
      tenantDataReady: false,
      tenantUserId: null,
      error: 'Workspace refresh failed. Check your connection and enter your PIN to retry.',
    })
  })

  it('keeps sign-out authoritative when an older PIN hydration later succeeds', async () => {
    const hydration = deferred<any>()
    authDeps.loadFromSupabase.mockImplementationOnce(() => hydration.promise)

    const attempt = useAuthStore.getState().submitPasscode('123456')
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('hydrating_user_data'))

    await useAuthStore.getState().signOut()
    hydration.resolve(authDeps.hydrationResult)
    await attempt

    expect(useAuthStore.getState()).toMatchObject({
      status: 'unauthenticated', user: null, profile: null, appSession: null,
      tenantDataReady: false, tenantUserId: null,
    })
    expect(authDeps.markTenantDataReady).not.toHaveBeenCalled()
    expect(authDeps.setActiveTenantUser).toHaveBeenCalledTimes(1)
  })

  it('keeps a newer successful PIN attempt authoritative after the older hydration completes', async () => {
    const firstHydration = deferred<any>()
    authDeps.loadFromSupabase
      .mockImplementationOnce(() => firstHydration.promise)
      .mockResolvedValueOnce(authDeps.hydrationResult)
    authDeps.createAppSession
      .mockResolvedValueOnce('session-a')
      .mockResolvedValueOnce('session-b')

    const attemptA = useAuthStore.getState().submitPasscode('111111')
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('hydrating_user_data'))
    const attemptB = useAuthStore.getState().submitPasscode('222222')
    await attemptB

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated', appSession: { sessionId: 'session-b' }, tenantDataReady: true,
    })

    firstHydration.resolve(authDeps.hydrationResult)
    await attemptA

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated', appSession: { sessionId: 'session-b' }, tenantDataReady: true,
    })
    expect(authDeps.markTenantDataReady).toHaveBeenCalledTimes(1)
    expect(authDeps.destroyAppSession).not.toHaveBeenCalled()
  })

  it('does not let an older failed hydration destroy the newer session', async () => {
    const firstHydration = deferred<any>()
    authDeps.loadFromSupabase
      .mockImplementationOnce(() => firstHydration.promise)
      .mockResolvedValueOnce(authDeps.hydrationResult)
    authDeps.createAppSession
      .mockResolvedValueOnce('session-a')
      .mockResolvedValueOnce('session-b')

    const attemptA = useAuthStore.getState().submitPasscode('111111')
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('hydrating_user_data'))
    await useAuthStore.getState().submitPasscode('222222')

    firstHydration.reject(new Error('late hydration failure'))
    await attemptA

    expect(authDeps.destroyAppSession).not.toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated', appSession: { sessionId: 'session-b' }, tenantDataReady: true,
    })
  })

  it('stops a superseded PIN before it can bootstrap or repoint the active tenant', async () => {
    const firstVerification = deferred<any>()
    authDeps.verifyPasscode
      .mockImplementationOnce(() => firstVerification.promise)
      .mockResolvedValueOnce({ success: true })
    authDeps.createAppSession.mockResolvedValueOnce('session-b')

    const attemptA = useAuthStore.getState().submitPasscode('111111')
    await useAuthStore.getState().submitPasscode('222222')
    expect(authDeps.setActiveTenantUser).toHaveBeenCalledTimes(1)

    firstVerification.resolve({ success: true })
    await attemptA

    expect(authDeps.setActiveTenantUser).toHaveBeenCalledTimes(1)
    expect(authDeps.clearActiveTenantUser).not.toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('preserves the initialize sequence guard when an older initialize resolves last', async () => {
    const firstSession = deferred<any>()
    authDeps.profiles.set('owner-2', {
      id: 'owner-2', org_id: 'org-2', role: 'owner', is_active: true,
      passcode_hash: 'pbkdf2:test', full_name: 'New Owner', biometric_enabled: false,
    })
    authDeps.getSession
      .mockImplementationOnce(() => firstSession.promise)
      .mockResolvedValueOnce({ data: { session: { user: { id: 'owner-2' } } } })

    const initializeA = useAuthStore.getState().initialize()
    const initializeB = useAuthStore.getState().initialize()
    await initializeB

    firstSession.resolve({ data: { session: { user: { id: 'owner-1' } } } })
    await initializeA

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated', user: { id: 'owner-2' }, tenantUserId: 'owner-2',
    })
  })
})
