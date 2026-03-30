/**
 * Voice Command Executor
 *
 * Executes classified voice commands by delegating to the appropriate
 * PowerOn Hub agent and formatting responses for speech output.
 */

import { supabase } from '@/lib/supabase'
import { callClaude, extractText } from './claudeProxy'

// ── Types ────────────────────────────────────────────────────────────────────

export interface VoiceCommandContext {
  orgId: string
  userId: string
  mode: 'normal' | 'field' | 'push_to_talk'
}

export interface VoiceCommandResult {
  success: boolean
  responseText: string         // Human-readable response for TTS
  data?: unknown               // Raw data from agent
  agent: string
  intent: string
  executionTimeMs: number
}

// ── Implementation ───────────────────────────────────────────────────────────

export class VoiceCommandExecutor {
  /**
   * Execute a classified voice command and return a speakable response.
   */
  async execute(
    agent: string,
    intent: string,
    parameters: Record<string, unknown>,
    context: VoiceCommandContext
  ): Promise<VoiceCommandResult> {
    const startTime = Date.now()

    try {
      let responseText: string
      let data: unknown = null

      switch (agent.toLowerCase()) {
        case 'spark':
          ({ responseText, data } = await this.executeSPARK(intent, parameters, context))
          break
        case 'chrono':
          ({ responseText, data } = await this.executeCHRONO(intent, parameters, context))
          break
        case 'vault':
          ({ responseText, data } = await this.executeVAULT(intent, parameters, context))
          break
        case 'blueprint':
          ({ responseText, data } = await this.executeBLUEPRINT(intent, parameters, context))
          break
        case 'ledger':
          ({ responseText, data } = await this.executeLEDGER(intent, parameters, context))
          break
        case 'pulse':
          ({ responseText, data } = await this.executePULSE(intent, parameters, context))
          break
        case 'ohm':
          ({ responseText, data } = await this.executeOHM(intent, parameters, context))
          break
        case 'nexus':
        case 'scout':
        default:
          ({ responseText, data } = await this.executeGeneral(agent, intent, parameters, context))
      }

      return {
        success: true,
        responseText,
        data,
        agent,
        intent,
        executionTimeMs: Date.now() - startTime,
      }
    } catch (err) {
      console.error(`[VoiceExecutor] ${agent}/${intent} error:`, err)
      return {
        success: false,
        responseText: 'Sorry, I encountered an error processing that command. Please try again.',
        agent,
        intent,
        executionTimeMs: Date.now() - startTime,
      }
    }
  }

  // ── SPARK (Marketing / Leads) ────────────────────────────────────────────

  private async executeSPARK(
    intent: string,
    params: Record<string, unknown>,
    ctx: VoiceCommandContext
  ): Promise<{ responseText: string; data: unknown }> {
    switch (intent) {
      case 'list_leads': {
        const status = (params.status as string) || undefined
        let query = supabase
          .from('leads' as never)
          .select('*')
          .eq('org_id', ctx.orgId)
          .order('created_at', { ascending: false })
          .limit(10)

        if (status) query = query.eq('status', status)

        const { data, error } = await query
        if (error) throw error

        const leads = (data || []) as any[]
        if (leads.length === 0) {
          return { responseText: 'You don\'t have any leads right now.', data: leads }
        }

        const newCount = leads.filter((l: any) => l.status === 'new').length
        const totalValue = leads.reduce((sum: number, l: any) => sum + (l.estimated_value || 0), 0)

        return {
          responseText: `You have ${leads.length} leads. ${newCount} are new. Total estimated value is $${totalValue.toLocaleString()}.`,
          data: leads,
        }
      }

      case 'list_campaigns': {
        const { data, error } = await supabase
          .from('campaigns' as never)
          .select('*')
          .eq('org_id', ctx.orgId)
          .eq('status', 'active')

        if (error) throw error
        const campaigns = (data || []) as any[]

        return {
          responseText: campaigns.length === 0
            ? 'No active campaigns right now.'
            : `You have ${campaigns.length} active campaign${campaigns.length > 1 ? 's' : ''}. ${campaigns[0]?.name} is the most recent.`,
          data: campaigns,
        }
      }

      case 'list_reviews': {
        const { data, error } = await supabase
          .from('reviews' as never)
          .select('*')
          .eq('org_id', ctx.orgId)
          .is('response_text', null)
          .order('review_date', { ascending: false })
          .limit(5)

        if (error) throw error
        const reviews = (data || []) as any[]

        return {
          responseText: reviews.length === 0
            ? 'All reviews have been responded to.'
            : `You have ${reviews.length} review${reviews.length > 1 ? 's' : ''} waiting for a response.`,
          data: reviews,
        }
      }

      default:
        return { responseText: 'SPARK received your command.', data: null }
    }
  }

