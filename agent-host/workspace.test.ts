import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
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

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Extract `git archive <treeish>` into destDir so a test can inspect the smudged bytes. */
async function extractArchive(repoPath: string, treeish: string, destDir: string): Promise<void> {
  const archive = await execFileAsync('git', ['archive', '--format=tar', treeish], { cwd: repoPath, windowsHide: true, encoding: 'buffer' });
  const tarPath = path.join(destDir, 'archive.tar');
  await writeFile(tarPath, archive.stdout);
  await execFileAsync(resolveWorkspaceTarExecutable(), ['-xf', tarPath, '-C', destDir], { windowsHide: true });
  await rm(tarPath, { force: true });
}

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

test('workspace: symlinks and directory junctions are never followed (CT-REL-2 goal 10)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspace-baseline-symlinks-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'workspace-baseline-symlinks-outside-'));
  try {
    // A real directory OUTSIDE the workspace the link points into — following it
    // would leak foreign files into the captured tree.
    await writeFile(path.join(outside, 'leaked.ts'), 'never capture me');
    await writeFile(path.join(root, 'normal.ts'), 'baseline');
    // Directory junction (Windows reports junctions as symlinks via Dirent).
    await symlink(outside, path.join(root, 'escape'), 'junction');
    // File symlink — best-effort: creating one needs a symlink privilege that
    // may be absent (EPERM); the junction above is the realistic escape hatch.
    try {
      await symlink(path.join(outside, 'leaked.ts'), path.join(root, 'file-link.ts'));
    } catch (error) {
      assert.ok((error as NodeJS.ErrnoException).code === 'EPERM', 'unexpected symlink failure');
    }
    const tree = await captureWorkspaceTree(root);
    assert.deepEqual([...tree.files.keys()], ['normal.ts'], 'neither the junction nor the file symlink is captured');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
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

test('workspace: baseline matches canonical on-disk bytes under core.autocrlf=true (CT-GATE-FIX-1 goal 1)', async () => {
  const fixture = await createRepo();
  await git(fixture.repoPath, ['config', 'core.autocrlf', 'true']);
  await writeFile(path.join(fixture.repoPath, 'src', 'lf.txt'), 'line one\nline two\n');
  await git(fixture.repoPath, ['add', '.']);
  await git(fixture.repoPath, ['commit', '-m', 'lf file']);
  const onDisk = await readFile(path.join(fixture.repoPath, 'src', 'lf.txt'));
  assert.equal(onDisk.indexOf(0x0d), -1, 'fixture on-disk file is LF');

  // Prove the root cause: `git archive` smudges LF blobs to CRLF under autocrlf=true,
  // so an unmodified extraction would capture the wrong bytes as the baseline.
  const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'workspace-archive-'));
  try {
    await extractArchive(fixture.repoPath, 'HEAD', archiveDir);
    const archived = await readFile(path.join(archiveDir, 'src', 'lf.txt'));
    assert.notEqual(archived.indexOf(0x0d), -1, 'git archive smudged LF to CRLF (the root cause being fixed)');
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }

  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
  });
  const baseline = workspace.baselineTree.files.get('src/lf.txt');
  assert.equal(baseline?.sha256, sha256(onDisk), 'baseline equals canonical on-disk bytes, not the smudged archive');
  assert.equal(baseline?.lineEnding, 'lf');
  assert.equal((await readFile(path.join(workspace.workspacePath, 'src', 'lf.txt'))).equals(onDisk), true);
});

test('workspace: baseline matches on-disk bytes for CRLF and mixed-ending tracked files (CT-GATE-FIX-1 goal 1)', async () => {
  const fixture = await createRepo();
  await git(fixture.repoPath, ['config', 'core.autocrlf', 'true']);
  await writeFile(path.join(fixture.repoPath, 'src', 'crlf.txt'), 'owner\r\nsecond\r\n');
  await writeFile(path.join(fixture.repoPath, 'src', 'mixed.txt'), 'a\r\nb\rc\n');
  await git(fixture.repoPath, ['add', '.']);
  await git(fixture.repoPath, ['commit', '-m', 'crlf and mixed']);
  const onDiskCrlf = await readFile(path.join(fixture.repoPath, 'src', 'crlf.txt'));
  const onDiskMixed = await readFile(path.join(fixture.repoPath, 'src', 'mixed.txt'));

  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
  });
  const crlfBase = workspace.baselineTree.files.get('src/crlf.txt');
  const mixedBase = workspace.baselineTree.files.get('src/mixed.txt');
  assert.equal(crlfBase?.sha256, sha256(onDiskCrlf), 'CRLF baseline equals canonical on-disk bytes');
  assert.equal(crlfBase?.lineEnding, 'crlf');
  assert.equal(mixedBase?.sha256, sha256(onDiskMixed), 'mixed-ending baseline equals canonical on-disk bytes');
  assert.equal(mixedBase?.lineEnding, 'mixed');
});

