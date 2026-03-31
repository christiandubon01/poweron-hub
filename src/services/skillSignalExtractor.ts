// @ts-nocheck
/**
 * Skill Signal Extractor — Living Skill Intelligence (Session 10)
 *
 * Passively extracts skill signals from NEXUS conversations, journal entries,
 * and field log notes. Updates the owner_profile skill_map in Supabase and
 * localStorage in the background (fire-and-forget).
 *
 * Skill domains:
 *   field_execution, estimating, project_management, business_development,
 *   financial_literacy, permitting_compliance, crew_management,
 *   client_communication, technical_knowledge, systems_thinking
 */

import { callClaude, extractText } from './claudeProxy'
import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export type SkillDomain =
  | 'field_execution'
  | 'estimating'
  | 'project_management'
  | 'business_development'
  | 'financial_literacy'
  | 'permitting_compliance'
  | 'crew_management'
  | 'client_communication'
  | 'technical_knowledge'
  | 'systems_thinking'

export type SignalType = 'positive' | 'gap' | 'learning'

export type SignalContext = 'nexus_chat' | 'journal' | 'field_log' | 'estimate'

export interface SkillSignal {
  skill: SkillDomain
  signal: SignalType
  strength: 1 | 2 | 3
  evidence: string
}

export interface StoredSkillSignal extends SkillSignal {
  timestamp: string
  source: SignalContext
}

export interface SkillScore {
  score: number
  evidence: StoredSkillSignal[]
  lastUpdated: string
}

export interface SkillMap {
  field_execution: SkillScore
  estimating: SkillScore
  project_management: SkillScore
  business_development: SkillScore
  financial_literacy: SkillScore
  permitting_compliance: SkillScore
  crew_management: SkillScore
  client_communication: SkillScore
  technical_knowledge: SkillScore
  systems_thinking: SkillScore
}

