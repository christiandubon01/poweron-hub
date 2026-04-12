/**
 * PracticeTab.tsx
 * Sales Intelligence Practice Tab — Call simulation & role-play training
 *
 * Features:
 *   - 6 call type selector (Vendor | Sub | GC | Homeowner | Solar | Custom)
 *   - 3 interaction modes (Voice-to-Voice | Voice + Transcript | Text Only)
 *   - 5 difficulty levels (Friendly → Gatekeeper)
 *   - SPARK suggestions from Coach tab weak spots
 *   - Live conversation view during practice round
 *   - Custom scenario editor with HUNTER lead context
 */

import { useState, useCallback, useEffect } from 'react'
import {
  Mic, MessageSquare, Volume2, Zap, AlertCircle, CheckCircle2,
  ChevronRight, Play, Lock, Lightbulb, User, Loader2,
} from 'lucide-react'
import clsx from 'clsx'
import { PracticeConversation } from './PracticeConversation'
import { CustomScenarioModal } from './CustomScenarioModal'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CallType = 'vendor' | 'sub' | 'gc' | 'homeowner' | 'solar' | 'custom'
export type InteractionMode = 'voice-to-voice' | 'voice-transcript' | 'text-only'
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5

export interface PracticeSession {
  id: string
  callType: CallType
  interactionMode: InteractionMode
  difficulty: DifficultyLevel
  customScenario?: string
  characterName?: string
  characterDescription?: string
  startedAt?: Date
}

