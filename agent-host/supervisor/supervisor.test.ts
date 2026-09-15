import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openOrchestrationStore, type OrchestrationStore } from '../lib/store.ts';
import type { AttemptStatus, JsonValue } from '../lib/orchestrationTypes.ts';
import { supervisorTick, type ExecutionPort } from './supervisor.ts';
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
  failure?: AttemptFailureSummary;
  /** When true, the port leaves the Attempt running (does not terminalize it). */
  leaveRunning?: boolean;
}

interface FakeExecutor {
  port: ExecutionPort;
  calls: () => number;
}

function fakeExecutor(store: OrchestrationStore, plan: FakeExecutorPlan): FakeExecutor {
  let calls = 0;
  return {
    calls: () => calls,
    port: {
      execute(context) {
        calls += 1;
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

// (1) pending Run + pending Task + fake passed Attempt → completed / passed / one Attempt.
test('supervisor: single passed Task completes the Run with exactly one Attempt', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    const executor = fakeExecutor(store, { status: 'passed' });

    const result = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

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
    assert.equal(attempts[0]?.hostInstanceId, HOST_INSTANCE_ID);
    assert.equal(attempts[0]?.ordinal, 1);
  });
});

// (2) pending Run + pending Task + fake failed Attempt / default maxAttempts 1
//     → Run failed / Task failed / one Attempt / no automatic retry.
test('supervisor: default failure fails the Task and Run with no retry', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    const executor = fakeExecutor(store, { status: 'failed' });

    const result = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

    assert.equal(result.outcome, 'task-executed');
    assert.equal(executor.calls(), 1);
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.getTask('task-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

// (3) terminal Run → no Attempt / no execution / no resurrection, even with a ready Task.
test('supervisor: terminal Run schedules nothing', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    store.transitionRun('run-1', 'cancelled');
    const executor = throwingExecutor();

    const result = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

    assert.equal(result.outcome, 'run-terminal');
    assert.equal(result.attemptCreated, false);
    assert.equal(result.executed, false);
    assert.equal(executor.calls(), 0);
    assert.equal(store.getRun('run-1')?.status, 'cancelled');
    assert.equal(store.getTask('task-1')?.status, 'pending');
    assert.equal(store.listAttempts('task-1').length, 0);
  });
});

// (4) zero Tasks → no Attempt / no execution / do not vacuously complete or churn.
test('supervisor: zero-Task Run makes no progress', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    const executor = throwingExecutor();

    const result = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

    assert.equal(result.outcome, 'zero-tasks');
    assert.equal(result.attemptCreated, false);
    assert.equal(result.executed, false);
    assert.equal(executor.calls(), 0);
    // No vacuous completion and no pending → running churn.
    assert.equal(store.getRun('run-1')?.status, 'pending');
  });
});

// (5) running Task + running Attempt → no duplicate Attempt / no execution call.
test('supervisor: a running Attempt is never duplicated', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    // Create a live Attempt (Task → running, Attempt → running) without terminalizing it.
    store.createAttempt({ attemptId: 'att-pre', taskId: 'task-1', hostInstanceId: HOST_INSTANCE_ID });
    const executor = throwingExecutor();

    const result = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

    assert.equal(result.outcome, 'attempt-active');
    assert.equal(result.attemptCreated, false);
    assert.equal(result.executed, false);
    assert.equal(executor.calls(), 0);
    assert.equal(store.getTask('task-1')?.status, 'running');
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

// (6) running Task + passed Attempt → reconcile to passed/completed without execution.
test('supervisor: reconciles a passed Attempt without executing', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    store.createAttempt({ attemptId: 'att-pre', taskId: 'task-1', hostInstanceId: HOST_INSTANCE_ID });
    store.transitionAttempt('att-pre', 'passed');
    const executor = throwingExecutor();

    const result = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

    assert.equal(result.outcome, 'task-reconciled');
    assert.equal(result.attemptCreated, false);
    assert.equal(result.executed, false);
    assert.equal(executor.calls(), 0);
    assert.equal(store.getTask('task-1')?.status, 'passed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

// (7) running Task + failed Attempt + budget exhausted → reconcile to failed without execution.
test('supervisor: reconciles an exhausted failed Attempt without executing', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    store.createAttempt({ attemptId: 'att-pre', taskId: 'task-1', hostInstanceId: HOST_INSTANCE_ID });
    store.transitionAttempt('att-pre', 'failed');
    const executor = throwingExecutor();

    const result = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

    assert.equal(result.outcome, 'task-reconciled');
    assert.equal(result.executed, false);
    assert.equal(executor.calls(), 0);
    assert.equal(store.getTask('task-1')?.status, 'failed');
    assert.equal(store.getRun('run-1')?.status, 'failed');
    assert.equal(store.listAttempts('task-1').length, 1);
  });
});

