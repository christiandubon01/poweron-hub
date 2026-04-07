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
import { Send, Zap, AlertTriangle, Shield, X, Check, ChevronDown, ChevronRight, RotateCcw, Volume2, VolumeX, ChevronLeft, Maximize2, Minimize2 } from 'lucide-react'
import { NexusPresenceOrb } from './NexusPresenceOrb'
import { clsx } from 'clsx'
import { processMessage, detectMode, getLastContextSyncTime, type NexusResponse, type ConversationMessage, type ClassifiedIntent, type NexusMode } from '@/agents/nexus'
import { getActiveMode, setActiveMode, MODE_CONFIGS, type NexusAgentMode } from '@/services/nexusMode'
import { MessageBubble, AgentBadge } from './MessageBubble'
import { renderMarkdown } from '@/components/voice/VoiceTranscriptPanel'
// NexusPresenceOrb moved to VoiceTranscriptPanel
import { clearConversationThread } from '@/services/nexusLearnedProfile'
import { extractAndStoreConversationSignals, initEchoMemory } from '@/agents/echo/echoMemory'
import { MorningBriefingCard } from './MorningBriefingCard'
import SessionDebrief from '@/components/SessionDebrief'
import { extractConclusions, saveConclusions, type ConclusionItem } from '@/services/sessionConclusionService'
import { useAuth } from '@/hooks/useAuth'
import { useProactiveAI } from '@/hooks/useProactiveAI'
import { ProactiveInsightCard } from '@/components/shared/ProactiveInsightCard'
import { getBackupData, num, fmt } from '@/services/backupDataService'
import { getAlertSummaryForBriefing, isFirstNexusOpenToday } from '@/services/proactiveAlertService'
import { AgentActivityPanel } from './AgentActivityPanel'
import { addToScoutQueue } from '@/services/scoutQueue'
import { logMicroFeedback, logIgnoredRecommendation } from '@/services/feedbackLoopService'

// ── SCOUT suppression helper ─────────────────────────────────────────────────
// Returns true when the user explicitly asked SCOUT for something.
// If false and the response agent is 'scout', suppress from chat → silent queue.
function isExplicitScoutRequest(msg: string): boolean {
  return /\bscout\b|what\s+(?:have\s+)?you\s+flagged|show.*improvements?|improvements?\s+(?:queue|list|you\s+have)|flagged\s+improvements?/i.test(msg)
}

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

// ── DeepDiveSections — Collapsible per-agent breakdown for deep dive responses ──

/**
 * Parses a deep dive markdown response (with ## Agent headers) into
 * collapsible accordion sections. Each ## section is independently expandable.
 */
