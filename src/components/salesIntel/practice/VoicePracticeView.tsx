// @ts-nocheck
/**
 * ST2 — Voice Practice View
 * 
 * Full-screen practice interface for SPARK voice training.
 * Optimized for voice conversation with character AI.
 * 
 * Modes:
 * - Voice-to-Voice: mic in → character responds (no visible transcript)
 * - Voice + Transcript: mic in → scrolling transcript visible
 * - Text Only: keyboard input → text response (no audio)
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Mic, MicOff, Square, Volume2, VolumeX, RotateCcw, X,
  BarChart3, Clock, User, Zap, AlertCircle, CheckCircle2,
} from 'lucide-react'
import clsx from 'clsx'

import {
  startMicCapture,
  stopMicCapture,
  transcribeUserSpeech,
  getCharacterResponse,
  characterSpeechGenerator,
  playAudioChunk,
  stopAudio,
  setCharacterVolume,
  clearConversationHistory,
  getConversationTranscript,
  ADAM_STONE_VOICE,
} from '@/services/sparkTraining/SparkTrainingVoice'

import type {
  VoiceMode,
  PracticeRound,
  CharacterPersonality,
  TranscriptEntry,
  VoiceAudioChunk,
} from '@/services/sparkTraining/SparkTrainingVoice'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface WaveformData {
  isUserSpeaking: boolean
  isCharacterSpeaking: boolean
  audioLevel: number  // 0-1
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: Waveform Visualizer
// ─────────────────────────────────────────────────────────────────────────────

function WaveformVisualizer({ data }: { data: WaveformData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const width = canvas.width
    const height = canvas.height
    const centerY = height / 2
    
    // Clear canvas
    ctx.fillStyle = '#09090b'
    ctx.fillRect(0, 0, width, height)
    
    // Draw center line
    ctx.strokeStyle = 'rgba(113, 113, 122, 0.2)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    ctx.lineTo(width, centerY)
    ctx.stroke()
    
    // Draw waveform
    ctx.strokeStyle = data.isUserSpeaking
      ? 'rgb(34, 197, 94)'  // Green for user
      : data.isCharacterSpeaking
      ? 'rgb(59, 130, 246)'  // Blue for character
      : 'rgba(113, 113, 122, 0.5)'
    
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    
    const amplitude = data.audioLevel * (centerY - 10)
    const frequency = data.isUserSpeaking || data.isCharacterSpeaking ? 8 : 4
    
    ctx.beginPath()
    for (let x = 0; x < width; x += 2) {
      const y = centerY + Math.sin((x / width) * frequency * Math.PI * 2) * amplitude
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }, [data])
  
  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={80}
      className="w-full rounded border border-zinc-700/30 bg-zinc-900/20"
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: Transcript Panel
// ─────────────────────────────────────────────────────────────────────────────

function TranscriptPanel({ entries }: { entries: TranscriptEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries])
  
  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto rounded border border-zinc-700/30 bg-zinc-900/20 p-4 space-y-3 text-sm"
    >
      {entries.length === 0 && (
        <p className="text-center text-zinc-500 text-xs py-8">
          Conversation will appear here...
        </p>
      )}
      
      {entries.map((entry, idx) => (
        <div key={idx} className={clsx(
          'space-y-1',
          entry.speaker === 'user' ? 'text-right' : 'text-left'
        )}>
          <div className={clsx(
            'text-xs font-medium opacity-60',
            entry.speaker === 'user' ? 'text-blue-400' : 'text-green-400'
          )}>
            {entry.speaker === 'user' ? 'You' : 'Adam Stone'}
          </div>
          <div className={clsx(
            'inline-block max-w-xs px-3 py-2 rounded-lg',
            entry.speaker === 'user'
              ? 'bg-blue-500/20 text-blue-100 rounded-br-none'
              : 'bg-green-500/20 text-green-100 rounded-bl-none'
          )}>
            {entry.text}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: Character Info Bar
// ─────────────────────────────────────────────────────────────────────────────

function CharacterInfoBar({ character, difficulty }: {
  character: CharacterPersonality
  difficulty: 1 | 2 | 3 | 4 | 5
}) {
  const difficultyLabel = ['', 'Easy', 'Medium', 'Hard', 'Harder', 'Expert'][difficulty]
  const difficultyColor: Record<number, string> = {
    1: 'bg-green-500/20 text-green-300 border-green-500/30',
    2: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    3: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    4: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    5: 'bg-red-500/20 text-red-300 border-red-500/30',
  }
  
  return (
    <div className="flex items-center justify-between bg-zinc-900/40 border border-zinc-700/30 rounded-lg p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
          <User size={20} className="text-white" />
        </div>
        <div>
          <div className="font-medium text-white">{character.name}</div>
          <div className="text-xs text-zinc-400">{character.tone}</div>
        </div>
      </div>
      
      <div className={clsx(
        'px-3 py-1 rounded-full text-xs font-medium border',
        difficultyColor[difficulty]
      )}>
        {difficultyLabel} • L{difficulty}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export interface VoicePracticeViewProps {
  mode: VoiceMode
  difficulty: 1 | 2 | 3 | 4 | 5
  character?: CharacterPersonality
  onRoundEnd?: (transcript: TranscriptEntry[]) => void
  onClose?: () => void
}

export default function VoicePracticeView({
  mode = 'voice-transcript',
  difficulty = 2,
  character = ADAM_STONE_VOICE,
  onRoundEnd,
  onClose,
}: VoicePracticeViewProps) {
  // State
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [waveform, setWaveform] = useState<WaveformData>({
    isUserSpeaking: false,
    isCharacterSpeaking: false,
    audioLevel: 0,
  })
  const [volume, setVolume] = useState(1.0)
  const [audioMuted, setAudioMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const roundStartRef = useRef<number>(Date.now())
  
  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1)
    }, 1000)
    
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])
  
  // Handle user turn
  const handleUserTurn = useCallback(async () => {
    if (isRecording) {
      // Stop recording
      setWaveform(w => ({ ...w, isUserSpeaking: false }))
      setIsRecording(false)
      setIsProcessing(true)
      setError(null)
      
      try {
        const audioBlob = await stopMicCapture()
        
        // Transcribe
        console.log('[VoicePracticeView] Transcribing user speech...')
        const userText = await transcribeUserSpeech(audioBlob)
        
        // Add to transcript
        setTranscript(prev => [...prev, {
          speaker: 'user',
          text: userText,
          timestamp: Date.now(),
        }])
        
        // Get character response
        console.log('[VoicePracticeView] Getting character response...')
        const characterText = await getCharacterResponse(
          character,
          userText,
          difficulty
        )
        
        // Generate and stream audio
        console.log('[VoicePracticeView] Generating character audio...')
        setWaveform(w => ({ ...w, isCharacterSpeaking: true }))
        
        let firstChunk = true
        for await (const chunk of characterSpeechGenerator(characterText, character)) {
          if (firstChunk) {
            console.log('[VoicePracticeView] First audio chunk ready, playing...')
            firstChunk = false
          }
          
          // Add text to transcript
          setTranscript(prev => [...prev, {
            speaker: 'character',
            text: chunk.text,
            timestamp: Date.now(),
            audioUrl: chunk.audioUrl,
          }])
          
          // Play audio
          if (!audioMuted) {
            setCharacterVolume(volume)
            await playAudioChunk(chunk.audioUrl)
          }
        }
        
        setWaveform(w => ({ ...w, isCharacterSpeaking: false }))
      } catch (err) {
        console.error('[VoicePracticeView] Turn failed:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setIsProcessing(false)
      }
    } else {
      // Start recording
      setIsRecording(true)
      setWaveform(w => ({ ...w, isUserSpeaking: true }))
      setError(null)
      
      try {
        await startMicCapture(async (audioBlob) => {
          // Auto-submit after silence
          if (isRecording) {
            // Recursive call would be complex, so we'll let user click manually
            console.log('[VoicePracticeView] Silence detected')
          }
        })
      } catch (err) {
        console.error('[VoicePracticeView] Mic start failed:', err)
        setError(err instanceof Error ? err.message : 'Microphone access denied')
        setIsRecording(false)
      }
    }
  }, [isRecording, character, difficulty, audioMuted, volume])
  
  // Handle text mode input
  const handleTextInput = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const userText = (formData.get('userInput') as string).trim()
    
    if (!userText) return
    
    setIsProcessing(true)
    setError(null)
    
    try {
      // Add user message
      setTranscript(prev => [...prev, {
        speaker: 'user',
        text: userText,
        timestamp: Date.now(),
      }])
      
      // Get response
      const characterText = await getCharacterResponse(
        character,
        userText,
        difficulty
      )
      
      // Add character response (text only in text mode)
      setTranscript(prev => [...prev, {
        speaker: 'character',
        text: characterText,
        timestamp: Date.now(),
      }])
      
      // Clear input
      e.currentTarget.reset()
    } catch (err) {
      console.error('[VoicePracticeView] Response failed:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsProcessing(false)
    }
  }, [character, difficulty])
  
  // Handle end round
  const handleEndRound = useCallback(() => {
    stopAudio()
    clearConversationHistory()
    onRoundEnd?.(transcript)
  }, [transcript, onRoundEnd])
  
  // Format time
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="border-b border-zinc-700/30 bg-zinc-900/40 backdrop-blur p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <CharacterInfoBar character={character} difficulty={difficulty} />
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Clock size={16} />
              {formatTime(elapsedSeconds)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-700/20 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col p-6 gap-4">
        {/* Waveform */}
        <WaveformVisualizer data={waveform} />
        
        {/* Transcript or Input */}
        {mode === 'text-only' ? (
          <form onSubmit={handleTextInput} className="flex-1 flex flex-col gap-4">
            <TranscriptPanel entries={transcript} />
            
            <div className="flex gap-2">
              <input
                type="text"
                name="userInput"
                placeholder="Type your response..."
                disabled={isProcessing}
                className="flex-1 px-4 py-2 rounded border border-zinc-700/30 bg-zinc-900/40 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500/50 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isProcessing}
                className="px-6 py-2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-50 font-medium text-sm"
              >
                {isProcessing ? 'Responding...' : 'Send'}
              </button>
            </div>
          </form>
        ) : (
          <TranscriptPanel entries={transcript} />
        )}
        
        {/* Error Message */}
        {error && (
          <div className="flex items-start gap-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        )}
      </div>
      
      {/* Controls Footer */}
      <div className="border-t border-zinc-700/30 bg-zinc-900/40 backdrop-blur p-6">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Volume Control */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAudioMuted(!audioMuted)}
              className={clsx(
                'p-2 rounded-lg transition-colors',
                audioMuted
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-zinc-700/20 text-zinc-300 hover:bg-zinc-700/40'
              )}
            >
              {audioMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              disabled={audioMuted}
              className="w-24 opacity-70 disabled:opacity-30"
            />
          </div>
          
          {/* Center: Mic / Stop */}
          {mode !== 'text-only' && (
            <button
              onClick={handleUserTurn}
              disabled={isProcessing}
              className={clsx(
                'w-14 h-14 rounded-full flex items-center justify-center font-medium transition-all disabled:opacity-50',
                isRecording
                  ? 'bg-red-500/40 text-red-300 border-2 border-red-500/60 hover:bg-red-500/50'
                  : 'bg-green-500/20 text-green-300 border-2 border-green-500/40 hover:bg-green-500/30'
              )}
            >
              {isRecording ? (
                <Square size={20} />
              ) : (
                <Mic size={20} />
              )}
            </button>
          )}
          
          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                stopAudio()
                clearConversationHistory()
                setTranscript([])
                setElapsedSeconds(0)
                roundStartRef.current = Date.now()
              }}
              className="px-4 py-2 rounded border border-zinc-700/30 bg-zinc-700/10 text-zinc-300 hover:bg-zinc-700/20 text-sm font-medium"
            >
              Reset
            </button>
            
            <button
              onClick={handleEndRound}
              className="px-6 py-2 rounded bg-blue-500/30 text-blue-300 border border-blue-500/40 hover:bg-blue-500/40 text-sm font-medium"
            >
              End Round
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
