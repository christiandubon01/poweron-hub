/**
 * OnboardingService.ts
 * V4-OB1 — AI-human mutual interview onboarding service.
 *
 * Handles:
 *   - Running the conversational onboarding interview through Claude
 *   - Configuring the platform based on interview analysis
 *   - Checking and retrieving onboarding state from Supabase
 */

import { callClaude } from '@/services/claudeProxy'
import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export type BusinessType =
  | 'electrical'
  | 'plumbing'
  | 'general_contractor'
  | 'solar'
  | 'hvac'
  | 'other'

export interface OnboardingResponses {
  aiName: string
  businessType: BusinessType
  teamSize: string
  jobTypes: string
  typicalJobSize: string
  trackingMethod: string
  biggestHeadache: string
  followUpAnswers: Record<string, string>
}

export interface OnboardingAnalysis {
  summary: string
  industryTemplate: BusinessType
  recommendedAgents: string[]
  systemPromptContext: string
  suggestedDemoData: string
  keyInsights: string[]
}

export interface StoredOnboardingData {
  id?: string
  user_id: string
  ai_name: string
  business_type: BusinessType
  responses: OnboardingResponses
  analysis: OnboardingAnalysis
  completed_at: string
  created_at?: string
}

// ── Industry templates ───────────────────────────────────────────────────────

const INDUSTRY_AGENT_MAP: Record<BusinessType, string[]> = {
  electrical: ['NEXUS', 'OHM', 'VAULT', 'LEDGER', 'BLUEPRINT', 'SPARK', 'CHRONO', 'PULSE'],
  solar:      ['NEXUS', 'VAULT', 'LEDGER', 'SPARK', 'CHRONO', 'ATLAS', 'PULSE'],
  plumbing:   ['NEXUS', 'VAULT', 'LEDGER', 'BLUEPRINT', 'SPARK', 'CHRONO'],
  hvac:       ['NEXUS', 'VAULT', 'LEDGER', 'BLUEPRINT', 'SPARK', 'CHRONO'],
  general_contractor: ['NEXUS', 'BLUEPRINT', 'VAULT', 'LEDGER', 'CHRONO', 'PULSE', 'ATLAS'],
  other:      ['NEXUS', 'VAULT', 'LEDGER', 'SPARK', 'CHRONO'],
}

// ── System prompt builder ────────────────────────────────────────────────────

function buildInterviewSystemPrompt(): string {
  return `You are the PowerOn Hub onboarding AI. You are analyzing a new user's business interview responses to configure their platform.

You will receive structured interview answers and must return a JSON object with this exact shape:
{
  "summary": "2-3 sentence plain-language summary of what you learned about this business",
  "industryTemplate": "electrical|plumbing|general_contractor|solar|hvac|other",
  "recommendedAgents": ["NEXUS", "VAULT", ...],
  "systemPromptContext": "A paragraph that will be injected into NEXUS system prompts to give the AI context about this specific business. Write in second person to NEXUS, e.g. 'This user runs a 3-person electrical contracting company...'",
  "suggestedDemoData": "electrical_contractor_3_person|solar_installer|gc_mid_size|hvac_service|generic_contractor",
  "keyInsights": ["insight 1", "insight 2", "insight 3"]
}

Be concise. Return ONLY the JSON object, no markdown, no explanation.`
}

// ── Core functions ───────────────────────────────────────────────────────────

/**
 * Sends the collected interview responses to Claude for analysis.
 * Returns a structured OnboardingAnalysis.
 */
