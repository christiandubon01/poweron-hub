/**
 * ATB-4: Deterministic drift classification.
 *
 * PURE path/area rules used by repo-policy adjudication. No LLM, no I/O, no
 * new event types. A write that is inside authorizedWritePaths can still be
 * drift — dependency manifests, database/migration files, and writes outside
 * declared plannedAreas — and those must raise a human gate at runtime.
 *
 * `scope-pack-stale` is activated by Scope Pack reconciliation (ATB-5), not by
 * this path classifier.
 */

import path from 'node:path';

import { normalizeRepoRelativePath, toRepoPathKey } from './pathPolicy.ts';
import type { PolicyReasonCode } from './types.ts';

export type DriftReasonCode = Extract<
  PolicyReasonCode,
  'dependency-mutation' | 'db-mutation' | 'migration-outside-plan' | 'unplanned-area'
>;

export interface PathDriftClassification {
  reasonCode: DriftReasonCode;
  reason: string;
  matchedRule: string;
}

const DEPENDENCY_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
]);

const MIGRATION_DIRECTORY_PREFIXES = [
  'supabase/migrations/',
  'prisma/migrations/',
] as const;

/**
 * True when `repoRelativePath` is the planned area itself or a descendant.
 * Matching is case-insensitive and repo-relative — the same fence the write
 * scope uses — so `src/features/foo` covers `src/features/foo/bar.ts`.
 */
export function isPathWithinPlannedAreas(
  repoRelativePath: string,
  plannedAreas: readonly string[],
): boolean {
  if (plannedAreas.length === 0) {
    return false;
  }

  let pathKey: string;
  try {
    pathKey = toRepoPathKey(repoRelativePath);
  } catch {
    return false;
  }

  return plannedAreas.some((area) => {
    try {
      const areaKey = toRepoPathKey(area);
      return pathKey === areaKey || pathKey.startsWith(`${areaKey}/`);
    } catch {
      return false;
    }
  });
}

export function isDependencyManifestPath(repoRelativePath: string): boolean {
  const normalized = safeNormalize(repoRelativePath);
  if (!normalized) {
    return false;
  }
  return DEPENDENCY_BASENAMES.has(path.posix.basename(normalized).toLowerCase());
}

export function isDatabaseMutationPath(repoRelativePath: string): boolean {
  const normalized = safeNormalize(repoRelativePath);
  if (!normalized) {
    return false;
  }
  const key = normalized.toLowerCase();
  if (MIGRATION_DIRECTORY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return true;
  }
  return key.startsWith('supabase/') && key.endsWith('.sql');
}

/**
 * Most-specific drift class for one repo-relative path. Returns null when the
 * path is not a reserved drift class (ordinary source writes are handled by
 * authorized-scope + planned-area checks in the caller).
 *
 * Priority: dependency manifest → migration outside plan → any db/migration.
 */
export function classifyPathDrift(options: {
  path: string;
  plannedAreas: readonly string[];
}): PathDriftClassification | null {
  const normalized = safeNormalize(options.path);
  if (!normalized) {
    return null;
  }

  if (isDependencyManifestPath(normalized)) {
    return {
      reasonCode: 'dependency-mutation',
      reason: `Dependency manifest ${normalized} changed and requires owner approval.`,
      matchedRule: 'dependency-manifest',
    };
  }

  if (isDatabaseMutationPath(normalized)) {
    if (options.plannedAreas.length > 0 && !isPathWithinPlannedAreas(normalized, options.plannedAreas)) {
      return {
        reasonCode: 'migration-outside-plan',
        reason: `Database/migration file ${normalized} is outside planned areas.`,
        matchedRule: 'migration-outside-plan',
      };
    }
    return {
      reasonCode: 'db-mutation',
      reason: `Database/migration file ${normalized} changed and requires owner approval.`,
      matchedRule: 'db-mutation-path',
    };
  }

  return null;
}

export function classifyUnplannedAreaDrift(options: {
  path: string;
  plannedAreas: readonly string[];
}): PathDriftClassification | null {
  if (options.plannedAreas.length === 0) {
    return null;
  }
  const normalized = safeNormalize(options.path);
  if (!normalized) {
    return null;
  }
  if (isPathWithinPlannedAreas(normalized, options.plannedAreas)) {
    return null;
  }
  return {
    reasonCode: 'unplanned-area',
    reason: `Write ${normalized} is authorized but outside planned areas.`,
    matchedRule: 'plannedAreas',
  };
}

function safeNormalize(repoRelativePath: string): string | null {
  try {
    return normalizeRepoRelativePath(repoRelativePath);
  } catch {
    return null;
  }
}
