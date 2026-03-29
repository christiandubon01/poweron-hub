// @ts-nocheck
/**
 * VoiceActivationButton — Floating mic button + transcript panel integration
 *
 * Appears on all panels. Press to start recording, press again to stop.
 * Integrates with VoiceTranscriptPanel for conversation display.
 *
 * Voice flow:
 *   - Single tap = start recording, opens transcript panel
 *   - Single tap again = stop recording and process
 *   - Transcript panel stays open until user explicitly closes it
 *   - User can tap voice again for follow-up within same session
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Mic, MicOff, Loader2, Volume2, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { getVoiceSubsystem, unlockAudioContext, voiceDebugLog, onDebugUpdate, type VoiceSessionStatus } from '@/services/voice'
import { useAuth } from '@/hooks/useAuth'
import { VoiceTranscriptPanel, addTranscriptEntry } from './VoiceTranscriptPanel'

interface VoiceActivationButtonProps {
  className?: string
}

export function VoiceActivationButton({ className }: VoiceActivationButtonProps) {
  const { user, profile } = useAuth()
  const [status, setStatus] = useState<VoiceSessionStatus>('inactive')
  const [initialized, setInitialized] = useState(false)
  const [errorFlash, setErrorFlash] = useState(false)
  const [permissionError, setPermissionError] = useState('')
  const [audioUnlocked, setAudioUnlocked] = useState(false)

  // Transcript panel state
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelMinimized, setPanelMinimized] = useState(false)

  // Track last transcript and response for adding to panel
  const lastTranscriptRef = useRef<string>('')

  // Debug panel — only active when ?debug=1 is in the URL
  const showDebug = typeof window !== 'undefined' && window.location.search.includes('debug=1')
  const [debugTick, setDebugTick] = useState(0)
  const debugScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showDebug) return
    return onDebugUpdate(() => setDebugTick(t => t + 1))
  }, [showDebug])

  // Auto-scroll debug log
  useEffect(() => {
    if (debugScrollRef.current) {
      debugScrollRef.current.scrollTop = debugScrollRef.current.scrollHeight
    }
  }, [debugTick])

  // Detect iOS Safari for platform-specific guidance
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

  // iOS Safari: Unlock shared AudioContext on first user gesture.
  // Uses the module-level singleton from voice.ts so the SAME context
  // is reused for TTS playback later (iOS rejects new contexts outside gestures).
  useEffect(() => {
    if (audioUnlocked) return
    const unlock = () => {
      try {
        unlockAudioContext()
        setAudioUnlocked(true)
        console.log('[Voice] Shared AudioContext unlocked for iOS via document gesture')
      } catch { /* ignore */ }
    }
    document.addEventListener('touchstart', unlock, { once: true })
    document.addEventListener('click', unlock, { once: true })
    return () => {
      document.removeEventListener('touchstart', unlock)
      document.removeEventListener('click', unlock)
    }
  }, [audioUnlocked])

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

    // Subscribe to voice events
    const unsub = voice.on((event) => {
      if (event.type === 'status_changed') {
        setStatus(voice.getStatus())
      }

      // Capture transcript for panel
      if (event.type === 'transcript_ready') {
        const data = event.data as { text?: string } | undefined
        if (data?.text) {
          lastTranscriptRef.current = data.text
        }
      }

      // Capture agent response and add to transcript panel
      if (event.type === 'session_complete') {
        const session = event.session
        if (session && lastTranscriptRef.current) {
          addTranscriptEntry(
            lastTranscriptRef.current,
            session.agentResponse || 'No response',
            session.targetAgent || 'nexus'
          )
          lastTranscriptRef.current = ''
        }
      }

      if (event.type === 'error') {
        setErrorFlash(true)
        setTimeout(() => setErrorFlash(false), 2000)

        const errData = event.data as { error?: string; permissionDenied?: boolean } | undefined
        const errMsg = typeof errData?.error === 'string' ? errData.error : ''
        if (errData?.permissionDenied || errMsg.includes('blocked') || errMsg.includes('Microphone')) {
          const msg = isIOS
            ? 'On iPhone/iPad: Settings \u2192 Safari \u2192 Microphone \u2192 Allow for this site'
            : (errMsg || 'Microphone access blocked. Tap the lock icon in your browser and allow microphone.')
          setPermissionError(msg)
          setTimeout(() => setPermissionError(''), 8000)
        }

        // Auto-reset to idle after error so button doesn't lock up
        setTimeout(() => setStatus('inactive'), 3000)
      }
    })

    return () => {
      unsub()
    }
  }, [user?.id, profile?.org_id, isIOS])

  const handlePress = useCallback(async () => {
    // CRITICAL: Unlock AudioContext synchronously on the user gesture call stack.
    // iOS Safari only allows AudioContext creation/resume during an active user tap.
    // This MUST happen before any awaits or the gesture chain breaks.
    unlockAudioContext()

    const voice = getVoiceSubsystem()

    switch (status) {
      case 'inactive':
      case 'complete':
      case 'listening':
        // Open transcript panel on first activation
        if (!panelOpen) {
          setPanelOpen(true)
          setPanelMinimized(false)
        } else if (panelMinimized) {
          setPanelMinimized(false)
        }
        // Start recording
        await voice.startRecording('normal')
        break
      case 'recording':
        // Stop recording → triggers pipeline (do NOT close panel)
        await voice.stopRecording()
        break
      case 'responding':
        // Stop TTS playback (user interrupts) → return to IDLE, not LISTENING
        await voice.stopSpeaking()
        break
      default:
        // Processing states — can't interrupt
        break
    }
  }, [status, panelOpen, panelMinimized])

  // Don't render if not initialized
  if (!initialized) return null

  const isRecording = status === 'recording'
  const isProcessing = status === 'transcribing' || status === 'processing'
  const isSpeaking = status === 'responding'
  const isListening = status === 'listening'
  const isIdle = status === 'inactive' || status === 'complete'

  return (
    <>
      {/* Transcript Panel */}
      <VoiceTranscriptPanel
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        onMinimize={() => setPanelMinimized(true)}
        isMinimized={panelMinimized}
        onMaximize={() => setPanelMinimized(false)}
      />

      {/* Voice button */}
      <button
        onClick={handlePress}
        disabled={isProcessing}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        className={clsx(
          'fixed bottom-6 right-6 z-50',
          'w-14 h-14 rounded-full shadow-lg',
          'flex items-center justify-center',
          'transition-all duration-300 ease-out',
          'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900',

          // State-based styles
          isIdle && !errorFlash && !permissionError && 'bg-emerald-600 hover:bg-emerald-500 focus:ring-emerald-500 text-white',
          isListening && 'bg-emerald-600 text-white',
          isRecording && 'bg-red-600 hover:bg-red-500 focus:ring-red-500 text-white scale-110',
          isProcessing && 'bg-gray-700 text-gray-300 cursor-wait',
          isSpeaking && 'bg-cyan-600 hover:bg-cyan-500 focus:ring-cyan-500 text-white',
          errorFlash && 'bg-red-700 text-white animate-pulse',
          permissionError && 'ring-2 ring-red-500 bg-red-700 text-white',

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

      {/* Status label below button */}
      {!isIdle && !errorFlash && !permissionError && (
        <div className="fixed bottom-[88px] right-4 z-50 bg-gray-900/90 border border-gray-700/50 rounded-lg px-3 py-1.5 shadow-xl text-center">
          <p className="text-[11px] font-semibold m-0" style={{ color: isRecording ? '#ef4444' : isProcessing ? '#eab308' : isSpeaking ? '#06b6d4' : '#10b981' }}>
            {isListening ? 'Listening...' : isRecording ? 'Recording...' : status === 'transcribing' ? 'Transcribing...' : status === 'processing' ? 'Thinking...' : isSpeaking ? 'Speaking...' : ''}
          </p>
        </div>
      )}

      {/* Permission error tooltip below button */}
      {permissionError && (
        <div className="fixed bottom-[88px] right-4 z-50 max-w-[260px] bg-red-900/95 border border-red-500/50 rounded-lg px-3 py-2 shadow-xl">
          <p className="text-[11px] text-red-200 leading-snug m-0">{permissionError}</p>
        </div>
      )}

      {/* On-screen audio debug panel — only when ?debug=1 */}
      {showDebug && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            maxHeight: '150px',
            zIndex: 9999,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            borderBottom: '1px solid #333',
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#0f0',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            opacity: 0.85,
          }}
        >
          <div style={{ padding: '4px 8px', backgroundColor: '#111', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontWeight: 700, color: '#0ff', fontSize: '10px' }}>AUDIO DEBUG</span>
            <span style={{ color: '#666', fontSize: '9px' }}>{voiceDebugLog.length} entries · {status}</span>
          </div>
          <div
            ref={debugScrollRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '4px 8px',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {voiceDebugLog.length === 0 ? (
              <div style={{ color: '#666', padding: '8px 0' }}>Waiting for audio events... Tap mic to start.</div>
            ) : (
              voiceDebugLog.map((line, i) => (
                <div key={i} style={{ padding: '1px 0', borderBottom: '1px solid #1a1a1a', color: line.includes('ERROR') || line.includes('FAILED') ? '#f44' : line.includes('OK') || line.includes('complete') || line.includes('unlocked') ? '#0f0' : '#ccc' }}>
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
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
