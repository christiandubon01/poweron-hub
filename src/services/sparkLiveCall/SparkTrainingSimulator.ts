// @ts-nocheck
/**
 * SparkTrainingSimulator.ts
 * SP13 — SPARK Training Simulator
 *
 * Role-play engine where SPARK plays GCs, clients, and property managers so
 * Christian can practice sales conversations against AI-generated scenarios
 * based on real pipeline data.  Graded with a per-round scorecard.
 *
 * ACTIVATION: "SPARK, let's practice" | "SPARK, pretend you're a …" | Hub UI
 * VOICE: ElevenLabs Adam Stone (NFG5qt843uXKj4pFvR7C) — distinct from NEXUS
 * STT:   OpenAI Whisper
 */

import { callClaude, extractText } from '@/services/claudeProxy'
import { synthesizeWithElevenLabs } from '@/api/voice/elevenLabs'
import { transcribeWithWhisper } from '@/api/voice/whisper'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** ElevenLabs voice ID for SPARK's training simulator — Adam Stone */
export const SPARK_TRAINING_VOICE_ID = 'NFG5qt843uXKj4pFvR7C'

const PROGRESS_STORAGE_KEY = 'spark_training_progress_v1'
const SESSION_STORAGE_KEY  = 'spark_training_sessions_v1'
const MAX_RECENT_SCORECARDS = 20

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** 1 = friendliest / most confidence-building → 5 = hardball adversarial */
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5

/** Six built-in scenario archetypes + open-ended CUSTOM */
export type ScenarioType =
  | 'COLD_CALL'
  | 'FOLLOW_UP'
  | 'ONSITE'
  | 'NEGOTIATE'
  | 'SCOPE_CREEP'
  | 'CUSTOM'

export interface SimCharacter {
  name: string
  role: string
  /** Short personality description injected into the Claude system prompt */
  traits: string
  /** Additional narrative context for the character */
  backstory: string
  difficultyLevel: DifficultyLevel
}

export interface SimScenario {
  id: string
  type: ScenarioType
  difficulty: DifficultyLevel
  character: SimCharacter
  /** Opening situation / scene-setter shown to the user before the round */
  context: string
  /** If sourced from the pipeline, the lead's real name */
  pipelineLeadName?: string
}

export interface ScoreCategoryResult {
  score: number   // 0–10
  note: string    // one-line coaching note
}

export interface RoundScorecard {
  opening:            ScoreCategoryResult
  objectionHandling:  ScoreCategoryResult
  technicalDepth:     ScoreCategoryResult
  closing:            ScoreCategoryResult
  pace:               ScoreCategoryResult
  emotionalControl:   ScoreCategoryResult
  overall:            number   // 0–10
  coachingTip:        string   // "Let's run it again. This time …"
  scenarioType:       ScenarioType
  difficultyLevel:    DifficultyLevel
  completedAt:        string
}

export interface TranscriptEntry {
  role:      'user' | 'character'
  text:      string
  timestamp: string
}

export interface SimSession {
  id:          string
  scenario:    SimScenario
  transcript:  TranscriptEntry[]
  startedAt:   string
  endedAt?:    string
  scorecard?:  RoundScorecard
  /** Claude multi-turn conversation history */
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
}

/** Persistent progress record stored in localStorage */
export interface ProgressData {
  roundsCompleted:    number
  /** Count of completed rounds per difficulty level */
  difficultyProgress: Record<DifficultyLevel, number>
  /** Count of completed rounds per scenario type */
  scenarioMastery:    Record<ScenarioType, number>
  /** Identified weak areas, e.g. "You still discount at Level 3 pushback" */
  weakSpots:          string[]
  /** Achievement milestones, e.g. "10 Level 4 rounds without discounting" */
  milestones:         string[]
  recentScorecards:   RoundScorecard[]
  lastUpdated:        string
}

