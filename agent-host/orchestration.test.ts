import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { openOrchestrationStore } from './lib/store.ts';
import { inspectOrchestrationDatabase } from './lib/schema.ts';
import { resolveStatePaths } from './lib/statePaths.ts';
import { getStatusReport } from './status.ts';
import { OrchestrationError, TEXT_FIELD_MAX_BYTES, type OrchestrationEventRecord } from './lib/orchestrationTypes.ts';

async function createTempDbPath(prefix: string): Promise<{ tempDir: string; dbPath: string }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    tempDir,
    dbPath: path.join(tempDir, 'orchestration.sqlite'),
  };
}

function createTestStore(options: {
  dbPath: string;
  repoKey?: string;
  hostId?: string;
  hostVersion?: string;
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
}) {
  let eventCounter = 0;

  return openOrchestrationStore({
    dbPath: options.dbPath,
    repoKey: options.repoKey ?? 'repo-key-1',
    hostId: options.hostId ?? 'host-1',
    hostVersion: options.hostVersion ?? '0.1.0',
    idGenerator: () => `event-${++eventCounter}`,
    testHooks: options.testHooks,
  });
}

function openRawDb(dbPath: string): DatabaseSync {
  return new DatabaseSync(dbPath, {
    timeout: 5_000,
    allowExtension: false,
  });
}

function getSingleValue(
  db: DatabaseSync,
  sql: string,
  ...params: Array<string | number | bigint | Uint8Array | null>
): unknown {
  const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  return row ? Object.values(row)[0] : undefined;
}

async function withLocalAppData<T>(localAppData: string, work: () => Promise<T>): Promise<T> {
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localAppData;

  try {
    return await work();
  } finally {
    if (previous === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = previous;
    }
  }
}

function expectCode(error: unknown, code: string): boolean {
  return error instanceof OrchestrationError && error.code === code;
}

test('bootstraps a durable SQLite schema with strict tables and persistence across reopen', async () => {
  const { dbPath } = await createTempDbPath('orch-bootstrap-');
  const store = createTestStore({ dbPath, repoKey: 'repo-bootstrap' });

  const run = store.createRun({
    runId: 'run-bootstrap',
    title: 'Bootstrap run',
    goal: 'Validate durable persistence',
  });
  const task = store.createTask({
    taskId: 'task-bootstrap',
    runId: run.runId,
    title: 'Bootstrap task',
    spec: { action: 'validate' },
  });
  const attempt = store.createAttempt({
    attemptId: 'attempt-bootstrap',
    taskId: task.taskId,
    hostInstanceId: 'host-instance-1',
  });
  const customEvent = store.appendEvent({
    eventId: 'event-custom-bootstrap',
    runId: run.runId,
    taskId: task.taskId,
    attemptId: attempt.attemptId,
    type: 'custom.safe',
    payload: { safe: true, path: 'agent-host/status.ts' },
  });
  store.close();

  const db = openRawDb(dbPath);
  try {
    const userVersion = getSingleValue(db, 'PRAGMA user_version');
    const journalMode = String(getSingleValue(db, 'PRAGMA journal_mode'));
    const synchronous = Number(getSingleValue(db, 'PRAGMA synchronous'));
    const tableList = db.prepare(`PRAGMA table_list`).all() as Array<{ name: string; strict: number }>;
    const meta = db.prepare(
      `
        SELECT schemaVersion, repoKey, createdAt, createdByHostId, createdByHostVersion
        FROM meta
      `,
    ).get() as Record<string, unknown>;

    assert.equal(userVersion, 1);
    assert.equal(journalMode.toLowerCase(), 'wal');
    assert.equal(synchronous, 2);
    assert.equal(tableList.find((row) => row.name === 'runs')?.strict, 1);
    assert.equal(tableList.find((row) => row.name === 'tasks')?.strict, 1);
    assert.equal(tableList.find((row) => row.name === 'task_dependencies')?.strict, 1);
    assert.equal(tableList.find((row) => row.name === 'attempts')?.strict, 1);
    assert.equal(tableList.find((row) => row.name === 'events')?.strict, 1);
    assert.equal(meta.schemaVersion, 1);
    assert.equal(meta.repoKey, 'repo-bootstrap');
    assert.equal(meta.createdByHostId, 'host-1');
    assert.equal(meta.createdByHostVersion, '0.1.0');
  } finally {
    db.close();
  }

  const reopened = createTestStore({ dbPath, repoKey: 'repo-bootstrap' });
  try {
    assert.equal(reopened.getRun(run.runId)?.title, 'Bootstrap run');
    assert.equal(reopened.getTask(task.taskId)?.status, 'running');
    assert.equal(reopened.getAttempt(attempt.attemptId)?.ordinal, 1);
    assert.equal(reopened.listEvents().at(-1)?.eventId, customEvent.eventId);
    assert.equal(reopened.listRuns().length, 1);
  } finally {
    reopened.close();
  }
});

