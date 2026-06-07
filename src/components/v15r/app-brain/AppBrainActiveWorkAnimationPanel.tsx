/**
 * Active Work Animation preview — animation model only, not live 3D rendering.
 */

import { useMemo } from 'react'
import { Activity } from 'lucide-react'
import { APP_BRAIN_ACTIVE_SESSIONS } from './appBrainSeedData'
import type { AgentType, AnimationState } from './appBrainActiveWorkAnimationTypes'
import {
  buildActiveWorkAnimationSnapshot,
  createAgentSessionVisualState,
  deriveDomainPulseState,
  deriveOverlapWarningAnimation,
} from './appBrainActiveWorkAnimationModel'
import type { AgentModel, LiveWorkSession } from './appBrainWorkTypes'
import { AppBrainPanelShell, SceneWiredBadge, StatCard } from './appBrainPanelShared'

const AGENT_TYPES: AgentType[] = ['Claude', 'Codex', 'Cursor', 'Haiku', 'Manual/Owner']

const AGENT_COLORS: Record<AgentType, string> = {
  Claude: '#a78bfa',
  Codex: '#34d399',
  Cursor: '#22d3ee',
  Haiku: '#facc15',
  'Manual/Owner': '#fb7185',
}

const STATE_COLORS: Record<AnimationState, string> = {
  idle: '#94a3b8',
  planned: '#60a5fa',
  running: '#34d399',
  blocked: '#fb7185',
  'ready-for-qa': '#facc15',
  complete: '#22d3ee',
  'repass-needed': '#fb923c',
}

const STATE_LEGEND: Array<{ state: AnimationState; label: string }> = [
  { state: 'idle', label: 'Idle' },
  { state: 'planned', label: 'Planned' },
  { state: 'running', label: 'Running' },
  { state: 'blocked', label: 'Blocked' },
  { state: 'ready-for-qa', label: 'Ready for QA' },
  { state: 'complete', label: 'Complete' },
  { state: 'repass-needed', label: 'Repass needed' },
]

function mapSessionStatus(status: LiveWorkSession['status']): AnimationState {
  switch (status) {
    case 'active':
      return 'running'
    case 'pending':
      return 'planned'
    case 'blocked':
      return 'blocked'
    case 'completed':
      return 'complete'
    case 'failed':
      return 'repass-needed'
    case 'paused':
    case 'idle':
    default:
      return 'idle'
  }
}

function toAgentType(agent: AgentModel): AgentType {
  if (agent === 'Claude' || agent === 'Codex' || agent === 'Cursor' || agent === 'Haiku') {
    return agent
  }
  return 'Manual/Owner'
}

