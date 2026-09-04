import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { openOrchestrationStore, type OrchestrationStore } from '../lib/store.ts';
import type { AttemptRecord, JsonValue, TaskRecord } from '../lib/orchestrationTypes.ts';
import { classifyHostCommand } from './commandPolicy.ts';
import { captureRepoSnapshot } from './diffPolicy.ts';
import { parseAuthorizedWriteScope, isPathWithinAuthorizedScope, createTaskPolicyContext } from './pathPolicy.ts';
import { CANONICAL_PROTECTED_REPO_PATHS } from './repoPolicy.ts';
import {
  adjudicateRepoPolicy,
  buildPolicyEvaluationEventPayload,
  createAttemptPolicyController,
  createTaskSpecWithPolicy,
} from './policy.ts';
import type { PolicyBaselineCapture, TaskPolicyApproval } from './types.ts';
import { AttemptExecutor } from '../providers/executor.ts';
import type { ExecutionRequest, ExecutionResult, ProviderAdapter, ProviderId, ProviderProbeResult } from '../providers/types.ts';

const execFileAsync = promisify(execFile);

class FakeAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  private readonly onExecute: (request: ExecutionRequest) => Promise<ExecutionResult> | ExecutionResult;

  constructor(options: {
    id: ProviderId;
    onExecute: (request: ExecutionRequest) => Promise<ExecutionResult> | ExecutionResult;
  }) {
    this.id = options.id;
    this.onExecute = options.onExecute;
  }

  async probe(): Promise<ProviderProbeResult> {
    return { available: true };
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    return await this.onExecute(request);
  }

  cancel(): void {
    // These policy fixtures do not need adapter-side cancellation behavior.
  }
}

async function runGit(repoPath: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', [...args], {
    cwd: repoPath,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });

  return result.stdout;
}

async function createTempGitRepo(prefix: string): Promise<string> {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), prefix));
  await runGit(repoPath, ['init']);
  await runGit(repoPath, ['config', 'user.email', 'orch4b@example.com']);
  await runGit(repoPath, ['config', 'user.name', 'ORCH 4B']);
  return repoPath;
}

async function writeRepoFile(repoPath: string, repoRelativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(repoPath, ...repoRelativePath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

async function deleteRepoPath(repoPath: string, repoRelativePath: string): Promise<void> {
  const absolutePath = path.join(repoPath, ...repoRelativePath.split('/'));
  await rm(absolutePath, { force: true, recursive: true });
}

async function commitAll(repoPath: string, message: string): Promise<void> {
  await runGit(repoPath, ['add', '.']);
  await runGit(repoPath, ['commit', '--allow-empty', '-m', message]);
}

function createTaskRecord(spec: JsonValue | null): TaskRecord {
  return {
    taskId: 'task-1',
    runId: 'run-1',
    title: 'Task 1',
    goal: null,
    status: 'running',
    position: 0,
    spec,
    createdAt: '2026-08-24T01:00:00.000Z',
    updatedAt: '2026-08-24T01:00:00.000Z',
    startedAt: '2026-08-24T01:00:00.000Z',
    completedAt: null,
  };
}

async function captureBaseline(options: {
  repoPath: string;
  taskSpec: JsonValue | null;
  permissionProfile?: 'task-implementer' | 'read-only-reviewer' | 'verifier';
  approvals?: readonly TaskPolicyApproval[];
}): Promise<PolicyBaselineCapture> {
  const controller = createAttemptPolicyController();
  return await controller.captureBaseline({
    runId: 'run-1',
    task: createTaskRecord(options.taskSpec),
    attemptId: 'attempt-1',
    permissionProfile: options.permissionProfile ?? 'task-implementer',
    workingDirectory: options.repoPath,
    approvals: options.approvals,
  });
}

async function adjudicate(options: {
  repoPath: string;
  taskSpec: JsonValue | null;
  permissionProfile?: 'task-implementer' | 'read-only-reviewer' | 'verifier';
  approvals?: readonly TaskPolicyApproval[];
}): Promise<ReturnType<typeof adjudicateRepoPolicy>> {
  const baseline = await captureBaseline(options);
  const finalSnapshot = await captureRepoSnapshot(options.repoPath);
  return adjudicateRepoPolicy({ baseline, finalSnapshot });
}

function createExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    executionId: 'attempt-1',
    process: {
      exitCode: 0,
      signal: null,
      timedOut: false,
      cancelled: false,
      ...(overrides.process ?? {}),
    },
    provider: {
      terminalState: 'completed',
      success: true,
      ...(overrides.provider ?? {}),
    },
    model: {
      requestedModel: 'gpt-5.6',
      reportedModel: null,
      reportedModelSource: 'none',
      ...(overrides.model ?? {}),
    },
    usage: {
      source: 'none',
      ...(overrides.usage ?? {}),
    },
    session: {
      ...(overrides.session ?? {}),
    },
    output: {
      ...(overrides.output ?? {}),
    },
    diagnostics: overrides.diagnostics,
  };
}

