import { Sparkles } from 'lucide-react'
import { APP_BRAIN_SKILLS_REGISTRY } from './appBrainSeedData'
import { AppBrainPanelShell, EmptyState, StatCard } from './appBrainPanelShared'

export default function AppBrainSkillsPanel() {
  const registry = APP_BRAIN_SKILLS_REGISTRY
  const skills = registry.skills ?? []
  const hasSkills = skills.length > 0

  return (
    <AppBrainPanelShell
      title="Skills"
      subtitle="Learned patterns registry — distinct from governance rules"
      icon={<Sparkles size={18} />}
      accent="#34d399"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total skills" value={registry.totalSkills} color="#34d399" />
        <StatCard label="Active skills" value={registry.activeSkills} color="#22d3ee" />
        <StatCard label="Inactive skills" value={registry.inactiveSkills} color="#94a3b8" />
        <StatCard label="Registry version" value={registry.version} color="#a78bfa" />
      </div>

      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}
      >
        <p className="text-xs text-yellow-200/90 leading-relaxed">
          Old skills archives and legacy PDF dumps are not imported as active skills. This registry starts clean in Wave 01.
        </p>
      </div>

      {!hasSkills ? (
        <EmptyState message="No active skills yet. Wave 01 seeded an empty registry by design." />
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="rounded-xl p-3"
              style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(52,211,153,0.14)' }}
            >
              <p className="text-sm font-medium text-gray-200">{skill.name}</p>
              <p className="text-xs text-gray-400 mt-1">{skill.shortRule}</p>
            </div>
          ))}
        </div>
      )}

      {registry.notes && (
        <p className="text-[11px] text-gray-500 leading-relaxed">{registry.notes}</p>
      )}
    </AppBrainPanelShell>
  )
}
