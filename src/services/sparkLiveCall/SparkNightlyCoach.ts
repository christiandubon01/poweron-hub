// @ts-nocheck
/**
 * SparkNightlyCoach.ts
 * SP12 — SPARK Nightly Coach
 *
 * End-of-day batch review system for all conversations captured today.
 * Scores communication skills across 6 dimensions, tracks filler word
 * frequency, measures delivery pace, and builds a 7-day improvement trend.
 *
 * Trigger: voice command "SPARK, let's review" or manual button in Hub.
 * Data source: ECHO/localStorage conversation transcripts.
 *
 * Public API:
 *   runNightlyReview()                — full batch analysis + persistence
 *   getWeeklyTrend()                  — last 7 daily SPARK score records
 *   getTodayReview()                  — cached review for today (if run)
 *   clearCoachCache()                 — wipe localStorage coach data
 *   computeFillerStats(transcript)    — standalone filler word counter
 *   computePaceWPM(transcript, secs)  — words-per-minute helper
 */

import { callClaude, extractText } from '@/services/claudeProxy'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ConversationTranscript {
  /** Unique conversation id */
  id: string
  /** ISO timestamp when the conversation started */
  startedAt: string
  /** Duration in seconds (optional — used for WPM calc) */
  durationSecs?: number
  /** Full plain-text transcript */
  text: string
  /** Optional label / customer name */
  label?: string
}

export interface FillerStats {
  total: number
  counts: Record<string, number>   // { um: 3, like: 2, … }
}

export interface ConversationScore {
  conversationId: string
  label: string
  /** 1-10 */
  clarity: number
  confidence: number
  technicalDepth: number
  closing: number
  emotionalControl: number
  pricingDiscipline: number
  /** Weighted SPARK score (closing + pricing at 2×) */
  sparkScore: number
  bestMoment: string
  worstMoment: string
  practicePhrase: string
  fillerStats: FillerStats
  /** wpm | 'unknown' */
  paceWPM: number | 'unknown'
  paceRating: 'too_fast' | 'too_slow' | 'good' | 'unknown'
  /** Assertive statements / total statements ratio (0–1) */
  powerLanguageRatio: number
  /** Hedging phrase count */
  hedgeCount: number
}

export interface DailyCoachReport {
  date: string           // YYYY-MM-DD
  conversationScores: ConversationScore[]
  overallSparkScore: number
  /** 0–1 ratio across all convos */
  avgPowerRatio: number
  totalFillerWords: number
  highlights: string[]   // up to 3 positive callouts
  flags: string[]        // up to 3 improvement flags
}

export interface DailySparkRecord {
  date: string
  sparkScore: number
  totalFillers: number
  avgPower: number
  closingScore: number
  pricingScore: number
}

export interface WeeklyTrend {
  records: DailySparkRecord[]
  /** Narrative sentences about the week */
  narrative: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  DAILY_REPORT:    'spark_nightly_coach_daily_report',
  WEEKLY_HISTORY:  'spark_nightly_coach_weekly',
  ECHO_TRANSCRIPTS: 'echo_conversation_transcripts', // ECHO writes here
} as const

const FILLER_WORDS = [
  'um', 'uh', 'like', 'you know', 'basically', 'honestly',
  'literally', 'actually', 'sort of', 'kind of', 'right', 'so',
]

const HEDGE_PHRASES = [
  'maybe', 'i think', 'sort of', 'kind of', 'hopefully',
  'i guess', 'perhaps', 'not sure', 'might be', 'could be',
  'probably', 'i feel like',
]