test('workspace: a working-tree deletion of a tracked file stays a deletion in the baseline (CT-GATE-FIX-1 goal 1)', async () => {
  const fixture = await createRepo();
  await rm(path.join(fixture.repoPath, 'src', 'store.ts'));
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
    baselineHeadSha: fixture.baselineHeadSha,
  });
  assert.equal(workspace.baselineTree.files.has('src/store.ts'), false);
  await assert.rejects(readFile(path.join(workspace.workspacePath, 'src', 'store.ts')), /ENOENT/u);
});

test('workspace: a line-ending-only re-save is not a change, but a content+line-ending change is (CT-GATE-FIX-1 goal 3)', async () => {
  const fixture = await createRepo();
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
    baselineHeadSha: fixture.baselineHeadSha,
  });
  // Provider re-saves README.md changing ONLY line endings (LF -> CRLF, identical content).
  await writeFile(path.join(workspace.workspacePath, 'README.md'), 'COMMITTED\r\n');
  const leOnly = await adjudicateAttemptWorkspace({
    workspace, runId: 'run-1', task: task([]), attemptId: 'attempt-1', permissionProfile: 'task-implementer',
  });
  assert.equal(leOnly.changedFileCount, 0);
  assert.equal(leOnly.policy.accepted, true);
  assert.deepEqual(leOnly.changeSet?.changes, []);

  // Provider changes content AND line endings.
  await writeFile(path.join(workspace.workspacePath, 'README.md'), 'COMMITTED\r\nEDITED\r\n');
  const contentAndLe = await adjudicateAttemptWorkspace({
    workspace, runId: 'run-1', task: task(['README.md']), attemptId: 'attempt-1', permissionProfile: 'task-implementer',
  });
  assert.equal(contentAndLe.changedFileCount, 1);
  assert.deepEqual(contentAndLe.changeSet?.changes.map((change) => ({ kind: change.kind, path: change.path })), [
    { kind: 'modify', path: 'README.md' },
  ]);
});

test('workspace: Guard does not see a line-ending-only change on an unauthorized path (CT-GATE-FIX-1 goal 3)', async () => {
  const fixture = await createRepo();
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
    baselineHeadSha: fixture.baselineHeadSha,
  });
  // src/store.ts is NOT in the authorized paths. Re-save it changing ONLY line endings.
  await writeFile(path.join(workspace.workspacePath, 'src', 'store.ts'), 'export const baseline = true;\r\n');
  const result = await adjudicateAttemptWorkspace({
    workspace, runId: 'run-1', task: task(['README.md']), attemptId: 'attempt-1', permissionProfile: 'task-implementer',
  });
  assert.equal(result.changedFileCount, 0, 'a line-ending-only re-save is not a change at all');
  assert.equal(result.policy.accepted, true, 'Guard never sees the line-ending-only file');
  assert.equal(result.policy.reasonCodes.includes('out-of-scope-write'), false);
});

test('workspace: a tracked file inside node_modules stays excluded from the baseline (CT-GATE-FIX-1 goal 1 exclusions)', async () => {
  const fixture = await createRepo();
  await mkdir(path.join(fixture.repoPath, 'node_modules'), { recursive: true });
  await writeFile(path.join(fixture.repoPath, 'node_modules', 'tracked.js'), 'module.exports = 1;\n');
  await git(fixture.repoPath, ['add', '.']);
  await git(fixture.repoPath, ['commit', '-m', 'tracked inside node_modules']);
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
  });
  assert.equal(workspace.baselineTree.files.has('node_modules/tracked.js'), false, 'node_modules stays excluded from the baseline fingerprint even when tracked');
  assert.equal([...workspace.baselineTree.files.keys()].some((key) => key.startsWith('node_modules/')), false, 'no node_modules path leaks into the baseline');
});

