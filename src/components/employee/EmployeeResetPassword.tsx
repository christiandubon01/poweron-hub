/**
 * EmployeeResetPassword — set a new password from a Supabase recovery link.
 *
 * Route: /employee/reset-password  (public / auth-safe — outside owner AppShell)
 *
 * Flow:
 *   1. User opens the recovery link from their email. The Supabase client
 *      (PKCE + detectSessionInUrl) exchanges the code for a recovery session
 *      automatically on load.
 *   2. User enters + confirms a new password (min 8, must match).
 *   3. supabase.auth.updateUser({ password }) sets it.
 *   4. Success → button back to the employee invite link (if ?invite=token is
 *      present) so they can sign in, otherwise back to the app root.
 */

import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Zap, Lock, Eye, EyeOff, Loader2, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type Phase = 'checking' | 'ready' | 'success'

export function EmployeeResetPassword() {
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')

  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Wait for the recovery session (code exchange happens on load). Fall through
  // to the form after a short window so the user is never stuck on a spinner —
  // updateUser surfaces a friendly error if the link was invalid/expired.
  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (mounted && data.session) setPhase('ready')
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted && session) setPhase('ready')
    })

    const fallback = setTimeout(() => {
      if (mounted) setPhase((p) => (p === 'checking' ? 'ready' : p))
    }, 2500)

    return () => {
      mounted = false
      clearTimeout(fallback)
      sub.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setPhase('success')
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : ''
      // Recovery session missing/expired surfaces as an auth error here.
      if (/session|jwt|auth|expired|not.*found/i.test(raw)) {
        setError('Your reset link may have expired. Request a new reset email from your invite page.')
      } else {
        setError(raw || 'Could not update your password. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  // With an invite token, return to the invite so the user can accept it.
  // Otherwise return to the dedicated employee login page (not the owner landing).
  const returnTo = inviteToken ? `/employee/invite/${inviteToken}` : '/employee/login'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 border border-green-200 flex items-center justify-center">
              <Zap className="w-5 h-5 text-green-600" fill="currentColor" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">Power On Solutions</p>
              <p className="text-xs text-gray-400 uppercase tracking-wider font-mono">Reset Password</p>
            </div>
          </div>
        </div>

        {phase === 'checking' && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-green-600" />
          </div>
        )}

        {phase === 'success' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm text-center">
            <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Password Updated</h1>
            <p className="text-sm text-gray-500 mb-6">
              {inviteToken
                ? 'Your password has been changed. Return to your invite to sign in and accept it.'
                : 'Your password has been changed. Return to the employee login to sign in.'}
            </p>
            <Link
              to={returnTo}
              className="inline-flex items-center justify-center gap-2 w-full px-6 py-3 bg-green-600 text-white text-sm font-semibold rounded-xl"
            >
              {inviteToken ? 'Return to employee invite' : 'Return to employee login'}
              <ArrowRight size={14} />
            </Link>
          </div>
        )}

        {phase === 'ready' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <h1 className="text-xl font-bold text-gray-900 mb-1 text-center">Set a new password</h1>
            <p className="text-sm text-gray-500 text-center mb-6">
              Enter a new password for your employee account.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  New password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={8}
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
                <p className="mt-1 text-xs text-gray-400">Minimum 8 characters</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  Confirm password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !password.trim() || !confirmPassword.trim()}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 active:opacity-80"
              >
                {loading ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Updating…
                  </>
                ) : (
                  'Update Password'
                )}
              </button>
            </form>

            <div className="mt-4 text-center">
              <Link to={returnTo} className="text-xs font-semibold text-gray-400 hover:text-gray-700">
                {inviteToken ? 'Back to employee invite' : 'Back to employee login'}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default EmployeeResetPassword
