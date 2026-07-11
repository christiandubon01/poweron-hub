/**
 * EmployeeInviteAccept — Employee time-tracking invite acceptance flow.
 *
 * Route: /employee/invite/:token
 *
 * Flow:
 *   1. Validate token via validate_employee_invite RPC
 *   2. Show invite details (org, employee name, role)
 *   3. User signs in or creates an account (invited email)
 *   4. Authenticated user clicks Accept Invite
 *   5. accept_employee_invite RPC links employee_profiles.user_id
 *   6. Confirmation — EmployeePortal routing deferred to TIME-2C
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Zap,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  Building2,
  Briefcase,
  LogOut,
} from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import {
  validateEmployeeInviteToken,
  acceptEmployeeInvite,
  type EmployeeInviteValidationResult,
  type EmployeeEmploymentType,
  type EmployeeInviteRole,
} from '@/services/employeeInviteService'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRole(role?: EmployeeInviteRole): string {
  if (role === 'foreman') return 'Foreman'
  return 'Employee'
}

function formatEmploymentType(type?: EmployeeEmploymentType): string {
  switch (type) {
    case 'part_time':      return 'Part-time'
    case 'subcontractor':  return 'Subcontractor'
    case 'helper':         return 'Helper'
    case 'full_time':
    default:               return 'Full-time'
  }
}

function validationMessage(reason?: string): { title: string; body: string } {
  switch (reason) {
    case 'missing_token':
      return {
        title: 'Invalid Invite Link',
        body: 'This invite link is missing required information. Ask your employer for a new link.',
      }
    case 'already_accepted':
      return {
        title: 'Invite Already Accepted',
        body: 'This employee invite has already been used. Sign in if you already created your account.',
      }
    case 'inactive':
      return {
        title: 'Invite No Longer Active',
        body: 'This invite is no longer active. Contact your employer for a new invite.',
      }
    case 'not_found':
    default:
      return {
        title: 'Invite Not Found',
        body: 'This invite link is invalid or has expired. Contact your employer for a new link.',
      }
  }
}

function acceptMessage(reason?: string): string {
  switch (reason) {
    case 'not_authenticated':
      return 'Please sign in or create an account before accepting this invite.'
    case 'already_accepted':
      return 'This invite has already been accepted.'
    case 'inactive':
      return 'This invite is no longer active. Contact your employer.'
    case 'email_mismatch':
      return 'Sign in with the same email address this invite was sent to, then try again.'
    case 'not_found':
    default:
      return 'Could not accept this invite. It may have expired or already been used.'
  }
}

type PagePhase =
  | 'loading'
  | 'invalid'
  | 'ready'
  | 'accepted'
  | 'error'

// ── Layout shells ─────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}

function StatusCard({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <h1 className="text-xl font-bold text-gray-900 mb-2">{title}</h1>
      <p className="text-sm text-gray-500 mb-6">{body}</p>
      {action}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EmployeeInviteAccept() {
  const { token } = useParams<{ token: string }>()

  const [phase, setPhase] = useState<PagePhase>('loading')
  const [invalidReason, setInvalidReason] = useState<string | undefined>()
  const [invite, setInvite] = useState<EmployeeInviteValidationResult | null>(null)

  const [sessionUser, setSessionUser] = useState<User | null>(null)
  const [sessionReady, setSessionReady] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isNewAccount, setIsNewAccount] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authInfo, setAuthInfo] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)

  const [resetLoading, setResetLoading] = useState(false)
  const [resetMessage, setResetMessage] = useState<string | null>(null)

  const [acceptLoading, setAcceptLoading] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [signOutLoading, setSignOutLoading] = useState(false)

  // ── Session tracking (public route — no LoginFlow wrapper) ─────────────────
  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSessionUser(data.session?.user ?? null)
      setSessionReady(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUser(session?.user ?? null)
      setSessionReady(true)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // ── Validate invite token ──────────────────────────────────────────────────
  useEffect(() => {
    if (!token) {
      setInvalidReason('missing_token')
      setPhase('invalid')
      return
    }

    let mounted = true
    setPhase('loading')

    validateEmployeeInviteToken(token)
      .then((result) => {
        if (!mounted) return
        if (!result.valid) {
          setInvalidReason(result.reason)
          setPhase('invalid')
          return
        }
        setInvite(result)
        if (result.email) setEmail(result.email)
        setPhase('ready')
      })
      .catch(() => {
        if (!mounted) return
        setPhase('error')
      })

    return () => {
      mounted = false
    }
  }, [token])

  const handleSignOut = useCallback(async () => {
    setSignOutLoading(true)
    setAcceptError(null)
    try {
      await supabase.auth.signOut()
      setSessionUser(null)
    } finally {
      setSignOutLoading(false)
    }
  }, [])

  // ── Switch to Sign In mode, preserving the invited email ───────────────────
  const switchToSignIn = useCallback((info: string) => {
    setIsNewAccount(false)
    setPassword('')
    setAuthError(null)
    setResetMessage(null)
    setAuthInfo(info)
  }, [])

  // ── Sign up / sign in (does not auto-accept) ───────────────────────────────
  //
  // Create Account no longer parks the user on a "Check Your Email" screen.
  // On success (or when the email already has an account) we drop the user onto
  // the Sign In form with a helpful message so they can sign in immediately.
  // If sign-up returns an active session (email confirmation disabled), we
  // continue straight into the accept flow.
  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password.trim() || !token) return

    setAuthLoading(true)
    setAuthError(null)
    setAuthInfo(null)
    setResetMessage(null)

    try {
      if (isNewAccount) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/employee/invite/${token}`,
          },
        })

        if (error) {
          // An existing account is not a failure here — guide them to sign in.
          if (/already registered|already exists|already been registered/i.test(error.message)) {
            switchToSignIn(
              'This email already has an account. Sign in below to accept your invite. If you forgot your password, use Reset Password.',
            )
            return
          }
          throw error
        }

        // Email confirmation disabled → signed in immediately; continue to accept.
        if (data.session) {
          setSessionUser(data.session.user)
          return
        }

        // No session yet (confirmation pending, or existing-email obfuscation).
        // Return to Sign In instead of a dead-end "check your email" screen.
        switchToSignIn(
          'Account created or already exists. Sign in below to accept your invite. If you forgot your password, use Reset Password.',
        )
        return
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) {
        setAuthError('Could not sign in. Check your password or use Reset Password.')
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      setSessionUser(session?.user ?? null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setAuthError(message)
    } finally {
      setAuthLoading(false)
    }
  }

  // ── Reset password (Sign In mode) ──────────────────────────────────────────
  // Sends a Supabase recovery email that redirects to /employee/reset-password,
  // preserving the invite token so the user can return and sign in afterwards.
  async function handleResetPassword() {
    if (!token) return
    setAuthError(null)
    setResetMessage(null)

    const target = (email.trim() || invite?.email?.trim() || '').toLowerCase()
    if (!target) {
      setAuthError('Enter your email address above, then tap Reset Password.')
      return
    }

    setResetLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(target, {
        redirectTo: `${window.location.origin}/employee/reset-password?invite=${token}`,
      })
      if (error) throw error
      setResetMessage(
        'Password reset email sent. Open it, set a new password, then return to this invite link to sign in.',
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not send the reset email. Please try again.'
      setAuthError(message)
    } finally {
      setResetLoading(false)
    }
  }

  // ── Accept invite (authenticated only) ─────────────────────────────────────
  async function handleAccept() {
    if (!token) return

    setAcceptLoading(true)
    setAcceptError(null)

    try {
      const result = await acceptEmployeeInvite(token)
      if (result.success) {
        setPhase('accepted')
        return
      }
      setAcceptError(acceptMessage(result.reason))
    } catch {
      setAcceptError('Something went wrong while accepting the invite. Please try again.')
    } finally {
      setAcceptLoading(false)
    }
  }

  // ── Render phases ──────────────────────────────────────────────────────────

  if (phase === 'loading' || !sessionReady) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-green-600" />
      </div>
    )
  }

  if (phase === 'invalid') {
    const msg = validationMessage(invalidReason)
    return (
      <PageShell>
        <StatusCard
          icon={<AlertCircle className="w-7 h-7 text-red-500" />}
          title={msg.title}
          body={msg.body}
          action={
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white text-sm font-semibold rounded-xl"
            >
              Go to Sign In
              <ArrowRight size={14} />
            </Link>
          }
        />
      </PageShell>
    )
  }

  if (phase === 'error') {
    return (
      <PageShell>
        <StatusCard
          icon={<AlertCircle className="w-7 h-7 text-red-500" />}
          title="Something Went Wrong"
          body="Could not load this invite. Please try the link again or contact your employer."
        />
      </PageShell>
    )
  }

  if (phase === 'accepted') {
    return (
      <PageShell>
        <StatusCard
          icon={<CheckCircle className="w-7 h-7 text-green-600" />}
          title="Invite Accepted"
          body="Invite accepted. Employee portal access will be available after setup is complete."
          action={
            <div className="flex flex-col gap-3">
              <Link
                to="/"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white text-sm font-semibold rounded-xl"
              >
                Continue
                <ArrowRight size={14} />
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signOutLoading}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-gray-600 hover:text-gray-900"
              >
                {signOutLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <LogOut size={14} />
                )}
                Sign Out
              </button>
            </div>
          }
        />
      </PageShell>
    )
  }

  // ── Ready — show invite details + auth or accept ───────────────────────────
  const isAuthenticated = !!sessionUser
  const invitedEmail = invite?.email?.trim().toLowerCase()
  const signedInEmail = sessionUser?.email?.trim().toLowerCase()
  const emailHint =
    invitedEmail && signedInEmail && invitedEmail !== signedInEmail
      ? `You are signed in as ${sessionUser?.email}, but this invite was sent to ${invite?.email}.`
      : null

  return (
    <PageShell>
      {/* Logo */}
      <div className="flex justify-center mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 border border-green-200 flex items-center justify-center">
            <Zap className="w-5 h-5 text-green-600" fill="currentColor" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 leading-tight">Power On Solutions</p>
            <p className="text-xs text-gray-400 uppercase tracking-wider font-mono">Employee Invite</p>
          </div>
        </div>
      </div>

      {/* Invite summary */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 shadow-sm">
        <h1 className="text-xl font-extrabold text-gray-900 mb-1 text-center">
          Employee time tracking invite
        </h1>
        <p className="text-sm text-gray-500 text-center mb-4">
          You have been invited to clock in and out through the employee portal.
        </p>

        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <Building2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Employer</p>
              <p className="text-gray-900 font-medium">{invite?.org_name || 'Your employer'}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Briefcase className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</p>
              <p className="text-gray-900 font-medium">{invite?.display_name}</p>
            </div>
          </div>

          {invite?.email && (
            <div className="flex items-start gap-3">
              <Mail className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</p>
                <p className="text-gray-900 font-medium">{invite.email}</p>
              </div>
            </div>
          )}

          <div className="flex gap-4 pt-1">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</p>
              <p className="text-gray-900">{formatRole(invite?.role)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</p>
              <p className="text-gray-900">{formatEmploymentType(invite?.employment_type)}</p>
            </div>
          </div>
        </div>
      </div>

      {isAuthenticated ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 text-center">
            Signed in as <strong>{sessionUser?.email}</strong>
          </p>

          {emailHint && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">{emailHint}</p>
            </div>
          )}

          {acceptError && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-600">{acceptError}</p>
            </div>
          )}

          <button
            type="button"
            onClick={handleAccept}
            disabled={acceptLoading}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 active:opacity-80"
          >
            {acceptLoading ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Accepting…
              </>
            ) : (
              <>
                Accept Invite
                <ArrowRight size={15} />
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={signOutLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-gray-500 hover:text-gray-800"
          >
            {signOutLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <LogOut size={14} />
            )}
            Sign out and use a different account
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-600 text-center mb-4">
            Sign in or create an account using the invited email address to accept this invite.
          </p>

          <div className="flex bg-gray-200 rounded-xl p-1 mb-6">
            <button
              type="button"
              onClick={() => { setIsNewAccount(true); setAuthError(null); setAuthInfo(null); setResetMessage(null) }}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                isNewAccount ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => { setIsNewAccount(false); setAuthError(null); setResetMessage(null) }}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                !isNewAccount ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              Sign In
            </button>
          </div>

          {authInfo && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-green-50 border border-green-200 rounded-xl">
              <CheckCircle size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-green-800">{authInfo}</p>
            </div>
          )}

          {resetMessage && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-blue-50 border border-blue-200 rounded-xl">
              <Mail size={14} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800">{resetMessage}</p>
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
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
                {isNewAccount ? 'Create Password' : 'Password'}
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isNewAccount ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={isNewAccount ? 8 : 1}
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
              {isNewAccount && (
                <p className="mt-1 text-xs text-gray-400">Minimum 8 characters</p>
              )}
            </div>

            {authError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                <p className="text-xs text-red-600">{authError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading || !email.trim() || !password.trim()}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 active:opacity-80"
            >
              {authLoading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {isNewAccount ? 'Creating account…' : 'Signing in…'}
                </>
              ) : (
                <>
                  {isNewAccount ? 'Create Account' : 'Sign In'}
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

          {!isNewAccount && (
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
          )}
        </>
      )}
    </PageShell>
  )
}

export default EmployeeInviteAccept
