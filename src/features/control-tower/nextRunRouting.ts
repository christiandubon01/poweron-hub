/**
 * ATB-6: Next Run Routing — honest UI preference, not a Host default.
 *
 * create_plan currently accepts a single { provider, requestedModel } preference
 * (the Architect plan turn). Per-role provider / model / effort lives here as
 * Next Run Routing and is persisted locally per repo. It is never presented as
 * a permanent server-side default.
 */
import type { EffortLevel } from '@/components/v15r/app-brain/control-tower/controlTowerTypes'

export const ROUTED_ROLES = ['architect', 'implementer', 'verifier'] as const
export type RoutedRole = (typeof ROUTED_ROLES)[number]

export interface RoleNextRunChoice {
  providerId: string | null
  modelId: string | null
  effort: EffortLevel | null
  customModel: string | null
}

export interface NextRunRouting {
  architect: RoleNextRunChoice
  implementer: RoleNextRunChoice
  verifier: RoleNextRunChoice
}

export const EMPTY_ROLE_CHOICE: RoleNextRunChoice = {
  providerId: null,
  modelId: null,
  effort: null,
  customModel: null,
}

export const EMPTY_NEXT_RUN_ROUTING: NextRunRouting = {
  architect: { ...EMPTY_ROLE_CHOICE },
  implementer: { ...EMPTY_ROLE_CHOICE },
  verifier: { ...EMPTY_ROLE_CHOICE },
}

export const EFFORT_OPTIONS: EffortLevel[] = ['low', 'medium', 'high', 'extra-high']

export function routingStorageKey(repoKey: string | null): string {
  return `ct-next-run-routing:${repoKey ?? 'local'}`
}

function parseChoice(raw: unknown): RoleNextRunChoice {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_ROLE_CHOICE }
  const record = raw as Record<string, unknown>
  const effort = typeof record.effort === 'string' && (EFFORT_OPTIONS as string[]).includes(record.effort)
    ? record.effort as EffortLevel
    : null
  return {
    providerId: typeof record.providerId === 'string' && record.providerId ? record.providerId : null,
    modelId: typeof record.modelId === 'string' && record.modelId ? record.modelId : null,
    effort,
    customModel: typeof record.customModel === 'string' && record.customModel ? record.customModel : null,
  }
}

export function loadNextRunRouting(repoKey: string | null): NextRunRouting {
  if (typeof localStorage === 'undefined') return { ...EMPTY_NEXT_RUN_ROUTING, architect: { ...EMPTY_ROLE_CHOICE }, implementer: { ...EMPTY_ROLE_CHOICE }, verifier: { ...EMPTY_ROLE_CHOICE } }
  try {
    const raw = localStorage.getItem(routingStorageKey(repoKey))
    if (!raw) return { architect: { ...EMPTY_ROLE_CHOICE }, implementer: { ...EMPTY_ROLE_CHOICE }, verifier: { ...EMPTY_ROLE_CHOICE } }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      architect: parseChoice(parsed.architect),
      implementer: parseChoice(parsed.implementer),
      verifier: parseChoice(parsed.verifier),
    }
  } catch {
    return { architect: { ...EMPTY_ROLE_CHOICE }, implementer: { ...EMPTY_ROLE_CHOICE }, verifier: { ...EMPTY_ROLE_CHOICE } }
  }
}

export function saveNextRunRouting(repoKey: string | null, routing: NextRunRouting): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(routingStorageKey(repoKey), JSON.stringify(routing))
  } catch {
    // Preference only — never block the console if storage is unavailable.
  }
}

/** Maps Next Run Routing onto the existing create_plan requestedRouting seam. */
export function toRequestedRouting(routing: NextRunRouting): { provider?: string; requestedModel?: string } | null {
  const architect = routing.architect
  const model = architect.customModel || architect.modelId
  if (!architect.providerId && !model) return null
  return {
    ...(architect.providerId ? { provider: architect.providerId } : {}),
    ...(model ? { requestedModel: model } : {}),
  }
}

export function resolveRoleModel(choice: RoleNextRunChoice): string | null {
  return choice.customModel || choice.modelId
}
