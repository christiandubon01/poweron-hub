/**
 * EmployeeLogin — dedicated employee-portal sign-in page.
 *
 * Route: /employee/login  (public / auth-safe — outside the owner AppShell + LoginFlow)
 *
 * Employees land here after logging out of the EmployeePortal. It is intentionally
 * separate from the contractor/admin LoginFlow landing page: no Create Account, no
 * owner PIN, no owner branding. On success we re-run the auth state machine so the
 * app resolves the 'employee' role and routes to EmployeePortal — the portal-role
 * branch in authStore.initialize() bypasses the owner PIN gate.
 */

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, ArrowRight, CheckCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { goToEmployeePortal } from '@/lib/employeeRoutes'

type Phase = 'checking' | 'form' | 'authenticated'

// ── Shared logo header ─────────────────────────────────────────────────────────
function LogoHeader() {
  return (
    <div className="flex justify-center mb-8">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-green-100 border border-green-200 flex items-center justify-center">
          <Zap className="w-5 h-5 text-green-600" fill="currentColor" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900 leading-tight">Power On Solutions</p>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-mono">Employee Portal</p>
        </div>
      </div>
    </div>
  )
}

export function EmployeeLogin() {
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('checking')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [resetLoading, setResetLoading] = useState(false)
  const [resetMessage, setResetMessage] = useState<string | null>(null)

  // If a session already exists, offer a button into the portal instead of a form.
  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setPhase(data.session ? 'authenticated' : 'form')
    })
    return () => {
      mounted = false
    }
  }, [])

  // ── Sign in ────────────────────────────────────────────────────────────────
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) return

    setLoading(true)
    setError(null)
    setResetMessage(null)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) {
        setError('Could not sign in. Check your password or reset it.')
        return
      }

      // Re-run the auth state machine so it resolves the employee role and routes
      // to EmployeePortal. AWAIT before routing so the resolved role — not an
      // interim owner fallback — decides the destination (EMP-AUTH-1).
      await useAuthStore.getState().initialize()
      const resolvedRole = useAuthStore.getState().role
      if (resolvedRole === 'employee') {
        goToEmployeePortal(navigate)
        return
      }
      // Authenticated but not an active employee. Do not drop them into the owner
      // AppShell/PIN/NDA. Explain why, and sign them out of this portal context.
      const { data: employeeRows } = await supabase
        .from('employee_profiles')
        .select('active, user_id')
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '')
      const rows = (employeeRows ?? []) as Array<{ active: boolean | null; user_id: string | null }>
      if (rows.length > 0 && rows.every(r => r.active === false)) {
        setError('This employee account is inactive. Contact your employer to reactivate it.')
      } else if (rows.length === 0) {
        setError('No active employee profile is linked to this account yet. Ask your employer to send or resend your invitation.')
      } else {
        setError('This account is not set up for the Employee Portal. Contact your employer.')
      }
      await supabase.auth.signOut()
    } catch {
      setError('Could not sign in. Check your password or reset it.')
    } finally {
      setLoading(false)
    }
  }

  // ── Reset password ─────────────────────────────────────────────────────────
  // Sends a Supabase recovery email that redirects to /employee/reset-password.
  // No invite token → EmployeeResetPassword returns the user to this login page.
  async function handleResetPassword() {
    setError(null)
    setResetMessage(null)

    const target = email.trim().toLowerCase()
    if (!target) {
      setError('Enter your email address above, then tap Reset it.')
      return
    }

    setResetLoading(true)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(target, {
        redirectTo: `${window.location.origin}/employee/reset-password`,
      })
      if (resetError) throw resetError
      setResetMessage(
        'Password reset email sent. Open it, set a new password, then return here to sign in.',
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not send the reset email. Please try again.'
      setError(message)
    } finally {
      setResetLoading(false)
    }
  }

  // ── Checking for an existing session ─────────────────────────────────────────
  if (phase === 'checking') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-green-600" />
      </div>
    )
  }

  // ── Already signed in ────────────────────────────────────────────────────────
  if (phase === 'authenticated') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <LogoHeader />
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm text-center">
            <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">You're already signed in</h1>
            <p className="text-sm text-gray-500 mb-6">
              Continue to your employee portal to clock in and view your time.
            </p>
            <button
              type="button"
              onClick={() => goToEmployeePortal(navigate)}
              className="inline-flex items-center justify-center gap-2 w-full px-6 py-3 bg-green-600 text-white text-sm font-semibold rounded-xl active:opacity-80"
            >
              Go to Employee Portal
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Login form ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <LogoHeader />

        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900 mb-1 text-center">Employee Portal Login</h1>
          <p className="text-sm text-gray-500 text-center mb-6">
            Sign in to clock in, view your time, and access employee tools.
          </p>

          {resetMessage && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-blue-50 border border-blue-200 rounded-xl">
              <Mail size={14} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800">{resetMessage}</p>
            </div>
          )}

          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  required
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={1}
                  className="w-full pl-10 pr-11 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim() || !password.trim()}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 active:opacity-80"
            >
              {loading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

          <button
            type="button"
            onClick={handleResetPassword}
            disabled={resetLoading}
            className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-gray-500 hover:text-gray-800 disabled:opacity-50"
          >
            {resetLoading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Sending reset email…
              </>
            ) : (
              'Forgot password? Reset it'
            )}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6 leading-relaxed">
          This login is for employee portal accounts. Contractor/admin users should use the
          main PowerOn Hub login.
        </p>
      </div>
    </div>
  )
}

export default EmployeeLogin
