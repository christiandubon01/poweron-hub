import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { openOrchestrationStore } from '../lib/store.ts';
import type { OrchestrationStore } from '../lib/store.ts';
import { OrchestrationError, TEXT_FIELD_MAX_BYTES } from '../lib/orchestrationTypes.ts';
import { shutdownHostRuntime } from '../index.ts';
import { createNoOpAttemptPolicyController } from '../policy/policy.ts';
import type { ExecutionRequest, ExecutionResult, ProviderAdapter, ProviderErrorCode, ProviderId, ProviderProbeResult } from './types.ts';
import {
  AttemptExecutor,
  AttemptExecutorError,
  createProviderRegistry,
  DURABLE_STDERR_TAIL_MAX_CHARS,
  recoverInterruptedAttempts,
  type AttemptExecutionInput,
} from './executor.ts';
import type { AttemptWorkspace } from '../workspace.ts';
import { mapPermissionProfileToCodexSandbox } from './codex.ts';
import { evaluateControlTowerUiSmokeAcceptance, CONTROL_TOWER_UI_SMOKE_LINE, CONTROL_TOWER_UI_SMOKE_PATH } from '../control/planning.ts';
import { classifyAttemptFailure, supervisorTick } from '../supervisor/supervisor.ts';
import { ProductionExecutionPort, VERIFIER_VERDICT_EVENT } from '../control/supervisorPort.ts';

const execFileAsync = promisify(execFile);

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface FakeAdapterOptions {
  id: ProviderId;
  onExecute?: ((request: ExecutionRequest) => Promise<ExecutionResult> | ExecutionResult) | undefined;
  onCancel?: ((executionId: string) => void) | undefined;
}

class FakeAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  readonly executeRequests: ExecutionRequest[] = [];
  readonly cancelRequests: string[] = [];
  private readonly onExecute?: ((request: ExecutionRequest) => Promise<ExecutionResult> | ExecutionResult) | undefined;
  private readonly onCancel?: ((executionId: string) => void) | undefined;

  constructor(options: FakeAdapterOptions) {
    this.id = options.id;
    this.onExecute = options.onExecute;
    this.onCancel = options.onCancel;
  }

  async probe(): Promise<ProviderProbeResult> {
    return { available: true };
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    this.executeRequests.push(request);
    if (!this.onExecute) {
      return createExecutionResult();
    }
    return await this.onExecute(request);
  }

  cancel(executionId: string): void {
    this.cancelRequests.push(executionId);
    this.onCancel?.(executionId);
  }
}

async function createTempDbPath(prefix: string): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return path.join(tempDir, 'orchestration.sqlite');
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createStore(options: {
  dbPath: string;
  testHooks?: {
    beforeEventInsert?: ((event: {
      eventId: string;
      runId: string;
      taskId: string | null;
      attemptId: string | null;
      type: string;
      createdAt: string;
      payloadText: string | null;
    }) => void) | undefined;
  };
}): OrchestrationStore {
  let eventCounter = 0;
  return openOrchestrationStore({
    dbPath: options.dbPath,
    repoKey: 'repo-key-1',
    hostId: 'host-1',
    hostVersion: '0.1.0',
    idGenerator: () => `event-${++eventCounter}`,
    testHooks: options.testHooks,
  });
}

function seedRunningAttempt(
  store: OrchestrationStore,
  overrides: Partial<{ runId: string; taskId: string; attemptId: string; hostInstanceId: string }> = {},
) {
  const runId = overrides.runId ?? 'run-1';
  const taskId = overrides.taskId ?? 'task-1';
  const attemptId = overrides.attemptId ?? 'attempt-1';
  const hostInstanceId = overrides.hostInstanceId ?? 'host-instance-1';

  const run = store.createRun({
    runId,
    title: `Run ${runId}`,
  });
  const task = store.createTask({
    taskId,
    runId,
    title: `Task ${taskId}`,
  });
  const attempt = store.createAttempt({
    attemptId,
    taskId,
    hostInstanceId,
  });
  return { run, task, attempt };
}

function createExecutionInput(
  overrides: Partial<AttemptExecutionInput> = {},
): AttemptExecutionInput {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    provider: 'codex',
    harness: 'cmd-wrapper',
    prompt: 'Implement the feature safely.',
    requestedModel: 'gpt-5.6',
    reasoningEffort: 'medium',
    permissionProfile: 'read-only-reviewer',
    timeoutMs: 120_000,
    workingDirectory: 'C:\\Repo\\PowerOn',
    hostInstanceId: 'host-instance-1',
    ...overrides,
  };
}

function createExecutionResult(
  overrides: Partial<ExecutionResult> = {},
): ExecutionResult {
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

function createCancelledExecutionResult(
  overrides: Partial<ExecutionResult> = {},
): ExecutionResult {
  return createExecutionResult({
    ...overrides,
    process: {
      exitCode: null,
      signal: null,
      timedOut: false,
      cancelled: true,
      ...(overrides.process ?? {}),
    },
    provider: {
      terminalState: 'failed',
      success: false,
      errorCode: 'EXECUTION_CANCELLED',
      errorMessage: 'cancelled',
      ...(overrides.provider ?? {}),
    },
  });
}

function createExecutor(
  store: OrchestrationStore,
  adapters: ProviderAdapter[] = [],
  overrides: Partial<{
    now: () => Date;
    defaultTimeoutMs: number;
    executionHardGraceMs: number;
    shutdownTimeoutMs: number;
    policyController: ReturnType<typeof createNoOpAttemptPolicyController>;
    workspaceConfig: { canonicalRepoPath: string; workspaceRoot: string; repoKey: string };
    workspacePreparer: (options: { canonicalRepoPath: string; workspaceRoot: string; identity: { repoKey: string; runId: string; attemptId: string } }) => Promise<AttemptWorkspace>;
  }> = {},
): AttemptExecutor {
  return new AttemptExecutor({
    store,
    registry: new Map(adapters.map((adapter) => [adapter.id, adapter])),
    now: overrides.now,
    defaultTimeoutMs: overrides.defaultTimeoutMs,
    executionHardGraceMs: overrides.executionHardGraceMs,
    shutdownTimeoutMs: overrides.shutdownTimeoutMs,
    policyController: overrides.policyController ?? createNoOpAttemptPolicyController(),
    workspaceConfig: overrides.workspaceConfig,
    workspacePreparer: overrides.workspacePreparer,
  });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, windowsHide: true });
}

async function createNoOpPolicyBaseline(store: OrchestrationStore, input: AttemptExecutionInput) {
  const task = store.getTask(input.taskId);
  assert.ok(task);

  return await createNoOpAttemptPolicyController().captureBaseline({
    runId: input.runId,
    task,
    attemptId: input.attemptId,
    permissionProfile: input.permissionProfile,
    workingDirectory: input.workingDirectory,
  });
}

test('executor: valid running Attempt executes a registered adapter and persists execution.started before invocation', async () => {
  const dbPath = await createTempDbPath('orch3f-valid-');
  const store = createStore({ dbPath });
  const seeded = seedRunningAttempt(store);

  try {
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async (request) => {
        const eventTypes = store.listEvents().map((event) => event.type);
        assert.equal(eventTypes.includes('execution.started'), true);
        assert.equal(request.executionId, seeded.attempt.attemptId);
        return createExecutionResult({ executionId: request.executionId });
      },
    });
    const executor = createExecutor(store, [adapter]);

    const outcome = await executor.execute(createExecutionInput());
    assert.equal(adapter.executeRequests.length, 1);
    assert.equal(outcome.attempt.status, 'passed');
    assert.equal(outcome.terminalEvent!.type, 'execution.completed');
  } finally {
    store.close();
  }
});