test('workspace: a tracked file whose parent directory is a junction to outside fails closed with WORKSPACE_SOURCE_LINK_ESCAPE (CT-GATE-FIX-2 goal 1)', async () => {
  const fixture = await createRepo();
  // Commit a nested tracked file under src/features.
  await mkdir(path.join(fixture.repoPath, 'src', 'features'), { recursive: true });
  await writeFile(path.join(fixture.repoPath, 'src', 'features', 'foo.ts'), 'COMMITTED\n');
  await git(fixture.repoPath, ['add', '.']);
  await git(fixture.repoPath, ['commit', '-m', 'nested tracked file']);
  // An outside dir holding a DIFFERENT foo.ts; src/features becomes a junction to it.
  const outside = await mkdtemp(path.join(os.tmpdir(), 'workspace-junction-outside-'));
  try {
    await writeFile(path.join(outside, 'foo.ts'), 'OUTSIDE_BYTES\n');
    // Replace the real src/features directory with a junction to the outside dir.
    await rm(path.join(fixture.repoPath, 'src', 'features'), { recursive: true, force: true });
    await symlink(outside, path.join(fixture.repoPath, 'src', 'features'), 'junction');
    await assert.rejects(
      materializeAttemptWorkspace({
        canonicalRepoPath: fixture.repoPath,
        workspaceRoot: fixture.runtimePath,
        identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
      }),
      (error) => error instanceof WorkspacePreparationError
        && /WORKSPACE_SOURCE_LINK_ESCAPE: src\/features\/foo\.ts/u.test(error.message),
      'materialization must fail closed naming the repo-relative path only',
    );
    // No workspace left behind (materialization cleans up on failure) and no outside bytes copied.
    await assert.rejects(readFile(path.join(fixture.runtimePath, 'repo-key', 'run-1', 'attempt-1', 'src', 'features', 'foo.ts')), /ENOENT/u);
    assert.equal(await readFile(path.join(outside, 'foo.ts'), 'utf8'), 'OUTSIDE_BYTES\n', 'the outside target is untouched');
  } finally {
    await rm(path.join(fixture.repoPath, 'src', 'features')).catch(() => undefined);
    await rm(path.dirname(fixture.runtimePath), { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('workspace: a normal deeply nested tracked file still materializes with on-disk bytes (CT-GATE-FIX-2 goal 1)', async () => {
  const fixture = await createRepo();
  await mkdir(path.join(fixture.repoPath, 'src', 'a', 'b', 'c'), { recursive: true });
  await writeFile(path.join(fixture.repoPath, 'src', 'a', 'b', 'c', 'nested.ts'), 'export const nested = true;\n');
  await git(fixture.repoPath, ['add', '.']);
  await git(fixture.repoPath, ['commit', '-m', 'deeply nested']);
  const onDisk = await readFile(path.join(fixture.repoPath, 'src', 'a', 'b', 'c', 'nested.ts'));
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
    baselineHeadSha: (await git(fixture.repoPath, ['rev-parse', 'HEAD'])).trim(),
  });
  const baseline = workspace.baselineTree.files.get('src/a/b/c/nested.ts');
  assert.equal(baseline?.sha256, sha256(onDisk), 'the ancestor guard does not reject real nested directories');
  assert.equal((await readFile(path.join(workspace.workspacePath, 'src', 'a', 'b', 'c', 'nested.ts'))).equals(onDisk), true);
});

test('workspace: a top-level directory junction to outside fails closed with WORKSPACE_SOURCE_LINK_ESCAPE (CT-GATE-FIX-3 goal 1)', async () => {
  const fixture = await createRepo();
  // Commit a tracked file directly under a TOP-LEVEL directory (not nested under src/).
  await mkdir(path.join(fixture.repoPath, 'features'), { recursive: true });
  await writeFile(path.join(fixture.repoPath, 'features', 'foo.ts'), 'COMMITTED\n');
  await git(fixture.repoPath, ['add', '.']);
  await git(fixture.repoPath, ['commit', '-m', 'top-level tracked dir']);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'workspace-top-junction-outside-'));
  try {
    await writeFile(path.join(outside, 'foo.ts'), 'OUTSIDE_BYTES\n');
    // Replace the top-level features/ directory with a junction to the outside dir.
    await rm(path.join(fixture.repoPath, 'features'), { recursive: true, force: true });
    await symlink(outside, path.join(fixture.repoPath, 'features'), 'junction');
    await assert.rejects(
      materializeAttemptWorkspace({
        canonicalRepoPath: fixture.repoPath,
        workspaceRoot: fixture.runtimePath,
        identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
      }),
      (error) => error instanceof WorkspacePreparationError
        && /WORKSPACE_SOURCE_LINK_ESCAPE: features\/foo\.ts/u.test(error.message),
      'a top-level junction ancestor must fail closed naming the repo-relative path only',
    );
    await assert.rejects(readFile(path.join(fixture.runtimePath, 'repo-key', 'run-1', 'attempt-1', 'features', 'foo.ts')), /ENOENT/u, 'no workspace left behind');
    assert.equal(await readFile(path.join(outside, 'foo.ts'), 'utf8'), 'OUTSIDE_BYTES\n', 'the outside target is untouched — nothing copied through the junction');
  } finally {
    await rm(path.join(fixture.repoPath, 'features')).catch(() => undefined);
    await rm(path.dirname(fixture.runtimePath), { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('workspace: a top-level tracked file with no nested ancestors still materializes with on-disk bytes (CT-GATE-FIX-3 goal 1 positive control)', async () => {
  // Pairs with the top-level junction test above: a top-level file has zero
  // ancestor directories, so guard.assert walks nothing and must still let the
  // real file through. This confirms the fail-closed guard does not over-reject
  // the zero-ancestor case. (The realpath try/catch in copyWorkspaceFile is
  // defense-in-depth: guard.assert catches ancestor junctions first, and a leaf
  // symlink is skipped by the lstat().isFile() guard before realpath runs, so no
  // real on-disk state reaches the realpath branch — it is verified by inspection
  // and by the ancestor-junction tests.)
  const fixture = await createRepo();
  await writeFile(path.join(fixture.repoPath, 'top.txt'), 'COMMITTED_TOP\n');
  await git(fixture.repoPath, ['add', '.']);
  await git(fixture.repoPath, ['commit', '-m', 'top-level file']);
  const onDisk = await readFile(path.join(fixture.repoPath, 'top.txt'));
  const workspace = await materializeAttemptWorkspace({
    canonicalRepoPath: fixture.repoPath,
    workspaceRoot: fixture.runtimePath,
    identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
    baselineHeadSha: (await git(fixture.repoPath, ['rev-parse', 'HEAD'])).trim(),
  });
  const baseline = workspace.baselineTree.files.get('top.txt');
  assert.equal(baseline?.sha256, sha256(onDisk), 'the zero-ancestor top-level file is captured');
  assert.equal((await readFile(path.join(workspace.workspacePath, 'top.txt'))).equals(onDisk), true);
  await rm(path.dirname(fixture.runtimePath), { recursive: true, force: true });
});

test('workspace: a realpath(root) failure fails closed with WORKSPACE_SOURCE_LINK_ESCAPE and copies nothing (CT-GATE-FIX-4 goal 2)', async () => {
  const fixture = await createRepo();
  const root = path.resolve(fixture.repoPath);
  // Injectable realpath seam: force realpath(root) to reject (simulating ELOOP/ENOENT
  // on the root). Production behavior is identical when the seam is omitted.
  const forcedRootFail = async (filePath: string): Promise<string> => {
    if (filePath === root) throw new Error('forced realpath root failure');
    return realpath(filePath);
  };
  await assert.rejects(
    materializeAttemptWorkspace({
      canonicalRepoPath: fixture.repoPath,
      workspaceRoot: fixture.runtimePath,
      identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
      realpath: forcedRootFail,
    }),
    (error) => error instanceof WorkspacePreparationError && /WORKSPACE_SOURCE_LINK_ESCAPE/u.test(error.message),
    'a realpath(root) failure must fail closed, never fall back to the lexical root',
  );
  await assert.rejects(readFile(path.join(fixture.runtimePath, 'repo-key', 'run-1', 'attempt-1', 'README.md')), /ENOENT/u, 'no workspace left behind — nothing copied');
  await rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
});

test('workspace: a realpath(source) failure fails closed with WORKSPACE_SOURCE_LINK_ESCAPE and copies nothing (CT-GATE-FIX-4 goal 2)', async () => {
  const fixture = await createRepo();
  const root = path.resolve(fixture.repoPath);
  // Injectable realpath seam: let realpath(root) resolve normally but force every
  // SOURCE path to reject. guard.realRoot() succeeds; the per-source realpath then
  // fails and copyWorkspaceFile wraps it into WORKSPACE_SOURCE_LINK_ESCAPE.
  const forcedSourceFail = async (filePath: string): Promise<string> => {
    if (filePath === root) return realpath(filePath);
    throw new Error('forced realpath source failure');
  };
  await assert.rejects(
    materializeAttemptWorkspace({
      canonicalRepoPath: fixture.repoPath,
      workspaceRoot: fixture.runtimePath,
      identity: { repoKey: 'repo-key', runId: 'run-1', attemptId: 'attempt-1' },
      realpath: forcedSourceFail,
    }),
    (error) => error instanceof WorkspacePreparationError && /WORKSPACE_SOURCE_LINK_ESCAPE/u.test(error.message),
    'a realpath(source) failure must fail closed, never fall back to the lexical path',
  );
  await assert.rejects(readFile(path.join(fixture.runtimePath, 'repo-key', 'run-1', 'attempt-1', 'README.md')), /ENOENT/u, 'no workspace left behind — nothing copied');
  await rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
});
