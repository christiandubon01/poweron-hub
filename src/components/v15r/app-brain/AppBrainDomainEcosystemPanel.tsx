import { useMemo } from 'react'
import { Globe2 } from 'lucide-react'
import { APP_BRAIN_DOMAIN_MAP } from './appBrainDomainMap'
import type { DomainRiskLevel } from './appBrainDomainTypes'
import { AppBrainPanelShell, StatCard } from './appBrainPanelShared'

const RISK_COLORS: Record<DomainRiskLevel, string> = {
  critical: '#fb7185',
  high: '#facc15',
  medium: '#22d3ee',
  low: '#34d399',
  minimal: '#94a3b8',
}

export default function AppBrainDomainEcosystemPanel() {
  const { domains, totalDomains } = APP_BRAIN_DOMAIN_MAP

  const stats = useMemo(() => {
    const edgeCount = domains.reduce((sum, domain) => sum + domain.connectedDomainIds.length, 0)
    const highRiskCount = domains.filter(
      (domain) => domain.riskLevel === 'critical' || domain.riskLevel === 'high',
    ).length
    return { edgeCount, highRiskCount }
  }, [domains])

  return (
    <AppBrainPanelShell
      mode="preview"
      title="Domain Ecosystem"
      subtitle="Architecture and data-flow map — no operational financial values"
      icon={<Globe2 size={18} />}
      accent="#34d399"
    >
      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.16)' }}
      >
        <p className="text-xs text-cyan-100/90 leading-relaxed">
          Domain clusters describe file ownership and orchestration relationships only. Future 3D animation
          hints are metadata — the neural scene is not wired to this map yet.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label="Domains" value={totalDomains} color="#34d399" />
        <StatCard label="High-risk domains" value={stats.highRiskCount} color="#facc15" />
        <StatCard label="Connected edges" value={stats.edgeCount} color="#22d3ee" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {domains.map((domain) => {
          const accent = RISK_COLORS[domain.riskLevel] ?? '#94a3b8'
          const connectedLabels = domain.connectedDomainIds
            .slice(0, 4)
            .map((edge) => edge.targetDomainId)
          return (
            <div
              key={domain.id}
              className="rounded-xl p-4 space-y-3"
              style={{ background: 'rgba(3,7,18,0.58)', border: `1px solid ${accent}28` }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-100">{domain.label}</p>
                  <p className="text-[10px] font-mono text-gray-500 mt-0.5">{domain.id}</p>
                </div>
                <span
                  className="text-[10px] uppercase tracking-wider font-mono px-2 py-1 rounded-full shrink-0"
                  style={{ color: accent, background: `${accent}14`, border: `1px solid ${accent}33` }}
                >
                  {domain.riskLevel}
                </span>
              </div>

              <p className="text-xs text-gray-400 leading-relaxed line-clamp-3">{domain.description}</p>

              <div>
                <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Connected domains</p>
                <div className="flex flex-wrap gap-1">
                  {connectedLabels.length > 0 ? (
                    connectedLabels.map((id) => (
                      <span
                        key={id}
                        className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                        style={{ color: '#bae6fd', background: 'rgba(14,116,144,0.16)', border: '1px solid rgba(34,211,238,0.16)' }}
                      >
                        {id}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-gray-600">None mapped</span>
                  )}
                  {domain.connectedDomainIds.length > 4 && (
                    <span className="text-[10px] text-gray-600">+{domain.connectedDomainIds.length - 4}</span>
                  )}
                </div>
              </div>

              <div>
                <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Primary files</p>
                <div className="space-y-1">
                  {domain.primaryFiles.slice(0, 3).map((file) => (
                    <p key={file.pattern} className="text-[10px] font-mono text-gray-400 truncate">
                      {file.pattern}
                    </p>
                  ))}
                </div>
              </div>

              {domain.animationHint && (
                <p className="text-[10px] text-gray-600 font-mono">
                  Animation hint: {domain.animationHint.placementZone} · {domain.animationHint.visualStyle}
                  {domain.animationHint.colorHint ? ` · ${domain.animationHint.colorHint}` : ''}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </AppBrainPanelShell>
  )
}