test('executor: task implementer is materialized into an isolated workspace and never runs dirty canonical source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orch4c3b-executor-'));
  const repoPath = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'runtime', 'workspaces');
  await mkdir(repoPath);
  await git(repoPath, ['init']);
  await git(repoPath, ['config', 'user.email', 'fixture@example.invalid']);
  await git(repoPath, ['config', 'user.name', 'Fixture']);
  await writeFile(path.join(repoPath, 'README.md'), 'COMMITTED\n');
  await git(repoPath, ['add', '.']);
  await git(repoPath, ['commit', '-m', 'baseline']);
  await writeFile(path.join(repoPath, 'README.md'), 'OWNER_DIRTY\n');

  const configuredStore = createStore({ dbPath: path.join(root, 'orchestration.sqlite') });
  configuredStore.createRun({ runId: 'run-1', title: 'Run' });
  configuredStore.createTask({ taskId: 'task-1', runId: 'run-1', title: 'Task', spec: { policy: { authorizedWritePaths: ['agent-host/smoke/orch4c-smoke.txt'] } } });
  configuredStore.createAttempt({ attemptId: 'attempt-1', taskId: 'task-1', hostInstanceId: 'host-instance-1' });
  const adapter = new FakeAdapter({
    id: 'codex',
    onExecute: async (request) => {
      assert.notEqual(path.resolve(request.workingDirectory), path.resolve(repoPath));
      assert.equal((await readFile(path.join(request.workingDirectory, 'README.md'), 'utf8')).replaceAll('\r\n', '\n'), 'COMMITTED\n');
      await mkdir(path.join(request.workingDirectory, 'agent-host', 'smoke'), { recursive: true });
      await writeFile(path.join(request.workingDirectory, 'agent-host', 'smoke', 'orch4c-smoke.txt'), 'AGENT_HOST_WRITE_SMOKE_OK v1\n');
      return createExecutionResult({ executionId: request.executionId });
    },
  });
  const executor = createExecutor(configuredStore, [adapter], { workspaceConfig: { canonicalRepoPath: repoPath, workspaceRoot, repoKey: 'repo-key' } });
  const outcome = await executor.execute(createExecutionInput({ permissionProfile: 'task-implementer' }));
  assert.equal(adapter.executeRequests.length, 1);
  assert.equal(outcome.attempt.status, 'passed');
  assert.equal(await readFile(path.join(repoPath, 'README.md'), 'utf8'), 'OWNER_DIRTY\n');
  assert.equal(configuredStore.listEvents().some((event) => event.type === 'workspace.prepared'), true);
  const readyEvents = configuredStore.listEvents().filter((event) => event.type === 'workspace.changeset.ready');
  assert.equal(readyEvents.length, 1);
  assert.equal((readyEvents[0]?.payload as Record<string, unknown>).changeCount, 1);
  configuredStore.close();
});

test('ATB-7B2: verifier reads the implementer candidate copy and leaves canonical untouched', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atb7b2-verifier-'));
  const repoPath = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'runtime', 'workspaces');
  await mkdir(repoPath);
  await git(repoPath, ['init']);
  await git(repoPath, ['config', 'user.email', 'fixture@example.invalid']);
  await git(repoPath, ['config', 'user.name', 'Fixture']);
  await writeFile(path.join(repoPath, 'README.md'), 'COMMITTED\n');
  await git(repoPath, ['add', '.']);
  await git(repoPath, ['commit', '-m', 'baseline']);
  await writeFile(path.join(repoPath, 'README.md'), 'OWNER_DIRTY\n');

  const store = createStore({ dbPath: path.join(root, 'orchestration.sqlite') });
  store.createRun({ runId: 'run-1', title: 'Run' });
  store.createTask({
    taskId: 'task-impl',
    runId: 'run-1',
    title: 'Implement',
    spec: { policy: { authorizedWritePaths: [CONTROL_TOWER_UI_SMOKE_PATH] }, plan: { plannedAreas: ['agent-host/smoke'] } },
  });
  store.createTask({
    taskId: 'task-v',
    runId: 'run-1',
    title: 'Verify',
    spec: { policy: { authorizedWritePaths: [] }, plan: { role: 'verifier', plannedAreas: ['agent-host/smoke'] } },
  });
  store.addDependency('task-v', 'task-impl');
  store.createAttempt({ attemptId: 'attempt-impl', taskId: 'task-impl', hostInstanceId: 'host-instance-1' });
  store.createAttempt({ attemptId: 'attempt-v', taskId: 'task-v', hostInstanceId: 'host-instance-1' });

  const smokeBytes = Buffer.from(`${CONTROL_TOWER_UI_SMOKE_LINE}\n`, 'utf8');
  let implementerWorkspace = '';
  const adapter = new FakeAdapter({
    id: 'codex',
    onExecute: async (request) => {
      if (request.permissionProfile === 'task-implementer') {
        implementerWorkspace = request.workingDirectory;
        await mkdir(path.join(request.workingDirectory, 'agent-host', 'smoke'), { recursive: true });
        await writeFile(path.join(request.workingDirectory, CONTROL_TOWER_UI_SMOKE_PATH), smokeBytes);
      }
      return createExecutionResult({ executionId: request.executionId });
    },
  });
  const executor = createExecutor(store, [adapter], { workspaceConfig: { canonicalRepoPath: repoPath, workspaceRoot, repoKey: 'repo-key' } });

  const implemented = await executor.execute(createExecutionInput({
    taskId: 'task-impl',
    attemptId: 'attempt-impl',
    permissionProfile: 'task-implementer',
    workingDirectory: repoPath,
  }));
  assert.equal(implemented.policy.accepted, true);
  assert.deepEqual(implemented.policy.changes.map((change) => change.path), [CONTROL_TOWER_UI_SMOKE_PATH]);

  const verified = await executor.execute(createExecutionInput({
    taskId: 'task-v',
    attemptId: 'attempt-v',
    permissionProfile: 'verifier',
    workingDirectory: repoPath,
    prompt: 'Verify the candidate.',
  }));
  const verifierRequest = adapter.executeRequests[1];
  assert.ok(verifierRequest);
  assert.equal(mapPermissionProfileToCodexSandbox(verifierRequest.permissionProfile), 'read-only');
  assert.notEqual(path.resolve(verifierRequest.workingDirectory), path.resolve(repoPath));
  assert.notEqual(path.resolve(verifierRequest.workingDirectory), path.resolve(implementerWorkspace));
  const verifierBytes = await readFile(path.join(verifierRequest.workingDirectory, CONTROL_TOWER_UI_SMOKE_PATH));
  const implementerBytes = await readFile(path.join(implementerWorkspace, CONTROL_TOWER_UI_SMOKE_PATH));
  assert.deepEqual(verifierBytes, implementerBytes);
  assert.deepEqual(verifierBytes, smokeBytes);
  await assert.rejects(readFile(path.join(repoPath, CONTROL_TOWER_UI_SMOKE_PATH)), /ENOENT/u);
  await assert.rejects(readFile(path.join(verifierRequest.workingDirectory, 'OWNER_DIRTY')), /ENOENT/u);
  assert.equal(await readFile(path.join(repoPath, 'README.md'), 'utf8'), 'OWNER_DIRTY\n');
  assert.equal((await readFile(path.join(verifierRequest.workingDirectory, 'README.md'), 'utf8')).replaceAll('\r\n', '\n'), 'COMMITTED\n');
  const fileStat = await stat(path.join(verifierRequest.workingDirectory, CONTROL_TOWER_UI_SMOKE_PATH));
  assert.equal(fileStat.mode & 0o222, 0);
  await assert.rejects(writeFile(path.join(verifierRequest.workingDirectory, CONTROL_TOWER_UI_SMOKE_PATH), Buffer.from('MUTATED\n')));
  assert.equal(verified.attempt.status, 'passed');
  assert.equal(verified.policy.accepted, true);
  assert.deepEqual(verified.policy.changes.map((change) => change.path), []);
  assert.equal(evaluateControlTowerUiSmokeAcceptance({
    fileBytes: verifierBytes,
    changedPaths: implemented.policy.changes.map((change) => change.path),
  }).passed, true);
  const prepared = store.listEvents().find((event) => event.type === 'workspace.prepared' && event.attemptId === 'attempt-v');
  assert.equal((prepared?.payload as Record<string, unknown>).materializationMode, 'candidate-copy');
  assert.equal((prepared?.payload as Record<string, unknown>).readOnly, true);
  store.close();
});

