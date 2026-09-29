/**
 * CT-LIVE-0C: Owner Apply Candidate.
 *
 * The browser submits apply_candidate. This module is the only canonical
 * filesystem mutation. It reads candidate bytes from the isolated implementer
 * workspace and compares the canonical tree to the captured pre-provider
 * baseline. It never commits, pushes, deploys, or runs migrations.
 */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { OrchestrationEventRecord, TaskRecord } from '../lib/orchestrationTypes.ts';
import type { OrchestrationStore } from '../lib/store.ts';
import { normalizeRepoRelativePath } from '../policy/pathPolicy.ts';
import type { PermissionProfile } from '../providers/types.ts';
import {
  adjudicateAttemptWorkspace,
  captureWorkspaceTree,
  classifyLineEndings,
  describeWorkspaceDelta,
  isExcludedWorkspacePath,
  lfToCRLF,
  readCandidateChangeIndex,
  readCapturedBaseline,
  resolveAttemptWorkspacePath,
  stripCRLF,
  type AttemptWorkspace,
  type CandidateChangeIndexEntry,
  type FileLineEnding,
} from '../workspace.ts';
import { VERIFIER_VERDICT_EVENT } from './supervisorPort.ts';
import type { SnapshotCandidateApply, SnapshotCandidateChange } from './types.ts';

export const CANDIDATE_APPLIED_EVENT = 'control.candidate.applied';

export const APPLY_OWNER_REASONS = {
  verifier: 'Verifier did not pass',
  guard: 'Guard blocked candidate',
  missing: 'Candidate workspace unavailable',
  mismatch: 'Candidate does not match the verified attempt',
  conflict: 'Canonical conflict',
  unsafe: 'Unsafe path',
  filesystem: 'Filesystem apply failed',
  rollback: 'Rollback failed',
  partial: 'Rollback partial',
  verify: 'Verification mismatch',
  already: 'Already applied',
  empty: 'No candidate changes to apply',
  payload: 'Apply request could not be read.',
} as const;

export const APPLY_PHASES = [
  'Apply requested',
  'Checking candidate',
  'Checking canonical drift',
  'Applying candidate',
  'Verifying applied files',
  'Applied',
  'Conflict detected',
] as const;

export type ApplyPhase = (typeof APPLY_PHASES)[number];

/**
 * CT-GATE-FIX-3 goal 5: typed abort for the write/verify loops. Replaces the
 * earlier message-prefix matching ("conflict:…" / "verify") so an unrelated I/O
 * error can never be misclassified as a conflict. `kind` is the abort category and
 * `path` is the repo-relative path that drifted (when known).
 */
