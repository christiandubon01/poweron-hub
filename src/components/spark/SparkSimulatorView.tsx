// @ts-nocheck
/**
 * SparkSimulatorView.tsx
 * SP13 — SPARK Training Simulator UI
 *
 * Screens:
 *   1. Scenario Selection — difficulty + type picker
 *   2. Live Conversation  — scrolling transcript, timer, mic control
 *   3. Post-Round Scorecard — category breakdown + coaching tip
 *   4. Progress Dashboard — mastery per scenario, weak spots, milestones
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Mic, MicOff, Phone, PhoneOff, RotateCcw, TrendingUp,
  ChevronRight, Target, Award, AlertTriangle, CheckCircle2,
  Zap, BarChart2, Clock, User, Shield, Flame, Star
} from 'lucide-react'
import clsx from 'clsx'
import {
  generateScenario,
  createSession,
  sendCharacterMessage,
  speakAsCharacter,
  transcribeUserInput,
  finalizeRound,
  getProgress,
  saveProgress,
  detectActivation,
  parseCustomRequest,
  DIFFICULTY_BLUEPRINTS,
  buildAutoSuggestionPrompt,
} from '@/services/sparkLiveCall/SparkTrainingSimulator'
import type {
  DifficultyLevel,
  ScenarioType,
  SimScenario,
  SimSession,
  RoundScorecard,
  ProgressData,
  GenerateScenarioOptions,
} from '@/services/sparkLiveCall/SparkTrainingSimulator'

// ─────────────────────────────────────────────────────────────────────────────
// Constants / helpers
// ─────────────────────────────────────────────────────────────────────────────

const SCENARIO_TYPES: { id: ScenarioType; label: string; description: string; icon: string }[] = [
  { id: 'COLD_CALL',   label: 'Cold Call',    description: 'They don\'t know you — earn a conversation', icon: '📞' },
  { id: 'FOLLOW_UP',   label: 'Follow Up',    description: '"I\'ll think about it" — close them now',    icon: '🔁' },
  { id: 'ONSITE',      label: 'On Site',      description: 'GC walks up — you have 90 seconds',          icon: '🏗️' },
  { id: 'NEGOTIATE',   label: 'Negotiate',    description: 'They want you cheaper — defend your rate',   icon: '💰' },
  { id: 'SCOPE_CREEP', label: 'Scope Creep',  description: 'Extra work, no extra money? Handle it',      icon: '📋' },
  { id: 'CUSTOM',      label: 'Custom',       description: 'Describe the scenario — SPARK generates it', icon: '✏️' },
]

const DIFFICULTY_COLORS: Record<DifficultyLevel, string> = {
  1: 'border-green-500/40 bg-green-500/10 text-green-400',
  2: 'border-blue-500/40 bg-blue-500/10 text-blue-400',
  3: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400',
  4: 'border-orange-500/40 bg-orange-500/10 text-orange-400',
  5: 'border-red-500/40 bg-red-500/10 text-red-400',
}

const SCORE_BAR_COLOR = (score: number) => {
  if (score >= 8) return 'bg-green-500'
  if (score >= 6) return 'bg-blue-500'
  if (score >= 4) return 'bg-yellow-500'
  return 'bg-red-500'
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: Difficulty Badge
// ─────────────────────────────────────────────────────────────────────────────

function DifficultyBadge({ level }: { level: DifficultyLevel }) {
  const bp = DIFFICULTY_BLUEPRINTS[level]
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium border', DIFFICULTY_COLORS[level])}>
      L{level} · {bp.label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: Score Row
// ─────────────────────────────────────────────────────────────────────────────

function ScoreRow({ label, result }: { label: string; result: { score: number; note: string } }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-300 font-medium">{label}</span>
        <span className={clsx('font-bold tabular-nums', result.score >= 7 ? 'text-green-400' : result.score >= 5 ? 'text-yellow-400' : 'text-red-400')}>
          {result.score}/10
        </span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-700', SCORE_BAR_COLOR(result.score))}
          style={{ width: `${result.score * 10}%` }}
        />
      </div>
      <p className="text-xs text-zinc-500 italic">{result.note}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen 1: Scenario Selector
// ─────────────────────────────────────────────────────────────────────────────

interface ScenarioSelectorProps {
  onStart: (opts: GenerateScenarioOptions) => void
}

function ScenarioSelector({ onStart }: ScenarioSelectorProps) {
  const [selectedType,       setSelectedType]       = useState<ScenarioType>('COLD_CALL')
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyLevel>(2)
  const [leadName,           setLeadName]           = useState('')
  const [customDesc,         setCustomDesc]         = useState('')

  function handleStart() {
    onStart({
      type:       selectedType,
      difficulty: selectedDifficulty,
      leadName:   leadName.trim() || undefined,
      customDesc: customDesc.trim() || undefined,
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-2 border-b border-zinc-800">
        <Zap size={20} className="text-yellow-400" />
        <div>
          <h2 className="text-lg font-bold text-white">Training Simulator</h2>
          <p className="text-xs text-zinc-400">Practice sales conversations. Get graded. Level up.</p>
        </div>
      </div>

      {/* Scenario Type */}
      <div>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Scenario Type</p>
        <div className="grid grid-cols-2 gap-2">
          {SCENARIO_TYPES.map(st => (
            <button
              key={st.id}
              onClick={() => setSelectedType(st.id)}
              className={clsx(
                'text-left p-3 rounded-xl border transition-all duration-150',
                selectedType === st.id
                  ? 'border-yellow-500/60 bg-yellow-500/10 text-white'
                  : 'border-zinc-700/50 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600',
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base">{st.icon}</span>
                <span className="text-sm font-semibold">{st.label}</span>
              </div>
              <p className="text-xs text-zinc-500 leading-tight">{st.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Custom description */}
      {selectedType === 'CUSTOM' && (
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Describe the Scenario</p>
          <textarea
            value={customDesc}
            onChange={e => setCustomDesc(e.target.value)}
            placeholder="e.g. A skeptical GC who already has a sub and thinks I'm too young"
            rows={2}
            className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-yellow-500/50 resize-none"
          />
        </div>
      )}

      {/* Difficulty */}
      <div>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Difficulty Level</p>
        <div className="flex flex-col gap-2">
          {([1, 2, 3, 4, 5] as DifficultyLevel[]).map(level => {
            const bp = DIFFICULTY_BLUEPRINTS[level]
            return (
              <button
                key={level}
                onClick={() => setSelectedDifficulty(level)}
                className={clsx(
                  'flex items-center gap-3 p-3 rounded-xl border transition-all duration-150',
                  selectedDifficulty === level
                    ? `${DIFFICULTY_COLORS[level]} border-opacity-80`
                    : 'border-zinc-700/50 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600',
                )}
              >
                <span className="text-sm font-bold w-4 tabular-nums">L{level}</span>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold">{bp.label}</p>
                  <p className="text-xs opacity-70">{bp.description}</p>
                </div>
                {selectedDifficulty === level && <CheckCircle2 size={16} className="shrink-0" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Optional lead name */}
      <div>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Pipeline Lead Name (Optional)</p>
        <input
          type="text"
          value={leadName}
          onChange={e => setLeadName(e.target.value)}
          placeholder='e.g. "Marcus Torres" — personalizes the scenario'
          className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-yellow-500/50"
        />
      </div>

      {/* Start Button */}
      <button
        onClick={handleStart}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-sm transition-colors"
      >
        <Zap size={16} />
        Start Practice Round
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen 2: Live Conversation
// ─────────────────────────────────────────────────────────────────────────────

interface LiveConversationProps {
  session:          SimSession
  scenario:         SimScenario
  onSessionUpdate:  (s: SimSession) => void
  onEndRound:       (s: SimSession) => void
}

function LiveConversation({ session, scenario, onSessionUpdate, onEndRound }: LiveConversationProps) {
  const [isRecording,    setIsRecording]    = useState(false)
  const [isThinking,     setIsThinking]     = useState(false)
  const [isSpeaking,     setIsSpeaking]     = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [statusText,     setStatusText]     = useState('Ready — press mic to speak')
  const [audioUrls,      setAudioUrls]      = useState<string[]>([])

  const transcriptRef = useRef<HTMLDivElement>(null)
  const mediaRecRef   = useRef<MediaRecorder | null>(null)
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const chunksRef     = useRef<Blob[]>([])
  const sessionRef    = useRef<SimSession>(session)
  sessionRef.current  = session

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
    }
  }, [session.transcript])

  // Cleanup audio URLs on unmount
  useEffect(() => {
    return () => { audioUrls.forEach(url => URL.revokeObjectURL(url)) }
  }, [audioUrls])

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => { stream.getTracks().forEach(t => t.stop()) }
      mr.start()
      mediaRecRef.current = mr
      setIsRecording(true)
      setStatusText('Recording… speak now')
    } catch (err) {
      console.error('[SparkSimulatorView] mic error:', err)
      setStatusText('Microphone access denied')
    }
  }

  async function stopRecordingAndProcess() {
    if (!mediaRecRef.current) return
    setIsRecording(false)
    setStatusText('Transcribing…')

    mediaRecRef.current.stop()

    // Wait a beat for onstop to fire
    await new Promise(res => setTimeout(res, 300))

    const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' })

    if (audioBlob.size < 1000) {
      setStatusText('Too short — try again')
      return
    }

    setIsThinking(true)
    setStatusText('Thinking…')

    try {
      const userText = await transcribeUserInput(audioBlob)
      if (!userText.trim()) {
        setIsThinking(false)
        setStatusText('Couldn\'t hear you — try again')
        return
      }

      const { updatedSession, characterReply } = await sendCharacterMessage(sessionRef.current, userText)
      onSessionUpdate(updatedSession)

      // Speak character reply
      setIsThinking(false)
      setIsSpeaking(true)
      setStatusText(`${scenario.character.name} is responding…`)

      const audioUrl = await speakAsCharacter(characterReply)
      if (audioUrl) {
        setAudioUrls(prev => [...prev, audioUrl])
        const audio = new Audio(audioUrl)
        audio.onended = () => {
          setIsSpeaking(false)
          setStatusText('Your turn — press mic to respond')
        }
        audio.play().catch(() => setIsSpeaking(false))
      } else {
        setIsSpeaking(false)
        setStatusText('Your turn — press mic to respond')
      }
    } catch (err) {
      console.error('[SparkSimulatorView] processing error:', err)
      setIsThinking(false)
      setIsSpeaking(false)
      setStatusText('Error — try again')
    }
  }

  function toggleMic() {
    if (isRecording) {
      stopRecordingAndProcess()
    } else if (!isThinking && !isSpeaking) {
      startRecording()
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <User size={14} className="text-yellow-400" />
            <span className="text-sm font-bold text-white">{scenario.character.name}</span>
            <DifficultyBadge level={scenario.difficulty} />
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{scenario.character.role} · {scenario.type.replace('_', ' ')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Clock size={13} className="text-zinc-500" />
          <span className="text-sm font-mono text-zinc-300">{formatTime(elapsedSeconds)}</span>
        </div>
      </div>

      {/* Scene Context */}
      <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-3">
        <p className="text-xs text-zinc-400 leading-relaxed italic">"{scenario.context}"</p>
      </div>

      {/* Transcript */}
      <div
        ref={transcriptRef}
        className="flex-1 min-h-[200px] max-h-[320px] overflow-y-auto space-y-3 pr-1"
      >
        {session.transcript.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-zinc-600 italic">Press the mic to begin the conversation…</p>
          </div>
        ) : (
          session.transcript.map((entry, i) => (
            <div
              key={i}
              className={clsx(
                'flex gap-2',
                entry.role === 'user' ? 'justify-end' : 'justify-start',
              )}
            >
              {entry.role === 'character' && (
                <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center shrink-0 mt-0.5">
                  <User size={12} className="text-zinc-300" />
                </div>
              )}
              <div
                className={clsx(
                  'max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed',
                  entry.role === 'user'
                    ? 'bg-yellow-500/15 border border-yellow-500/30 text-yellow-100'
                    : 'bg-zinc-800/80 border border-zinc-700/50 text-zinc-200',
                )}
              >
                {entry.text}
              </div>
              {entry.role === 'user' && (
                <div className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Mic size={11} className="text-yellow-400" />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Status + Controls */}
      <div className="space-y-3 pt-2 border-t border-zinc-800">
        <p className="text-center text-xs text-zinc-500">{statusText}</p>

        <div className="flex items-center justify-center gap-4">
          {/* Mic Button */}
          <button
            onClick={toggleMic}
            disabled={isThinking || isSpeaking}
            className={clsx(
              'w-14 h-14 rounded-full flex items-center justify-center transition-all duration-150 border-2',
              isRecording
                ? 'bg-red-500 border-red-400 animate-pulse shadow-lg shadow-red-500/30'
                : isThinking || isSpeaking
                  ? 'bg-zinc-700/50 border-zinc-600/30 opacity-50 cursor-not-allowed'
                  : 'bg-yellow-500/15 border-yellow-500/50 hover:bg-yellow-500/25',
            )}
          >
            {isRecording ? <MicOff size={22} className="text-white" /> : <Mic size={22} className="text-yellow-400" />}
          </button>

          {/* End Round */}
          <button
            onClick={() => onEndRound(session)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-zinc-700/50 bg-zinc-800/60 text-zinc-300 hover:text-white hover:border-zinc-600 text-sm transition-colors"
          >
            <PhoneOff size={14} />
            End Round
          </button>
        </div>

        <p className="text-center text-xs text-zinc-600">
          {isRecording ? '🔴 Recording — release mic when done speaking' : 'Hold mic to record, tap again to send'}
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen 3: Post-Round Scorecard
// ─────────────────────────────────────────────────────────────────────────────

interface ScorecardScreenProps {
  scorecard:      RoundScorecard
  scenario:       SimScenario
  onAgain:        () => void
  onHarder:       () => void
  onNewScenario:  () => void
}

function ScorecardScreen({ scorecard, scenario, onAgain, onHarder, onNewScenario }: ScorecardScreenProps) {
  const overallColor = scorecard.overall >= 7 ? 'text-green-400' : scorecard.overall >= 5 ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
        <div>
          <h2 className="text-lg font-bold text-white">Round Scorecard</h2>
          <p className="text-xs text-zinc-500">
            {scenario.type.replace('_', ' ')} · <DifficultyBadge level={scenario.difficulty} />
          </p>
        </div>
        <div className="text-right">
          <p className={clsx('text-3xl font-black tabular-nums', overallColor)}>{scorecard.overall}<span className="text-base font-normal text-zinc-500">/10</span></p>
          <p className="text-xs text-zinc-500">Overall</p>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="space-y-4">
        <ScoreRow label="Opening"            result={scorecard.opening} />
        <ScoreRow label="Objection Handling" result={scorecard.objectionHandling} />
        <ScoreRow label="Technical Depth"   result={scorecard.technicalDepth} />
        <ScoreRow label="Closing"            result={scorecard.closing} />
        <ScoreRow label="Pace"               result={scorecard.pace} />
        <ScoreRow label="Emotional Control"  result={scorecard.emotionalControl} />
      </div>

      {/* Coaching Tip */}
      <div className="bg-zinc-800/60 border border-yellow-500/20 rounded-xl p-4">
        <div className="flex items-start gap-2">
          <Zap size={15} className="text-yellow-400 mt-0.5 shrink-0" />
          <p className="text-sm text-zinc-200 leading-relaxed italic">"{scorecard.coachingTip}"</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onAgain}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-zinc-800/80 border border-zinc-700/50 text-zinc-200 hover:text-white hover:border-zinc-500 text-sm font-semibold transition-colors"
        >
          <RotateCcw size={14} />
          AGAIN
        </button>
        {scenario.difficulty < 5 && (
          <button
            onClick={onHarder}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-orange-500/15 border border-orange-500/40 text-orange-300 hover:bg-orange-500/25 text-sm font-semibold transition-colors"
          >
            <Flame size={14} />
            HARDER
          </button>
        )}
        <button
          onClick={onNewScenario}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-yellow-500/15 border border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/25 text-sm font-semibold transition-colors"
        >
          <ChevronRight size={14} />
          NEW
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen 4: Progress Dashboard
// ─────────────────────────────────────────────────────────────────────────────

interface ProgressDashboardProps {
  progress: ProgressData
  onStart:  () => void
}

function ProgressDashboard({ progress, onStart }: ProgressDashboardProps) {
  const recentAvg = progress.recentScorecards.length
    ? (progress.recentScorecards.slice(0, 5).reduce((sum, s) => sum + s.overall, 0) / Math.min(5, progress.recentScorecards.length)).toFixed(1)
    : '—'

  const SCENARIO_LABELS: Record<ScenarioType, string> = {
    COLD_CALL:   'Cold Call',
    FOLLOW_UP:   'Follow Up',
    ONSITE:      'On Site',
    NEGOTIATE:   'Negotiate',
    SCOPE_CREEP: 'Scope Creep',
    CUSTOM:      'Custom',
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <BarChart2 size={18} className="text-yellow-400" />
          <h2 className="text-lg font-bold text-white">Your Progress</h2>
        </div>
        <button
          onClick={onStart}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-yellow-500/15 border border-yellow-500/40 text-yellow-300 text-xs font-semibold hover:bg-yellow-500/25 transition-colors"
        >
          <Zap size={12} />
          Practice
        </button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Rounds',       value: progress.roundsCompleted, icon: <Target size={16} className="text-yellow-400" /> },
          { label: 'Avg (last 5)', value: recentAvg,                icon: <Star size={16} className="text-blue-400" /> },
          { label: 'Milestones',   value: progress.milestones.length, icon: <Award size={16} className="text-green-400" /> },
        ].map(kpi => (
          <div key={kpi.label} className="bg-zinc-800/50 border border-zinc-700/40 rounded-xl p-3 text-center">
            <div className="flex justify-center mb-1">{kpi.icon}</div>
            <p className="text-xl font-black text-white tabular-nums">{kpi.value}</p>
            <p className="text-xs text-zinc-500">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Difficulty Progress */}
      <div>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Rounds by Difficulty</p>
        <div className="space-y-2">
          {([1, 2, 3, 4, 5] as DifficultyLevel[]).map(level => {
            const count = progress.difficultyProgress[level] ?? 0
            const maxCount = Math.max(...Object.values(progress.difficultyProgress), 1)
            const pct = Math.round((count / maxCount) * 100)
            return (
              <div key={level} className="flex items-center gap-3">
                <span className={clsx('text-xs font-bold w-20 shrink-0', DIFFICULTY_COLORS[level])}>
                  L{level} · {DIFFICULTY_BLUEPRINTS[level].label.split(' ')[0]}
                </span>
                <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={clsx('h-full rounded-full transition-all duration-700', {
                      'bg-green-500':  level === 1,
                      'bg-blue-500':   level === 2,
                      'bg-yellow-500': level === 3,
                      'bg-orange-500': level === 4,
                      'bg-red-500':    level === 5,
                    })}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-400 tabular-nums w-6 text-right">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Scenario Mastery */}
      <div>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Scenario Mastery</p>
        <div className="grid grid-cols-2 gap-2">
          {(Object.entries(progress.scenarioMastery) as [ScenarioType, number][]).map(([type, count]) => (
            <div key={type} className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl p-2.5 flex items-center justify-between">
              <span className="text-xs text-zinc-300">{SCENARIO_LABELS[type]}</span>
              <span className={clsx('text-sm font-bold tabular-nums', count >= 5 ? 'text-green-400' : 'text-zinc-400')}>
                {count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Weak Spots */}
      {progress.weakSpots.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Weak Spots</p>
          <div className="space-y-1.5">
            {progress.weakSpots.map((ws, i) => (
              <div key={i} className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
                <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-200">{ws}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Milestones */}
      {progress.milestones.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Milestones</p>
          <div className="space-y-1.5">
            {progress.milestones.map((m, i) => (
              <div key={i} className="flex items-start gap-2 bg-green-500/10 border border-green-500/20 rounded-lg p-2.5">
                <CheckCircle2 size={13} className="text-green-400 shrink-0 mt-0.5" />
                <p className="text-xs text-green-200">{m}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component: SparkSimulatorView
// ─────────────────────────────────────────────────────────────────────────────

type Screen = 'selector' | 'live' | 'scorecard' | 'progress'

export function SparkSimulatorView() {
  const [screen,       setScreen]       = useState<Screen>('selector')
  const [scenario,     setScenario]     = useState<SimScenario | null>(null)
  const [session,      setSession]      = useState<SimSession | null>(null)
  const [scorecard,    setScorecard]    = useState<RoundScorecard | null>(null)
  const [progress,     setProgress]     = useState<ProgressData>(getProgress)
  const [isGrading,    setIsGrading]    = useState(false)

  // Handle scenario selection and start
  function handleStartScenario(opts: GenerateScenarioOptions) {
    const newScenario = generateScenario(opts)
    const newSession  = createSession(newScenario)
    setScenario(newScenario)
    setSession(newSession)
    setScorecard(null)
    setScreen('live')
  }

  // End round — trigger grading
  async function handleEndRound(finalSession: SimSession) {
    if (!finalSession || finalSession.transcript.length === 0) {
      setScreen('selector')
      return
    }

    setIsGrading(true)
    try {
      const { updatedSession, scorecard: sc, updatedProgress } = await finalizeRound(finalSession)
      setSession(updatedSession)
      setScorecard(sc)
      setProgress(updatedProgress)
      setScreen('scorecard')
    } catch (err) {
      console.error('[SparkSimulatorView] grading error:', err)
    } finally {
      setIsGrading(false)
    }
  }

  // "AGAIN" — same scenario, fresh session
  function handleAgain() {
    if (!scenario) { setScreen('selector'); return }
    const newSession = createSession(scenario)
    setSession(newSession)
    setScorecard(null)
    setScreen('live')
  }

  // "HARDER" — same type, one difficulty step up
  function handleHarder() {
    if (!scenario) { setScreen('selector'); return }
    const nextDiff = Math.min(5, scenario.difficulty + 1) as DifficultyLevel
    handleStartScenario({ type: scenario.type, difficulty: nextDiff, leadName: scenario.pipelineLeadName })
  }

  // Tab bar
  const tabs: { id: Screen; label: string; icon: React.ReactNode }[] = [
    { id: 'selector', label: 'Practice', icon: <Zap size={14} /> },
    { id: 'progress', label: 'Progress', icon: <TrendingUp size={14} /> },
  ]

  return (
    <div className="flex flex-col h-full bg-zinc-900/50 rounded-2xl border border-zinc-800/60 overflow-hidden">
      {/* Tab Bar */}
      <div className="flex border-b border-zinc-800 px-4 pt-3">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              if (tab.id === 'selector' && screen !== 'live') setScreen('selector')
              if (tab.id === 'progress') setScreen('progress')
            }}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors mr-2',
              (screen === tab.id || (screen === 'scorecard' && tab.id === 'selector') || (screen === 'live' && tab.id === 'selector'))
                ? 'border-yellow-400 text-yellow-300'
                : 'border-transparent text-zinc-500 hover:text-zinc-300',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Grading overlay */}
        {isGrading && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-12 h-12 border-2 border-yellow-500/50 border-t-yellow-400 rounded-full animate-spin" />
            <p className="text-sm text-zinc-400">Grading your round…</p>
            <p className="text-xs text-zinc-600">SPARK is reviewing your performance</p>
          </div>
        )}

        {!isGrading && screen === 'selector' && (
          <ScenarioSelector onStart={handleStartScenario} />
        )}

        {!isGrading && screen === 'live' && scenario && session && (
          <LiveConversation
            session={session}
            scenario={scenario}
            onSessionUpdate={setSession}
            onEndRound={handleEndRound}
          />
        )}

        {!isGrading && screen === 'scorecard' && scorecard && scenario && (
          <ScorecardScreen
            scorecard={scorecard}
            scenario={scenario}
            onAgain={handleAgain}
            onHarder={handleHarder}
            onNewScenario={() => setScreen('selector')}
          />
        )}

        {!isGrading && screen === 'progress' && (
          <ProgressDashboard
            progress={progress}
            onStart={() => setScreen('selector')}
          />
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Additional named exports for Hub integration
// ─────────────────────────────────────────────────────────────────────────────

/** Check if a message triggers the training simulator (for CommandHUD integration). */
export function checkSimulatorActivation(text: string): boolean {
  return detectActivation(text)
}

/** Parse custom scenario request from voice input. */
export { parseCustomRequest as parseSimulatorRequest }

/** Build SPARK's suggestion prompt when a pipeline follow-up is detected. */
export { buildAutoSuggestionPrompt }

export default SparkSimulatorView
