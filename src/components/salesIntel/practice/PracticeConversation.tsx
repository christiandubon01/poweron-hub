/**
 * PracticeConversation.tsx
 * Live conversation view during practice rounds
 *
 * Features:
 *   - Voice mode: waveform animation while speaking
 *   - Transcript mode: scrolling transcript with speaker labels
 *   - Text mode: type responses
 *   - Round timer
 *   - END ROUND button always visible
 *   - Character info at top
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Mic, Send, Clock, AlertCircle, Volume2, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import type { PracticeSession, DifficultyLevel } from './PracticeTab'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ConversationMessage {
  id: string
  speaker: 'user' | 'character'
  text: string
  timestamp: Date
  isAudioPlaying?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Waveform Animation Component
// ─────────────────────────────────────────────────────────────────────────────

function WaveformAnimation() {
  return (
    <div className="flex items-center justify-center gap-1 h-12">
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="w-1 bg-gradient-to-t from-blue-400 to-blue-600 rounded-full"
          style={{
            height: `${20 + Math.sin(Date.now() / 100 + i) * 15}px`,
            animation: `wave 0.6s ease-in-out ${i * 0.1}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes wave {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Difficulty badge
// ─────────────────────────────────────────────────────────────────────────────

function DifficultyBadge({ level }: { level: DifficultyLevel }) {
  const colors = {
    1: 'bg-green-500/20 text-green-300 border-green-500/40',
    2: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    3: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
    4: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    5: 'bg-red-500/20 text-red-300 border-red-500/40',
  }
  const labels = { 1: 'Friendly', 2: 'Cautious', 3: 'Hardball', 4: 'Skeptic', 5: 'Gatekeeper' }

  return (
    <span className={clsx('inline-flex px-2.5 py-1 rounded-full border text-xs font-semibold', colors[level])}>
      {labels[level]}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Timer Component
// ─────────────────────────────────────────────────────────────────────────────

function RoundTimer({ startedAt }: { startedAt: Date }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date()
      const diff = Math.floor((now.getTime() - startedAt.getTime()) / 1000)
      setElapsed(diff)
    }, 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60

  return (
    <div className="flex items-center gap-1 text-sm font-semibold text-zinc-300">
      <Clock size={16} className="text-blue-400" />
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Transcript entry
// ─────────────────────────────────────────────────────────────────────────────

function TranscriptEntry({
  message,
  showTimestamp = false,
}: {
  message: ConversationMessage
  showTimestamp?: boolean
}) {
  return (
    <div className={clsx('flex gap-3 mb-3', message.speaker === 'user' ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-xs px-4 py-2.5 rounded-lg',
          message.speaker === 'user'
            ? 'bg-blue-600 text-white rounded-br-none'
            : 'bg-zinc-800 text-zinc-100 rounded-bl-none'
        )}
      >
        <p className="text-sm">{message.text}</p>
        {showTimestamp && (
          <p className="text-xs mt-1 opacity-60">
            {message.timestamp.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main PracticeConversation Component
// ─────────────────────────────────────────────────────────────────────────────

export function PracticeConversation({
  session,
  onEndRound,
}: {
  session: PracticeSession
  onEndRound: () => void
}) {
  const [messages, setMessages] = useState<ConversationMessage[]>([
    {
      id: '1',
      speaker: 'character',
      text: `Hi there! This is ${session.characterName}. How can I help you today?`,
      timestamp: new Date(),
    },
  ])

  const [userInput, setUserInput] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [isAIResponding, setIsAIResponding] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>()

  // Auto-scroll to latest message
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Handle recording timer
  useEffect(() => {
    if (isRecording) {
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(d => d + 1)
      }, 1000)
    } else {
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current)
      setRecordingDuration(0)
    }
    return () => {
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current)
    }
  }, [isRecording])

  // Handle text submission
  const handleSubmitText = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userInput.trim()) return

    // Add user message
    const userMessage: ConversationMessage = {
      id: `msg-${Date.now()}`,
      speaker: 'user',
      text: userInput,
      timestamp: new Date(),
    }
    setMessages(m => [...m, userMessage])
    setUserInput('')

    // Simulate AI response delay
    setIsAIResponding(true)
    await new Promise(resolve => setTimeout(resolve, 1500))

    // Add AI response (mock)
    const characterResponses = [
      "That's interesting. Can you elaborate on that?",
      "I appreciate that. Let me ask you a follow-up question...",
      "I hear you. But how does that address my concern about timeline?",
      "Okay, and what about pricing? How competitive is your bid?",
      "I appreciate the pitch, but I have three other quotes I'm comparing.",
    ]

    const aiMessage: ConversationMessage = {
      id: `msg-${Date.now() + 1}`,
      speaker: 'character',
      text: characterResponses[Math.floor(Math.random() * characterResponses.length)],
      timestamp: new Date(),
    }
    setMessages(m => [...m, aiMessage])
    setIsAIResponding(false)
  }

  // Handle voice recording
  const handleStartRecording = () => {
    setIsRecording(true)
    // In production: use MediaRecorder API or WebRTC
  }

  const handleStopRecording = () => {
    setIsRecording(false)
    // In production: send audio to Whisper for transcription
    // For now, simulate with placeholder
    setTimeout(() => {
      setUserInput('This is a transcribed voice message placeholder.')
    }, 500)
  }

  // Character info & difficulty
  const displayDifficulty = session.difficulty || 3

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-white">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div>
              <h2 className="text-lg font-bold">{session.characterName}</h2>
              <p className="text-sm text-zinc-400">{session.characterDescription}</p>
            </div>
            <div className="ml-auto">
              <DifficultyBadge level={displayDifficulty} />
            </div>
          </div>
        </div>
      </div>

      {/* Transcript area */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4 bg-gradient-to-b from-zinc-950 to-zinc-900">
        {messages.map((msg, idx) => (
          <TranscriptEntry key={msg.id} message={msg} showTimestamp={idx === 0 || idx === messages.length - 1} />
        ))}

        {isAIResponding && (
          <div className="flex gap-3 mb-3">
            <div className="bg-zinc-800 rounded-lg rounded-bl-none px-4 py-3 flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-blue-400" />
              <span className="text-sm text-zinc-300">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={transcriptEndRef} />
      </div>

      {/* Input area with mode-specific UI */}
      <div className="bg-zinc-900 border-t border-zinc-800 px-6 py-4">
        {/* Voice-to-voice or Voice+Transcript modes */}
        {(session.interactionMode === 'voice-to-voice' || session.interactionMode === 'voice-transcript') && (
          <div className="space-y-4">
            {/* Waveform when recording */}
            {isRecording && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <WaveformAnimation />
                <p className="text-center text-sm text-blue-300 mt-2">
                  Recording... {String(Math.floor(recordingDuration / 60)).padStart(2, '0')}:
                  {String(recordingDuration % 60).padStart(2, '0')}
                </p>
              </div>
            )}

            {/* Transcript visible in voice+transcript mode */}
            {session.interactionMode === 'voice-transcript' && userInput && (
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-xs text-zinc-400 mb-1">Live Transcript:</p>
                <p className="text-sm text-white">{userInput}</p>
              </div>
            )}

            {/* Recording buttons */}
            <div className="flex gap-3">
              {!isRecording ? (
                <>
                  <button
                    onClick={handleStartRecording}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <Mic size={18} />
                    Start Recording
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleStopRecording}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <X size={18} />
                    Stop & Submit
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Text-only mode */}
        {session.interactionMode === 'text-only' && (
          <form onSubmit={handleSubmitText} className="flex gap-2">
            <input
              type="text"
              value={userInput}
              onChange={e => setUserInput(e.target.value)}
              placeholder="Type your response..."
              disabled={isAIResponding}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isAIResponding || !userInput.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-lg flex items-center gap-2 transition-colors"
            >
              <Send size={18} />
            </button>
          </form>
        )}
      </div>

      {/* Footer with timer and controls */}
      <div className="bg-zinc-950 border-t border-zinc-800 px-6 py-4 flex items-center justify-between">
        <RoundTimer startedAt={session.startedAt!} />

        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">Round #{Math.floor(Math.random() * 5) + 1}</span>
          <span className="text-xs text-zinc-500">•</span>
          <span className="text-xs text-zinc-400">{session.callType.charAt(0).toUpperCase() + session.callType.slice(1)}</span>
        </div>

        <button
          onClick={onEndRound}
          className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          End Round
        </button>
      </div>
    </div>
  )
}
