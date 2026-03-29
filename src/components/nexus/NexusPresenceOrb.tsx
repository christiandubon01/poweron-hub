// @ts-nocheck
/**
 * NexusPresenceOrb — Visual presence indicator for NEXUS AI agent.
 *
 * Pure visual component — zero business logic, no transcript state,
 * no data queries, no protected-core modifications.
 *
 * Accepts a `state` prop matching VoiceSessionStatus and renders
 * a glowing orb with layered ring/sphere effects and smooth CSS
 * transitions between states.
 *
 * Visual states:
 *   inactive    — dim glow, low idle breathing, subtle ambient movement
 *   listening   — soft pulse ring, responsive halo, low-frequency motion
 *   recording   — stronger pulse, brighter core, intense shell vibration
 *   transcribing — scanning effect, tighter ring motion, inward/outward ripple
 *   processing  — orbiting particles, rotating shell, visible thinking energy
 *   responding  — waveform expansion, speech-linked pulsing, brighter rhythmic motion
 *   complete    — settle-down animation, soft glow stabilization
 *   error       — short warning flicker, red/orange accent, calm reset
 *
 * Mount point: VoiceActivationButton.tsx (next session wiring).
 * The orb renders as a fixed-position overlay, sized to wrap the mic button area.
 */

import React, { useMemo, useEffect } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export type OrbState =
  | 'inactive'
  | 'listening'
  | 'recording'
  | 'transcribing'
  | 'processing'
  | 'responding'
  | 'complete'
  | 'error'

export interface NexusPresenceOrbProps {
  /** Current visual state — maps to VoiceSessionStatus */
  state: OrbState
  /** Orb diameter in px (default 80) */
  size?: number
  /** Optional CSS class for positioning overrides */
  className?: string
}

// ── State-driven visual config ──────────────────────────────────────────────

interface OrbVisuals {
  coreColor: string
  coreGlow: string
  ringColor: string
  ringScale: number
  ringOpacity: number
  coreAnimation: string
  ringAnimation: string
  particleAnimation: string
  outerRingAnimation: string
}

