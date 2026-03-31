/**
 * LoginFlow — top-level auth orchestrator.
 *
 * Reads auth status from the store and renders the appropriate screen:
 *
 *   loading              → Splash / spinner
 *   unauthenticated      → Email sign-in form
 *   needs_passcode_setup → PasscodeScreen (setup mode) → BiometricPrompt (enrollment)
 *   needs_passcode       → PasscodeScreen (verify mode)
 *   biometric_prompt     → BiometricPrompt (verify mode)
 *   locked               → PasscodeScreen shows lockout timer
 *   authenticated        → children (dashboard)
 */

import { useState } from 'react'
import { Zap, Mail, ArrowRight, CheckCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import { PasscodeScreen } from '@/components/auth/PasscodeScreen'
import { BiometricPrompt } from '@/components/auth/BiometricPrompt'

// ── Email Sign-In ────────────────────────────────────────────────────────────
function EmailSignIn() {
  const { signInWithEmail, signInWithMagicLink, error, clearError } = useAuth()
  const [email, setEmail]   = useState('')
  const [mode, setMode]     = useState<'magic' | 'password'>('magic')
  const [password, setPassword] = useState('')
  const [sent, setSent]     = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    clearError()

    if (mode === 'magic') {
      await signInWithMagicLink(email.trim())
      setSent(true)
    } else {
      await signInWithEmail(email.trim(), password)
    }
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6">
        <div className="w-full max-w-sm animate-slide-up text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-green-subtle border border-green-border flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-green" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-text-1 mb-3">Check your email</h1>
          <p className="text-sm text-text-2 mb-2">
            We sent a sign-in link to:
          </p>
          <p className="text-sm font-semibold text-text-1 mb-8 font-mono bg-bg-3 rounded-lg px-4 py-2 inline-block">
            {email}
          </p>
          <p className="text-xs text-text-3">
            Click the link in your email to sign in. It expires in 1 hour.
          </p>
          <button
            onClick={() => setSent(false)}
            className="mt-8 text-sm text-text-3 hover:text-text-2 transition-colors"
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6">
      <div className="w-full max-w-sm animate-slide-up">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-subtle border border-green-border flex items-center justify-center">
              <Zap className="w-5 h-5 text-green" fill="currentColor" />
            </div>
            <div>
              <div className="text-sm font-bold text-text-1 leading-tight">PowerOn Hub</div>
              <div className="text-xs text-text-3 font-mono uppercase tracking-wider">v3.0 · 11 Agents</div>
            </div>
          </div>
        </div>

        {/* Headline */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-text-1 mb-2 tracking-tight">
            Sign in to<br />
            <span className="text-green">PowerOn Hub</span>
          </h1>
          <p className="text-sm text-text-2">
            Your AI-powered electrical business platform
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-text-3 uppercase tracking-wider mb-2">
              Email address
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-3" />
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@poweron.com"
                required
                className={clsx(
                  'w-full pl-10 pr-4 py-3 rounded-xl',
                  'bg-bg-3 border text-text-1 text-sm',
                  'focus:outline-none focus:border-green/50 transition-colors',
                  'placeholder:text-text-4',
                  error ? 'border-red/40' : 'border-bg-5'
                )}
              />
            </div>
          </div>

          {mode === 'password' && (
            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-text-3 uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className={clsx(
                  'w-full px-4 py-3 rounded-xl',
                  'bg-bg-3 border text-text-1 text-sm',
                  'focus:outline-none focus:border-green/50 transition-colors',
                  'placeholder:text-text-4',
                  error ? 'border-red/40' : 'border-bg-5'
                )}
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-red">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className={clsx(
              'flex items-center justify-center gap-2 w-full py-3.5 rounded-xl',
              'bg-green text-black font-bold text-sm',
              'hover:bg-green/90 transition-all shadow-glow-green',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {loading
              ? <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              : <>
                  {mode === 'magic' ? 'Send magic link' : 'Sign in'}
                  <ArrowRight size={16} />
                </>
            }
          </button>
        </form>

        {/* Mode toggle */}
        <div className="mt-4 text-center">
          <button
            onClick={() => { setMode(m => m === 'magic' ? 'password' : 'magic'); clearError() }}
            className="text-xs text-text-3 hover:text-text-2 transition-colors"
          >
            {mode === 'magic' ? 'Sign in with password instead' : 'Send me a magic link instead'}
          </button>
        </div>

        <div className="mt-12 text-center">
          <span className="text-xs font-mono text-text-4 tracking-widest uppercase">
            PowerOn Hub · v3.0
          </span>
        </div>
      </div>
    </div>
  )
}


// ── Passcode Setup Flow ──────────────────────────────────────────────────────
function PasscodeSetupFlow() {
  const { setupPasscode } = useAuth()
  const [step, setStep]   = useState<'create' | 'confirm'>('create')
  const [first, setFirst] = useState('')

  const handleCreate = (passcode: string) => {
    setFirst(passcode)
    setStep('confirm')
  }

  const handleConfirm = (passcode: string) => {
    if (passcode === first) {
      setupPasscode(passcode)
    }
  }

  if (step === 'confirm') {
    return (
      <PasscodeScreen
        key="confirm"
        mode="confirm"
        toConfirm={first}
        onComplete={handleConfirm}
        title="Confirm Passcode"
        subtitle="Enter the same passcode again to confirm"
        onCancel={() => setStep('create')}
      />
    )
  }

  return (
    <PasscodeScreen
      key="create"
      mode="setup"
      onComplete={handleCreate}
      title="Create Passcode"
      subtitle="Choose a 6-digit passcode to secure your account"
    />
  )
}


// ── Spinner (loading state) ──────────────────────────────────────────────────
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


// ── LoginFlow (router) ───────────────────────────────────────────────────────
interface LoginFlowProps {
  children: React.ReactNode
}

export function LoginFlow({ children }: LoginFlowProps) {
  const { status, submitPasscode, signOut } = useAuth()

  switch (status) {
    case 'loading':
      return <AuthSpinner />

    case 'unauthenticated':
      return <EmailSignIn />

    case 'needs_passcode_setup':
      return <PasscodeSetupFlow />

    case 'needs_passcode':
      return (
        <PasscodeScreen
          mode="verify"
          onComplete={submitPasscode}
          onCancel={signOut}
        />
      )

    case 'biometric_prompt':
      return <BiometricPrompt />

    case 'locked':
      return (
        <PasscodeScreen
          mode="verify"
          onComplete={submitPasscode}
          onCancel={signOut}
        />
      )

    case 'authenticated':
      return <>{children}</>

    default:
      return <AuthSpinner />
  }
}
