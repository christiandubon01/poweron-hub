// @ts-nocheck
/**
 * InitialSetupFlow — First-time account setup.
 *
 * New flow (password-first, PIN optional):
 *   Step 1: Set password (required)
 *   Step 2: Set PIN (optional — can skip)
 *
 * On completion:
 *   - Sets account password via supabase.auth.updateUser()
 *   - Optionally hashes PIN → localStorage + Supabase user_preferences
 *   - Calls authStore.setupPasscode(pin) OR directly transitions to authenticated
 */

import React, { useState, useEffect, useRef } from 'react'
import { Zap, Eye, EyeOff, Check, ArrowRight } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import { setPasscode } from '@/lib/auth/passcode'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'

const PIN_LENGTH  = 6
const STORAGE_KEY = 'poweron_pin_hash'

async function sha256hex(message: string): Promise<string> {
  const buf  = new TextEncoder().encode(message)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function savePinLocal(hash: string): void {
  try { localStorage.setItem(STORAGE_KEY, hash) } catch {}
}

// ── PIN Keypad ────────────────────────────────────────────────────────────────
function PinKeypad({ title, subtitle, onComplete, onBack, errorMsg }) {
  const [digits, setDigits]     = useState(Array(PIN_LENGTH).fill(''))
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

  const handleDigit = (d) => {
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

  const handleDigitRef = useRef(handleDigit)
  const handleBackRef  = useRef(handleBack)
  handleDigitRef.current = handleDigit
  handleBackRef.current  = handleBack

  useEffect(() => {
    const listener = (e) => {
      if (/^(Digit|Numpad)[0-9]$/.test(e.code)) { e.preventDefault(); handleDigitRef.current(e.code.slice(-1)); return }
      if (e.code === 'Backspace' || e.code === 'NumpadDecimal') { e.preventDefault(); handleBackRef.current() }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  return (
    <div className="flex flex-col items-center w-full">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-extrabold text-text-1 mb-1 tracking-tight">{title}</h2>
        <p className="text-sm text-text-2">{subtitle}</p>
      </div>
      <div className={clsx('flex gap-4 mb-3', shake && 'animate-shake')}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div key={i} className={clsx('w-4 h-4 rounded-full transition-all duration-150', i < filledCount ? 'scale-110' : 'border-2 border-bg-5 bg-transparent')} style={i < filledCount ? { backgroundColor: '#22c55e' } : undefined} />
        ))}
      </div>
      <div className="min-h-[20px] mb-5 text-center">
        {errorMsg && <p className="text-xs font-medium" style={{ color: '#f87171' }}>{errorMsg}</p>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key, i) => {
          if (key === '') return <div key={i} style={{ minWidth: 72, minHeight: 72 }} />
          if (key === 'back') return (
            <button key={i} onClick={handleBack} disabled={submitting} aria-label="Backspace" className="flex items-center justify-center rounded-2xl border border-bg-5 bg-bg-3 text-text-1 text-xl transition-all duration-100 active:scale-95 hover:bg-bg-4 disabled:opacity-30" style={{ minWidth: 72, minHeight: 72 }}>⌫</button>
          )
          return (
            <button key={i} onClick={() => handleDigit(key)} disabled={submitting} className="flex items-center justify-center rounded-2xl border border-bg-5 bg-bg-3 text-text-1 text-2xl font-bold transition-all duration-100 active:scale-95 hover:bg-bg-4 disabled:opacity-30" style={{ minWidth: 72, minHeight: 72 }}>{key}</button>
          )
        })}
      </div>
      {onBack && <button onClick={onBack} className="mt-8 text-sm text-text-3 hover:text-text-2 transition-colors">Back</button>}
    </div>
  )
}

