import { TEXT_FIELD_MAX_BYTES, type JsonValue, type TaskRecord } from '../lib/orchestrationTypes.ts';
import type { ExecutionResult, PermissionProfile } from '../providers/types.ts';
import { captureRepoSnapshot, type GitTextRunner } from './diffPolicy.ts';
import { classifyPathDrift, classifyUnplannedAreaDrift } from './driftPolicy.ts';
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

/**
 * Serialized-size budget for the `changes` array of a durable policy event
 * payload. The orchestration store rejects any event payload over
 * TEXT_FIELD_MAX_BYTES (8192 UTF-8 bytes). Unchanged inherited dirt is not an
 * Attempt change, so it is not in this array. A large real Attempt delta can
 * still exceed the budget; deny and human-gate entries are kept, and only
 * extra allow entries are truncated. The budget leaves headroom for the
 * fixed wrapper fields of the payload.
 */
export const POLICY_EVENT_CHANGES_BUDGET_BYTES = TEXT_FIELD_MAX_BYTES - 2_048;

export function buildPolicyEvaluationEventPayload(adjudication: PolicyAdjudication): JsonValue {
  const buildPayload = (changes: readonly JsonValue[], changesTruncated: boolean): JsonValue => ({
    decision: adjudication.decision,
    accepted: adjudication.accepted,
    reasonCodes: [...adjudication.reasonCodes],
    reason: adjudication.reason,
    baselineHeadSha: adjudication.baselineHeadSha,
    finalHeadSha: adjudication.finalHeadSha,
    headMoved: adjudication.headMoved,
    changeCount: adjudication.changes.length,
    ...(changesTruncated ? { changesTruncated: true } : {}),
    changes: [...changes],
  });

  // Every deny / human-gate change is mandatory evidence and is ALWAYS included,
  // whatever the budget says. Only redundant `allow` (pre-existing,
  // byte-identical) entries may be dropped to fit the budget, and the payload
  // then records the truncation explicitly — a policy failure is never
  // silently discarded.
  const mandatoryChanges = adjudication.changes
    .filter((change) => change.decision !== 'allow' || change.requiresHuman === true)
    .map(compactPolicyChangePayload);
  const optionalChanges = adjudication.changes
    .filter((change) => change.decision === 'allow' && change.requiresHuman !== true)
    .map(compactPolicyChangePayload);

  let includedChanges: readonly JsonValue[] = mandatoryChanges;
  let changesTruncated = false;
  for (const change of optionalChanges) {
    const candidate = includedChanges.concat(change);
    // Probe with the truncation flag set: that is the larger serialized form and
    // therefore the conservative bound. JSON byte length is invariant under the
    // store's key sorting, so this measures exactly what appendEvent serializes.
    if (Buffer.byteLength(JSON.stringify(buildPayload(candidate, true)), 'utf8') > POLICY_EVENT_CHANGES_BUDGET_BYTES) {
      changesTruncated = true;
      continue;
    }
    includedChanges = candidate;
  }

  return buildPayload(includedChanges, changesTruncated);
}