test('executor: changeset-ready requires provider success and a non-empty accepted change', async () => {
  const cases = [
    { name: 'failed-no-op', providerSuccess: false, writesAuthorizedFile: false, expectedStatus: 'failed' },
    { name: 'failed-partial-change', providerSuccess: false, writesAuthorizedFile: true, expectedStatus: 'failed' },
    { name: 'successful-no-op', providerSuccess: true, writesAuthorizedFile: false, expectedStatus: 'passed' },
  ] as const;

  for (const testCase of cases) {
    const root = await mkdtemp(path.join(os.tmpdir(), `orch4c4c-${testCase.name}-`));
    const repoPath = path.join(root, 'repo');
    const workspaceRoot = path.join(root, 'workspaces');
    await mkdir(repoPath);
    await git(repoPath, ['init']);
    await git(repoPath, ['config', 'user.email', 'fixture@example.invalid']);
    await git(repoPath, ['config', 'user.name', 'Fixture']);
    await writeFile(path.join(repoPath, 'README.md'), 'BASELINE\n');
    await git(repoPath, ['add', '.']);
    await git(repoPath, ['commit', '-m', 'baseline']);

    const store = createStore({ dbPath: path.join(root, 'orchestration.sqlite') });
    store.createRun({ runId: 'run-1', title: 'Run' });
    store.createTask({ taskId: 'task-1', runId: 'run-1', title: 'Task', spec: { policy: { authorizedWritePaths: ['agent-host/smoke/result.txt'] } } });
    store.createAttempt({ attemptId: 'attempt-1', taskId: 'task-1', hostInstanceId: 'host-instance-1' });
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async (request) => {
        if (testCase.writesAuthorizedFile) {
          const outputPath = path.join(request.workingDirectory, 'agent-host', 'smoke', 'result.txt');
          await mkdir(path.dirname(outputPath), { recursive: true });
          await writeFile(outputPath, 'PARTIAL\n');
        }
        return createExecutionResult({
          executionId: request.executionId,
          provider: testCase.providerSuccess
            ? { terminalState: 'completed', success: true }
            : { terminalState: 'failed', success: false, errorCode: 'PROTOCOL_ERROR', errorMessage: 'incomplete' },
        });
      },
    });

    try {
      const outcome = await createExecutor(store, [adapter], { workspaceConfig: { canonicalRepoPath: repoPath, workspaceRoot, repoKey: 'repo-key' } })
        .execute(createExecutionInput({ permissionProfile: 'task-implementer', workingDirectory: repoPath }));
      assert.equal(outcome.policy.accepted, true, `${testCase.name} should remain policy-accepted`);
      assert.equal(outcome.attempt.status, testCase.expectedStatus);
      assert.equal(store.listEvents().filter((event) => event.type === 'workspace.changeset.ready').length, 0);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('executor: task implementer without Host workspace configuration fails closed before provider launch', async () => {
  const dbPath = await createTempDbPath('orch4c3c-no-workspace-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);
  const adapter = new FakeAdapter({ id: 'codex' });

  try {
    const outcome = await createExecutor(store, [adapter]).execute(createExecutionInput({ permissionProfile: 'task-implementer' }));
    assert.equal(adapter.executeRequests.length, 0);
    assert.equal(outcome.attempt.status, 'failed');
    assert.equal(outcome.startedEvent, null);
    assert.equal(store.listEvents().some((event) => event.type === 'workspace.preparation.failed'), true);
  } finally {
    store.close();
  }
});

test('executor: cancellation during deferred workspace preparation never launches the provider', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orch4c3c-cancel-'));
  const dbPath = path.join(root, 'orchestration.sqlite');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);
  const prepared = createDeferred<AttemptWorkspace>();
  const adapter = new FakeAdapter({ id: 'codex' });
  const workspacePath = path.join(root, 'workspaces', 'repo-key', 'run-1', 'attempt-1');
  await mkdir(workspacePath, { recursive: true });
  const executor = createExecutor(store, [adapter], {
    workspaceConfig: { canonicalRepoPath: path.join(root, 'canonical'), workspaceRoot: path.join(root, 'workspaces'), repoKey: 'repo-key' },
    workspacePreparer: async () => await prepared.promise,
  });

  try {
    const outcomePromise = executor.execute(createExecutionInput({ permissionProfile: 'task-implementer', workingDirectory: path.join(root, 'canonical') }));
    assert.equal(executor.cancel('attempt-1'), true);
    prepared.resolve({ workspaceId: 'repo-key/run-1/attempt-1', workspaceRoot: path.join(root, 'workspaces'), workspacePath, baselineHeadSha: 'a'.repeat(40), materializationMode: 'git-archive-tar', baselineTree: { files: new Map() } });
    const outcome = await outcomePromise;
    assert.equal(adapter.executeRequests.length, 0);
    assert.equal(outcome.attempt.status, 'cancelled');
    assert.equal(outcome.startedEvent, null);
    assert.equal(store.listEvents().some((event) => event.type === 'execution.started'), false);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('executor: shutdown during deferred workspace preparation never launches the provider', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orch4c3c-shutdown-'));
  const store = createStore({ dbPath: path.join(root, 'orchestration.sqlite') });
  seedRunningAttempt(store);
  const prepared = createDeferred<AttemptWorkspace>();
  const adapter = new FakeAdapter({ id: 'codex' });
  const workspacePath = path.join(root, 'workspaces', 'repo-key', 'run-1', 'attempt-1');
  await mkdir(workspacePath, { recursive: true });
  const executor = createExecutor(store, [adapter], {
    workspaceConfig: { canonicalRepoPath: path.join(root, 'canonical'), workspaceRoot: path.join(root, 'workspaces'), repoKey: 'repo-key' },
    workspacePreparer: async () => await prepared.promise,
  });

  try {
    const outcomePromise = executor.execute(createExecutionInput({ permissionProfile: 'task-implementer' }));
    const shutdownPromise = executor.shutdown(250);
    prepared.resolve({ workspaceId: 'repo-key/run-1/attempt-1', workspaceRoot: path.join(root, 'workspaces'), workspacePath, baselineHeadSha: 'b'.repeat(40), materializationMode: 'git-archive-tar', baselineTree: { files: new Map() } });
    const [outcome, shutdown] = await Promise.all([outcomePromise, shutdownPromise]);
    assert.equal(adapter.executeRequests.length, 0);
    assert.equal(outcome.attempt.status, 'cancelled');
    assert.equal(shutdown.timedOut, false);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('executor: workspace preparation failure cannot fall back to canonical main', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orch4c3c-failure-'));
  const store = createStore({ dbPath: path.join(root, 'orchestration.sqlite') });
  seedRunningAttempt(store);
  const adapter = new FakeAdapter({ id: 'codex' });
  const canonical = path.join(root, 'canonical');
  await mkdir(canonical);
  await writeFile(path.join(canonical, 'README.md'), 'OWNER_DIRTY\n');
  const executor = createExecutor(store, [adapter], {
    workspaceConfig: { canonicalRepoPath: canonical, workspaceRoot: path.join(root, 'workspaces'), repoKey: 'repo-key' },
    workspacePreparer: async () => { throw new Error('fixture preparation failure'); },
  });

  try {
    const outcome = await executor.execute(createExecutionInput({ permissionProfile: 'task-implementer', workingDirectory: canonical }));
    assert.equal(adapter.executeRequests.length, 0);
    assert.equal(outcome.attempt.status, 'failed');
    assert.equal(await readFile(path.join(canonical, 'README.md'), 'utf8'), 'OWNER_DIRTY\n');
    assert.equal(store.listEvents().some((event) => event.type === 'workspace.preparation.failed'), true);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('executor: isolated workspace policy denies out-of-scope, protected, secret, and deleted paths without changing main', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orch4c3c-policy-deny-'));
  const repoPath = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'workspaces');
  await mkdir(path.join(repoPath, 'src', 'store'), { recursive: true });
  await mkdir(path.join(repoPath, 'agent-host', 'smoke'), { recursive: true });
  await writeFile(path.join(repoPath, 'README.md'), 'CANONICAL\n');
  await writeFile(path.join(repoPath, 'src', 'store', 'authStore.ts'), 'export const auth = true;\n');
  await writeFile(path.join(repoPath, 'agent-host', 'smoke', 'delete-me.txt'), 'BASELINE\n');
  await git(repoPath, ['init']);
  await git(repoPath, ['config', 'user.email', 'fixture@example.invalid']);
  await git(repoPath, ['config', 'user.name', 'Fixture']);
  await git(repoPath, ['add', '.']);
  await git(repoPath, ['commit', '-m', 'baseline']);
  await writeFile(path.join(repoPath, 'README.md'), 'OWNER_DIRTY\n');

  const store = createStore({ dbPath: path.join(root, 'orchestration.sqlite') });
  store.createRun({ runId: 'run-1', title: 'Run' });
  store.createTask({ taskId: 'task-1', runId: 'run-1', title: 'Task', spec: { policy: { authorizedWritePaths: ['agent-host/smoke/**', 'src/**'] } } });
  store.createAttempt({ attemptId: 'attempt-1', taskId: 'task-1', hostInstanceId: 'host-instance-1' });
  const adapter = new FakeAdapter({
    id: 'codex',
    onExecute: async (request) => {
      await writeFile(path.join(request.workingDirectory, 'README.md'), 'OUT_OF_SCOPE\n');
      await writeFile(path.join(request.workingDirectory, 'src', 'store', 'authStore.ts'), 'PROTECTED\n');
      await writeFile(path.join(request.workingDirectory, '.env'), 'SYNTHETIC=value\n');
      await rm(path.join(request.workingDirectory, 'agent-host', 'smoke', 'delete-me.txt'));
      return createExecutionResult({ executionId: request.executionId });
    },
  });

  try {
    const outcome = await createExecutor(store, [adapter], { workspaceConfig: { canonicalRepoPath: repoPath, workspaceRoot, repoKey: 'repo-key' } })
      .execute(createExecutionInput({ permissionProfile: 'task-implementer', workingDirectory: repoPath }));
    assert.equal(outcome.result.provider.success, true, 'provider truth remains successful');
    assert.equal(outcome.policy.accepted, false);
    assert.equal(outcome.attempt.status, 'failed');
    assert.equal(store.listEvents().some((event) => event.type === 'workspace.changeset.ready'), false);
    assert.equal(await readFile(path.join(repoPath, 'README.md'), 'utf8'), 'OWNER_DIRTY\n');
    assert.equal(await readFile(path.join(repoPath, 'src', 'store', 'authStore.ts'), 'utf8'), 'export const auth = true;\n');
    assert.equal(await readFile(path.join(repoPath, 'agent-host', 'smoke', 'delete-me.txt'), 'utf8'), 'BASELINE\n');
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('executor: provider success passes Attempt, keeps Task running, and preserves separate process facts', async () => {
  const dbPath = await createTempDbPath('orch3f-success-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async (request) =>
        createExecutionResult({
          executionId: request.executionId,
          process: { exitCode: 17, signal: null, timedOut: false, cancelled: false },
        }),
    });
    const executor = createExecutor(store, [adapter]);

    const outcome = await executor.execute(createExecutionInput());
    assert.equal(outcome.result.process.exitCode, 17);
    assert.equal(store.getAttempt('attempt-1')?.status, 'passed');
    assert.equal(store.getTask('task-1')?.status, 'running');
  } finally {
    store.close();
  }
});

test('executor: provider failure maps Attempt failed and Task remains running', async () => {
  const dbPath = await createTempDbPath('orch3f-failure-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async (request) =>
        createExecutionResult({
          executionId: request.executionId,
          provider: {
            terminalState: 'failed',
            success: false,
            errorCode: 'PROVIDER_ERROR',
            errorMessage: 'provider rejected the turn',
          },
        }),
    });
    const executor = createExecutor(store, [adapter]);

    const outcome = await executor.execute(createExecutionInput());
    assert.equal(outcome.terminalEvent!.type, 'execution.failed');
    assert.equal(store.getAttempt('attempt-1')?.status, 'failed');
    assert.equal(store.getTask('task-1')?.status, 'running');
  } finally {
    store.close();
  }
});

test('executor: provider failure persists a bounded redacted stderr tail with process facts', async () => {
  const dbPath = await createTempDbPath('orch4c4c-diagnostic-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);
  const usefulTail = 'fatal: failed to contact provider endpoint\n';
  const stderrTail = [
    'x'.repeat(DURABLE_STDERR_TAIL_MAX_CHARS + 1024),
    'Authorization: Bearer bearer-value',
    'OPENAI_API_KEY=sk-openai-secret-value',
    'ANTHROPIC_API_KEY="anthropic-secret-value"',
    'token=token-value secret=secret-value password=password-value',
    'Cookie: session=cookie-value',
    usefulTail,
  ].join('\n');

  try {
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async (request) => createExecutionResult({
        executionId: request.executionId,
        process: { exitCode: 1, signal: 'SIGTERM', timedOut: false, cancelled: false },
        provider: {
          terminalState: 'failed',
          success: false,
          errorCode: 'PROTOCOL_ERROR',
          errorMessage: 'Provider process exited without turn.completed; token=message-secret-value',
        },
        diagnostics: { stderrTail },
      }),
    });
    const outcome = await createExecutor(store, [adapter]).execute(createExecutionInput({ prompt: 'private prompt value' }));
    const payload = outcome.terminalEvent!.payload as Record<string, any>;
    const durableTail = payload.diagnostics.stderrTail as string;
    const serialized = JSON.stringify(payload);

    assert.equal(outcome.terminalEvent!.type, 'execution.failed');
    assert.equal(payload.errorCode, 'PROTOCOL_ERROR');
    assert.equal(payload.process.exitCode, 1);
    assert.equal(payload.process.signal, 'SIGTERM');
    assert.ok(durableTail.length <= DURABLE_STDERR_TAIL_MAX_CHARS);
    assert.equal(durableTail.endsWith(usefulTail), true);
    assert.equal(durableTail.includes('[REDACTED]'), true);
    assert.match(payload.errorMessage, /Provider process exited without turn\.completed/u);
    for (const secret of ['message-secret-value', 'bearer-value', 'sk-openai-secret-value', 'anthropic-secret-value', 'token-value', 'secret-value', 'password-value', 'cookie-value']) {
      assert.equal(serialized.includes(secret), false, `${secret} must not be durable`);
    }
    assert.equal(serialized.includes('private prompt value'), false);
    assert.equal(serialized.includes(String(process.env.PATH ?? 'UNSET')), false);
  } finally {
    store.close();
  }
});

test('executor: successful provider does not persist diagnostic tails', async () => {
  const dbPath = await createTempDbPath('orch4c4c-success-diagnostic-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async (request) => createExecutionResult({
        executionId: request.executionId,
        diagnostics: { stderrTail: 'benign successful diagnostic\n' },
      }),
    });
    const outcome = await createExecutor(store, [adapter]).execute(createExecutionInput());
    const payload = outcome.terminalEvent!.payload as Record<string, unknown>;

    assert.equal(outcome.terminalEvent!.type, 'execution.completed');
    assert.equal('diagnostics' in payload, false);
    assert.equal(JSON.stringify(payload).includes('benign successful diagnostic'), false);
  } finally {
    store.close();
  }
});

