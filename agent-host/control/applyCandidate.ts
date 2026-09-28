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
  describeWorkspaceDelta,
  isExcludedWorkspacePath,
  readCandidateChangeIndex,
  readCapturedBaseline,
  resolveAttemptWorkspacePath,
  type AttemptWorkspace,
  type CandidateChangeIndexEntry,
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
      planned: prepared.planned,
      io: options.io ?? DEFAULT_IO,
      afterWrite: options.afterWrite,
      beforeVerify: async () => {
        await controlPlane.notePlanningProgress(request.id, { phase: 'Verifying applied files' });
      },
    });
    if (!applied.ok) {
      const reason = applied.rollback === 'FAIL' ? APPLY_OWNER_REASONS.rollback : applied.reason;
      await controlPlane.failRequest(request.id, reason, {
        ...failureResult(parsed, 'Applying candidate', reason),
        rollback: applied.rollback,
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
    if (change.kind === 'add') {
      if (baselineFile || canonical.existed) conflicts.push(relative);
    } else if (!baselineFile || !canonical.existed || sha256(canonical.bytes ?? Buffer.alloc(0)) !== baselineFile.sha256 || (canonical.bytes?.byteLength ?? -1) !== baselineFile.sizeBytes) {
      conflicts.push(relative);
    }
    planned.push({
      kind: change.kind,
      relative,
      absolute,
      candidateBytes,
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
  planned: readonly PlannedWrite[];
  io: CandidateApplyIo;
  afterWrite?: (() => Promise<void>) | undefined;
  beforeVerify?: (() => Promise<void>) | undefined;
}): Promise<{ ok: true } | { ok: false; reason: string; rollback: 'PASS' | 'FAIL' }> {
  const touched: PlannedWrite[] = [];
  try {
    for (const entry of options.planned) {
      if (entry.kind === 'delete') {
        await options.io.rm(entry.absolute, { force: false });
      } else {
        await options.io.mkdir(path.dirname(entry.absolute), { recursive: true });
        await options.io.writeFile(entry.absolute, entry.candidateBytes ?? Buffer.alloc(0));
      }
      touched.push(entry);
    }
    if (options.afterWrite) await options.afterWrite();
    if (options.beforeVerify) await options.beforeVerify();
    for (const entry of options.planned) {
      if (entry.kind === 'delete') {
        if (await exists(options.io, entry.absolute)) {
          throw new Error('verify');
        }
      } else {
        const current = await options.io.readFile(entry.absolute);
        const expected = entry.candidateBytes ?? Buffer.alloc(0);
        if (!current.equals(expected)) throw new Error('verify');
      }
    }
    return { ok: true };
  } catch (error) {
    const verifyFailed = error instanceof Error && error.message === 'verify';
    const rollback = await rollbackTouched(touched, options.io);
    return {
      ok: false,
      reason: verifyFailed ? APPLY_OWNER_REASONS.verify : APPLY_OWNER_REASONS.filesystem,
      rollback,
    };
  }
}

async function rollbackTouched(touched: readonly PlannedWrite[], io: CandidateApplyIo): Promise<'PASS' | 'FAIL'> {
  try {
    for (const entry of [...touched].reverse()) {
      if (entry.canonicalExisted) {
        await io.mkdir(path.dirname(entry.absolute), { recursive: true });
        await io.writeFile(entry.absolute, entry.canonicalBytes ?? Buffer.alloc(0));
      } else if (await exists(io, entry.absolute)) {
        await io.rm(entry.absolute, { force: false });
      }
    }
    for (const entry of touched) {
      if (entry.canonicalExisted) {
        const current = await io.readFile(entry.absolute);
        if (!current.equals(entry.canonicalBytes ?? Buffer.alloc(0))) return 'FAIL';
      } else if (await exists(io, entry.absolute)) {
        return 'FAIL';
      }
    }
    return 'PASS';
  } catch {
    return 'FAIL';
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
