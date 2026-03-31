/**
 * App.tsx — Root component.
 *
 * Responsibilities:
 *   1. Wrap everything in BrowserRouter for react-router-dom
 *   2. Route /invite/:token → InviteAccept (no auth required)
 *   3. Route /* → LoginFlow (auth gate)
 *   4. After auth, render portal based on role:
 *        owner  → existing <AppShell /> (V15rLayout + all panels)
 *        crew   → <CrewPortal /> (simplified mobile field log UI)
 *        client → <ClientPortal /> (future stub — shows placeholder)
 *
 * V3 Session 5: role-based routing added.
 */

import React, { useEffect, Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { LoginFlow } from '@/components/auth/LoginFlow'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useAuthStore } from '@/store/authStore'
import { useAuth } from '@/hooks/useAuth'

// Lazy-loaded portals — don't import at module scope to avoid TDZ issues
const CrewPortal = lazy(() =>
  import('@/components/crew/CrewPortal').then(m => ({ default: m.CrewPortal }))
)
const InviteAccept = lazy(() =>
  import('@/components/crew/InviteAccept').then(m => ({ default: m.InviteAccept }))
)

// ── Spinner (shared loading state) ────────────────────────────────────────────
function FullPageSpinner() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 gap-4">
      <div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}


// ── ClientPortal stub ─────────────────────────────────────────────────────────
function ClientPortal() {
  const { signOut } = useAuth()
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 px-6 text-center">
      <h1 className="text-xl font-bold text-gray-900 mb-2">Client Portal</h1>
      <p className="text-sm text-gray-500 mb-8">
        The client portal is coming soon. Your project status will be visible here.
      </p>
      <button
        onClick={() => signOut()}
        className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
      >
        Sign out
      </button>
    </div>
  )
}


// ── AuthenticatedRoot — renders the correct portal based on role ───────────────
function AuthenticatedRoot() {
  const { role } = useAuth()

  switch (role) {
    case 'crew':
      return (
        <Suspense fallback={<FullPageSpinner />}>
          <CrewPortal />
        </Suspense>
      )

    case 'client':
      return <ClientPortal />

    case 'owner':
    default:
      return <AppShell />
  }
}


// ── App (root) ────────────────────────────────────────────────────────────────

export default function App() {
  const initialize = useAuthStore(s => s.initialize)

  // Boot the auth state machine on app mount
  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          {/* Invite accept route — no auth required, crew member claims invite */}
          <Route
            path="/invite/:token"
            element={
              <Suspense fallback={<FullPageSpinner />}>
                <InviteAccept />
              </Suspense>
            }
          />

          {/* All other routes — auth-gated */}
          <Route
            path="/*"
            element={
              <LoginFlow>
                {/* LoginFlow renders children only when status === 'authenticated' */}
                <AuthenticatedRoot />
              </LoginFlow>
            }
          />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