test('executor: timeout maps execution.timed_out and failed Attempt', async () => {
  const dbPath = await createTempDbPath('orch3f-timeout-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async (request) =>
        createExecutionResult({
          executionId: request.executionId,
          process: { exitCode: null, signal: null, timedOut: true, cancelled: false },
          provider: {
            terminalState: 'failed',
            success: false,
            errorCode: 'EXECUTION_TIMEOUT',
            errorMessage: 'timed out',
          },
        }),
    });
    const executor = createExecutor(store, [adapter]);

    const outcome = await executor.execute(createExecutionInput());
    assert.equal(outcome.terminalEvent!.type, 'execution.timed_out');
    assert.equal(store.getAttempt('attempt-1')?.status, 'failed');
  } finally {
    store.close();
  }
});

test('executor: a provider that never settles is hard-terminated at the executor timeout and terminalized as a retryable timeout', async () => {
  const dbPath = await createTempDbPath('orch-hardtimeout-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    // Worst case for the orchestration boundary: execute() never settles AND the
    // adapter does not honor cancellation (onCancel is a no-op that never resolves
    // the deferred). The executor must still enforce a HARD upper bound so the
    // Attempt cannot remain running forever.
    const neverSettles = createDeferred<ExecutionResult>();
    let executeCalls = 0;
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () => {
        executeCalls += 1;
        return await neverSettles.promise;
      },
    });
    // hard deadline = request timeout (100ms) + grace (50ms) = 150ms.
    const executor = createExecutor(store, [adapter], { executionHardGraceMs: 50 });

    const startedAt = Date.now();
    const outcome = await executor.execute(createExecutionInput({ timeoutMs: 100 }));
    const elapsedMs = Date.now() - startedAt;

    // Bounded: returns well within a generous slack, never the 100ms provider "run".
    assert.ok(elapsedMs < 5_000, `execute must return within the hard bound, took ${elapsedMs}ms`);
    // Deterministic timeout truth (not a cancellation) so retry stays available.
    assert.equal(outcome.terminalEvent!.type, 'execution.timed_out');
    assert.equal(outcome.result.process.timedOut, true);
    assert.equal(outcome.result.process.cancelled, false);
    assert.equal(outcome.result.provider.errorCode, 'EXECUTION_TIMEOUT');
    assert.equal(outcome.terminalAttemptStatus, 'failed');
    // The Attempt is durably terminalized, never left running.
    assert.equal(store.getAttempt('attempt-1')?.status, 'failed');
    // Process-tree termination was requested through the existing adapter/runner
    // abstraction (ProcessRunner → Windows taskkill /T /F).
    assert.deepEqual(adapter.cancelRequests, ['attempt-1']);
    // No duplicate provider execution and no leftover in-flight execution.
    assert.equal(executeCalls, 1);
    assert.equal(adapter.executeRequests.length, 1);
    assert.deepEqual(executor.getActiveAttemptIds(), []);
    // Durable evidence classifies as the retryable execution-timeout cause the
    // Supervisor's existing retry policy recognizes.
    const durableAttempt = store.getAttempt('attempt-1');
    assert.ok(durableAttempt);
    assert.deepEqual(classifyAttemptFailure(store, durableAttempt), { cause: 'execution-timeout' });
  } finally {
    store.close();
  }
});