async function createStoreWithAttempt(options: {
  taskSpec: JsonValue | null;
}): Promise<{ store: OrchestrationStore; attempt: AttemptRecord; dbPath: string }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orch4b-store-'));
  const dbPath = path.join(tempDir, 'orchestration.sqlite');
  const store = openOrchestrationStore({
    dbPath,
    repoKey: 'repo-key-1',
    hostId: 'host-1',
    hostVersion: '0.1.0',
  });

  store.createRun({ runId: 'run-1', title: 'Run 1' });
  store.createTask({
    taskId: 'task-1',
    runId: 'run-1',
    title: 'Task 1',
    spec: options.taskSpec,
  });
  const attempt = store.createAttempt({
    attemptId: 'attempt-1',
    taskId: 'task-1',
    hostInstanceId: 'host-instance-1',
  });

  return { store, attempt, dbPath };
}

test('policy: write-scope parsing normalizes repo-relative paths and rejects unsafe definitions', () => {
  const exactFile = parseAuthorizedWriteScope('src\\features\\expenses\\tab.tsx');
  const directoryPrefix = parseAuthorizedWriteScope('src/features/expenses/**');

  assert.equal(exactFile.kind, 'exact-file');
  assert.equal(exactFile.normalizedPath, 'src/features/expenses/tab.tsx');
  assert.equal(directoryPrefix.kind, 'directory-prefix');
  assert.equal(directoryPrefix.normalizedPath, 'src/features/expenses/');
  assert.equal(isPathWithinAuthorizedScope('src/features/expenses/value.ts', [directoryPrefix]), true);
  assert.equal(isPathWithinAuthorizedScope('src/features/other/value.ts', [directoryPrefix]), false);

  for (const candidate of ['C:\\abs\\path.ts', '..\\escape.ts', '\\\\server\\share', '*', '/**']) {
    assert.throws(() => parseAuthorizedWriteScope(candidate));
  }
});

test('policy: protected path set matches the ORCH-4A canonical list', () => {
  assert.deepEqual(CANONICAL_PROTECTED_REPO_PATHS, [
    'netlify.toml',
    'src/store/authStore.ts',
    'src/services/backupDataService.ts',
    'vite.config.ts',
    'src/components/v15r/charts/SVGCharts.tsx',
  ]);
});

test('policy: implementer accepts one authorized tracked modification', async () => {
  const repoPath = await createTempGitRepo('orch4b-allow-');
  await writeRepoFile(repoPath, 'src/feature.ts', 'export const value = 1;\n');
  await commitAll(repoPath, 'initial');

  const baseline = await captureBaseline({
    repoPath,
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/feature.ts'] }),
  });

  await writeRepoFile(repoPath, 'src/feature.ts', 'export const value = 2;\n');
  const adjudication = adjudicateRepoPolicy({
    baseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });

  assert.equal(adjudication.accepted, true);
  assert.equal(adjudication.changes.some((change) => change.category === 'AUTHORIZED_CHANGE'), true);
});

