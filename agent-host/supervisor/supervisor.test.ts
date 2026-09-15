import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openOrchestrationStore, type OrchestrationStore } from '../lib/store.ts';
import type { AttemptStatus, JsonValue } from '../lib/orchestrationTypes.ts';
import {
  supervisorTick,
  classifyAttemptFailure,
  SUPERVISOR_RETRY_SCHEDULED_EVENT,
  SUPERVISOR_BLOCKED_EVENT,
  type AttemptExecutionContext,
  type ExecutionPort,
  type SupervisorTickOptions,
  type SupervisorTickResult,
} from './supervisor.ts';
import type { AttemptFailureSummary } from './types.ts';

const HOST_INSTANCE_ID = 'host-instance-1';

async function withStore(work: (store: OrchestrationStore) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orch-supervisor-'));
  const dbPath = path.join(tempDir, 'orchestration.sqlite');
  let eventCounter = 0;
  const store = openOrchestrationStore({
    dbPath,
    repoKey: 'repo-key-1',
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

function attemptIdFactory(): () => string {
  let counter = 0;
  return () => `att-${++counter}`;
}

interface FakeExecutorPlan {
  status: AttemptStatus;
  /** Durable event appended before terminalizing (e.g. 'execution.failed'). */
  emitEventType?: string;
  emitPayload?: JsonValue;
  /** Classification hint returned from the port. */
  failure?: AttemptFailureSummary;
  /** When true, the port leaves the Attempt running (does not terminalize it). */
  leaveRunning?: boolean;
}

interface FakeExecutor {
  port: ExecutionPort;
  calls: () => number;
  taskIds: () => readonly string[];
}

function fakeExecutor(
  store: OrchestrationStore,
  planFor: FakeExecutorPlan | ((ordinal: number, context: AttemptExecutionContext) => FakeExecutorPlan),
): FakeExecutor {
  let calls = 0;
  let eventSeq = 0;
  const taskIds: string[] = [];
  return {
    calls: () => calls,
    taskIds: () => taskIds,
    port: {
      execute(context) {
        calls += 1;
        taskIds.push(context.taskId);
        const plan = typeof planFor === 'function' ? planFor(context.attemptOrdinal, context) : planFor;
        if (plan.emitEventType) {
          store.appendEvent({
            eventId: `fake-${context.attemptId}-${++eventSeq}`,
            runId: context.runId,
            taskId: context.taskId,
            attemptId: context.attemptId,
            type: plan.emitEventType,
            payload: plan.emitPayload ?? null,
          });
        }
        if (!plan.leaveRunning) {
          store.transitionAttempt(context.attemptId, plan.status);
        }
        return plan.failure ? { failure: plan.failure } : undefined;
      },
    },
  };
}

function throwingExecutor(): FakeExecutor {
  let calls = 0;
  return {
    calls: () => calls,
    taskIds: () => [],
    port: {
      execute() {
        calls += 1;
        throw new Error('execution port must not be invoked in this scenario');
      },
    },
  };
}

function seedRun(store: OrchestrationStore, runId: string): void {
  store.createRun({ runId, title: `Run ${runId}` });
}

function seedTask(
  store: OrchestrationStore,
  runId: string,
  taskId: string,
  options?: { position?: number; spec?: JsonValue | null },
): void {
  store.createTask({
    runId,
    taskId,
    title: `Task ${taskId}`,
    position: options?.position ?? null,
    spec: options?.spec ?? null,
  });
}

function markTaskPassedWithAttempt(store: OrchestrationStore, taskId: string, attemptId: string): void {
  store.createAttempt({ attemptId, taskId, hostInstanceId: HOST_INSTANCE_ID });
  store.transitionAttempt(attemptId, 'passed');
  store.transitionTask(taskId, 'passed');
}

function tick(
  store: OrchestrationStore,
  overrides: Omit<SupervisorTickOptions, 'store' | 'hostInstanceId'> & { hostInstanceId?: string },
): Promise<SupervisorTickResult> {
  return supervisorTick({
    store,
    hostInstanceId: overrides.hostInstanceId ?? HOST_INSTANCE_ID,
    runId: overrides.runId,
    executionPort: overrides.executionPort,
    idGenerator: overrides.idGenerator,
    recoverInterruptedAttempts: overrides.recoverInterruptedAttempts,
    emitRetryEvent: overrides.emitRetryEvent,
  });
}

const RETRY_SPEC_2: JsonValue = { supervisor: { maxAttempts: 2 } };

// ─── Existing ORCH-5C regressions ──────────────────────────────────────────────

test('supervisor: single passed Task completes the Run with exactly one Attempt', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    const executor = fakeExecutor(store, { status: 'passed' });

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'task-executed');
    assert.equal(result.attemptCreated, true);
    assert.equal(result.executed, true);
    assert.equal(result.attemptId, 'att-1');
    assert.equal(executor.calls(), 1);
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.equal(store.getTask('task-1')?.status, 'passed');
    const attempts = store.listAttempts('task-1');
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.status, 'passed');
    assert.equal(attempts[0]?.ordinal, 1);
  });
});

test('supervisor: default failure fails the Task and Run with no retry', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    // Even a retryable provider failure is terminal under the default maxAttempts=1.
    const executor = fakeExecutor(store, { status: 'failed', emitEventType: 'execution.failed' });

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'task-executed');
    assert.equal(executor.calls(), 1);
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.getTask('task-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

test('supervisor: terminal Run schedules nothing', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    store.transitionRun('run-1', 'cancelled');
    const executor = throwingExecutor();

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'run-terminal');
    assert.equal(result.attemptCreated, false);
    assert.equal(result.executed, false);
    assert.equal(executor.calls(), 0);
    assert.equal(store.getRun('run-1')?.status, 'cancelled');
    assert.equal(store.getTask('task-1')?.status, 'pending');
    assert.equal(store.listAttempts('task-1').length, 0);
  });
});