export default function AppBrainActiveWorkAnimationPanel() {
  const snapshot = useMemo(() => {
    const sessions = Object.values(APP_BRAIN_ACTIVE_SESSIONS.sessions)
    const agentSessions = {} as Record<AgentType, ReturnType<typeof createAgentSessionVisualState>>

    for (const agentType of AGENT_TYPES) {
      const match = sessions.find((s) => toAgentType(s.agent) === agentType)
      if (match) {
        const animationState = mapSessionStatus(match.status)
        agentSessions[agentType] = createAgentSessionVisualState(
          agentType,
          animationState,
          match.sessionId,
          match.domain,
          {
            fileCount: match.touchedFiles.length,
            typecheckPass: match.typecheckResult === 'pass',
            buildPass: match.status !== 'failed',
          },
        )
      } else {
        agentSessions[agentType] = createAgentSessionVisualState(agentType, 'idle')
      }
    }

    const domainMap = new Map<string, { active: number; blocked: number; agents: AgentType[] }>()
    for (const session of sessions) {
      const entry = domainMap.get(session.domain) ?? { active: 0, blocked: 0, agents: [] }
      if (session.status === 'active' || session.status === 'pending') {
        entry.active += 1
      }
      if (session.status === 'blocked') {
        entry.blocked += 1
      }
      const agentType = toAgentType(session.agent)
      if (!entry.agents.includes(agentType)) {
        entry.agents.push(agentType)
      }
      domainMap.set(session.domain, entry)
    }

    const domainPulses = Object.fromEntries(
      Array.from(domainMap.entries()).map(([domainId, stats]) => [
        domainId,
        deriveDomainPulseState(
          domainId,
          domainId,
          stats.active,
          stats.blocked,
          {},
          stats.agents,
        ),
      ]),
    )

    const overlapWarnings = [
      deriveOverlapWarningAnimation(
        'sample-overlap-app-brain',
        'Haiku',
        'Cursor',
        'domain',
        ['src/components/v15r/app-brain/**'],
        true,
      ),
    ]

    return buildActiveWorkAnimationSnapshot(agentSessions, domainPulses, overlapWarnings)
  }, [])

  return (
    <AppBrainPanelShell
      mode="runtime"
      title="Active Work Animation"
      subtitle="Animation model preview from seed sessions — not live 3D rendering"
      icon={<Activity size={18} />}
      accent="#a78bfa"
    >
      <div className="flex flex-wrap gap-2">
        <SceneWiredBadge />
      </div>

      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.16)' }}
      >
        <p className="text-xs text-violet-100/90 leading-relaxed">
          Preview data is wired to the 3D scene <span className="font-mono">Active Work</span> overlay mode. Animation
          states and domain pulses come from <span className="font-mono">APP_BRAIN_ACTIVE_SESSIONS</span> seed data —
          read-only, not live rendering or websocket tracking.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active sessions" value={snapshot.summary.totalActiveSessions} color="#a78bfa" />
        <StatCard label="Blocked" value={snapshot.summary.blockedCount} color="#fb7185" />
        <StatCard label="Warnings" value={snapshot.summary.warningCount} color="#facc15" />
        <StatCard label="System health" value={snapshot.summary.systemHealth} color="#22d3ee" />
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Agent animation states</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {AGENT_TYPES.map((agent) => {
            const session = snapshot.agentSessions[agent]
            const accent = AGENT_COLORS[agent]
            const stateColor = STATE_COLORS[session.animationState]
            return (
              <div
                key={agent}
                className="rounded-lg p-3"
                style={{ background: 'rgba(3,7,18,0.5)', border: `1px solid ${accent}28` }}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-gray-200">{agent}</span>
                  <span
                    className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full"
                    style={{ color: stateColor, background: `${stateColor}14`, border: `1px solid ${stateColor}33` }}
                  >
                    {session.animationState}
                  </span>
                </div>
                <p className="text-[10px] text-gray-500 font-mono truncate">
                  {session.domain ?? 'no domain'} · {session.animationHint?.visualStyle ?? 'n/a'}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Domain pulse preview</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.values(snapshot.domainPulses)
            .slice(0, 4)
            .map((pulse) => {
              const healthColor =
                pulse.health === 'critical' ? '#fb7185' : pulse.health === 'warning' ? '#facc15' : '#34d399'
              return (
                <div
                  key={pulse.domainId}
                  className="rounded-lg p-3"
                  style={{ background: 'rgba(3,7,18,0.5)', border: `1px solid ${healthColor}28` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-gray-300">{pulse.domainId}</span>
                    <span className="text-[10px] uppercase font-mono" style={{ color: healthColor }}>
                      {pulse.health}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {pulse.activeSessions} active · {pulse.blockedSessions} blocked
                  </p>
                </div>
              )
            })}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Overlap warning preview</p>
        {snapshot.overlapWarnings.map((warning) => (
          <div
            key={warning.warningId}
            className="rounded-lg p-3"
            style={{ background: 'rgba(127,29,29,0.12)', border: '1px solid rgba(251,113,133,0.2)' }}
          >
            <p className="text-xs text-gray-300">
              {warning.agentA} ↔ {warning.agentB} · {warning.overlapType} · {warning.severity}
            </p>
            <p className="text-[10px] text-gray-500 font-mono mt-1 truncate">
              {warning.affectedItems.join(', ')}
            </p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">State legend</p>
        <div className="flex flex-wrap gap-2">
          {STATE_LEGEND.map(({ state, label }) => (
            <span
              key={state}
              className="text-[10px] uppercase tracking-wider font-mono px-2 py-1 rounded-full"
              style={{
                color: STATE_COLORS[state],
                background: `${STATE_COLORS[state]}14`,
                border: `1px solid ${STATE_COLORS[state]}33`,
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </AppBrainPanelShell>
  )
}

export { AppBrainActiveWorkAnimationPanel }
