import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openOrchestrationStore, type OrchestrationStore } from '../lib/store.ts';
import type { AttemptStatus, JsonValue } from '../lib/orchestrationTypes.ts';
import {
  supervisorTick,
  SUPERVISOR_RETRY_SCHEDULED_EVENT,
  SUPERVISOR_BLOCKED_EVENT,
  type AttemptExecutionContext,
  type ExecutionPort,
  type SupervisorTickResult,
} from './supervisor.ts';

const HOST = 'host-e2e-1';
const TERMINAL_RUN = new Set(['completed', 'failed', 'cancelled']);

async function withStore(work: (store: OrchestrationStore) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orch-e2e-'));
  const dbPath = path.join(tempDir, 'orchestration.sqlite');
  let eventCounter = 0;
  const store = openOrchestrationStore({
    dbPath,
    repoKey: 'repo-key-e2e',
    hostId: 'host-e2e',
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

function attemptIds(): () => string {
  let n = 0;
  return () => `att-${++n}`;
}

interface ScriptedPlan {
  status: AttemptStatus;
  emitEventType?: string;
  emitPayload?: JsonValue;
  leaveRunning?: boolean;
}

interface ScriptedExecutor {
  port: ExecutionPort;
  calls: () => number;
  order: () => readonly string[];
}

/**
 * Provider-neutral fake execution port. The script may inspect the durable Task
 * routing profile (context.task.spec.permissionProfile) and attempt ordinal to
 * decide scripted behavior — the Supervisor lifecycle itself never branches on it.
 */
function scriptedExecutor(
  store: OrchestrationStore,
  script: (context: AttemptExecutionContext) => ScriptedPlan,
): ScriptedExecutor {
  let calls = 0;
  let seq = 0;
  const order: string[] = [];
  return {
    calls: () => calls,
    order: () => order,
    port: {
      execute(context) {
        calls += 1;
        order.push(context.taskId);
        const plan = script(context);
        if (plan.emitEventType) {
          store.appendEvent({
            eventId: `fake-${context.attemptId}-${++seq}`,
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
      },
    },
  };
}

function profileOf(context: AttemptExecutionContext): string | null {
  const spec = context.task.spec;
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const value = (spec as Record<string, JsonValue>).permissionProfile;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

interface TickRecord {
  outcome: SupervisorTickResult['outcome'];
  taskId: string | null;
  executed: boolean;
  attemptCreated: boolean;
  delta: number;
}

/** Drive supervisorTick to a terminal/paused Run, proving ≤1 execution per tick. */
async function drive(
  store: OrchestrationStore,
  runId: string,
  executor: ScriptedExecutor,
  idGenerator: () => string,
  host = HOST,
): Promise<{ log: TickRecord[]; status: string }> {
  const log: TickRecord[] = [];
  for (let i = 0; i < 40; i += 1) {
    const before = executor.calls();
    const result = await supervisorTick({
      store,
      runId,
      hostInstanceId: host,
      executionPort: executor.port,
      idGenerator,
    });
    const delta = executor.calls() - before;
    assert.ok(delta <= 1, `tick ${i} invoked the execution port ${delta} times (must be <= 1)`);
    log.push({
      outcome: result.outcome,
      taskId: result.taskId,
      executed: result.executed,
      attemptCreated: result.attemptCreated,
      delta,
    });
    const status = store.getRun(runId)?.status ?? 'unknown';
    if (TERMINAL_RUN.has(status) || status === 'paused') {
      return { log, status };
    }
  }
  throw new Error('Run did not reach a terminal/paused state within the tick budget');
}

function attemptSummary(store: OrchestrationStore, taskId: string): Array<{ ordinal: number; status: AttemptStatus }> {
  return store.listAttempts(taskId).map((attempt) => ({ ordinal: attempt.ordinal, status: attempt.status }));
}

interface ControlTowerSnapshot {
  runStatus: string;
  tasks: Array<{
    taskId: string;
    status: string;
    permissionProfile: string | null;
    attempts: Array<{ ordinal: number; status: AttemptStatus }>;
  }>;
  retryScheduled: number;
  blocked: Array<{ taskId: string | null; attemptId: string | null; gateKind: JsonValue | undefined }>;
  changesetReady: boolean;
}

/** Reconstruct a Control Tower-readable view purely from durable store + events. */
function controlTowerSnapshot(store: OrchestrationStore, runId: string): ControlTowerSnapshot {
  const run = store.getRun(runId);
  const events = store.listEvents();
  return {
    runStatus: run?.status ?? 'unknown',
    tasks: store.listTasks(runId).map((task) => {
      const spec = task.spec;
      const permissionProfile =
        spec && typeof spec === 'object' && !Array.isArray(spec) && typeof (spec as Record<string, JsonValue>).permissionProfile === 'string'
          ? ((spec as Record<string, JsonValue>).permissionProfile as string)
          : null;
      return {
        taskId: task.taskId,
        status: task.status,
        permissionProfile,
        attempts: attemptSummary(store, task.taskId),
      };
    }),
    retryScheduled: events.filter((event) => event.type === SUPERVISOR_RETRY_SCHEDULED_EVENT).length,
    blocked: events
      .filter((event) => event.type === SUPERVISOR_BLOCKED_EVENT)
      .map((event) => ({
        taskId: event.taskId,
        attemptId: event.attemptId,
        gateKind: event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
          ? (event.payload as Record<string, JsonValue>).gateKind
          : undefined,
      })),
    changesetReady: events.some((event) => event.type === 'workspace.changeset.ready'),
  };
}

const IMPLEMENTER: JsonValue = { permissionProfile: 'task-implementer' };
const IMPLEMENTER_RETRY_2: JsonValue = { permissionProfile: 'task-implementer', supervisor: { maxAttempts: 2 } };
const VERIFIER: JsonValue = { permissionProfile: 'verifier' };

function gateChangePayload(): JsonValue {
  return {
    accepted: false,
    decision: 'deny',
    changes: [
      { path: 'src/store/authStore.ts', category: 'PROTECTED_CHANGE', decision: 'deny', requiresHuman: true, reasonCode: 'protected-path' },
    ],
  };
}

// ─── Primary autonomous Run: A → B (retry) → V, to completion ───────────────────

test('5G/E2E: autonomous Run drives A → B(retry) → V to completion with one execution per tick', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'Autonomous run' });
    store.createTask({ runId: 'run-1', taskId: 'task-a', title: 'A', position: 0, spec: IMPLEMENTER });
    store.createTask({ runId: 'run-1', taskId: 'task-b', title: 'B', position: 1, spec: IMPLEMENTER_RETRY_2 });
    store.createTask({ runId: 'run-1', taskId: 'task-v', title: 'V', position: 2, spec: VERIFIER });
    store.addDependency('task-b', 'task-a');
    store.addDependency('task-v', 'task-b');

    const executor = scriptedExecutor(store, (context) => {
      const profile = profileOf(context);
      if (context.taskId === 'task-b' && context.attemptOrdinal === 1) {
        return { status: 'failed', emitEventType: 'execution.timed_out' };
      }
      // Implementers emit an accepted changeset on success; verifier does not.
      if (profile === 'task-implementer') {
        return { status: 'passed', emitEventType: 'workspace.changeset.ready' };
      }
      return { status: 'passed' };
    });

    const { log, status } = await drive(store, 'run-1', executor, attemptIds());

    assert.equal(status, 'completed');
    assert.equal(store.getRun('run-1')?.status, 'completed');
    assert.equal(store.getTask('task-a')?.status, 'passed');
    assert.equal(store.getTask('task-b')?.status, 'passed');
    assert.equal(store.getTask('task-v')?.status, 'passed');

    // Exact Attempt ledger: A1 passed, B1 failed, B2 passed, V1 passed. No ordinal 3.
    assert.deepEqual(attemptSummary(store, 'task-a'), [{ ordinal: 1, status: 'passed' }]);
    assert.deepEqual(attemptSummary(store, 'task-b'), [
      { ordinal: 1, status: 'failed' },
      { ordinal: 2, status: 'passed' },
    ]);
    assert.deepEqual(attemptSummary(store, 'task-v'), [{ ordinal: 1, status: 'passed' }]);

    // Exact DAG execution order — V never before B passed, B never before A passed.
    assert.deepEqual(executor.order(), ['task-a', 'task-b', 'task-b', 'task-v']);

    // The retry-scheduling tick executed exactly once (B1) and did NOT run B2.
    const retryTick = log.find((entry) => entry.outcome === 'retry-scheduled');
    assert.ok(retryTick, 'expected a retry-scheduled tick');
    assert.equal(retryTick?.taskId, 'task-b');
    assert.equal(retryTick?.delta, 1);
    assert.equal(retryTick?.executed, true);

    // Exactly one durable retry event; no duplicate terminal transitions.
    assert.equal(store.listEvents().filter((e) => e.type === SUPERVISOR_RETRY_SCHEDULED_EVENT).length, 1);
    assert.equal(store.listEvents().filter((e) => e.type === 'run.status.changed' && (e.payload as Record<string, JsonValue>)?.nextStatus === 'completed').length, 1);

    // Control Tower reconstruction from durable state alone.
    const snapshot = controlTowerSnapshot(store, 'run-1');
    assert.equal(snapshot.runStatus, 'completed');
    assert.equal(snapshot.retryScheduled, 1);
    assert.equal(snapshot.changesetReady, true);
    assert.deepEqual(
      snapshot.tasks.map((t) => [t.taskId, t.status, t.permissionProfile]),
      [
        ['task-a', 'passed', 'task-implementer'],
        ['task-b', 'passed', 'task-implementer'],
        ['task-v', 'passed', 'verifier'],
      ],
    );

    // Run-terminal idempotency: another tick does nothing.
    const before = executor.calls();
    const again = await supervisorTick({ store, runId: 'run-1', hostInstanceId: HOST, executionPort: executor.port, idGenerator: attemptIds() });
    assert.equal(again.outcome, 'run-terminal');
    assert.equal(executor.calls(), before);
    assert.equal(store.listAttempts('task-v').length, 1);
  });
});

// ─── Restart reconciliation: terminal Attempt propagated without redispatch ─────

test('5G/E2E: restart reconciles a passed Attempt without re-executing, then continues', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'Restart run' });
    store.createTask({ runId: 'run-1', taskId: 'task-a', title: 'A', position: 0, spec: IMPLEMENTER });
    store.createTask({ runId: 'run-1', taskId: 'task-b', title: 'B', position: 1, spec: IMPLEMENTER });
    store.addDependency('task-b', 'task-a');
    // Simulate a crash after A1 terminalized passed but before the Task propagated.
    store.transitionRun('run-1', 'running');
    store.createAttempt({ attemptId: 'att-a1', taskId: 'task-a', hostInstanceId: HOST });
    store.transitionAttempt('att-a1', 'passed');
    assert.equal(store.getTask('task-a')?.status, 'running');

    const executor = scriptedExecutor(store, () => ({ status: 'passed' }));
    const { status } = await drive(store, 'run-1', executor, attemptIds());

    assert.equal(status, 'completed');
    assert.equal(store.getTask('task-a')?.status, 'passed');
    assert.equal(store.getTask('task-b')?.status, 'passed');
    // A was reconciled, never re-executed; only B ran.
    assert.deepEqual(executor.order(), ['task-b']);
    assert.equal(store.listAttempts('task-a').length, 1);
    assert.equal(store.listAttempts('task-b').length, 1);
  });
});