test('executor: hard timeout ignores a late provider result and does not double-terminalize the Attempt', async () => {
  const dbPath = await createTempDbPath('orch-hardtimeout-late-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    // The provider only "resolves" (with a success) when cancelled — i.e. late,
    // after the executor has already committed to a timeout. That late success
    // must be ignored: the timeout terminalization wins and is written once.
    const late = createDeferred<ExecutionResult>();
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () => await late.promise,
      onCancel: () => late.resolve(createExecutionResult()),
    });
    const executor = createExecutor(store, [adapter], { executionHardGraceMs: 50 });

    const outcome = await executor.execute(createExecutionInput({ timeoutMs: 100 }));

    assert.equal(outcome.terminalEvent!.type, 'execution.timed_out');
    assert.equal(outcome.terminalAttemptStatus, 'failed');
    assert.equal(store.getAttempt('attempt-1')?.status, 'failed');
    // Exactly one terminal execution event was persisted (no double terminalize).
    const terminalEvents = store
      .listEvents()
      .filter((event) => event.type.startsWith('execution.') && event.type !== 'execution.started');
    assert.equal(terminalEvents.length, 1);
    assert.equal(terminalEvents[0]?.type, 'execution.timed_out');
    assert.deepEqual(executor.getActiveAttemptIds(), []);
  } finally {
    store.close();
  }
});

test('executor: output-limit, protocol, and spawn failures map Attempt failed', async () => {
  const cases: Array<{ name: string; errorCode: ProviderErrorCode }> = [
    { name: 'output-limit', errorCode: 'OUTPUT_LIMIT_EXCEEDED' },
    { name: 'protocol', errorCode: 'PROTOCOL_ERROR' },
    { name: 'spawn', errorCode: 'PROCESS_SPAWN_FAILED' },
  ];

  for (const testCase of cases) {
    const dbPath = await createTempDbPath(`orch3f-${testCase.name}-`);
    const store = createStore({ dbPath });
    seedRunningAttempt(store);

    try {
      const adapter = new FakeAdapter({
        id: 'codex',
        onExecute: async (request) =>
          createExecutionResult({
            executionId: request.executionId,
            provider: {
              terminalState: 'failed',
              success: false,
              errorCode: testCase.errorCode,
              errorMessage: testCase.name,
            },
          }),
      });
      const executor = createExecutor(store, [adapter]);
      const outcome = await executor.execute(createExecutionInput());
      assert.equal(outcome.terminalEvent!.type, 'execution.failed');
      assert.equal(store.getAttempt('attempt-1')?.status, 'failed');
    } finally {
      store.close();
    }
  }
});

test('executor: immediate manual cancellation latches before provider launch and resolves cancelled without starting provider', async () => {
  const dbPath = await createTempDbPath('orch3f-cancel-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () => createExecutionResult(),
    });
    const executor = createExecutor(store, [adapter]);

    const runPromise = executor.execute(createExecutionInput());
    assert.equal(executor.cancel('attempt-1'), true);
    const outcome = await runPromise;
    const eventTypes = store.listEvents().map((event) => event.type);

    assert.equal(adapter.executeRequests.length, 0);
    assert.deepEqual(adapter.cancelRequests, []);
    assert.equal(outcome.startedEvent, null);
    assert.equal(outcome.terminalEvent!.type, 'execution.cancelled');
    assert.equal(outcome.terminalAttemptStatus, 'cancelled');
    assert.equal(outcome.result.process.cancelled, true);
    assert.equal(eventTypes.includes('policy.baseline.captured'), true);
    assert.equal(eventTypes.includes('execution.started'), false);
    assert.equal(store.getAttempt('attempt-1')?.status, 'cancelled');
    assert.equal(store.getTask('task-1')?.status, 'running');
    assert.deepEqual(executor.getActiveAttemptIds(), []);
  } finally {
    store.close();
  }
});

test('executor: cancellation during deferred policy baseline is retained and prevents provider start', async () => {
  const dbPath = await createTempDbPath('orch4b-cancel-baseline-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const input = createExecutionInput();
    const baseline = await createNoOpPolicyBaseline(store, input);
    const baselineDeferred = createDeferred<typeof baseline>();
    const policyController = {
      ...createNoOpAttemptPolicyController(),
      captureBaseline: async () => await baselineDeferred.promise,
    };
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () => createExecutionResult(),
    });
    const executor = createExecutor(store, [adapter], { policyController });

    const runPromise = executor.execute(input);
    assert.equal(executor.cancel('attempt-1'), true);
    assert.deepEqual(executor.getActiveAttemptIds(), ['attempt-1']);

    baselineDeferred.resolve(baseline);
    const outcome = await runPromise;
    const eventTypes = store.listEvents().map((event) => event.type);

    assert.equal(adapter.executeRequests.length, 0);
    assert.deepEqual(adapter.cancelRequests, []);
    assert.equal(outcome.startedEvent, null);
    assert.equal(outcome.terminalEvent!.type, 'execution.cancelled');
    assert.equal(outcome.terminalAttemptStatus, 'cancelled');
    assert.equal(eventTypes.includes('policy.baseline.captured'), true);
    assert.equal(eventTypes.includes('execution.started'), false);
    assert.equal(store.getAttempt('attempt-1')?.status, 'cancelled');
  } finally {
    store.close();
  }
});

test('executor: cancellation after provider start delegates to adapter and resolves cancelled', async () => {
  const dbPath = await createTempDbPath('orch4b-cancel-running-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const providerStarted = createDeferred<void>();
    const providerFinished = createDeferred<ExecutionResult>();
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () => {
        providerStarted.resolve();
        return await providerFinished.promise;
      },
      onCancel: () => {
        providerFinished.resolve(createCancelledExecutionResult());
      },
    });
    const executor = createExecutor(store, [adapter]);

    const runPromise = executor.execute(createExecutionInput());
    await providerStarted.promise;
    assert.equal(executor.cancel('attempt-1'), true);
    const outcome = await runPromise;

    assert.equal(adapter.executeRequests.length, 1);
    assert.deepEqual(adapter.cancelRequests, ['attempt-1']);
    assert.equal(outcome.startedEvent?.type, 'execution.started');
    assert.equal(outcome.terminalEvent!.type, 'execution.cancelled');
    assert.equal(outcome.terminalAttemptStatus, 'cancelled');
    assert.equal(store.getAttempt('attempt-1')?.status, 'cancelled');
  } finally {
    store.close();
  }
});

test('executor: repeated cancellation remains idempotent once the provider is active', async () => {
  const dbPath = await createTempDbPath('orch4b-cancel-repeat-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const providerStarted = createDeferred<void>();
    const providerFinished = createDeferred<ExecutionResult>();
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () => {
        providerStarted.resolve();
        return await providerFinished.promise;
      },
      onCancel: () => {
        providerFinished.resolve(createCancelledExecutionResult());
      },
    });
    const executor = createExecutor(store, [adapter]);

    const runPromise = executor.execute(createExecutionInput());
    await providerStarted.promise;

    assert.equal(executor.cancel('attempt-1'), true);
    assert.equal(executor.cancel('attempt-1'), true);
    assert.equal(executor.cancel('attempt-1'), true);

    const outcome = await runPromise;

    assert.deepEqual(adapter.cancelRequests, ['attempt-1']);
    assert.equal(store.listEvents().filter((event) => event.type === 'execution.cancelled').length, 1);
    assert.equal(outcome.terminalAttemptStatus, 'cancelled');
    assert.equal(store.getAttempt('attempt-1')?.status, 'cancelled');
  } finally {
    store.close();
  }
});

test('executor: Codex reportedModel null stays null in durable payload', async () => {
  const dbPath = await createTempDbPath('orch3f-codex-model-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () =>
        createExecutionResult({
          model: {
            requestedModel: 'gpt-5.6',
            reportedModel: null,
            reportedModelSource: 'none',
          },
        }),
    });
    const executor = createExecutor(store, [adapter]);
    await executor.execute(createExecutionInput());

    const terminalPayload = store.listEvents().find((event) => event.type === 'execution.completed')?.payload as Record<string, unknown>;
    assert.equal(terminalPayload.reportedModel, undefined);
    assert.equal(terminalPayload.reportedModelSource, 'none');
  } finally {
    store.close();
  }
});

test('executor: Claude requestedModel and reportedModel remain distinct with usage provenance preserved', async () => {
  const dbPath = await createTempDbPath('orch3f-claude-provenance-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const adapter = new FakeAdapter({
      id: 'claude',
      onExecute: async () =>
        createExecutionResult({
          model: {
            requestedModel: 'requested-model-A',
            reportedModel: 'reported-model-B',
            reportedModelSource: 'protocol-message',
          },
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            cachedInputTokens: 5,
            reasoningTokens: 3,
            totalTokens: 26,
            source: 'protocol-message',
          },
        }),
    });
    const executor = createExecutor(store, [adapter]);

    await executor.execute(createExecutionInput({ provider: 'claude' }));
    const terminalPayload = store.listEvents().find((event) => event.type === 'execution.completed')?.payload as Record<string, any>;

    assert.equal(terminalPayload.requestedModel, 'requested-model-A');
    assert.equal(terminalPayload.reportedModel, 'reported-model-B');
    assert.equal(terminalPayload.reportedModelSource, 'protocol-message');
    assert.equal(terminalPayload.usage.source, 'protocol-message');
    assert.equal('quotaRemaining' in terminalPayload, false);
  } finally {
    store.close();
  }
});

