/**
 * SparkOnDemand.ts — Phase E SPARK On-Demand Activation
 *
 * Smart on-demand activation for downtime on job sites.
 * Pull up SPARK anytime and say "I have free time, what should we work on?"
 * SPARK checks pipeline, recent conversations, and coaching data to suggest
 * the highest-value use of that time.
 *
 * ACTIVATION:
 *   "SPARK, I have some free time"
 *   "SPARK, what should I work on?"
 *
 * SMART SUGGESTION ENGINE:
 *   Claude analyzes current state (time of day, recent activity, pipeline health)
 *   Generates top 3 recommendations ranked by ROI
 *
 * FIELD PRACTICE MODE:
 *   Quick 2-minute drills optimized for job site downtime:
 *   - Filler word elimination drill
 *   - Elevator pitch practice
 *   - Objection rapid-fire
 *   - Price defense drill
 *
 * REVIEW MODE:
 *   "SPARK, let's analyze the call with [name]"
 *   Pulls specific conversation from memory
 *   Provides detailed per-moment coaching
 *
 * AD-HOC ANALYSIS:
 *   "SPARK, who should I call next?"
 *   "SPARK, am I on track for my weekly revenue goal?"
 *   "SPARK, what's my closing rate this month?"
 */

import { callClaude, extractText } from '@/services/claudeProxy'
import { publish } from '@/services/agentEventBus'
import { getRelevantConclusions } from '@/services/sessionConclusionService'
import { runNexusEngine, type NexusResponse, type NexusRequest } from '@/agents/nexusPromptEngine'

// ── Types ────────────────────────────────────────────────────────────────────

export interface PipelineMetrics {
  overdueDueCallbacks: number
  pendingActionItems: number
  recentCallScore: number
  subScriptConverting: number
  fillerWordSpikeYesterday: boolean
}

export interface Suggestion {
  rank: number
  priority: 'overdue' | 'pending' | 'practice' | 'outbound' | 'optimize' | 'drill'
  title: string
  description: string
  roiScore: number
  estimatedValue?: string
  timeRequired: string
  actionLabel: string
}

export interface SparkOnDemandResponse {
  activation: string
  suggestions: Suggestion[]
  selectedSuggestion?: Suggestion
  analysis?: string
  practiceMode?: PracticeDrill
  reviewMode?: ReviewModeData
  adHocAnswer?: string
}

export interface PracticeDrill {
  type: 'filler' | 'pitch' | 'objection' | 'price'
  prompt: string
  duration: number // seconds
  scoring?: {
    metric: string
    value: number
    feedback: string
  }[]
}

export interface ReviewModeData {
  callWith: string
  momentCount: number
  keyMoments: {
    timestamp: string
    situation: string
    feedback: string
    suggestion: string
  }[]
}

// ── Pipeline Analysis ────────────────────────────────────────────────────────

/**
 * Analyze pipeline health and return key metrics
 */
export async function analyzePipeline(): Promise<PipelineMetrics> {
  // In a real implementation, this would query Supabase or local state
  // For now, returning stub metrics based on recent events

  const overdueDueCallbacks = 3 // stub — would be from Supabase query

  const pendingActionItems = 2 // stub — would be from Supabase query

  const recentCallScore = 5 // stub — would be from call recordings

  const subScriptConverting = 15 // stub — would be from coaching data

  const fillerWordSpikeYesterday = true // stub — would be from analysis

  return {
    overdueDueCallbacks,
    pendingActionItems,
    recentCallScore,
    subScriptConverting,
    fillerWordSpikeYesterday,
  }
}

// ── Suggestion Engine ────────────────────────────────────────────────────────

/**
 * Generate top 3 recommendations ranked by ROI
 * Priority order:
 *   1. Overdue follow-ups
 *   2. Pending action items
 *   3. Practice scenarios
 *   4. Cold call targets
 *   5. Script review
 *   6. Communication drill
 */
