import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  buildDispatchSummary,
  dispatchAttempt,
  getDispatchCliArgs,
  parseDispatchArgs,
  readPromptFromStdin,
  runDispatchCommand,
  type DispatchCommandDependencies,
  type DispatchCommandOptions,
  type DispatchExecutor,
} from './dispatch.ts';
import { openOrchestrationStore } from './lib/store.ts';
import { resolveStatePaths } from './lib/statePaths.ts';
import type { OrchestrationStore } from './lib/store.ts';
import type { AttemptRecord, TaskRecord } from './lib/orchestrationTypes.ts';
import { AttemptExecutor, type AttemptExecutionOutcome } from './providers/executor.ts';
import type { ExecutionRequest, ExecutionResult, ProviderAdapter, ProviderId, ProviderProbeResult } from './providers/types.ts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

class FakeAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  readonly executeRequests: ExecutionRequest[] = [];
  readonly cancelRequests: string[] = [];
  private readonly onExecute?: ((request: ExecutionRequest) => Promise<ExecutionResult> | ExecutionResult) | undefined;
  private readonly onCancel?: ((executionId: string) => void) | undefined;

  constructor(options: {
    id: ProviderId;
    onExecute?: ((request: ExecutionRequest) => Promise<ExecutionResult> | ExecutionResult) | undefined;
    onCancel?: ((executionId: string) => void) | undefined;
  }) {
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
      return createExecutionResult({ executionId: request.executionId });
    }
    return await this.onExecute(request);
  }

  cancel(executionId: string): void {
    this.cancelRequests.push(executionId);
    this.onCancel?.(executionId);
  }
}

class FakeExecutor implements DispatchExecutor {
  readonly executeCalls: ExecutionRequest[] = [];
  readonly cancelCalls: string[] = [];
  shutdownCalls = 0;
  private readonly onExecute: (input: any) => Promise<AttemptExecutionOutcome>;
  private readonly onCancel?: ((attemptId: string) => void) | undefined;

  constructor(options: {
    onExecute: (input: any) => Promise<AttemptExecutionOutcome>;
    onCancel?: ((attemptId: string) => void) | undefined;
  }) {
    this.onExecute = options.onExecute;
    this.onCancel = options.onCancel;
  }

  async execute(input: any): Promise<AttemptExecutionOutcome> {
    this.executeCalls.push(input);
    return await this.onExecute(input);
  }

  cancel(attemptId: string): boolean {
    this.cancelCalls.push(attemptId);
    this.onCancel?.(attemptId);
    return true;
  }

  async shutdown(): Promise<unknown> {
    this.shutdownCalls += 1;
    return { timedOut: false, remainingActiveAttempts: 0 };
  }
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

function createOutcome(overrides: Partial<ExecutionResult> = {}): AttemptExecutionOutcome {
  return {
    executionId: 'attempt-1',
    attempt: {
      attemptId: 'attempt-1',
      taskId: 'task-1',
      ordinal: 1,
      status: overrides.provider?.success === false ? 'failed' : 'passed',
      hostInstanceId: 'dispatch-host-1',
      createdAt: '2026-08-24T01:00:00.000Z',
      startedAt: '2026-08-24T01:00:00.000Z',
      endedAt: '2026-08-24T01:00:01.000Z',
    },
    result: createExecutionResult(overrides),
    startedEvent: {
      seq: 1,
      eventId: 'event-1',
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      type: 'execution.started',
      createdAt: '2026-08-24T01:00:00.000Z',
      payload: {},
    },
    terminalEvent: {
      seq: 2,
      eventId: 'event-2',
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      type: overrides.provider?.success === false ? 'execution.failed' : 'execution.completed',
      createdAt: '2026-08-24T01:00:01.000Z',
      payload: {},
    },
    terminalAttemptStatus: overrides.provider?.success === false ? 'failed' : 'passed',
  };
}

function createDispatchInput(overrides: Partial<DispatchCommandOptions> = {}): DispatchCommandOptions {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    provider: 'codex',
    requestedModel: 'gpt-5.6',
    reasoningEffort: 'medium',
    permissionProfile: 'read-only-reviewer',
    prompt: 'Line one\nLine two with unicode: cafe',
    timeoutMs: 45_000,
    json: true,
    ...overrides,
  };
}