// ─── Interrupted-host recovery: stale Attempt → interrupted → retry → next ──────

test('5G/E2E: interrupted-host recovery reschedules then runs the next ordinal', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'Interrupted run' });
    store.createTask({ runId: 'run-1', taskId: 'task-a', title: 'A', position: 0, spec: IMPLEMENTER_RETRY_2 });
    store.transitionRun('run-1', 'running');
    // Old host owns a running Attempt 1.
    store.createAttempt({ attemptId: 'att-old', taskId: 'task-a', hostInstanceId: 'old-host' });

    const executor = scriptedExecutor(store, () => ({ status: 'passed' }));
    const nextId = attemptIds();

    // Recovery tick (new host): interrupts att-old, reschedules, NO execution.
    const recovery = await supervisorTick({ store, runId: 'run-1', hostInstanceId: 'new-host', executionPort: executor.port, idGenerator: nextId });
    assert.equal(recovery.outcome, 'retry-scheduled');
    assert.deepEqual(recovery.recoveredAttemptIds, ['att-old']);
    assert.equal(executor.calls(), 0);
    assert.equal(store.getAttempt('att-old')?.status, 'interrupted');

    const { status } = await drive(store, 'run-1', executor, nextId, 'new-host');
    assert.equal(status, 'completed');
    assert.equal(store.getTask('task-a')?.status, 'passed');
    // Ordinal 2 created and run once; interrupted Attempt never reused.
    const attempts = attemptSummary(store, 'task-a');
    assert.deepEqual(attempts, [
      { ordinal: 1, status: 'interrupted' },
      { ordinal: 2, status: 'passed' },
    ]);
    assert.equal(executor.calls(), 1);
  });
});

