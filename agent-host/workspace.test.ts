import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  adjudicateAttemptWorkspace,
  captureWorkspaceTree,
  materializeAttemptWorkspace,
  materializeVerifierWorkspace,
  resolveImplementerCandidateWorkspace,
  resolveAttemptWorkspacePath,
  resolveWorkspaceTarExecutable,
  WorkspacePreparationError,
} from './workspace.ts';
import type { OrchestrationEventRecord, TaskRecord } from './lib/orchestrationTypes.ts';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd, windowsHide: true })).stdout;
}

async function createRepo(): Promise<{ repoPath: string; runtimePath: string; baselineHeadSha: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orch4c3-'));
  const repoPath = path.join(root, 'repo');
  await mkdir(repoPath);
  await git(repoPath, ['init']);
  await git(repoPath, ['config', 'user.email', 'fixture@example.invalid']);
  await git(repoPath, ['config', 'user.name', 'Fixture']);
  await mkdir(path.join(repoPath, 'src'), { recursive: true });
  await writeFile(path.join(repoPath, 'README.md'), 'COMMITTED\n');
  await writeFile(path.join(repoPath, 'src', 'store.ts'), 'export const baseline = true;\n');
  await git(repoPath, ['add', '.']);
  await git(repoPath, ['commit', '-m', 'baseline']);
  return {
    repoPath,
    runtimePath: path.join(root, 'runtime', 'workspaces'),
    baselineHeadSha: (await git(repoPath, ['rev-parse', 'HEAD'])).trim(),
  };
}

function task(authorizedWritePaths: string[]): TaskRecord {
  return {
    taskId: 'task-1', runId: 'run-1', title: 'fixture', goal: null, status: 'running', position: 0,
    spec: { policy: { authorizedWritePaths } }, createdAt: '', updatedAt: '', startedAt: '', completedAt: null,
  };
}

test('workspace: eligible working tree is the pre-provider baseline and secrets stay out', async () => {
  const fixture = await createRepo();
  await writeFile(path.join(fixture.repoPath, 'README.md'), 'OWNER_DIRTY\n');
  await writeFile(path.join(fixture.repoPath, '.gitignore'), 'secret-notes.ts\n');
  await writeFile(path.join(fixture.repoPath, 'secret-notes.ts'), 'export const hidden = true;\n');
  await mkdir(path.join(fixture.repoPath, 'src', 'features'), { recursive: true });
  await writeFile(path.join(fixture.repoPath, 'src', 'features', 'capacity.ts'), 'export const capacity = true;\n');
  await mkdir(path.join(fixture.repoPath, 'supabase', 'migrations'), { recursive: true });
  await writeFile(path.join(fixture.repoPath, 'supabase', 'migrations', '137_create_plan_payload_envelope.sql'), 'select 1;\n');
  await mkdir(path.join(fixture.repoPath, 'supabase', '.temp'), { recursive: true });
  await writeFile(path.join(fixture.repoPath, 'supabase', '.temp', 'cli-latest'), 'temp\n');
  await mkdir(path.join(fixture.repoPath, 'dist'), { recursive: true });
  await writeFile(path.join(fixture.repoPath, 'dist', 'generated.js'), 'generated\n');
  await writeFile(path.join(fixture.repoPath, 'ct-shot-root.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(path.join(fixture.repoPath, '.env'), 'DO_NOT_MATERIALIZE\n');
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
    baselineHeadSha: fixture.baselineHeadSha,
  });
  assert.notEqual(path.resolve(workspace.workspacePath), path.resolve(fixture.repoPath));
  assert.equal((await readFile(path.join(workspace.workspacePath, 'README.md'), 'utf8')).replaceAll('\r\n', '\n'), 'OWNER_DIRTY\n');
  assert.equal((await readFile(path.join(workspace.workspacePath, 'src', 'features', 'capacity.ts'), 'utf8')).replaceAll('\r\n', '\n'), 'export const capacity = true;\n');
  assert.equal((await readFile(path.join(workspace.workspacePath, 'supabase', 'migrations', '137_create_plan_payload_envelope.sql'), 'utf8')).replaceAll('\r\n', '\n'), 'select 1;\n');
  await assert.rejects(readFile(path.join(workspace.workspacePath, '.env')), /ENOENT/u);
  await assert.rejects(readFile(path.join(workspace.workspacePath, '.git')), /ENOENT/u);
  await assert.rejects(readFile(path.join(workspace.workspacePath, 'secret-notes.ts')), /ENOENT/u);
  await assert.rejects(readFile(path.join(workspace.workspacePath, 'supabase', '.temp', 'cli-latest')), /ENOENT/u);
  await assert.rejects(readFile(path.join(workspace.workspacePath, 'dist', 'generated.js')), /ENOENT/u);
  await assert.rejects(readFile(path.join(workspace.workspacePath, 'ct-shot-root.png')), /ENOENT/u);
  assert.equal(workspace.baselineHeadSha, fixture.baselineHeadSha);
  assert.equal((await readFile(path.join(fixture.repoPath, 'README.md'), 'utf8')).replaceAll('\r\n', '\n'), 'OWNER_DIRTY\n');
});

