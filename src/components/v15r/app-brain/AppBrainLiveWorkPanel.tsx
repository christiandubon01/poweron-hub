import { Activity } from 'lucide-react'
import type { AgentModel, LiveWorkSession } from './appBrainWorkTypes'
import { APP_BRAIN_ACTIVE_SESSIONS } from './appBrainSeedData'
import { AppBrainPanelShell, StatCard } from './appBrainPanelShared'

const AGENT_ORDER: AgentModel[] = ['Claude', 'Codex', 'Cursor', 'Haiku', 'Manual/Owner']

const AGENT_COLORS: Record<string, string> = {
  Claude: '#a78bfa',
  Codex: '#34d399',
  Cursor: '#22d3ee',
  Haiku: '#facc15',
  'Manual/Owner': '#fb7185',
}

const STATUS_COLORS: Record<string, string> = {
  active: '#34d399',
  pending: '#94a3b8',
  paused: '#facc15',
  blocked: '#fb7185',
  completed: '#60a5fa',
  failed: '#ef4444',
  idle: '#6b7280',
}

function SessionCard({ session }: { session: LiveWorkSession }) {
  const accent = AGENT_COLORS[session.agent] ?? '#94a3b8'
  const statusColor = STATUS_COLORS[session.status] ?? '#94a3b8'

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: 'rgba(3,7,18,0.58)', border: `1px solid ${accent}28` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: accent }}>
            {session.agent}
          </p>
          <p className="text-sm font-mono text-gray-400 mt-0.5">{session.model}</p>
        </div>
        <span
          className="text-[10px] uppercase tracking-wider font-mono px-2 py-1 rounded-full"
          style={{ color: statusColor, background: `${statusColor}14`, border: `1px solid ${statusColor}33` }}
        >
          {session.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <p className="text-gray-500 uppercase tracking-wider text-[9px]">Domain</p>
          <p className="text-gray-300 font-mono mt-0.5">{session.domain}</p>
        </div>
        <div>
          <p className="text-gray-500 uppercase tracking-wider text-[9px]">Risk</p>
          <p className="text-gray-300 font-mono mt-0.5">{session.riskLevel}</p>
        </div>
        <div>
          <p className="text-gray-500 uppercase tracking-wider text-[9px]">Context health</p>
          <p className="text-gray-300 font-mono mt-0.5">{session.contextHealth}</p>
        </div>
        <div>
          <p className="text-gray-500 uppercase tracking-wider text-[9px]">Typecheck</p>
          <p className="text-gray-300 font-mono mt-0.5">{session.typecheckResult}</p>
        </div>
      </div>

      <div>
        <p className="text-[9px] uppercase tracking-wider text-gray-500">Current task</p>
        <p className="text-xs text-gray-200 mt-1 leading-relaxed">{session.currentTask}</p>
      </div>

      <div>
        <p className="text-[9px] uppercase tracking-wider text-gray-500">Next action</p>
        <p className="text-xs text-cyan-100/90 mt-1 leading-relaxed">{session.nextAction}</p>
      </div>

      <div>
        <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1.5">Claimed files</p>
        {session.claimedFiles.length > 0 ? (
          <div className="space-y-1">
            {session.claimedFiles.slice(0, 4).map((file) => (
              <p key={file.path} className="text-[10px] font-mono text-gray-400 truncate">{file.path}</p>
            ))}
            {session.claimedFiles.length > 4 && (
              <p className="text-[10px] text-gray-600">+{session.claimedFiles.length - 4} more</p>
            )}
          </div>
        ) : (
          <p className="text-[10px] text-gray-600 font-mono">No claimed files yet</p>
        )}
      </div>
    </div>
  )
}

export default function AppBrainLiveWorkPanel() {
  const data = APP_BRAIN_ACTIVE_SESSIONS
  const sessions = Object.values(data.sessions)
  const sessionsByAgent = new Map(sessions.map((s) => [s.agent, s]))

  return (
    <AppBrainPanelShell
      title="Live Work"
      subtitle="Agent session cards from Wave 01 seed registry"
      icon={<Activity size={18} />}
      accent="#22d3ee"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active sessions" value={data.totalActiveSessions} color="#22d3ee" />
        <StatCard label="Healthy" value={data.overallHealthy ? 'Yes' : 'No'} color="#34d399" />
        <StatCard label="Typecheck pass rate" value={`${data.typeCheckPassRate}%`} color="#a78bfa" />
        <StatCard label="Critical sessions" value={data.criticalSessions} color="#fb7185" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {AGENT_ORDER.map((agent) => {
          const session = sessionsByAgent.get(agent)
          if (!session) {
            return (
              <div
                key={agent}
                className="rounded-xl p-4 flex items-center justify-center min-h-[160px]"
                style={{ background: 'rgba(3,7,18,0.4)', border: '1px dashed rgba(148,163,184,0.2)' }}
              >
                <p className="text-xs text-gray-600">{agent} — no seed session</p>
              </div>
            )
          }
          return <SessionCard key={session.sessionId} session={session} />
        })}
      </div>
    </AppBrainPanelShell>
  )
}