test('supervisor: zero-Task Run makes no progress', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    const executor = throwingExecutor();

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'zero-tasks');
    assert.equal(result.attemptCreated, false);
    assert.equal(result.executed, false);
    assert.equal(executor.calls(), 0);
    assert.equal(store.getRun('run-1')?.status, 'pending');
  });
});

test('supervisor: a running Attempt is never duplicated', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    store.createAttempt({ attemptId: 'att-pre', taskId: 'task-1', hostInstanceId: HOST_INSTANCE_ID });
    const executor = throwingExecutor();

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'attempt-active');
    assert.equal(result.attemptCreated, false);
    assert.equal(result.executed, false);
    assert.equal(executor.calls(), 0);
    assert.equal(store.getTask('task-1')?.status, 'running');
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

test('supervisor: reconciles a passed Attempt without executing', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    store.createAttempt({ attemptId: 'att-pre', taskId: 'task-1', hostInstanceId: HOST_INSTANCE_ID });
    store.transitionAttempt('att-pre', 'passed');
    const executor = throwingExecutor();

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'task-reconciled');
    assert.equal(result.executed, false);
    assert.equal(executor.calls(), 0);
    assert.equal(store.getTask('task-1')?.status, 'passed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

test('supervisor: reconciles an unclassifiable failed Attempt as terminal (fail-closed)', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: RETRY_SPEC_2 });
    store.createAttempt({ attemptId: 'att-pre', taskId: 'task-1', hostInstanceId: HOST_INSTANCE_ID });
    store.transitionAttempt('att-pre', 'failed');
    const executor = throwingExecutor();

    // No durable execution/policy evidence exists for this failure → fail closed,
    // even though maxAttempts=2 would otherwise permit a retry.
    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'task-reconciled');
    assert.equal(executor.calls(), 0);
    assert.equal(store.getTask('task-1')?.status, 'failed');
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

test('supervisor: executes only the first ready Task per tick', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 0 });
    seedTask(store, 'run-1', 'task-b', { position: 1 });
    const executor = fakeExecutor(store, { status: 'passed' });

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'task-executed');
    assert.equal(result.taskId, 'task-a');
    assert.equal(executor.calls(), 1);
    assert.equal(store.getTask('task-a')?.status, 'passed');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.equal(store.listAttempts('task-a').length, 1);
    assert.equal(store.listAttempts('task-b').length, 0);
    assert.equal(store.getRun('run-1')?.status, 'running');
  });
});

test('supervisor: durable Attempt status overrides the in-memory execution hint', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    const executor = fakeExecutor(store, { status: 'passed', failure: { cause: 'provider-process-failure' } });

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'task-executed');
    assert.equal(store.getTask('task-1')?.status, 'passed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
  });
});

test('supervisor: a non-terminalized Attempt is treated as active', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    const executor = fakeExecutor(store, { status: 'passed', leaveRunning: true });

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'attempt-active');
    assert.equal(result.attemptCreated, true);
    assert.equal(result.executed, true);
    assert.equal(executor.calls(), 1);
    assert.equal(store.getTask('task-1')?.status, 'running');
    assert.equal(store.getRun('run-1')?.status, 'running');
    assert.equal(store.listAttempts('task-1')[0]?.status, 'running');
  });
});

// ─── ORCH-5D: bounded retry ────────────────────────────────────────────────────

test('5D: bounded retry success — fail then pass across two ticks', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: RETRY_SPEC_2 });
    const nextId = attemptIdFactory();
    const executor = fakeExecutor(store, (ordinal) =>
      ordinal === 1
        ? { status: 'failed', emitEventType: 'execution.failed' }
        : { status: 'passed' },
    );

    const first = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(first.outcome, 'retry-scheduled');
    assert.equal(first.attemptCreated, true);
    assert.equal(first.executed, true);
    assert.equal(executor.calls(), 1);
    assert.deepEqual(first.retry, {
      completedAttemptId: 'att-1',
      completedAttemptOrdinal: 1,
      nextAttemptOrdinal: 2,
      maxAttempts: 2,
      reasonCode: 'provider-process-failure',
    });
    assert.equal(store.getTask('task-1')?.status, 'pending');
    assert.notEqual(store.getRun('run-1')?.status, 'completed');
    assert.notEqual(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-1').length, 1);

    const second = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(second.outcome, 'task-executed');
    assert.equal(executor.calls(), 2);
    const attempts = store.listAttempts('task-1');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0]?.status, 'failed');
    assert.equal(attempts[1]?.status, 'passed');
    assert.equal(attempts[1]?.ordinal, 2);
    assert.equal(store.getTask('task-1')?.status, 'passed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
  });
});

test('5D: retry exhaustion — two failures fail the Task and Run, no third Attempt', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: RETRY_SPEC_2 });
    const nextId = attemptIdFactory();
    const executor = fakeExecutor(store, { status: 'failed', emitEventType: 'execution.failed' });

    const first = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(first.outcome, 'retry-scheduled');

    const second = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(second.outcome, 'task-executed');
    assert.equal(store.getTask('task-1')?.status, 'failed');
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-1').length, 2);
    assert.equal(executor.calls(), 2);

    // Further ticks converge: no third Attempt, no execution.
    const third = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(third.outcome, 'run-terminal');
    assert.equal(executor.calls(), 2);
    assert.equal(store.listAttempts('task-1').length, 2);
  });
});

test('5D: default no retry — one retryable failure is terminal under maxAttempts=1', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    const executor = fakeExecutor(store, { status: 'failed', emitEventType: 'execution.failed' });

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'task-executed');
    assert.equal(result.retry, null);
    assert.equal(store.getTask('task-1')?.status, 'failed');
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-1').length, 1);
    assert.equal(executor.calls(), 1);
  });
});

