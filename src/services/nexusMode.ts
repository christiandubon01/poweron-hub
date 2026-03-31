// @ts-nocheck
/**
 * NEXUS Mode Service
 *
 * Manages the active response mode for the NEXUS agent.
 * Owner-only feature — crew members never see or change this.
 *
 * Modes control NEXUS's response style, bullet count, and coaching behavior.
 * Active mode is persisted in localStorage and broadcast via a custom event
 * so all components can react in real time.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type NexusAgentMode =
  | 'proactive'
  | 'analytical'
  | 'coaching'
  | 'conversational'
  | 'carplay'

export interface ModeConfig {
  name: string
  description: string
  responseStyle: string
  maxBullets: number
  askConsequences: boolean
  voiceOptimized: boolean
  systemPromptAddition: string
}

// ── Mode Configurations ───────────────────────────────────────────────────────

export const MODE_CONFIGS: Record<NexusAgentMode, ModeConfig> = {
  proactive: {
    name: 'Proactive',
    description: 'Suggests actions, flags risks',
    responseStyle: 'proactive',
    maxBullets: 5,
    askConsequences: false,
    voiceOptimized: false,
    systemPromptAddition: `You are in PROACTIVE mode.
      Anticipate what the user needs next. After
      answering, always suggest 1-2 next actions.
      Flag risks before they are asked about.`,
  },
  analytical: {
    name: 'Analytical',
    description: 'Numbers, scenarios, breakdowns',
    responseStyle: 'analytical',
    maxBullets: 8,
    askConsequences: false,
    voiceOptimized: false,
    systemPromptAddition: `You are in ANALYTICAL mode.
      Lead with data. Show calculations. Present
      multiple scenarios with pros and cons.
      Never give opinions without numbers to back
      them up.`,
  },
  coaching: {
    name: 'Coaching',
    description: 'Meeting prep, communication, skill development',
    responseStyle: 'coaching',
    maxBullets: 5,
    askConsequences: true,
    voiceOptimized: false,
    systemPromptAddition: `You are in COACHING mode.
      When giving advice, always present the data
      and consequences first, then ask what the
      user wants to do. Never tell the user what
      to do — present options and outcomes. Help
      them think through communication strategy,
      professional presentation, and skill gaps.
      Show the math behind every recommendation.`,
  },
  conversational: {
    name: 'Conversational',
    description: 'Open dialogue, broad questions',
    responseStyle: 'conversational',
    maxBullets: 3,
    askConsequences: false,
    voiceOptimized: false,
    systemPromptAddition: `You are in CONVERSATIONAL
      mode. Be direct and natural. Answer broad
      questions about business strategy, revenue,
      personal development. Keep responses concise.
      Ask follow-up questions to go deeper.`,
  },
  carplay: {
    name: 'CarPlay',
    description: 'Driving — short, voice-optimized',
    responseStyle: 'carplay',
    maxBullets: 2,
    askConsequences: false,
    voiceOptimized: true,
    systemPromptAddition: `You are in CARPLAY mode.
      The user is driving. Keep ALL responses under
      3 sentences. No bullet points. No lists.
      Speak naturally as if in a conversation.
      Prioritize safety — never ask for visual
      attention. If a question needs a long answer,
      say "I'll save that for when you're parked."`,
  },
}

// ── Storage key ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'nexus_active_mode'

// ── Public Functions ──────────────────────────────────────────────────────────

/**
 * Returns the currently active NEXUS mode.
 * Defaults to 'conversational' if nothing is stored or the stored value is invalid.
 */
export function getActiveMode(): NexusAgentMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && (stored as NexusAgentMode) in MODE_CONFIGS) {
      return stored as NexusAgentMode
    }
  } catch {
    // localStorage may be unavailable (e.g. private browsing with restrictions)
  }
  return 'conversational'
}

/**
 * Saves the given mode to localStorage and dispatches a 'nexus:mode-changed'
 * custom event so any listening component can update reactively.
 */
export function setActiveMode(mode: NexusAgentMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
    window.dispatchEvent(new CustomEvent('nexus:mode-changed', { detail: mode }))
  } catch {
    // Non-critical
  }
}

/**
 * Returns the full ModeConfig for the currently active mode.
 */
export function getModeConfig(): ModeConfig {
  return MODE_CONFIGS[getActiveMode()]
}