class ApplyAbort extends Error {
  readonly kind: 'conflict' | 'unsafe' | 'verify';
  readonly path?: string;
  constructor(kind: 'conflict' | 'unsafe' | 'verify', path?: string) {
    super(kind);
    this.name = 'ApplyAbort';
    this.kind = kind;
    this.path = path;
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export interface ApplyControlPlane {
  notePlanningProgress(requestId: string, progress: Record<string, unknown>): Promise<void>;
  completeRequest(requestId: string, result: Record<string, unknown>): Promise<void>;
  failRequest(requestId: string, safeError: string, result?: Record<string, unknown>): Promise<void>;
}

export interface CandidateApplyStat {
  isSymbolicLink(): boolean;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface CandidateApplyIo {
  readFile: (filePath: string) => Promise<Buffer>;
  writeFile: (filePath: string, data: Buffer) => Promise<void>;
  mkdir: (filePath: string, options: { recursive: boolean }) => Promise<unknown>;
  rm: (filePath: string, options: { force: boolean }) => Promise<void>;
  lstat: (filePath: string) => Promise<CandidateApplyStat>;
}

const DEFAULT_IO: CandidateApplyIo = {
  readFile: (filePath) => readFile(filePath),
  writeFile: (filePath, data) => writeFile(filePath, data),
  mkdir: (filePath, options) => mkdir(filePath, options),
  rm: (filePath, options) => rm(filePath, options),
  lstat: (filePath) => lstat(filePath),
};

export function parseApplyCandidatePayload(payload: Record<string, unknown>): { ok: true; runId: string; attemptId: string } | { ok: false; reason: string } {
  const keys = Object.keys(payload).sort();
  if (keys.length !== 2 || keys[0] !== 'attemptId' || keys[1] !== 'runId') {
    return { ok: false, reason: APPLY_OWNER_REASONS.payload };
  }
  const runId = payload.runId;
  const attemptId = payload.attemptId;
  if (typeof runId !== 'string' || typeof attemptId !== 'string' || !SAFE_ID.test(runId) || !SAFE_ID.test(attemptId)) {
    return { ok: false, reason: APPLY_OWNER_REASONS.payload };
  }
  return { ok: true, runId, attemptId };
}

interface CandidateRecord {
  attemptId: string | null;
  taskId: string | null;
  changeCount: number;
  ready: boolean;
  changes: SnapshotCandidateChange[];
  listComplete: boolean;
  policyAccepted: boolean;
  policySeen: boolean;
  verifier: 'pass' | 'fail' | 'unknown' | null;
  applied: { appliedAt: string | null; pathCount: number | null; requestId: string | null; fingerprint: string | null } | null;
}

export function inspectCandidateRecord(events: readonly OrchestrationEventRecord[]): CandidateRecord {
  const ready = [...events].reverse().find((event) => event.type === 'workspace.changeset.ready');
  const readyPayload = asRecord(ready?.payload);
  const attemptId = ready?.attemptId ?? null;
  const taskId = ready?.taskId ?? null;
  const changeCount = typeof readyPayload?.changeCount === 'number' && Number.isFinite(readyPayload.changeCount) ? readyPayload.changeCount : 0;
  const fromEvent = readChangeList(readyPayload?.changes);
  const policyEvents = events.filter((event) => event.type === 'policy.evaluated' && event.attemptId === attemptId);
  const policy = asRecord(policyEvents.at(-1)?.payload);
  const policyAccepted = policy?.accepted === true;
  const policySeen = policyEvents.length > 0;
  const policyChanges = changesFromPolicy(policy?.changes);
  const changes = fromEvent ?? policyChanges;
  const listComplete = Boolean(ready) && changeCount > 0 && changes.length === changeCount;
  const verdictEvent = [...events].reverse().find((event) => event.type === VERIFIER_VERDICT_EVENT);
  const verdictPayload = asRecord(verdictEvent?.payload);
  const verdict = verdictPayload?.verdict;
  const verifier = verdict === 'pass' || verdict === 'fail' || verdict === 'unknown' ? verdict : null;
  const appliedEvent = [...events].reverse().find((event) => event.type === CANDIDATE_APPLIED_EVENT && (attemptId === null || event.attemptId === attemptId));
  const appliedPayload = asRecord(appliedEvent?.payload);
  return {
    attemptId,
    taskId,
    changeCount: ready ? changeCount : 0,
    ready: Boolean(ready),
    changes: listComplete ? changes : (fromEvent ?? policyChanges),
    listComplete,
    policyAccepted,
    policySeen,
    verifier,
    applied: appliedEvent
      ? {
          appliedAt: typeof appliedPayload?.appliedAt === 'string' ? appliedPayload.appliedAt : appliedEvent.createdAt,
          pathCount: typeof appliedPayload?.pathCount === 'number' ? appliedPayload.pathCount : null,
          requestId: typeof appliedPayload?.requestId === 'string' ? appliedPayload.requestId : null,
          fingerprint: typeof appliedPayload?.fingerprint === 'string' ? appliedPayload.fingerprint : null,
        }
      : null,
  };
}

export function projectCandidateApply(options: {
  runStatus: string;
  events: readonly OrchestrationEventRecord[];
  attemptStatus?: string | null;
}): SnapshotCandidateApply {
  const record = inspectCandidateRecord(options.events);
  const base = {
    attemptId: record.attemptId,
    changeCount: record.applied?.pathCount ?? record.changeCount,
    changes: record.changes,
    applied: Boolean(record.applied),
    appliedAt: record.applied?.appliedAt ?? null,
    pathCount: record.applied?.pathCount ?? null,
    requestId: record.applied?.requestId ?? null,
    fingerprint: record.applied?.fingerprint ?? null,
  };
  if (record.applied) {
    return { ...base, eligible: false, reason: APPLY_OWNER_REASONS.already };
  }
  if (options.runStatus !== 'completed') {
    return { ...base, eligible: false, reason: null };
  }
  if (record.verifier !== 'pass') {
    return { ...base, eligible: false, reason: APPLY_OWNER_REASONS.verifier };
  }
  if (record.policySeen && !record.policyAccepted) {
    return { ...base, eligible: false, reason: APPLY_OWNER_REASONS.guard };
  }
  if (!record.ready || record.changeCount === 0) {
    return { ...base, eligible: false, reason: APPLY_OWNER_REASONS.empty };
  }
  if (!record.policyAccepted || !record.listComplete || !record.attemptId) {
    return { ...base, eligible: false, reason: record.policySeen ? APPLY_OWNER_REASONS.guard : APPLY_OWNER_REASONS.missing };
  }
  if (options.attemptStatus != null && options.attemptStatus !== 'passed') {
    return { ...base, eligible: false, reason: APPLY_OWNER_REASONS.mismatch };
  }
  return { ...base, eligible: true, reason: null };
}

export function applyChangeIndexToSnapshot(
  snapshot: { run: { status: string }; verification: { verdict: string } | null; changeset: { ready: boolean; changeCount: number; safePaths: string[]; changes: SnapshotCandidateChange[]; attemptId: string | null } | null; candidateApply: SnapshotCandidateApply },
  changes: readonly SnapshotCandidateChange[],
): void {
  if (!snapshot.changeset || changes.length !== snapshot.changeset.changeCount || snapshot.changeset.changeCount === 0) return;
  const next = changes.map((change) => ({ path: change.path, kind: change.kind }));
  snapshot.changeset.changes = next;
  snapshot.changeset.safePaths = next.map((change) => change.path).sort();
  snapshot.candidateApply.changes = next;
  snapshot.candidateApply.changeCount = next.length;
  if (
    snapshot.candidateApply.applied
    || snapshot.candidateApply.reason === APPLY_OWNER_REASONS.verifier
    || snapshot.candidateApply.reason === APPLY_OWNER_REASONS.guard
    || snapshot.candidateApply.reason === APPLY_OWNER_REASONS.already
    || snapshot.candidateApply.reason === APPLY_OWNER_REASONS.empty
    || snapshot.candidateApply.reason === APPLY_OWNER_REASONS.mismatch
  ) {
    return;
  }
  if (snapshot.run.status === 'completed' && snapshot.verification?.verdict === 'pass') {
    snapshot.candidateApply.eligible = true;
    snapshot.candidateApply.reason = null;
  }
}

export async function handleApplyCandidate(options: {
  store: OrchestrationStore;
  controlPlane: ApplyControlPlane;
  request: { id: string; repo_key: string; payload: Record<string, unknown> };
  canonicalRepoPath: string;
  workspaceRoot: string;
  repoKey: string;
  io?: CandidateApplyIo;
  afterWrite?: () => Promise<void>;
}): Promise<void> {
  const { controlPlane, request } = options;
  const parsed = parseApplyCandidatePayload(request.payload);
  if (!parsed.ok) {
    await controlPlane.failRequest(request.id, parsed.reason, { phase: 'Apply requested', outcome: 'failed', reason: parsed.reason });
    return;
  }
  if (request.repo_key !== options.repoKey) {
    await controlPlane.failRequest(request.id, APPLY_OWNER_REASONS.missing, { phase: 'Checking candidate', outcome: 'failed', reason: APPLY_OWNER_REASONS.missing });
    return;
  }
  try {
    await controlPlane.notePlanningProgress(request.id, { phase: 'Apply requested' });
    await controlPlane.notePlanningProgress(request.id, { phase: 'Checking candidate' });
    const run = options.store.getRun(parsed.runId);
    if (!run) {
      await controlPlane.failRequest(request.id, APPLY_OWNER_REASONS.missing, { phase: 'Checking candidate', outcome: 'failed', reason: APPLY_OWNER_REASONS.missing, runId: parsed.runId, attemptId: parsed.attemptId });
      return;
    }
    const events = options.store.listEvents().filter((event) => event.runId === parsed.runId);
    const appliedEvent = [...events].reverse().find((event) => event.type === CANDIDATE_APPLIED_EVENT && event.attemptId === parsed.attemptId);
    if (appliedEvent) {
      const appliedPayload = asRecord(appliedEvent.payload);
      await controlPlane.completeRequest(request.id, {
        outcome: 'already-applied',
        phase: 'Applied',
        reason: APPLY_OWNER_REASONS.already,
        runId: parsed.runId,
        attemptId: parsed.attemptId,
        pathCount: typeof appliedPayload?.pathCount === 'number' ? appliedPayload.pathCount : null,
        fingerprint: typeof appliedPayload?.fingerprint === 'string' ? appliedPayload.fingerprint : null,
        requestId: typeof appliedPayload?.requestId === 'string' ? appliedPayload.requestId : null,
        appliedAt: typeof appliedPayload?.appliedAt === 'string' ? appliedPayload.appliedAt : appliedEvent.createdAt,
      });
      return;
    }
    const ready = [...events].reverse().find((event) => event.type === 'workspace.changeset.ready' && event.attemptId === parsed.attemptId);
    const readyPayload = asRecord(ready?.payload);
    const changeCount = typeof readyPayload?.changeCount === 'number' ? readyPayload.changeCount : 0;
    const policy = asRecord([...events].reverse().find((event) => event.type === 'policy.evaluated' && event.attemptId === parsed.attemptId)?.payload);
    const verdict = asRecord([...events].reverse().find((event) => event.type === VERIFIER_VERDICT_EVENT)?.payload)?.verdict;
    if (run.status !== 'completed' || verdict !== 'pass') {
      await controlPlane.failRequest(request.id, APPLY_OWNER_REASONS.verifier, failureResult(parsed, 'Checking candidate', APPLY_OWNER_REASONS.verifier));
      return;
    }
    if (policy?.accepted === false) {
      await controlPlane.failRequest(request.id, APPLY_OWNER_REASONS.guard, failureResult(parsed, 'Checking candidate', APPLY_OWNER_REASONS.guard));
      return;
    }
    if (!ready || changeCount === 0) {
      await controlPlane.failRequest(request.id, APPLY_OWNER_REASONS.empty, failureResult(parsed, 'Checking candidate', APPLY_OWNER_REASONS.empty));
      return;
    }
    const attempt = findAttempt(options.store, parsed.runId, parsed.attemptId);
    if (!attempt || attempt.attempt.status !== 'passed' || attempt.task.taskId !== ready?.taskId || policy?.accepted !== true) {
      await controlPlane.failRequest(request.id, attempt && attempt.attempt.status === 'passed' ? APPLY_OWNER_REASONS.guard : APPLY_OWNER_REASONS.mismatch, failureResult(parsed, 'Checking candidate', attempt && attempt.attempt.status === 'passed' ? APPLY_OWNER_REASONS.guard : APPLY_OWNER_REASONS.mismatch));
      return;
    }
    const record = inspectCandidateRecord(events);

    const identity = { repoKey: options.repoKey, runId: parsed.runId, attemptId: parsed.attemptId };
    let workspacePath: string;
    try {
      workspacePath = resolveAttemptWorkspacePath({ workspaceRoot: options.workspaceRoot, identity });
    } catch {
      await controlPlane.failRequest(request.id, APPLY_OWNER_REASONS.missing, failureResult(parsed, 'Checking candidate', APPLY_OWNER_REASONS.missing));
      return;
    }
    const baseline = await readCapturedBaseline({ workspaceRoot: options.workspaceRoot, identity });
    let workspaceExists = false;
    try {
      const stat = await (options.io ?? DEFAULT_IO).lstat(workspacePath);
      workspaceExists = stat.isDirectory();
    } catch {
      workspaceExists = false;
    }
    if (!baseline || !workspaceExists) {
      await controlPlane.failRequest(request.id, APPLY_OWNER_REASONS.missing, failureResult(parsed, 'Checking candidate', APPLY_OWNER_REASONS.missing));
      return;
    }

    const candidateTree = await captureWorkspaceTree(workspacePath);
    const baselineTree = { files: baseline.files };
    const recomputed = describeWorkspaceDelta(baseline.baselineHeadSha, baselineTree, candidateTree);
    const reviewed = await readCandidateChangeIndex({ workspaceRoot: options.workspaceRoot, identity }) ?? record.changes;
    if (!sameChangeList(recomputed, reviewed)) {
      await controlPlane.failRequest(request.id, APPLY_OWNER_REASONS.missing, failureResult(parsed, 'Checking candidate', APPLY_OWNER_REASONS.missing));
      return;
    }

    const workspace: AttemptWorkspace = {
      workspaceId: `${options.repoKey}/${parsed.runId}/${parsed.attemptId}`,
      workspaceRoot: path.resolve(options.workspaceRoot),
      workspacePath,
      baselineHeadSha: baseline.baselineHeadSha,
      materializationMode: 'git-archive-tar',
      readOnly: false,
      baselineTree,
    };
    const adjudication = await adjudicateAttemptWorkspace({
      workspace,
      runId: parsed.runId,
      task: attempt.task,
      attemptId: parsed.attemptId,
      permissionProfile: permissionProfileOf(attempt.task),
    });
    if (!adjudication.policy.accepted || !adjudication.changeSet) {
      await controlPlane.failRequest(request.id, APPLY_OWNER_REASONS.guard, failureResult(parsed, 'Checking candidate', APPLY_OWNER_REASONS.guard));
      return;
    }
    const guarded = adjudication.changeSet.changes.map((change) => ({ path: change.path, kind: change.kind }));
    if (!sameChangeList(recomputed, guarded)) {
      await controlPlane.failRequest(request.id, APPLY_OWNER_REASONS.guard, failureResult(parsed, 'Checking candidate', APPLY_OWNER_REASONS.guard));
      return;
    }

    await controlPlane.notePlanningProgress(request.id, { phase: 'Checking canonical drift' });
    const prepared = await prepareCandidateWrites({
      canonicalRepoPath: options.canonicalRepoPath,
      workspacePath,
      baseline: baseline.files,
      changes: recomputed,
      io: options.io ?? DEFAULT_IO,
    });
    if (!prepared.ok) {
      const phase = prepared.reason === APPLY_OWNER_REASONS.conflict ? 'Conflict detected' : 'Checking canonical drift';
      await controlPlane.failRequest(request.id, prepared.reason, {
        ...failureResult(parsed, phase, prepared.reason),
        ...(prepared.conflictPaths ? { conflictPaths: prepared.conflictPaths } : {}),
      });
      return;
    }

    await controlPlane.notePlanningProgress(request.id, { phase: 'Applying candidate' });
    const applied = await commitPreparedWrites({
      canonicalRepoPath: options.canonicalRepoPath,
      planned: prepared.planned,
      baseline: baseline.files,
      io: options.io ?? DEFAULT_IO,
      afterWrite: options.afterWrite,
      beforeVerify: async () => {
        await controlPlane.notePlanningProgress(request.id, { phase: 'Verifying applied files' });
      },
    });
    if (!applied.ok) {
      // CT-GATE-FIX-3 goal 5: outcome priority. commitPreparedWrites already folded
      // the rollback status into `reason` (FAIL→rollback, PARTIAL→partial, both
      // taking priority over the abort category). The phase label still reflects the
      // triggering event (conflict vs. a generic apply failure) for the owner's log.
      const phase = applied.reason === APPLY_OWNER_REASONS.conflict ? 'Conflict detected' : 'Applying candidate';
      await controlPlane.failRequest(request.id, applied.reason, {
        ...failureResult(parsed, phase, applied.reason),
        rollback: applied.rollback,
        ...(applied.conflictPaths ? { conflictPaths: applied.conflictPaths } : {}),
        ...(applied.partialPaths ? { partialPaths: applied.partialPaths } : {}),
      });
      return;
    }

    const fingerprint = fingerprintChanges(prepared.planned);
    const appliedAt = new Date().toISOString();
    options.store.appendEvent({
      eventId: `${CANDIDATE_APPLIED_EVENT}:${parsed.attemptId}`,
      runId: parsed.runId,
      taskId: attempt.task.taskId,
      attemptId: parsed.attemptId,
      type: CANDIDATE_APPLIED_EVENT,
      payload: {
        requestId: request.id,
        fingerprint,
        pathCount: prepared.planned.length,
        appliedAt,
        runId: parsed.runId,
        attemptId: parsed.attemptId,
      },
    });
    await controlPlane.completeRequest(request.id, {
      outcome: 'applied',
      phase: 'Applied',
      runId: parsed.runId,
      attemptId: parsed.attemptId,
      fingerprint,
      pathCount: prepared.planned.length,
      requestId: request.id,
      appliedAt,
    });
  } catch {
    await controlPlane.failRequest(request.id, APPLY_OWNER_REASONS.filesystem, failureResult(parsed.ok ? parsed : { runId: '', attemptId: '' }, 'Applying candidate', APPLY_OWNER_REASONS.filesystem));
  }
}

interface PlannedWrite {
  kind: 'add' | 'modify' | 'delete';
  relative: string;
  absolute: string;
  candidateBytes: Buffer | null;
  /**
   * CT-GATE-FIX-1 goal 2: the exact bytes to write and later verify against. For a
   * modify this is the candidate converted to the canonical file's line-ending style
   * (uniform LF → CRLF folded to LF; uniform CRLF → LF expanded to CRLF; mixed or
   * binary → candidate bytes unchanged). For an add it is the candidate bytes
   * verbatim. For a delete it is null. `candidateBytes` is preserved unmodified for
   * the applied fingerprint and rollback semantics.
   */
  intendedBytes: Buffer | null;
  canonicalExisted: boolean;
  canonicalBytes: Buffer | null;
}

export async function prepareCandidateWrites(options: {
  canonicalRepoPath: string;
  workspacePath: string;
  baseline: ReadonlyMap<string, { sha256: string; sizeBytes: number }>;
  changes: readonly CandidateChangeIndexEntry[];
  io: CandidateApplyIo;
}): Promise<{ ok: true; planned: PlannedWrite[] } | { ok: false; reason: string; conflictPaths?: string[] }> {
  const planned: PlannedWrite[] = [];
  const conflicts: string[] = [];
  for (const change of options.changes) {
    let relative: string;
    try {
      relative = normalizeRepoRelativePath(change.path);
    } catch {
      return { ok: false, reason: APPLY_OWNER_REASONS.unsafe };
    }
    if (isExcludedWorkspacePath(relative)) {
      return { ok: false, reason: APPLY_OWNER_REASONS.unsafe };
    }
    let absolute: string;
    let workspaceFile: string;
    try {
      absolute = await resolveSafePath(options.canonicalRepoPath, relative, options.io);
      workspaceFile = await resolveSafePath(options.workspacePath, relative, options.io);
    } catch {
      return { ok: false, reason: APPLY_OWNER_REASONS.unsafe };
    }
    const baselineFile = options.baseline.get(relative) ?? null;
    let candidateBytes: Buffer | null = null;
    if (change.kind === 'delete') {
      if (await exists(options.io, workspaceFile)) {
        return { ok: false, reason: APPLY_OWNER_REASONS.missing };
      }
    } else {
      try {
        const stat = await options.io.lstat(workspaceFile);
        if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, reason: APPLY_OWNER_REASONS.unsafe };
        candidateBytes = await options.io.readFile(workspaceFile);
      } catch {
        return { ok: false, reason: APPLY_OWNER_REASONS.missing };
      }
    }
    const canonical = await readCanonical(options.io, absolute);
    if (canonical.unsafe) return { ok: false, reason: APPLY_OWNER_REASONS.unsafe };
    // CT-GATE-FIX-2 goal 3: the preflight conflict check and the per-write re-check
    // share one definition of "canonical still matches the captured baseline".
    if (!canonicalMatchesBaseline(change.kind, baselineFile, canonical)) {
      conflicts.push(relative);
    }
    // CT-GATE-FIX-1 goal 2: preserve the canonical file's line-ending style on
    // write-back. A modify's candidate bytes (the provider may have written CRLF)
    // are converted to the canonical file's style; mixed/binary canonical files and
    // all adds are written exactly as the candidate. The conflict check above stays
    // a raw byte compare (goal 1 makes the baseline == canonical on-disk bytes, so
    // a real owner edit still conflicts and applies nothing).
    let intendedBytes = candidateBytes;
    if (change.kind === 'modify' && candidateBytes && canonical.bytes) {
      // CT-GATE-FIX-2 goal 2: convert line endings ONLY when BOTH the canonical
      // file and the candidate classify as text. If either side is binary (a NUL
      // anywhere in the buffer, per classifyLineEndings' full-buffer scan), write
      // the candidate bytes exactly so a binary payload is never corrupted by
      // CRLF/LF folding. For text-but-mixed canonical the conversion is a no-op
      // anyway, so this guard only matters when one side is binary.
      const canonicalEnding = classifyLineEndings(canonical.bytes);
      const candidateEnding = classifyLineEndings(candidateBytes);
      if (canonicalEnding !== 'binary' && candidateEnding !== 'binary') {
        intendedBytes = convertLineEndings(candidateBytes, canonicalEnding);
      }
    }
    planned.push({
      kind: change.kind,
      relative,
      absolute,
      candidateBytes,
      intendedBytes,
      canonicalExisted: canonical.existed,
      canonicalBytes: canonical.bytes,
    });
  }
  if (conflicts.length > 0) {
    return { ok: false, reason: APPLY_OWNER_REASONS.conflict, conflictPaths: conflicts.sort() };
  }
  return { ok: true, planned };
}

async function commitPreparedWrites(options: {
  canonicalRepoPath: string;
  planned: readonly PlannedWrite[];
  baseline: ReadonlyMap<string, { sha256: string; sizeBytes: number }>;
  io: CandidateApplyIo;
  afterWrite?: (() => Promise<void>) | undefined;
  beforeVerify?: (() => Promise<void>) | undefined;
}): Promise<
  | { ok: true }
  | { ok: false; reason: string; rollback: 'PASS' | 'FAIL' | 'PARTIAL'; conflictPaths?: string[]; partialPaths?: string[] }
> {
  const touched: PlannedWrite[] = [];
  try {
    for (const entry of options.planned) {
      // CT-GATE-FIX-3 goal 3: immediately before EACH write/delete, re-run the same
      // full path-safety resolution used in preflight (resolveSafePath — every
      // ancestor must still be a real directory inside the repo and the target must
      // not be a symlink), THEN the baseline content re-check. A junction swapped
      // onto an ancestor between preflight and this write fails closed as unsafe.
      try {
        await resolveSafePath(options.canonicalRepoPath, entry.relative, options.io);
      } catch {
        throw new ApplyAbort('unsafe', entry.relative);
      }
      // CT-GATE-FIX-2 goal 3: re-read the canonical target and re-check it still
      // matches the captured baseline (MODIFY/DELETE: raw bytes equal; ADD: absent).
      if (!(await recheckCanonicalBeforeWrite(entry, options.baseline, options.io))) {
        throw new ApplyAbort('conflict', entry.relative);
      }
      if (entry.kind === 'delete') {
        await options.io.rm(entry.absolute, { force: false });
      } else {
        // CT-GATE-FIX-3 goal 6 (accepted residual limit): the per-write re-check
        // above confirmed every ancestor is a real directory and the target is not a
        // symlink, but an ancestor directory swapped for a junction in the short
        // interval between that re-check and this write syscall is NOT prevented —
        // the design does not lock the owner's working tree, so a deliberate local
        // tamper in that window could redirect the write. The awaited mkdir below
        // also falls inside this window (it creates the target's parent directory
        // before the write). This residual is accepted in exchange for not locking
        // the owner out of their repo.
        await options.io.mkdir(path.dirname(entry.absolute), { recursive: true });
        await options.io.writeFile(entry.absolute, entry.intendedBytes ?? Buffer.alloc(0));
      }
      touched.push(entry);
    }
    if (options.afterWrite) await options.afterWrite();
    if (options.beforeVerify) await options.beforeVerify();
    for (const entry of options.planned) {
      if (entry.kind === 'delete') {
        if (await exists(options.io, entry.absolute)) {
          throw new ApplyAbort('verify', entry.relative);
        }
      } else {
        const current = await options.io.readFile(entry.absolute);
        const expected = entry.intendedBytes ?? Buffer.alloc(0);
        if (!current.equals(expected)) throw new ApplyAbort('verify', entry.relative);
      }
    }
    return { ok: true };
  } catch (error) {
    const abort = error instanceof ApplyAbort ? error : null;
    const rollback = await rollbackTouched(touched, options.canonicalRepoPath, options.io);
    const conflictPaths = abort?.path ? [abort.path] : [];
    // CT-GATE-FIX-3 goal 5: outcome priority. A bad rollback (FAIL or PARTIAL) takes
    // priority over the abort category — the user must hear that rollback did not
    // cleanly restore the tree, not the conflict that triggered it. An unrelated I/O
    // error (abort === null) is never classified as a conflict.
    if (rollback.status === 'FAIL') {
      return { ok: false, reason: APPLY_OWNER_REASONS.rollback, rollback: 'FAIL', conflictPaths };
    }
    if (rollback.status === 'PARTIAL') {
      return { ok: false, reason: APPLY_OWNER_REASONS.partial, rollback: 'PARTIAL', conflictPaths, partialPaths: rollback.partialPaths };
    }
    const reason = abort?.kind === 'conflict' ? APPLY_OWNER_REASONS.conflict
      : abort?.kind === 'unsafe' ? APPLY_OWNER_REASONS.unsafe
        : abort?.kind === 'verify' ? APPLY_OWNER_REASONS.verify
          : APPLY_OWNER_REASONS.filesystem;
    return { ok: false, reason, rollback: 'PASS', conflictPaths };
  }
}

async function rollbackTouched(
  touched: readonly PlannedWrite[],
  canonicalRepoPath: string,
  io: CandidateApplyIo,
): Promise<{ status: 'PASS' | 'FAIL' | 'PARTIAL'; partialPaths: string[] }> {
  // CT-GATE-FIX-3 goal 4: rollback never clobbers a later owner edit. Before
  // restoring each already-written file, prove Apply's own change is still intact
  // on disk (a delete is still absent; an add/modify still holds exactly the bytes
  // Apply wrote). If it does not — the owner edited the file after Apply wrote it —
  // do NOT restore: leave the owner's bytes in place, record the path, and report
  // PARTIAL. Only undo what Apply itself did and can prove is unchanged.
  //
  // CT-GATE-FIX-4 goal 1: before EVERY rollback write or delete, re-run the full
  // path-safety resolution (resolveSafePath) used in preflight and per-write. If the
  // path is no longer safe (an ancestor was swapped for a junction, the target became
  // a symlink, etc.), do NOT restore it — record it in partialPaths and report PARTIAL,
  // so nothing is ever written or deleted outside the repo during rollback. An
  // unexpected error from the path-safety check itself (not the 'unsafe' sentinel)
  // is a genuine I/O failure → FAIL.
  const partialPaths: string[] = [];
  const restored: PlannedWrite[] = [];
  try {
    for (const entry of [...touched].reverse()) {
      try {
        await resolveSafePath(canonicalRepoPath, entry.relative, io);
      } catch (error) {
        if (error instanceof Error && error.message === 'unsafe') {
          partialPaths.push(entry.relative);
          continue;
        }
        throw error;
      }
      if (!(await canProveApplyChangeStillIntact(entry, io))) {
        partialPaths.push(entry.relative);
        continue;
      }
      if (entry.kind === 'add') {
        await io.rm(entry.absolute, { force: false });
      } else {
        // modify or delete: restore the captured canonical baseline bytes.
        await io.mkdir(path.dirname(entry.absolute), { recursive: true });
        await io.writeFile(entry.absolute, entry.canonicalBytes ?? Buffer.alloc(0));
      }
      restored.push(entry);
    }
    // Verify every restore actually landed.
    for (const entry of restored) {
      if (entry.kind === 'add') {
        if (await exists(io, entry.absolute)) return { status: 'FAIL', partialPaths };
      } else {
        const current = await io.readFile(entry.absolute);
        if (!current.equals(entry.canonicalBytes ?? Buffer.alloc(0))) {
          return { status: 'FAIL', partialPaths };
        }
      }
    }
    if (partialPaths.length > 0) return { status: 'PARTIAL', partialPaths };
    return { status: 'PASS', partialPaths };
  } catch {
    return { status: 'FAIL', partialPaths };
  }
}

/**
 * CT-GATE-FIX-3 goal 4: prove Apply's own change is still intact on disk. A delete
 * is intact when the path is still absent; an add/modify is intact when the file
 * still holds exactly the bytes Apply wrote (`intendedBytes`). If the owner edited
 * the file after Apply wrote it, this returns false and rollback leaves it alone.
 */
async function canProveApplyChangeStillIntact(entry: PlannedWrite, io: CandidateApplyIo): Promise<boolean> {
  if (entry.kind === 'delete') {
    return !(await exists(io, entry.absolute));
  }
  try {
    const current = await io.readFile(entry.absolute);
    return current.equals(entry.intendedBytes ?? Buffer.alloc(0));
  } catch {
    return false;
  }
}

async function resolveSafePath(root: string, relativePath: string, io: CandidateApplyIo): Promise<string> {
  const normalizedRoot = path.resolve(root);
  const absolute = path.resolve(normalizedRoot, ...relativePath.split('/'));
  const relative = path.relative(normalizedRoot, absolute);
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('unsafe');
  }
  const parts = relative.split(path.sep).filter((part) => part.length > 0);
  let cursor = normalizedRoot;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try {
      const stat = await io.lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error('unsafe');
      if (cursor !== absolute && !stat.isDirectory()) throw new Error('unsafe');
      if (cursor === absolute && stat.isDirectory()) throw new Error('unsafe');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return absolute;
      throw error;
    }
  }
  return absolute;
}