test('workspace: policy accepts only authorized isolated changes and produces a safe changeset', async () => {
  const fixture = await createRepo();
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
  });
  await mkdir(path.join(workspace.workspacePath, 'agent-host', 'smoke'), { recursive: true });
  await writeFile(path.join(workspace.workspacePath, 'agent-host', 'smoke', 'orch4c-smoke.txt'), 'AGENT_HOST_WRITE_SMOKE_OK v1\n');
  const result = await adjudicateAttemptWorkspace({
    workspace, runId: 'run-1', task: task(['agent-host/smoke/orch4c-smoke.txt']), attemptId: 'attempt-1', permissionProfile: 'task-implementer',
  });
  assert.equal(result.policy.accepted, true);
  assert.deepEqual(result.changeSet?.changes.map((change) => ({ kind: change.kind, path: change.path })), [
    { kind: 'add', path: 'agent-host/smoke/orch4c-smoke.txt' },
  ]);
  assert.equal((await readFile(path.join(fixture.repoPath, 'README.md'), 'utf8')).replaceAll('\r\n', '\n'), 'COMMITTED\n');
});

test('workspace: provider-created node_modules and .git are absent from count and candidate changes', async () => {
  const fixture = await createRepo();
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
  });
  const prefix = path.join(workspace.workspacePath, 'src', 'feature');
  await mkdir(path.join(prefix, 'node_modules'), { recursive: true });
  await mkdir(path.join(prefix, '.git'), { recursive: true });
  await writeFile(path.join(prefix, 'node_modules', 'x.js'), 'generated');
  await writeFile(path.join(prefix, '.git', 'x'), 'generated');
  await writeFile(path.join(prefix, 'normal.ts'), 'export const normal = true;\n');
  const result = await adjudicateAttemptWorkspace({
    workspace, runId: 'run-1', task: task(['src/feature/**']), attemptId: 'attempt-1', permissionProfile: 'task-implementer',
  });
  assert.equal(result.policy.accepted, true);
  assert.equal(result.changedFileCount, 1);
  assert.deepEqual(result.changeSet?.changes.map((change) => change.path), ['src/feature/normal.ts']);
  assert.deepEqual([...((await captureWorkspaceTree(workspace.workspacePath)).files.keys())].filter((name) => name.startsWith('src/feature/')), ['src/feature/normal.ts']);
});

test('workspace: excluded directories are omitted from the baseline capture too', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspace-baseline-exclusions-'));
  await mkdir(path.join(root, 'src', 'NODE_MODULES'), { recursive: true });
  await mkdir(path.join(root, 'src', '.GiT'), { recursive: true });
  await writeFile(path.join(root, 'src', 'NODE_MODULES', 'x.js'), 'baseline');
  await writeFile(path.join(root, 'src', '.GiT', 'x'), 'baseline');
  await writeFile(path.join(root, 'src', 'normal.ts'), 'baseline');
  try {
    assert.deepEqual([...((await captureWorkspaceTree(root)).files.keys())], ['src/normal.ts']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace: out-of-scope, protected, and secret writes are rejected without a changeset', async () => {
  const fixture = await createRepo();
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
  });
  await mkdir(path.join(workspace.workspacePath, 'agent-host', 'smoke'), { recursive: true });
  await writeFile(path.join(workspace.workspacePath, 'agent-host', 'smoke', 'orch4c-smoke.txt'), 'AGENT_HOST_WRITE_SMOKE_OK v1\n');
  await writeFile(path.join(workspace.workspacePath, 'README.md'), 'unauthorized\n');
  await writeFile(path.join(workspace.workspacePath, '.env'), 'secret\n');
  const result = await adjudicateAttemptWorkspace({
    workspace, runId: 'run-1', task: task(['agent-host/**', 'src/**']), attemptId: 'attempt-1', permissionProfile: 'task-implementer',
  });
  assert.equal(result.policy.accepted, false);
  assert.equal(result.policy.reasonCodes.includes('out-of-scope-write'), true);
  assert.equal(result.policy.reasonCodes.includes('secret-access'), true);
  assert.equal(result.changeSet, null);
  assert.equal((await readFile(path.join(fixture.repoPath, 'README.md'), 'utf8')).replaceAll('\r\n', '\n'), 'COMMITTED\n');
});

