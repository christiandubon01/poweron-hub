/**
 * Session Log preview — read-only seed snapshot from APP_BRAIN_SESSION_LOG.json.
 */

import { useMemo, useState } from 'react'
import { ScrollText } from 'lucide-react'
import sessionLogJson from '../../../../solarupgrade_agent_context/APP_BRAIN_SESSION_LOG.json'
import type { SessionLogRegistry } from './appBrainSessionLogTypes'
import {
  countSessionsByAgent,
  countRepassNeeded,
  findRecentSessions,
  summarizeSessionLog,
} from './appBrainSessionLogSummary'
import { AppBrainPanelShell, StatCard } from './appBrainPanelShared'

const SESSION_LOG = sessionLogJson as SessionLogRegistry

export default function AppBrainSessionLogPanel() {
  const [lookupQuery, setLookupQuery] = useState('')
  const summary = useMemo(() => summarizeSessionLog(SESSION_LOG), [])
  const byAgent = useMemo(() => countSessionsByAgent(SESSION_LOG.sessions), [])
  const recentSessions = useMemo(() => findRecentSessions(SESSION_LOG.sessions, 5), [])
  const repassCount = useMemo(() => countRepassNeeded(SESSION_LOG.sessions), [])

  const lookupMatches = useMemo(() => {
    const query = lookupQuery.trim().toLowerCase()
    if (!query) return []
    return SESSION_LOG.sessions.filter(
      (session) =>
        session.sessionId.toLowerCase().includes(query) ||
        session.task.toLowerCase().includes(query) ||
        session.filesChanged.some((file) => file.toLowerCase().includes(query)),
    )
  }, [lookupQuery])

  return (
    <AppBrainPanelShell
      mode="runtime"
      title="Session Log"
      subtitle="Build workflow audit trail from seed registry — not live session tracking"
      icon={<ScrollText size={18} />}
      accent="#34d399"
    >
      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.16)' }}
      >
        <p className="text-xs text-emerald-100/90 leading-relaxed">
          Snapshot from <span className="font-mono">APP_BRAIN_SESSION_LOG.json</span> v
          {SESSION_LOG.metadata.version}. File/session lookup is a read-only placeholder — no mutation or live
          ingestion.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Sessions" value={summary.totalSessions} color="#34d399" />
        <StatCard label="Success rate" value={`${Math.round(summary.successRate * 100)}%`} color="#22d3ee" />
        <StatCard label="Repass needed" value={repassCount} color="#facc15" />
        <StatCard label="Unique lessons" value={summary.totalUniqueLessons} color="#a78bfa" />
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Sessions by agent</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(byAgent)
            .filter(([, count]) => count > 0)
            .map(([agent, count]) => (
              <div
                key={agent}
                className="rounded-lg p-2 flex justify-between text-[11px] font-mono"
                style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(148,163,184,0.12)' }}
              >
                <span className="text-gray-400">{agent}</span>
                <span className="text-gray-200">{count}</span>
              </div>
            ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Recent sessions</p>
        <div className="space-y-2">
          {recentSessions.map((session) => (
            <div
              key={session.sessionId}
              className="rounded-lg p-3"
              style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(148,163,184,0.12)' }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-gray-200">{session.task}</p>
                <span className="text-[10px] font-mono text-gray-500 shrink-0">{session.status}</span>
              </div>
              <p className="text-[10px] font-mono text-gray-500 mt-1">{session.sessionId}</p>
              <p className="text-[10px] text-gray-600 mt-1">
                {session.agent} · {session.domain} · {session.filesChanged.length} files
              </p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1.5">File / session lookup (placeholder)</p>
        <input
          value={lookupQuery}
          onChange={(event) => setLookupQuery(event.target.value)}
          placeholder="Search session ID, task, or file path..."
          className="w-full rounded-xl px-3 py-2 text-sm outline-none"
          style={{
            background: 'rgba(3,7,18,0.72)',
            border: '1px solid rgba(148,163,184,0.16)',
            color: '#dbeafe',
          }}
        />
        {lookupQuery.trim() ? (
          <div className="mt-2 space-y-1">
            {lookupMatches.length > 0 ? (
              lookupMatches.map((session) => (
                <p key={session.sessionId} className="text-[11px] font-mono text-gray-400">
                  {session.sessionId} — {session.task}
                </p>
              ))
            ) : (
              <p className="text-[11px] text-gray-500">No matching sessions in seed registry.</p>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-gray-600 mt-2">Type to filter seed sessions — read-only preview.</p>
        )}
      </div>
    </AppBrainPanelShell>
  )
}

export { AppBrainSessionLogPanel }