function createStoreView(overrides: Partial<{ task: TaskRecord | null; attempt: AttemptRecord | null }> = {}): {
  getTask(taskId: string): TaskRecord | null;
  getAttempt(attemptId: string): AttemptRecord | null;
} {
  const task = overrides.task ?? {
    taskId: 'task-1',
    runId: 'run-1',
    title: 'Task 1',
    goal: null,
    status: 'running',
    position: 0,
    spec: null,
    createdAt: '2026-08-24T01:00:00.000Z',
    updatedAt: '2026-08-24T01:00:00.000Z',
    startedAt: '2026-08-24T01:00:00.000Z',
    completedAt: null,
  };
  const attempt = overrides.attempt ?? {
    attemptId: 'attempt-1',
    taskId: 'task-1',
    ordinal: 1,
    status: 'passed',
    hostInstanceId: 'dispatch-host-1',
    createdAt: '2026-08-24T01:00:00.000Z',
    startedAt: '2026-08-24T01:00:00.000Z',
    endedAt: '2026-08-24T01:00:01.000Z',
  };

  return {
    getTask(taskId: string): TaskRecord | null {
      return taskId === 'task-1' ? task : null;
    },
    getAttempt(attemptId: string): AttemptRecord | null {
      return attemptId === 'attempt-1' ? attempt : null;
    },
  };
}

async function createSeededStore(options: {
  repoPath: string;
  localAppData: string;
  runId?: string;
  taskId?: string;
  attemptId?: string;
  hostInstanceId?: string;
}): Promise<{ statePaths: ReturnType<typeof resolveStatePaths>; dbPath: string; repoKey: string }> {
  const statePaths = resolveStatePaths({
    canonicalRepoPath: options.repoPath,
    localAppData: options.localAppData,
  });
  await mkdir(statePaths.repoStateDir, { recursive: true });

  const store = openOrchestrationStore({
    dbPath: statePaths.orchestrationDbPath,
    repoKey: statePaths.repoKey,
    hostId: 'host-1',
    hostVersion: '0.1.0',
  });

  try {
    const runId = options.runId ?? 'run-1';
    const taskId = options.taskId ?? 'task-1';
    const attemptId = options.attemptId ?? 'attempt-1';
    const hostInstanceId = options.hostInstanceId ?? 'dispatch-host-1';

    store.createRun({ runId, title: `Run ${runId}` });
    store.createTask({ taskId, runId, title: `Task ${taskId}` });
    store.createAttempt({ attemptId, taskId, hostInstanceId });
  } finally {
    store.close();
  }

  return {
    statePaths,
    dbPath: statePaths.orchestrationDbPath,
    repoKey: statePaths.repoKey,
  };
}

async function reopenStore(dbPath: string, repoKey: string): Promise<OrchestrationStore> {
  return openOrchestrationStore({
    dbPath,
    repoKey,
    hostId: 'host-1',
    hostVersion: '0.1.0',
  });
}

function createBaseDependencies(options: {
  repoPath: string;
  localAppData: string;
  createAttemptExecutor?: DispatchCommandDependencies['createAttemptExecutor'];
  createProviderRegistry?: DispatchCommandDependencies['createProviderRegistry'];
  discoverTools?: DispatchCommandDependencies['discoverTools'];
  subscribeToTermination?: DispatchCommandDependencies['subscribeToTermination'];
}): DispatchCommandDependencies {
  return {
    resolveCanonicalRepo: async () => options.repoPath,
    readRepoStatus: async () => ({
      branch: 'main',
      headSha: 'head-sha-1',
      dirty: false,
    }),
    createAttemptExecutor: options.createAttemptExecutor,
    createProviderRegistry: options.createProviderRegistry,
    discoverTools: options.discoverTools ?? (async () => []),
    subscribeToTermination: options.subscribeToTermination ?? (() => () => undefined),
  };
}

