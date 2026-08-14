import { beforeEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  profiles: new Map<string, any>(),
  employeeProfiles: [] as Array<any>,
  crewMembers: [] as Array<any>,
  getSession: vi.fn(),
  validateAppSession: vi.fn(),
  createAppSession: vi.fn(),
  loadFromSupabase: vi.fn(),
  setHydrating: vi.fn(),
  setActiveTenantUser: vi.fn(),
  markTenantDataReady: vi.fn(),
  clearActiveTenantUser: vi.fn(),
  resetSessionScopedBackupClientState: vi.fn(),
  clearLocalSnapshots: vi.fn(),
  invoke: vi.fn(),
  createdOrganizations: [] as Array<string>,
}))

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string): any => {
    let selectedId: string | null = null
    let selectedUserId: string | null = null
    let requireActive = false
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        if (column === 'id') selectedId = String(value)
        if (column === 'user_id') selectedUserId = String(value)
        if (column === 'active') requireActive = value === true
        return builder
      }),
      single: vi.fn(async () => ({
        data: table === 'profiles' && selectedId ? deps.profiles.get(selectedId) ?? null : null,
        error: null,
      })),
      maybeSingle: vi.fn(async () => {
        if (table === 'profiles' && selectedId) {
          return { data: deps.profiles.get(selectedId) ?? null, error: null }
        }
        if (table === 'crew_members' && selectedUserId) {
          const row = deps.crewMembers.find((item) => item.user_id === selectedUserId && item.is_active === true) ?? null
          return { data: row, error: null }
        }
        return { data: null, error: null }
      }),
      then: (resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) => {
        if (table === 'employee_profiles') {
          const rows = deps.employeeProfiles.filter((row) => {
            if (selectedUserId && row.user_id !== selectedUserId) return false
            if (requireActive && row.active !== true) return false
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
      from: vi.fn((table: string) => makeBuilder(table)),
      functions: {
        invoke: (...args: any[]) => deps.invoke(...args),
      },
      auth: {
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        getSession: (...args: any[]) => deps.getSession(...args),
        signOut: vi.fn(async () => ({})),
      },
    },
  }
})

vi.mock('@/lib/auth/passcode', () => ({
  getPasscodeStatus: vi.fn(async () => ({
    isSet: true, isLocked: false, attemptsRemaining: 5, lockExpiresAt: null,
  })),
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
  destroyAppSession: vi.fn(async () => undefined),
  validateAppSession: (...args: any[]) => deps.validateAppSession(...args),
  getDeviceInfo: vi.fn(() => 'test-device'),
}))

vi.mock('@/lib/memory/audit', () => ({
  logLogin: vi.fn(async () => {}),
  logAudit: vi.fn(async () => {}),
}))

vi.mock('@/services/security/AgentSafetySystem', () => ({ logAction: vi.fn(async () => {}) }))

vi.mock('@/services/backupDataService', () => ({
  hasBackupData: vi.fn(() => true),
  createEmptyBackup: vi.fn(() => ({ projects: [], logs: [], settings: {} })),
  saveBackupData: vi.fn(),
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
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(String(key), String(value)) }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  get length(): number { return this.values.size }
}

const USER_ID = 'employee-owner-user'
const EMPLOYER_ORG_ID = 'employer-org'
const CONTRACTOR_ORG_ID = 'contractor-org-new'

function resetStore(): void {
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
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { hash: '', search: '', pathname: '/' }, history: { replaceState: vi.fn() } },
  })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { title: 'Auth test' } })

  deps.profiles.clear()
  deps.employeeProfiles = [{
    id: 'employee-profile-1',
    org_id: EMPLOYER_ORG_ID,
    user_id: USER_ID,
    active: true,
    role: 'employee',
    portal_access: { time_tracking: true },
  }]
  deps.crewMembers = []
  deps.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: USER_ID, email: 'shared@example.com' } } } })
  deps.validateAppSession.mockReset().mockResolvedValue(null)
  deps.createAppSession.mockReset().mockResolvedValue({ sessionId: 'session-1' })
  deps.loadFromSupabase.mockReset().mockResolvedValue({ success: true, merged: true, status: 'applied' })
  deps.setHydrating.mockReset()
  deps.setActiveTenantUser.mockReset()
  deps.markTenantDataReady.mockReset()
  deps.clearActiveTenantUser.mockReset()
  deps.resetSessionScopedBackupClientState.mockReset()
  deps.clearLocalSnapshots.mockReset().mockResolvedValue(true)
  deps.createdOrganizations = []
  deps.invoke.mockReset().mockImplementation(async (name: string) => {
    expect(name).toBe('bootstrap-owner-workspace')
    if (!deps.profiles.has(USER_ID)) {
      deps.createdOrganizations.push(CONTRACTOR_ORG_ID)
      deps.profiles.set(USER_ID, {
        id: USER_ID,
        org_id: CONTRACTOR_ORG_ID,
        full_name: 'Shared Identity',
        role: 'owner',
        is_active: true,
        passcode_hash: 'password_only',
        biometric_enabled: false,
      })
    }
    return {
      data: {
        createdOrganization: deps.createdOrganizations.length === 1,
        createdProfile: true,
        profile: deps.profiles.get(USER_ID),
      },
      error: null,
    }
  })

  resetStore()
})

describe('COMM-PROD-2.1 employee-first owner bootstrap', () => {
  it('creates one contractor workspace on first main-app login, preserves employee membership, and reuses it on later logins', async () => {
    await useAuthStore.getState().initialize()

    expect(deps.invoke).toHaveBeenCalledTimes(1)
    expect(deps.createdOrganizations).toEqual([CONTRACTOR_ORG_ID])
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      role: 'owner',
      ownerId: USER_ID,
      employeeProfileId: null,
      employerOrgId: null,
      tenantUserId: USER_ID,
      profile: {
        id: USER_ID,
        org_id: CONTRACTOR_ORG_ID,
      },
    })
    expect(deps.employeeProfiles).toEqual([{
      id: 'employee-profile-1',
      org_id: EMPLOYER_ORG_ID,
      user_id: USER_ID,
      active: true,
      role: 'employee',
      portal_access: { time_tracking: true },
    }])

    resetStore()
    await useAuthStore.getState().initialize()

    expect(deps.invoke).toHaveBeenCalledTimes(1)
    expect(deps.createdOrganizations).toEqual([CONTRACTOR_ORG_ID])
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      role: 'owner',
      profile: {
        org_id: CONTRACTOR_ORG_ID,
      },
    })

    resetStore()
    window.location.pathname = '/employee/login'
    await useAuthStore.getState().initialize()

    expect(deps.invoke).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      role: 'employee',
      employeeProfileId: 'employee-profile-1',
      employerOrgId: EMPLOYER_ORG_ID,
      profile: {
        org_id: CONTRACTOR_ORG_ID,
      },
    })
  })
})