test('5D: policy rejection never retries even with a large budget', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: { supervisor: { maxAttempts: 5 } } });
    const executor = fakeExecutor(store, {
      status: 'failed',
      emitEventType: 'policy.violation',
      emitPayload: { reasonCodes: ['out-of-scope-write'], accepted: false },
    });

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'task-executed');
    assert.equal(result.retry, null);
    assert.equal(store.getTask('task-1')?.status, 'failed');
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-1').length, 1);
    assert.equal(executor.calls(), 1);
  });
});

test('5D: timeout retries under budget then exhausts', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: RETRY_SPEC_2 });
    const nextId = attemptIdFactory();
    const executor = fakeExecutor(store, { status: 'failed', emitEventType: 'execution.timed_out' });

    const first = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(first.outcome, 'retry-scheduled');
    assert.equal(first.retry?.reasonCode, 'execution-timeout');
    assert.equal(store.getTask('task-1')?.status, 'pending');

    const second = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(second.outcome, 'task-executed');
    assert.equal(store.getTask('task-1')?.status, 'failed');
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-1').length, 2);
    assert.equal(executor.calls(), 2);
  });
});

test('5D: timeout classified from execution.failed errorCode', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: RETRY_SPEC_2 });
    const executor = fakeExecutor(store, {
      status: 'failed',
      emitEventType: 'execution.failed',
      emitPayload: { errorCode: 'EXECUTION_TIMEOUT', process: { timedOut: true } },
    });

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });
    assert.equal(result.outcome, 'retry-scheduled');
    assert.equal(result.retry?.reasonCode, 'execution-timeout');
  });
});

// ─── ORCH-5D: crash / interrupt recovery ───────────────────────────────────────

test('5D: interrupted recovery reschedules then executes the next ordinal', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: RETRY_SPEC_2 });
    store.transitionRun('run-1', 'running');
    // Old host created and abandoned Attempt ordinal 1 (still running).
    store.createAttempt({ attemptId: 'att-old', taskId: 'task-1', hostInstanceId: 'old-host' });
    const nextId = attemptIdFactory();
    const executor = fakeExecutor(store, { status: 'passed' });

    // Recovery tick under the live host: interrupts att-old, reschedules, NO execution.
    const recoveryTick = await tick(store, {
      runId: 'run-1',
      hostInstanceId: 'new-host',
      executionPort: executor.port,
      idGenerator: nextId,
    });
    assert.equal(recoveryTick.outcome, 'retry-scheduled');
    assert.deepEqual(recoveryTick.recoveredAttemptIds, ['att-old']);
    assert.equal(recoveryTick.retry?.reasonCode, 'host-interrupted');
    assert.equal(executor.calls(), 0);
    assert.equal(store.getAttempt('att-old')?.status, 'interrupted');
    assert.equal(store.getTask('task-1')?.status, 'pending');

    // Next tick creates ordinal 2 and executes exactly once.
    const nextTick = await tick(store, {
      runId: 'run-1',
      hostInstanceId: 'new-host',
      executionPort: executor.port,
      idGenerator: nextId,
    });
    assert.equal(nextTick.outcome, 'task-executed');
    assert.equal(executor.calls(), 1);
    const attempts = store.listAttempts('task-1');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1]?.ordinal, 2);
    assert.equal(attempts[1]?.status, 'passed');
    assert.equal(store.getTask('task-1')?.status, 'passed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
  });
});

test('5D: interrupted recovery with exhausted budget fails the Task and Run', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1'); // default maxAttempts=1
    store.transitionRun('run-1', 'running');
    store.createAttempt({ attemptId: 'att-old', taskId: 'task-1', hostInstanceId: 'old-host' });
    const executor = throwingExecutor();

    const result = await tick(store, {
      runId: 'run-1',
      hostInstanceId: 'new-host',
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

    assert.equal(result.outcome, 'task-reconciled');
    assert.deepEqual(result.recoveredAttemptIds, ['att-old']);
    assert.equal(executor.calls(), 0);
    assert.equal(store.getAttempt('att-old')?.status, 'interrupted');
    assert.equal(store.getTask('task-1')?.status, 'failed');
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

test('5D: a running Attempt owned by the live Host is not interrupted', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: RETRY_SPEC_2 });
    store.transitionRun('run-1', 'running');
    store.createAttempt({ attemptId: 'att-live', taskId: 'task-1', hostInstanceId: 'current-host' });
    const executor = throwingExecutor();

    const result = await tick(store, {
      runId: 'run-1',
      hostInstanceId: 'current-host',
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

    assert.equal(result.outcome, 'attempt-active');
    assert.deepEqual(result.recoveredAttemptIds, []);
    assert.equal(executor.calls(), 0);
    assert.equal(store.getAttempt('att-live')?.status, 'running');
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

test('5D: crash after terminal — passed Attempt reconciles without execution', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    store.transitionRun('run-1', 'running');
    store.createAttempt({ attemptId: 'att-1', taskId: 'task-1', hostInstanceId: HOST_INSTANCE_ID });
    store.transitionAttempt('att-1', 'passed');
    const executor = throwingExecutor();

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'task-reconciled');
    assert.equal(executor.calls(), 0);
    assert.equal(store.getTask('task-1')?.status, 'passed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

test('5D: crash after terminal — failed Attempt with budget reschedules without redispatch', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: RETRY_SPEC_2 });
    store.transitionRun('run-1', 'running');
    store.createAttempt({ attemptId: 'att-1', taskId: 'task-1', hostInstanceId: HOST_INSTANCE_ID });
    // Durable provider failure evidence exists for the crashed Attempt.
    store.appendEvent({
      eventId: 'exec-fail-1',
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'att-1',
      type: 'execution.failed',
      payload: { errorCode: 'PROVIDER_ERROR' },
    });
    store.transitionAttempt('att-1', 'failed');
    const executor = throwingExecutor();

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'retry-scheduled');
    assert.equal(result.retry?.reasonCode, 'provider-process-failure');
    assert.equal(result.retry?.completedAttemptId, 'att-1');
    assert.equal(executor.calls(), 0);
    // No redispatch / reuse of the old Attempt; still exactly one Attempt.
    assert.equal(store.listAttempts('task-1').length, 1);
    assert.equal(store.getAttempt('att-1')?.status, 'failed');
    assert.equal(store.getTask('task-1')?.status, 'pending');
  });
});