function DeepDiveSections({ content, agentId }: { content: string; agentId?: string }) {
  // Split on ## headers to get sections
  const sectionRegex = /^(##\s+.+)$/gm
  const parts = content.split(sectionRegex)
  // parts[0] = text before first ##, then alternating [header, body, header, body, ...]

  const sections: Array<{ title: string; body: string }> = []
  let preamble = ''

  if (parts.length <= 1) {
    // No ## sections found — fall back to plain render
    preamble = content
  } else {
    preamble = parts[0].trim()
    for (let i = 1; i < parts.length; i += 2) {
      const title = parts[i].replace(/^##\s*/, '').trim()
      const body = (parts[i + 1] || '').trim()
      if (title) sections.push({ title, body })
    }
  }

  const [openSections, setOpenSections] = useState<Record<number, boolean>>(() => {
    // First section open by default
    const init: Record<number, boolean> = {}
    if (sections.length > 0) init[0] = true
    return init
  })

  const toggle = (idx: number) => {
    setOpenSections(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  const agentColor = agentId
    ? { nexus: '#2ee89a', vault: '#ffd24a', pulse: '#3a8eff', ledger: '#40d4ff',
        spark: '#ff5fa0', blueprint: '#aa6eff', ohm: '#a8ff3e', chrono: '#ff9040', scout: '#ff5060' }[agentId] ?? '#2ee89a'
    : '#2ee89a'

  return (
    <div className="text-sm text-text-2 leading-relaxed">
      {/* Preamble text before first ## */}
      {preamble && (
        <div className="mb-3" dangerouslySetInnerHTML={{ __html: renderMarkdown(preamble) }} />
      )}

      {/* Collapsible sections */}
      {sections.map((section, idx) => (
        <div
          key={idx}
          className="mb-2 rounded-lg border border-bg-4 overflow-hidden"
          style={{ borderColor: openSections[idx] ? `${agentColor}33` : undefined }}
        >
          {/* Section header — clickable */}
          <button
            onClick={() => toggle(idx)}
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-bg-3 transition-colors"
            style={{ backgroundColor: openSections[idx] ? `${agentColor}0d` : undefined }}
          >
            <span
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: openSections[idx] ? agentColor : '#9ca3af' }}
            >
              {section.title}
            </span>
            {openSections[idx]
              ? <ChevronDown size={12} style={{ color: agentColor }} />
              : <ChevronRight size={12} className="text-text-4" />
            }
          </button>

          {/* Section body */}
          {openSections[idx] && (
            <div
              className="px-3 pb-3 pt-1 text-text-2 text-xs leading-relaxed bg-bg-1/30"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(section.body) }}
            />
          )}
        </div>
      ))}
    </div>
  )
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
  const [mode, setMode]                     = useState<NexusMode>('briefing')
  const [lastMsgMode, setLastMsgMode]       = useState<NexusMode>('briefing')
  const [agentMode, setAgentMode]           = useState<NexusAgentMode>(getActiveMode)
  const [syncTime, setSyncTime]             = useState<number>(0)

  // FIX 2 — Streaming token animation
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null)

  // FIX 4 — Mute toggle (fresh read from localStorage, no stale state)
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem('nexus_mute') === 'true')

  // FIX 5 — Orb collapse (persist to localStorage, default collapsed on mobile)
  const [orbCollapsed, setOrbCollapsed] = useState<boolean>(() => {
    const stored = localStorage.getItem('nexus_orb_collapsed')
    if (stored !== null) return stored === 'true'
    // Default: collapsed on mobile
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  })

  // B23 — Fullscreen expand (persist to localStorage nexus_expanded)
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    return localStorage.getItem('nexus_expanded') === 'true'
  })

  // B29 — T2 Micro Feedback: tracks thumbs vote per message id
  const [messageFeedback, setMessageFeedback] = useState<Record<string, 'up' | 'down'>>({})

  // B11 — Session Debrief state
  const [isDebriefOpen, setIsDebriefOpen]           = useState(false)
  const [debriefConclusions, setDebriefConclusions] = useState<ConclusionItem[]>([])
  const [debriefSessionId, setDebriefSessionId]     = useState<string>('')
  const debriefTriggeredRef                         = useRef(false)

  // Update syncTime whenever operational context is rebuilt
  // Poll every 30s to keep display current after initial build
  useEffect(() => {
    const tick = () => setSyncTime(getLastContextSyncTime())
    tick() // immediate check
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)

  // Sync agentMode state with external mode-change events (e.g. voice commands)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<NexusAgentMode>).detail
      if (detail) setAgentMode(detail)
    }
    window.addEventListener('nexus:mode-changed', handler)
    return () => window.removeEventListener('nexus:mode-changed', handler)
  }, [])

  // ── Build proactive briefing context ────────────────────────────────────
  const backup = getBackupData()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  // Gather real data for briefing
  const overdueServiceCalls = (backup?.serviceLogs || []).filter(s => num(s.quoted) > 0 && num(s.collected) === 0 && s.date && new Date(s.date) < new Date(Date.now() - 7 * 86400000))
  const stagnantProjects = (backup?.projects || []).filter(p => p.status !== 'completed' && p.lastMove && new Date(p.lastMove) < new Date(Date.now() - 14 * 86400000))
  const uncollectedAR = (backup?.serviceLogs || []).reduce((sum, s) => sum + Math.max(0, num(s.quoted) - num(s.collected)), 0)

  // B12 — Prepend active alerts to briefing context on first NEXUS open of the day
  const _alertPrefix = isFirstNexusOpenToday() ? getAlertSummaryForBriefing() : ''

  const briefingContext = `${_alertPrefix}Good ${greeting}, Christian. Give a brief morning briefing based on:
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

  // Initialize ECHO memory on mount (ensures owner identity anchor is seeded)
  useEffect(() => {
    initEchoMemory()
  }, [])

  // B29 — T1 Passive Feedback: log ignored recommendation on unmount.
  // If the last message is an unacted assistant message (no follow-up user msg,
  // no thumbs vote given), it means the user closed chat without acting.
  const messagesRef = useRef<ChatMessage[]>([])
  const messageFeedbackRef = useRef<Record<string, 'up' | 'down'>>({})
  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { messageFeedbackRef.current = messageFeedback }, [messageFeedback])
  useEffect(() => {
    return () => {
      const msgs = messagesRef.current
      const feedback = messageFeedbackRef.current
      if (msgs.length === 0) return
      const last = msgs[msgs.length - 1]
      if (last.role === 'assistant' && last.content && !feedback[last.id]) {
        // User closed without acting on the last recommendation
        logIgnoredRecommendation({
          recommendation_preview: last.content,
          org_id: undefined, // org_id not accessible in cleanup; omit
        })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // B11 — Session conclusion extraction: trigger once when the conversation
  // reaches 5+ message exchanges (user + assistant pairs = 10+ messages).
  // Shows SessionDebrief so the user can review and save the conclusions to
  // session_conclusions (used by the ECHO rolling window on next session open).
  useEffect(() => {
    const assistantCount = messages.filter(m => m.role === 'assistant').length
    if (assistantCount >= 5 && !debriefTriggeredRef.current && !isProcessing) {
      debriefTriggeredRef.current = true

      // Extract conclusions from the conversation so far
      const rawMessages = messages.map(m => ({
        role: m.role,
        content: m.content,
        agentId: m.agentId,
      }))
      const extracted = extractConclusions(rawMessages)
      const sessionId = `nexus-session-${Date.now()}`

      setDebriefConclusions(extracted)
      setDebriefSessionId(sessionId)
      setIsDebriefOpen(true)

      console.log(`[B11] Session debrief triggered — ${extracted.length} conclusions extracted (session: ${sessionId})`)
    }
  }, [messages, isProcessing])

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

    // ── NEXUS built-in command: "show snapshots" ─────────────────────────────
    if (/show\s+snapshots?/i.test(trimmed)) {
      const cmdMsg: ChatMessage = {
        id:        crypto.randomUUID(),
        role:      'user',
        content:   trimmed,
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, cmdMsg])
      const replyMsg: ChatMessage = {
        id:        crypto.randomUUID(),
        role:      'assistant',
        content:   'Opening Snapshot History in Settings…',
        timestamp: Date.now(),
        agentId:   'nexus',
      }
      setMessages(prev => [...prev, replyMsg])
      window.dispatchEvent(new CustomEvent('poweron:show-snapshots'))
      return
    }

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

    // Detect if this message triggers deep dive
    const effectiveMode = detectMode(trimmed, mode)
    if (effectiveMode !== mode) setMode(effectiveMode)

    try {
      const response = await processMessage({
        message:     trimmed,
        orgId:       profile.org_id,
        userId:      profile.id,
        userName:    profile.full_name,
        conversationHistory: [...conversationHistory, userConvMsg],
        mode:        effectiveMode,
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

      } else if (
        // FIX 2 — SCOUT response suppression:
        // If the responding agent is SCOUT and the user's message did NOT
        // explicitly mention SCOUT or improvements, suppress from the chat
        // thread and log to the silent queue instead.
        response.agent.agentId === 'scout' && !isExplicitScoutRequest(trimmed)
      ) {
        addToScoutQueue(response.agent.content, trimmed)
        console.log('[NexusChat] SCOUT response suppressed → silent queue')
        // Do NOT add to the messages thread — no notification, no badge
      } else {
        // FIX 2 — Direct response: add empty bubble first, then stream text in
        const newMsgId = crypto.randomUUID()
        const assistantMsg: ChatMessage = {
          id:          newMsgId,
          role:        'assistant',
          content:     '',  // starts empty — streamResponseText fills it in
          timestamp:   Date.now(),
          agentId:     response.agent.agentId,
          impactLevel: response.intent.impactLevel,
          metadata:    { mode: response.mode },
        }
        setMessages(prev => [...prev, assistantMsg])
        setConversationHistory(prev => [...prev, response.conversationMessage])
        setLastMsgMode(response.mode)
        // Stream text in character by character for perceived first-token speed
        streamResponseText(newMsgId, response.agent.content)
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

  // Reset to briefing mode and clear conversation
  const resetToNewAnalysis = useCallback(() => {
    // Extract and store conversation quality signals into ECHO memory before clearing
    if (messages.length > 0) {
      const echoMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
        agent: m.agentId,
      }))
      extractAndStoreConversationSignals(echoMessages)
    }
    setMessages([])
    setConversationHistory([])
    setMode('briefing')
    setLastMsgMode('briefing')
    setError(null)
    setPendingProposal(null)
    debriefTriggeredRef.current = false // Allow debrief to trigger again on next session
    clearConversationThread() // Clear Layer 1 conversation thread from localStorage
  }, [messages])

  // FIX 4 — Mute toggle: writes to localStorage synchronously on every tap
  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev
      // Synchronous localStorage write — no stale state, fresh read in voice.ts
      localStorage.setItem('nexus_mute', String(next))
      return next
    })
  }, [])

  // FIX 5 — Orb collapse toggle: persist to localStorage
  const toggleOrb = useCallback(() => {
    setOrbCollapsed(prev => {
      const next = !prev
      localStorage.setItem('nexus_orb_collapsed', String(next))
      return next
    })
  }, [])

  // B23 — Fullscreen expand toggle: persist to localStorage, auto-collapse orb when expanding
  const toggleExpand = useCallback(() => {
    setIsExpanded(prev => {
      const next = !prev
      localStorage.setItem('nexus_expanded', String(next))
      // Auto-collapse orb when entering fullscreen
      if (next) {
        setOrbCollapsed(true)
        localStorage.setItem('nexus_orb_collapsed', 'true')
      }
      return next
    })
  }, [])

  // FIX 2 — Stream response text character by character for perceived streaming UX
  const streamResponseText = useCallback(async (msgId: string, fullText: string) => {
    setStreamingMsgId(msgId)
    const CHARS_PER_FRAME = 6
    const FRAME_MS = 18
    let pos = 0
    while (pos < fullText.length) {
      pos = Math.min(pos + CHARS_PER_FRAME, fullText.length)
      const chunk = fullText.slice(0, pos)
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: chunk } : m))
      if (pos < fullText.length) {
        await new Promise(r => setTimeout(r, FRAME_MS))
      }
    }
    setStreamingMsgId(null)
  }, [])

  // B29 — T2 Micro Feedback: handle thumbs tap (one-shot, cannot change after)
  const handleThumbsFeedback = useCallback((msg: ChatMessage, vote: 'up' | 'down') => {
    if (messageFeedback[msg.id]) return // already voted
    setMessageFeedback(prev => ({ ...prev, [msg.id]: vote }))
    logMicroFeedback({
      agent: (msg.agentId ?? 'nexus').toUpperCase(),
      response_preview: msg.content,
      feedback: vote,
      org_id: profile?.org_id,
    })
  }, [messageFeedback, profile])

  // Trigger deep dive mode
  const triggerDeepDive = useCallback(() => {
    setMode('deepdive')
    setInput('deep dive')
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  // ── Key handler ─────────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={clsx(
      'flex bg-bg overflow-hidden',
      isExpanded
        ? 'fixed inset-0 z-[9999] h-screen w-screen'
        : 'h-full'
    )}>

      {/* FIX 5 — Orb panel: collapsible left side */}
      {!orbCollapsed && (
        <div className="relative flex-shrink-0 w-48 flex flex-col items-center justify-center bg-bg-1 border-r border-bg-4">
          {/* Collapse chevron — top-left of orb */}
          <button
            onClick={toggleOrb}
            className="absolute top-3 left-2 w-7 h-7 rounded-md bg-bg-2 border border-bg-4 flex items-center justify-center hover:bg-bg-3 transition-colors z-10"
            title="Collapse orb"
          >
            <ChevronLeft size={13} className="text-text-3" />
          </button>
          <NexusPresenceOrb state={isProcessing ? 'processing' : 'inactive'} size={120} />
          <span className="mt-2 text-[9px] font-mono text-text-4 uppercase tracking-wider">NEXUS</span>
        </div>
      )}

      {/* Main chat column */}
      <div className="flex flex-col flex-1 min-w-0 bg-bg">

      {/* FIX 5 — Collapsed orb: expand button */}
      {orbCollapsed && (
        <button
          onClick={toggleOrb}
          className="absolute top-3 left-3 z-20 w-7 h-7 rounded-md bg-bg-2 border border-bg-4 flex items-center justify-center hover:bg-bg-3 transition-colors"
          title="Expand orb"
        >
          <Zap size={11} className="text-green" />
        </button>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-bg-4 bg-bg-1/80 backdrop-blur-sm">
        <div className={`flex items-center gap-3 ${orbCollapsed ? 'pl-8' : ''}`}>
          <div className="w-8 h-8 rounded-lg bg-green-subtle border border-green-border flex items-center justify-center">
            <Zap className="w-4 h-4 text-green" fill="currentColor" />
          </div>
          <div>
            <div className="text-sm font-bold text-text-1">NEXUS</div>
            <div className="text-[10px] text-text-3 font-mono">
              {mode === 'deepdive' ? 'Deep Dive Mode' : 'Manager Agent'}
            </div>
            {syncTime > 0 && (() => {
              const diffMs   = Date.now() - syncTime
              const diffMins = Math.floor(diffMs / 60000)
              const label    = diffMins < 1 ? 'just now' : diffMins === 1 ? '1 min ago' : `${diffMins} min ago`
              return (
                <div className="text-[9px] text-text-4 font-mono">
                  Data synced: {label}
                </div>
              )
            })()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* FIX 4 — Mute toggle: synchronous localStorage write, no stale state */}
          <button
            onClick={toggleMute}
            className={clsx(
              'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
              muted ? 'bg-amber-900/40 text-amber-400 border border-amber-700/40' : 'bg-bg-3 text-text-3 hover:text-text-1 hover:bg-bg-4'
            )}
            title={muted ? 'NEXUS muted — tap to unmute' : 'Mute NEXUS voice'}
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          {mode === 'deepdive' && (
            <button
              onClick={resetToNewAnalysis}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-bg-3 border border-bg-5 text-text-2 text-[10px] font-bold hover:bg-bg-4 transition-colors min-h-[44px]"
            >
              <RotateCcw size={11} />
              New Analysis
            </button>
          )}
          {/* B23 — Fullscreen expand / collapse button */}
          <button
            onClick={toggleExpand}
            className="w-8 h-8 rounded-lg bg-bg-3 text-text-3 hover:text-text-1 hover:bg-bg-4 flex items-center justify-center transition-colors"
            title={isExpanded ? 'Collapse to panel' : 'Expand to fullscreen'}
          >
            {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-subtle border border-green-border">
            <span className="w-1.5 h-1.5 bg-green rounded-full animate-pulse" />
            <span className="text-[10px] font-mono font-bold text-green">ONLINE</span>
          </div>
        </div>
      </div>

      {/* Mode Selector — owner-only */}
      {profile?.role === 'owner' && (() => {
        const modeColors: Record<NexusAgentMode, { pill: string; active: string; dot: string }> = {
          proactive:      { pill: 'border-amber-500/30 hover:border-amber-500/60',   active: 'bg-amber-500/15 border-amber-500/60',   dot: 'bg-amber-400' },
          analytical:     { pill: 'border-blue-500/30 hover:border-blue-500/60',    active: 'bg-blue-500/15 border-blue-500/60',    dot: 'bg-blue-400' },
          coaching:       { pill: 'border-purple-500/30 hover:border-purple-500/60', active: 'bg-purple-500/15 border-purple-500/60', dot: 'bg-purple-400' },
          conversational: { pill: 'border-teal-500/30 hover:border-teal-500/60',    active: 'bg-teal-500/15 border-teal-500/60',    dot: 'bg-teal-400' },
          carplay:        { pill: 'border-green-500/30 hover:border-green-500/60',   active: 'bg-green-500/15 border-green-500/60',   dot: 'bg-green-400' },
        }
        const activeConfig = MODE_CONFIGS[agentMode]
        const activeColors = modeColors[agentMode]

        return (
          <div className="px-5 py-2 border-b border-bg-4 bg-bg-1/60">
            <div className="flex items-center gap-2 flex-wrap">
              {(Object.entries(MODE_CONFIGS) as [NexusAgentMode, typeof MODE_CONFIGS[NexusAgentMode]][]).map(([key, cfg]) => {
                const colors = modeColors[key]
                const isActive = agentMode === key
                return (
                  <button
                    key={key}
                    onClick={() => {
                      setActiveMode(key)
                      setAgentMode(key)
                    }}
                    className={clsx(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold transition-all',
                      isActive ? colors.active : 'bg-transparent border-bg-5 text-text-4 hover:text-text-2',
                      !isActive && colors.pill
                    )}
                  >
                    {isActive && (
                      <span className={clsx('w-1.5 h-1.5 rounded-full', colors.dot)} />
                    )}
                    {cfg.name}
                  </button>
                )
              })}
            </div>
            <div className="mt-1 text-[9px] text-text-4 font-mono truncate">
              {activeConfig.description}
            </div>
          </div>
        )
      })()}

      {/* Agent Activity — shows last 5 routed messages + live bus health */}
      <AgentActivityPanel />

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
                  className="px-3 py-1.5 rounded-lg bg-bg-2 border border-bg-4 text-xs text-text-2 hover:bg-bg-3 hover:text-text-1 transition-colors min-h-[44px]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message thread */}
        {messages.map((msg, idx) => {
          // Render daily briefing as a special card
          if (msg.metadata?.type === 'daily_briefing' && msg.metadata?.stats) {
            return (
              <div key={msg.id} className="px-5 py-2">
                <MorningBriefingCard content={msg.content} metadata={msg.metadata as any} />
              </div>
            )
          }

          const isLastAssistant = msg.role === 'assistant' && idx === messages.length - 1
          const isBriefingMsg = msg.metadata?.mode === 'briefing' || (!msg.metadata?.mode && msg.role === 'assistant')
          const isDeepDiveMsg = msg.metadata?.mode === 'deepdive' && msg.role === 'assistant'

          return (
            <div key={msg.id}>
              {/* Deep dive: render collapsible sections instead of plain MessageBubble */}
              {isDeepDiveMsg ? (
                <div className="flex gap-3 animate-fade-in">
                  {/* Avatar */}
                  <div className={clsx(
                    'w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 mt-1',
                    'bg-[rgba(46,232,154,0.10)] border-[rgba(46,232,154,0.25)]'
                  )}>
                    <span className="text-[9px] font-mono font-bold text-nexus">
                      {(msg.agentId ?? 'N').charAt(0).toUpperCase()}
                    </span>
                  </div>
                  {/* Bubble */}
                  <div className="max-w-[90%] w-full rounded-2xl px-4 py-3 bg-bg-2 border border-bg-4">
                    {/* Badge */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider border bg-[rgba(46,232,154,0.10)] border-[rgba(46,232,154,0.25)] text-nexus">
                        DEEP DIVE — {(msg.agentId ?? 'nexus').toUpperCase()}
                      </span>
                      <span className="text-[9px] font-mono text-text-4">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <DeepDiveSections content={msg.content} agentId={msg.agentId} />
                  </div>
                </div>
              ) : (
                <MessageBubble
                  role={msg.role}
                  content={msg.content}
                  timestamp={msg.timestamp}
                  agentId={msg.agentId}
                  impactLevel={msg.impactLevel}
                />
              )}
              {/* B29 — T2 Micro Feedback: thumbs up/down below every AI response */}
              {msg.role === 'assistant' && msg.content && streamingMsgId !== msg.id && (
                <div className="flex items-center gap-1 mt-1 pl-10">
                  {(['up', 'down'] as const).map((vote) => {
                    const voted = messageFeedback[msg.id]
                    const isSelected = voted === vote
                    const isOther = voted && voted !== vote
                    return (
                      <button
                        key={vote}
                        onClick={() => handleThumbsFeedback(msg, vote)}
                        disabled={!!voted}
                        title={vote === 'up' ? 'Helpful' : 'Not helpful'}
                        className="flex items-center justify-center rounded transition-colors"
                        style={{
                          width: 22,
                          height: 22,
                          fontSize: 13,
                          cursor: voted ? 'default' : 'pointer',
                          opacity: isOther ? 0.25 : 1,
                          backgroundColor: isSelected
                            ? vote === 'up' ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)'
                            : 'transparent',
                          color: isSelected
                            ? vote === 'up' ? '#4ade80' : '#f87171'
                            : '#4b5563',
                          border: isSelected
                            ? `1px solid ${vote === 'up' ? '#4ade8044' : '#f8717144'}`
                            : '1px solid transparent',
                        }}
                      >
                        {vote === 'up' ? '👍' : '👎'}
                      </button>
                    )
                  })}
                </div>
              )}
              {/* Show "Deep Dive" button below latest briefing response */}
              {isLastAssistant && isBriefingMsg && mode === 'briefing' && !isProcessing && (
                <div className="flex justify-end mt-1 pr-1">
                  <button
                    onClick={triggerDeepDive}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-bg-2 border border-bg-4 text-[10px] font-bold text-text-2 hover:bg-bg-3 hover:text-text-1 transition-colors min-h-[44px]"
                  >
                    <ChevronDown size={11} />
                    Deep Dive
                  </button>
                </div>
              )}
            </div>
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

      {/* B11 — Session Debrief: slides up after 5+ exchanges */}
      {profile?.id && (
        <SessionDebrief
          isOpen={isDebriefOpen}
          conclusions={debriefConclusions}
          userId={profile.id}
          sessionId={debriefSessionId}
          onClose={() => setIsDebriefOpen(false)}
        />
      )}
      </div>
    </div>
  )
}