async function runDispatchProcess(options: {
  prompt: string;
  localAppData: string;
  cwd: string;
  args: readonly string[];
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', path.join(options.cwd, 'agent-host', 'dispatch.ts'), ...options.args],
    {
      cwd: options.cwd,
      env: {
        ...process.env,
        LOCALAPPDATA: options.localAppData,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  child.stdin.end(options.prompt);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  return { exitCode, stdout, stderr };
}

test('dispatch parser requires explicit provider and permission profile and accepts allowed values', () => {
  for (const profile of ['read-only-reviewer', 'task-implementer', 'verifier'] as const) {
    const parsed = parseDispatchArgs([
      '--run-id', 'run-1',
      '--task-id', 'task-1',
      '--attempt-id', 'attempt-1',
      '--provider', 'codex',
      '--permission-profile', profile,
      '--model', 'gpt-5.6',
      '--json',
    ]);

    assert.equal(parsed.runId, 'run-1');
    assert.equal(parsed.taskId, 'task-1');
    assert.equal(parsed.attemptId, 'attempt-1');
    assert.equal(parsed.provider, 'codex');
    assert.equal(parsed.permissionProfile, profile);
    assert.equal(parsed.requestedModel, 'gpt-5.6');
    assert.equal(parsed.json, true);
  }

  assert.throws(
    () => parseDispatchArgs(['--run-id', 'run-1', '--task-id', 'task-1', '--attempt-id', 'attempt-1', '--provider', 'cursor-agent', '--permission-profile', 'read-only-reviewer']),
    /Unknown provider/u,
  );

  assert.throws(
    () => parseDispatchArgs(['--run-id', 'run-1', '--task-id', 'task-1', '--attempt-id', 'attempt-1', '--provider', 'codex', '--permission-profile', 'danger-full-access']),
    /Unknown permission profile/u,
  );
});

test('dispatch reads multiline unicode prompt from stdin', async () => {
  const prompt = 'Line one\nLine two\nUnicode: café';
  const stdin = Readable.from([prompt]) as Readable & { isTTY?: boolean };
  stdin.isTTY = false;

  const received = await readPromptFromStdin(stdin);
  assert.equal(received, prompt);
});

test('dispatch entrypoint argv extraction preserves the first user flag and value alignment', () => {
  const cliArgs = getDispatchCliArgs([
    'node',
    'agent-host/dispatch.ts',
    '--run-id', 'run-1',
    '--task-id', 'task-1',
    '--attempt-id', 'attempt-1',
    '--provider', 'codex',
    '--permission-profile', 'read-only-reviewer',
    '--json',
  ]);

  assert.deepEqual(cliArgs, [
    '--run-id', 'run-1',
    '--task-id', 'task-1',
    '--attempt-id', 'attempt-1',
    '--provider', 'codex',
    '--permission-profile', 'read-only-reviewer',
    '--json',
  ]);
  assert.equal(cliArgs[0], '--run-id');
  assert.equal(cliArgs[1], 'run-1');
  assert.equal(cliArgs[2], '--task-id');
  assert.equal(cliArgs[3], 'task-1');
  assert.equal(cliArgs[4], '--attempt-id');
  assert.equal(cliArgs[5], 'attempt-1');
  assert.equal(cliArgs[6], '--provider');
  assert.equal(cliArgs[7], 'codex');
  assert.equal(cliArgs[8], '--permission-profile');
  assert.equal(cliArgs[9], 'read-only-reviewer');
  assert.equal(cliArgs[10], '--json');
});

test('dispatch process-level CLI route gets past argument parsing and still reads the prompt from stdin', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'orch3g-cli-route-'));
  const localAppData = path.join(sandbox, 'localappdata');
  await mkdir(localAppData, { recursive: true });

  const result = await runDispatchProcess({
    cwd: process.cwd(),
    localAppData,
    prompt: 'Do not modify any files. Reply with exactly: AGENT_HOST_SMOKE_OK',
    args: [
      '--run-id', 'run-1',
      '--task-id', 'task-1',
      '--attempt-id', 'attempt-1',
      '--provider', 'codex',
      '--permission-profile', 'read-only-reviewer',
      '--json',
    ],
  });

  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.stderr, /Unknown option run-1/u);
  assert.doesNotMatch(result.stderr, /Missing required option --run-id/u);

  const summary = JSON.parse(result.stdout) as { errorCode?: string; message?: string | null };
  assert.equal(summary.errorCode, 'DB_ABSENT');
  assert.match(summary.message ?? '', /Orchestration database is absent/u);
  assert.doesNotMatch(result.stdout, /Unknown option run-1/u);
  assert.doesNotMatch(result.stdout, /Missing required option --run-id/u);
  assert.doesNotMatch(result.stdout, /AGENT_HOST_SMOKE_OK/u);
});

test('dispatch summary is prompt-free and bounded', () => {
  const summary = buildDispatchSummary({
    input: createDispatchInput({ prompt: 'secret prompt body' }),
    outcome: createOutcome({
      output: {
        finalText: 'x'.repeat(64 * 1024),
      },
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        source: 'protocol-message',
      },
    }),
    task: createStoreView().getTask('task-1'),
    attempt: createStoreView().getAttempt('attempt-1'),
  });

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes('secret prompt body'), false);
  assert.equal(serialized.includes('OPENAI_API_KEY'), false);
  assert.ok(Buffer.byteLength(serialized, 'utf8') < 4096);
});

