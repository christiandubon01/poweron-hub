// @ts-nocheck
/**
 * LoginFlow — top-level auth orchestrator.
 *
 * Flow:
 *   loading              → Splash / spinner
 *   unauthenticated      → LandingPage (Register / Log In) OR PinAuth if PIN stored
 *   needs_passcode_setup → InitialSetupFlow (create 6-digit PIN)
 *   needs_passcode       → PinAuth (verify mode)
 *   biometric_prompt     → BiometricPrompt
 *   locked               → PasscodeScreen lockout timer
 *   authenticated        → children (dashboard)
 */

import { useState } from 'react'
import { Zap, Mail, ArrowRight, CheckCircle, Eye, EyeOff, User, Lock, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import { PasscodeScreen } from '@/components/auth/PasscodeScreen'
import { BiometricPrompt } from '@/components/auth/BiometricPrompt'
import { PinAuth } from '@/components/auth/PinAuth'
import { InitialSetupFlow } from '@/components/auth/InitialSetupFlow'
import { supabase } from '@/lib/supabase'

const PIN_STORAGE_KEY = 'poweron_pin_hash'

function hasPinStored(): boolean {
  try { return Boolean(localStorage.getItem(PIN_STORAGE_KEY)) } catch { return false }
}

// ── Spinner ──────────────────────────────────────────────────────────────────
function AuthSpinner() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg gap-4">
      <div className="w-12 h-12 rounded-2xl bg-green-subtle border border-green-border flex items-center justify-center">
        <Zap className="w-6 h-6 text-green" fill="currentColor" />
      </div>
      <div className="w-5 h-5 border-2 border-green border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// ── Landing Page ─────────────────────────────────────────────────────────────
function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f1117] px-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
              <Zap className="w-6 h-6 text-emerald-400" fill="currentColor" />
            </div>
            <div>
              <div className="text-base font-bold text-white leading-tight">PowerOn Hub</div>
              <div className="text-xs text-gray-500 font-mono uppercase tracking-wider">v3.0 · 11 Agents</div>
            </div>
          </div>
        </div>

        {/* Headline */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-extrabold text-white mb-3 tracking-tight">
            Your electrical<br />
            <span className="text-emerald-400">business OS</span>
          </h1>
          <p className="text-sm text-gray-400">
            AI-powered sales intelligence, field ops, and business management — built for contractors.
          </p>
        </div>

        {/* Buttons */}
        <div className="space-y-3">
          <button
            onClick={onRegister}
            className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all flex items-center justify-center gap-2"
          >
            Create Account
            <ArrowRight size={16} />
          </button>
          <button
            onClick={onLogin}
            className="w-full py-4 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-100 font-bold text-sm transition-all border border-gray-700"
          >
            Log In
          </button>
        </div>

        <div className="mt-12 text-center">
          <span className="text-xs font-mono text-gray-600 tracking-widest uppercase">
            PowerOn Solutions LLC
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Register Flow ─────────────────────────────────────────────────────────────
function RegisterFlow({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!fullName.trim()) { setError('Full name is required.'); return }
    if (!username.trim()) { setError('Username is required.'); return }
    if (username.length < 3) { setError('Username must be at least 3 characters.'); return }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { setError('Username can only contain letters, numbers, and underscores.'); return }
    if (!email.trim()) { setError('Email is required.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }

    setLoading(true)
    try {
      // Check username availability
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username.toLowerCase().trim())
        .maybeSingle()

      if (existing) {
        setError('Username is already taken. Please choose another.')
        setLoading(false)
        return
      }

      // Create Supabase auth account
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: 'https://app.poweronsolutionsllc.com',
          data: {
            full_name: fullName.trim(),
            username: username.toLowerCase().trim(),
          },
        },
      })

      if (signUpError) throw signUpError

      // Update profile with username and full_name if user was created
      if (data.user) {
        await supabase
          .from('profiles')
          .update({
            full_name: fullName.trim(),
            username: username.toLowerCase().trim(),
          } as any)
          .eq('id', data.user.id)
      }

      setSent(true)
    } catch (err: any) {
      setError(err.message ?? 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f1117] px-6">
        <div className="w-full max-w-sm text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Check your email</h1>
          <p className="text-sm text-gray-400 mb-2">We sent a verification link to:</p>
          <p className="text-sm font-semibold text-white mb-6 font-mono bg-gray-800 rounded-lg px-4 py-2 inline-block">
            {email}
          </p>
          <p className="text-xs text-gray-500 mb-8">
            Click the link to verify your account. After verification, you can log in with your email and password.
          </p>
          <button
            onClick={onBack}
            className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            Back to home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f1117] px-6 py-8">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button onClick={onBack} className="text-gray-500 hover:text-gray-300 transition-colors text-sm">← Back</button>
          <div className="flex-1" />
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-emerald-400" fill="currentColor" />
          </div>
        </div>

        <h1 className="text-2xl font-extrabold text-white mb-1">Create account</h1>
        <p className="text-sm text-gray-500 mb-6">Join PowerOn Hub</p>

        <form onSubmit={handleRegister} className="space-y-4">
          {/* Full Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Christian Dubon"
              required
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-gray-600 transition-colors"
            />
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Username</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">@</span>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-zA-Z0-9_]/g, ''))}
                placeholder="christiandubon"
                required
                className="w-full pl-8 pr-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-gray-600 transition-colors"
              />
            </div>
            <p className="text-[10px] text-gray-600 mt-1">Letters, numbers, underscores only.</p>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Email</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-gray-600 transition-colors"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                className="w-full pl-10 pr-10 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-gray-600 transition-colors"
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Confirm Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                required
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-gray-600 transition-colors"
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <><ArrowRight size={16} /> Create Account</>
            }
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Login Form ────────────────────────────────────────────────────────────────
function LoginForm({ onBack }: { onBack: () => void }) {
  const { signInWithEmail, error, clearError } = useAuth()
  const [identifier, setIdentifier] = useState('') // email or username
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')
    clearError()
    if (!identifier.trim() || !password) return
    setLoading(true)

    try {
      let emailToUse = identifier.trim()

      // If identifier doesn't look like an email, try to resolve username → email
      if (!identifier.includes('@')) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', identifier.toLowerCase().trim())
          .maybeSingle()

        if (!profile) {
          setLocalError('Username not found. Try your email address instead.')
          setLoading(false)
          return
        }

        // Get email from auth.users via a server function or use the id to fetch email
        // Since we can't query auth.users directly, we'll ask user to use email if username lookup fails
        const { data: { user } } = await supabase.auth.getUser()
        if (user && user.id === (profile as any).id) {
          emailToUse = user.email ?? identifier.trim()
        } else {
          setLocalError('Please use your email address to log in.')
          setLoading(false)
          return
        }
      }

      await signInWithEmail(emailToUse, password)
    } catch (err: any) {
      setLocalError(err.message ?? 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!forgotEmail.trim()) return
    setForgotLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
        redirectTo: 'https://app.poweronsolutionsllc.com',
      })
      if (error) throw error
      setForgotSent(true)
    } catch (err: any) {
      setLocalError(err.message ?? 'Failed to send reset email.')
    } finally {
      setForgotLoading(false)
    }
  }

  if (showForgot) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f1117] px-6">
        <div className="w-full max-w-sm">
          <button onClick={() => { setShowForgot(false); setForgotSent(false); setLocalError('') }} className="text-gray-500 hover:text-gray-300 transition-colors text-sm mb-8">← Back to login</button>

          {forgotSent ? (
            <div className="text-center">
              <div className="flex justify-center mb-6">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                  <CheckCircle className="w-7 h-7 text-emerald-400" />
                </div>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Check your email</h2>
              <p className="text-sm text-gray-400">We sent a password reset link to <span className="text-white font-semibold">{forgotEmail}</span>.</p>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-white mb-1">Reset password</h2>
              <p className="text-sm text-gray-500 mb-6">Enter your email and we'll send a reset link.</p>
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-gray-600"
                  />
                </div>
                {localError && <p className="text-xs text-red-400">{localError}</p>}
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {forgotLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Send Reset Link'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f1117] px-6">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button onClick={onBack} className="text-gray-500 hover:text-gray-300 transition-colors text-sm">← Back</button>
          <div className="flex-1" />
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-emerald-400" fill="currentColor" />
          </div>
        </div>

        <h1 className="text-2xl font-extrabold text-white mb-1">Welcome back</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in to PowerOn Hub</p>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Email or Username */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Email or Username</label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="you@email.com or @username"
                required
                autoComplete="username"
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-gray-600 transition-colors"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="w-full pl-10 pr-10 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-gray-600 transition-colors"
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {(localError || error) && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-400">{localError || error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !identifier.trim() || !password}
            className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <>Sign In <ArrowRight size={16} /></>
            }
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => { setShowForgot(true); setLocalError('') }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Forgot password?
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Set New Password Form (after recovery redirect) ───────────────────────────
function SetNewPasswordForm() {
  const { signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setDone(true)
    } catch (err: any) {
      setError(err.message ?? 'Failed to update password.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f1117] px-6">
        <div className="w-full max-w-sm text-center">
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-emerald-400" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Password updated</h2>
          <p className="text-sm text-gray-400 mb-6">Your password has been changed successfully.</p>
          <button onClick={() => signOut()} className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
            Sign in with new password
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f1117] px-6">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <Zap className="w-5 h-5 text-emerald-400" fill="currentColor" />
          </div>
        </div>
        <h1 className="text-2xl font-extrabold text-white mb-1">Set new password</h1>
        <p className="text-sm text-gray-500 mb-6">Choose a strong password for your account.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">New Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" required className="w-full pl-10 pr-10 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-gray-600" />
              <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Confirm Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repeat password" required className="w-full pl-10 pr-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-emerald-500/50 placeholder:text-gray-600" />
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
          <button type="submit" disabled={loading} className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <>Update Password <ArrowRight size={16} /></>}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Passcode Setup Flow ───────────────────────────────────────────────────────
function PasscodeSetupFlow() {
  const { setupPasscode } = useAuth()
  const [step, setStep] = useState<'create' | 'confirm'>('create')
  const [first, setFirst] = useState('')

  const handleCreate = (passcode: string) => { setFirst(passcode); setStep('confirm') }
  const handleConfirm = (passcode: string) => { if (passcode === first) setupPasscode(passcode) }

  if (step === 'confirm') {
    return <PasscodeScreen key="confirm" mode="confirm" toConfirm={first} onComplete={handleConfirm} title="Confirm Passcode" subtitle="Enter the same passcode again to confirm" onCancel={() => setStep('create')} />
  }
  return <PasscodeScreen key="create" mode="setup" onComplete={handleCreate} title="Create Passcode" subtitle="Choose a 6-digit passcode to secure your account" />
}

// ── LoginFlow (router) ────────────────────────────────────────────────────────
type AuthScreen = 'landing' | 'login' | 'register'

interface LoginFlowProps {
  children: React.ReactNode
}

export function LoginFlow({ children }: LoginFlowProps) {
  const { status, submitPasscode, signOut } = useAuth()
  const [screen, setScreen] = useState<AuthScreen>('landing')
  const [pinFallback, setPinFallback] = useState(false)

  switch (status) {
    case 'loading':
      return <AuthSpinner />

    case 'unauthenticated': {
      const showPin = hasPinStored() && !pinFallback
      if (showPin) {
        return <PinAuth onFallbackToMagicLink={() => setPinFallback(true)} />
      }

      if (screen === 'register') {
        return <RegisterFlow onBack={() => setScreen('landing')} onSuccess={() => setScreen('login')} />
      }

      if (screen === 'login') {
        return <LoginForm onBack={() => setScreen('landing')} />
      }

      return <LandingPage onLogin={() => setScreen('login')} onRegister={() => setScreen('register')} />
    }

    case 'needs_passcode_setup':
      return <InitialSetupFlow />

    case 'needs_passcode':
      return <PinAuth onVerify={submitPasscode} onFallbackToMagicLink={signOut} />

    case 'biometric_prompt':
      return <BiometricPrompt />

    case 'locked':
      return <PasscodeScreen mode="verify" onComplete={submitPasscode} onCancel={signOut} />

    case 'password_recovery':
      return <SetNewPasswordForm />

    case 'authenticated':
      return <>{children}</>

    default:
      return <AuthSpinner />
  }
}