/** Options for auto-generating a scenario */
export interface GenerateScenarioOptions {
  type:       ScenarioType
  difficulty: DifficultyLevel
  /** Optional pipeline lead name to personalize the scenario */
  leadName?:  string
  /** Free-text description when type === 'CUSTOM' */
  customDesc?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Difficulty Level Blueprints
// ─────────────────────────────────────────────────────────────────────────────

const DIFFICULTY_BLUEPRINTS: Record<DifficultyLevel, { label: string; description: string; traits: string }> = {
  1: {
    label:       'Friendly Homeowner',
    description: 'Easy close — builds confidence',
    traits:      'Warm, trusting, eager to hire. First-time homeowner, not technical. Wants to feel comfortable and safe. Budget flexible. Will say yes if you seem trustworthy.',
  },
  2: {
    label:       'Cautious GC',
    description: 'Needs convincing — patient back-and-forth',
    traits:      'Experienced GC, has been burned by subs before. Needs proof of reliability. Asks about timelines and licensing. Patient but skeptical. Will commit if convinced.',
  },
  3: {
    label:       'Hardball Negotiator',
    description: 'Price-shops, compares to competitors',
    traits:      'Business-minded property manager. Always price-shopping. Gets multiple bids. If price is mentioned first, immediately counters with "I have someone cheaper." Will negotiate firmly.',
  },
  4: {
    label:       'Appearance Skeptic',
    description: 'Judges age/appearance, tests if you budge',
    traits:      'Old-school GC or commercial client. Suspicious of young contractors. Will question experience level, age, whether you have the capacity. Tests if you shrink under pressure.',
  },
  5: {
    label:       'Elite Gatekeeper',
    description: '5 subs calling — "why should I pick you?"',
    traits:      'High-volume commercial GC with 5+ electrical subs competing. Time is money. No patience for vague answers. Wants NEC fluency, proof of volume, and a reason to care now.',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario Type Context Templates
// ─────────────────────────────────────────────────────────────────────────────

const SCENARIO_CONTEXT_TEMPLATES: Record<ScenarioType, (char: SimCharacter, leadName?: string) => string> = {
  COLD_CALL: (char, leadName) =>
    `You are calling ${leadName ?? char.name} out of the blue. They don't know you. You have 60 seconds to earn a real conversation. ${char.name} answers the phone distracted.`,

  FOLLOW_UP: (char, leadName) =>
    `You spoke with ${leadName ?? char.name} two weeks ago. They said "I'll think about it." Pipeline shows the job is ${Math.floor(Math.random() * 30) + 15}k. You need to close or get a clear answer today.`,

  ONSITE: (char, leadName) =>
    `${leadName ?? char.name} is a GC walking the job site. You've been on-site for 20 minutes. They walk up to check your work. You have 90 seconds before they walk away. Make it count.`,

  NEGOTIATE: (char, leadName) =>
    `${leadName ?? char.name} has reviewed your bid. They open with: "Your number is $3,200 higher than the other guy." Defend your rate without flinching.`,

  SCOPE_CREEP: (char, leadName) =>
    `You're mid-job for ${leadName ?? char.name}. They pull you aside and say: "While you're here, can you also do the panel in the garage and add 4 circuits in the shop? No extra charge, right?" Handle it professionally.`,

  CUSTOM: (char) =>
    `Custom scenario with ${char.name}. Play it out based on the scenario description provided.`,
}

// ─────────────────────────────────────────────────────────────────────────────
// Unique ID helper
// ─────────────────────────────────────────────────────────────────────────────

function uid(): string {
  return `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a SimCharacter for the given difficulty level.
 * If a leadName is provided the character uses that name (pipeline-sourced).
 */
export function buildCharacter(difficulty: DifficultyLevel, leadName?: string): SimCharacter {
  const bp = DIFFICULTY_BLUEPRINTS[difficulty]
  const names = ['Marcus', 'Tom', 'Sandra', 'Ray', 'Denise', 'Eddie', 'Karen', 'Phil', 'Angela', 'Jorge']
  const roles = {
    1: 'Homeowner',
    2: 'General Contractor',
    3: 'Property Manager',
    4: 'Senior GC / Commercial Client',
    5: 'Commercial GC — High Volume',
  }

  return {
    name:           leadName ?? names[Math.floor(Math.random() * names.length)],
    role:           roles[difficulty] ?? 'Client',
    traits:         bp.traits,
    backstory:      bp.description,
    difficultyLevel: difficulty,
  }
}

/**
 * Generate a full SimScenario.
 * If `options.leadName` is provided the scenario references a real pipeline contact.
 */
export function generateScenario(options: GenerateScenarioOptions): SimScenario {
  const character = buildCharacter(options.difficulty, options.leadName)
  const contextFn = SCENARIO_CONTEXT_TEMPLATES[options.type]
  const context   = contextFn(character, options.leadName)

  return {
    id:               uid(),
    type:             options.type,
    difficulty:       options.difficulty,
    character,
    context,
    pipelineLeadName: options.leadName,
  }
}

/**
 * Auto-suggest the highest-value scenario based on pipeline data.
 * Returns a formatted SPARK prompt string for the Hub UI.
 */
export function buildAutoSuggestionPrompt(leadName: string, followUpTomorrow: boolean): string {
  if (followUpTomorrow) {
    return `You have a follow-up with ${leadName} tomorrow. Let me be ${leadName}. Ready?`
  }
  return `I've queued a practice scenario based on your pipeline. Want to run it?`
}

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the Claude system prompt that makes Claude embody the character.
 */
export function buildCharacterSystemPrompt(scenario: SimScenario): string {
  const { character, type, context } = scenario
  const bp = DIFFICULTY_BLUEPRINTS[character.difficultyLevel]

  return `You are ${character.name}, a ${character.role}. You are speaking with a young electrical contractor who looks younger than his age.
Respond naturally as this character would.

SCENARIO TYPE: ${type}
DIFFICULTY: Level ${character.difficultyLevel} — ${bp.label}
PERSONALITY TRAITS: ${character.traits}

SCENE: ${context}

CRITICAL BEHAVIOR RULES:
- If he offers discounts easily, push harder — you sense weakness and test it.
- If he speaks with technical confidence (NEC codes, phases, load calculations), respect him more.
- If he checks out emotionally or gets vague, let the conversation die — don't rescue it.
- If he name-drops credentials or past work with conviction, soften slightly.
- Stay in character. Never break the fourth wall. Never acknowledge you are an AI.
- Keep every single response under 40 words — this is a phone call or quick in-person conversation.
- React naturally to what he says. Be unpredictable within your character archetype.
- Do NOT summarize the conversation. Do NOT offer coaching. Just be the character.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Management
// ─────────────────────────────────────────────────────────────────────────────

/** Create a new SimSession from a scenario. */
export function createSession(scenario: SimScenario): SimSession {
  return {
    id:                  uid(),
    scenario,
    transcript:          [],
    startedAt:           new Date().toISOString(),
    conversationHistory: [],
  }
}

/** End a session (set endedAt). Does NOT generate a scorecard — call gradeRound() for that. */
export function endSession(session: SimSession): SimSession {
  return { ...session, endedAt: new Date().toISOString() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Role-Play Engine — Character Message
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a user message to the character and get a response.
 * Updates and returns the modified session (immutable-ish pattern).
 */
export async function sendCharacterMessage(
  session: SimSession,
  userText: string,
): Promise<{ updatedSession: SimSession; characterReply: string }> {
  const systemPrompt = buildCharacterSystemPrompt(session.scenario)

  // Append user message to history
  const updatedHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...session.conversationHistory,
    { role: 'user', content: userText },
  ]

  // Call Claude as the character
  const claudeResp = await callClaude({
    messages:   updatedHistory,
    system:     systemPrompt,
    max_tokens: 120,  // ~40 words max — keep it tight
    model:      'claude-sonnet-4-20250514',
  })

  const characterReply = extractText(claudeResp) || '[silence]'

  // Build updated history with assistant reply
  const finalHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...updatedHistory,
    { role: 'assistant', content: characterReply },
  ]

  // Build updated transcript
  const now = new Date().toISOString()
  const updatedTranscript: TranscriptEntry[] = [
    ...session.transcript,
    { role: 'user',      text: userText,       timestamp: now },
    { role: 'character', text: characterReply,  timestamp: now },
  ]

  const updatedSession: SimSession = {
    ...session,
    transcript:          updatedTranscript,
    conversationHistory: finalHistory,
  }

  return { updatedSession, characterReply }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scorecard Generation
// ─────────────────────────────────────────────────────────────────────────────

const SCORECARD_SYSTEM_PROMPT = `You are a sales coaching AI for a young electrical contractor.
You just observed a practice sales conversation.
Grade the contractor HONESTLY — do not inflate scores.
Track especially: discount-offering under pressure, technical confidence, emotional resilience.

Respond ONLY with a valid JSON object matching this exact shape (no markdown, no extra text):
{
  "opening":            { "score": 0-10, "note": "one-line note" },
  "objectionHandling":  { "score": 0-10, "note": "one-line note" },
  "technicalDepth":     { "score": 0-10, "note": "one-line note" },
  "closing":            { "score": 0-10, "note": "one-line note" },
  "pace":               { "score": 0-10, "note": "one-line note" },
  "emotionalControl":   { "score": 0-10, "note": "one-line note" },
  "overall":            0-10,
  "coachingTip":        "Let's run it again. This time [specific actionable tip]."
}`

/**
 * Grade a completed round and produce a RoundScorecard.
 * Calls Claude with the full transcript as grading input.
 */
export async function gradeRound(session: SimSession): Promise<RoundScorecard> {
  const transcriptText = session.transcript
    .map(e => `${e.role === 'user' ? 'CONTRACTOR' : 'CHARACTER'}: ${e.text}`)
    .join('\n')

  const gradingPrompt = `
SCENARIO TYPE: ${session.scenario.type}
DIFFICULTY: Level ${session.scenario.difficulty} — ${DIFFICULTY_BLUEPRINTS[session.scenario.difficulty].label}
CHARACTER TRAITS: ${session.scenario.character.traits}

TRANSCRIPT:
${transcriptText}

Grade the contractor's performance. Be specific and honest. Do not inflate scores.`

  let rawJson = ''
  try {
    const resp = await callClaude({
      messages:   [{ role: 'user', content: gradingPrompt }],
      system:     SCORECARD_SYSTEM_PROMPT,
      max_tokens: 600,
      model:      'claude-sonnet-4-20250514',
    })
    rawJson = extractText(resp)

    // Strip any markdown code fences if present
    rawJson = rawJson.replace(/```(?:json)?/g, '').replace(/```/g, '').trim()

    const parsed = JSON.parse(rawJson)

    return {
      opening:           parsed.opening           ?? { score: 5, note: 'No data' },
      objectionHandling: parsed.objectionHandling  ?? { score: 5, note: 'No data' },
      technicalDepth:    parsed.technicalDepth     ?? { score: 5, note: 'No data' },
      closing:           parsed.closing            ?? { score: 5, note: 'No data' },
      pace:              parsed.pace               ?? { score: 5, note: 'No data' },
      emotionalControl:  parsed.emotionalControl   ?? { score: 5, note: 'No data' },
      overall:           typeof parsed.overall === 'number' ? parsed.overall : 5,
      coachingTip:       parsed.coachingTip ?? 'Let\'s run it again with more energy.',
      scenarioType:      session.scenario.type,
      difficultyLevel:   session.scenario.difficulty,
      completedAt:       new Date().toISOString(),
    }
  } catch (err) {
    console.error('[SparkTrainingSimulator] gradeRound parse error:', err, rawJson)
    // Fallback scorecard so the UI never crashes
    return {
      opening:           { score: 5, note: 'Grading unavailable' },
      objectionHandling: { score: 5, note: 'Grading unavailable' },
      technicalDepth:    { score: 5, note: 'Grading unavailable' },
      closing:           { score: 5, note: 'Grading unavailable' },
      pace:              { score: 5, note: 'Grading unavailable' },
      emotionalControl:  { score: 5, note: 'Grading unavailable' },
      overall:           5,
      coachingTip:       'Grading service unavailable. Run again to retry.',
      scenarioType:      session.scenario.type,
      difficultyLevel:   session.scenario.difficulty,
      completedAt:       new Date().toISOString(),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice — TTS (ElevenLabs Adam Stone)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synthesize character speech using ElevenLabs Adam Stone voice.
 * Returns an audio object URL that can be played directly in the browser.
 */
export async function speakAsCharacter(text: string): Promise<string | null> {
  try {
    const ttsResp = await synthesizeWithElevenLabs({
      text,
      voice_id: SPARK_TRAINING_VOICE_ID,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability:        0.55,
        similarity_boost: 0.75,
        style:            0.2,
        use_speaker_boost: true,
      },
    })
    return ttsResp.audioUrl
  } catch (err) {
    console.error('[SparkTrainingSimulator] speakAsCharacter error:', err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice — STT (Whisper)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transcribe user audio via Whisper.
 * Returns the transcribed text string (or empty string on failure).
 */
export async function transcribeUserInput(audioBlob: Blob): Promise<string> {
  try {
    const result = await transcribeWithWhisper({
      audio:    audioBlob,
      language: 'en',
      prompt:   'Electrical contractor sales call practice.',
    })
    return result.text ?? ''
  } catch (err) {
    console.error('[SparkTrainingSimulator] transcribeUserInput error:', err)
    return ''
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Activation Detection
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVATION_PHRASES = [
  "let's practice",
  "lets practice",
  "let me practice",
  "pretend you're",
  "pretend you are",
  "role play",
  "roleplay",
  "play a",
  "be a gc",
  "be the gc",
  "be a client",
]

/**
 * Detect whether a spoken/typed message activates the training simulator.
 */
export function detectActivation(text: string): boolean {
  const lower = text.toLowerCase()
  return ACTIVATION_PHRASES.some(phrase => lower.includes(phrase))
}

/**
 * Parse a custom scenario request from natural language.
 * e.g. "SPARK, pretend you're a skeptical GC at Level 3"
 * Returns best-effort GenerateScenarioOptions.
 */
export function parseCustomRequest(text: string): GenerateScenarioOptions {
  const lower = text.toLowerCase()

  // Detect difficulty
  const diffMatch = lower.match(/level\s*([1-5])/)
  const difficulty: DifficultyLevel = diffMatch
    ? (parseInt(diffMatch[1], 10) as DifficultyLevel)
    : 2

  // Detect scenario type
  let type: ScenarioType = 'COLD_CALL'
  if (lower.includes('follow') && lower.includes('up'))     type = 'FOLLOW_UP'
  else if (lower.includes('on site') || lower.includes('onsite') || lower.includes('job site')) type = 'ONSITE'
  else if (lower.includes('negot') || lower.includes('price') || lower.includes('cheaper'))     type = 'NEGOTIATE'
  else if (lower.includes('scope') || lower.includes('extra work'))                              type = 'SCOPE_CREEP'
  else if (lower.includes('cold') || lower.includes("don't know"))                              type = 'COLD_CALL'
  else type = 'CUSTOM'

  return { type, difficulty, customDesc: text }
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress Tracking (localStorage)
// ─────────────────────────────────────────────────────────────────────────────

function defaultProgress(): ProgressData {
  return {
    roundsCompleted:    0,
    difficultyProgress: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    scenarioMastery:    {
      COLD_CALL:   0,
      FOLLOW_UP:   0,
      ONSITE:      0,
      NEGOTIATE:   0,
      SCOPE_CREEP: 0,
      CUSTOM:      0,
    },
    weakSpots:        [],
    milestones:       [],
    recentScorecards: [],
    lastUpdated:      new Date().toISOString(),
  }
}

/** Load progress from localStorage. */
export function getProgress(): ProgressData {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY)
    if (!raw) return defaultProgress()
    return { ...defaultProgress(), ...JSON.parse(raw) }
  } catch {
    return defaultProgress()
  }
}

/** Persist progress to localStorage. */
export function saveProgress(data: ProgressData): void {
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(data))
  } catch (err) {
    console.warn('[SparkTrainingSimulator] saveProgress failed:', err)
  }
}

/** Reset all progress (with confirmation — caller must confirm before calling). */
export function resetProgress(): void {
  localStorage.removeItem(PROGRESS_STORAGE_KEY)
  localStorage.removeItem(SESSION_STORAGE_KEY)
}

/**
 * Update progress after a completed round.
 * Adds the scorecard, detects weak spots, checks milestones.
 */
export function updateProgressAfterRound(prev: ProgressData, scorecard: RoundScorecard): ProgressData {
  const next: ProgressData = {
    ...prev,
    roundsCompleted:    prev.roundsCompleted + 1,
    difficultyProgress: {
      ...prev.difficultyProgress,
      [scorecard.difficultyLevel]: (prev.difficultyProgress[scorecard.difficultyLevel] ?? 0) + 1,
    },
    scenarioMastery: {
      ...prev.scenarioMastery,
      [scorecard.scenarioType]: (prev.scenarioMastery[scorecard.scenarioType] ?? 0) + 1,
    },
    recentScorecards: [
      scorecard,
      ...prev.recentScorecards,
    ].slice(0, MAX_RECENT_SCORECARDS),
    lastUpdated: new Date().toISOString(),
  }

  // ── Weak spot detection ────────────────────────────────────────────────────
  const weakSpots = new Set<string>(prev.weakSpots)

  if (scorecard.objectionHandling.score <= 4) {
    weakSpots.add('You still struggle under objection pressure. Hold your rate.')
  } else {
    weakSpots.delete('You still struggle under objection pressure. Hold your rate.')
  }
  if (scorecard.closing.score <= 4) {
    weakSpots.add('Your closing is weak — ask for the job directly.')
  } else {
    weakSpots.delete('Your closing is weak — ask for the job directly.')
  }
  if (scorecard.emotionalControl.score <= 4) {
    weakSpots.add('Emotional leakage detected. Stay composed under pressure.')
  } else {
    weakSpots.delete('Emotional leakage detected. Stay composed under pressure.')
  }
  if (scorecard.technicalDepth.score >= 8) {
    weakSpots.delete('Your technical depth is not coming through in conversations.')
  } else if (scorecard.technicalDepth.score <= 3) {
    weakSpots.add('Your technical depth is not coming through in conversations.')
  }

  // Discount-offering heuristic: if negotiate at level 3+ and score < 5
  if (
    scorecard.scenarioType === 'NEGOTIATE' &&
    scorecard.difficultyLevel >= 3 &&
    scorecard.objectionHandling.score < 5
  ) {
    weakSpots.add('You still offer discounts at Level 3 pushback. Hold your number.')
  }

  next.weakSpots = Array.from(weakSpots)

  // ── Milestone detection ────────────────────────────────────────────────────
  const milestones = new Set<string>(prev.milestones)
  const level4Rounds = next.difficultyProgress[4] ?? 0
  const level5Rounds = next.difficultyProgress[5] ?? 0

  if (next.roundsCompleted === 1) {
    milestones.add('First round completed — simulator activated.')
  }
  if (next.roundsCompleted === 10) {
    milestones.add('10 rounds completed. You\'re putting in the reps.')
  }
  if (next.roundsCompleted === 50) {
    milestones.add('50 rounds. This is a habit now.')
  }
  if (level4Rounds >= 10 && !milestones.has('10 Level 4 rounds without discounting')) {
    // Check if recent Level 4 scorecards show no discount pattern
    const recent10Level4 = next.recentScorecards
      .filter(s => s.difficultyLevel === 4)
      .slice(0, 10)
    const avgObjHandling = recent10Level4.reduce((sum, s) => sum + s.objectionHandling.score, 0) / (recent10Level4.length || 1)
    if (avgObjHandling >= 6) {
      milestones.add('You\'ve completed 10 Level 4 rounds without discounting.')
    }
  }
  if (level5Rounds >= 5) {
    milestones.add('5 Level 5 rounds completed. Elite territory.')
  }

  // Check mastery per scenario type (5+ completions with overall >= 7 avg)
  const MASTERY_SCENARIOS: ScenarioType[] = ['COLD_CALL', 'FOLLOW_UP', 'ONSITE', 'NEGOTIATE', 'SCOPE_CREEP']
  for (const st of MASTERY_SCENARIOS) {
    if (next.scenarioMastery[st] >= 5) {
      const recent5 = next.recentScorecards
        .filter(s => s.scenarioType === st)
        .slice(0, 5)
      const avg = recent5.reduce((sum, s) => sum + s.overall, 0) / (recent5.length || 1)
      if (avg >= 7) {
        milestones.add(`${st.replace('_', ' ')} mastered — 5 rounds avg ${avg.toFixed(1)}/10.`)
      }
    }
  }

  next.milestones = Array.from(milestones)
  return next
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Persistence (localStorage — recent sessions ring buffer)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_STORED_SESSIONS = 10

export function loadRecentSessions(): SimSession[] {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function persistSession(session: SimSession): void {
  try {
    const sessions = loadRecentSessions()
    const updated = [session, ...sessions.filter(s => s.id !== session.id)].slice(0, MAX_STORED_SESSIONS)
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated))
  } catch (err) {
    console.warn('[SparkTrainingSimulator] persistSession failed:', err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: Full Round Runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grade a session, attach the scorecard, update progress, and persist everything.
 * Returns { updatedSession, scorecard, updatedProgress }.
 */
export async function finalizeRound(session: SimSession): Promise<{
  updatedSession: SimSession
  scorecard:      RoundScorecard
  updatedProgress: ProgressData
}> {
  const scorecard     = await gradeRound(session)
  const updatedSession: SimSession = { ...endSession(session), scorecard }
  const prevProgress  = getProgress()
  const updatedProgress = updateProgressAfterRound(prevProgress, scorecard)

  persistSession(updatedSession)
  saveProgress(updatedProgress)

  return { updatedSession, scorecard, updatedProgress }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports — named (all already named above)
// Re-export difficulty blueprints for UI labels
// ─────────────────────────────────────────────────────────────────────────────

export { DIFFICULTY_BLUEPRINTS }
