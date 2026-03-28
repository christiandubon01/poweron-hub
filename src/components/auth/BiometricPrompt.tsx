/**
 * BiometricPrompt — shows after passcode is set, or on returning app opens
 * when biometric is enrolled. Offers Face ID / Touch ID / Windows Hello.
 * User can dismiss and fall back to passcode.
 */

import { useEffect, useState } from 'react'
import { Fingerprint, Eye, Monitor, Shield, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import type { BiometricCapabilities } from '@/lib/auth/biometric'

interface BiometricPromptProps {
  /** If true, this is the enrollment step (first time, after passcode setup) */
  isEnrollment?: boolean
  onEnroll?:    (enable: boolean) => void
}

// ── Icon per biometry type ───────────────────────────────────────────────────
function BiometricIcon({
  type,
  size = 40,
  className,
}: {
  type: BiometricCapabilities['biometryType']
  size?: number
  className?: string
}) {
  const props = { size, className }
  switch (type) {
    case 'faceId':       return <Eye        {...props} />
    case 'touchId':
    case 'fingerprint':  return <Fingerprint {...props} />
    case 'windowsHello': return <Monitor    {...props} />
    case 'webauthn':     return <Shield     {...props} />
    default:             return <Shield     {...props} />
  }
}

// ── Labels per biometry type ─────────────────────────────────────────────────
function getBiometricLabel(type: BiometricCapabilities['biometryType']) {
  switch (type) {
    case 'faceId':        return { name: 'Face ID',        description: 'Use Face ID to sign in instantly' }
    case 'touchId':       return { name: 'Touch ID',       description: 'Use Touch ID to sign in instantly' }
    case 'fingerprint':   return { name: 'Fingerprint',    description: 'Use your fingerprint to sign in instantly' }
    case 'windowsHello':  return { name: 'Windows Hello',  description: 'Use Windows Hello to sign in instantly' }
    case 'webauthn':      return { name: 'Passkey',        description: 'Use your passkey to sign in instantly' }
    default:              return { name: 'Biometric',      description: 'Use biometric authentication' }
  }
}


// ── Pulsing ring animation ───────────────────────────────────────────────────
function PulsingRing({ color = 'green' }: { color?: string }) {
  return (
    <span
      className={clsx(
        'absolute inset-0 rounded-full',
        color === 'green' ? 'bg-green/20' : 'bg-blue/20',
        'animate-pulse-ring'
      )}
    />
  )
}


// ── Component ────────────────────────────────────────────────────────────────
export function BiometricPrompt({ isEnrollment = false, onEnroll }: BiometricPromptProps) {
  const { biometric, error, authenticateBio, skipBiometric, clearError } = useAuth()

  const [triggered, setTriggered] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const type   = biometric?.biometryType ?? 'faceId'
  const labels = getBiometricLabel(type)

  // Auto-trigger on verify mode (non-enrollment) after 600ms
  useEffect(() => {
    if (!isEnrollment && !triggered) {
      const id = setTimeout(() => {
        setTriggered(true)
        handleAuthenticate()
      }, 600)
      return () => clearTimeout(id)
    }
  }, [isEnrollment]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAuthenticate = async () => {
    setIsLoading(true)
    clearError()
    await authenticateBio()
    setIsLoading(false)
  }

  const handleEnroll = async (enable: boolean) => {
    if (enable) {
      await handleAuthenticate()
    }
    onEnroll?.(enable)
  }

  // ── Enrollment UI ────────────────────────────────────────────────────────
  if (isEnrollment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6">
        <div className="w-full max-w-sm animate-slide-up">

          {/* Icon */}
          <div className="flex justify-center mb-8">
            <div className="relative">
              <div className="w-20 h-20 rounded-3xl bg-green-subtle border border-green-border flex items-center justify-center">
                <BiometricIcon type={type} size={36} className="text-green" />
              </div>
            </div>
          </div>

          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 bg-green-subtle border border-green-border rounded-full px-4 py-1.5 mb-4">
              <span className="text-xs font-bold tracking-widest uppercase text-green">Optional</span>
            </div>
            <h1 className="text-2xl font-bold text-text-1 mb-3">
              Enable {labels.name}?
            </h1>
            <p className="text-sm text-text-2 leading-relaxed">
              {labels.description} without entering your passcode every time.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <button
              onClick={() => handleEnroll(true)}
              disabled={isLoading}
              className={clsx(
                'flex items-center justify-center gap-3 w-full py-4 rounded-2xl',
                'bg-green text-black font-bold text-sm',
                'hover:bg-green/90 transition-all duration-150',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'shadow-glow-green'
              )}
            >
              {isLoading
                ? <div className="w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin" />
                : <BiometricIcon type={type} size={18} />
              }
              Enable {labels.name}
            </button>

            <button
              onClick={() => handleEnroll(false)}
              disabled={isLoading}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-bg-3 border border-bg-5 text-text-2 font-semibold text-sm hover:bg-bg-4 transition-colors"
            >
              Skip for now
              <ChevronRight size={14} className="text-text-3" />
            </button>
          </div>

          {error && (
            <p className="text-center text-sm text-red mt-4">{error}</p>
          )}
        </div>
      </div>
    )
  }

  // ── Verify UI (auto-triggered) ───────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6">
      <div className="w-full max-w-sm animate-slide-up text-center">

        {/* Pulsing biometric icon */}
        <div className="flex justify-center mb-10">
          <div className="relative">
            {isLoading && <PulsingRing />}
            <div
              onClick={!isLoading ? handleAuthenticate : undefined}
              className={clsx(
                'relative w-24 h-24 rounded-3xl flex items-center justify-center',
                'bg-green-subtle border border-green-border',
                !isLoading && 'cursor-pointer hover:bg-green/10 transition-colors',
                'shadow-glow-green'
              )}
            >
              <BiometricIcon type={type} size={44} className="text-green" />
            </div>
          </div>
        </div>

        <h1 className="text-xl font-bold text-text-1 mb-2">
          {isLoading ? 'Authenticating…' : labels.name}
        </h1>
        <p className="text-sm text-text-2 mb-10">
          {isLoading
            ? `Verifying with ${labels.name}…`
            : `Tap to sign in with ${labels.name}`
          }
        </p>

        {error && (
          <div className="bg-red-subtle border border-red/20 rounded-xl p-3 mb-6">
            <p className="text-sm text-red">{error}</p>
          </div>
        )}

        {/* Retry / fallback */}
        <div className="flex flex-col gap-2">
          {!isLoading && (
            <button
              onClick={handleAuthenticate}
              className="text-sm text-green hover:text-green/80 transition-colors py-2 font-semibold"
            >
              Try again
            </button>
          )}
          <button
            onClick={skipBiometric}
            disabled={isLoading}
            className="text-sm text-text-3 hover:text-text-2 transition-colors py-2"
          >
            Use passcode instead
          </button>
        </div>

        <div className="mt-12">
          <span className="text-xs font-mono text-text-4 tracking-widest uppercase">
            PowerOn Hub · v2.0
          </span>
        </div>
      </div>
    </div>
  )
}
