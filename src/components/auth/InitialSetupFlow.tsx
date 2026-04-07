/**
 * InitialSetupFlow — First-time account setup after magic-link verification.
 *
 * B24 | Auth Flow Overhaul
 *
 * Triggered by 'needs_passcode_setup' auth state (user landed via magic link,
 * no PIN or password set yet).
 *
 * Steps:
 *   1. Create 6-digit PIN (enter + confirm)
 *   2. Create password (enter + confirm)
 *
 * On completion:
 *   1. SHA-256 hashes the PIN → saves to localStorage (for same-device PIN auth)
 *   2. Upserts pin_hash to Supabase user_preferences (cross-device sync)
 *   3. Sets account password via supabase.auth.updateUser() (enables email+pw login)
 *   4. Calls authStore.setupPasscode(pin) → transitions state to 'authenticated'
 *      (also writes PBKDF2 hash to profiles.passcode_hash as secondary store)
 *
 * Magic link is already single-use in Supabase — invalidated on first use.
 */

import React, { useState, useEffect, useRef } from 'react'
import { Zap, Eye, EyeOff, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

// ── Config ────────────────────────────────────────────────────────────────────

const PIN_LENGTH    = 6
const STORAGE_KEY   = 'poweron_pin_hash'

// ── Crypto ────────────────────────────────────────────────────────────────────

async function sha256hex(message: string): Promise<string> {
  const buf  = new TextEncoder().encode(message)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function savePinLocal(hash: string): void {
  try { localStorage.setItem(STORAGE_KEY, hash) } catch { /* storage unavailable */ }
}

// ── PinKeypad sub-component ───────────────────────────────────────────────────

interface PinKeypadProps {
  title:     string
  subtitle:  string
  onComplete: (pin: string) => void
  onBack?:   () => void
  errorMsg?: string
}

function PinKeypad({ title, subtitle, onComplete, onBack, errorMsg }: PinKeypadProps) {
  const [digits, setDigits]     = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [shake, setShake]       = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const filledCount = digits.filter(x => x !== '').length
  const KEYS = ['1','2','3','4','5','6','7','8','9','','0','back']

  const resetPad = () => {
    setShake(true)
    setTimeout(() => {
      setShake(false)
      setDigits(Array(PIN_LENGTH).fill(''))
      setSubmitting(false)
    }, 500)
  }

  // Expose reset for mismatch cases
  ;(PinKeypad as unknown as Record<string, unknown>)['__reset'] = resetPad

  const handleDigit = (d: string) => {
    if (submitting) return
    const filled = digits.filter(x => x !== '').length
    if (filled >= PIN_LENGTH) return

    const next = [...digits]
    const idx  = next.findIndex(x => x === '')
    next[idx]  = d
    setDigits(next)

    if (filled === PIN_LENGTH - 1) {
      const pin = digits.filter(x => x !== '').concat(d).join('')
      setSubmitting(true)
      // Defer so the last dot renders before we block
      setTimeout(() => onComplete(pin), 80)
    }
  }

  const handleBack = () => {
    if (submitting) return
    const next = [...digits]
    for (let i = PIN_LENGTH - 1; i >= 0; i--) {
      if (next[i] !== '') { next[i] = ''; break }
    }
    setDigits(next)
  }

  // Keep refs current so the keydown listener always closes over fresh state
  const handleDigitRef = useRef(handleDigit)
  const handleBackRef  = useRef(handleBack)
  handleDigitRef.current = handleDigit
  handleBackRef.current  = handleBack

  // ── Keyboard / numpad support ────────────────────────────────────────────
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (/^(Digit|Numpad)[0-9]$/.test(e.code)) {
        e.preventDefault()
        handleDigitRef.current(e.code.slice(-1))
        return
      }
      if (e.code === 'Backspace' || e.code === 'NumpadDecimal') {
        e.preventDefault()
        handleBackRef.current()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, []) // mount/unmount only

  return (
    <div className="flex flex-col items-center w-full">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-extrabold text-text-1 mb-1 tracking-tight">{title}</h2>
        <p className="text-sm text-text-2">{subtitle}</p>
      </div>

      {/* Dot indicators */}
      <div className={clsx('flex gap-4 mb-3', shake && 'animate-shake')}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={clsx(
              'w-4 h-4 rounded-full transition-all duration-150',
              i < filledCount ? 'scale-110' : 'border-2 border-bg-5 bg-transparent'
            )}
            style={i < filledCount ? { backgroundColor: '#22c55e' } : undefined}
          />
        ))}
      </div>

      {/* Error */}
      <div className="min-h-[20px] mb-5 text-center">
        {errorMsg && <p className="text-xs font-medium" style={{ color: '#f87171' }}>{errorMsg}</p>}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key, i) => {
          if (key === '') return <div key={i} style={{ minWidth: 72, minHeight: 72 }} />
          if (key === 'back') return (
            <button
              key={i}
              onClick={handleBack}
              disabled={submitting}
              aria-label="Backspace"
              className="flex items-center justify-center rounded-2xl border border-bg-5 bg-bg-3 text-text-1 text-xl transition-all duration-100 active:scale-95 hover:bg-bg-4 disabled:opacity-30"
              style={{ minWidth: 72, minHeight: 72 }}
            >⌫</button>
          )
          return (
            <button
              key={i}
              onClick={() => handleDigit(key)}
              disabled={submitting}
              className="flex items-center justify-center rounded-2xl border border-bg-5 bg-bg-3 text-text-1 text-2xl font-bold transition-all duration-100 active:scale-95 hover:bg-bg-4 disabled:opacity-30"
              style={{ minWidth: 72, minHeight: 72 }}
            >{key}</button>
          )
        })}
      </div>

      {onBack && (
        <button
          onClick={onBack}
          className="mt-8 text-sm text-text-3 hover:text-text-2 transition-colors"
        >
          Back
        </button>
      )}
    </div>
  )
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepBar({ currentStep }: { currentStep: 'pin' | 'password' }) {
  const steps = [
    { key: 'pin',      label: 'PIN'      },
    { key: 'password', label: 'Password' },
  ] as const

  const currentIdx = steps.findIndex(s => s.key === currentStep)

  return (
    <div className="flex items-center gap-2 mb-10">
      {steps.map((s, i) => {
        const isDone   = i < currentIdx
        const isActive = i === currentIdx
        return (
          <React.Fragment key={s.key}>
            <div className="flex items-center gap-1.5">
              <div className={clsx(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                isDone   ? 'bg-green text-black' :
                isActive ? 'bg-green-subtle border-2 border-green text-green' :
                           'bg-bg-3 border border-bg-5 text-text-3'
              )}>
                {isDone ? <Check size={12} /> : i + 1}
              </div>
              <span className={clsx(
                'text-xs font-medium',
                isActive ? 'text-text-1' : 'text-text-3'
              )}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={clsx('w-8 h-px', isDone ? 'bg-green' : 'bg-bg-5')} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ── PasswordForm sub-component ────────────────────────────────────────────────

interface PasswordFormProps {
  onSubmit: (pw: string) => void
  onBack:   () => void
  saving:   boolean
  error:    string
}

function PasswordForm({ onSubmit, onBack, saving, error }: PasswordFormProps) {
  const [pw,    setPw]    = useState('')
  const [cpw,   setCpw]   = useState('')
  const [showPw, setShowPw]  = useState(false)
  const [showCpw, setShowCpw] = useState(false)
  const [localErr, setLocalErr] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setLocalErr('')

    if (pw.length < 8) {
      setLocalErr('Password must be at least 8 characters.')
      return
    }
    if (pw !== cpw) {
      setLocalErr('Passwords do not match.')
      return
    }
    onSubmit(pw)
  }

  const displayErr = localErr || error

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-extrabold text-text-1 mb-1 tracking-tight">Set your password</h2>
        <p className="text-sm text-text-2">
          Choose a password so you can sign in from any device
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Password */}
        <div>
          <label className="block text-xs font-semibold text-text-3 uppercase tracking-wider mb-2">
            Password
          </label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
              className={clsx(
                'w-full px-4 py-3 pr-10 rounded-xl',
                'bg-bg-3 border text-text-1 text-sm',
                'focus:outline-none focus:border-green/50 transition-colors',
                'placeholder:text-text-4',
                displayErr ? 'border-red/40' : 'border-bg-5'
              )}
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-2"
              tabIndex={-1}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Confirm Password */}
        <div>
          <label className="block text-xs font-semibold text-text-3 uppercase tracking-wider mb-2">
            Confirm Password
          </label>
          <div className="relative">
            <input
              type={showCpw ? 'text' : 'password'}
              value={cpw}
              onChange={e => setCpw(e.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
              required
              className={clsx(
                'w-full px-4 py-3 pr-10 rounded-xl',
                'bg-bg-3 border text-text-1 text-sm',
                'focus:outline-none focus:border-green/50 transition-colors',
                'placeholder:text-text-4',
                displayErr ? 'border-red/40' : 'border-bg-5'
              )}
            />
            <button
              type="button"
              onClick={() => setShowCpw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-2"
              tabIndex={-1}
            >
              {showCpw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {displayErr && <p className="text-sm" style={{ color: '#f87171' }}>{displayErr}</p>}

        <button
          type="submit"
          disabled={saving || !pw || !cpw}
          className={clsx(
            'flex items-center justify-center gap-2 w-full py-3.5 rounded-xl mt-2',
            'bg-green text-black font-bold text-sm',
            'hover:bg-green/90 transition-all shadow-glow-green',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          {saving
            ? <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            : 'Complete Setup'
          }
        </button>
      </form>

      <button
        onClick={onBack}
        className="mt-4 w-full text-sm text-text-3 hover:text-text-2 transition-colors text-center"
      >
        Back — change PIN
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type FlowStep = 'pin-create' | 'pin-confirm' | 'password' | 'saving'

export function InitialSetupFlow() {
  const { setupPasscode, user } = useAuth()

  const [step,        setStep]        = useState<FlowStep>('pin-create')
  const [pin,         setPin]         = useState('')
  const [pinConfirmErr, setPinConfirmErr] = useState('')
  const [saveErr,     setSaveErr]     = useState('')
  const [saving,      setSaving]      = useState(false)

  // ── PIN handlers ────────────────────────────────────────────────────────────

  const handlePinCreate = (entered: string) => {
    setPin(entered)
    setPinConfirmErr('')
    setTimeout(() => setStep('pin-confirm'), 300)
  }

  const handlePinConfirm = (entered: string) => {
    if (entered === pin) {
      setStep('password')
    } else {
      setPinConfirmErr("PINs don't match. Try again.")
      setTimeout(() => {
        setPin('')
        setPinConfirmErr('')
        setStep('pin-create')
      }, 800)
    }
  }

  // ── Password + final save ───────────────────────────────────────────────────

  const handlePasswordSubmit = async (password: string) => {
    setSaving(true)
    setSaveErr('')
    setStep('saving')

    try {
      // 1. Hash PIN with SHA-256 (SubtleCrypto)
      const pinHash = await sha256hex(pin)

      // 2. Save hash to localStorage for same-device PIN auth
      savePinLocal(pinHash)

      // 3. Upsert pin_hash to Supabase user_preferences (cross-device)
      if (user?.id) {
        try {
          await (supabase as unknown as {
            from: (t: string) => {
              upsert: (data: Record<string, unknown>, opts: Record<string, unknown>) => Promise<unknown>
            }
          }).from('user_preferences').upsert(
            {
              user_id:    user.id,
              pin_hash:   pinHash,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          )
        } catch (prefErr) {
          // Non-blocking — user can still log in locally
          console.warn('[InitialSetupFlow] user_preferences upsert failed (non-blocking):', prefErr)
        }
      }

      // 4. Set account password via Supabase auth (enables email+password login from any device)
      try {
        const { error: pwErr } = await supabase.auth.updateUser({ password })
        if (pwErr) {
          console.warn('[InitialSetupFlow] updateUser password failed (non-blocking):', pwErr.message)
        }
      } catch (pwEx) {
        console.warn('[InitialSetupFlow] updateUser exception (non-blocking):', pwEx)
      }

      // 5. Call authStore.setupPasscode(pin) — transitions state machine to 'authenticated'
      //    Also writes PBKDF2 hash to profiles.passcode_hash (secondary store, not user-facing)
      await setupPasscode(pin)

    } catch (err) {
      console.error('[InitialSetupFlow] setup error:', err)
      setSaving(false)
      setSaveErr('Setup failed. Please try again.')
      setStep('password')
    }
  }

  // ── Saving spinner ─────────────────────────────────────────────────────────

  if (step === 'saving') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6" style={{ backgroundColor: '#0a0b0f' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-green-subtle border border-green-border flex items-center justify-center">
            <Zap className="w-6 h-6 text-green" fill="currentColor" />
          </div>
          <div className="w-5 h-5 border-2 border-green border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-text-2">Setting up your account…</p>
        </div>
      </div>
    )
  }

  // ── Shell ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-6"
      style={{ backgroundColor: '#0a0b0f' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-10 h-10 rounded-xl bg-green-subtle border border-green-border flex items-center justify-center">
          <Zap className="w-5 h-5 text-green" fill="currentColor" />
        </div>
        <div>
          <div className="text-sm font-bold text-text-1 leading-tight">PowerOn Hub</div>
          <div className="text-xs text-text-3 font-mono uppercase tracking-wider">Account Setup</div>
        </div>
      </div>

      {/* Step bar */}
      <StepBar currentStep={step === 'password' ? 'password' : 'pin'} />

      {/* PIN: create */}
      {step === 'pin-create' && (
        <PinKeypad
          title="Create your PIN"
          subtitle="Choose a 6-digit PIN to secure your account"
          onComplete={handlePinCreate}
        />
      )}

      {/* PIN: confirm */}
      {step === 'pin-confirm' && (
        <PinKeypad
          title="Confirm your PIN"
          subtitle="Enter the same PIN again to confirm"
          onComplete={handlePinConfirm}
          onBack={() => { setPin(''); setStep('pin-create') }}
          errorMsg={pinConfirmErr}
        />
      )}

      {/* Password */}
      {step === 'password' && (
        <PasswordForm
          onSubmit={handlePasswordSubmit}
          onBack={() => { setPin(''); setStep('pin-create') }}
          saving={saving}
          error={saveErr}
        />
      )}
    </div>
  )
}
