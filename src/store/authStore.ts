// @ts-nocheck
/**
 * Auth state machine — Zustand store.
 *
 * States:
 *   loading           → Initial check in progress (Supabase session + Redis session)
 *   unauthenticated   → No valid Supabase session → show email login
 *   needs_passcode_setup → First login; Supabase OK but no passcode set yet
 *   needs_passcode    → Returning user; Supabase session valid, passcode required
 *   biometric_prompt  → Passcode set + biometric enrolled; show biometric option
 *   locked            → Too many failed attempts; show countdown timer
 *   authenticated     → Both Supabase JWT and passcode/biometric verified ✓
 */

import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { User } from '@/lib/supabase'
import type { Tables } from '@/lib/supabase'
import { getPasscodeStatus, verifyPasscode, setPasscode } from '@/lib/auth/passcode'
import { authenticateWithBiometric, getBiometricCapabilities } from '@/lib/auth/biometric'
import type { BiometricCapabilities } from '@/lib/auth/biometric'
import { createAppSession, destroyAppSession, validateAppSession, getDeviceInfo } from '@/lib/auth/session'
import type { AppSession } from '@/lib/auth/session'
import { logLogin, logAudit } from '@/lib/memory/audit'
import { hasBackupData, createEmptyBackup, saveBackupData, loadFromSupabase, setHydrating, getCacheOwner, setCacheOwner, clearCacheOwner, setActiveTenantUser, markTenantDataReady, clearActiveTenantUser, clearLocalSnapshots, hasPendingLocalSave, reconcilePendingLocalSaveForHydration } from '@/services/backupDataService'
import type { BackupHydrationResult } from '@/services/backupDataService'
import { completeDeferredHydration } from '@/services/postPinHydrationService'
import { logAction } from '@/services/security/AgentSafetySystem'
import { resolveProductRedirectUrl } from '@/services/organizationIdentityService'
import { isDemoRuntimeActive } from '@/services/demoModeSafety'
import { trackPilotTelemetryEvent } from '@/services/pilotTelemetryClient'

// ── Role system ───────────────────────────────────────────────────────────────
// owner    → the business owner; sees the full app (V15rLayout + all panels)
// crew     → a field crew member; sees only CrewPortal (simplified field log UI)
// employee → time-tracking employee; sees EmployeePortal (separate from AppShell)
// client   → a client; sees ClientPortal (read-only project status — future)
export type UserRole = 'owner' | 'crew' | 'employee' | 'client'

const ROLE_STORAGE_KEY = 'poweron-hub-role'
const OWNER_ID_STORAGE_KEY = 'poweron-hub-owner-id'
const EMPLOYEE_PROFILE_ID_KEY = 'poweron-hub-employee-profile-id'
const EMPLOYER_ORG_ID_KEY = 'poweron-hub-employer-org-id'
const MAGIC_LINK_REDIRECT_URL = resolveProductRedirectUrl(
  import.meta.env.VITE_APP_BASE_URL as string | undefined,
  typeof window !== 'undefined' ? window.location.origin : undefined,
)

interface ResolvedPortalRole {
  role: UserRole
  ownerId: string | null
  employeeProfileId: string | null
  employerOrgId: string | null
  /**
   * EMP-AUTH-1A. 'resolved' = the crew/employee lookups completed and this role
   * is trustworthy (including a genuine owner with no crew/employee row).
   * 'unresolved' = a lookup timed out or errored, so identity is UNKNOWN. Callers
   * must NOT treat 'unresolved' as owner — no PIN/AppShell/NDA — and should enter
   * a safe resolving/retry state instead.
   */
  status?: 'resolved' | 'unresolved'
}

function hasTimeTrackingAccess(portalAccess: unknown): boolean {
  if (!portalAccess || typeof portalAccess !== 'object') return false
  const flags = portalAccess as Record<string, unknown>
  return flags.time_tracking === true || flags.time_tracking === 'true'
}

function persistResolvedRole(resolved: ResolvedPortalRole): void {
  localStorage.setItem(ROLE_STORAGE_KEY, resolved.role)
  localStorage.setItem(OWNER_ID_STORAGE_KEY, resolved.ownerId ?? '')
  if (resolved.employeeProfileId) {
    localStorage.setItem(EMPLOYEE_PROFILE_ID_KEY, resolved.employeeProfileId)
  } else {
    localStorage.removeItem(EMPLOYEE_PROFILE_ID_KEY)
  }
  if (resolved.employerOrgId) {
    localStorage.setItem(EMPLOYER_ORG_ID_KEY, resolved.employerOrgId)
  } else {
    localStorage.removeItem(EMPLOYER_ORG_ID_KEY)
  }
}

// EMP-AUTH-1A: single-lookup result. `matched` = a crew/employee identity was
// found. `failed` = the lookup errored or timed out (identity UNKNOWN — must NOT
// be read as "no such identity"). Neither set = a clean miss (definitively not
// this role).
interface LookupOutcome { matched?: ResolvedPortalRole; failed: boolean }

const RESOLVE_QUERY_TIMEOUT_MS = 3000
// Two attempts: immediate, then one short backoff. Kept tight so the safe
// resolving state recovers quickly; genuine matches/misses return on attempt 1.
const RESOLVE_RETRY_DELAYS_MS = [0, 600]

const QUERY_TIMEOUT = Symbol('resolve_query_timeout')