export interface DevelopmentLogEntry {
  timestamp: string
  skill: SkillDomain
  scoreBefore: number
  scoreAfter: number
  development_rate: number | null
  period: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LOCAL_SKILL_MAP_KEY = 'poweron_skill_map'
const LOCAL_SKILL_SIGNALS_KEY = 'poweron_skill_signals'
const LOCAL_DEV_LOG_KEY = 'poweron_development_log'

const SKILL_DOMAINS: SkillDomain[] = [
  'field_execution', 'estimating', 'project_management', 'business_development',
  'financial_literacy', 'permitting_compliance', 'crew_management',
  'client_communication', 'technical_knowledge', 'systems_thinking',
]

const IDEAL_PROFILE: Record<SkillDomain, { target: number; description: string }> = {
  field_execution: { target: 90, description: 'Executes complex commercial and residential work independently, manages inspections, supervises crew on multi-phase jobs' },
  estimating: { target: 85, description: 'Builds accurate estimates for commercial TI, solar, service upgrades. Knows labor rates, material costs, markup strategy' },
  project_management: { target: 80, description: 'Runs 3-5 simultaneous projects, manages GC relationships, RFIs, change orders, milestone billing' },
  business_development: { target: 75, description: 'Builds referral network, converts 40%+ of estimates, maintains pipeline above $150K, leverages RMO arrangements' },
  financial_literacy: { target: 80, description: 'Reads own financials, understands AR aging, cashflow timing, job costing vs estimate, tax obligations' },
  permitting_compliance: { target: 75, description: 'Pulls permits independently in 5+ cities, knows NEC code requirements by job type, passes inspections first attempt' },
  crew_management: { target: 70, description: 'Hires, onboards, supervises 2-3 field employees, manages labor costs, enforces safety protocols' },
  client_communication: { target: 80, description: 'Sets clear scope, communicates delays proactively, handles difficult conversations, earns repeat business' },
  technical_knowledge: { target: 85, description: 'Expert in residential and commercial electrical systems, solar interconnection, generator integration, EV charging' },
  systems_thinking: { target: 75, description: 'Builds repeatable processes, uses software to leverage capacity, thinks in systems not tasks' },
}

// ── Local cache helpers ───────────────────────────────────────────────────────

function getDefaultSkillMap(): SkillMap {
  const now = new Date().toISOString()
  const defaults: Record<string, SkillScore> = {}
  for (const domain of SKILL_DOMAINS) {
    defaults[domain] = { score: 0, evidence: [], lastUpdated: now }
  }
  return defaults as SkillMap
}

export function getLocalSkillMap(): SkillMap {
  try {
    const raw = localStorage.getItem(LOCAL_SKILL_MAP_KEY)
    if (!raw) return getDefaultSkillMap()
    const parsed = JSON.parse(raw)
    // Ensure all domains are present
    const defaults = getDefaultSkillMap()
    for (const domain of SKILL_DOMAINS) {
      if (!parsed[domain]) parsed[domain] = defaults[domain]
    }
    return parsed
  } catch {
    return getDefaultSkillMap()
  }
}

function saveLocalSkillMap(map: SkillMap): void {
  try {
    localStorage.setItem(LOCAL_SKILL_MAP_KEY, JSON.stringify(map))
  } catch { /* non-critical */ }
}

export function getLocalSkillSignals(): StoredSkillSignal[] {
  try {
    const raw = localStorage.getItem(LOCAL_SKILL_SIGNALS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveLocalSkillSignals(signals: StoredSkillSignal[]): void {
  try {
    // Keep last 500 signals to avoid bloat
    const trimmed = signals.slice(-500)
    localStorage.setItem(LOCAL_SKILL_SIGNALS_KEY, JSON.stringify(trimmed))
  } catch { /* non-critical */ }
}

export function getLocalDevelopmentLog(): DevelopmentLogEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_DEV_LOG_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveLocalDevelopmentLog(log: DevelopmentLogEntry[]): void {
  try {
    const trimmed = log.slice(-200)
    localStorage.setItem(LOCAL_DEV_LOG_KEY, JSON.stringify(trimmed))
  } catch { /* non-critical */ }
}

// ── Score delta from signal ───────────────────────────────────────────────────

function scoreDelta(signal: SignalType, strength: 1 | 2 | 3): number {
  if (signal === 'positive') return strength       // +1, +2, or +3
  if (signal === 'learning') return 0.5            // actively developing
  return 0                                          // gap — flag only
}

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, score))
}

// ── Development rate calculation ──────────────────────────────────────────────

/**
 * For a given skill, compare score gain over last 30d vs prior 30d.
 * development_rate = (current_30d_gain - prior_30d_gain) / prior_30d_gain * 100
 * Returns null if there isn't enough data.
 */
export function calculateDevelopmentRate(
  signals: StoredSkillSignal[],
  skill: SkillDomain
): number | null {
  const now = Date.now()
  const MS_30D = 30 * 24 * 60 * 60 * 1000

  const skillSignals = signals.filter(s => s.skill === skill)

  const current30d = skillSignals.filter(
    s => new Date(s.timestamp).getTime() >= now - MS_30D
  )
  const prior30d = skillSignals.filter(s => {
    const t = new Date(s.timestamp).getTime()
    return t >= now - 2 * MS_30D && t < now - MS_30D
  })

  const currentGain = current30d.reduce((sum, s) => sum + scoreDelta(s.signal, s.strength), 0)
  const priorGain = prior30d.reduce((sum, s) => sum + scoreDelta(s.signal, s.strength), 0)

  if (priorGain === 0) return null  // Not enough history
  return ((currentGain - priorGain) / priorGain) * 100
}

// ── Apply signals to skill map ────────────────────────────────────────────────

function applySignalsToMap(
  map: SkillMap,
  signals: SkillSignal[],
  source: SignalContext
): { updatedMap: SkillMap; stored: StoredSkillSignal[] } {
  const now = new Date().toISOString()
  const stored: StoredSkillSignal[] = []

  for (const signal of signals) {
    if (!SKILL_DOMAINS.includes(signal.skill)) continue

    const domain = signal.skill
    const current = map[domain]
    const delta = scoreDelta(signal.signal, signal.strength)
    const newScore = clampScore(current.score + delta)

    const storedSignal: StoredSkillSignal = {
      ...signal,
      timestamp: now,
      source,
    }

    map[domain] = {
      score: newScore,
      evidence: [...(current.evidence || []).slice(-20), storedSignal], // Keep last 20 per skill
      lastUpdated: now,
    }

    stored.push(storedSignal)
  }

  return { updatedMap: map, stored }
}

// ── Claude extraction ─────────────────────────────────────────────────────────

/**
 * Call Claude to extract skill signals from the provided text.
 * Returns an empty array on any error — never throws.
 */
export async function extractSkillSignals(
  input: string,
  context: SignalContext
): Promise<SkillSignal[]> {
  if (!input || input.trim().length < 20) return []

  const prompt = `Analyze this text from a solo electrical contractor.
Identify any skill signals — evidence of competency, learning, or gaps.
Return JSON array only (no explanation, no markdown):
[{ "skill": string, "signal": "positive"|"gap"|"learning", "strength": 1|2|3, "evidence": string }]

Skill domains to use (only these): field_execution, estimating, project_management,
business_development, financial_literacy, permitting_compliance, crew_management,
client_communication, technical_knowledge, systems_thinking

Strength guide: 1=weak mention, 2=clear evidence, 3=strong demonstrated competency or significant gap.
Only include skills that are genuinely evident in the text. Return [] if none found.

Text: ${input.slice(0, 1500)}
Context: ${context}`

  try {
    const response = await callClaude({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      model: 'claude-haiku-4-5-20251001',
    })

    const text = extractText(response).trim()

    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []

    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []

    // Validate and sanitize each signal
    return parsed.filter(s =>
      SKILL_DOMAINS.includes(s.skill) &&
      ['positive', 'gap', 'learning'].includes(s.signal) &&
      [1, 2, 3].includes(s.strength) &&
      typeof s.evidence === 'string'
    ) as SkillSignal[]
  } catch (err) {
    console.warn('[SkillSignalExtractor] Extraction failed (non-critical):', err)
    return []
  }
}

// ── Supabase sync ─────────────────────────────────────────────────────────────

async function syncSkillMapToSupabase(
  orgId: string,
  skillMap: SkillMap,
  skillSignals: StoredSkillSignal[],
  developmentLog: DevelopmentLogEntry[]
): Promise<void> {
  try {
    // Fetch existing row to get the id
    const { data: existing } = await supabase
      .from('owner_profile' as never)
      .select('id')
      .eq('org_id', orgId)
      .maybeSingle()

    const payload = {
      skill_map: skillMap,
      skill_signals: skillSignals.slice(-200),
      development_log: developmentLog.slice(-100),
      last_skill_update: new Date().toISOString(),
    }

    if (existing?.id) {
      await supabase
        .from('owner_profile' as never)
        .update(payload)
        .eq('id', (existing as any).id)
    } else {
      await supabase
        .from('owner_profile' as never)
        .insert({ org_id: orgId, ...payload })
    }
  } catch (err) {
    console.warn('[SkillSignalExtractor] Supabase sync failed (non-critical):', err)
  }
}

// ── Main public API ───────────────────────────────────────────────────────────

/**
 * Fire-and-forget: extract skill signals from text, update skill map,
 * and sync to Supabase in the background.
 *
 * Call this after:
 *   - Every NEXUS conversation turn
 *   - Every journal entry save
 *   - Every field log entry save
 *
 * @param input   The text to analyze
 * @param context Source context label
 * @param orgId   Optional — if provided, syncs to Supabase
 */
export function processSkillSignals(
  input: string,
  context: SignalContext,
  orgId?: string
): void {
  // Fire and forget — never awaited, never blocks UI
  ;(async () => {
    try {
      const signals = await extractSkillSignals(input, context)
      if (signals.length === 0) return

      // Load current state
      const skillMap = getLocalSkillMap()
      const allSignals = getLocalSkillSignals()
      const devLog = getLocalDevelopmentLog()

      // Apply signals to map
      const { updatedMap, stored } = applySignalsToMap(skillMap, signals, context)
      const updatedSignals = [...allSignals, ...stored]

      // Update development log for affected skills
      const affectedSkills = [...new Set(signals.map(s => s.skill))]
      const now = new Date().toISOString()

      for (const skill of affectedSkills) {
        const scoreBefore = skillMap[skill]?.score ?? 0
        const scoreAfter = updatedMap[skill]?.score ?? 0
        const devRate = calculateDevelopmentRate(updatedSignals, skill)

        if (scoreAfter !== scoreBefore) {
          devLog.push({
            timestamp: now,
            skill,
            scoreBefore,
            scoreAfter,
            development_rate: devRate,
            period: '30d',
          })
        }
      }

      // Persist locally (fast, synchronous)
      saveLocalSkillMap(updatedMap)
      saveLocalSkillSignals(updatedSignals)
      saveLocalDevelopmentLog(devLog)

      // Sync to Supabase in background (slower, optional)
      if (orgId) {
        await syncSkillMapToSupabase(orgId, updatedMap, updatedSignals, devLog)
      }
    } catch (err) {
      console.warn('[SkillSignalExtractor] Background processing error (non-critical):', err)
    }
  })()
}

// ── Context builder for NEXUS ─────────────────────────────────────────────────

const DEVELOPMENT_KEYWORDS = [
  'should i learn', 'what to focus', 'priority', 'improve', 'develop',
  'ceiling', 'overwhelmed', "what's next", 'what next', 'skill', 'growth',
  'training', 'get better', 'weak', 'strength', 'focus on',
]

/**
 * Returns true if the message is asking for development/skill advice.
 */
export function isDevelopmentQuery(message: string): boolean {
  const lower = message.toLowerCase()
  return DEVELOPMENT_KEYWORDS.some(kw => lower.includes(kw))
}

/**
 * Builds the skill map context block for injection into NEXUS prompts.
 * Reads from local cache — synchronous, no async.
 */
export function buildSkillMapContext(): string {
  const skillMap = getLocalSkillMap()
  const signals = getLocalSkillSignals()

  const hasData = SKILL_DOMAINS.some(d => skillMap[d]?.score > 0)
  if (!hasData) return ''

  const now = Date.now()
  const MS_30D = 30 * 24 * 60 * 60 * 1000

  // Calculate 30-day velocity per skill
  const velocities: Record<SkillDomain, number> = {} as any
  for (const domain of SKILL_DOMAINS) {
    const recent = signals.filter(
      s => s.skill === domain && new Date(s.timestamp).getTime() >= now - MS_30D
    )
    velocities[domain] = recent.reduce((sum, s) => sum + scoreDelta(s.signal, s.strength), 0)
  }

  // Build comparison lines
  const lines = SKILL_DOMAINS.map(domain => {
    const current = skillMap[domain]?.score ?? 0
    const target = IDEAL_PROFILE[domain]?.target ?? 80
    const gap = target - current
    const vel = velocities[domain]
    const velStr = vel > 0 ? ` (+${vel.toFixed(1)} pts/30d)` : vel < 0 ? ` (${vel.toFixed(1)} pts/30d)` : ''
    return `${domain.replace(/_/g, ' ')}: ${current}/${target} — gap: ${gap} pts${velStr}`
  })

  // Top gaps (largest gap first)
  const topGaps = [...SKILL_DOMAINS]
    .sort((a, b) => {
      const gapA = (IDEAL_PROFILE[a]?.target ?? 80) - (skillMap[a]?.score ?? 0)
      const gapB = (IDEAL_PROFILE[b]?.target ?? 80) - (skillMap[b]?.score ?? 0)
      return gapB - gapA
    })
    .slice(0, 3)
    .map(d => d.replace(/_/g, ' '))

  // Fastest improving
  const fastestImproving = [...SKILL_DOMAINS]
    .sort((a, b) => (velocities[b] ?? 0) - (velocities[a] ?? 0))
    .slice(0, 3)
    .filter(d => (velocities[d] ?? 0) > 0)
    .map(d => d.replace(/_/g, ' '))

  // Overall development rate
  const avgVelocity = SKILL_DOMAINS.reduce((sum, d) => sum + (velocities[d] ?? 0), 0) / SKILL_DOMAINS.length
  const devRateLabel = avgVelocity > 1 ? 'accelerating' : avgVelocity > 0 ? 'stable' : 'stalling'

  return `## Owner Development Profile
Current skill scores vs ideal targets:
${lines.join('\n')}

Top gaps: ${topGaps.join(', ')}
Fastest improving: ${fastestImproving.length > 0 ? fastestImproving.join(', ') : 'none yet — keep logging'}
Development rate: ${devRateLabel}

Give personalized advice based on this specific profile, not generic contractor advice.`
}

// ── Exported ideal profile ────────────────────────────────────────────────────

export { IDEAL_PROFILE, SKILL_DOMAINS }
