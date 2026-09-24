/**
 * ATB-6I display copy for MODELS. Reads the published fleet and the current
 * Next Run Routing choice. Does not invent models, effort, or quota.
 */
import type { EffortLevel, ProviderCapabilityView } from '../controlTowerTypes'
import { EFFORT_OPTIONS, ROUTED_ROLES, type NextRunRouting, type RoleNextRunChoice } from '@/features/control-tower/nextRunRouting'

const EFFORT_LABEL: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  'extra-high': 'Extra High',
}

export function providerOmitsModelEnumeration(provider: ProviderCapabilityView | undefined): boolean {
  if (!provider || provider.models.length === 0) return false
  const sources = new Set(provider.models.map((model) => model.availabilitySource))
  if (sources.has('provider-enumeration') || sources.has('local-runtime')) return false
  return sources.has('configured-allowlist') || sources.has('execution-evidence')
}

export function discoveryValue(provider: ProviderCapabilityView): string {
  if (provider.providerKind === 'diagnostic' || provider.providerId === 'cursor-editor') return 'Not applicable'
  if (provider.providerId === 'cursor-agent' && !provider.workerCapable) return 'Not applicable'
  const sources = new Set(provider.models.map((model) => model.availabilitySource))
  if (sources.has('provider-enumeration')) return 'Provider catalog available'
  if (sources.has('local-runtime')) return 'Local enumerated models'
  if (sources.has('configured-allowlist') && sources.has('execution-evidence')) return 'Configured allowlist + execution evidence'
  if (sources.has('configured-allowlist')) return 'Configured allowlist'
  if (sources.has('execution-evidence')) return 'Execution evidence'
  return 'Not available'
}

/** Role override phrase. Distinct from runtime "Not reported" and from enumeration limits. */
export function routingModelPhrase(provider: ProviderCapabilityView, routing: NextRunRouting): string {
  const choices = ROUTED_ROLES
    .map((role) => routing[role])
    .filter((choice) => choice.providerId === provider.providerId)
  if (choices.length === 0) return 'No model override selected'
  const labels = choices.map((choice) => modelChoiceLabel(choice, provider))
  return [...new Set(labels)].join(' · ')
}

export function modelChoiceLabel(choice: RoleNextRunChoice, provider?: ProviderCapabilityView): string {
  if (choice.customModel) return choice.customModel
  if (choice.modelId) {
    return provider?.models.find((model) => model.modelId === choice.modelId)?.modelDisplayName ?? choice.modelId
  }
  return 'Provider default'
}

export function collapsedCapabilitySummary(provider: ProviderCapabilityView, routing: NextRunRouting): string {
  if (provider.providerKind === 'diagnostic' || provider.providerId === 'cursor-editor') return 'Not applicable'
  if (provider.providerId === 'cursor-agent' && !provider.workerCapable) return 'Not applicable'
  const sources = new Set(provider.models.map((model) => model.availabilitySource))
  if (sources.has('provider-enumeration')) {
    const count = provider.models.filter((model) => model.availabilitySource === 'provider-enumeration').length
    return count > 0 ? `Provider catalog available · ${count} models` : 'Provider catalog available'
  }
  if (sources.has('local-runtime')) {
    const names = provider.models.filter((model) => model.availabilitySource === 'local-runtime').map((model) => model.modelDisplayName)
    if (names.length === 0) return 'Local runtime'
    if (names.length === 1) return names[0]
    return `${names[0]} · ${names.length} local models`
  }
  if (providerOmitsModelEnumeration(provider)) return routingModelPhrase(provider, routing)
  return routingModelPhrase(provider, routing)
}

export function providerStatusLine(provider: ProviderCapabilityView): string {
  if (provider.providerKind === 'diagnostic' || provider.providerId === 'cursor-editor') return 'Diagnostic only'
  if (provider.providerId === 'cursor-agent' && !provider.workerCapable) return 'Unavailable / not worker-capable'
  const availability = provider.available ? 'Available' : 'Unavailable'
  const worker = provider.workerCapable ? 'Worker-capable' : 'Not worker-capable'
  return `${availability} · ${worker}`
}

export function supportedEffortLine(provider: ProviderCapabilityView): string {
  if (provider.providerKind === 'diagnostic' || provider.providerId === 'cursor-editor' || provider.providerId === 'cursor-agent') return 'Not applicable'
  const levels = new Set(provider.models.flatMap((model) => model.effortLevels))
  if (levels.size === 0) return 'Not exposed'
  return EFFORT_OPTIONS.filter((level) => levels.has(level)).map((level) => EFFORT_LABEL[level]).join(' · ')
}

export function reportedModelLine(provider: ProviderCapabilityView): string {
  const reported = [...new Set(provider.models.map((model) => model.reportedRuntimeModel).filter((value): value is string => Boolean(value)))]
  return reported.length > 0 ? reported.join(' · ') : 'Not reported'
}

export function modelListLabel(provider: ProviderCapabilityView): string {
  const sources = new Set(provider.models.map((model) => model.availabilitySource))
  if (sources.has('provider-enumeration')) return 'Catalog models'
  if (sources.has('local-runtime')) return 'Local models'
  return 'Configured / observed models'
}
