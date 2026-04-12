/**
 * HUNTER Follow-Up Sequencer Service
 *
 * Auto-generates and schedules follow-up sequences for leads using Claude API.
 * Implements a 4-step follow-up sequence:
 * - Day 3: Initial follow-up with context-aware message
 * - Day 7: Value-add (tip, news, or project photo)
 * - Day 14: Direct meeting ask
 * - Day 30: Final re-engagement check
 */

import { callClaude, extractText, type ClaudeRequest, type ClaudeResponse } from '@/services/claudeProxy'

export type FollowUpSequenceStep = 'day3' | 'day7' | 'day14' | 'day30'

export enum FollowUpType {
  INITIAL_FOLLOWUP = 'initial_followup',
  VALUE_ADD = 'value_add',
  DIRECT_ASK = 'direct_ask',
  FINAL_REACH = 'final_reach',
}

export interface FollowUpTemplate {
  id: string
  leadId: string
  type: FollowUpType
  scheduledDate: string // ISO date
  dueDate: string // ISO date
  message: string
  status: 'pending' | 'sent' | 'skipped' | 'completed'
  outcome?: string
  createdAt: string
  completedAt?: string
}

export interface LeadContext {
  leadId: string
  name: string
  company?: string
  email?: string
  phone?: string
  initialMessage?: string
  jobType?: string
  estimatedValue?: number
  source?: string
  lastContactDate?: string
  pitchAngles?: string[] // HUNTER pitch angles
}

export interface GeneratedFollowUp {
  type: FollowUpType
  message: string
  daysFromNow: number
  scheduledDate: string
}

/**
 * FollowUpSequencer: Service for auto-generating personalized follow-ups
 */
export class FollowUpSequencer {
  /**
   * Generate a personalized follow-up message using Claude API
   * Uses lead context to create contextual, relevant messages
   */
  static async generateFollowUp(leadContext: LeadContext, sequenceStep: FollowUpSequenceStep): Promise<GeneratedFollowUp> {
    const stepConfig = this.getStepConfig(sequenceStep)
    const systemPrompt = this.buildSystemPrompt(leadContext)
    const userPrompt = this.buildUserPrompt(leadContext, sequenceStep, stepConfig)

    const request: ClaudeRequest = {
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
      max_tokens: 300,
      model: 'claude-sonnet-4-20250514',
    }

    try {
      const response = await callClaude(request)
      const message = extractText(response)

      return {
        type: stepConfig.type,
        message: message.trim(),
        daysFromNow: stepConfig.daysFromNow,
        scheduledDate: this.addDays(new Date(), stepConfig.daysFromNow).toISOString().split('T')[0],
      }
    } catch (error) {
      console.error('[FollowUpSequencer] Claude error:', error)
      // Fallback to template message
      return {
        type: stepConfig.type,
        message: this.getDefaultTemplate(sequenceStep, leadContext),
        daysFromNow: stepConfig.daysFromNow,
        scheduledDate: this.addDays(new Date(), stepConfig.daysFromNow).toISOString().split('T')[0],
      }
    }
  }

  /**
   * Schedule a follow-up reminder for a lead
   */
  static async scheduleFollowUp(leadId: string, followUp: GeneratedFollowUp): Promise<FollowUpTemplate> {
    const followUpTemplate: FollowUpTemplate = {
      id: `followup_${leadId}_${Date.now()}`,
      leadId,
      type: followUp.type,
      scheduledDate: followUp.scheduledDate,
      dueDate: followUp.scheduledDate,
      message: followUp.message,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }

    // In a real implementation, persist to Supabase
    // For now, return the template object
    return followUpTemplate
  }

  /**
   * Get all follow-ups that are overdue (past their due date)
   */
  static getOverdueFollowUps(followUps: FollowUpTemplate[]): FollowUpTemplate[] {
    const today = new Date().toISOString().split('T')[0]
    return followUps.filter(fu => fu.status === 'pending' && fu.dueDate < today)
  }

  /**
   * Mark a follow-up as complete with optional outcome
   */
  static completeFollowUp(followUp: FollowUpTemplate, outcome?: string): FollowUpTemplate {
    return {
      ...followUp,
      status: 'completed',
      outcome,
      completedAt: new Date().toISOString(),
    }
  }

