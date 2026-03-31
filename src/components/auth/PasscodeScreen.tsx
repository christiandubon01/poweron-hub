/**
 * PasscodeScreen — 6-digit PIN entry with:
 *   • Auto-advance on digit input
 *   • Backspace / delete navigation
 *   • Shake animation on wrong attempt
 *   • Lockout countdown timer
 *   • Remaining attempts display
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Shield, Lock, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'

const CODE_LENGTH = 6

interface PasscodeScreenProps {
  mode: 'verify' | 'setup' | 'confirm'
  onComplete: (passcode: string) => void
  onCancel?:  () => void
  title?:     string
  subtitle?:  string
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

  const [digits, setDigits]       = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [shake, setShake]         = useState(false)
  const [timeLeft, setTimeLeft]   = useState<number>(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const inputRefs = useRef<(HTMLInputElement | null)[]>(Array(CODE_LENGTH).fill(null))

  // ── Lock countdown ──────────────────────────────────────────────────────────
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

  // ── Shake on error and reset submitting state ──────────────────────────────
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

  // ── Auto-focus first input ──────────────────────────────────────────────────
  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  // ── Input handling ──────────────────────────────────────────────────────────
  const handleChange = useCallback((index: number, value: string) => {
    if (!/^\d?$/.test(value)) return   // digits only

    clearError()
    const next = [...digits]
    next[index] = value
    setDigits(next)

    if (value && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }

    // Check if complete
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
  }, [digits])

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

  // ── Formatting ──────────────────────────────────────────────────────────────
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const screenTitle = title ?? (
    mode === 'verify'  ? 'Enter Passcode'     :
    mode === 'setup'   ? 'Create Passcode'    :
                         'Confirm Passcode'
  )

  const screenSub = subtitle ?? (
    mode === 'verify'  ? `Welcome back${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}` :
    mode === 'setup'   ? 'Set a 6-digit passcode to secure your account' :
                         'Re-enter your passcode to confirm'
  )

  const isLocked = !!lockExpiresAt && timeLeft > 0

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6">
      <div className="w-full max-w-sm animate-slide-up">

        {/* Icon */}
        <div className="flex justify-center mb-8">
          <div className={clsx(
            'w-16 h-16 rounded-2xl flex items-center justify-center',
            isLocked
              ? 'bg-red-subtle border border-red/20'
              : 'bg-green-subtle border border-green-border'
          )}>
            {isLocked
              ? <Lock className="w-7 h-7 text-red" />
              : <Shield className="w-7 h-7 text-green" />
            }
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-text-1 mb-2">{screenTitle}</h1>
          <p className="text-sm text-text-2">{screenSub}</p>
        </div>

        {/* Locked state */}
        {isLocked ? (
          <div className="bg-red-subtle border border-red/20 rounded-2xl p-6 text-center mb-6">
            <AlertTriangle className="w-6 h-6 text-red mx-auto mb-3" />
            <p className="text-sm font-semibold text-red mb-1">Account Temporarily Locked</p>
            <p className="text-xs text-text-2 mb-4">
              Too many failed attempts. Try again in:
            </p>
            <div className="text-3xl font-mono font-bold text-red">
              {formatTime(timeLeft)}
            </div>
          </div>
        ) : (
          <>
            {/* PIN dots */}
            <div
              className={clsx(
                'flex justify-center gap-3 mb-6',
                shake && 'animate-shake'
              )}
              onPaste={handlePaste}
            >
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
                    'w-12 h-14 text-center text-xl font-bold rounded-xl',
                    'bg-bg-3 border-2 text-text-1',
                    'focus:outline-none transition-all duration-150',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    digit
                      ? 'border-green shadow-glow-green'
                      : 'border-bg-5 focus:border-green/50',
                    error && 'border-red/40'
                  )}
                />
              ))}
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 mb-4 px-1">
                <AlertTriangle className="w-4 h-4 text-red flex-shrink-0" />
                <p className="text-sm text-red">{error}</p>
              </div>
            )}

            {/* Loading */}
            {isSubmitting && (
              <div className="flex items-center justify-center gap-2 mb-4">
                <div className="w-4 h-4 rounded-full border-2 border-green border-t-transparent animate-spin" />
                <span className="text-sm text-text-2">Verifying…</span>
              </div>
            )}
          </>
        )}

        {/* Footer actions */}
        <div className="flex flex-col gap-3">
          {onCancel && !isLocked && (
            <button
              onClick={onCancel}
              className="text-sm text-text-3 hover:text-text-2 transition-colors py-2"
            >
              {mode === 'verify' ? 'Use a different account' : 'Cancel'}
            </button>
          )}
        </div>

        {/* PowerOn branding */}
        <div className="mt-12 text-center">
          <span className="text-xs font-mono text-text-4 tracking-widest uppercase">
            PowerOn Hub · v3.0
          </span>
        </div>
      </div>
    </div>
  )
}
