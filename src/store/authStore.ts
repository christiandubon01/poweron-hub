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

// ── Role system ───────────────────────────────────────────────────────────────
// owner   → the business owner; sees the full app (V15rLayout + all panels)
// crew    → a field crew member; sees only CrewPortal (simplified field log UI)
// client  → a client; sees ClientPortal (read-only project status — future)
export type UserRole = 'owner' | 'crew' | 'client'

const ROLE_STORAGE_KEY = 'poweron-hub-role'
const OWNER_ID_STORAGE_KEY = 'poweron-hub-owner-id'

/**
 * Determine the user's role by checking the crew_members table.
 * If a matching active row with user_id = auth.uid() exists → crew.
 * Otherwise → owner.
 * Stores result in localStorage for fast re-load.
 */
async function resolveUserRole(userId: string): Promise<{ role: UserRole; ownerId: string | null }> {
  try {
    const { data, error } = await supabase
      .from('crew_members')
      .select('owner_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle()

    if (!error && data) {
      const role: UserRole = 'crew'
      const ownerId = data.owner_id ?? null
      localStorage.setItem(ROLE_STORAGE_KEY, role)
      localStorage.setItem(OWNER_ID_STORAGE_KEY, ownerId ?? '')
      return { role, ownerId }
    }
  } catch (e) {
    console.warn('[Auth] resolveUserRole: crew check failed (non-blocking):', e)
  }

  // Default: owner
  localStorage.setItem(ROLE_STORAGE_KEY, 'owner')
  localStorage.setItem(OWNER_ID_STORAGE_KEY, userId)
  return { role: 'owner', ownerId: userId }
}

/** Fast load from localStorage — used when app session already valid. */
function loadRoleFromStorage(userId: string): { role: UserRole; ownerId: string | null } {
  const role = (localStorage.getItem(ROLE_STORAGE_KEY) ?? 'owner') as UserRole
  const ownerId = localStorage.getItem(OWNER_ID_STORAGE_KEY) || userId
  return { role, ownerId }
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
  | 'authenticated'

interface AuthState {
  status:         AuthStatus
  user:           User | null
  profile:        Profile | null
  appSession:     AppSession | null
  biometric:      BiometricCapabilities | null
  lockExpiresAt:  Date | null
  error:          string | null

  // ── Role fields (V3 Session 5) ────────────────────────────────────────────
  // role:    Determines which portal the user sees after auth.
  // ownerId: For crew members = the owner's user_id.
  //          For owners = their own user_id.
  role:     UserRole
  ownerId:  string | null

  // Actions
  initialize:         () => Promise<void>
  signInWithEmail:    (email: string, password?: string) => Promise<void>
  signInWithMagicLink:(email: string) => Promise<void>
  submitPasscode:     (passcode: string) => Promise<void>
  setupPasscode:      (passcode: string) => Promise<void>
  authenticateBio:    () => Promise<void>
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

function registerAuthListener() {
  if (_authListenerRegistered) return
  _authListenerRegistered = true

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      const { status } = useAuthStore.getState()
      if (status === 'unauthenticated') {
        useAuthStore.getState().initialize()
      }
    }
    if (event === 'SIGNED_OUT') {
      useAuthStore.setState({
        status:    'unauthenticated',
        user:      null,
        profile:   null,
        appSession: null,
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

  // ── Initialize ─────────────────────────────────────────────────────────────
  // Called once on app mount. Determines which screen to show.
  initialize: async () => {
    // Register auth state listener on first initialize (lazy — avoids TDZ in prod)
    registerAuthListener()

    set({ status: 'loading', error: null })

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
          // Clear tokens from URL bar
          window.history.replaceState({}, document.title, window.location.pathname)
        }
      } catch (urlErr) {
        console.warn('[Auth] iOS Safari URL token fallback (non-blocking):', urlErr)
      }

      // 1. Check Supabase session (JWT)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        set({ status: 'unauthenticated' })
        return
      }

      const user = session.user

      // 2. Load profile (the DB trigger creates it on signup, but allow a brief retry
      //    in case the trigger hasn't committed yet)
      let profile: Profile | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()

        if (!profileError && data) {
          profile = data
          break
        }
        // Wait 500ms before retry (trigger may still be committing)
        if (attempt < 2) await new Promise(r => setTimeout(r, 500))
      }

      if (!profile) {
        // Profile still missing after retries — route to passcode setup anyway
        // (setupPasscode will handle the missing profile gracefully)
        set({ status: 'needs_passcode_setup', user })
        return
      }

      if (!profile.is_active) {
        await supabase.auth.signOut()
        set({ status: 'unauthenticated', error: 'Your account has been deactivated.' })
        return
      }

      // 3. Check app session (Redis) — did they already pass passcode this session?
      //    Timeout after 5s — if Redis is slow, assume no session and ask for passcode
      const appSession = await withTimeout(validateAppSession(), 5000, null)
      if (appSession) {
        // Re-use cached role from localStorage; re-resolve in background occasionally
        const { role, ownerId } = loadRoleFromStorage(user.id)
        set({ status: 'authenticated', user, profile, appSession, role, ownerId })
        // Fire background re-verify in case crew membership changed
        resolveUserRole(user.id).then(({ role: r, ownerId: o }) => {
          set({ role: r, ownerId: o })
        }).catch(() => {})
        return
      }

      // 4. Check passcode status (has its own internal timeouts, but cap the whole call at 8s)
      const ps = await withTimeout(getPasscodeStatus(user.id), 8000, {
        isSet: !!profile.passcode_hash,
        isLocked: false,
        attemptsRemaining: 5,
        lockExpiresAt: null,
      })

      if (!ps.isSet) {
        set({ status: 'needs_passcode_setup', user, profile })
        return
      }

      if (ps.isLocked) {
        set({ status: 'locked', user, profile, lockExpiresAt: ps.lockExpiresAt })
        return
      }

      // 5. Passcode is set and not locked — check biometric
      const biometric = await getBiometricCapabilities()
      if (profile.biometric_enabled && biometric.available && biometric.enrolled) {
        set({ status: 'biometric_prompt', user, profile, biometric })
      } else {
        set({ status: 'needs_passcode', user, profile, biometric })
      }

    } catch (err) {
      console.error('[Auth] initialize error:', err)
      set({ status: 'unauthenticated', error: 'Failed to initialize. Please try again.' })
    }
  },

  // ── Email / password sign in ────────────────────────────────────────────────
  signInWithEmail: async (email: string, password?: string) => {
    set({ error: null })
    try {
      const { error } = password
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signInWithOtp({ email })

      if (error) throw error

      if (password) {
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
    set({ error: null })
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) throw error
    } catch (err: unknown) {
      const e = err as { message?: string }
      set({ error: e.message ?? 'Failed to send magic link.' })
    }
  },

  // ── Submit passcode ─────────────────────────────────────────────────────────
  submitPasscode: async (passcode: string) => {
    const { user, profile } = get()
    if (!user || !profile) return

    set({ error: null })

    try {
      const result = await withTimeout(
        verifyPasscode(user.id, profile.org_id, passcode),
        10000,
        { success: false as const, locked: false as const, attemptsRemaining: 5 }
      )

      if (result.success) {
        // Create Redis app session (timeout 5s — don't block login)
        await withTimeout(
          createAppSession({
            userId: user.id,
            orgId:  profile.org_id,
            role:   profile.role,
            deviceInfo: getDeviceInfo(),
          }),
          5000,
          'timeout'
        )

        // Fire-and-forget audit + profile update
        logLogin(user.id, { method: 'passcode' }).catch(() => {})
        supabase
          .from('profiles')
          .update({ last_login_at: new Date().toISOString() })
          .eq('id', user.id)
          .then(() => {})
          .catch(() => {})

        // Resolve role (owner vs crew) — determines which portal to show
        const { role, ownerId } = await withTimeout(
          resolveUserRole(user.id),
          5000,
          { role: 'owner' as UserRole, ownerId: user.id }
        )

        const session = await withTimeout(validateAppSession(), 3000, null)
        set({ status: 'authenticated', appSession: session, role, ownerId })

      } else if ('locked' in result && result.locked) {
        set({ status: 'locked', lockExpiresAt: result.lockExpiresAt })

      } else {
        set({
          error: 'attemptsRemaining' in result && result.attemptsRemaining === 1
            ? `Incorrect passcode. 1 attempt remaining before lockout.`
            : `Incorrect passcode. ${'attemptsRemaining' in result ? result.attemptsRemaining : '?'} attempts remaining.`,
        })
      }
    } catch (err) {
      console.error('[Auth] submitPasscode error:', err)
      set({ error: 'Verification failed. Please try again.' })
    }
  },

  // ── Set up passcode (onboarding) ────────────────────────────────────────────
  setupPasscode: async (passcode: string) => {
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
        // 5. Create app session (Redis write — timeout 5s, fall through on failure)
        const orgId   = (refreshedProfile ?? profile)!.org_id
        const profRole = (refreshedProfile ?? profile)!.role
        await withTimeout(
          createAppSession({ userId: user.id, orgId, role: profRole, deviceInfo: getDeviceInfo() }),
          5000,
          'timeout'
        )
        // Fire-and-forget audit
        logLogin(user.id, { method: 'passcode_setup' }).catch(() => {})

        // Resolve portal role (owner vs crew)
        const { role: userRole, ownerId } = await withTimeout(
          resolveUserRole(user.id),
          5000,
          { role: 'owner' as UserRole, ownerId: user.id }
        )

        const session = await withTimeout(validateAppSession(), 3000, null)
        set({ status: 'authenticated', profile: refreshedProfile, appSession: session, role: userRole, ownerId })
      }

    } catch (err) {
      console.error('[Auth] setupPasscode error:', err)
      set({ error: 'Failed to save passcode. Please try again.' })
    }
  },

  // ── Biometric auth ──────────────────────────────────────────────────────────
  authenticateBio: async () => {
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
        const { role, ownerId } = await withTimeout(
          resolveUserRole(user.id),
          5000,
          { role: 'owner' as UserRole, ownerId: user.id }
        )
        set({ status: 'authenticated', appSession: await validateAppSession(), role, ownerId })

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
    set({ status: 'needs_passcode', error: null })
  },

  // ── Sign out ────────────────────────────────────────────────────────────────
  signOut: async () => {
    const { user } = get()
    if (user) {
      await logAudit({ action: 'logout', entity_type: 'profiles', entity_id: user.id })
    }
    await destroyAppSession()
    await supabase.auth.signOut()
    // Clear role from localStorage on sign-out
    localStorage.removeItem(ROLE_STORAGE_KEY)
    localStorage.removeItem(OWNER_ID_STORAGE_KEY)
    set({
      status:        'unauthenticated',
      user:          null,
      profile:       null,
      appSession:    null,
      biometric:     null,
      lockExpiresAt: null,
      error:         null,
      role:          'owner',
      ownerId:       null,
    })
  },

  clearError: () => set({ error: null }),
}))

// ── Auth state change listener is registered lazily via registerAuthListener()
// Called on first initialize() to avoid Vite production TDZ issues.
// See comment above the registerAuthListener function for details.
