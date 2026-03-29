// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, ChevronRight, X, Copy, Save } from 'lucide-react'
import { addLearnedPattern } from '@/services/nexusMemory'

// Types
export interface TranscriptEntry {
  id: string
  timestamp: number
  userText: string
  nexusText: string
  agent?: string
}

export interface VoiceSession {
  id: string
  entries: TranscriptEntry[]
  startedAt: number
  summary: string
}

export interface VoiceTranscriptPanelProps {
  isOpen: boolean
  onClose: () => void
  onMinimize: () => void
  isMinimized: boolean
  onMaximize: () => void
}

// Agent colors
const AGENT_COLORS: Record<string, string> = {
  nexus: '#8b5cf6',
  vault: '#f59e0b',
  pulse: '#06b6d4',
  ledger: '#10b981',
  spark: '#ec4899',
  blueprint: '#3b82f6',
  ohm: '#f97316',
  chrono: '#a855f7',
  scout: '#6366f1',
}

// Storage key
const STORAGE_KEY = 'voice_transcript_history'

// Global state
let currentSession: VoiceSession | null = null
let sessionHistory: VoiceSession[] = []

// Initialize from localStorage
function initializeStorage() {
  if (typeof window === 'undefined') return

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const data = JSON.parse(stored)
      sessionHistory = data.history || []
      currentSession = data.current || null
    } else {
      sessionHistory = []
      currentSession = null
    }
  } catch (e) {
    console.error('Failed to load voice transcript history:', e)
    sessionHistory = []
    currentSession = null
  }
}

// Save to localStorage
function persistSessions() {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        history: sessionHistory,
        current: currentSession,
      })
    )
  } catch (e) {
    console.error('Failed to persist voice transcript history:', e)
  }
}