function compactPolicyChangePayload(change: PolicyPathChange): JsonValue {
  return compactJsonObject({
    category: change.category,
    path: change.path,
    originalPath: change.originalPath,
    decision: change.decision,
    requiresHuman: change.requiresHuman ? true : undefined,
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
  });
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

  // Attempt delta = pre-attempt baseline vs post-provider snapshot.
  // A dirty path that is byte-for-byte and status-identical is inherited
  // workspace state, not a provider write, and is not classified.
  // Any further change to that path is an Attempt delta and uses the same
  // write/drift rules as a clean-file edit.
  for (const baselineEntry of options.baseline.snapshot.entries) {
    const finalEntry = finalEntries.find((candidate) => entriesShareIdentityOrCoverage(candidate, baselineEntry));
    if (finalEntry && isExactEntryMatch(baselineEntry, finalEntry)) {
      consumedFinalEntries.add(finalEntry.entryFingerprintSha256);
      continue;
    }

    const deltaEntry = finalEntry ?? departedBaselineDelta(baselineEntry);
    if (finalEntry) {
      consumedFinalEntries.add(finalEntry.entryFingerprintSha256);
    }
    const classified = classifyNewEntry({
      entry: deltaEntry,
      runId: options.baseline.runId,
      taskId: options.baseline.taskId,
      attemptId: options.baseline.attemptId,
      permissionProfile: options.baseline.taskPolicy.permissionProfile,
      authorizedWriteScopes: options.baseline.taskPolicy.authorizedWriteScopes,
      plannedAreas: options.baseline.taskPolicy.plannedAreas,
      approvals: options.baseline.taskPolicy.approvals,
      extraProtectedPaths: options.baseline.taskPolicy.scopePackProtectedPaths,
    });
    changes.push(classified);
    if (classified.decision !== 'allow') {
      reasonCodes.add(classified.reasonCode);
    }
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
      plannedAreas: options.baseline.taskPolicy.plannedAreas,
      approvals: options.baseline.taskPolicy.approvals,
      extraProtectedPaths: options.baseline.taskPolicy.scopePackProtectedPaths,
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
  plannedAreas: readonly string[];
  approvals: readonly TaskPolicyApproval[];
  extraProtectedPaths?: readonly string[];
}): PolicyPathChange {
  const category = classifyEntryCategory(options.entry);
  const restricted = classifyRepoEntryRestrictions({
    entry: options.entry,
    runId: options.runId,
    taskId: options.taskId,
    attemptId: options.attemptId,
    approvals: options.approvals,
    extraProtectedPaths: options.extraProtectedPaths,
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
    // Capture the original require-human decision kind before it is collapsed to
    // `deny`, so positive human-gate evidence survives into the durable event.
    const requiresHuman = restricted.decision === 'require-human';
    return {
      category: restricted.reasonCode === 'protected-path' ? 'PROTECTED_CHANGE' : category,
      path: options.entry.path,
      originalPath: options.entry.originalPath,
      decision: requiresHuman ? 'deny' : restricted.decision,
      requiresHuman: requiresHuman ? true : undefined,
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

  // ATB-4: reserved drift classes (deps / db / migrations) raise a human gate
  // even when the path is inside authorizedWritePaths. Most-specific reason
  // wins so telemetry does not collapse these into a generic policy-gate.
  for (const repoPath of touchedPaths) {
    const drift = classifyPathDrift({ path: repoPath, plannedAreas: options.plannedAreas });
    if (drift) {
      return {
        category: fullyAuthorized ? category : 'OUT_OF_SCOPE_CHANGE',
        path: options.entry.path,
        originalPath: options.entry.originalPath,
        decision: 'deny',
        requiresHuman: true,
        reasonCode: drift.reasonCode,
        reason: drift.reason,
        matchedRule: drift.matchedRule,
        indexStatus: options.entry.indexStatus,
        worktreeStatus: options.entry.worktreeStatus,
        entryFingerprintSha256: options.entry.entryFingerprintSha256,
        pathFingerprint: options.entry.pathFingerprint,
        originalPathFingerprint: options.entry.originalPathFingerprint,
      };
    }
  }

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

  for (const repoPath of touchedPaths) {
    const unplanned = classifyUnplannedAreaDrift({ path: repoPath, plannedAreas: options.plannedAreas });
    if (unplanned) {
      return {
        category,
        path: options.entry.path,
        originalPath: options.entry.originalPath,
        decision: 'deny',
        requiresHuman: true,
        reasonCode: unplanned.reasonCode,
        reason: unplanned.reason,
        matchedRule: unplanned.matchedRule,
        indexStatus: options.entry.indexStatus,
        worktreeStatus: options.entry.worktreeStatus,
        entryFingerprintSha256: options.entry.entryFingerprintSha256,
        pathFingerprint: options.entry.pathFingerprint,
        originalPathFingerprint: options.entry.originalPathFingerprint,
      };
    }
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

/**
 * A baseline dirty path that is absent from the post-provider status snapshot
 * changed during the Attempt: an untracked file was removed, or a tracked
 * dirty file was restored/rewritten off the dirty status. HEAD movement is
 * not represented here.
 */
function departedBaselineDelta(entry: RepoStatusEntryFingerprint): RepoStatusEntryFingerprint {
  const removed = entry.kind === 'untracked';
  return {
    ...entry,
    indexStatus: ' ',
    worktreeStatus: removed ? 'D' : 'M',
    kind: removed ? 'deleted' : 'tracked',
    pathFingerprint: removed
      ? {
          ...entry.pathFingerprint,
          exists: false,
          nodeKind: 'missing',
          workingTreeSha256: null,
          sizeBytes: null,
        }
      : entry.pathFingerprint,
    entryFingerprintSha256: `attempt-delta:${entry.entryFingerprintSha256}`,
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
  plannedAreas?: readonly string[];
  doNotTouchPaths?: readonly string[];
  extraSpec?: Record<string, unknown>;
} = {}): TaskRecord['spec'] {
  const extra = options.extraSpec ?? {};
  const extraPlan = extra.plan && typeof extra.plan === 'object' && !Array.isArray(extra.plan)
    ? extra.plan as Record<string, unknown>
    : {};
  return {
    ...extra,
    policy: {
      authorizedWritePaths: [...(options.authorizedWritePaths ?? [])],
      ...(options.doNotTouchPaths ? { doNotTouchPaths: [...options.doNotTouchPaths] } : {}),
    },
    plan: {
      ...extraPlan,
      ...(options.plannedAreas ? { plannedAreas: [...options.plannedAreas] } : {}),
    },
  };
}

function compactJsonObject(value: Record<string, JsonValue | undefined>): JsonValue {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as JsonValue;
}
