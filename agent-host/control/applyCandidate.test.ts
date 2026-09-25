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
  describeWorkspaceDelta,
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
        await writeFile(path.join(staged.canonical, 'notes/smoke.txt'), 'tampered\n');
      },
    });
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.verify);
    assert.equal(recorded.failed?.result?.rollback, 'PASS');
    assert.equal(await readFile(path.join(staged.canonical, 'notes/smoke.txt'), 'utf8'), 'base\n');
    assert.equal(await readFile(path.join(staged.canonical, 'notes/unrelated.txt'), 'utf8'), 'stay\n');
    await rm(staged.root, { recursive: true, force: true });
  });
});

test('rollback failure is reported and does not claim success', async () => {
  await withStore(async (store) => {
    seedRun(store, { paths: ['notes/smoke.txt'], changes: [{ path: 'notes/smoke.txt', kind: 'modify' }] });
    const staged = await stage([{ path: 'notes/smoke.txt', baseline: 'base\n', candidate: 'next\n' }]);
    let verifying = false;
    const io: CandidateApplyIo = {
      readFile: (filePath) => readFile(filePath),
      mkdir: (filePath, options) => mkdir(filePath, options),
      rm: (filePath, options) => rm(filePath, options),
      lstat: (filePath) => lstat(filePath),
      writeFile: async (filePath, data) => {
        if (verifying) throw new Error('rollback disk');
        await writeFile(filePath, data);
      },
    };
    const recorded = await apply(store, staged, {
      io,
      afterWrite: async () => {
        verifying = true;
        await writeFile(path.join(staged.canonical, 'notes/smoke.txt'), 'tampered\n');
      },
    });
    assert.equal(recorded.failed?.error, APPLY_OWNER_REASONS.rollback);
    assert.equal(recorded.failed?.result?.rollback, 'FAIL');
    assert.equal(recorded.completed, null);
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
