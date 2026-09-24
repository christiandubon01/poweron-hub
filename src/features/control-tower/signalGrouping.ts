import type { SignalCategory, SignalView, TelemetrySeverity } from '@/components/v15r/app-brain/control-tower/controlTowerTypes'

export type SignalFilter = 'open' | 'resolved' | 'all'
export const SIGNAL_SEVERITY_ORDER: TelemetrySeverity[] = ['critical', 'warning', 'notice', 'info']

export interface SignalCluster {
  key: string
  severity: TelemetrySeverity
  category: SignalCategory
  source: SignalView['source']
  count: number
  latest: SignalView
  ownerActionRequired: boolean
  open: boolean
}

export function filterSignals(signals: SignalView[], filter: SignalFilter): SignalView[] {
  if (filter === 'open') return signals.filter((signal) => !signal.resolvedAt)
  if (filter === 'resolved') return signals.filter((signal) => Boolean(signal.resolvedAt))
  return signals
}

/** Collapse related signals so one underlying problem is not ten red cards. */
export function clusterSignals(signals: SignalView[]): SignalCluster[] {
  const groups = new Map<string, SignalView[]>()
  for (const signal of signals) {
    const open = !signal.resolvedAt
    const key = `${signal.severity}|${signal.category}|${signal.source}|${open ? 'open' : 'resolved'}`
    const list = groups.get(key)
    if (list) list.push(signal)
    else groups.set(key, [signal])
  }
  const clusters: SignalCluster[] = []
  for (const [key, list] of groups) {
    const latest = list.reduce((best, item) => (Date.parse(item.lastSeen) >= Date.parse(best.lastSeen) ? item : best))
    clusters.push({
      key,
      severity: latest.severity,
      category: latest.category,
      source: latest.source,
      count: list.length,
      latest,
      ownerActionRequired: list.some((item) => item.ownerActionRequired),
      open: !latest.resolvedAt,
    })
  }
  return clusters.sort((left, right) => {
    const severity = SIGNAL_SEVERITY_ORDER.indexOf(left.severity) - SIGNAL_SEVERITY_ORDER.indexOf(right.severity)
    if (severity !== 0) return severity
    return Date.parse(right.latest.lastSeen) - Date.parse(left.latest.lastSeen)
  })
}

export function groupClustersBySeverity(clusters: SignalCluster[]): Record<TelemetrySeverity, SignalCluster[]> {
  const grouped = { critical: [], warning: [], notice: [], info: [] } as Record<TelemetrySeverity, SignalCluster[]>
  for (const cluster of clusters) grouped[cluster.severity].push(cluster)
  return grouped
}
