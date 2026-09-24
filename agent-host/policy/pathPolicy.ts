import path from 'node:path';

import type { JsonValue } from '../lib/orchestrationTypes.ts';
import type { PermissionProfile } from '../providers/types.ts';
import type { AuthorizedWriteScope, TaskPolicyApproval, TaskPolicyContext } from './types.ts';

const DRIVE_LETTER_PATTERN = /^[A-Za-z]:/u;
const UNC_PATTERN = /^[/\\]{2}/u;
const WILDCARD_PATTERN = /\*/u;

export function normalizeRepoRelativePath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('Write scope paths must not be empty.');
  }
  if (DRIVE_LETTER_PATTERN.test(trimmed) || UNC_PATTERN.test(trimmed)) {
    throw new Error(`Write scope path "${raw}" must be repo-relative.`);
  }

  const slashNormalized = trimmed.replace(/\\/gu, '/').replace(/^\.\/+/u, '');
  if (slashNormalized === '*' || slashNormalized === '**' || slashNormalized === '/**') {
    throw new Error(`Write scope path "${raw}" is too broad.`);
  }
  if (slashNormalized.startsWith('/')) {
    throw new Error(`Write scope path "${raw}" must be repo-relative.`);
  }

  const normalized = path.posix.normalize(slashNormalized);
  if (normalized === '.' || normalized.length === 0) {
    throw new Error(`Write scope path "${raw}" must identify a file or directory.`);
  }
  if (normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) {
    throw new Error(`Write scope path "${raw}" escapes the repository root.`);
  }
  return normalized;
}

export function toRepoPathKey(repoRelativePath: string): string {
  return normalizeRepoRelativePath(repoRelativePath).toLowerCase();
}

export function parseAuthorizedWriteScope(raw: string): AuthorizedWriteScope {
  const trimmed = raw.trim();
  if (trimmed.endsWith('/**') || trimmed.endsWith('\\**')) {
    const base = trimmed.slice(0, -3);
    const normalizedBase = normalizeRepoRelativePath(base);
    if (normalizedBase.length === 0) {
      throw new Error(`Write scope path "${raw}" is too broad.`);
    }

    return {
      kind: 'directory-prefix',
      raw,
      normalizedPath: `${normalizedBase}/`,
      normalizedPathKey: `${toRepoPathKey(normalizedBase)}/`,
    };
  }

  const normalizedPath = normalizeRepoRelativePath(raw);
  if (WILDCARD_PATTERN.test(normalizedPath)) {
    throw new Error(`Write scope path "${raw}" uses an unsupported wildcard.`);
  }

  return {
    kind: 'exact-file',
    raw,
    normalizedPath,
    normalizedPathKey: toRepoPathKey(normalizedPath),
  };
}

export function isPathWithinAuthorizedScope(
  repoRelativePath: string,
  scopes: readonly AuthorizedWriteScope[],
): boolean {
  const normalizedPath = normalizeRepoRelativePath(repoRelativePath);
  const pathKey = toRepoPathKey(normalizedPath);

  return scopes.some((scope) => {
    if (scope.kind === 'exact-file') {
      return scope.normalizedPathKey === pathKey;
    }
    return pathKey.startsWith(scope.normalizedPathKey);
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function readAuthorizedWritePaths(taskSpec: JsonValue | null): readonly string[] {
  if (!isPlainObject(taskSpec)) {
    return [];
  }

  const policy = taskSpec.policy;
  if (!isPlainObject(policy)) {
    return [];
  }

  const authorizedWritePaths = policy.authorizedWritePaths;
  if (!Array.isArray(authorizedWritePaths)) {
    return [];
  }

  return authorizedWritePaths.filter((entry): entry is string => typeof entry === 'string');
}

function readScopePackProtectedPaths(taskSpec: JsonValue | null): readonly string[] {
  if (!isPlainObject(taskSpec)) {
    return [];
  }
  const policy = taskSpec.policy;
  if (!isPlainObject(policy) || !Array.isArray(policy.doNotTouchPaths)) {
    return [];
  }
  const paths: string[] = [];
  for (const entry of policy.doNotTouchPaths) {
    if (typeof entry !== 'string') {
      continue;
    }
    try {
      paths.push(normalizeRepoRelativePath(entry));
    } catch {
      // Invalid path-like entries are skipped; prose never becomes a path.
    }
  }
  return paths;
}

function readPlannedAreas(taskSpec: JsonValue | null): readonly string[] {
  if (!isPlainObject(taskSpec)) {
    return [];
  }

  const plan = taskSpec.plan;
  if (!isPlainObject(plan) || !Array.isArray(plan.plannedAreas)) {
    return [];
  }

  const areas: string[] = [];
  for (const entry of plan.plannedAreas) {
    if (typeof entry !== 'string') {
      continue;
    }
    try {
      areas.push(normalizeRepoRelativePath(entry));
    } catch {
      // Invalid planned-area strings are skipped, never a silent open fence.
    }
  }
  return areas;
}

export function createTaskPolicyContext(options: {
  taskSpec: JsonValue | null;
  permissionProfile: PermissionProfile;
  approvals?: readonly TaskPolicyApproval[];
}): TaskPolicyContext {
  const plannedAreas = readPlannedAreas(options.taskSpec);
  const scopePackProtectedPaths = readScopePackProtectedPaths(options.taskSpec);

  if (options.permissionProfile === 'read-only-reviewer' || options.permissionProfile === 'verifier') {
    return {
      permissionProfile: options.permissionProfile,
      taskSpec: options.taskSpec,
      authorizedWriteScopes: [],
      invalidAuthorizedWriteScopes: [],
      plannedAreas,
      scopePackProtectedPaths,
      approvals: options.approvals ?? [],
    };
  }

  const authorizedWritePaths = readAuthorizedWritePaths(options.taskSpec);
  const scopes: AuthorizedWriteScope[] = [];
  const invalidScopes: string[] = [];

  for (const scope of authorizedWritePaths) {
    try {
      scopes.push(parseAuthorizedWriteScope(scope));
    } catch {
      invalidScopes.push(scope);
    }
  }

  return {
    permissionProfile: options.permissionProfile,
    taskSpec: options.taskSpec,
    authorizedWriteScopes: scopes,
    invalidAuthorizedWriteScopes: invalidScopes,
    plannedAreas,
    scopePackProtectedPaths,
    approvals: options.approvals ?? [],
  };
}
