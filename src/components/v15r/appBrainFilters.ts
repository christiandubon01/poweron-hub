import {
  APP_BRAIN_CATEGORY_META,
  type AppBrainNode,
  type AppBrainNodeCategory,
  type AppBrainRiskLevel,
} from './appBrainMap'

export interface AppBrainFilters {
  search: string
  category: 'all' | AppBrainNodeCategory
  riskLevel: 'all' | AppBrainRiskLevel
  showLowRisk: boolean
}

export const DEFAULT_APP_BRAIN_FILTERS: AppBrainFilters = {
  search: '',
  category: 'all',
  riskLevel: 'all',
  showLowRisk: true,
}

export function matchesAppBrainFilters(node: AppBrainNode, filters: AppBrainFilters): boolean {
  const query = filters.search.trim().toLowerCase()
  const categoryLabel = APP_BRAIN_CATEGORY_META[node.category].label
  const searchable = [
    node.label,
    node.ownerArea,
    node.category,
    categoryLabel,
    node.riskLevel,
    node.description,
    ...node.relatedFiles,
    ...node.connectedSystems,
    ...node.connections,
    node.safeEditGuidance,
    ...node.overlapWarnings,
    node.nextPhaseNotes,
  ].join(' ').toLowerCase()

  if (query && !searchable.includes(query)) return false
  if (filters.category !== 'all' && node.category !== filters.category) return false
  if (filters.riskLevel !== 'all' && node.riskLevel !== filters.riskLevel) return false
  if (!filters.showLowRisk && node.riskLevel === 'low') return false
  return true
}

export function filterAppBrainNodes(nodes: AppBrainNode[], filters: AppBrainFilters): AppBrainNode[] {
  return nodes.filter((node) => matchesAppBrainFilters(node, filters))
}