async function resolveCrewOnce(userId: string): Promise<LookupOutcome> {
  try {
    const res: any = await withTimeout(
      supabase
        .from('crew_members')
        .select('owner_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle() as any,
      RESOLVE_QUERY_TIMEOUT_MS,
      QUERY_TIMEOUT as any,
    )
    if (res === QUERY_TIMEOUT) return { failed: true }
    if (res?.error) return { failed: true }
    if (res?.data) {
      return {
        failed: false,
        matched: { role: 'crew', ownerId: res.data.owner_id ?? null, employeeProfileId: null, employerOrgId: null },
      }
    }
    return { failed: false } // clean miss
  } catch (e) {
    console.warn('[Auth] resolveUserRole: crew check failed:', e)
    return { failed: true }
  }
}

async function resolveEmployeeOnce(userId: string): Promise<LookupOutcome> {
  try {
    const res: any = await withTimeout(
      supabase
        .from('employee_profiles')
        .select('id, org_id, role, portal_access')
        .eq('user_id', userId)
        .eq('active', true) as any,
      RESOLVE_QUERY_TIMEOUT_MS,
      QUERY_TIMEOUT as any,
    )
    if (res === QUERY_TIMEOUT) return { failed: true }
    if (res?.error) return { failed: true }
    const rows = res?.data ?? []
    const match = rows.find((row: any) => hasTimeTrackingAccess(row.portal_access))
    if (match) {
      return {
        failed: false,
        matched: { role: 'employee', ownerId: null, employeeProfileId: match.id, employerOrgId: match.org_id },
      }
    }
    return { failed: false } // clean miss (no active time-tracking profile)
  } catch (e) {
    console.warn('[Auth] resolveUserRole: employee check failed:', e)
    return { failed: true }
  }
}

/** One full resolution pass. Crew precedence preserved; runs both lookups in
 *  parallel so a single dead query cannot serialize the whole wait. */
async function resolveUserRoleOnce(
  userId: string,
): Promise<{ resolved: ResolvedPortalRole | null; failed: boolean }> {
  const [crew, emp] = await Promise.all([resolveCrewOnce(userId), resolveEmployeeOnce(userId)])
  if (crew.matched) return { resolved: { ...crew.matched, status: 'resolved' }, failed: false }
  if (emp.matched) return { resolved: { ...emp.matched, status: 'resolved' }, failed: false }
  // No match. If EITHER lookup failed we cannot conclude "owner" — identity is unknown.
  if (crew.failed || emp.failed) return { resolved: null, failed: true }
  // Both lookups completed cleanly with no crew/employee row → genuine owner.
  return {
    resolved: { role: 'owner', ownerId: userId, employeeProfileId: null, employerOrgId: null, status: 'resolved' },
    failed: false,
  }
}

/**
 * Determine portal role:
 *   1. crew_members active match → crew
 *   2. employee_profiles active + time_tracking → employee
 *   3. both lookups clean-miss → genuine owner
 *   4. a lookup timed out / errored (after retries) → status 'unresolved'
 *
 * EMP-AUTH-1A: a timeout/error is NEVER silently converted to owner. Callers must
 * check `status` and, when 'unresolved', enter a safe resolving/retry state
 * rather than owner PIN / AppShell / NDA. Employer org is employee_profiles.org_id.
 */
async function resolveUserRole(userId: string): Promise<ResolvedPortalRole> {
  for (let attempt = 0; attempt < RESOLVE_RETRY_DELAYS_MS.length; attempt++) {
    if (RESOLVE_RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise(r => setTimeout(r, RESOLVE_RETRY_DELAYS_MS[attempt]))
    }
    const { resolved, failed } = await resolveUserRoleOnce(userId)
    if (resolved) {
      persistResolvedRole(resolved)
      _identityRetryCount = 0 // network recovered — clear the safe-retry budget
      return resolved
    }
    if (!failed) break // unreachable, but never loop on a non-failure
  }
  // Unresolved after retries. Do NOT persist and do NOT claim owner — the caller
  // must keep the user in a safe resolving/retry state.
  return { role: 'owner', ownerId: userId, employeeProfileId: null, employerOrgId: null, status: 'unresolved' }
}

/** Fast load from localStorage — used when app session already valid. */
function loadRoleFromStorage(userId: string): ResolvedPortalRole {
  const role = (localStorage.getItem(ROLE_STORAGE_KEY) ?? 'owner') as UserRole
  const ownerId = localStorage.getItem(OWNER_ID_STORAGE_KEY) || userId
  return {
    role,
    ownerId,
    employeeProfileId: localStorage.getItem(EMPLOYEE_PROFILE_ID_KEY) || null,
    employerOrgId: localStorage.getItem(EMPLOYER_ORG_ID_KEY) || null,
  }
}

/** Seed empty backup for brand-new users who have never imported data.
 *  Tenant-scoped and local-only. Never writes to Supabase. */
async function seedEmptyBackupIfNeeded(userId: string): Promise<void> {
  if (hasBackupData(userId)) return
  const empty = createEmptyBackup()
  empty.settings = {
    ...empty.settings,
    tax: 0, markup: 20, billRate: 65, opCost: 45,
    mileRate: 0.67, dayTarget: 8, salaryTarget: 0,
    annualTarget: 0, overhead: { essential: [], extra: [], loans: [], vehicle: [] },
    company: '', license: '', gcalUrl: '', amBlock: 0, pmBlock: 0,
    wasteDefault: 10, defaultOHRate: 30, billableHrsYear: 1800,
    defaultTemplateId: '', mtoPhases: [], phaseWeights: {},
  }
  saveBackupData(empty, userId)
}

class StaleAuthOperationError extends Error {
  constructor() {
    super('Auth operation superseded')
    this.name = 'StaleAuthOperationError'
  }
}

let _authOperationGeneration = 0
let _initSeq = 0

function beginAuthOperation(): number {
  // Shared auth transitions also invalidate any older initialize() commit.
  _initSeq++
  return ++_authOperationGeneration
}

function isAuthOperationCurrent(operationId: number): boolean {
  return operationId === _authOperationGeneration
}

function assertAuthOperationCurrent(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new StaleAuthOperationError()
}

/** Bootstrap authenticated user — loads tenant data before marking authenticated.
 *  This is the ONLY place loadFromSupabase should be called during login.
 *  It is read-only against Supabase; new users get local-only empty state. */
async function bootstrapAuthenticatedUser(
  userId: string,
  isCurrent: () => boolean = () => true,
): Promise<BackupHydrationResult> {
  assertAuthOperationCurrent(isCurrent)
  setHydrating(true)
  assertAuthOperationCurrent(isCurrent)
  setActiveTenantUser(userId)
  let preserveCacheOwner = false
  try {
    assertAuthOperationCurrent(isCurrent)
    // Legacy owner tag is kept only as a diagnostic/compatibility marker.
    const cacheOwner = getCacheOwner()
    if (cacheOwner && cacheOwner !== userId) {
      localStorage.removeItem('poweron_v2')
      if (!await clearLocalSnapshots()) {
        assertAuthOperationCurrent(isCurrent)
        preserveCacheOwner = true
        throw new Error('Unable to clear the previous account snapshot history')
      }
      assertAuthOperationCurrent(isCurrent)
      clearCacheOwner()
    }
    assertAuthOperationCurrent(isCurrent)
    setCacheOwner(userId)

    const initialResult = await loadFromSupabase(userId, false, isCurrent)
    assertAuthOperationCurrent(isCurrent)
    if (!initialResult.success) {
      throw new Error(initialResult.error || 'Failed to load workspace data')
    }

    // The guarded sync engine refuses writes while the bootstrap read flag is set.
    // Auth UI remains in hydrating_user_data; only the service-level read phase ends.
    if (initialResult.status === 'deferred_pending_local') {
      assertAuthOperationCurrent(isCurrent)
      setHydrating(false)
    }

    const result = await completeDeferredHydration(initialResult, {
      reconcilePendingLocalSave: async () => {
        assertAuthOperationCurrent(isCurrent)
        const syncResult = await reconcilePendingLocalSaveForHydration(userId)
        assertAuthOperationCurrent(isCurrent)
        return syncResult
      },
      hasPendingLocalSave: () => {
        assertAuthOperationCurrent(isCurrent)
        return hasPendingLocalSave()
      },
      requestRemoteRefresh: async () => {
        assertAuthOperationCurrent(isCurrent)
        const { requestRemoteRefresh } = await import('@/services/liveCloudRefreshService')
        assertAuthOperationCurrent(isCurrent)
        const refreshResult = await requestRemoteRefresh({ source: 'manual' })
        assertAuthOperationCurrent(isCurrent)
        return refreshResult
      },
    })
    assertAuthOperationCurrent(isCurrent)

    // loadFromSupabase(userId) seeds empty tenant-local data when no remote row exists.
    // This is a final safety fallback only.
    assertAuthOperationCurrent(isCurrent)
    await seedEmptyBackupIfNeeded(userId)
    assertAuthOperationCurrent(isCurrent)
    markTenantDataReady(userId)
    return result
  } catch (err) {
    if (err instanceof StaleAuthOperationError || !isCurrent()) {
      throw err instanceof StaleAuthOperationError ? err : new StaleAuthOperationError()
    }
    console.error('[Auth] bootstrapAuthenticatedUser failed:', err)
    clearActiveTenantUser()
    if (!preserveCacheOwner) clearCacheOwner()
    throw err
  } finally {
    if (isCurrent()) setHydrating(false)
  }
}

/**
 * COMM-PROD-1 Step 9 (defect B). Shared tail for every owner entry point that has
 * already proved identity (PIN setup, password-only setup, PIN verify).
 *
 * The order matters: the app session and portal role are resolved first, then the
 * tenant workspace is bootstrapped, and only then does status become
 * 'authenticated'. Any path that flips to 'authenticated' without running
 * bootstrapAuthenticatedUser leaves the backup service with no active tenant, so
 * getBackupData() falls through to the browser-global legacy key — empty on a
 * brand-new organization — and the app renders the Import Backup recovery screen
 * instead of the workspace.
 */
async function establishOwnerSession(
  set: (partial: Partial<AuthState>) => void,
  user: User,
  profile: Profile | null,
  auditMethod: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  let session = null
  try {
    await withTimeout(
      createAppSession({
        userId: user.id,
        orgId: profile?.org_id,
        role: profile?.role,
        deviceInfo: getDeviceInfo(),
        isCurrent,
      }),
      5000,
      'timeout',
    )
    session = await withTimeout(validateAppSession(), 3000, null)
  } catch {
    // The Redis app session is a resume convenience. The Supabase JWT and the
    // server-side passcode remain authoritative, so a store outage must not
    // block setup.
  }
  assertAuthOperationCurrent(isCurrent)

  logLogin(user.id, { method: auditMethod }).catch(() => {})

  const { role, ownerId, employeeProfileId, employerOrgId } = await withTimeout(
    resolveUserRole(user.id),
    5000,
    { role: 'owner' as UserRole, ownerId: user.id, employeeProfileId: null, employerOrgId: null },
  )
  assertAuthOperationCurrent(isCurrent)

  set({ status: 'hydrating_user_data', user, profile, appSession: session, role, ownerId, employeeProfileId, employerOrgId })
  await bootstrapAuthenticatedUser(user.id, isCurrent)
  assertAuthOperationCurrent(isCurrent)
  set({ status: 'authenticated', tenantDataReady: true, tenantUserId: user.id })
}

// Timeout helper — prevents auth flow from hanging on slow Redis/network calls
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

type Profile = Tables<'profiles'>

// ── State shape ──────────────────────────────────────────────────────────────

export type AuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'needs_passcode_setup'
  | 'needs_passcode'
  | 'biometric_prompt'
  | 'locked'
  | 'hydrating_user_data'
  | 'authenticated'
  | 'password_recovery'

interface AuthState {
  status:         AuthStatus
  user:           User | null
  profile:        Profile | null
  appSession:     AppSession | null
  biometric:      BiometricCapabilities | null
  lockExpiresAt:  Date | null
  error:          string | null
  tenantDataReady: boolean
  tenantUserId:   string | null

  // ── Role fields (V3 Session 5 + TIME-2C employee portal) ───────────────────
  // role:    Determines which portal the user sees after auth.
  // ownerId: For crew members = the owner's user_id.
  //          For owners = their own user_id.
  //          For employees = null (employer org is employerOrgId).
  role:     UserRole
  ownerId:  string | null
  employeeProfileId: string | null
  employerOrgId:     string | null

  // Actions
  initialize:         () => Promise<void>
  signInWithEmail:    (email: string, password?: string) => Promise<void>
  signInWithMagicLink:(email: string) => Promise<void>
  submitPasscode:     (passcode: string) => Promise<void>
  setupPasscode:      (passcode: string) => Promise<void>
  completeInitialSetup: () => Promise<void>
  authenticateBio:    () => Promise<void>
  lockApp:            () => Promise<void>
  signOut:            () => Promise<void>
  skipBiometric:      () => void
  clearError:         () => void
}

// ── Auth state change listener (registered lazily to avoid Vite production TDZ) ─
// In production Rollup bundles, module-scope code that references cross-module
// bindings can hit temporal dead zone errors ("Cannot access 'X' before
// initialization") because Rollup inlines modules into chunks using let bindings.
// Moving the listener registration inside initialize() ensures all bindings are
// fully initialized before the listener is attached.
let _authListenerRegistered = false

// EMP-AUTH-1 reentrancy guard. initialize() can be called concurrently (SIGNED_IN
// listener + explicit invite/login calls). Each run captures a sequence number;
// only the newest run may commit state. This prevents a stale run that resolved
// the interim owner fallback (before the employee link existed) from overwriting
// a newer run that resolved role === 'employee'. Root cause of Josh's NDA gate.
// EMP-AUTH-1A safe-retry budget. When identity resolution is 'unresolved' (a
// lookup timed out/errored), initialize() keeps the user in a resolving state and
// schedules a bounded re-initialize instead of ever falling back to owner. The
// budget resets to 0 the moment resolveUserRole succeeds (network recovered).
let _identityRetryCount = 0
let _identityRetryTimer: ReturnType<typeof setTimeout> | null = null
const MAX_IDENTITY_RETRIES = 5

function scheduleIdentityReinit(): void {
  if (_identityRetryTimer) return // a retry is already pending
  if (_identityRetryCount >= MAX_IDENTITY_RETRIES) return // stay safe in resolving state
  _identityRetryCount++
  _identityRetryTimer = setTimeout(() => {
    _identityRetryTimer = null
    void useAuthStore.getState().initialize()
  }, 2000)
}

function registerAuthListener() {
  if (_authListenerRegistered) return
  _authListenerRegistered = true

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      const operationId = beginAuthOperation()
      // User clicked password reset link — show set new password form
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle()
        if (!isAuthOperationCurrent(operationId)) return
        useAuthStore.setState({
          status: 'password_recovery',
          user: session.user as any,
          profile: profile as any,
        })
      }
      return
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      if (event === 'SIGNED_IN') {
        void trackPilotTelemetryEvent({
          eventName: 'login_success',
          module: 'auth',
          feature: 'magic_link',
          metadata: { source: 'interactive_session_entry' },
        })
      }
      const { status } = useAuthStore.getState()
      if (status === 'unauthenticated' || status === 'loading') {
        useAuthStore.getState().initialize()
      }
      // Do NOT re-initialize if already authenticated — TOKEN_REFRESHED during
      // normal app use (e.g. after a sync push) must not trigger a re-auth cycle.
    }
    if (event === 'SIGNED_OUT') {
      beginAuthOperation()
      setHydrating(false)
      clearActiveTenantUser()
      useAuthStore.setState({
        status:          'unauthenticated',
        user:            null,
        profile:         null,
        appSession:      null,
        tenantDataReady: false,
        tenantUserId:    null,
      })
    }
  })
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>((set, get) => ({
  status:        'loading',
  user:          null,
  profile:       null,
  appSession:    null,
  biometric:     null,
  lockExpiresAt: null,
  error:         null,
  role:          'owner',
  ownerId:       null,
  employeeProfileId: null,
  employerOrgId:     null,
  tenantDataReady: false,
  tenantUserId:  null,

  // ── Initialize ─────────────────────────────────────────────────────────────
  // Called once on app mount. Determines which screen to show.
 
   initialize: async () => {
    if (isDemoRuntimeActive()) {
      setHydrating(false)
      clearActiveTenantUser()
      useAuthStore.setState({
        status: 'unauthenticated',
        user: null,
        profile: null,
        appSession: null,
        tenantDataReady: false,
        tenantUserId: null,
        error: null,
      })
      return
    }

    // Register auth state listener on first initialize (lazy — avoids TDZ in prod)
    registerAuthListener()

    // EMP-AUTH-1: capture this run's sequence; only the newest run commits state.
    // A stale run (e.g. the SIGNED_IN-triggered resolve that saw no employee link
    // yet and fell back to owner) can no longer overwrite a newer run that
    // resolved role === 'employee'. All state writes below go through apply().
    const operationId = beginAuthOperation()
    const seq = ++_initSeq
    const isCurrent = () => seq === _initSeq && isAuthOperationCurrent(operationId)
    const apply = (partial: Partial<AuthState>) => {
      if (seq === _initSeq) set(partial)
    }

    apply({ status: 'loading', error: null })

    try {
      // Safari iOS strips URL fragments on redirect — check both hash and search for tokens
      // before calling getSession() so Supabase can pick them up.
      try {
        const hash = window.location.hash?.slice(1) || ''
        const search = window.location.search?.slice(1) || ''
        const params = new URLSearchParams(hash || search)
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')
        const type = params.get('type')
        if (accessToken && refreshToken) {
          console.log('[Auth] iOS Safari fallback: found tokens in URL', { type, via: hash ? 'hash' : 'search' })
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          // If this is a password recovery redirect, flag it
          if (type === 'recovery') {
            sessionStorage.setItem('poweron_password_recovery', '1')
          }
          // Clear tokens from URL bar
          window.history.replaceState({}, document.title, window.location.pathname)
        }
      } catch (urlErr) {
        console.warn('[Auth] iOS Safari URL token fallback (non-blocking):', urlErr)
      }

      // 1. Check Supabase session (JWT)
      // If redirected from email verification, show login page
      const urlParams = new URLSearchParams(window.location.search)
      if (urlParams.get('verified') === 'true') {
        window.history.replaceState({}, document.title, window.location.pathname)
        await supabase.auth.signOut()
        apply({ status: 'unauthenticated' })
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        apply({ status: 'unauthenticated' })
        return
      }

      const user = session.user

      // 2. Load profile (the DB trigger creates it on signup, but allow a brief retry
      //    in case the trigger hasn't committed yet)
      let profile: Profile | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        // Surgical fix: Selecting only verified columns to prevent crashes
        const { data, error: profileError } = await supabase
          .from('profiles')
          .select('id, org_id, full_name, role, is_active, passcode_hash')
          .eq('id', user.id)
          .single()

        if (!profileError && data) {
          profile = data as any
          break
        }
        if (attempt < 2) await new Promise(r => setTimeout(r, 500))
      }

      if (!profile) {
        // Safety fallback if the user exists in Auth but not in Profiles
        apply({ status: 'needs_passcode_setup', user })
        return
      }
      // Check for password recovery redirect
      if (sessionStorage.getItem('poweron_password_recovery') === '1') {
        sessionStorage.removeItem('poweron_password_recovery')
        apply({ status: 'password_recovery', user, profile })
        return
      }

      if (!profile.is_active) {
        await supabase.auth.signOut()
        apply({ status: 'unauthenticated', error: 'Your account has been deactivated.' })
        return
      }

      // 3. Check app session (Redis) — did they already pass passcode this session?
      //    Timeout after 5s — if Redis is slow, assume no session and ask for passcode
      const appSession = await withTimeout(validateAppSession(), 5000, null)
      if (appSession) {
        // Re-use cached role from localStorage; re-resolve in background occasionally
        const { role, ownerId, employeeProfileId, employerOrgId } = loadRoleFromStorage(user.id)
        apply({ status: 'hydrating_user_data', user, profile, appSession, role, ownerId, employeeProfileId, employerOrgId })
        await bootstrapAuthenticatedUser(user.id, isCurrent)
        apply({ status: 'authenticated', tenantDataReady: true, tenantUserId: user.id })
        // Fire background re-verify in case crew/employee membership changed.
        // Never let an 'unresolved' (network-failed) pass overwrite the cached role.
        resolveUserRole(user.id).then((resolved) => {
          if (resolved.status === 'unresolved') return
          apply({
            role: resolved.role,
            ownerId: resolved.ownerId,
            employeeProfileId: resolved.employeeProfileId,
            employerOrgId: resolved.employerOrgId,
          })
        }).catch(() => {})
        return
      }

      // 4. If user just authenticated via password, skip PIN verification.
      // PIN is only required for lock/resume flows, not full password login.
      if (sessionStorage.getItem('poweron_password_authed') === '1') {
        const portalRole = await resolveUserRole(user.id)
        if (portalRole.status === 'unresolved') {
          // Identity unknown (network/timeout). Stay in a safe resolving state and
          // retry — never authenticate into the owner surface on a guess. The
          // password_authed flag is kept so the retry re-enters this branch.
          apply({ status: 'loading', user, profile, error: null })
          scheduleIdentityReinit()
          return
        }
        const { role, ownerId, employeeProfileId, employerOrgId } = portalRole
        let appSession = null
        try {
          await withTimeout(
            createAppSession({ userId: user.id, orgId: profile.org_id, role: profile.role, deviceInfo: getDeviceInfo() }),
            5000, 'timeout'
          )
          appSession = await withTimeout(validateAppSession(), 3000, null)
        } catch {}

        // COMM-PROD-1 Step 9 (defect B). This branch used to publish
        // 'authenticated' immediately and bootstrap in the background, so the
        // shell rendered while the backup service still had no active tenant.
        // On a brand-new organization that first render reads the empty legacy
        // key and shows the Import Backup recovery screen, and nothing re-renders
        // it once hydration lands. Hold in hydrating_user_data like every other
        // entry point; a bootstrap failure still lets the user in rather than
        // bouncing them back to the login screen.
        apply({
          status: 'hydrating_user_data',
          tenantDataReady: false,
          tenantUserId: user.id,
          user,
          profile,
          appSession,
          role,
          ownerId,
          employeeProfileId,
          employerOrgId,
          error: null,
        })

        sessionStorage.removeItem('poweron_password_authed')

        try {
          await bootstrapAuthenticatedUser(user.id, isCurrent)
          apply({ status: 'authenticated', tenantDataReady: true, tenantUserId: user.id })
        } catch (err) {
          if (err instanceof StaleAuthOperationError || !isCurrent()) return
          console.error('[Auth] bootstrapAuthenticatedUser failed:', err)
          apply({ status: 'authenticated', tenantDataReady: false, tenantUserId: user.id })
        }

        return
      }

      // 4b. Portal role gate — crew/employee/client bypass the owner PIN.
      //     The passcode/PIN flow secures the owner AppShell only. Non-owner
      //     portals (EmployeePortal, CrewPortal, ClientPortal) must never be
      //     forced through PIN setup or unlock, even though the invited user
      //     has a personal profiles row without a passcode_hash. Owners fall
      //     through to the passcode flow below unchanged.
      //     EMP-AUTH-1A: resolveUserRole is authoritative. A timeout/error yields
      //     status 'unresolved' — we must NOT convert that to owner (that was the
      //     path into Josh's PIN/NDA). Instead hold in a safe resolving state and
      //     retry; a genuine owner resolves normally and continues below.
      const portalRole = await resolveUserRole(user.id)
      if (portalRole.status === 'unresolved') {
        apply({ status: 'loading', user, profile, error: null })
        scheduleIdentityReinit()
        return
      }
      if (portalRole.role !== 'owner') {
        let roleSession = null
        try {
          await withTimeout(
            createAppSession({ userId: user.id, orgId: profile.org_id, role: profile.role, deviceInfo: getDeviceInfo() }),
            5000, 'timeout'
          )
          roleSession = await withTimeout(validateAppSession(), 3000, null)
        } catch {}
        apply({
          status: 'hydrating_user_data',
          user,
          profile,
          appSession: roleSession,
          role: portalRole.role,
          ownerId: portalRole.ownerId,
          employeeProfileId: portalRole.employeeProfileId,
          employerOrgId: portalRole.employerOrgId,
        })
        await bootstrapAuthenticatedUser(user.id, isCurrent)
        apply({ status: 'authenticated', tenantDataReady: true, tenantUserId: user.id })
        return
      }

      // 5. No passcode set at all → go to setup.
      //     EMP-AUTH-1: this is the owner-onboarding entry (PIN → AppShell → NDA).
      //     We only reach it when portalRole resolved to 'owner' above. The seq
      //     guard (apply) ensures a concurrent run that resolves 'employee' after
      //     the invite link is created supersedes this owner commit.
      if (!profile.passcode_hash) {
        apply({ status: 'needs_passcode_setup', user, profile })
        return
      }

      // 6. password_only → skip PIN verification
      if (profile.passcode_hash === 'password_only') {
        const portalRole = await resolveUserRole(user.id)
        if (portalRole.status === 'unresolved') {
          apply({ status: 'loading', user, profile, error: null })
          scheduleIdentityReinit()
          return
        }
        const { role, ownerId, employeeProfileId, employerOrgId } = portalRole
        let session = null
        try {
          session = await withTimeout(
            createAppSession({ userId: user.id, orgId: profile.org_id, role: profile.role, deviceInfo: getDeviceInfo() }),
            5000, null
          )
        } catch {}
        apply({ status: 'hydrating_user_data', user, profile, appSession: session, role, ownerId, employeeProfileId, employerOrgId })
        await bootstrapAuthenticatedUser(user.id, isCurrent)
        apply({ status: 'authenticated', tenantDataReady: true, tenantUserId: user.id })
        return
      }

      // 7. Real PIN set — check lockout then route to PIN screen
      const ps = await withTimeout(getPasscodeStatus(user.id), 5000, {
        isSet: true, isLocked: false, attemptsRemaining: 5, lockExpiresAt: null,
      })

      if (ps.isLocked) {
        apply({ status: 'locked', user, profile, lockExpiresAt: ps.lockExpiresAt })
        return
      }

      // 8. Passcode set and not locked — check biometric
      const biometric = await getBiometricCapabilities()
      if (profile.biometric_enabled && biometric.available && biometric.enrolled) {
        apply({ status: 'biometric_prompt', user, profile, biometric })
      } else {
        apply({ status: 'needs_passcode', user, profile, biometric })
      }

    } catch (err) {
      if (err instanceof StaleAuthOperationError || !isCurrent()) return
      console.error('[Auth] initialize error:', err)
      apply({
        status: 'unauthenticated',
        user: null,
        profile: null,
        appSession: null,
        tenantDataReady: false,
        tenantUserId: null,
        error: 'Failed to initialize. Please try again.',
      })
    }
  },

  // ── Email / password sign in ────────────────────────────────────────────────
  signInWithEmail: async (email: string, password?: string) => {
    beginAuthOperation()
    set({ error: null })
    try {
      const { error } = password
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signInWithOtp({ email })
      if (error) throw error
      if (password) {
        sessionStorage.setItem('poweron_password_authed', '1')
        await get().initialize()
      }
      // Magic link: status stays as-is; Supabase will handle the redirect
    } catch (err: unknown) {
      const e = err as { message?: string }
      set({ error: e.message ?? 'Sign in failed. Check your email and try again.' })
    }
  },

  // ── Magic link ─────────────────────────────────────────────────────────────
  signInWithMagicLink: async (email: string) => {
    beginAuthOperation()
    set({ error: null })
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: MAGIC_LINK_REDIRECT_URL },
      })
      if (error) throw error
    } catch (err: unknown) {
      const e = err as { message?: string }
      set({ error: e.message ?? 'Failed to send magic link.' })
    }
  },

  // ── Submit passcode ─────────────────────────────────────────────────────────
  submitPasscode: async (passcode: string) => {
    const operationId = beginAuthOperation()
    const isCurrent = () => isAuthOperationCurrent(operationId)
    const { user, profile } = get()
    console.log('[submitPasscode] called with user:', user?.id, 'profile:', profile?.id, 'passcode length:', passcode?.length)
    if (!user || !profile) {
      console.error('[submitPasscode] ABORT: no user or profile', { user: !!user, profile: !!profile })
      return
    }
    if (!isCurrent()) return
    set({ error: null })
    let ownedSessionId: string | null = null

    try {
      console.log('[submitPasscode] calling verifyPasscode for user:', user.id, 'org:', profile.org_id)
      const result = await withTimeout(
        verifyPasscode(user.id, profile.org_id, passcode),
        10000,
        { success: false as const, locked: false as const, attemptsRemaining: 5 }
      )
      assertAuthOperationCurrent(isCurrent)
      console.log('[submitPasscode] verifyPasscode result:', JSON.stringify(result))
      if (result.success) {
        // Create Redis app session (timeout 5s — don't block login)
        const createdSessionId = await withTimeout(
          createAppSession({
            userId: user.id,
            orgId:  profile.org_id,
            role:   profile.role,
            deviceInfo: getDeviceInfo(),
            isCurrent,
          }),
          5000,
          'timeout'
        )
        assertAuthOperationCurrent(isCurrent)
        if (createdSessionId !== 'timeout' && createdSessionId) {
          ownedSessionId = createdSessionId
        }

        // Fire-and-forget audit + profile update
        logLogin(user.id, { method: 'passcode' }).catch(() => {})
        supabase
          .from('profiles')
          .update({ last_login_at: new Date().toISOString() })
          .eq('id', user.id)
          .then(() => {})
          .catch(() => {})

        // Resolve portal role (owner / crew / employee)
        const { role, ownerId, employeeProfileId, employerOrgId } = await withTimeout(
          resolveUserRole(user.id),
          5000,
          { role: 'owner' as UserRole, ownerId: user.id, employeeProfileId: null, employerOrgId: null }
        )
        assertAuthOperationCurrent(isCurrent)

        const session = ownedSessionId
          ? await withTimeout(validateAppSession(ownedSessionId), 3000, null)
          : null
        assertAuthOperationCurrent(isCurrent)
        set({ status: 'hydrating_user_data', user, profile, appSession: session, role, ownerId, employeeProfileId, employerOrgId })
        await bootstrapAuthenticatedUser(user.id, isCurrent)
        assertAuthOperationCurrent(isCurrent)
        set({ status: 'authenticated', tenantDataReady: true, tenantUserId: user.id })

      } else if ('locked' in result && result.locked) {
        assertAuthOperationCurrent(isCurrent)
        set({ status: 'locked', lockExpiresAt: result.lockExpiresAt })

      } else {
        assertAuthOperationCurrent(isCurrent)
        set({
          error: 'attemptsRemaining' in result && result.attemptsRemaining === 1
            ? `Incorrect passcode. 1 attempt remaining before lockout.`
            : `Incorrect passcode. ${'attemptsRemaining' in result ? result.attemptsRemaining : '?'} attempts remaining.`,
        })
      }
    } catch (err) {
      if (err instanceof StaleAuthOperationError || !isCurrent()) return
      console.error('[Auth] submitPasscode error:', err)
      // PIN may already be valid while the subsequent tenant hydration/reconcile
      // failed. Return to the existing retryable PIN state instead of leaving the
      // user indefinitely on hydrating_user_data. Tenant cache remains untouched.
      // Invalidate the failed transition before awaiting cleanup. A timed-out
      // createAppSession call will observe this and cannot later claim storage.
      const failureOperationId = beginAuthOperation()
      try {
        if (ownedSessionId) await destroyAppSession(ownedSessionId)
      } catch { /* retry remains available */ }
      if (!isAuthOperationCurrent(failureOperationId)) return
      clearActiveTenantUser()
      set({
        status: 'needs_passcode',
        appSession: null,
        tenantDataReady: false,
        tenantUserId: null,
        error: 'Workspace refresh failed. Check your connection and enter your PIN to retry.',
      })
    }
  },

  // ── Set up passcode (onboarding) ────────────────────────────────────────────
  setupPasscode: async (passcode: string) => {
    beginAuthOperation()
    const { user, profile } = get()
    if (!user) return

    set({ error: null })

    try {
      // 1. Hash and store the passcode (timeout 10s for PBKDF2 + Supabase write)
      const result = await withTimeout(
        setPasscode(user.id, passcode),
        10000,
        { success: false as const, error: 'Passcode save timed out. Please try again.' }
      )
      if (!result.success) {
        set({ error: result.error })
        return
      }

      // 2. Seed project templates (fire-and-forget — don't block login on this)
      if (profile) {
        supabase.rpc('seed_project_templates_for_org', { p_org_id: profile.org_id })
          .then(() => {})
          .catch((e: unknown) => console.warn('[Auth] seed templates failed (non-blocking):', e))
      }

      // 3. Reload profile (passcode_hash now set) — timeout 5s
      const { data: refreshedProfile } = await withTimeout(
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        5000,
        { data: profile, error: null }
      )

      // 4. Check biometric (should be instant in browser, timeout 3s as safety)
      const biometric = await withTimeout(getBiometricCapabilities(), 3000, {
        available: false, enrolled: false, biometryType: 'none' as const, platformLabel: 'Not available',
      })

      if (biometric.available) {
        set({ status: 'biometric_prompt', profile: refreshedProfile, biometric })
      } else {
        // 5. App session + role + tenant bootstrap, then authenticated.
        await establishOwnerSession(set, user, (refreshedProfile ?? profile) as Profile | null, 'passcode_setup')
      }

    } catch (err) {
      console.error('[Auth] setupPasscode error:', err)
      set({ error: 'Failed to save passcode. Please try again.' })
    }
  },

  // ── Complete first-run setup (onboarding) ───────────────────────────────────
  // COMM-PROD-1 Step 9. InitialSetupFlow owns the first-run screens and has
  // already confirmed the passcode server-side by the time this runs. It used to
  // finish by writing status: 'authenticated' straight into the store, which
  // skipped app-session creation, role resolution and tenant bootstrap entirely.
  // A brand-new contractor therefore reached the shell with no active tenant
  // (Import Backup screen) and no resumable session (PIN setup again on reload).
  // This action runs the same authenticated tail as every other owner entry.
  completeInitialSetup: async () => {
    const operationId = beginAuthOperation()
    const isCurrent = () => isAuthOperationCurrent(operationId)
    const { user } = get()
    if (!user) return

    set({ error: null })

    try {
      // Re-read the profile so the store carries the same server-confirmed
      // passcode/org state that the next reload's initialize() will read.
      const { data: refreshed } = await withTimeout(
        supabase
          .from('profiles')
          .select('id, org_id, full_name, role, is_active, passcode_hash')
          .eq('id', user.id)
          .maybeSingle(),
        5000,
        { data: null, error: null } as any,
      )
      assertAuthOperationCurrent(isCurrent)

      const profile = (refreshed as Profile | null) ?? get().profile

      // Seed project templates for the new org (non-blocking).
      if (profile?.org_id) {
        supabase.rpc('seed_project_templates_for_org', { p_org_id: profile.org_id })
          .then(() => {})
          .catch((e: unknown) => console.warn('[Auth] seed templates failed (non-blocking):', e))
      }

      await establishOwnerSession(set, user, profile, 'initial_setup', isCurrent)
    } catch (err) {
      if (err instanceof StaleAuthOperationError || !isCurrent()) return
      console.error('[Auth] completeInitialSetup error:', err)
      // The passcode itself is already stored server-side, so the retryable PIN
      // screen is the correct recovery — never a half-authenticated shell.
      clearActiveTenantUser()
      set({
        status: 'needs_passcode',
        appSession: null,
        tenantDataReady: false,
        tenantUserId: null,
        error: 'Workspace setup could not finish. Check your connection and enter your PIN to continue.',
      })
    }
  },

  // ── Biometric auth ──────────────────────────────────────────────────────────
  authenticateBio: async () => {
    beginAuthOperation()
    const { user, profile } = get()
    if (!user || !profile) return

    set({ error: null })

    try {
      const result = await authenticateWithBiometric()

      if (result.success) {
        const appSession = await createAppSession({
          userId: user.id,
          orgId:  profile.org_id,
          role:   profile.role,
          deviceInfo: getDeviceInfo(),
        })
        await logLogin(user.id, { method: 'biometric' })
        await supabase
          .from('profiles')
          .update({ last_login_at: new Date().toISOString() })
          .eq('id', user.id)
        // Resolve role after biometric auth
        const { role, ownerId, employeeProfileId, employerOrgId } = await withTimeout(
          resolveUserRole(user.id),
          5000,
          { role: 'owner' as UserRole, ownerId: user.id, employeeProfileId: null, employerOrgId: null }
        )
        set({ status: 'hydrating_user_data', user, profile, appSession: await validateAppSession(), role, ownerId, employeeProfileId, employerOrgId })
        await bootstrapAuthenticatedUser(user.id)
        set({ status: 'authenticated', tenantDataReady: true, tenantUserId: user.id })

      } else if (result.reason === 'cancelled') {
        // User chose to use passcode instead
        set({ status: 'needs_passcode' })

      } else {
        set({ error: 'Biometric failed. Use your passcode instead.' })
      }
    } catch (err) {
      console.error('[Auth] authenticateBio error:', err)
      set({ status: 'needs_passcode', error: 'Biometric unavailable. Use your passcode.' })
    }
  },

  // ── Skip biometric (use passcode instead) ───────────────────────────────────
  skipBiometric: () => {
    beginAuthOperation()
    set({ status: 'needs_passcode', error: null })
  },

  // ── Sign out ────────────────────────────────────────────────────────────────
  // ── Lock App ──────────────────────────────────────────────────────────────
  // Clears the Redis session but keeps the Supabase JWT. 
  // This triggers the PIN screen while keeping user identity known.
  lockApp: async () => {
    beginAuthOperation()
    const { user } = get()
    if (user) {
      // Robust logging: if the audit trail fails, we still lock the app
      try {
        await logAction({ 
          agentName: 'SYSTEM', 
          actionType: 'lock', 
          target: `profiles:${user.id}`, 
          approvalStatus: 'n/a', 
          approvalPhrase: null, 
          userId: user.id, 
          beforeState: { status: get().status }, 
          afterState: { status: 'needs_passcode' }, 
          verificationResult: null 
        })
      } catch (e) {
        console.warn('[Auth] Audit logging failed, proceeding with lock:', e)
      }
    }
    await destroyAppSession()
    set({ status: 'needs_passcode', appSession: null })
  },

  // ── Sign out ────────────────────────────────────────────────────────────────
  // The "Hard Reset" for account switching. Wipes the JWT and all state.
  signOut: async () => {
    // Invalidate first: no older PIN continuation may resume during audit/session cleanup.
    beginAuthOperation()
    setHydrating(false)
    clearActiveTenantUser()
    const { user } = get()
    if (user) {
      try {
        await logAction({ 
          agentName: 'SYSTEM', 
          actionType: 'logout', 
          target: `profiles:${user.id}`, 
          approvalStatus: 'n/a', 
          approvalPhrase: null, 
          userId: user.id, 
          beforeState: null, 
          afterState: null, 
          verificationResult: null 
        })
      } catch (e) {
        console.warn('[Auth] Audit logging failed, proceeding with logout:', e)
      }
    }
    await destroyAppSession()
    await supabase.auth.signOut()
    localStorage.removeItem(ROLE_STORAGE_KEY)
    localStorage.removeItem(OWNER_ID_STORAGE_KEY)
    localStorage.removeItem(EMPLOYEE_PROFILE_ID_KEY)
    localStorage.removeItem(EMPLOYER_ORG_ID_KEY)
    localStorage.removeItem('poweron_alerts_cache')
    localStorage.removeItem('poweron_v2')
    const snapshotsCleared = await clearLocalSnapshots()
    if (snapshotsCleared) clearCacheOwner()
    else console.warn('[Auth] Snapshot cleanup pending; previous cache owner retained')
    set({
      status:          'unauthenticated',
      user:            null,
      profile:         null,
      appSession:      null,
      biometric:       null,
      lockExpiresAt:   null,
      error:           null,
      role:            'owner',
      ownerId:         null,
      employeeProfileId: null,
      employerOrgId:     null,
      tenantDataReady: false,
      tenantUserId:    null,
    })
  },

  clearError: () => set({ error: null }),
}))

// Expose to window for console debugging/testing
if (typeof window !== 'undefined') {
  (window as any).useAuthStore = useAuthStore
}

// ── Auth state change listener is registered lazily via registerAuthListener()
// Called on first initialize() to avoid Vite production TDZ issues.
// See comment above the registerAuthListener function for details.