  /**
   * Get step configuration by sequence step
   */
  private static getStepConfig(
    step: FollowUpSequenceStep
  ): { type: FollowUpType; daysFromNow: number; description: string } {
    const configs: Record<FollowUpSequenceStep, { type: FollowUpType; daysFromNow: number; description: string }> = {
      day3: {
        type: FollowUpType.INITIAL_FOLLOWUP,
        daysFromNow: 3,
        description: 'Following up on our conversation...',
      },
      day7: {
        type: FollowUpType.VALUE_ADD,
        daysFromNow: 7,
        description: 'Value-add follow-up with relevant tip, news, or project info',
      },
      day14: {
        type: FollowUpType.DIRECT_ASK,
        daysFromNow: 14,
        description: 'Direct ask for a meeting or conversation',
      },
      day30: {
        type: FollowUpType.FINAL_REACH,
        daysFromNow: 30,
        description: 'Final re-engagement check before archiving',
      },
    }
    return configs[step]
  }

  /**
   * Build system prompt for Claude
   */
  private static buildSystemPrompt(leadContext: LeadContext): string {
    return `You are an expert sales follow-up writer for an electrical contracting company.
Your job is to write personalized, professional follow-up messages that:
1. Are brief (1-3 sentences for email/SMS)
2. Reference specific context from the initial conversation when possible
3. Feel natural and personal, not templated
4. Focus on value and relevance to the prospect
5. Include a clear call-to-action when appropriate

Company: Power On Solutions, LLC (electrical contractor)
Prospect: ${leadContext.name}${leadContext.company ? ` at ${leadContext.company}` : ''}

Key HUNTER pitch angles to potentially reference: ${(leadContext.pitchAngles || []).join(', ') || 'opportunity, value'}

Write ONLY the follow-up message, nothing else.`
  }

  /**
   * Build user prompt based on sequence step
   */
  private static buildUserPrompt(leadContext: LeadContext, step: FollowUpSequenceStep, stepConfig: any): string {
    const baseContext = `
Lead: ${leadContext.name}
Company: ${leadContext.company || 'Unknown'}
Job Type: ${leadContext.jobType || 'Electrical work'}
Estimated Value: ${leadContext.estimatedValue ? `$${leadContext.estimatedValue}` : 'Not specified'}
Source: ${leadContext.source || 'Unknown'}
Initial Message Context: ${leadContext.initialMessage || 'No prior context'}
Last Contact: ${leadContext.lastContactDate || 'Just contacted'}
`

    const stepPrompts: Record<FollowUpSequenceStep, string> = {
      day3: `Write a 2-sentence follow-up message checking in on our initial conversation. 
Tone: Professional and helpful, not pushy. Reference something from the initial conversation if possible.
Context: ${baseContext}`,

      day7: `Write a 3-sentence value-add follow-up. Share a relevant tip about electrical work, an industry article, 
or mention a similar project you recently completed that might be relevant.
Make it genuinely helpful, not a disguised sales pitch.
Context: ${baseContext}`,

      day14: `Write a 2-sentence message directly asking for a 15-minute call or meeting to discuss their project needs.
Be confident but respectful - they know you're following up for a reason.
Context: ${baseContext}`,

      day30: `Write a 2-sentence final check-in message. Acknowledge that you've followed up a few times and ask if now is a good time 
to chat, or if they want to reconnect later.
Tone: Professional, not desperate. Leave the door open.
Context: ${baseContext}`,
    }

    return stepPrompts[step]
  }

  /**
   * Get default fallback template
   */
  private static getDefaultTemplate(step: FollowUpSequenceStep, leadContext: LeadContext): string {
    const name = leadContext.name || 'there'
    const company = leadContext.company ? ` at ${leadContext.company}` : ''

    const templates: Record<FollowUpSequenceStep, string> = {
      day3: `Hi ${name}, wanted to check in on our conversation. Let me know if you have any questions!`,

      day7: `Hi ${name}, I came across an industry article that might be relevant to your project. Would love to share it with you.`,

      day14: `Hi ${name}, I'd love to schedule a brief 15-minute call to discuss your electrical project needs in more detail. When works best?`,

      day30: `Hi ${name}, just checking in one more time. If the timing isn't right now, I'd be happy to reconnect in a few weeks.`,
    }

    return templates[step]
  }

  /**
   * Utility: Add days to a date
   */
  private static addDays(date: Date, days: number): Date {
    const result = new Date(date)
    result.setDate(result.getDate() + days)
    return result
  }
}

export default FollowUpSequencer