/** Good pace window in words-per-minute (conversational sales) */
const PACE_MIN_WPM = 120
const PACE_MAX_WPM = 160

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — local delivery analysis (no AI needed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count filler words in a transcript.
 */
export function computeFillerStats(transcript: string): FillerStats {
  const lower = transcript.toLowerCase()
  const counts: Record<string, number> = {}
  let total = 0

  for (const filler of FILLER_WORDS) {
    // Build regex: word boundary around single-word fillers; phrase match for multi-word
    const pattern = filler.includes(' ')
      ? new RegExp(filler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      : new RegExp(`\\b${filler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    const matches = lower.match(pattern)
    if (matches && matches.length > 0) {
      counts[filler] = matches.length
      total += matches.length
    }
  }

  return { total, counts }
}

/**
 * Compute words-per-minute from transcript text and duration.
 */
export function computePaceWPM(
  transcript: string,
  durationSecs: number,
): number {
  const wordCount = transcript.trim().split(/\s+/).length
  return Math.round((wordCount / durationSecs) * 60)
}

/**
 * Classify wpm into pace rating.
 */
function classifyPace(wpm: number): 'too_fast' | 'too_slow' | 'good' {
  if (wpm < PACE_MIN_WPM) return 'too_slow'
  if (wpm > PACE_MAX_WPM) return 'too_fast'
  return 'good'
}

/**
 * Estimate power language ratio.
 * Assertive = sentences that end with a direct statement/action (no hedge).
 */
function computePowerRatio(transcript: string): number {
  const sentences = transcript
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10)

  if (sentences.length === 0) return 0

  let hedgeCount = 0
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase()
    if (HEDGE_PHRASES.some(h => lower.includes(h))) hedgeCount++
  }

  const assertiveCount = sentences.length - hedgeCount
  return Math.max(0, Math.min(1, assertiveCount / sentences.length))
}

/**
 * Count hedge phrases in a transcript.
 */
function countHedges(transcript: string): number {
  const lower = transcript.toLowerCase()
  let total = 0
  for (const phrase of HEDGE_PHRASES) {
    const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const matches = lower.match(regex)
    if (matches) total += matches.length
  }
  return total
}

/**
 * Calculate weighted SPARK score (closing + pricing weighted 2×).
 */
function calcSparkScore(scores: {
  clarity: number
  confidence: number
  technicalDepth: number
  closing: number
  emotionalControl: number
  pricingDiscipline: number
}): number {
  const {
    clarity, confidence, technicalDepth,
    closing, emotionalControl, pricingDiscipline,
  } = scores

  const sum =
    clarity +
    confidence +
    technicalDepth +
    closing * 2 +
    emotionalControl +
    pricingDiscipline * 2

  const weights = 1 + 1 + 1 + 2 + 1 + 2  // = 8
  return Math.round((sum / weights) * 10) / 10
}

// ─────────────────────────────────────────────────────────────────────────────
// ECHO Transcript Loader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull today's conversation transcripts from localStorage (written by ECHO).
 * Falls back to an empty array if nothing is stored.
 */
export function loadTodayTranscripts(): ConversationTranscript[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ECHO_TRANSCRIPTS)
    if (!raw) return []

    const all: ConversationTranscript[] = JSON.parse(raw)
    const todayPrefix = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

    return all.filter(t => {
      const dateStr = t.startedAt?.slice(0, 10)
      return dateStr === todayPrefix
    })
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Batch Analysis
// ─────────────────────────────────────────────────────────────────────────────

const COACH_SYSTEM_PROMPT = `You are SPARK Coach — an elite sales communication analyst for Power On Solutions LLC, a California electrical contractor.

You review conversation transcripts and return structured JSON only (no markdown, no prose outside JSON).

For each conversation, score on a 1-10 scale:
1. CLARITY: Were instructions and proposals clear?
2. CONFIDENCE: Voice pace, assertiveness, no hedging language
3. TECHNICAL_DEPTH: Did he reference codes, experience, specifics?
4. CLOSING: Was there a clear next step? Did he ask for the business?
5. EMOTIONAL_CONTROL: Any ego triggers? Discount reflex? Checkout language?
6. PRICING_DISCIPLINE: Did he hold floor rate? Avoid free offers?

Then compute:
- overallSparkScore: weighted average — CLOSING and PRICING_DISCIPLINE count 2×

Return ONLY this JSON shape (array of conversation results):
[
  {
    "conversationId": "<id>",
    "label": "<label or 'Unknown'>",
    "clarity": <1-10>,
    "confidence": <1-10>,
    "technicalDepth": <1-10>,
    "closing": <1-10>,
    "emotionalControl": <1-10>,
    "pricingDiscipline": <1-10>,
    "sparkScore": <weighted float>,
    "bestMoment": "<one sentence — what to keep doing>",
    "worstMoment": "<one sentence — what to fix>",
    "practicePhrase": "<exact alternative phrasing to practice>"
  }
]`

interface ClaudeConvScore {
  conversationId: string
  label: string
  clarity: number
  confidence: number
  technicalDepth: number
  closing: number
  emotionalControl: number
  pricingDiscipline: number
  sparkScore: number
  bestMoment: string
  worstMoment: string
  practicePhrase: string
}

/**
 * Send all today's transcripts to Claude Sonnet for deep analysis.
 * Returns parsed scores per conversation.
 */
async function analyzeTranscriptsBatch(
  transcripts: ConversationTranscript[],
): Promise<ClaudeConvScore[]> {
  if (transcripts.length === 0) return []

  const transcriptBlock = transcripts
    .map(
      (t, i) =>
        `--- CONVERSATION ${i + 1} ---\n` +
        `ID: ${t.id}\n` +
        `LABEL: ${t.label ?? 'Unknown'}\n` +
        `DATE: ${t.startedAt}\n` +
        `TRANSCRIPT:\n${t.text}\n`,
    )
    .join('\n')

  const userPrompt =
    `Review these ${transcripts.length} conversation transcript(s) from today and return the JSON array as instructed.\n\n` +
    transcriptBlock

  try {
    const response = await callClaude({
      model: 'claude-sonnet-4-20250514',
      system: COACH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 4096,
    })

    const raw = extractText(response)
    // Strip any accidental markdown fences
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()

    const parsed: ClaudeConvScore[] = JSON.parse(cleaned)
    return parsed
  } catch (err) {
    console.error('[SparkNightlyCoach] Claude batch analysis failed:', err)
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Assembly
// ─────────────────────────────────────────────────────────────────────────────

function buildConversationScore(
  transcript: ConversationTranscript,
  claudeScore: ClaudeConvScore | undefined,
): ConversationScore {
  const fillerStats = computeFillerStats(transcript.text)
  const powerRatio = computePowerRatio(transcript.text)
  const hedgeCount = countHedges(transcript.text)

  let paceWPM: number | 'unknown' = 'unknown'
  let paceRating: ConversationScore['paceRating'] = 'unknown'

  if (transcript.durationSecs && transcript.durationSecs > 0) {
    const wpm = computePaceWPM(transcript.text, transcript.durationSecs)
    paceWPM = wpm
    paceRating = classifyPace(wpm)
  }

  // Use Claude scores if available; fall back to neutral 5s
  const clarity          = claudeScore?.clarity          ?? 5
  const confidence       = claudeScore?.confidence       ?? 5
  const technicalDepth   = claudeScore?.technicalDepth   ?? 5
  const closing          = claudeScore?.closing          ?? 5
  const emotionalControl = claudeScore?.emotionalControl ?? 5
  const pricingDiscipline = claudeScore?.pricingDiscipline ?? 5
  const sparkScore = claudeScore?.sparkScore ??
    calcSparkScore({ clarity, confidence, technicalDepth, closing, emotionalControl, pricingDiscipline })

  return {
    conversationId: transcript.id,
    label: transcript.label ?? claudeScore?.label ?? 'Unknown',
    clarity,
    confidence,
    technicalDepth,
    closing,
    emotionalControl,
    pricingDiscipline,
    sparkScore,
    bestMoment:     claudeScore?.bestMoment    ?? 'No analysis available.',
    worstMoment:    claudeScore?.worstMoment   ?? 'No analysis available.',
    practicePhrase: claudeScore?.practicePhrase ?? '',
    fillerStats,
    paceWPM,
    paceRating,
    powerLanguageRatio: powerRatio,
    hedgeCount,
  }
}

function assembleHighlightsAndFlags(scores: ConversationScore[]): {
  highlights: string[]
  flags: string[]
} {
  const highlights: string[] = []
  const flags: string[] = []

  if (scores.length === 0) return { highlights, flags }

  const avg = (key: keyof ConversationScore) => {
    const vals = scores.map(s => s[key] as number).filter(v => typeof v === 'number')
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }

  const avgClosing = avg('closing')
  const avgPricing = avg('pricingDiscipline')
  const avgConfidence = avg('confidence')
  const avgTech = avg('technicalDepth')
  const totalFillers = scores.reduce((sum, s) => sum + s.fillerStats.total, 0)
  const freeOfferCount = scores.filter(s => s.pricingDiscipline < 5).length

  // Positive callouts
  if (avgClosing >= 7) highlights.push(`Strong closing discipline — avg ${avgClosing.toFixed(1)}/10 across ${scores.length} conversation(s).`)
  if (avgPricing >= 7) highlights.push(`Held floor rate well — pricing discipline at ${avgPricing.toFixed(1)}/10.`)
  if (avgConfidence >= 7) highlights.push(`High confidence score (${avgConfidence.toFixed(1)}/10) — assertive delivery.`)
  if (avgTech >= 7)      highlights.push(`Technical depth strong — referenced codes and specifics effectively.`)
  if (freeOfferCount === 0 && scores.length >= 2) highlights.push(`Zero free offers — pricing discipline fully intact today.`)

  // Flags
  if (avgClosing < 5)  flags.push(`Closing score low (${avgClosing.toFixed(1)}/10) — practice asking for the business directly.`)
  if (avgPricing < 5)  flags.push(`Pricing discipline below threshold (${avgPricing.toFixed(1)}/10) — check for discount reflex.`)
  if (totalFillers > 20) flags.push(`High filler word count today (${totalFillers} total) — awareness drill recommended.`)
  if (avgConfidence < 5) flags.push(`Confidence score low (${avgConfidence.toFixed(1)}/10) — work on pace and hedge elimination.`)

  const fastConvos = scores.filter(s => s.paceRating === 'too_fast').length
  if (fastConvos > 0) flags.push(`${fastConvos} conversation(s) flagged as too fast — slow down on proposal delivery.`)

  return {
    highlights: highlights.slice(0, 3),
    flags: flags.slice(0, 3),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

function saveDailyReport(report: DailyCoachReport): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DAILY_REPORT, JSON.stringify(report))
  } catch {
    // localStorage full — degrade gracefully
  }
}

function loadDailyReport(): DailyCoachReport | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DAILY_REPORT)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function appendToWeeklyHistory(record: DailySparkRecord): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.WEEKLY_HISTORY)
    const history: DailySparkRecord[] = raw ? JSON.parse(raw) : []

    // Remove any existing record for today
    const today = record.date
    const filtered = history.filter(r => r.date !== today)
    filtered.push(record)

    // Keep only last 7 days
    const sorted = filtered
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7)

    localStorage.setItem(STORAGE_KEYS.WEEKLY_HISTORY, JSON.stringify(sorted))
  } catch {
    // Degrade gracefully
  }
}

function loadWeeklyHistory(): DailySparkRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.WEEKLY_HISTORY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly Trend Narrative
// ─────────────────────────────────────────────────────────────────────────────

function buildWeeklyNarrative(records: DailySparkRecord[]): string[] {
  if (records.length < 2) {
    return ['Keep logging daily reviews to unlock weekly trend insights.']
  }

  const narrative: string[] = []
  const first = records[0]
  const last  = records[records.length - 1]

  // Overall trajectory
  const scoreDelta = last.sparkScore - first.sparkScore
  if (scoreDelta >= 1) {
    narrative.push(
      `Your overall SPARK score improved ${scoreDelta.toFixed(1)} points this week (${first.sparkScore} → ${last.sparkScore}).`,
    )
  } else if (scoreDelta <= -1) {
    narrative.push(
      `Your SPARK score dipped ${Math.abs(scoreDelta).toFixed(1)} points this week — focus on the red flags below.`,
    )
  } else {
    narrative.push(`Your SPARK score held steady this week at ~${last.sparkScore}.`)
  }

  // Closing trajectory
  const closingFirst = first.closingScore
  const closingLast  = last.closingScore
  if (closingLast - closingFirst >= 1) {
    narrative.push(
      `Your closing score went from ${closingFirst} to ${closingLast} this week — keep asking for the business.`,
    )
  } else if (closingFirst - closingLast >= 1) {
    narrative.push(
      `Closing score dropped from ${closingFirst} to ${closingLast} — revisit your call-to-action approach.`,
    )
  }

  // Filler word trend
  const avgFillers = records.reduce((s, r) => s + r.totalFillers, 0) / records.length
  const highFillerDays = records.filter(r => r.totalFillers > avgFillers * 1.4)
  if (highFillerDays.length > 0) {
    const dayNames = highFillerDays.map(r => {
      const d = new Date(r.date)
      return d.toLocaleDateString('en-US', { weekday: 'long' })
    })
    narrative.push(
      `Filler words spiked on ${dayNames.join(' and ')} — you may have been fatigued or rushed.`,
    )
  }

  // Pricing discipline
  const nFreeOfferDays = records.filter(r => r.pricingScore >= 7).length
  if (nFreeOfferDays >= 3) {
    narrative.push(
      `You held your floor rate on ${nFreeOfferDays} out of ${records.length} days — discount reflex is improving.`,
    )
  }

  // Power ratio
  const avgPower = records.reduce((s, r) => s + r.avgPower, 0) / records.length
  if (avgPower >= 0.7) {
    narrative.push(`Power language ratio is strong at ${Math.round(avgPower * 100)}% assertive statements.`)
  } else if (avgPower < 0.5) {
    narrative.push(`Power ratio is low (${Math.round(avgPower * 100)}%) — cut hedging phrases like "I think" and "maybe".`)
  }

  return narrative.slice(0, 5)
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full nightly coach review.
 * Pulls today's transcripts from ECHO/localStorage, sends them to Claude,
 * assembles per-conversation scorecards, persists daily report and weekly record.
 */
export async function runNightlyReview(): Promise<DailyCoachReport> {
  const today = new Date().toISOString().slice(0, 10)
  const transcripts = loadTodayTranscripts()

  // Run Claude analysis
  const claudeScores = await analyzeTranscriptsBatch(transcripts)
  const claudeMap = new Map(claudeScores.map(s => [s.conversationId, s]))

  // Build per-conversation scorecards
  const conversationScores: ConversationScore[] = transcripts.map(t =>
    buildConversationScore(t, claudeMap.get(t.id)),
  )

  // Aggregate
  const allSparkScores = conversationScores.map(s => s.sparkScore)
  const overallSparkScore =
    allSparkScores.length > 0
      ? Math.round((allSparkScores.reduce((a, b) => a + b, 0) / allSparkScores.length) * 10) / 10
      : 0

  const avgPowerRatio =
    conversationScores.length > 0
      ? conversationScores.reduce((s, c) => s + c.powerLanguageRatio, 0) / conversationScores.length
      : 0

  const totalFillerWords = conversationScores.reduce((s, c) => s + c.fillerStats.total, 0)

  const { highlights, flags } = assembleHighlightsAndFlags(conversationScores)

  const report: DailyCoachReport = {
    date: today,
    conversationScores,
    overallSparkScore,
    avgPowerRatio: Math.round(avgPowerRatio * 100) / 100,
    totalFillerWords,
    highlights,
    flags,
  }

  // Persist daily report
  saveDailyReport(report)

  // Persist weekly record
  const avgClosing =
    conversationScores.length > 0
      ? conversationScores.reduce((s, c) => s + c.closing, 0) / conversationScores.length
      : 0

  const avgPricing =
    conversationScores.length > 0
      ? conversationScores.reduce((s, c) => s + c.pricingDiscipline, 0) / conversationScores.length
      : 0

  appendToWeeklyHistory({
    date: today,
    sparkScore: overallSparkScore,
    totalFillers: totalFillerWords,
    avgPower: avgPowerRatio,
    closingScore: Math.round(avgClosing * 10) / 10,
    pricingScore: Math.round(avgPricing * 10) / 10,
  })

  return report
}

/**
 * Return the daily report for today if it has already been run.
 */
export function getTodayReview(): DailyCoachReport | null {
  const report = loadDailyReport()
  if (!report) return null
  const today = new Date().toISOString().slice(0, 10)
  return report.date === today ? report : null
}

/**
 * Return the 7-day trend with generated narrative.
 */
export function getWeeklyTrend(): WeeklyTrend {
  const records = loadWeeklyHistory()
  const narrative = buildWeeklyNarrative(records)
  return { records, narrative }
}

/**
 * Wipe all coach data from localStorage.
 */
export function clearCoachCache(): void {
  localStorage.removeItem(STORAGE_KEYS.DAILY_REPORT)
  localStorage.removeItem(STORAGE_KEYS.WEEKLY_HISTORY)
}
