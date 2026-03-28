// @ts-nocheck
/**
 * ProactiveInsightCard — Shared card for displaying AI agent proactive insights.
 *
 * Shows loading skeleton, AI response, error state, empty proactive suggestion,
 * and a "Dive Deeper" button for follow-up analysis.
 */

import React, { useState } from 'react'
import { Sparkles, RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { callClaude, extractText } from '@/services/claudeProxy'

interface ProactiveInsightCardProps {
  agentName: string
  agentColor: string // tailwind color like '#10b981'
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
  const [diveDeeper, setDiveDeeper] = useState(false)
  const [deepResponse, setDeepResponse] = useState('')
  const [deepLoading, setDeepLoading] = useState(false)
  const [deepInput, setDeepInput] = useState('')

  const handleDiveDeeper = async () => {
    if (!deepInput.trim() || !systemPrompt) return
    setDeepLoading(true)
    try {
      const result = await callClaude({
        system: systemPrompt,
        messages: [
          { role: 'assistant', content: response },
          { role: 'user', content: deepInput },
        ],
        max_tokens: 1024,
      })
      setDeepResponse(extractText(result))
    } catch (err) {
      setDeepResponse('Error: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setDeepLoading(false)
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

      {/* Dive Deeper */}
      {!loading && response && systemPrompt && (
        <div style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
          <button
            onClick={() => setDiveDeeper(!diveDeeper)}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: agentColor, fontSize: '12px', fontWeight: '600', cursor: 'pointer', padding: 0 }}
          >
            {diveDeeper ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Dive Deeper
          </button>

          {diveDeeper && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
              <input
                value={deepInput}
                onChange={e => setDeepInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleDiveDeeper()}
                placeholder="Ask a follow-up question..."
                style={{ flex: 1, padding: '6px 10px', backgroundColor: '#1e2130', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#e5e7eb', fontSize: '12px' }}
              />
              <button
                onClick={handleDiveDeeper}
                disabled={deepLoading || !deepInput.trim()}
                style={{ padding: '6px 12px', backgroundColor: `${agentColor}33`, color: agentColor, border: `1px solid ${agentColor}55`, borderRadius: '4px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', opacity: deepLoading ? 0.5 : 1 }}
              >
                {deepLoading ? '...' : 'Ask'}
              </button>
            </div>
          )}

          {deepResponse && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#d1d5db', lineHeight: '1.5', padding: '8px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>
              {deepResponse}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
