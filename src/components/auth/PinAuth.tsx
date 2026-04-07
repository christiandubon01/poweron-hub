/**
 * PinAuth — Local PIN authentication (6 digit).
 *
 * B24 | Auth Flow Overhaul
 *
 * Flows:
 *   1. verify      — User has a PIN stored; enter to authenticate.
 *   2. setup-create  — No PIN stored; enter new PIN.
 *   3. setup-confirm — Confirm the new PIN; save on match.
 *
 * On verify success:
 *   - If `onVerify` prop provided → calls onVerify(pin) (used when status='needs_passcode'
 *     so submitPasscode is called and the auth state machine advances).
 *   - Otherwise → dispatches CustomEvent 'poweron:pin-auth-success' on window
 *     (used in 'unauthenticated' state as a local gate).
 *
 * On failure: shakes + clears after 500 ms; 5 failed attempts → 1-hour lockout.
 */

import React, { useState, useEffect, useRef } from 'react'
import { Zap } from 'lucide-react'
import { clsx } from 'clsx'

// ── Config ────────────────────────────────────────────────────────────────────

const PIN_LENGTH    = 6
const STORAGE_KEY   = 'poweron_pin_hash'
const MAX_ATTEMPTS  = 5
const LOCKOUT_MS    = 3_600_000  // 1 hour (B24: 5 attempts per hour)

// ── Crypto ────────────────────────────────────────────────────────────────────

