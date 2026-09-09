import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  adjudicateAttemptWorkspace,
  materializeAttemptWorkspace,
  resolveAttemptWorkspacePath,
  resolveWorkspaceTarExecutable,
  WorkspacePreparationError,
} from './workspace.ts';
import type { TaskRecord } from './lib/orchestrationTypes.ts';

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

test('workspace: committed baseline excludes owner dirty work and Git metadata', async () => {
  const fixture = await createRepo();
  await writeFile(path.join(fixture.repoPath, 'README.md'), 'OWNER_DIRTY\n');
  await writeFile(path.join(fixture.repoPath, '.env'), 'DO_NOT_MATERIALIZE\n');
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
    baselineHeadSha: fixture.baselineHeadSha,
  });
  assert.notEqual(path.resolve(workspace.workspacePath), path.resolve(fixture.repoPath));
  assert.equal((await readFile(path.join(workspace.workspacePath, 'README.md'), 'utf8')).replaceAll('\r\n', '\n'), 'COMMITTED\n');
  await assert.rejects(readFile(path.join(workspace.workspacePath, '.env')), /ENOENT/u);
  await assert.rejects(readFile(path.join(workspace.workspacePath, '.git')), /ENOENT/u);
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
