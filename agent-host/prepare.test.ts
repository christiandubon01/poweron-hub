import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readLock } from './lib/lock.ts';
import { openOrchestrationStore, type OrchestrationStore } from './lib/store.ts';
import { resolveStatePaths } from './lib/statePaths.ts';
import { createNoOpAttemptPolicyController } from './policy/policy.ts';
import { runDispatchCommand } from './dispatch.ts';
import {
  buildPrepareSummary,
  main,
  parsePrepareArgs,
  prepareDurableRecords,
  runPrepareCommand,
  type PrepareCommandDependencies,
  type PrepareCommandOptions,
} from './prepare.ts';
import { AttemptExecutor } from './providers/executor.ts';
import type { ExecutionRequest, ExecutionResult, ProviderAdapter, ProviderId, ProviderProbeResult } from './providers/types.ts';

class FakeAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  readonly executeRequests: ExecutionRequest[] = [];
  private readonly onExecute?: ((request: ExecutionRequest) => Promise<ExecutionResult> | ExecutionResult) | undefined;

  constructor(options: {
    id: ProviderId;
    onExecute?: ((request: ExecutionRequest) => Promise<ExecutionResult> | ExecutionResult) | undefined;
  }) {
    this.id = options.id;
    this.onExecute = options.onExecute;
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

  cancel(): void {
    // Preparation tests do not need adapter cancellation behavior.
  }
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

function createPrepareInput(overrides: Partial<PrepareCommandOptions> = {}): PrepareCommandOptions {
  return {
    title: 'ORCH smoke test',
    goal: 'Prepare a single durable run for dispatch.',
    taskTitle: 'Return exactly OK',
    taskGoal: 'Use a trivial dry-run task.',
    json: true,
    ...overrides,
  };
}

function createInstanceIdentityFixture(instanceId: string): { instanceId: string; pid: number; startedAt: string } {
  return {
    instanceId,
    pid: 4242,
    startedAt: '2026-08-24T01:00:00.000Z',
  };
}

async function createTempEnvironment(prefix: string): Promise<{
  repoPath: string;
  localAppData: string;
  statePaths: ReturnType<typeof resolveStatePaths>;
}> {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), prefix));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  await mkdir(repoPath, { recursive: true });
  return {
    repoPath,
    localAppData,
    statePaths: resolveStatePaths({
      canonicalRepoPath: repoPath,
      localAppData,
    }),
  };
}

