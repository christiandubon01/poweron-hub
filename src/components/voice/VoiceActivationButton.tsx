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

  // Silence detection refs
  const silenceTimerRef = useRef<number | null>(null)
  const silenceStartRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const silenceStreamRef = useRef<MediaStream | null>(null)
  const silenceRafRef = useRef<number | null>(null)
  const silenceAudioCtxRef = useRef<AudioContext | null>(null)
  const [silenceProgress, setSilenceProgress] = useState(0)

  const SILENCE_THRESHOLD = 0.01
  const SILENCE_DURATION_MS = 2000

  // Debug panel — only active when ?debug=1 is in the URL
  const isDebugMode = typeof window !== 'undefined' && window.location.search.includes('debug=1')
  const showDebug = isDebugMode
  const [debugTick, setDebugTick] = useState(0)
  const [debugExpanded, setDebugExpanded] = useState(false)
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

  // ── Silence Detection ──────────────────────────────────────────────────────

  const stopSilenceDetection = useCallback(() => {
    if (silenceRafRef.current) {
      cancelAnimationFrame(silenceRafRef.current)
      silenceRafRef.current = null
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (silenceStreamRef.current) {
      silenceStreamRef.current.getTracks().forEach(t => t.stop())
      silenceStreamRef.current = null
    }
    if (silenceAudioCtxRef.current) {
      try { silenceAudioCtxRef.current.close() } catch { /* ignore */ }
      silenceAudioCtxRef.current = null
    }
    analyserRef.current = null
    silenceStartRef.current = 0
    setSilenceProgress(0)
  }, [])

  const startSilenceDetection = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      silenceStreamRef.current = stream
      const audioCtx = new AudioContext()
      silenceAudioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Float32Array(analyser.fftSize)

      const checkSilence = () => {
        if (!analyserRef.current) return
        analyserRef.current.getFloatTimeDomainData(dataArray)

        // Calculate RMS
        let sumSq = 0
        for (let i = 0; i < dataArray.length; i++) {
          sumSq += dataArray[i] * dataArray[i]
        }
        const rms = Math.sqrt(sumSq / dataArray.length)

        if (rms < SILENCE_THRESHOLD) {
          if (silenceStartRef.current === 0) {
            silenceStartRef.current = Date.now()
          }
          const elapsed = Date.now() - silenceStartRef.current
          setSilenceProgress(Math.min(elapsed / SILENCE_DURATION_MS, 1))

          if (elapsed >= SILENCE_DURATION_MS) {
            // Auto-stop recording
            const voice = getVoiceSubsystem()
            voice.stopRecording()
            stopSilenceDetection()
            return
          }
        } else {
          // Reset silence timer
          silenceStartRef.current = 0
          setSilenceProgress(0)
        }

        silenceRafRef.current = requestAnimationFrame(checkSilence)
      }

      silenceRafRef.current = requestAnimationFrame(checkSilence)
    } catch (err) {
      console.warn('[VoiceButton] Silence detection setup failed:', err)
    }
  }, [stopSilenceDetection])

  // Start/stop silence detection based on recording status
  useEffect(() => {
    if (status === 'recording') {
      startSilenceDetection()
    } else {
      stopSilenceDetection()
    }
  }, [status, startSilenceDetection, stopSilenceDetection])

  // Cleanup on unmount
  useEffect(() => {
    return () => stopSilenceDetection()
  }, [stopSilenceDetection])

  const handlePress = useCallback(async () => {
    // CRITICAL: Unlock AudioContext synchronously on the user gesture call stack.
    // iOS Safari only allows AudioContext creation/resume during an active user tap.
    // This MUST happen before any awaits or the gesture chain breaks.
    unlockAudioContext()

    // Pre-unlock Web Speech on gesture — iOS requires a speechSynthesis.speak()
    // call within the user gesture stack before it allows later async speak() calls.
    if (window.speechSynthesis) {
      const unlock = new SpeechSynthesisUtterance('')
      unlock.volume = 0
      window.speechSynthesis.speak(unlock)
      window.speechSynthesis.cancel()
    }

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

      {/* Silence detection progress bar */}
      {isRecording && silenceProgress > 0 && (
        <div className="fixed bottom-[72px] right-6 z-50 w-14">
          <div style={{
            height: '3px',
            borderRadius: '2px',
            background: 'rgba(255,255,255,0.15)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${silenceProgress * 100}%`,
              background: silenceProgress > 0.7 ? '#ef4444' : '#eab308',
              borderRadius: '2px',
              transition: 'width 0.1s linear',
            }} />
          </div>
          <p style={{
            fontSize: '9px',
            color: '#9ca3af',
            textAlign: 'center',
            margin: '2px 0 0',
          }}>
            {silenceProgress > 0.7 ? 'Auto-stop...' : 'Silence'}
          </p>
        </div>
      )}

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
      {isDebugMode && (
        <div style={{ position: 'fixed', bottom: '90px', right: '12px', zIndex: 9998 }}>
          {debugExpanded ? (
            <div style={{
              background: 'rgba(0,0,0,0.92)',
              border: '1px solid #2EE89A',
              borderRadius: '12px',
              width: '320px',
              maxHeight: '200px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 10px',
                borderBottom: '1px solid rgba(255,255,255,0.1)'
              }}>
                <span style={{ color: '#2EE89A', fontFamily: 'monospace', fontSize: '10px', fontWeight: 700 }}>
                  AUDIO DEBUG · {voiceDebugLog.length} entries · {status}
                </span>
                <button onClick={() => setDebugExpanded(false)}
                  style={{ background: 'none', border: 'none', color: '#60607A', cursor: 'pointer', fontSize: '14px' }}>
                  ✕
                </button>
              </div>
              <div ref={debugScrollRef} style={{ overflow: 'auto', padding: '6px 10px', flex: 1 }}>
                {voiceDebugLog.map((entry, i) => (
                  <div key={i} style={{
                    fontFamily: 'monospace',
                    fontSize: '10px',
                    color: entry.includes('ERROR') || entry.includes('FAILED') ? '#FF5060' :
                           entry.includes('OK') || entry.includes('complete') || entry.includes('unlocked') ? '#2EE89A' : '#A8A8C0',
                    marginBottom: '2px',
                    wordBreak: 'break-all'
                  }}>{entry}</div>
                ))}
              </div>
            </div>
          ) : (
            <button onClick={() => setDebugExpanded(true)} style={{
              background: 'rgba(0,0,0,0.85)',
              border: '1px solid #2EE89A',
              borderRadius: '20px',
              padding: '6px 12px',
              color: '#2EE89A',
              fontFamily: 'monospace',
              fontSize: '10px',
              fontWeight: 700,
              cursor: 'pointer'
            }}>
              DEBUG {voiceDebugLog.length}
            </button>
          )}
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