test('executor: terminal event payload excludes prompt, environment, and transcript-sized content and stays under the ORCH-2 limit', async () => {
  let terminalPayloadBytes = 0;
  const dbPath = await createTempDbPath('orch3f-payload-');
  const store = createStore({
    dbPath,
    testHooks: {
      beforeEventInsert: (event) => {
        if (event.type === 'execution.completed' || event.type === 'execution.failed') {
          terminalPayloadBytes = Buffer.byteLength(event.payloadText ?? '', 'utf8');
        }
      },
    },
  });
  seedRunningAttempt(store);

  try {
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () =>
        createExecutionResult({
          output: {
            finalText: 'x'.repeat(64 * 1024),
          },
        }),
    });
    const executor = createExecutor(store, [adapter]);
    const prompt = 'secret prompt body';
    await executor.execute(createExecutionInput({ prompt }));

    const payload = JSON.stringify(store.listEvents().at(-2)?.payload);
    assert.equal(payload.includes(prompt), false);
    assert.equal(payload.includes('OPENAI_API_KEY'), false);
    assert.equal(payload.includes(String(process.env.PATH ?? 'UNSET')), false);
    assert.ok(terminalPayloadBytes <= TEXT_FIELD_MAX_BYTES);
  } finally {
    store.close();
  }
});

test('executor: unknown provider is rejected before adapter invocation and fails the Attempt durably', async () => {
  const dbPath = await createTempDbPath('orch3f-unknown-provider-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const adapter = new FakeAdapter({ id: 'codex' });
    const executor = createExecutor(store, [adapter]);
    const outcome = await executor.execute(createExecutionInput({ provider: 'cursor-agent' }));

    assert.equal(adapter.executeRequests.length, 0);
    assert.equal(outcome.result.provider.errorCode, 'PROVIDER_UNAVAILABLE');
    assert.equal(store.getAttempt('attempt-1')?.status, 'failed');
  } finally {
    store.close();
  }
});

test('executor: same Attempt concurrent double-start is rejected deterministically', async () => {
  const dbPath = await createTempDbPath('orch3f-double-start-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const deferred = createDeferred<ExecutionResult>();
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () => await deferred.promise,
    });
    const executor = createExecutor(store, [adapter]);

    const firstRun = executor.execute(createExecutionInput());
    assert.throws(
      () => executor.execute(createExecutionInput()),
      (error: unknown) => error instanceof AttemptExecutorError && error.code === 'ATTEMPT_ALREADY_ACTIVE',
    );

    deferred.resolve(createExecutionResult());
    await firstRun;

    assert.deepEqual(
      store.listEvents().filter((event) => event.type === 'execution.started').length,
      1,
    );
  } finally {
    store.close();
  }
});

test('executor: terminal Attempt cannot execute again', async () => {
  const dbPath = await createTempDbPath('orch3f-terminal-replay-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);
  store.transitionAttempt('attempt-1', 'passed');

  try {
    const executor = createExecutor(store, [new FakeAdapter({ id: 'codex' })]);
    assert.throws(
      () => executor.execute(createExecutionInput()),
      (error: unknown) => error instanceof OrchestrationError && error.code === 'INVALID_TRANSITION',
    );
  } finally {
    store.close();
  }
});

test('executor: active execution map is cleaned after success, provider failure, and adapter throw', async () => {
  const scenarios: Array<{
    name: string;
    onExecute: (request: ExecutionRequest) => Promise<ExecutionResult> | ExecutionResult;
  }> = [
    { name: 'success', onExecute: async () => createExecutionResult() },
    {
      name: 'provider-failure',
      onExecute: async () =>
        createExecutionResult({
          provider: {
            terminalState: 'failed',
            success: false,
            errorCode: 'PROVIDER_ERROR',
            errorMessage: 'failed',
          },
        }),
    },
    {
      name: 'throw',
      onExecute: async () => {
        throw new Error('adapter exploded');
      },
    },
  ];

  for (const scenario of scenarios) {
    const dbPath = await createTempDbPath(`orch3f-active-${scenario.name}-`);
    const store = createStore({ dbPath });
    seedRunningAttempt(store);

    try {
      const executor = createExecutor(store, [new FakeAdapter({ id: 'codex', onExecute: scenario.onExecute })]);
      await executor.execute(createExecutionInput());
      assert.deepEqual(executor.getActiveAttemptIds(), []);
    } finally {
      store.close();
    }
  }
});

test('executor: cancellation targets only the selected Attempt and missing/completed cancels are safe', async () => {
  const dbPath = await createTempDbPath('orch3f-cancel-target-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store, { attemptId: 'attempt-1', taskId: 'task-1', runId: 'run-1' });
  store.createTask({ taskId: 'task-2', runId: 'run-1', title: 'Task task-2' });
  store.createAttempt({ attemptId: 'attempt-2', taskId: 'task-2', hostInstanceId: 'host-instance-1' });

  try {
    const firstStarted = createDeferred<void>();
    const secondStarted = createDeferred<void>();
    const firstDeferred = createDeferred<ExecutionResult>();
    const secondDeferred = createDeferred<ExecutionResult>();
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async (request) => {
        if (request.attemptId === 'attempt-1') {
          firstStarted.resolve();
          return await firstDeferred.promise;
        }
        secondStarted.resolve();
        return await secondDeferred.promise;
      },
      onCancel: (executionId) => {
        if (executionId === 'attempt-2') {
          secondDeferred.resolve(createCancelledExecutionResult({ executionId }));
        }
      },
    });
    const executor = createExecutor(store, [adapter]);

    const first = executor.execute(createExecutionInput({ attemptId: 'attempt-1' }));
    const second = executor.execute(createExecutionInput({ attemptId: 'attempt-2', taskId: 'task-2' }));
    await Promise.all([firstStarted.promise, secondStarted.promise]);

    assert.equal(executor.cancel('missing-attempt'), false);
    assert.equal(executor.cancel('attempt-2'), true);

    firstDeferred.resolve(createExecutionResult({ executionId: 'attempt-1' }));
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    assert.deepEqual(adapter.cancelRequests, ['attempt-2']);
    assert.equal(firstOutcome.terminalAttemptStatus, 'passed');
    assert.equal(secondOutcome.terminalAttemptStatus, 'cancelled');
    assert.equal(executor.cancel('attempt-1'), false);
  } finally {
    store.close();
  }
});

test('executor: execution.started persistence failure prevents provider invocation and fails closed', async () => {
  const dbPath = await createTempDbPath('orch3f-start-event-fail-');
  const store = createStore({
    dbPath,
    testHooks: {
      beforeEventInsert: (event) => {
        if (event.type === 'execution.started') {
          throw new Error('start event blocked');
        }
      },
    },
  });
  seedRunningAttempt(store);

  try {
    const adapter = new FakeAdapter({ id: 'codex' });
    const executor = createExecutor(store, [adapter]);

    // Fail closed: the provider never launched, so the Attempt must be
    // terminalized as failed — never left durably running for a restart
    // recovery that may never come.
    const outcome = await executor.execute(createExecutionInput());

    assert.equal(adapter.executeRequests.length, 0);
    assert.equal(outcome.terminalAttemptStatus, 'failed');
    assert.equal(outcome.attempt.status, 'failed');
    assert.equal(outcome.result.provider.success, false);
    assert.equal(store.getAttempt('attempt-1')?.status, 'failed');
    assert.equal(store.listEvents().some((event) => event.type === 'execution.started'), false);
    const evidence = store.listEvents().find((event) => event.type === 'execution.persistence.failed');
    assert.ok(evidence, 'bounded failure evidence must be durable');
    assert.equal((evidence?.payload as Record<string, unknown>).errorCode, 'EVENT_PERSIST_FAILED');
  } finally {
    store.close();
  }
});