// ─── Human-gate: Run pauses and stays paused (idempotent) ───────────────────────

test('5G/E2E: human gate pauses the Run and remains paused across ticks', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'Gated run' });
    store.createTask({ runId: 'run-1', taskId: 'task-a', title: 'A', position: 0, spec: { permissionProfile: 'task-implementer', supervisor: { maxAttempts: 5 } } });
    const executor = scriptedExecutor(store, () => ({ status: 'failed', emitEventType: 'policy.evaluated', emitPayload: gateChangePayload() }));
    const nextId = attemptIds();

    const { status, log } = await drive(store, 'run-1', executor, nextId);
    assert.equal(status, 'paused');
    assert.equal(log.at(-1)?.outcome, 'paused-for-gate');
    assert.equal(store.getTask('task-a')?.status, 'blocked');
    assert.equal(store.getRun('run-1')?.status, 'paused');
    assert.equal(store.listEvents().filter((e) => e.type === SUPERVISOR_BLOCKED_EVENT).length, 1);
    // maxAttempts=5 did not trigger a retry.
    assert.equal(store.listEvents().filter((e) => e.type === SUPERVISOR_RETRY_SCHEDULED_EVENT).length, 0);

    // Paused idempotency: further ticks are inert (no execution, no duplicate event, no resume).
    const before = executor.calls();
    const again = await supervisorTick({ store, runId: 'run-1', hostInstanceId: HOST, executionPort: executor.port, idGenerator: nextId });
    assert.equal(again.outcome, 'run-paused');
    assert.equal(executor.calls(), before);
    assert.equal(store.listAttempts('task-a').length, 1);
    assert.equal(store.listEvents().filter((e) => e.type === SUPERVISOR_BLOCKED_EVENT).length, 1);
    assert.equal(store.getRun('run-1')?.status, 'paused');

    // Control Tower can read the paused/blocked reason from durable state.
    const snapshot = controlTowerSnapshot(store, 'run-1');
    assert.equal(snapshot.runStatus, 'paused');
    assert.equal(snapshot.blocked.length, 1);
    assert.equal(snapshot.blocked[0]?.gateKind, 'protected-path');
  });
});