test('refuses newer, partial, and mismatched schemas without mutating corrupt databases', async () => {
  const newerContext = await createTempDbPath('orch-newer-');
  const newerDb = openRawDb(newerContext.dbPath);
  newerDb.exec('PRAGMA user_version = 2');
  newerDb.close();

  assert.throws(
    () => createTestStore({ dbPath: newerContext.dbPath, repoKey: 'repo-newer' }),
    (error: unknown) => expectCode(error, 'SCHEMA_NEWER'),
  );

  const partialContext = await createTempDbPath('orch-partial-');
  const partialDb = openRawDb(partialContext.dbPath);
  partialDb.exec(`
    CREATE TABLE meta (
      rowId INTEGER PRIMARY KEY,
      schemaVersion INTEGER NOT NULL,
      repoKey TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      createdByHostId TEXT NOT NULL,
      createdByHostVersion TEXT NOT NULL
    ) STRICT;
    PRAGMA user_version = 1;
  `);
  partialDb.close();

  const partialBytesBefore = await readFile(partialContext.dbPath);
  assert.throws(
    () => createTestStore({ dbPath: partialContext.dbPath, repoKey: 'repo-partial' }),
    (error: unknown) => expectCode(error, 'SCHEMA_CORRUPT'),
  );
  const partialBytesAfter = await readFile(partialContext.dbPath);
  assert.deepEqual(partialBytesAfter, partialBytesBefore);

  const mismatchContext = await createTempDbPath('orch-mismatch-');
  const goodStore = createTestStore({ dbPath: mismatchContext.dbPath, repoKey: 'repo-good' });
  goodStore.close();

  const mismatchDb = openRawDb(mismatchContext.dbPath);
  mismatchDb.exec(`UPDATE meta SET schemaVersion = 9`);
  mismatchDb.close();
  assert.throws(
    () => createTestStore({ dbPath: mismatchContext.dbPath, repoKey: 'repo-good' }),
    (error: unknown) => expectCode(error, 'SCHEMA_CORRUPT'),
  );

  const repoMismatchContext = await createTempDbPath('orch-repo-mismatch-');
  const repoStore = createTestStore({ dbPath: repoMismatchContext.dbPath, repoKey: 'repo-expected' });
  repoStore.close();

  const repoDb = openRawDb(repoMismatchContext.dbPath);
  repoDb.exec(`UPDATE meta SET repoKey = 'repo-other'`);
  repoDb.close();
  assert.throws(
    () => createTestStore({ dbPath: repoMismatchContext.dbPath, repoKey: 'repo-expected' }),
    (error: unknown) => expectCode(error, 'SCHEMA_CORRUPT'),
  );
});