test('executor: terminal event write failure fails closed and terminalizes the Attempt', async () => {
  const dbPath = await createTempDbPath('orch3f-terminal-event-fail-');
  const store = createStore({
    dbPath,
    testHooks: {
      beforeEventInsert: (event) => {
        if (event.type === 'execution.completed') {
          throw new Error('terminal event blocked');
        }
      },
    },
  });
  seedRunningAttempt(store);

  try {
    const executor = createExecutor(store, [new FakeAdapter({ id: 'codex' })]);

    // The provider DID return, so the Attempt must never remain durably
    // running: the failure is captured deterministically and control returns.
    const outcome = await executor.execute(createExecutionInput());

    assert.equal(outcome.terminalAttemptStatus, 'failed');
    assert.equal(outcome.attempt.status, 'failed');
    assert.equal(outcome.result.provider.success, true, 'the real provider result is preserved');
    assert.equal(store.getAttempt('attempt-1')?.status, 'failed');
    assert.equal(store.listEvents().some((event) => event.type === 'execution.started'), true);
    assert.equal(store.listEvents().some((event) => event.type === 'execution.completed'), false);
    assert.equal(store.listEvents().some((event) => event.type === 'policy.evaluated'), false);
    const evidence = store.listEvents().find((event) => event.type === 'execution.persistence.failed');
    assert.ok(evidence, 'bounded failure evidence must be durable');
    assert.equal((evidence?.payload as Record<string, unknown>).errorCode, 'EVENT_PERSIST_FAILED');
  } finally {
    store.close();
  }
});

test('executor: Attempt transition failure is surfaced after terminal event durability', async () => {
  const dbPath = await createTempDbPath('orch3f-transition-fail-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const originalTransitionAttempt = store.transitionAttempt.bind(store);
    (store as any).transitionAttempt = (_attemptId: string, _status: string) => {
      throw new Error('transition blocked');
    };

    const executor = createExecutor(store, [new FakeAdapter({ id: 'codex' })]);
    await assert.rejects(
      executor.execute(createExecutionInput()),
      (error: unknown) => error instanceof AttemptExecutorError && error.code === 'ATTEMPT_TRANSITION_FAILED',
    );

    (store as any).transitionAttempt = originalTransitionAttempt;
    assert.equal(store.listEvents().some((event) => event.type === 'execution.completed'), true);
    assert.equal(store.getAttempt('attempt-1')?.status, 'running');
  } finally {
    store.close();
  }
});

test('executor: adapter throw does not crash execution and records execution.failed durably', async () => {
  const dbPath = await createTempDbPath('orch3f-throw-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const executor = createExecutor(
      store,
      [
        new FakeAdapter({
          id: 'codex',
          onExecute: async () => {
            throw new Error('adapter exploded');
          },
        }),
      ],
    );

    const outcome = await executor.execute(createExecutionInput());
    assert.equal(outcome.result.provider.errorCode, 'PROVIDER_ERROR');
    assert.equal(store.getAttempt('attempt-1')?.status, 'failed');
    assert.equal(store.listEvents().some((event) => event.type === 'execution.failed'), true);
  } finally {
    store.close();
  }
});

test('executor: no Task transition method is used during execution coordination', async () => {
  const dbPath = await createTempDbPath('orch3f-no-task-transition-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);
  let transitionTaskCalls = 0;

  try {
    const originalTransitionTask = store.transitionTask.bind(store);
    (store as any).transitionTask = (...args: unknown[]) => {
      transitionTaskCalls += 1;
      return originalTransitionTask(...args as [string, any]);
    };

    const executor = createExecutor(store, [new FakeAdapter({ id: 'codex' })]);
    await executor.execute(createExecutionInput());
    assert.equal(transitionTaskCalls, 0);
    assert.equal(store.getTask('task-1')?.status, 'running');
  } finally {
    store.close();
  }
});

test('executor: provider session ID and process facts are preserved in the terminal payload', async () => {
  const dbPath = await createTempDbPath('orch3f-session-process-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const executor = createExecutor(
      store,
      [
        new FakeAdapter({
          id: 'codex',
          onExecute: async () =>
            createExecutionResult({
              session: { sessionId: 'thread-123' },
              process: {
                exitCode: 23,
                signal: 'SIGTERM',
                timedOut: false,
                cancelled: false,
              },
            }),
        }),
      ],
    );
    await executor.execute(createExecutionInput());

    const payload = store.listEvents().find((event) => event.type === 'execution.completed')?.payload as Record<string, any>;
    assert.equal(payload.sessionId, 'thread-123');
    assert.equal(payload.process.exitCode, 23);
    assert.equal(payload.process.signal, 'SIGTERM');
  } finally {
    store.close();
  }
});

test('executor: persistence smoke passes across reopen with execution.started and execution.completed', async () => {
  const dbPath = await createTempDbPath('orch3f-persistence-pass-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const executor = createExecutor(
      store,
      [
        new FakeAdapter({
          id: 'codex',
          onExecute: async () =>
            createExecutionResult({
              usage: {
                inputTokens: 10,
                outputTokens: 5,
                source: 'protocol-message',
              },
            }),
        }),
      ],
    );
    await executor.execute(createExecutionInput());
  } finally {
    store.close();
  }

  const reopened = createStore({ dbPath });
  try {
    assert.equal(reopened.getAttempt('attempt-1')?.status, 'passed');
    assert.equal(reopened.getTask('task-1')?.status, 'running');
    const eventTypes = reopened.listEvents().map((event) => event.type);
    assert.equal(eventTypes.includes('execution.started'), true);
    assert.equal(eventTypes.includes('execution.completed'), true);
    const terminalPayload = reopened.listEvents().find((event) => event.type === 'execution.completed')?.payload as Record<string, any>;
    assert.equal(terminalPayload.reportedModelSource, 'none');
    assert.equal(terminalPayload.usage.source, 'protocol-message');
  } finally {
    reopened.close();
  }
});

test('executor: failure persistence smoke passes across reopen with execution.failed and no retry', async () => {
  const dbPath = await createTempDbPath('orch3f-persistence-fail-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const executor = createExecutor(
      store,
      [
        new FakeAdapter({
          id: 'codex',
          onExecute: async () =>
            createExecutionResult({
              provider: {
                terminalState: 'failed',
                success: false,
                errorCode: 'PROVIDER_ERROR',
                errorMessage: 'boom',
              },
            }),
        }),
      ],
    );
    await executor.execute(createExecutionInput());
  } finally {
    store.close();
  }

  const reopened = createStore({ dbPath });
  try {
    assert.equal(reopened.getAttempt('attempt-1')?.status, 'failed');
    assert.equal(reopened.getTask('task-1')?.status, 'running');
    const eventTypes = reopened.listEvents().map((event) => event.type);
    assert.equal(eventTypes.includes('execution.failed'), true);
    assert.equal(reopened.listAttempts('task-1').length, 1);
  } finally {
    reopened.close();
  }
});

test('executor: interrupted recovery marks stale running attempts interrupted but leaves current-host attempts and Tasks running', async () => {
  const dbPath = await createTempDbPath('orch3f-recovery-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store, { runId: 'run-1', taskId: 'task-old', attemptId: 'attempt-old', hostInstanceId: 'old-host' });
  store.createTask({ taskId: 'task-current', runId: 'run-1', title: 'Current task' });
  store.createAttempt({ attemptId: 'attempt-current', taskId: 'task-current', hostInstanceId: 'live-host' });

  try {
    const recovered = recoverInterruptedAttempts(store, 'live-host');
    assert.deepEqual(recovered.map((attempt) => attempt.attemptId), ['attempt-old']);
    assert.equal(store.getAttempt('attempt-old')?.status, 'interrupted');
    assert.equal(store.getAttempt('attempt-current')?.status, 'running');
    assert.equal(store.getTask('task-old')?.status, 'running');
    assert.equal(store.getTask('task-current')?.status, 'running');
  } finally {
    store.close();
  }
});

test('executor: provider registry creates Claude, Codex, and Ollama adapters from discovery records', () => {
  const registry = createProviderRegistry([
    {
      toolId: 'claude-code',
      displayName: 'Claude Code',
      kind: 'provider',
      command: 'claude',
      harnessKind: 'native-executable',
      resolvedPath: 'C:\\Tools\\claude.exe',
      installed: true,
      workerCapable: true,
      discoveredAt: '2026-08-24T00:00:00.000Z',
    },
    {
      toolId: 'codex-cli',
      displayName: 'Codex CLI',
      kind: 'provider',
      command: 'codex',
      harnessKind: 'cmd-wrapper',
      resolvedPath: 'C:\\Tools\\codex.cmd',
      installed: true,
      workerCapable: true,
      discoveredAt: '2026-08-24T00:00:00.000Z',
    },
    {
      toolId: 'ollama-cli',
      displayName: 'Ollama CLI',
      kind: 'provider',
      command: 'ollama',
      harnessKind: 'native-executable',
      resolvedPath: 'C:\\Tools\\ollama.exe',
      installed: true,
      workerCapable: true,
      discoveredAt: '2026-08-24T00:00:00.000Z',
    },
  ]);

  assert.equal(registry.has('claude'), true);
  assert.equal(registry.has('codex'), true);
  assert.equal(registry.has('ollama'), true);
});

test('executor shutdown cancels an Attempt waiting on policy baseline and resolves without launching the provider', async () => {
  const dbPath = await createTempDbPath('orch4b-shutdown-baseline-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const input = createExecutionInput();
    const baseline = await createNoOpPolicyBaseline(store, input);
    const baselineDeferred = createDeferred<typeof baseline>();
    const policyController = {
      ...createNoOpAttemptPolicyController(),
      captureBaseline: async () => await baselineDeferred.promise,
    };
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () => createExecutionResult(),
    });
    const executor = createExecutor(store, [adapter], {
      shutdownTimeoutMs: 250,
      policyController,
    });

    const runPromise = executor.execute(input);
    const shutdownPromise = executor.shutdown();

    baselineDeferred.resolve(baseline);
    const [outcome, shutdownResult] = await Promise.all([runPromise, shutdownPromise]);

    assert.equal(adapter.executeRequests.length, 0);
    assert.deepEqual(adapter.cancelRequests, []);
    assert.equal(outcome.terminalAttemptStatus, 'cancelled');
    assert.equal(shutdownResult.timedOut, false);
    assert.equal(shutdownResult.remainingActiveAttempts, 0);
  } finally {
    store.close();
  }
});

