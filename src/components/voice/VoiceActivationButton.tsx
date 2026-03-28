/**
 * VoiceActivationButton — Floating mic button for voice interaction
 *
 * Appears on all panels. Press to start recording, press again to stop.
 * Visual states:
 *   - Idle: Emerald mic icon
 *   - Listening (wake word): Subtle pulse animation
 *   - Recording: Red pulsing ring, waveform animation
 *   - Transcribing/Processing: Spinning loader
 *   - Speaking (TTS playing): Waveform bars animation
 *   - Error: Red flash, then back to idle
 */

import { useState, useEffect, useCallback } from 'react'
import { Mic, MicOff, Loader2, Volume2, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { getVoiceSubsystem, type VoiceSessionStatus } from '@/services/voice'
import { useAuth } from '@/hooks/useAuth'

interface VoiceActivationButtonProps {
  className?: string
}

export function VoiceActivationButton({ className }: VoiceActivationButtonProps) {
  const { user, profile } = useAuth()
  const [status, setStatus] = useState<VoiceSessionStatus>('inactive')
  const [initialized, setInitialized] = useState(false)
  const [errorFlash, setErrorFlash] = useState(false)

  // Initialize voice subsystem
  useEffect(() => {
    const orgId = profile?.org_id
    const userId = user?.id
    if (!orgId || !userId) return

    const voice = getVoiceSubsystem()

    voice.initialize({ orgId, userId }).then(() => {
      setInitialized(true)
    }).catch((err) => {
      console.error('[VoiceButton] Init failed:', err)
    })

    // Subscribe to status changes
    const unsub = voice.on((event) => {
      if (event.type === 'status_changed') {
        setStatus(voice.getStatus())
      }
      if (event.type === 'error') {
        setErrorFlash(true)
        setTimeout(() => setErrorFlash(false), 2000)
      }
    })

    return () => {
      unsub()
    }
  }, [user?.id, profile?.org_id])

  const handlePress = useCallback(async () => {
    const voice = getVoiceSubsystem()

    switch (status) {
      case 'inactive':
      case 'complete':
      case 'listening':
        // Start recording
        await voice.startRecording('normal')
        break
      case 'recording':
        // Stop recording → triggers pipeline
        await voice.stopRecording()
        break
      case 'responding':
        // Stop TTS playback (user interrupts)
        await voice.stopAll()
        break
      default:
        // Processing states — can't interrupt
        break
    }
  }, [status])

  // Don't render if not initialized
  if (!initialized) return null

  const isRecording = status === 'recording'
  const isProcessing = status === 'transcribing' || status === 'processing'
  const isSpeaking = status === 'responding'
  const isListening = status === 'listening'
  const isIdle = status === 'inactive' || status === 'complete'

  return (
    <button
      onClick={handlePress}
      disabled={isProcessing}
      className={clsx(
        'fixed bottom-6 right-6 z-50',
        'w-14 h-14 rounded-full shadow-lg',
        'flex items-center justify-center',
        'transition-all duration-300 ease-out',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900',

        // State-based styles
        isIdle && !errorFlash && 'bg-emerald-600 hover:bg-emerald-500 focus:ring-emerald-500 text-white',
        isListening && 'bg-emerald-600 text-white',
        isRecording && 'bg-red-600 hover:bg-red-500 focus:ring-red-500 text-white scale-110',
        isProcessing && 'bg-gray-700 text-gray-300 cursor-wait',
        isSpeaking && 'bg-cyan-600 hover:bg-cyan-500 focus:ring-cyan-500 text-white',
        errorFlash && 'bg-red-700 text-white animate-pulse',

        className,
      )}
      aria-label={getAriaLabel(status)}
      title={getTooltip(status)}
    >
      {/* Pulse ring for listening/recording */}
      {(isListening || isRecording) && (
        <span
          className={clsx(
            'absolute inset-0 rounded-full animate-ping',
            isRecording ? 'bg-red-500/40' : 'bg-emerald-500/30',
          )}
        />
      )}

      {/* Waveform bars for speaking */}
      {isSpeaking && (
        <span className="absolute inset-0 flex items-center justify-center gap-[2px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="w-[3px] bg-white/40 rounded-full"
              style={{
                height: '40%',
                animation: `voiceWave 0.6s ease-in-out ${i * 0.1}s infinite alternate`,
              }}
            />
          ))}
        </span>
      )}

      {/* Icon */}
      <span className="relative z-10">
        {isProcessing ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : isSpeaking ? (
          <Volume2 className="w-6 h-6" />
        ) : errorFlash ? (
          <AlertCircle className="w-6 h-6" />
        ) : isRecording ? (
          <MicOff className="w-6 h-6" />
        ) : (
          <Mic className="w-6 h-6" />
        )}
      </span>

      {/* Inline keyframe styles for waveform animation */}
      <style>{`
        @keyframes voiceWave {
          0% { height: 20%; }
          100% { height: 80%; }
        }
      `}</style>
    </button>
  )
}

function getAriaLabel(status: VoiceSessionStatus): string {
  switch (status) {
    case 'inactive':
    case 'complete':
      return 'Start voice command'
    case 'listening':
      return 'Listening for wake word. Press to record.'
    case 'recording':
      return 'Recording. Press to stop.'
    case 'transcribing':
      return 'Transcribing your speech...'
    case 'processing':
      return 'Processing command...'
    case 'responding':
      return 'Speaking response. Press to stop.'
    case 'error':
      return 'Voice error. Press to retry.'
    default:
      return 'Voice control'
  }
}

function getTooltip(status: VoiceSessionStatus): string {
  switch (status) {
    case 'inactive':
    case 'complete':
      return 'Press to speak a command'
    case 'listening':
      return 'Listening... say "Hey NEXUS" or press to record'
    case 'recording':
      return 'Recording — press to stop'
    case 'transcribing':
      return 'Transcribing...'
    case 'processing':
      return 'Processing...'
    case 'responding':
      return 'Speaking — press to interrupt'
    case 'error':
      return 'Error — press to retry'
    default:
      return 'Voice'
  }
}