export async function runOnboardingInterview(
  responses: OnboardingResponses
): Promise<OnboardingAnalysis> {
  const prompt = `Analyze these business onboarding responses and return a JSON configuration object.

AI Name chosen: ${responses.aiName}
Business type selected: ${responses.businessType}
Team size: ${responses.teamSize}
Job types: ${responses.jobTypes}
Typical job size: ${responses.typicalJobSize}
Current tracking method: ${responses.trackingMethod}
Biggest operational headache: ${responses.biggestHeadache}
Additional follow-up answers: ${JSON.stringify(responses.followUpAnswers, null, 2)}`

  try {
    const result = await callClaude({
      messages: [{ role: 'user', content: prompt }],
      system: buildInterviewSystemPrompt(),
      max_tokens: 1024,
    })

    const text = result.content?.[0]?.text ?? ''

    // Parse the JSON response from Claude
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Claude did not return valid JSON')
    }

    const parsed = JSON.parse(jsonMatch[0]) as OnboardingAnalysis

    // Ensure recommendedAgents is always populated
    if (!parsed.recommendedAgents || parsed.recommendedAgents.length === 0) {
      parsed.recommendedAgents = INDUSTRY_AGENT_MAP[responses.businessType] ?? INDUSTRY_AGENT_MAP.other
    }

    return parsed
  } catch (err) {
    console.error('[OnboardingService] Interview analysis failed:', err)

    // Graceful fallback — return sensible defaults
    return {
      summary: `Welcome! You've configured PowerOn Hub for your ${responses.businessType} business with ${responses.teamSize} team members.`,
      industryTemplate: responses.businessType,
      recommendedAgents: INDUSTRY_AGENT_MAP[responses.businessType] ?? INDUSTRY_AGENT_MAP.other,
      systemPromptContext: `This user operates a ${responses.businessType} contracting business with ${responses.teamSize} people. They typically handle ${responses.jobTypes} jobs in the ${responses.typicalJobSize} range. Their biggest operational challenge is: ${responses.biggestHeadache}.`,
      suggestedDemoData: responses.businessType === 'electrical' ? 'electrical_contractor_3_person' : 'generic_contractor',
      keyInsights: [
        `${responses.businessType} contractor with ${responses.teamSize} team members`,
        `Focuses on ${responses.jobTypes}`,
        `Current pain point: ${responses.biggestHeadache}`,
      ],
    }
  }
}

/**
 * Configures the platform based on the completed onboarding analysis.
 * Sets industry template, activates agents, and updates NEXUS system prompt.
 */
export async function configureFromOnboarding(
  userId: string,
  analysis: OnboardingAnalysis
): Promise<void> {
  try {
    // Store the platform configuration in user_preferences
    const { error } = await supabase
      .from('user_preferences' as never)
      .upsert(
        {
          user_id: userId,
          onboarding_industry_template: analysis.industryTemplate,
          onboarding_active_agents: analysis.recommendedAgents,
          onboarding_nexus_context: analysis.systemPromptContext,
          onboarding_demo_data_key: analysis.suggestedDemoData,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: 'user_id' }
      )

    if (error) {
      console.error('[OnboardingService] Failed to save platform config:', error)
    }
  } catch (err) {
    console.error('[OnboardingService] configureFromOnboarding error:', err)
  }
}

/**
 * Checks whether the user has completed onboarding.
 * Returns true if the user_onboarding record exists with a completed_at timestamp.
 */
export async function isOnboardingComplete(userId: string): Promise<boolean> {
  if (!userId) return false

  try {
    const { data, error } = await supabase
      .from('user_onboarding' as never)
      .select('completed_at')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      // Table may not exist yet in all environments — treat as not complete
      console.warn('[OnboardingService] Could not check onboarding status:', error.message)
      return false
    }

    const row = data as { completed_at?: string | null } | null
    return !!(row?.completed_at)
  } catch (err) {
    console.warn('[OnboardingService] isOnboardingComplete error:', err)
    return false
  }
}

/**
 * Retrieves stored onboarding data for a user.
 * Returns null if not found or if an error occurs.
 */
export async function getOnboardingData(userId: string): Promise<StoredOnboardingData | null> {
  if (!userId) return null

  try {
    const { data, error } = await supabase
      .from('user_onboarding' as never)
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      console.warn('[OnboardingService] Could not retrieve onboarding data:', error.message)
      return null
    }

    return data as StoredOnboardingData | null
  } catch (err) {
    console.warn('[OnboardingService] getOnboardingData error:', err)
    return null
  }
}

/**
 * Saves the completed onboarding data to Supabase user_onboarding table.
 */
export async function saveOnboardingData(data: StoredOnboardingData): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('user_onboarding' as never)
      .upsert(
        {
          user_id: data.user_id,
          ai_name: data.ai_name,
          business_type: data.business_type,
          responses: data.responses as unknown as Record<string, unknown>,
          analysis: data.analysis as unknown as Record<string, unknown>,
          completed_at: data.completed_at,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: 'user_id' }
      )

    if (error) {
      console.error('[OnboardingService] Failed to save onboarding data:', error)
      return false
    }

    return true
  } catch (err) {
    console.error('[OnboardingService] saveOnboardingData error:', err)
    return false
  }
}
