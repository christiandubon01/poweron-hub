// @ts-nocheck
/**
 * InviteAccept — Crew member invite acceptance flow.
 *
 * Route: /invite/:token
 *
 * Flow:
 *   1. Load invite_token from URL param
 *   2. Look up crew_members row by invite_token
 *   3. Show "Join Power On Solutions" page with crew member name
 *   4. Crew member creates account or signs in
 *   5. On auth: update crew_members SET user_id = auth.uid(), accepted_at = now()
 *   6. Redirect to CrewPortal (role resolves to 'crew' on next initialize())
 */

import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Zap, CheckCircle, AlertCircle, ArrowRight, Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

// ── Types ─────────────────────────────────────────────────────────────────────

interface InviteData {
  id: string
  name: string
  email: string | null
  role: string | null
  owner_id: string | null
  invite_token: string
}

type InviteStatus =
  | 'loading'
  | 'found'
  | 'not_found'
  | 'already_accepted'
  | 'signing_in'
  | 'accepted'
  | 'error'

// ── Component ─────────────────────────────────────────────────────────────────

export function InviteAccept() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const initialize = useAuthStore(s => s.initialize)

  const [inviteStatus, setInviteStatus] = useState<InviteStatus>('loading')
  const [inviteData, setInviteData] = useState<InviteData | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isNewAccount, setIsNewAccount] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)

  // ── Step 1: Look up invite token ──────────────────────────────────────────
  useEffect(() => {
    if (!token) {
      setInviteStatus('not_found')
      return
    }

    supabase
      .from('crew_members')
      .select('id,name,email,role,owner_id,invite_token,accepted_at,user_id')
      .eq('invite_token', token)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) {
          setInviteStatus('not_found')
          return
        }

        if (data.accepted_at && data.user_id) {
          setInviteStatus('already_accepted')
          return
        }

        setInviteData(data as InviteData)
        if (data.email) setEmail(data.email)
        setInviteStatus('found')
      })
      .catch(() => {
        setInviteStatus('error')
      })
  }, [token])

  // ── Step 4+5: Create account / sign in, then claim invite ─────────────────
  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password.trim() || !inviteData) return

    setAuthLoading(true)
    setAuthError(null)

    try {
      let userId: string | null = null

      if (isNewAccount) {
        // Create new account
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/invite/${token}`,
          },
        })
        if (error) throw error
        userId = data.user?.id ?? null
      } else {
        // Sign in to existing account
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) throw error
        userId = data.user?.id ?? null
      }

      if (!userId) {
        // Email confirmation pending for new accounts
        setInviteStatus('signing_in')
        return
      }

      // ── Step 5: Claim the invite (update crew_members) ──────────────────
      const { error: updateError } = await supabase
        .from('crew_members')
        .update({
          user_id:     userId,
          accepted_at: new Date().toISOString(),
          // Clear the invite token after use
          invite_token: null,
        })
        .eq('id', inviteData.id)

      if (updateError) {
        // Non-fatal: the user is logged in, just link failed
        console.error('[InviteAccept] Failed to claim invite:', updateError)
      }

      setInviteStatus('accepted')

      // Re-initialize auth to pick up new role (crew)
      await initialize()

      // Redirect to root — App.tsx will render CrewPortal based on role
      setTimeout(() => navigate('/'), 1500)

    } catch (err: unknown) {
      const e = err as { message?: string }
      setAuthError(e.message ?? 'Authentication failed. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  // ── Render states ─────────────────────────────────────────────────────────

  if (inviteStatus === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-green-600" />
      </div>
    )
  }

  if (inviteStatus === 'not_found') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-7 h-7 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invite Not Found</h1>
          <p className="text-sm text-gray-500">
            This invite link is invalid or has already been used.
            Contact your owner for a new invite link.
          </p>
        </div>
      </div>
    )
  }

  if (inviteStatus === 'already_accepted') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-7 h-7 text-green-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Already Joined</h1>
          <p className="text-sm text-gray-500 mb-6">
            This invite has already been accepted. Sign in to access your account.
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white text-sm font-semibold rounded-xl"
          >
            Go to Sign In
            <ArrowRight size={14} />
          </a>
        </div>
      </div>
    )
  }

  if (inviteStatus === 'signing_in') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4">
            <Mail className="w-7 h-7 text-green-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Check Your Email</h1>
          <p className="text-sm text-gray-500">
            We sent a confirmation link to <strong>{email}</strong>.
            Click it to verify your account, then come back to this invite link.
          </p>
        </div>
      </div>
    )
  }

  if (inviteStatus === 'accepted') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-7 h-7 text-green-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Welcome to the Team!</h1>
          <p className="text-sm text-gray-500">Setting up your crew portal…</p>
          <div className="mt-4 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-green-600" />
          </div>
        </div>
      </div>
    )
  }

  if (inviteStatus === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h1>
          <p className="text-sm text-gray-500">
            Could not load the invite. Please try the link again or contact your owner.
          </p>
        </div>
      </div>
    )
  }

  // ── Main invite accept UI ─────────────────────────────────────────────────
  const crewRole = inviteData?.role ?? 'Crew Member'

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
              <p className="text-sm font-bold text-gray-900 leading-tight">PowerOn Hub</p>
              <p className="text-xs text-gray-400 uppercase tracking-wider font-mono">Crew Invite</p>
            </div>
          </div>
        </div>

        {/* Welcome */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-gray-900 mb-1">
            You're invited!
          </h1>
          <p className="text-base text-gray-700 font-semibold">{inviteData?.name}</p>
          <p className="text-sm text-gray-500 mt-1 capitalize">{crewRole}</p>
          <p className="text-sm text-gray-500 mt-3">
            Create an account or sign in to access your crew portal.
          </p>
        </div>

        {/* Toggle new/existing */}
        <div className="flex bg-gray-200 rounded-xl p-1 mb-6">
          <button
            type="button"
            onClick={() => { setIsNewAccount(true); setAuthError(null) }}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
              isNewAccount ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            Create Account
          </button>
          <button
            type="button"
            onClick={() => { setIsNewAccount(false); setAuthError(null) }}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
              !isNewAccount ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            Sign In
          </button>
        </div>

        {/* Form */}
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
                onChange={e => setEmail(e.target.value)}
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
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={isNewAccount ? 8 : 1}
                className="w-full pl-10 pr-11 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
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
                Setting up…
              </>
            ) : (
              <>
                {isNewAccount ? 'Create Account & Join' : 'Sign In & Join'}
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </form>

      </div>
    </div>
  )
}

export default InviteAccept
