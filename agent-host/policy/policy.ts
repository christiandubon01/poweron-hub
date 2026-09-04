import type { JsonValue, TaskRecord } from '../lib/orchestrationTypes.ts';
import type { ExecutionResult, PermissionProfile } from '../providers/types.ts';
import { captureRepoSnapshot, type GitTextRunner } from './diffPolicy.ts';
import { isPathWithinAuthorizedScope, createTaskPolicyContext } from './pathPolicy.ts';
import { classifyRepoEntryRestrictions } from './repoPolicy.ts';
import type {
  PolicyAdjudication,
  PolicyAdjudicationInput,
  PolicyBaselineCapture,
  PolicyCaptureInput,
  PolicyPathChange,
  RepoStatusEntryFingerprint,
  TaskPolicyApproval,
} from './types.ts';

export interface AttemptPolicyController {
  captureBaseline(input: PolicyCaptureInput): Promise<PolicyBaselineCapture>;
  adjudicate(input: PolicyAdjudicationInput): Promise<PolicyAdjudication>;
}

export interface CreateAttemptPolicyControllerOptions {
  gitRunner?: GitTextRunner;
}

export function createAttemptPolicyController(
  options: CreateAttemptPolicyControllerOptions = {},
): AttemptPolicyController {
  const gitRunner = options.gitRunner;

  return {
    async captureBaseline(input: PolicyCaptureInput): Promise<PolicyBaselineCapture> {
      const taskPolicy = createTaskPolicyContext({
        taskSpec: input.task.spec,
        permissionProfile: input.permissionProfile,
        approvals: input.approvals,
      });

      return {
        runId: input.runId,
        taskId: input.task.taskId,
        attemptId: input.attemptId,
        repoPath: input.workingDirectory,
        taskPolicy,
        snapshot: await captureRepoSnapshot(input.workingDirectory, gitRunner),
      };
    },

    async adjudicate(input: PolicyAdjudicationInput): Promise<PolicyAdjudication> {
      return await adjudicateRepoPolicy({
        baseline: input.baseline,
        finalSnapshot: await captureRepoSnapshot(input.workingDirectory, gitRunner),
      });
    },
  };
}

export function createNoOpAttemptPolicyController(): AttemptPolicyController {
  return {
    async captureBaseline(input: PolicyCaptureInput): Promise<PolicyBaselineCapture> {
      return {
        runId: input.runId,
        taskId: input.task.taskId,
        attemptId: input.attemptId,
        repoPath: input.workingDirectory,
        taskPolicy: createTaskPolicyContext({
          taskSpec: input.task.spec,
          permissionProfile: input.permissionProfile,
          approvals: input.approvals,
        }),
        snapshot: {
          headSha: 'policy-baseline-bypassed',
          entries: [],
        },
      };
    },

    async adjudicate(input: PolicyAdjudicationInput): Promise<PolicyAdjudication> {
      return {
        decision: 'allow',
        accepted: true,
        reasonCodes: [],
        reason: 'Policy adjudication bypassed for test fixture.',
        baselineHeadSha: input.baseline.snapshot.headSha,
        finalHeadSha: input.baseline.snapshot.headSha,
        headMoved: false,
        changes: [],
      };
    },
  };
}

export function buildPolicyBaselineEventPayload(baseline: PolicyBaselineCapture): JsonValue {
  return {
    baselineHeadSha: baseline.snapshot.headSha,
    dirtyEntryCount: baseline.snapshot.entries.length,
    permissionProfile: baseline.taskPolicy.permissionProfile,
    authorizedWriteScopeCount: baseline.taskPolicy.authorizedWriteScopes.length,
    invalidAuthorizedWriteScopes: [...baseline.taskPolicy.invalidAuthorizedWriteScopes],
    protectedPathCount: 5,
    fingerprintAlgorithm: 'sha256',
  };
}