// ─── Terminal failure: non-retryable rejection fails the Run, dependents locked ─

test('5G/E2E: non-retryable failure fails the Run and never runs the dependent verifier', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'Failing run' });
    store.createTask({ runId: 'run-1', taskId: 'task-a', title: 'A', position: 0, spec: IMPLEMENTER });
    store.createTask({ runId: 'run-1', taskId: 'task-b', title: 'B', position: 1, spec: { permissionProfile: 'task-implementer', supervisor: { maxAttempts: 3 } } });
    store.createTask({ runId: 'run-1', taskId: 'task-v', title: 'V', position: 2, spec: VERIFIER });
    store.addDependency('task-b', 'task-a');
    store.addDependency('task-v', 'task-b');

    const executor = scriptedExecutor(store, (context) => {
      if (context.taskId === 'task-b') {
        // Ordinary policy rejection: denied, NOT human-gated, NOT retryable.
        return {
          status: 'failed',
          emitEventType: 'policy.evaluated',
          emitPayload: { accepted: false, decision: 'deny', changes: [{ path: 'src/x.ts', category: 'OUT_OF_SCOPE_CHANGE', decision: 'deny', reasonCode: 'out-of-scope-write' }] },
        };
      }
      return { status: 'passed' };
    });

    const { status } = await drive(store, 'run-1', executor, attemptIds());

    assert.equal(status, 'failed');
    assert.equal(store.getTask('task-a')?.status, 'passed');
    assert.equal(store.getTask('task-b')?.status, 'failed');
    assert.equal(store.getTask('task-v')?.status, 'pending'); // never ran
    assert.equal(store.listAttempts('task-b').length, 1); // no retry despite maxAttempts=3
    assert.equal(store.listAttempts('task-v').length, 0);
    assert.deepEqual(executor.order(), ['task-a', 'task-b']);
    // No pause, no gate.
    assert.equal(store.listEvents().filter((e) => e.type === SUPERVISOR_BLOCKED_EVENT).length, 0);
  });
});