// Exported functions
export function addTranscriptEntry(
  userText: string,
  nexusText: string,
  agent?: string
): TranscriptEntry {
  if (!currentSession) {
    startNewSession()
  }

  const entry: TranscriptEntry = {
    id: `entry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    userText,
    nexusText,
    agent,
  }

  currentSession!.entries.push(entry)
  currentSession!.summary = generateSessionSummary(currentSession!.entries)

  persistSessions()
  return entry
}

export function startNewSession(): void {
  if (currentSession && currentSession.entries.length > 0) {
    sessionHistory.push(currentSession)
  }

  currentSession = {
    id: `session-${Date.now()}`,
    entries: [],
    startedAt: Date.now(),
    summary: '',
  }

  persistSessions()
}

export function getCurrentSession(): VoiceSession | null {
  return currentSession
}

export function getSessionHistory(): VoiceSession[] {
  return sessionHistory
}

function generateSessionSummary(entries: TranscriptEntry[]): string {
  if (entries.length === 0) {
    return 'Session summary: No exchanges yet.'
  }

  // Extract topics from user inputs and NEXUS responses
  const allText = entries
    .map((e) => `${e.userText} ${e.nexusText}`)
    .join(' ')
    .toLowerCase()

  const topicKeywords = [
    'project',
    'estimate',
    'invoice',
    'schedule',
    'electrical',
    'contractor',
    'customer',
    'payment',
    'quote',
    'installation',
    'maintenance',
    'safety',
    'compliance',
  ]

  const foundTopics = topicKeywords.filter((keyword) =>
    allText.includes(keyword)
  )

  const agents = [...new Set(entries.map((e) => e.agent).filter(Boolean))]

  let summary = `Session summary: Discussed ${foundTopics.length > 0 ? foundTopics.join(', ') : 'general topics'}.`

  if (agents.length > 0) {
    summary += ` Agents: ${agents.join(', ')}.`
  }

  summary += ` Exchanges: ${entries.length}.`

  return summary
}

// ── Markdown Renderer ────────────────────────────────────────────────────────

/**
 * Lightweight markdown-to-HTML converter for agent responses.
 * Handles: ## headers, **bold**, *italic*, bullet lists (- / *), numbered lists,
 * inline `code`, and paragraph breaks. No external dependencies.
 */
export function renderMarkdown(md: string): string {
  return md
    // Escape HTML entities first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers: ## → <div> styled heading (supports h2-h4)
    .replace(/^####\s+(.+)$/gm, '<div style="font-size:12px;font-weight:700;color:#d1d5db;margin:10px 0 4px">$1</div>')
    .replace(/^###\s+(.+)$/gm, '<div style="font-size:13px;font-weight:700;color:#e5e7eb;margin:12px 0 4px">$1</div>')
    .replace(/^##\s+(.+)$/gm, '<div style="font-size:14px;font-weight:700;color:#f3f4f6;margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.08)">$1</div>')
    // Bold: **text** → <strong>
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#f3f4f6;font-weight:600">$1</strong>')
    // Italic: *text* → <em>
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Inline code: `text` → <code>
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.06);padding:1px 4px;border-radius:3px;font-size:10px;font-family:monospace">$1</code>')
    // Numbered list items: "1. text" → styled div
    .replace(/^\s*(\d+)\.\s+(.+)$/gm, '<div style="padding-left:16px;margin:2px 0;position:relative"><span style="position:absolute;left:0;color:#9ca3af;font-size:10px;font-weight:600">$1.</span>$2</div>')
    // Bullet list items: "- text" or "* text" → styled div with dot
    .replace(/^\s*[-*]\s+(.+)$/gm, '<div style="padding-left:14px;margin:2px 0;position:relative"><span style="position:absolute;left:2px;top:6px;width:4px;height:4px;border-radius:50%;background:#6b7280"></span>$1</div>')
    // Double newlines → paragraph break
    .replace(/\n\n/g, '<div style="margin:8px 0"></div>')
    // Single newlines → line break
    .replace(/\n/g, '<br/>')
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Detect if text contains markdown formatting (headers, bullets, bold, etc.) */
function hasMarkdown(text: string): boolean {
  return /^#{1,6}\s|^\s*[-*]\s|\*\*[^*]+\*\*|^\d+\.\s/m.test(text)
}

/** Strip markdown to a short voice-friendly preview (first ~2 sentences) */
function voicePreview(text: string): string {
  const stripped = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]\s*/gu, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim()
  // First ~2 sentences
  const sentences = stripped.split(/(?<=[.!?])\s+/)
  return sentences.slice(0, 2).join(' ')
}

// ── NexusResponseBlock — shows voice summary + expandable Full Report ────────

function NexusResponseBlock({ entry }: { entry: TranscriptEntry }) {
  const [expanded, setExpanded] = useState(false)
  const isRichReport = hasMarkdown(entry.nexusText) && entry.nexusText.length > 300
  const preview = isRichReport ? voicePreview(entry.nexusText) : entry.nexusText

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: '#06b6d4', whiteSpace: 'nowrap' }}>
        NEXUS:
      </span>
      <div style={{ flex: 1 }}>
        {/* Voice-friendly preview (always shown) */}
        <div style={{ fontSize: '12px', color: '#d1d5db', marginBottom: '6px', lineHeight: '1.5' }}>
          {isRichReport ? preview + (preview.endsWith('.') ? '' : '...') : entry.nexusText}
        </div>

        {/* Full Report accordion for rich markdown responses */}
        {isRichReport && (
          <div style={{ marginBottom: '6px' }}>
            <button
              onClick={() => setExpanded(prev => !prev)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'rgba(139,92,246,0.12)',
                border: '1px solid rgba(139,92,246,0.25)',
                borderRadius: '6px',
                padding: '4px 10px',
                color: '#a78bfa',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                transition: 'background 0.2s',
              }}
            >
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Full Report
            </button>
            {expanded && (
              <div
                style={{
                  marginTop: '8px',
                  padding: '10px 12px',
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.05)',
                  fontSize: '11px',
                  color: '#d1d5db',
                  lineHeight: '1.6',
                  maxHeight: '300px',
                  overflowY: 'auto',
                }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.nexusText) }}
              />
            )}
          </div>
        )}

        {/* Agent badge */}
        {entry.agent && (
          <div
            style={{
              display: 'inline-block',
              background: AGENT_COLORS[entry.agent.toLowerCase()] || '#8b5cf6',
              color: 'white',
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '999px',
              opacity: 0.8,
            }}
          >
            {entry.agent}
          </div>
        )}
      </div>
    </div>
  )
}

// Component
export const VoiceTranscriptPanel: React.FC<VoiceTranscriptPanelProps> = ({
  isOpen,
  onClose,
  onMinimize,
  isMinimized,
  onMaximize,
}) => {
  const [session, setSession] = useState<VoiceSession | null>(null)
  const [summary, setSummary] = useState<string>('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  // Initialize on mount
  useEffect(() => {
    initializeStorage()
    if (!currentSession) {
      startNewSession()
    }
    setSession(currentSession)
    setSummary(currentSession?.summary || '')
  }, [])

  // Subscribe to session updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (currentSession !== session) {
        setSession({ ...currentSession! })
        setSummary(currentSession?.summary || '')
      }
    }, 500)

    return () => clearInterval(interval)
  }, [session])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [session?.entries.length])

  const handleNewSession = useCallback(() => {
    startNewSession()
    setSession({ ...currentSession! })
    setSummary('')
  }, [])

  const handleCopySummary = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      console.error('Failed to copy summary:', e)
    }
  }, [summary])

  const handleSaveToMemory = useCallback(async () => {
    if (!session || session.entries.length === 0) return

    try {
      // Compile conversation context
      const context = session.entries
        .map((e) => `User: ${e.userText}\nNEXUS (${e.agent || 'general'}): ${e.nexusText}`)
        .join('\n\n')

      await addLearnedPattern({
        pattern: summary,
        context,
        category: 'voice_session',
        timestamp: Date.now(),
      })

      // Visual feedback
      alert('Session saved to NEXUS Memory!')
    } catch (e) {
      console.error('Failed to save to memory:', e)
      alert('Error saving to memory. Please try again.')
    }
  }, [session, summary])

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp)
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
  }

  if (!isOpen) return null

  // Minimized state
  if (isMinimized) {
    return (
      <div
        onClick={onMaximize}
        style={{
          position: 'fixed',
          bottom: '90px',
          right: '24px',
          background: '#232738',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '999px',
          padding: '8px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          zIndex: 49,
          fontSize: '12px',
          fontWeight: 600,
          color: 'white',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#2a2f42'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = '#232738'
        }}
      >
        <span>NEXUS</span>
        <span
          style={{
            background: '#8b5cf6',
            color: 'white',
            borderRadius: '10px',
            padding: '2px 6px',
            fontSize: '10px',
            fontWeight: 700,
          }}
        >
          {session?.entries.length || 0}
        </span>
      </div>
    )
  }

  // Full panel
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '90px',
        right: '24px',
        width: '380px',
        maxHeight: '500px',
        background: '#1a1d2e',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 49,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: '13px',
            fontWeight: 700,
            color: 'white',
          }}
        >
          NEXUS Voice Session
        </h3>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={handleNewSession}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#9ca3af',
              fontSize: '11px',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
              e.currentTarget.style.color = '#e5e7eb'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#9ca3af'
            }}
          >
            New Session
          </button>

          <button
            onClick={onMinimize}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#d1d5db'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#6b7280'
            }}
          >
            <ChevronDown size={16} />
          </button>

          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#d1d5db'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#6b7280'
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          minHeight: 0,
        }}
      >
        {session?.entries && session.entries.length > 0 ? (
          session.entries.map((entry, index) => (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                paddingBottom: index < session.entries.length - 1 ? '12px' : 0,
                borderBottom:
                  index < session.entries.length - 1
                    ? '1px solid rgba(255,255,255,0.05)'
                    : 'none',
              }}
            >
              <div style={{ fontSize: '10px', color: '#6b7280' }}>
                {formatTime(entry.timestamp)}
              </div>

              {/* User text */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'white',
                    whiteSpace: 'nowrap',
                  }}
                >
                  You:
                </span>
                <span style={{ fontSize: '12px', color: '#d1d5db' }}>
                  {entry.userText}
                </span>
              </div>

              {/* NEXUS response — with Full Report accordion for markdown responses */}
              <NexusResponseBlock entry={entry} />
            </div>
          ))
        ) : (
          <div
            style={{
              fontSize: '12px',
              color: '#6b7280',
              textAlign: 'center',
              padding: '32px 0',
            }}
          >
            No conversation yet. Start speaking to begin transcription.
          </div>
        )}
      </div>

      {/* Bottom sticky section */}
      <div
        style={{
          padding: '16px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          background: '#1a1d2e',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* Summary */}
        <div
          style={{
            fontSize: '11px',
            fontStyle: 'italic',
            color: '#9ca3af',
            lineHeight: '1.5',
          }}
        >
          {summary || 'Session summary: No exchanges yet.'}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleCopySummary}
            style={{
              flex: 1,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#d1d5db',
              fontSize: '12px',
              fontWeight: 600,
              padding: '8px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
            }}
          >
            <Copy size={14} />
            {copied ? 'Copied!' : 'Copy Summary'}
          </button>

          <button
            onClick={handleSaveToMemory}
            disabled={!session?.entries.length}
            style={{
              flex: 1,
              background: session?.entries.length
                ? 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)'
                : 'rgba(139, 92, 246, 0.4)',
              border: 'none',
              color: 'white',
              fontSize: '12px',
              fontWeight: 600,
              padding: '8px 12px',
              borderRadius: '6px',
              cursor: session?.entries.length ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (session?.entries.length) {
                e.currentTarget.style.opacity = '0.85'
              }
            }}
            onMouseLeave={(e) => {
              if (session?.entries.length) {
                e.currentTarget.style.opacity = '1'
              }
            }}
          >
            <Save size={14} />
            Save to Memory
          </button>
        </div>
      </div>
    </div>
  )
}

export default VoiceTranscriptPanel