test('workspace: Windows extractor ignores ambient PATH and resolves the system tar absolutely', () => {
  const environment = {
    PATH: 'C:\\malicious-bin',
    SystemRoot: 'D:\\Windows',
    WINDIR: 'E:\\IgnoredWindows',
  };
  assert.equal(resolveWorkspaceTarExecutable('win32', environment), path.join('D:\\Windows', 'System32', 'tar.exe'));
  assert.equal(
    resolveWorkspaceTarExecutable('win32', { PATH: environment.PATH, WINDIR: environment.WINDIR }),
    path.join('E:\\IgnoredWindows', 'System32', 'tar.exe'),
  );
  assert.equal(resolveWorkspaceTarExecutable('win32', { PATH: environment.PATH }), path.join('C:\\Windows', 'System32', 'tar.exe'));
  assert.equal(path.isAbsolute(resolveWorkspaceTarExecutable('win32', environment)), true);
});

test('workspace: paths are deterministic and reject traversal/cross-attempt aliases', () => {
  const root = path.join(os.tmpdir(), 'orch4c3-runtime');
  const first = resolveAttemptWorkspacePath({ workspaceRoot: root, identity: { repoKey: 'repo', runId: 'run', attemptId: 'attempt-a' } });
  const second = resolveAttemptWorkspacePath({ workspaceRoot: root, identity: { repoKey: 'repo', runId: 'run', attemptId: 'attempt-b' } });
  assert.notEqual(first, second);
  assert.throws(() => resolveAttemptWorkspacePath({ workspaceRoot: root, identity: { repoKey: 'repo', runId: 'run', attemptId: '..' } }), WorkspacePreparationError);
  assert.throws(() => resolveAttemptWorkspacePath({ workspaceRoot: root, identity: { repoKey: 'repo', runId: 'run', attemptId: 'C:\\escape' } }), WorkspacePreparationError);
});

test('workspace: tracked sensitive baseline files fail closed', async () => {
  const fixture = await createRepo();
  await writeFile(path.join(fixture.repoPath, '.env.production'), 'tracked secret\n');
  await git(fixture.repoPath, ['add', '.env.production']);
  await git(fixture.repoPath, ['commit', '-m', 'bad fixture']);
  await assert.rejects(
    materializeAttemptWorkspace({
      canonicalRepoPath: fixture.repoPath,
      workspaceRoot: fixture.runtimePath,
      identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
    }),
    WorkspacePreparationError,
  );
});

test('workspace: inherited unchanged files are not candidate edits', async () => {
  const fixture = await createRepo();
  await writeFile(path.join(fixture.repoPath, 'README.md'), 'OWNER_DIRTY\n');
  await writeFile(path.join(fixture.repoPath, 'src', 'capacity.ts'), 'export const capacity = true;\n');
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
    baselineHeadSha: fixture.baselineHeadSha,
  });
  const result = await adjudicateAttemptWorkspace({
    workspace, runId: 'run-1', task: task(['README.md', 'src/**']), attemptId: 'attempt-1', permissionProfile: 'task-implementer',
  });
  assert.equal(result.policy.accepted, true);
  assert.deepEqual(result.changeSet?.changes, []);
});

test('workspace: a further edit to an inherited dirty file is a candidate modify', async () => {
  const fixture = await createRepo();
  await writeFile(path.join(fixture.repoPath, 'README.md'), 'OWNER_DIRTY\n');
  await writeFile(path.join(fixture.repoPath, 'src', 'capacity.ts'), 'export const capacity = true;\n');
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
    baselineHeadSha: fixture.baselineHeadSha,
  });
  await writeFile(path.join(workspace.workspacePath, 'README.md'), 'OWNER_DIRTY\nPROVIDER\n');
  const result = await adjudicateAttemptWorkspace({
    workspace, runId: 'run-1', task: task(['README.md', 'src/**']), attemptId: 'attempt-1', permissionProfile: 'task-implementer',
  });
  assert.equal(result.policy.accepted, true);
  assert.deepEqual(result.changeSet?.changes.map((change) => ({ kind: change.kind, path: change.path })), [
    { kind: 'modify', path: 'README.md' },
  ]);
  assert.equal((await readFile(path.join(fixture.repoPath, 'README.md'), 'utf8')).replaceAll('\r\n', '\n'), 'OWNER_DIRTY\n');
});

