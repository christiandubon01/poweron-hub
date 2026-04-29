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
import VoicePracticeView from './VoicePracticeView'
import { CustomScenarioModal } from './CustomScenarioModal'
import { ARCHETYPES, type Archetype, type ArchetypeId } from '@/services/sparkTraining/practiceArchetypes'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type CallType = 'vendor' | 'sub' | 'gc' | 'homeowner' | 'solar' | 'custom'
export type InteractionMode = 'voice-to-voice' | 'voice-transcript' | 'text-only'
/** Continuous difficulty scale 0–10 (HUNTER-PRACTICE-ARCHETYPES-DIFFICULTY-APR28-2026-1). */
export type DifficultyLevel = number

export interface PracticeSession {
  id: string
  callType: CallType
  interactionMode: InteractionMode
  difficulty: DifficultyLevel
  archetypeId?: ArchetypeId | null
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
// Difficulty bucketing — 0–10 continuous slider, bucketed for label/color
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bucket a 0–10 value into one of four named bands for UI labels/colors and
 * analytics aggregation. The continuous numeric value still drives the actual
 * roleplay prompt (see SparkRolePlayEngine.difficultyHint).
 */
export function bucketDifficulty(level: DifficultyLevel): {
  bucket: 'easy' | 'medium' | 'hard' | 'extreme'
  label: string
  description: string
  color: string
} {
  const d = Math.max(0, Math.min(10, Math.round(level)))
  if (d <= 3) {
    return {
      bucket: 'easy',
      label: 'Easy',
      description: 'Builds confidence — minimal resistance',
      color: 'bg-green-500/20 text-green-300 border-green-500/40',
    }
  }
  if (d <= 6) {
    return {
      bucket: 'medium',
      label: 'Median',
      description: 'Realistic prospect with real objections',
      color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
    }
  }
  if (d <= 8) {
    return {
      bucket: 'hard',
      label: 'Hard',
      description: 'Stacked objections, tests competence',
      color: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    }
  }
  return {
    bucket: 'extreme',
    label: d >= 10 ? 'Unwinnable' : 'Extreme',
    description: d >= 10 ? 'Tests if you exit gracefully' : 'Actively hostile',
    color: 'bg-red-500/20 text-red-300 border-red-500/40',
  }
}

function DifficultyBadge({ level }: { level: DifficultyLevel }) {
  const b = bucketDifficulty(level)
  const num = Math.max(0, Math.min(10, Math.round(level)))
  return (
    <span
      className={clsx(
        'inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold',
        b.color
      )}
      title={b.description}
    >
      {b.label} · {num}/10
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
  const value = Math.max(0, Math.min(10, Math.round(selected)))
  const bucketInfo = bucketDifficulty(value)

  const fillColor =
    bucketInfo.bucket === 'easy' ? 'rgb(34 197 94)' :
    bucketInfo.bucket === 'medium' ? 'rgb(234 179 8)' :
    bucketInfo.bucket === 'hard' ? 'rgb(249 115 22)' :
    'rgb(239 68 68)'

  const fillPercent = (value / 10) * 100

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-yellow-400" />
        <h3 className="text-sm font-semibold text-white">Difficulty Level</h3>
      </div>

      <div className="flex items-baseline justify-between">
        <div className="text-3xl font-bold text-white">{value}<span className="text-base text-zinc-500">/10</span></div>
        <DifficultyBadge level={value} />
      </div>

      <div className="text-xs text-zinc-400">
        {bucketInfo.description}
      </div>

      <div className="pt-2">
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={value}
          onChange={(e) => onSelect(parseInt(e.target.value, 10))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${fillColor} 0%, ${fillColor} ${fillPercent}%, rgb(63 63 70) ${fillPercent}%, rgb(63 63 70) 100%)`,
          }}
        />
        <div className="flex justify-between text-[10px] text-zinc-500 mt-1.5 px-0.5">
          <span>0</span>
          <span>3</span>
          <span>6</span>
          <span>8</span>
          <span>10</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1 text-[10px] text-center pt-1">
        <div className={clsx('py-1 rounded', bucketInfo.bucket === 'easy' ? 'bg-green-500/20 text-green-300' : 'text-zinc-600')}>Easy</div>
        <div className={clsx('py-1 rounded', bucketInfo.bucket === 'medium' ? 'bg-yellow-500/20 text-yellow-300' : 'text-zinc-600')}>Median</div>
        <div className={clsx('py-1 rounded', bucketInfo.bucket === 'hard' ? 'bg-orange-500/20 text-orange-300' : 'text-zinc-600')}>Hard</div>
        <div className={clsx('py-1 rounded', bucketInfo.bucket === 'extreme' ? 'bg-red-500/20 text-red-300' : 'text-zinc-600')}>Extreme</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Archetype selector — Path B third axis (HUNTER-PRACTICE-ARCHETYPES-DIFFICULTY-APR28-2026-1)
// ─────────────────────────────────────────────────────────────────────────────

function ArchetypeSelector({
  selected,
  onSelect,
}: {
  selected: ArchetypeId | null
  onSelect: (id: ArchetypeId | null) => void
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <User className="w-5 h-5 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">Personality Archetype</h3>
        <span className="text-xs text-zinc-500 ml-auto">Optional</span>
      </div>

      <div className="text-xs text-zinc-400 mb-2">
        How they behave during the call. Pairs with Call Type and Difficulty.
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onSelect(null)}
          className={clsx(
            'col-span-2 p-2 rounded-lg border text-xs font-medium transition-all',
            selected === null
              ? 'bg-purple-500/20 border-purple-500 text-purple-300'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
          )}
        >
          None — use call type's default personality
        </button>
        {ARCHETYPES.map((a) => (
          <button
            key={a.id}
            onClick={() => onSelect(a.id)}
            title={a.description}
            className={clsx(
              'p-2.5 rounded-lg border text-left text-xs transition-all',
              selected === a.id
                ? 'bg-purple-500/20 border-purple-500 text-purple-200'
                : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600'
            )}
          >
            <div className="font-semibold leading-snug">{a.label}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2 leading-tight">
              {a.description}
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
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(5)
  const [archetypeId, setArchetypeId] = useState<ArchetypeId | null>(null)

  // Modal & suggestions
  const [showCustomModal, setShowCustomModal] = useState(false)
  // HUNTER-PRACTICE-PLUMBING-APR28-2026-1
  // When the user clicks Practice on a HunterLeadCard, the SalesIntel store
  // stashes the lead id in sessionStorage. On Practice tab mount, detect
  // that and auto-open the custom scenario modal with the lead preselected.
  useEffect(() => {
    try {
      const presetId = typeof window !== 'undefined'
        ? sessionStorage.getItem('si_practiceLead')
        : null
      if (presetId) {
        setShowCustomModal(true)
      }
    } catch (err) {
      console.warn('[PracticeTab] sessionStorage check failed:', err)
    }
  }, [])
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
    const archetypeLabel = archetypeId
      ? ARCHETYPES.find((a) => a.id === archetypeId)?.label ?? null
      : null
    const session: PracticeSession = {
      id: `practice-${Date.now()}`,
      callType,
      interactionMode,
      difficulty,
      archetypeId: archetypeId ?? undefined,
      characterName: characterNames[callType],
      characterDescription: archetypeLabel
        ? `${archetypeLabel} ${callType} at difficulty ${difficulty}/10`
        : `${callType} at difficulty ${difficulty}/10`,
      startedAt: new Date(),
    }
    setActivePracticeSession(session)
  }

  // End practice round
  const handleEndRound = () => {
    setActivePracticeSession(null)
  }

  // If in active practice session, show voice practice view (real AI path).
  // HUNTER-PRACTICE-ARCHETYPES-DIFFICULTY-APR28-2026-1 — wires session.archetypeId
  // and session.difficulty (0–10) through to VoicePracticeView so character prompts
  // compose Call Type × Archetype × Difficulty correctly.
  if (activePracticeSession) {
    return (
      <VoicePracticeView
        mode={activePracticeSession.interactionMode === 'voice-to-voice' ? 'voice-only' : activePracticeSession.interactionMode}
        difficulty={activePracticeSession.difficulty}
        archetypeId={activePracticeSession.archetypeId ?? null}
        onClose={handleEndRound}
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
          <ArchetypeSelector selected={archetypeId} onSelect={setArchetypeId} />

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

          {/* HUNTER Lead Context — opens CustomScenarioModal preloaded with real leads */}
          {callType !== 'custom' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
              <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-3">Advanced Options</div>
              <button
                onClick={() => setShowCustomModal(true)}
                className="w-full text-left p-2 text-xs text-zinc-400 hover:text-blue-400 rounded hover:bg-zinc-800 transition-colors flex items-center gap-2"
              >
                <User size={14} />
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