test('run CRUD, legal transitions, and illegal rollback semantics are enforced', async () => {
  const { dbPath } = await createTempDbPath('orch-runs-');
  const store = createTestStore({ dbPath });

  try {
    const pendingToRunning = store.createRun({ runId: 'run-1', title: 'Pending to running' });
    assert.equal(pendingToRunning.status, 'pending');
    const running = store.transitionRun('run-1', 'running');
    assert.equal(running.status, 'running');
    assert.ok(running.startedAt);

    const paused = store.transitionRun('run-1', 'paused');
    assert.equal(paused.status, 'paused');
    const resumed = store.transitionRun('run-1', 'running');
    assert.equal(resumed.status, 'running');
    assert.equal(resumed.startedAt, running.startedAt);
    const completed = store.transitionRun('run-1', 'completed');
    assert.equal(completed.status, 'completed');
    assert.ok(completed.completedAt);

    const cancelledFromPending = store.createRun({ runId: 'run-2', title: 'Pending cancel' });
    assert.equal(store.transitionRun(cancelledFromPending.runId, 'cancelled').status, 'cancelled');

    const failedFromRunning = store.createRun({ runId: 'run-3', title: 'Running fail' });
    store.transitionRun(failedFromRunning.runId, 'running');
    assert.equal(store.transitionRun(failedFromRunning.runId, 'failed').status, 'failed');

    const cancelledFromRunning = store.createRun({ runId: 'run-4', title: 'Running cancel' });
    store.transitionRun(cancelledFromRunning.runId, 'running');
    assert.equal(store.transitionRun(cancelledFromRunning.runId, 'cancelled').status, 'cancelled');

    const pausedToFailed = store.createRun({ runId: 'run-5', title: 'Paused fail' });
    store.transitionRun(pausedToFailed.runId, 'running');
    store.transitionRun(pausedToFailed.runId, 'paused');
    assert.equal(store.transitionRun(pausedToFailed.runId, 'failed').status, 'failed');

    const pausedToCancelled = store.createRun({ runId: 'run-6', title: 'Paused cancel' });
    store.transitionRun(pausedToCancelled.runId, 'running');
    store.transitionRun(pausedToCancelled.runId, 'paused');
    assert.equal(store.transitionRun(pausedToCancelled.runId, 'cancelled').status, 'cancelled');

    const illegalRun = store.createRun({ runId: 'run-illegal', title: 'Illegal run' });
    const eventCountBefore = store.listEvents().length;
    assert.throws(
      () => store.transitionRun(illegalRun.runId, 'completed'),
      (error: unknown) => expectCode(error, 'INVALID_TRANSITION'),
    );
    assert.equal(store.getRun(illegalRun.runId)?.status, 'pending');
    assert.equal(store.listEvents().length, eventCountBefore);
    assert.equal(store.listRuns().length, 7);
  } finally {
    store.close();
  }
});

test('task CRUD and transitions honor running invariants, retries, and deterministic positions', async () => {
  const { dbPath } = await createTempDbPath('orch-tasks-');
  const store = createTestStore({ dbPath });

  try {
    store.createRun({ runId: 'run-tasks', title: 'Task parent' });
    const taskA = store.createTask({ taskId: 'task-a', runId: 'run-tasks', title: 'Task A' });
    const taskB = store.createTask({ taskId: 'task-b', runId: 'run-tasks', title: 'Task B' });
    const taskC = store.createTask({ taskId: 'task-c', runId: 'run-tasks', title: 'Task C', position: 10 });

    assert.equal(taskA.position, 0);
    assert.equal(taskB.position, 1);
    assert.equal(taskC.position, 10);
    assert.deepEqual(
      store.listTasks('run-tasks').map((task) => task.taskId),
      ['task-a', 'task-b', 'task-c'],
    );

    assert.throws(
      () => store.transitionTask(taskA.taskId, 'running'),
      (error: unknown) => expectCode(error, 'INVALID_TRANSITION'),
    );
    assert.equal(store.listAttempts(taskA.taskId).length, 0);

    assert.equal(store.transitionTask(taskA.taskId, 'blocked').status, 'blocked');
    assert.equal(store.transitionTask(taskA.taskId, 'pending').status, 'pending');
    assert.equal(store.transitionTask(taskA.taskId, 'cancelled').status, 'cancelled');

    const attemptOne = store.createAttempt({
      attemptId: 'attempt-1',
      taskId: taskB.taskId,
      hostInstanceId: 'host-a',
    });
    assert.equal(attemptOne.ordinal, 1);
    assert.equal(store.getTask(taskB.taskId)?.status, 'running');

    const passedTask = store.transitionTask(taskB.taskId, 'passed');
    assert.equal(passedTask.status, 'passed');
    assert.ok(passedTask.completedAt);

    const retryTask = store.createTask({ taskId: 'task-retry', runId: 'run-tasks', title: 'Retry task' });
    store.createAttempt({
      attemptId: 'attempt-retry-1',
      taskId: retryTask.taskId,
      hostInstanceId: 'host-b',
    });
    const failedTask = store.transitionTask(retryTask.taskId, 'failed');
    assert.ok(failedTask.completedAt);

    const retriedAttempt = store.createAttempt({
      attemptId: 'attempt-retry-2',
      taskId: retryTask.taskId,
      hostInstanceId: 'host-b',
    });
    const retriedTask = store.getTask(retryTask.taskId);
    assert.equal(retriedAttempt.ordinal, 2);
    assert.equal(retriedTask?.status, 'running');
    assert.equal(retriedTask?.completedAt, null);

    const blockedFromRunningTask = store.createTask({
      taskId: 'task-block-run',
      runId: 'run-tasks',
      title: 'Blocked while running',
    });
    store.createAttempt({
      attemptId: 'attempt-block-run',
      taskId: blockedFromRunningTask.taskId,
      hostInstanceId: 'host-c',
    });
    assert.equal(store.transitionTask(blockedFromRunningTask.taskId, 'blocked').status, 'blocked');
    assert.equal(store.transitionTask(blockedFromRunningTask.taskId, 'failed').status, 'failed');
    assert.equal(store.transitionTask(blockedFromRunningTask.taskId, 'cancelled').status, 'cancelled');
  } finally {
    store.close();
  }
});