test('workspace: provider add and delete are candidate edits and inherited files are not', async () => {
  const fixture = await createRepo();
  await writeFile(path.join(fixture.repoPath, 'README.md'), 'OWNER_DIRTY\n');
  await writeFile(path.join(fixture.repoPath, 'src', 'capacity.ts'), 'export const capacity = true;\n');
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
    baselineHeadSha: fixture.baselineHeadSha,
  });
  await rm(path.join(workspace.workspacePath, 'src', 'store.ts'));
  await mkdir(path.join(workspace.workspacePath, 'agent-host', 'smoke'), { recursive: true });
  await writeFile(path.join(workspace.workspacePath, 'agent-host', 'smoke', 'marker.txt'), 'PROVIDER\n');
  const result = await adjudicateAttemptWorkspace({
    workspace, runId: 'run-1', task: task(['src/store.ts', 'agent-host/smoke/marker.txt']), attemptId: 'attempt-1', permissionProfile: 'task-implementer',
  });
  assert.equal(result.policy.accepted, true);
  assert.deepEqual(result.changeSet?.changes.map((change) => ({ kind: change.kind, path: change.path })), [
    { kind: 'add', path: 'agent-host/smoke/marker.txt' },
    { kind: 'delete', path: 'src/store.ts' },
  ]);
});

test('workspace: verifier copy is the inherited baseline plus provider delta, not a later canonical read', async () => {
  const fixture = await createRepo();
  await writeFile(path.join(fixture.repoPath, 'README.md'), 'OWNER_DIRTY\n');
  await writeFile(path.join(fixture.repoPath, 'src', 'capacity.ts'), 'export const capacity = true;\n');
  const implementer = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
    baselineHeadSha: fixture.baselineHeadSha,
  });
  await mkdir(path.join(implementer.workspacePath, 'agent-host', 'smoke'), { recursive: true });
  await writeFile(path.join(implementer.workspacePath, 'agent-host', 'smoke', 'marker.txt'), 'PROVIDER\n');
  await writeFile(path.join(fixture.repoPath, 'README.md'), 'LATER_CANONICAL\n');
  const verifier = await materializeVerifierWorkspace({
    sourceWorkspacePath: implementer.workspacePath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-2' },
    baselineHeadSha: implementer.baselineHeadSha,
  });
  assert.equal(verifier.readOnly, true);
  assert.equal(verifier.materializationMode, 'candidate-copy');
  assert.equal((await readFile(path.join(verifier.workspacePath, 'README.md'), 'utf8')).replaceAll('\r\n', '\n'), 'OWNER_DIRTY\n');
  assert.equal((await readFile(path.join(verifier.workspacePath, 'src', 'capacity.ts'), 'utf8')).replaceAll('\r\n', '\n'), 'export const capacity = true;\n');
  assert.equal((await readFile(path.join(verifier.workspacePath, 'agent-host', 'smoke', 'marker.txt'), 'utf8')).replaceAll('\r\n', '\n'), 'PROVIDER\n');
  await writeFile(path.join(fixture.repoPath, 'README.md'), 'EVEN_LATER\n');
  assert.equal((await readFile(path.join(verifier.workspacePath, 'README.md'), 'utf8')).replaceAll('\r\n', '\n'), 'OWNER_DIRTY\n');
  assert.equal((await readFile(path.join(fixture.repoPath, 'README.md'), 'utf8')).replaceAll('\r\n', '\n'), 'EVEN_LATER\n');
});

test('workspace: verifier resolver rejects a policy-accepted failed Implementer attempt', () => {
  const events: Array<Pick<OrchestrationEventRecord, 'seq' | 'taskId' | 'attemptId' | 'type' | 'payload'>> = [
    { seq: 1, taskId: 'implementer', attemptId: 'failed-attempt', type: 'workspace.prepared', payload: { baselineHeadSha: 'a'.repeat(40) } },
    { seq: 2, taskId: 'implementer', attemptId: 'failed-attempt', type: 'workspace.adjudication.completed', payload: { policyAccepted: true } },
  ];
  const options = {
    workspaceRoot: path.join(os.tmpdir(), 'resolver-fixture'), repoKey: 'repo-key', runId: 'run-1',
    dependencyTaskIds: ['implementer'], events,
  };
  assert.equal(resolveImplementerCandidateWorkspace({ ...options, isPassedAttempt: () => false }), null);
  assert.equal(resolveImplementerCandidateWorkspace({ ...options, isPassedAttempt: (id, taskId) => id === 'failed-attempt' && taskId === 'implementer' })?.sourceAttemptId, 'failed-attempt');
});

test('workspace: tracked env template baseline materializes without weakening secret fail-closed behavior', async () => {
  const fixture = await createRepo();
  await writeFile(path.join(fixture.repoPath, '.env.local.example'), 'PLACEHOLDER=value\n');
  await git(fixture.repoPath, ['add', '.env.local.example']);
  await git(fixture.repoPath, ['commit', '-m', 'template fixture']);

  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
  });

  assert.equal(
    (await readFile(path.join(workspace.workspacePath, '.env.local.example'), 'utf8')).replaceAll('\r\n', '\n'),
    'PLACEHOLDER=value\n',
  );
});
