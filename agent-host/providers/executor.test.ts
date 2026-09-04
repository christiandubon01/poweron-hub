import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openOrchestrationStore } from '../lib/store.ts';
import type { OrchestrationStore } from '../lib/store.ts';
import { OrchestrationError, TEXT_FIELD_MAX_BYTES } from '../lib/orchestrationTypes.ts';
import { shutdownHostRuntime } from '../index.ts';
import { createNoOpAttemptPolicyController } from '../policy/policy.ts';
import type { ExecutionRequest, ExecutionResult, ProviderAdapter, ProviderErrorCode, ProviderId, ProviderProbeResult } from './types.ts';
import { AttemptExecutor, AttemptExecutorError, createProviderRegistry, recoverInterruptedAttempts, type AttemptExecutionInput } from './executor.ts';

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
    permissionProfile: 'task-implementer',
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
    shutdownTimeoutMs: number;
    policyController: ReturnType<typeof createNoOpAttemptPolicyController>;
  }> = {},
): AttemptExecutor {
  return new AttemptExecutor({
    store,
    registry: new Map(adapters.map((adapter) => [adapter.id, adapter])),
    now: overrides.now,
    defaultTimeoutMs: overrides.defaultTimeoutMs,
    shutdownTimeoutMs: overrides.shutdownTimeoutMs,
    policyController: overrides.policyController ?? createNoOpAttemptPolicyController(),
  });
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
    assert.equal(outcome.terminalEvent.type, 'execution.completed');
  } finally {
    store.close();
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
    assert.equal(outcome.terminalEvent.type, 'execution.failed');
    assert.equal(store.getAttempt('attempt-1')?.status, 'failed');
    assert.equal(store.getTask('task-1')?.status, 'running');
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
    assert.equal(outcome.terminalEvent.type, 'execution.timed_out');
    assert.equal(store.getAttempt('attempt-1')?.status, 'failed');
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
      assert.equal(outcome.terminalEvent.type, 'execution.failed');
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
    assert.equal(outcome.terminalEvent.type, 'execution.cancelled');
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
    assert.equal(outcome.terminalEvent.type, 'execution.cancelled');
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
    assert.equal(outcome.terminalEvent.type, 'execution.cancelled');
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

test('executor: execution.started persistence failure prevents provider invocation', async () => {
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

    await assert.rejects(
      executor.execute(createExecutionInput()),
      (error: unknown) => error instanceof AttemptExecutorError && error.code === 'EVENT_PERSIST_FAILED',
    );

    assert.equal(adapter.executeRequests.length, 0);
    assert.equal(store.getAttempt('attempt-1')?.status, 'running');
  } finally {
    store.close();
  }
});

test('executor: terminal event write failure is surfaced and leaves running Attempt for recovery', async () => {
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
    await assert.rejects(
      executor.execute(createExecutionInput()),
      (error: unknown) => error instanceof AttemptExecutorError && error.code === 'EVENT_PERSIST_FAILED',
    );

    assert.equal(store.getAttempt('attempt-1')?.status, 'running');
    assert.equal(store.listEvents().some((event) => event.type === 'execution.completed'), false);
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
