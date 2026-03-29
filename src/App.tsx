/**
 * App.tsx — Root component.
 *
 * Responsibilities:
 *   1. Initialize auth state on mount
 *   2. Wrap everything in LoginFlow (auth gate)
 *   3. Render AppShell for authenticated users
 *
 * Phase 01: AppShell shows a "Foundation Complete" status dashboard.
 * Phase 02: react-router routes will be added here for each agent view.
 */

// ── Eruda Mobile Debugger ──────────────────────────────────────────────────
// Inject Eruda mobile dev tools when ?debug=1 is in the URL.
// Loads from CDN, initializes after script loads. No-op in production.
if (typeof window !== 'undefined' && window.location.search.includes('debug=1')) {
  const script = document.createElement('script')
  script.src = 'https://cdn.jsdelivr.net/npm/eruda'
  script.onload = () => (window as any).eruda?.init()
  document.head.appendChild(script)
}

import { useEffect } from 'react'
import { LoginFlow } from '@/components/auth/LoginFlow'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useAuthStore } from '@/store/authStore'

export default function App() {
  const initialize = useAuthStore(s => s.initialize)

  // Boot the auth state machine on app mount
  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <ErrorBoundary>
      <LoginFlow>
        {/* LoginFlow only renders children when status === 'authenticated' */}
        <AppShell />
      </LoginFlow>
    </ErrorBoundary>
  )
}