test('dependencies stay within a run, reject self or cycles, and derive ready tasks from passed dependencies', async () => {
  const { dbPath } = await createTempDbPath('orch-deps-');
  const store = createTestStore({ dbPath });

  try {
    store.createRun({ runId: 'run-deps', title: 'Dependencies run' });
    store.createRun({ runId: 'run-other', title: 'Other run' });

    const task1 = store.createTask({ taskId: 'dep-1', runId: 'run-deps', title: 'Dep 1' });
    const task2 = store.createTask({ taskId: 'dep-2', runId: 'run-deps', title: 'Dep 2' });
    const task3 = store.createTask({ taskId: 'dep-3', runId: 'run-deps', title: 'Dep 3' });
    const foreignTask = store.createTask({ taskId: 'dep-other', runId: 'run-other', title: 'Other' });

    const dependency = store.addDependency(task2.taskId, task1.taskId);
    assert.equal(dependency.dependsOnTaskId, task1.taskId);

    assert.throws(
      () => store.addDependency(task1.taskId, task1.taskId),
      (error: unknown) => expectCode(error, 'INVALID_TRANSITION'),
    );
    assert.throws(
      () => store.addDependency(task2.taskId, task1.taskId),
      (error: unknown) => expectCode(error, 'INVALID_TRANSITION'),
    );
    assert.throws(
      () => store.addDependency(task1.taskId, foreignTask.taskId),
      (error: unknown) => expectCode(error, 'CROSS_RUN_DEPENDENCY'),
    );

    store.addDependency(task3.taskId, task2.taskId);
    assert.throws(
      () => store.addDependency(task1.taskId, task3.taskId),
      (error: unknown) => expectCode(error, 'DEPENDENCY_CYCLE'),
    );

    assert.deepEqual(
      store.getReadyTasks('run-deps').map((task) => task.taskId),
      ['dep-1'],
    );

    store.createAttempt({
      attemptId: 'dep-attempt-1',
      taskId: task1.taskId,
      hostInstanceId: 'dep-host',
    });
    store.transitionTask(task1.taskId, 'passed');
    assert.deepEqual(
      store.getReadyTasks('run-deps').map((task) => task.taskId),
      ['dep-2'],
    );

    store.createAttempt({
      attemptId: 'dep-attempt-2',
      taskId: task2.taskId,
      hostInstanceId: 'dep-host',
    });
    store.transitionTask(task2.taskId, 'passed');
    assert.deepEqual(
      store.getReadyTasks('run-deps').map((task) => task.taskId),
      ['dep-3'],
    );
    assert.equal(store.listDependencies('run-deps').length, 2);
  } finally {
    store.close();
  }
});