test('dispatchAttempt routes through executor, preserves requested model, and never needs store transition methods', async () => {
  const input = createDispatchInput({
    provider: 'claude',
    requestedModel: 'claude-sonnet-4',
    permissionProfile: 'task-implementer',
  });
  const executor = new FakeExecutor({
    onExecute: async (received) => {
      assert.equal(received.provider, 'claude');
      assert.equal(received.requestedModel, 'claude-sonnet-4');
      assert.equal(received.permissionProfile, 'task-implementer');
      return createOutcome({
        model: {
          requestedModel: 'claude-sonnet-4',
          reportedModel: 'claude-sonnet-4-actual',
          reportedModelSource: 'protocol-message',
        },
      });
    },
  });

  const result = await dispatchAttempt({
    input,
    executor,
    store: createStoreView(),
    hostInstanceId: 'dispatch-host-1',
    workingDirectory: 'C:\\Repo\\PowerOn',
  });

  assert.equal(executor.executeCalls.length, 1);
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.requestedModel, 'claude-sonnet-4');
  assert.equal(result.summary.reportedModel, 'claude-sonnet-4-actual');
  assert.equal(result.summary.taskStatus, 'running');
});

test('dispatchAttempt keeps Codex reportedModel null in summary and returns nonzero on provider failure', async () => {
  const executor = new FakeExecutor({
    onExecute: async () =>
      createOutcome({
        provider: {
          terminalState: 'failed',
          success: false,
          errorCode: 'PROVIDER_ERROR',
          errorMessage: 'provider rejected the turn',
        },
        model: {
          requestedModel: 'gpt-5.6',
          reportedModel: null,
          reportedModelSource: 'none',
        },
      }),
  });

  const result = await dispatchAttempt({
    input: createDispatchInput(),
    executor,
    store: createStoreView({
      attempt: {
        attemptId: 'attempt-1',
        taskId: 'task-1',
        ordinal: 1,
        status: 'failed',
        hostInstanceId: 'dispatch-host-1',
        createdAt: '2026-08-24T01:00:00.000Z',
        startedAt: '2026-08-24T01:00:00.000Z',
        endedAt: '2026-08-24T01:00:01.000Z',
      },
    }),
    hostInstanceId: 'dispatch-host-1',
    workingDirectory: 'C:\\Repo\\PowerOn',
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.reportedModel, null);
  assert.equal(result.summary.errorCode, 'PROVIDER_ERROR');
});

test('dispatch command rejects invalid run/task/attempt durable relationships before provider launch', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'orch3g-invalid-'));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  await mkdir(repoPath, { recursive: true });

  const statePaths = resolveStatePaths({ canonicalRepoPath: repoPath, localAppData });
  await mkdir(statePaths.repoStateDir, { recursive: true });
  const store = openOrchestrationStore({
    dbPath: statePaths.orchestrationDbPath,
    repoKey: statePaths.repoKey,
    hostId: 'host-1',
    hostVersion: '0.1.0',
  });

  try {
    store.createRun({ runId: 'run-1', title: 'Run 1' });
    store.createRun({ runId: 'run-2', title: 'Run 2' });
    store.createTask({ taskId: 'task-1', runId: 'run-2', title: 'Task 1' });
    store.createAttempt({ attemptId: 'attempt-1', taskId: 'task-1', hostInstanceId: 'dispatch-host-1' });
  } finally {
    store.close();
  }

  const result = await runDispatchCommand(
    createDispatchInput({ localAppData }),
    createBaseDependencies({ repoPath, localAppData }),
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.errorCode, 'RELATIONSHIP_MISMATCH');
});