function createPrepareDependencies(options: {
  repoPath: string;
  localAppData: string;
  idGenerator?: (() => string) | undefined;
  createInstanceIdentity?: PrepareCommandDependencies['createInstanceIdentity'];
}): PrepareCommandDependencies {
  return {
    resolveCanonicalRepo: async () => options.repoPath,
    idGenerator: options.idGenerator,
    createInstanceIdentity: options.createInstanceIdentity,
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

test('prepare summary partialCreation truth table matches the durable record boundary', () => {
  const run = {
    runId: 'run-1',
    title: 'Run 1',
    goal: null,
    status: 'pending',
    createdAt: '2026-08-24T01:00:00.000Z',
    updatedAt: '2026-08-24T01:00:00.000Z',
    startedAt: null,
    completedAt: null,
  } as const;
  const task = {
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
  } as const;
  const attempt = {
    attemptId: 'attempt-1',
    taskId: 'task-1',
    ordinal: 1,
    status: 'running',
    hostInstanceId: 'dispatch-host-1',
    createdAt: '2026-08-24T01:00:00.000Z',
    startedAt: '2026-08-24T01:00:00.000Z',
    endedAt: null,
  } as const;

  assert.equal(buildPrepareSummary({}).partialCreation, false);
  assert.equal(buildPrepareSummary({ run }).partialCreation, true);
  assert.equal(buildPrepareSummary({ run, task }).partialCreation, true);
  assert.equal(buildPrepareSummary({ run, task, attempt }).partialCreation, false);
});

test('prepare parser accepts owner-facing arguments and main returns nonzero for invalid CLI input', async () => {
  const parsed = parsePrepareArgs([
    '--title', 'ORCH smoke test',
    '--task-title', 'Return exactly OK',
    '--goal', 'Run a dry smoke.',
    '--task-goal', 'Return only OK.',
    '--json',
  ]);

  assert.equal(parsed.title, 'ORCH smoke test');
  assert.equal(parsed.taskTitle, 'Return exactly OK');
  assert.equal(parsed.json, true);

  const output: string[] = [];
  const exitCode = await main(['--title', 'missing-task-title'], {}, {
    write(value: string): boolean {
      output.push(value);
      return true;
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(output.join('').includes('"errorCode": "ARGUMENT_INVALID"'), true);
});

test('prepareDurableRecords creates one Run, one Task, and one Attempt through store APIs only', async () => {
  const { statePaths } = await createTempEnvironment('orch3h-direct-');
  await mkdir(statePaths.repoStateDir, { recursive: true });
  const store = openOrchestrationStore({
    dbPath: statePaths.orchestrationDbPath,
    repoKey: statePaths.repoKey,
    hostId: 'host-1',
    hostVersion: '0.1.0',
  });

  try {
    const prepared = prepareDurableRecords({
      store,
      runId: 'run-1',
      title: 'Run 1',
      taskId: 'task-1',
      taskTitle: 'Task 1',
      attemptId: 'attempt-1',
      hostInstanceId: '123e4567-e89b-12d3-a456-426614174000',
    });

    assert.equal(prepared.run.status, 'pending');
    assert.equal(store.getTask('task-1')?.status, 'running');
    assert.equal(store.getAttempt('attempt-1')?.status, 'running');
  } finally {
    store.close();
  }
});

test('empty DB bootstrap creates durable Run, Task, and Attempt and releases the lock cleanly', async () => {
  const { repoPath, localAppData, statePaths } = await createTempEnvironment('orch3h-bootstrap-');
  const result = await runPrepareCommand(
    createPrepareInput({ localAppData }),
    createPrepareDependencies({
      repoPath,
      localAppData,
      createInstanceIdentity: () => createInstanceIdentityFixture('123e4567-e89b-12d3-a456-426614174000'),
    }),
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.summary.hostInstanceId ?? '', /^[0-9a-f-]{36}$/iu);
  assert.notEqual(result.summary.hostInstanceId, 'cli');
  assert.equal(result.summary.runStatus, 'pending');
  assert.equal(result.summary.taskStatus, 'running');
  assert.equal(result.summary.attemptStatus, 'running');
  assert.equal(result.summary.partialCreation, false);
  assert.equal(await readLock(statePaths.lockPath), null);
});

test('prepare output IDs refer to actual persisted records and survive close/reopen', async () => {
  const { repoPath, localAppData, statePaths } = await createTempEnvironment('orch3h-persist-');
  const result = await runPrepareCommand(
    createPrepareInput({ localAppData }),
    createPrepareDependencies({
      repoPath,
      localAppData,
      createInstanceIdentity: () => createInstanceIdentityFixture('223e4567-e89b-12d3-a456-426614174000'),
    }),
  );

  assert.equal(result.exitCode, 0);

  const reopened = await reopenStore(statePaths.orchestrationDbPath, statePaths.repoKey);
  try {
    const run = reopened.getRun(result.summary.runId ?? '');
    const task = reopened.getTask(result.summary.taskId ?? '');
    const attempt = reopened.getAttempt(result.summary.attemptId ?? '');

    assert.ok(run);
    assert.ok(task);
    assert.ok(attempt);
    assert.equal(result.summary.partialCreation, false);
    assert.equal(task?.runId, run?.runId);
    assert.equal(attempt?.taskId, task?.taskId);
    assert.equal(attempt?.hostInstanceId, result.summary.hostInstanceId);
  } finally {
    reopened.close();
  }
});

test('prepare persists no prompt and triggers no provider execution events', async () => {
  const { repoPath, localAppData, statePaths } = await createTempEnvironment('orch3h-no-prompt-');
  const result = await runPrepareCommand(
    createPrepareInput({ localAppData }),
    createPrepareDependencies({
      repoPath,
      localAppData,
      createInstanceIdentity: () => createInstanceIdentityFixture('323e4567-e89b-12d3-a456-426614174000'),
    }),
  );

  assert.equal(result.exitCode, 0);

  const reopened = await reopenStore(statePaths.orchestrationDbPath, statePaths.repoKey);
  try {
    const eventTexts = reopened.listEvents().map((event) => JSON.stringify(event));
    assert.equal(eventTexts.some((text) => text.includes('prompt')), false);
    assert.equal(eventTexts.some((text) => text.includes('execution.started')), false);
    assert.equal(eventTexts.some((text) => text.includes('execution.completed')), false);
  } finally {
    reopened.close();
  }
});

test('live Host ownership prevents competing preparation', async () => {
  const { repoPath, localAppData, statePaths } = await createTempEnvironment('orch3h-live-lock-');
  await mkdir(statePaths.repoStateDir, { recursive: true });

  await writeFile(
    statePaths.lockPath,
    `${JSON.stringify({
      schemaVersion: 1,
      hostId: 'host-1',
      hostVersion: '0.1.0',
      canonicalRepoPath: repoPath,
      repoKey: statePaths.repoKey,
      instanceId: 'live-host',
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
      instanceId: 'live-host',
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

  const result = await runPrepareCommand(
    createPrepareInput({ localAppData }),
    createPrepareDependencies({ repoPath, localAppData }),
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.errorCode, 'HOST_RUNNING');
});

test('stale dead lock is recovered only through existing lock rules', async () => {
  const { repoPath, localAppData, statePaths } = await createTempEnvironment('orch3h-stale-lock-');
  await mkdir(statePaths.repoStateDir, { recursive: true });

  await writeFile(
    statePaths.lockPath,
    `${JSON.stringify({
      schemaVersion: 1,
      hostId: 'host-1',
      hostVersion: '0.1.0',
      canonicalRepoPath: repoPath,
      repoKey: statePaths.repoKey,
      instanceId: 'stale-host',
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
      instanceId: 'stale-host',
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

  const result = await runPrepareCommand(
    createPrepareInput({ localAppData }),
    createPrepareDependencies({ repoPath, localAppData }),
  );

  assert.equal(result.exitCode, 0);
});

test('duplicate preparation invocations create distinct durable IDs', async () => {
  const { repoPath, localAppData } = await createTempEnvironment('orch3h-duplicate-');

  const first = await runPrepareCommand(
    createPrepareInput({ localAppData }),
    createPrepareDependencies({ repoPath, localAppData }),
  );
  const second = await runPrepareCommand(
    createPrepareInput({ localAppData }),
    createPrepareDependencies({ repoPath, localAppData }),
  );

  assert.equal(first.exitCode, 0);
  assert.equal(second.exitCode, 0);
  assert.notEqual(first.summary.runId, second.summary.runId);
  assert.notEqual(first.summary.taskId, second.summary.taskId);
  assert.notEqual(first.summary.attemptId, second.summary.attemptId);
});

test('task creation failure reports partial durable state truthfully', async () => {
  const { repoPath, localAppData, statePaths } = await createTempEnvironment('orch3h-task-fail-');
  await mkdir(statePaths.repoStateDir, { recursive: true });
  const store = openOrchestrationStore({
    dbPath: statePaths.orchestrationDbPath,
    repoKey: statePaths.repoKey,
    hostId: 'host-1',
    hostVersion: '0.1.0',
  });

  try {
    store.createRun({ runId: 'run-existing', title: 'Existing run' });
    store.createTask({ taskId: 'task-seq-2', runId: 'run-existing', title: 'Existing task' });
  } finally {
    store.close();
  }

  const sequence = ['seq-1', 'seq-2', 'seq-3'];
  const result = await runPrepareCommand(
    createPrepareInput({ localAppData }),
    createPrepareDependencies({
      repoPath,
      localAppData,
      idGenerator: () => sequence.shift() ?? 'exhausted',
      createInstanceIdentity: () => createInstanceIdentityFixture('423e4567-e89b-12d3-a456-426614174000'),
    }),
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.partialCreation, true);
  assert.equal(result.summary.runId, 'run-seq-1');
  assert.equal(result.summary.runStatus, 'pending');
  assert.equal(result.summary.taskStatus, null);
  assert.equal(result.summary.attemptStatus, null);
});

test('attempt creation failure leaves Run and Task durable and reports partial creation', async () => {
  const { repoPath, localAppData, statePaths } = await createTempEnvironment('orch3h-attempt-fail-');
  await mkdir(statePaths.repoStateDir, { recursive: true });
  const store = openOrchestrationStore({
    dbPath: statePaths.orchestrationDbPath,
    repoKey: statePaths.repoKey,
    hostId: 'host-1',
    hostVersion: '0.1.0',
  });

  try {
    store.createRun({ runId: 'run-existing', title: 'Existing run' });
    store.createTask({ taskId: 'task-existing', runId: 'run-existing', title: 'Existing task' });
    store.createAttempt({ attemptId: 'attempt-seq-3', taskId: 'task-existing', hostInstanceId: 'other-host' });
  } finally {
    store.close();
  }

  const sequence = ['seq-1', 'seq-2', 'seq-3'];
  const result = await runPrepareCommand(
    createPrepareInput({ localAppData }),
    createPrepareDependencies({
      repoPath,
      localAppData,
      idGenerator: () => sequence.shift() ?? 'exhausted',
      createInstanceIdentity: () => createInstanceIdentityFixture('523e4567-e89b-12d3-a456-426614174000'),
    }),
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.partialCreation, true);
  assert.equal(result.summary.runId, 'run-seq-1');
  assert.equal(result.summary.taskId, 'task-seq-2');
  assert.equal(result.summary.taskStatus, 'pending');
  assert.equal(result.summary.attemptStatus, null);
});

test('end-to-end dry prepare to dispatch success adopts prepared hostInstanceId and passes the Attempt', async () => {
  const { repoPath, localAppData, statePaths } = await createTempEnvironment('orch3h-e2e-pass-');
  const prepared = await runPrepareCommand(
    createPrepareInput({ localAppData }),
    createPrepareDependencies({
      repoPath,
      localAppData,
      createInstanceIdentity: () => createInstanceIdentityFixture('623e4567-e89b-12d3-a456-426614174000'),
    }),
  );

  assert.equal(prepared.exitCode, 0);

  const adapter = new FakeAdapter({
    id: 'codex',
    onExecute: async (request) => createExecutionResult({ executionId: request.executionId }),
  });

  const dispatch = await runDispatchCommand(
    {
      runId: prepared.summary.runId ?? '',
      taskId: prepared.summary.taskId ?? '',
      attemptId: prepared.summary.attemptId ?? '',
      provider: 'codex',
      requestedModel: 'gpt-5.6',
      reasoningEffort: 'medium',
      permissionProfile: 'read-only-reviewer',
      timeoutMs: 30_000,
      json: true,
      prompt: 'Return exactly OK.',
      localAppData,
    },
    {
      resolveCanonicalRepo: async () => repoPath,
      readRepoStatus: async () => ({
        branch: 'main',
        headSha: 'head-sha-1',
        dirty: false,
      }),
      createProviderRegistry: () => new Map([['codex', adapter]]),
      discoverTools: async () => [],
      createAttemptExecutor: ({ store, registry, now }) => new AttemptExecutor({
        store,
        registry,
        now,
        policyController: createNoOpAttemptPolicyController(),
      }),
      subscribeToTermination: () => () => undefined,
    },
  );

  assert.equal(dispatch.exitCode, 0);

  const reopened = await reopenStore(statePaths.orchestrationDbPath, statePaths.repoKey);
  try {
    assert.equal(reopened.getAttempt(prepared.summary.attemptId ?? '')?.status, 'passed');
    assert.equal(reopened.getTask(prepared.summary.taskId ?? '')?.status, 'running');
    const eventTypes = reopened.listEvents().map((event) => event.type);
    assert.equal(eventTypes.includes('execution.started'), true);
    assert.equal(eventTypes.includes('execution.completed'), true);
  } finally {
    reopened.close();
  }
});

test('end-to-end dry prepare to dispatch failure persists execution.failed with no retry', async () => {
  const { repoPath, localAppData, statePaths } = await createTempEnvironment('orch3h-e2e-fail-');
  const prepared = await runPrepareCommand(
    createPrepareInput({ localAppData }),
    createPrepareDependencies({
      repoPath,
      localAppData,
      createInstanceIdentity: () => createInstanceIdentityFixture('723e4567-e89b-12d3-a456-426614174000'),
    }),
  );

  assert.equal(prepared.exitCode, 0);

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

  const dispatch = await runDispatchCommand(
    {
      runId: prepared.summary.runId ?? '',
      taskId: prepared.summary.taskId ?? '',
      attemptId: prepared.summary.attemptId ?? '',
      provider: 'codex',
      requestedModel: 'gpt-5.6',
      reasoningEffort: 'medium',
      permissionProfile: 'read-only-reviewer',
      timeoutMs: 30_000,
      json: true,
      prompt: 'Return exactly OK.',
      localAppData,
    },
    {
      resolveCanonicalRepo: async () => repoPath,
      readRepoStatus: async () => ({
        branch: 'main',
        headSha: 'head-sha-1',
        dirty: false,
      }),
      createProviderRegistry: () => new Map([['codex', adapter]]),
      discoverTools: async () => [],
      createAttemptExecutor: ({ store, registry, now }) => new AttemptExecutor({
        store,
        registry,
        now,
        policyController: createNoOpAttemptPolicyController(),
      }),
      subscribeToTermination: () => () => undefined,
    },
  );

  assert.equal(dispatch.exitCode, 1);

  const reopened = await reopenStore(statePaths.orchestrationDbPath, statePaths.repoKey);
  try {
    assert.equal(reopened.getAttempt(prepared.summary.attemptId ?? '')?.status, 'failed');
    assert.equal(reopened.getTask(prepared.summary.taskId ?? '')?.status, 'running');
    const eventTypes = reopened.listEvents().map((event) => event.type);
    assert.equal(eventTypes.includes('execution.failed'), true);
    assert.equal(reopened.listAttempts(prepared.summary.taskId ?? '').length, 1);
  } finally {
    reopened.close();
  }
});