// ─── ORCH-5D: idempotency & telemetry ──────────────────────────────────────────

test('5D: repeated ticks after success are idempotent', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    const nextId = attemptIdFactory();
    const executor = fakeExecutor(store, { status: 'passed' });

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(store.getRun('run-1')?.status, 'completed');

    const again = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(again.outcome, 'run-terminal');
    assert.equal(executor.calls(), 1);
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

test('5D: emits exactly one supervisor.retry.scheduled event with safe payload', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: RETRY_SPEC_2 });
    const executor = fakeExecutor(store, { status: 'failed', emitEventType: 'execution.failed' });

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    const retryEvents = store.listEvents().filter((event) => event.type === SUPERVISOR_RETRY_SCHEDULED_EVENT);
    assert.equal(retryEvents.length, 1);
    assert.equal(retryEvents[0]?.taskId, 'task-1');
    assert.equal(retryEvents[0]?.attemptId, 'att-1');
    assert.deepEqual(retryEvents[0]?.payload, {
      completedAttemptOrdinal: 1,
      nextAttemptOrdinal: 2,
      maxAttempts: 2,
      reasonCode: 'provider-process-failure',
    });
  });
});

test('5D: retry telemetry can be disabled', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: RETRY_SPEC_2 });
    const executor = fakeExecutor(store, { status: 'failed', emitEventType: 'execution.failed' });

    const result = await tick(store, {
      runId: 'run-1',
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
      emitRetryEvent: false,
    });

    assert.equal(result.outcome, 'retry-scheduled');
    assert.equal(store.listEvents().filter((e) => e.type === SUPERVISOR_RETRY_SCHEDULED_EVENT).length, 0);
  });
});

// ─── ORCH-5D: classifier unit coverage ─────────────────────────────────────────

test('5D: classifyAttemptFailure maps durable evidence and fails closed', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: RETRY_SPEC_2 });

    // interrupted → host-interrupted (from status alone)
    store.createAttempt({ attemptId: 'a1', taskId: 'task-1', hostInstanceId: 'x' });
    store.transitionAttempt('a1', 'interrupted');
    assert.equal(classifyAttemptFailure(store, store.getAttempt('a1')!).cause, 'host-interrupted');
    store.transitionTask('task-1', 'blocked');
    store.transitionTask('task-1', 'pending');

    // failed with no evidence and no hint → unknown (fail closed)
    store.createAttempt({ attemptId: 'a2', taskId: 'task-1', hostInstanceId: 'x' });
    store.transitionAttempt('a2', 'failed');
    assert.equal(classifyAttemptFailure(store, store.getAttempt('a2')!).cause, 'unknown');
    // hint is used only when durable evidence is absent
    assert.equal(
      classifyAttemptFailure(store, store.getAttempt('a2')!, { cause: 'execution-timeout' }).cause,
      'execution-timeout',
    );
    store.transitionTask('task-1', 'blocked');
    store.transitionTask('task-1', 'pending');

    // policy rejection wins over provider failure evidence (fail-safe ordering)
    store.createAttempt({ attemptId: 'a3', taskId: 'task-1', hostInstanceId: 'x' });
    store.appendEvent({ eventId: 'e-fail', runId: 'run-1', taskId: 'task-1', attemptId: 'a3', type: 'execution.failed', payload: { errorCode: 'PROVIDER_ERROR' } });
    store.appendEvent({ eventId: 'e-pol', runId: 'run-1', taskId: 'task-1', attemptId: 'a3', type: 'policy.violation', payload: null });
    store.transitionAttempt('a3', 'failed');
    assert.equal(classifyAttemptFailure(store, store.getAttempt('a3')!, { cause: 'provider-process-failure' }).cause, 'policy-rejection');
  });
});

// ─── ORCH-5E: multi-Task DAG readiness and Run completion ─────────────────────

test('5E: dependency chain A -> B -> C executes one Task per tick and completes only after C', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 10 });
    seedTask(store, 'run-1', 'task-b', { position: 20 });
    seedTask(store, 'run-1', 'task-c', { position: 30 });
    store.addDependency('task-b', 'task-a');
    store.addDependency('task-c', 'task-b');
    const executor = fakeExecutor(store, { status: 'passed' });
    const nextId = attemptIdFactory();

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.deepEqual(store.listTasks('run-1').map((task) => task.status), ['passed', 'pending', 'pending']);
    assert.equal(store.getRun('run-1')?.status, 'running');
    assert.equal(executor.calls(), 1);

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.deepEqual(store.listTasks('run-1').map((task) => task.status), ['passed', 'passed', 'pending']);
    assert.equal(store.getRun('run-1')?.status, 'running');
    assert.equal(executor.calls(), 2);

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.deepEqual(store.listTasks('run-1').map((task) => task.status), ['passed', 'passed', 'passed']);
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.equal(executor.calls(), 3);
    assert.deepEqual(executor.taskIds(), ['task-a', 'task-b', 'task-c']);
    assert.equal(store.listTasks('run-1').flatMap((task) => store.listAttempts(task.taskId)).length, 3);
  });
});