function getVisuals(state: OrbState): OrbVisuals {
  switch (state) {
    case 'inactive':
      return {
        coreColor: 'rgba(46, 232, 154, 0.25)',
        coreGlow: '0 0 20px rgba(46, 232, 154, 0.15), 0 0 40px rgba(46, 232, 154, 0.05)',
        ringColor: 'rgba(46, 232, 154, 0.08)',
        ringScale: 1,
        ringOpacity: 0.3,
        coreAnimation: 'orbBreathe 4s ease-in-out infinite',
        ringAnimation: 'orbDrift 6s ease-in-out infinite',
        particleAnimation: 'none',
        outerRingAnimation: 'orbDrift 8s ease-in-out infinite reverse',
      }
    case 'listening':
      return {
        coreColor: 'rgba(46, 232, 154, 0.4)',
        coreGlow: '0 0 30px rgba(46, 232, 154, 0.25), 0 0 60px rgba(46, 232, 154, 0.1)',
        ringColor: 'rgba(46, 232, 154, 0.15)',
        ringScale: 1.1,
        ringOpacity: 0.5,
        coreAnimation: 'orbBreathe 3s ease-in-out infinite',
        ringAnimation: 'orbPulse 2.5s ease-in-out infinite',
        particleAnimation: 'none',
        outerRingAnimation: 'orbPulse 3.5s ease-in-out infinite reverse',
      }
    case 'recording':
      return {
        coreColor: 'rgba(239, 68, 68, 0.6)',
        coreGlow: '0 0 40px rgba(239, 68, 68, 0.35), 0 0 80px rgba(239, 68, 68, 0.15)',
        ringColor: 'rgba(239, 68, 68, 0.25)',
        ringScale: 1.15,
        ringOpacity: 0.7,
        coreAnimation: 'orbPulseIntense 1.2s ease-in-out infinite',
        ringAnimation: 'orbVibrate 0.3s ease-in-out infinite',
        particleAnimation: 'orbSpin 3s linear infinite',
        outerRingAnimation: 'orbPulseIntense 1.8s ease-in-out infinite reverse',
      }
    case 'transcribing':
      return {
        coreColor: 'rgba(234, 179, 8, 0.5)',
        coreGlow: '0 0 35px rgba(234, 179, 8, 0.3), 0 0 60px rgba(234, 179, 8, 0.1)',
        ringColor: 'rgba(234, 179, 8, 0.2)',
        ringScale: 1.05,
        ringOpacity: 0.6,
        coreAnimation: 'orbScan 2s ease-in-out infinite',
        ringAnimation: 'orbRipple 1.5s ease-in-out infinite',
        particleAnimation: 'orbSpin 2s linear infinite',
        outerRingAnimation: 'orbRipple 2s ease-in-out infinite reverse',
      }
    case 'processing':
      return {
        coreColor: 'rgba(139, 92, 246, 0.55)',
        coreGlow: '0 0 40px rgba(139, 92, 246, 0.35), 0 0 80px rgba(139, 92, 246, 0.15)',
        ringColor: 'rgba(139, 92, 246, 0.2)',
        ringScale: 1.2,
        ringOpacity: 0.7,
        coreAnimation: 'orbBreathe 2s ease-in-out infinite',
        ringAnimation: 'orbSpin 3s linear infinite',
        particleAnimation: 'orbOrbit 2s linear infinite',
        outerRingAnimation: 'orbSpin 4s linear infinite reverse',
      }
    case 'responding':
      return {
        coreColor: 'rgba(6, 182, 212, 0.6)',
        coreGlow: '0 0 45px rgba(6, 182, 212, 0.4), 0 0 90px rgba(6, 182, 212, 0.15)',
        ringColor: 'rgba(6, 182, 212, 0.25)',
        ringScale: 1.25,
        ringOpacity: 0.75,
        coreAnimation: 'orbWaveform 0.8s ease-in-out infinite',
        ringAnimation: 'orbPulse 1s ease-in-out infinite',
        particleAnimation: 'orbSpin 2s linear infinite',
        outerRingAnimation: 'orbWaveform 1.2s ease-in-out infinite reverse',
      }
    case 'complete':
      return {
        coreColor: 'rgba(46, 232, 154, 0.35)',
        coreGlow: '0 0 25px rgba(46, 232, 154, 0.2), 0 0 50px rgba(46, 232, 154, 0.08)',
        ringColor: 'rgba(46, 232, 154, 0.1)',
        ringScale: 1,
        ringOpacity: 0.4,
        coreAnimation: 'orbSettle 1.5s ease-out forwards',
        ringAnimation: 'orbSettle 2s ease-out forwards',
        particleAnimation: 'none',
        outerRingAnimation: 'orbSettle 2.5s ease-out forwards',
      }
    case 'error':
      return {
        coreColor: 'rgba(255, 80, 96, 0.55)',
        coreGlow: '0 0 35px rgba(255, 80, 96, 0.3), 0 0 60px rgba(255, 144, 64, 0.1)',
        ringColor: 'rgba(255, 80, 96, 0.2)',
        ringScale: 1.05,
        ringOpacity: 0.6,
        coreAnimation: 'orbFlicker 0.4s ease-in-out 3',
        ringAnimation: 'orbFlicker 0.6s ease-in-out 2',
        particleAnimation: 'none',
        outerRingAnimation: 'none',
      }
    default:
      return getVisuals('inactive')
  }
}

// ── Keyframes (injected once) ───────────────────────────────────────────────