test('dispatch command refuses competing live Host ownership under ORCH-1 rules', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'orch3g-live-owner-'));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  await mkdir(repoPath, { recursive: true });

  const { statePaths } = await createSeededStore({
    repoPath,
    localAppData,
    hostInstanceId: 'dispatch-host-1',
  });

  await writeFile(
    statePaths.lockPath,
    `${JSON.stringify({
      schemaVersion: 1,
      hostId: 'host-1',
      hostVersion: '0.1.0',
      canonicalRepoPath: repoPath,
      repoKey: statePaths.repoKey,
      instanceId: 'dispatch-host-1',
      pid: process.pid,
      startedAt: '2026-08-24T01:00:00.000Z',
    }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    statePaths.heartbeatPath,
    `${JSON.stringify({
      schemaVersion: 1,
      hostId: 'host-1',
      hostVersion: '0.1.0',
      canonicalRepoPath: repoPath,
      repoKey: statePaths.repoKey,
      instanceId: 'dispatch-host-1',
      pid: process.pid,
      startedAt: '2026-08-24T01:00:00.000Z',
      lastHeartbeatAt: new Date().toISOString(),
      state: 'running',
      branch: 'main',
      headSha: 'head-sha-1',
      dirty: false,
      providers: [],
    }, null, 2)}\n`,
    'utf8',
  );

  const result = await runDispatchCommand(
    createDispatchInput({ localAppData }),
    createBaseDependencies({ repoPath, localAppData }),
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.errorCode, 'HOST_RUNNING');
});

test('dispatch can recover a stale dead Host lock only through existing ORCH-1 rules', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'orch3g-stale-owner-'));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  await mkdir(repoPath, { recursive: true });

  const { statePaths, dbPath, repoKey } = await createSeededStore({
    repoPath,
    localAppData,
    hostInstanceId: 'dispatch-host-1',
  });

  await writeFile(
    statePaths.lockPath,
    `${JSON.stringify({
      schemaVersion: 1,
      hostId: 'host-1',
      hostVersion: '0.1.0',
      canonicalRepoPath: repoPath,
      repoKey: statePaths.repoKey,
      instanceId: 'dispatch-host-1',
      pid: 499991,
      startedAt: '2026-08-24T00:00:00.000Z',
    }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    statePaths.heartbeatPath,
    `${JSON.stringify({
      schemaVersion: 1,
      hostId: 'host-1',
      hostVersion: '0.1.0',
      canonicalRepoPath: repoPath,
      repoKey: statePaths.repoKey,
      instanceId: 'dispatch-host-1',
      pid: 499991,
      startedAt: '2026-08-24T00:00:00.000Z',
      lastHeartbeatAt: '2026-08-24T00:00:01.000Z',
      state: 'running',
      branch: 'main',
      headSha: 'head-sha-1',
      dirty: false,
      providers: [],
    }, null, 2)}\n`,
    'utf8',
  );

  const adapter = new FakeAdapter({
    id: 'codex',
    onExecute: async (request) => createExecutionResult({ executionId: request.executionId }),
  });

  const result = await runDispatchCommand(
    createDispatchInput({ localAppData }),
    createBaseDependencies({
      repoPath,
      localAppData,
      createProviderRegistry: () => new Map([['codex', adapter]]),
      createAttemptExecutor: ({ store, registry, now }) => new AttemptExecutor({ store, registry, now }),
    }),
  );

  assert.equal(result.exitCode, 0);
  const reopened = await reopenStore(dbPath, repoKey);
  try {
    assert.equal(reopened.getAttempt('attempt-1')?.status, 'passed');
  } finally {
    reopened.close();
  }
});

test('dispatch dry success smoke uses real AttemptExecutor, keeps Task running, and persists execution events', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'orch3g-success-'));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  await mkdir(repoPath, { recursive: true });

  const { dbPath, repoKey } = await createSeededStore({
    repoPath,
    localAppData,
    hostInstanceId: 'dispatch-host-1',
  });

  const adapter = new FakeAdapter({
    id: 'codex',
    onExecute: async (request) =>
      createExecutionResult({
        executionId: request.executionId,
        session: { sessionId: 'thread-123' },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          source: 'protocol-message',
        },
      }),
  });

  const result = await runDispatchCommand(
    createDispatchInput({ localAppData }),
    createBaseDependencies({
      repoPath,
      localAppData,
      discoverTools: async () => [
        {
          toolId: 'codex-cli',
          displayName: 'Codex CLI',
          kind: 'provider',
          command: 'codex',
          harnessKind: 'cmd-wrapper',
          installed: true,
          workerCapable: true,
          discoveredAt: '2026-08-24T01:00:00.000Z',
        },
      ],
      createProviderRegistry: () => new Map([['codex', adapter]]),
      createAttemptExecutor: ({ store, registry, now }) => new AttemptExecutor({ store, registry, now }),
    }),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.providerSuccess, true);
  assert.equal(result.summary.sessionId, 'thread-123');

  const reopened = await reopenStore(dbPath, repoKey);
  try {
    assert.equal(reopened.getAttempt('attempt-1')?.status, 'passed');
    assert.equal(reopened.getTask('task-1')?.status, 'running');
    const eventTypes = reopened.listEvents().map((event) => event.type);
    assert.equal(eventTypes.includes('execution.started'), true);
    assert.equal(eventTypes.includes('execution.completed'), true);
  } finally {
    reopened.close();
  }
});