test('5E: fan-out executes ready children in getReadyTasks position order across later ticks', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 10 });
    // Deliberately create B before C while assigning C the earlier position.
    seedTask(store, 'run-1', 'task-b', { position: 30 });
    seedTask(store, 'run-1', 'task-c', { position: 20 });
    store.addDependency('task-b', 'task-a');
    store.addDependency('task-c', 'task-a');
    const executor = fakeExecutor(store, { status: 'passed' });
    const nextId = attemptIdFactory();

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.deepEqual(store.getReadyTasks('run-1').map((task) => task.taskId), ['task-c', 'task-b']);
    assert.equal(store.getRun('run-1')?.status, 'running');

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(store.getTask('task-c')?.status, 'passed');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.equal(store.getRun('run-1')?.status, 'running');
    assert.equal(executor.calls(), 2);

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.deepEqual(executor.taskIds(), ['task-a', 'task-c', 'task-b']);
  });
});

test('5E: fan-in keeps C unready until both independently ordered prerequisites pass', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 20 });
    seedTask(store, 'run-1', 'task-b', { position: 10 });
    seedTask(store, 'run-1', 'task-c', { position: 1 });
    store.addDependency('task-c', 'task-a');
    store.addDependency('task-c', 'task-b');
    const executor = fakeExecutor(store, { status: 'passed' });
    const nextId = attemptIdFactory();

    assert.deepEqual(store.getReadyTasks('run-1').map((task) => task.taskId), ['task-b', 'task-a']);
    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(store.getTask('task-c')?.status, 'pending');
    assert.deepEqual(store.getReadyTasks('run-1').map((task) => task.taskId), ['task-a']);
    assert.equal(executor.calls(), 1);

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(store.getTask('task-c')?.status, 'pending');
    assert.deepEqual(store.getReadyTasks('run-1').map((task) => task.taskId), ['task-c']);
    assert.equal(store.getRun('run-1')?.status, 'running');
    assert.equal(executor.calls(), 2);

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.deepEqual(executor.taskIds(), ['task-b', 'task-a', 'task-c']);
  });
});

test('5E: independent Tasks use deterministic store ordering and exactly one execution per tick', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    // Insertion and lexical order both differ from the explicit position order.
    seedTask(store, 'run-1', 'task-a', { position: 30 });
    seedTask(store, 'run-1', 'task-z', { position: 10 });
    seedTask(store, 'run-1', 'task-m', { position: 20 });
    const executor = fakeExecutor(store, { status: 'passed' });
    const nextId = attemptIdFactory();

    assert.deepEqual(store.getReadyTasks('run-1').map((task) => task.taskId), ['task-z', 'task-m', 'task-a']);
    for (const expectedStatus of ['running', 'running', 'completed'] as const) {
      const before = executor.calls();
      await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
      assert.equal(executor.calls(), before + 1);
      assert.equal(store.getRun('run-1')?.status, expectedStatus);
    }
    assert.deepEqual(executor.taskIds(), ['task-z', 'task-m', 'task-a']);
  });
});

test('5E: passed sibling plus pending or running work never completes the Run or duplicates an Attempt', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 10 });
    seedTask(store, 'run-1', 'task-b', { position: 20 });
    store.transitionRun('run-1', 'running');
    markTaskPassedWithAttempt(store, 'task-a', 'att-a');
    const executor = fakeExecutor(store, { status: 'passed', leaveRunning: true });

    assert.equal(store.getTask('task-b')?.status, 'pending');
    const dispatched = await tick(store, {
      runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory(),
    });
    assert.equal(dispatched.outcome, 'attempt-active');
    assert.equal(store.getRun('run-1')?.status, 'running');
    assert.equal(store.getTask('task-b')?.status, 'running');

    const repeated = await tick(store, {
      runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory(),
    });
    assert.equal(repeated.outcome, 'attempt-active');
    assert.equal(store.getRun('run-1')?.status, 'running');
    assert.equal(executor.calls(), 1);
    assert.equal(store.listAttempts('task-b').length, 1);
  });
});

test('5E: terminally failed prerequisite fails the Run and never dispatches its dependent', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a');
    seedTask(store, 'run-1', 'task-b');
    store.addDependency('task-b', 'task-a');
    const executor = fakeExecutor(store, { status: 'failed', emitEventType: 'execution.failed' });
    const nextId = attemptIdFactory();

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(store.getTask('task-a')?.status, 'failed');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.deepEqual(store.getReadyTasks('run-1'), []);
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-b').length, 0);

    const repeated = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(repeated.outcome, 'run-terminal');
    assert.equal(executor.calls(), 1);
    assert.equal(store.listAttempts('task-b').length, 0);
  });
});

test('5E: retrying prerequisite remains pending and unlocks its dependent only after passing', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { spec: RETRY_SPEC_2 });
    seedTask(store, 'run-1', 'task-b');
    store.addDependency('task-b', 'task-a');
    const executor = fakeExecutor(store, (ordinal, context) => context.taskId === 'task-a' && ordinal === 1
      ? { status: 'failed', emitEventType: 'execution.failed' }
      : { status: 'passed' });
    const nextId = attemptIdFactory();

    const retry = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(retry.outcome, 'retry-scheduled');
    assert.equal(store.getTask('task-a')?.status, 'pending');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.deepEqual(store.getReadyTasks('run-1').map((task) => task.taskId), ['task-a']);
    assert.equal(store.getRun('run-1')?.status, 'running');

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(store.getTask('task-a')?.status, 'passed');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.deepEqual(store.getReadyTasks('run-1').map((task) => task.taskId), ['task-b']);

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.deepEqual(executor.taskIds(), ['task-a', 'task-a', 'task-b']);
    assert.deepEqual(store.listAttempts('task-a').map((attempt) => attempt.ordinal), [1, 2]);
    assert.deepEqual(store.listAttempts('task-b').map((attempt) => attempt.ordinal), [1]);
  });
});