export function buildPolicyEvaluationEventPayload(adjudication: PolicyAdjudication): JsonValue {
  return {
    decision: adjudication.decision,
    accepted: adjudication.accepted,
    reasonCodes: [...adjudication.reasonCodes],
    reason: adjudication.reason,
    baselineHeadSha: adjudication.baselineHeadSha,
    finalHeadSha: adjudication.finalHeadSha,
    headMoved: adjudication.headMoved,
    changes: adjudication.changes.slice(0, 25).map((change) => compactJsonObject({
      category: change.category,
      path: change.path,
      originalPath: change.originalPath,
      decision: change.decision,
      reasonCode: change.reasonCode,
      matchedRule: change.matchedRule,
      indexStatus: change.indexStatus,
      worktreeStatus: change.worktreeStatus,
      entryFingerprintSha256: change.entryFingerprintSha256,
      pathFingerprint: {
        path: change.pathFingerprint.path,
        exists: change.pathFingerprint.exists,
        nodeKind: change.pathFingerprint.nodeKind,
        workingTreeSha256: change.pathFingerprint.workingTreeSha256,
        sizeBytes: change.pathFingerprint.sizeBytes,
        indexObjectId: change.pathFingerprint.indexObjectId,
      },
      originalPathFingerprint: change.originalPathFingerprint ? {
        path: change.originalPathFingerprint.path,
        exists: change.originalPathFingerprint.exists,
        nodeKind: change.originalPathFingerprint.nodeKind,
        workingTreeSha256: change.originalPathFingerprint.workingTreeSha256,
        sizeBytes: change.originalPathFingerprint.sizeBytes,
        indexObjectId: change.originalPathFingerprint.indexObjectId,
      } : undefined,
    })),
  };
}

export function adjudicateRepoPolicy(options: {
  baseline: PolicyBaselineCapture;
  finalSnapshot: PolicyBaselineCapture['snapshot'];
}): PolicyAdjudication {
  const changes: PolicyPathChange[] = [];
  const consumedFinalEntries = new Set<string>();
  const reasonCodes = new Set<PolicyAdjudication['reasonCodes'][number]>();

  if (options.baseline.taskPolicy.invalidAuthorizedWriteScopes.length > 0) {
    reasonCodes.add('invalid-write-scope');
  }

  if (options.finalSnapshot.headSha !== options.baseline.snapshot.headSha) {
    reasonCodes.add('unexpected-head-move');
  }

  const finalEntries = [...options.finalSnapshot.entries];

  for (const baselineEntry of options.baseline.snapshot.entries) {
    const finalEntry = finalEntries.find((candidate) => entriesShareIdentityOrCoverage(candidate, baselineEntry));
    if (!finalEntry) {
      changes.push(buildPreexistingMutation(baselineEntry, 'Pre-existing dirty path disappeared during execution.'));
      reasonCodes.add('preexisting-change-mutated');
      continue;
    }

    consumedFinalEntries.add(finalEntry.entryFingerprintSha256);
    if (isExactEntryMatch(baselineEntry, finalEntry)) {
      changes.push({
        category: 'PREEXISTING_UNRELATED_CHANGE',
        path: finalEntry.path,
        originalPath: finalEntry.originalPath,
        decision: 'allow',
        reasonCode: 'preexisting-change',
        reason: 'Pre-existing dirty path remained byte-for-byte unchanged.',
        matchedRule: 'baseline-integrity',
        indexStatus: finalEntry.indexStatus,
        worktreeStatus: finalEntry.worktreeStatus,
        entryFingerprintSha256: finalEntry.entryFingerprintSha256,
        pathFingerprint: finalEntry.pathFingerprint,
        originalPathFingerprint: finalEntry.originalPathFingerprint,
      });
      continue;
    }

    changes.push(buildPreexistingMutation(finalEntry, 'Pre-existing dirty path changed during execution.'));
    reasonCodes.add('preexisting-change-mutated');
  }

  for (const finalEntry of finalEntries) {
    if (consumedFinalEntries.has(finalEntry.entryFingerprintSha256)) {
      continue;
    }

    const classified = classifyNewEntry({
      entry: finalEntry,
      runId: options.baseline.runId,
      taskId: options.baseline.taskId,
      attemptId: options.baseline.attemptId,
      permissionProfile: options.baseline.taskPolicy.permissionProfile,
      authorizedWriteScopes: options.baseline.taskPolicy.authorizedWriteScopes,
      approvals: options.baseline.taskPolicy.approvals,
    });

    changes.push(classified);
    if (classified.decision !== 'allow') {
      reasonCodes.add(classified.reasonCode);
    }
  }

  const headMoved = options.finalSnapshot.headSha !== options.baseline.snapshot.headSha;
  const accepted = !headMoved &&
    options.baseline.taskPolicy.invalidAuthorizedWriteScopes.length === 0 &&
    changes.every((change) => change.decision === 'allow');

  if (headMoved) {
    changes.unshift({
      category: 'OUT_OF_SCOPE_CHANGE',
      path: '.git/HEAD',
      decision: 'deny',
      reasonCode: 'unexpected-head-move',
      reason: 'Repository HEAD moved during execution.',
      matchedRule: 'head-sha',
      indexStatus: ' ',
      worktreeStatus: ' ',
      entryFingerprintSha256: options.finalSnapshot.headSha,
      pathFingerprint: {
        path: '.git/HEAD',
        pathKey: '.git/head',
        exists: true,
        nodeKind: 'other',
        workingTreeSha256: options.finalSnapshot.headSha,
        sizeBytes: options.finalSnapshot.headSha.length,
        indexObjectId: null,
      },
    });
  }

  return {
    decision: accepted ? 'allow' : 'deny',
    accepted,
    reasonCodes: [...reasonCodes],
    reason: accepted
      ? 'Repo policy accepted the resulting working-tree state.'
      : 'Repo policy rejected the resulting working-tree state.',
    baselineHeadSha: options.baseline.snapshot.headSha,
    finalHeadSha: options.finalSnapshot.headSha,
    headMoved,
    changes,
  };
}