// ── Password Form ─────────────────────────────────────────────────────────────
function PasswordForm({ onSubmit, saving, error }) {
  const [pw, setPw]       = useState('')
  const [cpw, setCpw]     = useState('')
  const [showPw, setShowPw]   = useState(false)
  const [showCpw, setShowCpw] = useState(false)
  const [localErr, setLocalErr] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    setLocalErr('')
    if (pw.length < 8) { setLocalErr('Password must be at least 8 characters.'); return }
    if (pw !== cpw) { setLocalErr('Passwords do not match.'); return }
    onSubmit(pw)
  }

  const displayErr = localErr || error

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-extrabold text-text-1 mb-1 tracking-tight">Set your password</h2>
        <p className="text-sm text-text-2">Choose a password to log in from any device</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-text-3 uppercase tracking-wider mb-2">Password</label>
          <div className="relative">
            <input type={showPw ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required className={clsx('w-full px-4 py-3 pr-10 rounded-xl bg-bg-3 border text-text-1 text-sm focus:outline-none focus:border-green/50 transition-colors placeholder:text-text-4', displayErr ? 'border-red/40' : 'border-bg-5')} />
            <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-2" tabIndex={-1}>
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-3 uppercase tracking-wider mb-2">Confirm Password</label>
          <div className="relative">
            <input type={showCpw ? 'text' : 'password'} value={cpw} onChange={e => setCpw(e.target.value)} placeholder="Repeat your password" autoComplete="new-password" required className={clsx('w-full px-4 py-3 pr-10 rounded-xl bg-bg-3 border text-text-1 text-sm focus:outline-none focus:border-green/50 transition-colors placeholder:text-text-4', displayErr ? 'border-red/40' : 'border-bg-5')} />
            <button type="button" onClick={() => setShowCpw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-2" tabIndex={-1}>
              {showCpw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        {displayErr && <p className="text-sm" style={{ color: '#f87171' }}>{displayErr}</p>}
        <button type="submit" disabled={saving || !pw || !cpw} className={clsx('flex items-center justify-center gap-2 w-full py-3.5 rounded-xl mt-2 bg-green text-black font-bold text-sm hover:bg-green/90 transition-all shadow-glow-green disabled:opacity-50 disabled:cursor-not-allowed')}>
          {saving ? <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" /> : <>Continue <ArrowRight size={16} /></>}
        </button>
      </form>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
type FlowStep = 'password' | 'pin-create' | 'pin-confirm' | 'saving'

export function InitialSetupFlow() {
  const { setupPasscode, user } = useAuth()
  const [step, setStep]               = useState<FlowStep>('pin-create')
  const [password, setPassword]       = useState('')
  const [pin, setPin]                 = useState('')
  const [pinConfirmErr, setPinConfirmErr] = useState('')
  const [saveErr, setSaveErr]         = useState('')
  const [saving, setSaving]           = useState(false)

  // ── Step 1: Password submitted ──
  const handlePasswordSubmit = async (pw: string) => {
    setSaving(true)
    setSaveErr('')
    try {
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) {
        // If password is same as current, still allow moving forward
        if (error.message?.toLowerCase().includes('different') || error.message?.toLowerCase().includes('same')) {
          setPassword(pw)
          setSaving(false)
          setStep('pin-create')
          return
        }
        throw error
      }
      setPassword(pw)
      setSaving(false)
      setStep('pin-create')
    } catch (err: any) {
      setSaveErr(err.message ?? 'Failed to set password.')
      setSaving(false)
    }
  }

  // ── Step 2a: PIN created ──
  const handlePinCreate = (entered: string) => {
    setPin(entered)
    setPinConfirmErr('')
    setTimeout(() => setStep('pin-confirm'), 300)
  }

  // ── Step 2b: PIN confirmed ──
  const handlePinConfirm = async (entered: string) => {
    if (entered !== pin) {
      setPinConfirmErr("PINs don't match. Try again.")
      setTimeout(() => { setPin(''); setPinConfirmErr(''); setStep('pin-create') }, 800)
      return
    }
    setStep('saving')
    try {
      const pinHash = await sha256hex(pin)
      savePinLocal(pinHash)
      // Write PBKDF2 hash directly to Supabase — bypasses auth store listener
      if (user?.id) {
        setPasscode(user.id, pin).catch(() => {})
      }
      // Save PIN hash FIRST before any state transitions
      savePinLocal(pinHash)
      // Write to Supabase non-blocking
      if (user?.id) {
        setPasscode(user.id, pin).catch(() => {})
      }
      // Small delay to ensure localStorage write completes before state transition
      await new Promise(resolve => setTimeout(resolve, 100))
      // Verify it's saved
      console.log('[PIN] hash saved:', localStorage.getItem('poweron_pin_hash')?.slice(0, 10))
      // Transition to authenticated
      useAuthStore.setState(state => ({ ...state, status: 'authenticated' }))
    } catch (err) {
      setSaveErr('Setup failed. Please try again.')
      setStep('pin-create')
    }
  }

  // ── Skip PIN — go straight to authenticated ──
  const handleSkipPin = async () => {
    setStep('saving')
    try {
      // Write 'password_only' to Supabase so setup doesn't re-trigger on reload
      if (user?.id) {
        await supabase.from('profiles').update({ passcode_hash: 'password_only' } as any).eq('id', user.id)
      }
      useAuthStore.setState(state => ({ ...state, status: 'authenticated' }))
    } catch {
      setStep('pin-create')
    }
  }

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

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6" style={{ backgroundColor: '#0a0b0f' }}>
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

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-10">
        {['Password', 'PIN (Optional)'].map((label, i) => {
          const stepIdx = step === 'password' ? 0 : 1
          const isDone   = i < stepIdx
          const isActive = i === stepIdx
          return (
            <React.Fragment key={label}>
              <div className="flex items-center gap-1.5">
                <div className={clsx('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold', isDone ? 'bg-green text-black' : isActive ? 'bg-green-subtle border-2 border-green text-green' : 'bg-bg-3 border border-bg-5 text-text-3')}>
                  {isDone ? <Check size={12} /> : i + 1}
                </div>
                <span className={clsx('text-xs font-medium', isActive ? 'text-text-1' : 'text-text-3')}>{label}</span>
              </div>
              {i < 1 && <div className={clsx('w-8 h-px', isDone ? 'bg-green' : 'bg-bg-5')} />}
            </React.Fragment>
          )
        })}
      </div>

      {/* Step 1: Password */}
      {step === 'password' && (
        <PasswordForm onSubmit={handlePasswordSubmit} saving={saving} error={saveErr} />
      )}

      {/* Step 2: PIN create */}
      {step === 'pin-create' && (
        <div className="flex flex-col items-center w-full">
          <PinKeypad
            title="Create a PIN (optional)"
            subtitle="Add a 6-digit PIN for quick access on this device"
            onComplete={handlePinCreate}
          />
          <button
            onClick={handleSkipPin}
            className="mt-6 text-sm text-text-3 hover:text-text-2 transition-colors"
          >
            Skip for now — use password only
          </button>
        </div>
      )}

      {/* Step 2: PIN confirm */}
      {step === 'pin-confirm' && (
        <PinKeypad
          title="Confirm your PIN"
          subtitle="Enter the same PIN again to confirm"
          onComplete={handlePinConfirm}
          onBack={() => { setPin(''); setStep('pin-create') }}
          errorMsg={pinConfirmErr}
        />
      )}
    </div>
  )
}
