/**
 * useAuth — convenience hook for consuming auth state.
 *
 * Wraps useAuthStore with derived helpers so components don't need to
 * import both the store and compute boolean flags themselves.
 */

import { useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import type { AuthStatus } from '@/store/authStore'

export function useAuth() {
  const store = useAuthStore()

  return {
    // ── State ─────────────────────────────────────────────────────────────
    status:        store.status,
    user:          store.user,
    profile:       store.profile,
    appSession:    store.appSession,
    biometric:     store.biometric,
    lockExpiresAt: store.lockExpiresAt,
    error:         store.error,

    // ── Derived booleans ──────────────────────────────────────────────────
    isLoading:        store.status === 'loading',
    isAuthenticated:  store.status === 'authenticated',
    isLocked:         store.status === 'locked',
    needsPasscode:    store.status === 'needs_passcode',
    needsSetup:       store.status === 'needs_passcode_setup',
    showBiometric:    store.status === 'biometric_prompt',

    // ── Role helpers ──────────────────────────────────────────────────────
    isOwner:   store.profile?.role === 'owner',
    isAdmin:   store.profile?.role === 'admin' || store.profile?.role === 'owner',
    isField:   store.profile?.role === 'field',
    canViewFinancials: ['owner', 'admin'].includes(store.profile?.role ?? ''),

    // ── Actions ───────────────────────────────────────────────────────────
    initialize:         store.initialize,
    signInWithEmail:    store.signInWithEmail,
    signInWithMagicLink: store.signInWithMagicLink,
    submitPasscode:     store.submitPasscode,
    setupPasscode:      store.setupPasscode,
    authenticateBio:    store.authenticateBio,
    skipBiometric:      store.skipBiometric,
    signOut:            store.signOut,
    clearError:         store.clearError,
  }
}

/**
 * useAuthInit — call once at the app root to kick off the auth check.
 */
export function useAuthInit() {
  const initialize = useAuthStore(s => s.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])
}

/**
 * Redirect guard — returns true if the current status is a terminal state
 * that should show a specific screen.
 */
export function useAuthScreen(): {
  screen: AuthStatus
  isReady: boolean
} {
  const status = useAuthStore(s => s.status)
  return {
    screen:  status,
    isReady: status !== 'loading',
  }
}