function classifyNewEntry(options: {
  entry: RepoStatusEntryFingerprint;
  runId: string;
  taskId: string;
  attemptId: string;
  permissionProfile: PermissionProfile;
  authorizedWriteScopes: readonly PolicyBaselineCapture['taskPolicy']['authorizedWriteScopes'][number][];
  approvals: readonly TaskPolicyApproval[];
}): PolicyPathChange {
  const category = classifyEntryCategory(options.entry);
  const restricted = classifyRepoEntryRestrictions({
    entry: options.entry,
    runId: options.runId,
    taskId: options.taskId,
    attemptId: options.attemptId,
    approvals: options.approvals,
  });

  if (options.permissionProfile === 'read-only-reviewer' || options.permissionProfile === 'verifier') {
    return {
      category,
      path: options.entry.path,
      originalPath: options.entry.originalPath,
      decision: 'deny',
      reasonCode: 'reviewer-immutability',
      reason: `${options.permissionProfile} tasks must not mutate repo state.`,
      matchedRule: options.permissionProfile,
      indexStatus: options.entry.indexStatus,
      worktreeStatus: options.entry.worktreeStatus,
      entryFingerprintSha256: options.entry.entryFingerprintSha256,
      pathFingerprint: options.entry.pathFingerprint,
      originalPathFingerprint: options.entry.originalPathFingerprint,
    };
  }

  if (restricted) {
    return {
      category: restricted.reasonCode === 'protected-path' ? 'PROTECTED_CHANGE' : category,
      path: options.entry.path,
      originalPath: options.entry.originalPath,
      decision: restricted.decision === 'require-human' ? 'deny' : restricted.decision,
      reasonCode: restricted.reasonCode,
      reason: restricted.reason,
      matchedRule: restricted.matchedRule,
      indexStatus: options.entry.indexStatus,
      worktreeStatus: options.entry.worktreeStatus,
      entryFingerprintSha256: options.entry.entryFingerprintSha256,
      pathFingerprint: options.entry.pathFingerprint,
      originalPathFingerprint: options.entry.originalPathFingerprint,
    };
  }

  const touchedPaths = [options.entry.path, options.entry.originalPath].filter((value): value is string => Boolean(value));
  const fullyAuthorized = touchedPaths.every((repoPath) => isPathWithinAuthorizedScope(repoPath, options.authorizedWriteScopes));

  if (!fullyAuthorized) {
    return {
      category: 'OUT_OF_SCOPE_CHANGE',
      path: options.entry.path,
      originalPath: options.entry.originalPath,
      decision: 'deny',
      reasonCode: 'out-of-scope-write',
      reason: 'Repo mutation was outside the authorized write scope.',
      matchedRule: 'authorizedWritePaths',
      indexStatus: options.entry.indexStatus,
      worktreeStatus: options.entry.worktreeStatus,
      entryFingerprintSha256: options.entry.entryFingerprintSha256,
      pathFingerprint: options.entry.pathFingerprint,
      originalPathFingerprint: options.entry.originalPathFingerprint,
    };
  }

  return {
    category,
    path: options.entry.path,
    originalPath: options.entry.originalPath,
    decision: 'allow',
    reasonCode: 'in-scope',
    reason: 'Repo mutation stayed within the authorized write scope.',
    matchedRule: 'authorizedWritePaths',
    indexStatus: options.entry.indexStatus,
    worktreeStatus: options.entry.worktreeStatus,
    entryFingerprintSha256: options.entry.entryFingerprintSha256,
    pathFingerprint: options.entry.pathFingerprint,
    originalPathFingerprint: options.entry.originalPathFingerprint,
  };
}

