// @ts-nocheck
/**
 * ProactiveInsightCard — Shared card for displaying AI agent proactive insights.
 *
 * Features:
 * - Shows loading skeleton, AI response, error state
 * - Multi-turn "Dive Deeper" follow-up with full conversation history
 * - Text input at bottom for typed follow-up questions
 * - Conversation history persists for the session (cleared on panel close)
 */

import React, { useState, useRef, useEffect } from 'react'
import { Sparkles, RefreshCw, Loader2, Send, Mic, Trash2 } from 'lucide-react'
import { callClaude, extractText } from '@/services/claudeProxy'

interface ConversationEntry {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface ProactiveInsightCardProps {
  agentName: string
  agentColor: string // hex color like '#10b981'
  response: string
  loading: boolean
  error: string
  onRefresh: () => void
  emptyMessage?: string
  systemPrompt?: string
}

export function ProactiveInsightCard({
  agentName,
  agentColor,
  response,
  loading,
  error,
  onRefresh,
  emptyMessage,
  systemPrompt,
}: ProactiveInsightCardProps) {
  const [conversationHistory, setConversationHistory] = useState<ConversationEntry[]>([])
  const [followUpInput, setFollowUpInput] = useState('')
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll conversation to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [conversationHistory])

  const clearConversation = () => {
    setConversationHistory([])
    setFollowUpInput('')
  }

  // Voice input — uses Web Speech API if available
  const handleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return
    const recog = new SpeechRecognition()
    recog.lang = 'en-US'
    recog.interimResults = false
    recog.onstart = () => setIsListening(true)
    recog.onend = () => setIsListening(false)
    recog.onresult = (e: any) => {
      const transcript = e.results[0]?.[0]?.transcript || ''
      if (transcript) setFollowUpInput(prev => prev ? prev + ' ' + transcript : transcript)
    }
    try { recog.start() } catch { setIsListening(false) }
  }

  const handleFollowUp = async () => {
    const trimmed = followUpInput.trim()
    if (!trimmed || !systemPrompt || followUpLoading) return

    setFollowUpInput('')
    setFollowUpLoading(true)

    // Add user message to history
    const userEntry: ConversationEntry = { role: 'user', content: trimmed, timestamp: Date.now() }
    const updatedHistory = [...conversationHistory, userEntry]
    setConversationHistory(updatedHistory)

    try {
      // Build messages array with full conversation context
      const messages = [
        // Start with the initial proactive response as context
        { role: 'assistant' as const, content: response },
        // Include all follow-up exchanges
        ...updatedHistory.map(e => ({
          role: e.role as 'user' | 'assistant',
          content: e.content,
        })),
      ]

      const result = await callClaude({
        system: systemPrompt + `\n\nYou are continuing a conversation. Reference previous exchanges naturally. The user's name is Christian. Be concise and practical.`,
        messages,
        max_tokens: 1024,
      })

      const responseText = extractText(result)
      const assistantEntry: ConversationEntry = { role: 'assistant', content: responseText, timestamp: Date.now() }
      setConversationHistory(prev => [...prev, assistantEntry])
    } catch (err) {
      const errorText = 'Error: ' + (err instanceof Error ? err.message : String(err))
      setConversationHistory(prev => [...prev, { role: 'assistant', content: errorText, timestamp: Date.now() }])
    } finally {
      setFollowUpLoading(false)
    }
  }

  return (
    <div style={{ backgroundColor: '#232738', borderRadius: '8px', padding: '16px', marginBottom: '16px', borderLeft: `3px solid ${agentColor}` }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={14} style={{ color: agentColor }} />
          <span style={{ fontSize: '12px', fontWeight: '700', color: agentColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {agentName} Analysis
          </span>
        </div>
        {!loading && (
          <button onClick={onRefresh} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: '2px' }} title="Refresh analysis">
            <RefreshCw size={13} />
          </button>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: '14px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '4px', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
            <Loader2 size={12} style={{ color: agentColor, animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '11px', color: '#6b7280' }}>Analyzing your data...</span>
          </div>
          <style>{`@keyframes pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 0.7; } }`}</style>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{ fontSize: '12px', color: '#ef4444', padding: '8px', backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: '4px' }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !response && emptyMessage && (
        <div style={{ fontSize: '13px', color: '#9ca3af', lineHeight: '1.5' }}>
          {emptyMessage}
        </div>
      )}

      {/* AI Response */}
      {!loading && !error && response && (
        <div style={{ fontSize: '13px', color: '#d1d5db', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
          {response}
        </div>
      )}

      {/* Persistent Conversation Thread — always visible after response loads */}
      {!loading && response && systemPrompt && (
        <div style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
          {/* Thread header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Open Analysis Chat {conversationHistory.length > 0 ? `· ${Math.ceil(conversationHistory.length / 2)} exchange${Math.ceil(conversationHistory.length / 2) !== 1 ? 's' : ''}` : ''}
            </span>
            {conversationHistory.length > 0 && (
              <button
                onClick={clearConversation}
                style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '10px', padding: 0 }}
                title="Clear conversation"
              >
                <Trash2 size={10} />
                Clear
              </button>
            )}
          </div>

          {/* Conversation history scroll area */}
          {conversationHistory.length > 0 && (
            <div ref={scrollRef} style={{ maxHeight: '220px', overflowY: 'auto', marginBottom: '8px', padding: '8px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '4px' }}>
              {conversationHistory.map((entry, i) => (
                <div key={i} style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: i < conversationHistory.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                  <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '2px' }}>
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' · '}
                    <span style={{ color: entry.role === 'user' ? '#ffffff' : agentColor }}>
                      {entry.role === 'user' ? 'You' : agentName}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: entry.role === 'user' ? '#e5e7eb' : '#d1d5db', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                    {entry.content}
                  </div>
                </div>
              ))}
              {followUpLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0' }}>
                  <Loader2 size={12} style={{ color: agentColor, animation: 'spin 1s linear infinite' }} />
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>Thinking...</span>
                </div>
              )}
            </div>
          )}

          {/* Follow-up input with voice */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              ref={inputRef}
              value={followUpInput}
              onChange={e => setFollowUpInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleFollowUp()}
              placeholder="Ask a follow-up..."
              style={{ flex: 1, padding: '6px 10px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#e5e7eb', fontSize: '12px', outline: 'none' }}
            />
            {/* Voice input button */}
            <button
              onClick={handleVoiceInput}
              disabled={isListening}
              title={isListening ? 'Listening...' : 'Voice input'}
              style={{ padding: '6px 8px', backgroundColor: isListening ? `${agentColor}33` : 'rgba(255,255,255,0.05)', color: isListening ? agentColor : '#6b7280', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <Mic size={12} />
            </button>
            <button
              onClick={handleFollowUp}
              disabled={followUpLoading || !followUpInput.trim()}
              style={{ padding: '6px 12px', backgroundColor: `${agentColor}33`, color: agentColor, border: `1px solid ${agentColor}55`, borderRadius: '4px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', opacity: followUpLoading || !followUpInput.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Send size={10} />
              Ask
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
