import { Shield } from 'lucide-react'
import { APP_BRAIN_AGENT_RULES, APP_BRAIN_GLOBAL_RULES } from './appBrainSeedData'
import { AppBrainPanelShell, EmptyState, FrictionPill, StatCard } from './appBrainPanelShared'

export default function AppBrainRulesPanel() {
  const globalRules = APP_BRAIN_GLOBAL_RULES.globalRules ?? []
  const agentEntries = Object.values(APP_BRAIN_AGENT_RULES.agents ?? {})
  const totalAgentRules = agentEntries.reduce((sum, agent) => sum + agent.rules.length, 0)
  const hasRules = globalRules.length > 0 || totalAgentRules > 0

  const frictionCounts = globalRules.reduce<Record<string, number>>((acc, rule) => {
    acc[rule.friction] = (acc[rule.friction] ?? 0) + 1
    return acc
  }, {})

  return (
    <AppBrainPanelShell
      title="Rules"
      subtitle="Global and per-agent governance registries — low friction by default"
      icon={<Shield size={18} />}
      accent="#a78bfa"
    >
      {!hasRules ? (
        <EmptyState message="No active rules yet." />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Global rules" value={globalRules.length} color="#a78bfa" />
            <StatCard label="Agent rule sets" value={agentEntries.length} color="#22d3ee" />
            <StatCard label="Agent rules" value={totalAgentRules} color="#34d399" />
            <StatCard label="Philosophy" value="Low friction" color="#facc15" />
          </div>

          <p className="text-[11px] text-gray-500">{APP_BRAIN_GLOBAL_RULES.philosophy}</p>

          <div className="flex flex-wrap gap-2">
            {(['silent', 'warn', 'confirm', 'block'] as const).map((level) => (
              <span key={level} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                <FrictionPill friction={level} />
                <span className="font-mono">{frictionCounts[level] ?? 0}</span>
              </span>
            ))}
          </div>

          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-gray-500">Global rules</p>
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {globalRules.map((rule) => (
                <div
                  key={rule.id}
                  className="rounded-xl p-3"
                  style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(167,139,250,0.14)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-200">{rule.name}</p>
                      <p className="text-[10px] font-mono text-gray-500 mt-0.5">{rule.id}</p>
                    </div>
                    <FrictionPill friction={rule.friction} />
                  </div>
                  <p className="text-xs text-gray-400 mt-2 leading-relaxed">{rule.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-gray-500">Per-agent rules</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {agentEntries.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-xl p-3 space-y-2"
                  style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(34,211,238,0.12)' }}
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-200">{agent.name}</p>
                    <p className="text-[10px] text-gray-500">{agent.role}</p>
                  </div>
                  <div className="space-y-2">
                    {agent.rules.slice(0, 4).map((rule) => (
                      <div key={rule.id} className="flex items-start justify-between gap-2">
                        <p className="text-[11px] text-gray-400 leading-snug flex-1">{rule.description}</p>
                        <FrictionPill friction={rule.friction} />
                      </div>
                    ))}
                    {agent.rules.length > 4 && (
                      <p className="text-[10px] text-gray-600 font-mono">+{agent.rules.length - 4} more rules</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </AppBrainPanelShell>
  )
}
