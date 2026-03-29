// @ts-nocheck
/**
 * NEXUS Preferences — Persistent user preference system
 *
 * Detects preference instructions from voice/chat, stores them in Supabase
 * (nexus_preferences table), and prepends them to agent system prompts.
 *
 * Examples of preference instructions:
 *   - "Moving forward, always show me cash flow first"
 *   - "Remember that I prefer bullet points"
 *   - "From now on, analyze estimates with 20% overhead"
 *   - "I like concise answers, not long reports"
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export interface NexusPreference {
  id: string
  org_id: string
  user_id: string
  preference_text: string
  category: PreferenceCategory
  agent_scope: string | null // null = applies to all agents
  active: boolean
  created_at: string
  updated_at: string
}

export type PreferenceCategory =
  | 'format'        // How responses should be formatted
  | 'priority'      // What to prioritize in briefings
  | 'behavior'      // How NEXUS should behave
  | 'analysis'      // How to analyze data/estimates
  | 'communication' // Communication style preferences
  | 'general'       // Catch-all

// ── Preference detection ────────────────────────────────────────────────────

const PREFERENCE_TRIGGERS = [
  'moving forward',
  'from now on',
  'remember that',
  'always ',
  'never ',
  'i prefer',
  'i like',
  'i want you to',
  'going forward',
  'make sure you',
  'keep in mind',
  'don\'t forget',
  'note that i',
  'my preference is',
  'default to',
  'when i ask',
]

/**
 * Detect if a message contains a preference instruction.
 * Returns the extracted preference text or null.
 */
export function detectPreference(message: string): string | null {
  const lower = message.toLowerCase().trim()

  for (const trigger of PREFERENCE_TRIGGERS) {
    if (lower.includes(trigger)) {
      return message.trim()
    }
  }

  return null
}

/**
 * Categorize a preference based on its content.
 */
export function categorizePreference(text: string): PreferenceCategory {
  const lower = text.toLowerCase()

  if (/bullet|format|header|markdown|concise|brief|detailed|verbose|short|long/.test(lower)) {
    return 'format'
  }
  if (/priorit|first|important|focus|urgent|attention/.test(lower)) {
    return 'priority'
  }
  if (/analyz|calculat|overhead|margin|markup|percentage|estimate/.test(lower)) {
    return 'analysis'
  }
  if (/tone|formal|casual|friendly|professional|language/.test(lower)) {
    return 'communication'
  }
  if (/behav|mode|style|approach|method|way/.test(lower)) {
    return 'behavior'
  }
  return 'general'
}

/**
 * Detect which agent a preference applies to (or null for all agents).
 */
export function detectAgentScope(text: string): string | null {
  const lower = text.toLowerCase()
  const agentMentions: Record<string, string[]> = {
    vault:     ['estimate', 'bid', 'pricing', 'vault', 'quote', 'cost'],
    pulse:     ['dashboard', 'kpi', 'metric', 'pulse', 'chart', 'report'],
    ledger:    ['invoice', 'payment', 'billing', 'ledger', 'ar', 'collection'],
    spark:     ['lead', 'marketing', 'spark', 'outreach', 'campaign'],
    blueprint: ['project', 'blueprint', 'phase', 'permit', 'rfi'],
    ohm:       ['code', 'nec', 'ohm', 'electrical', 'compliance'],
    chrono:    ['schedule', 'calendar', 'chrono', 'crew', 'dispatch'],
    scout:     ['research', 'scout', 'pattern', 'optimization'],
  }

  for (const [agent, keywords] of Object.entries(agentMentions)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return agent
    }
  }
  return null
}

// ── Storage ─────────────────────────────────────────────────────────────────

// localStorage cache key
const PREFS_CACHE_KEY = 'nexus_user_preferences'

/**
 * Save a preference to Supabase and local cache.
 */
