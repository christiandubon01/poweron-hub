/**
 * ATB-2: Role routing + model-ladder DATA CONTRACT.
 *
 * Keeps AGENT IDENTITY separate from PROVIDER, MODEL, and EFFORT. Defines how a
 * role (architect / implementer / verifier) resolves to an ordered ladder of
 * (provider, model, effort) candidates. This phase ships the CONTRACT and a
 * conservative resolver only:
 *   - It does NOT invent runtime defaults (no "Astra"/"Fable"/specific models
 *     unless configuration provides them).
 *   - It does NOT switch on fabricated usage thresholds. A candidate is used
 *     only when its provider is genuinely available; fallback to the next
 *     candidate happens on real provider unavailability, and any real fallback
 *     is recorded truthfully by the caller.
 */

import { PLAN_ROLES, type PlanRole } from './types.ts';
import type { ProviderId } from '../providers/types.ts';
import { isEffortLevel, mapNormalizedEffort, type EffortLevel } from '../providers/effort.ts';

export interface RoleRoutingCandidate {
  providerId: ProviderId;
  /** null = provider default model (only valid where the provider needs no explicit model). */
  modelId: string | null;
  /** null = provider/adapter default effort (only valid where effort is unsupported). */
  effort: EffortLevel | null;
  priority: number;
}

export interface RoleRouting {
  role: PlanRole;
  /** Agent identity label (e.g. an "Astra" persona) — display only, never the model. */
  identity: string | null;
  /** Ordered ladder; index 0 is preferred. */
  candidates: RoleRoutingCandidate[];
}

export type RoleRoutingConfig = Partial<Record<PlanRole, {
  identity?: string | null;
  candidates?: Array<{ providerId: ProviderId; modelId?: string | null; effort?: EffortLevel | null; priority?: number }>;
}>>;

export interface RoleRoutingResolution {
  routing: Record<PlanRole, RoleRouting>;
  /** Effort validity problems found while resolving (never silently downgraded). */
  effortIssues: Array<{ role: PlanRole; providerId: ProviderId; effort: EffortLevel; reason: string }>;
}

/**
 * Resolve role routing from optional configuration. With no config every role
 * resolves to an EMPTY ladder — honest: nothing is assumed available. An effort
 * that the chosen provider does not support is dropped to null and reported in
 * `effortIssues` (never coerced to another level).
 */
export function resolveRoleRouting(config: RoleRoutingConfig = {}): RoleRoutingResolution {
  const routing = {} as Record<PlanRole, RoleRouting>;
  const effortIssues: RoleRoutingResolution['effortIssues'] = [];

  for (const role of PLAN_ROLES) {
    const roleConfig = config[role];
    const candidates: RoleRoutingCandidate[] = [];

    for (const [index, candidate] of (roleConfig?.candidates ?? []).entries()) {
      let effort: EffortLevel | null = null;
      if (candidate.effort != null) {
        if (!isEffortLevel(candidate.effort)) {
          effortIssues.push({ role, providerId: candidate.providerId, effort: candidate.effort as EffortLevel, reason: 'Not a valid normalized effort level.' });
        } else {
          const mapping = mapNormalizedEffort(candidate.providerId, candidate.effort);
          if (mapping.supported) {
            effort = candidate.effort;
          } else {
            effortIssues.push({ role, providerId: candidate.providerId, effort: candidate.effort, reason: mapping.reason });
          }
        }
      }
      candidates.push({
        providerId: candidate.providerId,
        modelId: candidate.modelId ?? null,
        effort,
        priority: typeof candidate.priority === 'number' ? candidate.priority : index,
      });
    }

    candidates.sort((left, right) => left.priority - right.priority);
    routing[role] = { role, identity: roleConfig?.identity ?? null, candidates };
  }

  return { routing, effortIssues };
}

/**
 * The preferred candidate whose provider is currently available, else null.
 * Fallback (choosing a lower-priority candidate) reflects only real provider
 * availability — never a fabricated usage threshold.
 */
export function selectRoutingCandidate(
  routing: RoleRouting,
  isProviderAvailable: (providerId: ProviderId) => boolean,
): { candidate: RoleRoutingCandidate | null; fellBack: boolean } {
  const ordered = routing.candidates;
  for (const [index, candidate] of ordered.entries()) {
    if (isProviderAvailable(candidate.providerId)) {
      return { candidate, fellBack: index > 0 };
    }
  }
  return { candidate: null, fellBack: false };
}

/** The normalized effort a role's preferred available candidate would use (or null). */
export function effortForRole(
  role: PlanRole,
  resolution: RoleRoutingResolution,
  isProviderAvailable: (providerId: ProviderId) => boolean = () => true,
): EffortLevel | null {
  const { candidate } = selectRoutingCandidate(resolution.routing[role], isProviderAvailable);
  return candidate?.effort ?? null;
}