test('policy: implementer fails when authorized and out-of-scope mutations coexist', async () => {
  const repoPath = await createTempGitRepo('orch4b-oos-');
  await writeRepoFile(repoPath, 'src/in-scope.ts', 'export const a = 1;\n');
  await writeRepoFile(repoPath, 'src/out-of-scope.ts', 'export const b = 1;\n');
  await commitAll(repoPath, 'initial');

  const baseline = await captureBaseline({
    repoPath,
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/in-scope.ts'] }),
  });

  await writeRepoFile(repoPath, 'src/in-scope.ts', 'export const a = 2;\n');
  await writeRepoFile(repoPath, 'src/out-of-scope.ts', 'export const b = 2;\n');
  const adjudication = adjudicateRepoPolicy({
    baseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });

  assert.equal(adjudication.accepted, false);
  assert.equal(adjudication.reasonCodes.includes('out-of-scope-write'), true);
});

test('policy: protected path change fails without approval and can pass with matching approval', async () => {
  const repoPath = await createTempGitRepo('orch4b-protected-');
  await writeRepoFile(repoPath, 'src/store/authStore.ts', 'export const auth = 1;\n');
  await commitAll(repoPath, 'initial');

  const taskSpec = createTaskSpecWithPolicy({ authorizedWritePaths: ['src/**'] });
  const deniedBaseline = await captureBaseline({ repoPath, taskSpec });
  await writeRepoFile(repoPath, 'src/store/authStore.ts', 'export const auth = 2;\n');
  const denied = adjudicateRepoPolicy({
    baseline: deniedBaseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });
  assert.equal(denied.accepted, false);
  assert.equal(denied.reasonCodes.includes('protected-path'), true);

  await runGit(repoPath, ['restore', '--worktree', '--staged', '--', 'src/store/authStore.ts']);
  const approvedBaseline = await captureBaseline({
    repoPath,
    taskSpec,
    approvals: [{
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      action: 'protected-path-write',
      scopes: ['src/store/authStore.ts'],
    }],
  });

  await writeRepoFile(repoPath, 'src/store/authStore.ts', 'export const auth = 3;\n');
  const approved = adjudicateRepoPolicy({
    baseline: approvedBaseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });
  assert.equal(approved.accepted, true);
});