test('executor shutdown cancels an Attempt after provider start via the adapter path', async () => {
  const dbPath = await createTempDbPath('orch4b-shutdown-provider-');
  const store = createStore({ dbPath });
  seedRunningAttempt(store);

  try {
    const providerStarted = createDeferred<void>();
    const providerFinished = createDeferred<ExecutionResult>();
    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: async () => {
        providerStarted.resolve();
        return await providerFinished.promise;
      },
      onCancel: () => {
        providerFinished.resolve(createCancelledExecutionResult());
      },
    });
    const executor = createExecutor(store, [adapter], { shutdownTimeoutMs: 250 });

    const runPromise = executor.execute(createExecutionInput());
    await providerStarted.promise;
    const shutdownPromise = executor.shutdown();
    const [outcome, shutdownResult] = await Promise.all([runPromise, shutdownPromise]);

    assert.deepEqual(adapter.cancelRequests, ['attempt-1']);
    assert.equal(outcome.terminalAttemptStatus, 'cancelled');
    assert.equal(shutdownResult.timedOut, false);
    assert.equal(shutdownResult.remainingActiveAttempts, 0);
  } finally {
    store.close();
  }
});

test('host shutdown helper preserves stopping -> executor drain -> stopped -> lock release ordering', async () => {
  const steps: string[] = [];

  await shutdownHostRuntime({
    refreshRepoStatusIfNeeded: async () => {
      steps.push('refresh');
    },
    writeCurrentHeartbeat: async (state) => {
      steps.push(`heartbeat:${state}`);
    },
    appendLifecycleEvent: async (type) => {
      steps.push(`event:${type}`);
    },
    executorShutdown: async () => {
      steps.push('executor-shutdown');
    },
    releaseLock: async () => {
      steps.push('release-lock');
    },
    finishProcess: async (exitCode) => {
      steps.push(`finish:${exitCode}`);
    },
    now: () => new Date('2026-08-24T01:00:00.000Z'),
  });

  assert.deepEqual(steps, [
    'refresh',
    'heartbeat:stopping',
    'event:host.stopping',
    'executor-shutdown',
    'event:host.stopped',
    'heartbeat:stopped',
    'release-lock',
    'finish:0',
  ]);
});

test('executor regression: verifier policy event persistence failure fails closed, terminalizes, and returns control to the Supervisor', async () => {
  // Reproduces the real V2 smoke-run failure: the provider (verifier) returned
  // successfully, adjudication completed, but persisting `policy.evaluated`
  // threw — and the exception left the Attempt durably RUNNING with nothing
  // to ever reconcile it. The fail-closed contract: the real provider result
  // is preserved as evidence, the Attempt terminalizes as failed, the failure
  // is captured durably, supervisorTick regains control, and nothing is
  // re-executed, applied, or fabricated as a pass.
  const dbPath = await createTempDbPath('orch5h-verifier-policy-persist-fail-');
  const store = createStore({
    dbPath,
    testHooks: {
      beforeEventInsert: (event) => {
        if (event.type === 'policy.evaluated') {
          throw new Error('policy event blocked');
        }
      },
    },
  });

  try {
    store.createRun({ runId: 'run-1', title: 'Run' });
    store.createTask({
      taskId: 'task-impl',
      runId: 'run-1',
      title: 'implement',
      goal: 'implement',
      spec: { policy: { authorizedWritePaths: [CONTROL_TOWER_UI_SMOKE_PATH] } },
    });
    store.createTask({
      taskId: 'task-1',
      runId: 'run-1',
      title: 'verify',
      goal: 'verify',
      spec: {
        control: { provider: 'codex', requestedModel: null, permissionProfile: 'verifier', prompt: 'Verify the work.', timeoutMs: 600_000 },
        policy: { authorizedWritePaths: [] },
        workingDirectory: 'C:\\Repo\\PowerOn',
      } as never,
    });
    store.addDependency('task-1', 'task-impl');
    store.createAttempt({ attemptId: 'attempt-impl', taskId: 'task-impl', hostInstanceId: 'host-instance-1' });
    store.transitionAttempt('attempt-impl', 'passed');
    store.transitionTask('task-impl', 'passed');
    const workspaceRoot = path.join(path.dirname(dbPath), 'workspaces');
    const candidatePath = path.join(workspaceRoot, 'repo-key', 'run-1', 'attempt-impl');
    await mkdir(path.join(candidatePath, 'agent-host', 'smoke'), { recursive: true });
    await writeFile(path.join(candidatePath, CONTROL_TOWER_UI_SMOKE_PATH), `${CONTROL_TOWER_UI_SMOKE_LINE}\n`);
    store.appendEvent({
      eventId: 'workspace-ready-impl',
      runId: 'run-1',
      taskId: 'task-impl',
      attemptId: 'attempt-impl',
      type: 'workspace.changeset.ready',
      payload: { baselineHeadSha: 'a'.repeat(40), changeCount: 1, workspaceState: 'cleanup-eligible' },
    });

    const adapter = new FakeAdapter({
      id: 'codex',
      onExecute: (request) => createExecutionResult({
        executionId: request.executionId,
        output: { finalText: 'all checks pass\nVERDICT: PASS' },
      }),
    });
    const executor = createExecutor(store, [adapter], {
      workspaceConfig: { canonicalRepoPath: path.join(path.dirname(dbPath), 'repo'), workspaceRoot, repoKey: 'repo-key' },
    });
    const port = new ProductionExecutionPort({ store, executor });

    const tick = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: 'host-instance-1',
      executionPort: port,
      idGenerator: () => 'attempt-1',
    });

    // supervisorTick regains control: the tick completed without the exception
    // escaping, and the existing failure policy (unknown cause is
    // non-retryable) failed the Task and the Run.
    assert.equal(tick.outcome, 'task-executed');
    assert.equal(tick.taskAction?.type, 'MARK_TASK_FAILED');
    assert.equal(tick.run.status, 'failed');
    assert.equal(store.getTask('task-1')?.status, 'failed');

    // The Attempt is terminal — never durably running.
    const attempt = store.getAttempt('attempt-1');
    assert.equal(attempt?.status, 'failed');

    // The provider really returned and the durable evidence was preserved.
    assert.equal(store.listEvents().some((event) => event.type === 'execution.started'), true);
    assert.equal(store.listEvents().some((event) => event.type === 'execution.completed'), true);
    assert.equal(store.listEvents().some((event) => event.type === 'policy.evaluated'), false);
    const evidence = store.listEvents().find((event) => event.type === 'execution.persistence.failed');
    assert.ok(evidence, 'the persistence failure must be captured deterministically');
    assert.equal((evidence?.payload as Record<string, unknown>).errorCode, 'EVENT_PERSIST_FAILED');

    // No fabricated pass and no auto-apply: the verifier attempt readies no
    // changeset, and the durable verdict pairs the provider text with the
    // failed attempt status.
    assert.equal(store.listEvents().some((event) => event.type === 'workspace.changeset.ready' && event.attemptId === 'attempt-1'), false);
    const verdict = store.listEvents().find((event) => event.type === VERIFIER_VERDICT_EVENT);
    assert.ok(verdict);
    assert.equal((verdict?.payload as Record<string, unknown>).attemptStatus, 'failed');

    // No duplicate execution: a terminal Run is never re-driven.
    const second = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: 'host-instance-1',
      executionPort: port,
    });
    assert.equal(second.outcome, 'run-terminal');
    assert.equal(adapter.executeRequests.length, 1);
  } finally {
    store.close();
  }
});
