import path from 'node:path';

import { normalizeRepoRelativePath, parseAuthorizedWriteScope, toRepoPathKey, isPathWithinAuthorizedScope } from './pathPolicy.ts';
import type { PolicyDecision, RepoStatusEntryFingerprint, TaskPolicyApproval } from './types.ts';

const PROTECTED_REPO_PATHS = [
  'netlify.toml',
  'src/store/authStore.ts',
  'src/services/backupDataService.ts',
  'vite.config.ts',
  'src/components/v15r/charts/SVGCharts.tsx',
] as const;

export const CANONICAL_PROTECTED_REPO_PATHS = [...PROTECTED_REPO_PATHS];
const PROTECTED_REPO_PATH_KEYS = new Set(PROTECTED_REPO_PATHS.map((entry) => toRepoPathKey(entry)));

export function isProtectedRepoPath(repoRelativePath: string): boolean {
  return PROTECTED_REPO_PATH_KEYS.has(toRepoPathKey(repoRelativePath));
}

export function describeProtectedRepoPath(repoRelativePath: string): string {
  const normalizedPath = normalizeRepoRelativePath(repoRelativePath);
  const matched = PROTECTED_REPO_PATHS.find((entry) => toRepoPathKey(entry) === toRepoPathKey(normalizedPath));
  return matched ?? normalizedPath;
}

export function isSensitiveRepoPath(repoRelativePath: string): boolean {
  const normalizedPath = normalizeRepoRelativePath(repoRelativePath);
  const baseName = path.posix.basename(normalizedPath).toLowerCase();

  if (baseName === '.env' || baseName.startsWith('.env.')) {
    return true;
  }

  return baseName.endsWith('.pem') || baseName.endsWith('.key');
}

function approvalMatchesPath(approval: TaskPolicyApproval, repoRelativePath: string): boolean {
  return approval.scopes.some((scope) => {
    try {
      const parsed = parseAuthorizedWriteScope(scope);
      return isPathWithinAuthorizedScope(repoRelativePath, [parsed]);
    } catch {
      return false;
    }
  });
}

export function hasProtectedPathApproval(options: {
  approvals: readonly TaskPolicyApproval[];
  runId: string;
  taskId: string;
  attemptId: string;
  repoRelativePath: string;
}): boolean {
  return options.approvals.some((approval) => {
    if (approval.action !== 'protected-path-write') {
      return false;
    }
    if (approval.runId !== options.runId || approval.taskId !== options.taskId) {
      return false;
    }
    if (approval.attemptId && approval.attemptId !== options.attemptId) {
      return false;
    }
    return approvalMatchesPath(approval, options.repoRelativePath);
  });
}

export function classifyRepoEntryRestrictions(options: {
  entry: RepoStatusEntryFingerprint;
  runId: string;
  taskId: string;
  attemptId: string;
  approvals: readonly TaskPolicyApproval[];
}): PolicyDecision | null {
  const repoPaths = [options.entry.path, options.entry.originalPath].filter((value): value is string => Boolean(value));

  for (const repoPath of repoPaths) {
    if (isSensitiveRepoPath(repoPath)) {
      return {
        decision: 'deny',
        reasonCode: 'secret-access',
        reason: `Sensitive path ${repoPath} was modified.`,
        matchedRule: 'sensitive-path',
      };
    }

    if (isProtectedRepoPath(repoPath)) {
      if (hasProtectedPathApproval({
        approvals: options.approvals,
        runId: options.runId,
        taskId: options.taskId,
        attemptId: options.attemptId,
        repoRelativePath: repoPath,
      })) {
        continue;
      }

      return {
        decision: 'require-human',
        reasonCode: 'protected-path',
        reason: `Protected path ${repoPath} changed without matching approval.`,
        matchedRule: describeProtectedRepoPath(repoPath),
      };
    }
  }

  return null;
}
