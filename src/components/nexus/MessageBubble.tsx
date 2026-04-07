/**
 * MessageBubble — Individual chat message with role, timestamp,
 * agent attribution badge, and impact level indicator.
 */

import { clsx } from 'clsx'
import type { ImpactLevel } from '@/agents/nexus/classifier'
import { renderMarkdown } from '@/components/voice/VoiceTranscriptPanel'

// ── Strip internal routing commentary from agent response content ────────────
// Removes phrases like "Routing to BLUEPRINT:", "I'll forward this to SPARK:", etc.
// that occasionally appear at the start of AI responses before the real answer.
function stripRoutingCommentary(content: string): string {
  return content
    // "Routing to AGENT:" / "Routing this to AGENT:"
    .replace(/^Routing\s+(?:this\s+)?(?:query\s+)?to\s+[A-Z]+[:\s—–-]+/i, '')
    // "Forwarding to AGENT:" / "Sending to AGENT:"
    .replace(/^(?:Forwarding|Sending|Handing(?:\s+off)?|Escalating|Passing)\s+(?:this\s+)?(?:query\s+)?to\s+[A-Z]+[:\s—–-]+/i, '')
    // "I'll route this to AGENT:" / "I'm routing to AGENT:"
    .replace(/^I(?:'ll|'m| will| am)\s+(?:route|forward|send|hand|pass)(?:ing)?\s+(?:this\s+)?(?:query\s+)?(?:to|over\s+to)\s+[A-Z]+[:\s—–-]+/i, '')
    // "→ AGENT:" arrow-style prefix
    .replace(/^[→>]\s*[A-Z]+[:\s—–-]+/, '')
    .trim()
}

// ── Agent colors (matches tailwind.config.ts agent tokens) ──────────────────

const AGENT_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  nexus:     { text: 'text-nexus',     bg: 'bg-[rgba(46,232,154,0.10)]',  border: 'border-[rgba(46,232,154,0.25)]' },
  vault:     { text: 'text-vault',     bg: 'bg-[rgba(255,210,74,0.10)]',  border: 'border-[rgba(255,210,74,0.25)]' },
  pulse:     { text: 'text-pulse',     bg: 'bg-[rgba(58,142,255,0.10)]',  border: 'border-[rgba(58,142,255,0.25)]' },
  ledger:    { text: 'text-ledger',    bg: 'bg-[rgba(64,212,255,0.10)]',  border: 'border-[rgba(64,212,255,0.25)]' },
  spark:     { text: 'text-spark',     bg: 'bg-[rgba(255,95,160,0.10)]',  border: 'border-[rgba(255,95,160,0.25)]' },
  blueprint: { text: 'text-blueprint', bg: 'bg-[rgba(170,110,255,0.10)]', border: 'border-[rgba(170,110,255,0.25)]' },
  ohm:       { text: 'text-ohm',      bg: 'bg-[rgba(168,255,62,0.10)]',  border: 'border-[rgba(168,255,62,0.25)]' },
  chrono:    { text: 'text-chrono',    bg: 'bg-[rgba(255,144,64,0.10)]',  border: 'border-[rgba(255,144,64,0.25)]' },
  scout:     { text: 'text-scout',     bg: 'bg-[rgba(255,80,96,0.10)]',   border: 'border-[rgba(255,80,96,0.25)]' },
}

const AGENT_DISPLAY: Record<string, string> = {
  nexus: 'NEXUS', vault: 'VAULT', pulse: 'PULSE', ledger: 'LEDGER',
  spark: 'SPARK', blueprint: 'BLUEPRINT', ohm: 'OHM', chrono: 'CHRONO', scout: 'SCOUT',
}

const IMPACT_STYLES: Record<ImpactLevel, { label: string; color: string }> = {
  LOW:      { label: 'LOW',      color: 'text-text-3' },
  MEDIUM:   { label: 'MEDIUM',   color: 'text-gold' },
  HIGH:     { label: 'HIGH',     color: 'text-orange' },
  CRITICAL: { label: 'CRITICAL', color: 'text-red' },
}

// ── Props ───────────────────────────────────────────────────────────────────

export interface MessageBubbleProps {
  role:          'user' | 'assistant'
  content:       string
  timestamp:     number
  agentId?:      string
  impactLevel?:  ImpactLevel
  isLoading?:    boolean
}

// ── Component ───────────────────────────────────────────────────────────────

export function MessageBubble({
  role,
  content,
  timestamp,
  agentId,
  impactLevel,
  isLoading,
}: MessageBubbleProps) {
  const isUser       = role === 'user'
  const agentColor   = agentId ? AGENT_COLORS[agentId] ?? AGENT_COLORS.nexus : AGENT_COLORS.nexus
  const displayName  = agentId ? AGENT_DISPLAY[agentId] ?? 'NEXUS' : 'NEXUS'
  const impact       = impactLevel ? IMPACT_STYLES[impactLevel] : null
  const time         = new Date(timestamp)
  const timeStr      = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // Strip any internal routing commentary before rendering assistant content
  const cleanContent = !isUser ? stripRoutingCommentary(content) : content

  return (
    <div
      className={clsx(
        'group flex gap-3 animate-fade-in',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      {!isUser && (
        <div
          className={clsx(
            'w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 mt-1',
            agentColor.bg,
            agentColor.border
          )}
        >
          <span className={clsx('text-[9px] font-mono font-bold', agentColor.text)}>
            {displayName.charAt(0)}
          </span>
        </div>
      )}

      {/* Bubble */}
      <div
        className={clsx(
          'max-w-[80%] rounded-2xl px-4 py-3',
          isUser
            ? 'bg-bg-3 border border-bg-5 text-text-1'
            : 'bg-bg-2 border border-bg-4 text-text-1'
        )}
      >
        {/* Agent badge + impact indicator (assistant only) */}
        {!isUser && (
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={clsx(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider border',
                agentColor.bg,
                agentColor.border,
                agentColor.text
              )}
            >
              {displayName}
            </span>

            {impact && impact.label !== 'LOW' && (
              <span className={clsx('text-[9px] font-mono font-bold uppercase', impact.color)}>
                {impact.label}
              </span>
            )}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center gap-1.5 py-1">
            <span className="w-1.5 h-1.5 bg-green rounded-full animate-pulse" />
            <span className="w-1.5 h-1.5 bg-green rounded-full animate-pulse [animation-delay:0.2s]" />
            <span className="w-1.5 h-1.5 bg-green rounded-full animate-pulse [animation-delay:0.4s]" />
          </div>
        ) : (
          isUser ? (
            <div className="text-sm text-text-2 leading-relaxed whitespace-pre-wrap">
              {content}
            </div>
          ) : (
            <div
              className="text-sm text-text-2 leading-relaxed nexus-markdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(cleanContent) }}
            />
          )
        )}

        {/* Timestamp */}
        <div
          className={clsx(
            'mt-1.5 text-[10px] text-text-4 opacity-0 group-hover:opacity-100 transition-opacity',
            isUser ? 'text-right' : 'text-left'
          )}
        >
          {timeStr}
        </div>
      </div>
    </div>
  )
}


// ── AgentBadge (exported for use in proposal cards etc.) ────────────────────

export function AgentBadge({ agentId }: { agentId: string }) {
  const color = AGENT_COLORS[agentId] ?? AGENT_COLORS.nexus
  const name  = AGENT_DISPLAY[agentId] ?? 'NEXUS'

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider border',
        color.bg, color.border, color.text
      )}
    >
      {name}
    </span>
  )
}
