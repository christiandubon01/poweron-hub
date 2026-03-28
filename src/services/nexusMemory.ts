// @ts-nocheck

import { supabase } from '@/lib/supabase'

interface ConversationTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  agent?: string
  timestamp: number
}

interface UserProfile {
  name: string
  role: string
  location: string
  communicationStyle: string
  frequentTopics: string[]
  preferredAgents: Record<string, number>
}

interface ProjectContext {
  lastDiscussedProject: string
  lastDiscussedServiceCall: string
  activeCodeQuestions: string[]
}

interface SeedKnowledge {
  learnedPatterns: string[]
  correctionHistory: string[]
  domainInsights: string[]
}

interface NexusMemory {
  conversationHistory: ConversationTurn[]
  userProfile: UserProfile
  projectContext: ProjectContext
  seedKnowledge: SeedKnowledge
  lastSyncedAt: number
}

const STORAGE_KEY = 'nexus_memory'
const MAX_CONVERSATION_HISTORY = 50
const MAX_LEARNED_PATTERNS = 30
const MAX_CORRECTION_HISTORY = 20

const defaultUserProfile: UserProfile = {
  name: 'Christian',
  role: 'C-10 Electrical Contractor',
  location: 'Coachella Valley, CA',
  communicationStyle: 'Direct, practical, action-oriented',
  frequentTopics: [],
  preferredAgents: {}
}

const defaultMemory: NexusMemory = {
  conversationHistory: [],
  userProfile: defaultUserProfile,
  projectContext: {
    lastDiscussedProject: '',
    lastDiscussedServiceCall: '',
    activeCodeQuestions: []
  },
  seedKnowledge: {
    learnedPatterns: [],
    correctionHistory: [],
    domainInsights: []
  },
  lastSyncedAt: 0
}

let memory: NexusMemory = { ...defaultMemory }

/**
 * Adds a conversation turn, auto-trims to 50 max, updates profile metrics
 */
