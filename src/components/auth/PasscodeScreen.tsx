/**
 * PasscodeScreen - 6-digit PIN entry with:
 *   - Auto-advance on digit input
 *   - Backspace / delete navigation
 *   - Shake animation on wrong attempt
 *   - Lockout countdown timer
 *   - Remaining attempts display
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'

const CODE_LENGTH = 6

interface PasscodeScreenProps {
  mode: 'verify' | 'setup' | 'confirm'
  onComplete: (passcode: string) => void
  onCancel?: () => void
  title?: string
  subtitle?: string
  /** First passcode (for confirm mode) */
  toConfirm?: string
}

export function PasscodeScreen({
  mode,
  onComplete,
  onCancel,
  title,
  subtitle,
  toConfirm,
}: PasscodeScreenProps) {
  const { error, lockExpiresAt, clearError, profile } = useAuth()

  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [shake, setShake] = useState(false)
  const [timeLeft, setTimeLeft] = useState<number>(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const inputRefs = useRef<(HTMLInputElement | null)[]>(Array(CODE_LENGTH).fill(null))

  useEffect(() => {
    if (!lockExpiresAt) return
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockExpiresAt.getTime() - Date.now()) / 1000))
      setTimeLeft(remaining)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lockExpiresAt])

  useEffect(() => {
    if (error) {
      setIsSubmitting(false)
      setShake(true)
      setDigits(Array(CODE_LENGTH).fill(''))
      setTimeout(() => {
        setShake(false)
        inputRefs.current[0]?.focus()
      }, 500)
    }
  }, [error])

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  const handleChangeRef = useRef<(index: number, value: string) => void>(() => {})
  const digitsRef = useRef(digits)
  useEffect(() => { digitsRef.current = digits }, [digits])

  const handleChange = useCallback((index: number, value: string) => {
    if (!/^\d?$/.test(value)) return

    clearError()
    const next = [...digits]
    next[index] = value
    setDigits(next)

    if (value && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }

    if (value && next.every(d => d !== '')) {
      const code = next.join('')

      if (mode === 'confirm' && toConfirm) {
        if (code === toConfirm) {
          setIsSubmitting(true)
          onComplete(code)
        } else {
          setDigits(Array(CODE_LENGTH).fill(''))
          setTimeout(() => inputRefs.current[0]?.focus(), 50)
          setShake(true)
          setTimeout(() => setShake(false), 500)
        }
        return
      }

      setIsSubmitting(true)
      onComplete(code)
    }
  }, [digits, mode, toConfirm, onComplete, clearError])

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (/^Numpad[0-9]$/.test(e.code)) {
      e.preventDefault()
      handleChange(index, e.code.slice(-1))
      return
    }
    if (e.code === 'NumpadDecimal') {
      e.preventDefault()
      if (digits[index]) {
        const next = [...digits]
        next[index] = ''
        setDigits(next)
      } else if (index > 0) {
        const next = [...digits]
        next[index - 1] = ''
        setDigits(next)
        inputRefs.current[index - 1]?.focus()
      }
      return
    }
    if (e.key === 'Backspace') {
      if (digits[index]) {
        const next = [...digits]
        next[index] = ''
        setDigits(next)
      } else if (index > 0) {
        const next = [...digits]
        next[index - 1] = ''
        setDigits(next)
        inputRefs.current[index - 1]?.focus()
      }
    }
  }, [digits, handleChange])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH)
    if (pasted.length === CODE_LENGTH) {
      const next = pasted.split('')
      setDigits(next)
      inputRefs.current[CODE_LENGTH - 1]?.focus()
      setIsSubmitting(true)
      onComplete(pasted)
    }
  }, [onComplete])

  handleChangeRef.current = handleChange

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      const isOwnInput = inputRefs.current.some(ref => ref === activeEl)
      if (isOwnInput) return

      if (/^(Digit|Numpad)[0-9]$/.test(e.code)) {
        e.preventDefault()
        const idx = digitsRef.current.findIndex(d => d === '')
        if (idx >= 0) handleChangeRef.current(idx, e.code.slice(-1))
        return
      }
      if (e.code === 'Backspace' || e.code === 'NumpadDecimal') {
        e.preventDefault()
        const cur = digitsRef.current
        const revIdx = [...cur].reverse().findIndex(d => d !== '')
        if (revIdx >= 0) {
          const realIdx = CODE_LENGTH - 1 - revIdx
          const next = [...cur]
          next[realIdx] = ''
          setDigits(next)
          inputRefs.current[realIdx]?.focus()
        }
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const screenTitle = title ?? (
    mode === 'verify' ? 'Enter Passcode' :
    mode === 'setup' ? 'Create Passcode' :
    'Confirm Passcode'
  )

  const screenSub = subtitle ?? (
    mode === 'verify' ? `Welcome back${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}` :
    mode === 'setup' ? 'Set a 6-digit passcode to secure your account' :
    'Re-enter your passcode to confirm'
  )

  const isLocked = !!lockExpiresAt && timeLeft > 0

  return (
    <div className="poweron-passcode-page">
      <style>{`
        .poweron-passcode-page {
          position: relative;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 36px 16px;
          overflow: hidden;
          background:
            radial-gradient(circle at 50% 16%, rgba(37, 142, 255, 0.18), transparent 34%),
            radial-gradient(circle at 15% 70%, rgba(0, 90, 198, 0.12), transparent 28%),
            linear-gradient(140deg, #01040b 0%, #06142a 46%, #020712 100%);
        }
        .poweron-passcode-page::before {
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
        .poweron-passcode-page::after {
          content: '';
          position: absolute;
          inset: -25% -18%;
          background:
            linear-gradient(90deg, transparent 0%, rgba(68, 161, 255, 0.06) 48%, rgba(162, 215, 255, 0.12) 50%, rgba(68, 161, 255, 0.06) 52%, transparent 100%),
            linear-gradient(180deg, transparent 0%, rgba(42, 145, 255, 0.06) 48%, rgba(125, 197, 255, 0.1) 50%, rgba(42, 145, 255, 0.06) 52%, transparent 100%);
          transform: rotate(16deg);
          animation: passcodeSweep 10s ease-in-out infinite;
          opacity: 0.46;
          pointer-events: none;
        }
        .poweron-passcode-shell {
          position: relative;
          z-index: 2;
          width: min(100%, 440px);
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
          padding: 28px 22px 24px;
          overflow: hidden;
        }
        .poweron-passcode-shell::before {
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
        .poweron-passcode-logo-stage {
          position: relative;
          width: 150px;
          height: 104px;
          margin: 0 auto 14px;
          display: grid;
          place-items: center;
          perspective: 700px;
        }
        .poweron-passcode-logo-orbit,
        .poweron-passcode-logo-orbit::after {
          position: absolute;
          content: '';
          width: 132px;
          height: 54px;
          border: 1px solid rgba(116, 197, 255, 0.3);
          border-radius: 999px;
          box-shadow: 0 0 18px rgba(62, 160, 255, 0.16);
          transform: rotateX(67deg) rotateZ(0deg);
          animation: passcodeOrbit 12s linear infinite;
          pointer-events: none;
        }
        .poweron-passcode-logo-orbit::after {
          width: 108px;
          height: 44px;
          inset: 5px 12px;
          border-color: rgba(62, 160, 255, 0.18);
          animation-duration: 16s;
          animation-direction: reverse;
        }
        .poweron-passcode-logo-plate {
          width: 130px;
          height: 70px;
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
          animation: passcodeFloat 8s ease-in-out infinite;
          position: relative;
        }
        .poweron-passcode-logo-plate::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 18px;
          background: linear-gradient(104deg, transparent 16%, rgba(255,255,255,0.2) 46%, transparent 62%);
          transform: translateX(-60%);
          animation: passcodeShine 8s ease-in-out infinite;
          opacity: 0.34;
        }
        .poweron-passcode-logo {
          width: 104px;
          max-height: 46px;
          object-fit: contain;
          filter: drop-shadow(0 0 12px rgba(78, 172, 255, 0.22));
        }
        .poweron-passcode-copy { text-align: center; margin-bottom: 16px; }
        .poweron-passcode-title {
          margin: 0;
          color: #f1f8ff;
          font-size: 30px;
          line-height: 1.02;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .poweron-passcode-subtitle {
          margin: 10px auto 0;
          color: rgba(205, 227, 248, 0.75);
          font-size: 14px;
          line-height: 1.5;
          max-width: 350px;
        }
        .poweron-passcode-lock {
          border-radius: 16px;
          border: 1px solid rgba(248, 113, 113, 0.3);
          background: linear-gradient(150deg, rgba(81, 21, 21, 0.4), rgba(38, 10, 10, 0.5));
          padding: 16px;
          text-align: center;
          margin-bottom: 8px;
        }
        .poweron-passcode-lock-icon { color: #fca5a5; margin: 0 auto 8px; }
        .poweron-passcode-lock-title {
          color: #fecaca;
          font-size: 13px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .poweron-passcode-lock-copy {
          color: rgba(255, 213, 213, 0.8);
          font-size: 12px;
          margin: 6px 0;
        }
        .poweron-passcode-lock-time {
          color: #fff1f1;
          font-size: 34px;
          font-weight: 900;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .poweron-passcode-dots {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin: 2px 0 14px;
        }
        .poweron-passcode-input {
          width: 44px;
          height: 54px;
          border-radius: 12px;
          border: 1px solid rgba(93, 171, 245, 0.24);
          background: rgba(2, 9, 20, 0.55);
          color: #f3f9ff;
          font-size: 24px;
          font-weight: 900;
          text-align: center;
          outline: none;
          transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
        }
        .poweron-passcode-input:focus {
          border-color: rgba(129, 206, 255, 0.56);
          box-shadow: 0 0 0 2px rgba(54, 160, 255, 0.18), inset 0 1px 0 rgba(255,255,255,0.06);
          background: rgba(4, 14, 28, 0.62);
        }
        .poweron-passcode-input.has-value {
          border-color: rgba(112, 205, 255, 0.86);
          box-shadow: 0 0 15px rgba(44, 154, 255, 0.4), inset 0 1px 0 rgba(255,255,255,0.08);
        }
        .poweron-passcode-input.has-error { border-color: rgba(248, 113, 113, 0.54); }
        .poweron-passcode-input:disabled { opacity: 0.4; cursor: not-allowed; }
        .poweron-passcode-error {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #fecaca;
          font-size: 13px;
          font-weight: 700;
          min-height: 22px;
          margin: 2px 0 10px;
        }
        .poweron-passcode-submit-state {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: rgba(203, 227, 247, 0.8);
          font-size: 13px;
          margin-bottom: 6px;
        }
        .poweron-passcode-spinner {
          width: 16px;
          height: 16px;
          border-radius: 999px;
          border: 2px solid rgba(116, 198, 255, 0.65);
          border-top-color: transparent;
          animation: spin 900ms linear infinite;
        }
        .poweron-passcode-actions {
          display: flex;
          justify-content: center;
          margin-top: 8px;
        }
        .poweron-passcode-text-btn {
          color: rgba(201, 225, 247, 0.7);
          font-size: 13px;
          font-weight: 700;
          transition: color 150ms ease, text-shadow 150ms ease;
        }
        .poweron-passcode-text-btn:hover {
          color: #c4e8ff;
          text-shadow: 0 0 16px rgba(67, 165, 255, 0.3);
        }
        .poweron-passcode-brand {
          margin-top: 12px;
          text-align: center;
          color: rgba(168, 203, 230, 0.54);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        @keyframes passcodeSweep {
          0%, 100% { transform: translateX(-18%) rotate(16deg); opacity: 0.24; }
          50% { transform: translateX(18%) rotate(16deg); opacity: 0.5; }
        }
        @keyframes passcodeOrbit { to { transform: rotateX(67deg) rotateZ(360deg); } }
        @keyframes passcodeFloat {
          0%, 100% { transform: rotateX(8deg) rotateY(-10deg) translateY(0); }
          50% { transform: rotateX(-4deg) rotateY(10deg) translateY(-4px); }
        }
        @keyframes passcodeShine {
          0%, 35% { transform: translateX(-64%); opacity: 0; }
          52% { opacity: 0.38; }
          75%, 100% { transform: translateX(68%); opacity: 0; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 767px) {
          .poweron-passcode-page { padding: 16px 12px; }
          .poweron-passcode-shell {
            width: min(100%, 400px);
            border-radius: 22px;
            padding: 20px 14px 18px;
          }
          .poweron-passcode-logo-stage {
            width: 136px;
            height: 95px;
            margin-bottom: 10px;
          }
          .poweron-passcode-logo-plate {
            width: 118px;
            height: 64px;
          }
          .poweron-passcode-logo {
            width: 94px;
            max-height: 42px;
          }
          .poweron-passcode-title { font-size: 25px; }
          .poweron-passcode-subtitle { font-size: 13px; }
          .poweron-passcode-dots { gap: 8px; }
          .poweron-passcode-input {
            width: 40px;
            height: 50px;
            font-size: 22px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .poweron-passcode-page::after,
          .poweron-passcode-logo-orbit,
          .poweron-passcode-logo-orbit::after,
          .poweron-passcode-logo-plate,
          .poweron-passcode-logo-plate::after,
          .poweron-passcode-spinner {
            animation: none;
          }
        }
      `}</style>

      <div className="poweron-passcode-shell">
        <div className="poweron-passcode-logo-stage" aria-hidden="true">
          <span className="poweron-passcode-logo-orbit" />
          <div className="poweron-passcode-logo-plate">
            <img src="/assets/poweron-logo.png" alt="" className="poweron-passcode-logo" draggable={false} />
          </div>
        </div>

        <div className="poweron-passcode-copy">
          <h1 className="poweron-passcode-title">{screenTitle}</h1>
          <p className="poweron-passcode-subtitle">{screenSub}</p>
        </div>

        {isLocked ? (
          <div className="poweron-passcode-lock">
            <AlertTriangle className="poweron-passcode-lock-icon" size={20} />
            <div className="poweron-passcode-lock-title">Account Temporarily Locked</div>
            <div className="poweron-passcode-lock-copy">Too many failed attempts. Try again in:</div>
            <div className="poweron-passcode-lock-time">{formatTime(timeLeft)}</div>
          </div>
        ) : (
          <>
            <div className={clsx('poweron-passcode-dots', shake && 'animate-shake')} onPaste={handlePaste}>
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { inputRefs.current[i] = el }}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleChange(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  disabled={isSubmitting}
                  aria-label={`Digit ${i + 1}`}
                  className={clsx(
                    'poweron-passcode-input',
                    digit && 'has-value',
                    error && 'has-error',
                  )}
                />
              ))}
            </div>

            <div className="poweron-passcode-error">
              {error && (
                <>
                  <AlertTriangle size={15} />
                  <span>{error}</span>
                </>
              )}
            </div>

            {isSubmitting && (
              <div className="poweron-passcode-submit-state">
                <div className="poweron-passcode-spinner" />
                <span>Verifying...</span>
              </div>
            )}
          </>
        )}

        <div className="poweron-passcode-actions">
          {onCancel && !isLocked && (
            <button type="button" onClick={onCancel} className="poweron-passcode-text-btn">
              {mode === 'verify' ? 'Use a different account' : 'Cancel'}
            </button>
          )}
        </div>

        <div className="poweron-passcode-brand">PowerOn Hub · v3.0</div>
      </div>
    </div>
  )
}
