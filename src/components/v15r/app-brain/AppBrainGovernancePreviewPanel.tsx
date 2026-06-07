/**
 * App Brain Governance Preview Panel
 *
 * Read-only governance preview: clean rules, skills registry, friction levels,
 * and archive reference-only notation.
 */

import { useMemo, useState } from 'react'
import { Shield } from 'lucide-react'
import {
  buildGovernanceSummary,
  buildCleanRulesSet,
  buildSkillsRegistrySummary,
  getArchiveReferences,
  FRICTION_CONCEPTS,
  type GovernanceSummary,
  type CleanRulesSet,
  type SkillsRegistrySummary,
} from './appBrainGovernanceSummary'
import type { FrictionLevel } from './appBrainRulesTypes'
import { AppBrainPanelShell, FrictionPill, StatCard, FRICTION_META } from './appBrainPanelShared'

type PreviewTab = 'summary' | 'rules' | 'skills' | 'archives'

const TAB_ACCENT: Record<PreviewTab, string> = {
  summary: '#34d399',
  rules: '#22d3ee',
  skills: '#a78bfa',
  archives: '#facc15',
}

function SummaryTab({ summary }: { summary: GovernanceSummary }) {
  const totalRules =
    summary.stats.totalGlobalRules +
    summary.stats.totalDomainRules +
    summary.stats.totalFileTypeRules +
    summary.stats.totalSessionRules

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div
          className="rounded-xl p-3"
          style={{
            background: summary.cleanRulesActive ? 'rgba(52,211,153,0.08)' : 'rgba(3,7,18,0.5)',
            border: `1px solid ${summary.cleanRulesActive ? 'rgba(52,211,153,0.24)' : 'rgba(148,163,184,0.14)'}`,
          }}
        >
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Clean rules</p>
          <p className="text-sm font-semibold mt-1" style={{ color: summary.cleanRulesActive ? '#86efac' : '#94a3b8' }}>
            {summary.cleanRulesActive ? 'Active' : 'Inactive'}
          </p>
        </div>
        <div
          className="rounded-xl p-3"
          style={{
            background: summary.skillsRegistryActive ? 'rgba(34,211,238,0.08)' : 'rgba(3,7,18,0.5)',
            border: `1px solid ${summary.skillsRegistryActive ? 'rgba(34,211,238,0.24)' : 'rgba(148,163,184,0.14)'}`,
          }}
        >
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Skills registry</p>
          <p className="text-sm font-semibold mt-1" style={{ color: summary.skillsRegistryActive ? '#67e8f9' : '#94a3b8' }}>
            {summary.skillsRegistryActive ? 'Active' : 'Inactive'}
          </p>
        </div>
        <div
          className="rounded-xl p-3"
          style={{
            background: summary.archivesReferenceOnly ? 'rgba(251,191,36,0.08)' : 'rgba(3,7,18,0.5)',
            border: `1px solid ${summary.archivesReferenceOnly ? 'rgba(251,191,36,0.24)' : 'rgba(148,163,184,0.14)'}`,
          }}
        >
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Archives</p>
          <p className="text-sm font-semibold mt-1" style={{ color: summary.archivesReferenceOnly ? '#fde047' : '#94a3b8' }}>
            Reference only
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total rules" value={totalRules} color="#22d3ee" />
        <StatCard label="Total skills" value={summary.stats.totalSkills} color="#a78bfa" />
        <StatCard label="Block rules" value={summary.stats.blockFrictionRules} color="#fb7185" />
        <StatCard label="Active skills" value={summary.stats.activeSkills} color="#34d399" />
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Friction distribution</p>
        <div className="space-y-2">
          {(['silent', 'warn', 'confirm', 'block'] as FrictionLevel[]).map((level) => {
            const count = summary.frictionLevels[level].count
            const totalFriction =
              summary.stats.silentFrictionRules +
              summary.stats.warnFrictionRules +
              summary.stats.confirmFrictionRules +
              summary.stats.blockFrictionRules
            const width = totalFriction > 0 ? Math.max(8, (count / totalFriction) * 100) : 8
            return (
              <div key={level} className="flex items-center gap-3">
                <FrictionPill friction={level} />
                <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(148,163,184,0.15)' }}>
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${width}%`, background: FRICTION_META[level].color }}
                  />
                </div>
                <span className="text-[11px] font-mono text-gray-400 w-16 text-right">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        {(['silent', 'warn', 'confirm', 'block'] as FrictionLevel[]).map((level) => (
          <div
            key={`concept-${level}`}
            className="rounded-lg p-2 text-[11px]"
            style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(148,163,184,0.1)' }}
          >
            <span className="text-gray-300">{FRICTION_CONCEPTS[level].description}</span>
            <span className="text-gray-600 ml-2">— {FRICTION_CONCEPTS[level].use}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RulesTab({ rulesSet }: { rulesSet: CleanRulesSet }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
          Global rules ({rulesSet.globalRules.length})
        </p>
        <div className="space-y-2">
          {rulesSet.globalRules.slice(0, 5).map((rule) => (
            <div
              key={rule.id}
              className="rounded-lg p-3"
              style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(148,163,184,0.1)' }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-gray-200">{rule.name}</span>
                <FrictionPill friction={rule.friction} />
              </div>
              <p className="text-[11px] text-gray-500">{rule.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
          Domain rules ({rulesSet.domainRules.length})
        </p>
        <div className="space-y-2">
          {rulesSet.domainRules.slice(0, 4).map((rule) => (
            <div
              key={rule.id}
              className="rounded-lg p-3"
              style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(148,163,184,0.1)' }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-gray-200">{rule.domain}</span>
                <FrictionPill friction={rule.friction} />
              </div>
              <p className="text-[11px] text-gray-500">{rule.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {Object.entries(rulesSet.agentRules)
          .slice(0, 4)
          .map(([agentId, agent]) => (
            <div
              key={agentId}
              className="rounded-lg p-3"
              style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(148,163,184,0.1)' }}
            >
              <p className="text-xs font-medium text-gray-200">{agent.agentName}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{agent.role}</p>
              <p className="text-[10px] text-gray-600 font-mono mt-1">{agent.ruleCount} rules</p>
            </div>
          ))}
      </div>
    </div>
  )
}

function SkillsTab({ skillsSummary }: { skillsSummary: SkillsRegistrySummary }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total skills" value={skillsSummary.totalSkills} color="#a78bfa" />
        <StatCard label="Active" value={skillsSummary.activeSkills} color="#34d399" />
        <StatCard label="Inactive" value={skillsSummary.inactiveSkills} color="#94a3b8" />
      </div>

      <p className="text-[11px] text-gray-500 font-mono">
        Registry v{skillsSummary.version} · updated {new Date(skillsSummary.lastUpdatedAt).toLocaleDateString()}
      </p>

      {Object.keys(skillsSummary.byDomain).length === 0 && Object.keys(skillsSummary.byConfidence).length === 0 ? (
        <p className="text-sm text-gray-500">Fresh skills registry seed — no skills imported yet.</p>
      ) : (
        <>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">By domain</p>
            <div className="space-y-1">
              {Object.entries(skillsSummary.byDomain).map(([domain, count]) => (
                <div key={domain} className="flex justify-between text-[11px] text-gray-400 font-mono">
                  <span>{domain}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">By confidence</p>
            <div className="space-y-1">
              {Object.entries(skillsSummary.byConfidence).map(([bucket, count]) => (
                <div key={bucket} className="flex justify-between text-[11px] text-gray-400 font-mono">
                  <span>{bucket}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ArchivesTab() {
  const archives = getArchiveReferences()

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}
      >
        <p className="text-xs text-yellow-200/90 leading-relaxed">
          Old laws/skills PDF archives are reference-only and not active execution rules. Active governance comes
          from APP_BRAIN_GLOBAL_RULES.json and APP_BRAIN_SKILLS.json seeds.
        </p>
      </div>

      <div className="space-y-2">
        {archives.map((archive) => (
          <div
            key={archive.archiveType}
            className="rounded-xl p-4"
            style={{ background: 'rgba(3,7,18,0.58)', border: '1px solid rgba(148,163,184,0.14)' }}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-sm font-medium text-gray-200">{archive.archiveType}</p>
              <span
                className="text-[10px] uppercase font-mono px-2 py-1 rounded-full"
                style={{ color: '#fde047', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)' }}
              >
                {archive.status}
              </span>
            </div>
            <p className="text-xs text-gray-500">{archive.description}</p>
            <p className="text-[10px] text-gray-600 font-mono mt-2">{archive.location}</p>
            <p className="text-[11px] text-gray-500 mt-1">{archive.note}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AppBrainGovernancePreviewPanel() {
  const [activeTab, setActiveTab] = useState<PreviewTab>('summary')
  const summary = useMemo(() => buildGovernanceSummary(), [])
  const rulesSet = useMemo(() => buildCleanRulesSet(), [])
  const skillsSummary = useMemo(() => buildSkillsRegistrySummary(), [])

  return (
    <AppBrainPanelShell
      mode="preview"
      title="Governance Preview"
      subtitle="Clean rules v4.0 and fresh skills registry — read-only, no edit UI"
      icon={<Shield size={18} />}
      accent="#34d399"
    >
      <div className="flex flex-wrap gap-2">
        {(['summary', 'rules', 'skills', 'archives'] as PreviewTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="text-[10px] uppercase tracking-wider font-mono px-3 py-1.5 rounded-lg transition-colors"
            style={{
              color: activeTab === tab ? TAB_ACCENT[tab] : '#94a3b8',
              background: activeTab === tab ? `${TAB_ACCENT[tab]}14` : 'rgba(148,163,184,0.06)',
              border: `1px solid ${activeTab === tab ? `${TAB_ACCENT[tab]}33` : 'rgba(148,163,184,0.14)'}`,
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'summary' && <SummaryTab summary={summary} />}
      {activeTab === 'rules' && <RulesTab rulesSet={rulesSet} />}
      {activeTab === 'skills' && <SkillsTab skillsSummary={skillsSummary} />}
      {activeTab === 'archives' && <ArchivesTab />}
    </AppBrainPanelShell>
  )
}

export { AppBrainGovernancePreviewPanel }