function classifyEntryCategory(entry: RepoStatusEntryFingerprint): PolicyPathChange['category'] {
  if (entry.kind === 'untracked') {
    return 'UNTRACKED_FILE';
  }
  if (entry.kind === 'deleted') {
    return 'DELETED_FILE';
  }
  if (entry.kind === 'renamed') {
    return 'RENAMED_FILE';
  }
  return 'AUTHORIZED_CHANGE';
}

function buildPreexistingMutation(
  entry: RepoStatusEntryFingerprint,
  reason: string,
): PolicyPathChange {
  return {
    category: 'PREEXISTING_CHANGE_MUTATED',
    path: entry.path,
    originalPath: entry.originalPath,
    decision: 'deny',
    reasonCode: 'preexisting-change-mutated',
    reason,
    matchedRule: 'baseline-integrity',
    indexStatus: entry.indexStatus,
    worktreeStatus: entry.worktreeStatus,
    entryFingerprintSha256: entry.entryFingerprintSha256,
    pathFingerprint: entry.pathFingerprint,
    originalPathFingerprint: entry.originalPathFingerprint,
  };
}

function entriesShareIdentityOrCoverage(left: RepoStatusEntryFingerprint, right: RepoStatusEntryFingerprint): boolean {
  if (left.pathKey === right.pathKey && left.originalPathKey === right.originalPathKey) {
    return true;
  }

  const leftCoverage = new Set([left.pathKey, left.originalPathKey].filter((value): value is string => Boolean(value)));
  return [right.pathKey, right.originalPathKey]
    .filter((value): value is string => Boolean(value))
    .some((value) => leftCoverage.has(value));
}

function isExactEntryMatch(left: RepoStatusEntryFingerprint, right: RepoStatusEntryFingerprint): boolean {
  return left.entryFingerprintSha256 === right.entryFingerprintSha256 &&
    left.pathKey === right.pathKey &&
    left.originalPathKey === right.originalPathKey &&
    left.indexStatus === right.indexStatus &&
    left.worktreeStatus === right.worktreeStatus;
}

export function createTaskSpecWithPolicy(options: {
  authorizedWritePaths?: readonly string[];
  extraSpec?: Record<string, unknown>;
} = {}): TaskRecord['spec'] {
  return {
    ...(options.extraSpec ?? {}),
    policy: {
      authorizedWritePaths: [...(options.authorizedWritePaths ?? [])],
    },
  };
}

function compactJsonObject(value: Record<string, JsonValue | undefined>): JsonValue {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as JsonValue;
}