async function sha256(message: string): Promise<string> {
  const buf  = new TextEncoder().encode(message)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function getStoredHash(): string | null {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

function saveHash(hash: string): void {
  try { localStorage.setItem(STORAGE_KEY, hash) } catch {}
}

// ── Types ─────────────────────────────────────────────────────────────────────

type FlowMode = 'verify' | 'setup-create' | 'setup-confirm'

interface PinAuthProps {
  /** Called when the user taps "Use magic link instead" or "Use password instead" */
  onFallbackToMagicLink?: () => void
  /**
   * B24: When provided, called with the raw PIN on successful local verification
   * instead of dispatching the window event.
   * Use this when status='needs_passcode' to wire submitPasscode from authStore.
   */
  onVerify?: (pin: string) => void | Promise<void>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PinAuth({ onFallbackToMagicLink, onVerify }: PinAuthProps) {
  const hasPinStored = Boolean(getStoredHash())

  const [mode, setMode]         = useState<FlowMode>(hasPinStored ? 'verify' : 'setup-create')
  const [digits, setDigits]     = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [firstPin, setFirstPin] = useState('')

  const [shake, setShake]       = useState(false)
  const [error, setError]       = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Lockout state
  const [attempts, setAttempts]     = useState(0)
  const [lockoutEnd, setLockoutEnd] = useState<number | null>(null)
  const [timeLeft, setTimeLeft]     = useState(0)

  // Lockout countdown
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

  // ── Keyboard (numpad) support ────────────────────────────────────────────

  // Keep a stable ref to handleDigit / handleBackspace so the listener
  // always closes over the current state without needing re-registration.
  const handleDigitRef    = useRef<(d: string) => void>(() => {})
  const handleBackspaceRef = useRef<() => void>(() => {})

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      // Digit keys: Digit0-Digit9 or Numpad0-Numpad9
      if (/^(Digit|Numpad)[0-9]$/.test(e.code)) {
        e.preventDefault()
        handleDigitRef.current(e.code.slice(-1))
        return
      }
      // Backspace or NumpadDecimal → delete last digit
      if (e.code === 'Backspace' || e.code === 'NumpadDecimal') {
        e.preventDefault()
        handleBackspaceRef.current()
        return
      }
      // Enter → submit if PIN is complete (auto-submit already fires on last digit,
      // but provide Enter as an explicit trigger for partial completion safety)
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        // auto-submit is handled inside handleDigit when filledCount === PIN_LENGTH - 1
        // Nothing extra needed here; guard is a no-op.
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, []) // mount/unmount only — refs keep the handler current

  // ── Helpers ───────────────────────────────────────────────────────────────

  const resetDigits = () => setDigits(Array(PIN_LENGTH).fill(''))

  const triggerShake = () => {
    setShake(true)
    setTimeout(() => {
      setShake(false)
      resetDigits()
    }, 500)
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  /**
   * Called when all PIN_LENGTH digits have been entered.
   * NOTE: this reads from state at call time — do not memoize (no useCallback).
   */
  const handleSubmit = async (pin: string) => {
    setError('')

    // ── Setup: create step ────────────────────────────────────────────────
    if (mode === 'setup-create') {
      setFirstPin(pin)
      setMode('setup-confirm')
      resetDigits()
      setIsSubmitting(false)
      return
    }

    // ── Setup: confirm step ───────────────────────────────────────────────
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

    // ── Verify: check stored hash ─────────────────────────────────────────
    const stored = getStoredHash()
    if (!stored) {
      // PIN was cleared externally — drop back to setup
      setMode('setup-create')
      resetDigits()
      setIsSubmitting(false)
      return
    }

    const hash = await sha256(pin)
    if (hash === stored) {
      setAttempts(0)
      if (onVerify) {
        // B24: delegate to authStore.submitPasscode (for needs_passcode state)
        await onVerify(pin)
      } else {
        window.dispatchEvent(new CustomEvent('poweron:pin-auth-success'))
      }
      // Leave isSubmitting=true while auth state propagates
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

  // ── Digit press ───────────────────────────────────────────────────────────

  const handleDigit = (d: string) => {
    if (lockoutEnd || isSubmitting) return

    // Count currently filled slots
    const filledCount = digits.filter(x => x !== '').length
    if (filledCount >= PIN_LENGTH) return

    const next = [...digits]
    const idx  = next.findIndex(x => x === '')
    next[idx] = d
    setDigits(next)

    // Auto-submit when last digit entered
    if (filledCount === PIN_LENGTH - 1) {
      const pin = digits.filter(x => x !== '').concat(d).join('')
      setIsSubmitting(true)
      handleSubmit(pin)
    }
  }

  // ── Backspace ─────────────────────────────────────────────────────────────

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

  // Keep keyboard listener refs current after every render
  handleDigitRef.current    = handleDigit
  handleBackspaceRef.current = handleBackspace

  // ── Derived display ───────────────────────────────────────────────────────

  const isLocked  = Boolean(lockoutEnd && timeLeft > 0)
  const filledCount = digits.filter(x => x !== '').length

  const title = mode === 'verify'
    ? 'Enter your PIN'
    : mode === 'setup-create'
    ? 'Create your PIN'
    : 'Confirm your PIN'

  const subtitle = mode === 'verify'
    ? 'Enter your 6-digit PIN to continue'
    : mode === 'setup-create'
    ? 'Choose a 6-digit PIN to secure your account'
    : 'Enter the same PIN again to confirm'

  // ── Keypad layout: 1-9, [gap], 0, backspace ───────────────────────────────
  const KEYS = ['1','2','3','4','5','6','7','8','9','','0','back']

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-6"
      style={{ backgroundColor: '#0a0b0f' }}
    >

      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-10 h-10 rounded-xl bg-green-subtle border border-green-border flex items-center justify-center">
          <Zap className="w-5 h-5 text-green" fill="currentColor" />
        </div>
        <div>
          <div className="text-sm font-bold text-text-1 leading-tight">PowerOn Hub</div>
          <div className="text-xs text-text-3 font-mono uppercase tracking-wider">v3.0</div>
        </div>
      </div>

      {/* ── Title ────────────────────────────────────────────────────────── */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-extrabold text-text-1 mb-1 tracking-tight">{title}</h1>
        <p className="text-sm text-text-2">{subtitle}</p>
      </div>

      {/* ── Dot fill indicators ───────────────────────────────────────────── */}
      <div className={clsx('flex gap-4 mb-2', shake && 'animate-shake')}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={clsx(
              'w-4 h-4 rounded-full transition-all duration-150',
              i < filledCount
                ? 'scale-110'
                : 'border-2 border-bg-5 bg-transparent'
            )}
            style={i < filledCount ? { backgroundColor: '#22c55e' } : undefined}
          />
        ))}
      </div>

      {/* ── Lockout display ──────────────────────────────────────────────── */}
      {isLocked ? (
        <div className="mt-4 mb-6 text-center">
          <div className="text-sm font-semibold mb-1" style={{ color: '#f87171' }}>
            Too many attempts
          </div>
          <div className="text-4xl font-mono font-bold text-text-1">{timeLeft}s</div>
          <div className="text-xs text-text-3 mt-1">Try again when the timer ends</div>
        </div>
      ) : (
        /* ── Error message ─────────────────────────────────────────────── */
        <div className="mt-3 mb-4 min-h-[20px] text-center">
          {error && (
            <p className="text-xs font-medium" style={{ color: '#f87171' }}>{error}</p>
          )}
        </div>
      )}

      {/* ── Keypad ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mt-2">
        {KEYS.map((key, i) => {
          if (key === '') {
            // Empty spacer (bottom-left cell)
            return <div key={i} style={{ minWidth: 72, minHeight: 72 }} />
          }

          if (key === 'back') {
            return (
              <button
                key={i}
                onClick={handleBackspace}
                disabled={isLocked || isSubmitting}
                aria-label="Backspace"
                className={clsx(
                  'flex items-center justify-center rounded-2xl',
                  'border border-bg-5 bg-bg-3',
                  'text-text-1 text-xl font-semibold',
                  'transition-all duration-100 active:scale-95',
                  'hover:bg-bg-4 active:bg-bg-5',
                  'disabled:opacity-30 disabled:cursor-not-allowed',
                )}
                style={{ minWidth: 72, minHeight: 72 }}
              >
                ⌫
              </button>
            )
          }

          return (
            <button
              key={i}
              onClick={() => handleDigit(key)}
              disabled={isLocked || isSubmitting}
              className={clsx(
                'flex items-center justify-center rounded-2xl',
                'border border-bg-5 bg-bg-3',
                'text-text-1 text-2xl font-bold',
                'transition-all duration-100 active:scale-95',
                'hover:bg-bg-4',
                'disabled:opacity-30 disabled:cursor-not-allowed',
              )}
              style={{ minWidth: 72, minHeight: 72 }}
            >
              {key}
            </button>
          )
        })}
      </div>

      {/* ── Fallback link ─────────────────────────────────────────────────── */}
      {onFallbackToMagicLink && (
        <button
          onClick={onFallbackToMagicLink}
          className="mt-8 text-sm text-text-3 hover:text-text-2 transition-colors"
        >
          {onVerify ? 'Sign out and use password instead' : 'Use email instead'}
        </button>
      )}

    </div>
  )
}