  // ── CHRONO (Calendar / Scheduling) ────────────────────────────────────────

  private async executeCHRONO(
    intent: string,
    params: Record<string, unknown>,
    ctx: VoiceCommandContext
  ): Promise<{ responseText: string; data: unknown }> {
    switch (intent) {
      case 'list_events':
      case 'list_today_jobs': {
        const today = new Date()
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString()

        const { data, error } = await supabase
          .from('calendar_events' as never)
          .select('*')
          .eq('org_id', ctx.orgId)
          .gte('start_time', startOfDay)
          .lte('start_time', endOfDay)
          .order('start_time', { ascending: true })

        if (error) throw error
        const events = (data || []) as any[]

        if (events.length === 0) {
          return { responseText: 'You have no events scheduled for today.', data: events }
        }

        const firstEvent = events[0]
        const time = new Date(firstEvent.start_time).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })

        return {
          responseText: `You have ${events.length} event${events.length > 1 ? 's' : ''} today. First up is "${firstEvent.title}" at ${time}.`,
          data: events,
        }
      }

      case 'crew_availability': {
        const today = new Date().toISOString().split('T')[0]

        const { data, error } = await supabase
          .from('crew_availability' as never)
          .select('*')
          .eq('org_id', ctx.orgId)
          .eq('available_date', today)
          .eq('is_available', true)

        if (error) throw error
        const available = (data || []) as any[]

        return {
          responseText: available.length === 0
            ? 'No crew availability records found for today.'
            : `${available.length} crew member${available.length > 1 ? 's are' : ' is'} available today.`,
          data: available,
        }
      }

      case 'list_tasks': {
        const { data, error } = await supabase
          .from('agenda_tasks' as never)
          .select('*')
          .eq('org_id', ctx.orgId)
          .in('status', ['pending', 'in_progress'])
          .order('priority', { ascending: false })
          .limit(5)

        if (error) throw error
        const tasks = (data || []) as any[]

        return {
          responseText: tasks.length === 0
            ? 'No pending tasks on the agenda.'
            : `You have ${tasks.length} pending task${tasks.length > 1 ? 's' : ''}. Top priority: "${tasks[0]?.title}".`,
          data: tasks,
        }
      }

