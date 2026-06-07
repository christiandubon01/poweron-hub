import { ListTodo } from 'lucide-react'
import { APP_BRAIN_TASK_REGISTRY } from './appBrainSeedData'
import { AppBrainPanelShell, EmptyState, StatCard } from './appBrainPanelShared'

export default function AppBrainBacklogPanel() {
  const registry = APP_BRAIN_TASK_REGISTRY
  const domainBuckets = Object.values(registry.domains)
  const domainsWithTasks = domainBuckets.filter((bucket) => bucket.tasks.length > 0)
  const hasTasks = registry.metadata.totalTasks > 0

  return (
    <AppBrainPanelShell
      title="Backlog"
      subtitle="Domain task registry — Christian's full backlog not imported yet"
      icon={<ListTodo size={18} />}
      accent="#facc15"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total tasks" value={registry.metadata.totalTasks} color="#facc15" />
        <StatCard label="Completed" value={registry.metadata.completedTasks} color="#34d399" />
        <StatCard label="Domain buckets" value={domainBuckets.length} color="#22d3ee" />
        <StatCard label="Populated domains" value={domainsWithTasks.length} color="#a78bfa" />
      </div>

      {!hasTasks ? (
        <EmptyState message="No backlog tasks yet. Wave 01 seeded empty domain buckets with planned structure only." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {domainsWithTasks.map((bucket) => (
            <div
              key={bucket.domain}
              className="rounded-xl p-3"
              style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(250,204,21,0.14)' }}
            >
              <p className="text-sm font-medium text-gray-200">{bucket.displayName}</p>
              <p className="text-[10px] text-gray-500 mt-1">{bucket.description}</p>
              <p className="text-xs font-mono text-yellow-200/90 mt-2">{bucket.stats.total} tasks</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-gray-500">Domain buckets</p>
        <div className="flex flex-wrap gap-2">
          {domainBuckets.map((bucket) => (
            <span
              key={bucket.domain}
              className="text-[10px] rounded-full px-2 py-1"
              style={{
                color: bucket.tasks.length > 0 ? '#fde68a' : '#6b7280',
                background: 'rgba(15,23,42,0.7)',
                border: '1px solid rgba(148,163,184,0.14)',
              }}
            >
              {bucket.displayName}: {bucket.stats.total}
            </span>
          ))}
        </div>
      </div>
    </AppBrainPanelShell>
  )
}
