// @ts-nocheck
/**
 * NexusChatPanel — The main NEXUS chat interface.
 *
 * Features:
 * - Message thread with agent attribution badges
 * - Proposal cards for MEDIUM/HIGH impact actions
 * - Confirmation step before executing HIGH/CRITICAL impact actions
 * - Auto-scroll to latest message
 * - Loading state while NEXUS processes
 * - Proactive morning briefing on first load
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Zap, AlertTriangle, Shield, X, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { processMessage, type NexusResponse, type ConversationMessage, type ClassifiedIntent } from '@/agents/nexus'
import { MessageBubble, AgentBadge } from './MessageBubble'
import { MorningBriefingCard } from './MorningBriefingCard'
import { useAuth } from '@/hooks/useAuth'
import { useProactiveAI } from '@/hooks/useProactiveAI'
import { ProactiveInsightCard } from '@/components/shared/ProactiveInsightCard'
import { getBackupData, num, fmt } from '@/services/backupDataService'

// ── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id:           string
  role:         'user' | 'assistant'
  content:      string
  timestamp:    number
  agentId?:     string
  impactLevel?: ClassifiedIntent['impactLevel']
  metadata?:    { type?: string; stats?: any; [key: string]: any }
}

interface PendingProposal {
  id:             string
  intent:         ClassifiedIntent
  agentResponse:  NexusResponse['agent']
  message:        string
}

// ── Component ───────────────────────────────────────────────────────────────

export function NexusChatPanel() {
  const { profile } = useAuth()
  const [messages, setMessages]             = useState<ChatMessage[]>([])
  const [input, setInput]                   = useState('')
  const [isProcessing, setIsProcessing]     = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | null>(null)
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)

  // ── Build proactive briefing context ────────────────────────────────────
  const backup = getBackupData()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  // Gather real data for briefing
  const overdueServiceCalls = (backup?.serviceLogs || []).filter(s => num(s.quoted) > 0 && num(s.collected) === 0 && s.date && new Date(s.date) < new Date(Date.now() - 7 * 86400000))
  const stagnantProjects = (backup?.projects || []).filter(p => p.status !== 'completed' && p.lastMove && new Date(p.lastMove) < new Date(Date.now() - 14 * 86400000))
  const uncollectedAR = (backup?.serviceLogs || []).reduce((sum, s) => sum + Math.max(0, num(s.quoted) - num(s.collected)), 0)

  const briefingContext = `Good ${greeting}, Christian. Give a brief morning briefing based on:
- ${overdueServiceCalls.length} overdue service calls (uncollected 7+ days)
- ${stagnantProjects.length} stagnant projects (no activity 14+ days)
- $${uncollectedAR.toFixed(0)} uncollected AR total
- ${(backup?.projects || []).filter(p => p.status !== 'completed').length} active projects
- ${(backup?.serviceLogs || []).length} total service logs

Prioritize the top 3 items that need attention RIGHT NOW. Be brief and actionable.`

  const briefingSystem = 'You are NEXUS, the AI manager for Power On Solutions LLC, a C-10 electrical contractor. Give a brief, friendly morning briefing. Highlight the top 3 priority items. Use short bullet points. Be direct and specific with names and dollar amounts when possible.'

  const briefing = useProactiveAI('nexus-briefing', briefingSystem, briefingContext, messages.length === 0)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isProcessing])

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // ── Send message ────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || isProcessing) return
    if (!profile?.org_id) {
      setError('Not authenticated. Please sign in.')
      return
    }

    setInput('')
    setError(null)

    // Add user message to thread
    const userMsg: ChatMessage = {
      id:        crypto.randomUUID(),
      role:      'user',
      content:   trimmed,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])

    const userConvMsg: ConversationMessage = {
      role:      'user',
      content:   trimmed,
      timestamp: Date.now(),
    }
    setConversationHistory(prev => [...prev, userConvMsg])

    setIsProcessing(true)

    try {
      const response = await processMessage({
        message:     trimmed,
        orgId:       profile.org_id,
        userId:      profile.id,
        userName:    profile.full_name,
        conversationHistory: [...conversationHistory, userConvMsg],
      })

      // If HIGH/CRITICAL impact — show proposal card instead of direct response
      if (response.needsConfirmation) {
        setPendingProposal({
          id:            crypto.randomUUID(),
          intent:        response.intent,
          agentResponse: response.agent,
          message:       trimmed,
        })

        // Still show a preview message
        const previewMsg: ChatMessage = {
          id:          crypto.randomUUID(),
          role:        'assistant',
          content:     `⚡ This action requires your confirmation (${response.intent.impactLevel} impact). Review the proposal below.`,
          timestamp:   Date.now(),
          agentId:     response.agent.agentId,
          impactLevel: response.intent.impactLevel,
        }
        setMessages(prev => [...prev, previewMsg])

      } else {
        // Direct response — add to thread
        const assistantMsg: ChatMessage = {
          id:          crypto.randomUUID(),
          role:        'assistant',
          content:     response.agent.content,
          timestamp:   Date.now(),
          agentId:     response.agent.agentId,
          impactLevel: response.intent.impactLevel,
        }
        setMessages(prev => [...prev, assistantMsg])
        setConversationHistory(prev => [...prev, response.conversationMessage])
      }

    } catch (err) {
      console.error('[NexusChat] Error:', err)
      const errorMessage = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setError(errorMessage)

      // Add error message to thread
      const errorMsg: ChatMessage = {
        id:        crypto.randomUUID(),
        role:      'assistant',
        content:   `I ran into an issue: ${errorMessage}`,
        timestamp: Date.now(),
        agentId:   'nexus',
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsProcessing(false)
    }
  }, [input, isProcessing, profile, conversationHistory])

  // ── Handle proposal confirmation ────────────────────────────────────────

  const confirmProposal = useCallback(() => {
    if (!pendingProposal) return

    const assistantMsg: ChatMessage = {
      id:          crypto.randomUUID(),
      role:        'assistant',
      content:     pendingProposal.agentResponse.content,
      timestamp:   Date.now(),
      agentId:     pendingProposal.agentResponse.agentId,
      impactLevel: pendingProposal.intent.impactLevel,
    }
    setMessages(prev => [...prev, assistantMsg])
    setConversationHistory(prev => [...prev, {
      role:      'assistant',
      content:   pendingProposal.agentResponse.content,
      agentId:   pendingProposal.agentResponse.agentId,
      timestamp: Date.now(),
    }])
    setPendingProposal(null)
  }, [pendingProposal])

  const rejectProposal = useCallback(() => {
    if (!pendingProposal) return

    const rejectMsg: ChatMessage = {
      id:        crypto.randomUUID(),
      role:      'assistant',
      content:   'Action cancelled. Let me know if you need anything else.',
      timestamp: Date.now(),
      agentId:   'nexus',
    }
    setMessages(prev => [...prev, rejectMsg])
    setPendingProposal(null)
  }, [pendingProposal])

  // ── Key handler ─────────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-bg-4 bg-bg-1/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-green-subtle border border-green-border flex items-center justify-center">
            <Zap className="w-4 h-4 text-green" fill="currentColor" />
          </div>
          <div>
            <div className="text-sm font-bold text-text-1">NEXUS</div>
            <div className="text-[10px] text-text-3 font-mono">Manager Agent</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-subtle border border-green-border">
          <span className="w-1.5 h-1.5 bg-green rounded-full animate-pulse" />
          <span className="text-[10px] font-mono font-bold text-green">ONLINE</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Proactive briefing card on first load */}
        {messages.length === 0 && (
          <ProactiveInsightCard
            agentName="NEXUS"
            agentColor="#8b5cf6"
            response={briefing.response}
            loading={briefing.loading}
            error={briefing.error}
            onRefresh={briefing.refresh}
            emptyMessage={`Good ${greeting}, Christian. Here's what needs your attention today...`}
            systemPrompt={briefingSystem}
          />
        )}

        {/* Welcome message if empty */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-green-subtle border border-green-border flex items-center justify-center mb-4">
              <Zap className="w-8 h-8 text-green" fill="currentColor" />
            </div>
            <h3 className="text-lg font-bold text-text-1 mb-2">Hey{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}!</h3>
            <p className="text-sm text-text-3 max-w-md">
              I'm NEXUS, your operations manager. Ask me anything about your projects,
              invoices, estimates, scheduling, or anything else — I'll route it to the right agent.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-6">
              {[
                'Show me overdue invoices',
                'What projects are in progress?',
                'Revenue this week',
                'Open coordination items',
              ].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus() }}
                  className="px-3 py-1.5 rounded-lg bg-bg-2 border border-bg-4 text-xs text-text-2 hover:bg-bg-3 hover:text-text-1 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message thread */}
        {messages.map(msg => {
          // Render daily briefing as a special card
          if (msg.metadata?.type === 'daily_briefing' && msg.metadata?.stats) {
            return (
              <div key={msg.id} className="px-5 py-2">
                <MorningBriefingCard content={msg.content} metadata={msg.metadata as any} />
              </div>
            )
          }
          return (
            <MessageBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              timestamp={msg.timestamp}
              agentId={msg.agentId}
              impactLevel={msg.impactLevel}
            />
          )
        })}

        {/* Loading indicator */}
        {isProcessing && (
          <MessageBubble
            role="assistant"
            content=""
            timestamp={Date.now()}
            agentId="nexus"
            isLoading
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Proposal Card (for MEDIUM/HIGH/CRITICAL actions) */}
      {pendingProposal && (
        <div className="mx-5 mb-3 animate-slide-up">
          <div className={clsx(
            'rounded-xl border p-4',
            pendingProposal.intent.impactLevel === 'CRITICAL'
              ? 'bg-red-subtle border-[rgba(255,80,96,0.25)]'
              : pendingProposal.intent.impactLevel === 'HIGH'
                ? 'bg-[rgba(255,144,64,0.08)] border-[rgba(255,144,64,0.25)]'
                : 'bg-gold-subtle border-[rgba(255,210,74,0.25)]'
          )}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {pendingProposal.intent.impactLevel === 'CRITICAL' ? (
                  <Shield className="w-4 h-4 text-red" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-orange" />
                )}
                <span className={clsx(
                  'text-xs font-bold uppercase tracking-wider',
                  pendingProposal.intent.impactLevel === 'CRITICAL' ? 'text-red' : 'text-orange'
                )}>
                  {pendingProposal.intent.impactLevel} Impact Action
                </span>
              </div>
              <AgentBadge agentId={pendingProposal.agentResponse.agentId} />
            </div>

            {/* Description */}
            <p className="text-sm text-text-2 mb-3 leading-relaxed">
              {pendingProposal.agentResponse.content.slice(0, 300)}
              {pendingProposal.agentResponse.content.length > 300 ? '...' : ''}
            </p>

            {/* Classification details */}
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="px-2 py-0.5 rounded bg-bg-3 text-[10px] font-mono text-text-3">
                {pendingProposal.intent.category}
              </span>
              <span className="px-2 py-0.5 rounded bg-bg-3 text-[10px] font-mono text-text-3">
                confidence: {(pendingProposal.intent.confidence * 100).toFixed(0)}%
              </span>
              {pendingProposal.intent.entities.map((e, i) => (
                <span key={i} className="px-2 py-0.5 rounded bg-bg-3 text-[10px] font-mono text-text-3">
                  {e.type}: {e.value}
                </span>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={confirmProposal}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green text-bg font-bold text-xs hover:brightness-110 transition-all"
              >
                <Check size={14} />
                Confirm
              </button>
              <button
                onClick={rejectProposal}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-3 border border-bg-5 text-text-2 font-bold text-xs hover:bg-bg-4 transition-colors"
              >
                <X size={14} />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mx-5 mb-2 px-4 py-2 rounded-lg bg-red-subtle border border-[rgba(255,80,96,0.25)] text-xs text-red flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hover:text-text-1">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input */}
      <div className="px-5 pb-5 pt-2">
        <div className="flex items-end gap-2 bg-bg-2 border border-bg-4 rounded-xl px-4 py-3 focus-within:border-green-border transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask NEXUS anything..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-text-1 placeholder-text-4 outline-none resize-none max-h-32"
            style={{ minHeight: '20px' }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isProcessing}
            className={clsx(
              'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all',
              input.trim() && !isProcessing
                ? 'bg-green text-bg hover:brightness-110'
                : 'bg-bg-4 text-text-4 cursor-not-allowed'
            )}
          >
            <Send size={14} />
          </button>
        </div>
        <div className="text-center mt-2">
          <span className="text-[10px] text-text-4 font-mono">
            NEXUS routes to VAULT · PULSE · LEDGER · SPARK · BLUEPRINT · OHM · CHRONO · SCOUT
          </span>
        </div>
      </div>
    </div>
  )
}