test('5E: interrupted prerequisite schedules retry without execution and does not unlock its dependent', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { spec: RETRY_SPEC_2 });
    seedTask(store, 'run-1', 'task-b');
    store.addDependency('task-b', 'task-a');
    store.transitionRun('run-1', 'running');
    store.createAttempt({ attemptId: 'att-old', taskId: 'task-a', hostInstanceId: 'stale-host' });
    const executor = fakeExecutor(store, { status: 'passed' });
    const nextId = attemptIdFactory();

    const recovered = await tick(store, {
      runId: 'run-1', executionPort: executor.port, idGenerator: nextId, hostInstanceId: 'live-host',
    });
    assert.equal(recovered.outcome, 'retry-scheduled');
    assert.deepEqual(recovered.recoveredAttemptIds, ['att-old']);
    assert.equal(store.getAttempt('att-old')?.status, 'interrupted');
    assert.equal(store.getTask('task-a')?.status, 'pending');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.equal(executor.calls(), 0);

    await tick(store, {
      runId: 'run-1', executionPort: executor.port, idGenerator: nextId, hostInstanceId: 'live-host',
    });
    assert.equal(store.getTask('task-a')?.status, 'passed');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.equal(executor.calls(), 1);

    await tick(store, {
      runId: 'run-1', executionPort: executor.port, idGenerator: nextId, hostInstanceId: 'live-host',
    });
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.deepEqual(executor.taskIds(), ['task-a', 'task-b']);
    assert.deepEqual(store.listAttempts('task-a').map((attempt) => attempt.ordinal), [1, 2]);
  });
});

test('5E: durable policy rejection fails a prerequisite and never unlocks its dependent', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { spec: { supervisor: { maxAttempts: 5 } } });
    seedTask(store, 'run-1', 'task-b');
    store.addDependency('task-b', 'task-a');
    const executor = fakeExecutor(store, {
      status: 'failed',
      emitEventType: 'policy.violation',
      failure: { cause: 'provider-process-failure' },
    });

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });
    assert.equal(store.getTask('task-a')?.status, 'failed');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-b').length, 0);
    assert.deepEqual(executor.taskIds(), ['task-a']);
  });
});

test('5E: cancelled prerequisite remains dependency authority and resolves the Run without dispatch', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a');
    seedTask(store, 'run-1', 'task-b');
    store.addDependency('task-b', 'task-a');
    store.transitionRun('run-1', 'running');
    store.transitionTask('task-a', 'cancelled');
    const executor = throwingExecutor();

    const result = await tick(store, {
      runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory(),
    });
    assert.equal(result.outcome, 'no-ready-task');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(executor.calls(), 0);
    assert.equal(store.listAttempts('task-b').length, 0);
  });
});

test('5E: no ready Task while prerequisite work is active keeps the Run running without duplication', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a');
    seedTask(store, 'run-1', 'task-b');
    store.addDependency('task-b', 'task-a');
    store.transitionRun('run-1', 'running');
    store.createAttempt({ attemptId: 'att-live', taskId: 'task-a', hostInstanceId: HOST_INSTANCE_ID });
    const executor = throwingExecutor();

    const result = await tick(store, {
      runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory(),
    });
    assert.equal(result.outcome, 'attempt-active');
    assert.equal(store.getRun('run-1')?.status, 'running');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.equal(executor.calls(), 0);
    assert.equal(store.listAttempts('task-a').length, 1);
    assert.equal(store.listAttempts('task-b').length, 0);
  });
});

test('5E: all-passed crash state reconciles the Run once and later ticks are terminal no-ops', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a');
    seedTask(store, 'run-1', 'task-b');
    store.transitionRun('run-1', 'running');
    markTaskPassedWithAttempt(store, 'task-a', 'att-a');
    markTaskPassedWithAttempt(store, 'task-b', 'att-b');
    const executor = throwingExecutor();

    const reconciled = await tick(store, {
      runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory(),
    });
    assert.equal(reconciled.outcome, 'no-ready-task');
    assert.equal(reconciled.runAction?.type, 'MARK_RUN_COMPLETED');
    assert.equal(store.getRun('run-1')?.status, 'completed');

    const repeated = await tick(store, {
      runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory(),
    });
    assert.equal(repeated.outcome, 'run-terminal');
    assert.equal(executor.calls(), 0);
  });
});

test('5E: terminal prerequisite Attempt reconciles now and unlocks its dependent only on the next tick', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a');
    seedTask(store, 'run-1', 'task-b');
    store.addDependency('task-b', 'task-a');
    store.transitionRun('run-1', 'running');
    store.createAttempt({ attemptId: 'att-a', taskId: 'task-a', hostInstanceId: HOST_INSTANCE_ID });
    store.transitionAttempt('att-a', 'passed');
    const executor = fakeExecutor(store, { status: 'passed' });

    const reconciled = await tick(store, {
      runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory(),
    });
    assert.equal(reconciled.outcome, 'task-reconciled');
    assert.equal(store.getTask('task-a')?.status, 'passed');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.equal(store.getRun('run-1')?.status, 'running');
    assert.equal(executor.calls(), 0);

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });
    assert.equal(store.getTask('task-b')?.status, 'passed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.deepEqual(executor.taskIds(), ['task-b']);
  });
});