export function addTurn(
  role: 'user' | 'assistant',
  content: string,
  agent?: string,
  timestamp: number = Date.now()
): void {
  const id = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`

  const turn: ConversationTurn = {
    id,
    role,
    content,
    agent,
    timestamp
  }

  memory.conversationHistory.push(turn)

  // Trim to max size
  if (memory.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
    memory.conversationHistory = memory.conversationHistory.slice(
      -MAX_CONVERSATION_HISTORY
    )
  }

  // Update frequentTopics by extracting keywords (simple approach)
  if (role === 'user') {
    updateFrequentTopics(content)
  }

  // Update preferredAgents count
  if (agent) {
    memory.userProfile.preferredAgents[agent] =
      (memory.userProfile.preferredAgents[agent] || 0) + 1
  }

  saveToLocalStorage()
}

/**
 * Extract and update frequent topics from user content
 */
function updateFrequentTopics(content: string): void {
  const keywords = extractKeywords(content)
  keywords.forEach((keyword) => {
    const index = memory.userProfile.frequentTopics.indexOf(keyword)
    if (index > -1) {
      memory.userProfile.frequentTopics.splice(index, 1)
    }
    memory.userProfile.frequentTopics.unshift(keyword)
  })

  // Keep top 5
  memory.userProfile.frequentTopics = memory.userProfile.frequentTopics.slice(
    0,
    5
  )
}

/**
 * Simple keyword extraction from text
 */
function extractKeywords(text: string): string[] {
  const commonWords = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'i',
    'you',
    'he',
    'she',
    'it',
    'we',
    'they',
    'what',
    'which',
    'who',
    'when',
    'where',
    'why',
    'how'
  ])

  const words = text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3 && !commonWords.has(word))
    .slice(0, 5)

  return [...new Set(words)]
}

/**
 * Returns recent history formatted for prompt injection
 */
export function getContext(maxTurns: number = 10): string {
  const recentTurns = memory.conversationHistory.slice(-maxTurns)

  const formattedHistory = recentTurns
    .map((turn) => {
      const time = new Date(turn.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })

      if (turn.role === 'user') {
        return `[${time}] You: ${turn.content}`
      } else {
        const agent = turn.agent ? ` (${turn.agent})` : ''
        return `[${time}] NEXUS${agent}: ${turn.content}`
      }
    })
    .join('\n')

  const frequentTopicsList =
    memory.userProfile.frequentTopics.length > 0
      ? memory.userProfile.frequentTopics.join(', ')
      : 'none yet'

  const activeCodeQuestionsList =
    memory.projectContext.activeCodeQuestions.length > 0
      ? memory.projectContext.activeCodeQuestions.map((q) => `  - ${q}`).join('\n')
      : 'none'

  const learnedPatternsList =
    memory.seedKnowledge.learnedPatterns.length > 0
      ? memory.seedKnowledge.learnedPatterns.map((p) => `  - ${p}`).join('\n')
      : 'none'

  return `## Conversation History (last ${recentTurns.length} turns)
${formattedHistory}

## User Profile
Name: ${memory.userProfile.name} | Role: ${memory.userProfile.role} | Location: ${memory.userProfile.location}
Communication style: ${memory.userProfile.communicationStyle}
Frequent topics: ${frequentTopicsList}

## Project Context
Last discussed project: ${memory.projectContext.lastDiscussedProject || 'none'}
Last discussed service call: ${memory.projectContext.lastDiscussedServiceCall || 'none'}
Active code questions:
${activeCodeQuestionsList}

## Learned Patterns
${learnedPatternsList}`
}

/**
 * Merges updates into user profile
 */
export function updateUserProfile(updates: Partial<UserProfile>): void {
  memory.userProfile = {
    ...memory.userProfile,
    ...updates
  }
  saveToLocalStorage()
}

/**
 * Merges updates into project context
 */
export function updateProjectContext(
  updates: Partial<ProjectContext>
): void {
  memory.projectContext = {
    ...memory.projectContext,
    ...updates
  }
  saveToLocalStorage()
}

/**
 * Adds to correction history (max 20)
 */
export function addCorrection(original: string, corrected: string): void {
  const entry = `User corrected: '${original}' → '${corrected}'`
  memory.seedKnowledge.correctionHistory.unshift(entry)

  if (memory.seedKnowledge.correctionHistory.length > MAX_CORRECTION_HISTORY) {
    memory.seedKnowledge.correctionHistory =
      memory.seedKnowledge.correctionHistory.slice(0, MAX_CORRECTION_HISTORY)
  }

  saveToLocalStorage()
}

/**
 * Adds to learned patterns (max 30)
 */
export function addLearnedPattern(pattern: string): void {
  if (!memory.seedKnowledge.learnedPatterns.includes(pattern)) {
    memory.seedKnowledge.learnedPatterns.unshift(pattern)

    if (memory.seedKnowledge.learnedPatterns.length > MAX_LEARNED_PATTERNS) {
      memory.seedKnowledge.learnedPatterns =
        memory.seedKnowledge.learnedPatterns.slice(0, MAX_LEARNED_PATTERNS)
    }

    saveToLocalStorage()
  }
}

/**
 * Saves entire NexusMemory to localStorage
 */
export function saveToLocalStorage(): void {
  try {
    const serialized = JSON.stringify(memory)
    localStorage.setItem(STORAGE_KEY, serialized)
  } catch (error) {
    console.error('Failed to save memory to localStorage:', error)
  }
}

/**
 * Loads from localStorage, returns defaults if missing
 */
export function loadFromLocalStorage(): NexusMemory {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return { ...defaultMemory }
    }

    const parsed = JSON.parse(stored)

    // Merge with defaults to ensure all fields exist
    return {
      conversationHistory: parsed.conversationHistory || [],
      userProfile: {
        ...defaultUserProfile,
        ...parsed.userProfile
      },
      projectContext: {
        ...defaultMemory.projectContext,
        ...parsed.projectContext
      },
      seedKnowledge: {
        ...defaultMemory.seedKnowledge,
        ...parsed.seedKnowledge
      },
      lastSyncedAt: parsed.lastSyncedAt || 0
    }
  } catch (error) {
    console.error('Failed to load memory from localStorage:', error)
    return { ...defaultMemory }
  }
}

/**
 * Upserts to Supabase app_state table (fire and forget)
 */
export function syncToSupabase(): void {
  // Fire and forget - don't block
  ;(async () => {
    try {
      const now = Date.now()
      memory.lastSyncedAt = now

      const { error } = await supabase
        .from('app_state')
        .upsert(
          {
            state_key: 'nexus_memory',
            state_value: memory,
            updated_at: new Date().toISOString()
          },
          {
            onConflict: 'state_key'
          }
        )
        .select()

      if (error) {
        console.error('Failed to sync memory to Supabase:', error)
      }
    } catch (error) {
      console.error('Unexpected error syncing to Supabase:', error)
    }
  })()
}

/**
 * Loads from Supabase, merges with local if local is newer
 */
export function loadFromSupabase(): Promise<NexusMemory | null> {
  return new Promise(async (resolve) => {
    try {
      const { data, error } = await supabase
        .from('app_state')
        .select('state_value, updated_at')
        .eq('state_key', 'nexus_memory')
        .single()

      if (error) {
        console.warn('Failed to load memory from Supabase:', error)
        resolve(null)
        return
      }

      if (!data || !data.state_value) {
        resolve(null)
        return
      }

      const remoteMemory = data.state_value as NexusMemory
      const remoteTimestamp = new Date(data.updated_at).getTime()

      // If local is newer, keep local
      if (memory.lastSyncedAt > remoteTimestamp) {
        resolve(memory)
        return
      }

      // Merge remote with local defaults
      const merged: NexusMemory = {
        conversationHistory: remoteMemory.conversationHistory || [],
        userProfile: {
          ...defaultUserProfile,
          ...remoteMemory.userProfile
        },
        projectContext: {
          ...defaultMemory.projectContext,
          ...remoteMemory.projectContext
        },
        seedKnowledge: {
          ...defaultMemory.seedKnowledge,
          ...remoteMemory.seedKnowledge
        },
        lastSyncedAt: remoteTimestamp
      }

      memory = merged
      saveToLocalStorage()
      resolve(merged)
    } catch (error) {
      console.error('Unexpected error loading from Supabase:', error)
      resolve(null)
    }
  })
}

/**
 * Compacts memory by summarizing old conversations into domainInsights
 */
export function generateMemorySeed(): void {
  const now = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000
  const cutoffTime = now - oneDayMs

  // Find turns older than 24 hours
  const oldTurns = memory.conversationHistory.filter(
    (turn) => turn.timestamp < cutoffTime
  )

  if (oldTurns.length === 0) {
    return
  }

  // Extract key topics from old conversations
  const topics = new Set<string>()
  oldTurns.forEach((turn) => {
    if (turn.role === 'user') {
      const keywords = extractKeywords(turn.content)
      keywords.forEach((kw) => topics.add(kw))
    }
  })

  // Create domain insights from aggregated topics
  const newInsights = Array.from(topics)
    .slice(0, 5)
    .map((topic) => `Previous discussion on: ${topic}`)

  // Add to domainInsights
  memory.seedKnowledge.domainInsights.unshift(...newInsights)

  // Remove old turns
  memory.conversationHistory = memory.conversationHistory.filter(
    (turn) => turn.timestamp >= cutoffTime
  )

  saveToLocalStorage()
}

/**
 * Returns current in-memory state
 */
export function getMemory(): NexusMemory {
  return memory
}

/**
 * Called on app startup: load from localStorage first, then Supabase
 */
export async function initializeMemory(): Promise<void> {
  // Load from localStorage first
  const local = loadFromLocalStorage()
  memory = local

  // Try to load from Supabase and merge
  const remote = await loadFromSupabase()
  if (remote) {
    memory = remote
  }
}