export async function savePreference(
  orgId: string,
  userId: string,
  preferenceText: string
): Promise<NexusPreference | null> {
  const category = categorizePreference(preferenceText)
  const agentScope = detectAgentScope(preferenceText)

  const record = {
    org_id: orgId,
    user_id: userId,
    preference_text: preferenceText,
    category,
    agent_scope: agentScope,
    active: true,
    updated_at: new Date().toISOString(),
  }

  try {
    const { data, error } = await supabase
      .from('nexus_preferences' as never)
      .insert(record)
      .select()
      .single()

    if (error) {
      console.warn('[NexusPreferences] Supabase insert failed, saving to localStorage only:', error.message)
      return saveToLocalCache(orgId, userId, preferenceText, category, agentScope)
    }

    // Update local cache
    updateLocalCache(data as NexusPreference)
    console.log(`[NexusPreferences] Saved preference: "${preferenceText.slice(0, 60)}..." [${category}${agentScope ? ` → ${agentScope}` : ''}]`)
    return data as NexusPreference
  } catch (err) {
    console.warn('[NexusPreferences] Save failed, using localStorage:', err)
    return saveToLocalCache(orgId, userId, preferenceText, category, agentScope)
  }
}

/**
 * Load all active preferences for a user.
 */
export async function loadPreferences(
  orgId: string,
  userId: string
): Promise<NexusPreference[]> {
  try {
    const { data, error } = await supabase
      .from('nexus_preferences' as never)
      .select('*')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('active', true)
      .order('created_at', { ascending: false })

    if (error) {
      console.warn('[NexusPreferences] Supabase load failed, using cache:', error.message)
      return getLocalCache(userId)
    }

    // Refresh local cache
    if (data) {
      localStorage.setItem(`${PREFS_CACHE_KEY}_${userId}`, JSON.stringify(data))
    }

    return (data as NexusPreference[]) || []
  } catch {
    return getLocalCache(userId)
  }
}

/**
 * Build a system prompt prefix from active preferences.
 * Optionally filter by agent scope.
 */
export async function buildPreferencePrompt(
  orgId: string,
  userId: string,
  agentId?: string
): Promise<string> {
  const prefs = await loadPreferences(orgId, userId)
  if (prefs.length === 0) return ''

  // Filter: preferences that apply to ALL agents or to the specific agent
  const relevant = prefs.filter(p =>
    p.agent_scope === null || p.agent_scope === agentId
  )

  if (relevant.length === 0) return ''

  const lines = relevant.map(p => `- ${p.preference_text}`)
  return `## User Preferences (honor these in your response)\n${lines.join('\n')}\n`
}

/**
 * Deactivate a preference by ID.
 */
export async function deactivatePreference(prefId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('nexus_preferences' as never)
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', prefId)

    if (error) {
      console.warn('[NexusPreferences] Deactivate failed:', error.message)
      return false
    }
    return true
  } catch {
    return false
  }
}

// ── Local cache helpers ─────────────────────────────────────────────────────

