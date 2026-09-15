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
}

function fakeExecutor(
  store: OrchestrationStore,
  planFor: FakeExecutorPlan | ((ordinal: number) => FakeExecutorPlan),
): FakeExecutor {
  let calls = 0;
  let eventSeq = 0;
  return {
    calls: () => calls,
    port: {
      execute(context) {
        calls += 1;
        const plan = typeof planFor === 'function' ? planFor(context.attemptOrdinal) : planFor;
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