test('5E: crash after the last Task Attempt passed completes the Run without provider execution', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a');
    seedTask(store, 'run-1', 'task-b');
    store.transitionRun('run-1', 'running');
    markTaskPassedWithAttempt(store, 'task-a', 'att-a');
    store.createAttempt({ attemptId: 'att-b', taskId: 'task-b', hostInstanceId: HOST_INSTANCE_ID });
    store.transitionAttempt('att-b', 'passed');
    const executor = throwingExecutor();

    const result = await tick(store, {
      runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory(),
    });
    assert.equal(result.outcome, 'task-reconciled');
    assert.equal(store.getTask('task-b')?.status, 'passed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.equal(executor.calls(), 0);
    assert.equal(store.listAttempts('task-b').length, 1);
  });
});

// ─── ORCH-5F: human-gate (stop-at-gate) ────────────────────────────────────────

// A durable policy change carrying the positive `requiresHuman` field (from
// PolicyDecisionKind === 'require-human'). Detection uses that field only.
function gatePlan(): FakeExecutorPlan {
  return {
    status: 'failed',
    emitEventType: 'policy.evaluated',
    emitPayload: {
      accepted: false,
      decision: 'deny',
      changes: [
        {
          path: 'src/store/authStore.ts',
          category: 'PROTECTED_CHANGE',
          decision: 'deny',
          requiresHuman: true,
          reasonCode: 'protected-path',
        },
      ],
    },
  };
}

// Ordinary policy rejection: denied, but NO requiresHuman evidence.
function policyRejectPlan(): FakeExecutorPlan {
  return {
    status: 'failed',
    emitEventType: 'policy.evaluated',
    emitPayload: {
      accepted: false,
      decision: 'deny',
      changes: [{ path: 'src/x.ts', category: 'OUT_OF_SCOPE_CHANGE', decision: 'deny', reasonCode: 'out-of-scope-write' }],
    },
  };
}

function blockedEventCount(store: OrchestrationStore): number {
  return store.listEvents().filter((event) => event.type === SUPERVISOR_BLOCKED_EVENT).length;
}

test('5F: require-human blocks the Task and pauses the Run (no retry, one blocked event)', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: { supervisor: { maxAttempts: 10 } } });
    const executor = fakeExecutor(store, gatePlan());

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'paused-for-gate');
    assert.equal(result.gate?.attemptId, 'att-1');
    assert.equal(result.gate?.gateKind, 'protected-path');
    assert.equal(executor.calls(), 1);
    assert.equal(store.getTask('task-1')?.status, 'blocked');
    assert.equal(store.getRun('run-1')?.status, 'paused');
    assert.equal(store.listAttempts('task-1').length, 1);
    // maxAttempts=10 must not trigger a retry; human approval always wins.
    assert.equal(result.retry, null);
    assert.equal(store.listEvents().filter((e) => e.type === SUPERVISOR_RETRY_SCHEDULED_EVENT).length, 0);
    // Exactly one durable supervisor.blocked event with safe payload.
    assert.equal(blockedEventCount(store), 1);
    const blocked = store.listEvents().find((e) => e.type === SUPERVISOR_BLOCKED_EVENT);
    assert.equal(blocked?.taskId, 'task-1');
    assert.equal(blocked?.attemptId, 'att-1');
    assert.deepEqual(blocked?.payload, { reason: 'human-gate', gateKind: 'protected-path' });
  });
});

test('5F: repeated tick on a paused Run is idempotent (no new Attempt, no duplicate event)', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    const executor = fakeExecutor(store, gatePlan());
    const nextId = attemptIdFactory();

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(store.getRun('run-1')?.status, 'paused');
    assert.equal(blockedEventCount(store), 1);

    const again = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(again.outcome, 'run-paused');
    assert.equal(again.attemptCreated, false);
    assert.equal(again.executed, false);
    assert.equal(executor.calls(), 1);
    assert.equal(store.listAttempts('task-1').length, 1);
    assert.equal(blockedEventCount(store), 1);
    // No auto-resume.
    assert.equal(store.getRun('run-1')?.status, 'paused');
  });
});

test('5F: a gated Task keeps its dependents locked while the Run is paused', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 0 });
    seedTask(store, 'run-1', 'task-b', { position: 1 });
    store.addDependency('task-b', 'task-a');
    const executor = fakeExecutor(store, gatePlan());
    const nextId = attemptIdFactory();

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(store.getTask('task-a')?.status, 'blocked');
    assert.equal(store.getRun('run-1')?.status, 'paused');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.equal(store.listAttempts('task-b').length, 0);

    const again = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(again.outcome, 'run-paused');
    assert.equal(store.listAttempts('task-b').length, 0);
    assert.equal(executor.calls(), 1);
  });
});

test('5F: an independent Task does not execute while the Run is paused', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 0 }); // gates
    seedTask(store, 'run-1', 'task-b', { position: 1 }); // independent, ready
    const executor = fakeExecutor(store, gatePlan());
    const nextId = attemptIdFactory();

    const first = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(first.outcome, 'paused-for-gate');
    assert.equal(first.taskId, 'task-a');

    const second = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(second.outcome, 'run-paused');
    // task-b never ran even though it was independent and ready.
    assert.equal(executor.calls(), 1);
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.equal(store.listAttempts('task-b').length, 0);
  });
});

test('5F: ordinary policy rejection stays terminal and non-retryable, never paused', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: { supervisor: { maxAttempts: 5 } } });
    const executor = fakeExecutor(store, policyRejectPlan());

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'task-executed');
    assert.equal(store.getTask('task-1')?.status, 'failed');
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-1').length, 1);
    assert.equal(blockedEventCount(store), 0);
    assert.equal(store.listEvents().filter((e) => e.type === SUPERVISOR_RETRY_SCHEDULED_EVENT).length, 0);
  });
});

test('5F: unknown failure stays fail-closed terminal, never paused', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: RETRY_SPEC_2 });
    const executor = fakeExecutor(store, { status: 'failed' }); // no durable evidence, no hint

    const result = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    assert.equal(result.outcome, 'task-executed');
    assert.equal(store.getTask('task-1')?.status, 'failed');
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(blockedEventCount(store), 0);
  });
});

