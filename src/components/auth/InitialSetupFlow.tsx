// @ts-nocheck
/**
 * InitialSetupFlow - First-time account setup.
 *
 * New flow (password-first, PIN optional):
 *   Step 1: Set password (required)
 *   Step 2: Set PIN (optional - can skip)
 *
 * On completion:
 *   - Sets account password via supabase.auth.updateUser()
 *   - Optionally hashes PIN -> localStorage + Supabase user_preferences
 *   - Calls authStore.setupPasscode(pin) OR directly transitions to authenticated
 */

import React, { useState, useEffect, useRef } from 'react'
import { Eye, EyeOff, Check, ArrowRight } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import { setPasscode } from '@/lib/auth/passcode'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'

const PIN_LENGTH = 6
const STORAGE_KEY = 'poweron_pin_hash'

async function sha256hex(message: string): Promise<string> {
  const buf = new TextEncoder().encode(message)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function savePinLocal(hash: string): void {
  try { localStorage.setItem(STORAGE_KEY, hash) } catch {}
}

function PinKeypad({ title, subtitle, onComplete, onBack, errorMsg }) {
  const [digits, setDigits] = useState(Array(PIN_LENGTH).fill(''))
  const [shake, setShake] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const filledCount = digits.filter(x => x !== '').length
  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back']

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
    const idx = next.findIndex(x => x === '')
    next[idx] = d
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
  const handleBackRef = useRef(handleBack)
  handleDigitRef.current = handleDigit
  handleBackRef.current = handleBack

  useEffect(() => {
    const listener = (e) => {
      if (/^(Digit|Numpad)[0-9]$/.test(e.code)) { e.preventDefault(); handleDigitRef.current(e.code.slice(-1)); return }
      if (e.code === 'Backspace' || e.code === 'NumpadDecimal') { e.preventDefault(); handleBackRef.current() }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  useEffect(() => {
    if (errorMsg) resetPad()
  }, [errorMsg])

  return (
    <div className="poweron-setup-keypad-wrap">
      <div className="poweron-setup-copy">
        <h2 className="poweron-setup-card-title">{title}</h2>
        <p className="poweron-setup-card-subtitle">{subtitle}</p>
      </div>

      <div className={clsx('poweron-setup-dots', shake && 'animate-shake')}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={clsx('poweron-setup-dot', i < filledCount && 'is-filled', errorMsg && 'has-error')}
          />
        ))}
      </div>

      <div className="poweron-setup-msg-slot">
        {errorMsg && <p className="poweron-setup-error">{errorMsg}</p>}
      </div>

      <div className="poweron-setup-keypad-grid">
        {KEYS.map((key, i) => {
          if (key === '') return <div key={i} className="poweron-setup-keypad-spacer" />
          if (key === 'back') {
            return (
              <button
                type="button"
                key={i}
                onClick={handleBack}
                disabled={submitting}
                aria-label="Backspace"
                className="poweron-setup-keypad-btn poweron-setup-keypad-back"
              >
                &#9003;
              </button>
            )
          }
          return (
            <button
              type="button"
              key={i}
              onClick={() => handleDigit(key)}
              disabled={submitting}
              className="poweron-setup-keypad-btn"
            >
              {key}
            </button>
          )
        })}
      </div>

      {onBack && (
        <button type="button" onClick={onBack} className="poweron-setup-text-btn">
          Back
        </button>
      )}
    </div>
  )
}

function PasswordForm({ onSubmit, saving, error }) {
  const [pw, setPw] = useState('')
  const [cpw, setCpw] = useState('')
  const [showPw, setShowPw] = useState(false)
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
    <div className="poweron-setup-password-wrap">
      <div className="poweron-setup-copy">
        <h2 className="poweron-setup-card-title">Set your password</h2>
        <p className="poweron-setup-card-subtitle">Choose a password to log in from any device</p>
      </div>

      <form onSubmit={handleSubmit} className="poweron-setup-form">
        <div>
          <label className="poweron-setup-label">Password</label>
          <div className="poweron-setup-input-shell">
            <input
              type={showPw ? 'text' : 'password'}
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
              className={clsx('poweron-setup-input', displayErr && 'is-error')}
            />
            <button type="button" onClick={() => setShowPw(v => !v)} className="poweron-setup-eye-btn" tabIndex={-1}>
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label className="poweron-setup-label">Confirm Password</label>
          <div className="poweron-setup-input-shell">
            <input
              type={showCpw ? 'text' : 'password'}
              value={cpw}
              onChange={e => setCpw(e.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
              required
              className={clsx('poweron-setup-input', displayErr && 'is-error')}
            />
            <button type="button" onClick={() => setShowCpw(v => !v)} className="poweron-setup-eye-btn" tabIndex={-1}>
              {showCpw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {displayErr && <p className="poweron-setup-error">{displayErr}</p>}

        <button type="submit" disabled={saving || !pw || !cpw} className="poweron-setup-submit-btn">
          {saving ? <div className="poweron-setup-spinner" /> : <>Continue <ArrowRight size={16} /></>}
        </button>
      </form>
    </div>
  )
}

type FlowStep = 'password' | 'pin-create' | 'pin-confirm' | 'saving'

export function InitialSetupFlow() {
  const { setupPasscode, user } = useAuth()
  const [step, setStep] = useState<FlowStep>('pin-create')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirmErr, setPinConfirmErr] = useState('')
  const [saveErr, setSaveErr] = useState('')
  const [saving, setSaving] = useState(false)

  const handlePasswordSubmit = async (pw: string) => {
    setSaving(true)
    setSaveErr('')
    try {
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) {
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

  const handlePinCreate = (entered: string) => {
    setPin(entered)
    setPinConfirmErr('')
    setTimeout(() => setStep('pin-confirm'), 300)
  }

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
      if (user?.id) {
        const result = await setPasscode(user.id, pin)
        console.log('[PIN SETUP] setPasscode result:', JSON.stringify(result))
        if (!result.success) {
          setSaveErr('Failed to save PIN. Please try again.')
          setStep('pin-create')
          return
        }
      }
      useAuthStore.setState(state => ({ ...state, status: 'authenticated' }))
    } catch (err) {
      setSaveErr('Setup failed. Please try again.')
      setStep('pin-create')
    }
  }

  const handleSkipPin = async () => {
    setStep('saving')
    try {
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
      <div className="poweron-setup-page">
        <SetupStyles />
        <div className="poweron-setup-auth-card poweron-setup-saving-card">
          <div className="poweron-setup-logo-stage" aria-hidden="true">
            <span className="poweron-setup-logo-orbit" />
            <div className="poweron-setup-logo-plate">
              <img src="/assets/poweron-logo.png" alt="" className="poweron-setup-logo" draggable={false} />
            </div>
          </div>
          <div className="poweron-setup-spinner" />
          <p className="poweron-setup-saving-text">Setting up your account...</p>
        </div>
      </div>
    )
  }

  const stepIdx = step === 'password' ? 0 : 1

  return (
    <div className="poweron-setup-page">
      <SetupStyles />
      <div className="poweron-setup-shell">
        <div className="poweron-setup-progress">
          {['Password', 'PIN (Optional)'].map((label, i) => {
            const isDone = i < stepIdx
            const isActive = i === stepIdx
            return (
              <React.Fragment key={label}>
                <div className="poweron-setup-progress-item">
                  <div className={clsx('poweron-setup-progress-dot', isDone && 'is-done', isActive && 'is-active')}>
                    {isDone ? <Check size={12} /> : i + 1}
                  </div>
                  <span className={clsx('poweron-setup-progress-label', isActive && 'is-active')}>{label}</span>
                </div>
                {i < 1 && <div className={clsx('poweron-setup-progress-line', isDone && 'is-done')} />}
              </React.Fragment>
            )
          })}
        </div>

        <div className="poweron-setup-auth-card">
          <div className="poweron-setup-logo-stage" aria-hidden="true">
            <span className="poweron-setup-logo-orbit" />
            <div className="poweron-setup-logo-plate">
              <img src="/assets/poweron-logo.png" alt="" className="poweron-setup-logo" draggable={false} />
            </div>
          </div>

          {step === 'password' && (
            <PasswordForm onSubmit={handlePasswordSubmit} saving={saving} error={saveErr} />
          )}

          {step === 'pin-create' && (
            <div className="poweron-setup-keypad-step">
              <PinKeypad
                title="Create a PIN (optional)"
                subtitle="Add a 6-digit PIN for quick access on this device"
                onComplete={handlePinCreate}
              />
              <button type="button" onClick={handleSkipPin} className="poweron-setup-text-btn">
                Skip for now - use password only
              </button>
            </div>
          )}

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
      </div>
    </div>
  )
}

function SetupStyles() {
  return (
    <style>{`
      .poweron-setup-page {
        position: relative;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 34px 16px;
        overflow: hidden;
        background:
          radial-gradient(circle at 50% 16%, rgba(37, 142, 255, 0.18), transparent 34%),
          radial-gradient(circle at 15% 70%, rgba(0, 90, 198, 0.12), transparent 28%),
          linear-gradient(140deg, #01040b 0%, #06142a 46%, #020712 100%);
      }
      .poweron-setup-page::before {
        content: '';
        position: absolute;
        inset: 0;
        background-image:
          linear-gradient(rgba(73, 156, 255, 0.06) 1px, transparent 1px),
          linear-gradient(90deg, rgba(73, 156, 255, 0.06) 1px, transparent 1px);
        background-size: 42px 42px;
        opacity: 0.55;
        pointer-events: none;
      }
      .poweron-setup-page::after {
        content: '';
        position: absolute;
        inset: -25% -18%;
        background:
          linear-gradient(90deg, transparent 0%, rgba(68, 161, 255, 0.06) 48%, rgba(162, 215, 255, 0.12) 50%, rgba(68, 161, 255, 0.06) 52%, transparent 100%),
          linear-gradient(180deg, transparent 0%, rgba(42, 145, 255, 0.06) 48%, rgba(125, 197, 255, 0.1) 50%, rgba(42, 145, 255, 0.06) 52%, transparent 100%);
        transform: rotate(16deg);
        animation: setupSweep 10s ease-in-out infinite;
        opacity: 0.46;
        pointer-events: none;
      }
      .poweron-setup-shell {
        position: relative;
        z-index: 2;
        width: min(100%, 760px);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }
      .poweron-setup-progress {
        width: min(100%, 540px);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-bottom: 8px;
      }
      .poweron-setup-progress-item {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .poweron-setup-progress-dot {
        width: 26px;
        height: 26px;
        border-radius: 999px;
        border: 1px solid rgba(97, 181, 255, 0.3);
        background: rgba(8, 20, 38, 0.76);
        color: rgba(199, 227, 249, 0.76);
        font-size: 12px;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .poweron-setup-progress-dot.is-active {
        border-color: rgba(117, 196, 255, 0.72);
        color: #dff2ff;
        box-shadow: 0 0 16px rgba(65, 165, 255, 0.25);
      }
      .poweron-setup-progress-dot.is-done {
        color: #08213d;
        border-color: rgba(117, 196, 255, 0.88);
        background: linear-gradient(180deg, #8bddff, #36a9ff);
      }
      .poweron-setup-progress-label {
        color: rgba(197, 224, 246, 0.62);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .poweron-setup-progress-label.is-active { color: #d7eeff; }
      .poweron-setup-progress-line {
        width: 48px;
        height: 1px;
        background: rgba(97, 170, 240, 0.34);
      }
      .poweron-setup-progress-line.is-done {
        background: linear-gradient(90deg, rgba(117, 196, 255, 0.92), rgba(117, 196, 255, 0.5));
      }
      .poweron-setup-auth-card {
        width: min(100%, 640px);
        border-radius: 26px;
        border: 1px solid rgba(105, 183, 255, 0.26);
        background:
          linear-gradient(150deg, rgba(8, 21, 41, 0.9), rgba(4, 10, 22, 0.84)),
          radial-gradient(circle at top right, rgba(67, 159, 255, 0.15), transparent 44%);
        box-shadow:
          0 34px 90px rgba(0, 0, 0, 0.56),
          0 0 60px rgba(40, 146, 255, 0.16),
          inset 0 1px 0 rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(24px);
        padding: 28px 22px 26px;
        position: relative;
        overflow: hidden;
      }
      .poweron-setup-auth-card::before {
        content: '';
        position: absolute;
        inset: 1px;
        border-radius: 25px;
        background:
          linear-gradient(120deg, rgba(255,255,255,0.06), transparent 22%, transparent 78%, rgba(86, 171, 255, 0.09)),
          linear-gradient(rgba(52, 152, 255, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(52, 152, 255, 0.03) 1px, transparent 1px);
        background-size: auto, 30px 30px, 30px 30px;
        pointer-events: none;
      }
      .poweron-setup-logo-stage {
        position: relative;
        width: 158px;
        height: 108px;
        margin: 0 auto 12px;
        display: grid;
        place-items: center;
        perspective: 700px;
      }
      .poweron-setup-logo-orbit,
      .poweron-setup-logo-orbit::after {
        position: absolute;
        content: '';
        width: 138px;
        height: 56px;
        border: 1px solid rgba(116, 197, 255, 0.3);
        border-radius: 999px;
        box-shadow: 0 0 18px rgba(62, 160, 255, 0.16);
        transform: rotateX(67deg) rotateZ(0deg);
        animation: setupOrbit 12s linear infinite;
        pointer-events: none;
      }
      .poweron-setup-logo-orbit::after {
        width: 112px;
        height: 46px;
        inset: 5px 13px;
        border-color: rgba(62, 160, 255, 0.18);
        animation-duration: 16s;
        animation-direction: reverse;
      }
      .poweron-setup-logo-plate {
        width: 136px;
        height: 72px;
        border-radius: 18px;
        border: 1px solid rgba(124, 201, 255, 0.28);
        background:
          linear-gradient(145deg, rgba(255,255,255,0.08), rgba(10, 27, 56, 0.3)),
          radial-gradient(circle at 76% 18%, rgba(90, 178, 255, 0.2), transparent 45%);
        box-shadow:
          0 16px 34px rgba(0, 0, 0, 0.34),
          0 0 30px rgba(45, 152, 255, 0.24),
          inset 0 1px 0 rgba(255,255,255,0.16);
        display: grid;
        place-items: center;
        transform-style: preserve-3d;
        animation: setupFloat 8s ease-in-out infinite;
        position: relative;
      }
      .poweron-setup-logo-plate::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 18px;
        background: linear-gradient(104deg, transparent 16%, rgba(255,255,255,0.2) 46%, transparent 62%);
        transform: translateX(-60%);
        animation: setupShine 8s ease-in-out infinite;
        opacity: 0.34;
      }
      .poweron-setup-logo {
        width: 108px;
        max-height: 48px;
        object-fit: contain;
        filter: drop-shadow(0 0 12px rgba(78, 172, 255, 0.22));
      }
      .poweron-setup-copy {
        text-align: center;
        margin-bottom: 16px;
      }
      .poweron-setup-card-title {
        margin: 0;
        color: #f1f8ff;
        font-size: 28px;
        line-height: 1.05;
        font-weight: 900;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .poweron-setup-card-subtitle {
        margin: 10px auto 0;
        color: rgba(205, 227, 248, 0.75);
        font-size: 14px;
        line-height: 1.5;
        max-width: 390px;
      }
      .poweron-setup-password-wrap { width: 100%; max-width: 500px; margin: 0 auto; }
      .poweron-setup-form { display: grid; gap: 14px; }
      .poweron-setup-label {
        display: block;
        margin-bottom: 7px;
        color: rgba(201, 226, 246, 0.7);
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .poweron-setup-input-shell { position: relative; }
      .poweron-setup-input {
        width: 100%;
        height: 52px;
        border-radius: 12px;
        border: 1px solid rgba(93, 171, 245, 0.24);
        background: rgba(2, 9, 20, 0.55);
        color: #f3f9ff;
        font-size: 14px;
        padding: 0 40px 0 14px;
        outline: none;
        transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
      }
      .poweron-setup-input::placeholder { color: rgba(164, 196, 222, 0.52); }
      .poweron-setup-input:focus {
        border-color: rgba(129, 206, 255, 0.56);
        box-shadow: 0 0 0 2px rgba(54, 160, 255, 0.18), inset 0 1px 0 rgba(255,255,255,0.06);
        background: rgba(4, 14, 28, 0.62);
      }
      .poweron-setup-input.is-error { border-color: rgba(248, 113, 113, 0.38); }
      .poweron-setup-eye-btn {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        color: rgba(191, 221, 246, 0.7);
      }
      .poweron-setup-eye-btn:hover { color: #d9eeff; }
      .poweron-setup-submit-btn {
        width: 100%;
        margin-top: 2px;
        height: 52px;
        border-radius: 12px;
        border: 1px solid rgba(126, 201, 255, 0.48);
        color: #07243f;
        font-size: 14px;
        font-weight: 900;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background: linear-gradient(180deg, #8dddff 0%, #43afff 100%);
        box-shadow: 0 10px 28px rgba(40, 146, 255, 0.3);
        transition: transform 140ms ease, filter 140ms ease;
      }
      .poweron-setup-submit-btn:hover:not(:disabled) { filter: brightness(1.05); }
      .poweron-setup-submit-btn:active:not(:disabled) { transform: scale(0.99); }
      .poweron-setup-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .poweron-setup-spinner {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        border: 2px solid rgba(13, 40, 70, 0.65);
        border-top-color: transparent;
        animation: spin 900ms linear infinite;
      }
      .poweron-setup-keypad-step { width: 100%; max-width: 420px; margin: 0 auto; }
      .poweron-setup-keypad-wrap { width: 100%; }
      .poweron-setup-dots {
        display: flex;
        justify-content: center;
        gap: 13px;
        min-height: 22px;
        margin-bottom: 12px;
      }
      .poweron-setup-dot {
        width: 16px;
        height: 16px;
        border-radius: 999px;
        border: 1px solid rgba(126, 199, 255, 0.36);
        background: rgba(7, 19, 35, 0.7);
        transition: transform 180ms ease, background 180ms ease, border-color 180ms ease;
      }
      .poweron-setup-dot.is-filled {
        transform: scale(1.14);
        border-color: rgba(112, 205, 255, 0.86);
        background: linear-gradient(180deg, #7dd8ff, #1f91ff);
        box-shadow: 0 0 15px rgba(44, 154, 255, 0.56);
      }
      .poweron-setup-dot.has-error { border-color: rgba(248, 113, 113, 0.75); }
      .poweron-setup-msg-slot {
        min-height: 46px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .poweron-setup-error {
        margin: 0;
        color: #fecaca;
        font-size: 12px;
        font-weight: 700;
      }
      .poweron-setup-keypad-grid {
        margin: 4px auto 0;
        width: min(100%, 294px);
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .poweron-setup-keypad-btn,
      .poweron-setup-keypad-spacer {
        width: 100%;
        aspect-ratio: 1;
        min-height: 78px;
        border-radius: 20px;
      }
      .poweron-setup-keypad-btn {
        border: 1px solid rgba(106, 181, 255, 0.24);
        color: #f1f8ff;
        font-size: 27px;
        font-weight: 900;
        background:
          linear-gradient(150deg, rgba(20, 49, 86, 0.74), rgba(7, 18, 35, 0.82)),
          radial-gradient(circle at 50% 0%, rgba(82, 172, 255, 0.12), transparent 52%);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255,255,255,0.08);
        transition: transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
      }
      .poweron-setup-keypad-btn:hover:not(:disabled) {
        border-color: rgba(123, 202, 255, 0.48);
        box-shadow: 0 13px 30px rgba(0, 0, 0, 0.3), 0 0 22px rgba(42, 148, 255, 0.15), inset 0 1px 0 rgba(255,255,255,0.12);
      }
      .poweron-setup-keypad-btn:active:not(:disabled) { transform: scale(0.96); }
      .poweron-setup-keypad-btn:disabled { opacity: 0.36; cursor: not-allowed; }
      .poweron-setup-keypad-back { font-size: 22px; font-weight: 800; }
      .poweron-setup-text-btn {
        margin: 20px auto 0;
        display: block;
        color: rgba(201, 225, 247, 0.7);
        font-size: 13px;
        font-weight: 700;
        transition: color 150ms ease, text-shadow 150ms ease;
      }
      .poweron-setup-text-btn:hover {
        color: #c4e8ff;
        text-shadow: 0 0 16px rgba(67, 165, 255, 0.3);
      }
      .poweron-setup-saving-card {
        width: min(100%, 430px);
        padding-top: 30px;
        text-align: center;
      }
      .poweron-setup-saving-text {
        margin-top: 12px;
        color: rgba(203, 227, 247, 0.78);
        font-size: 14px;
      }
      @keyframes setupSweep {
        0%, 100% { transform: translateX(-18%) rotate(16deg); opacity: 0.24; }
        50% { transform: translateX(18%) rotate(16deg); opacity: 0.5; }
      }
      @keyframes setupOrbit {
        to { transform: rotateX(67deg) rotateZ(360deg); }
      }
      @keyframes setupFloat {
        0%, 100% { transform: rotateX(8deg) rotateY(-10deg) translateY(0); }
        50% { transform: rotateX(-4deg) rotateY(10deg) translateY(-4px); }
      }
      @keyframes setupShine {
        0%, 35% { transform: translateX(-64%); opacity: 0; }
        52% { opacity: 0.38; }
        75%, 100% { transform: translateX(68%); opacity: 0; }
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (max-width: 767px) {
        .poweron-setup-page { padding: 16px 12px; }
        .poweron-setup-shell { width: min(100%, 420px); gap: 12px; }
        .poweron-setup-auth-card {
          width: 100%;
          border-radius: 22px;
          padding: 20px 14px 18px;
        }
        .poweron-setup-copy { margin-bottom: 14px; }
        .poweron-setup-card-title { font-size: 24px; }
        .poweron-setup-card-subtitle { font-size: 13px; max-width: 330px; }
        .poweron-setup-progress {
          width: 100%;
          justify-content: center;
          gap: 8px;
        }
        .poweron-setup-progress-line { width: 26px; }
        .poweron-setup-logo-stage {
          width: 136px;
          height: 95px;
          margin-bottom: 10px;
        }
        .poweron-setup-logo-plate {
          width: 118px;
          height: 64px;
        }
        .poweron-setup-logo { width: 94px; max-height: 42px; }
        .poweron-setup-keypad-grid {
          width: min(100%, 270px);
          gap: 10px;
        }
        .poweron-setup-keypad-btn,
        .poweron-setup-keypad-spacer {
          min-height: 70px;
          border-radius: 18px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .poweron-setup-page::after,
        .poweron-setup-logo-orbit,
        .poweron-setup-logo-orbit::after,
        .poweron-setup-logo-plate,
        .poweron-setup-logo-plate::after {
          animation: none;
        }
      }
    `}</style>
  )
}
