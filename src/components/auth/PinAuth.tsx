/**
 * PinAuth - Local PIN authentication (6 digit).
 *
 * Flows:
 *   1. verify - User has a PIN stored; enter to authenticate.
 *   2. setup-create - No PIN stored; enter new PIN.
 *   3. setup-confirm - Confirm the new PIN; save on match.
 */

import React, { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'

const PIN_LENGTH = 6
const STORAGE_KEY = 'poweron_pin_hash'
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 3_600_000

async function sha256(message: string): Promise<string> {
  const buf = new TextEncoder().encode(message)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function getStoredHash(): string | null {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

function saveHash(hash: string): void {
  try { localStorage.setItem(STORAGE_KEY, hash) } catch {}
}

type FlowMode = 'verify' | 'setup-create' | 'setup-confirm'

interface PinAuthProps {
  /** Called when the user taps "Use magic link instead" or "Use password instead" */
  onFallbackToMagicLink?: () => void
  /**
   * When provided, called with the raw PIN on successful local verification
   * instead of dispatching the window event.
   */
  onVerify?: (pin: string) => void | Promise<void>
}

export function PinAuth({ onFallbackToMagicLink, onVerify }: PinAuthProps) {
  const hasPinStored = Boolean(getStoredHash())
  const [mode, setMode] = useState<FlowMode>((hasPinStored || onVerify) ? 'verify' : 'setup-create')

  const [digits, setDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [firstPin, setFirstPin] = useState('')

  const [shake, setShake] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [attempts, setAttempts] = useState(0)
  const [lockoutEnd, setLockoutEnd] = useState<number | null>(null)
  const [timeLeft, setTimeLeft] = useState(0)

  useEffect(() => {
    if (!lockoutEnd) return
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockoutEnd - Date.now()) / 1000))
      setTimeLeft(remaining)
      if (remaining === 0) {
        setLockoutEnd(null)
        setAttempts(0)
        setError('')
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lockoutEnd])

  const handleDigitRef = useRef<(d: string) => void>(() => {})
  const handleBackspaceRef = useRef<() => void>(() => {})

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (/^(Digit|Numpad)[0-9]$/.test(e.code)) {
        e.preventDefault()
        handleDigitRef.current(e.code.slice(-1))
        return
      }
      if (e.code === 'Backspace' || e.code === 'NumpadDecimal') {
        e.preventDefault()
        handleBackspaceRef.current()
        return
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        // Auto-submit is handled inside handleDigit when the PIN completes.
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const resetDigits = () => setDigits(Array(PIN_LENGTH).fill(''))

  const triggerShake = () => {
    setShake(true)
    setTimeout(() => {
      setShake(false)
      resetDigits()
    }, 500)
  }

  const handleSubmit = async (pin: string) => {
    setError('')

    if (mode === 'setup-create') {
      setFirstPin(pin)
      setMode('setup-confirm')
      resetDigits()
      setIsSubmitting(false)
      return
    }

    if (mode === 'setup-confirm') {
      if (pin === firstPin) {
        const hash = await sha256(pin)
        saveHash(hash)
        window.dispatchEvent(new CustomEvent('poweron:pin-auth-success'))
      } else {
        setError("PINs don't match. Start over.")
        setFirstPin('')
        setMode('setup-create')
        triggerShake()
      }
      setIsSubmitting(false)
      return
    }

        if (onVerify) {
      try {
        await onVerify(pin)
        // Let authStore/LoginFlow handle the status transition.
        // Do not immediately read status here because Zustand/Supabase transitions
        // can still be in progress right after onVerify resolves.
      } catch {
        setError('Verification failed. Please try again.')
        triggerShake()
        setIsSubmitting(false)
      }
      return
    }

        const stored = getStoredHash()
        if (!stored) {
          setMode('setup-create')
          resetDigits()
          setIsSubmitting(false)
          return
        }

    const hash = await sha256(pin)
    if (hash === stored) {
      setAttempts(0)
      window.dispatchEvent(new CustomEvent('poweron:pin-auth-success'))
    } else {
      const next = attempts + 1
      setAttempts(next)

      if (next >= MAX_ATTEMPTS) {
        const end = Date.now() + LOCKOUT_MS
        setLockoutEnd(end)
        setTimeLeft(Math.ceil(LOCKOUT_MS / 1000))
        setError('Too many attempts. Locked out for 1 hour.')
      } else {
        const left = MAX_ATTEMPTS - next
        setError(`Incorrect PIN. ${left} attempt${left !== 1 ? 's' : ''} remaining.`)
      }

      triggerShake()
      setIsSubmitting(false)
    }
  }

  const handleDigit = (d: string) => {
    if (lockoutEnd || isSubmitting) return

    const filledCount = digits.filter(x => x !== '').length
    if (filledCount >= PIN_LENGTH) return

    const next = [...digits]
    const idx = next.findIndex(x => x === '')
    next[idx] = d
    setDigits(next)

    if (filledCount === PIN_LENGTH - 1) {
      const pin = digits.filter(x => x !== '').concat(d).join('')
      setIsSubmitting(true)
      handleSubmit(pin)
    }
  }

  const handleBackspace = () => {
    if (lockoutEnd || isSubmitting) return
    const next = [...digits]
    for (let i = PIN_LENGTH - 1; i >= 0; i--) {
      if (next[i] !== '') {
        next[i] = ''
        setDigits(next)
        break
      }
    }
    setError('')
  }

  handleDigitRef.current = handleDigit
  handleBackspaceRef.current = handleBackspace

  const isLocked = Boolean(lockoutEnd && timeLeft > 0)
  const filledCount = digits.filter(x => x !== '').length

  const title = mode === 'verify'
    ? 'Enter your PIN'
    : mode === 'setup-create'
    ? 'Create your PIN'
    : 'Confirm your PIN'

  const subtitle = mode === 'verify'
    ? 'Enter your 6-digit PIN to unlock PowerOn Hub.'
    : mode === 'setup-create'
    ? 'Choose a 6-digit PIN to secure your account'
    : 'Enter the same PIN again to confirm'

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back']

  return (
    <div className="poweron-pin-page">
      <style>{`
        .poweron-pin-page {
          position: relative;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 36px 20px;
          overflow: hidden;
          color: #eef7ff;
          background:
            radial-gradient(circle at 50% 22%, rgba(30, 139, 255, 0.16), transparent 34%),
            radial-gradient(circle at 18% 72%, rgba(0, 96, 210, 0.12), transparent 30%),
            linear-gradient(135deg, #01040b 0%, #061329 48%, #020712 100%);
        }

        .poweron-pin-page::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(76, 159, 255, 0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(76, 159, 255, 0.07) 1px, transparent 1px);
          background-size: 42px 42px;
          mask-image: radial-gradient(circle at 50% 42%, black 0%, rgba(0,0,0,0.72) 45%, transparent 82%);
          opacity: 0.6;
          pointer-events: none;
        }

        .poweron-pin-page::after {
          content: '';
          position: absolute;
          inset: -35% -20%;
          background:
            linear-gradient(90deg, transparent 0%, rgba(59, 153, 255, 0.08) 48%, rgba(155, 213, 255, 0.18) 50%, rgba(59, 153, 255, 0.08) 52%, transparent 100%),
            linear-gradient(180deg, transparent 0%, rgba(44, 147, 255, 0.08) 48%, rgba(124, 196, 255, 0.18) 50%, rgba(44, 147, 255, 0.08) 52%, transparent 100%);
          transform: rotate(18deg);
          animation: pinScan 9s ease-in-out infinite;
          opacity: 0.52;
          pointer-events: none;
        }

        .poweron-pin-card {
          position: relative;
          z-index: 2;
          width: min(100%, 430px);
          padding: 34px 32px 28px;
          border: 1px solid rgba(106, 184, 255, 0.24);
          border-radius: 26px;
          background:
            linear-gradient(150deg, rgba(8, 22, 43, 0.9), rgba(4, 11, 24, 0.84)),
            radial-gradient(circle at top right, rgba(66, 160, 255, 0.18), transparent 42%);
          box-shadow:
            0 30px 90px rgba(0, 0, 0, 0.56),
            0 0 55px rgba(36, 139, 255, 0.16),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(24px);
          overflow: hidden;
        }

        .poweron-pin-card::before {
          content: '';
          position: absolute;
          inset: 1px;
          border-radius: 25px;
          background:
            linear-gradient(120deg, rgba(255,255,255,0.08), transparent 20%, transparent 76%, rgba(92, 176, 255, 0.09)),
            linear-gradient(rgba(52, 151, 255, 0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(52, 151, 255, 0.035) 1px, transparent 1px);
          background-size: auto, 28px 28px, 28px 28px;
          pointer-events: none;
        }

        .poweron-pin-logo-stage {
          position: relative;
          width: 150px;
          height: 112px;
          margin: 0 auto 22px;
          display: grid;
          place-items: center;
          perspective: 700px;
        }

        .poweron-pin-orbit,
        .poweron-pin-orbit::after {
          position: absolute;
          content: '';
          width: 136px;
          height: 58px;
          border: 1px solid rgba(117, 196, 255, 0.34);
          border-radius: 999px;
          box-shadow: 0 0 20px rgba(60, 158, 255, 0.18);
          transform: rotateX(67deg) rotateZ(0deg);
          animation: pinOrbit 11s linear infinite;
          pointer-events: none;
        }

        .poweron-pin-orbit::after {
          width: 112px;
          height: 48px;
          inset: 4px 11px;
          border-color: rgba(62, 160, 255, 0.22);
          animation-duration: 15s;
          animation-direction: reverse;
        }

        .poweron-pin-logo-plate {
          position: relative;
          width: 132px;
          height: 72px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(126, 200, 255, 0.28);
          border-radius: 18px;
          background:
            linear-gradient(145deg, rgba(255,255,255,0.09), rgba(11, 29, 58, 0.3)),
            radial-gradient(circle at 76% 18%, rgba(90, 178, 255, 0.24), transparent 45%);
          box-shadow:
            0 18px 38px rgba(0, 0, 0, 0.36),
            0 0 34px rgba(46, 154, 255, 0.28),
            inset 0 1px 0 rgba(255,255,255,0.18);
          transform-style: preserve-3d;
          animation: pinLogoFloat 8s ease-in-out infinite;
        }

        .poweron-pin-logo-plate::before {
          content: '';
          position: absolute;
          inset: -8px;
          border-radius: 24px;
          background: radial-gradient(circle, rgba(72, 169, 255, 0.18), transparent 68%);
          transform: translateZ(-18px);
          filter: blur(8px);
        }

        .poweron-pin-logo-plate::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 18px;
          background: linear-gradient(105deg, transparent 10%, rgba(255,255,255,0.2) 44%, transparent 58%);
          transform: translateX(-60%);
          animation: pinLogoSweep 7s ease-in-out infinite;
          opacity: 0.48;
          pointer-events: none;
        }

        .poweron-pin-logo {
          position: relative;
          z-index: 2;
          width: 104px;
          max-height: 50px;
          object-fit: contain;
          filter: drop-shadow(0 0 14px rgba(75, 171, 255, 0.24));
        }

        .poweron-pin-title {
          position: relative;
          z-index: 1;
          margin: 0;
          color: #f3f9ff;
          font-size: 30px;
          line-height: 1;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-align: center;
          text-transform: uppercase;
        }

        .poweron-pin-subtitle {
          position: relative;
          z-index: 1;
          max-width: 290px;
          margin: 12px auto 26px;
          color: rgba(209, 229, 249, 0.74);
          font-size: 14px;
          line-height: 1.55;
          text-align: center;
        }

        .poweron-pin-dots {
          position: relative;
          z-index: 1;
          display: flex;
          justify-content: center;
          gap: 13px;
          min-height: 22px;
          margin-bottom: 12px;
        }

        .poweron-pin-dot {
          width: 16px;
          height: 16px;
          border-radius: 999px;
          border: 1px solid rgba(127, 189, 255, 0.36);
          background: rgba(7, 18, 34, 0.72);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
          transition: transform 180ms ease, background 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
        }

        .poweron-pin-dot.is-filled {
          transform: scale(1.16);
          border-color: rgba(105, 200, 255, 0.9);
          background: linear-gradient(180deg, #77d4ff, #1f8fff);
          box-shadow: 0 0 18px rgba(43, 151, 255, 0.58), inset 0 1px 0 rgba(255,255,255,0.36);
        }

        .poweron-pin-dot.has-error {
          border-color: rgba(248, 113, 113, 0.78);
          box-shadow: 0 0 16px rgba(248, 113, 113, 0.24);
        }

        .poweron-pin-message {
          position: relative;
          z-index: 1;
          min-height: 54px;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .poweron-pin-error {
          margin: 0;
          padding: 10px 13px;
          border: 1px solid rgba(248, 113, 113, 0.24);
          border-radius: 13px;
          color: #fecaca;
          background: rgba(127, 29, 29, 0.18);
          font-size: 12px;
          font-weight: 700;
        }

        .poweron-pin-lockout-title {
          color: #fecaca;
          font-size: 13px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .poweron-pin-lockout-time {
          margin-top: 4px;
          color: #f8fbff;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 38px;
          font-weight: 900;
        }

        .poweron-pin-lockout-copy {
          margin-top: 3px;
          color: rgba(209, 229, 249, 0.55);
          font-size: 12px;
        }

        .poweron-pin-keypad {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin: 6px auto 0;
          width: 100%;
          max-width: 282px;
        }

        .poweron-pin-key,
        .poweron-pin-spacer {
          min-width: 0;
          width: 100%;
          aspect-ratio: 1;
          min-height: 76px;
          border-radius: 20px;
        }

        .poweron-pin-key {
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(105, 178, 255, 0.23);
          color: #f3f9ff;
          background:
            linear-gradient(150deg, rgba(20, 49, 86, 0.74), rgba(7, 18, 35, 0.82)),
            radial-gradient(circle at 50% 0%, rgba(82, 172, 255, 0.14), transparent 52%);
          box-shadow:
            0 10px 24px rgba(0, 0, 0, 0.26),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
          font-size: 26px;
          font-weight: 900;
          transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
        }

        .poweron-pin-key:hover:not(:disabled),
        .poweron-pin-key:focus-visible:not(:disabled) {
          border-color: rgba(123, 202, 255, 0.5);
          background:
            linear-gradient(150deg, rgba(26, 65, 112, 0.88), rgba(9, 25, 49, 0.9)),
            radial-gradient(circle at 50% 0%, rgba(92, 185, 255, 0.22), transparent 54%);
          box-shadow:
            0 13px 30px rgba(0, 0, 0, 0.3),
            0 0 24px rgba(42, 148, 255, 0.16),
            inset 0 1px 0 rgba(255, 255, 255, 0.12);
          outline: none;
        }

        .poweron-pin-key:active:not(:disabled) {
          transform: scale(0.96);
        }

        .poweron-pin-key:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        .poweron-pin-backspace {
          font-size: 22px;
          font-weight: 800;
        }

        .poweron-pin-fallback {
          position: relative;
          z-index: 1;
          display: block;
          margin: 24px auto 0;
          color: rgba(202, 224, 247, 0.66);
          font-size: 13px;
          font-weight: 700;
          transition: color 160ms ease, text-shadow 160ms ease;
        }

        .poweron-pin-fallback:hover,
        .poweron-pin-fallback:focus-visible {
          color: #bfe5ff;
          text-shadow: 0 0 18px rgba(67, 165, 255, 0.32);
          outline: none;
        }

        @keyframes pinScan {
          0%, 100% { transform: translateX(-18%) rotate(18deg); opacity: 0.28; }
          50% { transform: translateX(18%) rotate(18deg); opacity: 0.58; }
        }

        @keyframes pinLogoFloat {
          0%, 100% { transform: rotateX(8deg) rotateY(-10deg) translateY(0); }
          50% { transform: rotateX(-5deg) rotateY(10deg) translateY(-5px); }
        }

        @keyframes pinOrbit {
          to { transform: rotateX(67deg) rotateZ(360deg); }
        }

        @keyframes pinLogoSweep {
          0%, 32% { transform: translateX(-72%); opacity: 0; }
          48% { opacity: 0.42; }
          68%, 100% { transform: translateX(72%); opacity: 0; }
        }

        @media (max-width: 640px) {
          .poweron-pin-page {
            padding: 18px 14px;
          }

          .poweron-pin-card {
            width: min(100%, 380px);
            padding: 26px 18px 22px;
            border-radius: 22px;
          }

          .poweron-pin-logo-stage {
            width: 132px;
            height: 96px;
            margin-bottom: 16px;
          }

          .poweron-pin-logo-plate {
            width: 116px;
            height: 64px;
          }

          .poweron-pin-logo {
            width: 92px;
            max-height: 44px;
          }

          .poweron-pin-title {
            font-size: 25px;
          }

          .poweron-pin-keypad {
            max-width: 264px;
            gap: 10px;
          }

          .poweron-pin-key,
          .poweron-pin-spacer {
            min-height: 68px;
            border-radius: 18px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .poweron-pin-page::after,
          .poweron-pin-logo-plate,
          .poweron-pin-logo-plate::after,
          .poweron-pin-orbit,
          .poweron-pin-orbit::after {
            animation: none;
          }
        }
      `}</style>

      <div className="poweron-pin-card">
        <div className="poweron-pin-logo-stage" aria-hidden="true">
          <span className="poweron-pin-orbit" />
          <div className="poweron-pin-logo-plate">
            <img
              src="/assets/poweron-logo.png"
              alt=""
              className="poweron-pin-logo"
              draggable={false}
            />
          </div>
        </div>

        <div className="text-center">
          <h1 className="poweron-pin-title">{title}</h1>
          <p className="poweron-pin-subtitle">{subtitle}</p>
        </div>

        <div className={clsx('poweron-pin-dots', shake && 'animate-shake')} aria-label={`${filledCount} of ${PIN_LENGTH} PIN digits entered`}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={clsx(
                'poweron-pin-dot',
                i < filledCount && 'is-filled',
                error && 'has-error',
              )}
            />
          ))}
        </div>

        {isLocked ? (
          <div className="poweron-pin-message">
            <div>
              <div className="poweron-pin-lockout-title">Too many attempts</div>
              <div className="poweron-pin-lockout-time">{timeLeft}s</div>
              <div className="poweron-pin-lockout-copy">Try again when the timer ends</div>
            </div>
          </div>
        ) : (
          <div className="poweron-pin-message">
            {error && (
              <p className="poweron-pin-error">{error}</p>
            )}
          </div>
        )}

        <div className="poweron-pin-keypad">
          {KEYS.map((key, i) => {
            if (key === '') {
              return <div key={i} className="poweron-pin-spacer" />
            }

            if (key === 'back') {
              return (
                <button
                  type="button"
                  key={i}
                  onClick={handleBackspace}
                  disabled={isLocked || isSubmitting}
                  aria-label="Backspace"
                  className="poweron-pin-key poweron-pin-backspace"
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
                disabled={isLocked || isSubmitting}
                className="poweron-pin-key"
              >
                {key}
              </button>
            )
          })}
        </div>

        {onFallbackToMagicLink && (
          <button
            type="button"
            onClick={onFallbackToMagicLink}
            className="poweron-pin-fallback"
          >
            {onVerify ? 'Sign out and use password instead' : 'Use email instead'}
          </button>
        )}
      </div>
    </div>
  )
}
