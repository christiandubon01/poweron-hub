/**
 * VoiceStatusBar — Slim status bar showing current voice state
 *
 * Displays at top of content area when voice is active.
 * Shows: current mode, last transcript, active agent badge, confidence indicator.
 * Auto-hides when inactive for 5 seconds after last session completes.
 */

import { useState, useEffect, useRef } from 'react'
import { Mic, Volume2, Loader2, X, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { getVoiceSubsystem, type VoiceSessionStatus, type VoiceSession } from '@/services/voice'

// Agent badge colors matching the app theme
const AGENT_COLORS: Record<string, string> = {
  nexus:     'bg-emerald-500/20 text-emerald-400',
  spark:     'bg-pink-500/20 text-pink-400',
  chrono:    'bg-orange-500/20 text-orange-400',
  vault:     'bg-amber-500/20 text-amber-400',
  blueprint: 'bg-blue-500/20 text-blue-400',
  ohm:       'bg-yellow-500/20 text-yellow-400',
  ledger:    'bg-purple-500/20 text-purple-400',
  pulse:     'bg-cyan-500/20 text-cyan-400',
  scout:     'bg-indigo-500/20 text-indigo-400',
}

export function VoiceStatusBar() {
  const [status, setStatus] = useState<VoiceSessionStatus>('inactive')
  const [session, setSession] = useState<VoiceSession | null>(null)
  const [visible, setVisible] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const voice = getVoiceSubsystem()

    const unsub = voice.on((event) => {
      const currentStatus = voice.getStatus()
      setStatus(currentStatus)

      if (event.session) {
        setSession({ ...event.session })
      }

      // Show bar when any voice activity starts
      if (currentStatus !== 'inactive') {
        setVisible(true)
        if (hideTimer.current) clearTimeout(hideTimer.current)
      }

      // Auto-hide after session completes
      if (currentStatus === 'complete' || currentStatus === 'inactive') {
        hideTimer.current = setTimeout(() => setVisible(false), 5000)
      }
    })

    return () => {
      unsub()
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  const handleDismiss = () => {
    setVisible(false)
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }

  if (!visible) return null

  const isActive = status !== 'inactive' && status !== 'complete'
  const agentName = session?.targetAgent?.toLowerCase() || ''
  const agentColor = AGENT_COLORS[agentName] || 'bg-gray-500/20 text-gray-400'

  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-4 py-2',
        'bg-gray-800/80 backdrop-blur-sm border-b border-gray-700/50',
        'text-sm transition-all duration-300',
        isActive ? 'animate-in' : 'opacity-80',
      )}
    >
      {/* Status indicator */}
      <StatusIcon status={status} />

      {/* Status text */}
      <span className="text-gray-400 flex-shrink-0">
        {getStatusLabel(status)}
      </span>

      {/* Transcript */}
      {session?.transcriptRaw && (
        <span className="text-gray-200 truncate max-w-[300px] font-medium">
          &ldquo;{session.transcriptRaw}&rdquo;
        </span>
      )}

      {/* Confidence badge */}
      {session?.transcriptConfidence != null && session.transcriptConfidence > 0 && (
        <span className={clsx(
          'text-xs px-1.5 py-0.5 rounded-full flex-shrink-0',
          session.transcriptConfidence > 0.8
            ? 'bg-emerald-500/20 text-emerald-400'
            : session.transcriptConfidence > 0.5
            ? 'bg-yellow-500/20 text-yellow-400'
            : 'bg-red-500/20 text-red-400',
        )}>
          {Math.round(session.transcriptConfidence * 100)}%
        </span>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Agent badge */}
      {session?.targetAgent && (
        <span className={clsx(
          'text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0',
          agentColor,
        )}>
          <Zap className="w-3 h-3 inline mr-1" />
          {session.targetAgent}
        </span>
      )}

      {/* Agent response preview */}
      {session?.agentResponse && status === 'complete' && (
        <span className="text-gray-400 text-xs truncate max-w-[200px]">
          {session.agentResponse}
        </span>
      )}

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded flex-shrink-0"
        aria-label="Dismiss voice status"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function StatusIcon({ status }: { status: VoiceSessionStatus }) {
  switch (status) {
    case 'listening':
      return <Mic className="w-4 h-4 text-emerald-400 animate-pulse flex-shrink-0" />
    case 'recording':
      return (
        <span className="relative flex-shrink-0">
          <Mic className="w-4 h-4 text-red-400" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-ping" />
        </span>
      )
    case 'transcribing':
    case 'processing':
      return <Loader2 className="w-4 h-4 text-cyan-400 animate-spin flex-shrink-0" />
    case 'responding':
      return <Volume2 className="w-4 h-4 text-cyan-400 animate-pulse flex-shrink-0" />
    case 'complete':
      return <Mic className="w-4 h-4 text-gray-500 flex-shrink-0" />
    default:
      return <Mic className="w-4 h-4 text-gray-600 flex-shrink-0" />
  }
}

function getStatusLabel(status: VoiceSessionStatus): string {
  switch (status) {
    case 'listening':    return 'Listening...'
    case 'recording':    return 'Recording...'
    case 'transcribing': return 'Transcribing...'
    case 'processing':   return 'Processing...'
    case 'responding':   return 'Speaking...'
    case 'complete':     return 'Done'
    case 'error':        return 'Error'
    default:             return ''
  }
}