async function readCanonical(io: CandidateApplyIo, absolute: string): Promise<{ existed: boolean; bytes: Buffer | null; unsafe: boolean }> {
  try {
    const stat = await io.lstat(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) return { existed: false, bytes: null, unsafe: true };
    return { existed: true, bytes: await io.readFile(absolute), unsafe: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { existed: false, bytes: null, unsafe: false };
    return { existed: false, bytes: null, unsafe: true };
  }
}

async function exists(io: CandidateApplyIo, absolute: string): Promise<boolean> {
  try {
    await io.lstat(absolute);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * CT-GATE-FIX-2 goal 3: one definition of "the canonical target still matches the
 * captured pre-provider baseline", shared by the preflight conflict check and the
 * per-write re-check. ADD is a match only when neither a baseline entry nor a
 * canonical file exists; MODIFY/DELETE is a match only when the canonical file
 * still exists and its raw bytes equal the baseline sha256 + size. The comparison
 * is deliberately a RAW byte compare (no line-ending folding): the baseline
 * already equals the canonical on-disk bytes (CT-GATE-FIX-1 goal 1), so any real
 * owner edit flips this to a conflict.
 */
function canonicalMatchesBaseline(
  kind: 'add' | 'modify' | 'delete',
  baselineFile: { sha256: string; sizeBytes: number } | undefined | null,
  canonical: { existed: boolean; bytes: Buffer | null },
): boolean {
  if (kind === 'add') {
    return !baselineFile && !canonical.existed;
  }
  return Boolean(baselineFile) && canonical.existed
    && sha256(canonical.bytes ?? Buffer.alloc(0)) === baselineFile!.sha256
    && (canonical.bytes?.byteLength ?? -1) === baselineFile!.sizeBytes;
}

/**
 * CT-GATE-FIX-2 goal 3: re-read the canonical target immediately before a write/
 * delete and confirm it still matches the baseline. Returns true when it is safe
 * to proceed, false when an owner edit has drifted the canonical tree since the
 * preflight (the caller stops, rolls back, and reports a conflict).
 */
async function recheckCanonicalBeforeWrite(
  entry: PlannedWrite,
  baseline: ReadonlyMap<string, { sha256: string; sizeBytes: number }>,
  io: CandidateApplyIo,
): Promise<boolean> {
  const canonical = await readCanonical(io, entry.absolute);
  if (canonical.unsafe) return false;
  return canonicalMatchesBaseline(entry.kind, baseline.get(entry.relative), canonical);
}

function findAttempt(store: OrchestrationStore, runId: string, attemptId: string): { task: TaskRecord; attempt: { status: string; taskId: string } } | null {
  for (const task of store.listTasks(runId)) {
    const attempt = store.listAttempts(task.taskId).find((entry) => entry.attemptId === attemptId);
    if (attempt) return { task, attempt };
  }
  return null;
}

function permissionProfileOf(task: TaskRecord): PermissionProfile {
  const spec = task.spec;
  if (typeof spec === 'object' && spec !== null && !Array.isArray(spec)) {
    const control = (spec as Record<string, unknown>).control;
    if (typeof control === 'object' && control !== null && !Array.isArray(control)) {
      const profile = (control as Record<string, unknown>).permissionProfile;
      if (profile === 'task-implementer' || profile === 'verifier' || profile === 'read-only-reviewer') {
        return profile;
      }
    }
  }
  return 'task-implementer';
}

function sameChangeList(left: readonly { path: string; kind: string }[], right: readonly { path: string; kind: string }[]): boolean {
  const sort = (entries: readonly { path: string; kind: string }[]) => [...entries].map((entry) => `${entry.kind}:${entry.path}`).sort();
  const a = sort(left);
  const b = sort(right);
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function fingerprintChanges(planned: readonly PlannedWrite[]): string {
  const body = [...planned]
    .sort((left, right) => left.relative.localeCompare(right.relative))
    .map((entry) => `${entry.kind}\n${entry.relative}\n${entry.candidateBytes ? sha256(entry.candidateBytes) : ''}`)
    .join('\n');
  return sha256(Buffer.from(body));
}

function failureResult(ids: { runId: string; attemptId: string }, phase: ApplyPhase, reason: string): Record<string, unknown> {
  return { outcome: 'failed', phase, reason, runId: ids.runId, attemptId: ids.attemptId };
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * CT-GATE-FIX-1 goal 2: convert candidate bytes to the canonical file's
 * line-ending style. Uniform LF → fold CRLF to LF; uniform CRLF → expand LF to
 * CRLF. Mixed-ending and binary canonical files keep the candidate bytes exactly
 * (a NUL anywhere in the buffer is treated as binary, matching classifyLineEndings'
 * full-buffer scan).
 */
function convertLineEndings(candidate: Buffer, target: FileLineEnding): Buffer {
  if (target === 'mixed' || target === 'binary') return candidate;
  const stripped = stripCRLF(candidate);
  if (target === 'lf') return stripped;
  return lfToCRLF(stripped);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readChangeList(value: unknown): SnapshotCandidateChange[] | null {
  if (!Array.isArray(value)) return null;
  const changes: SnapshotCandidateChange[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record || typeof record.path !== 'string') return null;
    if (record.kind !== 'add' && record.kind !== 'modify' && record.kind !== 'delete') return null;
    try {
      changes.push({ path: normalizeRepoRelativePath(record.path), kind: record.kind });
    } catch {
      return null;
    }
  }
  return changes;
}

function changesFromPolicy(value: unknown): SnapshotCandidateChange[] {
  if (!Array.isArray(value)) return [];
  const changes: SnapshotCandidateChange[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record || record.decision !== 'allow' || typeof record.path !== 'string') continue;
    try {
      changes.push({ path: normalizeRepoRelativePath(record.path), kind: kindFromPolicy(record) });
    } catch {
      continue;
    }
  }
  return changes;
}

function kindFromPolicy(record: Record<string, unknown>): 'add' | 'modify' | 'delete' {
  const status = typeof record.worktreeStatus === 'string' ? record.worktreeStatus : '';
  const kind = typeof record.kind === 'string' ? record.kind : '';
  const category = typeof record.category === 'string' ? record.category : '';
  if (status === 'D' || kind === 'deleted' || kind === 'delete' || category === 'DELETED_FILE') return 'delete';
  if (status === '?' || kind === 'untracked' || kind === 'add' || category === 'NEW' || category === 'UNTRACKED_FILE') return 'add';
  return 'modify';
}
