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
import { useDemoStore, DemoProvider, INDUSTRY_LABELS } from '@/store/demoStore'
import { ModeProvider } from '@/store/modeContext'
import { useDemoLimits } from '@/hooks/useDemoLimits'

// Lazy-loaded portals — don't import at module scope to avoid TDZ issues
// Chunk-retry: reloads page if a stale chunk hash causes an import failure after deployment
const CrewPortal = lazy(() =>
  import('@/components/crew/CrewPortal')
    .then(m => ({ default: m.CrewPortal }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .catch((): any => { window.location.reload(); return { default: () => null } })
)

// INT-1 — Customer Portal: public-facing route at /portal (no auth required)
const CustomerPortalPage = lazy(() =>
  import('@/views/CustomerPortalView')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .catch((): any => { window.location.reload(); return { default: () => null } })
)
const InviteAccept = lazy(() =>
  import('@/components/crew/InviteAccept')
    .then(m => ({ default: m.InviteAccept }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .catch((): any => { window.location.reload(); return { default: () => null } })
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
  const { isDemoMode, currentIndustry, getDemoCompanyName } = useDemoStore()
  if (!isDemoMode) return null
  const companyName = getDemoCompanyName()
  const industryLabel = INDUSTRY_LABELS[currentIndustry] ?? currentIndustry ?? 'Electrical'
  return (
    <div
      style={{
        position: 'fixed',
        top: '64px',   /* sits below the 64px (h-16) header bar — must not cover hamburger */
        left: 0,
        right: 0,
        zIndex: 40,    /* below nav z-50; max banner z-index per layout spec */
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
      ⚠ DEMO MODE — {companyName} ({industryLabel})
    </div>
  )
}


// ── DemoTierGate — enforces demo access rules for invited beta users ───────────
//
// Non-blocking banner when projectsRemaining === 0:
//   Shows at top of Projects page with contact button. (Banner injected here
//   so it's visible app-wide — component gates itself to demo users only.)
//
// Full-screen overlay when demo is expired:
//   Replaces app content entirely with a message + contact button.
//
// Renders nothing for non-demo users (isLoading guard avoids flash).

const CONTACT_WHATSAPP = 'https://wa.me/17603399888?text=Hi%20Christian%2C%20I%27d%20like%20to%20learn%20about%20full%20access%20to%20Power%20On%20Hub.'
const CONTACT_EMAIL    = 'mailto:swatish.3103@gmail.com?subject=Power%20On%20Hub%20Full%20Access'

function DemoTierGate({ children }: { children: React.ReactNode }) {
  const { isDemoUser, projectsRemaining, isExpired, daysRemaining, isLoading } = useDemoLimits()

  // Don't gate non-demo users or while loading
  if (!isDemoUser || isLoading) return <>{children}</>

  // ── Full-screen expiry message ─────────────────────────────────────────────
  if (isExpired) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f1117',
          padding: '32px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚡</div>
        <h1 style={{ color: '#f3f4f6', fontSize: '24px', fontWeight: 700, marginBottom: '12px' }}>
          Your demo access has expired.
        </h1>
        <p style={{ color: '#9ca3af', fontSize: '15px', maxWidth: '380px', lineHeight: 1.6, marginBottom: '32px' }}>
          Reach out to learn about full access to Power On Hub for your business.
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <a
            href={CONTACT_WHATSAPP}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 24px',
              borderRadius: '12px',
              backgroundColor: '#16a34a',
              color: '#fff',
              fontWeight: 700,
              fontSize: '14px',
              textDecoration: 'none',
            }}
          >
            💬 WhatsApp Christian
          </a>
          <a
            href={CONTACT_EMAIL}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 24px',
              borderRadius: '12px',
              backgroundColor: '#374151',
              color: '#d1d5db',
              fontWeight: 600,
              fontSize: '14px',
              textDecoration: 'none',
            }}
          >
            ✉ Send Email
          </a>
        </div>
      </div>
    )
  }

  // ── Non-blocking project limit banner ──────────────────────────────────────
  // Shown at top of app when demo user has used all project slots.
  // Does NOT block app usage — just a floating notice.
  const showLimitBanner = projectsRemaining === 0

  return (
    <>
      {showLimitBanner && (
        <div
          style={{
            position: 'fixed',
            top: '64px',
            left: 0,
            right: 0,
            zIndex: 41,
            backgroundColor: '#1d4ed8',
            color: '#eff6ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: 600,
            flexWrap: 'wrap',
            textAlign: 'center',
          }}
        >
          <span>You've reached your demo project limit. Contact Christian to upgrade your access.</span>
          <a
            href={CONTACT_WHATSAPP}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: '4px 14px',
              borderRadius: '8px',
              backgroundColor: '#16a34a',
              color: '#fff',
              textDecoration: 'none',
              fontSize: '12px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            💬 WhatsApp
          </a>
        </div>
      )}
      {/* Days remaining hint — subtle, shown only when > 0 days left */}
      {!showLimitBanner && daysRemaining <= 5 && daysRemaining > 0 && (
        <div
          style={{
            position: 'fixed',
            top: '64px',
            left: 0,
            right: 0,
            zIndex: 41,
            backgroundColor: '#92400e',
            color: '#fef3c7',
            textAlign: 'center',
            padding: '6px 16px',
            fontSize: '12px',
            fontWeight: 600,
            pointerEvents: 'none',
          }}
        >
          ⏳ Your demo access expires in {daysRemaining} day{daysRemaining !== 1 ? 's' : ''}.
        </div>
      )}
      {children}
    </>
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

          {/* INT-1: Customer Portal — public route, no auth required */}
          <Route
            path="/portal"
            element={
              <Suspense fallback={<FullPageSpinner />}>
                <CustomerPortalPage />
              </Suspense>
            }
          />
          <Route
            path="/request"
            element={
              <Suspense fallback={<FullPageSpinner />}>
                <CustomerPortalPage />
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
                    {/* DemoTierGate enforces project limits and expiry for beta demo users */}
                    <DemoTierGate>
                      <AuthenticatedRoot />
                    </DemoTierGate>
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