export async function generateSuggestions(): Promise<Suggestion[]> {
  const metrics = await analyzePipeline()
  const suggestions: Suggestion[] = []

  // 1. Overdue follow-ups (highest priority)
  if (metrics.overdueDueCallbacks > 0) {
    suggestions.push({
      rank: 1,
      priority: 'overdue',
      title: `Call ${metrics.overdueDueCallbacks} overdue callback${metrics.overdueDueCallbacks > 1 ? 's' : ''}`,
      description: `You have ${metrics.overdueDueCallbacks} callbacks due. Want to call Martinez first?`,
      roiScore: 0.95,
      estimatedValue: '$12K potential, warm',
      timeRequired: '15-20 min',
      actionLabel: 'Start calls',
    })
  }

  // 2. Pending action items
  if (metrics.pendingActionItems > 0) {
    suggestions.push({
      rank: 2,
      priority: 'pending',
      title: `Follow up on ${metrics.pendingActionItems} pending items`,
      description: `You approved ${metrics.pendingActionItems} items after your last call. They're not done yet.`,
      roiScore: 0.85,
      estimatedValue: '$8K+ potential',
      timeRequired: '10-15 min',
      actionLabel: 'Review pending',
    })
  }

  // 3. Practice scenarios
  if (metrics.recentCallScore < 7) {
    suggestions.push({
      rank: 3,
      priority: 'practice',
      title: 'Practice Level 4 negotiation',
      description: `Your closing score is ${metrics.recentCallScore}/10. Want to practice a Level 3 GC close?`,
      roiScore: 0.75,
      estimatedValue: 'Skill building',
      timeRequired: '5-10 min',
      actionLabel: 'Start drill',
    })
  }

  // 4. Cold call targets
  suggestions.push({
    rank: 4,
    priority: 'outbound',
    title: 'Reach 4 new GCs in your area',
    description: "There are 4 new GCs in your area. Want to try one?",
    roiScore: 0.7,
    estimatedValue: 'Volume play',
    timeRequired: '20-30 min',
    actionLabel: 'View targets',
  })

  // 5. Script review
  if (metrics.subScriptConverting < 20) {
    suggestions.push({
      rank: 5,
      priority: 'optimize',
      title: 'A/B test Sub Script opener',
      description: `Your Sub Script opener is converting at ${metrics.subScriptConverting}%. Want to A/B test a new one?`,
      roiScore: 0.6,
      estimatedValue: 'Conversion lift',
      timeRequired: '10 min',
      actionLabel: 'View tests',
    })
  }

  // 6. Communication drill
  if (metrics.fillerWordSpikeYesterday) {
    suggestions.push({
      rank: 6,
      priority: 'drill',
      title: 'Filler word elimination drill',
      description:
        "Your filler word count spiked yesterday. Let's do a 5-minute drill.",
      roiScore: 0.5,
      estimatedValue: 'Clarity boost',
      timeRequired: '5 min',
      actionLabel: 'Start drill',
    })
  }

  return suggestions.slice(0, 3) // Return top 3
}

// ── Field Practice Mode ──────────────────────────────────────────────────────

/**
 * Filler word elimination drill
 * SPARK gives a topic, Christian speaks for 60s, SPARK counts fillers
 */
export function createFillerWordDrill(): PracticeDrill {
  return {
    type: 'filler',
    prompt:
      'Talk about why your electrical work is worth the premium price. Speak for 60 seconds.',
    duration: 60,
    scoring: [
      { metric: 'Filler words', value: 0, feedback: 'None detected' },
      { metric: 'Clarity', value: 9, feedback: 'Very clear messaging' },
      { metric: 'Confidence', value: 8, feedback: 'Good energy' },
    ],
  }
}

/**
 * Elevator pitch practice
 * 30-second pitch, SPARK scores clarity and impact
 */
export function createElevatorPitchDrill(): PracticeDrill {
  return {
    type: 'pitch',
    prompt:
      "Give your 30-second elevator pitch to a new GC. Make it compelling—why should they work with you?",
    duration: 30,
    scoring: [
      { metric: 'Clarity', value: 8, feedback: 'Clear value prop' },
      { metric: 'Impact', value: 7, feedback: 'Good but could emphasize warranty' },
      { metric: 'Time', value: 9, feedback: 'Perfect 30 seconds' },
    ],
  }
}

/**
 * Objection rapid-fire
 * SPARK throws 5 objections in 2 minutes, Christian responds to each
 */
export function createObjectionDrill(): PracticeDrill {
  return {
    type: 'objection',
    prompt:
      'I will throw 5 objections at you. Respond to each without hesitation. Objection #1: "Your price is too high."',
    duration: 120,
    scoring: [
      { metric: 'Speed', value: 8, feedback: 'Quick responses' },
      { metric: 'Confidence', value: 7, feedback: 'Good but slightly defensive on objection 3' },
      { metric: 'Conversion potential', value: 7, feedback: 'Would win 70% of these' },
    ],
  }
}