test('dispatch dry failure smoke uses real AttemptExecutor, marks Attempt failed, and does not retry', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'orch3g-failure-'));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  await mkdir(repoPath, { recursive: true });

  const { dbPath, repoKey } = await createSeededStore({
    repoPath,
    localAppData,
    hostInstanceId: 'dispatch-host-1',
  });

  const adapter = new FakeAdapter({
    id: 'codex',
    onExecute: async (request) =>
      createExecutionResult({
        executionId: request.executionId,
        provider: {
          terminalState: 'failed',
          success: false,
          errorCode: 'PROVIDER_ERROR',
          errorMessage: 'boom',
        },
      }),
  });

  const result = await runDispatchCommand(
    createDispatchInput({ localAppData }),
    createBaseDependencies({
      repoPath,
      localAppData,
      discoverTools: async () => [],
      createProviderRegistry: () => new Map([['codex', adapter]]),
      createAttemptExecutor: ({ store, registry, now }) => new AttemptExecutor({ store, registry, now }),
    }),
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.errorCode, 'PROVIDER_ERROR');

  const reopened = await reopenStore(dbPath, repoKey);
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

test('dispatch surfaces provider unavailable through AttemptExecutor when no adapter is registered', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'orch3g-unavailable-'));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  await mkdir(repoPath, { recursive: true });

  const { dbPath, repoKey } = await createSeededStore({
    repoPath,
    localAppData,
    hostInstanceId: 'dispatch-host-1',
  });

  const result = await runDispatchCommand(
    createDispatchInput({ localAppData }),
    createBaseDependencies({
      repoPath,
      localAppData,
      discoverTools: async () => [],
      createProviderRegistry: () => new Map(),
      createAttemptExecutor: ({ store, registry, now }) => new AttemptExecutor({ store, registry, now }),
    }),
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.errorCode, 'PROVIDER_UNAVAILABLE');

  const reopened = await reopenStore(dbPath, repoKey);
  try {
    assert.equal(reopened.getAttempt('attempt-1')?.status, 'failed');
  } finally {
    reopened.close();
  }
});

test('dispatch cancellation delegates to executor and shutdown stays bounded through the signal path', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'orch3g-signal-'));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  await mkdir(repoPath, { recursive: true });
  await createSeededStore({
    repoPath,
    localAppData,
    hostInstanceId: 'dispatch-host-1',
  });

  const deferred = createDeferred<AttemptExecutionOutcome>();
  const executors: FakeExecutor[] = [];
  let signalHandler: ((signal: string) => void) | null = null;

  const resultPromise = runDispatchCommand(
    createDispatchInput({ localAppData }),
    createBaseDependencies({
      repoPath,
      localAppData,
      subscribeToTermination: (handler) => {
        signalHandler = handler;
        return () => {
          signalHandler = null;
        };
      },
      createAttemptExecutor: () => {
        const executor = new FakeExecutor({
          onExecute: async () => await deferred.promise,
          onCancel: () => {
            deferred.resolve(
              createOutcome({
                provider: {
                  terminalState: 'failed',
                  success: false,
                  errorCode: 'EXECUTION_CANCELLED',
                  errorMessage: 'cancelled',
                },
                process: {
                  exitCode: null,
                  signal: null,
                  timedOut: false,
                  cancelled: true,
                },
              }),
            );
          },
        });
        executors.push(executor);
        return executor;
      },
    }),
  );

  for (let attempt = 0; attempt < 20 && !signalHandler; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const handler: (signal: string) => void =
    signalHandler ??
    ((_signal: string) => {
      assert.fail('Expected dispatch signal handler to be installed.');
    });
  handler('SIGINT');
  const result = await resultPromise;

  const activeExecutor = executors.at(-1);
  assert.ok(activeExecutor);
  assert.deepEqual(activeExecutor?.cancelCalls, ['attempt-1']);
  assert.ok((activeExecutor?.shutdownCalls ?? 0) >= 1);
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.errorCode, 'EXECUTION_CANCELLED');
});