export interface SPARKSuggestion {
  strength: string
  suggestedDifficulty: DifficultyLevel
  suggestedCallType: CallType
  reasoning: string
  score: number
  scoreMax: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CALL_TYPES: Array<{ id: CallType; label: string; emoji: string }> = [
  { id: 'vendor', label: 'Vendor Call', emoji: '🤝' },
  { id: 'sub', label: 'Sub Call', emoji: '👷' },
  { id: 'gc', label: 'GC Call', emoji: '🏗️' },
  { id: 'homeowner', label: 'Homeowner', emoji: '🏠' },
  { id: 'solar', label: 'Solar', emoji: '☀️' },
  { id: 'custom', label: 'Custom', emoji: '✏️' },
]

const INTERACTION_MODES: Array<{ id: InteractionMode; label: string; description: string }> = [
  {
    id: 'voice-to-voice',
    label: 'Voice-to-Voice',
    description: 'Speak through mic, AI responds via audio',
  },
  {
    id: 'voice-transcript',
    label: 'Voice + Transcript',
    description: 'Same as above + live transcript visible',
  },
  {
    id: 'text-only',
    label: 'Text Only',
    description: 'Type responses, read AI text (quiet mode)',
  },
]

const DIFFICULTY_LEVELS: Array<{ level: DifficultyLevel; label: string; description: string }> = [
  { level: 1, label: 'Friendly', description: 'Easy close, builds confidence' },
  { level: 2, label: 'Cautious', description: 'Needs convincing, patient' },
  { level: 3, label: 'Hardball', description: 'Price shops, compares to others' },
  { level: 4, label: 'Skeptic', description: 'Judges age/appearance, tests knowledge' },
  { level: 5, label: 'Gatekeeper', description: '"Why should I pick you over 5 others?"' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Difficulty badge with color coding
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
    <span className={clsx('inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold', colors[level])}>
      {labels[level]}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Call type button group
// ─────────────────────────────────────────────────────────────────────────────

function CallTypeSelector({
  selected,
  onSelect,
}: {
  selected: CallType
  onSelect: (type: CallType) => void
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <Phone className="w-5 h-5 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Call Type</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {CALL_TYPES.map(ct => (
          <button
            key={ct.id}
            onClick={() => onSelect(ct.id)}
            className={clsx(
              'p-3 rounded-lg border-2 transition-all text-sm font-medium',
              selected === ct.id
                ? 'bg-blue-500/20 border-blue-500 text-blue-300'
                : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-750'
            )}
          >
            <span className="mr-1">{ct.emoji}</span>
            {ct.label}
          </button>
        ))}
      </div>

      {selected === 'custom' && (
        <div className="text-xs text-zinc-400 italic pt-2">
          💡 Click "CUSTOM SCENARIO" to describe the character and situation
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction mode selector (horizontal toggle)
// ─────────────────────────────────────────────────────────────────────────────

function InteractionModeSelector({
  selected,
  onSelect,
}: {
  selected: InteractionMode
  onSelect: (mode: InteractionMode) => void
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <Volume2 className="w-5 h-5 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">Interaction Mode</h3>
      </div>

      <div className="space-y-2">
        {INTERACTION_MODES.map(mode => (
          <label
            key={mode.id}
            className={clsx(
              'flex items-start p-3 border-2 rounded-lg cursor-pointer transition-all',
              selected === mode.id
                ? 'bg-purple-500/20 border-purple-500'
                : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'
            )}
          >
            <input
              type="radio"
              name="interaction-mode"
              value={mode.id}
              checked={selected === mode.id}
              onChange={() => onSelect(mode.id)}
              className="mt-0.5 mr-3"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-white">{mode.label}</div>
              <div className="text-xs text-zinc-400 mt-0.5">{mode.description}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Difficulty level selector
// ─────────────────────────────────────────────────────────────────────────────

function DifficultySelector({
  selected,
  onSelect,
}: {
  selected: DifficultyLevel
  onSelect: (level: DifficultyLevel) => void
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-5 h-5 text-yellow-400" />
        <h3 className="text-sm font-semibold text-white">Difficulty Level</h3>
      </div>

      <div className="space-y-2">
        {DIFFICULTY_LEVELS.map(d => (
          <button
            key={d.level}
            onClick={() => onSelect(d.level)}
            className={clsx(
              'w-full p-3 text-left rounded-lg border-2 transition-all',
              selected === d.level
                ? 'bg-yellow-500/20 border-yellow-500'
                : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'
            )}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold text-white">{d.label}</div>
                <div className="text-xs text-zinc-400 mt-0.5">{d.description}</div>
              </div>
              {selected === d.level && <CheckCircle2 size={18} className="text-yellow-400 mt-0.5 shrink-0" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SPARK Suggestions card
// ─────────────────────────────────────────────────────────────────────────────

function SPARKSuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: SPARKSuggestion | null
  onAccept: (difficulty: DifficultyLevel, callType: CallType) => void
  onDismiss: () => void
}) {
  if (!suggestion) return null

  return (
    <div className="bg-gradient-to-r from-orange-900/30 to-yellow-900/30 border border-orange-500/40 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Lightbulb className="w-5 h-5 text-orange-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-orange-300 mb-1">SPARK Suggests Practice</div>
          <div className="text-xs text-zinc-400 space-y-1">
            <p>
              Your {suggestion.strength} score is <strong>{suggestion.score}/10</strong>.
            </p>
            <p>{suggestion.reasoning}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-orange-500/20">
        <div className="text-xs text-zinc-300">
          Try: <strong>{suggestion.suggestedCallType.charAt(0).toUpperCase() + suggestion.suggestedCallType.slice(1)}</strong> at{' '}
          <DifficultyBadge level={suggestion.suggestedDifficulty} />
        </div>
        <div className="flex gap-2">
          <button
            onClick={onDismiss}
            className="text-xs px-2 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors"
          >
            Later
          </button>
          <button
            onClick={() => onAccept(suggestion.suggestedDifficulty, suggestion.suggestedCallType)}
            className="text-xs px-2 py-1 rounded bg-orange-500 text-white hover:bg-orange-600 transition-colors font-medium"
          >
            Try it
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main PracticeTab Component
// ─────────────────────────────────────────────────────────────────────────────

export function PracticeTab() {
  // Session state
  const [activePracticeSession, setActivePracticeSession] = useState<PracticeSession | null>(null)
  const [callType, setCallType] = useState<CallType>('gc')
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('voice-transcript')
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(3)

  // Modal & suggestions
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [sparkSuggestion, setSparkSuggestion] = useState<SPARKSuggestion | null>(null)

  // Character names for different call types
  const characterNames: Record<CallType, string> = {
    vendor: 'Vendor Rep',
    sub: 'Subcontractor',
    gc: 'General Contractor',
    homeowner: 'Homeowner',
    solar: 'Solar Customer',
    custom: 'Custom Character',
  }

  // Mock SPARK suggestion (in production, fetch from Coach tab analysis)
  useEffect(() => {
    // Simulate SPARK suggestion based on weakness areas
    const mockSuggestion: SPARKSuggestion = {
      strength: 'closing',
      suggestedDifficulty: 3,
      suggestedCallType: 'gc',
      reasoning: 'Your closing score is 5/10. Practice the negotiation angles on tougher GC calls.',
      score: 5,
      scoreMax: 10,
    }
    setSparkSuggestion(mockSuggestion)
  }, [])

  // Handle accept SPARK suggestion
  const handleAcceptSuggestion = (suggDifficulty: DifficultyLevel, suggCallType: CallType) => {
    setDifficulty(suggDifficulty)
    setCallType(suggCallType)
    setSparkSuggestion(null)
  }

  // Handle custom scenario submission
  const handleCustomScenario = (scenario: string, characterName: string, characterDesc: string) => {
    setShowCustomModal(false)
    // Scene will be passed to PracticeConversation when session starts
  }

  // Start practice round
  const handleBeginPractice = () => {
    const session: PracticeSession = {
      id: `practice-${Date.now()}`,
      callType,
      interactionMode,
      difficulty,
      characterName: characterNames[callType],
      characterDescription: `Simulated ${callType} scenario at difficulty level ${difficulty}`,
      startedAt: new Date(),
    }
    setActivePracticeSession(session)
  }

  // End practice round
  const handleEndRound = () => {
    setActivePracticeSession(null)
  }

  // If in active practice session, show conversation view
  if (activePracticeSession) {
    return (
      <PracticeConversation
        session={activePracticeSession}
        onEndRound={handleEndRound}
      />
    )
  }

  // Main setup view
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Mic className="w-6 h-6 text-blue-400" />
        <h2 className="text-2xl font-bold text-white">Practice</h2>
        <p className="text-sm text-zinc-400 ml-auto">Simulate real calls • Get instant feedback</p>
      </div>

      {/* SPARK Suggestion */}
      {sparkSuggestion && (
        <SPARKSuggestionCard
          suggestion={sparkSuggestion}
          onAccept={handleAcceptSuggestion}
          onDismiss={() => setSparkSuggestion(null)}
        />
      )}

      {/* Main config grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: Call Type & Interaction */}
        <div className="space-y-6">
          <CallTypeSelector selected={callType} onSelect={setCallType} />
          <InteractionModeSelector selected={interactionMode} onSelect={setInteractionMode} />
        </div>

        {/* Right column: Difficulty & Custom Scenario */}
        <div className="space-y-6">
          <DifficultySelector selected={difficulty} onSelect={setDifficulty} />

          {/* Custom Scenario Button (only show when custom call type selected) */}
          {callType === 'custom' && (
            <button
              onClick={() => setShowCustomModal(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <User size={18} />
              Edit Custom Scenario
            </button>
          )}

          {/* Hunter Lead Context (placeholder) */}
          {callType !== 'custom' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
              <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-3">Advanced Options</div>
              <button className="w-full text-left p-2 text-xs text-zinc-400 hover:text-blue-400 rounded hover:bg-zinc-800 transition-colors flex items-center gap-2">
                <Lock size={14} />
                Load HUNTER Lead Context
              </button>
            </div>
          )}
        </div>
      </div>

      {/* BEGIN PRACTICE button — large & prominent */}
      <div className="flex gap-3 pt-6 border-t border-zinc-800">
        <button
          onClick={handleBeginPractice}
          className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center gap-3 transition-all shadow-lg hover:shadow-green-500/25 text-lg"
        >
          <Play size={24} />
          BEGIN PRACTICE
        </button>
      </div>

      {/* Custom Scenario Modal */}
      {showCustomModal && (
        <CustomScenarioModal
          onSubmit={handleCustomScenario}
          onClose={() => setShowCustomModal(false)}
        />
      )}
    </div>
  )
}

function Phone({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  )
}