// (8) retry-eligible failure → no second Attempt / retry deferred / Run not completed.
test('supervisor: a retryable failure defers the retry without a second Attempt', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1', { spec: { supervisor: { maxAttempts: 2 } } });
    const executor = fakeExecutor(store, {
      status: 'failed',
      failure: { cause: 'provider-process-failure' },
    });

    const result = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

    assert.equal(result.outcome, 'retry-deferred');
    assert.equal(result.attemptCreated, true);
    assert.equal(result.executed, true);
    assert.equal(executor.calls(), 1);
    assert.deepEqual(result.retry, {
      completedAttemptOrdinal: 1,
      nextAttemptOrdinal: 2,
      maxAttempts: 2,
    });
    // No second Attempt, and the Run is not incorrectly completed or failed.
    assert.equal(store.listAttempts('task-1').length, 1);
    assert.equal(store.getRun('run-1')?.status, 'running');
    assert.notEqual(store.getTask('task-1')?.status, 'passed');
  });
});

// (9) repeated tick after a completed Run → idempotent, no new Attempt/execution.
test('supervisor: repeated ticks after completion are idempotent', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    const executor = fakeExecutor(store, { status: 'passed' });
    const nextAttemptId = attemptIdFactory();

    const first = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: nextAttemptId,
    });
    assert.equal(first.outcome, 'task-executed');
    assert.equal(store.getRun('run-1')?.status, 'completed');

    const second = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: nextAttemptId,
    });

    assert.equal(second.outcome, 'run-terminal');
    assert.equal(second.attemptCreated, false);
    assert.equal(second.executed, false);
    assert.equal(executor.calls(), 1);
    assert.equal(store.listAttempts('task-1').length, 1);
    assert.equal(store.getRun('run-1')?.status, 'completed');
  });
});

// (10) multiple ready Tasks → only the first durable-ready Task executes (one Attempt).
test('supervisor: executes only the first ready Task per tick', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-a', { position: 0 });
    seedTask(store, 'run-1', 'task-b', { position: 1 });
    const executor = fakeExecutor(store, { status: 'passed' });

    const result = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

    assert.equal(result.outcome, 'task-executed');
    assert.equal(result.taskId, 'task-a');
    assert.equal(executor.calls(), 1);
    assert.equal(store.getTask('task-a')?.status, 'passed');
    assert.equal(store.getTask('task-b')?.status, 'pending');
    assert.equal(store.listAttempts('task-a').length, 1);
    assert.equal(store.listAttempts('task-b').length, 0);
    // The Run keeps progressing; it is not completed while task-b is pending.
    assert.equal(store.getRun('run-1')?.status, 'running');
  });
});

// (durable authority) the Attempt status comes from the store, not the in-memory hint.
test('supervisor: durable Attempt status overrides the in-memory execution hint', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    // Executor durably marks the Attempt passed but returns a misleading failure hint.
    const executor = fakeExecutor(store, {
      status: 'passed',
      failure: { cause: 'provider-process-failure' },
    });

    const result = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

    assert.equal(result.outcome, 'task-executed');
    assert.equal(store.getTask('task-1')?.status, 'passed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
  });
});

// (durable authority) an Attempt the executor leaves running yields no fabricated terminal Task.
test('supervisor: a non-terminalized Attempt is treated as active', async () => {
  await withStore(async (store) => {
    seedRun(store, 'run-1');
    seedTask(store, 'run-1', 'task-1');
    const executor = fakeExecutor(store, { status: 'passed', leaveRunning: true });

    const result = await supervisorTick({
      store,
      runId: 'run-1',
      hostInstanceId: HOST_INSTANCE_ID,
      executionPort: executor.port,
      idGenerator: attemptIdFactory(),
    });

    assert.equal(result.outcome, 'attempt-active');
    assert.equal(result.attemptCreated, true);
    assert.equal(result.executed, true);
    assert.equal(executor.calls(), 1);
    assert.equal(store.getTask('task-1')?.status, 'running');
    assert.equal(store.getRun('run-1')?.status, 'running');
    const attempts = store.listAttempts('task-1');
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.status, 'running');
  });
});