test('attempt ordinals, transitions, idempotency, interruption lookup, and unique backstop behave correctly', async () => {
  const { dbPath } = await createTempDbPath('orch-attempts-');
  const store = createTestStore({ dbPath });

  try {
    store.createRun({ runId: 'run-attempts', title: 'Attempt run' });
    const task = store.createTask({ taskId: 'task-attempts', runId: 'run-attempts', title: 'Attempt task' });

    const firstAttempt = store.createAttempt({
      attemptId: 'attempt-main',
      taskId: task.taskId,
      hostInstanceId: 'live-host',
    });
    const eventCountAfterFirstAttempt = store.listEvents().length;
    const firstAttemptRetry = store.createAttempt({
      attemptId: 'attempt-main',
      taskId: task.taskId,
      hostInstanceId: 'live-host',
    });
    assert.equal(firstAttemptRetry.ordinal, 1);
    assert.equal(store.listEvents().length, eventCountAfterFirstAttempt);

    assert.throws(
      () =>
        store.createAttempt({
          attemptId: 'attempt-main',
          taskId: task.taskId,
          hostInstanceId: 'other-host',
        }),
      (error: unknown) => expectCode(error, 'IDEMPOTENCY_CONFLICT'),
    );

    assert.equal(store.transitionAttempt(firstAttempt.attemptId, 'interrupted').status, 'interrupted');
    assert.throws(
      () => store.transitionAttempt(firstAttempt.attemptId, 'failed'),
      (error: unknown) => expectCode(error, 'INVALID_TRANSITION'),
    );

    store.transitionTask(task.taskId, 'failed');
    const secondAttempt = store.createAttempt({
      attemptId: 'attempt-second',
      taskId: task.taskId,
      hostInstanceId: 'other-host',
    });
    assert.equal(secondAttempt.ordinal, 2);
    assert.equal(store.findInterruptedAttempts('live-host').map((attempt) => attempt.attemptId)[0], secondAttempt.attemptId);

    const cancelTask = store.createTask({
      taskId: 'task-cancel-attempt',
      runId: 'run-attempts',
      title: 'Attempt cancel task',
    });
    const cancelAttempt = store.createAttempt({
      attemptId: 'attempt-cancel',
      taskId: cancelTask.taskId,
      hostInstanceId: 'host-cancel',
    });
    assert.equal(store.transitionAttempt(cancelAttempt.attemptId, 'cancelled').status, 'cancelled');

    const passTask = store.createTask({
      taskId: 'task-pass-attempt',
      runId: 'run-attempts',
      title: 'Attempt pass task',
    });
    const passAttempt = store.createAttempt({
      attemptId: 'attempt-pass',
      taskId: passTask.taskId,
      hostInstanceId: 'host-pass',
    });
    assert.equal(store.transitionAttempt(passAttempt.attemptId, 'passed').status, 'passed');

    const rawDb = openRawDb(dbPath);
    try {
      rawDb.exec('PRAGMA foreign_keys = ON');
      assert.throws(
        () =>
          rawDb.prepare(
            `
              INSERT INTO attempts (
                attemptId,
                taskId,
                ordinal,
                status,
                hostInstanceId,
                createdAt,
                startedAt,
                endedAt
              ) VALUES (?, ?, ?, 'running', ?, ?, ?, NULL)
            `,
          ).run('attempt-duplicate-ordinal', task.taskId, 2, 'dup-host', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z'),
        /UNIQUE/u,
      );
    } finally {
      rawDb.close();
    }
  } finally {
    store.close();
  }
});

test('events are immutable, globally ordered, idempotent, relationally consistent, and atomic with state changes', async () => {
  const { dbPath } = await createTempDbPath('orch-events-');
  const store = createTestStore({ dbPath });

  try {
    const run = store.createRun({ runId: 'run-events', title: 'Event run' });
    const task = store.createTask({ taskId: 'task-events', runId: run.runId, title: 'Event task' });
    const attempt = store.createAttempt({
      attemptId: 'attempt-events',
      taskId: task.taskId,
      hostInstanceId: 'event-host',
    });

    const customEvent = store.appendEvent({
      eventId: 'event-same',
      runId: run.runId,
      taskId: task.taskId,
      attemptId: attempt.attemptId,
      type: 'custom.safe',
      payload: { value: 1, nested: { ok: true } },
    });
    const customEventRetry = store.appendEvent({
      eventId: 'event-same',
      runId: run.runId,
      taskId: task.taskId,
      attemptId: attempt.attemptId,
      type: 'custom.safe',
      payload: { nested: { ok: true }, value: 1 },
    });
    assert.equal(customEventRetry.seq, customEvent.seq);

    assert.throws(
      () =>
        store.appendEvent({
          eventId: 'event-same',
          runId: run.runId,
          taskId: task.taskId,
          attemptId: attempt.attemptId,
          type: 'custom.safe',
          payload: { value: 2 },
        }),
      (error: unknown) => expectCode(error, 'IDEMPOTENCY_CONFLICT'),
    );

    const otherRun = store.createRun({ runId: 'run-other-events', title: 'Other run' });
    const otherTask = store.createTask({ taskId: 'task-other-events', runId: otherRun.runId, title: 'Other task' });
    const otherAttempt = store.createAttempt({
      attemptId: 'attempt-other-events',
      taskId: otherTask.taskId,
      hostInstanceId: 'other-host',
    });

    assert.throws(
      () =>
        store.appendEvent({
          eventId: 'event-cross-run',
          runId: run.runId,
          taskId: otherTask.taskId,
          type: 'custom.safe',
        }),
      (error: unknown) => expectCode(error, 'RELATIONSHIP_MISMATCH'),
    );
    assert.throws(
      () =>
        store.appendEvent({
          eventId: 'event-cross-attempt',
          runId: otherRun.runId,
          taskId: otherTask.taskId,
          attemptId: attempt.attemptId,
          type: 'custom.safe',
        }),
      (error: unknown) => expectCode(error, 'RELATIONSHIP_MISMATCH'),
    );

    const events = store.listEvents();
    assert.equal(events.every((event, index) => index === 0 || event.seq > events[index - 1].seq), true);

    const sinceSeq = store.listEvents({ sinceSeq: customEvent.seq });
    assert.equal(sinceSeq.every((event) => event.seq > customEvent.seq), true);

    const rawDb = openRawDb(dbPath);
    try {
      assert.throws(
        () => rawDb.prepare(`UPDATE events SET type = 'tampered' WHERE eventId = ?`).run(customEvent.eventId),
        /immutable/u,
      );
      assert.throws(
        () => rawDb.prepare(`DELETE FROM events WHERE eventId = ?`).run(customEvent.eventId),
        /immutable/u,
      );
    } finally {
      rawDb.close();
    }

    assert.equal(otherAttempt.status, 'running');
  } finally {
    store.close();
  }

  const rollbackContext = await createTempDbPath('orch-rollback-');
  const rollbackStore = createTestStore({
    dbPath: rollbackContext.dbPath,
    testHooks: {
      beforeEventInsert: (event) => {
        if (event.type === 'run.created') {
          throw new Error('forced event failure');
        }
      },
    },
  });

  try {
    assert.throws(() => rollbackStore.createRun({ runId: 'rollback-run', title: 'Rollback run' }), /forced event failure/u);
    assert.equal(rollbackStore.listRuns().length, 0);
    assert.equal(rollbackStore.listEvents().length, 0);
  } finally {
    rollbackStore.close();
  }
});

test('oversize payloads are rejected, foreign keys enforce integrity, close and reopen are safe, and repo DBs stay isolated', async () => {
  const { tempDir, dbPath } = await createTempDbPath('orch-bounds-');
  const store = createTestStore({ dbPath, repoKey: 'repo-bounds' });

  try {
    const run = store.createRun({ runId: 'run-bounds', title: 'Bounds run' });
    assert.throws(
      () =>
        store.createRun({
          runId: 'run-big-goal',
          title: 'Big goal run',
          goal: 'x'.repeat(TEXT_FIELD_MAX_BYTES + 1),
        }),
      (error: unknown) => expectCode(error, 'PAYLOAD_TOO_LARGE'),
    );

    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-big-spec',
          runId: run.runId,
          title: 'Big spec task',
          spec: { text: 'x'.repeat(TEXT_FIELD_MAX_BYTES) },
        }),
      (error: unknown) => expectCode(error, 'PAYLOAD_TOO_LARGE'),
    );

    assert.throws(
      () =>
        store.appendEvent({
          eventId: 'event-big-payload',
          runId: run.runId,
          type: 'custom.safe',
          payload: { text: 'x'.repeat(TEXT_FIELD_MAX_BYTES) },
        }),
      (error: unknown) => expectCode(error, 'PAYLOAD_TOO_LARGE'),
    );

    const rawDb = openRawDb(dbPath);
    try {
      rawDb.exec('PRAGMA foreign_keys = ON');
      assert.throws(
        () =>
          rawDb.prepare(
            `
              INSERT INTO tasks (
                taskId,
                runId,
                title,
                goal,
                status,
                position,
                spec,
                createdAt,
                updatedAt,
                startedAt,
                completedAt
              ) VALUES (?, ?, ?, NULL, 'pending', 0, NULL, ?, ?, NULL, NULL)
            `,
          ).run('fk-task', 'missing-run', 'FK task', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z'),
        /FOREIGN KEY/u,
      );
    } finally {
      rawDb.close();
    }

    const inspection = inspectOrchestrationDatabase({
      dbPath,
      repoKey: 'repo-bounds',
    });
    assert.equal(inspection.database, 'ready');
  } finally {
    store.close();
  }

  const reopened = createTestStore({ dbPath, repoKey: 'repo-bounds' });
  try {
    assert.equal(reopened.listRuns().length, 1);
  } finally {
    reopened.close();
  }

  const repoOnePath = path.join(tempDir, 'repo-one.sqlite');
  const repoTwoPath = path.join(tempDir, 'repo-two.sqlite');
  const repoOneStore = createTestStore({ dbPath: repoOnePath, repoKey: 'repo-one' });
  const repoTwoStore = createTestStore({ dbPath: repoTwoPath, repoKey: 'repo-two' });

  try {
    repoOneStore.createRun({ runId: 'run-one', title: 'Repo one' });
    repoTwoStore.createRun({ runId: 'run-two', title: 'Repo two' });
    assert.equal(repoOneStore.listRuns().length, 1);
    assert.equal(repoTwoStore.listRuns().length, 1);
    assert.notEqual(repoOnePath, repoTwoPath);

    const privacyString = JSON.stringify({
      runs: repoOneStore.listRuns(),
      events: repoOneStore.listEvents(),
    });
    assert.equal(privacyString.includes('OPENAI_API_KEY'), false);
    assert.equal(privacyString.includes('authorization'), false);
    assert.equal(privacyString.includes('process.env'), false);
  } finally {
    repoOneStore.close();
    repoTwoStore.close();
  }
});

