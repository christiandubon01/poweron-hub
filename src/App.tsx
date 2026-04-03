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

import React, { useEffect, useState, Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { LoginFlow } from '@/components/auth/LoginFlow'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useAuthStore } from '@/store/authStore'
import { useAuth } from '@/hooks/useAuth'
import { ReadOnlyContext } from '@/contexts/ReadOnlyContext'
import { supabase } from '@/lib/supabase'
import { useDemoStore, DemoProvider } from '@/store/demoStore'
import { ModeProvider } from '@/store/modeContext'

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


// ── AuditGate — checks for ?audit=TOKEN in URL ────────────────────────────────
// If a valid audit token is found in the URL, bypasses the normal auth flow
// and renders the app in READ_ONLY mode (no passcode required).

type AuditStatus = 'idle' | 'checking' | 'valid' | 'invalid'

function AuditGate({ children }: { children: React.ReactNode }) {
  const [auditStatus, setAuditStatus] = useState<AuditStatus>('idle')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('audit')
    if (!token) return

    setAuditStatus('checking')

    // Validate token against Supabase profiles table (anon key read)
    Promise.resolve(
      supabase
        .from('profiles')
        .select('id')
        .eq('audit_token' as never, token)
        .eq('audit_access_enabled' as never, true)
        .maybeSingle()
    ).then(({ data, error }) => {
        if (!error && data) {
          setAuditStatus('valid')
        } else {
          // Token invalid or access disabled — fall through to normal auth
          setAuditStatus('invalid')
        }
      })
      .catch(() => {
        setAuditStatus('invalid')
      })
  }, [])

  if (auditStatus === 'checking') {
    return <FullPageSpinner />
  }

  if (auditStatus === 'valid') {
    // Valid audit token: bypass auth, render app in read-only mode
    return (
      <ReadOnlyContext.Provider value={{ isReadOnly: true }}>
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
      </ReadOnlyContext.Provider>
    )
  }

  // Normal auth flow (idle or invalid token)
  return <>{children}</>
}


// ── DemoGate — checks for ?demo=true in URL ───────────────────────────────────
// If ?demo=true is present, bypasses the normal auth/passcode flow entirely
// and renders AppShell in demo mode with the amber banner.
// Demo mode state is stored in localStorage via demoStore so it survives the
// render, but the URL param is the trigger that activates it before any pin gate.

function DemoGate({ children }: { children: React.ReactNode }) {
  // Evaluate ?demo=true synchronously so it is stable on first render.
  // We also call enableDemoMode() inside the lazy initializer so the
  // demoStore flag is set before AppShell's first paint — no amber-banner flash.
  const [isDemoUrl] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search)
    const isDemoParam = params.get('demo') === 'true'
    if (isDemoParam) {
      // Synchronously enable demo mode so AppShell sees isDemoMode=true on
      // its very first render (avoids a brief flash where the banner is missing).
      useDemoStore.getState().enableDemoMode()
    }
    return isDemoParam
  })

  if (isDemoUrl) {
    // Skip all auth — render AppShell directly. The amber demo banner is
    // rendered inside AppShell when isDemoMode is true in demoStore.
    return (
      <ErrorBoundary>
        <AppShell />
      </ErrorBoundary>
    )
  }

  // Not a demo URL — normal auth flow
  return <>{children}</>
}


// ── DemoModeBanner — full-width banner above nav when demo is active ───────────
// Rendered inside BrowserRouter so it can use hooks.
// Background: #ca8a04 (Tailwind yellow-700), white text, no close button.

function DemoModeBanner() {
  const { isDemoMode } = useDemoStore()
  if (!isDemoMode) return null
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10000,
        backgroundColor: '#ca8a04',
        color: '#fff',
        textAlign: 'center',
        padding: '7px 16px',
        fontWeight: 700,
        fontSize: '12px',
        letterSpacing: '0.05em',
        pointerEvents: 'none',
      }}
    >
      ⚠ DEMO MODE ACTIVE — Data shown is not real
    </div>
  )
}


// ── App (root) ────────────────────────────────────────────────────────────────

export default function App() {
  const initialize = useAuthStore(s => s.initialize)

  // Boot the auth state machine on app mount
  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <ModeProvider>
    <DemoProvider>
    <BrowserRouter>
      {/* Demo Mode banner — full-width, above nav, no close button */}
      <DemoModeBanner />
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

          {/* All other routes — audit gate + demo gate + auth-gated */}
          <Route
            path="/*"
            element={
              <AuditGate>
                {/* DemoGate: if ?demo=true, bypass LoginFlow and render AppShell
                    directly in demo mode — no passcode required */}
                <DemoGate>
                  <LoginFlow>
                    {/* LoginFlow renders children only when status === 'authenticated' */}
                    <AuthenticatedRoot />
                  </LoginFlow>
                </DemoGate>
              </AuditGate>
            }
          />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
    </DemoProvider>
    </ModeProvider>
  )
}
