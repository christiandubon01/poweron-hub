/**
 * ATB-4B: pre-provider launch contract.
 *
 * Pure. Does not spawn. Reuses existing plan/profile/effort/path validators.
 * Invalid contracts must prevent provider launch; they are DENY, not a second
 * approval system.
 */

import { mapNormalizedEffort } from '../providers/effort.ts';
import type { ProviderId } from '../providers/types.ts';
import {
  PLAN_FIELD_LIMITS,
  ROLE_TO_PERMISSION_PROFILE,
  normalizeSafeRepoRelativePath,
  type PlanRole,
  type TaskControlSpec,
} from './types.ts';

export type LaunchContractCode =
  | 'LAUNCH_OK'
  | 'SPEC_INVALID'
  | 'ROLE_PROFILE_MISMATCH'
  | 'IMPLEMENTER_WRITE_SCOPE_MISSING'
  | 'IMPLEMENTER_WRITE_SCOPE_UNBOUNDED'
  | 'VERIFIER_MUST_BE_READ_ONLY'
  | 'ARCHITECT_MUST_BE_READ_ONLY'
  | 'PROVIDER_UNAVAILABLE'
  | 'MODEL_UNSUPPORTED'
  | 'EFFORT_UNSUPPORTED';

export interface LaunchContractInput {
  parsed: TaskControlSpec & { workingDirectory: string };
  rawSpec: unknown;
  /** Registered execution adapters on this Host. Absent → only enum validity (already parsed). */
  availableProviders?: ReadonlySet<string> | undefined;
  /**
   * Known-available model ids for the chosen provider. null/undefined means the
   * Host cannot prove unavailability (Claude has no enumeration) and must not
   * invent a deny.
   */
  supportedModels?: ReadonlySet<string> | null | undefined;
}

export type LaunchContractResult =
  | { ok: true; code: 'LAUNCH_OK'; spec: TaskControlSpec & { workingDirectory: string }; role: PlanRole | null }
  | { ok: false; code: Exclude<LaunchContractCode, 'LAUNCH_OK'>; message: string };

export function evaluateLaunchContract(input: LaunchContractInput): LaunchContractResult {
  const parsed = input.parsed;
  const role = readPlanRole(input.rawSpec);
  const profile = parsed.control.permissionProfile;
  const writePaths = parsed.policy.authorizedWritePaths;

  if (role && ROLE_TO_PERMISSION_PROFILE[role] !== profile) {
    return {
      ok: false,
      code: 'ROLE_PROFILE_MISMATCH',
      message: `Role ${role} requires permissionProfile ${ROLE_TO_PERMISSION_PROFILE[role]}.`,
    };
  }

  if (role === 'implementer' || (!role && profile === 'task-implementer')) {
    if (writePaths.length === 0) {
      return { ok: false, code: 'IMPLEMENTER_WRITE_SCOPE_MISSING', message: 'Implementer tasks must declare bounded authorizedWritePaths.' };
    }
    if (writePaths.length > PLAN_FIELD_LIMITS.maxAuthorizedWritePaths) {
      return { ok: false, code: 'IMPLEMENTER_WRITE_SCOPE_UNBOUNDED', message: 'Implementer authorizedWritePaths exceed the bounded maximum.' };
    }
    if (writePaths.some((entry) => normalizeSafeRepoRelativePath(entry) === null)) {
      return { ok: false, code: 'IMPLEMENTER_WRITE_SCOPE_UNBOUNDED', message: 'Implementer authorizedWritePaths contain an unsafe path.' };
    }
  }

  if (role === 'verifier' || (!role && profile === 'verifier')) {
    if (profile !== 'verifier') {
      return { ok: false, code: 'ROLE_PROFILE_MISMATCH', message: 'Verifier tasks must use the verifier permission profile.' };
    }
    if (writePaths.length > 0) {
      return { ok: false, code: 'VERIFIER_MUST_BE_READ_ONLY', message: 'Verifier authorizedWritePaths must be empty.' };
    }
  }

  if (role === 'architect' || (!role && profile === 'read-only-reviewer')) {
    if (profile !== 'read-only-reviewer') {
      return { ok: false, code: 'ROLE_PROFILE_MISMATCH', message: 'Architect tasks must use read-only-reviewer.' };
    }
    if (writePaths.length > 0) {
      return { ok: false, code: 'ARCHITECT_MUST_BE_READ_ONLY', message: 'Architect/reviewer authorizedWritePaths must be empty.' };
    }
  }

  const provider = parsed.control.provider;
  if (input.availableProviders && !input.availableProviders.has(provider)) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', message: `Provider ${provider} is not registered on this host.` };
  }

  const effort = parsed.control.reasoningEffort;
  if (effort) {
    const mapping = mapNormalizedEffort(provider as ProviderId, effort);
    if (!mapping.supported) {
      return { ok: false, code: 'EFFORT_UNSUPPORTED', message: mapping.reason };
    }
  }

  const model = parsed.control.requestedModel;
  if (model && input.supportedModels && !input.supportedModels.has(model)) {
    return { ok: false, code: 'MODEL_UNSUPPORTED', message: `Requested model is not available for ${provider}.` };
  }

  return { ok: true, code: 'LAUNCH_OK', spec: parsed, role };
}

export function readPlanRole(spec: unknown): PlanRole | null {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    return null;
  }
  const plan = (spec as Record<string, unknown>).plan;
  if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) {
    return null;
  }
  const role = (plan as Record<string, unknown>).role;
  if (role === 'implementer' || role === 'verifier' || role === 'architect') {
    return role;
  }
  return null;
}
