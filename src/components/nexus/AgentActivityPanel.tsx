// @ts-nocheck
/**
 * AgentActivityPanel — NEXUS Agent Activity indicator.
 *
 * Shows:
 * - Live status dot: green (healthy) | yellow (queued) | red (error)
 * - Last 5 messages routed (from → to, type, timestamp)
 *
 * Polls the agentBus every 4 seconds for fresh routing data.
 * Collapses to a single status dot when there is no activity.
 */

import { useState, useEffect, useCallback } from 'react'
import { Activity } from 'lucide-react'
import { getRecentRouted, type AgentMessage } from '@/services/agentBus'
import { getBusHealth, type BusHealth } from '@/agents/nexus/arbitration'

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(timestamp: number): string {
  const ago = Math.round((Date.now() - timestamp) / 1000)
  if (ago < 5)  return 'just now'
  if (ago < 60) return `${ago}s ago`
  const mins = Math.round(ago / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

const TYPE_LABEL: Record<string, string> = {
  data_updated: 'update',
  alert:        'alert',
  request:      'req',
  response:     'resp',
  broadcast:    'bcast',
  conflict:     'conflict',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentActivityPanel() {
  const [health, setHealth]   = useState<BusHealth>('healthy')
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [expanded, setExpanded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [h, msgs] = await Promise.all([
        getBusHealth(),
        getRecentRouted(5),
      ])
      setHealth(h)
      setMessages(msgs)
    } catch {
      setHealth('error')
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 4000)
    return () => clearInterval(interval)
  }, [refresh])

  // Status dot colors
  const dotColor =
    health === 'healthy' ? 'bg-green-400'  :
    health === 'queued'  ? 'bg-yellow-400' :
    'bg-red-400'

  const dotLabel =
    health === 'healthy' ? 'Bus healthy'   :
    health === 'queued'  ? 'Messages queued' :
    'Bus error'

  return (
    <div className="border-b border-bg-4 bg-bg-1/60">
      {/* Collapsed header row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-bg-2/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-3 h-3 text-text-3" />
          <span className="text-[10px] font-mono font-bold text-text-3 uppercase tracking-widest">
            Agent Activity
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dotColor} ${health === 'healthy' ? 'animate-pulse' : ''}`} />
          <span className="text-[10px] text-text-4 font-mono">{dotLabel}</span>
        </div>
      </button>

      {/* Expanded message log */}
      {expanded && (
        <div className="px-4 pb-3 space-y-1">
          {messages.length === 0 ? (
            <div className="text-[10px] text-text-4 font-mono py-1">No recent messages</div>
          ) : (
            messages.map(msg => (
              <div
                key={msg.id}
                className="flex items-center gap-2 py-0.5"
              >
                {/* From → To */}
                <span className="text-[10px] font-mono text-green font-bold min-w-[40px]">
                  {msg.from}
                </span>
                <span className="text-[10px] text-text-4">→</span>
                <span className="text-[10px] font-mono text-text-2 font-bold min-w-[46px]">
                  {msg.to}
                </span>

                {/* Type badge */}
                <span className="px-1.5 py-0.5 rounded bg-bg-3 text-[9px] font-mono text-text-3 uppercase">
                  {TYPE_LABEL[msg.type] ?? msg.type}
                </span>

                {/* Timestamp */}
                <span className="ml-auto text-[9px] text-text-4 font-mono whitespace-nowrap">
                  {relativeTime(msg.timestamp)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