test('policy: reviewer immutability denies created files and verifier immutability denies tracked edits', async () => {
  const repoPath = await createTempGitRepo('orch4b-immutability-');
  await writeRepoFile(repoPath, 'src/existing.ts', 'export const stable = true;\n');
  await commitAll(repoPath, 'initial');

  const reviewerBaseline = await captureBaseline({
    repoPath,
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/**'] }),
    permissionProfile: 'read-only-reviewer',
  });
  await writeRepoFile(repoPath, 'src/new-file.ts', 'export const reviewerWrite = true;\n');
  const reviewer = adjudicateRepoPolicy({
    baseline: reviewerBaseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });
  assert.equal(reviewer.accepted, false);
  assert.equal(reviewer.reasonCodes.includes('reviewer-immutability'), true);

  await runGit(repoPath, ['restore', '--worktree', '--staged', '--', 'src/new-file.ts']).catch(() => undefined);
  await deleteRepoPath(repoPath, 'src/new-file.ts');
  const verifierBaseline = await captureBaseline({
    repoPath,
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/**'] }),
    permissionProfile: 'verifier',
  });
  await writeRepoFile(repoPath, 'src/existing.ts', 'export const stable = false;\n');
  const verifier = adjudicateRepoPolicy({
    baseline: verifierBaseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });
  assert.equal(verifier.accepted, false);
  assert.equal(verifier.reasonCodes.includes('reviewer-immutability'), true);
});

test('policy: unchanged pre-existing dirty state is preserved and same-status content mutation is detected', async () => {
  const repoPath = await createTempGitRepo('orch4b-preexisting-');
  await writeRepoFile(repoPath, 'supabase/.temp/cli-latest', 'A\n');
  await commitAll(repoPath, 'initial');

  await writeRepoFile(repoPath, 'supabase/.temp/cli-latest', 'dirty baseline\n');
  const unchangedBaseline = await captureBaseline({
    repoPath,
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/**'] }),
  });
  const unchanged = adjudicateRepoPolicy({
    baseline: unchangedBaseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });
  assert.equal(unchanged.accepted, true);
  assert.equal(unchanged.changes.some((change) => change.category === 'PREEXISTING_UNRELATED_CHANGE'), true);

  await writeRepoFile(repoPath, 'supabase/.temp/cli-latest', 'dirty baseline mutated\n');
  const mutated = adjudicateRepoPolicy({
    baseline: unchangedBaseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });
  assert.equal(mutated.accepted, false);
  assert.equal(mutated.reasonCodes.includes('preexisting-change-mutated'), true);
});

test('policy: staged, unstaged, reverted, and deleted mutations of pre-existing dirty paths are all detected', async () => {
  const cases = [
    {
      name: 'unstaged-to-staged',
      applyAfterBaseline: async (repoPath: string) => {
        await runGit(repoPath, ['add', 'supabase/.temp/cli-latest']);
      },
    },
    {
      name: 'reverted',
      applyAfterBaseline: async (repoPath: string) => {
        await runGit(repoPath, ['restore', '--worktree', '--', 'supabase/.temp/cli-latest']);
      },
    },
    {
      name: 'deleted',
      applyAfterBaseline: async (repoPath: string) => {
        await deleteRepoPath(repoPath, 'supabase/.temp/cli-latest');
      },
    },
  ];

  for (const scenario of cases) {
    const repoPath = await createTempGitRepo(`orch4b-preexisting-${scenario.name}-`);
    await writeRepoFile(repoPath, 'supabase/.temp/cli-latest', 'A\n');
    await commitAll(repoPath, 'initial');
    await writeRepoFile(repoPath, 'supabase/.temp/cli-latest', 'dirty baseline\n');

    const baseline = await captureBaseline({
      repoPath,
      taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/**'] }),
    });
    await scenario.applyAfterBaseline(repoPath);

    const adjudication = adjudicateRepoPolicy({
      baseline,
      finalSnapshot: await captureRepoSnapshot(repoPath),
    });
    assert.equal(adjudication.accepted, false, scenario.name);
    assert.equal(adjudication.reasonCodes.includes('preexisting-change-mutated'), true, scenario.name);
  }
});

test('policy: authorized untracked files pass and out-of-scope untracked files fail', async () => {
  const repoPath = await createTempGitRepo('orch4b-untracked-');
  await commitAll(repoPath, 'empty initial');

  const baseline = await captureBaseline({
    repoPath,
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/new-file.ts'] }),
  });
  await writeRepoFile(repoPath, 'src/new-file.ts', 'export const created = true;\n');
  let adjudication = adjudicateRepoPolicy({
    baseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });
  assert.equal(adjudication.accepted, true);
  assert.equal(adjudication.changes.some((change) => change.category === 'UNTRACKED_FILE'), true);

  await deleteRepoPath(repoPath, 'src/new-file.ts');
  const baselineOutOfScope = await captureBaseline({
    repoPath,
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/in-scope.ts'] }),
  });
  await writeRepoFile(repoPath, 'src/out-of-scope.ts', 'export const created = true;\n');
  adjudication = adjudicateRepoPolicy({
    baseline: baselineOutOfScope,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });
  assert.equal(adjudication.accepted, false);
  assert.equal(adjudication.reasonCodes.includes('out-of-scope-write'), true);
});

test('policy: authorized deletions and rename old/new path adjudication behave correctly', async () => {
  const repoPath = await createTempGitRepo('orch4b-delete-rename-');
  await writeRepoFile(repoPath, 'src/delete-me.ts', 'export const doomed = true;\n');
  await writeRepoFile(repoPath, 'src/rename-old.ts', 'export const moved = true;\n');
  await commitAll(repoPath, 'initial');

  const deletionBaseline = await captureBaseline({
    repoPath,
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/delete-me.ts'] }),
  });
  await deleteRepoPath(repoPath, 'src/delete-me.ts');
  const deletion = adjudicateRepoPolicy({
    baseline: deletionBaseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });
  assert.equal(deletion.accepted, true);
  assert.equal(deletion.changes.some((change) => change.category === 'DELETED_FILE'), true);

  await runGit(repoPath, ['restore', '--worktree', '--staged', '--', 'src/delete-me.ts']);
  const renameBaseline = await captureBaseline({
    repoPath,
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/rename-old.ts'] }),
  });
  await runGit(repoPath, ['mv', 'src/rename-old.ts', 'src/renamed-new.ts']);
  const renamed = adjudicateRepoPolicy({
    baseline: renameBaseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });
  assert.equal(renamed.accepted, false);
  const renameChange = renamed.changes.find((change) => change.category === 'OUT_OF_SCOPE_CHANGE' || change.category === 'RENAMED_FILE');
  assert.ok(renameChange);
  assert.equal(renameChange?.originalPath, 'src/rename-old.ts');
});

test('policy: unexpected HEAD movement is denied', async () => {
  const repoPath = await createTempGitRepo('orch4b-head-');
  await writeRepoFile(repoPath, 'src/head.ts', 'export const head = 1;\n');
  await commitAll(repoPath, 'initial');

  const baseline = await captureBaseline({
    repoPath,
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/**'] }),
  });
  await writeRepoFile(repoPath, 'src/head.ts', 'export const head = 2;\n');
  await commitAll(repoPath, 'head moved');

  const adjudication = adjudicateRepoPolicy({
    baseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });
  assert.equal(adjudication.accepted, false);
  assert.equal(adjudication.reasonCodes.includes('unexpected-head-move'), true);
});

test('policy: command classifier labels safe, gated, destructive, secret, and unknown host commands correctly', () => {
  const validation = classifyHostCommand(['npm', 'run', 'test']);
  const gated = classifyHostCommand(['git', 'add', 'src/file.ts']);
  const destructive = classifyHostCommand(['git', 'reset', '--hard']);
  const secret = classifyHostCommand(['Get-Content', '.env']);
  const unknown = classifyHostCommand(['custom-tool', '--do-a-thing']);

  assert.equal(validation.classification, 'VALIDATION');
  assert.equal(validation.decision.decision, 'allow');
  assert.equal(gated.classification, 'GIT_WRITE_LOCAL');
  assert.equal(gated.decision.decision, 'require-human');
  assert.equal(destructive.classification, 'GIT_DESTRUCTIVE');
  assert.equal(destructive.decision.decision, 'deny');
  assert.equal(secret.classification, 'SECRET_ACCESS');
  assert.equal(secret.decision.reasonCode, 'secret-access');
  assert.equal(unknown.classification, 'UNKNOWN');
  assert.equal(unknown.decision.decision, 'require-human');
});

test('policy: secret-path writes are denied and policy events omit raw secret contents', async () => {
  const repoPath = await createTempGitRepo('orch4b-secret-');
  await commitAll(repoPath, 'empty initial');

  const baseline = await captureBaseline({
    repoPath,
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['.env'] }),
  });

  const secretValue = 'SUPER_SECRET_TOKEN=abc123';
  await writeRepoFile(repoPath, '.env', `${secretValue}\n`);
  const adjudication = adjudicateRepoPolicy({
    baseline,
    finalSnapshot: await captureRepoSnapshot(repoPath),
  });

  assert.equal(adjudication.accepted, false);
  assert.equal(adjudication.reasonCodes.includes('secret-access'), true);

  const payload = JSON.stringify(buildPolicyEvaluationEventPayload(adjudication));
  assert.equal(payload.includes(secretValue), false);
  assert.equal(payload.includes('prompt text'), false);
});

test('policy: filename spaces parse correctly and ignored build artifacts do not cause false violations', async () => {
  const repoPath = await createTempGitRepo('orch4b-spaces-');
  await writeRepoFile(repoPath, '.gitignore', 'dist/\n');
  await writeRepoFile(repoPath, 'src/file with spaces.ts', 'export const spaced = 1;\n');
  await commitAll(repoPath, 'initial');

  const baseline = await captureBaseline({
    repoPath,
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/file with spaces.ts'] }),
  });
  await writeRepoFile(repoPath, 'src/file with spaces.ts', 'export const spaced = 2;\n');
  await writeRepoFile(repoPath, 'dist/generated.js', 'console.log("ignored");\n');

  const snapshot = await captureRepoSnapshot(repoPath);
  assert.equal(snapshot.entries.some((entry) => entry.path === 'src/file with spaces.ts'), true);
  assert.equal(snapshot.entries.some((entry) => entry.path.startsWith('dist/')), false);

  const adjudication = adjudicateRepoPolicy({
    baseline,
    finalSnapshot: snapshot,
  });
  assert.equal(adjudication.accepted, true);
});

test('policy: task policy context remains readable when spec has no nested policy object', () => {
  const context = createTaskPolicyContext({
    taskSpec: { owner: 'legacy', enabled: true },
    permissionProfile: 'task-implementer',
  });

  assert.deepEqual(context.authorizedWriteScopes, []);
  assert.deepEqual(context.invalidAuthorizedWriteScopes, []);
});

test('policy: executor overrides provider-success acceptance on policy denial and records policy events', async () => {
  const repoPath = await createTempGitRepo('orch4b-executor-deny-');
  await writeRepoFile(repoPath, 'src/allowed.ts', 'export const allowed = 1;\n');
  await writeRepoFile(repoPath, 'src/disallowed.ts', 'export const disallowed = 1;\n');
  await commitAll(repoPath, 'initial');

  const { store } = await createStoreWithAttempt({
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/allowed.ts'] }),
  });

  try {
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () => {
        await writeRepoFile(repoPath, 'src/disallowed.ts', 'export const disallowed = 2;\n');
        return createExecutionResult();
      },
    });
    const executor = new AttemptExecutor({
      store,
      registry: new Map([['codex', adapter]]),
    });

    const outcome = await executor.execute({
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      provider: 'codex',
      prompt: 'Do the work safely.',
      permissionProfile: 'task-implementer',
      timeoutMs: 60_000,
      workingDirectory: repoPath,
      hostInstanceId: 'host-instance-1',
    });

    assert.equal(outcome.result.provider.success, true);
    assert.equal(outcome.terminalAttemptStatus, 'failed');
    assert.equal(store.getAttempt('attempt-1')?.status, 'failed');
    assert.equal(store.listEvents().some((event) => event.type === 'policy.violation'), true);
  } finally {
    store.close();
  }
});

test('policy: provider failure still adjudicates repo mutations and emits policy evidence', async () => {
  const repoPath = await createTempGitRepo('orch4b-executor-provider-fail-');
  await writeRepoFile(repoPath, 'src/out.ts', 'export const before = 1;\n');
  await commitAll(repoPath, 'initial');

  const { store } = await createStoreWithAttempt({
    taskSpec: createTaskSpecWithPolicy({ authorizedWritePaths: ['src/allowed.ts'] }),
  });

  try {
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () => {
        await writeRepoFile(repoPath, 'src/out.ts', 'export const before = 2;\n');
        return createExecutionResult({
          provider: {
            terminalState: 'failed',
            success: false,
            errorCode: 'PROVIDER_ERROR',
            errorMessage: 'provider failed',
          },
        });
      },
    });
    const executor = new AttemptExecutor({
      store,
      registry: new Map([['codex', adapter]]),
    });

    const outcome = await executor.execute({
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      provider: 'codex',
      prompt: 'Fail after mutating.',
      permissionProfile: 'task-implementer',
      timeoutMs: 60_000,
      workingDirectory: repoPath,
      hostInstanceId: 'host-instance-1',
    });

    assert.equal(outcome.result.provider.success, false);
    assert.equal(outcome.policy.accepted, false);
    assert.equal(store.listEvents().some((event) => event.type === 'policy.evaluated'), true);
    assert.equal(store.listEvents().some((event) => event.type === 'policy.violation'), true);
  } finally {
    store.close();
  }
});
