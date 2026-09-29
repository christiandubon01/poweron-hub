/**
 * CT-LIVE-0C owner apply candidate.
 * Existing Control Tower suites remain the regression gate for 0A0–0A4,
 * capacity, Opus 4.8, fast planning, isolation, the verifier copy, and Guard.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { JsonValue } from '../lib/orchestrationTypes.ts';
import { openOrchestrationStore, type OrchestrationStore } from '../lib/store.ts';
import { VERIFIER_VERDICT_EVENT } from './supervisorPort.ts';
import {
  captureWorkspaceTree,
  capturedBaselineSidecarPath,
  describeWorkspaceDelta,
  readCapturedBaseline,
  writeCandidateChangeIndex,
  writeCapturedBaseline,
} from '../workspace.ts';
import {
  APPLY_OWNER_REASONS,
  handleApplyCandidate,
  parseApplyCandidatePayload,
  prepareCandidateWrites,
  projectCandidateApply,
  type ApplyControlPlane,
  type CandidateApplyIo,
} from './applyCandidate.ts';

const REPO_KEY = 'repo-key-1';
const RUN_ID = 'run-1';
const ATTEMPT_ID = 'attempt-1';
const TASK_ID = 'task-1';
const HEAD = 'a'.repeat(40);

interface Plane {
  control: ApplyControlPlane;
  completed: Record<string, unknown> | null;
  failed: { error: string; result?: Record<string, unknown> } | null;
  phases: string[];
}

function plane(): Plane {
  const state: Plane = { control: {} as ApplyControlPlane, completed: null, failed: null, phases: [] };
  state.control = {
    async notePlanningProgress(_id, progress) {
      if (typeof progress.phase === 'string') state.phases.push(progress.phase);
    },
    async completeRequest(_id, result) {
      state.completed = result;
    },
    async failRequest(_id, error, result) {
      state.failed = { error, ...(result ? { result } : {}) };
    },
  };
  return state;
}

async function withStore(work: (store: OrchestrationStore) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'apply-candidate-'));
  let eventCounter = 0;
  const store = openOrchestrationStore({
    dbPath: path.join(tempDir, 'orchestration.sqlite'),
    repoKey: REPO_KEY,
    hostId: 'host-1',
    hostVersion: '0.1.0',
    idGenerator: () => `evt-${++eventCounter}`,
  });
  try {
    await work(store);
  } finally {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

function taskSpec(paths: string[]): Record<string, unknown> {
  return {
    control: { provider: 'codex', permissionProfile: 'task-implementer', prompt: 'edit', timeoutMs: 60_000 },
    policy: { authorizedWritePaths: paths },
    plan: { clientTaskKey: 'impl', role: 'implementer', plannedAreas: [] },
  };
}

function seedRun(store: OrchestrationStore, options: {
  paths: string[];
  verdict?: 'pass' | 'fail';
  policyAccepted?: boolean;
  changeCount?: number;
  changes?: Array<{ path: string; kind: 'add' | 'modify' | 'delete' }>;
  includeReady?: boolean;
  attemptStatus?: 'passed' | 'running';
}): void {
  store.createRun({ runId: RUN_ID, title: 'apply' });
  store.transitionRun(RUN_ID, 'running');
  store.transitionRun(RUN_ID, 'completed');
  store.createTask({ taskId: TASK_ID, runId: RUN_ID, title: 'Implement', goal: 'edit', spec: taskSpec(options.paths) as JsonValue });
  store.createAttempt({ attemptId: ATTEMPT_ID, taskId: TASK_ID, hostInstanceId: 'host-1' });
  if ((options.attemptStatus ?? 'passed') === 'passed') store.transitionAttempt(ATTEMPT_ID, 'passed');
  store.appendEvent({
    eventId: 'verdict-1',
    runId: RUN_ID,
    taskId: TASK_ID,
    attemptId: ATTEMPT_ID,
    type: VERIFIER_VERDICT_EVENT,
    payload: { verdict: options.verdict ?? 'pass' },
  });
  const changes = options.changes ?? [];
  store.appendEvent({
    eventId: 'policy-1',
    runId: RUN_ID,
    taskId: TASK_ID,
    attemptId: ATTEMPT_ID,
    type: 'policy.evaluated',
    payload: {
      accepted: options.policyAccepted ?? true,
      changes: changes.map((change) => ({ path: change.path, decision: 'allow', kind: change.kind })),
    },
  });
  if (options.includeReady !== false) {
    store.appendEvent({
      eventId: 'ready-1',
      runId: RUN_ID,
      taskId: TASK_ID,
      attemptId: ATTEMPT_ID,
      type: 'workspace.changeset.ready',
      payload: {
        workspaceId: `${REPO_KEY}/${RUN_ID}/${ATTEMPT_ID}`,
        baselineHeadSha: HEAD,
        changeCount: options.changeCount ?? changes.length,
        workspaceState: 'cleanup-eligible',
        changes,
      },
    });
  }
}

async function writeRel(root: string, relativePath: string, contents: string): Promise<void> {
  const absolute = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, contents);
}

async function stage(files: Array<{ path: string; baseline: string | null; candidate: string | null; canonical?: string | null }>, unrelated?: { path: string; contents: string }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apply-tree-'));
  const canonical = path.join(root, 'canonical');
  const workspaceRoot = path.join(root, 'workspaces');
  const baselineDir = path.join(root, 'baseline');
  const workspacePath = path.join(workspaceRoot, REPO_KEY, RUN_ID, ATTEMPT_ID);
  await mkdir(baselineDir, { recursive: true });
  await mkdir(workspacePath, { recursive: true });
  await mkdir(canonical, { recursive: true });
  for (const file of files) {
    if (file.baseline !== null) await writeRel(baselineDir, file.path, file.baseline);
    if (file.candidate !== null) await writeRel(workspacePath, file.path, file.candidate);
    const canonicalContents = file.canonical === undefined ? file.baseline : file.canonical;
    if (canonicalContents !== null) await writeRel(canonical, file.path, canonicalContents);
  }
  if (unrelated) await writeRel(canonical, unrelated.path, unrelated.contents);
  const identity = { repoKey: REPO_KEY, runId: RUN_ID, attemptId: ATTEMPT_ID };
  const baselineTree = await captureWorkspaceTree(baselineDir);
  await writeCapturedBaseline({ workspaceRoot, identity, baselineHeadSha: HEAD, tree: baselineTree });
  const changes = describeWorkspaceDelta(HEAD, baselineTree, await captureWorkspaceTree(workspacePath));
  await writeCandidateChangeIndex({ workspaceRoot, identity, changes });
  return { root, canonical, workspaceRoot, changes };
}

function request(id = 'req-1'): { id: string; repo_key: string; payload: Record<string, unknown> } {
  return { id, repo_key: REPO_KEY, payload: { runId: RUN_ID, attemptId: ATTEMPT_ID } };
}

async function apply(store: OrchestrationStore, staged: { canonical: string; workspaceRoot: string }, extras: { io?: CandidateApplyIo; afterWrite?: () => Promise<void>; requestId?: string } = {}) {
  const recorded = plane();
  await handleApplyCandidate({
    store,
    controlPlane: recorded.control,
    request: request(extras.requestId ?? 'req-1'),
    canonicalRepoPath: staged.canonical,
    workspaceRoot: staged.workspaceRoot,
    repoKey: REPO_KEY,
    ...(extras.io ? { io: extras.io } : {}),
    ...(extras.afterWrite ? { afterWrite: extras.afterWrite } : {}),
  });
  return recorded;
}

function countingIo(failOn?: string): { io: CandidateApplyIo; writes: () => string[] } {
  const writes: string[] = [];
  const io: CandidateApplyIo = {
    readFile: (filePath) => readFile(filePath),
    mkdir: (filePath, options) => mkdir(filePath, options),
    rm: (filePath, options) => rm(filePath, options),
    lstat: (filePath) => lstat(filePath),
    writeFile: async (filePath, data) => {
      writes.push(filePath);
      if (failOn && filePath.endsWith(failOn)) throw new Error('injected write failure');
      await writeFile(filePath, data);
    },
  };
  return { io, writes: () => writes };
}

test('apply_candidate payload accepts only runId and attemptId', () => {
  const parsed = parseApplyCandidatePayload({ runId: RUN_ID, attemptId: ATTEMPT_ID });
  assert.equal(parsed.ok, true);
  assert.equal(parseApplyCandidatePayload({ runId: '../escape', attemptId: ATTEMPT_ID }).ok, false);
  assert.equal(parseApplyCandidatePayload({ runId: RUN_ID, attemptId: ATTEMPT_ID, path: 'notes/smoke.txt' }).ok, false);
  assert.equal(parseApplyCandidatePayload({ runId: RUN_ID }).ok, false);
  assert.equal(parseApplyCandidatePayload({ runId: 'C:/repo', attemptId: ATTEMPT_ID }).ok, false);
});

test('verified candidate is eligible and verifier, guard, and zero-change candidates are not', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/smoke.txt'], changes: [{ path: 'notes/smoke.txt', kind: 'modify' }] });
    const events = store.listEvents().filter((event) => event.runId === RUN_ID);
    assert.equal(projectCandidateApply({ runStatus: 'completed', events, attemptStatus: 'passed' }).eligible, true);
    assert.equal(projectCandidateApply({ runStatus: 'completed', events, attemptStatus: 'passed' }).reason, null);
  });
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/smoke.txt'], verdict: 'fail', changes: [{ path: 'notes/smoke.txt', kind: 'modify' }] });
    const events = store.listEvents().filter((event) => event.runId === RUN_ID);
    assert.equal(projectCandidateApply({ runStatus: 'completed', events, attemptStatus: 'passed' }).reason, APPLY_OWNER_REASONS.verifier);
  });
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/smoke.txt'], policyAccepted: false, changes: [{ path: 'notes/smoke.txt', kind: 'modify' }] });
    const events = store.listEvents().filter((event) => event.runId === RUN_ID);
    assert.equal(projectCandidateApply({ runStatus: 'completed', events, attemptStatus: 'passed' }).reason, APPLY_OWNER_REASONS.guard);
  });
  await withStore(async (store) => {
    seedRun(store, { paths: [], includeReady: false, changes: [] });
    const events = store.listEvents().filter((event) => event.runId === RUN_ID);
    assert.equal(projectCandidateApply({ runStatus: 'completed', events, attemptStatus: 'passed' }).reason, APPLY_OWNER_REASONS.empty);
  });
});

test('handler rejects verifier failure, guard block, zero changes, a missing workspace, and a second apply', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/smoke.txt'], verdict: 'fail', changes: [{ path: 'notes/smoke.txt', kind: 'modify' }] });
    const staged = await stage([{ path: 'notes/smoke.txt', baseline: 'base\n', candidate: 'next\n' }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.verifier);
    assert.equal(await readFile(path.join(staged.canonical, 'notes/smoke.txt'), 'utf8'), 'base\n');
    await rm(staged.root, { recursive: true, force: true });
  });
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/smoke.txt'], policyAccepted: false, changes: [{ path: 'notes/smoke.txt', kind: 'modify' }] });
    const staged = await stage([{ path: 'notes/smoke.txt', baseline: 'base\n', candidate: 'next\n' }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.guard);
    assert.equal(await readFile(path.join(staged.canonical, 'notes/smoke.txt'), 'utf8'), 'base\n');
    await rm(staged.root, { recursive: true, force: true });
  });
  await withStore(async (store) => {
    seedRun(store, { paths: [], includeReady: false });
    const staged = await stage([]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.empty);
    await rm(staged.root, { recursive: true, force: true });
  });
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/smoke.txt'], changes: [{ path: 'notes/smoke.txt', kind: 'modify' }] });
    const staged = await stage([{ path: 'notes/smoke.txt', baseline: 'base\n', candidate: 'next\n' }]);
    await rm(path.join(staged.workspaceRoot, REPO_KEY, RUN_ID, ATTEMPT_ID), { recursive: true, force: true });
    const recorded = await apply(store, staged);
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.missing);
    assert.equal(await readFile(path.join(staged.canonical, 'notes/smoke.txt'), 'utf8'), 'base\n');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('exact modify, add, delete, and mixed edits apply without touching unrelated files', async () => {
  await withStore(async (store) => {
    const files = [
      { path: 'notes/modified.txt', baseline: 'owner\r\n', candidate: 'owner\r\nprovider\r\n' },
      { path: 'notes/added.txt', baseline: null, candidate: 'created\r\n' },
      { path: 'notes/removed.txt', baseline: 'gone\r\n', candidate: null },
    ];
    seedRun(store, {
      paths: files.map((file) => file.path),
      changes: [
        { path: 'notes/modified.txt', kind: 'modify' },
        { path: 'notes/added.txt', kind: 'add' },
        { path: 'notes/removed.txt', kind: 'delete' },
      ],
    });
    const staged = await stage(files, { path: 'notes/unrelated.txt', contents: 'leave-me\r\n' });
    const counter = countingIo();
    const recorded = await apply(store, staged, { io: counter.io });
    assert.equal(recorded.completed?.outcome, 'applied');
    assert.equal(recorded.completed?.pathCount, 3);
    assert.equal(await readFile(path.join(staged.canonical, 'notes/modified.txt'), 'utf8'), 'owner\r\nprovider\r\n');
    assert.equal(await readFile(path.join(staged.canonical, 'notes/added.txt'), 'utf8'), 'created\r\n');
    await assert.rejects(readFile(path.join(staged.canonical, 'notes/removed.txt')));
    assert.equal(await readFile(path.join(staged.canonical, 'notes/unrelated.txt'), 'utf8'), 'leave-me\r\n');
    assert.equal(counter.writes().some((entry) => entry.endsWith('unrelated.txt')), false);
    assert.ok(recorded.phases.includes('Checking canonical drift'));
    assert.ok(recorded.phases.includes('Applying candidate'));
    assert.ok(recorded.phases.includes('Verifying applied files'));
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('pre-existing owner bytes stay in the applied file and a later edit to that path conflicts', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/smoke.txt'], changes: [{ path: 'notes/smoke.txt', kind: 'modify' }] });
    const staged = await stage([{ path: 'notes/smoke.txt', baseline: 'A\nowner\n', candidate: 'A\nowner\nprovider\n' }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.completed?.outcome, 'applied');
    assert.equal(await readFile(path.join(staged.canonical, 'notes/smoke.txt'), 'utf8'), 'A\nowner\nprovider\n');
    await rm(staged.root, { recursive: true, force: true });
  });
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/smoke.txt'], changes: [{ path: 'notes/smoke.txt', kind: 'modify' }] });
    const staged = await stage([{ path: 'notes/smoke.txt', baseline: 'A\nowner\n', candidate: 'A\nowner\nprovider\n', canonical: 'A\nowner\nlater\n' }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.conflict);
    assert.equal(recorded.failed?.result?.phase, 'Conflict detected');
    assert.deepEqual(recorded.failed?.result?.conflictPaths, ['notes/smoke.txt']);
    assert.equal(await readFile(path.join(staged.canonical, 'notes/smoke.txt'), 'utf8'), 'A\nowner\nlater\n');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('added-file collisions and deleted-file divergence apply nothing', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/added.txt'], changes: [{ path: 'notes/added.txt', kind: 'add' }] });
    const staged = await stage([{ path: 'notes/added.txt', baseline: null, candidate: 'created\n', canonical: 'owner-added\n' }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.conflict);
    assert.equal(await readFile(path.join(staged.canonical, 'notes/added.txt'), 'utf8'), 'owner-added\n');
    await rm(staged.root, { recursive: true, force: true });
  });
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/removed.txt'], changes: [{ path: 'notes/removed.txt', kind: 'delete' }] });
    const staged = await stage([{ path: 'notes/removed.txt', baseline: 'gone\n', candidate: null, canonical: 'changed\n' }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.conflict);
    assert.equal(await readFile(path.join(staged.canonical, 'notes/removed.txt'), 'utf8'), 'changed\n');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('a protected path is rejected by a fresh guard check and canonical bytes stay put', async () => {
  await withStore(async (store) => {
    const target = 'src/store/authStore.ts';
    seedRun(store, { paths: [target], changes: [{ path: target, kind: 'modify' }] });
    const staged = await stage([{ path: target, baseline: 'export const auth = 1;\n', candidate: 'export const auth = 2;\n' }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.guard);
    assert.equal(await readFile(path.join(staged.canonical, target), 'utf8'), 'export const auth = 1;\n');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('a second-file write failure and a verification mismatch roll back only candidate paths', async () => {
  await withStore(async (store) => {
    const files = [
      { path: 'notes/first.txt', baseline: 'one\n', candidate: 'ONE\n' },
      { path: 'notes/second.txt', baseline: 'two\n', candidate: 'TWO\n' },
    ];
    seedRun(store, { paths: files.map((file) => file.path), changes: [{ path: 'notes/first.txt', kind: 'modify' }, { path: 'notes/second.txt', kind: 'modify' }] });
    const staged = await stage(files, { path: 'notes/unrelated.txt', contents: 'stay\n' });
    const counter = countingIo(`${path.sep}second.txt`);
    const recorded = await apply(store, staged, { io: counter.io });
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.filesystem);
    assert.equal(recorded.failed?.result?.rollback, 'PASS');
    assert.equal(await readFile(path.join(staged.canonical, 'notes/first.txt'), 'utf8'), 'one\n');
    assert.equal(await readFile(path.join(staged.canonical, 'notes/second.txt'), 'utf8'), 'two\n');
    assert.equal(await readFile(path.join(staged.canonical, 'notes/unrelated.txt'), 'utf8'), 'stay\n');
    await rm(staged.root, { recursive: true, force: true });
  });
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/smoke.txt'], changes: [{ path: 'notes/smoke.txt', kind: 'modify' }] });
    const staged = await stage([{ path: 'notes/smoke.txt', baseline: 'base\n', candidate: 'next\n' }], { path: 'notes/unrelated.txt', contents: 'stay\n' });
    const recorded = await apply(store, staged, {
      afterWrite: async () => {
        // CT-GATE-FIX-3 goal 4: a real on-disk owner edit to the ALREADY-WRITTEN
        // file. Verify catches the mismatch against intendedBytes, but rollback can
        // no longer prove Apply's change is intact (the bytes differ from what Apply
        // wrote), so it leaves the owner's edit in place and reports PARTIAL — the
        // partial reason takes priority over the verify abort (goal 5).
        await writeFile(path.join(staged.canonical, 'notes/smoke.txt'), 'tampered\n');
      },
    });
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.partial);
    assert.equal(recorded.failed?.result?.rollback, 'PARTIAL');
    assert.deepEqual(recorded.failed?.result?.partialPaths, ['notes/smoke.txt']);
    assert.equal(await readFile(path.join(staged.canonical, 'notes/smoke.txt'), 'utf8'), 'tampered\n', "the owner's edit is preserved — rollback did not clobber it");
    assert.equal(await readFile(path.join(staged.canonical, 'notes/unrelated.txt'), 'utf8'), 'stay\n');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('rollback write itself fails after a conflict: the recorded reason is the rollback failure, not the conflict (CT-GATE-FIX-3 goal 5)', async () => {
  await withStore(async (store) => {
    // Two modifies, alphabetical: first.txt is written, then the owner edits
    // second.txt on disk so its per-write re-check conflicts. file 1 still holds
    // exactly what Apply wrote, so rollback attempts to restore it — and that
    // restore write is made to fail. Outcome priority: FAIL reason = rollback.
    const files = [
      { path: 'notes/first.txt', baseline: 'one\n', candidate: 'ONE\n' },
      { path: 'notes/second.txt', baseline: 'two\n', candidate: 'TWO\n' },
    ];
    seedRun(store, { paths: files.map((file) => file.path), changes: [{ path: 'notes/first.txt', kind: 'modify' }, { path: 'notes/second.txt', kind: 'modify' }] });
    const staged = await stage(files);
    const firstCanonical = path.join(staged.canonical, 'notes/first.txt');
    const secondCanonical = path.join(staged.canonical, 'notes/second.txt');
    const io: CandidateApplyIo = {
      readFile: (filePath) => readFile(filePath),
      mkdir: (filePath, options) => mkdir(filePath, options),
      rm: (filePath, options) => rm(filePath, options),
      lstat: (filePath) => lstat(filePath),
      writeFile: async (filePath, data) => {
        // The rollback restore writes the original baseline 'one\n' back to
        // first.txt; make ONLY that restore write fail (the apply write is 'ONE\n').
        if (filePath === firstCanonical && data.toString('utf8') === 'one\n') {
          throw new Error('rollback disk');
        }
        await writeFile(filePath, data);
        // After first.txt is written, the owner edits second.txt on disk so the
        // per-write re-check for second.txt sees drifted bytes and conflicts.
        if (filePath === firstCanonical) {
          await writeFile(secondCanonical, 'OWNER_TWO\n');
        }
      },
    };
    const recorded = await apply(store, staged, { io });
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.rollback, 'rollback FAIL reason takes priority over the conflict');
    assert.equal(recorded.failed?.result?.rollback, 'FAIL');
    assert.equal(recorded.completed, null);
    assert.equal(await readFile(firstCanonical, 'utf8'), 'ONE\n', 'the apply write landed and the failed rollback left it in place');
    assert.equal(await readFile(secondCanonical, 'utf8'), 'OWNER_TWO\n', "the owner's edit to second.txt is preserved; Host wrote nothing to it");
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('traversal, absolute paths, and symlink escapes are rejected before any write', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apply-safe-'));
  const canonical = path.join(root, 'canonical');
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside.txt');
  await mkdir(canonical, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(outside, 'secret\n');
  const escaped = await prepareCandidateWrites({
    canonicalRepoPath: canonical,
    workspacePath: workspace,
    baseline: new Map(),
    changes: [{ path: '../outside.txt', kind: 'add' }],
    io: { readFile, writeFile: async (filePath, data) => writeFile(filePath, data), mkdir, rm, lstat },
  });
  assert.equal(escaped.ok, false);
  if (!escaped.ok) assert.equal(escaped.reason, APPLY_OWNER_REASONS.unsafe);
  assert.equal(await readFile(outside, 'utf8'), 'secret\n');

  const absolute = await prepareCandidateWrites({
    canonicalRepoPath: canonical,
    workspacePath: workspace,
    baseline: new Map(),
    changes: [{ path: process.platform === 'win32' ? 'C:/Windows/Temp/ct-live-0c.txt' : '/tmp/ct-live-0c.txt', kind: 'add' }],
    io: { readFile, writeFile: async (filePath, data) => writeFile(filePath, data), mkdir, rm, lstat },
  });
  assert.equal(absolute.ok, false);
  if (!absolute.ok) assert.equal(absolute.reason, APPLY_OWNER_REASONS.unsafe);

  const linkPath = path.join(canonical, 'link.txt');
  await writeFile(linkPath, 'inside\n');
  const linked = await prepareCandidateWrites({
    canonicalRepoPath: canonical,
    workspacePath: workspace,
    baseline: new Map([['link.txt', { sha256: createHash('sha256').update('inside\n').digest('hex'), sizeBytes: Buffer.byteLength('inside\n') }]]),
    changes: [{ path: 'link.txt', kind: 'modify' }],
    io: {
      readFile,
      writeFile: async (filePath, data) => writeFile(filePath, data),
      mkdir,
      rm,
      lstat: async (filePath) => {
        if (filePath === linkPath) return { isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false };
        return lstat(filePath);
      },
    },
  });
  assert.equal(linked.ok, false);
  if (!linked.ok) assert.equal(linked.reason, APPLY_OWNER_REASONS.unsafe);
  assert.equal(await readFile(linkPath, 'utf8'), 'inside\n');
  assert.equal(await readFile(outside, 'utf8'), 'secret\n');

  try {
    const realLink = path.join(canonical, 'real-link.txt');
    await symlink(outside, realLink, 'file');
    const real = await prepareCandidateWrites({
      canonicalRepoPath: canonical,
      workspacePath: workspace,
      baseline: new Map(),
      changes: [{ path: 'real-link.txt', kind: 'modify' }],
      io: { readFile, writeFile: async (filePath, data) => writeFile(filePath, data), mkdir, rm, lstat },
    });
    assert.equal(real.ok, false);
    if (!real.ok) assert.equal(real.reason, APPLY_OWNER_REASONS.unsafe);
    assert.equal(await readFile(outside, 'utf8'), 'secret\n');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  }
  await rm(root, { recursive: true, force: true });
});

test('Apply Candidate cannot prepare writes beneath node_modules or .git, while a sibling file is allowed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apply-excluded-segments-'));
  const canonical = path.join(root, 'canonical');
  const workspace = path.join(root, 'workspace');
  await mkdir(canonical);
  await mkdir(path.join(workspace, 'src', 'feature'), { recursive: true });
  await writeFile(path.join(workspace, 'src', 'feature', 'normal.ts'), 'normal');
  const io: CandidateApplyIo = { readFile, writeFile: async (filePath, data) => writeFile(filePath, data), mkdir, rm, lstat };
  try {
    for (const relative of ['src/feature/node_modules/x.js', 'src/feature/NODE_MODULES/x.js', 'src/feature/.git/x', 'src/feature/.GiT/x']) {
      const result = await prepareCandidateWrites({ canonicalRepoPath: canonical, workspacePath: workspace, baseline: new Map(), changes: [{ path: relative, kind: 'add' }], io });
      assert.equal(result.ok, false, relative);
      if (!result.ok) assert.equal(result.reason, APPLY_OWNER_REASONS.unsafe);
    }
    const normal = await prepareCandidateWrites({ canonicalRepoPath: canonical, workspacePath: workspace, baseline: new Map(), changes: [{ path: 'src/feature/normal.ts', kind: 'add' }], io });
    assert.equal(normal.ok, true);
    if (normal.ok) assert.deepEqual(normal.planned.map((entry) => entry.relative), ['src/feature/normal.ts']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('duplicate, reload, and retry requests apply a candidate only once', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/smoke.txt'], changes: [{ path: 'notes/smoke.txt', kind: 'modify' }] });
    const staged = await stage([{ path: 'notes/smoke.txt', baseline: 'base\n', candidate: 'next\n' }]);
    const counter = countingIo();
    const first = await apply(store, staged, { io: counter.io, requestId: 'req-a' });
    assert.equal(first.completed?.outcome, 'applied');
    const writesAfterFirst = counter.writes().length;
    const second = await apply(store, staged, { io: counter.io, requestId: 'req-b' });
    assert.equal(second.completed?.outcome, 'already-applied');
    assert.equal(second.completed?.reason, APPLY_OWNER_REASONS.already);
    assert.equal(counter.writes().length, writesAfterFirst);
    assert.equal(await readFile(path.join(staged.canonical, 'notes/smoke.txt'), 'utf8'), 'next\n');
    const third = await apply(store, staged, { io: counter.io, requestId: 'req-c' });
    assert.equal(third.completed?.outcome, 'already-applied');
    assert.equal(counter.writes().length, writesAfterFirst);
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('malformed apply requests fail before any canonical read', async () => {
  await withStore(async (store) => {
    const recorded = plane();
    await handleApplyCandidate({
      store,
      controlPlane: recorded.control,
      request: { id: 'bad', repo_key: REPO_KEY, payload: { runId: RUN_ID, attemptId: ATTEMPT_ID, bytes: 'nope' } },
      canonicalRepoPath: os.tmpdir(),
      workspaceRoot: os.tmpdir(),
      repoKey: REPO_KEY,
      io: {
        readFile: async () => { throw new Error('should not read'); },
        writeFile: async () => { throw new Error('should not write'); },
        mkdir: async () => { throw new Error('should not mkdir'); },
        rm: async () => { throw new Error('should not remove'); },
        lstat: async () => { throw new Error('should not stat'); },
      },
    });
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.payload);
  });
});

test('apply modify preserves a uniform-LF canonical file when the candidate is CRLF (CT-GATE-FIX-1 goal 2)', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/lf.txt'], changes: [{ path: 'notes/lf.txt', kind: 'modify' }] });
    const staged = await stage([{ path: 'notes/lf.txt', baseline: 'owner\n', candidate: 'owner\r\nprovider\r\n' }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.completed?.outcome, 'applied');
    const written = await readFile(path.join(staged.canonical, 'notes/lf.txt'), 'utf8');
    assert.equal(written, 'owner\nprovider\n', 'content change applied in the canonical LF style');
    assert.equal(written.indexOf('\r'), -1, 'no CRLF leaked into a uniform-LF file');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('apply modify preserves a uniform-CRLF canonical file when the candidate is LF (CT-GATE-FIX-1 goal 2)', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/crlf.txt'], changes: [{ path: 'notes/crlf.txt', kind: 'modify' }] });
    const staged = await stage([{ path: 'notes/crlf.txt', baseline: 'owner\r\n', candidate: 'owner\nprovider\n' }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.completed?.outcome, 'applied');
    const written = await readFile(path.join(staged.canonical, 'notes/crlf.txt'), 'utf8');
    assert.equal(written, 'owner\r\nprovider\r\n', 'content change applied in the canonical CRLF style');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('apply modify writes mixed-ending and binary candidates exactly (CT-GATE-FIX-1 goal 2)', async () => {
  await withStore(async (store) => {
    seedRun(store, {
      paths: ['notes/mixed.txt', 'notes/bin.dat'],
      changes: [
        { path: 'notes/mixed.txt', kind: 'modify' },
        { path: 'notes/bin.dat', kind: 'modify' },
      ],
    });
    const staged = await stage([
      { path: 'notes/mixed.txt', baseline: 'a\r\nb\rc\n', candidate: 'a\r\nb\rc\nprovider\n' },
      { path: 'notes/bin.dat', baseline: 'before\x00data\n', candidate: 'before\x00data\nmore\n' },
    ]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.completed?.outcome, 'applied');
    assert.equal(await readFile(path.join(staged.canonical, 'notes/mixed.txt'), 'utf8'), 'a\r\nb\rc\nprovider\n', 'mixed-ending candidate written exactly');
    assert.equal(await readFile(path.join(staged.canonical, 'notes/bin.dat'), 'utf8'), 'before\x00data\nmore\n', 'binary candidate written exactly');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('apply modify still conflicts when the owner edited the canonical file, even a line-ending-only edit (CT-GATE-FIX-1 conflict detection unchanged)', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/lf.txt'], changes: [{ path: 'notes/lf.txt', kind: 'modify' }] });
    // baseline LF; the owner resaved canonical as CRLF (a real edit) after run start.
    const staged = await stage([{ path: 'notes/lf.txt', baseline: 'owner\n', candidate: 'owner\nprovider\n', canonical: 'owner\r\n' }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.conflict);
    assert.equal(recorded.failed?.result?.phase, 'Conflict detected');
    assert.deepEqual(recorded.failed?.result?.conflictPaths, ['notes/lf.txt']);
    assert.equal(await readFile(path.join(staged.canonical, 'notes/lf.txt'), 'utf8'), 'owner\r\n', 'nothing written');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('apply verify compares against the line-ending-converted intended bytes, not the raw candidate (CT-GATE-FIX-1 goal 2)', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/lf.txt'], changes: [{ path: 'notes/lf.txt', kind: 'modify' }] });
    const staged = await stage([{ path: 'notes/lf.txt', baseline: 'owner\n', candidate: 'owner\r\nprovider\r\n' }]);
    // canonical LF -> intended = 'owner\nprovider\n'. Tamper to the raw CRLF candidate
    // (exactly what would have been written without goal 2). Verify MUST reject it
    // (proving it compares against intendedBytes, not the raw candidate): if it had
    // compared against the raw candidate it would have matched and the apply would
    // have SUCCEEDED. Instead the apply fails. Under CT-GATE-FIX-3 goal 4 the
    // tampered bytes differ from what Apply wrote, so rollback cannot prove Apply's
    // change is intact, leaves the owner's edit in place, and reports PARTIAL
    // (goal 5: partial takes priority over the verify abort).
    const recorded = await apply(store, staged, {
      afterWrite: async () => {
        await writeFile(path.join(staged.canonical, 'notes/lf.txt'), 'owner\r\nprovider\r\n');
      },
    });
    assert.equal(recorded.completed, null, 'verify rejected the tampered bytes — it did not match the raw candidate');
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.partial, 'partial takes priority over the verify abort');
    assert.equal(recorded.failed?.result?.rollback, 'PARTIAL');
    assert.deepEqual(recorded.failed?.result?.partialPaths, ['notes/lf.txt']);
    assert.equal(await readFile(path.join(staged.canonical, 'notes/lf.txt'), 'utf8'), 'owner\r\nprovider\r\n', "the owner's tamper is preserved — rollback did not restore the baseline");
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('apply modify with a text canonical and a binary candidate writes the candidate exactly (CT-GATE-FIX-2 goal 2)', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/text-bin.txt'], changes: [{ path: 'notes/text-bin.txt', kind: 'modify' }] });
    // Canonical is text (LF); the candidate is binary (a NUL in the first 8 KiB).
    const staged = await stage([{ path: 'notes/text-bin.txt', baseline: 'owner\n', candidate: 'owner\n\x00binary-payload\n' }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.completed?.outcome, 'applied');
    assert.equal(
      await readFile(path.join(staged.canonical, 'notes/text-bin.txt'), 'utf8'),
      'owner\n\x00binary-payload\n',
      'binary candidate written exactly — no CRLF/LF folding when either side is binary',
    );
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('apply modify with a binary canonical and a text candidate writes the candidate exactly (CT-GATE-FIX-2 goal 2)', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/bin-text.dat'], changes: [{ path: 'notes/bin-text.dat', kind: 'modify' }] });
    // Canonical is binary (NUL); the candidate is text (LF). No folding either way.
    const staged = await stage([{ path: 'notes/bin-text.dat', baseline: 'owner\x00data\n', candidate: 'owner more data\n' }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.completed?.outcome, 'applied');
    assert.equal(
      await readFile(path.join(staged.canonical, 'notes/bin-text.dat'), 'utf8'),
      'owner more data\n',
      'text candidate written exactly against a binary canonical — no folding',
    );
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('an owner edit between preflight and the second write rolls back the first write and reports a conflict (CT-GATE-FIX-2 goal 3)', async () => {
  await withStore(async (store) => {
    const files = [
      { path: 'notes/first.txt', baseline: 'one\n', candidate: 'ONE\n' },
      { path: 'notes/second.txt', baseline: 'two\n', candidate: 'TWO\n' },
    ];
    seedRun(store, {
      paths: files.map((file) => file.path),
      changes: [{ path: 'notes/first.txt', kind: 'modify' }, { path: 'notes/second.txt', kind: 'modify' }],
    });
    const staged = await stage(files, { path: 'notes/unrelated.txt', contents: 'stay\n' });
    const firstCanonical = path.join(staged.canonical, 'notes/first.txt');
    const secondCanonical = path.join(staged.canonical, 'notes/second.txt');
    // CT-GATE-FIX-3 required test 7: the seam is a REAL on-disk edit, not a fake
    // readFile. When first.txt is written, the owner physically overwrites
    // second.txt on disk so its per-write re-check (which re-reads the canonical
    // file) sees drifted bytes and conflicts. Preflight still saw the unedited
    // baseline, so the conflict is caught only by the re-check.
    const io: CandidateApplyIo = {
      readFile: (filePath) => readFile(filePath),
      writeFile: async (filePath, data) => {
        await writeFile(filePath, data);
        if (filePath === firstCanonical) {
          await writeFile(secondCanonical, 'OWNER_EDITED\n');
        }
      },
      mkdir: (filePath, options) => mkdir(filePath, options),
      rm: (filePath, options) => rm(filePath, options),
      lstat: (filePath) => lstat(filePath),
    };
    const recorded = await apply(store, staged, { io });
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.conflict);
    assert.equal(recorded.failed?.result?.phase, 'Conflict detected');
    assert.deepEqual(recorded.failed?.result?.conflictPaths, ['notes/second.txt']);
    assert.equal(recorded.failed?.result?.rollback, 'PASS');
    assert.equal(await readFile(path.join(staged.canonical, 'notes/first.txt'), 'utf8'), 'one\n', 'first write rolled back to baseline (still intact == intended)');
    assert.equal(await readFile(secondCanonical, 'utf8'), 'OWNER_EDITED\n', "the owner's on-disk edit to second.txt is preserved; Host wrote nothing to it");
    assert.equal(await readFile(path.join(staged.canonical, 'notes/unrelated.txt'), 'utf8'), 'stay\n');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('an add target created by the owner after preflight conflicts and writes nothing (CT-GATE-FIX-2 goal 3)', async () => {
  await withStore(async (store) => {
    const files = [
      { path: 'notes/first.txt', baseline: 'one\n', candidate: 'ONE\n' },
      { path: 'notes/zzz.txt', baseline: null, candidate: 'created\n' },
    ];
    seedRun(store, {
      paths: files.map((file) => file.path),
      changes: [{ path: 'notes/first.txt', kind: 'modify' }, { path: 'notes/zzz.txt', kind: 'add' }],
    });
    const staged = await stage(files, { path: 'notes/unrelated.txt', contents: 'stay\n' });
    const firstCanonical = path.join(staged.canonical, 'notes/first.txt');
    const addCanonical = path.join(staged.canonical, 'notes/zzz.txt');
    // Planned order is alphabetical: first.txt (modify) is written before zzz.txt (add).
    // Seam: the owner creates the add target on disk AFTER first.txt is written (i.e.
    // between preflight and the add's per-write re-check). Preflight saw the add path
    // absent; the re-check sees it present and fails closed. No fake lstat/readFile
    // counting — the owner-created file is a real file on disk.
    let ownerCreatedAdd = false;
    const io: CandidateApplyIo = {
      readFile: (filePath) => readFile(filePath),
      writeFile: async (filePath, data) => {
        await writeFile(filePath, data);
        if (filePath === firstCanonical && !ownerCreatedAdd) {
          ownerCreatedAdd = true;
          await mkdir(path.dirname(addCanonical), { recursive: true });
          await writeFile(addCanonical, 'OWNER_CREATED\n');
        }
      },
      mkdir: (filePath, options) => mkdir(filePath, options),
      rm: (filePath, options) => rm(filePath, options),
      lstat: (filePath) => lstat(filePath),
    };
    const recorded = await apply(store, staged, { io });
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.conflict);
    assert.equal(recorded.failed?.result?.phase, 'Conflict detected');
    assert.deepEqual(recorded.failed?.result?.conflictPaths, ['notes/zzz.txt']);
    assert.equal(recorded.failed?.result?.rollback, 'PASS');
    assert.equal(await readFile(path.join(staged.canonical, 'notes/first.txt'), 'utf8'), 'one\n', 'first write rolled back to baseline');
    assert.equal(await readFile(addCanonical, 'utf8'), 'OWNER_CREATED\n', 'the add candidate was never written — only the owner-created file remains');
    assert.equal(await readFile(path.join(staged.canonical, 'notes/unrelated.txt'), 'utf8'), 'stay\n');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('a NUL byte after 8 KiB inside CRLF content is treated as binary and the candidate is written exactly (CT-GATE-FIX-3 goal 2)', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/big.txt'], changes: [{ path: 'notes/big.txt', kind: 'modify' }] });
    // Build CRLF content well past 8 KiB, then plant a single NUL byte at offset
    // 9000 — past the old 8 KiB scan window. The whole-buffer classifier (goal 2)
    // must classify this as binary; with a text (CRLF) canonical, no line-ending
    // folding happens and the candidate bytes are written verbatim.
    const lines: string[] = [];
    for (let i = 0; i < 120; i += 1) lines.push('x'.repeat(80));
    let candidateStr = lines.join('\r\n') + '\r\n'; // 9840 bytes, uniform CRLF
    const nulPos = 9000;
    candidateStr = candidateStr.slice(0, nulPos) + '\x00' + candidateStr.slice(nulPos);
    const expected = Buffer.from(candidateStr, 'utf8');
    const staged = await stage([{ path: 'notes/big.txt', baseline: 'owner\r\n', candidate: candidateStr }]);
    const recorded = await apply(store, staged);
    assert.equal(recorded.completed?.outcome, 'applied');
    const written = await readFile(path.join(staged.canonical, 'notes/big.txt'));
    assert.equal(written.equals(expected), true, 'binary candidate (NUL past 8 KiB) written exactly — no CRLF/LF folding');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('a parent directory replaced by a junction after preflight is caught by the per-write path re-check and writes nothing outside the repo (CT-GATE-FIX-3 goal 3)', async () => {
  await withStore(async (store) => {
    // first.txt is top-level; deep.txt is under nested/. Alphabetical order writes
    // first.txt before nested/deep.txt, giving the seam a real write event to swap
    // nested/ for a junction between first.txt's write and deep.txt's per-write
    // resolveSafePath re-check.
    const files = [
      { path: 'first.txt', baseline: 'one\n', candidate: 'ONE\n' },
      { path: 'nested/deep.txt', baseline: 'two\n', candidate: 'TWO\n' },
    ];
    seedRun(store, { paths: files.map((file) => file.path), changes: [{ path: 'first.txt', kind: 'modify' }, { path: 'nested/deep.txt', kind: 'modify' }] });
    const staged = await stage(files);
    const firstCanonical = path.join(staged.canonical, 'first.txt');
    const nestedCanonical = path.join(staged.canonical, 'nested');
    const outside = await mkdtemp(path.join(os.tmpdir(), 'apply-junction-outside-'));
    try {
      const io: CandidateApplyIo = {
        readFile: (filePath) => readFile(filePath),
        mkdir: (filePath, options) => mkdir(filePath, options),
        rm: (filePath, options) => rm(filePath, options),
        lstat: (filePath) => lstat(filePath),
        writeFile: async (filePath, data) => {
          await writeFile(filePath, data);
          if (filePath === firstCanonical) {
            // Owner swaps the real nested/ directory for a junction to an outside
            // dir AFTER first.txt is written, before deep.txt's per-write re-check.
            await rm(nestedCanonical, { recursive: true, force: true });
            await symlink(outside, nestedCanonical, 'junction');
          }
        },
      };
      const recorded = await apply(store, staged, { io });
      assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.unsafe, 'the per-write resolveSafePath re-check fails closed on the junction ancestor');
      assert.equal(recorded.failed?.result?.rollback, 'PASS');
      assert.deepEqual(recorded.failed?.result?.conflictPaths, ['nested/deep.txt']);
      assert.equal(await readFile(firstCanonical, 'utf8'), 'one\n', 'first write rolled back to baseline (still intact == intended)');
      // Nothing was written outside the repo: the outside junction target has no deep.txt.
      await assert.rejects(readFile(path.join(outside, 'deep.txt')), /ENOENT/u, 'no bytes escaped the repo through the junction');
    } finally {
      await rm(nestedCanonical, { force: true }).catch(() => undefined);
      await rm(staged.root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('an owner edit to an already-written file followed by a later conflict preserves the owner edit and reports rollback PARTIAL (CT-GATE-FIX-3 goal 4)', async () => {
  await withStore(async (store) => {
    // first.txt is written, then the owner edits it on disk. second.txt is also
    // edited on disk so its per-write re-check conflicts. Rollback of first.txt
    // cannot prove Apply's change is intact (the owner overwrote it), so it leaves
    // the owner's bytes in place and reports PARTIAL with that path — the partial
    // reason taking priority over the conflict (goal 5).
    const files = [
      { path: 'notes/first.txt', baseline: 'one\n', candidate: 'ONE\n' },
      { path: 'notes/second.txt', baseline: 'two\n', candidate: 'TWO\n' },
    ];
    seedRun(store, { paths: files.map((file) => file.path), changes: [{ path: 'notes/first.txt', kind: 'modify' }, { path: 'notes/second.txt', kind: 'modify' }] });
    const staged = await stage(files);
    const firstCanonical = path.join(staged.canonical, 'notes/first.txt');
    const secondCanonical = path.join(staged.canonical, 'notes/second.txt');
    const io: CandidateApplyIo = {
      readFile: (filePath) => readFile(filePath),
      mkdir: (filePath, options) => mkdir(filePath, options),
      rm: (filePath, options) => rm(filePath, options),
      lstat: (filePath) => lstat(filePath),
      writeFile: async (filePath, data) => {
        await writeFile(filePath, data);
        if (filePath === firstCanonical) {
          // Owner edits the ALREADY-WRITTEN first.txt, and drifts second.txt so the
          // later per-write re-check conflicts.
          await writeFile(firstCanonical, 'OWNER_EDITED\n');
          await writeFile(secondCanonical, 'OWNER_TWO\n');
        }
      },
    };
    const recorded = await apply(store, staged, { io });
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.partial, 'partial takes priority over the conflict');
    assert.equal(recorded.failed?.result?.rollback, 'PARTIAL');
    assert.deepEqual(recorded.failed?.result?.partialPaths, ['notes/first.txt']);
    assert.deepEqual(recorded.failed?.result?.conflictPaths, ['notes/second.txt']);
    assert.equal(await readFile(firstCanonical, 'utf8'), 'OWNER_EDITED\n', "the owner's edit to the already-written file is preserved — rollback did not clobber it");
    assert.equal(await readFile(secondCanonical, 'utf8'), 'OWNER_TWO\n', "the owner's drifted second.txt is preserved; Host wrote nothing to it");
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('rollback does not write or delete through a parent junction swapped after the first write (CT-GATE-FIX-4 goal 1)', async () => {
  await withStore(async (store) => {
    // nested/first.txt is written first (alphabetical), then top.txt. The seam:
    // when first.txt is written, the owner replaces nested/ with a junction to an
    // outside dir AND drifts top.txt so the later per-write re-check conflicts. The
    // conflict triggers rollback of first.txt, whose parent is now a junction. The
    // per-rollback resolveSafePath re-check must fail closed → PARTIAL with that path,
    // and rollback must NOT write or delete anything through the junction.
    const files = [
      { path: 'nested/first.txt', baseline: 'one\n', candidate: 'ONE\n' },
      { path: 'top.txt', baseline: 'base\n', candidate: 'NEXT\n' },
    ];
    seedRun(store, { paths: files.map((file) => file.path), changes: [{ path: 'nested/first.txt', kind: 'modify' }, { path: 'top.txt', kind: 'modify' }] });
    const staged = await stage(files);
    const firstCanonical = path.join(staged.canonical, 'nested', 'first.txt');
    const nestedCanonical = path.join(staged.canonical, 'nested');
    const topCanonical = path.join(staged.canonical, 'top.txt');
    const outside = await mkdtemp(path.join(os.tmpdir(), 'apply-rollback-junction-'));
    try {
      const io: CandidateApplyIo = {
        readFile: (filePath) => readFile(filePath),
        mkdir: (filePath, options) => mkdir(filePath, options),
        rm: (filePath, options) => rm(filePath, options),
        lstat: (filePath) => lstat(filePath),
        writeFile: async (filePath, data) => {
          await writeFile(filePath, data);
          if (filePath === firstCanonical) {
            // Owner swaps nested/ for a junction to the outside dir, and drifts top.txt
            // so the next per-write re-check conflicts and forces rollback of first.txt.
            await rm(nestedCanonical, { recursive: true, force: true });
            await symlink(outside, nestedCanonical, 'junction');
            await writeFile(topCanonical, 'OWNER_TOP\n');
          }
        },
      };
      const recorded = await apply(store, staged, { io });
      assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.partial, 'partial takes priority over the conflict');
      assert.equal(recorded.failed?.result?.rollback, 'PARTIAL');
      assert.deepEqual(recorded.failed?.result?.partialPaths, ['nested/first.txt']);
      assert.deepEqual(recorded.failed?.result?.conflictPaths, ['top.txt']);
      // Nothing was written or deleted through the junction: the outside dir has no first.txt.
      await assert.rejects(readFile(path.join(outside, 'first.txt')), /ENOENT/u, 'rollback did not restore through the junction into the outside dir');
      // top.txt was never written by Host — the owner's drift is all that is there.
      assert.equal(await readFile(topCanonical, 'utf8'), 'OWNER_TOP\n');
    } finally {
      await rm(nestedCanonical, { force: true }).catch(() => undefined);
      await rm(staged.root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('a schema-1 baseline without normalized fields falls back to a raw byte compare in the delta (CT-GATE-FIX-2)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apply-schema1-'));
  const baselineDir = path.join(root, 'baseline');
  const workspaceRoot = path.join(root, 'workspaces');
  const workspacePath = path.join(workspaceRoot, REPO_KEY, RUN_ID, ATTEMPT_ID);
  await mkdir(baselineDir, { recursive: true });
  await mkdir(workspacePath, { recursive: true });
  const identity = { repoKey: REPO_KEY, runId: RUN_ID, attemptId: ATTEMPT_ID };
  // Write a schema-1 sidecar by hand: only path/sha256/sizeBytes, NO normalized fields.
  const content = 'COMMITTED\n';
  await writeFile(
    capturedBaselineSidecarPath({ workspaceRoot, identity }),
    JSON.stringify({
      schemaVersion: 1,
      baselineHeadSha: HEAD,
      files: [{ path: 'README.md', sha256: createHash('sha256').update(content).digest('hex'), sizeBytes: Buffer.byteLength(content) }],
    }),
  );
  await writeRel(workspacePath, 'README.md', 'COMMITTED\r\n');
  const baseline = await readCapturedBaseline({ workspaceRoot, identity });
  assert.ok(baseline);
  const delta = describeWorkspaceDelta(HEAD, { files: baseline!.files }, await captureWorkspaceTree(workspacePath));
  assert.equal(delta.length, 1, 'an LE-only difference IS a change under the schema-1 raw fallback');
  assert.equal(delta[0]?.kind, 'modify');
  assert.equal(delta[0]?.path, 'README.md');
  await rm(root, { recursive: true, force: true });
});

test('delta: binary and mixed-ending files compare exactly, so an LE-only change on a mixed file is a change (CT-GATE-FIX-2)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apply-delta-exact-'));
  const baselineDir = path.join(root, 'baseline');
  const candidateDir = path.join(root, 'candidate');
  await mkdir(baselineDir, { recursive: true });
  await mkdir(candidateDir, { recursive: true });
  // Binary: a single byte difference (an "LE-only" byte change) is a real change.
  await writeRel(baselineDir, 'bin.dat', 'before\x00data\n');
  await writeRel(candidateDir, 'bin.dat', 'before\x00data\r\n');
  // Mixed: an LE-only change (a CRLF pair becomes a lone LF) is a change because mixed compares raw.
  await writeRel(baselineDir, 'mixed.txt', 'a\r\nb\rc\n');
  await writeRel(candidateDir, 'mixed.txt', 'a\nb\rc\n');
  const baseline = await captureWorkspaceTree(baselineDir);
  const candidate = await captureWorkspaceTree(candidateDir);
  const delta = describeWorkspaceDelta(HEAD, baseline, candidate);
  assert.equal(delta.length, 2);
  assert.deepEqual(delta.map((entry) => entry.path).sort(), ['bin.dat', 'mixed.txt']);
  assert.ok(delta.every((entry) => entry.kind === 'modify'));
  await rm(root, { recursive: true, force: true });
});

test('delta: a late-NUL binary file (NUL past 8 KiB) changed only in line endings IS a change (binary compares exactly) (CT-GATE-FIX-4 goal 3)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apply-delta-latenul-'));
  const baselineDir = path.join(root, 'baseline');
  const candidateDir = path.join(root, 'candidate');
  await mkdir(baselineDir, { recursive: true });
  await mkdir(candidateDir, { recursive: true });
  // Build content well past 8 KiB whose ONLY difference is line endings (CRLF vs LF).
  // The single NUL byte sits at offset 9000 — past the old 8 KiB scan window — so the
  // file is binary under the full-buffer classifier (CT-GATE-FIX-3 goal 2). Binary
  // compares raw bytes, so the LE-only difference IS a change (not normalized away).
  const lines: string[] = [];
  for (let i = 0; i < 120; i += 1) lines.push('x'.repeat(80));
  const crlf = lines.join('\r\n') + '\r\n'; // 9840 bytes
  const lf = lines.join('\n') + '\n'; // 9722 bytes
  const nulPos = 9000; // > 8192 in both strings
  const crlfBin = crlf.slice(0, nulPos) + '\x00' + crlf.slice(nulPos);
  const lfBin = lf.slice(0, nulPos) + '\x00' + lf.slice(nulPos);
  await writeRel(baselineDir, 'latebin.dat', crlfBin);
  await writeRel(candidateDir, 'latebin.dat', lfBin);
  const baseline = await captureWorkspaceTree(baselineDir);
  const candidate = await captureWorkspaceTree(candidateDir);
  const delta = describeWorkspaceDelta(HEAD, baseline, candidate);
  assert.equal(delta.length, 1, 'an LE-only change on a late-NUL binary file IS a change');
  assert.equal(delta[0]?.kind, 'modify');
  assert.equal(delta[0]?.path, 'latebin.dat');
  await rm(root, { recursive: true, force: true });
});