      default:
        return { responseText: 'CHRONO received your command.', data: null }
    }
  }

  // ── VAULT (Estimates / Pricing) ──────────────────────────────────────────

  private async executeVAULT(
    intent: string,
    _params: Record<string, unknown>,
    ctx: VoiceCommandContext
  ): Promise<{ responseText: string; data: unknown }> {
    switch (intent) {
      case 'list_estimates': {
        const { data, error } = await supabase
          .from('estimates' as never)
          .select('*')
          .eq('org_id', ctx.orgId)
          .order('created_at', { ascending: false })
          .limit(5)

        if (error) throw error
        const estimates = (data || []) as any[]

        return {
          responseText: estimates.length === 0
            ? 'No estimates found.'
            : `You have ${estimates.length} recent estimate${estimates.length > 1 ? 's' : ''}. Most recent is for $${(estimates[0]?.total_amount || 0).toLocaleString()}.`,
          data: estimates,
        }
      }

      default:
        return { responseText: 'VAULT received your command.', data: null }
    }
  }

  // ── BLUEPRINT (Projects) ─────────────────────────────────────────────────

  private async executeBLUEPRINT(
    intent: string,
    _params: Record<string, unknown>,
    ctx: VoiceCommandContext
  ): Promise<{ responseText: string; data: unknown }> {
    switch (intent) {
      case 'list_projects': {
        const { data, error } = await supabase
          .from('projects' as never)
          .select('*')
          .eq('org_id', ctx.orgId)
          .in('status', ['active', 'in_progress'])
          .limit(10)

        if (error) throw error
        const projects = (data || []) as any[]

        return {
          responseText: projects.length === 0
            ? 'No active projects found.'
            : `You have ${projects.length} active project${projects.length > 1 ? 's' : ''}. ${projects[0]?.name} was last updated.`,
          data: projects,
        }
      }

      default:
        return { responseText: 'BLUEPRINT received your command.', data: null }
    }
  }

  // ── LEDGER (Invoices / Finance) ──────────────────────────────────────────

  private async executeLEDGER(
    intent: string,
    _params: Record<string, unknown>,
    ctx: VoiceCommandContext
  ): Promise<{ responseText: string; data: unknown }> {
    switch (intent) {
      case 'list_invoices': {
        const { data, error } = await supabase
          .from('invoices' as never)
          .select('*')
          .eq('org_id', ctx.orgId)
          .in('status', ['sent', 'overdue'])
          .limit(10)

        if (error) throw error
        const invoices = (data || []) as any[]
        const overdueCount = invoices.filter((i: any) => i.status === 'overdue').length
        const totalOwed = invoices.reduce((sum: number, i: any) => sum + (i.total_amount || 0), 0)

        return {
          responseText: invoices.length === 0
            ? 'No outstanding invoices.'
            : `You have ${invoices.length} outstanding invoice${invoices.length > 1 ? 's' : ''} totaling $${totalOwed.toLocaleString()}. ${overdueCount} ${overdueCount === 1 ? 'is' : 'are'} overdue.`,
          data: invoices,
        }
      }

      default:
        return { responseText: 'LEDGER received your command.', data: null }
    }
  }

  // ── PULSE (Dashboard / KPIs) ─────────────────────────────────────────────

  private async executePULSE(
    intent: string,
    _params: Record<string, unknown>,
    _ctx: VoiceCommandContext
  ): Promise<{ responseText: string; data: unknown }> {
    switch (intent) {
      case 'get_dashboard':
        return {
          responseText: 'Let me pull up your dashboard. Check the screen for the latest KPIs and trends.',
          data: null,
        }

      default:
        return { responseText: 'PULSE received your command.', data: null }
    }
  }

  // ── OHM (NEC Code) ──────────────────────────────────────────────────────

  private async executeOHM(
    intent: string,
    _params: Record<string, unknown>,
    _ctx: VoiceCommandContext
  ): Promise<{ responseText: string; data: unknown }> {
    switch (intent) {
      case 'code_lookup':
        return {
          responseText: 'Let me look that up in the NEC code database. Check your screen for the full article reference.',
          data: null,
        }

      default:
        return { responseText: 'OHM received your command.', data: null }
    }
  }

  // ── General / NEXUS / SCOUT fallback via Claude ────────────────────────

  private async executeGeneral(
    agent: string,
    _intent: string,
    _params: Record<string, unknown>,
    _ctx: VoiceCommandContext
  ): Promise<{ responseText: string; data: unknown }> {
    // This should not normally be reached — the voice.ts pipeline already
    // falls back to Claude. But if it is reached, provide a useful response.
    const agentLabel = (agent || 'nexus').toUpperCase()
    return {
      responseText: `${agentLabel} is processing your request. Check the screen for details.`,
      data: null,
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: VoiceCommandExecutor | null = null

export function getVoiceCommandExecutor(): VoiceCommandExecutor {
  if (!_instance) _instance = new VoiceCommandExecutor()
  return _instance
}