test('5F: a cancelled Run is never resumed after being paused', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    const executor = fakeExecutor(store, gatePlan());
    const nextId = attemptIdFactory();

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(store.getRun('run-1')?.status, 'paused');

    store.transitionRun('run-1', 'cancelled'); // owner cancels the paused Run
    const after = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(after.outcome, 'run-terminal');
    assert.equal(store.getRun('run-1')?.status, 'cancelled');
    assert.equal(executor.calls(), 1);
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

// ─── ORCH-5F: verifier as an ordinary dependent Task ───────────────────────────

test('5F: verifier Task runs only after its implementer passes, then completes the Run', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 0 });
    // Verifier: ordinary Task, depends on A, carrying routing metadata in spec.
    seedTask(store, 'run-1', 'task-v', { position: 1, spec: { permissionProfile: 'verifier' } });
    store.addDependency('task-v', 'task-a');
    const executor = fakeExecutor(store, { status: 'passed' });
    const nextId = attemptIdFactory();

    const first = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(first.taskId, 'task-a');
    assert.equal(store.getTask('task-a')?.status, 'passed');
    assert.equal(store.getTask('task-v')?.status, 'pending');
    assert.equal(store.getRun('run-1')?.status, 'running');
    assert.equal(store.listAttempts('task-v').length, 0);

    const second = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    assert.equal(second.taskId, 'task-v');
    assert.equal(store.getTask('task-v')?.status, 'passed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
    // Exactly one execution per tick, verifier strictly after implementer.
    assert.deepEqual(executor.taskIds(), ['task-a', 'task-v']);
    // No verifier-specific lifecycle: profile metadata did not change scheduling.
  });
});

test('5F: verifier failure fails the Run while the implementer stays passed', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 0 });
    seedTask(store, 'run-1', 'task-v', { position: 1, spec: { permissionProfile: 'verifier' } });
    store.addDependency('task-v', 'task-a');
    const executor = fakeExecutor(store, (_ordinal, context) =>
      context.taskId === 'task-v'
        ? { status: 'failed', emitEventType: 'execution.failed' }
        : { status: 'passed' },
    );
    const nextId = attemptIdFactory();

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    const second = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });

    assert.equal(second.taskId, 'task-v');
    assert.equal(store.getTask('task-v')?.status, 'failed');
    assert.equal(store.getRun('run-1')?.status, 'failed');
    // Implementer output is neither rolled back nor auto-applied.
    assert.equal(store.getTask('task-a')?.status, 'passed');
  });
});

test('5F: verifier uses the standard bounded-retry machinery', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 0 });
    seedTask(store, 'run-1', 'task-v', { position: 1, spec: { permissionProfile: 'verifier', supervisor: { maxAttempts: 2 } } });
    store.addDependency('task-v', 'task-a');
    const executor = fakeExecutor(store, (ordinal, context) => {
      if (context.taskId !== 'task-v') return { status: 'passed' };
      return ordinal === 1 ? { status: 'failed', emitEventType: 'execution.timed_out' } : { status: 'passed' };
    });
    const nextId = attemptIdFactory();

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId }); // A passes
    const vFail = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId }); // V1 timeout
    assert.equal(vFail.outcome, 'retry-scheduled');
    assert.equal(vFail.retry?.reasonCode, 'execution-timeout');

    const vPass = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId }); // V2 passes
    assert.equal(vPass.taskId, 'task-v');
    assert.equal(store.getTask('task-v')?.status, 'passed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.equal(store.listAttempts('task-v').length, 2);
  });
});

test('5F: a gated verifier pauses the Run identically', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 0 });
    seedTask(store, 'run-1', 'task-v', { position: 1, spec: { permissionProfile: 'verifier' } });
    store.addDependency('task-v', 'task-a');
    const executor = fakeExecutor(store, (_ordinal, context) =>
      context.taskId === 'task-v' ? gatePlan() : { status: 'passed' },
    );
    const nextId = attemptIdFactory();

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId }); // A passes
    const gated = await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId }); // V gates

    assert.equal(gated.outcome, 'paused-for-gate');
    assert.equal(gated.taskId, 'task-v');
    assert.equal(store.getTask('task-v')?.status, 'blocked');
    assert.equal(store.getRun('run-1')?.status, 'paused');
    assert.equal(blockedEventCount(store), 1);
  });
});

test('5F: the Supervisor never auto-creates a verifier Task', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a');
    const executor = fakeExecutor(store, { status: 'passed' });

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: attemptIdFactory() });

    // Run completes with exactly the authored Tasks; no verifier is fabricated.
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.equal(store.listTasks('run-1').length, 1);
    assert.equal(store.listTasks('run-1')[0]?.taskId, 'task-a');
  });
});

test('5F: verification completes orchestration without applying the implementer changeset', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 0 });
    seedTask(store, 'run-1', 'task-v', { position: 1, spec: { permissionProfile: 'verifier' } });
    store.addDependency('task-v', 'task-a');
    // Implementer produces an accepted changeset; verifier later passes.
    const executor = fakeExecutor(store, (_ordinal, context) =>
      context.taskId === 'task-a'
        ? { status: 'passed', emitEventType: 'workspace.changeset.ready' }
        : { status: 'passed' },
    );
    const nextId = attemptIdFactory();

    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });
    await tick(store, { runId: 'run-1', executionPort: executor.port, idGenerator: nextId });

    assert.equal(store.getRun('run-1')?.status, 'completed');
    // The changeset-ready signal is preserved (not consumed/applied/cleaned by 5F).
    assert.equal(store.listEvents().filter((e) => e.type === 'workspace.changeset.ready').length, 1);
  });
});