test('status inspection is read-only for absent and existing orchestration databases', async () => {
  const localAppData = await mkdtemp(path.join(os.tmpdir(), 'orch-status-'));

  await withLocalAppData(localAppData, async () => {
    const absentReport = await getStatusReport(process.cwd());
    assert.equal(absentReport.orchestration?.database, 'absent');

    const canonicalRepoPath = process.cwd();
    const statePaths = resolveStatePaths({
      canonicalRepoPath,
      localAppData,
    });
    const beforeExists = await stat(statePaths.repoStateDir).catch(() => null);
    assert.equal(beforeExists, null);
    await unlink(statePaths.orchestrationDbPath).catch(() => undefined);

    const store = createTestStore({
      dbPath: statePaths.orchestrationDbPath,
      repoKey: statePaths.repoKey,
    });
    store.createRun({ runId: 'run-status', title: 'Status run' });
    store.close();

    const bytesBefore = await readFile(statePaths.orchestrationDbPath);
    const readyReport = await getStatusReport(process.cwd());
    const bytesAfter = await readFile(statePaths.orchestrationDbPath);

    assert.equal(readyReport.orchestration?.database, 'ready');
    assert.equal(readyReport.orchestration?.schemaVersion, 1);
    assert.equal(readyReport.orchestration?.runCount, 1);
    assert.equal(readyReport.orchestration?.activeRunCount, 1);
    assert.deepEqual(bytesAfter, bytesBefore);
  });
});
