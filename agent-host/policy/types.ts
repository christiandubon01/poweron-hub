import type { JsonValue, TaskRecord } from '../lib/orchestrationTypes.ts';
import type { PermissionProfile } from '../providers/types.ts';

export type PolicyDecisionKind = 'allow' | 'deny' | 'require-human';

export type PolicyReasonCode =
  | 'in-scope'
  | 'preexisting-change'
  | 'preexisting-change-mutated'
  | 'out-of-scope-write'
  | 'protected-path'
  | 'reviewer-immutability'
  | 'unexpected-head-move'
  | 'git-write-local'
  | 'git-destructive'
  | 'dependency-mutation'
  | 'db-mutation'
  | 'deploy'
  | 'secret-access'
  | 'destructive-fs'
  | 'unknown-command'
  | 'invalid-write-scope';

export interface PolicyDecision {
  decision: PolicyDecisionKind;
  reasonCode: PolicyReasonCode;
  reason: string;
  matchedRule: string;
}

export type HostCommandClassification =
  | 'READ_ONLY'
  | 'VALIDATION'
  | 'GIT_WRITE_LOCAL'
  | 'GIT_DESTRUCTIVE'
  | 'DEP_MUTATION'
  | 'DB_MUTATION'
  | 'DEPLOY'
  | 'DESTRUCTIVE_FS'
  | 'SECRET_ACCESS'
  | 'UNKNOWN';

export type WriteScopeKind = 'exact-file' | 'directory-prefix';

export interface AuthorizedWriteScope {
  kind: WriteScopeKind;
  raw: string;
  normalizedPath: string;
  normalizedPathKey: string;
}

export interface TaskPolicyApproval {
  runId: string;
  taskId: string;
  attemptId?: string;
  action: 'protected-path-write';
  scopes: readonly string[];
}

export interface TaskPolicyContext {
  permissionProfile: PermissionProfile;
  taskSpec: JsonValue | null;
  authorizedWriteScopes: readonly AuthorizedWriteScope[];
  invalidAuthorizedWriteScopes: readonly string[];
  approvals: readonly TaskPolicyApproval[];
}

export type RepoStatusKind = 'tracked' | 'untracked' | 'deleted' | 'renamed';

export interface RepoStatusEntry {
  path: string;
  pathKey: string;
  originalPath?: string;
  originalPathKey?: string;
  indexStatus: string;
  worktreeStatus: string;
  kind: RepoStatusKind;
}

export interface RepoPathFingerprint {
  path: string;
  pathKey: string;
  exists: boolean;
  nodeKind: 'file' | 'directory' | 'missing' | 'other';
  workingTreeSha256: string | null;
  sizeBytes: number | null;
  indexObjectId: string | null;
}

export interface RepoStatusEntryFingerprint extends RepoStatusEntry {
  entryFingerprintSha256: string;
  pathFingerprint: RepoPathFingerprint;
  originalPathFingerprint?: RepoPathFingerprint;
}

export interface RepoSnapshot {
  headSha: string;
  entries: readonly RepoStatusEntryFingerprint[];
}

export interface PolicyBaselineCapture {
  runId: string;
  taskId: string;
  attemptId: string;
  repoPath: string;
  taskPolicy: TaskPolicyContext;
  snapshot: RepoSnapshot;
}

export type RepoChangeCategory =
  | 'AUTHORIZED_CHANGE'
  | 'PREEXISTING_UNRELATED_CHANGE'
  | 'PREEXISTING_CHANGE_MUTATED'
  | 'OUT_OF_SCOPE_CHANGE'
  | 'PROTECTED_CHANGE'
  | 'UNTRACKED_FILE'
  | 'DELETED_FILE'
  | 'RENAMED_FILE';

export interface PolicyPathChange {
  category: RepoChangeCategory;
  path: string;
  originalPath?: string;
  decision: PolicyDecisionKind;
  reasonCode: PolicyReasonCode;
  reason: string;
  matchedRule: string;
  indexStatus: string;
  worktreeStatus: string;
  entryFingerprintSha256: string;
  pathFingerprint: RepoPathFingerprint;
  originalPathFingerprint?: RepoPathFingerprint;
}

export interface PolicyAdjudication {
  decision: PolicyDecisionKind;
  accepted: boolean;
  reasonCodes: readonly PolicyReasonCode[];
  reason: string;
  baselineHeadSha: string;
  finalHeadSha: string;
  headMoved: boolean;
  changes: readonly PolicyPathChange[];
}

export interface PolicyCaptureInput {
  runId: string;
  task: TaskRecord;
  attemptId: string;
  permissionProfile: PermissionProfile;
  workingDirectory: string;
  approvals?: readonly TaskPolicyApproval[];
}

export interface PolicyAdjudicationInput {
  baseline: PolicyBaselineCapture;
  workingDirectory: string;
}