const ORB_KEYFRAMES = `
@keyframes orbBreathe {
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50% { transform: scale(1.06); opacity: 1; }
}
@keyframes orbPulse {
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.12); opacity: 0.8; }
}
@keyframes orbPulseIntense {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.18); opacity: 1; }
}
@keyframes orbDrift {
  0%, 100% { transform: scale(1) rotate(0deg); }
  33% { transform: scale(1.03) rotate(2deg); }
  66% { transform: scale(0.97) rotate(-2deg); }
}
@keyframes orbVibrate {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(-1px, 1px); }
  50% { transform: translate(1px, -1px); }
  75% { transform: translate(-1px, -1px); }
}
@keyframes orbScan {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.04); filter: brightness(1.3); }
}
@keyframes orbRipple {
  0% { transform: scale(0.95); opacity: 0.6; }
  50% { transform: scale(1.15); opacity: 0.3; }
  100% { transform: scale(0.95); opacity: 0.6; }
}
@keyframes orbSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes orbOrbit {
  from { transform: rotate(0deg) translateX(30%) rotate(0deg); }
  to { transform: rotate(360deg) translateX(30%) rotate(-360deg); }
}
@keyframes orbWaveform {
  0%, 100% { transform: scale(1) scaleY(1); }
  25% { transform: scale(1.08) scaleY(0.94); }
  50% { transform: scale(0.95) scaleY(1.08); }
  75% { transform: scale(1.06) scaleY(0.96); }
}
@keyframes orbSettle {
  0% { transform: scale(1.1); opacity: 0.8; }
  100% { transform: scale(1); opacity: 0.5; }
}
@keyframes orbFlicker {
  0%, 100% { opacity: 0.9; }
  50% { opacity: 0.3; }
}
`

// ── Component ───────────────────────────────────────────────────────────────

export function NexusPresenceOrb({
  state,
  size = 80,
  className = '',
}: NexusPresenceOrbProps) {
  console.log('[Orb] Rendering with state:', state)

  useEffect(() => {
    console.log('[Orb] Mounted with state:', state)
  }, [])

  useEffect(() => {
    console.log('[Orb] State changed:', state)
  }, [state])

  const v = useMemo(() => getVisuals(state), [state])

  const half = size / 2
  const coreSize = size * 0.4
  const ringSize = size * 0.7
  const outerSize = size * 0.9
  const particleSize = size * 0.08

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      aria-hidden="true"
    >
      {/* Inject keyframes */}
      <style>{ORB_KEYFRAMES}</style>

      {/* Outer ring — ambient boundary */}
      <div
        style={{
          position: 'absolute',
          width: outerSize,
          height: outerSize,
          borderRadius: '50%',
          border: `1px solid ${v.ringColor}`,
          opacity: v.ringOpacity * 0.5,
          animation: v.outerRingAnimation,
          transition: 'all 0.6s ease',
        }}
      />

      {/* Middle ring — primary pulse ring */}
      <div
        style={{
          position: 'absolute',
          width: ringSize,
          height: ringSize,
          borderRadius: '50%',
          border: `1.5px solid ${v.ringColor}`,
          boxShadow: `0 0 15px ${v.ringColor}`,
          opacity: v.ringOpacity,
          transform: `scale(${v.ringScale})`,
          animation: v.ringAnimation,
          transition: 'all 0.5s ease',
        }}
      />

      {/* Core glow — main orb body */}
      <div
        style={{
          position: 'absolute',
          width: coreSize,
          height: coreSize,
          borderRadius: '50%',
          background: `radial-gradient(circle at 40% 35%, ${v.coreColor}, transparent 70%)`,
          boxShadow: v.coreGlow,
          animation: v.coreAnimation,
          transition: 'background 0.5s ease, box-shadow 0.5s ease',
        }}
      />

      {/* Inner bright spot — specular highlight */}
      <div
        style={{
          position: 'absolute',
          width: coreSize * 0.35,
          height: coreSize * 0.35,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)',
          transform: 'translate(-20%, -20%)',
          opacity: state === 'inactive' || state === 'complete' ? 0.3 : 0.6,
          transition: 'opacity 0.5s ease',
        }}
      />

      {/* Orbiting particles — only active in processing/recording/responding/transcribing */}
      {v.particleAnimation !== 'none' && (
        <>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                width: particleSize,
                height: particleSize,
                borderRadius: '50%',
                backgroundColor: v.coreColor,
                boxShadow: `0 0 6px ${v.coreColor}`,
                opacity: 0.7,
                animation: v.particleAnimation,
                animationDelay: `${i * 0.67}s`,
                transformOrigin: `${half}px ${half}px`,
              }}
            />
          ))}
        </>
      )}

      {/* Fallback pulsing circle — visible baseline if CSS animations fail */}
      <div
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(46,232,154,0.12) 0%, transparent 70%)',
          animation: 'orbBreathe 4s ease-in-out infinite',
          zIndex: -1,
        }}
      />
    </div>
  )
}

export default NexusPresenceOrb