function getLocalCache(userId: string): NexusPreference[] {
  try {
    const raw = localStorage.getItem(`${PREFS_CACHE_KEY}_${userId}`)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function updateLocalCache(pref: NexusPreference): void {
  try {
    const existing = getLocalCache(pref.user_id)
    existing.unshift(pref)
    // Keep max 50 cached preferences
    const trimmed = existing.slice(0, 50)
    localStorage.setItem(`${PREFS_CACHE_KEY}_${pref.user_id}`, JSON.stringify(trimmed))
  } catch { /* ignore */ }
}

function saveToLocalCache(
  orgId: string,
  userId: string,
  text: string,
  category: PreferenceCategory,
  agentScope: string | null
): NexusPreference {
  const pref: NexusPreference = {
    id: `local_${Date.now()}`,
    org_id: orgId,
    user_id: userId,
    preference_text: text,
    category,
    agent_scope: agentScope,
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  updateLocalCache(pref)
  return pref
}

/**
 * Generate a confirmation message after saving a preference.
 */
export function getPreferenceConfirmation(pref: NexusPreference): string {
  const scope = pref.agent_scope
    ? `for ${pref.agent_scope.toUpperCase()} agent`
    : 'across all agents'
  return `Got it. I've saved your preference ${scope}: "${pref.preference_text.slice(0, 80)}${pref.preference_text.length > 80 ? '...' : ''}". I'll apply this going forward.`
}

// ── Profile Interview System ───────────────────────────────────────────────

export interface InterviewQuestion {
  id: string
  question: string
  key: string
  category: PatternType | 'communication_style' | 'behavior'
}

export const PROFILE_INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'response_style',
    question: "Quick question to calibrate how I talk to you — when you ask me about your business, do you want: A) Short punchy summaries with key numbers only, B) Full detailed breakdowns with context, or C) Start short, then I ask if you want more detail?",
    key: 'response_style',
    category: 'communication_style',
  },
  {
    id: 'priority_focus',
    question: "What's your biggest daily priority right now — cash flow and collections, project phase progress, scheduling and crew, or all equal?",
    key: 'priority_focus',
    category: 'priority_preference',
  },
  {
    id: 'briefing_time',
    question: "When do you usually check in with me — morning before the day starts, throughout the day in the field, or end of day review?",
    key: 'briefing_time',
    category: 'behavior',
  },
  {
    id: 'action_style',
    question: "When I spot a problem, do you want me to: A) Just flag it and move on, B) Flag it and give you one specific action to take, or C) Flag it, give the action, and tell you which agent to route it to?",
    key: 'action_style',
    category: 'response_format',
  },
  {
    id: 'voice_preference',
    question: "For voice responses — short and fast under 20 seconds, or up to 35 seconds when the topic needs it?",
    key: 'voice_preference',
    category: 'communication_style',
  },
]

const INTERVIEW_KEY = 'nexus_interview_complete'
const INTERVIEW_PROGRESS_KEY = 'nexus_interview_progress'
const SESSION_COUNT_KEY = 'nexus_session_count'

/**
 * Check if the user has completed the profile interview.
 */
export function hasCompletedInterview(): boolean {
  try {
    return localStorage.getItem(INTERVIEW_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Get the current interview progress (which question index we're on).
 */
function getInterviewProgress(): number {
  try {
    const raw = localStorage.getItem(INTERVIEW_PROGRESS_KEY)
    return raw ? parseInt(raw, 10) : 0
  } catch {
    return 0
  }
}

/**
 * Increment the session counter (called on app startup / new session).
 */
export function incrementSessionCount(): number {
  try {
    const count = getSessionCount() + 1
    localStorage.setItem(SESSION_COUNT_KEY, String(count))
    return count
  } catch {
    return 0
  }
}

/**
 * Get the current session count.
 */
export function getSessionCount(): number {
  try {
    const raw = localStorage.getItem(SESSION_COUNT_KEY)
    return raw ? parseInt(raw, 10) : 0
  } catch {
    return 0
  }
}

/**
 * Start the interview — returns the intro message plus the first question.
 */
export function startInterview(): string {
  try {
    localStorage.setItem(INTERVIEW_PROGRESS_KEY, '0')
  } catch { /* ignore */ }

  const firstQ = PROFILE_INTERVIEW_QUESTIONS[0]
  return `I want to calibrate how I communicate with you so every response fits your working style. I have 5 quick questions — takes about 2 minutes. Ready?\n\n${firstQ.question}`
}

/**
 * Process an interview answer.
 * Saves the answer as a high-confidence learned pattern, advances to the next question.
 * Returns the next question text, or a completion message when done.
 */
export async function processInterviewAnswer(
  orgId: string,
  userId: string,
  questionId: string,
  answer: string
): Promise<{ nextMessage: string; isComplete: boolean }> {
  const currentIndex = getInterviewProgress()
  const currentQuestion = PROFILE_INTERVIEW_QUESTIONS[currentIndex]

  if (!currentQuestion || currentQuestion.id !== questionId) {
    // Out of sync — find the question by ID
    const qIdx = PROFILE_INTERVIEW_QUESTIONS.findIndex(q => q.id === questionId)
    if (qIdx >= 0) {
      const q = PROFILE_INTERVIEW_QUESTIONS[qIdx]
      await saveInterviewAnswer(orgId, userId, q, answer)
      const nextIdx = qIdx + 1
      return advanceInterview(nextIdx)
    }
    return { nextMessage: 'Something went wrong with the interview flow. You can say "recalibrate my profile" to start again.', isComplete: true }
  }

  // Save this answer as a high-confidence learned pattern
  await saveInterviewAnswer(orgId, userId, currentQuestion, answer)

  // Advance
  const nextIdx = currentIndex + 1
  return advanceInterview(nextIdx)
}

async function saveInterviewAnswer(
  orgId: string,
  userId: string,
  question: InterviewQuestion,
  answer: string
): Promise<void> {
  // Import upsertPattern from nexusLearnedProfile for high-confidence pattern storage
  try {
    const { upsertPattern } = await import('./nexusLearnedProfile')

    // Write pattern with confidence 3 (pre-trusted from explicit interview)
    const pattern = {
      pattern_type: question.category as any,
      pattern_key: question.key,
      pattern_value: `User stated: ${answer.slice(0, 200)}`,
    }

    // Upsert once — then bump confidence to 3 to mark as pre-trusted
    await upsertPattern(orgId, userId, pattern)
    // Bump again to reach confidence 3
    await upsertPattern(orgId, userId, pattern)
    await upsertPattern(orgId, userId, pattern)

    console.log(`[Interview] Saved answer for "${question.key}": "${answer.slice(0, 80)}..."`)
  } catch (err) {
    console.warn('[Interview] Failed to save answer as pattern:', err)
  }
}

function advanceInterview(nextIdx: number): { nextMessage: string; isComplete: boolean } {
  if (nextIdx >= PROFILE_INTERVIEW_QUESTIONS.length) {
    // Interview complete
    try {
      localStorage.setItem(INTERVIEW_KEY, 'true')
      localStorage.removeItem(INTERVIEW_PROGRESS_KEY)
    } catch { /* ignore */ }

    return {
      nextMessage: "Got it. I've updated my profile with your preferences. Every response going forward will reflect how you like to work. You can re-run this anytime by saying \"recalibrate my profile.\"",
      isComplete: true,
    }
  }

  // Save progress and return next question
  try {
    localStorage.setItem(INTERVIEW_PROGRESS_KEY, String(nextIdx))
  } catch { /* ignore */ }

  const nextQ = PROFILE_INTERVIEW_QUESTIONS[nextIdx]
  return {
    nextMessage: nextQ.question,
    isComplete: false,
  }
}

/**
 * Reset the interview (for "recalibrate my profile").
 */
export function resetInterview(): void {
  try {
    localStorage.removeItem(INTERVIEW_KEY)
    localStorage.removeItem(INTERVIEW_PROGRESS_KEY)
  } catch { /* ignore */ }
}

/**
 * Check if we're currently in an active interview.
 */
export function isInterviewInProgress(): boolean {
  try {
    const progress = localStorage.getItem(INTERVIEW_PROGRESS_KEY)
    return progress !== null && !hasCompletedInterview()
  } catch {
    return false
  }
}

/**
 * Get the current interview question (for continuing an in-progress interview).
 */
export function getCurrentInterviewQuestion(): InterviewQuestion | null {
  if (!isInterviewInProgress()) return null
  const idx = getInterviewProgress()
  return PROFILE_INTERVIEW_QUESTIONS[idx] || null
}