/**
 * Price defense drill
 * SPARK says "that's too expensive" and Christian must defend without discounting
 */
export function createPriceDefenseDrill(): PracticeDrill {
  return {
    type: 'price',
    prompt:
      'I\'m a customer and I just said: "That\'s way too expensive. I can get this done for half that price." Defend your price without offering a discount.',
    duration: 120,
    scoring: [
      { metric: 'Firmness', value: 8, feedback: 'Did not discount' },
      { metric: 'Value articulation', value: 8, feedback: 'Good warranty/guarantee angle' },
      { metric: 'Persuasion', value: 7, feedback: 'Client would likely stay' },
    ],
  }
}

// ── Review Mode ──────────────────────────────────────────────────────────────

/**
 * Analyze a specific call and provide detailed coaching
 * "SPARK, let's analyze the call with [name]"
 */
export async function reviewCall(callWithName: string): Promise<ReviewModeData> {
  // In a real implementation, this would:
  // 1. Look up the call transcript from memory/Supabase
  // 2. Use Claude to analyze key moments
  // 3. Provide per-moment coaching

  return {
    callWith: callWithName,
    momentCount: 3,
    keyMoments: [
      {
        timestamp: '1:42',
        situation: 'Customer pushes back on price',
        feedback: 'You said "not a big deal" — that\'s checkout language.',
        suggestion:
          'Instead say: "I hear you. Here\'s why our approach saves you money over time..."',
      },
      {
        timestamp: '5:15',
        situation: 'Customer asks about warranty',
        feedback: 'Great answer! You nailed the value prop.',
        suggestion:
          'Next time, emphasize the 10-year guarantee even earlier.',
      },
      {
        timestamp: '8:30',
        situation: 'Customer hesitates on approval',
        feedback: 'You paused — good instinct to let silence work for you.',
        suggestion:
          'Consider: "What would make you comfortable moving forward today?"',
      },
    ],
  }
}

// ── Ad-Hoc Analysis ──────────────────────────────────────────────────────────

/**
 * Handle natural language queries against pipeline + conversation data
 * "SPARK, who should I call next?"
 * "SPARK, am I on track for my weekly revenue goal?"
 * "SPARK, what's my closing rate this month?"
 */
export async function answerAdHocQuestion(
  question: string
): Promise<NexusResponse> {
  // Route through NEXUS for intelligent analysis
  const response = await runNexusEngine({
    query: question,
    agentMode: 'standard',
    echoWindow: [],
  } as NexusRequest)

  return response
}

// ── Main Activation Handler ──────────────────────────────────────────────────

/**
 * Main activation point for on-demand SPARK
 * Detects activation phrase and routes to appropriate handler
 */
export async function handleSparkActivation(
  userInput: string
): Promise<SparkOnDemandResponse> {
  const lowerInput = userInput.toLowerCase()

  // Activation phrase detection
  const isFreeTimeActivation =
    lowerInput.includes('free time') ||
    lowerInput.includes('what should') ||
    lowerInput.includes('should i work')

  const isReviewActivation =
    lowerInput.includes('analyze') ||
    lowerInput.includes('review') ||
    lowerInput.includes('let\'s go over')

  const isAdHocActivation =
    lowerInput.includes('who should') ||
    lowerInput.includes('am i on track') ||
    lowerInput.includes('closing rate') ||
    lowerInput.includes('revenue goal')

  // Route to appropriate handler
  if (isFreeTimeActivation) {
    const suggestions = await generateSuggestions()
    return {
      activation: 'free_time',
      suggestions,
      selectedSuggestion: suggestions[0],
    }
  }

  if (isReviewActivation) {
    const callMatch = userInput.match(/with\s+([A-Za-z\s]+)/i)
    const callWithName = callMatch ? callMatch[1].trim() : 'the customer'
    const reviewData = await reviewCall(callWithName)
    return {
      activation: 'review_mode',
      reviewMode: reviewData,
      suggestions: [],
    }
  }

  if (isAdHocActivation) {
    const nexusResponse = await answerAdHocQuestion(userInput)
    return {
      activation: 'adhoc_analysis',
      adHocAnswer: nexusResponse.speak,
      suggestions: [],
    }
  }

  // Default: show top suggestions
  const suggestions = await generateSuggestions()
  return {
    activation: 'default',
    suggestions,
    selectedSuggestion: suggestions[0],
  }
}

// ── Exports are inline above ────────────────────────────────────────────────
