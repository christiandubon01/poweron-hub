import { useMemo, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { clusterSignals, filterSignals, groupClustersBySeverity, SIGNAL_SEVERITY_ORDER, type SignalFilter } from '@/features/control-tower/signalGrouping'
import { conciseTime } from '../sessionPresentation'
import type { SignalView } from '../controlTowerTypes'
import type { TeamRoleId } from '../agentTeamTopology'
import { matchNodesForPlannedAreas } from '@/features/control-tower/controlTowerAdapter'
import { APP_BRAIN_NODES } from '../../../appBrainMap'
import type { TowerSession } from '../sessionPresentation'

const FILTERS: Array<{ id: SignalFilter; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' },
]

export default function SignalsMode({ run, onSelectRole, onSelectNode }: {
  run: TowerSession | null
  onSelectRole: (role: TeamRoleId | null) => void
  onSelectNode: (id: string | null) => void
}) {
  const [filter, setFilter] = useState<SignalFilter>('open')
  const signals = run?.signals ?? []
  const visible = useMemo(() => filterSignals(signals, filter), [signals, filter])
  const clusters = useMemo(() => clusterSignals(visible), [visible])
  const grouped = useMemo(() => groupClustersBySeverity(clusters), [clusters])

  const select = (signal: SignalView) => {
    onSelectRole(signal.source === 'guard' ? 'guard' : signal.source === 'host' ? 'host' : 'guard')
    const task = run?.tasks.find((item) => item.taskId === signal.taskId || item.id === signal.taskId)
    const nodes = task?.plannedAreas ? matchNodesForPlannedAreas(APP_BRAIN_NODES, task.plannedAreas) : []
    onSelectNode(nodes[0] ?? null)
  }

  return <div className="ct-signals-mode" aria-label="Signals">
    <div className="ct-signal-filters" role="tablist" aria-label="Signal status">
      {FILTERS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
    </div>
    <p className="ct-field-note"><ShieldCheck size={13} aria-hidden="true" /> Guard is the canonical signal authority. Related signals are grouped.</p>
    {clusters.length === 0 ? <p className="ct-muted">{filter === 'open' ? 'No open signals.' : filter === 'resolved' ? 'No resolved signals.' : 'No signals published.'}</p> : SIGNAL_SEVERITY_ORDER.map((severity) => {
      const list = grouped[severity]
      if (list.length === 0) return null
      return <section key={severity} className="ct-signal-group" aria-label={severity}>
        <h4>{severity.toUpperCase()} · {list.length}</h4>
        <ul className="ct-team-signal-list">
          {list.map((cluster) => <li key={cluster.key}>
            <button type="button" className="ct-signal-row" onClick={() => select(cluster.latest)} aria-label={`${cluster.severity} ${cluster.category}`}>
              <span className={`ct-team-signal-severity ct-team-signal-severity--${cluster.severity}`}>{cluster.severity}</span>
              <span className="ct-team-signal-category">{cluster.category}</span>
              {cluster.count > 1 && <span className="ct-signal-count">{cluster.count}</span>}
              {cluster.ownerActionRequired && <span className="ct-team-badge ct-team-badge--owner">Owner</span>}
              <span className="ct-team-signal-message">{cluster.latest.message || 'No safe message published.'}</span>
              <span className="ct-team-handoff-time">{cluster.latest.source} · {conciseTime(cluster.latest.lastSeen)} · {cluster.latest.evidenceCount} evidence · {cluster.open ? 'Open' : 'Resolved'}</span>
            </button>
          </li>)}
        </ul>
      </section>
    })}
  </div>
}
